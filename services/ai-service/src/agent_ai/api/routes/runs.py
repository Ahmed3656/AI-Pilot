from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from agent_ai.orchestrator import RunManager
from agent_ai.schemas.runs import RunCommandRequest, RunCreateRequest, RunResponse

router = APIRouter(prefix="/internal/v1/runs", tags=["dealpilot-runs"])


def _manager(request: Request) -> RunManager:
    return request.app.state.run_manager


def _authenticate(
    request: Request,
    x_internal_token: Annotated[str | None, Header(alias="X-Internal-Token")] = None,
) -> None:
    configured = request.app.state.settings.internal_token
    if not configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal authentication is not configured",
        )
    if x_internal_token is None or not secrets.compare_digest(x_internal_token, configured):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


@router.post("", response_model=RunResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_run(
    body: RunCreateRequest,
    request: Request,
    _: Annotated[None, Depends(_authenticate)],
) -> RunResponse:
    manager = _manager(request)
    try:
        result = await manager.create_run(body)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not notify AI control API") from exc
    await manager.start(result.run_id)
    return result


@router.post("/{run_id}/commands", response_model=RunResponse)
async def command_run(
    run_id: str,
    body: RunCommandRequest,
    request: Request,
    _: Annotated[None, Depends(_authenticate)],
) -> RunResponse:
    try:
        return await _manager(request).command(run_id, body)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Run not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
