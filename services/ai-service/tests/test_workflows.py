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
        "service_fee": "0",
        "booking_fee": "0",
        "tax": "0",
        "mandatory_fees": [],
        "discount": "0",
        "total": total,
        "currency": "EGP",
        "evidence_ids": [f"evidence:{merchant}"],
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


def test_inconsistent_component_total_is_flagged_and_not_ranked() -> None:
    candidate = _candidate("amazon.eg", "1200")
    candidate["delivery_fee"] = "50"
    result = validate_agent_result(
        Category.RETAIL,
        json.dumps({"candidates": [candidate], "coupon_attempts": []}),
    )
    assert result["complete_valid_candidate_count"] == 0
    assert result["candidates"][0]["valid"] is False
    assert result["candidates"][0]["incomplete_reason"] == "INCONSISTENT_TOTAL"


def test_all_price_components_and_mandatory_fees_are_recomputed() -> None:
    candidate = _candidate("amazon.eg", "1000")
    candidate.update(
        {
            "delivery_fee": "20",
            "service_fee": "10",
            "booking_fee": "0",
            "tax": "140",
            "mandatory_fees": [
                {"label": "handling", "amount": "5", "evidence_ids": ["evidence:fee"]}
            ],
            "discount": "25",
            "total": "1150",
        }
    )
    result = validate_agent_result(Category.RETAIL, json.dumps({"candidates": [candidate]}))
    assert result["candidates"][0]["valid"] is True
    assert result["candidates"][0]["total"] == "1150.00"


def test_offer_from_catalog_but_not_approved_subset_is_excluded() -> None:
    candidate = _candidate("noon.com", "1000")
    result = validate_agent_result(
        Category.RETAIL,
        json.dumps({"candidates": [candidate]}),
        approved_domains={"amazon.eg"},
    )
    assert result["candidates"][0]["valid"] is False


def test_coupon_source_is_preserved_and_rejection_reason_is_contract_safe() -> None:
    result = validate_agent_result(
        Category.RETAIL,
        json.dumps(
            {
                "candidates": [],
                "coupon_attempts": [
                    {
                        "merchant": "amazon.eg",
                        "code": "PUBLIC10",
                        "source_url": "https://example.org/public-coupon",
                        "before_total": "100.00",
                        "after_total": "100.00",
                        "accepted": False,
                        "rejection_reason": "model-invented-reason",
                        "message": "The interface rejected the code",
                        "evidence_ids": ["evidence:source", "evidence:result"],
                    }
                ],
            }
        ),
    )
    attempt = result["coupon_attempts"][0]
    assert attempt["source_url"] == "https://example.org/public-coupon"
    assert attempt["rejection_reason"] == "unknown"
    assert attempt["message"] == "The interface rejected the code"
