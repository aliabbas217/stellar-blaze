"""The 19 LightGBM quantile models, the serving predictor and booster storage (pre-registration section 3.1).

The fixture is synthetic (``tests/fixtures/forecast/synthetic.py``): four stations of which two carry an injected
temperature bias, trained on one summer and scored on another. The parameters are small so that each test is fast.
"""

import gzip
import sys
from typing import cast

import lightgbm as lgb
import numpy as np
import polars as pl
import pytest

from stellar_blaze.adapters.compute.lgbm_corrector import dump_booster, load_booster, predict_grid
from stellar_blaze.domain.forecast.features import (
    FeatureSet,
    Target,
    build_features,
    feature_columns,
    fit_fold_stats,
    history_features,
)
from stellar_blaze.domain.forecast.grid import F64, LEVELS, MODELLED_HOURS_UTC
from stellar_blaze.ml import quantile_models
from stellar_blaze.ml.quantile_models import MIN_TRAIN_ROWS, feature_matrix, fit_quantile_models, lgbm_native_params
from stellar_blaze.ml.training_config import TrainingConfig
from tests.fixtures.forecast.synthetic import make_pairs

pytestmark = pytest.mark.unit

# The bias is large on purpose. The error of the synthetic forecast has an irreducible spread of about 0.95 degrees at
# lead 1 (forecast noise 0.9, observation noise 0.3), so a perfect correction of a 1.5 degree bias leaves a mean
# absolute error of 0.76 against a raw 1.55: a ratio of 0.49, no margin under 0.5 (and 0.58 pooled over leads 1-3).
# At 3 degrees the best possible ratio is about 0.25, so "at most half" is a real test with room on both sides.
BIAS_C = 3.0
BIASED = ("OMAA", "OMDB")
UNBIASED = ("OMFJ", "OMAL")
FEATURES_OF = {FeatureSet.SITE: feature_columns(FeatureSet.SITE), FeatureSet.COLD: feature_columns(FeatureSet.COLD)}


def _cfg(feature_set: FeatureSet, *, seed: int = 20261112) -> TrainingConfig:
    return TrainingConfig.model_validate(
        {
            "name": "unit",
            "feature_set": feature_set.value,
            "levels": list(LEVELS),
            "leads": [1, 2, 3],
            "hours_utc": list(MODELLED_HOURS_UTC),
            "lgbm": {
                "num_leaves": 7,
                "min_child_samples": 20,
                "n_estimators": 40,
                "num_threads": 2,
                "seed": seed,
                "deterministic": True,
            },
            "calibration_window": "september",
            "wbgt_method": "joint",
        }
    )


def _summer(year: int) -> pl.DataFrame:
    return make_pairs(
        seed=11,
        summers=(year,),
        station_bias_c=dict.fromkeys(BIASED, BIAS_C),
        stations=(*BIASED, *UNBIASED),
        leads=(1, 2, 3),
        hours_utc=MODELLED_HOURS_UTC,
        summer_days=range(1, 29),
    )


def _features(pairs: pl.DataFrame, feature_set: FeatureSet, train_pairs: pl.DataFrame) -> pl.DataFrame:
    """The model frame of ``pairs`` with the fold statistics of ``train_pairs`` and its own (past-only) history."""
    return build_features(
        pairs, feature_set=feature_set, stats=fit_fold_stats(train_pairs), history=history_features(pairs)
    )


@pytest.fixture(scope="module")
def train_frames() -> dict[FeatureSet, pl.DataFrame]:
    train = _summer(2024)
    return {fs: _features(train, fs, train) for fs in FeatureSet}


@pytest.fixture(scope="module")
def test_frames() -> dict[FeatureSet, pl.DataFrame]:
    train, held_out = _summer(2024), _summer(2025)
    return {fs: _features(held_out, fs, train) for fs in FeatureSet}


@pytest.fixture(scope="module")
def site_models(train_frames: dict[FeatureSet, pl.DataFrame]) -> tuple[lgb.Booster, ...]:
    return fit_quantile_models(train_frames[FeatureSet.SITE], target=Target.T, cfg=_cfg(FeatureSet.SITE))


def _predict(booster: lgb.Booster, x: F64, *, num_iteration: int | None = None) -> F64:
    """A native prediction as a float64 array (``Booster.predict`` is typed as array, sparse matrix or list)."""
    return np.asarray(booster.predict(x, num_iteration=num_iteration), dtype=np.float64)


