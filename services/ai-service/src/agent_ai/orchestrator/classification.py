from __future__ import annotations

import re

from agent_ai.models import Category
from agent_ai.utils.egypt import normalize_digits

_TERMS: dict[Category, tuple[str, ...]] = {
    Category.RETAIL: (
        "amazon",
        "jumia",
        "noon",
        "buy",
        "price of",
        "product",
        "electronics",
        "appliance",
        "phone",
        "iphone",
        "laptop",
        "television",
        "headphones",
        "samsung",
        "galaxy",
        "xiaomi",
        "redmi",
        "oppo",
        "realme",
        "honor",
        "huawei",
        "اشتري",
        "شراء",
        "منتج",
        "إلكترونيات",
        "موبايل",
        "هاتف",
        "لابتوب",
        "سماعة",
        "أمازون",
        "جوميا",
        "نون",
    ),
    Category.FOOD: (
        "talabat",
        "menuegypt",
        "menu egypt",
        "elmenus",
        "restaurant",
        "restaurants",
        "meal",
        "food",
        "burger",
        "burgers",
        "pizza",
        "koshari",
        "koshary",
        "shawarma",
        "shawerma",
        "lunch",
        "dinner",
        "طلبات",
        "مطعم",
        "مطاعم",
        "وجبة",
        "أكل",
        "اكل",
        "برجر",
        "بيتزا",
        "شاورما",
    ),
    Category.CINEMA: (
        "vox",
        "cinema",
        "movie",
        "showtime",
        "screening",
        "seat",
        "فيلم",
        "سينما",
        "السينما",
        "تذكرة فيلم",
        "موعد عرض",
        "عرض الفيلم",
        "مقاعد",
        "فوكس",
    ),
}

_PATTERNS: dict[Category, tuple[re.Pattern[str], ...]] = {
    Category.RETAIL: (
        re.compile(r"(?<!\w)(?:galaxy\s+)?[asmz]\s?\d{2,3}(?:\s*(?:5g|fe|ultra|plus))?(?!\w)"),
        re.compile(r"(?<!\w)\d{2,4}\s*(?:gb|gigabytes?)(?!\w)"),
    ),
    Category.FOOD: (),
    Category.CINEMA: (),
}


def classify_request(query: str) -> Category | None:
    """Return one safe category or None when zero/multiple categories are plausible."""
    folded = " ".join(normalize_digits(query).casefold().split())
    scores: dict[Category, int] = {}
    for category, terms in _TERMS.items():
        scores[category] = sum(
            1 for term in terms if re.search(rf"(?<!\w){re.escape(term)}(?!\w)", folded)
        ) + sum(1 for pattern in _PATTERNS[category] if pattern.search(folded))
    matches = [category for category, score in scores.items() if score > 0]
    if len(matches) != 1:
        return None
    return matches[0]


def clarification_message(query: str) -> str:
    arabic = bool(re.search(r"[\u0600-\u06ff]", query))
    if arabic:
        return "هل تبحث عن منتج من متجر، أو وجبة من مطعم، أو تذاكر سينما؟"
    return "Are you looking for a retail product, a restaurant meal, or cinema tickets?"
