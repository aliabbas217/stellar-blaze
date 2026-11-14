"""Sites, the day forecast and the risk policy (public routes). Bodies arrive in B3 Task 10; the contract is final."""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Path, Query

from stellar_blaze.api.models import Crew, RiskPolicy, Site, SiteForecastToday
from stellar_blaze.api.responses import not_implemented, problem_responses

router = APIRouter(tags=["sites"])

SiteIdPath = Annotated[
    str,
    Path(min_length=1, max_length=100, description="Site id, from `list_sites` (for example `site-demo-mussafah`)."),
]
DateQuery = Annotated[
    dt.date | None,
    Query(
        description="The site-local calendar date, `YYYY-MM-DD`. When omitted: the site's local today in live mode, "
        "and "
        "the configured replay date in replay mode."
    ),
]


@router.get("/sites", summary="List sites", responses=problem_responses("not-implemented"))
async def list_sites() -> list[Site]:
    """All sites the API serves, with their time zone and whether they are synthetic demo data."""
    raise not_implemented()


@router.get(
    "/sites/{site_id}/forecast/today",
    summary="Hourly forecast and site level for a day",
    responses=problem_responses("not-found", "validation-failed", "not-implemented", "dependency-unavailable"),
)
async def get_site_forecast_today(site_id: SiteIdPath, date: DateQuery = None) -> SiteForecastToday:
    """The corrected hourly WBGT range and the warning level of each working hour of the site-local day.

    Every instant is UTC; `date` and the ban window are site-local. `forecast_status` says whether the forecast is
    fresh, stale (shown anyway) or missing (the plan is then the most protective one).
    """
    raise not_implemented()


@router.get(
    "/risk-policy",
    summary="The active risk policy",
    responses=problem_responses("not-implemented", "dependency-unavailable"),
)
async def get_risk_policy() -> RiskPolicy:
    """The policy the device uses to turn a forecast into a personal level: bands, workloads, clothing, thresholds.

    The device must check that `config_version` equals the forecast's before it computes a personal level.
    """
    raise not_implemented()


@router.get(
    "/sites/{site_id}/crews",
    summary="List the crews of a site",
    responses=problem_responses("not-found", "validation-failed", "not-implemented"),
)
async def list_site_crews(site_id: SiteIdPath) -> list[Crew]:
    """The crews of the site with the status the supervisor list shows: workload, shift, sign-off, plan status, stop."""
    raise not_implemented()
