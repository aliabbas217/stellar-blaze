"""The pre-registered selection rules (section 6.1-6.4) as pure functions, and the orchestration around them (Task 12).

The rule tests build the small input frames by hand: the numbers are chosen so that each branch of a rule, and the
neighbours on either side of each threshold, are exercised. The orchestration test runs on the synthetic fixture with
tiny LightGBM parameters; it checks that the decisions it records are exactly what the pure functions return on the
intermediate tables it kept (the orchestration re-derives nothing).
"""

import hashlib
import json
from collections.abc import Collection, Sequence
from functools import cache
from typing import Final

import numpy as np
import polars as pl
import pytest
from pydantic import ValidationError

from stellar_blaze.domain.forecast.features import Target
from stellar_blaze.domain.forecast.grid import F64
from stellar_blaze.ml import selection as selection_module
from stellar_blaze.ml.data import HoldoutViolationError
from stellar_blaze.ml.evaluate import OofPredictions, evaluate_dev, skill_table
from stellar_blaze.ml.selection import (
    CALIBRATION_COVERAGE_FLOOR,
    CALIBRATION_TARGET_READINGS,
    EXPORT_CLUSTER,
    FEATURE_SET_MIN_IMPROVEMENT,
    GRID_LEVELS,
    HYPERPARAMETER_TIE_TOLERANCE,
    SELECTION_LEADS,
    WBGT_TIE_TOLERANCE,
    WORKING_HOURS_UTC,
    Decision,
    DevSelection,
    config_fingerprint,
    held_out_missing_station_climatology,
    parse_hyperparameter_choice,
    run_dev_selection,
    score_hyperparameter_grid,
    select_calibration_window,
    select_feature_set,
    select_hyperparameters,
    select_wbgt_method,
)
from stellar_blaze.ml.training_config import TrainingConfig
from tests.fixtures.forecast.dev_run import CLUSTERS, TINY_GRID, dev_cfg, dev_pairs
from tests.fixtures.forecast.trained import CFG_SHA256

pytestmark = pytest.mark.unit

SEPTEMBER: Final = "september"
WEEKS: Final = "weeks_4_8_12_16"


# === 6.1 hyperparameters ============================================================================================


def _grid(rows: Sequence[tuple[int, int, int, float]]) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "num_leaves": [row[0] for row in rows],
            "min_child_samples": [row[1] for row in rows],
            "n_estimators": [row[2] for row in rows],
            "score": [row[3] for row in rows],
        }
    )


def _choice(decision: Decision) -> tuple[int, int, int]:
    values = dict(part.split("=") for part in decision.choice.split(","))
    return int(values["num_leaves"]), int(values["min_child_samples"]), int(values["n_estimators"])


def test_hyperparameter_lowest_score_wins_when_nothing_ties() -> None:
    decision = select_hyperparameters(_grid([(7, 200, 150, 1.00), (15, 200, 150, 0.90), (15, 1000, 400, 0.95)]))

    assert _choice(decision) == (15, 200, 150)
    assert decision.tie_broken is False
    assert decision.rule == "6.1 hyperparameters"
    assert decision.evidence["best_score"] == 0.90
    assert decision.evidence["n_within_1pct"] == 1.0


def test_hyperparameter_tie_prefers_simpler() -> None:
    # 15 leaves is the best by 0.5%, 7 leaves is within 1%: the tie goes to the smaller model
    decision = select_hyperparameters(_grid([(15, 200, 150, 1.000), (7, 200, 150, 1.005), (15, 1000, 400, 1.200)]))

    assert _choice(decision) == (7, 200, 150)
    assert decision.tie_broken is True
    assert decision.evidence["n_within_1pct"] == 2.0
    assert decision.evidence["best_score"] == 1.0
    assert decision.evidence["chosen_score"] == 1.005


def test_hyperparameter_exactly_one_percent_from_the_best_still_ties() -> None:
    """ "Within 1%" includes the boundary: a ``<=`` turned into ``<`` would pick the 15-leaf best instead."""
    boundary = select_hyperparameters(_grid([(15, 200, 150, 1.0), (7, 200, 150, 1.01)]))
    just_outside = select_hyperparameters(_grid([(15, 200, 150, 1.0), (7, 200, 150, 1.0101)]))

    assert _choice(boundary)[0] == 7
    assert boundary.tie_broken is True
    assert boundary.evidence["relative_gap"] == pytest.approx(0.01)
    assert _choice(just_outside)[0] == 15
    assert just_outside.tie_broken is False


def test_hyperparameter_outside_one_percent_is_not_a_tie() -> None:
    decision = select_hyperparameters(_grid([(15, 200, 150, 1.000), (7, 200, 150, 1.011)]))

    assert _choice(decision) == (15, 200, 150)
    assert decision.tie_broken is False


