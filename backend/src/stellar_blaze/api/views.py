"""Shared route plumbing: lookups, the date default, domain errors as problems, and domain data as response models.

The routers stay thin: they authenticate (``api.auth``), look up what the path names, call a use case in
``application`` and convert its result here. Nothing in this module reads a request body.
"""

import contextlib
from collections.abc import Iterator, Sequence
from dataclasses import asdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from stellar_blaze.api.models import (
    AckItem,
    BanWindow,
    PlanSegment,
    PlanState,
    PlanZone,
    TimeRange,
    ValidatorResult,
    ZoneHour,
)
from stellar_blaze.api.models import Violation as ViolationModel
from stellar_blaze.application.crew_views import plan_crew_day
from stellar_blaze.application.day_plan import (
    CrewHour,
    PlannerBugError,
    PlanSegmentData,
    ShiftNotLegalError,
)
from stellar_blaze.application.governance import audit_identity, deny_access
from stellar_blaze.application.plan_review import AckItemData, SignoffState
from stellar_blaze.application.runtime_config import ConfigSnapshot, ruleset_for
from stellar_blaze.application.services import Principal, Services
from stellar_blaze.application.site_day import SiteDay, effective_params, site_day
from stellar_blaze.composition import DUBAI, Runtime
from stellar_blaze.config import Settings
from stellar_blaze.domain.plans.model import ShiftBlock
from stellar_blaze.domain.plans.ticks import TICK_MINUTES, BanWindowData
from stellar_blaze.domain.risk.levels import Zone
from stellar_blaze.domain.rules.catalog import NoRulesetError, PinOutOfRangeError
from stellar_blaze.domain.validator.validator import ValidationResult
from stellar_blaze.errors import (
    FORBIDDEN_EMPLOYER,
    NOT_FOUND,
    PLAN_INVALID,
    SHIFT_NOT_LEGAL,
    DomainProblem,
)
from stellar_blaze.ports.sites import CrewNotFoundError, CrewRecord, SiteNotFoundError, SiteRecord

BANNER_CODE: Literal["plan.floor_banner"] = "plan.floor_banner"
_TICK = timedelta(minutes=TICK_MINUTES)


# --- problems -------------------------------------------------------------------------------------------------------


def not_found(detail: str) -> DomainProblem:
    return DomainProblem(type_=NOT_FOUND, title="Not found", status=404, detail=detail)


def forbidden_employer() -> DomainProblem:
    return DomainProblem(
        type_=FORBIDDEN_EMPLOYER,
        title="Forbidden",
        status=403,
        detail="This resource belongs to another employer.",
    )


def validation_failed(location: str, message: str, kind: str) -> DomainProblem:
    """The framework's 422 shape (``errors: [{loc, msg, type}]``) for a fault the model validation cannot see."""
    return DomainProblem(
        type_="about:blank",
        title="Unprocessable Entity",
        status=422,
        detail="Request validation failed",
        errors=[{"loc": ["query", location], "msg": message, "type": kind}],
    )


@contextlib.contextmanager
def domain_problems(*, suppressed: bool = False) -> Iterator[None]:
    """Answer the domain's refusals as the contract's problems.

    ``ShiftNotLegalError`` is 422 ``shift-not-legal`` with ``violations`` (rule id, clause text, source id; no ticks, no
    detail); ``PlannerBugError`` is 500 ``plan-invalid`` with no detail; no ruleset in force on the date is the 422 of a
    date that cannot be served; an unknown site or crew is 404. For a ``suppressed`` crew the juvenile rules
    (``P-H5.*``)
    are left out of ``violations``: naming one would disclose that a member of a tiny group is a minor.
    """
    try:
        yield
    except ShiftNotLegalError as error:
        raise DomainProblem(
            type_=SHIFT_NOT_LEGAL,
            title="Shift not legal",
            status=422,
            detail="The published shift breaks a shift rule by itself; no plan can fix it.",
            violations=[
                {"rule_id": v.rule_id, "clause": v.clause, "source_id": v.source_id}
                for v in error.result.violations
                if not (suppressed and v.rule_id.startswith("P-H5."))  # a juvenile rule would single out a member
            ],
        ) from error
    except PlannerBugError as error:
        raise DomainProblem(
            type_=PLAN_INVALID,
            title="Plan invalid",
            status=500,
            detail="The plan did not pass the independent validator.",
        ) from error
    except (NoRulesetError, PinOutOfRangeError) as error:
        raise validation_failed("date", "no ruleset is in force on this date", "no_ruleset") from error
    except SiteNotFoundError as error:
        raise not_found(f"No site {error.site_id}.") from error
    except CrewNotFoundError as error:
        raise not_found(f"No crew {error.crew_id}.") from error


