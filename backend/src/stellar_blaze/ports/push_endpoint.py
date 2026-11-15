"""The syntactic check of a Web Push endpoint, shared by the public subscribe route and the Web Push channel.

The endpoint is later fetched by the server (a push), so a stored endpoint is a stored server-side request: it must be
an ``https`` URL of a public DNS name. The route applies the check when a subscription is stored
(``api.push_validation`` re-exports it) and the channel applies it again at SEND time, because a row can have been
stored before the check was tightened or by a path that is not the API, and because aiohttp does not resolve (so the
public-only resolver cannot judge) an IP literal. It lives in ``ports`` so that both the ``api`` and the ``adapters``
layers may import it. Nothing is resolved here (a lookup would be a request of its own). The function raises
``ValueError`` with a message that never contains the checked value (pydantic puts that message into the 422 body and
the logs).
"""

import ipaddress
import re
from typing import Final
from urllib.parse import urlsplit

__all__ = ["check_endpoint"]

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
