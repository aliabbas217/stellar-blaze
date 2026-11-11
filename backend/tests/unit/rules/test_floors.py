"""ADR 0010 section 4.3: every floor carries a comparator, and a candidate may never be less protective."""

import types
from datetime import date
from typing import Annotated, Any, ClassVar, Union, get_args, get_origin

import pytest
from pydantic import BaseModel
from pydantic.fields import FieldInfo

from stellar_blaze.domain.rules.floors import Floor, FloorViolation, floor_violations, model_floor_violations
from stellar_blaze.domain.rules.ruleset import Ruleset, RulesetSection
from tests.unit.rules.support import seed_dict, set_path

pytestmark = pytest.mark.unit


def ruleset_with(*changes: tuple[tuple[str, ...], Any]) -> Ruleset:
    raw = seed_dict()
    for path, value in changes:
        set_path(raw, path, value)
    return Ruleset.model_validate(raw)


SEED = ruleset_with()


def paths(violations: list[FloorViolation]) -> list[str]:
    return [v.path for v in violations]


def test_a_lower_low_zone_edge_is_one_violation() -> None:
    candidate = ruleset_with((("twl_zones", "low_min_w_m2"), 135.0))
    violations = floor_violations(candidate, SEED)
    assert paths(violations) == ["twl_zones.low_min_w_m2"]
    assert violations[0].candidate == 135.0
    assert violations[0].reference == 140.0


def test_a_higher_low_zone_edge_is_more_protective_and_passes() -> None:
    assert floor_violations(ruleset_with((("twl_zones", "low_min_w_m2"), 150.0)), SEED) == []


def test_the_same_floors_pass() -> None:
    assert floor_violations(SEED, SEED) == []


def test_a_switched_off_withdrawal_limit_is_less_protective_than_a_switched_on_one() -> None:
    on = ruleset_with((("twl_withdrawal", "enabled"), True))
    off = ruleset_with((("twl_withdrawal", "enabled"), False))
    assert paths(floor_violations(off, on)) == ["twl_withdrawal.enabled"]
    assert floor_violations(on, off) == []
    assert floor_violations(off, off) == []


@pytest.mark.parametrize(
    ("field", "looser", "stricter"),
    [("dry_bulb_c", 46.0, 42.0), ("natural_wet_bulb_c", 34.0, 30.0), ("cap_w_m2", 120.0, 100.0)],
)
def test_a_withdrawal_trigger_or_cap_is_safer_the_lower_it_is(field: str, looser: float, stricter: float) -> None:
    reference = SEED
    assert paths(floor_violations(ruleset_with((("twl_withdrawal", field), looser)), reference)) == [
        f"twl_withdrawal.{field}"
    ]
    assert floor_violations(ruleset_with((("twl_withdrawal", field), stricter)), reference) == []


def test_a_smaller_clothing_adjustment_is_less_protective() -> None:
    candidate = ruleset_with((("niosh_clothing", "values_c", "double_layer_woven"), 2.0))
    assert paths(floor_violations(candidate, SEED)) == ["niosh_clothing.values_c.double_layer_woven"]
    assert floor_violations(ruleset_with((("niosh_clothing", "values_c", "double_layer_woven"), 4.0)), SEED) == []


def test_every_violation_is_reported() -> None:
    candidate = ruleset_with(
        (("twl_zones", "low_min_w_m2"), 135.0),
        (("twl_zones", "medium_min_w_m2"), 100.0),
        (("twl_withdrawal", "cap_w_m2"), 130.0),
    )
    assert sorted(paths(floor_violations(candidate, SEED))) == [
        "twl_withdrawal.cap_w_m2",
        "twl_zones.low_min_w_m2",
        "twl_zones.medium_min_w_m2",
    ]


def test_tunables_and_the_effective_range_are_not_floors() -> None:
    # ADR 0010 section 4.2: tunables are bounded by their own reviewed ranges, not by floor comparison.
    candidate = ruleset_with(
        (("tunables", "twl_margin_w_m2", "max"), 5.0),
        (("meta", "effective_from"), date(2020, 1, 1)),
    )
    assert floor_violations(candidate, SEED) == []


# --- the generic walker, on models that carry the comparators the seed does not use yet ---------------------------


class Window(BaseModel):
    """A date window: ban start and end, inclusive start and exclusive end (as in a midday-ban date range)."""

    table: dict[str, Annotated[float, Floor(safer="higher")]]
    ban: Annotated[tuple[date, date], Floor(safer="wider")]
    flag: Annotated[bool, Floor(safer="true")]
    free: float = 0.0


def window(
    *,
    ban: tuple[date, date] = (date(2026, 6, 15), date(2026, 9, 15)),
    table: dict[str, float] | None = None,
    flag: bool = True,
    free: float = 0.0,
) -> Window:
    return Window(table=table if table is not None else {"a": 1.0}, ban=ban, flag=flag, free=free)


@pytest.mark.parametrize(
    ("candidate_ban", "violates"),
    [
        ((date(2026, 6, 15), date(2026, 9, 15)), False),  # same window
        ((date(2026, 6, 1), date(2026, 9, 30)), False),  # wider on both sides
        ((date(2026, 6, 1), date(2026, 9, 15)), False),  # wider at the start
        ((date(2026, 6, 15), date(2026, 9, 30)), False),  # wider at the end
        ((date(2026, 6, 16), date(2026, 9, 15)), True),  # starts later
        ((date(2026, 6, 15), date(2026, 9, 14)), True),  # ends earlier
        ((date(2026, 7, 1), date(2026, 8, 1)), True),  # strictly inside
        ((date(2026, 9, 20), date(2026, 10, 20)), True),  # disjoint
    ],
)
def test_a_wider_window_contains_the_reference(candidate_ban: tuple[date, date], violates: bool) -> None:
    found = model_floor_violations(window(ban=candidate_ban), window())
    assert paths(found) == (["ban"] if violates else [])


