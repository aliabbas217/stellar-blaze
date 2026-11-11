"""Solar geometry for the Liljegren WBGT: the cosine of the solar zenith angle at a place and a UTC instant.

Ported from ``D:\\dev\\future-health-challenge\\scripts\\audit_wbgt.py`` (the Future Health Challenge audit script):
``shift``, ``cos_zenith`` and ``mean_cos_zenith_prev_hour``. The numerical behavior is unchanged; only the parameter
names (``lat`` and ``lon`` became ``lat_deg`` and ``lon_deg`` in the second function, matching the first) and the typing
were tightened. Against pvlib 0.16.1 the FHC code differs by at most 5.0e-5 in the cosine over one Abu Dhabi day (stack
doc section 6.6); ``tests/unit/physics/test_solar.py`` bounds that difference by 1e-4.

Times are naive ``datetime64`` arrays that mean UTC, in any unit; the code casts them to seconds.
"""

import numpy as np
from numpy.typing import NDArray

from stellar_blaze.domain.physics.types import F64


def shift(t: NDArray[np.datetime64], delta: np.timedelta64) -> NDArray[np.datetime64]:
    """``t + delta`` for a ``datetime64`` array (``delta`` may be negative). Port of ``shift`` in ``audit_wbgt.py``."""
    return t + delta


def cos_zenith(lat_deg: float, lon_deg: float, utc: NDArray[np.datetime64]) -> F64:
    """Cosine of the solar zenith angle (NOAA/Meeus low-precision series, no refraction).

    Port of ``cos_zenith`` in ``audit_wbgt.py``. Negative values mean the sun is below the horizon; callers that need
    irradiance geometry clip at zero.

    Args:
        lat_deg: Latitude in degrees north.
        lon_deg: Longitude in degrees east.
        utc: Instants in UTC, as a ``datetime64`` array of any shape. NaT is not supported (it would be read as a
            huge negative number of seconds); screen it out first.
    """
    t = utc.astype("datetime64[s]")
    epoch = np.datetime64("1970-01-01T00:00:00", "s")
    secs = (t - epoch).astype(np.float64)
    jd = secs / 86400.0 + 2440587.5
    jc = (jd - 2451545.0) / 36525.0
    gml = np.mod(280.46646 + jc * (36000.76983 + jc * 0.0003032), 360.0)
    gma = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)
    ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)
    m = np.radians(gma)
    eq_ctr = (
        np.sin(m) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
        + np.sin(2 * m) * (0.019993 - 0.000101 * jc)
        + np.sin(3 * m) * 0.000289
    )
    true_long = gml + eq_ctr
    omega = np.radians(125.04 - 1934.136 * jc)
    app_long = np.radians(true_long - 0.00569 - 0.00478 * np.sin(omega))
    mean_obl = 23.0 + (26.0 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60.0) / 60.0
    obl = np.radians(mean_obl + 0.00256 * np.cos(omega))
    decl = np.arcsin(np.sin(obl) * np.sin(app_long))
    y = np.tan(obl / 2.0) ** 2
    g = np.radians(gml)
    eq_time_min = 4.0 * np.degrees(
        y * np.sin(2 * g)
        - 2 * ecc * np.sin(m)
        + 4 * ecc * y * np.sin(m) * np.cos(2 * g)
        - 0.5 * y**2 * np.sin(4 * g)
        - 1.25 * ecc**2 * np.sin(2 * m)
    )
    minutes_utc = np.mod(secs, 86400.0) / 60.0
    tst = np.mod(minutes_utc + eq_time_min + 4.0 * lon_deg, 1440.0)
    ha = np.radians(tst / 4.0 - 180.0)
    lat = np.radians(lat_deg)
    return np.asarray(np.sin(lat) * np.sin(decl) + np.cos(lat) * np.cos(decl) * np.cos(ha), dtype=np.float64)


def mean_cos_zenith_prev_hour(lat_deg: float, lon_deg: float, utc: NDArray[np.datetime64]) -> F64:
    """Mean of ``max(cos zenith, 0)`` over the 60 minutes before each label (5-minute sampling).

    Port of ``mean_cos_zenith_prev_hour`` in ``audit_wbgt.py``. Open-Meteo radiation is the mean over the hour that
    ends at the label, so this is the matching geometric factor. It is exactly 0.0 when the sun is below the horizon at
    all twelve sample points.

    Args:
        lat_deg: Latitude in degrees north.
        lon_deg: Longitude in degrees east.
        utc: Hour-ending labels in UTC, as a ``datetime64`` array of any shape.
    """
    offs = np.arange(-57.5, 0.0, 5.0)  # 12 mid-points inside (T-60 min, T)
    acc = np.zeros(utc.shape, dtype=np.float64)
    for o in offs:
        acc += np.clip(
            cos_zenith(lat_deg, lon_deg, shift(utc, np.timedelta64(round(o * 60), "s"))),
            0.0,
            None,
        )
    return np.asarray(acc / len(offs), dtype=np.float64)
