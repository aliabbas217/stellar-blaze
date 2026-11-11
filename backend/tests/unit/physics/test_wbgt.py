import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from numpy.typing import ArrayLike, NDArray

from stellar_blaze.domain.physics import wbgt as wbgt_module
from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.physics.wbgt import CosZenithMode, WbgtReject, WbgtResult, wbgt_liljegren

pytestmark = pytest.mark.unit

GOLDEN_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "wbgt" / "golden_omaa_2025-07-15.json"
OMAA_LAT, OMAA_LON = 24.4330, 54.6511

# thermofeel's Liljegren solver stops iterating at 0.02 K (thermofeel/liljegren.py CONVERGENCE, preflight F23), so a
# monotonicity check cannot demand better than that.
SOLVER_SLACK_C = 0.05

NIGHT = np.datetime64("2025-07-15T20:00", "m")  # 00:00 in Abu Dhabi; the sun is down for the whole preceding hour
LATE_NIGHT = np.datetime64("2025-07-15T22:00", "m")
MIDDAY = np.datetime64("2025-07-15T08:00", "m")  # 12:00 in Abu Dhabi; mean cos zenith about 0.95


@pytest.fixture(scope="module")
def golden() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    return loaded


def _arr(*values: float) -> F64:
    return np.array(values, dtype=np.float64)


def _times(*stamps: np.datetime64) -> NDArray[np.datetime64]:
    return np.array(stamps, dtype="datetime64[m]")


def _golden_inputs(golden: dict[str, Any]) -> dict[str, Any]:
    return {
        "t_c": np.array(golden["t_c"], dtype=np.float64),
        "td_c": np.array(golden["td_c"], dtype=np.float64),
        "wind10m_ms": np.array(golden["wind10m_ms"], dtype=np.float64),
        "pressure_hpa": np.array(golden["pressure_hpa"], dtype=np.float64),
        "sw_wm2": np.array(golden["sw_wm2"], dtype=np.float64),
        "direct_wm2": np.array(golden["direct_wm2"], dtype=np.float64),
        "lat": golden["lat"],
        "lon": golden["lon"],
        "valid_time_utc": np.array(golden["valid_time_utc"], dtype="datetime64[m]"),
    }


def _single(
    *,
    t_c: float,
    td_c: float,
    wind: float,
    pressure: float,
    sw: float,
    direct: float,
    at: np.datetime64,
) -> WbgtResult:
    return wbgt_liljegren(
        t_c=_arr(t_c),
        td_c=_arr(td_c),
        wind10m_ms=_arr(wind),
        pressure_hpa=_arr(pressure),
        sw_wm2=_arr(sw),
        direct_wm2=_arr(direct),
        lat=OMAA_LAT,
        lon=OMAA_LON,
        valid_time_utc=_times(at),
    )


def _fake_thermofeel_returning(offset_k: float | None, calls: list[int] | None = None) -> Any:
    """A stand-in for thermofeel's call that returns ``t2_k + offset_k`` (or NaN when ``offset_k`` is None)."""

    def fake(
        t2_k: ArrayLike,
        rh: ArrayLike,
        pressure: ArrayLike,
        va: ArrayLike,
        ssrd: ArrayLike,
        fdir: ArrayLike,
        cossza: ArrayLike,
    ) -> F64:
        del rh, pressure, va, ssrd, fdir, cossza
        t = np.asarray(t2_k, dtype=np.float64)
        if calls is not None:
            calls.append(t.size)
        return np.full(t.shape, np.nan) if offset_k is None else t + offset_k

    return fake


def test_reject_codes_are_pinned() -> None:
    # The codes are persisted in the gold tables as Int8, so the values are part of the contract.
    assert {r.name: int(r) for r in WbgtReject} == {
        "OK": 0,
        "NONFINITE_INPUT": 1,
        "INCOHERENT_RADIATION": 2,
        "NO_CONVERGENCE": 3,
        "OUT_OF_BOUNDS": 4,
    }
    assert CosZenithMode("midpoint") is CosZenithMode.MIDPOINT
    assert CosZenithMode("mean") is CosZenithMode.MEAN


def test_wbgt_matches_fhc_golden(golden: dict[str, Any]) -> None:
    result = wbgt_liljegren(**_golden_inputs(golden))
    assert result.wbgt_c.dtype == np.float64
    assert result.reject.dtype == np.int8
    assert np.all(result.reject == WbgtReject.OK)
    np.testing.assert_allclose(result.wbgt_c, np.array(golden["wbgt_c_midpoint"]), rtol=0.0, atol=1e-9)


