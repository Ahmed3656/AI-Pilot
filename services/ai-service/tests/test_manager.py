from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest

from agent_ai.browser import PauseRequired
from agent_ai.config.settings import Settings
from agent_ai.models import Category, PauseReason, RequestedCategory, RunStatus
from agent_ai.orchestrator.manager import (
    IdempotencyConflictError,
    RunBusyError,
    RunManager,
)
from agent_ai.schemas.runs import InternalCommandRequest, InternalCreateRunRequest


class FakeControl:
    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any], RunStatus | None]] = []

    async def emit(
        self,
        run_id: str,
        event_type: str,
        payload: dict[str, Any],
        *,
        status: RunStatus | None = None,
        **_: Any,
    ) -> str:
        self.events.append((run_id, event_type, payload, status))
        return f"event-{len(self.events)}"

    async def resolve_secret(self, *_: Any) -> str:
        return "resolved"


class FakeBrowser:
    def __init__(self, session_id: str = "selenium-session-1") -> None:
        self.urls: list[str] = []
        self.expected_domain: str | None = None
        self.closed = False
        self.connect_count = 0
        self.driver = SimpleNamespace(session_id=session_id)

    @property
    def session_id(self) -> str | None:
        return None if self.closed else str(self.driver.session_id)

    def connect(self) -> None:
        self.connect_count += 1

    def navigate(
        self,
        url: str,
        category: Category,
        approved_domains: set[str],
        *,
        separate_tab: bool = False,
    ) -> None:
        assert category is Category.RETAIL
        assert separate_tab is True
        domain = url.split("/")[2].removeprefix("www.")
        assert domain in approved_domains
        self.urls.append(url)
        self.expected_domain = domain

    def close(self) -> None:
        self.closed = True

    def guard(self, category: Category, approved_domains: set[str]) -> None:
        assert category is Category.RETAIL
        assert self.expected_domain in approved_domains


class CaptchaBrowser(FakeBrowser):
    def __init__(self) -> None:
        super().__init__()
        self.captcha_solved = False

    def navigate(self, *args: Any, **kwargs: Any) -> None:
        super().navigate(*args, **kwargs)
        raise PauseRequired(PauseReason.CAPTCHA, "CAPTCHA/human verification detected")

    def guard(self, category: Category, approved_domains: set[str]) -> None:
        super().guard(category, approved_domains)
        if not self.captcha_solved:
            raise PauseRequired(PauseReason.CAPTCHA, "CAPTCHA/human verification detected")


class FakeAgent:
    last_response_id = "response-chain-1"

    async def run(self, **kwargs: Any) -> str:
        discovery_sink = kwargs["discovery_sink"]
        await discovery_sink(
            "offer",
            {
                "merchant": "Amazon Egypt",
                "title": "Partial exact phone",
                "valid": True,
                "evidence_ids": ["evidence:offer"],
            },
        )
        return json.dumps(
            {
                "candidates": [
                    {
                        "merchant": "Amazon Egypt",
                        "title": "Exact phone",
                        "url": "https://www.amazon.eg/item",
                        "exact_match": True,
                        "valid": True,
                        "subtotal": "1000.00",
                        "delivery_fee": "25.00",
                        "service_fee": "0.00",
                        "booking_fee": "0.00",
                        "tax": "0.00",
                        "mandatory_fees": [],
                        "discount": "0.00",
                        "total": "1025.00",
                        "currency": "EGP",
                        "evidence_ids": ["evidence:offer"],
                        "details": {
                            "brand": "Brand",
                            "model": "X",
                            "variant": "128 GB",
                            "storage": "128 GB",
                            "size": "not applicable",
                            "color": "black",
                            "quantity": 1,
                            "stock": True,
                            "seller_condition": "new",
                            "delivery_estimate": "tomorrow",
                        },
                    }
                ],
                "coupon_attempts": [],
                "stopped_before": "payment",
                "notes": [],
            }
        )


