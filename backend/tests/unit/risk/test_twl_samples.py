import math
from typing import TypedDict

import numpy as np
import pytest
from numpy.typing import NDArray

from stellar_blaze.domain.physics.twl import WithdrawalLimits, body_level_wind_ms, twl_w_m2_array
from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.physics.wbgt import globe_temperature_c, mrt_from_globe_c
from stellar_blaze.domain.risk.twl_samples import effective_twl, twl_sample_matrix, withdrawal_limits
from tests.unit.risk.support import released_ruleset

pytestmark = pytest.mark.unit

OMAA_LAT, OMAA_LON = 24.4330, 54.6511
NAN = float("nan")
LIMITS = WithdrawalLimits(dry_bulb_c=44.0, natural_wet_bulb_c=32.0, cap_w_m2=115.0)


def _arr(*values: float) -> F64:
    return np.array(values, dtype=np.float64)


def _labels(*stamps: str) -> NDArray[np.datetime64]:
    return np.array(stamps, dtype="datetime64[us]")


class _Frame(TypedDict):
    sw_wm2: F64
    direct_wm2: F64
    pressure_hpa: F64
    valid_time_utc: NDArray[np.datetime64]


def _frame(samples: F64) -> _Frame:
    """Per-row radiation, pressure and labels for ``samples`` of shape (rows, n, 3): noon at OMAA on 2026-07-01."""
    rows = samples.shape[0]
    return _Frame(
        sw_wm2=np.full(rows, 900.0),
        direct_wm2=np.full(rows, 700.0),
        pressure_hpa=np.full(rows, 1000.0),
        valid_time_utc=np.array(["2026-07-01T08:00"] * rows, dtype="datetime64[us]"),
    )


def _samples(*triples: tuple[float, float, float]) -> F64:
    return np.array([triples], dtype=np.float64)  # (1, n, 3)


def test_effective_twl_cap_then_margin() -> None:
    # Cap first (115 because T 45 C is above 44 C), then the margin: 115 - 7 = 108, a High-zone value. Margin first
    # would give min(150 - 7, 115) = 115, which the boundary convention reads as Medium.
    out = effective_twl(_arr(150.0), margin_w_m2=7.0, withdrawal=LIMITS, t_c=_arr(45.0), tnwb_c=None)
    assert out.tolist() == [108.0]


def test_effective_twl_without_withdrawal_only_subtracts_the_margin() -> None:
    out = effective_twl(_arr(150.0, NAN), margin_w_m2=7.0, withdrawal=None, t_c=_arr(45.0, 45.0), tnwb_c=None)
    assert out[0] == 143.0
    assert math.isnan(out[1])


def test_effective_twl_does_not_cap_below_the_dry_bulb_limit_and_uses_the_wet_bulb() -> None:
    cool = effective_twl(_arr(150.0), margin_w_m2=7.0, withdrawal=LIMITS, t_c=_arr(43.0), tnwb_c=_arr(31.0))
    assert cool.tolist() == [143.0]
    humid = effective_twl(_arr(150.0), margin_w_m2=7.0, withdrawal=LIMITS, t_c=_arr(40.0), tnwb_c=_arr(33.0))
    assert humid.tolist() == [108.0]


def test_withdrawal_limits_from_the_ruleset_are_none_while_the_switch_is_off() -> None:
    ruleset = released_ruleset()
    assert not ruleset.twl_withdrawal.enabled
    assert withdrawal_limits(ruleset) is None
    enabled = ruleset.model_copy(update={"twl_withdrawal": ruleset.twl_withdrawal.model_copy(update={"enabled": True})})
    assert withdrawal_limits(enabled) == LIMITS


