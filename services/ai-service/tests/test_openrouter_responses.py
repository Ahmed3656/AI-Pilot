from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import pytest

from agent_ai.browser.safety import PauseRequired
from agent_ai.browser.selenium_remote import VisualFallbackRequired, WorkflowBoundaryReached
from agent_ai.models import Category
from agent_ai.providers import openrouter_responses
from agent_ai.providers.openrouter_responses import OpenRouterComputerAgent
from agent_ai.vision import VisualTarget


class FakeResponses:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            return SimpleNamespace(
                id="response-1",
                output=[
                    {
                        "type": "function_call",
                        "name": "dealpilot_computer",
                        "call_id": "call-1",
                        "arguments": json.dumps({"actions": [{"type": "screenshot"}]}),
                    }
                ],
                output_text="",
            )
        return SimpleNamespace(
            id="response-2",
            output=[],
            output_text=json.dumps(
                {
                    "candidates": [],
                    "coupon_attempts": [],
                    "stopped_before": "payment",
                    "notes": [],
                }
            ),
        )


class FakeExecutor:
    def __init__(self) -> None:
        self.actions: list[dict[str, Any]] = []

    async def capture(self) -> str:
        return "data:image/png;base64,aW5pdGlhbA=="

    async def execute(self, action: dict[str, Any]) -> str:
        self.actions.append(action)
        return "data:image/png;base64,YWZ0ZXI="


@pytest.mark.asyncio
async def test_request_understanding_uses_model_structured_intent() -> None:
    class UnderstandingResponses:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        async def create(self, **kwargs: Any) -> Any:
            self.calls.append(kwargs)
            return SimpleNamespace(
                output=[
                    {
                        "type": "function_call",
                        "name": "submit_request_understanding",
                        "arguments": json.dumps(
                            {
                                "category": "retail",
                                "search_query": "Samsung Galaxy S24 Ultra 256GB black",
                                "target": {
                                    "name": "Samsung Galaxy S24 Ultra",
                                    "brand": "Samsung",
                                    "model": "Galaxy S24 Ultra",
                                    "variant": "256GB black",
                                    "specifications": ["256GB", "black"],
                                },
                                "constraints": {"budget_max_egp": 50000},
                                "comparison_priorities": [
                                    "exact_match",
                                    "lowest_total",
                                ],
                                "requires_checkout": False,
                                "requires_coupons": False,
                            }
                        ),
                    }
                ]
            )

    responses = UnderstandingResponses()
    agent = OpenRouterComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=responses),
    )
    raw_query = (
        "Bro find me a Samsung Galaxy S24 Ultra 256GB in black under 50k and compare "
        "Amazon, Jumia, and Noon including delivery"
    )

    understanding = await agent.understand_request(
        query=raw_query,
        category=Category.RETAIL,
    )

    assert understanding["search_query"] == "Samsung Galaxy S24 Ultra 256GB black"
    assert understanding["target"]["model"] == "Galaxy S24 Ultra"
    assert understanding["constraints"] == {"budget_max_egp": 50000}
    assert responses.calls[0]["tool_choice"] == {
        "type": "function",
        "name": "submit_request_understanding",
    }
    assert raw_query in responses.calls[0]["input"][0]["content"][0]["text"]