class PartialThenFailAgent(FakeAgent):
    async def run(self, **kwargs: Any) -> str:
        await kwargs["discovery_sink"](
            "offer",
            {
                "merchant": "Amazon Egypt",
                "title": "Useful partial offer",
                "valid": False,
                "incomplete_reason": "delivery fee unavailable",
                "evidence_ids": ["evidence:partial"],
            },
        )
        raise RuntimeError("later merchant failed")


class FailAgent(FakeAgent):
    async def run(self, **_: Any) -> str:
        raise RuntimeError("provider failed before producing results")


def _request(run_id: str = "run-1", query: str = "Find an exact phone") -> Any:
    return InternalCreateRunRequest.model_validate(
        {
            "runId": run_id,
            "query": query,
            "requestedCategory": "retail",
            "locale": "en-EG",
            "market": "EG",
            "currency": "EGP",
            "timezone": "Africa/Cairo",
            "browserExpiresAt": (datetime.now(UTC) + timedelta(hours=1))
            .isoformat()
            .replace("+00:00", "Z"),
        }
    )


def _command(
    command_id: str, run_id: str, name: str, payload: dict[str, Any]
) -> InternalCommandRequest:
    return InternalCommandRequest.model_validate(
        {
            "id": command_id,
            "runId": run_id,
            "name": name,
            "issuedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "payload": payload,
        }
    )


async def _wait_for_status(manager: RunManager, run_id: str, status: RunStatus) -> None:
    for _ in range(500):
        if manager.get_record(run_id).status is status:
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"Run did not reach {status}")


@pytest.mark.asyncio
async def test_browser_identity_survives_full_handoff_control_and_resume_lifecycle() -> None:
    control = FakeControl()
    browser = FakeBrowser()
    manager = RunManager(
        Settings(internal_token="token", openrouter_api_key="fake"),
        control,  # type: ignore[arg-type]
        agent_factory=FakeAgent,
        browser_factory=lambda: browser,  # type: ignore[arg-type,return-value]
    )
    created = await manager.create_run(_request(), "run-1")
    assert created.duplicate is False
    assert browser.connect_count == 0
    session_id = browser.session_id
    await manager.start("run-1")
    await _wait_for_status(manager, "run-1", RunStatus.AWAITING_DOMAIN_APPROVAL)
    assert browser.connect_count == 1
    record = manager.get_record("run-1")
    domain_event = next(
        payload
        for _, event_type, payload, _ in control.events
        if event_type == "domains.approval_required"
    )
    assert [candidate["id"] for candidate in domain_event["candidates"]] == [
        "amazon-eg",
        "jumia-eg",
        "noon-eg",
    ]
    await manager.command(
        "run-1",
        _command(
            "approve-1",
            "run-1",
            "approve_domains",
            {
                "approvalId": "approval-1",
                "requestId": record.domain_request_id,
                "domains": ["amazon.eg"],
            },
        ),
        "approve-1",
    )
    await _wait_for_status(manager, "run-1", RunStatus.READY_FOR_HANDOFF)

    assert browser.urls == ["https://www.amazon.eg/s?k=Find+an+exact+phone"]
    assert browser.closed is False
    assert browser.session_id == session_id
    assert record.agent.last_response_id == "response-chain-1"
    event_types = [event_type for _, event_type, _, _ in control.events]
    assert event_types.index("report.updated") < event_types.index("run.status_changed")
    transition = next(
        payload
        for _, event_type, payload, _ in control.events
        if event_type == "run.status_changed"
    )
    assert transition == {
        "from": "comparing",
        "to": "ready_for_handoff",
        "reasonCode": None,
    }

    await manager.command(
        "run-1",
        _command("claim-1", "run-1", "pause", {"reason": "control_claim"}),
        "claim-1",
    )
    assert record.status is RunStatus.USER_TAKEOVER
    assert browser.session_id == session_id
    assert browser.closed is False

    await manager.command(
        "run-1",
        _command("release-1", "run-1", "resume", {"reason": "control_release"}),
        "release-1",
    )
    assert record.status is RunStatus.READY_FOR_HANDOFF
    assert record.active_event.is_set()
    assert browser.session_id == session_id

    await manager.command(
        "run-1",
        _command(
            "complete-1",
            "run-1",
            "complete",
            {"reason": "user_finished", "reportId": "report-1"},
        ),
        "complete-1",
    )
    assert record.status is RunStatus.COMPLETED
    assert browser.closed is True
    assert record.address_handle is None
    assert any(event_type == "offer.recorded" for _, event_type, _, _ in control.events)


