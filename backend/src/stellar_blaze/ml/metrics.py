"""Row-wise scores of probabilistic forecasts: the facade over ``scoringrules`` and the reliability tables.

This is the only module that imports ``scoringrules`` (import-linter and a unit test keep it that way), so the rest of
the code does not depend on its version or its conventions (``alpha`` is the quantile level in ``crps_quantile`` but
the miscoverage in ``interval_score``; here every argument is named for what it is).

Every function is row-wise: it takes one array row per forecast and returns one score per row, never an aggregate, so
the caller chooses the stratum and the aggregation (the pre-registration reports means by lead, hour-block, regime and
more). Nothing is dropped or filled: a caller passes finite rows, and a non-finite input raises ``ValueError`` naming
the argument. A forecast distribution is a sorted ``(n, 19)`` grid at ``LEVELS`` (``domain.forecast.grid``).

CRPS from 19 quantile levels is a pinball-loss approximation: it over-states the mean CRPS of a calibrated normal by
about 4.8% (stack doc 6.2), so it is only comparable between models scored on the same grid.
"""

import math
from collections.abc import Sequence
from typing import Final

import numpy as np
import polars as pl
import scoringrules
from numpy.typing import NDArray

from stellar_blaze.domain.forecast.grid import F64, LEVELS, cdf

__all__ = [
    "PREREGISTERED_RELIABILITY_EDGES",
    "brier",
    "brier_skill",
    "covered",
    "crps_deterministic",
    "crps_grid",
    "interval_score",
    "pinball",
    "pit",
    "pit_histogram",
    "reliability_bins",
]

PREREGISTERED_RELIABILITY_EDGES: Final[tuple[float, ...]] = (
    0.0,
    0.05,
    0.15,
    0.25,
    0.35,
    0.45,
    0.55,
    0.65,
    0.75,
    0.85,
    0.95,
    1.0,
)
"""Reliability-diagram bins centered on 0.1, 0.2, ..., 0.9 with half-width end bins (ruling R22): the 0.65-0.75 bin
is the "70%" bin that pre-registration 7.1 quotes (``obs_freq_at_70``). ``reliability_bins`` takes it as ``edges``."""

_N_LEVELS: Final = len(LEVELS)
_LEVEL_ARRAY: Final[F64] = np.asarray(LEVELS, dtype=np.float64)
_LEVEL_TOLERANCE: Final = 1e-9


def _as_float(name: str, values: object) -> F64:
    """``values`` as a float64 array with no non-finite entry."""
    array = np.asarray(values, dtype=np.float64)
    if not np.isfinite(array).all():
        raise ValueError(
            f"{name} must be finite (no NaN or infinity), got {int((~np.isfinite(array)).sum())} such value(s)"
        )
    return array


def _vector(name: str, values: object) -> F64:
    """``values`` as a finite float64 vector of shape ``(n,)``."""
    array = _as_float(name, values)
    if array.ndim != 1:
        raise ValueError(f"{name} must have shape (n,), got {array.shape}")
    return array


def _grid(values: object) -> F64:
    """``values`` as a finite float64 quantile grid of shape ``(n, 19)``."""
    array = _as_float("grid", values)
    if array.ndim != 2 or array.shape[1] != _N_LEVELS:
        raise ValueError(f"grid must have shape (n, {_N_LEVELS}), got {array.shape}")
    return array


def _same_length(first: tuple[str, int], second: tuple[str, int]) -> None:
    (name_a, len_a), (name_b, len_b) = first, second
    if len_a != len_b:
        raise ValueError(f"{name_a} has {len_a} values but {name_b} has {len_b}")


def _probabilities(name: str, values: object) -> F64:
    array = _vector(name, values)
    if np.any((array < 0.0) | (array > 1.0)):
        raise ValueError(f"{name} must lie in [0, 1]")
    return array


def _finite_scalar(name: str, value: float) -> float:
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite, got {value}")
    return float(value)


