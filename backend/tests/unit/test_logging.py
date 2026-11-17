import copy
import json
import logging
import logging.config
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
from uvicorn.config import LOGGING_CONFIG

from stellar_blaze.api.app import create_app
from stellar_blaze.config import Settings
from stellar_blaze.logging import configure_logging

REQUEST_ID = "0123456789abcdef0123456789abcdef"
DATABASE_URL = SecretStr("postgresql+asyncpg://sb:sb@localhost:5432/stellar_blaze")


def json_lines(out: str) -> list[dict[str, Any]]:
    """Parse every stdout line as JSON; a non-JSON line means something bypassed the structlog pipeline."""
    parsed: list[dict[str, Any]] = [json.loads(line) for line in out.splitlines() if line.strip()]
    return parsed


def events(lines: list[dict[str, Any]], name: str) -> list[dict[str, Any]]:
    return [line for line in lines if line["event"] == name]


@pytest.mark.unit
def test_json_log_line_has_request_id(capsys: pytest.CaptureFixture[str], settings: Settings) -> None:
    client = TestClient(create_app(settings))
    response = client.get("/api/v1/health/live")

    completed = events(json_lines(capsys.readouterr().out), "request.completed")
    assert len(completed) == 1
    line = completed[0]
    assert {"event", "level", "timestamp", "request_id"} <= line.keys()
    assert line["level"] == "info"
    assert line["request_id"] == response.headers["X-Request-ID"]
    assert line["timestamp"].endswith("Z")


@pytest.mark.unit
def test_request_completed_reports_method_path_status_and_duration(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    client = TestClient(create_app(settings))
    client.get("/api/v1/health/live")
    client.get("/api/v1/nope")

    completed = events(json_lines(capsys.readouterr().out), "request.completed")
    assert [(c["method"], c["path"], c["status"]) for c in completed] == [
        ("GET", "/api/v1/health/live", 200),
        ("GET", "/api/v1/nope", 404),
    ]
    assert all(isinstance(c["duration_ms"], float) and c["duration_ms"] >= 0 for c in completed)


@pytest.mark.unit
def test_incoming_request_id_is_logged_and_echoed(capsys: pytest.CaptureFixture[str], settings: Settings) -> None:
    client = TestClient(create_app(settings))
    response = client.get("/api/v1/health/live", headers={"X-Request-ID": REQUEST_ID})

    completed = events(json_lines(capsys.readouterr().out), "request.completed")
    assert response.headers["X-Request-ID"] == REQUEST_ID
    assert completed[0]["request_id"] == REQUEST_ID


@pytest.mark.unit
def test_unhandled_error_logs_traceback_and_one_completed_event(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    app: FastAPI = create_app(settings)

    @app.get("/test/boom")
    async def boom() -> None:
        dsn = "postgresql://sb:local-only-password@db/stellar_blaze"
        raise RuntimeError(dsn[:10])

    response = TestClient(app, raise_server_exceptions=False).get("/test/boom")

    out = capsys.readouterr().out
    lines = json_lines(out)
    unhandled = events(lines, "request.unhandled")
    completed = events(lines, "request.completed")
    assert len(unhandled) == 1
    assert unhandled[0]["level"] == "error"
    assert unhandled[0]["request_id"] == response.json()["request_id"]
    assert "RuntimeError" in json.dumps(unhandled[0]["exception"])
    assert [(c["path"], c["status"]) for c in completed] == [("/test/boom", 500)]
    # A traceback in a log line carries the frames, never the local variables (here a connection string).
    assert "local-only-password" not in out


@pytest.mark.unit
def test_stdlib_logger_is_rendered_by_structlog(capsys: pytest.CaptureFixture[str], settings: Settings) -> None:
    configure_logging(settings)
    logging.getLogger("some.library").warning("disk %s is %d%% full", "sda", 93)

    (line,) = json_lines(capsys.readouterr().out)
    assert line["event"] == "disk sda is 93% full"
    assert line["level"] == "warning"
    assert line["logger"] == "some.library"
    assert "timestamp" in line


@pytest.mark.unit
def test_uvicorn_loggers_are_routed_and_access_log_is_replaced(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    # uvicorn applies its own logging config before it imports the app, so configure_logging must override it.
    logging.config.dictConfig(copy.deepcopy(LOGGING_CONFIG))
    configure_logging(settings)
    logging.getLogger("uvicorn.error").info("Application startup complete.")
    logging.getLogger("uvicorn.access").info('127.0.0.1:1 - "GET / HTTP/1.1" 200')

    # uvicorn.access is dropped because request.completed carries the same facts plus request_id and duration.
    captured = capsys.readouterr()
    (line,) = json_lines(captured.out)
    assert line["event"] == "Application startup complete."
    assert line["logger"] == "uvicorn.error"
    assert captured.err == ""  # uvicorn's own stderr handler no longer fires a second, unstructured copy


@pytest.mark.unit
def test_log_level_is_applied(capsys: pytest.CaptureFixture[str]) -> None:
    quiet = Settings(env="test", log_format="json", log_level="WARNING", database_url=DATABASE_URL, _env_file=None)
    configure_logging(quiet)
    logging.getLogger("some.library").info("hidden")
    logging.getLogger("some.library").warning("shown")

    assert [line["event"] for line in json_lines(capsys.readouterr().out)] == ["shown"]


@pytest.mark.unit
def test_console_format_is_human_readable(capsys: pytest.CaptureFixture[str]) -> None:
    pretty = Settings(env="dev", log_format="console", database_url=DATABASE_URL, _env_file=None)
    configure_logging(pretty)
    logging.getLogger("some.library").warning("hello")

    out = capsys.readouterr().out
    assert "hello" in out
    with pytest.raises(json.JSONDecodeError):
        json.loads(out)
