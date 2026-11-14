import dataclasses
import math

import numpy as np
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from hypothesis.extra.numpy import arrays

from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.risk.levels import (
    AlertLevel,
    Zone,
    ZoneEdges,
    hour_levels,
    level_for_zone,
    protective_twl,
    zone_of,
)
from tests.unit.risk.support import default_params, released_ruleset

pytestmark = pytest.mark.unit

EDGES = ZoneEdges(140.0, 115.0, 85.0)
NAN = float("nan")


def _row(*, high: int = 0, medium: int = 0, red: int = 0, low: int = 0) -> F64:
    """One row of samples with the given number of samples in each zone (values well inside each zone)."""
    return np.array([150.0] * low + [125.0] * medium + [100.0] * high + [70.0] * red, dtype=np.float64)


def test_zone_values_are_ordered_by_severity() -> None:
    assert [int(z) for z in (Zone.LOW, Zone.MEDIUM, Zone.HIGH, Zone.RED)] == [0, 1, 2, 3]


def test_zone_edges() -> None:
    values = np.array([140.0, 139.999, 115.0, 114.999, 85.0, 84.999, NAN])
    assert zone_of(values, EDGES).tolist() == [0, 1, 1, 2, 2, 3, -1]


def test_zone_of_keeps_the_shape_and_returns_int8() -> None:
    zones = zone_of(np.array([[150.0, 100.0], [NAN, 60.0]]), EDGES)
    assert zones.dtype == np.int8
    assert zones.tolist() == [[0, 2], [-1, 3]]


def test_edges_from_the_released_ruleset_and_default_params() -> None:
    edges = ZoneEdges.from_ruleset(released_ruleset(), default_params())
    assert (edges.low_min, edges.medium_min, edges.red_min) == (140.0, 115.0, 85.0)


def test_edges_follow_the_red_tunable() -> None:
    params = dataclasses.replace(default_params(), red_twl_w_m2=100.0)
    assert ZoneEdges.from_ruleset(released_ruleset(), params).red_min == 100.0


@pytest.mark.parametrize(
    ("low", "medium", "red"),
    [(115.0, 115.0, 85.0), (140.0, 115.0, 116.0), (140.0, NAN, 85.0), (math.inf, 115.0, 85.0)],
)
def test_edges_must_descend_and_be_finite(low: float, medium: float, red: float) -> None:
    with pytest.raises(ValueError, match="edges"):
        ZoneEdges(low, medium, red)


def test_red_edge_may_equal_the_medium_edge() -> None:
    # red_twl_w_m2 has the range [60, 115]: at 115 the High zone is empty, which is legal.
    edges = ZoneEdges(140.0, 115.0, 115.0)
    assert zone_of(np.array([114.999, 115.0]), edges).tolist() == [3, 1]


def test_theta_tie_escalates() -> None:
    # 50 samples, exactly 5 below 115 (High) and the rest above 140: P(High or worse) = 5/50 = 0.10 >= theta.
    five_high = _row(high=5, low=45)
    assert hour_levels(five_high[None, :], EDGES, 0.10).tolist() == [Zone.HIGH]
    # 4 High and 1 Medium: P(High) = 0.08 < 0.10, P(Medium or worse) = 0.10 >= 0.10.
    four_high = _row(high=4, medium=1, low=45)
    assert hour_levels(four_high[None, :], EDGES, 0.10).tolist() == [Zone.MEDIUM]


def test_red_needs_its_own_share() -> None:
    assert hour_levels(_row(red=5, low=45)[None, :], EDGES, 0.10).tolist() == [Zone.RED]
    assert hour_levels(_row(red=4, high=1, low=45)[None, :], EDGES, 0.10).tolist() == [Zone.HIGH]


def test_all_low_hour_is_low() -> None:
    assert hour_levels(_row(low=50)[None, :], EDGES, 0.10).tolist() == [Zone.LOW]


def test_all_nan_hour_has_no_level() -> None:
    samples = np.full((2, 50), NAN)
    samples[1] = _row(low=50)
    assert hour_levels(samples, EDGES, 0.10).tolist() == [-1, Zone.LOW]


def test_nan_samples_are_excluded_from_the_denominator() -> None:
    # 1 High of 10 finite samples (the other 40 are NaN): 0.1 >= 0.10. Counting NaN as milder would give 1/50 = 0.02.
    row = np.concatenate([_row(high=1, low=9), np.full(40, NAN)])
    assert hour_levels(row[None, :], EDGES, 0.10).tolist() == [Zone.HIGH]


def test_hour_levels_exact_division_at_n30() -> None:
    # 3/30 == 0.1 in floating point division: a tie, so it escalates.
    assert 3 / 30 == 0.1
    assert hour_levels(_row(high=3, low=27)[None, :], EDGES, 0.10).tolist() == [Zone.HIGH]
    assert hour_levels(_row(high=2, low=28)[None, :], EDGES, 0.10).tolist() == [Zone.LOW]


@pytest.mark.parametrize("theta", [0.0, -0.1, 1.5, NAN])
def test_theta_must_be_a_probability(theta: float) -> None:
    with pytest.raises(ValueError, match="theta"):
        hour_levels(_row(low=50)[None, :], EDGES, theta)


