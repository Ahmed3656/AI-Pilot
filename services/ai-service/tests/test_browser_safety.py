import re
from pathlib import Path

import pytest

from agent_ai.browser.safety import (
    PauseRequired,
    SafetyViolation,
    assert_allowed_url,
    assert_not_card_field,
    assert_not_final_action,
    assert_not_login_field,
    inspect_page_for_pause,
)
from agent_ai.browser.selenium_remote import SeleniumRemoteBrowser
from agent_ai.models import Category, PauseReason

FIXTURES = Path(__file__).parent / "fixtures"


def test_allowed_subdomains_and_redirect_blocking() -> None:
    assert assert_allowed_url("https://www.amazon.eg/item", Category.RETAIL) == "amazon.eg"
    assert assert_allowed_url("https://egy.voxcinemas.com/show", Category.CINEMA) == (
        "voxcinemas.com"
    )
    assert assert_allowed_url("https://www.google.com/maps", Category.FOOD) == "google.com"
    assert assert_allowed_url("https://www.menuegypt.com/menus/all", Category.FOOD) == (
        "menuegypt.com"
    )
    assert assert_allowed_url("https://www.elmenus.com/menu", Category.FOOD) == "elmenus.com"
    with pytest.raises(PauseRequired) as unexpected:
        assert_allowed_url("https://amazon.eg.attacker.example/", Category.RETAIL)
    assert unexpected.value.reason_code is PauseReason.UNEXPECTED_DOMAIN
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
    assert pause.value.reason_code is PauseReason.CAPTCHA
    assert pause.value.preserve_page is True


def test_dormant_captcha_markup_does_not_pause_without_a_visible_challenge() -> None:
    inspect_page_for_pause(
        '<script src="https://captcha.example/api.js"></script>'
        '<div class="g-recaptcha" style="display:none"></div>',
        "https://www.amazon.eg/s?k=phone",
        visible_captcha_challenge=False,
    )


def test_visible_captcha_signal_still_pauses() -> None:
    with pytest.raises(PauseRequired) as pause:
        inspect_page_for_pause(
            "<main>Search results</main>",
            "https://www.amazon.eg/s?k=phone",
            visible_captcha_challenge=True,
        )
    assert pause.value.reason_code is PauseReason.CAPTCHA
    assert pause.value.preserve_page is True


def test_captcha_url_pauses_even_before_widget_is_rendered() -> None:
    with pytest.raises(PauseRequired) as pause:
        inspect_page_for_pause(
            "<main>Loading</main>",
            "https://www.amazon.eg/errors/validateCaptcha",
            visible_captcha_challenge=False,
        )
    assert pause.value.reason_code is PauseReason.CAPTCHA


def test_denied_or_unapproved_navigation_never_calls_selenium_get() -> None:
    class Driver:
        def __init__(self) -> None:
            self.get_calls: list[str] = []

        def get(self, url: str) -> None:
            self.get_calls.append(url)

    driver = Driver()
    browser = SeleniumRemoteBrowser("http://fake")
    browser.driver = driver
    with pytest.raises(PauseRequired):
        browser.navigate(
            "https://attacker.example/checkout",
            Category.RETAIL,
            {"amazon.eg"},
        )
    with pytest.raises(PauseRequired):
        browser.navigate(
            "https://www.noon.com/egypt-en/",
            Category.RETAIL,
            {"amazon.eg"},
        )
    assert driver.get_calls == []


def test_first_retail_merchant_reuses_initial_browser_tab() -> None:
    class SwitchTo:
        def __init__(self) -> None:
            self.new_window_calls = 0

        def new_window(self, _: str) -> None:
            self.new_window_calls += 1

        def window(self, _: str) -> None:
            return None

    class Driver:
        current_url = "about:blank"
        current_window_handle = "window-1"
        window_handles = ["window-1"]

        def __init__(self) -> None:
            self.switch_to = SwitchTo()
            self.get_calls: list[str] = []

        def get(self, url: str) -> None:
            self.get_calls.append(url)
            self.current_url = url

        def execute_script(self, _: str) -> bool:
            return False

        @property
        def page_source(self) -> str:
            return "<main>Egyptian retailer</main>"

    driver = Driver()
    browser = SeleniumRemoteBrowser("http://fake")
    browser.driver = driver
    browser.navigate(
        "https://www.amazon.eg/",
        Category.RETAIL,
        {"amazon.eg"},
        separate_tab=True,
    )
    assert driver.switch_to.new_window_calls == 0
    assert driver.get_calls == ["https://www.amazon.eg/"]


