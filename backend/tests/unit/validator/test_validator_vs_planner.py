"""The independent validator against the rule planner: every legal-shift rule plan must validate clean.

This is the one test module that imports the planner (``plan_crew``). A rejection here is a planner bug (or a
disagreement of the two definitions) and answers HTTP 500 in the API: do not weaken the validator or the test, report a
minimal example.
"""

import dataclasses
from datetime import UTC, date, datetime, time
from itertools import product
from zoneinfo import ZoneInfo

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from stellar_blaze.domain.planner.rule_planner import plan_crew
from stellar_blaze.domain.plans.model import CrewMember, CrewSpec, ShiftBlock, TickState, Workload, ZoneTimeline
from stellar_blaze.domain.risk.levels import Zone
from stellar_blaze.domain.validator.validator import ValidationResult, validate_plan
from tests.unit.validator.support import (
    EXPERIENCED,
    L1,
    L1_EVENING,
    SUMMER,
    TICKS,
    WINTER,
    at,
    clauses_of,
    member,
    rules_of,
)

pytestmark = pytest.mark.unit

DUBAI = ZoneInfo("Asia/Dubai")
LEGAL_SHIFTS = {"L1": L1, "L1-evening": L1_EVENING}
DATES = {"summer": SUMMER, "winter": WINTER}
WORKLOADS: tuple[Workload, ...] = ("light", "moderate", "heavy")


def _timeline(zones: list[Zone], local_date: date) -> ZoneTimeline:
    """A zone timeline from 04:00 Dubai (00:00 UTC) of ``local_date``."""
    start = datetime.combine(local_date, time(0, 0), tzinfo=UTC)
    return ZoneTimeline.from_zones(start, zones)


def _paint(*blocks: tuple[str, str, Zone], default: Zone = Zone.LOW) -> list[Zone]:
    zones = [default] * TICKS
    for start, end, zone in blocks:
        for i in range(at(start), at(end)):
            zones[i] = zone
    return zones


TIMELINES: dict[str, list[Zone]] = {
    "all-low": _paint(),
    "all-medium": _paint(default=Zone.MEDIUM),
    "all-high": _paint(default=Zone.HIGH),
    "mixed": _paint(("10:00", "13:00", Zone.MEDIUM), ("15:30", "17:00", Zone.HIGH)),
    "late-high": _paint(
        ("06:00", "08:00", Zone.MEDIUM), ("08:00", "11:00", Zone.HIGH), ("15:00", "18:30", Zone.MEDIUM)
    ),
    "red-morning": _paint(("08:30", "09:30", Zone.RED), default=Zone.MEDIUM),
    "red-then-high": _paint(("06:00", "07:00", Zone.RED), ("07:00", "11:00", Zone.HIGH), ("16:00", "17:00", Zone.RED)),
    "all-red": _paint(default=Zone.RED),
}


def _validate(crew: CrewSpec, zones: list[Zone], local_date: date) -> tuple[ValidationResult, str]:
    timeline = _timeline(zones, local_date)
    plan = plan_crew(crew, timeline, rules_of(), local_date=local_date, tz=DUBAI)
    result = validate_plan(plan, timeline, crew, rules_of(), clauses_of(), published_shift=crew.shift)
    summary = "; ".join(f"{v.rule_id} {v.tick_ranges[:2]} {v.detail}" for v in result.violations)
    return result, summary


def _crew(
    workload: Workload,
    headcount: int,
    shift: tuple[ShiftBlock, ...],
    *,
    days: int = 6,
    members: tuple[CrewMember, ...] | None = None,
) -> CrewSpec:
    return CrewSpec(
        crew_id="crew-t",
        employer_id="emp-t",
        workload=workload,
        headcount=headcount,
        shift=shift,
        days_per_week=days,
        members=members,
    )


