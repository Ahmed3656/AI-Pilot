from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from urllib.parse import quote_plus
from uuid import uuid4

from agent_ai.browser import (
    ALLOWED_DOMAINS,
    BrowserActionExecutor,
    PauseRequired,
    SafetyViolation,
    SeleniumRemoteBrowser,
)
from agent_ai.browser.safety import canonical_approved_domains
from agent_ai.config.settings import Settings
from agent_ai.models import (
    TERMINAL_STATUSES,
    ApprovalType,
    Category,
    PauseReason,
    RequestedCategory,
    RunStatus,
)
from agent_ai.orchestrator.classification import clarification_message, classify_request
from agent_ai.orchestrator.control_client import ControlAPIClient
from agent_ai.providers.deterministic_test import DeterministicProviderTestAdapter
from agent_ai.providers.openrouter_responses import OpenRouterComputerAgent
from agent_ai.schemas.runs import (
    CommandName,
    InternalCommandRequest,
    InternalCommandResponse,
    InternalCreateRunRequest,
    InternalCreateRunResponse,
)
from agent_ai.vision import GeminiVisionFallbackLocator, VisionFallbackLocator
from agent_ai.workflows import validate_agent_result

logger = logging.getLogger("uvicorn.error")


class ComputerAgent(Protocol):
    last_response_id: str | None

    async def run(
        self,
        *,
        query: str,
        category: Category,
        executor: BrowserActionExecutor,
        address_handle: str | None = None,
        discovery_sink: Callable[[str, dict[str, Any]], Any] | None = None,
    ) -> str: ...


class RunBusyError(RuntimeError):
    def __init__(self, active_run_id: str, retry_after: int = 5) -> None:
        self.active_run_id = active_run_id
        self.retry_after = retry_after
        super().__init__("The single MVP browser is busy with another active run")


class IdempotencyConflictError(RuntimeError):
    pass


class InvalidTransitionError(RuntimeError):
    pass


@dataclass(slots=True)
class IdempotencyRecord:
    fingerprint: str
    created_at: datetime
    error_kind: str | None = None
    error_message: str | None = None


@dataclass(slots=True)
class MerchantAttempt:
    id: str
    domain: str
    started: bool = False
    completed: bool = False
    evidence_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class RunRecord:
    request: InternalCreateRunRequest
    category: Category | None
    status: RunStatus
    browser_expires_at: datetime
    browser: SeleniumRemoteBrowser
    agent: ComputerAgent
    clarification_request_id: str | None = None
    domain_request_id: str | None = None
    address_request_id: str | None = None
    seat_request_id: str | None = None
    seat_offer_id: str | None = None
    approved_domains: set[str] = field(default_factory=set)
    address_handle: str | None = None
    address_domains: set[str] = field(default_factory=set)
    address_expires_at: datetime | None = None
    result: dict[str, Any] | None = None
    partial_offers: list[dict[str, Any]] = field(default_factory=list)
    partial_coupons: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)
    attempts: dict[str, MerchantAttempt] = field(default_factory=dict)
    resume_status: RunStatus | None = None
    error: str | None = None
    closed: bool = False
    active_event: asyncio.Event = field(default_factory=asyncio.Event)
    domains_event: asyncio.Event = field(default_factory=asyncio.Event)
    seat_future: asyncio.Future[bool] | None = None
    action_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    command_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    task: asyncio.Task[None] | None = None
    ttl_task: asyncio.Task[None] | None = None
    executor: BrowserActionExecutor | None = None
    emitted_offer_ids: set[str] = field(default_factory=set)
    emitted_coupon_ids: set[str] = field(default_factory=set)

    @property
    def run_id(self) -> str:
        return self.request.run_id


_START_URLS: dict[Category, dict[str, str]] = {
    Category.RETAIL: {
        "amazon.eg": "https://www.amazon.eg/",
        "jumia.com.eg": "https://www.jumia.com.eg/",
        "noon.com": "https://www.noon.com/egypt-en/",
    },
    Category.FOOD: {
        "google.com": "https://www.google.com/maps/search/restaurants+in+Egypt",
        "menuegypt.com": "https://www.menuegypt.com/menus/all",
        "elmenus.com": "https://www.elmenus.com/menu",
        "talabat.com": "https://www.talabat.com/egypt",
    },
    Category.CINEMA: {"voxcinemas.com": "https://egy.voxcinemas.com/"},
}

_RETAIL_SEARCH_URLS = {
    "amazon.eg": "https://www.amazon.eg/s?k={query}",
    "jumia.com.eg": "https://www.jumia.com.eg/catalog/?q={query}",
    "noon.com": "https://www.noon.com/egypt-en/search?q={query}",
}

