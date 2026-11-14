"""Symmetric CQR offsets per lead x hour-block (pre-registration sections 2.3, 3.1 and 6.4).

The oracle test compares the offsets with MAPIE 1.6.0 on a synthetic one-stratum problem; the others pin the rank
formula against an exact (``fractions``) reference, the fallback rules, the clamp bookkeeping and the calibration
windows. Nothing here reads the gold file.
"""

import logging
import math
from collections.abc import Sequence
from datetime import date, timedelta
from fractions import Fraction
from statistics import NormalDist
from typing import Final

import lightgbm as lgb
import numpy as np
import polars as pl
import pytest
import structlog
from numpy.typing import NDArray

from stellar_blaze.domain.forecast import conformal as domain_conformal
from stellar_blaze.domain.forecast.features import Target
from stellar_blaze.domain.forecast.grid import F64, HOUR_BLOCKS, LEVELS, PAIRS, HourBlock
from stellar_blaze.ml import _mapie
from stellar_blaze.ml.conformal import (
    CalibrationWindow,
    ConformalOffsets,
    apply_offsets,
    calibration_mask,
    fit_mask,
    fit_symmetric_offsets,
    stratum_key,
)

pytestmark = pytest.mark.unit

BLOCKS: Final = tuple(HOUR_BLOCKS)
N_LEVELS: Final = len(LEVELS)
ALPHAS: Final = tuple(Fraction(round(hi * 20) - round(lo * 20), 20) for lo, hi in PAIRS)  # coverage 1 - alpha


# ---------------------------------------------------------------------------------------------------------------------
# helpers


def normal_grid(rows: int, sigma: float | F64, *, center: float = 0.0) -> F64:
    """A sorted ``(rows, 19)`` grid of normal quantiles with scale ``sigma`` (a scalar or one value per row)."""
    z = np.array([NormalDist().inv_cdf(level) for level in LEVELS])
    scale = np.broadcast_to(np.asarray(sigma, dtype=np.float64), (rows,))
    grid: F64 = center + scale[:, None] * z[None, :]
    return grid


def strata_frame(
    rng: np.random.Generator,
    per_stratum: int,
    leads: Sequence[int],
    *,
    sigma_true: float = 1.0,
    sigma_model: float = 0.7,
) -> tuple[F64, F64, NDArray[np.int8], list[HourBlock]]:
    """Data of a model that is too narrow: ``y`` ~ N(0, sigma_true * (1 + 0.25 * lead)), grid ~ N(0, sigma_model)."""
    lead_list: list[int] = []
    block_list: list[HourBlock] = []
    for lead_value in leads:
        for block in BLOCKS:
            lead_list += [lead_value] * per_stratum
            block_list += [block] * per_stratum
    lead = np.asarray(lead_list, dtype=np.int8)
    n = len(lead)
    y = rng.normal(0.0, sigma_true * (1.0 + 0.25 * lead), size=n)
    return normal_grid(n, sigma_model), y, lead, block_list


def reference_offset(grid: F64, y: F64, pair: int) -> float:
    """The textbook split-conformal offset by direct order statistics, with exact rational rank arithmetic."""
    lo, hi = grid[:, pair], grid[:, N_LEVELS - 1 - pair]
    scores = np.sort(np.maximum(lo - y, y - hi))
    n = len(scores)
    rank = math.ceil((n + 1) * ALPHAS[pair])  # ALPHAS holds the coverage 1 - alpha as an exact fraction
    return float(scores[min(rank, n) - 1])


# ---------------------------------------------------------------------------------------------------------------------
# the oracle


