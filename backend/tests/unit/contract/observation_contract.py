"""Contract suite for ``ObservationSource``, run against the in-memory fake and the real adapters.

Import it as ``from tests.unit.contract.observation_contract import check_observation_source``.

The suite makes two calls, and each may be a separate request to the source: the window ``[start, end)`` and then
the empty window ``[start, start)``. An adapter that talks to an HTTP API is tested with an ``httpx2.MockTransport``,
and the handler must answer by request: it keys its response on the window parameters each request carries and serves
a body with no reports in the window (for IEM a header-only CSV). It must not assert a fixed request sequence or
count: an adapter may answer the empty window without any request. GHCNh has no per-window request at all, because it
downloads the whole by-year file and filters it, so a "body with no reports in the window" there is the same by-year
file, which the adapter filters down to an empty frame.
"""

from datetime import datetime

import polars as pl

from stellar_blaze.domain.weather.schemas import OBS_RAW_SCHEMA
from stellar_blaze.domain.weather.stations import Station
from stellar_blaze.ports.weather import ObservationSource
from tests.unit.contract.frame_schema import assert_frame_has_schema


async def check_observation_source(source: ObservationSource, station: Station, start: datetime, end: datetime) -> None:
    """Assert that ``source`` honors the ``ObservationSource`` port for one station and window.

    The window must hold at least one report; otherwise every check on its rows would pass vacuously.

    Checks, in this order:
        * the frame has exactly the ``OBS_RAW_SCHEMA`` columns, order and dtypes, and at least one row;
        * every row is for ``station`` and has a non-null ``obs_time`` with ``start <= obs_time < end``;
        * every row's ``source`` is ``source.name`` (the port says ``name`` is what the column carries);
        * the empty window ``[start, start)`` returns zero rows with the full schema and does not raise.

    Args:
        source: The source under test.
        station: The station to ask for.
        start: Start of the window, inclusive; timezone-aware.
        end: End of the window, exclusive; timezone-aware and after ``start``.

    Raises:
        AssertionError: The source breaks the port; the message names the source, the station and the window.
    """
    assert start.tzinfo is not None, f"the contract window start {start.isoformat()} must be timezone-aware"
    assert end.tzinfo is not None, f"the contract window end {end.isoformat()} must be timezone-aware"
    assert start < end, f"the contract window [{start.isoformat()}, {end.isoformat()}) must not be empty"

    where = f"{source.name} observations for {station.icao} in [{start.isoformat()}, {end.isoformat()})"
    frame = await source.observations(station=station, start=start, end=end)
    assert_frame_has_schema(frame, OBS_RAW_SCHEMA, where)
    assert frame.height > 0, (
        f"{where}: no rows; use a window with at least one report so the checks below are not vacuous"
    )

    null_times = frame["obs_time"].null_count()
    assert null_times == 0, f"{where}: {null_times} rows have a null obs_time"

    other_stations = frame.filter(pl.col("station").ne_missing(station.icao))
    assert other_stations.height == 0, (
        f"{where}: {other_stations.height} rows are not for station {station.icao}, "
        f"found {other_stations['station'].unique().to_list()}"
    )

    outside = frame.filter((pl.col("obs_time") < start) | (pl.col("obs_time") >= end))
    assert outside.height == 0, (
        f"{where}: {outside.height} rows have obs_time outside [start, end), "
        f"for example {outside['obs_time'].head(3).to_list()}"
    )

    other_sources = frame.filter(pl.col("source").ne_missing(source.name))
    assert other_sources.height == 0, (
        f"{where}: {other_sources.height} rows have a source other than {source.name!r}, "
        f"found {other_sources['source'].unique().to_list()}"
    )

    empty_where = (
        f"{source.name} observations for {station.icao}, empty window [{start.isoformat()}, {start.isoformat()})"
    )
    try:
        empty = await source.observations(station=station, start=start, end=start)
    except Exception as exc:
        raise AssertionError(
            f"{empty_where}: raised {type(exc).__name__}: {exc}; an empty window must return an empty frame"
        ) from exc
    assert_frame_has_schema(empty, OBS_RAW_SCHEMA, empty_where)
    assert empty.height == 0, f"{empty_where}: returned {empty.height} rows, expected none"
