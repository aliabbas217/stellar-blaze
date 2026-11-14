"""k-suppression with complementary suppression (ADR 0050 decisions 3-5; Review Focus 4)."""

import itertools

import pytest

from stellar_blaze.domain.config.runtime import EffectiveParams
from stellar_blaze.domain.privacy.suppression import (
    Cell,
    DataClass,
    SuppressedCell,
    TotalWouldDiscloseError,
    k_for,
    suppress,
)

pytestmark = pytest.mark.unit


def cells(*counts: int) -> list[Cell]:
    """One cell per count, keyed ``c0``, ``c1`` ..., each cell's group being as large as its count."""
    return [Cell(key=f"c{i}", count=n, group_size=n) for i, n in enumerate(counts)]


def by_key(result: tuple[SuppressedCell, ...]) -> dict[str, SuppressedCell]:
    return {c.key: c for c in result}


def params(**overrides: int) -> EffectiveParams:
    fields: dict[str, float] = {
        "twl_margin_w_m2": 7.0,
        "warning_theta": 0.10,
        "red_twl_w_m2": 85.0,
        "personal_band_amber": 0.10,
        "personal_band_orange": 0.50,
        "personal_band_red": 0.90,
    }
    ints = {
        "deescalation_dwell_minutes": 60,
        "alert_lead_hours": 12,
        "alert_dispatch_interval_minutes": 5,
        "forecast_stale_after_hours": 30,
        "k_health": 10,
        "k_exposure": 5,
        "low_zone_voluntary_rest_min": 0,
    } | overrides
    return EffectiveParams(**fields, **ints)  # type: ignore[arg-type]


def test_below_k_suppressed() -> None:
    result = by_key(suppress(cells(12, 20, 9, 4), k=5, publish_total=False))

    assert result["c3"] == SuppressedCell("c3", None, True, "below_k")
    assert result["c0"] == SuppressedCell("c0", 12, False, None)
    assert [c.suppressed for c in result.values()] == [False, False, False, True]


def test_k_is_a_strict_threshold_a_group_of_exactly_k_is_published() -> None:
    result = by_key(suppress(cells(5, 4), k=5, publish_total=False))

    assert result["c0"].suppressed is False
    assert result["c1"].suppressed is True


def test_the_group_size_decides_not_the_count() -> None:
    small_group = Cell("a", count=30, group_size=4)
    big_group = Cell("b", count=0, group_size=20)

    result = by_key(suppress([small_group, big_group], k=5, publish_total=False))

    assert result["a"] == SuppressedCell("a", None, True, "below_k")
    assert result["b"] == SuppressedCell("b", 0, False, None)


def test_a_health_count_between_zero_and_k_is_suppressed_but_zero_is_not() -> None:
    health = [
        Cell("zero", count=0, group_size=50),
        Cell("few", count=3, group_size=50),
        Cell("edge", count=10, group_size=50),
        Cell("many", count=25, group_size=50),
    ]

    result = by_key(suppress(health, k=10, publish_total=False, data_class=DataClass.HEALTH))

    assert {key: c.suppressed for key, c in result.items()} == {
        "zero": False,
        "few": True,
        "edge": False,
        "many": False,
    }
    # An exposure count of 3 in a big group is not a health count: only the group size counts.
    exposure = by_key(suppress(health, k=10, publish_total=False))
    assert not any(c.suppressed for c in exposure.values())


def test_complementary_suppression_defeats_differencing() -> None:
    published = suppress(cells(12, 20, 9, 4), k=5, publish_total=True)
    total = 12 + 20 + 9 + 4
    visible = sum(c.count for c in published if c.count is not None)
    hidden = {"c2": 9, "c3": 4}

    # The attacker knows the total and every visible cell. What is left is the sum of the hidden cells: neither alone.
    assert total - visible == 13
    assert total - visible not in hidden.values()
    assert by_key(published)["c3"].reason == "below_k"
    assert by_key(published)["c2"] == SuppressedCell("c2", None, True, "complementary")  # the smallest visible cell


def test_complementary_suppression_picks_the_smallest_visible_cell_ties_by_key() -> None:
    tied = [Cell("b", 8, 8), Cell("a", 8, 8), Cell("z", 3, 3), Cell("y", 40, 40)]

    result = by_key(suppress(tied, k=5, publish_total=True))

    assert result["z"].reason == "below_k"
    assert result["a"] == SuppressedCell("a", None, True, "complementary")
    assert result["b"].suppressed is False


def test_no_complementary_without_total() -> None:
    result = suppress(cells(12, 20, 9, 4), k=5, publish_total=False)

    assert sum(c.suppressed for c in result) == 1
    assert [c.reason for c in result if c.suppressed] == ["below_k"]


def test_two_suppressed_need_no_extra() -> None:
    result = suppress(cells(12, 20, 3, 4), k=5, publish_total=True)

    assert sum(c.suppressed for c in result) == 2
    assert {c.reason for c in result if c.suppressed} == {"below_k"}


def test_nothing_suppressed_adds_nothing() -> None:
    result = suppress(cells(12, 20, 9), k=5, publish_total=True)

    assert not any(c.suppressed for c in result)
    assert [c.count for c in result] == [12, 20, 9]


def test_one_suppressed_cell_with_no_visible_cell_cannot_have_its_total_published() -> None:
    # The total of a single cell is the cell: no complementary cell exists, so publishing the total is refused.
    with pytest.raises(TotalWouldDiscloseError):
        suppress(cells(4), k=5, publish_total=True)

    assert suppress(cells(4), k=5, publish_total=False)[0].suppressed is True


def test_the_input_order_is_kept_and_an_empty_input_is_empty() -> None:
    result = suppress([Cell("z", 9, 9), Cell("a", 2, 2), Cell("m", 7, 7)], k=5, publish_total=True)

    assert [c.key for c in result] == ["z", "a", "m"]
    assert suppress([], k=5, publish_total=True) == ()


def test_a_cell_key_must_be_unique_and_k_positive() -> None:
    with pytest.raises(ValueError, match="duplicate"):
        suppress([Cell("a", 9, 9), Cell("a", 8, 8)], k=5, publish_total=False)
    with pytest.raises(ValueError, match="k must be"):
        suppress(cells(9), k=0, publish_total=False)
    with pytest.raises(ValueError, match="negative"):
        Cell("a", count=-1, group_size=5)


def test_k_floor_from_params() -> None:
    assert k_for(DataClass.HEALTH, params()) == 10
    assert k_for(DataClass.EXPOSURE, params()) == 5
    assert k_for(DataClass.HEALTH, params(k_health=25)) == 25
    assert k_for(DataClass.EXPOSURE, params(k_exposure=8)) == 8


@pytest.mark.parametrize("counts", [c for n in (2, 3, 4) for c in itertools.product((0, 1, 4, 5, 9, 20), repeat=n)])
def test_no_single_suppressed_value_is_recoverable_by_differencing_exhaustive(counts: tuple[int, ...]) -> None:
    """For every small table, if any cell is hidden and the total is published, at least two cells are hidden."""
    try:
        published = suppress(cells(*counts), k=5, publish_total=True)
    except TotalWouldDiscloseError:
        assert len(counts) == 1
        return
    hidden = [c for c in published if c.suppressed]
    assert len(hidden) != 1
    # A below-k cell is never published, whatever else happens.
    for cell, n in zip(published, counts, strict=True):
        if n < 5:
            assert cell.suppressed
            assert cell.count is None
