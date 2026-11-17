"""``corrected_grids``: the offline predictor that the serving adapter is checked against (Task 11).

The oracle for "the same recipe as ``train_corrector``" is ``train_corrector`` itself: a module fixture trains a model
with a spy on the shared helpers and keeps what training computed on its own calibration rows (the calibrated value
grids that fed the copula PIT, and the pre-conformal joint WBGT grid), so the comparison is with what training did, not
with a second copy of the recipe.
"""

from typing import Final

import numpy as np
import polars as pl
import pytest

from stellar_blaze.adapters.compute.lgbm_corrector import predict_grid
from stellar_blaze.domain.forecast.conformal import apply_offsets
from stellar_blaze.domain.forecast.features import FeatureSet, Target, build_features, history_features
from stellar_blaze.domain.forecast.grid import F64, LEVELS
from stellar_blaze.ml import train as train_module
from stellar_blaze.ml.predict import corrected_grids
from stellar_blaze.ml.quantile_models import feature_matrix
from stellar_blaze.ml.train import TrainedCorrector, train_corrector
from tests.fixtures.forecast.trained import BIASED, CFG_SHA256, small_config, small_pairs

pytestmark = pytest.mark.unit

MEDIAN: Final = LEVELS.index(0.5)
JOINT: Final = (Target.T, Target.TD, Target.WIND)


def _features(pairs: pl.DataFrame, trained: TrainedCorrector) -> pl.DataFrame:
    """The feature frame of ``pairs`` under the model's own statistics (the frame ``train_corrector`` built)."""
    return build_features(
        pairs, feature_set=trained.cfg.feature_set, stats=trained.stats, history=history_features(pairs)
    ).filter(pl.col("hour_block").is_not_null())


def _calibration_rows(pairs: pl.DataFrame, trained: TrainedCorrector) -> pl.DataFrame:
    return _features(pairs, trained).filter(pl.col("valid_date").dt.month() == 9)


class _Spy:
    """What ``train_corrector`` computed on its calibration rows (captured from the shared helpers)."""

    values: dict[Target, F64]
    joint: F64


@pytest.fixture(scope="module")
def spied() -> tuple[pl.DataFrame, TrainedCorrector, _Spy]:
    pairs = small_pairs()
    spy = _Spy()
    real_values, real_joint = train_module.calibrated_value_grids, train_module.joint_wbgt_value_grid

    def values(*args: object, **kwargs: object) -> dict[Target, F64]:
        out = real_values(*args, **kwargs)  # type: ignore[arg-type]
        spy.values = {target: grid.copy() for target, grid in out.items()}
        return out

    def joint(*args: object, **kwargs: object) -> tuple[F64, int]:
        grid, rejected = real_joint(*args, **kwargs)  # type: ignore[arg-type]
        spy.joint = grid.copy()
        return grid, rejected

    patch = pytest.MonkeyPatch()
    patch.setattr(train_module, "calibrated_value_grids", values)
    patch.setattr(train_module, "joint_wbgt_value_grid", joint)
    try:
        trained = train_corrector(pairs, small_config(), cfg_sha256=CFG_SHA256)
    finally:
        patch.undo()
    return pairs, trained, spy


def test_the_grids_equal_what_train_corrector_computed_on_its_calibration_rows(
    spied: tuple[pl.DataFrame, TrainedCorrector, _Spy],
) -> None:
    pairs, trained, spy = spied
    cal = _calibration_rows(pairs, trained)
    assert cal.height == trained.cal_rows
    grids = corrected_grids(trained, cal)
    for target in JOINT:
        np.testing.assert_array_equal(grids[target], spy.values[target], err_msg=target.value)
    # the WBGT recipe of train: error grid = joint - raw, conformalised with the WBGT offsets, plus raw
    raw = cal["raw_wbgt"].to_numpy()
    lead = cal["lead_days"].cast(pl.Int8()).to_numpy()
    expected = (
        apply_offsets(spy.joint - raw[:, None], lead, cal["hour_block"], trained.offsets, Target.WBGT) + raw[:, None]
    )
    np.testing.assert_array_equal(grids[Target.WBGT], expected)
    assert np.isfinite(grids[Target.WBGT]).any()  # not vacuously equal NaN to NaN
    assert grids[Target.WBGT].shape == (cal.height, len(LEVELS))


