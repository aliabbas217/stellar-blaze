import dataclasses
import math
import random
from datetime import date, time

import pytest

from stellar_blaze.domain.planner.rule_planner import plan_crew
from stellar_blaze.domain.plans.model import CrewMember, CrewPlan, ShiftBlock, TickState, ZoneTimeline
from stellar_blaze.domain.plans.ticks import fallback_timeline
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
    block,
    cap_minutes,
    crew,
    idx,
    rest_minutes,
    rules,
    run_limit_minutes,
    spans,
    timeline,
    window_violations,
    zones_from,
)
from tests.unit.risk.support import released_ruleset

pytestmark = pytest.mark.unit

W = TickState.WORK
R = TickState.ADOSH_REST
A18 = TickState.ART18_BREAK


def _plan(
    zones: list[Zone], *, shift: tuple[ShiftBlock, ...] = L1, workload: str = "heavy", day: date = JULY
) -> CrewPlan:
    plan = plan_crew(crew(shift, workload=workload), timeline(day, zones), rules(), local_date=day, tz=TZ)
    assert all_violations(plan, zones, shift, day, workload) == []
    return plan


def test_oracle_tables_match_rules() -> None:
    r = rules()
    for zone in Zone:
        for workload in ("light", "moderate", "heavy"):
            assert cap_minutes(zone, workload) == r.cap_minutes(zone, workload)
            cycle = r.cycle(zone, workload)
            assert run_limit_minutes(zone, workload) == (None if cycle is None else cycle[0])
            assert rest_minutes(zone, workload) == (0 if cycle is None else cycle[1])


def test_all_high_heavy_l1() -> None:
    plan = _plan([Zone.HIGH] * TICKS)
    assert spans(plan, W) == [
        ("06:00", "06:20"),
        ("07:00", "07:20"),
        ("08:00", "08:20"),
        ("09:00", "09:20"),
        ("10:00", "10:20"),
        ("15:00", "15:20"),
        ("16:00", "16:20"),
        ("17:00", "17:20"),
    ]
    assert plan.work_minutes == 160
    assert plan.adosh_rest_minutes == 320
    assert plan.status == "rule"


def test_all_medium_heavy_l1() -> None:
    plan = _plan([Zone.MEDIUM] * TICKS)
    assert plan.work_minutes == 360  # 45 / 15, five morning runs and three evening runs
    assert spans(plan, W)[0] == ("06:00", "06:45")


def test_all_low_l1() -> None:
    plan = _plan([Zone.LOW] * TICKS)
    assert plan.work_minutes == 480
    assert plan.adosh_rest_minutes == 0
    assert block(plan, "06:00", "11:00") == {W}
    assert block(plan, "15:00", "18:00") == {W}


def test_all_red_stops_everything() -> None:
    plan = _plan([Zone.RED] * TICKS)
    assert plan.stopped_minutes == 480
    assert plan.work_minutes == 0
    assert "STOP.red" in plan.rule_ids


def test_worsening_cuts_work() -> None:
    zones = zones_from(Zone.MEDIUM, ("06:30", Zone.HIGH))
    plan = _plan(zones)
    # every window holding a tick at or after 06:30 touches High, so the first hour allows 20 minutes of work
    assert spans(plan, W)[:3] == [("06:00", "06:20"), ("07:00", "07:20"), ("08:00", "08:20")]
    assert block(plan, "06:20", "07:00") == {R}


def test_rest_never_shortened_on_easing() -> None:
    zones = zones_from(Zone.HIGH, ("06:30", Zone.MEDIUM))
    plan = _plan(zones)
    assert block(plan, "06:00", "06:20") == {W}
    assert block(plan, "06:20", "07:00") == {R}  # the 40-minute High rest is kept whole
    # the window of 06:25 still touches High, so only 20 minutes may be worked before 07:25; then the Medium rest
    assert spans(plan, W)[:3] == [("06:00", "06:20"), ("07:00", "07:20"), ("07:35", "08:20")]
    assert block(plan, "07:20", "07:35") == {R}


