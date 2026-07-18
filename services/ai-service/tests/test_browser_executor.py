from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from agent_ai.browser.safety import PauseRequired, SafetyViolation
from agent_ai.browser.selenium_remote import (
    BrowserActionExecutor,
    SecretRedactor,
    SeleniumRemoteBrowser,
    VisualFallbackRequired,
)
from agent_ai.models import ApprovalType, Category, PauseReason, RunStatus

FIXTURES = Path(__file__).parent / "fixtures"


class FakeEventSink:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.uploads: list[tuple[str, str, bytes]] = []

    async def emit(
        self,
        run_id: str,
        event_type: str,
        payload: dict[str, Any],
        *,
        status: RunStatus | None = None,
    ) -> None:
        assert run_id == "run-1"
        assert status is not None
        self.events.append((event_type, payload))

    async def upload_evidence(self, run_id: str, evidence_id: str, png: bytes) -> None:
        self.uploads.append((run_id, evidence_id, png))


class FakeResolver:
    value = "12 Secret Street, Cairo"

    async def resolve_secret(self, handle: str, run_id: str) -> str:
        assert handle == "street"
        assert run_id == "run-1"
        return self.value


class FakeBrowser:
    def __init__(self, metadata: dict[str, Any], *, hold_expiry: str | None = None) -> None:
        self.metadata = metadata
        self.expected_domain = "voxcinemas.com"
        self.driver = SimpleNamespace(current_url="https://egy.voxcinemas.com/seat-map")
        self.typed: list[str] = []
        self.clicks: list[tuple[int, int]] = []
        self.masked_with: tuple[str, ...] = ()
        self.hold_expiry = hold_expiry
        self.sequence: list[str] = []

    def guard(self, category: Category, approved_domains: set[str]) -> None:
        assert category in Category
        assert approved_domains

    def recover_last_safe(self, category: Category, approved_domains: set[str]) -> None:
        self.guard(category, approved_domains)

    def metadata_at(self, x: int, y: int) -> dict[str, Any]:
        return self.metadata

    def active_metadata(self) -> dict[str, Any]:
        return self.metadata

    def type_text(self, text: str) -> None:
        self.typed.append(text)

    def click(self, x: int, y: int, **_: Any) -> None:
        self.sequence.append("click")
        self.clicks.append((x, y))

    def masked_screenshot(self, secrets: tuple[str, ...]) -> bytes:
        self.masked_with = secrets
        return b"original-resolution-png"

    def find_hold_expiry(self) -> str | None:
        return self.hold_expiry


async def approve(_: ApprovalType, __: dict[str, Any]) -> bool:
    return True


def test_remote_browser_uses_the_coordinate_contract_viewport() -> None:
    captured: dict[str, Any] = {}

    class Driver:
        def set_window_size(self, width: int, height: int) -> None:
            captured["window_size"] = (width, height)

    def factory(*, command_executor: str, options: Any) -> Driver:
        captured["command_executor"] = command_executor
        captured["arguments"] = options.arguments
        captured["page_load_strategy"] = options.page_load_strategy
        return Driver()

    browser = SeleniumRemoteBrowser("http://browser:4444/wd/hub", driver_factory=factory)
    browser.connect()

    assert captured == {
        "command_executor": "http://browser:4444/wd/hub",
        "arguments": ["--disable-notifications", "--window-size=1280,800"],
        "page_load_strategy": "eager",
        "window_size": (1280, 800),
    }


@pytest.mark.asyncio
async def test_semantic_address_is_resolved_only_at_address_field_and_redacted() -> None:
    browser = FakeBrowser({"name": "delivery-address", "aria_label": "Delivery address"})
    events = FakeEventSink()
    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.FOOD,
        run_id="run-1",
        event_sink=events,
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"talabat.com"},
    )
    await executor.execute({"type": "type", "text": "{{secret:street}}"})

    assert browser.typed == [FakeResolver.value]
    assert browser.masked_with == (FakeResolver.value,)
    assert FakeResolver.value not in json.dumps(events.events)


@pytest.mark.asyncio
async def test_secret_is_rejected_outside_address_field() -> None:
    browser = FakeBrowser({"name": "search", "aria_label": "Search"})
    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.RETAIL,
        run_id="run-1",
        event_sink=FakeEventSink(),
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"amazon.eg"},
    )
    with pytest.raises(SafetyViolation, match="address fields"):
        await executor.execute({"type": "type", "text": "{{secret:street}}"})
    assert browser.typed == []


