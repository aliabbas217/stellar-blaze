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
    small_group = Cell("a", count=3, group_size=4)
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


def hidden_ranges(
    published: tuple[SuppressedCell, ...], source: list[Cell], k: int, data_class: DataClass
) -> dict[str, tuple[int, int]]:
    """What a reader who knows k, the reason labels, the total and every visible cell can say of each hidden cell.

    A primary-hidden cell is in ``[lo, k - 1]`` (``lo`` is 1 for a health count whose group is at least ``k``); a
    complementary cell is in ``[0, H]``, ``H`` being the hidden sum. The per-cell range is then tightened with the sum
    constraint ``sum(hidden) == H`` (interval propagation, exact for a sum of interval-bounded integers).
    """
    group = {c.key: c.group_size for c in source}
    total = sum(c.count for c in source)
    hidden_sum = total - sum(c.count for c in published if c.count is not None)
    bounds: dict[str, tuple[int, int]] = {}
    for cell in published:
        if not cell.suppressed:
            continue
        if cell.reason == "below_k":
            lo = 1 if data_class is DataClass.HEALTH and group[cell.key] >= k else 0
            bounds[cell.key] = (lo, k - 1)
        else:
            bounds[cell.key] = (0, hidden_sum)
    tightened: dict[str, tuple[int, int]] = {}
    for key, (lo, hi) in bounds.items():
        others_lo = sum(b[0] for other, b in bounds.items() if other != key)
        others_hi = sum(b[1] for other, b in bounds.items() if other != key)
        tightened[key] = (max(lo, hidden_sum - others_hi), min(hi, hidden_sum - others_lo))
    return tightened


def assert_nothing_is_pinned(source: list[Cell], k: int, data_class: DataClass) -> bool:
    """Publish ``source`` with its total; False if the total was refused, else assert no hidden cell is pinned."""
    try:
        published = suppress(source, k=k, publish_total=True, data_class=data_class)
    except TotalWouldDiscloseError:
        return False
    for key, (lo, hi) in hidden_ranges(published, source, k, data_class).items():
        assert lo < hi, f"{key} is pinned to {lo} in {[(c.count, c.group_size) for c in source]}"
    for cell, original in zip(published, source, strict=True):
        if cell.suppressed:
            assert cell.count is None
        else:
            assert cell.count == original.count
    return True


def test_no_hidden_value_is_pinned_by_the_interval_attack_exhaustive_exposure() -> None:
    """For every table of 1-4 cells over counts (0, 1, 4, 5, 9, 20), each cell's group being its count (so every cell
    below k=5 is hidden), the published total plus the visible cells leave every hidden cell a range of at least two
    values (the reader knows k, the reasons and the total). A refusal (``TotalWouldDiscloseError``) is the only other
    outcome; the sweep requires both outcomes to occur, so the check is not vacuous."""
    published_tables = refused = 0
    for n in (1, 2, 3, 4):
        for counts in itertools.product((0, 1, 4, 5, 9, 20), repeat=n):
            if assert_nothing_is_pinned(cells(*counts), 5, DataClass.EXPOSURE):
                published_tables += 1
            else:
                refused += 1
    assert published_tables > 1000
    assert refused > 0


def test_no_hidden_value_is_pinned_by_the_interval_attack_exhaustive_health() -> None:
    """The same sweep for a health table (k=10, every group 25, counts 0, 1, 3, 9, 10, 15): a count of 1..9 is
    hidden and the reader knows it is at least 1."""
    refused = 0
    for n in (1, 2, 3, 4):
        for counts in itertools.product((0, 1, 3, 9, 10, 15), repeat=n):
            table = [Cell(f"c{i}", n_, 25) for i, n_ in enumerate(counts)]
            refused += not assert_nothing_is_pinned(table, 10, DataClass.HEALTH)
    assert refused > 0


@pytest.mark.parametrize(
    ("table", "k", "data_class", "hidden_keys"),
    [
        # Review I4 reproductions: each used to publish two hidden cells that are exactly pinned.
        ([(7, 9), (6, 12), (0, 3), (0, 9)], 5, DataClass.EXPOSURE, {"c2", "c3", "c1"}),
        ([(7, 20), (5, 20), (4, 4), (4, 4)], 5, DataClass.EXPOSURE, {"c2", "c3", "c1"}),
        ([(9, 11), (9, 11), (20, 20)], 10, DataClass.HEALTH, {"c0", "c1", "c2"}),
    ],
)
def test_the_review_reproductions_no_longer_pin_two_hidden_cells(
    table: list[tuple[int, int]], k: int, data_class: DataClass, hidden_keys: set[str]
) -> None:
    source = [Cell(f"c{i}", count, group) for i, (count, group) in enumerate(table)]

    assert assert_nothing_is_pinned(source, k, data_class)
    published = suppress(source, k=k, publish_total=True, data_class=data_class)
    assert {c.key for c in published if c.suppressed} == hidden_keys


def test_a_cell_cannot_count_more_people_than_its_group() -> None:
    with pytest.raises(ValueError, match="exceeds group_size"):
        Cell("a", count=6, group_size=5)
    Cell("a", count=5, group_size=5)
