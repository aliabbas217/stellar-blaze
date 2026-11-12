"""``sb-jobs config ...`` and ``sb-jobs db upgrade``: arguments, output, exit codes and error messages, over the
in-memory store (the real database is the integration tier's). The store is injected by replacing the
``build_config_store`` name that ``jobs.cli`` looks up, as Task 10 does for ``build_sources``."""

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine
from typer.testing import CliRunner, Result

from stellar_blaze.adapters.fakes.config_store import InMemoryConfigStore
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import RuntimeConfig, config_sha256
from stellar_blaze.jobs import cli
from stellar_blaze.ports.config_store import RuntimeConfigStore, StoreUnavailableError
from tests.unit.config.support import FIRST_MODEL, FIXTURE_MODELS, margin
from tests.unit.rules.support import BACKEND_ROOT, RULESETS_DIR

pytestmark = pytest.mark.unit

PASSWORD = "hunter2"  # noqa: S105  (a made-up value the tests assert never reaches the output)
REASON_ARGS = ("--actor", "ali", "--reason", "B3 margin trial")


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> InMemoryConfigStore:
    """The environment of a command run, and the one fake store every command in the test shares."""
    monkeypatch.chdir(tmp_path)  # a developer's backend/.env is not read
    monkeypatch.setenv("SB_DATABASE_URL", f"postgresql+asyncpg://sb:{PASSWORD}@127.0.0.1:1/stellar_blaze")
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.setenv("SB_GIT_SHA", "abc1234")
    monkeypatch.setenv("SB_RULESETS_DIR", str(RULESETS_DIR))
    monkeypatch.setenv("SB_MODELS_DIR", str(FIXTURE_MODELS))
    monkeypatch.setenv("SB_RUNTIME_CONFIG_SEED", str(BACKEND_ROOT / "config" / "runtime" / "default.toml"))
    fake = InMemoryConfigStore()

    def build(_engine: AsyncEngine, _settings: Settings) -> RuntimeConfigStore:
        return fake

    monkeypatch.setattr(cli, "build_config_store", build)
    return fake


def invoke(*args: str) -> Result:
    return CliRunner().invoke(cli.app, list(args))


def toml_file(tmp_path: Path, body: str, name: str = "proposal.toml") -> Path:
    path = tmp_path / name
    path.write_text(body, encoding="utf-8")
    return path


def margin_file(tmp_path: Path, value: float, name: str = "proposal.toml") -> Path:
    return toml_file(tmp_path, f"schema_version = 1\n[tunables]\ntwl_margin_w_m2 = {value}\n[flags]\n", name)


def out(result: Result) -> dict[str, Any]:
    parsed: dict[str, Any] = json.loads(result.stdout)
    return parsed


def seed_it() -> dict[str, Any]:
    result = invoke("config", "seed")
    assert result.exit_code == 0, result.output
    return out(result)


# --- help ------------------------------------------------------------------------------------------------------


def test_the_help_lists_the_db_and_config_groups_next_to_the_jobs() -> None:
    result = invoke("--help")

    assert result.exit_code == 0
    for name in ("db", "config", "ingest-observations", "build-dataset"):
        assert name in result.output


def test_config_help_lists_the_seven_commands() -> None:
    result = invoke("config", "--help")

    assert result.exit_code == 0
    for name in ("validate", "seed", "show", "history", "propose", "activate", "rollback"):
        assert name in result.output
    assert "upgrade" in invoke("db", "--help").output


# --- validate (offline) ----------------------------------------------------------------------------------------


def test_validate_accepts_a_valid_file_and_never_touches_the_store(store: InMemoryConfigStore, tmp_path: Path) -> None:
    result = invoke("config", "validate", str(margin_file(tmp_path, 7.0)))

    assert result.exit_code == 0, result.output
    assert "valid" in result.stdout
    assert store.calls == []


