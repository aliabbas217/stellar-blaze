"""The Warnings scoreboard, the demo day and the Plans scoreboard (pre-registration 7.2, 7.3, 7.4, 8 and 13).

Pure scoring: every function takes a frame of station-hours and returns a typed artefact of ``domain.scoreboard``.
Nothing here reads a file, opens the gate or touches the 2026 data; the builders in ``ml.scoreboard_inputs`` make the
frames (from the 2025 out-of-fold export or, behind the gate, from 2026) and ``jobs.evaluate_2026`` writes the files.

The scoring frame (one row per station-hour-lead; floats are NaN where missing, never filled):

* ``valid_time`` (UTC), ``lead_days``;
* ``truth_twl`` (TWL from the observed T, Td and wind, no margin), ``truth_t_c`` (for the withdrawal cap);
* ``raw_wbgt_c`` (the raw IFS WBGT forecast, P1) and ``raw_twl_eff`` (raw IFS effective TWL: margin and the ruleset's
  withdrawal switch applied, P2);
* ``n_high`` and ``n_finite`` (corrected joint samples in the High or Red zone, and finite samples: P3 warns when
  ``n_high / n_finite >= theta``, the integer ratio of ``domain.risk.levels.hour_levels``), ``protective_twl`` (the 10th
  percentile of the corrected effective TWL, ``inverted_cdf``).

Definitions, all from the pre-registration (and amendment 1):

* A truth danger hour is a worked hour whose truth effective TWL is in the High or Red zone; every hour counts with its
  non-ban fraction (``hour_ban_weight``: 08 UTC in the ban season weighs 0.5, 09 and 10 UTC weigh 0).
* Every policy is scored on the SAME hours: truth finite, raw WBGT and raw TWL finite and at least one finite corrected
  sample. P0 warns nothing on a worked hour (it warns only the ban hours, which are not worked).
* Missed hours Sum w[danger and not warned]; false-alarm hours Sum w[warned and not danger]; POD = hits / (hits +
  missed); FAR = false alarms / (hits + false alarms); CSI = hits / (hits + missed + false alarms) (weighted sums).
  Alerts per shift is the number of runs of consecutive warned worked hours per day. Crew-hours are hours x 20
  (ASSUMED).
* Intervals: moving-block bootstrap over days, blocks of 7 days, B = 2,000, seed 20261112 (``ml.bootstrap``). Hour and
  tick totals resample the per-day values of EVERY day of the season (an unscored day counts 0) and scale the
  interval by the number of season days, so the estimate is exactly the total. Ratios resample (numerator,
  denominator) per day.
  A ratio with no denominator at all (for example FAR of P0, which never warns) is reported as ``value`` 0, ``ci`` null
  and ``n`` 0. A bootstrap replicate whose resampled days hold no denominator (a sparse policy: it warned on a few
  days only) is undefined and is dropped from the percentile interval (ruling R-AQ); the interval is null, with the
  value kept, when MORE than 5% of the replicates (more than 100 of the 2,000) are undefined. The count of undefined
  replicates is not written to the file: ``Metric`` has no field for it and adding one would change the contract.
* The three phrases the pre-registration leaves open are read as follows (the freeze addendum records the readings):

  - H4 and H6 are supported only when the paired interval of EVERY named difference lies wholly below zero (the
    interval excludes zero in the stated direction, "fewer"); H7 follows H6.
  - H5's "without more false-alarm hours than P2 + 25%" has no interval rule: it is read as the point estimate
    FA(P3) <= 1.25 x FA(P2), in addition to the paired interval of the missed hours wholly below zero.
  - Section 13's "If P2 >= P3" (H4 fails and P2 is shown as the recommended policy) is read as P2 at least as good as P3
    on BOTH missed and false-alarm hours, by point estimates (equal counts count as at least as good).

* Section 13's "Lead 2 (strict) contradicts lead 1 on H4" needs the H4 verdict AT lead 2: ``warnings_scoreboard``
  applies the same rule (same paired bootstrap, blocks and seed) to the lead-2 rows and adds the verdict ``H4-lead2``.
  The stamp "issued by 18:00 GST the evening before" may be carried only when H4 holds at lead 2; where H4 holds at
  lead 1 but not at lead 2 the text says the stamp is dropped from the video and the strict number is shown. With no
  scorable lead-2 row (the dev export) there is no ``H4-lead2`` verdict and the lead-2 entry says "not available".
* The withdrawal "on" cell of the 2 x 2 sensitivity is dry-bulb leg only (> 44 C); no natural wet-bulb source exists,
  so the second leg of the ADR 0006 rule is not applied.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Final, Literal, cast
from zoneinfo import ZoneInfo

import numpy as np
import polars as pl
from numpy.typing import NDArray

from stellar_blaze.domain.config.runtime import EffectiveParams
from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.planner.rule_planner import plan_crew
from stellar_blaze.domain.plans.model import CrewPlan, CrewSpec, TickState, ZoneTimeline
from stellar_blaze.domain.plans.rules import PlannerRules, planner_rules
from stellar_blaze.domain.plans.ticks import TICK_MINUTES, day_ticks, hour_ban_weight, in_ban, zone_timeline
from stellar_blaze.domain.risk.levels import Zone, ZoneEdges, zone_of
from stellar_blaze.domain.risk.twl_samples import effective_twl
from stellar_blaze.domain.rules.ruleset import LabourRules, Ruleset
from stellar_blaze.domain.scoreboard import (
    DemoDay,
    DemoDayHour,
    EvaluationSet,
    HypothesisVerdict,
    Interval,
    LeadResult,
    Metric,
    PairedComparison,
    PlanId,
    PlanRow,
    PlanScoreboard,
    PolicyId,
    PolicyRow,
    PolicyScoreboard,
    Provenance,
    ProvenanceLabel,
    RunnerUp,
    SensitivityCell,
    WbgtQuantiles,
    ZoneName,
)
from stellar_blaze.domain.validator.validator import validate_plan
from stellar_blaze.ml import bootstrap
from stellar_blaze.ml.bootstrap import _layout, _percentile_interval, _replicate_sums
from stellar_blaze.ml.exporters import github_slug
from stellar_blaze.ml.twl_rows import SITE_TIMEZONE, frozen_withdrawal

__all__ = [
    "ASSUMED_CREW_SIZE",
    "DEMO_ANCHOR",
    "DEMO_HEADING",
    "PLANS_ANCHOR",
    "PLANS_HEADING",
    "WARNINGS_ANCHOR",
    "WARNINGS_HEADING",
    "WORKING_HOURS",
    "BoardContext",
    "DemoSelection",
    "ban_weights",
    "fewer_or_more",
    "fill_demo_day",
    "plans_scoreboard",
    "select_demo_day",
    "warnings_scoreboard",
]

WARNINGS_HEADING: Final = (
    "7.2 Warnings row (B3 computes; definitions fixed here; `artifacts/eval/2026/policy_scoreboard.json`)"
)
PLANS_HEADING: Final = (
    "7.3 Plans row (B3 computes; ADR 0011 §9 metrics 1-3; `artifacts/eval/2026/plan_scoreboard.json`)"
)
DEMO_HEADING: Final = '7.4 Demo day ("day zoom") selection rule'
"""The headings of the sections the scoreboards follow, as written in the pre-registration (a test pins all three)."""

WARNINGS_ANCHOR: Final = "#" + github_slug(WARNINGS_HEADING)
PLANS_ANCHOR: Final = "#" + github_slug(PLANS_HEADING)
DEMO_ANCHOR: Final = "#" + github_slug(DEMO_HEADING)

WORKING_HOURS: Final = range(6, 15)
"""Working daytime in UTC hours, 06:00-14:59 (10:00-18:59 GST)."""

ASSUMED_CREW_SIZE: Final = 20
CREW_LABEL: Final = "assumed crew of 20 doing heavy work (ASSUMED)"
WBGT_NAIVE_C: Final = 32.0
HEADLINE_LEAD: Final = 1
STRICT_LEAD: Final = 2
FALSE_ALARM_ALLOWANCE: Final = 1.25
"""H5: P3 may raise false-alarm hours up to P2 + 25%, read as the point estimate FA(P3) <= 1.25 x FA(P2) (no interval
rule is pre-registered for the allowance)."""

BOOTSTRAP_BLOCK_DAYS: Final = 7
BOOTSTRAP_REPLICATES: Final = 2000
UNDEFINED_REPLICATE_LIMIT: Final = 0.05
"""A ratio's interval is null when more than this share of its replicates is undefined (R-AQ)."""

