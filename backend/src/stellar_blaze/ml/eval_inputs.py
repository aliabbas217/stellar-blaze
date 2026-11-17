"""What the offline scoring needs from the config and the files, behind ``ml/`` so the jobs reach no adapter directly.

The ruleset, its frozen effective tunables (the ruleset defaults: margin 7, Red edge 85; never the live config, so a
later tuning cannot leak into a scored row, ADR 0048), the demo-site fixture, the released model's sampler and the
corrected OMAA series of the forecast part. Each function raises a plain exception that names what is wrong.
"""

from pathlib import Path

from stellar_blaze.adapters.compute.lgbm_corrector import LightGbmCorrector
from stellar_blaze.adapters.config.rulesets import load_catalog
from stellar_blaze.adapters.config.site_fixture import load_site_fixture
from stellar_blaze.domain.config.runtime import EffectiveParams, RuntimeConfig, resolve_effective
from stellar_blaze.domain.plans.model import CrewMember, CrewSpec
from stellar_blaze.domain.rules.catalog import LoadedRuleset
from stellar_blaze.ml.serving_path import load_released_model
from stellar_blaze.ports.corrector import ForecastCorrector
from stellar_blaze.ports.sites import SiteFixture

__all__ = ["crew_spec", "frozen_params", "load_fixture", "load_frozen_ruleset", "released_sampler"]


def load_frozen_ruleset(rulesets_dir: Path, ruleset_id: str) -> LoadedRuleset:
    """The released ruleset ``ruleset_id`` (drafts are refused) with the SHA-256 of its file.

    Raises:
        KeyError: No such ruleset in ``rulesets_dir``.
    """
    return load_catalog(rulesets_dir, allow_drafts=False).get(ruleset_id)


def frozen_params(ruleset: LoadedRuleset) -> EffectiveParams:
    """The ruleset's default tunables (the frozen values the freeze addendum records).

    Raises:
        ValueError: The defaults do not resolve against the ruleset.
    """
    resolved = resolve_effective(RuntimeConfig(), ruleset.ruleset)
    if not isinstance(resolved, EffectiveParams):
        raise ValueError("the ruleset's default tunables do not resolve: " + "; ".join(v.message for v in resolved))
    return resolved


def load_fixture(path: Path) -> SiteFixture:
    """The demo-site fixture (``backend/fixtures/demo_site.toml``)."""
    return load_site_fixture(path)


def crew_spec(fixture: SiteFixture, crew_id: str) -> CrewSpec:
    """The planner's ``CrewSpec`` of one crew of the fixture (``headcount`` is the member count).

    Raises:
        KeyError: The fixture has no such crew.
    """
    for crew in fixture.crews:
        if crew.id == crew_id:
            members = tuple(
                CrewMember(m.days_on_site, m.days_away, m.away_reason, m.experienced, m.juvenile) for m in crew.members
            )
            return CrewSpec(
                crew_id=crew.id,
                employer_id=fixture.site.employer_id,
                workload=crew.workload,
                headcount=len(members),
                shift=crew.shift,
                days_per_week=crew.days_per_week,
                members=members,
            )
    raise KeyError(f"the fixture has no crew {crew_id!r}")


def released_sampler(models_dir: Path, model_id: str) -> ForecastCorrector:
    """The released model as a ``ForecastCorrector`` (its ``sample`` draws from the stored copulas)."""
    return LightGbmCorrector.load(load_released_model(models_dir, model_id))
