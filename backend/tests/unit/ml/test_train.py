"""``train_corrector``: the splits, the fold statistics, the offsets, the copulas and the two WBGT methods (Task 10a).

Everything runs on the synthetic fixture (``tests/fixtures/forecast/``) with tiny LightGBM parameters. The expected
row counts are computed here from the calendar (month, summer day), never with the masks under test.
"""

import hashlib
import re
from datetime import date
from typing import Final

import lightgbm as lgb
import numpy as np
import polars as pl
import pytest

from stellar_blaze.adapters.compute.lgbm_corrector import dump_booster, predict_grid
from stellar_blaze.domain.config.models import MODEL_ID
from stellar_blaze.domain.forecast.features import (
    FeatureSet,
    Target,
    build_features,
    fit_fold_stats,
    history_features,
)
from stellar_blaze.domain.forecast.grid import F64, HOUR_BLOCKS, LEVELS
from stellar_blaze.domain.forecast.sampling import MIN_COPULA_ROWS
from stellar_blaze.ml import quantile_models
from stellar_blaze.ml import train as train_module
from stellar_blaze.ml.quantile_models import feature_matrix
from stellar_blaze.ml.train import (
    TrainedCorrector,
    fit_stratum_copulas,
    model_id,
    reject_thin_wbgt_rows,
    train_corrector,
    value_grid,
)
from tests.fixtures.forecast.synthetic import make_pairs
from tests.fixtures.forecast.trained import BIASED, CFG_SHA256, small_config, small_pairs, trained_small

pytestmark = pytest.mark.unit

STRATA: Final = frozenset(f"{lead}|{block.value}" for lead in range(1, 8) for block in HOUR_BLOCKS)
TARGET_NAMES: Final = {"t", "td", "wind", "wbgt"}
IFS: Final = "ecmwf_ifs025"

# The weeks window: fit on summer days 1-14, calibrate on weeks 4, 8, 12 and 16 (days 22-28, 50-56, 78-84, 106-112),
# and leave September days 113-118 and 125-130 (4-9 and 16-21 September) unused.
FIT_DAYS: Final = tuple(range(1, 15))
WEEK_DAYS: Final = (*range(22, 29), *range(50, 57), *range(78, 85), *range(106, 113))
UNUSED_DAYS: Final = (*range(113, 119), *range(125, 131))
WEEKS_SUMMER_DAYS: Final = (*FIT_DAYS, *WEEK_DAYS, *UNUSED_DAYS)


def _summer_day() -> pl.Expr:
    return (pl.col("valid_time").dt.date() - date(2024, 5, 15)).dt.total_days() + 1


def _ifs(pairs: pl.DataFrame) -> pl.DataFrame:
    return pairs.filter(pl.col("model") == IFS)


def _fingerprint(trained: TrainedCorrector) -> tuple[object, ...]:
    """Everything a model is: booster bytes, offsets, copulas, fold statistics and counts."""
    boosters = {
        t.value: [hashlib.sha256(dump_booster(b)).hexdigest() for b in bs] for t, bs in trained.boosters.items()
    }
    copulas = {key: matrix.tolist() for key, matrix in trained.copulas.items()}
    return (
        boosters,
        trained.offsets.model_dump_json(),
        copulas,
        trained.copula_fallback,
        trained.stats.pooled_climatology.rows(),
        trained.stats.station_climatology.rows(),
        trained.train_rows,
        trained.cal_rows,
        trained.wbgt_rejected_rows,
    )


def _shift_truth(
    pairs: pl.DataFrame,
    where: pl.Expr,
    delta: float = 4.0,
    columns: tuple[str, ...] = ("obs_t_c", "obs_td_c", "obs_wind_ms", "wbgt_obs_c"),
) -> pl.DataFrame:
    """The truth ``columns`` of the rows selected by ``where`` moved by ``delta`` (every model and lead)."""
    return pairs.with_columns(
        pl.when(where).then(pl.col(name) + delta).otherwise(pl.col(name)).alias(name) for name in columns
    )


