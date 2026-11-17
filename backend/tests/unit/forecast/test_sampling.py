"""The Gaussian-copula joint sampler and the array-based WBGT of joint samples (``domain.forecast.sampling``).

The WBGT tests use the synthetic fixture (``tests/fixtures/forecast/synthetic.py``), which is built by B1's
``build_pairs``: a degenerate joint sample (every draw equal to the raw forecast) must reproduce its ``wbgt_fc_c``,
which pins the coordinate, time and screening convention of the two computations to each other.
"""

from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone

import numpy as np
import polars as pl
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from hypothesis.extra import numpy as hnp
from scipy import stats
from scipy.special import ndtr, ndtri

from stellar_blaze.application.dataset import build_pairs
from stellar_blaze.domain.forecast.grid import F64, LEVELS
from stellar_blaze.domain.forecast.sampling import (
    MIN_COPULA_ROWS,
    WbgtJointGrid,
    fit_copula,
    nearest_correlation,
    sample_joint,
    wbgt_joint_grid,
)
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import OBS_HOURLY_SCHEMA
from stellar_blaze.domain.weather.stations import STATIONS, station
from tests.fixtures.forecast.synthetic import forecasts_of, make_pairs, observations_of

pytestmark = pytest.mark.unit

_SETTINGS = settings(max_examples=60, deadline=None, database=None, derandomize=True)
# Narrow grids on purpose: a sample quantile at n = 20,000 has a standard error of sqrt(p(1-p)/n) / density, which for a
# spacing of 0.15 per 0.05 of probability is about 0.01 (the tolerance of 0.05 is then five standard errors).
_T_GRID = 35.0 + 0.15 * np.arange(-9, 10, dtype=np.float64)  # 33.65 .. 36.35
_TD_GRID = 20.0 + 0.12 * np.arange(-9, 10, dtype=np.float64)
_WIND_GRID = 3.0 + 0.1 * np.arange(-9, 10, dtype=np.float64)


def _grids(n: int) -> list[F64]:
    return [np.tile(base, (n, 1)) for base in (_T_GRID, _TD_GRID, _WIND_GRID)]


def _corr(rho_t_td: float = 0.6, rho_t_wind: float = 0.0, rho_td_wind: float = 0.0) -> F64:
    return np.array([[1.0, rho_t_td, rho_t_wind], [rho_t_td, 1.0, rho_td_wind], [rho_t_wind, rho_td_wind, 1.0]])


def _spearman(a: F64, b: F64) -> float:
    return float(stats.spearmanr(a, b).statistic)


def _correlated_pit(rho: float, n: int, seed: int) -> F64:
    """PIT values (n, 3) whose normal scores have correlation ``rho`` between columns 0 and 1."""
    rng = np.random.default_rng(seed)
    z = rng.standard_normal((n, 3))
    z[:, 1] = rho * z[:, 0] + np.sqrt(1.0 - rho**2) * z[:, 1]
    return np.asarray(ndtr(z), dtype=np.float64)


# === fit_copula =====================================================================================================


def test_fit_copula_recovers_a_known_correlation() -> None:
    corr = fit_copula(_correlated_pit(0.6, 20_000, seed=1))
    assert corr.shape == (3, 3)
    assert corr[0, 1] == pytest.approx(0.6, abs=0.03)
    assert corr[0, 2] == pytest.approx(0.0, abs=0.03)
    np.testing.assert_allclose(np.diag(corr), 1.0, atol=1e-12)
    np.testing.assert_allclose(corr, corr.T, atol=1e-12)


def test_fit_copula_is_positive_definite_so_cholesky_works() -> None:
    corr = fit_copula(_correlated_pit(0.99999, 500, seed=2))  # nearly singular
    assert np.linalg.eigvalsh(corr).min() > 0.0
    np.linalg.cholesky(corr)


def test_nearest_correlation_repairs_an_impossible_matrix_and_keeps_a_valid_one() -> None:
    impossible = np.array([[1.0, 0.9, -0.9], [0.9, 1.0, 0.9], [-0.9, 0.9, 1.0]])  # no three variables correlate so
    assert np.linalg.eigvalsh(impossible).min() < 0.0
    repaired = nearest_correlation(impossible)
    assert np.linalg.eigvalsh(repaired).min() > 0.0
    np.testing.assert_allclose(np.diag(repaired), 1.0, atol=1e-12)
    np.testing.assert_allclose(repaired, repaired.T, atol=1e-12)
    assert np.abs(repaired - impossible).max() < 0.5  # a repair, not a replacement
    valid = _corr(0.6, 0.2, -0.1)
    np.testing.assert_allclose(nearest_correlation(valid), valid, atol=1e-9)
    with pytest.raises(ValueError, match="square"):
        nearest_correlation(np.ones((2, 3)))