_MERCHANT_NAMES = {
    "amazon.eg": "Amazon Egypt",
    "jumia.com.eg": "Jumia Egypt",
    "noon.com": "Noon Egypt",
    "google.com": "Google Maps",
    "menuegypt.com": "Menu Egypt",
    "elmenus.com": "elmenus",
    "talabat.com": "Talabat Egypt",
    "voxcinemas.com": "VOX Egypt",
}
_MERCHANT_IDS = {
    "amazon.eg": "amazon-eg",
    "jumia.com.eg": "jumia-eg",
    "noon.com": "noon-eg",
    "google.com": "google-maps-eg",
    "menuegypt.com": "menu-egypt",
    "elmenus.com": "elmenus-eg",
    "talabat.com": "talabat-eg",
    "voxcinemas.com": "vox-eg",
}

_ADDRESS_FIELDS = {
    "recipientName",
    "mobileNumber",
    "governorate",
    "cityOrArea",
    "street",
    "building",
    "floor",
    "apartment",
    "landmark",
    "postalCode",
}
_COUPON_STATUSES = {"rejected", "not_tested", "technical_failure"}
_COUPON_REJECTION_REASONS = {
    "invalid_code",
    "expired",
    "not_eligible",
    "minimum_not_met",
    "merchant_restriction",
    "product_restriction",
    "payment_method_required",
    "already_applied",
    "not_stackable",
    "technical_failure",
    "unknown",
}


def _merchant_start_url(record: RunRecord, domain: str) -> str:
    assert record.category is not None
    if record.category is not Category.RETAIL:
        return _START_URLS[record.category][domain]
    normalized_query = " ".join(record.request.query.split())[:300]
    return _RETAIL_SEARCH_URLS[domain].format(query=quote_plus(normalized_query))


class ScopedSecretResolver:
    def __init__(
        self,
        record: RunRecord,
        control: ControlAPIClient,
    ) -> None:
        self.record = record
        self.control = control

    async def resolve_secret(self, handle: str, run_id: str) -> str:
        if handle not in _ADDRESS_FIELDS:
            raise SafetyViolation(f"Unknown semantic address field: {handle}")
        if not self.record.address_handle:
            raise PauseRequired(
                PauseReason.ADDRESS_CONSENT,
                "Address consent and a semantic secret reference are required",
            )
        if self.record.address_expires_at and self.record.address_expires_at <= datetime.now(UTC):
            self.record.address_handle = None
            self.record.address_domains.clear()
            raise PauseRequired(PauseReason.ADDRESS_CONSENT, "Address grant has expired")
        merchant_domain = self.record.browser.expected_domain
        if not merchant_domain or merchant_domain not in self.record.address_domains:
            raise SafetyViolation("Address grant is not scoped to the active merchant domain")
        return await self.control.resolve_secret(
            self.record.address_handle,
            run_id,
            merchant_domain,
            handle,
        )