_HOUR: Final = np.timedelta64(1, "h")
_LEAD_LABELS: Final = {
    1: "about 24 hours ahead",
    2: "issued by 18:00 GST the evening before",
    3: "about 3 days ahead",
    5: "about 5 days ahead (report only)",
    7: "about 7 days ahead (report only)",
}
_POLICY_LABELS: Final[dict[PolicyId, str]] = {
    "P0": "Ban only",
    "P1": "Naive WBGT >= 32 (raw IFS)",
    "P2": "ADOSH zones on raw IFS",
    "P3_protect": "Stellar Blaze, protective threshold",
    "P3_balanced": "Stellar Blaze, balanced threshold",
}
_POLICY_ORDER: Final[tuple[PolicyId, ...]] = ("P0", "P1", "P2", "P3_protect", "P3_balanced")


@dataclass(frozen=True)
class BoardContext:
    """What every artefact of one evaluation records about itself: the frozen inputs and the numbers' origin."""

    evaluation_set: EvaluationSet
    station: str
    season_start: date
    season_end: date
    ruleset_id: str
    ruleset_sha256: str
    provenance: Provenance
    evaluation_label: str | None = None

    def stamped(self, anchor: str, function: str, label: ProvenanceLabel) -> Provenance:
        return self.provenance.model_copy(update={"protocol_anchor": anchor, "function": function, "label": label})

    @property
    def season_days(self) -> int:
        return (self.season_end - self.season_start).days + 1


def _require(rows: pl.DataFrame, columns: Sequence[str]) -> None:
    missing = [name for name in columns if name not in rows.columns]
    if missing:
        raise ValueError(f"the scoring frame lacks the column(s) {missing}")


def _labour(ruleset: Ruleset) -> LabourRules:
    if ruleset.labour is None:
        raise ValueError(f"ruleset {ruleset.meta.id} has no labour section: the ban weights cannot be computed")
    return ruleset.labour


def ban_weights(valid_time: pl.Series, ruleset: Ruleset) -> F64:
    """The non-ban fraction of each hour (``hour_ban_weight`` of the site's local date): 08 UTC in season is 0.5."""
    labour, tz = _labour(ruleset), ZoneInfo(SITE_TIMEZONE)
    return np.array([hour_ban_weight(t.astimezone(UTC), tz, labour) for t in valid_time.to_list()], dtype=np.float64)


def _floats(rows: pl.DataFrame, name: str) -> F64:
    return np.asarray(rows[name].cast(pl.Float64).fill_null(float("nan")).to_numpy(), dtype=np.float64)


# === the hours of one lead ===========================================================================================


@dataclass(frozen=True)
class _Season:
    """The days of the scored season (the bootstrap resamples every one of them, scored or not)."""

    dates: pl.Series

    @property
    def n_days(self) -> int:
        return int(self.dates.len())


@dataclass(frozen=True)
class _Hours(_Season):
    """The scored arrays of one lead, sorted by time, restricted to the season and working daytime."""

    time: NDArray[np.datetime64]
    day: NDArray[np.int64]
    w: F64
    truth_twl: F64
    truth_t: F64
    raw_wbgt: F64
    raw_eff: F64
    n_high: F64
    n_finite: F64
    ok: NDArray[np.bool_]

    def daily(self, values: F64) -> F64:
        return np.asarray(np.bincount(self.day, weights=values, minlength=self.n_days), dtype=np.float64)

    @property
    def counted(self) -> NDArray[np.bool_]:
        """Scored hours that are worked (weight above 0)."""
        return self.ok & (self.w > 0.0)


def _season_dates(context: BoardContext) -> pl.Series:
    return pl.date_range(context.season_start, context.season_end, interval="1d", eager=True).alias("day")


def _hours(rows: pl.DataFrame, lead: int, context: BoardContext, ruleset: Ruleset) -> _Hours | None:
    dates = _season_dates(context)
    frame = (
        rows.filter(
            (pl.col("lead_days") == lead)
            & pl.col("valid_time").dt.hour().is_in(list(WORKING_HOURS))
            & pl.col("valid_time").dt.date().is_between(context.season_start, context.season_end)
        )
        .sort("valid_time")
        .with_columns(pl.col("valid_time").dt.date().alias("_day"))
    )
    if frame.is_empty():
        return None
    if frame["valid_time"].is_duplicated().any():
        raise ValueError(f"lead {lead} has two rows for one valid_time: one station per scoring frame")
    day = (
        (frame["_day"].to_numpy().astype("datetime64[D]") - np.datetime64(context.season_start, "D"))
        // np.timedelta64(1, "D")
    ).astype(np.int64)
    truth, raw_eff = _floats(frame, "truth_twl"), _floats(frame, "raw_twl_eff")
    raw_wbgt, n_finite = _floats(frame, "raw_wbgt_c"), _floats(frame, "n_finite")
    ok = np.isfinite(truth) & np.isfinite(raw_eff) & np.isfinite(raw_wbgt) & (n_finite > 0)
    return _Hours(
        time=np.asarray(frame["valid_time"].dt.replace_time_zone(None).to_numpy(), dtype="datetime64[us]"),
        day=day,
        dates=dates,
        w=ban_weights(frame["valid_time"], ruleset),
        truth_twl=truth,
        truth_t=_floats(frame, "truth_t_c"),
        raw_wbgt=raw_wbgt,
        raw_eff=raw_eff,
        n_high=_floats(frame, "n_high"),
        n_finite=n_finite,
        ok=ok,
    )


# === bootstrap helpers ==============================================================================================


def _daily_frame(hours_dates: pl.Series, value: F64, weight: F64) -> pl.DataFrame:
    return pl.DataFrame({"day": hours_dates, "value": value, "weight": weight})


def _total(h: _Season, daily: F64, *, n: int, anchor: str, scale: float = 1.0) -> Metric:
    """The season total of a per-day sum (estimate and interval scaled by the season length and ``scale``)."""
    result = bootstrap.block_bootstrap(_daily_frame(h.dates, daily, np.ones(h.n_days)), value="value", weight="weight")
    k = h.n_days * scale
    return Metric(value=result.estimate * k, ci=Interval(lo=result.lo * k, hi=result.hi * k), n=n, anchor=anchor)


