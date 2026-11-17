"""TWL of the joint forecast samples, and the effective TWL that the zones are read from (ADR 0046, ADR 0047).

``twl_sample_matrix`` turns the ``(rows, n, 3)`` samples of ``ForecastCorrector.sample`` (t, td, 10 m wind) and the raw
IFS radiation and pressure of the same rows into a ``(rows, n)`` matrix of TWL in W/m2: the mean radiant temperature
comes from the Liljegren globe (``wbgt.globe_temperature_c``, ``wbgt.mrt_from_globe_c``), the body-level wind from
``twl.body_level_wind_ms``, and the solver is B1's ``twl_w_m2_array``. Truth TWL uses the same function with samples of
shape ``(rows, 1, 3)``: the observed (t, td, wind) and the lead-0 radiation and pressure (assumption A2, ADR 0005).
``effective_twl`` then applies the withdrawal cap (when it is enabled) and subtracts the margin.

Cost: ``twl_w_m2_array`` is a scalar bisection per element, about 160 to 200 s per million elements; keep the number of
elements of a call to what the caller needs.
"""

from typing import Final

import numpy as np
from numpy.typing import NDArray

from stellar_blaze.domain.physics.psychrometrics import vapor_pressure_kpa_from_dewpoint
from stellar_blaze.domain.physics.twl import (
    WithdrawalLimits,
    apply_withdrawal_limits,
    body_level_wind_ms,
    twl_w_m2_array,
)
from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.physics.wbgt import globe_temperature_c, mrt_from_globe_c
from stellar_blaze.domain.rules.ruleset import Ruleset

_HPA_PER_KPA: Final = 10.0


def withdrawal_limits(ruleset: Ruleset) -> WithdrawalLimits | None:
    """The ruleset's withdrawal limits as the physics dataclass, or ``None`` while its ``enabled`` switch is off.

    ``effective_twl`` applies the cap only when it is given limits, so ``None`` is "off" (off in ``ae-heat-2026.1``,
    ADR 0047 decision 2).
    """
    section = ruleset.twl_withdrawal
    if not section.enabled:
        return None
    return WithdrawalLimits(
        dry_bulb_c=section.dry_bulb_c, natural_wet_bulb_c=section.natural_wet_bulb_c, cap_w_m2=section.cap_w_m2
    )


def twl_sample_matrix(
    samples: F64,
    *,
    sw_wm2: F64,
    direct_wm2: F64,
    pressure_hpa: F64,
    valid_time_utc: NDArray[np.datetime64],
    lat: float,
    lon: float,
) -> F64:
    """TWL in W/m2 for every joint sample: shape ``(rows, n)``, NaN where any input is missing or unusable.

    Row ``i`` shares its radiation, pressure and hour-ending label across its ``n`` samples. A NaN anywhere in a
    sample's (t, td, wind), a missing or incoherent radiation, or a pressure that is not above zero (or not above the
    vapor pressure at the dew point) gives NaN for that sample alone; it is excluded from probabilities downstream
    (ADR 0046 decision 3). The real corrector's samples satisfy ``td <= t`` and ``wind >= 0``; ``FakeCorrector``'s do
    not, so the dew point is limited to the air temperature (the air cannot hold more than saturation) and a negative
    wind to 0 (a speed is not negative) before the solve, instead of raising. The input array is not modified.

    Args:
        samples: Joint samples, shape ``(rows, n, 3)`` with (t in C, td in C, 10 m wind in m/s) on the last axis.
        sw_wm2: Downward shortwave radiation per row in W/m2, shape ``(rows,)``, mean over the preceding hour.
        direct_wm2: Direct-beam shortwave radiation per row in W/m2, shape ``(rows,)``.
        pressure_hpa: Surface pressure per row in hPa, shape ``(rows,)``.
        valid_time_utc: Hour-ending labels per row, naive ``datetime64`` meaning UTC, shape ``(rows,)``.
        lat: Latitude in degrees north.
        lon: Longitude in degrees east.

    Raises:
        ValueError: ``samples`` is not ``(rows, n, 3)`` or a per-row array is not ``(rows,)``.
    """
    values = np.asarray(samples, dtype=np.float64)
    if values.ndim != 3 or values.shape[2] != 3:
        raise ValueError(f"samples must have shape (rows, n, 3), got {values.shape}")
    rows, n, _ = values.shape
    per_row = [np.asarray(a) for a in (sw_wm2, direct_wm2, pressure_hpa, valid_time_utc)]
    if any(a.shape != (rows,) for a in per_row):
        raise ValueError(f"sw_wm2, direct_wm2, pressure_hpa and valid_time_utc must have shape ({rows},) like the rows")

    t = values[:, :, 0]
    td = np.minimum(values[:, :, 1], t)  # NaN stays NaN: np.minimum propagates it
    wind = np.where(values[:, :, 2] < 0.0, 0.0, values[:, :, 2])
    sw, direct, pressure, labels = (np.broadcast_to(a[:, None], (rows, n)) for a in per_row)
    pressure_f = np.asarray(pressure, dtype=np.float64)
    pressure_f = np.where(pressure_f > 0.0, pressure_f, np.nan)  # a pressure that is not above zero is unusable

    globe = globe_temperature_c(
        t_c=t,
        td_c=td,
        wind10m_ms=wind,
        pressure_hpa=pressure_f,
        sw_wm2=np.asarray(sw, dtype=np.float64),
        direct_wm2=np.asarray(direct, dtype=np.float64),
        lat=lat,
        lon=lon,
        valid_time_utc=labels,
    )
    mrt = mrt_from_globe_c(t_c=t, globe_c=globe, wind10m_ms=wind)

    pressure_kpa = pressure_f / _HPA_PER_KPA
    with np.errstate(invalid="ignore"):
        solvable = vapor_pressure_kpa_from_dewpoint(td) < pressure_kpa  # False for NaN too
    mrt = np.where(solvable, mrt, np.nan)
    return twl_w_m2_array(
        t_c=t,
        td_c=td,
        wind_body_ms=body_level_wind_ms(wind),
        pressure_kpa=np.where(solvable, pressure_kpa, 1.0),
        mrt_c=mrt,
    )


def effective_twl(
    twl: F64,
    *,
    margin_w_m2: float,
    withdrawal: WithdrawalLimits | None,
    t_c: F64,
    tnwb_c: F64 | None,
) -> F64:
    """The effective TWL: the withdrawal cap first (only when ``withdrawal`` is given), then minus the margin.

    Cap first, then margin (ADR 0047 decision 2): a cap of exactly 115 is Medium under the boundary convention, but
    115 minus the margin is High. NaN stays NaN.

    Args:
        twl: TWL in W/m2.
        margin_w_m2: The bias margin (``twl_margin_w_m2``), subtracted from every value.
        withdrawal: The limits, or ``None`` when the ruleset's switch is off (``withdrawal_limits``).
        t_c: Dry-bulb temperature in degrees Celsius, for the cap.
        tnwb_c: Natural wet-bulb temperature in degrees Celsius for the cap, or ``None`` if there is none.
    """
    values = np.asarray(twl, dtype=np.float64)
    if withdrawal is not None:
        values = apply_withdrawal_limits(values, t_c=t_c, natural_wet_bulb_c=tnwb_c, limits=withdrawal)
    return np.asarray(values - margin_w_m2, dtype=np.float64)