@pytest.mark.asyncio
async def test_openrouter_uses_bounded_stateless_history_and_standard_function_tools() -> None:
    responses = FakeResponses()
    executor = FakeExecutor()
    agent = OpenRouterComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=responses),
    )
    result = await agent.run(
        query="Find an iPhone on Amazon Egypt",
        category=Category.RETAIL,
        executor=executor,  # type: ignore[arg-type]
        address_handle="delivery.home",
    )

    assert json.loads(result)["stopped_before"] == "payment"
    assert responses.calls[0]["model"] == "openai/gpt-5.2"
    assert {tool["name"] for tool in responses.calls[0]["tools"]} == {
        "dealpilot_computer",
        "dealpilot_page_text",
        "record_dealpilot_discovery",
    }
    assert {tool["type"] for tool in responses.calls[0]["tools"]} == {"function"}
    assert responses.calls[0]["input"][0]["content"][1]["type"] == "input_image"
    assert responses.calls[0]["input"][0]["content"][1]["detail"] == "original"
    assert "{{secret:street}}" in responses.calls[0]["input"][0]["content"][0]["text"]
    first_prompt = responses.calls[0]["input"][0]["content"][0]["text"]
    assert "Processed request understanding" in first_prompt
    assert '"search_query": "iPhone"' in first_prompt
    assert executor.actions == [{"type": "screenshot"}]
    computer_tool = next(
        tool for tool in responses.calls[0]["tools"] if tool["name"] == "dealpilot_computer"
    )
    assert "target" in computer_tool["parameters"]["properties"]["actions"]["items"]["properties"]

    continuation = responses.calls[1]
    assert "previous_response_id" not in continuation
    assert continuation["input"][0]["content"] == [responses.calls[0]["input"][0]["content"][0]]
    assert continuation["input"][1]["name"] == "dealpilot_computer"
    assert continuation["input"][2]["type"] == "function_call_output"
    assert json.loads(continuation["input"][2]["output"]) == {
        "executed": True,
        "actionCount": 1,
    }
    assert continuation["input"][3]["content"][1]["image_url"].endswith("YWZ0ZXI=")
    assert (
        sum(
            part.get("type") == "input_image"
            for item in continuation["input"]
            for part in item.get("content", [])
            if isinstance(item, dict)
        )
        == 1
    )
    assert agent.last_response_id == "response-2"


@pytest.mark.asyncio
async def test_raw_retail_prompt_typing_is_replaced_with_search_terms() -> None:
    executor = FakeExecutor()
    agent = OpenRouterComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=FakeResponses()),
    )
    raw_query = (
        "Please find a Samsung Galaxy S24 Ultra 256GB in black under 50,000 EGP and compare prices"
    )
    call = {
        "id": "call-search",
        "arguments": json.dumps({"actions": [{"type": "type", "text": raw_query}]}),
    }

    await agent._handle_computer_call(
        call,
        executor,  # type: ignore[arg-type]
        raw_user_query=raw_query,
        retail_search_terms="Samsung Galaxy S24 Ultra 256GB in black",
    )
    prefixed_call = {
        "id": "call-search-prefixed",
        "arguments": json.dumps(
            {"actions": [{"type": "type", "text": f"Search for this product: {raw_query}"}]}
        ),
    }
    await agent._handle_computer_call(
        prefixed_call,
        executor,  # type: ignore[arg-type]
        raw_user_query=raw_query,
        retail_search_terms="Samsung Galaxy S24 Ultra 256GB in black",
    )

    assert executor.actions == [
        {"type": "type", "text": "Samsung Galaxy S24 Ultra 256GB in black"},
        {"type": "type", "text": "Samsung Galaxy S24 Ultra 256GB in black"},
    ]


@pytest.mark.asyncio
async def test_only_latest_frame_is_sent_when_model_returns_multiple_computer_calls() -> None:
    class MultipleComputerResponses:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        async def create(self, **kwargs: Any) -> Any:
            self.calls.append(kwargs)
            if len(self.calls) == 1:
                return SimpleNamespace(
                    id="response-many-1",
                    output=[
                        {
                            "type": "function_call",
                            "name": "dealpilot_computer",
                            "call_id": "call-many-1",
                            "arguments": json.dumps({"actions": [{"type": "screenshot"}]}),
                        },
                        {
                            "type": "function_call",
                            "name": "dealpilot_computer",
                            "call_id": "call-many-2",
                            "arguments": json.dumps({"actions": [{"type": "screenshot"}]}),
                        },
                    ],
                    output_text="",
                )
            return SimpleNamespace(
                id="response-many-2",
                output=[],
                output_text='{"candidates": []}',
            )

    class ChangingExecutor(FakeExecutor):
        async def execute(self, action: dict[str, Any]) -> str:
            self.actions.append(action)
            return f"data:image/png;base64,frame-{len(self.actions)}"

    responses = MultipleComputerResponses()
    agent = OpenRouterComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=responses),
    )
    await agent.run(
        query="Find a phone",
        category=Category.RETAIL,
        executor=ChangingExecutor(),  # type: ignore[arg-type]
    )

    continuation = responses.calls[1]["input"]
    images = [
        part["image_url"]
        for item in continuation
        for part in item.get("content", [])
        if isinstance(item, dict) and part.get("type") == "input_image"
    ]
    assert images == ["data:image/png;base64,frame-2"]


