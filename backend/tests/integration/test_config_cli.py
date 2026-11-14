"""``sb-jobs db upgrade`` and ``sb-jobs config ...`` end to end against a real Postgres (the commands a deploy and an
operator run). The commands run ``asyncio.run`` themselves, so these tests are synchronous."""

import json
import shutil
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner, Result

from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import RuntimeConfig, config_body, config_sha256
from stellar_blaze.jobs import cli
from tests.alembic_support import BACKEND_DIR
from tests.integration.db_admin import fetch_all
from tests.unit.config.support import FIXTURE_MODELS, margin

pytestmark = pytest.mark.integration

REASON_ARGS = ("--actor", "ali", "--reason", "B3 margin trial")


def environment(
    monkeypatch: pytest.MonkeyPatch, settings: Settings, workdir: Path, *, seed: Path | None = None
) -> None:
    monkeypatch.setenv("SB_DATABASE_URL", settings.database_url.get_secret_value())
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.setenv("SB_GIT_SHA", "abc1234")
    monkeypatch.setenv("SB_RULESETS_DIR", str(BACKEND_DIR / "rulesets"))
    monkeypatch.setenv("SB_MODELS_DIR", str(FIXTURE_MODELS))
    monkeypatch.setenv("SB_RUNTIME_CONFIG_SEED", str(seed or BACKEND_DIR / "config" / "runtime" / "default.toml"))
    monkeypatch.chdir(workdir)  # a developer's backend/.env is not read


