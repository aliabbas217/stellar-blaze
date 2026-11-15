"""The config poller and the API's lifespan against a real Postgres (ADR 0010 sections 3 and 6): activations made by
another process reach a running API with no restart, a database that stops answering or a bad row keeps the last good
snapshot, and readiness says so. ``interval_s=0.1`` so that "within a second" is checked for real."""

import asyncio
import json
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx2
import pytest
import structlog
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import JsonValue
from sqlalchemy.engine import make_url

from stellar_blaze.adapters.db.config_store import PostgresConfigStore
from stellar_blaze.adapters.db.engine import build_engine
from stellar_blaze.api.app import create_app
from stellar_blaze.api.deps import SnapshotDep
from stellar_blaze.application.runtime_config import ConfigPoller, ConfigService, ConfigSnapshot, SnapshotHolder
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import RuntimeConfig, body_sha256, config_body, config_sha256
from stellar_blaze.errors import PROBLEM_JSON
from stellar_blaze.logging import configure_logging
from stellar_blaze.ports.config_store import StaleActivationError
from tests.integration.db_admin import fetch_all
from tests.unit.config.support import FIXTURE_MODELS, SEED_CATALOG, TODAY, eventually, log_events, margin, models
from tests.unit.rules.support import RULESETS_DIR
from tests.unit.test_logging_uvicorn import serve

pytestmark = pytest.mark.integration

ACTOR = "ali"
REASON = "B3 margin trial"
SEEDED = "seed from git default"


def file_snapshot() -> ConfigSnapshot:
    default = RuntimeConfig()
    return ConfigSnapshot(version_id=None, sha256=config_sha256(default), config=default, source="file", model=None)


@asynccontextmanager
async def replica(
    settings: Settings, *, initial: ConfigSnapshot | None = None, interval_s: float = 0.1
) -> AsyncIterator[tuple[ConfigService, SnapshotHolder, ConfigPoller]]:
    """One process: its own engine, holder, service and poller (not started), cleaned up afterwards."""
    engine = build_engine(settings)
    holder = SnapshotHolder(initial)
    service = ConfigService(
        PostgresConfigStore(engine, read_timeout_s=settings.readiness_timeout_s),
        SEED_CATALOG,
        models(),
        holder,
        lambda: TODAY,
        prod=False,
    )
    poller = ConfigPoller(service, holder, interval_s)
    try:
        yield service, holder, poller
    finally:
        await poller.stop()
        await engine.dispose()


def insert_a_row_that_fails_validation(url: str, *, previous: int) -> None:
    """What a DBA with SQL access could do: version 2 outside the reviewed range, activated as activation 2."""
    body: dict[str, JsonValue] = {**config_body(RuntimeConfig()), "tunables": {"twl_margin_w_m2": 99.0}}
    fetch_all(
        url,
        "INSERT INTO config_version (sha256, body, schema_version, created_by, reason) "
        "VALUES (:sha, CAST(:body AS jsonb), 1, 'dba', 'edited through SQL')",
        {"sha": body_sha256(body), "body": json.dumps(body)},
    )
    fetch_all(
        url,
        "INSERT INTO config_activation (config_version_id, kind, actor, reason, previous_activation_id) "
        "VALUES (2, 'activate', 'dba', 'activated through SQL', :previous)",
        {"previous": previous},
    )


# --- the poller ---------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_after_a_seed_the_holder_holds_version_1_and_a_second_services_activation_is_picked_up_within_a_second(
    settings: Settings,
) -> None:
    async with replica(settings, initial=file_snapshot()) as (_, holder, poller), replica(settings) as (admin, _, _):
        tasks_before = asyncio.all_tasks()
        poller.start()
        assert holder.current().source == "file"

        seeded = await admin.seed(RuntimeConfig(), actor="seed:abc1234", reason=SEEDED)  # as `sb-jobs config seed`
        assert seeded.activation is not None
        await eventually(lambda: holder.current().version_id == 1, timeout_s=1.0, what="version 1 in the holder")
        assert holder.current().source == "db"
        assert poller.status == "ok"

        version = await admin.propose(margin(7.0), ACTOR, REASON)
        assert version.id == 2
        await admin.activate(version.id, seeded.activation.id, ACTOR, "margin trial")
        await eventually(lambda: holder.current().version_id == 2, timeout_s=1.0, what="version 2 in the holder")
        assert holder.current().config.tunables.twl_margin_w_m2 == 7.0
        assert holder.current().sha256 == version.sha256

        await admin.rollback(ACTOR, "revert trial")
        await eventually(lambda: holder.current().version_id == 1, timeout_s=1.0, what="the rollback")
        assert holder.current().config.tunables.twl_margin_w_m2 is None

        await poller.stop()
        assert asyncio.all_tasks() == tasks_before  # nothing leaked


