"""``ml.scoreboards``: the Warnings row, the demo day and the Plans row on hand-computed synthetic frames.

Every expected number is worked out in the comments from the pre-registration's definitions (weights, hits, misses,
violation ticks), not read from the code. Frames are built by ``make_rows`` from named states: a truth TWL of 160 W/m2
is Low (effective 153), 100 is High (effective 93: between the Red edge 85 and 115), 80 is Red (effective 73).
"""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Final

import polars as pl
import pytest

from stellar_blaze.domain.rules.ruleset import Ruleset
from stellar_blaze.domain.scoreboard import (
    DemoDay,
    PlanScoreboard,
    PolicyRow,
    PolicyScoreboard,
    Provenance,
    ProvenanceLabel,
    SensitivityCell,
)
from stellar_blaze.ml import bootstrap, scoreboards
from stellar_blaze.ml.artifact_io import write_artifact
from stellar_blaze.ml.eval_inputs import crew_spec, load_fixture
from stellar_blaze.ml.exporters import github_slug
from stellar_blaze.ml.scoreboard_inputs import ScoringInputs
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
    t_c: float = 35.0  # the observed dry bulb (for the withdrawal cap)


def at(year: int, month: int, day: int, hour: int) -> datetime:
    return datetime(year, month, day, hour, tzinfo=UTC)


def make_rows(entries: list[E]) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "valid_time": pl.Series([e.t for e in entries], dtype=pl.Datetime("us", "UTC")),
            "lead_days": pl.Series([e.lead for e in entries], dtype=pl.Int64),
            "truth_twl": [e.truth for e in entries],
            "truth_t_c": [e.t_c for e in entries],
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


# === the verdict rules, pinned one at a time =======================================================================

SPAN: Final = (date(2025, 5, 20), date(2025, 5, 31))  # 12 days before the ban season: every hour weighs 1


def hr(day: date, h: int, **kwargs: Any) -> E:
    return E(at(day.year, day.month, day.day, h), **kwargs)


def twelve_days(per_day: Callable[[int, date], list[E]]) -> list[E]:
    entries: list[E] = []
    for index in range(12):
        entries += per_day(index, SPAN[0] + timedelta(days=index))
    return entries


def span_board(entries: list[E], *, leads: tuple[int, ...] = (1,), ruleset: Ruleset | None = None) -> PolicyScoreboard:
    return scoreboards.warnings_scoreboard(
        make_rows(entries),
        theta_protect=0.30,
        theta_balanced=0.35,
        ruleset=ruleset or released_ruleset(),
        params=default_params(),
        context=context(*SPAN),
        leads=leads,
    )


def test_h4_is_not_supported_when_only_the_p1_side_holds() -> None:
    # Every day: 06Z is a danger hour that P3 does not warn (n_high 0) and 07Z a calm hour that P1 false-alarms
    # (raw WBGT 33). P3 minus P0 missed danger hours: both miss the 12 danger hours, 12 - 12 = 0 (interval [0, 0]: not
    # fewer). P3 minus P1 false-alarm hours: 0 - 12 = -12 (fewer on every day).
    def day(_: int, d: date) -> list[E]:
        return [hr(d, 6, truth=HIGH_TRUTH), hr(d, 7, raw_wbgt=33.0)]

    h4 = span_board(twelve_days(day)).verdicts[0]
    assert [c.difference.value for c in h4.comparisons] == pytest.approx([0.0, -12.0])
    assert h4.outcome == "negative"
    assert "the P0 side" in h4.text
    assert "the P1 side" not in h4.text
    # P2 (raw Low) misses the same 12 hours and has no false alarm: at least as good as P3 on both counts (an equal
    # count is "at least as good": point estimates).
    assert "regulator's own zones" in h4.text


def test_h4_is_not_supported_when_only_the_p0_side_holds() -> None:
    # Every day: 06Z is a danger hour that P3 and P1 warn, 07Z a calm hour that P3 warns (n_high 50) and P1 does not.
    # P3 minus P0 missed: 0 - 12 = -12 (fewer). P3 minus P1 false-alarm hours: 12 - 0 = +12 (more).
    def day(_: int, d: date) -> list[E]:
        return [hr(d, 6, truth=HIGH_TRUTH, n_high=50, raw_wbgt=33.0), hr(d, 7, n_high=50)]

    h4 = span_board(twelve_days(day)).verdicts[0]
    assert [c.difference.value for c in h4.comparisons] == pytest.approx([-12.0, 12.0])
    assert h4.outcome == "negative"
    assert "the P1 side" in h4.text
    assert "the P0 side" not in h4.text
    # P2 (raw Low) misses all 12 danger hours where P3 misses none: it is not at least as good, so it is not shown as
    # the recommended policy.
    assert "regulator" not in h4.text