def _ratio(h: _Season, numerator: F64, denominator: F64, *, n: int, anchor: str) -> Metric:
    """``sum(numerator) / sum(denominator)`` with its interval; 0, no interval, ``n`` 0 when there is no denominator.

    The replicates are ``ml.bootstrap``'s own (same layout, blocks and seed, so a dense ratio gets exactly the interval
    ``block_bootstrap`` would give). A replicate that resampled only days without a denominator is undefined and is
    dropped; the interval is null (value kept) when more than ``UNDEFINED_REPLICATE_LIMIT`` of them are (R-AQ).
    """
    if float(denominator.sum()) <= 0.0:
        return Metric(value=0.0, ci=None, n=0, anchor=anchor)
    value = float(numerator.sum() / denominator.sum())
    layout, matrix = _layout(_daily_frame(h.dates, numerator, denominator), value="value", weight="weight")
    sums = _replicate_sums(
        layout, matrix, block_days=BOOTSTRAP_BLOCK_DAYS, n_boot=BOOTSTRAP_REPLICATES, seed=bootstrap.DEFAULT_SEED
    )
    defined = sums[:, 1] > 0.0
    if int((~defined).sum()) > UNDEFINED_REPLICATE_LIMIT * BOOTSTRAP_REPLICATES:
        return Metric(value=value, ci=None, n=n, anchor=anchor)
    lo, hi = _percentile_interval(sums[defined, 0] / sums[defined, 1], 0.95)
    return Metric(value=value, ci=Interval(lo=lo, hi=hi), n=n, anchor=anchor)


def _paired_total(h: _Season, a: F64, b: F64, *, n: int, anchor: str) -> Metric:
    """The season total of ``a - b`` per day, with the paired interval (both resampled on the same blocks)."""
    ones = np.ones(h.n_days)
    result = bootstrap.paired_block_bootstrap(
        _daily_frame(h.dates, a, ones), _daily_frame(h.dates, b, ones), value="value", weight="weight"
    )
    k = float(h.n_days)
    return Metric(value=result.estimate * k, ci=Interval(lo=result.lo * k, hi=result.hi * k), n=n, anchor=anchor)


# === the Warnings row ===============================================================================================


def _p3_warned(h: _Hours, theta: float) -> NDArray[np.bool_]:
    share = np.divide(h.n_high, h.n_finite, out=np.zeros(h.n_high.shape), where=h.n_finite > 0)
    return np.asarray((h.n_finite > 0) & (share >= theta), dtype=np.bool_)


def _warned(
    h: _Hours, edges: ZoneEdges, theta_protect: float, theta_balanced: float
) -> dict[PolicyId, NDArray[np.bool_]]:
    return {
        "P0": np.zeros(h.ok.shape, dtype=np.bool_),  # a ban hour is not a worked hour: nothing is warned on one
        "P1": np.asarray(h.raw_wbgt >= WBGT_NAIVE_C, dtype=np.bool_),
        "P2": np.asarray(zone_of(h.raw_eff, edges) >= int(Zone.HIGH), dtype=np.bool_),
        "P3_protect": _p3_warned(h, theta_protect),
        "P3_balanced": _p3_warned(h, theta_balanced),
    }


def _runs(h: _Hours, warned: NDArray[np.bool_]) -> F64:
    """Per day, the runs of consecutive warned worked hours (a run starts where the previous hour was not warned)."""
    flag = warned & h.counted
    previous = np.concatenate([[False], flag[:-1]])
    adjacent = np.concatenate([[False], (h.time[1:] - h.time[:-1]) == _HOUR])
    return h.daily((flag & ~(previous & adjacent)).astype(np.float64))


def _rule(policy: PolicyId, theta: float | None) -> str:
    match policy:
        case "P0":
            return (
                "Warns only the midday-ban hours (12:30-15:00 GST, 15 Jun-15 Sep), which are not worked hours: it "
                "warns nothing on a worked hour."
            )
        case "P1":
            return "Warns an hour when the raw IFS WBGT forecast is 32 C or higher."
        case "P2":
            return "Warns an hour when the raw IFS effective TWL is in the High or Red zone (below 115 W/m2)."
        case _:
            return f"Warns an hour when P(High or Red) of the corrected joint samples is at least {theta}."


def _policy_row(
    h: _Hours, policy: PolicyId, warned: NDArray[np.bool_], danger: NDArray[np.bool_], theta: float | None
) -> PolicyRow:
    ok, w = h.ok, h.w
    hit = h.daily(np.where(ok & danger & warned, w, 0.0))
    miss = h.daily(np.where(ok & danger & ~warned, w, 0.0))
    false_alarm = h.daily(np.where(ok & ~danger & warned, w, 0.0))
    counted = h.counted
    n_hours = int(counted.sum())
    anchor = WARNINGS_ANCHOR
    missed = _total(h, miss, n=n_hours, anchor=anchor)
    alarms = _total(h, false_alarm, n=n_hours, anchor=anchor)
    shift_days = h.daily(counted.astype(np.float64)) > 0
    return PolicyRow(
        policy=policy,
        label=_POLICY_LABELS[policy] + (f" (theta {theta})" if theta is not None else ""),
        rule=_rule(policy, theta),
        theta=theta,
        missed_danger_hours=missed,
        false_alarm_hours=alarms,
        pod=_ratio(h, hit, hit + miss, n=int((counted & danger).sum()), anchor=anchor),
        far=_ratio(h, false_alarm, hit + false_alarm, n=int((counted & warned).sum()), anchor=anchor),
        csi=_ratio(h, hit, hit + miss + false_alarm, n=int((counted & (danger | warned)).sum()), anchor=anchor),
        alerts_per_shift=_ratio(
            h, _runs(h, warned), shift_days.astype(np.float64), n=int(shift_days.sum()), anchor=anchor
        ),
        missed_danger_crew_hours=_total(h, miss, n=n_hours, anchor=anchor, scale=ASSUMED_CREW_SIZE),
        false_alarm_crew_hours=_total(h, false_alarm, n=n_hours, anchor=anchor, scale=ASSUMED_CREW_SIZE),
    )


def _truth_danger(
    h: _Hours, ruleset: Ruleset, edges: ZoneEdges, *, margin: float, withdrawal: bool
) -> NDArray[np.bool_]:
    """Truth danger hours (High or Red) under one cell of the 2 x 2: ``withdrawal`` applies the dry-bulb leg only.

    The cap of the ruleset's ``[twl_withdrawal]`` applies where the observed dry bulb is above its limit (44 C); no
    natural wet-bulb source exists, so the second leg of the ADR 0006 rule is not applied. The cap comes first, then
    the margin (ADR 0047).
    """
    effective = effective_twl(
        h.truth_twl,
        margin_w_m2=margin,
        withdrawal=frozen_withdrawal(ruleset) if withdrawal else None,
        t_c=h.truth_t,
        tnwb_c=None,  # the product has no natural wet-bulb source: "on" applies the dry-bulb cap only
    )
    return np.asarray(zone_of(effective, edges) >= int(Zone.HIGH), dtype=np.bool_)


def _danger_metric(h: _Hours, danger: NDArray[np.bool_]) -> Metric:
    return _total(
        h, h.daily(np.where(h.ok & danger, h.w, 0.0)), n=int((h.counted & danger).sum()), anchor=WARNINGS_ANCHOR
    )