@pytest.mark.asyncio
async def test_changed_button_uses_visual_retry_then_skips_without_takeover() -> None:
    class NotFoundVisionLocator:
        def __init__(self) -> None:
            self.calls = 0

        async def locate(self, **_: Any) -> None:
            self.calls += 1
            return None

    class ChangedButtonExecutor(FakeExecutor):
        def __init__(self) -> None:
            super().__init__()
            self.pauses: list[PauseRequired] = []

        async def execute(self, action: dict[str, Any]) -> str:
            self.actions.append(action)
            raise VisualFallbackRequired("The requested button moved")

        async def pause_for_safety(self, exc: PauseRequired) -> None:
            self.pauses.append(exc)

    executor = ChangedButtonExecutor()
    locator = NotFoundVisionLocator()
    agent = OpenRouterComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=FakeResponses()),
        max_visual_retries=3,
        vision_locator=locator,  # type: ignore[arg-type]
    )
    call = {
        "id": "call-changed",
        "arguments": json.dumps(
            {"actions": [{"type": "click", "x": 100, "y": 200, "target": "Next"}]}
        ),
    }

    first, first_screenshot = await agent._handle_computer_call(call, executor)  # type: ignore[arg-type]
    second, _ = await agent._handle_computer_call(call, executor)  # type: ignore[arg-type]
    third, third_screenshot = await agent._handle_computer_call(call, executor)  # type: ignore[arg-type]

    assert first == {
        "executed": False,
        "actionCount": 0,
        "fallback": "visual_retry",
        "detectorAttempted": True,
        "detector": "NotFoundVisionLocator",
        "reason": "The requested button moved",
        "guidance": (
            "Do not retry the same coordinates. Read the rendered page text, navigate through "
            "a verified approved-domain link, or record a partial result and continue."
        ),
    }
    assert second["fallback"] == "visual_retry"
    assert third["fallback"] == "action_skipped"
    assert first_screenshot.endswith("aW5pdGlhbA==")
    assert third_screenshot.endswith("aW5pdGlhbA==")
    assert executor.pauses == []
    assert locator.calls == 3


@pytest.mark.asyncio
async def test_secondary_vision_locator_recovers_changed_button_and_continues() -> None:
    class RelocatedButtonExecutor(FakeExecutor):
        async def execute(self, action: dict[str, Any]) -> str:
            self.actions.append(action)
            if action.get("x") == 100:
                raise VisualFallbackRequired("The requested button moved")
            return "data:image/png;base64,cmVjb3ZlcmVk"

    class FoundVisionLocator:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        async def locate(self, **kwargs: Any) -> VisualTarget:
            self.calls.append(kwargs)
            return VisualTarget(x=420, y=315, label="Continue", confidence=0.93)

    executor = RelocatedButtonExecutor()
    locator = FoundVisionLocator()
    agent = OpenRouterComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=FakeResponses()),
        vision_locator=locator,  # type: ignore[arg-type]
    )
    call = {
        "id": "call-relocated",
        "arguments": json.dumps(
            {"actions": [{"type": "click", "x": 100, "y": 200, "target": "Next"}]}
        ),
    }

    result, screenshot = await agent._handle_computer_call(call, executor)  # type: ignore[arg-type]

    assert result == {
        "executed": True,
        "actionCount": 1,
        "fallback": "vision_localizer",
        "fallbackDetector": "FoundVisionLocator",
        "fallbackLabel": "Continue",
        "fallbackConfidence": 0.93,
    }
    assert screenshot.endswith("cmVjb3ZlcmVk")
    assert executor.actions == [
        {"type": "click", "x": 100, "y": 200, "target": "Next"},
        {"type": "click", "x": 420, "y": 315, "target": "Continue"},
    ]
    assert locator.calls[0]["intended_target"] == "Next"
    assert locator.calls[0]["screenshot_url"].endswith("aW5pdGlhbA==")


