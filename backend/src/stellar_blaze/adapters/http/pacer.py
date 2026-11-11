"""A minimum spacing between requests to one upstream service.

Free public services throttle a client that is too quick: IEM answers 429 to a handful of requests in a few seconds
(Task 8's live smoke test), and the Open-Meteo free tier allows 600 weighted calls a minute. The retry backoff of
``get_bytes`` recovers from a 429, but starting every request at the allowed pace avoids most of them.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable


class RequestPacer:
    """Lets a request start only once ``min_interval_s`` has passed since the previous one started.

    The first call returns at once. Calls from concurrent tasks are served one after the other. A pacer with an
    interval of 0 never waits (tests, and services that need no spacing). It paces one upstream: use one pacer per
    service.
    """

    def __init__(
        self,
        min_interval_s: float,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        """``clock`` and ``sleep`` are for tests: a fake clock that ``sleep`` advances needs no real waiting.

        Raises:
            ValueError: ``min_interval_s`` is negative or not a finite number.
        """
        if not 0.0 <= min_interval_s < float("inf"):
            raise ValueError(f"min_interval_s must be a finite number of seconds, 0 or more, got {min_interval_s!r}")
        self._interval = min_interval_s
        self._clock = clock
        self._sleep = sleep
        self._lock = asyncio.Lock()
        self._last_start: float | None = None

    async def wait(self) -> None:
        """Return when the next request may start, and count that moment as the start of a request."""
        async with self._lock:
            if self._last_start is not None:
                remaining = self._last_start + self._interval - self._clock()
                if remaining > 0:
                    await self._sleep(remaining)
            self._last_start = self._clock()
