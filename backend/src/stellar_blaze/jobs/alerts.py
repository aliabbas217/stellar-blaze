"""The alert dispatch job: one run (``sb-jobs alerts dispatch``) and the loop (``sb-jobs alerts run``).

Architect ruling R-O: the dispatch is its OWN job with a runtime-tunable cadence, not a side effect of another job. The
cadence is ``alert_dispatch_interval_minutes`` of the ACTIVE config (default 5, range [1, 30]; ADR 0010), read again
every cycle, so an activation changes how often the next cycle comes without a restart. ``AlertJob.work`` is what
``run_job`` runs (a ``job_run`` row, an advisory lock per site filter: a second run of the same dispatch while one is
active is recorded as skipped, not stacked).

``run_loop`` is deliberately small and injectable (the cycle, the sleeper, the stop event):

* it is FIXED-RATE: ``period = max(60 s, interval x 60)`` (the interval of the last good cycle, or the 5-minute default
  when no cycle has ever read one) and it waits ``max(0, period - elapsed)`` after a cycle, so a cycle starts one period
  after the previous one STARTED, however long the run took. The escalation SLA follows: a crew stop is delivered within
  one period plus the forecast-leg deadline plus one delivery deadline of being recorded (about 5 min 45 s with the
  defaults). The worst case is a stop recorded just after the previous cycle read the stops: the next cycle starts one
  period after that one started, its forecast leg is cut at ``min(30 s, period / 4)`` (``forecast_deadline_s``: a stop
  needs no forecast, so a hanging weather source costs the stop at most that, then the protective fallback day is used
  and the stop is read and escalated), and its sends are bounded (``application.alerts``). A loop that never waits is
  impossible: the period is at least 60 s and a failing cycle that returns at once still waits the rest of it;
* a cycle that raises is logged with the exception class name and the loop continues (an unreachable database must
  not end the process that the next cycle would have healed);
* SIGTERM, SIGINT and KeyboardInterrupt set the stop event: the current run finishes, then the loop returns.

The domain clock (``Services.clock``: the replay clock in replay mode) is the "now" of a run, so a replay demo escalates
on the replay day; the wall clock stamps audit rows and ``job_run`` (``application.replay_clock``).
"""

import asyncio
import contextlib
import functools
import signal
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Final, Literal, NoReturn
from zoneinfo import ZoneInfo

import structlog
from pydantic import JsonValue
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.application.alerts import (
    DeliveryLimits,
    DispatchReport,
    Prepared,
    deliver,
    period_seconds,
    prepare,
)
from stellar_blaze.application.runtime_config import ConfigService, ConfigSnapshot, ConfigUnavailableError
from stellar_blaze.application.services import Services
from stellar_blaze.application.site_day import SiteDay, site_day
from stellar_blaze.composition import Runtime
from stellar_blaze.config import Settings
from stellar_blaze.ports.corrector import ForecastCorrector
from stellar_blaze.ports.push import PushChannel, PushSubscriptionStore
from stellar_blaze.ports.sites import SiteNotFoundError, SiteRecord
from stellar_blaze.ports.weather import SourceUnavailableError, WeatherForecastSource

__all__ = [
    "DEFAULT_INTERVAL_MINUTES",
    "FORECAST_DEADLINE_S",
    "AlertJob",
    "DispatchFailedError",
    "forecast_deadline",
    "install_stop_signals",
    "run_loop",
    "wait",
]

logger = structlog.stdlib.get_logger(__name__)

DEFAULT_INTERVAL_MINUTES: Final = 5  # the ruleset default of alert_dispatch_interval_minutes, until a cycle reads one
MIN_WAIT_S: Final = 60.0  # the shortest period (application.alerts.MIN_PERIOD_S)
FORECAST_DEADLINE_S: Final = (
    30.0  # the longest the forecast leg of one site's phase A may take (see ``forecast_deadline``)
)

type Sleeper = Callable[[float, asyncio.Event], Awaitable[None]]
type ServicesBuilder = Callable[[Settings, AsyncEngine], Awaitable[tuple[Services, Callable[[], Awaitable[None]]]]]
type ChannelBuilder = Callable[[Settings, PushSubscriptionStore], PushChannel | None]


def forecast_deadline(interval_minutes: int) -> float:
    """The hard bound of the forecast leg: ``min(30 s, period / 4)``. A stop needs no forecast, so the weather source
    may cost an escalation at most this much."""
    return min(FORECAST_DEADLINE_S, period_seconds(interval_minutes) / 4)


class _NoForecasts:
    """Stands in for the weather source once its leg timed out: it answers at once with a failure, so ``site_day``
    builds the protective fallback day (all High, ``forecast_status="fallback"``) without another network call."""

    async def previous_runs(self, **_: object) -> NoReturn:
        raise SourceUnavailableError("the forecast leg timed out")