def _lead_label(lead: int, context: BoardContext, *, available: bool) -> str:
    label = _LEAD_LABELS.get(lead, f"about {lead} days ahead")
    if available:
        return label
    where = "the dev export" if context.evaluation_set == "dev_2025" else "this evaluation set"
    return f"{label}; not available in {where}"


def _rows_for(
    h: _Hours, danger: NDArray[np.bool_], warned: dict[PolicyId, NDArray[np.bool_]], thetas: dict[PolicyId, float]
) -> list[PolicyRow]:
    return [_policy_row(h, p, warned[p], danger, thetas.get(p)) for p in _POLICY_ORDER]


def _signed(metric: Metric) -> str:
    interval = "no interval" if metric.ci is None else f"95% interval [{metric.ci.lo:+.1f}, {metric.ci.hi:+.1f}]"
    return f"{metric.value:+.1f} h, {interval}"


def _fewer(metric: Metric) -> bool:
    """True when the paired interval lies wholly below zero ("fewer": it excludes zero in the stated direction).

    A favorable point estimate whose interval reaches zero or above is NOT fewer.
    """
    return metric.ci is not None and metric.ci.hi < 0.0


def _compare(
    h: _Hours, danger: NDArray[np.bool_], warned: dict[PolicyId, NDArray[np.bool_]], a: PolicyId, b: PolicyId
) -> tuple[Metric, Metric]:
    """P(a) minus P(b): missed danger hours and false-alarm hours, paired on days."""
    n = int(h.counted.sum())

    def parts(policy: PolicyId) -> tuple[F64, F64]:
        miss = h.daily(np.where(h.ok & danger & ~warned[policy], h.w, 0.0))
        alarm = h.daily(np.where(h.ok & ~danger & warned[policy], h.w, 0.0))
        return miss, alarm

    (miss_a, alarm_a), (miss_b, alarm_b) = parts(a), parts(b)
    return (
        _paired_total(h, miss_a, miss_b, n=n, anchor=WARNINGS_ANCHOR),
        _paired_total(h, alarm_a, alarm_b, n=n, anchor=WARNINGS_ANCHOR),
    )


def fewer_or_more(value: float, noun: str) -> str:
    """A signed difference in words: the magnitude with "fewer" or "more" (never a negative count), or "no change"."""
    magnitude = round(abs(value))
    if magnitude == 0:
        return f"no change in {noun}"
    return f"{magnitude} {'fewer' if value < 0 else 'more'} {noun}"


def _pair(metric: str, subject: str, baseline: str, difference: Metric) -> PairedComparison:
    return PairedComparison(metric=metric, subject=subject, baseline=baseline, difference=difference)


@dataclass(frozen=True)
class _H4:
    """H4 at one lead: P3 minus P0 missed danger hours and P3 minus P1 false-alarm hours, each with its interval."""

    missed_p0: Metric
    alarms_p1: Metric

    @property
    def holds(self) -> bool:
        """Both sides: the P0 side AND the P1 side must be fewer (one side alone is not H4)."""
        return _fewer(self.missed_p0) and _fewer(self.alarms_p1)

    def failing(self) -> str:
        sides = []
        if not _fewer(self.missed_p0):
            sides.append(f"the P0 side (missed danger hours, P3 minus P0: {_signed(self.missed_p0)})")
        if not _fewer(self.alarms_p1):
            sides.append(f"the P1 side (false-alarm hours, P3 minus P1: {_signed(self.alarms_p1)})")
        return " and ".join(sides)

    def comparisons(self) -> list[PairedComparison]:
        return [
            _pair("missed_danger_hours", "P3_protect", "P0", self.missed_p0),
            _pair("false_alarm_hours", "P3_protect", "P1", self.alarms_p1),
        ]


def _h4(h: _Hours, danger: NDArray[np.bool_], warned: dict[PolicyId, NDArray[np.bool_]]) -> _H4:
    p3: PolicyId = "P3_protect"
    missed_p0, _ = _compare(h, danger, warned, p3, "P0")
    _, alarms_p1 = _compare(h, danger, warned, p3, "P1")
    return _H4(missed_p0=missed_p0, alarms_p1=alarms_p1)


def _verdicts(
    h: _Hours, danger: NDArray[np.bool_], warned: dict[PolicyId, NDArray[np.bool_]], rows: list[PolicyRow]
) -> list[HypothesisVerdict]:
    by_policy = {row.policy: row for row in rows}
    p3: PolicyId = "P3_protect"
    h4 = _h4(h, danger, warned)
    missed_p2, alarms_p2 = _compare(h, danger, warned, p3, "P2")

    if h4.holds:
        h4_text = (
            "H4 supported at lead 1: P3 has fewer missed danger hours than P0 (ban only) "
            f"({_signed(h4.missed_p0)}) and fewer false-alarm hours than P1 (WBGT >= 32 on raw IFS) "
            f"({_signed(h4.alarms_p1)})."
        )
    else:
        h4_text = "H4 not supported at lead 1. Failing: " + h4.failing() + ". The scoreboard is shown as it is."
        p2, p3_row = by_policy["P2"], by_policy[p3]
        # Section 13 "If P2 >= P3", read as P2 at least as good on BOTH counts (point estimates; equal counts qualify).
        if (
            p2.missed_danger_hours.value <= p3_row.missed_danger_hours.value
            and p2.false_alarm_hours.value <= p3_row.false_alarm_hours.value
        ):
            h4_text += (
                " P2 (ADOSH zones on raw IFS) is shown as the recommended policy: our AI did not beat the "
                "regulator's own zones on held-out data."
            )
    fa_p3, fa_p2 = by_policy[p3].false_alarm_hours.value, by_policy["P2"].false_alarm_hours.value
    within = fa_p3 <= FALSE_ALARM_ALLOWANCE * fa_p2  # H5's "+ 25%", read as a point estimate
    h5_ok = _fewer(missed_p2) and within
    h5_text = (
        f"H5 {'supported' if h5_ok else 'not supported'} at lead 1 (secondary): P3 minus P2 missed danger hours "
        f"{_signed(missed_p2)}; false-alarm hours P3 {fa_p3:.1f} h against P2 {fa_p2:.1f} h "
        f"({'within' if within else 'above'} P2 + 25%)."
    )
    return [
        HypothesisVerdict(
            id="H4",
            primary=True,
            statement="At the demo station, working daytime, lead 1: P3 has fewer missed danger hours than P0 (ban "
            "only) and fewer false-alarm hours than P1 (WBGT >= 32 on raw IFS).",
            outcome="supported" if h4.holds else "negative",
            comparisons=h4.comparisons(),
            text=h4_text,
        ),
        HypothesisVerdict(
            id="H5",
            primary=False,
            statement="Same site and season: P3 has fewer missed danger hours than P2 (ADOSH zones on raw IFS) "
            "without more false-alarm hours than P2 + 25%.",
            outcome="supported" if h5_ok else "negative",
            comparisons=[
                _pair("missed_danger_hours", p3, "P2", missed_p2),
                _pair("false_alarm_hours", p3, "P2", alarms_p2),
            ],
            text=h5_text,
        ),
    ]


