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

# The gold pair dataset: one row per forecast row (station, model, valid hour and lead), carrying the geometry, the
# forecast, the IFS lead-0 reference, the IEM truth, the GHCNh audit values and three WBGT variants. The column groups:
#   keys      station, cluster, model, summer, valid_time, lead_days, hour_utc, doy, is_daytime
#   geometry  station_elev_m and the forecast grid cell
#   forecast  fc_*          the model's own values at that lead
#   reference ref_*         IFS (ecmwf_ifs025) lead-0 radiation and pressure at the same station and hour
#   truth     obs_*         IEM METAR, binned; has_joint_obs is true when all three are present
#   audit     audit_*       GHCNh with lenient QC, binned (a QC-flagged value is null here and counted in the manifest)
#   wbgt      wbgt_*_c      Liljegren WBGT (MIDPOINT) from obs + ref, from the forecast alone, and from the forecast
#                           with the reference radiation and pressure; *_reject is the WbgtReject code.
# A missing reference, truth or audit value is null. A WBGT that was rejected is NaN (not null, it is numpy output) and
# its *_reject column says why; filter on ``*_reject == 0`` rather than on ``is_not_null``.
GOLD_PAIRS_SCHEMA: Final = pl.Schema(
    {
        "station": pl.String(),
        "cluster": pl.String(),
        "model": pl.String(),
        "summer": pl.Int16(),
        "valid_time": _UTC_US,
        "lead_days": pl.Int8(),
        "hour_utc": pl.Int8(),
        "doy": pl.Int16(),
        "is_daytime": pl.Boolean(),
        "station_elev_m": pl.Float64(),
        "grid_lat": pl.Float64(),
        "grid_lon": pl.Float64(),
        "grid_elev_m": pl.Float64(),
        "fc_t_c": pl.Float64(),
        "fc_td_c": pl.Float64(),
        "fc_wind_ms": pl.Float64(),
        "fc_sw_wm2": pl.Float64(),
        "fc_direct_wm2": pl.Float64(),
        "fc_pressure_hpa": pl.Float64(),
        "ref_sw_wm2": pl.Float64(),
        "ref_direct_wm2": pl.Float64(),
        "ref_pressure_hpa": pl.Float64(),
        "obs_t_c": pl.Float64(),
        "obs_td_c": pl.Float64(),
        "obs_wind_ms": pl.Float64(),
        "has_joint_obs": pl.Boolean(),
        "audit_t_c": pl.Float64(),
        "audit_td_c": pl.Float64(),
        "audit_wind_ms": pl.Float64(),
        "wbgt_obs_c": pl.Float64(),
        "wbgt_fc_c": pl.Float64(),
        "wbgt_fc_refrad_c": pl.Float64(),
        "wbgt_obs_reject": pl.Int8(),
        "wbgt_fc_reject": pl.Int8(),
        "wbgt_fc_refrad_reject": pl.Int8(),
    }
)


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
