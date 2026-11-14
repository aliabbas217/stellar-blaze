"""Contract checks that every ``ForecastCorrector`` implementation must pass; import them from the adapter's own test.

``assert_respects_history_cutoff`` pins pre-registration L3 at the port: a forecast issued on ``D - L`` may not use
truth (or past IFS forecasts) whose UTC valid date is later than ``D - L - 1``, even if the caller passed a window that
holds them. The fake passes it trivially; the LightGBM corrector's adapter test (Task 10b) calls it with its own inputs
and ``uses_history=True``.
"""

import polars as pl
from polars.testing import assert_frame_equal

from stellar_blaze.domain.forecast.schemas import VARIABLES
from stellar_blaze.ports.corrector import ForecastCorrector

_BIG = 100.0
_HISTORY_VALUES = ("t_c", "td_c", "wind_ms")
_FORECAST_VALUES = (*_HISTORY_VALUES, "sw_wm2", "direct_wm2")


def _perturbed(frame: pl.DataFrame, columns: tuple[str, ...], keep: pl.Expr) -> pl.DataFrame:
    """``frame`` with ``_BIG`` added to ``columns`` on the rows where ``keep`` holds."""
    return frame.with_columns(
        pl.when(keep).then(pl.col(name) + _BIG).otherwise(pl.col(name)).alias(name) for name in columns
    )


def assert_respects_history_cutoff(
    corrector: ForecastCorrector,
    *,
    ifs: pl.DataFrame,
    gfs: pl.DataFrame,
    history: pl.DataFrame,
    history_ifs: pl.DataFrame | None = None,
    uses_history: bool = False,
    max_rows: int = 6,
) -> None:
    """Fail unless ``corrector.correct`` ignores history later than each row's cutoff date (``D - lead_days - 1``).

    For up to ``max_rows`` rows of ``ifs`` (evenly spread, only rows for which ``history`` holds something after the
    cutoff, so the check is never vacuous), every value of ``history`` (and ``history_ifs``) with a UTC valid date later
    than ``D - lead_days - 1`` is shifted by a large amount; the four output rows of that forecast row must not change.
    If ``uses_history`` is false the corrector declares it does not use history at all, and the same shift applied to
    the rows before the cutoff must leave the output unchanged too. A corrector that declares ``uses_history`` may
    change its output there; nothing is asserted.

    Raises:
        AssertionError: The output changes, or there is no row to test.
    """
    baseline = corrector.correct(ifs=ifs, gfs=gfs, history=history, history_ifs=history_ifs)
    assert baseline.height == len(VARIABLES) * ifs.height, (
        "one output row per input row and variable is part of the port"
    )
    history_dates = history.select(pl.col("valid_time").dt.date().alias("d"))["d"]
    rows = ifs.with_row_index("_i").with_columns(
        (pl.col("valid_time").dt.date() - pl.duration(days=pl.col("lead_days").cast(pl.Int64) + 1)).alias("_cutoff")
    )
    latest = history_dates.max()
    candidates = rows.filter(pl.col("_cutoff") < latest)["_i"].to_list() if latest is not None else []
    assert candidates, "no row of ifs has history after its cutoff: the check would be vacuous, pass a longer history"
    step = max(1, len(candidates) // max_rows)
    for i in candidates[::step][:max_rows]:
        row = rows.row(i, named=True)
        cutoff = row["_cutoff"]
        block = slice(len(VARIABLES) * i, len(VARIABLES) * i + len(VARIABLES))
        after, before = pl.col("valid_time").dt.date() > cutoff, pl.col("valid_time").dt.date() <= cutoff
        for label, keep in (("later than the cutoff date", after), ("before the cutoff", before)):
            if keep is before and uses_history:
                continue
            shifted = corrector.correct(
                ifs=ifs,
                gfs=gfs,
                history=_perturbed(history, _HISTORY_VALUES, keep),
                history_ifs=None if history_ifs is None else _perturbed(history_ifs, _FORECAST_VALUES, keep),
            )
            try:
                assert_frame_equal(baseline[block], shifted[block])
            except AssertionError as error:
                raise AssertionError(
                    f"row {i} ({row['station']} {row['valid_time']} lead {row['lead_days']}, cutoff {cutoff}): the "
                    f"output changed when history {label} was shifted: {error}"
                ) from error
