import dataclasses
import tomllib

import pytest

from stellar_blaze.domain.plans.rules import PlannerRules, planner_rules
from stellar_blaze.domain.risk.levels import Zone
from stellar_blaze.domain.rules.ruleset import Ruleset, RulesetIncompleteError
from tests.unit.risk.support import default_params, released_ruleset
from tests.unit.rules.support import SEED_PATH

pytestmark = pytest.mark.unit


def _rules(**changes: int) -> PlannerRules:
    params = dataclasses.replace(default_params(), **changes)
    return planner_rules(released_ruleset(), params)


def test_planner_rules_caps() -> None:
    rules = _rules()
    assert rules.cap_minutes(Zone.LOW, "light") == 60
    assert rules.cap_minutes(Zone.LOW, "heavy") == 60
    assert rules.cap_minutes(Zone.MEDIUM, "light") == 60
    assert rules.cap_minutes(Zone.MEDIUM, "heavy") == 45
    assert rules.cap_minutes(Zone.MEDIUM, "moderate") == 45
    assert rules.cap_minutes(Zone.HIGH, "light") == 45
    assert rules.cap_minutes(Zone.HIGH, "heavy") == 20
    assert rules.cap_minutes(Zone.HIGH, "moderate") == 20  # moderate uses the heavy column
    assert rules.cap_minutes(Zone.RED, "light") == 0
    assert rules.cap_minutes(Zone.RED, "heavy") == 0


def test_planner_rules_cycles() -> None:
    rules = _rules()
    assert rules.cycle(Zone.HIGH, "heavy") == (20, 40)
    assert rules.cycle(Zone.HIGH, "moderate") == (20, 40)
    assert rules.cycle(Zone.HIGH, "light") == (45, 15)
    assert rules.cycle(Zone.MEDIUM, "heavy") == (45, 15)
    assert rules.cycle(Zone.MEDIUM, "moderate") == (45, 15)
    assert rules.cycle(Zone.MEDIUM, "light") is None  # self-paced
    assert rules.cycle(Zone.LOW, "heavy") is None
    assert rules.cycle(Zone.LOW, "light") is None
    assert rules.cycle(Zone.RED, "heavy") is None  # a stop is not a cycle


def test_voluntary_low_rest_lowers_the_low_cap() -> None:
    rules = _rules(low_zone_voluntary_rest_min=10)
    assert rules.cap_minutes(Zone.LOW, "heavy") == 50
    assert rules.cap_minutes(Zone.MEDIUM, "light") == 60  # only the Low zone has the voluntary rest
    assert rules.cap_minutes(Zone.HIGH, "heavy") == 20


def test_planner_rules_carry_the_ruleset_values() -> None:
    rules = _rules()
    ruleset = released_ruleset()
    assert rules.labour == ruleset.labour
    assert rules.acclimatisation == ruleset.acclimatisation
    assert rules.lone_work_min_headcount == 2
    assert rules.low_zone_voluntary_rest_min == 0


def test_planner_rules_are_frozen_and_equal_for_equal_inputs() -> None:
    assert _rules() == _rules()
    with pytest.raises(dataclasses.FrozenInstanceError):
        _rules().lone_work_min_headcount = 3  # type: ignore[misc]


def test_cap_minutes_accepts_zone_values_as_ints() -> None:
    assert _rules().cap_minutes(2, "heavy") == 20  # type: ignore[arg-type]


def test_planner_rules_need_the_b3_sections() -> None:
    seed = Ruleset.model_validate(tomllib.loads(SEED_PATH.read_text(encoding="utf-8")))
    with pytest.raises(RulesetIncompleteError):
        planner_rules(seed, default_params())


def test_when_moderate_does_not_use_heavy_it_reads_the_light_column() -> None:
    ruleset = released_ruleset()
    assert ruleset.adosh_cycles is not None
    light = ruleset.model_copy(
        update={"adosh_cycles": ruleset.adosh_cycles.model_copy(update={"moderate_uses_heavy": False})}
    )
    rules = planner_rules(light, default_params())
    assert rules.cap_minutes(Zone.HIGH, "moderate") == 45
    assert rules.cycle(Zone.HIGH, "moderate") == (45, 15)
