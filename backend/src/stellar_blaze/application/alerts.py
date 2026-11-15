"""Alert events and their dispatch (ADR 0058, ADR 0046 decisions 7-8, ADR 0004; architect ruling R-O).

``plan_alert_events`` is the pure rule (ADR 0058 decision 1). For one target (a site, or a crew) it compares the day's
hourly level timeline with the last event of that target in the epoch:

* a MORE severe level creates an event at once (``escalate``; no dwell, however long the milder level held), with
  ``valid_from`` = the first hour of that run of equal levels;
* a MILDER level creates an event (``deescalate``) only once its run has held ``dwell_minutes`` AND it does not end
  before the level it replaces comes into force (a milder stretch that ENDS before an already announced future level is
  not a step down; one that spans that start is, and so retracts an announcement the forecast has withdrawn);
* nothing is created earlier than ``lead_hours`` before ``valid_from``;
* an hour with no level (``None``) is no information: it never escalates and never de-escalates;
* an event of the same level as the last one is no event (its dedupe key would also refuse a repeat), EXCEPT when that
  level is already in force but the last event announced it for a later start: a crew stop turns a crew red now
  although red was announced from 12:00, and that is an ``escalate`` from the earlier start (otherwise "red now" would
  reach the crew only at 12:00).

``dispatch`` is the use case ``sb-jobs alerts dispatch`` runs. The crew level it computes includes the crew's active
stops of the ACTIVE epoch, through the same helpers ``day_plan`` uses (``stopped_mask``, ``stopped_hours``,
``crew_hours``, which call ``effective_stops``: a stop cleared within ``STOP_UNDO_WINDOW_S`` is ignored, an active one
ends with the crew's shift), so a stop
recorded between two runs is escalated by the NEXT run: one immediate ``red`` crew event, no dwell, no sign-off wait
(there is no HTTP trigger, ADR 0058 decision 5). Cadence: ``alert_dispatch_interval_minutes`` of the active config is
stored on every ``alert_event`` row and in the ``alerts.dispatched`` audit row of each run that created, delivered or
failed something (``job_run`` is the heartbeat), so the decision record says how often the job was meant to run.

Delivery design (the escalation SLA). A stop is delivered within one period PLUS the forecast-leg deadline PLUS one
delivery deadline of being recorded (about 5 min 45 s with the defaults: 300 s + 30 s + 12 s), whatever any weather
source or push service does: the worst case is a stop recorded just after the previous cycle read the stops; the next
cycle starts one period after that one STARTED, spends at most the forecast-leg deadline in phase A (the forecast fetch
is cut and the day falls back to the protective one, so the stop is still read and escalated), and its stop sends then
start at once in their own lane and end within one delivery deadline (this holds for an OPERATOR-RECORDED stop: see the
lanes below). ``prepare`` (phase A: every target of a site,
database reads only, no call to a push service) computes the new events and their recipients; ``deliver`` (phase B, over
every prepared site at once) sends them all concurrently, ORDERED by severity (escalations before de-escalations, higher
level first, crew before site: a stop is a red crew escalation, so it is early in the queue). Ordinary events, a
FORECAST-driven crew red included, share one bounded semaphore (16). An OPERATOR-RECORDED stop (the crew's red
escalation whose ``valid_from`` is an hour a crew-lead stop of the ``CrewStopStore`` covers,
``_Pending.operator_stop``) has a
RESERVED lane of its own: one ``asyncio.Semaphore`` PER STOP sized to the per-crew subscription cap (200), so all of its
recipients send at once and neither public subscriptions that hang nor another crew's flood nor another stop can queue
or delay them. The residual: a forecast-driven crew red is an ordinary-lane event and CAN be delayed (it waits its turn
behind hanging sends, up to one delivery deadline per batch of 16); an operator stop cannot. The connector of a pooling
channel is provisioned for the ordinary lane plus ``SIMULTANEOUS_STOPS_PROVISIONED`` stop lanes (``ports.push``).
Which hosts a push may go to is decided where the URL is accepted and again at send time (ADR 0067): the channel
refuses an endpoint whose host is not on the allow-list of push services at once (FAILED ``blocked``, no connection),
so hanging subscriptions on arbitrary hosts cannot occupy a lane (the residual above is then only a push service that
really hangs). ``deliver`` hands every send the ACTIVE snapshot's ``push_extra_host_suffixes`` (the operator's
extension of the list), read per run. Each send
is under a hard per-delivery deadline (the channel's timeout plus a margin) and the whole run under a per-run deadline
anchored at the START OF THE CYCLE (``period - margin``, phase A counts against it): a send that times out, or that
cannot start before the run deadline, counts as ``failed`` with detail ``deadline``, and the event row is still
inserted after its own sends. The job loop is fixed-rate (``jobs.alerts``): the next run starts one period after the
previous one STARTED. ``period = max(60 s, alert_dispatch_interval_minutes x 60)``.

Sign-off never gates an alert (class (d) invariant): this module takes no sign-off store and reads no sign-off state;
``test_the_dispatch_import_graph_has_no_signoff`` is the proof and fails if one is ever imported.

Delivery bookkeeping is append-only: ``alert_event.delivered/failed`` are fixed at INSERT, so each event is SENT first
and INSERTED after, with the counts. A crash between the send and the insert means the next run sends the event again
(at-least-once delivery; a push is idempotent for the reader: the same level again). Once the row IS stored the event
is never sent again: a failed delivery is not retried, so a stop is delivered AT MOST ONCE per recipient per event (a
failed stop push shows in the event row's ``failed`` count and in the ``alerts.dispatched`` audit row). The dedupe key
includes the id of the target's previous event (``none`` for the first): a retry of the same transition stays
deduped, while a legitimate revisit of an earlier level (red, green, red again) is a new event. The key is also looked
up BEFORE sending, so an event that is stored already is never sent again. With a file or env snapshot (``version_id is
None``) nothing is persisted and nothing is sent (``config_version`` 0).
"""

