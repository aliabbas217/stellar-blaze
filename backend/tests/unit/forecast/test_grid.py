"""The forecast vocabulary (levels, pairs, hour-blocks) and the quantile-grid arithmetic of ``domain.forecast.grid``."""

from datetime import UTC, date, datetime, timedelta

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from hypothesis.extra import numpy as hnp

from stellar_blaze.domain.forecast.grid import (
    F64,
    HEADLINE_LEADS,
    HOUR_BLOCKS,
    LEVELS,
    MODEL_LEADS,
    MODELLED_HOURS_UTC,
    PAIRS,
    REPORT_LEADS,
    HourBlock,
    apply_symmetric_offsets,
    cdf,
    exceedance_probability,
    hour_block,
    ppf,
    sort_grid,
)
from stellar_blaze.domain.weather.models import summer_window

pytestmark = pytest.mark.unit

_SETTINGS = settings(max_examples=150, deadline=None, database=None, derandomize=True)


def _grid(*rows: list[float]) -> F64:
    return np.asarray(rows, dtype=np.float64)


def _linear_grid(start: float = 20.0, step: float = 0.5, rows: int = 1) -> F64:
    return np.tile(start + step * np.arange(19, dtype=np.float64), (rows, 1))


# Strictly increasing grids: increments of at least 0.05 over a random start.
_increments = hnp.arrays(np.float64, 19, elements=st.floats(0.05, 3.0))
_starts = st.floats(-20.0, 50.0)


@st.composite
def strictly_increasing_grids(draw: st.DrawFn) -> F64:
    rows = draw(st.integers(1, 4))
    out = np.empty((rows, 19), dtype=np.float64)
    for r in range(rows):
        steps = draw(_increments).copy()
        steps[0] = draw(_starts)
        out[r] = np.cumsum(steps)
    return out


# Grids with ties: increments are 0 half of the time, so runs of equal quantiles occur at the ends and in the middle.
_tied_steps = hnp.arrays(np.float64, 19, elements=st.sampled_from([0.0, 0.0, 0.5, 1.0, 2.0]))


@st.composite
def grids_with_ties(draw: st.DrawFn) -> F64:
    rows = draw(st.integers(1, 4))
    out = np.empty((rows, 19), dtype=np.float64)
    for r in range(rows):
        steps = draw(_tied_steps).copy()
        steps[0] = draw(st.sampled_from([0.0, 3.0, 30.0]))
        out[r] = np.cumsum(steps)
    return out


# === vocabulary =====================================================================================================


def test_levels_and_pairs() -> None:
    assert len(LEVELS) == 19
    assert LEVELS[0] == 0.05
    assert LEVELS[-1] == 0.95
    assert LEVELS[9] == 0.5
    assert all(round(level * 100) == 5 * (k + 1) for k, level in enumerate(LEVELS))
    assert list(LEVELS) == sorted(set(LEVELS))
    assert PAIRS[0] == (0.05, 0.95)
    assert PAIRS[-1] == (0.45, 0.55)
    assert len(PAIRS) == 9
    assert all(low == LEVELS[i] and high == LEVELS[18 - i] for i, (low, high) in enumerate(PAIRS))


def test_hour_block_edges() -> None:
    assert hour_block(2) is HourBlock.EARLY
    assert hour_block(5) is HourBlock.EARLY
    assert hour_block(6) is HourBlock.PEAK
    assert hour_block(10) is HourBlock.PEAK
    assert hour_block(11) is HourBlock.LATE
    assert hour_block(15) is HourBlock.LATE
    for outside in (-1, 0, 1, 16, 23, 24):
        with pytest.raises(ValueError, match=str(outside)):
            hour_block(outside)


def test_hour_blocks_partition_the_modelled_hours() -> None:
    assert dict(HOUR_BLOCKS) == {
        HourBlock.EARLY: range(2, 6),
        HourBlock.PEAK: range(6, 11),
        HourBlock.LATE: range(11, 16),
    }
    covered = [hour for block in HourBlock for hour in HOUR_BLOCKS[block]]
    assert covered == list(MODELLED_HOURS_UTC)
    assert {hour_block(hour) for hour in MODELLED_HOURS_UTC} == set(HourBlock)
    assert [HourBlock(value) for value in ("early", "peak", "late")] == [
        HourBlock.EARLY,
        HourBlock.PEAK,
        HourBlock.LATE,
    ]