@pytest.fixture
def workdir(tmp_path: Path) -> Path:
    """What the image has next to the working directory: ``alembic.ini`` and ``alembic/`` (the migrations)."""
    directory = tmp_path / "app"
    directory.mkdir()
    shutil.copytree(BACKEND_DIR / "alembic", directory / "alembic", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy(BACKEND_DIR / "alembic.ini", directory / "alembic.ini")
    return directory


def invoke(*args: str) -> Result:
    return CliRunner().invoke(cli.app, list(args))


def last_json(result: Result) -> dict[str, Any]:
    """The result line the command printed: the last line of stdout, after any log lines."""
    parsed: dict[str, Any] = json.loads(result.stdout.strip().splitlines()[-1])
    return parsed


def shown(result: Result) -> dict[str, Any]:
    """``config show`` prints one indented JSON document and nothing else."""
    parsed: dict[str, Any] = json.loads(result.stdout)
    return parsed


def rows(settings: Settings, sql: str) -> list[dict[str, Any]]:
    return fetch_all(settings.database_url.get_secret_value(), sql)


def margin_file(directory: Path, value: float, name: str = "proposal.toml") -> Path:
    path = directory / name
    path.write_text(f"schema_version = 1\n[tunables]\ntwl_margin_w_m2 = {value}\n[flags]\n", encoding="utf-8")
    return path


# --- db upgrade -----------------------------------------------------------------------------------------------------


def test_db_upgrade_migrates_an_empty_database_and_seeds_the_git_default(
    empty_settings: Settings, workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    environment(monkeypatch, empty_settings, workdir)

    result = invoke("db", "upgrade")

    assert result.exit_code == 0, result.output
    assert rows(empty_settings, "SELECT version_num FROM alembic_version") == [{"version_num": "0003"}]
    (version,) = rows(empty_settings, "SELECT sha256, body, created_by, reason FROM config_version")
    assert version["sha256"] == config_sha256(RuntimeConfig())
    assert version["created_by"] == "seed:abc1234"
    assert version["reason"] == "seed from git default"
    (activation,) = rows(empty_settings, "SELECT kind, actor, previous_activation_id FROM config_activation")
    assert activation == {"kind": "seed", "actor": "seed:abc1234", "previous_activation_id": None}
    printed = last_json(result)
    assert printed["revision"] == "0003"
    assert printed["activation_id"] == 1
    # Alembic's own progress goes through the structured log, not to a second, unstructured stream.
    migrated = [
        json.loads(line) for line in result.stdout.splitlines() if line.startswith("{") and "Running upgrade" in line
    ]
    assert len(migrated) == 3


def test_db_upgrade_is_idempotent_and_never_replaces_an_active_config(
    empty_settings: Settings, workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    environment(monkeypatch, empty_settings, workdir)
    assert invoke("db", "upgrade").exit_code == 0
    proposed = last_json(invoke("config", "propose", str(margin_file(workdir, 7.0)), *REASON_ARGS))
    assert (
        invoke(
            "config", "activate", str(proposed["version_id"]), "--actor", "ali", "--reason", "margin trial"
        ).exit_code
        == 0
    )

    again = invoke("db", "upgrade")  # the next deploy's migration job

    assert again.exit_code == 0, again.output
    assert last_json(again)["activation_id"] is None  # the seed did not run over the operator's activation
    assert rows(empty_settings, "SELECT count(*) AS n FROM config_version")[0]["n"] == 2
    active = shown(invoke("config", "show"))
    assert active["config_version_id"] == proposed["version_id"]
    assert active["body"]["tunables"]["twl_margin_w_m2"] == 7.0


@pytest.mark.parametrize(("env", "exit_code"), [("test", 2), ("prod", 1)])
def test_db_upgrade_refuses_an_invalid_seed_before_it_migrates_anything(
    empty_settings: Settings, workdir: Path, monkeypatch: pytest.MonkeyPatch, env: str, exit_code: int
) -> None:
    # Outside prod the API starts from the seed file, so an invalid seed is a configuration error (2) at startup;
    # in prod the file is only read by this command, which validates it itself (1). Neither has migrated anything.
    environment(monkeypatch, empty_settings, workdir, seed=margin_file(workdir, 25.0, "seed.toml"))
    monkeypatch.setenv("SB_ENV", env)

    result = invoke("db", "upgrade")

    assert result.exit_code == exit_code, result.output
    assert "out-of-range" in result.stderr
    assert rows(empty_settings, "SELECT to_regclass('public.alembic_version') IS NOT NULL AS present") == [
        {"present": False}
    ]


def test_db_upgrade_that_fails_to_connect_exits_1_without_credentials(
    empty_settings: Settings, workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    environment(monkeypatch, empty_settings, workdir)
    monkeypatch.setenv("SB_DATABASE_URL", "postgresql+asyncpg://sb:hunter2@127.0.0.1:1/stellar_blaze")

    result = invoke("db", "upgrade")

    assert result.exit_code == 1
    assert "hunter2" not in result.output
    assert "Traceback" not in result.output


# --- config commands ------------------------------------------------------------------------------------------------


def test_the_operators_flow_seed_propose_activate_show_rollback_and_history(
    settings: Settings, workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    environment(monkeypatch, settings, workdir)

    seeded = invoke("config", "seed")
    assert seeded.exit_code == 0, seeded.output
    assert last_json(seeded)["version_id"] == 1

    proposed = invoke("config", "propose", str(margin_file(workdir, 7.0)), *REASON_ARGS)
    assert proposed.exit_code == 0, proposed.output
    assert last_json(proposed) == {"version_id": 2, "sha256": config_sha256(margin(7.0))}

    activated = invoke("config", "activate", "2", "--actor", "ali", "--reason", "margin trial")
    assert activated.exit_code == 0, activated.output
    assert last_json(activated)["kind"] == "activate"
    active = shown(invoke("config", "show"))
    assert (active["config_version_id"], active["actor"], active["reason"]) == (2, "ali", "margin trial")
    assert active["body"]["tunables"] == config_body(margin(7.0))["tunables"]  # all 13 keys, derived from the model
    assert active["body"]["tunables"]["twl_margin_w_m2"] == 7.0

    rolled_back = invoke("config", "rollback", "--actor", "ali", "--reason", "revert trial")
    assert rolled_back.exit_code == 0, rolled_back.output
    assert last_json(rolled_back)["config_version_id"] == 1
    assert shown(invoke("config", "show"))["config_version_id"] == 1

    history = [json.loads(line) for line in invoke("config", "history", "--limit", "20").stdout.splitlines()]
    assert [(h["kind"], h["actor"], h["config_version_id"]) for h in history] == [
        ("rollback", "ali", 1),
        ("activate", "ali", 2),
        ("seed", "seed:abc1234", 1),
    ]
    assert [h["previous_activation_id"] for h in history] == [2, 1, None]


def test_activate_with_a_stale_expected_previous_is_refused_and_writes_nothing(
    settings: Settings, workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    environment(monkeypatch, settings, workdir)
    assert invoke("config", "seed").exit_code == 0
    invoke("config", "propose", str(margin_file(workdir, 7.0)), *REASON_ARGS)
    invoke("config", "propose", str(margin_file(workdir, 9.0, "other.toml")), *REASON_ARGS)
    assert invoke("config", "activate", "2", "--actor", "ali", "--reason", "margin trial").exit_code == 0

    result = invoke(
        "config", "activate", "3", "--actor", "bob", "--reason", "a concurrent change", "--expected-previous", "1"
    )

    assert result.exit_code == 1
    assert "stale" in result.stderr.lower()
    assert rows(settings, "SELECT count(*) AS n FROM config_activation")[0]["n"] == 2


def test_an_out_of_range_proposal_is_refused_and_nothing_is_stored(
    settings: Settings, workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    environment(monkeypatch, settings, workdir)

    result = invoke("config", "propose", str(margin_file(workdir, 25.0)), *REASON_ARGS)

    assert result.exit_code == 1
    assert "out-of-range" in result.stderr
    assert rows(settings, "SELECT count(*) AS n FROM config_version")[0]["n"] == 0


def test_a_short_reason_is_a_usage_error_and_the_database_is_not_written(
    settings: Settings, workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    environment(monkeypatch, settings, workdir)

    result = invoke("config", "propose", str(margin_file(workdir, 7.0)), "--actor", "ali", "--reason", "short")

    assert result.exit_code == 2
    assert rows(settings, "SELECT count(*) AS n FROM config_version")[0]["n"] == 0


def test_config_show_on_a_database_that_was_never_migrated_exits_1_and_names_the_table(
    empty_settings: Settings, workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    environment(monkeypatch, empty_settings, workdir)

    result = invoke("config", "show")

    assert result.exit_code == 1
    assert "config_activation" in result.stderr
    assert "Traceback" not in result.output
