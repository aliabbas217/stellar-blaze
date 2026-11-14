"""The stored conformal offsets of a corrector and how they are applied (pre-registration section 3.1).

This is the serving half of conformalised quantile regression: the data model ``ConformalOffsets`` (what
``conformal.json`` holds) and ``apply_offsets`` (what the serving adapter runs on a predicted error grid). Fitting the
offsets, MAPIE and the calibration windows live in ``stellar_blaze.ml.conformal`` (training code, which serving code may
not import); this module needs only numpy, pydantic, Polars (the type of an optional ``block`` column) and
``domain.forecast.grid`` (plus the ``Target`` enum of ``domain.forecast.features``).

Error space equals value space. The grid holds quantiles of the forecast *error* (truth minus forecast, what
``predict_grid`` in ``adapters.compute.lgbm_corrector`` returns); the offsets were fitted on that error. The corrected
value is ``forecast + error quantile`` and the raw forecast is added to the truth and to every quantile alike, so an
offset is the same in both spaces. ``apply_offsets`` takes and returns an error grid; the caller adds the raw forecast
afterwards.

Strata are keyed ``"<lead>|<block value>"`` (``stratum_key``), for example ``"2|peak"``, with leads 1 to 7. The model
serializes in a canonical order (targets alphabetical, strata by lead then hour-block, ``fallback`` in the same order),
so the JSON of equal offsets is identical whatever order the dicts were built in (a manifest hash can depend on it).
"""

import re
from collections.abc import Mapping, Sequence
from typing import Final, Self

import numpy as np
import polars as pl
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, field_validator, model_validator

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
    "STRATUM_BLOCKS",
    "ConformalOffsets",
    "apply_offsets",
    "block_indices",
    "lead_values",
    "stratum_key",
]

STRATUM_BLOCKS: Final[tuple[HourBlock, ...]] = tuple(HOUR_BLOCKS)
"""The hour-blocks in their canonical order (the order of ``HOUR_BLOCKS``). A stratum id is ``lead * 3 + index``."""

_N_LEVELS: Final = len(LEVELS)
_N_PAIRS: Final = len(PAIRS)
_BLOCK_INDEX: Final[Mapping[str, int]] = {block.value: index for index, block in enumerate(STRATUM_BLOCKS)}
_KEY: Final = re.compile(r"^([1-7])\|(" + "|".join(block.value for block in STRATUM_BLOCKS) + r")$")


def stratum_key(lead: int, block: HourBlock | str) -> str:
    """The key of a stratum, ``"<lead>|<block value>"`` (for example ``"2|peak"``)."""
    return f"{lead}|{HourBlock(block).value}"


def _key_order(key: str) -> tuple[int, int]:
    match = _KEY.match(key)
    if match is None:
        raise ValueError(f"{key!r} is not a stratum key '<lead 1-7>|<early|peak|late>'")
    return int(match.group(1)), _BLOCK_INDEX[match.group(2)]


def block_indices(block: Sequence[str] | pl.Series, rows: int) -> NDArray[np.intp]:
    """The index into ``STRATUM_BLOCKS`` of every row's block (``HourBlock`` members, their values or a Series).

    Raises:
        ValueError: The length is not ``rows``, or a name is not an hour-block (a null counts as unknown).
    """
    values = np.asarray(block.to_numpy() if isinstance(block, pl.Series) else block, dtype=np.str_)
    if values.shape != (rows,):
        raise ValueError(f"block needs one entry per row ({rows}), got shape {values.shape}")
    names, inverse = np.unique(values, return_inverse=True)
    unknown = [str(name) for name in names if str(name) not in _BLOCK_INDEX]
    if unknown:
        raise ValueError(f"unknown hour-block(s) {unknown}; expected one of {sorted(_BLOCK_INDEX)}")
    lookup = np.array([_BLOCK_INDEX[str(name)] for name in names], dtype=np.intp)
    return lookup[inverse.reshape(-1)]


