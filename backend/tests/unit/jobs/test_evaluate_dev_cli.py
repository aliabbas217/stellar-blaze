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
from stellar_blaze.jobs import ml_cli, replay_build
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


class FakeGit:
    """A ``GitReader`` with a settable answer to "is the tree clean"; the run never runs git."""

    def __init__(self) -> None:
        self.clean = True

    def is_clean(self) -> bool:
        return self.clean


@pytest.fixture
def git(monkeypatch: pytest.MonkeyPatch) -> FakeGit:
    fake = FakeGit()
    monkeypatch.setattr(ml_cli, "_git_reader", lambda root: fake)
    return fake


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, git: FakeGit) -> Path:
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

    def wrapped(pairs: pl.DataFrame, cfg: Any, sha: str, *, grid: bool, **kwargs: Any) -> Any:
        preflights: list[Any] = []
        call_preflight = kwargs["preflight"]

        def counted(oof: Any, used: Any) -> None:
            preflights.append(used)
            call_preflight(oof, used)  # the real preflight: it must build the export from the first LOCO output

        calls.append(
            {
                "grid": grid,
                "rows": pairs.height,
                "summers": sorted(pairs["summer"].unique().to_list()),
                "calibration_targets": kwargs["calibration_targets"],
                "preflights": preflights,
            }
        )
        return real(
            pairs,
            cfg,
            sha,
            grid=grid,
            clusters=CLUSTERS,
            grid_points=TINY_GRID[:2],
            n_boot=20,
            calibration_targets=kwargs["calibration_targets"],
            preflight=counted,
        )

    monkeypatch.setattr(selection, "run_dev_selection", wrapped)


def _invoke(*arguments: str) -> Any:
    return CliRunner().invoke(app, ["evaluate-dev", *arguments])


def test_help_lists_the_command_and_its_options() -> None:
    top = CliRunner().invoke(app, ["--help"])
    command = CliRunner().invoke(app, ["evaluate-dev", "--help"])

    assert top.exit_code == command.exit_code == 0
    assert "evaluate-dev" in top.output
    for option in ("--config", "--grid", "--out", "--calibration-targets", "--allow-dirty"):
        assert option in command.output


@pytest.mark.parametrize(
    ("config", "grid", "out", "targets", "dirty", "expected"),
    [
        (
            "backend/training/configs/dev.toml",
            False,
            None,
            "all",
            False,
            "sb-jobs evaluate-dev --config backend/training/configs/dev.toml --calibration-targets all",
        ),
        (
            "backend/training/configs/dev.toml",
            True,
            None,
            "wbgt",
            False,
            "sb-jobs evaluate-dev --config backend/training/configs/dev.toml --grid --calibration-targets wbgt",
        ),
        (
            "a b.toml",
            True,
            "out dir",
            "all",
            True,
            "sb-jobs evaluate-dev --config 'a b.toml' --grid --calibration-targets all --allow-dirty --out 'out dir'",
        ),
    ],
)
def test_the_recorded_command_is_built_from_the_real_arguments(
    tmp_path: Path, config: str, grid: bool, out: str | None, targets: str, dirty: bool, expected: str
) -> None:
    command = ml_cli.evaluate_dev_invocation(
        tmp_path / config,
        grid=grid,
        out_dir=None if out is None else tmp_path / out,
        root=tmp_path,
        calibration_targets=ml_cli.CalibrationTargets(targets),
        allow_dirty=dirty,
    )

    assert command == expected
    assert str(tmp_path) not in command  # never an absolute local path


