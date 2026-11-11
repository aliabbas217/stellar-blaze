"""Contract suite for ``WeatherForecastSource``, run against the in-memory fake and the real adapters.

Import it as ``from tests.unit.contract.forecast_contract import check_forecast_source``.

The suite makes one call. An adapter that talks to an HTTP API is tested with an ``httpx2.MockTransport``; as with
every contract here, the handler should answer by request (key the response on the request's parameters) rather than
assert a fixed request sequence.
"""

from collections.abc import Sequence
from datetime import date

import polars as pl

from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA
from stellar_blaze.domain.weather.stations import Station
from stellar_blaze.ports.weather import WeatherForecastSource
from tests.unit.contract.frame_schema import assert_frame_has_schema


async def check_forecast_source(
    source: WeatherForecastSource,
    station: Station,
    model: NwpModel,
    start: date,
    end: date,
    leads_days: Sequence[int],
) -> None:
    """Assert that ``source`` honors the ``WeatherForecastSource`` port for one station, model and date range.

    The request must be answerable with at least one row; otherwise every check on the rows would pass vacuously.

    Checks, in this order:
        * the frame has exactly the ``FORECAST_SCHEMA`` columns, order and dtypes, and at least one row;
        * ``station``, ``model``, ``valid_time`` and ``lead_days`` are never null, and every row is for ``station``
          and ``model``;
        * the set of ``lead_days`` equals the set requested;
        * every ``valid_time`` falls on a UTC date in ``[start, end]``;
        * each ``valid_time`` has exactly one row per requested lead (missing upstream values are nulls, not missing
          rows).

    Args:
        source: The source under test.
        station: The station to ask for.
        model: The NWP model to ask for.
        start: First UTC date of the valid time, inclusive.
        end: Last UTC date of the valid time, inclusive.
        leads_days: The leads to ask for, in days before the valid time; not empty.

    Raises:
        AssertionError: The source breaks the port; the message names the source, the station, the model and the dates.
    """
    assert start <= end, f"the contract date range {start.isoformat()}..{end.isoformat()} must not be empty"
    assert leads_days, "the contract needs at least one lead"
    wanted = sorted(set(leads_days))

    where = (
        f"{type(source).__name__} forecasts for {station.icao}/{model.value} on {start.isoformat()}..{end.isoformat()}"
    )
    frame = await source.previous_runs(station=station, model=model, start=start, end=end, leads_days=leads_days)
    assert_frame_has_schema(frame, FORECAST_SCHEMA, where)
    assert frame.height > 0, f"{where}: no rows; use a range with forecasts so the checks below are not vacuous"

    for column in ("station", "model", "valid_time", "lead_days"):
        nulls = frame[column].null_count()
        assert nulls == 0, f"{where}: {nulls} rows have a null {column}"

    other_stations = frame.filter(pl.col("station") != station.icao)
    assert other_stations.height == 0, (
        f"{where}: {other_stations.height} rows are not for station {station.icao}, "
        f"found {other_stations['station'].unique().to_list()}"
    )
    other_models = frame.filter(pl.col("model") != model.value)
    assert other_models.height == 0, (
        f"{where}: {other_models.height} rows are not for model {model.value}, "
        f"found {other_models['model'].unique().to_list()}"
    )

    got = sorted(set(frame["lead_days"].to_list()))
    assert got == wanted, f"{where}: lead_days {got} differ from the requested {wanted}"

    outside = frame.filter(~pl.col("valid_time").dt.date().is_between(start, end))
    assert outside.height == 0, (
        f"{where}: {outside.height} rows have a valid_time date outside {start.isoformat()}..{end.isoformat()}, "
        f"for example {outside['valid_time'].head(3).to_list()}"
    )

    per_hour = frame.group_by("valid_time").agg(pl.len().alias("rows"), pl.col("lead_days").n_unique().alias("leads"))
    irregular = per_hour.filter((pl.col("rows") != len(wanted)) | (pl.col("leads") != len(wanted))).sort("valid_time")
    assert irregular.height == 0, (
        f"{where}: {irregular.height} valid times do not have exactly one row per requested lead ({len(wanted)}); "
        f"the first is {irregular['valid_time'][0]} with {irregular['rows'][0]} rows and {irregular['leads'][0]} leads"
    )
