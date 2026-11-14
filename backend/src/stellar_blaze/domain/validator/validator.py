"""The independent plan validator: checks any crew day plan against the hard rules, tick by tick (ADR 0011 section 3).

It shares nothing with the rule planner except the plan types, ``PlannerRules`` (the ruleset-derived zone caps, cycles
and labour values) and the zone timeline. The rolling 60-minute window, the run and rest logic, the Art. 18 runs and
the people rules are implemented here from the definitions, so that a bug in the planner cannot hide a bug in this
module. A plan with any violation is never shown as valid; the caller turns a violation of a ``SHIFT_RULES`` rule into a
422 (the published shift itself is illegal) and any other violation into a 500 (a planner bug).

Ticks are the 216 five-minute ticks from 04:00 local (``domain.plans.ticks``): the local wall time of tick ``i`` is
``04:00 + 5 min * i`` (the demo site has no daylight-saving change, so the validator needs no time zone). A violation's
``tick_ranges`` are half-open ``(start, end)`` tick-index ranges, merged where they touch.

Definitions (the controller's task-6 definitions, settled once for planner and validator):

* Attendance ticks ``A``: the state is neither ``OFF`` nor ``BAN``.
* ``P-H7.cap60``: for every window of 12 consecutive ticks, ``M`` is the most severe zone among the window's ``A`` ticks
  that are not ``RED``; work minutes in the window must not exceed ``cap_minutes(M, workload)``. No such tick: no cap.
* ``P-H7.run``: per ``WORK`` tick, the minutes of the continuous work run so far must not exceed the work length of the
  cycle of that tick's zone; after a run the full rest of the cycle of the zone of the run's last work tick must pass
  (every non-work tick counts) before work resumes.
* ``P-H3``: attendance runs are split by credited breaks (a block of ``art18_break_h`` of ``ART18_BREAK`` or ``OFF``
  ticks outside the ban window; ban ticks and ADOSH rest only when the ruleset's switches say so); a run of more than
  ``art18_max_run_h`` of ``A`` ticks is a violation.
* People rules are declared restrictions: ``CrewPlan.restrictions`` and ``restricted_headcount`` must cover the members
  that the ruleset's tables restrict.
"""

import math
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import date, time
from typing import Final

from stellar_blaze.domain.plans.model import CrewMember, CrewPlan, CrewSpec, ShiftBlock, TickState, ZoneTimeline
from stellar_blaze.domain.plans.rules import PlannerRules
from stellar_blaze.domain.plans.ticks import TICK_MINUTES
from stellar_blaze.domain.risk.levels import Zone
from stellar_blaze.domain.rules.ruleset import ClauseRef

type TickRanges = tuple[tuple[int, int], ...]

SHIFT_RULES: Final[frozenset[str]] = frozenset({"P-H2.daily", "P-H2.weekly", "P-H5.hours", "P-H5.run", "P-H5.window"})
"""The rules whose violation comes from the published shift itself, not from how the planner treated it."""

_DAY_TICKS: Final = 216  # the 04:00-22:00 grid of domain.plans.ticks (a test pins the equality)
_DAY_START_MINUTE: Final = 4 * 60
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
        """Violations of rules that the published shift itself breaks (``SHIFT_RULES``)."""
        return tuple(v for v in self.violations if v.rule_id in SHIFT_RULES)

    @property
    def plan_violations(self) -> tuple[Violation, ...]:
        """Every other violation: the plan, not the shift, is wrong."""
        return tuple(v for v in self.violations if v.rule_id not in SHIFT_RULES)


@dataclass(frozen=True)
class _Finding:
    rule_id: str
    ranges: TickRanges
    detail: str


@dataclass(frozen=True)
class _Day:
    """What every check reads: the plan's states, the zones, the ban mask and the crew and rules."""

    plan: CrewPlan
    states: tuple[TickState, ...]
    zones: tuple[Zone, ...]
    ban: tuple[bool, ...]
    in_ban_season: bool
    crew: CrewSpec
    rules: PlannerRules

    @property
    def attendance(self) -> tuple[bool, ...]:
        return tuple(s is not TickState.OFF and s is not TickState.BAN for s in self.states)


def _minute(tick: int) -> int:
    return _DAY_START_MINUTE + TICK_MINUTES * tick


