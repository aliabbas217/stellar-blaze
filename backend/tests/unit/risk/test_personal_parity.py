import json
import math
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from stellar_blaze.domain.risk.levels import AlertLevel
from stellar_blaze.domain.risk.personal import (
    DEFAULT_BANDS,
    band_level,
    build_vectors,
    displayed_level,
    exceedance_3q,
    render_vectors,
)

pytestmark = pytest.mark.unit

VECTORS_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "risk" / "personal_level_vectors.json"
G, A, OR, R = AlertLevel.GREEN, AlertLevel.AMBER, AlertLevel.ORANGE, AlertLevel.RED
BANDS = [(G, 0.0), (A, 0.10), (OR, 0.50), (R, 0.90)]


def test_tie_at_median_is_half() -> None:
    assert exceedance_3q(30.0, 32.0, 36.0, 32.0) == 0.50
    assert exceedance_3q(1.0, 1.0, 5.0, 1.0) == 0.50  # the median wins over the p05 rule: limit == p50 is 0.50 first
    assert exceedance_3q(1.0, 5.0, 5.0, 5.0) == 0.50  # ... and over the p95 rule


def test_all_equal_quantiles() -> None:
    assert exceedance_3q(5.0, 5.0, 5.0, 5.0) == 0.50
    assert exceedance_3q(5.0, 5.0, 5.0, 4.9) == 0.95
    assert exceedance_3q(5.0, 5.0, 5.0, 5.1) == 0.05


def test_bounds_005_095() -> None:
    assert exceedance_3q(30.0, 32.0, 36.0, 30.0) == 0.95  # limit == p05 is a lower bound
    assert exceedance_3q(30.0, 32.0, 36.0, 10.0) == 0.95
    assert exceedance_3q(30.0, 32.0, 36.0, 36.0) == 0.05  # limit == p95 is an upper bound
    assert exceedance_3q(30.0, 32.0, 36.0, 99.0) == 0.05


def test_inner_segments_are_linear() -> None:
    assert exceedance_3q(30.0, 32.0, 36.0, 31.0) == pytest.approx(0.95 - 0.45 * 0.5)
    assert exceedance_3q(30.0, 32.0, 36.0, 34.0) == pytest.approx(0.50 - 0.45 * 0.5)


def test_unsorted_quantiles_are_sorted_first() -> None:
    expected = exceedance_3q(30.0, 32.0, 36.0, 34.0)
    for order in ((36.0, 30.0, 32.0), (32.0, 36.0, 30.0), (36.0, 32.0, 30.0), (32.0, 30.0, 36.0)):
        assert exceedance_3q(*order, 34.0) == expected


def test_half_tied_quantiles_never_divide_by_zero() -> None:
    assert exceedance_3q(26.0, 26.0, 30.0, 28.0) == pytest.approx(0.50 - 0.45 * 0.5)
    assert exceedance_3q(26.0, 30.0, 30.0, 28.0) == pytest.approx(0.95 - 0.45 * 0.5)


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_non_finite_numbers_are_refused(bad: float) -> None:
    for index in range(4):
        args = [30.0, 32.0, 36.0, 31.0]
        args[index] = bad
        with pytest.raises(ValueError, match="finite"):
            exceedance_3q(*args)


_finite = st.floats(min_value=-60.0, max_value=80.0, allow_nan=False, allow_infinity=False)


@settings(max_examples=200, deadline=None)
@given(p05=_finite, p50=_finite, p95=_finite, limit=_finite)
def test_probability_stays_in_005_095(p05: float, p50: float, p95: float, limit: float) -> None:
    # Floating point: a limit just under p95 gives 0.5 - 0.45 * (almost 1) = 0.04999999999999999 (hypothesis found
    # p05 = 1e-287, p50 = p95 = -1, limit = 0), in F1's TypeScript as well, since the arithmetic is the same.
    assert 0.05 - 1e-12 <= exceedance_3q(p05, p50, p95, limit) <= 0.95 + 1e-12


@settings(max_examples=200, deadline=None)
@given(p05=_finite, p50=_finite, p95=_finite, lo=_finite, hi=_finite)
def test_probability_never_rises_with_the_limit(p05: float, p50: float, p95: float, lo: float, hi: float) -> None:
    lo, hi = min(lo, hi), max(lo, hi)
    assert exceedance_3q(p05, p50, p95, hi) <= exceedance_3q(p05, p50, p95, lo) + 1e-12


