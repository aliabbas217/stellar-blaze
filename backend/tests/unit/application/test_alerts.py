"""Alert events (ADR 0058 decision 1) and the dispatch use case: escalate now, de-escalate after the dwell, nothing
earlier than the lead window, dedupe, a stop escalated by the next run, the cadence recorded, sign-off never a gate."""

import ast
import asyncio
import dataclasses
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from stellar_blaze.adapters.fakes.alerts import InMemoryAlertStore
from stellar_blaze.adapters.fakes.audit import InMemoryAuditLog
from stellar_blaze.adapters.fakes.notifications import RecordingPushChannel
from stellar_blaze.adapters.fakes.plans import InMemoryCrewStopStore
from stellar_blaze.adapters.fakes.push import InMemoryPushStore
from stellar_blaze.adapters.fakes.sites import InMemorySiteStore
from stellar_blaze.application import alerts as alerts_module
from stellar_blaze.application.alerts import DispatchReport, NewAlert, dispatch, plan_alert_events
from stellar_blaze.application.site_day import SiteDay
from stellar_blaze.domain.plans.model import CrewSpec
from stellar_blaze.domain.risk.levels import AlertLevel
from stellar_blaze.ports.alerts import AlertRecord
from stellar_blaze.ports.notifications import DeliveryResult, DeliveryStatus
from stellar_blaze.ports.push import NewSubscription
from tests.unit.application.serving_support import (
    GREEN_DAY,
    catalog,
    day_of,
    forecasts_of,
    make_site_day,
    snapshot,
)
from tests.unit.contract.b3_world import SITE_ID, demo_fixture

pytestmark = [pytest.mark.unit]

G, A, OR, R = AlertLevel.GREEN, AlertLevel.AMBER, AlertLevel.ORANGE, AlertLevel.RED
T0 = datetime(2026, 7, 1, 2, tzinfo=UTC)  # 06:00 Asia/Dubai, the first of the 14 hours
HOUR = timedelta(hours=1)
SHA = "d" * 64


def hourly(*levels: AlertLevel | None, first: datetime = T0) -> list[tuple[datetime, AlertLevel | None]]:
    return [(first + HOUR * i, level) for i, level in enumerate(levels)]


def event(level: AlertLevel, valid_from: datetime, *, kind: str = "escalate", crew: str | None = None) -> AlertRecord:
    return AlertRecord(
        id=1,
        created_at=T0,
        site_id=SITE_ID,
        audience="site" if crew is None else "crew",
        crew_id=crew,
        epoch_id=1,
        level=level,
        valid_from=valid_from,
        template_id="level-change",
        kind=kind,  # type: ignore[arg-type]
        dedupe_key=f"k-{level.value}-{valid_from.isoformat()}",
        dispatch_interval_minutes=5,
        ruleset_id="r",
        ruleset_sha256=SHA,
        model_id=None,
        config_version_id=1,
        config_sha256=SHA,
    )


def plan(
    levels: Sequence[tuple[datetime, AlertLevel | None]],
    *,
    last: AlertRecord | None = None,
    now: datetime = T0,
    dwell: int = 60,
    lead: int = 12,
) -> tuple[NewAlert, ...]:
    return plan_alert_events(levels, last=last, now=now, dwell_minutes=dwell, lead_hours=lead)


def kinds(events: Sequence[NewAlert]) -> list[tuple[AlertLevel, str]]:
    return [(e.level, e.kind) for e in events]


# --- pure planning ----------------------------------------------------------------------------------------------------


def test_escalation_is_immediate() -> None:
    found = plan(hourly(A, A, R, R), last=event(A, T0), now=T0 + HOUR)

    assert kinds(found) == [(R, "escalate")]
    assert found[0].valid_from == T0 + 2 * HOUR  # the first hour at that level, announced two hours ahead


def test_a_first_alert_compares_with_green_and_a_green_day_makes_none() -> None:
    assert plan(hourly(G, G, G)) == ()
    assert kinds(plan(hourly(G, OR, OR))) == [(OR, "escalate")]