class RunManager:
    def __init__(
        self,
        settings: Settings,
        control: ControlAPIClient,
        *,
        agent_factory: Callable[[], ComputerAgent] | None = None,
        browser_factory: Callable[[], SeleniumRemoteBrowser] | None = None,
    ) -> None:
        self.settings = settings
        self.control = control
        self.agent_factory = agent_factory or self._default_agent
        self.browser_factory = browser_factory or (
            lambda: SeleniumRemoteBrowser(settings.selenium_remote_url)
        )
        self.runs: dict[str, RunRecord] = {}
        self._create_idempotency: dict[str, IdempotencyRecord] = {}
        self._command_idempotency: dict[str, IdempotencyRecord] = {}
        self._admission_lock = asyncio.Lock()
        self._active_run_id: str | None = None

    def _default_agent(self) -> ComputerAgent:
        if self.settings.environment == "test":
            return DeterministicProviderTestAdapter()
        if not self.settings.openrouter_api_key:
            raise RuntimeError("AI_OPENROUTER_API_KEY is not configured")
        vision_locator: VisionFallbackLocator | None = None
        if self.settings.vision_fallback_provider == "gemini":
            if not self.settings.gemini_api_key:
                raise RuntimeError("AI_GEMINI_API_KEY is not configured")
            vision_locator = GeminiVisionFallbackLocator(
                api_key=self.settings.gemini_api_key,
                model=self.settings.gemini_vision_model,
                timeout_seconds=self.settings.request_timeout_seconds,
            )
        return OpenRouterComputerAgent(
            api_key=self.settings.openrouter_api_key,
            model=self.settings.model,
            max_steps=self.settings.max_computer_steps,
            max_visual_retries=self.settings.max_visual_retries,
            vision_fallback_model=self.settings.vision_fallback_model or self.settings.model,
            vision_locator=vision_locator,
            timeout_seconds=self.settings.request_timeout_seconds,
        )

    async def create_run(
        self,
        request: InternalCreateRunRequest,
        idempotency_key: str,
    ) -> InternalCreateRunResponse:
        if idempotency_key != request.run_id:
            raise IdempotencyConflictError("Idempotency-Key must equal runId")
        fingerprint = _fingerprint(request.model_dump(by_alias=True, mode="json"))
        async with self._admission_lock:
            existing_idempotency = self._create_idempotency.get(request.run_id)
            if existing_idempotency:
                if existing_idempotency.fingerprint != fingerprint:
                    raise IdempotencyConflictError("runId was reused with different content")
                return InternalCreateRunResponse(runId=request.run_id, duplicate=True)
            if request.browser_expires_at <= datetime.now(UTC):
                raise ValueError("browserExpiresAt must be in the future")
            if self._active_run_id is not None:
                active = self.runs.get(self._active_run_id)
                if active and active.status not in TERMINAL_STATUSES and not active.closed:
                    raise RunBusyError(self._active_run_id)
                self._active_run_id = None

            category = self._resolve_category(request)
            status = RunStatus.DISCOVERING if category else RunStatus.CLARIFYING
            browser = self.browser_factory()
            agent = self.agent_factory()
            record = RunRecord(
                request=request,
                category=category,
                status=status,
                browser_expires_at=request.browser_expires_at,
                browser=browser,
                agent=agent,
            )
            record.active_event.set()
            self.runs[record.run_id] = record
            self._active_run_id = record.run_id
            self._create_idempotency[record.run_id] = IdempotencyRecord(
                fingerprint=fingerprint,
                created_at=datetime.now(UTC),
            )
            record.ttl_task = asyncio.create_task(
                self._expire_at_ttl(record), name=f"dealpilot-ttl-{record.run_id}"
            )
        return InternalCreateRunResponse(runId=request.run_id, duplicate=False)

    async def start(self, run_id: str) -> None:
        record = self._get(run_id)
        if record.task and not record.task.done():
            return
        if record.status in TERMINAL_STATUSES:
            return
        if record.category is None:
            if record.clarification_request_id is None:
                request_id = f"clarification:{uuid4()}"
                await self.control.emit(
                    record.run_id,
                    "run.clarification_required",
                    {
                        "requestId": request_id,
                        "questions": [
                            {
                                "id": "category",
                                "prompt": clarification_message(record.request.query),
                                "required": True,
                            }
                        ],
                    },
                    status=RunStatus.CLARIFYING,
                )
                record.clarification_request_id = request_id
            return
        record.task = asyncio.create_task(
            self._execute(record), name=f"dealpilot-run-{record.run_id}"
        )

    async def command(
        self,
        path_run_id: str,
        command: InternalCommandRequest,
        idempotency_key: str,
    ) -> InternalCommandResponse:
        if path_run_id != command.run_id:
            raise ValueError("Path runId must equal command runId")
        if idempotency_key != command.id:
            raise IdempotencyConflictError("Idempotency-Key must equal command id")
        record = self._get(path_run_id)
        fingerprint = _fingerprint(command.model_dump(by_alias=True, mode="json"))
        async with record.command_lock:
            existing = self._command_idempotency.get(command.id)
            if existing:
                if existing.fingerprint != fingerprint:
                    raise IdempotencyConflictError("command id was reused with different content")
                if existing.error_kind:
                    _raise_recorded_error(existing)
                return InternalCommandResponse(id=command.id, runId=record.run_id, duplicate=True)
            try:
                await self._apply_command(record, command)
            except (InvalidTransitionError, ValueError) as exc:
                self._command_idempotency[command.id] = IdempotencyRecord(
                    fingerprint=fingerprint,
                    created_at=datetime.now(UTC),
                    error_kind=type(exc).__name__,
                    error_message=str(exc),
                )
                raise
            self._command_idempotency[command.id] = IdempotencyRecord(
                fingerprint=fingerprint,
                created_at=datetime.now(UTC),
            )
        return InternalCommandResponse(id=command.id, runId=record.run_id, duplicate=False)

    def get_record(self, run_id: str) -> RunRecord:
        return self._get(run_id)

    async def expire_now(self, run_id: str) -> None:
        record = self._get(run_id)
        await self._expire(record)

    async def aclose(self) -> None:
        for record in self.runs.values():
            if record.task and not record.task.done():
                record.task.cancel()
            if record.ttl_task and not record.ttl_task.done():
                record.ttl_task.cancel()
        tasks = [
            task
            for record in self.runs.values()
            for task in (record.task, record.ttl_task)
            if task is not None and not task.done()
        ]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for record in self.runs.values():
            if record.status not in TERMINAL_STATUSES:
                record.error = "AI service shutdown"
                await self._fail(record, "AI_SERVICE_SHUTDOWN", retryable=True)
            else:
                await self._close_browser(record)

    async def _apply_command(self, record: RunRecord, command: InternalCommandRequest) -> None:
        if record.status in TERMINAL_STATUSES:
            raise InvalidTransitionError("Terminal runs are immutable")
        payload = command.payload
        if command.name is CommandName.CLARIFY:
            await self._clarify(record, payload)
        elif command.name is CommandName.APPROVE_DOMAINS:
            await self._approve_domains(record, payload)
        elif command.name is CommandName.GRANT_ADDRESS:
            await self._grant_address(record, payload)
        elif command.name is CommandName.APPROVE_SEAT_HOLD:
            await self._approve_seat_hold(record, payload)
        elif command.name is CommandName.PAUSE:
            await self._pause_command(record, str(payload["reason"]))
        elif command.name is CommandName.RESUME:
            await self._resume_command(record, str(payload["reason"]))
        elif command.name is CommandName.CANCEL:
            await self._terminate(record, RunStatus.CANCELLED)
        elif command.name is CommandName.COMPLETE:
            if record.status not in {RunStatus.READY_FOR_HANDOFF, RunStatus.USER_TAKEOVER}:
                raise InvalidTransitionError("complete requires ready_for_handoff or user_takeover")
            await self._terminate(record, RunStatus.COMPLETED)

    async def _clarify(self, record: RunRecord, payload: dict[str, Any]) -> None:
        if record.status is not RunStatus.CLARIFYING:
            raise InvalidTransitionError("clarify is not expected")
        # The public API owns the user-facing pending action and validates its
        # requestId before forwarding this authenticated internal command. The
        # AI service emits its clarification event asynchronously after create,
        # so its locally generated ID can legitimately differ from the API ID.
        # Treat the control plane as authoritative here; status and command
        # idempotency still reject stale or replayed clarification commands.
        record.clarification_request_id = str(payload["requestId"])
        answers = payload["answers"]
        category_answer = answers.get("category")
        category_value = (
            category_answer[0] if isinstance(category_answer, list) else category_answer
        )
        try:
            category = Category(category_value) if isinstance(category_value, str) else None
        except ValueError:
            category = None
        if category is None:
            answer_text = " ".join(
                value if isinstance(value, str) else " ".join(str(item) for item in value)
                for value in answers.values()
            )
            category = classify_request(answer_text)
        if category is None:
            raise ValueError("Clarification did not resolve retail, food, or cinema")
        record.category = category
        record.status = RunStatus.DISCOVERING
        record.clarification_request_id = None
        await self.start(record.run_id)

    async def _approve_domains(self, record: RunRecord, payload: dict[str, Any]) -> None:
        if record.status is not RunStatus.AWAITING_DOMAIN_APPROVAL:
            raise InvalidTransitionError("Domain approval is not expected")
        if payload["requestId"] != record.domain_request_id:
            raise InvalidTransitionError("Stale domain approval requestId")
        assert record.category is not None
        domains = canonical_approved_domains(record.category, payload["domains"])
        record.approved_domains.update(domains)
        record.domains_event.set()

    async def _grant_address(self, record: RunRecord, payload: dict[str, Any]) -> None:
        if record.status is not RunStatus.AWAITING_ADDRESS_CONSENT:
            raise InvalidTransitionError("Address consent is not expected")
        if payload["requestId"] != record.address_request_id:
            raise InvalidTransitionError("Stale address requestId")
        domains = set(payload["merchantDomains"])
        if not domains.issubset(record.approved_domains):
            raise ValueError("Address recipients must be approved run domains")
        expires_at = datetime.fromisoformat(str(payload["expiresAt"]).replace("Z", "+00:00"))
        if expires_at > record.browser_expires_at:
            raise ValueError("Address grant cannot outlive the browser")
        if expires_at > datetime.now(UTC) + timedelta(minutes=30):
            raise ValueError("Address grant cannot exceed 30 minutes")
        record.address_handle = str(payload["secretReference"])
        record.address_domains = domains
        record.address_expires_at = expires_at
        record.address_request_id = None
        record.status = record.resume_status or RunStatus.COMPARING
        record.resume_status = None
        record.active_event.set()

    async def _approve_seat_hold(self, record: RunRecord, payload: dict[str, Any]) -> None:
        if record.status is not RunStatus.AWAITING_SEAT_HOLD_APPROVAL:
            raise InvalidTransitionError("Seat-hold approval is not expected")
        if payload["requestId"] != record.seat_request_id:
            raise InvalidTransitionError("Stale seat-hold requestId")
        if payload["merchantDomain"] not in record.approved_domains:
            raise ValueError("Seat-hold domain is not approved")
        if payload["offerId"] != record.seat_offer_id:
            raise ValueError("Seat-hold offer does not match the pending offer")
        future = record.seat_future
        if future is None or future.done():
            raise InvalidTransitionError("No seat-hold approval is pending")
        future.set_result(True)

    async def _pause_command(self, record: RunRecord, reason: str) -> None:
        if reason == "control_claim":
            if record.status not in {RunStatus.READY_FOR_HANDOFF, RunStatus.PAUSED}:
                raise InvalidTransitionError("control claim requires ready_for_handoff or paused")
            record.active_event.clear()
            async with record.action_lock:
                record.status = RunStatus.USER_TAKEOVER
            return
        if record.status is RunStatus.PAUSED:
            return
        record.resume_status = record.status
        record.active_event.clear()
        async with record.action_lock:
            record.status = RunStatus.PAUSED

    async def _resume_command(self, record: RunRecord, reason: str) -> None:
        if reason in {"control_release", "lease_expired"}:
            if record.status is not RunStatus.USER_TAKEOVER:
                raise InvalidTransitionError("Control release requires user_takeover")
            record.status = record.resume_status or RunStatus.READY_FOR_HANDOFF
            record.resume_status = None
            record.active_event.set()
            return
        if record.status is not RunStatus.PAUSED:
            raise InvalidTransitionError("Run is not paused")
        if record.resume_status is None:
            raise InvalidTransitionError("Paused run has no resume status")
        record.status = record.resume_status
        record.resume_status = None
        record.active_event.set()

    async def _execute(self, record: RunRecord) -> None:
        try:
            # Admission must return before the comparatively slow Selenium
            # session startup. The API persists the accepted run first; all
            # browser work and any resulting failure are reported by this
            # background task through canonical run events.
            await asyncio.to_thread(record.browser.connect)
            await self._request_domains(record)
            await record.domains_event.wait()
            if record.status in TERMINAL_STATUSES:
                return
            record.status = RunStatus.COMPARING
            await self._open_approved_merchants(record)
            if not any(not attempt.completed for attempt in record.attempts.values()):
                await self._fail(record, "NO_MERCHANT_AVAILABLE", retryable=True)
                return
            assert record.category is not None
            executor = BrowserActionExecutor(
                record.browser,
                category=record.category,
                run_id=record.run_id,
                event_sink=self.control,
                secret_resolver=ScopedSecretResolver(record, self.control),
                approval_requester=lambda approval_type, details: self._request_approval(
                    record, approval_type, details
                ),
                approved_domains=lambda: record.approved_domains,
                pause_requester=lambda exc: self._pause_for_safety(record, exc),
                wait_until_active=record.active_event.wait,
                status_getter=lambda: record.status,
                merchant_attempt_getter=lambda: _attempt_id(record, record.browser.expected_domain),
                action_lock=record.action_lock,
            )
            record.executor = executor
            raw = await record.agent.run(
                query=record.request.query,
                category=record.category,
                executor=executor,
                address_handle=record.address_handle,
                discovery_sink=lambda kind, data: self._record_discovery(record, kind, data),
            )
            await record.active_event.wait()
            raw = _attach_evidence(raw, executor.evidence_ids)
            record.result = validate_agent_result(
                record.category,
                raw,
                approved_domains=record.approved_domains,
            )
            await self._emit_final_discoveries(record)
            await self._complete_attempts(record)
            await self.control.emit(
                record.run_id,
                "report.updated",
                _report_counts(record),
                status=record.status,
            )
            await self._transition(record, RunStatus.READY_FOR_HANDOFF)
        except asyncio.CancelledError:
            if record.status not in TERMINAL_STATUSES:
                raise
        except Exception as exc:
            record.error = self._redact_error(record, exc)
            logger.error(
                "AI run failed run_id=%s error_type=%s error=%s",
                record.run_id,
                type(exc).__name__,
                record.error,
            )
            if record.partial_offers:
                record.warnings.append(
                    {
                        "code": "PARTIAL_RESULTS_ONLY",
                        "message": record.error,
                        "evidenceIds": [],
                    }
                )
                await self._complete_attempts(record, failure_code="LATE_MERCHANT_FAILURE")
                record.result = record.result or {
                    "category": record.category.value if record.category else None,
                    "currency": "EGP",
                    "candidates": record.partial_offers,
                    "coupon_attempts": record.partial_coupons,
                    "partial": True,
                }
                await self.control.emit(
                    record.run_id,
                    "run.warning",
                    {
                        "code": "PARTIAL_RESULTS_ONLY",
                        "message": record.error,
                        "merchantAttemptId": None,
                        "evidenceIds": [],
                    },
                    status=record.status,
                )
                await self.control.emit(
                    record.run_id,
                    "report.updated",
                    _report_counts(record),
                    status=record.status,
                )
                await self._transition(record, RunStatus.READY_FOR_HANDOFF)
            else:
                try:
                    await self._complete_attempts(record, failure_code="AI_RUN_FAILED")
                except Exception as attempt_exc:
                    logger.error(
                        "AI run attempt finalization failed run_id=%s error_type=%s error=%s",
                        record.run_id,
                        type(attempt_exc).__name__,
                        self._redact_error(record, attempt_exc),
                    )
                await self._fail(record, "AI_RUN_FAILED", retryable=True)

    async def _request_domains(self, record: RunRecord) -> None:
        assert record.category is not None
        record.domain_request_id = f"domains:{uuid4()}"
        record.status = RunStatus.AWAITING_DOMAIN_APPROVAL
        candidates = [
            {
                "id": _MERCHANT_IDS[domain],
                "name": _MERCHANT_NAMES[domain],
                "domain": domain,
                "category": record.category.value,
                "market": "EG",
                "currency": "EGP",
            }
            for domain in ALLOWED_DOMAINS[record.category]
        ]
        await self.control.emit(
            record.run_id,
            "domains.approval_required",
            {"requestId": record.domain_request_id, "candidates": candidates},
            status=RunStatus.AWAITING_DOMAIN_APPROVAL,
        )

    async def _open_approved_merchants(self, record: RunRecord) -> None:
        assert record.category is not None
        fixture_loaded = False
        for domain in ALLOWED_DOMAINS[record.category]:
            if domain not in record.approved_domains:
                continue
            attempt = MerchantAttempt(id=f"attempt:{uuid4()}", domain=domain, started=True)
            record.attempts[domain] = attempt
            await self.control.emit(
                record.run_id,
                "merchant.attempt_started",
                {
                    "attemptId": attempt.id,
                    "merchantId": _MERCHANT_IDS[domain],
                    "merchantDomain": domain,
                    "category": record.category.value,
                },
                status=RunStatus.COMPARING,
            )
            if self.settings.environment == "test":
                if not fixture_loaded:
                    await asyncio.to_thread(
                        record.browser.load_deterministic_test_fixture,
                        domain,
                        record.category,
                        record.approved_domains,
                    )
                    fixture_loaded = True
                else:
                    await self._finish_attempt(
                        record,
                        attempt,
                        "unavailable",
                        "TEST_MERCHANT_UNAVAILABLE",
                    )
                    await self.control.emit(
                        record.run_id,
                        "run.warning",
                        {
                            "code": "TEST_MERCHANT_UNAVAILABLE",
                            "message": "Deterministic test adapter simulated a merchant failure.",
                            "merchantAttemptId": attempt.id,
                            "evidenceIds": [],
                        },
                        status=RunStatus.COMPARING,
                    )
                continue
            try:
                await asyncio.to_thread(
                    record.browser.navigate,
                    _merchant_start_url(record, domain),
                    record.category,
                    record.approved_domains,
                    separate_tab=record.category is Category.RETAIL,
                )
            except PauseRequired as exc:
                while True:
                    await self._pause_for_safety(record, exc)
                    if record.status in TERMINAL_STATUSES:
                        return
                    try:
                        await asyncio.to_thread(
                            record.browser.guard,
                            record.category,
                            record.approved_domains,
                        )
                        break
                    except PauseRequired as next_exc:
                        exc = next_exc
            except Exception as exc:
                await self._finish_attempt(record, attempt, "failed", type(exc).__name__.upper())
                await self.control.emit(
                    record.run_id,
                    "run.warning",
                    {
                        "code": "MERCHANT_NAVIGATION_FAILED",
                        "message": f"{_MERCHANT_NAMES[domain]} could not be opened.",
                        "merchantAttemptId": attempt.id,
                        "evidenceIds": [],
                    },
                    status=RunStatus.COMPARING,
                )

    async def _request_approval(
        self,
        record: RunRecord,
        approval_type: ApprovalType,
        details: dict[str, Any],
    ) -> bool:
        if approval_type is not ApprovalType.SEAT_HOLD:
            raise SafetyViolation(f"Unsupported browser approval: {approval_type}")
        loop = asyncio.get_running_loop()
        record.seat_future = loop.create_future()
        record.seat_request_id = f"seat:{uuid4()}"
        record.seat_offer_id = str(details.get("offer_id") or f"offer:pending:{uuid4()}")
        record.resume_status = record.status
        record.status = RunStatus.AWAITING_SEAT_HOLD_APPROVAL
        await self.control.emit(
            record.run_id,
            "seat_hold.approval_required",
            {
                "requestId": record.seat_request_id,
                "offerId": record.seat_offer_id,
                "merchantDomain": str(details.get("merchant_domain") or "voxcinemas.com"),
                "holdDurationSeconds": None,
            },
            status=RunStatus.AWAITING_SEAT_HOLD_APPROVAL,
        )
        approved = await record.seat_future
        record.seat_future = None
        record.status = record.resume_status or RunStatus.COMPARING
        record.resume_status = None
        return approved

    async def _pause_for_safety(self, record: RunRecord, exc: PauseRequired) -> None:
        previous = record.status
        record.resume_status = previous
        record.active_event.clear()
        warning = {
            "code": exc.reason_code.value,
            "message": self._redact_text(record, exc.reason),
            "merchantAttemptId": None,
            "evidenceIds": [],
        }
        record.warnings.append(warning)
        if exc.reason_code is PauseReason.ADDRESS_CONSENT:
            record.address_request_id = f"address:{uuid4()}"
            record.status = RunStatus.AWAITING_ADDRESS_CONSENT
            active_domain = record.browser.expected_domain
            recipients = (
                [active_domain]
                if active_domain in record.approved_domains
                else sorted(record.approved_domains)
            )
            await self.control.emit(
                record.run_id,
                "address.approval_required",
                {
                    "requestId": record.address_request_id,
                    "merchantDomains": recipients,
                    "fields": sorted(_ADDRESS_FIELDS),
                },
                status=RunStatus.AWAITING_ADDRESS_CONSENT,
            )
        else:
            await self._transition(record, RunStatus.PAUSED)
            await self.control.emit(
                record.run_id,
                "run.warning",
                warning,
                status=RunStatus.PAUSED,
            )
        await record.active_event.wait()

    async def _record_discovery(self, record: RunRecord, kind: str, data: dict[str, Any]) -> None:
        if kind == "offer":
            record.partial_offers.append(data)
            await self._emit_offer(record, data)
        elif kind == "coupon":
            record.partial_coupons.append(data)
            await self._emit_coupon(record, data)
        elif kind == "warning":
            message = str(data.get("message", "Merchant warning"))
            warning = {
                "code": str(data.get("code", "AI_WARNING")),
                "message": self._redact_text(record, message),
                "evidenceIds": [str(value) for value in data.get("evidence_ids", [])],
            }
            record.warnings.append(warning)
            await self.control.emit(
                record.run_id,
                "run.warning",
                {
                    **warning,
                    "merchantAttemptId": _attempt_id(record, data.get("merchant_domain")),
                },
                status=record.status,
            )
        elif kind == "merchant_attempt":
            domain = str(data.get("merchant_domain", ""))
            attempt = record.attempts.get(domain)
            outcome = data.get("outcome")
            if attempt is not None and isinstance(outcome, str):
                await self._finish_attempt(
                    record,
                    attempt,
                    outcome,
                    str(data["failure_code"]) if data.get("failure_code") else None,
                )

    async def _emit_final_discoveries(self, record: RunRecord) -> None:
        if not record.result:
            return
        for candidate in record.result.get("candidates", []):
            await self._emit_offer(record, candidate)
        for coupon in record.result.get("coupon_attempts", []):
            await self._emit_coupon(record, coupon)
        for candidate in record.result.get("candidates", []):
            if candidate.get("incomplete_reason") == "INCONSISTENT_TOTAL":
                await self.control.emit(
                    record.run_id,
                    "run.warning",
                    {
                        "code": "INCONSISTENT_TOTAL",
                        "message": (
                            "Reported total did not match the verified component arithmetic."
                        ),
                        "merchantAttemptId": _attempt_id(record, candidate.get("merchant")),
                        "evidenceIds": candidate.get("evidence_ids", []),
                    },
                    status=record.status,
                )

    async def _emit_offer(self, record: RunRecord, data: dict[str, Any]) -> None:
        offer_id = str(data.get("offer_id") or _stable_id("offer", data))
        if offer_id in record.emitted_offer_ids:
            return
        record.emitted_offer_ids.add(offer_id)
        evidence_ids = [str(value) for value in data.get("evidence_ids", [])]
        validity = (
            "valid"
            if data.get("valid") is True
            else ("incomplete" if data.get("incomplete_reason") else "excluded")
        )
        await self.control.emit(
            record.run_id,
            "offer.recorded",
            {
                "offerId": offer_id,
                "validity": validity,
                "merchantAttemptId": _attempt_id(record, data.get("merchant"))
                or next(iter(record.attempts.values())).id,
                "evidenceIds": evidence_ids,
            },
            status=record.status,
        )

    async def _emit_coupon(self, record: RunRecord, data: dict[str, Any]) -> None:
        coupon_id = str(data.get("coupon_attempt_id") or _stable_id("coupon", data))
        if coupon_id in record.emitted_coupon_ids:
            return
        record.emitted_coupon_ids.add(coupon_id)
        await self._transition(record, RunStatus.COUPON_TESTING)
        verified = data.get("verified") is True
        evidence_ids = [str(value) for value in data.get("evidence_ids", [])]
        raw_rejection = str(data.get("rejection_reason", "unknown"))
        rejection_reason = (
            raw_rejection if raw_rejection in _COUPON_REJECTION_REASONS else "unknown"
        )
        raw_status = str(data.get("status", "rejected"))
        status = raw_status if raw_status in _COUPON_STATUSES else "rejected"
        if rejection_reason == "technical_failure":
            status = "technical_failure"
        await self.control.emit(
            record.run_id,
            "coupon.attempted",
            {
                "couponAttemptId": coupon_id,
                "offerId": str(data.get("offer_id") or _stable_id("offer", data)),
                "status": "verified" if verified else status,
                "rejectionReason": None if verified else rejection_reason,
                "evidenceIds": evidence_ids,
            },
            status=RunStatus.COUPON_TESTING,
        )

    async def _transition(self, record: RunRecord, status: RunStatus) -> None:
        if record.status is status:
            return
        previous = record.status
        record.status = status
        await self.control.emit(
            record.run_id,
            "run.status_changed",
            {"from": previous.value, "to": status.value, "reasonCode": None},
            status=status,
        )

    async def _complete_attempts(self, record: RunRecord, failure_code: str | None = None) -> None:
        for attempt in record.attempts.values():
            if not attempt.completed:
                if record.executor:
                    attempt.evidence_ids.extend(
                        evidence_id
                        for evidence_id in record.executor.evidence_by_attempt.get(attempt.id, [])
                        if evidence_id not in attempt.evidence_ids
                    )
                await self._finish_attempt(
                    record,
                    attempt,
                    "failed" if failure_code else "succeeded",
                    failure_code,
                )

    async def _finish_attempt(
        self,
        record: RunRecord,
        attempt: MerchantAttempt,
        outcome: str,
        failure_code: str | None,
    ) -> None:
        if attempt.completed:
            return
        attempt.completed = True
        await self.control.emit(
            record.run_id,
            "merchant.attempt_completed",
            {
                "attemptId": attempt.id,
                "outcome": outcome,
                "failureCode": failure_code,
                "evidenceIds": attempt.evidence_ids,
            },
            status=record.status,
        )

    async def _fail(self, record: RunRecord, code: str, *, retryable: bool) -> None:
        record.status = RunStatus.FAILED
        try:
            await self.control.emit(
                record.run_id,
                "run.failed",
                {
                    "failedAt": _timestamp(),
                    "failureCode": code,
                    "retryable": retryable,
                },
                status=RunStatus.FAILED,
            )
        finally:
            await self._close_browser(record)

    async def _terminate(self, record: RunRecord, status: RunStatus) -> None:
        record.status = status
        record.active_event.set()
        if record.task and not record.task.done():
            record.task.cancel()
            await asyncio.gather(record.task, return_exceptions=True)
        await self._close_browser(record)

    async def _expire_at_ttl(self, record: RunRecord) -> None:
        delay = max(0.0, (record.browser_expires_at - datetime.now(UTC)).total_seconds())
        try:
            await asyncio.sleep(delay)
            await self._expire(record)
        except asyncio.CancelledError:
            return

    async def _expire(self, record: RunRecord) -> None:
        if record.status in TERMINAL_STATUSES:
            return
        record.error = "Browser TTL expired"
        if record.task and not record.task.done():
            record.task.cancel()
            await asyncio.gather(record.task, return_exceptions=True)
        await self._fail(record, "BROWSER_TTL_EXPIRED", retryable=False)

    async def _close_browser(self, record: RunRecord) -> None:
        if record.closed:
            return
        record.closed = True
        record.address_handle = None
        record.address_domains.clear()
        record.address_expires_at = None
        record.active_event.set()
        await asyncio.to_thread(record.browser.close)
        if record.ttl_task and record.ttl_task is not asyncio.current_task():
            record.ttl_task.cancel()
        async with self._admission_lock:
            if self._active_run_id == record.run_id:
                self._active_run_id = None

    def _resolve_category(self, request: InternalCreateRunRequest) -> Category | None:
        if request.requested_category is not RequestedCategory.AUTO:
            return Category(request.requested_category.value)
        return classify_request(request.query)

    def _get(self, run_id: str) -> RunRecord:
        try:
            return self.runs[run_id]
        except KeyError as exc:
            raise KeyError("Run not found") from exc

    def _redact_error(self, record: RunRecord, exc: Exception) -> str:
        return self._redact_text(record, str(exc) or type(exc).__name__)

    @staticmethod
    def _redact_text(record: RunRecord, value: str) -> str:
        return record.executor.redactor.mask(value) if record.executor else value


