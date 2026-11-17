"""``FakeCorrector``: the deterministic stand-in for the corrector that B3 codes against, and the port it implements."""

from statistics import NormalDist

import numpy as np
import polars as pl
import pytest
from polars.testing import assert_frame_equal

from stellar_blaze.adapters.fakes.corrector import FakeCorrector
from stellar_blaze.domain.forecast.grid import LEVELS
from stellar_blaze.domain.forecast.schemas import (
    CORRECTED_FORECAST_SCHEMA,
    QUANTILE_COLUMNS,
    VARIABLES,
    CorrectionStatus,
)
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, OBS_HOURLY_SCHEMA, SchemaMismatchError
from stellar_blaze.ports.corrector import ForecastCorrector
from tests.fixtures.forecast.synthetic import forecasts_of, make_pairs, observations_of

pytestmark = pytest.mark.unit

IFS, GFS = "ecmwf_ifs025", "gfs_seamless"
_RAW_COLUMN = {"t": "t_c", "td": "td_c", "wind": "wind_ms"}


@pytest.fixture(scope="module")
def pairs() -> pl.DataFrame:
    return make_pairs(
        seed=3,
        summers=(2024,),
        station_bias_c={},
        stations=("OMAA", "OMDB"),
        leads=(1,),
        hours_utc=range(0, 24, 2),
        summer_days=[40, 41],
        missing_obs_rate=0.0,
        reject_rate=0.0,
        gfs_missing_rate=0.0,
    )


@pytest.fixture(scope="module")
def ifs(pairs: pl.DataFrame) -> pl.DataFrame:
    return forecasts_of(pairs, IFS)


@pytest.fixture(scope="module")
def gfs(pairs: pl.DataFrame) -> pl.DataFrame:
    return forecasts_of(pairs, GFS)


@pytest.fixture(scope="module")
def history(pairs: pl.DataFrame) -> pl.DataFrame:
    return observations_of(pairs)


def test_the_fake_satisfies_the_port() -> None:
    corrector: ForecastCorrector = FakeCorrector()
    assert corrector.model_id is None
    assert corrector.needs_history_forecasts is False


def test_fake_corrector_schema(ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame) -> None:
    out = FakeCorrector(spread_c=0.5).correct(ifs=ifs, gfs=gfs, history=history)
    assert out.schema == CORRECTED_FORECAST_SCHEMA
    assert out.height == 4 * ifs.height
    assert tuple(CORRECTED_FORECAST_SCHEMA)[5:24] == QUANTILE_COLUMNS
    assert out["model_id"].null_count() == out.height


def test_one_row_per_ifs_row_and_variable_in_input_order(
    ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame
) -> None:
    shuffled = ifs.sample(fraction=1.0, shuffle=True, seed=1)
    out = FakeCorrector().correct(ifs=shuffled, gfs=gfs, history=history)
    assert out["variable"].to_list() == list(VARIABLES) * shuffled.height
    for column in ("station", "valid_time", "lead_days"):
        assert out[column].to_list() == [v for v in shuffled[column].to_list() for _ in VARIABLES]


def test_zero_spread_gives_quantiles_equal_to_raw_and_status_uncorrected(
    ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame
) -> None:
    out = FakeCorrector(spread_c=0.0).correct(ifs=ifs, gfs=gfs, history=history)
    assert set(out["status"]) == {CorrectionStatus.UNCORRECTED.value}
    for column in QUANTILE_COLUMNS:
        assert out[column].to_list() == out["raw"].to_list()
    assert out["raw"].null_count() == 0


def test_positive_spread_gives_normal_quantiles_around_raw_and_status_ok(
    ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame
) -> None:
    out = FakeCorrector(spread_c=1.5).correct(ifs=ifs, gfs=gfs, history=history)
    assert set(out["status"]) == {CorrectionStatus.OK.value}
    inverse = NormalDist().inv_cdf
    for level, column in zip(LEVELS, QUANTILE_COLUMNS, strict=True):
        expected = out["raw"].to_numpy() + 1.5 * inverse(level)
        assert out[column].to_numpy() == pytest.approx(expected, abs=1e-12)
    matrix = out.select(QUANTILE_COLUMNS).to_numpy()
    assert np.all(np.diff(matrix, axis=1) > 0.0)


def test_raw_is_the_ifs_forecast_for_t_td_and_wind(ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame) -> None:
    out = FakeCorrector().correct(ifs=ifs, gfs=gfs, history=history)
    for variable, column in _RAW_COLUMN.items():
        raw = out.filter(pl.col("variable") == variable)["raw"]
        assert raw.to_list() == ifs[column].to_list()