def test_next_approved_navigation_reuses_a_tab_left_on_denied_redirect() -> None:
    class SwitchTo:
        def __init__(self) -> None:
            self.new_window_calls = 0

        def new_window(self, _: str) -> None:
            self.new_window_calls += 1

        def window(self, _: str) -> None:
            return None

    class Driver:
        current_url = "https://attacker.example/phish"
        current_window_handle = "window-1"
        window_handles = ["window-1"]

        def __init__(self) -> None:
            self.switch_to = SwitchTo()
            self.get_calls: list[str] = []

        def get(self, url: str) -> None:
            self.get_calls.append(url)
            self.current_url = url

        def execute_script(self, _: str) -> bool:
            return False

        @property
        def page_source(self) -> str:
            return "<main>Approved Egyptian merchant</main>"

    driver = Driver()
    browser = SeleniumRemoteBrowser("http://fake")
    browser.driver = driver
    browser.tabs = {"amazon.eg": "window-1"}
    browser.expected_domain = "amazon.eg"
    browser.navigate(
        "https://www.noon.com/egypt-en/",
        Category.RETAIL,
        {"amazon.eg", "noon.com"},
        separate_tab=True,
    )
    assert driver.switch_to.new_window_calls == 0
    assert browser.tabs == {"noon.com": "window-1"}
    assert driver.get_calls == ["https://www.noon.com/egypt-en/"]


def test_redirect_domain_is_checked_before_dom_inspection() -> None:
    class SwitchTo:
        def window(self, _: str) -> None:
            return None

    class Driver:
        current_url = "https://attacker.example/phish"
        current_window_handle = "window-1"
        window_handles = ["window-1"]
        switch_to = SwitchTo()

        def __init__(self) -> None:
            self.page_source_read = False

        @property
        def page_source(self) -> str:
            self.page_source_read = True
            return "secret DOM"

    driver = Driver()
    browser = SeleniumRemoteBrowser("http://fake")
    browser.driver = driver
    browser.expected_domain = "amazon.eg"
    with pytest.raises(PauseRequired):
        browser.guard(Category.RETAIL, {"amazon.eg"})
    assert driver.page_source_read is False


def test_redirect_to_different_approved_merchant_is_still_blocked_before_dom() -> None:
    class SwitchTo:
        def window(self, _: str) -> None:
            return None

    class Driver:
        current_url = "https://www.noon.com/egypt-en/"
        current_window_handle = "window-1"
        window_handles = ["window-1"]
        switch_to = SwitchTo()

        def __init__(self) -> None:
            self.page_source_read = False

        @property
        def page_source(self) -> str:
            self.page_source_read = True
            return "merchant DOM"

    driver = Driver()
    browser = SeleniumRemoteBrowser("http://fake")
    browser.driver = driver
    browser.expected_domain = "amazon.eg"
    with pytest.raises(PauseRequired, match="Unexpected redirect"):
        browser.guard(Category.RETAIL, {"amazon.eg", "noon.com"})
    assert driver.page_source_read is False


def test_payment_details_page_pauses_before_model_screenshot() -> None:
    with pytest.raises(PauseRequired) as pause:
        inspect_page_for_pause(
            '<form><input autocomplete="cc-number" aria-label="Card number"></form>',
            "https://www.amazon.eg/checkout",
        )
    assert pause.value.reason_code is PauseReason.BROWSER_WARNING


def test_product_link_card_promotion_is_not_treated_as_a_card_field() -> None:
    assert_not_card_field(
        {
            "tag": "a",
            "text": "Samsung Galaxy A55 - pay in installments with a credit card",
            "href": "https://www.amazon.eg/dp/example",
        }
    )


def test_accepted_card_footer_does_not_look_like_a_payment_form() -> None:
    inspect_page_for_pause(
        "Secure shopping. We accept credit card, debit card, and cash on delivery.",
        "https://www.jumia.com.eg/",
    )


def test_homepage_script_with_card_field_copy_does_not_look_like_checkout() -> None:
    inspect_page_for_pause(
        '<script>window.messages = {"card number": "Card number is invalid"}</script>',
        "https://www.amazon.eg/",
    )


def test_hidden_homepage_card_control_does_not_look_like_checkout() -> None:
    inspect_page_for_pause(
        '<input aria-label="Card number" style="display: none">',
        "https://www.amazon.eg/",
    )


def test_visible_card_control_pauses_even_outside_checkout_path() -> None:
    with pytest.raises(PauseRequired) as pause:
        inspect_page_for_pause(
            '<input aria-label="Card number">',
            "https://www.amazon.eg/",
            visible_sensitive_control=True,
        )
    assert pause.value.reason_code is PauseReason.BROWSER_WARNING


def test_checkout_path_with_payment_copy_still_pauses() -> None:
    with pytest.raises(PauseRequired) as pause:
        inspect_page_for_pause(
            "Enter your card number to continue.",
            "https://www.amazon.eg/checkout/payment",
        )
    assert pause.value.reason_code is PauseReason.BROWSER_WARNING


@pytest.mark.parametrize(
    "label",
    [
        "Enter mobile number or email",
        "Email or Mobile Number*",
        "Please enter email or mobile number",
    ],
)
def test_live_retail_login_identifier_fields_pause(label: str) -> None:
    with pytest.raises(PauseRequired) as pause:
        assert_not_login_field({"tag": "input", "aria_label": label})
    assert pause.value.reason_code is PauseReason.LOGIN


def test_visible_identifier_only_login_dialog_pauses() -> None:
    with pytest.raises(PauseRequired) as pause:
        inspect_page_for_pause(
            '<div role="dialog"><input aria-label="Email or Mobile Number"></div>',
            "https://www.noon.com/egypt-en/cart/",
            visible_login_control=True,
        )
    assert pause.value.reason_code is PauseReason.LOGIN