def crps_grid(y: F64, grid: F64) -> F64:
    """The CRPS of a quantile-grid forecast, per row: ``scoringrules.crps_quantile(y, grid, alpha=LEVELS)``.

    It equals twice the mean pinball loss over the 19 levels. The grid need not be sorted for this score.

    Args:
        y: Observations, shape ``(n,)``.
        grid: Quantiles at ``LEVELS``, shape ``(n, 19)`` with the levels along the columns.

    Returns:
        One CRPS per row, shape ``(n,)``, in the units of ``y``.

    Raises:
        ValueError: A shape is wrong or an input is not finite.
    """
    observed = _vector("y", y)
    quantiles = _grid(grid)
    _same_length(("grid rows", quantiles.shape[0]), ("y", observed.shape[0]))
    return np.asarray(scoringrules.crps_quantile(observed, quantiles, alpha=_LEVEL_ARRAY), dtype=np.float64)


def crps_deterministic(y: F64, x: F64) -> F64:
    """The CRPS of a point forecast, which is its absolute error ``|y - x|``, per row.

    Raises:
        ValueError: A shape is wrong or an input is not finite.
    """
    observed = _vector("y", y)
    forecast = _vector("x", x)
    _same_length(("x", forecast.shape[0]), ("y", observed.shape[0]))
    return np.abs(observed - forecast)


def pinball(y: F64, grid: F64, level: float) -> F64:
    """The pinball (quantile) loss of the grid's quantile at ``level``, per row.

    Args:
        y: Observations, shape ``(n,)``.
        grid: Quantiles at ``LEVELS``, shape ``(n, 19)``.
        level: One of ``LEVELS`` (for example 0.05, 0.5 or 0.95).

    Raises:
        ValueError: ``level`` is not one of the 19 grid levels, a shape is wrong or an input is not finite.
    """
    observed = _vector("y", y)
    quantiles = _grid(grid)
    _same_length(("grid rows", quantiles.shape[0]), ("y", observed.shape[0]))
    alpha = _finite_scalar("level", level)
    column = int(np.argmin(np.abs(_LEVEL_ARRAY - alpha)))
    if abs(_LEVEL_ARRAY[column] - alpha) > _LEVEL_TOLERANCE:
        raise ValueError(f"level {level} is not one of the {_N_LEVELS} grid levels {LEVELS}")
    return np.asarray(scoringrules.quantile_score(observed, quantiles[:, column], alpha), dtype=np.float64)


def _interval(y: F64, lo: F64, hi: F64) -> tuple[F64, F64, F64]:
    observed = _vector("y", y)
    lower = _vector("lo", lo)
    upper = _vector("hi", hi)
    _same_length(("lo", lower.shape[0]), ("y", observed.shape[0]))
    _same_length(("hi", upper.shape[0]), ("y", observed.shape[0]))
    if np.any(lower > upper):
        raise ValueError("lo must not exceed hi (repair quantile crossing first)")
    return observed, lower, upper


def interval_score(y: F64, lo: F64, hi: F64, miscoverage: float) -> F64:
    """The interval (Winkler) score of a central prediction interval, per row; lower is better.

    ``(hi - lo)`` plus ``2 / miscoverage`` times the distance by which ``y`` falls outside the interval. It is
    ``scoringrules.interval_score``, whose ``alpha`` is the miscoverage.

    Args:
        y: Observations, shape ``(n,)``.
        lo: Lower bounds, shape ``(n,)``.
        hi: Upper bounds, shape ``(n,)``.
        miscoverage: The nominal share outside the interval: 0.1 for the 90% pair, 0.2 for the 80% pair.

    Raises:
        ValueError: ``miscoverage`` is not in (0, 1), a bound is crossed, a shape is wrong or an input is not finite.
    """
    observed, lower, upper = _interval(y, lo, hi)
    if not (math.isfinite(miscoverage) and 0.0 < miscoverage < 1.0):
        raise ValueError(f"miscoverage must be in (0, 1) (0.1 for a 90% interval), got {miscoverage}")
    return np.asarray(scoringrules.interval_score(observed, lower, upper, float(miscoverage)), dtype=np.float64)


