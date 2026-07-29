from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from agent_ai.models import Candidate, Category
from agent_ai.orchestrator.request_understanding import parse_delivery_date


@dataclass(frozen=True, slots=True)
class RankingResult:
    ordered: tuple[Candidate, ...]
    winner: Candidate | None
    may_claim_cheapest: bool
    may_claim_closest: bool
    explanation: str


def rank_candidates(category: Category, candidates: list[Candidate]) -> RankingResult:
    if category is Category.FOOD:
        return _rank_food(candidates)
    eligible = [
        candidate
        for candidate in candidates
        if candidate.valid and candidate.exact_match and candidate.money.is_complete
    ]
    ordered = tuple(sorted(eligible, key=lambda candidate: _offer_sort_key(category, candidate)))
    noun = {
        Category.RETAIL: "exact valid retail matches",
        Category.FOOD: "meal and rating matches",
        Category.CINEMA: "showtime and seat-constraint matches",
    }[category]
    if not ordered:
        return RankingResult((), None, False, False, f"No complete {noun} were available.")
    may_claim = len(ordered) >= 2
    explanation = (
        f"Lowest complete EGP total among {len(ordered)} {noun}."
        if may_claim
        else f"Only one complete {noun[:-2] if noun.endswith('es') else noun} was available; "
        "it must not be called cheapest."
    )
    return RankingResult(ordered, ordered[0], may_claim, False, explanation)


def _rank_food(candidates: list[Candidate]) -> RankingResult:
    eligible = [
        candidate
        for candidate in candidates
        if candidate.valid and candidate.exact_match and candidate.money.subtotal is not None
    ]
    ordered = tuple(sorted(eligible, key=_food_sort_key))
    if not ordered:
        return RankingResult(
            (),
            None,
            False,
            False,
            "No matching restaurant with a verified displayed price was available.",
        )
    route_distances = [
        _distance(candidate)
        for candidate in ordered
        if candidate.details.get("proximity_basis") == "route_distance"
    ]
    may_claim_closest = len(route_distances) == len(ordered) and len(ordered) >= 2
    menu_only = any(candidate.details.get("price_scope") == "menu_price" for candidate in ordered)
    explanation = (
        f"Closest verified branch among {len(ordered)} matching restaurants; ties use "
        "the verified delivered total, then the displayed menu price."
        if may_claim_closest
        else f"Best proximity evidence among {len(ordered)} matching restaurants; exact route "
        "distance was not available for every option, so the result must not be called closest."
    )
    if menu_only:
        explanation += " Menu-only prices exclude unverified delivery, service, and tax charges."
    return RankingResult(ordered, ordered[0], False, may_claim_closest, explanation)


def _food_sort_key(candidate: Candidate) -> tuple[int, Decimal, Decimal, str]:
    basis = str(candidate.details.get("proximity_basis", "unknown"))
    proximity_order = {
        "route_distance": 0,
        "same_area": 1,
        "branch_area_only": 2,
        "unknown": 3,
    }.get(basis, 3)
    observed_distance = _distance(candidate)
    distance = observed_distance if observed_distance is not None else Decimal("Infinity")
    observed_price = (
        candidate.money.total
        if candidate.details.get("price_scope") == "delivered_total"
        and candidate.money.total is not None
        else candidate.money.subtotal
    )
    price = observed_price if observed_price is not None else Decimal("Infinity")
    return proximity_order, distance, price, candidate.title.casefold()


def _distance(candidate: Candidate) -> Decimal | None:
    value = candidate.details.get("distance_km")
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _offer_sort_key(
    category: Category,
    candidate: Candidate,
) -> tuple[Decimal, str, float, str]:
    assert candidate.money.total is not None
    if category is Category.RETAIL:
        delivery = parse_delivery_date(candidate.details.get("delivery_estimate"))
        suitability = delivery.isoformat() if delivery else "9999-12-31"
    else:
        suitability = str(
            candidate.details.get("showtime") or candidate.details.get("date") or "9999-12-31"
        )
    return (
        candidate.money.total,
        suitability,
        -candidate.match_confidence,
        candidate.title.casefold(),
    )