def test_validate_prints_every_violation_and_exits_1(store: InMemoryConfigStore, tmp_path: Path) -> None:
    path = toml_file(
        tmp_path,
        'schema_version = 1\nmodel_id = "corrector-20990101-0000000-000000"\n[tunables]\ntwl_margin_w_m2 = 25.0\n'
        "[flags]\n",
    )

    result = invoke("config", "validate", str(path))

    assert result.exit_code == 1
    assert "out-of-range at tunables.twl_margin_w_m2" in result.stderr
    assert "unknown-model at model_id" in result.stderr
    assert FIRST_MODEL in result.stderr  # names the models that do exist
    assert store.calls == []


def test_validate_refuses_a_file_that_tries_to_set_a_legal_floor(store: InMemoryConfigStore, tmp_path: Path) -> None:
    path = toml_file(tmp_path, "schema_version = 1\n[tunables]\n[flags]\n[twl_zones]\nlow_min_w_m2 = 1.0\n")

    result = invoke("config", "validate", str(path))

    assert result.exit_code == 1
    assert "twl_zones" in result.stderr
    assert "Traceback" not in result.output
    assert store.calls == []


def test_validate_refuses_a_file_that_is_not_toml(store: InMemoryConfigStore, tmp_path: Path) -> None:
    result = invoke("config", "validate", str(toml_file(tmp_path, "this is = = not toml")))

    assert result.exit_code == 1
    assert "not valid TOML" in result.stderr
    assert "Traceback" not in result.output


def test_validate_of_a_missing_file_is_a_usage_error(store: InMemoryConfigStore, tmp_path: Path) -> None:
    result = invoke("config", "validate", str(tmp_path / "nowhere.toml"))

    assert result.exit_code == 2
    assert "nowhere.toml" in result.output


# --- propose ---------------------------------------------------------------------------------------------------


def test_propose_stores_the_version_and_prints_its_id_and_hash(store: InMemoryConfigStore, tmp_path: Path) -> None:
    result = invoke("config", "propose", str(margin_file(tmp_path, 7.0)), *REASON_ARGS)

    assert result.exit_code == 0, result.output
    printed = out(result)
    assert printed == {"version_id": 1, "sha256": config_sha256(margin(7.0))}
    assert invoke("config", "show").exit_code == 1  # nothing is active: proposing activates nothing
    assert store.calls.count("create_version") == 1


def test_propose_is_idempotent_for_the_same_config(store: InMemoryConfigStore, tmp_path: Path) -> None:
    path = margin_file(tmp_path, 7.0)

    first = out(invoke("config", "propose", str(path), *REASON_ARGS))
    again = out(invoke("config", "propose", str(path), "--actor", "bob", "--reason", "proposing it again"))

    assert again == first


@pytest.mark.parametrize("missing", ["--actor", "--reason"])
def test_every_write_needs_an_actor_and_a_reason(store: InMemoryConfigStore, tmp_path: Path, missing: str) -> None:
    path = str(margin_file(tmp_path, 7.0))
    given = {"--actor": "ali", "--reason": "B3 margin trial"}
    del given[missing]
    options = [part for key, value in given.items() for part in (key, value)]

    for command in (["propose", path], ["activate", "1"], ["rollback"]):
        result = invoke("config", *command, *options)
        assert result.exit_code == 2, result.output
        assert missing in result.output

    assert store.calls == []


def test_a_short_reason_is_a_usage_error_before_anything_is_written(store: InMemoryConfigStore, tmp_path: Path) -> None:
    result = invoke("config", "propose", str(margin_file(tmp_path, 7.0)), "--actor", "ali", "--reason", "too short")

    assert result.exit_code == 2
    assert "reason" in result.output
    assert "create_version" not in store.calls


def test_propose_refuses_an_invalid_config_and_stores_nothing(store: InMemoryConfigStore, tmp_path: Path) -> None:
    result = invoke("config", "propose", str(margin_file(tmp_path, 25.0)), *REASON_ARGS)

    assert result.exit_code == 1
    assert "out-of-range at tunables.twl_margin_w_m2" in result.stderr
    assert "create_version" not in store.calls


# --- activate and rollback -------------------------------------------------------------------------------------


