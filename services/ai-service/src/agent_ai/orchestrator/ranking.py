from __future__ import annotations

from dataclasses import dataclass

from agent_ai.models import Candidate, Category


@dataclass(frozen=True, slots=True)
class RankingResult:
    ordered: tuple[Candidate, ...]
    winner: Candidate | None
    may_claim_cheapest: bool
    explanation: str


def rank_candidates(category: Category, candidates: list[Candidate]) -> RankingResult:
    eligible = [
        candidate
        for candidate in candidates
        if candidate.valid and candidate.exact_match and candidate.money.is_complete
    ]
    ordered = tuple(sorted(eligible, key=lambda candidate: candidate.money.total))  # type: ignore[arg-type]
    noun = {
        Category.RETAIL: "exact valid retail matches",
        Category.FOOD: "meal and rating matches",
        Category.CINEMA: "showtime and seat-constraint matches",
    }[category]
    if not ordered:
        return RankingResult((), None, False, f"No complete {noun} were available.")
    may_claim = len(ordered) >= 2
    explanation = (
        f"Lowest complete EGP total among {len(ordered)} {noun}."
        if may_claim
        else f"Only one complete {noun[:-2] if noun.endswith('es') else noun} was available; "
        "it must not be called cheapest."
    )
    return RankingResult(ordered, ordered[0], may_claim, explanation)
