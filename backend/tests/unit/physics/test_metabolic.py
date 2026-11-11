import math

import numpy as np
import pytest

from stellar_blaze.domain.physics.metabolic import (
    W_PER_M2_PER_MET,
    body_surface_area_dubois_m2,
    met_to_watts,
    watts_to_met,
)

pytestmark = pytest.mark.unit


def test_dubois_vector() -> None:
    # 0.202 * 70**0.425 * 1.75**0.725 = 1.84383 (preflight re-computation).
    assert body_surface_area_dubois_m2(70, 1.75) == pytest.approx(1.8438, abs=0.0005)


def test_dubois_uses_the_iso_7933_form() -> None:
    for weight, height in ((55.0, 1.60), (80.0, 1.80), (106.0, 1.80)):
        assert body_surface_area_dubois_m2(weight, height) == pytest.approx(
            0.202 * weight**0.425 * height**0.725, rel=1e-12
        )


def test_dubois_returns_a_plain_float() -> None:
    assert type(body_surface_area_dubois_m2(70.0, 1.75)) is float


def test_dubois_grows_with_weight_and_height() -> None:
    assert body_surface_area_dubois_m2(80.0, 1.75) > body_surface_area_dubois_m2(70.0, 1.75)
    assert body_surface_area_dubois_m2(70.0, 1.85) > body_surface_area_dubois_m2(70.0, 1.75)


@pytest.mark.parametrize("bad", [0.0, -70.0, float("nan"), float("inf")])
def test_dubois_rejects_unusable_body_measurements(bad: float) -> None:
    # A negative base would otherwise raise a complex number from ``**`` instead of an error.
    with pytest.raises(ValueError, match="weight_kg"):
        body_surface_area_dubois_m2(bad, 1.75)
    with pytest.raises(ValueError, match="height_m"):
        body_surface_area_dubois_m2(70.0, bad)


def test_met_constant_is_the_conventional_definition() -> None:
    assert W_PER_M2_PER_MET == 58.2


def test_met_round_trip() -> None:
    assert watts_to_met(met_to_watts(2.5, 1.8), 1.8) == pytest.approx(2.5)
    assert met_to_watts(1.0, 1.0) == 58.2


def test_met_to_watts_scales_with_body_surface_area() -> None:
    assert met_to_watts(2.5, 1.8) == pytest.approx(2.5 * 58.2 * 1.8)
    assert watts_to_met(261.9, 1.8) == pytest.approx(2.5)


def test_phs_applicability_window_in_watts_per_square_meter() -> None:
    # pythermalcomfort's PHS window is 0.96 to 4.3 met, quoted as 56 to 250 W/m2 (preflight a32).
    assert met_to_watts(0.96, 1.0) == pytest.approx(56.0, abs=0.2)
    assert met_to_watts(4.3, 1.0) == pytest.approx(250.0, abs=0.5)


def test_conversions_are_vectorized_float64_arrays() -> None:
    met = np.array([[1.0, 2.0], [3.0, 4.0]])
    watts = met_to_watts(met, 1.8)
    assert isinstance(watts, np.ndarray)
    assert watts.shape == (2, 2)
    assert watts.dtype == np.float64
    back = watts_to_met(watts, 1.8)
    assert back.shape == (2, 2)
    assert back.dtype == np.float64
    assert back == pytest.approx(met)


def test_scalar_input_gives_a_zero_dimensional_float64_array() -> None:
    for result in (met_to_watts(2.0, 1.8), watts_to_met(200, 1.8)):
        assert isinstance(result, np.ndarray)
        assert result.ndim == 0
        assert result.dtype == np.float64


def test_nan_passes_through_conversions() -> None:
    assert math.isnan(float(met_to_watts(float("nan"), 1.8)))
    assert math.isnan(float(watts_to_met(float("nan"), 1.8)))


@pytest.mark.parametrize("bad", [0.0, -1.8, float("nan"), float("inf")])
def test_conversions_reject_unusable_body_surface_area(bad: float) -> None:
    with pytest.raises(ValueError, match="bsa_m2"):
        met_to_watts(2.0, bad)
    with pytest.raises(ValueError, match="bsa_m2"):
        watts_to_met(200.0, bad)
