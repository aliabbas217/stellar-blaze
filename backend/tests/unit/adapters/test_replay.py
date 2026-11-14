"""The replay sources: a hashed snapshot served through the B1 forecast and observation ports.

The snapshot is built by the real builder from synthetic silver files (2025 dates, ``tests/fixtures/forecast``), so the
sources are tested on what the builder writes, not on a hand-made twin of it.
"""

import json
import shutil
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path

import polars as pl
import pytest

from stellar_blaze.adapters.sources.replay import ReplayForecastSource, ReplayObservationSource, ReplaySnapshotError
from stellar_blaze.application.ingest import fetch_hourly_observations
from stellar_blaze.domain.weather.models import NwpModel, QcPolicy
from stellar_blaze.domain.weather.replay import MANIFEST_FILE, ReplayFile, files_digest
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, OBS_RAW_SCHEMA
from stellar_blaze.domain.weather.stations import station
from tests.fixtures.forecast.replay import SNAPSHOT_ID, SUMMER, build_fixture_snapshot, seed_silver, synthetic_pairs
from tests.unit.contract.forecast_contract import check_forecast_source
from tests.unit.contract.observation_contract import check_observation_source

pytestmark = pytest.mark.unit

OMAA = station("OMAA")
OMDB = station("OMDB")
FIRST_DAY, LAST_DAY = date(2025, 7, 9), date(2025, 7, 11)


@pytest.fixture(scope="module")
def built_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return build_fixture_snapshot(tmp_path_factory.mktemp("replay-source")).directory


@pytest.fixture
def snapshot_dir(built_dir: Path, tmp_path: Path) -> Path:
    """A private copy a test may tamper with."""
    return Path(shutil.copytree(built_dir, tmp_path / built_dir.name))


# --- the B1 contract suites -----------------------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("model", [NwpModel.ECMWF_IFS025, NwpModel.GFS_SEAMLESS])
@pytest.mark.parametrize("leads", [(0, 1, 2, 3, 4, 5, 6, 7), (1, 2, 3), (7,)])
async def test_replay_forecast_source_satisfies_the_contract(
    built_dir: Path, model: NwpModel, leads: tuple[int, ...]
) -> None:
    await check_forecast_source(ReplayForecastSource(built_dir), OMAA, model, FIRST_DAY, LAST_DAY, leads)


@pytest.mark.asyncio
async def test_replay_forecast_source_satisfies_the_contract_for_a_sub_range(built_dir: Path) -> None:
    await check_forecast_source(
        ReplayForecastSource(built_dir), OMDB, NwpModel.ECMWF_IFS025, date(2025, 7, 10), date(2025, 7, 10), (1, 2, 3)
    )


@pytest.mark.asyncio
async def test_replay_observation_source_satisfies_the_contract(built_dir: Path) -> None:
    start = datetime(2025, 7, 9, 0, tzinfo=UTC)
    await check_observation_source(ReplayObservationSource(built_dir), OMAA, start, start + timedelta(days=3))


@pytest.mark.asyncio
async def test_replay_observation_source_satisfies_the_contract_in_a_partial_window(built_dir: Path) -> None:
    start = datetime(2025, 7, 10, 6, 30, tzinfo=UTC)  # not on the hour: the first report is the 07:00 one
    await check_observation_source(ReplayObservationSource(built_dir), OMDB, start, start + timedelta(hours=9))


