"""``ml.scoreboards``: the Warnings row, the demo day and the Plans row on hand-computed synthetic frames.

Every expected number is worked out in the comments from the pre-registration's definitions (weights, hits, misses,
violation ticks), not read from the code. Frames are built by ``make_rows`` from named states: a truth TWL of 160 W/m2
is Low (effective 153), 100 is High (effective 93: between the Red edge 85 and 115), 80 is Red (effective 73).
"""

import json
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Final

import polars as pl
import pytest

from stellar_blaze.domain.scoreboard import (
    DemoDay,
    PlanScoreboard,
    PolicyRow,
    PolicyScoreboard,
    Provenance,
    ProvenanceLabel,
)
from stellar_blaze.ml import scoreboards
from stellar_blaze.ml.artifact_io import write_artifact
from stellar_blaze.ml.eval_inputs import crew_spec, load_fixture
from stellar_blaze.ml.exporters import github_slug
from stellar_blaze.ml.scoreboards import BoardContext, ban_weights, select_demo_day
from tests.unit.risk.support import default_params, released_ruleset

pytestmark = pytest.mark.unit

BACKEND: Final = Path(__file__).resolve().parents[3]
PREREGISTRATION: Final = BACKEND.parent / "docs" / "research" / "2026-11-12-preregistration-2026-evaluation.md"
LOW_TRUTH, HIGH_TRUTH, RED_TRUTH = 160.0, 100.0, 80.0
LOW_EFF, HIGH_EFF, RED_EFF = 153.0, 93.0, 73.0


@dataclass(frozen=True)
class E:
    """One station-hour of the scoring frame (defaults: a calm hour that every policy leaves alone)."""

    t: datetime
    truth: float = LOW_TRUTH
    raw_wbgt: float = 25.0
    raw_eff: float = LOW_EFF
    n_high: int = 0
    n_finite: int = 50
    protective: float = LOW_EFF
    lead: int = 1
    joint: bool = True
    reject: int = 0


def at(year: int, month: int, day: int, hour: int) -> datetime:
    return datetime(year, month, day, hour, tzinfo=UTC)


def make_rows(entries: list[E]) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "valid_time": pl.Series([e.t for e in entries], dtype=pl.Datetime("us", "UTC")),
            "lead_days": pl.Series([e.lead for e in entries], dtype=pl.Int64),
            "truth_twl": [e.truth for e in entries],
            "truth_t_c": [35.0] * len(entries),
            "truth_wbgt_c": [30.0] * len(entries),
            "raw_wbgt_c": [e.raw_wbgt for e in entries],
            "raw_twl_eff": [e.raw_eff for e in entries],
            "n_high": [float(e.n_high) for e in entries],
            "n_finite": [float(e.n_finite) for e in entries],
            "protective_twl": [e.protective for e in entries],
            "has_joint_obs": [e.joint for e in entries],
            "wbgt_obs_reject": pl.Series([e.reject for e in entries], dtype=pl.Int8),
        }
    )


PROVENANCE: Final = Provenance(
    protocol_path="docs/research/2026-11-12-preregistration-2026-evaluation.md",
    protocol_anchor="#x",
    script="stellar_blaze.ml.scoreboards",
    function="x",
    git_sha="a" * 40,
    data_sha256="b" * 64,
    model_id=None,
    label=ProvenanceLabel.REAL,
    generated_at=datetime(2026, 11, 15, tzinfo=UTC),
)


def context(start: date, end: date, *, dev: bool = False) -> BoardContext:
    return BoardContext(
        evaluation_set="dev_2025" if dev else "scored_2026",
        station="OMAA",
        season_start=start,
        season_end=end,
        ruleset_id="ae-heat-2026.1",
        ruleset_sha256="c" * 64,
        provenance=PROVENANCE,
        evaluation_label="DEV 2025, LOCO out-of-fold: not the result" if dev else None,
    )


def row(board: PolicyScoreboard, policy: str, lead: int = 1) -> PolicyRow:
    (found,) = (r for r in next(x for x in board.leads if x.lead_days == lead).rows if r.policy == policy)
    return found


# === weights ========================================================================================================


