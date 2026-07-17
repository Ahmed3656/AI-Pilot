from __future__ import annotations

import json
from typing import Any

from agent_ai.browser import BrowserActionExecutor
from agent_ai.models import Category


class DeterministicProviderTestAdapter:
    """Test-only OpenRouter replacement; it still captures through real Selenium."""

    last_response_id: str | None = None

    async def run(
        self,
        *,
        query: str,
        category: Category,
        executor: BrowserActionExecutor,
        address_handle: str | None = None,
        discovery_sink: Any = None,
    ) -> str:
        del query, address_handle, discovery_sink
        await executor.execute({"type": "screenshot"})
        details: dict[str, Any]
        if category is Category.RETAIL:
            details = {
                "brand": "DealPilot Test",
                "model": "Deterministic Fixture",
                "variant": None,
                "storage": None,
                "size": None,
                "color": None,
                "quantity": 1,
                "stock": "available",
                "seller_condition": "new",
                "delivery_estimate": None,
            }
        elif category is Category.FOOD:
            details = {
                "meal_size": "test",
                "required_modifiers": [],
                "rating": None,
                "minimum_order": None,
                "delivery_estimate": None,
                "tip": "0.00",
                "tip_excluded": True,
            }
        else:
            details = {
                "movie": "Deterministic Fixture",
                "date": "2026-07-17",
                "time": None,
                "venue_area": "Cairo",
                "language": "English",
                "screen_format": "2D",
                "seat_count": 2,
                "seat_type": "standard",
                "adjacent": True,
                "hold_expires_at": None,
            }
        domain = executor.browser.expected_domain or "amazon.eg"
        return json.dumps(
            {
                "candidates": [
                    {
                        "merchant": domain,
                        "title": "Deterministic incomplete offer",
                        "url": f"https://{domain}/integration-fixture",
                        "exact_match": True,
                        "valid": True,
                        "subtotal": "100.00",
                        "delivery_fee": None,
                        "service_fee": "0.00",
                        "booking_fee": "0.00",
                        "tax": "0.00",
                        "mandatory_fees": [],
                        "discount": "0.00",
                        "total": None,
                        "currency": "EGP",
                        "details": details,
                        "evidence_ids": [],
                    }
                ],
                "coupon_attempts": [],
                "stopped_before": "payment",
                "notes": ["TEST ADAPTER: deterministic Selenium fixture"],
            }
        )
