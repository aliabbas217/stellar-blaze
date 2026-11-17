"""Metabolic rate conversions between met, watts per square meter of body surface and whole-body watts.

NIOSH limits (``niosh``) take the whole-body rate in watts; ISO 7933 PHS and activity tables work in met or W/m2 of
body surface. Body surface area comes from DuBois and DuBois (1916), in the form ISO 7933 uses.
"""

import math
from typing import Final

import numpy as np
from numpy.typing import ArrayLike

from stellar_blaze.domain.physics.types import F64

W_PER_M2_PER_MET: Final = 58.2
"""Watts per square meter of body surface in one met (ASHRAE Standard 55; ISO 7730)."""


def _positive_finite(value: float, name: str) -> float:
    if not (math.isfinite(value) and value > 0.0):
        raise ValueError(f"{name} must be finite and greater than 0, got {value!r}")
    return value


def body_surface_area_dubois_m2(weight_kg: float, height_m: float) -> float:
    """Body surface area in square meters (DuBois and DuBois 1916): ``0.202 * W**0.425 * H**0.725``.

    ``W`` is body mass in kilograms and ``H`` height in meters. DuBois and DuBois published ``0.007184`` with the
    height in centimeters, which is 0.20247 for meters; ISO 7933 rounds it to 0.202, a difference of 0.2 percent, and
    this function follows ISO 7933 so that its result matches the area the PHS model derives from the same body.

    Args:
        weight_kg: Body mass in kilograms.
        height_m: Height in meters.

    Raises:
        ValueError: If either argument is not finite or not greater than 0.
    """
    weight = _positive_finite(weight_kg, "weight_kg")
    height = _positive_finite(height_m, "height_m")
    return float(0.202 * weight**0.425 * height**0.725)


def met_to_watts(met: ArrayLike, bsa_m2: float) -> F64:
    """Whole-body metabolic rate in watts from met: ``met * 58.2 * bsa_m2``.

    Args:
        met: Metabolic rate in met (a scalar or an array); NaN gives NaN.
        bsa_m2: Body surface area in square meters, for example from ``body_surface_area_dubois_m2``.

    Raises:
        ValueError: If ``bsa_m2`` is not finite or not greater than 0.
    """
    bsa = _positive_finite(bsa_m2, "bsa_m2")
    return np.asarray(np.asarray(met, dtype=np.float64) * W_PER_M2_PER_MET * bsa, dtype=np.float64)


def watts_to_met(watts: ArrayLike, bsa_m2: float) -> F64:
    """Metabolic rate in met from whole-body watts: ``watts / (58.2 * bsa_m2)``, the inverse of ``met_to_watts``.

    Args:
        watts: Whole-body metabolic rate in watts (a scalar or an array); NaN gives NaN.
        bsa_m2: Body surface area in square meters, for example from ``body_surface_area_dubois_m2``.

    Raises:
        ValueError: If ``bsa_m2`` is not finite or not greater than 0.
    """
    bsa = _positive_finite(bsa_m2, "bsa_m2")
    return np.asarray(np.asarray(watts, dtype=np.float64) / (W_PER_M2_PER_MET * bsa), dtype=np.float64)
