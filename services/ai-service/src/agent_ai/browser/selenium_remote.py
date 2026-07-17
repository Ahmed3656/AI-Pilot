from __future__ import annotations

import asyncio
import base64
import re
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys

from agent_ai.browser.safety import (
    SafetyViolation,
    assert_allowed_url,
    assert_not_card_field,
    assert_not_final_action,
    assert_not_login_field,
    inspect_page_for_pause,
    is_address_field,
    is_seat_hold_element,
)
from agent_ai.models import ApprovalType, Category

_SECRET_PATTERN = re.compile(r"\{\{secret:([a-zA-Z0-9_.:/-]+)}}")

_ELEMENT_AT_POINT = """
const el = document.elementFromPoint(arguments[0], arguments[1]);
if (!el) return null;
return {
  tag: el.tagName.toLowerCase(),
  text: (el.innerText || el.value || '').slice(0, 500),
  role: el.getAttribute('role'),
  type: el.getAttribute('type'),
  name: el.getAttribute('name'),
  aria_label: el.getAttribute('aria-label'),
  title: el.getAttribute('title'),
  autocomplete: el.getAttribute('autocomplete'),
  data_kind: el.getAttribute('data-kind') || el.getAttribute('data-seat') && 'seat'
};
"""

_ACTIVE_ELEMENT = """
const el = document.activeElement;
if (!el) return null;
return {
  tag: el.tagName.toLowerCase(), text: '', role: el.getAttribute('role'),
  type: el.getAttribute('type'), name: el.getAttribute('name'),
  aria_label: el.getAttribute('aria-label'), title: el.getAttribute('title'),
  autocomplete: el.getAttribute('autocomplete'),
  data_kind: el.getAttribute('data-kind')
};
"""

_MASK_PAGE = """
window.__dealpilotRedactions = [];
const secrets = arguments[0].filter(Boolean).sort((a, b) => b.length - a.length);
const mask = (value) => {
  let result = value;
  for (const secret of secrets) result = result.split(secret).join('[REDACTED]');
  return result;
};
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
let node;
while ((node = walker.nextNode())) {
  const masked = mask(node.nodeValue || '');
  if (masked !== node.nodeValue) {
    window.__dealpilotRedactions.push({node, value: node.nodeValue, kind: 'text'});
    node.nodeValue = masked;
  }
}
for (const el of document.querySelectorAll('input, textarea')) {
  const cardField = (el.getAttribute('autocomplete') || '').startsWith('cc-') ||
    /card|cvv|cvc|expiry/i.test(`${el.name || ''} ${el.id || ''}`);
  const masked = cardField && el.value ? '[REDACTED]' : mask(el.value || '');
  if (masked !== el.value) {
    window.__dealpilotRedactions.push({node: el, value: el.value, kind: 'value'});
    el.value = masked;
  }
}
"""

_RESTORE_PAGE = """
for (const item of (window.__dealpilotRedactions || [])) {
  if (item.kind === 'text') item.node.nodeValue = item.value;
  else item.node.value = item.value;
}
delete window.__dealpilotRedactions;
"""


class SecretResolver(Protocol):
    async def resolve_secret(self, handle: str, run_id: str) -> str: ...


class EventSink(Protocol):
    async def emit(self, run_id: str, event_type: str, payload: dict[str, Any]) -> None: ...


ApprovalRequester = Callable[[ApprovalType, dict[str, Any]], Awaitable[bool]]


@dataclass(slots=True)
class SecretRedactor:
    _values: set[str] = field(default_factory=set)

    def add(self, value: str) -> None:
        if value:
            self._values.add(value)

    @property
    def values(self) -> tuple[str, ...]:
        return tuple(self._values)

    def mask(self, value: str) -> str:
        masked = value
        for secret in sorted(self._values, key=len, reverse=True):
            masked = masked.replace(secret, "[REDACTED]")
        return masked


