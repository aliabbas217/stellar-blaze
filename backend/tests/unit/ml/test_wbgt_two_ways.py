"""WBGT uncertainty two ways (pre-registration section 3.1): the joint-sample grid and the direct quantile model.

The joint grid is computed from the forecast's own radiation and pressure (``fc_*``), at the station coordinates, like
B1's ``wbgt_fc_c``; the direct grid is the error-quantile grid of the WBGT booster set. Both run on the synthetic
fixture (``tests/fixtures/forecast/synthetic.py``).
"""

import numpy as np
import polars as pl
import pytest

from stellar_blaze.adapters.compute.lgbm_corrector import predict_grid
from stellar_blaze.domain.forecast.features import (
    FeatureSet,
    Target,
    build_features,
    fit_fold_stats,
    history_features,
)
from stellar_blaze.domain.forecast.grid import F64, LEVELS, MODELLED_HOURS_UTC
from stellar_blaze.domain.forecast.sampling import WbgtJointGrid
from stellar_blaze.ml.quantile_models import feature_matrix, fit_quantile_models
from stellar_blaze.ml.train import wbgt_direct_grid, wbgt_joint_grid
from stellar_blaze.ml.training_config import TrainingConfig
from tests.fixtures.forecast.synthetic import make_pairs

pytestmark = pytest.mark.unit

N_SAMPLES = 8


def _rows() -> pl.DataFrame:
    """Modelled-hour forecast rows of four stations (two coordinate groups per cluster), leads 1 and 2."""
    pairs = make_pairs(
        seed=41,
        summers=(2024,),
        station_bias_c={},
        stations=("OMAA", "OMDB", "OMFJ", "OMAL"),
        leads=(0, 1, 2),
        hours_utc=MODELLED_HOURS_UTC,
        summer_days=range(1, 4),
        reject_rate=0.0,
    )
    return pairs.filter(pl.col("lead_days") > 0)


def _samples(rows: pl.DataFrame, seed: int = 0) -> F64:
    """Joint samples around the raw forecast: Td capped at T, wind floored at 0."""
    raw = rows.select("fc_t_c", "fc_td_c", "fc_wind_ms").to_numpy().astype(np.float64)
    noise = np.random.default_rng(seed).normal(0.0, [0.8, 0.6, 0.3], size=(rows.height, N_SAMPLES, 3))
    samples = raw[:, None, :] + noise
    samples[:, :, 1] = np.minimum(samples[:, :, 1], samples[:, :, 0])
    samples[:, :, 2] = np.maximum(samples[:, :, 2], 0.0)
    return samples


def test_wbgt_joint_uses_forecast_radiation() -> None:
    rows = _rows()
    samples = _samples(rows)
    base = wbgt_joint_grid(samples, rows)
    assert isinstance(base, WbgtJointGrid)
    assert np.isfinite(base.grid).any()
    assert (base.n_finite == N_SAMPLES).sum() > 500

    # The reference columns are not read: wiping them, or moving them far away, changes nothing.
    ref = rows.with_columns(
        (pl.col("ref_sw_wm2") * 0.1 + 7.0).alias("ref_sw_wm2"),
        (pl.col("ref_direct_wm2") * 3.0).alias("ref_direct_wm2"),
        (pl.col("ref_pressure_hpa") - 50.0).alias("ref_pressure_hpa"),
    )
    assert not np.allclose(ref["ref_sw_wm2"].to_numpy(), rows["ref_sw_wm2"].to_numpy(), equal_nan=True)  # it did change
    after_ref = wbgt_joint_grid(samples, ref)
    np.testing.assert_array_equal(after_ref.grid, base.grid)
    np.testing.assert_array_equal(after_ref.n_finite, base.n_finite)
    nulled = rows.with_columns(
        pl.lit(None, dtype=pl.Float64()).alias(name) for name in ("ref_sw_wm2", "ref_direct_wm2")
    )
    np.testing.assert_array_equal(wbgt_joint_grid(samples, nulled).grid, base.grid)

    # The forecast's own columns are read: halving fc_sw_wm2 (or fc_pressure_hpa) changes the output.
    for column, factor in (("fc_sw_wm2", 0.5), ("fc_direct_wm2", 0.5), ("fc_pressure_hpa", 0.98)):
        changed = wbgt_joint_grid(samples, rows.with_columns((pl.col(column) * factor).alias(column)))
        both = np.isfinite(base.grid) & np.isfinite(changed.grid)
        assert (np.abs(changed.grid[both] - base.grid[both]) > 1e-6).mean() > 0.3, column  # most daytime rows move


def test_wbgt_joint_degenerate_samples_reproduce_wbgt_fc_c_through_the_wrapper() -> None:
    rows = _rows()
    raw = rows.select("fc_t_c", "fc_td_c", "fc_wind_ms").to_numpy().astype(np.float64)
    result = wbgt_joint_grid(np.repeat(raw[:, None, :], 3, axis=1), rows)
    ok = (rows["wbgt_fc_reject"] == 0).to_numpy()
    assert ok.sum() > 500
    expected = rows["wbgt_fc_c"].to_numpy()
    np.testing.assert_allclose(result.grid[ok][:, [0, 9, 18]], np.tile(expected[ok][:, None], (1, 3)), atol=1e-9)
    assert np.isnan(result.grid[~ok]).all()


