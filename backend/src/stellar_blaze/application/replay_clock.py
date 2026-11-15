"""The replay clock: the domain's "now" in replay mode (ADR 0057 replay demo; ADR 0034 amendment of 2026-11-15).

Replay mode serves a fixed past day, but a crew stop and a sign-off are stamped with "now". Stamped with the real clock
they would never fall on the replay day, and "Stop work" would visibly do nothing. ``EpochReplayClock`` reads

    replay anchor + (wall now - start of the current demo epoch)

where the epoch start is the ``started_at`` of the latest ``site_epoch`` row of the synthetic sites, read from Postgres
(``ports.replay_epoch.ReplayEpochSource``). The API and ``sb-jobs alerts run`` are separate processes; because both read
the same row they agree on replay time, and a restart of either changes nothing (it used to return that process to the
anchor). A demo reset (ADR 0066) starts a new epoch, so it re-anchors both: the API at once (the reset route forces a
refresh), the worker at its next cycle, within the cache interval. The replay time passes 17:30 Dubai about 7 h 20 min
after the epoch starts; after that a reset is needed (the README run recipe says when).

The clock is read synchronously (``Services.clock()``, in stores and use cases) but the epoch start lives in a database,
so it is read by an explicit ``await clock.refresh()`` at the ENTRY of a request or a job cycle and cached for a few
seconds. A database that cannot be read fails CLOSED: ``now()`` raises ``ReplayClockUnavailableError`` rather than
invent a time.

Only the DOMAIN clock follows it (stop and sign-off stamps, the ``now`` of ``site_day`` and the use cases). The WALL
clock stays real for the audit ``at`` (the tamper-evident record of when it really happened), ``job_run``, the rate
limiter, ``reset_at`` and logs: ``Services.clock`` is the domain clock and ``Services.wall_clock`` the real one.

The anchor and its derivation live here and nowhere else: ``domain_clock``.
"""

import asyncio
from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo

import structlog

from stellar_blaze.ports.replay_epoch import ReplayEpochSource

__all__ = [
    "REPLAY_LOCAL_TIME",
    "REPLAY_LOCAL_ZONE",
    "EpochReplayClock",
    "ReplayClockUnavailableError",
    "domain_clock",
]

logger = structlog.stdlib.get_logger(__name__)

# The F2 prototype's replay time: 11:10 on the replay date, Asia/Dubai local (the demo site's zone, UTC+4, no DST).
REPLAY_LOCAL_TIME: Final = time(11, 10)
REPLAY_LOCAL_ZONE: Final = "Asia/Dubai"


class ReplayClockUnavailableError(Exception):
    """The replay clock has no trustworthy time: the epoch start was never read, the database says no synthetic site
    has an epoch, or the cache is older than ``max_stale_s`` and could not be refreshed. The API answers 503
    ``dependency-unavailable`` (``dependency: database``); an alerts cycle fails like any other and the loop goes on."""


