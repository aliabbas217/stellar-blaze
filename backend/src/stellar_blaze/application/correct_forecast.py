"""The corrected-forecast use case: fetch what a corrector needs for one station and day, and ask it to correct.

``corrected_forecast`` knows the ports only (``WeatherForecastSource``, ``ObservationSource``, ``ForecastCorrector``);
it never imports an adapter (the layers contract). All dates are UTC dates: the valid date and every history date are
the UTC date of the instant, never the GST date (the modelled hours 02-15 UTC have the same date in both, but a history
window counted in GST days would shift by one at the edges).

What is fetched, for a valid date ``D`` and leads ``L``:

* IFS and GFS previous runs for ``D``, every requested lead (the forecasts to correct and the GFS features);
* IEM observations for the UTC dates ``[D - max(L) - 7, D - min(L) - 1]``, binned to the nearest UTC hour
  (``bin_to_nearest_hour``, no QC codes). The upper end is the last day any requested lead may use (a forecast issued
  on ``D - L`` knows the truth up to ``D - L - 1``, pre-registration L3) and the lower end is 7 days before the earliest
  issue day of the longest lead. The request is ``[first day 00:00 UTC, last day + 1 00:00 UTC)``, like the ingest of
  the hindcast dataset; the corrector cuts the window per row itself;
* only when the corrector declares ``needs_history_forecasts``: the IFS lead-1 previous runs for the same dates
  (``history_ifs``), because the station-history features are past lead-1 forecast errors.
"""

import asyncio
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Final

import polars as pl

from stellar_blaze.domain.forecast.grid import MODEL_LEADS
from stellar_blaze.domain.weather.binning import bin_to_nearest_hour
from stellar_blaze.domain.weather.models import NwpModel, QcPolicy
from stellar_blaze.domain.weather.schemas import OBS_RAW_SCHEMA, conform
from stellar_blaze.domain.weather.stations import Station
from stellar_blaze.ports.corrector import ForecastCorrector
from stellar_blaze.ports.weather import ObservationSource, WeatherForecastSource

__all__ = ["corrected_forecast"]

_HISTORY_DAYS: Final = 7
_HISTORY_LEAD: Final = MODEL_LEADS[0]


def _start_of(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=UTC)


async def _history(source: ObservationSource, station: Station, first: date, last: date) -> pl.DataFrame:
    """The station's hourly observations for the UTC dates ``first`` to ``last`` inclusive (``OBS_HOURLY_SCHEMA``)."""
    raw = conform(
        await source.observations(station=station, start=_start_of(first), end=_start_of(last + timedelta(days=1))),
        OBS_RAW_SCHEMA,
    )
    foreign = raw.filter(pl.col("station") != station.icao)["station"].unique().to_list()
    if foreign:
        raise ValueError(f"{source.name} returned reports of {foreign} when asked for {station.icao}")
    hourly, _ = bin_to_nearest_hour(raw, qc_policy=QcPolicy.NONE)
    return hourly.filter(
        pl.col("valid_time").is_between(_start_of(first), _start_of(last + timedelta(days=1)), closed="left")
    )


async def corrected_forecast(
    *,
    forecasts: WeatherForecastSource,
    observations: ObservationSource,
    corrector: ForecastCorrector,
    station: Station,
    valid_date: date,
    leads_days: Sequence[int],
) -> pl.DataFrame:
    """The corrected forecast of one station for one UTC valid date and the given leads.

    ``corrector.correct`` is a synchronous, CPU-bound call (0.36 s per station-day was measured, dominated by the WBGT
    solver), so it runs in a worker thread (``asyncio.to_thread``): a single-worker API keeps serving other requests
    while one is corrected. A corrector must therefore be safe to call from a thread (``LightGbmCorrector`` keeps no
    state; the fake neither).

    The IEM observations are fetched for every corrector: the port exposes no way to ask whether a corrector ignores
    ``history`` (``needs_history_forecasts`` is about ``history_ifs`` only), so a ``cold`` model still pays that fetch.
    Skipping it would need a port property, which is parked, not guessed from the forecasts flag.

    Args:
        forecasts: Source of the IFS and GFS previous runs.
        observations: Source of the station's observations (IEM).
        corrector: The corrector (a ``LightGbmCorrector`` or the fake).
        station: The station to correct for.
        valid_date: The UTC date of the valid time.
        leads_days: The leads in days, each within 1 to 7 (lead 0 is same-day information and never a forecast to
            correct).

    Returns:
        The corrector's ``CORRECTED_FORECAST_SCHEMA`` frame, four rows per forecast row.

    Raises:
        ValueError: ``leads_days`` is empty or has a lead outside 1 to 7; a source returned reports of another
            station.
        SchemaMismatchError: A source's frame does not follow the port's schema.
        UpstreamError: A source could not be reached (from the adapters).
    """
    leads = sorted(set(leads_days))
    if not leads or leads[0] < MODEL_LEADS[0] or leads[-1] > MODEL_LEADS[-1]:
        raise ValueError(
            f"leads_days must be a non-empty selection of {MODEL_LEADS[0]}..{MODEL_LEADS[-1]}, got {list(leads_days)}"
        )
    first = valid_date - timedelta(days=leads[-1] + _HISTORY_DAYS)
    last = valid_date - timedelta(days=leads[0] + 1)
    # One request after the other: the sources pace their own upstream calls, and an error then reaches the caller as
    # the error itself (a task group would wrap it in an ExceptionGroup).
    ifs = await forecasts.previous_runs(
        station=station, model=NwpModel.ECMWF_IFS025, start=valid_date, end=valid_date, leads_days=leads
    )
    gfs = await forecasts.previous_runs(
        station=station, model=NwpModel.GFS_SEAMLESS, start=valid_date, end=valid_date, leads_days=leads
    )
    history = await _history(observations, station, first, last)
    history_ifs = (
        await forecasts.previous_runs(
            station=station, model=NwpModel.ECMWF_IFS025, start=first, end=last, leads_days=[_HISTORY_LEAD]
        )
        if corrector.needs_history_forecasts
        else None
    )
    return await asyncio.to_thread(corrector.correct, ifs=ifs, gfs=gfs, history=history, history_ifs=history_ifs)