def test_raw_wbgt_equals_the_gold_wbgt_fc_c_of_the_same_forecast(
    pairs: pl.DataFrame, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame
) -> None:
    # The fake and the gold dataset must agree on which WBGT the raw forecast has (the forecast's own radiation and
    # pressure, the station's coordinates), or a corrector tested on the fake would be trained on another quantity.
    out = FakeCorrector().correct(ifs=ifs, gfs=gfs, history=history).filter(pl.col("variable") == "wbgt")
    gold = pairs.filter(pl.col("model") == IFS).select(
        "station", "valid_time", "lead_days", "wbgt_fc_c", "wbgt_fc_reject"
    )
    joined = out.join(gold, on=["station", "valid_time", "lead_days"], how="inner", validate="1:1")
    assert joined.height == ifs.height
    accepted = joined.filter(pl.col("wbgt_fc_reject") == 0)
    assert accepted.height > 0.5 * joined.height  # the comparison is not vacuous
    assert accepted["raw"].to_numpy() == pytest.approx(accepted["wbgt_fc_c"].to_numpy(), abs=0.0, rel=1e-12)
    rejected = joined.filter(pl.col("wbgt_fc_reject") != 0)
    assert rejected["status"].to_list() == [CorrectionStatus.MISSING_INPUT.value] * rejected.height
    assert rejected["raw"].null_count() == rejected.height


def test_the_night_has_no_wbgt_rejection_in_the_fixture_and_the_fake_follows_it(
    pairs: pl.DataFrame, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame
) -> None:
    out = FakeCorrector().correct(ifs=ifs, gfs=gfs, history=history).filter(pl.col("variable") == "wbgt")
    assert out["raw"].null_count() == (pairs.filter(pl.col("model") == IFS)["wbgt_fc_reject"] != 0).sum()


def test_a_missing_input_gives_missing_input_with_null_quantiles(
    ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame
) -> None:
    broken = ifs.with_columns(
        pl.when(pl.int_range(pl.len()) == 0).then(None).otherwise(pl.col("t_c")).alias("t_c"),
        pl.when(pl.int_range(pl.len()) == 1).then(pl.lit(float("nan"))).otherwise(pl.col("wind_ms")).alias("wind_ms"),
    )
    out = FakeCorrector(spread_c=1.0).correct(ifs=broken, gfs=gfs, history=history)
    statuses = out["status"].to_list()
    ok, missing = CorrectionStatus.OK.value, CorrectionStatus.MISSING_INPUT.value
    # row 0: temperature missing -> t and wbgt are missing, td and wind are not
    assert statuses[0:4] == [missing, ok, ok, missing]
    # row 1: NaN wind (NaN is missing too) -> wind and wbgt are missing
    assert statuses[4:8] == [ok, ok, missing, missing]
    assert set(statuses[8:]) == {ok}
    for row in (0, 3, 6, 7):
        assert out.row(row, named=True)["raw"] is None
        assert all(out.row(row, named=True)[column] is None for column in QUANTILE_COLUMNS)
    assert out.row(1, named=True)["q50"] == out.row(1, named=True)["raw"]


def test_an_unusable_pressure_or_radiation_makes_the_wbgt_missing_not_a_number(
    ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame
) -> None:
    bad = ifs.head(3).with_columns(
        pl.Series("pressure_hpa", [-5.0, 1000.0, 1000.0]),
        pl.Series("sw_wm2", [0.0, None, -1.0], dtype=pl.Float64),
    )
    out = FakeCorrector().correct(ifs=bad, gfs=gfs, history=history).filter(pl.col("variable") == "wbgt")
    assert out["status"].to_list() == [CorrectionStatus.MISSING_INPUT.value] * 3
    assert out["raw"].null_count() == 3


def test_history_ifs_is_accepted_and_ignored(
    pairs: pl.DataFrame, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame
) -> None:
    corrector = FakeCorrector(spread_c=0.7)
    without = corrector.correct(ifs=ifs, gfs=gfs, history=history)
    past = forecasts_of(pairs, IFS)
    with_history = corrector.correct(ifs=ifs, gfs=gfs, history=history, history_ifs=past)
    assert_frame_equal(without, with_history)
    assert corrector.needs_history_forecasts is False
    with pytest.raises(SchemaMismatchError):
        corrector.correct(ifs=ifs, gfs=gfs, history=history, history_ifs=past.drop("t_c"))


def test_wrong_schemas_are_rejected_not_repaired(ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame) -> None:
    corrector = FakeCorrector()
    with pytest.raises(SchemaMismatchError):
        corrector.correct(ifs=ifs.drop("sw_wm2"), gfs=gfs, history=history)
    with pytest.raises(SchemaMismatchError):
        corrector.correct(ifs=ifs, gfs=gfs.with_columns(pl.col("lead_days").cast(pl.Int64)), history=history)
    with pytest.raises(SchemaMismatchError):
        corrector.correct(ifs=ifs, gfs=gfs, history=history.drop("source"))


def test_an_empty_ifs_frame_gives_an_empty_corrected_frame(gfs: pl.DataFrame, history: pl.DataFrame) -> None:
    out = FakeCorrector(spread_c=1.0).correct(ifs=pl.DataFrame(schema=FORECAST_SCHEMA), gfs=gfs, history=history)
    assert out.height == 0
    assert out.schema == CORRECTED_FORECAST_SCHEMA
    empty = pl.DataFrame(schema=OBS_HOURLY_SCHEMA)
    assert FakeCorrector().correct(ifs=pl.DataFrame(schema=FORECAST_SCHEMA), gfs=gfs, history=empty).height == 0