def _fingerprint(value: Any) -> str:
    normalized = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(normalized.encode()).hexdigest()


def _raise_recorded_error(record: IdempotencyRecord) -> None:
    message = record.error_message or "Recorded command rejection"
    if record.error_kind == "InvalidTransitionError":
        raise InvalidTransitionError(message)
    raise ValueError(message)


def _stable_id(prefix: str, value: dict[str, Any]) -> str:
    return f"{prefix}:{_fingerprint(value)[:24]}"


def _attempt_id(record: RunRecord, merchant: Any) -> str | None:
    folded = str(merchant or "").casefold()
    for domain, attempt in record.attempts.items():
        if domain in folded or _MERCHANT_NAMES[domain].casefold() in folded:
            return attempt.id
    return None


def _report_counts(record: RunRecord) -> dict[str, int]:
    candidates = (record.result or {}).get("candidates", record.partial_offers)
    valid = sum(item.get("valid") is True for item in candidates)
    incomplete = sum(bool(item.get("incomplete_reason")) for item in candidates)
    excluded = max(0, len(candidates) - valid - incomplete)
    return {
        "validOfferCount": valid,
        "excludedOfferCount": excluded,
        "incompleteOfferCount": incomplete,
    }


def _attach_evidence(raw: str, evidence_ids: list[str]) -> str:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    if not isinstance(value, dict):
        return raw
    fallback = evidence_ids[-1:] if evidence_ids else []
    candidates = value.get("candidates", [])
    if isinstance(candidates, list):
        for candidate in candidates:
            if isinstance(candidate, dict) and not candidate.get("evidence_ids"):
                candidate["evidence_ids"] = fallback
    coupons = value.get("coupon_attempts", [])
    if isinstance(coupons, list):
        for coupon in coupons:
            if isinstance(coupon, dict) and not coupon.get("evidence_ids"):
                coupon["evidence_ids"] = fallback
    return json.dumps(value, ensure_ascii=False)


def _timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
