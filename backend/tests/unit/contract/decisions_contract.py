"""Contract suite of the epoch-scoped decision stores: alerts, day plans, crew stops, plan sign-offs, and one check that
every read is epoch-scoped (ADR 0066). Fake in unit, Postgres in integration."""

from datetime import UTC, date, datetime, timedelta

from stellar_blaze.domain.risk.levels import AlertLevel
from stellar_blaze.ports.alerts import AlertEventInput
from stellar_blaze.ports.audit import AuditEvent
from stellar_blaze.ports.plans import DayPlanInput, PlanSignoffInput
from stellar_blaze.ports.push import NewSubscription
from tests.unit.contract.b3_world import SHA, SITE_ID, Check, World, seeded

DAY = date(2026, 7, 1)


def alert(
    world: World,
    epoch: int,
    *,
    crew_id: str | None = None,
    level: AlertLevel = AlertLevel.AMBER,
    key: str = "k1",
    kind: str = "escalate",
) -> AlertEventInput:
    return AlertEventInput.model_validate(
        {
            "site_id": SITE_ID,
            "audience": "site" if crew_id is None else "crew",
            "crew_id": crew_id,
            "epoch_id": epoch,
            "level": level,
            "valid_from": datetime(2026, 7, 1, 8, tzinfo=UTC),
            "template_id": "level-change",
            "kind": kind,
            "dedupe_key": key,
            "dispatch_interval_minutes": 5,
            "ruleset_id": "ae-heat-2026.1",
            "ruleset_sha256": SHA,
            "model_id": None,
            "config_version_id": world.config_version_id,
            "config_sha256": world.config_sha256,
        }
    )


def day_plan(world: World, epoch: int, crew_id: str = "crew-b") -> DayPlanInput:
    return DayPlanInput(
        epoch_id=epoch,
        crew_id=crew_id,
        local_date=DAY,
        status="rule",
        plan={"segments": [{"state": "work"}], "work_minutes": 10},
        ruleset_id="ae-heat-2026.1",
        ruleset_sha256=SHA,
        model_id="corrector-x",
        config_version_id=world.config_version_id,
        config_sha256=world.config_sha256,
    )


def signoff(world: World, epoch: int, plan_hash: str, *, crew_id: str = "crew-b") -> PlanSignoffInput:
    return PlanSignoffInput(
        epoch_id=epoch,
        crew_id=crew_id,
        local_date=DAY,
        actor="sup-token",
        actor_role="supervisor",
        acknowledged_items=["a1", "a2"],
        deviation_reason_code=None,
        plan_hash=plan_hash,
        ruleset_id="ae-heat-2026.1",
        ruleset_sha256=SHA,
        model_id=None,
        config_version_id=world.config_version_id,
        config_sha256=world.config_sha256,
    )


async def check_alert_insert_dedupes_on_the_key_within_an_epoch(world: World) -> None:
    epoch = await seeded(world)

    first = await world.alerts.insert(alert(world, epoch))
    again = await world.alerts.insert(alert(world, epoch, level=AlertLevel.RED))  # same key: the event exists already
    other = await world.alerts.insert(alert(world, epoch, key="k2"))

    assert first is not None
    assert other is not None
    assert again is None
    assert first.id != other.id
    assert (first.level, first.dispatch_interval_minutes, first.delivered, first.failed) == (AlertLevel.AMBER, 5, 0, 0)
    assert (first.ruleset_id, first.config_version_id, first.model_id) == (
        "ae-heat-2026.1",
        world.config_version_id,
        None,
    )
    last = await world.alerts.last_for_target(SITE_ID, None, epoch)
    assert last is not None
    assert last.id == other.id


async def check_alert_dedupe_is_per_epoch(world: World) -> None:
    epoch = await seeded(world)
    later = await world.sites.start_epoch(SITE_ID, "demo-token")

    first = await world.alerts.insert(alert(world, epoch, level=AlertLevel.RED))
    second = await world.alerts.insert(alert(world, later))  # the same dedupe key in the next epoch is a new event

    assert first is not None
    assert second is not None
    # A previous visitor's Red is not the "last event" of the next epoch (ADR 0066, ADR 0058 decision 1).
    last_later = await world.alerts.last_for_target(SITE_ID, None, later)
    assert last_later is not None
    assert last_later.level == AlertLevel.AMBER
    last_first = await world.alerts.last_for_target(SITE_ID, None, epoch)
    assert last_first is not None
    assert last_first.level == AlertLevel.RED


