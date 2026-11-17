"""The pre-registered baselines B0, B0d, B2/B2d, B3/B3d and B4 (pre-registration section 5), on synthetic pairs."""

import warnings
from datetime import date
from typing import Final

import numpy as np
import polars as pl
import pytest

from stellar_blaze.domain.forecast.features import (
    FeatureSet,
    Target,
    build_features,
    feature_columns,
    fit_fold_stats,
    history_features,
)
from stellar_blaze.domain.forecast.grid import F64, LEVELS, MODELLED_HOURS_UTC
from stellar_blaze.ml import baselines as baselines_module
from stellar_blaze.ml._sklearn import Ridge
from stellar_blaze.ml.baselines import (
    RIDGE_ALPHA,
    Baseline,
    BaselineModel,
    UnsupportedBaselineError,
    fallback_count,
    fit_baselines,
    predict_baseline,
)
from tests.fixtures.forecast.synthetic import make_pairs

pytestmark = pytest.mark.unit

STATIONS: Final = ("OMAA", "OMDB", "OMFJ")
SPLIT: Final = date(2025, 5, 28)  # days 1-14 of the generator train, days 15-28 test
DRESSED: Final = (Baseline.B0D, Baseline.B2D, Baseline.B3D, Baseline.B4)
LEADS: Final = (1, 2, 3)


def feature_frame(station_bias_c: dict[str, float], *, feature_set: FeatureSet = FeatureSet.SITE) -> pl.DataFrame:
    """The ``build_features`` output of 28 synthetic days, three stations, leads 1-3 (lead 0 stays out, L2)."""
    pairs = make_pairs(
        seed=11,
        summers=(2025,),
        station_bias_c=station_bias_c,
        stations=STATIONS,
        leads=(0, *LEADS),
        hours_utc=MODELLED_HOURS_UTC,
        summer_days=range(1, 29),
    )
    return build_features(
        pairs.filter(pl.col("lead_days") >= 1),
        feature_set=feature_set,
        stats=fit_fold_stats(pairs),
        history=history_features(pairs),
    )


@pytest.fixture(scope="module")
def frame() -> pl.DataFrame:
    """OMAA +1.5 C and OMFJ +3.0 C (forecast minus truth), OMDB unbiased."""
    return feature_frame({"OMAA": 1.5, "OMFJ": 3.0})


@pytest.fixture(scope="module")
def train(frame: pl.DataFrame) -> pl.DataFrame:
    return frame.filter(pl.col("valid_date") <= SPLIT)


@pytest.fixture(scope="module")
def test(frame: pl.DataFrame) -> pl.DataFrame:
    return frame.filter(pl.col("valid_date") > SPLIT)


@pytest.fixture(scope="module")
def model(train: pl.DataFrame) -> BaselineModel:
    return fit_baselines(train, target=Target.T, pooled=False)


def truth_of(rows: pl.DataFrame, target: Target = Target.T) -> F64:
    """Truth = raw + (truth - raw), NaN where the target is null."""
    name = target.value
    return (rows[f"raw_{name}"] + rows[f"y_{name}"]).fill_null(float("nan")).to_numpy()


def mean_error(corrected: F64, rows: pl.DataFrame, target: Target = Target.T) -> float:
    """Mean of corrected minus truth over the rows that have a truth."""
    error = corrected - truth_of(rows, target)
    return float(np.nanmean(error))


def mean_target(rows: pl.DataFrame) -> float:
    """The mean of ``y_t`` over the rows that have one."""
    return float(rows["y_t"].drop_nulls().to_numpy().mean())


def station_rows(rows: pl.DataFrame, station: str) -> pl.DataFrame:
    return rows.filter(pl.col("station") == station)


# === B0, B2 =========================================================================================================


def test_b0_is_raw_and_deterministic(test: pl.DataFrame, model: BaselineModel) -> None:
    out = predict_baseline(model, test, Baseline.B0)
    assert out.shape == (test.height,)
    assert np.array_equal(out, test["raw_t"].to_numpy())