def test_fit_copula_drops_rows_with_a_non_finite_pit() -> None:
    clean = _correlated_pit(0.6, 5_000, seed=3)
    dirty = np.vstack([clean, np.full((50, 3), np.nan), [[np.inf, 0.5, 0.5]], [[0.5, np.nan, 0.5]]])
    np.testing.assert_allclose(fit_copula(dirty), fit_copula(clean), atol=1e-12)


def test_fit_copula_clips_a_pit_of_zero_or_one() -> None:
    pit = _correlated_pit(0.6, 1_000, seed=4)
    pit[:10, 0] = 0.0
    pit[10:20, 1] = 1.0
    corr = fit_copula(pit)
    assert np.isfinite(corr).all()
    assert corr[0, 1] == pytest.approx(0.6, abs=0.1)


def test_fit_copula_refuses_too_few_rows() -> None:
    pit = _correlated_pit(0.6, MIN_COPULA_ROWS + 10, seed=5)
    pit[MIN_COPULA_ROWS - 1 :] = np.nan  # leaves MIN_COPULA_ROWS - 1 finite rows
    with pytest.raises(ValueError, match="at least 100"):
        fit_copula(pit)
    fit_copula(_correlated_pit(0.6, MIN_COPULA_ROWS, seed=5))  # exactly the minimum is accepted


def test_fit_copula_refuses_a_constant_column_and_a_bad_shape() -> None:
    pit = _correlated_pit(0.6, 500, seed=6)
    pit[:, 2] = 0.5
    with pytest.raises(ValueError, match="no spread"):
        fit_copula(pit)
    with pytest.raises(ValueError, match="shape"):
        fit_copula(np.full((500, 2), 0.5))


# === sample_joint ===================================================================================================


def test_sample_marginals_match_grid() -> None:
    n, n_samples = 3, 20_000
    grids = _grids(n)
    samples = sample_joint(grids, _corr(), n_samples=n_samples, seed=7)
    assert samples.shape == (n, n_samples, 3)
    for variable, grid in enumerate(grids):
        empirical = np.quantile(samples[:, :, variable], LEVELS, axis=1).T
        np.testing.assert_allclose(empirical, grid, atol=0.05)


def test_sample_rank_correlation() -> None:
    rho = 0.6
    samples = sample_joint(_grids(1), _corr(rho), n_samples=20_000, seed=8)
    t, td, wind = samples[0, :, 0], samples[0, :, 1], samples[0, :, 2]
    # The correlation of the normal scores of the ranks is the copula's parameter; Spearman's rho follows from it.
    scores = ndtri((stats.rankdata(t) - 0.5) / t.size), ndtri((stats.rankdata(td) - 0.5) / td.size)
    assert np.corrcoef(*scores)[0, 1] == pytest.approx(rho, abs=0.05)
    assert _spearman(t, td) == pytest.approx(6.0 / np.pi * np.arcsin(rho / 2.0), abs=0.05)
    assert abs(_spearman(t, wind)) < 0.05  # the other pairs stay uncorrelated
    assert abs(_spearman(td, wind)) < 0.05


def test_sample_rank_correlation_is_the_one_asked_for_not_a_constant() -> None:
    low = sample_joint(_grids(1), _corr(0.1), n_samples=20_000, seed=9)
    high = sample_joint(_grids(1), _corr(0.9), n_samples=20_000, seed=9)
    assert _spearman(low[0, :, 0], low[0, :, 1]) < 0.2
    assert _spearman(high[0, :, 0], high[0, :, 1]) > 0.85


def test_a_fitted_copula_reproduces_the_pit_dependence_end_to_end() -> None:
    corr = fit_copula(_correlated_pit(0.6, 20_000, seed=10))
    samples = sample_joint(_grids(1), corr, n_samples=20_000, seed=11)
    assert _spearman(samples[0, :, 0], samples[0, :, 1]) == pytest.approx(0.58, abs=0.05)


