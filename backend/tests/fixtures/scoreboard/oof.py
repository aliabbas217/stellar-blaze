"""A synthetic ``oof_samples_abu_dhabi.parquet`` frame with designed outcomes (the columns B2's exporter documents).

A row is built from two physical states whose zones the tests assert (so a change of the TWL maths that moves them is
caught there and not as a puzzling rule failure): HIGH (38 C, Td 20, wind 2 m/s: raw TWL about 107, effective about 100,
zone High) and LOW (30 C, Td 12, wind 3 m/s: zone Low), both under radiation 800/600 W/m2 at 1000 hPa. ``k_high`` of the
50 joint samples are in the HIGH state, the rest in LOW, so P(High) of the row is exactly ``k_high / 50``; the truth is
the HIGH or the LOW state (or unobserved).
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

import numpy as np
import polars as pl

HIGH = (38.0, 20.0, 2.0)
LOW = (30.0, 12.0, 3.0)
SW, DIRECT, PRESSURE = 800.0, 600.0, 1000.0
N_SAMPLES = 50


@dataclass(frozen=True)
class Hour:
    """One OOF row: when, how many of the 50 samples are HIGH, and the truth."""

    valid_time: datetime
    k_high: int
    truth: Literal["high", "low", "none"]
    station: str = "OMAA"
    summer: int | None = None  # default: the year of valid_time
    cluster: str = "abu_dhabi"


def utc(year: int, month: int, day: int, hour: int) -> datetime:
    return datetime(year, month, day, hour, tzinfo=UTC)


def off_season(index: int, *, hour: int = 10) -> datetime:
    """Day ``index`` after 14 May 2025 (all before 15 June, so a ban weight of 1) at ``hour`` UTC."""
    return utc(2025, 5, 14, hour) + timedelta(days=index + 1)


def oof_frame(hours: list[Hour]) -> pl.DataFrame:
    n = len(hours)
    samples = np.empty((n, N_SAMPLES, 3), dtype=np.float32)
    for i, row in enumerate(hours):
        samples[i, : row.k_high] = HIGH
        samples[i, row.k_high :] = LOW
    obs = [None if h.truth == "none" else (HIGH if h.truth == "high" else LOW) for h in hours]

    def column(name: str, values: list[float | None]) -> pl.Series:
        return pl.Series(name, values, dtype=pl.Float64)

    return pl.DataFrame(
        {
            "station": [h.station for h in hours],
            "cluster": [h.cluster for h in hours],
            "valid_time": pl.Series([h.valid_time for h in hours], dtype=pl.Datetime("us", "UTC")),
            "summer": pl.Series([h.summer or h.valid_time.year for h in hours], dtype=pl.Int16),
            "lead_days": pl.Series([1] * n, dtype=pl.Int8),
            "raw_t": column("raw_t", [HIGH[0]] * n),
            "raw_td": column("raw_td", [HIGH[1]] * n),
            "raw_wind": column("raw_wind", [HIGH[2]] * n),
            "wbgt_fc_c": column("wbgt_fc_c", [33.0] * n),
            "fc_sw_wm2": column("fc_sw_wm2", [SW] * n),
            "fc_direct_wm2": column("fc_direct_wm2", [DIRECT] * n),
            "fc_pressure_hpa": column("fc_pressure_hpa", [PRESSURE] * n),
            "ref_sw_wm2": column("ref_sw_wm2", [SW] * n),
            "ref_direct_wm2": column("ref_direct_wm2", [DIRECT] * n),
            "ref_pressure_hpa": column("ref_pressure_hpa", [PRESSURE] * n),
            "obs_t_c": column("obs_t_c", [None if o is None else o[0] for o in obs]),
            "obs_td_c": column("obs_td_c", [None if o is None else o[1] for o in obs]),
            "obs_wind_ms": column("obs_wind_ms", [None if o is None else o[2] for o in obs]),
            "has_joint_obs": pl.Series([o is not None for o in obs], dtype=pl.Boolean),
            "samples": pl.Series("samples", samples, dtype=pl.Array(pl.Float32, (N_SAMPLES, 3))),
        }
    )
