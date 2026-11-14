"""``sb-jobs train``: the command's wiring (job run, lock, dev pairs only, model directory, release refusals).

The gold file is a tiny synthetic one under ``tmp_path`` (never the real file) that holds a 2026 summer on purpose; the
model must have been fitted on 2024-2025 only. The database is the fake of ``tests/unit/jobs/support.py`` and git is
replaced: the run never runs git.
"""

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from stellar_blaze.adapters.config.models import scan_models
from stellar_blaze.jobs import ml_cli, replay_build
from stellar_blaze.jobs.cli import app
from stellar_blaze.ml import artefacts, predict
from stellar_blaze.ml.git import GitError
from tests.fixtures.forecast.train_cli import (
    CONFIG_NAME,
    CONFIG_TOML,
    GIT_SHA,
    dev_skill_payload,
    fake_repo,
    manifest_sha256,
    write_gold,
)
from tests.unit.jobs.support import FakeLock, FakeRuns, use_fake_database

pytestmark = pytest.mark.unit

DATABASE_URL = "postgresql+asyncpg://sb:hunter2@localhost:5432/stellar_blaze"


class FakeGit:
    """A ``GitReader`` with a fixed answer; ``show`` and ``is_ancestor`` are not part of a release's questions."""

    def __init__(self, *, clean: bool = True, error: Exception | None = None) -> None:
        self.clean = clean
        self.error = error
        self.asked = 0

    def head(self) -> str:
        return GIT_SHA

    def is_clean(self) -> bool:
        self.asked += 1
        if self.error is not None:
            raise self.error
        return self.clean

    def is_ancestor(self, ancestor: str, descendant: str) -> bool:
        raise AssertionError("a release does not ask about ancestry")

    def show(self, commit: str, path: str) -> bytes:
        raise AssertionError("a release does not read committed files")


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """``SB_*`` environment under ``tmp_path``, a synthetic gold file with its manifest, a config and a fake repo."""
    monkeypatch.chdir(tmp_path)  # a developer's backend/.env must not reach the test
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.setenv("SB_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SB_MODELS_DIR", str(tmp_path / "models"))
    write_gold(tmp_path / "data")
    (tmp_path / f"{CONFIG_NAME}.toml").write_bytes(CONFIG_TOML.encode("utf-8"))
    repo = fake_repo(tmp_path)
    monkeypatch.setattr(replay_build, "git_head", lambda root: GIT_SHA)
    monkeypatch.setattr(replay_build, "repo_root", lambda: repo)
    return tmp_path


def _config(env: Path) -> str:
    return str(env / f"{CONFIG_NAME}.toml")


def _invoke(*arguments: str) -> Any:
    return CliRunner().invoke(app, ["train", *arguments])


def _use_git(monkeypatch: pytest.MonkeyPatch, git: FakeGit) -> None:
    monkeypatch.setattr(ml_cli, "_git_reader", lambda root: git)


