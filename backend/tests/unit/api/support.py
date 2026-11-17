"""Builders of the route tests: the demo site and crews in the in-memory stores, hand-set forecasts, tokens, a clock."""

import hashlib
import json
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from pydantic import SecretStr

from stellar_blaze.adapters.fakes.alerts import InMemoryAlertStore
from stellar_blaze.adapters.fakes.audit import InMemoryAuditLog
from stellar_blaze.adapters.fakes.corrector import FakeCorrector
from stellar_blaze.adapters.fakes.plans import InMemoryCrewStopStore, InMemoryDayPlanStore, InMemoryPlanSignoffStore
from stellar_blaze.adapters.fakes.push import InMemoryPushStore
from stellar_blaze.adapters.fakes.sites import InMemorySiteStore
from stellar_blaze.api.app import create_app
from stellar_blaze.application.replay_clock import EpochReplayClock
from stellar_blaze.application.runtime_config import ConfigSnapshot
from stellar_blaze.application.services import Services
from stellar_blaze.composition import load_site_fixture
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import RuntimeConfig, config_body
from stellar_blaze.ports.corrector import ForecastCorrector
from tests.alembic_support import BACKEND_DIR
from tests.unit.application import serving_support as serving
from tests.unit.application.serving_support import ExplodingForecasts

DAY = serving.DAY
DEMO_TOKEN = "token-demo-employer"  # noqa: S105
OTHER_TOKEN = "token-other-employer"  # noqa: S105
SITE = "site-demo-mussafah"
START = datetime(2026, 7, 1, 1, 0, tzinfo=UTC)  # 05:00 in Asia/Dubai, before the shift


def sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


TOKENS = json.dumps(
    {
        sha(DEMO_TOKEN): {"actor": "demo-bff", "role": "employer", "employer_id": "emp-demo"},
        sha(OTHER_TOKEN): {"actor": "other-bff", "role": "employer", "employer_id": "emp-other"},
    }
)


class Clock:
    """A settable "now" shared by the stores, the limiter and the routes."""

    def __init__(self, now: datetime = START) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


class Corrector:
    def __init__(self, corrector: ForecastCorrector | None = None) -> None:
        self._corrector = corrector or FakeCorrector(0.0)

    def for_snapshot(self, snapshot: ConfigSnapshot) -> ForecastCorrector:
        return self._corrector

    async def warm(self, snapshot: ConfigSnapshot) -> None:
        return None


@dataclass
class World:
    services: Services
    clock: Clock
    audit: InMemoryAuditLog
    stops: InMemoryCrewStopStore
    signoffs: InMemoryPlanSignoffStore
    plans: InMemoryDayPlanStore
    sites: InMemorySiteStore
    settings: Settings


async def build_world(
    settings: Settings,
    *,
    hours: dict[int, tuple[float, float]] | None = None,
    forecasts: Any = None,
    clock: Clock | None = None,
    replay_anchor: datetime | None = None,
) -> World:
    """The fakes and the services over them. ``clock`` is the settable WALL clock (audit, plan rows, the limiter).

    With ``replay_anchor`` the domain clock (stops, sign-offs, "now" of the use cases) is an ``EpochReplayClock`` over
    the fake site store: it reads the anchor at the start of the current epoch (the wall time of the fixture load, then
    of each demo reset) and follows ``clock``; without it the domain clock is ``clock`` itself.
    """
    clock = clock or Clock()
    audit = InMemoryAuditLog(clock)
    sites = InMemorySiteStore(audit, clock=clock)  # an epoch starts at the injected wall clock, like Postgres
    domain: Callable[[], datetime] = clock if replay_anchor is None else EpochReplayClock(replay_anchor, clock, sites)
    await sites.upsert_fixture(load_site_fixture(BACKEND_DIR / "fixtures" / "demo_site.toml"), "test")
    stops = InMemoryCrewStopStore(domain)
    plans = InMemoryDayPlanStore(clock)
    signoffs = InMemoryPlanSignoffStore(domain)
    source = forecasts or serving.forecasts_of(hours or serving.day_of(serving.AMBER))
    services = Services(
        sites=sites,
        epochs=sites,
        stops=stops,
        plans=plans,
        signoffs=signoffs,
        audit=audit,
        alerts=InMemoryAlertStore(clock),
        subs=InMemoryPushStore(clock),
        forecasts=source,
        observations=serving.observations(),
        correctors=Corrector(),
        clock=domain,
        wall_clock=clock,
    )
    if isinstance(domain, EpochReplayClock):  # what composition.build_api_services does; other modes keep the no-op
        services = replace(services, refresh_clock=domain.refresh)
    api_settings = settings.model_copy(update={"access_tokens": SecretStr(TOKENS)})
    return World(services, clock, audit, stops, signoffs, plans, sites, api_settings)


def bearer(token: str = DEMO_TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def db_snapshot() -> ConfigSnapshot:
    return serving.snapshot(version_id=7)


@contextmanager
def client_for(world: World, *, database_config: bool = False, push_hosts: Sequence[str] = ()) -> Iterator[TestClient]:
    """The app over ``world``; ``database_config`` swaps in a DB-sourced snapshot (needed to record a sign-off).

    ``push_hosts`` is the explicit TEST allowance of the push endpoint host allow-list (ADR 0067): the active config
    names these hosts in ``push_extra_host_suffixes``, exactly as an operator's override does. Production code is not
    loosened: without it only the built-in push services are accepted.
    """
    app = create_app(world.settings, services=world.services)
    with TestClient(app, raise_server_exceptions=False) as client:
        if database_config:
            app.state.runtime.config.swap(db_snapshot())
        if push_hosts:
            holder = app.state.runtime.config
            current = holder.current()
            allowed = RuntimeConfig.model_validate(
                {**config_body(current.config), "push_extra_host_suffixes": list(push_hosts)}
            )
            holder.swap(replace(current, config=allowed))
        yield client


__all__ = [
    "DAY",
    "DEMO_TOKEN",
    "OTHER_TOKEN",
    "SITE",
    "Clock",
    "ExplodingForecasts",
    "World",
    "bearer",
    "build_world",
    "client_for",
    "make_world",
]


def make_world(settings: Settings, **kwargs: Any) -> World:
    import asyncio

    return asyncio.run(build_world(settings, **kwargs))