@pytest.fixture(scope="module")
def weeks_run() -> tuple[pl.DataFrame, TrainedCorrector, list[pl.DataFrame]]:
    """The ``weeks_4_8_12_16`` corrector, and the frames its quantile models were fitted on."""
    pairs = small_pairs(summer_days=WEEKS_SUMMER_DAYS)
    captured: list[pl.DataFrame] = []
    real = quantile_models.fit_quantile_models

    def spy(rows: pl.DataFrame, **kwargs: object) -> tuple[lgb.Booster, ...]:
        captured.append(rows)
        return real(rows, **kwargs)  # type: ignore[arg-type]

    patch = pytest.MonkeyPatch()
    patch.setattr(train_module, "fit_quantile_models", spy)
    try:
        trained = train_corrector(pairs, small_config(window="weeks_4_8_12_16"), cfg_sha256=CFG_SHA256)
    finally:
        patch.undo()
    return pairs, trained, captured


# === the end to end run =============================================================================================


def test_train_corrector_end_to_end_synthetic() -> None:
    pairs, trained = trained_small()
    assert trained.cfg == small_config()
    assert trained.cfg_sha256 == CFG_SHA256
    # WBGT boosters exist only for the direct method
    assert set(trained.boosters) == {Target.T, Target.TD, Target.WIND}
    for boosters in trained.boosters.values():
        assert len(boosters) == len(LEVELS)
        assert all(isinstance(booster, lgb.Booster) for booster in boosters)
    # offsets exist for all 21 strata x 4 targets, 9 pairs each
    assert set(trained.offsets.offsets) == TARGET_NAMES
    for target in TARGET_NAMES:
        assert set(trained.offsets.offsets[target]) == STRATA, target
        assert set(trained.offsets.n[target]) == STRATA, target
        assert all(len(values) == 9 for values in trained.offsets.offsets[target].values())
        assert all(n >= 30 for n in trained.offsets.n[target].values() if n), target
    # one 3x3 copula per stratum, a valid correlation matrix
    assert set(trained.copulas) == STRATA
    for matrix in trained.copulas.values():
        assert matrix.shape == (3, 3)
        np.testing.assert_allclose(matrix, matrix.T, atol=1e-12)
        np.testing.assert_allclose(np.diag(matrix), 1.0, atol=1e-12)
        assert np.linalg.eigvalsh(matrix).min() > 0.0
    # the early and late strata hold about 90 calibration rows (below MIN_COPULA_ROWS), the peak ones about 180
    assert trained.copula_fallback == tuple(f"{lead}|{block}" for lead in range(1, 8) for block in ("early", "late"))
    # counts, from the calendar: fit rows are May-August rows, calibration rows are September rows
    month = pl.col("valid_time").dt.month()
    assert trained.train_rows == _ifs(pairs).filter(month <= 8).height
    assert trained.cal_rows == _ifs(pairs).filter(month == 9).height
    assert trained.stations == ("OMAA", "OMDB", "OMFJ")
    assert trained.summers == (2024,)
    assert trained.wbgt_rejected_rows >= 0


def test_trained_corrector_is_frozen() -> None:
    _, trained = trained_small()
    with pytest.raises(AttributeError):
        trained.train_rows = 0  # type: ignore[misc]


