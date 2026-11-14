"""The 2026 hold-out in replay snapshots: no snapshot holds a 2026 row until the architect records "2026 go".

Enforced in three places, each tested here so that injecting a 2026 row fails: the builder (``jobs.replay_build``), the
manifest model (``ReplaySnapshot``) and both replay sources. They share one constant, ``HELD_OUT_SUMMERS``
(``domain.weather.replay``). Data is the synthetic generator's; nothing here reads the gold file or any real 2026 data.
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

from stellar_blaze.adapters.sources.replay import ReplayForecastSource, ReplayObservationSource, ReplaySnapshotError
from stellar_blaze.adapters.storage.parquet_store import ParquetStore
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.replay import (
    FORECASTS_FILE,
    HELD_OUT_SUMMERS,
    MANIFEST_FILE,
    OBSERVATIONS_FILE,
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


def scan_snapshot(directory: Path) -> list[str]:
    """What is wrong with the snapshot at ``directory``, as a list of findings; empty when it holds nothing held out.

    Reads the files directly (not through the replay sources), so it is an independent check of them.
    """
    findings: list[str] = []
    manifest = json.loads((directory / MANIFEST_FILE).read_bytes())
    for key in ("start", "end"):
        year = datetime.fromisoformat(manifest[key]).astimezone(UTC).year
        if year in HELD_OUT_SUMMERS:
            findings.append(f"{directory.name}/{MANIFEST_FILE}: {key} is in held-out year {year}")
    for name in (FORECASTS_FILE, OBSERVATIONS_FILE):
        years = set(pl.read_parquet(directory / name)["valid_time"].dt.year().unique().to_list())
        for year in sorted(years & HELD_OUT_SUMMERS):
            findings.append(f"{directory.name}/{name}: holds rows of held-out year {year}")
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


# --- the repository's own snapshots ---------------------------------------------------------------------------------


def test_no_committed_snapshot_holds_a_held_out_year() -> None:
    """Scans every ``backend/replay/<id>/``. Today the directory holds only ``.gitkeep``, so this passes vacuously.

    It starts to bite with the first committed snapshot; ``test_the_scanner_is_live`` proves the scanner itself works.
    """
    findings = [finding for directory in sorted(REPLAY_DIR.glob("*/")) for finding in scan_snapshot(directory)]

    assert findings == []


def test_the_scanner_is_live(snapshot_dir: Path) -> None:
    """The scan above is not vacuous by construction: it passes a clean snapshot and fails an injected row."""
    assert scan_snapshot(snapshot_dir) == []

    inject_row(snapshot_dir, FORECASTS_FILE, IN_2026)
    inject_row(snapshot_dir, OBSERVATIONS_FILE, IN_2026)

    assert scan_snapshot(snapshot_dir) == [
        f"{SNAPSHOT_ID}/{FORECASTS_FILE}: holds rows of held-out year 2026",
        f"{SNAPSHOT_ID}/{OBSERVATIONS_FILE}: holds rows of held-out year 2026",
    ]


def test_the_held_out_years_are_exactly_2026() -> None:
    assert frozenset({2026}) == HELD_OUT_SUMMERS  # a change here is the deliberate unlock, and shows in review


def test_the_replay_hold_out_is_the_ml_test_summer() -> None:
    """The ML split's test summer and the replay hold-out are one fact: they must move together."""
    assert TEST_SUMMER in HELD_OUT_SUMMERS
    assert frozenset({TEST_SUMMER}) == HELD_OUT_SUMMERS


# --- the sources and the manifest -----------------------------------------------------------------------------------


@pytest.mark.parametrize("source_class", [ReplayForecastSource, ReplayObservationSource])
@pytest.mark.parametrize("file", [FORECASTS_FILE, OBSERVATIONS_FILE])
def test_a_2026_row_with_matching_hashes_is_refused_by_both_sources(
    snapshot_dir: Path, source_class: type[ReplayForecastSource | ReplayObservationSource], file: str
) -> None:
    """One 2026 row in either file, hashes and provenance digest rewritten to match, stops either source."""
    inject_row(snapshot_dir, file, IN_2026)

    with pytest.raises(ReplaySnapshotError, match="held-out"):
        source_class(snapshot_dir)


def test_a_row_outside_the_manifest_window_is_refused_even_in_an_allowed_year(snapshot_dir: Path) -> None:
    inject_row(snapshot_dir, FORECASTS_FILE, datetime(SUMMER, 10, 1, 0, tzinfo=UTC))  # 1 October: after 30 September

    with pytest.raises(ReplaySnapshotError, match="outside the manifest's window"):
        ReplayForecastSource(snapshot_dir)