async def check_last_for_target_separates_the_site_from_each_crew(world: World) -> None:
    epoch = await seeded(world)
    assert await world.alerts.last_for_target(SITE_ID, None, epoch) is None
    await world.alerts.insert(alert(world, epoch, key="site"))
    await world.alerts.insert(alert(world, epoch, crew_id="crew-a", level=AlertLevel.ORANGE, key="a"))
    await world.alerts.insert(
        alert(world, epoch, crew_id="crew-a", level=AlertLevel.GREEN, key="a2", kind="deescalate")
    )

    site = await world.alerts.last_for_target(SITE_ID, None, epoch)
    crew_a = await world.alerts.last_for_target(SITE_ID, "crew-a", epoch)

    assert site is not None
    assert site.audience == "site"
    assert site.level == AlertLevel.AMBER
    assert crew_a is not None
    assert crew_a.level == AlertLevel.GREEN
    assert crew_a.kind == "deescalate"
    assert await world.alerts.last_for_target(SITE_ID, "crew-b", epoch) is None


async def check_day_plans_are_appended_and_the_newest_is_served(world: World) -> None:
    epoch = await seeded(world)
    assert await world.day_plans.latest("crew-b", DAY, epoch) is None

    first = await world.day_plans.insert(day_plan(world, epoch))
    second = await world.day_plans.insert(day_plan(world, epoch).model_copy(update={"status": "fallback"}))

    assert second.id > first.id
    latest = await world.day_plans.latest("crew-b", DAY, epoch)
    assert latest is not None
    assert latest.id == second.id
    assert latest.status == "fallback"
    assert (first.violations, first.model_id, first.ruleset_sha256) == (0, "corrector-x", SHA)
    assert first.plan == {"segments": [{"state": "work"}], "work_minutes": 10}
    assert await world.day_plans.latest("crew-a", DAY, epoch) is None


async def check_a_stop_lives_from_start_to_clear_and_clearing_is_idempotent(world: World) -> None:
    epoch = await seeded(world)
    now = datetime.now(UTC)

    stop = await world.stops.start("crew-b", "heat", "sup-token", epoch)

    assert (stop.crew_id, stop.reason_code, stop.actor, stop.epoch_id, stop.cleared_at) == (
        "crew-b",
        "heat",
        "sup-token",
        epoch,
        None,
    )
    assert stop.id.startswith("stop-")
    assert await world.stops.get(stop.id) == stop
    assert await world.stops.get("stop-unknown") is None
    active = await world.stops.active("crew-b", epoch)
    assert active is not None
    assert active.id == stop.id
    assert await world.stops.active("crew-a", epoch) is None

    await world.stops.clear(stop.id, "sup-token")
    cleared = await world.stops.get(stop.id)
    await world.stops.clear(stop.id, "someone-else")  # idempotent: the first clearing stands
    await world.stops.clear("stop-unknown", "someone-else")

    assert cleared is not None
    assert cleared.cleared_at is not None
    assert cleared.cleared_at >= stop.started_at
    assert cleared.cleared_by == "sup-token"
    assert await world.stops.get(stop.id) == cleared
    assert await world.stops.active("crew-b", epoch) is None
    assert cleared.started_at <= now + timedelta(seconds=5)


async def check_active_between_returns_the_stops_that_overlap_the_window(world: World) -> None:
    epoch = await seeded(world)
    stop = await world.stops.start("crew-b", "heat", "sup-token", epoch)
    start = stop.started_at

    open_now = await world.stops.active_between("crew-b", start - timedelta(hours=1), start + timedelta(hours=1), epoch)
    later = await world.stops.active_between("crew-b", start + timedelta(hours=1), start + timedelta(hours=2), epoch)
    before = await world.stops.active_between("crew-b", start - timedelta(hours=2), start - timedelta(hours=1), epoch)
    other_crew = await world.stops.active_between(
        "crew-a", start - timedelta(hours=1), start + timedelta(hours=1), epoch
    )
    await world.stops.clear(stop.id, "sup-token")
    after_clear = await world.stops.active_between(
        "crew-b", start + timedelta(hours=1), start + timedelta(hours=2), epoch
    )
    during = await world.stops.active_between("crew-b", start - timedelta(hours=1), start + timedelta(hours=1), epoch)

    assert [s.id for s in open_now] == [stop.id]
    assert [s.id for s in later] == [stop.id]  # an open stop overlaps every later window
    assert before == []
    assert other_crew == []
    assert after_clear == []  # cleared before this window starts
    assert [s.id for s in during] == [stop.id]  # a cleared stop still overlaps the window it was active in


