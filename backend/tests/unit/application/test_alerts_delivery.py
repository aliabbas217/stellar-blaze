"""Alert delivery fix round (C1 hanging endpoints, I2 duplicate storm, I3 withdrawn announcement, R-AI audit rows).

Hanging endpoints are modelled by a channel whose sends wait for ever: the dispatch's own ``asyncio`` deadlines cut
them, with deadlines of a few hundredths of a second (no sleeps of ours; the assertions are on order and counts).
"""

import asyncio
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from stellar_blaze.adapters.fakes.notifications import RecordingPushChannel
from stellar_blaze.application.alerts import DeliveryLimits, dispatch, plan_alert_events
from stellar_blaze.domain.risk.levels import AlertLevel
from stellar_blaze.ports.notifications import DeliveryResult, OutboundMessage
from stellar_blaze.ports.push import SubscriptionRecord
from tests.unit.application.serving_support import catalog, snapshot
from tests.unit.application.test_alerts import (
    AMBER_FROM_10,
    HOUR,
    T0,
    A,
    G,
    R,
    World,
    event,
    hourly,
    kinds,
    levels_of,
    plan,
    world,
)
from tests.unit.contract.b3_world import SITE_ID

pytestmark = [pytest.mark.unit]
OR = AlertLevel.ORANGE
AT = datetime(2026, 7, 1, 4, 20, tzinfo=UTC)


class HangingSiteChannel(RecordingPushChannel):
    """Every SITE push hangs for ever (an endpoint that never answers); crew pushes answer."""

    def __init__(self) -> None:
        super().__init__()
        self.started: list[tuple[str, OutboundMessage]] = []

    async def send_to(
        self, sub: SubscriptionRecord, message: OutboundMessage, *, extra_host_suffixes: Sequence[str] = ()
    ) -> DeliveryResult:
        self.started.append((sub.id, message))
        if message.audience.value == "site":
            await asyncio.Event().wait()
        return await super().send_to(sub, message, extra_host_suffixes=extra_host_suffixes)


async def run_with(w: World, channel: Any, now: datetime, limits: DeliveryLimits) -> Any:
    return await dispatch(
        site_day=w.day,
        crews=w.crews,
        sites=w.sites,
        stops=w.stops,
        alerts=w.alerts,
        subs=w.subs,
        audit=w.audit,
        channel=channel,
        snapshot=snapshot(version_id=3),
        catalog=catalog(),
        now=now,
        limits=limits,
    )


async def hanging_world(n_hanging: int) -> tuple[World, HangingSiteChannel]:
    w = await world(AMBER_FROM_10)
    for n in range(n_hanging):
        await w.subscribe(f"https://push.example/site-{n}")
    await w.subscribe("https://push.example/crew-b", crew="crew-b")
    epoch = await w.sites.active_epoch(SITE_ID)
    w.clock.now = datetime(2026, 7, 1, 4, 10, tzinfo=UTC)
    await w.stops.start("crew-b", "heat", "lead-b", epoch)  # a stop BEFORE the run
    return w, HangingSiteChannel()


@pytest.mark.asyncio
async def test_a_hanging_channel_does_not_delay_the_stop_escalation() -> None:
    """40 site subscriptions hang (more than the 16 send slots); the crew's red stop is still the FIRST send, is
    delivered, and its row is stored; the hanging ones fail with the deadline and the run ends."""
    w, channel = await hanging_world(40)

    report = await asyncio.wait_for(
        run_with(
            w,
            channel,
            datetime(2026, 7, 1, 4, 20, tzinfo=UTC),
            DeliveryLimits(delivery_deadline_s=0.05, run_budget_s=30),
        ),
        timeout=20,
    )

    first_sub, first_message = channel.started[0]
    assert (first_message.audience.value, first_message.crew_id, first_message.level) == ("crew", "crew-b", R)
    [red] = [r for r in w.crew_events("crew-b") if r.level is R]
    assert (red.kind, red.delivered, red.failed) == ("escalate", 1, 0)
    [site_row] = w.site_events()
    assert (site_row.delivered, site_row.failed) == (0, 41)  # 40 + crew-b's own subscription: all cut by the deadline
    assert report.failed == 41
    assert first_sub  # the crew subscription id


