"""Fake sources and seeded data for the job tests (kept apart from the ``test_*`` modules so it is imported, not
collected)."""

from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import polars as pl
import pytest
from pydantic import JsonValue

from stellar_blaze.adapters.fakes.weather import InMemoryForecastSource, InMemoryObservationSource
from stellar_blaze.composition import Sources
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.stations import Station
from stellar_blaze.jobs import runner
from tests.unit.application.support import forecast_rows, hours_from, raw_reports

SUMMER = 2025
FIRST_HOUR = datetime(SUMMER, 7, 1, tzinfo=UTC)


def iem_frames(*icaos: str) -> dict[str, pl.DataFrame]:
    """One IEM report per hour of 1 July (a METAR at HH:00), plus a null temperature at 03:00."""
    return {icao: raw_reports(icao, _hourly_reports(icao), source="iem") for icao in icaos}


def ghcnh_frames(*icaos: str) -> dict[str, pl.DataFrame]:
    """One GHCNh report per hour of 1 July; the one at 12:00 has a flagged temperature of 47.7 (QC code 3)."""
    frames = {}
    for icao in icaos:
        reports = _hourly_reports(icao)
        reports[12] = reports[12] | {"t_c": 47.7, "qc_t": "3"}
        frames[icao] = raw_reports(icao, reports, source="ghcnh")
    return frames


def _hourly_reports(icao: str) -> list[dict[str, Any]]:
    offset = sum(map(ord, icao)) % 5  # a little difference between stations
    reports: list[dict[str, Any]] = [
        {
            "obs_time": FIRST_HOUR + timedelta(hours=hour),
            "t_c": 30.0 + offset + hour / 4,
            "td_c": 12.0 + offset / 2,
            "wind_ms": 3.0 + hour / 10,
        }
        for hour in range(24)
    ]
    reports[3] = reports[3] | {"t_c": None}
    return reports


def forecasts_for(icao: str, model: NwpModel) -> pl.DataFrame:
    """Every hour of 1 July at leads 0 to 7, with a lead-dependent temperature."""
    return pl.concat(
        [
            forecast_rows(icao, model, hours=hours_from(FIRST_HOUR, 24), leads=[lead], t_c=33.0 + lead)
            for lead in range(8)
        ]
    )


def fake_sources(
    icaos: tuple[str, ...] = ("OMAA", "OMDB"),
    models: tuple[NwpModel, ...] = (NwpModel.ECMWF_IFS025, NwpModel.GFS_SEAMLESS),
) -> Sources:
    """The sources of a job run, as in-memory fakes seeded for ``icaos`` and ``models``."""
    return Sources(
        observations={
            "iem": InMemoryObservationSource(iem_frames(*icaos), name="iem"),
            "ghcnh": InMemoryObservationSource(ghcnh_frames(*icaos), name="ghcnh"),
        },
        forecasts=InMemoryForecastSource(
            {(icao, model): forecasts_for(icao, model) for icao in icaos for model in models}
        ),
    )


class FailingObservations:
    """An observation source whose every request fails with ``error``."""

    def __init__(self, name: str, error: Exception) -> None:
        self.name = name
        self.error = error
        self.calls: list[str] = []

    async def observations(self, *, station: Station, start: datetime, end: datetime) -> pl.DataFrame:
        self.calls.append(station.icao)
        raise self.error


class FailingForecasts:
    """A forecast source whose every request fails with ``error``."""

    def __init__(self, error: Exception) -> None:
        self.error = error

    async def previous_runs(
        self, *, station: Station, model: NwpModel, start: date, end: date, leads_days: Any
    ) -> pl.DataFrame:
        raise self.error


class FakeRuns:
    """A ``JobRunRepository`` that records what it is told, and can fail to record a failure."""

    def __init__(self, finish_error: Exception | None = None) -> None:
        self.finish_error = finish_error
        self.finished: list[tuple[str, Mapping[str, JsonValue] | None, str | None]] = []
        self.skipped: list[tuple[str, Mapping[str, JsonValue]]] = []

    async def start(self, job_name: str, params: Mapping[str, JsonValue], code_version: str | None) -> UUID:
        return uuid4()

    async def finish(
        self, run_id: UUID, status: str, summary: Mapping[str, JsonValue] | None, error: str | None
    ) -> None:
        if self.finish_error is not None:
            raise self.finish_error
        self.finished.append((status, summary, error))

    async def record_skipped(self, job_name: str, params: Mapping[str, JsonValue]) -> UUID:
        self.skipped.append((job_name, params))
        return uuid4()


class FakeEngine:
    async def dispose(self) -> None:
        return None


class FakeLock:
    """Stands in for ``advisory_lock``: records the keys it is asked for and grants or refuses the lock."""

    def __init__(self, *, granted: bool = True) -> None:
        self.granted = granted
        self.keys: list[str] = []

    @asynccontextmanager
    async def __call__(self, engine: object, key: str) -> AsyncIterator[bool]:
        self.keys.append(key)
        yield self.granted


def use_fake_database(monkeypatch: pytest.MonkeyPatch, runs: FakeRuns, lock: FakeLock | None = None) -> FakeLock:
    """Replace what ``run_job`` reaches the database through; returns the lock fake (granted unless one is given)."""
    lock = FakeLock() if lock is None else lock
    monkeypatch.setattr(runner, "build_engine", lambda settings: FakeEngine())
    monkeypatch.setattr(runner, "JobRunRepository", lambda engine: runs)
    monkeypatch.setattr(runner, "advisory_lock", lock)
    return lock
