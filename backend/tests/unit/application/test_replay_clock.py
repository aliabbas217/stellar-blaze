"""The replay clock: ``anchor + (wall now - start of the current epoch)``, the epoch start read from Postgres, so the
api, the alerts worker and any restart agree (ADR 0034 amendment of 2026-11-15); the anchor has one derivation."""

import asyncio
from datetime import UTC, date, datetime, timedelta, timezone

import pytest
import structlog

from stellar_blaze.application import replay_clock
from stellar_blaze.application.replay_clock import (
    REPLAY_LOCAL_TIME,
    REPLAY_WINDOW,
    EpochReplayClock,
    ReplayClockUnavailableError,
    domain_clock,
    replay_reading,
)

pytestmark = pytest.mark.unit

ANCHOR = datetime(2025, 7, 10, 7, 10, tzinfo=UTC)  # 11:10 in Asia/Dubai on the replay day
EPOCH_START = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)  # when the demo epoch began (the site_epoch row), months later
DEMO_ANCHOR = datetime(2026, 6, 14, 6, 10, tzinfo=UTC)  # the deployed SB_REPLAY_NOW: 10:10 Asia/Dubai on the replay day
DEMO_END = datetime(2026, 6, 14, 13, 30, tzinfo=UTC)  # 17:30 Asia/Dubai: the end of the demo window (excluded)


@pytest.fixture
def fresh_logger(monkeypatch: pytest.MonkeyPatch) -> None:
    """The module logger, not yet bound: ``cache_logger_on_first_use`` makes a logger that an earlier test used ignore
    the processors ``structlog.testing.capture_logs`` installs, so a test that captures its lines would depend on test
    order."""
    monkeypatch.setattr(replay_clock, "logger", structlog.stdlib.get_logger(replay_clock.__name__))


class Wall:
    """A settable stand-in for the real clock."""

    def __init__(self, now: datetime = EPOCH_START) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


class Source:
    """The ``site_epoch`` row: ``start`` is what a read returns; ``error`` makes the database unreachable. ``await
    asyncio.sleep(0)`` yields to the loop, so concurrent readers really interleave."""

    def __init__(self, start: datetime | None = EPOCH_START) -> None:
        self.start = start
        self.error: Exception | None = None
        self.calls = 0

    async def current_epoch_start(self) -> datetime | None:
        self.calls += 1
        await asyncio.sleep(0)
        if self.error is not None:
            raise self.error
        return self.start


class HangingSource:
    async def current_epoch_start(self) -> datetime | None:
        await asyncio.Event().wait()
        return None


def clock_of(wall: Wall, source: Source, **kwargs: float) -> EpochReplayClock:
    return EpochReplayClock(ANCHOR, wall, source, **kwargs)


# --- the formula ----------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_it_reads_the_anchor_at_the_epoch_start_whatever_the_wall_clock_says() -> None:
    clock = clock_of(Wall(), Source())
    await clock.refresh()

    assert clock.now() == ANCHOR  # wall 09:00 - epoch start 09:00 = 0
    assert clock() == ANCHOR  # the Services.clock shape: a plain callable
    assert clock.now().tzinfo is UTC


@pytest.mark.asyncio
async def test_it_is_the_anchor_plus_the_wall_time_elapsed_since_the_epoch_start() -> None:
    wall = Wall(EPOCH_START + timedelta(minutes=3, seconds=30))  # a process that started 3 min 30 s into the epoch
    clock = clock_of(wall, Source())

    await clock.refresh()

    assert clock.now() == ANCHOR + timedelta(minutes=3, seconds=30)  # 07:10Z + 3:30, not the anchor: no process start


@pytest.mark.asyncio
async def test_a_reading_before_the_epoch_start_is_the_anchor() -> None:
    wall = Wall(EPOCH_START - timedelta(minutes=10))  # a replica whose clock runs 10 minutes behind the writer's
    clock = clock_of(wall, Source())

    await clock.refresh()

    assert clock.now() == ANCHOR  # elapsed = max(0, -10 min) = 0


@pytest.mark.asyncio
async def test_the_anchor_is_normalized_to_utc_and_the_epoch_start_may_be_any_offset() -> None:
    dubai = timezone(timedelta(hours=4))
    wall = Wall(EPOCH_START + timedelta(minutes=5))
    # 13:00+04:00 is 09:00Z, the same instant as EPOCH_START.
    clock = EpochReplayClock(
        datetime(2025, 7, 10, 11, 10, tzinfo=dubai), wall, Source(datetime(2026, 11, 15, 13, 0, tzinfo=dubai))
    )

    await clock.refresh()

    assert clock.now() == ANCHOR + timedelta(minutes=5)
    assert clock.now().utcoffset() == timedelta(0)


