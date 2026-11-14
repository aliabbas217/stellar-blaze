"""The pre-registered selection rules of section 6.1-6.4, and the dev run that applies them in order.

Everything a rule decides is decided on 2024-2025, leave-one-cluster-out (LOCO) out-of-fold predictions, leads 1-3,
working daytime (06-14 UTC). The rules are four pure functions over small frames, so each threshold has a test on both
sides of it, and ``run_dev_selection`` only runs the models, builds those frames and calls the functions: it never
re-derives a decision (a test pins that).

The input frames (one row per target; ``crps`` is the mean LOCO CRPS of the corrector on the rows both runs scored):

* 6.1 ``grid_scores``: ``num_leaves``, ``min_child_samples``, ``n_estimators``, ``score`` (the mean pinball loss over
  levels 0.1, 0.5 and 0.9 and over the T and Td errors; ``score_hyperparameter_grid`` also adds ``pinball_t``,
  ``pinball_td`` and the row counts);
* 6.2 ``cold``: ``target``, ``crps`` (and ``n_rows``, ``n_days``); ``site``: the same plus ``diff``, ``diff_lo`` and
  ``diff_hi`` (site minus cold mean CRPS and its paired 95% moving-block bootstrap interval; negative is site better;
  null bounds mean the interval was not computable). Both from ``paired_loco_crps``;
* 6.3 ``joint`` and ``direct``: ``target`` (one row, ``wbgt``) and ``crps``;
* 6.4 ``coverage_by_tercile``: the table of ``evaluate.coverage_by_forecast_tercile`` (``target``, ``lead_days``,
  ``tercile``, ``coverage``, ``n``).

Interpretations the pre-registration leaves open, each recorded in the decision's ``evidence`` so a reader can apply a
different one to the same numbers:

* "within 1% of the best" (6.1) is relative to the best score and includes the boundary;
* "relative to ``cold``" (6.2) and "a difference under 1%" (6.3, relative to ``joint``) are relative differences; 6.2's
  "by >= 1%" includes 1%, 6.3's tie is strictly under 1%;
* "the interval excluding zero" (6.2) means on the improvement side (``diff_hi < 0``): an interval above zero is a worse
  site model, never a reason to choose it;
* 6.4's "90% interval in the top forecast-WBGT tercile" has two readings, chosen by ``calibration_targets`` and
  recorded in the decision's evidence (``decides_<target>``) and in ``selection.json``: ``wbgt`` (the interval the
  warnings use; the other targets' coverage is recorded but does not decide) and ``all`` (T, Td, wind and WBGT: the
  window switches if ANY of them is below 0.85 in the top tercile for ANY lead 1-3). The committed run uses ``all``
  (the pre-registration's amendment 2: the rule applies to all four variables);
* 6.2 and 6.3 are decided on the numbers of ``paired_loco_crps`` WITHOUT the section 8 noise floor (the floor is for
  reporting skill, not for choosing a configuration); 6.3 compares the calibrated joint grid with the calibrated direct
  grid on the rows where both (and the B2d grid that rides along for the Brier scores) are finite.

A structural limitation of 6.2, recorded in its evidence (``heldout_null_sclim_t_share`` and ``heldout_rows_t``): in
leave-one-cluster-out the held-out station is not in the fold's training rows, so its station climatology ``sclim_*`` is
null on (nearly) every held-out row, and the ``site`` feature set differs from ``cold`` there mostly by ``bias7_*``, the
station's own recent forecast error. The comparison therefore measures what ``site`` adds on a NEW station through its
history, not what a station's own climatology would add on a station the model was trained on.
"""

import hashlib
import re
import time
from collections.abc import Callable, Collection, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Final, Literal

import numpy as np
import polars as pl
import structlog
from pydantic import BaseModel, ConfigDict

from stellar_blaze.domain.forecast.features import (
    FeatureSet,
    FoldStats,
    Target,
    build_features,
    fit_fold_stats,
    history_features,
)
from stellar_blaze.domain.forecast.grid import F64, LEVELS
from stellar_blaze.ml import metrics
from stellar_blaze.ml.conformal import calibration_mask, fit_mask
from stellar_blaze.ml.data import TEST_SUMMER, HoldoutViolationError
from stellar_blaze.ml.evaluate import (
    CORRECTOR,
    OofPredictions,
    coverage_by_forecast_tercile,
    evaluate_dev,
    evaluate_summer_split,
    skill_table,
)
from stellar_blaze.ml.quantile_models import feature_matrix, fit_quantile_models
from stellar_blaze.ml.regimes import CLUSTERS, loco_folds, split
from stellar_blaze.ml.training_config import TrainingConfig

__all__ = [
    "CALIBRATION_COVERAGE_FLOOR",
    "CALIBRATION_TARGET_READINGS",
    "EXPORT_CLUSTER",
    "FEATURE_SET_MIN_IMPROVEMENT",
    "GRID_LEVELS",
    "HYPERPARAMETER_GRID",
    "HYPERPARAMETER_TIE_TOLERANCE",
    "SELECTION_LEADS",
    "WBGT_TIE_TOLERANCE",
    "WORKING_HOURS_UTC",
    "Decision",
    "DevSelection",
    "config_fingerprint",
    "held_out_missing_station_climatology",
    "paired_loco_crps",
    "parse_hyperparameter_choice",
    "run_dev_selection",
    "score_hyperparameter_grid",
    "select_calibration_window",
    "select_feature_set",
    "select_hyperparameters",
    "select_wbgt_method",
]

