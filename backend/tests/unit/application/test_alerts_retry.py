"""One bounded in-run retry of transient push failures for OPERATOR-RECORDED stops only (ADR 0058, second entry of
2026-11-15). Everything else stays at-most-once.

Hand arithmetic (defaults: channel timeout 10 s, so the per-send deadline is 12 s; first attempt share 0.6; Retry-After
cap 2 s; default backoff 1 s; minimum retry window 2 s; all measured from the moment the stop's send got its lane):

* the first attempt of a stop is cut at 0.6 x 12 = 7.2 s (an ordinary event keeps all 12 s);
* a 503 that comes back at t = 0.1 s waits 1 s and the retry gets 12 - 1.1 = 10.9 s;
* a first attempt cut at 7.2 s waits 1 s and the retry gets 12 - 8.2 = 3.8 s (at least 2 s, so it starts);
* a 503 at t = 10.5 s would leave 12 - 11.5 = 0.5 s (under 2 s): no retry. A retry always ends by the 12 s deadline.

The fake clock below advances ONLY when a test says so (``sleep`` and ``Clock.advance``); the real ``asyncio`` deadlines
are used for the hanging cases, with deadlines of a few tenths of a second.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime
from typing import Any

import pytest
import structlog
from hypothesis import given, settings
from hypothesis import strategies as st

from stellar_blaze.adapters.fakes.notifications import RecordingPushChannel
from stellar_blaze.application.alerts import (
    FIRST_ATTEMPT_SHARE,
    MIN_RETRY_WINDOW_S,
    RETRY_AFTER_CAP_S,
    RETRY_BACKOFF_S,
    DeliveryLimits,
    RetryPlan,
    is_transient,
    plan_retry,
)
from stellar_blaze.domain.risk.levels import AlertLevel
from stellar_blaze.ports.notifications import DeliveryResult, DeliveryStatus, OutboundMessage
from stellar_blaze.ports.push import SubscriptionRecord
from tests.unit.application.test_alerts import AMBER_FROM_10, World, world
from tests.unit.application.test_alerts_delivery import (
    FORECAST_RED_FROM_08Z,
    RUN_AT,
    flooded_world,
    run_with,
)

pytestmark = [pytest.mark.unit]
R = AlertLevel.RED
STOP_FROM = datetime(2026, 7, 1, 4, tzinfo=UTC)  # the hour the operator stop turns the crew red (stop at 04:10Z)


def fail(
    detail: str,
    *,
    status: int | None = None,
    retry_after: float | None = None,
    timed_out: bool = False,
) -> DeliveryResult:
    return DeliveryResult(
        channel="scripted",
        status=DeliveryStatus.FAILED,
        detail=detail,
        http_status=status,
        retry_after_s=retry_after,
        timed_out=timed_out,
    )


def http(status: int, retry_after: float | None = None) -> DeliveryResult:
    return fail(f"gone:{status}" if status in {404, 410} else f"http:{status}", status=status, retry_after=retry_after)


OK = DeliveryResult(channel="scripted", status=DeliveryStatus.DELIVERED)


class Clock:
    """A fake ``time.monotonic`` and a ``sleep`` that moves it; ``slept`` is what the dispatch asked to wait."""

    def __init__(self) -> None:
        self.now = 0.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


Behavior = Callable[[SubscriptionRecord, OutboundMessage, int], Awaitable[DeliveryResult]]


def is_stop_message(message: OutboundMessage) -> bool:
    """The operator stop of ``flooded_world``/``stop_world``: the crew red that starts at the stopped hour."""
    return message.audience.value == "crew" and message.level is R and message.valid_from == STOP_FROM


class ScriptedChannel(RecordingPushChannel):
    """``behave(sub, message, call_number)`` decides each call; ``calls`` counts per (subscription, audience, start)."""

    def __init__(self, behave: Behavior) -> None:
        super().__init__()
        self.behave = behave
        self.calls: dict[tuple[str, str, datetime], int] = {}

    async def send_to(
        self, sub: SubscriptionRecord, message: OutboundMessage, *, extra_host_suffixes: Sequence[str] = ()
    ) -> DeliveryResult:
        key = (sub.id, message.audience.value, message.valid_from)
        self.calls[key] = self.calls.get(key, 0) + 1
        return await self.behave(sub, message, self.calls[key])


def calls_of(channel: ScriptedChannel, *, stop: bool) -> list[int]:
    """The per-recipient call counts of the stop (``stop=True``) or of every other event."""
    return [
        n for (_, audience, start), n in channel.calls.items() if (audience == "crew" and start == STOP_FROM) is stop
    ]


async def stop_world(extra_subs: int = 0) -> World:
    """Crew-d stopped at 04:10Z (red from 04:00Z) with ONE subscription; the forecast is red from 08:00Z (so the site
    and every crew also have a FORECAST red event, which is not a stop)."""
    return await flooded_world(stopped=("crew-d",), flooded=("crew-d",) if extra_subs else (), per_crew=1 + extra_subs)


def script(*results: DeliveryResult) -> Behavior:
    """The stop's calls answer ``results`` in order (the last one repeats); every other event is delivered."""

    async def behave(sub: SubscriptionRecord, message: OutboundMessage, call: int) -> DeliveryResult:
        if not is_stop_message(message):
            return OK
        return results[min(call, len(results)) - 1]

    return behave


