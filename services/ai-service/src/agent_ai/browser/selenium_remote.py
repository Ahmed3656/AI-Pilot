from __future__ import annotations

import asyncio
import base64
import hashlib
import re
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import quote, urlsplit, urlunsplit
from uuid import uuid4

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys

from agent_ai.browser.safety import (
    PauseRequired,
    SafetyViolation,
    assert_allowed_url,
    assert_navigation_metadata_allowed,
    assert_not_card_field,
    assert_not_final_action,
    assert_not_login_field,
    inspect_page_for_pause,
    is_address_field,
    is_seat_hold_element,
)
from agent_ai.models import ApprovalType, Category, RunStatus

_SECRET_PATTERN = re.compile(r"\{\{secret:([a-zA-Z0-9]+)}}")

_ELEMENT_AT_POINT = """
const leaf = document.elementFromPoint(arguments[0], arguments[1]);
if (!leaf) return null;
const selector = 'button, a, input, [role="button"], [role="link"], [type="submit"]';
const control = leaf.closest(selector) || leaf;
const form = control.closest('form');
const text = (control.innerText || control.value || control.textContent || '').slice(0, 1000);
const childText = Array.from(control.querySelectorAll('[aria-label], [title], img[alt], svg title'))
  .map((el) => [el.getAttribute('aria-label'), el.getAttribute('title'),
    el.getAttribute('alt'), el.textContent].filter(Boolean).join(' '))
  .join(' ').slice(0, 1000);
return {
  tag: control.tagName.toLowerCase(),
  leaf_tag: leaf.tagName.toLowerCase(),
  text,
  child_text: childText,
  role: control.getAttribute('role'),
  type: control.getAttribute('type'),
  name: control.getAttribute('name'),
  value: control.getAttribute('value'),
  aria_label: control.getAttribute('aria-label'),
  leaf_aria_label: leaf.getAttribute('aria-label'),
  title: control.getAttribute('title'),
  autocomplete: control.getAttribute('autocomplete'),
  data_kind: control.getAttribute('data-kind') || (control.getAttribute('data-seat') && 'seat'),
  href: control.href || null,
  form_action: form ? form.action : null,
  form_method: form ? (form.method || 'get') : null,
  form_text: form ? (form.innerText || form.textContent || '').slice(0, 2000) : null
};
"""

_ACTIVE_ELEMENT = """
const el = document.activeElement;
if (!el) return null;
const form = el.closest ? el.closest('form') : null;
return {
  tag: el.tagName.toLowerCase(),
  text: (el.innerText || '').slice(0, 500),
  role: el.getAttribute('role'),
  type: el.getAttribute('type'),
  name: el.getAttribute('name'),
  aria_label: el.getAttribute('aria-label'),
  title: el.getAttribute('title'),
  autocomplete: el.getAttribute('autocomplete'),
  data_kind: el.getAttribute('data-kind'),
  form_action: form ? form.action : null,
  form_method: form ? (form.method || 'get') : null,
  form_text: form ? (form.innerText || form.textContent || '').slice(0, 2000) : null
};
"""

_MASK_PAGE = """
window.__dealpilotRedactions = [];
const secrets = arguments[0].filter(Boolean).sort((a, b) => b.length - a.length);
const mask = (value) => {
  let result = String(value || '');
  for (const secret of secrets) result = result.split(secret).join('[REDACTED]');
  return result;
};
const record = (node, kind, key, value) => {
  window.__dealpilotRedactions.push({node, kind, key, value});
};
const visit = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const original = node.nodeValue || '';
    const masked = mask(original);
    if (masked !== original) {
      record(node, 'text', null, original);
      node.nodeValue = masked;
    }
  }
  const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
  for (const el of elements) {
    if ('value' in el) {
      const original = String(el.value || '');
      const cardField = (el.getAttribute('autocomplete') || '').startsWith('cc-') ||
        /card|cvv|cvc|expiry/i.test(`${el.name || ''} ${el.id || ''}`);
      const masked = cardField && original ? '[REDACTED]' : mask(original);
      if (masked !== original) {
        record(el, 'value', null, original);
        el.value = masked;
      }
    }
    for (const key of ['aria-label', 'title', 'placeholder', 'alt']) {
      if (!el.hasAttribute || !el.hasAttribute(key)) continue;
      const original = el.getAttribute(key) || '';
      const masked = mask(original);
      if (masked !== original) {
        record(el, 'attribute', key, original);
        el.setAttribute(key, masked);
      }
    }
    if (el.shadowRoot) visit(el.shadowRoot);
    if (el.tagName === 'IFRAME') {
      try { if (el.contentDocument) visit(el.contentDocument); } catch (_) {}
    }
  }
};
visit(document);
"""

