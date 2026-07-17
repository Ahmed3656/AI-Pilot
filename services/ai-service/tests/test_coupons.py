from decimal import Decimal
from pathlib import Path

import pytest

from agent_ai.tools.coupons import CouponEngine, PublicCoupon

FIXTURES = Path(__file__).parent / "fixtures"


class FakeCouponUI:
    explicitly_supports_stacking = False

    def __init__(self) -> None:
        self.current = Decimal("100")
        self.applied: str | None = None
        self.remove_count = 0
        self.error = (FIXTURES / "coupon_rejected.html").read_text(encoding="utf-8")

    async def total(self) -> Decimal:
        return self.current

    async def apply_coupon(self, code: str) -> tuple[bool, str | None]:
        self.applied = code
        if code == "WIN15":
            self.current = Decimal("85")
            return True, "Coupon applied"
        if code == "LIES":
            return True, "Coupon applied"
        return False, self.error

    async def remove_coupon(self) -> None:
        self.remove_count += 1
        self.applied = None
        self.current = Decimal("100")


@pytest.mark.asyncio
async def test_rejected_and_unverified_coupons_are_not_claimed_and_winner_is_restored() -> None:
    ui = FakeCouponUI()
    coupons = [
        PublicCoupon(code, f"https://coupons.example/source/{index}")
        for index, code in enumerate(("NOPE", "LIES", "WIN15", "BAD4", "BAD5", "IGNORED"))
    ]
    attempts = await CouponEngine().test(ui, coupons)

    assert len(attempts) == 5
    assert attempts[1].accepted is False
    assert attempts[1].verified_saving == 0
    assert attempts[0].source_url.endswith("/0")
    assert attempts[0].rejection_reason == "not_eligible"
    assert attempts[2].accepted is True
    assert attempts[2].source_url.endswith("/2")
    assert attempts[2].before_total == Decimal("100")
    assert attempts[2].after_total == Decimal("85")
    assert ui.applied == "WIN15"
    assert ui.current == Decimal("85")
    assert ui.remove_count == 6


@pytest.mark.asyncio
async def test_coupon_sources_and_stacking_are_strict() -> None:
    ui = FakeCouponUI()
    with pytest.raises(ValueError, match="public HTTP"):
        await CouponEngine().test(ui, [PublicCoupon("X", "private-note")])
    with pytest.raises(ValueError, match="explicitly supports"):
        await CouponEngine().test(
            ui,
            [PublicCoupon("X", "https://example.com/x")],
            allow_stacking=True,
        )
