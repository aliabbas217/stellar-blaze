"""The replay clock: the domain's "now" in replay mode (ADR 0057 replay demo; controller ruling R-AG).

Replay mode serves a fixed past day, but a crew stop and a sign-off are stamped with "now". Stamped with the real clock
they would never fall on the replay day, and "Stop work" would visibly do nothing. ``ReplayClock`` starts at an anchor
on the replay day and then runs at real speed, so a stop has a start and a later clear that differ (a fixed instant
would give a stop that covers nothing).

Only the DOMAIN clock follows it (stop and sign-off stamps, the ``now`` of ``site_day`` and the use cases). The WALL
clock stays real for the audit ``at`` (the tamper-evident record of when it really happened), ``job_run``, the rate
limiter and logs: ``Services.clock`` is the domain clock and ``Services.wall_clock`` the real one.

The anchor and its derivation live here and nowhere else: ``domain_clock``.
"""

from collections.abc import Callable
from datetime import UTC, date, datetime, time
from typing import Final
from zoneinfo import ZoneInfo

__all__ = ["REPLAY_LOCAL_TIME", "REPLAY_LOCAL_ZONE", "ReplayClock", "domain_clock"]

# The F2 prototype's replay time: 11:10 on the replay date, Asia/Dubai local (the demo site's zone, UTC+4, no DST).
REPLAY_LOCAL_TIME: Final = time(11, 10)
REPLAY_LOCAL_ZONE: Final = "Asia/Dubai"


class ReplayClock:
    """``now()`` is ``anchor`` plus the real time elapsed since construction: it starts at the anchor and runs at real
    speed. Aware UTC only; never moves backwards (a wall clock that steps back, an NTP correction, leaves it where it
    was until the wall catches up).

    Args:
        anchor: The instant the clock reads when constructed (timezone-aware; normalized to UTC).
        wall: The real clock (timezone-aware); read once now and on every ``now()``.

    Raises:
        ValueError: ``anchor`` or a ``wall`` reading is naive.
    """

    def __init__(self, anchor: datetime, wall: Callable[[], datetime]) -> None:
        if anchor.tzinfo is None or anchor.utcoffset() is None:
            raise ValueError("the replay anchor must be timezone-aware")
        self._anchor = anchor.astimezone(UTC)
        self._wall = wall
        self._wall_at_start = self._wall_now()
        self._last = self._anchor

    def _wall_now(self) -> datetime:
        reading = self._wall()
        if reading.tzinfo is None or reading.utcoffset() is None:
            raise ValueError("the wall clock must return a timezone-aware datetime")
        return reading

    def now(self) -> datetime:
        current = self._anchor + (self._wall_now() - self._wall_at_start)
        self._last = max(current, self._last)
        return self._last

    def __call__(self) -> datetime:
        """The ``Services.clock`` shape: a callable that returns the instant."""
        return self.now()


def domain_clock(
    *, source: str, replay_now: datetime | None, replay_default_date: date | None, wall: Callable[[], datetime]
) -> Callable[[], datetime]:
    """The domain clock for the configured source.

    Replay source: a ``ReplayClock`` anchored at ``replay_now`` (``SB_REPLAY_NOW``) when set, else at
    ``replay_default_date`` at 11:10 Asia/Dubai (``REPLAY_LOCAL_TIME``). Replay with neither set, and every other
    source, is the plain ``wall`` clock itself.
    """
    if source != "replay":
        return wall
    if replay_now is not None:
        return ReplayClock(replay_now, wall)
    if replay_default_date is not None:
        anchor = datetime.combine(replay_default_date, REPLAY_LOCAL_TIME, tzinfo=ZoneInfo(REPLAY_LOCAL_ZONE))
        return ReplayClock(anchor, wall)
    return wall