# ADR 0057 section 2: the four demo crews, all on L1.
DEMO_CREWS: dict[str, CrewSpec] = {
    "crew-a": _crew(
        "heavy",
        12,
        L1,
        members=(member(experienced=False, days_on_site=2),) * 2 + (EXPERIENCED,) * 10,
    ),
    "crew-b": _crew("heavy", 20, L1, members=(EXPERIENCED,) * 20),
    "crew-c": _crew(
        "moderate",
        9,
        L1,
        members=(member(days_away=10, away_reason="leave", days_on_site=1),) + (EXPERIENCED,) * 8,
    ),
    "crew-d": _crew("light", 4, L1, members=(EXPERIENCED,) * 4),
}


@st.composite
def _zone_sequences(draw: st.DrawFn) -> list[Zone]:
    """A day of zones from up to ten random runs (each 1-60 ticks), padded with Low."""
    runs = draw(st.lists(st.tuples(st.sampled_from(list(Zone)), st.integers(1, 60)), min_size=1, max_size=10))
    zones = [zone for zone, length in runs for _ in range(length)]
    return (zones + [Zone.LOW] * TICKS)[:TICKS]


@settings(max_examples=300, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    zones=_zone_sequences(),
    headcount=st.integers(1, 20),
    workload=st.sampled_from(WORKLOADS),
    shift_name=st.sampled_from(sorted(LEGAL_SHIFTS)),
    day_name=st.sampled_from(sorted(DATES)),
    days=st.sampled_from([5, 6]),
)
def test_rule_plans_always_pass_property(
    zones: list[Zone], headcount: int, workload: Workload, shift_name: str, day_name: str, days: int
) -> None:
    crew = _crew(workload, headcount, LEGAL_SHIFTS[shift_name], days=days)
    result, summary = _validate(crew, zones, DATES[day_name])
    assert result.passed, f"{shift_name} {day_name} {workload} headcount={headcount} days={days}: {summary}"


@pytest.mark.parametrize("headcount", range(1, 21))
@pytest.mark.parametrize("shift_name", sorted(LEGAL_SHIFTS))
def test_headcounts_one_to_twenty_validate_clean(headcount: int, shift_name: str) -> None:
    failures: list[str] = []
    for (timeline, zones), workload, (day_name, local_date) in product(TIMELINES.items(), WORKLOADS, DATES.items()):
        crew = _crew(workload, headcount, LEGAL_SHIFTS[shift_name])
        result, summary = _validate(crew, zones, local_date)
        if not result.passed:
            failures.append(f"{timeline} {day_name} {workload}: {summary}")
    assert not failures, "\n".join(failures)


@pytest.mark.parametrize("day_name", sorted(DATES))
@pytest.mark.parametrize("timeline", sorted(TIMELINES))
@pytest.mark.parametrize("crew_name", sorted(DEMO_CREWS))
def test_demo_crews_validate_clean(crew_name: str, timeline: str, day_name: str) -> None:
    result, summary = _validate(DEMO_CREWS[crew_name], TIMELINES[timeline], DATES[day_name])
    assert result.passed, summary


@pytest.mark.parametrize("days", [5, 6])
@pytest.mark.parametrize("crew_name", sorted(DEMO_CREWS))
def test_demo_crews_on_the_evening_variant_validate_clean(crew_name: str, days: int) -> None:
    base = DEMO_CREWS[crew_name]
    crew = _crew(base.workload, base.headcount, L1_EVENING, days=days, members=base.members)
    failures = []
    for timeline, zones in TIMELINES.items():
        result, summary = _validate(crew, zones, SUMMER)
        if not result.passed:
            failures.append(f"{timeline}: {summary}")
    assert not failures, "\n".join(failures)


