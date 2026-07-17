import json

from agent_ai.models import Category
from agent_ai.workflows.specs import validate_agent_result, workflow_instructions


def _candidate(merchant: str, total: str, *, exact: bool = True) -> dict[str, object]:
    return {
        "merchant": merchant,
        "title": "Exact phone",
        "url": f"https://{merchant}/item",
        "exact_match": exact,
        "valid": True,
        "subtotal": total,
        "delivery_fee": "0",
        "service_fee": None,
        "booking_fee": None,
        "discount": "0",
        "total": total,
        "currency": "EGP",
        "details": {
            "brand": "Brand",
            "model": "X",
            "variant": "standard",
            "storage": "not applicable",
            "size": "not applicable",
            "color": "requested color",
            "quantity": 1,
            "stock": True,
            "seller_condition": "new",
            "delivery_estimate": "tomorrow",
        },
    }


def test_deterministic_ranking_and_cheapest_claim_threshold() -> None:
    raw = json.dumps(
        {
            "candidates": [
                _candidate("amazon.eg", "1200"),
                _candidate("jumia.com.eg", "1100"),
                _candidate("noon.com", "900", exact=False),
            ],
            "coupon_attempts": [],
            "stopped_before": "payment",
            "notes": [],
        }
    )
    result = validate_agent_result(Category.RETAIL, raw)
    assert result["winner"]["merchant"] == "jumia.com.eg"
    assert result["may_claim_cheapest"] is True
    assert result["complete_valid_candidate_count"] == 2

    one = validate_agent_result(
        Category.RETAIL,
        json.dumps({"candidates": [_candidate("amazon.eg", "1200")]}),
    )
    assert one["may_claim_cheapest"] is False
    assert "must not be called cheapest" in one["ranking_explanation"]


def test_category_prompts_encode_phase_one_constraints() -> None:
    retail = workflow_instructions(Category.RETAIL)
    food = workflow_instructions(Category.FOOD)
    cinema = workflow_instructions(Category.CINEMA)
    assert "amazon.eg" in retail and "different model or variant" in retail
    assert "tip to zero" in food and "Place order" in food
    assert "seat_hold" in cinema and "mandatory" in cinema
    assert "only in Egypt" in retail
    assert "no more than five" in food
