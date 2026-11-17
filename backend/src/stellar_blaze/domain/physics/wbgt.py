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

``globe_temperature_c`` and ``mrt_from_globe_c`` give the mean radiant temperature that TWL needs (ADR 0047 decision 3):
the Liljegren globe solved with the same preparation (guards, geometry, direct fraction, wind scaling) as
``wbgt_liljegren``, then thermofeel's globe-to-MRT conversion.
"""

import math
from enum import IntEnum, StrEnum
from typing import Final, NamedTuple

import numpy as np
from numpy.typing import NDArray
from thermofeel import calculate_mrt_from_bgt, calculate_wbgt_liljegren, calculate_wind_speed_2m_liljegren
from thermofeel.liljegren import CZA_MIN, MIN_WIND_10M, solve_globe

from stellar_blaze.domain.physics.psychrometrics import relative_humidity_pct
from stellar_blaze.domain.physics.solar import cos_zenith, mean_cos_zenith_prev_hour, shift
from stellar_blaze.domain.physics.types import F64

_KELVIN_OFFSET: Final = 273.15
_HALF_HOUR: Final = np.timedelta64(30, "m")
_FDIR_MAX: Final = 0.9
_FDIR_MIN_SW_WM2: Final = 1e-6  # FHC audit script: fdir is 0 where the shortwave is at or below this

_GLOBE_MAX_BELOW_AIR_C: Final = 30.0
_GLOBE_MAX_ABOVE_AIR_C: Final = 40.0
"""Plausible band of the globe temperature, ``[t_c - 30, t_c + 40]`` (an engineering bound, not a sourced value).

