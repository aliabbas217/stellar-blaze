"""The quantile grid of a corrected forecast: the 19 levels, the 9 central pairs, the hour-blocks and the arithmetic.

A forecast distribution is carried as 19 quantiles at the levels 0.05, 0.10, ..., 0.95, one row of a ``(n, 19)`` array
per forecast. Between two levels the distribution is piecewise linear in the quantile function; outside 0.05 and 0.95 it
continues with the slope of the outermost segment. This module is numpy only.

Ties (equal neighboring quantiles, such as wind clipped at 0 or a corrector with no spread) make some segments
zero-width. Nothing here divides by a segment width that can be zero: ``cdf`` at a tied value is the mean of the tied
levels (the mid-rank), just below the tie it approaches the lowest tied level, just above it the highest, and a
zero-width outermost segment gives a step instead of an extension.
"""

from collections.abc import Mapping, Sequence
from enum import StrEnum
from types import MappingProxyType
from typing import Final

import numpy as np
from numpy.typing import NDArray

from stellar_blaze.domain.physics.types import F64  # NDArray[np.float64], the one alias the domain uses

__all__ = [
    "F64",
    "HEADLINE_LEADS",
    "HOUR_BLOCKS",
    "LEVELS",
    "MODELLED_HOURS_UTC",
    "MODEL_LEADS",
    "PAIRS",
    "REPORT_LEADS",
    "HourBlock",
    "apply_symmetric_offsets",
    "cdf",
    "exceedance_probability",
    "hour_block",
    "ppf",
    "sort_grid",
]

LEVELS: Final[tuple[float, ...]] = tuple(round(k * 0.05, 2) for k in range(1, 20))
"""The 19 quantile levels, 0.05 to 0.95 in steps of 0.05."""

PAIRS: Final[tuple[tuple[float, float], ...]] = tuple((LEVELS[i], LEVELS[len(LEVELS) - 1 - i]) for i in range(9))
"""The 9 central intervals as (lower level, upper level), from (0.05, 0.95) to (0.45, 0.55); the median is unpaired."""

MODELLED_HOURS_UTC: Final = range(2, 16)
"""The valid hours the corrector models (UTC 02-15, which is 06:00-19:59 GST; one calendar date in UTC and GST)."""

MODEL_LEADS: Final = range(1, 8)
"""The leads the corrector models, in days before the valid time."""

HEADLINE_LEADS: Final[tuple[int, ...]] = (1, 2, 3)
REPORT_LEADS: Final[tuple[int, ...]] = (1, 2, 3, 5, 7)

_N = len(LEVELS)
_MEDIAN: Final = _N // 2
_LEVEL_STEP: Final = 0.05


class HourBlock(StrEnum):
    """The three blocks of modelled UTC hours that coverage and calibration are reported by."""

    EARLY = "early"
    PEAK = "peak"
    LATE = "late"


HOUR_BLOCKS: Final[Mapping[HourBlock, range]] = MappingProxyType(
    {HourBlock.EARLY: range(2, 6), HourBlock.PEAK: range(6, 11), HourBlock.LATE: range(11, 16)}
)


def hour_block(hour_utc: int) -> HourBlock:
    """The hour-block of a modelled UTC hour.

    Raises:
        ValueError: The hour is outside 2 to 15 (``MODELLED_HOURS_UTC``).
    """
    for block, hours in HOUR_BLOCKS.items():
        if hour_utc in hours:
            return block
    first, last = MODELLED_HOURS_UTC[0], MODELLED_HOURS_UTC[-1]
    raise ValueError(f"hour {hour_utc} UTC is not a modelled hour ({first} to {last})")


def _checked_grid(grid: F64) -> F64:
    array = np.asarray(grid, dtype=np.float64)
    if array.ndim != 2 or array.shape[1] != _N:
        raise ValueError(f"a quantile grid has shape (n, {_N}), got {array.shape}")
    return array


def _usable(array: F64) -> tuple[F64, NDArray[np.bool_]]:
    """The grid with every row that holds a NaN or an infinity replaced by zeros, and the mask of those rows.

    The arithmetic below runs on the clean copy (so it cannot warn on ``inf - inf`` or ``nan`` comparisons) and the
    caller turns the masked rows into all-NaN rows at the end.
    """
    bad = ~np.isfinite(array).all(axis=1, keepdims=True)
    return np.where(bad, 0.0, array), bad


