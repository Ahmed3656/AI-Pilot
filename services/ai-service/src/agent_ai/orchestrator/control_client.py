from __future__ import annotations

import base64
import hashlib
import json
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import httpx


class ControlAPIClient:
    def __init__(
        self,
        base_url: str,
        internal_token: str,
        *,
        timeout: float = 30.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.internal_token = internal_token
        self._owns_client = client is None
        self.client = client or httpx.AsyncClient(timeout=timeout)

    @property
    def _headers(self) -> dict[str, str]:
        return {"X-Internal-Token": self.internal_token}

    async def emit(self, run_id: str, event_type: str, payload: dict[str, Any]) -> None:
        event_id = f"ai:{uuid4()}"
        observed_at = datetime.now(UTC).isoformat()
        body: dict[str, Any] = {
            "eventId": event_id,
            "runId": run_id,
            "observedAt": observed_at,
        }
        state_events = {
            "run_created": "discovering",
            "run_started": "comparing",
            "clarification_required": "clarifying",
            "clarification_received": "discovering",
            "progress": "comparing",
            "run_completed": "ready_for_handoff",
            "run_cancelled": "cancelled",
            "safety_blocked": "paused",
        }
        if event_type in state_events:
            body.update(type="run.state_changed", state=state_events[event_type])
        elif event_type == "approval_required":
            state = {
                "domain_access": "awaiting_domain_approval",
                "address_share": "awaiting_address_consent",
                "seat_hold": "awaiting_seat_hold_approval",
            }.get(str(payload.get("approval_type")), "paused")
            body.update(type="run.state_changed", state=state)
        elif event_type == "approval_resolved":
            body.update(
                type="run.state_changed",
                state="comparing" if payload.get("approved") else "paused",
            )
        elif event_type in {"screenshot", "seat_hold_created"}:
            screenshot = str(payload.get("data", ""))
            try:
                artifact_bytes = base64.b64decode(screenshot, validate=True)
            except ValueError:
                artifact_bytes = json.dumps(payload, sort_keys=True, default=str).encode()
            uri = payload.get("url") or f"https://evidence.dealpilot.invalid/{event_id}"
            body.update(
                type="evidence.captured",
                evidence={
                    "kind": event_type,
                    "uri": uri,
                    "sha256": hashlib.sha256(artifact_bytes).hexdigest(),
                    "metadata": payload,
                },
            )
        elif event_type == "offer_normalized":
            details = payload.get("details", {})
            category = str(payload.get("category"))
            mapped_details: dict[str, Any]
            if category == "retail":
                mapped_details = {
                    "brand": details.get("brand"),
                    "model": details.get("model"),
                    "size": details.get("size"),
                    "color": details.get("color"),
                    "quantity": details.get("quantity"),
                    "deliveryEstimate": details.get("delivery_estimate"),
                }
            elif category == "food":
                mapped_details = {
                    "restaurant": details.get("restaurant", payload.get("merchant")),
                    "meal": details.get("meal", payload.get("title")),
                    "size": details.get("meal_size"),
                    "modifiers": details.get("required_modifiers", []),
                    "rating": details.get("rating"),
                    "minimumOrder": details.get("minimum_order"),
                    "deliveryEstimate": details.get("delivery_estimate"),
                    "optionalTipExcluded": details.get("tip_excluded"),
                }
            else:
                mapped_details = {
                    "movie": details.get("movie"),
                    "venue": details.get("venue_area"),
                    "date": details.get("date"),
                    "showtime": details.get("time"),
                    "language": details.get("language"),
                    "screenFormat": details.get("screen_format"),
                    "seatCount": details.get("seat_count"),
                    "seatType": details.get("seat_type"),
                    "bookingFee": _number(payload.get("booking_fee")),
                    "holdExpiresAt": details.get("hold_expires_at"),
                }
            body.update(
                type="offer.normalized",
                offer={
                    "merchant": payload.get("merchant"),
                    "category": category,
                    "title": payload.get("title"),
                    "sourceUrl": _control_source_url(str(payload.get("url", "")), category),
                    "currency": "EGP",
                    "basePrice": _number(payload.get("subtotal")),
                    "deliveryFee": _optional_number(payload.get("delivery_fee")),
                    "serviceFee": _optional_number(payload.get("service_fee")),
                    "tax": None,
                    "discount": _optional_number(payload.get("discount")),
                    "finalTotal": _number(payload.get("total")),
                    "couponCode": payload.get("coupon_code"),
                    "availability": str(details.get("stock", "available")),
                    "observedAt": observed_at,
                    "evidenceIds": [],
                    "matchConfidence": 1 if payload.get("exact_match") else 0,
                    "incompleteReason": None,
                    "details": mapped_details,
                },
            )
        elif event_type == "coupon_attempted":
            body.update(
                type="coupon.attempted",
                couponAttempt={
                    "merchant": payload.get("merchant"),
                    "couponCode": payload.get("code"),
                    "status": "verified" if payload.get("verified") else "rejected",
                    "beforeTotal": _number(payload.get("before_total")),
                    "afterTotal": _optional_number(payload.get("after_total")),
                    "evidenceIds": [],
                },
            )
        elif event_type == "run_failed":
            body.update(type="run.failed", failureCode="AI_RUN_FAILED")
        else:
            body.update(type="run.state_changed", state="comparing")
        response = await self.client.post(
            f"{self.base_url}/internal/v1/ai-events",
            headers=self._headers,
            json=body,
        )
        response.raise_for_status()

    async def resolve_secret(
        self,
        handle: str,
        run_id: str,
        merchant_domain: str | None = None,
        field: str | None = None,
    ) -> str:
        response = await self.client.post(
            f"{self.base_url}/internal/v1/secrets/resolve",
            headers=self._headers,
            json={
                "runId": run_id,
                "secretReference": handle,
                "merchantDomain": merchant_domain or "",
                "field": field or "street",
            },
        )
        response.raise_for_status()
        body = response.json()
        value = body.get("value", body.get("resolved_value"))
        if not isinstance(value, str) or not value:
            raise RuntimeError("Secret resolver returned no value")
        return value

    async def aclose(self) -> None:
        if self._owns_client:
            await self.client.aclose()


def _number(value: Any) -> float:
    if value is None:
        return 0.0
    return float(value)


def _optional_number(value: Any) -> float | None:
    return None if value is None else float(value)


def _control_source_url(url: str, category: str) -> str:
    roots = {
        "retail": ("amazon.eg", "jumia.com.eg", "noon.com"),
        "food": ("talabat.com",),
        "cinema": ("voxcinemas.com",),
    }.get(category, ())
    parsed = urlsplit(url)
    hostname = (parsed.hostname or "").casefold()
    root = next(
        (
            candidate
            for candidate in roots
            if hostname == candidate or hostname.endswith(f".{candidate}")
        ),
        hostname,
    )
    return urlunsplit((parsed.scheme, root, parsed.path, parsed.query, parsed.fragment))
