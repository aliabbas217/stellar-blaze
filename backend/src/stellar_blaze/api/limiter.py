"""The in-process sliding-window rate limiter of the employer operations (constants: ``api/rate_limits.py``).

Limits are keyed per access token (the token's SHA-256) and per named bucket. A request is admitted when EVERY window
of EVERY bucket it is charged to has room; only then is it recorded in all of them, so a refused request costs nothing.
The window slides: a request ages out ``window_seconds`` after it was admitted.

**Single replica.** The state lives in this process. With several replicas the effective ceiling is multiplied by the
replica count; the frontend proxy adds the per-IP limit, and with the shared demo token (ADR 0062) one token is one
global ceiling. The clock is injected (``Services.clock``) so tests move time without sleeping.

The crew stop is charged to its own bucket only (``STOP_LIMITS``), never to the general employer bucket: exhausting
every other operation cannot block a stop (the safety invariant, ledger R-Q).
"""

import math
from collections import deque
from collections.abc import Callable, Sequence
from datetime import datetime

from stellar_blaze.api.rate_limits import RateLimit

__all__ = ["RateLimitedError", "RateLimiter"]


class RateLimitedError(Exception):
    """The request exceeds a limit; ``retry_after`` is whole seconds (at least 1) until a slot frees."""

    def __init__(self, retry_after: int) -> None:
        super().__init__(f"rate limited, retry after {retry_after} s")
        self.retry_after = retry_after


class RateLimiter:
    def __init__(self, clock: Callable[[], datetime]) -> None:
        self._clock = clock
        self._admitted: dict[tuple[str, str, int], deque[float]] = {}

    def charge(self, token_key: str, buckets: Sequence[tuple[str, Sequence[RateLimit]]]) -> None:
        """Admit one request charged to every ``(bucket name, limits)`` pair, or raise ``RateLimitedError``.

        Raises:
            RateLimitedError: Some window is full; nothing was recorded.
        """
        now = self._clock().timestamp()
        windows: list[deque[float]] = []
        retry = 0
        for name, limits in buckets:
            for limit in limits:
                stamps = self._admitted.setdefault((name, token_key, limit.window_seconds), deque())
                while stamps and stamps[0] <= now - limit.window_seconds:
                    stamps.popleft()
                if len(stamps) >= limit.limit:
                    retry = max(retry, math.ceil(stamps[0] + limit.window_seconds - now))
                windows.append(stamps)
        if retry:
            raise RateLimitedError(max(retry, 1))
        for stamps in windows:
            stamps.append(now)