def test_activate_defaults_expected_previous_to_the_current_latest(store: InMemoryConfigStore, tmp_path: Path) -> None:
    seeded = seed_it()
    proposed = out(invoke("config", "propose", str(margin_file(tmp_path, 7.0)), *REASON_ARGS))

    result = invoke("config", "activate", str(proposed["version_id"]), "--actor", "ali", "--reason", "margin trial")

    assert result.exit_code == 0, result.output
    printed = out(result)
    assert printed["kind"] == "activate"
    assert printed["config_version_id"] == proposed["version_id"]
    assert printed["previous_activation_id"] == seeded["activation_id"]


def test_activate_with_a_stale_expected_previous_exits_1_and_changes_nothing(
    store: InMemoryConfigStore, tmp_path: Path
) -> None:
    seeded = seed_it()
    first = out(invoke("config", "propose", str(margin_file(tmp_path, 7.0)), *REASON_ARGS))
    second = out(invoke("config", "propose", str(margin_file(tmp_path, 3.0, "other.toml")), *REASON_ARGS))
    assert (
        invoke("config", "activate", str(first["version_id"]), "--actor", "ali", "--reason", "margin trial").exit_code
        == 0
    )

    result = invoke(
        "config",
        "activate",
        str(second["version_id"]),
        "--actor",
        "bob",
        "--reason",
        "a concurrent change",
        "--expected-previous",
        str(seeded["activation_id"]),
    )

    assert result.exit_code == 1
    assert "stale" in result.stderr.lower()
    assert str(seeded["activation_id"]) in result.stderr
    assert len(invoke("config", "history").stdout.splitlines()) == 2


def test_activate_an_unknown_version_exits_1(store: InMemoryConfigStore) -> None:
    result = invoke("config", "activate", "99", *REASON_ARGS)

    assert result.exit_code == 1
    assert "99" in result.stderr
    assert "not found" in result.stderr.lower()


def test_the_first_activation_is_a_seed_even_through_activate(store: InMemoryConfigStore, tmp_path: Path) -> None:
    proposed = out(invoke("config", "propose", str(margin_file(tmp_path, 7.0)), *REASON_ARGS))

    result = invoke("config", "activate", str(proposed["version_id"]), *REASON_ARGS)

    assert result.exit_code == 0, result.output
    assert out(result)["kind"] == "seed"


def test_rollback_returns_to_the_previous_version(store: InMemoryConfigStore, tmp_path: Path) -> None:
    seeded = seed_it()
    proposed = out(invoke("config", "propose", str(margin_file(tmp_path, 7.0)), *REASON_ARGS))
    invoke("config", "activate", str(proposed["version_id"]), "--actor", "ali", "--reason", "margin trial")

    result = invoke("config", "rollback", "--actor", "ali", "--reason", "revert trial")

    assert result.exit_code == 0, result.output
    printed = out(result)
    assert printed["kind"] == "rollback"
    assert printed["config_version_id"] == seeded["version_id"]
    shown = out(invoke("config", "show"))
    assert shown["config_version_id"] == seeded["version_id"]


def test_rollback_with_a_stale_expected_previous_exits_1_and_changes_nothing(
    store: InMemoryConfigStore, tmp_path: Path
) -> None:
    seeded = seed_it()
    proposed = out(invoke("config", "propose", str(margin_file(tmp_path, 7.0)), *REASON_ARGS))
    activated = out(
        invoke("config", "activate", str(proposed["version_id"]), "--actor", "ali", "--reason", "margin trial")
    )

    stale = invoke(
        "config",
        "rollback",
        "--actor",
        "ali",
        "--reason",
        "revert trial",
        "--expected-previous",
        str(seeded["activation_id"]),
    )
    assert stale.exit_code == 1
    assert "stale" in stale.stderr.lower()
    assert str(seeded["activation_id"]) in stale.stderr
    assert len(invoke("config", "history").stdout.splitlines()) == 2

    fresh = invoke(
        "config",
        "rollback",
        "--actor",
        "ali",
        "--reason",
        "revert trial",
        "--expected-previous",
        str(activated["activation_id"]),
    )
    assert fresh.exit_code == 0, fresh.output
    assert out(fresh)["config_version_id"] == seeded["version_id"]

    retried = invoke(
        "config",
        "rollback",
        "--actor",
        "ali",
        "--reason",
        "revert trial",
        "--expected-previous",
        str(activated["activation_id"]),
    )
    assert retried.exit_code == 1  # the same request again does not undo itself
    assert len(invoke("config", "history").stdout.splitlines()) == 3


