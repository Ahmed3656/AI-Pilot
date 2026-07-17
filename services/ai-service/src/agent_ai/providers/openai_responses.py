from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Mapping
from typing import Any, Protocol

from openai import AsyncOpenAI

from agent_ai.browser.safety import PauseRequired
from agent_ai.browser.selenium_remote import BrowserActionExecutor
from agent_ai.models import Category, PauseReason
from agent_ai.workflows.specs import workflow_instructions


class ResponsesClient(Protocol):
    responses: Any


DiscoverySink = Callable[[str, dict[str, Any]], Awaitable[None]]


def _value(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, Mapping):
        return item.get(key, default)
    return getattr(item, key, default)


def _as_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if hasattr(value, "model_dump"):
        return value.model_dump(exclude_none=True)
    keys = (
        "type",
        "x",
        "y",
        "text",
        "keys",
        "scroll_x",
        "scroll_y",
        "url",
        "button",
        "path",
    )
    return {key: getattr(value, key) for key in keys if hasattr(value, key)}


def _safety_check_payload(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if hasattr(value, "model_dump"):
        return value.model_dump(exclude_none=True)
    return {
        key: item
        for key in ("id", "code", "message")
        if (item := getattr(value, key, None)) is not None
    }


_DISCOVERY_TOOL = {
    "type": "function",
    "name": "record_dealpilot_discovery",
    "description": (
        "Record a merchant attempt, partial offer, coupon result, or warning immediately when "
        "it is observed. Do not wait for the final response. Never include secrets or "
        "screenshot bytes."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "kind": {
                "type": "string",
                "enum": ["merchant_attempt", "offer", "coupon", "warning"],
            },
            "data": {"type": "object", "additionalProperties": True},
        },
        "required": ["kind", "data"],
        "additionalProperties": False,
    },
    "strict": False,
}


class OpenAIComputerAgent:
    """GA Responses computer loop with persistent response-chain state."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str = "gpt-5.6",
        max_steps: int = 80,
        client: ResponsesClient | None = None,
    ) -> None:
        self.model = model
        self.max_steps = max_steps
        self.client = client or AsyncOpenAI(api_key=api_key)
        self.previous_response_id: str | None = None
        self.steps = 0

    @property
    def tools(self) -> list[dict[str, Any]]:
        return [{"type": "web_search"}, {"type": "computer"}, _DISCOVERY_TOOL]

    async def run(
        self,
        *,
        query: str,
        category: Category,
        executor: BrowserActionExecutor,
        address_handle: str | None = None,
        discovery_sink: DiscoverySink | None = None,
    ) -> str:
        address_note = (
            "An approved address grant is available. Enter address values only through these "
            "semantic placeholders: {{secret:recipientName}}, {{secret:mobileNumber}}, "
            "{{secret:governorate}}, {{secret:cityOrArea}}, {{secret:street}}, "
            "{{secret:building}}, {{secret:floor}}, {{secret:apartment}}, "
            "{{secret:landmark}}, and {{secret:postalCode}}."
            if address_handle
            else "No address grant is available. If a verified total requires an address, focus "
            "the appropriate field and use {{secret:street}} so the harness pauses for consent."
        )
        initial_screenshot = await executor.capture()
        response = await self.client.responses.create(
            model=self.model,
            instructions=workflow_instructions(category),
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": f"User request:\n{query}\n\n{address_note}"},
                        {
                            "type": "input_image",
                            "image_url": initial_screenshot,
                            "detail": "original",
                        },
                    ],
                }
            ],
            tools=self.tools,
            truncation="auto",
        )
        self.previous_response_id = str(_value(response, "id"))
        while True:
            output_items = list(_value(response, "output", []) or [])
            tool_outputs: list[dict[str, Any]] = []
            for item in output_items:
                item_type = _value(item, "type")
                if item_type == "function_call" and _value(item, "name") == (
                    "record_dealpilot_discovery"
                ):
                    result = await self._record_discovery(item, discovery_sink)
                    tool_outputs.append(
                        {
                            "type": "function_call_output",
                            "call_id": _value(item, "call_id", _value(item, "id")),
                            "output": json.dumps(result),
                        }
                    )
                elif item_type == "computer_call":
                    tool_outputs.append(await self._handle_computer_call(item, executor))
            if not tool_outputs:
                output_text = _value(response, "output_text", "")
                if not output_text:
                    raise RuntimeError("Responses API returned neither tool calls nor text")
                return str(output_text)
            response = await self.client.responses.create(
                model=self.model,
                previous_response_id=self.previous_response_id,
                input=tool_outputs,
                tools=self.tools,
                truncation="auto",
            )
            self.previous_response_id = str(_value(response, "id"))

    async def _handle_computer_call(
        self, call: Any, executor: BrowserActionExecutor
    ) -> dict[str, Any]:
        safety_checks = _value(call, "pending_safety_checks", []) or []
        if safety_checks:
            messages = [str(_value(check, "message", "")) for check in safety_checks]
            await executor.pause_for_safety(
                PauseRequired(
                    PauseReason.BROWSER_WARNING,
                    f"OpenAI computer safety check requires review: {'; '.join(messages)}",
                )
            )
        actions = list(_value(call, "actions", []) or [])
        if not actions:
            legacy_action = _value(call, "action")
            if legacy_action:
                actions = [legacy_action]
        screenshot_url = ""
        for raw_action in actions:
            self.steps += 1
            if self.steps > self.max_steps:
                raise RuntimeError("Maximum computer-action steps exceeded")
            screenshot_url = await executor.execute(_as_mapping(raw_action))
        if not screenshot_url:
            screenshot_url = await executor.capture()
        result: dict[str, Any] = {
            "type": "computer_call_output",
            "call_id": _value(call, "call_id", _value(call, "id")),
            "output": {
                "type": "computer_screenshot",
                "image_url": screenshot_url,
                "detail": "original",
            },
        }
        if safety_checks:
            result["acknowledged_safety_checks"] = [
                _safety_check_payload(check) for check in safety_checks
            ]
        return result

    @staticmethod
    async def _record_discovery(item: Any, discovery_sink: DiscoverySink | None) -> dict[str, Any]:
        try:
            arguments = json.loads(str(_value(item, "arguments", "{}")))
        except json.JSONDecodeError:
            return {"recorded": False, "reason": "invalid_json"}
        kind = arguments.get("kind")
        data = arguments.get("data")
        if kind not in {"merchant_attempt", "offer", "coupon", "warning"} or not isinstance(
            data, dict
        ):
            return {"recorded": False, "reason": "invalid_payload"}
        if discovery_sink is not None:
            await discovery_sink(kind, data)
        return {"recorded": True}
