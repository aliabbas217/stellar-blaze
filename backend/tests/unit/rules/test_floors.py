"""ADR 0010 section 4.3: every floor carries a comparator, and a candidate may never be less protective."""

from datetime import date, time, timedelta
from typing import Annotated, Any, ClassVar

import pytest
from pydantic import BaseModel

from stellar_blaze.domain.rules.floors import Floor, FloorViolation, floor_violations, model_floor_violations
from stellar_blaze.domain.rules.ruleset import Ruleset, RulesetSection, TwlZones
from tests.unit.rules.structure import comparator_gaps, floor_misfits, section_fields
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


class Hours(BaseModel):
    """Time-of-day windows and durations: the kinds of floor B3's labour-law section will carry."""

    ban_hours: Annotated[tuple[time, time], Floor(safer="wider")]
    max_shift: Annotated[timedelta, Floor(safer="lower")]
    min_break: Annotated[timedelta, Floor(safer="higher")]


def hours(
    *,
    ban_hours: tuple[time, time] = (time(12, 30, 0), time(15, 0, 0)),
    max_shift: timedelta = timedelta(hours=8),
    min_break: timedelta = timedelta(minutes=30),
) -> Hours:
    return Hours(ban_hours=ban_hours, max_shift=max_shift, min_break=min_break)


@pytest.mark.parametrize(
    ("candidate_ban", "violates"),
    [
        ((time(12, 30, 0), time(15, 0, 0)), False),
        ((time(12, 0, 0), time(15, 30, 0)), False),
        ((time(12, 30, 1), time(15, 0, 0)), True),
        ((time(12, 30, 0), time(14, 59, 59)), True),
        ((time(13, 0, 0), time(14, 0, 0)), True),
    ],
)
def test_a_wider_time_of_day_window_contains_the_reference(candidate_ban: tuple[time, time], violates: bool) -> None:
    found = model_floor_violations(hours(ban_hours=candidate_ban), hours())
    assert paths(found) == (["ban_hours"] if violates else [])


def test_durations_compare_in_the_direction_the_floor_names() -> None:
    longer_shift = hours(max_shift=timedelta(hours=9))
    assert paths(model_floor_violations(longer_shift, hours())) == ["max_shift"]
    shorter_break = hours(min_break=timedelta(minutes=20))
    assert paths(model_floor_violations(shorter_break, hours())) == ["min_break"]
    safer = hours(max_shift=timedelta(hours=7), min_break=timedelta(minutes=45))
    assert model_floor_violations(safer, hours()) == []


class Switches(BaseModel):
    """The comparators B3 adds: a switch that must stay off, a window that may only shrink, a text window."""

    credits_ban: Annotated[bool, Floor(safer="false")]
    juvenile: Annotated[tuple[time, time], Floor(safer="narrower")]
    season: Annotated[tuple[str, str], Floor(safer="wider")]


def switches(
    *,
    credits_ban: bool = False,
    juvenile: tuple[time, time] = (time(7, 0, 0), time(19, 0, 0)),
    season: tuple[str, str] = ("06-15", "09-15"),
) -> Switches:
    return Switches(credits_ban=credits_ban, juvenile=juvenile, season=season)


def test_a_false_floor_is_less_protective_when_the_candidate_turns_it_on() -> None:
    assert paths(model_floor_violations(switches(credits_ban=True), switches())) == ["credits_ban"]
    assert model_floor_violations(switches(credits_ban=False), switches()) == []
    # A reference that already credits it sets no bar: either candidate passes.
    assert model_floor_violations(switches(credits_ban=True), switches(credits_ban=True)) == []
    assert model_floor_violations(switches(credits_ban=False), switches(credits_ban=True)) == []


@pytest.mark.parametrize(
    ("candidate_window", "violates"),
    [
        ((time(7, 0, 0), time(19, 0, 0)), False),  # same window
        ((time(8, 0, 0), time(18, 0, 0)), False),  # strictly inside
        ((time(7, 0, 0), time(18, 0, 0)), False),  # earlier end
        ((time(8, 0, 0), time(19, 0, 0)), False),  # later start
        ((time(6, 59, 59), time(19, 0, 0)), True),  # starts earlier
        ((time(7, 0, 0), time(19, 0, 1)), True),  # ends later
        ((time(6, 0, 0), time(20, 0, 0)), True),  # wider on both sides
        ((time(20, 0, 0), time(21, 0, 0)), True),  # disjoint
    ],
)
def test_a_narrower_window_must_lie_inside_the_reference(candidate_window: tuple[time, time], violates: bool) -> None:
    found = model_floor_violations(switches(juvenile=candidate_window), switches())
    assert paths(found) == (["juvenile"] if violates else [])


