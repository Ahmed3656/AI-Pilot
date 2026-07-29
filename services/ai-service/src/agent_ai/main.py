import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError

from agent_ai.api.errors import contract_error
from agent_ai.api.router import api_router
from agent_ai.browser.session_cleanup import close_orphaned_sessions
from agent_ai.config.settings import get_settings
from agent_ai.orchestrator import RunManager
from agent_ai.orchestrator.control_client import ControlAPIClient

logger = logging.getLogger("uvicorn.error")


def create_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI):  # type: ignore[no-untyped-def]
        if settings.reap_orphaned_browser_sessions:
            closed = await asyncio.to_thread(
                close_orphaned_sessions,
                settings.selenium_remote_url,
            )
            if closed:
                logger.warning("Closed %d orphaned Selenium session(s) at startup", closed)
        yield
        await application.state.run_manager.aclose()
        await application.state.control_client.aclose()

    application = FastAPI(
        title=settings.service_name,
        version="0.1.0",
        description="DealPilot Egypt Phase 1 browser agent.",
        lifespan=lifespan,
    )
    control = ControlAPIClient(
        settings.control_api_url,
        settings.internal_token,
        timeout=settings.request_timeout_seconds,
    )
    application.state.settings = settings
    application.state.control_client = control
    application.state.run_manager = RunManager(settings, control)
    application.add_exception_handler(
        RequestValidationError,
        lambda request, exc: contract_error(
            request,
            "VALIDATION_ERROR",
            "Request validation failed",
            400,
            details=[
                {
                    "field": "/" + "/".join(str(part) for part in error["loc"] if part != "body"),
                    "code": str(error["type"]),
                    "message": str(error["msg"]),
                }
                for error in exc.errors()
            ],
        ),
    )
    application.include_router(api_router)
    return application


app = create_app()
