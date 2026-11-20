"""The 60 s site-day cache and a domain clock that steps BACK (ADR 0034 amendment of 2026-11-20).

The replay clock now wraps at the end of its window (and goes back to the anchor at a demo reset): a cached day
stamped at 17:29 must not be served as "fresh" for the whole next cycle only because ``now - cached_at`` is negative.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest

from stellar_blaze.api import views
from stellar_blaze.application.runtime_config import SnapshotHolder
from stellar_blaze.composition import Runtime
from stellar_blaze.config import Settings
from tests.unit.api.support import Clock, build_world
from tests.unit.application.serving_support import catalog, demo_site, snapshot
from tests.unit.config.support import models

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]

NOW = datetime(2026, 7, 1, 13, 29, tzinfo=UTC)


async def test_a_cached_day_is_not_served_when_the_clock_has_gone_back(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = Clock(NOW)
    world = await build_world(settings, clock=clock)
    runtime = Runtime(world.settings, catalog(), models(), SnapshotHolder(snapshot(version_id=3)))
    computed: list[datetime] = []

    async def counting_site_day(**kwargs: Any) -> str:
        computed.append(kwargs["now"])
        return "day"

    monkeypatch.setattr(views, "site_day", counting_site_day)

    async def load() -> object:
        return await views.load_site_day(
            services=world.services,
            runtime=runtime,
            snapshot=snapshot(version_id=3),
            site=demo_site(),
            local_date=date(2026, 7, 1),
        )

    await load()
    clock.advance(seconds=30)
    await load()
    assert len(computed) == 1  # inside the 60 s: the cache answers

    clock.advance(seconds=31)
    await load()
    assert len(computed) == 2  # 61 s after the first: computed again

    clock.now = NOW - timedelta(hours=7, minutes=19)  # the replay clock wrapped (or a reset): the clock went back
    await load()
    assert len(computed) == 3  # the entry stamped in the "future" is not fresh