def test_deescalation_waits_for_dwell() -> None:
    levels = hourly(R, R, A, A, A)  # amber from 08:00Z
    last = event(R, T0)

    assert plan(levels, last=last, now=T0 + 2 * HOUR + timedelta(minutes=55)) == ()
    held = plan(levels, last=last, now=T0 + 3 * HOUR)
    assert kinds(held) == [(A, "deescalate")]
    assert held[0].valid_from == T0 + 2 * HOUR


def test_a_zero_dwell_deescalates_at_once() -> None:
    assert kinds(plan(hourly(R, A, A), last=event(R, T0), now=T0 + HOUR, dwell=0)) == [(A, "deescalate")]


def test_lead_hours_window() -> None:
    levels = hourly(G, G, G, G, G, OR)  # orange from T0 + 5 h
    last = event(G, T0)

    assert plan(levels, last=last, now=T0, lead=4) == ()  # 5 h ahead is outside a 4 h window
    inside = plan(levels, last=last, now=T0 + HOUR, lead=4)
    assert kinds(inside) == [(OR, "escalate")]  # exactly 4 h ahead is inside


def test_dedupe() -> None:
    levels = hourly(A, A, A)

    assert plan(levels, last=event(A, T0)) == ()  # the same level again is no event
    assert plan(levels, last=event(A, T0 - HOUR)) == ()  # even from another start


def test_none_levels_never_deescalate_or_escalate() -> None:
    assert plan(hourly(None, None, None), last=event(R, T0), now=T0 + 3 * HOUR) == ()
    assert plan(hourly(R, None, None, None), last=event(R, T0), now=T0 + 3 * HOUR) == ()


def test_a_milder_hour_before_an_announced_future_level_is_not_a_deescalation() -> None:
    """Red was announced from 08:00Z (a lead-window event); the amber hours before it are not a step down."""
    found = plan(hourly(A, A, R, R), last=event(R, T0 + 2 * HOUR), now=T0 + 90 * timedelta(minutes=1))

    assert found == ()


def test_a_revised_forecast_that_is_red_now_escalates_over_a_future_announcement() -> None:
    found = plan(hourly(R, R, R), last=event(A, T0 + 2 * HOUR), now=T0 + HOUR)

    assert kinds(found) == [(R, "escalate")]


def test_a_level_in_force_now_that_was_announced_for_later_is_announced_again_from_now() -> None:
    """Red was announced from 08:00Z; a stop (or a revised forecast) makes it red from 06:00Z, and it is 06:30Z."""
    found = plan(hourly(R, R, R), last=event(R, T0 + 2 * HOUR), now=T0 + timedelta(minutes=30))

    assert kinds(found) == [(R, "escalate")]
    assert found[0].valid_from == T0
    # Once announced from the earlier start, it is not announced again.
    assert plan(hourly(R, R, R), last=event(R, T0), now=T0 + timedelta(minutes=35)) == ()
    # Not yet in force (starts later than now): wait for it, nothing now.
    assert plan(hourly(G, R, R), last=event(R, T0 + 2 * HOUR), now=T0) == ()


def test_a_green_that_ends_an_alert_is_a_level_end() -> None:
    found = plan(hourly(R, G, G), last=event(R, T0), now=T0 + 2 * HOUR)

    assert kinds(found) == [(G, "deescalate")]


@given(
    dwell=st.integers(0, 180),
    first=st.sampled_from([G, A, OR]),
    offset=st.integers(0, 3),
)
def test_dwell_never_delays_escalation_property(dwell: int, first: AlertLevel, offset: int) -> None:
    worse = {G: [A, OR, R], A: [OR, R], OR: [R]}[first]
    for level in worse:
        levels = hourly(*([first] * offset), level, level)
        found = plan(levels, last=event(first, T0 - HOUR), now=T0 + HOUR * offset, dwell=dwell)
        assert kinds(found) == [(level, "escalate")]


# --- dispatch ---------------------------------------------------------------------------------------------------------


def levels_of(day: SiteDay, by_utc_hour: Mapping[int, AlertLevel | None]) -> SiteDay:
    """``day`` with the hour levels set by UTC hour (the other hours stay green)."""
    hours = tuple(dataclasses.replace(h, level=by_utc_hour.get(h.starts_at.hour, G)) for h in day.hours)
    return dataclasses.replace(day, hours=hours)


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


