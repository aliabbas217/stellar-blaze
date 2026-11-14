"""Syntactic checks of a Web Push subscription the PUBLIC route stores (ADR 0058 decision 3; fix round C2 / I1).

The endpoint is later fetched by the server (a push), so a stored endpoint is a stored server-side request: it must be
an ``https`` URL of a public DNS name. Nothing is resolved here (a lookup would be a request of its own): the check is
syntactic, so an IP literal in any notation, a single-label or reserved internal name, credentials in the URL and a
non-443 port are all refused. The functions raise ``ValueError`` with a message that never contains the checked value
(pydantic puts that message into the 422 body and the logs): they add no JSON-schema constraint, so the frozen
``/api/v1`` contract is unchanged.
"""

import ipaddress
import math
import re
from typing import Final
from urllib.parse import urlsplit

__all__ = ["check_endpoint", "check_expiration", "check_key"]

_INTERNAL_SUFFIXES: Final = (
    ".localhost",
    ".local",
    ".localdomain",
    ".internal",
    ".lan",
    ".intranet",
    ".corp",
    ".home",
    ".home.arpa",
)
_LABEL: Final = re.compile(r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?")
_TLD: Final = re.compile(r"[a-z]{2,63}|xn--[a-z0-9-]{1,59}")
_KEY: Final = re.compile(r"[A-Za-z0-9_-]+={0,2}")
_INT64_MAX: Final = 2**63


def _bad(what: str) -> ValueError:
    return ValueError(f"{what}: not an acceptable push subscription value")


def check_endpoint(value: str) -> str:
    """The endpoint, when it is an ``https`` URL of a public DNS name (syntactic check only).

    Raises:
        ValueError: Control characters or whitespace, a scheme other than https, credentials, a port other than 443, an
            IP literal (any notation), a single-label name, ``localhost`` or an internal-looking suffix.
    """
    if not value or any(ch.isspace() or ord(ch) < 0x20 or ord(ch) == 0x7F for ch in value):
        raise _bad("endpoint has control characters or whitespace")
    try:
        parts = urlsplit(value)
        host = parts.hostname
        port = parts.port
    except ValueError:
        raise _bad("endpoint is not a URL") from None
    if parts.scheme != "https":
        raise _bad("endpoint must be an https URL")
    if parts.username is not None or parts.password is not None:
        raise _bad("endpoint must not carry credentials")
    if port not in (None, 443):
        raise _bad("endpoint must use the https port")
    if host is None or not host.isascii():
        raise _bad("endpoint has no usable host")
    name = host.rstrip(".").lower()
    try:
        ipaddress.ip_address(name)
    except ValueError:
        pass
    else:
        raise _bad("endpoint host must be a DNS name, not an IP address")
    labels = name.split(".")
    # Every label is DNS-shaped and the last one (the TLD) is letters only (or punycode): that also refuses the integer,
    # octal and hex spellings of an IPv4 address that some URL parsers accept ("2130706433", "0x7f.1", "127.0.0.0x1").
    if len(labels) < 2 or not all(_LABEL.fullmatch(label) for label in labels) or not _TLD.fullmatch(labels[-1]):
        raise _bad("endpoint host must be a public DNS name")
    if name == "localhost" or name.endswith(_INTERNAL_SUFFIXES):
        raise _bad("endpoint host must be a public DNS name")
    return value


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