class SeleniumRemoteBrowser:
    """Hardened synchronous Selenium boundary; orchestration invokes it via to_thread."""

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

    def connect(self) -> None:
        if self.driver is not None:
            return
        options = webdriver.ChromeOptions()
        options.add_argument("--disable-notifications")
        options.add_argument("--window-size=1440,1000")
        self.driver = self._driver_factory(command_executor=self.remote_url, options=options)

    def close(self) -> None:
        if self.driver is not None:
            self.driver.quit()
            self.driver = None

    def navigate(self, url: str, category: Category, *, separate_tab: bool = False) -> None:
        self.connect()
        assert self.driver is not None
        domain = assert_allowed_url(url, category)
        if separate_tab and domain not in self.tabs:
            self.driver.switch_to.new_window("tab")
            self.tabs[domain] = self.driver.current_window_handle
        elif domain in self.tabs:
            self.driver.switch_to.window(self.tabs[domain])
        else:
            self.tabs[domain] = self.driver.current_window_handle
        self.expected_domain = domain
        self.driver.get(url)
        self.guard(category)

    def guard(self, category: Category) -> None:
        assert self.driver is not None
        inspect_page_for_pause(self.driver.page_source, self.driver.current_url)
        domain = assert_allowed_url(self.driver.current_url, category)
        if domain != self.expected_domain:
            known_tab = self.tabs.get(domain) == self.driver.current_window_handle
            if category is Category.RETAIL and known_tab:
                self.expected_domain = domain
            else:
                assert_allowed_url(self.driver.current_url, category, self.expected_domain)

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
        if button == "back":
            self.driver.back()
            return
        if button == "forward":
            self.driver.forward()
            return
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
        """Return the browser's native PNG after masking secret text in the live DOM."""
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
        redactor: SecretRedactor | None = None,
    ) -> None:
        self.browser = browser
        self.category = category
        self.run_id = run_id
        self.event_sink = event_sink
        self.secret_resolver = secret_resolver
        self.approval_requester = approval_requester
        self.redactor = redactor or SecretRedactor()

    async def execute(self, action: Mapping[str, Any]) -> str:
        kind = str(action.get("type", ""))
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
                separate_tab=self.category is Category.RETAIL,
            )
        else:
            raise SafetyViolation(f"Unsupported computer action: {kind}")

        await asyncio.to_thread(self.browser.guard, self.category)
        return await self.capture(action=kind)

    async def capture(self, *, action: str = "observe") -> str:
        await asyncio.to_thread(self.browser.guard, self.category)
        png = await asyncio.to_thread(self.browser.masked_screenshot, self.redactor.values)
        screenshot = base64.b64encode(png).decode("ascii")
        await self.event_sink.emit(
            self.run_id,
            "screenshot",
            {
                "mime_type": "image/png",
                "encoding": "base64",
                "data": screenshot,
                "url": (
                    self.redactor.mask(self.browser.driver.current_url)
                    if self.browser.driver
                    else None
                ),
                "original_resolution": True,
            },
        )
        await self.event_sink.emit(
            self.run_id,
            "progress",
            {"action": action, "domain": self.browser.expected_domain},
        )
        return f"data:image/png;base64,{screenshot}"

    async def _click(self, action: Mapping[str, Any], *, double: bool) -> None:
        x, y = int(action["x"]), int(action["y"])
        metadata = await asyncio.to_thread(self.browser.metadata_at, x, y)
        assert_not_card_field(metadata)
        assert_not_final_action(metadata)
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
                    "element": metadata,
                    "hold_expires_at": hold_expiry,
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
            await self.event_sink.emit(
                self.run_id,
                "seat_hold_created",
                {
                    "hold_expires_at": hold_expiry,
                    "element": metadata,
                    "url": (
                        self.redactor.mask(self.browser.driver.current_url)
                        if self.browser.driver
                        else None
                    ),
                },
            )

    async def _validate_drag(self, path: list[dict[str, int]]) -> None:
        if len(path) < 2:
            raise SafetyViolation("Drag action requires at least two coordinates")
        for point in (path[0], path[-1]):
            metadata = await asyncio.to_thread(
                self.browser.metadata_at, point["x"], point["y"]
            )
            assert_not_card_field(metadata)
            assert_not_final_action(metadata)

    async def _type(self, text: str) -> None:
        metadata = await asyncio.to_thread(self.browser.active_metadata)
        assert_not_card_field(metadata)
        assert_not_login_field(metadata)
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
        if {key.upper() for key in keys} & {"ENTER", "RETURN", "SPACE"}:
            assert_not_final_action(metadata)
        await asyncio.to_thread(self.browser.keypress, keys)
