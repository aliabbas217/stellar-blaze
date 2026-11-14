"""Alert events and their dispatch (ADR 0058, ADR 0046 decisions 7-8, ADR 0004; architect ruling R-O).

``plan_alert_events`` is the pure rule (ADR 0058 decision 1). For one target (a site, or a crew) it compares the day's
hourly level timeline with the last event of that target in the epoch:

* a MORE severe level creates an event at once (``escalate``; no dwell, however long the milder level held), with
  ``valid_from`` = the first hour of that run of equal levels;
* a MILDER level creates an event (``deescalate``) only once its run has held ``dwell_minutes`` AND it started after
  the level it replaces came into force (a milder hour before an already announced future level is not a step down);
* nothing is created earlier than ``lead_hours`` before ``valid_from``;
* an hour with no level (``None``) is no information: it never escalates and never de-escalates;
* an event of the same level as the last one is no event (its ``(epoch, target, level, valid_from)`` dedupe key
  would also refuse a repeat), EXCEPT when that level is already in force but the last event announced it for a later
  start: a crew stop turns a crew red now although red was announced from 12:00, and that is an ``escalate`` from the
  earlier start (otherwise "red now" would reach the crew only at 12:00).

``dispatch`` is the use case ``sb-jobs alerts dispatch`` runs. The crew level it computes includes the crew's active
stops of the ACTIVE epoch, through the same helpers ``day_plan`` uses (``stopped_mask``, ``crew_hours``), so a stop
recorded between two runs is escalated by the NEXT run: one immediate ``red`` crew event, no dwell, no sign-off wait
(there is no HTTP trigger, ADR 0058 decision 5). Cadence: ``alert_dispatch_interval_minutes`` of the active config is
stored on every ``alert_event`` row and in the one ``alerts.dispatched`` audit row each run writes, so the decision
record says how often the job was meant to run.

Sign-off never gates an alert (class (d) invariant): this module takes no sign-off store and reads no sign-off state;
``test_the_dispatch_import_graph_has_no_signoff`` fails if one is ever imported.

Delivery bookkeeping is append-only: ``alert_event.delivered/failed`` are fixed at INSERT, so each event is SENT first
and INSERTED after, with the counts. A crash between the send and the insert means the next run sends the event again
(at-least-once delivery; a push is idempotent for the reader: the same level again). With a file or env snapshot
(``version_id is None``) nothing is persisted and nothing is sent (``config_version`` 0).
"""

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Final, Literal

import structlog
from pydantic import JsonValue

from stellar_blaze.application.day_plan import crew_hours, stopped_mask
from stellar_blaze.application.runtime_config import ConfigSnapshot, ruleset_for
from stellar_blaze.application.site_day import SiteDay, effective_params
from stellar_blaze.domain.plans.model import CrewSpec
from stellar_blaze.domain.plans.ticks import TICK_MINUTES
from stellar_blaze.domain.risk.levels import AlertLevel
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from stellar_blaze.ports.alerts import AlertEventInput, AlertRecord, AlertStore
from stellar_blaze.ports.audit import AuditEvent, AuditLog
from stellar_blaze.ports.notifications import DeliveryResult, DeliveryStatus, OutboundMessage
from stellar_blaze.ports.plans import CrewStopStore
from stellar_blaze.ports.push import PushChannel, PushSubscriptionStore, SubscriptionRecord
from stellar_blaze.ports.sites import SiteRepository

__all__ = ["DispatchReport", "NewAlert", "dispatch", "plan_alert_events"]

logger = structlog.stdlib.get_logger(__name__)

_HOUR: Final = timedelta(hours=1)
_ORDER: Final = tuple(AlertLevel)  # declared in ascending severity
_SEND_CONCURRENCY: Final = 16
_ACTOR: Final = "alerts-dispatch"
_ROLE: Final = "system"
CHANGE_TEMPLATE: Final = "level-change"
END_TEMPLATE: Final = "level-end"  # the level fell back to green: the alert is over


@dataclass(frozen=True)
class NewAlert:
    """An event ``plan_alert_events`` wants created."""

    level: AlertLevel
    valid_from: datetime
    kind: Literal["escalate", "deescalate"]


def _rank(level: AlertLevel) -> int:
    return _ORDER.index(level)


