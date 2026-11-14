"""The day-plan use case: a crew's validated 5-minute plan for a site-day (ADR 0011, 0046, 0050, 0054, 0066).

``day_plan`` takes the site's zone timeline, applies the crew-lead stops of the site's ACTIVE epoch (the covered ticks
become Red, so the planner stops them and the validator checks them; the crew level of those hours is red), runs the
rule planner and then the independent validator on its output. What comes back is always a plan the validator passed;
the failures are split the way the API answers them:

* the published shift itself is not legal (hours, juvenile rules: only shift-origin violations) ->
  ``ShiftNotLegalError`` (422): no audit row, one structured warning. The same answer when the planner cannot place an
  Art. 18 break and the raw shift (every non-ban shift tick as work) already fails a shift rule;
* any plan-origin violation -> audit ``plan.validator_rejected`` (rule ids and counts only) and ``PlannerBugError``
  (500);
* the planner or the validator raising (``ValueError``, ``MissingClauseError``) with a legal shift -> audit
  ``plan.planner_failed`` (the exception class name only) and ``PlannerBugError``.

A stale forecast is planned as High on every tick (the label says "No fresh forecast: protective plan", ADR 0058);
``site_day`` shows the stale numbers themselves unchanged. No member data and no validator ``detail`` text reaches an
audit row or a stored plan; a stored plan of a suppressed crew carries ``restricted_headcount = null``.

A plan row is stored only when ``snapshot.version_id`` is not ``None`` (a database snapshot); the five identity
fields and the epoch id are on it. Nothing here pushes an alert (ADR 0058 decision 5).

``plan_segments`` merges the ticks into the runs the API shows (equal state, zone and rule), each with the ruleset
clause of its rule; Task 10 uses it as is.
"""

from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from typing import Final, Literal
from zoneinfo import ZoneInfo

import structlog
from pydantic import JsonValue

from stellar_blaze.application.runtime_config import ConfigSnapshot, ruleset_for
from stellar_blaze.application.site_day import SiteDay, effective_params
from stellar_blaze.domain.planner.rule_planner import plan_crew
from stellar_blaze.domain.plans.model import CrewPlan, CrewSpec, TickState, ZoneTimeline
from stellar_blaze.domain.plans.rules import PlannerRules, planner_rules
from stellar_blaze.domain.plans.ticks import TICK_MINUTES, day_ticks, in_ban
from stellar_blaze.domain.risk.levels import AlertLevel, Zone
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from stellar_blaze.domain.rules.ruleset import ClauseRef
from stellar_blaze.domain.validator.validator import MissingClauseError, ValidationResult, validate_plan
from stellar_blaze.ports.audit import AuditEvent, AuditKind, AuditLog
from stellar_blaze.ports.plans import CrewStopStore, DayPlanInput, DayPlanRecord, DayPlanStore
from stellar_blaze.ports.sites import SiteRepository

__all__ = [
    "CrewHour",
    "DayPlanResult",
    "PlanSegmentData",
    "PlannerBugError",
    "ShiftNotLegalError",
    "day_plan",
    "plan_segments",
]

logger = structlog.stdlib.get_logger(__name__)

_TICKS: Final = 216
_TICK: Final = timedelta(minutes=TICK_MINUTES)
_HOUR: Final = timedelta(hours=1)
_ACTOR: Final = "day_plan"
_ROLE: Final = "system"


class ShiftNotLegalError(Exception):
    """The published shift breaks a shift rule on its own (422 ``shift-not-legal``).

    ``result`` holds the shift violations.
    """

    def __init__(self, result: ValidationResult) -> None:
        super().__init__(
            "the published shift is not legal: " + ", ".join(sorted({v.rule_id for v in result.violations}))
        )
        self.result = result


