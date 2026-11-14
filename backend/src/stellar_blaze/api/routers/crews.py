"""Crew timeline, day plan, sign-off and crew-lead stops. Bodies arrive in B3 Tasks 10 and 17; the contract is final."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path

from stellar_blaze.api.models import CrewStop, CrewStopCreate, CrewTimeline, DayPlan, PlanSignOff, PlanSignOffRequest
from stellar_blaze.api.rate_limits import EMPLOYER_LIMITS, extension
from stellar_blaze.api.responses import not_implemented, problem_responses
from stellar_blaze.api.routers.sites import DateQuery
from stellar_blaze.api.security import employer_bearer

router = APIRouter(tags=["crews"])

CrewIdPath = Annotated[
    str, Path(min_length=1, max_length=100, description="Crew id, from `list_site_crews` (for example `crew-b`).")
]
StopIdPath = Annotated[str, Path(min_length=1, max_length=100, description="Stop id, from `create_crew_stop`.")]


@router.get(
    "/crews/{crew_id}/timeline",
    summary="Crew level timeline for a day",
    responses=problem_responses("not-found", "validation-failed", "not-implemented", "dependency-unavailable"),
)
async def get_crew_timeline(crew_id: CrewIdPath, date: DateQuery = None) -> CrewTimeline:
    """The crew's level for each working hour of the site-local day. Aggregates only, suppressed below `k` members."""
    raise not_implemented()


@router.get(
    "/crews/{crew_id}/day-plan",
    openapi_extra=extension(EMPLOYER_LIMITS),
    summary="The crew's day plan",
    dependencies=[Depends(employer_bearer)],
    responses=problem_responses(
        "unauthorized",
        "forbidden-employer",
        "not-found",
        "validation-failed",
        "rate-limited",
        "plan-invalid",
        "not-implemented",
        "dependency-unavailable",
    ),
)
async def get_crew_day_plan(crew_id: CrewIdPath, date: DateQuery = None) -> DayPlan:
    """The rule plan for the crew's site-local day, checked by the independent validator. Employer token, own crew only.

    Every plan carries the floor banner code, and is `unsigned` until `sign_off_day_plan`. A plan the validator
    rejects is never served: the answer is the `plan-invalid` problem (500).
    """
    raise not_implemented()


@router.post(
    "/crews/{crew_id}/day-plan/sign-off",
    openapi_extra=extension(EMPLOYER_LIMITS),
    summary="Sign off the day plan",
    status_code=201,
    dependencies=[Depends(employer_bearer)],
    responses=problem_responses(
        "unauthorized",
        "forbidden-employer",
        "not-found",
        "review-required",
        "validation-failed",
        "rate-limited",
        "plan-invalid",
        "not-implemented",
        "dependency-unavailable",
    ),
)
async def sign_off_day_plan(crew_id: CrewIdPath, payload: PlanSignOffRequest, date: DateQuery = None) -> PlanSignOff:
    """Record a named supervisor's acknowledgement of the day plan. Employer token, own crew only.

    Answers `review-required` (409, with `missing_items`) unless every Medium, High and Red item of `ack_items` is
    acknowledged. Sign-off is independent of stops and of the warning dispatch job: it never delays either. Signing a
    plan that is already signed answers 201 with the
    recorded sign-off again.
    """
    raise not_implemented()


@router.post(
    "/crews/{crew_id}/stops",
    openapi_extra=extension(EMPLOYER_LIMITS),
    summary="Stop work for a crew",
    status_code=201,
    dependencies=[Depends(employer_bearer)],
    responses=problem_responses(
        "unauthorized", "forbidden-employer", "not-found", "validation-failed", "rate-limited", "not-implemented"
    ),
)
async def create_crew_stop(crew_id: CrewIdPath, payload: CrewStopCreate) -> CrewStop:
    """Record a crew-lead stop now. Employer token, own crew only. Never waits for sign-off, validation or a forecast.

    Stop recorded. It takes effect on the crew's plan and level immediately; push alerts are sent by the alert
    dispatch job, not by this call.
    """
    raise not_implemented()


@router.delete(
    "/crews/{crew_id}/stops/{stop_id}",
    openapi_extra=extension(EMPLOYER_LIMITS),
    summary="Clear a crew stop",
    status_code=204,
    dependencies=[Depends(employer_bearer)],
    responses=problem_responses(
        "unauthorized", "forbidden-employer", "not-found", "validation-failed", "rate-limited", "not-implemented"
    ),
)
async def delete_crew_stop(crew_id: CrewIdPath, stop_id: StopIdPath) -> None:
    """Clear a stop. Employer token, own crew only. Idempotent: clearing a stop that is already cleared is also 204."""
    raise not_implemented()