def test_a_naive_anchor_is_refused() -> None:
    with pytest.raises(ValueError, match="aware"):
        EpochReplayClock(datetime(2025, 7, 10, 7, 10), Wall(), Source())  # noqa: DTZ001


@pytest.mark.asyncio
async def test_a_naive_wall_clock_is_refused() -> None:
    wall = Wall()
    clock = clock_of(wall, Source())
    await clock.refresh()
    wall.now = datetime(2026, 11, 15, 9, 5)  # noqa: DTZ001 (a later naive reading)

    with pytest.raises(ValueError, match="aware"):
        clock.now()


@pytest.mark.asyncio
async def test_a_naive_epoch_start_is_a_failed_read_not_a_time() -> None:
    clock = clock_of(Wall(), Source(datetime(2026, 11, 15, 9, 0)))  # noqa: DTZ001

    await clock.refresh()  # never raises

    with pytest.raises(ReplayClockUnavailableError):
        clock.now()


# --- the cache ------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_source_is_read_once_inside_the_interval_again_after_it_and_on_force() -> None:
    wall, source = Wall(), Source()
    clock = clock_of(wall, source, ttl_s=5.0)

    await clock.refresh()
    wall.advance(seconds=4.9)
    await clock.refresh()
    assert source.calls == 1  # age 4.9 s < 5 s: from the cache

    wall.advance(seconds=0.1)
    await clock.refresh()
    assert source.calls == 2  # age 5.0 s: read again

    await clock.refresh()
    assert source.calls == 2  # fresh again
    await clock.refresh(force=True)
    assert source.calls == 3  # force reads whatever the age


@pytest.mark.asyncio
async def test_concurrent_refreshes_read_the_source_once() -> None:
    source = Source()
    clock = clock_of(Wall(), source)

    await asyncio.gather(*(clock.refresh() for _ in range(10)))

    assert source.calls == 1  # ten requests arriving together make one read, not ten


# --- fail closed ----------------------------------------------------------------------------------


def test_a_clock_that_was_never_loaded_has_no_time() -> None:
    clock = clock_of(Wall(), Source())

    with pytest.raises(ReplayClockUnavailableError):
        clock.now()  # no invented time: not the anchor, not the wall clock


@pytest.mark.asyncio
@pytest.mark.usefixtures("fresh_logger")
async def test_an_unreachable_database_at_the_first_read_leaves_no_time_and_refresh_never_raises() -> None:
    source = Source()
    source.error = ConnectionRefusedError("password=hunter2 host=db.internal")
    clock = clock_of(Wall(), source)

    with structlog.testing.capture_logs() as logs:
        await clock.refresh()

    with pytest.raises(ReplayClockUnavailableError):
        clock.now()
    errors = [entry for entry in logs if entry["log_level"] == "error"]
    assert len(errors) == 1  # one line per failure, at error level
    assert errors[0]["error"] == "ConnectionRefusedError"  # the class only
    assert "hunter2" not in str(logs)  # never the message: it may carry connection details


@pytest.mark.asyncio
@pytest.mark.usefixtures("fresh_logger")
async def test_an_unreachable_database_keeps_the_last_epoch_start_for_max_stale_seconds_then_fails_closed() -> None:
    wall, source = Wall(), Source()
    clock = clock_of(wall, source, ttl_s=5.0, max_stale_s=30.0)
    await clock.refresh()  # the last good read, at 09:00:00
    source.error = TimeoutError()

    wall.advance(seconds=10)
    with structlog.testing.capture_logs() as logs:
        await clock.refresh()  # fails; the cache stays
        assert clock.now() == ANCHOR + timedelta(seconds=10)  # 10 s since the last good read: still served

        wall.advance(seconds=20)  # 30 s since the last good read: exactly max_stale, still served
        await clock.refresh()
        assert clock.now() == ANCHOR + timedelta(seconds=30)

        wall.advance(seconds=6)  # 36 s: older than max_stale, and the retry (6 s after the last try) failed too
        await clock.refresh()
        with pytest.raises(ReplayClockUnavailableError):
            clock.now()
    assert [entry["log_level"] for entry in logs] == ["error", "error", "error"]  # one per failed read


@pytest.mark.asyncio
async def test_a_failed_read_is_not_retried_inside_the_interval_and_the_clock_recovers() -> None:
    wall, source = Wall(), Source()
    source.error = OSError()
    clock = clock_of(wall, source, ttl_s=5.0)

    await clock.refresh()
    wall.advance(seconds=2)
    await clock.refresh()
    assert source.calls == 1  # a down database is not hammered once per request

    source.error = None
    wall.advance(seconds=3)
    await clock.refresh()
    assert clock.now() == ANCHOR + timedelta(seconds=5)  # it healed: 5 s since the epoch start


