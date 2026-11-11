import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from stellar_blaze.domain.physics.psychrometrics import (
    dewpoint_c_from_vapor_pressure,
    saturation_vapor_pressure_kpa,
    vapor_pressure_kpa_from_wet_bulb,
)
from stellar_blaze.domain.physics.twl import (
    TWL_CEILING_W_M2,
    TWL_FLOOR_W_M2,
    TwlParams,
    WithdrawalLimits,
    apply_withdrawal_limits,
    body_level_wind_ms,
    twl_w_m2,
    twl_w_m2_array,
)

pytestmark = pytest.mark.unit

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "twl" / "miller_bates_2007_table2.json"

# The reference solver bisects on skin temperature and stops when the heat-balance residual is below 0.01 W/m2
# (solve_twl.R, TOL_CONVERGENCE), so the TWL it returns can sit about that far from the exact root, and a monotonicity
# check must not demand better (preflight F23). 0.05 W/m2 is five times the tolerance. It is a guard, not a measured
# need: a scan of 206,640 adjacent dew-point pairs (30-46 C, 0.3-3 m/s, steps of 0.01-0.5 C) found no rise above 1e-6.
SOLVER_SLACK_W_M2 = 0.05

# Miller and Bates (2007) Table 2 is a climatic-chamber study: 0.12 clo, sea-level pressure, MRT equal to the dry bulb.
CHAMBER_CLOTHING_CLO = 0.12
CHAMBER_PRESSURE_KPA = 101.3
CHAMBER_PRESSURE_HPA = 1013.0

# A hot, moderately humid, calm reference case for the single-factor tests.
BASE_INPUTS: dict[str, float] = {"t_c": 38.0, "td_c": 20.0, "wind_body_ms": 1.0, "pressure_kpa": 101.3, "mrt_c": 38.0}


# Brake and Bates (2002) Table 1 (p. 181), as transcribed in the reference's own regression test
# (tests/testthat/test-twl-table1.R at the pinned commit; not checked by us against the paper). The Miller and Bates
# chamber sessions all land on the fully wet skin branch of the evaporation model, so these rows are what exercises the
# partial-dripping branch (zone B) and the sweat-rate limit. Condition sets:
#   set -> (MRT minus dry bulb in C, wind in m/s, pressure in kPa, clothing in clo, vapor permeability)
TABLE1_SETS: dict[int, tuple[float, float, float, float, float]] = {
    1: (2.0, 0.2, 101.0, 0.45, 0.45),
    2: (0.0, 0.5, 115.0, 0.69, 0.40),
    3: (3.0, 1.5, 80.0, 0.35, 0.45),
}
#   (set, dry bulb in C) -> {wet bulb in C: published TWL in W/m2}
TABLE1: dict[tuple[int, int], dict[int, int]] = {
    (1, 34): {24: 175, 26: 157, 28: 136, 30: 114},
    (1, 36): {24: 170, 26: 151, 28: 131, 30: 109},
    (1, 38): {24: 164, 26: 145, 28: 125, 30: 103},
    (1, 40): {24: 158, 26: 140, 28: 120},
    (1, 42): {24: 152, 26: 134, 28: 114},
    (2, 34): {24: 181, 26: 161, 28: 140, 30: 118},
    (2, 36): {24: 176, 26: 156, 28: 136, 30: 113},
    (2, 38): {24: 171, 26: 152, 28: 131, 30: 109},
    (2, 40): {24: 166, 26: 147, 28: 126, 30: 104},
    (2, 42): {24: 161, 26: 142, 28: 122},
    (3, 34): {24: 288, 26: 260, 28: 229, 30: 193, 32: 154},
    (3, 36): {24: 282, 26: 254, 28: 222, 30: 187, 32: 148},
    (3, 38): {24: 276, 26: 248, 28: 216, 30: 181, 32: 141},
    (3, 40): {24: 270, 26: 242, 28: 210, 30: 174, 32: 135},
    (3, 42): {24: 264, 26: 235, 28: 203, 30: 167, 32: 128},
}
# The reference allows 5 W/m2, and 14 W/m2 for four extreme low-humidity rows of set 3 (dry bulb 38 or more with a wet
# bulb of 24, and dry bulb 42 with a wet bulb of 26) where the Wyndham curve fits are at the edge of their range.
TABLE1_TOLERANCE_W_M2 = 5.0
TABLE1_EDGE_TOLERANCE_W_M2 = 14.0
TABLE1_EDGE_ROWS = {(3, 38, 24), (3, 40, 24), (3, 42, 24), (3, 42, 26)}