def plan_alert_events(
    levels: Sequence[tuple[datetime, AlertLevel | None]],
    *,
    last: AlertRecord | None,
    now: datetime,
    dwell_minutes: int,
    lead_hours: int,
) -> tuple[NewAlert, ...]:
    """The events one target needs now, oldest first (see the module docstring for the rules).

    Args:
        levels: ``(hour start, level)`` pairs, the level of ``[start, start + 1 h)``; ``None`` is no level.
        last: The target's latest event in this epoch, or ``None`` (then the baseline is green: nothing was announced).
        now: The instant of the run (timezone-aware).
        dwell_minutes: How long a milder level must have held before it is announced.
        lead_hours: How far ahead of its ``valid_from`` an event may be created.
    """
    known = sorted((start, level) for start, level in levels if level is not None)
    runs: list[tuple[datetime, datetime, AlertLevel]] = []  # (start, end, level) of runs of equal levels
    for start, level in known:
        if runs and runs[-1][2] is level:
            runs[-1] = (runs[-1][0], start + _HOUR, level)
        else:
            runs.append((start, start + _HOUR, level))
    current = AlertLevel.GREEN if last is None else last.level
    in_force_from = None if last is None else last.valid_from
    lead = timedelta(hours=lead_hours)
    dwell = timedelta(minutes=dwell_minutes)
    created: list[NewAlert] = []
    for start, end, level in runs:
        if end <= now:
            continue  # over: the next run's comparison is with what is announced, not with history
        if start - lead > now:
            break  # later runs are later still
        if _rank(level) > _rank(current):
            created.append(NewAlert(level, start, "escalate"))
        elif _rank(level) < _rank(current):
            if (in_force_from is not None and start <= in_force_from) or now < start + dwell:
                continue
            created.append(NewAlert(level, start, "deescalate"))
        elif in_force_from is not None and start < in_force_from and start <= now:
            # The same level is in force NOW but was announced for a later start (a crew stop, or a forecast that moved
            # the level earlier): say so now, from the earlier start (a new dedupe key), never leave the crew waiting.
            created.append(NewAlert(level, start, "escalate"))
        else:
            continue
        current, in_force_from = level, start
    return tuple(created)


@dataclass(frozen=True)
class DispatchReport:
    """What one run did for one site. ``config_version`` is 0 and ``persisted`` False for a file or env snapshot."""

    site_id: str
    local_date: date
    config_version: int
    interval_minutes: int
    push_configured: bool
    persisted: bool
    events_created: int = 0
    delivered: int = 0
    failed: int = 0
    gone: int = 0
    events: tuple[AlertRecord, ...] = ()


@dataclass(frozen=True)
class _Target:
    crew_id: str | None
    levels: list[tuple[datetime, AlertLevel | None]]


def _dedupe_key(site_id: str, crew_id: str | None, alert: NewAlert) -> str:
    return f"{site_id}|{crew_id or '-'}|{alert.level.value}|{alert.valid_from:%Y%m%dT%H%M%SZ}"


