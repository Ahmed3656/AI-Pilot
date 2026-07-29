from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi import status as http_status

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
def readiness(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    gemini_missing = settings.vision_fallback_provider == "gemini" and not settings.gemini_api_key
    if settings.environment == "production" and (
        not settings.openrouter_api_key
        or gemini_missing
        or not settings.internal_token
        or not settings.control_api_url
        or not settings.selenium_remote_url
    ):
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Live AI configuration is incomplete",
        )
    return status()
