import pytest
from fastapi.testclient import TestClient

from stellar_blaze import __version__
from stellar_blaze.api.app import create_app
from stellar_blaze.config import Settings


@pytest.mark.unit
def test_live_is_ok(settings: Settings) -> None:
    response = TestClient(create_app(settings)).get("/api/v1/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Request-ID"]


@pytest.mark.unit
def test_openapi_is_served_with_title_and_package_version(settings: Settings) -> None:
    response = TestClient(create_app(settings)).get("/openapi.json")

    assert response.status_code == 200
    spec = response.json()
    assert spec["info"]["title"] == "Stellar Blaze API"
    assert spec["info"]["version"] == __version__
    assert "/api/v1/health/live" in spec["paths"]