def test_partial_ban_weights() -> None:
    # The ban is 12:30-15:00 GST = 08:30-11:00 UTC from 15 Jun to 15 Sep. The label 08Z covers [08:00, 09:00)
    # UTC, of which
    # 30 minutes are ban: weight 0.5; 09Z and 10Z are all ban: 0; 06Z, 07Z and 11Z are free: 1. Outside the
    # season all are 1.
    times = [at(2025, 7, 1, h) for h in (6, 7, 8, 9, 10, 11)] + [
        at(2025, 5, 20, 8),
        at(2025, 6, 14, 9),
        at(2025, 6, 15, 9),
    ]
    weights = ban_weights(pl.Series(times, dtype=pl.Datetime("us", "UTC")), released_ruleset())
    assert weights.tolist() == [1.0, 1.0, 0.5, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0]


# === the Warnings row ===============================================================================================

# One in-season day, 1 July 2025. Hours (weight, truth, P1 warns, n_high of 50):
#   06Z (1.0) danger, warned, 20 high   07Z (1.0) danger, not warned, 5   08Z (0.5) danger, warned, 15 (a tie at .30)
#   09Z (0)   danger, not warned, 0     10Z (0)   calm, warned, 0        11Z (1.0) calm, warned, 50
DAY = [
    E(at(2025, 7, 1, 6), truth=HIGH_TRUTH, raw_wbgt=33.0, n_high=20),
    E(at(2025, 7, 1, 7), truth=HIGH_TRUTH, n_high=5),
    E(at(2025, 7, 1, 8), truth=HIGH_TRUTH, raw_wbgt=33.0, n_high=15),
    E(at(2025, 7, 1, 9), truth=HIGH_TRUTH),
    E(at(2025, 7, 1, 10), raw_wbgt=33.0),
    E(at(2025, 7, 1, 11), raw_wbgt=33.0, n_high=50),
]


def one_day_board(entries: list[E] | None = None, *, dev: bool = False) -> PolicyScoreboard:
    rows = make_rows(DAY if entries is None else entries)
    return scoreboards.warnings_scoreboard(
        rows,
        theta_protect=0.30,
        theta_balanced=0.35,
        ruleset=released_ruleset(),
        params=default_params(),
        context=context(date(2025, 7, 1), date(2025, 7, 1), dev=dev),
        leads=(1, 2),
    )


def test_pod_far_csi_weighted() -> None:
    p1 = row(one_day_board(), "P1")
    # hits = 1 (06Z) + 0.5 (08Z); missed = 1 (07Z; the 09Z miss has weight 0); false alarms = 1 (11Z; 10Z has weight 0).
    assert p1.missed_danger_hours.value == pytest.approx(1.0)
    assert p1.false_alarm_hours.value == pytest.approx(1.0)
    assert p1.pod.value == pytest.approx(1.5 / 2.5)  # 0.6
    assert p1.far.value == pytest.approx(1.0 / 2.5)  # 0.4
    assert p1.csi.value == pytest.approx(1.5 / 3.5)  # 3/7
    assert p1.missed_danger_crew_hours.value == pytest.approx(20.0)  # x the assumed crew of 20
    assert p1.false_alarm_crew_hours.value == pytest.approx(20.0)
    # Worked warned hours 06Z, 08Z and 11Z are three separate runs (10Z has no weight and breaks nothing): 3 alerts.
    assert p1.alerts_per_shift.value == pytest.approx(3.0)
    # One season day: every bootstrap replicate is the data, so the interval collapses on the value.
    assert p1.pod.ci is not None
    assert (p1.pod.ci.lo, p1.pod.ci.hi) == pytest.approx((0.6, 0.6))
    assert p1.missed_danger_hours.ci is not None
    assert (p1.missed_danger_hours.ci.lo, p1.missed_danger_hours.ci.hi) == pytest.approx((1.0, 1.0))


