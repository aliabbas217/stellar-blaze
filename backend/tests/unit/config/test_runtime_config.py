"""ADR 0010: the runtime configuration schema, its canonical hash, resolution against a ruleset, and validation."""

import dataclasses
import hashlib
import json
import tomllib
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from pydantic import JsonValue, ValidationError

from stellar_blaze.adapters.config.models import scan_models
from stellar_blaze.adapters.config.runtime_file import load_runtime_config_file
from stellar_blaze.domain.config.models import ModelRegistry
from stellar_blaze.domain.config.runtime import (
    ConfigViolation,
    EffectiveParams,
    RuntimeConfig,
    RuntimeFlags,
    Tunables,
    body_sha256,
    config_body,
    config_sha256,
    resolve_effective,
    validate_runtime_config,
)
from stellar_blaze.domain.rules.catalog import NoRulesetError, RulesetCatalog
from stellar_blaze.domain.rules.ruleset import Ruleset
from tests.unit.rules.support import BACKEND_ROOT, loaded, make_ruleset, ruleset_dict, set_path

pytestmark = pytest.mark.unit

DEFAULT_FILE = BACKEND_ROOT / "config" / "runtime" / "default.toml"
FIXTURE_MODELS = BACKEND_ROOT / "tests" / "fixtures" / "models"
MODEL = "corrector-20261112-0000000-000001"
RELEASED_MODEL = (
    "corrector-20261114-d327987-6edafa"  # the released model of the protocol lock; the product default pins it
)
TODAY = date(2026, 11, 11)

SEED = make_ruleset()
SEED_CATALOG = RulesetCatalog([loaded(SEED)])

# What the test seed resolves to with nothing set: margin 0.0 (the seed's) and the B3 tunables at ae-heat-2026.1 values.
SEED_EFFECTIVE = EffectiveParams(
    twl_margin_w_m2=0.0,
    warning_theta=0.10,
    red_twl_w_m2=85.0,
    personal_band_amber=0.10,
    personal_band_orange=0.50,
    personal_band_red=0.90,
    deescalation_dwell_minutes=60,
    alert_lead_hours=12,
    alert_dispatch_interval_minutes=5,
    forecast_stale_after_hours=30,
    k_health=10,
    k_exposure=5,
    low_zone_voluntary_rest_min=0,
)


def models() -> ModelRegistry:
    return scan_models(FIXTURE_MODELS)


def config(**fields: Any) -> RuntimeConfig:
    return RuntimeConfig.model_validate(fields)


def validate(c: RuntimeConfig, *, catalog: RulesetCatalog = SEED_CATALOG, prod: bool = False) -> list[ConfigViolation]:
    return validate_runtime_config(c, catalog=catalog, models=models(), today=TODAY, prod=prod)


def codes(violations: list[ConfigViolation]) -> list[tuple[str, str]]:
    return [(v.code, v.path) for v in violations]


# --- schema and hash ---------------------------------------------------------------------------------------------


def test_the_default_file_pins_only_the_released_model_and_the_preregistered_warning_theta() -> None:
    # theta_protect = 0.30 (freeze addendum section 2; ADR 0048 section 3) and the released model are the two values
    # that move off "unset". Everything else is unset, so it stays "the ruleset default". Without the model pin the
    # corrector is absent and the demo day is served uncorrected.
    loaded_config = load_runtime_config_file(DEFAULT_FILE)
    assert loaded_config == RuntimeConfig(model_id=RELEASED_MODEL, tunables=Tunables(warning_theta=0.30))
    assert loaded_config != RuntimeConfig()
    assert loaded_config.ruleset_pin is None
    assert loaded_config.model_id == RELEASED_MODEL
    assert loaded_config.tunables == Tunables(warning_theta=0.30)
    assert loaded_config.flags == RuntimeFlags()
    # 0.30 is inside the seed ruleset's [0.05, 0.50] for warning_theta; the model is the committed release (the
    # fixture registry used by the other tests in this file does not hold it, so this one scans backend/models/).
    released = scan_models(BACKEND_ROOT / "models")
    assert validate_runtime_config(loaded_config, catalog=SEED_CATALOG, models=released, today=TODAY, prod=False) == []
    assert codes(validate(loaded_config)) == [("unknown-model", "model_id")]  # not in the FIXTURE registry: by design


def test_the_default_file_has_the_schema_version_the_pinned_model_and_theta_and_an_empty_flags_table() -> None:
    assert tomllib.loads(DEFAULT_FILE.read_text(encoding="utf-8")) == {
        "schema_version": 1,
        "model_id": RELEASED_MODEL,
        "tunables": {"warning_theta": 0.30},
        "flags": {},
    }