def _rows() -> list[dict[str, Any]]:
    loaded: dict[str, Any] = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = loaded["rows"]
    return rows


def _twl(inputs: dict[str, float], params: TwlParams | None = None) -> float:
    """``twl_w_m2`` from a dict of the five inputs, so a test can vary one of them by name."""
    return twl_w_m2(
        t_c=inputs["t_c"],
        td_c=inputs["td_c"],
        wind_body_ms=inputs["wind_body_ms"],
        pressure_kpa=inputs["pressure_kpa"],
        mrt_c=inputs["mrt_c"],
        params=TwlParams() if params is None else params,
    )


def _chamber_twl(row: dict[str, Any]) -> float:
    """TWL of one Table 2 session: wet bulb to vapor pressure (WMO psychrometer) to dew point, then the solver."""
    t = float(row["t_c"])
    e_kpa = vapor_pressure_kpa_from_wet_bulb(t, float(row["twb_c"]), CHAMBER_PRESSURE_HPA)
    td = float(dewpoint_c_from_vapor_pressure(e_kpa))
    return twl_w_m2(
        t_c=t,
        td_c=td,
        wind_body_ms=float(row["wind_ms"]),
        pressure_kpa=CHAMBER_PRESSURE_KPA,
        mrt_c=t,
        params=TwlParams(clothing_clo=CHAMBER_CLOTHING_CLO),
    )


def _table1_twl(*, db: float, wb: float, mrt: float, wind: float, pressure_kpa: float, clo: float, icl: float) -> float:
    """TWL for a Table 1 row, deriving the vapor pressure as the reference's test does.

    The wet bulb is an aspirated psychrometer reading: ``pa = es(wb) - 6.6e-4 * P * (db - wb)`` with ``P`` in kPa,
    then the dew point from ``pa`` (the reference's helper functions ``pa_from_wb`` and ``dp_from_pa``).
    """
    pa = max(0.0, float(saturation_vapor_pressure_kpa(wb)) - 6.6e-4 * pressure_kpa * (db - wb))
    return twl_w_m2(
        t_c=db,
        td_c=float(dewpoint_c_from_vapor_pressure(pa)),
        wind_body_ms=wind,
        pressure_kpa=pressure_kpa,
        mrt_c=mrt,
        params=TwlParams(clothing_clo=clo, vapor_permeability=icl),
    )


def _residual_table(computed: list[float], column: str) -> str:
    """One line per session: computed TWL, the reference column and the difference (computed minus reference)."""
    lines = [f"session  twl_w_m2  {column:>18}  residual"]
    for row, twl in zip(_rows(), computed, strict=True):
        reference = float(row[column])
        lines.append(f"{row['session']:>7}  {twl:8.2f}  {reference:18.1f}  {twl - reference:+8.2f}")
    return "\n".join(lines)


def test_fixture_has_the_eleven_sessions() -> None:
    rows = _rows()
    assert [row["session"] for row in rows] == list(range(1, 12))
    assert all({"t_c", "twb_c", "wind_ms", "published_twl", "scratch_port_w_m2"} <= row.keys() for row in rows)


