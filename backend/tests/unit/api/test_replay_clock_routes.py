"""Replay mode: a stop and a sign-off are stamped on the replay day, the audit row keeps the real time."""

import asyncio
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import pytest

from stellar_blaze.config import Settings
from tests.unit.api.support import SITE, Clock, World, bearer, client_for, make_world

pytestmark = pytest.mark.unit

REPLAY_DAY = date(2026, 7, 1)
ANCHOR = datetime(2026, 7, 1, 7, 10, tzinfo=UTC)  # 11:10 in Asia/Dubai: crew B's mid-day break (shifts 06-11, 15-18)
WALL = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)  # the real "now" of the demo, months after the replay day
PLAN = "/api/v1/crews/crew-b/day-plan"
SIGN = "/api/v1/crews/crew-b/day-plan/sign-off"
STOPS = "/api/v1/crews/crew-b/stops"
TIMELINE = "/api/v1/crews/crew-b/timeline"


def replay_world(settings: Settings) -> World:
    replay = settings.model_copy(
        update={"forecast_source": "replay", "replay_snapshot_id": "snap", "replay_default_date": REPLAY_DAY}
    )
    return make_world(replay, clock=Clock(WALL), replay_anchor=ANCHOR)


def levels(client_json: dict[str, object]) -> dict[str, str]:
    hours = client_json["hours"]
    assert isinstance(hours, list)
    return {h["starts_at"]: h["crew_level"] for h in hours}


def test_a_stop_recorded_in_replay_mode_lands_on_the_replay_day_and_a_resume_ends_it(settings: Settings) -> None:
    world = replay_world(settings)
    with client_for(world) as client:
        before = levels(client.get(TIMELINE).json())  # no date: the replay default date
        plan_before = client.get(PLAN, headers=bearer()).json()
        stop = client.post(STOPS, json={"reason_code": "heat"}, headers=bearer())
        open_levels = levels(client.get(TIMELINE).json())
        open_plan = client.get(PLAN, headers=bearer()).json()
        world.clock.advance(minutes=20)  # real time passes; the replay clock follows at the same speed
        resumed = client.delete(f"{STOPS}/{stop.json()['id']}", headers=bearer())
        closed_levels = levels(client.get(TIMELINE).json())
        closed_plan = client.get(PLAN, headers=bearer()).json()

    assert stop.status_code == 201
    assert stop.json()["started_at"] == "2026-07-01T07:10:00Z"  # the replay day, not 2026-11-15
    assert stop.json()["cleared_at"] is None
    assert "red" not in {before["2026-07-01T06:00:00Z"], before["2026-07-01T07:00:00Z"]}
    # Open stop: from the instant it was recorded (07:10Z, the midday break) to the end of crew B's shift, 18:00 local =
    # 14:00Z: hours 07Z..13Z are red; the hours starting 14Z and 15Z (after the shift) are not.
    assert open_levels["2026-07-01T06:00:00Z"] != "red"
    in_shift = {s: lv for s, lv in open_levels.items() if "2026-07-01T07:00:00Z" <= s < "2026-07-01T14:00:00Z"}
    assert in_shift
    assert all(level == "red" for level in in_shift.values())
    assert all(level != "red" for s, level in open_levels.items() if s >= "2026-07-01T14:00:00Z")
    stopped = [s for s in open_plan["segments"] if s["state"] == "stopped"]
    assert stopped, "the afternoon block of the shift is stopped"
    assert min(s["starts_at"] for s in stopped) >= "2026-07-01T07:10:00Z"
    assert all(s["state"] != "work" for s in open_plan["segments"] if s["starts_at"] >= "2026-07-01T07:10:00Z")
    # Resume: the stop ends at the replay time of the resume (07:30), so later hours are free again.
    assert resumed.status_code == 204
    record = asyncio.run(world.stops.get(stop.json()["id"]))
    assert record is not None
    assert record.cleared_at == ANCHOR + timedelta(minutes=20)
    assert closed_levels["2026-07-01T07:00:00Z"] == "red"  # the 07:10-07:30 stop overlaps that hour
    assert closed_levels["2026-07-01T08:00:00Z"] != "red"
    assert closed_plan["segments"] == plan_before["segments"]


