"""``corrected_forecast``: what is fetched for one station and day, and that the corrector is asked once with it."""

import threading
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from typing import Any

import polars as pl
import pytest

from stellar_blaze.adapters.fakes.corrector import FakeCorrector
from stellar_blaze.adapters.fakes.weather import InMemoryForecastSource, InMemoryObservationSource
from stellar_blaze.application.correct_forecast import corrected_forecast
from stellar_blaze.domain.forecast.schemas import CORRECTED_FORECAST_SCHEMA
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, OBS_HOURLY_SCHEMA
from stellar_blaze.domain.weather.stations import station
from tests.unit.application.support import forecast_rows, raw_reports

pytestmark = pytest.mark.unit

OMAA = station("OMAA")
DAY = date(2025, 7, 20)
IFS, GFS = NwpModel.ECMWF_IFS025, NwpModel.GFS_SEAMLESS


def at(month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2025, month, day, hour, minute, tzinfo=UTC)


class RecordingObservations:
    """Wraps a source and records the windows it is asked for."""

    def __init__(self, inner: InMemoryObservationSource) -> None:
        self.inner = inner
        self.name = inner.name
        self.windows: list[tuple[datetime, datetime]] = []

    async def observations(self, *, station: Any, start: datetime, end: datetime) -> pl.DataFrame:
        self.windows.append((start, end))
        return await self.inner.observations(station=station, start=start, end=end)


class RecordingForecasts:
    """Wraps a source and records every call of ``previous_runs``."""

    def __init__(self, inner: InMemoryForecastSource) -> None:
        self.inner = inner
        self.calls: list[dict[str, Any]] = []

    async def previous_runs(
        self, *, station: Any, model: NwpModel, start: date, end: date, leads_days: Sequence[int]
    ) -> pl.DataFrame:
        self.calls.append({"model": model, "start": start, "end": end, "leads_days": list(leads_days)})
        return await self.inner.previous_runs(station=station, model=model, start=start, end=end, leads_days=leads_days)


class RecordingCorrector:
    """A ``FakeCorrector`` that records its inputs and can declare that it needs the history forecasts."""

    def __init__(self, *, needs_history_forecasts: bool) -> None:
        self._inner = FakeCorrector(0.5)
        self._needs = needs_history_forecasts
        self.calls: list[dict[str, pl.DataFrame | None]] = []
        self.threads: list[int] = []

    @property
    def model_id(self) -> str | None:
        return self._inner.model_id

    @property
    def needs_history_forecasts(self) -> bool:
        return self._needs

    def correct(
        self,
        *,
        ifs: pl.DataFrame,
        gfs: pl.DataFrame,
        history: pl.DataFrame,
        history_ifs: pl.DataFrame | None = None,
    ) -> pl.DataFrame:
        self.threads.append(threading.get_ident())
        self.calls.append({"ifs": ifs, "gfs": gfs, "history": history, "history_ifs": history_ifs})
        return self._inner.correct(ifs=ifs, gfs=gfs, history=history, history_ifs=history_ifs)

    def sample(self, corrected: pl.DataFrame, *, n_samples: int, seed: int) -> Any:
        return self._inner.sample(corrected, n_samples=n_samples, seed=seed)


def _forecasts() -> RecordingForecasts:
    """IFS and GFS rows at 10 UTC: leads 1-3 for DAY, and leads 1 and 2 for each date from 07-08 to 07-20."""
    today = [datetime.combine(DAY, datetime.min.time(), tzinfo=UTC) + timedelta(hours=10)]
    past = [at(7, day, 10) for day in range(8, 21)]
    return RecordingForecasts(
        InMemoryForecastSource(
            {
                ("OMAA", IFS): pl.concat(
                    [
                        forecast_rows("OMAA", IFS, hours=today, leads=[1, 2, 3]),
                        forecast_rows("OMAA", IFS, hours=past, leads=[1, 2]),
                    ]
                ).unique(["station", "model", "valid_time", "lead_days"], maintain_order=True),
                ("OMAA", GFS): forecast_rows("OMAA", GFS, hours=today, leads=[1, 2, 3]),
            }
        )
    )