class TestMatchesMapie:
    def test_matches_mapie_symmetric(self) -> None:
        rng = np.random.default_rng(20261112)
        n_train, n_cal, n_test = 4000, 600, 500

        def draw(n: int, noise: float = 1.0) -> tuple[F64, F64]:
            x = rng.uniform(0.0, 1.0, size=(n, 1))
            return x, 2.0 * x[:, 0] + noise * (0.4 + x[:, 0]) * rng.standard_normal(n)

        x_train, y_train = draw(n_train)
        x_cal, y_cal = draw(n_cal, noise=1.8)  # noisier than the training data, so the raw interval is too narrow
        x_test, _ = draw(n_test)
        # the documented order is [lower, upper, median] (stack doc 6.1); sklearn API, not a native Booster
        estimators = [
            lgb.LGBMRegressor(objective="quantile", alpha=alpha, n_estimators=60, num_leaves=7, verbosity=-1).fit(
                x_train, y_train
            )
            for alpha in (0.05, 0.95, 0.5)
        ]
        low, up, med = (np.asarray(e.predict(x_test), dtype=np.float64) for e in estimators)
        assert np.all(low <= med), "fixture precondition: no crossing, so no sort or clamp"
        assert np.all(med <= up)
        low_cal, up_cal, med_cal = (np.asarray(e.predict(x_cal), dtype=np.float64) for e in estimators)

        # ours: a 19-column grid whose columns 0, 9 and 18 are the three quantile models; the rest is interpolation
        def grid_of(lo: F64, md: F64, hi: F64) -> F64:
            weights = np.linspace(0.0, 1.0, 10)
            left = lo[:, None] + weights[None, :] * (md - lo)[:, None]  # columns 0..9, the median is column 9
            right = md[:, None] + weights[None, 1:] * (hi - md)[:, None]  # columns 10..18
            return np.hstack([left, right])

        lead = np.ones(n_cal, dtype=np.int8)
        block = [HourBlock.PEAK] * n_cal
        offsets = fit_symmetric_offsets(grid_of(low_cal, med_cal, up_cal), y_cal, lead, block, target=Target.T)
        ours = apply_offsets(
            grid_of(low, med, up), np.ones(n_test, dtype=np.int8), [HourBlock.PEAK] * n_test, offsets, Target.T
        )

        oracle_low, oracle_up = _mapie.mapie_symmetric_interval(estimators, x_cal, y_cal, x_test, confidence_level=0.9)

        np.testing.assert_allclose(ours[:, 0], oracle_low, atol=5e-5)
        np.testing.assert_allclose(ours[:, 18], oracle_up, atol=5e-5)
        # not vacuous: the oracle really moved the interval away from the raw one, by a non-trivial amount
        shift = np.maximum(low - oracle_low, oracle_up - up)
        assert np.abs(shift).min() > 0.05, f"the calibration should be visible, got shifts of {np.abs(shift).min():.4f}"
        assert not np.allclose(oracle_low, low, atol=5e-5)
        assert not np.allclose(oracle_up, up, atol=5e-5)
        # and the shift is the one our offset names (it is symmetric: one q for both sides)
        pair_offset = offsets.offsets["t"]["1|peak"][0]
        np.testing.assert_allclose(low - oracle_low, pair_offset, atol=5e-5)
        np.testing.assert_allclose(oracle_up - up, pair_offset, atol=5e-5)

    def test_facade_routes_mapie_root_logging_through_structlog(self, monkeypatch: pytest.MonkeyPatch) -> None:
        rng = np.random.default_rng(3)
        x = rng.uniform(size=(300, 1))
        y = x[:, 0] + rng.standard_normal(300)
        models = [
            lgb.LGBMRegressor(objective="quantile", alpha=a, n_estimators=10, verbosity=-1).fit(x, y)
            for a in (0.95, 0.05, 0.5)  # upper before lower: MAPIE sees ill-sorted bounds and logs on the root logger
        ]
        # pytest keeps its own handlers on the root logger, which makes MAPIE's logging.basicConfig a no-op: take them
        # off for the call so that the real side effects (a stderr handler, level INFO) would show if they leaked.
        root = logging.getLogger()
        monkeypatch.setattr(root, "handlers", [])  # the original list object comes back at teardown
        original_level = root.level
        root.setLevel(logging.WARNING)
        try:
            with structlog.testing.capture_logs() as captured:
                _mapie.mapie_symmetric_interval(models, x, y, x, confidence_level=0.9)
            assert root.handlers == [], "MAPIE's logging.basicConfig must not leave a stderr handler behind"
            assert root.level == logging.WARNING
            assert root.filters == []
        finally:
            root.setLevel(original_level)  # setLevel, not an attribute write: it also clears the logger's level cache
        events = [e for e in captured if e["event"] == "mapie_message"]
        assert events, f"the ill-sorted INFO should reach structlog, got {captured}"
        assert "ill-sorted" in events[0]["message"]
        assert events[0]["log_level"] == "info"

    def test_oracle_in_the_wrong_estimator_order_is_detectably_different(self) -> None:
        # [lower, median, upper] (the 0.x order) would pass silently through MAPIE and give a different interval.
        rng = np.random.default_rng(5)
        x = rng.uniform(size=(2000, 1))
        y = 2.0 * x[:, 0] + (0.4 + x[:, 0]) * rng.standard_normal(2000)
        fitted = {
            a: lgb.LGBMRegressor(objective="quantile", alpha=a, n_estimators=40, num_leaves=7, verbosity=-1).fit(x, y)
            for a in (0.05, 0.5, 0.95)
        }
        right = _mapie.mapie_symmetric_interval(
            [fitted[0.05], fitted[0.95], fitted[0.5]], x[:500], y[:500], x[500:], confidence_level=0.9
        )
        wrong = _mapie.mapie_symmetric_interval(
            [fitted[0.05], fitted[0.5], fitted[0.95]], x[:500], y[:500], x[500:], confidence_level=0.9
        )
        assert np.abs(right[1] - wrong[1]).max() > 0.5


