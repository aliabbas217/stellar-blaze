"""Builders shared by the validator tests: ticks by wall time, hand-built plans, zone timelines, crews and rules.

Everything here is independent of the planner: a plan is a list of states that a test writes down by hand.
"""

import dataclasses
from collections.abc import Mapping
from datetime import UTC, date, datetime, time
from typing import Literal
from zoneinfo import ZoneInfo

from stellar_blaze.domain.plans.model import (
    CrewMember,
    CrewPlan,
    CrewSpec,
    ShiftBlock,
    TickState,
    Workload,
    ZoneTimeline,
)
from stellar_blaze.domain.plans.rules import PlannerRules, planner_rules
from stellar_blaze.domain.risk.levels import Zone
from stellar_blaze.domain.rules.ruleset import ClauseRef
from stellar_blaze.domain.validator.validator import ValidationResult, Violation, validate_plan
from tests.unit.risk.support import default_params, released_ruleset

TICKS = 216
SUMMER = date(2026, 7, 1)  # inside the ban season 15 Jun to 15 Sep
WINTER = date(2026, 11, 15)  # outside it
START_UTC = datetime(2026, 7, 1, 0, 0, tzinfo=UTC)  # 04:00 Asia/Dubai, the first tick

L1 = (ShiftBlock(time(6, 0), time(11, 0)), ShiftBlock(time(15, 0), time(18, 0)))
L1_EVENING = (ShiftBlock(time(6, 0), time(11, 0)), ShiftBlock(time(15, 30), time(18, 30)))
B0 = (ShiftBlock(time(6, 0), time(12, 30)), ShiftBlock(time(15, 0), time(17, 0)))

EXPERIENCED = CrewMember(days_on_site=30, days_away=0, away_reason="none", experienced=True, juvenile=False)


def day_start(local_date: date) -> datetime:
    """04:00 Asia/Dubai of ``local_date`` as UTC (00:00 UTC)."""
    return datetime.combine(local_date, time(0, 0), tzinfo=UTC)


def in_ban_season(local_date: date) -> bool:
    return "06-15" <= f"{local_date.month:02d}-{local_date.day:02d}" <= "09-15"


def shift_plan(
    *blocks: tuple[str, str, TickState],
    shift: tuple[ShiftBlock, ...] = L1,
    local_date: date = WINTER,
    inside: TickState = TickState.STOPPED,
) -> tuple[TickState, ...]:
    """A plan consistent with ``shift``: ``OFF`` outside it, ``BAN`` in the ban window (in season), ``inside`` else.

    The blocks are painted on top, so a test changes only what it means to break.
    """
    out = [TickState.OFF] * TICKS
    for i in range(TICKS):
        minute = 240 + 5 * i
        if any(b.start.hour * 60 + b.start.minute <= minute < b.end.hour * 60 + b.end.minute for b in shift):
            banned = in_ban_season(local_date) and 12 * 60 + 30 <= minute < 15 * 60
            out[i] = TickState.BAN if banned else inside
    for start, end, state in blocks:
        for i in range(at(start), at(end)):
            out[i] = state
    return tuple(out)


def at(hhmm: str) -> int:
    """The tick index that starts at local ``hh:mm`` (the grid starts at 04:00)."""
    hours, minutes = (int(part) for part in hhmm.split(":"))
    total = hours * 60 + minutes
    assert total % 5 == 0, hhmm
    assert 240 <= total <= 22 * 60, hhmm
    return (total - 240) // 5


def states(*blocks: tuple[str, str, TickState], default: TickState = TickState.OFF) -> tuple[TickState, ...]:
    """A day of states: ``default`` everywhere, then each ``(start, end, state)`` block painted in order."""
    out = [default] * TICKS
    for start, end, state in blocks:
        for i in range(at(start), at(end)):
            out[i] = state
    return tuple(out)


def by_tick(*blocks: tuple[int, int, TickState], default: TickState = TickState.OFF) -> tuple[TickState, ...]:
    """Like ``states`` but with tick indices ``[start, end)``."""
    out = [default] * TICKS
    for start, end, state in blocks:
        for i in range(start, end):
            out[i] = state
    return tuple(out)


def plan_of(
    tick_states: tuple[TickState, ...],
    *,
    local_date: date = SUMMER,
    restrictions: tuple[str, ...] = (),
    restricted_headcount: int = 0,
    start_utc: datetime = START_UTC,
) -> CrewPlan:
    """A hand-built plan around ``tick_states`` with consistent minute counters and nothing declared."""

    def minutes(state: TickState) -> int:
        return 5 * sum(1 for s in tick_states if s is state)

    return CrewPlan(
        crew_id="crew-t",
        local_date=local_date,
        start_utc=start_utc,
        states=tick_states,
        rule_ids=(),
        status="rule",
        restricted_headcount=restricted_headcount,
        restrictions=restrictions,
        work_minutes=minutes(TickState.WORK),
        adosh_rest_minutes=minutes(TickState.ADOSH_REST),
        art18_minutes=minutes(TickState.ART18_BREAK),
        stopped_minutes=minutes(TickState.STOPPED),
    )


