from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from openai import AsyncOpenAI

from agent_ai.browser.safety import PauseRequired
from agent_ai.browser.selenium_remote import BrowserActionExecutor
from agent_ai.models import ApprovalType, Category
from agent_ai.workflows.specs import workflow_instructions


class ResponsesClient(Protocol):
    responses: Any


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


class OpenAIComputerAgent:
    """Responses API loop with server-side web search and local Selenium computer actions."""

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

    async def run(
        self,
        *,
        query: str,
        category: Category,
        executor: BrowserActionExecutor,
        address_handle: str | None = None,
    ) -> str:
        address_note = (
            "An approved address grant is available. Enter address values only through these "
            "semantic placeholders: {{secret:recipientName}}, {{secret:mobileNumber}}, "
            "{{secret:governorate}}, {{secret:cityOrArea}}, {{secret:street}}, "
            "{{secret:building}}, {{secret:floor}}, {{secret:apartment}}, "
            "{{secret:landmark}}, and {{secret:postalCode}}."
            if address_handle
            else "No address grant is available. If delivery checkout needs one, focus the "
            "address field and attempt {{secret:street}} so the harness can pause for consent."
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
                        {"type": "input_image", "image_url": initial_screenshot},
                    ],
                }
            ],
            tools=[{"type": "web_search"}, {"type": "computer"}],
            truncation="auto",
        )
        steps = 0
        while True:
            calls = [
                item
                for item in (_value(response, "output", []) or [])
                if _value(item, "type") == "computer_call"
            ]
            if not calls:
                output_text = _value(response, "output_text", "")
                if not output_text:
                    raise RuntimeError("Responses API returned neither computer actions nor text")
                return str(output_text)
            outputs: list[dict[str, Any]] = []
            for call in calls:
                safety_checks = _value(call, "pending_safety_checks", []) or []
                if safety_checks:
                    messages = [str(_value(check, "message", "")) for check in safety_checks]
                    raise PauseRequired(
                        ApprovalType.BROWSER_WARNING,
                        f"OpenAI computer safety check requires review: {'; '.join(messages)}",
                    )
                batched = _value(call, "actions") or [_value(call, "action", {})]
                screenshot_url = ""
                for raw_action in batched:
                    steps += 1
                    if steps > self.max_steps:
                        raise RuntimeError("Maximum computer-action steps exceeded")
                    screenshot_url = await executor.execute(_as_mapping(raw_action))
                outputs.append(
                    {
                        "type": "computer_call_output",
                        "call_id": _value(call, "call_id", _value(call, "id")),
                        "output": {
                            "type": "computer_screenshot",
                            "image_url": screenshot_url,
                        },
                    }
                )
            response = await self.client.responses.create(
                model=self.model,
                previous_response_id=_value(response, "id"),
                input=outputs,
                tools=[{"type": "web_search"}, {"type": "computer"}],
                truncation="auto",
            )
