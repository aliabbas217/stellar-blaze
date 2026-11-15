"""A tiny replay snapshot built the way the real one is: synthetic silver files, then ``build_replay_snapshot``.

Three UTC days of July of the summer (default 2025; 2026 for the tests of the unlocked replay summer), the 9th to the
11th, two stations, both models, leads 0 to 7. The data is the synthetic generator's, never the gold file or any real
2026 data.
"""

from datetime import UTC, datetime
from pathlib import Path
from typing import Final

import polars as pl

from stellar_blaze.adapters.storage.parquet_store import ParquetStore
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.stations import Station, station
from stellar_blaze.jobs.replay_build import BuiltSnapshot, build_replay_snapshot
from tests.fixtures.forecast.synthetic import forecasts_of, make_pairs, observations_of

SUMMER: Final = 2025
SNAPSHOT_ID: Final = "fixture-2025"
GIT_SHA: Final = "0123456789abcdef0123456789abcdef01234567"
CREATED_AT: Final = datetime(2026, 11, 14, 9, 30, tzinfo=UTC)
FIXTURE_STATIONS: Final = (station("OMAA"), station("OMDB"))
SUMMER_DAYS: Final = (56, 57, 58)  # day 1 is 15 May, so these are 9, 10 and 11 July
MODELS: Final = (NwpModel.ECMWF_IFS025, NwpModel.GFS_SEAMLESS)


def synthetic_pairs(stations: tuple[Station, ...] = FIXTURE_STATIONS, *, summer: int = SUMMER) -> pl.DataFrame:
    """The synthetic pair frame of the fixture days (no missing GFS rows, so every hour has every lead)."""
    return make_pairs(
        seed=13,
        summers=(summer,),
        station_bias_c={},
        stations=[s.icao for s in stations],
        leads=range(8),
        summer_days=SUMMER_DAYS,
        gfs_missing_rate=0.0,
    )


def seed_silver(root: Path, pairs: pl.DataFrame | None = None, *, summer: int = SUMMER) -> ParquetStore:
    """Write the frame's forecasts and observations as silver files under ``root`` and return the store."""
    frame = synthetic_pairs(summer=summer) if pairs is None else pairs
    store = ParquetStore(root)
    truth = observations_of(frame)
    for icao in frame["station"].unique().sort().to_list():
        for model in MODELS:
            forecasts = forecasts_of(frame, model.value).filter(pl.col("station") == icao)
            store.write_forecasts(model, summer, icao, forecasts)
        store.write_observations("iem", summer, icao, truth.filter(pl.col("station") == icao))
    return store


def build_fixture_snapshot(
    root: Path, *, replay_dir: Path | None = None, store: ParquetStore | None = None, summer: int = SUMMER
) -> BuiltSnapshot:
    """Seed silver under ``root`` (unless a ``store`` is given) and build the fixture snapshot under ``replay_dir``.

    The snapshot id is ``fixture-<summer>`` (``SNAPSHOT_ID`` for the default summer).
    """
    return build_replay_snapshot(
        store=seed_silver(root, summer=summer) if store is None else store,
        replay_dir=root / "replay" if replay_dir is None else replay_dir,
        summer=summer,
        stations=list(FIXTURE_STATIONS),
        snapshot_id=f"fixture-{summer}",
        git_sha=GIT_SHA,
        created_at=CREATED_AT,
    )
