"""An undone or cleared stop must not leave the crew Red (F2 finding): API level, hand-computed instants.

Crew B (shift 06:00-11:00 and 15:00-18:00 site-local, Asia/Dubai = UTC+4) is stopped at 10:00 local = 06:00Z
on 2026-07-01.
The shift ends at 18:00 local = 14:00Z; the working-day hours run 06:00-19:00 local = 02:00Z-15:00Z (14 hours).
A stop undone within ``STOP_UNDO_WINDOW_S`` (10 s) leaves no trace in levels or plans (both audit rows stay).
"""

from datetime import datetime, timedelta

import pytest

from stellar_blaze.config import Settings
from tests.unit.api.support import SITE, World, bearer, client_for, make_world

pytestmark = pytest.mark.unit
DATE = {"date": "2026-07-01"}
CREW = "/api/v1/crews/crew-b"
STOPS = f"{CREW}/stops"
TICK = timedelta(minutes=5)


def levels(client_json: dict[str, object]) -> dict[str, str | None]:
    hours = client_json["hours"]
    assert isinstance(hours, list)
    return {h["starts_at"]: h["crew_level"] for h in hours}


def stopped_runs(plan: dict[str, object]) -> list[tuple[str, str]]:
    segments = plan["segments"]
    assert isinstance(segments, list)
    return [(s["starts_at"], s["ends_at"]) for s in segments if s["state"] == "stopped"]


def red_starts(timeline: dict[str, object]) -> list[str]:
    return [start for start, level in levels(timeline).items() if level == "red"]


def stopped_at_ten(world: World) -> None:
    world.clock.advance(hours=5)  # 06:00Z = 10:00 local, inside crew B's first block


def audit_kinds(world: World) -> list[str]:
    return [r.kind for r in world.audit.records if r.kind.startswith("crew.stop")]


@pytest.mark.parametrize("undo_after_s", [8, 10])
def test_a_stop_undone_within_the_window_leaves_no_trace_in_levels_or_plans(
    settings: Settings, undo_after_s: int
) -> None:
    """Case (a): ticks of 06:00Z would be masked by the old code (stop overlaps tick 06:00-06:05), hour 06Z Red, 5 min
    `stopped` in the plan. Inclusive at exactly 10 s."""
    world = make_world(settings)
    with client_for(world) as client:
        baseline_timeline = client.get(f"{CREW}/timeline", params=DATE).json()
        baseline_plan = client.get(f"{CREW}/day-plan", params=DATE, headers=bearer()).json()
        stopped_at_ten(world)
        stop = client.post(STOPS, json={"reason_code": "heat"}, headers=bearer()).json()
        world.clock.advance(seconds=undo_after_s)
        assert client.delete(f"{STOPS}/{stop['id']}", headers=bearer()).status_code == 204
        timeline = client.get(f"{CREW}/timeline", params=DATE).json()
        plan = client.get(f"{CREW}/day-plan", params=DATE, headers=bearer()).json()
        crews = client.get(f"/api/v1/sites/{SITE}/crews", params=DATE).json()

    assert levels(timeline) == levels(baseline_timeline)
    assert red_starts(timeline) == []
    assert stopped_runs(plan) == []
    assert plan["segments"] == baseline_plan["segments"]
    assert plan["zone_hours"] == baseline_plan["zone_hours"]
    crew_b = next(c for c in crews if c["id"] == "crew-b")
    assert (crew_b["stopped"], crew_b["active_stop_id"], crew_b["stopped_at"]) == (False, None, None)
    assert audit_kinds(world) == ["crew.stop_started", "crew.stop_cleared"]  # both rows stay


def test_a_stop_undone_just_after_the_window_still_counts(settings: Settings) -> None:
    """11 s: the stop covers the one tick it overlaps (06:00-06:05Z = 5 min stopped) and hour 06Z is Red."""
    world = make_world(settings)
    with client_for(world) as client:
        stopped_at_ten(world)
        stop = client.post(STOPS, json={"reason_code": "heat"}, headers=bearer()).json()
        world.clock.advance(seconds=11)
        client.delete(f"{STOPS}/{stop['id']}", headers=bearer())
        timeline = client.get(f"{CREW}/timeline", params=DATE).json()
        plan = client.get(f"{CREW}/day-plan", params=DATE, headers=bearer()).json()

    assert red_starts(timeline) == ["2026-07-01T06:00:00Z"]
    assert stopped_runs(plan) == [("2026-07-01T06:00:00Z", "2026-07-01T06:05:00Z")]


def test_a_stop_cleared_after_25_minutes_covers_exactly_the_overlapped_ticks(settings: Settings) -> None:
    """Case (b): [06:00Z, 06:25Z) overlaps ticks 06:00, 06:05, 06:10, 06:15, 06:20 (25 min); only hour 06Z is Red."""
    world = make_world(settings)
    with client_for(world) as client:
        stopped_at_ten(world)
        stop = client.post(STOPS, json={"reason_code": "heat"}, headers=bearer()).json()
        world.clock.advance(minutes=25)
        client.delete(f"{STOPS}/{stop['id']}", headers=bearer())
        timeline = client.get(f"{CREW}/timeline", params=DATE).json()
        plan = client.get(f"{CREW}/day-plan", params=DATE, headers=bearer()).json()
        crews = client.get(f"/api/v1/sites/{SITE}/crews", params=DATE).json()

    assert red_starts(timeline) == ["2026-07-01T06:00:00Z"]  # 07Z, 08Z, ... are not Red after the clearing
    runs = stopped_runs(plan)
    assert runs[0][0] == "2026-07-01T06:00:00Z"
    assert runs[-1][1] == "2026-07-01T06:25:00Z"
    assert sum((datetime.fromisoformat(end) - datetime.fromisoformat(start)) // TICK for start, end in runs) == 5
    crew_b = next(c for c in crews if c["id"] == "crew-b")
    assert (crew_b["stopped"], crew_b["active_stop_id"]) == (False, None)
    assert audit_kinds(world) == ["crew.stop_started", "crew.stop_cleared"]


def test_an_active_stop_covers_to_the_end_of_the_shift_and_not_after(settings: Settings) -> None:
    """Case (c): active from 06:00Z; the last block ends 18:00 local = 14:00Z. Hours 06Z..13Z are Red; the hours
    starting 14Z (18:00 local) and 15Z (19:00 local) are not; the plan stops work up to 14:00Z and no further."""
    world = make_world(settings)
    with client_for(world) as client:
        stopped_at_ten(world)
        client.post(STOPS, json={"reason_code": "heat"}, headers=bearer())
        timeline = client.get(f"{CREW}/timeline", params=DATE).json()
        plan = client.get(f"{CREW}/day-plan", params=DATE, headers=bearer()).json()
        crews = client.get(f"/api/v1/sites/{SITE}/crews", params=DATE).json()

    assert red_starts(timeline) == [f"2026-07-01T{h:02d}:00:00Z" for h in range(6, 14)]
    levels_by_start = levels(timeline)
    assert levels_by_start["2026-07-01T14:00:00Z"] != "red"
    assert levels_by_start["2026-07-01T15:00:00Z"] != "red"
    runs = stopped_runs(plan)
    assert runs[0][0] == "2026-07-01T06:00:00Z"
    assert all(end <= "2026-07-01T14:00:00Z" for _, end in runs)
    crew_b = next(c for c in crews if c["id"] == "crew-b")
    assert crew_b["stopped"] is True  # the record still stands until it is cleared