def test_lead_and_hour_constants() -> None:
    assert range(2, 16) == MODELLED_HOURS_UTC
    assert range(1, 8) == MODEL_LEADS
    assert HEADLINE_LEADS == (1, 2, 3)
    assert REPORT_LEADS == (1, 2, 3, 5, 7)
    assert set(HEADLINE_LEADS) <= set(REPORT_LEADS) <= set(MODEL_LEADS)


@pytest.mark.parametrize("year", [2024, 2025, 2026])
def test_modelled_hours_share_utc_and_gst_date(year: int) -> None:
    first, last = summer_window(year)
    day = datetime(first.year, first.month, first.day, tzinfo=UTC)
    checked = 0
    while day <= last:
        for hour in MODELLED_HOURS_UTC:
            t = day + timedelta(hours=hour)
            local = t + timedelta(hours=4)
            assert local.date() == t.date() == date(day.year, day.month, day.day), t
            checked += 1
        day += timedelta(days=1)
    assert checked == 139 * 14


def test_the_gst_identity_does_not_hold_outside_the_modelled_hours() -> None:
    # Falsifiability of the test above: 20:00 UTC is already the next day in GST, so the identity is a property of 2-15.
    t = datetime(2025, 7, 1, 20, tzinfo=UTC)
    assert (t + timedelta(hours=4)).date() != t.date()


# === sort_grid and apply_symmetric_offsets ==========================================================================


def test_sort_grid_sorts_each_row_and_does_not_mutate_the_input() -> None:
    grid = np.arange(38, dtype=np.float64).reshape(2, 19)[:, ::-1].copy()
    before = grid.copy()
    out = sort_grid(grid)
    assert np.array_equal(out, np.sort(before, axis=1))
    assert np.array_equal(grid, before)
    assert out is not grid


@pytest.mark.parametrize("shape", [(19,), (3, 18), (3, 19, 1)])
def test_grid_functions_reject_a_wrong_shape(shape: tuple[int, ...]) -> None:
    bad = np.zeros(shape, dtype=np.float64)
    with pytest.raises(ValueError, match="19"):
        sort_grid(bad)
    with pytest.raises(ValueError, match="19"):
        apply_symmetric_offsets(bad, [0.0] * 9)
    with pytest.raises(ValueError, match="19"):
        ppf(bad, np.zeros(3))
    with pytest.raises(ValueError, match="19"):
        cdf(bad, np.zeros(3))


def test_apply_offsets_widens_each_pair_by_its_own_offset() -> None:
    grid = _linear_grid(20.0, 1.0)
    offsets = [0.1 * (i + 1) for i in range(9)]
    out = apply_symmetric_offsets(grid, offsets)
    for i, q in enumerate(offsets):
        assert out[0, i] == pytest.approx(grid[0, i] - q)
        assert out[0, 18 - i] == pytest.approx(grid[0, 18 - i] + q)
    assert out[0, 9] == grid[0, 9]


def test_apply_offsets_does_not_mutate_the_input() -> None:
    grid = _linear_grid()
    before = grid.copy()
    apply_symmetric_offsets(grid, [0.3] * 9)
    assert np.array_equal(grid, before)


def test_apply_offsets_needs_one_offset_per_pair() -> None:
    with pytest.raises(ValueError, match="9"):
        apply_symmetric_offsets(_linear_grid(), [0.1] * 8)


def test_apply_offsets_rejects_an_unsorted_grid() -> None:
    grid = _linear_grid()
    grid[0, 3], grid[0, 4] = grid[0, 4], grid[0, 3]
    with pytest.raises(ValueError, match="sorted"):
        apply_symmetric_offsets(grid, [0.0] * 9)


