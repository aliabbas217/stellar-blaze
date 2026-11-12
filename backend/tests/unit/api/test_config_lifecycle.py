"""The lifespan loads the DB-active config in prod, runs the poller in every environment, and readiness reports it
(ADR 0010 section 3). The config store is the in-memory fake, injected by replacing the ``build_config_store`` name
that ``api.app`` looks up; the database check of readiness is answered by a stand-in engine, so no network is used."""

import asyncio
from typing import Any, cast

import pytest
import structlog
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.adapters.fakes.config_store import InMemoryConfigStore
from stellar_blaze.api import app as app_module
from stellar_blaze.api.app import create_app
from stellar_blaze.api.deps import SnapshotDep, get_engine
from stellar_blaze.application.runtime_config import ConfigPoller
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import RuntimeConfig, config_body
from stellar_blaze.errors import PROBLEM_JSON
from stellar_blaze.ports.config_store import RuntimeConfigStore
from tests.unit.config.support import FIXTURE_MODELS, SECOND_MODEL, TODAY, log_events, make_service, margin
from tests.unit.rules.support import RULESETS_DIR

pytestmark = pytest.mark.unit

ACTOR = "ali"
REASON = "B3 margin trial"


class UpConnection:
    async def __aenter__(self) -> "UpConnection":
        return self

    async def __aexit__(self, *_exc: object) -> None:
        return None

    async def execute(self, *_args: object) -> None:
        return None


class UpEngine:
    """Stands in for an engine whose database answers ``SELECT 1``."""

    def connect(self) -> UpConnection:
        return UpConnection()


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> InMemoryConfigStore:
    fake = InMemoryConfigStore()

    def build(_engine: AsyncEngine, _settings: Settings) -> RuntimeConfigStore:
        return fake

    monkeypatch.setattr(app_module, "build_config_store", build)
    return fake


def app_for(settings: Settings, *, env: str = "test") -> FastAPI:
    app = create_app(
        settings.model_copy(update={"env": env, "rulesets_dir": RULESETS_DIR, "models_dir": FIXTURE_MODELS})
    )
    app.dependency_overrides[get_engine] = lambda: cast("AsyncEngine", UpEngine())

    @app.get("/test/snapshot")
    async def snapshot_route(snapshot: SnapshotDep) -> dict[str, Any]:
        return {"version_id": snapshot.version_id, "bound": structlog.contextvars.get_contextvars()}

    return app