@dataclasses.dataclass
class World:
    sites: InMemorySiteStore
    audit: InMemoryAuditLog
    stops: InMemoryCrewStopStore
    alerts: InMemoryAlertStore
    subs: InMemoryPushStore
    channel: RecordingPushChannel
    clock: Clock
    day: SiteDay
    crews: list[CrewSpec]

    async def run(
        self,
        now: datetime,
        *,
        config: object | None = None,
        channel: RecordingPushChannel | bool | None = True,
    ) -> DispatchReport:
        chosen = self.channel if channel is True else channel
        return await dispatch(
            site_day=self.day,
            crews=self.crews,
            sites=self.sites,
            stops=self.stops,
            alerts=self.alerts,
            subs=self.subs,
            audit=self.audit,
            channel=chosen or None,
            snapshot=config or snapshot(version_id=3),  # type: ignore[arg-type]
            catalog=catalog(),
            now=now,
        )

    async def subscribe(self, endpoint: str, crew: str | None = None) -> str:
        epoch = await self.sites.active_epoch(SITE_ID)
        return await self.subs.upsert_by_endpoint(
            NewSubscription(endpoint=endpoint, p256dh="k", auth="a", site_id=SITE_ID, crew_id=crew), epoch
        )

    def crew_events(self, crew_id: str) -> list[AlertRecord]:
        return [r for r in self.alerts.records if r.crew_id == crew_id]

    def site_events(self) -> list[AlertRecord]:
        return [r for r in self.alerts.records if r.crew_id is None]


async def world(by_utc_hour: Mapping[int, AlertLevel | None] | None = None) -> World:
    clock = Clock(datetime(2026, 7, 1, 1, 0, tzinfo=UTC))
    audit = InMemoryAuditLog(clock)
    sites = InMemorySiteStore(audit)
    await sites.upsert_fixture(demo_fixture(), "test")
    day = levels_of(await make_site_day(forecasts_of(day_of(GREEN_DAY))), by_utc_hour or {})
    crews = [await sites.crew_spec(c.id) for c in await sites.list_crews(SITE_ID)]
    return World(
        sites,
        audit,
        InMemoryCrewStopStore(clock),
        InMemoryAlertStore(clock),
        InMemoryPushStore(clock),
        RecordingPushChannel(),
        clock,
        day,
        crews,
    )


AMBER_FROM_10 = dict.fromkeys(range(6, 16), A)  # amber from 10:00 local on


@pytest.mark.asyncio
async def test_site_events_go_to_site_subscriptions_and_crew_events_to_crew_subscriptions() -> None:
    w = await world(AMBER_FROM_10)
    site_sub = await w.subscribe("https://push.example/site")
    crew_sub = await w.subscribe("https://push.example/crew-b", crew="crew-b")

    report = await w.run(datetime(2026, 7, 1, 3, tzinfo=UTC))

    assert report.events_created == 1 + len(w.crews)  # the site and every crew see the same amber
    assert {(m.audience.value, m.crew_id) for _, m in w.channel.sent} == {("site", None), ("crew", "crew-b")}
    site_recipients = {s for s, m in w.channel.sent if m.crew_id is None}
    crew_recipients = {s for s, m in w.channel.sent if m.crew_id == "crew-b"}
    assert site_recipients == {site_sub, crew_sub}  # a site push reaches every subscription of the site
    assert crew_recipients == {crew_sub}  # a crew push only the subscriptions of that crew
    assert all(m.template_id == "level-change" for _, m in w.channel.sent)


@pytest.mark.asyncio
async def test_rows_carry_identity_epoch_counts_and_the_interval() -> None:
    w = await world(AMBER_FROM_10)
    await w.subscribe("https://push.example/a")
    await w.subscribe("https://push.example/b")

    await w.run(datetime(2026, 7, 1, 3, tzinfo=UTC))

    [site_row] = w.site_events()
    assert (site_row.level, site_row.kind, site_row.delivered, site_row.failed) == (A, "escalate", 2, 0)
    assert (site_row.ruleset_id, site_row.config_version_id, site_row.config_sha256) == ("ae-heat-2026.1", 3, "c" * 64)
    assert site_row.epoch_id == 1
    assert len(site_row.ruleset_sha256) == 64
    assert site_row.valid_from == datetime(2026, 7, 1, 6, tzinfo=UTC)


