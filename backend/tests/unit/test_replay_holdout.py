"""The 2026 summer in replay snapshots.

Since the architect's go-ahead of 2026-11-15 (approved by Ali the same day) ``REPLAY_LOCKED_SUMMERS`` is empty: a 2026
snapshot inside its declared window is built, validated and served. What this file still proves:

* the replay lock is live: re-locked (by patching the constant where each of the three checkpoints reads it), the
  builder (``jobs.replay_build``), the manifest model (``ReplaySnapshot``) and both replay sources refuse a locked year
  again;
* rows outside the manifest's declared window are refused, whatever year they are in;
* the MODEL hold-out is untouched: ``HELD_OUT_SUMMERS`` is still exactly 2026 and is still the ML test summer (the model
  loader's own tests are in ``test_model_holdout.py``).

Data is the synthetic generator's; nothing here reads the gold file or any real 2026 data.
"""

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import polars as pl
import pytest
from pydantic import ValidationError
from typer.testing import CliRunner

from stellar_blaze.adapters.sources import replay as replay_sources
from stellar_blaze.adapters.sources.replay import ReplayForecastSource, ReplayObservationSource, ReplaySnapshotError
from stellar_blaze.adapters.storage.parquet_store import ParquetStore
from stellar_blaze.domain.weather import replay as replay_domain
from stellar_blaze.domain.weather.models import NwpModel, summer_window
from stellar_blaze.domain.weather.replay import (
    FORECASTS_FILE,
    HELD_OUT_SUMMERS,
    MANIFEST_FILE,
    OBSERVATIONS_FILE,
    REPLAY_LOCKED_SUMMERS,
    ReplayFile,
    ReplaySnapshot,
    files_digest,
)
from stellar_blaze.jobs import replay_build
from stellar_blaze.jobs.cli import app
from stellar_blaze.jobs.replay_build import ReplayHoldoutError, build_replay_snapshot
from stellar_blaze.ml.data import TEST_SUMMER
from tests.fixtures.forecast.replay import (
    FIXTURE_STATIONS,
    GIT_SHA,
    SNAPSHOT_ID,
    SUMMER,
    build_fixture_snapshot,
    seed_silver,
    synthetic_pairs,
)
from tests.fixtures.forecast.synthetic import forecasts_of, observations_of

pytestmark = pytest.mark.unit

REPLAY_DIR = Path(__file__).resolve().parents[2] / "replay"
DATABASE_URL = "postgresql+asyncpg://sb:hunter2@localhost:5432/stellar_blaze"
IN_2026 = datetime(2026, 7, 1, 12, tzinfo=UTC)
LOCKED_2026 = frozenset({2026})
SUMMER_2026 = 2026


def scan_snapshot(directory: Path, locked: frozenset[int] = REPLAY_LOCKED_SUMMERS) -> list[str]:
    """What is wrong with the snapshot at ``directory``, as a list of findings; empty when it is consistent.

    Consistent means: the manifest window is exactly one summer's window (15 May 00:00 to 30 Sep 23:00 UTC), no row of
    either file is outside it, and no row is in a year of ``locked``. Reads the files directly (not through the replay
    sources), so it is an independent check of them.
    """
    findings: list[str] = []
    manifest = json.loads((directory / MANIFEST_FILE).read_bytes())
    start = datetime.fromisoformat(manifest["start"]).astimezone(UTC)
    end = datetime.fromisoformat(manifest["end"]).astimezone(UTC)
    if (start, end) != summer_window(start.year):
        findings.append(
            f"{directory.name}/{MANIFEST_FILE}: the window {start.isoformat()} to {end.isoformat()} is not a summer"
        )
    for name in (FORECASTS_FILE, OBSERVATIONS_FILE):
        frame = pl.read_parquet(directory / name)
        outside = frame.filter((pl.col("valid_time") < start) | (pl.col("valid_time") > end)).height
        if outside:
            findings.append(f"{directory.name}/{name}: {outside} rows outside the manifest window")
        for year in sorted(set(frame["valid_time"].dt.year().unique().to_list()) & locked):
            findings.append(f"{directory.name}/{name}: holds rows of locked year {year}")
    return findings