@st.composite
def _sorted_grid(draw: st.DrawFn, low: float, high: float) -> F64:
    raw = draw(hnp.arrays(np.float64, (1, 19), elements=st.floats(low, high, allow_nan=False)))
    return np.sort(raw, axis=1)


@_SETTINGS
@given(
    t=_sorted_grid(-5.0, 50.0),
    td=_sorted_grid(-10.0, 45.0),
    wind=_sorted_grid(-1.0, 12.0),
    rho=st.floats(-0.95, 0.95),
    seed=st.integers(0, 2**32 - 1),
)
def test_td_never_exceeds_t(t: F64, td: F64, wind: F64, rho: float, seed: int) -> None:
    samples = sample_joint([t, td, wind], nearest_correlation(_corr(rho, 0.2, -0.3)), n_samples=200, seed=seed)
    assert (samples[:, :, 1] <= samples[:, :, 0]).all()
    assert (samples[:, :, 2] >= 0.0).all()
    assert np.isfinite(samples).all()


def test_td_cap_and_wind_floor_bite_when_the_grids_demand_them() -> None:
    n = 1
    t = np.tile(np.linspace(20.0, 24.0, 19), (n, 1))
    td = np.tile(np.linspace(25.0, 30.0, 19), (n, 1))  # dew point above temperature everywhere
    wind = np.tile(np.linspace(-2.0, 1.0, 19), (n, 1))  # a wind grid that reaches below 0
    samples = sample_joint([t, td, wind], _corr(0.5), n_samples=2_000, seed=12)
    np.testing.assert_array_equal(samples[:, :, 1], samples[:, :, 0])  # capped at T exactly
    assert samples[:, :, 2].min() == 0.0
    assert (samples[:, :, 2] == 0.0).mean() > 0.2  # a real share was floored, not just a lone draw


def test_sampling_deterministic_by_seed() -> None:
    first = sample_joint(_grids(4), _corr(), n_samples=50, seed=13)
    again = sample_joint(_grids(4), _corr(), n_samples=50, seed=13)
    other = sample_joint(_grids(4), _corr(), n_samples=50, seed=14)
    np.testing.assert_array_equal(first, again)
    assert not np.array_equal(first, other)


def test_nan_grid_row_gives_nan_samples_for_that_row_only() -> None:
    grids = _grids(3)
    grids[1][1, 4] = np.nan  # the td grid of row 1
    samples = sample_joint(grids, _corr(), n_samples=40, seed=15)
    assert np.isnan(samples[1]).all()  # the whole row: a joint sample with one missing margin is not a sample
    assert np.isfinite(samples[[0, 2]]).all()
    clean = sample_joint(_grids(3), _corr(), n_samples=40, seed=15)
    np.testing.assert_array_equal(samples[[0, 2]], clean[[0, 2]])  # the other rows are untouched


def test_sample_joint_validates_its_arguments() -> None:
    with pytest.raises(ValueError, match="three grids"):
        sample_joint(_grids(2)[:2], _corr(), n_samples=10, seed=0)
    with pytest.raises(ValueError, match="same number of rows"):
        sample_joint([_grids(2)[0], _grids(3)[1], _grids(2)[2]], _corr(), n_samples=10, seed=0)
    with pytest.raises(ValueError, match="n_samples"):
        sample_joint(_grids(2), _corr(), n_samples=0, seed=0)
    with pytest.raises(ValueError, match="correlation"):
        sample_joint(_grids(2), np.eye(2), n_samples=10, seed=0)
    with pytest.raises(ValueError, match="positive definite"):
        sample_joint(_grids(2), _corr(1.0), n_samples=10, seed=0)


# === wbgt_joint_grid (the array-based computation) ==================================================================


@dataclass(frozen=True)
class _Inputs:
    """The per-row arguments of ``wbgt_joint_grid``."""

    valid_time: list[datetime]
    lat: F64
    lon: F64
    sw_wm2: F64
    direct_wm2: F64
    pressure_hpa: F64

    def solve(self, samples: F64) -> WbgtJointGrid:
        return wbgt_joint_grid(
            samples,
            valid_time=self.valid_time,
            lat=self.lat,
            lon=self.lon,
            sw_wm2=self.sw_wm2,
            direct_wm2=self.direct_wm2,
            pressure_hpa=self.pressure_hpa,
        )

    def row(self, index: int) -> "_Inputs":
        one = slice(index, index + 1)
        return _Inputs(
            [self.valid_time[index]],
            self.lat[one],
            self.lon[one],
            self.sw_wm2[one],
            self.direct_wm2[one],
            self.pressure_hpa[one],
        )