async def check_the_latest_signoff_is_the_current_one(world: World) -> None:
    epoch = await seeded(world)
    assert await world.signoffs.latest("crew-b", DAY, epoch) is None

    first = await world.signoffs.insert(signoff(world, epoch, "1" * 64))
    second = await world.signoffs.insert(signoff(world, epoch, "2" * 64))

    assert second.id > first.id
    latest = await world.signoffs.latest("crew-b", DAY, epoch)
    assert latest is not None
    assert latest.plan_hash == "2" * 64
    assert latest.id == second.id
    assert (latest.actor, latest.actor_role, latest.acknowledged_items, latest.deviation_reason_code) == (
        "sup-token",
        "supervisor",
        ["a1", "a2"],
        None,
    )
    assert latest.signed_at.utcoffset() is not None
    assert await world.signoffs.latest("crew-b", date(2026, 7, 2), epoch) is None
    assert await world.signoffs.latest("crew-a", DAY, epoch) is None


async def check_epoch_scoped_reads(world: World) -> None:
    """Everything written in epoch 1 is invisible after ``start_epoch`` and visible again by explicit epoch id."""
    first = await seeded(world)
    await world.stops.start("crew-b", "heat", "sup-token", first)
    await world.signoffs.insert(signoff(world, first, "1" * 64))
    await world.day_plans.insert(day_plan(world, first))
    sub_id = await world.push.upsert_by_endpoint(
        NewSubscription(endpoint="https://push.example/e", p256dh="k", auth="a", site_id=SITE_ID, crew_id="crew-b"),
        first,
    )
    await world.alerts.insert(alert(world, first, crew_id="crew-b", level=AlertLevel.RED))
    await world.audit.append(
        AuditEvent(
            kind="data_request.refused",
            actor="emp-token",
            actor_role="employer",
            employer_id="emp-demo",
            site_id=SITE_ID,
            epoch_id=first,
            outcome="refused",
            detail={"rule": "ADR 0004"},
        )
    )

    second = await world.sites.start_epoch(SITE_ID, "demo-token")
    window = (datetime.now(UTC) - timedelta(hours=1), datetime.now(UTC) + timedelta(hours=1))

    assert await world.sites.active_epoch(SITE_ID) == second
    assert await world.stops.active("crew-b", second) is None
    assert await world.stops.active_between("crew-b", *window, second) == []
    assert await world.signoffs.latest("crew-b", DAY, second) is None
    assert await world.day_plans.latest("crew-b", DAY, second) is None
    assert await world.push.for_site(SITE_ID, second) == []
    assert await world.push.for_crew("crew-b", second) == []
    assert await world.alerts.last_for_target(SITE_ID, "crew-b", second) is None
    assert await world.audit.site_entries(SITE_ID, ["data_request.refused"], 50, epoch_id=second) == []

    # ... and every row is still there under its own epoch.
    assert await world.stops.active("crew-b", first) is not None
    assert len(await world.stops.active_between("crew-b", *window, first)) == 1
    assert await world.signoffs.latest("crew-b", DAY, first) is not None
    assert await world.day_plans.latest("crew-b", DAY, first) is not None
    assert [r.id for r in await world.push.for_crew("crew-b", first)] == [sub_id]
    assert await world.alerts.last_for_target(SITE_ID, "crew-b", first) is not None
    assert len(await world.audit.site_entries(SITE_ID, ["data_request.refused"], 50, epoch_id=first)) == 1


CHECKS: dict[str, Check] = {
    name.removeprefix("check_"): fn for name, fn in sorted(globals().items()) if name.startswith("check_")
}
