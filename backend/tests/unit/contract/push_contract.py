"""Contract suite of ``PushSubscriptionStore`` (fake in unit, Postgres in integration)."""

import pytest

from stellar_blaze.ports.push import NewSubscription, SubscriptionCapError
from tests.unit.contract.b3_world import SITE_ID, Check, World, seeded


def sub(endpoint: str = "https://push.example/ep-1", *, crew_id: str | None = None) -> NewSubscription:
    return NewSubscription(
        endpoint=endpoint,
        p256dh="p256dh-key",
        auth="auth-secret",
        expiration_time=None,
        site_id=SITE_ID,
        crew_id=crew_id,
    )


async def check_upsert_by_endpoint_returns_the_existing_id(world: World) -> None:
    epoch = await seeded(world)

    first = await world.push.upsert_by_endpoint(sub(), epoch)
    again = await world.push.upsert_by_endpoint(sub(crew_id="crew-a"), epoch)
    other = await world.push.upsert_by_endpoint(sub("https://push.example/ep-2"), epoch)

    assert again == first
    assert other != first
    rows = await world.push.for_site(SITE_ID, epoch)
    assert [r.id for r in rows] == [first, other]
    assert rows[0].crew_id is None  # the first row's targets stay (a repeat POST changes nothing)


async def check_the_same_endpoint_is_a_different_subscription_in_another_epoch(world: World) -> None:
    epoch = await seeded(world)
    later = await world.sites.start_epoch(SITE_ID, "demo-token")

    first = await world.push.upsert_by_endpoint(sub(), epoch)
    second = await world.push.upsert_by_endpoint(sub(), later)

    assert first != second
    assert [r.id for r in await world.push.for_site(SITE_ID, epoch)] == [first]
    assert [r.id for r in await world.push.for_site(SITE_ID, later)] == [second]


async def check_site_and_crew_selection(world: World) -> None:
    epoch = await seeded(world)
    site_wide = await world.push.upsert_by_endpoint(sub("https://push.example/site"), epoch)
    crew_a = await world.push.upsert_by_endpoint(sub("https://push.example/a", crew_id="crew-a"), epoch)
    crew_b = await world.push.upsert_by_endpoint(sub("https://push.example/b", crew_id="crew-b"), epoch)

    assert {r.id for r in await world.push.for_site(SITE_ID, epoch)} == {site_wide, crew_a, crew_b}
    assert [r.id for r in await world.push.for_crew("crew-a", epoch)] == [crew_a]
    assert await world.push.for_crew("crew-c", epoch) == []


async def check_a_record_carries_the_subscription_keys_and_epoch(world: World) -> None:
    epoch = await seeded(world)
    new_id = await world.push.upsert_by_endpoint(
        NewSubscription(
            endpoint="https://push.example/full",
            p256dh="k1",
            auth="k2",
            expiration_time=1_900_000_000_000,
            site_id=SITE_ID,
            crew_id="crew-d",
        ),
        epoch,
    )

    (record,) = await world.push.for_crew("crew-d", epoch)

    assert record.id == new_id
    assert (record.endpoint, record.p256dh, record.auth, record.expiration_time) == (
        "https://push.example/full",
        "k1",
        "k2",
        1_900_000_000_000,
    )
    assert (record.site_id, record.crew_id, record.epoch_id) == (SITE_ID, "crew-d", epoch)
    assert record.created_at.utcoffset() is not None
    assert "push.example" not in repr(record)  # the endpoint never reaches a log line through a repr


async def check_delete_and_delete_gone_are_idempotent(world: World) -> None:
    epoch = await seeded(world)
    a = await world.push.upsert_by_endpoint(sub("https://push.example/a"), epoch)
    b = await world.push.upsert_by_endpoint(sub("https://push.example/b"), epoch)

    await world.push.delete(a)
    await world.push.delete(a)
    await world.push.delete("sub-unknown")
    await world.push.delete_gone(b)
    await world.push.delete_gone(b)

    assert await world.push.for_site(SITE_ID, epoch) == []
    # The endpoint is free again: a new subscription gets a new id.
    assert await world.push.upsert_by_endpoint(sub("https://push.example/a"), epoch) != a


async def check_id_for_endpoint_and_the_counts_are_per_epoch(world: World) -> None:
    epoch = await seeded(world)
    later = await world.sites.start_epoch(SITE_ID, "demo-token")
    site_wide = await world.push.upsert_by_endpoint(sub("https://push.example/site"), epoch)
    crew_a = await world.push.upsert_by_endpoint(sub("https://push.example/a", crew_id="crew-a"), epoch)

    assert await world.push.id_for_endpoint("https://push.example/site", epoch) == site_wide
    assert await world.push.id_for_endpoint("https://push.example/a", epoch) == crew_a
    assert await world.push.id_for_endpoint("https://push.example/site", later) is None
    assert await world.push.id_for_endpoint("https://push.example/none", epoch) is None
    assert await world.push.count_for_site(SITE_ID, epoch) == 2  # crew-targeted subscriptions count for the site
    assert await world.push.count_for_crew("crew-a", epoch) == 1
    assert await world.push.count_for_crew("crew-b", epoch) == 0
    assert await world.push.count_for_site(SITE_ID, later) == 0
    await world.push.delete(site_wide)
    assert await world.push.count_for_site(SITE_ID, epoch) == 1


async def check_the_caps_are_enforced_in_the_upsert_itself(world: World) -> None:
    epoch = await seeded(world)
    later = await world.sites.start_epoch(SITE_ID, "demo-token")
    ep = [f"https://push.example/cap-{n}" for n in range(4)]

    first = await world.push.upsert_by_endpoint(sub(ep[0]), epoch, site_cap=2)
    await world.push.upsert_by_endpoint(sub(ep[1], crew_id="crew-a"), epoch, site_cap=2)  # crew rows count for the site
    with pytest.raises(SubscriptionCapError) as site_full:
        await world.push.upsert_by_endpoint(sub(ep[2]), epoch, site_cap=2)
    assert site_full.value.scope == "site"
    assert await world.push.upsert_by_endpoint(sub(ep[0]), epoch, site_cap=2) == first  # a repeat is not counted
    assert await world.push.count_for_site(SITE_ID, epoch) == 2  # the refused row was not stored
    assert await world.push.id_for_endpoint(ep[2], epoch) is None
    await world.push.upsert_by_endpoint(sub(ep[2]), later, site_cap=2)  # the cap is per epoch

    with pytest.raises(SubscriptionCapError) as crew_full:  # crew-a already holds one
        await world.push.upsert_by_endpoint(sub(ep[3], crew_id="crew-a"), epoch, crew_cap=1)
    assert crew_full.value.scope == "crew"
    await world.push.upsert_by_endpoint(sub(ep[3], crew_id="crew-b"), epoch, crew_cap=1)  # per crew
    await world.push.upsert_by_endpoint(
        sub("https://push.example/site-wide"), epoch, crew_cap=1
    )  # no crew: no crew cap
    assert await world.push.count_for_crew("crew-a", epoch) == 1
    assert await world.push.count_for_crew("crew-b", epoch) == 1

    for n in range(5):  # no cap given: no limit (the caps are the caller's policy)
        await world.push.upsert_by_endpoint(sub(f"https://push.example/free-{n}"), epoch)


CHECKS: dict[str, Check] = {
    name.removeprefix("check_"): fn for name, fn in sorted(globals().items()) if name.startswith("check_")
}
