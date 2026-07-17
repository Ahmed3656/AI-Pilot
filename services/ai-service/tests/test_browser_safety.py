import re
from pathlib import Path

import pytest

from agent_ai.browser.safety import (
    PauseRequired,
    SafetyViolation,
    assert_allowed_url,
    assert_not_card_field,
    assert_not_final_action,
    inspect_page_for_pause,
)
from agent_ai.models import ApprovalType, Category

FIXTURES = Path(__file__).parent / "fixtures"


def test_allowed_subdomains_and_redirect_blocking() -> None:
    assert assert_allowed_url("https://www.amazon.eg/item", Category.RETAIL) == "amazon.eg"
    assert assert_allowed_url("https://egy.voxcinemas.com/show", Category.CINEMA) == (
        "voxcinemas.com"
    )
    with pytest.raises(PauseRequired) as unexpected:
        assert_allowed_url("https://amazon.eg.attacker.example/", Category.RETAIL)
    assert unexpected.value.approval_type is ApprovalType.UNEXPECTED_DOMAIN
    with pytest.raises(PauseRequired, match="Unexpected redirect"):
        assert_allowed_url(
            "https://www.noon.com/egypt-en/",
            Category.RETAIL,
            expected_domain="amazon.eg",
        )


def test_payment_and_card_fields_from_checkout_fixture_are_blocked() -> None:
    html = (FIXTURES / "checkout.html").read_text(encoding="utf-8")
    button = re.search(r"<button[^>]*aria-label=\"([^\"]+)\"[^>]*>([^<]+)", html)
    assert button
    with pytest.raises(SafetyViolation, match="final"):
        assert_not_final_action({"aria_label": button.group(1), "text": button.group(2)})
    with pytest.raises(SafetyViolation, match="Card"):
        assert_not_card_field({"name": "card-number", "autocomplete": "cc-number"})


def test_captcha_fixture_pauses_and_is_never_solved() -> None:
    html = (FIXTURES / "captcha.html").read_text(encoding="utf-8")
    with pytest.raises(PauseRequired) as pause:
        inspect_page_for_pause(html, "https://www.talabat.com/egypt")
    assert pause.value.approval_type is ApprovalType.CAPTCHA