def test_a_favorable_point_estimate_whose_interval_straddles_zero_is_not_fewer() -> None:
    # Every day: 06Z is a danger hour that P3 warns (the P0 side holds: -12). 07Z is calm: on days 0-5 P1 false-alarms
    # (raw WBGT 33) and P3 does not; on days 6-8 P3 false-alarms (n_high 50) and P1 does not; days 9-11 are quiet.
    # P3 minus P1 false-alarm hours: 3 - 6 = -3 (a favorable point estimate), but a resample of two 7-day blocks can
    # hold more of days 6-8 than of days 0-5, so the interval reaches above zero.
    def day(i: int, d: date) -> list[E]:
        entries = [hr(d, 6, truth=HIGH_TRUTH, n_high=50)]
        if i < 6:
            entries.append(hr(d, 7, raw_wbgt=33.0))
        elif i < 9:
            entries.append(hr(d, 7, n_high=50))
        return entries

    h4 = span_board(twelve_days(day)).verdicts[0]
    p1_side, p0_side = h4.comparisons[1].difference, h4.comparisons[0].difference
    assert p1_side.value == pytest.approx(-3.0)
    assert p1_side.ci is not None
    assert p1_side.ci.lo < 0.0 < p1_side.ci.hi
    assert p0_side.ci is not None
    assert p0_side.ci.hi < 0.0  # the P0 side holds
    assert h4.outcome == "negative"
    assert "the P1 side" in h4.text
    assert "the P0 side" not in h4.text


def h5_days(p3_false_alarm_days: int) -> list[E]:
    """06Z danger hour: P3 warns it, P2 (raw Low) misses it. P2 false-alarms at 07Z on days 0-7 (8 hours) and P3 at 08Z
    on the first ``p3_false_alarm_days`` days."""

    def day(i: int, d: date) -> list[E]:
        entries = [hr(d, 6, truth=HIGH_TRUTH, n_high=50)]
        if i < 8:
            entries.append(hr(d, 7, raw_eff=HIGH_EFF))
        if i < p3_false_alarm_days:
            entries.append(hr(d, 8, n_high=50))
        return entries

    return twelve_days(day)


def test_h5_allows_false_alarms_up_to_exactly_a_quarter_more_than_p2() -> None:
    # P2 false-alarms 8 hours; P3 10: 10 <= 1.25 x 8 = 10 (the boundary is allowed). P3 minus P2 missed: 0 - 12 = -12
    # on every day (the interval excludes zero).
    h5 = span_board(h5_days(10)).verdicts[1]
    assert h5.comparisons[0].difference.value == pytest.approx(-12.0)
    assert h5.comparisons[0].difference.ci is not None
    assert h5.comparisons[0].difference.ci.hi < 0.0
    assert h5.comparisons[1].difference.value == pytest.approx(2.0)
    assert h5.outcome == "supported"
    assert "10.0 h against P2 8.0 h (within P2 + 25%)" in h5.text


def test_h5_refuses_one_false_alarm_hour_above_the_allowance() -> None:
    # P3 false-alarms 11 hours against the allowed 10: 11 > 10, so H5 fails although the missed-hours interval is wholly
    # below zero.
    h5 = span_board(h5_days(11)).verdicts[1]
    assert h5.comparisons[0].difference.ci is not None
    assert h5.comparisons[0].difference.ci.hi < 0.0
    assert h5.outcome == "negative"
    assert "11.0 h against P2 8.0 h (above P2 + 25%)" in h5.text


def test_h5_needs_fewer_missed_hours_even_when_the_false_alarms_are_within() -> None:
    # Every 06Z danger hour is warned by P2 (raw eff High) and by P3: P3 minus P2 missed = 0 (interval [0, 0]); no false
    # alarm on either side (0 <= 1.25 x 0): the false-alarm clause holds, the missed clause does not.
    def day(_: int, d: date) -> list[E]:
        return [hr(d, 6, truth=HIGH_TRUTH, n_high=50, raw_eff=HIGH_EFF)]

    h5 = span_board(twelve_days(day)).verdicts[1]
    assert h5.comparisons[0].difference.value == pytest.approx(0.0)
    assert h5.outcome == "negative"
    assert "(within P2 + 25%)" in h5.text