import asyncio
import dataclasses
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Final, Literal
from zoneinfo import ZoneInfo

import structlog
from pydantic import JsonValue

from stellar_blaze.application.day_plan import crew_hours, shift_end_utc, stopped_hours, stopped_mask
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
from stellar_blaze.ports.push import (
    MAX_SUBSCRIPTIONS_PER_CREW,
    ORDINARY_SEND_CONCURRENCY,
    PushChannel,
    PushSubscriptionStore,
    SubscriptionRecord,
)
from stellar_blaze.ports.sites import SiteRepository

__all__ = [
    "DeliveryLimits",
    "DispatchReport",
    "NewAlert",
    "Prepared",
    "deliver",
    "dispatch",
    "period_seconds",
    "plan_alert_events",
    "prepare",
]

logger = structlog.stdlib.get_logger(__name__)

_HOUR: Final = timedelta(hours=1)
_ORDER: Final = tuple(AlertLevel)  # declared in ascending severity
SEND_CONCURRENCY: Final = ORDINARY_SEND_CONCURRENCY
STOP_LANE_CONCURRENCY: Final = MAX_SUBSCRIPTIONS_PER_CREW  # the size of EACH operator stop's own reserved lane
MIN_PERIOD_S: Final = 60.0
RUN_MARGIN_S: Final = 10.0  # the run deadline is the period minus this: a run ends before the next one starts
DELIVERY_MARGIN_S: Final = 2.0  # the per-delivery deadline is the channel's own timeout plus this
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
            if (in_force_from is not None and end <= in_force_from) or now < start + dwell:
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


def period_seconds(interval_minutes: int) -> float:
    """The dispatch period: ``max(60 s, interval x 60)`` (the tunable's own minimum is one minute)."""
    return max(MIN_PERIOD_S, interval_minutes * 60.0)


