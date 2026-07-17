from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol
from urllib.parse import urlsplit

from agent_ai.models import CouponAttempt


@dataclass(frozen=True, slots=True)
class PublicCoupon:
    code: str
    source_url: str


class CouponUI(Protocol):
    explicitly_supports_stacking: bool

    async def total(self) -> Decimal: ...

    async def apply_coupon(self, code: str) -> tuple[bool, str | None]: ...

    async def remove_coupon(self) -> None: ...


def _validate_public_coupon(coupon: PublicCoupon) -> None:
    parsed = urlsplit(coupon.source_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Coupon source must be an attributable public HTTP(S) URL")
    if not coupon.code.strip():
        raise ValueError("Coupon code must not be empty")


class CouponEngine:
    max_codes = 5

    async def test(
        self,
        ui: CouponUI,
        coupons: Iterable[PublicCoupon],
        *,
        allow_stacking: bool = False,
    ) -> list[CouponAttempt]:
        if allow_stacking and not ui.explicitly_supports_stacking:
            raise ValueError(
                "Coupon stacking is allowed only when the interface explicitly supports it"
            )

        unique: list[PublicCoupon] = []
        seen: set[str] = set()
        for coupon in coupons:
            _validate_public_coupon(coupon)
            normalized = coupon.code.strip().upper()
            if normalized not in seen:
                seen.add(normalized)
                unique.append(PublicCoupon(normalized, coupon.source_url))
            if len(unique) == self.max_codes:
                break

        attempts: list[CouponAttempt] = []
        best: CouponAttempt | None = None
        for coupon in unique:
            if not allow_stacking:
                await ui.remove_coupon()
            before = await ui.total()
            accepted_by_ui, message = await ui.apply_coupon(coupon.code)
            after = await ui.total()
            accepted = accepted_by_ui and after < before
            attempt = CouponAttempt(
                code=coupon.code,
                source_url=coupon.source_url,
                before_total=before,
                after_total=after,
                accepted=accepted,
                message=message,
                rejection_reason=None if accepted else _rejection_reason(message),
            )
            attempts.append(attempt)
            if accepted and (best is None or attempt.after_total < best.after_total):
                best = attempt

        if not allow_stacking:
            await ui.remove_coupon()
            if best is not None:
                restored, _ = await ui.apply_coupon(best.code)
                restored_total = await ui.total()
                if not restored or restored_total != best.after_total:
                    raise RuntimeError("Could not restore the verified winning coupon/cart state")
        return attempts


def _rejection_reason(message: str | None) -> str:
    folded = " ".join((message or "").casefold().split())
    markers = (
        ("minimum", "minimum_not_met"),
        ("invalid", "invalid_code"),
        ("expired", "expired"),
        ("not valid", "not_eligible"),
        ("not eligible", "not_eligible"),
        ("payment method", "payment_method_required"),
        ("already applied", "already_applied"),
        ("not stack", "not_stackable"),
    )
    return next((reason for marker, reason in markers if marker in folded), "unknown")
