"""Crew timeline, day plan, sign-off and crew-lead stops (ADR 0051, ADR 0011 7.1). The contract is frozen (v1)."""

from datetime import timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

import structlog
from fastapi import APIRouter, Path, Response

from stellar_blaze.api.auth import EmployerDep, StopEmployerDep
from stellar_blaze.api.deps import RuntimeDep, ServicesDep, SettingsDep, SnapshotDep
from stellar_blaze.api.models import (
    CrewHour,
    CrewStop,
    CrewStopCreate,
    CrewTimeline,
    DayPlan,
    PlanSignOff,
    PlanSignOffRequest,
)
from stellar_blaze.api.rate_limits import EMPLOYER_LIMITS, STOP_LIMITS, extension
from stellar_blaze.api.responses import problem_responses
from stellar_blaze.api.routers.sites import DateQuery
from stellar_blaze.api.views import (
    BANNER_CODE,
    ack_items_model,
    ban_window,
    crew_or_404,
    deny_if_foreign,
    domain_problems,
    label_code,
    load_site_day,
    not_found,
    plan_segments_model,
    policy_date,
    resolve_date,
    shift_instants,
    signoff_state_of,
    site_or_404,
    suppressed_crew,
    validator_model,
    zone_hours_model,
)
from stellar_blaze.application.crew_views import plan_crew_day
from stellar_blaze.application.day_plan import crew_hours, shift_end_utc, stopped_mask
from stellar_blaze.application.governance import audit_identity
from stellar_blaze.application.runtime_config import ruleset_for
from stellar_blaze.application.signoff import ReviewRequiredError, SignoffNeedsDatabaseConfigError, sign_off
from stellar_blaze.application.site_day import effective_params
from stellar_blaze.domain.plans.ticks import TICK_MINUTES
from stellar_blaze.errors import DEPENDENCY_UNAVAILABLE, REVIEW_REQUIRED, DomainProblem
from stellar_blaze.ports.audit import AuditEvent

logger = structlog.stdlib.get_logger(__name__)
router = APIRouter(tags=["crews"])

CrewIdPath = Annotated[
    str, Path(min_length=1, max_length=100, description="Crew id, from `list_site_crews` (for example `crew-b`).")
]
StopIdPath = Annotated[str, Path(min_length=1, max_length=100, description="Stop id, from `create_crew_stop`.")]
_GRID = timedelta(minutes=TICK_MINUTES * 216)


@router.get(
    "/crews/{crew_id}/timeline",
    summary="Crew level timeline for a day",
    responses=problem_responses("not-found", "validation-failed", "dependency-unavailable"),
)
async def get_crew_timeline(
    crew_id: CrewIdPath,
    services: ServicesDep,
    runtime: RuntimeDep,
    settings: SettingsDep,
    snapshot: SnapshotDep,
    date: DateQuery = None,
) -> CrewTimeline:
    """The crew's level for each working hour of the site-local day. Aggregates only, suppressed below `k` members."""
    crew = await crew_or_404(services, crew_id)
    site = await site_or_404(services, crew.site_id)
    with domain_problems():
        local_date = resolve_date(settings, services, site, date)
        day = await load_site_day(
            services=services, runtime=runtime, snapshot=snapshot, site=site, local_date=local_date
        )
        epoch = await services.sites.active_epoch(site.id)
        start = day.zones.start_utc
        stops = await services.stops.active_between(crew.id, start, start + _GRID, epoch)
        shift_end = shift_end_utc(crew.shift, local_date, ZoneInfo(site.timezone))
        hours = crew_hours(day, stopped_mask([(s.started_at, s.cleared_at) for s in stops], start, shift_end), start)
        ruleset = ruleset_for(snapshot, runtime.rulesets, local_date).ruleset
        k = effective_params(snapshot, ruleset).k_exposure
        state = await signoff_state_of(
            services=services, snapshot=snapshot, runtime=runtime, day=day, crew_id=crew.id, epoch=epoch
        )
    return CrewTimeline(
        crew_id=crew.id,
        crew_name=crew.name,
        site_id=site.id,
        date=local_date,
        suppressed=crew.member_count < k,
        k=k,
        forecast_status=day.forecast_status,
        signoff_state=state,
        shift=shift_instants(crew.shift, local_date, ZoneInfo(site.timezone)),
        ban_window=ban_window(day.ban),
        hours=[
            CrewHour(starts_at=hour.starts_at, crew_level=hour.level, ban_active=site_hour.ban_active)
            for hour, site_hour in zip(hours, day.hours, strict=True)
        ],
        mode=day.mode,
    )


