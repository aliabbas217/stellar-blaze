import numpy as np
import pandas as pd
import pytest
from numpy.typing import NDArray
from pvlib.solarposition import get_solarposition

from stellar_blaze.domain.physics.solar import cos_zenith, mean_cos_zenith_prev_hour, shift

pytestmark = pytest.mark.unit

OMAA_LAT, OMAA_LON = 24.4330, 54.6511  # Abu Dhabi International (station table)
DAY = np.datetime64("2025-07-15T00:00", "m")


def _day(step_minutes: int, count: int) -> NDArray[np.datetime64]:
    return DAY + np.arange(count) * np.timedelta64(step_minutes, "m")


def test_cos_zenith_matches_pvlib() -> None:
    utc = _day(5, 288)
    pv = get_solarposition(pd.DatetimeIndex(utc).tz_localize("UTC"), OMAA_LAT, OMAA_LON)
    expected = np.cos(np.radians(pv["zenith"].to_numpy(dtype=np.float64)))
    # Stack doc 6.6 measured a maximum difference of 5.0e-5 over one Abu Dhabi day.
    assert np.max(np.abs(cos_zenith(OMAA_LAT, OMAA_LON, utc) - expected)) <= 1e-4


def test_cos_zenith_at_solar_noon_and_at_local_midnight() -> None:
    # Local solar noon at 54.65 E in mid-July is about 08:15 UTC, with the sun near the zenith at 24.4 N.
    noon = cos_zenith(OMAA_LAT, OMAA_LON, np.array(["2025-07-15T08:15"], dtype="datetime64[m]"))
    midnight = cos_zenith(OMAA_LAT, OMAA_LON, np.array(["2025-07-15T20:15"], dtype="datetime64[m]"))
    assert noon[0] > 0.99
    # At local midnight cos zenith = -cos(latitude + declination) = -cos(24.4 + 21.5 degrees) = -0.70.
    assert midnight[0] == pytest.approx(-0.70, abs=0.02)


def test_cos_zenith_preserves_shape_and_returns_float64() -> None:
    utc = _day(60, 24).reshape(4, 6)
    result = cos_zenith(OMAA_LAT, OMAA_LON, utc)
    assert result.shape == (4, 6)
    assert result.dtype == np.float64


def test_cos_zenith_does_not_depend_on_the_datetime_unit() -> None:
    utc = _day(60, 24)
    reference = cos_zenith(OMAA_LAT, OMAA_LON, utc)
    for unit in ("s", "ms", "ns"):
        np.testing.assert_array_equal(cos_zenith(OMAA_LAT, OMAA_LON, utc.astype(f"datetime64[{unit}]")), reference)


def test_shift_adds_a_signed_timedelta() -> None:
    utc = _day(60, 3)
    np.testing.assert_array_equal(shift(utc, -np.timedelta64(30, "m")), utc - np.timedelta64(30, "m"))


def test_mean_cos_zenith_prev_hour_is_zero_at_night_and_bounded_by_the_unit_interval() -> None:
    utc = _day(60, 24)
    mean = mean_cos_zenith_prev_hour(OMAA_LAT, OMAA_LON, utc)
    assert mean.shape == utc.shape
    assert mean.dtype == np.float64
    assert np.all((mean >= 0.0) & (mean <= 1.0))
    # Label 20:00 UTC covers 19:00-20:00 UTC, which is 23:00-24:00 in Abu Dhabi.
    assert mean[20] == 0.0
    # Label 09:00 UTC covers 08:00-09:00 UTC, the hour around solar noon.
    assert mean[9] > 0.99


def test_mean_cos_zenith_prev_hour_matches_a_one_minute_average() -> None:
    utc = _day(60, 24)
    one_minute = np.mean(
        [
            np.clip(cos_zenith(OMAA_LAT, OMAA_LON, shift(utc, -np.timedelta64(60 * k - 30, "s"))), 0.0, None)
            for k in range(1, 61)
        ],
        axis=0,
    )
    # The 12-point midpoint rule of the FHC function against a 60-point midpoint rule; the clip at the horizon is the
    # only kink.
    np.testing.assert_allclose(mean_cos_zenith_prev_hour(OMAA_LAT, OMAA_LON, utc), one_minute, atol=2e-3)
