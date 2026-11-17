import dataclasses
import tomllib
from typing import Any

import pytest

from stellar_blaze.domain.risk.levels import AlertLevel
from stellar_blaze.domain.risk.policy import RiskPolicyData, risk_policy
from stellar_blaze.domain.rules.ruleset import Ruleset, RulesetIncompleteError
from tests.unit.risk.support import default_params, released_ruleset
from tests.unit.rules.support import SEED_PATH

pytestmark = pytest.mark.unit


def _policy(config_version: int = 1, **changes: Any) -> RiskPolicyData:
    return risk_policy(released_ruleset(), dataclasses.replace(default_params(), **changes), config_version)


def test_policy_bands_are_increasing_and_max_le_095() -> None:
    policy = _policy()
    assert [(b.level, b.min_exceedance_probability) for b in policy.bands] == [
        (AlertLevel.GREEN, 0.0),
        (AlertLevel.AMBER, 0.10),
        (AlertLevel.ORANGE, 0.50),
        (AlertLevel.RED, 0.90),
    ]
    minimums = [b.min_exceedance_probability for b in policy.bands]
    assert minimums == sorted(minimums)
    assert len(set(minimums)) == len(minimums)
    assert max(minimums) <= 0.95  # the device's exceedance cannot resolve above its 0.95 lower bound (ADR 0049)


def test_policy_bands_follow_the_tunables() -> None:
    policy = _policy(personal_band_amber=0.2, personal_band_orange=0.6, personal_band_red=0.8)
    assert [b.min_exceedance_probability for b in policy.bands] == [0.0, 0.2, 0.6, 0.8]


def test_policy_k_fields() -> None:
    policy = _policy()
    assert policy.k_suppression == 5
    assert policy.k_health == 10
    assert policy.acclimatisation_days_required == 7
    tuned = _policy(k_exposure=8, k_health=12)
    assert tuned.k_suppression == 8  # RiskPolicy.k_suppression is k_exposure under its device name (ADR 0050)
    assert tuned.k_health == 12


def test_policy_identity() -> None:
    policy = _policy(config_version=42)
    assert policy.version == "ae-heat-2026.1"
    assert policy.config_version == 42


def test_policy_workload_classes() -> None:
    policy = _policy()
    assert [(w.code, w.metabolic_rate_w) for w in policy.workload_classes] == [
        ("light", 180.0),
        ("moderate", 300.0),
        ("heavy", 415.0),
    ]


def test_policy_clothing_options() -> None:
    policy = _policy()
    assert {c.code: c.adjustment_c for c in policy.clothing_options} == {
        "work_clothes": 0.0,
        "cloth_coveralls": 0.0,
        "double_layer_woven": 3.0,
        "sms_coveralls": 0.5,
        "polyolefin_coveralls": 1.0,
        "limited_use_vapor_barrier": 11.0,
    }
    assert {c.source for c in policy.clothing_options} == {"niosh-2016"}


def test_policy_is_a_frozen_value() -> None:
    policy = _policy()
    with pytest.raises(dataclasses.FrozenInstanceError):
        policy.k_health = 1  # type: ignore[misc]
    assert policy == _policy()


def test_policy_needs_the_b3_sections() -> None:
    seed = Ruleset.model_validate(tomllib.loads(SEED_PATH.read_text(encoding="utf-8")))
    with pytest.raises(RulesetIncompleteError):
        risk_policy(seed, default_params(), 1)