# ---------------------------------------------------------------------------------------------------------------------
# the offsets


class TestFit:
    def test_matches_exact_reference_on_every_stratum_and_pair(self) -> None:
        rng = np.random.default_rng(1)
        # per-stratum sizes chosen so that ceil((n+1)(1-a)) differs from ceil(n(1-a)) for some pairs (n = 40, 50, 99)
        sizes = {1: 40, 2: 50, 3: 99}
        grids: list[F64] = []
        ys: list[F64] = []
        leads: list[NDArray[np.int8]] = []
        blocks: list[HourBlock] = []
        for lead_value, size in sizes.items():
            for block in BLOCKS:
                n = size + BLOCKS.index(block)
                grids.append(normal_grid(n, 0.8))
                ys.append(rng.normal(0.0, 1.0 + 0.3 * lead_value, size=n))
                leads.append(np.full(n, lead_value, dtype=np.int8))
                blocks += [block] * n
        grid, y, lead = np.vstack(grids), np.concatenate(ys), np.concatenate(leads)
        shuffle = rng.permutation(len(y))  # order must not matter
        offsets = fit_symmetric_offsets(
            grid[shuffle], y[shuffle], lead[shuffle], [blocks[i] for i in shuffle], target=Target.TD
        )
        block_array = np.asarray(blocks)
        for lead_value in sizes:
            for block in BLOCKS:
                rows = (lead == lead_value) & (block_array == block.value)
                key = f"{lead_value}|{block.value}"
                assert offsets.n["td"][key] == rows.sum()
                expected = [reference_offset(grid[rows], y[rows], pair) for pair in range(len(PAIRS))]
                np.testing.assert_allclose(offsets.offsets["td"][key], expected, rtol=0, atol=1e-12)
        assert offsets.fallback["td"] == []

    def test_rank_uses_n_plus_one(self) -> None:
        # n = 40, alpha = 0.1: ceil(41 * 0.9) = 37 (the 37th smallest), but ceil(40 * 0.9) = 36. Scores 0..39 make
        # the order statistic visible: 37th smallest is 36, 36th is 35.
        n = 40
        grid = np.zeros((n, N_LEVELS))
        y = np.arange(n, dtype=np.float64)  # score = max(0 - y, y - 0) = y
        offsets = fit_symmetric_offsets(
            grid, y, np.ones(n, dtype=np.int8), [HourBlock.EARLY] * n, target=Target.WIND, min_n=30
        )
        assert offsets.offsets["wind"]["1|early"][0] == 36.0

    def test_small_stratum_falls_back(self) -> None:
        rng = np.random.default_rng(2)
        grid, y, lead, block = strata_frame(rng, 200, leads=(1,))
        # shrink one stratum (1|late) to 10 usable rows
        late = np.flatnonzero(np.asarray([b is HourBlock.LATE for b in block]))
        keep = np.ones(len(y), dtype=bool)
        keep[late[10:]] = False
        grid, y, lead, block = grid[keep], y[keep], lead[keep], [b for b, k in zip(block, keep, strict=True) if k]

        offsets = fit_symmetric_offsets(grid, y, lead, block, target=Target.T)

        assert offsets.n["t"]["1|late"] == 10
        assert offsets.fallback["t"] == ["1|late"]
        pooled = [reference_offset(grid, y, pair) for pair in range(len(PAIRS))]  # all blocks of lead 1
        np.testing.assert_allclose(offsets.offsets["t"]["1|late"], pooled, atol=1e-12)
        # the big strata keep their own offset, which differs from the pooled one
        own = [reference_offset(grid[:200], y[:200], pair) for pair in range(len(PAIRS))]
        np.testing.assert_allclose(offsets.offsets["t"]["1|early"], own, atol=1e-12)
        assert offsets.offsets["t"]["1|early"] != offsets.offsets["t"]["1|late"]

    def test_stratum_with_exactly_min_n_keeps_its_own_offset(self) -> None:
        rng = np.random.default_rng(4)
        grid, y, lead, block = strata_frame(rng, 30, leads=(2,))
        offsets = fit_symmetric_offsets(grid, y, lead, block, target=Target.T, min_n=30)
        assert offsets.fallback["t"] == []
        offsets_29 = fit_symmetric_offsets(grid, y, lead, block, target=Target.T, min_n=31)
        assert sorted(offsets_29.fallback["t"]) == ["2|early", "2|late", "2|peak"]  # then the pooled n of 90 is used

    def test_min_n_below_the_rank_limit_raises(self) -> None:
        # n = 5 with min_n = 1 would keep a stratum whose 0.05/0.95 offset needs rank ceil(6 * 0.9) = 6 > 5
        n = 5
        args = (normal_grid(n, 1.0), np.zeros(n), np.ones(n, dtype=np.int8), [HourBlock.PEAK] * n)
        with pytest.raises(ValueError, match=r"min_n must be at least 9"):
            fit_symmetric_offsets(*args, target=Target.T, min_n=1)
        with pytest.raises(ValueError, match=r"min_n must be at least 9"):
            fit_symmetric_offsets(*args, target=Target.T, min_n=8)

    def test_min_n_nine_is_enough_for_every_pair(self) -> None:
        n = 9  # ceil(10 * 0.9) = 9 <= 9: the widest pair takes the maximum score
        grid, y = normal_grid(n, 1.0), np.arange(n, dtype=np.float64)
        offsets = fit_symmetric_offsets(
            grid, y, np.ones(n, dtype=np.int8), [HourBlock.PEAK] * n, target=Target.T, min_n=9
        )
        assert offsets.n["t"]["1|peak"] == 9
        assert offsets.fallback["t"] == []
        lo, hi = grid[0, 0], grid[0, 18]
        assert offsets.offsets["t"]["1|peak"][0] == max(lo - y.min(), y.max() - hi)

    def test_pooled_n_too_small_raises_naming_target_and_lead(self) -> None:
        rng = np.random.default_rng(5)
        grid, y, lead, block = strata_frame(rng, 100, leads=(1,))
        grid3, y3, lead3, block3 = strata_frame(rng, 5, leads=(3,))  # lead 3: 15 rows in all, below min_n
        with pytest.raises(ValueError, match=r"wbgt.*lead 3|lead 3.*wbgt"):
            fit_symmetric_offsets(
                np.vstack([grid, grid3]),
                np.concatenate([y, y3]),
                np.concatenate([lead, lead3]),
                [*block, *block3],
                target=Target.WBGT,
            )

    def test_non_finite_rows_are_excluded_and_not_counted(self) -> None:
        rng = np.random.default_rng(6)
        grid, y, lead, block = strata_frame(rng, 120, leads=(1,))
        clean = fit_symmetric_offsets(grid, y, lead, block, target=Target.T)
        grid_bad, y_bad = grid.copy(), y.copy()
        grid_bad[0, 3] = np.nan  # a row of 1|early with a NaN in its grid
        y_bad[1] = np.nan  # a row of 1|early with no truth
        y_bad[200] = np.inf  # an infinite truth in 1|peak
        grid_bad[130, 17] = np.inf  # and an infinite quantile in 1|peak
        dirty = fit_symmetric_offsets(grid_bad, y_bad, lead, block, target=Target.T)
        assert dirty.n["t"]["1|early"] == clean.n["t"]["1|early"] - 2
        assert dirty.n["t"]["1|peak"] == clean.n["t"]["1|peak"] - 2
        assert dirty.n["t"]["1|late"] == clean.n["t"]["1|late"]
        for key, start, stop in (("1|early", 0, 120), ("1|peak", 120, 240), ("1|late", 240, 360)):
            rows = np.zeros(len(y), dtype=bool)
            rows[start:stop] = True
            rows &= np.isfinite(grid_bad).all(axis=1) & np.isfinite(y_bad)
            expected = [reference_offset(grid_bad[rows], y_bad[rows], pair) for pair in range(len(PAIRS))]
            np.testing.assert_allclose(dirty.offsets["t"][key], expected, atol=1e-12)
        assert np.isfinite(np.asarray(dirty.offsets["t"]["1|early"])).all()

    def test_empty_stratum_of_nan_rows_falls_back(self) -> None:
        rng = np.random.default_rng(7)
        grid, y, lead, block = strata_frame(rng, 100, leads=(1,))
        late = np.asarray([b is HourBlock.LATE for b in block])
        y[late] = np.nan  # every late row has no truth
        offsets = fit_symmetric_offsets(grid, y, lead, block, target=Target.T)
        assert offsets.n["t"]["1|late"] == 0
        assert offsets.fallback["t"] == ["1|late"]
        assert "1|late" in offsets.offsets["t"]

    def test_negative_offsets_are_counted_and_kept(self) -> None:
        rng = np.random.default_rng(8)
        n = 400
        lead = np.ones(n, dtype=np.int8)
        block = [HourBlock.PEAK] * n
        wide = fit_symmetric_offsets(  # the model is too wide: every interval over-covers, so q < 0 for most pairs
            normal_grid(n, 3.0), rng.normal(0.0, 1.0, size=n), lead, block, target=Target.T
        )
        narrow = fit_symmetric_offsets(normal_grid(n, 0.3), rng.normal(0.0, 1.0, size=n), lead, block, target=Target.T)
        negative = sum(q < 0.0 for q in wide.offsets["t"]["1|peak"])
        assert negative >= 5
        assert wide.negative == {"t": negative}
        assert narrow.negative == {"t": 0}
        assert all(q > 0.0 for q in narrow.offsets["t"]["1|peak"])

    @pytest.mark.parametrize(
        "mutate",
        [
            lambda g, y, lead, block: (g[:, :18], y, lead, block),
            lambda g, y, lead, block: (g, y[:-1], lead, block),
            lambda g, y, lead, block: (g, y, lead[:-1], block),
            lambda g, y, lead, block: (g, y, lead, block[:-1]),
            lambda g, y, lead, block: (g, y, lead + 7, block),
            lambda g, y, lead, block: (g, y, lead, ["noon", *block[1:]]),
        ],
        ids=["19 columns", "y length", "lead length", "block length", "lead out of range", "unknown block"],
    )
    def test_bad_inputs_raise(self, mutate: object) -> None:
        rng = np.random.default_rng(9)
        grid, y, lead, block = strata_frame(rng, 40, leads=(1,))
        bad = mutate(grid, y, lead, block)  # type: ignore[operator]
        with pytest.raises(ValueError):  # noqa: PT011 - the messages are checked by the dedicated tests above
            fit_symmetric_offsets(*bad, target=Target.T)

    def test_blocks_may_be_a_polars_series_of_strings(self) -> None:
        rng = np.random.default_rng(10)
        grid, y, lead, block = strata_frame(rng, 60, leads=(1, 2))
        from_list = fit_symmetric_offsets(grid, y, lead, block, target=Target.T)
        from_series = fit_symmetric_offsets(grid, y, lead, pl.Series([b.value for b in block]), target=Target.T)
        assert from_list == from_series


