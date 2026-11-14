"""Test-side builders and an independent oracle for the rule planner.

The oracle recomputes the attendance ticks, the rolling 60-minute cap (ADR 0011 section 2: the most severe zone
touched in the window, Red excluded), the run lengths, the rests and the Art. 18 runs from the plan and the zone list
alone, with its own numbers (Dubai has no daylight saving: tick ``i`` is at ``04:00 + 5 min * i`` local). It uses
nothing from ``domain.planner`` and nothing from ``PlannerRules`` except through ``test_oracle_tables_match_rules``.
"""

from collections.abc import Sequence
from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from stellar_blaze.domain.plans.model import CrewMember, CrewPlan, CrewSpec, ShiftBlock, TickState, ZoneTimeline
from stellar_blaze.domain.plans.rules import PlannerRules, planner_rules
from stellar_blaze.domain.risk.levels import Zone
from tests.unit.risk.support import default_params, released_ruleset

TZ = ZoneInfo("Asia/Dubai")
JULY = date(2026, 7, 1)
OCTOBER = date(2026, 10, 1)
TICKS = 216
WINDOW = 12

L1 = (ShiftBlock(time(6, 0), time(11, 0)), ShiftBlock(time(15, 0), time(18, 0)))
EVENING_SHIFTED = (ShiftBlock(time(6, 0), time(11, 0)), ShiftBlock(time(15, 30), time(18, 30)))
B0 = (ShiftBlock(time(6, 0), time(12, 30)), ShiftBlock(time(15, 0), time(17, 0)))


def rules() -> PlannerRules:
    return planner_rules(released_ruleset(), default_params())


def idx(hhmm: str) -> int:
    """Tick index of a local ``HH:MM`` (the grid starts at 04:00)."""
    hours, minutes = hhmm.split(":")
    return (int(hours) * 60 + int(minutes) - 240) // 5


def hhmm(index: int) -> str:
    minutes = 240 + 5 * index
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def crew(
    shift: Sequence[ShiftBlock] = L1,
    *,
    workload: str = "heavy",
    headcount: int = 20,
    members: tuple[CrewMember, ...] | None = None,
) -> CrewSpec:
    assert workload in ("light", "moderate", "heavy")
    return CrewSpec(
        crew_id="crew-a",
        employer_id="emp-1",
        workload=workload,  # type: ignore[arg-type]
        headcount=headcount,
        shift=tuple(shift),
        days_per_week=6,
        members=members,
    )


def timeline(
    local_date: date,
    zones: Sequence[Zone | int],
    *,
    twl: Sequence[float] | None = None,
    fallback: Sequence[bool] | None = None,
    source: str = "forecast",
) -> ZoneTimeline:
    """A timeline starting at 04:00 Dubai = 00:00 UTC of ``local_date``."""
    start = datetime(local_date.year, local_date.month, local_date.day, tzinfo=UTC)
    return ZoneTimeline.from_zones(
        start,
        zones,
        protective_twl_w_m2=twl,
        fallback=fallback,
        source=source,  # type: ignore[arg-type]
    )


def zones_from(base: Zone, *changes: tuple[str, Zone]) -> list[Zone]:
    """``base`` all day, then each ``(HH:MM, zone)`` from that local time onward (in the order given)."""
    out = [base] * TICKS
    for at, zone in changes:
        for i in range(idx(at), TICKS):
            out[i] = zone
    return out


def spans(plan: CrewPlan, state: TickState) -> list[tuple[str, str]]:
    """The maximal runs of ``state`` as ``(start, end-exclusive)`` local ``HH:MM`` strings."""
    out: list[tuple[str, str]] = []
    start: int | None = None
    for i, s in enumerate((*plan.states, None)):
        if s is state and start is None:
            start = i
        elif s is not state and start is not None:
            out.append((hhmm(start), hhmm(i)))
            start = None
    return out


def block(plan: CrewPlan, start: str, end: str) -> set[TickState]:
    return set(plan.states[idx(start) : idx(end)])


# ---- the oracle ---------------------------------------------------------------------------------------------------


def in_season(local_date: date) -> bool:
    return (6, 15) <= (local_date.month, local_date.day) <= (9, 15)


def attendance(shift: Sequence[ShiftBlock], local_date: date) -> list[bool]:
    """Shift ticks that are not ban ticks (ban window 12:30-15:00 local, 15 Jun-15 Sep)."""
    out: list[bool] = []
    for i in range(TICKS):
        minute = 240 + 5 * i
        on_shift = any(b.start.hour * 60 + b.start.minute <= minute < b.end.hour * 60 + b.end.minute for b in shift)
        banned = in_season(local_date) and 750 <= minute < 900
        out.append(on_shift and not banned)
    return out