def test_hyperparameter_ties_go_to_fewer_leaves_then_fewer_trees_then_larger_min_child() -> None:
    fewer_trees = select_hyperparameters(_grid([(7, 200, 400, 1.000), (7, 200, 150, 1.004), (15, 200, 150, 1.000)]))
    assert _choice(fewer_trees) == (7, 200, 150)
    assert fewer_trees.evidence["used_min_child_rule"] == 0.0

    larger_child = select_hyperparameters(_grid([(7, 200, 150, 1.000), (7, 1000, 150, 1.004), (15, 200, 150, 1.0)]))
    assert _choice(larger_child) == (7, 1000, 150)
    assert larger_child.tie_broken is True
    assert larger_child.evidence["used_min_child_rule"] == 1.0


def test_hyperparameter_tie_is_independent_of_row_order() -> None:
    rows = [(15, 200, 150, 1.000), (7, 200, 150, 1.005), (7, 1000, 400, 1.002), (15, 1000, 150, 1.4)]
    forward = select_hyperparameters(_grid(rows))
    backward = select_hyperparameters(_grid(rows[::-1]))

    assert forward == backward
    assert _choice(forward) == (7, 200, 150)


def test_hyperparameter_rejects_unusable_scores() -> None:
    with pytest.raises(ValueError, match="no configuration"):
        select_hyperparameters(_grid([]))
    with pytest.raises(ValueError, match="finite"):
        select_hyperparameters(_grid([(7, 200, 150, float("nan")), (15, 200, 150, 1.0)]))
    with pytest.raises(ValueError, match="duplicate"):
        select_hyperparameters(_grid([(7, 200, 150, 1.0), (7, 200, 150, 1.1)]))
    with pytest.raises(ValueError, match="columns"):
        select_hyperparameters(pl.DataFrame({"num_leaves": [7], "score": [1.0]}))


def test_hyperparameter_tolerance_is_the_preregistered_one_percent() -> None:
    assert HYPERPARAMETER_TIE_TOLERANCE == 0.01


# === 6.2 feature set ================================================================================================


def _cold(t: float = 1.0, td: float = 1.0) -> pl.DataFrame:
    return pl.DataFrame({"target": ["t", "td"], "crps": [t, td], "n_rows": [900, 900], "n_days": [120, 120]})


def _site(
    t: float, td: float, *, t_interval: tuple[float, float], td_interval: tuple[float, float] | None = None
) -> pl.DataFrame:
    td_lo, td_hi = t_interval if td_interval is None else td_interval
    return pl.DataFrame(
        {
            "target": ["t", "td"],
            "crps": [t, td],
            "diff_lo": [t_interval[0], td_lo],
            "diff_hi": [t_interval[1], td_hi],
            "n_rows": [900, 900],
            "n_days": [120, 120],
        }
    )


def test_feature_set_needs_1pct_and_ci() -> None:
    excluding_zero = (-0.03, -0.005)
    including_zero = (-0.03, 0.01)

    below_one_percent = select_feature_set(_site(0.991, 0.991, t_interval=excluding_zero), _cold())
    assert below_one_percent.choice == "cold"  # 0.9% improvement: not enough, whatever the interval says

    clear = select_feature_set(_site(0.988, 0.988, t_interval=excluding_zero), _cold())
    assert clear.choice == "site"  # 1.2% with the interval excluding zero
    assert clear.evidence["t_improvement_rel"] == pytest.approx(0.012)

    uncertain = select_feature_set(_site(0.988, 0.988, t_interval=including_zero), _cold())
    assert uncertain.choice == "cold"  # 1.2% but the interval includes zero


def test_feature_set_needs_both_t_and_td() -> None:
    interval = (-0.03, -0.005)
    only_t = select_feature_set(_site(0.95, 0.995, t_interval=interval), _cold())
    only_td = select_feature_set(_site(0.995, 0.95, t_interval=interval), _cold())
    td_interval_includes_zero = select_feature_set(
        _site(0.95, 0.95, t_interval=interval, td_interval=(-0.02, 0.001)), _cold()
    )
    both = select_feature_set(_site(0.95, 0.95, t_interval=interval), _cold())

    assert [d.choice for d in (only_t, only_td, td_interval_includes_zero, both)] == ["cold", "cold", "cold", "site"]


def test_feature_set_exactly_one_percent_counts() -> None:
    decision = select_feature_set(_site(99.0, 99.0, t_interval=(-0.5, -0.1)), _cold(100.0, 100.0))

    assert FEATURE_SET_MIN_IMPROVEMENT == 0.01
    assert decision.choice == "site"  # "by >= 1%" includes 1%


