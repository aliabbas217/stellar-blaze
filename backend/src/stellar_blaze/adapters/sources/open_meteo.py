"""Archived forecasts from the Open-Meteo Previous Runs API: the forecast side of the hindcast dataset.

The request and the parsing are those of the data-availability study
(``docs/research/scripts/fetch_forecast_stations.py`` and ``match_pairs.py``), so a dataset built here reproduces its
matched pairs and raw errors. Open-Meteo names a lead after the variable: lead 0 is the bare name (the same-day run)
and lead k is ``<variable>_previous_day<k>``, the value the model predicted k days before the valid time.

Units are Open-Meteo's defaults, and the adapter checks them instead of assuming them: temperature and dew point in
degrees Celsius, wind in km/h (divided by 3.6 here, as the study did), radiation in W/m2, pressure in hPa. A response
whose ``hourly_units`` says anything else is rejected, because a silent change (wind in m/s, say) would shift every
later wind error by a factor of 3.6 without any test failing.

``valid_time`` is UTC and hourly. The two radiation columns are the mean over the hour that ends at ``valid_time``
(Open-Meteo's convention, ADR 0006), kept as served: no shifting happens here. Surface pressure is instantaneous.
"""

import asyncio
import json
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any, Final, TypeGuard

import httpx2
import polars as pl

from stellar_blaze.adapters.http.cache import RawResponseCache
from stellar_blaze.adapters.http.client import get_bytes
from stellar_blaze.domain.weather.models import LEADS_DAYS, NwpModel
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, conform
from stellar_blaze.domain.weather.stations import Station

_KMH_PER_MS: Final = 3.6
_TIME_FORMAT: Final = "%Y-%m-%dT%H:%M"  # what ``timezone=UTC`` makes Open-Meteo send: no offset suffix


@dataclass(frozen=True, slots=True)
class _Variable:
    """One Open-Meteo variable, the ``FORECAST_SCHEMA`` column it fills and how its values are read."""

    name: str
    column: str
    unit: str  # what ``hourly_units`` must say for every lead of the variable
    divisor: float = 1.0  # from the unit Open-Meteo serves to the unit of the column


# In the order the request names them.
_VARIABLES: Final = (
    _Variable("temperature_2m", "t_c", "°C"),
    _Variable("dew_point_2m", "td_c", "°C"),
    _Variable("wind_speed_10m", "wind_ms", "km/h", divisor=_KMH_PER_MS),
    _Variable("shortwave_radiation", "sw_wm2", "W/m²"),
    _Variable("direct_radiation", "direct_wm2", "W/m²"),
    _Variable("surface_pressure", "pressure_hpa", "hPa"),
)


def _series_name(variable: str, lead: int) -> str:
    return variable if lead == 0 else f"{variable}_previous_day{lead}"


def _leads(leads_days: Sequence[int]) -> list[int]:
    """The leads once each, ascending.

    Raises:
        ValueError: A lead is outside ``LEADS_DAYS`` (0 to 7), the range the Previous Runs API serves.
    """
    leads = sorted(set(leads_days))
    outside = [lead for lead in leads if lead not in LEADS_DAYS]
    if outside:
        raise ValueError(f"leads_days must be within {LEADS_DAYS.start}..{LEADS_DAYS[-1]}, got {outside}")
    return leads


def _requested(leads: Sequence[int]) -> dict[str, _Variable]:
    """The series to ask for, by name, in request order: every lead of a variable, then the next variable."""
    return {_series_name(variable.name, lead): variable for variable in _VARIABLES for lead in leads}


def _params(station: Station, model: NwpModel, start: date, end: date, series: Sequence[str]) -> list[tuple[str, str]]:
    """The query in the order the data-availability study sent it, at the station's coordinates (4 decimals)."""
    return [
        ("latitude", f"{station.lat:.4f}"),
        ("longitude", f"{station.lon:.4f}"),
        ("models", model.value),
        ("timezone", "UTC"),
        ("start_date", start.isoformat()),
        ("end_date", end.isoformat()),
        ("hourly", ",".join(series)),
    ]