# --- lookups and the date default -------------------------------------------------------------------------------------


async def site_or_404(services: Services, site_id: str) -> SiteRecord:
    site = await services.sites.get_site(site_id)
    if site is None:
        raise not_found(f"No site {site_id}.")
    return site


async def crew_or_404(services: Services, crew_id: str) -> CrewRecord:
    crew = await services.sites.get_crew(crew_id)
    if crew is None:
        raise not_found(f"No crew {crew_id}.")
    return crew


def serving_mode(settings: Settings) -> Literal["replay", "live"]:
    return "replay" if settings.forecast_source == "replay" else "live"


def resolve_date(settings: Settings, services: Services, site: SiteRecord, requested: date | None) -> date:
    """``date`` as given; else the configured replay date (replay mode) or the site-local today (live mode, and replay
    mode with no ``SB_REPLAY_DEFAULT_DATE``)."""
    if requested is not None:
        return requested
    if settings.forecast_source == "replay" and settings.replay_default_date is not None:
        return settings.replay_default_date
    return services.clock().astimezone(ZoneInfo(site.timezone)).date()


def policy_date(settings: Settings, services: Services) -> date:
    """The date ``get_risk_policy`` picks its ruleset on: the replay date, else today in Asia/Dubai."""
    if settings.forecast_source == "replay" and settings.replay_default_date is not None:
        return settings.replay_default_date
    return services.clock().astimezone(ZoneInfo(DUBAI)).date()


DAY_CACHE_TTL = timedelta(seconds=60)
DAY_CACHE_SIZE = 32


async def load_site_day(
    *,
    services: Services,
    runtime: Runtime,
    snapshot: ConfigSnapshot,
    site: SiteRecord,
    local_date: date,
) -> SiteDay:
    """The site's day, from a 60 s in-process cache (at most 32 entries) keyed by site, date, snapshot, model and mode.

    ``site_day`` samples and computes TWL on the event loop; the cache keeps a refreshing dashboard from paying that on
    every read. Stops and sign-offs are applied after it, so they are never cached.
    """
    now = services.clock()
    model = snapshot.model.manifest.model_id if snapshot.model is not None else None
    mode = serving_mode(runtime.settings)
    key = (site.id, local_date, snapshot.sha256, snapshot.version_id, model, mode)
    hit = services.day_cache.get(key)
    if hit is not None and now - hit[0] < DAY_CACHE_TTL:
        cached: SiteDay = hit[1]
        return cached
    day = await site_day(
        site=site,
        local_date=local_date,
        snapshot=snapshot,
        catalog=runtime.rulesets,
        forecasts=services.forecasts,
        observations=services.observations,
        corrector=services.correctors.for_snapshot(snapshot),
        mode=mode,
        now=now,
    )
    services.day_cache[key] = (now, day)
    while len(services.day_cache) > DAY_CACHE_SIZE:
        del services.day_cache[next(iter(services.day_cache))]
    return day


# --- domain data as response models -----------------------------------------------------------------------------------


def ban_window(data: BanWindowData) -> BanWindow:
    return BanWindow.model_validate(asdict(data))


def zone_name(zone: Zone | None) -> PlanZone | None:
    return None if zone is None else PlanZone(zone.name.lower())


def plan_segments_model(segments: Sequence[PlanSegmentData]) -> list[PlanSegment]:
    return [
        PlanSegment(
            starts_at=s.starts_at,
            ends_at=s.ends_at,
            state=PlanState(s.state.value),
            zone=zone_name(s.zone),
            rule_id=s.rule_id,
            clause=s.clause,
        )
        for s in segments
    ]