def _lead2_verdict(h4: _H4, *, holds_at_lead_1: bool) -> HypothesisVerdict:
    """Section 13's lead-2 row: the "evening before" stamp may be carried only when H4 holds at lead 2.

    The rule is H4's own (the same paired differences, bootstrap, blocks and seed) on the lead-2 rows. Where H4 holds at
    lead 1 but not at lead 2 the stamp is dropped from the video and the strict (lead-2) number is shown.
    """
    stamp = _LEAD_LABELS[STRICT_LEAD]
    if h4.holds:
        text = (
            f"H4 holds at lead 2 ({stamp}): P3 has fewer missed danger hours than P0 ({_signed(h4.missed_p0)}) and "
            f'fewer false-alarm hours than P1 ({_signed(h4.alarms_p1)}). The stamp "{stamp}" may be carried.'
        )
        if not holds_at_lead_1:
            text += " H4 does not hold at lead 1, so the lead-1 headline is not supported."
    else:
        text = (
            f'H4 does not hold at lead 2 ({stamp}). Failing: {h4.failing()}. The stamp "{stamp}" is dropped from the '
            "video, and the strict number is shown."
        )
        text += (
            " H4 holds at lead 1: lead 2 contradicts it." if holds_at_lead_1 else " H4 does not hold at lead 1 either."
        )
    return HypothesisVerdict(
        id="H4-lead2",
        primary=False,
        statement=f"At the demo station, working daytime, lead 2 (strict: {stamp}): P3 has fewer missed danger hours "
        "than P0 (ban only) and fewer false-alarm hours than P1 (WBGT >= 32 on raw IFS). The stamp may be carried "
        "only when this holds.",
        outcome="supported" if h4.holds else "negative",
        comparisons=h4.comparisons(),
        text=text,
    )


def warnings_scoreboard(
    rows: pl.DataFrame,
    *,
    theta_protect: float,
    theta_balanced: float,
    ruleset: Ruleset,
    params: EffectiveParams,
    context: BoardContext,
    leads: tuple[int, ...] = (1, 2, 3, 5, 7),
) -> PolicyScoreboard:
    """The Warnings row (pre-registration 7.2) from a scoring frame; leads without rows are listed as not available.

    The verdicts are H4 and H5 at lead 1 and, where lead 2 has rows, ``H4-lead2`` (section 13's lead-2 clause).

    Raises:
        ValueError: The frame lacks a column, or has no lead-1 row (the headline lead).
    """
    _require(
        rows, ("valid_time", "lead_days", "truth_twl", "truth_t_c", "raw_wbgt_c", "raw_twl_eff", "n_high", "n_finite")
    )
    edges = ZoneEdges.from_ruleset(ruleset, params)
    thetas: dict[PolicyId, float] = {"P3_protect": theta_protect, "P3_balanced": theta_balanced}
    margin = params.twl_margin_w_m2
    frozen_withdrawal_on = ruleset.twl_withdrawal.enabled
    results: list[LeadResult] = []
    sensitivity: list[SensitivityCell] = []
    verdicts: list[HypothesisVerdict] = []
    lead2: _H4 | None = None
    n_days = 0
    for lead in leads:
        h = _hours(rows, lead, context, ruleset)
        headline, report_only = lead == HEADLINE_LEAD, lead in (5, 7)
        if h is None or not h.ok.any():
            results.append(
                LeadResult(
                    label=_lead_label(lead, context, available=False),
                    truth_danger_hours=Metric(value=0.0, ci=None, n=0, anchor=WARNINGS_ANCHOR),
                    rows=[],
                    lead_days=lead,
                    headline=headline,
                    report_only=report_only,
                )
            )
            continue
        danger = _truth_danger(h, ruleset, edges, margin=margin, withdrawal=frozen_withdrawal_on)
        warned = _warned(h, edges, theta_protect, theta_balanced)
        lead_rows = _rows_for(h, danger, warned, thetas)
        results.append(
            LeadResult(
                label=_lead_label(lead, context, available=True),
                truth_danger_hours=_danger_metric(h, danger),
                rows=lead_rows,
                lead_days=lead,
                headline=headline,
                report_only=report_only,
            )
        )
        if lead == STRICT_LEAD:
            lead2 = _h4(h, danger, warned)
        if lead == HEADLINE_LEAD:
            n_days = int(h.daily(h.ok.astype(np.float64)).astype(bool).sum())
            verdicts = _verdicts(h, danger, warned, lead_rows)
            for m, on in (
                (margin, frozen_withdrawal_on),
                (margin, not frozen_withdrawal_on),
                (0.0, False),
                (0.0, True),
            ):
                cell_danger = _truth_danger(h, ruleset, edges, margin=m, withdrawal=on)
                sensitivity.append(
                    SensitivityCell(
                        margin_w_m2=m,
                        withdrawal_limits=on,
                        headline=(m == margin and on == frozen_withdrawal_on),
                        lead_days=lead,
                        truth_danger_hours=_danger_metric(h, cell_danger),
                        rows=_rows_for(h, cell_danger, warned, thetas),
                    )
                )
    if not verdicts:
        raise ValueError("the scoring frame has no lead-1 hour: the headline lead cannot be scored")
    if lead2 is not None:
        verdicts.append(_lead2_verdict(lead2, holds_at_lead_1=verdicts[0].outcome == "supported"))
    return PolicyScoreboard(
        evaluation_set=context.evaluation_set,
        evaluation_label=context.evaluation_label,
        station=context.station,
        season_start=context.season_start,
        season_end=context.season_end,
        working_hours_utc="06:00-14:59 UTC (10:00-18:59 GST)",
        n_days=n_days,
        ruleset_id=context.ruleset_id,
        ruleset_sha256=context.ruleset_sha256,
        theta_protect=theta_protect,
        theta_balanced=theta_balanced,
        margin_w_m2=margin,
        withdrawal_limits=frozen_withdrawal_on,
        assumed_crew_size=ASSUMED_CREW_SIZE,
        assumed_crew_label=CREW_LABEL,
        leads=results,
        sensitivity=sensitivity,
        verdicts=verdicts,
        provenance=context.stamped(WARNINGS_ANCHOR, "warnings_scoreboard", ProvenanceLabel.REAL),
    )


# === the demo day ===================================================================================================


@dataclass(frozen=True)
class DemoSelection:
    """The day chosen on truth alone (7.4): nothing here comes from a forecast output."""

    date: date
    score: float
    high_hours: float
    candidates: int
    runner_up: RunnerUp | None
    reject_checked: bool


