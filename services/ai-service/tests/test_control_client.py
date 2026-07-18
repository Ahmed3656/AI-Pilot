from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from agent_ai.models import RunStatus
from agent_ai.orchestrator.control_client import ControlAPIClient


@pytest.mark.asyncio
async def test_frozen_event_envelope_and_secret_resolution_use_internal_token() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/secrets/resolve"):
            return httpx.Response(200, json={"value": "secret address"})
        return httpx.Response(202, json={"accepted": True, "duplicate": False})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        control = ControlAPIClient("https://control.internal", "shared-token", client=http)
        event_id = await control.emit(
            "run-1",
            "run.warning",
            {
                "code": "TEST",
                "message": "safe",
                "merchantAttemptId": None,
                "evidenceIds": [],
            },
            status=RunStatus.COMPARING,
        )
        value = await control.resolve_secret("grant-reference", "run-1", "talabat.com", "street")
        await control.upload_evidence("run-1", "evidence:one", b"png-bytes")

    assert value == "secret address"
    assert [request.url.path for request in requests] == [
        "/internal/v1/ai-events",
        "/internal/v1/secrets/resolve",
        "/internal/v1/evidence/run-1/evidence:one",
    ]
    assert requests[2].url.raw_path.endswith(b"/evidence%3Aone")
    assert all(request.headers["X-Internal-Token"] == "shared-token" for request in requests)
    event_body = json.loads(requests[0].content)
    assert set(event_body) == {"id", "runId", "type", "status", "timestamp", "payload"}
    assert event_body["id"] == event_id
    assert event_body["type"] == "run.warning"
    assert event_body["status"] == "comparing"
    assert event_body["timestamp"].endswith("Z")
    secret_body = json.loads(requests[1].content)
    assert secret_body == {
        "runId": "run-1",
        "secretReference": "grant-reference",
        "merchantDomain": "talabat.com",
        "field": "street",
    }
    assert b"png-bytes" in requests[2].content
    assert requests[2].headers["content-type"].startswith("multipart/form-data;")


@pytest.mark.asyncio
async def test_event_vocabulary_is_frozen_and_secrets_are_not_emitted() -> None:
    event_bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/secrets/resolve"):
            return httpx.Response(200, json={"value": "private address"})
        event_bodies.append(json.loads(request.content))
        return httpx.Response(202, json={"accepted": True, "duplicate": False})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        control = ControlAPIClient("https://control.internal", "token", client=http)
        await control.resolve_secret("grant", "run-1", "amazon.eg", "street")
        await control.emit(
            "run-1",
            "run.warning",
            {
                "code": "SAFE",
                "message": "grant",
                "merchantAttemptId": None,
                "evidenceIds": [],
            },
            status=RunStatus.PAUSED,
        )
        with pytest.raises(ValueError, match="frozen event"):
            await control.emit("run-1", "progress", {}, status=RunStatus.COMPARING)
    assert "private address" not in str(event_bodies)
