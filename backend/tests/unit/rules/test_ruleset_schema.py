import tomllib
from datetime import date, time
from typing import Any

import pytest
from pydantic import ValidationError

from stellar_blaze.domain.physics.niosh import Clothing
from stellar_blaze.domain.rules.ruleset import Ruleset, TwlZones
from tests.unit.rules.support import seed_dict, set_path

pytestmark = pytest.mark.unit


def test_the_seed_validates() -> None:
    ruleset = Ruleset.model_validate(seed_dict())
    assert ruleset.meta.id == "ae-heat-0.1"
    assert ruleset.meta.status == "released"
    assert ruleset.meta.effective_from == date(2024, 1, 1)
    assert ruleset.meta.effective_to is None
    assert ruleset.meta.supersedes == ()
    assert {s.id for s in ruleset.sources} == {"niosh-2016", "adosh-twl", "meteohazard-5633d57", "adr-0006"}
    assert ruleset.twl_withdrawal.enabled is False
    assert set(ruleset.tunables) == {"twl_margin_w_m2"}


def test_every_source_of_the_seed_says_where_it_was_read() -> None:
    for source in Ruleset.model_validate(seed_dict()).sources:
        assert source.title
        assert source.url
        assert source.accessed == date(2026, 11, 11)


@pytest.mark.parametrize(
    "path",
    [
        (),
        ("meta",),
        ("sources", 0),
        ("niosh_clothing",),
        ("twl_zones",),
        ("twl_withdrawal",),
        ("tunables", "twl_margin_w_m2"),
    ],
    ids=lambda path: ".".join(map(str, path)) or "top-level",
)
def test_an_unknown_key_anywhere_is_rejected(path: tuple[str | int, ...]) -> None:
    raw = seed_dict()
    set_path(raw, (*path, "surprise"), 1)
    with pytest.raises(ValidationError, match="surprise"):
        Ruleset.model_validate(raw)


def test_a_clothing_ensemble_the_code_does_not_know_is_rejected() -> None:
    raw = seed_dict()
    raw["niosh_clothing"]["values_c"]["invisibility_cloak"] = 4.0
    with pytest.raises(ValidationError, match="invisibility_cloak"):
        Ruleset.model_validate(raw)


def test_a_missing_clothing_ensemble_is_rejected() -> None:
    raw = seed_dict()
    del raw["niosh_clothing"]["values_c"]["sms_coveralls"]
    with pytest.raises(ValidationError, match="sms_coveralls"):
        Ruleset.model_validate(raw)


def test_the_clothing_table_has_exactly_the_clothing_enum_keys() -> None:
    values = Ruleset.model_validate(seed_dict()).niosh_clothing.values_c
    assert set(values) == {c.value for c in Clothing}


def test_a_negative_clothing_adjustment_is_rejected() -> None:
    # effective_wbgt_c refuses a negative adjustment; the ruleset must not be able to carry one.
    raw = seed_dict()
    raw["niosh_clothing"]["values_c"]["work_clothes"] = -1.0
    with pytest.raises(ValidationError, match="work_clothes"):
        Ruleset.model_validate(raw)


@pytest.mark.parametrize(
    "section",
    [("niosh_clothing",), ("twl_zones",), ("twl_withdrawal",), ("tunables", "twl_margin_w_m2")],
    ids=lambda path: ".".join(path),
)
def test_a_section_citing_an_undeclared_source_is_rejected(section: tuple[str, ...]) -> None:
    raw = seed_dict()
    set_path(raw, (*section, "source"), "no-such-source")
    with pytest.raises(ValidationError, match="no-such-source"):
        Ruleset.model_validate(raw)


def test_duplicate_source_ids_are_rejected() -> None:
    raw = seed_dict()
    raw["sources"].append(dict(raw["sources"][0]))
    with pytest.raises(ValidationError, match="niosh-2016"):
        Ruleset.model_validate(raw)


@pytest.mark.parametrize(
    ("low", "medium"),
    [(115.0, 140.0), (140.0, 140.0), (0.0, -1.0), (140.0, 0.0)],
)
def test_zone_edges_must_descend_and_be_positive(low: float, medium: float) -> None:
    raw = seed_dict()
    raw["twl_zones"]["low_min_w_m2"] = low
    raw["twl_zones"]["medium_min_w_m2"] = medium
    with pytest.raises(ValidationError):
        Ruleset.model_validate(raw)


