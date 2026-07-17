from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum
from typing import Any


class Category(StrEnum):
    RETAIL = "retail"
    FOOD = "food"
    CINEMA = "cinema"


class RunStatus(StrEnum):
    CREATED = "created"
    RUNNING = "running"
    NEEDS_CLARIFICATION = "needs_clarification"
    AWAITING_APPROVAL = "awaiting_approval"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ApprovalType(StrEnum):
    DOMAIN_ACCESS = "domain_access"
    ADDRESS_SHARE = "address_share"
    SEAT_HOLD = "seat_hold"
    LOGIN = "login"
    ONE_TIME_CODE = "one_time_code"
    CAPTCHA = "captcha"
    SUSPICIOUS_INSTRUCTIONS = "suspicious_instructions"
    BROWSER_WARNING = "browser_warning"
    UNEXPECTED_DOMAIN = "unexpected_domain"


@dataclass(slots=True)
class MoneyBreakdown:
    subtotal: Decimal | None = None
    delivery_fee: Decimal | None = None
    service_fee: Decimal | None = None
    booking_fee: Decimal | None = None
    discount: Decimal | None = None
    total: Decimal | None = None
    currency: str = "EGP"

    @property
    def is_complete(self) -> bool:
        return self.total is not None and self.currency == "EGP"


@dataclass(slots=True)
class Candidate:
    merchant: str
    title: str
    url: str
    money: MoneyBreakdown
    exact_match: bool = True
    valid: bool = True
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class CouponAttempt:
    code: str
    source_url: str
    before_total: Decimal
    after_total: Decimal | None
    accepted: bool
    message: str | None = None

    @property
    def verified_saving(self) -> Decimal:
        if not self.accepted or self.after_total is None:
            return Decimal("0")
        return max(Decimal("0"), self.before_total - self.after_total)
