from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from agent_ai.config.settings import Settings
from agent_ai.main import app

client = TestClient(app)


def test_health_endpoints() -> None:
    for path in ("/health", "/health/live", "/health/ready"):
        response = client.get(path)
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


def test_production_readiness_fails_without_live_secrets(monkeypatch: MonkeyPatch) -> None:
    settings = app.state.settings
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    monkeypatch.setattr(settings, "internal_token", "")

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"detail": "Live AI configuration is incomplete"}


def test_production_readiness_requires_gemini_key_when_selected(
    monkeypatch: MonkeyPatch,
) -> None:
    settings = app.state.settings
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "openrouter_api_key", "configured")
    monkeypatch.setattr(settings, "internal_token", "configured")
    monkeypatch.setattr(settings, "vision_fallback_provider", "gemini")
    monkeypatch.setattr(settings, "gemini_api_key", "")

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"detail": "Live AI configuration is incomplete"}


def test_run_browser_ttl_uses_the_canonical_unprefixed_name(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("RUN_BROWSER_TTL_SECONDS", "2700")

    settings = Settings(_env_file=None)

    assert settings.run_browser_ttl_seconds == 2700