def test_matches_miller_bates_within_8(request: pytest.FixtureRequest) -> None:
    # ADR 0006: the reference port's measured maximum deviation from the published values is 6.5-7.0 W/m2.
    computed = [_chamber_twl(row) for row in _rows()]
    table = _residual_table(computed, "published_twl")
    # Where the table can be read: in the assertion message when this fails, in the junit report as a user property
    # (`--junit-xml`), and, for this published column, in the measured-bias table of the twl.py module docstring.
    # (`pytest -rP` shows captured output of passing tests, which this test does not produce.)
    request.node.user_properties.append(("twl_residuals_vs_published", table))
    deviations = [abs(twl - float(row["published_twl"])) for twl, row in zip(computed, _rows(), strict=True)]
    # `all(d <= 8.0)`, not `max(deviations) <= 8.0`: max() skips a NaN that is not first; a NaN comparison is False.
    assert all(d <= 8.0 for d in deviations), f"largest |computed - published| is {max(deviations):.2f} W/m2\n{table}"


def test_matches_brake_bates_table1_as_transcribed_in_the_reference(request: pytest.FixtureRequest) -> None:
    lines = ["set  db  wb  published     twl  residual  tolerance"]
    failures: list[str] = []
    for (set_id, db), by_wet_bulb in TABLE1.items():
        mrt_offset, wind, pressure_kpa, clo, icl = TABLE1_SETS[set_id]
        for wb, published in by_wet_bulb.items():
            twl = _table1_twl(
                db=float(db),
                wb=float(wb),
                mrt=db + mrt_offset,
                wind=wind,
                pressure_kpa=pressure_kpa,
                clo=clo,
                icl=icl,
            )
            edge = (set_id, db, wb) in TABLE1_EDGE_ROWS
            tolerance = TABLE1_EDGE_TOLERANCE_W_M2 if edge else TABLE1_TOLERANCE_W_M2
            lines.append(
                f"{set_id:>3}  {db:>2}  {wb:>2}  {published:>9}  {twl:6.1f}  {twl - published:+8.2f}  {tolerance:>9}"
            )
            if not abs(twl - published) <= tolerance:  # `not <=`, not `>`: a NaN residual must fail, not pass
                failures.append(f"set {set_id} db {db} wb {wb}: {twl:.1f} vs {published}")
    table = "\n".join(lines)
    request.node.user_properties.append(("twl_residuals_vs_brake_bates_table1", table))
    assert not failures, f"{failures}\n{table}"
    assert len(lines) - 1 == 62  # 18 rows in set 1, 19 in set 2, 25 in set 3: none dropped from the table above


def test_matches_the_brake_bates_worked_example_as_transcribed_in_the_reference() -> None:
    # Reference test: DB 40, WB 30, MRT 40, 0.2 m/s, 100 kPa, 0.35 clo, permeability 0.45 gives 110 W/m2 (5 W/m2);
    # after refrigeration, DB 31.4, WB 28.0, MRT 31.4 gives a rounded 158 W/m2 (8 W/m2).
    kwargs = {"wind": 0.2, "pressure_kpa": 100.0, "clo": 0.35, "icl": 0.45}
    before = _table1_twl(db=40.0, wb=30.0, mrt=40.0, **kwargs)
    after = _table1_twl(db=31.4, wb=28.0, mrt=31.4, **kwargs)
    assert abs(before - 110.0) <= 5.0, before
    assert abs(after - 158.0) <= 8.0, after


def test_agrees_with_independent_port(request: pytest.FixtureRequest) -> None:
    # `scratch_port_w_m2` is an unarchived scratch port run on 2026-11-11 (preflight F27); see the fixture provenance.
    computed = [_chamber_twl(row) for row in _rows()]
    table = _residual_table(computed, "scratch_port_w_m2")
    request.node.user_properties.append(("twl_residuals_vs_scratch_port", table))
    for twl, row in zip(computed, _rows(), strict=True):
        assert abs(twl - float(row["scratch_port_w_m2"])) <= 1.0, f"session {row['session']}\n{table}"


def test_bias_direction_is_documented() -> None:
    # The port reads above the published values (mean about +6 W/m2, safety-relevant: a higher TWL is less protective).
    # A change of sign or size means the port changed; update ADR 0006 before touching this test.
    bias = [_chamber_twl(row) - float(row["published_twl"]) for row in _rows()]
    mean_bias = sum(bias) / len(bias)
    assert 3.0 <= mean_bias <= 8.0, f"mean(twl - published) = {mean_bias:+.2f} W/m2"