def test_p2_is_only_recommended_when_it_is_at_least_as_good_on_both_counts() -> None:
    # Every day: 06Z is a danger hour that P2 warns (raw eff High) and P3 does not; 07Z a calm hour that P2 warns and P3
    # does not. P2 misses 0 hours (P3 12) but false-alarms 12 (P3 0): better on one count only, so not recommended.
    def day(_: int, d: date) -> list[E]:
        return [hr(d, 6, truth=HIGH_TRUTH, raw_eff=HIGH_EFF), hr(d, 7, raw_eff=HIGH_EFF)]

    h4 = span_board(twelve_days(day)).verdicts[0]
    assert h4.outcome == "negative"
    assert "regulator" not in h4.text


# --- the lead-2 clause of section 13 ---------------------------------------------------------------------------------

STAMP: Final = "issued by 18:00 GST the evening before"


def lead_entries(lead: int, *, p3_warns: bool) -> list[E]:
    """Per day: 06Z and 07Z are danger hours (P3 warns them when ``p3_warns``), 08Z a calm hour that P1 false-alarms.

    H4 holds at this lead when P3 warns: P3 minus P0 missed = 0 - 24 = -24 and P3 minus P1 false alarms = 0 - 12 = -12.
    It fails when P3 does not warn: P3 minus P0 missed = 24 - 24 = 0 (P3 minus P1 false alarms is still -12)."""
    n_high = 50 if p3_warns else 0
    entries: list[E] = []
    for index in range(12):
        d = SPAN[0] + timedelta(days=index)
        entries += [
            hr(d, 6, truth=HIGH_TRUTH, n_high=n_high, lead=lead),
            hr(d, 7, truth=HIGH_TRUTH, n_high=n_high, lead=lead),
            hr(d, 8, raw_wbgt=33.0, lead=lead),
        ]
    return entries


@pytest.mark.parametrize(
    ("holds_at_1", "holds_at_2", "stamp_may_be_carried", "phrases"),
    [
        (True, True, True, ("H4 holds at lead 2", "may be carried")),
        (True, False, False, ("H4 does not hold at lead 2", "is dropped from the video", "strict number is shown")),
        (False, True, True, ("H4 holds at lead 2", "H4 does not hold at lead 1")),
        (False, False, False, ("H4 does not hold at lead 2", "is dropped from the video", "at lead 1 either")),
    ],
)
def test_the_h4_verdict_at_lead_2_decides_the_evening_before_stamp(
    holds_at_1: bool, holds_at_2: bool, stamp_may_be_carried: bool, phrases: tuple[str, ...]
) -> None:
    entries = lead_entries(1, p3_warns=holds_at_1) + lead_entries(2, p3_warns=holds_at_2)

    board = span_board(entries, leads=(1, 2))

    assert [v.id for v in board.verdicts] == ["H4", "H5", "H4-lead2"]
    h4, _, lead2 = board.verdicts
    assert (h4.outcome == "supported") is holds_at_1  # lead 1 keeps its own meaning
    assert not lead2.primary
    assert (lead2.outcome == "supported") is holds_at_2
    expected = [-24.0 if holds_at_2 else 0.0, -12.0]  # hand-computed above, at lead 2
    assert [c.difference.value for c in lead2.comparisons] == pytest.approx(expected)
    assert [c.subject for c in lead2.comparisons] == ["P3_protect", "P3_protect"]
    assert "lead 2" in lead2.statement
    assert STAMP in lead2.text
    assert (f'"{STAMP}" may be carried' in lead2.text) is stamp_may_be_carried
    assert (f'"{STAMP}" is dropped' in lead2.text) is (not stamp_may_be_carried)
    for phrase in phrases:
        assert phrase in lead2.text


def test_there_is_no_lead_2_verdict_where_lead_2_is_not_available() -> None:
    board = one_day_board(dev=True)
    assert [v.id for v in board.verdicts] == ["H4", "H5"]
    assert board.leads[1].label.endswith("not available in the dev export")


# --- alerts per shift -----------------------------------------------------------------------------------------------