def test_apply_offsets_negative_offsets_stop_at_the_median() -> None:
    # Grid 0.0 .. 0.9 in steps of 0.05 and offsets of -2 on every pair: lo + 2 would pass the median and hi - 2 would
    # fall below it. The interval cannot be narrower than the median, so every quantile collapses onto it.
    grid = _linear_grid(0.0, 0.05)
    out = apply_symmetric_offsets(grid, [-2.0] * 9)
    assert np.all(out == grid[0, 9])


def test_apply_offsets_negative_offset_that_does_not_reach_the_median_narrows_exactly() -> None:
    grid = _linear_grid(0.0, 1.0)  # quantile k is k; the median is 9
    offsets = [-0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    out = apply_symmetric_offsets(grid, offsets)
    assert out[0, 0] == pytest.approx(grid[0, 0] + 0.1, abs=1e-12)
    assert out[0, 18] == pytest.approx(grid[0, 18] - 0.1, abs=1e-12)
    assert np.array_equal(out[0, 1:18], grid[0, 1:18])
    spaced = _linear_grid(0.0, 4.0)  # a larger offset narrows by exactly its size while it stays clear of the median
    wide = apply_symmetric_offsets(spaced, [-1.5] + [0.0] * 8)
    assert wide[0, 0] == pytest.approx(1.5)
    assert wide[0, 18] == pytest.approx(70.5)
    every_pair = apply_symmetric_offsets(grid, [-0.25 * (i + 1) / 9 for i in range(9)])
    for i in range(9):
        assert every_pair[0, i] == pytest.approx(grid[0, i] + 0.25 * (i + 1) / 9)
        assert every_pair[0, 18 - i] == pytest.approx(grid[0, 18 - i] - 0.25 * (i + 1) / 9)


def _asymmetric_grid(lower_gap: float, upper_gap: float) -> F64:
    """Median 10; the quantiles next to it are ``lower_gap`` below and ``upper_gap`` above, then 0.5 or 2.0 apart."""
    lower = [10.0 - lower_gap - 0.5 * (8 - k) for k in range(9)]  # columns 0..8
    upper = [10.0 + upper_gap + 2.0 * (k - 10) for k in range(10, 19)]  # columns 10..18
    return _grid([*lower, 10.0, *upper])


def test_apply_offsets_when_only_the_lower_side_reaches_the_median_only_it_stops_there() -> None:
    grid = _asymmetric_grid(lower_gap=0.5, upper_gap=2.0)  # column 8 is 9.5, column 10 is 12.0
    out = apply_symmetric_offsets(grid, [0.0] * 8 + [-1.0])  # pair 8 is columns 8 and 10
    assert out[0, 8] == 10.0  # 9.5 + 1.0 would pass the median: it stops there
    assert out[0, 10] == pytest.approx(11.0)  # 12.0 - 1.0 stays above the median: the full offset
    assert np.all(np.diff(out, axis=1) >= 0.0)
    rest = [k for k in range(19) if k not in (8, 10)]
    assert np.array_equal(out[0, rest], grid[0, rest])


def test_apply_offsets_when_only_the_upper_side_reaches_the_median_only_it_stops_there() -> None:
    grid = _asymmetric_grid(lower_gap=2.0, upper_gap=0.5)  # column 8 is 8.0, column 10 is 10.5
    out = apply_symmetric_offsets(grid, [0.0] * 8 + [-1.0])
    assert out[0, 10] == 10.0  # 10.5 - 1.0 would pass the median: it stops there
    assert out[0, 8] == pytest.approx(9.0)  # 8.0 + 1.0 stays below the median: the full offset
    assert np.all(np.diff(out, axis=1) >= 0.0)
    rest = [k for k in range(19) if k not in (8, 10)]
    assert np.array_equal(out[0, rest], grid[0, rest])


# === NaN and infinities: a row is usable or it is all NaN ==========================================================


def _with_bad_value(value: float, column: int = 3) -> F64:
    grid = _linear_grid(0.0, 1.0, rows=3)
    grid[1, column] = value
    return grid


@pytest.mark.parametrize("bad", [np.nan, np.inf, -np.inf])
def test_sort_grid_turns_a_row_with_a_non_finite_value_into_an_all_nan_row(bad: float) -> None:
    out = sort_grid(_with_bad_value(bad))
    assert np.isnan(out[1]).all()
    assert np.array_equal(out[[0, 2]], _linear_grid(0.0, 1.0, rows=2))


@pytest.mark.parametrize("bad", [np.nan, np.inf, -np.inf])
def test_apply_offsets_turns_a_row_with_a_non_finite_value_into_an_all_nan_row(bad: float) -> None:
    out = apply_symmetric_offsets(_with_bad_value(bad), [0.0] * 9)  # zero offsets: nothing else may change
    assert np.isnan(out[1]).all()  # not [0, 1, 2, 4, ..., 18, nan]
    assert np.array_equal(out[[0, 2]], _linear_grid(0.0, 1.0, rows=2))
    # also when the bad value is the median and when it is an extreme
    assert np.isnan(apply_symmetric_offsets(_with_bad_value(bad, 9), [0.5] * 9)[1]).all()
    assert np.isnan(apply_symmetric_offsets(_with_bad_value(bad, 0), [0.5] * 9)[1]).all()


@pytest.mark.parametrize("bad", [np.nan, np.inf, -np.inf])
@pytest.mark.parametrize("position", [0, 4, 8])
def test_a_non_finite_offset_makes_every_row_all_nan(bad: float, position: int) -> None:
    offsets = [0.1] * 9
    offsets[position] = bad
    out = apply_symmetric_offsets(_linear_grid(0.0, 1.0, rows=3), offsets)
    assert out.shape == (3, 19)
    assert np.isnan(out).all()


@pytest.mark.parametrize("bad", [np.inf, -np.inf])
def test_ppf_and_cdf_treat_an_infinite_grid_row_as_all_nan_without_warnings(bad: float) -> None:
    grid = _with_bad_value(bad)
    assert np.isnan(ppf(grid, np.array([0.5, 0.5, 0.5]))[1])
    assert np.isnan(cdf(grid, np.array([5.0, 5.0, 5.0]))[1])
    assert np.isfinite(ppf(grid, np.array([0.5, 0.5, 0.5]))[[0, 2]]).all()
    assert np.isfinite(cdf(grid, np.array([5.0, 5.0, 5.0]))[[0, 2]]).all()


@_SETTINGS
@given(
    grid=strictly_increasing_grids(),
    offsets=hnp.arrays(np.float64, 9, elements=st.floats(-2.0, 2.0)),
)
def test_apply_offsets_keeps_median_and_sorts(grid: F64, offsets: F64) -> None:
    out = apply_symmetric_offsets(grid, offsets.tolist())
    assert np.array_equal(out[:, 9], grid[:, 9])
    assert np.all(np.diff(out, axis=1) >= 0.0)
    # The offsets never pull a quantile past the median: lower quantiles stay at or below it, upper ones at or above.
    assert np.all(out[:, :9] <= grid[:, [9]])
    assert np.all(out[:, 10:] >= grid[:, [9]])


@_SETTINGS
@given(grid=strictly_increasing_grids(), offsets=hnp.arrays(np.float64, 9, elements=st.floats(0.0, 2.0)))
def test_non_negative_offsets_never_shrink_an_interval(grid: F64, offsets: F64) -> None:
    out = apply_symmetric_offsets(grid, offsets.tolist())
    for i in range(9):
        assert np.all(out[:, i] <= grid[:, i])
        assert np.all(out[:, 18 - i] >= grid[:, 18 - i])


# === ppf and cdf ====================================================================================================


def test_ppf_hits_the_knots_and_interpolates_linearly() -> None:
    grid = _grid([float(v) for v in range(19)])  # quantile k is k at level 0.05 (k + 1)
    u = np.array([0.05, 0.50, 0.95, 0.075, 0.525])
    out = ppf(np.repeat(grid, 5, axis=0), u)
    assert out == pytest.approx([0.0, 9.0, 18.0, 0.5, 9.5])


def test_ppf_extends_the_outermost_segments_linearly() -> None:
    grid = _grid([float(v) for v in range(19)])  # slope: one unit per 0.05
    out = ppf(np.repeat(grid, 3, axis=0), np.array([0.0, 0.025, 1.0]))
    assert out == pytest.approx([-1.0, -0.5, 19.0])


def test_cdf_is_the_inverse_of_that_interpolation_and_clips_to_the_unit_interval() -> None:
    grid = _grid([float(v) for v in range(19)])
    x = np.array([-50.0, -1.0, -0.5, 0.0, 0.5, 9.0, 18.0, 18.5, 19.0, 60.0])
    out = cdf(np.repeat(grid, x.size, axis=0), x)
    assert out == pytest.approx([0.0, 0.0, 0.025, 0.05, 0.075, 0.5, 0.95, 0.975, 1.0, 1.0])


def test_ppf_and_cdf_accept_several_values_per_row() -> None:
    grid = _linear_grid(10.0, 1.0, rows=3)
    u = np.tile(np.array([0.1, 0.5, 0.9]), (3, 1))
    values = ppf(grid, u)
    assert values.shape == (3, 3)
    assert cdf(grid, values) == pytest.approx(u)


def test_ppf_and_cdf_need_one_row_of_values_per_grid_row() -> None:
    grid = _linear_grid(rows=3)
    with pytest.raises(ValueError, match="rows"):
        ppf(grid, np.zeros(2))
    with pytest.raises(ValueError, match="rows"):
        cdf(grid, np.zeros((2, 4)))


def test_ppf_rejects_probabilities_outside_the_unit_interval() -> None:
    grid = _linear_grid()
    for bad in (-0.01, 1.01):
        with pytest.raises(ValueError, match="probabilit"):
            ppf(grid, np.array([bad]))


def test_nan_in_gives_nan_out_without_warnings() -> None:
    grid = _linear_grid(rows=2)
    grid[1, 4] = np.nan
    assert np.isnan(ppf(grid, np.array([np.nan, 0.5]))).all()
    assert np.isnan(cdf(grid, np.array([np.nan, 22.0]))).all()
    assert np.isnan(exceedance_probability(grid, 22.0)[1])
    assert not np.isnan(exceedance_probability(grid, 22.0)[0])


@_SETTINGS
@given(grid=strictly_increasing_grids(), u=st.floats(0.01, 0.99))
def test_ppf_cdf_roundtrip(grid: F64, u: float) -> None:
    us = np.full(grid.shape[0], u)
    assert cdf(grid, ppf(grid, us)) == pytest.approx(us, abs=1e-9)


@_SETTINGS
@given(grid=strictly_increasing_grids(), x=st.floats(-1.0, 1.0))
def test_cdf_ppf_roundtrip_inside_the_support(grid: F64, x: float) -> None:
    # The other direction, on values between the lowest and highest quantile the extension is not involved.
    values = grid[:, 0] + (x + 1.0) / 2.0 * (grid[:, -1] - grid[:, 0])
    assert ppf(grid, cdf(grid, values)) == pytest.approx(values, abs=1e-8)


# --- ties: zero-width segments never divide by zero and never warn --------------------------------------------------


def test_cdf_at_a_lower_tie_is_the_mean_of_the_tied_levels() -> None:
    # Wind clipped at 0: the 5th, 10th and 15th percentiles are all 0.
    grid = _grid([0.0, 0.0, 0.0, 0.4, *[0.4 + 0.2 * k for k in range(1, 16)]])
    n = grid.shape[1]
    assert n == 19
    rows = np.repeat(grid, 5, axis=0)
    x = np.array([-1.0, 0.0, 1e-12, 0.2, 0.4])
    out = cdf(rows, x)
    assert out[0] == 0.0  # below the tie: the lower bound, no extension through a zero-width segment
    assert out[1] == pytest.approx((0.05 + 0.10 + 0.15) / 3)  # at the tie: mid-rank
    assert out[2] == pytest.approx(0.15, abs=1e-9)  # just above the tie: the upper bound of the tied levels
    assert out[3] == pytest.approx(0.175)  # linear in the next segment (0.15 at 0.0, 0.20 at 0.4)
    assert out[4] == pytest.approx(0.20)


def test_cdf_at_an_interior_tie_is_the_mean_of_the_tied_levels() -> None:
    grid = _grid([float(v) for v in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 9, 13, 14, 15, 16, 17, 18)])
    # q50..q65 are 9, 9, 9, 9 -> levels 0.50, 0.55, 0.60, 0.65.
    out = cdf(np.repeat(grid, 3, axis=0), np.array([8.999999, 9.0, 9.000001]))
    assert out[0] == pytest.approx(0.50, abs=1e-6)
    assert out[1] == pytest.approx((0.50 + 0.55 + 0.60 + 0.65) / 4)
    assert out[2] == pytest.approx(0.65, abs=1e-6)


