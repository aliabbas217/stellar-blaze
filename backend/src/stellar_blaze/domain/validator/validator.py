"""The independent plan validator: checks any crew day plan against the hard rules, tick by tick (ADR 0011 section 3).

It shares nothing with the rule planner except the plan types, ``PlannerRules`` (the ruleset-derived zone caps, cycles
and labour values) and the zone timeline. The rolling 60-minute window, the run and rest logic, the Art. 18 runs and
the people rules are implemented here from the definitions, so that a bug in the planner cannot hide a bug in this
module. A plan with any violation is never shown as valid; every ``Violation`` has an ``origin``: ``"shift"`` when the
published shift itself breaks the rule (the caller answers 422) and ``"plan"`` for everything else (a planner bug, 500).

Ticks are the 216 five-minute ticks from 04:00 local (``domain.plans.ticks``): the local wall time of tick ``i`` is
``04:00 + 5 min * i`` (the demo site has no daylight-saving change, so the validator needs no time zone). A violation's
``tick_ranges`` are half-open ``(start, end)`` tick-index ranges, merged where they touch.

Definitions (the controller's task-6 definitions, settled once for planner and validator):

* Attendance ticks ``A``: the state is neither ``OFF`` nor ``BAN``.
* ``P-H7.cap60``: for every window of 12 consecutive ticks, ``M`` is the most severe zone among the window's ``A`` ticks
  that are not ``RED``; work minutes in the window must not exceed ``cap_minutes(M, workload)``. No such tick: no cap.
* ``P-H7.run``: per ``WORK`` tick, the minutes of the continuous work run so far must not exceed the work length of the
  cycle of that tick's zone; after a run the rest owed (R-AA) is the longer of the rest of the cycle of the zone of the
  run's last work tick and, when the tick that ended the run is an attendance tick (``ADOSH_REST``, ``STOPPED``,
  ``ART18_BREAK``), the rest of the cycle of that tick's zone. Every non-work tick counts down the rest.
* ``P-H3``: attendance runs are split by credited breaks (a block of ``art18_break_h`` of ``ART18_BREAK`` or ``OFF``
  ticks outside the ban window; ban ticks and ADOSH rest only when the ruleset's switches say so); a run of more than
  ``art18_max_run_h`` of ``A`` ticks is a violation.
* People rules are declared restrictions: ``CrewPlan.restrictions`` and ``restricted_headcount`` must cover the members
  that the ruleset's tables restrict.
"""

import math
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, replace
from datetime import date, time, timedelta
from typing import Final, Literal
from zoneinfo import ZoneInfo

from stellar_blaze.domain.plans.model import CrewMember, CrewPlan, CrewSpec, ShiftBlock, TickState, ZoneTimeline
from stellar_blaze.domain.plans.rules import PlannerRules
from stellar_blaze.domain.plans.ticks import TICK_MINUTES
from stellar_blaze.domain.risk.levels import Zone
from stellar_blaze.domain.rules.ruleset import ClauseRef

type TickRanges = tuple[tuple[int, int], ...]

type Origin = Literal["shift", "plan"]

SHIFT_RULES: Final[frozenset[str]] = frozenset({"P-H2.daily", "P-H2.weekly", "P-H5.hours", "P-H5.run", "P-H5.window"})
"""The rule ids whose violation has origin ``"shift"`` when it comes from the published shift (hours and juvenile
checks). It is documentation only: the partition uses ``Violation.origin``, because a rule id can have both origins
(a missing juvenile ban-season declaration is ``P-H5.ban_season``, always origin ``"plan"``, so it is not listed)."""

_DAY_TICKS: Final = 216  # the 04:00-22:00 grid of domain.plans.ticks (a test pins the equality)
_DAY_START_MINUTE: Final = 4 * 60
_DAY_END_MINUTE: Final = 22 * 60
_DEFAULT_TZ: Final = ZoneInfo("Asia/Dubai")
_WINDOW_TICKS: Final = 12  # 60 minutes
_ATTENDANCE: Final = frozenset({TickState.WORK, TickState.ADOSH_REST, TickState.STOPPED})
_HOT: Final = frozenset({Zone.MEDIUM, Zone.HIGH})