def test_wbgt_mean_mode_matches_fhc_variant_b_golden(golden: dict[str, Any]) -> None:
    result = wbgt_liljegren(**_golden_inputs(golden), mode=CosZenithMode.MEAN)
    assert np.all(result.reject == WbgtReject.OK)
    np.testing.assert_allclose(result.wbgt_c, np.array(golden["wbgt_c_mean"]), rtol=0.0, atol=1e-9)


def test_midpoint_is_the_default_and_differs_from_mean(golden: dict[str, Any]) -> None:
    inputs = _golden_inputs(golden)
    default = wbgt_liljegren(**inputs)
    midpoint = wbgt_liljegren(**inputs, mode=CosZenithMode.MIDPOINT)
    mean = wbgt_liljegren(**inputs, mode="mean")  # type: ignore[arg-type]  # a plain string is coerced
    np.testing.assert_array_equal(default.wbgt_c, midpoint.wbgt_c)
    assert np.max(np.abs(mean.wbgt_c - midpoint.wbgt_c)) > 1e-3


def test_unknown_mode_is_rejected(golden: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match="bogus"):
        wbgt_liljegren(**_golden_inputs(golden), mode="bogus")  # type: ignore[arg-type]


@settings(max_examples=200, deadline=None)
@given(
    t_c=st.floats(25.0, 45.0),
    td_fraction=st.floats(0.0, 1.0),
    wind=st.floats(0.5, 8.0),
    pressure=st.floats(990.0, 1010.0),
)
def test_night_wbgt_not_above_air_temperature(t_c: float, td_fraction: float, wind: float, pressure: float) -> None:
    td_c = -5.0 + td_fraction * ((t_c - 1.0) - (-5.0))  # td in [-5, t - 1]
    result = _single(t_c=t_c, td_c=td_c, wind=wind, pressure=pressure, sw=0.0, direct=0.0, at=NIGHT)
    assert result.reject[0] == WbgtReject.OK
    assert result.wbgt_c[0] <= t_c + 0.1


@settings(max_examples=100, deadline=None)
@given(
    t_c=st.floats(25.0, 45.0),
    td_fraction=st.floats(0.0, 1.0),
    wind=st.floats(0.5, 8.0),
    pressure=st.floats(990.0, 1010.0),
)
def test_wbgt_increases_with_dewpoint(t_c: float, td_fraction: float, wind: float, pressure: float) -> None:
    td_c = -5.0 + td_fraction * ((t_c - 3.0) - (-5.0))  # td in [-5, t - 3], so td + 2 stays below t

    def at_dewpoint(td: float) -> WbgtResult:
        return _single(t_c=t_c, td_c=td, wind=wind, pressure=pressure, sw=900.0, direct=720.0, at=MIDDAY)

    drier = at_dewpoint(td_c)
    moister = at_dewpoint(td_c + 2.0)
    assert drier.reject[0] == WbgtReject.OK
    assert moister.reject[0] == WbgtReject.OK
    assert moister.wbgt_c[0] >= drier.wbgt_c[0] - SOLVER_SLACK_C


def test_radiation_at_night_is_rejected() -> None:
    result = _single(t_c=30.0, td_c=20.0, wind=3.0, pressure=998.0, sw=300.0, direct=200.0, at=LATE_NIGHT)
    assert np.isnan(result.wbgt_c[0])
    assert result.reject[0] == WbgtReject.INCOHERENT_RADIATION


def test_radiation_threshold_is_ten_watts_and_exclusive() -> None:
    at_threshold = _single(t_c=30.0, td_c=20.0, wind=3.0, pressure=998.0, sw=10.0, direct=0.0, at=LATE_NIGHT)
    above = _single(t_c=30.0, td_c=20.0, wind=3.0, pressure=998.0, sw=10.001, direct=0.0, at=LATE_NIGHT)
    assert at_threshold.reject[0] == WbgtReject.OK
    assert np.isfinite(at_threshold.wbgt_c[0])
    assert above.reject[0] == WbgtReject.INCOHERENT_RADIATION


def test_nan_input_is_rejected(golden: dict[str, Any]) -> None:
    inputs = _golden_inputs(golden)
    clean = wbgt_liljegren(**inputs)
    inputs["td_c"] = inputs["td_c"].copy()
    inputs["td_c"][10] = np.nan
    result = wbgt_liljegren(**inputs)
    assert np.isnan(result.wbgt_c[10])
    assert result.reject[10] == WbgtReject.NONFINITE_INPUT
    others = np.arange(24) != 10
    assert np.all(result.reject[others] == WbgtReject.OK)
    np.testing.assert_array_equal(result.wbgt_c[others], clean.wbgt_c[others])