async def run_stop(
    behave: Behavior, *, clock: Clock | None = None, deadline: float | None = None, budget: float = 300.0
) -> tuple[World, ScriptedChannel, Clock]:
    w = await stop_world()
    channel = ScriptedChannel(behave)
    fake = clock or Clock()
    limits = DeliveryLimits(
        delivery_deadline_s=deadline, run_budget_s=budget, monotonic=fake, sleep=fake.sleep, started_at=0.0
    )
    await asyncio.wait_for(run_with(w, channel, RUN_AT, limits), timeout=20)
    return w, channel, fake


def stop_row(w: World) -> Any:
    [row] = [r for r in w.crew_events("crew-d") if r.valid_from == STOP_FROM]
    return row


# --- the constants ----------------------------------------------------------------------------------------------------


def test_the_named_constants() -> None:
    assert (FIRST_ATTEMPT_SHARE, RETRY_AFTER_CAP_S, RETRY_BACKOFF_S, MIN_RETRY_WINDOW_S) == (0.6, 2.0, 1.0, 2.0)


# --- the classification -----------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("result", "transient"),
    [
        (http(500), True),
        (http(502), True),
        (http(503), True),
        (http(503, 1.0), True),
        (http(429), True),
        (http(429, 1.0), True),
        (http(429, 2.0), True),  # exactly the cap
        (http(429, 2.01), False),
        (http(429, 120.0), False),  # autopush's default: far above any cap, never waited for
        (http(503, 120.0), False),
        (fail("error:TimeoutError", timed_out=True), True),
        (fail("deadline", timed_out=True), True),  # the per-attempt cut (the dispatch sets it only for that)
        (fail("deadline"), False),  # the whole-run deadline
        (http(400), False),
        (http(401), False),
        (http(403), False),
        (http(404), False),
        (http(410), False),
        (http(413), False),
        (fail("blocked"), False),
        (fail("redirect"), False),
        (fail("response_too_large"), False),
        (fail("error:OSError"), False),
        (fail("error:channel_raised"), False),
        (OK, False),
    ],
)
def test_which_failures_are_transient(result: DeliveryResult, transient: bool) -> None:
    assert is_transient(result) is transient


# --- the plan: where the 12 s go --------------------------------------------------------------------------------------


def plan_at(result: DeliveryResult, now: float, *, run_deadline: float = 300.0) -> RetryPlan | None:
    return plan_retry(result, now=now, send_deadline=12.0, run_deadline=run_deadline)


