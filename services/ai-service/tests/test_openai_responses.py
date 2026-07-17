from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import pytest

from agent_ai.models import Category
from agent_ai.providers.openai_responses import OpenAIComputerAgent


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
                        "type": "computer_call",
                        "call_id": "call-1",
                        "action": {"type": "screenshot"},
                        "pending_safety_checks": [],
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
        self.safety_pauses: list[Any] = []

    async def capture(self) -> str:
        return "data:image/png;base64,aW5pdGlhbA=="

    async def execute(self, action: dict[str, Any]) -> str:
        self.actions.append(action)
        return "data:image/png;base64,YWZ0ZXI="

    async def pause_for_safety(self, pause: Any) -> None:
        self.safety_pauses.append(pause)


@pytest.mark.asyncio
async def test_responses_api_uses_default_model_web_search_and_computer_tool() -> None:
    responses = FakeResponses()
    executor = FakeExecutor()
    agent = OpenAIComputerAgent(
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
    assert responses.calls[0]["model"] == "gpt-5.6"
    assert {tool["type"] for tool in responses.calls[0]["tools"]} == {
        "computer",
        "web_search",
        "function",
    }
    assert responses.calls[0]["input"][0]["content"][1]["type"] == "input_image"
    assert responses.calls[0]["input"][0]["content"][1]["detail"] == "original"
    assert "{{secret:street}}" in responses.calls[0]["input"][0]["content"][0]["text"]
    assert executor.actions == [{"type": "screenshot"}]
    assert responses.calls[1]["previous_response_id"] == "response-1"
    assert responses.calls[1]["input"][0]["type"] == "computer_call_output"
    assert responses.calls[1]["input"][0]["output"]["detail"] == "original"
    assert agent.previous_response_id == "response-2"


@pytest.mark.asyncio
async def test_incremental_discovery_function_is_emitted_before_final_text() -> None:
    class DiscoveryResponses:
        def __init__(self) -> None:
            self.calls = 0

        async def create(self, **_: Any) -> Any:
            self.calls += 1
            if self.calls == 1:
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
                                    "data": {"code": "PARTIAL", "message": "still checking"},
                                }
                            ),
                        }
                    ],
                    output_text="",
                )
            return SimpleNamespace(id="response-2", output=[], output_text='{"candidates": []}')

    discoveries: list[tuple[str, dict[str, Any]]] = []

    async def sink(kind: str, data: dict[str, Any]) -> None:
        discoveries.append((kind, data))

    agent = OpenAIComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=DiscoveryResponses()),
    )
    await agent.run(
        query="Find a meal",
        category=Category.FOOD,
        executor=FakeExecutor(),  # type: ignore[arg-type]
        discovery_sink=sink,
    )
    assert discoveries == [("warning", {"code": "PARTIAL", "message": "still checking"})]


@pytest.mark.asyncio
async def test_response_chain_survives_an_executor_pause_and_resume() -> None:
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
    agent = OpenAIComputerAgent(
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
    assert agent.previous_response_id == "response-1"
    executor.resume.set()
    await task
    assert responses.calls[1]["previous_response_id"] == "response-1"
    assert agent.previous_response_id == "response-2"


@pytest.mark.asyncio
async def test_pending_computer_safety_checks_pause_then_are_acknowledged() -> None:
    class SafetyResponses(FakeResponses):
        async def create(self, **kwargs: Any) -> Any:
            self.calls.append(kwargs)
            if len(self.calls) == 1:
                return SimpleNamespace(
                    id="response-1",
                    output=[
                        {
                            "type": "computer_call",
                            "call_id": "call-1",
                            "actions": [{"type": "screenshot"}],
                            "pending_safety_checks": [
                                {
                                    "id": "check-1",
                                    "code": "sensitive_action",
                                    "message": "Review required",
                                }
                            ],
                        }
                    ],
                    output_text="",
                )
            return SimpleNamespace(id="response-2", output=[], output_text='{"candidates": []}')

    responses = SafetyResponses()
    executor = FakeExecutor()
    agent = OpenAIComputerAgent(
        api_key="fake",
        client=SimpleNamespace(responses=responses),
    )
    await agent.run(
        query="Find a phone",
        category=Category.RETAIL,
        executor=executor,  # type: ignore[arg-type]
    )
    assert len(executor.safety_pauses) == 1
    output = responses.calls[1]["input"][0]
    assert output["acknowledged_safety_checks"] == [
        {
            "id": "check-1",
            "code": "sensitive_action",
            "message": "Review required",
        }
    ]
