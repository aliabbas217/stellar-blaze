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
"""

import re
from collections.abc import Mapping, Sequence
from typing import Final, Literal, Self

import numpy as np
import polars as pl
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, model_validator

from stellar_blaze.domain.forecast.features import Target
from stellar_blaze.domain.forecast.grid import (
    F64,
    HOUR_BLOCKS,
    LEVELS,
    MODEL_LEADS,
    PAIRS,
    HourBlock,
    apply_symmetric_offsets,
)

__all__ = [
    "CALIBRATION_WINDOWS",
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

type CalibrationWindow = Literal["september", "weeks_4_8_12_16"]
CALIBRATION_WINDOWS: Final[tuple[CalibrationWindow, ...]] = ("september", "weeks_4_8_12_16")

_N_LEVELS: Final = len(LEVELS)
_N_PAIRS: Final = len(PAIRS)
_BLOCKS: Final[tuple[HourBlock, ...]] = tuple(HOUR_BLOCKS)
_BLOCK_INDEX: Final[Mapping[str, int]] = {block.value: index for index, block in enumerate(_BLOCKS)}
_LOWER: Final = np.array([LEVELS.index(lo) for lo, _ in PAIRS], dtype=np.intp)  # grid columns of the lower levels
_UPPER: Final = np.array([LEVELS.index(hi) for _, hi in PAIRS], dtype=np.intp)
_COVERAGE_TWENTIETHS: Final = (_UPPER - _LOWER).astype(np.int64)  # coverage hi - lo = (hi - lo) / 20, exact
_KEY: Final = re.compile(r"^([1-7])\|(" + "|".join(block.value for block in _BLOCKS) + r")$")

# Summer day 1 is 15 May; the 4th, 8th, 12th and 16th week of the summer (pre-registration 6.4; 28 days per summer).
_SUMMER_START: Final = (5, 15)
_WEEK_DAYS: Final[tuple[range, ...]] = tuple(range(7 * (week - 1) + 1, 7 * week + 1) for week in (4, 8, 12, 16))


def stratum_key(lead: int, block: HourBlock | str) -> str:
    """The key of a stratum, ``"<lead>|<block value>"`` (for example ``"2|peak"``)."""
    return f"{lead}|{HourBlock(block).value}"


class ConformalOffsets(BaseModel):
    """The symmetric CQR offsets of one or more targets (persisted as ``conformal.json``).

    Attributes:
        offsets: Target value (``"t"``, ``"td"``, ``"wind"``, ``"wbgt"``) to stratum key to the 9 offsets aligned with
            ``PAIRS``, in the units of the target's error.
        n: The same keys to the number of usable calibration rows of the stratum (0 for a stratum that had none).
        fallback: Target to the keys of the strata that took the lead-pooled offset (``n`` below the minimum).
        negative: Target to the number of (stratum, pair) offsets below zero, of any stratum including fallbacks.
    """

    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    offsets: dict[str, dict[str, list[float]]]
    n: dict[str, dict[str, int]]
    fallback: dict[str, list[str]]
    negative: dict[str, int]

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        targets = set(self.offsets)
        if not (targets == set(self.n) == set(self.fallback) == set(self.negative)):
            raise ValueError("offsets, n, fallback and negative must name the same targets")
        for target, strata in self.offsets.items():
            if set(strata) != set(self.n[target]):
                raise ValueError(f"{target}: offsets and n must name the same strata")
            for key, values in strata.items():
                if _KEY.match(key) is None:
                    raise ValueError(f"{target}: {key!r} is not a stratum key '<lead 1-7>|<early|peak|late>'")
                if len(values) != _N_PAIRS:
                    raise ValueError(f"{target}/{key}: expected {_N_PAIRS} offsets, got {len(values)}")
            unknown = set(self.fallback[target]) - set(strata)
            if unknown:
                raise ValueError(f"{target}: fallback names strata without offsets: {sorted(unknown)}")
            below_zero = sum(value < 0.0 for values in strata.values() for value in values)
            if below_zero != self.negative[target]:
                raise ValueError(f"{target}: negative is {self.negative[target]} but {below_zero} offsets are below 0")
        return self

    def merge(self, other: "ConformalOffsets") -> "ConformalOffsets":
        """The union with the offsets of other targets (one object for the four targets of a corrector).

        Raises:
            ValueError: ``other`` holds a target that this object already holds.
        """
        clash = sorted(set(self.offsets) & set(other.offsets))
        if clash:
            raise ValueError(f"cannot merge: target(s) {clash} already have offsets")
        return ConformalOffsets(
            offsets={**self.offsets, **other.offsets},
            n={**self.n, **other.n},
            fallback={**self.fallback, **other.fallback},
            negative={**self.negative, **other.negative},
        )


def _block_indices(block: Sequence[str] | pl.Series, rows: int) -> NDArray[np.intp]:
    """The index into ``HOUR_BLOCKS`` of every row's block (a ``HourBlock``, its string value, or a Series of those)."""
    values = np.asarray(block.to_numpy() if isinstance(block, pl.Series) else block, dtype=np.str_)
    if values.shape != (rows,):
        raise ValueError(f"block needs one entry per row ({rows}), got shape {values.shape}")
    names, inverse = np.unique(values, return_inverse=True)
    unknown = [str(name) for name in names if str(name) not in _BLOCK_INDEX]
    if unknown:
        raise ValueError(f"unknown hour-block(s) {unknown}; expected one of {sorted(_BLOCK_INDEX)}")
    lookup = np.array([_BLOCK_INDEX[str(name)] for name in names], dtype=np.intp)
    return lookup[inverse.reshape(-1)]