def test_feature_set_worse_site_is_cold_and_a_null_interval_is_not_evidence() -> None:
    worse = select_feature_set(_site(1.2, 1.2, t_interval=(0.1, 0.3)), _cold())
    assert worse.choice == "cold"

    null_interval = pl.DataFrame(
        {"target": ["t", "td"], "crps": [0.9, 0.9], "diff_lo": [None, None], "diff_hi": [None, None]},
        schema={"target": pl.String, "crps": pl.Float64, "diff_lo": pl.Float64, "diff_hi": pl.Float64},
    )
    assert select_feature_set(null_interval, _cold()).choice == "cold"


def test_feature_set_records_every_input_and_ignores_other_targets() -> None:
    site = pl.concat([_site(0.9, 0.9, t_interval=(-0.1, -0.05)), _site(5.0, 5.0, t_interval=(0.0, 1.0)).head(0)])
    extra = pl.DataFrame({"target": ["wind"], "crps": [9.9], "diff_lo": [0.0], "diff_hi": [1.0]})
    decision = select_feature_set(pl.concat([site, extra], how="diagonal"), _cold())

    assert decision.choice == "site"
    assert set(decision.evidence) >= {
        "t_crps_site",
        "t_crps_cold",
        "t_improvement_rel",
        "t_diff_lo",
        "t_diff_hi",
        "td_crps_site",
        "td_crps_cold",
        "td_improvement_rel",
        "td_diff_lo",
        "td_diff_hi",
    }
    assert decision.tie_broken is False


def test_feature_set_missing_target_or_column_raises() -> None:
    with pytest.raises(ValueError, match="td"):
        select_feature_set(_site(0.9, 0.9, t_interval=(-1, -0.5)).head(1), _cold())
    with pytest.raises(ValueError, match="columns"):
        select_feature_set(_site(0.9, 0.9, t_interval=(-1, -0.5)).drop("diff_hi"), _cold())


# === 6.3 WBGT method ================================================================================================


def _wbgt(crps: float) -> pl.DataFrame:
    return pl.DataFrame({"target": ["wbgt"], "crps": [crps], "n_rows": [1000], "n_days": [120]})


def test_wbgt_tie_goes_to_joint() -> None:
    direct_better_by_half_percent = select_wbgt_method(_wbgt(1.000), _wbgt(0.995))
    direct_worse_by_half_percent = select_wbgt_method(_wbgt(1.000), _wbgt(1.005))
    identical = select_wbgt_method(_wbgt(1.0), _wbgt(1.0))

    assert WBGT_TIE_TOLERANCE == 0.01
    for tie in (direct_better_by_half_percent, direct_worse_by_half_percent, identical):
        assert tie.choice == "joint"
        assert tie.tie_broken is True


def test_wbgt_direct_needs_a_clear_win_and_joint_wins_when_lower() -> None:
    clear = select_wbgt_method(_wbgt(1.0), _wbgt(0.98))
    exactly_one_percent = select_wbgt_method(_wbgt(100.0), _wbgt(99.0))
    joint_clearly_better = select_wbgt_method(_wbgt(0.9), _wbgt(1.0))

    assert (clear.choice, clear.tie_broken) == ("direct", False)
    assert exactly_one_percent.choice == "direct"  # a difference "under 1%" is a tie; 1% is not under
    assert (joint_clearly_better.choice, joint_clearly_better.tie_broken) == ("joint", False)
    assert clear.evidence["crps_joint"] == 1.0
    assert clear.evidence["crps_direct"] == 0.98
    assert clear.evidence["direct_improvement_rel"] == pytest.approx(0.02)


def test_wbgt_requires_exactly_one_wbgt_row() -> None:
    with pytest.raises(ValueError, match="wbgt"):
        select_wbgt_method(pl.DataFrame({"target": ["t"], "crps": [1.0]}), _wbgt(1.0))
    with pytest.raises(ValueError, match="wbgt"):
        select_wbgt_method(_wbgt(1.0), pl.concat([_wbgt(1.0), _wbgt(2.0)]))


# === 6.4 calibration window =========================================================================================


def _coverage(top: dict[int, float], *, target: str = "wbgt", other: float = 0.95) -> pl.DataFrame:
    rows = []
    for lead, value in top.items():
        for tercile, coverage in (("low", other), ("mid", other), ("high", value)):
            rows.append({"target": target, "lead_days": lead, "tercile": tercile, "n": 1000, "coverage": coverage})
    return pl.DataFrame(rows)


def test_calibration_switch_at_085() -> None:
    assert CALIBRATION_COVERAGE_FLOOR == 0.85
    just_below = select_calibration_window(_coverage({1: 0.90, 2: 0.849, 3: 0.90}), SEPTEMBER)
    exactly = select_calibration_window(_coverage({1: 0.90, 2: 0.85, 3: 0.90}), SEPTEMBER)
    above = select_calibration_window(_coverage({1: 0.90, 2: 0.90, 3: 0.90}), SEPTEMBER)

    assert just_below.choice == WEEKS
    assert exactly.choice == SEPTEMBER  # "below 0.85" switches, 0.85 does not
    assert above.choice == SEPTEMBER
    assert just_below.evidence["min_top_coverage"] == 0.849
    assert just_below.evidence["floor"] == 0.85