def alerts_of(warned_hours: tuple[int, ...]) -> float:
    """Alerts per shift of P1 on 1 July 2025 (in the ban season: 08Z weighs 0.5, 09Z and 10Z weigh 0) when it warns
    exactly ``warned_hours`` (calm truth)."""
    entries = [E(at(2025, 7, 1, h), raw_wbgt=33.0 if h in warned_hours else 25.0) for h in range(6, 15)]
    return row(one_day_board(entries), "P1").alerts_per_shift.value


def test_consecutive_warned_hours_are_one_alert() -> None:
    # 06Z and 07Z warned: one run. 08Z counts (weight 0.5) and extends the run.
    assert alerts_of((6, 7)) == pytest.approx(1.0)
    assert alerts_of((6, 7, 8)) == pytest.approx(1.0)


def test_non_consecutive_warned_hours_are_separate_alerts() -> None:
    # 06Z and 08Z with 07Z quiet: two runs. Three isolated hours: three runs.
    assert alerts_of((6, 8)) == pytest.approx(2.0)
    assert alerts_of((6, 11, 13)) == pytest.approx(3.0)


def test_a_warned_run_across_the_ban_hours_is_two_alerts() -> None:
    # The pre-registration (7.2) says "alerts per worker-shift" and is silent on what a ban hour does to a run. The code
    # counts runs of consecutive warned WORKED hours: 09Z and 10Z (weight 0, the midday ban) are not worked hours, so a
    # warning that spans them is two runs, 07-08Z and 11-12Z (the crew's two shift blocks have the ban between them).
    # Pinned as the code's reading.
    assert alerts_of((7, 8, 9, 10, 11, 12)) == pytest.approx(2.0)


# --- the withdrawal cell of the 2 x 2 -------------------------------------------------------------------------------


def row_in(cell: SensitivityCell, policy: str) -> PolicyRow:
    (found,) = (r for r in cell.rows if r.policy == policy)
    return found


def test_the_withdrawal_on_cell_caps_a_hot_dry_bulb_hour() -> None:
    # One truth hour at a dry bulb of 46 C (above the 44 C limit) with TWL 130 W/m2; the cap is 115 and the margin 7.
    # Withdrawal off: 130 - 7 = 123, Medium (>= 115): not a danger hour. Withdrawal on: min(130, 115) - 7 = 108, High
    # (below 115, above the Red edge 85): a danger hour. Margin 0 with the cap: 115, Medium (the edge is the milder
    # zone): not a danger hour.
    entries = [E(at(2025, 7, 1, 6), truth=130.0, t_c=46.0), E(at(2025, 7, 1, 7))]
    cells = {(c.margin_w_m2, c.withdrawal_limits): c for c in one_day_board(entries).sensitivity}
    assert cells[(7.0, False)].truth_danger_hours.value == pytest.approx(0.0)
    assert cells[(7.0, True)].truth_danger_hours.value == pytest.approx(1.0)
    assert cells[(0.0, False)].truth_danger_hours.value == pytest.approx(0.0)
    assert cells[(0.0, True)].truth_danger_hours.value == pytest.approx(0.0)
    # The policies are re-scored on that truth: P0 misses the capped hour only in the cell where it is a danger hour.
    assert row_in(cells[(7.0, True)], "P0").missed_danger_hours.value == pytest.approx(1.0)
    assert row_in(cells[(7.0, False)], "P0").missed_danger_hours.value == pytest.approx(0.0)


def test_a_ruleset_with_the_withdrawal_switch_on_makes_that_cell_the_headline() -> None:
    ruleset = released_ruleset()
    section = ruleset.twl_withdrawal.model_copy(update={"enabled": True})
    switched = ruleset.model_copy(update={"twl_withdrawal": section})
    entries = [E(at(2025, 7, 1, 6), truth=130.0, t_c=46.0), E(at(2025, 7, 1, 7))]
    board = scoreboards.warnings_scoreboard(
        make_rows(entries),
        theta_protect=0.30,
        theta_balanced=0.35,
        ruleset=switched,
        params=default_params(),
        context=context(date(2025, 7, 1), date(2025, 7, 1)),
        leads=(1,),
    )
    headline = next(c for c in board.sensitivity if c.headline)
    assert (headline.margin_w_m2, headline.withdrawal_limits) == (7.0, True)
    assert board.withdrawal_limits is True
    assert board.leads[0].truth_danger_hours.value == pytest.approx(1.0)  # the headline truth applies the cap
    assert headline.truth_danger_hours.value == pytest.approx(1.0)


