from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote
from uuid import uuid4

import httpx

from agent_ai.models import RunStatus

_EVENT_TYPES = {
    "run.created",
    "run.clarification_required",
    "run.clarification_submitted",
    "run.status_changed",
    "domains.approval_required",
    "domains.approved",
    "address.approval_required",
    "address.granted",
    "seat_hold.approval_required",
    "seat_hold.approved",
    "merchant.attempt_started",
    "merchant.attempt_completed",
    "offer.recorded",
    "coupon.attempted",
    "evidence.captured",
    "run.warning",
    "control.claimed",
    "control.renewed",
    "control.released",
    "control.lease_expired",
    "report.updated",
    "run.completed",
    "run.cancelled",
    "run.failed",
}


class ControlAPIClient:
    def __init__(
        self,
        base_url: str,
        internal_token: str,
        *,
        timeout: float = 30.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.internal_token = internal_token
        self._owns_client = client is None
        self.client = client or httpx.AsyncClient(timeout=timeout)

    @property
    def _headers(self) -> dict[str, str]:
        return {"X-Internal-Token": self.internal_token}

    async def emit(
        self,
        run_id: str,
        event_type: str,
        payload: dict[str, Any],
        *,
        status: RunStatus | None = None,
        event_id: str | None = None,
    ) -> str:
        if event_type not in _EVENT_TYPES:
            raise ValueError(f"Unsupported frozen event type: {event_type}")
        if status is None:
            raise ValueError("Frozen event envelopes require the post-event run status")
        identifier = event_id or f"ai:{uuid4()}"
        body = {
            "id": identifier,
            "runId": run_id,
            "type": event_type,
            "status": status.value,
            "timestamp": _timestamp(),
            "payload": payload,
        }
        response: httpx.Response | None = None
        for attempt in range(5):
            response = await self.client.post(
                f"{self.base_url}/internal/v1/ai-events",
                headers=self._headers,
                json=body,
            )
            if response.status_code not in {404, 409, 502, 503}:
                break
            await asyncio.sleep(0.05 * (2**attempt))
        assert response is not None
        if response.is_error:
            try:
                error_code = str(response.json().get("error", {}).get("code", "unknown"))
            except (TypeError, ValueError):
                error_code = "unknown"
            raise RuntimeError(
                f"Control API rejected {event_type} with HTTP {response.status_code} ({error_code})"
            )
        return identifier

    async def resolve_secret(
        self,
        handle: str,
        run_id: str,
        merchant_domain: str,
        field: str,
    ) -> str:
        response = await self.client.post(
            f"{self.base_url}/internal/v1/secrets/resolve",
            headers=self._headers,
            json={
                "runId": run_id,
                "secretReference": handle,
                "merchantDomain": merchant_domain,
                "field": field,
            },
        )
        response.raise_for_status()
        body = response.json()
        value = body.get("value")
        if not isinstance(value, str) or not value:
            raise RuntimeError("Secret resolver returned no value")
        return value

    async def upload_evidence(self, run_id: str, evidence_id: str, png: bytes) -> None:
        response: httpx.Response | None = None
        path = (
            f"{self.base_url}/internal/v1/evidence/"
            f"{quote(run_id, safe='')}/{quote(evidence_id, safe='')}"
        )
        for attempt in range(5):
            response = await self.client.post(
                path,
                headers=self._headers,
                files={"file": ("screenshot.png", png, "image/png")},
            )
            if response.status_code not in {404, 409, 502, 503}:
                break
            await asyncio.sleep(0.05 * (2**attempt))
        assert response is not None
        if response.is_error:
            raise RuntimeError(
                f"Control API rejected screenshot evidence with HTTP {response.status_code}"
            )

    async def aclose(self) -> None:
        if self._owns_client:
            await self.client.aclose()


def _timestamp(value: datetime | None = None) -> str:
    current = value or datetime.now(UTC)
    return current.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
