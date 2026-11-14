"""Governance refusal, the worker-visible transparency log and the demo reset. Bodies arrive in B3 Task 10."""

from fastapi import APIRouter, Depends

from stellar_blaze.api.models import DataRequestCreate, DemoReset, TransparencyLog
from stellar_blaze.api.rate_limits import DEMO_RESET_LIMITS, EMPLOYER_LIMITS, extension
from stellar_blaze.api.responses import ProblemJSONResponse, not_implemented, problem_responses
from stellar_blaze.api.routers.sites import SiteIdPath
from stellar_blaze.api.security import employer_bearer

router = APIRouter(tags=["governance"])


@router.post(
    "/sites/{site_id}/data-requests",
    openapi_extra=extension(EMPLOYER_LIMITS),
    summary="Request individual data (always refused)",
    status_code=403,
    response_model=None,
    response_class=ProblemJSONResponse,
    response_description="Always refused: no success response exists.",
    dependencies=[Depends(employer_bearer)],
    responses=problem_responses(
        "unauthorized",
        "individual-data-refused",
        "not-found",
        "validation-failed",
        "rate-limited",
        "not-implemented",
        "dependency-unavailable",
    ),
)
async def create_data_request(site_id: SiteIdPath, payload: DataRequestCreate) -> None:
    """An employer asks for individual worker data. The answer is always the `individual-data-refused` problem (403).

    No such data is held by this service. The refusal is written to an append-only audit log that every worker of the
    site can read through `get_site_transparency_log`; the `worker_ref` is discarded and never stored, logged or echoed.
    Without a token the answer is 401.
    """
    raise not_implemented()


@router.get(
    "/sites/{site_id}/transparency-log",
    summary="Worker-visible audit entries of a site",
    responses=problem_responses("not-found", "validation-failed", "not-implemented"),
)
async def get_site_transparency_log(site_id: SiteIdPath) -> TransparencyLog:
    """Refused employer data requests at the site, newest first, at most 50. Never says whose data was asked for."""
    raise not_implemented()


@router.post(
    "/sites/{site_id}/demo-reset",
    openapi_extra=extension(DEMO_RESET_LIMITS),
    summary="Reset a synthetic demo site",
    dependencies=[Depends(employer_bearer)],
    responses=problem_responses(
        "unauthorized",
        "forbidden-employer",
        "not-found",
        "not-a-demo-site",
        "validation-failed",
        "rate-limited",
        "internal-error",
        "not-implemented",
    ),
)
async def reset_demo_site(site_id: SiteIdPath) -> DemoReset:
    """Start a fresh demo epoch of a synthetic site. Own employer only; guarded and rate-limited.

    Nothing is deleted. Plans, sign-offs, stop events and data requests are scoped to the current epoch, so earlier
    epochs are no longer visible. The append-only audit chain continues unbroken and records `demo_reset`. Any site
    that is not synthetic answers `not-a-demo-site` (409).
    """
    raise not_implemented()