def test_lookahead_limits_work_before_a_worse_zone() -> None:
    zones = zones_from(Zone.MEDIUM, ("07:00", Zone.HIGH))
    plan = _plan(zones)
    # the windows starting 06:05..07:00 touch High (cap 20); the 06:00 window does not (cap 45)
    assert block(plan, "06:00", "06:25") == {W}
    assert block(plan, "06:25", "07:05") == {R}
    work_0605_0705 = sum(s is W for s in plan.states[idx("06:05") : idx("07:05")])
    assert work_0605_0705 * 5 <= 20


def test_red_does_not_cap_neighbouring_windows() -> None:
    medium = _plan([Zone.MEDIUM] * TICKS)
    zones = zones_from(Zone.MEDIUM, ("08:00", Zone.RED), ("09:00", Zone.MEDIUM))
    plan = _plan(zones)
    assert plan.states[: idx("08:00")] == medium.states[: idx("08:00")]  # the Medium work before the Red hour
    assert block(plan, "08:00", "09:00") == {TickState.STOPPED}
    assert plan.states[idx("09:00")] is W
    assert plan.stopped_minutes == 60


def test_cap_blocks_do_not_break_run_or_rest_rules() -> None:
    # a High tick that leaves the windows late blocks work for single ticks; run limit and full rests must still hold
    zones = zones_from(Zone.HIGH, ("06:30", Zone.MEDIUM), ("10:00", Zone.HIGH), ("10:35", Zone.MEDIUM))
    assert window_violations(_plan(zones), zones, L1, JULY, "heavy") == []  # (_plan already runs every oracle)


def test_moderate_uses_the_heavy_column() -> None:
    assert _plan([Zone.HIGH] * TICKS, workload="moderate").work_minutes == 160


def test_light_high_is_45_15() -> None:
    plan = _plan([Zone.HIGH] * TICKS, workload="light")
    assert spans(plan, W)[0] == ("06:00", "06:45")
    assert plan.work_minutes == 360


def test_light_medium_is_self_paced() -> None:
    assert _plan([Zone.MEDIUM] * TICKS, workload="light").work_minutes == 480


def test_art18_exactly_five_hours() -> None:
    plan = _plan([Zone.LOW] * TICKS, shift=(ShiftBlock(L1[0].start, L1[0].end),))
    assert plan.art18_minutes == 0
    assert plan.work_minutes == 300


def test_art18_five_hours_five_minutes_needs_a_break() -> None:
    shift = (ShiftBlock(L1[0].start, time(11, 5)),)
    plan = _plan([Zone.LOW] * TICKS, shift=shift)
    assert plan.art18_minutes == 60
    assert plan.work_minutes == 245
    assert "P-H3" in plan.rule_ids


def test_art18_break_at_hottest_hour() -> None:
    twl = [150.0] * TICKS
    for i in range(idx("09:30"), idx("10:30")):
        twl[i] = 100.0
    zones = [Zone.LOW] * TICKS
    plan = plan_crew(crew(B0), timeline(JULY, zones, twl=twl), rules(), local_date=JULY, tz=TZ)
    assert spans(plan, A18) == [("09:30", "10:30")]  # the ban gap is not credited; 06:00-09:30 and 10:30-17:00 <= 5 h
    assert plan.art18_minutes == 60
    assert all_violations(plan, zones, B0, JULY, "heavy") == []


def test_art18_ties_and_missing_twl_take_the_earliest_valid_placement() -> None:
    zones = [Zone.LOW] * TICKS
    for twl in ([150.0] * TICKS, [math.nan] * TICKS):
        plan = plan_crew(crew(B0), timeline(JULY, zones, twl=twl), rules(), local_date=JULY, tz=TZ)
        # 102 attendance ticks: at most 60 on each side of the break -> the earliest start is 08:30
        assert spans(plan, A18) == [("08:30", "09:30")]


