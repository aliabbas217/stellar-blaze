from datetime import UTC, datetime

import polars as pl
import pytest

from stellar_blaze.domain.weather.schemas import (
    FORECAST_SCHEMA,
    OBS_HOURLY_SCHEMA,
    OBS_RAW_SCHEMA,
    SchemaMismatchError,
    conform,
)

pytestmark = pytest.mark.unit

UTC_US = pl.Datetime("us", "UTC")
SMALL = {"station": pl.String(), "valid_time": UTC_US, "t_c": pl.Float64()}


def small_frame() -> pl.DataFrame:
    return pl.DataFrame(
        {"station": ["OMDB"], "valid_time": [datetime(2026, 6, 1, 1, tzinfo=UTC)], "t_c": [31.0]},
        schema=SMALL,
    )


def test_obs_raw_schema() -> None:
    assert dict(OBS_RAW_SCHEMA) == {
        "station": pl.String(),
        "obs_time": UTC_US,
        "t_c": pl.Float64(),
        "td_c": pl.Float64(),
        "wind_ms": pl.Float64(),
        "qc_t": pl.String(),
        "qc_td": pl.String(),
        "qc_wind": pl.String(),
        "source": pl.String(),
    }


def test_obs_hourly_schema() -> None:
    assert list(OBS_HOURLY_SCHEMA) == ["station", "valid_time", "t_c", "td_c", "wind_ms", "source"]
    assert OBS_HOURLY_SCHEMA["valid_time"] == UTC_US
    assert all(OBS_HOURLY_SCHEMA[c] == pl.Float64() for c in ("t_c", "td_c", "wind_ms"))


def test_forecast_schema() -> None:
    floats = ["t_c", "td_c", "wind_ms", "sw_wm2", "direct_wm2", "pressure_hpa", "grid_lat", "grid_lon", "grid_elev_m"]
    assert list(FORECAST_SCHEMA) == ["station", "model", "valid_time", "lead_days", *floats]
    assert FORECAST_SCHEMA["model"] == pl.String()
    assert FORECAST_SCHEMA["valid_time"] == UTC_US
    assert FORECAST_SCHEMA["lead_days"] == pl.Int8()
    assert all(FORECAST_SCHEMA[c] == pl.Float64() for c in floats)


def test_schema_error_is_a_value_error() -> None:
    assert issubclass(SchemaMismatchError, ValueError)


def test_conform_selects_and_orders_the_schema_columns() -> None:
    df = small_frame().with_columns(extra=pl.lit(1)).select("t_c", "extra", "valid_time", "station")
    out = conform(df, SMALL)
    assert out.columns == ["station", "valid_time", "t_c"]
    assert out.schema == pl.Schema(SMALL)
    assert out.row(0) == ("OMDB", datetime(2026, 6, 1, 1, tzinfo=UTC), 31.0)


def test_conform_missing_column_raises_naming_it() -> None:
    with pytest.raises(SchemaMismatchError, match=r"missing.*'t_c'"):
        conform(small_frame().drop("t_c"), SMALL)


def test_conform_wrong_dtype_raises_naming_the_column_and_never_casts() -> None:
    df = small_frame().with_columns(pl.col("t_c").cast(pl.Int64))
    with pytest.raises(SchemaMismatchError, match=r"'t_c'.*Float64.*Int64"):
        conform(df, SMALL)


def test_conform_reports_every_problem_at_once() -> None:
    df = small_frame().drop("station").with_columns(pl.col("t_c").cast(pl.Float32))
    with pytest.raises(SchemaMismatchError) as excinfo:
        conform(df, SMALL)
    assert "'station'" in str(excinfo.value)
    assert "'t_c'" in str(excinfo.value)


def test_conform_rejects_a_naive_datetime_for_a_utc_column() -> None:
    df = small_frame().with_columns(pl.col("valid_time").dt.replace_time_zone(None))
    with pytest.raises(SchemaMismatchError, match="'valid_time'"):
        conform(df, SMALL)


def test_conform_rejects_an_all_null_column_of_dtype_null() -> None:
    # An adapter that has nothing for a String column must say so with a typed null, not rely on inference.
    df = small_frame().with_columns(station=pl.lit(None))
    with pytest.raises(SchemaMismatchError, match="'station'"):
        conform(df, SMALL)


def test_conform_accepts_an_empty_typed_frame() -> None:
    assert conform(pl.DataFrame(schema=OBS_RAW_SCHEMA), OBS_RAW_SCHEMA).schema == OBS_RAW_SCHEMA