def test_cdf_of_an_all_equal_grid_is_a_step_at_the_value() -> None:
    # FakeCorrector(spread_c=0): every quantile is the raw value, so the outer segments are degenerate too.
    grid = np.full((4, 19), 31.5)
    out = cdf(grid, np.array([31.0, 31.5, 32.0, 31.4999]))
    assert out.tolist() == [0.0, 0.5, 1.0, 0.0]
    assert exceedance_probability(grid, 31.0).tolist() == [1.0] * 4
    assert exceedance_probability(grid, 31.5).tolist() == [0.5] * 4
    assert exceedance_probability(grid, 32.0).tolist() == [0.0] * 4
    assert ppf(grid, np.array([0.0, 0.3, 0.5, 0.97])).tolist() == [31.5] * 4


def test_cdf_above_a_degenerate_upper_tail_is_one() -> None:
    grid = _grid([float(v) for v in range(16)] + [15.0, 15.0, 15.0])
    out = cdf(np.repeat(grid, 3, axis=0), np.array([15.0, 15.1, 100.0]))
    assert out[0] == pytest.approx(np.mean([0.80, 0.85, 0.90, 0.95]))
    assert out[1] == 1.0
    assert out[2] == 1.0


@_SETTINGS
@given(grid=grids_with_ties(), shift=st.floats(-3.0, 3.0))
def test_cdf_is_bounded_monotone_and_inverts_on_the_knots_even_with_ties(grid: F64, shift: float) -> None:
    rows = grid.shape[0]
    xs = np.array(sorted({float(v) + s for v in grid.ravel() for s in (-1.0, 0.0, shift, 1.0)}))
    out = cdf(
        grid, np.tile(xs, (rows, 1))
    )  # the filterwarnings = error setting turns any division warning into a failure
    assert np.all((out >= 0.0) & (out <= 1.0))
    assert np.all(np.diff(out, axis=1) >= -1e-12)
    for k in range(19):
        knots = grid[:, k]
        assert ppf(grid, cdf(grid, knots)) == pytest.approx(knots, abs=1e-9)


