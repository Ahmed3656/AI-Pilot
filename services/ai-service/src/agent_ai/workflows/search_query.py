from __future__ import annotations

import re

_LEADING_REQUEST_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"^(?:please\s+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?",
        r"^(?:please\s+)?help\s+me\s+(?:to\s+)?",
        r"^i(?:'d|\s+would)?\s+(?:like|want|need)(?:\s+you)?(?:\s+to)?\s+",
        r"^i(?:'m|\s+am)\s+looking\s+for\s+",
        (
            r"^(?:please\s+)?(?:find|search(?:\s+for)?|look\s+for|show\s+me|buy|"
            r"purchase|get)(?:\s+me)?(?:\s+for)?\s+"
        ),
        r"^(?:من\s+فضلك|لو\s+سمحت)\s*",
        (
            r"^(?:أنا\s+)?(?:عايز|عاوز|أريد|اريد|محتاج)(?:ك)?"
            r"(?:\s+(?:أشتري|اشتري|شراء|ألاقي|الاقي|تجيب(?:لي)?))?\s+"
        ),
        r"^(?:دور(?:\s+لي)?\s+على|ابحث(?:\s+لي)?\s+عن|هات(?:\s+لي)?|اشتري(?:\s+لي)?)\s+",
    )
)

_MERCHANT_SCOPE = re.compile(
    r"\b(?:on|from|across)\s+"
    r"(?:amazon(?:\s+egypt)?|jumia(?:\s+egypt)?|noon(?:\s+egypt)?)"
    r"(?:(?:\s*,\s*|\s+(?:and|or)\s+)"
    r"(?:amazon(?:\s+egypt)?|jumia(?:\s+egypt)?|noon(?:\s+egypt)?))*",
    re.IGNORECASE,
)

_PRICE_CONSTRAINTS = (
    re.compile(
        r"\b(?:under|below|less\s+than|up\s+to|no\s+more\s+than|"
        r"max(?:imum)?(?:\s+budget)?(?:\s+of)?|budget(?:\s+(?:of|is))?\s*:?)\s*"
        r"(?:egp|e£|£)?\s*[\d٠-٩۰-۹][\d٠-٩۰-۹\s,.]*\s*(?:egp|e£|£)?\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:بأقل\s+من|باقل\s+من|أقل\s+من|اقل\s+من|حتى|حد\s+أقصى|حد\s+اقصى|"
        r"ميزاني(?:ة|ه)(?:\s+قدرها)?)[\s:]*(?:حوالي\s+)?"
        r"[\d٠-٩۰-۹][\d٠-٩۰-۹\s,.]*(?:جنيه|جنية|جنيهًا|جنيها|EGP)?",
        re.IGNORECASE,
    ),
)

_TRAILING_OPERATION = re.compile(
    r"\s*(?:[,;.،]\s*|\b(?:and|then)\s+|و)"
    r"(?:please\s+)?(?:compare(?:\s+(?:the|their))?\s+prices?.*|"
    r"find\s+(?:the\s+)?(?:cheapest|best\s+(?:price|deal)).*|"
    r"tell\s+me\s+(?:the\s+)?(?:cheapest|best).*|"
    r"add\s+(?:it|the\s+best\s+one)\s+to\s+(?:the\s+)?cart.*|"
    r"قارن\s+(?:لي\s+)?(?:ال)?[أا]سعار.*|شوف\s+(?:لي\s+)?[أا]رخص.*|"
    r"هات\s+(?:لي\s+)?[أا]رخص.*)$",
    re.IGNORECASE,
)


def retail_search_query(user_query: str, *, max_chars: int = 160) -> str:
    """Turn a shopping request into concise catalog-search terms.

    The complete request remains available to the computer agent for validation and ranking;
    this value is only the retailer search-box query. The transformation is deliberately
    conservative so brand, model, variant, and differentiating specifications survive.
    """

    normalized = " ".join(user_query.split()).strip(" \t\r\n,;:.،؟?!")
    search = normalized

    # Requests often stack polite/intention prefixes ("could you help me find...").
    for _ in range(4):
        previous = search
        for pattern in _LEADING_REQUEST_PATTERNS:
            search = pattern.sub("", search, count=1).strip()
        if search == previous:
            break

    search = re.sub(r"^(?:an?|the)\s+", "", search, flags=re.IGNORECASE)
    search = re.sub(r"^(?:product|item)\s+", "", search, flags=re.IGNORECASE)
    search = _MERCHANT_SCOPE.sub(" ", search)
    for pattern in _PRICE_CONSTRAINTS:
        search = pattern.sub(" ", search)
    search = _TRAILING_OPERATION.sub("", search)
    search = " ".join(search.strip(" \t\r\n,;:.،؟?!-").split())

    # Never turn an unusual but valid request into an empty search.
    if not search:
        search = normalized
    if len(search) <= max_chars:
        return search
    clipped = search[: max_chars + 1].rsplit(" ", 1)[0].strip()
    return clipped or search[:max_chars].strip()
