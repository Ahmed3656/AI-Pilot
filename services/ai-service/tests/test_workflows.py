import json
from datetime import date

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
            "payment_info": {
                "observed_before_login": True,
                "methods": ["Cash on Delivery"],
                "installment_options": [],
                "discount_offers": [],
                "protection_plans": [],
                "shipping_and_fee_notes": ["Free delivery"],
                "eligibility_notes": [],
                "login_required_for_final_terms": True,
                "evidence_ids": [f"evidence:{merchant}"],
            },
        },
    }


def _food_candidate(
    merchant: str,
    price: str,
    distance_km: str,
    *,
    meal: str = "Pepperoni pizza",
) -> dict[str, object]:
    return {
        "merchant": merchant,
        "title": f"{meal} at {merchant}",
        "url": f"https://www.{merchant}/menu/{meal.casefold().replace(' ', '-')}",
        "exact_match": True,
        "valid": True,
        "subtotal": price,
        "delivery_fee": None,
        "service_fee": None,
        "booking_fee": "0.00",
        "tax": None,
        "mandatory_fees": [],
        "discount": "0.00",
        "total": None,
        "currency": "EGP",
        "evidence_ids": [f"evidence:{merchant}"],
        "details": {
            "restaurant": f"Pizza {merchant}",
            "meal": meal,
            "meal_size": "large",
            "required_modifiers": [],
            "rating": "4.5",
            "minimum_order": None,
            "delivery_estimate": None,
            "tip": "0.00",
            "tip_excluded": True,
            "source_name": merchant,
            "branch_area": "Maadi",
            "distance_km": distance_km,
            "distance_text": f"{distance_km} km",
            "proximity_basis": "route_distance",
            "price_scope": "menu_price",
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
    assert "google.com" in food and "menuegypt.com" in food and "elmenus.com" in food
    assert "at least three different" in food and "dealpilot_page_text" in food
    assert "seat_hold" in cinema and "mandatory" in cinema
    assert "only in Egypt" in retail
    assert "no more than five" in food
    assert "cart-ready only after" in retail
    assert "set `stopped_before` to `login`" in retail
    assert "details.payment_info" in retail
    assert "installment" in retail
    assert "user does not need to reopen the pages" in retail


def test_retail_payment_info_is_sanitized_and_preserved() -> None:
    candidate = _candidate("noon.com", "474")
    candidate["details"]["payment_info"] = {
        "observed_before_login": True,
        "methods": ["Visa", "Cash on Delivery", "Visa"],
        "installment_options": [
            {
                "provider": "Example Bank",
                "months": 6,
                "interest_rate": "0%",
                "processing_fee": "0.00",
                "minimum_order": "500.00",
                "applies_to_current_cart": False,
                "verified_before_login": True,
                "source_url": "https://www.noon.com/egypt-en/cart/",
                "card_number": "must never survive",
            }
        ],
        "discount_offers": [],
        "protection_plans": [],
        "shipping_and_fee_notes": ["EGP 20 shown, then waived"],
        "eligibility_notes": ["Current cart is below the EGP 500 minimum"],
        "login_required_for_final_terms": True,
        "evidence_ids": ["evidence:payment"],
    }

    result = validate_agent_result(Category.RETAIL, json.dumps({"candidates": [candidate]}))
    payment = result["candidates"][0]["details"]["payment_info"]

    assert payment["methods"] == ["Visa", "Cash on Delivery"]
    assert payment["installment_options"][0]["months"] == 6
    assert payment["installment_options"][0]["applies_to_current_cart"] is False
    assert "card_number" not in payment["installment_options"][0]
    assert payment["shipping_and_fee_notes"] == ["EGP 20 shown, then waived"]


def test_missing_retail_payment_info_gets_a_safe_empty_summary() -> None:
    candidate = _candidate("amazon.eg", "1200")
    del candidate["details"]["payment_info"]

    result = validate_agent_result(Category.RETAIL, json.dumps({"candidates": [candidate]}))
    payment = result["candidates"][0]["details"]["payment_info"]

    assert payment == {
        "observed_before_login": False,
        "login_required_for_final_terms": False,
        "methods": [],
        "shipping_and_fee_notes": [],
        "eligibility_notes": [],
        "evidence_ids": [],
        "installment_options": [],
        "discount_offers": [],
        "protection_plans": [],
    }


def test_retail_ranking_enforces_query_budget_storage_and_delivery_deadline() -> None:
    matching = _candidate("amazon.eg", "24900")
    matching["title"] = "Samsung Galaxy A55 5G 256GB"
    matching["details"].update(
        {
            "brand": "Samsung",
            "model": "A55",
            "storage": "256 GB",
            "delivery_estimate": "2026-07-23",
        }
    )
    over_budget = _candidate("jumia.com.eg", "25100")
    over_budget["title"] = "Samsung Galaxy A55 5G 256GB"
    over_budget["details"].update(matching["details"])
    wrong_storage = _candidate("noon.com", "23000")
    wrong_storage["title"] = "Samsung Galaxy A55 5G 128GB"
    wrong_storage["details"].update({**matching["details"], "storage": "128 GB"})

    result = validate_agent_result(
        Category.RETAIL,
        json.dumps({"candidates": [over_budget, wrong_storage, matching]}),
        query="Find a Samsung A55 256 GB under 25,000 EGP, delivered by Thursday",
        reference=date(2026, 7, 18),
    )

    assert result["winner"]["merchant"] == "amazon.eg"
    assert result["interpreted_constraints"] == {
        "brand": "Samsung",
        "model": "A55",
        "storage_gb": 256,
        "max_total": "25000.00",
        "delivery_deadline": "2026-07-23",
    }
    assert result["candidates"][0]["exclusion_reason"] == "BUDGET_EXCEEDED"
    assert result["candidates"][1]["exclusion_reason"] == "STORAGE_MISMATCH"


def test_food_menu_prices_are_ranked_by_verified_proximity_without_fake_fees() -> None:
    result = validate_agent_result(
        Category.FOOD,
        json.dumps(
            {
                "candidates": [
                    _food_candidate("menuegypt.com", "260", "4.2"),
                    _food_candidate("elmenus.com", "310", "1.3"),
                ]
            }
        ),
        approved_domains={"menuegypt.com", "elmenus.com"},
    )

    assert result["comparable_candidate_count"] == 2
    assert result["complete_valid_candidate_count"] == 0
    assert result["winner"]["merchant"] == "elmenus.com"
    assert result["winner"]["menu_price"] == "310.00"
    assert result["winner"]["total"] is None
    assert result["may_claim_closest"] is True
    assert result["may_claim_cheapest"] is False
    assert "Menu-only prices exclude" in result["ranking_explanation"]


def test_requested_food_examples_are_valid_menu_price_candidates() -> None:
    examples = (
        ("Koshary", "30"),
        ("Burger combo", "160"),
        ("Shawerma kaiser", "25"),
        ("Tuna pizza", "200"),
    )

    for meal, price in examples:
        result = validate_agent_result(
            Category.FOOD,
            json.dumps(
                {
                    "candidates": [
                        _food_candidate(
                            "menuegypt.com",
                            price,
                            "2.0",
                            meal=meal,
                        )
                    ]
                }
            ),
            approved_domains={"menuegypt.com"},
        )

        assert result["comparable_candidate_count"] == 1
        assert result["winner"]["menu_price"] == f"{price}.00"
        assert result["winner"]["details"]["meal"] == meal
        assert result["candidates"][0]["valid"] is True


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