# --- integrity ------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("source_class", [ReplayForecastSource, ReplayObservationSource])
@pytest.mark.parametrize("file", ["forecasts.parquet", "observations.parquet"])
def test_replay_rejects_tampered_file(
    snapshot_dir: Path, source_class: type[ReplayForecastSource | ReplayObservationSource], file: str
) -> None:
    """Either source refuses a snapshot in which either data file changed by even one byte."""
    path = snapshot_dir / file
    content = bytearray(path.read_bytes())
    content[len(content) // 2] ^= 0x01
    path.write_bytes(bytes(content))

    with pytest.raises(ReplaySnapshotError, match=rf"{file}.*sha256"):
        source_class(snapshot_dir)


@pytest.mark.parametrize("source_class", [ReplayForecastSource, ReplayObservationSource])
def test_replay_accepts_the_untouched_snapshot(
    snapshot_dir: Path, source_class: type[ReplayForecastSource | ReplayObservationSource]
) -> None:
    source_class(snapshot_dir)  # does not raise: the rejection above is the tampering, not the copy


def test_replay_rejects_a_truncated_file(snapshot_dir: Path) -> None:
    path = snapshot_dir / "forecasts.parquet"
    path.write_bytes(path.read_bytes()[:-100])

    with pytest.raises(ReplaySnapshotError, match=r"forecasts\.parquet.*sha256"):
        ReplayForecastSource(snapshot_dir)


def test_replay_rejects_a_missing_data_file(snapshot_dir: Path) -> None:
    (snapshot_dir / "observations.parquet").unlink()

    with pytest.raises(ReplaySnapshotError, match=r"observations\.parquet.*missing"):
        ReplayObservationSource(snapshot_dir)


def test_replay_rejects_a_missing_or_malformed_manifest(snapshot_dir: Path) -> None:
    (snapshot_dir / MANIFEST_FILE).write_bytes(b'{"snapshot_id": "fixture-2025"}')
    with pytest.raises(ReplaySnapshotError, match=MANIFEST_FILE):
        ReplayForecastSource(snapshot_dir)

    (snapshot_dir / MANIFEST_FILE).unlink()
    with pytest.raises(ReplaySnapshotError, match=r"snapshot\.json.*missing"):
        ReplayForecastSource(snapshot_dir)


def test_replay_rejects_a_directory_that_is_not_named_after_its_snapshot(snapshot_dir: Path, tmp_path: Path) -> None:
    moved = Path(shutil.move(snapshot_dir, tmp_path / "other-name"))

    with pytest.raises(ReplaySnapshotError, match=rf"other-name.*{SNAPSHOT_ID}"):
        ReplayForecastSource(moved)


def test_replay_rejects_a_manifest_whose_hash_was_edited_to_match_other_bytes(snapshot_dir: Path) -> None:
    """Editing the stored hash instead of the file is still a mismatch: the file's real hash is what counts."""
    manifest = json.loads((snapshot_dir / MANIFEST_FILE).read_bytes())
    manifest["files"][0]["sha256"] = "0" * 64
    manifest["provenance"]["data_sha256"] = files_digest([ReplayFile(**file) for file in manifest["files"]])
    (snapshot_dir / MANIFEST_FILE).write_bytes(json.dumps(manifest).encode())

    with pytest.raises(ReplaySnapshotError, match="sha256"):
        ReplayObservationSource(snapshot_dir)


# --- the forecast port's rules --------------------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("leads", [[8], [-1], [0, 1, 9], [7, 8]])
async def test_replay_forecast_source_refuses_a_lead_outside_0_to_7(built_dir: Path, leads: list[int]) -> None:
    with pytest.raises(ValueError, match=r"leads_days must be within 0\.\.7"):
        await ReplayForecastSource(built_dir).previous_runs(
            station=OMAA, model=NwpModel.ECMWF_IFS025, start=FIRST_DAY, end=LAST_DAY, leads_days=leads
        )


@pytest.mark.asyncio
async def test_replay_forecast_source_returns_the_requested_leads_once_each_in_open_meteo_order(
    built_dir: Path,
) -> None:
    frame = await ReplayForecastSource(built_dir).previous_runs(
        station=OMAA, model=NwpModel.ECMWF_IFS025, start=FIRST_DAY, end=FIRST_DAY, leads_days=[3, 1, 3]
    )

    assert frame.schema == FORECAST_SCHEMA
    assert frame.height == 24 * 2
    assert frame.select("valid_time", "lead_days").rows() == sorted(frame.select("valid_time", "lead_days").rows())
    assert set(frame["lead_days"].to_list()) == {1, 3}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("icao", "model", "start", "end", "leads"),
    [
        pytest.param("OMAL", NwpModel.ECMWF_IFS025, FIRST_DAY, LAST_DAY, [1], id="station-not-in-the-snapshot"),
        pytest.param("OMAA", NwpModel.ECMWF_AIFS025, FIRST_DAY, LAST_DAY, [1], id="model-not-in-the-snapshot"),
        pytest.param("OMAA", NwpModel.ECMWF_IFS025, date(2025, 8, 1), date(2025, 8, 2), [1], id="dates-after-it"),
        pytest.param("OMAA", NwpModel.ECMWF_IFS025, LAST_DAY, FIRST_DAY, [1], id="end-before-start"),
        pytest.param("OMAA", NwpModel.ECMWF_IFS025, FIRST_DAY, LAST_DAY, [], id="no-leads"),
    ],
)
async def test_replay_forecast_source_answers_what_it_does_not_hold_with_an_empty_frame(
    built_dir: Path, icao: str, model: NwpModel, start: date, end: date, leads: list[int]
) -> None:
    frame = await ReplayForecastSource(built_dir).previous_runs(
        station=station(icao), model=model, start=start, end=end, leads_days=leads
    )

    assert frame.height == 0
    assert frame.schema == FORECAST_SCHEMA


