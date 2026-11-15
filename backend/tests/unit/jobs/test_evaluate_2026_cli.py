"""``sb-jobs evaluate-2026``: the gate first, the outputs after, nothing real (synthetic gold, fake git, fake database).

The gold file is a tiny synthetic one under ``tmp_path`` (never the real file); the repository is a fake tree where
every check of section 9 holds (``tests/fixtures/forecast/gated.py``) and ``SubprocessGit`` in the job module is
replaced by one fake, which keeps the job's call sites inline. Most tests replace the scoring itself with a fast
stand-in (it is tested in ``tests/unit/ml/test_forecast_test.py``); one runs the real ``evaluate_forecast_test``.
"""

import hashlib
import json
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path
from typing import Any, Final

import polars as pl
import pytest
from typer.testing import CliRunner

from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.jobs import evaluate_2026, replay_build
from stellar_blaze.jobs.cli import app
from stellar_blaze.ml import forecast_test
from stellar_blaze.ml.data import load_test_pairs
from stellar_blaze.ml.exporters import SKILL_ANCHOR, github_slug, render_json
from stellar_blaze.ml.forecast_test import ForecastTestResult
from tests.fixtures.forecast.dev_run import CLUSTERS, STATIONS
from tests.fixtures.forecast.gated import (
    DEV_EDGES,
    HEAD,
    FakeGit,
    GatedWorld,
    gold_with_lead_zero,
    released,
    with_aifs,
)
from tests.unit.jobs.support import FakeLock, FakeRuns, use_fake_database

pytestmark = pytest.mark.unit

DATABASE_URL: Final = "postgresql+asyncpg://sb:hunter2@localhost:5432/stellar_blaze"
_SCORING: Final = forecast_test.evaluate_forecast_test  # the real scoring, before any fixture replaces it
AIFS: Final = NwpModel.ECMWF_AIFS025.value
_REAL_WRITE: Final = evaluate_2026.write_bytes_exclusive
_REAL_RENDER: Final = render_json
_REAL_RENAME: Final = Path.rename
OUTPUTS: Final = (
    "forecast_skill.json",
    "reliability.json",
    "corrected_series_OMAA.parquet",
    "corrected_series_OMAA.manifest.json",
    "run_meta.json",
)


@dataclass
class Env:
    root: Path
    world: GatedWorld
    gold_path: Path
    gold_sha256: str
    runs: FakeRuns
    lock: FakeLock
    loads: list[dict[str, Any]]
    evaluations: list[dict[str, Any]]

    @property
    def results(self) -> Path:
        return self.world.results_dir

    @property
    def git(self) -> FakeGit:
        return self.world.git


def _canned(**kwargs: Any) -> ForecastTestResult:
    """A fast stand-in for the scoring: small JSON tables and a two-row series."""
    edges = list(kwargs["dev_tercile_edges"])
    return ForecastTestResult(
        skill={"part": "forecast", "tercile_edges": edges, "model_id": kwargs["model"].manifest.model_id},
        reliability={"tercile_edges": edges},
        series=pl.DataFrame({"station": ["OMAA", "OMAA"], "lead_days": [1, 2]}),
    )


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Env:
    """``SB_*`` environment, a synthetic gold file pinned by a fake lock, the fake database and a fast scoring."""
    monkeypatch.chdir(tmp_path)  # a developer's backend/.env must not reach the test
    data = tmp_path / "data"
    (data / "gold").mkdir(parents=True)
    gold_path = data / "gold" / "pairs.parquet"
    with_aifs(gold_with_lead_zero()).write_parquet(gold_path)
    gold_sha256 = hashlib.sha256(gold_path.read_bytes()).hexdigest()
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.setenv("SB_DATA_DIR", str(data))
    monkeypatch.setenv("SB_MODELS_DIR", str(released().models_dir))
    world = GatedWorld(tmp_path, released().model.manifest.model_id, released().models_dir, gold_sha256=gold_sha256)
    monkeypatch.setattr(replay_build, "repo_root", lambda: world.repo_root)
    monkeypatch.setattr(evaluate_2026, "EXPECTED_CLUSTERS", CLUSTERS)  # the synthetic world has three clusters ...
    monkeypatch.setattr(evaluate_2026, "EXPECTED_STATIONS", STATIONS)  # ... and three stations, not six and eight
    monkeypatch.setattr(evaluate_2026, "SubprocessGit", lambda root: world.git)  # the call sites stay inline
    runs, lock = FakeRuns(), FakeLock()
    use_fake_database(monkeypatch, runs, lock)

    loads: list[dict[str, Any]] = []

    def spy_load(path: Path, **kwargs: Any) -> pl.DataFrame:
        loads.append({"path": path, **kwargs})
        frame: pl.DataFrame = load_test_pairs(path, **kwargs)
        return frame

    monkeypatch.setattr("stellar_blaze.jobs.evaluate_2026.load_test_pairs", spy_load)
    evaluations: list[dict[str, Any]] = []

    def fast(pairs: pl.DataFrame, **kwargs: Any) -> ForecastTestResult:
        evaluations.append({"models": set(pairs["model"].unique()), "summers": set(pairs["summer"].unique()), **kwargs})
        return _canned(**kwargs)

    monkeypatch.setattr(forecast_test, "evaluate_forecast_test", fast)
    return Env(tmp_path, world, gold_path, gold_sha256, runs, lock, loads, evaluations)


