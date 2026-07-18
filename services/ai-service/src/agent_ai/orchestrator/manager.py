from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
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
from agent_ai.workflows import (
    fallback_request_understanding,
    normalize_request_understanding,
    validate_agent_result,
)

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
        request_understanding: dict[str, Any] | None = None,
    ) -> str: ...


class RunBusyError(RuntimeError):
    def __init__(self, active_run_id: str, retry_after: int = 5) -> None:
        self.active_run_id = active_run_id
        self.retry_after = retry_after
        super().__init__("The merchant browser pool is busy with another active run")


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
class MerchantWorker:
    domain: str
    attempt: MerchantAttempt
    browser: SeleniumRemoteBrowser
    agent: ComputerAgent
    executor: BrowserActionExecutor | None = None
    action_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    result: dict[str, Any] | None = None
    error: str | None = None


@dataclass(slots=True)
class RunRecord:
    request: InternalCreateRunRequest
    category: Category | None
    status: RunStatus
    browser_expires_at: datetime
    browser: SeleniumRemoteBrowser | None = None
    agent: ComputerAgent | None = None
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
    workers: dict[str, MerchantWorker] = field(default_factory=dict)
    resume_status: RunStatus | None = None
    error: str | None = None
    closed: bool = False
    active_event: asyncio.Event = field(default_factory=asyncio.Event)
    domains_event: asyncio.Event = field(default_factory=asyncio.Event)
    seat_future: asyncio.Future[bool] | None = None
    action_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    pause_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    command_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    task: asyncio.Task[None] | None = None
    ttl_task: asyncio.Task[None] | None = None
    executor: BrowserActionExecutor | None = None
    request_understanding: dict[str, Any] = field(default_factory=dict)
    emitted_offer_ids: set[str] = field(default_factory=set)
    emitted_coupon_ids: set[str] = field(default_factory=set)
    emitted_offer_fingerprints: dict[str, str] = field(default_factory=dict)
    emitted_coupon_fingerprints: dict[str, str] = field(default_factory=dict)

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

