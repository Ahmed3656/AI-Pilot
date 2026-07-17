from datetime import UTC, datetime

from fastapi import APIRouter

from agent_ai.config.settings import get_settings
from agent_ai.schemas.health import HealthResponse

router = APIRouter(prefix="/health", tags=["health"])


def status() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=get_settings().service_name,
        timestamp=datetime.now(UTC),
    )


@router.get("", response_model=HealthResponse)
def health() -> HealthResponse:
    return status()


@router.get("/live", response_model=HealthResponse)
def liveness() -> HealthResponse:
    return status()


@router.get("/ready", response_model=HealthResponse)
def readiness() -> HealthResponse:
    # TODO(readiness): add provider checks after concrete AI providers are configured.
    return status()