def _require_sorted(clean: F64) -> None:
    if np.any(np.diff(clean, axis=1) < 0.0):
        raise ValueError("the quantile grid must be sorted along its levels (use sort_grid first)")


def sort_grid(grid: F64) -> F64:
    """Each row of ``(n, 19)`` sorted ascending, as a new array (quantile crossing repaired by rearrangement).

    A row that holds a NaN or an infinity is returned as an all-NaN row: sorting would move the NaN to the end and
    shift every later level, which would look like a grid.

    Raises:
        ValueError: ``grid`` does not have 19 columns.
    """
    clean, bad = _usable(_checked_grid(grid))
    return np.where(bad, np.nan, np.sort(clean, axis=1))


def apply_symmetric_offsets(grid: F64, offsets: Sequence[float]) -> F64:
    """Widen (or narrow) each central interval of a sorted grid by its offset: ``lo - q`` and ``hi + q``.

    ``offsets`` is aligned with ``PAIRS``: ``offsets[i]`` moves the quantiles at ``PAIRS[i]``. The median is never
    changed. A negative offset narrows the interval, but never past the median (the lower quantile stops at it, so does
    the upper one): an interval cannot be thinner than the median it is centered on. The result is re-sorted, because
    offsets that differ between pairs can make neighboring quantiles cross.

    A row that holds a NaN or an infinity, and every row if any offset is NaN or infinite, comes back as an all-NaN row
    (never a partly shifted one).

    Args:
        grid: Sorted quantiles, shape ``(n, 19)``.
        offsets: Nine offsets, one per pair of ``PAIRS``, in the grid's units.

    Raises:
        ValueError: The grid does not have 19 columns or is not sorted, or there are not exactly 9 offsets.
    """
    array, bad = _usable(_checked_grid(grid))
    q = np.asarray(offsets, dtype=np.float64)
    if q.shape != (len(PAIRS),):
        raise ValueError(f"expected {len(PAIRS)} offsets, one per pair, got shape {q.shape}")
    _require_sorted(array)
    if not np.isfinite(q).all():
        return np.full(array.shape, np.nan)
    out = array.copy()
    median = array[:, [_MEDIAN]]
    out[:, :_MEDIAN] = np.minimum(array[:, :_MEDIAN] - q, median)
    out[:, _MEDIAN + 1 :] = np.maximum(array[:, _MEDIAN + 1 :][:, ::-1] + q, median)[:, ::-1]
    return np.where(bad, np.nan, np.sort(out, axis=1))


def _rows_of_values(grid: F64, values: F64, what: str) -> tuple[F64, bool]:
    """``values`` as ``(n, k)`` (and whether it came as ``(n,)``), checked against the grid's ``n`` rows."""
    array = np.asarray(values, dtype=np.float64)
    if array.ndim not in (1, 2) or array.shape[0] != grid.shape[0]:
        raise ValueError(f"{what} needs one row per grid row ({grid.shape[0]} rows), got shape {array.shape}")
    return (array[:, None], True) if array.ndim == 1 else (array, False)


def ppf(grid: F64, u: F64) -> F64:
    """The quantile function: the value at probability ``u``, linear between levels and extended beyond them.

    Args:
        grid: Sorted quantiles, shape ``(n, 19)``.
        u: Probabilities in [0, 1], shape ``(n,)`` (one per row) or ``(n, k)`` (``k`` per row). NaN stays NaN.

    Returns:
        An array with the shape of ``u``. Below 0.05 and above 0.95 the line through the outermost segment is extended
        (a zero-width outermost segment extends as a constant). A grid row holding a NaN or an infinity (infinities
        are not supported) gives NaN.

    Raises:
        ValueError: A shape is wrong, the grid is not sorted, or a probability is outside [0, 1].
    """
    array, bad = _usable(_checked_grid(grid))
    _require_sorted(array)
    probabilities, flat = _rows_of_values(array, u, "u")
    if np.any((probabilities < 0.0) | (probabilities > 1.0)):
        raise ValueError("probabilities must lie in [0, 1]")
    missing = np.isnan(probabilities)
    position = np.where(missing, 0.5, probabilities) / _LEVEL_STEP - 1.0  # 0 at level 0.05, 18 at level 0.95
    segment = np.clip(np.floor(position), 0, _N - 2).astype(np.intp)
    lower = np.take_along_axis(array, segment, axis=1)
    upper = np.take_along_axis(array, segment + 1, axis=1)
    out = lower + (position - segment) * (upper - lower)
    out[missing | bad] = np.nan
    return out[:, 0] if flat else out