@pytest.mark.parametrize("name", ["t_c", "td_c", "wind10m_ms", "pressure_hpa", "sw_wm2", "direct_wm2"])
@pytest.mark.parametrize("bad", [np.nan, np.inf, -np.inf])
def test_every_numeric_input_is_screened_for_non_finite_values(golden: dict[str, Any], name: str, bad: float) -> None:
    inputs = _golden_inputs(golden)
    inputs[name] = inputs[name].copy()
    inputs[name][8] = bad
    result = wbgt_liljegren(**inputs)
    assert np.isnan(result.wbgt_c[8])
    assert result.reject[8] == WbgtReject.NONFINITE_INPUT


def test_not_a_time_is_rejected_as_a_non_finite_input(golden: dict[str, Any]) -> None:
    # Unguarded, NaT would reach cos_zenith as a huge negative number of seconds and yield a finite, wrong zenith.
    inputs = _golden_inputs(golden)
    inputs["valid_time_utc"] = inputs["valid_time_utc"].copy()
    inputs["valid_time_utc"][8] = np.datetime64("NaT", "m")
    result = wbgt_liljegren(**inputs)
    assert np.isnan(result.wbgt_c[8])
    assert result.reject[8] == WbgtReject.NONFINITE_INPUT
    assert np.sum(result.reject != WbgtReject.OK) == 1


def test_non_finite_input_takes_precedence_over_incoherent_radiation() -> None:
    result = wbgt_liljegren(
        t_c=_arr(30.0, 30.0),
        td_c=_arr(np.nan, 20.0),
        wind10m_ms=_arr(3.0, 3.0),
        pressure_hpa=_arr(998.0, 998.0),
        sw_wm2=_arr(300.0, 300.0),
        direct_wm2=_arr(200.0, 200.0),
        lat=OMAA_LAT,
        lon=OMAA_LON,
        valid_time_utc=_times(LATE_NIGHT, LATE_NIGHT),
    )
    assert result.reject.tolist() == [WbgtReject.NONFINITE_INPUT, WbgtReject.INCOHERENT_RADIATION]


