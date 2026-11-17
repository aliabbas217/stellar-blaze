"""The domain's ``RiskPolicyData`` must map 1:1 onto the frozen API model ``RiskPolicy`` (v1 contract)."""

import dataclasses

import pytest

from stellar_blaze.api.models import RiskPolicy
from stellar_blaze.domain.risk.policy import RiskPolicyData, risk_policy
from tests.unit.risk.support import default_params, released_ruleset

pytestmark = pytest.mark.unit


def test_risk_policy_data_validates_against_the_frozen_api_model() -> None:
    data = risk_policy(released_ruleset(), default_params(), 3)
    model = RiskPolicy.model_validate(dataclasses.asdict(data))
    assert model.version == "ae-heat-2026.1"
    assert model.config_version == 3
    assert (model.k_suppression, model.k_health, model.acclimatisation_days_required) == (5, 10, 7)
    assert [b.level.value for b in model.bands] == ["green", "amber", "orange", "red"]
    assert [w.code for w in model.workload_classes] == ["light", "moderate", "heavy"]
    assert len(model.clothing_options) == 6


def test_the_dataclass_and_the_model_have_the_same_fields() -> None:
    # Drift guard: a field added to one side and not the other fails here (ApiResponse forbids unknown members too).
    assert {f.name for f in dataclasses.fields(RiskPolicyData)} == set(RiskPolicy.model_fields)
