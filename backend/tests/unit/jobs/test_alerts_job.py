"""``AlertJob.work``: a stop is escalated even when everything about the forecast fails (a stop needs no forecast)."""

import asyncio
import time
from datetime import UTC, date, datetime
from typing import Any

import polars as pl
import pytest
import structlog
from pydantic import BaseModel, ValidationError

from stellar_blaze.adapters.fakes.notifications import RecordingPushChannel
from stellar_blaze.adapters.http.client import UpstreamError
from stellar_blaze.application.runtime_config import ConfigSnapshot, SnapshotHolder
from stellar_blaze.composition import Runtime
from stellar_blaze.config import Settings
from stellar_blaze.domain.risk.levels import AlertLevel
from stellar_blaze.jobs.alerts import AlertJob, forecast_deadline
from stellar_blaze.ports.push import NewSubscription
from tests.unit.api.support import SITE, build_world
from tests.unit.application.serving_support import catalog, snapshot
from tests.unit.config.support import models

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]
DAY = date(2026, 7, 1)
AT = datetime(2026, 7, 1, 4, 20, tzinfo=UTC)


class _Strict(BaseModel):
    n: int


def _validation_error() -> ValidationError:
    try:
        _Strict.model_validate({"n": "x"})
    except ValidationError as error:
        return error
    raise AssertionError("unreachable")


class RaisingProvider:
    """A ``CorrectorProvider`` whose model cannot be loaded."""

    def __init__(self, error: Exception) -> None:
        self.error = error

    def for_snapshot(self, snap: ConfigSnapshot) -> Any:
        raise self.error

    async def warm(self, snap: ConfigSnapshot) -> None:
        raise self.error


class DownForecasts:
    async def previous_runs(self, **_: object) -> pl.DataFrame:
        raise UpstreamError("503", url="https://x.invalid/v1", status=503)


async def stopped_job(settings: Settings, **overrides: Any) -> tuple[AlertJob, Any]:
    world = await build_world(settings, **{k: v for k, v in overrides.items() if k == "forecasts"})
    services = world.services
    if "correctors" in overrides:
        services = services.__class__(**{**services.__dict__, "correctors": overrides["correctors"]})
    runtime = Runtime(world.settings, catalog(), models(), SnapshotHolder(snapshot(version_id=3)))
    channel = RecordingPushChannel()
    job = AlertJob(world.settings, runtime, services, channel, None, None, _noop)  # type: ignore[arg-type]

    async def current() -> ConfigSnapshot:
        return snapshot(version_id=3)

    job.snapshot = current  # type: ignore[method-assign]
    epoch = await services.sites.active_epoch(SITE)
    world.clock.now = datetime(2026, 7, 1, 4, 10, tzinfo=UTC)
    await services.stops.start("crew-b", "heat", "lead-b", epoch)
    return job, channel


async def _noop() -> None:
    return None


@pytest.mark.parametrize(
    "provider",
    [
        RaisingProvider(FileNotFoundError("model.txt")),
        RaisingProvider(_validation_error()),
        RaisingProvider(RuntimeError("lightgbm")),
    ],
    ids=["file-not-found", "validation-error", "runtime"],
)
async def test_a_corrector_that_cannot_be_built_still_escalates_the_stop(settings: Settings, provider: Any) -> None:
    job, _ = await stopped_job(settings, correctors=provider)

    summary = await job.work(DAY, AT)

    reds = [r for r in job.services.alerts.records if r.crew_id == "crew-b"]  # type: ignore[attr-defined]
    assert [(r.level, r.kind) for r in reds] == [(AlertLevel.RED, "escalate")]
    assert isinstance(summary["events_created"], int)
    assert summary["events_created"] >= 1


async def test_a_source_that_raises_a_real_upstream_error_still_escalates_the_stop(settings: Settings) -> None:
    job, _ = await stopped_job(settings, forecasts=DownForecasts())

    await job.work(DAY, AT)

    reds = [r for r in job.services.alerts.records if r.crew_id == "crew-b"]  # type: ignore[attr-defined]
    assert [(r.level, r.kind) for r in reds][-1] == (AlertLevel.RED, "escalate")


