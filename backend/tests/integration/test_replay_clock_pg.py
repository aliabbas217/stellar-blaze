"""The replay clock anchored in the ``site_epoch`` row on a real Postgres (ADR 0034 amendment of 2026-11-15).

Two service sets built by ``build_api_services`` over one database and one manual wall clock stand for the API and the
``alerts run`` worker. They must read the same replay time whenever they were started, after either is rebuilt (a
restart), and after a demo reset; a stop of one epoch must not carry into the next.
"""

from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.adapters.db.sites import PostgresSiteStore
from stellar_blaze.application.replay_clock import ReplayClockUnavailableError
from stellar_blaze.application.services import Services
from stellar_blaze.composition import build_api_services
from stellar_blaze.config import Settings
from tests.fixtures.forecast.replay import SNAPSHOT_ID, build_fixture_snapshot
from tests.integration.b3_app import REPLAY_DATE, SITE, ManualWall, app_settings, rows
from tests.unit.contract.b3_world import demo_fixture
from tests.unit.contract.epoch_start_contract import CHECKS as EPOCH_CHECKS

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

EPOCH_START = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)  # the wall time of the load: the first epoch begins here
ANCHOR = datetime(2025, 7, 10, 7, 10, tzinfo=UTC)  # SB_REPLAY_DEFAULT_DATE 2025-07-10 at 11:10 Asia/Dubai (UTC+4)

type Start = Callable[[], Awaitable[Services]]


@pytest.mark.parametrize("name", list(EPOCH_CHECKS))
async def test_postgres_satisfies_the_epoch_start_contract_the_fake_runs(engine: AsyncEngine, name: str) -> None:
    await EPOCH_CHECKS[name](lambda clock: PostgresSiteStore(engine, clock=clock))


@pytest_asyncio.fixture
async def wall() -> ManualWall:
    return ManualWall(EPOCH_START)


@pytest_asyncio.fixture
async def start(engine: AsyncEngine, settings: Settings, wall: ManualWall, tmp_path: Path) -> AsyncIterator[Start]:
    """Loads the demo site at ``EPOCH_START`` (the first epoch is stamped by the wall clock) and returns a function that
    builds one process's services the production way; every set built is closed at the end."""
    built = build_fixture_snapshot(tmp_path / "silver")
    config = app_settings(settings, replay_dir=built.directory.parent, snapshot_id=SNAPSHOT_ID)
    assert config.replay_default_date == REPLAY_DATE
    await PostgresSiteStore(engine, clock=wall).upsert_fixture(demo_fixture(), "ops")
    closers: list[Callable[[], Awaitable[None]]] = []

    async def build() -> Services:
        services, close = await build_api_services(config, engine, wall=wall)
        closers.append(close)
        return services

    yield build
    for close in closers:
        await close()


async def test_the_first_epoch_is_stamped_by_the_wall_clock_not_the_database(start: Start, settings: Settings) -> None:
    await start()

    [epoch] = rows(settings, "SELECT started_at FROM site_epoch")
    assert epoch["started_at"] == EPOCH_START  # 2026-11-15 09:00Z: the injected clock, not the server's now()


async def test_an_api_and_a_worker_started_at_different_times_read_the_same_replay_time(
    start: Start, wall: ManualWall
) -> None:
    api = await start()  # built at 09:00, the epoch start
    wall.advance(hours=2)
    worker = await start()  # built at 11:00

    await api.refresh_clock()
    await worker.refresh_clock()

    # 11:00 - 09:00 = 2 h since the epoch start: anchor 07:10Z + 2 h. The worker is NOT at the anchor.
    assert api.clock() == worker.clock() == ANCHOR + timedelta(hours=2)
    assert api.wall_clock() == worker.wall_clock() == EPOCH_START + timedelta(hours=2)  # the wall stays real


async def test_rebuilding_either_process_changes_nothing(start: Start, wall: ManualWall) -> None:
    api = await start()
    worker = await start()
    wall.advance(hours=1, minutes=30)
    await api.refresh_clock()
    await worker.refresh_clock()
    before = api.clock()
    assert before == worker.clock() == ANCHOR + timedelta(hours=1, minutes=30)

    wall.advance(minutes=15)  # the api restarts, then the worker restarts
    restarted_api = await start()
    restarted_worker = await start()
    for services in (api, worker, restarted_api, restarted_worker):
        await services.refresh_clock()

    # 09:00 -> 10:45 = 1 h 45 min for all four; a restart does not return anyone to the anchor.
    expected = ANCHOR + timedelta(hours=1, minutes=45)
    assert api.clock() == worker.clock() == restarted_api.clock() == restarted_worker.clock() == expected


async def test_a_demo_reset_re_anchors_the_api_at_once_and_the_worker_within_the_interval(
    start: Start, wall: ManualWall, settings: Settings
) -> None:
    api = await start()
    worker = await start()
    wall.advance(hours=3)
    await api.refresh_clock()
    await worker.refresh_clock()
    assert api.clock() == worker.clock() == ANCHOR + timedelta(hours=3)

    new_epoch = await api.epochs.start_epoch(SITE, "demo-token")  # the reset route's call, at wall 12:00
    await api.refresh_clock(force=True)  # ... and its forced refresh

    assert api.clock() == ANCHOR  # the api at once
    assert worker.clock() == ANCHOR + timedelta(hours=3)  # the worker has not read the row yet (inside its 5 s)
    wall.advance(seconds=5)
    await worker.refresh_clock()  # the worker's next cycle
    await api.refresh_clock()
    assert worker.clock() == api.clock() == ANCHOR + timedelta(seconds=5)
    assert [r["epoch_id"] for r in rows(settings, "SELECT epoch_id FROM site_epoch ORDER BY epoch_id")] == [
        1,
        new_epoch,
    ]


async def test_a_stop_of_one_epoch_is_not_in_the_next_and_its_row_stays(
    start: Start, wall: ManualWall, settings: Settings
) -> None:
    api = await start()
    first = await api.sites.active_epoch(SITE)
    wall.advance(minutes=30)
    await api.refresh_clock()
    stop = await api.stops.start("crew-b", "heat", "lead-b", first)
    assert stop.started_at == ANCHOR + timedelta(minutes=30)  # stamped by the replay clock: 07:40Z on the replay day

    second = await api.epochs.start_epoch(SITE, "demo-token")
    await api.refresh_clock(force=True)

    assert await api.stops.active("crew-b", second) is None  # not stopped in the new epoch
    assert await api.stops.active_between("crew-b", ANCHOR, ANCHOR + timedelta(hours=8), second) == []
    assert (await api.stops.active("crew-b", first)) is not None  # the old epoch still holds it
    assert [r["id"] for r in rows(settings, "SELECT id FROM crew_stop")] == [stop.id]  # nothing was deleted


async def test_a_database_that_has_no_demo_epoch_gives_no_replay_time(
    engine: AsyncEngine, settings: Settings, wall: ManualWall, tmp_path: Path
) -> None:
    built = build_fixture_snapshot(tmp_path / "silver")
    config = app_settings(settings, replay_dir=built.directory.parent, snapshot_id=SNAPSHOT_ID)
    services, close = await build_api_services(config, engine, wall=wall)  # no site was loaded: no site_epoch row
    try:
        await services.refresh_clock()  # never raises

        with pytest.raises(ReplayClockUnavailableError):
            services.clock()  # no invented time: neither the anchor nor the wall clock
    finally:
        await close()
