from fastapi.testclient import TestClient

from agent_ai.main import app

client = TestClient(app)


def test_health_endpoints() -> None:
    for path in ("/health", "/health/live", "/health/ready"):
        response = client.get(path)
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