def cdf(grid: F64, x: F64) -> F64:
    """The distribution function: the probability of a value at or below ``x``, the inverse of ``ppf``.

    Between two distinct quantiles it is linear in ``x``. At a value shared by several quantiles it is the mean of their
    levels; just below such a run it tends to the lowest of those levels and just above it to the highest. Outside the
    outermost quantiles it extends linearly with the outermost segment's slope and is clipped to [0, 1]; if that
    segment is zero-width it is a step (0 below the lowest quantile, 1 above the highest). It never divides by a
    zero-width segment.

    Args:
        grid: Sorted quantiles, shape ``(n, 19)``.
        x: Values, shape ``(n,)`` (one per row) or ``(n, k)`` (``k`` per row). NaN stays NaN.

    Returns:
        An array of probabilities with the shape of ``x``. A grid row holding a NaN or an infinity (infinities are not
        supported) gives NaN.

    Raises:
        ValueError: A shape is wrong or the grid is not sorted.
    """
    array, bad = _usable(_checked_grid(grid))
    _require_sorted(array)
    values, flat = _rows_of_values(array, x, "x")
    levels = np.asarray(LEVELS, dtype=np.float64)
    columns = values[:, :, None]
    below = (array[:, None, :] < columns).sum(axis=2)  # quantiles strictly below x
    at_or_below = (array[:, None, :] <= columns).sum(axis=2)
    ties = at_or_below - below

    # x strictly inside a segment: between quantile ``below - 1`` and quantile ``below``, whose widths are positive.
    inner = np.clip(below, 1, _N - 1)
    lo = np.take_along_axis(array, inner - 1, axis=1)
    hi = np.take_along_axis(array, inner, axis=1)
    width = hi - lo
    safe = np.where(width > 0.0, width, 1.0)
    between = levels[inner - 1] + (values - lo) / safe * (levels[inner] - levels[inner - 1])

    # x at one or more equal quantiles: their levels are consecutive, so the mean is that of the first and the last.
    first_tied = np.minimum(below, _N - 1)
    last_tied = np.minimum(np.maximum(at_or_below - 1, 0), _N - 1)
    mid_rank = (levels[first_tied] + levels[last_tied]) / 2.0

    # x beyond the outermost quantiles: extend the outermost segment, or step if it has no width.
    first, second = array[:, [0]], array[:, [1]]
    last, before_last = array[:, [_N - 1]], array[:, [_N - 2]]
    low_width, high_width = second - first, last - before_last
    low_safe = np.where(low_width > 0.0, low_width, 1.0)
    high_safe = np.where(high_width > 0.0, high_width, 1.0)
    extended_low = np.where(low_width > 0.0, levels[0] - (first - values) / low_safe * _LEVEL_STEP, 0.0)
    extended_high = np.where(high_width > 0.0, levels[-1] + (values - last) / high_safe * _LEVEL_STEP, 1.0)

    out = np.where(ties > 0, mid_rank, between)
    out = np.where(below == 0, np.where(ties > 0, mid_rank, extended_low), out)
    out = np.where(at_or_below == _N, np.where(ties > 0, mid_rank, extended_high), out)
    out = np.clip(out, 0.0, 1.0)
    out[np.isnan(values) | bad] = np.nan
    return out[:, 0] if flat else out


def exceedance_probability(grid: F64, threshold: float) -> F64:
    """The probability of exceeding ``threshold``: ``1 - cdf(grid, threshold)``, one per row.

    Raises:
        ValueError: The grid does not have 19 columns or is not sorted.
    """
    array = _checked_grid(grid)
    return 1.0 - cdf(array, np.full(array.shape[0], threshold, dtype=np.float64))