def _observations(reports: Sequence[dict[str, Any]] = ()) -> RecordingObservations:
    return RecordingObservations(InMemoryObservationSource({"OMAA": raw_reports("OMAA", list(reports))}))


async def _run(
    forecasts: RecordingForecasts,
    observations: RecordingObservations,
    corrector: RecordingCorrector,
    leads: Sequence[int] = (1, 2, 3),
    day: date = DAY,
) -> pl.DataFrame:
    return await corrected_forecast(
        forecasts=forecasts,
        observations=observations,
        corrector=corrector,
        station=OMAA,
        valid_date=day,
        leads_days=leads,
    )


@pytest.mark.asyncio
async def test_corrected_forecast_history_window() -> None:
    """For leads 1-3 and D = 2025-07-20 the observations asked for are the UTC dates 07-10 to 07-18."""
    observations = _observations()
    await _run(_forecasts(), observations, RecordingCorrector(needs_history_forecasts=False))
    assert observations.windows == [
        (at(7, 10, 0), at(7, 19, 0))
    ]  # [D - 3 - 7, D - 1 - 1] = 07-10 .. 07-18, end exclusive


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("leads", "first", "last"),
    [((1, 2, 3), 10, 18), ((3, 1, 2, 2), 10, 18), ((2,), 11, 17), ((5, 2), 8, 17), ((7,), 6, 12)],
)
async def test_the_window_runs_from_max_lead_plus_7_to_min_lead_plus_1_days_before(
    leads: tuple[int, ...], first: int, last: int
) -> None:
    observations = _observations()
    await _run(_forecasts(), observations, RecordingCorrector(needs_history_forecasts=False), leads)
    assert observations.windows == [(at(7, first, 0), at(7, last + 1, 0))]


@pytest.mark.asyncio
async def test_ifs_and_gfs_are_fetched_for_the_valid_date_and_the_requested_leads() -> None:
    forecasts, corrector = _forecasts(), RecordingCorrector(needs_history_forecasts=False)
    out = await _run(forecasts, _observations(), corrector, (3, 1, 2))
    assert forecasts.calls == [
        {"model": IFS, "start": DAY, "end": DAY, "leads_days": [1, 2, 3]},
        {"model": GFS, "start": DAY, "end": DAY, "leads_days": [1, 2, 3]},
    ], "no history-forecast fetch for a corrector that does not need it"
    (call,) = corrector.calls
    assert call["history_ifs"] is None
    assert call["ifs"] is not None
    assert call["gfs"] is not None
    assert (call["ifs"].height, call["gfs"].height) == (3, 3)
    assert out.schema == CORRECTED_FORECAST_SCHEMA
    assert out.height == 3 * 4


@pytest.mark.asyncio
async def test_history_forecasts_are_fetched_only_for_a_corrector_that_needs_them() -> None:
    forecasts, corrector = _forecasts(), RecordingCorrector(needs_history_forecasts=True)
    await _run(forecasts, _observations(), corrector)
    assert forecasts.calls[-1] == {
        "model": IFS,
        "start": date(2025, 7, 10),
        "end": date(2025, 7, 18),
        "leads_days": [1],
    }
    assert len(forecasts.calls) == 3
    (call,) = corrector.calls
    past = call["history_ifs"]
    assert past is not None
    assert past.schema == FORECAST_SCHEMA
    assert set(past["lead_days"].to_list()) == {1}
    assert past["valid_time"].min() == at(7, 10, 10)
    assert past["valid_time"].max() == at(7, 18, 10)