def _lead_values(lead: NDArray[np.int8], rows: int) -> NDArray[np.int64]:
    leads = np.asarray(lead)
    if leads.shape != (rows,) or not np.issubdtype(leads.dtype, np.integer):
        raise ValueError(
            f"lead must be an integer array with one entry per row ({rows}), got {leads.dtype}{leads.shape}"
        )
    out = leads.astype(np.int64)
    if out.size and (out.min() < MODEL_LEADS[0] or out.max() > MODEL_LEADS[-1]):
        raise ValueError(f"lead must be within {MODEL_LEADS[0]} to {MODEL_LEADS[-1]}, got {out.min()} to {out.max()}")
    return out


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
        min_n: A stratum with fewer usable rows takes the lead-pooled offset.

    Returns:
        A ``ConformalOffsets`` holding only ``target``.

    Raises:
        ValueError: A shape or a value is wrong (lead outside 1-7, unknown block), or the rows of a stratum that needs
            the lead-pooled offset are too few at the lead level too (the message names the target and the lead).
    """
    grid = _checked_grid(grid_cal)
    rows = grid.shape[0]
    y = np.asarray(y_cal, dtype=np.float64)
    if y.shape != (rows,):
        raise ValueError(f"y_cal needs one value per grid row ({rows}), got shape {y.shape}")
    leads = _lead_values(lead, rows)
    blocks = _block_indices(block, rows)

    stratum = leads * len(_BLOCKS) + blocks
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
        lead_id, block_index = divmod(sid, len(_BLOCKS))
        key = stratum_key(lead_id, _BLOCKS[block_index])
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


def apply_offsets(
    grid: F64,
    lead: NDArray[np.int8],
    block: Sequence[HourBlock] | Sequence[str] | pl.Series,
    offsets: ConformalOffsets,
    target: Target,
) -> F64:
    """Widen (or narrow) each row of an error grid by the offsets of its own stratum; the median never moves.

    Each stratum's rows go through ``domain.forecast.grid.apply_symmetric_offsets`` with that stratum's 9 offsets
    (aligned with ``PAIRS``), so a negative offset clamps at the median, the result is re-sorted, and a row with a
    non-finite value comes back as an all-NaN row. The grid is an error grid (``fit_symmetric_offsets``): the caller
    adds the raw forecast afterwards.

    Args:
        grid: Sorted error quantiles, shape ``(n, 19)``.
        lead: Lead in days of each row.
        block: Hour-block of each row.
        offsets: The fitted offsets; must hold ``target``.
        target: The variable the grid belongs to.

    Returns:
        A new ``(n, 19)`` array.

    Raises:
        KeyError: The target has no offsets, or a row's stratum key has none (the key is in the message). There is no
            silent fallback at serving time.
        ValueError: A shape or a value is wrong, or the grid is not sorted.
    """
    array = _checked_grid(grid)
    rows = array.shape[0]
    leads = _lead_values(lead, rows)
    blocks = _block_indices(block, rows)
    try:
        by_key = offsets.offsets[target.value]
    except KeyError:
        raise KeyError(f"no conformal offsets for target {target.value!r} (have {sorted(offsets.offsets)})") from None
    stratum = leads * len(_BLOCKS) + blocks
    out = np.empty_like(array)
    for sid in np.unique(stratum).tolist():
        lead_id, block_index = divmod(sid, len(_BLOCKS))
        key = stratum_key(lead_id, _BLOCKS[block_index])
        if key not in by_key:
            raise KeyError(f"no conformal offsets for stratum {key!r} of target {target.value!r}")
        selected = stratum == sid
        out[selected] = apply_symmetric_offsets(array[selected], by_key[key])
    return out


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
