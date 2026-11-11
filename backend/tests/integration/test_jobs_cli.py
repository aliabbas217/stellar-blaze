"""The ``sb-jobs`` commands end to end against a real Postgres: files on disk, ``job_run`` rows, the advisory lock.

The commands run ``asyncio.run`` themselves, so these tests are synchronous (a running event loop would refuse it). The
upstream sources are fakes, injected by replacing the ``build_sources`` name that ``jobs.cli`` looks up; production code
never references a fake.
"""

import asyncio
import json
import threading
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import polars as pl
import pytest
from typer.testing import CliRunner, Result

from stellar_blaze.adapters.db.engine import build_engine
from stellar_blaze.adapters.db.job_runs import advisory_lock
from stellar_blaze.adapters.fakes.weather import InMemoryForecastSource
from stellar_blaze.composition import Sources
from stellar_blaze.config import Settings
from stellar_blaze.domain.weather.dataset import GoldManifest
from stellar_blaze.domain.weather.schemas import GOLD_PAIRS_SCHEMA
from stellar_blaze.jobs import cli
from tests.integration.db_admin import fetch_all
from tests.unit.adapters.http_support import json_lines
from tests.unit.jobs.support import SUMMER, FailingObservations, fake_sources

CANARY = "hunter2"  # stands in for a password: it must appear nowhere it should not


