"""Under a real uvicorn server an unhandled error is reported once, not once by the app and once by uvicorn."""

import copy
import logging.config
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import httpx2
import pytest
import uvicorn
from fastapi import FastAPI
from uvicorn.config import LOGGING_CONFIG

from stellar_blaze.api.app import create_app
from stellar_blaze.config import Settings
from tests.unit.test_logging import json_lines


@contextmanager
def serve(app: FastAPI) -> Iterator[str]:
    """Run ``app`` on a real uvicorn server (127.0.0.1, free port) in a thread; stop and join it on exit."""
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_config=None, lifespan="on")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        for _ in range(200):
            if server.started:
                break
            time.sleep(0.05)
        assert server.started, "uvicorn did not start"
        port = server.servers[0].sockets[0].getsockname()[1]
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        assert not thread.is_alive(), "uvicorn did not stop"


def errors_in(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [line for line in lines if line["level"] == "error"]


@pytest.mark.unit
def test_unhandled_error_is_logged_once_under_real_uvicorn(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    # uvicorn applies its own logging config before it imports the app; create_app then has to override it.
    logging.config.dictConfig(copy.deepcopy(LOGGING_CONFIG))
    app = create_app(settings)

    @app.get("/test/boom")
    async def boom() -> None:
        raise RuntimeError("kaboom")

    with serve(app) as base_url, httpx2.Client(base_url=base_url) as client:
        # uvicorn closes the connection after an exception escapes the app; "close" keeps the client from reusing the
        # dying connection for the next request (a race that surfaces as a ReadError on Windows).
        response = client.get("/test/boom", headers={"Connection": "close"})
        assert client.get("/api/v1/health/live").status_code == 200

    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/problem+json")
    error_lines = errors_in(json_lines(capsys.readouterr().out))
    assert [line["event"] for line in error_lines] == ["request.unhandled"]
    assert error_lines[0]["request_id"] == response.json()["request_id"]
    assert "RuntimeError" in str(error_lines[0]["exception"])


@pytest.mark.unit
def test_uvicorn_still_reports_an_exception_the_app_did_not_log(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    # The duplicate is dropped only when request.unhandled already carries that very exception. A failure the app
    # never logged (here: the 500 handler itself failing) must stay visible through uvicorn's record.
    logging.config.dictConfig(copy.deepcopy(LOGGING_CONFIG))
    app = create_app(settings)

    @app.get("/test/boom")
    async def boom() -> None:
        raise RuntimeError("kaboom")

    app.add_exception_handler(Exception, broken_handler)

    with serve(app) as base_url, httpx2.Client(base_url=base_url) as client:
        response = client.get("/test/boom")

    assert response.status_code == 500
    error_events = [line["event"] for line in errors_in(json_lines(capsys.readouterr().out))]
    assert error_events == ["Exception in ASGI application\n"]


async def broken_handler(*_args: object) -> None:
    msg = "the error handler itself failed"
    raise RuntimeError(msg)