class DispatchFailedError(Exception):
    """At least one site could not be dispatched (the others were). ``sites`` names them; the causes are in the log."""

    def __init__(self, sites: list[str]) -> None:
        super().__init__(f"alert dispatch failed for {len(sites)} site(s): {', '.join(sites)}")
        self.sites = sites


async def wait(seconds: float, stop: asyncio.Event) -> None:
    """Wait ``seconds`` or until ``stop`` is set, whichever comes first."""
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), timeout=seconds)


def install_stop_signals(stop: asyncio.Event) -> Callable[[], None]:
    """Make SIGTERM and SIGINT set ``stop`` (the current run finishes); return the function that restores the previous
    handlers. Windows has no ``add_signal_handler``: the plain ``signal.signal`` handler hands over to the loop thread
    safely (and is only possible from the main thread, elsewhere the signals keep their default behavior)."""
    loop = asyncio.get_running_loop()
    restore: list[Callable[[], object]] = []
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
            restore.append(functools.partial(loop.remove_signal_handler, sig))
        except NotImplementedError:  # Windows event loops
            try:
                previous = signal.signal(sig, lambda *_: loop.call_soon_threadsafe(stop.set))
            except ValueError:  # not the main thread
                continue
            restore.append(functools.partial(signal.signal, sig, previous))

    def restore_all() -> None:
        for undo in restore:
            undo()

    return restore_all


async def run_loop(
    cycle: Callable[[], Awaitable[int | None]],
    *,
    stop: asyncio.Event,
    sleep: Sleeper = wait,
    default_interval_minutes: int = DEFAULT_INTERVAL_MINUTES,
    clock: Callable[[], float] = time.monotonic,
) -> int:
    """Run ``cycle`` until ``stop`` is set, waiting between cycles; return the number of cycles run.

    ``cycle`` returns the dispatch interval in minutes that the ACTIVE config says (``None`` when it could not read
    one: the last known one, else the default, is kept). ``clock`` (monotonic seconds) is injectable.
    """
    interval = default_interval_minutes
    cycles = 0
    while not stop.is_set():
        cycles += 1
        began = clock()
        try:
            read = await cycle()
        except Exception as error:  # a failing cycle is logged and the next one tries again
            logger.error("alerts.cycle_failed", error=type(error).__name__)
            read = None
        if read is not None:
            interval = read
        if stop.is_set():
            break
        await sleep(max(0.0, period_seconds(interval) - (clock() - began)), stop)  # fixed-rate
    logger.info("alerts.loop_stopped", cycles=cycles)
    return cycles


class _UnavailableCorrector:
    """Stands in for a corrector that could not be built: every call fails, so ``site_day`` takes the protective
    fallback day (all High, ``forecast_status="fallback"``, no model id)."""

    model_id: str | None = None
    needs_history_forecasts = False

    def correct(self, **_: object) -> NoReturn:
        raise RuntimeError("the corrector is unavailable")

    def sample(self, *_: object, **__: object) -> NoReturn:
        raise RuntimeError("the corrector is unavailable")


