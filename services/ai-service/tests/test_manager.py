from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from agent_ai.config.settings import Settings
from agent_ai.models import Category, RunStatus
from agent_ai.orchestrator.manager import RunManager
from agent_ai.schemas.runs import RunCommandRequest, RunCreateRequest


class FakeControl:
    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any]]] = []

    async def emit(self, run_id: str, event_type: str, payload: dict[str, Any]) -> None:
        self.events.append((run_id, event_type, payload))

    async def resolve_secret(self, *_: Any) -> str:
        return "resolved"


class FakeBrowser:
    def __init__(self) -> None:
        self.urls: list[str] = []
        self.expected_domain: str | None = None
        self.closed = False

    def navigate(
        self,
        url: str,
        category: Category,
        *,
        separate_tab: bool = False,
    ) -> None:
        assert category is Category.RETAIL
        assert separate_tab is True
        self.urls.append(url)
        self.expected_domain = url.split("/")[2].removeprefix("www.")

    def close(self) -> None:
        self.closed = True


class FakeAgent:
    async def run(self, **_: Any) -> str:
        return json.dumps(
            {
                "candidates": [
                    {
                        "merchant": "Amazon Egypt",
                        "title": "Exact phone",
                        "url": "https://www.amazon.eg/item",
                        "exact_match": True,
                        "valid": True,
                        "subtotal": "1000",
                        "delivery_fee": "25",
                        "service_fee": None,
                        "booking_fee": None,
                        "discount": "0",
                        "total": "1025",
                        "currency": "EGP",
                        "details": {
                            "brand": "Brand",
                            "model": "X",
                            "variant": "128 GB",
                            "storage": "128 GB",
                            "size": "not applicable",
                            "color": "black",
                            "quantity": 1,
                            "stock": True,
                            "seller_condition": "new",
                            "delivery_estimate": "tomorrow",
                        },
                    }
                ],
                "coupon_attempts": [],
                "stopped_before": "payment",
                "notes": [],
            }
        )


@pytest.mark.asyncio
async def test_manager_waits_for_fixed_domain_approval_then_completes_with_fakes() -> None:
    control = FakeControl()
    browser = FakeBrowser()
    manager = RunManager(
        Settings(internal_token="token", openai_api_key="fake"),
        control,  # type: ignore[arg-type]
        agent_factory=FakeAgent,
        browser_factory=lambda: browser,  # type: ignore[arg-type,return-value]
    )
    created = await manager.create_run(
        RunCreateRequest.model_validate(
            {
                "runId": "control-run-1",
                "category": "retail",
                "query": "Find the best option",
                "market": "EG",
                "currency": "EGP",
            }
        )
    )
    await manager.start(created.run_id)
    for _ in range(50):
        if manager.get(created.run_id).status is RunStatus.AWAITING_APPROVAL:
            break
        await asyncio.sleep(0)

    pending = manager.get(created.run_id)
    assert pending.pending_approval["approval_type"] == "domain_access"
    await manager.command(
        created.run_id,
        RunCommandRequest.model_validate(
            {
                "type": "approve_domains",
                "domains": ["amazon.eg", "jumia.com.eg", "noon.com"],
            }
        ),
    )
    await manager.tasks[created.run_id]

    result = manager.get(created.run_id)
    assert result.status is RunStatus.COMPLETED
    assert result.id == "control-run-1"
    assert len(browser.urls) == 3
    assert browser.closed is True
    assert result.result["may_claim_cheapest"] is False
    assert any(event_type == "offer_normalized" for _, event_type, _ in control.events)