def test_the_arithmetic_of_the_deadline_split() -> None:
    assert plan_at(http(503), 0.1) == RetryPlan(wait_s=1.0, timeout_s=pytest.approx(10.9))  # type: ignore[arg-type]
    assert plan_at(fail("error:TimeoutError", timed_out=True), 7.2) == RetryPlan(
        wait_s=1.0,
        timeout_s=pytest.approx(3.8),  # type: ignore[arg-type]
    )
    assert plan_at(http(429, 1.0), 6.0) == RetryPlan(wait_s=1.0, timeout_s=pytest.approx(5.0))  # type: ignore[arg-type]
    assert plan_at(http(429, 2.0), 6.0) == RetryPlan(wait_s=2.0, timeout_s=pytest.approx(4.0))  # type: ignore[arg-type]
    assert plan_at(http(503, 0.5), 0.0) == RetryPlan(wait_s=0.5, timeout_s=pytest.approx(11.5))  # type: ignore[arg-type]
    assert plan_at(http(503, 0.0), 0.0) == RetryPlan(wait_s=0.0, timeout_s=12.0)


def test_no_retry_starts_when_less_than_the_minimum_window_remains() -> None:
    assert plan_at(http(503), 9.9) is None  # 12 - 10.9 = 1.1 s
    assert plan_at(http(503), 9.0) == RetryPlan(wait_s=1.0, timeout_s=pytest.approx(2.0))  # type: ignore[arg-type]
    assert plan_at(http(503), 9.01) is None  # 12 - 10.01 = 1.99 s < 2 s


def test_the_run_deadline_bounds_the_window_too() -> None:
    assert plan_at(http(503), 0.0, run_deadline=3.0) == RetryPlan(wait_s=1.0, timeout_s=pytest.approx(2.0))  # type: ignore[arg-type]
    assert plan_at(http(503), 0.0, run_deadline=2.9) is None  # 2.9 - 1 = 1.9 s < 2 s: the run is nearly over
    assert plan_at(http(503), 5.0, run_deadline=4.0) is None  # already past


@pytest.mark.parametrize("result", [http(410), http(404), http(413), http(403), http(429, 120.0), fail("blocked")])
def test_no_plan_for_what_is_not_transient(result: DeliveryResult) -> None:
    assert plan_at(result, 0.0) is None


@settings(max_examples=300, deadline=None)
@given(
    now=st.floats(0, 14),
    retry_after=st.one_of(st.none(), st.floats(0, 3)),
    status=st.sampled_from([429, 500, 502, 503]),
    run_deadline=st.floats(0, 40),
)
def test_a_planned_retry_never_ends_after_either_deadline(
    now: float, retry_after: float | None, status: int, run_deadline: float
) -> None:
    found = plan_at(http(status, retry_after), now, run_deadline=run_deadline)

    if found is not None:
        assert found.timeout_s >= MIN_RETRY_WINDOW_S - 1e-9
        assert now + found.wait_s + found.timeout_s <= min(12.0, run_deadline) + 1e-9


# --- the dispatch -----------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_stop_that_fails_503_once_then_succeeds_is_delivered() -> None:
    w, channel, clock = await run_stop(script(http(503), OK))

    row = stop_row(w)
    assert (row.delivered, row.failed) == (1, 0)
    assert calls_of(channel, stop=True) == [2]
    assert clock.slept == [RETRY_BACKOFF_S]
    [audit] = [a for a in w.audit.records if a.kind == "alerts.dispatched"]
    assert audit.detail["retried"] == 1
    assert (audit.detail["delivered"], audit.detail["failed"]) == (2, 0)  # the stop and the site's forecast red


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("first", "waits", "retried"),
    [
        (http(429, 1.0), [1.0], True),
        (http(429, 2.0), [2.0], True),
        (http(429), [1.0], True),  # no Retry-After: the small default backoff
        (http(503, 0.5), [0.5], True),  # a service that says when is honored (WNS 503)
        (http(429, 2.5), [], False),
        (http(429, 120.0), [], False),  # autopush: about 120 s, far above any cap: do not wait
        (http(503, 120.0), [], False),
    ],
)
async def test_retry_after_is_honored_when_short_and_never_waited_for_when_long(
    first: DeliveryResult, waits: list[float], retried: bool
) -> None:
    w, channel, clock = await run_stop(script(first, OK))

    row = stop_row(w)
    assert clock.slept == waits
    assert calls_of(channel, stop=True) == [2 if retried else 1]
    assert (row.delivered, row.failed) == ((1, 0) if retried else (0, 1))