class TestCoverage:
    def test_coverage_on_exchangeable_synthetic(self) -> None:
        rng = np.random.default_rng(12)
        per_stratum, leads = 4000, (1, 3)
        grid, y, lead, block = strata_frame(rng, per_stratum, leads)  # the model is too narrow by a lead-wise factor
        offsets = fit_symmetric_offsets(grid, y, lead, block, target=Target.T)

        fresh_grid, fresh_y, fresh_lead, fresh_block = strata_frame(rng, 8000, leads)  # an independent draw
        raw_coverage = ((fresh_grid[:, 0] <= fresh_y) & (fresh_y <= fresh_grid[:, 18])).mean()
        calibrated = apply_offsets(fresh_grid, fresh_lead, fresh_block, offsets, Target.T)

        assert raw_coverage < 0.7, "fixture precondition: the uncalibrated interval clearly under-covers"
        block_array = np.asarray(fresh_block)
        for lead_value in leads:
            for block_value in BLOCKS:
                rows = (fresh_lead == lead_value) & (block_array == block_value.value)
                covered = (calibrated[rows, 0] <= fresh_y[rows]) & (fresh_y[rows] <= calibrated[rows, 18])
                assert 0.88 <= covered.mean() <= 0.92, f"{lead_value}|{block_value}: {covered.mean():.4f}"
        # every pair, pooled over the strata: coverage within 0.02 of its nominal level
        for index, (lo, hi) in enumerate(PAIRS):
            inside = (calibrated[:, index] <= fresh_y) & (fresh_y <= calibrated[:, N_LEVELS - 1 - index])
            assert abs(inside.mean() - (hi - lo)) < 0.02, f"pair {lo}/{hi}: {inside.mean():.4f}"