def _label(tick: int) -> str:
    minute = _minute(tick)
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
        _Finding("P-H1", _ranges(ticks), f"work in the midday ban window from {_label(ticks[0])} ({len(ticks)} ticks)")
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
                    f"{work} min of work in the 60 minutes from {_label(start)}, over the {cap} min cap of the most "
                    f"severe zone touched ({worst.name})"
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
            cycle = day.rules.cycle(day.zones[i - 1], day.crew.workload)
            if cycle is not None:
                rest_until = max(rest_until, i + math.ceil(cycle[1] / TICK_MINUTES))
        run_ticks = 0
    out: list[_Finding] = []
    if too_long:
        out.append(
            _Finding(
                "P-H7.run",
                _ranges(too_long),
                f"work run longer than the cycle's work length from {_label(too_long[0])} "
                f"({day.zones[too_long[0]].name}, {day.crew.workload})",
            )
        )
    if too_soon:
        out.append(
            _Finding(
                "P-H7.run",
                _ranges(too_soon),
                f"work resumes at {_label(too_soon[0])} before the full cycle rest has passed",
            )
        )
    return out


def _stop_red(day: _Day) -> list[_Finding]:
    ticks = _work_ticks(day, zones=frozenset({Zone.RED}))
    if not ticks:
        return []
    return [_Finding("STOP.red", _ranges(ticks), f"work in a Red tick from {_label(ticks[0])}")]


def _lone(day: _Day) -> list[_Finding]:
    minimum = day.rules.lone_work_min_headcount
    if day.crew.headcount >= minimum:
        return []
    ticks = _work_ticks(day, zones=_HOT)
    if not ticks:
        return []
    return [
        _Finding(
            "P-H7.lone",
            _ranges(ticks),
            f"work in Medium/High from {_label(ticks[0])} with a headcount of {day.crew.headcount} (minimum {minimum})",
        )
    ]


def _is_returning(member: CrewMember) -> bool:
    return member.away_reason != "none" and member.days_away > 0


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


def _ramp_share(member: CrewMember, rules: PlannerRules) -> int:
    """The share of the full assignment the member may do today (percent), from the acclimatisation tables."""
    table = rules.acclimatisation
    day = max(member.days_on_site, 1)
    shares: list[int] = []
    if _is_returning(member):
        # A day beyond the band's last row is a full share.
        shares.append(table.reacclimatisation_pct.get(f"{_reacclimatisation_band(member)}.{day}", 100))
    if not _is_returning(member) or not member.experienced:
        ramp = table.experienced_ramp_pct if member.experienced else table.new_ramp_pct
        shares.append(ramp[str(min(day, 5))])
    return min(shares)


def _is_acclimatised(member: CrewMember, rules: PlannerRules, *, in_ban_season: bool) -> bool:
    if member.juvenile and in_ban_season:
        return False  # juveniles are excluded from ban-season outdoor heat tasks (ADR 0011 P-H5)
    table = rules.acclimatisation
    if member.days_away > table.unacclimatised_after_days_away:
        return False
    if member.experienced:
        return True
    return table.new_ramp_pct[str(min(max(member.days_on_site, 1), 5))] >= 100


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
            f"work in Medium/High from {_label(ticks[0])} while the crew has no acclimatised member",
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
            f"attendance run from {_label(spans[0][0])} to {_label(spans[0][1])} is longer than {limit:g} h "
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
            )
        )
    if days * minutes > labour.normal_hours_per_week * 60:
        out.append(
            _Finding(
                "P-H2.weekly",
                _ranges(ticks),
                f"{days} days x {minutes / 60:.2f} h = {days * minutes / 60:.2f} h a week exceeds "
                f"{labour.normal_hours_per_week:g} h",
            )
        )
    return out


def _has_juvenile(crew: CrewSpec) -> bool:
    return crew.members is not None and any(m.juvenile for m in crew.members)


def _juvenile(day: _Day) -> list[_Finding]:
    labour = day.rules.labour
    start, end = (_minutes_of(t) for t in labour.juvenile_window)
    out: list[_Finding] = []
    outside = [i for i, a in enumerate(day.attendance) if a and not start <= _minute(i) < end]
    if outside:
        out.append(
            _Finding(
                "P-H5.window",
                _ranges(outside),
                f"juvenile attendance outside {labour.juvenile_window[0]:%H:%M}-{labour.juvenile_window[1]:%H:%M} "
                f"from {_label(outside[0])}",
            )
        )
    ticks = _attendance_ticks(day)
    if len(ticks) * TICK_MINUTES > labour.juvenile_max_h * 60:
        out.append(
            _Finding(
                "P-H5.hours",
                _ranges(ticks),
                f"{len(ticks) * TICK_MINUTES / 60:.2f} h of juvenile attendance exceeds {labour.juvenile_max_h:g} h",
            )
        )
    spans = _long_runs(day, labour.juvenile_max_run_h)
    if spans:
        out.append(
            _Finding(
                "P-H5.run",
                spans,
                f"juvenile attendance run from {_label(spans[0][0])} is longer than {labour.juvenile_max_run_h:g} h",
            )
        )
    return out