@pytest.mark.asyncio
async def test_a_timeout_on_the_first_attempt_is_retried_inside_the_deadline() -> None:
    """The first attempt hangs and is cut by the dispatch at 0.6 x 0.5 s = 0.3 s; the retry gets what is left of 0.5 s
    (about 0.18 s) and is answered at once. Real clock, deadlines of tenths of a second."""

    async def behave(sub: SubscriptionRecord, message: OutboundMessage, call: int) -> DeliveryResult:
        if is_stop_message(message) and call == 1:
            await asyncio.Event().wait()
        return OK

    w = await stop_world()
    channel = ScriptedChannel(behave)
    limits = DeliveryLimits(delivery_deadline_s=0.5, run_budget_s=60, retry_backoff_s=0.02, min_retry_window_s=0.05)
    await asyncio.wait_for(run_with(w, channel, RUN_AT, limits), timeout=20)

    assert (stop_row(w).delivered, stop_row(w).failed) == (1, 0)
    assert calls_of(channel, stop=True) == [2]


@pytest.mark.asyncio
async def test_a_channel_reported_timeout_is_retried_too() -> None:
    w, channel, clock = await run_stop(script(fail("error:TimeoutError", timed_out=True), OK))

    assert (stop_row(w).delivered, stop_row(w).failed) == (1, 0)
    assert calls_of(channel, stop=True) == [2]
    assert clock.slept == [1.0]


@pytest.mark.asyncio
async def test_a_second_failure_ends_failed_with_the_last_detail_and_the_marker() -> None:
    w, channel, clock = await run_stop(script(http(503), http(500)))

    row = stop_row(w)
    assert (row.delivered, row.failed) == (0, 1)
    assert calls_of(channel, stop=True) == [2]  # ONE retry, never a second
    assert clock.slept == [1.0]
    [audit] = [a for a in w.audit.records if a.kind == "alerts.dispatched"]
    assert audit.detail["retried"] == 1
    assert (audit.detail["delivered"], audit.detail["failed"]) == (1, 1)  # the site red delivered, the stop failed


@pytest.mark.asyncio
async def test_a_forecast_driven_red_and_every_non_stop_event_get_one_attempt_only() -> None:
    """No stop at all: the forecast red of the site and of every crew fails 503 and is NOT retried."""
    w = await world(FORECAST_RED_FROM_08Z)
    for crew in ("crew-a", "crew-b"):
        await w.subscribe(f"https://push.example/{crew}", crew=crew)
    await w.subscribe("https://push.example/site")
    channel = ScriptedChannel(lambda sub, message, call: _always(http(503)))
    clock = Clock()
    limits = DeliveryLimits(run_budget_s=300, monotonic=clock, sleep=clock.sleep, started_at=0.0)

    report = await asyncio.wait_for(run_with(w, channel, RUN_AT, limits), timeout=20)

    assert channel.calls  # something was sent
    assert set(channel.calls.values()) == {1}  # one attempt per (recipient, event), whatever the failure
    assert clock.slept == []
    assert report.failed == sum(channel.calls.values())
    [audit] = [a for a in w.audit.records if a.kind == "alerts.dispatched"]
    assert "retried" not in audit.detail


async def _always(result: DeliveryResult) -> DeliveryResult:
    return result


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "result",
    [
        http(410),
        http(404),
        http(413),
        http(403),
        http(400),
        http(401),
        http(429, 120.0),
        fail("blocked"),
        fail("redirect"),
        fail("response_too_large"),
        fail("deadline"),
        fail("error:OSError"),
    ],
)
async def test_what_is_not_transient_is_never_retried_for_a_stop(result: DeliveryResult) -> None:
    w, channel, clock = await run_stop(script(result, OK))

    assert calls_of(channel, stop=True) == [1]
    assert clock.slept == []
    assert (stop_row(w).delivered, stop_row(w).failed) == (0, 1)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [404, 410])