def test_a_toml_time_without_seconds_is_not_toml_1_0() -> None:
    # ADR 0009 section 1: rulesets write times as 12:30:00, because TOML 1.0 (Python 3.13 tomllib) requires seconds.
    with pytest.raises(tomllib.TOMLDecodeError):
        tomllib.loads("ban_start = 12:30")
    assert tomllib.loads("ban_start = 12:30:00") == {"ban_start": time(12, 30)}


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")], ids=["nan", "inf", "-inf"])
@pytest.mark.parametrize(
    "path",
    [
        ("twl_zones", "low_min_w_m2"),
        ("twl_zones", "medium_min_w_m2"),
        ("twl_withdrawal", "dry_bulb_c"),
        ("twl_withdrawal", "natural_wet_bulb_c"),
        ("twl_withdrawal", "cap_w_m2"),
        ("niosh_clothing", "values_c", "sms_coveralls"),
        ("tunables", "twl_margin_w_m2", "default"),
        ("tunables", "twl_margin_w_m2", "min"),
        ("tunables", "twl_margin_w_m2", "max"),
    ],
    ids=lambda path: ".".join(path),
)
def test_non_finite_numbers_are_rejected(path: tuple[str, ...], bad: float) -> None:
    # TOML has `nan` and `inf` literals; a NaN limit compares false with everything and would switch a floor off.
    raw = seed_dict()
    set_path(raw, path, bad)
    with pytest.raises(ValidationError):
        Ruleset.model_validate(raw)


@pytest.mark.parametrize("ruleset_id", ["ae-heat-0.1", "ae-heat-2026.1", "ae-heat-2027.12"])
def test_ruleset_ids_that_follow_the_naming_scheme(ruleset_id: str) -> None:
    raw = seed_dict()
    raw["meta"]["id"] = ruleset_id
    assert Ruleset.model_validate(raw).meta.id == ruleset_id


@pytest.mark.parametrize(
    "ruleset_id",
    [
        "AE-heat-2026.1",
        "ae-heat-26.1",
        "ae-heat-2026",
        "ae-heat-2026.",
        "ae-cold-2026.1",
        "a-heat-2026.1",
        "ae-heat-1.1",
        "",
    ],
)
def test_ruleset_ids_that_break_the_naming_scheme(ruleset_id: str) -> None:
    raw = seed_dict()
    raw["meta"]["id"] = ruleset_id
    with pytest.raises(ValidationError, match="id"):
        Ruleset.model_validate(raw)


def test_the_effective_range_must_not_be_empty() -> None:
    raw = seed_dict()
    raw["meta"]["effective_to"] = date(2024, 1, 1)
    with pytest.raises(ValidationError, match="effective_to"):
        Ruleset.model_validate(raw)


def test_a_ruleset_cannot_supersede_itself() -> None:
    raw = seed_dict()
    raw["meta"]["supersedes"] = ["ae-heat-0.1"]
    with pytest.raises(ValidationError, match="supersede itself"):
        Ruleset.model_validate(raw)


@pytest.mark.parametrize(
    ("default", "low", "high"),
    [(21.0, 0.0, 20.0), (-0.1, 0.0, 20.0), (5.0, 10.0, 20.0), (5.0, 20.0, 0.0)],
)
def test_a_tunable_default_must_lie_in_its_range(default: float, low: float, high: float) -> None:
    raw = seed_dict()
    raw["tunables"]["twl_margin_w_m2"].update(default=default, min=low, max=high)
    with pytest.raises(ValidationError):
        Ruleset.model_validate(raw)


def test_a_tunable_needs_a_direction() -> None:
    raw = seed_dict()
    raw["tunables"]["twl_margin_w_m2"]["safer"] = "sideways"
    with pytest.raises(ValidationError, match="safer"):
        Ruleset.model_validate(raw)


def test_a_ruleset_field_that_is_not_a_section_is_refused_when_a_file_is_loaded() -> None:
    class Loose(Ruleset):
        labour: TwlZones | None = None  # an Optional section would escape the source check

    raw = seed_dict()
    raw["labour"] = {"source": "adosh-twl", "low_min_w_m2": 140.0, "medium_min_w_m2": 115.0}
    with pytest.raises(ValidationError, match="labour is neither a RulesetSection"):
        Loose.model_validate(raw)


def test_a_section_added_to_the_schema_gets_the_same_source_check() -> None:
    class Wider(Ruleset):
        labour: TwlZones

    raw = seed_dict()
    raw["labour"] = {"source": "no-such-source", "low_min_w_m2": 140.0, "medium_min_w_m2": 115.0}
    with pytest.raises(ValidationError, match="labour cites source 'no-such-source'"):
        Wider.model_validate(raw)
    raw["labour"]["source"] = "adosh-twl"
    assert Wider.model_validate(raw).labour.low_min_w_m2 == 140.0


def test_rulesets_are_immutable() -> None:
    ruleset = Ruleset.model_validate(seed_dict())
    with pytest.raises(ValidationError, match="frozen"):
        ruleset.twl_zones.low_min_w_m2 = 100.0  # type: ignore[misc]
    with pytest.raises(ValidationError, match="frozen"):
        ruleset.meta.status = "draft"  # type: ignore[misc]


def test_covers_uses_an_inclusive_start_and_an_exclusive_end() -> None:
    raw: dict[str, Any] = seed_dict()
    raw["meta"]["effective_to"] = date(2026, 6, 1)
    ruleset = Ruleset.model_validate(raw)
    assert not ruleset.covers(date(2023, 12, 31))
    assert ruleset.covers(date(2024, 1, 1))
    assert ruleset.covers(date(2026, 5, 31))
    assert not ruleset.covers(date(2026, 6, 1))
    assert Ruleset.model_validate(seed_dict()).covers(date(2099, 1, 1))