@pytest.mark.asyncio
async def test_capture_pauses_and_returns_last_safe_screenshot() -> None:
    class PausingBrowser(FakeBrowser):
        def __init__(self) -> None:
            super().__init__({"name": "search", "aria_label": "Search"})
            self.should_pause = False

        def guard(self, category: Category, approved_domains: set[str]) -> None:
            super().guard(category, approved_domains)
            if self.should_pause:
                raise PauseRequired(
                    PauseReason.BROWSER_WARNING,
                    "Payment details page detected; AI stopped before inspecting payment data",
                )

        def recover_last_safe(self, category: Category, approved_domains: set[str]) -> None:
            self.should_pause = False
            super().recover_last_safe(category, approved_domains)

    browser = PausingBrowser()
    pauses: list[PauseRequired] = []

    async def pause(exc: PauseRequired) -> None:
        pauses.append(exc)

    events = FakeEventSink()
    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.RETAIL,
        run_id="run-1",
        event_sink=events,
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"amazon.eg"},
        pause_requester=pause,
    )
    safe_screenshot = await executor.capture()
    assert events.uploads[0][0] == "run-1"
    assert events.uploads[0][2] == b"original-resolution-png"
    browser.should_pause = True

    assert await executor.capture() == safe_screenshot
    assert [exc.reason_code for exc in pauses] == [PauseReason.BROWSER_WARNING]


@pytest.mark.asyncio
async def test_initial_captcha_pause_captures_fresh_page_after_human_resume() -> None:
    class InitialCaptchaBrowser(FakeBrowser):
        def __init__(self) -> None:
            super().__init__({"tag": "button", "text": "Continue"})
            self.solved = False
            self.recoveries = 0

        def guard(self, category: Category, approved_domains: set[str]) -> None:
            super().guard(category, approved_domains)
            if not self.solved:
                raise PauseRequired(
                    PauseReason.CAPTCHA,
                    "CAPTCHA/human verification detected",
                    preserve_page=True,
                )

        def recover_last_safe(self, category: Category, approved_domains: set[str]) -> None:
            self.recoveries += 1
            super().recover_last_safe(category, approved_domains)

    browser = InitialCaptchaBrowser()
    pauses: list[PauseRequired] = []

    async def pause(exc: PauseRequired) -> None:
        pauses.append(exc)
        browser.solved = True

    events = FakeEventSink()
    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.RETAIL,
        run_id="run-1",
        event_sink=events,
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"amazon.eg"},
        pause_requester=pause,
    )

    screenshot = await executor.capture()

    assert screenshot.startswith("data:image/png;base64,")
    assert len(events.uploads) == 1
    assert browser.recoveries == 0
    assert pauses[0].preserve_page is True


@pytest.mark.asyncio
async def test_unchanged_screenshot_reuses_evidence_without_duplicate_upload() -> None:
    browser = FakeBrowser({"name": "search", "aria_label": "Search"})
    events = FakeEventSink()
    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.RETAIL,
        run_id="run-1",
        event_sink=events,
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"amazon.eg"},
        merchant_attempt_getter=lambda: "attempt-1",
    )

    first = await executor.capture()
    second = await executor.capture()

    assert second == first
    assert len(events.uploads) == 1
    assert len(executor.evidence_ids) == 1
    assert executor.evidence_by_attempt == {"attempt-1": executor.evidence_ids}


@pytest.mark.asyncio
async def test_page_text_returns_only_visible_approved_domain_links() -> None:
    class LinkBrowser(FakeBrowser):
        def visible_text(self, max_chars: int) -> dict[str, Any]:
            assert max_chars == 20_000
            return {
                "url": "https://www.amazon.eg/search?q=mouse",
                "title": "Results",
                "text": "Logitech M171",
                "truncated": False,
                "links": [
                    {
                        "label": "Logitech M171",
                        "url": "https://www.amazon.eg/logitech-m171/dp/example?q=mouse",
                    },
                    {"label": "External", "url": "https://example.com/tracker"},
                ],
            }

    executor = BrowserActionExecutor(
        LinkBrowser({"name": "search", "aria_label": "Search"}),  # type: ignore[arg-type]
        category=Category.RETAIL,
        run_id="run-1",
        event_sink=FakeEventSink(),
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"amazon.eg"},
    )

    page = await executor.read_page_text()

    assert page["links"] == [
        {
            "label": "Logitech M171",
            "url": "https://www.amazon.eg/logitech-m171/dp/example?q=mouse",
        }
    ]