def test_a_path_outside_the_repository_is_recorded_by_its_file_name_only(tmp_path: Path) -> None:
    outside = tmp_path / "elsewhere" / "private-dir" / "dev.toml"

    command = ml_cli.evaluate_dev_invocation(outside, grid=False, out_dir=outside.parent, root=tmp_path / "repo")

    assert command == "sb-jobs evaluate-dev --config dev.toml --calibration-targets all --out private-dir"


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
    from stellar_blaze.ml import exporters

    real_preflight = exporters.preflight_dev_exports
    exports_checked: list[str] = []

    def preflight(oof: Any, pairs: pl.DataFrame, cfg: Any) -> None:
        exports_checked.append(cfg.name)
        real_preflight(oof, pairs, cfg)

    monkeypatch.setattr(exporters, "preflight_dev_exports", preflight)

    result = _invoke("--config", str(env / "unit-dev.toml"), "--out", str(out))

    assert result.exit_code == 0, result.output
    assert exports_checked == ["unit-dev"]  # the real export preflight ran, once, on the config's first LOCO output
    assert lock.keys == ["evaluate-dev:unit-dev"]  # the command and the config name
    assert [status for status, _, _ in runs.finished] == ["succeeded"]
    assert [call["summers"] for call in calls] == [[2024, 2025]]  # 2026 never reached it
    assert [call["grid"] for call in calls] == [False]
    assert calls[0]["calibration_targets"] == "all"  # the default reading (amendment 2)
    assert len(calls[0]["preflights"]) == 1  # the export was built once from the first LOCO output
    summary = json.loads(result.output.strip().splitlines()[-1])
    assert summary["mode"] == "single"
    assert [d["rule"] for d in summary["decisions"]] == ["6.4 calibration window"]
    assert sorted(summary["exports"]) == [
        "dev_skill.json",
        "oof_samples_abu_dhabi.manifest.json",
        "oof_samples_abu_dhabi.parquet",
        "selection.json",
    ]
    for name, digest in summary["exports"].items():
        assert hashlib.sha256((out / name).read_bytes()).hexdigest() == digest
    manifest = json.loads((out / "oof_samples_abu_dhabi.manifest.json").read_bytes())
    assert manifest["command"] == "sb-jobs evaluate-dev --config unit-dev.toml --calibration-targets all --out exports"
    assert str(env) not in manifest["command"]  # outside the repository: the file name, never a local path
    assert manifest["git_sha"] == GIT_SHA
    assert manifest["git_clean"] is True
    assert manifest["sha256"] == summary["exports"]["oof_samples_abu_dhabi.parquet"]
    selection = json.loads((out / "selection.json").read_bytes())
    assert selection["provenance"]["git_sha"] == GIT_SHA
    gold_sha = hashlib.sha256((env / "data" / "gold" / "pairs.parquet").read_bytes()).hexdigest()
    assert selection["provenance"]["data_sha256"] == gold_sha  # the manifest's hash, which is the file's
    chosen = selection["chosen_configuration"]
    assert chosen["config_fingerprint"] == hashlib.sha256(CONFIG_TOML.encode("utf-8")).hexdigest()
    assert chosen["fingerprint_of"] == "toml_file"
    assert (selection["git_clean"], selection["allow_dirty"], selection["calibration_targets"]) == (True, False, "all")
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
    assert len(calls[0]["preflights"]) == 1  # once, at the first LOCO output (the site run), not at the last step
    assert calls[0]["preflights"][0].feature_set.value == "site"
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
    manifest = json.loads((default / "oof_samples_abu_dhabi.manifest.json").read_bytes())
    assert manifest["command"] == "sb-jobs evaluate-dev --config unit-dev.toml --grid --calibration-targets all"
    chosen = selection["chosen_configuration"]
    assert (
        chosen["fingerprint_of"] == "derived_configuration"
    )  # grid mode: no file, a fingerprint of the derived config
    assert chosen["name"] == "unit-dev-selected"
    assert len(chosen["config_fingerprint"]) == 64
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


# === a dirty tree, the calibration reading and the recorded command =================================================


def test_a_dirty_grid_run_is_refused_with_exit_two_and_nothing_is_run(
    env: Path, monkeypatch: pytest.MonkeyPatch, git: FakeGit
) -> None:
    runs = FakeRuns()
    use_fake_database(monkeypatch, runs)
    calls: list[dict[str, Any]] = []
    _fixture_selection(monkeypatch, calls)
    git.clean = False
    out = env / "exports"

    result = _invoke("--config", str(env / "unit-dev.toml"), "--grid", "--out", str(out))

    assert result.exit_code == 2
    assert "not clean" in result.output  # the reason, on stderr (CliRunner mixes the streams)
    assert "--allow-dirty" in result.output
    assert calls == []
    assert runs.finished == []
    assert runs.skipped == []  # no job row, no lock
    assert not out.exists()


