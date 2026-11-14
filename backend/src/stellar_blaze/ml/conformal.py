"""Conformalised quantile regression offsets per lead x hour-block (pre-registration sections 2.3, 3.1 and 6.4).

The corrector predicts 19 quantiles of the forecast *error* (truth minus forecast; ``predict_grid`` in
``adapters.compute.lgbm_corrector`` returns them). Independently trained quantile models are not calibrated, so each
of the 9 central pairs (0.05/0.95 ... 0.45/0.55) is widened, or narrowed, by one symmetric offset ``q`` per stratum:
the lower quantile moves to ``lo - q`` and the upper one to ``hi + q`` (Romano, Patterson and Candes 2019, CQR). The
median is never moved.

Error space equals value space. The grid handed to ``fit_symmetric_offsets`` holds error quantiles and ``y_cal`` is the
error ``truth - forecast``. The corrected value is ``forecast + error quantile``, and the raw forecast is added to the
truth and to every quantile alike, so the conformity score ``max(lo - y, y - hi)`` and hence ``q`` are the same in both
spaces. ``apply_offsets`` is likewise applied to an error grid; the caller adds the raw forecast afterwards.

Offset formula, per stratum ("<lead>|<block>") and pair, with coverage ``c = hi - lo = 1 - alpha`` and ``n`` the rows
with a finite grid and a finite ``y``: the scores are ``E = max(lo - y, y - hi)`` and ``q`` is the
``ceil((n + 1) c)``-th smallest score (the maximum if that rank exceeds ``n``). This is the split-conformal order
statistic that MAPIE 1.6.0 computes as ``np.quantile(E, ceil((n + 1) (1 - alpha)) / n, method="lower")``. The rank is
computed in integers (levels are multiples of 1/20) and the order statistic is indexed directly, so no floating-point
rounding can move it.

Thin strata. A stratum with fewer than ``min_n`` usable rows takes the offset of its lead pooled over all blocks and is
listed in ``fallback``; if the pooled lead is thin too, ``fit_symmetric_offsets`` raises (an offset is never invented).
Rows with a non-finite grid or ``y`` are excluded and never filled.

Offsets of either sign are legitimate conformal outputs; ``apply_symmetric_offsets`` clamps a negative offset at the
median. ``ConformalOffsets.negative`` counts how many (stratum, pair) offsets are below zero, so the model card can say
how often that clamp can matter.

The data model ``ConformalOffsets`` and ``apply_offsets`` live in ``domain.forecast.conformal`` (the serving adapter
applies stored offsets and may not import ``stellar_blaze.ml``); they are re-exported here. This module keeps the
training half: ``fit_symmetric_offsets``, ``calibration_mask`` and, for the oracle test, ``ml._mapie``.
"""

from collections.abc import Sequence
from typing import Final, Literal

import numpy as np
import polars as pl
from numpy.typing import NDArray

from stellar_blaze.domain.forecast.conformal import (
    STRATUM_BLOCKS,
    ConformalOffsets,
    apply_offsets,
    block_indices,
    lead_values,
    stratum_key,
)
from stellar_blaze.domain.forecast.features import Target
from stellar_blaze.domain.forecast.grid import F64, LEVELS, PAIRS, HourBlock

__all__ = [
    "CALIBRATION_WINDOWS",
    "MIN_RANK_N",
    "MIN_STRATUM_ROWS",
    "CalibrationWindow",
    "ConformalOffsets",
    "apply_offsets",
    "calibration_mask",
    "fit_symmetric_offsets",
    "stratum_key",
]

MIN_STRATUM_ROWS: Final = 30
"""Fewest usable rows for a stratum to keep its own offset (pre-registration section 3.1; global constraint 4)."""

MIN_RANK_N: Final = 9
"""Fewest rows for which every pair has a conformal offset: ``ceil((n + 1) * 0.9) <= n`` holds from n = 9."""

type CalibrationWindow = Literal["september", "weeks_4_8_12_16"]
CALIBRATION_WINDOWS: Final[tuple[CalibrationWindow, ...]] = ("september", "weeks_4_8_12_16")

_N_LEVELS: Final = len(LEVELS)
_N_PAIRS: Final = len(PAIRS)
_LOWER: Final = np.array([LEVELS.index(lo) for lo, _ in PAIRS], dtype=np.intp)  # grid columns of the lower levels
_UPPER: Final = np.array([LEVELS.index(hi) for _, hi in PAIRS], dtype=np.intp)
_COVERAGE_TWENTIETHS: Final = (_UPPER - _LOWER).astype(np.int64)  # coverage hi - lo = (hi - lo) / 20, exact