def covered(y: F64, lo: F64, hi: F64) -> NDArray[np.bool_]:
    """Whether ``y`` lies inside the closed interval ``[lo, hi]``, per row.

    Raises:
        ValueError: A bound is crossed, a shape is wrong or an input is not finite.
    """
    observed, lower, upper = _interval(y, lo, hi)
    return (lower <= observed) & (observed <= upper)


def pit(y: F64, grid: F64) -> F64:
    """The probability integral transform of each observation: the grid's cdf at ``y`` (``grid.cdf``).

    At a value shared by several tied quantiles (wind clipped at 0, a corrector with no spread) the cdf is the
    mid-rank of the tied levels, so the PIT of a tied grid is deterministic: it is not randomized.

    Args:
        y: Observations, shape ``(n,)``.
        grid: Sorted quantiles at ``LEVELS``, shape ``(n, 19)``.

    Returns:
        Probabilities in [0, 1], shape ``(n,)``.

    Raises:
        ValueError: A shape is wrong, an input is not finite or the grid is not sorted along its levels.
    """
    observed = _vector("y", y)
    quantiles = _grid(grid)
    _same_length(("grid rows", quantiles.shape[0]), ("y", observed.shape[0]))
    return cdf(quantiles, observed)


def _equal_edges(bins: int) -> F64:
    """Edges of ``bins`` equal bins of [0, 1], each the double nearest to ``k / bins`` (0.29 is edge 29 of 100)."""
    return np.arange(bins + 1, dtype=np.float64) / bins


def _bin_index(probabilities: F64, edges: F64) -> NDArray[np.intp]:
    """Lower-inclusive bin of each probability, the last bin closed at 1.0.

    The bin is looked up in the very ``edges`` array that is reported, so assignment and edges agree by construction
    (``floor(p * bins)`` does not: 0.29 * 100 is 28.999999999999996, and ``p / width`` has the same flaw).
    """
    index = np.searchsorted(edges, probabilities, side="right").astype(np.intp) - 1
    last_bin = edges.shape[0] - 2
    return np.asarray(np.minimum(index, last_bin), dtype=np.intp)  # p == 1.0 sits on the last edge: close the last bin


def pit_histogram(pit: F64, bins: int = 10) -> NDArray[np.int64]:
    """Counts of PIT values in ``bins`` equal bins of [0, 1]; a PIT of exactly 1.0 falls in the last bin.

    Raises:
        ValueError: ``bins`` is below 1, a value is outside [0, 1] or not finite.
    """
    if bins < 1:
        raise ValueError(f"bins must be at least 1, got {bins}")
    values = _probabilities("pit", pit)
    return np.bincount(_bin_index(values, _equal_edges(bins)), minlength=bins).astype(np.int64)


def brier(p: F64, event: NDArray[np.bool_]) -> F64:
    """The Brier score of event probabilities, ``(p - event) ** 2``, per row.

    Args:
        p: Probabilities in [0, 1], shape ``(n,)``.
        event: Whether the event happened, boolean, shape ``(n,)``.

    Raises:
        ValueError: ``p`` is outside [0, 1] or not finite, ``event`` is not boolean, or the shapes differ.
    """
    probabilities = _probabilities("p", p)
    outcome = _event(event)
    _same_length(("event", outcome.shape[0]), ("p", probabilities.shape[0]))
    return (probabilities - outcome) ** 2


def _event(event: NDArray[np.bool_]) -> NDArray[np.bool_]:
    array = np.asarray(event)
    if array.dtype != np.bool_ or array.ndim != 1:
        raise ValueError(f"event must be a boolean array of shape (n,), got dtype {array.dtype} shape {array.shape}")
    return array


def brier_skill(bs: float, bs_ref: float) -> float:
    """The Brier skill score, ``1 - bs / bs_ref``: 1 is perfect, 0 no better than the reference, below 0 worse.

    Raises:
        ValueError: An input is not finite, or ``bs_ref`` is zero (the skill is undefined).
    """
    score = _finite_scalar("bs", bs)
    reference = _finite_scalar("bs_ref", bs_ref)
    if reference == 0.0:
        raise ValueError("bs_ref is 0: the Brier skill score against a perfect reference is undefined")
    return 1.0 - score / reference


