from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Mapping
from typing import Any, Protocol

from openai import AsyncOpenAI

from agent_ai.browser.selenium_remote import BrowserActionExecutor
from agent_ai.models import Category
from agent_ai.workflows.specs import workflow_instructions


class ResponsesClient(Protocol):
    responses: Any


DiscoverySink = Callable[[str, dict[str, Any]], Awaitable[None]]


def _value(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, Mapping):
        return item.get(key, default)
    return getattr(item, key, default)


_COMPUTER_TOOL = {
    "type": "function",
    "name": "dealpilot_computer",
    "description": (
        "Operate the current 1280x800 Selenium Chromium page. Coordinates refer to the "
        "latest screenshot. Prefer one action at a time when the page may change. Navigation "
        "is limited by the harness to the category allowlist; payment, authentication, card, "
        "CAPTCHA, and other unsafe actions are blocked or paused by the harness."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "actions": {
                "type": "array",
                "minItems": 1,
                "maxItems": 8,
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": [
                                "click",
                                "double_click",
                                "type",
                                "keypress",
                                "scroll",
                                "move",
                                "drag",
                                "screenshot",
                                "wait",
                                "navigate",
                            ],
                        },
                        "x": {"type": "integer"},
                        "y": {"type": "integer"},
                        "text": {"type": "string"},
                        "keys": {"type": "array", "items": {"type": "string"}},
                        "scroll_x": {"type": "integer"},
                        "scroll_y": {"type": "integer"},
                        "url": {"type": "string"},
                        "button": {
                            "type": "string",
                            "enum": ["left", "right"],
                        },
                        "seconds": {"type": "number", "minimum": 0, "maximum": 10},
                        "path": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "x": {"type": "integer"},
                                    "y": {"type": "integer"},
                                },
                                "required": ["x", "y"],
                                "additionalProperties": False,
                            },
                        },
                        "creates_seat_hold": {"type": "boolean"},
                        "hold_expires_at": {"type": "string"},
                    },
                    "required": ["type"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["actions"],
        "additionalProperties": False,
    },
    "strict": False,
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


class OpenRouterComputerAgent:
    """Stateless OpenRouter Responses loop backed by standard function tools."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str = "openai/gpt-5.2",
        max_steps: int = 80,
        client: ResponsesClient | None = None,
        base_url: str = "https://openrouter.ai/api/v1",
        timeout_seconds: float = 30.0,
    ) -> None:
        self.model = model
        self.max_steps = max_steps
        self.client = client or AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout_seconds,
        )
        self.last_response_id: str | None = None
        self.steps = 0

    @property
    def tools(self) -> list[dict[str, Any]]:
        return [_COMPUTER_TOOL, _DISCOVERY_TOOL]

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
        history: list[Any] = [
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
        ]
        while True:
            response = await self.client.responses.create(
                model=self.model,
                instructions=workflow_instructions(category),
                input=list(history),
                tools=self.tools,
                truncation="auto",
            )
            self.last_response_id = str(_value(response, "id"))
            output_items = list(_value(response, "output", []) or [])
            history.extend(output_items)
            tool_outputs: list[dict[str, Any]] = []
            screenshots: list[str] = []
            for item in output_items:
                if _value(item, "type") != "function_call":
                    continue
                name = _value(item, "name")
                if name == "record_dealpilot_discovery":
                    result = await self._record_discovery(item, discovery_sink)
                    tool_outputs.append(self._function_output(item, result))
                elif name == "dealpilot_computer":
                    result, screenshot = await self._handle_computer_call(item, executor)
                    tool_outputs.append(self._function_output(item, result))
                    screenshots.append(screenshot)
            if not tool_outputs:
                output_text = _value(response, "output_text", "")
                if not output_text:
                    raise RuntimeError("OpenRouter Responses returned neither tool calls nor text")
                return str(output_text)
            history.extend(tool_outputs)
            for screenshot in screenshots:
                history.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": "Current browser state after the requested action(s):",
                            },
                            {
                                "type": "input_image",
                                "image_url": screenshot,
                                "detail": "original",
                            },
                        ],
                    }
                )

    async def _handle_computer_call(
        self, call: Any, executor: BrowserActionExecutor
    ) -> tuple[dict[str, Any], str]:
        try:
            arguments = json.loads(str(_value(call, "arguments", "{}")))
        except json.JSONDecodeError as exc:
            raise RuntimeError("OpenRouter returned invalid computer-tool JSON") from exc
        actions = arguments.get("actions")
        if not isinstance(actions, list) or not actions:
            raise RuntimeError("OpenRouter computer-tool call did not include actions")
        screenshot_url = ""
        for raw_action in actions:
            if not isinstance(raw_action, Mapping):
                raise RuntimeError("OpenRouter computer-tool action must be an object")
            self.steps += 1
            if self.steps > self.max_steps:
                raise RuntimeError("Maximum computer-action steps exceeded")
            screenshot_url = await executor.execute(dict(raw_action))
        if not screenshot_url:
            screenshot_url = await executor.capture()
        return {"executed": True, "actionCount": len(actions)}, screenshot_url

    @staticmethod
    def _function_output(item: Any, result: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": "function_call_output",
            "call_id": _value(item, "call_id", _value(item, "id")),
            "output": json.dumps(result),
        }

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