@router.get(
    "/crews/{crew_id}/day-plan",
    openapi_extra=extension(EMPLOYER_LIMITS),
    summary="The crew's day plan",
    responses=problem_responses(
        "unauthorized",
        "forbidden-employer",
        "not-found",
        "validation-failed",
        "shift-not-legal",
        "rate-limited",
        "plan-invalid",
        "dependency-unavailable",
    ),
)
async def get_crew_day_plan(
    crew_id: CrewIdPath,
    principal: EmployerDep,
    services: ServicesDep,
    runtime: RuntimeDep,
    settings: SettingsDep,
    snapshot: SnapshotDep,
    date: DateQuery = None,
) -> DayPlan:
    """The rule plan for the crew's site-local day, checked by the independent validator. Employer token, own crew only.

    Every plan carries the floor banner code, and is `unsigned` until `sign_off_day_plan`. A plan the validator
    rejects is never served: the answer is the `plan-invalid` problem (500). A crew whose published shift is itself
    illegal (hours, juvenile rules) is answered `shift-not-legal` (422) with the violated clauses.
    """
    crew = await crew_or_404(services, crew_id)
    await deny_if_foreign(
        services=services,
        runtime=runtime,
        principal=principal,
        employer_id=crew.employer_id,
        site_id=crew.site_id,
        operation="get_crew_day_plan",
    )
    site = await site_or_404(services, crew.site_id)
    local_date = resolve_date(settings, services, site, date)
    with domain_problems(suppressed=suppressed_crew(snapshot, runtime, local_date, crew.member_count)):
        day = await load_site_day(
            services=services, runtime=runtime, snapshot=snapshot, site=site, local_date=local_date
        )
        planned = await plan_crew_day(
            services=services, snapshot=snapshot, catalog=runtime.rulesets, site_day=day, crew_id=crew.id
        )
    result = planned.result
    signed = planned.latest_signoff
    return DayPlan(
        crew_id=crew.id,
        date=day.local_date,
        status=result.status,
        signoff_state=planned.state,
        signoff_label_code=label_code(planned.state),
        banner_code=BANNER_CODE,
        segments=plan_segments_model(planned.segments),
        zone_hours=zone_hours_model(result.hours),
        validator=validator_model(result.validation, result.plan.start_utc),
        ack_items=ack_items_model(planned.ack),
        suppressed=result.suppressed,
        restricted_headcount=result.restricted_headcount,
        restrictions=[] if result.suppressed else list(result.plan.restrictions),
        signed_at=None if signed is None else signed.signed_at,
        signed_by_role=None if signed is None else "supervisor",
        forecast_status=result.forecast_status,
        ban_window=ban_window(day.ban),
        policy_version=day.identity.ruleset_id,
        config_version=day.identity.config_version,
        model_id=day.identity.model_id,
        mode=day.mode,
    )


