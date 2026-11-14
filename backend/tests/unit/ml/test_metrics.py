"""The row-wise scoring facade ``ml.metrics`` (the only module that imports ``scoringrules``)."""

import ast
from pathlib import Path

import numpy as np
import polars as pl
import pytest
from scipy import stats

from stellar_blaze.domain.forecast.grid import F64, LEVELS
from stellar_blaze.ml.metrics import (
    brier,
    brier_skill,
    covered,
    crps_deterministic,
    crps_grid,
    interval_score,
    pinball,
    pit,
    pit_histogram,
    reliability_bins,
)

pytestmark = pytest.mark.unit

_LEVELS = np.asarray(LEVELS, dtype=np.float64)
_SRC = Path(__file__).resolve().parents[3] / "src" / "stellar_blaze"


def _normal_grid(n: int) -> F64:
    return np.tile(stats.norm.ppf(_LEVELS), (n, 1))


# --------------------------------------------------------------------------------------------------- crps_grid


def test_crps_grid_calibrated_normal() -> None:
    """19 levels over-estimate the mean CRPS of a calibrated N(0, 1) by +4.8% of 1/sqrt(pi) (stack doc 6.2)."""
    n = 50_000
    y = np.random.default_rng(7).standard_normal(n)
    mean_crps = float(crps_grid(y, _normal_grid(n)).mean())
    relative = mean_crps / (1.0 / np.sqrt(np.pi)) - 1.0
    assert 0.038 <= relative <= 0.058, relative


def test_crps_grid_is_twice_the_mean_pinball_loss() -> None:
    rng = np.random.default_rng(11)
    y = rng.normal(size=40)
    grid = np.sort(rng.normal(size=(40, 19)), axis=1)
    by_level = np.stack([pinball(y, grid, level) for level in LEVELS], axis=1)
    np.testing.assert_allclose(crps_grid(y, grid), 2.0 * by_level.mean(axis=1), rtol=1e-12)


def test_crps_grid_axis_convention_levels_run_along_columns() -> None:
    """A grid in row order must score differently from its transpose-like reversal: levels are the columns."""
    y = np.array([0.0])
    grid = np.arange(19, dtype=np.float64)[None, :]  # quantile at level k is k: ascending, right way round
    reversed_grid = grid[:, ::-1].copy()  # descending: crossing, the wrong way round
    assert crps_grid(y, grid)[0] != pytest.approx(crps_grid(y, reversed_grid)[0])


def test_crps_grid_tied_grid_is_finite_and_warning_free() -> None:
    grid = np.zeros((3, 19))
    out = crps_grid(np.array([0.0, 1.0, 2.0]), grid)
    np.testing.assert_allclose(out, [0.0, 1.0, 2.0])  # all mass at 0: CRPS is |y|


# ------------------------------------------------------------------------------------------ crps_deterministic


def test_crps_deterministic_is_mae() -> None:
    y = np.array([1.0, -2.0, 3.5, 0.0])
    x = np.array([0.5, 1.0, 3.5, -1.0])
    out = crps_deterministic(y, x)
    np.testing.assert_allclose(out, [0.5, 3.0, 0.0, 1.0])
    assert out.mean() == pytest.approx(float(np.mean(np.abs(y - x))))


# --------------------------------------------------------------------------------- interval_score / covered


def test_interval_score_matches_scoringrules() -> None:
    """Fixed vector, values of scoringrules' own ``interval_score`` (Gneiting and Raftery 2007 formula).

    ``scoringrules`` is deliberately not imported here (the facade is its only importer); the literals were produced
    with scoringrules 0.12.0 and checked against the closed form ``(hi - lo) + (2 / alpha) * miss``.
    """
    y = np.array([0.0, 2.0, 1.0, -1.0, 3.0])
    lo = np.full(5, 0.5)
    hi = np.full(5, 1.5)
    np.testing.assert_allclose(interval_score(y, lo, hi, 0.1), [11.0, 11.0, 1.0, 31.0, 31.0])
    np.testing.assert_allclose(interval_score(y, lo, hi, 0.2), [6.0, 6.0, 1.0, 16.0, 16.0])