def select_demo_day(
    truth: pl.DataFrame,
    forecasts_present: pl.DataFrame,
    ruleset: Ruleset,
    params: EffectiveParams,
    *,
    season: tuple[date, date],
) -> DemoSelection:
    """Pre-registration 7.4: the candidate date with the most High-or-Red hours outside the ban; ties go earliest.

    A candidate date in ``season`` has all 9 working hours (06-14 UTC) with ``has_joint_obs`` and (when the column
    exists) ``wbgt_obs_reject == 0``, a finite truth TWL, and every policy's lead-1 forecast inputs present
    (``forecasts_present``: ``valid_time`` and boolean ``present``). The score is the sum of the ban weights of the
    truth-High-or-Red hours (partial ban hours count their non-ban fraction). ``truth`` has ``valid_time``,
    ``has_joint_obs``, ``truth_twl`` and ``truth_t_c`` (TWL without margin, as in the scoring frame) and optionally
    ``wbgt_obs_reject``. The runner-up is the next candidate by the same order.

    Raises:
        ValueError: A column is missing or no date is a candidate.
    """
    _require(truth, ("valid_time", "has_joint_obs", "truth_twl", "truth_t_c"))
    _require(forecasts_present, ("valid_time", "present"))
    edges = ZoneEdges.from_ruleset(ruleset, params)
    frame = (
        truth.filter(pl.col("valid_time").dt.hour().is_in(list(WORKING_HOURS)))
        .join(forecasts_present.select("valid_time", "present"), on="valid_time", how="left")
        .with_columns(pl.col("valid_time").dt.date().alias("_date"))
        .filter(pl.col("_date").is_between(*season))
        .sort("valid_time")
    )
    reject_checked = "wbgt_obs_reject" in frame.columns
    effective = effective_twl(
        _floats(frame, "truth_twl"),
        margin_w_m2=params.twl_margin_w_m2,
        withdrawal=frozen_withdrawal(ruleset) if ruleset.twl_withdrawal.enabled else None,
        t_c=_floats(frame, "truth_t_c"),
        tnwb_c=None,
    )
    zones = zone_of(effective, edges)
    usable = (
        frame["has_joint_obs"].fill_null(False).to_numpy() & frame["present"].fill_null(False).to_numpy() & (zones >= 0)
    )
    if reject_checked:
        usable &= (frame["wbgt_obs_reject"].fill_null(1) == 0).to_numpy()
    danger = zones >= int(Zone.HIGH)
    weight = ban_weights(frame["valid_time"], ruleset)
    scored = frame.select("_date").with_columns(
        pl.Series("usable", usable),
        pl.Series("score", np.where(danger, weight, 0.0)),
        pl.Series("high", danger.astype(np.float64)),
    )
    per_day = (
        scored.group_by("_date")
        .agg(
            pl.len().alias("n"), pl.col("usable").all().alias("all_usable"), pl.col("score").sum(), pl.col("high").sum()
        )
        .filter((pl.col("n") == len(WORKING_HOURS)) & pl.col("all_usable"))
        .sort(pl.col("score").round(9) * -1, "_date")
    )
    if per_day.is_empty():
        raise ValueError("no date has all 9 working hours observed, unrejected and forecast: there is no demo day")
    best = per_day.row(0, named=True)
    second = per_day.row(1, named=True) if per_day.height > 1 else None
    return DemoSelection(
        date=best["_date"],
        score=float(best["score"]),
        high_hours=float(best["high"]),
        candidates=per_day.height,
        runner_up=None if second is None else RunnerUp(date=second["_date"], score=float(second["score"])),
        reject_checked=reject_checked,
    )


def _zone_name(zone: int) -> ZoneName:
    return cast(ZoneName, Zone(zone).name.lower())


def _optional(value: float) -> float | None:
    return float(value) if np.isfinite(value) else None


def fill_demo_day(
    selection: DemoSelection,
    rows: pl.DataFrame,
    corrected_wbgt: pl.DataFrame,
    *,
    theta_protect: float,
    theta_balanced: float,
    ruleset: Ruleset,
    params: EffectiveParams,
    context: BoardContext,
) -> DemoDay:
    """The demo day of ``selection``: its nine hours with the truth, the raw forecast and what each policy did.

    Called after the selection, so the day is shown whatever P3 did on it. ``rows`` is the lead-1 scoring frame plus
    ``truth_wbgt_c``; ``corrected_wbgt`` has ``valid_time`` and the corrected WBGT ``p05``, ``p50``, ``p95`` (null when
    there is no finite sample).

    Raises:
        ValueError: The day does not have its nine hours, or a column is missing.
    """
    _require(
        rows,
        (
            "valid_time",
            "lead_days",
            "truth_twl",
            "truth_t_c",
            "truth_wbgt_c",
            "raw_wbgt_c",
            "raw_twl_eff",
            "n_high",
            "n_finite",
            "protective_twl",
        ),
    )
    _require(corrected_wbgt, ("valid_time", "p05", "p50", "p95"))
    edges = ZoneEdges.from_ruleset(ruleset, params)
    day = (
        rows.filter(
            (pl.col("lead_days") == HEADLINE_LEAD)
            & (pl.col("valid_time").dt.date() == selection.date)
            & pl.col("valid_time").dt.hour().is_in(list(WORKING_HOURS))
        )
        .sort("valid_time")
        .join(corrected_wbgt.select("valid_time", "p05", "p50", "p95"), on="valid_time", how="left")
    )
    if day.height != len(WORKING_HOURS):
        raise ValueError(f"{selection.date} has {day.height} lead-1 hours, not {len(WORKING_HOURS)}")
    weight = ban_weights(day["valid_time"], ruleset)
    truth_eff = effective_twl(
        _floats(day, "truth_twl"),
        margin_w_m2=params.twl_margin_w_m2,
        withdrawal=frozen_withdrawal(ruleset) if ruleset.twl_withdrawal.enabled else None,
        t_c=_floats(day, "truth_t_c"),
        tnwb_c=None,
    )
    truth_zone = zone_of(truth_eff, edges)
    raw_eff = _floats(day, "raw_twl_eff")
    raw_zone = zone_of(raw_eff, edges)
    n_high, n_finite = _floats(day, "n_high"), _floats(day, "n_finite")
    share = np.divide(n_high, n_finite, out=np.full(n_high.shape, np.nan), where=n_finite > 0)
    raw_wbgt, protective = _floats(day, "raw_wbgt_c"), _floats(day, "protective_twl")
    danger = truth_zone >= int(Zone.HIGH)
    p2 = raw_zone >= int(Zone.HIGH)
    p3 = {
        "P3_protect": np.isfinite(share) & (share >= theta_protect),
        "P3_balanced": np.isfinite(share) & (share >= theta_balanced),
    }
    hours: list[DemoDayHour] = []
    for i, start in enumerate(day["valid_time"].to_list()):
        if truth_zone[i] < 0:
            raise ValueError(f"the demo day hour {start} has no observed truth")
        flags: list[tuple[PolicyId, bool]] = [
            ("P0", bool(weight[i] < 1.0)),  # P0 "warns" the ban part of the hour
            ("P1", bool(np.isfinite(raw_wbgt[i]) and raw_wbgt[i] >= WBGT_NAIVE_C)),
            ("P2", bool(p2[i])),
            ("P3_protect", bool(p3["P3_protect"][i])),
            ("P3_balanced", bool(p3["P3_balanced"][i])),
        ]
        warned = [policy for policy, flag in flags if flag]
        quantiles = [day[name][i] for name in ("p05", "p50", "p95")]
        hours.append(
            DemoDayHour(
                starts_at=start,
                ban_weight=float(weight[i]),
                truth_wbgt_c=float(day["truth_wbgt_c"][i]),
                truth_twl_eff_w_m2=float(truth_eff[i]),
                truth_zone=_zone_name(int(truth_zone[i])),
                raw_wbgt_c=_optional(raw_wbgt[i]),
                raw_twl_eff_w_m2=_optional(raw_eff[i]),
                raw_zone=None if raw_zone[i] < 0 else _zone_name(int(raw_zone[i])),
                corrected_wbgt_c=None
                if any(q is None for q in quantiles)
                else WbgtQuantiles(p05=quantiles[0], p50=quantiles[1], p95=quantiles[2]),
                p_high=_optional(share[i]),
                protective_twl_w_m2=_optional(protective[i]),
                warned_by=warned,
            )
        )
    note = "" if selection.reject_checked else " (development export: candidates check has_joint_obs only)"
    return DemoDay(
        evaluation_set=context.evaluation_set,
        evaluation_label=context.evaluation_label,
        station=context.station,
        date=selection.date,
        score=selection.score,
        high_hours=selection.high_hours,
        high_hours_outside_ban=selection.score,
        raw_hits=float(np.where(danger & p2, weight, 0.0).sum()),
        p3_hits=float(np.where(danger & p3["P3_protect"], weight, 0.0).sum()),
        candidates=selection.candidates,
        runner_up=selection.runner_up,
        lead_days=HEADLINE_LEAD,
        rule="Pre-registration 7.4, on truth only: candidates are the dates with all 9 working hours (06-14 UTC) "
        "observed, unrejected and forecast at lead 1; the score is the observed High-or-Red hours outside the "
        "ban window "
        "(partial ban hours count their non-ban fraction); the maximum wins and ties go to the earliest date"
        + note
        + ".",
        hours=hours,
        provenance=context.stamped(DEMO_ANCHOR, "select_demo_day", ProvenanceLabel.REAL),
    )