# Summer day 1 is 15 May; the 4th, 8th, 12th and 16th week of the summer (pre-registration 6.4; 28 days per summer).
_SUMMER_START: Final = (5, 15)
_WEEK_DAYS: Final[tuple[range, ...]] = tuple(range(7 * (week - 1) + 1, 7 * week + 1) for week in (4, 8, 12, 16))


def _checked_grid(grid: F64) -> F64:
    array = np.asarray(grid, dtype=np.float64)
    if array.ndim != 2 or array.shape[1] != _N_LEVELS:
        raise ValueError(f"a quantile grid has shape (n, {_N_LEVELS}), got {array.shape}")
    return array


def _group_offsets(scores: F64, group: NDArray[np.int64]) -> tuple[NDArray[np.int64], NDArray[np.int64], F64]:
    """Per group: its id, its row count and the conformal order statistic of each pair's scores (all vectorized).

    ``scores`` is ``(m, 9)``, ``group`` is ``(m,)``. Each pair's scores are sorted once (``lexsort`` by group, then by
    value) and the ``ceil((n + 1) c)``-th smallest of every group is read at ``start + rank - 1``, where the rank is
    exact integer arithmetic (``c`` is a multiple of 1/20) and is capped at the group size.
    """
    ids, starts, counts = np.unique(np.sort(group), return_index=True, return_counts=True)
    out = np.empty((len(ids), _N_PAIRS), dtype=np.float64)
    for pair in range(_N_PAIRS):  # nine pairs, never per row
        ordered = scores[np.lexsort((scores[:, pair], group)), pair]
        numerator = (counts + 1) * _COVERAGE_TWENTIETHS[pair]
        rank = -((-numerator) // 20)  # ceil((n + 1) * c) with c = _COVERAGE_TWENTIETHS / 20, exactly
        out[:, pair] = ordered[starts + np.minimum(rank, counts) - 1]
    return ids.astype(np.int64), counts.astype(np.int64), out


def fit_symmetric_offsets(
    grid_cal: F64,
    y_cal: F64,
    lead: NDArray[np.int8],
    block: Sequence[HourBlock] | Sequence[str] | pl.Series,
    *,
    target: Target,
    min_n: int = MIN_STRATUM_ROWS,
) -> ConformalOffsets:
    """The symmetric CQR offsets of one target, per lead x hour-block stratum and pair.

    ``grid_cal`` holds quantiles of the forecast *error* and ``y_cal`` is the error ``truth - forecast`` (see the module
    docstring: the offsets are identical in value space). Every stratum present in the input gets offsets, including a
    stratum whose rows are all non-finite (it falls back).

    Args:
        grid_cal: Predicted error quantiles at ``LEVELS``, shape ``(n, 19)``. Rows with a NaN or an infinity are
            excluded from the fit and counted nowhere.
        y_cal: Observed errors, shape ``(n,)``; a non-finite one excludes the row.
        lead: Lead in days (1 to 7) of each row.
        block: Hour-block of each row: ``HourBlock`` members, their string values, or a Polars Series of the strings.
        target: The variable the offsets belong to (the key under which they are stored).
        min_n: A stratum with fewer usable rows takes the lead-pooled offset. At least ``MIN_RANK_N`` (9).

    Caveat: ``n`` counts rows, not independent days. The rows of one station-day (its hours, and its stations of one
    cluster) are strongly correlated, so the exchangeability behind the finite-sample guarantee holds only roughly and a
    stratum with n = 30 rows can be much less certain than its nominal coverage says. ``ConformalOffsets.n`` and
    ``fallback`` let a report show how thin each stratum is.

    Returns:
        A ``ConformalOffsets`` holding only ``target``.

    Raises:
        ValueError: ``min_n`` is below ``MIN_RANK_N``; a shape or a value is wrong (lead outside 1-7, unknown block),
            or the rows of a stratum that needs
            the lead-pooled offset are too few at the lead level too (the message names the target and the lead).
    """
    if min_n < MIN_RANK_N:
        raise ValueError(
            f"min_n must be at least {MIN_RANK_N}: below that ceil((n + 1) * 0.9) exceeds n, the 0.05/0.95 offset "
            f"does not exist and the interval would silently under-cover (MAPIE raises there), got {min_n}"
        )
    grid = _checked_grid(grid_cal)
    rows = grid.shape[0]
    y = np.asarray(y_cal, dtype=np.float64)
    if y.shape != (rows,):
        raise ValueError(f"y_cal needs one value per grid row ({rows}), got shape {y.shape}")
    leads = lead_values(lead, rows)
    blocks = block_indices(block, rows)

    stratum = leads * len(STRATUM_BLOCKS) + blocks
    usable = np.isfinite(grid).all(axis=1) & np.isfinite(y)
    lower, upper = grid[usable][:, _LOWER], grid[usable][:, _UPPER]
    scores = np.maximum(lower - y[usable, None], y[usable, None] - upper)

    ids, counts, per_stratum = _group_offsets(scores, stratum[usable])
    pooled_ids, pooled_counts, pooled = _group_offsets(scores, leads[usable])
    n_of = dict(zip(ids.tolist(), counts.tolist(), strict=True))
    own = {sid: per_stratum[i] for i, sid in enumerate(ids.tolist())}
    pooled_of = {lead_id: (pooled_counts[i], pooled[i]) for i, lead_id in enumerate(pooled_ids.tolist())}

    offsets: dict[str, list[float]] = {}
    n_rows: dict[str, int] = {}
    fallback: list[str] = []
    for sid in np.unique(stratum).tolist():
        lead_id, block_index = divmod(sid, len(STRATUM_BLOCKS))
        key = stratum_key(lead_id, STRATUM_BLOCKS[block_index])
        n_rows[key] = n_of.get(sid, 0)
        if n_rows[key] >= min_n:
            offsets[key] = own[sid].tolist()
            continue
        pooled_n, pooled_q = pooled_of.get(lead_id, (0, None))
        if pooled_n < min_n or pooled_q is None:
            raise ValueError(
                f"target {target.value}: lead {lead_id} has {pooled_n} usable rows over all hour-blocks, fewer than "
                f"min_n={min_n}, so stratum {key} ({n_rows[key]} rows) has no lead-pooled offset to fall back to"
            )
        offsets[key] = pooled_q.tolist()
        fallback.append(key)
    below_zero = sum(value < 0.0 for values in offsets.values() for value in values)
    return ConformalOffsets(
        offsets={target.value: offsets},
        n={target.value: n_rows},
        fallback={target.value: fallback},
        negative={target.value: below_zero},
    )


def calibration_mask(rows: pl.DataFrame, window: CalibrationWindow) -> pl.Series:
    """Which rows belong to the calibration window (pre-registration 2.3 and 6.4), aligned with ``rows``.

    * ``"september"``: ``valid_date`` from 1 to 30 September (the last 30 days of each training summer).
    * ``"weeks_4_8_12_16"``: summer days 22-28, 50-56, 78-84 and 106-112, where summer day 1 is 15 May of the row's own
      ``summer`` year; 28 days per summer.

    The date is the UTC ``valid_date`` (every modelled hour has the same date in UTC and GST). A row whose date is null,
    or lies outside its own summer's window, is ``False``.

    Args:
        rows: A frame with a ``valid_date`` (``pl.Date``) and, for the weeks window, an integer ``summer`` column (the
            ``build_features`` output has both).
        window: The window rule.

    Returns:
        A boolean Series named ``in_calibration_window``, one entry per row.

    Raises:
        ValueError: ``window`` is unknown, a needed column is missing, or ``valid_date`` is not a Date.
    """
    if window not in CALIBRATION_WINDOWS:
        raise ValueError(f"unknown calibration window {window!r}; expected one of {CALIBRATION_WINDOWS}")
    if "valid_date" not in rows.columns:
        raise ValueError("calibration_mask needs a valid_date column")
    if rows.schema["valid_date"] != pl.Date:
        raise ValueError(f"valid_date must be a Date (UTC date), got {rows.schema['valid_date']}")
    if window == "september":
        mask = pl.col("valid_date").dt.month() == 9
    else:
        if "summer" not in rows.columns:
            raise ValueError("the weeks_4_8_12_16 window needs the summer column")
        month, day = _SUMMER_START
        summer_day = (pl.col("valid_date") - pl.date(pl.col("summer"), month, day)).dt.total_days() + 1
        mask = pl.any_horizontal(summer_day.is_between(days[0], days[-1]) for days in _WEEK_DAYS)
    return rows.select(mask.fill_null(value=False).alias("in_calibration_window")).to_series()