def test_interval_score_takes_the_miscoverage_not_the_nominal_level() -> None:
    """0.1 is the 90% interval: passing 0.9 (the nominal level) must give a different, much smaller penalty."""
    y, lo, hi = np.array([0.0]), np.array([1.0]), np.array([2.0])
    assert interval_score(y, lo, hi, 0.1)[0] == pytest.approx(1.0 + 20.0 * 1.0)
    assert interval_score(y, lo, hi, 0.9)[0] != pytest.approx(interval_score(y, lo, hi, 0.1)[0])


@pytest.mark.parametrize("miscoverage", [0.0, 1.0, -0.1, 1.5, float("nan")])
def test_interval_score_rejects_a_miscoverage_outside_open_unit_interval(miscoverage: float) -> None:
    with pytest.raises(ValueError, match="miscoverage"):
        interval_score(np.array([0.0]), np.array([0.0]), np.array([1.0]), miscoverage)


def test_interval_score_rejects_crossed_interval() -> None:
    with pytest.raises(ValueError, match="lo"):
        interval_score(np.array([0.0]), np.array([2.0]), np.array([1.0]), 0.1)


def test_covered_is_closed_on_both_ends() -> None:
    y = np.array([0.0, 1.0, 2.0, -0.1, 2.1])
    out = covered(y, np.zeros(5), np.full(5, 2.0))
    assert out.dtype == np.bool_
    assert out.tolist() == [True, True, True, False, False]


# ----------------------------------------------------------------------------------------------------- pinball


@pytest.mark.parametrize("level", [0.05, 0.5, 0.95])
def test_pinball_matches_the_textbook_formula(level: float) -> None:
    rng = np.random.default_rng(3)
    y = rng.normal(size=25)
    grid = np.sort(rng.normal(size=(25, 19)), axis=1)
    q = grid[:, LEVELS.index(level)]
    expected = np.where(y >= q, level * (y - q), (1.0 - level) * (q - y))
    np.testing.assert_allclose(pinball(y, grid, level), expected, atol=1e-12)


def test_pinball_at_the_median_is_half_the_absolute_error() -> None:
    y = np.array([3.0, -1.0])
    grid = np.tile(np.arange(19, dtype=np.float64), (2, 1))  # the median column holds 9
    np.testing.assert_allclose(pinball(y, grid, 0.5), 0.5 * np.abs(y - 9.0))


def test_pinball_rejects_a_level_that_is_not_on_the_grid() -> None:
    with pytest.raises(ValueError, match="level"):
        pinball(np.array([0.0]), np.zeros((1, 19)), 0.07)


# --------------------------------------------------------------------------------------------- pit / histogram


def test_pit_uniform_for_calibrated() -> None:
    n = 20_000
    y = np.random.default_rng(5).standard_normal(n)
    counts = pit_histogram(pit(y, _normal_grid(n)), bins=10)
    assert counts.sum() == n
    assert stats.chisquare(counts).pvalue > 0.01


def test_pit_detects_a_biased_forecast() -> None:
    """The uniformity test must be able to fail: a forecast centered 0.5 sigma too low piles PITs near 1."""
    n = 20_000
    y = np.random.default_rng(5).standard_normal(n) + 0.5
    counts = pit_histogram(pit(y, _normal_grid(n)), bins=10)
    assert stats.chisquare(counts).pvalue < 1e-6


def test_pit_of_a_tied_grid_is_the_deterministic_mid_rank() -> None:
    """R7: wind clipped at 0 ties the lowest six quantiles (levels 0.05 to 0.30); a PIT at the tie is not randomised."""
    grid = np.concatenate([np.zeros(6), np.linspace(0.5, 6.0, 13)])[None, :]
    levels = np.asarray(LEVELS)
    expected = float(levels[:6].mean())  # 0.175
    first = pit(np.array([0.0]), grid)
    again = pit(np.array([0.0]), grid)
    assert first[0] == pytest.approx(expected)
    assert first[0] == again[0]


def test_pit_histogram_puts_exactly_one_in_the_last_bin() -> None:
    counts = pit_histogram(np.array([0.0, 0.05, 0.1, 0.55, 0.999, 1.0]), bins=10)
    assert counts.dtype == np.int64
    assert counts.tolist() == [2, 1, 0, 0, 0, 1, 0, 0, 0, 2]  # 0.999 and exactly 1.0 share the closed last bin