@pytest.mark.asyncio
async def test_a_second_run_with_nothing_new_creates_nothing() -> None:
    w = await world(AMBER_FROM_10)

    first = await w.run(datetime(2026, 7, 1, 3, tzinfo=UTC))
    second = await w.run(datetime(2026, 7, 1, 3, 5, tzinfo=UTC))

    assert first.events_created > 0
    assert second.events_created == 0


@pytest.mark.asyncio
async def test_stop_recorded_between_two_dispatch_runs_is_escalated_by_the_next_run() -> None:
    w = await world(AMBER_FROM_10)
    await w.subscribe("https://push.example/crew-b", crew="crew-b")
    now = datetime(2026, 7, 1, 7, 0, tzinfo=UTC)
    await w.run(now)  # run 1: the normal events (amber)
    before = len(w.alerts.records)
    assert [r.level for r in w.crew_events("crew-b")] == [A]

    w.clock.now = datetime(2026, 7, 1, 7, 20, tzinfo=UTC)
    epoch = await w.sites.active_epoch(SITE_ID)
    stop = await w.stops.start("crew-b", "heat", "lead-b", epoch)
    sent_before = len(w.channel.sent)
    report = await w.run(datetime(2026, 7, 1, 7, 25, tzinfo=UTC))  # run 2, no dwell, no sign-off wait

    assert report.events_created == 1
    assert len(w.alerts.records) == before + 1
    [red] = [r for r in w.crew_events("crew-b") if r.level is R]
    assert (red.kind, red.audience, red.template_id) == ("escalate", "crew", "level-change")
    assert red.valid_from == datetime(2026, 7, 1, 7, tzinfo=UTC)  # the hour the stop starts in
    assert [(m.crew_id, m.level) for _, m in w.channel.sent[sent_before:]] == [("crew-b", R)]
    assert stop.crew_id == "crew-b"
    assert [r for r in w.site_events() if r.level is R] == []  # a crew stop is not a site level


@pytest.mark.asyncio
async def test_a_stop_is_red_now_even_when_red_was_already_announced_for_later() -> None:
    """The replay day turns red from 12:00Z on its own: crews were told so at the first run. A stop at 07:20Z must still
    reach crew-b as red from 07:00Z at the next run, not at 12:00Z."""
    w = await world(dict.fromkeys(range(12, 16), R))
    await w.subscribe("https://push.example/crew-b", crew="crew-b")
    await w.run(datetime(2026, 7, 1, 7, 0, tzinfo=UTC))
    assert [(r.level, r.valid_from.hour) for r in w.crew_events("crew-b")] == [(R, 12)]
    epoch = await w.sites.active_epoch(SITE_ID)
    w.clock.now = datetime(2026, 7, 1, 7, 20, tzinfo=UTC)
    await w.stops.start("crew-b", "heat", "lead-b", epoch)

    report = await w.run(datetime(2026, 7, 1, 7, 25, tzinfo=UTC))

    assert report.events_created == 1
    now_red = w.crew_events("crew-b")[-1]
    assert (now_red.level, now_red.kind, now_red.valid_from.hour) == (R, "escalate", 7)
    assert [(m.crew_id, m.level) for _, m in w.channel.sent][-1] == ("crew-b", R)


@pytest.mark.asyncio
async def test_cleared_stop_deescalates_only_after_the_dwell() -> None:
    w = await world(AMBER_FROM_10)
    epoch = await w.sites.active_epoch(SITE_ID)
    w.clock.now = datetime(2026, 7, 1, 4, 10, tzinfo=UTC)
    stop = await w.stops.start("crew-b", "heat", "lead-b", epoch)
    await w.run(datetime(2026, 7, 1, 4, 20, tzinfo=UTC))
    assert w.crew_events("crew-b")[-1].level is R
    w.clock.now = datetime(2026, 7, 1, 5, 30, tzinfo=UTC)  # cleared inside the 05:00Z hour
    await w.stops.clear(stop.id, "lead-b")

    soon = await w.run(datetime(2026, 7, 1, 6, 30, tzinfo=UTC))  # amber again from 06:00Z, held 30 min
    later = await w.run(datetime(2026, 7, 1, 7, 0, tzinfo=UTC))  # held 60 min

    assert soon.events_created == 0
    assert later.events_created == 1
    last = w.crew_events("crew-b")[-1]
    assert (last.level, last.kind) == (A, "deescalate")
    assert last.valid_from == datetime(2026, 7, 1, 6, tzinfo=UTC)


