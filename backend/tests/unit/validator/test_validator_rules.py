"""The independent validator, rule by rule: a violating and a boundary-legal fixture for every rule id.

Every plan here is hand-built (``support.plan_of``); nothing imports the planner. Tick indices are 5-minute ticks from
04:00 local (tick 0 is 04:00, ``at("06:00")`` is 24).
"""

import dataclasses
from datetime import date
from zoneinfo import ZoneInfo

import pytest

from stellar_blaze.domain.plans.model import ShiftBlock, TickState, ZoneTimeline
from stellar_blaze.domain.plans.ticks import day_ticks
from stellar_blaze.domain.risk.levels import Zone
from stellar_blaze.domain.validator.roster_text import parse_roster, plan_from_segments
from stellar_blaze.domain.validator.validator import (
    SHIFT_RULES,
    MissingClauseError,
    ValidationResult,
    Violation,
    validate_plan,
)
from tests.unit.validator.support import (
    B0,
    L1,
    START_UTC,
    SUMMER,
    TICKS,
    WINTER,
    at,
    by_tick,
    clauses_of,
    crew_of,
    first,
    ids,
    member,
    only,
    plan_of,
    rules_of,
    run_validator,
    states,
    uniform,
    with_labour,
    zones_by_tick,
)

pytestmark = pytest.mark.unit

W, R, B, S, OFF_, BAN = (
    TickState.WORK,
    TickState.ADOSH_REST,
    TickState.ART18_BREAK,
    TickState.STOPPED,
    TickState.OFF,
    TickState.BAN,
)
LOW, MEDIUM, HIGH, RED = Zone.LOW, Zone.MEDIUM, Zone.HIGH, Zone.RED
ALL_DECLARED = ("P-H8.ramp", "P-H8.heavy7", "P-H5.hours", "P-H7.unacclimatised")


def _cited(violation: Violation, rule_id: str) -> None:
    """The violation carries the ruleset's clause text and source id for its rule."""
    ref = clauses_of()[rule_id]
    assert violation.rule_id == rule_id
    assert violation.clause == ref.clause
    assert violation.source_id == ref.source
    assert violation.detail


# ---------------------------------------------------------------------------------------------- P-H1 (the ban)


def test_rule_p_h1_fires() -> None:
    result = run_validator(plan_of(states(("12:30", "12:35", W))), uniform(LOW), crew_of(workload="light"))
    violation = only(result, "P-H1")
    _cited(violation, "P-H1")
    assert violation.tick_ranges == ((at("12:30"), at("12:35")),)


def test_rule_p_h1_boundary_legal() -> None:
    """The tick before 12:30 and the tick at 15:00 are outside the half-open ban window."""
    plan = plan_of(states(("12:25", "12:30", W), ("15:00", "15:05", W)))
    assert "P-H1" not in ids(run_validator(plan, uniform(LOW), crew_of(workload="light")))


@pytest.mark.parametrize(
    ("day", "fires"),
    [
        (date(2026, 6, 14), False),
        (date(2026, 6, 15), True),
        (date(2026, 9, 15), True),
        (date(2026, 9, 16), False),
        (WINTER, False),
    ],
)
def test_rule_p_h1_season_is_inclusive(day: date, fires: bool) -> None:
    plan = plan_of(states(("13:00", "13:05", W)), local_date=day)
    result = run_validator(plan, uniform(LOW), crew_of(workload="light"))
    assert ("P-H1" in ids(result)) is fires


def test_rule_p_h1_ban_state_is_not_work() -> None:
    plan = plan_of(states(("12:30", "15:00", BAN)))
    assert "P-H1" not in ids(run_validator(plan, uniform(LOW), crew_of(workload="light")))


# ---------------------------------------------------------------------------------- P-H7.cap60 (rolling window)


