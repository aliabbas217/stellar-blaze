"""The moving-block bootstrap over UTC days (pre-registration section 8).

A score is a ratio of sums: the total of a per-day ``value`` over the total of a per-day ``weight`` (for example the
sum of absolute errors over the number of scored rows). The frame passed in has one row per UTC date; a resampled day
carries every station and hour of that day, which keeps the cross-station correlation.

Resampling, per replicate and per season:

* a season is a run of consecutive UTC dates (the dev data has two non-contiguous summers, an optional integer
  ``season`` column separates them; without the column all days are one season);
* blocks of ``block_days`` consecutive days are drawn by a uniform start among that season's days, circular within the
  season (a block starting near the end wraps to the season's first day) and never across seasons;
* ``ceil(season_length / block_days)`` blocks are concatenated and truncated to the season length;
* the statistic is the ratio of sums over all seasons pooled.

A day with no scored rows must still be a row (``weight`` 0): a gap or a duplicate day raises rather than being guessed
at. The result is a 95% percentile interval by default. ``paired_block_bootstrap`` resamples two frames on the very
same block starts and returns the interval of the difference. Everything is vectorized over the replicates.
"""

import math
from dataclasses import dataclass
from itertools import pairwise
from typing import Final

import numpy as np
import polars as pl

from stellar_blaze.domain.forecast.grid import F64

__all__ = ["DEFAULT_SEED", "Interval", "block_bootstrap", "paired_block_bootstrap"]

DEFAULT_SEED: Final = 20261112
"""The pre-registered bootstrap seed (section 8)."""

_DAY: Final = "day"
_SEASON: Final = "season"
_ONE_DAY: Final = np.timedelta64(1, "D")


@dataclass(frozen=True)
class Interval:
    """A bootstrap interval.

    Attributes:
        estimate: The statistic on the original data (for a paired comparison, ``a - b``).
        lo: The lower end of the percentile interval.
        hi: The upper end of the percentile interval.
        n_days: The number of days in the data (rows of ``daily``).
        n_boot: The number of bootstrap replicates used.
    """

    estimate: float
    lo: float
    hi: float
    n_days: int
    n_boot: int


@dataclass(frozen=True)
class _Layout:
    """The days of one frame sorted by (season, day): the sorted frame and each season's half-open row range."""

    frame: pl.DataFrame
    seasons: tuple[tuple[int, int], ...]

    @property
    def keys(self) -> pl.DataFrame:
        return self.frame.select(_SEASON, _DAY)


def _require_column(daily: pl.DataFrame, name: str, role: str) -> None:
    if name not in daily.columns:
        raise ValueError(f"daily is missing the {role} column {name!r} (columns: {daily.columns})")


