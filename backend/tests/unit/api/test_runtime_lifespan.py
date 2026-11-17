"""The lifespan builds the runtime before serving, and handlers read it through dependencies (ADR 0009, 0010)."""

import dataclasses
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pytest
import structlog
import time_machine
from fastapi import FastAPI
from fastapi.testclient import TestClient

from stellar_blaze.adapters.config.rulesets import RulesetLockError
from stellar_blaze.api.app import create_app
from stellar_blaze.api.deps import RuntimeDep, SnapshotDep
from stellar_blaze.application.runtime_config import ConfigSnapshot, SnapshotHolder
from stellar_blaze.composition import ConfigSourceError, Runtime
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import RuntimeConfig, config_sha256
from stellar_blaze.domain.rules.catalog import NoRulesetError
from tests.unit.rules.support import BACKEND_ROOT, RULESETS_DIR

pytestmark = pytest.mark.unit

# A seed with nothing pinned: the snapshot plumbing below is independent of what the git default pins (theta 0.30).
UNPINNED_SEED = BACKEND_ROOT / "tests" / "fixtures" / "runtime" / "unpinned.toml"


def app_with_probe_routes(settings: Settings) -> FastAPI:
    app = create_app(settings)

    @app.get("/test/runtime")
    async def runtime_route(runtime: RuntimeDep) -> dict[str, Any]:
        return {
            "same": runtime is app.state.runtime,
            "rulesets": list(runtime.rulesets.ids()),
            "env": runtime.settings.env,
        }

    @app.get("/test/snapshot")
    async def snapshot_route(snapshot: SnapshotDep) -> dict[str, Any]:
        return {
            "version_id": snapshot.version_id,
            "sha256": snapshot.sha256,
            "source": snapshot.source,
            "bound": structlog.contextvars.get_contextvars(),
        }

    @app.get("/test/plain")
    async def plain_route() -> dict[str, Any]:
        return {"bound": structlog.contextvars.get_contextvars()}

    return app


def test_the_lifespan_builds_the_runtime_and_handlers_read_it_through_a_dependency(settings: Settings) -> None:
    app = app_with_probe_routes(settings)
    with TestClient(app) as client:
        assert isinstance(app.state.runtime, Runtime)
        assert app.state.runtime.settings is settings
        body = client.get("/test/runtime").json()
    assert body == {"same": True, "rulesets": ["ae-heat-0.1", "ae-heat-2026.1"], "env": "test"}


def test_the_runtime_dependency_explains_a_missing_lifespan(settings: Settings) -> None:
    app = app_with_probe_routes(settings)
    with pytest.raises(RuntimeError, match="lifespan"):
        TestClient(app).get("/test/runtime")


def test_the_snapshot_dependency_gives_the_active_snapshot_and_binds_its_identity_to_the_log_context(
    settings: Settings,
) -> None:
    unpinned = settings.model_copy(update={"runtime_config_seed": UNPINNED_SEED})
    with TestClient(app_with_probe_routes(unpinned)) as client:
        body = client.get("/test/snapshot").json()
    assert body["version_id"] is None
    assert body["source"] == "file"
    assert body["sha256"] == config_sha256(RuntimeConfig())
    bound = body["bound"]
    assert bound["config_version"] is None
    assert bound["config_sha256"] == config_sha256(RuntimeConfig())
    assert bound["ruleset_pin"] is None
    assert bound["model_id"] is None


def test_the_binding_does_not_leak_into_the_next_request(settings: Settings) -> None:
    with TestClient(app_with_probe_routes(settings)) as client:
        assert "config_sha256" in client.get("/test/snapshot").json()["bound"]
        assert "config_sha256" not in client.get("/test/plain").json()["bound"]


def test_a_request_keeps_the_snapshot_it_read_even_if_the_config_is_swapped_meanwhile(settings: Settings) -> None:
    app = create_app(settings)

    @app.get("/test/swap")
    async def swap(snapshot: SnapshotDep, runtime: RuntimeDep) -> dict[str, Any]:
        replacement = ConfigSnapshot(version_id=9, sha256="0" * 64, config=RuntimeConfig(), source="db", model=None)
        runtime.config.swap(replacement)
        return {"held": snapshot.version_id, "now": runtime.config.current().version_id}

    with TestClient(app) as client:
        assert client.get("/test/swap").json() == {"held": None, "now": 9}


def test_an_empty_config_holder_is_a_503_problem_not_a_500(settings: Settings) -> None:
    app = app_with_probe_routes(settings)
    with TestClient(app) as client:
        app.state.runtime = dataclasses.replace(app.state.runtime, config=SnapshotHolder())
        response = client.get("/test/snapshot")
    assert response.status_code == 503
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["type"] == "urn:stellar-blaze:problem:dependency-unavailable"
    assert body["dependency"] == "config"
    assert "request_id" in body


def test_a_ruleset_error_fails_startup_and_no_engine_is_left_behind(settings: Settings, tmp_path: Path) -> None:
    empty = tmp_path / "rulesets"
    empty.mkdir()
    (empty / "lock.json").write_text("{}", encoding="utf-8")
    app = create_app(settings.model_copy(update={"rulesets_dir": empty}))
    with pytest.raises(NoRulesetError), TestClient(app):
        pass  # pragma: no cover - startup raises before the body runs
    assert not hasattr(app.state, "engine")
    assert not hasattr(app.state, "runtime")


def test_a_tampered_ruleset_fails_startup(settings: Settings, tmp_path: Path) -> None:
    directory = tmp_path / "rulesets"
    directory.mkdir()
    seed = (RULESETS_DIR / "ae-heat-0.1.toml").read_bytes()
    (directory / "ae-heat-0.1.toml").write_bytes(seed.replace(b"low_min_w_m2 = 140.0", b"low_min_w_m2 = 141.0"))
    (directory / "lock.json").write_bytes((RULESETS_DIR / "lock.json").read_bytes())
    app = create_app(settings.model_copy(update={"rulesets_dir": directory}))
    with pytest.raises(RulesetLockError, match=r"ae-heat-0\.1"), TestClient(app):
        pass  # pragma: no cover


def test_a_bad_pin_fails_startup(settings: Settings) -> None:
    app = create_app(settings.model_copy(update={"ruleset_id": "nope"}))
    with pytest.raises(ConfigSourceError, match="nope"), TestClient(app):
        pass  # pragma: no cover


@pytest.mark.parametrize(
    ("instant", "starts"),
    [
        # 2024-01-01 is the effective_from of both rulesets. 21:00 UTC on 31 December is 01:00 on 1 January in Dubai
        # (UTC+4): a lifespan that used the UTC date would find no ruleset; one that used Dubai's date finds
        # ae-heat-2026.1 (it supersedes ae-heat-0.1, which stays reachable by id).
        (datetime(2023, 12, 31, 21, 0, tzinfo=UTC), True),
        (datetime(2023, 12, 31, 19, 0, tzinfo=UTC), False),
    ],
)
def test_the_lifespan_resolves_the_ruleset_for_the_asia_dubai_date(
    settings: Settings, instant: datetime, starts: bool
) -> None:
    app = create_app(settings)
    with time_machine.travel(instant, tick=False):
        if starts:
            with TestClient(app):
                assert app.state.runtime.rulesets.for_local_date(date(2024, 1, 1)).ruleset.meta.id == "ae-heat-2026.1"
        else:
            with pytest.raises(NoRulesetError, match="2023-12-31"), TestClient(app):
                pass  # pragma: no cover