@pytest.mark.parametrize(
    ("candidate_season", "violates"),
    [
        (("06-15", "09-15"), False),
        (("06-01", "09-30"), False),
        (("06-16", "09-15"), True),
        (("06-15", "09-14"), True),
        (("07-01", "08-01"), True),
    ],
)
def test_a_wider_text_window_compares_zero_padded_month_days(candidate_season: tuple[str, str], violates: bool) -> None:
    found = model_floor_violations(switches(season=candidate_season), switches())
    assert paths(found) == (["season"] if violates else [])


class Section(BaseModel):
    flag: Annotated[bool, Floor(safer="true")]


class WithOptional(BaseModel):
    section: Section | None = None


def test_a_missing_section_is_one_violation_at_the_section_path() -> None:
    found = model_floor_violations(WithOptional(), WithOptional(section=Section(flag=True)))
    assert paths(found) == ["section"]
    assert found[0].candidate is None
    assert found[0].reference == Section(flag=True)


def test_a_missing_reference_section_sets_no_bar() -> None:
    assert model_floor_violations(WithOptional(section=Section(flag=False)), WithOptional()) == []
    assert model_floor_violations(WithOptional(), WithOptional()) == []
    # Both present: the walk descends as before.
    both = model_floor_violations(WithOptional(section=Section(flag=False)), WithOptional(section=Section(flag=True)))
    assert paths(both) == ["section.flag"]


# --- structural test: no numeric, boolean or window field ships without a comparator -----------------------------
# The helpers are in `structure`. Every guard runs over the real sections and over deliberately broken ones, so a guard
# that stopped looking would fail its negative control instead of passing over nothing.


def real_sections() -> list[type[RulesetSection]]:
    sections = list(section_fields().values())
    assert len(sections) >= 3, "the structural tests found no value sections: they would pass vacuously"
    return sections


def test_every_field_of_a_ruleset_is_a_section_or_explicitly_not_one() -> None:
    assert frozenset({"meta", "sources", "tunables"}) == Ruleset.NON_SECTION_FIELDS
    assert set(section_fields()) == {
        "niosh_clothing",
        "twl_zones",
        "twl_withdrawal",
        "labour",
        "adosh_cycles",
        "acclimatisation",
        "workload",
        "privacy",
        "clauses",
        "alerts",
    }
    # The B3 sections are Optional so that the released ae-heat-0.1 still loads: every one of them is a section.
    for name in ("labour", "adosh_cycles", "acclimatisation", "workload", "privacy", "clauses", "alerts"):
        assert Ruleset.model_fields[name].default is None


def test_a_ruleset_field_that_is_not_a_section_and_not_allowlisted_is_found() -> None:
    class LooseRuleset(Ruleset):
        # A table or tuple of sections escapes the source check, the golden file and the floor walk.
        extra_sections: dict[str, TwlZones] = {}  # noqa: RUF012 - a throwaway class for a negative control

    with pytest.raises(AssertionError, match=r"Ruleset\.extra_sections is neither a RulesetSection"):
        section_fields(LooseRuleset)

    class WrongOptional(Ruleset):
        maybe: TwlZones | int | None = None  # an Optional of something that is not exactly one section

    with pytest.raises(AssertionError, match=r"Ruleset\.maybe is neither a RulesetSection"):
        section_fields(WrongOptional)

    class OptionalSection(Ruleset):
        extra: TwlZones | None = None  # an Optional section is a section (the B3 sections are Optional)

    assert section_fields(OptionalSection)["extra"] is TwlZones

    class WrongAllowlist(Ruleset):
        NON_SECTION_FIELDS: ClassVar[frozenset[str]] = frozenset({"meta", "sources", "tunables", "nothing"})

    with pytest.raises(AssertionError, match="nothing"):
        section_fields(WrongAllowlist)


@pytest.mark.parametrize("section", real_sections(), ids=lambda section: section.__name__)
def test_every_ordered_field_has_a_comparator_or_is_declared_non_floor(section: type[RulesetSection]) -> None:
    assert comparator_gaps(section) == []


@pytest.mark.parametrize("section", real_sections(), ids=lambda section: section.__name__)
def test_every_comparator_fits_the_type_it_guards(section: type[RulesetSection]) -> None:
    assert floor_misfits(section) == []


class Rate(BaseModel):
    per_hour: float
    label: str = ""


