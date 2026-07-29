from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from pydantic import ValidationError

from agent_ai.browser import SafetyViolation
from agent_ai.main import app
from agent_ai.orchestrator.manager import RunBusyError
from agent_ai.schemas.runs import (
    InternalCommandRequest,
    InternalCommandResponse,
    InternalCreateRunRequest,
    InternalCreateRunResponse,
)


class FakeManager:
    def __init__(self) -> None:
        self.started: list[str] = []
        self.commands: list[Any] = []

    async def create_run(
        self, request: InternalCreateRunRequest, idempotency_key: str
    ) -> InternalCreateRunResponse:
        assert idempotency_key == request.run_id
        return InternalCreateRunResponse(runId=request.run_id, duplicate=False)

    async def start(self, run_id: str) -> None:
        self.started.append(run_id)

    async def command(
        self, run_id: str, command: InternalCommandRequest, idempotency_key: str
    ) -> InternalCommandResponse:
        self.commands.append((run_id, command, idempotency_key))
        return InternalCommandResponse(id=command.id, runId=run_id, duplicate=False)

    async def aclose(self) -> None:
        return None


def _create_body() -> dict[str, Any]:
    return {
        "runId": "run-1",
        "query": "Order a burger meal",
        "requestedCategory": "auto",
        "locale": "en-EG",
        "market": "EG",
        "currency": "EGP",
        "timezone": "Africa/Cairo",
        "browserExpiresAt": (datetime.now(UTC) + timedelta(hours=1))
        .isoformat()
        .replace("+00:00", "Z"),
    }


def test_internal_run_endpoints_require_exact_auth_idempotency_and_dtos(
    monkeypatch: Any,
) -> None:
    manager = FakeManager()
    monkeypatch.setattr(app.state, "run_manager", manager)
    monkeypatch.setattr(app.state.settings, "internal_token", "internal-test-token")
    with TestClient(app) as client:
        unauthorized = client.post(
            "/internal/v1/runs",
            headers={"Idempotency-Key": "run-1"},
            json=_create_body(),
        )
        assert unauthorized.status_code == 401
        assert unauthorized.json()["error"]["code"] == "INVALID_INTERNAL_TOKEN"

        created = client.post(
            "/internal/v1/runs",
            headers={
                "X-Internal-Token": "internal-test-token",
                "Idempotency-Key": "run-1",
            },
            json=_create_body(),
        )
        assert created.status_code == 202
        assert created.json() == {"runId": "run-1", "accepted": True, "duplicate": False}
        assert manager.started == ["run-1"]

        command_body = {
            "id": "command-1",
            "runId": "run-1",
            "name": "cancel",
            "issuedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "payload": {"reason": None},
        }
        commanded = client.post(
            "/internal/v1/runs/run-1/commands",
            headers={
                "X-Internal-Token": "internal-test-token",
                "Idempotency-Key": "command-1",
            },
            json=command_body,
        )
        assert commanded.status_code == 202
        assert commanded.json() == {
            "id": "command-1",
            "runId": "run-1",
            "accepted": True,
            "duplicate": False,
        }


def test_contract_rejects_legacy_aliases_unknown_fields_and_non_egypt_values() -> None:
    valid = _create_body()
    request = InternalCreateRunRequest.model_validate(valid)
    assert request.run_id == "run-1"
    assert request.locale == "en-EG"
    snake_case = {
        "run_id": valid["runId"],
        "query": valid["query"],
        "requested_category": valid["requestedCategory"],
        "locale": valid["locale"],
        "market": valid["market"],
        "currency": valid["currency"],
        "timezone": valid["timezone"],
        "browser_expires_at": valid["browserExpiresAt"],
    }

    for invalid in (
        {**valid, "country": "EG"},
        {**valid, "market": "US"},
        {**valid, "currency": "USD"},
        {**valid, "locale": "en"},
        snake_case,
    ):
        try:
            InternalCreateRunRequest.model_validate(invalid)
        except ValidationError:
            pass
        else:
            raise AssertionError(f"Invalid contract input was accepted: {invalid}")

    issued_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    for invalid_command in (
        {
            "id": "c1",
            "runId": "run-1",
            "type": "pause",
            "issuedAt": issued_at,
            "payload": {"reason": "user"},
        },
        {
            "id": "c2",
            "runId": "run-1",
            "name": "pause_ai",
            "issuedAt": issued_at,
            "payload": {"reason": "user"},
        },
    ):
        try:
            InternalCommandRequest.model_validate(invalid_command)
        except ValidationError:
            pass
        else:
            raise AssertionError("A legacy command alias was accepted")


def test_second_active_run_gets_explicit_busy_retry_response(monkeypatch: Any) -> None:
    class BusyManager(FakeManager):
        async def create_run(
            self, request: InternalCreateRunRequest, idempotency_key: str
        ) -> InternalCreateRunResponse:
            raise RunBusyError("active-run", retry_after=7)

    monkeypatch.setattr(app.state, "run_manager", BusyManager())
    monkeypatch.setattr(app.state.settings, "internal_token", "internal-test-token")
    with TestClient(app) as client:
        response = client.post(
            "/internal/v1/runs",
            headers={
                "X-Internal-Token": "internal-test-token",
                "Idempotency-Key": "run-1",
            },
            json=_create_body(),
        )
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "7"
    assert response.json()["error"]["code"] == "RATE_LIMITED"
    assert "busy" in response.json()["error"]["message"]
    assert response.json()["error"]["details"] == [
        {
            "field": "runId",
            "code": "ACTIVE_RUN",
            "message": "active-run",
        }
    ]


def test_command_safety_rejection_and_dependency_failure_use_contract_errors(
    monkeypatch: Any,
) -> None:
    command_body = {
        "id": "command-1",
        "runId": "run-1",
        "name": "approve_domains",
        "issuedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "payload": {
            "approvalId": "approval-1",
            "requestId": "request-1",
            "domains": ["attacker.example"],
        },
    }
    headers = {
        "X-Internal-Token": "internal-test-token",
        "Idempotency-Key": "command-1",
    }

    class RejectManager(FakeManager):
        async def command(self, *_: Any) -> InternalCommandResponse:
            raise SafetyViolation("Approved domains are invalid")

    monkeypatch.setattr(app.state.settings, "internal_token", "internal-test-token")
    monkeypatch.setattr(app.state, "run_manager", RejectManager())
    with TestClient(app) as client:
        rejected = client.post(
            "/internal/v1/runs/run-1/commands", headers=headers, json=command_body
        )
    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "VALIDATION_ERROR"

    class FailedManager(FakeManager):
        async def command(self, *_: Any) -> InternalCommandResponse:
            raise RuntimeError("private dependency detail")

    monkeypatch.setattr(app.state, "run_manager", FailedManager())
    with TestClient(app) as client:
        failed = client.post("/internal/v1/runs/run-1/commands", headers=headers, json=command_body)
    assert failed.status_code == 503
    assert failed.json()["error"]["code"] == "DEPENDENCY_UNAVAILABLE"
    assert "private dependency detail" not in failed.text