def test_signed_at_follows_the_replay_clock_and_the_audit_row_keeps_the_real_time(settings: Settings) -> None:
    world = replay_world(settings)
    with client_for(world, database_config=True) as client:
        ids = [i["id"] for i in client.get(PLAN, headers=bearer()).json()["ack_items"]]
        world.clock.advance(minutes=5)
        signed = client.post(SIGN, json={"acknowledged_items": ids}, headers=bearer())
        stop = client.post(STOPS, json={"reason_code": "heat"}, headers=bearer())

    assert signed.status_code == 201, signed.text
    assert signed.json()["signed_at"] == "2026-07-01T07:15:00Z"  # replay clock: anchor + 5 real minutes
    [signed_row] = [r for r in world.audit.records if r.kind == "plan.signed"]
    [stop_row] = [r for r in world.audit.records if r.kind == "crew.stop_started"]
    assert signed_row.at == WALL + timedelta(minutes=5)  # tamper-evident: when it really happened
    assert stop_row.at == WALL + timedelta(minutes=5)
    assert stop.json()["started_at"] == "2026-07-01T07:15:00Z"


# --- the replay clock is anchored in the epoch row (ADR 0034 amendment of 2026-11-15) ---------------------------------


RESET = f"/api/v1/sites/{SITE}/demo-reset"
CREW_A_STOPS = "/api/v1/crews/crew-a/stops"
HEAT = {"reason_code": "heat"}


def test_a_service_route_refreshes_the_clock_before_it_runs_and_the_reset_forces_it(settings: Settings) -> None:
    world = replay_world(settings)
    calls: list[bool] = []
    inner = world.services.refresh_clock

    async def spy(*, force: bool = False) -> None:
        calls.append(force)
        await inner(force=force)

    world.services = replace(world.services, refresh_clock=spy)
    with client_for(world) as client:
        client.get(TIMELINE)
        after_route = list(calls)
        client.post(RESET, headers=bearer())

    assert after_route == [False]  # the dependency refreshed once, without force
    assert calls[1:] == [
        False,
        True,
    ]  # the reset route: the dependency's refresh, then the forced one after start_epoch


def test_a_demo_reset_re_anchors_the_api_clock_at_once(settings: Settings) -> None:
    world = replay_world(settings)
    with client_for(world) as client:
        world.clock.advance(hours=3)
        late = client.post(CREW_A_STOPS, json=HEAT, headers=bearer())
        reset = client.post(RESET, headers=bearer())
        after = client.post(
            "/api/v1/crews/crew-b/stops", json=HEAT, headers=bearer()
        )  # same wall second: inside the ttl

    assert late.status_code == 201
    assert late.json()["started_at"] == "2026-07-01T10:10:00Z"  # 07:10Z anchor + 3 h of the epoch
    assert reset.status_code == 200
    assert reset.json()["epoch_id"] == 2
    # The new epoch began at the wall time of the reset, so elapsed is 0: the anchor, with no wait for the cache ttl.
    assert after.json()["started_at"] == "2026-07-01T07:10:00Z"


