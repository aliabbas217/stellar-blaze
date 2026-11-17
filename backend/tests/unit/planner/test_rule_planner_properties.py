from datetime import date

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from stellar_blaze.domain.planner.rule_planner import plan_crew
from stellar_blaze.domain.plans.model import CrewPlan, ShiftBlock, TickState
from stellar_blaze.domain.risk.levels import Zone
from tests.unit.planner.support import (
    B0,
    EVENING_SHIFTED,
    JULY,
    L1,
    OCTOBER,
    TICKS,
    TZ,
    all_violations,
    attendance,
    crew,
    rules,
    run_violations,
    timeline,
    window_violations,
)

pytestmark = pytest.mark.unit

_SETTINGS = settings(max_examples=60, deadline=None, suppress_health_check=[HealthCheck.too_slow])

_segments = st.lists(st.tuples(st.sampled_from(list(Zone)), st.integers(1, 40)), min_size=1, max_size=8)
_shifts = st.sampled_from([L1, EVENING_SHIFTED, B0])
_days = st.sampled_from([JULY, OCTOBER])
_workloads = st.sampled_from(["light", "moderate", "heavy"])


def _expand(segments: list[tuple[Zone, int]]) -> list[Zone]:
    out: list[Zone] = []
    for zone, length in segments:
        out.extend([zone] * length)
    out = out[:TICKS]
    return out + [out[-1]] * (TICKS - len(out))


def _plan(
    segments: list[tuple[Zone, int]], shift: tuple[ShiftBlock, ...], day: date, workload: str
) -> tuple[list[Zone], CrewPlan]:
    zones = _expand(segments)
    return zones, plan_crew(crew(shift, workload=workload), timeline(day, zones), rules(), local_date=day, tz=TZ)


@_SETTINGS
@given(segments=_segments, shift=_shifts, day=_days, workload=_workloads)
def test_no_added_minutes_property(
    segments: list[tuple[Zone, int]], shift: tuple[ShiftBlock, ...], day: date, workload: str
) -> None:
    _, plan = _plan(segments, shift, day, workload)
    att = attendance(shift, day)
    for i, state in enumerate(plan.states):
        if not att[i]:
            assert state in (TickState.OFF, TickState.BAN)  # nothing outside the shift or inside the ban
    assert plan.work_minutes <= 5 * sum(att)
    assert len(plan.states) == TICKS


@_SETTINGS
@given(segments=_segments, shift=_shifts, day=_days, workload=_workloads)
def test_rolling_cap_property(
    segments: list[tuple[Zone, int]], shift: tuple[ShiftBlock, ...], day: date, workload: str
) -> None:
    zones, plan = _plan(segments, shift, day, workload)
    assert window_violations(plan, zones, shift, day, workload) == []


@_SETTINGS
@given(segments=_segments, shift=_shifts, day=_days, workload=_workloads)
def test_run_length_property(
    segments: list[tuple[Zone, int]], shift: tuple[ShiftBlock, ...], day: date, workload: str
) -> None:
    zones, plan = _plan(segments, shift, day, workload)
    assert run_violations(plan, zones, workload) == []


@_SETTINGS
@given(segments=_segments, shift=_shifts, day=_days, workload=_workloads)
def test_every_rule_holds_property(
    segments: list[tuple[Zone, int]], shift: tuple[ShiftBlock, ...], day: date, workload: str
) -> None:
    """Caps, run lengths, whole rests, Art. 18, Red = stop, and a stop in every Red attendance tick."""
    zones, plan = _plan(segments, shift, day, workload)
    assert all_violations(plan, zones, shift, day, workload) == []
    att = attendance(shift, day)
    for i, state in enumerate(plan.states):
        if att[i] and zones[i] is Zone.RED:
            assert state in (TickState.STOPPED, TickState.ART18_BREAK)
        if state is TickState.WORK:
            assert zones[i] is not Zone.RED


@_SETTINGS
@given(segments=_segments, shift=_shifts, day=_days, workload=_workloads)
def test_deterministic(
    segments: list[tuple[Zone, int]], shift: tuple[ShiftBlock, ...], day: date, workload: str
) -> None:
    _, first = _plan(segments, shift, day, workload)
    _, second = _plan(segments, shift, day, workload)
    assert first == second


@_SETTINGS
@given(segments=_segments, shift=_shifts, day=_days, workload=_workloads)
def test_milder_zones_never_add_work_property(
    segments: list[tuple[Zone, int]], shift: tuple[ShiftBlock, ...], day: date, workload: str
) -> None:
    """Green is not permission to extend work: an all-Low day never works more than the attendance, and a plan on
    any zones never works more than the all-Low plan on the same shift."""
    _, plan = _plan(segments, shift, day, workload)
    low = plan_crew(crew(shift, workload=workload), timeline(day, [Zone.LOW] * TICKS), rules(), local_date=day, tz=TZ)
    assert plan.work_minutes <= low.work_minutes