def test_rollback_to_the_version_that_is_already_active_exits_1(store: InMemoryConfigStore) -> None:
    seeded = seed_it()
    assert (
        invoke(
            "config", "activate", str(seeded["version_id"]), "--actor", "ali", "--reason", "activate the same version"
        ).exit_code
        == 0
    )

    result = invoke("config", "rollback", *REASON_ARGS)

    assert result.exit_code == 1
    assert "same version" in result.stderr


def test_rollback_with_nothing_to_roll_back_exits_1(store: InMemoryConfigStore) -> None:
    seed_it()

    result = invoke("config", "rollback", "--actor", "ali", "--reason", "revert trial")

    assert result.exit_code == 1
    assert "nothing to roll back" in result.stderr.lower()


# --- show and history ------------------------------------------------------------------------------------------


def test_show_prints_the_active_version_with_its_hash_and_body(store: InMemoryConfigStore) -> None:
    seeded = seed_it()

    result = invoke("config", "show")

    assert result.exit_code == 0, result.output
    shown = out(result)
    assert shown["activation_id"] == seeded["activation_id"]
    assert shown["config_version_id"] == seeded["version_id"]
    assert shown["sha256"] == config_sha256(RuntimeConfig())
    assert shown["body"] == RuntimeConfig().model_dump(mode="json")
    assert shown["kind"] == "seed"
    assert shown["actor"] == "seed:abc1234"


def test_show_without_an_active_config_exits_1(store: InMemoryConfigStore) -> None:
    result = invoke("config", "show")

    assert result.exit_code == 1
    assert "no active" in result.stderr.lower()


def test_history_is_newest_first_one_json_object_per_line_and_limited(
    store: InMemoryConfigStore, tmp_path: Path
) -> None:
    seed_it()
    proposed = out(invoke("config", "propose", str(margin_file(tmp_path, 7.0)), *REASON_ARGS))
    invoke("config", "activate", str(proposed["version_id"]), "--actor", "ali", "--reason", "margin trial")
    invoke("config", "rollback", "--actor", "ali", "--reason", "revert trial")

    everything = [json.loads(line) for line in invoke("config", "history").stdout.splitlines()]
    two = [json.loads(line) for line in invoke("config", "history", "--limit", "2").stdout.splitlines()]

    assert [a["kind"] for a in everything] == ["rollback", "activate", "seed"]
    assert [a["id"] for a in two] == [a["id"] for a in everything[:2]]
    assert {"id", "config_version_id", "kind", "actor", "reason", "previous_activation_id", "activated_at"} <= (
        everything[0].keys()
    )


def test_history_limit_must_be_positive(store: InMemoryConfigStore) -> None:
    result = invoke("config", "history", "--limit", "0")

    assert result.exit_code == 2
    assert "--limit" in result.output


# --- seed ------------------------------------------------------------------------------------------------------


def test_seed_creates_and_activates_the_git_default_under_the_deploys_identity(store: InMemoryConfigStore) -> None:
    result = invoke("config", "seed")

    assert result.exit_code == 0, result.output
    printed = out(result)
    assert printed["activation_id"] is not None
    (record,) = [json.loads(line) for line in invoke("config", "history").stdout.splitlines()]
    assert (record["kind"], record["actor"], record["reason"]) == ("seed", "seed:abc1234", "seed from git default")
    assert record["previous_activation_id"] is None
    version = asyncio.run(store.get_version(printed["version_id"]))
    assert version.created_by == "seed:abc1234"
    assert version.sha256 == config_sha256(RuntimeConfig())