@pytest.mark.asyncio
async def test_no_synthetic_epoch_is_no_time_even_after_a_good_read() -> None:
    wall, source = Wall(), Source()
    clock = clock_of(wall, source)
    await clock.refresh()
    assert clock.now() == ANCHOR

    source.start = None  # the synthetic site is gone
    await clock.refresh(force=True)

    with pytest.raises(ReplayClockUnavailableError, match="epoch"):
        clock.now()


@pytest.mark.asyncio
async def test_a_source_that_hangs_is_a_failed_read_after_the_read_timeout() -> None:
    clock = EpochReplayClock(ANCHOR, Wall(), HangingSource(), read_timeout_s=0.05)

    await asyncio.wait_for(clock.refresh(), timeout=5)  # returns: a hang cannot hold every request behind it

    with pytest.raises(ReplayClockUnavailableError):
        clock.now()


@pytest.mark.asyncio
async def test_a_cancelled_refresh_is_still_cancelled() -> None:
    clock = EpochReplayClock(ANCHOR, Wall(), HangingSource())

    task = asyncio.create_task(clock.refresh())
    await asyncio.sleep(0.01)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task  # shutdown must not be swallowed by "refresh never raises"


# --- monotone within an epoch; a new epoch re-anchors ---------------------------------------------


@pytest.mark.asyncio
async def test_a_wall_clock_that_steps_back_never_moves_the_reading_back_within_an_epoch() -> None:
    wall = Wall()
    clock = clock_of(wall, Source())
    await clock.refresh()
    wall.advance(minutes=10)
    await clock.refresh()
    later = clock.now()
    assert later == ANCHOR + timedelta(minutes=10)

    wall.advance(minutes=-4)  # an NTP correction
    await clock.refresh()

    assert clock.now() == later  # held until the wall catches up
    wall.advance(minutes=5)
    await clock.refresh()
    assert clock.now() == ANCHOR + timedelta(minutes=11)  # 09:11 - 09:00


@pytest.mark.asyncio
async def test_a_changed_epoch_start_moves_the_reading_back_to_the_anchor() -> None:
    wall, source = Wall(), Source()
    clock = clock_of(wall, source)
    await clock.refresh()
    wall.advance(hours=2)
    await clock.refresh()
    assert clock.now() == ANCHOR + timedelta(hours=2)

    source.start = wall.now  # a demo reset: a new epoch begins now
    await clock.refresh(force=True)

    assert clock.now() == ANCHOR  # allowed to go back: the reset is the way out of the 7 h 20 min window
    wall.advance(minutes=1)
    await clock.refresh()
    assert clock.now() == ANCHOR + timedelta(minutes=1)


# --- two processes over one epoch row -------------------------------------------------------------


@pytest.mark.asyncio
async def test_two_clocks_over_one_source_read_the_same_instant_also_after_a_restart() -> None:
    wall, source = Wall(), Source()
    api = clock_of(wall, source)  # built at 09:00, the epoch start
    wall.advance(hours=2)
    worker = clock_of(wall, source)  # built two hours later
    await api.refresh()
    await worker.refresh()
    assert api.now() == worker.now() == ANCHOR + timedelta(hours=2)  # a late-started worker is not at the anchor

    wall.advance(minutes=45)
    restarted_api = clock_of(wall, source)  # the api restarts: a fresh process, a fresh cache
    for clock in (api, worker, restarted_api):
        await clock.refresh()
    assert api.now() == worker.now() == restarted_api.now() == ANCHOR + timedelta(hours=2, minutes=45)

    restarted_worker = clock_of(wall, source)
    await restarted_worker.refresh()
    assert restarted_worker.now() == api.now()


@pytest.mark.asyncio
async def test_a_reset_re_anchors_both_processes_at_once_with_force_and_within_the_interval_without() -> None:
    wall, source = Wall(), Source()
    api, worker = clock_of(wall, source, ttl_s=5.0), clock_of(wall, source, ttl_s=5.0)
    await api.refresh()
    await worker.refresh()
    wall.advance(hours=3)
    await api.refresh()
    await worker.refresh()
    assert api.now() == worker.now() == ANCHOR + timedelta(hours=3)

    source.start = wall.now  # POST demo-reset: the epoch row is written; the api forces its refresh at once
    await api.refresh(force=True)
    assert api.now() == ANCHOR  # at once
    assert worker.now() == ANCHOR + timedelta(hours=3)  # the worker still has the old cache: inside its interval

    wall.advance(seconds=5)  # the worker's next cycle, after the interval
    await worker.refresh()
    await api.refresh()
    assert worker.now() == api.now() == ANCHOR + timedelta(seconds=5)