def test_rejected_elements_are_excluded_from_the_thermofeel_call(
    golden: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[int] = []
    monkeypatch.setattr(wbgt_module, "calculate_wbgt_liljegren", _fake_thermofeel_returning(-1.0, calls))
    inputs = _golden_inputs(golden)
    inputs["td_c"] = inputs["td_c"].copy()
    inputs["td_c"][3] = np.nan  # non-finite
    inputs["sw_wm2"] = inputs["sw_wm2"].copy()
    inputs["sw_wm2"][21] = 400.0  # radiation with the sun down
    result = wbgt_liljegren(**inputs)
    assert result.reject[3] == WbgtReject.NONFINITE_INPUT
    assert result.reject[21] == WbgtReject.INCOHERENT_RADIATION
    assert calls == [22]  # one vectorized call over the 22 accepted elements


def test_thermofeel_is_not_called_when_every_element_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(wbgt_module, "calculate_wbgt_liljegren", _fake_thermofeel_returning(0.0, calls))
    result = _single(t_c=30.0, td_c=20.0, wind=3.0, pressure=998.0, sw=300.0, direct=200.0, at=LATE_NIGHT)
    assert result.reject[0] == WbgtReject.INCOHERENT_RADIATION
    assert calls == []


def test_non_convergence_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(wbgt_module, "calculate_wbgt_liljegren", _fake_thermofeel_returning(None))
    result = _single(t_c=35.0, td_c=20.0, wind=3.0, pressure=998.0, sw=900.0, direct=720.0, at=MIDDAY)
    assert np.isnan(result.wbgt_c[0])
    assert result.reject[0] == WbgtReject.NO_CONVERGENCE


@pytest.mark.parametrize("offset_c", [10.5, 1.0e3, -30.5, -1.0e3, np.inf, -np.inf])
def test_result_outside_the_plausible_band_is_rejected(monkeypatch: pytest.MonkeyPatch, offset_c: float) -> None:
    monkeypatch.setattr(wbgt_module, "calculate_wbgt_liljegren", _fake_thermofeel_returning(offset_c))
    result = _single(t_c=35.0, td_c=20.0, wind=3.0, pressure=998.0, sw=900.0, direct=720.0, at=MIDDAY)
    assert np.isnan(result.wbgt_c[0])
    assert result.reject[0] == WbgtReject.OUT_OF_BOUNDS


@pytest.mark.parametrize("offset_c", [9.99, 0.0, -29.99])
def test_result_inside_the_plausible_band_is_kept(monkeypatch: pytest.MonkeyPatch, offset_c: float) -> None:
    monkeypatch.setattr(wbgt_module, "calculate_wbgt_liljegren", _fake_thermofeel_returning(offset_c))
    result = _single(t_c=35.0, td_c=20.0, wind=3.0, pressure=998.0, sw=900.0, direct=720.0, at=MIDDAY)
    assert result.reject[0] == WbgtReject.OK
    assert result.wbgt_c[0] == pytest.approx(35.0 + offset_c, abs=1e-9)


def test_each_reject_code_is_assigned_per_element(monkeypatch: pytest.MonkeyPatch) -> None:
    # Five elements, one per code; the stand-in turns the third accepted element's result into NaN and the fourth's
    # into an out-of-band value.
    def fake(
        t2_k: ArrayLike,
        rh: ArrayLike,
        pressure: ArrayLike,
        va: ArrayLike,
        ssrd: ArrayLike,
        fdir: ArrayLike,
        cossza: ArrayLike,
    ) -> F64:
        del rh, pressure, va, ssrd, fdir, cossza
        out = np.asarray(t2_k, dtype=np.float64).copy()
        assert out.size == 3
        out[1] = np.nan
        out[2] += 50.0
        return out

    monkeypatch.setattr(wbgt_module, "calculate_wbgt_liljegren", fake)
    result = wbgt_liljegren(
        t_c=_arr(35.0, 35.0, 35.0, np.nan, 30.0),
        td_c=_arr(20.0, 20.0, 20.0, 20.0, 20.0),
        wind10m_ms=_arr(3.0, 3.0, 3.0, 3.0, 3.0),
        pressure_hpa=_arr(998.0, 998.0, 998.0, 998.0, 998.0),
        sw_wm2=_arr(900.0, 900.0, 900.0, 900.0, 300.0),
        direct_wm2=_arr(720.0, 720.0, 720.0, 720.0, 200.0),
        lat=OMAA_LAT,
        lon=OMAA_LON,
        valid_time_utc=_times(MIDDAY, MIDDAY, MIDDAY, MIDDAY, LATE_NIGHT),
    )
    assert result.reject.tolist() == [
        WbgtReject.OK,
        WbgtReject.NO_CONVERGENCE,
        WbgtReject.OUT_OF_BOUNDS,
        WbgtReject.NONFINITE_INPUT,
        WbgtReject.INCOHERENT_RADIATION,
    ]
    assert result.wbgt_c[0] == pytest.approx(35.0, abs=1e-9)
    assert np.all(np.isnan(result.wbgt_c[1:]))


def test_shape_is_preserved_for_multidimensional_input(golden: dict[str, Any]) -> None:
    flat = wbgt_liljegren(**_golden_inputs(golden))
    inputs: dict[str, Any] = {
        k: (v.reshape(4, 6) if isinstance(v, np.ndarray) else v) for k, v in _golden_inputs(golden).items()
    }
    shaped = wbgt_liljegren(**inputs)
    assert shaped.wbgt_c.shape == (4, 6)
    assert shaped.reject.shape == (4, 6)
    np.testing.assert_array_equal(shaped.wbgt_c.reshape(24), flat.wbgt_c)


def test_empty_input_gives_empty_output() -> None:
    result = wbgt_liljegren(
        t_c=_arr(),
        td_c=_arr(),
        wind10m_ms=_arr(),
        pressure_hpa=_arr(),
        sw_wm2=_arr(),
        direct_wm2=_arr(),
        lat=OMAA_LAT,
        lon=OMAA_LON,
        valid_time_utc=_times(),
    )
    assert result.wbgt_c.shape == (0,)
    assert result.reject.shape == (0,)


def test_mismatched_shapes_are_an_error(golden: dict[str, Any]) -> None:
    inputs = _golden_inputs(golden)
    inputs["td_c"] = inputs["td_c"][:23]
    with pytest.raises(ValueError, match="same shape"):
        wbgt_liljegren(**inputs)


@pytest.mark.parametrize(("lat", "lon"), [(91.0, 54.0), (-90.5, 54.0), (24.0, 181.0), (np.nan, 54.0), (24.0, np.inf)])
def test_invalid_coordinates_are_an_error(golden: dict[str, Any], lat: float, lon: float) -> None:
    inputs = _golden_inputs(golden)
    inputs["lat"], inputs["lon"] = lat, lon
    with pytest.raises(ValueError, match=r"lat|lon"):
        wbgt_liljegren(**inputs)