class MissingClauseError(LookupError):
    """A rule id the validator evaluates has no entry in the clause mapping (a ruleset or wiring bug)."""


@dataclass(frozen=True)
class Violation:
    """One broken rule: its id, the ruleset clause and source that back it, the offending ticks and a human detail."""

    rule_id: str
    clause: str
    source_id: str
    tick_ranges: TickRanges
    detail: str
    origin: Origin
    """``"shift"``: the published shift itself breaks the rule (422); ``"plan"``: the plan is wrong (500)."""


@dataclass(frozen=True)
class ValidationResult:
    """Every violation found and every rule evaluated (including those that passed)."""

    violations: tuple[Violation, ...]
    checked_rules: tuple[str, ...]

    @property
    def passed(self) -> bool:
        return not self.violations

    @property
    def shift_violations(self) -> tuple[Violation, ...]:
        """Violations whose origin is the published shift."""
        return tuple(v for v in self.violations if v.origin == "shift")

    @property
    def plan_violations(self) -> tuple[Violation, ...]:
        """Every other violation: the plan, not the shift, is wrong."""
        return tuple(v for v in self.violations if v.origin == "plan")


@dataclass(frozen=True)
class _Finding:
    rule_id: str
    ranges: TickRanges
    detail: str
    origin: Origin = "plan"


@dataclass(frozen=True)
class _Day:
    """What every check reads: the plan's states, the zones, the ban mask and the crew and rules."""

    plan: CrewPlan
    states: tuple[TickState, ...]
    zones: tuple[Zone, ...]
    ban: tuple[bool, ...]
    wall: tuple[int, ...]
    """The local wall-clock minute of the day at the start of each tick (timeline clock and zone)."""
    in_ban_season: bool
    crew: CrewSpec
    rules: PlannerRules

    @property
    def attendance(self) -> tuple[bool, ...]:
        return tuple(s is not TickState.OFF and s is not TickState.BAN for s in self.states)


def _label(day: _Day, tick: int) -> str:
    minute = day.wall[tick]
    return f"{minute // 60:02d}:{minute % 60:02d}"


def _minutes_of(wall: time) -> int:
    return wall.hour * 60 + wall.minute


def _ranges(ticks: Iterable[int]) -> TickRanges:
    out: list[tuple[int, int]] = []
    for tick in sorted(set(ticks)):
        if out and out[-1][1] == tick:
            out[-1] = (out[-1][0], tick + 1)
        else:
            out.append((tick, tick + 1))
    return tuple(out)


def _in_season(local_date: date, season: tuple[str, str]) -> bool:
    return season[0] <= f"{local_date.month:02d}-{local_date.day:02d}" <= season[1]


def _work_ticks(day: _Day, *, zones: frozenset[Zone] | None = None) -> list[int]:
    return [
        i for i, state in enumerate(day.states) if state is TickState.WORK and (zones is None or day.zones[i] in zones)
    ]


# ------------------------------------------------------------------------------------------------- the checks


def _p_h1(day: _Day) -> list[_Finding]:
    ticks = [i for i in _work_ticks(day) if day.ban[i]]
    if not ticks:
        return []
    return [
        _Finding(
            "P-H1", _ranges(ticks), f"work in the midday ban window from {_label(day, ticks[0])} ({len(ticks)} ticks)"
        )
    ]


def _cap60(day: _Day) -> list[_Finding]:
    attendance = day.attendance
    bad_ticks: set[int] = set()
    first: str | None = None
    windows = 0
    for start in range(_DAY_TICKS - _WINDOW_TICKS + 1):
        window = range(start, start + _WINDOW_TICKS)
        touched = [day.zones[i] for i in window if attendance[i] and day.zones[i] is not Zone.RED]
        if not touched:
            continue
        worst = max(touched)
        work = TICK_MINUTES * sum(1 for i in window if day.states[i] is TickState.WORK)
        cap = day.rules.cap_minutes(worst, day.crew.workload)
        if work > cap:
            windows += 1
            bad_ticks.update(window)
            if first is None:
                first = (
                    f"{work} min of work in the 60 minutes from {_label(day, start)}, over the {cap} min cap of the "
                    f"most severe zone touched ({worst.name})"
                )
    if first is None:
        return []
    return [_Finding("P-H7.cap60", _ranges(bad_ticks), f"{first}; {windows} window(s) over the cap")]