@pytest.mark.asyncio
async def test_payment_click_is_blocked_before_selenium_action() -> None:
    browser = FakeBrowser({"tag": "button", "text": "Place order"})
    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.FOOD,
        run_id="run-1",
        event_sink=FakeEventSink(),
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"talabat.com"},
    )
    with pytest.raises(SafetyViolation, match="final"):
        await executor.execute({"type": "click", "x": 10, "y": 20})
    assert browser.clicks == []


@pytest.mark.asyncio
async def test_changed_click_target_requests_visual_retry_before_clicking() -> None:
    browser = FakeBrowser(
        {
            "tag": "button",
            "text": "Open cart",
            "interactive": True,
            "disabled": False,
        }
    )
    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.RETAIL,
        run_id="run-1",
        event_sink=FakeEventSink(),
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"amazon.eg"},
    )

    with pytest.raises(VisualFallbackRequired, match="no longer match"):
        await executor.execute({"type": "click", "x": 10, "y": 20, "target": "Continue to results"})

    assert browser.clicks == []


@pytest.mark.asyncio
async def test_matching_click_target_ignores_generic_control_words() -> None:
    browser = FakeBrowser(
        {
            "tag": "button",
            "text": "Search",
            "interactive": True,
            "disabled": False,
        }
    )
    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.RETAIL,
        run_id="run-1",
        event_sink=FakeEventSink(),
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"amazon.eg"},
    )

    await executor.execute({"type": "click", "x": 10, "y": 20, "target": "Search button"})

    assert browser.clicks == [(10, 20)]


@pytest.mark.asyncio
async def test_human_only_pause_preserves_current_page_for_takeover() -> None:
    class RecoverTrackingBrowser(FakeBrowser):
        def __init__(self) -> None:
            super().__init__({"tag": "button", "text": "Verify"})
            self.recoveries = 0

        def recover_last_safe(self, category: Category, approved_domains: set[str]) -> None:
            self.recoveries += 1
            super().recover_last_safe(category, approved_domains)

    browser = RecoverTrackingBrowser()
    pauses: list[PauseRequired] = []

    async def pause(exc: PauseRequired) -> None:
        pauses.append(exc)

    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.RETAIL,
        run_id="run-1",
        event_sink=FakeEventSink(),
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"amazon.eg"},
        pause_requester=pause,
    )
    await executor.pause_for_safety(
        PauseRequired(
            PauseReason.CAPTCHA,
            "CAPTCHA/human verification detected",
            preserve_page=True,
        )
    )

    assert browser.recoveries == 0
    assert pauses[0].preserve_page is True


@pytest.mark.asyncio
async def test_blocked_action_pauses_and_keeps_last_safe_screenshot() -> None:
    browser = FakeBrowser({"tag": "a", "text": "Samsung Galaxy A55"})
    pauses: list[PauseRequired] = []

    async def pause(exc: PauseRequired) -> None:
        pauses.append(exc)

    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.RETAIL,
        run_id="run-1",
        event_sink=FakeEventSink(),
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"amazon.eg"},
        pause_requester=pause,
    )
    safe_screenshot = await executor.capture()
    browser.metadata = {"tag": "button", "text": "Buy now"}

    assert await executor.execute({"type": "click", "x": 10, "y": 20}) == safe_screenshot
    assert browser.clicks == []
    assert [exc.reason_code for exc in pauses] == [PauseReason.BROWSER_WARNING]


@pytest.mark.asyncio
async def test_login_pause_preserves_authentication_handoff_page() -> None:
    class LoginGateBrowser(FakeBrowser):
        def __init__(self) -> None:
            super().__init__({"tag": "input", "aria_label": "Email or Mobile Number"})
            self.recovered = False

        def recover_last_safe(self, category: Category, approved_domains: set[str]) -> None:
            self.recovered = True

    browser = LoginGateBrowser()
    pauses: list[PauseRequired] = []

    async def pause(exc: PauseRequired) -> None:
        pauses.append(exc)

    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.RETAIL,
        run_id="run-1",
        event_sink=FakeEventSink(),
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"jumia.com.eg"},
        pause_requester=pause,
    )
    await executor.pause_for_safety(
        PauseRequired(
            PauseReason.LOGIN,
            "Login must be completed by the user",
            preserve_page=True,
        )
    )

    assert browser.recovered is False
    assert [exc.reason_code for exc in pauses] == [PauseReason.LOGIN]


@pytest.mark.asyncio
async def test_enter_key_cannot_activate_place_order() -> None:
    browser = FakeBrowser({"tag": "button", "text": "Place order"})
    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.FOOD,
        run_id="run-1",
        event_sink=FakeEventSink(),
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"talabat.com"},
    )
    with pytest.raises(SafetyViolation, match="final"):
        await executor.execute({"type": "keypress", "keys": ["ENTER"]})


