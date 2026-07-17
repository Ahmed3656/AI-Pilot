from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi.testclient import TestClient

from agent_ai.main import app
from agent_ai.models import Category, RunStatus
from agent_ai.schemas.runs import RunCreateRequest, RunResponse


class FakeManager:
    def __init__(self) -> None:
        self.started: list[str] = []
        self.commands: list[Any] = []

    @staticmethod
    def response(status: RunStatus = RunStatus.CREATED) -> RunResponse:
        now = datetime.now(UTC)
        return RunResponse(
            id="run-1",
            run_id="run-1",
            status=status,
            category=Category.FOOD,
            created_at=now,
            updated_at=now,
        )

    async def create_run(self, _: Any) -> RunResponse:
        return self.response()

    async def start(self, run_id: str) -> None:
        self.started.append(run_id)

    async def command(self, run_id: str, command: Any) -> RunResponse:
        self.commands.append((run_id, command))
        return self.response(RunStatus.CANCELLED)

    async def aclose(self) -> None:
        return None


def test_internal_run_endpoints_require_token_and_dispatch(monkeypatch: Any) -> None:
    manager = FakeManager()
    monkeypatch.setattr(app.state, "run_manager", manager)
    monkeypatch.setattr(app.state.settings, "internal_token", "internal-test-token")
    with TestClient(app) as client:
        unauthorized = client.post("/internal/v1/runs", json={"query": "طلب وجبة برجر"})
        assert unauthorized.status_code == 401

        created = client.post(
            "/internal/v1/runs",
            headers={"X-Internal-Token": "internal-test-token"},
            json={"query": "طلب وجبة برجر", "locale": "ar"},
        )
        assert created.status_code == 202
        assert created.json()["id"] == "run-1"
        assert created.json()["run_id"] == "run-1"
        assert manager.started == ["run-1"]

        commanded = client.post(
            "/internal/v1/runs/run-1/commands",
            headers={"X-Internal-Token": "internal-test-token"},
            json={"command": "cancel"},
        )
        assert commanded.status_code == 200
        assert commanded.json()["status"] == "cancelled"


def test_control_plane_camel_case_request_and_address_literal_rejection() -> None:
    request = RunCreateRequest.model_validate(
        {
            "runId": "control-run-1",
            "category": "retail",
            "query": "Find the best exact phone",
            "market": "EG",
            "currency": "EGP",
        }
    )
    assert request.run_id == "control-run-1"
    assert request.category is Category.RETAIL

    try:
        RunCreateRequest.model_validate(
            {"query": "Order a meal", "constraints": {"delivery_address": "secret street"}}
        )
    except ValueError as exc:
        assert "address_handle" in str(exc)
    else:
        raise AssertionError("A literal address constraint must be rejected")
