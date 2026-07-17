from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import uuid4

from agent_ai.browser import (
    ALLOWED_DOMAINS,
    BrowserActionExecutor,
    PauseRequired,
    SafetyViolation,
    SeleniumRemoteBrowser,
)
from agent_ai.config.settings import Settings
from agent_ai.models import ApprovalType, Category, RunStatus
from agent_ai.orchestrator.classification import clarification_message, classify_request
from agent_ai.orchestrator.control_client import ControlAPIClient
from agent_ai.providers.openai_responses import OpenAIComputerAgent
from agent_ai.schemas.runs import CommandType, RunCommandRequest, RunCreateRequest, RunResponse
from agent_ai.workflows import validate_agent_result


class ComputerAgent(Protocol):
    async def run(
        self,
        *,
        query: str,
        category: Category,
        executor: BrowserActionExecutor,
        address_handle: str | None = None,
    ) -> str: ...


@dataclass(slots=True)
class RunRecord:
    run_id: str
    query: str
    locale: str | None
    address_handle: str | None
    constraints: dict[str, Any]
    category: Category | None
    status: RunStatus
    clarification: str | None = None
    pending_approval: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    approved_domains: set[str] = field(default_factory=set)
    address_domains: set[str] = field(default_factory=set)
    address_expires_at: datetime | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def public(self) -> RunResponse:
        return RunResponse(
            id=self.run_id,
            run_id=self.run_id,
            status=self.status,
            category=self.category,
            clarification=self.clarification,
            pending_approval=self.pending_approval,
            result=self.result,
            error=self.error,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


_START_URLS = {
    Category.RETAIL: (
        "https://www.amazon.eg/",
        "https://www.jumia.com.eg/",
        "https://www.noon.com/egypt-en/",
    ),
    Category.FOOD: ("https://www.talabat.com/egypt",),
    Category.CINEMA: ("https://egy.voxcinemas.com/",),
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


class ScopedSecretResolver:
    def __init__(
        self,
        record: RunRecord,
        browser: SeleniumRemoteBrowser,
        control: ControlAPIClient,
    ) -> None:
        self.record = record
        self.browser = browser
        self.control = control

    async def resolve_secret(self, handle: str, run_id: str) -> str:
        if handle not in _ADDRESS_FIELDS:
            raise SafetyViolation(f"Unknown semantic address field: {handle}")
        if not self.record.address_handle:
            raise PauseRequired(
                ApprovalType.ADDRESS_SHARE,
                "Address consent and a semantic secret reference are required",
            )
        if self.record.address_expires_at and self.record.address_expires_at <= datetime.now(UTC):
            raise PauseRequired(ApprovalType.ADDRESS_SHARE, "Address grant has expired")
        merchant_domain = self.browser.expected_domain
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
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.approvals: dict[str, asyncio.Future[bool]] = {}
        self._lock = asyncio.Lock()

    def _default_agent(self) -> ComputerAgent:
        if not self.settings.openai_api_key:
            raise RuntimeError("AI_OPENAI_API_KEY is not configured")
        return OpenAIComputerAgent(
            api_key=self.settings.openai_api_key,
            model=self.settings.model,
            max_steps=self.settings.max_computer_steps,
        )

    async def create_run(self, request: RunCreateRequest) -> RunResponse:
        detected = classify_request(request.query)
        category = request.category or detected
        category_conflict = (
            request.category is not None
            and detected is not None
            and request.category is not detected
        )
        if category_conflict:
            category = None
        status = RunStatus.CREATED if category else RunStatus.NEEDS_CLARIFICATION
        clarification = None if category else clarification_message(request.query)
        record = RunRecord(
            run_id=request.run_id or str(uuid4()),
            query=request.query,
            locale=request.locale,
            address_handle=request.address_handle,
            constraints=request.constraints,
            category=category,
            status=status,
            clarification=clarification,
        )
        async with self._lock:
            self.runs[record.run_id] = record
        await self.control.emit(
            record.run_id,
            "clarification_required" if clarification else "run_created",
            {
                "status": status.value,
                "category": category.value if category else None,
                "message": clarification,
            },
        )
        return record.public()

    async def start(self, run_id: str) -> None:
        record = self._get(run_id)
        if record.category is None or record.status is not RunStatus.CREATED:
            return
        current = self.tasks.get(run_id)
        if current and not current.done():
            return
        task = asyncio.create_task(self._execute(record), name=f"dealpilot-{run_id}")
        self.tasks[run_id] = task

    async def command(self, run_id: str, command: RunCommandRequest) -> RunResponse:
        record = self._get(run_id)
        if command.command is CommandType.CANCEL:
            record.status = RunStatus.CANCELLED
            self._touch(record)
            task = self.tasks.get(run_id)
            if task and not task.done():
                task.cancel()
            future = self.approvals.pop(run_id, None)
            if future and not future.done():
                future.set_result(False)
            await self.control.emit(run_id, "run_cancelled", {})
            return record.public()

        if command.command is CommandType.PAUSE:
            record.status = RunStatus.PAUSED
            self._touch(record)
            task = self.tasks.get(run_id)
            if task and not task.done():
                task.cancel()
            await self.control.emit(run_id, "safety_blocked", {"reason": "Paused by user"})
            return record.public()

        if command.command is CommandType.RESUME and run_id not in self.approvals:
            if record.status is not RunStatus.PAUSED:
                raise ValueError("Run is not paused")
            record.status = RunStatus.CREATED
            record.error = None
            self._touch(record)
            await self.start(run_id)
            return record.public()

        if command.command is CommandType.CLARIFY:
            if record.status is not RunStatus.NEEDS_CLARIFICATION or not command.text:
                raise ValueError("A clarification response is not currently expected")
            record.query = f"{record.query}\nClarification: {command.text}"
            record.category = classify_request(command.text)
            if record.category is None:
                record.clarification = clarification_message(command.text)
            else:
                record.status = RunStatus.CREATED
                record.clarification = None
            self._touch(record)
            await self.control.emit(
                run_id,
                "clarification_received",
                {"category": record.category.value if record.category else None},
            )
            if record.category:
                await self.start(run_id)
            return record.public()

        if command.command is CommandType.APPROVE_DOMAINS:
            expected = set(ALLOWED_DOMAINS[record.category]) if record.category else set()
            if set(command.domains) != expected:
                raise ValueError(f"Expected the fixed Egypt domains: {sorted(expected)}")
            record.approved_domains = set(command.domains)
            if record.address_handle and not record.address_domains:
                record.address_domains = set(command.domains)
            self._resolve_approval(record, ApprovalType.DOMAIN_ACCESS, True)
            return record.public()

        if command.command is CommandType.GRANT_ADDRESS:
            if not command.secret_reference or not command.recipient_domains:
                raise ValueError("grant_address requires secretReference and recipientDomains")
            domains = set(command.recipient_domains)
            if not domains.issubset(record.approved_domains):
                raise ValueError("Address domains must already have domain approval")
            if command.expires_at is None or command.expires_at.tzinfo is None:
                raise ValueError("grant_address requires a timezone-aware expiresAt")
            if command.expires_at <= datetime.now(UTC):
                raise ValueError("Address grant is already expired")
            record.address_handle = command.secret_reference
            record.address_domains = domains
            record.address_expires_at = command.expires_at
            self._resolve_approval(record, ApprovalType.ADDRESS_SHARE, True)
            return record.public()

        if command.command is CommandType.APPROVE_SEAT_HOLD:
            if command.merchant_domain != "voxcinemas.com":
                raise ValueError("Seat holds are allowed only on voxcinemas.com")
            self._resolve_approval(record, ApprovalType.SEAT_HOLD, True)
            return record.public()

        if command.command in {CommandType.APPROVE, CommandType.RESUME, CommandType.DENY}:
            future = self.approvals.get(run_id)
            if future is None or future.done() or record.pending_approval is None:
                raise ValueError("No approval is currently pending")
            expected = record.pending_approval.get("approval_type")
            if command.approval_type and command.approval_type.value != expected:
                raise ValueError(f"Expected approval_type {expected}")
            future.set_result(command.command in {CommandType.APPROVE, CommandType.RESUME})
            return record.public()
        raise ValueError("Unsupported command")

    def get(self, run_id: str) -> RunResponse:
        return self._get(run_id).public()

    async def aclose(self) -> None:
        active = [task for task in self.tasks.values() if not task.done()]
        for task in active:
            task.cancel()
        if active:
            await asyncio.gather(*active, return_exceptions=True)

    async def _execute(self, record: RunRecord) -> None:
        browser = self.browser_factory()
        executor: BrowserActionExecutor | None = None
        try:
            record.status = RunStatus.RUNNING
            self._touch(record)
            await self.control.emit(record.run_id, "run_started", {"category": record.category})
            assert record.category is not None
            if set(ALLOWED_DOMAINS[record.category]) != record.approved_domains:
                approved = await self._request_approval(
                    record,
                    ApprovalType.DOMAIN_ACCESS,
                    {"domains": list(ALLOWED_DOMAINS[record.category])},
                )
                if not approved:
                    return
            for url in _START_URLS[record.category]:
                await asyncio.to_thread(
                    browser.navigate,
                    url,
                    record.category,
                    separate_tab=record.category is Category.RETAIL,
                )
            executor = BrowserActionExecutor(
                browser,
                category=record.category,
                run_id=record.run_id,
                event_sink=self.control,
                secret_resolver=ScopedSecretResolver(record, browser, self.control),
                approval_requester=lambda approval_type, details: self._request_approval(
                    record, approval_type, details
                ),
            )
            agent = self.agent_factory()
            while record.status not in {RunStatus.CANCELLED, RunStatus.PAUSED}:
                try:
                    raw = await agent.run(
                        query=(
                            f"{record.query}\nStructured constraints: "
                            f"{json.dumps(record.constraints, ensure_ascii=False, default=str)}"
                        ),
                        category=record.category,
                        executor=executor,
                        address_handle=record.address_handle,
                    )
                    record.result = validate_agent_result(record.category, raw)
                    for candidate in record.result["candidates"]:
                        can_emit = (
                            candidate["valid"]
                            and candidate["exact_match"]
                            and candidate["total"] is not None
                        )
                        cinema_without_hold = (
                            record.category is Category.CINEMA
                            and not candidate["details"].get("hold_expires_at")
                        )
                        if can_emit and not cinema_without_hold:
                            await self.control.emit(
                                record.run_id,
                                "offer_normalized",
                                {"category": record.category.value, **candidate},
                            )
                    for coupon in record.result["coupon_attempts"]:
                        await self.control.emit(record.run_id, "coupon_attempted", coupon)
                    record.status = RunStatus.COMPLETED
                    self._touch(record)
                    await self.control.emit(record.run_id, "run_completed", record.result)
                    break
                except PauseRequired as exc:
                    approved = await self._request_approval(
                        record,
                        exc.approval_type,
                        {"message": exc.reason},
                    )
                    if not approved:
                        record.status = RunStatus.PAUSED
                        self._touch(record)
                        break
        except asyncio.CancelledError:
            if record.status is not RunStatus.PAUSED:
                record.status = RunStatus.CANCELLED
            self._touch(record)
        except SafetyViolation as exc:
            record.status = RunStatus.PAUSED
            record.error = executor.redactor.mask(str(exc)) if executor else str(exc)
            self._touch(record)
            await self.control.emit(record.run_id, "safety_blocked", {"reason": record.error})
        except Exception as exc:  # boundary: surface a sanitized operational error as an event
            record.status = RunStatus.FAILED
            record.error = executor.redactor.mask(str(exc)) if executor else str(exc)
            self._touch(record)
            await self.control.emit(record.run_id, "run_failed", {"error": record.error})
        finally:
            await asyncio.to_thread(browser.close)

    async def _request_approval(
        self,
        record: RunRecord,
        approval_type: ApprovalType,
        details: dict[str, Any],
    ) -> bool:
        loop = asyncio.get_running_loop()
        future: asyncio.Future[bool] = loop.create_future()
        self.approvals[record.run_id] = future
        record.status = RunStatus.AWAITING_APPROVAL
        record.pending_approval = {"approval_type": approval_type.value, **details}
        self._touch(record)
        await self.control.emit(record.run_id, "approval_required", record.pending_approval)
        approved = await future
        self.approvals.pop(record.run_id, None)
        record.pending_approval = None
        record.status = RunStatus.RUNNING if approved else RunStatus.PAUSED
        self._touch(record)
        await self.control.emit(
            record.run_id,
            "approval_resolved",
            {"approval_type": approval_type.value, "approved": approved},
        )
        return approved

    def _resolve_approval(
        self,
        record: RunRecord,
        approval_type: ApprovalType,
        approved: bool,
    ) -> None:
        future = self.approvals.get(record.run_id)
        if future is None or future.done() or record.pending_approval is None:
            raise ValueError("No approval is currently pending")
        expected = record.pending_approval.get("approval_type")
        if expected != approval_type.value:
            raise ValueError(f"Expected approval_type {expected}")
        future.set_result(approved)

    def _get(self, run_id: str) -> RunRecord:
        try:
            return self.runs[run_id]
        except KeyError as exc:
            raise KeyError("Run not found") from exc

    @staticmethod
    def _touch(record: RunRecord) -> None:
        record.updated_at = datetime.now(UTC)