_RESTORE_PAGE = """
for (const item of (window.__dealpilotRedactions || []).reverse()) {
  if (item.kind === 'text') item.node.nodeValue = item.value;
  else if (item.kind === 'value') item.node.value = item.value;
  else item.node.setAttribute(item.key, item.value);
}
delete window.__dealpilotRedactions;
"""


class SecretResolver(Protocol):
    async def resolve_secret(self, handle: str, run_id: str) -> str: ...


class EventSink(Protocol):
    async def emit(
        self,
        run_id: str,
        event_type: str,
        payload: dict[str, Any],
        *,
        status: RunStatus | None = None,
    ) -> None: ...


ApprovalRequester = Callable[[ApprovalType, dict[str, Any]], Awaitable[bool]]
PauseRequester = Callable[[PauseRequired], Awaitable[None]]
ActiveWaiter = Callable[[], Awaitable[None]]
StatusGetter = Callable[[], RunStatus]
DomainsGetter = Callable[[], Iterable[str]]
MerchantAttemptGetter = Callable[[], str | None]


@dataclass(slots=True)
class SecretRedactor:
    _values: set[str] = field(default_factory=set)

    def add(self, value: str) -> None:
        for variant in _secret_variants(value):
            self._values.add(variant)

    @property
    def values(self) -> tuple[str, ...]:
        return tuple(sorted(self._values, key=len, reverse=True))

    def mask(self, value: str) -> str:
        masked = value
        for secret in self.values:
            masked = masked.replace(secret, "[REDACTED]")
        return masked


def _secret_variants(value: str) -> set[str]:
    variants = {value, " ".join(value.split())}
    digits = re.sub(r"\D", "", value)
    if len(digits) >= 10:
        variants.update({digits, " ".join(digits), "-".join(digits)})
        if digits.startswith("20") and len(digits) == 12:
            local = f"0{digits[2:]}"
            variants.update({f"+{digits}", local, " ".join(local)})
        elif digits.startswith("01") and len(digits) == 11:
            variants.update({f"+20{digits[1:]}", f"20{digits[1:]}"})
    return {variant for variant in variants if variant}