_log = structlog.get_logger(__name__)

HYPERPARAMETER_GRID: Final[tuple[tuple[int, int, int], ...]] = tuple(
    (leaves, child, trees) for leaves in (7, 15) for child in (200, 1000) for trees in (150, 400)
)
"""Pre-registration 6.1: ``num_leaves`` in {7, 15} x ``min_child_samples`` in {200, 1000} x ``n_estimators`` in
{150, 400}, as ``(num_leaves, min_child_samples, n_estimators)``."""

GRID_LEVELS: Final[tuple[float, ...]] = (0.1, 0.5, 0.9)
"""The levels of the 6.1 score."""

HYPERPARAMETER_TIE_TOLERANCE: Final = 0.01
FEATURE_SET_MIN_IMPROVEMENT: Final = 0.01
WBGT_TIE_TOLERANCE: Final = 0.01
CALIBRATION_COVERAGE_FLOOR: Final = 0.85
"""The 1%, 1%, 1% and 0.85 thresholds of 6.1-6.4."""

SELECTION_LEADS: Final[tuple[int, ...]] = (1, 2, 3)
"""Every selection rule scores leads 1-3."""

WORKING_HOURS_UTC: Final[tuple[int, ...]] = tuple(range(6, 15))
"""The working daytime, 06-14 UTC (what ``evaluate.skill_table(hours="working")`` selects; a test pins that)."""

EXPORT_CLUSTER: Final = "abu_dhabi"
"""The held-out cluster whose joint samples B3's theta rule (6.5) reads."""

CALIBRATION_TARGET_READINGS: Final[Mapping[str, tuple[str, ...]]] = {
    "wbgt": ("wbgt",),
    "all": tuple(target.value for target in Target),
}
"""The two readings of 6.4: which targets' top-tercile coverage can switch the calibration window."""

_RULE_HYPERPARAMETERS: Final = "6.1 hyperparameters"
_RULE_FEATURE_SET: Final = "6.2 feature set"
_RULE_WBGT: Final = "6.3 wbgt method"
_RULE_CALIBRATION: Final = "6.4 calibration window"
_CALIBRATION_WINDOWS: Final = ("september", "weeks_4_8_12_16")
_WEEKS: Final = "weeks_4_8_12_16"
_REFERENCE: Final = "ref"
_CHOICE: Final = re.compile(r"num_leaves=(\d+),min_child_samples=(\d+),n_estimators=(\d+)")


class Decision(BaseModel):
    """What one selection rule chose, and the numbers it chose on.

    Attributes:
        rule: The rule's name (``"6.1 hyperparameters"`` ...).
        choice: The chosen value as a string: ``num_leaves=7,min_child_samples=200,n_estimators=150``, ``site`` or
            ``cold``, ``joint`` or ``direct``, ``september`` or ``weeks_4_8_12_16``.
        evidence: Every numeric input the rule read (plus the derived quantities it compared), finite floats.
        tie_broken: True when a tie rule, not the raw comparison, decided: more than one configuration within 1% of the
            best (6.1), or a WBGT difference under 1% (6.3). Always False for 6.2 and 6.4.
    """

    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    rule: str
    choice: str
    evidence: dict[str, float]
    tie_broken: bool


def _require_columns(frame: pl.DataFrame, columns: Sequence[str], what: str) -> None:
    missing = [name for name in columns if name not in frame.columns]
    if missing:
        raise ValueError(f"the {what} frame lacks the columns {missing} (it has {frame.columns})")


def _row_of(frame: pl.DataFrame, target: str, what: str) -> dict[str, object]:
    rows = frame.filter(pl.col("target") == target).to_dicts()
    if not rows:
        raise ValueError(f"the {what} frame has no row for target {target!r}")
    if len(rows) > 1:
        raise ValueError(f"the {what} frame has {len(rows)} rows for target {target!r}; exactly one is expected")
    return rows[0]


def _number(row: dict[str, object], name: str, what: str) -> float | None:
    value = row[name]
    if value is None:
        return None
    if not isinstance(value, int | float) or isinstance(value, bool):
        raise ValueError(f"{what}: {name} must be a number, got {value!r}")
    return float(value)


# === 6.1 hyperparameters ============================================================================================


def parse_hyperparameter_choice(choice: str) -> tuple[int, int, int]:
    """``(num_leaves, min_child_samples, n_estimators)`` of a 6.1 decision's ``choice``.

    Raises:
        ValueError: ``choice`` is not in the format ``select_hyperparameters`` writes.
    """
    match = _CHOICE.fullmatch(choice)
    if match is None:
        raise ValueError(
            f"{choice!r} is not a hyperparameter choice (num_leaves=..,min_child_samples=..,n_estimators=..)"
        )
    leaves, child, trees = match.groups()
    return int(leaves), int(child), int(trees)


