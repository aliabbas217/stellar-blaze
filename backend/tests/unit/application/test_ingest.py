"""The fetch use cases: the research's observation window and binning, and the forecast archive limits."""

from collections.abc import Sequence
from datetime import UTC, date, datetime

import polars as pl
import pytest

from stellar_blaze.adapters.fakes.weather import InMemoryForecastSource, InMemoryObservationSource
from stellar_blaze.application.ingest import (
    QC_POLICY_BY_SOURCE,
    NoForecastsError,
    fetch_forecasts,
    fetch_hourly_observations,
)
from stellar_blaze.domain.weather.models import LEADS_DAYS, NwpModel, QcPolicy, summer_window
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, OBS_HOURLY_SCHEMA
from stellar_blaze.domain.weather.stations import station
from tests.unit.application.support import forecast_rows, hours_from, raw_reports

pytestmark = pytest.mark.unit

OMAA = station("OMAA")
OMDB = station("OMDB")


def at(month: int, day: int, hour: int, minute: int = 0, *, year: int = 2025) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=UTC)


class RecordingObservations:
    """Wraps a source and records the windows it is asked for."""

    def __init__(self, inner: InMemoryObservationSource) -> None:
        self.inner = inner
        self.name = inner.name
        self.windows: list[tuple[datetime, datetime]] = []

    async def observations(self, *, station: object, start: datetime, end: datetime) -> pl.DataFrame:
        self.windows.append((start, end))
        return await self.inner.observations(station=station, start=start, end=end)  # type: ignore[arg-type]


class RecordingForecasts:
    """Returns ``frame`` and records the arguments of the call."""

    def __init__(self, frame: pl.DataFrame) -> None:
        self.frame = frame
        self.calls: list[dict[str, object]] = []

    async def previous_runs(
        self, *, station: object, model: NwpModel, start: date, end: date, leads_days: Sequence[int]
    ) -> pl.DataFrame:
        self.calls.append(
            {"station": station, "model": model, "start": start, "end": end, "leads_days": list(leads_days)}
        )
        return self.frame


# === fetch_hourly_observations ======================================================================================


@pytest.mark.asyncio
async def test_fetch_hourly_observations_bins_and_windows() -> None:
    reports = [
        {"obs_time": at(5, 14, 23, 50), "t_c": 30.0, "td_c": 10.0, "wind_ms": 2.0},  # before the fetch window
        {"obs_time": at(5, 15, 0, 10), "t_c": 31.0, "td_c": 11.0, "wind_ms": 3.0},  # the first bin, 15 May 00:00
        {"obs_time": at(9, 30, 23, 10), "t_c": 32.0, "td_c": 12.0, "wind_ms": 4.0},  # the last bin, 30 Sep 23:00
        {"obs_time": at(9, 30, 23, 40), "t_c": 33.0, "td_c": 13.0, "wind_ms": 5.0},  # rounds to 1 Oct 00:00: outside
        {"obs_time": at(10, 1, 0, 5), "t_c": 34.0, "td_c": 14.0, "wind_ms": 6.0},  # after the fetch window
    ]
    source = InMemoryObservationSource({"OMAA": raw_reports("OMAA", reports)})

    hourly, report = await fetch_hourly_observations(source, OMAA, 2025, QcPolicy.NONE)

    first, last = summer_window(2025)
    assert hourly.schema == OBS_HOURLY_SCHEMA
    assert hourly["valid_time"].to_list() == [first, last]
    assert hourly["t_c"].to_list() == [31.0, 32.0]  # 14 May 23:50, 30 Sep 23:40 and 1 Oct 00:05 are all absent
    assert report.n_raw == 3  # the reports the source returned for the fetch window, none of the two outside it


@pytest.mark.asyncio
async def test_the_fetch_window_is_15_may_00_00_to_1_oct_00_00_utc_of_the_summer() -> None:
    source = RecordingObservations(InMemoryObservationSource({}))

    await fetch_hourly_observations(source, OMAA, 2026, QcPolicy.NONE)

    assert source.windows == [(datetime(2026, 5, 15, tzinfo=UTC), datetime(2026, 10, 1, tzinfo=UTC))]


@pytest.mark.asyncio
async def test_a_window_without_reports_gives_an_empty_hourly_frame_and_a_zero_report() -> None:
    source = InMemoryObservationSource({})

    hourly, report = await fetch_hourly_observations(source, OMDB, 2025, QcPolicy.NONE)

    assert hourly.height == 0
    assert hourly.schema == OBS_HOURLY_SCHEMA
    assert report.n_raw == 0
    assert report.n_implausible == {"t_c": 0, "td_c": 0, "wind_ms": 0}


