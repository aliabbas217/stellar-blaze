"""Psychrometric relations between dew point, wet bulb, vapor pressure and relative humidity.

Every function is vectorized: it takes anything NumPy can read as floats (a scalar, a list, an array of any shape;
arguments broadcast against each other) and returns a ``float64`` array of the broadcast shape. A scalar argument gives
a zero-dimensional array, which behaves as a float in arithmetic; use ``float(...)`` where a plain float is required.
NaN in gives NaN out. Temperatures are in degrees Celsius, vapor pressures in kPa and air pressure in hPa.

The formulas are valid for liquid water and ordinary air temperatures; behavior outside roughly -40 to 60 degrees
Celsius is not specified, and callers screen raw data for plausibility first.
"""

import math
from typing import Final

import numpy as np
from numpy.typing import ArrayLike

from stellar_blaze.domain.physics.types import F64

_HPA_PER_KPA: Final = 10.0

# Bracket and tolerance of the dew-point inversion. Bisection halves the bracket each step and returns its midpoint, so
# n steps leave an error of at most (high - low) / 2**(n + 1); the step count is the smallest that meets the tolerance.
_BRACKET_C: Final = (-60.0, 60.0)
_TOLERANCE_C: Final = 1e-6
_BISECTION_STEPS: Final = math.ceil(math.log2((_BRACKET_C[1] - _BRACKET_C[0]) / (2.0 * _TOLERANCE_C)))


def _f64(values: ArrayLike) -> F64:
    return np.asarray(values, dtype=np.float64)


def saturation_vapor_pressure_kpa(t_c: ArrayLike) -> F64:
    """Saturation vapor pressure over liquid water, in kPa, from Buck (1996).

    ``es = 0.61121 * exp((18.678 - t / 234.5) * (t / (257.14 + t)))`` with ``t`` in degrees Celsius. It agrees with
    the Magnus form of Alduchov and Eskridge (1996), ``0.61094 * exp(17.625 t / (t + 243.04))``, to within 0.3 percent
    from 0 to 50 degrees Celsius. No enhancement factor is applied.

    Args:
        t_c: Air or dew-point temperature in degrees Celsius.
    """
    t = _f64(t_c)
    return _f64(0.61121 * np.exp((18.678 - t / 234.5) * (t / (257.14 + t))))


def vapor_pressure_kpa_from_dewpoint(td_c: ArrayLike) -> F64:
    """Actual vapor pressure in kPa: the saturation vapor pressure at the dew point (Buck 1996).

    Args:
        td_c: Dew-point temperature in degrees Celsius.
    """
    return saturation_vapor_pressure_kpa(td_c)


def relative_humidity_pct(t_c: ArrayLike, td_c: ArrayLike) -> F64:
    """Relative humidity in percent, from air temperature and dew point (Buck 1996), clipped to [0, 100].

    A dew point at or above the air temperature means saturation and gives exactly 100.0: that case is decided by the
    comparison of the two temperatures, not by dividing two vapor pressures that rounding could leave one unit in the
    last place apart (naively ``100 * es / es`` is 99.99999999999999 at 25 degrees Celsius).

    Args:
        t_c: Air temperature in degrees Celsius.
        td_c: Dew-point temperature in degrees Celsius.
    """
    t = _f64(t_c)
    td = _f64(td_c)
    rh = 100.0 * (vapor_pressure_kpa_from_dewpoint(td) / saturation_vapor_pressure_kpa(t))
    return _f64(np.where(td >= t, 100.0, np.clip(rh, 0.0, 100.0)))


def dewpoint_c_from_vapor_pressure(e_kpa: ArrayLike) -> F64:
    """Dew point in degrees Celsius: the inverse of ``saturation_vapor_pressure_kpa``.

    Found by vectorized bisection on [-60, 60] degrees Celsius to within 1e-6 degrees Celsius, so the inverse is exact
    for the same formula that produced the vapor pressure. A vapor pressure that is NaN, or lies outside the range of
    that bracket (including zero and negative values), has no dew point there and gives NaN rather than a clamped
    value.

    Args:
        e_kpa: Actual vapor pressure in kPa.
    """
    e = _f64(e_kpa)
    low_c, high_c = _BRACKET_C
    low = np.full(e.shape, low_c)
    high = np.full(e.shape, high_c)
    for _ in range(_BISECTION_STEPS):
        mid = 0.5 * (low + high)
        below_root = saturation_vapor_pressure_kpa(mid) < e
        low = np.where(below_root, mid, low)
        high = np.where(below_root, high, mid)
    invertible = (e >= saturation_vapor_pressure_kpa(low_c)) & (e <= saturation_vapor_pressure_kpa(high_c))
    return _f64(np.where(invertible, 0.5 * (low + high), np.nan))


def vapor_pressure_kpa_from_wet_bulb(t_c: ArrayLike, twb_c: ArrayLike, pressure_hpa: ArrayLike) -> F64:
    """Actual vapor pressure in kPa from dry-bulb and wet-bulb temperature, by the psychrometer equation.

    Uses the WMO form for a ventilated (aspirated) psychrometer, WMO-No. 8 (Guide to Instruments and Methods of
    Observation), Annex 4.B: ``e = es(Tw) - 6.53e-4 * (1 + 0.000944 * Tw) * p * (T - Tw)``, in hPa. The saturation
    vapor pressure at the wet bulb ``es(Tw)`` is Buck's (1996) value, without WMO's enhancement factor. It is the
    psychrometer formula for an observed wet bulb, which is not the same as the natural or the psychrometric wet bulb
    of a heat-stress index unless the instrument is aspirated.

    Args:
        t_c: Dry-bulb temperature in degrees Celsius.
        twb_c: Wet-bulb temperature in degrees Celsius.
        pressure_hpa: Air pressure in hPa.
    """
    t = _f64(t_c)
    tw = _f64(twb_c)
    p = _f64(pressure_hpa)
    psychrometer_coefficient = 6.53e-4 * (1.0 + 0.000944 * tw)
    e_hpa = _HPA_PER_KPA * saturation_vapor_pressure_kpa(tw) - psychrometer_coefficient * p * (t - tw)
    return _f64(e_hpa / _HPA_PER_KPA)