def test_calibration_any_lead_triggers_and_other_terciles_do_not() -> None:
    low_other_terciles_only = select_calibration_window(_coverage({1: 0.9, 2: 0.9, 3: 0.9}, other=0.5), SEPTEMBER)
    lead_one = select_calibration_window(_coverage({1: 0.80, 2: 0.9, 3: 0.9}), SEPTEMBER)
    lead_three = select_calibration_window(_coverage({1: 0.9, 2: 0.9, 3: 0.80}), SEPTEMBER)

    assert low_other_terciles_only.choice == SEPTEMBER
    assert lead_one.choice == WEEKS
    assert lead_three.choice == WEEKS


def test_calibration_switches_once_and_never_back() -> None:
    already = select_calibration_window(_coverage({1: 0.99, 2: 0.99, 3: 0.99}), WEEKS)
    still_low = select_calibration_window(_coverage({1: 0.5, 2: 0.5, 3: 0.5}), WEEKS)

    assert already.choice == WEEKS
    assert still_low.choice == WEEKS


def test_calibration_only_the_wbgt_interval_decides_and_others_are_recorded() -> None:
    frame = pl.concat([_coverage({1: 0.9, 2: 0.9, 3: 0.9}), _coverage({1: 0.5, 2: 0.9, 3: 0.9}, target="t")])
    decision = select_calibration_window(frame, SEPTEMBER)

    assert decision.choice == SEPTEMBER
    assert decision.evidence["top_coverage_t_lead1"] == 0.5  # recorded for the report, not part of the rule
    assert decision.evidence["top_coverage_wbgt_lead1"] == 0.9


def _only_t_is_low() -> pl.DataFrame:
    """Every target covers 0.95 in the top tercile at every lead, except T at lead 2 (0.80)."""
    others = [_coverage({1: 0.95, 2: 0.95, 3: 0.95}, target=name) for name in ("td", "wind", "wbgt")]
    return pl.concat([_coverage({1: 0.95, 2: 0.80, 3: 0.95}, target="t"), *others])


def test_calibration_readings_are_the_two_documented_ones() -> None:
    assert CALIBRATION_TARGET_READINGS == {"wbgt": ("wbgt",), "all": ("t", "td", "wind", "wbgt")}


def test_calibration_wbgt_reading_ignores_a_low_t_and_the_all_reading_switches_on_it() -> None:
    frame = _only_t_is_low()

    wbgt_only = select_calibration_window(frame, SEPTEMBER, targets=CALIBRATION_TARGET_READINGS["wbgt"])
    every_target = select_calibration_window(frame, SEPTEMBER, targets=CALIBRATION_TARGET_READINGS["all"])

    assert wbgt_only.choice == SEPTEMBER
    assert wbgt_only.evidence["min_top_coverage"] == 0.95
    assert every_target.choice == WEEKS
    assert every_target.evidence["min_top_coverage"] == 0.80
    assert every_target.tie_broken is False


def test_calibration_all_reading_switches_once_and_never_switches_back() -> None:
    low_t = _only_t_is_low()
    healthy = pl.concat([_coverage({1: 0.99, 2: 0.99, 3: 0.99}, target=name) for name in ("t", "td", "wind", "wbgt")])
    every_target = CALIBRATION_TARGET_READINGS["all"]

    first = select_calibration_window(low_t, SEPTEMBER, targets=every_target)
    later_still_low = select_calibration_window(low_t, first.choice, targets=every_target)
    later_healthy = select_calibration_window(healthy, first.choice, targets=every_target)

    assert (first.choice, later_still_low.choice, later_healthy.choice) == (WEEKS, WEEKS, WEEKS)
    assert select_calibration_window(healthy, SEPTEMBER, targets=every_target).choice == SEPTEMBER


def test_calibration_evidence_says_which_targets_decided() -> None:
    frame = _only_t_is_low()
    wbgt_only = select_calibration_window(frame, SEPTEMBER, targets=CALIBRATION_TARGET_READINGS["wbgt"])
    every_target = select_calibration_window(frame, SEPTEMBER, targets=CALIBRATION_TARGET_READINGS["all"])

    assert {name: wbgt_only.evidence[f"decides_{name}"] for name in ("t", "td", "wind", "wbgt")} == {
        "t": 0.0,
        "td": 0.0,
        "wind": 0.0,
        "wbgt": 1.0,
    }
    assert wbgt_only.evidence["deciding_targets"] == 1.0
    assert every_target.evidence["deciding_targets"] == 4.0
    assert all(every_target.evidence[f"decides_{name}"] == 1.0 for name in ("t", "td", "wind", "wbgt"))