def _aware(value: datetime, what: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{what} must be timezone-aware")
    return value


class EpochReplayClock:
    """``now()`` is ``anchor + max(0, wall now - epoch start)``; the epoch start is cached from ``source``.

    Aware UTC only. Within one epoch the reading never moves backwards (a wall clock that steps back, an NTP correction,
    leaves it where it was until the wall catches up); a CHANGED epoch start (a demo reset) moves it back to the anchor.
    A reading just before the epoch start (a replica whose clock runs behind the writer's) is the anchor.

    ``refresh`` is awaited by whoever is about to read: it reads the source when the last try is older than ``ttl_s``
    (measured on ``wall``) or when ``force`` is set (the demo-reset route), one read at a time however many callers
    wait. It never raises: a failed read keeps the previous cache and logs the exception CLASS at error level (never its
    text, which can carry connection details); a failed try is not repeated before ``ttl_s`` has passed. ``now()``
    raises ``ReplayClockUnavailableError`` when nothing was ever read, when the source says there is no synthetic epoch,
    or when the last successful read is older than ``max_stale_s``.

    Args:
        anchor: The instant the clock reads at the epoch start (timezone-aware; normalized to UTC).
        wall: The real clock (timezone-aware).
        source: Where the current epoch start is read.
        ttl_s: How long a read (or a failed try) is reused.
        max_stale_s: How long the last good read may be served while the source is unreachable.
        read_timeout_s: Bound of one source read, so a hanging database cannot hold every request behind it.

    Raises:
        ValueError: ``anchor`` or a ``wall`` reading is naive.
    """

    def __init__(
        self,
        anchor: datetime,
        wall: Callable[[], datetime],
        source: ReplayEpochSource,
        *,
        ttl_s: float = 5.0,
        max_stale_s: float = 30.0,
        read_timeout_s: float = 3.0,
    ) -> None:
        self._anchor = _aware(anchor, "the replay anchor").astimezone(UTC)
        self._wall = wall
        self._source = source
        self._ttl = timedelta(seconds=ttl_s)
        self._max_stale = timedelta(seconds=max_stale_s)
        self._read_timeout_s = read_timeout_s
        self._epoch_start: datetime | None = None  # None with ``_loaded_at`` set: the database has no synthetic epoch
        self._loaded_at: datetime | None = None  # wall time of the last successful read; None: never read
        self._attempted_at: datetime | None = None  # wall time of the last try, good or bad
        self._last: datetime | None = None  # the last reading of this epoch (monotone)
        # An asyncio.Lock belongs to the loop that first waits on it; the clock outlives a test's loops, so it is made
        # again for a new loop (a process has one loop and never does).
        self._lock = asyncio.Lock()
        self._lock_loop: asyncio.AbstractEventLoop | None = None

    def _wall_now(self) -> datetime:
        return _aware(self._wall(), "the wall clock reading")

    def _recently_tried(self, wall_now: datetime) -> bool:
        # A negative age (the wall stepped back) is not "recent": it forces a read instead of trusting a cache that is
        # younger than it should be.
        return self._attempted_at is not None and timedelta(0) <= wall_now - self._attempted_at < self._ttl

    async def refresh(self, *, force: bool = False) -> None:
        """Read the epoch start from the source when the cache is older than ``ttl_s`` or ``force`` is set. Never raises
        for a source failure; cancellation still propagates."""
        if not force and self._recently_tried(self._wall_now()):
            return
        loop = asyncio.get_running_loop()
        if self._lock_loop is not loop:
            self._lock, self._lock_loop = asyncio.Lock(), loop
        async with self._lock:
            wall_now = self._wall_now()
            if not force and self._recently_tried(wall_now):
                return  # another caller read it while this one waited for the lock
            self._attempted_at = wall_now
            try:
                async with asyncio.timeout(self._read_timeout_s):
                    start = await self._source.current_epoch_start()
                if start is not None:
                    _aware(start, "the epoch start")
            except Exception as error:  # the class is logged, never the text; cancellation is not caught
                logger.error("replay_clock.refresh_failed", error=type(error).__name__)
                return
            self._adopt(None if start is None else start.astimezone(UTC), self._wall_now())

    def _adopt(self, start: datetime | None, loaded_at: datetime) -> None:
        if start != self._epoch_start:
            self._last = None  # a new epoch (or none): the reading may go back to the anchor
        self._epoch_start = start
        self._loaded_at = loaded_at

    def now(self) -> datetime:
        wall_now = self._wall_now()
        if self._loaded_at is None:
            raise ReplayClockUnavailableError("the replay epoch start has not been read")
        if self._epoch_start is None:
            raise ReplayClockUnavailableError("no synthetic site has a demo epoch")
        if wall_now - self._loaded_at > self._max_stale:
            raise ReplayClockUnavailableError(
                f"the replay epoch start could not be refreshed for more than {self._max_stale.total_seconds():g} s"
            )
        current = self._anchor + max(timedelta(0), wall_now - self._epoch_start)
        if self._last is not None:
            current = max(current, self._last)
        self._last = current
        return current

    def __call__(self) -> datetime:
        """The ``Services.clock`` shape: a callable that returns the instant."""
        return self.now()


def domain_clock(
    *,
    source: str,
    replay_now: datetime | None,
    replay_default_date: date | None,
    wall: Callable[[], datetime],
    epoch_source: ReplayEpochSource | None = None,
) -> Callable[[], datetime]:
    """The domain clock for the configured source.

    Replay source: an ``EpochReplayClock`` anchored at ``replay_now`` (``SB_REPLAY_NOW``) when set, else at
    ``replay_default_date`` at 11:10 Asia/Dubai (``REPLAY_LOCAL_TIME``), counting from the start of the current epoch
    that ``epoch_source`` reads. Replay with neither setting, and every other source, is the plain ``wall`` clock
    itself.

    Raises:
        ValueError: A replay anchor is set but there is no ``epoch_source``. A clock that counts from its own process
            start would silently disagree with the other process (the very defect this clock replaces), so it is not
            offered.
    """
    if source != "replay":
        return wall
    if replay_now is not None:
        anchor = replay_now
    elif replay_default_date is not None:
        anchor = datetime.combine(replay_default_date, REPLAY_LOCAL_TIME, tzinfo=ZoneInfo(REPLAY_LOCAL_ZONE))
    else:
        return wall
    if epoch_source is None:
        raise ValueError("a replay clock needs an epoch source (the site_epoch row): none was given")
    return EpochReplayClock(anchor, wall, epoch_source)