async def test_gone_still_prunes_the_subscription_and_is_not_retried(status: int) -> None:
    w, channel, _ = await run_stop(script(http(status), OK))

    assert calls_of(channel, stop=True) == [1]
    assert list(await w.subs.for_crew("crew-d", 1)) == []  # the stop's only subscription was deleted


@pytest.mark.asyncio
async def test_a_channel_that_raises_is_not_retried() -> None:
    async def behave(sub: SubscriptionRecord, message: OutboundMessage, call: int) -> DeliveryResult:
        if is_stop_message(message):
            raise RuntimeError("injected")
        return OK

    w, channel, clock = await run_stop(behave)

    assert calls_of(channel, stop=True) == [1]
    assert (stop_row(w).delivered, stop_row(w).failed) == (0, 1)
    assert clock.slept == []


@pytest.mark.asyncio
async def test_no_retry_starts_when_the_run_deadline_leaves_less_than_the_minimum_window() -> None:
    w, channel, clock = await run_stop(script(http(503), OK), budget=2.5)  # 2.5 - 1 s wait = 1.5 s < 2 s

    assert calls_of(channel, stop=True) == [1]
    assert clock.slept == []
    assert (stop_row(w).delivered, stop_row(w).failed) == (0, 1)


@pytest.mark.asyncio
async def test_no_retry_starts_when_less_than_the_minimum_window_remains_in_the_send_deadline() -> None:
    """The first attempt takes 10.5 s of the fake clock before it answers 503: 12 - 10.5 - 1 = 0.5 s < 2 s."""
    clock = Clock()

    async def behave(sub: SubscriptionRecord, message: OutboundMessage, call: int) -> DeliveryResult:
        if not is_stop_message(message):
            return OK
        clock.advance(10.5)
        return http(503)

    w, channel, _ = await run_stop(behave, clock=clock)

    assert calls_of(channel, stop=True) == [1]
    assert clock.slept == []
    assert (stop_row(w).delivered, stop_row(w).failed) == (0, 1)


@pytest.mark.asyncio
async def test_the_stop_retry_waits_inside_its_own_lane() -> None:
    """Two stops, one with a hanging recipient ahead: the retry of one never waits for the other (own lanes) and the
    hanging ones are cut by their own deadline (a hang is a timeout, so each gets its one retry, also cut)."""
    w = await flooded_world(stopped=("crew-c", "crew-d"), flooded=("crew-c",))
    hanging = {f"https://push.example/hang-crew-c-{n}" for n in range(199)}

    async def behave(sub: SubscriptionRecord, message: OutboundMessage, call: int) -> DeliveryResult:
        if sub.endpoint in hanging and is_stop_message(message):
            await asyncio.Event().wait()
        if sub.endpoint == "https://push.example/real-crew-d" and is_stop_message(message) and call == 1:
            return http(503)
        return OK

    channel = ScriptedChannel(behave)
    limits = DeliveryLimits(delivery_deadline_s=0.5, run_budget_s=60, retry_backoff_s=0.02, min_retry_window_s=0.05)
    await asyncio.wait_for(run_with(w, channel, RUN_AT, limits), timeout=30)

    [d_row] = [r for r in w.crew_events("crew-d") if r.valid_from == STOP_FROM]
    assert (d_row.delivered, d_row.failed) == (1, 0)  # retried and delivered while crew-c's flood was still hanging
    assert channel.calls[(await _sub_id(w, "https://push.example/real-crew-d"), "crew", STOP_FROM)] == 2


async def _sub_id(w: World, endpoint: str) -> str:
    [found] = [r for r in await w.subs.for_crew("crew-d", 1) if r.endpoint == endpoint]
    return found.id


