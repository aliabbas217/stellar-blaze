"""NIOSH Recommended Alert Limit (RAL), Recommended Exposure Limit (REL) and clothing adjustment of the WBGT.

Source: NIOSH (2016), *Criteria for a Recommended Standard: Occupational Exposure to Heat and Hot Environments*
(DHHS (NIOSH) Publication 2016-106). Section 8.1 gives the limits as functions of the metabolic rate ``M`` in watts:

    RAL [C-WBGT] = 59.9 - 14.1 log10 M    (unacclimatized workers)
    REL [C-WBGT] = 56.7 - 11.5 log10 M    (acclimatized workers)

They protect healthy workers in conventional one-layer work clothing. ``M`` is the whole-body metabolic rate in watts,
not W/m2: convert with ``stellar_blaze.domain.physics.metabolic``. Bernard, Flach and Ashley (2023, Ann Work Expo
Health 67:345) report small discrepancies between the equations and the figures of the NIOSH document and take the
equations as intended; so does this module. Below M = 17 W (far under any resting rate) the two lines cross and the
alert limit would exceed the exposure limit; the limits are not meant for that range.

The clothing adjustment factors of NIOSH (2016) Table 3-2 (its "2006" column, adapted from ACGIH) are data, not code
(ADR 0009 section 1): they live in the versioned ruleset under ``[niosh_clothing] values_c``, whose keys are the values
of ``Clothing``. ``effective_wbgt_c`` only applies an adjustment it is given.
"""

import math
from enum import StrEnum

import numpy as np
from numpy.typing import ArrayLike

from stellar_blaze.domain.physics.types import F64


class Clothing(StrEnum):
    """Clothing ensembles of NIOSH (2016) Table 3-2.

    The values are the lower-case member names and are identical to the keys of the ruleset's
    ``[niosh_clothing] values_c`` table, which holds the adjustment of each ensemble in degrees Celsius WBGT.
    """

    WORK_CLOTHES = "work_clothes"
    CLOTH_COVERALLS = "cloth_coveralls"
    DOUBLE_LAYER_WOVEN = "double_layer_woven"
    SMS_COVERALLS = "sms_coveralls"
    POLYOLEFIN_COVERALLS = "polyolefin_coveralls"
    LIMITED_USE_VAPOR_BARRIER = "limited_use_vapor_barrier"


def _metabolic_rate_w(metabolic_rate_w: ArrayLike) -> F64:
    """The metabolic rate as a float64 array, or ``ValueError`` if any element is not finite and positive."""
    m = np.asarray(metabolic_rate_w, dtype=np.float64)
    valid = np.isfinite(m) & (m > 0.0)
    if not np.all(valid):
        raise ValueError(
            f"metabolic_rate_w must be finite and greater than 0 W; first offending value: {m[~valid].flat[0]!r}"
        )
    return m


def rel_wbgt_c(metabolic_rate_w: ArrayLike) -> F64:
    """NIOSH Recommended Exposure Limit for acclimatized workers, in degrees Celsius WBGT.

    ``REL = 56.7 - 11.5 * log10(M)`` with ``M`` in watts (NIOSH 2016, section 8.1). The WBGT it is compared with is the
    clothing-adjusted one (``effective_wbgt_c``).

    Args:
        metabolic_rate_w: Whole-body metabolic rate in watts (a scalar or an array).

    Raises:
        ValueError: If any element is not finite or not greater than 0.
    """
    m = _metabolic_rate_w(metabolic_rate_w)
    return np.asarray(56.7 - 11.5 * np.log10(m), dtype=np.float64)


def ral_wbgt_c(metabolic_rate_w: ArrayLike) -> F64:
    """NIOSH Recommended Alert Limit for unacclimatized workers, in degrees Celsius WBGT.

    ``RAL = 59.9 - 14.1 * log10(M)`` with ``M`` in watts (NIOSH 2016, section 8.1). For ``M`` above 17 W it is below
    the REL at the same workload.

    Args:
        metabolic_rate_w: Whole-body metabolic rate in watts (a scalar or an array).

    Raises:
        ValueError: If any element is not finite or not greater than 0.
    """
    m = _metabolic_rate_w(metabolic_rate_w)
    return np.asarray(59.9 - 14.1 * np.log10(m), dtype=np.float64)


def effective_wbgt_c(wbgt_c: ArrayLike, adjustment_c: float) -> F64:
    """The WBGT to compare with the RAL or REL: the measured or forecast WBGT plus the clothing adjustment.

    NIOSH (2016) Table 3-2 gives the adjustment of each ensemble relative to conventional work clothes (zero). It is
    added to the WBGT, never subtracted, and the table has no negative entry. The table values are data: callers take
    ``adjustment_c`` for a ``Clothing`` member from ``niosh_clothing.values_c`` of the active ruleset; nothing is
    tabulated here. NaN in ``wbgt_c`` stays NaN.

    Args:
        wbgt_c: WBGT in degrees Celsius (a scalar or an array).
        adjustment_c: Clothing adjustment in degrees Celsius WBGT.

    Raises:
        ValueError: If ``adjustment_c`` is not finite or is negative.
    """
    adjustment = float(adjustment_c)
    if not (math.isfinite(adjustment) and adjustment >= 0.0):
        raise ValueError(f"adjustment_c must be finite and not negative, got {adjustment_c!r}")
    return np.asarray(np.asarray(wbgt_c, dtype=np.float64) + adjustment, dtype=np.float64)
