"""Contract suite of ``ReplayEpochSource`` over a site store (fake in unit, Postgres in integration).

A check takes ``build``: a factory that makes a site store whose WALL clock is the one it is given (the store stamps an
epoch's ``started_at`` with it, so the replay clock's elapsed arithmetic and the stored start share one time base).
"""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Protocol

from stellar_blaze.ports.replay_epoch import ReplayEpochSource
from stellar_blaze.ports.sites import EpochStore, SiteFixture, SiteFixtureStore, SiteRepository
from tests.unit.contract.b3_world import SITE_ID, demo_fixture

T0 = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)


class SiteStoreWithEpochSource(SiteRepository, EpochStore, SiteFixtureStore, ReplayEpochSource, Protocol):
    """What a site store offers the epoch checks (the fake and the Postgres store are each one object)."""


class Wall:
    """A settable wall clock: the store records ``started_at`` from it."""

    def __init__(self, now: datetime = T0) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


type Build = Callable[[Callable[[], datetime]], SiteStoreWithEpochSource]
type EpochCheck = Callable[[Build], Awaitable[None]]


async def check_no_synthetic_site_means_no_epoch_start(build: Build) -> None:
    store = build(Wall())
    assert await store.current_epoch_start() is None  # nothing loaded

    real = demo_fixture().site.model_copy(update={"id": "site-real", "synthetic": False})
    await store.upsert_fixture(SiteFixture(site=real, crews=()), "ali")

    assert await store.current_epoch_start() is None  # a non-synthetic site's epoch 1 is not a demo epoch


async def check_the_first_epoch_records_the_injected_wall_clock(build: Build) -> None:
    wall = Wall(T0)
    store = build(wall)

    await store.upsert_fixture(demo_fixture(), "ali")

    start = await store.current_epoch_start()
    assert start == T0  # the application's clock, not the database server's now()
    assert start is not None
    assert start.utcoffset() == timedelta(0)  # aware UTC


async def check_start_epoch_records_the_injected_wall_clock_and_the_latest_wins(build: Build) -> None:
    wall = Wall(T0)
    store = build(wall)
    await store.upsert_fixture(demo_fixture(), "ali")
    assert await store.current_epoch_start() == T0

    wall.now = T0 + timedelta(hours=3)
    await store.start_epoch(SITE_ID, "demo-token")

    assert await store.current_epoch_start() == T0 + timedelta(hours=3)  # the reset's epoch, not the first one


async def check_loading_the_fixture_again_does_not_move_the_epoch_start(build: Build) -> None:
    wall = Wall(T0)
    store = build(wall)
    await store.upsert_fixture(demo_fixture(), "ali")

    wall.now = T0 + timedelta(hours=1)
    await store.upsert_fixture(demo_fixture(), "someone-else")  # an existing site gets no second epoch

    assert await store.current_epoch_start() == T0


async def check_a_non_synthetic_site_is_ignored_even_when_its_epoch_is_later(build: Build) -> None:
    wall = Wall(T0)
    store = build(wall)
    await store.upsert_fixture(demo_fixture(), "ali")

    wall.now = T0 + timedelta(hours=5)
    real = demo_fixture().site.model_copy(update={"id": "site-real", "synthetic": False})
    await store.upsert_fixture(SiteFixture(site=real, crews=()), "ali")  # its epoch starts five hours later

    assert await store.current_epoch_start() == T0


async def check_the_latest_start_over_several_synthetic_sites_is_the_current_one(build: Build) -> None:
    wall = Wall(T0)
    store = build(wall)
    await store.upsert_fixture(demo_fixture(), "ali")

    wall.now = T0 + timedelta(hours=2)
    second = demo_fixture().site.model_copy(update={"id": "site-demo-second"})
    await store.upsert_fixture(SiteFixture(site=second, crews=()), "ali")

    assert await store.current_epoch_start() == T0 + timedelta(hours=2)


CHECKS: dict[str, EpochCheck] = {
    name.removeprefix("check_"): fn for name, fn in sorted(globals().items()) if name.startswith("check_")
}