@pytest.mark.asyncio
async def test_a_stop_never_takes_longer_than_the_send_deadline_even_when_both_attempts_hang() -> None:
    """Both attempts hang: attempt 1 is cut at 0.6 x 0.5 = 0.3 s, the 0.02 s wait follows, the retry gets the rest
    (0.18 s) and is cut at the 0.5 s deadline. The stop's whole send takes 0.5 s, never more (real clock; slack for a
    loaded host)."""
    ended: list[float] = []

    async def behave(sub: SubscriptionRecord, message: OutboundMessage, call: int) -> DeliveryResult:
        if not is_stop_message(message):
            return OK
        try:
            await asyncio.Event().wait()
        finally:
            ended.append(time.monotonic())
        raise AssertionError("unreachable")

    w = await stop_world()
    channel = ScriptedChannel(behave)
    limits = DeliveryLimits(delivery_deadline_s=0.5, run_budget_s=60, retry_backoff_s=0.02, min_retry_window_s=0.05)
    began = time.monotonic()
    await asyncio.wait_for(run_with(w, channel, RUN_AT, limits), timeout=20)

    assert calls_of(channel, stop=True) == [2]
    assert len(ended) == 2
    assert 0.45 <= ended[-1] - began <= 0.5 + 0.3  # the retry ended AT the deadline: never after it
    assert (stop_row(w).delivered, stop_row(w).failed) == (0, 1)


@pytest.mark.asyncio
async def test_a_slow_but_working_service_is_cut_earlier_for_stops_only() -> None:
    """The cost of the split, stated as a test. A push service that answers every call after 0.15 s, per-send deadline
    0.2 s: an ordinary event waits the whole 0.2 s and is delivered; a stop's first attempt is cut at 0.6 x 0.2 =
    0.12 s, and the retry (0.2 - 0.12 - 0.02 = 0.06 s) cannot take 0.15 s either: the stop FAILS. A service that
    answers within the first attempt's share is unaffected."""

    async def slow(sub: SubscriptionRecord, message: OutboundMessage, call: int) -> DeliveryResult:
        await asyncio.sleep(0.15)
        return OK

    w = await stop_world()
    channel = ScriptedChannel(slow)
    limits = DeliveryLimits(delivery_deadline_s=0.2, run_budget_s=60, retry_backoff_s=0.02, min_retry_window_s=0.02)
    await asyncio.wait_for(run_with(w, channel, RUN_AT, limits), timeout=20)

    assert (stop_row(w).delivered, stop_row(w).failed) == (0, 1)  # the stop was cut earlier
    [site_row] = [r for r in w.site_events() if r.level is R]
    assert (site_row.delivered, site_row.failed) == (1, 0)  # the ordinary event was not
    assert max(calls_of(channel, stop=False)) == 1


@pytest.mark.asyncio
async def test_the_retry_log_has_the_subscription_id_attempt_and_reason_only(
    caplog: pytest.LogCaptureFixture,
) -> None:
    w = await stop_world()
    [sub] = await w.subs.for_crew("crew-d", 1)
    channel = ScriptedChannel(script(http(503, 1.0), OK))
    clock = Clock()
    limits = DeliveryLimits(run_budget_s=300, monotonic=clock, sleep=clock.sleep, started_at=0.0)

    with structlog.testing.capture_logs() as captured:
        await asyncio.wait_for(run_with(w, channel, RUN_AT, limits), timeout=20)

    [line] = [c for c in captured if c["event"] == "alerts.send_retry"]
    assert line["subscription_id"] == sub.id
    assert line["attempt"] == 2
    assert line["reason"] == "http_5xx"
    assert set(line) <= {"event", "log_level", "subscription_id", "attempt", "reason"}
    assert sub.endpoint not in str(captured) + caplog.text


@pytest.mark.asyncio
async def test_the_event_row_shape_is_unchanged_and_amber_world_never_retries() -> None:
    """A world with no stop (forecast amber): nothing is an operator stop, whatever fails."""
    w = await world(AMBER_FROM_10)
    await w.subscribe("https://push.example/a")
    channel = ScriptedChannel(lambda sub, message, call: _always(http(503)))
    clock = Clock()
    limits = DeliveryLimits(run_budget_s=300, monotonic=clock, sleep=clock.sleep, started_at=0.0)

    await asyncio.wait_for(run_with(w, channel, datetime(2026, 7, 1, 3, tzinfo=UTC), limits), timeout=20)

    assert set(channel.calls.values()) == {1}
    assert clock.slept == []