@pytest.mark.parametrize("git_sha", [None, "unknown"])
def test_seed_names_a_run_outside_a_release_local(
    store: InMemoryConfigStore, monkeypatch: pytest.MonkeyPatch, git_sha: str | None
) -> None:
    if git_sha is None:
        monkeypatch.delenv("SB_GIT_SHA")
    else:
        monkeypatch.setenv("SB_GIT_SHA", git_sha)

    assert invoke("config", "seed").exit_code == 0

    (record,) = [json.loads(line) for line in invoke("config", "history").stdout.splitlines()]
    assert record["actor"] == "seed:local"


def test_seed_is_idempotent(store: InMemoryConfigStore) -> None:
    first = seed_it()

    again = invoke("config", "seed")

    assert again.exit_code == 0, again.output
    assert out(again) == {"version_id": first["version_id"], "sha256": first["sha256"], "activation_id": None}
    assert len(invoke("config", "history").stdout.splitlines()) == 1


def test_seed_reads_the_file_given_with_the_option(store: InMemoryConfigStore, tmp_path: Path) -> None:
    result = invoke("config", "seed", "--file", str(margin_file(tmp_path, 7.0)))

    assert result.exit_code == 0, result.output
    assert out(result)["sha256"] == config_sha256(margin(7.0))


def test_seed_refuses_an_invalid_file(store: InMemoryConfigStore, tmp_path: Path) -> None:
    result = invoke("config", "seed", "--file", str(margin_file(tmp_path, 25.0)))

    assert result.exit_code == 1
    assert "out-of-range" in result.stderr
    assert store.calls == []


# --- failures --------------------------------------------------------------------------------------------------


def test_a_database_error_exits_1_with_the_exception_class_and_no_credentials(store: InMemoryConfigStore) -> None:
    store.fail_on["*"] = ConnectionRefusedError(f"cannot connect to postgresql+asyncpg://sb:{PASSWORD}@db:5432/x")

    for command in (["show"], ["history"], ["rollback", *REASON_ARGS], ["seed"]):
        result = invoke("config", *command)
        assert result.exit_code == 1, command
        assert "ConnectionRefusedError" in result.stderr
        assert PASSWORD not in result.output
        assert "Traceback" not in result.output


def test_a_store_that_cannot_answer_exits_1_with_the_reason_and_no_credentials(store: InMemoryConfigStore) -> None:
    # What the Postgres adapter raises for a failed read (the port's own error), as opposed to a raw driver error.
    store.fail_on["*"] = StoreUnavailableError(
        f"OperationalError: connection to postgresql+asyncpg://sb:{PASSWORD}@db:5432/x failed"
    )

    for command in (["show"], ["history"], ["rollback", *REASON_ARGS]):
        result = invoke("config", *command)
        assert result.exit_code == 1, command
        assert "StoreUnavailableError: OperationalError: connection to" in result.stderr
        assert PASSWORD not in result.output
        assert "Traceback" not in result.output


def test_a_configuration_error_exits_2_before_any_store_call(
    store: InMemoryConfigStore, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("SB_RULESETS_DIR", str(tmp_path / "no-rulesets"))

    for command in (["show"], ["seed"], ["validate", str(margin_file(tmp_path, 7.0))]):
        result = invoke("config", *command)
        assert result.exit_code == 2, (command, result.output)
        assert "no-rulesets" in result.stderr
        assert "Traceback" not in result.output

    assert store.calls == []


def test_a_missing_database_url_is_a_configuration_error_naming_the_variable(
    store: InMemoryConfigStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("SB_DATABASE_URL")

    result = invoke("config", "show")

    assert result.exit_code == 2
    assert "database_url" in result.output


def test_db_upgrade_without_alembic_ini_in_the_working_directory_is_a_configuration_error(
    store: InMemoryConfigStore,
) -> None:
    result = invoke("db", "upgrade")

    assert result.exit_code == 2
    assert "alembic.ini" in result.stderr
    assert store.calls == []
