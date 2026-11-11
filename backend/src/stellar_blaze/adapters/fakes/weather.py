"""In-memory weather sources for tests: they hold frames and apply the port's window and lead rules.

They check what they are given, because a fake that quietly accepts a malformed fixture hides the mistake until a
real adapter disagrees: each frame must have exactly the schema's columns and dtypes, and every row must belong to the
key it is stored under. A station or model that was not seeded behaves like an upstream service with no data for it:
an empty frame with the full schema.
"""

from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime, time, timedelta

import polars as pl

from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, OBS_RAW_SCHEMA, SchemaMismatchError, conform
from stellar_blaze.domain.weather.stations import Station


def _checked(frame: pl.DataFrame, schema: pl.Schema, *, label: str, expected: Mapping[str, str]) -> pl.DataFrame:
    """Return ``frame`` in the schema's column order, or raise naming ``label`` if it does not fit.

    Raises:
        SchemaMismatchError: Columns are missing or have the wrong dtype.
        ValueError: A column in ``expected`` holds a value other than the one given for it on some row.
    """
    try:
        conformed = conform(frame, schema)
    except SchemaMismatchError as exc:
        raise SchemaMismatchError(f"{label}: {exc}") from exc
    for column, value in expected.items():
        stray = conformed.filter(pl.col(column).ne_missing(value))[column].unique().to_list()
        if stray:
            raise ValueError(f"{label}: column {column!r} must be {value!r} on every row, found {stray}")
    return conformed


class InMemoryObservationSource:
    """An ``ObservationSource`` over frames keyed by ICAO identifier.

    Rows keep their stored order (no sorting, duplicates kept), so tests can seed unsorted or duplicated reports.
    """

    def __init__(self, frames: Mapping[str, pl.DataFrame], name: str = "fake") -> None:
        """Hold ``frames``.

        Raises:
            SchemaMismatchError: A frame does not have the ``OBS_RAW_SCHEMA`` columns and dtypes.
            ValueError: A frame holds rows of a station other than its key.
        """
        self.name = name
        self._frames = {
            icao: _checked(frame, OBS_RAW_SCHEMA, label=f"frame for {icao!r}", expected={"station": icao})
            for icao, frame in frames.items()
        }

    async def observations(self, *, station: Station, start: datetime, end: datetime) -> pl.DataFrame:
        """Return the station's stored rows with ``start <= obs_time < end``.

        Raises:
            ValueError: ``start`` or ``end`` is naive.
        """
        if start.tzinfo is None or end.tzinfo is None:
            raise ValueError(f"start and end must be timezone-aware, got {start.isoformat()} and {end.isoformat()}")
        frame = self._frames.get(station.icao)
        if frame is None:
            return pl.DataFrame(schema=OBS_RAW_SCHEMA)
        return frame.filter((pl.col("obs_time") >= start) & (pl.col("obs_time") < end))


class InMemoryForecastSource:
    """A ``WeatherForecastSource`` over frames keyed by ICAO identifier and model."""

    def __init__(self, frames: Mapping[tuple[str, NwpModel], pl.DataFrame]) -> None:
        """Hold ``frames``.

        Raises:
            SchemaMismatchError: A frame does not have the ``FORECAST_SCHEMA`` columns and dtypes.
            ValueError: A frame holds rows of a station or model other than its key.
        """
        self._frames = {
            (icao, model): _checked(
                frame,
                FORECAST_SCHEMA,
                label=f"frame for {(icao, model.value)!r}",
                expected={"station": icao, "model": model.value},
            )
            for (icao, model), frame in frames.items()
        }

    async def previous_runs(
        self, *, station: Station, model: NwpModel, start: date, end: date, leads_days: Sequence[int]
    ) -> pl.DataFrame:
        """Return the stored rows with a valid-time UTC date in ``[start, end]`` and a requested lead."""
        frame = self._frames.get((station.icao, model))
        if frame is None:
            return pl.DataFrame(schema=FORECAST_SCHEMA)
        first = datetime.combine(start, time.min, tzinfo=UTC)
        after_last = datetime.combine(end + timedelta(days=1), time.min, tzinfo=UTC)
        return frame.filter(
            (pl.col("valid_time") >= first)
            & (pl.col("valid_time") < after_last)
            & pl.col("lead_days").is_in(list(leads_days))
        )