# --- the anchor's one derivation ------------------------------------------------------------------


def test_the_replay_local_time_is_11_10() -> None:
    assert (REPLAY_LOCAL_TIME.hour, REPLAY_LOCAL_TIME.minute) == (11, 10)


@pytest.mark.asyncio
async def test_an_explicit_replay_now_is_the_anchor() -> None:
    explicit = datetime(2025, 7, 11, 5, 0, tzinfo=UTC)
    clock = domain_clock(
        source="replay",
        replay_now=explicit,
        replay_default_date=date(2025, 7, 10),
        wall=Wall(),
        epoch_source=Source(),
    )
    assert isinstance(clock, EpochReplayClock)

    await clock.refresh()

    assert clock() == explicit  # replay_now wins over the date


@pytest.mark.asyncio
async def test_the_default_date_gives_11_10_in_dubai() -> None:
    clock = domain_clock(
        source="replay", replay_now=None, replay_default_date=date(2025, 7, 10), wall=Wall(), epoch_source=Source()
    )
    assert isinstance(clock, EpochReplayClock)

    await clock.refresh()

    assert clock() == datetime(2025, 7, 10, 7, 10, tzinfo=UTC)  # 11:10 at UTC+4


def test_replay_with_neither_setting_uses_the_wall_clock() -> None:
    wall = Wall()

    clock = domain_clock(source="replay", replay_now=None, replay_default_date=None, wall=wall, epoch_source=Source())

    assert clock is wall


def test_a_live_source_ignores_both_settings_and_the_epoch() -> None:
    wall = Wall()

    clock = domain_clock(
        source="open_meteo", replay_now=ANCHOR, replay_default_date=date(2025, 7, 10), wall=wall, epoch_source=Source()
    )

    assert clock is wall


def test_a_replay_anchor_without_an_epoch_source_is_refused_not_started_at_process_start() -> None:
    with pytest.raises(ValueError, match="epoch source"):
        domain_clock(source="replay", replay_now=ANCHOR, replay_default_date=None, wall=Wall())


# --- the window repeats (ADR 0034 amendment of 2026-11-20) --------------------------------------------------------


def test_the_window_is_the_7_h_20_min_from_10_10_to_17_30_dubai() -> None:
    assert timedelta(hours=7, minutes=20) == REPLAY_WINDOW
    assert DEMO_ANCHOR + REPLAY_WINDOW == DEMO_END


@pytest.mark.parametrize(
    ("elapsed", "reads"),
    [
        (timedelta(0), DEMO_ANCHOR),  # the epoch start
        (timedelta(minutes=1), DEMO_ANCHOR + timedelta(minutes=1)),
        (timedelta(hours=7, minutes=19, seconds=59), DEMO_END - timedelta(seconds=1)),  # the last second of the window
        (timedelta(hours=7, minutes=20), DEMO_ANCHOR),  # the wrap instant: back at the anchor, never 17:30
        (timedelta(hours=7, minutes=20, seconds=1), DEMO_ANCHOR + timedelta(seconds=1)),
        (timedelta(hours=50), DEMO_ANCHOR + timedelta(hours=6)),  # 6 windows (44 h) + 6 h: 16:10 Dubai
        (timedelta(days=10), DEMO_ANCHOR + timedelta(hours=5, minutes=20)),  # 32 windows (234 h 40 min) + 5 h 20 min
        (timedelta(minutes=-10), DEMO_ANCHOR),  # a writer's clock ahead of this reader's: the anchor
    ],
    ids=["start", "plus-1-min", "last-second", "wrap-instant", "wrap-plus-1-s", "50-hours", "10-days", "before-start"],
)
def test_the_reading_is_the_anchor_plus_the_elapsed_time_modulo_the_window(elapsed: timedelta, reads: datetime) -> None:
    assert replay_reading(DEMO_ANCHOR, EPOCH_START + elapsed, EPOCH_START) == reads


def test_the_reading_is_always_inside_the_window_whatever_the_age_of_the_epoch() -> None:
    for minutes in range(0, 60 * 24 * 40, 37):  # forty days in 37 minute steps: no phase lines up with the window
        reading = replay_reading(DEMO_ANCHOR, EPOCH_START + timedelta(minutes=minutes), EPOCH_START)
        assert DEMO_ANCHOR <= reading < DEMO_END