@pytest.mark.asyncio
async def test_the_last_event_is_per_epoch() -> None:
    w = await world(dict.fromkeys(range(2, 16), R))
    first = await w.run(datetime(2026, 7, 1, 3, tzinfo=UTC))
    new_epoch = await w.sites.start_epoch(SITE_ID, "test", audit=None)

    second = await w.run(datetime(2026, 7, 1, 3, 5, tzinfo=UTC))  # a new visitor: the old red is not "last"

    assert first.events_created == second.events_created > 0
    assert {r.epoch_id for r in w.alerts.records} == {1, new_epoch}


@pytest.mark.asyncio
async def test_dispatch_interval_is_recorded_on_the_event_and_the_audit_row() -> None:
    w = await world(AMBER_FROM_10)
    await w.subscribe("https://push.example/a")

    report = await w.run(datetime(2026, 7, 1, 3, tzinfo=UTC))

    assert report.interval_minutes == 5  # the default of ae-heat-2026.1
    assert {r.dispatch_interval_minutes for r in w.alerts.records} == {5}
    [audited] = [r for r in w.audit.records if r.kind == "alerts.dispatched"]
    assert audited.detail == {
        "site_id": SITE_ID,
        "local_date": "2026-07-01",
        "events_created": report.events_created,
        "delivered": report.delivered,
        "failed": 0,
        "interval_minutes": 5,
        "push_configured": True,
    }
    assert report.delivered == 1
    assert (audited.site_id, audited.epoch_id, audited.config_version_id, audited.ruleset_id) == (
        SITE_ID,
        1,
        3,
        "ae-heat-2026.1",
    )


@pytest.mark.asyncio
async def test_a_tuned_interval_is_what_the_row_records() -> None:
    from stellar_blaze.domain.config.runtime import RuntimeConfig, Tunables

    w = await world(AMBER_FROM_10)
    config = dataclasses.replace(
        snapshot(version_id=4),
        config=RuntimeConfig(tunables=Tunables(alert_dispatch_interval_minutes=2)),
    )

    report = await w.run(datetime(2026, 7, 1, 3, tzinfo=UTC), config=config)

    assert report.interval_minutes == 2
    assert {r.dispatch_interval_minutes for r in w.alerts.records} == {2}


@pytest.mark.asyncio
async def test_without_a_channel_events_are_created_and_audited_with_zero_deliveries() -> None:
    w = await world(AMBER_FROM_10)
    await w.subscribe("https://push.example/a")

    report = await w.run(datetime(2026, 7, 1, 3, tzinfo=UTC), channel=None)

    assert (report.push_configured, report.delivered, report.failed) == (False, 0, 0)
    assert report.events_created > 0
    assert {(r.delivered, r.failed) for r in w.alerts.records} == {(0, 0)}
    [audited] = [r for r in w.audit.records if r.kind == "alerts.dispatched"]
    assert audited.detail["push_configured"] is False


@pytest.mark.asyncio
async def test_a_file_or_env_snapshot_persists_and_sends_nothing() -> None:
    w = await world(AMBER_FROM_10)
    await w.subscribe("https://push.example/a")

    report = await w.run(datetime(2026, 7, 1, 3, tzinfo=UTC), config=snapshot(version_id=None))

    assert (report.persisted, report.config_version, report.events_created, report.delivered) == (False, 0, 0, 0)
    assert w.alerts.records == []
    assert w.channel.sent == []
    assert [r for r in w.audit.records if r.kind == "alerts.dispatched"] == []


