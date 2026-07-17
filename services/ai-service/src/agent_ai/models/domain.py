from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum
from typing import Any


class RequestedCategory(StrEnum):
    AUTO = "auto"
    RETAIL = "retail"
    FOOD = "food"
    CINEMA = "cinema"


class Category(StrEnum):
    RETAIL = "retail"
    FOOD = "food"
    CINEMA = "cinema"


class RunStatus(StrEnum):
    CLARIFYING = "clarifying"
    DISCOVERING = "discovering"
    AWAITING_DOMAIN_APPROVAL = "awaiting_domain_approval"
    COMPARING = "comparing"
    AWAITING_ADDRESS_CONSENT = "awaiting_address_consent"
    AWAITING_SEAT_HOLD_APPROVAL = "awaiting_seat_hold_approval"
    COUPON_TESTING = "coupon_testing"
    READY_FOR_HANDOFF = "ready_for_handoff"
    USER_TAKEOVER = "user_takeover"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


TERMINAL_STATUSES = {RunStatus.COMPLETED, RunStatus.CANCELLED, RunStatus.FAILED}


class ApprovalType(StrEnum):
    DOMAIN_ACCESS = "domain_access"
    ADDRESS_SHARE = "address_share"
    SEAT_HOLD = "seat_hold"


class PauseReason(StrEnum):
    LOGIN = "login_required"
    ONE_TIME_CODE = "one_time_code_required"
    CAPTCHA = "captcha_detected"
    PROMPT_INJECTION = "prompt_injection_detected"
    BROWSER_WARNING = "browser_warning"
    UNEXPECTED_DOMAIN = "unexpected_domain"
    ADDRESS_CONSENT = "address_consent_required"
    SEAT_HOLD = "seat_hold_approval_required"


@dataclass(frozen=True, slots=True)
class MandatoryFee:
    label: str
    amount: Decimal
    evidence_ids: tuple[str, ...] = ()


@dataclass(slots=True)
class MoneyBreakdown:
    subtotal: Decimal | None = None
    delivery_fee: Decimal | None = None
    service_fee: Decimal | None = None
    booking_fee: Decimal | None = None
    tax: Decimal | None = None
    mandatory_fees: tuple[MandatoryFee, ...] = ()
    discount: Decimal = Decimal("0")
    total: Decimal | None = None
    currency: str = "EGP"
    total_consistent: bool = True

    def recomputed_total(self) -> Decimal | None:
        components = (
            self.subtotal,
            self.delivery_fee,
            self.service_fee,
            self.booking_fee,
            self.tax,
        )
        if any(component is None for component in components):
            return None
        assert all(component is not None for component in components)
        value = sum(components, start=Decimal("0"))
        value += sum((fee.amount for fee in self.mandatory_fees), start=Decimal("0"))
        value -= self.discount
        if value < 0:
            return None
        return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    def validate_total(self) -> bool:
        recomputed = self.recomputed_total()
        self.total_consistent = (
            recomputed is not None
            and self.total is not None
            and self.total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) == recomputed
        )
        return self.total_consistent

    @property
    def is_complete(self) -> bool:
        return self.currency == "EGP" and self.validate_total()


@dataclass(slots=True)
class Candidate:
    merchant: str
    title: str
    url: str
    money: MoneyBreakdown
    exact_match: bool = True
    valid: bool = True
    details: dict[str, Any] = field(default_factory=dict)
    evidence_ids: tuple[str, ...] = ()
    incomplete_reason: str | None = None


@dataclass(slots=True)
class CouponAttempt:
    code: str
    source_url: str
    before_total: Decimal
    after_total: Decimal | None
    accepted: bool
    message: str | None = None
    rejection_reason: str | None = None
    evidence_ids: tuple[str, ...] = ()

    @property
    def verified_saving(self) -> Decimal:
        if not self.accepted or self.after_total is None:
            return Decimal("0")
        return max(Decimal("0"), self.before_total - self.after_total)