# === the Plans row ===================================================================================================

_ATTENDANCE_STATES: Final = frozenset({TickState.WORK, TickState.ADOSH_REST, TickState.STOPPED, TickState.ART18_BREAK})
_PLAN_ORDER: Final[tuple[PlanId, ...]] = ("naive", "ban_only", "rule_raw", "rule_corrected")
_BAN_ONLY_LABEL: Final = "Ban only (= working every shift minute; the legal roster already avoids the ban)"
_PLAN_LABELS: Final[dict[PlanId, str]] = {
    "naive": "Naive schedule (every shift minute outside the ban)",
    "ban_only": "Ban only",
    "rule_raw": "Rule plan on raw IFS",
    "rule_corrected": "Rule plan on the corrected protective quantile",
}


def _shift_ticks(crew: CrewSpec, local_date: date, tz: ZoneInfo, size: int) -> list[bool]:
    ticks = day_ticks(local_date, tz)
    out = []
    for tick in ticks[:size]:
        local = datetime.fromtimestamp(int(tick.astype("datetime64[s]").astype(np.int64)), UTC).astimezone(tz).time()
        out.append(any(block.start <= local < block.end for block in crew.shift))
    return out


def _naive_plan(
    crew: CrewSpec, timeline: ZoneTimeline, local_date: date, tz: ZoneInfo, rules: PlannerRules
) -> CrewPlan:
    """Work in every shift tick outside the ban window, ``ban`` inside it (pre-registration 7.3 (a))."""
    ticks = day_ticks(local_date, tz)
    banned = in_ban(ticks, local_date, tz, rules.labour)
    in_shift = _shift_ticks(crew, local_date, tz, int(ticks.size))
    states = tuple(
        TickState.OFF if not s else TickState.BAN if b else TickState.WORK
        for s, b in zip(in_shift, banned, strict=True)
    )
    return CrewPlan(
        crew_id=crew.crew_id,
        local_date=local_date,
        start_utc=timeline.start_utc,
        states=states,
        rule_ids=(),
        status="rule",
        restricted_headcount=0,
        restrictions=(),
        work_minutes=states.count(TickState.WORK) * TICK_MINUTES,
        adosh_rest_minutes=0,
        art18_minutes=0,
        stopped_minutes=0,
    )


@dataclass
class _PlanDays:
    """Per season day, one plan's counters (zero on a day that is not scored)."""

    violation_minutes: F64
    cycled: F64
    missed: F64
    rest: F64


def _violation_ticks(result_ranges: Sequence[tuple[int, int]]) -> int:
    ticks: set[int] = set()
    for begin, end in result_ranges:
        ticks.update(range(begin, end))
    return len(ticks)


def _day_labels(day: pl.DataFrame) -> NDArray[np.datetime64]:
    return np.asarray(day["valid_time"].dt.replace_time_zone(None).to_numpy(), dtype="datetime64[us]")


def _timeline(
    day: pl.DataFrame, column: str, edges: ZoneEdges, tz: ZoneInfo, *, source: Literal["forecast", "truth"] = "forecast"
) -> ZoneTimeline:
    """The zone timeline of one local day from the hourly effective TWL in ``column`` (no product clamp)."""
    return zone_timeline(
        local_date=day["_date"][0],
        tz=tz,
        labels_utc=_day_labels(day),
        protective_twl_eff=_floats(day, column),
        hour_level_zones=None,
        edges=edges,
        source=source,
    )


