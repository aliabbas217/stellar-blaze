"""Try-a-plan: check a hypothetical roster against a day's zones (ADR 0051). The contract is frozen (v1)."""

from dataclasses import replace
from zoneinfo import ZoneInfo

from fastapi import APIRouter

from stellar_blaze.api.deps import RuntimeDep, ServicesDep, SnapshotDep
from stellar_blaze.api.models import PlanValidateRequest, PlanValidateResponse
from stellar_blaze.api.responses import problem_responses
from stellar_blaze.api.views import (
    BANNER_CODE,
    ban_window,
    domain_problems,
    load_site_day,
    site_or_404,
    validator_model,
    zone_hours_model,
)
from stellar_blaze.application.day_plan import CrewHour, protective_timeline
from stellar_blaze.application.runtime_config import ruleset_for
from stellar_blaze.application.site_day import effective_params
from stellar_blaze.domain.plans.model import CrewMember, CrewSpec
from stellar_blaze.domain.plans.rules import planner_rules
from stellar_blaze.domain.validator.roster_text import RosterParseError, parse_roster, plan_from_segments
from stellar_blaze.domain.validator.validator import declare_restrictions
from stellar_blaze.domain.validator.validator import validate_plan as run_validator
from stellar_blaze.errors import ROSTER_INVALID, DomainProblem

router = APIRouter(tags=["plans"])

_TRY_CREW_ID = "try-a-plan"


def _roster_text(payload: PlanValidateRequest) -> str:
    """The roster as text: given text, or the segments as one line each (so a line number is the segment's index)."""
    if payload.roster_text is not None:
        return payload.roster_text
    state = {"work": "work", "rest": "rest", "break": "break"}
    return "\n".join(f"{s.start}-{s.end} {state[s.state]}" for s in payload.segments or [])


@router.post(
    "/plans/validate",
    summary="Check a roster against the day's zones",
    responses=problem_responses("not-found", "validation-failed", "roster-invalid", "dependency-unavailable"),
)
async def validate_plan(
    payload: PlanValidateRequest, services: ServicesDep, runtime: RuntimeDep, snapshot: SnapshotDep
) -> PlanValidateResponse:
    """Run the independent validator on a roster given as text or as segments, for a hypothetical crew.

    Nothing is stored. A roster that does not parse is `roster-invalid` (422, `errors` with 1-based line numbers).
    The violations are the answer: an illegal roster is never an error status.
    """
    site = await site_or_404(services, payload.site_id)
    try:
        segments = parse_roster(_roster_text(payload))
    except RosterParseError as error:
        raise DomainProblem(
            type_=ROSTER_INVALID,
            title="Roster invalid",
            status=422,
            detail="The roster could not be read.",
            errors=[{"line": line, "message": message} for line, message in error.errors],
        ) from error
    tz = ZoneInfo(site.timezone)
    with domain_problems():
        day = await load_site_day(
            services=services, runtime=runtime, snapshot=snapshot, site=site, local_date=payload.date
        )
        loaded = ruleset_for(snapshot, runtime.rulesets, payload.date)
        ruleset = loaded.ruleset
        ruleset.require("clauses")
        if ruleset.clauses is None:  # unreachable after ``require``; narrows the optional section
            raise RuntimeError("ruleset clauses are required")
        rules = planner_rules(ruleset, effective_params(snapshot, ruleset))
        timeline = protective_timeline(day.zones) if day.forecast_status == "stale" else day.zones
        # One flag for the typed crew: acclimatised=False is "every member on day 1" (a new, inexperienced worker).
        members = (
            None
            if payload.crew.acclimatised
            else tuple(
                CrewMember(days_on_site=1, days_away=0, away_reason="none", experienced=False, juvenile=False)
                for _ in range(payload.crew.headcount)
            )
        )
        crew = CrewSpec(
            crew_id=_TRY_CREW_ID,
            employer_id=site.employer_id,
            workload=payload.crew.workload,
            headcount=payload.crew.headcount,
            shift=(),
            days_per_week=payload.crew.days_per_week,
            members=members,
        )
        plan = replace(plan_from_segments(segments, local_date=payload.date, tz=tz), crew_id=_TRY_CREW_ID)
        plan = declare_restrictions(plan, crew, rules)
        result = run_validator(plan, timeline, crew, rules, ruleset.clauses.entries, published_shift=None, tz=tz)
    hours = [CrewHour(h.starts_at, h.zone, h.level) for h in day.hours]
    return PlanValidateResponse(
        banner_code=BANNER_CODE,
        validator=validator_model(result, plan.start_utc),
        zone_hours=zone_hours_model(hours),
        forecast_status=day.forecast_status,
        ban_window=ban_window(day.ban),
        policy_version=day.identity.ruleset_id,
        config_version=day.identity.config_version,
        model_id=day.identity.model_id,
    )