class HangingForecasts:
    """A weather source that never answers (a dead connection with no timeout of its own)."""

    def __init__(self) -> None:
        self.calls = 0

    async def previous_runs(self, **_: object) -> pl.DataFrame:
        self.calls += 1
        await asyncio.Event().wait()
        raise AssertionError("unreachable")


async def test_a_hanging_weather_source_does_not_hold_the_stop_back(settings: Settings) -> None:
    """N1: the forecast leg is cut at its deadline (scaled to 0.4 s here), the day falls back, and the stop is read and
    escalated in the same run: the whole work finishes within the deadline plus a margin."""
    hanging = HangingForecasts()
    job, channel = await stopped_job(settings, forecasts=hanging)
    job.forecast_deadline_s = 0.4
    await job.services.subs.upsert_by_endpoint(
        NewSubscription(endpoint="https://push.example/crew-b", p256dh="k", auth="a", site_id=SITE, crew_id="crew-b"),
        await job.services.sites.active_epoch(SITE),
    )

    began = time.monotonic()
    with structlog.testing.capture_logs() as captured:
        await asyncio.wait_for(job.work(DAY, AT), timeout=5)
    elapsed = time.monotonic() - began

    assert hanging.calls >= 1
    assert 0.4 <= elapsed < 3.0  # the deadline cut it; nothing waited the 3 s a slow source would have taken
    reds = [r for r in job.services.alerts.records if r.crew_id == "crew-b"]  # type: ignore[attr-defined]
    assert [(r.level, r.kind) for r in reds] == [(AlertLevel.RED, "escalate")]
    assert [m.level for _, m in channel.sent if m.crew_id == "crew-b"] == [AlertLevel.RED]
    deadline_logs = [c for c in captured if c["event"] == "alerts.forecast_deadline"]
    assert [(c["log_level"], c["error"]) for c in deadline_logs] == [("error", "TimeoutError")]


async def test_a_slow_source_that_answers_inside_the_deadline_is_used(settings: Settings) -> None:
    """The deadline only cuts a source that is too slow: a source that answers is not replaced by the fallback."""
    job, _ = await stopped_job(settings)
    job.forecast_deadline_s = 30.0

    with structlog.testing.capture_logs() as captured:
        await job.work(DAY, AT)

    assert [c for c in captured if c["event"] == "alerts.forecast_deadline"] == []


async def test_the_forecast_deadline_is_the_smaller_of_30_s_and_a_quarter_period() -> None:
    assert forecast_deadline(5) == 30.0  # period 300 s: a quarter is 75 s
    assert forecast_deadline(2) == 30.0  # 120 s: a quarter is exactly 30 s
    assert forecast_deadline(1) == 15.0  # 60 s: a quarter is 15 s


async def test_the_run_deadline_is_anchored_at_the_start_of_the_cycle(settings: Settings) -> None:
    """W1: phase A time counts against the run budget. The clock jumps past the whole budget during phase A (the source
    advances it), so no push may start: its sends are failed with the deadline, though ``deliver`` had just begun."""
    now = [1000.0]

    class SlowThenDown:
        async def previous_runs(self, **_: object) -> pl.DataFrame:
            now[0] += 10_000.0  # phase A "took" far longer than a period
            raise UpstreamError("503", url="https://x.invalid/v1", status=503)

    job, channel = await stopped_job(settings, forecasts=SlowThenDown())
    job.clock = lambda: now[0]
    await job.services.subs.upsert_by_endpoint(
        NewSubscription(endpoint="https://push.example/crew-b", p256dh="k", auth="a", site_id=SITE, crew_id="crew-b"),
        await job.services.sites.active_epoch(SITE),
    )

    summary = await job.work(DAY, AT)

    assert channel.sent == []
    assert summary["delivered"] == 0
    assert isinstance(summary["failed"], int)
    assert summary["failed"] >= 1