@pytest.mark.parametrize("spread", [-0.1, float("nan"), float("inf")])
def test_the_spread_must_be_a_finite_non_negative_number(spread: float) -> None:
    with pytest.raises(ValueError, match="spread_c"):
        FakeCorrector(spread_c=spread)


# === sample =========================================================================================================


def test_sample_shape_is_rows_by_samples_by_three(ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame) -> None:
    corrector = FakeCorrector(spread_c=1.0)
    corrected = corrector.correct(ifs=ifs, gfs=gfs, history=history)
    out = corrector.sample(corrected, n_samples=7, seed=1)
    assert out.shape == (ifs.height, 7, 3)
    assert out.dtype == np.float64
    assert np.isfinite(out).all()


def test_sample_is_deterministic_in_the_seed(ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame) -> None:
    corrector = FakeCorrector(spread_c=1.0)
    corrected = corrector.correct(ifs=ifs, gfs=gfs, history=history)
    first = corrector.sample(corrected, n_samples=5, seed=11)
    assert np.array_equal(first, corrector.sample(corrected, n_samples=5, seed=11))
    assert not np.array_equal(first, corrector.sample(corrected, n_samples=5, seed=12))


def test_sample_rows_follow_the_first_appearance_of_each_forecast_row(
    ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame
) -> None:
    corrector = FakeCorrector(spread_c=0.0)
    shuffled = ifs.sample(fraction=1.0, shuffle=True, seed=5)
    out = corrector.sample(corrector.correct(ifs=shuffled, gfs=gfs, history=history), n_samples=3, seed=0)
    for position, column in enumerate(("t_c", "td_c", "wind_ms")):
        assert out[:, 0, position] == pytest.approx(shuffled[column].to_numpy())


def test_sample_with_zero_spread_is_the_raw_value(ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame) -> None:
    corrector = FakeCorrector(spread_c=0.0)
    out = corrector.sample(corrector.correct(ifs=ifs, gfs=gfs, history=history), n_samples=4, seed=3)
    for position, column in enumerate(("t_c", "td_c", "wind_ms")):
        expected = np.repeat(ifs[column].to_numpy()[:, None], 4, axis=1)
        assert np.array_equal(out[:, :, position], expected)


def test_sample_draws_from_the_grid_independently_per_variable(
    ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame
) -> None:
    corrector = FakeCorrector(spread_c=1.0)
    corrected = corrector.correct(ifs=ifs.head(3), gfs=gfs, history=history)
    out = corrector.sample(corrected, n_samples=20_000, seed=2)
    deviation = out - corrected.filter(pl.col("variable").is_in(["t", "td", "wind"]))["raw"].to_numpy().reshape(3, 1, 3)
    pooled = deviation.reshape(-1, 3)
    assert pooled.mean(axis=0) == pytest.approx([0.0, 0.0, 0.0], abs=0.02)
    assert pooled.std(axis=0) == pytest.approx([1.0, 1.0, 1.0], rel=0.1)
    correlation = np.corrcoef(pooled, rowvar=False)
    assert np.abs(correlation[np.triu_indices(3, k=1)]).max() < 0.03  # independent draws, not a copula
    # the empirical quantiles are the grid's
    assert np.quantile(pooled[:, 0], [0.25, 0.5, 0.75]) == pytest.approx([-0.6745, 0.0, 0.6745], abs=0.03)


def test_sample_of_a_missing_input_row_is_nan(ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame) -> None:
    corrector = FakeCorrector(spread_c=1.0)
    broken = ifs.head(3).with_columns(
        pl.when(pl.int_range(pl.len()) == 1).then(None).otherwise(pl.col("td_c")).alias("td_c")
    )
    out = corrector.sample(corrector.correct(ifs=broken, gfs=gfs, history=history), n_samples=4, seed=0)
    assert np.isnan(out[1, :, 1]).all()  # the missing dew point
    assert np.isfinite(out[1, :, 0]).all()
    assert np.isfinite(out[[0, 2]]).all()


def test_sample_validates_its_arguments(ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame) -> None:
    corrector = FakeCorrector(spread_c=1.0)
    corrected = corrector.correct(ifs=ifs.head(2), gfs=gfs, history=history)
    with pytest.raises(ValueError, match="n_samples"):
        corrector.sample(corrected, n_samples=0, seed=0)
    with pytest.raises(ValueError, match="variable"):
        corrector.sample(corrected.filter(pl.col("variable") != "wind"), n_samples=2, seed=0)
    with pytest.raises(ValueError, match="duplicate"):
        corrector.sample(pl.concat([corrected, corrected]), n_samples=2, seed=0)
    with pytest.raises(SchemaMismatchError):
        corrector.sample(corrected.drop("q50"), n_samples=2, seed=0)
    empty = corrector.sample(corrected.clear(), n_samples=3, seed=0)
    assert empty.shape == (0, 3, 3)