def test_the_walker_reads_comparators_on_dict_values_and_booleans() -> None:
    found = model_floor_violations(window(table={"a": 0.5}, flag=False), window())
    assert sorted(paths(found)) == ["flag", "table.a"]


def test_a_candidate_may_not_drop_a_floor_entry_the_reference_has() -> None:
    found = model_floor_violations(window(table={}), window())
    assert paths(found) == ["table.a"]
    assert found[0].candidate is None
    assert found[0].reference == 1.0


def test_a_candidate_may_add_entries_and_change_fields_without_a_comparator() -> None:
    assert model_floor_violations(window(table={"a": 1.0, "b": 0.0}, free=-5.0), window()) == []


class Outer(BaseModel):
    inner: Window


def test_the_walker_descends_into_nested_models_and_prefixes_the_path() -> None:
    found = model_floor_violations(Outer(inner=window(flag=False)), Outer(inner=window()))
    assert paths(found) == ["inner.flag"]


# --- structural test: no numeric, boolean or window field ships without a comparator -----------------------------

_COMPARABLE = (bool, int, float, date)


def needs_comparator(annotation: Any) -> bool:
    """True for a number, a boolean, a date or time, a window of them, or a container of such values."""
    if get_origin(annotation) is Annotated:
        return needs_comparator(get_args(annotation)[0])
    origin = get_origin(annotation)
    if origin in (Union, types.UnionType):
        return any(needs_comparator(arg) for arg in get_args(annotation) if arg is not type(None))
    if origin is not None:
        return any(needs_comparator(arg) for arg in get_args(annotation) if arg is not Ellipsis)
    return isinstance(annotation, type) and issubclass(annotation, _COMPARABLE)


def has_comparator(info: FieldInfo) -> bool:
    if any(isinstance(m, Floor) for m in info.metadata):
        return True
    # A table whose values are the floors: dict[str, Annotated[float, Floor(...)]].
    return any(
        get_origin(arg) is Annotated and any(isinstance(m, Floor) for m in get_args(arg)[1:])
        for arg in get_args(info.annotation)
    )


def comparator_gaps(section: type[RulesetSection]) -> list[str]:
    """Fields of ``section`` that need a comparator and have neither a ``Floor`` nor a ``NON_FLOOR_FIELDS`` entry."""
    declared = set(section.model_fields)
    assert declared >= section.NON_FLOOR_FIELDS, f"{section.__name__}.NON_FLOOR_FIELDS names fields that do not exist"
    return [
        name
        for name, info in section.model_fields.items()
        if needs_comparator(info.annotation) and not has_comparator(info) and name not in section.NON_FLOOR_FIELDS
    ]


def ruleset_sections() -> list[type[RulesetSection]]:
    found = [
        info.annotation
        for info in Ruleset.model_fields.values()
        if isinstance(info.annotation, type) and issubclass(info.annotation, RulesetSection)
    ]
    assert len(found) >= 3, "the structural test found no value sections: it would pass vacuously"
    return found


@pytest.mark.parametrize("section", ruleset_sections(), ids=lambda section: section.__name__)
def test_every_numeric_boolean_or_window_field_has_a_comparator_or_is_declared_non_floor(
    section: type[RulesetSection],
) -> None:
    assert comparator_gaps(section) == []


def test_the_structural_check_finds_a_floor_without_a_comparator() -> None:
    class Sloppy(RulesetSection):
        edge_w_m2: float
        enabled: bool
        ban: tuple[date, date]
        table: dict[str, float]
        explained: float
        label: str
        covered: Annotated[float, Floor(safer="higher")]
        NON_FLOOR_FIELDS: ClassVar[frozenset[str]] = frozenset({"explained"})

    assert comparator_gaps(Sloppy) == ["edge_w_m2", "enabled", "ban", "table"]


def test_every_floor_in_the_seed_ruleset_is_walked() -> None:
    # The walker and the annotations must agree: lowering every floor field at once reports every one of them.
    candidate = ruleset_with(
        (("twl_zones", "low_min_w_m2"), 130.0),
        (("twl_zones", "medium_min_w_m2"), 100.0),
        (("twl_withdrawal", "enabled"), False),
        (("twl_withdrawal", "dry_bulb_c"), 50.0),
        (("twl_withdrawal", "natural_wet_bulb_c"), 40.0),
        (("twl_withdrawal", "cap_w_m2"), 130.0),
        *[(("niosh_clothing", "values_c", key), 0.0) for key in SEED.niosh_clothing.values_c],
    )
    reference = ruleset_with((("twl_withdrawal", "enabled"), True))
    walked = set(paths(floor_violations(candidate, reference)))
    expected = {
        "twl_zones.low_min_w_m2",
        "twl_zones.medium_min_w_m2",
        "twl_withdrawal.enabled",
        "twl_withdrawal.dry_bulb_c",
        "twl_withdrawal.natural_wet_bulb_c",
        "twl_withdrawal.cap_w_m2",
        # work_clothes and cloth_coveralls are already 0.0 in the seed, so lowering them to 0.0 is no violation
        "niosh_clothing.values_c.double_layer_woven",
        "niosh_clothing.values_c.sms_coveralls",
        "niosh_clothing.values_c.polyolefin_coveralls",
        "niosh_clothing.values_c.limited_use_vapor_barrier",
    }
    assert walked == expected
