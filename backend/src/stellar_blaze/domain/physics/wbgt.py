"""Wet-bulb globe temperature from weather-model fields: thermofeel's Liljegren solver behind input guards.

Port of ``wbgt_variants`` in ``D:\\dev\\future-health-challenge\\scripts\\audit_wbgt.py`` (variant A, the mid-point of
the preceding hour, is the default; variant B, the mean over the preceding hour, is ``CosZenithMode.MEAN``), with the
guards of ADR 0006: an element whose inputs are not finite, whose radiation is incoherent with the sun, or whose solver
result is missing or implausible is rejected with a reason code instead of being returned as a number. The radiation
guard has a known gap (a partly sunlit hour accepts any shortwave), described on ``wbgt_liljegren`` and parked in
``docs/parking-lot.md``.

This is the only module that imports thermofeel. ``calculate_wbgt_liljegren`` returns kelvin and takes instantaneous
radiation; Open-Meteo radiation is the mean over the hour that ends at the label, so the solar geometry is evaluated for
that hour (see ``solar.py``). Never use thermofeel's ``calculate_wbgt_simple`` (stack doc section 6.6).
"""

import math
from enum import IntEnum, StrEnum
from typing import Final, NamedTuple

import numpy as np
from numpy.typing import NDArray
from thermofeel import calculate_wbgt_liljegren

from stellar_blaze.domain.physics.psychrometrics import relative_humidity_pct
from stellar_blaze.domain.physics.solar import cos_zenith, mean_cos_zenith_prev_hour, shift
from stellar_blaze.domain.physics.types import F64

_KELVIN_OFFSET: Final = 273.15
_HALF_HOUR: Final = np.timedelta64(30, "m")
_FDIR_MAX: Final = 0.9
_FDIR_MIN_SW_WM2: Final = 1e-6  # FHC audit script: fdir is 0 where the shortwave is at or below this

_INCOHERENT_RADIATION_WM2: Final = 10.0
"""Shortwave above this (W/m2) while the sun is below the horizon for the whole preceding hour is incoherent.

Neither the FHC audit script nor the stack doc states this value: it is an engineering threshold chosen in the B1 plan
(Task 6; preflight scan, "no source"). The reasoning behind it, not a measurement, is that a model can report a few W/m2
of twilight diffuse radiation while the geometric zenith (no refraction, no twilight) says the sun is down, whereas
hundreds of W/m2 with the sun down is a data error. Stack doc section 6.6 shows why it matters: thermofeel is slow on
such inputs (about 5,300 points/s against about 128,000 for coherent ones) and returns non-physical values (up to
120 C).
"""

_MAX_BELOW_AIR_C: Final = 30.0
"""Lower edge of the plausible band: a result more than this many degrees Celsius below air temperature is rejected.

The band is ``[t_c - 30, t_c + 10]`` (ADR 0006). It is deliberately wide and only catches solver garbage.
"""

_MAX_ABOVE_AIR_C: Final = 10.0
"""Upper edge of the plausible band: a result more than this many degrees Celsius above air temperature is rejected.

For coherent inputs the stack doc (section 6.6) measured WBGT minus air temperature of at most +5.1 C, so +10 leaves
headroom while still catching the non-physical values (up to 120 C) that incoherent inputs produce.
"""


class CosZenithMode(StrEnum):
    """How the solar zenith is chosen for an hour-ending radiation label."""

    MIDPOINT = "midpoint"
    """Cosine of the zenith at the mid-point of the preceding hour, clipped at 0 (FHC variant A; the default)."""

    MEAN = "mean"
    """Mean of the clipped cosine over the preceding hour (FHC variant B)."""


class WbgtReject(IntEnum):
    """Why an element of ``WbgtResult.wbgt_c`` is NaN. The values are persisted in the gold tables as Int8."""

    OK = 0
    NONFINITE_INPUT = 1
    INCOHERENT_RADIATION = 2
    NO_CONVERGENCE = 3
    OUT_OF_BOUNDS = 4


class WbgtResult(NamedTuple):
    """WBGT in degrees Celsius and a reject code per element, both with the shape of the inputs."""

    wbgt_c: F64
    reject: NDArray[np.int8]


def _check_coordinate(name: str, value: float, limit: float) -> None:
    if not (math.isfinite(value) and -limit <= value <= limit):
        raise ValueError(f"{name} must be a finite number in [-{limit:g}, {limit:g}] degrees, got {value!r}")