def select_hyperparameters(grid_scores: pl.DataFrame) -> Decision:
    """Rule 6.1: the lowest score; configurations within 1% of it tie, and the tie goes to the simpler model.

    Ties are broken toward fewer leaves, then fewer trees; if two still tie, the larger ``min_child_samples`` (the more
    regularised) wins and ``evidence["used_min_child_rule"]`` is 1. The chosen values apply to all four targets.

    Args:
        grid_scores: Columns ``num_leaves``, ``min_child_samples``, ``n_estimators``, ``score`` (lower is better), one
            row per configuration.

    Returns:
        The decision; ``tie_broken`` is True when more than one configuration was within 1% of the best.

    Raises:
        ValueError: A column is missing, there is no row, a score is not finite, or a configuration is repeated.
    """
    keys = ["num_leaves", "min_child_samples", "n_estimators"]
    _require_columns(grid_scores, [*keys, "score"], "grid scores")
    if grid_scores.height == 0:
        raise ValueError("no configuration to choose from")
    if not grid_scores["score"].cast(pl.Float64).is_finite().all():
        raise ValueError("every score must be finite")
    if grid_scores.select(keys).is_duplicated().any():
        raise ValueError("the grid scores hold a duplicate configuration")
    rows = [
        (int(r["num_leaves"]), int(r["min_child_samples"]), int(r["n_estimators"]), float(r["score"]))
        for r in grid_scores.select([*keys, "score"]).to_dicts()
    ]
    best = min(row[3] for row in rows)
    tied = [row for row in rows if row[3] <= best * (1.0 + HYPERPARAMETER_TIE_TOLERANCE)]
    fewest_leaves = min(row[0] for row in tied)
    tied = [row for row in tied if row[0] == fewest_leaves]
    fewest_trees = min(row[2] for row in tied)
    tied = [row for row in tied if row[2] == fewest_trees]
    used_min_child = len(tied) > 1
    leaves, child, trees, score = max(tied, key=lambda row: row[1])
    n_within = sum(1 for row in rows if row[3] <= best * (1.0 + HYPERPARAMETER_TIE_TOLERANCE))
    return Decision(
        rule=_RULE_HYPERPARAMETERS,
        choice=f"num_leaves={leaves},min_child_samples={child},n_estimators={trees}",
        evidence={
            "best_score": best,
            "chosen_score": score,
            "relative_gap": (score - best) / best if best > 0 else 0.0,
            "tolerance": HYPERPARAMETER_TIE_TOLERANCE,
            "n_configs": float(len(rows)),
            "n_within_1pct": float(n_within),
            "used_min_child_rule": 1.0 if used_min_child else 0.0,
            "num_leaves": float(leaves),
            "min_child_samples": float(child),
            "n_estimators": float(trees),
        },
        tie_broken=n_within > 1,
    )


# === 6.2 feature set ================================================================================================


def select_feature_set(
    site: pl.DataFrame, cold: pl.DataFrame, *, extra_evidence: Mapping[str, float] | None = None
) -> Decision:
    """Rule 6.2: ``site`` only if it beats ``cold`` on T and on Td by >= 1% LOCO CRPS, each with its interval below 0.

    Args:
        site: Columns ``target``, ``crps``, ``diff_lo``, ``diff_hi`` (the paired 95% interval of site minus cold mean
            CRPS), one row for ``t`` and one for ``td`` (other targets are ignored).
        cold: Columns ``target`` and ``crps``, the same two targets.
        extra_evidence: Numbers to record beside the rule's own (they never enter the decision): the orchestration
            passes the share of held-out rows without a station climatology (see the module docstring).

    Returns:
        ``site`` or ``cold``. A null interval is no evidence for ``site``.

    Raises:
        ValueError: A column or a target row is missing, or a ``cold`` CRPS is not positive.
    """
    _require_columns(site, ["target", "crps", "diff_lo", "diff_hi"], "site")
    _require_columns(cold, ["target", "crps"], "cold")
    evidence: dict[str, float] = {"min_improvement": FEATURE_SET_MIN_IMPROVEMENT, **(extra_evidence or {})}
    passes: list[bool] = []
    for target in ("t", "td"):
        site_row, cold_row = _row_of(site, target, "site"), _row_of(cold, target, "cold")
        site_crps, cold_crps = _number(site_row, "crps", "site"), _number(cold_row, "crps", "cold")
        if site_crps is None or cold_crps is None or cold_crps <= 0.0:
            raise ValueError(f"the {target} CRPS must be a number, and the cold one positive")
        improvement = (cold_crps - site_crps) / cold_crps
        lo, hi = _number(site_row, "diff_lo", "site"), _number(site_row, "diff_hi", "site")
        evidence |= {
            f"{target}_crps_site": site_crps,
            f"{target}_crps_cold": cold_crps,
            f"{target}_improvement_rel": improvement,
            f"{target}_interval_available": 0.0 if lo is None or hi is None else 1.0,
        }
        if lo is not None and hi is not None:
            evidence |= {f"{target}_diff_lo": lo, f"{target}_diff_hi": hi}
        passes.append(improvement >= FEATURE_SET_MIN_IMPROVEMENT and hi is not None and hi < 0.0)
    return Decision(
        rule=_RULE_FEATURE_SET, choice="site" if all(passes) else "cold", evidence=evidence, tie_broken=False
    )


# === 6.3 WBGT method ================================================================================================


def select_wbgt_method(joint: pl.DataFrame, direct: pl.DataFrame) -> Decision:
    """Rule 6.3: the lower LOCO CRPS wins; a difference under 1% (of ``joint``) is a tie and goes to ``joint``.

    Args:
        joint: Columns ``target`` and ``crps``, one ``wbgt`` row.
        direct: The same for the direct WBGT quantile model.

    Raises:
        ValueError: A column or the single ``wbgt`` row is missing, or the joint CRPS is not positive.
    """
    _require_columns(joint, ["target", "crps"], "joint")
    _require_columns(direct, ["target", "crps"], "direct")
    crps_joint = _number(_row_of(joint, "wbgt", "joint"), "crps", "joint")
    crps_direct = _number(_row_of(direct, "wbgt", "direct"), "crps", "direct")
    if crps_joint is None or crps_direct is None or crps_joint <= 0.0:
        raise ValueError("the wbgt CRPS must be a number, and the joint one positive")
    improvement = (crps_joint - crps_direct) / crps_joint
    tie = abs(improvement) < WBGT_TIE_TOLERANCE
    choice = "direct" if improvement >= WBGT_TIE_TOLERANCE else "joint"
    return Decision(
        rule=_RULE_WBGT,
        choice=choice,
        evidence={
            "crps_joint": crps_joint,
            "crps_direct": crps_direct,
            "direct_improvement_rel": improvement,
            "tolerance": WBGT_TIE_TOLERANCE,
        },
        tie_broken=tie,
    )