def _fixture_rows() -> pl.DataFrame:
    """Modelled-hour rows of every station (several lat/lon groups), IFS and GFS, leads 1 and 2, four days."""
    pairs = make_pairs(
        seed=21,
        summers=(2024,),
        station_bias_c={},
        leads=(0, 1, 2),
        hours_utc=range(2, 16),
        summer_days=range(1, 5),
        reject_rate=0.0,
    )
    return pairs.filter(pl.col("lead_days") > 0)


def _one_cell(rows: pl.DataFrame, icao: str, hour: int, n: int) -> pl.DataFrame:
    return rows.filter((pl.col("station") == icao) & (pl.col("hour_utc") == hour)).head(n)


def _inputs(rows: pl.DataFrame) -> _Inputs:
    coords = {s.icao: (s.lat, s.lon) for s in STATIONS}
    return _Inputs(
        valid_time=rows["valid_time"].to_list(),
        lat=np.array([coords[icao][0] for icao in rows["station"]], dtype=np.float64),
        lon=np.array([coords[icao][1] for icao in rows["station"]], dtype=np.float64),
        sw_wm2=rows["fc_sw_wm2"].to_numpy().astype(np.float64),
        direct_wm2=rows["fc_direct_wm2"].to_numpy().astype(np.float64),
        pressure_hpa=rows["fc_pressure_hpa"].to_numpy().astype(np.float64),
    )


def _degenerate(rows: pl.DataFrame, n_samples: int = 3) -> F64:
    raw = rows.select("fc_t_c", "fc_td_c", "fc_wind_ms").to_numpy().astype(np.float64)
    return np.repeat(raw[:, None, :], n_samples, axis=1)


def _noisy(rows: pl.DataFrame, n_samples: int, seed: int) -> F64:
    base = _degenerate(rows, n_samples)
    samples = base + np.random.default_rng(seed).normal(0.0, [0.9, 0.7, 0.3], size=base.shape)
    samples[:, :, 1] = np.minimum(samples[:, :, 1], samples[:, :, 0])
    samples[:, :, 2] = np.maximum(samples[:, :, 2], 0.0)
    return samples


def _corrupted_rows() -> pl.DataFrame:
    """Gold rows (lead 1 and 2) of every station whose forecasts B1's ``build_pairs`` rejects in six different ways.

    Every seventh row of the forecasts gets one corruption (a sentinel pressure, temperature, dew point or wind, a
    missing or negative shortwave, a missing direct radiation), and the frame is then BUILT by ``build_pairs`` so the
    ``wbgt_fc_c`` and ``wbgt_fc_reject`` columns are what B1 really produces for these inputs, screens included.
    """
    pairs = make_pairs(
        seed=21,
        summers=(2024,),
        station_bias_c={},
        leads=(0, 1, 2),
        hours_utc=range(2, 16),
        summer_days=range(1, 5),
    )
    forecasts = pl.concat([forecasts_of(pairs, model) for model in (NwpModel.ECMWF_IFS025, NwpModel.GFS_SEAMLESS)])
    kind = (pl.int_range(pl.len()) % 42).alias("kind")  # 0-5 corrupt, 6-41 stay as they are
    corrupt = pl.col("lead_days") > 0
    forecasts = (
        forecasts.with_columns(kind)
        .with_columns(
            pl.when(corrupt & (pl.col("kind") == 0)).then(0.0).otherwise(pl.col("pressure_hpa")).alias("pressure_hpa"),
            pl.when(corrupt & (pl.col("kind") == 1)).then(99.0).otherwise(pl.col("t_c")).alias("t_c"),
            pl.when(corrupt & (pl.col("kind") == 2)).then(-80.0).otherwise(pl.col("td_c")).alias("td_c"),
            pl.when(corrupt & (pl.col("kind") == 3)).then(-1.0).otherwise(pl.col("wind_ms")).alias("wind_ms"),
            pl.when(corrupt & (pl.col("kind") == 4))
            .then(None)
            .when(corrupt & (pl.col("kind") == 5))
            .then(-5.0)
            .otherwise(pl.col("sw_wm2"))
            .alias("sw_wm2"),
        )
        .drop("kind")
    )
    built = build_pairs(
        forecasts=forecasts, obs_iem=observations_of(pairs), obs_ghcnh=pl.DataFrame(schema=OBS_HOURLY_SCHEMA)
    )
    return built.filter(pl.col("lead_days") > 0)