def test_twl_sample_matrix_matches_the_manual_composition() -> None:
    samples = _samples((40.0, 20.0, 2.0), (38.0, 22.0, 3.0), (42.0, 15.0, 1.0))
    frame = _frame(samples)
    got = twl_sample_matrix(samples, lat=OMAA_LAT, lon=OMAA_LON, **frame)
    assert got.shape == (1, 3)

    t, td, wind = (samples[0, :, k] for k in range(3))
    globe = globe_temperature_c(
        t_c=t,
        td_c=td,
        wind10m_ms=wind,
        pressure_hpa=np.full(3, 1000.0),
        sw_wm2=np.full(3, 900.0),
        direct_wm2=np.full(3, 700.0),
        lat=OMAA_LAT,
        lon=OMAA_LON,
        valid_time_utc=np.full(3, np.datetime64("2026-07-01T08:00", "us")),
    )
    mrt = mrt_from_globe_c(t_c=t, globe_c=globe, wind10m_ms=wind)
    expected = twl_w_m2_array(
        t_c=t, td_c=td, wind_body_ms=body_level_wind_ms(wind), pressure_kpa=np.full(3, 100.0), mrt_c=mrt
    )
    assert np.allclose(got[0], expected, atol=1e-9)
    assert np.isfinite(got).all()
    assert ((got >= 60.0) & (got <= 380.0)).all()


def test_twl_sample_matrix_shape_and_nan() -> None:
    samples = _samples((40.0, 20.0, 2.0), (NAN, 20.0, 2.0), (40.0, 20.0, 2.0), (40.0, NAN, 2.0), (40.0, 20.0, NAN))
    got = twl_sample_matrix(samples, lat=OMAA_LAT, lon=OMAA_LON, **_frame(samples))
    assert got.shape == (1, 5)
    assert np.isnan(got[0]).tolist() == [False, True, False, True, True]
    assert got[0, 0] == got[0, 2]


def test_twl_sample_matrix_zero_spread_gives_identical_columns() -> None:
    samples = np.broadcast_to(np.array([41.0, 21.0, 2.5]), (3, 6, 3)).copy()
    got = twl_sample_matrix(samples, lat=OMAA_LAT, lon=OMAA_LON, **_frame(samples))
    assert got.shape == (3, 6)
    assert (got == got[:, :1]).all()
    assert (got == got[0, 0]).all()  # the rows share the same inputs too


def test_twl_sample_matrix_truth_is_one_column() -> None:
    truth = _samples((40.0, 20.0, 2.0))
    got = twl_sample_matrix(truth, lat=OMAA_LAT, lon=OMAA_LON, **_frame(truth))
    assert got.shape == (1, 1)
    assert np.isfinite(got).all()


def test_twl_sample_matrix_rows_use_their_own_radiation() -> None:
    samples = np.broadcast_to(np.array([40.0, 20.0, 2.0]), (2, 1, 3)).copy()
    frame = _frame(samples)
    frame["sw_wm2"] = _arr(900.0, 0.0)
    frame["direct_wm2"] = _arr(700.0, 0.0)
    frame["valid_time_utc"] = _labels("2026-07-01T08:00", "2026-07-01T20:00")
    got = twl_sample_matrix(samples, lat=OMAA_LAT, lon=OMAA_LON, **frame)
    assert got[0, 0] < got[1, 0]  # sun on: less sustainable work than at night


def test_twl_sample_matrix_missing_radiation_makes_the_row_nan() -> None:
    samples = np.broadcast_to(np.array([40.0, 20.0, 2.0]), (2, 2, 3)).copy()
    frame = _frame(samples)
    frame["sw_wm2"] = _arr(900.0, NAN)
    got = twl_sample_matrix(samples, lat=OMAA_LAT, lon=OMAA_LON, **frame)
    assert np.isfinite(got[0]).all()
    assert np.isnan(got[1]).all()


def test_twl_sample_matrix_survives_samples_the_fake_corrector_can_emit() -> None:
    # FakeCorrector does not screen its samples: wind can be negative and td can exceed t. A speed is not negative and
    # the air cannot hold more than saturation, so the matrix clips them (wind to 0, td to t) instead of raising.
    samples = _samples((40.0, 45.0, -1.0), (40.0, 40.0, 0.0), (40.0, 20.0, 2.0))
    got = twl_sample_matrix(samples, lat=OMAA_LAT, lon=OMAA_LON, **_frame(samples))
    assert np.isfinite(got).all()
    assert got[0, 0] == got[0, 1]  # both read as td = t and wind = 0


