"""Contract suite of ``SiteRepository``, ``EpochStore`` and ``SiteFixtureStore`` (fake in unit, Postgres in integ.)."""

import asyncio
from datetime import time

import pytest

from stellar_blaze.ports.audit import AuditEvent
from stellar_blaze.ports.sites import (
    CrewNotFoundError,
    NotADemoSiteError,
    SiteFixture,
    SiteNotFoundError,
    SiteSyntheticChangeError,
)
from tests.unit.contract.b3_world import SITE_ID, Check, World, demo_fixture, seeded


async def check_the_demo_site_and_its_contacts_are_served(world: World) -> None:
    await seeded(world)

    site = await world.sites.get_site(SITE_ID)
    assert site is not None
    assert (site.name, site.timezone, site.station, site.employer_id, site.synthetic) == (
        "Mussafah M-14 yard (synthetic)",
        "Asia/Dubai",
        "OMAA",
        "emp-demo",
        True,
    )
    assert (site.lat, site.lon) == (24.36, 54.50)
    assert (site.supervisor_phone, site.first_aider_phone) == ("+12025550143", "+12025550144")
    assert [s.id for s in await world.sites.list_sites()] == [SITE_ID]
    assert await world.sites.get_site("nope") is None


async def check_crews_are_listed_with_aggregates_only(world: World) -> None:
    await seeded(world)

    crews = await world.sites.list_crews(SITE_ID)

    assert [(c.id, c.name, c.task_label, c.workload, c.member_count) for c in crews] == [
        ("crew-a", "Crew A", "Rebar fixing", "heavy", 12),
        ("crew-b", "Crew B", "Concrete pour", "heavy", 20),
        ("crew-c", "Crew C", "Formwork", "moderate", 9),
        ("crew-d", "Crew D", "Survey and inspection", "light", 4),
    ]
    assert all(c.days_per_week == 6 and c.site_id == SITE_ID and c.employer_id == "emp-demo" for c in crews)
    assert all([(b.start, b.end) for b in c.shift] == [(time(6), time(11)), (time(15), time(18))] for c in crews)
    assert await world.sites.list_crews("nope") == []
    got = await world.sites.get_crew("crew-d")
    assert got is not None
    assert got.member_count == 4
    assert await world.sites.get_crew("crew-z") is None


async def check_crew_spec_carries_the_members_the_planner_needs(world: World) -> None:
    await seeded(world)

    a = await world.sites.crew_spec("crew-a")
    c = await world.sites.crew_spec("crew-c")

    assert (a.crew_id, a.employer_id, a.workload, a.headcount, a.days_per_week) == (
        "crew-a",
        "emp-demo",
        "heavy",
        12,
        6,
    )
    assert a.members is not None
    assert len(a.members) == 12
    assert sum(1 for m in a.members if not m.experienced and m.days_on_site == 2) == 2
    assert not any(m.juvenile for m in a.members)
    assert c.members is not None
    returning = [m for m in c.members if m.days_away > 0]
    assert [(m.days_away, m.away_reason, m.experienced) for m in returning] == [(10, "leave", True)]
    assert (await world.sites.crew_spec("crew-b")).headcount == 20
    assert (await world.sites.crew_spec("crew-d")).headcount == 4
    with pytest.raises(CrewNotFoundError):
        await world.sites.crew_spec("crew-z")


async def check_loading_the_fixture_twice_changes_nothing(world: World) -> None:
    first_epoch = await seeded(world)
    spec = await world.sites.crew_spec("crew-a")

    await world.sites.upsert_fixture(demo_fixture(), "someone-else")

    assert await world.sites.active_epoch(SITE_ID) == first_epoch  # no second epoch for an existing site
    assert await world.sites.crew_spec("crew-a") == spec  # members were not duplicated
    assert len(await world.sites.list_crews(SITE_ID)) == 4


async def check_a_changed_fixture_is_applied(world: World) -> None:
    await seeded(world)
    fixture = demo_fixture()
    crews = tuple(
        c.model_copy(update={"task_label": "Rebar and mesh"}) if c.id == "crew-a" else c for c in fixture.crews
    )
    site = fixture.site.model_copy(update={"supervisor_phone": None})

    await world.sites.upsert_fixture(SiteFixture(site=site, crews=crews), "ali")

    crew = await world.sites.get_crew("crew-a")
    stored = await world.sites.get_site(SITE_ID)
    assert crew is not None
    assert crew.task_label == "Rebar and mesh"
    assert stored is not None
    assert stored.supervisor_phone is None
    assert stored.first_aider_phone == "+12025550144"


async def check_active_epoch_starts_at_one_epoch_and_a_reset_moves_it_forward(world: World) -> None:
    first = await seeded(world)

    second = await world.sites.start_epoch(SITE_ID, "demo-token")

    assert second > first
    assert await world.sites.active_epoch(SITE_ID) == second
    with pytest.raises(SiteNotFoundError):
        await world.sites.active_epoch("nope")


async def check_start_epoch_is_refused_for_a_site_that_is_not_synthetic(world: World) -> None:
    await seeded(world)
    real = demo_fixture().site.model_copy(update={"id": "site-real", "synthetic": False})
    await world.sites.upsert_fixture(SiteFixture(site=real, crews=()), "ali")
    before = await world.sites.active_epoch("site-real")

    with pytest.raises(NotADemoSiteError):
        await world.sites.start_epoch("site-real", "demo-token")
    with pytest.raises(SiteNotFoundError):
        await world.sites.start_epoch("nope", "demo-token")

    assert await world.sites.active_epoch("site-real") == before  # nothing was written


async def check_a_load_never_flips_the_synthetic_flag_of_an_existing_site(world: World) -> None:
    await seeded(world)
    flipped = demo_fixture().site.model_copy(update={"synthetic": False})

    with pytest.raises(SiteSyntheticChangeError):
        await world.sites.upsert_fixture(SiteFixture(site=flipped, crews=()), "ali")

    stored = await world.sites.get_site(SITE_ID)
    assert stored is not None
    assert stored.synthetic is True  # a demo site cannot be turned into a real one (or back) by a load


async def check_concurrent_first_loads_create_one_epoch(world: World) -> None:
    await asyncio.gather(*(world.sites.upsert_fixture(demo_fixture(), "ali") for _ in range(4)))

    first = await world.sites.active_epoch(SITE_ID)
    assert await world.sites.start_epoch(SITE_ID, "demo-token") == first + 1  # exactly one epoch existed before


async def check_start_epoch_appends_its_audit_row_in_the_same_unit_of_work(world: World) -> None:
    first = await seeded(world)

    def demo_reset(previous: int, new: int) -> AuditEvent:
        return AuditEvent(
            kind="demo_reset",
            actor="demo-token",
            actor_role="employer",
            employer_id="emp-demo",
            site_id=SITE_ID,
            outcome="reset",
            detail={"previous_epoch_id": previous, "epoch_id": new},
        )

    new = await world.sites.start_epoch(SITE_ID, "demo-token", audit=demo_reset)

    assert await world.audit.verify() is None
    rows = await world.audit.site_entries(SITE_ID, ["demo_reset"], 10, epoch_id=new)
    assert rows == []  # the demo_reset row carries no epoch of its own: it is not read by epoch, and no worker sees it
    assert first < new


CHECKS: dict[str, Check] = {
    name.removeprefix("check_"): fn for name, fn in sorted(globals().items()) if name.startswith("check_")
}