def test_a_biased_station_is_corrected_out_of_sample_in_time() -> None:
    """The model is not the raw forecast: on the September rows (never fitted), the +3 degree bias is gone."""
    pairs, trained = trained_small()
    frame = build_features(
        pairs, feature_set=FeatureSet.SITE, stats=trained.stats, history=history_features(pairs)
    ).filter((pl.col("valid_date").dt.month() == 9) & pl.col("y_t").is_not_null() & pl.col("station").is_in(BIASED))
    grid = predict_grid(trained.boosters[Target.T], feature_matrix(frame, FeatureSet.SITE))
    y = frame["y_t"].to_numpy()
    raw_mae = float(np.abs(y).mean())
    corrected_mae = float(np.abs(y - grid[:, len(LEVELS) // 2]).mean())
    assert raw_mae > 2.8  # the injected bias is really there
    assert corrected_mae <= 0.5 * raw_mae, (raw_mae, corrected_mae)


# === the splits =====================================================================================================


def test_september_window_fits_on_may_to_august_rows_only(monkeypatch: pytest.MonkeyPatch) -> None:
    pairs = small_pairs()
    captured: list[pl.DataFrame] = []
    real = quantile_models.fit_quantile_models

    def spy(rows: pl.DataFrame, **kwargs: object) -> tuple[lgb.Booster, ...]:
        captured.append(rows)
        return real(rows, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(train_module, "fit_quantile_models", spy)
    trained = train_corrector(pairs, small_config(), cfg_sha256=CFG_SHA256)
    assert len(captured) == 3  # t, td, wind
    expected = _ifs(pairs).filter(pl.col("valid_time").dt.month() <= 8).height
    for fit_rows in captured:
        assert fit_rows.height == expected == trained.train_rows
        fit_dates: list[date] = fit_rows["valid_date"].to_list()
        assert min(fit_dates) == date(2024, 5, 15)
        assert max(fit_dates) <= date(2024, 8, 31)
        assert not (fit_rows["valid_date"].dt.month() == 9).any(), "a calibration row reached the fit"


def test_weeks_window_fit_and_calibration_sets_are_disjoint_and_september_is_unused(
    weeks_run: tuple[pl.DataFrame, TrainedCorrector, list[pl.DataFrame]],
) -> None:
    pairs, trained, captured = weeks_run
    ifs = _ifs(pairs)
    day = _summer_day()
    expected_fit = ifs.filter(day.is_in(FIT_DAYS)).height
    expected_cal = ifs.filter(day.is_in(WEEK_DAYS)).height
    assert trained.train_rows == expected_fit
    assert trained.cal_rows == expected_cal
    assert len(captured) == 3
    for fit_rows in captured:
        fit_days = set(
            fit_rows.select(((pl.col("valid_date") - date(2024, 5, 15)).dt.total_days() + 1).alias("d"))["d"]
        )
        assert fit_days == set(FIT_DAYS), "fit rows are the non-calibration days of 15 May-31 August"
        assert fit_days.isdisjoint(WEEK_DAYS)
        assert fit_days.isdisjoint(UNUSED_DAYS)
        assert max(fit_rows["valid_date"].to_list()) <= date(2024, 8, 31)
    assert sum(trained.offsets.n["t"].values()) <= expected_cal


# === fold statistics ================================================================================================


def test_climatology_is_fitted_on_fit_and_calibration_rows_together() -> None:
    """R23: the September rows get a climatology too, and it is the one of the two sets pooled."""
    pairs, trained = trained_small()
    both = fit_fold_stats(pairs)  # every row is a fit row or a calibration row under the september window
    assert trained.stats.pooled_climatology.equals(both.pooled_climatology)
    assert trained.stats.station_climatology.equals(both.station_climatology)
    # September day-of-year keys exist (1 September 2024 is day 245): fit-only statistics would have none
    assert max(trained.stats.pooled_climatology["doy"].to_list()) >= 245
    fit_only = fit_fold_stats(pairs.filter(pl.col("valid_time").dt.month() <= 8))
    assert not trained.stats.pooled_climatology.equals(fit_only.pooled_climatology)
    assert max(fit_only.pooled_climatology["doy"].to_list()) < 245 + 8  # only the +-7 day window reaches into September


@pytest.mark.slow
def test_fold_isolation_rows_outside_the_masks_leave_no_trace(
    weeks_run: tuple[pl.DataFrame, TrainedCorrector, list[pl.DataFrame]],
) -> None:
    """Perturbing the truth of rows that are neither fit nor calibration rows changes nothing; the controls change."""
    pairs, trained, _ = weeks_run
    base = _fingerprint(trained)
    config = small_config(window="weeks_4_8_12_16")

    outside = train_corrector(_shift_truth(pairs, _summer_day().is_in(UNUSED_DAYS)), config, cfg_sha256=CFG_SHA256)
    assert _fingerprint(outside) == base

    # controls: the same perturbation inside the fit days and inside a calibration week does change the model
    in_fit = train_corrector(_shift_truth(pairs, _summer_day().is_in((3, 4, 5))), config, cfg_sha256=CFG_SHA256)
    assert _fingerprint(in_fit)[0] != base[0], "the fit rows' truth must reach the boosters"
    in_cal = train_corrector(_shift_truth(pairs, _summer_day().is_in((24, 25))), config, cfg_sha256=CFG_SHA256)
    assert _fingerprint(in_cal)[1] != base[1], "the calibration rows' truth must reach the offsets"


# === conformal offsets and WBGT =====================================================================================


def test_missing_stratum_in_the_calibration_rows_is_refused_before_training() -> None:
    pairs = small_pairs()
    is_hole = (
        (pl.col("model") == IFS)
        & (pl.col("lead_days") == 3)
        & (pl.col("valid_time").dt.hour() == 3)
        & (pl.col("valid_time").dt.month() == 9)
    )
    with pytest.raises(ValueError, match=r"3\|early"):
        train_corrector(pairs.filter(~is_hole), small_config(), cfg_sha256=CFG_SHA256)


def test_wbgt_offsets_are_fitted_against_the_wbgt_truth_of_the_calibration_rows() -> None:
    pairs, trained = trained_small()
    frame = build_features(pairs, feature_set=FeatureSet.SITE, stats=trained.stats, history=history_features(pairs))
    cal = frame.filter(pl.col("valid_date").dt.month() == 9)
    with_truth = cal.filter(pl.col("y_wbgt").is_finite()).height
    rows_used = sum(trained.offsets.n["wbgt"].values())
    # truth-rejected rows (NaN WBGT) are excluded, and so are the rows the solver rejected (R30)
    assert with_truth - trained.wbgt_rejected_rows <= rows_used <= with_truth
    assert rows_used < cal.height
    # conformalised: the joint interval carries offsets of its own, not the zero offsets of an unconformalised grid
    assert any(abs(value) > 1e-9 for values in trained.offsets.offsets["wbgt"].values() for value in values)


def test_wbgt_offsets_follow_the_wbgt_truth() -> None:
    """Moving the WBGT truth of the calibration rows by +4 degrees raises the WBGT offsets (R29)."""
    pairs, trained = trained_small()
    only_wbgt = _shift_truth(pairs, pl.col("valid_time").dt.month() == 9, columns=("wbgt_obs_c",))
    shifted = train_corrector(only_wbgt, small_config(), cfg_sha256=CFG_SHA256)
    before = np.mean([v for values in trained.offsets.offsets["wbgt"].values() for v in values])
    after = np.mean([v for values in shifted.offsets.offsets["wbgt"].values() for v in values])
    assert after > before + 1.0


def test_joint_rows_the_solver_rejects_are_counted_and_excluded() -> None:
    """R30: a calibration row whose forecast pressure is missing has no finite WBGT sample and counts as rejected."""
    pairs, trained = trained_small()
    selected = (
        (pl.col("model") == IFS)
        & (pl.col("valid_time").dt.month() == 9)
        & (pl.col("valid_time").dt.day() <= 5)
        & (pl.col("station") == "OMFJ")
        & (pl.col("valid_time").dt.hour() == 8)
    )
    k = pairs.filter(selected).height
    assert k > 20
    blanked = pairs.with_columns(
        pl.when(selected).then(None).otherwise(pl.col("fc_pressure_hpa")).alias("fc_pressure_hpa")
    )
    result = train_corrector(blanked, small_config(), cfg_sha256=CFG_SHA256)
    assert result.wbgt_rejected_rows == trained.wbgt_rejected_rows + k


def test_direct_method_trains_wbgt_boosters_and_needs_no_samples() -> None:
    pairs = small_pairs()
    trained = train_corrector(
        pairs, small_config(feature_set=FeatureSet.COLD, wbgt_method="direct"), cfg_sha256=CFG_SHA256
    )
    assert set(trained.boosters) == {Target.T, Target.TD, Target.WIND, Target.WBGT}
    assert len(trained.boosters[Target.WBGT]) == len(LEVELS)
    assert set(trained.offsets.offsets) == TARGET_NAMES
    for target in TARGET_NAMES:
        assert set(trained.offsets.offsets[target]) == STRATA
    assert trained.wbgt_rejected_rows == 0  # no samples, so none can be rejected
    # the copulas are still fitted (a corrector can be served either way)
    assert set(trained.copulas) == STRATA


# === inputs =========================================================================================================


def test_a_lead_outside_the_config_is_refused() -> None:
    pairs = small_pairs()
    config = small_config().model_copy(update={"leads": (1, 2, 3)})
    with pytest.raises(ValueError, match="lead"):
        train_corrector(pairs, config, cfg_sha256=CFG_SHA256)


@pytest.mark.parametrize("bad", ["", "abc", "G" * 64, "A" * 64])
def test_a_bad_config_hash_is_refused(bad: str) -> None:
    with pytest.raises(ValueError, match="sha256"):
        train_corrector(small_pairs(), small_config(), cfg_sha256=bad)


def test_no_calibration_rows_is_refused() -> None:
    pairs = small_pairs(summer_days=range(1, 20))
    with pytest.raises(ValueError, match="calibration"):
        train_corrector(pairs, small_config(), cfg_sha256=CFG_SHA256)


def test_lead_zero_is_refused() -> None:
    pairs = make_pairs(
        seed=7, summers=(2024,), station_bias_c={}, stations=("OMAA",), leads=(0, 1), summer_days=[1, 110]
    )
    with pytest.raises(ValueError, match="lead"):
        train_corrector(pairs, small_config(), cfg_sha256=CFG_SHA256)


# === the helpers ====================================================================================================


class TestModelId:
    def test_model_id_contains_git7_and_cfg6(self) -> None:
        identifier = model_id(date(2026, 11, 14), "0123456789abcdef0123456789abcdef01234567", "abcdef" + "0" * 58)
        assert identifier == "corrector-20261114-0123456-abcdef"
        assert re.fullmatch(MODEL_ID, identifier)

    def test_a_short_sha_is_accepted_if_it_has_seven_characters(self) -> None:
        assert model_id(date(2026, 1, 2), "abcdef1", "f" * 64) == "corrector-20260102-abcdef1-ffffff"

    @pytest.mark.parametrize(
        ("git_sha", "cfg"),
        [("abc", "a" * 64), ("ABCDEF1", "a" * 64), ("zzzzzzz", "a" * 64), ("abcdef1", "abc"), ("abcdef1", "g" * 64)],
    )
    def test_malformed_hashes_are_refused(self, git_sha: str, cfg: str) -> None:
        with pytest.raises(ValueError, match="sha"):
            model_id(date(2026, 11, 14), git_sha, cfg)


class TestStratumCopulas:
    @staticmethod
    def _pit(rng: np.random.Generator, n: int, rho: float) -> F64:
        """PIT values of three variables with a Gaussian dependence (t and td correlated by ``rho``)."""
        from scipy.special import ndtr

        z = rng.standard_normal((n, 3))
        z[:, 1] = rho * z[:, 0] + np.sqrt(1.0 - rho**2) * z[:, 1]
        return np.asarray(ndtr(z), dtype=np.float64)

    def test_a_thin_stratum_takes_the_lead_pooled_correlation_and_is_recorded(self) -> None:
        rng = np.random.default_rng(0)
        rich, thin = MIN_COPULA_ROWS + 80, MIN_COPULA_ROWS - 40
        pit = np.concatenate([self._pit(rng, rich, 0.8), self._pit(rng, rich, 0.8), self._pit(rng, thin, -0.8)])
        lead = np.ones(len(pit), dtype=np.int8)
        block = ["early"] * rich + ["peak"] * rich + ["late"] * thin
        copulas, fallback = fit_stratum_copulas(pit, lead, block, leads=(1,))
        assert fallback == ("1|late",)
        assert set(copulas) == {"1|early", "1|peak", "1|late"}
        np.testing.assert_array_equal(copulas["1|late"], _pooled(pit))  # the pooled one, not the thin stratum's own
        assert copulas["1|early"][0, 1] > 0.6
        assert copulas["1|late"][0, 1] > 0.3  # pooled with two strata of +0.8 dominates the 60 rows of -0.8
        assert not np.array_equal(copulas["1|early"], copulas["1|late"])

    def test_a_stratum_with_enough_rows_keeps_its_own(self) -> None:
        rng = np.random.default_rng(1)
        n = MIN_COPULA_ROWS
        pit = np.concatenate([self._pit(rng, n, 0.8), self._pit(rng, n, -0.8)])
        lead = np.ones(len(pit), dtype=np.int8)
        copulas, fallback = fit_stratum_copulas(pit, lead, ["early"] * n + ["peak"] * n, leads=(1,))
        assert fallback == ("1|late",), "a stratum without any row is a fallback too"
        assert copulas["1|early"][0, 1] > 0.6
        assert copulas["1|peak"][0, 1] < -0.6

    def test_rows_with_a_missing_pit_do_not_count_toward_the_threshold(self) -> None:
        rng = np.random.default_rng(2)
        n = MIN_COPULA_ROWS + 10
        pit = np.concatenate([self._pit(rng, n, 0.5), self._pit(rng, n, 0.5)])
        pit[:15, 2] = np.nan  # the first stratum keeps n - 15 = 95 usable rows
        lead = np.ones(len(pit), dtype=np.int8)
        _, fallback = fit_stratum_copulas(pit, lead, ["early"] * n + ["peak"] * n, leads=(1,))
        assert "1|early" in fallback
        assert "1|peak" not in fallback

    def test_a_lead_too_thin_to_pool_is_refused(self) -> None:
        rng = np.random.default_rng(3)
        pit = self._pit(rng, 30, 0.5)
        with pytest.raises(ValueError, match="lead 2"):
            fit_stratum_copulas(pit, np.full(30, 2, dtype=np.int8), ["early"] * 30, leads=(2,))


def _pooled(pit: F64) -> F64:
    from stellar_blaze.domain.forecast.sampling import fit_copula

    return fit_copula(pit)


class TestRejectThinWbgtRows:
    @pytest.mark.parametrize(
        ("n_samples", "n_finite", "rejected"),
        [(10, 10, False), (10, 5, False), (10, 4, True), (10, 0, True), (5, 3, False), (5, 2, True), (1, 1, False)],
    )
    def test_fewer_than_half_the_samples_rejects_the_row(self, n_samples: int, n_finite: int, rejected: bool) -> None:
        grid = np.arange(19, dtype=np.float64)[None, :] + 20.0
        out, count = reject_thin_wbgt_rows(grid, np.array([n_finite], dtype=np.int64), n_samples)
        assert count == int(rejected)
        assert bool(np.isnan(out).all()) == rejected
        if not rejected:
            np.testing.assert_array_equal(out, grid)

    def test_the_input_is_not_modified(self) -> None:
        grid = np.full((2, 19), 30.0)
        reject_thin_wbgt_rows(grid, np.array([0, 10], dtype=np.int64), 10)
        assert np.isfinite(grid).all()


class TestValueGrid:
    def test_adds_the_raw_forecast_and_clips_wind_at_zero(self) -> None:
        error = np.tile(np.linspace(-3.0, 3.0, 19), (2, 1))
        raw = np.array([1.0, np.nan])
        wind = value_grid(error, raw, Target.WIND)
        assert wind[0].min() == 0.0
        assert (np.diff(wind[0]) >= 0).all()
        assert np.isnan(wind[1]).all(), "a row without a raw forecast has no value grid"
        np.testing.assert_allclose(value_grid(error, raw, Target.T)[0], 1.0 + error[0])

    def test_unclipped_for_the_other_targets(self) -> None:
        error = np.tile(np.linspace(-3.0, 3.0, 19), (1, 1))
        assert value_grid(error, np.array([0.0]), Target.TD).min() == pytest.approx(-3.0)