@st.composite
def _humidity_pairs(draw: st.DrawFn) -> tuple[float, float, float, float]:
    """A hot day (30-46 C), a wind, and two dew points with ``low < high <= t - 2``."""
    t = draw(st.floats(30.0, 46.0))
    wind = draw(st.floats(0.3, 3.0))
    first = draw(st.floats(-5.0, t - 2.0))
    second = draw(st.floats(-5.0, t - 2.0))
    td_low, td_high = sorted((first, second))
    assume(td_low < td_high)
    return t, wind, td_low, td_high


@settings(max_examples=300, deadline=None, database=None, derandomize=True)
@given(case=_humidity_pairs())
def test_more_humid_means_lower_twl(case: tuple[float, float, float, float]) -> None:
    t, wind, td_low, td_high = case

    def twl(td: float) -> float:
        return twl_w_m2(t_c=t, td_c=td, wind_body_ms=wind, pressure_kpa=101.3, mrt_c=t)

    # The solver's stopping tolerance makes the two results uncertain by SOLVER_SLACK_W_M2 (see its comment).
    assert twl(td_high) <= twl(td_low) + SOLVER_SLACK_W_M2


def test_clamped_to_floor_and_ceiling() -> None:
    hot_humid = twl_w_m2(t_c=50.0, td_c=35.0, wind_body_ms=0.2, pressure_kpa=101.3, mrt_c=50.0)
    cool_windy = twl_w_m2(t_c=20.0, td_c=5.0, wind_body_ms=4.0, pressure_kpa=101.3, mrt_c=20.0)
    assert hot_humid >= 60.0
    assert cool_windy <= 380.0
    # Both ends of the range are reached exactly: the clamp is what holds these two cases at the limits.
    assert hot_humid == TWL_FLOOR_W_M2 == 60.0
    assert cool_windy == TWL_CEILING_W_M2 == 380.0


def test_dew_point_above_the_skin_bracket_returns_the_floor() -> None:
    # The reference returns the floor when dew point + 1 reaches the core limit - 0.5 (here 38.2 - 0.5 = 37.7).
    assert twl_w_m2(t_c=40.0, td_c=36.8, wind_body_ms=1.0, pressure_kpa=101.3, mrt_c=40.0) == TWL_FLOOR_W_M2
    assert twl_w_m2(t_c=42.0, td_c=40.0, wind_body_ms=1.0, pressure_kpa=101.3, mrt_c=42.0) == TWL_FLOOR_W_M2


def test_result_always_lies_in_the_published_range() -> None:
    for t, td, wind, mrt in [(25.0, 5.0, 2.0, 25.0), (45.0, 10.0, 0.5, 60.0), (35.0, 30.0, 1.0, 35.0)]:
        twl = twl_w_m2(t_c=t, td_c=td, wind_body_ms=wind, pressure_kpa=101.3, mrt_c=mrt)
        assert TWL_FLOOR_W_M2 <= twl <= TWL_CEILING_W_M2


def test_more_radiant_heat_means_lower_twl() -> None:
    cool = twl_w_m2(t_c=40.0, td_c=15.0, wind_body_ms=1.0, pressure_kpa=101.3, mrt_c=40.0)
    sunlit = twl_w_m2(t_c=40.0, td_c=15.0, wind_body_ms=1.0, pressure_kpa=101.3, mrt_c=60.0)
    assert sunlit < cool


def test_lighter_clothing_means_higher_twl() -> None:
    assert _twl(BASE_INPUTS, TwlParams(clothing_clo=0.12)) > _twl(BASE_INPUTS, TwlParams())


def test_default_parameters_are_the_reference_defaults() -> None:
    # meteoHazard at 5633d57 (generate_twl defaults, TWL_CONSTANTS, LR in generate_twl).
    params = TwlParams()
    assert params.clothing_clo == 0.6
    assert params.vapor_permeability == 0.45
    assert params.max_core_temp_c == 38.2
    assert params.max_sweat_rate_kg_m2_h == 0.67
    assert params.lewis_relation_k_per_kpa == 16.5
    assert params.latent_heat_kj_kg == 2430.0
    assert (TWL_FLOOR_W_M2, TWL_CEILING_W_M2) == (60.0, 380.0)