def cap_minutes(zone: Zone, workload: str) -> int:
    """ADOSH Table 1 caps of the released ruleset, written out (Low 60, Medium 60/45, High 45/20, Red 0)."""
    heavy = workload != "light"
    return {Zone.LOW: 60, Zone.MEDIUM: 45 if heavy else 60, Zone.HIGH: 20 if heavy else 45, Zone.RED: 0}[zone]


def run_limit_minutes(zone: Zone, workload: str) -> int | None:
    """Work length of the zone's cycle in minutes; ``None`` = self-paced."""
    heavy = workload != "light"
    if zone is Zone.HIGH:
        return 20 if heavy else 45
    if zone is Zone.MEDIUM and heavy:
        return 45
    return None


def rest_minutes(zone: Zone, workload: str) -> int:
    heavy = workload != "light"
    if zone is Zone.HIGH:
        return 40 if heavy else 15
    if zone is Zone.MEDIUM and heavy:
        return 15
    return 0


def window_violations(
    plan: CrewPlan, zones: Sequence[Zone], shift: Sequence[ShiftBlock], local_date: date, workload: str
) -> list[str]:
    """Every 12-tick window whose work exceeds the cap of the most severe non-Red attendance zone in it."""
    att = attendance(shift, local_date)
    bad: list[str] = []
    for s in range(TICKS - WINDOW + 1):
        touched = [zones[i] for i in range(s, s + WINDOW) if att[i] and zones[i] is not Zone.RED]
        if not touched:
            continue
        work = 5 * sum(plan.states[i] is TickState.WORK for i in range(s, s + WINDOW))
        cap = cap_minutes(max(touched), workload)
        if work > cap:
            bad.append(f"window {hhmm(s)}: work {work} > cap {cap} (zone {max(touched).name})")
    return bad


def run_violations(plan: CrewPlan, zones: Sequence[Zone], workload: str) -> list[str]:
    """Every WORK tick whose run so far exceeds the work length of its own zone's cycle."""
    bad: list[str] = []
    run = 0
    for i, state in enumerate(plan.states):
        run = run + 5 if state is TickState.WORK else 0
        limit = run_limit_minutes(zones[i], workload)
        if state is TickState.WORK and limit is not None and run > limit:
            bad.append(f"{hhmm(i)}: run {run} > {limit}")
    return bad


def rest_violations(plan: CrewPlan, zones: Sequence[Zone], workload: str) -> list[str]:
    """After a work run ends at tick ``e`` the next non-work ticks must cover the milder of the cycle rests of the
    last work tick's zone and ``zones[e]`` (the planner uses one of the two; it never uses less)."""
    bad: list[str] = []
    states = plan.states
    for e in range(1, TICKS):
        if states[e] is TickState.WORK or states[e - 1] is not TickState.WORK:
            continue
        need = min(rest_minutes(zones[e - 1], workload), rest_minutes(zones[e], workload)) // 5
        end = min(e + need, TICKS)
        if any(states[j] is TickState.WORK for j in range(e, end)):
            bad.append(f"run ending at {hhmm(e)}: work again before {need} rest ticks passed")
    return bad


def art18_violations(plan: CrewPlan, shift: Sequence[ShiftBlock], local_date: date) -> list[str]:
    """Attendance runs (split only by non-ban OFF gaps of >= 60 min) hold at most 5 h of non-break attendance, and
    every ART18_BREAK is a block of 12 consecutive attendance ticks."""
    att = attendance(shift, local_date)
    season = in_season(local_date)
    bad: list[str] = []
    # break blocks
    i = 0
    while i < TICKS:
        if plan.states[i] is TickState.ART18_BREAK:
            j = i
            while j < TICKS and plan.states[j] is TickState.ART18_BREAK:
                j += 1
            if (j - i) % 12 != 0 or not all(att[k] for k in range(i, j)):
                bad.append(f"break block {hhmm(i)}-{hhmm(j)} is not whole 60-minute attendance blocks")
            i = j
        else:
            i += 1
    # attendance runs
    count = 0
    brk = 0
    gap = 0
    for i in range(TICKS):
        banned_window = season and 750 <= 240 + 5 * i < 900
        if att[i]:
            gap = 0
            if plan.states[i] is TickState.ART18_BREAK:
                brk += 1
                if brk == 12:
                    count, brk = 0, 0
            else:
                brk = 0
                count += 1
                if count > 60:
                    bad.append(f"{hhmm(i)}: more than 5 h of attendance without a 60-minute break")
        elif banned_window:
            gap = 0
        else:
            gap += 1
            if gap >= 12:
                count, brk = 0, 0
    return bad


def all_violations(
    plan: CrewPlan, zones: Sequence[Zone], shift: Sequence[ShiftBlock], local_date: date, workload: str
) -> list[str]:
    return [
        *window_violations(plan, zones, shift, local_date, workload),
        *run_violations(plan, zones, workload),
        *rest_violations(plan, zones, workload),
        *art18_violations(plan, shift, local_date),
    ]
