"""Sites, the day forecast and the risk policy (public routes, ADR 0051). The contract is frozen (v1)."""

import datetime as dt
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Path, Query

from stellar_blaze.api.deps import RuntimeDep, ServicesDep, SettingsDep, SnapshotDep
from stellar_blaze.api.models import (
    Crew,
    HourForecast,
    RiskPolicy,
    ShiftWindow,
    Site,
    SiteForecastToday,
)
from stellar_blaze.api.responses import problem_responses
from stellar_blaze.api.views import (
    ban_window,
    domain_problems,
    load_site_day,
    plan_status_of,
    policy_date,
    resolve_date,
    signoff_state_of,
    site_or_404,
)
from stellar_blaze.application.runtime_config import ruleset_for
from stellar_blaze.application.site_day import effective_params
from stellar_blaze.domain.risk.policy import risk_policy
from stellar_blaze.domain.scoreboard import WbgtQuantiles
from stellar_blaze.ports.sites import SiteRecord

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


def site_model(site: SiteRecord, epoch_id: int | None) -> Site:
    return Site(
        id=site.id,
        name=site.name,
        timezone=site.timezone,
        synthetic=site.synthetic,
        epoch_id=epoch_id,
        supervisor_phone=site.supervisor_phone,
        first_aider_phone=site.first_aider_phone,
    )


@router.get("/sites", summary="List sites", responses=problem_responses())
async def list_sites(services: ServicesDep) -> list[Site]:
    """All sites the API serves, with their time zone and whether they are synthetic demo data."""
    out: list[Site] = []
    for site in await services.sites.list_sites():
        out.append(site_model(site, await services.sites.active_epoch(site.id) if site.synthetic else None))
    return out


@router.get(
    "/sites/{site_id}/forecast/today",
    summary="Hourly forecast and site level for a day",
    responses=problem_responses("not-found", "validation-failed", "dependency-unavailable"),
)
async def get_site_forecast_today(
    site_id: SiteIdPath,
    services: ServicesDep,
    runtime: RuntimeDep,
    settings: SettingsDep,
    snapshot: SnapshotDep,
    date: DateQuery = None,
) -> SiteForecastToday:
    """The corrected hourly WBGT range and the warning level of each working hour of the site-local day.

    Every instant is UTC; `date` and the ban window are site-local. `forecast_status` says whether the forecast is
    fresh, stale (shown anyway) or missing (the plan is then the most protective one).
    """
    site = await site_or_404(services, site_id)
    with domain_problems():
        day = await load_site_day(
            services=services,
            runtime=runtime,
            snapshot=snapshot,
            site=site,
            local_date=resolve_date(settings, services, site, date),
        )
    return SiteForecastToday(
        site_id=site.id,
        date=day.local_date,
        generated_at=day.generated_at,
        policy_version=day.identity.ruleset_id,
        config_version=day.identity.config_version,
        mode=day.mode,
        forecast_status=day.forecast_status,
        model_id=day.identity.model_id,
        lead_days=day.lead_days,
        ban_window=ban_window(day.ban),
        hours=[
            HourForecast(
                starts_at=hour.starts_at,
                wbgt_c=WbgtQuantiles(p05=hour.wbgt_q05, p50=hour.wbgt_q50, p95=hour.wbgt_q95),
                site_level=hour.level,
                action_codes=list(hour.action_codes),
                ban_active=hour.ban_active,
            )
            for hour in day.hours
        ],
    )


@router.get(
    "/risk-policy",
    summary="The active risk policy",
    responses=problem_responses("dependency-unavailable"),
)
async def get_risk_policy(
    services: ServicesDep, runtime: RuntimeDep, settings: SettingsDep, snapshot: SnapshotDep
) -> RiskPolicy:
    """The policy the device uses to turn a forecast into a personal level: bands, workloads, clothing, thresholds.

    The device must check that `config_version` equals the forecast's before it computes a personal level.
    """
    with domain_problems():
        ruleset = ruleset_for(snapshot, runtime.rulesets, policy_date(settings, services)).ruleset
        version = snapshot.version_id if snapshot.version_id is not None else 0
        data = risk_policy(ruleset, effective_params(snapshot, ruleset), version)
    return RiskPolicy.model_validate(asdict(data))


@router.get(
    "/sites/{site_id}/crews",
    summary="List the crews of a site",
    responses=problem_responses("not-found", "validation-failed", "dependency-unavailable"),
)
async def list_site_crews(
    site_id: SiteIdPath,
    services: ServicesDep,
    runtime: RuntimeDep,
    settings: SettingsDep,
    snapshot: SnapshotDep,
    date: DateQuery = None,
) -> list[Crew]:
    """The crews of the site with the status the supervisor list shows: workload, shift, sign-off, plan status, stop.

    The sign-off and plan status are those of the response date (`date`, same default rule as the other routes);
    the stop is the one active at the time of the response.
    """
    site = await site_or_404(services, site_id)
    crews: list[Crew] = []
    with domain_problems():
        local_date = resolve_date(settings, services, site, date)
        day = await load_site_day(
            services=services, runtime=runtime, snapshot=snapshot, site=site, local_date=local_date
        )
        epoch = await services.sites.active_epoch(site.id)
        for record in await services.sites.list_crews(site.id):
            stop = await services.stops.active(record.id, epoch)
            crews.append(
                Crew(
                    id=record.id,
                    site_id=record.site_id,
                    name=record.name,
                    task_label=record.task_label,
                    workload=record.workload,
                    member_count=record.member_count,
                    shift=[ShiftWindow(start=f"{b.start:%H:%M}", end=f"{b.end:%H:%M}") for b in record.shift],
                    signoff_state=await signoff_state_of(
                        services=services, snapshot=snapshot, runtime=runtime, day=day, crew_id=record.id, epoch=epoch
                    ),
                    plan_status=plan_status_of(day),
                    stopped=stop is not None,
                    active_stop_id=None if stop is None else stop.id,
                    stopped_at=None if stop is None else stop.started_at,
                )
            )
    return crews