def inject_row(directory: Path, file: str, moment: datetime) -> None:
    """Append one row stamped ``moment`` to the Parquet ``file`` and rewrite ``snapshot.json`` so every hash matches.

    This is the careful tamperer: the hash check and the provenance digest both pass, so only the row checks can refuse.
    """
    frame = pl.read_parquet(directory / file)
    stamp = pl.lit(moment).cast(pl.Datetime("us", "UTC")).alias("valid_time")
    frame = pl.concat([frame, frame.head(1).with_columns(stamp)])
    (directory / file).write_bytes(replay_build._parquet_bytes(frame))  # noqa: SLF001 (same bytes the builder writes)
    manifest: dict[str, Any] = json.loads((directory / MANIFEST_FILE).read_bytes())
    for entry in manifest["files"]:
        if entry["path"] == file:
            entry["sha256"] = hashlib.sha256((directory / file).read_bytes()).hexdigest()
    manifest["provenance"]["data_sha256"] = files_digest([ReplayFile(**entry) for entry in manifest["files"]])
    (directory / MANIFEST_FILE).write_bytes(json.dumps(manifest, indent=2).encode() + b"\n")


@pytest.fixture
def snapshot_dir(tmp_path: Path) -> Path:
    return build_fixture_snapshot(tmp_path).directory


@pytest.fixture
def snapshot_dir_2026(tmp_path: Path) -> Path:
    """A synthetic snapshot of the 2026 summer (built through the real builder, now that replay is unlocked)."""
    return build_fixture_snapshot(tmp_path, summer=SUMMER_2026).directory