def test_calibration_a_lead_without_a_top_tercile_row_raises() -> None:
    with pytest.raises(ValueError, match="lead"):
        select_calibration_window(_coverage({1: 0.9, 2: 0.9}), SEPTEMBER)
    with pytest.raises(ValueError, match="window"):
        select_calibration_window(_coverage({1: 0.9, 2: 0.9, 3: 0.9}), "october")


# === the Decision record ============================================================================================


def test_decision_is_frozen_strict_and_json_serialisable() -> None:
    decision = Decision(rule="6.3 wbgt method", choice="joint", evidence={"crps_joint": 1.0}, tie_broken=True)

    assert json.loads(decision.model_dump_json()) == {
        "rule": "6.3 wbgt method",
        "choice": "joint",
        "evidence": {"crps_joint": 1.0},
        "tie_broken": True,
    }
    with pytest.raises(ValidationError):
        decision.choice = "direct"  # type: ignore[misc]
    with pytest.raises(ValidationError):
        Decision.model_validate({"rule": "r", "choice": "c", "evidence": {}, "tie_broken": False, "extra": 1})
    with pytest.raises(ValidationError):
        Decision(rule="r", choice="c", evidence={"x": float("nan")}, tie_broken=False)
    assert hashlib.sha256(decision.model_dump_json().encode()).hexdigest()  # serialisable twice, no state


# === the cheap grid score and the orchestration (synthetic fixture) =================================================

FIXTURE_CLUSTERS: Final = CLUSTERS
_fixture_cfg = dev_cfg
fixture_pairs = dev_pairs


def _zero_error_loss(y: np.ndarray) -> float:
    return float(np.mean([np.mean(np.maximum(q * y, (q - 1.0) * y)) for q in GRID_LEVELS]))


def test_grid_score_rows_and_skill_match_an_independent_count() -> None:
    pairs = fixture_pairs()
    scores = score_hyperparameter_grid(pairs, _fixture_cfg(), points=TINY_GRID[:1], clusters=FIXTURE_CLUSTERS)

    ifs = pairs.filter(
        (pl.col("model") == "ecmwf_ifs025")
        & (pl.col("lead_days") <= 3)
        & pl.col("hour_utc").is_in(list(WORKING_HOURS_UTC))
    )
    for target, obs, fc in (("t", "obs_t_c", "fc_t_c"), ("td", "obs_td_c", "fc_td_c")):
        usable = ifs.filter(pl.col(obs).is_finite() & pl.col(fc).is_finite())
        y = (usable[obs] - usable[fc]).to_numpy()
        assert scores[f"n_rows_{target}"].item() == usable.height  # the rows are exactly leads 1-3, 06-14 UTC, scored
        assert scores[f"pinball_{target}"].item() < _zero_error_loss(y)  # the model beats "no correction"
        if target == "t":  # the injected +3 degree bias: the model must remove most of it
            assert scores["pinball_t"].item() < 0.7 * _zero_error_loss(y)
    assert scores["score"].item() == pytest.approx((scores["pinball_t"].item() + scores["pinball_td"].item()) / 2)


def test_grid_prefix_of_trees_equals_a_model_fitted_at_that_size() -> None:
    pairs, cfg = fixture_pairs(), _fixture_cfg()
    together = score_hyperparameter_grid(pairs, cfg, points=((7, 20, 5), (7, 20, 12)), clusters=("abu_dhabi",))
    alone_small = score_hyperparameter_grid(pairs, cfg, points=((7, 20, 5),), clusters=("abu_dhabi",))
    alone_large = score_hyperparameter_grid(pairs, cfg, points=((7, 20, 12),), clusters=("abu_dhabi",))

    assert together.filter(pl.col("n_estimators") == 5)["score"].item() == alone_small["score"].item()
    assert together.filter(pl.col("n_estimators") == 12)["score"].item() == alone_large["score"].item()
    assert alone_small["score"].item() != alone_large["score"].item()  # the two sizes really differ


def test_grid_refuses_the_holdout_and_an_empty_grid() -> None:
    pairs = fixture_pairs()
    held_out = pairs.with_columns(pl.col("summer").replace({2025: 2026}))
    with pytest.raises(HoldoutViolationError):
        score_hyperparameter_grid(held_out, _fixture_cfg(), points=TINY_GRID[:1], clusters=FIXTURE_CLUSTERS)
    with pytest.raises(ValueError, match="at least one"):
        score_hyperparameter_grid(pairs, _fixture_cfg(), points=(), clusters=FIXTURE_CLUSTERS)


@cache
def _selection_cached() -> DevSelection:
    return run_dev_selection(
        fixture_pairs(),
        _fixture_cfg(),
        CFG_SHA256,
        grid=True,
        clusters=FIXTURE_CLUSTERS,
        grid_points=TINY_GRID,
        n_boot=50,
    )