def _checked_edges(edges: Sequence[float]) -> F64:
    array = np.asarray(edges, dtype=np.float64)
    if array.ndim != 1 or array.shape[0] < 2 or not np.isfinite(array).all():
        raise ValueError(f"edges must be a finite sequence of at least 2 values, got {edges!r}")
    if array[0] != 0.0 or array[-1] != 1.0:
        raise ValueError(f"edges must start at 0.0 and end at 1.0, got {array[0]} and {array[-1]}")
    if np.any(np.diff(array) <= 0.0):
        raise ValueError("edges must be strictly increasing")
    return array


def reliability_bins(
    p: F64,
    event: NDArray[np.bool_],
    *,
    width: float = 0.1,
    min_count: int = 50,
    edges: Sequence[float] | None = None,
) -> pl.DataFrame:
    """The reliability table: forecast probability against observed frequency, in bins of [0, 1].

    By default the bins are equal and ``width`` wide, tiling [0, 1) from 0 (0.0-0.1, 0.1-0.2, ...). Pass ``edges`` (for
    example ``PREREGISTERED_RELIABILITY_EDGES``) for any other partition; ``width`` is then ignored. Every bin is
    present, empty ones with ``n = 0`` and null ``mean_p`` and ``obs_freq``. A bin is ``[bin_lo, bin_hi)`` except the
    last, which is closed so that ``p = 1.0`` counts. A bin with fewer than ``min_count`` forecasts is ``hollow``
    (drawn hollow and never quoted, pre-registration 7.1).

    Args:
        p: Probabilities in [0, 1], shape ``(n,)``.
        event: Whether the event happened, boolean, shape ``(n,)``.
        width: Bin width; ``1 / width`` must be a whole number. Ignored when ``edges`` is given.
        min_count: Smallest ``n`` that is not hollow.
        edges: Strictly increasing bin edges, the first 0.0 and the last 1.0; ``None`` for equal bins of ``width``.

    Returns:
        Columns ``bin_lo``, ``bin_hi`` (Float64), ``n`` (Int64), ``mean_p``, ``obs_freq`` (Float64, null if empty),
        ``hollow`` (Boolean).

    Raises:
        ValueError: ``width`` does not tile [0, 1], ``edges`` is not a valid partition, or ``p`` / ``event`` are
            invalid (see ``brier``).
    """
    if edges is None:
        if not (math.isfinite(width) and width > 0.0):
            raise ValueError(f"width must be positive, got {width}")
        equal_bins = round(1.0 / width)
        if equal_bins < 1 or abs(equal_bins * width - 1.0) > _LEVEL_TOLERANCE:
            raise ValueError(f"width {width} does not tile [0, 1] (1 / width must be a whole number)")
        edge_array = _equal_edges(equal_bins)
    else:
        edge_array = _checked_edges(edges)
    bins = edge_array.shape[0] - 1
    probabilities = _probabilities("p", p)
    outcome = _event(event)
    _same_length(("event", outcome.shape[0]), ("p", probabilities.shape[0]))

    index = _bin_index(probabilities, edge_array)
    n = np.bincount(index, minlength=bins).astype(np.int64)
    sum_p = np.bincount(index, weights=probabilities, minlength=bins)
    sum_event = np.bincount(index, weights=outcome.astype(np.float64), minlength=bins)
    occupied = n > 0
    return pl.DataFrame(
        {
            "bin_lo": edge_array[:-1],
            "bin_hi": edge_array[1:],
            "n": n,
            "mean_p": [float(s / c) if o else None for s, c, o in zip(sum_p, n, occupied, strict=True)],
            "obs_freq": [float(s / c) if o else None for s, c, o in zip(sum_event, n, occupied, strict=True)],
            "hollow": n < min_count,
        },
        schema={
            "bin_lo": pl.Float64,
            "bin_hi": pl.Float64,
            "n": pl.Int64,
            "mean_p": pl.Float64,
            "obs_freq": pl.Float64,
            "hollow": pl.Boolean,
        },
    )
