from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Request, status
from fastapi.responses import JSONResponse

from agent_ai.api.errors import contract_error
from agent_ai.browser import SafetyViolation
from agent_ai.orchestrator import RunManager
from agent_ai.orchestrator.manager import (
    IdempotencyConflictError,
    InvalidTransitionError,
    RunBusyError,
)
from agent_ai.schemas.runs import (
    InternalCommandRequest,
    InternalCommandResponse,
    InternalCreateRunRequest,
    InternalCreateRunResponse,
)

router = APIRouter(prefix="/internal/v1/runs", tags=["dealpilot-runs"])


def _manager(request: Request) -> RunManager:
    return request.app.state.run_manager


def _authenticate(
    request: Request,
    x_internal_token: Annotated[str | None, Header(alias="X-Internal-Token")] = None,
) -> JSONResponse | None:
    configured = request.app.state.settings.internal_token
    if not configured:
        return contract_error(
            request,
            "DEPENDENCY_UNAVAILABLE",
            "Internal authentication is not configured",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if x_internal_token is None or not secrets.compare_digest(x_internal_token, configured):
        return contract_error(
            request,
            "INVALID_INTERNAL_TOKEN",
            "Internal authentication failed",
            status.HTTP_401_UNAUTHORIZED,
        )
    return None


@router.post(
    "",
    response_model=InternalCreateRunResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_run(
    body: InternalCreateRunRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
    authentication_error: Annotated[JSONResponse | None, Depends(_authenticate)],
) -> InternalCreateRunResponse | JSONResponse:
    if authentication_error is not None:
        return authentication_error
    manager = _manager(request)
    try:
        result = await manager.create_run(body, idempotency_key)
        # Work starts only after the 202 response is on the wire. The API owns
        # persistence and must be able to commit the accepted run before the
        # first AI event arrives.
        background_tasks.add_task(manager.start, result.run_id)
        return result
    except RunBusyError as exc:
        return contract_error(
            request,
            "RATE_LIMITED",
            "The single MVP browser is busy; retry this queued run later",
            status.HTTP_429_TOO_MANY_REQUESTS,
            details=[
                {
                    "field": "runId",
                    "code": "ACTIVE_RUN",
                    "message": exc.active_run_id,
                }
            ],
            headers={"Retry-After": str(exc.retry_after)},
        )
    except IdempotencyConflictError as exc:
        return contract_error(
            request,
            "IDEMPOTENCY_KEY_REUSED",
            str(exc),
            status.HTTP_409_CONFLICT,
        )
    except ValueError as exc:
        return contract_error(request, "VALIDATION_ERROR", str(exc), status.HTTP_400_BAD_REQUEST)
    except Exception:
        return contract_error(
            request,
            "DEPENDENCY_UNAVAILABLE",
            "The browser dependency is unavailable",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )


@router.post(
    "/{run_id}/commands",
    response_model=InternalCommandResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_202_ACCEPTED,
)
async def command_run(
    run_id: str,
    body: InternalCommandRequest,
    request: Request,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
    authentication_error: Annotated[JSONResponse | None, Depends(_authenticate)],
) -> InternalCommandResponse | JSONResponse:
    if authentication_error is not None:
        return authentication_error
    try:
        return await _manager(request).command(run_id, body, idempotency_key)
    except KeyError:
        return contract_error(request, "RUN_NOT_FOUND", "Run not found", status.HTTP_404_NOT_FOUND)
    except IdempotencyConflictError as exc:
        return contract_error(
            request,
            "IDEMPOTENCY_KEY_REUSED",
            str(exc),
            status.HTTP_409_CONFLICT,
        )
    except InvalidTransitionError as exc:
        return contract_error(
            request,
            "INVALID_RUN_TRANSITION",
            str(exc),
            status.HTTP_409_CONFLICT,
        )
    except (SafetyViolation, ValueError) as exc:
        return contract_error(request, "VALIDATION_ERROR", str(exc), status.HTTP_400_BAD_REQUEST)
    except Exception:
        return contract_error(
            request,
            "DEPENDENCY_UNAVAILABLE",
            "The command could not be processed",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