@dataclass(frozen=True, slots=True)
class _Decoded:
    """A checked response: the hours, the requested series that came back (converted), and the grid cell."""

    valid_time: pl.Series
    series: dict[str, list[float | None]]
    grid_lat: float
    grid_lon: float
    grid_elev_m: float | None


def _is_number(value: object) -> TypeGuard[int | float]:
    """Whether a decoded JSON value is a number (a JSON ``true`` is not, though ``bool`` is an ``int``)."""
    return isinstance(value, int | float) and not isinstance(value, bool)


def _numbers(name: str, values: object, hours: int, divisor: float) -> list[float | None]:
    """The series as floats divided by ``divisor``; a JSON null, NaN or infinity is ``None``.

    The division is plain IEEE float division of each value, exactly what the study's ``numpy`` division did. It is
    not left to a Polars ``Series / divisor``, which multiplies by the reciprocal and so differs from the division in
    the last bit for about 4 in 10 values.

    Raises:
        ValueError: ``values`` is not a list of ``hours`` numbers and nulls.
    """
    if not isinstance(values, list):
        raise ValueError(f"{name} is not a list")
    if len(values) != hours:
        raise ValueError(f"{name} has {len(values)} values for {hours} hours")
    numbers: list[float | None] = []
    for index, value in enumerate(values):
        if value is None:
            numbers.append(None)
        elif not _is_number(value):
            raise ValueError(f"{name}[{index}] is {value!r}, not a number")
        else:
            numbers.append(value / divisor if math.isfinite(value) else None)
    return numbers


def _grid_coordinate(payload: Mapping[str, Any], key: str) -> float:
    value = payload.get(key)
    if not _is_number(value):
        raise ValueError(f"{key} is missing or not a number: {value!r}")
    return float(value)