@pytest.mark.asyncio
async def test_replay_forecast_source_keeps_a_missing_value_null_and_the_row(tmp_path: Path) -> None:
    pairs = synthetic_pairs().with_columns(
        pl.when((pl.col("lead_days") == 2) & (pl.col("valid_time").dt.hour() == 13))
        .then(None)
        .otherwise(pl.col("fc_sw_wm2"))
        .alias("fc_sw_wm2")
    )
    source = ReplayForecastSource(build_fixture_snapshot(tmp_path, store=seed_silver(tmp_path, pairs)).directory)

    frame = await source.previous_runs(
        station=OMAA, model=NwpModel.ECMWF_IFS025, start=FIRST_DAY, end=FIRST_DAY, leads_days=[1, 2]
    )

    lead_2_at_13 = frame.filter((pl.col("lead_days") == 2) & (pl.col("valid_time").dt.hour() == 13))
    assert lead_2_at_13.height == 1  # the hour is still there ...
    assert lead_2_at_13["sw_wm2"].to_list() == [None]  # ... with a null, not NaN and not a filled value
    assert frame.filter(pl.col("lead_days") == 1)["sw_wm2"].null_count() == 0
    assert frame.height == 24 * 2  # nothing was dropped


@pytest.mark.asyncio
async def test_replay_serves_the_stored_values_unchanged(built_dir: Path) -> None:
    """A replayed hour has the value the silver file holds for it (the hash proves the bytes, this the reading)."""
    pairs = synthetic_pairs()
    expected = (
        pairs.filter(
            (pl.col("station") == "OMDB")
            & (pl.col("model") == "gfs_seamless")
            & (pl.col("lead_days") == 3)
            & (pl.col("valid_time").dt.date() == date(2025, 7, 10))
        )
        .sort("valid_time")
        .select("valid_time", pl.col("fc_t_c").alias("t_c"), pl.col("fc_wind_ms").alias("wind_ms"))
    )

    frame = (
        await ReplayForecastSource(built_dir).previous_runs(
            station=OMDB, model=NwpModel.GFS_SEAMLESS, start=date(2025, 7, 10), end=date(2025, 7, 10), leads_days=[3]
        )
    ).select("valid_time", "t_c", "wind_ms")

    assert frame.equals(expected)


# --- UTC ------------------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_replay_valid_time_is_utc(built_dir: Path) -> None:
    """20:00 UTC on 10 July is 00:00 GST on 11 July; every date the replay derives is the UTC date, 10 July."""
    evening = datetime(2025, 7, 10, 20, tzinfo=UTC)
    forecasts = ReplayForecastSource(built_dir)

    on_the_10th = await forecasts.previous_runs(
        station=OMAA, model=NwpModel.ECMWF_IFS025, start=date(2025, 7, 10), end=date(2025, 7, 10), leads_days=[1]
    )
    on_the_11th = await forecasts.previous_runs(
        station=OMAA, model=NwpModel.ECMWF_IFS025, start=date(2025, 7, 11), end=date(2025, 7, 11), leads_days=[1]
    )

    assert on_the_10th.schema["valid_time"] == pl.Datetime("us", "UTC")
    assert evening in on_the_10th["valid_time"].to_list()
    assert evening not in on_the_11th["valid_time"].to_list()
    assert on_the_10th["valid_time"].dt.date().unique().to_list() == [date(2025, 7, 10)]
    assert on_the_11th["valid_time"].min() == datetime(2025, 7, 11, 0, tzinfo=UTC)  # 04:00 GST, not 00:00 GST