def test_the_canonical_hash_is_the_documented_formula() -> None:
    # The sha256 is stored with every config version and every decision (ADR 0010 section 3): the formula is contract.
    # B3 added twelve tunables (null here), so the body gained twelve null keys and the seed config's hash moved once.
    canonical = (
        b'{"flags":{},"model_id":null,"ruleset_pin":null,"schema_version":1,"tunables":{'
        b'"alert_dispatch_interval_minutes":null,"alert_lead_hours":null,"deescalation_dwell_minutes":null,'
        b'"forecast_stale_after_hours":null,"k_exposure":null,"k_health":null,"low_zone_voluntary_rest_min":null,'
        b'"personal_band_amber":null,"personal_band_orange":null,"personal_band_red":null,"red_twl_w_m2":null,'
        b'"twl_margin_w_m2":null,"warning_theta":null}}'
    )
    assert config_sha256(RuntimeConfig()) == hashlib.sha256(canonical).hexdigest()


def test_the_hash_is_stable_across_two_loads() -> None:
    first = config_sha256(load_runtime_config_file(DEFAULT_FILE))
    second = config_sha256(load_runtime_config_file(DEFAULT_FILE))
    assert first == second
    assert len(first) == 64
    assert first == config_sha256(config(model_id=RELEASED_MODEL, tunables={"warning_theta": 0.30}))
    assert first != config_sha256(RuntimeConfig())  # the pinned model and theta are part of the hashed body


def test_the_hash_does_not_depend_on_key_order(tmp_path: Path) -> None:
    ordered = tmp_path / "ordered.toml"
    reversed_ = tmp_path / "reversed.toml"
    ordered.write_text(
        'schema_version = 1\nruleset_pin = "ae-heat-0.1"\nmodel_id = "m"\n[tunables]\ntwl_margin_w_m2 = 7.0\n[flags]\n',
        encoding="utf-8",
    )
    reversed_.write_text(
        'model_id = "m"\nruleset_pin = "ae-heat-0.1"\nschema_version = 1\n[flags]\n[tunables]\ntwl_margin_w_m2 = 7.0\n',
        encoding="utf-8",
    )
    assert config_sha256(load_runtime_config_file(ordered)) == config_sha256(load_runtime_config_file(reversed_))


def test_any_change_changes_the_hash() -> None:
    base = config_sha256(RuntimeConfig())
    assert config_sha256(config(ruleset_pin="ae-heat-0.1")) != base
    assert config_sha256(config(model_id=MODEL)) != base
    assert config_sha256(config(tunables={"twl_margin_w_m2": 0.0})) != base  # an explicit 0.0 is not "unset"


def test_an_integer_tunable_equals_the_same_float() -> None:
    assert config_sha256(config(tunables={"twl_margin_w_m2": 7})) == config_sha256(
        config(tunables={"twl_margin_w_m2": 7.0})
    )


def test_an_undeclared_tunable_key_is_a_schema_error() -> None:
    with pytest.raises(ValidationError, match="surprise"):
        config(tunables={"surprise": 1.0})


def test_an_undeclared_flag_is_a_schema_error() -> None:
    # B1 has no runtime flag: each flag is added together with the code it gates (ADR 0010 section 3).
    with pytest.raises(ValidationError, match="surprise"):
        config(flags={"surprise": True})


@pytest.mark.parametrize("key", ["twl_zones", "twl_withdrawal", "niosh_clothing", "low_min_w_m2"])
def test_a_floor_cannot_be_set_through_the_runtime_config(key: str) -> None:
    with pytest.raises(ValidationError, match=key):
        config(**{key: {"low_min_w_m2": 100.0}})


def test_the_schema_version_is_one() -> None:
    assert RuntimeConfig().schema_version == 1
    with pytest.raises(ValidationError, match="schema_version"):
        config(schema_version=2)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), "nan", "inf"])
def test_a_non_finite_tunable_is_a_schema_error(bad: Any) -> None:
    with pytest.raises(ValidationError):
        config(tunables={"twl_margin_w_m2": bad})


def test_the_runtime_config_is_immutable() -> None:
    c = RuntimeConfig()
    with pytest.raises(ValidationError, match="frozen"):
        c.model_id = "x"  # type: ignore[misc]
    with pytest.raises(ValidationError, match="frozen"):
        c.tunables.twl_margin_w_m2 = 1.0  # type: ignore[misc]


def test_the_effective_parameters_have_one_field_per_tunable() -> None:
    # resolve_effective builds EffectiveParams explicitly; this keeps the two lists in step when B3 adds a tunable.
    assert {f.name for f in dataclasses.fields(EffectiveParams)} == set(Tunables.model_fields)


