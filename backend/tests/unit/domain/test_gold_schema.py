"""``GOLD_PAIRS_SCHEMA``: the gold dataset's columns, their order and their dtypes are a contract with B2."""

import polars as pl
import pytest

from stellar_blaze.domain.weather.schemas import GOLD_PAIRS_SCHEMA

pytestmark = pytest.mark.unit

UTC_US = pl.Datetime("us", "UTC")


def test_gold_pairs_schema_has_the_documented_columns_in_order() -> None:
    expected = {
        # keys
        "station": pl.String(),
        "cluster": pl.String(),
        "model": pl.String(),
        "summer": pl.Int16(),
        "valid_time": UTC_US,
        "lead_days": pl.Int8(),
        "hour_utc": pl.Int8(),
        "doy": pl.Int16(),
        "is_daytime": pl.Boolean(),
        # geometry
        "station_elev_m": pl.Float64(),
        "grid_lat": pl.Float64(),
        "grid_lon": pl.Float64(),
        "grid_elev_m": pl.Float64(),
        # forecast
        "fc_t_c": pl.Float64(),
        "fc_td_c": pl.Float64(),
        "fc_wind_ms": pl.Float64(),
        "fc_sw_wm2": pl.Float64(),
        "fc_direct_wm2": pl.Float64(),
        "fc_pressure_hpa": pl.Float64(),
        # reference (IFS lead 0 at the same station and hour)
        "ref_sw_wm2": pl.Float64(),
        "ref_direct_wm2": pl.Float64(),
        "ref_pressure_hpa": pl.Float64(),
        # truth (IEM, binned)
        "obs_t_c": pl.Float64(),
        "obs_td_c": pl.Float64(),
        "obs_wind_ms": pl.Float64(),
        "has_joint_obs": pl.Boolean(),
        # audit (GHCNh lenient, binned)
        "audit_t_c": pl.Float64(),
        "audit_td_c": pl.Float64(),
        "audit_wind_ms": pl.Float64(),
        # WBGT
        "wbgt_obs_c": pl.Float64(),
        "wbgt_fc_c": pl.Float64(),
        "wbgt_fc_refrad_c": pl.Float64(),
        "wbgt_obs_reject": pl.Int8(),
        "wbgt_fc_reject": pl.Int8(),
        "wbgt_fc_refrad_reject": pl.Int8(),
    }

    assert dict(GOLD_PAIRS_SCHEMA) == expected
    assert list(GOLD_PAIRS_SCHEMA) == list(expected)