def _run(day: _Day) -> list[_Finding]:
    too_long: list[int] = []
    too_soon: list[int] = []
    run_ticks = 0
    rest_until = 0
    for i, state in enumerate(day.states):
        if state is TickState.WORK:
            run_ticks += 1
            cycle = day.rules.cycle(day.zones[i], day.crew.workload)
            if cycle is not None and run_ticks * TICK_MINUTES > cycle[0]:
                too_long.append(i)
            if i < rest_until:
                too_soon.append(i)
            continue
        if run_ticks:
            # R-AA: the longer of (a) the rest of the cycle of the zone of the run's last work tick and (b) the rest of
            # the cycle of the zone of the tick that ended the run, when that is an attendance tick (never OFF/BAN).
            ending_zones = [day.zones[i - 1]]
            if state in _ATTENDANCE or state is TickState.ART18_BREAK:
                ending_zones.append(day.zones[i])
            for zone in ending_zones:
                cycle = day.rules.cycle(zone, day.crew.workload)
                if cycle is not None:
                    rest_until = max(rest_until, i + math.ceil(cycle[1] / TICK_MINUTES))
        run_ticks = 0
    out: list[_Finding] = []
    if too_long:
        out.append(
            _Finding(
                "P-H7.run",
                _ranges(too_long),
                f"work run longer than the cycle's work length from {_label(day, too_long[0])} "
                f"({day.zones[too_long[0]].name}, {day.crew.workload})",
            )
        )
    if too_soon:
        out.append(
            _Finding(
                "P-H7.run",
                _ranges(too_soon),
                f"work resumes at {_label(day, too_soon[0])} before the full cycle rest has passed",
            )
        )
    return out


def _stop_red(day: _Day) -> list[_Finding]:
    ticks = _work_ticks(day, zones=frozenset({Zone.RED}))
    if not ticks:
        return []
    return [_Finding("STOP.red", _ranges(ticks), f"work in a Red tick from {_label(day, ticks[0])}")]


def _available_acclimatised(day: _Day) -> int:
    """How many members can do Medium/High work: everyone when the crew lists none (all acclimatised adults)."""
    members = day.crew.members
    if members is None:
        return day.crew.headcount
    return sum(1 for m in members if _is_acclimatised(m, day.rules, in_ban_season=day.in_ban_season))


def _lone(day: _Day) -> list[_Finding]:
    """Medium/High work needs at least ``lone_work_min_headcount`` acclimatised members available (V1)."""
    minimum = day.rules.lone_work_min_headcount
    if _available_acclimatised(day) >= minimum:
        return []
    ticks = _work_ticks(day, zones=_HOT)
    if not ticks:
        return []
    return [
        _Finding(
            "P-H7.lone",
            _ranges(ticks),
            f"work in Medium/High from {_label(day, ticks[0])} with fewer than {minimum} acclimatised members "
            "available",
        )
    ]


def _has_away_period(member: CrewMember) -> bool:
    """An away period is on record: it feeds the re-acclimatisation table (the ``lt4`` row is a full share)."""
    return member.away_reason != "none" and member.days_away > 0


def _is_returning(member: CrewMember) -> bool:
    """Back from an away period whose re-acclimatisation band is not ``lt4`` (R-Y: that row is a 100 percent share)."""
    return _has_away_period(member) and _reacclimatisation_band(member) != "lt4"


def _reacclimatisation_band(member: CrewMember) -> str:
    """The days-away row of the acclimatisation table. Illness days map to the leave rows as ADR 0011 P-H8 states.

    The overlapping edge of "6-12" and "12-20" is read upward (12 days is in "12-20"): the protective reading.
    """
    days = member.days_away
    if member.away_reason == "illness":
        for limit, band in ((1, "lt4"), (4, "4-5"), (6, "6-12"), (9, "12-20")):
            if days < limit:
                return band
        return "gt20"
    for limit, band in ((4, "lt4"), (6, "4-5"), (12, "6-12"), (21, "12-20")):
        if days < limit:
            return band
    return "gt20"


