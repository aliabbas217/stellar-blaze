"""Frames the ingestion, dataset and store tests share (kept apart from the ``test_*`` modules so it is imported, not
collected)."""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

import polars as pl

from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, OBS_HOURLY_SCHEMA, OBS_RAW_SCHEMA

MIDDAY = datetime(2025, 7, 1, 10, tzinfo=UTC)


def hours_from(first: datetime, count: int) -> list[datetime]:
    return [first + timedelta(hours=i) for i in range(count)]


def forecast_rows(
    icao: str,
    model: NwpModel,
    *,
    hours: Sequence[datetime],
    leads: Sequence[int],
    t_c: float | None = 35.0,
    td_c: float | None = 12.0,
    wind_ms: float | None = 4.0,
    sw_wm2: float | None = 800.0,
    direct_wm2: float | None = 600.0,
    pressure_hpa: float | None = 1000.0,
) -> pl.DataFrame:
    """One ``FORECAST_SCHEMA`` row per hour and lead, hour by hour, with constant values."""
    rows = [(hour, lead) for hour in hours for lead in leads]
    n = len(rows)
    return pl.DataFrame(
        {
            "station": [icao] * n,
            "model": [model.value] * n,
            "valid_time": [hour for hour, _ in rows],
            "lead_days": [lead for _, lead in rows],
            "t_c": [t_c] * n,
            "td_c": [td_c] * n,
            "wind_ms": [wind_ms] * n,
            "sw_wm2": [sw_wm2] * n,
            "direct_wm2": [direct_wm2] * n,
            "pressure_hpa": [pressure_hpa] * n,
            "grid_lat": [24.5] * n,
            "grid_lon": [54.75] * n,
            "grid_elev_m": [16.0] * n,
        },
        schema=FORECAST_SCHEMA,
    )


def hourly_obs(
    icao: str,
    hours: Sequence[datetime],
    *,
    source: str = "iem",
    t_c: float | None = 36.0,
    td_c: float | None = 14.0,
    wind_ms: float | None = 3.0,
) -> pl.DataFrame:
    """One ``OBS_HOURLY_SCHEMA`` row per hour, with constant values."""
    n = len(hours)
    return pl.DataFrame(
        {
            "station": [icao] * n,
            "valid_time": list(hours),
            "t_c": [t_c] * n,
            "td_c": [td_c] * n,
            "wind_ms": [wind_ms] * n,
            "source": [source] * n,
        },
        schema=OBS_HOURLY_SCHEMA,
    )


def raw_reports(icao: str, reports: Sequence[dict[str, Any]], *, source: str = "iem") -> pl.DataFrame:
    """``OBS_RAW_SCHEMA`` rows; each dict gives ``obs_time`` and any of ``t_c``, ``td_c``, ``wind_ms``, ``qc_*``."""
    rows = [
        {"station": icao, "t_c": None, "td_c": None, "wind_ms": None, "qc_t": None, "qc_td": None, "qc_wind": None}
        | report
        | {"source": source}
        for report in reports
    ]
    return pl.DataFrame(rows, schema=OBS_RAW_SCHEMA)


def gold_row(*, hour_offset: int = 0, **overrides: Any) -> dict[str, Any]:
    """A complete ``GOLD_PAIRS_SCHEMA`` row (OMAA, IFS, lead 1, in the working daytime unless overridden)."""
    valid_time = MIDDAY + timedelta(hours=hour_offset)
    row: dict[str, Any] = {
        "station": "OMAA",
        "cluster": "abu_dhabi",
        "model": "ecmwf_ifs025",
        "summer": valid_time.year,
        "valid_time": valid_time,
        "lead_days": 1,
        "hour_utc": valid_time.hour,
        "doy": valid_time.timetuple().tm_yday,
        "is_daytime": 6 <= valid_time.hour <= 14,
        "station_elev_m": 26.8,
        "grid_lat": 24.5,
        "grid_lon": 54.75,
        "grid_elev_m": 16.0,
        "fc_t_c": 35.0,
        "fc_td_c": 12.0,
        "fc_wind_ms": 4.0,
        "fc_sw_wm2": 800.0,
        "fc_direct_wm2": 600.0,
        "fc_pressure_hpa": 1000.0,
        "ref_sw_wm2": 810.0,
        "ref_direct_wm2": 610.0,
        "ref_pressure_hpa": 1001.0,
        "obs_t_c": 36.0,
        "obs_td_c": 14.0,
        "obs_wind_ms": 3.0,
        "has_joint_obs": True,
        "audit_t_c": 36.0,
        "audit_td_c": 14.0,
        "audit_wind_ms": 3.0,
        "wbgt_obs_c": 30.0,
        "wbgt_fc_c": 29.0,
        "wbgt_fc_refrad_c": 29.5,
        "wbgt_obs_reject": 0,
        "wbgt_fc_reject": 0,
        "wbgt_fc_refrad_reject": 0,
    }
    return row | overrides
