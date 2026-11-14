"""Contract suite of ``PushSubscriptionStore`` (fake in unit, Postgres in integration)."""

from stellar_blaze.ports.push import NewSubscription
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


CHECKS: dict[str, Check] = {
    name.removeprefix("check_"): fn for name, fn in sorted(globals().items()) if name.startswith("check_")
}