def lead_values(lead: NDArray[np.int8], rows: int) -> NDArray[np.int64]:
    """The leads as int64, checked to be integers, one per row and within ``MODEL_LEADS`` (1 to 7).

    Raises:
        ValueError: The array is not integer, not ``(rows,)``, or holds a lead outside 1 to 7.
    """
    leads = np.asarray(lead)
    if leads.shape != (rows,) or not np.issubdtype(leads.dtype, np.integer):
        raise ValueError(
            f"lead must be an integer array with one entry per row ({rows}), got {leads.dtype}{leads.shape}"
        )
    out = leads.astype(np.int64)
    if out.size and (out.min() < MODEL_LEADS[0] or out.max() > MODEL_LEADS[-1]):
        raise ValueError(f"lead must be within {MODEL_LEADS[0]} to {MODEL_LEADS[-1]}, got {out.min()} to {out.max()}")
    return out


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

    @field_validator("offsets", "n", mode="after")
    @classmethod
    def _canonical_strata[V](cls, value: dict[str, dict[str, V]]) -> dict[str, dict[str, V]]:
        # a malformed key raises here (_key_order), before the consistency check names it
        return {t: {k: value[t][k] for k in sorted(value[t], key=_key_order)} for t in sorted(value)}

    @field_validator("fallback", mode="after")
    @classmethod
    def _canonical_fallback(cls, value: dict[str, list[str]]) -> dict[str, list[str]]:
        return {target: sorted(value[target], key=_key_order) for target in sorted(value)}

    @field_validator("negative", mode="after")
    @classmethod
    def _canonical_negative(cls, value: dict[str, int]) -> dict[str, int]:
        return {target: value[target] for target in sorted(value)}

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        targets = set(self.offsets)
        if not (targets == set(self.n) == set(self.fallback) == set(self.negative)):
            raise ValueError("offsets, n, fallback and negative must name the same targets")
        for target, strata in self.offsets.items():
            if set(strata) != set(self.n[target]):
                raise ValueError(f"{target}: offsets and n must name the same strata")
            for key, values in strata.items():
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


def apply_offsets(
    grid: F64,
    lead: NDArray[np.int8],
    block: Sequence[HourBlock] | Sequence[str] | pl.Series,
    offsets: ConformalOffsets,
    target: Target,
) -> F64:
    """Widen (or narrow) each row of an error grid by the offsets of its own stratum; the median never moves.

    Each stratum's rows go through ``apply_symmetric_offsets`` with that stratum's 9 offsets (aligned with ``PAIRS``),
    so a negative offset clamps at the median, the result is re-sorted, and a row with a non-finite value comes back as
    an all-NaN row. The grid is an error grid (see the module docstring): the caller adds the raw forecast afterwards.

    Args:
        grid: Sorted error quantiles, shape ``(n, 19)``.
        lead: Lead in days (1 to 7) of each row.
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
    array = np.asarray(grid, dtype=np.float64)
    if array.ndim != 2 or array.shape[1] != _N_LEVELS:
        raise ValueError(f"a quantile grid has shape (n, {_N_LEVELS}), got {array.shape}")
    rows = array.shape[0]
    stratum = lead_values(lead, rows) * len(STRATUM_BLOCKS) + block_indices(block, rows)
    try:
        by_key = offsets.offsets[target.value]
    except KeyError:
        raise KeyError(f"no conformal offsets for target {target.value!r} (have {sorted(offsets.offsets)})") from None
    out = np.empty_like(array)
    for code in np.unique(stratum).tolist():
        lead_id, block_index = divmod(code, len(STRATUM_BLOCKS))
        key = stratum_key(lead_id, STRATUM_BLOCKS[block_index])
        if key not in by_key:
            raise KeyError(f"no conformal offsets for stratum {key!r} of target {target.value!r}")
        selected = stratum == code
        out[selected] = apply_symmetric_offsets(array[selected], by_key[key])
    return out
