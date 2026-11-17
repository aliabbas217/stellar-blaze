"""Rate limits of the employer-token operations, stated once (ADR 0051 amendments, supplement item 17).

The contract (`x-rate-limit` extension and operation description in ``openapi/v1.json``) and, from B3 Task 10, the
limiter both read these constants, so the published numbers cannot drift from the enforced ones. Limits are keyed per
access token; an exceeded limit is the ``rate-limited`` problem (429) with a ``Retry-After`` header.
"""

from typing import Any, NamedTuple

from stellar_blaze.ports.push import MAX_SUBSCRIPTIONS_PER_CREW as MAX_SUBSCRIPTIONS_PER_CREW


class RateLimit(NamedTuple):
    limit: int
    window_seconds: int
    bucket: str | None = None  # a named bucket is independent of every other one (``stop``); None is the general one


EMPLOYER_LIMITS: tuple[RateLimit, ...] = (RateLimit(limit=60, window_seconds=60),)
DEMO_RESET_LIMITS: tuple[RateLimit, ...] = (
    RateLimit(limit=1, window_seconds=60),
    RateLimit(limit=10, window_seconds=3600),
)
# The safety path has its OWN bucket (ADR 0062 / ledger R-Q): no other operation's limit can ever block a stop.
STOP_BUCKET = "stop"
STOP_LIMITS: tuple[RateLimit, ...] = (RateLimit(limit=30, window_seconds=60, bucket=STOP_BUCKET),)
# Stored Web Push subscriptions are bounded (the route is public): per site, and per crew (the port states the crew
# cap: the dispatch's stop lane is sized to it), within one epoch.
MAX_SUBSCRIPTIONS_PER_SITE = 500
EXTENSION = "x-rate-limit"
KEYING_NOTE = (
    "Limits are keyed per access token. The public demo uses ONE shared demo token (ADR 0062), so per token means one "
    "global ceiling for all visitors; a per-visitor limit is the proxy's job (per IP, owned by the frontend)."
)


def extension(limits: tuple[RateLimit, ...]) -> dict[str, Any]:
    """The ``openapi_extra`` of a route: ``{"x-rate-limit": [{"limit": ..., "window_seconds": ...}]}``."""
    return {EXTENSION: [_entry(item) for item in limits]}


def _entry(item: RateLimit) -> dict[str, Any]:
    entry: dict[str, Any] = {"limit": item.limit, "window_seconds": item.window_seconds}
    if item.bucket is not None:
        entry["bucket"] = item.bucket
    return entry


def sentence(limits: list[dict[str, Any]]) -> str:
    """The sentence appended to an operation description, built from the same numbers as the extension."""
    parts = [f"{item['limit']} per {item['window_seconds']} s" for item in limits]
    own = ""
    if any(item.get("bucket") == STOP_BUCKET for item in limits):
        own = (
            " The stop has its own bucket, independent of every other employer operation: no other limit can block it."
        )
    return (
        f"Rate limit, per access token: {', '.join(parts)}.{own} When exceeded: 429 with `Retry-After`. {KEYING_NOTE}"
    )
