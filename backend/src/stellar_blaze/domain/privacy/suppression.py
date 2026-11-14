"""Small-cell suppression with complementary suppression (ADR 0050 decisions 3-5; Review Focus 4).

A published table of counts must not let a reader recover a small group's value, neither directly nor by subtracting the
visible cells from a published total. Primary suppression hides every cell whose group is below ``k`` (for a health
count also any non-zero count below ``k``); when a total is published and exactly one cell is hidden, the smallest
visible cell is hidden too, so that ``total - visible cells`` is the sum of two hidden cells and not the value of one.

Limits worth knowing: the hidden pair's sum is still disclosed (the standard cost of complementary suppression), and a
table of one cell cannot have its total published when that cell is suppressed (the total is the cell):
``TotalWouldDiscloseError``.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from stellar_blaze.domain.config.runtime import EffectiveParams

type SuppressionReason = Literal["below_k", "complementary"]


class DataClass(StrEnum):
    """What a count is about; it picks the threshold (ADR 0050 decisions 3 and 4)."""

    HEALTH = "health"
    EXPOSURE = "exposure"


class TotalWouldDiscloseError(ValueError):
    """A total was to be published over a table whose only cell is suppressed: the total would be that cell."""


@dataclass(frozen=True)
class Cell:
    """One cell of a published table: its count, and how many people the cell is about (the group it describes)."""

    key: str
    count: int
    group_size: int

    def __post_init__(self) -> None:
        if self.count < 0 or self.group_size < 0:
            raise ValueError(f"cell {self.key!r}: count and group_size cannot be negative")


@dataclass(frozen=True)
class SuppressedCell:
    """A cell as published: ``count`` is ``None`` when ``suppressed``, and ``reason`` says why."""

    key: str
    count: int | None
    suppressed: bool
    reason: SuppressionReason | None


def k_for(data_class: DataClass, params: EffectiveParams) -> int:
    """The suppression threshold of a data class: ``k_health`` or ``k_exposure`` (already at or above its floor)."""
    return params.k_health if data_class is DataClass.HEALTH else params.k_exposure


def _below_k(cell: Cell, k: int, data_class: DataClass) -> bool:
    if cell.group_size < k:
        return True
    return data_class is DataClass.HEALTH and 0 < cell.count < k


def suppress(
    cells: Sequence[Cell],
    *,
    k: int,
    publish_total: bool,
    data_class: DataClass = DataClass.EXPOSURE,
) -> tuple[SuppressedCell, ...]:
    """Suppress ``cells`` for publication, in the order given.

    Args:
        cells: The table. Keys must be unique.
        k: The threshold (``k_for``). A cell is suppressed when its ``group_size`` is below ``k``; for ``HEALTH`` also
            when ``0 < count < k``.
        publish_total: Whether the table's total is published next to the cells.
        data_class: ``EXPOSURE`` (default) or ``HEALTH``.

    Raises:
        ValueError: ``k`` is below 1, or two cells share a key.
        TotalWouldDiscloseError: ``publish_total`` is true and the only cell of the table is suppressed.
    """
    if k < 1:
        raise ValueError(f"k must be at least 1, got {k}")
    keys = [c.key for c in cells]
    if len(set(keys)) != len(keys):
        raise ValueError(f"duplicate cell keys: {sorted({key for key in keys if keys.count(key) > 1})}")

    primary = {c.key for c in cells if _below_k(c, k, data_class)}
    complementary: str | None = None
    if publish_total and len(primary) == 1:
        visible = [c for c in cells if c.key not in primary]
        if not visible:
            raise TotalWouldDiscloseError(f"the total would be the suppressed cell {next(iter(primary))!r}")
        complementary = min(visible, key=lambda c: (c.count, c.key)).key

    result: list[SuppressedCell] = []
    for cell in cells:
        if cell.key in primary:
            result.append(SuppressedCell(cell.key, None, True, "below_k"))
        elif cell.key == complementary:
            result.append(SuppressedCell(cell.key, None, True, "complementary"))
        else:
            result.append(SuppressedCell(cell.key, cell.count, False, None))
    return tuple(result)