def test_a_stop_of_one_epoch_is_gone_from_the_next_and_its_row_stays(settings: Settings) -> None:
    world = replay_world(settings)
    with client_for(world) as client:
        baseline_levels = levels(client.get(TIMELINE).json())
        baseline_plan = client.get(PLAN, headers=bearer()).json()
        stop = client.post(STOPS, json=HEAT, headers=bearer())
        stopped_levels = levels(client.get(TIMELINE).json())
        stopped_plan = client.get(PLAN, headers=bearer()).json()
        client.post(RESET, headers=bearer())
        fresh_levels = levels(client.get(TIMELINE).json())
        fresh_plan = client.get(PLAN, headers=bearer()).json()

    assert stop.status_code == 201
    assert "red" in stopped_levels.values()  # the stop was real in epoch 1 ...
    assert any(s["state"] == "stopped" for s in stopped_plan["segments"])
    assert fresh_levels == baseline_levels  # ... and is not Red in epoch 2
    assert fresh_plan["segments"] == baseline_plan["segments"]  # the plan is not stopped
    assert asyncio.run(world.stops.active("crew-b", 2)) is None  # no active stop for the same crew
    kept = asyncio.run(world.stops.get(stop.json()["id"]))
    assert kept is not None  # nothing was deleted
    assert kept.epoch_id == 1


def test_an_unreadable_epoch_is_a_503_on_a_route_that_reads_the_clock_and_nothing_else_stops(
    settings: Settings,
) -> None:
    world = replay_world(settings)

    async def unreachable() -> datetime | None:
        raise ConnectionRefusedError("password=hunter2 host=db.internal")

    world.sites.current_epoch_start = unreachable  # type: ignore[method-assign]  # the database goes away
    with client_for(world) as client:
        live = client.get("/api/v1/health/live")
        sites = client.get("/api/v1/sites")  # a ServicesDep route that never reads the clock
        timeline = client.get(TIMELINE)  # reads the clock
        stop = client.post(STOPS, json=HEAT, headers=bearer())  # stamps a stop with the clock

    assert live.status_code == 200
    assert sites.status_code == 200
    for refused in (timeline, stop):
        assert refused.status_code == 503
        assert refused.headers["content-type"].startswith("application/problem+json")
        assert refused.json()["type"] == "urn:stellar-blaze:problem:dependency-unavailable"
        assert refused.json()["dependency"] == "database"
        assert "hunter2" not in refused.text  # no connection detail reaches the client
    assert asyncio.run(world.stops.active("crew-b", 1)) is None  # nothing was stamped with an invented time


def test_without_replay_the_clock_is_the_wall_clock_and_the_default_refresh_is_a_no_op(settings: Settings) -> None:
    world = make_world(settings, clock=Clock(WALL))

    asyncio.run(world.services.refresh_clock(force=True))  # accepts force, returns None, touches nothing

    assert world.services.clock is world.clock
    assert world.services.clock() == WALL


FORECAST = f"/api/v1/sites/{SITE}/forecast/today"


def test_the_forecast_carries_the_domain_clock_so_a_web_app_reads_one_now(settings: Settings) -> None:
    """The web app takes "now" from this member in replay mode: it is the replay clock (the anchor plus the real time
    since the epoch started), never the wall clock, and it moves with real time."""
    world = replay_world(settings)
    with client_for(world) as client:
        first = client.get(FORECAST).json()
        world.clock.advance(minutes=20)
        later = client.get(FORECAST).json()

    assert (first["mode"], first["now"]) == ("replay", "2026-07-01T07:10:00Z")  # the anchor, not WALL (2026-11-15)
    assert later["now"] == "2026-07-01T07:30:00Z"  # real time passed; the replay clock follows at the same speed


# --- the window repeats (ADR 0034 amendment of 2026-11-20) ---------------------------------------------------------


DEMO_ANCHOR = datetime(2026, 7, 1, 6, 10, tzinfo=UTC)  # 10:10 in Asia/Dubai: the deployed SB_REPLAY_NOW
DEMO_END = datetime(2026, 7, 1, 13, 30, tzinfo=UTC)  # 17:30 Asia/Dubai


def demo_world(settings: Settings) -> World:
    replay = settings.model_copy(
        update={"forecast_source": "replay", "replay_snapshot_id": "snap", "replay_default_date": REPLAY_DAY}
    )
    return make_world(replay, clock=Clock(WALL), replay_anchor=DEMO_ANCHOR)