def _declarations(day: _Day) -> list[_Finding]:
    """People rules are declared restrictions: the plan must name the rules that restrict members, and how many."""
    members = day.crew.members
    if not members:
        return []
    rules = day.rules
    heavy_days = rules.acclimatisation.heavy_work_after_days
    required: dict[str, list[int]] = {"P-H8.ramp": [], "P-H8.heavy7": [], "P-H5.hours": [], "P-H7.unacclimatised": []}
    for index, m in enumerate(members):
        juvenile_in_season = m.juvenile and day.in_ban_season
        if _ramp_share(m, rules) < 100:
            required["P-H8.ramp"].append(index)
        if day.crew.workload == "heavy" and (not m.experienced or _is_returning(m)) and m.days_on_site < heavy_days:
            required["P-H8.heavy7"].append(index)
        if juvenile_in_season:
            required["P-H5.hours"].append(index)
        elif not _is_acclimatised(m, rules, in_ban_season=day.in_ban_season):
            required["P-H7.unacclimatised"].append(index)
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
                    f"the plan does not declare the restriction {rule_id} for {len(required[rule_id])} member(s)",
                )
            )
    if needed and day.plan.restricted_headcount < len(flagged):
        out.append(
            _Finding(
                needed[0],
                all_work,
                f"restricted_headcount {day.plan.restricted_headcount} is below the {len(flagged)} restricted "
                "member(s)",
            )
        )
    return out


def _in_shift(tick: int, shift: tuple[ShiftBlock, ...]) -> bool:
    minute = _minute(tick)
    return any(_minutes_of(block.start) <= minute < _minutes_of(block.end) for block in shift)


def _no_added_minutes(day: _Day, shift: tuple[ShiftBlock, ...]) -> list[_Finding]:
    ticks = [i for i in _work_ticks(day) if not _in_shift(i, shift)]
    if not ticks:
        return []
    return [_Finding("P-H10", _ranges(ticks), f"work outside the published shift from {_label(ticks[0])}")]


# ------------------------------------------------------------------------------------------------- the entry point


def validate_plan(
    plan: CrewPlan,
    zones: ZoneTimeline,
    crew: CrewSpec,
    rules: PlannerRules,
    clauses: Mapping[str, ClauseRef],
    *,
    published_shift: tuple[ShiftBlock, ...] | None,
) -> ValidationResult:
    """Check ``plan`` against every hard rule on ``zones`` for ``crew``; ``published_shift`` enables ``P-H10``.

    Raises:
        ValueError: The plan or the timeline is not a 216-tick day, or they start at different instants.
        MissingClauseError: A rule id that is evaluated has no entry in ``clauses``.
    """
    if len(plan.states) != _DAY_TICKS or len(zones.zones) != _DAY_TICKS:
        raise ValueError(
            f"a plan and its zone timeline must both have {_DAY_TICKS} ticks, "
            f"got {len(plan.states)} and {len(zones.zones)}"
        )
    if plan.start_utc != zones.start_utc:
        raise ValueError(f"plan starts at {plan.start_utc} but its zone timeline starts at {zones.start_utc}")
    labour = rules.labour
    in_season = _in_season(plan.local_date, labour.ban_season)
    ban_start, ban_end = (_minutes_of(t) for t in labour.ban_window)
    day = _Day(
        plan=plan,
        states=plan.states,
        zones=zones.zones,
        ban=tuple(in_season and ban_start <= _minute(i) < ban_end for i in range(_DAY_TICKS)),
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
        groups.append((("P-H5.window", "P-H5.hours", "P-H5.run"), lambda: _juvenile(day)))
    groups.append((("P-H8.ramp", "P-H8.heavy7"), lambda: _declarations(day)))
    if published_shift is not None:
        shift = published_shift
        groups.append((("P-H10",), lambda: _no_added_minutes(day, shift)))

    checked = tuple(rule_id for rule_ids, _ in groups for rule_id in rule_ids)
    missing = [rule_id for rule_id in checked if rule_id not in clauses]
    if missing:
        raise MissingClauseError(f"clauses has no entry for the rule id(s) {missing}")

    violations = tuple(
        Violation(f.rule_id, clauses[f.rule_id].clause, clauses[f.rule_id].source, f.ranges, f.detail)
        for _, check in groups
        for f in check()
    )
    return ValidationResult(violations=violations, checked_rules=checked)