def test_p3_warns_at_theta_and_both_thetas_are_scored() -> None:
    board = one_day_board()
    # theta .30: 06Z (.40), 08Z (.30, a tie escalates) and 11Z (1.0) warn: the same set as P1, so the same numbers.
    protect = row(board, "P3_protect")
    assert protect.theta == 0.30
    assert (protect.pod.value, protect.far.value) == pytest.approx((0.6, 0.4))
    # theta .35: the 08Z tie (.30) no longer warns: hits 1, missed 1 + 0.5, false alarms 1.
    balanced = row(board, "P3_balanced")
    assert balanced.theta == 0.35
    assert balanced.missed_danger_hours.value == pytest.approx(1.5)
    assert balanced.pod.value == pytest.approx(1.0 / 2.5)
    assert balanced.far.value == pytest.approx(1.0 / 2.0)
    assert balanced.csi.value == pytest.approx(1.0 / 3.5)
    assert row(board, "P0").theta is None


def test_p0_warns_nothing_outside_ban() -> None:
    board = one_day_board()
    p0 = row(board, "P0")
    # P0 warns only ban hours, which are not worked: every danger hour with weight is missed (1 + 1 + 0.5), no alarms.
    assert p0.missed_danger_hours.value == pytest.approx(2.5)
    assert p0.false_alarm_hours.value == 0.0
    assert p0.pod.value == 0.0
    assert p0.alerts_per_shift.value == 0.0
    # FAR has no denominator for a policy that never warns: value 0, no interval, no observations.
    assert (p0.far.value, p0.far.ci, p0.far.n) == (0.0, None, 0)
    assert board.leads[0].truth_danger_hours.value == pytest.approx(2.5)


def test_leads_without_rows_are_listed_as_not_available_in_the_dev_export() -> None:
    board = one_day_board(dev=True)
    lead2 = board.leads[1]
    assert lead2.rows == []
    assert lead2.label == "issued by 18:00 GST the evening before; not available in the dev export"
    assert board.leads[0].label == "about 24 hours ahead"
    assert board.evaluation_set == "dev_2025"
    assert board.evaluation_label == "DEV 2025, LOCO out-of-fold: not the result"


def test_the_truth_sensitivity_has_four_cells_and_one_headline() -> None:
    board = one_day_board()
    cells = {(c.margin_w_m2, c.withdrawal_limits): c for c in board.sensitivity}
    assert set(cells) == {(7.0, False), (7.0, True), (0.0, False), (0.0, True)}
    assert [c.headline for c in board.sensitivity].count(True) == 1
    assert cells[(7.0, False)].headline
    assert cells[(7.0, False)].truth_danger_hours.value == pytest.approx(2.5)
    # Margin 0 leaves a truth TWL of 160 Low and 100 High (both unchanged); the margin never moves these two states.
    assert cells[(0.0, False)].truth_danger_hours.value == pytest.approx(2.5)
    assert all(len(c.rows) == 5 for c in board.sensitivity)


def test_margin_zero_changes_the_truth_where_it_sits_between_the_edges() -> None:
    # A truth TWL of 120 is Medium with margin 0 (>= 115) and High with margin 7 (113): the cell must see the
    # difference.
    entries = [E(at(2025, 7, 1, 6), truth=120.0, n_high=50), E(at(2025, 7, 1, 7), truth=LOW_TRUTH)]
    cells = {(c.margin_w_m2, c.withdrawal_limits): c for c in one_day_board(entries).sensitivity}
    assert cells[(7.0, False)].truth_danger_hours.value == pytest.approx(1.0)
    assert cells[(0.0, False)].truth_danger_hours.value == pytest.approx(0.0)


def test_h4_is_supported_only_when_both_intervals_exclude_zero() -> None:
    # 12 off-season days: every day has 2 danger hours that P3 warns and P0 (never) and P2 (raw says Low) miss, and
    # 1 calm hour that P1 (raw WBGT 33) false-alarms and P3 does not.
    entries = []
    for d in range(12):
        day = date(2025, 5, 20) + timedelta(days=d)
        entries += [
            E(at(day.year, day.month, day.day, 6), truth=HIGH_TRUTH, n_high=50),
            E(at(day.year, day.month, day.day, 7), truth=HIGH_TRUTH, n_high=50),
            E(at(day.year, day.month, day.day, 8), raw_wbgt=33.0),
        ]
    board = scoreboards.warnings_scoreboard(
        make_rows(entries),
        theta_protect=0.30,
        theta_balanced=0.35,
        ruleset=released_ruleset(),
        params=default_params(),
        context=context(date(2025, 5, 20), date(2025, 5, 31)),
        leads=(1,),
    )
    h4, h5 = board.verdicts
    # P3 minus P0 missed: 0 - 24 = -24 h; P3 minus P1 false alarms: 0 - 12 = -12 h, on every day: any resample
    # excludes 0.
    assert [c.difference.value for c in h4.comparisons] == pytest.approx([-24.0, -12.0])
    assert h4.outcome == "supported"
    assert h4.primary
    assert h4.id == "H4"
    assert "H4 supported" in h4.text
    # P3 minus P2 missed: P2 (raw Low) misses all 24 hours and P3 none: -24; false alarms 0 vs 0: within P2 + 25%.
    assert h5.outcome == "supported"
    assert not h5.primary
    assert "within" in h5.text