def invoke(*arguments: str) -> Any:
    return CliRunner().invoke(app, ["evaluate-2026", *arguments])


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_bytes())  # type: ignore[no-any-return]


# === help and usage =================================================================================================


def test_help_lists_the_command_and_its_options() -> None:
    top = CliRunner().invoke(app, ["--help"])
    command = invoke("--help")

    assert top.exit_code == command.exit_code == 0
    assert "evaluate-2026" in top.output
    for word in ("--part", "--amendment", "forecast", "warnings", "plans", "all"):
        assert word in command.output


def test_the_part_is_required_and_must_be_known() -> None:
    assert invoke().exit_code == 2
    assert invoke("--part", "everything").exit_code == 2


@pytest.mark.parametrize("part", ["warnings", "plans"])
def test_the_b3_parts_open_the_gate_first_and_fail_on_missing_frozen_inputs_before_the_gold_is_read(
    env: Env, part: str
) -> None:
    # Task 13 added the parts: the synthetic world has the freeze keys and the go marker but no theta.json, ruleset
    # directory or fixture under the repository, so the part fails (exit 1) after the gate and before any gold read.
    result = invoke("--part", part)

    assert result.exit_code == 1
    assert env.git.calls  # the gate was opened first
    assert [status for status, _, _ in env.runs.finished] == ["failed"]
    assert env.loads == []  # the gold file was never opened
    assert not env.results.exists()  # and nothing was written


def test_the_invocation_is_built_from_the_real_arguments() -> None:
    assert evaluate_2026.evaluate_2026_invocation("forecast", None) == "sb-jobs evaluate-2026 --part forecast"
    assert (
        evaluate_2026.evaluate_2026_invocation("forecast", "A 1")
        == "sb-jobs evaluate-2026 --part forecast --amendment 'A 1'"
    )


# === the gate refuses: every reason, no data touched ===============================================================