@pytest.mark.parametrize("field", ["t_c", "td_c", "wind_body_ms", "pressure_kpa", "mrt_c"])
@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_non_finite_input_gives_nan(field: str, bad: float) -> None:
    assert math.isnan(_twl({**BASE_INPUTS, field: bad}))


@pytest.mark.parametrize(("field", "bad"), [("wind_body_ms", -0.1), ("pressure_kpa", 0.0), ("pressure_kpa", -101.3)])
def test_impossible_wind_or_pressure_is_rejected(field: str, bad: float) -> None:
    with pytest.raises(ValueError, match=field):
        _twl({**BASE_INPUTS, field: bad})


def test_vapor_pressure_above_air_pressure_is_rejected() -> None:
    # A dew point of 36 C is 5.9 kPa of vapor; at 5 kPa of air pressure that is impossible.
    with pytest.raises(ValueError, match="vapor pressure"):
        twl_w_m2(t_c=40.0, td_c=36.0, wind_body_ms=1.0, pressure_kpa=5.0, mrt_c=40.0)


@pytest.mark.parametrize(
    ("field", "bad"),
    [
        ("clothing_clo", -0.1),
        ("vapor_permeability", 0.0),
        ("vapor_permeability", 1.5),
        ("max_core_temp_c", math.nan),
        ("max_sweat_rate_kg_m2_h", 0.0),
        ("lewis_relation_k_per_kpa", 0.0),
        ("latent_heat_kj_kg", -1.0),
    ],
)
def test_unusable_parameters_are_rejected(field: str, bad: float) -> None:
    with pytest.raises(ValueError, match=field):
        TwlParams(**{field: bad})


def test_parameters_are_frozen() -> None:
    params = TwlParams()
    with pytest.raises(AttributeError):
        params.clothing_clo = 0.1  # type: ignore[misc]


def test_array_version_matches_the_scalar_and_broadcasts() -> None:
    t = np.array([[36.0], [40.0]])
    td = np.array([10.0, 20.0, 25.0])
    out = twl_w_m2_array(t_c=t, td_c=td, wind_body_ms=1.0, pressure_kpa=101.3, mrt_c=t)
    assert out.shape == (2, 3)
    assert out.dtype == np.float64
    for i, t_i in enumerate((36.0, 40.0)):
        for j, td_j in enumerate((10.0, 20.0, 25.0)):
            expected = twl_w_m2(t_c=t_i, td_c=td_j, wind_body_ms=1.0, pressure_kpa=101.3, mrt_c=t_i)
            assert out[i, j] == expected


def test_array_version_keeps_nan_per_element_and_gives_a_zero_dimensional_array_for_scalars() -> None:
    out = twl_w_m2_array(
        t_c=[38.0, math.nan, 38.0],
        td_c=20.0,
        wind_body_ms=1.0,
        pressure_kpa=101.3,
        mrt_c=38.0,
    )
    assert math.isnan(out[1])
    assert not math.isnan(out[0])
    assert out[0] == out[2]
    scalar = twl_w_m2_array(t_c=38.0, td_c=20.0, wind_body_ms=1.0, pressure_kpa=101.3, mrt_c=38.0)
    assert scalar.ndim == 0
    assert scalar.dtype == np.float64
    assert twl_w_m2_array(t_c=[], td_c=[], wind_body_ms=[], pressure_kpa=101.3, mrt_c=[]).shape == (0,)


def test_body_level_wind_factor() -> None:
    # Log profile with roughness 0.01 m: v * ln(1 / z0) / ln(z / z0), about 0.667 for a 10 m wind.
    assert body_level_wind_ms(3.0) == pytest.approx(3.0 * math.log(100) / math.log(1000), rel=1e-12)
    assert body_level_wind_ms(3.0) == pytest.approx(2.0, abs=1e-3)
    assert body_level_wind_ms(0.1) == 0.2