def test_a_failing_side_is_named_and_the_regulator_is_recommended_when_it_wins() -> None:
    # P3 never warns (n_high 0) and raw TWL warns (P2) the danger hours: P3 misses all, P2 none; P3 has no false alarms.
    entries = []
    for d in range(12):
        day = date(2025, 5, 20) + timedelta(days=d)
        entries += [
            E(at(day.year, day.month, day.day, 6), truth=HIGH_TRUTH, raw_eff=HIGH_EFF),
            E(at(day.year, day.month, day.day, 7), truth=HIGH_TRUTH, raw_eff=HIGH_EFF),
        ]
    board = scoreboards.warnings_scoreboard(
        make_rows(entries),
        theta_protect=0.30,
        theta_balanced=0.35,
        ruleset=released_ruleset(),
        params=default_params(),
        context=context(date(2025, 5, 20), date(2025, 5, 31)),
        leads=(1,),
    )
    h4 = board.verdicts[0]
    assert h4.outcome == "negative"
    assert "H4 not supported" in h4.text
    assert "the P0 side" in h4.text
    assert "our AI did not beat the regulator's own zones on held-out data" in h4.text


# === the demo day ===================================================================================================


def day_entries(
    day: date,
    n_high: int,
    *,
    joint_off_at: int | None = None,
    reject_at: int | None = None,
    high_hours: tuple[int, ...] | None = None,
) -> tuple[list[E], list[bool]]:
    entries, present = [], []
    for hour in range(6, 15):
        high = hour in high_hours if high_hours is not None else hour - 6 < n_high
        entries.append(
            E(
                at(day.year, day.month, day.day, hour),
                truth=HIGH_TRUTH if high else LOW_TRUTH,
                joint=hour != joint_off_at,
                reject=1 if hour == reject_at else 0,
            )
        )
        present.append(True)
    return entries, present


def select(
    days: list[tuple[date, dict[str, object]]], absent: tuple[date, int] | None = None
) -> scoreboards.DemoSelection:
    entries: list[E] = []
    flags: list[bool] = []
    for day, options in days:
        built, _present = day_entries(day, **options)  # type: ignore[arg-type]
        entries += built
        flags += [not (absent is not None and (day, e.t.hour) == absent) for e in built]
    rows = make_rows(entries)
    truth = rows.select("valid_time", "has_joint_obs", "truth_twl", "truth_t_c", "wbgt_obs_reject")
    present_frame = pl.DataFrame({"valid_time": rows["valid_time"], "present": flags})
    return select_demo_day(
        truth, present_frame, released_ruleset(), default_params(), season=(date(2025, 5, 15), date(2025, 9, 30))
    )


def test_demo_day_rule() -> None:
    d = [date(2025, 5, 20) + timedelta(days=i) for i in range(10)]
    # Observed High hours per day: 3, 5, 5, 7 (one hour without joint obs: not a candidate), 4, 6 (one hour rejected:
    # not a candidate), 2, 4 (one forecast input absent: not a candidate), 1, 0.
    days: list[tuple[date, dict[str, object]]] = [
        (d[0], {"n_high": 3}),
        (d[1], {"n_high": 5}),
        (d[2], {"n_high": 5}),
        (d[3], {"n_high": 7, "joint_off_at": 10}),
        (d[4], {"n_high": 4}),
        (d[5], {"n_high": 6, "reject_at": 9}),
        (d[6], {"n_high": 2}),
        (d[7], {"n_high": 4}),
        (d[8], {"n_high": 1}),
        (d[9], {"n_high": 0}),
    ]
    chosen = select(days, absent=(d[7], 12))
    # Candidates are days 0, 1, 2, 4, 6, 8, 9. The maximum is 5 on days 1 and 2: the tie goes to the earlier, day 1.
    assert chosen.date == d[1]
    assert chosen.score == 5.0
    assert chosen.high_hours == 5.0
    assert chosen.candidates == 7
    assert chosen.runner_up is not None
    assert (chosen.runner_up.date, chosen.runner_up.score) == (d[2], 5.0)
    assert chosen.reject_checked