def test_art18_ban_gap_is_not_credited_but_a_non_ban_gap_is() -> None:
    zones = [Zone.LOW] * TICKS
    july = _plan(zones, shift=B0, day=JULY)
    october = _plan(zones, shift=B0, day=OCTOBER)
    assert july.art18_minutes == 60  # 6.5 h + 2 h with the ban gap not credited: one break
    assert october.art18_minutes == 60  # the 2.5 h gap is credited, so only the 6.5 h morning needs its break
    assert spans(october, A18)[0][1] <= "12:30"
    assert _plan(zones, shift=L1, day=OCTOBER).art18_minutes == 0  # a 4 h gap outside the ban is credited
    assert _plan(zones, shift=L1, day=JULY).art18_minutes == 0  # 11:00-12:30 is 90 min outside the ban


def test_art18_short_gap_is_not_a_break() -> None:
    shift = (
        ShiftBlock(L1[0].start, L1[0].end),
        ShiftBlock(time(11, 30), time(14, 30)),
    )
    plan = _plan([Zone.LOW] * TICKS, shift=shift, day=OCTOBER)  # 5 h + 3 h separated by 30 minutes
    assert plan.art18_minutes == 60


def test_art18_long_day_needs_two_breaks() -> None:
    shift = (ShiftBlock(time(5, 0), time(20, 0)),)
    plan = _plan([Zone.LOW] * TICKS, shift=shift, day=OCTOBER)  # 15 h of attendance
    assert plan.art18_minutes == 120