def test_hour_levels_matches_the_leading_shape() -> None:
    samples = np.stack([_row(low=50), _row(red=50), _row(medium=50)]).reshape(3, 1, 50)
    out = hour_levels(samples, EDGES, 0.10)
    assert out.shape == (3, 1)
    assert out.dtype == np.int8
    assert out.ravel().tolist() == [Zone.LOW, Zone.RED, Zone.MEDIUM]


_samples = arrays(
    np.float64,
    (4, 50),
    elements=st.one_of(
        st.just(NAN),
        st.sampled_from([140.0, 115.0, 85.0, 139.999, 114.999, 84.999]),
        st.floats(min_value=40.0, max_value=200.0, allow_nan=False),
    ),
)


def _zone_py(x: float) -> int:
    return 0 if x >= 140.0 else 1 if x >= 115.0 else 2 if x >= 85.0 else 3


def _count_rule(row: F64, theta: float) -> int:
    """ADR 0046 section 3 written out with plain Python, independent of the implementation."""
    finite = [float(x) for x in row if not math.isnan(x)]
    if not finite:
        return -1
    zones = [_zone_py(x) for x in finite]
    level = 0
    for z in (1, 2, 3):
        if sum(1 for v in zones if v >= z) / len(finite) >= theta:
            level = z
    return level


@settings(max_examples=120, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(samples=_samples)
def test_level_equals_the_count_rule_at_theta_010(samples: F64) -> None:
    got = hour_levels(samples, EDGES, 0.10)
    assert got.tolist() == [_count_rule(row, 0.10) for row in samples]


@settings(max_examples=120, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(samples=_samples)
def test_level_equals_q10_zone_at_theta_010(samples: F64) -> None:
    """ADR 0046 section 4: at theta 0.10 the level equals the zone of the protective q10, hour by hour."""
    levels = hour_levels(samples, EDGES, 0.10)
    q10_zones = zone_of(protective_twl(samples), EDGES)
    assert levels.tolist() == q10_zones.tolist()


def _level_vs_q10_differences(first_n: int, last_n: int) -> list[tuple[int, int, int, int]]:
    """``(n, k, level, q10 zone)`` for every n in the range and k = 0..n samples below the High edge that disagree."""
    differences = []
    for n in range(first_n, last_n + 1):
        for k in range(n + 1):
            row = np.array([100.0] * k + [150.0] * (n - k))[None, :]
            level = int(hour_levels(row, EDGES, 0.10)[0])
            q10_zone = int(zone_of(protective_twl(row), EDGES)[0])
            if level != q10_zone:
                differences.append((n, k, level, q10_zone))
    return differences


def test_level_equals_q10_zone_for_every_sample_count_up_to_120() -> None:
    """The exact count rule and numpy's ``inverted_cdf`` q10 agree for every n and every number of High samples.

    The controller's supplement expected a float-rounding difference (``30 * 0.1 == 3.0000000000000004``); with numpy
    2.5.4 there is none, checked here exhaustively for n = 1..120 and k = 0..n samples below the High edge (the
    ``slow`` test below goes to 200). If a numpy upgrade ever introduces one, this test names the n and k, and ADR 0046
    section 4's clamp still keeps the plan at least as protective as the level.
    """
    assert _level_vs_q10_differences(1, 120) == []


@pytest.mark.slow
def test_level_equals_q10_zone_for_every_sample_count_up_to_200() -> None:
    assert _level_vs_q10_differences(121, 200) == []


@pytest.mark.parametrize("bad", [float("inf"), float("-inf"), float("nan")])
def test_non_finite_samples_have_no_zone_and_are_not_counted(bad: float) -> None:
    assert zone_of(np.array([bad, 150.0, 100.0]), EDGES).tolist() == [-1, 0, 2]
    row = np.array([[bad, 100.0, 150.0, 150.0]])
    assert hour_levels(row, EDGES, 0.10).tolist() == [2]  # 1 of 3 finite samples is High: 0.33 >= 0.10
    assert hour_levels(np.array([[bad, bad]]), EDGES, 0.10).tolist() == [-1]  # no finite sample: no level
    assert math.isnan(protective_twl(np.array([[bad, bad]]))[0])


def test_protective_twl_is_the_inverted_cdf_q10_of_the_finite_samples() -> None:
    samples = np.arange(1.0, 51.0)[None, :]
    assert protective_twl(samples).tolist() == [5.0]  # rank ceil(50 * 0.1) = 5
    shuffled = np.concatenate([np.arange(1.0, 51.0)[::-1], np.full(50, NAN)])[None, :]
    assert protective_twl(shuffled).tolist() == [5.0]  # NaN samples are dropped first


def test_protective_twl_all_nan_row_is_nan_and_quantile_is_a_parameter() -> None:
    samples = np.stack([np.full(50, NAN), np.arange(1.0, 51.0)])
    out = protective_twl(samples, q=0.5)
    assert math.isnan(out[0])
    assert out[1] == 25.0


def test_protective_twl_keeps_the_leading_shape() -> None:
    assert protective_twl(np.full((2, 3, 50), 100.0)).shape == (2, 3)


def test_level_for_zone_maps_to_the_alert_levels() -> None:
    assert [level_for_zone(z) for z in Zone] == [
        AlertLevel.GREEN,
        AlertLevel.AMBER,
        AlertLevel.ORANGE,
        AlertLevel.RED,
    ]
    assert level_for_zone(2) is AlertLevel.ORANGE  # a plain int works too
    with pytest.raises(ValueError, match="zone"):
        level_for_zone(-1)