def make_manifest(snapshot_dir: Path, **changes: Any) -> dict[str, Any]:
    manifest: dict[str, Any] = json.loads((snapshot_dir / MANIFEST_FILE).read_bytes())
    return manifest | changes


@pytest.mark.parametrize(
    ("changes", "fragment"),
    [
        pytest.param({"end": "2026-09-30T23:00:00Z"}, "held-out", id="end-in-2026"),
        pytest.param({"start": "2026-05-15T00:00:00Z", "end": "2026-09-30T23:00:00Z"}, "held-out", id="window-in-2026"),
        pytest.param(
            {"start": "2025-12-31T23:00:00-05:00", "end": "2025-12-31T23:30:00-05:00"},
            "held-out",
            id="2026-in-utc-though-2025-on-the-wall",
        ),
        pytest.param(
            {"start": "2025-05-15T00:00:00Z", "end": "2027-01-01T00:00:00Z"}, "held-out", id="2026-strictly-inside"
        ),
    ],
)
def test_a_manifest_window_in_a_held_out_year_is_refused_by_the_model(
    snapshot_dir: Path, changes: dict[str, str], fragment: str
) -> None:
    manifest = make_manifest(snapshot_dir, **changes)

    with pytest.raises(ValidationError, match=fragment):
        ReplaySnapshot.model_validate(manifest)


def test_a_manifest_window_inside_an_allowed_year_is_accepted_by_the_model(snapshot_dir: Path) -> None:
    """The counterpart of the refusals: the same start, an end still in 2025."""
    manifest = make_manifest(snapshot_dir, start="2025-05-15T00:00:00Z", end="2025-12-31T23:00:00Z")

    ReplaySnapshot.model_validate(manifest)


def test_a_manifest_end_in_2026_stops_both_sources(snapshot_dir: Path) -> None:
    (snapshot_dir / MANIFEST_FILE).write_bytes(
        json.dumps(make_manifest(snapshot_dir, end="2026-09-30T23:00:00Z")).encode()
    )

    for source_class in (ReplayForecastSource, ReplayObservationSource):
        with pytest.raises(ReplaySnapshotError, match="held-out"):
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
        snapshot_id=SNAPSHOT_ID,
        git_sha=GIT_SHA,
    )


def test_summer_2026_is_refused_before_anything_is_read_or_written(tmp_path: Path) -> None:
    seed_silver(tmp_path)
    spy = SpyStore(tmp_path)

    with pytest.raises(ReplayHoldoutError, match=r"2026.*architect"):
        build(spy, tmp_path / "replay", 2026)

    assert spy.reads == []  # the silver reader was never called
    assert not (tmp_path / "replay").exists()


def test_the_holdout_error_is_a_value_error() -> None:
    assert issubclass(ReplayHoldoutError, ValueError)


def test_summer_2025_still_builds_with_the_guard_in_place(tmp_path: Path) -> None:
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


def test_a_stray_2026_row_in_silver_is_left_out_by_the_real_window(tmp_path: Path) -> None:
    """Real silver holds several summers; building 2025 from it must work and must not carry a 2026 row along."""
    build_fixture_snapshot(tmp_path, store=stamp_stray_2026_rows(tmp_path))

    assert scan_snapshot(tmp_path / "replay" / SNAPSHOT_ID) == []


def test_a_bad_window_that_lets_2026_through_fails_closed_and_leaves_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Defence in depth: with a window computation that reaches into 2026, the row check still refuses."""
    store = stamp_stray_2026_rows(tmp_path)
    monkeypatch.setattr(
        replay_build,
        "summer_window",
        lambda year: (datetime(year, 5, 15, tzinfo=UTC), datetime(year + 1, 9, 30, 23, tzinfo=UTC)),
    )

    with pytest.raises(ReplayHoldoutError, match="hold rows of held-out"):
        build(store, tmp_path / "replay", SUMMER)

    assert not (tmp_path / "replay").exists()  # no directory, no staging directory


def test_the_cli_exits_2_for_2026_and_touches_neither_git_nor_the_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
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

    result = CliRunner().invoke(
        app, ["replay", "build", "--summer", "2026", "--station", "OMAA", "--snapshot-id", "demo-2026"]
    )

    assert result.exit_code == 2
    assert "2026" in result.output
    assert "architect" in result.output
    assert git_calls == []
    assert not (tmp_path / "replay").exists()