_USER_INPUT_PAUSE_REASONS = {
    PauseReason.LOGIN,
    PauseReason.ONE_TIME_CODE,
    PauseReason.CAPTCHA,
    PauseReason.BROWSER_WARNING,
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
    fallback = fallback_request_understanding(record.request.query, record.category)
    search_query = str(record.request_understanding.get("search_query") or fallback["search_query"])
    return _RETAIL_SEARCH_URLS[domain].format(query=quote_plus(search_query))


class ScopedSecretResolver:
    def __init__(
        self,
        record: RunRecord,
        control: ControlAPIClient,
        browser: SeleniumRemoteBrowser,
    ) -> None:
        self.record = record
        self.control = control
        self.browser = browser

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
        merchant_domain = self.browser.expected_domain
        if not merchant_domain or merchant_domain not in self.record.address_domains:
            raise SafetyViolation("Address grant is not scoped to the active merchant domain")
        return await self.control.resolve_secret(
            self.record.address_handle,
            run_id,
            merchant_domain,
            handle,
        )


class SerializedControlClient:
    """Keep concurrent merchant events in one deterministic control-plane order."""

    def __init__(self, control: ControlAPIClient) -> None:
        self.control = control
        self.event_lock = asyncio.Lock()

    async def emit(self, *args: Any, **kwargs: Any) -> str:
        async with self.event_lock:
            return await self.control.emit(*args, **kwargs)

    async def resolve_secret(self, *args: Any, **kwargs: Any) -> str:
        return await self.control.resolve_secret(*args, **kwargs)

    async def upload_evidence(self, *args: Any, **kwargs: Any) -> None:
        await self.control.upload_evidence(*args, **kwargs)


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
        self.control = SerializedControlClient(control)
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
            await self._pause_command(record, payload)
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

    async def _pause_command(self, record: RunRecord, payload: dict[str, Any]) -> None:
        reason = str(payload["reason"])
        if reason == "control_claim":
            if record.status is not RunStatus.PAUSED:
                raise InvalidTransitionError("control claim requires a user-input pause")
            merchant_attempt_id = str(payload["merchantAttemptId"])
            merchant_domain = str(payload["merchantDomain"])
            worker = record.workers.get(merchant_domain)
            if worker is None or worker.attempt.id != merchant_attempt_id:
                raise InvalidTransitionError("Control claim merchant target is not active")
            record.active_event.clear()
            async with self._all_action_locks(record):
                await asyncio.to_thread(worker.browser.focus_for_takeover)
                record.status = RunStatus.USER_TAKEOVER
            return
        if record.status is RunStatus.PAUSED:
            return
        record.resume_status = record.status
        record.active_event.clear()
        async with self._all_action_locks(record):
            record.status = RunStatus.PAUSED

    @staticmethod
    @asynccontextmanager
    async def _all_action_locks(record: RunRecord) -> AsyncIterator[None]:
        locks = [worker.action_lock for worker in record.workers.values()]
        if not locks:
            locks = [record.action_lock]
        async with AsyncExitStack() as stack:
            for lock in locks:
                await stack.enter_async_context(lock)
            yield

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
            assert record.browser is not None
            await asyncio.gather(
                self._understand_request(record),
                asyncio.to_thread(record.browser.connect),
            )
            await self._request_domains(record)
            await record.domains_event.wait()
            if record.status in TERMINAL_STATUSES:
                return
            record.status = RunStatus.COMPARING
            await self._run_approved_merchants(record)
            if record.status in TERMINAL_STATUSES:
                return
            successful_results = [
                worker.result for worker in record.workers.values() if worker.result is not None
            ]
            if not successful_results and not record.partial_offers:
                await self._fail(record, "NO_MERCHANT_AVAILABLE", retryable=True)
                return
            assert record.category is not None
            record.result = self._merge_merchant_results(record)
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

    async def _understand_request(self, record: RunRecord) -> None:
        assert record.category is not None
        fallback = fallback_request_understanding(record.request.query, record.category)
        understand = getattr(record.agent, "understand_request", None)
        if not callable(understand):
            record.request_understanding = fallback
            return
        try:
            value = await understand(query=record.request.query, category=record.category)
        except Exception as exc:
            logger.warning(
                "Request understanding fell back run_id=%s error_type=%s",
                record.run_id,
                type(exc).__name__,
            )
            value = fallback
        record.request_understanding = normalize_request_understanding(
            value,
            user_query=record.request.query,
            category=record.category,
        )

    async def _run_approved_merchants(self, record: RunRecord) -> None:
        assert record.category is not None
        workers: list[MerchantWorker] = []
        for domain in ALLOWED_DOMAINS[record.category]:
            if domain not in record.approved_domains:
                continue
            attempt = MerchantAttempt(id=f"attempt:{uuid4()}", domain=domain, started=True)
            record.attempts[domain] = attempt
            first_worker = not workers
            browser = (
                record.browser
                if first_worker and record.browser is not None
                else self.browser_factory()
            )
            agent = (
                record.agent if first_worker and record.agent is not None else self.agent_factory()
            )
            worker = MerchantWorker(
                domain=domain,
                attempt=attempt,
                browser=browser,
                agent=agent,
            )
            record.workers[domain] = worker
            if record.browser is None:
                record.browser = worker.browser
                record.agent = worker.agent
            workers.append(worker)
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

        tasks = [
            asyncio.create_task(
                self._run_merchant(record, worker),
                name=f"dealpilot-merchant-{record.run_id}-{worker.domain}",
            )
            for worker in workers
        ]
        outcomes = await asyncio.gather(*tasks, return_exceptions=True)
        for worker, outcome in zip(workers, outcomes, strict=True):
            if not isinstance(outcome, BaseException):
                continue
            if isinstance(outcome, asyncio.CancelledError):
                raise outcome
            worker.error = self._redact_exception(record, outcome, worker.executor)
            logger.error(
                "Merchant worker escaped failure boundary run_id=%s merchant=%s "
                "error_type=%s error=%s",
                record.run_id,
                worker.domain,
                type(outcome).__name__,
                worker.error,
            )
            await self._finish_attempt(
                record,
                worker.attempt,
                "failed",
                "MERCHANT_RUN_FAILED",
            )

    async def _run_merchant(self, record: RunRecord, worker: MerchantWorker) -> None:
        assert record.category is not None
        try:
            if worker.browser is not record.browser:
                await asyncio.to_thread(worker.browser.connect)
            if self.settings.environment == "test":
                await asyncio.to_thread(
                    worker.browser.load_deterministic_test_fixture,
                    worker.domain,
                    record.category,
                    {worker.domain},
                )
            else:
                await self._navigate_merchant(record, worker)
            if record.status in TERMINAL_STATUSES:
                return
            executor = BrowserActionExecutor(
                worker.browser,
                category=record.category,
                run_id=record.run_id,
                event_sink=self.control,
                secret_resolver=ScopedSecretResolver(record, self.control, worker.browser),
                approval_requester=lambda approval_type, details: self._request_approval(
                    record, approval_type, details
                ),
                approved_domains={worker.domain},
                pause_requester=lambda exc: self._pause_for_safety(
                    record, exc, browser=worker.browser
                ),
                wait_until_active=record.active_event.wait,
                status_getter=lambda: record.status,
                merchant_attempt_getter=lambda: worker.attempt.id,
                action_lock=worker.action_lock,
                allow_login_takeover=bool(record.request_understanding.get("requires_checkout")),
            )
            worker.executor = executor
            if record.executor is None:
                record.executor = executor
            raw = await worker.agent.run(
                query=record.request.query,
                category=record.category,
                executor=executor,
                address_handle=record.address_handle,
                discovery_sink=lambda kind, data: self._record_discovery(
                    record,
                    kind,
                    data,
                    merchant_domain=worker.domain,
                ),
                request_understanding=record.request_understanding,
            )
            await record.active_event.wait()
            raw = _attach_evidence(raw, executor.evidence_ids)
            worker.result = validate_agent_result(
                record.category,
                raw,
                approved_domains={worker.domain},
                query=record.request.query,
            )
            for candidate in worker.result.get("candidates", []):
                candidate["merchant"] = worker.domain
            for coupon in worker.result.get("coupon_attempts", []):
                coupon["merchant"] = worker.domain
            await self._finish_attempt(record, worker.attempt, "succeeded", None)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            worker.error = self._redact_exception(record, exc, worker.executor)
            logger.warning(
                "Merchant worker failed run_id=%s merchant=%s error_type=%s error=%s",
                record.run_id,
                worker.domain,
                type(exc).__name__,
                worker.error,
            )
            await self._finish_attempt(
                record,
                worker.attempt,
                "failed",
                "MERCHANT_RUN_FAILED",
            )
            warning = {
                "code": "MERCHANT_RUN_FAILED",
                "message": f"{_MERCHANT_NAMES[worker.domain]} could not be completed.",
                "merchantAttemptId": worker.attempt.id,
                "evidenceIds": list(worker.attempt.evidence_ids),
            }
            record.warnings.append(warning)
            await self.control.emit(
                record.run_id,
                "run.warning",
                warning,
                status=record.status,
            )

    async def _navigate_merchant(self, record: RunRecord, worker: MerchantWorker) -> None:
        assert record.category is not None
        try:
            await asyncio.to_thread(
                worker.browser.navigate,
                _merchant_start_url(record, worker.domain),
                record.category,
                {worker.domain},
                separate_tab=record.category is Category.RETAIL,
            )
        except PauseRequired as exc:
            while True:
                await self._pause_for_safety(record, exc, browser=worker.browser)
                if record.status in TERMINAL_STATUSES:
                    return
                try:
                    await asyncio.to_thread(
                        worker.browser.guard,
                        record.category,
                        {worker.domain},
                    )
                    return
                except PauseRequired as next_exc:
                    exc = next_exc

    def _merge_merchant_results(self, record: RunRecord) -> dict[str, Any]:
        assert record.category is not None
        candidates = [
            candidate
            for worker in record.workers.values()
            if worker.result is not None
            for candidate in worker.result.get("candidates", [])
        ]
        failed_domains = {
            worker.domain for worker in record.workers.values() if worker.result is None
        }
        candidates.extend(
            offer
            for offer in record.partial_offers
            if _merchant_domain(offer.get("merchant")) in failed_domains
        )
        result = validate_agent_result(
            record.category,
            json.dumps({"candidates": candidates, "coupon_attempts": []}),
            approved_domains=record.approved_domains,
            query=record.request.query,
        )
        result["coupon_attempts"] = [
            coupon
            for worker in record.workers.values()
            if worker.result is not None
            for coupon in worker.result.get("coupon_attempts", [])
        ]
        result["stopped_before"] = "payment"
        result["notes"] = [
            note
            for worker in record.workers.values()
            if worker.result is not None
            for note in worker.result.get("notes", [])
        ]
        result["partial"] = any(worker.error for worker in record.workers.values())
        return result

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

    async def _pause_for_safety(
        self,
        record: RunRecord,
        exc: PauseRequired,
        *,
        browser: SeleniumRemoteBrowser | None = None,
    ) -> None:
        async with record.pause_lock:
            if record.status in TERMINAL_STATUSES:
                return
            if not record.active_event.is_set() and record.status in {
                RunStatus.PAUSED,
                RunStatus.AWAITING_ADDRESS_CONSENT,
                RunStatus.USER_TAKEOVER,
            }:
                pass
            else:
                previous = record.status
                record.resume_status = previous
                record.active_event.clear()
                warning = {
                    "code": exc.reason_code.value,
                    "message": self._redact_text(record, exc.reason),
                    "merchantAttemptId": _attempt_id(
                        record,
                        browser.expected_domain if browser else None,
                    ),
                    "evidenceIds": [],
                    "requiresUserInput": exc.reason_code in _USER_INPUT_PAUSE_REASONS,
                }
                record.warnings.append(warning)
                if exc.reason_code is PauseReason.ADDRESS_CONSENT:
                    record.address_request_id = f"address:{uuid4()}"
                    record.status = RunStatus.AWAITING_ADDRESS_CONSENT
                    await self.control.emit(
                        record.run_id,
                        "address.approval_required",
                        {
                            "requestId": record.address_request_id,
                            "merchantDomains": sorted(record.approved_domains),
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

    async def _record_discovery(
        self,
        record: RunRecord,
        kind: str,
        data: dict[str, Any],
        *,
        merchant_domain: str | None = None,
    ) -> None:
        data = dict(data)
        if merchant_domain:
            data["merchant_domain"] = merchant_domain
            if kind in {"offer", "coupon"}:
                data["merchant"] = merchant_domain
                worker = record.workers.get(merchant_domain)
                if worker is not None and worker.executor is not None:
                    available_evidence = worker.executor.evidence_ids
                    requested_evidence = {str(value) for value in data.get("evidence_ids", [])}
                    verified_evidence = [
                        evidence_id
                        for evidence_id in available_evidence
                        if evidence_id in requested_evidence
                    ]
                    data["evidence_ids"] = verified_evidence or available_evidence[-1:]
        if kind == "offer":
            _upsert_discovery(record.partial_offers, data, "offer_id")
            await self._emit_offer(record, data)
        elif kind == "coupon":
            _upsert_discovery(record.partial_coupons, data, "coupon_attempt_id")
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
            domain = merchant_domain or str(data.get("merchant_domain", ""))
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
        fingerprint = _fingerprint(data)
        if record.emitted_offer_fingerprints.get(offer_id) == fingerprint:
            return
        evidence_ids = [str(value) for value in data.get("evidence_ids", [])]
        validity = _candidate_validity(data)
        await self.control.emit(
            record.run_id,
            "offer.recorded",
            {
                "offerId": offer_id,
                "validity": validity,
                "merchantAttemptId": _attempt_id(record, data.get("merchant"))
                or next(iter(record.attempts.values())).id,
                "evidenceIds": evidence_ids,
                "offer": _offer_event_data(record.category, data, validity),
            },
            status=record.status,
        )
        record.emitted_offer_ids.add(offer_id)
        record.emitted_offer_fingerprints[offer_id] = fingerprint
        await self.control.emit(
            record.run_id,
            "report.updated",
            _report_counts(record),
            status=record.status,
        )

    async def _emit_coupon(self, record: RunRecord, data: dict[str, Any]) -> None:
        coupon_id = str(data.get("coupon_attempt_id") or _stable_id("coupon", data))
        fingerprint = _fingerprint(data)
        if record.emitted_coupon_fingerprints.get(coupon_id) == fingerprint:
            return
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
        offer_id = str(
            data.get("offer_id") or next(iter(record.emitted_offer_ids), _stable_id("offer", data))
        )
        await self.control.emit(
            record.run_id,
            "coupon.attempted",
            {
                "couponAttemptId": coupon_id,
                "offerId": offer_id,
                "status": "verified" if verified else status,
                "rejectionReason": None if verified else rejection_reason,
                "evidenceIds": evidence_ids,
                "coupon": _coupon_event_data(data),
            },
            status=RunStatus.COUPON_TESTING,
        )
        record.emitted_coupon_ids.add(coupon_id)
        record.emitted_coupon_fingerprints[coupon_id] = fingerprint

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
                worker = record.workers.get(attempt.domain)
                if worker and worker.executor:
                    attempt.evidence_ids.extend(
                        evidence_id
                        for evidence_id in worker.executor.evidence_by_attempt.get(attempt.id, [])
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
        worker = record.workers.get(attempt.domain)
        if worker and worker.executor:
            attempt.evidence_ids.extend(
                evidence_id
                for evidence_id in worker.executor.evidence_by_attempt.get(attempt.id, [])
                if evidence_id not in attempt.evidence_ids
            )
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
        browsers = list(
            {id(worker.browser): worker.browser for worker in record.workers.values()}.values()
        )
        if record.browser is not None and all(
            record.browser is not browser for browser in browsers
        ):
            browsers.append(record.browser)
        await asyncio.gather(
            *(asyncio.to_thread(browser.close) for browser in browsers),
            return_exceptions=True,
        )
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
        masked = value
        for worker in record.workers.values():
            if worker.executor:
                masked = worker.executor.redactor.mask(masked)
        return record.executor.redactor.mask(masked) if record.executor else masked

    @staticmethod
    def _redact_exception(
        record: RunRecord,
        exc: BaseException,
        executor: BrowserActionExecutor | None,
    ) -> str:
        value = str(exc) or type(exc).__name__
        if executor:
            value = executor.redactor.mask(value)
        return RunManager._redact_text(record, value)


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
    domain = _merchant_domain(merchant)
    if domain and domain in record.attempts:
        return record.attempts[domain].id
    return None


def _merchant_domain(merchant: Any) -> str | None:
    folded = str(merchant or "").casefold()
    for domain, name in _MERCHANT_NAMES.items():
        if domain in folded or name.casefold() in folded:
            return domain
    return None


def _offer_event_data(
    category: Category | None,
    data: dict[str, Any],
    validity: str,
) -> dict[str, Any]:
    """Map sanitized or incremental model discoveries to the public offer contract."""
    resolved_category = category or Category.RETAIL
    details = data.get("details") if isinstance(data.get("details"), dict) else {}
    merchant_domain = (
        _merchant_domain(data.get("merchant"))
        or _merchant_domain(data.get("merchant_domain"))
        or next(iter(_START_URLS[resolved_category]))
    )
    source_url = _http_url(data.get("url")) or _START_URLS[resolved_category].get(
        merchant_domain,
        f"https://{merchant_domain}/",
    )
    exact = data.get("exact_match") is True
    match_confidence = _bounded_confidence(data.get("match_confidence"), 1 if exact else 0)
    incomplete_reason = _nullable_text(data.get("incomplete_reason"))
    price = {
        "itemSubtotal": _money_text(data.get("subtotal")) or "0.00",
        "deliveryFee": _money_text(data.get("delivery_fee")),
        "serviceFee": _money_text(data.get("service_fee")),
        "bookingFee": _money_text(data.get("booking_fee")),
        "tax": _money_text(data.get("tax")),
        "mandatoryFees": _mandatory_fee_event_data(data.get("mandatory_fees")),
        "verifiedDiscount": _money_text(data.get("discount")) or "0.00",
        "optionalTip": "0.00" if resolved_category is Category.FOOD else None,
        "finalTotal": _money_text(data.get("total")),
    }
    if resolved_category is Category.RETAIL:
        offer_details: dict[str, Any] = {
            "kind": "retail",
            "brand": _text(details.get("brand"), "Unknown brand"),
            "model": _text(details.get("model"), _text(data.get("title"), "Unknown model")),
            "variant": _nullable_text(details.get("variant")),
            "storage": _nullable_text(details.get("storage")),
            "size": _nullable_text(details.get("size")),
            "color": _nullable_text(details.get("color")),
            "quantity": _positive_int(details.get("quantity"), 1),
            "condition": "new",
            "deliveryEstimate": _nullable_text(details.get("delivery_estimate")),
        }
    elif resolved_category is Category.FOOD:
        basis = str(details.get("proximity_basis") or "unknown")
        if basis not in {"route_distance", "same_area", "branch_area_only", "unknown"}:
            basis = "unknown"
        scope = str(details.get("price_scope") or "menu_price")
        if scope not in {"menu_price", "delivered_total"}:
            scope = "menu_price"
        offer_details = {
            "kind": "food",
            "restaurant": _text(
                details.get("restaurant"),
                _text(data.get("merchant"), "Unknown restaurant"),
            ),
            "meal": _text(details.get("meal"), _text(data.get("title"), "Unknown meal")),
            "size": _nullable_text(details.get("meal_size")),
            "modifiers": _string_list(details.get("required_modifiers")),
            "rating": _number(details.get("rating")),
            "minimumOrder": _money_text(details.get("minimum_order")),
            "deliveryEstimate": _nullable_text(details.get("delivery_estimate")),
            "optionalTipExcluded": True,
            "sourceName": _text(details.get("source_name"), merchant_domain),
            "branchArea": _nullable_text(details.get("branch_area")),
            "distanceKm": _number(details.get("distance_km")),
            "distanceText": _nullable_text(details.get("distance_text")),
            "proximityBasis": basis,
            "priceScope": scope,
        }
    else:
        offer_details = {
            "kind": "cinema",
            "movie": _text(details.get("movie"), _text(data.get("title"), "Unknown movie")),
            "venue": _text(details.get("venue_area"), "Unknown venue"),
            "date": _text(details.get("date"), "Unknown date"),
            "showtime": _text(details.get("time"), "Unknown showtime"),
            "language": _text(details.get("language"), "Unknown language"),
            "screenFormat": _text(details.get("screen_format"), "Unknown format"),
            "seatCount": _positive_int(details.get("seat_count"), 1),
            "adjacentSeats": details.get("adjacent") is True,
            "seatType": _text(details.get("seat_type"), "Unknown seat type"),
            "holdExpiresAt": _nullable_text(details.get("hold_expires_at")),
        }
    missing = _string_list(data.get("incomplete_fields"))
    if validity == "incomplete" and not missing:
        missing = [incomplete_reason or "unverifiedDetails"]
    return {
        "title": _text(data.get("title"), "Discovered offer"),
        "sourceUrl": source_url,
        "match": {
            "exact": exact,
            "confidence": match_confidence,
            "explanation": _text(
                data.get("match_explanation") or data.get("exclusion_reason"),
                (
                    "The observed product matches the requested model and variant."
                    if exact
                    else "The observed page did not verify every requested product attribute."
                ),
            ),
        },
        "availability": _availability(data, details),
        "details": offer_details,
        "price": price,
        "exclusionReason": (
            _nullable_text(data.get("exclusion_reason"))
            or (
                "The offer is outside the requested comparison." if validity == "excluded" else None
            )
        ),
        "incompleteFields": missing,
    }


def _coupon_event_data(data: dict[str, Any]) -> dict[str, Any]:
    before = _money_text(data.get("before_total")) or "0.00"
    return {
        "code": _text(data.get("code"), "Not supplied"),
        "sourceUrl": _http_url(data.get("source_url")) or "https://www.google.com/",
        "beforeTotal": before,
        "afterTotal": _money_text(data.get("after_total")),
        "verifiedDiscount": _money_text(data.get("saving")) or "0.00",
        "message": _nullable_text(data.get("message")),
    }


def _mandatory_fee_event_data(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        amount = _money_text(item.get("amount"))
        if amount is None:
            continue
        result.append(
            {
                "label": _text(item.get("label"), "Mandatory fee"),
                "amount": amount,
                "evidenceIds": _string_list(item.get("evidence_ids")),
            }
        )
    return result


def _availability(data: dict[str, Any], details: dict[str, Any]) -> str:
    value = str(data.get("availability") or details.get("stock") or "").casefold()
    if value in {"available", "in stock", "in_stock", "true"}:
        return "available"
    if value in {"unavailable", "out of stock", "out_of_stock", "false"}:
        return "unavailable"
    return "unknown"


def _text(value: Any, fallback: str) -> str:
    text = str(value).strip() if value is not None else ""
    return text[:2_000] or fallback


def _nullable_text(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text[:2_000] or None


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text for item in value if (text := _nullable_text(item)) is not None]


def _money_text(value: Any) -> str | None:
    try:
        if value is None:
            return None
        amount = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, TypeError, ValueError):
        return None
    if amount < 0:
        return None
    return f"{amount.quantize(Decimal('0.01')):.2f}"


def _number(value: Any) -> float | None:
    try:
        return float(str(value).replace(",", "").strip()) if value is not None else None
    except (TypeError, ValueError):
        return None


def _positive_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def _bounded_confidence(value: Any, fallback: float) -> float:
    try:
        return min(1.0, max(0.0, float(value)))
    except (TypeError, ValueError):
        return fallback


def _http_url(value: Any) -> str | None:
    text = _nullable_text(value)
    return text if text and text.startswith(("http://", "https://")) else None


def _report_counts(record: RunRecord) -> dict[str, int]:
    candidates = (record.result or {}).get("candidates", record.partial_offers)
    validities = [_candidate_validity(item) for item in candidates]
    valid = validities.count("valid")
    incomplete = validities.count("incomplete")
    excluded = validities.count("excluded")
    return {
        "validOfferCount": valid,
        "excludedOfferCount": excluded,
        "incompleteOfferCount": incomplete,
    }


def _candidate_validity(data: dict[str, Any]) -> str:
    if data.get("exclusion_reason"):
        return "excluded"
    if data.get("valid") is True:
        return "valid"
    if (
        data.get("incomplete_reason")
        or data.get("subtotal") is not None
        or data.get("total") is not None
    ):
        return "incomplete"
    return "excluded"


def _upsert_discovery(
    discoveries: list[dict[str, Any]],
    data: dict[str, Any],
    id_field: str,
) -> None:
    discovery_id = str(data.get(id_field) or "").strip()
    if discovery_id:
        for index, existing in enumerate(discoveries):
            if str(existing.get(id_field) or "").strip() == discovery_id:
                discoveries[index] = data
                return
    discoveries.append(data)


def _attach_evidence(raw: str, evidence_ids: list[str]) -> str:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    if not isinstance(value, dict):
        return raw
    fallback = evidence_ids[-1:] if evidence_ids else []
    known_evidence = set(evidence_ids)
    candidates = value.get("candidates", [])
    if isinstance(candidates, list):
        for candidate in candidates:
            if isinstance(candidate, dict):
                verified = [
                    str(evidence_id)
                    for evidence_id in candidate.get("evidence_ids", [])
                    if str(evidence_id) in known_evidence
                ]
                candidate["evidence_ids"] = verified or fallback
    coupons = value.get("coupon_attempts", [])
    if isinstance(coupons, list):
        for coupon in coupons:
            if isinstance(coupon, dict):
                verified = [
                    str(evidence_id)
                    for evidence_id in coupon.get("evidence_ids", [])
                    if str(evidence_id) in known_evidence
                ]
                coupon["evidence_ids"] = verified or fallback
    return json.dumps(value, ensure_ascii=False)


def _timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