def test_demo_day_maximum_wins_over_an_earlier_lower_day() -> None:
    d = [date(2025, 5, 20) + timedelta(days=i) for i in range(3)]
    chosen = select([(d[0], {"n_high": 2}), (d[1], {"n_high": 6}), (d[2], {"n_high": 1})])
    assert chosen.date == d[1]
    assert chosen.score == 6.0
    assert chosen.candidates == 3
    assert chosen.runner_up is not None
    assert chosen.runner_up.date == d[0]


def test_demo_day_score_is_the_non_ban_weight_of_the_high_hours() -> None:
    first, second = date(2025, 7, 1), date(2025, 7, 2)
    # 1 July: High at 08Z (weight 0.5), 09Z and 10Z (0) = 0.5 outside the ban from 3 High hours; 2 July: High at
    # 06Z only = 1.
    chosen = select([(first, {"n_high": 0, "high_hours": (8, 9, 10)}), (second, {"n_high": 0, "high_hours": (6,)})])
    assert chosen.date == second
    assert chosen.score == 1.0
    assert chosen.high_hours == 1.0
    assert chosen.runner_up is not None
    assert (chosen.runner_up.date, chosen.runner_up.score) == (first, 0.5)


def test_no_candidate_is_an_error() -> None:
    with pytest.raises(ValueError, match="no demo day"):
        select([(date(2025, 5, 20), {"n_high": 3, "joint_off_at": 8})])


# === the Plans row ==================================================================================================

SEASON: Final = (date(2026, 5, 20), date(2026, 5, 29))


def plan_rows() -> pl.DataFrame:
    """Ten off-season days, every modelled hour 02-15 UTC at lead 1.

    Days 0-4: truth, raw and corrected are Low all day. Days 5-9: the truth is Red (effective 73) at the labels
    11-14 UTC
    (15:00-18:00 GST, the afternoon block of L1) and Low elsewhere; the raw forecast says Low all day (it misses the
    afternoon); the corrected q10 says Red at 11-14 UTC (it catches it).
    """
    entries = []
    for d in range(10):
        day = SEASON[0] + timedelta(days=d)
        for hour in range(2, 16):
            afternoon = d >= 5 and 11 <= hour <= 14
            entries.append(
                E(
                    at(day.year, day.month, day.day, hour),
                    truth=RED_TRUTH if afternoon else LOW_TRUTH,
                    protective=RED_EFF if afternoon else LOW_EFF,
                )
            )
    return make_rows(entries)


def crew_b() -> object:
    return crew_spec(load_fixture(BACKEND / "fixtures" / "demo_site.toml"), "crew-b")


def plans_board() -> PlanScoreboard:
    return scoreboards.plans_scoreboard(
        plan_rows(),
        crew=crew_b(),  # type: ignore[arg-type]
        ruleset=released_ruleset(),
        params=default_params(),
        context=context(*SEASON),
        site_id="site-demo-mussafah",
        fixture_sha256="d" * 64,
        roster="L1: 06:00-11:00 + 15:00-18:00 GST",
        crew_label="SIMULATED crew: 20 experienced adults, heavy work",
    )


def plan(board: PlanScoreboard, name: str):  # type: ignore[no-untyped-def]
    return next(r for r in board.rows if r.plan == name)


def test_plans_naive_equals_ban_only_on_l1() -> None:
    board = plans_board()
    naive, ban_only = plan(board, "naive"), plan(board, "ban_only")
    # The ban (12:30-15:00) lies in L1's 11:00-15:00 gap and the runs are 5 h and 3 h: the ban and Art. 18
    # change nothing.
    assert board.identical_by_construction == ["naive", "ban_only"]
    assert (
        naive.label
        == ban_only.label
        == ("Ban only (= working every shift minute; the legal roster already avoids the ban)")
    )
    for name in (
        "violation_minutes_per_season",
        "high_cycled_share",
        "missed_protection_ticks",
        "rest_minutes_added_vs_naive",
    ):
        assert getattr(naive, name) == getattr(ban_only, name)
    assert board.n_days == 10


