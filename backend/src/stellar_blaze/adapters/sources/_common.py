"""What the observation adapters share: the UTC window and the final shaping of a frame to ``OBS_RAW_SCHEMA``."""

from datetime import UTC, datetime

import polars as pl

from stellar_blaze.domain.weather.schemas import OBS_RAW_SCHEMA, conform
from stellar_blaze.domain.weather.stations import Station


def utc_window(start: datetime, end: datetime) -> tuple[datetime, datetime]:
    """Return ``start`` and ``end`` in UTC.

    Raises:
        ValueError: ``start`` or ``end`` is naive; the port requires timezone-aware datetimes.
    """
    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError(f"start and end must be timezone-aware, got {start.isoformat()} and {end.isoformat()}")
    return start.astimezone(UTC), end.astimezone(UTC)


def empty_observations() -> pl.DataFrame:
    """A frame without reports, with the full schema."""
    return pl.DataFrame(schema=OBS_RAW_SCHEMA)


def to_observations(
    parsed: pl.DataFrame, *, station: Station, source: str, start: datetime, end: datetime
) -> pl.DataFrame:
    """Return the parsed reports with ``start <= obs_time < end`` as ``OBS_RAW_SCHEMA`` rows.

    ``parsed`` has the schema's columns except ``station`` and ``source`` (``obs_time``, ``t_c``, ``td_c``,
    ``wind_ms``, ``qc_t``, ``qc_td``, ``qc_wind``), which this adds. The rows keep the order the upstream service
    delivered them in.
    """
    window = parsed.filter((pl.col("obs_time") >= start) & (pl.col("obs_time") < end))
    shaped = window.with_columns(
        pl.lit(station.icao, dtype=pl.String).alias("station"),
        pl.lit(source, dtype=pl.String).alias("source"),
    )
    return conform(shaped, OBS_RAW_SCHEMA)  # the port's schema, in the port's column order, or an error here