def test_grids_are_sorted_finite_where_input_exists_and_wind_is_nonnegative(
    spied: tuple[pl.DataFrame, TrainedCorrector, _Spy],
) -> None:
    pairs, trained, _ = spied
    cal = _calibration_rows(pairs, trained)
    grids = corrected_grids(trained, cal)
    assert set(grids) == set(Target)
    for target, grid in grids.items():
        assert grid.shape == (cal.height, len(LEVELS)), target
        usable = np.isfinite(grid).all(axis=1)
        assert usable.mean() > 0.9, target
        assert (np.diff(grid[usable], axis=1) >= 0.0).all(), f"{target.value} grid is not sorted"
    assert grids[Target.WIND].min() >= 0.0


def test_wind_is_floored_at_zero_exactly_as_value_grid(spied: tuple[pl.DataFrame, TrainedCorrector, _Spy]) -> None:
    """A calm raw wind plus a negative error quantile would be below 0: the grid has ties at exactly 0."""
    pairs, trained, _ = spied
    calm = pairs.with_columns(pl.col("fc_wind_ms") * 0.0)
    grids = corrected_grids(trained, _calibration_rows(calm, trained))
    wind = grids[Target.WIND]
    assert wind.min() == 0.0
    assert (wind == 0.0).any(axis=1).mean() > 0.5  # most rows reach the floor on the low quantiles
    assert (wind >= 0.0).all()


def test_the_corrected_median_is_not_the_raw_value_on_the_biased_fixture(
    spied: tuple[pl.DataFrame, TrainedCorrector, _Spy],
) -> None:
    """The degenerate-model guard: a corrector equal to raw IFS (all-zero error quantiles) must fail here."""
    pairs, trained, _ = spied
    cal = _calibration_rows(pairs, trained).filter(pl.col("station").is_in(BIASED) & pl.col("y_t").is_not_null())
    grids = corrected_grids(trained, cal)
    shift = grids[Target.T][:, MEDIAN] - cal["raw_t"].to_numpy()
    assert (np.abs(shift) > 1.0).mean() > 0.9, "the median barely moves: the model is raw IFS"
    assert float(shift.mean()) < -2.0  # the forecast runs +3 degrees warm, so the correction is about -3
    truth = cal["raw_t"].to_numpy() + cal["y_t"].to_numpy()
    raw_mae = float(np.abs(cal["y_t"].to_numpy()).mean())
    corrected_mae = float(np.abs(truth - grids[Target.T][:, MEDIAN]).mean())
    assert corrected_mae <= 0.5 * raw_mae, (raw_mae, corrected_mae)


def test_missing_input_rows_are_nan_never_numbers(spied: tuple[pl.DataFrame, TrainedCorrector, _Spy]) -> None:
    pairs, trained, _ = spied
    clean = _calibration_rows(pairs, trained)
    base = corrected_grids(trained, clean)
    bad_t = np.zeros(clean.height, dtype=bool)
    bad_t[::7] = True
    bad_wbgt = np.zeros(clean.height, dtype=bool)
    bad_wbgt[3::11] = True
    hit = clean.with_columns(
        pl.when(pl.Series(bad_t)).then(None).otherwise(pl.col("raw_t")).alias("raw_t"),
        pl.when(pl.Series(bad_wbgt)).then(None).otherwise(pl.col("raw_wbgt")).alias("raw_wbgt"),
    )
    grids = corrected_grids(trained, hit)
    assert np.isnan(grids[Target.T][bad_t]).all()
    assert np.isnan(grids[Target.WBGT][bad_t | bad_wbgt]).all()  # the joint needs t; the conformal step needs raw wbgt
    assert np.isnan(grids[Target.WBGT][bad_wbgt]).all()
    # a row that lacks only its temperature still has a td and a wind grid
    assert np.isfinite(grids[Target.TD][bad_t & ~bad_wbgt]).all()
    # nothing else moves: the other rows' grids are the ones of the clean frame
    keep = ~(bad_t | bad_wbgt)
    for target in Target:
        np.testing.assert_array_equal(grids[target][keep], base[target][keep], err_msg=target.value)
    assert np.isfinite(grids[Target.T][~bad_t]).all()