def test_wbgt_joint_wrapper_takes_the_station_coordinates_from_the_stations_table() -> None:
    rows = _rows()
    samples = _samples(rows)
    base = wbgt_joint_grid(samples, rows)
    # Relabeling every row as another station moves the sun, so the output has to change.
    moved = rows.with_columns(pl.lit("OMFJ").alias("station"))
    other = wbgt_joint_grid(samples, moved)
    both = np.isfinite(base.grid) & np.isfinite(other.grid)
    assert (np.abs(other.grid[both] - base.grid[both]) > 1e-6).mean() > 0.3


def test_wbgt_joint_wrapper_refuses_an_unknown_station_and_a_missing_column() -> None:
    rows = _rows().head(10)
    with pytest.raises(KeyError, match="XXXX"):
        wbgt_joint_grid(_samples(rows), rows.with_columns(pl.lit("XXXX").alias("station")))
    with pytest.raises(ValueError, match="fc_sw_wm2"):
        wbgt_joint_grid(_samples(rows), rows.drop("fc_sw_wm2"))
    with pytest.raises(ValueError, match="rows"):
        wbgt_joint_grid(_samples(rows.head(9)), rows)


def test_wbgt_joint_wrapper_counts_missing_forecast_inputs_instead_of_propagating_them() -> None:
    rows = _rows().filter(pl.col("hour_utc") == 8).head(6)
    samples = _samples(rows)
    samples[2] = np.nan  # a missing_input row
    rows = rows.with_columns(
        pl.when(pl.int_range(pl.len()) == 4).then(None).otherwise(pl.col("fc_pressure_hpa")).alias("fc_pressure_hpa")
    )  # a null forecast pressure: B1's solver rejects it as non-finite, so must this
    result = wbgt_joint_grid(samples, rows)
    assert result.n_finite.tolist() == [N_SAMPLES, N_SAMPLES, 0, N_SAMPLES, 0, N_SAMPLES]
    assert np.isnan(result.grid[[2, 4]]).all()
    assert np.isfinite(result.grid[[0, 1, 3, 5]]).all()


# === the direct model ===============================================================================================


BIAS_C = 3.0
BIASED = ("OMAA", "OMDB")
UNBIASED = ("OMFJ", "OMAL")


def _config() -> TrainingConfig:
    return TrainingConfig.model_validate(
        {
            "name": "unit",
            "feature_set": FeatureSet.COLD.value,
            "levels": list(LEVELS),
            "leads": [1, 2, 3],
            "hours_utc": list(MODELLED_HOURS_UTC),
            "lgbm": {
                "num_leaves": 7,
                "min_child_samples": 20,
                "n_estimators": 40,
                "num_threads": 2,
                "seed": 20261112,
                "deterministic": True,
            },
            "calibration_window": "september",
            "wbgt_method": "direct",
        }
    )


@pytest.fixture(scope="module")
def direct_fixture() -> tuple[tuple[object, ...], F64, pl.DataFrame]:
    def summer(year: int) -> pl.DataFrame:
        return make_pairs(
            seed=42,
            summers=(year,),
            station_bias_c=dict.fromkeys(BIASED, BIAS_C),
            stations=(*BIASED, *UNBIASED),
            leads=(0, 1, 2, 3),
            hours_utc=MODELLED_HOURS_UTC,
            summer_days=range(1, 29),
            reject_rate=0.0,
        )

    # Lead 0 stays in the build (it is the reference of the WBGT truth) and leaves before the features (rule L2).
    train, held_out = summer(2024).filter(pl.col("lead_days") > 0), summer(2025).filter(pl.col("lead_days") > 0)
    stats = fit_fold_stats(train)
    train_frame = build_features(train, feature_set=FeatureSet.COLD, stats=stats, history=history_features(train))
    test_frame = build_features(
        held_out, feature_set=FeatureSet.COLD, stats=stats, history=history_features(held_out)
    ).filter(pl.col("y_wbgt").is_not_null())
    boosters = fit_quantile_models(train_frame, target=Target.WBGT, cfg=_config())
    return boosters, feature_matrix(test_frame, FeatureSet.COLD), test_frame


def test_wbgt_direct_grid_is_the_sorted_error_grid(
    direct_fixture: tuple[tuple[object, ...], F64, pl.DataFrame],
) -> None:
    boosters, x, frame = direct_fixture
    grid = wbgt_direct_grid(boosters, x)  # type: ignore[arg-type]
    assert grid.shape == (frame.height, len(LEVELS))
    assert (np.diff(grid, axis=1) >= 0).all()
    np.testing.assert_array_equal(grid, predict_grid(boosters, x))  # type: ignore[arg-type]
    # An ERROR grid (truth minus forecast), not a WBGT value: a +3 C temperature bias makes the forecast WBGT too high,
    # so the median error is clearly negative at the biased stations and near zero elsewhere. A value grid would sit
    # near 30 C everywhere.
    median = grid[:, len(LEVELS) // 2]
    biased = frame["station"].is_in(BIASED).to_numpy()
    assert median[biased].mean() < -0.5
    assert abs(median[~biased].mean()) < 0.3
    assert np.abs(grid).max() < 10.0
    # The grid has a real spread: the 0.95 error quantile is above the 0.05 one.
    assert (grid[:, -1] - grid[:, 0]).min() > 0.0