# --- resolution against a ruleset --------------------------------------------------------------------------------


def test_an_unset_tunable_takes_the_ruleset_default() -> None:
    assert resolve_effective(RuntimeConfig(), SEED) == SEED_EFFECTIVE


def test_a_set_tunable_inside_its_range_resolves_to_itself() -> None:
    assert resolve_effective(config(tunables={"twl_margin_w_m2": 7.0}), SEED) == dataclasses.replace(
        SEED_EFFECTIVE, twl_margin_w_m2=7.0
    )


@pytest.mark.parametrize("value", [0.0, 20.0])
def test_the_range_ends_are_inside_the_range(value: float) -> None:
    assert resolve_effective(config(tunables={"twl_margin_w_m2": value}), SEED) == dataclasses.replace(
        SEED_EFFECTIVE, twl_margin_w_m2=value
    )


@pytest.mark.parametrize("value", [25.0, -1.0, 20.000001, -0.000001])
def test_a_tunable_outside_its_range_is_out_of_range(value: float) -> None:
    result = resolve_effective(config(tunables={"twl_margin_w_m2": value}), SEED)
    assert isinstance(result, list)
    assert codes(result) == [("out-of-range", "tunables.twl_margin_w_m2")]
    assert "[0.0, 20.0]" in result[0].message


def test_a_tunable_the_ruleset_does_not_declare_is_unknown_when_set_and_when_unset() -> None:
    raw = ruleset_dict()
    raw["tunables"] = {}
    bare = Ruleset.model_validate(raw)
    set_result = resolve_effective(config(tunables={"twl_margin_w_m2": 1.0}), bare)
    assert isinstance(set_result, list)
    # Every tunable the schema has is unknown to a ruleset that declares none: the one that was set, and the others.
    every = [("unknown-tunable", f"tunables.{name}") for name in Tunables.model_fields]
    assert codes(set_result) == every
    assert "is not declared by" in set_result[0].message
    assert all("has no default in" in v.message for v in set_result[1:])
    # Unset means "the ruleset default"; a ruleset without one cannot supply it.
    unset_result = resolve_effective(RuntimeConfig(), bare)
    assert isinstance(unset_result, list)
    assert codes(unset_result) == every


# --- validation ---------------------------------------------------------------------------------------------------


def test_the_default_config_is_valid_in_dev_and_prod() -> None:
    assert validate(RuntimeConfig()) == []
    assert validate(RuntimeConfig(), prod=True) == []


def test_a_model_the_registry_does_not_hold_is_unknown() -> None:
    violations = validate(config(model_id="corrector-20990101-0000000-000000"))
    assert codes(violations) == [("unknown-model", "model_id")]
    assert MODEL in violations[0].message
    assert validate(config(model_id=MODEL)) == []


def test_a_pin_to_an_unknown_ruleset_names_the_known_ids() -> None:
    for prod in (False, True):
        violations = validate(config(ruleset_pin="ae-heat-9999.9"), prod=prod)
        assert codes(violations) == [("unknown-ruleset", "ruleset_pin")]
        assert "ae-heat-0.1" in violations[0].message


def test_an_out_of_range_tunable_is_reported_through_validation() -> None:
    assert codes(validate(config(tunables={"twl_margin_w_m2": 25.0}))) == [("out-of-range", "tunables.twl_margin_w_m2")]
    assert validate(config(tunables={"twl_margin_w_m2": 7.0})) == []


def test_every_violation_is_reported_together() -> None:
    violations = validate(config(model_id="corrector-20990101-0000000-000000", tunables={"twl_margin_w_m2": -1.0}))
    assert codes(violations) == [("unknown-model", "model_id"), ("out-of-range", "tunables.twl_margin_w_m2")]


OLD = "ae-heat-2024.1"
NEW = "ae-heat-2026.1"


def tightened_catalog(*, old_status: str = "released", new_low_edge: float = 150.0) -> RulesetCatalog:
    """OLD (the seed's floors) and NEW, which supersedes it with a higher low zone edge, both open-ended."""
    new_raw = ruleset_dict(NEW, supersedes=(OLD,))
    set_path(new_raw, ("twl_zones", "low_min_w_m2"), new_low_edge)
    return RulesetCatalog([loaded(make_ruleset(OLD, status=old_status)), loaded(Ruleset.model_validate(new_raw))])


