from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from agent_ai.models import MoneyBreakdown
from agent_ai.utils.egypt import normalize_digits

try:
    CAIRO = ZoneInfo("Africa/Cairo")
except ZoneInfoNotFoundError:  # Windows may not ship the IANA database.
    CAIRO = datetime.now().astimezone().tzinfo

_DAY_INDEX = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

_BRANDS = {
    "samsung": "Samsung",
    "galaxy": "Samsung",
    "apple": "Apple",
    "iphone": "Apple",
    "xiaomi": "Xiaomi",
    "redmi": "Xiaomi",
    "oppo": "Oppo",
    "realme": "Realme",
    "honor": "Honor",
    "huawei": "Huawei",
    "nokia": "Nokia",
    "motorola": "Motorola",
    "lenovo": "Lenovo",
    "dell": "Dell",
    "hp": "HP",
    "asus": "Asus",
    "acer": "Acer",
}

_STORAGE = re.compile(
    r"(?<!\d)(?P<value>\d{2,4})\s*(?:g\.?b\.?|gigabytes?|جيجا(?:\s*بايت)?)(?!\w)",
    re.IGNORECASE,
)
_PRICE_CEILING = re.compile(
    r"(?:under|below|less\s+than|up\s+to|at\s+most|max(?:imum)?(?:\s+budget)?|"
    r"budget(?:\s+of|\s+is)?|لا\s+يزيد\s+عن|أقل\s+من|اقل\s+من|بحد\s+أقصى)"
    r"\s*(?:egp|le|l\.?e\.?)?\s*"
    r"(?P<amount>\d[\d,\s]*(?:\.\d{1,2})?)\s*(?:egp|le|l\.?e\.?|ج\.?\s*م|جنيه)?",
    re.IGNORECASE,
)
_DAY_DEADLINE = re.compile(
    r"\b(?P<operator>by|before|no\s+later\s+than|on)\s+"
    r"(?P<day>monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
    re.IGNORECASE,
)
_SAMSUNG_MODEL = re.compile(
    r"\b(?:galaxy\s+)?(?P<model>[asmz]\s?\d{2,3}(?:\s*(?:5g|fe|ultra|plus|\+))?)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class RetailConstraints:
    brand: str | None = None
    model: str | None = None
    storage_gb: int | None = None
    max_total: Decimal | None = None
    delivery_deadline: date | None = None
    delivery_phrase: str | None = None

    @property
    def has_constraints(self) -> bool:
        return any(
            value is not None
            for value in (
                self.brand,
                self.model,
                self.storage_gb,
                self.max_total,
                self.delivery_deadline,
            )
        )

    def prompt_context(self, reference: datetime | date | None = None) -> str:
        current = _reference_date(reference)
        parts: list[str] = []
        if self.brand:
            parts.append(f"brand exactly {self.brand}")
        if self.model:
            parts.append(f"model exactly {self.model}")
        if self.storage_gb is not None:
            parts.append(f"storage exactly {self.storage_gb} GB")
        if self.max_total is not None:
            parts.append(f"maximum complete delivered total EGP {self.max_total:.2f}")
        if self.delivery_deadline:
            parts.append(f"verified delivery on or before {self.delivery_deadline.isoformat()}")
        if not parts:
            return ""
        return (
            f"Africa/Cairo reference date: {current.isoformat()}. Parsed hard constraints: "
            + "; ".join(parts)
            + ". Do not relax or substitute any hard constraint. A price ceiling applies to the "
            "complete delivered total after mandatory fees and verified discounts, not only the "
            "item price. When a delivery deadline is present, set details.delivery_estimate to the "
            "verified arrival date in YYYY-MM-DD form; use null when it cannot be verified. If the "
            "arrival estimate needs a delivery address, trigger the address-consent flow with a "
            "semantic secret placeholder before deciding whether the offer qualifies."
        )


@dataclass(frozen=True, slots=True)
class ConstraintOutcome:
    exclusion_reason: str | None = None
    incomplete_reason: str | None = None


def interpret_retail_query(
    query: str,
    *,
    reference: datetime | date | None = None,
) -> RetailConstraints:
    folded = " ".join(normalize_digits(query).casefold().split())
    brand = next((canonical for token, canonical in _BRANDS.items() if _word(token, folded)), None)

    model = None
    samsung_model = _SAMSUNG_MODEL.search(folded)
    if samsung_model:
        model = re.sub(r"\s+", "", samsung_model.group("model")).upper()

    storage_match = _STORAGE.search(folded)
    storage_gb = int(storage_match.group("value")) if storage_match else None

    max_total = None
    price_match = _PRICE_CEILING.search(folded)
    if price_match:
        amount = re.sub(r"[,\s]", "", price_match.group("amount"))
        try:
            max_total = Decimal(amount)
        except InvalidOperation:
            max_total = None

    delivery_deadline = None
    delivery_phrase = None
    deadline_match = _DAY_DEADLINE.search(folded)
    if deadline_match:
        current = _reference_date(reference)
        target_index = _DAY_INDEX[deadline_match.group("day").casefold()]
        days_ahead = (target_index - current.weekday()) % 7
        delivery_deadline = current + timedelta(days=days_ahead)
        if deadline_match.group("operator").casefold() == "before":
            delivery_deadline -= timedelta(days=1)
        delivery_phrase = deadline_match.group(0)

    return RetailConstraints(
        brand=brand,
        model=model,
        storage_gb=storage_gb,
        max_total=max_total,
        delivery_deadline=delivery_deadline,
        delivery_phrase=delivery_phrase,
    )


def check_retail_constraints(
    constraints: RetailConstraints,
    *,
    title: str,
    details: dict[str, Any],
    money: MoneyBreakdown,
    reference: datetime | date | None = None,
) -> ConstraintOutcome:
    if constraints.brand:
        observed = f"{details.get('brand', '')} {title}"
        if not _contains_token(observed, constraints.brand):
            if not str(details.get("brand", "")).strip():
                return ConstraintOutcome(incomplete_reason="BRAND_UNVERIFIED")
            return ConstraintOutcome(exclusion_reason="BRAND_MISMATCH")

    if constraints.model:
        observed = f"{details.get('model', '')} {title}"
        if not _contains_token(observed, constraints.model):
            if not str(details.get("model", "")).strip():
                return ConstraintOutcome(incomplete_reason="MODEL_UNVERIFIED")
            return ConstraintOutcome(exclusion_reason="MODEL_MISMATCH")

    if constraints.storage_gb is not None:
        observed_storage = _storage_value(details.get("storage"))
        if observed_storage is None:
            return ConstraintOutcome(incomplete_reason="STORAGE_UNVERIFIED")
        if observed_storage != constraints.storage_gb:
            return ConstraintOutcome(exclusion_reason="STORAGE_MISMATCH")

    if constraints.max_total is not None:
        if money.total is None:
            return ConstraintOutcome(incomplete_reason="DELIVERED_TOTAL_UNVERIFIED")
        if money.total > constraints.max_total:
            return ConstraintOutcome(exclusion_reason="BUDGET_EXCEEDED")

    if constraints.delivery_deadline:
        arrival = parse_delivery_date(details.get("delivery_estimate"), reference=reference)
        if arrival is None:
            return ConstraintOutcome(incomplete_reason="DELIVERY_DEADLINE_UNVERIFIED")
        if arrival > constraints.delivery_deadline:
            return ConstraintOutcome(exclusion_reason="DELIVERY_DEADLINE_MISSED")

    return ConstraintOutcome()


def parse_delivery_date(value: Any, *, reference: datetime | date | None = None) -> date | None:
    text = " ".join(str(value or "").strip().casefold().split())
    if not text:
        return None
    iso = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", text)
    if iso:
        try:
            return date.fromisoformat(iso.group(1))
        except ValueError:
            return None
    current = _reference_date(reference)
    if text in {"today", "same day"}:
        return current
    if text == "tomorrow":
        return current + timedelta(days=1)
    for day_name, day_index in _DAY_INDEX.items():
        if _word(day_name, text):
            return current + timedelta(days=(day_index - current.weekday()) % 7)
    return None


def _reference_date(value: datetime | date | None) -> date:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=CAIRO).date()
        return value.astimezone(CAIRO).date()
    if isinstance(value, date):
        return value
    return datetime.now(CAIRO).date()


def _storage_value(value: Any) -> int | None:
    match = _STORAGE.search(normalize_digits(str(value or "")))
    return int(match.group("value")) if match else None


def _contains_token(haystack: str, needle: str) -> bool:
    normalized_haystack = re.sub(r"[^a-z0-9]+", " ", haystack.casefold()).strip()
    normalized_needle = re.sub(r"[^a-z0-9]+", " ", needle.casefold()).strip()
    return bool(
        normalized_needle
        and re.search(rf"(?<!\w){re.escape(normalized_needle)}(?!\w)", normalized_haystack)
    )


def _word(value: str, text: str) -> bool:
    return bool(re.search(rf"(?<!\w){re.escape(value)}(?!\w)", text))