def _scored(frame: pl.DataFrame, target: str = "t") -> pl.DataFrame:
    return frame.filter(pl.col(f"y_{target}").is_not_null())


def _feed_constants(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make every feature matrix, at fit and at predict, one constant: a feature-pipeline bug that feeds nothing.

    The frame keeps its real ``lead_days`` and ``hour_utc`` (``fit_quantile_models`` checks them against the config), so
    the matrix is replaced instead, in the module under test and in this one.
    """
    real = feature_matrix

    def zeros(rows: pl.DataFrame, feature_set: FeatureSet) -> F64:
        return np.zeros_like(real(rows, feature_set))

    monkeypatch.setattr(quantile_models, "feature_matrix", zeros)
    monkeypatch.setattr(sys.modules[__name__], "feature_matrix", zeros)


def _mae_ratio(
    train: pl.DataFrame, held_out: pl.DataFrame, feature_set: FeatureSet, stations: tuple[str, ...]
) -> tuple[float, float, float]:
    """Corrected-median MAE over raw MAE on ``stations``' held-out rows, and the two MAEs."""
    boosters = fit_quantile_models(train, target=Target.T, cfg=_cfg(feature_set))
    rows = _scored(held_out).filter(pl.col("station").is_in(stations))
    median = predict_grid(boosters, feature_matrix(rows, feature_set))[:, len(LEVELS) // 2]
    error = rows["y_t"].to_numpy()  # truth minus raw forecast: its MAE is the raw MAE
    raw = float(np.abs(error).mean())
    corrected = float(np.abs(error - median).mean())  # truth - (raw + median error)
    return corrected / raw, corrected, raw


# === the degenerate-model guard (plan Review Focus 5) ===============================================================


@pytest.mark.parametrize("feature_set", list(FeatureSet), ids=lambda fs: fs.value)
def test_quantile_models_recover_bias(
    feature_set: FeatureSet,
    train_frames: dict[FeatureSet, pl.DataFrame],
    test_frames: dict[FeatureSet, pl.DataFrame],
) -> None:
    ratio, corrected, raw = _mae_ratio(train_frames[feature_set], test_frames[feature_set], feature_set, BIASED)
    assert raw > BIAS_C * 0.9, "the injected bias must be visible in the raw error, or the test says nothing"
    assert ratio <= 0.5, f"corrected MAE {corrected:.3f} is not at most half of raw {raw:.3f}"


@pytest.mark.parametrize("feature_set", list(FeatureSet), ids=lambda fs: fs.value)
def test_quantile_models_do_not_shift_unbiased_stations(
    feature_set: FeatureSet,
    train_frames: dict[FeatureSet, pl.DataFrame],
    test_frames: dict[FeatureSet, pl.DataFrame],
) -> None:
    """A model that learns one pooled shift (or any constant) halves the bias but ruins the stations without one."""
    ratio, corrected, raw = _mae_ratio(train_frames[feature_set], test_frames[feature_set], feature_set, UNBIASED)
    assert ratio <= 1.15, f"corrected MAE {corrected:.3f} against raw {raw:.3f} on stations with no bias"


@pytest.mark.parametrize("feature_set", list(FeatureSet), ids=lambda fs: fs.value)
def test_bias_guard_fails_for_a_model_without_features(
    monkeypatch: pytest.MonkeyPatch,
    feature_set: FeatureSet,
    train_frames: dict[FeatureSet, pl.DataFrame],
    test_frames: dict[FeatureSet, pl.DataFrame],
) -> None:
    """The mutation that proves the guard above is falsifiable: constant features leave the biased stations' error."""
    _feed_constants(monkeypatch)
    ratio, _, _ = _mae_ratio(train_frames[feature_set], test_frames[feature_set], feature_set, BIASED)
    assert ratio > 0.5


def test_bias_guard_fails_for_a_model_with_no_trees(
    site_models: tuple[lgb.Booster, ...], test_frames: dict[FeatureSet, pl.DataFrame]
) -> None:
    """The other mutation: a booster with its trees cut to zero predicts the constant of its first iteration."""
    rows = _scored(test_frames[FeatureSet.SITE]).filter(pl.col("station").is_in(BIASED))
    x = feature_matrix(rows, FeatureSet.SITE)
    error = rows["y_t"].to_numpy()
    median_booster = site_models[len(LEVELS) // 2]
    with_trees = np.abs(error - _predict(median_booster, x)).mean()
    without_trees = np.abs(error - _predict(median_booster, x, num_iteration=1)).mean()
    assert with_trees < 0.5 * np.abs(error).mean() < without_trees


# === fitting ========================================================================================================


@pytest.mark.parametrize("feature_set", list(FeatureSet), ids=lambda fs: fs.value)
def test_fit_gives_19_boosters_in_level_order_on_the_feature_columns(
    feature_set: FeatureSet, train_frames: dict[FeatureSet, pl.DataFrame]
) -> None:
    boosters = fit_quantile_models(train_frames[feature_set], target=Target.T, cfg=_cfg(feature_set))
    assert len(boosters) == len(LEVELS) == 19
    assert [b.params["alpha"] for b in boosters] == list(LEVELS)
    for booster in boosters:
        assert booster.feature_name() == list(feature_columns(feature_set))
        assert booster.num_trees() == 40
        assert booster.params["objective"] == "quantile"


def test_fit_uses_the_error_column_of_the_requested_target(train_frames: dict[FeatureSet, pl.DataFrame]) -> None:
    frame = train_frames[FeatureSet.COLD].with_columns((pl.col("y_t") + 100.0).alias("y_wind"))
    cfg = _cfg(FeatureSet.COLD)
    t_models = fit_quantile_models(frame, target=Target.T, cfg=cfg)
    wind_models = fit_quantile_models(frame, target=Target.WIND, cfg=cfg)
    x = feature_matrix(frame.head(200), FeatureSet.COLD)
    shift = predict_grid(wind_models, x)[:, 9] - predict_grid(t_models, x)[:, 9]
    assert np.allclose(shift, 100.0, atol=1.0)


def test_fit_excludes_rows_without_a_target(train_frames: dict[FeatureSet, pl.DataFrame]) -> None:
    frame = train_frames[FeatureSet.COLD]
    cfg = _cfg(FeatureSet.COLD)
    marked = frame.with_row_index("i").with_columns(
        pl.when(pl.col("i") % 7 == 0).then(None).otherwise(pl.col("y_t")).alias("y_t")
    )
    with_nan = marked.with_columns(
        pl.when(pl.col("i") % 11 == 0).then(float("nan")).otherwise(pl.col("y_t")).alias("y_t")
    )
    kept = with_nan.filter(~((pl.col("i") % 7 == 0) | (pl.col("i") % 11 == 0)))
    assert 0 < kept.height < with_nan.height
    expected = [b.model_to_string() for b in fit_quantile_models(kept, target=Target.T, cfg=cfg)]
    got = [b.model_to_string() for b in fit_quantile_models(with_nan, target=Target.T, cfg=cfg)]
    # the rows are dropped before training, so training on the filtered frame is the very same training
    assert got == expected


def test_fit_refuses_too_few_scored_rows(train_frames: dict[FeatureSet, pl.DataFrame]) -> None:
    frame = train_frames[FeatureSet.COLD]
    cfg = _cfg(FeatureSet.COLD)
    scored_index = frame.with_row_index("i").filter(pl.col("y_t").is_not_null())["i"].head(MIN_TRAIN_ROWS - 1)
    few = frame.with_row_index("i").with_columns(
        pl.when(pl.col("i").is_in(scored_index.implode())).then(pl.col("y_t")).alias("y_t")
    )
    assert few["y_t"].count() == MIN_TRAIN_ROWS - 1
    with pytest.raises(ValueError, match=rf"only {MIN_TRAIN_ROWS - 1} rows.*at least {MIN_TRAIN_ROWS}"):
        fit_quantile_models(few, target=Target.T, cfg=cfg)
    # the minimum is configurable: the same frame trains when the floor is lower
    assert len(fit_quantile_models(few, target=Target.T, cfg=cfg, min_rows=MIN_TRAIN_ROWS - 1)) == 19


def test_fit_excludes_infinite_targets_like_null(train_frames: dict[FeatureSet, pl.DataFrame]) -> None:
    frame = train_frames[FeatureSet.COLD]
    cfg = _cfg(FeatureSet.COLD)
    marked = frame.with_row_index("i").with_columns(
        pl.when(pl.col("i") % 5 == 0)
        .then(pl.lit(float("inf"), dtype=pl.Float64()))
        .when(pl.col("i") % 5 == 1)
        .then(pl.lit(float("-inf"), dtype=pl.Float64()))
        .otherwise(pl.col("y_t"))
        .alias("y_t")
    )
    kept = frame.with_row_index("i").filter(pl.col("i") % 5 > 1)
    expected = [b.model_to_string() for b in fit_quantile_models(kept, target=Target.T, cfg=cfg)]
    got = [b.model_to_string() for b in fit_quantile_models(marked, target=Target.T, cfg=cfg)]
    assert got == expected  # an infinite label never reaches LightGBM


def test_fit_refuses_a_lead_outside_the_config(train_frames: dict[FeatureSet, pl.DataFrame]) -> None:
    """cfg.leads is hashed into the model id: a frame with another lead must not train silently."""
    frame = train_frames[FeatureSet.COLD]
    narrow = _cfg(FeatureSet.COLD).model_copy(update={"leads": (1, 2)})
    with pytest.raises(ValueError, match=r"lead_days value\(s\).*\(1, 2\).*\[3\]"):
        fit_quantile_models(frame, target=Target.T, cfg=narrow)
    # lead 0 (never trained, L2) is caught the same way even with the full config
    with_lead_zero = frame.with_row_index("i").with_columns(
        pl.when(pl.col("i") == 0).then(0).otherwise(pl.col("lead_days")).cast(pl.Int8()).alias("lead_days")
    )
    assert with_lead_zero["y_t"][0] is not None
    with pytest.raises(ValueError, match=r"lead_days value\(s\).*\[0\]"):
        fit_quantile_models(with_lead_zero, target=Target.T, cfg=_cfg(FeatureSet.COLD))


def test_fit_refuses_an_hour_outside_the_config(train_frames: dict[FeatureSet, pl.DataFrame]) -> None:
    frame = train_frames[FeatureSet.COLD].with_row_index("i")
    stray = frame.with_columns(
        pl.when(pl.col("i") == 0).then(20).otherwise(pl.col("hour_utc")).cast(pl.Int8()).alias("hour_utc")
    )
    assert stray["y_t"][0] is not None
    with pytest.raises(ValueError, match=r"hour_utc value\(s\).*\[20\]"):
        fit_quantile_models(stray, target=Target.T, cfg=_cfg(FeatureSet.COLD))


def test_fit_ignores_the_lead_and_hour_of_rows_it_does_not_train_on(
    train_frames: dict[FeatureSet, pl.DataFrame],
) -> None:
    """An unmodelled hour or lead 0 is harmless when its target is null: the row is excluded anyway."""
    frame = train_frames[FeatureSet.COLD]
    cfg = _cfg(FeatureSet.COLD)
    extra = frame.head(5).with_columns(
        pl.lit(None, dtype=pl.Float64()).alias("y_t"),
        pl.lit(0, dtype=pl.Int8()).alias("lead_days"),
        pl.lit(20, dtype=pl.Int8()).alias("hour_utc"),
    )
    expected = [b.model_to_string() for b in fit_quantile_models(frame, target=Target.T, cfg=cfg)]
    got = [b.model_to_string() for b in fit_quantile_models(pl.concat([frame, extra]), target=Target.T, cfg=cfg)]
    assert got == expected


def test_fit_refuses_a_frame_without_the_target_or_a_feature(train_frames: dict[FeatureSet, pl.DataFrame]) -> None:
    frame = train_frames[FeatureSet.COLD]
    with pytest.raises(ValueError, match="y_td"):
        fit_quantile_models(frame.drop("y_td"), target=Target.TD, cfg=_cfg(FeatureSet.COLD))
    with pytest.raises(ValueError, match="clim_t"):
        fit_quantile_models(frame.drop("clim_t"), target=Target.T, cfg=_cfg(FeatureSet.COLD))


def test_native_params_map_the_config_names() -> None:
    cfg = _cfg(FeatureSet.SITE)
    native = lgbm_native_params(cfg.lgbm, alpha=0.35)
    assert native == {
        "objective": "quantile",
        "alpha": 0.35,
        "num_leaves": 7,
        "min_data_in_leaf": 20,
        "learning_rate": 0.05,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "lambda_l2": 1.0,
        "seed": 20261112,
        "num_threads": 2,
        "deterministic": True,
        "force_row_wise": True,
        "verbosity": -1,
    }
    assert "min_child_samples" not in native
    assert "n_estimators" not in native


def test_feature_matrix_is_float64_in_column_order_with_nan_for_null(
    train_frames: dict[FeatureSet, pl.DataFrame],
) -> None:
    frame = train_frames[FeatureSet.SITE].head(50)
    nulled = frame.with_columns(pl.lit(None, dtype=pl.Float64()).alias("gfs_t_c"))
    x = feature_matrix(nulled, FeatureSet.SITE)
    columns = feature_columns(FeatureSet.SITE)
    assert x.dtype == np.float64
    assert x.shape == (50, len(columns))
    assert x.flags["C_CONTIGUOUS"]
    assert np.isnan(x[:, columns.index("gfs_t_c")]).all()
    np.testing.assert_array_equal(x[:, columns.index("lead_days")], frame["lead_days"].cast(pl.Float64).to_numpy())
    with pytest.raises(ValueError, match="bias7_t"):
        feature_matrix(frame.drop("bias7_t"), FeatureSet.SITE)


def test_deterministic_refit(train_frames: dict[FeatureSet, pl.DataFrame]) -> None:
    frame = train_frames[FeatureSet.SITE]
    first = fit_quantile_models(frame, target=Target.T, cfg=_cfg(FeatureSet.SITE))
    second = fit_quantile_models(frame, target=Target.T, cfg=_cfg(FeatureSet.SITE))
    assert [b.model_to_string() for b in first] == [b.model_to_string() for b in second]


def test_a_different_seed_changes_the_model(train_frames: dict[FeatureSet, pl.DataFrame]) -> None:
    """Without this the refit test could pass on a model that ignores its seed (the bagging would be switched off)."""
    frame = train_frames[FeatureSet.SITE]
    base = fit_quantile_models(frame, target=Target.T, cfg=_cfg(FeatureSet.SITE))
    other = fit_quantile_models(frame, target=Target.T, cfg=_cfg(FeatureSet.SITE, seed=7))
    assert [b.model_to_string() for b in base] != [b.model_to_string() for b in other]


# === the predictor ==================================================================================================


def test_grid_sorted_and_coverage_sane(
    site_models: tuple[lgb.Booster, ...], test_frames: dict[FeatureSet, pl.DataFrame]
) -> None:
    rows = _scored(test_frames[FeatureSet.SITE])
    grid = predict_grid(site_models, feature_matrix(rows, FeatureSet.SITE))
    assert grid.shape == (rows.height, 19)
    assert np.isfinite(grid).all()
    assert (np.diff(grid, axis=1) >= 0.0).all()
    error = rows["y_t"].to_numpy()
    coverage = float(((error >= grid[:, 0]) & (error <= grid[:, -1])).mean())
    assert 0.80 <= coverage <= 0.97, f"q05-q95 covers {coverage:.3f}, nominal 0.90"
    # the median level is neither the lowest nor the highest column: the grid is ordered by level, not shuffled
    assert grid[:, 9].mean() > grid[:, 0].mean()
    assert grid[:, 9].mean() < grid[:, -1].mean()


def test_predict_grid_sorts_what_independent_boosters_cross(
    site_models: tuple[lgb.Booster, ...], test_frames: dict[FeatureSet, pl.DataFrame]
) -> None:
    x = feature_matrix(_scored(test_frames[FeatureSet.SITE]), FeatureSet.SITE)
    raw = np.column_stack([_predict(b, x) for b in site_models])
    grid = predict_grid(site_models, x)
    np.testing.assert_array_equal(grid, np.sort(raw, axis=1))
    # the LightGBM models do cross somewhere, otherwise this test would pass without any sorting
    assert (np.diff(raw, axis=1) < 0.0).any()


def test_predict_grid_does_not_mutate_its_input(
    site_models: tuple[lgb.Booster, ...], test_frames: dict[FeatureSet, pl.DataFrame]
) -> None:
    x = feature_matrix(_scored(test_frames[FeatureSet.SITE]), FeatureSet.SITE)
    before = x.copy()
    x.setflags(write=False)  # a write would raise
    grid = predict_grid(site_models, x)
    np.testing.assert_array_equal(x, before)
    assert not np.shares_memory(grid, x)


def test_predict_grid_rejects_bad_input(
    site_models: tuple[lgb.Booster, ...], test_frames: dict[FeatureSet, pl.DataFrame]
) -> None:
    x = feature_matrix(_scored(test_frames[FeatureSet.SITE]).head(5), FeatureSet.SITE)
    with pytest.raises(ValueError, match="19 boosters"):
        predict_grid(site_models[:-1], x)
    with pytest.raises(ValueError, match="2-D float64"):
        predict_grid(site_models, x.astype(np.float32))
    with pytest.raises(ValueError, match="2-D float64"):
        predict_grid(site_models, x[0])


class _Constant:
    """A booster double that predicts a fixed column (and NaN in its first row when asked)."""

    def __init__(self, value: float, *, nan_first: bool = False) -> None:
        self.value = value
        self.nan_first = nan_first

    def predict(self, x: F64) -> F64:
        out = np.full(x.shape[0], self.value)
        if self.nan_first:
            out[0] = np.nan
        return out


def test_predict_grid_keeps_a_row_whose_booster_returned_nan_an_all_nan_row() -> None:
    """Covers ``sort_grid`` through ``predict_grid`` with a booster double that fabricates a NaN prediction.

    A real booster never does this (see the next test): the double only proves that no NaN is shifted into a grid.
    """
    # decreasing values per level (crossing in every row) and a NaN prediction of one booster in row 0
    boosters = [_Constant(float(-i), nan_first=(i == 3)) for i in range(19)]
    x = np.zeros((3, 4))
    grid = predict_grid(cast("list[lgb.Booster]", boosters), x)
    assert np.isnan(grid[0]).all()  # the whole row, not one NaN shifted to the end of a sorted row
    assert not np.isnan(grid[1:]).any()
    np.testing.assert_array_equal(grid[1], np.arange(-18.0, 1.0))  # sorted ascending


@pytest.mark.parametrize("shape", ["one_column", "one_row", "whole_matrix"])
def test_real_boosters_turn_nan_features_into_finite_sorted_quantiles(
    shape: str, site_models: tuple[lgb.Booster, ...], test_frames: dict[FeatureSet, pl.DataFrame]
) -> None:
    """Documents ``predict_grid``: missing features are NOT detected, so the caller must gate such rows (Task 10b).

    If a future LightGBM returned NaN here, this test fails and the documented contract has to be revisited.
    """
    x = feature_matrix(_scored(test_frames[FeatureSet.SITE]).head(6), FeatureSet.SITE).copy()
    if shape == "one_column":
        x[:, feature_columns(FeatureSet.SITE).index("fc_t_c")] = np.nan
    elif shape == "one_row":
        x[0, :] = np.nan
    else:
        x[:, :] = np.nan
    grid = predict_grid(site_models, x)
    assert np.isfinite(grid).all()
    assert (np.diff(grid, axis=1) >= 0.0).all()


# === storage ========================================================================================================


def test_booster_roundtrip_gzip(
    site_models: tuple[lgb.Booster, ...], test_frames: dict[FeatureSet, pl.DataFrame]
) -> None:
    x = feature_matrix(_scored(test_frames[FeatureSet.SITE]), FeatureSet.SITE)
    for booster in (site_models[0], site_models[9], site_models[18]):
        loaded = load_booster(dump_booster(booster))
        np.testing.assert_allclose(_predict(loaded, x), _predict(booster, x), rtol=0.0, atol=0.0)
        assert loaded.feature_name() == booster.feature_name()
        assert loaded.num_trees() == booster.num_trees()
    reloaded = tuple(load_booster(dump_booster(b)) for b in site_models)
    np.testing.assert_array_equal(predict_grid(reloaded, x), predict_grid(site_models, x))


def test_dump_booster_is_byte_reproducible_and_not_pickle(site_models: tuple[lgb.Booster, ...]) -> None:
    booster = site_models[9]
    first, second = dump_booster(booster), dump_booster(booster)
    assert first == second
    # the gzip header: magic, deflate, no flags (so no file name), then a zero modification time
    assert first[:4] == b"\x1f\x8b\x08\x00"
    assert first[4:8] == b"\x00\x00\x00\x00"
    text = gzip.decompress(first).decode("utf-8")
    assert text == booster.model_to_string()
    assert text.startswith("tree\n")  # LightGBM text, not a pickle stream


def test_dump_booster_of_a_refit_is_byte_identical(train_frames: dict[FeatureSet, pl.DataFrame]) -> None:
    """The model files of two trainings of one config hash identically (so manifests do too)."""
    cfg = _cfg(FeatureSet.COLD)
    first = fit_quantile_models(train_frames[FeatureSet.COLD], target=Target.T, cfg=cfg)
    second = fit_quantile_models(train_frames[FeatureSet.COLD], target=Target.T, cfg=cfg)
    assert [dump_booster(b) for b in first] == [dump_booster(b) for b in second]


def test_load_booster_rejects_non_gzip_bytes() -> None:
    with pytest.raises(gzip.BadGzipFile):
        load_booster(b"tree\nversion=v4\n")