def test_twl_sample_matrix_impossible_pressure_is_nan_not_an_exception() -> None:
    samples = _samples((40.0, 20.0, 2.0))
    frame = _frame(samples)
    frame["pressure_hpa"] = _arr(0.0)
    got = twl_sample_matrix(samples, lat=OMAA_LAT, lon=OMAA_LON, **frame)
    assert np.isnan(got).all()


def test_twl_sample_matrix_does_not_mutate_its_input() -> None:
    samples = _samples((40.0, 45.0, -1.0), (40.0, 20.0, 2.0))
    before = samples.copy()
    twl_sample_matrix(samples, lat=OMAA_LAT, lon=OMAA_LON, **_frame(samples))
    assert np.array_equal(before, samples, equal_nan=True)


def test_twl_sample_matrix_checks_shapes() -> None:
    samples = _samples((40.0, 20.0, 2.0))
    frame = _frame(samples)
    with pytest.raises(ValueError, match="shape"):
        twl_sample_matrix(samples[0], lat=OMAA_LAT, lon=OMAA_LON, **frame)
    frame["sw_wm2"] = _arr(1.0, 2.0)
    with pytest.raises(ValueError, match="shape"):
        twl_sample_matrix(samples, lat=OMAA_LAT, lon=OMAA_LON, **frame)


def test_a_hotter_sample_is_never_more_sustainable() -> None:
    samples = np.array([[[t, 20.0, 2.0] for t in (34.0, 38.0, 42.0, 46.0)]], dtype=np.float64)
    got = twl_sample_matrix(samples, lat=OMAA_LAT, lon=OMAA_LON, **_frame(samples))
    assert (np.diff(got[0]) <= 0.0).all()


@pytest.mark.parametrize(
    ("t", "td", "sw", "direct"),
    [(36.0, 12.0, 500.0, 350.0), (40.0, 20.0, 800.0, 600.0), (44.0, 18.0, 900.0, 700.0), (33.0, 25.0, 300.0, 120.0)],
)
def test_twl_never_rises_as_the_wind_falls(t: float, td: float, sw: float, direct: float) -> None:
    """Calm air is never milder than a light breeze (review C1): the MRT wind is floored like the globe wind.

    Before the floor was shared, TWL at 10 m wind 0.0 / 0.1 / 0.3 / 0.5 / 0.62 / 1.0 m/s read 139 / 119 / 101 / 122 /
    129 / 158 W/m2 for T 36, Td 12, sw 500: non-monotone, with calm air milder than breezy air.
    """
    winds = np.round(np.arange(0.0, 3.0001, 0.05), 2)
    samples = np.array([[[t, td, w] for w in winds]], dtype=np.float64)
    frame = _Frame(
        sw_wm2=np.array([sw]),
        direct_wm2=np.array([direct]),
        pressure_hpa=np.array([1000.0]),
        valid_time_utc=np.array(["2026-07-01T05:00"], dtype="datetime64[us]"),
    )
    got = twl_sample_matrix(samples, lat=OMAA_LAT, lon=OMAA_LON, **frame)[0]
    assert np.isfinite(got).all()
    steps = np.diff(got)  # winds ascend: a negative step is TWL rising as the wind falls
    calm = winds[1:] <= 1.95
    assert (steps[calm] >= 0.0).all(), "TWL rose as the wind fell below 2 m/s"
    # thermofeel's Liljegren solve switches stability class at 2.0 m/s: a known upstream step of the globe (about 0.3 C,
    # 1 to 2 W/m2 of TWL, inside the 7 W/m2 margin). It is the only allowed exception across the whole 0-3 m/s sweep.
    assert (steps >= -2.0).all(), "TWL rose by more than the 2.0 m/s class step as the wind fell"


def test_calm_air_twl_is_at_most_the_floor_wind_twl_with_the_sun_up() -> None:
    samples = np.array([[[36.0, 12.0, 0.0], [36.0, 12.0, 0.62]]], dtype=np.float64)
    frame = _Frame(
        sw_wm2=np.array([500.0]),
        direct_wm2=np.array([350.0]),
        pressure_hpa=np.array([1000.0]),
        valid_time_utc=np.array(["2026-07-01T05:00"], dtype="datetime64[us]"),
    )
    got = twl_sample_matrix(samples, lat=OMAA_LAT, lon=OMAA_LON, **frame)[0]
    assert got[0] <= got[1]
