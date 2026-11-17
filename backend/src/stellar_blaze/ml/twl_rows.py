"""TWL of whole frames of station-hours, through the product's own functions (ADR 0046, 0047).

Used by the theta rule (``ml.theta``) and the scoreboards (``ml.scoreboard_inputs``) so that the offline scoring and the
live path share ONE definition: ``twl_sample_matrix`` (globe, MRT, body wind, B1's solver), ``effective_twl`` (cap, then
margin), ``ZoneEdges``. Nothing here reads a file.

The station's latitude and longitude come from the station table, so a frame may mix stations (they are solved one
station at a time). A row with any missing input has a NaN TWL, never a filled one.
"""

from collections.abc import Callable
from typing import Final

import numpy as np
import polars as pl

from stellar_blaze.domain.config.runtime import EffectiveParams
from stellar_blaze.domain.physics.twl import WithdrawalLimits
from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.risk.levels import Zone, ZoneEdges, zone_of
from stellar_blaze.domain.risk.twl_samples import effective_twl, twl_sample_matrix, withdrawal_limits
from stellar_blaze.domain.rules.ruleset import Ruleset
from stellar_blaze.domain.weather.stations import station

__all__ = [
    "SITE_TIMEZONE",
    "danger_mask",
    "forward_effective",
    "frozen_withdrawal",
    "raw_twl",
    "truth_raw_twl",
]

SITE_TIMEZONE: Final = "Asia/Dubai"
"""The time zone of the abu_dhabi cluster (OMAA, OMAD): the scoreboards' local dates and the ban hours."""


def _per_station(frame: pl.DataFrame, solve: Callable[[np.ndarray, float, float], F64], width: int) -> F64:
    """Run ``solve(row_indices, lat, lon)`` per station and scatter the results back to the frame's row order."""
    out = np.full((frame.height, width) if width else (frame.height,), np.nan, dtype=np.float64)
    for icao in frame["station"].unique().to_list():
        rows = np.flatnonzero((frame["station"] == icao).to_numpy())
        where = station(icao)
        out[rows] = solve(rows, where.lat, where.lon)
    return out


def _column(frame: pl.DataFrame, name: str) -> F64:
    return np.asarray(frame[name].cast(pl.Float64).fill_null(float("nan")).to_numpy(), dtype=np.float64)


def _labels(frame: pl.DataFrame) -> np.ndarray:
    return np.asarray(frame["valid_time"].dt.replace_time_zone(None).to_numpy(), dtype="datetime64[us]")


def forward_effective(
    frame: pl.DataFrame,
    samples: F64,
    *,
    ruleset: Ruleset,
    params: EffectiveParams,
    sw: str = "fc_sw_wm2",
    direct: str = "fc_direct_wm2",
    pressure: str = "fc_pressure_hpa",
) -> F64:
    """Effective TWL ``(rows, n)`` of joint samples ``(rows, n, 3)`` aligned with ``frame`` (margin, then the cap)."""
    sw_a, direct_a, pressure_a, labels = (
        _column(frame, sw),
        _column(frame, direct),
        _column(frame, pressure),
        _labels(frame),
    )

    def solve(rows: np.ndarray, lat: float, lon: float) -> F64:
        chosen = np.asarray(samples[rows], dtype=np.float64)
        twl = twl_sample_matrix(
            chosen,
            sw_wm2=sw_a[rows],
            direct_wm2=direct_a[rows],
            pressure_hpa=pressure_a[rows],
            valid_time_utc=labels[rows],
            lat=lat,
            lon=lon,
        )
        return effective_twl(
            twl,
            margin_w_m2=params.twl_margin_w_m2,
            withdrawal=withdrawal_limits(ruleset),
            t_c=chosen[:, :, 0],
            tnwb_c=None,
        )

    return _per_station(frame, solve, samples.shape[1])


def raw_twl(frame: pl.DataFrame, t: str, td: str, wind: str, sw: str, direct: str, pressure: str) -> F64:
    """TWL in W/m2 (no margin, no cap) of one (t, td, wind) per row with the named radiation and pressure columns.

    NaN where any input is null or unusable. The truth uses the observations with the lead-0 radiation and pressure
    (assumption A2, ADR 0005); the raw forecast uses the forecast's own.
    """
    values = np.stack([_column(frame, t), _column(frame, td), _column(frame, wind)], axis=1)[:, None, :]
    sw_a, direct_a, pressure_a, labels = (
        _column(frame, sw),
        _column(frame, direct),
        _column(frame, pressure),
        _labels(frame),
    )

    def solve(rows: np.ndarray, lat: float, lon: float) -> F64:
        return twl_sample_matrix(
            values[rows],
            sw_wm2=sw_a[rows],
            direct_wm2=direct_a[rows],
            pressure_hpa=pressure_a[rows],
            valid_time_utc=labels[rows],
            lat=lat,
            lon=lon,
        )[:, 0]

    return _per_station(frame, solve, 0)


def truth_raw_twl(frame: pl.DataFrame) -> F64:
    """Truth TWL (no margin) of the observed T, Td and wind of a frame with the ``ref_*`` radiation and pressure.

    Rows without ``has_joint_obs`` are NaN: a truth that is not fully observed is never computed from a part.
    """
    value = raw_twl(frame, "obs_t_c", "obs_td_c", "obs_wind_ms", "ref_sw_wm2", "ref_direct_wm2", "ref_pressure_hpa")
    observed = frame["has_joint_obs"].fill_null(False).to_numpy()
    return np.where(observed, value, np.nan)


def frozen_withdrawal(ruleset: Ruleset) -> WithdrawalLimits:
    """The ruleset's withdrawal limits whatever its ``enabled`` switch says (the sensitivity cell "withdrawal on").

    Callers pass no natural wet bulb, so the cap is the dry-bulb leg only (> 44 C): no natural wet-bulb source exists,
    so the second leg of the ADR 0006 rule is not applied.
    """
    section = ruleset.twl_withdrawal
    return WithdrawalLimits(
        dry_bulb_c=section.dry_bulb_c, natural_wet_bulb_c=section.natural_wet_bulb_c, cap_w_m2=section.cap_w_m2
    )


def danger_mask(twl_eff: F64, edges: ZoneEdges) -> np.ndarray:
    """True where the effective TWL is in the High or Red zone (a danger hour; amendment 1: "High" is High or Red)."""
    return np.asarray(zone_of(twl_eff, edges) >= int(Zone.HIGH))
