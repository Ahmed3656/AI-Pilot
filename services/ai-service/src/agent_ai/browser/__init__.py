"""Selenium browser lifecycle and safety boundary."""

from agent_ai.browser.safety import (
    ALLOWED_DOMAINS,
    PauseRequired,
    SafetyViolation,
    assert_allowed_url,
)
from agent_ai.browser.selenium_remote import (
    BrowserActionExecutor,
    SecretRedactor,
    SeleniumRemoteBrowser,
    VisualFallbackRequired,
)

__all__ = [
    "ALLOWED_DOMAINS",
    "BrowserActionExecutor",
    "PauseRequired",
    "SafetyViolation",
    "SecretRedactor",
    "SeleniumRemoteBrowser",
    "VisualFallbackRequired",
    "assert_allowed_url",
]