@router.post(
    "/crews/{crew_id}/day-plan/sign-off",
    openapi_extra=extension(EMPLOYER_LIMITS),
    summary="Sign off the day plan",
    status_code=201,
    responses=problem_responses(
        "unauthorized",
        "forbidden-employer",
        "not-found",
        "review-required",
        "validation-failed",
        "shift-not-legal",
        "rate-limited",
        "plan-invalid",
        "dependency-unavailable",
    ),
)
async def sign_off_day_plan(
    crew_id: CrewIdPath,
    payload: PlanSignOffRequest,
    principal: EmployerDep,
    services: ServicesDep,
    runtime: RuntimeDep,
    settings: SettingsDep,
    snapshot: SnapshotDep,
    date: DateQuery = None,
) -> PlanSignOff:
    """Record a named supervisor's acknowledgement of the day plan. Employer token, own crew only.

    Answers `review-required` (409, with `missing_items`) unless every Medium, High and Red item of `ack_items` is
    acknowledged. Sign-off is independent of stops and of the warning dispatch job: it never delays either. Signing a
    plan that is already signed answers 201 with the
    recorded sign-off again. A sign-off is recorded against a database configuration version: with none loaded the
    answer is `dependency-unavailable` (503).
    """
    crew = await crew_or_404(services, crew_id)
    await deny_if_foreign(
        services=services,
        runtime=runtime,
        principal=principal,
        employer_id=crew.employer_id,
        site_id=crew.site_id,
        operation="sign_off_day_plan",
    )
    site = await site_or_404(services, crew.site_id)
    local_date = resolve_date(settings, services, site, date)
    with domain_problems(suppressed=suppressed_crew(snapshot, runtime, local_date, crew.member_count)):
        day = await load_site_day(
            services=services, runtime=runtime, snapshot=snapshot, site=site, local_date=local_date
        )
        planned = await plan_crew_day(
            services=services, snapshot=snapshot, catalog=runtime.rulesets, site_day=day, crew_id=crew.id
        )
        loaded = ruleset_for(snapshot, runtime.rulesets, day.local_date)
    try:
        record = await sign_off(
            services=services,
            planned=planned,
            principal=principal,
            site_id=site.id,
            ruleset_sha256=loaded.sha256,
            config_version_id=snapshot.version_id,
            config_sha256=snapshot.sha256,
            model_id=day.identity.model_id,
            acknowledged=payload.acknowledged_items,
            deviation_reason_code=payload.deviation_reason_code,
        )
    except ReviewRequiredError as error:
        raise DomainProblem(
            type_=REVIEW_REQUIRED,
            title="Review required",
            status=409,
            detail="Every Medium, High and Red item must be acknowledged before signing.",
            missing_items=list(error.missing),
        ) from error
    except SignoffNeedsDatabaseConfigError as error:
        raise DomainProblem(
            type_=DEPENDENCY_UNAVAILABLE,
            title="Dependency unavailable",
            status=503,
            detail="A sign-off is recorded against a database configuration version and none is loaded.",
            dependency="config",
        ) from error
    return PlanSignOff(
        crew_id=crew.id,
        date=day.local_date,
        signoff_state="signed",
        signed_at=record.signed_at,
        signed_by_role="supervisor",
        acknowledged_items=list(record.acknowledged_items),
        deviation_reason_code=record.deviation_reason_code,
    )