def test_degenerate_joint_sample_reproduces_the_forecast_wbgt_of_build_pairs() -> None:
    rows = _corrupted_rows()
    assert rows["station"].n_unique() == len(STATIONS)  # every coordinate group is exercised
    result = _inputs(rows).solve(_degenerate(rows))
    ok = (rows["wbgt_fc_reject"] == 0).to_numpy()
    assert ok.sum() > 1_000
    assert set(rows.filter(pl.col("wbgt_fc_reject") != 0)["wbgt_fc_reject"].unique()) >= {1, 2}  # nonfinite, incoherent
    assert (~ok).sum() > 50  # rows of both kinds exist, so neither assertion is vacuous
    expected = rows["wbgt_fc_c"].to_numpy()
    for column in range(len(LEVELS)):
        np.testing.assert_allclose(result.grid[ok, column], expected[ok], rtol=0.0, atol=1e-9)
    assert (result.n_finite[ok] == 3).all()
    assert np.isnan(result.grid[~ok]).all()
    assert (result.n_finite[~ok] == 0).all()


def test_the_solver_screens_of_build_pairs_apply_here_too() -> None:
    """A sentinel that B1 makes missing before the solver (pressure 0, t of 99, dew point of -80, negative wind)."""
    rows = _one_cell(_fixture_rows(), "OMAA", 9, 8)
    samples = _degenerate(rows)
    inputs = _inputs(rows)
    clean = inputs.solve(_degenerate(rows))
    assert (clean.n_finite == 3).all()  # all eight rows are fine before the sentinels go in
    pressure = inputs.pressure_hpa.copy()
    pressure[0] = 0.0
    samples[1, :, 0] = 99.0
    samples[2, :, 2] = -1.0
    samples[3, :, 1] = -80.0
    result = replace(inputs, pressure_hpa=pressure).solve(samples)
    assert (result.n_finite[:4] == 0).all()
    assert np.isnan(result.grid[:4]).all()
    np.testing.assert_array_equal(result.grid[4:], clean.grid[4:])


def test_wbgt_joint_grid_quantiles_are_the_empirical_quantiles_of_the_finite_samples() -> None:
    rows = _one_cell(_fixture_rows(), "OMAA", 9, 6)
    n_samples = 50
    samples = _noisy(rows, n_samples, seed=31)
    inputs = _inputs(rows)
    result = inputs.solve(samples)
    # Each sample on its own is the same computation as a one-sample call.
    per_sample = np.stack([inputs.solve(samples[:, [k], :]).grid[:, 0] for k in range(n_samples)], axis=1)
    assert np.isfinite(per_sample).all()
    assert per_sample.std(axis=1).min() > 0.05  # the samples differ, so the quantiles are not trivially equal
    np.testing.assert_allclose(result.grid, np.quantile(per_sample, LEVELS, axis=1).T, atol=1e-12)
    assert (np.diff(result.grid, axis=1) >= 0).all()
    assert (result.n_finite == n_samples).all()
    assert result.grid.shape == (6, 19)
    assert result.n_finite.dtype.kind == "i"


def test_wbgt_joint_handles_rejects_by_excluding_and_counting() -> None:
    rows = _one_cell(_fixture_rows(), "OMDB", 8, 4)
    n_samples = 50
    samples = _noisy(rows, n_samples, seed=32)
    inputs = _inputs(rows)
    clean = inputs.solve(samples)

    dirty = samples.copy()
    dirty[0, :10, 0] = np.nan  # row 0: 10 samples missing an input
    dirty[1, ::2, 2] = np.nan  # row 1: 25 samples
    dirty[2] = np.nan  # row 2: a missing_input row, every sample NaN
    dirty[3, 0, 1] = np.inf  # row 3: one infinite input
    result = inputs.solve(dirty)

    assert result.n_finite.tolist() == [40, 25, 0, 49]
    assert np.isnan(result.grid[2]).all()  # all-NaN row, never a number made of nothing
    for row, keep in ((0, slice(10, None)), (1, slice(1, None, 2)), (3, slice(1, None))):
        kept_only = inputs.row(row).solve(dirty[row : row + 1, keep, :])
        np.testing.assert_allclose(result.grid[row], kept_only.grid[0], atol=1e-12)
    assert np.isfinite(result.grid[[0, 1, 3]]).all()
    assert not np.array_equal(result.grid[0], clean.grid[0])  # the dropped samples really were part of the clean row