def test_rule_corrected_le_naive_violations() -> None:
    board = plans_board()
    # The afternoon block has 36 five-minute ticks (15:00-17:55 GST). On each of the 5 Red days a plan that
    # works them breaks
    # STOP.red on exactly those 36 ticks = 180 minutes: naive, ban only and the raw-IFS rule plan (raw says Low)
    # work them
    # all (5 x 180 = 900 minutes per season); the corrected plan (q10 Red) stops them and has no violation.
    assert plan(board, "naive").violation_minutes_per_season.value == pytest.approx(900.0)
    assert plan(board, "ban_only").violation_minutes_per_season.value == pytest.approx(900.0)
    assert plan(board, "rule_raw").violation_minutes_per_season.value == pytest.approx(900.0)
    assert plan(board, "rule_corrected").violation_minutes_per_season.value == pytest.approx(0.0)
    # Truth High-or-Red attendance ticks: 5 days x 36 = 180. Cycled (plan zone High or Red): corrected 180, the
    # others 0.
    assert plan(board, "naive").high_cycled_share.value == 0.0
    assert plan(board, "rule_raw").high_cycled_share.value == 0.0
    assert plan(board, "rule_corrected").high_cycled_share.value == pytest.approx(1.0)
    assert plan(board, "rule_corrected").high_cycled_share.n == 180
    # Missed protection: worked ticks whose plan zone (Low) is milder than the truth zone (Red): 180 for naive
    # and raw, 0 corrected.
    assert plan(board, "naive").missed_protection_ticks.value == pytest.approx(180.0)
    assert plan(board, "rule_raw").missed_protection_ticks.value == pytest.approx(180.0)
    assert plan(board, "rule_corrected").missed_protection_ticks.value == 0.0
    # Rest added over naive: the corrected plan stops 180 minutes on each of 5 days = 900; the others add none.
    assert plan(board, "rule_corrected").rest_minutes_added_vs_naive.value == pytest.approx(900.0)
    assert plan(board, "ban_only").rest_minutes_added_vs_naive.value == 0.0
    h6, h7 = board.verdicts
    # Paired: the difference is -180 on each of 5 of 10 days; a 7-day block always holds at least 2 of those
    # days, so every
    # resample is below zero and the interval excludes it.
    assert h6.comparisons[0].difference.value == pytest.approx(-900.0)
    assert h6.outcome == "supported"
    assert h6.primary
    assert "H6 supported" in h6.text
    assert h7.comparisons[0].difference.value == pytest.approx(-180.0)
    assert h7.outcome == "supported"


def test_a_day_without_values_on_the_shift_is_not_scored() -> None:
    rows = plan_rows().filter(
        ~((pl.col("valid_time").dt.date() == date(2026, 5, 22)) & (pl.col("valid_time").dt.hour() == 4))
    )
    board = scoreboards.plans_scoreboard(
        rows,
        crew=crew_b(),  # type: ignore[arg-type]
        ruleset=released_ruleset(),
        params=default_params(),
        context=context(*SEASON),
        site_id="s",
        fixture_sha256="d" * 64,
        roster="L1",
        crew_label="SIMULATED",
    )
    assert board.n_days == 9  # a missing label inside the shift makes its day unscored for every plan alike


# === exports: provenance, anchors, words ============================================================================


def heading(prefix: str) -> str:
    line = next(x for x in PREREGISTRATION.read_text(encoding="utf-8").splitlines() if x.startswith(f"### {prefix} "))
    return line.removeprefix("### ")


def test_the_anchors_are_the_exact_headings_of_the_preregistration() -> None:
    assert heading("7.2") == scoreboards.WARNINGS_HEADING
    assert heading("7.3") == scoreboards.PLANS_HEADING
    assert heading("7.4") == scoreboards.DEMO_HEADING
    assert scoreboards.WARNINGS_ANCHOR.startswith("#72-warnings-row-")
    assert scoreboards.PLANS_ANCHOR.startswith("#73-plans-row-")
    assert scoreboards.DEMO_ANCHOR.startswith("#74-demo-day-")
    assert "#" + github_slug(heading("7.2")) == scoreboards.WARNINGS_ANCHOR