def test_regression_a_50_hour_old_epoch_serves_a_now_inside_the_working_day(settings: Settings) -> None:
    """Live 2026-11-20: 50 hours after the last reset the supervisor screen said "off shift, No level"."""
    world = demo_world(settings)
    with client_for(world) as client:
        world.clock.advance(hours=50)
        body = client.get(FORECAST).json()

    assert body["mode"] == "replay"
    assert (
        body["now"] == "2026-07-01T12:10:00Z"
    )  # 16:10 Dubai on the replay day (50 h = 6 windows + 6 h), not 2 days on


def test_the_forecast_now_wraps_from_17_29_to_10_10_at_the_exact_instant(settings: Settings) -> None:
    world = demo_world(settings)
    with client_for(world) as client:
        world.clock.advance(hours=7, minutes=19, seconds=59)
        before = client.get(FORECAST).json()["now"]
        world.clock.advance(seconds=1)
        after = client.get(FORECAST).json()["now"]

    assert before == "2026-07-01T13:29:59Z"
    assert after == "2026-07-01T06:10:00Z"


def test_a_stop_of_an_earlier_cycle_comes_back_at_the_same_domain_time_and_nothing_crashes(settings: Settings) -> None:
    """Rows of the replay day are scoped by epoch and carry domain timestamps: in the next cycle the same epoch's stop
    is in the domain future until the clock reaches its time again. The behaviour is kept (nothing is deleted)."""
    world = demo_world(settings)
    with client_for(world) as client:
        world.clock.advance(hours=6)  # 16:10 Dubai, inside crew B's afternoon block (15-18)
        stop = client.post(STOPS, json=HEAT, headers=bearer())
        in_cycle_one = levels(client.get(TIMELINE).json())
        world.clock.advance(hours=1, minutes=40)  # 7 h 40 min since the epoch: cycle two, domain time 10:30
        in_cycle_two = levels(client.get(TIMELINE).json())
        plan_two = client.get(PLAN, headers=bearer())
        later = client.post(CREW_A_STOPS, json=HEAT, headers=bearer())  # crew A, in cycle two, at 10:30
        resumed = client.delete(f"{STOPS}/{stop.json()['id']}", headers=bearer())  # a resume of the cycle-one stop
        after_resume = levels(client.get(TIMELINE).json())

    assert stop.status_code == 201
    assert stop.json()["started_at"] == "2026-07-01T12:10:00Z"
    assert in_cycle_one["2026-07-01T12:00:00Z"] == "red"  # the 16:10 stop covers the rest of the shift ...
    assert in_cycle_two["2026-07-01T12:00:00Z"] == "red"  # ... and is still there in cycle two, at the same domain time
    assert plan_two.status_code == 200
    assert later.status_code == 201
    assert later.json()["started_at"] == "2026-07-01T06:30:00Z"  # 7 h 40 min mod 7 h 20 min = 20 min: 10:30 Dubai
    assert resumed.status_code == 204  # clearing a stop that is in the domain future ends it at its own start: no crash
    assert after_resume["2026-07-01T12:00:00Z"] != "red"  # an undo-sized stop covers nothing
    record = asyncio.run(world.stops.get(stop.json()["id"]))
    assert record is not None
    assert record.epoch_id == 1  # still the row of epoch 1: nothing was moved or deleted


def test_a_demo_reset_in_a_later_cycle_re_anchors_to_10_10(settings: Settings) -> None:
    world = demo_world(settings)
    with client_for(world) as client:
        world.clock.advance(hours=50)
        client.get(FORECAST)
        client.post(RESET, headers=bearer())
        body = client.get(FORECAST).json()

    assert body["now"] == "2026-07-01T06:10:00Z"


def test_the_forecast_clock_is_the_wall_clock_in_live_mode(settings: Settings) -> None:
    with client_for(make_world(settings, clock=Clock(WALL))) as client:
        body = client.get(FORECAST, params={"date": "2026-07-01"}).json()
    assert (body["mode"], body["now"]) == ("live", "2026-11-15T09:00:00Z")
