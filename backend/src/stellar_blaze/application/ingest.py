"""The fetch use cases of the hindcast dataset: one station and one summer of observations or forecasts at a time.

They carry the research's rules (``docs/research/scripts/``) and nothing else: which window is asked for, how reports
become hourly values, and which model-summers have an archive. Where the results are stored is the caller's business.
"""

from collections.abc import Mapping
from datetime import timedelta
from types import MappingProxyType
from typing import Final

import polars as pl

from stellar_blaze.domain.weather.binning import BinningReport, bin_to_nearest_hour
from stellar_blaze.domain.weather.models import LEADS_DAYS, MODEL_SUMMERS, NwpModel, QcPolicy, summer_window
from stellar_blaze.domain.weather.schemas import OBS_RAW_SCHEMA, conform
from stellar_blaze.domain.weather.stations import Station
from stellar_blaze.ports.weather import ObservationSource, WeatherForecastSource

# How each observation source's quality codes are read (the research: IEM has none; GHCNh keeps code "1" and blank).
QC_POLICY_BY_SOURCE: Final[Mapping[str, QcPolicy]] = MappingProxyType(
    {"iem": QcPolicy.NONE, "ghcnh": QcPolicy.GHCNH_LENIENT}
)


class NoForecastsError(RuntimeError):
    """The forecast archive answered a request for a station, model and summer without a single row."""


async def fetch_hourly_observations(
    source: ObservationSource, station: Station, summer: int, qc_policy: QcPolicy
) -> tuple[pl.DataFrame, BinningReport]:
    """The station's observations for the summer, binned to the nearest UTC hour, and what binning discarded.

    The source is asked for reports from 15 May 00:00 UTC to 1 Oct 00:00 UTC, exclusive: the window of the research's
    IEM download (it passed the end date 1 Oct, which IEM treats as exclusive). The reports are binned (``qc_policy``
    says how the source's quality codes are read) and only the bins from ``summer_window`` are kept. A report in the
    last half hour of 30 Sep rounds up into 1 Oct 00:00, which is outside the summer, and a first-bin report before
    00:00 on 15 May is not fetched, as in the research.

    Returns:
        The hourly frame (``OBS_HOURLY_SCHEMA``) and the ``BinningReport`` of the reports fetched.

    Raises:
        ValueError: The source returned reports of another station.
        SchemaMismatchError: The source's frame does not follow the port's schema.
        UpstreamError: The source could not be reached (from the adapters).
    """
    first_bin, last_bin = summer_window(summer)
    raw = conform(
        await source.observations(station=station, start=first_bin, end=last_bin + timedelta(hours=1)),
        OBS_RAW_SCHEMA,
    )
    foreign = raw.filter(pl.col("station") != station.icao)["station"].unique().to_list()
    if foreign:
        raise ValueError(f"{source.name} returned reports of {foreign} when asked for {station.icao}")
    hourly, report = bin_to_nearest_hour(raw, qc_policy=qc_policy)
    return hourly.filter(pl.col("valid_time").is_between(first_bin, last_bin)), report


async def fetch_forecasts(
    source: WeatherForecastSource, station: Station, model: NwpModel, summer: int
) -> pl.DataFrame:
    """The model's forecasts for the station's grid cell, every valid hour of the summer at leads 0 to 7 days.

    The dates asked for are 15 May to 30 Sep of the summer (``summer_window``), the research's pull.

    Raises:
        ValueError: The Previous Runs archive holds no data for this model and summer (``MODEL_SUMMERS``); no request
            is made, so no quota is spent.
        NoForecastsError: The archive answered with no rows at all; an empty silver file would only hide that.
        UpstreamError: The source could not be reached (from the adapters).
    """
    available = MODEL_SUMMERS[model]
    if summer not in available:
        raise ValueError(
            f"{model.value} has no Previous Runs archive for {summer}; its summers are {sorted(available)}"
        )
    first_bin, last_bin = summer_window(summer)
    frame = await source.previous_runs(
        station=station, model=model, start=first_bin.date(), end=last_bin.date(), leads_days=LEADS_DAYS
    )
    if frame.is_empty():
        raise NoForecastsError(f"no forecast rows for {station.icao}, {model.value}, {summer}")
    return frame