# === 6.4 calibration window =========================================================================================


def select_calibration_window(
    coverage_by_tercile: pl.DataFrame, current: str, *, targets: Collection[str] = ("wbgt",)
) -> Decision:
    """Rule 6.4: switch from ``september`` to ``weeks_4_8_12_16`` once if top-tercile 90% coverage is below 0.85.

    "Below 0.85" is strict: 0.85 keeps the window. Any one lead of 1-3 below the floor switches. The switch happens at
    most once and is never undone: a ``current`` of ``weeks_4_8_12_16`` is kept whatever the coverage.

    Args:
        coverage_by_tercile: ``evaluate.coverage_by_forecast_tercile`` output for leads 1-3, working daytime.
        current: The window now in use.
        targets: The targets whose interval decides: ``CALIBRATION_TARGET_READINGS["wbgt"]`` (the default of this
            pure function) or ``["all"]`` (what ``run_dev_selection`` passes by default); see the module docstring. The
            coverage of every target in the frame is recorded in the evidence, with a ``decides_<target>`` flag.

    Raises:
        ValueError: ``current`` is not a window, a column is missing, or a decisive lead has no top-tercile row.
    """
    if current not in _CALIBRATION_WINDOWS:
        raise ValueError(f"unknown calibration window {current!r}; expected one of {_CALIBRATION_WINDOWS}")
    _require_columns(coverage_by_tercile, ["target", "lead_days", "tercile", "coverage"], "coverage")
    top = coverage_by_tercile.filter(pl.col("tercile") == "high")
    evidence: dict[str, float] = {"floor": CALIBRATION_COVERAGE_FLOOR}
    decisive: list[float] = []
    for target in sorted(set(top["target"].to_list())):
        for lead in SELECTION_LEADS:
            rows = top.filter((pl.col("target") == target) & (pl.col("lead_days") == lead))
            if rows.height != 1:
                raise ValueError(f"target {target!r} has {rows.height} top-tercile rows for lead {lead}; one is needed")
            value = float(rows["coverage"].item())
            evidence[f"top_coverage_{target}_lead{lead}"] = value
            if "n" in rows.columns:
                evidence[f"top_n_{target}_lead{lead}"] = float(rows["n"].item())
            if target in targets:
                decisive.append(value)
    absent = sorted(set(targets) - set(top["target"].to_list()))
    if absent or not decisive:
        raise ValueError(
            f"the coverage frame has no top-tercile rows for the deciding target(s) {absent or list(targets)}"
        )
    low = min(decisive)
    evidence["min_top_coverage"] = low
    evidence["deciding_targets"] = float(len(targets))
    for target in sorted(set(top["target"].to_list())):
        evidence[f"decides_{target}"] = 1.0 if target in targets else 0.0
    switch = current != _WEEKS and low < CALIBRATION_COVERAGE_FLOOR
    return Decision(
        rule=_RULE_CALIBRATION,
        choice=_WEEKS if switch or current == _WEEKS else current,
        evidence=evidence,
        tie_broken=False,
    )


# === the cheap hyperparameter score (6.1) ===========================================================================


def _refuse_holdout_rows(pairs: pl.DataFrame) -> None:
    years = set(pairs["valid_time"].dt.year().unique().to_list())
    summers = set(pairs["summer"].unique().to_list())
    if TEST_SUMMER in years or TEST_SUMMER in summers:
        raise HoldoutViolationError(f"the frame holds summer {TEST_SUMMER}, the hold-out: selection works on 2024-2025")


def _fold_stats(train: pl.DataFrame, cfg: TrainingConfig) -> FoldStats:
    """The fold statistics, fitted on the fold's fit and calibration rows as ``train_corrector`` fits them."""
    window = cfg.calibration_window
    calendar = train.select(pl.col("valid_time").dt.date().alias("valid_date"), pl.col("summer"))
    return fit_fold_stats(train.filter(fit_mask(calendar, window) | calibration_mask(calendar, window)))