@pytest.mark.asyncio
async def test_captcha_pause_allows_takeover_then_continues_same_attempt() -> None:
    control = FakeControl()
    browser = CaptchaBrowser()
    manager = RunManager(
        Settings(internal_token="token", openrouter_api_key="fake"),
        control,  # type: ignore[arg-type]
        agent_factory=FakeAgent,
        browser_factory=lambda: browser,  # type: ignore[arg-type,return-value]
    )
    await manager.create_run(_request(), "run-1")
    await manager.start("run-1")
    await _wait_for_status(manager, "run-1", RunStatus.AWAITING_DOMAIN_APPROVAL)
    record = manager.get_record("run-1")
    await manager.command(
        "run-1",
        _command(
            "approve-1",
            "run-1",
            "approve_domains",
            {
                "approvalId": "approval-1",
                "requestId": record.domain_request_id,
                "domains": ["amazon.eg"],
            },
        ),
        "approve-1",
    )
    await _wait_for_status(manager, "run-1", RunStatus.PAUSED)

    await manager.command(
        "run-1",
        _command("claim-1", "run-1", "pause", {"reason": "control_claim"}),
        "claim-1",
    )
    assert record.status is RunStatus.USER_TAKEOVER
    browser.captcha_solved = True
    await manager.command(
        "run-1",
        _command("release-1", "run-1", "resume", {"reason": "control_release"}),
        "release-1",
    )
    await _wait_for_status(manager, "run-1", RunStatus.READY_FOR_HANDOFF)

    completions = [
        payload
        for _, event_type, payload, _ in control.events
        if event_type == "merchant.attempt_completed"
    ]
    assert completions == [
        {
            "attemptId": record.attempts["amazon.eg"].id,
            "outcome": "succeeded",
            "failureCode": None,
            "evidenceIds": [],
        }
    ]
    await manager.aclose()


@pytest.mark.asyncio
async def test_one_active_run_busy_response_and_idempotent_create() -> None:
    manager = RunManager(
        Settings(internal_token="token", openrouter_api_key="fake"),
        FakeControl(),  # type: ignore[arg-type]
        agent_factory=FakeAgent,
        browser_factory=FakeBrowser,  # type: ignore[arg-type]
    )
    first_request = _request("run-1")
    first = await manager.create_run(first_request, "run-1")
    duplicate = await manager.create_run(first_request, "run-1")
    assert first.duplicate is False
    assert duplicate.duplicate is True
    with pytest.raises(IdempotencyConflictError):
        await manager.create_run(_request("run-1", "Different exact phone"), "run-1")
    with pytest.raises(RunBusyError):
        await manager.create_run(_request("run-2"), "run-2")
    await manager.command(
        "run-1",
        _command("cancel-1", "run-1", "cancel", {"reason": "test"}),
        "cancel-1",
    )
    second = await manager.create_run(_request("run-2"), "run-2")
    assert second.accepted is True
    await manager.aclose()


@pytest.mark.asyncio
async def test_ttl_is_terminal_and_closes_the_only_session() -> None:
    browser = FakeBrowser()
    manager = RunManager(
        Settings(internal_token="token", openrouter_api_key="fake"),
        FakeControl(),  # type: ignore[arg-type]
        agent_factory=FakeAgent,
        browser_factory=lambda: browser,  # type: ignore[arg-type,return-value]
    )
    await manager.create_run(_request(), "run-1")
    await manager.expire_now("run-1")
    record = manager.get_record("run-1")
    assert record.status is RunStatus.FAILED
    assert record.error == "Browser TTL expired"
    assert browser.closed is True


