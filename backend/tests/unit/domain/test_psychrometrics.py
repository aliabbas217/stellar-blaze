import math

import numpy as np
import pytest

from stellar_blaze.domain.physics.psychrometrics import (
    dewpoint_c_from_vapor_pressure,
    relative_humidity_pct,
    saturation_vapor_pressure_kpa,
    vapor_pressure_kpa_from_dewpoint,
    vapor_pressure_kpa_from_wet_bulb,
)

pytestmark = pytest.mark.unit


def test_buck_at_zero_is_constant() -> None:
    assert saturation_vapor_pressure_kpa(0.0) == pytest.approx(0.61121, rel=1e-9)


def test_buck_agrees_with_magnus() -> None:
    for t in range(0, 51):
        magnus = 0.61094 * math.exp(17.625 * t / (t + 243.04))  # Alduchov & Eskridge (1996)
        assert abs(saturation_vapor_pressure_kpa(float(t)) / magnus - 1.0) < 0.003


def test_buck_at_twenty_degrees_matches_the_tabulated_value() -> None:
    # Saturation over water at 20 C is 23.37 hPa in the WMO tables (Goff-Gratch).
    assert saturation_vapor_pressure_kpa(20.0) == pytest.approx(2.337, rel=2e-3)


def test_saturation_vapor_pressure_is_strictly_increasing_over_the_bisection_bracket() -> None:
    es = saturation_vapor_pressure_kpa(np.linspace(-60.0, 60.0, 2401))
    assert np.all(np.diff(es) > 0.0)


def test_functions_are_vectorised_and_return_float64_arrays() -> None:
    t = np.array([[20.0, 30.0], [35.0, 40.0]])
    es = saturation_vapor_pressure_kpa(t)
    assert isinstance(es, np.ndarray)
    assert es.shape == (2, 2)
    assert es.dtype == np.float64
    assert es[1, 0] == saturation_vapor_pressure_kpa(35.0)


def test_scalar_input_gives_a_zero_dimensional_float64_array() -> None:
    for result in (
        saturation_vapor_pressure_kpa(30.0),
        vapor_pressure_kpa_from_dewpoint(20.0),
        relative_humidity_pct(30.0, 20.0),
        dewpoint_c_from_vapor_pressure(2.0),
        vapor_pressure_kpa_from_wet_bulb(38.7, 28.6, 1013.0),
    ):
        assert isinstance(result, np.ndarray)
        assert result.ndim == 0
        assert result.dtype == np.float64


def test_vapor_pressure_from_dewpoint_is_saturation_at_the_dewpoint() -> None:
    td = np.array([-5.0, 12.5, 24.0])
    assert np.array_equal(vapor_pressure_kpa_from_dewpoint(td), saturation_vapor_pressure_kpa(td))


def test_relative_humidity_vector() -> None:
    assert relative_humidity_pct(30.0, 20.0) == pytest.approx(55.083, abs=0.01)
    assert relative_humidity_pct(25.0, 25.0) == 100.0
    both = relative_humidity_pct(np.array([30.0, 25.0]), np.array([20.0, 25.0]))
    assert both == pytest.approx([55.083, 100.0], abs=0.01)


def test_relative_humidity_is_exactly_100_when_the_dewpoint_reaches_the_temperature() -> None:
    # Naively 100 * es / es is 99.99999999999999 at 25 C; saturation must not depend on rounding.
    t = np.arange(-10.0, 50.5, 0.5)
    assert np.all(relative_humidity_pct(t, t) == 100.0)
    assert np.all(relative_humidity_pct(t[::2], t.copy()[::2]) == 100.0)


def test_relative_humidity_is_clipped_to_100_for_a_dewpoint_above_the_temperature() -> None:
    assert relative_humidity_pct(24.0, 24.4) == 100.0


def test_relative_humidity_stays_inside_zero_to_100_and_falls_with_the_dewpoint_depression() -> None:
    td = np.linspace(-30.0, 35.0, 131)
    rh = relative_humidity_pct(np.full_like(td, 35.0), td)
    assert np.all((rh >= 0.0) & (rh <= 100.0))
    assert np.all(np.diff(rh) > 0.0)


def test_relative_humidity_propagates_nan() -> None:
    rh = relative_humidity_pct(np.array([30.0, np.nan, 30.0]), np.array([20.0, 20.0, np.nan]))
    assert rh[0] == pytest.approx(55.083, abs=0.01)
    assert np.isnan(rh[1:]).all()


def test_dewpoint_round_trip() -> None:
    x = np.arange(-10.0, 40.5, 0.5)
    assert dewpoint_c_from_vapor_pressure(saturation_vapor_pressure_kpa(x)) == pytest.approx(x, abs=1e-6)


def test_dewpoint_keeps_the_input_shape() -> None:
    e = saturation_vapor_pressure_kpa(np.array([[10.0, 20.0, 30.0], [15.0, 25.0, 35.0]]))
    assert dewpoint_c_from_vapor_pressure(e).shape == (2, 3)


def test_dewpoint_is_nan_where_it_cannot_be_inverted_inside_the_bracket() -> None:
    low = saturation_vapor_pressure_kpa(-60.0) * 0.5
    high = saturation_vapor_pressure_kpa(60.0) * 2.0
    out = dewpoint_c_from_vapor_pressure(np.array([low, 0.0, -1.0, high, np.nan, 2.0]))
    assert np.isnan(out[:5]).all()
    assert out[5] == pytest.approx(17.5, abs=0.5)


def test_dewpoint_reaches_the_bracket_ends() -> None:
    ends = dewpoint_c_from_vapor_pressure(saturation_vapor_pressure_kpa(np.array([-60.0, 60.0])))
    assert ends == pytest.approx([-60.0, 60.0], abs=1e-6)


def test_wet_bulb_vapor_pressure_formula() -> None:
    assert vapor_pressure_kpa_from_wet_bulb(38.7, 28.6, 1013.0) == pytest.approx(3.22949, abs=1e-4)


def test_wet_bulb_at_saturation_is_the_saturation_pressure() -> None:
    assert vapor_pressure_kpa_from_wet_bulb(24.0, 24.0, 1013.0) == pytest.approx(saturation_vapor_pressure_kpa(24.0))


def test_wet_bulb_vapor_pressure_broadcasts_and_falls_with_pressure() -> None:
    e = vapor_pressure_kpa_from_wet_bulb(38.7, 28.6, np.array([900.0, 1013.0, 1030.0]))
    assert e.shape == (3,)
    assert np.all(np.diff(e) < 0.0)


def test_wet_bulb_chain_gives_a_dewpoint_below_the_wet_bulb() -> None:
    e = vapor_pressure_kpa_from_wet_bulb(38.7, 28.6, 1013.0)
    td = dewpoint_c_from_vapor_pressure(e)
    assert saturation_vapor_pressure_kpa(td) == pytest.approx(e, rel=1e-6)
    assert td < 28.6 < 38.7