@pytest.mark.asyncio
async def test_seat_hold_approval_precedes_selection_and_expiry_is_recorded() -> None:
    html = (FIXTURES / "seat_hold.html").read_text(encoding="utf-8")
    assert "Hold expires at 19:42" in html
    browser = FakeBrowser(
        {"tag": "button", "role": "checkbox", "data_kind": "seat", "aria_label": "Seat A7"},
        hold_expiry="19:42",
    )
    events = FakeEventSink()
    approval_details: list[dict[str, Any]] = []

    async def seat_approval(kind: ApprovalType, details: dict[str, Any]) -> bool:
        assert kind is ApprovalType.SEAT_HOLD
        browser.sequence.append("approval")
        approval_details.append(details)
        return True

    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.CINEMA,
        run_id="run-1",
        event_sink=events,
        secret_resolver=FakeResolver(),
        approval_requester=seat_approval,
        approved_domains={"voxcinemas.com"},
    )
    await executor.execute({"type": "click", "x": 100, "y": 200})

    assert browser.sequence == ["approval", "click"]
    assert approval_details[0]["hold_expires_at"] == "19:42"
    hold_events = [
        payload
        for name, payload in events.events
        if name == "evidence.captured" and payload["kind"] == "seat_hold"
    ]
    assert len(hold_events) == 1


def test_native_screenshot_masks_then_restores_dom() -> None:
    class Driver:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[Any, ...]]] = []

        def execute_script(self, script: str, *args: Any) -> None:
            self.calls.append((script, args))

        def get_screenshot_as_png(self) -> bytes:
            return b"native-png"

    driver = Driver()
    nested_fixture = (FIXTURES / "nested_address.html").read_text(encoding="utf-8")
    assert "attachShadow" in nested_fixture and "srcdoc" in nested_fixture
    browser = SeleniumRemoteBrowser("http://fake")
    browser.driver = driver
    assert browser.masked_screenshot((FakeResolver.value,)) == b"native-png"
    assert driver.calls[0][1] == ([FakeResolver.value],)
    assert "shadowRoot" in driver.calls[0][0]
    assert "contentDocument" in driver.calls[0][0]
    assert "delete window.__dealpilotRedactions" in driver.calls[-1][0]


def test_redactor_masks_common_egyptian_phone_variants() -> None:
    redactor = SecretRedactor()
    redactor.add("+201012345678")
    assert "[REDACTED]" in redactor.mask("Call +201012345678")
    assert "[REDACTED]" in redactor.mask("Call 01012345678")


@pytest.mark.asyncio
async def test_icon_child_click_in_final_button_is_blocked() -> None:
    browser = FakeBrowser(
        {
            "tag": "button",
            "leaf_tag": "svg",
            "child_text": "Confirm booking",
            "aria_label": "checkout action",
        }
    )
    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.CINEMA,
        run_id="run-1",
        event_sink=FakeEventSink(),
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"voxcinemas.com"},
    )
    with pytest.raises(SafetyViolation, match="final"):
        await executor.execute({"type": "click", "x": 10, "y": 20})
    assert browser.clicks == []


@pytest.mark.asyncio
async def test_enter_cannot_submit_form_containing_final_action() -> None:
    browser = FakeBrowser(
        {
            "tag": "input",
            "name": "coupon",
            "form_action": "https://www.talabat.com/egypt/checkout",
            "form_text": "Coupon code    Place order",
        }
    )
    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.FOOD,
        run_id="run-1",
        event_sink=FakeEventSink(),
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"talabat.com"},
    )
    with pytest.raises(SafetyViolation, match="final"):
        await executor.execute({"type": "keypress", "keys": ["RETURN"]})


@pytest.mark.asyncio
async def test_type_action_newline_cannot_submit_final_form() -> None:
    browser = FakeBrowser(
        {
            "tag": "input",
            "name": "notes",
            "form_action": "https://www.talabat.com/egypt/checkout",
            "form_text": "Delivery notes    Confirm order",
        }
    )
    executor = BrowserActionExecutor(
        browser,  # type: ignore[arg-type]
        category=Category.FOOD,
        run_id="run-1",
        event_sink=FakeEventSink(),
        secret_resolver=FakeResolver(),
        approval_requester=approve,
        approved_domains={"talabat.com"},
    )
    with pytest.raises(SafetyViolation, match="final"):
        await executor.execute({"type": "type", "text": "deliver at door\n"})
    assert browser.typed == []
