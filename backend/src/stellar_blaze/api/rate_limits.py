"""Rate limits of the employer-token operations, stated once (ADR 0051 amendments, supplement item 17).

The contract (`x-rate-limit` extension and operation description in ``openapi/v1.json``) and, from B3 Task 10, the
limiter both read these constants, so the published numbers cannot drift from the enforced ones. Limits are keyed per
access token; an exceeded limit is the ``rate-limited`` problem (429) with a ``Retry-After`` header.
"""

from typing import Any, NamedTuple


class RateLimit(NamedTuple):
    limit: int
    window_seconds: int


EMPLOYER_LIMITS: tuple[RateLimit, ...] = (RateLimit(limit=60, window_seconds=60),)
DEMO_RESET_LIMITS: tuple[RateLimit, ...] = (
    RateLimit(limit=1, window_seconds=60),
    RateLimit(limit=10, window_seconds=3600),
)
EXTENSION = "x-rate-limit"
KEYING_NOTE = (
    "Limits are keyed per access token. The public demo uses ONE shared demo token (ADR 0062), so per token means one "
    "global ceiling for all visitors; a per-visitor limit is the proxy's job (per IP, owned by the frontend)."
)


def extension(limits: tuple[RateLimit, ...]) -> dict[str, Any]:
    """The ``openapi_extra`` of a route: ``{"x-rate-limit": [{"limit": ..., "window_seconds": ...}]}``."""
    return {EXTENSION: [{"limit": item.limit, "window_seconds": item.window_seconds} for item in limits]}


def sentence(limits: list[dict[str, int]]) -> str:
    """The sentence appended to an operation description, built from the same numbers as the extension."""
    parts = [f"{item['limit']} per {item['window_seconds']} s" for item in limits]
    return f"Rate limit, per access token: {', '.join(parts)}. When exceeded: 429 with `Retry-After`. {KEYING_NOTE}"
