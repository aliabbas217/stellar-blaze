"""Replay mode: a stop and a sign-off are stamped on the replay day, the audit row keeps the real time."""

import asyncio
from datetime import UTC, date, datetime, timedelta

import pytest

from stellar_blaze.config import Settings
from tests.unit.api.support import Clock, World, bearer, client_for, make_world

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
    # Open stop: from the instant it was recorded to the end of the response day.
    assert open_levels["2026-07-01T06:00:00Z"] != "red"
    assert all(level == "red" for start, level in open_levels.items() if start >= "2026-07-01T07:00:00Z")
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