@dataclass(frozen=True)
class DeliveryLimits:
    """Bounds of phase B. ``None`` deadlines are derived: the channel's timeout plus a margin, and the period minus a
    margin. ``monotonic`` is injectable (a test advances it). ``started_at`` is the ``monotonic`` reading at the START
    OF THE CYCLE: the run deadline is anchored there (phase A counts against the budget); ``None`` anchors it at the
    start of ``deliver``. ``stop_concurrency`` is the size of the reserved lane of EACH operator-recorded stop (a
    semaphore per stop)."""

    concurrency: int = SEND_CONCURRENCY
    delivery_deadline_s: float | None = None
    run_budget_s: float | None = None
    monotonic: Callable[[], float] = time.monotonic
    started_at: float | None = None
    stop_concurrency: int = STOP_LANE_CONCURRENCY


@dataclass(frozen=True)
class _Target:
    crew_id: str | None
    levels: list[tuple[datetime, AlertLevel | None]]
    stopped: frozenset[datetime] = frozenset()  # the hours an operator-recorded stop covers (crews only)


@dataclass(frozen=True)
class _Pending:
    """One event to send and store, with the recipients resolved in phase A."""

    alert: NewAlert
    message: OutboundMessage
    key: str
    recipients: tuple[SubscriptionRecord, ...]
    after: int | None  # index of the previous event of the same target in ``Prepared.pending``: stored before this one
    operator_stop: bool = False  # origin: a crew-lead stop (reserved lane), not a forecast (internal, not in the API)


@dataclass(frozen=True)
class Prepared:
    """Phase A's result for one site: what ``deliver`` sends and stores. ``report`` is the zero-event report."""

    report: DispatchReport
    site_day: SiteDay
    epoch: int
    snapshot: ConfigSnapshot
    pending: tuple[_Pending, ...] = ()


def _dedupe_key(site_id: str, crew_id: str | None, alert: NewAlert, predecessor: str) -> str:
    return f"{site_id}|{crew_id or '-'}|{alert.level.value}|{alert.valid_from:%Y%m%dT%H%M%SZ}|{predecessor}"