def test_the_withdrawal_cell_is_described_as_dry_bulb_only() -> None:
    for text in (SensitivityCell.model_fields["withdrawal_limits"].description, scoreboards.__doc__):
        assert text is not None
        flat = " ".join(text.split())
        assert "dry-bulb leg only (> 44 C)" in flat
        assert "no natural wet-bulb source exists" in flat


# --- High or Red (amendment 1 section 2.3) --------------------------------------------------------------------------


def test_red_hours_are_danger_hours_for_the_truth_and_for_p2_and_p3() -> None:
    # 1 July (08Z weighs 0.5). 06Z: truth Red, raw Red, 50 of 50 samples High-or-Red. 07Z: truth Red, raw Low, no
    # sample. 08Z: truth Low, raw Red (P2 warns), 50 of 50 samples (P3 warns).
    # Truth danger hours: 06Z + 07Z = 2 (08Z is calm). P2 and P3 warn 06Z (hit, 1) and 08Z (false alarm, 0.5): hits 1,
    # missed 1 (07Z), false alarms 0.5: POD 1 / 2, FAR 0.5 / 1.5.
    entries = [
        E(at(2025, 7, 1, 6), truth=RED_TRUTH, raw_eff=RED_EFF, n_high=50),
        E(at(2025, 7, 1, 7), truth=RED_TRUTH),
        E(at(2025, 7, 1, 8), raw_eff=RED_EFF, n_high=50),
    ]
    board = one_day_board(entries)
    assert board.leads[0].truth_danger_hours.value == pytest.approx(2.0)
    for policy in ("P2", "P3_protect", "P3_balanced"):
        r = row(board, policy)
        assert r.missed_danger_hours.value == pytest.approx(1.0), policy
        assert r.false_alarm_hours.value == pytest.approx(0.5), policy
        assert r.pod.value == pytest.approx(0.5), policy
        assert r.far.value == pytest.approx(0.5 / 1.5), policy
    assert row(board, "P0").missed_danger_hours.value == pytest.approx(2.0)


# --- bootstrap intervals of ratios (R-AQ) ----------------------------------------------------------------------------

SPARSE_DAYS: Final = [date(2025, 4, 1) + timedelta(days=i) for i in range(40)]  # 40 days before the ban season


def sparse_board(warn_days: dict[int, bool]) -> PolicyScoreboard:
    """P1 warns the 06Z hour on each day of ``warn_days`` (value True: it is a danger hour, so a hit; False: calm, so a
    false alarm). Every day also has a calm 07Z hour that nobody warns."""
    entries: list[E] = []
    for index, d in enumerate(SPARSE_DAYS):
        warned = index in warn_days
        truth = HIGH_TRUTH if warn_days.get(index) else LOW_TRUTH
        entries.append(hr(d, 6, truth=truth, raw_wbgt=33.0 if warned else 25.0))
        entries.append(hr(d, 7))
    return scoreboards.warnings_scoreboard(
        make_rows(entries),
        theta_protect=0.30,
        theta_balanced=0.35,
        ruleset=released_ruleset(),
        params=default_params(),
        context=context(SPARSE_DAYS[0], SPARSE_DAYS[-1]),
        leads=(1,),
    )


def far_daily(warn_days: dict[int, bool]) -> pl.DataFrame:
    """The per-day (false alarms, hits + false alarms) of ``sparse_board``'s P1: (1, 1) on a false-alarm day, (0, 1) on
    a hit day, (0, 0) when P1 does not warn."""
    return pl.DataFrame(
        {
            "day": pl.Series(SPARSE_DAYS, dtype=pl.Date),
            "value": [1.0 if warn_days.get(i) is False else 0.0 for i in range(40)],
            "weight": [1.0 if i in warn_days else 0.0 for i in range(40)],
        }
    )