def _layout(daily: pl.DataFrame, *, value: str, weight: str) -> tuple[_Layout, F64]:
    """Validate ``daily`` and return its layout and the ``(n_days, 2)`` array of values and weights in that order."""
    _require_column(daily, _DAY, "day")
    _require_column(daily, value, "value")
    _require_column(daily, weight, "weight")
    if daily.height == 0:
        raise ValueError("daily has no rows")
    if daily.schema[_DAY] != pl.Date:
        raise ValueError(f"column {_DAY!r} must be a Date (the UTC date), got {daily.schema[_DAY]}")
    if _SEASON in daily.columns:
        if not daily.schema[_SEASON].is_integer():
            raise ValueError(f"column {_SEASON!r} must be an integer, got {daily.schema[_SEASON]}")
        frame = daily.select(_SEASON, _DAY, value, weight)
    else:
        frame = daily.select(pl.lit(0, dtype=pl.Int64).alias(_SEASON), _DAY, value, weight)
    for name in (_SEASON, _DAY, value, weight):
        if frame[name].null_count():
            raise ValueError(f"column {name!r} has {frame[name].null_count()} null value(s)")
    for name in (value, weight):
        column = frame[name].cast(pl.Float64)
        if not column.is_finite().all():
            raise ValueError(f"column {name!r} must be finite (no NaN or infinity)")
    if (frame[weight] < 0).any():
        raise ValueError(f"column {weight!r} (a count of rows) must not be negative")
    if frame[weight].cast(pl.Float64).sum() == 0.0:
        raise ValueError(f"column {weight!r} sums to zero: there is nothing to score")

    frame = frame.sort(_SEASON, _DAY)
    seasons = frame[_SEASON].to_numpy()
    days = frame[_DAY].to_numpy().astype("datetime64[D]")
    cuts = [0, *(np.flatnonzero(np.diff(seasons)) + 1).tolist(), frame.height]
    ranges: list[tuple[int, int]] = []
    for begin, end in pairwise(cuts):
        steps = np.diff(days[begin:end])
        bad = np.flatnonzero(steps != _ONE_DAY)
        if bad.size:
            first = int(bad[0])
            before, after = days[begin + first], days[begin + first + 1]
            kind = "duplicate day" if steps[first] == np.timedelta64(0, "D") else "gap"
            raise ValueError(
                f"season {int(seasons[begin])} is not a complete run of consecutive UTC dates: {kind} between {before} "
                f"and {after} (a day with no scored rows must be a row with weight 0)"
            )
        ranges.append((begin, end))
    matrix = np.column_stack([frame[value].cast(pl.Float64).to_numpy(), frame[weight].cast(pl.Float64).to_numpy()])
    return _Layout(frame, tuple(ranges)), matrix


def _check_parameters(block_days: int, n_boot: int, confidence_level: float) -> None:
    if block_days < 1:
        raise ValueError(f"block_days must be at least 1, got {block_days}")
    if n_boot < 1:
        raise ValueError(f"n_boot must be at least 1, got {n_boot}")
    if not 0.0 < confidence_level < 1.0:
        raise ValueError(f"confidence_level must be in (0, 1), got {confidence_level}")


def _replicate_sums(layout: _Layout, columns: F64, *, block_days: int, n_boot: int, seed: int) -> F64:
    """Per-replicate sums of every column over the resampled days, shape ``(n_boot, n_columns)``.

    Block starts are drawn once per season and applied to all columns, so columns (for example the two frames of a
    paired comparison) are resampled on identical blocks.
    """
    rng = np.random.default_rng(seed)
    offsets = np.arange(block_days)
    totals = np.zeros((n_boot, columns.shape[1]))
    for begin, end in layout.seasons:
        length = end - begin
        n_blocks = math.ceil(length / block_days)
        starts = rng.integers(0, length, size=(n_boot, n_blocks))
        picked = (starts[:, :, None] + offsets[None, None, :]) % length  # circular within the season
        rows = begin + picked.reshape(n_boot, n_blocks * block_days)[:, :length]  # truncated to the season length
        totals += columns[rows].sum(axis=1)
    return totals


def _percentile_interval(replicates: F64, confidence_level: float) -> tuple[float, float]:
    tail = 100.0 * (1.0 - confidence_level) / 2.0
    lo, hi = np.percentile(replicates, [tail, 100.0 - tail])
    return float(lo), float(hi)


def _ratio(sums: F64, *, numerator: int, denominator: int) -> F64:
    weights = sums[..., denominator]
    if np.any(weights == 0.0):
        raise ValueError(
            "a bootstrap replicate resampled only days without scored rows (weight 0): the ratio is undefined; "
            "the data are too sparse for this block length"
        )
    return np.asarray(sums[..., numerator] / weights, dtype=np.float64)