class SeleniumRemoteBrowser:
    """Synchronous Selenium boundary; the orchestrator calls it with ``to_thread``."""

    def __init__(
        self,
        remote_url: str,
        *,
        driver_factory: Callable[..., Any] | None = None,
    ) -> None:
        self.remote_url = remote_url
        self._driver_factory = driver_factory or webdriver.Remote
        self.driver: Any | None = None
        self.tabs: dict[str, str] = {}
        self.expected_domain: str | None = None
        self._safe_urls: dict[str, str] = {}
        self._test_fixture_domain: str | None = None

    @property
    def session_id(self) -> str | None:
        return str(self.driver.session_id) if self.driver is not None else None

    def connect(self) -> None:
        if self.driver is not None:
            return
        options = webdriver.ChromeOptions()
        options.add_argument("--disable-notifications")
        options.add_argument("--window-size=1280,800")
        self.driver = self._driver_factory(command_executor=self.remote_url, options=options)
        if hasattr(self.driver, "set_window_size"):
            self.driver.set_window_size(1280, 800)

    def close(self) -> None:
        if self.driver is not None:
            self.driver.quit()
            self.driver = None
            self.tabs.clear()
            self._safe_urls.clear()
            self.expected_domain = None
            self._test_fixture_domain = None

    def load_deterministic_test_fixture(
        self,
        domain: str,
        category: Category,
        approved_domains: Iterable[str],
    ) -> None:
        """Load inert HTML in the real browser for the explicit test adapter only."""
        if domain not in approved_domains:
            raise SafetyViolation("Test fixture domain is not approved")
        self.connect()
        assert self.driver is not None
        self.expected_domain = domain
        self._test_fixture_domain = domain
        html = (
            "<!doctype html><html><head><title>DealPilot deterministic test merchant</title>"
            "</head><body><main><h1>Deterministic integration fixture</h1>"
            f"<p data-domain='{domain}' data-category='{category.value}'>"
            "No purchase or booking controls are present.</p></main></body></html>"
        )
        self.driver.get(f"data:text/html;charset=utf-8,{quote(html)}")

    def navigate(
        self,
        url: str,
        category: Category,
        approved_domains: Iterable[str],
        *,
        separate_tab: bool = False,
    ) -> None:
        approved = frozenset(approved_domains)
        domain = assert_allowed_url(url, category, approved_domains=approved)
        self.connect()
        assert self.driver is not None
        try:
            current_domain = self._validate_current_url(category, approved, allow_blank=True)
            if self.expected_domain and current_domain != self.expected_domain:
                assert_allowed_url(
                    self.driver.current_url,
                    category,
                    expected_domain=self.expected_domain,
                    approved_domains=approved,
                )
        except PauseRequired:
            unsafe_handle = self.driver.current_window_handle
            self._safe_urls.pop(unsafe_handle, None)
            self.tabs = {
                tab_domain: handle
                for tab_domain, handle in self.tabs.items()
                if handle != unsafe_handle
            }
            self.tabs[domain] = unsafe_handle
            self.expected_domain = domain
            self.driver.get(url)
            self.guard(category, approved)
            return
        if separate_tab and domain not in self.tabs and self.tabs:
            self.driver.switch_to.new_window("tab")
            self.tabs[domain] = self.driver.current_window_handle
        elif domain in self.tabs:
            self.driver.switch_to.window(self.tabs[domain])
            self._validate_current_url(category, approved, allow_blank=True)
        else:
            self.tabs[domain] = self.driver.current_window_handle
        self.expected_domain = domain
        self.driver.get(url)
        self.guard(category, approved)

    def guard(self, category: Category, approved_domains: Iterable[str]) -> None:
        assert self.driver is not None
        approved = frozenset(approved_domains)
        origin = self.driver.current_window_handle
        handles = list(self.driver.window_handles)
        for handle in handles:
            self.driver.switch_to.window(handle)
            try:
                domain = self._validate_current_url(category, approved, allow_blank=False)
            except PauseRequired:
                if handle != origin:
                    self.driver.close()
                    self.driver.switch_to.window(origin)
                raise
            if handle == origin and self.expected_domain and domain != self.expected_domain:
                assert_allowed_url(
                    self.driver.current_url,
                    category,
                    expected_domain=self.expected_domain,
                    approved_domains=approved,
                )
            inspect_page_for_pause(self.driver.page_source, self.driver.current_url)
            self._safe_urls[handle] = self.driver.current_url
            self.tabs.setdefault(domain, handle)
        if origin in self.driver.window_handles:
            self.driver.switch_to.window(origin)
        current_domain = self._validate_current_url(category, approved, allow_blank=False)
        if self.expected_domain is not None and current_domain != self.expected_domain:
            assert_allowed_url(
                self.driver.current_url,
                category,
                expected_domain=self.expected_domain,
                approved_domains=approved,
            )

    def recover_last_safe(self, category: Category, approved_domains: Iterable[str]) -> None:
        assert self.driver is not None
        handle = self.driver.current_window_handle
        url = self._safe_urls.get(handle)
        if not url:
            handles = list(self.driver.window_handles)
            if len(handles) > 1:
                self.driver.close()
                self._safe_urls.pop(handle, None)
                self.tabs = {
                    domain: tab_handle
                    for domain, tab_handle in self.tabs.items()
                    if tab_handle != handle
                }
                self.driver.switch_to.window(next(item for item in handles if item != handle))
            return
        assert_allowed_url(url, category, approved_domains=approved_domains)
        self.driver.get(url)
        self.guard(category, approved_domains)

    def _validate_current_url(
        self,
        category: Category,
        approved_domains: Iterable[str],
        *,
        allow_blank: bool,
    ) -> str:
        assert self.driver is not None
        if self._test_fixture_domain and self.driver.current_url.startswith("data:text/html"):
            return self._test_fixture_domain
        if allow_blank and self.driver.current_url == "about:blank":
            return self.expected_domain or ""
        return assert_allowed_url(
            self.driver.current_url,
            category,
            approved_domains=approved_domains,
        )

    def metadata_at(self, x: int, y: int) -> dict[str, Any]:
        assert self.driver is not None
        result = self.driver.execute_script(_ELEMENT_AT_POINT, x, y)
        if not isinstance(result, dict):
            raise SafetyViolation(f"No DOM element found at coordinates ({x}, {y})")
        return result

    def active_metadata(self) -> dict[str, Any]:
        assert self.driver is not None
        result = self.driver.execute_script(_ACTIVE_ELEMENT)
        if not isinstance(result, dict):
            raise SafetyViolation("No active input element")
        return result

    def click(self, x: int, y: int, *, double: bool = False, button: str = "left") -> None:
        assert self.driver is not None
        if button.casefold() in {"back", "forward"}:
            raise SafetyViolation("History navigation is blocked because its target is unknown")
        element = self.driver.execute_script(
            "return document.elementFromPoint(arguments[0], arguments[1])", x, y
        )
        if element is None:
            raise SafetyViolation(f"No DOM element found at coordinates ({x}, {y})")
        actions = ActionChains(self.driver).move_to_element(element)
        if double:
            actions.double_click(element)
        elif button == "right":
            actions.context_click(element)
        else:
            actions.click(element)
        actions.perform()

    def move(self, x: int, y: int) -> None:
        assert self.driver is not None
        element = self.driver.execute_script(
            "return document.elementFromPoint(arguments[0], arguments[1])", x, y
        )
        if element is None:
            raise SafetyViolation(f"No DOM element found at coordinates ({x}, {y})")
        ActionChains(self.driver).move_to_element(element).perform()

    def drag(self, path: list[dict[str, int]]) -> None:
        assert self.driver is not None
        if len(path) < 2:
            raise SafetyViolation("Drag action requires at least two coordinates")
        elements = [
            self.driver.execute_script(
                "return document.elementFromPoint(arguments[0], arguments[1])",
                point["x"],
                point["y"],
            )
            for point in path
        ]
        if any(element is None for element in elements):
            raise SafetyViolation("Drag path crosses a point with no DOM element")
        actions = ActionChains(self.driver).move_to_element(elements[0]).click_and_hold()
        for element in elements[1:]:
            actions.move_to_element(element)
        actions.release().perform()

    def type_text(self, text: str) -> None:
        assert self.driver is not None
        self.driver.switch_to.active_element.send_keys(text)

    def keypress(self, keys: list[str]) -> None:
        assert self.driver is not None
        aliases = {
            "ALT": Keys.ALT,
            "BACKSPACE": Keys.BACKSPACE,
            "CMD": Keys.COMMAND,
            "CTRL": Keys.CONTROL,
            "ESC": Keys.ESCAPE,
            "RETURN": Keys.ENTER,
        }
        mapped = [aliases.get(key.upper(), getattr(Keys, key.upper(), key)) for key in keys]
        self.driver.switch_to.active_element.send_keys(*mapped)

    def scroll(self, delta_x: int, delta_y: int) -> None:
        assert self.driver is not None
        self.driver.execute_script("window.scrollBy(arguments[0], arguments[1])", delta_x, delta_y)

    def masked_screenshot(self, secrets: tuple[str, ...]) -> bytes:
        """Return a native-resolution PNG after recursive same-origin DOM redaction."""
        assert self.driver is not None
        self.driver.execute_script(_MASK_PAGE, list(secrets))
        try:
            return self.driver.get_screenshot_as_png()
        finally:
            self.driver.execute_script(_RESTORE_PAGE)

    def find_hold_expiry(self) -> str | None:
        assert self.driver is not None
        page = " ".join(self.driver.page_source.split())
        match = re.search(
            r"(?:hold expires|held until|expires in|ينتهي الحجز|متبقي)\s*(?:at|بعد|:)?\s*"
            r"([0-9٠-٩۰-۹:]{2,8}(?:\s*[AP]M)?)",
            page,
            re.IGNORECASE,
        )
        return match.group(1) if match else None