def test_art18_unplaceable_break_raises() -> None:
    # blocks of 10 minutes separated by 5: no 12 consecutive attendance ticks exist in a run of more than 5 h
    shift = tuple(
        ShiftBlock(time(5 + m // 60, m % 60), time(5 + (m + 10) // 60, (m + 10) % 60)) for m in range(0, 600, 15)
    )
    with pytest.raises(ValueError, match=r"Art\. 18"):
        plan_crew(crew(shift), timeline(OCTOBER, [Zone.LOW] * TICKS), rules(), local_date=OCTOBER, tz=TZ)


def test_ban_window_local() -> None:
    shift = (ShiftBlock(L1[0].start, time(18, 0)),)
    july = _plan([Zone.LOW] * TICKS, shift=shift, day=JULY)
    assert spans(july, TickState.BAN) == [("12:30", "15:00")]
    october = _plan([Zone.LOW] * TICKS, shift=shift, day=OCTOBER)
    assert spans(october, TickState.BAN) == []
    assert "P-H1" in july.rule_ids
    assert "P-H1" not in october.rule_ids
    assert block(plan=july, start="12:30", end="15:00") == {TickState.BAN}


def test_ban_season_edges_are_inclusive_local_dates() -> None:
    shift = (ShiftBlock(L1[0].start, time(18, 0)),)
    for day, banned in (
        (date(2026, 6, 14), False),
        (date(2026, 6, 15), True),
        (date(2026, 9, 15), True),
        (date(2026, 9, 16), False),
    ):
        plan = _plan([Zone.LOW] * TICKS, shift=shift, day=day)
        assert (TickState.BAN in plan.states) is banned, day


def test_off_outside_the_shift_and_ticks_outside_the_grid_shift_edges() -> None:
    plan = _plan([Zone.LOW] * TICKS)
    assert block(plan, "04:00", "06:00") == {TickState.OFF}
    assert block(plan, "11:00", "15:00") == {TickState.OFF}  # 12:30-15:00 is outside the shift: OFF wins over BAN
    assert block(plan, "18:00", "22:00") == {TickState.OFF}
    assert len(plan.states) == TICKS


def test_lone_work_stops() -> None:
    plan = plan_crew(crew(headcount=1), timeline(JULY, [Zone.MEDIUM] * TICKS), rules(), local_date=JULY, tz=TZ)
    assert plan.work_minutes == 0
    assert plan.stopped_minutes == 480
    assert "P-H7.lone" in plan.rule_ids
    low = plan_crew(crew(headcount=1), timeline(JULY, [Zone.LOW] * TICKS), rules(), local_date=JULY, tz=TZ)
    assert low.work_minutes == 480  # lone work is only barred in Medium and High


def _member(**changes: object) -> CrewMember:
    base = CrewMember(days_on_site=30, days_away=0, away_reason="none", experienced=True, juvenile=False)
    return dataclasses.replace(base, **changes)  # type: ignore[arg-type]


def test_unacclimatised_restricted() -> None:
    members = (_member(days_on_site=2), _member(days_on_site=2))
    plan = plan_crew(
        crew(members=members, headcount=2), timeline(JULY, [Zone.LOW] * TICKS), rules(), local_date=JULY, tz=TZ
    )
    assert plan.restricted_headcount == 2
    assert "P-H8.ramp" in plan.restrictions
    assert plan.work_minutes == 480  # people rules do not change the tick states in Low


def test_no_acclimatised_member_stops_medium_and_high_only() -> None:
    members = (_member(experienced=False, days_on_site=1), _member(experienced=False, days_on_site=3))
    spec = crew(members=members, headcount=2)
    medium = plan_crew(spec, timeline(JULY, [Zone.MEDIUM] * TICKS), rules(), local_date=JULY, tz=TZ)
    assert medium.work_minutes == 0
    assert "STOP.no_acclimatised" in medium.rule_ids
    assert "P-H7.unacclimatised" in medium.restrictions
    low = plan_crew(spec, timeline(JULY, [Zone.LOW] * TICKS), rules(), local_date=JULY, tz=TZ)
    assert low.work_minutes == 480
    assert low.restricted_headcount == 2


def test_one_acclimatised_member_is_lone_work() -> None:
    members = (_member(), _member(experienced=False, days_on_site=1))
    plan = plan_crew(
        crew(members=members, headcount=2), timeline(JULY, [Zone.HIGH] * TICKS), rules(), local_date=JULY, tz=TZ
    )
    assert plan.work_minutes == 0
    assert "P-H7.lone" in plan.rule_ids


def test_restrictions_cover_heavy7_returning_and_juveniles() -> None:
    members = (
        _member(experienced=False, days_on_site=6),  # new, ramp done (100%), but heavy work needs 7 days
        _member(days_on_site=3, days_away=25, away_reason="leave"),  # back after 25 days: unacclimatised
        _member(juvenile=True),
        _member(),
    )
    spec = crew(members=members, headcount=4)
    plan = plan_crew(spec, timeline(JULY, [Zone.LOW] * TICKS), rules(), local_date=JULY, tz=TZ)
    assert plan.restricted_headcount == 3  # the first three; the fourth has no restriction
    assert plan.restrictions == ("P-H5.ban_season", "P-H7.unacclimatised", "P-H8.heavy7", "P-H8.ramp")
    assert "P-H5.hours" not in plan.restrictions  # the juvenile 6-hour rule is a different rule (R-AC)
    october = plan_crew(spec, timeline(OCTOBER, [Zone.LOW] * TICKS), rules(), local_date=OCTOBER, tz=TZ)
    assert october.restricted_headcount == 2  # juveniles are excluded only in the ban season
    light = plan_crew(
        crew(members=members, headcount=4, workload="light"),
        timeline(OCTOBER, [Zone.LOW] * TICKS),
        rules(),
        local_date=OCTOBER,
        tz=TZ,
    )
    assert light.restricted_headcount == 1  # only the 25-day returnee (heavy7 is for heavy work)


def test_member_count_must_match_headcount() -> None:
    with pytest.raises(ValueError, match="headcount"):
        plan_crew(
            crew(members=(_member(),), headcount=3), timeline(JULY, [Zone.LOW] * TICKS), rules(), local_date=JULY, tz=TZ
        )


def test_juveniles_do_not_count_toward_the_lone_work_minimum_in_season() -> None:
    members = (_member(), _member(juvenile=True))
    spec = crew(members=members, headcount=2)
    assert plan_crew(spec, timeline(JULY, [Zone.MEDIUM] * TICKS), rules(), local_date=JULY, tz=TZ).work_minutes == 0
    assert (
        plan_crew(spec, timeline(OCTOBER, [Zone.MEDIUM] * TICKS), rules(), local_date=OCTOBER, tz=TZ).work_minutes > 0
    )


def test_fallback_status() -> None:
    plan = plan_crew(crew(), fallback_timeline(JULY, TZ), rules(), local_date=JULY, tz=TZ)
    assert plan.status == "fallback"
    assert plan.work_minutes == 160
    assert "FALLBACK.high" in plan.rule_ids
    flagged = [False] * TICKS
    flagged[idx("07:00")] = True
    one = plan_crew(crew(), timeline(JULY, [Zone.HIGH] * TICKS, fallback=flagged), rules(), local_date=JULY, tz=TZ)
    assert one.status == "fallback"
    off_shift = [False] * TICKS
    off_shift[idx("20:00")] = True  # a fallback tick outside the shift does not matter
    assert (
        plan_crew(
            crew(), timeline(JULY, [Zone.LOW] * TICKS, fallback=off_shift), rules(), local_date=JULY, tz=TZ
        ).status
        == "rule"
    )


def test_crew_lead_stop_raises_ticks_to_red() -> None:
    base = timeline(JULY, [Zone.LOW] * TICKS)
    zones = [Zone.RED if idx("07:00") <= i < idx("07:30") else Zone.LOW for i in range(TICKS)]
    plan = plan_crew(crew(), base.with_zones(zones), rules(), local_date=JULY, tz=TZ)
    assert block(plan, "07:00", "07:30") == {TickState.STOPPED}
    assert plan.stopped_minutes == 30


def test_counters_add_up_to_the_attendance() -> None:
    zones = zones_from(Zone.HIGH, ("09:00", Zone.RED), ("10:00", Zone.LOW))
    plan = _plan(zones)
    attended = 5 * sum(attendance(L1, JULY))
    assert plan.work_minutes + plan.adosh_rest_minutes + plan.art18_minutes + plan.stopped_minutes == attended


def test_timeline_must_match_the_day_grid() -> None:
    with pytest.raises(ValueError, match="216"):
        plan_crew(
            crew(),
            ZoneTimeline.from_zones(timeline(JULY, [Zone.LOW] * TICKS).start_utc, [Zone.LOW] * 10),
            rules(),
            local_date=JULY,
            tz=TZ,
        )
    with pytest.raises(ValueError, match="start"):
        plan_crew(crew(), timeline(JULY, [Zone.LOW] * TICKS), rules(), local_date=date(2026, 7, 2), tz=TZ)


def test_a_shift_block_must_end_after_it_starts() -> None:
    with pytest.raises(ValueError, match="shift"):
        plan_crew(
            crew((ShiftBlock(time(9), time(8)),)), timeline(JULY, [Zone.LOW] * TICKS), rules(), local_date=JULY, tz=TZ
        )


def test_evening_shifted_shift_has_no_break_and_full_low_work() -> None:
    plan = _plan([Zone.LOW] * TICKS, shift=EVENING_SHIFTED)
    assert plan.work_minutes == 480
    assert plan.art18_minutes == 0


# ---- ruling R-AA: the rest after a run is the longer of the last work tick's and the ending attendance tick's cycle


@pytest.mark.parametrize("workload", ["heavy", "moderate"])
def test_rest_follows_the_zone_of_the_last_work_tick_when_the_zone_has_eased(workload: str) -> None:
    # (a) All Medium with High at ticks 54-56 (08:30-08:45): the run 08:35-08:45 worked in High; the cap-blocked tick
    # 08:45 is Medium (3 rest ticks), but the run owes the full High rest (40 minutes = 8 ticks): rest to 09:25.
    zones = zones_from(Zone.MEDIUM)
    for i in (54, 55, 56):
        zones[i] = Zone.HIGH
    plan = plan_crew(crew(L1, workload=workload, headcount=2), timeline(JULY, zones), rules(), local_date=JULY, tz=TZ)
    assert all_violations(plan, zones, L1, JULY, workload) == []
    assert block(plan, "08:35", "08:45") == {W}
    assert block(plan, "08:45", "09:25") == {R}
    assert plan.states[idx("09:25")] is W


def test_rest_follows_the_zone_of_the_tick_that_ended_the_run() -> None:
    # (b) The Low run 07:55-08:00 (self-paced, no rest of its own) is cut at 08:00 where the zone worsens to High; the
    # new cycle's full rest (8 ticks) follows, so no work at 08:05 (an "only the last work tick's zone" rule worked
    # there). The Red stop from 08:25 comes after the rest has started.
    zones = zones_from(Zone.LOW, ("06:15", Zone.HIGH), ("07:00", Zone.LOW), ("08:00", Zone.HIGH), ("08:25", Zone.RED))
    plan = _plan(zones)
    assert block(plan, "07:55", "08:00") == {W}
    assert block(plan, "08:00", "08:25") == {R}


def test_a_red_tick_ending_a_run_contributes_no_rest_of_its_own() -> None:
    # Medium all day, one Red tick at 06:30: the run 06:00-06:30 owes the Medium rest (3 ticks, the Red tick is the
    # first); Red has no cycle, so work resumes at 06:45 and not later.
    zones = zones_from(Zone.MEDIUM)
    zones[idx("06:30")] = Zone.RED
    plan = _plan(zones)
    assert block(plan, "06:30", "06:35") == {TickState.STOPPED}
    assert block(plan, "06:35", "06:45") == {R}
    assert block(plan, "06:45", "07:30") == {W}


def test_an_off_tick_ending_a_run_contributes_no_rest_of_its_own() -> None:
    # A 5-minute OFF gap inside the shift: its zone is High, but OFF contributes nothing, so the Medium run before it
    # owes the Medium rest only (3 ticks, the OFF tick is the first) and work resumes at 06:45.
    shift = (ShiftBlock(time(6, 0), time(6, 30)), ShiftBlock(time(6, 35), time(9, 0)))
    zones = zones_from(Zone.MEDIUM)
    zones[idx("06:30")] = Zone.HIGH
    plan = _plan(zones, shift=shift)
    assert block(plan, "06:30", "06:35") == {TickState.OFF}
    assert block(plan, "06:35", "06:45") == {R}
    assert plan.states[idx("06:45")] is W


def test_the_rest_rule_holds_on_a_seeded_sweep_of_random_days() -> None:
    """1500 reproducible random days (light and heavy, L1 and B0): the oracle's R-AA rest, caps, runs and Art. 18."""
    rng = random.Random(7)  # noqa: S311  (a reproducible test sweep, not security)
    for _ in range(1500):
        zones: list[Zone] = []
        for _segment in range(rng.randint(2, 14)):
            zones += [rng.choice(list(Zone))] * rng.randint(1, 12)
        zones = (zones + [zones[-1]] * TICKS)[:TICKS]
        workload = rng.choice(["light", "heavy"])
        shift = rng.choice([L1, B0])
        plan = plan_crew(crew(shift, workload=workload), timeline(JULY, zones), rules(), local_date=JULY, tz=TZ)
        assert all_violations(plan, zones, shift, JULY, workload) == [], (
            workload,
            shift == L1,
            [z.value for z in zones],
        )


# ---- Feature B review P3 / P4: tick_rules and the no-value Art. 18 window ---------------------------------------


def _rules_of(plan: CrewPlan, state: TickState) -> set[str]:
    return {rule for s, rule in zip(plan.states, plan.tick_rules, strict=True) if s is state}


def test_tick_rules_has_one_clause_id_per_tick_and_is_deterministic() -> None:
    zones = zones_from(Zone.HIGH, ("09:00", Zone.RED), ("10:00", Zone.LOW))
    plan = _plan(zones)
    assert len(plan.tick_rules) == len(plan.states) == TICKS
    assert plan == _plan(zones)


def test_tick_rules_mapping_and_every_id_is_a_ruleset_clause() -> None:
    clauses = released_ruleset().clauses
    assert clauses is not None
    zones = zones_from(Zone.HIGH, ("09:00", Zone.RED), ("10:00", Zone.LOW))
    plan = _plan(zones, shift=(ShiftBlock(time(6, 0), time(18, 0)),))  # the ban 12:30-15:00 and a break are in it
    assert _rules_of(plan, TickState.OFF) == {"P-H10"}
    assert _rules_of(plan, TickState.BAN) == {"P-H1"}
    assert _rules_of(plan, TickState.STOPPED) == {"STOP.red"}
    assert _rules_of(plan, TickState.ART18_BREAK) == {"P-H3"}
    assert _rules_of(plan, TickState.ADOSH_REST) <= {"P-H7.run", "P-H7.cap60"}
    assert _rules_of(plan, TickState.WORK) == {"P-H7.run", "P-H7.cap60"}  # High (cycle) cells, then Low (self-paced)
    assert set(plan.tick_rules) <= set(clauses.entries)
    assert set(plan.rule_ids) <= set(clauses.entries)


def test_work_in_a_cycle_cell_is_run_and_in_a_self_paced_cell_is_cap60() -> None:
    assert _rules_of(_plan([Zone.HIGH] * TICKS), TickState.WORK) == {"P-H7.run"}
    assert _rules_of(_plan([Zone.LOW] * TICKS), TickState.WORK) == {"P-H7.cap60"}
    assert _rules_of(_plan([Zone.MEDIUM] * TICKS, workload="light"), TickState.WORK) == {"P-H7.cap60"}


def test_adosh_rest_is_run_for_cycle_rest_and_cap60_when_only_the_window_cap_blocks() -> None:
    assert _rules_of(_plan([Zone.HIGH] * TICKS), TickState.ADOSH_REST) == {"P-H7.run"}
    # Low zone, no cycle: a tick the window cap blocks (the High hour ahead caps the windows) is cap60 rest
    capped = _plan(zones_from(Zone.LOW, ("07:00", Zone.HIGH)))
    assert _rules_of(capped, TickState.ADOSH_REST) >= {"P-H7.cap60"}


def test_stop_rule_ids_per_tick() -> None:
    lone = plan_crew(crew(headcount=1), timeline(JULY, [Zone.MEDIUM] * TICKS), rules(), local_date=JULY, tz=TZ)
    assert _rules_of(lone, TickState.STOPPED) == {"P-H7.lone"}
    members = (_member(experienced=False, days_on_site=1), _member(experienced=False, days_on_site=3))
    no_acc = plan_crew(
        crew(members=members, headcount=2), timeline(JULY, [Zone.HIGH] * TICKS), rules(), local_date=JULY, tz=TZ
    )
    assert _rules_of(no_acc, TickState.STOPPED) == {"STOP.no_acclimatised"}


def test_fallback_ticks_keep_their_state_id_and_the_plan_keeps_fallback_high() -> None:
    plan = plan_crew(crew(), fallback_timeline(JULY, TZ), rules(), local_date=JULY, tz=TZ)
    assert "FALLBACK.high" in plan.rule_ids
    assert _rules_of(plan, TickState.WORK) == {"P-H7.run"}
    assert "FALLBACK.high" not in plan.tick_rules


def test_art18_break_goes_to_a_window_with_no_twl_value_as_the_hottest() -> None:
    # A fallback hour has no TWL value and is assumed High, so it is the hottest window (protective): it beats a real
    # dip of 100 W/m2 elsewhere in the feasible start range (08:30-11:00).
    twl = [150.0] * TICKS
    for i in range(idx("11:00"), idx("12:00")):
        twl[i] = 100.0
    for i in range(idx("09:30"), idx("10:30")):
        twl[i] = math.nan
    zones = [Zone.LOW] * TICKS
    plan = plan_crew(crew(B0), timeline(JULY, zones, twl=twl), rules(), local_date=JULY, tz=TZ)
    assert spans(plan, A18) == [("09:30", "10:30")]
    assert all_violations(plan, zones, B0, JULY, "heavy") == []


def test_a_shift_block_outside_the_grid_cannot_reach_the_planner() -> None:
    with pytest.raises(ValueError, match="grid"):
        crew((ShiftBlock(time(3, 0), time(9, 0)),))
    with pytest.raises(ValueError, match="grid"):
        crew((ShiftBlock(time(22, 0), time(23, 0)),))
    edge = crew((ShiftBlock(time(4, 0), time(22, 0)),))  # the grid edges are legal
    assert (
        plan_crew(edge, timeline(OCTOBER, [Zone.LOW] * TICKS), rules(), local_date=OCTOBER, tz=TZ).art18_minutes == 180
    )
