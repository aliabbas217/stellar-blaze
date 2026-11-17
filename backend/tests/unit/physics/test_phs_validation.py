import math

import pytest
from pydantic import ValidationError

from stellar_blaze.domain.physics.phs import (
    PhsInputs,
    PhsRejected,
    PhsResult,
    check_phs_output,
    validate_phs_inputs,
)

pytestmark = pytest.mark.unit

# The reference case of the adapter tests: inside every part of the ISO 7933 window, vapor pressure 2.43 kPa.
VALID = {"tdb_c": 40.0, "tr_c": 45.0, "v_ms": 0.3, "rh_pct": 33.0, "met": 2.5, "clo": 0.5}
FLOAT_FIELDS = ("tdb_c", "tr_c", "v_ms", "rh_pct", "met", "clo", "weight_kg", "height_m")


def _inputs(**overrides: float | str) -> PhsInputs:
    return PhsInputs.model_validate({**VALID, **overrides})


def _result(**overrides: float) -> PhsResult:
    values = {
        "t_re_c": 37.5,
        "d_lim_t_re_min": 480.0,
        "d_lim_loss_50_min": 283.0,
        "d_lim_loss_95_min": 283.0,
        "sweat_loss_g": 6495.2,
    }
    return PhsResult.model_validate({**values, **overrides})


def _reason(rejected: PhsRejected | None) -> str | None:
    return None if rejected is None else rejected.reason


def test_a_valid_case_passes() -> None:
    assert validate_phs_inputs(_inputs()) is None


def test_defaults_are_the_kernel_reference_person() -> None:
    inputs = _inputs()
    assert (inputs.posture, inputs.weight_kg, inputs.height_m) == ("standing", 75.0, 1.8)


def test_inputs_are_frozen_and_reject_unknown_fields() -> None:
    inputs = _inputs()
    with pytest.raises(ValidationError):
        inputs.tdb_c = 41.0  # type: ignore[misc]
    with pytest.raises(ValidationError):
        PhsInputs.model_validate({**VALID, "walk_speed": 1.0})


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
@pytest.mark.parametrize("field", FLOAT_FIELDS)
def test_nan_rejected_before_kernel(field: str, bad: float) -> None:
    # A non-finite number in any field makes the kernel loop forever (upstream #524), so none may reach it.
    rejected = validate_phs_inputs(_inputs(**{field: bad}))
    assert rejected is not None
    assert rejected.reason == "invalid_input"
    assert field in rejected.detail


@pytest.mark.parametrize("overrides", [{"tdb_c": 52.0}, {"met": 5.0}, {"tr_c": 40.0}])
def test_out_of_window_rejected(overrides: dict[str, float]) -> None:
    # tdb 52 is above 50; met 5.0 is above 4.3; tr == tdb has no radiant load (needs 0 < tr - tdb).
    rejected = validate_phs_inputs(_inputs(**overrides))
    assert rejected is not None
    assert rejected.reason == "out_of_scope"


@pytest.mark.parametrize(
    ("overrides", "mentioned"),
    [
        ({"tdb_c": 15.0, "tr_c": 20.0, "rh_pct": 40.0}, "tdb_c"),
        ({"tdb_c": 50.0, "tr_c": 55.0, "rh_pct": 20.0}, "tdb_c"),
        ({"tdb_c": 10.0, "tr_c": 15.0, "rh_pct": 60.0}, "tdb_c"),
        ({"tr_c": 39.0}, "tr_c"),
        ({"tr_c": 100.0}, "tr_c"),
        ({"v_ms": 0.0}, "v_ms"),
        ({"v_ms": 3.0}, "v_ms"),
        ({"clo": 0.1}, "clo"),
        ({"clo": 1.0}, "clo"),
        ({"met": 0.9}, "met"),
        ({"met": 4.4}, "met"),
    ],
)
def test_window_edges_are_exclusive_where_the_standard_says_so(overrides: dict[str, float], mentioned: str) -> None:
    rejected = validate_phs_inputs(_inputs(**overrides))
    assert rejected is not None
    assert rejected.reason == "out_of_scope"
    assert mentioned in rejected.detail


@pytest.mark.parametrize(
    "overrides",
    [
        {"tdb_c": 15.5, "tr_c": 16.0, "rh_pct": 40.0},
        {"tdb_c": 49.5, "tr_c": 50.0, "rh_pct": 20.0},
        {"tr_c": 40.1},
        {"tr_c": 99.9},
        {"v_ms": 0.01},
        {"v_ms": 2.99},
        {"clo": 0.11},
        {"clo": 0.99},
        {"met": 0.97},
        {"met": 4.29},
    ],
)
def test_just_inside_the_window_passes(overrides: dict[str, float]) -> None:
    assert validate_phs_inputs(_inputs(**overrides)) is None


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        # Hot and humid: 38 C at 70 % RH is 4.64 kPa. ISO 7933 Annex A limits vapor pressure to 0.5-4.5 kPa and the
        # kernel returns NaN outside it; this, not the other limits, is what makes about 19 percent of in-range
        # samples NaN.
        ({"tdb_c": 38.0, "tr_c": 41.0, "rh_pct": 70.0}, "out_of_scope"),
        # Hot and bone dry: 40 C at 4 % RH is 0.30 kPa, under the 0.5 kPa floor of the 2023 edition.
        ({"tdb_c": 40.0, "tr_c": 45.0, "rh_pct": 4.0}, "out_of_scope"),
        ({"rh_pct": -1.0}, "invalid_input"),
        ({"rh_pct": 100.5}, "invalid_input"),
    ],
)
def test_vapor_pressure_window_and_humidity_range(overrides: dict[str, float], reason: str) -> None:
    rejected = validate_phs_inputs(_inputs(**overrides))
    assert rejected is not None
    assert rejected.reason == reason
    assert "rh_pct" in rejected.detail or "vapor pressure" in rejected.detail


