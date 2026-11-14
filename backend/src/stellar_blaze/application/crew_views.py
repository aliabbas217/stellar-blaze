"""A crew's planned day as the routes show it: the validated plan, its segments, ack items, hash and sign-off state.

``plan_crew_day`` is the one place that runs ``day_plan`` and derives everything built on it, so the day-plan route, the
sign-off route and the sign-off state of the lists and timelines read the same plan. It never stores a sign-off.
"""

from dataclasses import dataclass
from datetime import date
from zoneinfo import ZoneInfo

from stellar_blaze.application.day_plan import DayPlanResult, PlanSegmentData, day_plan, plan_segments
from stellar_blaze.application.plan_review import AckItemData, SignoffState, ack_items, plan_hash, signoff_state
from stellar_blaze.application.runtime_config import ConfigSnapshot, ruleset_for
from stellar_blaze.application.services import Services
from stellar_blaze.application.site_day import SiteDay, effective_params
from stellar_blaze.domain.plans.model import CrewSpec
from stellar_blaze.domain.plans.rules import planner_rules
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from stellar_blaze.ports.plans import PlanSignoffRecord

__all__ = ["PlannedDay", "current_signoff", "plan_crew_day"]


@dataclass(frozen=True)
class PlannedDay:
    """A plan the validator passed, with the review data derived from it. ``state`` is the sign-off state."""

    crew: CrewSpec
    result: DayPlanResult
    segments: tuple[PlanSegmentData, ...]
    ack: tuple[AckItemData, ...]
    plan_hash: str
    latest_signoff: PlanSignoffRecord | None
    state: SignoffState
    k_exposure: int
    ruleset_id: str


async def current_signoff(
    services: Services, crew_id: str, local_date: date, epoch_id: int
) -> PlanSignoffRecord | None:
    """The latest sign-off of the crew for the date in the epoch (epoch-scoped)."""
    return await services.signoffs.latest(crew_id, local_date, epoch_id)


async def plan_crew_day(
    *, services: Services, snapshot: ConfigSnapshot, catalog: RulesetCatalog, site_day: SiteDay, crew_id: str
) -> PlannedDay:
    """The crew's validated plan for ``site_day`` with ack items, hash and sign-off state.

    Raises:
        CrewNotFoundError: No such crew.
        ShiftNotLegalError, PlannerBugError: As ``day_plan``.
        ConfigParametersError, RulesetIncompleteError, NoRulesetError: Deployment or caller faults.
    """
    crew = await services.sites.crew_spec(crew_id)
    loaded = ruleset_for(snapshot, catalog, site_day.local_date)
    ruleset = loaded.ruleset
    ruleset.require("clauses", "alerts")
    if ruleset.clauses is None or ruleset.alerts is None:  # unreachable after ``require``; narrows the sections
        raise RuntimeError("ruleset sections clauses and alerts are required")
    params = effective_params(snapshot, ruleset)
    result = await day_plan(
        site_day=site_day,
        crew=crew,
        catalog=catalog,
        snapshot=snapshot,
        sites=services.sites,
        stops=services.stops,
        plans=services.plans,
        audit=services.audit,
        k_exposure=params.k_exposure,
    )
    segments = plan_segments(result.plan, result.zones, ruleset.clauses.entries)
    items = ack_items(
        segments,
        workload=crew.workload,
        rules=planner_rules(ruleset, params),
        alerts=ruleset.alerts,
        tz=ZoneInfo(site_day.site.timezone),
    )
    digest = plan_hash(crew.crew_id, site_day.local_date, segments)
    latest = await current_signoff(services, crew.crew_id, site_day.local_date, result.epoch_id)
    return PlannedDay(
        crew=crew,
        result=result,
        segments=segments,
        ack=items,
        plan_hash=digest,
        latest_signoff=latest,
        state=signoff_state(latest, digest),
        k_exposure=params.k_exposure,
        ruleset_id=ruleset.meta.id,
    )
