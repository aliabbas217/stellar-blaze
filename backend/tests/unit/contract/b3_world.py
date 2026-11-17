"""The B3 stores a contract check runs against: fakes in the unit tier, Postgres in the integration tier.

A check takes a ``World`` and asserts one clause of a port. ``seeded`` loads the demo fixture (Postgres foreign keys
need a real site, crews and epoch; the fake does not, but loading it keeps both worlds in the same state).
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

from stellar_blaze.adapters.config.site_fixture import load_site_fixture
from stellar_blaze.adapters.fakes.alerts import InMemoryAlertStore
from stellar_blaze.adapters.fakes.audit import InMemoryAuditLog
from stellar_blaze.adapters.fakes.plans import InMemoryCrewStopStore, InMemoryDayPlanStore, InMemoryPlanSignoffStore
from stellar_blaze.adapters.fakes.push import InMemoryPushStore
from stellar_blaze.adapters.fakes.sites import InMemorySiteStore
from stellar_blaze.ports.alerts import AlertStore
from stellar_blaze.ports.audit import AuditLog
from stellar_blaze.ports.plans import CrewStopStore, DayPlanStore, PlanSignoffStore
from stellar_blaze.ports.push import PushSubscriptionStore
from stellar_blaze.ports.sites import EpochStore, SiteFixture, SiteFixtureStore, SiteRepository
from tests.alembic_support import BACKEND_DIR

FIXTURE_PATH = BACKEND_DIR / "fixtures" / "demo_site.toml"
SITE_ID = "site-demo-mussafah"
SHA = "a" * 64


class SiteStore(SiteRepository, EpochStore, SiteFixtureStore, Protocol):
    """What one site store object offers (the fake and the Postgres store are each one object)."""


@dataclass
class World:
    sites: SiteStore
    push: PushSubscriptionStore
    alerts: AlertStore
    day_plans: DayPlanStore
    stops: CrewStopStore
    signoffs: PlanSignoffStore
    audit: AuditLog
    config_version_id: int
    config_sha256: str


type Check = Callable[[World], Awaitable[None]]


def demo_fixture() -> SiteFixture:
    return load_site_fixture(FIXTURE_PATH)


async def seeded(world: World) -> int:
    """Load the demo fixture and return the site's active epoch."""
    await world.sites.upsert_fixture(demo_fixture(), "contract-suite")
    return await world.sites.active_epoch(SITE_ID)


def fake_world() -> World:
    audit = InMemoryAuditLog()
    return World(
        sites=InMemorySiteStore(audit),
        push=InMemoryPushStore(),
        alerts=InMemoryAlertStore(),
        day_plans=InMemoryDayPlanStore(),
        stops=InMemoryCrewStopStore(),
        signoffs=InMemoryPlanSignoffStore(),
        audit=audit,
        config_version_id=1,
        config_sha256=SHA,
    )