def test_a_sparse_policy_keeps_its_interval_when_a_few_replicates_are_undefined() -> None:
    # P1 warns on 4 of 40 days (days 3 and 25 are hits, 14 and 36 are false alarms): FAR = 2 / 4 = 0.5. A resample of
    # six 7-day blocks misses all four days in about 1% of the 2,000 replicates (each day is missed with (33/40)^6 =
    # 0.31 and the four are nearly independent), far below the 5% limit, so the interval stays, taken over the defined
    # replicates; the old rule (any undefined replicate drops it) would have returned none.
    warn_days = {3: True, 14: False, 25: True, 36: False}
    with pytest.raises(ValueError, match="undefined"):
        bootstrap.block_bootstrap(far_daily(warn_days), value="value", weight="weight")
    far = row(sparse_board(warn_days), "P1").far
    assert far.value == pytest.approx(0.5)
    assert far.ci is not None
    assert 0.0 <= far.ci.lo <= 0.5 <= far.ci.hi <= 1.0
    assert far.n == 4


def test_a_policy_with_most_replicates_undefined_has_no_interval_but_keeps_its_value() -> None:
    # P1 warns on ONE of 40 days (a false alarm): FAR = 1 / 1 = 1. That day is missed by 31% of the replicates, far
    # above 5% (100 of 2,000), so there is no interval; the value and the sample size stay.
    far = row(sparse_board({7: False}), "P1").far
    assert far.value == pytest.approx(1.0)
    assert (far.ci, far.n) == (None, 1)


def test_a_policy_that_never_warns_keeps_a_null_interval_and_no_observations() -> None:
    far = row(sparse_board({}), "P1").far
    assert (far.value, far.ci, far.n) == (0.0, None, 0)


def test_a_ratio_interval_with_every_replicate_defined_is_the_bootstrap_modules_own() -> None:
    # 12 days; P1 warns the danger hour 06Z on days i % 3 != 0 (hits) and the calm hour 07Z on days i % 2 == 0 (false
    # alarms): the per-day FAR numerator is the false alarm, the denominator hits + false alarms (0 on days 3 and 9).
    entries: list[E] = []
    for index in range(12):
        d = SPAN[0] + timedelta(days=index)
        entries.append(hr(d, 6, truth=HIGH_TRUTH, raw_wbgt=33.0 if index % 3 else 25.0))
        entries.append(hr(d, 7, raw_wbgt=33.0 if index % 2 == 0 else 25.0))
    far = row(span_board(entries), "P1").far
    hits = [1.0 if i % 3 else 0.0 for i in range(12)]
    alarms = [1.0 if i % 2 == 0 else 0.0 for i in range(12)]
    expected = bootstrap.block_bootstrap(
        pl.DataFrame(
            {
                "day": pl.Series([SPAN[0] + timedelta(days=i) for i in range(12)], dtype=pl.Date),
                "value": alarms,
                "weight": [h + a for h, a in zip(hits, alarms, strict=True)],
            }
        ),
        value="value",
        weight="weight",
    )
    assert far.ci is not None
    assert (far.value, far.ci.lo, far.ci.hi) == pytest.approx((expected.estimate, expected.lo, expected.hi))


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


def plan_rows(*, truth: float = RED_TRUTH, protective: float = RED_EFF) -> pl.DataFrame:
    """Ten off-season days, every modelled hour 02-15 UTC at lead 1.

    Days 0-4: truth, raw and corrected are Low all day. Days 5-9: the truth is ``truth`` (Red by default, effective 73;
    ``HIGH_TRUTH`` is High, effective 93) at the labels 11-14 UTC (15:00-18:00 GST, the afternoon block of L1) and Low
    elsewhere; the raw forecast says Low all day (it misses the afternoon); the corrected q10 is ``protective`` at
    11-14 UTC (it catches it).
    """
    entries = []
    for d in range(10):
        day = SEASON[0] + timedelta(days=d)
        for hour in range(2, 16):
            afternoon = d >= 5 and 11 <= hour <= 14
            entries.append(
                E(
                    at(day.year, day.month, day.day, hour),
                    truth=truth if afternoon else LOW_TRUTH,
                    protective=protective if afternoon else LOW_EFF,
                )
            )
    return make_rows(entries)


def crew_b() -> object:
    return crew_spec(load_fixture(BACKEND / "fixtures" / "demo_site.toml"), "crew-b")