def _decode(body: bytes, requested: Mapping[str, _Variable]) -> _Decoded:
    """Check a response body and read it.

    A series that was asked for and is absent (a model that does not publish a variable) is left out, and becomes a
    null column later. Everything else that deviates from what the request promised is an error, so drift cannot go
    unnoticed: an error body, a non-UTC time axis, a unit other than the expected one (or none), a series that is not
    numbers or not one value per hour, repeated hours, and a response without any of the requested series.

    Raises:
        ValueError: The body is not a usable response; the message names what is wrong.
    """
    try:
        payload = json.loads(body)
    except ValueError as exc:  # JSONDecodeError and UnicodeDecodeError both
        raise ValueError(f"not JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"not a JSON object: {type(payload).__name__}")
    if payload.get("error") is True:
        raise ValueError(f"Open-Meteo reported an error: {payload.get('reason', 'no reason given')}")

    offset = payload.get("utc_offset_seconds")
    if not (_is_number(offset) and offset == 0):
        raise ValueError(f"utc_offset_seconds is {offset!r}, expected 0: the valid times would not be UTC")
    hourly, units = payload.get("hourly"), payload.get("hourly_units")
    if not isinstance(hourly, dict):
        raise ValueError("hourly is missing or not an object")
    if not isinstance(units, dict):
        raise ValueError("hourly_units is missing or not an object")
    times = hourly.get("time")
    if not isinstance(times, list) or not all(isinstance(value, str) for value in times):
        raise ValueError("hourly.time is missing or not a list of strings")
    try:
        valid_time = pl.Series("valid_time", times, dtype=pl.String).str.to_datetime(
            _TIME_FORMAT, time_zone="UTC", time_unit="us"
        )
    except pl.exceptions.PolarsError as exc:
        raise ValueError(f"hourly.time has a value that is not {_TIME_FORMAT}: {exc}") from exc
    if valid_time.is_duplicated().any():
        raise ValueError("hourly.time has duplicate hours")

    series: dict[str, list[float | None]] = {}
    for name, variable in requested.items():
        if name not in hourly:
            continue
        unit = units.get(name)
        if unit != variable.unit:
            found = "no unit" if unit is None else f"unit {unit!r}"
            raise ValueError(f"{name} has {found}, expected {variable.unit!r}")
        series[name] = _numbers(name, hourly[name], len(times), variable.divisor)
    if not series:
        raise ValueError(f"the response holds none of the {len(requested)} requested series")

    elevation = payload.get("elevation")
    if elevation is not None and not _is_number(elevation):
        raise ValueError(f"elevation is not a number: {elevation!r}")
    return _Decoded(
        valid_time=valid_time,
        series=series,
        grid_lat=_grid_coordinate(payload, "latitude"),
        grid_lon=_grid_coordinate(payload, "longitude"),
        grid_elev_m=None if elevation is None else float(elevation),
    )


def _validator(requested: Mapping[str, _Variable]) -> Callable[[bytes], None]:
    def validate(body: bytes) -> None:
        _decode(body, requested)

    return validate


def _to_frame(decoded: _Decoded, *, station: Station, model: NwpModel, leads: Sequence[int]) -> pl.DataFrame:
    """One row per hour and lead, hour by hour, in the shape of ``FORECAST_SCHEMA``."""
    hours = decoded.valid_time.len()
    per_lead: list[pl.DataFrame] = []
    for lead in leads:
        columns = [decoded.valid_time]
        for variable in _VARIABLES:
            values = decoded.series.get(_series_name(variable.name, lead), [None] * hours)
            columns.append(pl.Series(variable.column, values, dtype=pl.Float64))
        per_lead.append(pl.DataFrame(columns).with_columns(pl.lit(lead, dtype=pl.Int8).alias("lead_days")))
    frame = pl.concat(per_lead).with_columns(
        pl.lit(station.icao, dtype=pl.String).alias("station"),
        pl.lit(model.value, dtype=pl.String).alias("model"),
        pl.lit(decoded.grid_lat, dtype=pl.Float64).alias("grid_lat"),
        pl.lit(decoded.grid_lon, dtype=pl.Float64).alias("grid_lon"),
        pl.lit(decoded.grid_elev_m, dtype=pl.Float64).alias("grid_elev_m"),
    )
    return conform(frame.sort("valid_time", "lead_days"), FORECAST_SCHEMA)  # the port's schema and column order


class OpenMeteoPreviousRunsSource:
    """A ``WeatherForecastSource`` over the Open-Meteo Previous Runs API."""

    def __init__(self, client: httpx2.AsyncClient, base_url: str, cache: RawResponseCache | None) -> None:
        """Use ``client`` for ``base_url`` (``Settings.open_meteo_previous_runs_url``); bodies are kept in ``cache``."""
        self._client = client
        self._base_url = base_url
        self._cache = cache

    async def previous_runs(
        self, *, station: Station, model: NwpModel, start: date, end: date, leads_days: Sequence[int]
    ) -> pl.DataFrame:
        """Return the model's forecasts for the station's grid cell, as ``FORECAST_SCHEMA`` rows.

        One request covers all six variables for every lead asked for. The leads are asked for once each and in
        ascending order, and the frame lists each hour with its leads in that order. ``grid_lat``, ``grid_lon`` and
        ``grid_elev_m`` are the cell Open-Meteo chose (its nearest land cell, not always the geometrically nearest),
        not the station's position. A series the response lacks is a null column, and a value it holds as null (or
        NaN) is null.

        A request without hours (``start > end``) or without leads returns an empty frame with the schema and makes no
        call.

        Raises:
            ValueError: A lead is outside 0 to 7, or a cached body, which is not checked again, no longer passes the
                checks a fresh body must.
            UpstreamError: Open-Meteo did not answer (the status says what it said: a 400 carries the API's reason),
                or answered with something unusable: an error body, a unit other than the expected one, a series that
                is not numbers, a time axis that is not UTC.
        """
        leads = _leads(leads_days)
        if start > end or not leads:
            return pl.DataFrame(schema=FORECAST_SCHEMA)
        requested = _requested(leads)
        body = await get_bytes(
            self._client,
            self._base_url,
            _params(station, model, start, end, list(requested)),
            cache=self._cache,
            validate=_validator(requested),
        )
        decoded = await asyncio.to_thread(_decode, body, requested)
        return _to_frame(decoded, station=station, model=model, leads=leads)
