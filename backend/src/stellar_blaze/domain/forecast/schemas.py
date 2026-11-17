"""The corrected-forecast frame: one row per forecast row and variable, with the calibrated quantile grid.

Times are microsecond, UTC-aware ``Datetime`` columns; ``t`` and ``td`` are degrees Celsius, ``wind`` is meters per
second and ``wbgt`` is degrees Celsius.
"""

from enum import StrEnum
from typing import Final

import numpy as np
import polars as pl

from stellar_blaze.domain.forecast.grid import F64, LEVELS

VARIABLES: Final[tuple[str, ...]] = ("t", "td", "wind", "wbgt")
"""The ``variable`` values of a corrected frame, in the order of its rows for each forecast row."""

QUANTILE_COLUMNS: Final[tuple[str, ...]] = tuple(f"q{round(level * 100):02d}" for level in LEVELS)
"""``("q05", "q10", ..., "q95")``: the columns that hold the grid, aligned with ``LEVELS``."""


class CorrectionStatus(StrEnum):
    """What a corrector did with one forecast value."""

    OK = "ok"
    """The corrector produced a calibrated grid."""

    MISSING_INPUT = "missing_input"
    """An input the corrector needs was missing, so there is no grid (null quantiles, never a number)."""

    UNCORRECTED = "uncorrected"
    """The corrector did not correct the value: the grid is degenerate, every quantile equal to ``raw``."""


# One row per input IFS row and variable. ``raw`` is the uncorrected forecast (null where it could not be computed).
# The ``q..`` columns are the calibrated, sorted quantiles at ``LEVELS``: null when ``status`` is ``missing_input``,
# all equal to ``raw`` when it is ``uncorrected``. ``model_id`` is the id of the corrector artifact that produced the
# row, null for one that has none (the fake, the raw baseline).
CORRECTED_FORECAST_SCHEMA: Final = pl.Schema(
    {
        "station": pl.String(),
        "valid_time": pl.Datetime("us", "UTC"),
        "lead_days": pl.Int8(),
        "variable": pl.String(),
        "raw": pl.Float64(),
        **dict.fromkeys(QUANTILE_COLUMNS, pl.Float64()),
        "status": pl.String(),
        "model_id": pl.String(),
    }
)


def quantile_matrix(corrected: pl.DataFrame) -> F64:
    """The grid of every row of a corrected frame as an ``(n, 19)`` array, null as NaN."""
    return np.asarray(corrected.select(QUANTILE_COLUMNS).to_numpy(), dtype=np.float64).reshape(-1, len(LEVELS))