def _ramp_key(ramp: Mapping[str, int], day: int) -> str:
    """The table key of ``day``, clamped to the table's last day (the ruleset validates the keys '1'..'n')."""
    return str(min(day, max(int(key) for key in ramp)))


def _ramp_share(member: CrewMember, rules: PlannerRules) -> int:
    """The share of the full assignment the member may do today (percent), from the acclimatisation tables."""
    table = rules.acclimatisation
    day = max(member.days_on_site, 1)
    shares: list[int] = []
    if _has_away_period(member):
        # A day beyond the band's last row is a full share.
        shares.append(table.reacclimatisation_pct.get(f"{_reacclimatisation_band(member)}.{day}", 100))
    if not _has_away_period(member) or not member.experienced:
        ramp = table.experienced_ramp_pct if member.experienced else table.new_ramp_pct
        shares.append(ramp[_ramp_key(ramp, day)])
    return min(shares)


def _is_acclimatised(member: CrewMember, rules: PlannerRules, *, in_ban_season: bool) -> bool:
    if member.juvenile and in_ban_season:
        return False  # juveniles are excluded from ban-season outdoor heat tasks (ADR 0011 s4, P-H5.ban_season)
    table = rules.acclimatisation
    if member.days_away > table.unacclimatised_after_days_away:
        return False
    if member.experienced:
        return True
    return table.new_ramp_pct[_ramp_key(table.new_ramp_pct, max(member.days_on_site, 1))] >= 100


def _unacclimatised_work(day: _Day) -> list[_Finding]:
    members = day.crew.members
    if members is None:
        return []
    if any(_is_acclimatised(m, day.rules, in_ban_season=day.in_ban_season) for m in members):
        return []
    ticks = _work_ticks(day, zones=_HOT)
    if not ticks:
        return []
    return [
        _Finding(
            "P-H7.unacclimatised",
            _ranges(ticks),
            f"work in Medium/High from {_label(day, ticks[0])} while the crew has no acclimatised member",
        )
    ]


def _credited_block_mask(day: _Day) -> list[bool]:
    """Ticks inside a credited Art. 18 break: a block of at least ``art18_break_h`` of credited ticks."""
    labour = day.rules.labour

    def credited(i: int) -> bool:
        match day.states[i]:
            case TickState.ART18_BREAK:
                return True
            case TickState.OFF:
                return not day.ban[i] or labour.art18_ban_gap_counts_as_break
            case TickState.BAN:
                return labour.art18_ban_gap_counts_as_break
            case TickState.ADOSH_REST:
                return labour.art18_adosh_rest_counts_as_break
            case _:
                return False

    needed = math.ceil(labour.art18_break_h * 60 / TICK_MINUTES)
    mask = [False] * _DAY_TICKS
    i = 0
    while i < _DAY_TICKS:
        if not credited(i):
            i += 1
            continue
        j = i
        while j < _DAY_TICKS and credited(j):
            j += 1
        if j - i >= needed:
            mask[i:j] = [True] * (j - i)
        i = j
    return mask


def _attendance_runs(day: _Day) -> list[list[int]]:
    """The attendance ticks of each run, in order; a credited break ends a run and belongs to neither side."""
    credited = _credited_block_mask(day)
    attendance = day.attendance
    runs: list[list[int]] = []
    current: list[int] = []
    for i in range(_DAY_TICKS):
        if credited[i]:
            if current:
                runs.append(current)
                current = []
        elif attendance[i]:
            current.append(i)
    if current:
        runs.append(current)
    return runs


def _long_runs(day: _Day, limit_hours: float) -> TickRanges:
    """The spans (first attendance tick to one past the last) of the runs longer than ``limit_hours``."""
    limit_minutes = limit_hours * 60
    return tuple((run[0], run[-1] + 1) for run in _attendance_runs(day) if len(run) * TICK_MINUTES > limit_minutes)


def _art18(day: _Day) -> list[_Finding]:
    limit = day.rules.labour.art18_max_run_h
    spans = _long_runs(day, limit)
    if not spans:
        return []
    return [
        _Finding(
            "P-H3",
            spans,
            f"attendance run from {_label(day, spans[0][0])} to {_label(day, spans[0][1])} is longer than {limit:g} h "
            "without a credited 1 h break",
        )
    ]


