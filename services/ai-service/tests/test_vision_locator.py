from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

from agent_ai.vision import GeminiVisionFallbackLocator, OpenRouterVisionFallbackLocator


class FakeResponses:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return SimpleNamespace(
            output=[
                {
                    "type": "function_call",
                    "name": "report_visual_target",
                    "arguments": json.dumps(self.payload),
                }
            ],
            output_text="",
        )


@pytest.mark.asyncio
async def test_openrouter_vision_locator_returns_validated_replacement_target() -> None:
    responses = FakeResponses(
        {
            "status": "located",
            "x": 512,
            "y": 340,
            "label": "  Continue   checkout ",
            "confidence": 0.91,
        }
    )
    locator = OpenRouterVisionFallbackLocator(
        client=SimpleNamespace(responses=responses),
        model="fallback/ui-grounder",
    )

    target = await locator.locate(
        screenshot_url="data:image/png;base64,c2NyZWVuc2hvdA==",
        intended_target="Next",
        action_type="click",
    )

    assert target is not None
    assert (target.x, target.y, target.label, target.confidence) == (
        512,
        340,
        "Continue checkout",
        0.91,
    )
    assert responses.calls[0]["model"] == "fallback/ui-grounder"
    assert responses.calls[0]["input"][0]["content"][1]["type"] == "input_image"
    assert responses.calls[0]["tools"][0]["name"] == "report_visual_target"


@pytest.mark.asyncio
async def test_openrouter_vision_locator_rejects_low_confidence_and_out_of_bounds() -> None:
    low_confidence = OpenRouterVisionFallbackLocator(
        client=SimpleNamespace(
            responses=FakeResponses(
                {
                    "status": "located",
                    "x": 400,
                    "y": 300,
                    "label": "Continue",
                    "confidence": 0.4,
                }
            )
        ),
        model="fallback/ui-grounder",
    )
    out_of_bounds = OpenRouterVisionFallbackLocator(
        client=SimpleNamespace(
            responses=FakeResponses(
                {
                    "status": "located",
                    "x": 1280,
                    "y": 300,
                    "label": "Continue",
                    "confidence": 0.9,
                }
            )
        ),
        model="fallback/ui-grounder",
    )

    assert (
        await low_confidence.locate(
            screenshot_url="data:image/png;base64,AA==",
            intended_target="Next",
            action_type="click",
        )
        is None
    )
    assert (
        await out_of_bounds.locate(
            screenshot_url="data:image/png;base64,AA==",
            intended_target="Next",
            action_type="click",
        )
        is None
    )


class FakeGeminiResponse:
    status_code = 200

    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return {
            "steps": [
                {
                    "type": "model_output",
                    "content": [{"type": "text", "text": json.dumps(self.payload)}],
                }
            ]
        }


class FakeGeminiClient:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def post(self, url: str, **kwargs: Any) -> FakeGeminiResponse:
        self.calls.append((url, kwargs))
        return FakeGeminiResponse(self.payload)


@pytest.mark.asyncio
async def test_gemini_vision_locator_uses_direct_structured_image_request() -> None:
    client = FakeGeminiClient(
        {
            "status": "located",
            "x": 618,
            "y": 242,
            "label": "  Search products  ",
            "confidence": 0.88,
        }
    )
    locator = GeminiVisionFallbackLocator(
        api_key="gemini-secret",
        model="gemini-3-flash-preview",
        client=client,
    )

    target = await locator.locate(
        screenshot_url="data:image/png;base64,c2NyZWVuc2hvdA==",
        intended_target="Search",
        action_type="click",
    )

    assert target is not None
    assert (target.x, target.y, target.label, target.confidence) == (
        618,
        242,
        "Search products",
        0.88,
    )
    url, request = client.calls[0]
    assert url == "https://generativelanguage.googleapis.com/v1beta/interactions"
    assert request["headers"]["x-goog-api-key"] == "gemini-secret"
    assert request["json"]["model"] == "gemini-3-flash-preview"
    assert request["json"]["input"][0] == {
        "type": "image",
        "mime_type": "image/png",
        "data": "c2NyZWVuc2hvdA==",
    }
    assert request["json"]["response_format"]["mime_type"] == "application/json"


@pytest.mark.asyncio
async def test_gemini_vision_locator_rejects_invalid_image_and_unsafe_result() -> None:
    client = FakeGeminiClient(
        {
            "status": "human_required",
            "x": 0,
            "y": 0,
            "label": "",
            "confidence": 0,
        }
    )
    locator = GeminiVisionFallbackLocator(api_key="secret", client=client)

    assert (
        await locator.locate(
            screenshot_url="https://example.test/screenshot.png",
            intended_target="Continue",
            action_type="click",
        )
        is None
    )
    assert client.calls == []
    assert (
        await locator.locate(
            screenshot_url="data:image/png;base64,c2NyZWVuc2hvdA==",
            intended_target="Authorize",
            action_type="click",
        )
        is None
    )
