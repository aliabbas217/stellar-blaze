"""Shared setup of the two B3 end-to-end integration tests: the ``sb-jobs`` environment, the CLI runner, the settings of
an app that runs on a real Postgres in replay mode, and a clock that makes the replay day "now".

The app runs in the ``TestClient`` portal thread (its lifespan builds the engine there); the CLI commands run their own
``asyncio.run``. So the tests are synchronous and never share an event loop with the database.
"""

import hashlib
import json
import shutil
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from typer.testing import CliRunner, Result

from stellar_blaze.api.app import create_app
from stellar_blaze.config import Settings
from stellar_blaze.jobs import cli
from tests.alembic_support import BACKEND_DIR
from tests.integration.db_admin import fetch_all
from tests.unit.config.support import FIXTURE_MODELS

DEMO_TOKEN = "token-demo-employer"  # noqa: S105
OTHER_TOKEN = "token-other-employer"  # noqa: S105
SITE = "site-demo-mussafah"
REPLAY_DATE = date(2025, 7, 10)  # a day of the B2 replay fixture (the 9th to the 11th of July 2025)
DEMO_FIXTURE = BACKEND_DIR / "fixtures" / "demo_site.toml"
ACTOR_ARGS = ("--actor", "ali", "--reason", "end to end check of the B3 api")
# The end-to-end mechanics run over the FIXTURE models and a seed that pins nothing: the git default pins the released
# model, which the fixture models dir does not hold (the product default is proved in test_default_seed_serving.py and
# test_config_cli.py).
UNPINNED_SEED = BACKEND_DIR / "tests" / "fixtures" / "runtime" / "unpinned.toml"


def token_key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


ACCESS_TOKENS = json.dumps(
    {
        token_key(DEMO_TOKEN): {"actor": "demo-bff", "role": "employer", "employer_id": "emp-demo"},
        token_key(OTHER_TOKEN): {"actor": "other-bff", "role": "employer", "employer_id": "emp-other"},
    }
)


def bearer(token: str = DEMO_TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def cli_environment(monkeypatch: pytest.MonkeyPatch, settings: Settings, workdir: Path) -> None:
    """The environment ``sb-jobs`` reads (``SB_*``), pointing at the test database; ``workdir`` holds the migrations."""
    monkeypatch.setenv("SB_DATABASE_URL", settings.database_url.get_secret_value())
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.setenv("SB_GIT_SHA", "abc1234")
    monkeypatch.setenv("SB_RULESETS_DIR", str(BACKEND_DIR / "rulesets"))
    monkeypatch.setenv("SB_MODELS_DIR", str(FIXTURE_MODELS))
    monkeypatch.setenv("SB_RUNTIME_CONFIG_SEED", str(UNPINNED_SEED))
    monkeypatch.chdir(workdir)  # a developer's backend/.env is not read


def make_workdir(tmp_path: Path) -> Path:
    """What the image has next to the working directory: ``alembic.ini`` and ``alembic/`` (the migrations)."""
    directory = tmp_path / "app"
    directory.mkdir()
    shutil.copytree(BACKEND_DIR / "alembic", directory / "alembic", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy(BACKEND_DIR / "alembic.ini", directory / "alembic.ini")
    return directory


def sb_jobs(*args: str) -> Result:
    return CliRunner().invoke(cli.app, list(args))


def last_json(result: Result) -> dict[str, Any]:
    """The result line the command printed: the last line of stdout, after any log lines."""
    parsed: dict[str, Any] = json.loads(result.stdout.strip().splitlines()[-1])
    return parsed


def rows(settings: Settings, sql: str) -> list[dict[str, Any]]:
    return fetch_all(settings.database_url.get_secret_value(), sql)


def app_settings(database: Settings, *, replay_dir: Path | None = None, snapshot_id: str | None = None) -> Settings:
    """Settings of the API over ``database``; with ``replay_dir`` and ``snapshot_id`` it serves the replay snapshot."""
    replay: dict[str, Any] = {}
    if replay_dir is not None:
        replay = {
            "forecast_source": "replay",
            "replay_dir": replay_dir,
            "replay_snapshot_id": snapshot_id,
            "replay_default_date": REPLAY_DATE,
        }
    return Settings(
        _env_file=None,
        env="test",
        log_format="json",
        database_url=database.database_url,
        access_tokens=SecretStr(ACCESS_TOKENS),
        rulesets_dir=BACKEND_DIR / "rulesets",
        models_dir=FIXTURE_MODELS,
        runtime_config_seed=UNPINNED_SEED,
        config_poll_interval_s=1.0,
        **replay,
    )


class ManualWall:
    """The real clock of a test: starts at ``start`` and moves only when the test says so (no sleeping)."""

    def __init__(self, start: datetime) -> None:
        self.now = start

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


@contextmanager
def running_app(
    settings: Settings, *, wall: Callable[[], datetime] | None = None, wait_for_database_config: bool = False
) -> Iterator[TestClient]:
    """The app with the real Postgres services (``build_api_services``); the lifespan runs on enter and exit.

    ``wall`` is the injected REAL clock (audit rows, epoch starts, rate limiter); in replay mode the domain clock is
    built by the production path (``domain_clock``: an ``EpochReplayClock`` that reads the replay anchor at the start of
    the current ``site_epoch`` and follows ``wall``), so a stop recorded in the demo lands on the replay day with
    nothing swapped by hand. Start ``wall`` at the epoch's ``started_at`` for exact replay times.
    ``wait_for_database_config`` waits for the config poller to replace the seed snapshot with the one activated in the
    database (``version_id`` not None), which sign-off needs.
    """
    app = create_app(settings, wall=wall)
    with TestClient(app, raise_server_exceptions=False) as client:
        if wait_for_database_config:
            _wait_for_database_config(app)
        yield client


def _wait_for_database_config(app: Any) -> None:
    import time

    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        snapshot = app.state.runtime.config.peek()
        if snapshot is not None and snapshot.version_id is not None:
            return
        time.sleep(0.2)
    raise AssertionError("the config poller never served the activated database config (version_id is None)")
