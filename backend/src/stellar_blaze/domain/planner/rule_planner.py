"""The rule-based crew planner: one crew, one local day, 5-minute ticks (ADR 0011 section 2, ADR 0046 decisions 7-8).

Pure and deterministic: no I/O, no clock, no randomness. The planner never moves a shift edge and never adds work
(P-H10);
a Low zone or Green level is a bound, not a pace. It must not import ``stellar_blaze.domain.validator``: the validator
re-implements every definition below independently from the same ``PlannerRules`` and zone timeline.

Definitions
-----------
* **Attendance ticks** ``A``: shift ticks outside the ban window. Their state is never ``OFF`` or ``BAN``. A tick
  outside
  the shift is ``OFF`` (also inside the ban window: OFF wins), a shift tick inside the ban window in season is ``BAN``.
* **Windows**: every 12 consecutive ticks inside the 216-tick grid, sliding by one tick (start index 0..204).
* **Rolling cap (ADR 0011 section 2, with lookahead)**: ``M(w)`` is the most severe zone among the ticks of ``w`` that
  are in ``A`` and are not Red; work in ``w`` is at most ``cap_minutes(M(w), workload)``. A window with no such tick has
  no cap. **Red does not extend the cap into neighbouring ticks**: a Red tick is a stop of its own (``STOPPED``,
  ``STOP.red``); a literal "Red cap 0 on every window touching a Red tick" would retroactively remove the work of the
  hour before a stop, which no plan can do after the fact. Work shortly before a worse zone is limited by the worse
  zone's cap because the whole day's timeline is known (the cap is computed per window up front).
* **Art. 18 runs**: attendance ticks in time order, split only by a gap of at least ``art18_break_h`` of consecutive
  ``OFF`` ticks outside the ban window (a ban gap and ADOSH rest are never credited). A run is measured in attendance
  ticks (ban ticks and short OFF gaps inside it are not counted). A run longer than ``art18_max_run_h`` gets
  ``art18_break_h`` of ``ART18_BREAK`` in blocks of consecutive attendance ticks, placed greedily at the window of
  lowest
  mean ``protective_twl_w_m2`` (NaN ignored; a window with no value ranks last; ties: earliest) such that the side
  before
  has at most ``art18_max_run_h``, the side after can still be covered by the fewest further breaks, and neither side is
  empty; repeated on the remainder. If no such window exists the planner raises rather than emit a plan the
  validator would reject.

Greedy (forward in time over the 216 ticks; fixed states first, then per attendance tick)
-----------------------------------------------------------------------------------------
``OFF``/``BAN``/``ART18_BREAK`` are fixed. Otherwise ``STOPPED`` if the zone is Red (``STOP.red``) or the zone is
Medium/High and fewer than ``lone_work_min_headcount`` members are acclimatized and available (``P-H7.lone`` or
``STOP.no_acclimatised``). Otherwise ``WORK`` only when no cycle rest is pending, the zone's cycle (if any) allows one
more tick (run so far < cycle work length of the tick's zone: a worsening zone cuts a longer run immediately), and every
window containing the tick has work already placed + 1 tick <= its cap (future ticks only add work, so placed work is
the whole check). Else ``ADOSH_REST``. When a work run ends (ruling R-AA) the pending rest is the LONGER of the full
rest of the cycle of the zone of its last ``WORK`` tick and of the zone of the first non-work tick that ended it; the
second counts only when that tick is an attendance tick (``ADOSH_REST``, ``STOPPED``, ``ART18_BREAK``): ``OFF``/``BAN``
ticks, Red and zones without a cycle contribute nothing. Every non-work tick counts the rest down; it is never shortened
when the zone eases and never extended later. Self-paced cells (no cycle) have no pending rest: a cap-blocked tick is
simply ``ADOSH_REST``.

``CrewPlan.rule_ids`` is the sorted tuple of the distinct rule ids that fired in the day (``P-H1`` ban, ``P-H3`` Art.
18, ``P-H7.run`` cycle rest, ``P-H7.cap60`` window-cap rest, ``STOP.red``, ``P-H7.lone`` / ``STOP.no_acclimatised``,
``FALLBACK.high``). People rules (``restricted_headcount``, ``restrictions``) never change tick states except through
the lone-work stop.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from math import ceil, floor, isnan
from zoneinfo import ZoneInfo

import numpy as np

from stellar_blaze.domain.plans.model import CrewMember, CrewPlan, CrewSpec, TickState, Workload, ZoneTimeline
from stellar_blaze.domain.plans.rules import PlannerRules
from stellar_blaze.domain.plans.ticks import TICK_MINUTES, day_ticks, in_ban
from stellar_blaze.domain.risk.levels import Zone
from stellar_blaze.domain.rules.ruleset import Acclimatisation

_WINDOW_TICKS = 12  # 60 minutes
_EPS = 1e-9


# ---- people rules (PERSONAL data class, ADR 0010 section 8: only counts leave this module) ---------------------------


@dataclass(frozen=True)
class _People:
    headcount: int
    acclimatised: int  # members who may work in Medium/High ticks (acclimatized, and not excluded as juveniles)
    restricted: int
    restrictions: tuple[str, ...]


def _away_band(member: CrewMember) -> str | None:
    """The re-acclimatization row of the guideline for the days away, ``None`` when the member was not away.

    Row edges ``<4, 4-5, 6-12, 12-20, >20`` are in days away; for illness the parenthetical illness-day edges
    ``1-3, 4-5, 6-8, >8`` apply (they dominate the calendar row). Day 12 sits on two rows: the more protective
    ``12-20``.
    """
    days = member.days_away
    if days <= 0:
        return None
    edges: tuple[tuple[int, str], ...]
    if member.away_reason == "illness":
        edges = ((3, "4-5"), (5, "6-12"), (8, "12-20"))
    else:
        edges = ((3, "lt4"), (5, "4-5"), (11, "6-12"), (20, "12-20"))
    for upper, band in edges:
        if days <= upper:
            return band
    return "gt20"


def _ramp_share(table: dict[str, int], day: int, prefix: str = "") -> int:
    """The share of the full assignment on ``day`` (1-based); 100 once the ramp is complete."""
    days = [int(key.removeprefix(prefix)) for key in table if key.startswith(prefix)]
    return table[f"{prefix}{day}"] if 1 <= day <= max(days) else 100


def _share(member: CrewMember, acc: Acclimatisation) -> int:
    day = max(member.days_on_site, 1)
    shares = [100]
    if not member.experienced:
        shares.append(_ramp_share(acc.new_ramp_pct, day))
    elif member.days_away <= 0:
        shares.append(_ramp_share(acc.experienced_ramp_pct, day))
    band = _away_band(member)
    if band is not None:
        shares.append(_ramp_share(acc.reacclimatisation_pct, day, f"{band}."))
    return min(shares)


def _unacclimatised(member: CrewMember, acc: Acclimatisation) -> bool:
    new_in_ramp = not member.experienced and _ramp_share(acc.new_ramp_pct, max(member.days_on_site, 1)) < 100
    return new_in_ramp or member.days_away > acc.unacclimatised_after_days_away


def _people(crew: CrewSpec, rules: PlannerRules, season: bool) -> _People:
    if crew.members is None:  # "all acclimatized experienced adults" (try-a-plan)
        return _People(crew.headcount, crew.headcount, 0, ())
    if len(crew.members) != crew.headcount:
        raise ValueError(f"crew {crew.crew_id}: {len(crew.members)} members but headcount {crew.headcount}")
    acc = rules.acclimatisation
    flags: set[str] = set()
    restricted = acclimatised = 0
    for m in crew.members:
        member_flags: set[str] = set()
        if _unacclimatised(m, acc):
            member_flags.add("P-H7.unacclimatised")
        if _share(m, acc) < 100:
            member_flags.add("P-H8.ramp")
        returning = _away_band(m) not in (None, "lt4")
        if crew.workload == "heavy" and (not m.experienced or returning) and m.days_on_site < acc.heavy_work_after_days:
            member_flags.add("P-H8.heavy7")
        excluded = m.juvenile and season
        if excluded:
            member_flags.add("P-H5.hours")
        flags |= member_flags
        restricted += bool(member_flags)
        acclimatised += not excluded and "P-H7.unacclimatised" not in member_flags
    return _People(len(crew.members), acclimatised, restricted, tuple(sorted(flags)))


# ---- Art. 18 ---------------------------------------------------------------------------------------------------


def _art18_runs(attend: list[bool], ban: list[bool], credit_ticks: int) -> list[list[int]]:
    runs: list[list[int]] = []
    current: list[int] = []
    gap = 0
    for i, here in enumerate(attend):
        if here:
            current.append(i)
            gap = 0
        elif ban[i]:
            gap = 0  # ban time is never credited as the break
        else:
            gap += 1
            if gap >= credit_ticks and current:
                runs.append(current)
                current = []
    if current:
        runs.append(current)
    return runs


def _window_score(twl: tuple[float, ...], start: int, length: int) -> float:
    values = [v for v in twl[start : start + length] if not isnan(v)]
    return sum(values) / len(values) if values else float("inf")


def _break_starts(run: list[int], twl: tuple[float, ...], max_run: int, break_ticks: int) -> list[int]:
    """The first tick of each Art. 18 break of one attendance run (see the module docstring for the rule)."""
    starts: list[int] = []
    segment = run
    while len(segment) > max_run:
        n = len(segment)
        breaks = ceil((n - max_run) / (max_run + break_ticks))  # the fewest breaks that can cover n ticks
        right_max = max_run + (max_run + break_ticks) * (breaks - 1)
        best: tuple[float, int] | None = None
        for p in range(1, n - break_ticks):
            right = n - p - break_ticks
            if p > max_run or right < 1 or right > right_max:
                continue
            if segment[p + break_ticks - 1] - segment[p] != break_ticks - 1:
                continue  # a break is consecutive ticks, never across a ban or OFF gap
            candidate = (_window_score(twl, segment[p], break_ticks), p)
            if best is None or candidate < best:
                best = candidate
        if best is None:
            raise ValueError(f"no feasible Art. 18 break for an attendance run of {n} ticks")
        starts.append(segment[best[1]])
        segment = segment[best[1] + break_ticks :]
    return starts


# ---- the rolling cap ---------------------------------------------------------------------------------------------


def _window_caps(
    zones: tuple[Zone, ...], attend: list[bool], workload: Workload, rules: PlannerRules
) -> list[int | None]:
    """The cap of every window in ticks (``None`` = no cap); ``M(w)`` ignores Red and non-attendance ticks."""
    caps: list[int | None] = []
    for s in range(len(zones) - _WINDOW_TICKS + 1):
        touched = [zones[i] for i in range(s, s + _WINDOW_TICKS) if attend[i] and zones[i] is not Zone.RED]
        caps.append(rules.cap_minutes(max(touched), workload) // TICK_MINUTES if touched else None)
    return caps


def _fits(caps: list[int | None], placed: list[int], windows: range) -> bool:
    """One more work tick fits in every window that contains it (placed work + 1 tick <= the window's cap)."""
    for w in windows:
        cap = caps[w]
        if cap is not None and placed[w] + 1 > cap:
            return False
    return True


# ---- the pacer ---------------------------------------------------------------------------------------------------


@dataclass
class _Pacer:
    """The run and rest bookkeeping of one crew (cycles anchored at the shift start run across hour boundaries)."""

    rules: PlannerRules
    workload: Workload
    run: int = 0
    rest_left: int = 0
    last_work_zone: Zone = Zone.LOW

    def work_limit(self, zone: Zone) -> int | None:
        cycle = self.rules.cycle(zone, self.workload)
        return None if cycle is None else cycle[0] // TICK_MINUTES

    def _rest_ticks(self, zone: Zone) -> int:
        cycle = self.rules.cycle(zone, self.workload)
        return 0 if cycle is None else ceil(cycle[1] / TICK_MINUTES - _EPS)

    def cycle_allows(self, zone: Zone) -> bool:
        limit = self.work_limit(zone)
        return self.rest_left == 0 and (limit is None or self.run < limit)

    def work(self, zone: Zone) -> None:
        self.run += 1
        self.last_work_zone = zone

    def non_work(self, ending_zone: Zone | None) -> None:
        """A non-work tick; it counts as rest. If it ends a run, the full rest starts (ruling R-AA).

        The rest is the longer of the cycle rests of the run's last work tick's zone and of ``ending_zone``, the zone of
        this tick when it is an attendance tick (``ADOSH_REST``, ``STOPPED``, ``ART18_BREAK``); ``None`` for ``OFF`` and
        ``BAN``. A Red zone or a zone without a cycle has no rest, so it contributes nothing.
        """
        if self.run > 0:
            self.rest_left = self._rest_ticks(self.last_work_zone)
            if ending_zone is not None:
                self.rest_left = max(self.rest_left, self._rest_ticks(ending_zone))
            self.run = 0
        if self.rest_left > 0:
            self.rest_left -= 1


# ---- the planner -------------------------------------------------------------------------------------------------


def _shift_ticks(crew: CrewSpec, local_date: date, tz: ZoneInfo, start_utc: datetime, n: int) -> list[bool]:
    spans: list[tuple[datetime, datetime]] = []
    for blk in crew.shift:
        if blk.start >= blk.end:
            raise ValueError(f"shift block must start before it ends, got {blk.start}-{blk.end}")
        spans.append(
            (
                datetime.combine(local_date, blk.start, tzinfo=tz).astimezone(UTC),
                datetime.combine(local_date, blk.end, tzinfo=tz).astimezone(UTC),
            )
        )
    ticks = [start_utc + timedelta(minutes=TICK_MINUTES * i) for i in range(n)]
    return [any(a <= t < b for a, b in spans) for t in ticks]


def plan_crew(crew: CrewSpec, zones: ZoneTimeline, rules: PlannerRules, *, local_date: date, tz: ZoneInfo) -> CrewPlan:
    """The rule plan of ``crew`` on ``local_date``: one ``TickState`` per 5-minute tick of the 216-tick day grid.

    Raises:
        ValueError: The timeline is not the day grid of ``local_date`` in ``tz``, a shift block ends before it starts,
            ``crew.members`` does not match ``crew.headcount``, or no Art. 18 break can be placed.
    """
    grid = day_ticks(local_date, tz)
    n = int(grid.size)
    if len(zones.zones) != n:
        raise ValueError(f"the zone timeline needs {n} ticks (one local day), got {len(zones.zones)}")
    start_utc = zones.start_utc.astimezone(UTC)
    if np.datetime64(start_utc.replace(tzinfo=None), "us") != grid[0]:
        raise ValueError(f"the zone timeline start {zones.start_utc} is not the start of {local_date} in {tz.key}")
    labour = rules.labour
    if labour.art18_ban_gap_counts_as_break or labour.art18_adosh_rest_counts_as_break:
        raise NotImplementedError("the planner implements the protective Art. 18 reading only (counsel Q1)")

    on_shift = _shift_ticks(crew, local_date, tz, start_utc, n)
    ban_window = [bool(b) for b in in_ban(grid, local_date, tz, labour)]
    attend = [s and not b for s, b in zip(on_shift, ban_window, strict=True)]
    people = _people(crew, rules, season=any(ban_window))

    max_run = floor(labour.art18_max_run_h * 12 + _EPS)
    break_ticks = ceil(labour.art18_break_h * 12 - _EPS)
    break_at: set[int] = set()
    for run in _art18_runs(attend, ban_window, break_ticks):
        for first in _break_starts(run, zones.protective_twl_w_m2, max_run, break_ticks):
            break_at.update(range(first, first + break_ticks))

    caps = _window_caps(zones.zones, attend, crew.workload, rules)
    placed = [0] * len(caps)
    pacer = _Pacer(rules, crew.workload)
    states: list[TickState] = []
    fired: set[str] = set()

    for i in range(n):
        zone = zones.zones[i]
        if not on_shift[i]:
            states.append(TickState.OFF)
            pacer.non_work(None)
            continue
        if ban_window[i]:
            states.append(TickState.BAN)
            fired.add("P-H1")
            pacer.non_work(None)
            continue
        if i in break_at:
            states.append(TickState.ART18_BREAK)
            fired.add("P-H3")
            pacer.non_work(zone)
            continue
        stop = _stop_rule(zone, people, rules)
        if stop is not None:
            states.append(TickState.STOPPED)
            fired.add(stop)
            pacer.non_work(zone)
            continue
        windows = range(max(0, i - _WINDOW_TICKS + 1), min(len(caps) - 1, i) + 1)
        cap_ok = _fits(caps, placed, windows)
        if pacer.cycle_allows(zone) and cap_ok:
            states.append(TickState.WORK)
            for w in windows:
                placed[w] += 1
            pacer.work(zone)
            continue
        states.append(TickState.ADOSH_REST)
        fired.add("P-H7.cap60" if pacer.cycle_allows(zone) else "P-H7.run")
        pacer.non_work(zone)

    fallback = zones.source == "fallback" or any(a and f for a, f in zip(attend, zones.fallback, strict=True))
    if fallback:
        fired.add("FALLBACK.high")

    def minutes(state: TickState) -> int:
        return TICK_MINUTES * states.count(state)

    return CrewPlan(
        crew_id=crew.crew_id,
        local_date=local_date,
        start_utc=zones.start_utc,
        states=tuple(states),
        rule_ids=tuple(sorted(fired)),
        status="fallback" if fallback else "rule",
        restricted_headcount=people.restricted,
        restrictions=people.restrictions,
        work_minutes=minutes(TickState.WORK),
        adosh_rest_minutes=minutes(TickState.ADOSH_REST),
        art18_minutes=minutes(TickState.ART18_BREAK),
        stopped_minutes=minutes(TickState.STOPPED),
    )


def _stop_rule(zone: Zone, people: _People, rules: PlannerRules) -> str | None:
    """The rule id that stops the crew in a tick of ``zone``, or ``None`` (Red; lone or unacclimatized)."""
    if zone is Zone.RED:
        return "STOP.red"
    if zone in (Zone.MEDIUM, Zone.HIGH) and people.acclimatised < rules.lone_work_min_headcount:
        enough_people = people.headcount >= rules.lone_work_min_headcount
        return "STOP.no_acclimatised" if enough_people and people.acclimatised == 0 else "P-H7.lone"
    return None