async def prepare(
    *,
    site_day: SiteDay,
    crews: Sequence[CrewSpec],
    sites: SiteRepository,
    stops: CrewStopStore,
    alerts: AlertStore,
    subs: PushSubscriptionStore,
    channel_configured: bool,
    snapshot: ConfigSnapshot,
    catalog: RulesetCatalog,
    now: datetime,
) -> Prepared:
    """Phase A for the site of ``site_day``: the events its site and crews need now, with their recipients.

    Reads the database only (the epoch, the stops, the last event of every target, the subscriptions): it calls no push
    service, so it is quick however any of them behaves. An event whose dedupe key is stored already is dropped here
    (it must never be sent again).

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
    report = DispatchReport(
        site_id=site_id,
        local_date=local_date,
        config_version=0 if snapshot.version_id is None else snapshot.version_id,
        interval_minutes=params.alert_dispatch_interval_minutes,
        push_configured=channel_configured,
        persisted=snapshot.version_id is not None,
    )
    if snapshot.version_id is None:
        logger.warning("alerts.not_persisted", site_id=site_id, reason="no database config snapshot")
        return Prepared(report, site_day, 0, snapshot)

    epoch = await sites.active_epoch(site_id)
    tz = ZoneInfo(site_day.site.timezone)
    start = site_day.zones.start_utc
    end = start + timedelta(minutes=TICK_MINUTES * len(site_day.zones.zones))
    targets = [_Target(None, [(h.starts_at, h.level) for h in site_day.hours])]
    for crew in crews:
        found = await stops.active_between(crew.crew_id, start, end, epoch)
        mask = stopped_mask(
            [(s.started_at, s.cleared_at) for s in found], start, shift_end_utc(crew.shift, local_date, tz)
        )
        targets.append(
            _Target(
                crew.crew_id,
                [(h.starts_at, h.level) for h in crew_hours(site_day, mask, start)],
                stopped_hours(site_day, mask, start),
            )
        )

    pending: list[_Pending] = []
    for target in targets:
        last = await alerts.last_for_target(site_id, target.crew_id, epoch)
        base = "none" if last is None else str(last.id)
        recipients: tuple[SubscriptionRecord, ...] | None = None
        previous: int | None = None
        planned = plan_alert_events(
            target.levels,
            last=last,
            now=now,
            dwell_minutes=params.deescalation_dwell_minutes,
            lead_hours=params.alert_lead_hours,
        )
        for step, alert in enumerate(planned):
            key = _dedupe_key(site_id, target.crew_id, alert, base if step == 0 else f"{base}.{step}")
            if await alerts.exists(epoch, key):
                continue  # stored already (another run, or a crash after the insert): never send it again
            if recipients is None:
                recipients = tuple(
                    await subs.for_site(site_id, epoch)
                    if target.crew_id is None
                    else await subs.for_crew(target.crew_id, epoch)
                )
            message = OutboundMessage(
                site_id=site_id,
                audience="site" if target.crew_id is None else "crew",  # type: ignore[arg-type]
                crew_id=target.crew_id,
                level=alert.level,
                valid_from=alert.valid_from,
                template_id=END_TEMPLATE if alert.level is AlertLevel.GREEN else CHANGE_TEMPLATE,
            )
            operator_stop = (
                target.crew_id is not None
                and alert.level is AlertLevel.RED
                and alert.kind == "escalate"
                and alert.valid_from in target.stopped
            )
            pending.append(_Pending(alert, message, key, recipients, previous, operator_stop))
            previous = len(pending) - 1
    return Prepared(report, site_day, epoch, snapshot, tuple(pending))


def _priority(item: _Pending) -> tuple[int, int, int]:
    """Send order: escalations first, then the higher level, then crew before site (a stop is a red crew escalation).

    Severity comes first on purpose: inside ONE target a later, more severe planned event is therefore sent BEFORE an
    earlier, milder one (the wire order can invert the planned order; the client reads each event's ``valid_from``, and
    the most severe announcement must not wait behind a milder one). The rows are still stored in planned order."""
    return (0 if item.alert.kind == "escalate" else 1, -_rank(item.alert.level), 0 if item.message.crew_id else 1)


def _is_stop(item: _Pending) -> bool:
    """An OPERATOR-RECORDED stop: a crew red escalation that starts at an hour a stop row of the ``CrewStopStore``
    covers (what a crew-lead stop produces); it gets a reserved lane. A forecast-driven crew red is NOT one (it starts
    at an hour no stop covers): it is an ordinary-lane event, because a flood of forecast reds across crews must never
    queue an operator's stop. The origin is decided in ``prepare`` from the stop rows, never from level and kind."""
    return item.operator_stop


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
    limits: DeliveryLimits | None = None,
) -> DispatchReport:
    """One dispatch run for the site of ``site_day``: ``prepare`` then ``deliver`` (see the module docstring).

    Args:
        site_day: The site's day (its hourly levels and zone timeline).
        crews: The site's crews (their stops raise the crew level to red).
        sites: Resolves the site's active epoch.
        stops: The crew-lead stops (epoch-scoped).
        alerts: The append-only event store.
        subs: The Web Push subscriptions (epoch-scoped).
        audit: Where the ``alerts.dispatched`` row goes (only for a run that created, delivered or failed something).
        channel: The push channel, or ``None`` when push is not configured (events are still created and audited,
            deliveries count 0).
        snapshot: The active config snapshot; with no ``version_id`` nothing is persisted and nothing is sent.
        catalog: The rulesets (the tunables resolve against the one in force on the date).
        now: The DOMAIN time of the run (a replay clock in replay mode), timezone-aware.
        limits: Phase B bounds (defaults: 16 concurrent sends for ordinary events and a reserved 200-send lane PER
            operator-recorded stop, the channel's timeout plus 2 s per send, the period minus 10 s for the run).

    Raises:
        ConfigParametersError, NoRulesetError, RulesetIncompleteError, SiteNotFoundError: Deployment or caller faults.
    """
    prepared = await prepare(
        site_day=site_day,
        crews=crews,
        sites=sites,
        stops=stops,
        alerts=alerts,
        subs=subs,
        channel_configured=channel is not None,
        snapshot=snapshot,
        catalog=catalog,
        now=now,
    )
    [report] = await deliver([prepared], channel=channel, alerts=alerts, subs=subs, audit=audit, limits=limits)
    return report


