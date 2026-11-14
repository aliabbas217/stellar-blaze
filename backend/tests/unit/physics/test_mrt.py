"""Globe temperature and MRT: the Liljegren globe and thermofeel's MRT conversion, checked against thermofeel itself.

The globe solver is thermofeel-internal API (``thermofeel.liljegren.solve_globe``, pinned ``thermofeel==2.3.0``).
It takes kelvin, a relative-humidity fraction and the 2 m wind. A wrong unit gives a plausible wrong number, not an
error, so the expected values here are computed in the test with thermofeel called directly, step by step.
"""

from typing import TypedDict

import numpy as np
import pytest
from numpy.typing import NDArray
from thermofeel import calculate_mrt_from_bgt, calculate_wind_speed_2m_liljegren
from thermofeel.liljegren import solve_globe

from stellar_blaze.domain.physics import wbgt as wbgt_module
from stellar_blaze.domain.physics.psychrometrics import relative_humidity_pct
from stellar_blaze.domain.physics.solar import cos_zenith
from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.physics.wbgt import globe_temperature_c, mrt_from_globe_c, wbgt_liljegren

pytestmark = pytest.mark.unit

OMAA_LAT, OMAA_LON = 24.4330, 54.6511
KELVIN = 273.15
HALF_HOUR = np.timedelta64(30, "m")


def _arr(*values: float) -> F64:
    return np.array(values, dtype=np.float64)


def _times(*stamps: str) -> NDArray[np.datetime64]:
    return np.array(stamps, dtype="datetime64[us]")


# (label, t, td, wind10, pressure, sw, direct): noon, morning and night at OMAA on 2026-07-01.
NOON = ("2026-07-01T08:00", 44.0, 18.0, 3.0, 1000.0, 900.0, 700.0)
MORNING = ("2026-07-01T04:00", 36.0, 22.0, 2.0, 1005.0, 450.0, 300.0)
NIGHT = ("2026-07-01T20:00", 33.0, 24.0, 1.5, 1004.0, 0.0, 0.0)
VECTORS = [NOON, MORNING, NIGHT]


class _Inputs(TypedDict):
    t_c: F64
    td_c: F64
    wind10m_ms: F64
    pressure_hpa: F64
    sw_wm2: F64
    direct_wm2: F64
    valid_time_utc: NDArray[np.datetime64]


def _inputs(vector: tuple[str, float, float, float, float, float, float]) -> _Inputs:
    stamp, t, td, wind, pressure, sw, direct = vector
    return _Inputs(
        t_c=_arr(t),
        td_c=_arr(td),
        wind10m_ms=_arr(wind),
        pressure_hpa=_arr(pressure),
        sw_wm2=_arr(sw),
        direct_wm2=_arr(direct),
        valid_time_utc=_times(stamp),
    )


def _thermofeel_globe_mrt(vector: tuple[str, float, float, float, float, float, float]) -> tuple[float, float]:
    """The same quantities computed with thermofeel called directly (the public wrapper's steps, with the units)."""
    stamp, t, td, wind, pressure, sw, direct = vector
    label = _times(stamp)
    cz = np.clip(cos_zenith(OMAA_LAT, OMAA_LON, label - HALF_HOUR), 0.0, None)
    fdir = np.clip(np.divide(direct, sw, out=np.zeros(1), where=np.array([sw > 1e-6])), 0.0, 0.9)
    fdir = np.where(cz < 0.00873, 0.0, fdir)
    va = np.maximum(_arr(wind), 0.62)
    speed_2m = calculate_wind_speed_2m_liljegren(va, cz, _arr(sw))
    rh_fraction = relative_humidity_pct(_arr(t), _arr(td)) / 100.0
    globe_c = solve_globe(_arr(t + KELVIN), rh_fraction, _arr(pressure), speed_2m, _arr(sw), fdir, cz)
    mrt_k = calculate_mrt_from_bgt(_arr(t + KELVIN), globe_c + KELVIN, _arr(wind))
    return float(globe_c[0]), float(mrt_k[0] - KELVIN)


