"""The risk policy the device needs, projected from the ruleset and the effective tunables (ADR 0049, ADR 0050).

``RiskPolicyData`` maps 1:1 onto the frozen API model ``stellar_blaze.api.models.RiskPolicy`` (the domain does not
import the api layer; ``tests/unit/api/test_risk_policy_data.py`` validates the model from ``dataclasses.asdict`` of
this one, so a drift fails a test). The device computes the personal level with it (F1 ``personal.ts``).
"""

from dataclasses import dataclass

from stellar_blaze.domain.config.runtime import EffectiveParams
from stellar_blaze.domain.physics.niosh import Clothing
from stellar_blaze.domain.risk.levels import AlertLevel
from stellar_blaze.domain.rules.ruleset import Ruleset, RulesetIncompleteError

_WORKLOAD_ORDER = ("light", "moderate", "heavy")


@dataclass(frozen=True)
class RiskBandData:
    """A personal level and the smallest exceedance probability, 0 to 0.95, at which it applies (inclusive)."""

    level: AlertLevel
    min_exceedance_probability: float


@dataclass(frozen=True)
class WorkloadClassData:
    """A workload class and its metabolic rate in watts."""

    code: str
    metabolic_rate_w: float


@dataclass(frozen=True)
class ClothingOptionData:
    """A clothing option, its NIOSH WBGT adjustment in degrees Celsius and where the adjustment comes from."""

    code: str
    adjustment_c: float
    source: str


@dataclass(frozen=True)
class RiskPolicyData:
    """What the device needs to compute a personal level; one field per field of ``api.models.RiskPolicy``."""

    version: str
    config_version: int
    k_suppression: int
    k_health: int
    acclimatisation_days_required: int
    bands: tuple[RiskBandData, ...]
    workload_classes: tuple[WorkloadClassData, ...]
    clothing_options: tuple[ClothingOptionData, ...]


def risk_policy(ruleset: Ruleset, params: EffectiveParams, config_version: int) -> RiskPolicyData:
    """The policy of ``ruleset`` under ``params``.

    Bands: green at 0, then the three personal-band tunables (strictly increasing, the largest at most 0.95, which
    ``resolve_effective`` and the tunable ranges guarantee). ``k_suppression`` is ``params.k_exposure`` under its device
    name (ADR 0050). The acclimatization days are the planner's heavy-work rule (ADR 0049 decision 5).

    Raises:
        RulesetIncompleteError: The ruleset predates the ``acclimatisation`` or ``workload`` section.
    """
    acclimatisation, workload = ruleset.acclimatisation, ruleset.workload
    if acclimatisation is None or workload is None:
        missing = [
            name for name, section in (("acclimatisation", acclimatisation), ("workload", workload)) if section is None
        ]
        raise RulesetIncompleteError(f"ruleset {ruleset.meta.id} has no section {', '.join(missing)}")
    bands = (
        RiskBandData(AlertLevel.GREEN, 0.0),
        RiskBandData(AlertLevel.AMBER, params.personal_band_amber),
        RiskBandData(AlertLevel.ORANGE, params.personal_band_orange),
        RiskBandData(AlertLevel.RED, params.personal_band_red),
    )
    return RiskPolicyData(
        version=ruleset.meta.id,
        config_version=config_version,
        k_suppression=params.k_exposure,
        k_health=params.k_health,
        acclimatisation_days_required=acclimatisation.heavy_work_after_days,
        bands=bands,
        workload_classes=tuple(WorkloadClassData(code, workload.metabolic_w[code]) for code in _WORKLOAD_ORDER),
        clothing_options=tuple(
            ClothingOptionData(c.value, ruleset.niosh_clothing.values_c[c.value], ruleset.niosh_clothing.source)
            for c in Clothing
        ),
    )