@pytest.mark.asyncio
async def test_the_qc_policy_is_applied_and_counted() -> None:
    reports = [
        {
            "obs_time": at(7, 1, 12),
            "t_c": 47.7,
            "td_c": 9.0,
            "wind_ms": 1.0,
            "qc_t": "3",
            "qc_td": "1",
            "qc_wind": None,
        },
        {"obs_time": at(7, 1, 13), "t_c": 40.0, "td_c": 9.0, "wind_ms": 1.0, "qc_t": None, "qc_td": None},
    ]
    frame = raw_reports("OMAA", reports, source="ghcnh")

    lenient, lenient_report = await fetch_hourly_observations(
        InMemoryObservationSource({"OMAA": frame}, name="ghcnh"), OMAA, 2025, QcPolicy.GHCNH_LENIENT
    )
    plain, plain_report = await fetch_hourly_observations(
        InMemoryObservationSource({"OMAA": frame}, name="ghcnh"), OMAA, 2025, QcPolicy.NONE
    )

    assert lenient["t_c"].to_list() == [None, 40.0]  # the flagged 47.7 is excluded from the audit values ...
    assert lenient_report.n_qc_flagged == {"t_c": 1, "td_c": 0, "wind_ms": 0}  # ... and counted, never silent
    assert plain["t_c"].to_list() == [47.7, 40.0]
    assert plain_report.n_qc_flagged == {"t_c": 0, "td_c": 0, "wind_ms": 0}


def test_each_source_has_the_qc_policy_of_the_research() -> None:
    assert dict(QC_POLICY_BY_SOURCE) == {"iem": QcPolicy.NONE, "ghcnh": QcPolicy.GHCNH_LENIENT}


@pytest.mark.asyncio
async def test_a_source_that_returns_reports_of_another_station_is_refused() -> None:
    class WrongStation:
        name = "iem"

        async def observations(self, *, station: object, start: datetime, end: datetime) -> pl.DataFrame:
            return raw_reports("OMDB", [{"obs_time": at(7, 1, 12), "t_c": 30.0}])

    with pytest.raises(ValueError, match=r"OMDB.*OMAA"):
        await fetch_hourly_observations(WrongStation(), OMAA, 2025, QcPolicy.NONE)


# === fetch_forecasts ================================================================================================


@pytest.mark.asyncio
async def test_fetch_forecasts_refuses_aifs_2024() -> None:
    source = RecordingForecasts(pl.DataFrame(schema=FORECAST_SCHEMA))

    with pytest.raises(ValueError, match=r"ecmwf_aifs025_single.*2024|2024.*ecmwf_aifs025_single") as caught:
        await fetch_forecasts(source, OMAA, NwpModel.ECMWF_AIFS025, 2024)

    assert "2025" in str(caught.value)  # says which summers do exist
    assert source.calls == []  # refused before any request: no quota is spent on a summer that has no archive


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("model", "summer"),
    [
        (NwpModel.ECMWF_IFS025, 2024),
        (NwpModel.GFS_SEAMLESS, 2026),
        (NwpModel.ECMWF_AIFS025, 2025),
    ],
)
async def test_fetch_forecasts_asks_for_15_may_to_30_sep_and_leads_0_to_7(model: NwpModel, summer: int) -> None:
    frame = forecast_rows("OMAA", model, hours=hours_from(datetime(summer, 7, 1, tzinfo=UTC), 2), leads=(0, 1))
    source = RecordingForecasts(frame)

    result = await fetch_forecasts(source, OMAA, model, summer)

    assert result is frame
    assert source.calls == [
        {
            "station": OMAA,
            "model": model,
            "start": date(summer, 5, 15),
            "end": date(summer, 9, 30),
            "leads_days": list(LEADS_DAYS),
        }
    ]
    assert list(LEADS_DAYS) == [0, 1, 2, 3, 4, 5, 6, 7]


@pytest.mark.asyncio
async def test_fetch_forecasts_through_the_in_memory_fake() -> None:
    frame = forecast_rows(
        "OMAA", NwpModel.GFS_SEAMLESS, hours=hours_from(datetime(2025, 7, 1, tzinfo=UTC), 24), leads=range(8)
    )
    source = InMemoryForecastSource({("OMAA", NwpModel.GFS_SEAMLESS): frame})

    result = await fetch_forecasts(source, OMAA, NwpModel.GFS_SEAMLESS, 2025)

    assert result.height == 24 * 8
    assert result.schema == FORECAST_SCHEMA


@pytest.mark.asyncio
async def test_a_forecast_answer_without_rows_is_an_error_not_an_empty_file() -> None:
    source = InMemoryForecastSource({})

    with pytest.raises(NoForecastsError, match=r"OMAA.*ecmwf_ifs025.*2025"):
        await fetch_forecasts(source, OMAA, NwpModel.ECMWF_IFS025, 2025)
