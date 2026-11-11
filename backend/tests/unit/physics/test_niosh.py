import math
import tomllib
from pathlib import Path

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from stellar_blaze.domain.physics.niosh import Clothing, effective_wbgt_c, ral_wbgt_c, rel_wbgt_c

pytestmark = pytest.mark.unit

RULESET = Path(__file__).resolve().parents[3] / "rulesets" / "ae-heat-0.1.toml"


@pytest.mark.parametrize(
    ("metabolic_rate_w", "rel", "ral"),
    [
        (180.0, 30.76, 28.10),
        (300.0, 28.21, 24.97),
        (415.0, 26.59, 22.99),
    ],
)
def test_niosh_vectors(metabolic_rate_w: float, rel: float, ral: float) -> None:
    # NIOSH (2016) section 8.1; vectors computed from the published equations (stack doc section 6.4).
    assert rel_wbgt_c(metabolic_rate_w) == pytest.approx(rel, abs=0.005)
    assert ral_wbgt_c(metabolic_rate_w) == pytest.approx(ral, abs=0.005)


def test_the_equations_are_the_published_ones() -> None:
    # Exact form, not only the rounded vectors: REL = 56.7 - 11.5 log10 M, RAL = 59.9 - 14.1 log10 M.
    for m in (100.0, 250.0, 1000.0):
        assert rel_wbgt_c(m) == pytest.approx(56.7 - 11.5 * math.log10(m), rel=1e-12)
        assert ral_wbgt_c(m) == pytest.approx(59.9 - 14.1 * math.log10(m), rel=1e-12)


@settings(max_examples=200, deadline=None, database=None, derandomize=True)
@given(m1=st.floats(100.0, 900.0), step=st.floats(1.0, 100.0))
def test_limits_fall_with_workload(m1: float, step: float) -> None:
    # The pair is at least 1 W apart, so the limits differ by at least 11.5 * log10(901 / 900) = 0.005 C (REL; RAL
    # more), about 12 orders of magnitude above float noise: "strictly decreasing" cannot fail on adjacent floats
    # (preflight F27).
    m2 = m1 + step
    assert rel_wbgt_c(m2) < rel_wbgt_c(m1)
    assert ral_wbgt_c(m2) < ral_wbgt_c(m1)
    assert ral_wbgt_c(m1) < rel_wbgt_c(m1)
    assert ral_wbgt_c(m2) < rel_wbgt_c(m2)


def test_limits_fall_along_a_grid() -> None:
    grid = np.linspace(100.0, 1000.0, 91)
    assert np.all(np.diff(rel_wbgt_c(grid)) < 0.0)
    assert np.all(np.diff(ral_wbgt_c(grid)) < 0.0)
    assert np.all(ral_wbgt_c(grid) < rel_wbgt_c(grid))


def test_alert_limit_is_below_exposure_limit_only_above_the_crossover() -> None:
    # 59.9 - 14.1 L = 56.7 - 11.5 L at L = 3.2 / 2.6, i.e. M = 17.0 W, far below any working or resting rate.
    assert ral_wbgt_c(16.0) > rel_wbgt_c(16.0)
    assert ral_wbgt_c(18.0) < rel_wbgt_c(18.0)


def test_limits_are_vectorized_float64_arrays() -> None:
    m = np.array([[180.0, 300.0], [415.0, 600.0]])
    for fn in (rel_wbgt_c, ral_wbgt_c):
        out = fn(m)
        assert isinstance(out, np.ndarray)
        assert out.shape == (2, 2)
        assert out.dtype == np.float64
        assert out[0, 1] == pytest.approx(float(fn(300.0)), rel=1e-12)


def test_scalar_input_gives_a_zero_dimensional_float64_array() -> None:
    for result in (rel_wbgt_c(180.0), ral_wbgt_c(180), effective_wbgt_c(28.0, 1.0)):
        assert isinstance(result, np.ndarray)
        assert result.ndim == 0
        assert result.dtype == np.float64


@pytest.mark.parametrize("bad", [0.0, -1.0, -300.0, float("nan"), float("inf"), float("-inf")])
def test_nonpositive_or_nonfinite_rate_rejected(bad: float) -> None:
    with pytest.raises(ValueError, match="metabolic_rate_w"):
        rel_wbgt_c(bad)
    with pytest.raises(ValueError, match="metabolic_rate_w"):
        ral_wbgt_c(bad)


def test_nonpositive_rate_rejected() -> None:
    with pytest.raises(ValueError, match="metabolic_rate_w"):
        rel_wbgt_c(0)
    with pytest.raises(ValueError, match="metabolic_rate_w"):
        ral_wbgt_c(float("nan"))


def test_one_bad_element_rejects_the_whole_array() -> None:
    with pytest.raises(ValueError, match="metabolic_rate_w"):
        rel_wbgt_c(np.array([180.0, float("nan"), 300.0]))
    with pytest.raises(ValueError, match="metabolic_rate_w"):
        ral_wbgt_c([180.0, 0.0])


def test_the_error_message_shows_a_plain_float_not_a_numpy_repr() -> None:
    with pytest.raises(ValueError, match=r"first offending value: nan$"):
        rel_wbgt_c(np.array([180.0, float("nan")]))
    with pytest.raises(ValueError, match=r"first offending value: -2\.0$"):
        ral_wbgt_c(np.array([-2.0, 180.0]))


def test_adjustment_is_added() -> None:
    assert effective_wbgt_c(28.0, 11.0) == 39.0
    with pytest.raises(ValueError, match="adjustment_c"):
        effective_wbgt_c(28.0, -1.0)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -0.5])
def test_unusable_adjustment_rejected(bad: float) -> None:
    with pytest.raises(ValueError, match="adjustment_c"):
        effective_wbgt_c(28.0, bad)


def test_zero_adjustment_is_the_identity_and_nan_wbgt_stays_nan() -> None:
    wbgt = np.array([25.0, float("nan"), 31.5])
    out = effective_wbgt_c(wbgt, 0.0)
    assert out[0] == 25.0
    assert math.isnan(out[1])
    assert out[2] == 31.5
    shifted = effective_wbgt_c(wbgt, 3.0)
    assert shifted[0] == 28.0
    assert math.isnan(shifted[1])


def test_clothing_values_are_the_lower_case_names() -> None:
    assert [c.value for c in Clothing] == [
        "work_clothes",
        "cloth_coveralls",
        "double_layer_woven",
        "sms_coveralls",
        "polyolefin_coveralls",
        "limited_use_vapor_barrier",
    ]
    assert all(c.value == c.name.lower() for c in Clothing)
    assert Clothing("sms_coveralls") is Clothing.SMS_COVERALLS
    assert str(Clothing.WORK_CLOTHES) == "work_clothes"


def test_clothing_enum_matches_ruleset_keys() -> None:
    ruleset = tomllib.loads(RULESET.read_text(encoding="utf-8"))
    assert {c.value for c in Clothing} == set(ruleset["niosh_clothing"]["values_c"])
