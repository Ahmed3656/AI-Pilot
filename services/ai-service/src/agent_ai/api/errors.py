from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import Request
from fastapi.responses import JSONResponse


def contract_error(
    request: Request,
    code: str,
    message: str,
    status_code: int,
    *,
    details: list[dict[str, Any]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    request_id = request.headers.get("X-Request-Id") or f"ai:{uuid4()}"
    return JSONResponse(
        status_code=status_code,
        headers=headers,
        content={
            "error": {
                "code": code,
                "message": message,
                "status": status_code,
                "requestId": request_id,
                "timestamp": datetime.now(UTC)
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z"),
                "details": details or [],
            }
        },
    )
