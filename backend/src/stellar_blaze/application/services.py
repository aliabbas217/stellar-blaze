"""What the API's use cases are wired to: the ports and sources of one process, built by ``composition``.

``Services`` holds ports only (no adapter type), so the application layer and the routers stay free of adapters; tests
build it from the in-memory fakes, production from Postgres and the forecast source ``Settings`` names
(``composition.build_api_services``). ``Principal`` is the authenticated employer of a request (ADR 0051 decision 5).
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

from stellar_blaze.application.runtime_config import ConfigSnapshot
from stellar_blaze.ports.audit import AuditLog
from stellar_blaze.ports.corrector import ForecastCorrector
from stellar_blaze.ports.plans import CrewStopStore, DayPlanStore, PlanSignoffStore
from stellar_blaze.ports.sites import EpochStore, SiteRepository
from stellar_blaze.ports.weather import ObservationSource, WeatherForecastSource


@dataclass(frozen=True)
class Principal:
    """The employer a bearer token belongs to. ``actor`` is a label for the audit log, never a worker."""

    actor: str
    role: Literal["employer"]
    employer_id: str


class CorrectorSource(Protocol):
    """One corrector per model, built once (``composition.CorrectorProvider``)."""

    def for_snapshot(self, snapshot: ConfigSnapshot) -> ForecastCorrector: ...

    async def warm(self, snapshot: ConfigSnapshot) -> None:
        """Load the corrector of ``snapshot`` ahead of the first request (off the event loop)."""
        ...


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class Services:
    """The ports of the core-path routes.

    ``clock`` is the DOMAIN "now" (UTC): the stamps of crew stops and sign-offs, the ``now`` of ``site_day`` and the
    use cases. In replay mode it is a ``ReplayClock`` on the replay day (``application.replay_clock``); otherwise it is
    the wall clock. ``wall_clock`` is always the real time, for the rate limiter and anything that records when
    something really happened (the audit log stamps its own rows with the real clock too)."""

    sites: SiteRepository
    epochs: EpochStore
    stops: CrewStopStore
    plans: DayPlanStore
    signoffs: PlanSignoffStore
    audit: AuditLog
    forecasts: WeatherForecastSource
    observations: ObservationSource
    correctors: CorrectorSource
    clock: Callable[[], datetime] = utc_now
    wall_clock: Callable[[], datetime] = utc_now
    # Small TTL cache of ``site_day`` results (``api.views.load_site_day``): 60 s, at most 32 entries, one per process.
    day_cache: dict[tuple[Any, ...], tuple[datetime, Any]] = field(default_factory=dict)
