import asyncio
import json
import socket
import threading
import time
from collections.abc import Iterator
from contextlib import closing
from typing import cast

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.api.app import create_app
from stellar_blaze.api.deps import get_engine
from stellar_blaze.config import Settings
from stellar_blaze.errors import PROBLEM_JSON

PASSWORD = "local-only-readiness-pw"  # noqa: S105  (a made-up value the test asserts never leaks)


def settings_for(url: str, *, readiness_timeout_s: float = 2.0) -> Settings:
    return Settings(
        env="test",
        log_format="json",
        database_url=SecretStr(url),
        readiness_timeout_s=readiness_timeout_s,
        _env_file=None,
    )


@pytest.fixture
def silent_server() -> Iterator[int]:
    """A loopback TCP server that accepts connections and never answers: a database that hangs during the handshake."""
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    accepted: list[socket.socket] = []
    stop = threading.Event()

    def accept_forever() -> None:
        listener.settimeout(0.1)
        while not stop.is_set():
            try:
                connection, _ = listener.accept()
            except OSError:
                continue
            accepted.append(connection)

    thread = threading.Thread(target=accept_forever, daemon=True)
    thread.start()
    try:
        yield int(listener.getsockname()[1])
    finally:
        stop.set()
        thread.join(timeout=2)
        for connection in accepted:
            connection.close()
        listener.close()


def unused_port() -> int:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


@pytest.mark.unit
def test_ready_503_without_database() -> None:
    settings = settings_for("postgresql+asyncpg://sb:sb@127.0.0.1:1/x")

    started = time.perf_counter()
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/health/ready")
    elapsed = time.perf_counter() - started

    assert elapsed < 5
    assert response.status_code == 503
    assert response.headers["content-type"].startswith(PROBLEM_JSON)
    body = response.json()
    assert body["type"] == "urn:stellar-blaze:problem:dependency-unavailable"
    assert body["title"] == "Dependency unavailable"
    assert body["status"] == 503
    assert body["dependency"] == "database"
    assert body["instance"] == "/api/v1/health/ready"
    assert body["request_id"] == response.headers["X-Request-ID"]


@pytest.mark.unit
def test_ready_503_does_not_leak_connection_details() -> None:
    port = unused_port()
    settings = settings_for(f"postgresql+asyncpg://sb:{PASSWORD}@127.0.0.1:{port}/x")

    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/health/ready")

    assert response.status_code == 503
    assert PASSWORD not in response.text
    assert "127.0.0.1" not in response.text
    assert "detail" not in response.json()


class RefusingEngine:
    """Stands in for an engine whose database refuses the connection, with a driver message that quotes the DSN."""

    def connect(self) -> "RefusingEngine":
        return self

    async def __aenter__(self) -> "RefusingEngine":
        raise ConnectionRefusedError(f"cannot connect to postgresql+asyncpg://sb:{PASSWORD}@db:5432/x")

    async def __aexit__(self, *_exc: object) -> None:
        return None


@pytest.mark.unit
def test_ready_503_logs_the_cause_of_the_failure_without_the_password(capsys: pytest.CaptureFixture[str]) -> None:
    # The class alone ("ConnectionRefusedError") does not tell a refused connection from a failed login or a timeout;
    # the message does. The log may name the host (the response may not), and never a credential.
    app = create_app(settings_for("postgresql+asyncpg://sb:sb@127.0.0.1:1/x"))
    app.dependency_overrides[get_engine] = lambda: cast("AsyncEngine", RefusingEngine())

    with TestClient(app) as client:
        response = client.get("/api/v1/health/ready")

    out = capsys.readouterr().out
    (line,) = [
        parsed
        for parsed in (json.loads(raw) for raw in out.splitlines() if raw.startswith("{"))
        if parsed.get("event") == "health.ready.database_unavailable"
    ]
    assert line["level"] == "warning"
    assert line["error"] == "ConnectionRefusedError: cannot connect to postgresql+asyncpg://***@db:5432/x"
    assert PASSWORD not in out
    assert PASSWORD not in response.text


@pytest.mark.unit
def test_ready_is_bounded_by_the_readiness_timeout(silent_server: int) -> None:
    settings = settings_for(f"postgresql+asyncpg://sb:sb@127.0.0.1:{silent_server}/x", readiness_timeout_s=0.5)

    started = time.perf_counter()
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/health/ready")
    elapsed = time.perf_counter() - started

    assert response.status_code == 503
    assert response.json()["dependency"] == "database"
    assert elapsed < 3


@pytest.mark.unit
def test_startup_survives_a_down_database_and_shutdown_disposes_the_engine() -> None:
    app = create_app(settings_for("postgresql+asyncpg://sb:sb@127.0.0.1:1/x"))

    with TestClient(app) as client:
        engine = app.state.engine
        pool_in_use = engine.pool
        assert client.get("/api/v1/health/live").status_code == 200

    # AsyncEngine.dispose() replaces the pool; an engine that was never disposed keeps the one it served with.
    assert engine.pool is not pool_in_use


class HangingConnection:
    """Stands in for ``engine.connect()``: connecting works, the first query never returns."""

    async def __aenter__(self) -> "HangingConnection":
        return self

    async def __aexit__(self, *_exc: object) -> None:
        return None

    async def execute(self, *_args: object) -> None:
        await asyncio.sleep(30)


class HangingEngine:
    def connect(self) -> HangingConnection:
        return HangingConnection()


@pytest.mark.unit
def test_ready_gives_up_on_a_query_that_never_returns() -> None:
    # The driver's connect timeout cannot cover this case (the connection is up), only the probe's own deadline can.
    app = create_app(settings_for("postgresql+asyncpg://sb:sb@127.0.0.1:1/x", readiness_timeout_s=0.3))
    app.dependency_overrides[get_engine] = lambda: cast("AsyncEngine", HangingEngine())

    started = time.perf_counter()
    with TestClient(app) as client:
        response = client.get("/api/v1/health/ready")
    elapsed = time.perf_counter() - started

    assert response.status_code == 503
    assert response.json()["dependency"] == "database"
    assert elapsed < 3