@pytest.mark.slow
def test_allow_dirty_runs_a_grid_and_records_it(env: Path, monkeypatch: pytest.MonkeyPatch, git: FakeGit) -> None:
    use_fake_database(monkeypatch, FakeRuns())
    calls: list[dict[str, Any]] = []
    _fixture_selection(monkeypatch, calls)
    git.clean = False
    out = env / "exports"

    result = _invoke("--config", str(env / "unit-dev.toml"), "--grid", "--allow-dirty", "--out", str(out))

    assert result.exit_code == 0, result.output
    selection = json.loads((out / "selection.json").read_bytes())
    manifest = json.loads((out / "oof_samples_abu_dhabi.manifest.json").read_bytes())
    assert (selection["git_clean"], selection["allow_dirty"]) == (False, True)
    assert manifest["git_clean"] is False
    assert manifest["command"] == (
        "sb-jobs evaluate-dev --config unit-dev.toml --grid --calibration-targets all --allow-dirty --out exports"
    )


@pytest.mark.slow
def test_a_dirty_single_run_is_allowed_and_recorded_as_dirty(
    env: Path, monkeypatch: pytest.MonkeyPatch, git: FakeGit
) -> None:
    use_fake_database(monkeypatch, FakeRuns())
    _fixture_selection(monkeypatch, [])
    git.clean = False
    out = env / "exports"

    result = _invoke("--config", str(env / "unit-dev.toml"), "--out", str(out))

    assert result.exit_code == 0, result.output  # only a --grid run is refused
    selection = json.loads((out / "selection.json").read_bytes())
    assert (selection["git_clean"], selection["allow_dirty"]) == (False, False)


@pytest.mark.slow
def test_the_calibration_targets_option_reaches_the_selection_and_the_record(
    env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_fake_database(monkeypatch, FakeRuns())
    calls: list[dict[str, Any]] = []
    _fixture_selection(monkeypatch, calls)
    out = env / "exports"

    result = _invoke("--config", str(env / "unit-dev.toml"), "--calibration-targets", "wbgt", "--out", str(out))

    assert result.exit_code == 0, result.output
    assert calls[0]["calibration_targets"] == "wbgt"
    selection = json.loads((out / "selection.json").read_bytes())
    assert selection["calibration_targets"] == "wbgt"
    assert selection["decisions"][0]["evidence"]["deciding_targets"] == 1.0
    manifest = json.loads((out / "oof_samples_abu_dhabi.manifest.json").read_bytes())
    assert "--calibration-targets wbgt" in manifest["command"]


def test_an_unknown_calibration_reading_is_a_usage_error(env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    runs = FakeRuns()
    use_fake_database(monkeypatch, runs)

    result = _invoke("--config", str(env / "unit-dev.toml"), "--calibration-targets", "t")

    assert result.exit_code == 2
    assert runs.finished == []


@pytest.mark.slow
def test_a_config_inside_the_repository_is_recorded_repository_relative(
    env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_fake_database(monkeypatch, FakeRuns())
    _fixture_selection(monkeypatch, [])
    configs = env / "repo" / "backend" / "training" / "configs"
    configs.mkdir(parents=True)
    (configs / "unit-dev.toml").write_bytes(CONFIG_TOML.encode("utf-8"))
    out = env / "repo" / "artifacts" / "eval" / "dev"

    result = _invoke("--config", str(configs / "unit-dev.toml"), "--out", str(out))

    assert result.exit_code == 0, result.output
    manifest = json.loads((out / "oof_samples_abu_dhabi.manifest.json").read_bytes())
    assert manifest["command"] == (
        "sb-jobs evaluate-dev --config backend/training/configs/unit-dev.toml --calibration-targets all "
        "--out artifacts/eval/dev"
    )