async def seed(store: InMemoryConfigStore, *margins: float) -> None:
    """Activate the default config and then each margin, as the CLI would have."""
    admin, _, _ = make_service(store, today=TODAY)
    seeded = await admin.seed(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")
    assert seeded.activation is not None
    previous = seeded.activation.id
    for value in margins:
        version = await admin.propose(margin(value), ACTOR, REASON)
        previous = (await admin.activate(version.id, previous, ACTOR, REASON)).id


def poll(client: TestClient, app: FastAPI) -> None:
    """Run one pass of the app's own poller on the app's event loop."""
    assert client.portal is not None
    poller: ConfigPoller = app.state.config_poller
    client.portal.call(poller.poll_once)


# --- dev and test: the file snapshot first, the database when it has something ----------------------------------


def test_outside_prod_the_file_snapshot_serves_until_the_poller_finds_an_activation(
    settings: Settings, store: InMemoryConfigStore
) -> None:
    app = app_for(settings)
    with TestClient(app) as client:
        assert client.portal is not None
        assert store.calls == []  # startup did not read the database
        assert client.get("/test/snapshot").json()["version_id"] is None
        assert isinstance(app.state.config_poller, ConfigPoller)
        assert app.state.config_poller.running

        client.portal.call(seed, store, 7.0)
        poll(client, app)

        body = client.get("/test/snapshot").json()
        assert body["version_id"] == 2
        assert body["bound"]["config_version"] == 2
        assert app.state.runtime.config.current().config.tunables.twl_margin_w_m2 == 7.0


def test_the_poll_interval_is_the_setting(settings: Settings, store: InMemoryConfigStore) -> None:
    app = create_app(settings.model_copy(update={"config_poll_interval_s": 12.5}))
    with TestClient(app):
        assert app.state.config_poller.interval_s == 12.5


def test_shutdown_stops_the_poller_and_disposes_the_engine(settings: Settings, store: InMemoryConfigStore) -> None:
    app = create_app(settings)

    with TestClient(app):
        poller = app.state.config_poller
        engine = app.state.engine
        pool_in_use = engine.pool
        assert poller.running

    assert not poller.running
    assert engine.pool is not pool_in_use


# --- prod: the database is the only source, read before serving ---------------------------------------------------


def test_prod_loads_the_database_active_config_before_it_serves_anything(
    settings: Settings, store: InMemoryConfigStore
) -> None:
    asyncio.run(seed(store, 7.0))
    app = app_for(settings, env="prod")

    with TestClient(app) as client:
        snapshot = app.state.runtime.config.current()
        assert (snapshot.source, snapshot.version_id) == ("db", 2)
        assert snapshot.config.tunables.twl_margin_w_m2 == 7.0
        assert client.get("/test/snapshot").json()["bound"]["config_version"] == 2
        assert client.get("/api/v1/health/ready").json()["checks"] == {"database": "ok", "config": "ok"}


def test_prod_without_an_activation_is_not_ready_and_decision_routes_answer_503(
    settings: Settings, store: InMemoryConfigStore
) -> None:
    app = app_for(settings, env="prod")
    with TestClient(app) as client:
        ready = client.get("/api/v1/health/ready")
        decision = client.get("/test/snapshot")
        live = client.get("/api/v1/health/live")

    assert ready.status_code == 503
    assert ready.headers["content-type"].startswith(PROBLEM_JSON)
    body = ready.json()
    assert body["type"] == "urn:stellar-blaze:problem:dependency-unavailable"
    assert body["dependency"] == "config"
    assert body["request_id"] == ready.headers["X-Request-ID"]
    assert decision.status_code == 503
    assert decision.json()["dependency"] == "config"
    assert live.status_code == 200  # liveness never looks at the config either


def test_prod_startup_survives_a_failing_store_and_catches_up_when_it_recovers(
    settings: Settings, store: InMemoryConfigStore, capsys: pytest.CaptureFixture[str]
) -> None:
    store.fail_on["*"] = ConnectionRefusedError("postgresql+asyncpg://sb:hunter2@db:5432/x refused")
    app = app_for(settings, env="prod")

    with TestClient(app) as client:
        assert client.get("/api/v1/health/live").status_code == 200
        assert client.get("/api/v1/health/ready").json()["dependency"] == "config"

        del store.fail_on["*"]
        assert client.portal is not None
        client.portal.call(seed, store)
        poll(client, app)
        assert client.get("/api/v1/health/ready").status_code == 200

    out = capsys.readouterr().out
    (failure,) = log_events(out, "config.startup_load_failed")
    assert failure["level"] == "error"
    assert failure["error"] == "ConnectionRefusedError"
    assert "hunter2" not in out  # the credentials in the exception message never reach the log


def test_a_rejected_activation_is_stale_with_a_200_and_the_last_good_version_keeps_serving(
    settings: Settings, store: InMemoryConfigStore, capsys: pytest.CaptureFixture[str]
) -> None:
    asyncio.run(seed(store))
    app = app_for(settings, env="prod")
    with TestClient(app) as client:
        assert client.get("/api/v1/health/ready").json()["checks"]["config"] == "ok"
        bad = store.add_raw_version({**config_body(RuntimeConfig()), "tunables": {"twl_margin_w_m2": 99.0}})
        store.add_raw_activation(bad.id)
        poll(client, app)

        for _ in range(3):
            ready = client.get("/api/v1/health/ready")
            assert ready.status_code == 200
            assert ready.json() == {"status": "ok", "checks": {"database": "ok", "config": "stale"}}
        assert client.get("/test/snapshot").json()["version_id"] == 1  # still the last good one

    lines = log_events(capsys.readouterr().out, "config.status_changed")
    assert [(line["status"], line["level"]) for line in lines if line["status"] == "stale"] == [("stale", "error")]


def test_the_stale_status_is_logged_once_however_often_readiness_is_probed(
    settings: Settings, store: InMemoryConfigStore, capsys: pytest.CaptureFixture[str]
) -> None:
    app = app_for(settings)  # test env: the file snapshot is serving, and the store is down
    store.fail_on["*"] = TimeoutError()
    with TestClient(app) as client:
        poll(client, app)
        poll(client, app)
        for _ in range(5):
            assert client.get("/api/v1/health/ready").json()["checks"]["config"] == "stale"

    changes = log_events(capsys.readouterr().out, "config.status_changed")
    assert [(c["previous"], c["status"]) for c in changes] == [(None, "ok"), ("ok", "stale")]


def test_a_second_activation_reaches_the_next_request_without_a_restart(
    settings: Settings, store: InMemoryConfigStore
) -> None:
    app = app_for(settings)
    with TestClient(app) as client:
        assert client.portal is not None
        client.portal.call(seed, store)
        poll(client, app)
        assert client.get("/test/snapshot").json()["bound"]["config_version"] == 1

        admin, _, _ = make_service(store, today=TODAY)

        async def second() -> None:
            version = await admin.propose(margin(7.0), ACTOR, REASON)
            latest = await store.latest_activation()
            assert latest is not None
            await admin.activate(version.id, latest.id, ACTOR, REASON)

        client.portal.call(second)
        poll(client, app)

        assert client.get("/test/snapshot").json()["bound"]["config_version"] == 2


def test_a_model_activated_in_the_database_is_loaded_into_the_snapshot(
    settings: Settings, store: InMemoryConfigStore
) -> None:
    app = app_for(settings)
    with TestClient(app) as client:
        assert client.portal is not None
        admin, _, _ = make_service(store, today=TODAY)

        async def activate_a_model() -> None:
            version = await admin.propose(RuntimeConfig(model_id=SECOND_MODEL), ACTOR, REASON)
            await admin.activate(version.id, None, ACTOR, REASON)

        client.portal.call(activate_a_model)
        poll(client, app)

        model = app.state.runtime.config.current().model
        assert model is not None
        assert model.manifest.model_id == SECOND_MODEL


def test_the_readiness_probe_names_the_config_it_serves_in_its_log_line(
    settings: Settings, store: InMemoryConfigStore, capsys: pytest.CaptureFixture[str]
) -> None:
    asyncio.run(seed(store, 7.0))
    app = app_for(settings, env="prod")
    with TestClient(app) as client:
        assert client.get("/api/v1/health/ready").status_code == 200
        assert client.get("/api/v1/health/live").status_code == 200

    lines = log_events(capsys.readouterr().out, "request.completed")
    ready, live = (
        next(line for line in lines if line["path"] == path) for path in ("/api/v1/health/ready", "/api/v1/health/live")
    )
    snapshot_sha = app.state.runtime.config.current().sha256
    assert (ready["config_version"], ready["config_sha256"]) == (2, snapshot_sha)
    assert "config_version" not in live  # only a request that reads the config says which one


def test_a_probe_that_finds_no_config_binds_nothing(
    settings: Settings, store: InMemoryConfigStore, capsys: pytest.CaptureFixture[str]
) -> None:
    app = app_for(settings, env="prod")
    with TestClient(app) as client:
        assert client.get("/api/v1/health/ready").status_code == 503

    (ready,) = [line for line in log_events(capsys.readouterr().out, "request.completed") if line["status"] == 503]
    assert "config_version" not in ready


def test_pinned_by_the_environment_the_api_keeps_its_snapshot_and_says_why_once(
    settings: Settings, store: InMemoryConfigStore, capsys: pytest.CaptureFixture[str]
) -> None:
    asyncio.run(seed(store, 7.0))
    store.calls.clear()  # what the seeding itself read is not what the API reads
    app = create_app(
        settings.model_copy(
            update={"ruleset_id": "ae-heat-0.1", "rulesets_dir": RULESETS_DIR, "models_dir": FIXTURE_MODELS}
        )
    )
    with TestClient(app) as client:
        assert client.portal is not None
        assert app.state.runtime.config.current().source == "env"
        for _ in range(3):
            poll(client, app)

        snapshot = app.state.runtime.config.current()
        assert (snapshot.source, snapshot.version_id) == ("env", None)  # the activation in the database is ignored
        assert store.calls == []  # the poller never reads the database while the pins hold

    assert len(log_events(capsys.readouterr().out, "config.db_activations_ignored")) == 1