@pytest.mark.parametrize("vector", VECTORS, ids=["noon", "morning", "night"])
def test_mrt_vectors(vector: tuple[str, float, float, float, float, float, float]) -> None:
    expected_globe, expected_mrt = _thermofeel_globe_mrt(vector)
    inputs = _inputs(vector)
    globe = globe_temperature_c(**inputs, lat=OMAA_LAT, lon=OMAA_LON)
    assert globe[0] == pytest.approx(expected_globe, abs=0.01)
    mrt = mrt_from_globe_c(t_c=inputs["t_c"], globe_c=globe, wind10m_ms=inputs["wind10m_ms"])
    assert mrt[0] == pytest.approx(expected_mrt, abs=0.01)


def test_noon_worked_example_from_the_controller_dry_run() -> None:
    # OMAA 2026-07-01 08:00 UTC, T 44, Td 18, wind10 3, 1000 hPa, sw 900, direct 700: globe 57.587 C, MRT 88.582 C
    # (the repo's wbgt_liljegren gives 34.773 C for the same inputs).
    inputs = _inputs(NOON)
    globe = globe_temperature_c(**inputs, lat=OMAA_LAT, lon=OMAA_LON)
    mrt = mrt_from_globe_c(t_c=inputs["t_c"], globe_c=globe, wind10m_ms=inputs["wind10m_ms"])
    assert globe[0] == pytest.approx(57.587, abs=0.01)
    assert mrt[0] == pytest.approx(88.582, abs=0.01)
    wbgt = wbgt_liljegren(**inputs, lat=OMAA_LAT, lon=OMAA_LON)
    assert wbgt.wbgt_c[0] == pytest.approx(34.773, abs=0.01)


@pytest.mark.parametrize("wind", [0.5, 3.0, 10.0])
def test_without_sun_the_globe_and_the_mrt_are_not_above_the_air(wind: float) -> None:
    # At sw = 0 the globe is BELOW air temperature (it loses heat to the cold sky), so MRT is below T too; the plan
    # text's "MRT = T when sw = 0" is false (T 44, Td 18, wind 10: globe 43.32, MRT 39.08).
    vector = ("2026-07-01T20:00", 44.0, 18.0, wind, 1000.0, 0.0, 0.0)
    inputs = _inputs(vector)
    globe = globe_temperature_c(**inputs, lat=OMAA_LAT, lon=OMAA_LON)
    mrt = mrt_from_globe_c(t_c=inputs["t_c"], globe_c=globe, wind10m_ms=inputs["wind10m_ms"])
    assert globe[0] <= 44.0
    assert mrt[0] <= 44.0
    assert mrt[0] > 44.0 - 10.0  # a sane value, not garbage


def test_hot_wind_example_matches_the_reported_numbers() -> None:
    vector = ("2026-07-01T20:00", 44.0, 18.0, 10.0, 1000.0, 0.0, 0.0)
    inputs = _inputs(vector)
    globe = globe_temperature_c(**inputs, lat=OMAA_LAT, lon=OMAA_LON)
    mrt = mrt_from_globe_c(t_c=inputs["t_c"], globe_c=globe, wind10m_ms=inputs["wind10m_ms"])
    assert globe[0] == pytest.approx(43.32, abs=0.01)
    assert mrt[0] == pytest.approx(39.08, abs=0.01)


def test_globe_is_nan_exactly_where_wbgt_rejects_the_element() -> None:
    # Same guards as wbgt_liljegren (they share one preparation): a NaN input, negative radiation, and radiation
    # with the sun down are rejected there, so the globe is NaN there too; the accepted element stays finite.
    stamp = "2026-07-01T08:00"
    night = "2026-07-01T20:00"
    n = 4
    kwargs = _Inputs(
        t_c=_arr(*[40.0] * n),
        td_c=_arr(*[20.0] * n),
        wind10m_ms=_arr(*[2.0] * n),
        pressure_hpa=_arr(*[1000.0] * n),
        sw_wm2=_arr(800.0, 800.0, -5.0, 400.0),
        direct_wm2=_arr(600.0, 600.0, 0.0, 300.0),
        valid_time_utc=_times(stamp, stamp, stamp, night),
    )
    kwargs["t_c"][1] = np.nan
    globe = globe_temperature_c(**kwargs, lat=OMAA_LAT, lon=OMAA_LON)
    rejected = wbgt_liljegren(**kwargs, lat=OMAA_LAT, lon=OMAA_LON).wbgt_c
    assert np.isnan(globe).tolist() == np.isnan(rejected).tolist() == [False, True, True, True]


