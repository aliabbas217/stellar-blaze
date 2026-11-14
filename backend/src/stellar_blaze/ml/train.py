"""Training entry points of the forecast corrector (this task: the WBGT helpers only; Task 10a completes the module).

WBGT is carried two ways (pre-registration section 3.1, ADR 0007), and the section 6.3 selection rule picks one:

* **joint**: ``wbgt_joint_grid`` runs Liljegren on 50 joint (T, Td, wind) samples and takes their quantiles. The
  computation is ``domain.forecast.sampling.wbgt_joint_grid`` (arrays in, so serving code can use it without importing
  this package); this module only maps a gold-shaped row frame onto its arguments.
* **direct**: ``wbgt_direct_grid`` is the WBGT quantile model's grid.

Both grids are *distribution* grids only up to the caller's own arithmetic: the joint grid is already in WBGT units (the
samples were corrected values), the direct grid is an ERROR grid (truth minus forecast, like every target here) to which
the caller adds the raw forecast WBGT and then the conformal offsets.
"""

from collections.abc import Sequence

import lightgbm as lgb
import polars as pl

from stellar_blaze.adapters.compute.lgbm_corrector import predict_grid
from stellar_blaze.domain.forecast.grid import F64
from stellar_blaze.domain.forecast.sampling import WbgtJointGrid
from stellar_blaze.domain.forecast.sampling import wbgt_joint_grid as _wbgt_joint_grid
from stellar_blaze.domain.weather.stations import station

__all__ = ["wbgt_direct_grid", "wbgt_joint_grid"]

_ROW_COLUMNS = ("station", "valid_time", "fc_sw_wm2", "fc_direct_wm2", "fc_pressure_hpa")


def _float_column(rows: pl.DataFrame, name: str) -> F64:
    """A column as float64, a null as NaN (the solver rejects it as non-finite input, like the gold build does)."""
    return rows[name].cast(pl.Float64()).to_numpy().astype("float64", copy=False)


def wbgt_joint_grid(samples: F64, rows: pl.DataFrame) -> WbgtJointGrid:
    """The WBGT quantile grid of joint samples, from a gold-shaped row frame (``GOLD_PAIRS_SCHEMA`` columns).

    The radiation and pressure are the FORECAST's own (``fc_sw_wm2``, ``fc_direct_wm2``, ``fc_pressure_hpa``), never the
    ``ref_*`` reference columns: the corrected WBGT is compared with a truth built from the reference radiation, but its
    uncertainty is that of the forecast, which carries its own radiation, exactly as the gold ``wbgt_fc_c`` does. The
    coordinates are the station's (``STATIONS``, as ``build_pairs``) and the time is ``valid_time`` (UTC-aware).

    Args:
        samples: ``(n, n_samples, 3)`` value samples of (t, td, wind), row ``i`` belonging to ``rows`` row ``i``.
        rows: The frame, with columns ``station``, ``valid_time``, ``fc_sw_wm2``, ``fc_direct_wm2`` and
            ``fc_pressure_hpa``.

    Returns:
        ``WbgtJointGrid``: the ``(n, 19)`` quantiles and the per-row count of finite samples (a row with some rejected
        samples uses the finite ones; a row with none is all-NaN with count 0).

    Raises:
        ValueError: A column is missing or ``valid_time`` holds a null, or ``samples`` has a different number of rows.
        KeyError: A station is not one of ``STATIONS``.
    """
    missing = [name for name in _ROW_COLUMNS if name not in rows.columns]
    if missing:
        raise ValueError(f"the frame lacks the columns {missing}")
    if samples.shape[0] != rows.height:
        raise ValueError(f"samples has {samples.shape[0]} rows but the frame has {rows.height}")
    if rows["valid_time"].null_count() or rows["station"].null_count():
        raise ValueError("station and valid_time must not be null")
    where = {icao: station(icao) for icao in rows["station"].unique().to_list()}
    lat = rows["station"].replace_strict({icao: s.lat for icao, s in where.items()}, return_dtype=pl.Float64())
    lon = rows["station"].replace_strict({icao: s.lon for icao, s in where.items()}, return_dtype=pl.Float64())
    return _wbgt_joint_grid(
        samples,
        valid_time=rows["valid_time"].to_list(),
        lat=lat.to_numpy(),
        lon=lon.to_numpy(),
        sw_wm2=_float_column(rows, "fc_sw_wm2"),
        direct_wm2=_float_column(rows, "fc_direct_wm2"),
        pressure_hpa=_float_column(rows, "fc_pressure_hpa"),
    )


def wbgt_direct_grid(boosters: Sequence[lgb.Booster], x: F64) -> F64:
    """The sorted ``(n, 19)`` grid of predicted WBGT ERROR quantiles (truth minus forecast) of the direct model.

    The same convention as every other target (``predict_grid``): the caller adds the raw forecast WBGT
    (``wbgt_fc_c``) and then the conformal offsets to get corrected WBGT quantiles.

    Raises:
        ValueError: There are not 19 boosters, or ``x`` is not a 2-D float64 array.
    """
    return predict_grid(boosters, x)
