from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from agent_ai.browser.safety import SafetyViolation
from agent_ai.browser.selenium_remote import BrowserActionExecutor, SeleniumRemoteBrowser
from agent_ai.models import ApprovalType, Category

FIXTURES = Path(__file__).parent / "fixtures"


class FakeEventSink:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    async def emit(self, run_id: str, event_type: str, payload: dict[str, Any]) -> None:
        assert run_id == "run-1"
        self.events.append((event_type, payload))


class FakeResolver:
    value = "12 Secret Street, Cairo"

    async def resolve_secret(self, handle: str, run_id: str) -> str:
        assert handle == "delivery.home"
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

    def guard(self, category: Category) -> None:
        assert category in Category

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
    )
    await executor.execute({"type": "type", "text": "{{secret:delivery.home}}"})

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
    )
    with pytest.raises(SafetyViolation, match="address fields"):
        await executor.execute({"type": "type", "text": "{{secret:delivery.home}}"})
    assert browser.typed == []


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
    )
    with pytest.raises(SafetyViolation, match="final"):
        await executor.execute({"type": "click", "x": 10, "y": 20})
    assert browser.clicks == []


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
    )
    await executor.execute({"type": "click", "x": 100, "y": 200})

    assert browser.sequence == ["approval", "click"]
    assert approval_details[0]["hold_expires_at"] == "19:42"
    hold_events = [payload for name, payload in events.events if name == "seat_hold_created"]
    assert hold_events[0]["hold_expires_at"] == "19:42"


def test_native_screenshot_masks_then_restores_dom() -> None:
    class Driver:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[Any, ...]]] = []

        def execute_script(self, script: str, *args: Any) -> None:
            self.calls.append((script, args))

        def get_screenshot_as_png(self) -> bytes:
            return b"native-png"

    driver = Driver()
    browser = SeleniumRemoteBrowser("http://fake")
    browser.driver = driver
    assert browser.masked_screenshot((FakeResolver.value,)) == b"native-png"
    assert driver.calls[0][1] == ([FakeResolver.value],)
    assert "delete window.__dealpilotRedactions" in driver.calls[-1][0]