@pytest.mark.asyncio
async def test_service_shutdown_transitions_run_to_terminal_before_close() -> None:
    browser = FakeBrowser()
    control = FakeControl()
    manager = RunManager(
        Settings(internal_token="token", openrouter_api_key="fake"),
        control,  # type: ignore[arg-type]
        agent_factory=FakeAgent,
        browser_factory=lambda: browser,  # type: ignore[arg-type,return-value]
    )
    await manager.create_run(_request(), "run-1")
    await manager.aclose()
    record = manager.get_record("run-1")
    assert record.status is RunStatus.FAILED
    assert browser.closed is True
    failed = [payload for _, event_type, payload, _ in control.events if event_type == "run.failed"]
    assert failed[-1]["failureCode"] == "AI_SERVICE_SHUTDOWN"


@pytest.mark.asyncio
async def test_incremental_coupon_event_values_are_contract_safe() -> None:
    control = FakeControl()
    manager = RunManager(
        Settings(internal_token="token", openrouter_api_key="fake"),
        control,  # type: ignore[arg-type]
        agent_factory=FakeAgent,
        browser_factory=FakeBrowser,  # type: ignore[arg-type]
    )
    await manager.create_run(_request(), "run-1")
    record = manager.get_record("run-1")
    await manager._emit_coupon(  # noqa: SLF001 - focused contract boundary test
        record,
        {
            "coupon_attempt_id": "coupon-1",
            "offer_id": "offer-1",
            "status": "invented-status",
            "rejection_reason": "invented-reason",
        },
    )
    await manager._emit_coupon(  # noqa: SLF001 - focused contract boundary test
        record,
        {
            "coupon_attempt_id": "coupon-2",
            "offer_id": "offer-1",
            "rejection_reason": "technical_failure",
        },
    )
    payloads = [
        payload for _, event_type, payload, _ in control.events if event_type == "coupon.attempted"
    ]
    assert payloads[0]["status"] == "rejected"
    assert payloads[0]["rejectionReason"] == "unknown"
    assert payloads[1]["status"] == "technical_failure"
    assert payloads[1]["rejectionReason"] == "technical_failure"
    await manager.aclose()


@pytest.mark.asyncio
async def test_failed_clarification_event_can_be_retried_idempotently() -> None:
    class FlakyControl(FakeControl):
        def __init__(self) -> None:
            super().__init__()
            self.failed_once = False

        async def emit(self, *args: Any, **kwargs: Any) -> str:
            if not self.failed_once:
                self.failed_once = True
                raise RuntimeError("temporary event dependency failure")
            return await super().emit(*args, **kwargs)

    request = _request(query="Find something")
    request.requested_category = RequestedCategory.AUTO
    control = FlakyControl()
    manager = RunManager(
        Settings(internal_token="token", openrouter_api_key="fake"),
        control,  # type: ignore[arg-type]
        agent_factory=FakeAgent,
        browser_factory=FakeBrowser,  # type: ignore[arg-type]
    )
    await manager.create_run(request, "run-1")
    with pytest.raises(RuntimeError, match="temporary event dependency failure"):
        await manager.start("run-1")
    assert manager.get_record("run-1").clarification_request_id is None
    await manager.start("run-1")
    assert manager.get_record("run-1").clarification_request_id is not None
    await manager.aclose()


@pytest.mark.asyncio
async def test_clarification_accepts_authoritative_control_plane_request_id() -> None:
    request = _request(query="Help me compare something")
    request.requested_category = RequestedCategory.AUTO
    manager = RunManager(
        Settings(internal_token="token", openrouter_api_key="fake"),
        FakeControl(),  # type: ignore[arg-type]
        agent_factory=FakeAgent,
        browser_factory=FakeBrowser,  # type: ignore[arg-type]
    )
    await manager.create_run(request, "run-1")
    await manager.start("run-1")
    ai_request_id = manager.get_record("run-1").clarification_request_id
    assert ai_request_id is not None

    await manager.command(
        "run-1",
        _command(
            "clarify-1",
            "run-1",
            "clarify",
            {
                "requestId": "api-owned-request-id",
                "answers": {"category": "retail"},
            },
        ),
        "clarify-1",
    )

    record = manager.get_record("run-1")
    assert record.category is Category.RETAIL
    await _wait_for_status(manager, "run-1", RunStatus.AWAITING_DOMAIN_APPROVAL)
    await manager.aclose()