def test_pit_histogram_of_a_tied_grid_value_above_every_quantile_lands_in_the_last_bin() -> None:
    grid = np.zeros((3, 19))  # no spread at all
    p = pit(np.array([1.0, 0.0, 2.0]), grid)
    assert p.tolist() == [1.0, pytest.approx(0.5), 1.0]  # y above: 1.0; y at the tie: mid-rank 0.5
    counts = pit_histogram(p, bins=10)
    assert counts.tolist() == [0, 0, 0, 0, 0, 1, 0, 0, 0, 2]


def test_pit_histogram_bin_edges_use_the_lower_edge() -> None:
    """0.3 is in [0.3, 0.4), not [0.2, 0.3) (a naive p / width rounds 0.3 / 0.1 down to 2)."""
    counts = pit_histogram(np.array([0.3, 0.7, 0.6]), bins=10)
    assert counts.tolist() == [0, 0, 0, 1, 0, 0, 1, 1, 0, 0]


@pytest.mark.parametrize("bad", [-0.01, 1.01])
def test_pit_histogram_rejects_values_outside_unit_interval(bad: float) -> None:
    with pytest.raises(ValueError, match="pit"):
        pit_histogram(np.array([0.5, bad]))


def test_pit_rejects_an_unsorted_grid() -> None:
    grid = np.arange(19, dtype=np.float64)[::-1][None, :].copy()
    with pytest.raises(ValueError, match="sorted"):
        pit(np.array([1.0]), grid)


# ------------------------------------------------------------------------------------------ brier / reliability


def test_brier_is_squared_error_of_the_probability() -> None:
    p = np.array([0.0, 0.3, 1.0, 0.8])
    event = np.array([False, True, True, False])
    np.testing.assert_allclose(brier(p, event), [0.0, 0.49, 0.0, 0.64])


def test_brier_rejects_a_non_boolean_event_and_out_of_range_probability() -> None:
    with pytest.raises(ValueError, match="event"):
        brier(np.array([0.5]), np.array([1.0]))
    with pytest.raises(ValueError, match="p"):
        brier(np.array([1.2]), np.array([True]))


def test_brier_skill_is_one_minus_ratio() -> None:
    assert brier_skill(0.05, 0.10) == pytest.approx(0.5)
    assert brier_skill(0.10, 0.10) == 0.0
    assert brier_skill(0.2, 0.1) == pytest.approx(-1.0)


def test_brier_skill_zero_reference_raises() -> None:
    with pytest.raises(ValueError, match="bs_ref"):
        brier_skill(0.1, 0.0)


def test_reliability_marks_hollow_bins() -> None:
    rng = np.random.default_rng(2)
    # 200 forecasts at p near 0.2 (events at 20%), 10 near 0.65, none elsewhere.
    p = np.concatenate([np.full(200, 0.25), np.full(10, 0.65)])
    event = np.concatenate([rng.random(200) < 0.2, np.ones(10, dtype=bool)])
    table = reliability_bins(p, event)
    assert table.columns == ["bin_lo", "bin_hi", "n", "mean_p", "obs_freq", "hollow"]
    assert table.height == 10
    assert table["bin_lo"].to_list() == pytest.approx([k / 10 for k in range(10)])
    assert table["bin_hi"].to_list() == pytest.approx([(k + 1) / 10 for k in range(10)])
    assert table["n"].to_list() == [0, 0, 200, 0, 0, 0, 10, 0, 0, 0]
    assert table["hollow"].to_list() == [True, True, False, True, True, True, True, True, True, True]
    row = table.row(2, named=True)
    assert row["mean_p"] == pytest.approx(0.25)
    assert row["obs_freq"] == pytest.approx(float(event[:200].mean()))
    assert table.row(6, named=True)["obs_freq"] == 1.0  # a hollow bin still reports its numbers
    empty = table.row(0, named=True)
    assert empty["n"] == 0
    assert empty["mean_p"] is None
    assert empty["obs_freq"] is None


def test_reliability_min_count_is_the_boundary_of_hollow() -> None:
    p = np.full(50, 0.55)
    event = np.zeros(50, dtype=bool)
    assert not reliability_bins(p, event, min_count=50)["hollow"][5]
    assert reliability_bins(p, event, min_count=51)["hollow"][5]