@dataclass
class AlertJob:
    """One process's dispatch: its services, channel and config service, built once (the replay clock must keep running
    across the cycles of ``alerts run``). ``interval_minutes`` and ``summary`` describe the latest run."""

    settings: Settings
    runtime: Runtime
    services: Services
    channel: PushChannel | None
    config: ConfigService
    site_id: str | None
    close_services: Callable[[], Awaitable[None]]
    interval_minutes: int | None = None
    summary: dict[str, JsonValue] = field(default_factory=dict)
    forecast_deadline_s: float | None = None  # None: ``forecast_deadline`` of the latest interval (tests scale it down)
    clock: Callable[[], float] = time.monotonic  # the cycle start and the run deadline (injectable)

    @classmethod
    async def build(
        cls,
        settings: Settings,
        runtime: Runtime,
        engine: AsyncEngine,
        config: ConfigService,
        site_id: str | None,
        *,
        build_services: ServicesBuilder,
        build_channel: ChannelBuilder,
    ) -> "AlertJob":
        services, close = await build_services(settings, engine)
        return cls(settings, runtime, services, build_channel(settings, services.subs), config, site_id, close)

    async def close(self) -> None:
        if self.channel is not None:
            await self.channel.aclose()
        await self.close_services()

    async def snapshot(self) -> ConfigSnapshot:
        """The ACTIVE config now (read from the database every run); outside prod the file seed when nothing is active
        (nothing is then persisted or sent: it has no ``version_id``)."""
        active = await self.config.load_active()
        if active is not None:
            return active
        seeded = self.runtime.config.peek()
        if seeded is None:
            raise ConfigUnavailableError("no active runtime config: run `sb-jobs config seed`")
        return seeded

    async def site_ids(self) -> list[str]:
        """The ids of the sites this job dispatches (the ``--site`` filter, or every site)."""
        return [site.id for site in await self._sites(self.site_id)]

    async def work(
        self, local_date: date | None = None, as_of: datetime | None = None, site_id: str | None = None
    ) -> Mapping[str, JsonValue]:
        """One dispatch run over ``site_id`` (default: the job's filter, else every site); what ``run_job`` runs. Every
        site is tried; any failure fails the job after the others were dispatched."""
        began = self.clock()  # the start of the cycle: the run deadline of phase B is anchored here
        snapshot = await self.snapshot()
        now = as_of or self.services.clock()
        mode: Literal["replay", "live"] = "replay" if self.settings.forecast_source == "replay" else "live"
        sites = await self._sites(site_id if site_id is not None else self.site_id)
        prepared: list[Prepared] = []
        failed: list[str] = []
        for site in sites:  # phase A for every site first: no push service is called until all events are known
            try:
                prepared.append(await self._prepare(site, snapshot, now, mode, local_date))
            except Exception as error:  # one site's fault must not keep the others' alerts back
                logger.error("alerts.site_failed", site_id=site.id, error=type(error).__name__)
                failed.append(site.id)
        reports: list[DispatchReport] = []
        if prepared:
            self.interval_minutes = min(p.report.interval_minutes for p in prepared)
            services = self.services
            try:
                reports = await deliver(
                    prepared,
                    channel=self.channel,
                    alerts=services.alerts,
                    subs=services.subs,
                    audit=services.audit,
                    limits=DeliveryLimits(monotonic=self.clock, started_at=began),
                )
            except Exception as error:  # an insert failed: every other event was still sent and stored
                logger.error("alerts.deliver_failed", error=type(error).__name__)
                failed.extend(p.report.site_id for p in prepared)
        self.summary = {
            "sites": [r.site_id for r in reports],
            "events_created": sum(r.events_created for r in reports),
            "delivered": sum(r.delivered for r in reports),
            "failed": sum(r.failed for r in reports),
            "interval_minutes": self.interval_minutes,
            "config_version": snapshot.version_id if snapshot.version_id is not None else 0,
            "push": "configured" if self.channel is not None else "not configured",
            "persisted": snapshot.version_id is not None,
        }
        if failed:
            raise DispatchFailedError(failed)
        return self.summary

    async def _sites(self, site_id: str | None) -> list[SiteRecord]:
        if site_id is None:
            return list(await self.services.sites.list_sites())
        site = await self.services.sites.get_site(site_id)
        if site is None:
            raise SiteNotFoundError(site_id)
        return [site]

    async def _day(
        self,
        site: SiteRecord,
        snapshot: ConfigSnapshot,
        now: datetime,
        mode: Literal["replay", "live"],
        local_date: date,
    ) -> SiteDay:
        """The day of the site. When the corrector cannot even be built (a missing model directory, a malformed
        parameter file) the day is the protective fallback: a stop needs no forecast, crews must still be reachable.

        The forecast leg has a HARD deadline (``forecast_deadline_s``, default ``min(30 s, period / 4)``): a weather
        source that hangs is cut (``asyncio.wait_for``), logged at error level with the class name ``TimeoutError`` and
        the day is the protective fallback, so the stop read that follows is never held back by the network."""
        services = self.services
        try:
            corrector: ForecastCorrector = services.correctors.for_snapshot(snapshot)
        except Exception as error:
            logger.error("alerts.corrector_unavailable", site_id=site.id, error=type(error).__name__)
            corrector = _UnavailableCorrector()

        async def build(forecasts: WeatherForecastSource) -> SiteDay:
            return await site_day(
                site=site,
                local_date=local_date,
                snapshot=snapshot,
                catalog=self.runtime.rulesets,
                forecasts=forecasts,
                observations=services.observations,
                corrector=corrector,
                mode=mode,
                now=now,
            )

        deadline = self.forecast_deadline_s
        if deadline is None:
            deadline = forecast_deadline(self.interval_minutes or DEFAULT_INTERVAL_MINUTES)
        try:
            return await asyncio.wait_for(build(services.forecasts), timeout=deadline)
        except TimeoutError as error:
            logger.error("alerts.forecast_deadline", site_id=site.id, error=type(error).__name__, deadline_s=deadline)
        return await build(_NoForecasts())

    async def _prepare(
        self,
        site: SiteRecord,
        snapshot: ConfigSnapshot,
        now: datetime,
        mode: Literal["replay", "live"],
        requested: date | None,
    ) -> Prepared:
        services = self.services
        if requested is not None:
            local_date = requested
        elif mode == "replay" and self.settings.replay_default_date is not None:
            local_date = self.settings.replay_default_date
        else:
            local_date = now.astimezone(ZoneInfo(site.timezone)).date()
        day = await self._day(site, snapshot, now, mode, local_date)
        crews = [await services.sites.crew_spec(c.id) for c in await services.sites.list_crews(site.id)]
        return await prepare(
            site_day=day,
            crews=crews,
            sites=services.sites,
            stops=services.stops,
            alerts=services.alerts,
            subs=services.subs,
            channel_configured=self.channel is not None,
            snapshot=snapshot,
            catalog=self.runtime.rulesets,
            now=now,
        )
