from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AI_",
        env_file=".env",
        extra="ignore",
    )

    service_name: str = "AI Pilot AI Service"
    environment: Literal["development", "test", "production"] = "development"
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    model: str = "openai/gpt-5.2"
    openrouter_api_key: str = ""
    selenium_remote_url: str = "http://browser:4444/wd/hub"
    control_api_url: str = "http://api:3000"
    internal_token: str = ""
    run_browser_ttl_seconds: int = Field(
        default=3600,
        ge=1,
        validation_alias="RUN_BROWSER_TTL_SECONDS",
    )
    max_computer_steps: int = Field(default=80, ge=1, le=200)
    request_timeout_seconds: float = Field(default=30.0, gt=0, le=120)


@lru_cache
def get_settings() -> Settings:
    return Settings()