@pytest.mark.asyncio
async def test_the_history_is_binned_to_utc_hours_and_cut_at_utc_dates() -> None:
    """A GST date is not a UTC date: 21:00 UTC on 07-09 is 01:00 GST on 07-10 and must stay out of the window."""
    reports = [
        {"obs_time": at(7, 9, 21, 0), "t_c": 40.0, "td_c": 10.0, "wind_ms": 1.0},  # 07-10 01:00 GST, UTC date 07-09
        {"obs_time": at(7, 9, 23, 50), "t_c": 41.0, "td_c": 10.0, "wind_ms": 1.0},  # before the request window
        {"obs_time": at(7, 10, 0, 10), "t_c": 31.0, "td_c": 11.0, "wind_ms": 3.0},  # first bin, 07-10 00:00 UTC
        {"obs_time": at(7, 18, 23, 10), "t_c": 32.0, "td_c": 12.0, "wind_ms": 4.0},  # last bin, 07-18 23:00 UTC
        {"obs_time": at(7, 18, 23, 40), "t_c": 33.0, "td_c": 13.0, "wind_ms": 5.0},  # rounds to 07-19 00:00: out
        {"obs_time": at(7, 19, 0, 10), "t_c": 34.0, "td_c": 14.0, "wind_ms": 6.0},  # 07-19 UTC: after the window
    ]
    corrector = RecordingCorrector(needs_history_forecasts=False)
    await _run(_forecasts(), _observations(reports), corrector)
    history = corrector.calls[0]["history"]
    assert history is not None
    assert history.schema == OBS_HOURLY_SCHEMA
    assert history["valid_time"].to_list() == [at(7, 10, 0), at(7, 18, 23)]
    assert history["t_c"].to_list() == [31.0, 32.0]


@pytest.mark.asyncio
@pytest.mark.parametrize("leads", [(), (0,), (8,), (1, 0), (-1,)])
async def test_leads_outside_one_to_seven_are_refused_before_any_request(leads: tuple[int, ...]) -> None:
    forecasts, observations = _forecasts(), _observations()
    corrector = RecordingCorrector(needs_history_forecasts=True)
    with pytest.raises(ValueError, match="leads_days"):
        await _run(forecasts, observations, corrector, leads)
    assert not forecasts.calls
    assert not observations.windows
    assert not corrector.calls


class _WrongStation:
    """A source that answers with the reports of another station than the one asked for."""

    name = "wrong"

    async def observations(self, *, station: Any, start: datetime, end: datetime) -> pl.DataFrame:
        return raw_reports("OMDB", [{"obs_time": at(7, 12, 0), "t_c": 30.0}])


@pytest.mark.asyncio
async def test_reports_of_another_station_are_refused() -> None:
    corrector = RecordingCorrector(needs_history_forecasts=False)
    with pytest.raises(ValueError, match="returned reports of"):
        await corrected_forecast(
            forecasts=_forecasts(),
            observations=_WrongStation(),
            corrector=corrector,
            station=OMAA,
            valid_date=DAY,
            leads_days=[1],
        )
    assert not corrector.calls


@pytest.mark.asyncio
async def test_the_corrector_result_is_returned_unchanged() -> None:
    corrector = RecordingCorrector(needs_history_forecasts=False)
    out = await _run(_forecasts(), _observations(), corrector)
    (call,) = corrector.calls
    assert call["ifs"] is not None
    assert call["gfs"] is not None
    assert call["history"] is not None
    assert out.equals(FakeCorrector(0.5).correct(ifs=call["ifs"], gfs=call["gfs"], history=call["history"]))


@pytest.mark.asyncio
async def test_the_corrector_runs_in_a_worker_thread_so_the_event_loop_is_not_blocked() -> None:
    corrector = RecordingCorrector(needs_history_forecasts=False)

    await _run(_forecasts(), _observations(), corrector)

    (worker,) = corrector.threads
    assert worker != threading.get_ident()  # the loop's own thread would block a single-worker API for 0.36 s a call
