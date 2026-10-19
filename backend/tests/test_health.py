import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://127.0.0.1:5173")
    with TestClient(create_app()) as test_client:
        yield test_client


def test_health_contract(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "real-rent-api"}


def test_configured_frontend_origin_is_allowed(client):
    response = client.options(
        "/api/health",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_unconfigured_origin_is_not_allowed(client):
    response = client.options(
        "/api/health",
        headers={
            "Origin": "https://unconfigured.invalid",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
