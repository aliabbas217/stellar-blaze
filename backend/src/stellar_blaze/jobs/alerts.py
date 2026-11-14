"""The alert dispatch job: one run (``sb-jobs alerts dispatch``) and the loop (``sb-jobs alerts run``).

Architect ruling R-O: the dispatch is its OWN job with a runtime-tunable cadence, not a side effect of another job. The
cadence is ``alert_dispatch_interval_minutes`` of the ACTIVE config (default 5, range [1, 30]; ADR 0010), read again
every cycle, so an activation changes how often the next cycle comes without a restart. ``AlertJob.work`` is what
``run_job`` runs (a ``job_run`` row, an advisory lock per site filter: a second run of the same dispatch while one is
active is recorded as skipped, not stacked).

``run_loop`` is deliberately small and injectable (the cycle, the sleeper, the stop event):

* it never spins: it always waits at least the interval of the last good cycle (or the 5-minute default when no cycle
  has ever read one), and at least 60 s (the tunable's own minimum is 1 minute);
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
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Final, Literal
from zoneinfo import ZoneInfo

import structlog
from pydantic import JsonValue
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.application.alerts import DispatchReport, dispatch
from stellar_blaze.application.runtime_config import ConfigService, ConfigSnapshot, ConfigUnavailableError
from stellar_blaze.application.services import Services
from stellar_blaze.application.site_day import site_day
from stellar_blaze.composition import Runtime
from stellar_blaze.config import Settings
from stellar_blaze.ports.push import PushChannel, PushSubscriptionStore
from stellar_blaze.ports.sites import SiteNotFoundError, SiteRecord

__all__ = ["DEFAULT_INTERVAL_MINUTES", "AlertJob", "DispatchFailedError", "install_stop_signals", "run_loop", "wait"]

logger = structlog.stdlib.get_logger(__name__)

DEFAULT_INTERVAL_MINUTES: Final = 5  # the ruleset default of alert_dispatch_interval_minutes, until a cycle reads one
MIN_WAIT_S: Final = 60.0

type Sleeper = Callable[[float, asyncio.Event], Awaitable[None]]
type ServicesBuilder = Callable[[Settings, AsyncEngine], Awaitable[tuple[Services, Callable[[], Awaitable[None]]]]]
type ChannelBuilder = Callable[[Settings, PushSubscriptionStore], PushChannel | None]


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
) -> int:
    """Run ``cycle`` until ``stop`` is set, waiting between cycles; return the number of cycles run.

    ``cycle`` returns the dispatch interval in minutes that the ACTIVE config says (``None`` when it could not read
    one: the last known one, else the default, is kept).
    """
    interval = default_interval_minutes
    cycles = 0
    while not stop.is_set():
        cycles += 1
        try:
            read = await cycle()
        except Exception as error:  # a failing cycle is logged and the next one tries again
            logger.error("alerts.cycle_failed", error=type(error).__name__)
            read = None
        if read is not None:
            interval = read
        if stop.is_set():
            break
        await sleep(max(MIN_WAIT_S, interval * 60.0), stop)
    logger.info("alerts.loop_stopped", cycles=cycles)
    return cycles


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

    async def work(self, local_date: date | None = None, as_of: datetime | None = None) -> Mapping[str, JsonValue]:
        """One dispatch run over the sites; what ``run_job`` runs. Every site is tried; any failure fails the job after
        the others were dispatched."""
        snapshot = await self.snapshot()
        now = as_of or self.services.clock()
        mode: Literal["replay", "live"] = "replay" if self.settings.forecast_source == "replay" else "live"
        sites = await self._sites()
        reports: list[DispatchReport] = []
        failed: list[str] = []
        for site in sites:
            try:
                reports.append(await self._one(site, snapshot, now, mode, local_date))
            except Exception as error:  # one site's fault must not keep the others' alerts back
                logger.error("alerts.site_failed", site_id=site.id, error=type(error).__name__)
                failed.append(site.id)
        if reports:
            self.interval_minutes = min(r.interval_minutes for r in reports)
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

    async def _sites(self) -> list[SiteRecord]:
        if self.site_id is None:
            return list(await self.services.sites.list_sites())
        site = await self.services.sites.get_site(self.site_id)
        if site is None:
            raise SiteNotFoundError(self.site_id)
        return [site]

    async def _one(
        self,
        site: SiteRecord,
        snapshot: ConfigSnapshot,
        now: datetime,
        mode: Literal["replay", "live"],
        requested: date | None,
    ) -> DispatchReport:
        services = self.services
        if requested is not None:
            local_date = requested
        elif mode == "replay" and self.settings.replay_default_date is not None:
            local_date = self.settings.replay_default_date
        else:
            local_date = now.astimezone(ZoneInfo(site.timezone)).date()
        day = await site_day(
            site=site,
            local_date=local_date,
            snapshot=snapshot,
            catalog=self.runtime.rulesets,
            forecasts=services.forecasts,
            observations=services.observations,
            corrector=services.correctors.for_snapshot(snapshot),
            mode=mode,
            now=now,
        )
        crews = [await services.sites.crew_spec(c.id) for c in await services.sites.list_crews(site.id)]
        return await dispatch(
            site_day=day,
            crews=crews,
            sites=services.sites,
            stops=services.stops,
            alerts=services.alerts,
            subs=services.subs,
            audit=services.audit,
            channel=self.channel,
            snapshot=snapshot,
            catalog=self.runtime.rulesets,
            now=now,
        )