@pytest.mark.asyncio
async def test_automation_step_limit_requests_partial_finalization_without_takeover() -> None:
    class StepLimitExecutor(FakeExecutor):
        def __init__(self) -> None:
            super().__init__()
            self.pauses: list[PauseRequired] = []

        async def pause_for_safety(self, exc: PauseRequired) -> None:
            self.pauses.append(exc)

    executor = StepLimitExecutor()
    agent = OpenRouterComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=FakeResponses()),
        max_steps=1,
    )
    call = {
        "id": "call-step-limit",
        "arguments": json.dumps({"actions": [{"type": "screenshot"}]}),
    }

    first, _ = await agent._handle_computer_call(call, executor)  # type: ignore[arg-type]
    second, screenshot = await agent._handle_computer_call(call, executor)  # type: ignore[arg-type]

    assert first == {"executed": True, "actionCount": 1}
    assert second == {
        "executed": False,
        "actionCount": 0,
        "fallback": "automation_budget",
        "reason": "automation_step_limit",
        "mustFinalize": True,
        "guidance": (
            "Return the offers already observed as partial results; do not call the computer "
            "tool again."
        ),
    }
    assert screenshot.endswith("aW5pdGlhbA==")
    assert executor.pauses == []


@pytest.mark.asyncio
async def test_expected_payment_boundary_finalizes_without_user_takeover() -> None:
    class BoundaryExecutor(FakeExecutor):
        last_screenshot = "data:image/png;base64,c2FmZQ=="

        async def execute(self, action: dict[str, Any]) -> str:
            self.actions.append(action)
            raise WorkflowBoundaryReached(
                "payment",
                "Payment details page detected; AI stopped before inspecting payment data",
            )

    executor = BoundaryExecutor()
    agent = OpenRouterComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=FakeResponses()),
    )
    call = {
        "id": "call-payment-boundary",
        "arguments": json.dumps({"actions": [{"type": "screenshot"}]}),
    }

    result, screenshot = await agent._handle_computer_call(call, executor)  # type: ignore[arg-type]

    assert result["fallback"] == "workflow_boundary"
    assert result["boundary"] == "payment"
    assert result["mustFinalize"] is True
    assert screenshot == executor.last_screenshot


@pytest.mark.asyncio
async def test_page_text_tool_returns_rendered_menu_data_to_the_model() -> None:
    class PageTextResponses:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        async def create(self, **kwargs: Any) -> Any:
            self.calls.append(kwargs)
            if len(self.calls) == 1:
                return SimpleNamespace(
                    id="response-page-1",
                    output=[
                        {
                            "type": "function_call",
                            "name": "dealpilot_page_text",
                            "call_id": "page-text-1",
                            "arguments": "{}",
                        }
                    ],
                    output_text="",
                )
            return SimpleNamespace(
                id="response-page-2",
                output=[],
                output_text='{"candidates": []}',
            )

    class PageTextExecutor(FakeExecutor):
        async def read_page_text(self) -> dict[str, Any]:
            return {
                "url": "https://www.menuegypt.com/menu/pizza",
                "title": "Pizza menu",
                "text": "Large pepperoni pizza 320 EGP",
                "truncated": False,
                "untrustedPageData": True,
            }

    responses = PageTextResponses()
    agent = OpenRouterComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=responses),
    )
    await agent.run(
        query="Find pizza in Maadi",
        category=Category.FOOD,
        executor=PageTextExecutor(),  # type: ignore[arg-type]
    )

    output = json.loads(responses.calls[1]["input"][2]["output"])
    assert output["text"] == "Large pepperoni pizza 320 EGP"
    assert output["untrustedPageData"] is True


