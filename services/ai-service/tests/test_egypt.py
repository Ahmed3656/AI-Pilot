from decimal import Decimal

import pytest

from agent_ai.models import Category
from agent_ai.orchestrator.classification import classify_request
from agent_ai.utils.egypt import normalize_digits, normalize_label, normalize_location, parse_egp


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("١٬٢٣٤٫٥٠ ج.م", Decimal("1234.50")),
        ("EGP 1,234.50", Decimal("1234.50")),
        ("۱۲۹٫۹۹ جنيه", Decimal("129.99")),
        ("2,500 EGP", Decimal("2500")),
    ],
)
def test_arabic_and_western_egp_amounts(raw: str, expected: Decimal) -> None:
    assert parse_egp(raw) == expected


def test_normalizes_digits_labels_and_named_areas_without_address_invention() -> None:
    assert normalize_digits("رقم ٢٠٢٦") == "رقم 2026"
    assert normalize_label("رسوم التوصيل") == "delivery_fee"
    location = normalize_location("التجمع الخامس")
    assert location.governorate == "Cairo"
    assert location.area == "New Cairo"
    assert not hasattr(location, "street")
    unknown = normalize_location("مكان غير معروف")
    assert unknown.governorate is None
    assert unknown.area is None


@pytest.mark.parametrize(
    ("query", "category"),
    [
        ("عايز وجبة برجر من طلبات", Category.FOOD),
        ("Find it on Menu Egypt or elmenus", Category.FOOD),
        ("Find koshary near me", Category.FOOD),
        ("Compare burgers close to me", Category.FOOD),
        ("Show shawerma menu prices", Category.FOOD),
        ("Find pizza nearby", Category.FOOD),
        ("Book a VOX cinema movie tonight", Category.CINEMA),
        ("اشتري موبايل من جوميا", Category.RETAIL),
    ],
)
def test_bilingual_classification(query: str, category: Category) -> None:
    assert classify_request(query) is category


def test_unsafe_or_mixed_classification_requires_clarification() -> None:
    assert classify_request("Help me find a good option") is None
    assert classify_request("Buy a phone and order a pizza meal") is None