def test_the_reading_refuses_naive_instants() -> None:
    naive = datetime(2026, 11, 15, 9, 0)  # noqa: DTZ001
    with pytest.raises(ValueError, match="aware"):
        replay_reading(DEMO_ANCHOR, naive, EPOCH_START)
    with pytest.raises(ValueError, match="aware"):
        replay_reading(DEMO_ANCHOR, EPOCH_START, naive)
    with pytest.raises(ValueError, match="aware"):
        replay_reading(naive, EPOCH_START, EPOCH_START)


def demo_clock(wall: Wall, source: Source) -> EpochReplayClock:
    return EpochReplayClock(DEMO_ANCHOR, wall, source)


@pytest.mark.asyncio
async def test_regression_a_50_hour_old_epoch_reads_inside_the_working_day() -> None:
    """Live 2026-11-20: the clock ran on for two days and the supervisor screen said "off shift, no level"."""
    wall, source = Wall(EPOCH_START + timedelta(hours=50)), Source()
    clock = demo_clock(wall, source)

    await clock.refresh()

    reading = clock.now()
    assert DEMO_ANCHOR <= reading < DEMO_END
    assert reading == datetime(2026, 6, 14, 12, 10, tzinfo=UTC)  # 16:10 Dubai, the same day as the anchor


@pytest.mark.asyncio
async def test_the_reading_goes_from_17_29_59_to_10_10_at_the_wrap_instant() -> None:
    wall, source = Wall(EPOCH_START + timedelta(hours=7, minutes=19, seconds=59)), Source()
    clock = demo_clock(wall, source)
    await clock.refresh()
    assert clock.now() == DEMO_END - timedelta(seconds=1)

    wall.advance(seconds=1)  # exactly 7 h 20 min after the epoch start

    assert clock.now() == DEMO_ANCHOR  # a new cycle: allowed to go back, and 17:30 is never read
    wall.advance(seconds=1)
    assert clock.now() == DEMO_ANCHOR + timedelta(seconds=1)  # and it runs on at real speed


@pytest.mark.asyncio
async def test_a_wall_clock_that_steps_back_across_the_wrap_holds_the_reading_it_gave() -> None:
    wall, source = Wall(EPOCH_START + timedelta(hours=7, minutes=20, seconds=30)), Source()
    clock = demo_clock(wall, source)
    await clock.refresh()
    assert clock.now() == DEMO_ANCHOR + timedelta(seconds=30)  # the second cycle

    wall.advance(seconds=-40)  # an NTP correction back over the wrap: the previous cycle's 17:29:50

    assert clock.now() == DEMO_ANCHOR + timedelta(seconds=30)  # held, not 17:29:50 and then back again
    wall.advance(seconds=40)
    assert clock.now() == DEMO_ANCHOR + timedelta(seconds=30)
    wall.advance(seconds=1)
    assert clock.now() == DEMO_ANCHOR + timedelta(seconds=31)


@pytest.mark.asyncio
async def test_two_processes_read_the_same_instant_before_at_and_long_after_the_wrap() -> None:
    wall, source = Wall(EPOCH_START + timedelta(hours=3)), Source()
    api = demo_clock(wall, source)
    for elapsed in (timedelta(hours=7, minutes=19, seconds=59), timedelta(hours=7, minutes=20), timedelta(hours=50)):
        wall.now = EPOCH_START + elapsed
        worker = demo_clock(wall, source)  # a worker restarted this second: no cache, no history
        await api.refresh(force=True)
        await worker.refresh()
        assert api.now() == worker.now()  # the same wall second gives the same domain time in both processes


@pytest.mark.asyncio
async def test_an_explicit_replay_now_anchors_the_window_wherever_it_is() -> None:
    late = datetime(2026, 6, 14, 14, 0, tzinfo=UTC)  # 18:00 Dubai: the window is 18:00 to 01:20, past midnight
    wall, source = Wall(EPOCH_START + timedelta(hours=7, minutes=20, seconds=5)), Source()
    clock = EpochReplayClock(late, wall, source)
    await clock.refresh()

    assert clock.now() == late + timedelta(seconds=5)  # the window is anchor + 7 h 20 min, not a fixed 17:30


@pytest.mark.asyncio
async def test_a_reset_in_a_later_cycle_re_anchors_to_the_anchor() -> None:
    wall, source = Wall(EPOCH_START + timedelta(hours=50)), Source()
    clock = demo_clock(wall, source)
    await clock.refresh()
    assert clock.now() == datetime(2026, 6, 14, 12, 10, tzinfo=UTC)

    source.start = wall.now  # a demo reset
    await clock.refresh(force=True)

    assert clock.now() == DEMO_ANCHOR