class TestFitThenApply:
    def test_median_never_moves(self) -> None:
        rng = np.random.default_rng(13)
        grid, y, lead, block = strata_frame(rng, 100, leads=(1, 2))
        offsets = fit_symmetric_offsets(grid, y, lead, block, target=Target.T)
        out = apply_offsets(grid, lead, block, offsets, Target.T)
        np.testing.assert_array_equal(out[:, 9], grid[:, 9])
        assert np.all(out[:, 0] < grid[:, 0]), "fixture precondition: the intervals did widen"
        assert np.all(np.diff(out, axis=1) >= 0.0)

    def test_negative_offset_clamps_at_the_median(self) -> None:
        n = 60
        lead, block = np.ones(n, dtype=np.int8), [HourBlock.EARLY] * n
        grid = normal_grid(n, 5.0)
        offsets = fit_symmetric_offsets(grid, np.zeros(n), lead, block, target=Target.T)  # y at the median: q = -5 z
        out = apply_offsets(grid, lead, block, offsets, Target.T)
        assert min(offsets.offsets["t"]["1|early"]) < 0.0
        assert np.all(out[:, 0] <= out[:, 9])
        assert np.all(out[:, 18] >= out[:, 9])
        np.testing.assert_array_equal(out[:, 9], grid[:, 9])