def zones_of(*blocks: tuple[str, str, Zone], default: Zone = Zone.LOW) -> ZoneTimeline:
    """A zone timeline: ``default`` everywhere, then each ``(start, end, zone)`` block painted in order."""
    out = [default] * TICKS
    for start, end, zone in blocks:
        for i in range(at(start), at(end)):
            out[i] = zone
    return ZoneTimeline.from_zones(START_UTC, out)


def zones_by_tick(*blocks: tuple[int, int, Zone], default: Zone = Zone.LOW) -> ZoneTimeline:
    """Like ``zones_of`` but with tick indices ``[start, end)``."""
    out = [default] * TICKS
    for start, end, zone in blocks:
        for i in range(start, end):
            out[i] = zone
    return ZoneTimeline.from_zones(START_UTC, out)


def uniform(zone: Zone) -> ZoneTimeline:
    return ZoneTimeline.from_zones(START_UTC, [zone] * TICKS)


def crew_of(
    *,
    workload: Workload = "heavy",
    headcount: int | None = None,
    shift: tuple[ShiftBlock, ...] = L1,
    days_per_week: int = 6,
    members: tuple[CrewMember, ...] | None = None,
) -> CrewSpec:
    """A crew; the headcount is the member count when members are listed, else 20."""
    if headcount is None:
        headcount = 20 if members is None else len(members)
    return CrewSpec(
        crew_id="crew-t",
        employer_id="emp-t",
        workload=workload,
        headcount=headcount,
        shift=shift,
        days_per_week=days_per_week,
        members=members,
    )


def member(
    *,
    days_on_site: int = 30,
    days_away: int = 0,
    away_reason: Literal["leave", "illness", "none"] = "none",
    experienced: bool = True,
    juvenile: bool = False,
) -> CrewMember:
    return CrewMember(
        days_on_site=days_on_site,
        days_away=days_away,
        away_reason=away_reason,
        experienced=experienced,
        juvenile=juvenile,
    )


def rules_of(**params: int) -> PlannerRules:
    """The released ruleset's rules; keyword arguments override effective tunables (``low_zone_voluntary_rest_min``)."""
    return planner_rules(released_ruleset(), dataclasses.replace(default_params(), **params))


def clauses_of() -> Mapping[str, ClauseRef]:
    clauses = released_ruleset().clauses
    assert clauses is not None
    return clauses.entries


def with_labour(rules: PlannerRules, **changes: object) -> PlannerRules:
    """``rules`` with some labour values replaced (for the two Art. 18 switches and similar)."""
    return dataclasses.replace(rules, labour=rules.labour.model_copy(update=changes))


def run_validator(
    plan: CrewPlan,
    zones: ZoneTimeline,
    crew: CrewSpec | None = None,
    *,
    rules: PlannerRules | None = None,
    published_shift: tuple[ShiftBlock, ...] | None = None,
    tz: ZoneInfo | None = None,
) -> ValidationResult:
    """Validate with the clock of the plan's date: a default-clock plan or timeline is moved to ``local_date`` 04:00."""
    start = day_start(plan.local_date)
    if plan.start_utc == START_UTC:
        plan = dataclasses.replace(plan, start_utc=start)
    if zones.start_utc == START_UTC:
        zones = dataclasses.replace(zones, start_utc=start)
    return validate_plan(
        plan,
        zones,
        crew if crew is not None else crew_of(),
        rules if rules is not None else rules_of(),
        clauses_of(),
        published_shift=published_shift,
        tz=tz,
    )


def ids(result: ValidationResult) -> set[str]:
    return {v.rule_id for v in result.violations}


def only(result: ValidationResult, rule_id: str) -> Violation:
    """The single violation of ``rule_id``; fails with the whole result when there are none or several."""
    found = [v for v in result.violations if v.rule_id == rule_id]
    assert len(found) == 1, (rule_id, result.violations)
    return found[0]


def clause_of(rule_id: str) -> str:
    return clauses_of()[rule_id].clause


def first(result: ValidationResult, rule_id: str) -> Violation:
    """The first violation of ``rule_id`` (a rule can fire for more than one reason); fails when there is none."""
    found = [v for v in result.violations if v.rule_id == rule_id]
    assert found, (rule_id, result.violations)
    return found[0]