class BrowserActionExecutor:
    def __init__(
        self,
        browser: SeleniumRemoteBrowser,
        *,
        category: Category,
        run_id: str,
        event_sink: EventSink,
        secret_resolver: SecretResolver,
        approval_requester: ApprovalRequester,
        approved_domains: Iterable[str] | DomainsGetter,
        pause_requester: PauseRequester | None = None,
        wait_until_active: ActiveWaiter | None = None,
        status_getter: StatusGetter | None = None,
        merchant_attempt_getter: MerchantAttemptGetter | None = None,
        action_lock: asyncio.Lock | None = None,
        redactor: SecretRedactor | None = None,
    ) -> None:
        self.browser = browser
        self.category = category
        self.run_id = run_id
        self.event_sink = event_sink
        self.secret_resolver = secret_resolver
        self.approval_requester = approval_requester
        self._approved_domains = approved_domains
        self.pause_requester = pause_requester
        self.wait_until_active = wait_until_active or _noop_wait
        self.status_getter = status_getter or (lambda: RunStatus.COMPARING)
        self.merchant_attempt_getter = merchant_attempt_getter or (lambda: None)
        self.action_lock = action_lock or asyncio.Lock()
        self.redactor = redactor or SecretRedactor()
        self.evidence_ids: list[str] = []
        self.evidence_by_attempt: dict[str, list[str]] = {}
        self._last_screenshot: str | None = None

    @property
    def approved_domains(self) -> frozenset[str]:
        value = (
            self._approved_domains() if callable(self._approved_domains) else self._approved_domains
        )
        return frozenset(value)

    async def execute(self, action: Mapping[str, Any]) -> str:
        await self.wait_until_active()
        kind = str(action.get("type", ""))
        try:
            async with self.action_lock:
                await self.wait_until_active()
                await asyncio.to_thread(self.browser.guard, self.category, self.approved_domains)
                if kind in {"click", "double_click"}:
                    await self._click(action, double=kind == "double_click")
                elif kind == "type":
                    await self._type(str(action.get("text", "")))
                elif kind == "keypress":
                    keys = action.get("keys", [])
                    await self._keypress([str(key) for key in keys])
                elif kind == "scroll":
                    await asyncio.to_thread(
                        self.browser.scroll,
                        int(action.get("scroll_x", action.get("delta_x", 0))),
                        int(action.get("scroll_y", action.get("delta_y", 0))),
                    )
                elif kind == "move":
                    await asyncio.to_thread(self.browser.move, int(action["x"]), int(action["y"]))
                elif kind == "drag":
                    raw_path = action.get("path", [])
                    path = [{"x": int(point["x"]), "y": int(point["y"])} for point in raw_path]
                    await self._validate_drag(path)
                    await asyncio.to_thread(self.browser.drag, path)
                elif kind == "screenshot":
                    pass
                elif kind == "wait":
                    await asyncio.sleep(min(float(action.get("seconds", 1)), 10))
                elif kind == "navigate":
                    await asyncio.to_thread(
                        self.browser.navigate,
                        str(action["url"]),
                        self.category,
                        self.approved_domains,
                        separate_tab=self.category is Category.RETAIL,
                    )
                else:
                    raise SafetyViolation(f"Unsupported computer action: {kind}")
                await asyncio.to_thread(self.browser.guard, self.category, self.approved_domains)
        except PauseRequired as exc:
            await self._pause_safely(exc)
            if self._last_screenshot is None:
                raise SafetyViolation(
                    "Safety pause occurred before a safe screenshot was captured"
                ) from exc
            return self._last_screenshot
        return await self.capture(action=kind)

    async def capture(self, *, action: str = "observe") -> str:
        await self.wait_until_active()
        async with self.action_lock:
            await self.wait_until_active()
            await asyncio.to_thread(self.browser.guard, self.category, self.approved_domains)
            png = await asyncio.to_thread(self.browser.masked_screenshot, self.redactor.values)
        screenshot = base64.b64encode(png).decode("ascii")
        evidence_id = f"evidence:{uuid4()}"
        self.evidence_ids.append(evidence_id)
        attempt_id = self.merchant_attempt_getter()
        if attempt_id:
            self.evidence_by_attempt.setdefault(attempt_id, []).append(evidence_id)
        await self.event_sink.emit(
            self.run_id,
            "evidence.captured",
            {
                "evidenceId": evidence_id,
                "kind": "screenshot",
                "merchantAttemptId": attempt_id,
                "redacted": True,
            },
            status=self.status_getter(),
        )
        self._last_screenshot = f"data:image/png;base64,{screenshot}"
        return self._last_screenshot

    async def _pause_safely(self, exc: PauseRequired) -> None:
        try:
            await asyncio.to_thread(
                self.browser.recover_last_safe, self.category, self.approved_domains
            )
        except (PauseRequired, SafetyViolation):
            pass
        if self.pause_requester is None:
            await self.event_sink.emit(
                self.run_id,
                "run.warning",
                {
                    "code": exc.reason_code.value,
                    "message": self.redactor.mask(exc.reason),
                    "merchantAttemptId": None,
                    "evidenceIds": [],
                },
                status=RunStatus.PAUSED,
            )
            raise exc
        await self.pause_requester(exc)

    async def pause_for_safety(self, exc: PauseRequired) -> None:
        await self._pause_safely(exc)

    async def _click(self, action: Mapping[str, Any], *, double: bool) -> None:
        x, y = int(action["x"]), int(action["y"])
        metadata = await asyncio.to_thread(self.browser.metadata_at, x, y)
        assert_not_card_field(metadata)
        assert_not_final_action(metadata)
        assert_navigation_metadata_allowed(metadata, self.category, self.approved_domains)
        creates_hold = bool(action.get("creates_seat_hold")) or (
            self.category is Category.CINEMA and is_seat_hold_element(metadata)
        )
        if creates_hold:
            hold_expiry = action.get("hold_expires_at") or await asyncio.to_thread(
                self.browser.find_hold_expiry
            )
            approved = await self.approval_requester(
                ApprovalType.SEAT_HOLD,
                {
                    "hold_expires_at": hold_expiry,
                    "merchant_domain": self.browser.expected_domain,
                    "message": "Seat selection may create a temporary hold.",
                },
            )
            if not approved:
                raise SafetyViolation("Seat-hold approval was denied; no seat was selected")
        await asyncio.to_thread(
            self.browser.click,
            x,
            y,
            double=double,
            button=str(action.get("button", "left")),
        )
        if creates_hold:
            hold_expiry = await asyncio.to_thread(self.browser.find_hold_expiry) or hold_expiry
            evidence_id = f"evidence:{uuid4()}"
            self.evidence_ids.append(evidence_id)
            attempt_id = self.merchant_attempt_getter()
            if attempt_id:
                self.evidence_by_attempt.setdefault(attempt_id, []).append(evidence_id)
            await self.event_sink.emit(
                self.run_id,
                "evidence.captured",
                {
                    "evidenceId": evidence_id,
                    "kind": "seat_hold",
                    "merchantAttemptId": attempt_id,
                    "redacted": True,
                },
                status=self.status_getter(),
            )

    async def _validate_drag(self, path: list[dict[str, int]]) -> None:
        if len(path) < 2:
            raise SafetyViolation("Drag action requires at least two coordinates")
        for point in (path[0], path[-1]):
            metadata = await asyncio.to_thread(self.browser.metadata_at, point["x"], point["y"])
            assert_not_card_field(metadata)
            assert_not_final_action(metadata)
            assert_navigation_metadata_allowed(metadata, self.category, self.approved_domains)

    async def _type(self, text: str) -> None:
        metadata = await asyncio.to_thread(self.browser.active_metadata)
        assert_not_card_field(metadata)
        assert_not_login_field(metadata)
        assert_navigation_metadata_allowed(metadata, self.category, self.approved_domains)
        if "\n" in text or "\r" in text:
            assert_not_final_action(metadata)
        matches = list(_SECRET_PATTERN.finditer(text))
        rendered = text
        for match in matches:
            if not is_address_field(metadata):
                raise SafetyViolation(
                    "Semantic address secrets may be entered only in address fields"
                )
            secret = await self.secret_resolver.resolve_secret(match.group(1), self.run_id)
            self.redactor.add(secret)
            rendered = rendered.replace(match.group(0), secret)
        await asyncio.to_thread(self.browser.type_text, rendered)

    async def _keypress(self, keys: list[str]) -> None:
        metadata = await asyncio.to_thread(self.browser.active_metadata)
        assert_not_card_field(metadata)
        assert_not_login_field(metadata)
        assert_navigation_metadata_allowed(metadata, self.category, self.approved_domains)
        if {key.upper() for key in keys} & {"ENTER", "RETURN", "SPACE"}:
            assert_not_final_action(metadata)
        await asyncio.to_thread(self.browser.keypress, keys)


async def _noop_wait() -> None:
    return None


def safe_url_for_event(url: str, redactor: SecretRedactor) -> str:
    parsed = urlsplit(redactor.mask(url))
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def screenshot_sha256(png: bytes) -> str:
    return hashlib.sha256(png).hexdigest()
