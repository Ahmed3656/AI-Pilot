from __future__ import annotations

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

    async def capture(self) -> str:
        return "data:image/png;base64,aW5pdGlhbA=="

    async def execute(self, action: dict[str, Any]) -> str:
        self.actions.append(action)
        return "data:image/png;base64,YWZ0ZXI="


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
    }
    assert responses.calls[0]["input"][0]["content"][1]["type"] == "input_image"
    assert "{{secret:street}}" in responses.calls[0]["input"][0]["content"][0]["text"]
    assert executor.actions == [{"type": "screenshot"}]
    assert responses.calls[1]["previous_response_id"] == "response-1"
    assert responses.calls[1]["input"][0]["type"] == "computer_call_output"