@pytest.mark.slow
def test_working_hours_constant_is_what_the_skill_table_selects() -> None:
    oof = _selection_cached().oof
    table = skill_table(oof, leads=SELECTION_LEADS, hours="working", by=[], intervals=False)
    selected = oof.keys.filter(
        pl.col("lead_days").is_in(list(SELECTION_LEADS)) & pl.col("hour_utc").is_in(list(WORKING_HOURS_UTC))
    )

    for target in Target:
        row = table.filter(pl.col("target") == target.value)
        assert row["n_rows"].item() + row["n_no_truth"].item() + row["n_no_forecast"].item() == selected.height


@pytest.mark.slow
def test_orchestration_records_exactly_what_the_pure_functions_return() -> None:
    selection = _selection_cached()
    tables = selection.tables
    assert selection.grid_scores is not None

    sclim = {
        name: selection.decisions[1].evidence[name]
        for name in ("heldout_rows_t", "heldout_null_sclim_t_rows", "heldout_null_sclim_t_share")
    }  # recorded beside the rule's own numbers; the rule itself must not read them
    expected = (
        select_hyperparameters(selection.grid_scores),
        select_feature_set(tables["feature_set_site"], tables["feature_set_cold"], extra_evidence=sclim),
        select_wbgt_method(tables["wbgt_joint"], tables["wbgt_direct"]),
        select_calibration_window(
            tables["coverage_by_forecast_tercile"], "september", targets=CALIBRATION_TARGET_READINGS["all"]
        ),
    )

    assert selection.decisions == expected
    assert selection.mode == "grid"
    assert [d.rule for d in selection.decisions] == [
        "6.1 hyperparameters",
        "6.2 feature set",
        "6.3 wbgt method",
        "6.4 calibration window",
    ]


@pytest.mark.slow
def test_orchestration_applies_the_decisions_to_the_final_configuration() -> None:
    selection = _selection_cached()
    hyper, feature, method, window = selection.decisions
    chosen = parse_hyperparameter_choice(hyper.choice)
    lgbm = selection.cfg.lgbm

    assert (lgbm.num_leaves, lgbm.min_child_samples, lgbm.n_estimators) == chosen
    assert chosen in TINY_GRID
    assert selection.cfg.feature_set.value == feature.choice
    assert selection.cfg.wbgt_method == method.choice
    assert selection.cfg.calibration_window == window.choice
    assert selection.cfg_sha256 == config_fingerprint(selection.cfg)
    assert selection.cfg.name == f"{_fixture_cfg().name}-selected"  # a derived config is not the base config
    assert selection.calibration_targets == "all"
    assert selection.grid_scores is not None
    assert selection.grid_scores.height == len(TINY_GRID)
    assert set(selection.tables["feature_set_site"]["target"]) == {"t", "td"}
    assert set(selection.tables["wbgt_direct"]["target"]) == {"wbgt"}


@pytest.mark.slow
def test_orchestration_keeps_the_export_inputs() -> None:
    selection = _selection_cached()
    oof = selection.oof

    assert oof.samples is not None
    assert oof.sample_index is not None
    assert set(oof.keys[oof.sample_index]["cluster"]) == {EXPORT_CLUSTER}
    assert selection.summer_split is not None
    assert set(selection.summer_split.keys["fold"]) == {"train2024_test2025", "train2025_test2024"}
    assert selection.counts["oof_rows"] == oof.keys.height
    assert selection.counts["hyperparameter_configurations"] == len(TINY_GRID)
    assert selection.counts["loco_runs"] == 3 + selection.counts["calibration_window_rerun"]  # site, cold, direct


def _spy_loco(monkeypatch: pytest.MonkeyPatch) -> list[tuple[TrainingConfig, OofPredictions]]:
    """Record every full LOCO run (its config and result) by wrapping the ``evaluate_dev`` the orchestration calls."""
    runs: list[tuple[TrainingConfig, OofPredictions]] = []
    real = evaluate_dev

    def spy(pairs: pl.DataFrame, cfg: TrainingConfig, **kwargs: object) -> OofPredictions:
        oof = real(pairs, cfg, **kwargs)  # type: ignore[arg-type]
        runs.append((cfg, oof))
        return oof

    monkeypatch.setattr(selection_module, "evaluate_dev", spy)
    return runs