def test_body_level_wind_other_heights_and_clipping() -> None:
    # The reference documents a factor of about 0.869 for a 2 m mast.
    assert body_level_wind_ms(1.0, height_m=2.0) == pytest.approx(math.log(100) / math.log(200), rel=1e-12)
    assert body_level_wind_ms(1.0, height_m=2.0) == pytest.approx(0.869, abs=1e-3)
    assert body_level_wind_ms(30.0) == 4.0
    assert body_level_wind_ms(0.0) == 0.2
    assert body_level_wind_ms(3.0, height_m=1.0) == 3.0  # already at body height: the factor is exactly 1


def test_body_level_wind_vectorized_float64_and_nan_in_nan_out() -> None:
    out = body_level_wind_ms([0.1, 3.0, math.nan, 30.0])
    assert out.dtype == np.float64
    assert out[0] == 0.2
    assert out[1] == pytest.approx(2.0, abs=1e-3)
    assert math.isnan(out[2])
    assert out[3] == 4.0
    assert body_level_wind_ms(3.0).ndim == 0


def test_body_level_wind_rejects_impossible_arguments() -> None:
    with pytest.raises(ValueError, match="wind_ms"):
        body_level_wind_ms(-1.0)
    with pytest.raises(ValueError, match="height_m"):
        body_level_wind_ms(3.0, height_m=0.01)
    with pytest.raises(ValueError, match="z0_m"):
        body_level_wind_ms(3.0, z0_m=0.0)


def test_withdrawal_limits_cap_at_115() -> None:
    capped = apply_withdrawal_limits([200, 200, 200], t_c=[45, 40, 40], natural_wet_bulb_c=[25, 33, 25])
    assert capped.tolist() == [115.0, 115.0, 200.0]
    relaxed = apply_withdrawal_limits(
        [200, 200, 200],
        t_c=[45, 40, 40],
        natural_wet_bulb_c=[25, 33, 25],
        limits=WithdrawalLimits(dry_bulb_c=46.0),
    )
    assert relaxed.tolist() == [200.0, 115.0, 200.0]


def test_withdrawal_limits_are_the_reference_values() -> None:
    assert WithdrawalLimits() == WithdrawalLimits(dry_bulb_c=44.0, natural_wet_bulb_c=32.0, cap_w_m2=115.0)


def test_withdrawal_limits_are_strict_inequalities() -> None:
    # solve_twl / generate_twl.R: `temp > 44` and `wet_bulb > 32`; exactly at the limit nothing is capped.
    out = apply_withdrawal_limits([200, 200], t_c=[44.0, 30.0], natural_wet_bulb_c=[20.0, 32.0])
    assert out.tolist() == [200.0, 200.0]


def test_withdrawal_limits_cap_only_downward() -> None:
    out = apply_withdrawal_limits([90.0, 130.0], t_c=[47.0, 47.0], natural_wet_bulb_c=None)
    assert out.tolist() == [90.0, 115.0]


def test_withdrawal_limits_without_wet_bulb_use_dry_bulb_only() -> None:
    out = apply_withdrawal_limits([200, 200], t_c=[45, 30], natural_wet_bulb_c=None)
    assert out.tolist() == [115.0, 200.0]


def test_withdrawal_limits_missing_wet_bulb_does_not_cap_and_nan_twl_stays_nan() -> None:
    # generate_twl.R: `!is.na(wet_bulb) && wet_bulb > 32`, so a missing wet bulb applies no wet-bulb cap.
    out = apply_withdrawal_limits([200.0, math.nan], t_c=[30.0, 47.0], natural_wet_bulb_c=[math.nan, 20.0])
    assert out[0] == 200.0
    assert math.isnan(out[1])


def test_withdrawal_limits_return_float64_and_zero_dimensional_for_scalars() -> None:
    out = apply_withdrawal_limits(200.0, t_c=45.0, natural_wet_bulb_c=None)
    assert out.dtype == np.float64
    assert out.ndim == 0
    assert out == 115.0
