"""Syntactic checks of a Web Push subscription the PUBLIC route stores (ADR 0058 decision 3; fix round C2 / I1).

The endpoint is later fetched by the server (a push), so a stored endpoint is a stored server-side request: it must be
an ``https`` URL of a public DNS name. Nothing is resolved here (a lookup would be a request of its own): the check is
syntactic, so an IP literal in any notation, a single-label or reserved internal name, credentials in the URL and a
non-443 port are all refused. The functions raise ``ValueError`` with a message that never contains the checked value
(pydantic puts that message into the 422 body and the logs): they add no JSON-schema constraint, so the frozen
``/api/v1`` contract is unchanged. ``check_endpoint`` itself lives in ``ports.push_endpoint`` (the Web Push channel
applies it again at send time) and is re-exported here. It is SYNTACTIC only: the HOST allow-list (ADR 0067) needs the
active config, so the route applies ``check_endpoint_host`` itself and answers ``endpoint-host-not-allowed``.
"""

import math
import re
from typing import Final

from stellar_blaze.ports.push_endpoint import check_endpoint

__all__ = ["check_endpoint", "check_expiration", "check_key"]

_KEY: Final = re.compile(r"[A-Za-z0-9_-]+={0,2}")
_INT64_MAX: Final = 2**63


def _bad(what: str) -> ValueError:
    return ValueError(f"{what}: not an acceptable push subscription value")


def check_key(value: str) -> str:
    """A base64url key (RFC 7515: ``A-Z a-z 0-9 - _``, optional ``=`` padding), non-empty.

    Raises:
        ValueError: Not base64url.
    """
    if not _KEY.fullmatch(value):
        raise _bad("key is not base64url")
    return value


def check_expiration(value: float | None) -> float | None:
    """The expiry in epoch milliseconds, when finite, not negative and inside int64 (the column is a ``bigint``).

    Raises:
        ValueError: NaN, infinite, negative or beyond int64.
    """
    if value is None:
        return None
    if not math.isfinite(value) or not 0 <= value < _INT64_MAX:
        raise _bad("expirationTime is out of range")
    return value