def plans_scoreboard(
    rows: pl.DataFrame,
    *,
    crew: CrewSpec,
    ruleset: Ruleset,
    params: EffectiveParams,
    context: BoardContext,
    site_id: str,
    fixture_sha256: str,
    roster: str,
    crew_label: str,
) -> PlanScoreboard:
    """The Plans row (pre-registration 7.3): four plans on the scored crew's roster, judged by the validator on truth.

    ``rows`` is the lead-1 scoring frame of every modelled hour of the season (UTC 02-15; the dev export has 06-14 and
    a roster clipped to it), one station. Per local day the truth timeline is ``zone_timeline(source="truth")`` of the
    observed effective TWL, ``rule_raw`` plans on the raw IFS effective TWL and ``rule_corrected`` on the protective
    q10, both WITHOUT the product clamp (``hour_level_zones=None``, amendment 1 section 2); ``ban_only`` is the rule
    planner on an all-Low timeline and ``naive`` the typed plan that works every shift tick outside the ban. A day is
    scored only if truth, raw and corrected have a value on every attendance tick, so the four plans cover the same
    days. Counters per plan (ticks are 5 minutes, summed over the scored days of the season):

    * violation minutes: ticks inside any violation of ``validate_plan`` against the truth timeline, times 5;
    * high-cycled share: truth-High-or-Red attendance ticks whose plan zone is High or Red, over all such ticks;
    * missed protection: WORK ticks of a truth-High-or-Red tick whose plan zone is milder than the truth zone;
    * rest added: adosh_rest + Art. 18 + stopped minutes of the plan minus those of ``naive``.

    Raises:
        ValueError: The frame lacks a column or a lead-1 hour, or no day can be scored.
    """
    _require(rows, ("valid_time", "lead_days", "truth_twl", "truth_t_c", "raw_twl_eff", "protective_twl"))
    edges = ZoneEdges.from_ruleset(ruleset, params)
    planner = planner_rules(ruleset, params)
    if ruleset.clauses is None:
        raise ValueError(f"ruleset {ruleset.meta.id} has no clauses section: the validator cannot cite rules")
    clauses = ruleset.clauses.entries
    tz = ZoneInfo(SITE_TIMEZONE)
    dates = _season_dates(context)
    n_days = int(dates.len())
    lead_rows = (
        rows.filter(
            (pl.col("lead_days") == HEADLINE_LEAD)
            & pl.col("valid_time").dt.date().is_between(context.season_start, context.season_end)
        )
        .sort("valid_time")
        .with_columns(pl.col("valid_time").dt.date().alias("_date"))
    )
    if lead_rows.is_empty():
        raise ValueError("the scoring frame has no lead-1 hour in the season: the Plans row cannot be scored")
    if lead_rows["valid_time"].is_duplicated().any():
        raise ValueError("two rows for one valid_time: one station per scoring frame")
    truth_eff_all = effective_twl(
        _floats(lead_rows, "truth_twl"),
        margin_w_m2=params.twl_margin_w_m2,
        withdrawal=frozen_withdrawal(ruleset) if ruleset.twl_withdrawal.enabled else None,
        t_c=_floats(lead_rows, "truth_t_c"),
        tnwb_c=None,
    )
    lead_rows = lead_rows.with_columns(pl.Series("_truth_eff", truth_eff_all))
    acc: dict[PlanId, _PlanDays] = {
        p: _PlanDays(np.zeros(n_days), np.zeros(n_days), np.zeros(n_days), np.zeros(n_days)) for p in _PLAN_ORDER
    }
    denominator, scored = np.zeros(n_days), np.zeros(n_days)
    same_states = True
    high = int(Zone.HIGH)
    for (local_date,), day in lead_rows.group_by("_date", maintain_order=True):
        truth = _timeline(day, "_truth_eff", edges, tz, source="truth")
        raw = _timeline(day, "raw_twl_eff", edges, tz)
        corrected = _timeline(day, "protective_twl", edges, tz)
        low = ZoneTimeline.from_zones(truth.start_utc, [Zone.LOW] * len(truth.zones), source="forecast")
        naive = _naive_plan(crew, truth, local_date, tz, planner)
        attendance = np.array([state is TickState.WORK for state in naive.states])
        if any(truth.fallback[i] or raw.fallback[i] or corrected.fallback[i] for i in np.flatnonzero(attendance)):
            continue
        plans: dict[PlanId, tuple[CrewPlan, ZoneTimeline]] = {
            "naive": (naive, low),
            "ban_only": (plan_crew(crew, low, planner, local_date=local_date, tz=tz), low),
            "rule_raw": (plan_crew(crew, raw, planner, local_date=local_date, tz=tz), raw),
            "rule_corrected": (plan_crew(crew, corrected, planner, local_date=local_date, tz=tz), corrected),
        }
        same_states &= plans["naive"][0].states == plans["ban_only"][0].states
        index = (local_date - context.season_start).days
        truth_zone = np.array([int(z) for z in truth.zones])
        truth_high = attendance & (truth_zone >= high)
        denominator[index] = float(truth_high.sum())
        scored[index] = 1.0
        base_rest = naive.adosh_rest_minutes + naive.art18_minutes + naive.stopped_minutes
        for name, (plan, planned) in plans.items():
            result = validate_plan(plan, truth, crew, planner, clauses, published_shift=crew.shift, tz=tz)
            plan_zone = np.array([int(z) for z in planned.zones])
            work = np.array([state is TickState.WORK for state in plan.states])
            record = acc[name]
            ticks = _violation_ticks([r for violation in result.violations for r in violation.tick_ranges])
            record.violation_minutes[index] = ticks * TICK_MINUTES
            record.cycled[index] = float((truth_high & (plan_zone >= high)).sum())
            record.missed[index] = float((work & (truth_zone >= high) & (plan_zone < truth_zone)).sum())
            record.rest[index] = plan.adosh_rest_minutes + plan.art18_minutes + plan.stopped_minutes - base_rest
    n_scored = int(scored.sum())
    if n_scored == 0:
        raise ValueError("no day has truth, raw and corrected values on every shift tick: nothing to score")

    h = _Season(dates)
    fields = ("violation_minutes", "cycled", "missed", "rest")
    identical = same_states and all(
        np.array_equal(getattr(acc["naive"], f), getattr(acc["ban_only"], f)) for f in fields
    )
    anchor = PLANS_ANCHOR
    plan_rows: list[PlanRow] = []
    for name in _PLAN_ORDER:
        record = acc[name]
        label = _BAN_ONLY_LABEL if identical and name in ("naive", "ban_only") else _PLAN_LABELS[name]
        plan_rows.append(
            PlanRow(
                plan=name,
                label=label,
                violation_minutes_per_season=_total(h, record.violation_minutes, n=n_scored, anchor=anchor),
                high_cycled_share=_ratio(h, record.cycled, denominator, n=int(denominator.sum()), anchor=anchor),
                missed_protection_ticks=_total(h, record.missed, n=n_scored, anchor=anchor),
                rest_minutes_added_vs_naive=_total(h, record.rest, n=n_scored, anchor=anchor),
            )
        )

    def difference(a: PlanId, b: PlanId, field: str) -> Metric:
        return _paired_total(h, getattr(acc[a], field), getattr(acc[b], field), n=n_scored, anchor=anchor)

    def interval(metric: Metric) -> str:
        if metric.ci is None:
            return "no interval"
        return f"95% interval of the difference [{metric.ci.lo:+.0f}, {metric.ci.hi:+.0f}]"

    h6, h7 = (
        difference("rule_corrected", "ban_only", "violation_minutes"),
        difference("rule_corrected", "rule_raw", "missed"),
    )
    h6_ok, h7_ok = _fewer(h6), _fewer(h7)
    verdicts = [
        HypothesisVerdict(
            id="H6",
            primary=True,
            statement="Same site and season, roster L1, the assumed crew: the rule plan from the corrected "
            "forecast has fewer truth-zone rule-violation minutes per worker-season than ban only.",
            outcome="supported" if h6_ok else "negative",
            comparisons=[_pair("violation_minutes_per_season", "rule_corrected", "ban_only", h6)],
            text=(
                f"H6 supported: the rule plan on the corrected forecast has "
                f"{fewer_or_more(h6.value, 'rule-violation minutes')} per worker-season than ban only "
                f"({interval(h6)}). SIMULATED crew, real weather."
                if h6_ok
                else f"H6 not supported ({fewer_or_more(h6.value, 'rule-violation minutes')} per worker-season "
                f"against ban only, {interval(h6)}). The zone engine and validator do the work; the forecast adds the "
                "honest range."
            ),
        ),
        HypothesisVerdict(
            id="H7",
            primary=False,
            statement="Rule plan on the corrected forecast against the rule plan on raw IFS: fewer "
            "missed-protection ticks.",
            outcome="supported" if h7_ok else "negative",
            comparisons=[_pair("missed_protection_ticks", "rule_corrected", "rule_raw", h7)],
            text=(
                f"H7 supported (secondary): {fewer_or_more(h7.value, 'missed-protection ticks')} than the raw-IFS rule "
                f"plan ({interval(h7)})."
                if h7_ok
                else f"H7 not supported (secondary): {fewer_or_more(h7.value, 'missed-protection ticks')} against the "
                f"raw-IFS rule plan, {interval(h7)}; a tie is the expected outcome."
            ),
        ),
    ]
    return PlanScoreboard(
        evaluation_set=context.evaluation_set,
        evaluation_label=context.evaluation_label,
        station=context.station,
        site_id=site_id,
        crew_id=crew.crew_id,
        crew_label=crew_label,
        headcount=crew.headcount,
        roster=roster,
        season_start=context.season_start,
        season_end=context.season_end,
        n_days=n_scored,
        ruleset_id=context.ruleset_id,
        ruleset_sha256=context.ruleset_sha256,
        fixture_sha256=fixture_sha256,
        rows=plan_rows,
        identical_by_construction=["naive", "ban_only"] if identical else [],
        verdicts=verdicts,
        provenance=context.stamped(anchor, "plans_scoreboard", ProvenanceLabel.REAL_WEATHER_ASSUMED_CREW),
    )
