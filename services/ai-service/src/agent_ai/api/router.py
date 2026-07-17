from fastapi import APIRouter

from agent_ai.api.routes.health import router as health_router

api_router = APIRouter()
api_router.include_router(health_router)