def test_in_prod_a_pin_must_cover_today() -> None:
    catalog = RulesetCatalog(
        [
            loaded(make_ruleset(OLD, effective_from=date(2024, 1, 1), effective_to=date(2026, 6, 1))),
            loaded(make_ruleset(NEW, effective_from=date(2026, 6, 1))),
        ]
    )
    prod = validate(config(ruleset_pin=OLD), catalog=catalog, prod=True)
    assert codes(prod) == [("pin-out-of-range", "ruleset_pin")]
    assert "2026-11-11" in prod[0].message
    assert validate(config(ruleset_pin=NEW), catalog=catalog, prod=True) == []


def test_in_dev_a_pin_may_be_for_another_date_so_back_tests_can_pin_history() -> None:
    # Each decision still resolves its own date through catalog.resolve, which raises PinOutOfRangeError for a date the
    # pin does not cover: the startup check only has to prove the pin exists.
    catalog = RulesetCatalog(
        [
            loaded(make_ruleset(OLD, effective_from=date(2024, 1, 1), effective_to=date(2026, 6, 1))),
            loaded(make_ruleset(NEW, effective_from=date(2026, 6, 1))),
        ]
    )
    assert validate(config(ruleset_pin=OLD), catalog=catalog, prod=False) == []


def test_in_prod_a_pin_must_not_relax_a_floor_of_the_ruleset_in_force_today() -> None:
    catalog = tightened_catalog()
    violations = validate(config(ruleset_pin=OLD), catalog=catalog, prod=True)
    assert codes(violations) == [("floor-violation", "ruleset_pin.twl_zones.low_min_w_m2")]
    assert "140" in violations[0].message
    assert "150" in violations[0].message
    assert validate(config(ruleset_pin=NEW), catalog=catalog, prod=True) == []


def test_in_prod_a_pin_with_the_same_floors_is_an_instant_rollback() -> None:
    catalog = tightened_catalog(new_low_edge=140.0)
    assert validate(config(ruleset_pin=OLD), catalog=catalog, prod=True) == []


def test_in_dev_floors_are_not_compared() -> None:
    assert validate(config(ruleset_pin=OLD), catalog=tightened_catalog(), prod=False) == []


def test_in_prod_a_draft_pin_is_refused() -> None:
    violations = validate(config(ruleset_pin=OLD), catalog=tightened_catalog(old_status="draft"), prod=True)
    assert codes(violations)[0] == ("unknown-ruleset", "ruleset_pin")
    assert "draft" in violations[0].message


def test_without_a_pin_there_is_nothing_to_compare_in_prod() -> None:
    assert validate(RuntimeConfig(), catalog=tightened_catalog(), prod=True) == []


def test_a_catalog_with_no_ruleset_for_today_fails_loudly_rather_than_validating() -> None:
    with pytest.raises(NoRulesetError):
        validate(RuntimeConfig(), catalog=RulesetCatalog([loaded(make_ruleset(effective_from=date(2027, 1, 1)))]))


def test_tunables_are_checked_against_the_pinned_ruleset_not_the_one_in_force() -> None:
    wide = ruleset_dict(OLD)
    narrow = ruleset_dict(NEW, supersedes=(OLD,))
    set_path(narrow, ("tunables", "twl_margin_w_m2", "max"), 5.0)
    catalog = RulesetCatalog([loaded(Ruleset.model_validate(wide)), loaded(Ruleset.model_validate(narrow))])
    c = config(tunables={"twl_margin_w_m2": 10.0})
    assert codes(validate(c, catalog=catalog)) == [("out-of-range", "tunables.twl_margin_w_m2")]
    assert validate(config(ruleset_pin=OLD, tunables={"twl_margin_w_m2": 10.0}), catalog=catalog) == []


# --- the hash of a stored body ------------------------------------------------------------------------------------


def test_body_sha256_is_the_canonical_json_formula_and_ignores_key_order() -> None:
    body: dict[str, JsonValue] = {"b": [1, 2.5, None], "a": {"y": True, "x": "é"}}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))

    assert canonical == r'{"a":{"x":"\u00e9","y":true},"b":[1,2.5,null]}'  # ASCII only, so the bytes never vary
    assert body_sha256(body) == hashlib.sha256(canonical.encode()).hexdigest()
    reordered: dict[str, JsonValue] = {"a": {"x": "é", "y": True}, "b": [1, 2.5, None]}
    assert body_sha256(reordered) == body_sha256(body)


def test_config_sha256_is_the_hash_of_the_config_body() -> None:
    for c in (RuntimeConfig(), config(tunables={"twl_margin_w_m2": 7.5}), config(model_id=MODEL, ruleset_pin="x")):
        assert config_body(c) == c.model_dump(mode="json")
        assert config_sha256(c) == body_sha256(config_body(c))