class Covered(BaseModel):
    per_hour: Annotated[float, Floor(safer="lower")]


def test_the_comparator_check_finds_every_kind_of_unguarded_floor() -> None:
    class Sloppy(RulesetSection):
        edge_w_m2: float
        enabled: bool
        ban: tuple[date, date]
        table: dict[str, float]
        ban_hours: tuple[time, time]  # a time-of-day window
        max_shift: timedelta  # a duration
        inner: Rate  # a nested model: its own fields count
        covered_inner: Covered  # a nested model that is fine
        windows: tuple[Rate, ...]  # a container of models: the walker never reaches into it
        maybe: Rate | None = None  # nor into an Optional model
        explained: float
        label: str
        covered: Annotated[float, Floor(safer="higher")]
        NON_FLOOR_FIELDS: ClassVar[frozenset[str]] = frozenset({"explained"})

    unreachable = "(a model inside a container or an Optional is not walked by floor_violations)"
    assert comparator_gaps(Sloppy) == [
        "edge_w_m2",
        "enabled",
        "ban",
        "table",
        "ban_hours",
        "max_shift",
        "inner.per_hour",
        f"windows {unreachable}",
        f"maybe {unreachable}",
    ]


def test_a_container_of_models_without_ordered_values_is_not_a_gap() -> None:
    class Notes(BaseModel):
        text: str

    class Tidy(RulesetSection):
        notes: tuple[Notes, ...] = ()

    assert comparator_gaps(Tidy) == []


def test_a_field_cannot_be_both_declared_non_floor_and_carry_a_floor() -> None:
    class Contradiction(RulesetSection):
        edge: Annotated[float, Floor(safer="higher")]
        NON_FLOOR_FIELDS: ClassVar[frozenset[str]] = frozenset({"edge"})

    with pytest.raises(AssertionError, match="edge"):
        comparator_gaps(Contradiction)


def test_a_declaration_for_a_field_that_does_not_exist_is_found() -> None:
    class Typo(RulesetSection):
        edge: Annotated[float, Floor(safer="higher")]
        NON_FLOOR_FIELDS: ClassVar[frozenset[str]] = frozenset({"edgee"})

    with pytest.raises(AssertionError, match="edgee"):
        comparator_gaps(Typo)


def test_the_fit_check_finds_a_comparator_on_the_wrong_kind_of_value() -> None:
    class Misfit(RulesetSection):
        flag_on_a_float: Annotated[float, Floor(safer="true")]
        window_on_a_float: Annotated[float, Floor(safer="wider")]
        window_of_unknown_length: Annotated[tuple[date, ...], Floor(safer="wider")]
        window_of_mixed_types: Annotated[tuple[date, float], Floor(safer="wider")]
        higher_on_a_bool: Annotated[bool, Floor(safer="higher")]
        lower_on_a_string: Annotated[str, Floor(safer="lower")]
        optional_number: Annotated[float | None, Floor(safer="higher")] = None
        table_of_flags: dict[str, Annotated[bool, Floor(safer="lower")]]
        nested: Covered
        false_on_a_float: Annotated[float, Floor(safer="false")]
        narrower_on_a_float: Annotated[float, Floor(safer="narrower")]
        narrower_of_mixed_types: Annotated[tuple[time, date], Floor(safer="narrower")]
        window_of_numbers_as_text: Annotated[tuple[str, int], Floor(safer="wider")]
        fine_flag: Annotated[bool, Floor(safer="true")]
        fine_false_flag: Annotated[bool, Floor(safer="false")]
        fine_narrow_window: Annotated[tuple[time, time], Floor(safer="narrower")]
        fine_text_window: Annotated[tuple[str, str], Floor(safer="wider")]
        fine_window: Annotated[tuple[time, time], Floor(safer="wider")]
        fine_duration: Annotated[timedelta, Floor(safer="higher")]
        fine_table: dict[str, Annotated[float, Floor(safer="higher")]]

    class MisfitNested(RulesetSection):
        inner: Misfit

    assert floor_misfits(Misfit) == [
        "flag_on_a_float",
        "window_on_a_float",
        "window_of_unknown_length",
        "window_of_mixed_types",
        "higher_on_a_bool",
        "lower_on_a_string",
        "optional_number",
        "table_of_flags",
        "false_on_a_float",
        "narrower_on_a_float",
        "narrower_of_mixed_types",
        "window_of_numbers_as_text",
    ]
    assert floor_misfits(MisfitNested)[0] == "inner.flag_on_a_float"


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