def relock(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lock 2026 again at every place the replay side reads the constant (each checkpoint is patched on its own)."""
    monkeypatch.setattr(replay_domain, "REPLAY_LOCKED_SUMMERS", LOCKED_2026)
    monkeypatch.setattr(replay_build, "REPLAY_LOCKED_SUMMERS", LOCKED_2026)
    monkeypatch.setattr(replay_sources, "REPLAY_LOCKED_SUMMERS", LOCKED_2026)


# --- the repository's own snapshots ---------------------------------------------------------------------------------


def test_every_committed_snapshot_is_consistent() -> None:
    """Scans every ``backend/replay/<id>/``: one summer's window, no row outside it, no row of a locked year.

    ``test_the_scanner_is_live`` proves the scanner itself works, so an empty directory is not the only way to pass.
    """
    findings = [finding for directory in sorted(REPLAY_DIR.glob("*/")) for finding in scan_snapshot(directory)]

    assert findings == []


def test_the_scanner_is_live(snapshot_dir: Path) -> None:
    """The scan above is not vacuous by construction: it passes a clean snapshot and fails injected rows."""
    assert scan_snapshot(snapshot_dir) == []

    inject_row(snapshot_dir, FORECASTS_FILE, datetime(SUMMER, 10, 1, 0, tzinfo=UTC))  # 1 October: after the window
    inject_row(snapshot_dir, OBSERVATIONS_FILE, datetime(SUMMER, 5, 14, 23, tzinfo=UTC))  # 14 May: before it

    assert scan_snapshot(snapshot_dir) == [
        f"{SNAPSHOT_ID}/{FORECASTS_FILE}: 1 rows outside the manifest window",
        f"{SNAPSHOT_ID}/{OBSERVATIONS_FILE}: 1 rows outside the manifest window",
    ]


def test_the_scanner_finds_a_locked_year(snapshot_dir_2026: Path) -> None:
    """With 2026 locked the same scan names the year: the locked-year branch of the scanner is live too."""
    assert scan_snapshot(snapshot_dir_2026) == []

    assert scan_snapshot(snapshot_dir_2026, locked=LOCKED_2026) == [
        f"fixture-2026/{FORECASTS_FILE}: holds rows of locked year 2026",
        f"fixture-2026/{OBSERVATIONS_FILE}: holds rows of locked year 2026",
    ]


# --- the two constants ----------------------------------------------------------------------------------------------


def test_the_model_hold_out_is_still_exactly_2026() -> None:
    """``HELD_OUT_SUMMERS`` is the model loader's guard and stays: no model may carry 2026."""
    assert frozenset({2026}) == HELD_OUT_SUMMERS


def test_the_model_hold_out_is_the_ml_test_summer() -> None:
    """The ML split's test summer and the model hold-out are one fact: they must move together."""
    assert TEST_SUMMER in HELD_OUT_SUMMERS
    assert frozenset({TEST_SUMMER}) == HELD_OUT_SUMMERS


def test_the_replay_lock_is_open_by_the_architects_go_ahead() -> None:
    """The architect's go-ahead of 2026-11-15 (approved by Ali): replay may hold 2026; a re-lock shows in review."""
    assert frozenset() == REPLAY_LOCKED_SUMMERS
    assert REPLAY_LOCKED_SUMMERS is not HELD_OUT_SUMMERS


# --- the sources and the manifest -----------------------------------------------------------------------------------


def test_a_2026_snapshot_inside_its_declared_window_is_accepted_by_the_model_and_both_sources(
    snapshot_dir_2026: Path,
) -> None:
    manifest = json.loads((snapshot_dir_2026 / MANIFEST_FILE).read_bytes())
    assert manifest["start"].startswith("2026-05-15")
    assert manifest["end"].startswith("2026-09-30")

    ReplaySnapshot.model_validate(manifest)
    ReplayForecastSource(snapshot_dir_2026)
    ReplayObservationSource(snapshot_dir_2026)


@pytest.mark.parametrize("source_class", [ReplayForecastSource, ReplayObservationSource])
@pytest.mark.parametrize("file", [FORECASTS_FILE, OBSERVATIONS_FILE])
def test_a_2026_row_outside_a_2025_window_is_refused_by_both_sources(
    snapshot_dir: Path, source_class: type[ReplayForecastSource | ReplayObservationSource], file: str
) -> None:
    """One 2026 row in a 2025 snapshot, hashes and provenance digest rewritten to match, stops either source."""
    inject_row(snapshot_dir, file, IN_2026)

    with pytest.raises(ReplaySnapshotError, match="outside the manifest's window"):
        source_class(snapshot_dir)


@pytest.mark.parametrize("summer", [SUMMER, SUMMER_2026])
def test_a_row_outside_the_manifest_window_is_refused_in_any_year(tmp_path: Path, summer: int) -> None:
    directory = build_fixture_snapshot(tmp_path, summer=summer).directory
    inject_row(directory, FORECASTS_FILE, datetime(summer, 10, 1, 0, tzinfo=UTC))  # 1 October: after 30 September

    with pytest.raises(ReplaySnapshotError, match="outside the manifest's window"):
        ReplayForecastSource(directory)


@pytest.mark.parametrize("source_class", [ReplayForecastSource, ReplayObservationSource])
def test_relocked_2026_stops_both_sources(
    snapshot_dir_2026: Path,
    source_class: type[ReplayForecastSource | ReplayObservationSource],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The sources' own checkpoint is live: only their constant is patched, the manifest model still accepts it."""
    monkeypatch.setattr(replay_sources, "REPLAY_LOCKED_SUMMERS", LOCKED_2026)

    with pytest.raises(ReplaySnapshotError, match="locked year"):
        source_class(snapshot_dir_2026)


def make_manifest(snapshot_dir: Path, **changes: Any) -> dict[str, Any]:
    manifest: dict[str, Any] = json.loads((snapshot_dir / MANIFEST_FILE).read_bytes())
    return manifest | changes


_WINDOWS_TOUCHING_2026 = [
    pytest.param({"end": "2026-09-30T23:00:00Z"}, id="end-in-2026"),
    pytest.param({"start": "2026-05-15T00:00:00Z", "end": "2026-09-30T23:00:00Z"}, id="window-in-2026"),
    pytest.param(
        {"start": "2025-12-31T23:00:00-05:00", "end": "2025-12-31T23:30:00-05:00"},
        id="2026-in-utc-though-2025-on-the-wall",
    ),
    pytest.param({"start": "2025-05-15T00:00:00Z", "end": "2027-01-01T00:00:00Z"}, id="2026-strictly-inside"),
]


@pytest.mark.parametrize("changes", _WINDOWS_TOUCHING_2026)
def test_a_manifest_window_in_2026_is_accepted_by_the_model(snapshot_dir: Path, changes: dict[str, str]) -> None:
    ReplaySnapshot.model_validate(make_manifest(snapshot_dir, **changes))


@pytest.mark.parametrize("changes", _WINDOWS_TOUCHING_2026)
def test_relocked_2026_refuses_a_manifest_window_that_touches_it(
    snapshot_dir: Path, changes: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The manifest model's own checkpoint is live: every year of the window is looked at, not only the endpoints."""
    monkeypatch.setattr(replay_domain, "REPLAY_LOCKED_SUMMERS", LOCKED_2026)

    with pytest.raises(ValidationError, match="locked"):
        ReplaySnapshot.model_validate(make_manifest(snapshot_dir, **changes))


def test_a_manifest_window_inside_an_allowed_year_is_accepted_by_the_model(snapshot_dir: Path) -> None:
    """The counterpart of the refusals: the same start, an end still in 2025."""
    manifest = make_manifest(snapshot_dir, start="2025-05-15T00:00:00Z", end="2025-12-31T23:00:00Z")

    ReplaySnapshot.model_validate(manifest)


def test_a_manifest_window_that_ends_before_it_starts_is_refused_by_the_model(snapshot_dir: Path) -> None:
    manifest = make_manifest(snapshot_dir, start="2026-09-30T23:00:00Z", end="2026-05-15T00:00:00Z")

    with pytest.raises(ValidationError, match="before start"):
        ReplaySnapshot.model_validate(manifest)


def test_a_manifest_window_that_excludes_the_rows_stops_both_sources(snapshot_dir: Path) -> None:
    """The window the manifest declares is what is served: an end before the last row refuses the snapshot."""
    (snapshot_dir / MANIFEST_FILE).write_bytes(
        json.dumps(make_manifest(snapshot_dir, end="2025-07-10T23:00:00Z")).encode()
    )

    for source_class in (ReplayForecastSource, ReplayObservationSource):
        with pytest.raises(ReplaySnapshotError, match="outside the manifest's window"):
            source_class(snapshot_dir)


def test_a_provenance_digest_that_contradicts_the_files_is_refused(snapshot_dir: Path) -> None:
    manifest = make_manifest(snapshot_dir)
    manifest["provenance"]["data_sha256"] = "0" * 64

    with pytest.raises(ValidationError, match="data_sha256"):
        ReplaySnapshot.model_validate(manifest)


def test_the_untouched_fixture_is_accepted_by_the_model_and_both_sources(snapshot_dir: Path) -> None:
    """The refusals above are the injected defect, not the fixture."""
    ReplaySnapshot.model_validate(make_manifest(snapshot_dir))
    ReplayForecastSource(snapshot_dir)
    ReplayObservationSource(snapshot_dir)


# --- the builder ----------------------------------------------------------------------------------------------------


class SpyStore(ParquetStore):
    """A store that records every read, so a test can prove none happened."""

    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.reads: list[str] = []

    def read_forecasts(self) -> pl.DataFrame:
        self.reads.append("forecasts")
        return super().read_forecasts()

    def read_observations(self, source: str) -> pl.DataFrame:
        self.reads.append("observations")
        return super().read_observations(source)


def build(store: ParquetStore, replay_dir: Path, summer: int) -> None:
    build_replay_snapshot(
        store=store,
        replay_dir=replay_dir,
        summer=summer,
        stations=list(FIXTURE_STATIONS),
        snapshot_id=f"fixture-{summer}",
        git_sha=GIT_SHA,
    )


def test_summer_2026_builds_from_silver_that_holds_it(tmp_path: Path) -> None:
    seed_silver(tmp_path, summer=SUMMER_2026)
    spy = SpyStore(tmp_path)

    build(spy, tmp_path / "replay", SUMMER_2026)

    assert sorted(spy.reads) == ["forecasts", "observations"]
    directory = tmp_path / "replay" / "fixture-2026"
    manifest = json.loads((directory / MANIFEST_FILE).read_bytes())
    assert manifest["start"].startswith("2026-05-15")
    assert manifest["end"].startswith("2026-09-30")
    assert scan_snapshot(directory) == []
    ReplayForecastSource(directory)
    ReplayObservationSource(directory)


def test_a_relocked_summer_is_refused_before_anything_is_read_or_written(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed_silver(tmp_path, summer=SUMMER_2026)
    spy = SpyStore(tmp_path)
    relock(monkeypatch)

    with pytest.raises(ReplayHoldoutError, match=r"2026.*architect"):
        build(spy, tmp_path / "replay", SUMMER_2026)

    assert spy.reads == []  # the silver reader was never called
    assert not (tmp_path / "replay").exists()


def test_the_holdout_error_is_a_value_error() -> None:
    assert issubclass(ReplayHoldoutError, ValueError)


def test_summer_2025_still_builds(tmp_path: Path) -> None:
    spy = SpyStore(tmp_path)
    seed_silver(tmp_path)

    build(spy, tmp_path / "replay", SUMMER)

    assert sorted(spy.reads) == ["forecasts", "observations"]
    assert (tmp_path / "replay" / SNAPSHOT_ID / "snapshot.json").is_file()


def stamp_stray_2026_rows(root: Path) -> ParquetStore:
    """Silver whose 2025 files each hold one extra row stamped 2026 (forecasts of OMAA/IFS, truth of OMAA)."""
    pairs = synthetic_pairs()
    store = seed_silver(root, pairs)
    ifs = forecasts_of(pairs, "ecmwf_ifs025").filter(pl.col("station") == "OMAA")
    truth = observations_of(pairs).filter(pl.col("station") == "OMAA")
    stamp = pl.lit(IN_2026).cast(pl.Datetime("us", "UTC")).alias("valid_time")
    store.write_forecasts(NwpModel.ECMWF_IFS025, SUMMER, "OMAA", pl.concat([ifs, ifs.head(1).with_columns(stamp)]))
    store.write_observations("iem", SUMMER, "OMAA", pl.concat([truth, truth.head(1).with_columns(stamp)]))
    return store


def test_a_stray_row_of_another_summer_in_silver_is_left_out_by_the_real_window(tmp_path: Path) -> None:
    """Real silver holds several summers; building 2025 from it must work and must not carry a 2026 row along."""
    build_fixture_snapshot(tmp_path, store=stamp_stray_2026_rows(tmp_path))

    assert scan_snapshot(tmp_path / "replay" / SNAPSHOT_ID) == []


def test_a_bad_window_that_lets_a_locked_year_through_fails_closed_and_leaves_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Defence in depth: with 2026 locked and a window computation that reaches into it, the row check still refuses."""
    store = stamp_stray_2026_rows(tmp_path)
    monkeypatch.setattr(
        replay_build,
        "summer_window",
        lambda year: (datetime(year, 5, 15, tzinfo=UTC), datetime(year + 1, 9, 30, 23, tzinfo=UTC)),
    )
    monkeypatch.setattr(replay_build, "REPLAY_LOCKED_SUMMERS", LOCKED_2026)

    with pytest.raises(ReplayHoldoutError, match="hold rows of locked"):
        build(store, tmp_path / "replay", SUMMER)

    assert not (tmp_path / "replay").exists()  # no directory, no staging directory


def cli_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> list[Path]:
    """Point the CLI at ``tmp_path``; the returned list records every call of ``git_head`` (stubbed)."""
    git_calls: list[Path] = []
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.setenv("SB_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SB_REPLAY_DIR", str(tmp_path / "replay"))

    def recording_git_head(root: Path) -> str:
        git_calls.append(root)
        return GIT_SHA

    monkeypatch.setattr(replay_build, "git_head", recording_git_head)
    return git_calls


def test_the_cli_builds_2026_now_that_replay_is_unlocked(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_silver(tmp_path / "data", summer=SUMMER_2026)
    git_calls = cli_environment(tmp_path, monkeypatch)

    result = CliRunner().invoke(
        app,
        ["replay", "build", "--summer", "2026", "--station", "OMAA", "--station", "OMDB", "--snapshot-id", "demo-2026"],
    )

    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["snapshot_id"] == "demo-2026"
    assert git_calls == [replay_build.repo_root()]
    assert scan_snapshot(tmp_path / "replay" / "demo-2026") == []


def test_the_cli_exits_2_for_a_relocked_summer_and_touches_neither_git_nor_the_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    git_calls = cli_environment(tmp_path, monkeypatch)
    relock(monkeypatch)

    result = CliRunner().invoke(
        app, ["replay", "build", "--summer", "2026", "--station", "OMAA", "--snapshot-id", "demo-2026"]
    )

    assert result.exit_code == 2
    assert "2026" in result.output
    assert "architect" in result.output
    assert git_calls == []
    assert not (tmp_path / "replay").exists()
