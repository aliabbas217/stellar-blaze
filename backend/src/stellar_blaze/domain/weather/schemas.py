"""Polars schemas of the weather frames that cross the ports, and ``conform`` to enforce them.

Times are microsecond, UTC-aware ``Datetime`` columns; temperatures are in degrees Celsius, wind in meters per second.
"""

from collections.abc import Mapping
from typing import Final

import polars as pl

_UTC_US = pl.Datetime("us", "UTC")

# One row per report as a source delivered it, before binning. The qc_* columns are the source's per-value quality
# codes (GHCNh); a source without codes (IEM) delivers them as typed nulls, not as an untyped null column.
OBS_RAW_SCHEMA: Final = pl.Schema(
    {
        "station": pl.String(),
        "obs_time": _UTC_US,
        "t_c": pl.Float64(),
        "td_c": pl.Float64(),
        "wind_ms": pl.Float64(),
        "qc_t": pl.String(),
        "qc_td": pl.String(),
        "qc_wind": pl.String(),
        "source": pl.String(),
    }
)

# One row per station, source and nearest UTC hour, after binning.
OBS_HOURLY_SCHEMA: Final = pl.Schema(
    {
        "station": pl.String(),
        "valid_time": _UTC_US,
        "t_c": pl.Float64(),
        "td_c": pl.Float64(),
        "wind_ms": pl.Float64(),
        "source": pl.String(),
    }
)

# One row per station, model, valid hour and lead (days before the valid time) with the forecast and its grid cell.
FORECAST_SCHEMA: Final = pl.Schema(
    {
        "station": pl.String(),
        "model": pl.String(),
        "valid_time": _UTC_US,
        "lead_days": pl.Int8(),
        "t_c": pl.Float64(),
        "td_c": pl.Float64(),
        "wind_ms": pl.Float64(),
        "sw_wm2": pl.Float64(),
        "direct_wm2": pl.Float64(),
        "pressure_hpa": pl.Float64(),
        "grid_lat": pl.Float64(),
        "grid_lon": pl.Float64(),
        "grid_elev_m": pl.Float64(),
    }
)

# GOLD_PAIRS_SCHEMA is added to this module by Task 10 (dataset building), which defines its columns.


class SchemaMismatchError(ValueError):
    """A frame does not have the columns and dtypes its schema requires."""


def conform(df: pl.DataFrame, schema: Mapping[str, pl.DataType]) -> pl.DataFrame:
    """Return ``df`` restricted to the schema's columns, in the schema's order.

    A frame that does not match is rejected, never repaired: there is no cast, so an integer column where a float is
    required, a naive datetime where a UTC one is required, or an untyped all-null column is an error the producer
    must fix. Columns the schema does not name are dropped.

    Raises:
        SchemaMismatchError: Columns are missing or have the wrong dtype; the message names every one of them.
    """
    actual = df.schema
    missing = [name for name in schema if name not in actual]
    wrong = [
        f"{name!r} (expected {dtype}, got {actual[name]})"
        for name, dtype in schema.items()
        if name in actual and actual[name] != dtype
    ]
    if missing or wrong:
        problems = []
        if missing:
            problems.append(f"missing columns: {', '.join(repr(name) for name in missing)}")
        if wrong:
            problems.append(f"wrong dtypes: {', '.join(wrong)}")
        raise SchemaMismatchError("; ".join(problems))
    return df.select(list(schema))