def _attendance_ticks(day: _Day) -> list[int]:
    return [i for i, s in enumerate(day.states) if s in _ATTENDANCE]


def _hours(day: _Day) -> list[_Finding]:
    labour = day.rules.labour
    ticks = _attendance_ticks(day)
    minutes = len(ticks) * TICK_MINUTES
    days = day.crew.days_per_week
    normal_day = labour.normal_hours_per_day * 60
    overtime_cap = (labour.normal_hours_per_day + labour.overtime_hours_per_day) * 60
    out: list[_Finding] = []
    if minutes > overtime_cap or (minutes > normal_day and days * 3 * minutes > labour.total_hours_per_3_weeks * 60):
        out.append(
            _Finding(
                "P-H2.daily",
                _ranges(ticks),
                f"{minutes / 60:.2f} h of attendance a day on a {days}-day week exceeds the daily hours limits "
                f"({labour.normal_hours_per_day:g} h normal, {overtime_cap / 60:g} h with overtime, "
                f"{labour.total_hours_per_3_weeks:g} h per 3 weeks)",
                "shift",
            )
        )
    if days * minutes > labour.normal_hours_per_week * 60:
        out.append(
            _Finding(
                "P-H2.weekly",
                _ranges(ticks),
                f"{days} days x {minutes / 60:.2f} h = {days * minutes / 60:.2f} h a week exceeds "
                f"{labour.normal_hours_per_week:g} h",
                "shift",
            )
        )
    return out


def _has_juvenile(crew: CrewSpec) -> bool:
    return crew.members is not None and any(m.juvenile for m in crew.members)


def _juvenile(day: _Day) -> list[_Finding]:
    labour = day.rules.labour
    start, end = (_minutes_of(t) for t in labour.juvenile_window)
    out: list[_Finding] = []
    outside = [i for i, a in enumerate(day.attendance) if a and not start <= day.wall[i] < end]
    if outside:
        out.append(
            _Finding(
                "P-H5.window",
                _ranges(outside),
                f"juvenile attendance outside {labour.juvenile_window[0]:%H:%M}-{labour.juvenile_window[1]:%H:%M} "
                f"from {_label(day, outside[0])}",
                "shift",
            )
        )
    ticks = _attendance_ticks(day)
    if len(ticks) * TICK_MINUTES > labour.juvenile_max_h * 60:
        out.append(
            _Finding(
                "P-H5.hours",
                _ranges(ticks),
                f"{len(ticks) * TICK_MINUTES / 60:.2f} h of juvenile attendance exceeds {labour.juvenile_max_h:g} h",
                "shift",
            )
        )
    spans = _long_runs(day, labour.juvenile_max_run_h)
    if spans:
        out.append(
            _Finding(
                "P-H5.run",
                spans,
                f"juvenile attendance run from {_label(day, spans[0][0])} is longer than "
                f"{labour.juvenile_max_run_h:g} h",
                "shift",
            )
        )
    return out


def _required_restrictions(crew: CrewSpec, rules: PlannerRules, *, in_ban_season: bool) -> dict[str, list[int]]:
    """The restriction ids that the members require (rule id to member indexes), in a fixed order."""
    required: dict[str, list[int]] = {
        "P-H8.ramp": [],
        "P-H8.heavy7": [],
        "P-H5.ban_season": [],
        "P-H7.unacclimatised": [],
    }
    heavy_days = rules.acclimatisation.heavy_work_after_days
    for index, m in enumerate(crew.members or ()):
        if _ramp_share(m, rules) < 100:
            required["P-H8.ramp"].append(index)
        if crew.workload == "heavy" and (not m.experienced or _is_returning(m)) and m.days_on_site < heavy_days:
            required["P-H8.heavy7"].append(index)
        if m.juvenile and in_ban_season:
            required["P-H5.ban_season"].append(index)
        elif not _is_acclimatised(m, rules, in_ban_season=in_ban_season):
            required["P-H7.unacclimatised"].append(index)
    return required