def _fold_frames(
    train: pl.DataFrame, test: pl.DataFrame, cfg: TrainingConfig, leads: Sequence[int]
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """The fit rows and the scored test rows of one fold, built as ``train_corrector`` builds them (L3, L4, L7)."""
    window = cfg.calibration_window
    stats = _fold_stats(train, cfg)
    site = cfg.feature_set is FeatureSet.SITE
    train_frame = build_features(
        train, feature_set=cfg.feature_set, stats=stats, history=history_features(train) if site else None
    ).filter(pl.col("hour_block").is_not_null())
    fit_rows = train_frame.filter(fit_mask(train_frame, window))
    test_frame = build_features(
        test, feature_set=cfg.feature_set, stats=stats, history=history_features(test) if site else None
    ).filter(
        pl.col("hour_block").is_not_null()
        & pl.col("lead_days").is_in(list(leads))
        & pl.col("hour_utc").is_in(list(WORKING_HOURS_UTC))
    )
    return fit_rows, test_frame


def score_hyperparameter_grid(
    pairs: pl.DataFrame,
    cfg: TrainingConfig,
    *,
    points: Sequence[tuple[int, int, int]] = HYPERPARAMETER_GRID,
    clusters: Sequence[str] | None = None,
    leads: Sequence[int] = SELECTION_LEADS,
) -> pl.DataFrame:
    """The 6.1 score of every grid point: LOCO out-of-fold mean pinball loss at levels 0.1, 0.5, 0.9 for T and Td.

    Only three boosters per target per fold are fitted (``fit_quantile_models(levels=GRID_LEVELS)``), on the fold's
    fit rows with the fold's own statistics and history, exactly as ``train_corrector`` builds them. The score is of
    the raw predicted error quantiles (sorted per row, as at serving; no conformal offset: the offsets are not a
    hyperparameter). Rows: the held-out cluster's rows at ``leads`` and the working daytime whose truth and forecast
    exist, pooled over folds. The score is the mean of the T and Td mean pinball losses.

    A booster of ``n`` trees is the first ``n`` trees of a booster of more (LightGBM's bagging and feature sampling do
    not depend on the number of rounds, and the learning rate is constant), so each ``(num_leaves,
    min_child_samples)`` pair is fitted once at its largest ``n_estimators`` and read at each smaller one; a test
    pins that the prefix equals a booster fitted at that size.

    Args:
        pairs: Dev rows (``load_dev_pairs`` shape).
        cfg: The base config (feature set, window, leads and the fixed LightGBM values).
        points: ``(num_leaves, min_child_samples, n_estimators)`` triples.
        clusters: Held-out clusters (default all six).
        leads: The leads scored.

    Returns:
        Columns ``num_leaves``, ``min_child_samples``, ``n_estimators``, ``pinball_t``, ``pinball_td``, ``score``,
        ``n_rows_t``, ``n_rows_td``, one row per point.

    Raises:
        HoldoutViolationError: ``pairs`` holds summer 2026.
        ValueError: A cluster is unknown, ``points`` is empty, or a target has no scored row.
    """
    _refuse_holdout_rows(pairs)
    if not points:
        raise ValueError("points must name at least one configuration")
    wanted = tuple(CLUSTERS if clusters is None else clusters)
    unknown = sorted(set(wanted) - set(CLUSTERS))
    if unknown:
        raise ValueError(f"unknown cluster(s) {unknown}; the clusters are {list(CLUSTERS)}")
    summers = frozenset(int(summer) for summer in pairs["summer"].unique().to_list())
    pairs_by_shape = sorted({(leaves, child) for leaves, child, _ in points})
    totals: dict[tuple[int, int, int, Target], list[float]] = {}
    for fold in (f for f in loco_folds(summers) if next(iter(f.test_clusters)) in wanted):
        train, test = split(pairs, fold)
        fit_rows, test_rows = _fold_frames(train, test, cfg, leads)
        del train, test
        for target in (Target.T, Target.TD):
            y_all = test_rows[f"y_{target.value}"].cast(pl.Float64()).fill_null(float("nan")).to_numpy()
            raw_all = test_rows[f"raw_{target.value}"].cast(pl.Float64()).fill_null(float("nan")).to_numpy()
            keep = np.isfinite(y_all) & np.isfinite(raw_all)
            scored = test_rows.filter(pl.Series(keep))
            y = np.asarray(y_all[keep], dtype=np.float64)
            x = feature_matrix(scored, cfg.feature_set)
            for leaves, child in pairs_by_shape:
                sizes = sorted({n for lv, ch, n in points if (lv, ch) == (leaves, child)})
                shape_cfg = cfg.model_copy(
                    update={
                        "lgbm": cfg.lgbm.model_copy(
                            update={"num_leaves": leaves, "min_child_samples": child, "n_estimators": max(sizes)}
                        )
                    }
                )
                boosters = fit_quantile_models(fit_rows, target=target, cfg=shape_cfg, levels=GRID_LEVELS)
                for n in sizes:
                    predicted = np.sort(
                        np.column_stack(
                            [np.asarray(b.predict(x, num_iteration=n), dtype=np.float64) for b in boosters]
                        ),
                        axis=1,
                    )
                    loss = np.zeros(y.shape[0], dtype=np.float64)
                    for column, level in enumerate(GRID_LEVELS):
                        # metrics.pinball reads one column of a 19-wide grid: tile the prediction for the facade
                        grid = np.repeat(predicted[:, [column]], len(LEVELS), axis=1)
                        loss += metrics.pinball(y, grid, level)
                    cell = totals.setdefault((leaves, child, n, target), [0.0, 0.0])
                    cell[0] += float((loss / len(GRID_LEVELS)).sum())
                    cell[1] += float(y.shape[0])
        del fit_rows, test_rows
    rows: list[dict[str, float | int]] = []
    for leaves, child, trees in sorted(set(points)):
        record: dict[str, float | int] = {"num_leaves": leaves, "min_child_samples": child, "n_estimators": trees}
        means: list[float] = []
        for target in (Target.T, Target.TD):
            total, count = totals.get((leaves, child, trees, target), [0.0, 0.0])
            if count == 0.0:
                raise ValueError(f"no scored row for target {target.value}: nothing to score the grid on")
            record[f"pinball_{target.value}"] = total / count
            record[f"n_rows_{target.value}"] = int(count)
            means.append(total / count)
        record["score"] = float(np.mean(means))
        rows.append(record)
    return pl.DataFrame(rows).select(
        "num_leaves", "min_child_samples", "n_estimators", "pinball_t", "pinball_td", "score", "n_rows_t", "n_rows_td"
    )


def held_out_missing_station_climatology(
    pairs: pl.DataFrame,
    cfg: TrainingConfig,
    *,
    clusters: Sequence[str] | None = None,
    leads: Sequence[int] = SELECTION_LEADS,
) -> tuple[int, int]:
    """How many held-out rows the 6.2 comparison scores on T have no station climatology (``sclim_t`` null).

    Rebuilds, per leave-one-cluster-out fold, the ``site`` features of the held-out cluster exactly as the evaluation
    builds them (the fold's own statistics and history) and counts, among the rows at ``leads`` in the working daytime
    whose T truth and raw forecast exist, those whose ``sclim_t`` is null. A held-out station is by construction not
    in the fold's training rows, so this is expected to be (nearly) all of them: the limitation the module docstring
    states, measured here and not assumed.

    Args:
        pairs: Dev rows (``load_dev_pairs`` shape).
        cfg: The config whose calibration window selects the statistics' rows (the feature set is always ``site``).
        clusters: Held-out clusters (default all six).
        leads: The leads scored.

    Returns:
        ``(rows without sclim_t, rows)`` over the held-out clusters.

    Raises:
        HoldoutViolationError: ``pairs`` holds summer 2026.
        ValueError: A cluster is unknown or no held-out row is scored.
    """
    _refuse_holdout_rows(pairs)
    wanted = tuple(CLUSTERS if clusters is None else clusters)
    unknown = sorted(set(wanted) - set(CLUSTERS))
    if unknown:
        raise ValueError(f"unknown cluster(s) {unknown}; the clusters are {list(CLUSTERS)}")
    summers = frozenset(int(summer) for summer in pairs["summer"].unique().to_list())
    missing = rows = 0
    for fold in (f for f in loco_folds(summers) if next(iter(f.test_clusters)) in wanted):
        train, test = split(pairs, fold)
        stats = _fold_stats(train, cfg)
        scored = build_features(test, feature_set=FeatureSet.SITE, stats=stats, history=history_features(test)).filter(
            pl.col("hour_block").is_not_null()
            & pl.col("lead_days").is_in(list(leads))
            & pl.col("hour_utc").is_in(list(WORKING_HOURS_UTC))
            & pl.col("y_t").is_not_null()
            & pl.col("raw_t").is_not_null()
        )
        rows += scored.height
        missing += int(scored["sclim_t"].is_null().sum())
    if rows == 0:
        raise ValueError("no held-out row has a T truth and a raw forecast: nothing to count")
    return missing, rows


# === the paired LOCO CRPS tables (6.2, 6.3) =========================================================================


def paired_loco_crps(
    candidate: OofPredictions,
    reference: OofPredictions,
    *,
    targets: Sequence[Target],
    leads: Sequence[int] = SELECTION_LEADS,
    n_boot: int = 2000,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """The mean LOCO CRPS of two runs' correctors on the rows both scored, with the paired bootstrap interval.

    The two runs (``site`` against ``cold``, ``direct`` against ``joint``) must hold the same rows in the same order.
    Their corrector grids are put side by side in one ``OofPredictions`` and scored by ``evaluate.skill_table``
    (working daytime, ``leads``, pre-registered 7-day blocks, ``n_boot`` replicates, seed 20261112), so the numbers are
    those of the evaluation report's machinery, not a second implementation. For WBGT the candidate's B2d grid rides
    along because the WBGT skill table needs it for the Brier scores.

    Returns:
        ``(candidate_frame, reference_frame)``: the candidate's ``target``, ``crps``, ``n_rows``, ``n_days``, ``diff``
        (candidate minus reference), ``diff_lo``, ``diff_hi``; the reference's ``target``, ``crps``, ``n_rows``,
        ``n_days``.

    Raises:
        ValueError: The runs' rows differ, a target has no corrector grid in either, or no target is asked for.
    """
    if not targets:
        raise ValueError("targets must name at least one target")
    key = ["station", "valid_time", "lead_days"]
    if not candidate.keys.select(key).equals(reference.keys.select(key)):
        raise ValueError("the two runs do not hold the same rows in the same order: a paired comparison needs both")
    grids: dict[tuple[Target, str], F64] = {}
    for target in targets:
        grids[(target, CORRECTOR)] = candidate.grids[(target, CORRECTOR)]
        grids[(target, _REFERENCE)] = reference.grids[(target, CORRECTOR)]
        if target is Target.WBGT:
            grids[(target, "b2d")] = candidate.grids[(target, "b2d")]
    paired = OofPredictions(
        keys=candidate.keys,
        grids=grids,
        samples=None,
        sample_index=None,
        base_rates=candidate.base_rates,
        tercile_edges=candidate.tercile_edges,
        fallbacks=candidate.fallbacks,
    )
    table = skill_table(paired, leads=leads, hours="working", by=[], n_boot=n_boot)
    candidate_frame = table.select(
        "target",
        pl.col(f"crps_{CORRECTOR}").alias("crps"),
        "n_rows",
        "n_days",
        pl.col(f"crps_diff_{_REFERENCE}").alias("diff"),
        pl.col(f"crps_diff_{_REFERENCE}_lo").alias("diff_lo"),
        pl.col(f"crps_diff_{_REFERENCE}_hi").alias("diff_hi"),
    )
    reference_frame = table.select("target", pl.col(f"crps_{_REFERENCE}").alias("crps"), "n_rows", "n_days")
    return candidate_frame, reference_frame


# === the dev run ====================================================================================================


@dataclass(frozen=True, eq=False)
class DevSelection:
    """The outcome of ``run_dev_selection``.

    Attributes:
        mode: ``"grid"`` (all four rules ran) or ``"single"`` (only the given config ran; the 6.4 decision is a report,
            not applied).
        decisions: The rules' decisions in order.
        cfg: The final configuration (the base config with the chosen values applied in ``grid`` mode, named
            ``<base name>-selected``).
        cfg_sha256: SHA-256 of the base config file in ``single`` mode; of the derived config's canonical JSON in
            ``grid`` mode (the final configuration is a new config: a fingerprint, not a file hash).
        oof: The final configuration's LOCO predictions (what the exports are written from).
        summer_split: The R23 diagnostic (``grid`` mode only; reported, never used to select).
        grid_scores: The 6.1 scores (``grid`` mode only).
        tables: The intermediate frames each decision read, by name, kept so the decisions can be re-derived.
        counts: Per-stage counts, computed from the data (``loco_runs`` is counted where each LOCO run starts).
        calibration_targets: The 6.4 reading in force, ``"wbgt"`` or ``"all"``.
    """

    mode: Literal["grid", "single"]
    decisions: tuple[Decision, ...]
    cfg: TrainingConfig
    cfg_sha256: str
    oof: OofPredictions
    summer_split: OofPredictions | None
    grid_scores: pl.DataFrame | None
    tables: dict[str, pl.DataFrame]
    counts: dict[str, int]
    calibration_targets: str


def config_fingerprint(cfg: TrainingConfig) -> str:
    """SHA-256 of a derived config's canonical JSON (an evaluation-only config has no file to hash)."""
    return hashlib.sha256(cfg.model_dump_json().encode("utf-8")).hexdigest()


@contextmanager
def _stage(name: str, **fields: object) -> Iterator[None]:
    started = time.monotonic()
    _log.info("selection.stage_started", stage=name, **fields)
    try:
        yield
    finally:
        _log.info("selection.stage_done", stage=name, seconds=round(time.monotonic() - started, 1), **fields)


@dataclass
class _LocoRunner:
    """Runs the full LOCO evaluation and counts the runs (``loco_runs`` is read from here, never written by hand)."""

    pairs: pl.DataFrame
    clusters: Sequence[str] | None
    runs: int = 0

    def __call__(self, cfg: TrainingConfig, cfg_sha256: str) -> OofPredictions:
        self.runs += 1
        return evaluate_dev(
            self.pairs, cfg, cfg_sha256=cfg_sha256, clusters=self.clusters, sample_clusters=(EXPORT_CLUSTER,)
        )


def _coverage(oof: OofPredictions) -> pl.DataFrame:
    return coverage_by_forecast_tercile(oof, leads=SELECTION_LEADS, hours="working")


def _counts(oof: OofPredictions, **extra: int) -> dict[str, int]:
    days = oof.keys.select("summer", "valid_date").unique().height
    return {"oof_rows": oof.keys.height, "oof_days": days, **extra}


type Preflight = Callable[[OofPredictions, TrainingConfig], None]
"""A check run on the FIRST LOCO output (``exporters.preflight_dev_exports``): it raises if the export would fail."""


def run_dev_selection(
    pairs: pl.DataFrame,
    base_cfg: TrainingConfig,
    base_cfg_sha256: str,
    *,
    grid: bool,
    clusters: Sequence[str] | None = None,
    grid_points: Sequence[tuple[int, int, int]] = HYPERPARAMETER_GRID,
    n_boot: int = 2000,
    calibration_targets: Literal["wbgt", "all"] = "all",
    preflight: Preflight | None = None,
) -> DevSelection:
    """Run the dev selection (pre-registration section 6) in the pre-registered order, reusing every run it can.

    With ``grid=True``: (a) score the 6.1 grid by the cheap LOCO path and decide; (b) with the chosen hyperparameters
    run the full LOCO for ``site`` and ``cold`` (joint WBGT) and decide 6.2 from their paired CRPS tables; (c) with the
    chosen feature set run the full LOCO with the direct WBGT model and decide 6.3 against the joint run of (b); (d)
    decide 6.4 from the chosen run's top-tercile coverage and, if it switches, re-run the chosen configuration once with
    the weeks window so the exports come from the final configuration; (e) run the 2024-to-2025 and 2025-to-2024
    diagnostic (R23). A run that loses its decision is dropped before the next starts, so at most three LOCO runs are in
    memory. The final configuration is the base config with the chosen values, named ``<base name>-selected``.

    With ``grid=False``: only ``base_cfg`` runs through ``evaluate_dev``; the only decision is the 6.4 coverage report
    (``DevSelection.mode == "single"``: it is not applied).

    Args:
        pairs: Dev rows from ``load_dev_pairs`` (summer 2026 is refused downstream).
        base_cfg: The starting config: its hyperparameters other than the three grid values, its window and its
            leads are kept; its feature set scores the grid.
        base_cfg_sha256: SHA-256 of its file.
        grid: Run the selection (True) or the single run (False).
        clusters: Held-out clusters (default all six; a fixture passes the ones it has).
        grid_points: The 6.1 configurations (default the pre-registered eight; a test passes fewer).
        n_boot: Bootstrap replicates of the paired intervals (the pre-registered 2,000).
        calibration_targets: The 6.4 reading (``CALIBRATION_TARGET_READINGS``): ``"all"`` (default; the rule applies to
            T, Td, wind and WBGT) or ``"wbgt"`` (only the WBGT interval decides).
        preflight: Called once with the first LOCO output and its config, before anything else is run (the CLI passes
            ``exporters.preflight_dev_exports``); an exception ends the run there.

    Returns:
        The decisions, the final configuration and its LOCO predictions, the diagnostic and the intermediate tables.
    """
    deciding = CALIBRATION_TARGET_READINGS[calibration_targets]
    loco = _LocoRunner(pairs, clusters)
    if not grid:
        with _stage("loco_single", config=base_cfg.name):
            oof = loco(base_cfg, base_cfg_sha256)
        if preflight is not None:
            preflight(oof, base_cfg)
        coverage = _coverage(oof)
        decision = select_calibration_window(coverage, base_cfg.calibration_window, targets=deciding)
        return DevSelection(
            mode="single",
            decisions=(decision,),
            cfg=base_cfg,
            cfg_sha256=base_cfg_sha256,
            oof=oof,
            summer_split=None,
            grid_scores=None,
            tables={"coverage_by_forecast_tercile": coverage},
            counts=_counts(oof, dev_pairs_rows=pairs.height, loco_runs=loco.runs),
            calibration_targets=calibration_targets,
        )

    with _stage("grid_scores", configurations=len(grid_points)):
        grid_scores = score_hyperparameter_grid(pairs, base_cfg, points=grid_points, clusters=clusters)
    hyper = select_hyperparameters(grid_scores)
    leaves, child, trees = parse_hyperparameter_choice(hyper.choice)
    lgbm = base_cfg.lgbm.model_copy(update={"num_leaves": leaves, "min_child_samples": child, "n_estimators": trees})
    tuned = base_cfg.model_copy(update={"lgbm": lgbm})

    site_cfg = tuned.model_copy(update={"feature_set": FeatureSet.SITE, "wbgt_method": "joint"})
    cold_cfg = tuned.model_copy(update={"feature_set": FeatureSet.COLD, "wbgt_method": "joint"})
    with _stage("loco_site"):
        site_oof = loco(site_cfg, config_fingerprint(site_cfg))
    if preflight is not None:
        preflight(site_oof, site_cfg)  # the export must build from a LOCO output before hours more are spent
    with _stage("loco_cold"):
        cold_oof = loco(cold_cfg, config_fingerprint(cold_cfg))
    with _stage("feature_set_tables"):
        site_table, cold_table = paired_loco_crps(site_oof, cold_oof, targets=(Target.T, Target.TD), n_boot=n_boot)
    with _stage("site_history_coverage"):
        no_sclim, scored_rows = held_out_missing_station_climatology(pairs, site_cfg, clusters=clusters)
    feature = select_feature_set(
        site_table,
        cold_table,
        extra_evidence={
            "heldout_rows_t": float(scored_rows),
            "heldout_null_sclim_t_rows": float(no_sclim),
            "heldout_null_sclim_t_share": no_sclim / scored_rows,
        },
    )
    joint_cfg, joint_oof = (site_cfg, site_oof) if feature.choice == "site" else (cold_cfg, cold_oof)
    del site_oof, cold_oof

    direct_cfg = joint_cfg.model_copy(update={"wbgt_method": "direct"})
    with _stage("loco_direct"):
        direct_oof = loco(direct_cfg, config_fingerprint(direct_cfg))
    with _stage("wbgt_tables"):
        direct_table, joint_table = paired_loco_crps(direct_oof, joint_oof, targets=(Target.WBGT,), n_boot=n_boot)
    method = select_wbgt_method(joint_table, direct_table)
    cfg, oof = (joint_cfg, joint_oof) if method.choice == "joint" else (direct_cfg, direct_oof)
    del joint_oof, direct_oof
    cfg = cfg.model_copy(update={"name": f"{base_cfg.name}-selected"})  # a derived config is not the base config

    coverage = _coverage(oof)
    window = select_calibration_window(coverage, cfg.calibration_window, targets=deciding)
    rerun = window.choice != cfg.calibration_window
    if rerun:
        cfg = cfg.model_copy(update={"calibration_window": window.choice})
        del oof
        with _stage("loco_final_weeks_window"):
            oof = loco(cfg, config_fingerprint(cfg))
    fingerprint = config_fingerprint(cfg)

    with _stage("summer_split"):
        split_oof = evaluate_summer_split(pairs, cfg, cfg_sha256=fingerprint)
    return DevSelection(
        mode="grid",
        decisions=(hyper, feature, method, window),
        cfg=cfg,
        cfg_sha256=fingerprint,
        oof=oof,
        summer_split=split_oof,
        grid_scores=grid_scores,
        tables={
            "feature_set_site": site_table,
            "feature_set_cold": cold_table,
            "wbgt_joint": joint_table,
            "wbgt_direct": direct_table,
            "coverage_by_forecast_tercile": coverage,
        },
        counts=_counts(
            oof,
            dev_pairs_rows=pairs.height,
            hyperparameter_configurations=grid_scores.height,
            loco_runs=loco.runs,
            summer_split_rows=split_oof.keys.height,
            calibration_window_rerun=int(rerun),
        ),
        calibration_targets=calibration_targets,
    )
