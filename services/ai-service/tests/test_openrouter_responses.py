from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import pytest

from agent_ai.models import Category
from agent_ai.providers import openrouter_responses
from agent_ai.providers.openrouter_responses import OpenRouterComputerAgent


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
async def test_openrouter_uses_stateless_history_and_standard_function_tools() -> None:
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
        "record_dealpilot_discovery",
    }
    assert {tool["type"] for tool in responses.calls[0]["tools"]} == {"function"}
    assert responses.calls[0]["input"][0]["content"][1]["type"] == "input_image"
    assert responses.calls[0]["input"][0]["content"][1]["detail"] == "original"
    assert "{{secret:street}}" in responses.calls[0]["input"][0]["content"][0]["text"]
    assert executor.actions == [{"type": "screenshot"}]

    continuation = responses.calls[1]
    assert "previous_response_id" not in continuation
    assert continuation["input"][0] == responses.calls[0]["input"][0]
    assert continuation["input"][1]["name"] == "dealpilot_computer"
    assert continuation["input"][2]["type"] == "function_call_output"
    assert json.loads(continuation["input"][2]["output"]) == {
        "executed": True,
        "actionCount": 1,
    }
    assert continuation["input"][3]["content"][1]["image_url"].endswith("YWZ0ZXI=")
    assert agent.last_response_id == "response-2"


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