def _declarations(day: _Day) -> list[_Finding]:
    """People rules are declared restrictions: the plan must name the rules that restrict members, and how many."""
    required = _required_restrictions(day.crew, day.rules, in_ban_season=day.in_ban_season)
    flagged = {index for indexes in required.values() for index in indexes}
    needed = [rule_id for rule_id, indexes in required.items() if indexes]
    declared = set(day.plan.restrictions)
    all_work = _ranges(_work_ticks(day))
    hot_work = _ranges(_work_ticks(day, zones=_HOT))
    out: list[_Finding] = []
    for rule_id in needed:
        if rule_id not in declared:
            out.append(
                _Finding(
                    rule_id,
                    hot_work if rule_id == "P-H7.unacclimatised" else all_work,
                    f"the plan does not declare the restriction {rule_id} for some members",
                )
            )
    if needed and day.plan.restricted_headcount < len(flagged):
        out.append(
            _Finding(
                needed[0],
                all_work,
                "restricted_headcount is below the number of members that the required restrictions cover",
            )
        )
    return out


def _check_crew(crew: CrewSpec) -> None:
    if crew.members is not None and len(crew.members) != crew.headcount:
        raise ValueError(f"crew {crew.crew_id}: the member list and the headcount disagree")


def declare_restrictions(plan: CrewPlan, crew: CrewSpec, rules: PlannerRules) -> CrewPlan:
    """A copy of ``plan`` that declares the restrictions its crew's members require (for typed rosters, Task 10).

    Uses this module's own derivation of the required restriction ids and of how many members they cover, so that the
    declaration checks pass by construction while the whole-crew rules (no acclimatised member, lone work, Red, cap,
    run, Art. 18, ban, hours) still fire on the typed states.

    Raises:
        ValueError: ``crew.members`` and ``crew.headcount`` disagree.
    """
    _check_crew(crew)
    in_season = _in_season(plan.local_date, rules.labour.ban_season)
    required = _required_restrictions(crew, rules, in_ban_season=in_season)
    flagged = {index for indexes in required.values() for index in indexes}
    return replace(
        plan,
        restrictions=tuple(rule_id for rule_id, indexes in required.items() if indexes),
        restricted_headcount=len(flagged),
    )


def _in_shift(day: _Day, tick: int, shift: tuple[ShiftBlock, ...]) -> bool:
    minute = day.wall[tick]
    return any(_minutes_of(block.start) <= minute < _minutes_of(block.end) for block in shift)


def _check_shift_on_grid(shift: tuple[ShiftBlock, ...]) -> None:
    for block in shift:
        start, end = _minutes_of(block.start), _minutes_of(block.end)
        if not _DAY_START_MINUTE <= start < end <= _DAY_END_MINUTE:
            raise ValueError(f"the published shift block {block.start}-{block.end} is not within the 04:00-22:00 grid")


def _shift_consistency(day: _Day, shift: tuple[ShiftBlock, ...]) -> list[_Finding]:
    """P-H10 with a published shift: no added minutes and a plan that matches the shift tick for tick (V2)."""
    inside = [_in_shift(day, i, shift) for i in range(_DAY_TICKS)]
    states = day.states
    attendance = day.attendance
    outside_attendance = [i for i in range(_DAY_TICKS) if attendance[i] and not inside[i]]
    idle_in_shift = [i for i in range(_DAY_TICKS) if inside[i] and not day.ban[i] and states[i] is TickState.OFF]
    stray_ban = [i for i in range(_DAY_TICKS) if states[i] is TickState.BAN and (not day.ban[i] or not inside[i])]
    out: list[_Finding] = []
    if outside_attendance:
        out.append(
            _Finding(
                "P-H10",
                _ranges(outside_attendance),
                f"attendance outside the published shift from {_label(day, outside_attendance[0])}",
            )
        )
    if idle_in_shift:
        out.append(
            _Finding(
                "P-H10",
                _ranges(idle_in_shift),
                "tick inside the published shift is OFF (neither planned nor in the ban window) from "
                f"{_label(day, idle_in_shift[0])}",
            )
        )
    if stray_ban:
        out.append(
            _Finding(
                "P-H10",
                _ranges(stray_ban),
                f"BAN tick outside the ban window or the published shift from {_label(day, stray_ban[0])}",
            )
        )
    return out


# ------------------------------------------------------------------------------------------------- the entry point