def test_the_agreement_is_not_vacuous_the_planner_plans_real_work_and_declares_restrictions() -> None:
    timeline = _timeline(TIMELINES["all-medium"], SUMMER)
    plan_a = plan_crew(DEMO_CREWS["crew-a"], timeline, rules_of(), local_date=SUMMER, tz=DUBAI)
    assert 0 < plan_a.work_minutes < 8 * 60
    assert {"P-H8.ramp", "P-H8.heavy7", "P-H7.unacclimatised"} <= set(plan_a.restrictions)
    assert plan_a.restricted_headcount >= 2
    plan_c = plan_crew(DEMO_CREWS["crew-c"], timeline, rules_of(), local_date=SUMMER, tz=DUBAI)
    assert "P-H8.ramp" in plan_c.restrictions
    assert plan_c.restricted_headcount >= 1


def test_the_validator_rejects_a_naive_plan_on_the_same_timeline() -> None:
    """Work every shift minute outside the ban (the naive baseline of ADR 0011 section 9) is never valid in heat."""
    timeline = _timeline(TIMELINES["all-high"], SUMMER)
    crew = DEMO_CREWS["crew-b"]
    plan = plan_crew(crew, timeline, rules_of(), local_date=SUMMER, tz=DUBAI)
    naive = dataclasses.replace(
        plan,
        states=tuple(
            TickState.WORK if any(b.start <= _wall(i) < b.end for b in crew.shift) else TickState.OFF
            for i in range(TICKS)
        ),
    )
    result = validate_plan(naive, timeline, crew, rules_of(), clauses_of(), published_shift=crew.shift)
    assert {"P-H7.cap60", "P-H7.run"} <= {v.rule_id for v in result.violations}


def _wall(tick: int) -> time:
    minute = 240 + 5 * tick
    return time(minute // 60, minute % 60)


@st.composite
def _members(draw: st.DrawFn) -> CrewMember:
    """A random member (leave of 1-3 days included: R-Y, the lt4 row is a full share, not a returning member)."""
    reason = draw(st.sampled_from(["none", "leave", "illness"]))
    away = 0 if reason == "none" else draw(st.integers(1, 30))
    return CrewMember(
        days_on_site=draw(st.integers(1, 12)),
        days_away=away,
        away_reason=reason,  # type: ignore[arg-type]
        experienced=draw(st.booleans()),
        juvenile=False,  # a juvenile makes L1 itself illegal (starts before 07:00): a shift finding, not a planner one
    )


@settings(max_examples=300, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    zones=_zone_sequences(),
    crew_members=st.lists(_members(), min_size=1, max_size=14).map(tuple),
    workload=st.sampled_from(WORKLOADS),
    shift_name=st.sampled_from(sorted(LEGAL_SHIFTS)),
    day_name=st.sampled_from(sorted(DATES)),
)
def test_rule_plans_with_members_always_pass_property(
    zones: list[Zone], crew_members: tuple[CrewMember, ...], workload: Workload, shift_name: str, day_name: str
) -> None:
    crew = _crew(workload, len(crew_members), LEGAL_SHIFTS[shift_name], members=crew_members)
    result, summary = _validate(crew, zones, DATES[day_name])
    assert result.passed, f"{shift_name} {day_name} {workload} members={crew_members}: {summary}"


def test_experienced_member_back_after_two_days_of_leave_on_heavy_work_needs_no_heavy7() -> None:
    """R-Y: the lt4 row is a 100 percent share, so a member back after 1-3 days of leave is not restricted."""
    returning = member(days_on_site=1, days_away=2, away_reason="leave", experienced=True)
    crew = _crew("heavy", 2, L1, members=(returning, returning))
    result, summary = _validate(crew, TIMELINES["all-medium"], SUMMER)
    assert result.passed, summary


def test_rest_after_a_high_run_is_not_shortened_when_the_zone_eases() -> None:
    """R-AA: the planner and the validator both owe the longer of the two cycle rests."""
    zones = [Zone.MEDIUM] * TICKS
    zones[54:57] = [Zone.HIGH] * 3
    result, summary = _validate(_crew("heavy", 2, L1, days=5), zones, SUMMER)
    assert result.passed, summary