@pytest.mark.parametrize(
    ("zone", "workload", "cap"),
    [
        (MEDIUM, "heavy", 45),
        (MEDIUM, "moderate", 45),
        (HIGH, "light", 45),
        (HIGH, "heavy", 20),
        (HIGH, "moderate", 20),
    ],
)
def test_rule_p_h7_cap60_boundary_and_fires(zone: Zone, workload: str, cap: int) -> None:
    crew = crew_of(workload=workload)  # type: ignore[arg-type]
    at_cap = run_validator(plan_of(by_tick((0, cap // 5, W))), uniform(zone), crew)
    assert "P-H7.cap60" not in ids(at_cap)
    over = run_validator(plan_of(by_tick((0, cap // 5 + 1, W))), uniform(zone), crew)
    violation = only(over, "P-H7.cap60")
    _cited(violation, "P-H7.cap60")
    assert violation.tick_ranges == ((0, 12),)  # only the window [0, 12) holds all the work


def test_rule_p_h7_cap60_medium_light_and_low_are_never_over() -> None:
    twelve = plan_of(by_tick((0, 12, W)))
    assert "P-H7.cap60" not in ids(run_validator(twelve, uniform(MEDIUM), crew_of(workload="light")))
    assert "P-H7.cap60" not in ids(run_validator(twelve, uniform(LOW), crew_of(workload="heavy")))


def test_rule_p_h7_cap60_last_window_of_the_grid() -> None:
    """The last window is [204, 216): work in the final ticks is capped like any other."""
    crew = crew_of(workload="heavy")
    legal = run_validator(plan_of(by_tick((207, 216, W))), uniform(MEDIUM), crew)
    assert "P-H7.cap60" not in ids(legal)
    over = run_validator(plan_of(by_tick((206, 216, W))), uniform(MEDIUM), crew)
    assert only(over, "P-H7.cap60").tick_ranges == ((204, 216),)


def test_rule_p_h7_cap60_work_exactly_at_the_cap_with_a_rest_inside() -> None:
    """45 min of work in a Medium heavy window is legal; five minutes more is not."""
    crew = crew_of(workload="heavy")
    legal = run_validator(plan_of(by_tick((0, 5, W), (5, 6, R), (6, 10, W))), uniform(MEDIUM), crew)
    assert "P-H7.cap60" not in ids(legal)
    over = run_validator(plan_of(by_tick((0, 5, W), (5, 6, R), (6, 11, W))), uniform(MEDIUM), crew)
    assert only(over, "P-H7.cap60").tick_ranges == ((0, 12),)


def test_rule_p_h7_cap60_worse_zone_later_in_the_same_hour_is_a_violation() -> None:
    """30 min of Medium work, then a High tick inside the window: the window touched High, so the cap is 20."""
    zones = zones_by_tick((6, TICKS, HIGH), default=MEDIUM)
    crew = crew_of(workload="heavy")
    uncut = run_validator(plan_of(by_tick((0, 6, W), (6, 14, R))), zones, crew)
    violation = only(uncut, "P-H7.cap60")
    # windows [0, 12) holds 30 min and [1, 13) holds 25 min, both over 20; [2, 14) holds 20 min and is legal.
    assert violation.tick_ranges == ((0, 13),)
    assert "high" in violation.detail.lower() or "HIGH" in violation.detail


def test_rule_p_h7_cap60_lookahead_correct_cut_is_legal() -> None:
    zones = zones_by_tick((6, TICKS, HIGH), default=MEDIUM)
    cut = run_validator(plan_of(by_tick((0, 4, W), (4, 14, R))), zones, crew_of(workload="heavy"))
    assert ids(cut).isdisjoint({"P-H7.cap60", "P-H7.run"})


def test_rule_p_h7_cap60_red_does_not_extend_the_cap_into_neighbouring_windows() -> None:
    """45 min of Medium work followed by a Red stop: the windows next to the stop are still Medium windows."""
    zones = zones_by_tick((12, TICKS, RED), default=MEDIUM)
    plan = plan_of(by_tick((0, 9, W), (9, 12, R), (12, 40, S)))
    result = run_validator(plan, zones, crew_of(workload="heavy"))
    assert ids(result).isdisjoint({"P-H7.cap60", "STOP.red"})


def test_rule_p_h7_cap60_red_work_counts_as_work_but_not_as_a_zone() -> None:
    """Work in a Red tick is STOP.red's finding; in the window it adds minutes but not severity (cap stays 45)."""
    zones = zones_by_tick((12, TICKS, RED), default=MEDIUM)
    plan = plan_of(by_tick((0, 9, W), (9, 12, R), (12, 13, W)))
    result = run_validator(plan, zones, crew_of(workload="heavy"))
    assert only(result, "STOP.red").tick_ranges == ((12, 13),)
    assert "P-H7.cap60" not in ids(result)  # window [1, 13) holds exactly 45 min
    plan_more = plan_of(by_tick((0, 9, W), (9, 11, R), (11, 13, W)))
    assert only(run_validator(plan_more, zones, crew_of(workload="heavy")), "P-H7.cap60").tick_ranges == ((0, 13),)


def test_rule_p_h7_cap60_window_of_only_red_ticks_has_no_cap() -> None:
    zones = uniform(RED)
    result = run_validator(plan_of(by_tick((0, 6, S))), zones, crew_of(workload="heavy"))
    assert result.passed


# ------------------------------------------------------------------------------------------ P-H7.run (per tick)


@pytest.mark.parametrize(
    ("zone", "workload", "ticks"),
    [(HIGH, "heavy", 4), (HIGH, "moderate", 4), (HIGH, "light", 9), (MEDIUM, "heavy", 9), (MEDIUM, "moderate", 9)],
)
def test_rule_p_h7_run_exactly_at_the_limit_is_legal_and_one_tick_more_fires(
    zone: Zone, workload: str, ticks: int
) -> None:
    crew = crew_of(workload=workload)  # type: ignore[arg-type]
    legal = run_validator(plan_of(by_tick((0, ticks, W))), uniform(zone), crew)
    assert "P-H7.run" not in ids(legal)
    over = run_validator(plan_of(by_tick((0, ticks + 1, W))), uniform(zone), crew)
    violation = only(over, "P-H7.run")
    _cited(violation, "P-H7.run")
    assert violation.tick_ranges == ((ticks, ticks + 1),)


def test_rule_p_h7_run_self_paced_cells_have_no_limit() -> None:
    long_run = plan_of(by_tick((0, 40, W)))
    assert "P-H7.run" not in ids(run_validator(long_run, uniform(LOW), crew_of(workload="heavy")))
    assert "P-H7.run" not in ids(run_validator(long_run, uniform(MEDIUM), crew_of(workload="light")))


def test_rule_p_h7_run_spanning_a_zone_change_is_checked_per_tick() -> None:
    """A run of 30 min in Medium that carries on into High is offending from the first High tick."""
    zones = zones_by_tick((6, TICKS, HIGH), default=MEDIUM)
    crew = crew_of(workload="heavy")
    carried_on = run_validator(plan_of(by_tick((0, 9, W))), zones, crew)
    assert only(carried_on, "P-H7.run").tick_ranges == ((6, 9),)
    cut_at_the_change = run_validator(plan_of(by_tick((0, 6, W), (6, 20, R))), zones, crew)
    assert "P-H7.run" not in ids(cut_at_the_change)


def test_rule_p_h7_run_cycle_rest_must_be_complete() -> None:
    """After a Medium heavy run (45/15) three non-work ticks are needed before work resumes."""
    crew = crew_of(workload="heavy")
    short = run_validator(plan_of(by_tick((0, 5, W), (7, 9, W))), uniform(MEDIUM), crew)
    violation = only(short, "P-H7.run")
    assert violation.tick_ranges == ((7, 8),)
    full = run_validator(plan_of(by_tick((0, 5, W), (8, 10, W))), uniform(MEDIUM), crew)
    assert "P-H7.run" not in ids(full)


def test_rule_p_h7_run_every_kind_of_non_work_tick_counts_down_the_rest() -> None:
    plan = plan_of(by_tick((0, 5, W), (5, 6, S), (6, 7, OFF_), (7, 8, BAN), (8, 10, W)))
    assert "P-H7.run" not in ids(run_validator(plan, uniform(MEDIUM), crew_of(workload="heavy")))
    breaks = plan_of(by_tick((0, 5, W), (5, 8, B), (8, 10, W)))
    assert "P-H7.run" not in ids(run_validator(breaks, uniform(MEDIUM), crew_of(workload="heavy")))


def test_rule_p_h7_run_high_heavy_rest_is_forty_minutes() -> None:
    crew = crew_of(workload="heavy")
    short = run_validator(plan_of(by_tick((0, 4, W), (11, 12, W))), uniform(HIGH), crew)
    assert only(short, "P-H7.run").tick_ranges == ((11, 12),)
    full = run_validator(plan_of(by_tick((0, 4, W), (12, 13, W))), uniform(HIGH), crew)
    assert "P-H7.run" not in ids(full)


def test_rule_p_h7_run_rest_branch_a_zone_of_the_last_work_tick() -> None:
    """R-AA (a): the run ended in High (20/40) and the zone eases to Medium: the 40 min rest is still owed."""
    zones = zones_by_tick((4, TICKS, MEDIUM), default=HIGH)
    crew = crew_of(workload="heavy")
    short = run_validator(plan_of(by_tick((0, 4, W), (4, 11, R), (11, 12, W))), zones, crew)
    assert only(short, "P-H7.run").tick_ranges == ((11, 12),)  # 7 rest ticks of the 8 owed
    full = run_validator(plan_of(by_tick((0, 4, W), (4, 12, R), (12, 13, W))), zones, crew)
    assert "P-H7.run" not in ids(full)


def test_rule_p_h7_run_rest_branch_b_zone_of_the_tick_that_ended_the_run() -> None:
    """R-AA (b): Medium work cut by a worsening to High at an attendance tick: the High rest (40 min) is owed."""
    zones = zones_by_tick((3, TICKS, HIGH), default=MEDIUM)
    crew = crew_of(workload="heavy")
    short = run_validator(plan_of(by_tick((0, 3, W), (3, 10, R), (10, 11, W))), zones, crew)
    assert only(short, "P-H7.run").tick_ranges == ((10, 11),)
    full = run_validator(plan_of(by_tick((0, 3, W), (3, 11, R), (11, 12, W))), zones, crew)
    assert "P-H7.run" not in ids(full)
    for ending in (R, S, B):
        plan = plan_of(by_tick((0, 3, W), (3, 4, ending), (4, 10, R), (10, 11, W)))
        assert "P-H7.run" in ids(run_validator(plan, zones, crew)), ending


@pytest.mark.parametrize("ending", [OFF_, BAN])
def test_rule_p_h7_run_rest_branch_b_off_and_ban_ticks_contribute_nothing(ending: TickState) -> None:
    zones = zones_by_tick((3, TICKS, HIGH), default=MEDIUM)
    plan = plan_of(by_tick((0, 3, W), (3, 4, ending), (6, 7, W)))  # only the Medium rest (3 ticks) is owed
    assert "P-H7.run" not in ids(run_validator(plan, zones, crew_of(workload="heavy")))


def test_rule_p_h7_run_rest_branch_b_red_tick_contributes_nothing() -> None:
    zones = zones_by_tick((3, 4, RED), default=MEDIUM)
    plan = plan_of(by_tick((0, 3, W), (3, 6, S), (6, 7, W)))
    assert "P-H7.run" not in ids(run_validator(plan, zones, crew_of(workload="heavy")))


def test_rule_p_h7_run_rest_the_longer_of_the_two_wins_and_cycle_less_zones_add_nothing() -> None:
    crew = crew_of(workload="heavy")
    # last work tick Medium (3 ticks), ending tick Low (no cycle): 3 ticks owed
    low_end = zones_by_tick((3, TICKS, LOW), default=MEDIUM)
    assert "P-H7.run" not in ids(run_validator(plan_of(by_tick((0, 3, W), (3, 6, R), (6, 7, W))), low_end, crew))
    assert "P-H7.run" in ids(run_validator(plan_of(by_tick((0, 3, W), (3, 5, R), (5, 6, W))), low_end, crew))
    # last work tick Low (no cycle), ending tick High: the High rest (8 ticks) is owed through branch (b)
    low_run = zones_by_tick((3, TICKS, HIGH), default=LOW)
    assert "P-H7.run" in ids(run_validator(plan_of(by_tick((0, 3, W), (3, 10, R), (10, 11, W))), low_run, crew))
    assert "P-H7.run" not in ids(run_validator(plan_of(by_tick((0, 3, W), (3, 11, R), (11, 12, W))), low_run, crew))


def test_rule_p_h7_run_reports_the_run_and_the_rest_findings_with_the_same_id() -> None:
    plan = plan_of(by_tick((0, 12, W), (13, 14, W)))
    result = run_validator(plan, uniform(MEDIUM), crew_of(workload="heavy"))
    found = [v for v in result.violations if v.rule_id == "P-H7.run"]
    assert len(found) == 2
    assert found[0].tick_ranges == ((9, 12),)
    assert found[1].tick_ranges == ((13, 14),)


# ----------------------------------------------------------------------------------------------------- STOP.red


def test_rule_stop_red_fires() -> None:
    zones = zones_by_tick((10, 12, RED), default=LOW)
    result = run_validator(plan_of(by_tick((8, 12, W))), zones, crew_of(workload="light"))
    violation = only(result, "STOP.red")
    _cited(violation, "STOP.red")
    assert violation.tick_ranges == ((10, 12),)


def test_rule_stop_red_boundary_legal() -> None:
    zones = zones_by_tick((10, 12, RED), default=LOW)
    result = run_validator(plan_of(by_tick((8, 10, W), (10, 12, S))), zones, crew_of(workload="light"))
    assert "STOP.red" not in ids(result)


# ----------------------------------------------------------------------------------------------------- P-H7.lone


def test_rule_p_h7_lone_fires() -> None:
    result = run_validator(plan_of(by_tick((0, 3, W))), uniform(MEDIUM), crew_of(workload="light", headcount=1))
    violation = only(result, "P-H7.lone")
    _cited(violation, "P-H7.lone")
    assert violation.tick_ranges == ((0, 3),)
    high = run_validator(plan_of(by_tick((0, 3, W))), uniform(HIGH), crew_of(workload="light", headcount=1))
    assert "P-H7.lone" in ids(high)


def test_rule_p_h7_lone_boundary_legal() -> None:
    minimum = rules_of().lone_work_min_headcount
    plan = plan_of(by_tick((0, 3, W)))
    at_min = run_validator(plan, uniform(MEDIUM), crew_of(workload="light", headcount=minimum))
    assert "P-H7.lone" not in ids(at_min)
    below = run_validator(plan, uniform(MEDIUM), crew_of(workload="light", headcount=minimum - 1))
    assert "P-H7.lone" in ids(below)
    alone_in_low = run_validator(plan, uniform(LOW), crew_of(workload="light", headcount=1))
    assert "P-H7.lone" not in ids(alone_in_low)


# ------------------------------------------------------------------------------------ P-H7.unacclimatised (work)


def _one_member_work(solo: object, *, day: date = SUMMER, zone: Zone = MEDIUM) -> ValidationResult:
    """Three ticks of light work in ``zone`` by a crew whose only member is ``solo``, all restrictions declared."""
    crew = crew_of(workload="light", headcount=20, members=(solo,))  # type: ignore[arg-type]
    plan = plan_of(by_tick((0, 3, W)), local_date=day, restrictions=ALL_DECLARED, restricted_headcount=1)
    return run_validator(plan, uniform(zone), crew)


def test_rule_p_h7_unacclimatised_fires() -> None:
    result = _one_member_work(member(experienced=False, days_on_site=1))
    violation = only(result, "P-H7.unacclimatised")
    _cited(violation, "P-H7.unacclimatised")
    assert violation.tick_ranges == ((0, 3),)


@pytest.mark.parametrize(
    ("solo", "available"),
    [
        (member(experienced=False, days_on_site=5), True),
        (member(experienced=False, days_on_site=4), False),
        (member(experienced=False, days_on_site=40), True),
        (member(experienced=True, days_on_site=1), True),
        (member(experienced=True, days_away=14, away_reason="leave"), True),
        (member(experienced=True, days_away=15, away_reason="leave"), False),
        (member(experienced=True, days_away=15, away_reason="illness"), False),
        (member(experienced=False, days_on_site=9, days_away=20, away_reason="leave"), False),
    ],
)
def test_rule_p_h7_unacclimatised_who_is_available(solo: object, available: bool) -> None:
    result = _one_member_work(solo)
    assert ("P-H7.unacclimatised" not in ids(result)) is available


def test_rule_p_h7_unacclimatised_low_zone_work_is_legal() -> None:
    result = _one_member_work(member(experienced=False, days_on_site=1), zone=LOW)
    assert "P-H7.unacclimatised" not in ids(result)


def test_rule_p_h7_unacclimatised_juvenile_is_not_available_in_the_ban_season_only() -> None:
    assert "P-H7.unacclimatised" in ids(_one_member_work(member(juvenile=True)))
    assert "P-H7.unacclimatised" not in ids(_one_member_work(member(juvenile=True), day=WINTER))


def test_rule_p_h7_unacclimatised_one_acclimatised_member_is_enough_when_the_rest_is_declared() -> None:
    crew = crew_of(workload="light", members=(member(), member(experienced=False, days_on_site=1)))
    plan = plan_of(by_tick((0, 3, W)), restrictions=("P-H8.ramp", "P-H7.unacclimatised"), restricted_headcount=1)
    assert run_validator(plan, uniform(MEDIUM), crew).passed


def test_rule_p_h7_unacclimatised_no_members_means_everyone_is_acclimatised() -> None:
    result = run_validator(plan_of(by_tick((0, 3, W))), uniform(MEDIUM), crew_of(workload="light", members=None))
    assert result.passed


# ------------------------------------------------------------------------------------------- P-H3 (Art. 18)


def _art18(plan_states: tuple[TickState, ...], *, day: date = WINTER, rules_changes: dict[str, bool] | None = None):  # type: ignore[no-untyped-def]
    rules = with_labour(rules_of(), **rules_changes) if rules_changes else rules_of()
    return run_validator(plan_of(plan_states, local_date=day), uniform(LOW), crew_of(workload="light"), rules=rules)


def test_rule_p_h3_fires_just_after_five_hours() -> None:
    result = _art18(states(("06:00", "11:05", W)))
    violation = only(result, "P-H3")
    _cited(violation, "P-H3")
    assert violation.tick_ranges == ((at("06:00"), at("11:05")),)


def test_rule_p_h3_exactly_five_hours_is_legal() -> None:
    assert "P-H3" not in ids(_art18(states(("06:00", "11:00", W))))


def test_rule_p_h3_adosh_rest_is_not_a_break() -> None:
    result = _art18(states(("06:00", "09:00", W), ("09:00", "10:00", R), ("10:00", "11:05", W)))
    assert only(result, "P-H3").tick_ranges == ((at("06:00"), at("11:05")),)


def test_rule_p_h3_stopped_time_is_not_a_break() -> None:
    result = _art18(states(("06:00", "09:00", W), ("09:00", "10:00", S), ("10:00", "11:05", W)))
    assert "P-H3" in ids(result)


def test_rule_p_h3_a_full_hour_break_splits_the_run() -> None:
    legal = _art18(states(("06:00", "11:00", W), ("11:00", "12:00", B), ("12:00", "17:00", W)))
    assert "P-H3" not in ids(legal)
    short = _art18(states(("06:00", "11:00", W), ("11:00", "11:55", B), ("11:55", "16:55", W)))
    assert only(short, "P-H3").tick_ranges == ((at("06:00"), at("16:55")),)


def test_rule_p_h3_a_break_is_not_part_of_either_run() -> None:
    """Exactly 5 h, a one-hour break, exactly 5 h: both runs are exactly at the limit."""
    legal = _art18(states(("06:00", "11:00", W), ("11:00", "12:00", B), ("12:00", "17:00", S)))
    assert "P-H3" not in ids(legal)


def test_rule_p_h3_off_time_outside_the_ban_is_credited_when_an_hour_long() -> None:
    legal = _art18(states(("06:00", "11:00", W), ("12:00", "17:00", W)))
    assert "P-H3" not in ids(legal)
    short = _art18(states(("06:00", "11:00", W), ("11:55", "16:55", W)))
    assert "P-H3" in ids(short)


def test_rule_p_h3_a_break_next_to_off_time_adds_up() -> None:
    """Half an hour of break and half an hour off form one credited hour (union of credited ticks)."""
    plan_states = states(("06:00", "11:00", W), ("11:00", "11:30", B), ("12:00", "17:00", W))
    assert "P-H3" not in ids(_art18(plan_states))


@pytest.mark.parametrize("gap", [OFF_, BAN])
def test_rule_p_h3_the_ban_gap_is_not_a_break(gap: TickState) -> None:
    plan_states = states(("07:30", "12:30", W), ("12:30", "15:00", gap), ("15:00", "15:05", W))
    result = _art18(plan_states, day=SUMMER)
    assert only(result, "P-H3").tick_ranges == ((at("07:30"), at("15:05")),)
    legal = _art18(states(("07:30", "12:30", W), ("12:30", "15:00", gap)), day=SUMMER)
    assert "P-H3" not in ids(legal)


def test_rule_p_h3_off_time_before_the_ban_credits_and_the_l1_shape_is_legal() -> None:
    """11:00-12:30 is outside the ban window, so the 18 off ticks credit as a break (the shape of L1)."""
    plan_states = states(("06:00", "11:00", W), ("15:00", "18:00", W))
    assert "P-H3" not in ids(_art18(plan_states, day=SUMMER))


def test_rule_p_h3_switches_are_read_not_hard_coded() -> None:
    ban_gap = states(("07:30", "12:30", W), ("12:30", "15:00", BAN), ("15:00", "15:05", W))
    assert "P-H3" in ids(_art18(ban_gap, day=SUMMER))
    assert "P-H3" not in ids(_art18(ban_gap, day=SUMMER, rules_changes={"art18_ban_gap_counts_as_break": True}))
    rest = states(("06:00", "09:00", W), ("09:00", "10:00", R), ("10:00", "11:05", W))
    assert "P-H3" in ids(_art18(rest))
    assert "P-H3" not in ids(_art18(rest, rules_changes={"art18_adosh_rest_counts_as_break": True}))


# ------------------------------------------------------------------------------ P-H2 (hours, shift-inherent)


def _hours(ticks: int, days: int, *, kind: TickState = W):  # type: ignore[no-untyped-def]
    plan = plan_of(by_tick((at("06:00"), at("06:00") + ticks, kind)), local_date=WINTER)
    return run_validator(plan, uniform(LOW), crew_of(workload="light", days_per_week=days))


@pytest.mark.parametrize(
    ("days", "ticks", "fires"),
    [
        (6, 96, False),  # 8 h x 6 days: exactly the weekly and 3-weekly limits
        (6, 97, True),
        (5, 96, False),
        (5, 97, False),  # over 8 h but 5 x 3 x 8.08 = 121 <= 144
        (5, 115, False),  # 5 x 3 x 9.583 = 143.75 <= 144
        (5, 116, True),  # 5 x 3 x 9.667 = 145 > 144
        (4, 120, False),  # exactly 10 h, 4 x 3 x 10 = 120 <= 144
        (4, 121, True),  # over 10 h is always a violation
        (7, 97, True),
    ],
)
def test_rule_p_h2_daily_boundaries(days: int, ticks: int, fires: bool) -> None:
    result = _hours(ticks, days)
    assert ("P-H2.daily" in ids(result)) is fires
    if fires:
        violation = only(result, "P-H2.daily")
        _cited(violation, "P-H2.daily")
        assert violation.tick_ranges == ((at("06:00"), at("06:00") + ticks),)


@pytest.mark.parametrize(
    ("days", "ticks", "fires"),
    [(6, 96, False), (6, 97, True), (5, 115, False), (5, 116, True), (4, 144, False), (4, 145, True)],
)
def test_rule_p_h2_weekly_boundaries(days: int, ticks: int, fires: bool) -> None:
    result = _hours(ticks, days)
    assert ("P-H2.weekly" in ids(result)) is fires
    if fires:
        _cited(only(result, "P-H2.weekly"), "P-H2.weekly")


@pytest.mark.parametrize(
    ("kind", "counted"),
    [(W, True), (R, True), (S, True), (B, False), (BAN, False), (OFF_, False)],
)
def test_rule_p_h2_attendance_is_work_adosh_rest_and_stopped(kind: TickState, counted: bool) -> None:
    """96 ticks of work plus one tick of ``kind``: only a counted kind pushes a 6-day week over 48 h."""
    plan = plan_of(
        by_tick((at("06:00"), at("06:00") + 96, W), (at("06:00") + 96, at("06:00") + 97, kind)), local_date=WINTER
    )
    result = run_validator(plan, uniform(LOW), crew_of(workload="light", days_per_week=6))
    assert ("P-H2.weekly" in ids(result)) is counted


# ------------------------------------------------------------------------------------------- P-H5 (juveniles)


def _juvenile(plan_states: tuple[TickState, ...], *, day: date = WINTER) -> ValidationResult:
    crew = crew_of(workload="light", members=(member(juvenile=True), member()))
    plan = plan_of(plan_states, local_date=day, restrictions=("P-H5.hours",), restricted_headcount=1)
    return run_validator(plan, uniform(LOW), crew)


def test_rule_p_h5_window_fires_outside_07_to_19() -> None:
    early = _juvenile(by_tick((at("06:55"), at("07:00"), W)))
    violation = only(early, "P-H5.window")
    _cited(violation, "P-H5.window")
    assert violation.tick_ranges == ((at("06:55"), at("07:00")),)
    late = _juvenile(by_tick((at("19:00"), at("19:05"), W)))
    assert only(late, "P-H5.window").tick_ranges == ((at("19:00"), at("19:05")),)


def test_rule_p_h5_window_boundary_legal() -> None:
    assert "P-H5.window" not in ids(_juvenile(by_tick((at("07:00"), at("19:00"), S))))


def test_rule_p_h5_hours_fires_over_six_hours() -> None:
    legal = _juvenile(by_tick((at("07:00"), at("07:00") + 72, W)))
    assert "P-H5.hours" not in ids(legal)
    over = _juvenile(by_tick((at("07:00"), at("07:00") + 73, W)))
    violation = only(over, "P-H5.hours")
    _cited(violation, "P-H5.hours")
    assert violation.tick_ranges == ((at("07:00"), at("07:00") + 73),)


def test_rule_p_h5_run_fires_over_four_hours() -> None:
    legal = _juvenile(by_tick((at("07:00"), at("07:00") + 48, W)))
    assert "P-H5.run" not in ids(legal)
    over = _juvenile(by_tick((at("07:00"), at("07:00") + 49, W)))
    violation = only(over, "P-H5.run")
    _cited(violation, "P-H5.run")
    assert violation.tick_ranges == ((at("07:00"), at("07:00") + 49),)


def test_rule_p_h5_run_is_split_by_a_credited_break() -> None:
    split = _juvenile(
        by_tick((at("07:00"), at("11:00"), W), (at("11:00"), at("12:00"), B), (at("12:00"), at("14:00"), W))
    )
    assert "P-H5.run" not in ids(split)


def test_rule_p_h5_declared_restriction_is_required_in_the_ban_season() -> None:
    crew = crew_of(workload="light", members=(member(juvenile=True), member()))
    plan = plan_of(by_tick((at("07:00"), at("08:00"), S)), local_date=SUMMER)
    missing = run_validator(plan, uniform(LOW), crew)
    assert "P-H5.hours" in ids(missing)
    declared = plan_of(
        by_tick((at("07:00"), at("08:00"), S)), local_date=SUMMER, restrictions=("P-H5.hours",), restricted_headcount=1
    )
    assert "P-H5.hours" not in ids(run_validator(declared, uniform(LOW), crew))
    winter = plan_of(by_tick((at("07:00"), at("08:00"), S)), local_date=WINTER)
    assert "P-H5.hours" not in ids(run_validator(winter, uniform(LOW), crew))


def test_rule_p_h5_is_not_evaluated_without_a_juvenile() -> None:
    result = run_validator(plan_of(by_tick((at("06:00"), at("06:05"), S))), uniform(LOW), crew_of())
    assert not [r for r in result.checked_rules if r.startswith("P-H5")]
    assert result.passed


# ------------------------------------------------------------------------------- people rules (declared)


def _declaration(members: tuple[object, ...], restrictions: tuple[str, ...], headcount: int, workload: str = "heavy"):  # type: ignore[no-untyped-def]
    crew = crew_of(workload=workload, members=members)  # type: ignore[arg-type]
    plan = plan_of(by_tick((0, 3, W)), restrictions=restrictions, restricted_headcount=headcount)
    return run_validator(plan, uniform(LOW), crew)


def test_rule_p_h8_ramp_missing_declaration_fires() -> None:
    result = _declaration((member(experienced=False, days_on_site=2),) + (member(),) * 3, (), 0)
    violation = first(result, "P-H8.ramp")
    _cited(violation, "P-H8.ramp")
    assert violation.tick_ranges == ((0, 3),)
    assert "declare" in violation.detail.lower()
    assert len([v for v in result.violations if v.rule_id == "P-H8.ramp"]) == 2  # the declaration and the headcount


@pytest.mark.parametrize(
    ("solo", "flagged"),
    [
        (member(experienced=False, days_on_site=4), True),  # 80 %
        (member(experienced=False, days_on_site=5), False),  # 100 %
        (member(experienced=True, days_on_site=3), True),  # 80 %
        (member(experienced=True, days_on_site=4), False),  # 100 %
        (member(experienced=True, days_on_site=1), True),  # 50 %
        (member(days_away=3, away_reason="leave", days_on_site=1), False),  # lt4: 100 %
        (member(days_away=4, away_reason="leave", days_on_site=1), True),  # 4-5: 80 %
        (member(days_away=4, away_reason="leave", days_on_site=2), False),  # 4-5 day 2: 100 %
        (member(days_away=10, away_reason="leave", days_on_site=1), True),  # 6-12: 80 %
        (member(days_away=10, away_reason="leave", days_on_site=3), False),  # past the two ramp days
        (member(days_away=25, away_reason="leave", days_on_site=3), True),  # gt20 day 3: 80 %
        (member(days_away=1, away_reason="illness", days_on_site=1), True),  # illness 1-3 d is the 4-5 row
        (member(days_away=0, away_reason="illness", days_on_site=30), False),
    ],
)
def test_rule_p_h8_ramp_who_is_flagged(solo: object, flagged: bool) -> None:
    missing = _declaration((solo,), (), 0, workload="light")
    assert ("P-H8.ramp" in ids(missing)) is flagged
    declared = _declaration((solo,), ("P-H8.ramp", "P-H7.unacclimatised"), 1, workload="light")
    assert "P-H8.ramp" not in ids(declared)


def test_rule_p_h8_heavy7_fires_before_day_seven_on_a_heavy_workload() -> None:
    day6 = member(experienced=False, days_on_site=6)  # acclimatised and at 100 %, but before day 7
    result = _declaration((day6,), (), 0)
    violation = first(result, "P-H8.heavy7")
    _cited(violation, "P-H8.heavy7")
    assert violation.tick_ranges == ((0, 3),)
    assert ids(result) == {"P-H8.heavy7"}


def test_rule_p_h8_heavy7_boundary_legal() -> None:
    assert ids(_declaration((member(experienced=False, days_on_site=7),), (), 0)) == set()
    assert ids(_declaration((member(experienced=False, days_on_site=6),), (), 0, workload="moderate")) == set()
    assert ids(_declaration((member(experienced=False, days_on_site=6),), (), 0, workload="light")) == set()
    declared = _declaration((member(experienced=False, days_on_site=6),), ("P-H8.heavy7",), 1)
    assert ids(declared) == set()


def test_rule_p_h8_heavy7_applies_to_returning_members_too() -> None:
    returning = member(days_away=4, away_reason="leave", days_on_site=5)  # 4-5 row, 100 % on day 5, before day 7
    assert ids(_declaration((returning,), (), 0)) == {"P-H8.heavy7"}
    short_leave = member(days_away=3, away_reason="leave", days_on_site=5)  # R-Y: the lt4 row is a full share
    assert ids(_declaration((short_leave,), (), 0)) == set()
    short_leave_day1 = member(days_away=2, away_reason="leave", days_on_site=1)
    assert "P-H8.heavy7" not in ids(_declaration((short_leave_day1,), (), 0))
    illness = member(days_away=1, away_reason="illness", days_on_site=5)  # illness 1-3 d is the 4-5 row
    assert ids(_declaration((illness,), (), 0)) == {"P-H8.heavy7"}
    experienced_and_here = member(days_on_site=2)
    assert ids(_declaration((experienced_and_here,), (), 0)) == {"P-H8.ramp"}  # 60 %, but not new nor returning


def test_declared_restrictions_need_a_large_enough_restricted_headcount() -> None:
    two_new = (member(experienced=False, days_on_site=2),) * 2 + (member(),) * 10
    ok = _declaration(two_new, ("P-H8.ramp", "P-H8.heavy7", "P-H7.unacclimatised"), 2)
    assert ok.passed
    short = _declaration(two_new, ("P-H8.ramp", "P-H8.heavy7", "P-H7.unacclimatised"), 1)
    violation = only(short, "P-H8.ramp")  # the first required id carries the headcount shortfall
    assert "restricted_headcount" in violation.detail
    assert ids(short) == {"P-H8.ramp"}


def test_demo_crew_a_declaration_shape() -> None:
    """crew-a: 12 heavy members, 2 new at day 2: ramp, heavy-7 and unacclimatised, restricted headcount 2."""
    crew_a = (member(experienced=False, days_on_site=2),) * 2 + (member(),) * 10
    missing = _declaration(crew_a, (), 0)
    assert ids(missing) == {"P-H8.ramp", "P-H8.heavy7", "P-H7.unacclimatised"}
    assert _declaration(crew_a, ("P-H8.ramp", "P-H8.heavy7", "P-H7.unacclimatised"), 2).passed


def test_demo_crew_c_declaration_shape() -> None:
    """crew-c: moderate, 9 members, 1 returning after 10 days of leave: ramp only (moderate is not heavy)."""
    crew_c = (member(days_away=10, away_reason="leave", days_on_site=1),) + (member(),) * 8
    assert ids(_declaration(crew_c, (), 0, workload="moderate")) == {"P-H8.ramp"}
    assert _declaration(crew_c, ("P-H8.ramp",), 1, workload="moderate").passed


def test_unacclimatised_declaration_names_the_work_it_covers() -> None:
    crew = (member(experienced=False, days_on_site=1), member())
    plan = plan_of(by_tick((0, 3, W)), restrictions=("P-H8.ramp", "P-H8.heavy7"), restricted_headcount=1)
    result = run_validator(plan, uniform(MEDIUM), crew_of(workload="light", members=crew))
    violation = only(result, "P-H7.unacclimatised")
    assert violation.tick_ranges == ((0, 3),)
    assert "declare" in violation.detail.lower()


# --------------------------------------------------------------------------------------------- P-H10 (no added)


def test_rule_p_h10_fires_outside_the_published_shift() -> None:
    plan = plan_of(by_tick((at("10:55"), at("11:05"), W)), local_date=WINTER)
    result = run_validator(plan, uniform(LOW), crew_of(workload="light"), published_shift=L1)
    violation = only(result, "P-H10")
    _cited(violation, "P-H10")
    assert violation.tick_ranges == ((at("11:00"), at("11:05")),)


def test_rule_p_h10_boundary_legal_and_needs_a_published_shift() -> None:
    inside = plan_of(states(("06:00", "11:00", W), ("15:00", "18:00", W)), local_date=WINTER)
    assert "P-H10" not in ids(run_validator(inside, uniform(LOW), crew_of(workload="light"), published_shift=L1))
    outside = plan_of(by_tick((at("11:00"), at("11:05"), W)), local_date=WINTER)
    unchecked = run_validator(outside, uniform(LOW), crew_of(workload="light"), published_shift=None)
    assert "P-H10" not in unchecked.checked_rules
    assert "P-H10" not in ids(unchecked)


def test_rule_p_h10_rest_outside_the_shift_is_not_added_work() -> None:
    plan = plan_of(states(("11:00", "11:30", S), ("06:00", "11:00", W)), local_date=WINTER)
    result = run_validator(plan, uniform(LOW), crew_of(workload="light"), published_shift=L1)
    assert "P-H10" not in ids(result)


def test_rule_p_h10_second_block_and_shifted_blocks() -> None:
    shifted = (L1[0], ShiftBlock(L1[1].start.replace(minute=30), L1[1].end.replace(minute=30)))
    plan = plan_of(states(("15:30", "18:30", W)), local_date=WINTER)
    ok = run_validator(plan, uniform(LOW), crew_of(workload="light"), published_shift=shifted)
    assert "P-H10" not in ids(ok)
    bad = run_validator(plan, uniform(LOW), crew_of(workload="light"), published_shift=L1)
    assert only(bad, "P-H10").tick_ranges == ((at("18:00"), at("18:30")),)


# ------------------------------------------------------------------------------------ result shape and errors


def test_checked_rules_listed_when_passing() -> None:
    result = run_validator(plan_of(states()), uniform(LOW))
    assert result.passed
    assert result.violations == ()
    assert result.checked_rules == (
        "P-H1",
        "P-H7.cap60",
        "P-H7.run",
        "STOP.red",
        "P-H7.lone",
        "P-H7.unacclimatised",
        "P-H3",
        "P-H2.daily",
        "P-H2.weekly",
        "P-H8.ramp",
        "P-H8.heavy7",
    )


def test_checked_rules_add_p_h10_and_the_juvenile_rules_when_they_apply() -> None:
    crew = crew_of(members=(member(juvenile=True),))
    result = run_validator(
        plan_of(states(), restrictions=("P-H5.hours",), restricted_headcount=1), uniform(LOW), crew, published_shift=L1
    )
    assert {"P-H10", "P-H5.window", "P-H5.hours", "P-H5.run"} <= set(result.checked_rules)
    assert result.passed


def test_shift_and_plan_violations_partition_the_result() -> None:
    assert frozenset({"P-H2.daily", "P-H2.weekly", "P-H5.hours", "P-H5.run", "P-H5.window"}) == SHIFT_RULES
    plan = plan_of(by_tick((at("06:00"), at("06:00") + 97, W)), local_date=WINTER)
    result = run_validator(plan, uniform(MEDIUM), crew_of(workload="heavy", days_per_week=6))
    assert {"P-H2.daily", "P-H2.weekly", "P-H3", "P-H7.run"} <= ids(result)
    assert {v.rule_id for v in result.shift_violations} == {"P-H2.daily", "P-H2.weekly"}
    assert {v.origin for v in result.shift_violations} == {"shift"}
    assert result.plan_violations
    assert {v.origin for v in result.plan_violations} == {"plan"}
    assert {v.rule_id for v in result.plan_violations}.isdisjoint(SHIFT_RULES)
    assert set(result.shift_violations) | set(result.plan_violations) == set(result.violations)
    assert len(result.shift_violations) + len(result.plan_violations) == len(result.violations)


def _six_hours_five() -> tuple[TickState, ...]:
    """73 ticks of attendance (6 h 05 min) split by a credited hour so that only the juvenile hours rule is over."""
    return by_tick((at("07:00"), at("10:00"), S), (at("10:00"), at("11:00"), B), (at("11:00"), at("11:00") + 37, S))


def test_a_missing_juvenile_declaration_is_plan_origin_although_its_id_is_a_shift_rule() -> None:
    """R-Z: the partition follows ``origin``. A shift-origin P-H5.hours and a plan-origin one can coexist."""
    crew = crew_of(workload="light", members=(member(juvenile=True), member()))
    undeclared = plan_of(by_tick((at("07:00"), at("08:00"), S)), local_date=SUMMER)
    result = run_validator(undeclared, uniform(LOW), crew)
    missing = first(result, "P-H5.hours")
    assert missing.origin == "plan"
    assert "P-H5.hours" in SHIFT_RULES
    assert missing in result.plan_violations
    assert result.shift_violations == ()
    # the same id, from the shift itself (73 ticks = 6 h 05 min), with the declaration present
    declared = plan_of(
        _six_hours_five(),
        local_date=SUMMER,
        restrictions=("P-H5.hours",),
        restricted_headcount=1,
    )
    over = run_validator(declared, uniform(LOW), crew)
    assert [v.origin for v in over.violations if v.rule_id == "P-H5.hours"] == ["shift"]
    assert over.plan_violations == ()
    # both at once
    both = run_validator(plan_of(_six_hours_five(), local_date=SUMMER), uniform(LOW), crew)
    assert sorted(v.origin for v in both.violations if v.rule_id == "P-H5.hours") == [
        "plan",
        "plan",
        "shift",
    ]  # missing declaration, headcount shortfall, 6 h 05 min


@pytest.mark.parametrize("rule_id", ["P-H5.window", "P-H5.hours", "P-H5.run", "P-H2.daily", "P-H2.weekly"])
def test_shift_rules_report_shift_origin_when_they_come_from_the_shift(rule_id: str) -> None:
    crew = crew_of(workload="light", members=(member(juvenile=True), member()))
    plan = plan_of(
        by_tick((at("06:00"), at("06:00") + 145, S)),
        local_date=WINTER,
        restrictions=("P-H5.hours",),
        restricted_headcount=1,
    )
    result = run_validator(plan, uniform(LOW), crew)
    assert {v.origin for v in result.violations if v.rule_id == rule_id} == {"shift"}


def test_a_clean_result_has_empty_partitions() -> None:
    result = run_validator(plan_of(states()), uniform(LOW))
    assert result.shift_violations == ()
    assert result.plan_violations == ()


def test_a_missing_clause_is_an_error_not_a_blank_citation() -> None:
    clauses = {k: v for k, v in clauses_of().items() if k != "P-H3"}
    with pytest.raises(MissingClauseError, match="P-H3"):
        validate_plan(plan_of(states()), uniform(LOW), crew_of(), rules_of(), clauses, published_shift=None)


def test_a_plan_of_the_wrong_length_is_an_error() -> None:
    short = dataclasses.replace(plan_of(states()), states=states()[:-1])
    with pytest.raises(ValueError, match="216"):
        run_validator(short, uniform(LOW))
    with pytest.raises(ValueError, match="216"):
        run_validator(plan_of(states()), ZoneTimeline.from_zones(START_UTC, [LOW] * 100))


def test_a_plan_on_another_clock_than_its_timeline_is_an_error() -> None:
    other = ZoneTimeline.from_zones(START_UTC.replace(hour=1), [LOW] * TICKS)
    with pytest.raises(ValueError, match="start"):
        run_validator(plan_of(states()), other)


def test_the_grid_constant_is_the_day_grid_of_the_ticks_module() -> None:
    assert len(day_ticks(SUMMER, ZoneInfo("Asia/Dubai"))) == TICKS


def test_the_b0_common_roster_violates_its_own_hours() -> None:
    """B0 (06:00-12:30 + 15:00-17:00, 8.5 h on a 6-day week) breaks the hours rules in its raw roster text."""
    rules = rules_of()
    segments = parse_roster("06:00-12:30 work\n15:00-17:00 work")
    plan = plan_from_segments(segments, local_date=SUMMER, tz=ZoneInfo("Asia/Dubai"), labour=rules.labour)
    result = run_validator(plan, uniform(MEDIUM), crew_of(workload="heavy", headcount=20, shift=B0))
    assert {"P-H3", "P-H2.daily", "P-H7.run"} <= ids(result)
    assert "P-H2.weekly" in ids(result)
    assert "P-H1" not in ids(result)