def test_rows_outside_the_modelled_hours_are_nan(spied: tuple[pl.DataFrame, TrainedCorrector, _Spy]) -> None:
    pairs, trained, _ = spied
    clean = _calibration_rows(pairs, trained)
    outside = np.zeros(clean.height, dtype=bool)
    outside[:5] = True
    hit = clean.with_columns(pl.when(pl.Series(outside)).then(None).otherwise(pl.col("hour_block")).alias("hour_block"))
    grids = corrected_grids(trained, hit)
    base = corrected_grids(trained, clean)
    for target in Target:
        assert np.isnan(grids[target][outside]).all(), target
    for target in JOINT:
        np.testing.assert_array_equal(grids[target][~outside], base[target][~outside])
    assert np.isfinite(grids[Target.WBGT][~outside]).any()


@pytest.mark.slow
def test_it_is_deterministic_and_samples_are_the_joint_draws(
    spied: tuple[pl.DataFrame, TrainedCorrector, _Spy],
) -> None:
    pairs, trained, _ = spied
    cal = _calibration_rows(pairs, trained)
    first = corrected_grids(trained, cal)
    second, samples = corrected_grids(trained, cal, joint_samples=True)
    third, again = corrected_grids(trained, cal, joint_samples=True)
    for target in Target:
        np.testing.assert_array_equal(first[target], second[target])  # asking for samples changes nothing
        np.testing.assert_array_equal(second[target], third[target])
    np.testing.assert_array_equal(samples, again)
    assert samples.shape == (cal.height, trained.cfg.n_joint_samples, 3)
    usable = np.isfinite(samples).all(axis=(1, 2))
    assert usable.mean() > 0.9
    assert (samples[usable, :, 1] <= samples[usable, :, 0]).all()  # td never above t
    assert (samples[usable, :, 2] >= 0.0).all()
    # the samples really are what the three marginals say: their median per row lies inside the marginal's 5-95% range
    for k, target in enumerate(JOINT):
        median = np.median(samples[usable, :, k], axis=1)
        grid = first[target][usable]
        assert ((grid[:, 0] <= median + 1e-9) & (median <= grid[:, -1] + 1e-9)).mean() > 0.99, target.value


@pytest.mark.slow
def test_the_direct_method_reads_the_wbgt_boosters() -> None:
    pairs = small_pairs(summer_days=(*range(1, 21), *range(110, 140)))
    trained = train_corrector(pairs, small_config(wbgt_method="direct"), cfg_sha256=CFG_SHA256)
    assert Target.WBGT in trained.boosters
    cal = _calibration_rows(pairs, trained)
    grids, samples = corrected_grids(trained, cal, joint_samples=True)
    lead = cal["lead_days"].cast(pl.Int8()).to_numpy()
    error = predict_grid(trained.boosters[Target.WBGT], feature_matrix(cal, FeatureSet.SITE))
    raw = cal["raw_wbgt"].to_numpy()
    expected = apply_offsets(error, lead, cal["hour_block"], trained.offsets, Target.WBGT) + raw[:, None]
    np.testing.assert_array_equal(grids[Target.WBGT], expected)
    assert np.isfinite(samples).all(axis=(1, 2)).mean() > 0.9  # direct still has joint samples (for the TWL export)
