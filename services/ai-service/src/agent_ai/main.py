from fastapi import FastAPI

from agent_ai.api.router import api_router
from agent_ai.config.settings import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title=settings.service_name,
        version="0.1.0",
        description="Foundational AI service. Agent behavior is intentionally absent.",
    )
    application.include_router(api_router)
    return application


app = create_app()