def test_reliability_last_bin_is_closed_and_edges_are_lower_inclusive() -> None:
    p = np.array([1.0, 0.9, 0.3, 0.0])
    event = np.array([True, False, True, False])
    table = reliability_bins(p, event, min_count=1)
    assert table["n"].to_list() == [1, 0, 0, 1, 0, 0, 0, 0, 0, 2]  # 0.9 starts the last bin, 1.0 closes it
    assert table.row(9, named=True)["mean_p"] == pytest.approx(0.95)


def test_reliability_schema() -> None:
    table = reliability_bins(np.array([0.5]), np.array([True]))
    assert table.schema == pl.Schema(
        {
            "bin_lo": pl.Float64,
            "bin_hi": pl.Float64,
            "n": pl.Int64,
            "mean_p": pl.Float64,
            "obs_freq": pl.Float64,
            "hollow": pl.Boolean,
        }
    )


def test_reliability_rejects_a_width_that_does_not_tile_the_unit_interval() -> None:
    with pytest.raises(ValueError, match="width"):
        reliability_bins(np.array([0.5]), np.array([True]), width=0.3)


# ------------------------------------------------------------------------------------------------- validation


def _y() -> F64:
    return np.array([1.0, 2.0])


def _bad(value: float) -> F64:
    return np.array([1.0, value])


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
@pytest.mark.parametrize(
    ("call", "name"),
    [
        (lambda v: crps_grid(_bad(v), np.zeros((2, 19))), "y"),
        (lambda v: crps_grid(_y(), np.vstack([np.zeros(19), np.where(np.arange(19) == 4, v, 0.0)])), "grid"),
        (lambda v: crps_deterministic(_bad(v), _y()), "y"),
        (lambda v: crps_deterministic(_y(), _bad(v)), "x"),
        (lambda v: pinball(_bad(v), np.zeros((2, 19)), 0.5), "y"),
        (lambda v: interval_score(_y(), _bad(v), _y() + 1.0, 0.1), "lo"),
        (lambda v: interval_score(_y(), _y() - 1.0, _bad(v), 0.1), "hi"),
        (lambda v: covered(_bad(v), _y(), _y()), "y"),
        (lambda v: pit(_bad(v), np.zeros((2, 19))), "y"),
        (lambda v: pit_histogram(_bad(v)), "pit"),
        (lambda v: brier(_bad(v), np.array([True, False])), "p"),
        (lambda v: reliability_bins(_bad(v), np.array([True, False])), "p"),
    ],
)
def test_non_finite_raises(call: object, name: str, value: float) -> None:
    assert callable(call)
    with pytest.raises(ValueError, match=rf"\b{name}\b.*finite"):
        call(value)


@pytest.mark.parametrize("value", [float("nan"), float("inf")])
def test_non_finite_scalar_raises(value: float) -> None:
    with pytest.raises(ValueError, match="bs"):
        brier_skill(value, 0.1)
    with pytest.raises(ValueError, match="bs_ref"):
        brier_skill(0.1, value)
    with pytest.raises(ValueError, match="level"):
        pinball(_y(), np.zeros((2, 19)), value)


def test_shapes_are_validated_with_a_clear_error() -> None:
    with pytest.raises(ValueError, match=r"grid.*\(n, 19\).*\(2, 18\)"):
        crps_grid(_y(), np.zeros((2, 18)))
    with pytest.raises(ValueError, match=r"grid.*\(n, 19\)"):
        crps_grid(_y(), np.zeros(19))
    with pytest.raises(ValueError, match=r"y.*\(n,\).*\(2, 1\)"):
        crps_grid(np.zeros((2, 1)), np.zeros((2, 19)))
    with pytest.raises(ValueError, match=r"grid rows.*3.*y.*2"):
        crps_grid(_y(), np.zeros((3, 19)))
    with pytest.raises(ValueError, match=r"x.*2.*y.*3"):
        crps_deterministic(np.zeros(3), _y())
    with pytest.raises(ValueError, match=r"event.*2.*p.*3"):
        brier(np.zeros(3), np.array([True, False]))


def test_scoringrules_is_imported_only_by_the_metrics_facade() -> None:
    offenders: list[str] = []
    for path in _SRC.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names = (
                [a.name for a in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""]
                if isinstance(node, ast.ImportFrom)
                else []
            )
            if any(name == "scoringrules" or name.startswith("scoringrules.") for name in names):
                offenders.append(path.relative_to(_SRC).as_posix())
    assert offenders == ["ml/metrics.py"]