def zone_hours_model(hours: Sequence[CrewHour]) -> list[ZoneHour]:
    return [ZoneHour(starts_at=h.starts_at, zone=zone_name(h.zone), level=h.level) for h in hours]


def ack_items_model(items: Sequence[AckItemData]) -> list[AckItem]:
    return [
        AckItem(
            id=item.id,
            zone=_ack_zone(item.zone),
            starts_at=item.starts_at,
            ends_at=item.ends_at,
            text_code=item.text_code,
        )
        for item in items
    ]


def _ack_zone(zone: Zone) -> Literal["medium", "high", "red"]:
    if zone is Zone.MEDIUM:
        return "medium"
    if zone is Zone.HIGH:
        return "high"
    return "red"


def validator_model(result: ValidationResult, start_utc: datetime) -> ValidatorResult:
    """The validator's verdict; half-open tick ranges become UTC instants from the timeline's start."""
    return ValidatorResult(
        passed=result.passed,
        violations=[
            ViolationModel(
                rule_id=v.rule_id,
                clause=v.clause,
                source_id=v.source_id,
                ranges=[
                    TimeRange(starts_at=start_utc + _TICK * first, ends_at=start_utc + _TICK * last)
                    for first, last in v.tick_ranges
                ],
                detail=v.detail,
            )
            for v in result.violations
        ],
        checked_rules=list(result.checked_rules),
    )


def label_code(state: str) -> Literal["plan.unsigned_fallback", "plan.changed_since_signed"] | None:
    return {"unsigned": "plan.unsigned_fallback", "changed_since_signed": "plan.changed_since_signed"}.get(state)  # type: ignore[return-value]


def shift_instants(shift: Sequence[ShiftBlock], local_date: date, tz: ZoneInfo) -> list[TimeRange]:
    def at(wall: time) -> datetime:
        return datetime.combine(local_date, wall, tzinfo=tz).astimezone(UTC)

    return [TimeRange(starts_at=at(block.start), ends_at=at(block.end)) for block in shift]


async def deny_if_foreign(
    *,
    services: Services,
    runtime: Runtime,
    principal: Principal,
    employer_id: str,
    site_id: str,
    operation: str,
) -> None:
    """Refuse a token of another employer: audit ``access.denied`` (operation name only) and answer 403.

    Raises:
        DomainProblem: 403 ``forbidden-employer`` when the principal's employer does not own the resource.
    """
    if principal.employer_id == employer_id:
        return
    await deny_access(
        principal=principal,
        site_id=site_id,
        epoch_id=await services.sites.active_epoch(site_id),
        operation=operation,
        identity=audit_identity(runtime.config.peek(), runtime.rulesets, policy_date(runtime.settings, services)),
        audit=services.audit,
    )
    raise forbidden_employer()


def suppressed_crew(snapshot: ConfigSnapshot, runtime: Runtime, local_date: date, member_count: int) -> bool:
    """True when the crew has fewer than ``k_exposure`` members. A day with no ruleset in force reads as suppressed
    (the protective answer), and the route then fails on the same ruleset with its own 422."""
    try:
        ruleset = ruleset_for(snapshot, runtime.rulesets, local_date).ruleset
    except LookupError:
        return True
    return member_count < effective_params(snapshot, ruleset).k_exposure


def plan_status_of(day: SiteDay) -> Literal["rule", "fallback"]:
    """The plan status of a day for a list or timeline: ``fallback`` unless the forecast is fresh (as ``day_plan``)."""
    return "fallback" if day.forecast_status != "fresh" else "rule"


async def signoff_state_of(
    *, services: Services, snapshot: ConfigSnapshot, runtime: Runtime, day: SiteDay, crew_id: str, epoch: int
) -> SignoffState:
    """The sign-off state of a crew for the day. No sign-off row means ``unsigned`` without planning; with one, the
    current plan is computed to compare hashes (a plan that cannot be computed reads as changed since signed)."""
    if await services.signoffs.latest(crew_id, day.local_date, epoch) is None:
        return "unsigned"
    try:
        planned = await plan_crew_day(
            services=services, snapshot=snapshot, catalog=runtime.rulesets, site_day=day, crew_id=crew_id
        )
    except (ShiftNotLegalError, PlannerBugError):
        return "changed_since_signed"
    return planned.state