@pytest.mark.asyncio
async def test_the_run_deadline_fails_what_has_not_started_and_the_stop_is_still_delivered() -> None:
    w, channel = await hanging_world(40)

    report = await asyncio.wait_for(
        run_with(
            w,
            channel,
            datetime(2026, 7, 1, 4, 20, tzinfo=UTC),
            DeliveryLimits(delivery_deadline_s=30, run_budget_s=0.05),
        ),
        timeout=20,
    )

    [red] = [r for r in w.crew_events("crew-b") if r.level is R]
    assert (red.delivered, red.failed) == (1, 0)  # severity order: it was inside the budget
    [site_row] = w.site_events()
    assert (site_row.delivered, site_row.failed) == (0, 41)  # cut in flight at the budget, or never started
    assert len(channel.started) < 1 + 41 + 4  # the ones past the deadline were never sent to the channel
    assert report.events_created == 1 + len(w.crews)  # every event row was still inserted


@pytest.mark.asyncio
async def test_severity_order_puts_escalations_before_deescalations_and_crews_before_the_site() -> None:
    w = await world(AMBER_FROM_10)
    await w.subscribe("https://push.example/a")
    await w.subscribe("https://push.example/crew-b", crew="crew-b")
    epoch = await w.sites.active_epoch(SITE_ID)
    w.clock.now = datetime(2026, 7, 1, 4, 10, tzinfo=UTC)
    await w.stops.start("crew-b", "heat", "lead-b", epoch)

    await run_with(w, w.channel, datetime(2026, 7, 1, 4, 20, tzinfo=UTC), DeliveryLimits(concurrency=1))

    order = [(m.audience.value, m.level) for _, m in w.channel.sent]
    assert order[0] == ("crew", R)
    assert order.index(("site", A)) > 0


@pytest.mark.asyncio
async def test_an_event_stored_already_is_never_sent_again() -> None:
    w = await world(AMBER_FROM_10)
    await w.subscribe("https://push.example/a")
    await w.run(datetime(2026, 7, 1, 3, tzinfo=UTC))
    sent, rows = len(w.channel.sent), len(w.alerts.records)

    async def forgotten(*_: object) -> None:  # the planner no longer sees its own history (a stale read, a crash)
        return None

    w.alerts.last_for_target = forgotten  # type: ignore[method-assign,assignment]
    again = await w.run(datetime(2026, 7, 1, 3, 5, tzinfo=UTC))

    assert (len(w.channel.sent), len(w.alerts.records), again.events_created) == (sent, rows, 0)


@pytest.mark.asyncio
async def test_a_revisited_level_is_one_send_and_one_row_not_a_storm() -> None:
    """The reviewer's sequence: red, green, red again. The third event has a new predecessor, so it is a new event
    (one send, one row); the fourth run sends nothing (before the fix its key was deduped and re-sent for ever)."""
    w = await world(dict.fromkeys(range(2, 4), R))
    await w.subscribe("https://push.example/a")

    def site_sends() -> int:
        return len([1 for _, m in w.channel.sent if m.crew_id is None])

    await w.run(datetime(2026, 7, 1, 2, 10, tzinfo=UTC))  # run 1: red from 02:00Z
    assert [(r.level, r.kind) for r in w.site_events()] == [(R, "escalate")]
    await w.run(datetime(2026, 7, 1, 5, 30, tzinfo=UTC))  # run 2: green held for the dwell
    assert [(r.level, r.kind) for r in w.site_events()][-1] == (G, "deescalate")
    before = site_sends()

    w.day = levels_of(w.day, dict.fromkeys(range(2, 16), R))  # a revised forecast: red covers the day again
    await w.run(datetime(2026, 7, 1, 5, 40, tzinfo=UTC))  # run 3
    assert site_sends() == before + 1
    assert [(r.level, r.kind) for r in w.site_events()][-1] == (R, "escalate")
    rows = len(w.site_events())
    await w.run(datetime(2026, 7, 1, 5, 45, tzinfo=UTC))  # run 4
    await w.run(datetime(2026, 7, 1, 5, 50, tzinfo=UTC))  # run 5

    assert (site_sends(), len(w.site_events())) == (before + 1, rows)