def test_openrouter_client_uses_canonical_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    constructor: dict[str, Any] = {}

    def fake_client(**kwargs: Any) -> Any:
        constructor.update(kwargs)
        return SimpleNamespace(responses=SimpleNamespace())

    monkeypatch.setattr(openrouter_responses, "AsyncOpenAI", fake_client)
    OpenRouterComputerAgent(api_key="sk-or-v1-test")

    assert constructor == {
        "api_key": "sk-or-v1-test",
        "base_url": "https://openrouter.ai/api/v1",
        "timeout": 30.0,
    }


@pytest.mark.asyncio
async def test_incremental_discovery_function_is_emitted_before_final_text() -> None:
    class DiscoveryResponses:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        async def create(self, **kwargs: Any) -> Any:
            self.calls.append(kwargs)
            if len(self.calls) == 1:
                return SimpleNamespace(
                    id="response-1",
                    output=[
                        {
                            "type": "function_call",
                            "name": "record_dealpilot_discovery",
                            "call_id": "discovery-1",
                            "arguments": json.dumps(
                                {
                                    "kind": "warning",
                                    "data": {
                                        "code": "PARTIAL",
                                        "message": "still checking",
                                    },
                                }
                            ),
                        }
                    ],
                    output_text="",
                )
            return SimpleNamespace(id="response-2", output=[], output_text='{"candidates": []}')

    responses = DiscoveryResponses()
    discoveries: list[tuple[str, dict[str, Any]]] = []

    async def sink(kind: str, data: dict[str, Any]) -> None:
        discoveries.append((kind, data))

    agent = OpenRouterComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=responses),
    )
    await agent.run(
        query="Find a meal",
        category=Category.FOOD,
        executor=FakeExecutor(),  # type: ignore[arg-type]
        discovery_sink=sink,
    )
    assert discoveries == [("warning", {"code": "PARTIAL", "message": "still checking"})]
    assert "previous_response_id" not in responses.calls[1]
    assert responses.calls[1]["input"][1]["name"] == "record_dealpilot_discovery"


@pytest.mark.asyncio
async def test_stateless_history_survives_an_executor_pause_and_resume() -> None:
    responses = FakeResponses()

    class PausableExecutor(FakeExecutor):
        def __init__(self) -> None:
            super().__init__()
            self.action_started = asyncio.Event()
            self.resume = asyncio.Event()

        async def execute(self, action: dict[str, Any]) -> str:
            self.action_started.set()
            await self.resume.wait()
            return await super().execute(action)

    executor = PausableExecutor()
    agent = OpenRouterComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=responses),
    )
    task = asyncio.create_task(
        agent.run(
            query="Find a phone",
            category=Category.RETAIL,
            executor=executor,  # type: ignore[arg-type]
        )
    )
    await executor.action_started.wait()
    assert task.done() is False
    assert agent.last_response_id == "response-1"
    executor.resume.set()
    await task
    assert "previous_response_id" not in responses.calls[1]
    assert responses.calls[1]["input"][1]["call_id"] == "call-1"
    assert agent.last_response_id == "response-2"


@pytest.mark.asyncio
async def test_computer_tool_rejects_invalid_arguments_without_advancing() -> None:
    class InvalidResponses:
        async def create(self, **_: Any) -> Any:
            return SimpleNamespace(
                id="response-invalid",
                output=[
                    {
                        "type": "function_call",
                        "name": "dealpilot_computer",
                        "call_id": "invalid-call",
                        "arguments": "not-json",
                    }
                ],
                output_text="",
            )

    executor = FakeExecutor()
    agent = OpenRouterComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=InvalidResponses()),
    )
    with pytest.raises(RuntimeError, match="invalid computer-tool JSON"):
        await agent.run(
            query="Find a phone",
            category=Category.RETAIL,
            executor=executor,  # type: ignore[arg-type]
        )
    assert executor.actions == []
