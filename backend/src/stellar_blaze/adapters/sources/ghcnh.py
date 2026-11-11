"""Observed weather from NOAA's GHCNh (Global Historical Climatology Network hourly): the audit source.

GHCNh merges METAR and SYNOP reports and carries a quality code for every value. One Parquet file holds a station's
whole year (all 329 columns), so a window is answered by downloading each year it touches and filtering. Values and
codes are delivered as they are: the quality-control policy belongs to the binning step, not to the source.
"""

import asyncio
import io
from datetime import datetime, timedelta
from typing import Final

import httpx2
import polars as pl
import structlog

from stellar_blaze.adapters.http.cache import RawResponseCache
from stellar_blaze.adapters.http.client import UpstreamError, get_bytes
from stellar_blaze.adapters.sources._common import (
    empty_observations,
    to_observations,
    utc_window,
)
from stellar_blaze.domain.weather.stations import Station

logger = structlog.stdlib.get_logger(__name__)

# GHCNh column -> OBS_RAW_SCHEMA column. Only these (and DATE) are read from the 329 columns of a file.
_VALUES: Final = {"temperature": "t_c", "dew_point_temperature": "td_c", "wind_speed": "wind_ms"}
_CODES: Final = {
    "temperature_Quality_Code": "qc_t",
    "dew_point_temperature_Quality_Code": "qc_td",
    "wind_speed_Quality_Code": "qc_wind",
}
_COLUMNS: Final = ["DATE", *_VALUES, *_CODES]


def _code(column: str) -> pl.Expr:
    """The quality code as a String; a blank one (empty or only whitespace) is null, not a flag."""
    trimmed = pl.col(column).cast(pl.String).str.strip_chars()
    return pl.when(trimmed != "").then(trimmed)


def _parse(body: bytes) -> pl.DataFrame:
    """Read the columns this adapter needs from a GHCNh by-year file; every report is kept, in file order.

    ``DATE`` is a ``YYYY-MM-DDTHH:MM:SS`` string in UTC (all five station-years inspected, 2024 to 2026). A missing
    value is a null in the file, and a NaN is made null here: no numeric sentinel occurs in those files.

    Raises:
        pl.exceptions.PolarsError: The body is not a Parquet file, lacks a needed column, or has a ``DATE`` that does
            not parse.
    """
    raw = pl.read_parquet(io.BytesIO(body), columns=_COLUMNS)
    return raw.select(
        pl.col("DATE").str.to_datetime("%Y-%m-%dT%H:%M:%S", time_zone="UTC", time_unit="us").alias("obs_time"),
        *(pl.col(source).cast(pl.Float64).fill_nan(None).alias(target) for source, target in _VALUES.items()),
        *(_code(source).alias(target) for source, target in _CODES.items()),
    )


def _validate(body: bytes) -> None:
    try:
        _parse(body)
    except pl.exceptions.PolarsError as exc:
        raise ValueError(f"not a GHCNh by-year file: {exc}") from exc


class GhcnhParquetSource:
    """An ``ObservationSource`` over the GHCNh by-year Parquet files."""

    name = "ghcnh"

    def __init__(self, client: httpx2.AsyncClient, base_url: str, cache: RawResponseCache | None) -> None:
        """Use ``client`` for ``base_url`` (``Settings.ghcnh_base_url``); files are kept in ``cache``, if given."""
        self._client = client
        self._base_url = base_url.rstrip("/")
        self._cache = cache

    async def observations(self, *, station: Station, start: datetime, end: datetime) -> pl.DataFrame:
        """Return the station's reports with ``start <= obs_time < end``, as ``OBS_RAW_SCHEMA`` rows.

        Each calendar year (UTC) the window touches is downloaded once; a year NCEI has no file for contributes no
        rows and a warning in the log. Quality codes are kept as delivered, with blank codes as null.

        Raises:
            ValueError: ``start`` or ``end`` is naive.
            UpstreamError: NCEI failed with anything but 404, or sent something that is not a GHCNh by-year file.
        """
        start_utc, end_utc = utc_window(start, end)
        if start_utc >= end_utc:
            return empty_observations()
        last_year = (end_utc - timedelta(microseconds=1)).year  # `end` is exclusive: Jan 1 00:00 adds no year
        frames: list[pl.DataFrame] = []
        for year in range(start_utc.year, last_year + 1):
            url = f"{self._base_url}/{year}/parquet/GHCNh_{station.ghcnh_id}_{year}.parquet"
            try:
                body = await get_bytes(self._client, url, [], cache=self._cache, validate=_validate)
            except UpstreamError as exc:
                if exc.status != 404:
                    raise
                logger.warning(
                    "ghcnh.year_missing", station=station.icao, ghcnh_id=station.ghcnh_id, year=year, url=url
                )
                continue
            parsed = await asyncio.to_thread(_parse, body)
            frames.append(to_observations(parsed, station=station, source=self.name, start=start_utc, end=end_utc))
        return pl.concat(frames) if frames else empty_observations()
