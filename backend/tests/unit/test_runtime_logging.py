"""Rulesets, models and the active config are named in the logs (ADR 0009 section 1, ADR 0010 section 3)."""

import copy
import logging.config
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

import httpx2
import pytest
import structlog
from fastapi import FastAPI
from uvicorn.config import LOGGING_CONFIG

from stellar_blaze.api.app import create_app
from stellar_blaze.api.deps import SnapshotDep
from stellar_blaze.composition import build_runtime
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import RuntimeConfig, config_sha256
from stellar_blaze.logging import bind_runtime_ids
from tests.unit.test_logging import json_lines
from tests.unit.test_logging_uvicorn import serve

pytestmark = pytest.mark.unit

BACKEND_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_MODELS = BACKEND_ROOT / "tests" / "fixtures" / "models"
FIRST = "corrector-20261111-0000000-000000"
SECOND = "corrector-20261112-0000000-000001"


@pytest.fixture(autouse=True)
def _clean_log_context() -> Iterator[None]:
    structlog.contextvars.clear_contextvars()
    yield
    structlog.contextvars.clear_contextvars()


def test_bind_runtime_ids_binds_the_loaded_ruleset_and_model_ids(settings: Settings) -> None:
    runtime = build_runtime(settings.model_copy(update={"models_dir": FIXTURE_MODELS}), today=date(2026, 11, 11))
    bind_runtime_ids(runtime)
    bound = structlog.contextvars.get_contextvars()
    assert bound == {"ruleset_ids": "ae-heat-0.1", "model_ids": f"{FIRST},{SECOND}"}


def test_bind_runtime_ids_with_no_models_binds_an_empty_string(settings: Settings) -> None:
    bind_runtime_ids(build_runtime(settings, today=date(2026, 11, 11)))
    assert structlog.contextvars.get_contextvars() == {"ruleset_ids": "ae-heat-0.1", "model_ids": ""}


def probe_app(settings: Settings) -> FastAPI:
    app = create_app(settings.model_copy(update={"models_dir": FIXTURE_MODELS}))

    @app.get("/test/decision")
    async def decision(snapshot: SnapshotDep) -> dict[str, str]:
        structlog.stdlib.get_logger("probe").info("decision.made")
        return {"sha": snapshot.sha256}

    return app


def named(lines: list[dict[str, Any]], event: str) -> list[dict[str, Any]]:
    return [line for line in lines if line["event"] == event]


def test_under_a_real_server_startup_and_every_request_log_carry_the_loaded_ids(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    # Probed with a real uvicorn: a contextvar bound inside the lifespan is private to uvicorn's lifespan task, so it
    # reaches the startup event but not the request tasks. Requests therefore rebind the (immutable) ids themselves.
    logging.config.dictConfig(copy.deepcopy(LOGGING_CONFIG))
    app = probe_app(settings)
    with serve(app) as base_url, httpx2.Client(base_url=base_url) as client:
        assert client.get("/api/v1/health/live").status_code == 200
        decision = client.get("/test/decision")
    assert decision.status_code == 200

    lines = json_lines(capsys.readouterr().out)
    ids = {"ruleset_ids": "ae-heat-0.1", "model_ids": f"{FIRST},{SECOND}"}

    ready = named(lines, "runtime.ready")
    assert len(ready) == 1
    assert {k: ready[0][k] for k in ids} == ids
    assert ready[0]["config_source"] == "file"
    assert ready[0]["config_sha256"] == config_sha256(RuntimeConfig())

    completed = named(lines, "request.completed")
    assert [line["path"] for line in completed] == ["/api/v1/health/live", "/test/decision"]
    for line in completed:
        assert {k: line[k] for k in ids} == ids

    made = named(lines, "decision.made")
    assert len(made) == 1
    assert {k: made[0][k] for k in ids} == ids
    # The handler read the snapshot through the dependency, so its identity is on its own lines and on the request's.
    for line in (made[0], completed[1]):
        assert line["config_version"] is None
        assert line["config_sha256"] == config_sha256(RuntimeConfig())
    assert "config_sha256" not in completed[0]  # health/live never read the snapshot