def test_a_solver_rejection_is_excluded_and_counted_like_a_missing_input() -> None:
    """Rejections by the solver itself (shortwave with the sun down), not only by non-finite input."""
    rows = _one_cell(_fixture_rows(), "OMAA", 9, 3)
    inputs = _inputs(rows)
    samples = _noisy(rows, 20, seed=33)
    # 500 W/m2 at 20 UTC (00 GST): the sun is down for the whole hour, so every sample is rejected as incoherent.
    night = replace(
        inputs,
        sw_wm2=np.full(3, 500.0),
        direct_wm2=np.full(3, 300.0),
        valid_time=[t.replace(hour=20) for t in inputs.valid_time],
    )
    result = night.solve(samples)
    assert (result.n_finite == 0).all()
    assert np.isnan(result.grid).all()
    assert (inputs.solve(samples).n_finite == 20).all()  # the same samples are fine in the daytime


def test_wbgt_joint_grid_uses_the_given_radiation_and_pressure() -> None:
    rows = _one_cell(_fixture_rows(), "OMAA", 9, 5)
    samples = _degenerate(rows, 4)
    inputs = _inputs(rows)
    base = inputs.solve(samples).grid
    changed = {
        "sw_wm2": replace(inputs, sw_wm2=inputs.sw_wm2 * 0.5),
        "direct_wm2": replace(inputs, direct_wm2=inputs.direct_wm2 * 0.5),
        "pressure_hpa": replace(inputs, pressure_hpa=inputs.pressure_hpa * 0.98),
    }
    for name, variant in changed.items():
        assert not np.allclose(variant.solve(samples).grid, base, atol=1e-6), name


def test_wbgt_joint_grid_uses_the_row_coordinates_and_the_utc_time() -> None:
    rows = _one_cell(_fixture_rows(), "OMAA", 9, 5)
    samples = _degenerate(rows, 4)
    inputs = _inputs(rows)
    base = inputs.solve(samples).grid
    where = station("OMFJ")
    moved = replace(inputs, lat=np.full(5, where.lat), lon=np.full(5, where.lon))
    assert not np.allclose(moved.solve(samples).grid, base, atol=1e-6)
    # The same instants given in another time zone are the same instants.
    gst = timezone(timedelta(hours=4))
    same = replace(inputs, valid_time=[t.astimezone(gst) for t in inputs.valid_time])
    np.testing.assert_array_equal(same.solve(samples).grid, base)
    # A naive timestamp is ambiguous and refused.
    naive = replace(inputs, valid_time=[t.replace(tzinfo=None) for t in inputs.valid_time])
    with pytest.raises(ValueError, match="UTC-aware"):
        naive.solve(samples)


def test_wbgt_joint_grid_validates_shapes() -> None:
    rows = _fixture_rows().head(5)
    inputs = _inputs(rows)
    with pytest.raises(ValueError, match="shape"):
        inputs.solve(np.zeros((5, 4)))
    with pytest.raises(ValueError, match="rows"):
        inputs.solve(_degenerate(rows.head(4)))


def test_wbgt_joint_grid_of_no_rows_is_empty() -> None:
    empty = np.empty(0, dtype=np.float64)
    result = _Inputs([], empty, empty, empty, empty, empty).solve(np.empty((0, 5, 3)))
    assert isinstance(result, WbgtJointGrid)
    assert result.grid.shape == (0, 19)
    assert result.n_finite.shape == (0,)


def test_the_fixture_timestamps_are_utc_aware() -> None:
    # Guard for the helpers above: the fixture's valid_time is UTC-aware, which the domain function requires.
    first = _fixture_rows()["valid_time"][0]
    assert first.utcoffset() == timedelta(0)
