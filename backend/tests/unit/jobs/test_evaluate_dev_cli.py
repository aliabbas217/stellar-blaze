"""``sb-jobs evaluate-dev``: the command's wiring (job run, advisory lock, gold hash, exports, 2026 guard).

The gold file is a tiny synthetic one under ``tmp_path`` (never the real file), written with ``ParquetStore.write_gold``
so its manifest is the real thing; it holds a 2026 summer on purpose, which the command must never load. The database is
the fake of ``tests/unit/jobs/support.py``. The selection itself is tested in ``tests/unit/ml/test_selection.py``; here
``run_dev_selection`` is wrapped only to give it the three clusters the fixture has.
"""

import hashlib
import json
import subprocess
import sys
from functools import cache
from pathlib import Path
from typing import Any, Final

import polars as pl
import pytest
from typer.testing import CliRunner

from stellar_blaze.adapters.storage.parquet_store import ParquetStore
from stellar_blaze.domain.weather.dataset import DatasetSummary
from stellar_blaze.jobs import replay_build
from stellar_blaze.jobs.cli import app
from tests.fixtures.forecast.dev_run import CLUSTERS, HOURS, STATIONS, TINY_GRID, WARM
from tests.fixtures.forecast.synthetic import make_pairs
from tests.unit.jobs.support import FakeLock, FakeRuns, use_fake_database

pytestmark = pytest.mark.unit

DATABASE_URL: Final = "postgresql+asyncpg://sb:hunter2@localhost:5432/stellar_blaze"
GIT_SHA: Final = "c" * 40
CONFIG_TOML: Final = """\
name = "unit-dev"
feature_set = "site"
levels = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
leads = [1, 2, 3]
hours_utc = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
calibration_window = "september"
wbgt_method = "joint"
n_joint_samples = 20
sample_seed = 20261112

[lgbm]
num_leaves = 7
min_child_samples = 20
n_estimators = 20
learning_rate = 0.3
seed = 20261112
num_threads = 2
deterministic = true
"""


@cache
def _gold_frame() -> pl.DataFrame:
    """Three summers (2026 included) of the fixture stations, lead 0 included, as a gold file holds them."""
    return make_pairs(
        seed=7,
        summers=(2024, 2025, 2026),
        station_bias_c=dict.fromkeys(WARM, 3.0),
        stations=STATIONS,
        leads=range(4),
        hours_utc=HOURS,
    )


def _write_gold(data_dir: Path) -> str:
    manifest = ParquetStore(data_dir).write_gold(
        _gold_frame().clone(),
        summary=DatasetSummary(pair_counts=[], raw_errors=[], wbgt_rejects={}),
        code_version="test",
        inputs=[],
    )
    return manifest.output.sha256


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """``SB_*`` environment under ``tmp_path``, a synthetic gold file with its manifest, a config and a stubbed git."""
    monkeypatch.chdir(tmp_path)  # a developer's backend/.env must not reach the test
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.setenv("SB_DATA_DIR", str(tmp_path / "data"))
    _write_gold(tmp_path / "data")
    (tmp_path / "unit-dev.toml").write_bytes(CONFIG_TOML.encode("utf-8"))
    monkeypatch.setattr(replay_build, "git_head", lambda root: GIT_SHA)  # the test run never runs git
    monkeypatch.setattr(replay_build, "repo_root", lambda: tmp_path / "repo")
    return tmp_path


def _fixture_selection(monkeypatch: pytest.MonkeyPatch, calls: list[dict[str, Any]]) -> None:
    """Wrap ``run_dev_selection`` so it holds out the fixture's three clusters, tiny grid and few replicates."""
    from stellar_blaze.ml import selection

    real = selection.run_dev_selection

    def wrapped(pairs: pl.DataFrame, cfg: Any, sha: str, *, grid: bool) -> Any:
        calls.append({"grid": grid, "rows": pairs.height, "summers": sorted(pairs["summer"].unique().to_list())})
        return real(pairs, cfg, sha, grid=grid, clusters=CLUSTERS, grid_points=TINY_GRID[:2], n_boot=20)

    monkeypatch.setattr(selection, "run_dev_selection", wrapped)


def _invoke(*arguments: str) -> Any:
    return CliRunner().invoke(app, ["evaluate-dev", *arguments])


def test_help_lists_the_command_and_its_options() -> None:
    top = CliRunner().invoke(app, ["--help"])
    command = CliRunner().invoke(app, ["evaluate-dev", "--help"])

    assert top.exit_code == command.exit_code == 0
    assert "evaluate-dev" in top.output
    for option in ("--config", "--grid", "--out"):
        assert option in command.output


def test_importing_the_cli_does_not_import_the_ml_package() -> None:
    code = (
        "import sys\n"
        "import stellar_blaze.jobs.cli\n"
        "bad = sorted(m for m in sys.modules if m.startswith('stellar_blaze.ml') or m.split('.')[0] in "
        "{'lightgbm', 'sklearn', 'mapie', 'scoringrules'})\n"
        "assert not bad, bad\n"
    )
    result = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, check=False)  # noqa: S603

    assert result.returncode == 0, result.stderr