def _spy_train(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Replace the (slow) body of the command with one that records that it ran and raises."""
    calls: list[dict[str, Any]] = []

    def train(*args: Any, **kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        raise AssertionError("the command must not have reached the training")

    monkeypatch.setattr(ml_cli, "_train", train)
    return calls


def test_help_lists_the_command_and_its_options() -> None:
    top = CliRunner().invoke(app, ["--help"])
    command = CliRunner().invoke(app, ["train", "--help"])

    assert top.exit_code == command.exit_code == 0
    assert "train" in top.output
    for option in ("--config", "--release", "--dev-skill"):
        assert option in command.output


# === refusals and usage =============================================================================================


def test_release_refuses_dirty_tree(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    runs = FakeRuns()
    use_fake_database(monkeypatch, runs)
    git = FakeGit(clean=False)
    _use_git(monkeypatch, git)
    calls = _spy_train(monkeypatch)

    result = _invoke("--config", _config(env), "--release")

    assert result.exit_code == 1
    assert "not clean" in result.output
    assert git.asked == 1
    assert calls == []  # nothing was trained
    assert runs.finished == []
    assert runs.skipped == []  # refused before any job: no run row, no lock
    assert not (env / "models").exists()
    assert not (env / "data" / "models-eval").exists()


def test_release_refuses_when_git_cannot_answer(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    use_fake_database(monkeypatch, FakeRuns())
    _use_git(monkeypatch, FakeGit(error=GitError("git is gone")))
    calls = _spy_train(monkeypatch)

    result = _invoke("--config", _config(env), "--release")

    assert result.exit_code == 1
    assert "git is gone" in result.output
    assert calls == []
    assert not (env / "models").exists()


def test_a_run_without_release_never_asks_git_about_the_tree(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    use_fake_database(monkeypatch, FakeRuns())
    git = FakeGit(clean=False)
    _use_git(monkeypatch, git)
    _spy_train(monkeypatch)

    _invoke("--config", _config(env))

    assert git.asked == 0  # a dev model may come from a dirty tree


def test_a_locked_run_is_skipped_with_exit_zero_under_the_job_name(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    runs, lock = FakeRuns(), FakeLock(granted=False)
    use_fake_database(monkeypatch, runs, lock)
    calls = _spy_train(monkeypatch)

    result = _invoke("--config", _config(env))

    assert result.exit_code == 0
    assert lock.keys == [f"train:{CONFIG_NAME}"]
    assert [name for name, _ in runs.skipped] == [f"train:{CONFIG_NAME}"]
    assert calls == []


def test_bad_arguments_are_usage_errors_and_record_nothing(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    runs = FakeRuns()
    use_fake_database(monkeypatch, runs)
    (env / "bad.toml").write_bytes(CONFIG_TOML.replace('"site"', '"warm"').encode("utf-8"))
    (env / "skill.json").write_bytes(b"[1, 2]")
    (env / "skill-no-table.json").write_bytes(b"{}")

    cases = [
        ("--config", str(env / "bad.toml")),
        ("--config", str(env / "nope.toml")),
        ("--config", _config(env), "--dev-skill", str(env / "absent.json")),
        ("--config", _config(env), "--dev-skill", str(env / "skill.json")),
        ("--config", _config(env), "--dev-skill", str(env / "skill-no-table.json")),
    ]
    codes = [_invoke(*case).exit_code for case in cases]

    assert codes == [2] * len(cases)
    assert runs.finished == []
    assert runs.skipped == []


# === the runs =======================================================================================================


@pytest.mark.slow
def test_a_run_writes_a_model_to_models_eval_with_the_dev_metrics_and_records_the_job(
    env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runs, lock = FakeRuns(), FakeLock()
    use_fake_database(monkeypatch, runs, lock)
    git = FakeGit(clean=False)  # a dev run does not care
    _use_git(monkeypatch, git)
    exports = env / "exports"
    exports.mkdir()
    (exports / "dev_skill.json").write_bytes(json.dumps(dev_skill_payload()).encode("utf-8"))
    (exports / "selection.json").write_bytes(json.dumps({"mode": "single", "marker": "from-selection"}).encode("utf-8"))

    result = _invoke("--config", _config(env), "--dev-skill", str(exports / "dev_skill.json"))

    assert result.exit_code == 0, result.output
    assert lock.keys == [f"train:{CONFIG_NAME}"]
    assert [status for status, _, _ in runs.finished] == ["succeeded"]
    summary = json.loads(result.output.strip().splitlines()[-1])
    models_eval = env / "data" / "models-eval"
    assert summary["directory"] == str(models_eval / summary["model_id"])
    assert not (env / "models").exists()  # the release directory is for --release only
    registry = scan_models(models_eval)  # every file hashes to its manifest
    assert registry.ids() == (summary["model_id"],)
    manifest = registry.get(summary["model_id"]).manifest
    assert manifest.git_sha == GIT_SHA
    assert manifest.gold_manifest_sha256 == manifest_sha256(env / "data")
    assert manifest.uv_lock_sha256 == hashlib.sha256(b"version = 1\n").hexdigest()
    assert manifest.training_config_sha256 == hashlib.sha256(CONFIG_TOML.encode("utf-8")).hexdigest()
    assert manifest.training_config_path == Path(_config(env)).as_posix()  # not under backend/: recorded as given
    assert manifest.metrics == {
        "loco_crps_t": pytest.approx({"corrector": 0.65, "b0": 2.3, "b2d": 1.15}),  # td has no B2d number: absent
    }
    card = (models_eval / summary["model_id"] / "model_card.md").read_text(encoding="utf-8")
    assert "from-selection" in card
    params = json.loads((models_eval / summary["model_id"] / "params.json").read_bytes())
    assert params["summers"] == [2024, 2025]  # the 2026 rows of the gold file were never loaded


@pytest.mark.slow
def test_a_release_from_a_clean_tree_writes_to_the_models_directory_with_the_training_counts(
    env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_fake_database(monkeypatch, FakeRuns())
    _use_git(monkeypatch, FakeGit(clean=True))

    result = _invoke("--config", _config(env), "--release")

    assert result.exit_code == 0, result.output
    summary = json.loads(result.output.strip().splitlines()[-1])
    assert summary["release"] is True
    assert summary["directory"] == str(env / "models" / summary["model_id"])
    assert not (env / "data" / "models-eval").exists()
    assert set(summary["smoke_mean_abs_shift"]) == {"t", "td", "wind"}
    registry = scan_models(env / "models")
    assert registry.ids() == (summary["model_id"],)
    assert registry.get(summary["model_id"]).manifest.metrics == {
        "training": {"fit_rows": float(summary["fit_rows"]), "calibration_rows": float(summary["calibration_rows"])}
    }


@pytest.mark.slow
def test_release_refuses_a_model_that_does_not_change_the_forecast_and_leaves_nothing(
    env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runs = FakeRuns()
    use_fake_database(monkeypatch, runs)
    _use_git(monkeypatch, FakeGit(clean=True))
    real = predict.corrected_grids

    def constant(trained: Any, rows: Any) -> Any:
        grids = real(trained, rows)
        for target, grid in grids.items():
            grid[:] = rows[f"raw_{target.value}"].cast(float).fill_null(float("nan")).to_numpy()[:, None]
        return grids

    monkeypatch.setattr("stellar_blaze.ml.release_check.corrected_grids", constant)

    result = _invoke("--config", _config(env), "--release")

    assert result.exit_code == 1
    assert "equals the raw forecast" in result.output
    assert [status for status, _, _ in runs.finished] == ["failed"]
    assert not (env / "models").exists()


@pytest.mark.slow
def test_a_model_over_the_size_cap_is_refused_with_the_breakdown_and_leaves_no_directory(
    env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runs = FakeRuns()
    use_fake_database(monkeypatch, runs)
    monkeypatch.setattr(artefacts, "MAX_MODEL_BYTES", 1000)

    result = _invoke("--config", _config(env))

    assert result.exit_code == 1
    assert "over the cap of 1,000" in result.output
    assert "By group" in result.output
    assert "Remedies" in result.output
    assert [status for status, _, _ in runs.finished] == ["failed"]
    assert not (env / "data" / "models-eval").exists()  # not even an empty or partial directory
