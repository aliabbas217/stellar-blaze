"""Observed weather from the Iowa Environmental Mesonet (IEM) METAR archive: the truth that forecasts are scored on.

The request and the parsing are those of the data-availability study (``docs/research/scripts/fetch_iem.py`` and
``analyze_obs.py``), so a dataset built here reproduces its counts. IEM serves temperature and dew point in degrees
Fahrenheit and wind in knots, converted here; it has no quality flags, so the ``qc_*`` columns are typed nulls.
"""

import asyncio
import io
from datetime import datetime, time, timedelta
from typing import Final

import httpx2
import polars as pl

from stellar_blaze.adapters.http.cache import RawResponseCache
from stellar_blaze.adapters.http.client import get_bytes
from stellar_blaze.adapters.http.pacer import RequestPacer
from stellar_blaze.adapters.sources._common import (
    REQUEST_TIMEOUT_S,
    empty_observations,
    to_observations,
    utc_window,
)
from stellar_blaze.domain.weather.stations import Station

_KNOTS_TO_MS: Final = 0.514444


def _params(station: Station, start: datetime, end: datetime) -> list[tuple[str, str]]:
    """The query for the UTC window ``[start, end)``, in the order the data-availability study sent it.

    IEM takes whole days and treats the end date as exclusive (a request ending 2025-07-03 returns reports up to
    2025-07-02 23:xx), so an ``end`` at midnight is passed as it is, and any later ``end`` is rounded up to the
    next day: the extra reports are filtered out afterwards, and the window is never cut short.
    """
    last_day = end.date() if end.time() == time.min else end.date() + timedelta(days=1)
    return [
        ("station", station.icao),
        ("data", "tmpf"),
        ("data", "dwpf"),
        ("data", "sknt"),
        ("year1", str(start.year)),
        ("month1", str(start.month)),
        ("day1", str(start.day)),
        ("year2", str(last_day.year)),
        ("month2", str(last_day.month)),
        ("day2", str(last_day.day)),
        ("tz", "Etc/UTC"),
        ("format", "onlycomma"),
        ("latlon", "no"),
        ("elev", "no"),
        ("missing", "empty"),
        ("trace", "T"),
        ("direct", "no"),
        ("report_type", "3"),
        ("report_type", "4"),
    ]


def _number(column: str) -> pl.Expr:
    """The column as Float64: a missing or non-numeric cell (``M``, ``abc``, ``nan``, ``inf``) is null, never NaN."""
    value = pl.col(column).cast(pl.Float64, strict=False)
    return pl.when(value.is_finite()).then(value)


def _parse(body: bytes) -> pl.DataFrame:
    """Read an IEM CSV body into the shared parsed columns; every report is kept, in the order delivered.

    Every column is read as text first, so a header-only body (a station without reports in the window) gives the same
    typed empty frame as any other.

    Raises:
        pl.exceptions.PolarsError: The body is not an IEM CSV (empty, wrong columns) or a ``valid`` is not a time.
    """
    raw = pl.read_csv(io.BytesIO(body), infer_schema=False)
    no_code = pl.lit(None, dtype=pl.String)
    return raw.select(
        pl.col("valid").str.to_datetime("%Y-%m-%d %H:%M", time_zone="UTC", time_unit="us").alias("obs_time"),
        ((_number("tmpf") - 32.0) * 5.0 / 9.0).alias("t_c"),
        ((_number("dwpf") - 32.0) * 5.0 / 9.0).alias("td_c"),
        (_number("sknt") * _KNOTS_TO_MS).alias("wind_ms"),
        no_code.alias("qc_t"),
        no_code.alias("qc_td"),
        no_code.alias("qc_wind"),
    )


def _validate(body: bytes) -> None:
    try:
        _parse(body)
    except pl.exceptions.PolarsError as exc:
        raise ValueError(f"not an IEM observation CSV: {exc}") from exc


class IemMetarSource:
    """An ``ObservationSource`` over the IEM ``asos.py`` endpoint (routine and special METARs)."""

    name = "iem"

    def __init__(
        self,
        client: httpx2.AsyncClient,
        base_url: str,
        cache: RawResponseCache | None,
        *,
        pacer: RequestPacer | None = None,
        timeout_s: float = REQUEST_TIMEOUT_S,
    ) -> None:
        """Use ``client`` for ``base_url`` (``Settings.iem_asos_url``); bodies are kept in ``cache``, if given.

        ``pacer`` spaces the requests that reach IEM (a cache hit is not one), which answers 429 to a few quick
        requests; ``timeout_s`` is how long each request may take.
        """
        self._client = client
        self._base_url = base_url
        self._cache = cache
        self._pacer = pacer
        self._timeout_s = timeout_s

    async def observations(self, *, station: Station, start: datetime, end: datetime) -> pl.DataFrame:
        """Return the station's METARs with ``start <= obs_time < end``, as ``OBS_RAW_SCHEMA`` rows.

        A window without duration (``start >= end``) returns an empty frame without a request: IEM would answer a
        request whose end date equals its start date with a whole day.

        Raises:
            ValueError: ``start`` or ``end`` is naive.
            UpstreamError: IEM did not answer, or answered with something that is not an observation CSV.
        """
        start_utc, end_utc = utc_window(start, end)
        if start_utc >= end_utc:
            return empty_observations()
        body = await get_bytes(
            self._client,
            self._base_url,
            _params(station, start_utc, end_utc),
            cache=self._cache,
            validate=_validate,
            before_request=None if self._pacer is None else self._pacer.wait,
            timeout_s=self._timeout_s,
        )
        parsed = await asyncio.to_thread(_parse, body)
        return to_observations(parsed, station=station, source=self.name, start=start_utc, end=end_utc)
