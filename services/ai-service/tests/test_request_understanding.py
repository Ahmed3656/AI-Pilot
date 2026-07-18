from datetime import date
from decimal import Decimal

from agent_ai.models import Category, MoneyBreakdown
from agent_ai.orchestrator.classification import classify_request
from agent_ai.orchestrator.request_understanding import (
    check_retail_constraints,
    interpret_retail_query,
)

QUERY = "Find a Samsung A55 256 GB under 25,000 EGP, delivered by Thursday"


def test_human_phone_request_is_classified_without_the_word_phone() -> None:
    assert classify_request(QUERY) is Category.RETAIL
    assert classify_request("A55 256GB max 25,000 EGP") is Category.RETAIL


def test_extracts_hard_retail_constraints_and_resolves_weekday_in_cairo() -> None:
    constraints = interpret_retail_query(QUERY, reference=date(2026, 7, 18))

    assert constraints.brand == "Samsung"
    assert constraints.model == "A55"
    assert constraints.storage_gb == 256
    assert constraints.max_total == Decimal("25000")
    assert constraints.delivery_deadline == date(2026, 7, 23)


def test_constraint_check_distinguishes_excluded_from_unverified() -> None:
    constraints = interpret_retail_query(QUERY, reference=date(2026, 7, 18))
    qualifying = check_retail_constraints(
        constraints,
        title="Samsung Galaxy A55 5G 256GB",
        details={
            "brand": "Samsung",
            "model": "Galaxy A55 5G",
            "storage": "256 GB",
            "delivery_estimate": "2026-07-23",
        },
        money=MoneyBreakdown(total=Decimal("24999")),
        reference=date(2026, 7, 18),
    )
    late = check_retail_constraints(
        constraints,
        title="Samsung Galaxy A55 5G 256GB",
        details={
            "brand": "Samsung",
            "model": "A55",
            "storage": "256 GB",
            "delivery_estimate": "2026-07-24",
        },
        money=MoneyBreakdown(total=Decimal("24000")),
        reference=date(2026, 7, 18),
    )
    unknown_delivery = check_retail_constraints(
        constraints,
        title="Samsung Galaxy A55 5G 256GB",
        details={
            "brand": "Samsung",
            "model": "A55",
            "storage": "256 GB",
            "delivery_estimate": None,
        },
        money=MoneyBreakdown(total=Decimal("24000")),
        reference=date(2026, 7, 18),
    )

    assert qualifying.exclusion_reason is None
    assert qualifying.incomplete_reason is None
    assert late.exclusion_reason == "DELIVERY_DEADLINE_MISSED"
    assert unknown_delivery.incomplete_reason == "DELIVERY_DEADLINE_UNVERIFIED"