def block_bootstrap(
    daily: pl.DataFrame,
    *,
    value: str,
    weight: str,
    block_days: int = 7,
    n_boot: int = 2000,
    seed: int = DEFAULT_SEED,
    confidence_level: float = 0.95,
) -> Interval:
    """A moving-block bootstrap interval of the ratio of sums ``sum(value) / sum(weight)`` over UTC days.

    Args:
        daily: One row per UTC date: ``day`` (``pl.Date``), the per-day sum ``value``, the per-day count ``weight``
            and, optionally, an integer ``season`` (blocks never straddle seasons). Rows may come in any order.
        value: Name of the per-day sum column.
        weight: Name of the per-day count column (non-negative; a day with no scored rows has 0).
        block_days: Length of a block of consecutive days (7 in the pre-registration).
        n_boot: Number of replicates (2,000).
        seed: Seed of ``numpy.random.default_rng`` (20261112).
        confidence_level: Coverage of the percentile interval (0.95).

    Returns:
        The estimate on the original data and its percentile interval.

    Raises:
        ValueError: A column is missing, mistyped, null or non-finite; a season has a gap or a duplicate day; every
            weight is zero; a replicate resampled no weight at all; or a parameter is out of range.
    """
    _check_parameters(block_days, n_boot, confidence_level)
    layout, matrix = _layout(daily, value=value, weight=weight)
    sums = _replicate_sums(layout, matrix, block_days=block_days, n_boot=n_boot, seed=seed)
    replicates = _ratio(sums, numerator=0, denominator=1)
    lo, hi = _percentile_interval(replicates, confidence_level)
    estimate = float(_ratio(matrix.sum(axis=0), numerator=0, denominator=1))
    return Interval(estimate=estimate, lo=lo, hi=hi, n_days=layout.frame.height, n_boot=n_boot)


def paired_block_bootstrap(
    daily_a: pl.DataFrame,
    daily_b: pl.DataFrame,
    *,
    value: str,
    weight: str,
    block_days: int = 7,
    n_boot: int = 2000,
    seed: int = DEFAULT_SEED,
    confidence_level: float = 0.95,
) -> Interval:
    """The interval of ``a - b`` (ratio of sums each) with both resampled on the same blocks.

    The two frames must hold the same days (and the same seasons): the same start of every block is applied to both,
    so what the two series share day to day cancels in the difference. Each series uses its own ``weight`` (the scored
    rows of model and baseline may differ).

    Args:
        daily_a: The first series, as for ``block_bootstrap``.
        daily_b: The second (reference) series.
        value: Name of the per-day sum column, in both frames.
        weight: Name of the per-day count column, in both frames.
        block_days: Length of a block of consecutive days.
        n_boot: Number of replicates.
        seed: Seed of ``numpy.random.default_rng``.
        confidence_level: Coverage of the percentile interval.

    Returns:
        ``estimate`` is the difference on the original data; ``lo`` and ``hi`` bound the difference.

    Raises:
        ValueError: As for ``block_bootstrap``, or the frames do not have the same days and seasons.
    """
    _check_parameters(block_days, n_boot, confidence_level)
    layout_a, matrix_a = _layout(daily_a, value=value, weight=weight)
    layout_b, matrix_b = _layout(daily_b, value=value, weight=weight)
    if layout_a.seasons != layout_b.seasons or not layout_a.keys.equals(layout_b.keys):
        raise ValueError("daily_a and daily_b must have the same days (and the same seasons)")
    sums = _replicate_sums(layout_a, np.hstack([matrix_a, matrix_b]), block_days=block_days, n_boot=n_boot, seed=seed)
    replicates = _ratio(sums[:, 0:2], numerator=0, denominator=1) - _ratio(sums[:, 2:4], numerator=0, denominator=1)
    lo, hi = _percentile_interval(replicates, confidence_level)
    estimate = float(
        _ratio(matrix_a.sum(axis=0), numerator=0, denominator=1)
        - _ratio(matrix_b.sum(axis=0), numerator=0, denominator=1)
    )
    return Interval(estimate=estimate, lo=lo, hi=hi, n_days=layout_a.frame.height, n_boot=n_boot)