@pytest.mark.asyncio
async def test_safety_pause_transitions_before_warning_without_failing_run() -> None:
    control = FakeControl()
    manager = RunManager(
        Settings(internal_token="token", openrouter_api_key="fake"),
        control,  # type: ignore[arg-type]
        agent_factory=FakeAgent,
        browser_factory=FakeBrowser,  # type: ignore[arg-type]
    )
    await manager.create_run(_request(), "run-1")
    record = manager.get_record("run-1")
    record.status = RunStatus.COMPARING
    paused = asyncio.create_task(
        manager._pause_for_safety(  # noqa: SLF001 - focused event ordering regression
            record,
            PauseRequired(PauseReason.CAPTCHA, "CAPTCHA/human verification detected"),
        )
    )
    while len(control.events) < 2:
        await asyncio.sleep(0)

    assert [event_type for _, event_type, _, _ in control.events] == [
        "run.status_changed",
        "run.warning",
    ]
    assert all(status is RunStatus.PAUSED for *_, status in control.events)
    assert record.status is RunStatus.PAUSED
    assert record.error is None
    paused.cancel()
    await asyncio.gather(paused, return_exceptions=True)
    await manager.aclose()


@pytest.mark.asyncio
async def test_failed_run_finalizes_started_merchant_attempts() -> None:
    control = FakeControl()
    manager = RunManager(
        Settings(internal_token="token", openrouter_api_key="fake"),
        control,  # type: ignore[arg-type]
        agent_factory=FailAgent,
        browser_factory=FakeBrowser,  # type: ignore[arg-type]
    )
    await manager.create_run(_request(), "run-1")
    await manager.start("run-1")
    await _wait_for_status(manager, "run-1", RunStatus.AWAITING_DOMAIN_APPROVAL)
    record = manager.get_record("run-1")
    await manager.command(
        "run-1",
        _command(
            "approve-1",
            "run-1",
            "approve_domains",
            {
                "approvalId": "approval-1",
                "requestId": record.domain_request_id,
                "domains": ["amazon.eg"],
            },
        ),
        "approve-1",
    )
    await _wait_for_status(manager, "run-1", RunStatus.FAILED)

    event_types = [event_type for _, event_type, _, _ in control.events]
    assert event_types.index("merchant.attempt_completed") < event_types.index("run.failed")
    completed = [
        payload
        for _, event_type, payload, _ in control.events
        if event_type == "merchant.attempt_completed"
    ]
    assert completed == [
        {
            "attemptId": next(iter(record.attempts.values())).id,
            "outcome": "failed",
            "failureCode": "AI_RUN_FAILED",
            "evidenceIds": [],
        }
    ]
    await manager.aclose()


@pytest.mark.asyncio
async def test_late_merchant_failure_preserves_partial_offer_and_browser() -> None:
    browser = FakeBrowser()
    manager = RunManager(
        Settings(internal_token="token", openrouter_api_key="fake"),
        FakeControl(),  # type: ignore[arg-type]
        agent_factory=PartialThenFailAgent,
        browser_factory=lambda: browser,  # type: ignore[arg-type,return-value]
    )
    await manager.create_run(_request(), "run-1")
    await manager.start("run-1")
    await _wait_for_status(manager, "run-1", RunStatus.AWAITING_DOMAIN_APPROVAL)
    record = manager.get_record("run-1")
    await manager.command(
        "run-1",
        _command(
            "approve-1",
            "run-1",
            "approve_domains",
            {
                "approvalId": "approval-1",
                "requestId": record.domain_request_id,
                "domains": ["amazon.eg"],
            },
        ),
        "approve-1",
    )
    await _wait_for_status(manager, "run-1", RunStatus.READY_FOR_HANDOFF)
    assert record.result is not None
    assert record.result["candidates"][0]["title"] == "Useful partial offer"
    assert record.result["partial"] is True
    assert browser.closed is False
    await manager.aclose()