async def deliver(
    prepared: Sequence[Prepared],
    *,
    channel: PushChannel | None,
    alerts: AlertStore,
    subs: PushSubscriptionStore,
    audit: AuditLog,
    limits: DeliveryLimits | None = None,
) -> list[DispatchReport]:
    """Phase B over every prepared site at once: send the events concurrently (severity first), store each after its own
    sends, then write the ``alerts.dispatched`` row of each site that created, delivered or failed something.

    One failing insert does not stop the others: every event is stored (or tried) and the first error is raised after.
    """
    bounds = limits or DeliveryLimits()
    mono = bounds.monotonic
    interval = min((p.report.interval_minutes for p in prepared), default=5)
    budget = bounds.run_budget_s if bounds.run_budget_s is not None else period_seconds(interval) - RUN_MARGIN_S
    per_send = bounds.delivery_deadline_s
    if per_send is None:
        per_send = (channel.timeout_s if channel is not None else 0.0) + DELIVERY_MARGIN_S
    run_deadline = (mono() if bounds.started_at is None else bounds.started_at) + budget
    gate = asyncio.Semaphore(bounds.concurrency)

    async def send(
        active: PushChannel,
        sub: SubscriptionRecord,
        message: OutboundMessage,
        lane: asyncio.Semaphore,
        extra_hosts: Sequence[str],
    ) -> DeliveryResult:
        async with lane:
            remaining = run_deadline - mono()
            if remaining <= 0:
                return DeliveryResult(channel=active.name, status=DeliveryStatus.FAILED, detail="deadline")
            try:
                result = await asyncio.wait_for(
                    active.send_to(sub, message, extra_host_suffixes=extra_hosts), timeout=min(per_send, remaining)
                )
            except TimeoutError:
                logger.error("alerts.send_deadline", subscription_id=sub.id)
                return DeliveryResult(channel=active.name, status=DeliveryStatus.FAILED, detail="deadline")
            except Exception as error:  # the contract says a result, not an exception: stay alive if one breaks it
                logger.error("alerts.channel_raised", subscription_id=sub.id, error=type(error).__name__)
                return DeliveryResult(channel=active.name, status=DeliveryStatus.FAILED, detail="error:channel_raised")
        if _is_gone(result):
            await subs.delete_gone(sub.id)
        return result

    # (site index, event index) in send order. Tasks are created in this order and the semaphore wakes in FIFO order,
    # so the most severe event's sends are first in the queue whatever the others do.
    order = sorted(
        ((i, j) for i, p in enumerate(prepared) for j in range(len(p.pending))),
        key=lambda ij: _priority(prepared[ij[0]].pending[ij[1]]),
    )
    sends: dict[tuple[int, int], list[asyncio.Task[DeliveryResult]]] = {}
    for i, j in order:
        item = prepared[i].pending[j]
        # One lane PER operator stop: a stop has at most ``stop_concurrency`` (the per-crew cap) recipients, so its own
        # semaphore never makes one of them wait, and no other stop or event can take a slot of it.
        lane = asyncio.Semaphore(bounds.stop_concurrency) if _is_stop(item) else gate
        # The endpoint host allow-list (ADR 0067) is the built-in list plus what the ACTIVE config of this run adds
        # (``push_extra_host_suffixes``): the channel refuses any other host at send time, at once (FAILED ``blocked``).
        extra_hosts = prepared[i].snapshot.config.push_extra_host_suffixes
        sends[(i, j)] = (
            [asyncio.create_task(send(channel, sub, item.message, lane, extra_hosts)) for sub in item.recipients]
            if channel is not None
            else []
        )
    stored: dict[tuple[int, int], asyncio.Future[None]] = {
        (i, j): asyncio.get_running_loop().create_future() for i, j in order
    }
    totals = [[0, 0, 0] for _ in prepared]  # delivered, failed, gone
    created: list[list[AlertRecord]] = [[] for _ in prepared]

    async def finish(i: int, j: int) -> None:
        item = prepared[i].pending[j]
        day, snap = prepared[i].site_day, prepared[i].snapshot
        try:
            results = await asyncio.gather(*sends[(i, j)])
            if item.after is not None:
                await stored[(i, item.after)]  # one target's events are stored in the order they were planned
            ok = sum(r.status is DeliveryStatus.DELIVERED for r in results)
            bad = sum(r.status is DeliveryStatus.FAILED for r in results)
            record = await alerts.insert(
                AlertEventInput(
                    site_id=day.site.id,
                    audience=item.message.audience.value,
                    crew_id=item.message.crew_id,
                    epoch_id=prepared[i].epoch,
                    level=item.alert.level,
                    valid_from=item.alert.valid_from,
                    template_id=item.message.template_id,
                    kind=item.alert.kind,
                    dedupe_key=item.key,
                    delivered=ok,
                    failed=bad,
                    dispatch_interval_minutes=prepared[i].report.interval_minutes,
                    ruleset_id=day.identity.ruleset_id,
                    ruleset_sha256=day.identity.ruleset_sha256,
                    model_id=day.identity.model_id,
                    config_version_id=snap.version_id or 0,
                    config_sha256=snap.sha256,
                )
            )
        except BaseException as error:
            stored[(i, j)].set_exception(error)
            stored[(i, j)].exception()  # mark retrieved: the error itself is re-raised through ``gather`` below
            raise
        stored[(i, j)].set_result(None)
        totals[i][0] += ok
        totals[i][1] += bad
        totals[i][2] += sum(_is_gone(r) for r in results)
        if record is not None:
            created[i].append(record)
        logger.info(
            "alerts.event",
            site_id=day.site.id,
            crew_id=item.message.crew_id,
            alert_level=item.alert.level.value,
            kind=item.alert.kind,
            delivered=ok,
            failed=bad,
            stored=record is not None,
        )

    outcomes = await asyncio.gather(*(finish(i, j) for i, j in order), return_exceptions=True)
    reports: list[DispatchReport] = []
    for i, p in enumerate(prepared):
        delivered, failed, gone = totals[i]
        report = dataclasses.replace(
            p.report,
            events_created=len(created[i]),
            delivered=delivered,
            failed=failed,
            gone=gone,
            events=tuple(created[i]),
        )
        reports.append(report)
        if report.persisted and (report.events_created or delivered or failed):
            await audit.append(_audit_event(p, report))
    for outcome in outcomes:
        if isinstance(outcome, BaseException):
            raise outcome
    return reports


def _audit_event(prepared: Prepared, report: DispatchReport) -> AuditEvent:
    day, snap = prepared.site_day, prepared.snapshot
    detail: dict[str, JsonValue] = {
        "site_id": report.site_id,
        "local_date": report.local_date.isoformat(),
        "events_created": report.events_created,
        "delivered": report.delivered,
        "failed": report.failed,
        "interval_minutes": report.interval_minutes,
        "push_configured": report.push_configured,
    }
    return AuditEvent(
        kind="alerts.dispatched",
        actor=_ACTOR,
        actor_role=_ROLE,
        employer_id=day.site.employer_id,
        site_id=report.site_id,
        epoch_id=prepared.epoch,
        outcome="dispatched",
        detail=detail,
        ruleset_id=day.identity.ruleset_id,
        ruleset_sha256=day.identity.ruleset_sha256,
        model_id=day.identity.model_id,
        config_version_id=snap.version_id,
        config_sha256=snap.sha256,
    )


def _is_gone(result: DeliveryResult) -> bool:
    return result.status is DeliveryStatus.FAILED and (result.detail or "").startswith("gone:")