# ---------------------------------------------------------------------------------------------------------------------
# calibration windows


def season(year: int) -> pl.DataFrame:
    """One row per day from 15 May to 30 September of ``year`` (139 days), plus the days before and after."""
    first, last = date(year, 5, 1), date(year, 10, 15)
    days = [first + timedelta(days=k) for k in range((last - first).days + 1)]
    return pl.DataFrame(
        {"valid_date": days, "summer": [year] * len(days)}, schema={"valid_date": pl.Date, "summer": pl.Int16}
    )


class TestCalibrationMask:
    @pytest.mark.parametrize("year", [2024, 2025])
    def test_september_is_exactly_the_30_days_of_september(self, year: int) -> None:
        rows = season(year)
        mask = calibration_mask(rows, "september")
        assert mask.dtype == pl.Boolean
        assert len(mask) == rows.height
        chosen = rows.filter(mask)["valid_date"]
        assert chosen.min() == date(year, 9, 1)
        assert chosen.max() == date(year, 9, 30)
        assert chosen.len() == 30
        assert not rows.filter(mask)["valid_date"].is_between(date(year, 5, 15), date(year, 8, 31)).any()
        assert mask.sum() == 30

    @pytest.mark.parametrize("year", [2024, 2025])
    def test_weeks_are_summer_days_22_28_50_56_78_84_106_112(self, year: int) -> None:
        rows = season(year)
        mask = calibration_mask(rows, "weeks_4_8_12_16")
        assert mask.sum() == 28, "exactly 28 days per summer"
        start = date(year, 5, 15)  # summer day 1
        windows = [(22, 28), (50, 56), (78, 84), (106, 112)]
        expected = {start + timedelta(days=d - 1) for first, last in windows for d in range(first, last + 1)}
        assert set(rows.filter(mask)["valid_date"].to_list()) == expected
        # first and last day of each window
        got = set(rows.filter(mask)["valid_date"].to_list())
        for first, last in windows:
            assert start + timedelta(days=first - 1) in got
            assert start + timedelta(days=last - 1) in got
            assert start + timedelta(days=first - 2) not in got
            assert start + timedelta(days=last) not in got
        assert date(year, 6, 5) in got  # day 22 is 15 May + 21 days
        assert date(year, 6, 11) in got  # day 28 is 15 May + 27 days

    def test_weeks_use_each_rows_own_summer_year(self) -> None:
        both = pl.concat([season(2024), season(2025)])
        mask = calibration_mask(both, "weeks_4_8_12_16")
        assert mask.sum() == 56
        for year in (2024, 2025):
            assert both.filter(mask & (pl.col("summer") == year)).height == 28

    def test_a_row_dated_outside_its_summer_year_is_not_selected(self) -> None:
        rows = pl.DataFrame(
            {"valid_date": [date(2025, 6, 5), date(2025, 6, 5)], "summer": [2025, 2024]},
            schema={"valid_date": pl.Date, "summer": pl.Int16},
        )
        assert calibration_mask(rows, "weeks_4_8_12_16").to_list() == [True, False]

    def test_week_16_reaches_into_september_by_three_days(self) -> None:
        # Summer day 112 is 15 May + 111 days = 3 September: the two windows share 1-3 September, and the weeks window
        # lies inside the fit period (15 May-31 Aug) for 25 of its 28 days. A caller that fits on "not calibration"
        # must also keep September out of the fit set (the pre-registered training period ends on 31 August).
        rows = season(2025)
        september = calibration_mask(rows, "september")
        weeks = calibration_mask(rows, "weeks_4_8_12_16")
        shared = rows.filter(september & weeks)["valid_date"].to_list()
        assert shared == [date(2025, 9, 1), date(2025, 9, 2), date(2025, 9, 3)]
        in_fit_period = rows.filter(weeks)["valid_date"].is_between(date(2025, 5, 15), date(2025, 8, 31))
        assert in_fit_period.sum() == 25

    def test_null_dates_are_not_selected(self) -> None:
        rows = pl.DataFrame(
            {"valid_date": [None, date(2025, 9, 3)], "summer": [2025, 2025]},
            schema={"valid_date": pl.Date, "summer": pl.Int16},
        )
        assert calibration_mask(rows, "september").to_list() == [False, True]
        assert calibration_mask(rows, "weeks_4_8_12_16").to_list() == [False, True]  # 3 September is summer day 112

    def test_bad_inputs_raise(self) -> None:
        rows = season(2025)
        with pytest.raises(ValueError, match="valid_date"):
            calibration_mask(rows.drop("valid_date"), "september")
        with pytest.raises(ValueError, match="summer"):
            calibration_mask(rows.drop("summer"), "weeks_4_8_12_16")
        with pytest.raises(ValueError, match="Date"):
            calibration_mask(rows.with_columns(pl.col("valid_date").cast(pl.String())), "september")
        with pytest.raises(ValueError, match="window"):
            calibration_mask(rows, "october")  # type: ignore[arg-type]


