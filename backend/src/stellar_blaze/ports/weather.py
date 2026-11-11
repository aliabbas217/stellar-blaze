"""Ports for the upstream weather data: observed truth and archived forecasts.

Both return Polars frames in the schemas of ``stellar_blaze.domain.weather.schemas``. ``name`` is read-only on purpose,
so an adapter may declare it as an attribute, a class variable, a property or a frozen dataclass field.
"""

from collections.abc import Sequence
from datetime import date, datetime
from typing import Protocol

import polars as pl

from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.stations import Station


class ObservationSource(Protocol):
    """Observed weather at a station: the truth that forecasts are scored against."""

    @property
    def name(self) -> str:
        """Short identifier of the source, used in logs and in the ``source`` column."""
        ...

    async def observations(self, *, station: Station, start: datetime, end: datetime) -> pl.DataFrame:
        """Return the station's reports with ``start <= obs_time < end``, as ``OBS_RAW_SCHEMA`` rows.

        ``start`` and ``end`` are timezone-aware. A window without reports, including an empty one, returns an empty
        frame with the full schema; it never raises. Failures of the upstream service raise.
        """
        ...


class WeatherForecastSource(Protocol):
    """Archived numerical-weather-prediction forecasts, as issued some days before the hour they predict."""

    async def previous_runs(
        self, *, station: Station, model: NwpModel, start: date, end: date, leads_days: Sequence[int]
    ) -> pl.DataFrame:
        """Return the model's forecasts for the station's grid cell, as ``FORECAST_SCHEMA`` rows.

        ``start`` and ``end`` are inclusive UTC dates of the valid time. The frame has one row per valid hour and
        requested lead; a value the upstream service does not hold is null, not a missing row. Failures of the
        upstream service raise.

        Raises:
            ValueError: A lead is outside 0 to 7 (``LEADS_DAYS``), the range the Previous Runs archive serves. Real
                adapters and the in-memory fake alike refuse it before any request.
        """
        ...