@pytest.mark.parametrize(("offset_c", "kept"), [(-29.0, True), (-31.0, False), (39.0, True), (41.0, False)])
def test_the_plausibility_band_is_t_minus_30_to_t_plus_40(
    monkeypatch: pytest.MonkeyPatch, offset_c: float, kept: bool
) -> None:
    # thermofeel returns finite garbage for some inputs; whatever the solver says outside [t - 30, t + 40] is NaN.
    def fake_solve_globe(ta: F64, *_: object) -> F64:
        return ta - KELVIN + offset_c

    monkeypatch.setattr(wbgt_module, "solve_globe", fake_solve_globe)
    globe = globe_temperature_c(**_inputs(NOON), lat=OMAA_LAT, lon=OMAA_LON)
    assert bool(np.isfinite(globe[0])) is kept


def test_the_calmest_full_sun_stays_inside_the_band() -> None:
    # Measured on 2026-11-14: T 48 C, 1100 W/m2 (990 direct), calm (the wind floor 0.62 m/s) gives a globe 25.0 C above
    # the air, so the +40 upper edge keeps 15 C of headroom over the hottest physical case.
    inputs = _inputs(NOON)
    inputs["t_c"] = _arr(48.0)
    inputs["td_c"] = _arr(15.0)
    inputs["wind10m_ms"] = _arr(0.0)
    inputs["sw_wm2"] = _arr(1100.0)
    inputs["direct_wm2"] = _arr(990.0)
    globe = globe_temperature_c(**inputs, lat=OMAA_LAT, lon=OMAA_LON)
    assert 48.0 + 20.0 < globe[0] < 48.0 + 30.0


def test_globe_keeps_the_input_shape() -> None:
    one = _inputs(NOON)
    inputs = _Inputs(
        t_c=np.tile(one["t_c"], (2, 3)),
        td_c=np.tile(one["td_c"], (2, 3)),
        wind10m_ms=np.tile(one["wind10m_ms"], (2, 3)),
        pressure_hpa=np.tile(one["pressure_hpa"], (2, 3)),
        sw_wm2=np.tile(one["sw_wm2"], (2, 3)),
        direct_wm2=np.tile(one["direct_wm2"], (2, 3)),
        valid_time_utc=np.tile(one["valid_time_utc"], (2, 3)),
    )
    globe = globe_temperature_c(**inputs, lat=OMAA_LAT, lon=OMAA_LON)
    assert globe.shape == (2, 3)
    assert np.allclose(globe, globe[0, 0])


def test_globe_rejects_bad_geometry_and_shapes() -> None:
    inputs = _inputs(NOON)
    with pytest.raises(ValueError, match="lat"):
        globe_temperature_c(**inputs, lat=91.0, lon=OMAA_LON)
    inputs["sw_wm2"] = _arr(1.0, 2.0)
    with pytest.raises(ValueError, match="same shape"):
        globe_temperature_c(**inputs, lat=OMAA_LAT, lon=OMAA_LON)


def test_mrt_nan_passes_through_and_negative_wind_is_refused() -> None:
    mrt = mrt_from_globe_c(t_c=_arr(40.0, np.nan), globe_c=_arr(np.nan, 50.0), wind10m_ms=_arr(2.0, 2.0))
    assert np.isnan(mrt).all()
    with pytest.raises(ValueError, match="wind"):
        mrt_from_globe_c(t_c=_arr(40.0), globe_c=_arr(50.0), wind10m_ms=_arr(-1.0))


def test_mrt_is_above_the_globe_when_the_globe_is_above_the_air() -> None:
    # Brimicombe et al. 2023: MRT = (BGT^4 + f * (BGT - T))^(1/4) with f > 0, so a globe warmer than the air gives
    # an MRT above the globe.
    mrt = mrt_from_globe_c(t_c=_arr(40.0), globe_c=_arr(55.0), wind10m_ms=_arr(2.0))
    assert mrt[0] > 55.0