@pytest.mark.asyncio
async def test_failures_are_counted_on_the_row_and_gone_subscriptions_are_deleted() -> None:
    w = await world(AMBER_FROM_10)
    ok = await w.subscribe("https://push.example/ok")
    gone = await w.subscribe("https://push.example/gone")
    slow = await w.subscribe("https://push.example/slow")
    w.channel.results = {
        gone: DeliveryResult(channel="recording", status=DeliveryStatus.FAILED, detail="gone:410"),
        slow: DeliveryResult(channel="recording", status=DeliveryStatus.FAILED, detail="http:503"),
    }

    report = await w.run(datetime(2026, 7, 1, 3, tzinfo=UTC))

    [site_row] = w.site_events()
    assert (site_row.delivered, site_row.failed) == (1, 2)
    assert (report.delivered, report.failed) == (sum(r.delivered for r in w.alerts.records), 2)
    epoch = await w.sites.active_epoch(SITE_ID)
    assert {s.id for s in await w.subs.for_site(SITE_ID, epoch)} == {ok, slow}


@pytest.mark.asyncio
async def test_a_channel_that_raises_is_a_failure_and_the_run_continues() -> None:
    w = await world(AMBER_FROM_10)
    boom = await w.subscribe("https://push.example/boom")
    w.channel.raises = {boom}

    report = await w.run(datetime(2026, 7, 1, 3, tzinfo=UTC))

    assert report.events_created > 0
    assert w.site_events()[0].failed == 1


# --- sign-off never gates an alert (class (d) invariant) --------------------------------------------------------------

MODULE = Path(alerts_module.__file__)


def first_party_imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module)
            found.update(f"{node.module}.{a.name}" for a in node.names)
    return {name for name in found if name.startswith("stellar_blaze")}


def module_path(name: str) -> Path | None:
    base = MODULE.parents[2]  # .../src
    candidate = base.joinpath(*name.split("."))
    for path in (candidate.with_suffix(".py"), candidate / "__init__.py"):
        if path.is_file():
            return path
    return None


def test_the_dispatch_import_graph_has_no_signoff() -> None:
    """The module and everything first-party it reaches never names a sign-off store, state or module."""
    seen: set[str] = set()
    todo = ["stellar_blaze.application.alerts"]
    while todo:
        name = todo.pop()
        path = module_path(name)
        if path is None or name in seen:
            continue
        seen.add(name)
        todo.extend(first_party_imports(path))
    assert "stellar_blaze.application.alerts" in seen
    assert len(seen) > 5
    offending = {n for n in seen if "signoff" in n.lower()}
    assert offending == set(), offending
    own = first_party_imports(MODULE)
    assert not {n for n in own if "signoff" in n.lower()}
    source = MODULE.read_text(encoding="utf-8").lower()
    assert "plan_signoff" not in source
    assert "plansignoffstore" not in source


class BlockingSignoffStore:
    """A sign-off store whose every call waits forever: whatever read it would hang."""

    async def latest(self, *_: object) -> None:
        await asyncio.Event().wait()

    async def insert(self, *_: object) -> None:
        await asyncio.Event().wait()


class RefusingSignoffStore:
    """A sign-off store in the refused state: every call raises."""

    async def latest(self, *_: object) -> None:
        raise RuntimeError("sign-off refused")

    async def insert(self, *_: object) -> None:
        raise RuntimeError("sign-off refused")


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["none", "refused", "in-flight"])
async def test_sign_off_never_gates_an_alert(state: str) -> None:
    """With no sign-off, a refused one or one in flight (a blocking store), the same events come out without waiting.

    The dispatch has no sign-off collaborator at all (the import test above is the structural proof, and this test
    cannot fail by construction while that holds); it pins the behavior: the identical stop scenario, under a hard
    timeout, gives the identical events in every state, and nothing touches the store that is in that state.
    """
    w = await world(AMBER_FROM_10)
    signoffs = {"none": None, "refused": RefusingSignoffStore(), "in-flight": BlockingSignoffStore()}[state]
    assert (signoffs is None) == (state == "none")
    epoch = await w.sites.active_epoch(SITE_ID)
    w.clock.now = datetime(2026, 7, 1, 7, 20, tzinfo=UTC)
    await w.stops.start("crew-b", "heat", "lead-b", epoch)

    report = await asyncio.wait_for(w.run(datetime(2026, 7, 1, 7, 25, tzinfo=UTC)), timeout=5)

    assert [(r.crew_id, r.level, r.kind) for r in w.crew_events("crew-b")] == [("crew-b", R, "escalate")]
    assert report.events_created == len(w.crews) + 1  # the site and every crew; crew-b's is the red one
