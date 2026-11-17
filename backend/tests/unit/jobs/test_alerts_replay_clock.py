"""``AlertJob.work`` and the replay clock anchored in the epoch row (ADR 0034 amendment of 2026-11-15): a cycle
refreshes the clock before it reads it, and with an unreadable epoch it fails closed (the loop then goes on)."""

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import pytest
import structlog

from stellar_blaze.adapters.fakes.notifications import RecordingPushChannel
from stellar_blaze.application.replay_clock import ReplayClockUnavailableError
from stellar_blaze.application.runtime_config import ConfigSnapshot, SnapshotHolder
from stellar_blaze.application.services import Services
from stellar_blaze.composition import Runtime
from stellar_blaze.config import Settings
from stellar_blaze.jobs.alerts import AlertJob, run_loop
from tests.unit.api.support import Clock, World, build_world
from tests.unit.application.serving_support import catalog, snapshot
from tests.unit.config.support import models
from tests.unit.jobs.test_alerts_loop import Script

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]

DAY = date(2026, 7, 1)
ANCHOR = datetime(2026, 7, 1, 7, 10, tzinfo=UTC)
WALL = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)


async def replay_world(settings: Settings) -> World:
    return await build_world(
        settings.model_copy(update={"forecast_source": "replay", "replay_snapshot_id": "snap"}),
        clock=Clock(WALL),
        replay_anchor=ANCHOR,
    )


async def _noop() -> None:
    return None


def job_over(world: World, services: Services) -> AlertJob:
    runtime = Runtime(world.settings, catalog(), models(), SnapshotHolder(snapshot(version_id=3)))
    job = AlertJob(world.settings, runtime, services, RecordingPushChannel(), None, None, _noop)  # type: ignore[arg-type]

    async def current() -> ConfigSnapshot:
        return snapshot(version_id=3)

    job.snapshot = current  # type: ignore[method-assign]
    return job


async def test_a_cycle_refreshes_the_clock_before_it_reads_it(settings: Settings) -> None:
    world = await replay_world(settings)
    order: list[str] = []
    real_refresh = world.services.refresh_clock
    real_clock = world.services.clock

    async def refresh(*, force: bool = False) -> None:
        order.append("refresh")
        await real_refresh(force=force)

    def clock() -> datetime:
        order.append("clock")
        return real_clock()

    job = job_over(world, replace(world.services, refresh_clock=refresh, clock=clock))

    await job.work(DAY)  # no `as_of`: the domain clock is the "now" of the run

    assert order[:2] == ["refresh", "clock"]  # the refresh is the first thing the cycle does, the read follows


async def test_a_cycle_over_an_unreadable_epoch_fails_closed_and_creates_nothing(settings: Settings) -> None:
    world = await replay_world(settings)

    async def unreachable() -> datetime | None:
        raise ConnectionRefusedError("password=hunter2")

    world.sites.current_epoch_start = unreachable  # type: ignore[method-assign]
    job = job_over(world, world.services)

    with pytest.raises(ReplayClockUnavailableError):
        await job.work(DAY)

    assert world.services.alerts.records == []  # type: ignore[attr-defined]  # no event was made from an invented time


async def test_an_explicit_instant_does_not_need_the_epoch(settings: Settings) -> None:
    world = await replay_world(settings)

    async def unreachable() -> datetime | None:
        raise ConnectionRefusedError

    world.sites.current_epoch_start = unreachable  # type: ignore[method-assign]
    job = job_over(world, world.services)

    summary = await job.work(DAY, ANCHOR + timedelta(minutes=5))  # `--as-of`: the operator named the instant

    assert summary["sites"]  # the cycle ran


async def test_the_loop_survives_a_cycle_that_lost_the_epoch_and_names_only_the_class() -> None:
    script = Script(ReplayClockUnavailableError("no synthetic site has a demo epoch"), 5)

    with structlog.testing.capture_logs() as logs:
        cycles = await run_loop(script.cycle, stop=script.stop, sleep=script.sleep, clock=script.clock)

    assert cycles == 2  # the next cycle ran: the database coming back heals the worker with no restart
    assert [(e["event"], e["error"]) for e in logs if e["log_level"] == "error"] == [
        ("alerts.cycle_failed", "ReplayClockUnavailableError")
    ]