@router.post(
    "/crews/{crew_id}/stops",
    openapi_extra=extension(STOP_LIMITS),
    summary="Stop work for a crew",
    status_code=201,
    responses=problem_responses("unauthorized", "forbidden-employer", "not-found", "validation-failed", "rate-limited"),
)
async def create_crew_stop(
    crew_id: CrewIdPath,
    payload: CrewStopCreate,
    principal: StopEmployerDep,
    services: ServicesDep,
    runtime: RuntimeDep,
) -> CrewStop:
    """Record a crew-lead stop now. Employer token, own crew only. Never waits for sign-off, validation or a forecast.

    Stop recorded. It is visible on the next read. Push alerts follow when the alert dispatch job is running: within
    one dispatch interval of the stop plus the time the cycle itself takes (the forecast fetch is cut at 30 s and a
    push at 12 s), about 5 min 42 s with the default 5-minute interval. A push that fails with a transient error
    (a 5xx, a 429 with a short Retry-After, a timeout) is tried once more inside that 12 s; no other push is tried
    twice.

    Idempotent while a stop is active: a second POST for a crew that already has an active stop in the active epoch
    returns that stop (201, same body, no second row, no second audit row).

    Undo window: a stop cleared by `delete_crew_stop` within 10 seconds of being recorded leaves no trace in levels or
    plans; both audit rows stay. An active stop covers the crew's levels and plan from its start to the end of the
    crew's shift for the day, and a cleared stop only until it was cleared.

    Known edge (not changed): the warning levels cover the working day 06:00 to 20:00 site-local, so a stop recorded
    outside it changes no warning level, and a stop that was never cleared is read again by the next day's runs only
    through the stops of that day's window.
    """
    crew = await crew_or_404(services, crew_id)
    await deny_if_foreign(
        services=services,
        runtime=runtime,
        principal=principal,
        employer_id=crew.employer_id,
        site_id=crew.site_id,
        operation="create_crew_stop",
    )
    epoch = await services.sites.active_epoch(crew.site_id)
    active = await services.stops.active(crew.id, epoch)
    if active is not None:
        return CrewStop(
            id=active.id, crew_id=active.crew_id, started_at=active.started_at, cleared_at=active.cleared_at
        )
    stop = await services.stops.start(crew.id, payload.reason_code, principal.actor, epoch)  # the stop is written first
    try:
        identity = audit_identity(runtime.config.peek(), runtime.rulesets, policy_date(runtime.settings, services))
        await services.audit.append(
            AuditEvent(
                kind="crew.stop_started",
                actor=principal.actor,
                actor_role=principal.role,
                employer_id=principal.employer_id,
                site_id=crew.site_id,
                epoch_id=epoch,
                outcome="recorded",
                detail={"crew_id": crew.id, "stop_id": stop.id},
                ruleset_id=identity.ruleset_id,
                ruleset_sha256=identity.ruleset_sha256,
                model_id=identity.model_id,
                config_version_id=identity.config_version_id,
                config_sha256=identity.config_sha256,
            )
        )
    except Exception:  # the stop is recorded; a failing audit append must never turn a safety action into an error
        logger.exception("crew.stop_audit_failed", crew_id=crew.id, stop_id=stop.id)
    return CrewStop(id=stop.id, crew_id=stop.crew_id, started_at=stop.started_at, cleared_at=stop.cleared_at)


@router.delete(
    "/crews/{crew_id}/stops/{stop_id}",
    openapi_extra=extension(EMPLOYER_LIMITS),
    summary="Clear a crew stop",
    status_code=204,
    responses=problem_responses("unauthorized", "forbidden-employer", "not-found", "validation-failed", "rate-limited"),
)
async def delete_crew_stop(
    crew_id: CrewIdPath,
    stop_id: StopIdPath,
    principal: EmployerDep,
    services: ServicesDep,
    runtime: RuntimeDep,
) -> Response:
    """Clear a stop. Employer token, own crew only. Idempotent: clearing a stop that is already cleared is also 204.

    A stop cleared within 10 seconds of being recorded (the undo) leaves no trace in levels or plans; both audit rows
    stay. After that, the stop covers the levels and the plan only until it was cleared.

    Resume recorded. A de-escalation alert follows after the de-escalation dwell, at the next alert dispatch cycle
    once the dwell has elapsed (one dispatch interval at most, plus the time the cycle itself takes).
    """
    crew = await crew_or_404(services, crew_id)
    await deny_if_foreign(
        services=services,
        runtime=runtime,
        principal=principal,
        employer_id=crew.employer_id,
        site_id=crew.site_id,
        operation="delete_crew_stop",
    )
    epoch = await services.sites.active_epoch(crew.site_id)
    stop = await services.stops.get(stop_id)
    if stop is None or stop.crew_id != crew.id or stop.epoch_id != epoch:
        raise not_found(f"No stop {stop_id} on crew {crew.id}.")
    if stop.cleared_at is None:
        await services.stops.clear(stop.id, principal.actor)
        identity = audit_identity(runtime.config.peek(), runtime.rulesets, policy_date(runtime.settings, services))
        await services.audit.append(
            AuditEvent(
                kind="crew.stop_cleared",
                actor=principal.actor,
                actor_role=principal.role,
                employer_id=principal.employer_id,
                site_id=crew.site_id,
                epoch_id=epoch,
                outcome="cleared",
                detail={"crew_id": crew.id, "stop_id": stop.id},
                ruleset_id=identity.ruleset_id,
                ruleset_sha256=identity.ruleset_sha256,
                model_id=identity.model_id,
                config_version_id=identity.config_version_id,
                config_sha256=identity.config_sha256,
            )
        )
    return Response(status_code=204)
