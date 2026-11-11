import pytest
from fastapi.testclient import TestClient

from stellar_blaze.api.app import create_app
from stellar_blaze.config import Settings
from tests.integration.db_admin import fetch_all


@pytest.mark.integration
def test_ready_ok_with_database(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "checks": {"database": "ok"}}
    assert response.headers["X-Request-ID"]


@pytest.mark.integration
def test_ready_survives_connections_the_server_dropped(settings: Settings) -> None:
    url = settings.database_url.get_secret_value()
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/v1/health/ready").status_code == 200  # the pool now holds a live connection

        fetch_all(
            url,
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = current_database() AND pid <> pg_backend_pid()",
        )

        # pool_pre_ping notices the dead connection and reconnects instead of reporting the database as down.
        assert client.get("/api/v1/health/ready").status_code == 200