@pytest.mark.asyncio
async def test_a_database_that_refuses_connections_keeps_version_2_and_the_status_goes_stale_then_recovers(
    settings: Settings, server_url: str
) -> None:
    name = make_url(settings.database_url.get_secret_value()).database
    assert name is not None
    async with replica(settings, initial=file_snapshot()) as (_, holder, poller), replica(settings) as (admin, _, _):
        seeded = await admin.seed(RuntimeConfig(), actor="seed:abc1234", reason=SEEDED)
        assert seeded.activation is not None
        version = await admin.propose(margin(7.0), ACTOR, REASON)
        await admin.activate(version.id, seeded.activation.id, ACTOR, "margin trial")
        poller.start()
        await eventually(lambda: holder.current().version_id == 2, timeout_s=2.0, what="version 2 in the holder")

        # The database stops answering: new connections are refused and the live ones are cut (the pool's pre-ping
        # then finds them dead). A real server-side refusal, without stopping the container the other tests share.
        fetch_all(server_url, f'ALTER DATABASE "{name}" WITH ALLOW_CONNECTIONS false')
        fetch_all(
            server_url,
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :name",
            {"name": name},
        )
        try:
            await eventually(lambda: poller.status == "stale", timeout_s=5.0, what="the stale status")
            assert holder.current().version_id == 2  # the last good config keeps serving
            assert holder.current().config.tunables.twl_margin_w_m2 == 7.0
        finally:
            fetch_all(server_url, f'ALTER DATABASE "{name}" WITH ALLOW_CONNECTIONS true')

        # While it was away another activation landed; once the database answers, the replica catches up.
        third = await admin.propose(margin(3.0), ACTOR, REASON)
        latest = await admin.latest_activation()
        assert latest is not None
        await admin.activate(third.id, latest.id, ACTOR, "a later trial")
        await eventually(lambda: poller.status == "ok", timeout_s=5.0, what="recovery")
        await eventually(lambda: holder.current().version_id == third.id, timeout_s=2.0, what="the later activation")


@pytest.mark.asyncio
async def test_a_row_inserted_by_hand_that_fails_validation_is_refused_and_the_last_good_snapshot_serves(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging(settings)
    async with replica(settings) as (admin, holder, poller):
        seeded = await admin.seed(RuntimeConfig(), actor="seed:abc1234", reason=SEEDED)
        assert seeded.activation is not None
        await poller.poll_once()
        assert holder.current().version_id == 1

        insert_a_row_that_fails_validation(settings.database_url.get_secret_value(), previous=seeded.activation.id)
        for _ in range(3):
            await poller.poll_once()

        assert holder.current().version_id == 1
        assert poller.status == "stale"
        (rejected,) = log_events(capsys.readouterr().out, "config_rejected")
        assert (rejected["version_id"], rejected["codes"]) == (2, ["out-of-range"])


@pytest.mark.asyncio
async def test_concurrent_rollbacks_with_the_same_expected_previous_exactly_one_wins(settings: Settings) -> None:
    # The lost update the activation log exists to prevent: four requests to roll back from the same activation (a
    # retry, a double click, two operators) produce one rollback, not a rollback and its undoing.
    async with (
        replica(settings) as (first, _, _),
        replica(settings) as (second, _, _),
        replica(settings) as (third, _, _),
        replica(settings) as (fourth, _, _),
    ):
        seeded = await first.seed(RuntimeConfig(), actor="seed:abc1234", reason=SEEDED)
        assert seeded.activation is not None
        version = await first.propose(margin(7.0), ACTOR, REASON)
        activated = await first.activate(version.id, seeded.activation.id, ACTOR, "margin trial")

        results = await asyncio.gather(
            *(
                service.rollback(ACTOR, "revert the margin trial", expected_previous=activated.id)
                for service in (first, second, third, fourth)
            ),
            return_exceptions=True,
        )

        winners = [r for r in results if not isinstance(r, BaseException)]
        losers = [r for r in results if isinstance(r, BaseException)]
        assert len(winners) == 1
        assert all(isinstance(r, StaleActivationError) for r in losers), losers
        assert winners[0].kind == "rollback"
        assert winners[0].config_version_id == seeded.version.id
        history = await first.history(10)
        assert [h.kind for h in history] == ["rollback", "activate", "seed"]  # not rolled back and forward again


# --- the API ------------------------------------------------------------------------------------------------------


# These tests run the app with the FIXTURE models, whose ids differ from the released model the git default seed pins,
# and they are about the poller, not about theta or the model pin: they start from a seed with nothing pinned.
UNPINNED_SEED = Path(__file__).resolve().parents[1] / "fixtures" / "runtime" / "unpinned.toml"


def api_for(settings: Settings, *, env: str, interval_s: float = 0.1) -> FastAPI:
    app = create_app(
        settings.model_copy(
            update={
                "env": env,
                "config_poll_interval_s": interval_s,  # below the setting's own floor on purpose: model_copy skips it
                "rulesets_dir": RULESETS_DIR,
                "models_dir": FIXTURE_MODELS,
                "runtime_config_seed": UNPINNED_SEED,
            }
        )
    )

    @app.get("/test/snapshot")
    async def snapshot_route(snapshot: SnapshotDep) -> dict[str, Any]:
        return {"version_id": snapshot.version_id, "bound": structlog.contextvars.get_contextvars()}

    return app


def admin_does(settings: Settings, action: Callable[[ConfigService], Awaitable[Any]]) -> None:
    """Run an admin action (the CLI, or another replica) against the same database, from the test's own thread."""

    async def go() -> None:
        async with replica(settings) as (service, _, _):
            await action(service)

    asyncio.run(go())


def wait_until(condition: Callable[[], bool], *, seconds: float = 3.0) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.05)
    return condition()