def test_static_bias_recovers_injected_bias(test: pl.DataFrame, model: BaselineModel) -> None:
    omfj = station_rows(test, "OMFJ")
    raw_error = mean_error(omfj["raw_t"].to_numpy(), omfj)
    assert raw_error == pytest.approx(3.0, abs=0.2)  # the bias is really in the held-out rows
    b2 = predict_baseline(model, omfj, Baseline.B2)
    assert b2.shape == (omfj.height,)
    assert abs(mean_error(b2, omfj)) < 0.15
    median = predict_baseline(model, omfj, Baseline.B2D)[:, len(LEVELS) // 2]
    assert abs(mean_error(median, omfj)) < 0.15


def test_static_bias_is_the_training_mean_per_station_lead_hour_block(
    train: pl.DataFrame, model: BaselineModel
) -> None:
    rows = train.filter((pl.col("station") == "OMAA") & (pl.col("lead_days") == 2) & (pl.col("hour_block") == "peak"))
    expected = mean_target(rows)
    correction = predict_baseline(model, rows, Baseline.B2) - rows["raw_t"].to_numpy()
    assert np.allclose(correction, expected)


def test_pooled_bias_ignores_station(train: pl.DataFrame, test: pl.DataFrame) -> None:
    pooled = fit_baselines(train, target=Target.T, pooled=True)
    per_station = fit_baselines(train, target=Target.T, pooled=False)
    block = (pl.col("lead_days") == 1) & (pl.col("hour_block") == "peak")
    everyone = mean_target(train.filter(block))  # the mean over all the training stations
    omfj = station_rows(test, "OMFJ").filter(block)
    omaa = station_rows(test, "OMAA").filter(block)
    for rows in (omfj, omaa):
        correction = predict_baseline(pooled, rows, Baseline.B2) - rows["raw_t"].to_numpy()
        assert np.allclose(correction, everyone)
    # the same rows without their station column predict the same: the station is never read
    anonymous = omfj.drop("station")
    assert np.array_equal(predict_baseline(pooled, anonymous, Baseline.B2), predict_baseline(pooled, omfj, Baseline.B2))
    # and the per-station correction really differs (OMFJ runs 3.0 warm, the pool 1.5)
    own = predict_baseline(per_station, omfj, Baseline.B2) - omfj["raw_t"].to_numpy()
    assert float(own.mean()) < everyone - 1.0


def test_held_out_station_needs_the_pooled_bias(train: pl.DataFrame, test: pl.DataFrame) -> None:
    seen = train.filter(pl.col("station") != "OMFJ")
    held_out = station_rows(test, "OMFJ")
    pooled = fit_baselines(seen, target=Target.T, pooled=True)
    out = predict_baseline(pooled, held_out, Baseline.B2)
    assert np.isfinite(out).all()
    grid = predict_baseline(pooled, held_out, Baseline.B2D)
    assert np.isfinite(grid).all()
    # the correction of a held-out station's rows is the mean over the SEEN stations (OMAA +1.5, OMDB 0), not the mean
    # that includes the held-out station (OMFJ runs +3.0, which would pull the all-station mean about a degree lower)
    for lead in LEADS:
        block = (pl.col("lead_days") == lead) & (pl.col("hour_block") == "peak")
        rows = held_out.filter(block)
        correction = predict_baseline(pooled, rows, Baseline.B2) - rows["raw_t"].to_numpy()
        seen_mean = mean_target(seen.filter(block))
        all_station_mean = mean_target(train.filter(block))
        assert np.allclose(correction, seen_mean), lead
        assert not np.isclose(correction, all_station_mean, atol=0.5).any(), lead
        assert abs(seen_mean - all_station_mean) > 0.5  # the two candidates really differ, so the test can tell
    per_station = fit_baselines(seen, target=Target.T, pooled=False)
    for baseline in (Baseline.B2, Baseline.B2D):
        with pytest.raises(KeyError, match="OMFJ"):
            predict_baseline(per_station, held_out, baseline)


def test_a_missing_stratum_raises_and_names_it(model: BaselineModel, test: pl.DataFrame) -> None:
    unseen_lead = test.head(5).with_columns(pl.lit(5, dtype=pl.Int8()).alias("lead_days"))
    for baseline in (Baseline.B2, Baseline.B0D):
        with pytest.raises(KeyError, match="lead_days=5"):
            predict_baseline(model, unseen_lead, baseline)


# === dressed forms ==================================================================================================


@pytest.mark.parametrize("baseline", DRESSED)
@pytest.mark.parametrize("target", [Target.T, Target.TD, Target.WIND])
def test_dressed_grid_sorted_and_19(frame: pl.DataFrame, baseline: Baseline, target: Target) -> None:
    fitted = fit_baselines(frame, target=target, pooled=False)
    grid = predict_baseline(fitted, frame, baseline)
    assert grid.shape == (frame.height, len(LEVELS))
    assert not np.isnan(grid).any()
    assert (np.diff(grid, axis=1) >= 0.0).all()


@pytest.mark.parametrize("baseline", [b for b in DRESSED if b is not Baseline.B3D])
def test_wbgt_dressed_grid_is_nan_only_where_the_forecast_is_missing(frame: pl.DataFrame, baseline: Baseline) -> None:
    fitted = fit_baselines(frame, target=Target.WBGT, pooled=False)
    # a rejected WBGT forecast is null in both its raw and its feature column (build_features), as in serving
    rejected = pl.int_range(pl.len()) % 17 == 0
    rows = frame.with_columns(
        *[pl.when(rejected).then(None).otherwise(pl.col(name)).alias(name) for name in ("raw_wbgt", "wbgt_fc_c")]
    )
    missing = rows["raw_wbgt"].is_null().to_numpy()
    grid = predict_baseline(fitted, rows, baseline)
    assert grid.shape == (frame.height, len(LEVELS))
    assert missing.any()
    assert (~missing).any()
    assert np.isnan(grid[missing]).all()
    assert not np.isnan(grid[~missing]).any()
    assert (np.diff(grid[~missing], axis=1) >= 0.0).all()
    out = predict_baseline(fitted, rows, Baseline.B2)
    assert np.array_equal(np.isnan(out), missing)
    assert np.isnan(predict_baseline(fitted, rows, Baseline.B0)[missing]).all()


@pytest.mark.parametrize(
    ("lead", "block"),
    [(1, "early"), (1, "peak"), (2, "peak"), (2, "late"), (3, "early"), (3, "late")],
    ids=lambda value: str(value),
)
def test_dressing_quantiles_are_the_numpy_quantiles_of_each_baselines_own_residual(
    train: pl.DataFrame, model: BaselineModel, lead: int, block: str
) -> None:
    """Six strata (three leads, all three hour-blocks), each against ``numpy.quantile`` of that stratum's residuals."""
    stratum = (pl.col("lead_days") == lead) & (pl.col("hour_block") == block)
    rows = train.filter(stratum)
    probe = rows.filter(pl.col("bias7_t").is_not_null()).head(3)
    keys = ["station", "lead_days", "hour_block"]
    valid = rows.filter(pl.col("y_t").is_not_null())
    assert valid.height >= 30  # a stratum of its own, not the lead-pooled fallback
    static = valid.with_columns(pl.col("y_t") - pl.col("y_t").mean().over(keys))
    running = valid.filter(pl.col("bias7_t").is_not_null()).with_columns(pl.col("y_t") + pl.col("bias7_t"))
    expected = {
        Baseline.B0D: np.quantile(valid["y_t"].to_numpy(), LEVELS),
        Baseline.B2D: np.quantile(static["y_t"].to_numpy(), LEVELS),
        Baseline.B3D: np.quantile(running["y_t"].to_numpy(), LEVELS),
    }
    point = {
        Baseline.B0D: probe["raw_t"].to_numpy(),
        Baseline.B2D: predict_baseline(model, probe, Baseline.B2),
        Baseline.B3D: probe["raw_t"].to_numpy() - probe["bias7_t"].to_numpy(),
    }
    for baseline, quantiles in expected.items():
        grid = predict_baseline(model, probe, baseline)
        assert np.allclose(grid - point[baseline][:, None], quantiles[None, :], atol=1e-9), baseline
    # the three residual distributions differ, so one table can never serve all three
    assert not np.allclose(expected[Baseline.B0D], expected[Baseline.B2D], atol=0.1)


def test_a_thin_stratum_falls_back_to_the_lead_pooled_quantiles_and_is_listed(train: pl.DataFrame) -> None:
    thin = (pl.col("lead_days") == 1) & (pl.col("hour_block") == "late")
    kept = pl.concat([train.filter(~thin), train.filter(thin).head(10)])
    fitted = fit_baselines(kept, target=Target.T, pooled=False)
    assert (1, "late") in fitted.dressing_fallback["b0d"]
    assert (1, "peak") not in fitted.dressing_fallback["b0d"]
    probe = kept.filter(thin).head(2)
    lead_one = kept.filter((pl.col("lead_days") == 1) & pl.col("y_t").is_not_null())
    expected = np.quantile(lead_one["y_t"].to_numpy(), LEVELS)  # every block of lead 1, the thin one included
    grid = predict_baseline(fitted, probe, Baseline.B0D)
    assert np.allclose(grid - probe["raw_t"].to_numpy()[:, None], expected[None, :], atol=1e-9)


def test_a_lead_with_fewer_than_30_rows_raises(train: pl.DataFrame) -> None:
    short = pl.concat([train.filter(pl.col("lead_days") != 3), train.filter(pl.col("lead_days") == 3).head(12)])
    with pytest.raises(ValueError, match=r"lead_days=3.*30"):
        fit_baselines(short, target=Target.T, pooled=False)


def test_rows_with_a_null_target_are_excluded_and_counted(train: pl.DataFrame, model: BaselineModel) -> None:
    nulls = train["y_t"].null_count()
    assert nulls > 0  # the fixture drops some observations
    assert model.n_null_target == nulls
    assert model.n_fit_rows == train.height - nulls
    # the static bias is the mean of the rows that have a target: dropping the null rows changes nothing
    complete = train.filter(pl.col("y_t").is_not_null())
    again = fit_baselines(complete, target=Target.T, pooled=False)
    assert again.static_bias.equals(model.static_bias)


# === B3 =============================================================================================================


def test_b3_is_raw_minus_bias7_and_falls_back_to_b2_when_it_is_null(frame: pl.DataFrame, model: BaselineModel) -> None:
    raw = frame["raw_t"].to_numpy()
    bias7 = frame["bias7_t"].to_numpy()
    out = predict_baseline(model, frame, Baseline.B3)
    b2 = predict_baseline(model, frame, Baseline.B2)
    known = ~np.isnan(bias7)
    assert known.any()
    assert (~known).any()  # the first days of the summer have no history
    assert np.array_equal(out[known], raw[known] - bias7[known])  # exactly, not approximately
    assert np.array_equal(out[~known], b2[~known])
    assert fallback_count(model, frame, Baseline.B3) == int((~known).sum())


def test_b3_removes_a_constant_injected_bias_on_the_rows_that_have_history(
    frame: pl.DataFrame, model: BaselineModel
) -> None:
    omaa = station_rows(frame, "OMAA").filter(pl.col("bias7_t").is_not_null())
    raw_error = mean_error(omaa["raw_t"].to_numpy(), omaa)
    b3_error = mean_error(predict_baseline(model, omaa, Baseline.B3), omaa)
    assert raw_error == pytest.approx(1.5, abs=0.2)
    assert abs(b3_error) < 0.25  # the sign is right: subtracting bias7 (forecast minus truth) removes the bias


def test_b3d_falls_back_to_b2d_where_bias7_is_null(frame: pl.DataFrame, model: BaselineModel) -> None:
    bias7 = frame["bias7_t"].to_numpy()
    unknown = np.isnan(bias7)
    out = predict_baseline(model, frame, Baseline.B3D)
    b2d = predict_baseline(model, frame, Baseline.B2D)
    assert np.array_equal(out[unknown], b2d[unknown])
    assert not np.array_equal(out[~unknown], b2d[~unknown])
    assert fallback_count(model, frame, Baseline.B3D) == int(unknown.sum())


@pytest.mark.parametrize("baseline", [Baseline.B3, Baseline.B3D])
def test_b3_is_undefined_for_wbgt(train: pl.DataFrame, test: pl.DataFrame, baseline: Baseline) -> None:
    fitted = fit_baselines(train, target=Target.WBGT, pooled=False)
    with pytest.raises(UnsupportedBaselineError, match="wbgt"):
        predict_baseline(fitted, test, baseline)
    assert issubclass(UnsupportedBaselineError, ValueError)
    for supported in (Baseline.B0, Baseline.B0D, Baseline.B2, Baseline.B2D, Baseline.B4):
        assert predict_baseline(fitted, test, supported).shape[0] == test.height


def test_b3_needs_a_training_frame_with_history(test: pl.DataFrame) -> None:
    cold = feature_frame({"OMAA": 1.5}, feature_set=FeatureSet.COLD)
    fitted = fit_baselines(cold, target=Target.T, pooled=False)
    with pytest.raises(UnsupportedBaselineError, match="bias7_t"):
        predict_baseline(fitted, test, Baseline.B3)
    assert predict_baseline(fitted, cold, Baseline.B4).shape == (cold.height, len(LEVELS))


def test_b3_rows_without_the_history_column_are_rejected(model: BaselineModel, test: pl.DataFrame) -> None:
    with pytest.raises(ValueError, match="bias7_t"):
        predict_baseline(model, test.drop("bias7_t"), Baseline.B3)


# === B4 =============================================================================================================


def test_b4_standardizes_before_the_ridge() -> None:
    """The pre-registration says nothing on scaling; the feature in cm and the feature in km must be treated alike."""
    rng = np.random.default_rng(3)
    x = np.column_stack([rng.normal(0.0, 1e-3, 1000), rng.normal(0.0, 1e3, 1000)])
    y = 1000.0 * x[:, 0] + 2e-3 * x[:, 1]  # signal in both columns, each of unit standard deviation in y
    fitted = Ridge(alpha=1.0).fit(x, y)
    assert float(np.abs(fitted.predict(x) - y).max()) < 0.05  # unscaled ridge shrinks the tiny feature to nothing


def test_b4_fits_and_predicts_without_warnings_and_recovers_an_injected_bias() -> None:
    biased = feature_frame(dict.fromkeys(STATIONS, 2.0))
    # interleaved days: a ridge (unlike a bias table) extrapolates a mean shift between two time blocks of a warming
    # summer, and this test is about the injected bias, not about covariate shift
    even = pl.col("valid_date").dt.day() % 2 == 0
    fit_rows = biased.filter(even)
    held_out = biased.filter(~even)
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # a scikit-learn feature-name UserWarning would fail here
        fitted = fit_baselines(fit_rows, target=Target.T, pooled=False)
        point = predict_baseline(fitted, held_out, Baseline.B4)[:, len(LEVELS) // 2]
    assert mean_error(held_out["raw_t"].to_numpy(), held_out) == pytest.approx(2.0, abs=0.2)
    assert abs(mean_error(point, held_out)) < 0.15


def test_b4_falls_back_to_b2d_for_rows_with_a_null_cold_feature(frame: pl.DataFrame, model: BaselineModel) -> None:
    cold = list(feature_columns(FeatureSet.COLD))
    incomplete = frame.select(pl.any_horizontal(pl.col(c).is_null() for c in cold)).to_series().to_numpy()
    assert incomplete.any()  # a GFS row is absent in the fixture, so its GFS features are null
    assert (~incomplete).any()
    out = predict_baseline(model, frame, Baseline.B4)
    b2d = predict_baseline(model, frame, Baseline.B2D)
    assert np.array_equal(out[incomplete], b2d[incomplete])
    assert not np.array_equal(out[~incomplete], b2d[~incomplete])
    assert fallback_count(model, frame, Baseline.B4) == int(incomplete.sum())
    assert not np.isnan(out).any()


@pytest.mark.parametrize("baseline", [Baseline.B3, Baseline.B3D, Baseline.B4])
@pytest.mark.parametrize("chunk", [1, 7, 500])
def test_the_fallback_count_of_chunks_adds_up_to_the_count_of_the_whole(
    frame: pl.DataFrame, model: BaselineModel, baseline: Baseline, chunk: int
) -> None:
    """A pure function of the rows: scoring in chunks and in one call report the same total, and a repeat the same."""
    whole = fallback_count(model, frame, baseline)
    chunks = [frame.slice(offset, chunk) for offset in range(0, frame.height, chunk)]
    assert whole > 0  # the fixture has rows without history and rows without a GFS feature
    assert sum(fallback_count(model, part, baseline) for part in chunks) == whole
    assert fallback_count(model, frame, baseline) == whole
    assert fallback_count(model, frame.filter(pl.col("bias7_t").is_not_null()), Baseline.B3) == 0


def test_the_fallback_count_does_not_depend_on_what_was_predicted_before(
    frame: pl.DataFrame, model: BaselineModel
) -> None:
    """The model is read-only: predicting leaves no state that a later count could pick up."""
    before = fallback_count(model, frame, Baseline.B3D)
    predict_baseline(model, frame.head(10), Baseline.B3D)
    predict_baseline(model, frame.filter(pl.col("bias7_t").is_not_null()), Baseline.B3D)
    assert fallback_count(model, frame, Baseline.B3D) == before
    assert not hasattr(model, "fallback_counts")
    with pytest.raises(AttributeError):  # frozen: nothing can be stashed on it either
        model.pooled = True  # type: ignore[misc]


def test_a_baseline_without_a_fallback_counts_zero_and_wbgt_has_no_b3(train: pl.DataFrame, frame: pl.DataFrame) -> None:
    fitted = fit_baselines(train, target=Target.T, pooled=False)
    for baseline in (Baseline.B0, Baseline.B0D, Baseline.B2, Baseline.B2D):
        assert fallback_count(fitted, frame, baseline) == 0
    wbgt = fit_baselines(train, target=Target.WBGT, pooled=False)
    with pytest.raises(UnsupportedBaselineError, match="wbgt"):
        fallback_count(wbgt, frame, Baseline.B3D)
    assert fallback_count(wbgt, frame, Baseline.B4) > 0


def test_the_fallback_count_leaves_out_rows_without_a_raw_forecast(frame: pl.DataFrame, model: BaselineModel) -> None:
    """A row that predicts NaN is missing, not fallen back."""
    no_raw = frame.with_columns(pl.lit(None, dtype=pl.Float64).alias("raw_t"))
    for baseline in (Baseline.B3, Baseline.B3D, Baseline.B4):
        assert fallback_count(model, no_raw, baseline) == 0


# === determinism ====================================================================================================


@pytest.mark.parametrize("pooled", [True, False])
def test_two_identical_fits_are_bit_identical(frame: pl.DataFrame, pooled: bool) -> None:
    """A parallel ``group_by`` mean sums in a run-dependent order: the pooled bias differed in the last bit between
    identical runs (and B2d's residuals with it) until the aggregations were made ordered."""
    fits = [fit_baselines(frame, target=Target.T, pooled=pooled) for _ in range(8)]
    first = fits[0]
    for other in fits[1:]:
        assert other.static_bias.equals(first.static_bias)
        assert other.dressing.keys() == first.dressing.keys()
        for baseline, table in first.dressing.items():
            assert other.dressing[baseline].equals(table), baseline
    rows = frame.head(300)
    for baseline in (Baseline.B2, Baseline.B2D, Baseline.B3D, Baseline.B4):
        first_out = predict_baseline(first, rows, baseline)
        for other in fits[1:]:
            assert np.array_equal(predict_baseline(other, rows, baseline), first_out, equal_nan=True), baseline


# === the ridge ======================================================================================================


def test_the_pre_registered_ridge_penalty_is_what_reaches_the_ridge(
    train: pl.DataFrame, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Pre-registration section 5: ridge, alpha 1.0 (on standardized features): pinned at the constructor call."""
    penalties: list[float] = []

    class SpyRidge(Ridge):
        def __init__(self, alpha: float) -> None:
            penalties.append(alpha)
            super().__init__(alpha)

    monkeypatch.setattr(baselines_module, "Ridge", SpyRidge)

    fit_baselines(train, target=Target.T, pooled=False)

    assert RIDGE_ALPHA == 1.0
    assert penalties == [1.0]


# === inputs =========================================================================================================


def test_fit_rejects_a_frame_without_the_columns_it_needs(train: pl.DataFrame) -> None:
    with pytest.raises(ValueError, match="raw_t"):
        fit_baselines(train.drop("raw_t"), target=Target.T, pooled=False)
    with pytest.raises(ValueError, match="y_t"):
        fit_baselines(train.drop("y_t"), target=Target.T, pooled=False)
    with pytest.raises(ValueError, match="empty"):
        fit_baselines(train.clear(), target=Target.T, pooled=False)


def test_baseline_values_are_the_short_names() -> None:
    assert [b.value for b in Baseline] == ["b0", "b0d", "b2", "b2d", "b3", "b3d", "b4"]