@pytest.mark.slow
def test_a_single_run_writes_the_exports_and_records_the_job(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    runs, lock = FakeRuns(), FakeLock()
    use_fake_database(monkeypatch, runs, lock)
    calls: list[dict[str, Any]] = []
    _fixture_selection(monkeypatch, calls)
    out = env / "exports"

    result = _invoke("--config", str(env / "unit-dev.toml"), "--out", str(out))

    assert result.exit_code == 0, result.output
    assert lock.keys == ["evaluate-dev:unit-dev"]  # the command and the config name
    assert [status for status, _, _ in runs.finished] == ["succeeded"]
    assert calls == [{"grid": False, "rows": calls[0]["rows"], "summers": [2024, 2025]}]  # 2026 never reached it
    summary = json.loads(result.output.strip().splitlines()[-1])
    assert summary["mode"] == "single"
    assert [d["rule"] for d in summary["decisions"]] == ["6.4 calibration window"]
    assert sorted(summary["exports"]) == ["dev_skill.json", "oof_samples_abu_dhabi.parquet", "selection.json"]
    for name, digest in summary["exports"].items():
        assert hashlib.sha256((out / name).read_bytes()).hexdigest() == digest
    selection = json.loads((out / "selection.json").read_bytes())
    assert selection["provenance"]["git_sha"] == GIT_SHA
    gold_sha = hashlib.sha256((env / "data" / "gold" / "pairs.parquet").read_bytes()).hexdigest()
    assert selection["provenance"]["data_sha256"] == gold_sha  # the manifest's hash, which is the file's
    assert selection["chosen_configuration"]["config_sha256"] == hashlib.sha256(CONFIG_TOML.encode("utf-8")).hexdigest()
    samples = pl.read_parquet(out / "oof_samples_abu_dhabi.parquet")
    assert set(samples["summer"]) == {2024, 2025}
    # the dev rows the command loaded are exactly the 2024-2025 leads 1-3 rows of the gold file
    dev_rows = _gold_frame().filter(pl.col("summer").is_in([2024, 2025]) & (pl.col("lead_days") > 0)).height
    assert calls[0]["rows"] == dev_rows


@pytest.mark.slow
def test_grid_flag_reaches_the_selection_and_the_default_directory_is_under_the_repo_root(
    env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_fake_database(monkeypatch, FakeRuns())
    calls: list[dict[str, Any]] = []
    _fixture_selection(monkeypatch, calls)

    result = _invoke("--config", str(env / "unit-dev.toml"), "--grid")

    assert result.exit_code == 0, result.output
    assert [call["grid"] for call in calls] == [True]
    summary = json.loads(result.output.strip().splitlines()[-1])
    assert summary["mode"] == "grid"
    assert [d["rule"] for d in summary["decisions"]] == [
        "6.1 hyperparameters",
        "6.2 feature set",
        "6.3 wbgt method",
        "6.4 calibration window",
    ]
    default = env / "repo" / "artifacts" / "eval" / "dev"
    assert summary["directory"] == str(default)
    assert (default / "selection.json").is_file()
    selection = json.loads((default / "selection.json").read_bytes())
    assert selection["applied"] is True
    assert selection["grid_scores"]["rows"]
    assert set(selection["inputs"]) >= {"feature_set_site", "feature_set_cold", "wbgt_joint", "wbgt_direct"}


def test_a_changed_gold_file_fails_the_job_before_anything_is_written(
    env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runs = FakeRuns()
    use_fake_database(monkeypatch, runs)
    calls: list[dict[str, Any]] = []
    _fixture_selection(monkeypatch, calls)
    pairs = env / "data" / "gold" / "pairs.parquet"
    pairs.write_bytes(pairs.read_bytes() + b"x")  # the file no longer hashes to its manifest
    out = env / "exports"

    result = _invoke("--config", str(env / "unit-dev.toml"), "--out", str(out))

    assert result.exit_code == 1
    assert [status for status, _, _ in runs.finished] == ["failed"]
    assert "sha256" in str(runs.finished[0][2])
    assert calls == []
    assert not out.exists()


def test_a_missing_manifest_fails_the_job(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    runs = FakeRuns()
    use_fake_database(monkeypatch, runs)
    (env / "data" / "gold" / "manifest.json").unlink()

    result = _invoke("--config", str(env / "unit-dev.toml"), "--out", str(env / "exports"))

    assert result.exit_code == 1
    assert [status for status, _, _ in runs.finished] == ["failed"]
    assert "manifest.json" in str(runs.finished[0][2])


def test_a_locked_run_is_skipped_with_exit_zero_and_writes_nothing(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    runs = FakeRuns()
    use_fake_database(monkeypatch, runs, FakeLock(granted=False))
    calls: list[dict[str, Any]] = []
    _fixture_selection(monkeypatch, calls)

    result = _invoke("--config", str(env / "unit-dev.toml"), "--out", str(env / "exports"))

    assert result.exit_code == 0
    assert runs.skipped
    assert runs.skipped[0][0] == "evaluate-dev"
    assert calls == []
    assert not (env / "exports").exists()


def test_a_bad_config_is_a_usage_error(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    runs = FakeRuns()
    use_fake_database(monkeypatch, runs)
    (env / "bad.toml").write_bytes(CONFIG_TOML.replace('"site"', '"warm"').encode("utf-8"))

    bad = _invoke("--config", str(env / "bad.toml"))
    missing = _invoke("--config", str(env / "nope.toml"))

    assert bad.exit_code == missing.exit_code == 2
    assert runs.finished == []
    assert runs.skipped == []