def validate_plan(
    plan: CrewPlan,
    zones: ZoneTimeline,
    crew: CrewSpec,
    rules: PlannerRules,
    clauses: Mapping[str, ClauseRef],
    *,
    published_shift: tuple[ShiftBlock, ...] | None,
    tz: ZoneInfo | None = None,
) -> ValidationResult:
    """Check ``plan`` against every hard rule on ``zones`` for ``crew``; ``published_shift`` enables ``P-H10``.

    ``tz`` (default Asia/Dubai, the demo site) turns the timeline's clock into local wall time for the ban window, the
    juvenile window and the shift; the timeline must start at 04:00 local on the plan's date.

    Raises:
        ValueError: The plan or the timeline is not a 216-tick day, they start at different instants, the timeline
            does not start at 04:00 local on the plan's date in ``tz``, ``crew.members`` and ``crew.headcount``
            disagree, or a published shift block is outside the 04:00-22:00 grid.
        MissingClauseError: A rule id that is evaluated has no entry in ``clauses``.
    """
    if len(plan.states) != _DAY_TICKS or len(zones.zones) != _DAY_TICKS:
        raise ValueError(
            f"a plan and its zone timeline must both have {_DAY_TICKS} ticks, "
            f"got {len(plan.states)} and {len(zones.zones)}"
        )
    if plan.start_utc != zones.start_utc:
        raise ValueError(f"plan starts at {plan.start_utc} but its zone timeline starts at {zones.start_utc}")
    zone = tz if tz is not None else _DEFAULT_TZ
    first = zones.start_utc.astimezone(zone)
    if first.date() != plan.local_date or first.timetz().replace(tzinfo=None) != time(4, 0):
        raise ValueError(
            f"the zone timeline starts at {first.isoformat()} but must start at 04:00 local on {plan.local_date} "
            f"in {zone.key}"
        )
    _check_crew(crew)
    if published_shift is not None:
        _check_shift_on_grid(published_shift)
    labour = rules.labour
    in_season = _in_season(plan.local_date, labour.ban_season)
    ban_start, ban_end = (_minutes_of(t) for t in labour.ban_window)
    locals_ = [(zones.start_utc + timedelta(minutes=TICK_MINUTES * i)).astimezone(zone) for i in range(_DAY_TICKS)]
    wall = tuple(local.hour * 60 + local.minute for local in locals_)
    day = _Day(
        plan=plan,
        states=plan.states,
        zones=zones.zones,
        ban=tuple(in_season and ban_start <= wall[i] < ban_end for i in range(_DAY_TICKS)),
        wall=wall,
        in_ban_season=in_season,
        crew=crew,
        rules=rules,
    )

    groups: list[tuple[tuple[str, ...], Callable[[], list[_Finding]]]] = [
        (("P-H1",), lambda: _p_h1(day)),
        (("P-H7.cap60",), lambda: _cap60(day)),
        (("P-H7.run",), lambda: _run(day)),
        (("STOP.red",), lambda: _stop_red(day)),
        (("P-H7.lone",), lambda: _lone(day)),
        (("P-H7.unacclimatised",), lambda: _unacclimatised_work(day)),
        (("P-H3",), lambda: _art18(day)),
        (("P-H2.daily", "P-H2.weekly"), lambda: _hours(day)),
    ]
    if _has_juvenile(crew):
        # P-H5.ban_season is emitted by the declarations check below; it is listed here so that the clause is required
        # exactly when a juvenile is on the crew.
        groups.append((("P-H5.window", "P-H5.hours", "P-H5.run", "P-H5.ban_season"), lambda: _juvenile(day)))
    groups.append((("P-H8.ramp", "P-H8.heavy7"), lambda: _declarations(day)))
    if published_shift is not None:
        shift = published_shift
        groups.append((("P-H10",), lambda: _shift_consistency(day, shift)))

    checked = tuple(rule_id for rule_ids, _ in groups for rule_id in rule_ids)
    missing = [rule_id for rule_id in checked if rule_id not in clauses]
    if missing:
        raise MissingClauseError(f"clauses has no entry for the rule id(s) {missing}")

    violations = tuple(
        Violation(f.rule_id, clauses[f.rule_id].clause, clauses[f.rule_id].source, f.ranges, f.detail, f.origin)
        for _, check in groups
        for f in check()
    )
    return ValidationResult(violations=violations, checked_rules=checked)