def _no_go_marker(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    env.world.go_path.unlink()


def _no_lock(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    env.world.lock_path.unlink()


def _no_model(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    empty = env.root / "empty-models"
    empty.mkdir()
    monkeypatch.setenv("SB_MODELS_DIR", str(empty))


def _dirty_tree(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    env.git.clean = False


def _go_for_another_model(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    text = env.world.go_path.read_text(encoding="utf-8")
    env.world.go_path.write_text(
        text.replace(env.world.model_id, "corrector-20261113-0000000-000009"), encoding="utf-8"
    )


@pytest.mark.parametrize(
    ("code", "mutate"),
    [
        ("go-missing", _no_go_marker),
        ("lock-missing", _no_lock),
        ("model-not-found", _no_model),
        ("tree-dirty", _dirty_tree),
        ("go-mismatch", _go_for_another_model),
    ],
)
def test_command_refuses_without_go_marker_lock_or_model(
    env: Env, monkeypatch: pytest.MonkeyPatch, code: str, mutate: Callable[[Env, pytest.MonkeyPatch], None]
) -> None:
    mutate(env, monkeypatch)

    result = invoke("--part", "forecast")

    assert result.exit_code == 2
    assert f"{code}: " in result.stderr
    assert "the 2026 gate is closed" in result.stderr
    assert env.loads == []
    assert env.evaluations == []  # the gold file was never opened
    assert not env.results.exists()
    assert env.runs.finished == []  # the refusal is before the job: no job_run row, no lock
    assert env.runs.skipped == []
    assert env.lock.keys == []


def test_a_refusal_lists_every_reason_not_the_first(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    _no_go_marker(env, monkeypatch)
    _dirty_tree(env, monkeypatch)
    _no_model(env, monkeypatch)

    result = invoke("--part", "forecast")

    assert result.exit_code == 2
    for code in ("tree-dirty", "model-not-found", "go-missing"):
        assert f"{code}: " in result.stderr
    assert env.loads == []


def test_all_runs_the_parts_in_order_and_stops_at_the_first_that_fails(env: Env) -> None:
    result = invoke("--part", "all")

    # forecast first (it succeeds on the synthetic world), then warnings, which fails on the missing frozen inputs.
    assert result.exit_code == 1, result.output
    assert "implemented in B3" not in result.stderr
    assert (env.results / "forecast_skill.json").is_file()
    assert not (env.results / "policy_scoreboard.json").exists()
    assert [call["part"].value for call in env.loads] == ["forecast"]
    assert [status for status, _, _ in env.runs.finished] == ["succeeded", "failed"]


# === a run ==========================================================================================================


def test_a_run_writes_every_output_with_provenance_and_records_the_job(env: Env) -> None:
    result = invoke("--part", "forecast")

    assert result.exit_code == 0, result.output
    assert env.lock.keys == ["evaluate-2026:forecast"]
    assert [status for status, _, _ in env.runs.finished] == ["succeeded"]
    assert sorted(path.name for path in env.results.iterdir()) == sorted(OUTPUTS)
    model_id = env.world.model_id
    slug = "#" + github_slug('7.4 Demo day ("day zoom") selection rule')
    for name in ("forecast_skill.json", "reliability.json", "corrected_series_OMAA.manifest.json", "run_meta.json"):
        provenance = read_json(env.results / name)["provenance"]
        assert provenance["model_id"] == model_id, name
        assert provenance["git_sha"] == HEAD, name  # the token's head
        assert provenance["data_sha256"] == env.gold_sha256, name
        assert provenance["label"] == "REAL", name
        assert provenance["protocol_path"] == "docs/research/2026-11-12-preregistration-2026-evaluation.md"
    assert read_json(env.results / "forecast_skill.json")["provenance"]["protocol_anchor"] == SKILL_ANCHOR
    assert read_json(env.results / "reliability.json")["provenance"]["protocol_anchor"] == SKILL_ANCHOR
    assert read_json(env.results / "corrected_series_OMAA.manifest.json")["provenance"]["protocol_anchor"] == slug
    parquet = pl.read_parquet_metadata(env.results / "corrected_series_OMAA.parquet")
    assert json.loads(parquet["provenance"])["model_id"] == model_id  # the parquet carries it in its metadata
    manifest = read_json(env.results / "corrected_series_OMAA.manifest.json")
    assert (
        manifest["sha256"] == hashlib.sha256((env.results / "corrected_series_OMAA.parquet").read_bytes()).hexdigest()
    )
    assert manifest["rows"] == 2
    assert manifest["command"] == "sb-jobs evaluate-2026 --part forecast"
    assert manifest["git_sha"] == HEAD
    meta = read_json(env.results / "run_meta.json")
    assert meta["head"] == HEAD
    assert meta["model_id"] == model_id
    assert meta["gold_sha256"] == env.gold_sha256
    assert (
        meta["protocol_sha256"]
        == hashlib.sha256((env.world.repo_root / "docs/research/protocol.md").read_bytes()).hexdigest()
    )
    assert meta["amendment"] is None
    assert meta["regime_b_all"] == "not run"
    assert meta["files"].keys() == set(OUTPUTS) - {"run_meta.json"}
    summary = json.loads(result.stdout.strip().splitlines()[-1])
    for name, digest in summary["files"].items():
        assert hashlib.sha256((env.results / name).read_bytes()).hexdigest() == digest


def test_the_gold_file_is_loaded_after_the_gate_with_the_locks_hash_and_the_aifs_models(env: Env) -> None:
    assert invoke("--part", "forecast").exit_code == 0

    assert len(env.loads) == 1
    load = env.loads[0]
    assert load["path"] == env.gold_path
    assert load["expected_sha256"] == env.gold_sha256
    assert load["models"] == {"ecmwf_ifs025", "gfs_seamless", "ecmwf_aifs025_single"}
    evaluation = env.evaluations[0]
    assert evaluation["summers"] == {2024, 2025, 2026}
    assert evaluation["models"] == {"ecmwf_ifs025", "gfs_seamless", "ecmwf_aifs025_single"}
    assert evaluation["token"].head == HEAD
    assert evaluation["model"].manifest.model_id == env.world.model_id
    assert evaluation["cold_cfg"].feature_set.value == "cold"
    assert evaluation["series_station"] == "OMAA"


def test_the_job_overrides_no_scoring_setting_so_the_preregistered_defaults_rule(env: Env) -> None:
    """``n_boot`` (2,000), the clusters (all six) and the series station default inside ``evaluate_forecast_test``."""
    assert invoke("--part", "forecast").exit_code == 0

    passed = set(env.evaluations[0]) - {"models", "summers"}
    assert passed == {"model", "cold_cfg", "token", "dev_tercile_edges", "series_station"}  # no n_boot, no clusters


def test_the_dev_tercile_edges_used_are_the_ones_in_the_committed_dev_skill_file(env: Env) -> None:
    env.world.write_dev_skill((1.5, 2.5))

    assert invoke("--part", "forecast").exit_code == 0

    assert env.evaluations[0]["dev_tercile_edges"] == (1.5, 2.5) != DEV_EDGES
    assert read_json(env.results / "forecast_skill.json")["tercile_edges"] == [1.5, 2.5]
    meta = read_json(env.results / "run_meta.json")
    assert meta["tercile_edges"] == [1.5, 2.5]
    assert meta["dev_skill_sha256"] == hashlib.sha256(env.world.dev_skill_path.read_bytes()).hexdigest()


@pytest.mark.parametrize(
    "document",
    [
        b"not json",
        b'{"skill": {}}',
        b'{"tercile_edges": [3.0, 2.0]}',
        b'{"tercile_edges": [1.0]}',
        b'{"tercile_edges": "ab"}',
    ],
)
def test_unusable_dev_edges_fail_the_job_before_the_gold_file_is_read(env: Env, document: bytes) -> None:
    env.world.dev_skill_path.write_bytes(document)

    result = invoke("--part", "forecast")

    assert result.exit_code == 1
    assert [status for status, _, _ in env.runs.finished] == ["failed"]
    assert env.loads == []
    assert env.evaluations == []
    assert not env.results.exists()


def test_a_gold_file_that_is_not_the_locked_one_fails_the_job_and_writes_nothing(env: Env) -> None:
    env.gold_path.write_bytes(env.gold_path.read_bytes() + b"x")

    result = invoke("--part", "forecast")

    assert result.exit_code == 1
    assert [status for status, _, _ in env.runs.finished] == ["failed"]
    assert "gold_sha256" in str(env.runs.finished[0][2])
    assert env.evaluations == []
    assert not env.results.exists()


def test_a_locked_run_is_skipped_with_exit_one_and_a_message_and_writes_nothing(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A skipped once-only run did not score anything: success (0) would let a script believe the result exists."""
    use_fake_database(monkeypatch, env.runs, FakeLock(granted=False))

    result = invoke("--part", "forecast")

    assert result.exit_code == 1
    assert "another run holds the lock" in result.stderr
    assert "nothing was scored or written" in result.stderr
    assert env.runs.skipped
    assert env.runs.skipped[0][0] == "evaluate-2026:forecast"
    assert env.loads == []
    assert env.evaluations == []
    assert not env.results.exists()


# === once, amendments, exclusive create, recheck ===================================================================


def test_a_second_run_of_a_part_is_refused_by_the_gate_and_changes_nothing(env: Env) -> None:
    assert invoke("--part", "forecast").exit_code == 0
    before = {name: (env.results / name).read_bytes() for name in OUTPUTS}

    again = invoke("--part", "forecast")

    assert again.exit_code == 2
    assert "result-exists: " in again.stderr
    assert {name: (env.results / name).read_bytes() for name in OUTPUTS} == before
    assert len(env.evaluations) == 1


def test_an_amendment_keeps_the_first_output_beside_the_new_one(env: Env) -> None:
    assert invoke("--part", "forecast").exit_code == 0
    first = {name: (env.results / name).read_bytes() for name in OUTPUTS}

    second = invoke("--part", "forecast", "--amendment", "amendment-1")

    assert second.exit_code == 0, second.output
    assert (env.results / "forecast_skill.run1.json").read_bytes() == first["forecast_skill.json"]
    assert (env.results / "reliability.run1.json").read_bytes() == first["reliability.json"]
    assert (env.results / "corrected_series_OMAA.run1.parquet").read_bytes() == first["corrected_series_OMAA.parquet"]
    assert (env.results / "corrected_series_OMAA.manifest.run1.json").read_bytes() == first[
        "corrected_series_OMAA.manifest.json"
    ]
    assert (env.results / "run_meta.run1.json").read_bytes() == first["run_meta.json"]
    assert read_json(env.results / "run_meta.json")["amendment"] == "amendment-1"
    assert read_json(env.results / "run_meta.run1.json")["amendment"] is None
    assert (
        read_json(env.results / "run_meta.json")["command"]
        == "sb-jobs evaluate-2026 --part forecast --amendment amendment-1"
    )
    assert len(env.evaluations) == 2

    third = invoke(
        "--part", "forecast", "--amendment", "amendment-2"
    )  # the current output becomes run2; run1 stays the first
    assert third.exit_code == 0
    assert (env.results / "forecast_skill.run1.json").read_bytes() == first["forecast_skill.json"]
    assert read_json(env.results / "run_meta.run2.json")["amendment"] == "amendment-1"
    assert read_json(env.results / "run_meta.json")["amendment"] == "amendment-2"


def test_an_output_in_the_way_fails_the_job_before_any_scoring_or_writing(env: Env) -> None:
    env.results.mkdir(parents=True)
    (env.results / "reliability.json").write_bytes(b"{}")  # the gate only looks at forecast_skill.json

    result = invoke("--part", "forecast")

    assert result.exit_code == 1
    assert [status for status, _, _ in env.runs.finished] == ["failed"]
    assert "reliability.json" in str(env.runs.finished[0][2])
    assert env.evaluations == []
    assert sorted(path.name for path in env.results.iterdir()) == ["reliability.json"]
    assert (env.results / "reliability.json").read_bytes() == b"{}"


def test_a_result_that_appears_during_the_run_is_never_overwritten(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    """Exclusive create: a second run that raced past the once-only check fails instead of replacing the file."""

    def racing(pairs: pl.DataFrame, **kwargs: Any) -> ForecastTestResult:
        env.results.mkdir(parents=True, exist_ok=True)
        (env.results / "forecast_skill.json").write_bytes(b"the other run's result")
        return _canned(**kwargs)

    monkeypatch.setattr(forecast_test, "evaluate_forecast_test", racing)

    result = invoke("--part", "forecast")

    assert result.exit_code == 1
    assert "FileExistsError" in str(env.runs.finished[0][2])
    assert (env.results / "forecast_skill.json").read_bytes() == b"the other run's result"
    assert sorted(path.name for path in env.results.iterdir()) == ["forecast_skill.json"]


def test_exclusive_writing_refuses_an_existing_file_and_leaves_it(tmp_path: Path) -> None:
    path = tmp_path / "x.bin"
    assert evaluate_2026.write_bytes_exclusive(path, b"one") == hashlib.sha256(b"one").hexdigest()
    with pytest.raises(FileExistsError):
        evaluate_2026.write_bytes_exclusive(path, b"two")
    assert path.read_bytes() == b"one"


def test_a_failed_write_leaves_no_partial_file_behind(tmp_path: Path) -> None:
    path = tmp_path / "out" / "x.bin"
    with pytest.raises(TypeError):
        evaluate_2026.write_bytes_exclusive(path, "not bytes")  # type: ignore[arg-type]  # fails after the file is made
    assert not path.exists()
    assert evaluate_2026.write_bytes_exclusive(path, b"fine") == hashlib.sha256(b"fine").hexdigest()


def _tree(root: Path) -> dict[str, bytes | None]:
    """Every file (its bytes) and directory (``None``) under ``root``: what a failed run must leave unchanged."""
    return {
        path.relative_to(root).as_posix(): path.read_bytes() if path.is_file() else None
        for path in sorted(root.rglob("*"))
    }


def _fail_on_call(monkeypatch: pytest.MonkeyPatch, target: object, name: str, number: int) -> None:
    """Make the ``number``-th call of ``target.name`` raise ``OSError`` (the other calls are the real ones)."""
    real = getattr(target, name)
    calls = 0

    def failing(*args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        if calls == number:
            raise OSError(f"injected failure in call {number} of {name}")
        return real(*args, **kwargs)

    monkeypatch.setattr(target, name, failing)


_FAILURES: Final = [
    *[("render", number) for number in range(1, 5)],  # skill, reliability, manifest, run_meta (in the order rendered)
    ("series", 1),
    *[("write", number) for number in range(1, 6)],  # the five outputs, run_meta last
]
_AMENDMENT_ONLY_FAILURES: Final = [("archive", number) for number in (1, 3, 5)]


def _inject(monkeypatch: pytest.MonkeyPatch, step: str, number: int) -> None:
    targets = {
        "render": (evaluate_2026, "render_json"),
        "series": (evaluate_2026, "series_parquet_bytes"),
        "write": (evaluate_2026, "write_bytes_exclusive"),
        "archive": (Path, "rename"),
    }
    _fail_on_call(monkeypatch, *targets[step], number)


@pytest.mark.parametrize(("step", "number"), _FAILURES, ids=[f"{s}-{n}" for s, n in _FAILURES])
def test_a_failed_first_run_leaves_the_repository_as_it_was_and_needs_no_amendment(
    env: Env, monkeypatch: pytest.MonkeyPatch, step: str, number: int
) -> None:
    before = _tree(env.world.repo_root)
    with monkeypatch.context() as injected:
        _inject(injected, step, number)
        failed = invoke("--part", "forecast")

    assert failed.exit_code == 1
    assert "injected failure" in str(env.runs.finished[-1][2])
    assert _tree(env.world.repo_root) == before  # no partial output, no directory the run made
    assert invoke("--part", "forecast").exit_code == 0  # the retry is a first run again: no result-exists, no amendment
    assert sorted(path.name for path in env.results.iterdir()) == sorted(OUTPUTS)


@pytest.mark.parametrize(
    ("step", "number"),
    [*_FAILURES, *_AMENDMENT_ONLY_FAILURES],
    ids=[f"{s}-{n}" for s, n in [*_FAILURES, *_AMENDMENT_ONLY_FAILURES]],
)
def test_a_failed_amendment_run_restores_the_first_run_exactly(
    env: Env, monkeypatch: pytest.MonkeyPatch, step: str, number: int
) -> None:
    assert invoke("--part", "forecast").exit_code == 0
    before = _tree(env.world.repo_root)
    with monkeypatch.context() as injected:
        _inject(injected, step, number)
        failed = invoke("--part", "forecast", "--amendment", "amendment-1")

    assert failed.exit_code == 1
    assert "injected failure" in str(env.runs.finished[-1][2])
    assert _tree(env.world.repo_root) == before  # the first run is where it was: nothing moved to *.run1.*
    retried = invoke("--part", "forecast", "--amendment", "amendment-1")
    assert retried.exit_code == 0, retried.output
    assert (env.results / "forecast_skill.run1.json").read_bytes() == before["artifacts/eval/2026/forecast_skill.json"]


def test_every_output_is_rendered_before_the_gate_is_rechecked_and_before_any_file_exists(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    events: list[str] = []

    def rendering(*args: Any, **kwargs: Any) -> bytes:
        events.append("render" if not env.git.calls else "render-after-recheck")
        return _REAL_RENDER(*args, **kwargs)

    def scoring(pairs: pl.DataFrame, **kwargs: Any) -> ForecastTestResult:
        env.git.calls.clear()
        return _canned(**kwargs)

    monkeypatch.setattr(forecast_test, "evaluate_forecast_test", scoring)
    monkeypatch.setattr(evaluate_2026, "render_json", rendering)
    assert invoke("--part", "forecast").exit_code == 0
    assert events == ["render"] * 4  # skill, reliability, manifest, run_meta: all before the recheck touched git


@pytest.mark.parametrize(
    ("move", "code"),
    [
        (lambda git: setattr(git, "head_id", "d" * 40), "head-changed"),
        (lambda git: setattr(git, "clean", False), "tree-dirty"),
    ],
)
def test_the_gate_is_rechecked_before_writing_and_a_moved_head_or_dirty_tree_writes_nothing(
    env: Env, monkeypatch: pytest.MonkeyPatch, move: Callable[[FakeGit], None], code: str
) -> None:
    def moving(pairs: pl.DataFrame, **kwargs: Any) -> ForecastTestResult:
        move(env.git)  # between the gate and the write
        return _canned(**kwargs)

    monkeypatch.setattr(forecast_test, "evaluate_forecast_test", moving)

    result = invoke("--part", "forecast")

    assert result.exit_code == 2
    assert f"{code}: " in result.stderr
    assert not env.results.exists() or not any(env.results.iterdir())  # nothing was written
    assert [status for status, _, _ in env.runs.finished] == ["failed"]


def test_the_recheck_comes_after_the_scoring_and_before_the_first_write(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    events: list[str] = []

    def scoring(pairs: pl.DataFrame, **kwargs: Any) -> ForecastTestResult:
        events.append("scored")
        env.git.calls.clear()
        return _canned(**kwargs)

    def writing(path: Path, data: bytes) -> str:
        events.append("recheck" if env.git.calls else "write-without-recheck")
        env.git.calls.clear()
        return _REAL_WRITE(path, data)

    monkeypatch.setattr(forecast_test, "evaluate_forecast_test", scoring)
    monkeypatch.setattr(evaluate_2026, "write_bytes_exclusive", writing)

    assert invoke("--part", "forecast").exit_code == 0

    assert events[:2] == ["scored", "recheck"]


# === a frame that cannot be scored fails before any computation ===================================================


def _repin_without_2026_rows(env: Env, *, station: str) -> None:
    """Rewrite the gold file without the 2026 rows of ``station`` and pin the lock to the new file."""
    frame = pl.read_parquet(env.gold_path)
    frame.filter(~((pl.col("summer") == 2026) & (pl.col("station") == station))).write_parquet(env.gold_path)
    env.world.write_lock(hashlib.sha256(env.gold_path.read_bytes()).hexdigest())


def test_a_station_without_2026_rows_fails_before_any_scoring_and_names_it(env: Env) -> None:
    _repin_without_2026_rows(env, station="OMFJ")

    result = invoke("--part", "forecast")

    assert result.exit_code == 1
    assert [status for status, _, _ in env.runs.finished] == ["failed"]
    message = str(env.runs.finished[0][2])
    assert "OMFJ" in message
    assert "fujairah" in message  # the cluster went with its only station
    assert "nothing was computed" in message
    assert len(env.loads) == 1  # the file was read once ...
    assert env.evaluations == []  # ... and nothing was scored
    assert not env.results.exists()  # and nothing was written
    assert invoke("--part", "forecast").exit_code == 1  # a failed precheck is not a result: no amendment is needed


def test_the_coverage_check_names_every_missing_item_of_the_real_clusters_and_stations() -> None:
    pairs = with_aifs(gold_with_lead_zero()).filter(pl.col("model") != AIFS)
    with pytest.raises(ValueError, match="cannot be scored completely") as refused:
        forecast_test.check_test_coverage(
            pairs,
            clusters=evaluate_2026.EXPECTED_CLUSTERS,
            stations=evaluate_2026.EXPECTED_STATIONS,
            models={NwpModel.ECMWF_IFS025.value, NwpModel.GFS_SEAMLESS.value, AIFS},
        )
    message = str(refused.value)
    assert len(evaluate_2026.EXPECTED_CLUSTERS) == 6
    assert len(evaluate_2026.EXPECTED_STATIONS) == 8
    for item in ("al_ain", "al_maktoum", "ras_al_khaimah", "OMAD", "OMAL", "OMDW", "OMRK", "OMSJ", AIFS):
        assert item in message
    for present in ("abu_dhabi", "dubai_sharjah", "fujairah", "OMAA", "OMDB", "OMFJ"):
        assert present not in message
    forecast_test.check_test_coverage(pairs, clusters=CLUSTERS, stations=STATIONS, models={"ecmwf_ifs025"})  # complete


# === --amendment names one of the lock's amendments ================================================================


@pytest.mark.parametrize("amendment", ["A1", "amendment-3", "amendment-0", "Amendment-1", "amendment-01", "1"])
def test_an_amendment_that_the_lock_does_not_have_is_refused_before_anything_runs(env: Env, amendment: str) -> None:
    result = invoke("--part", "forecast", "--amendment", amendment)

    assert result.exit_code == 2
    assert "amendment-id-unknown" in result.stderr
    assert "amendment-1, amendment-2" in result.stderr  # the valid ids are named
    assert env.loads == []
    assert env.runs.finished == []
    assert not env.results.exists()


def test_the_amendment_ids_follow_the_order_of_the_locks_amendments() -> None:
    assert evaluate_2026.amendment_ids(0) == ()
    assert evaluate_2026.amendment_ids(3) == ("amendment-1", "amendment-2", "amendment-3")


# === the provenance of the environment, and where the directories are read ==========================================


def test_run_meta_records_the_dependency_lock_and_the_versions_that_scored(env: Env) -> None:
    assert invoke("--part", "forecast").exit_code == 0

    meta = read_json(env.results / "run_meta.json")
    uv_lock = env.world.repo_root / "backend" / "uv.lock"
    assert meta["uv_lock_sha256"] == hashlib.sha256(uv_lock.read_bytes()).hexdigest()
    assert meta["versions"] == {name: version(name) for name in ("lightgbm", "polars", "numpy", "scipy")}
    assert all(isinstance(value, str) and value for value in meta["versions"].values())


def test_uv_lock_is_hashed_with_crlf_read_as_lf(env: Env) -> None:
    uv_lock = env.world.repo_root / "backend" / "uv.lock"
    uv_lock.write_bytes(b"version = 1\r\nrevision = 2\r\n")

    assert invoke("--part", "forecast").exit_code == 0

    assert (
        read_json(env.results / "run_meta.json")["uv_lock_sha256"]
        == hashlib.sha256(b"version = 1\nrevision = 2\n").hexdigest()
    )


def test_a_missing_models_directory_is_refused_before_the_gate_reads_anything(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SB_MODELS_DIR", "no-such-models")  # relative: read against <repository>/backend, not the cwd

    result = invoke("--part", "forecast")

    assert result.exit_code == 2
    assert "does not exist" in result.stderr
    assert str(env.world.repo_root / "backend" / "no-such-models") in result.stderr
    assert env.git.calls == []  # the gate never opened
    assert env.runs.finished == []


def test_relative_models_and_data_directories_are_read_against_the_repository_backend_not_the_cwd(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    backend = env.world.repo_root / "backend"
    shutil.copytree(released().models_dir, backend / "models")
    shutil.copytree(env.root / "data", backend / "data")
    monkeypatch.setenv("SB_MODELS_DIR", "models")
    monkeypatch.setenv("SB_DATA_DIR", "data")
    elsewhere = env.root / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)  # no models/ or data/ here

    result = invoke("--part", "forecast")

    assert result.exit_code == 0, result.output
    assert env.loads[0]["path"] == backend / "data" / "gold" / "pairs.parquet"


# === the dev edges file, the gitignore and a real end-to-end run ===================================================


@pytest.mark.parametrize("edges", [[27.0, 30.0], [27, 30], [-1.5, 0.25]])
def test_read_dev_tercile_edges_reads_two_ascending_numbers(tmp_path: Path, edges: list[float]) -> None:
    path = tmp_path / "dev_skill.json"
    path.write_bytes(json.dumps({"tercile_edges": edges, "provenance": {}}).encode())
    assert evaluate_2026.read_dev_tercile_edges(path) == (float(edges[0]), float(edges[1]))


@pytest.mark.parametrize("edges", [[1.0, 1.0], [2.0, 1.0], [True, 5.0], [1.0, None], [1.0, 2.0, 3.0], "x", None])
def test_read_dev_tercile_edges_refuses_anything_else(tmp_path: Path, edges: object) -> None:
    path = tmp_path / "dev_skill.json"
    path.write_bytes(json.dumps({"tercile_edges": edges}).encode())
    with pytest.raises(ValueError, match="tercile_edges"):
        evaluate_2026.read_dev_tercile_edges(path)


def test_the_2026_series_parquet_is_not_committed_but_its_manifest_is() -> None:
    gitignore = (Path(__file__).resolve().parents[4] / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "artifacts/eval/2026/*.parquet" in gitignore
    assert not any(
        line.strip() in {"artifacts/", "artifacts/eval/2026/", "artifacts/eval/2026/*.json"} for line in gitignore
    )


@pytest.mark.slow
def test_a_real_run_end_to_end_on_the_synthetic_world(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    """The real scoring behind the command: load through the gate, score both regimes, write and read back."""

    def real_small(pairs: pl.DataFrame, **kwargs: Any) -> ForecastTestResult:
        return _SCORING(pairs, clusters=CLUSTERS, n_boot=20, **kwargs)

    monkeypatch.setattr(forecast_test, "evaluate_forecast_test", real_small)

    result = invoke("--part", "forecast")

    assert result.exit_code == 0, result.output
    skill = read_json(env.results / "forecast_skill.json")
    assert set(skill["regimes"]) == {"a", "c", "b_all"}
    assert skill["regimes"]["b_all"] == "not run"
    assert skill["model_id"] == env.world.model_id
    assert skill["provenance"]["model_id"] == env.world.model_id
    series = pl.read_parquet(env.results / "corrected_series_OMAA.parquet")
    assert set(series["station"]) == {"OMAA"}
    assert set(series["summer"]) == {2026}
    assert read_json(env.results / "reliability.json")["regimes"]["a"]["quoted_bin"]["bin_lo"] == 0.65