def demo_day() -> DemoDay:
    day = date(2025, 7, 1)
    entries = [
        E(at(2025, 7, 1, h), truth=HIGH_TRUTH if h in (6, 7, 8) else LOW_TRUTH, raw_wbgt=33.0, n_high=40)
        for h in range(6, 15)
    ]
    rows = make_rows(entries)
    truth = rows.select("valid_time", "has_joint_obs", "truth_twl", "truth_t_c", "wbgt_obs_reject")
    chosen = select_demo_day(
        truth,
        pl.DataFrame({"valid_time": rows["valid_time"], "present": [True] * rows.height}),
        released_ruleset(),
        default_params(),
        season=(day, day),
    )
    wbgt = pl.DataFrame(
        {"valid_time": rows["valid_time"], "p05": [30.0] * 9, "p50": [32.0] * 9, "p95": [None] * 9},
        schema_overrides={"p95": pl.Float64},
    )
    return scoreboards.fill_demo_day(
        chosen,
        rows,
        wbgt,
        theta_protect=0.30,
        theta_balanced=0.35,
        ruleset=released_ruleset(),
        params=default_params(),
        context=context(day, day),
    )


def test_the_demo_day_has_nine_hours_and_counts_hits_by_weight() -> None:
    shown = demo_day()
    assert [h.starts_at.hour for h in shown.hours] == list(range(6, 15))
    # Truth High at 06Z, 07Z, 08Z; P3 (n_high 40 of 50 = .8) and P1 (raw WBGT 33) warn every hour; P2 (raw Low) none.
    assert shown.high_hours == 3.0
    assert shown.score == shown.high_hours_outside_ban == 2.5
    assert shown.raw_hits == 0.0
    assert shown.p3_hits == 2.5
    h8 = shown.hours[2]
    assert h8.ban_weight == 0.5
    assert h8.truth_zone == "high"
    assert h8.raw_zone == "low"
    assert h8.warned_by == ["P0", "P1", "P3_protect", "P3_balanced"]  # P0 "warns" the ban half of the hour
    assert shown.hours[0].warned_by == ["P1", "P3_protect", "P3_balanced"]
    assert h8.corrected_wbgt_c is None  # p95 is null: no range is invented


def test_exports_have_provenance_and_anchors(tmp_path: Path) -> None:
    warnings = one_day_board()
    plans = plans_board()
    demo = demo_day()
    written = {
        "policy_scoreboard.json": (warnings, scoreboards.WARNINGS_ANCHOR, ProvenanceLabel.REAL),
        "plan_scoreboard.json": (plans, scoreboards.PLANS_ANCHOR, ProvenanceLabel.REAL_WEATHER_ASSUMED_CREW),
        "demo_day.json": (demo, scoreboards.DEMO_ANCHOR, ProvenanceLabel.REAL),
    }
    for name, (artifact, anchor, label) in written.items():
        write_artifact(tmp_path / name, artifact)
        document = json.loads((tmp_path / name).read_bytes())
        assert document["provenance"]["protocol_anchor"] == anchor
        assert document["provenance"]["label"] == label.value
        assert type(artifact).model_validate(document) == artifact
        text = (tmp_path / name).read_text(encoding="utf-8")
        for banned in ("compliant", "minutes avoided", "illness prevented"):
            assert banned not in text.lower()
        for key, value in _walk(document):
            if key == "anchor":
                assert value == (scoreboards.PLANS_ANCHOR if artifact is plans else scoreboards.WARNINGS_ANCHOR)
    assert plans.provenance.label is ProvenanceLabel.REAL_WEATHER_ASSUMED_CREW
    assert re.fullmatch(r"#7[234]-.*", demo.provenance.protocol_anchor)


def _walk(node: object, key: str = ""):  # type: ignore[no-untyped-def]
    if isinstance(node, dict):
        for k, v in node.items():
            yield from _walk(v, k)
    elif isinstance(node, list):
        for item in node:
            yield from _walk(item, key)
    else:
        yield key, node