class TestFitMask:
    """R27: fit rows are 15 May-31 August of their own summer and never calibration rows (pre-registration 2.3, L7)."""

    @pytest.mark.parametrize("window", ["september", "weeks_4_8_12_16"])
    @pytest.mark.parametrize("year", [2024, 2025])
    def test_fit_set_lies_inside_the_training_period_and_is_disjoint_from_calibration(
        self, window: CalibrationWindow, year: int
    ) -> None:
        rows = season(year)
        fit = fit_mask(rows, window)
        calibration = calibration_mask(rows, window)
        assert fit.dtype == pl.Boolean
        assert len(fit) == rows.height
        assert not (fit & calibration).any(), "a row is never both a fit row and a calibration row (L7)"
        fitted: list[date] = rows.filter(fit)["valid_date"].to_list()
        assert min(fitted) >= date(year, 5, 15)
        assert max(fitted) <= date(year, 8, 31)
        # nothing in the period is lost except the calibration rows that fall inside it
        in_period = rows["valid_date"].is_between(date(year, 5, 15), date(year, 8, 31))
        assert fit.sum() == (in_period & ~calibration).sum()

    def test_september_window_fits_on_all_of_the_period(self) -> None:
        rows = season(2025)
        assert fit_mask(rows, "september").sum() == 109  # 15 May to 31 August is 17 + 30 + 31 + 31 = 109 days

    def test_weeks_window_removes_its_28_days_from_the_fit_set_and_leaves_september_unused(self) -> None:
        rows = season(2025)
        fit = fit_mask(rows, "weeks_4_8_12_16")
        calibration = calibration_mask(rows, "weeks_4_8_12_16")
        assert fit.sum() == 109 - 25  # 25 of the 28 calibration days lie inside 15 May-31 Aug
        september = rows["valid_date"].dt.month() == 9
        assert not (fit & september).any(), "September never trains"
        unused = ~fit & ~calibration
        assert (unused & september).sum() == 27  # 30 September days, 3 of them calibration days (1-3 September)

    def test_each_rows_own_summer_year_decides(self) -> None:
        rows = pl.DataFrame(
            {"valid_date": [date(2025, 6, 1), date(2025, 6, 1), None], "summer": [2025, 2024, 2025]},
            schema={"valid_date": pl.Date, "summer": pl.Int16},
        )
        assert fit_mask(rows, "september").to_list() == [True, False, False]

    def test_bad_inputs_raise(self) -> None:
        rows = season(2025)
        with pytest.raises(ValueError, match="summer"):
            fit_mask(rows.drop("summer"), "september")
        with pytest.raises(ValueError, match="valid_date"):
            fit_mask(rows.drop("valid_date"), "september")
        with pytest.raises(ValueError, match="window"):
            fit_mask(rows, "october")  # type: ignore[arg-type]


def test_domain_names_are_reexported_unchanged() -> None:
    # ml.conformal keeps the import path of Task 8; the objects are the domain module's, not copies
    assert ConformalOffsets is domain_conformal.ConformalOffsets
    assert apply_offsets is domain_conformal.apply_offsets
    assert stratum_key is domain_conformal.stratum_key