@pytest.fixture
def data_dir(tmp_path: Path, settings: Settings, monkeypatch: pytest.MonkeyPatch) -> Path:
    """The environment of a command run: the migrated test database, a private data directory, JSON logs."""
    monkeypatch.setenv("SB_DATABASE_URL", settings.database_url.get_secret_value())
    monkeypatch.setenv("SB_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.setenv("SB_GIT_SHA", "abc1234")
    monkeypatch.chdir(tmp_path)  # a developer's backend/.env is not read
    return tmp_path / "data"


def use_sources(monkeypatch: pytest.MonkeyPatch, build: Callable[[Settings], Sources]) -> None:
    """Make ``jobs.cli`` assemble its sources with ``build`` instead of the composition root's real ones."""
    monkeypatch.setattr(cli, "build_sources", build)


def invoke(*args: str) -> Result:
    return CliRunner().invoke(cli.app, list(args))


def job_runs(settings: Settings) -> list[dict[str, Any]]:
    return fetch_all(
        settings.database_url.get_secret_value(),
        "SELECT job_name, status, params, summary, error, code_version FROM job_run ORDER BY started_at",
    )


def log_events(result: Result) -> list[dict[str, Any]]:
    return json_lines("\n".join(line for line in result.output.splitlines() if line.startswith("{")))


# === ingest-observations ============================================================================================


@pytest.mark.integration
def test_cli_records_job_run(settings: Settings, data_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    use_sources(monkeypatch, lambda _settings: fake_sources())

    result = invoke("ingest-observations", "--source", "iem", "--summer", str(SUMMER), "--station", "OMAA")

    assert result.exit_code == 0, result.output
    silver = data_dir / "silver" / "observations" / "iem" / str(SUMMER)
    assert pl.read_parquet(silver / "OMAA.parquet").height == 24
    assert json.loads((silver / "OMAA.binning.json").read_text(encoding="utf-8"))["n_raw"] == 24
    (run,) = job_runs(settings)
    assert run["job_name"] == "ingest-observations"
    assert run["status"] == "succeeded"
    assert run["params"] == {"source": "iem", "summers": [SUMMER], "stations": ["OMAA"]}
    assert run["code_version"] == "abc1234"
    assert run["summary"]["rows"] == 24
    assert run["error"] is None
    # One line per station-summer carrying the row count and the binning report.
    lines = [line for line in log_events(result) if line["event"] == "ingest.observations"]
    assert [(line["station"], line["summer"], line["rows"], line["n_raw"]) for line in lines] == [
        ("OMAA", SUMMER, 24, 24)
    ]


@contextmanager
def lock_held_elsewhere(settings: Settings, key: str) -> Iterator[None]:
    """Hold the advisory lock ``key`` on another connection, thread and event loop while the block runs."""
    holding, release = threading.Event(), threading.Event()

    def hold_the_lock() -> None:
        async def hold() -> None:
            engine = build_engine(settings)
            try:
                async with advisory_lock(engine, key) as acquired:
                    assert acquired
                    holding.set()
                    await asyncio.to_thread(release.wait, 60)
            finally:
                await engine.dispose()

        asyncio.run(hold())

    with ThreadPoolExecutor(max_workers=1) as pool:
        holder = pool.submit(hold_the_lock)
        assert holding.wait(timeout=30)
        try:
            yield
        finally:
            release.set()
        holder.result(timeout=30)


def statuses(settings: Settings) -> list[tuple[str, str]]:
    return [(run["job_name"], run["status"]) for run in job_runs(settings)]


@pytest.mark.integration
def test_a_second_run_of_the_same_source_while_its_lock_is_held_is_recorded_as_skipped_locked(
    settings: Settings, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_sources(monkeypatch, lambda _settings: fake_sources())

    with lock_held_elsewhere(settings, "ingest-observations:iem"):
        result = invoke("ingest-observations", "--source", "iem", "--summer", str(SUMMER), "--station", "OMAA")

    assert result.exit_code == 0, result.output  # a scheduler overlap is not an error
    assert [event["event"] for event in log_events(result) if "skipped" in event["event"]] == ["job.skipped_locked"]
    assert not (data_dir / "silver").exists()  # the work did not run
    (run,) = job_runs(settings)
    assert (run["job_name"], run["status"]) == ("ingest-observations", "skipped_locked")
    assert run["params"] == {"source": "iem", "summers": [SUMMER], "stations": ["OMAA"]}


@pytest.mark.integration
def test_ingesting_the_other_source_or_another_command_is_not_blocked_by_a_held_lock(
    settings: Settings, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_sources(monkeypatch, lambda _settings: fake_sources())

    with lock_held_elsewhere(settings, "ingest-observations:iem"):
        ghcnh = invoke("ingest-observations", "--source", "ghcnh", "--summer", str(SUMMER), "--station", "OMAA")
        forecasts = invoke("ingest-forecasts", "--model", "gfs_seamless", "--summer", str(SUMMER), "--station", "OMAA")

    assert ghcnh.exit_code == 0, ghcnh.output
    assert forecasts.exit_code == 0, forecasts.output
    assert statuses(settings) == [("ingest-observations", "succeeded"), ("ingest-forecasts", "succeeded")]
    assert (data_dir / "silver" / "observations" / "ghcnh" / str(SUMMER) / "OMAA.parquet").is_file()
    assert not (data_dir / "silver" / "observations" / "iem").exists()


@pytest.mark.integration
def test_forecast_ingests_of_different_models_do_not_block_each_other_but_the_same_model_does(
    settings: Settings, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_sources(monkeypatch, lambda _settings: fake_sources())
    args = ("--summer", str(SUMMER), "--station", "OMAA")

    with lock_held_elsewhere(settings, "ingest-forecasts:gfs_seamless"):
        other_model = invoke("ingest-forecasts", "--model", "ecmwf_ifs025", *args)
        same_model = invoke("ingest-forecasts", "--model", "gfs_seamless", *args)

    assert other_model.exit_code == 0, other_model.output
    assert same_model.exit_code == 0, same_model.output
    runs = job_runs(settings)
    assert [(run["status"], run["params"]["model"]) for run in runs] == [
        ("succeeded", "ecmwf_ifs025"),
        ("skipped_locked", "gfs_seamless"),
    ]
    assert (data_dir / "silver" / "forecasts" / "ecmwf_ifs025" / str(SUMMER) / "OMAA.parquet").is_file()
    assert not (data_dir / "silver" / "forecasts" / "gfs_seamless").exists()


@pytest.mark.integration
def test_a_second_build_dataset_while_one_runs_is_skipped(
    settings: Settings, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with lock_held_elsewhere(settings, "build-dataset"):
        result = invoke("build-dataset")

    assert result.exit_code == 0, result.output
    assert statuses(settings) == [("build-dataset", "skipped_locked")]
    assert not (data_dir / "gold").exists()


@pytest.mark.integration
def test_a_failing_job_is_recorded_failed_and_the_error_holds_no_credentials(
    settings: Settings, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    boom = RuntimeError(f"connect failed for postgresql+asyncpg://sb:{CANARY}@db.example/x (password={CANARY})")
    failing = FailingObservations("iem", boom)
    use_sources(
        monkeypatch,
        lambda _settings: Sources(observations={"iem": failing}, forecasts=InMemoryForecastSource({})),
    )

    result = invoke("ingest-observations", "--source", "iem", "--summer", str(SUMMER), "--station", "OMAA")

    assert result.exit_code == 1
    (run,) = job_runs(settings)
    assert run["status"] == "failed"
    assert run["summary"] is None
    assert run["error"].startswith("RuntimeError: connect failed for postgresql+asyncpg://***@db.example/x")
    assert CANARY not in run["error"]
    assert failing.calls == ["OMAA"]
    assert not (data_dir / "silver").exists()


@pytest.mark.integration
def test_a_failed_run_does_not_leave_the_lock_held(
    settings: Settings, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing = FailingObservations("iem", RuntimeError("down"))
    use_sources(
        monkeypatch, lambda _settings: Sources(observations={"iem": failing}, forecasts=InMemoryForecastSource({}))
    )
    assert invoke("ingest-observations", "--source", "iem", "--summer", str(SUMMER), "--station", "OMAA").exit_code == 1

    use_sources(monkeypatch, lambda _settings: fake_sources())
    again = invoke("ingest-observations", "--source", "iem", "--summer", str(SUMMER), "--station", "OMAA")

    assert again.exit_code == 0, again.output
    assert [run["status"] for run in job_runs(settings)] == ["failed", "succeeded"]


# === ingest-forecasts and build-dataset =============================================================================


@pytest.mark.integration
def test_ingest_forecasts_stores_the_model_and_records_the_run(
    settings: Settings, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_sources(monkeypatch, lambda _settings: fake_sources())

    result = invoke("ingest-forecasts", "--model", "gfs_seamless", "--summer", str(SUMMER), "--station", "OMDB")

    assert result.exit_code == 0, result.output
    stored = pl.read_parquet(data_dir / "silver" / "forecasts" / "gfs_seamless" / str(SUMMER) / "OMDB.parquet")
    assert stored.height == 24 * 8
    (run,) = job_runs(settings)
    assert (run["job_name"], run["status"]) == ("ingest-forecasts", "succeeded")
    assert run["params"] == {"model": "gfs_seamless", "summers": [SUMMER], "stations": ["OMDB"]}
    assert run["summary"]["rows"] == 24 * 8
    lines = [line for line in log_events(result) if line["event"] == "ingest.forecasts"]
    assert [(line["model"], line["station"], line["rows"]) for line in lines] == [("gfs_seamless", "OMDB", 192)]


@pytest.mark.integration
def test_a_model_summer_without_an_archive_is_refused_without_a_job_run(
    settings: Settings, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_sources(monkeypatch, lambda _settings: fake_sources())

    result = invoke("ingest-forecasts", "--model", "ecmwf_aifs025_single", "--summer", "2024")

    assert result.exit_code == 2
    assert job_runs(settings) == []


@pytest.mark.integration
def test_build_dataset_runs_after_the_ingests_and_writes_the_gold_files(
    settings: Settings, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_sources(monkeypatch, lambda _settings: fake_sources())
    station = ("--station", "OMAA", "--station", "OMDB")
    for source in ("iem", "ghcnh"):
        assert invoke("ingest-observations", "--source", source, "--summer", str(SUMMER), *station).exit_code == 0
    for model in ("ecmwf_ifs025", "gfs_seamless"):
        assert invoke("ingest-forecasts", "--model", model, "--summer", str(SUMMER), *station).exit_code == 0

    result = invoke("build-dataset")

    assert result.exit_code == 0, result.output
    pairs = pl.read_parquet(data_dir / "gold" / "pairs.parquet")
    assert pairs.schema == GOLD_PAIRS_SCHEMA
    assert pairs.height == 2 * 2 * 24 * 8
    manifest = GoldManifest.model_validate_json((data_dir / "gold" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest.code_version == "abc1234"  # SB_GIT_SHA
    assert manifest.output.rows == pairs.height
    assert len(manifest.inputs) == 8
    runs = job_runs(settings)
    assert [(run["job_name"], run["status"]) for run in runs] == [
        ("ingest-observations", "succeeded"),
        ("ingest-observations", "succeeded"),
        ("ingest-forecasts", "succeeded"),
        ("ingest-forecasts", "succeeded"),
        ("build-dataset", "succeeded"),
    ]
    assert runs[-1]["summary"]["sha256"] == manifest.output.sha256
    assert runs[-1]["params"] == {}


@pytest.mark.integration
def test_build_dataset_with_nothing_ingested_fails_and_says_what_to_run(
    settings: Settings, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = invoke("build-dataset")

    assert result.exit_code == 1
    (run,) = job_runs(settings)
    assert run["status"] == "failed"
    assert run["error"] == "DatasetInputError: no silver forecasts to build from; run ingest-forecasts first"
    assert not (data_dir / "gold").exists()