It only catches solver garbage. Measured on 2026-11-14 with thermofeel 2.3.0: the hottest physical case (T 48 C,
1100 W/m2 of which 990 direct, calm so the 0.62 m/s wind floor applies) gives a globe 25.0 C above the air, and the
worked example (T 44 C, 900 W/m2, 3 m/s) gives +13.6 C, so +40 keeps headroom; the lower edge is wide for the same
reason as ``_MAX_BELOW_AIR_C``. Absurd air temperatures are not screened here (T 200 C gives a globe of 209 C, inside
the band): callers screen raw data first, as for ``wbgt_liljegren``.
"""

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


class _Prepared(NamedTuple):
    """The validated, flattened inputs of one Liljegren call: a reject code per element, values for accepted ones."""

    shape: tuple[int, ...]
    reject: NDArray[np.int8]  # flat, one code per element
    accepted: NDArray[np.intp]  # flat indices of the elements that go to thermofeel
    t_c: F64  # the arrays below hold the accepted elements only
    rh_pct: F64
    pressure_hpa: F64
    wind10m_ms: F64
    sw_wm2: F64
    fdir: F64
    cos_zenith: F64


def _prepare_liljegren(
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
    mode: CosZenithMode,
) -> _Prepared:
    """Validation, the rejection guards, and the geometry, shared by ``wbgt_liljegren`` and ``globe_temperature_c``.

    One preparation for both so that the two cannot disagree on which elements are trusted, on the direct fraction or
    on the sun angle. See ``wbgt_liljegren`` for the guards and their order.

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
    empty = np.empty(0, dtype=np.float64)
    prepared = _Prepared(shape, reject, np.empty(0, dtype=np.intp), empty, empty, empty, empty, empty, empty, empty)

    finite = ~np.isnat(utc)
    for a in (t, td, wind, pressure, sw, direct):
        finite &= np.isfinite(a)
    reject[~finite] = WbgtReject.NONFINITE_INPUT
    candidates = np.flatnonzero(finite)
    if not candidates.size:
        return prepared

    mean_cz = mean_cos_zenith_prev_hour(lat, lon, utc[candidates])
    incoherent = (
        ((sw[candidates] > _INCOHERENT_RADIATION_WM2) & (mean_cz == 0.0))
        | (sw[candidates] < 0.0)
        | (direct[candidates] < 0.0)
    )
    reject[candidates[incoherent]] = WbgtReject.INCOHERENT_RADIATION
    coherent = ~incoherent
    accepted = candidates[coherent]
    if not accepted.size:
        return prepared

    sw_a = sw[accepted]
    fdir = np.divide(direct[accepted], sw_a, out=np.zeros_like(sw_a), where=sw_a > _FDIR_MIN_SW_WM2)
    fdir = np.clip(fdir, 0.0, _FDIR_MAX)
    if mode is CosZenithMode.MEAN:
        cz = mean_cz[coherent]
    else:
        cz = np.clip(cos_zenith(lat, lon, shift(utc[accepted], -_HALF_HOUR)), 0.0, None)
    t_a = t[accepted]
    return prepared._replace(
        accepted=accepted,
        t_c=t_a,
        rh_pct=relative_humidity_pct(t_a, td[accepted]),
        pressure_hpa=pressure[accepted],
        wind10m_ms=wind[accepted],
        sw_wm2=sw_a,
        fdir=fdir,
        cos_zenith=cz,
    )


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
    prepared = _prepare_liljegren(
        t_c=t_c,
        td_c=td_c,
        wind10m_ms=wind10m_ms,
        pressure_hpa=pressure_hpa,
        sw_wm2=sw_wm2,
        direct_wm2=direct_wm2,
        lat=lat,
        lon=lon,
        valid_time_utc=valid_time_utc,
        mode=mode,
    )
    shape, reject, accepted = prepared.shape, prepared.reject, prepared.accepted
    wbgt_c = np.full(reject.size, np.nan, dtype=np.float64)

    if accepted.size:
        t_a = prepared.t_c
        result_k = calculate_wbgt_liljegren(
            t_a + _KELVIN_OFFSET,
            prepared.rh_pct,
            prepared.pressure_hpa,
            prepared.wind10m_ms,
            prepared.sw_wm2,
            prepared.fdir,
            prepared.cos_zenith,
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


def globe_temperature_c(
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
) -> F64:
    """Liljegren black-globe temperature in degrees Celsius, NaN where ``wbgt_liljegren`` would reject the element.

    The same inputs, guards, direct fraction (``clip(direct / sw, 0, 0.9)``, zeroed where the cosine of the zenith is
    below thermofeel's 0.00873), cosine of the zenith (the mid-point of the preceding hour, ``CosZenithMode.MIDPOINT``)
    and wind scaling (10 m wind floored at 0.62 m/s, then scaled to 2 m by thermofeel's Liljegren profile) as
    ``wbgt_liljegren``: both call one preparation. A result outside ``[t_c - 30, t_c + 40]`` degrees Celsius is NaN as
    well (thermofeel returns finite garbage for absurd inputs), as is one the solver did not converge on.

    It calls ``thermofeel.liljegren.solve_globe``, which is thermofeel-internal API: it takes kelvin, a relative
    humidity FRACTION and the wind already scaled to 2 m, and a wrong unit gives a plausible wrong number instead of an
    error. The exact pin ``thermofeel==2.3.0`` makes that tolerable, and ``tests/unit/physics/test_mrt.py`` compares
    the result with thermofeel called directly: a thermofeel bump must re-run it.

    Args:
        t_c: Air temperature in degrees Celsius.
        td_c: Dew-point temperature in degrees Celsius.
        wind10m_ms: Wind speed at 10 m in m/s.
        pressure_hpa: Surface pressure in hPa.
        sw_wm2: Downward shortwave radiation in W/m2, mean over the preceding hour.
        direct_wm2: Direct-beam shortwave radiation in W/m2, mean over the preceding hour.
        lat: Latitude in degrees north, in [-90, 90].
        lon: Longitude in degrees east, in [-180, 180].
        valid_time_utc: Hour-ending labels, naive ``datetime64`` meaning UTC. All arrays share one shape.

    Raises:
        ValueError: The arrays differ in shape or a coordinate is out of range.
        TypeError: ``valid_time_utc`` is not a ``datetime64`` array.
    """
    prepared = _prepare_liljegren(
        t_c=t_c,
        td_c=td_c,
        wind10m_ms=wind10m_ms,
        pressure_hpa=pressure_hpa,
        sw_wm2=sw_wm2,
        direct_wm2=direct_wm2,
        lat=lat,
        lon=lon,
        valid_time_utc=valid_time_utc,
        mode=CosZenithMode.MIDPOINT,
    )
    globe_c = np.full(prepared.reject.size, np.nan, dtype=np.float64)
    if prepared.accepted.size:
        cz = prepared.cos_zenith
        speed_2m = calculate_wind_speed_2m_liljegren(np.maximum(prepared.wind10m_ms, MIN_WIND_10M), cz, prepared.sw_wm2)
        fdir = np.where(cz < CZA_MIN, 0.0, prepared.fdir)
        result_c = np.asarray(
            solve_globe(
                prepared.t_c + _KELVIN_OFFSET,
                prepared.rh_pct / 100.0,
                prepared.pressure_hpa,
                speed_2m,
                prepared.sw_wm2,
                fdir,
                cz,
            ),
            dtype=np.float64,
        )
        t_a = prepared.t_c
        plausible = (result_c >= t_a - _GLOBE_MAX_BELOW_AIR_C) & (result_c <= t_a + _GLOBE_MAX_ABOVE_AIR_C)
        globe_c[prepared.accepted[plausible]] = result_c[plausible]
    return globe_c.reshape(prepared.shape)


def mrt_from_globe_c(*, t_c: F64, globe_c: F64, wind10m_ms: F64) -> F64:
    """Mean radiant temperature in degrees Celsius from the globe temperature (Brimicombe et al. 2023).

    thermofeel's ``calculate_mrt_from_bgt``: it takes kelvin and the 10 m wind (it scales to the globe height itself)
    and returns kelvin. NaN in any argument gives NaN, as does an element whose fourth-root argument would be negative.
    The arguments broadcast against each other.

    The wind is floored at ``MIN_WIND_10M`` (0.62 m/s) exactly as ``globe_temperature_c`` floors it for the globe solve.
    thermofeel's conversion term grows with ``wind ** 0.6``, so an unfloored calm wind would collapse the MRT onto the
    globe temperature (the least conservative MRT, and inconsistent with the globe it was solved for): TWL would read
    milder in calm air than in a light breeze. With the floor the MRT, and so the TWL, never rises as the wind falls.

    Args:
        t_c: Air temperature in degrees Celsius.
        globe_c: Globe temperature in degrees Celsius (``globe_temperature_c``).
        wind10m_ms: Wind speed at 10 m in m/s (floored at 0.62 m/s here).

    Raises:
        ValueError: A wind speed is negative.
    """
    t, globe, wind = np.broadcast_arrays(*(np.asarray(a, dtype=np.float64) for a in (t_c, globe_c, wind10m_ms)))
    if np.any(wind < 0.0):
        raise ValueError(f"wind10m_ms must not be negative, first offending value: {wind[wind < 0.0].flat[0]!r}")
    mrt_c = np.full(t.shape, np.nan, dtype=np.float64)
    valid = np.isfinite(t) & np.isfinite(globe) & np.isfinite(wind)
    if valid.any():
        with np.errstate(invalid="ignore"):
            mrt_k = calculate_mrt_from_bgt(
                t[valid] + _KELVIN_OFFSET, globe[valid] + _KELVIN_OFFSET, np.maximum(wind[valid], MIN_WIND_10M)
            )
        mrt_c[valid] = np.asarray(mrt_k, dtype=np.float64) - _KELVIN_OFFSET
    return mrt_c