class PlannerBugError(Exception):
    """The planner's output failed the validator, or the planner or validator itself failed (500 ``plan-invalid``).

    ``result`` is the validator's verdict when there is one; its ``detail`` strings are for logs, never for a response.
    """

    def __init__(self, reason: str, result: ValidationResult | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.result = result


@dataclass(frozen=True)
class CrewHour:
    """The zone and level of one hour for the crew: the site's, raised to Red/red by a crew-lead stop in the hour."""

    starts_at: datetime
    zone: Zone | None
    level: AlertLevel | None


@dataclass(frozen=True)
class PlanSegmentData:
    """A run of equal ticks, field for field the API's ``PlanSegment`` (``state`` is the ``TickState`` value)."""

    starts_at: datetime
    ends_at: datetime
    state: TickState
    zone: Zone | None
    rule_id: str
    clause: str


@dataclass(frozen=True)
class DayPlanResult:
    """A plan the validator passed, with what the response needs.

    ``zones`` is the crew's timeline (stops applied, stale made protective); ``hours`` are the 14 working-day hours for
    the crew; ``status`` is ``fallback`` when the forecast is not fresh or any attendance tick had no value.
    ``restricted_headcount`` is ``None`` for a suppressed crew. ``record`` is the stored row, ``None`` without a
    database snapshot.
    """

    plan: CrewPlan
    validation: ValidationResult
    suppressed: bool
    restricted_headcount: int | None
    status: Literal["rule", "fallback"]
    forecast_status: Literal["fresh", "stale", "fallback"]
    zones: ZoneTimeline
    hours: tuple[CrewHour, ...]
    epoch_id: int
    record: DayPlanRecord | None


def plan_segments(plan: CrewPlan, zones: ZoneTimeline, clauses: Mapping[str, ClauseRef]) -> tuple[PlanSegmentData, ...]:
    """The plan as merged runs of equal (state, zone, rule), each with its ruleset clause.

    The zone of a run is the timeline's zone, ``None`` for ``off`` and ``ban`` ticks. The rule of each tick is
    ``plan.tick_rules``.

    Raises:
        ValueError: The plan carries no ``tick_rules`` or has another length than the timeline.
        MissingClauseError: A tick's rule id has no clause entry.
    """
    if not plan.tick_rules or len(plan.states) != len(zones.zones):
        raise ValueError("plan_segments needs a plan with tick_rules and a timeline of the same length")
    segments: list[PlanSegmentData] = []
    for i, (state, rule) in enumerate(zip(plan.states, plan.tick_rules, strict=True)):
        zone = None if state in (TickState.OFF, TickState.BAN) else zones.zones[i]
        start = plan.start_utc + _TICK * i
        last = segments[-1] if segments else None
        if last is not None and (last.state, last.zone, last.rule_id) == (state, zone, rule):
            segments[-1] = replace(last, ends_at=start + _TICK)
            continue
        entry = clauses.get(rule)
        if entry is None:
            raise MissingClauseError(rule)
        segments.append(PlanSegmentData(start, start + _TICK, state, zone, rule, entry.clause))
    return tuple(segments)


def _stopped_mask(stops: list[tuple[datetime, datetime | None]], start: datetime) -> list[bool]:
    """Which ticks a stop covers: it overlaps the tick, from ``started_at`` and up to ``cleared_at`` (exclusive)."""
    mask = [False] * _TICKS
    for started, cleared in stops:
        for i in range(_TICKS):
            tick_start = start + _TICK * i
            if started < tick_start + _TICK and (cleared is None or cleared > tick_start):
                mask[i] = True
    return mask


def _protective(timeline: ZoneTimeline) -> ZoneTimeline:
    """Every tick at least High; each tick that was milder is flagged ``fallback`` (a stale forecast, ADR 0058)."""
    zones = [max(z, Zone.HIGH) for z in timeline.zones]
    fallback = [f or z < Zone.HIGH for f, z in zip(timeline.fallback, timeline.zones, strict=True)]
    return replace(timeline, zones=tuple(zones), fallback=tuple(fallback))


def _raw_shift_plan(
    crew: CrewSpec, plan_start: datetime, tz: ZoneInfo, local_date: date, rules: PlannerRules
) -> CrewPlan:
    """The published shift as a typed plan: work in every shift tick outside the ban window, ``ban`` inside it."""
    ticks = day_ticks(local_date, tz)
    banned = in_ban(ticks, local_date, tz, rules.labour)
    states: list[TickState] = []
    for i in range(_TICKS):
        local = (plan_start + _TICK * i).astimezone(tz).time()
        in_shift = any(block.start <= local < block.end for block in crew.shift)
        states.append(TickState.OFF if not in_shift else TickState.BAN if banned[i] else TickState.WORK)
    work = states.count(TickState.WORK) * TICK_MINUTES
    return CrewPlan(
        crew_id=crew.crew_id,
        local_date=local_date,
        start_utc=plan_start,
        states=tuple(states),
        rule_ids=(),
        status="rule",
        restricted_headcount=0,
        restrictions=(),
        work_minutes=work,
        adosh_rest_minutes=0,
        art18_minutes=0,
        stopped_minutes=0,
    )


async def day_plan(
    *,
    site_day: SiteDay,
    crew: CrewSpec,
    catalog: RulesetCatalog,
    snapshot: ConfigSnapshot,
    sites: SiteRepository,
    stops: CrewStopStore,
    plans: DayPlanStore,
    audit: AuditLog,
    k_exposure: int,
) -> DayPlanResult:
    """The crew's validated plan for ``site_day``.

    Args:
        site_day: The site's day (its timeline is the starting point).
        crew: The crew and its published shift, members included.
        catalog: The rulesets.
        snapshot: The active config snapshot; a plan row is stored only when it has a ``version_id``.
        sites: Resolves the site's active epoch.
        stops: The crew-lead stops (epoch-scoped).
        plans: Where a validated plan is stored.
        audit: Where a rejected or failed plan is recorded.
        k_exposure: The suppression threshold; a crew below it is ``suppressed``.

    Raises:
        ShiftNotLegalError: The published shift breaks a shift rule by itself (422).
        PlannerBugError: The plan failed validation, or the planner or validator raised (500); an audit row
            was appended.
        ConfigParametersError, RulesetIncompleteError, NoRulesetError, SiteNotFoundError: Deployment or caller faults.
    """
    local_date = site_day.local_date
    tz = ZoneInfo(site_day.site.timezone)
    loaded = ruleset_for(snapshot, catalog, local_date)
    ruleset = loaded.ruleset
    ruleset.require("clauses")
    if ruleset.clauses is None:  # unreachable after ``require``; narrows the optional section for the type checker
        raise RuntimeError("ruleset clauses are required")
    params = effective_params(snapshot, ruleset)
    rules = planner_rules(ruleset, params)
    clauses = ruleset.clauses.entries
    epoch = await sites.active_epoch(site_day.site.id)

    timeline = site_day.zones
    if site_day.forecast_status == "stale":
        timeline = _protective(timeline)
    start = timeline.start_utc
    found = await stops.active_between(crew.crew_id, start, start + _TICK * _TICKS, epoch)
    mask = _stopped_mask([(s.started_at, s.cleared_at) for s in found], start)
    if any(mask):
        timeline = timeline.with_zones([Zone.RED if m else z for m, z in zip(mask, timeline.zones, strict=True)])

    async def record(kind: AuditKind, outcome: str, detail: dict[str, JsonValue]) -> None:
        await audit.append(
            AuditEvent(
                kind=kind,
                actor=_ACTOR,
                actor_role=_ROLE,
                employer_id=crew.employer_id,
                site_id=site_day.site.id,
                epoch_id=epoch,
                outcome=outcome,
                detail={"crew_id": crew.crew_id, "local_date": local_date.isoformat(), **detail},
                ruleset_id=loaded.ruleset.meta.id,
                ruleset_sha256=loaded.sha256,
                model_id=site_day.identity.model_id,
                config_version_id=snapshot.version_id,
                config_sha256=snapshot.sha256,
            )
        )

    async def planner_failed(error: Exception) -> PlannerBugError:
        await record("plan.planner_failed", "failed", {"error": type(error).__name__})
        logger.error("day_plan.planner_failed", crew_id=crew.crew_id, error=type(error).__name__)
        return PlannerBugError(f"planner or validator failed: {type(error).__name__}")

    def not_legal(result: ValidationResult) -> ShiftNotLegalError:
        logger.warning(
            "day_plan.shift_not_legal",
            crew_id=crew.crew_id,
            rule_ids=sorted({v.rule_id for v in result.shift_violations}),
        )
        return ShiftNotLegalError(replace(result, violations=result.shift_violations))

    try:
        plan = plan_crew(crew, timeline, rules, local_date=local_date, tz=tz)
    except ValueError as error:
        # The planner cannot place an Art. 18 break for some shifts that already fail the hours rules: that is the
        # shift's fault (422), not the planner's. Judge the raw shift (work everywhere outside the ban) to tell which.
        try:
            raw = validate_plan(
                _raw_shift_plan(crew, timeline.start_utc, tz, local_date, rules),
                timeline,
                crew,
                rules,
                clauses,
                published_shift=crew.shift,
                tz=tz,
            )
        except (ValueError, MissingClauseError):
            raise await planner_failed(error) from error
        if raw.shift_violations:
            raise not_legal(raw) from error
        raise await planner_failed(error) from error

    try:
        validation = validate_plan(plan, timeline, crew, rules, clauses, published_shift=crew.shift, tz=tz)
    except (ValueError, MissingClauseError) as error:
        raise await planner_failed(error) from error

    if validation.violations:
        if not validation.plan_violations:
            raise not_legal(validation)
        per_rule: dict[str, int] = {}
        for violation in validation.violations:
            per_rule[violation.rule_id] = per_rule.get(violation.rule_id, 0) + 1
        await record(
            "plan.validator_rejected",
            "rejected",
            {
                "violations": len(validation.violations),
                "rules": [{"rule_id": rule, "count": n} for rule, n in sorted(per_rule.items())],
            },
        )
        logger.error("day_plan.validator_rejected", crew_id=crew.crew_id, rule_ids=sorted(per_rule))
        raise PlannerBugError("the rule planner produced a plan the validator rejects", validation)

    suppressed = crew.headcount < k_exposure
    restricted = None if suppressed else plan.restricted_headcount
    status: Literal["rule", "fallback"] = (
        "fallback" if site_day.forecast_status != "fresh" or plan.status == "fallback" else "rule"
    )
    hours = _crew_hours(site_day, mask, start)

    stored: DayPlanRecord | None = None
    if snapshot.version_id is not None:
        segments = plan_segments(plan, timeline, clauses)
        body: dict[str, JsonValue] = {
            "segments": [
                {
                    "starts_at": s.starts_at.isoformat(),
                    "ends_at": s.ends_at.isoformat(),
                    "state": s.state.value,
                    "zone": s.zone.name.lower() if s.zone is not None else None,
                    "rule_id": s.rule_id,
                }
                for s in segments
            ],
            "rule_ids": list(plan.rule_ids),
            "restrictions": list(plan.restrictions),
            "restricted_headcount": restricted,
            "work_minutes": plan.work_minutes,
            "adosh_rest_minutes": plan.adosh_rest_minutes,
            "art18_minutes": plan.art18_minutes,
            "stopped_minutes": plan.stopped_minutes,
            "forecast_status": site_day.forecast_status,
        }
        stored = await plans.insert(
            DayPlanInput(
                ruleset_id=loaded.ruleset.meta.id,
                ruleset_sha256=loaded.sha256,
                model_id=site_day.identity.model_id,
                config_version_id=snapshot.version_id,
                config_sha256=snapshot.sha256,
                epoch_id=epoch,
                crew_id=crew.crew_id,
                local_date=local_date,
                status=status,
                plan=body,
                violations=0,
            )
        )
    return DayPlanResult(
        plan=plan,
        validation=validation,
        suppressed=suppressed,
        restricted_headcount=restricted,
        status=status,
        forecast_status=site_day.forecast_status,
        zones=timeline,
        hours=hours,
        epoch_id=epoch,
        record=stored,
    )


def _crew_hours(site_day: SiteDay, mask: list[bool], start: datetime) -> tuple[CrewHour, ...]:
    out: list[CrewHour] = []
    for hour in site_day.hours:
        stopped = any(mask[i] for i in range(_TICKS) if hour.starts_at <= start + _TICK * i < hour.starts_at + _HOUR)
        if stopped:
            out.append(CrewHour(hour.starts_at, Zone.RED, AlertLevel.RED))
        else:
            out.append(CrewHour(hour.starts_at, hour.zone, hour.level))
    return tuple(out)