@pytest.mark.parametrize(
    ("met", "accepted"),
    [(0.962, False), (0.964, True), (4.298, True), (4.300, False)],
)
def test_met_window_is_the_kernels_watts_window(met: float, accepted: bool) -> None:
    # The kernel converts met at 58.15 W/m2 per met and accepts 56 to 250 W/m2, which is 0.9630 to 4.2992 met, so the
    # quoted "0.96 to 4.3" edges themselves return NaN (verified against pythermalcomfort 4.8.1).
    assert (validate_phs_inputs(_inputs(met=met)) is None) is accepted


@pytest.mark.parametrize("overrides", [{"height_m": 0.0}, {"height_m": -1.8}])
def test_zero_height_rejected(overrides: dict[str, float]) -> None:
    # The kernel divides by the body surface area built from height and weight; zero gives garbage or a SystemError.
    rejected = validate_phs_inputs(_inputs(**overrides))
    assert rejected is not None
    assert rejected.reason == "invalid_input"
    assert "height_m" in rejected.detail


@pytest.mark.parametrize("overrides", [{"weight_kg": 0.0}, {"weight_kg": -75.0}, {"weight_kg": 1000.5}, {"clo": 0.0}])
def test_non_positive_body_and_clothing_rejected(overrides: dict[str, float]) -> None:
    # weight above 1000 kg is refused by the kernel itself (ValueError); clo 0 is a zero divisor (stack doc 6.3).
    rejected = validate_phs_inputs(_inputs(**overrides))
    assert rejected is not None
    assert rejected.reason == "invalid_input"


def test_invalid_input_wins_over_out_of_scope() -> None:
    # tdb 60 is out of scope, but a NaN elsewhere decides the reason: the numbers cannot be reasoned about at all.
    rejected = validate_phs_inputs(_inputs(tdb_c=60.0, tr_c=65.0, met=math.nan))
    assert _reason(rejected) == "invalid_input"


def test_every_violation_is_named() -> None:
    rejected = validate_phs_inputs(_inputs(tdb_c=55.0, tr_c=55.0, v_ms=5.0))
    assert rejected is not None
    for name in ("tdb_c", "tr_c", "v_ms"):
        assert name in rejected.detail


@pytest.mark.parametrize("t_re_c", [36.0, 37.5, 42.0])
def test_plausible_output_passes(t_re_c: float) -> None:
    assert check_phs_output(_result(t_re_c=t_re_c)) is None


@pytest.mark.parametrize("t_re_c", [35.99, 30.0, 0.0])
def test_implausible_output_rejected(t_re_c: float) -> None:
    # 0.0 is what the kernel returned for height 0 on 4.8.1: finite, not NaN, and not a body temperature.
    rejected = check_phs_output(_result(t_re_c=t_re_c))
    assert rejected is not None
    assert rejected.reason == "implausible_output"


@pytest.mark.parametrize(("t_re_c", "d_lim_t_re_min"), [(42.01, 39.0), (43.5, 27.0), (46.3, 18.0), (48.8, 20.0)])
def test_a_hot_prediction_exceeds_the_model_range_and_is_never_missing_data(
    t_re_c: float, d_lim_t_re_min: float
) -> None:
    # Above 42 C the input was in the window and the model says "past my range": the most severe band, not garbage.
    # ADR 0006 originally lumped this with `implausible_output`; the Task 14 review split it (the most dangerous
    # valid cases).
    rejected = check_phs_output(_result(t_re_c=t_re_c, d_lim_t_re_min=d_lim_t_re_min))
    assert rejected is not None
    assert rejected.reason == "exceeds_model_range"
    assert "most severe band" in rejected.detail
    assert "never as missing data" in rejected.detail
    assert f"after {d_lim_t_re_min:g} min" in rejected.detail
    assert f"{t_re_c:g} C" in rejected.detail


def test_the_three_output_rejections_are_distinct() -> None:
    reasons = {
        _reason(check_phs_output(_result(t_re_c=30.0))),
        _reason(check_phs_output(_result(t_re_c=45.0))),
        _reason(check_phs_output(_result(t_re_c=math.nan))),
    }
    assert reasons == {"implausible_output", "exceeds_model_range", "nan_output"}


@pytest.mark.parametrize(
    "field", ["t_re_c", "d_lim_t_re_min", "d_lim_loss_50_min", "d_lim_loss_95_min", "sweat_loss_g"]
)
@pytest.mark.parametrize("bad", [math.nan, math.inf])
def test_non_finite_output_rejected_as_nan_output(field: str, bad: float) -> None:
    rejected = check_phs_output(_result(**{field: bad}))
    assert rejected is not None
    assert rejected.reason == "nan_output"
    assert field in rejected.detail