async def dispatch(
    *,
    site_day: SiteDay,
    crews: Sequence[CrewSpec],
    sites: SiteRepository,
    stops: CrewStopStore,
    alerts: AlertStore,
    subs: PushSubscriptionStore,
    audit: AuditLog,
    channel: PushChannel | None,
    snapshot: ConfigSnapshot,
    catalog: RulesetCatalog,
    now: datetime,
) -> DispatchReport:
    """One dispatch run for the site of ``site_day``: create the events its site and crews need, send them, record them.

    Args:
        site_day: The site's day (its hourly levels and zone timeline).
        crews: The site's crews (their stops raise the crew level to red).
        sites: Resolves the site's active epoch.
        stops: The crew-lead stops (epoch-scoped).
        alerts: The append-only event store.
        subs: The Web Push subscriptions (epoch-scoped).
        audit: Where the one ``alerts.dispatched`` row goes.
        channel: The push channel, or ``None`` when push is not configured (events are still created and audited,
            deliveries count 0).
        snapshot: The active config snapshot; with no ``version_id`` nothing is persisted and nothing is sent.
        catalog: The rulesets (the tunables resolve against the one in force on the date).
        now: The DOMAIN time of the run (a replay clock in replay mode), timezone-aware.

    Raises:
        ConfigParametersError, NoRulesetError, RulesetIncompleteError, SiteNotFoundError: Deployment or caller faults.
    """
    local_date = site_day.local_date
    loaded = ruleset_for(snapshot, catalog, local_date)
    ruleset = loaded.ruleset
    ruleset.require("alerts")
    if ruleset.alerts is None:  # unreachable after ``require``; narrows the optional section for the type checker
        raise RuntimeError("ruleset section alerts is required")
    templates = ruleset.alerts.template_ids
    if CHANGE_TEMPLATE not in templates or END_TEMPLATE not in templates:
        raise ValueError(
            f"ruleset {ruleset.meta.id} must list the alert templates {CHANGE_TEMPLATE} and {END_TEMPLATE}"
        )
    params = effective_params(snapshot, ruleset)
    site_id = site_day.site.id
    base = DispatchReport(
        site_id=site_id,
        local_date=local_date,
        config_version=0 if snapshot.version_id is None else snapshot.version_id,
        interval_minutes=params.alert_dispatch_interval_minutes,
        push_configured=channel is not None,
        persisted=snapshot.version_id is not None,
    )
    if snapshot.version_id is None:
        logger.warning("alerts.not_persisted", site_id=site_id, reason="no database config snapshot")
        return base

    epoch = await sites.active_epoch(site_id)
    start = site_day.zones.start_utc
    end = start + timedelta(minutes=TICK_MINUTES * len(site_day.zones.zones))
    targets = [_Target(None, [(h.starts_at, h.level) for h in site_day.hours])]
    for crew in crews:
        found = await stops.active_between(crew.crew_id, start, end, epoch)
        mask = stopped_mask([(s.started_at, s.cleared_at) for s in found], start)
        targets.append(_Target(crew.crew_id, [(h.starts_at, h.level) for h in crew_hours(site_day, mask, start)]))

    created: list[AlertRecord] = []
    delivered = failed = gone = 0
    for target in targets:
        last = await alerts.last_for_target(site_id, target.crew_id, epoch)
        for alert in plan_alert_events(
            target.levels,
            last=last,
            now=now,
            dwell_minutes=params.deescalation_dwell_minutes,
            lead_hours=params.alert_lead_hours,
        ):
            message = OutboundMessage(
                site_id=site_id,
                audience="site" if target.crew_id is None else "crew",  # type: ignore[arg-type]
                crew_id=target.crew_id,
                level=alert.level,
                valid_from=alert.valid_from,
                template_id=END_TEMPLATE if alert.level is AlertLevel.GREEN else CHANGE_TEMPLATE,
            )
            results = await _send(channel, subs, message, epoch)
            ok = sum(r.status is DeliveryStatus.DELIVERED for r in results)
            bad = sum(r.status is DeliveryStatus.FAILED for r in results)
            record = await alerts.insert(
                AlertEventInput(
                    site_id=site_id,
                    audience=message.audience.value,
                    crew_id=target.crew_id,
                    epoch_id=epoch,
                    level=alert.level,
                    valid_from=alert.valid_from,
                    template_id=message.template_id,
                    kind=alert.kind,
                    dedupe_key=_dedupe_key(site_id, target.crew_id, alert),
                    delivered=ok,
                    failed=bad,
                    dispatch_interval_minutes=params.alert_dispatch_interval_minutes,
                    ruleset_id=site_day.identity.ruleset_id,
                    ruleset_sha256=site_day.identity.ruleset_sha256,
                    model_id=site_day.identity.model_id,
                    config_version_id=snapshot.version_id,
                    config_sha256=snapshot.sha256,
                )
            )
            delivered += ok
            failed += bad
            gone += sum(_is_gone(r) for r in results)
            if record is not None:
                created.append(record)
            logger.info(
                "alerts.event",
                site_id=site_id,
                crew_id=target.crew_id,
                alert_level=alert.level.value,
                kind=alert.kind,
                delivered=ok,
                failed=bad,
                stored=record is not None,
            )

    detail: dict[str, JsonValue] = {
        "site_id": site_id,
        "local_date": local_date.isoformat(),
        "events_created": len(created),
        "delivered": delivered,
        "failed": failed,
        "interval_minutes": params.alert_dispatch_interval_minutes,
        "push_configured": channel is not None,
    }
    await audit.append(
        AuditEvent(
            kind="alerts.dispatched",
            actor=_ACTOR,
            actor_role=_ROLE,
            employer_id=site_day.site.employer_id,
            site_id=site_id,
            epoch_id=epoch,
            outcome="dispatched",
            detail=detail,
            ruleset_id=site_day.identity.ruleset_id,
            ruleset_sha256=site_day.identity.ruleset_sha256,
            model_id=site_day.identity.model_id,
            config_version_id=snapshot.version_id,
            config_sha256=snapshot.sha256,
        )
    )
    return DispatchReport(
        site_id=site_id,
        local_date=local_date,
        config_version=snapshot.version_id,
        interval_minutes=params.alert_dispatch_interval_minutes,
        push_configured=channel is not None,
        persisted=True,
        events_created=len(created),
        delivered=delivered,
        failed=failed,
        gone=gone,
        events=tuple(created),
    )


def _is_gone(result: DeliveryResult) -> bool:
    return result.status is DeliveryStatus.FAILED and (result.detail or "").startswith("gone:")


async def _send(
    channel: PushChannel | None, subs: PushSubscriptionStore, message: OutboundMessage, epoch: int
) -> list[DeliveryResult]:
    """Deliver ``message`` to its subscriptions (a crew event to the crew's, a site event to the whole site's).

    A subscription the channel reports gone is deleted here too (idempotent; the Web Push channel already did), so the
    policy holds for any channel. A channel that raises counts as one failed delivery and never stops the run.
    """
    if channel is None:
        return []
    recipients: Sequence[SubscriptionRecord] = (
        await subs.for_site(message.site_id, epoch)
        if message.crew_id is None
        else await subs.for_crew(message.crew_id, epoch)
    )
    gate = asyncio.Semaphore(_SEND_CONCURRENCY)

    async def one(sub: SubscriptionRecord) -> DeliveryResult:
        async with gate:
            try:
                result = await channel.send_to(sub, message)
            except Exception as error:  # the contract says a result, not an exception: stay alive if one breaks it
                logger.error("alerts.channel_raised", subscription_id=sub.id, error=type(error).__name__)
                return DeliveryResult(channel=channel.name, status=DeliveryStatus.FAILED, detail="error:channel_raised")
        if _is_gone(result):
            await subs.delete_gone(sub.id)
        return result

    return list(await asyncio.gather(*(one(sub) for sub in recipients)))