def test_band_inclusive() -> None:
    assert band_level(BANDS, 0.0) is G
    assert band_level(BANDS, 0.0999999) is G
    assert band_level(BANDS, 0.10) is A  # a probability equal to a minimum takes that band
    assert band_level(BANDS, 0.4999999) is A
    assert band_level(BANDS, 0.50) is OR
    assert band_level(BANDS, 0.90) is R
    assert band_level(BANDS, 0.95) is R


def test_band_level_is_none_below_every_minimum_and_ignores_order() -> None:
    assert band_level([(A, 0.10), (OR, 0.50)], 0.05) is None
    assert band_level([], 0.5) is None
    assert band_level([(R, 0.90), (G, 0.0), (OR, 0.50), (A, 0.10)], 0.6) is OR


def test_equal_minimums_take_the_more_severe_level() -> None:
    assert band_level([(A, 0.30), (OR, 0.30), (G, 0.0)], 0.30) is OR
    assert band_level([(OR, 0.30), (A, 0.30), (G, 0.0)], 0.30) is OR
    assert band_level([(R, 0.30), (A, 0.30)], 0.5) is R


def test_default_bands_are_the_adr_0049_bands() -> None:
    assert list(DEFAULT_BANDS) == BANDS


def test_displayed_level_more_severe() -> None:
    assert displayed_level(R, G) is R  # a site Red (stop) always wins over a personal Green
    assert displayed_level(G, OR) is OR
    assert displayed_level(None, OR) is OR
    assert displayed_level(A, None) is A
    assert displayed_level(None, None) is None
    assert displayed_level(OR, OR) is OR


def test_vectors_file_matches_functions() -> None:
    committed_text = VECTORS_PATH.read_text(encoding="utf-8")
    assert committed_text == render_vectors(), (
        "regenerate with: python -m stellar_blaze.domain.risk.personal --write-vectors"
    )
    committed = json.loads(committed_text)
    assert committed == build_vectors()


def test_vectors_file_is_self_consistent_and_covers_the_edges() -> None:
    document = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))
    vectors = document["exceedance_vectors"]
    assert len(vectors) + len(document["band_vectors"]) >= 40
    assert document["probability_tolerance"] == 1e-9
    for vector in vectors:
        expected = exceedance_3q(vector["p05"], vector["p50"], vector["p95"], vector["limit"])
        assert abs(expected - vector["expected_probability"]) <= 1e-9
        assert band_level(DEFAULT_BANDS, vector["expected_probability"]) is AlertLevel(vector["expected_level"])
    names = {vector["name"] for vector in vectors}
    for required in ("limit_equals_p05", "limit_equals_p50", "limit_equals_p95", "all_equal_at", "unsorted"):
        assert any(required in name for name in names), required
    assert {v["expected_probability"] for v in vectors} >= {0.05, 0.5, 0.95}
    # each band minimum exactly, and the value just below it
    by_probability = {(v["probability"], v["expected_level"]) for v in document["band_vectors"]}
    for level, minimum in DEFAULT_BANDS:
        assert (minimum, level.value) in by_probability
    # the two ends of the band table, from the exceedance side: 0.95 reads Red, 0.05 reads Green
    levels = {(v["expected_probability"], v["expected_level"]) for v in vectors}
    assert (0.95, "red") in levels
    assert (0.05, "green") in levels
    assert (0.5, "orange") in levels


def test_hand_checked_vectors() -> None:
    # Computed by hand from the 3-quantile polyline, independent of the implementation.
    document = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))
    by_name = {v["name"]: v for v in document["exceedance_vectors"]}
    mid_low = by_name["triple_a_limit_between_p05_and_p50"]
    assert (mid_low["p05"], mid_low["p50"], mid_low["p95"], mid_low["limit"]) == (30.0, 32.0, 36.0, 31.0)
    assert mid_low["expected_probability"] == pytest.approx(0.725, abs=1e-12)
    assert mid_low["expected_level"] == "orange"
    mid_high = by_name["triple_a_limit_between_p50_and_p95"]
    assert mid_high["expected_probability"] == pytest.approx(0.275, abs=1e-12)
    assert mid_high["expected_level"] == "amber"
