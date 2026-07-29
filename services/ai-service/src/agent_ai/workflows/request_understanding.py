from __future__ import annotations

from typing import Any

from agent_ai.models import Category
from agent_ai.workflows.search_query import retail_search_query


def fallback_request_understanding(user_query: str, category: Category) -> dict[str, Any]:
    """Safe fallback used only when the live language-model preflight is unavailable."""

    search_query = (
        retail_search_query(user_query)
        if category is Category.RETAIL
        else " ".join(user_query.split())[:200]
    )
    return {
        "category": category.value,
        "search_query": search_query,
        "target": {
            "name": search_query,
            "brand": None,
            "model": None,
            "variant": None,
            "specifications": [],
        },
        "constraints": {},
        "comparison_priorities": ["exact_match", "complete_total"],
        "requires_checkout": False,
        "requires_coupons": False,
    }


def normalize_request_understanding(
    value: Any,
    *,
    user_query: str,
    category: Category,
) -> dict[str, Any]:
    fallback = fallback_request_understanding(user_query, category)
    if not isinstance(value, dict):
        return fallback

    target_value = value.get("target")
    target = target_value if isinstance(target_value, dict) else {}
    search_query = _text(value.get("search_query"), 200) or fallback["search_query"]
    specifications = _text_list(target.get("specifications"), limit=20, item_limit=120)
    constraints_value = value.get("constraints")
    constraints = constraints_value if isinstance(constraints_value, dict) else {}

    return {
        "category": category.value,
        "search_query": search_query,
        "target": {
            "name": _text(target.get("name"), 200) or search_query,
            "brand": _text(target.get("brand"), 100),
            "model": _text(target.get("model"), 100),
            "variant": _text(target.get("variant"), 120),
            "specifications": specifications,
        },
        "constraints": {
            str(key)[:80]: normalized
            for key, item in list(constraints.items())[:30]
            if (normalized := _constraint(item)) is not None
        },
        "comparison_priorities": _text_list(
            value.get("comparison_priorities"), limit=10, item_limit=80
        )
        or fallback["comparison_priorities"],
        "requires_checkout": value.get("requires_checkout") is True,
        "requires_coupons": value.get("requires_coupons") is True,
    }


def _text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split()).strip()
    return normalized[:limit] or None


def _text_list(value: Any, *, limit: int, item_limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value[:limit]:
        text = _text(item, item_limit)
        if text and text not in result:
            result.append(text)
    return result


def _constraint(value: Any) -> str | int | float | bool | None:
    if isinstance(value, bool | int | float):
        return value
    return _text(value, 160)
