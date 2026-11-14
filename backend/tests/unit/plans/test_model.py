import math
from datetime import UTC, datetime, time

import pytest

from stellar_blaze.domain.plans.model import (
    CrewMember,
    CrewPlan,
    CrewSpec,
    ShiftBlock,
    TickState,
    ZoneTimeline,
)
from stellar_blaze.domain.risk.levels import Zone

pytestmark = pytest.mark.unit

START = datetime(2026, 7, 1, 0, 0, tzinfo=UTC)


def test_tick_state_wire_values_are_snake_case() -> None:
    assert {s.name: s.value for s in TickState} == {
        "WORK": "work",
        "ADOSH_REST": "adosh_rest",
        "ART18_BREAK": "art18_break",
        "BAN": "ban",
        "STOPPED": "stopped",
        "OFF": "off",
    }


def test_zone_timeline_checks_its_lengths_and_its_clock() -> None:
    ok = ZoneTimeline(
        start_utc=START,
        zones=(Zone.LOW, Zone.HIGH),
        fallback=(False, True),
        source="forecast",
        protective_twl_w_m2=(150.0, math.nan),
    )
    assert ok.zones[1] is Zone.HIGH
    with pytest.raises(ValueError, match="same length"):
        ZoneTimeline(
            start_utc=START, zones=(Zone.LOW,), fallback=(False, True), source="forecast", protective_twl_w_m2=(1.0,)
        )
    with pytest.raises(ValueError, match="same length"):
        ZoneTimeline(
            start_utc=START, zones=(Zone.LOW,), fallback=(False,), source="forecast", protective_twl_w_m2=(1.0, 2.0)
        )
    with pytest.raises(ValueError, match="timezone-aware"):
        ZoneTimeline(
            start_utc=datetime(2026, 7, 1),  # noqa: DTZ001  (naive on purpose)
            zones=(Zone.LOW,),
            fallback=(False,),
            source="forecast",
            protective_twl_w_m2=(1.0,),
        )


def test_from_zones_builds_a_hand_made_timeline() -> None:
    timeline = ZoneTimeline.from_zones(START, [Zone.LOW, Zone.RED, Zone.HIGH])
    assert timeline.zones == (Zone.LOW, Zone.RED, Zone.HIGH)
    assert timeline.fallback == (False, False, False)
    assert all(math.isnan(v) for v in timeline.protective_twl_w_m2)
    assert timeline.source == "forecast"
    flagged = ZoneTimeline.from_zones(
        START, [Zone.HIGH], fallback=[True], protective_twl_w_m2=[99.0], source="fallback"
    )
    assert flagged.fallback == (True,)
    assert flagged.protective_twl_w_m2 == (99.0,)
    assert flagged.source == "fallback"


def test_with_zones_replaces_zones_and_keeps_everything_else() -> None:
    timeline = ZoneTimeline.from_zones(START, [Zone.LOW, Zone.LOW], protective_twl_w_m2=[150.0, 149.0])
    changed = timeline.with_zones([Zone.RED, 1])
    assert changed.zones == (Zone.RED, Zone.MEDIUM)
    assert all(isinstance(z, Zone) for z in changed.zones)
    assert changed.protective_twl_w_m2 == (150.0, 149.0)
    assert changed.fallback == timeline.fallback
    assert timeline.zones == (Zone.LOW, Zone.LOW)  # the original is untouched
    with pytest.raises(ValueError, match="one zone per tick"):
        timeline.with_zones([Zone.RED])


def test_the_personal_data_class_is_documented_on_the_crew_member() -> None:
    assert CrewMember.__doc__ is not None
    assert "PERSONAL data class, ADR 0010 §8" in CrewMember.__doc__


def test_crew_types_are_frozen_values() -> None:
    member = CrewMember(days_on_site=10, days_away=0, away_reason="none", experienced=True, juvenile=False)
    crew = CrewSpec(
        crew_id="crew-b",
        employer_id="emp-1",
        workload="heavy",
        headcount=20,
        shift=(ShiftBlock(time(6, 0), time(11, 0)), ShiftBlock(time(15, 0), time(18, 0))),
        days_per_week=6,
        members=(member,),
    )
    assert crew.members == (member,)
    assert (
        CrewSpec(
            crew_id="c", employer_id="e", workload="light", headcount=1, shift=(), days_per_week=5, members=None
        ).members
        is None
    )
    with pytest.raises(AttributeError):
        crew.headcount = 3  # type: ignore[misc]


def test_crew_plan_holds_the_tick_states_and_the_minute_counters() -> None:
    plan = CrewPlan(
        crew_id="crew-b",
        local_date=START.date(),
        start_utc=START,
        states=(TickState.WORK, TickState.ADOSH_REST),
        rule_ids=("P-H7.cap60",),
        status="rule",
        restricted_headcount=0,
        restrictions=(),
        work_minutes=5,
        adosh_rest_minutes=5,
        art18_minutes=0,
        stopped_minutes=0,
    )
    assert plan.states[0] is TickState.WORK
    assert plan.status == "rule"