def plans_board(rows: pl.DataFrame | None = None) -> PlanScoreboard:
    return scoreboards.plans_scoreboard(
        plan_rows() if rows is None else rows,
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


def test_a_truth_high_afternoon_that_is_not_red_is_scored_by_the_cycle_rules() -> None:
    # The same ten days with the afternoon block (36 ticks, 15:00-18:00 GST) truth High (effective 93, not Red). The
    # corrected q10 says High there; the raw forecast says Low.
    board = plans_board(plan_rows(truth=HIGH_TRUTH, protective=HIGH_EFF))
    # Truth High attendance ticks: 5 days x 36 = 180. Cycled (plan zone High or worse): the corrected plan 180 of 180,
    # the plans that plan Low none.
    assert plan(board, "naive").high_cycled_share.value == 0.0
    assert plan(board, "rule_raw").high_cycled_share.value == 0.0
    assert plan(board, "rule_corrected").high_cycled_share.value == pytest.approx(1.0)
    assert plan(board, "rule_corrected").high_cycled_share.n == 180
    # Missed protection: worked ticks of a truth-High tick whose plan zone (Low) is milder than the truth zone (High):
    # all 36 afternoon ticks of the 5 days = 180 for naive, ban only and the raw-IFS plan. The corrected plan's zone is
    # High, not milder than the truth: 0 (a plan that cycles correctly is not "lighter").
    for name in ("naive", "ban_only", "rule_raw"):
        assert plan(board, name).missed_protection_ticks.value == pytest.approx(180.0), name
    assert plan(board, "rule_corrected").missed_protection_ticks.value == 0.0
    # Violation minutes. Working all 36 ticks through High (heavy: work 20, rest 40, cap 20 min of work in any 60)
    # breaks P-H7.cap60 in every 12-tick window with at least 5 work ticks (25 min > 20): window starts from 7 ticks
    # before the block to the 5th-last block tick (start + 4 <= last), whose union is 7 ticks before the block to 7
    # ticks after its end = 36 + 14 = 50 ticks (the P-H7.run ticks lie inside): 50 x 5 = 250 min a day, 1,250 over 5
    # days.
    for name in ("naive", "ban_only", "rule_raw"):
        assert plan(board, name).violation_minutes_per_season.value == pytest.approx(1250.0), name
    # The corrected plan cycles 20 work / 40 rest through the block (3 hours = 3 cycles): no violation, and 3 x 40 = 120
    # rest minutes a day over naive, 600 over 5 days.
    assert plan(board, "rule_corrected").violation_minutes_per_season.value == pytest.approx(0.0)
    assert plan(board, "rule_corrected").rest_minutes_added_vs_naive.value == pytest.approx(600.0)
    h6, h7 = board.verdicts
    assert h6.comparisons[0].difference.value == pytest.approx(-1250.0)
    assert h6.outcome == "supported"
    assert h7.comparisons[0].difference.value == pytest.approx(-180.0)
    assert h7.outcome == "supported"


def test_the_fewer_or_more_words_print_the_magnitude() -> None:
    assert scoreboards.fewer_or_more(-900.0, "rule-violation minutes") == "900 fewer rule-violation minutes"
    assert scoreboards.fewer_or_more(37.0, "rule-violation minutes") == "37 more rule-violation minutes"
    assert scoreboards.fewer_or_more(0.0, "rule-violation minutes") == "no change in rule-violation minutes"
    assert scoreboards.fewer_or_more(-0.2, "ticks") == "no change in ticks"  # rounds to zero


def test_the_plans_verdict_texts_never_print_a_negative_count() -> None:
    h6, h7 = plans_board().verdicts
    assert "has 900 fewer rule-violation minutes per worker-season than ban only" in h6.text
    assert "-900" not in h6.text
    assert "180 fewer missed-protection ticks than the raw-IFS rule plan" in h7.text
    assert "-180" not in h7.text


def test_a_negative_plans_row_says_the_zone_engine_and_validator_do_the_work() -> None:
    # The afternoons are Red for the truth but the corrected q10 says Low (it misses them as the raw forecast does): the
    # corrected plan then has the same violations as ban only, a difference of 0, so H6 fails.
    board = plans_board(plan_rows(protective=LOW_EFF))
    h6 = board.verdicts[0]
    assert h6.outcome == "negative"
    assert h6.comparisons[0].difference.value == pytest.approx(0.0)
    assert "The zone engine and validator do the work; the forecast adds the honest range." in h6.text
    assert "protecting" not in h6.text
    assert "no change in rule-violation minutes per worker-season against ban only" in h6.text


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


def demo_day(*, truth_twl: float = HIGH_TRUTH, raw_eff_at_6: float = LOW_EFF) -> DemoDay:
    day = date(2025, 7, 1)
    entries = [
        E(
            at(2025, 7, 1, h),
            truth=truth_twl if h in (6, 7, 8) else LOW_TRUTH,
            raw_wbgt=33.0,
            raw_eff=raw_eff_at_6 if h == 6 else LOW_EFF,
            n_high=40,
        )
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


def test_red_hours_are_danger_hours_on_the_demo_day() -> None:
    # Truth Red (not High) at 06Z, 07Z and 08Z; the raw forecast is Red at 06Z only; P3 (n_high 40 of 50) warns every
    # hour.
    shown = demo_day(truth_twl=RED_TRUTH, raw_eff_at_6=RED_EFF)
    # 3 Red hours, the 08Z one weighs 0.5: the selection score (and the days' candidates) count Red.
    assert shown.high_hours == 3.0
    assert shown.score == shown.high_hours_outside_ban == 2.5
    assert shown.hours[0].truth_zone == "red"
    assert shown.hours[0].raw_zone == "red"
    assert shown.hours[1].raw_zone == "low"
    # P2 warns 06Z only (hit weight 1); P3 warns all three Red hours (1 + 1 + 0.5).
    assert shown.raw_hits == 1.0
    assert shown.p3_hits == 2.5
    assert shown.hours[0].warned_by == ["P1", "P2", "P3_protect", "P3_balanced"]
    assert shown.hours[1].warned_by == ["P1", "P3_protect", "P3_balanced"]


def test_the_demo_day_selection_counts_red_hours() -> None:
    # Day A: three Red hours (06Z-08Z, score 2.5); day B: one High hour (06Z, score 1): a selection that dropped Red
    # would score A at 0 and pick B.
    first, second = date(2025, 7, 1), date(2025, 7, 2)
    entries_a, _ = day_entries(first, 0)
    entries_b, _ = day_entries(second, 1)
    entries_a = [replace(e, truth=RED_TRUTH) if e.t.hour in (6, 7, 8) else e for e in entries_a]
    rows = make_rows(entries_a + entries_b)
    truth = rows.select("valid_time", "has_joint_obs", "truth_twl", "truth_t_c", "wbgt_obs_reject")
    chosen = select_demo_day(
        truth,
        pl.DataFrame({"valid_time": rows["valid_time"], "present": [True] * rows.height}),
        released_ruleset(),
        default_params(),
        season=(first, second),
    )
    assert chosen.date == first
    assert chosen.score == 2.5
    assert chosen.runner_up is not None
    assert (chosen.runner_up.date, chosen.runner_up.score) == (second, 1.0)


def test_the_demo_day_is_chosen_on_truth_alone() -> None:
    # Pre-registration 7.4: the day is selected before any P3 output is read. Rewriting every forecast value of the
    # frame (the raw WBGT and effective TWL, the High-sample counts and the protective quantile) must not move the
    # selection, the score or the runner-up: only the truth columns and the presence of forecast inputs are read.
    days = [date(2025, 5, 20) + timedelta(days=i) for i in range(5)]
    entries: list[E] = []
    for index, d in enumerate(days):
        built, _ = day_entries(d, index + 1 if index != 3 else 6)
        entries += built
    rows = make_rows(entries)
    inputs = ScoringInputs(rows=rows, reject_available=True, wbgt=lambda _day: pl.DataFrame())
    altered = rows.with_columns(
        pl.col("raw_wbgt_c") * 0.0 + 41.0,
        pl.col("raw_twl_eff") * 0.0 + RED_EFF,
        pl.col("n_high") * 0.0 + 50.0,
        pl.col("protective_twl") * 0.0 + RED_EFF,
    )
    changed = ScoringInputs(rows=altered, reject_available=True, wbgt=lambda _day: pl.DataFrame())
    assert altered["raw_wbgt_c"].to_list() != rows["raw_wbgt_c"].to_list()

    def selected(source: ScoringInputs) -> scoreboards.DemoSelection:
        return select_demo_day(
            source.truth_frame(),
            source.present_frame(),
            released_ruleset(),
            default_params(),
            season=(days[0], days[-1]),
        )

    assert selected(changed) == selected(inputs)
    assert selected(inputs).date == days[3]  # 6 High hours: the maximum


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