@pytest.mark.asyncio
async def test_a_run_that_does_nothing_writes_no_audit_row_but_a_run_that_creates_one_does() -> None:
    w = await world(AMBER_FROM_10)
    await w.subscribe("https://push.example/a")

    await w.run(datetime(2026, 7, 1, 3, tzinfo=UTC))
    await w.run(datetime(2026, 7, 1, 3, 5, tzinfo=UTC))
    await w.run(datetime(2026, 7, 1, 3, 10, tzinfo=UTC))

    assert len([r for r in w.audit.records if r.kind == "alerts.dispatched"]) == 1


# --- I3: a withdrawn announcement is retracted ----------------------------------------------


def test_a_withdrawn_announced_future_level_is_retracted_after_the_dwell() -> None:
    all_amber = hourly(*([A] * 14))
    announced = event(R, T0 + 2 * HOUR)  # red was announced for 08:00Z; the forecast is now amber all day

    assert plan(all_amber, last=announced, now=T0 + HOUR - 30 * HOUR // 60) == ()  # inside the dwell: wait
    found = plan(all_amber, last=announced, now=T0 + HOUR)
    assert kinds(found) == [(A, "deescalate")]
    assert plan(hourly(A, A, R, R), last=announced, now=T0 + HOUR) == ()  # red is still coming: nothing to retract


LEVELS = st.sampled_from([None, G, A, OR, R])


@settings(max_examples=300, deadline=None)
@given(
    levels=st.lists(LEVELS, min_size=14, max_size=14),
    minutes=st.integers(0, 14 * 60 - 1),
    in_force=st.sampled_from([None, G, A, OR, R]),
    started=st.integers(0, 13),
    dwell=st.integers(0, 120),
)
def test_the_current_hour_is_never_under_announced(
    levels: list[AlertLevel | None], minutes: int, in_force: AlertLevel | None, started: int, dwell: int
) -> None:
    """Whatever was announced (and in force) and whatever the forecast now says, after the planned events the level
    announced is at least the level of the hour we are in (over-announcing is the safe error)."""
    from datetime import timedelta

    now = T0 + timedelta(minutes=minutes)
    last = None if in_force is None else event(in_force, T0 + started * HOUR)
    if last is not None and last.valid_from > now:
        return  # an announcement for LATER is not in force; the in-force-now rule covers the crew-stop case
    found = plan_alert_events(hourly(*levels), last=last, now=now, dwell_minutes=dwell, lead_hours=12)
    announced = found[-1].level if found else (G if last is None else last.level)
    hour_level = levels[minutes // 60]
    if hour_level is not None:
        order = list(AlertLevel)
        assert order.index(announced) >= order.index(hour_level)


class LaneProbeChannel(RecordingPushChannel):
    """Crew pushes to every endpoint but ``real`` hang for ever; ``peak`` is the most sends in flight at once."""

    def __init__(self, real: str) -> None:
        super().__init__()
        self.real = real
        self.in_flight = 0
        self.peak = 0

    async def send_to(
        self, sub: SubscriptionRecord, message: OutboundMessage, *, extra_host_suffixes: Sequence[str] = ()
    ) -> DeliveryResult:
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        try:
            if message.audience.value == "crew" and sub.endpoint != self.real:
                await asyncio.Event().wait()
            return await super().send_to(sub, message, extra_host_suffixes=extra_host_suffixes)
        finally:
            self.in_flight -= 1


@pytest.mark.asyncio
async def test_a_stops_own_recipients_cannot_be_flooded_by_hanging_subscriptions() -> None:
    """W2: 200 hanging subscriptions of the crew (the public cap) register BEFORE one real worker. With one 16-slot lane
    the real one would wait about 13 batches of the delivery deadline; in the reserved stop lane every send starts at
    once (all 201 in flight together) and the real one is delivered at once, the 200 are cut by the deadline."""
    w = await world(AMBER_FROM_10)
    for n in range(200):
        await w.subscribe(f"https://push.example/hang-{n}", crew="crew-b")
    await w.subscribe("https://push.example/real", crew="crew-b")
    epoch = await w.sites.active_epoch(SITE_ID)
    w.clock.now = datetime(2026, 7, 1, 4, 10, tzinfo=UTC)
    await w.stops.start("crew-b", "heat", "lead-b", epoch)
    channel = LaneProbeChannel("https://push.example/real")

    await asyncio.wait_for(
        run_with(
            w,
            channel,
            datetime(2026, 7, 1, 4, 20, tzinfo=UTC),
            DeliveryLimits(delivery_deadline_s=0.3, run_budget_s=30),
        ),
        timeout=20,
    )

    [red] = [r for r in w.crew_events("crew-b") if r.level is R]
    assert (red.delivered, red.failed) == (1, 200)
    real = [sub_id for sub_id, m in channel.sent if m.crew_id == "crew-b" and m.level is R]
    assert len(real) == 1
    assert channel.peak >= 201  # all of the crew's sends were in flight together (a 16-slot lane peaks at 16)


# --- the reserved lane belongs to OPERATOR-RECORDED stops only (fix round 2, finding A) -----------------------------


class OriginProbeChannel(RecordingPushChannel):
    """Crew pushes to every endpoint but one of ``real`` hang for ever. ``cancelled`` counts the hanging sends the
    dispatch's deadline has cut so far; ``started_at_cancel_count`` is that count when each real send STARTED: a real
    send that starts before any deadline expired did not wait behind a single hanging one (no sleeps of ours)."""

    def __init__(self, real: set[str]) -> None:
        super().__init__()
        self.real = real
        self.in_flight = 0
        self.peak = 0
        self.cancelled = 0
        self.started_at_cancel_count: dict[str, int] = {}

    async def send_to(
        self, sub: SubscriptionRecord, message: OutboundMessage, *, extra_host_suffixes: Sequence[str] = ()
    ) -> DeliveryResult:
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        try:
            if message.audience.value == "crew" and sub.endpoint in self.real:
                self.started_at_cancel_count[sub.endpoint] = self.cancelled
            if message.audience.value == "crew" and sub.endpoint not in self.real:
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    self.cancelled += 1
                    raise
            return await super().send_to(sub, message, extra_host_suffixes=extra_host_suffixes)
        finally:
            self.in_flight -= 1


class HangingEverywhereChannel(RecordingPushChannel):
    """Every push hangs for ever; ``peak`` is the most sends in flight at once."""

    def __init__(self) -> None:
        super().__init__()
        self.in_flight = 0
        self.peak = 0

    async def send_to(
        self, sub: SubscriptionRecord, message: OutboundMessage, *, extra_host_suffixes: Sequence[str] = ()
    ) -> DeliveryResult:
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        try:
            await asyncio.Event().wait()
        finally:
            self.in_flight -= 1
        raise AssertionError("unreachable: the event is never set")


FORECAST_RED_FROM_08Z = dict.fromkeys(range(8, 16), R)  # red announced from 08:00Z, a run at 04:20Z is inside the lead
RUN_AT = datetime(2026, 7, 1, 4, 20, tzinfo=UTC)
STOP_AT = datetime(2026, 7, 1, 4, 10, tzinfo=UTC)


async def flooded_world(*, stopped: tuple[str, ...], flooded: tuple[str, ...], per_crew: int = 200) -> World:
    """Forecast red from 08:00Z. Every ``flooded`` crew holds ``per_crew`` hanging subscriptions; every crew in
    ``stopped`` also has one real subscription and an operator stop recorded at 04:10Z (red from 04:00Z)."""
    w = await world(FORECAST_RED_FROM_08Z)
    for crew in flooded:
        for n in range(per_crew - (1 if crew in stopped else 0)):  # a crew holds at most 200 subscriptions in all
            await w.subscribe(f"https://push.example/hang-{crew}-{n}", crew=crew)
    for crew in stopped:
        await w.subscribe(f"https://push.example/real-{crew}", crew=crew)
    epoch = await w.sites.active_epoch(SITE_ID)
    w.clock.now = STOP_AT
    for crew in stopped:
        await w.stops.start(crew, "heat", f"lead-{crew[-1]}", epoch)
    return w


@pytest.mark.asyncio
async def test_forecast_reds_of_other_crews_cannot_delay_an_operator_stop() -> None:
    """The finding: three crews with a forecast red (200 hanging subscriptions each, the public cap) and ONE operator
    stop for crew-d with one real subscription. Before the fix every crew red shared one 200-slot lane, so the stop's
    send was the 601st on it and started only after two batches of hanging sends had been cut by their deadline."""
    w = await flooded_world(stopped=("crew-d",), flooded=("crew-a", "crew-b", "crew-c"))
    channel = OriginProbeChannel({"https://push.example/real-crew-d"})

    await asyncio.wait_for(
        run_with(w, channel, RUN_AT, DeliveryLimits(delivery_deadline_s=0.05, run_budget_s=60)), timeout=30
    )

    assert channel.started_at_cancel_count == {"https://push.example/real-crew-d": 0}
    [stop_row] = [r for r in w.crew_events("crew-d") if r.level is R]
    assert (stop_row.kind, stop_row.valid_from, stop_row.delivered, stop_row.failed) == (
        "escalate",
        datetime(2026, 7, 1, 4, tzinfo=UTC),
        1,
        0,
    )
    for crew in ("crew-a", "crew-b", "crew-c"):  # the forecast reds were announced too (ordinary lane, all cut)
        [red] = [r for r in w.crew_events(crew) if r.level is R]
        assert (red.valid_from, red.delivered, red.failed) == (datetime(2026, 7, 1, 8, tzinfo=UTC), 0, 200)


@pytest.mark.asyncio
async def test_forecast_reds_never_use_the_reserved_lane() -> None:
    """No operator stop at all: three crews with a forecast red and 40 hanging subscriptions each send through the
    ordinary 16-slot lane (before the fix they peaked at 120 in flight)."""
    w = await flooded_world(stopped=(), flooded=("crew-a", "crew-b", "crew-c"), per_crew=40)
    channel = OriginProbeChannel(set())

    await asyncio.wait_for(
        run_with(w, channel, RUN_AT, DeliveryLimits(delivery_deadline_s=0.02, run_budget_s=60)), timeout=30
    )

    assert 0 < channel.peak <= 16
    assert len([r for r in w.alerts.records if r.level is R and r.crew_id is not None]) == len(w.crews)


@pytest.mark.asyncio
async def test_a_stop_on_a_crew_whose_forecast_is_red_later_is_still_an_operator_stop() -> None:
    """The operator stop is red from 04:00Z, the forecast only from 08:00Z: the event starts at an hour the operator
    stopped, so it rides the reserved lane even though red was also forecast for that crew."""
    w = await flooded_world(stopped=("crew-d",), flooded=("crew-d",))
    channel = OriginProbeChannel({"https://push.example/real-crew-d"})

    await asyncio.wait_for(
        run_with(w, channel, RUN_AT, DeliveryLimits(delivery_deadline_s=0.05, run_budget_s=60)), timeout=30
    )

    assert channel.peak >= 200  # all 200 recipients of the stop (the crew cap) in flight together
    [stop_row] = [r for r in w.crew_events("crew-d") if r.level is R]
    assert (stop_row.delivered, stop_row.failed) == (1, 199)


@pytest.mark.asyncio
async def test_two_simultaneous_operator_stops_do_not_delay_each_other() -> None:
    """Two crews stopped in the same cycle, each at the 200-subscription cap (199 hanging plus one real): each stop has
    its OWN lane, so both real sends start before a single hanging send has been cut by its deadline (a shared 200-slot
    lane would hold one stop's real send behind the other's 200)."""
    w = await flooded_world(stopped=("crew-c", "crew-d"), flooded=("crew-c", "crew-d"))
    channel = OriginProbeChannel({"https://push.example/real-crew-c", "https://push.example/real-crew-d"})

    await asyncio.wait_for(
        run_with(w, channel, RUN_AT, DeliveryLimits(delivery_deadline_s=0.1, run_budget_s=60)), timeout=30
    )

    assert channel.started_at_cancel_count == {
        "https://push.example/real-crew-c": 0,
        "https://push.example/real-crew-d": 0,
    }
    assert channel.peak >= 2 * 199  # both stops' hanging recipients were in flight together


@pytest.mark.asyncio
async def test_ordinary_events_stay_capped_at_sixteen_sends() -> None:
    w = await world(AMBER_FROM_10)
    for n in range(100):
        await w.subscribe(f"https://push.example/site-{n}")
    channel = HangingEverywhereChannel()
    await asyncio.wait_for(
        run_with(w, channel, AT, DeliveryLimits(delivery_deadline_s=0.01, run_budget_s=60)), timeout=30
    )

    assert channel.peak == 16