@_SETTINGS
@given(grid=grids_with_ties(), u=st.floats(0.0, 1.0))
def test_ppf_stays_inside_the_extended_support_and_is_monotone(grid: F64, u: float) -> None:
    rows = grid.shape[0]
    lo = ppf(grid, np.full(rows, u))
    hi = ppf(grid, np.full(rows, min(u + 0.01, 1.0)))
    assert np.all(np.isfinite(lo))
    assert np.all(hi >= lo - 1e-12)


# === exceedance_probability =========================================================================================


def test_exceedance_probability_is_one_minus_the_cdf() -> None:
    grid = _linear_grid(30.0, 0.5, rows=3)
    out = exceedance_probability(grid, 34.5)
    assert out.shape == (3,)
    assert out == pytest.approx(1.0 - cdf(grid, np.full(3, 34.5)))
    assert out == pytest.approx(0.5)  # 34.5 is the median of 30.0 .. 39.0
    assert exceedance_probability(grid, -100.0) == pytest.approx(1.0)
    assert exceedance_probability(grid, 100.0) == pytest.approx(0.0)


@_SETTINGS
@given(grid=grids_with_ties(), threshold=st.floats(-5.0, 40.0))
def test_exceedance_probability_is_a_probability_that_falls_with_the_threshold(grid: F64, threshold: float) -> None:
    low = exceedance_probability(grid, threshold)
    high = exceedance_probability(grid, threshold + 0.5)
    assert np.all((low >= 0.0) & (low <= 1.0))
    assert np.all(high <= low + 1e-12)