@pytest.mark.slow
def test_orchestration_reruns_the_final_configuration_once_when_6_4_switches(monkeypatch: pytest.MonkeyPatch) -> None:
    switch = Decision(
        rule="6.4 calibration window", choice="weeks_4_8_12_16", evidence={"min_top_coverage": 0.5}, tie_broken=False
    )
    monkeypatch.setattr(selection_module, "select_calibration_window", lambda coverage, current, *, targets: switch)
    runs = _spy_loco(monkeypatch)

    selection = run_dev_selection(
        fixture_pairs(),
        _fixture_cfg(),
        CFG_SHA256,
        grid=True,
        clusters=FIXTURE_CLUSTERS,
        grid_points=TINY_GRID[:2],
        n_boot=50,
    )

    assert selection.cfg.calibration_window == "weeks_4_8_12_16"
    assert selection.decisions[3] == switch
    assert selection.counts["calibration_window_rerun"] == 1
    assert len(runs) == 4  # site, cold, direct and the weeks re-run (the summer split is not a LOCO run)
    assert selection.counts["loco_runs"] == len(runs)  # counted where the runs start, not written by hand
    assert selection.cfg_sha256 == config_fingerprint(selection.cfg)
    # the exports come from the re-run: it IS the last run, and it differs from the September run it replaced
    final_cfg, final_oof = runs[-1]
    assert selection.oof is final_oof
    assert final_cfg.calibration_window == "weeks_4_8_12_16"
    september = next(
        oof
        for cfg, oof in runs[:-1]
        if (cfg.feature_set, cfg.wbgt_method) == (final_cfg.feature_set, final_cfg.wbgt_method)
    )
    assert not np.array_equal(
        selection.oof.grids[(Target.T, "corrector")], september.grids[(Target.T, "corrector")], equal_nan=True
    )


@pytest.mark.slow
def test_orchestration_counts_the_loco_runs_it_made_without_a_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    keep = Decision(rule="6.4 calibration window", choice="september", evidence={"floor": 0.85}, tie_broken=False)
    monkeypatch.setattr(selection_module, "select_calibration_window", lambda coverage, current, *, targets: keep)
    runs = _spy_loco(monkeypatch)

    selection = run_dev_selection(
        fixture_pairs(),
        _fixture_cfg(),
        CFG_SHA256,
        grid=True,
        clusters=FIXTURE_CLUSTERS,
        grid_points=TINY_GRID[:2],
        n_boot=50,
    )

    assert selection.counts["calibration_window_rerun"] == 0
    assert len(runs) == 3 == selection.counts["loco_runs"]  # site, cold, direct
    assert any(selection.oof is oof for _, oof in runs)  # the exports come from one of the three, no re-run


@pytest.mark.slow
def test_preflight_runs_once_on_the_first_loco_output_and_stops_the_run_there(monkeypatch: pytest.MonkeyPatch) -> None:
    runs = _spy_loco(monkeypatch)
    seen: list[tuple[OofPredictions, TrainingConfig]] = []

    def preflight(oof: OofPredictions, cfg: TrainingConfig) -> None:
        seen.append((oof, cfg))
        raise RuntimeError("the export would fail")

    with pytest.raises(RuntimeError, match="the export would fail"):
        run_dev_selection(
            fixture_pairs(),
            _fixture_cfg(),
            CFG_SHA256,
            grid=True,
            clusters=FIXTURE_CLUSTERS,
            grid_points=TINY_GRID[:1],
            n_boot=50,
            preflight=preflight,
        )

    assert len(runs) == 1  # not three: the run died at the first LOCO output, not at its last step
    assert len(seen) == 1
    assert seen[0][0] is runs[0][1]
    assert seen[0][1] == runs[0][0]
    assert seen[0][1].feature_set.value == "site"


@pytest.mark.slow
def test_single_mode_runs_only_the_given_config_and_reports_6_4(monkeypatch: pytest.MonkeyPatch) -> None:
    cfg = _fixture_cfg()
    asked: list[tuple[str, ...]] = []
    real = selection_module.select_calibration_window

    def recording(coverage: pl.DataFrame, current: str, *, targets: Collection[str]) -> Decision:
        asked.append(tuple(targets))
        return real(coverage, current, targets=targets)

    monkeypatch.setattr(selection_module, "select_calibration_window", recording)
    preflights: list[tuple[OofPredictions, TrainingConfig]] = []

    selection = run_dev_selection(
        fixture_pairs(),
        cfg,
        CFG_SHA256,
        grid=False,
        clusters=FIXTURE_CLUSTERS,
        n_boot=50,
        preflight=lambda oof, used: preflights.append((oof, used)),
    )

    assert selection.mode == "single"
    assert selection.cfg == cfg
    assert selection.cfg.name == cfg.name  # nothing was derived: the name is kept
    assert selection.cfg_sha256 == CFG_SHA256
    assert [d.rule for d in selection.decisions] == ["6.4 calibration window"]
    assert selection.summer_split is None
    assert selection.grid_scores is None
    assert selection.counts["loco_runs"] == 1
    assert [(oof is selection.oof, used) for oof, used in preflights] == [(True, cfg)]
    assert asked == [("t", "td", "wind", "wbgt")]  # the default reading applies the rule to all four variables
    assert selection.calibration_targets == "all"
    assert selection.decisions[0].evidence["deciding_targets"] == 4.0