def wbgt_liljegren(
    *,
    t_c: F64,
    td_c: F64,
    wind10m_ms: F64,
    pressure_hpa: F64,
    sw_wm2: F64,
    direct_wm2: F64,
    lat: float,
    lon: float,
    valid_time_utc: NDArray[np.datetime64],
    mode: CosZenithMode = CosZenithMode.MIDPOINT,
) -> WbgtResult:
    """Liljegren WBGT for each element, with NaN and a reason code for the elements that cannot be trusted.

    Radiation is the mean over the hour that ends at ``valid_time_utc``; the other variables are instantaneous at that
    label. Relative humidity comes from ``relative_humidity_pct(t_c, td_c)``; the direct-beam fraction is
    ``clip(direct / sw, 0, 0.9)``, and 0 where ``sw`` is at or below 1e-6; the cosine of the zenith follows ``mode``.

    Each element gets the first reason that applies, in this order:

    1. ``NONFINITE_INPUT``: any numeric input is NaN or infinite, or the time is NaT.
    2. ``INCOHERENT_RADIATION``: either ``sw_wm2`` or ``direct_wm2`` is negative, or ``sw_wm2`` is above 10 W/m2
       while the mean cosine of the zenith over the preceding hour is exactly 0 (the sun is down for the whole hour).
    3. ``NO_CONVERGENCE``: thermofeel returned NaN.
    4. ``OUT_OF_BOUNDS``: the result is outside ``[t_c - 30, t_c + 10]`` degrees Celsius.

    Known gap in rule 2: it catches only those two cases. It does not bound ``sw_wm2`` in an hour that is partly
    sunlit, that is, where the mean cosine is above 0. In ``MIDPOINT`` mode a twilight hour whose mid-point cosine is
    clipped to 0 therefore accepts any shortwave: at OMAA, label 2025-07-15T01:50 UTC (mean cosine 0.0004, mid-point
    cosine -0.09), with t 36 C, td 22 C, wind 3 m/s, 998 hPa and ``direct / sw`` 0.5, ``sw`` of 100, 300 and 1000 W/m2
    give 29.4, 30.8 and 35.8 C, all with reject code 0. Only rule 4 can catch a non-physical result there. A ceiling
    such as ``sw > a * mean_cos_zenith + b`` needs coefficients derived from data (``docs/parking-lot.md``, ADR 0006).

    Rejected elements are excluded from the thermofeel call, which is slow and non-physical on garbage (stack doc
    section 6.6): one vectorized call is made over the accepted elements only, and none when there are none. A rejected
    element's ``wbgt_c`` is NaN, not null: this is numpy output, and whoever moves it into a Polars frame must decide
    whether NaN becomes null (Polars treats the two differently).

    Args:
        t_c: Air temperature in degrees Celsius.
        td_c: Dew-point temperature in degrees Celsius.
        wind10m_ms: Wind speed at 10 m in m/s (thermofeel floors it at 0.62 m/s).
        pressure_hpa: Surface pressure in hPa.
        sw_wm2: Downward shortwave radiation in W/m2, mean over the preceding hour.
        direct_wm2: Direct-beam shortwave radiation in W/m2, mean over the preceding hour.
        lat: Latitude in degrees north, in [-90, 90].
        lon: Longitude in degrees east, in [-180, 180].
        valid_time_utc: Hour-ending labels, naive ``datetime64`` meaning UTC. All arrays share one shape.
        mode: How the zenith is chosen; ``CosZenithMode.MIDPOINT`` by default.

    Raises:
        ValueError: The arrays differ in shape, a coordinate is out of range, or ``mode`` is not a ``CosZenithMode``.
        TypeError: ``valid_time_utc`` is not a ``datetime64`` array.
    """
    mode = CosZenithMode(mode)
    _check_coordinate("lat", lat, 90.0)
    _check_coordinate("lon", lon, 180.0)
    utc_in = np.asarray(valid_time_utc)
    if utc_in.dtype.kind != "M":
        raise TypeError(f"valid_time_utc must be a datetime64 array, got dtype {utc_in.dtype}")
    numeric = [np.asarray(a, dtype=np.float64) for a in (t_c, td_c, wind10m_ms, pressure_hpa, sw_wm2, direct_wm2)]
    shape = numeric[0].shape
    if any(a.shape != shape for a in numeric) or utc_in.shape != shape:
        raise ValueError("the six numeric inputs and valid_time_utc must all have the same shape")
    t, td, wind, pressure, sw, direct = (a.ravel() for a in numeric)
    utc = utc_in.ravel()

    reject = np.zeros(t.size, dtype=np.int8)
    wbgt_c = np.full(t.size, np.nan, dtype=np.float64)

    finite = ~np.isnat(utc)
    for a in (t, td, wind, pressure, sw, direct):
        finite &= np.isfinite(a)
    reject[~finite] = WbgtReject.NONFINITE_INPUT
    candidates = np.flatnonzero(finite)

    if candidates.size:
        mean_cz = mean_cos_zenith_prev_hour(lat, lon, utc[candidates])
        incoherent = (
            ((sw[candidates] > _INCOHERENT_RADIATION_WM2) & (mean_cz == 0.0))
            | (sw[candidates] < 0.0)
            | (direct[candidates] < 0.0)
        )
        reject[candidates[incoherent]] = WbgtReject.INCOHERENT_RADIATION
        coherent = ~incoherent
        accepted = candidates[coherent]

        if accepted.size:
            sw_a = sw[accepted]
            fdir = np.divide(direct[accepted], sw_a, out=np.zeros_like(sw_a), where=sw_a > _FDIR_MIN_SW_WM2)
            fdir = np.clip(fdir, 0.0, _FDIR_MAX)
            if mode is CosZenithMode.MEAN:
                cz = mean_cz[coherent]
            else:
                cz = np.clip(cos_zenith(lat, lon, shift(utc[accepted], -_HALF_HOUR)), 0.0, None)
            t_a = t[accepted]
            rh = relative_humidity_pct(t_a, td[accepted])
            result_k = calculate_wbgt_liljegren(
                t_a + _KELVIN_OFFSET, rh, pressure[accepted], wind[accepted], sw_a, fdir, cz
            )
            result_c = np.asarray(result_k, dtype=np.float64) - _KELVIN_OFFSET

            no_convergence = np.isnan(result_c)
            in_band = (result_c >= t_a - _MAX_BELOW_AIR_C) & (result_c <= t_a + _MAX_ABOVE_AIR_C)
            out_of_bounds = ~no_convergence & ~in_band
            reject[accepted[no_convergence]] = WbgtReject.NO_CONVERGENCE
            reject[accepted[out_of_bounds]] = WbgtReject.OUT_OF_BOUNDS
            kept = in_band & ~no_convergence
            wbgt_c[accepted[kept]] = result_c[kept]

    return WbgtResult(wbgt_c=wbgt_c.reshape(shape), reject=reject.reshape(shape))
