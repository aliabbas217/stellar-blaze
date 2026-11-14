"""The moving-block bootstrap over UTC days (pre-registration section 8; R11 seasons)."""

from datetime import date, timedelta

import numpy as np
import polars as pl
import pytest

from stellar_blaze.ml.bootstrap import Interval, block_bootstrap, paired_block_bootstrap

pytestmark = pytest.mark.unit

_START = date(2024, 7, 1)


def _daily(
    values: list[float] | np.ndarray,
    weights: list[float] | np.ndarray | None = None,
    *,
    season: int | None = None,
    start: date = _START,
) -> pl.DataFrame:
    n = len(values)
    frame = pl.DataFrame(
        {
            "day": [start + timedelta(days=i) for i in range(n)],
            "value": np.asarray(values, dtype=np.float64),
            "weight": np.ones(n) if weights is None else np.asarray(weights, dtype=np.float64),
        }
    )
    return frame if season is None else frame.with_columns(pl.lit(season, dtype=pl.Int64).alias("season"))


def _ar1(n: int, phi: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    noise = rng.standard_normal(n)
    out = np.empty(n)
    out[0] = noise[0]
    for i in range(1, n):
        out[i] = phi * out[i - 1] + noise[i]
    return out


def _two_seasons(first: pl.DataFrame, second: pl.DataFrame) -> pl.DataFrame:
    return pl.concat(
        [
            first.with_columns(pl.lit(2024, dtype=pl.Int64).alias("season")),
            second.with_columns(pl.lit(2025, dtype=pl.Int64).alias("season")),
        ]
    )


# ------------------------------------------------------------------------------------------- unpaired


def test_block_bootstrap_returns_an_interval_around_the_ratio_of_sums() -> None:
    daily = _daily(_ar1(120, 0.0, 1) + 5.0, np.full(120, 4.0))
    interval = block_bootstrap(daily, value="value", weight="weight")
    assert isinstance(interval, Interval)
    assert interval.estimate == pytest.approx(float(daily["value"].to_numpy().sum() / daily["weight"].to_numpy().sum()))
    assert interval.lo < interval.estimate < interval.hi
    assert (interval.n_days, interval.n_boot) == (120, 2000)


def test_block_bootstrap_deterministic() -> None:
    daily = _daily(_ar1(100, 0.3, 2))
    first = block_bootstrap(daily, value="value", weight="weight", n_boot=300)
    again = block_bootstrap(daily, value="value", weight="weight", n_boot=300)
    other = block_bootstrap(daily, value="value", weight="weight", n_boot=300, seed=1)
    assert first == again
    assert other != first


def test_block_bootstrap_default_seed_is_the_preregistered_one() -> None:
    daily = _daily(_ar1(100, 0.3, 2))
    assert block_bootstrap(daily, value="value", weight="weight") == block_bootstrap(
        daily, value="value", weight="weight", seed=20261112, n_boot=2000, block_days=7
    )


def test_block_bootstrap_does_not_depend_on_row_order() -> None:
    daily = _daily(_ar1(60, 0.4, 3))
    shuffled = daily.sample(fraction=1.0, shuffle=True, seed=0)
    assert block_bootstrap(shuffled, value="value", weight="weight") == block_bootstrap(
        daily, value="value", weight="weight"
    )


def test_block_bootstrap_wider_than_iid_on_ar1() -> None:
    daily = _daily(_ar1(560, 0.5, 4))
    blocks = block_bootstrap(daily, value="value", weight="weight", block_days=7)
    iid = block_bootstrap(daily, value="value", weight="weight", block_days=1)
    # Positive autocorrelation inflates the variance of a mean by about (1 + phi) / (1 - phi) = 3 (width x 1.7).
    assert (blocks.hi - blocks.lo) > 1.3 * (iid.hi - iid.lo)


def test_block_bootstrap_estimate_is_the_ratio_of_sums_not_the_mean_of_ratios() -> None:
    # Day 0 has 100 rows with total 100; day 1 has 1 row with total 0: the pooled ratio is 100/101, not 0.5.
    interval = block_bootstrap(_daily([100.0, 0.0], [100.0, 1.0]), value="value", weight="weight", n_boot=50)
    assert interval.estimate == pytest.approx(100.0 / 101.0)


def test_a_zero_weight_day_is_a_valid_day_with_no_rows() -> None:
    values = np.array([1.0, 0.0, 3.0, 2.0, 1.0, 5.0, 2.0, 2.0, 0.0, 1.0])
    weights = np.array([1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0])
    interval = block_bootstrap(_daily(values, weights), value="value", weight="weight", block_days=3, n_boot=100)
    assert interval.estimate == pytest.approx(values.sum() / weights.sum())
    assert interval.n_days == 10


def test_block_longer_than_season_is_circular_not_clipped() -> None:
    """With one block as long as the season every replicate is a rotation of the whole season: no spread at all."""
    daily = _daily([1.0, 5.0, 2.0, 9.0, 4.0, 3.0, 8.0, 0.0, 7.0, 6.0])
    interval = block_bootstrap(daily, value="value", weight="weight", block_days=10, n_boot=200)
    assert interval.lo == pytest.approx(interval.estimate)
    assert interval.hi == pytest.approx(interval.estimate)


def test_blocks_never_straddle_seasons() -> None:
    """Season 2024 is all 0 over 20 days, season 2025 all 10 over 10 days: any pooled resample would vary."""
    first, second = _daily(np.zeros(20)), _daily(np.full(10, 10.0), start=date(2025, 7, 1))
    interval = block_bootstrap(_two_seasons(first, second), value="value", weight="weight", n_boot=300)
    # Each season is resampled to its own length, so every replicate has exactly 10 days worth 10: 100 / 30.
    assert interval.estimate == pytest.approx(100.0 / 30.0)
    assert interval.lo == pytest.approx(100.0 / 30.0)
    assert interval.hi == pytest.approx(100.0 / 30.0)
    assert interval.n_days == 30


def test_two_summers_with_a_gap_between_them_are_accepted() -> None:
    first = _daily(_ar1(40, 0.2, 5))
    second = _daily(_ar1(30, 0.2, 6), start=date(2025, 6, 20))
    interval = block_bootstrap(_two_seasons(first, second), value="value", weight="weight", n_boot=100)
    assert interval.n_days == 70


def test_seasons_without_the_column_are_one_season_so_a_gap_raises() -> None:
    first = _daily([1.0] * 10)
    second = _daily([1.0] * 10, start=date(2025, 7, 1))
    with pytest.raises(ValueError, match="gap"):
        block_bootstrap(pl.concat([first, second]), value="value", weight="weight")


def test_a_gap_inside_a_season_raises() -> None:
    daily = _daily(np.arange(10.0)).filter(pl.col("day") != _START + timedelta(days=4))
    with pytest.raises(ValueError, match=r"gap.*2024-07-04.*2024-07-06"):
        block_bootstrap(daily, value="value", weight="weight")


def test_a_duplicate_day_raises() -> None:
    daily = _daily(np.arange(10.0))
    with pytest.raises(ValueError, match=r"duplicate.*2024-07-01"):
        block_bootstrap(pl.concat([daily, daily.head(1)]), value="value", weight="weight")


def test_an_all_zero_weight_raises() -> None:
    with pytest.raises(ValueError, match="weight"):
        block_bootstrap(_daily(np.zeros(10), np.zeros(10)), value="value", weight="weight")


def test_a_negative_weight_raises() -> None:
    with pytest.raises(ValueError, match="weight"):
        block_bootstrap(_daily(np.ones(10), [1.0] * 9 + [-1.0]), value="value", weight="weight")


@pytest.mark.parametrize("column", ["value", "weight"])
@pytest.mark.parametrize("bad", [float("nan"), float("inf")])
def test_non_finite_raises(column: str, bad: float) -> None:
    daily = _daily(np.ones(10)).with_columns(
        pl.when(pl.col("day") == _START + timedelta(days=3)).then(bad).otherwise(pl.col(column)).alias(column)
    )
    with pytest.raises(ValueError, match=rf"{column}.*finite"):
        block_bootstrap(daily, value="value", weight="weight")


def test_a_null_raises() -> None:
    daily = _daily(np.ones(10)).with_columns(pl.when(pl.col("day") > _START).then(pl.col("value")).alias("value"))
    with pytest.raises(ValueError, match=r"value.*null"):
        block_bootstrap(daily, value="value", weight="weight")


def test_missing_column_and_wrong_dtypes_raise() -> None:
    daily = _daily(np.ones(10))
    with pytest.raises(ValueError, match="missing"):
        block_bootstrap(daily.drop("weight"), value="value", weight="weight")
    with pytest.raises(ValueError, match=r"day.*Date"):
        block_bootstrap(daily.with_columns(pl.col("day").cast(pl.String)), value="value", weight="weight")
    with pytest.raises(ValueError, match=r"season.*integer"):
        block_bootstrap(daily.with_columns(season=pl.lit("a")), value="value", weight="weight")


def test_empty_frame_and_bad_parameters_raise() -> None:
    daily = _daily(np.ones(10))
    with pytest.raises(ValueError, match="no rows"):
        block_bootstrap(daily.head(0), value="value", weight="weight")
    with pytest.raises(ValueError, match="block_days"):
        block_bootstrap(daily, value="value", weight="weight", block_days=0)
    with pytest.raises(ValueError, match="n_boot"):
        block_bootstrap(daily, value="value", weight="weight", n_boot=0)
    with pytest.raises(ValueError, match="confidence_level"):
        block_bootstrap(daily, value="value", weight="weight", confidence_level=1.0)


def test_a_resample_with_no_weight_raises_instead_of_dividing_by_zero() -> None:
    values = np.zeros(10)
    weights = np.array([1.0] + [0.0] * 9)
    with pytest.raises(ValueError, match="replicate"):
        block_bootstrap(_daily(values, weights), value="value", weight="weight", block_days=1, n_boot=2000)


# ------------------------------------------------------------------------ golden values from a loop reference


def _reference_starts(season_lengths: list[int], *, block_days: int, n_boot: int, seed: int) -> list[np.ndarray]:
    """The block starts per season, drawn in the pre-registered order: one (n_boot, n_blocks) matrix per season."""
    rng = np.random.default_rng(seed)
    return [
        rng.integers(0, length, size=(n_boot, -(-length // block_days)))  # ceil(length / block_days) blocks
        for length in season_lengths
    ]


def _reference_ratio(
    seasons: list[tuple[list[float], list[float]]], starts: list[np.ndarray], replicate: int, block_days: int
) -> float:
    """Ratio of pooled sums for one replicate, resampled day by day in plain Python loops."""
    total_value = total_weight = 0.0
    for (values, weights), season_starts in zip(seasons, starts, strict=True):
        length = len(values)
        days: list[int] = []
        for start in season_starts[replicate]:
            days.extend((int(start) + offset) % length for offset in range(block_days))  # circular within the season
        for day in days[:length]:  # truncated to the season length
            total_value += values[day]
            total_weight += weights[day]
    return total_value / total_weight


def _pooled(data: list[tuple[list[float], list[float]]]) -> float:
    return sum(sum(values) for values, _ in data) / sum(sum(weights) for _, weights in data)


def _reference_interval(
    seasons: list[tuple[list[float], list[float]]],
    others: list[tuple[list[float], list[float]]] | None,
    *,
    block_days: int,
    n_boot: int,
    seed: int,
    level: float = 0.95,
) -> tuple[float, float, float]:
    starts = _reference_starts([len(values) for values, _ in seasons], block_days=block_days, n_boot=n_boot, seed=seed)
    draws = []
    for replicate in range(n_boot):
        ratio = _reference_ratio(seasons, starts, replicate, block_days)
        if others is not None:
            ratio -= _reference_ratio(others, starts, replicate, block_days)
        draws.append(ratio)
    tail = (1.0 - level) / 2.0 * 100.0
    lo, hi = np.percentile(draws, [tail, 100.0 - tail])
    estimate = _pooled(seasons) - (_pooled(others) if others is not None else 0.0)
    return float(lo), float(hi), float(estimate)


# Two seasons of 7 and 5 days (not a multiple of the 3-day block, so the truncation rule matters), distinct values.
_SEASON_A = ([4.0, 1.0, 7.0, 2.0, 9.0, 3.0, 5.0], [2.0, 1.0, 3.0, 1.0, 4.0, 2.0, 2.0])
_SEASON_B = ([6.0, 0.0, 8.0, 1.0, 2.0], [3.0, 0.0, 2.0, 1.0, 1.0])
_OTHER_A = ([2.0, 3.0, 1.0, 5.0, 4.0, 2.0, 6.0], [2.0, 1.0, 3.0, 1.0, 4.0, 2.0, 2.0])
_OTHER_B = ([1.0, 2.0, 3.0, 2.0, 1.0], [3.0, 0.0, 2.0, 1.0, 1.0])


def _frame(seasons: list[tuple[list[float], list[float]]]) -> pl.DataFrame:
    parts = [
        _daily(values, weights, start=date(2024 + k, 7, 1)).with_columns(pl.lit(k, dtype=pl.Int64).alias("season"))
        for k, (values, weights) in enumerate(seasons)
    ]
    return pl.concat(parts)


@pytest.mark.parametrize("level", [0.95, 0.80])
def test_block_bootstrap_matches_an_independent_loop_resample(level: float) -> None:
    """Pins the percentile level, the ceil() block count, the truncation, the circular wrap and the draw order."""
    seasons = [_SEASON_A, _SEASON_B]
    lo, hi, estimate = _reference_interval(seasons, None, block_days=3, n_boot=500, seed=42, level=level)
    got = block_bootstrap(
        _frame(seasons), value="value", weight="weight", block_days=3, n_boot=500, seed=42, confidence_level=level
    )
    assert got.estimate == pytest.approx(estimate, rel=1e-12)
    assert got.lo == pytest.approx(lo, rel=1e-12)
    assert got.hi == pytest.approx(hi, rel=1e-12)
    assert (got.n_days, got.n_boot) == (12, 500)


def test_the_default_level_is_the_95_percent_interval() -> None:
    lo, hi, _ = _reference_interval([_SEASON_A, _SEASON_B], None, block_days=3, n_boot=500, seed=42, level=0.95)
    got = block_bootstrap(
        _frame([_SEASON_A, _SEASON_B]), value="value", weight="weight", block_days=3, n_boot=500, seed=42
    )
    assert got.lo == pytest.approx(lo, rel=1e-12)
    assert got.hi == pytest.approx(hi, rel=1e-12)
    wider = _reference_interval([_SEASON_A, _SEASON_B], None, block_days=3, n_boot=500, seed=42, level=0.99)
    assert wider[0] < lo < hi < wider[1]  # the reference itself discriminates 95% from other levels


def test_paired_block_bootstrap_matches_an_independent_loop_resample() -> None:
    lo, hi, estimate = _reference_interval(
        [_SEASON_A, _SEASON_B], [_OTHER_A, _OTHER_B], block_days=3, n_boot=500, seed=42
    )
    got = paired_block_bootstrap(
        _frame([_SEASON_A, _SEASON_B]),
        _frame([_OTHER_A, _OTHER_B]),
        value="value",
        weight="weight",
        block_days=3,
        n_boot=500,
        seed=42,
    )
    assert got.estimate == pytest.approx(estimate, rel=1e-12)
    assert got.lo == pytest.approx(lo, rel=1e-12)
    assert got.hi == pytest.approx(hi, rel=1e-12)
    assert (got.n_days, got.n_boot) == (12, 500)


# --------------------------------------------------------------------------------------------- paired


def test_paired_uses_same_resamples() -> None:
    daily = _daily(_ar1(100, 0.4, 9) + 2.0, np.full(100, 6.0))
    interval = paired_block_bootstrap(daily, daily, value="value", weight="weight")
    assert interval == Interval(estimate=0.0, lo=0.0, hi=0.0, n_days=100, n_boot=2000)


def test_paired_constant_shift_gives_an_interval_around_it_that_excludes_zero() -> None:
    rng = np.random.default_rng(10)
    weights = rng.integers(80, 120, size=200).astype(np.float64)
    base = weights * (2.0 + 0.5 * _ar1(200, 0.5, 11))
    # a is b plus a shift of 0.3 per row, plus day-level noise in the paired difference.
    noise = 0.1 * rng.standard_normal(200)
    noise -= float(np.average(noise, weights=weights))  # the weighted mean shift is then exactly 0.3
    shifted = base + weights * (0.3 + noise)
    interval = paired_block_bootstrap(_daily(shifted, weights), _daily(base, weights), value="value", weight="weight")
    assert interval.estimate == pytest.approx(0.3)
    assert interval.lo < 0.3 < interval.hi
    assert interval.lo > 0.0
    assert interval.hi < 0.6


def test_paired_exact_constant_shift_has_a_degenerate_interval_at_the_shift() -> None:
    rng = np.random.default_rng(12)
    weights = rng.integers(50, 150, size=120).astype(np.float64)
    base = weights * rng.normal(size=120)
    interval = paired_block_bootstrap(
        _daily(base + 0.3 * weights, weights), _daily(base, weights), value="value", weight="weight"
    )
    assert interval.lo == pytest.approx(0.3, abs=1e-9)
    assert interval.hi == pytest.approx(0.3, abs=1e-9)


def test_paired_is_the_difference_a_minus_b() -> None:
    a, b = _daily(np.full(40, 3.0)), _daily(np.full(40, 1.0))
    assert paired_block_bootstrap(a, b, value="value", weight="weight", n_boot=50).estimate == pytest.approx(2.0)
    assert paired_block_bootstrap(b, a, value="value", weight="weight", n_boot=50).estimate == pytest.approx(-2.0)


def test_paired_is_narrower_than_the_unpaired_difference_of_two_correlated_series() -> None:
    """Sharing the blocks cancels the common day-to-day variation; independent resamples would not."""
    common = _ar1(300, 0.5, 13) * 3.0
    rng = np.random.default_rng(14)
    a = _daily(common + 0.5 + 0.1 * rng.standard_normal(300))
    b = _daily(common + 0.1 * rng.standard_normal(300))
    paired = paired_block_bootstrap(a, b, value="value", weight="weight")
    ia = block_bootstrap(a, value="value", weight="weight", seed=1)
    ib = block_bootstrap(b, value="value", weight="weight", seed=2)
    independent_width = float(np.hypot(ia.hi - ia.lo, ib.hi - ib.lo))
    assert (paired.hi - paired.lo) < 0.25 * independent_width


def test_paired_blocks_do_not_straddle_seasons() -> None:
    first, second = _daily(np.zeros(20)), _daily(np.full(10, 10.0), start=date(2025, 7, 1))
    a = _two_seasons(first, second)
    b = _two_seasons(first, second.with_columns(value=pl.col("value") - 1.0))
    interval = paired_block_bootstrap(a, b, value="value", weight="weight", n_boot=300)
    assert interval.lo == pytest.approx(10.0 / 30.0)
    assert interval.hi == pytest.approx(10.0 / 30.0)


def test_paired_requires_identical_days_and_seasons() -> None:
    a = _daily(np.ones(10))
    with pytest.raises(ValueError, match="same days"):
        paired_block_bootstrap(a, _daily(np.ones(10), start=_START + timedelta(days=1)), value="value", weight="weight")
    with pytest.raises(ValueError, match="same days"):
        paired_block_bootstrap(a, a.head(9), value="value", weight="weight")
    with pytest.raises(ValueError, match="same days"):
        paired_block_bootstrap(
            a.with_columns(season=pl.lit(1)), a.with_columns(season=pl.lit(2)), value="value", weight="weight"
        )
    with pytest.raises(ValueError, match="same days"):
        paired_block_bootstrap(a.with_columns(season=pl.lit(1)), a, value="value", weight="weight")


def test_paired_accepts_either_row_order() -> None:
    a = _daily(_ar1(50, 0.2, 15))
    b = _daily(_ar1(50, 0.2, 16))
    reference = paired_block_bootstrap(a, b, value="value", weight="weight")
    shuffled = paired_block_bootstrap(
        a.sample(fraction=1.0, shuffle=True, seed=1),
        b.sample(fraction=1.0, shuffle=True, seed=2),
        value="value",
        weight="weight",
    )
    assert shuffled == reference


def test_paired_uses_the_per_day_weights_of_each_series() -> None:
    """a and b may have different weights on the same day (different scored rows): each ratio uses its own."""
    a = _daily([10.0, 10.0], [10.0, 5.0])  # ratio 20 / 15
    b = _daily([4.0, 4.0], [2.0, 4.0])  # ratio 8 / 6
    interval = paired_block_bootstrap(a, b, value="value", weight="weight", block_days=1, n_boot=20)
    assert interval.estimate == pytest.approx(20.0 / 15.0 - 8.0 / 6.0)