async def seed_the_default(service: ConfigService) -> None:
    await service.seed(RuntimeConfig(), actor="seed:abc1234", reason=SEEDED)


def test_an_empty_database_is_not_ready_in_prod_until_it_is_seeded(settings: Settings) -> None:
    with TestClient(api_for(settings, env="prod")) as client:
        before = client.get("/api/v1/health/ready")
        decision = client.get("/test/snapshot")

        admin_does(settings, seed_the_default)
        became_ready = wait_until(lambda: client.get("/api/v1/health/ready").status_code == 200)
        after = client.get("/api/v1/health/ready")

    assert before.status_code == 503
    assert before.headers["content-type"].startswith(PROBLEM_JSON)
    assert before.json()["dependency"] == "config"
    assert decision.status_code == 503
    assert decision.json()["dependency"] == "config"
    assert became_ready
    assert after.json() == {"status": "ok", "checks": {"database": "ok", "config": "ok"}}


def test_a_running_api_follows_activations_made_by_another_process_and_logs_the_version(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    admin_does(settings, seed_the_default)

    async def propose_and_activate(service: ConfigService) -> None:
        version = await service.propose(margin(7.0), ACTOR, REASON)
        latest = await service.latest_activation()
        assert latest is not None
        await service.activate(version.id, latest.id, ACTOR, "margin trial")

    async def roll_back(service: ConfigService) -> None:
        await service.rollback(ACTOR, "revert trial")

    with TestClient(api_for(settings, env="prod")) as client:
        assert client.get("/test/snapshot").json()["version_id"] == 1  # loaded at startup, before any poll

        admin_does(settings, propose_and_activate)
        assert wait_until(lambda: client.get("/test/snapshot").json()["version_id"] == 2)
        assert client.get("/test/snapshot").json()["bound"]["config_version"] == 2

        admin_does(settings, roll_back)
        assert wait_until(lambda: client.get("/test/snapshot").json()["version_id"] == 1)

    versions = [line["config_version"] for line in log_events(capsys.readouterr().out, "request.completed")]
    assert versions[0] == 1
    assert 2 in versions


def test_a_bad_row_makes_readiness_report_stale_with_a_200(settings: Settings) -> None:
    admin_does(settings, seed_the_default)

    with TestClient(api_for(settings, env="prod")) as client:
        assert client.get("/api/v1/health/ready").json()["checks"]["config"] == "ok"

        insert_a_row_that_fails_validation(settings.database_url.get_secret_value(), previous=1)

        assert wait_until(lambda: client.get("/api/v1/health/ready").json()["checks"]["config"] == "stale")
        ready = client.get("/api/v1/health/ready")
        assert ready.status_code == 200
        assert ready.json() == {"status": "ok", "checks": {"database": "ok", "config": "stale"}}
        assert client.get("/test/snapshot").json()["version_id"] == 1


def test_dev_starts_from_the_file_and_the_poller_replaces_it_once_the_database_has_an_activation(
    settings: Settings,
) -> None:
    with TestClient(api_for(settings, env="test")) as client:
        assert client.get("/test/snapshot").json()["version_id"] is None  # the file/env snapshot of Task 7A
        assert client.get("/api/v1/health/ready").json()["checks"]["config"] == "ok"

        admin_does(settings, seed_the_default)

        assert wait_until(lambda: client.get("/test/snapshot").json()["version_id"] == 1)


def test_the_apps_poller_runs_while_the_app_serves_and_is_stopped_at_shutdown(settings: Settings) -> None:
    app = api_for(settings, env="test")

    with TestClient(app):
        poller: ConfigPoller = app.state.config_poller
        assert poller.running

    assert not poller.running


def test_under_a_real_uvicorn_the_poller_follows_activations_and_stops_with_the_server(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    admin_does(settings, seed_the_default)
    app = api_for(settings, env="prod")

    async def propose_and_activate(service: ConfigService) -> None:
        version = await service.propose(margin(7.0), ACTOR, REASON)
        latest = await service.latest_activation()
        assert latest is not None
        await service.activate(version.id, latest.id, ACTOR, "margin trial")

    with serve(app) as base_url, httpx2.Client(base_url=base_url) as client:
        assert client.get("/test/snapshot").json()["version_id"] == 1
        admin_does(settings, propose_and_activate)
        assert wait_until(lambda: client.get("/test/snapshot").json()["version_id"] == 2)
        assert app.state.config_poller.running

    # `serve` joined the server thread: the lifespan shutdown ran, so the poller task is cancelled and awaited.
    assert not app.state.config_poller.running
    errors = [line for line in log_events(capsys.readouterr().out) if line.get("level") == "error"]
    assert errors == []