@pytest.mark.slow
def test_the_wbgt_reading_reaches_the_rule(monkeypatch: pytest.MonkeyPatch) -> None:
    asked: list[tuple[str, ...]] = []
    real = selection_module.select_calibration_window

    def recording(coverage: pl.DataFrame, current: str, *, targets: Collection[str]) -> Decision:
        asked.append(tuple(targets))
        return real(coverage, current, targets=targets)

    monkeypatch.setattr(selection_module, "select_calibration_window", recording)

    selection = run_dev_selection(
        fixture_pairs(),
        _fixture_cfg(),
        CFG_SHA256,
        grid=False,
        clusters=FIXTURE_CLUSTERS,
        n_boot=50,
        calibration_targets="wbgt",
    )

    assert asked == [("wbgt",)]
    assert selection.calibration_targets == "wbgt"
    assert selection.decisions[0].evidence["deciding_targets"] == 1.0


# === 6.2's structural limitation (A-I5) and the direct WBGT boosters (A-extra) ======================================


def _scored_t_rows(pairs: pl.DataFrame, clusters: Sequence[str]) -> int:
    """The held-out rows the T comparison scores, counted from the gold-shaped pairs (leads 1-3, 06-14 UTC)."""
    return pairs.filter(
        (pl.col("model") == "ecmwf_ifs025")
        & pl.col("cluster").is_in(list(clusters))
        & pl.col("lead_days").is_in(list(SELECTION_LEADS))
        & pl.col("hour_utc").is_in(list(WORKING_HOURS_UTC))
        & pl.col("obs_t_c").is_finite()
        & pl.col("fc_t_c").is_finite()
    ).height


def test_a_held_out_station_has_no_station_climatology_on_any_of_its_rows() -> None:
    pairs, cfg = fixture_pairs(), _fixture_cfg()

    missing_all, rows_all = held_out_missing_station_climatology(pairs, cfg, clusters=FIXTURE_CLUSTERS)
    missing_one, rows_one = held_out_missing_station_climatology(pairs, cfg, clusters=("abu_dhabi",))

    assert rows_all == _scored_t_rows(pairs, FIXTURE_CLUSTERS) > rows_one == _scored_t_rows(pairs, ("abu_dhabi",)) > 0
    assert missing_all == rows_all  # every station is in exactly one cluster, so a LOCO fold never trains on it
    assert missing_one == rows_one


def test_the_station_climatology_count_refuses_the_holdout_and_unknown_clusters() -> None:
    pairs = fixture_pairs()
    held_out = pairs.with_columns(pl.col("summer").replace({2025: 2026}))

    with pytest.raises(HoldoutViolationError):
        held_out_missing_station_climatology(held_out, _fixture_cfg(), clusters=FIXTURE_CLUSTERS)
    with pytest.raises(ValueError, match="unknown cluster"):
        held_out_missing_station_climatology(pairs, _fixture_cfg(), clusters=("atlantis",))


@pytest.mark.slow
def test_the_6_2_decision_records_the_share_of_held_out_rows_without_a_station_climatology() -> None:
    selection = _selection_cached()
    evidence = selection.decisions[1].evidence
    expected_rows = _scored_t_rows(fixture_pairs(), FIXTURE_CLUSTERS)

    assert evidence["heldout_rows_t"] == expected_rows
    assert evidence["heldout_null_sclim_t_rows"] == expected_rows
    assert evidence["heldout_null_sclim_t_share"] == 1.0


@pytest.mark.slow
def test_the_direct_configuration_really_uses_its_own_wbgt_boosters() -> None:
    """A harness that silently reused the joint path for ``direct`` would return the same WBGT grid and fail here."""
    pairs = fixture_pairs()
    joint = evaluate_dev(
        pairs,
        _fixture_cfg().model_copy(update={"wbgt_method": "joint"}),
        cfg_sha256=CFG_SHA256,
        clusters=("abu_dhabi",),
    )
    direct = evaluate_dev(
        pairs,
        _fixture_cfg().model_copy(update={"wbgt_method": "direct"}),
        cfg_sha256=CFG_SHA256,
        clusters=("abu_dhabi",),
    )

    assert joint.keys.equals(direct.keys)
    wbgt_joint: F64 = joint.grids[(Target.WBGT, "corrector")]
    wbgt_direct: F64 = direct.grids[(Target.WBGT, "corrector")]
    both = np.isfinite(wbgt_joint).all(axis=1) & np.isfinite(wbgt_direct).all(axis=1)
    assert both.sum() > 100
    assert float(np.abs(wbgt_joint - wbgt_direct)[both].mean()) > 0.1  # measured 0.28 degC on this fixture
    for target in (Target.T, Target.TD, Target.WIND):  # only WBGT changes: the shared boosters are the same
        np.testing.assert_array_equal(joint.grids[(target, "corrector")], direct.grids[(target, "corrector")])
