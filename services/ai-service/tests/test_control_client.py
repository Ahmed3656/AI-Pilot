from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from agent_ai.orchestrator.control_client import ControlAPIClient


@pytest.mark.asyncio
async def test_control_events_and_secret_resolution_use_internal_token() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/secrets/resolve"):
            return httpx.Response(200, json={"value": "secret address"})
        return httpx.Response(204)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        control = ControlAPIClient(
            "https://control.internal",
            "shared-token",
            client=http,
        )
        await control.emit("run-1", "progress", {"step": 1})
        value = await control.resolve_secret("delivery.home", "run-1")

    assert value == "secret address"
    assert [request.url.path for request in requests] == [
        "/internal/v1/ai-events",
        "/internal/v1/secrets/resolve",
    ]
    assert all(request.headers["X-Internal-Token"] == "shared-token" for request in requests)
    event_body = json.loads(requests[0].content)
    assert event_body["runId"] == "run-1"
    assert event_body["type"] == "run.state_changed"
    assert event_body["state"] == "comparing"
    assert event_body["eventId"].startswith("ai:")
    secret_body = json.loads(requests[1].content)
    assert secret_body == {
        "runId": "run-1",
        "secretReference": "delivery.home",
        "merchantDomain": "",
        "field": "street",
    }


@pytest.mark.asyncio
async def test_resolved_secret_is_not_returned_from_event_payload() -> None:
    event_bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/secrets/resolve"):
            return httpx.Response(200, json={"value": "private address"})
        event_bodies.append(json.loads(request.content))
        return httpx.Response(204)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        control = ControlAPIClient("https://control.internal", "token", client=http)
        await control.resolve_secret("delivery.home", "run-1")
        await control.emit("run-1", "progress", {"handle": "delivery.home"})
    assert "private address" not in str(event_bodies)