@pytest.mark.asyncio
async def test_replay_observation_window_is_instants_whatever_the_offset(built_dir: Path) -> None:
    """The window 00:00-01:00 GST on 11 July is 20:00-21:00 UTC on 10 July: the same one hour, found by instant."""
    gst = timezone(timedelta(hours=4))
    source = ReplayObservationSource(built_dir)

    in_gst = await source.observations(
        station=OMAA, start=datetime(2025, 7, 11, 0, tzinfo=gst), end=datetime(2025, 7, 11, 1, tzinfo=gst)
    )
    in_utc = await source.observations(
        station=OMAA, start=datetime(2025, 7, 10, 20, tzinfo=UTC), end=datetime(2025, 7, 10, 21, tzinfo=UTC)
    )

    assert in_gst.height == in_utc.height == 1  # (the fixture has OMAA truth at that hour, so this is not vacuous)
    assert in_gst["obs_time"].to_list() == [datetime(2025, 7, 10, 20, tzinfo=UTC)]
    assert in_gst.equals(in_utc)
    assert in_gst.schema["obs_time"] == pl.Datetime("us", "UTC")


# --- the observation port's rules -----------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_replay_observation_source_is_named_replay_and_says_so_on_every_row(built_dir: Path) -> None:
    source = ReplayObservationSource(built_dir)

    frame = await source.observations(
        station=OMAA, start=datetime(2025, 7, 9, tzinfo=UTC), end=datetime(2025, 7, 12, tzinfo=UTC)
    )

    assert source.name == "replay"
    assert frame.schema == OBS_RAW_SCHEMA
    assert frame["source"].unique().to_list() == ["replay"]
    assert frame["qc_t"].null_count() == frame["qc_td"].null_count() == frame["qc_wind"].null_count() == frame.height
    assert frame["obs_time"].dt.minute().unique().to_list() == [0]  # the stored truth is hourly: reports on the hour


@pytest.mark.asyncio
async def test_replay_observation_window_is_half_open(built_dir: Path) -> None:
    source = ReplayObservationSource(built_dir)
    start = datetime(2025, 7, 10, 0, tzinfo=UTC)

    hour = await source.observations(station=OMAA, start=start, end=start + timedelta(hours=3))

    times = hour["obs_time"].to_list()
    assert all(start <= t < start + timedelta(hours=3) for t in times)
    assert start + timedelta(hours=3) not in times


@pytest.mark.asyncio
async def test_replay_observation_source_refuses_a_naive_window(built_dir: Path) -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        await ReplayObservationSource(built_dir).observations(
            station=OMAA,
            start=datetime(2025, 7, 10, 0),  # noqa: DTZ001 (the naive value is the test)
            end=datetime(2025, 7, 11, 0, tzinfo=UTC),
        )


@pytest.mark.asyncio
async def test_replay_observation_source_answers_an_unknown_station_with_an_empty_frame(built_dir: Path) -> None:
    frame = await ReplayObservationSource(built_dir).observations(
        station=station("OMAL"), start=datetime(2025, 7, 9, tzinfo=UTC), end=datetime(2025, 7, 12, tzinfo=UTC)
    )

    assert frame.height == 0
    assert frame.schema == OBS_RAW_SCHEMA


@pytest.mark.asyncio
async def test_replay_observations_bin_back_to_the_stored_hourly_truth(built_dir: Path) -> None:
    """The job path (``fetch_hourly_observations``, which bins the raw reports) reproduces the silver hours exactly.

    The window of the job is the whole summer, so the snapshot's three days are what comes back.
    """
    pairs = synthetic_pairs()
    truth = (
        pairs.filter((pl.col("station") == "OMAA") & pl.col("has_joint_obs"))
        .unique(subset="valid_time")
        .sort("valid_time")
        .select("valid_time", pl.col("obs_t_c").alias("t_c"), pl.col("obs_td_c").alias("td_c"))
    )

    hourly, report = await fetch_hourly_observations(ReplayObservationSource(built_dir), OMAA, SUMMER, QcPolicy.NONE)

    assert hourly.select("valid_time", "t_c", "td_c").sort("valid_time").equals(truth)
    assert report is not None
