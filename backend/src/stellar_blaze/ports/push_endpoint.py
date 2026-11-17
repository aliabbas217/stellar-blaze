"""The check of a Web Push endpoint, shared by the public subscribe route and the Web Push channel.

Two layers, both pure (nothing is resolved here: a lookup would be a request of its own):

* ``check_endpoint`` is SYNTACTIC. The endpoint is later fetched by the server (a push), so a stored endpoint is a
  stored server-side request: it must be an ``https`` URL of a public DNS name. The route applies it when a
  subscription is stored (``api.push_validation`` re-exports it) and the channel applies it again at SEND time, because
  a row can have been stored before the check was tightened or by a path that is not the API, and because aiohttp does
  not resolve (so the public-only resolver cannot judge) an IP literal.
* ``check_endpoint_host`` is the HOST ALLOW-LIST (ADR 0067): the host must belong to a push service. The final review
  showed what letting arbitrary public hosts in costs: hundreds of hanging subscriptions starve the 16-slot send lane
  (permanent loss of the event for every real subscriber), a hostile response is a memory bomb, and every new address
  form is a new SSRF refusal to write. Matching a short list of vendor hosts closes the three together at the one
  place a URL is accepted. ``check_send_endpoint`` is both layers, which is what the channel runs per send.

It lives in ``ports`` so that both the ``api`` and the ``adapters`` layers may import it. The functions raise
``ValueError`` with a message that never contains the checked value (pydantic puts that message into the 422 body and
the logs); a host off the list is the subclass ``EndpointHostNotAllowedError`` so the route can answer it with its own
problem type.

The built-in list below is the push services of the browsers Stellar Blaze targets (Android Chrome, iOS Safari web
push, Edge, Firefox). Each entry names the vendor document it comes from (fetched 2026-11-15). The operator extends it
at runtime through ``RuntimeConfig.push_extra_host_suffixes`` (ADR 0010); that can never remove an entry of this list.
"""

import ipaddress
import re
from collections.abc import Iterable
from typing import Final
from urllib.parse import urlsplit

__all__ = [
    "DEFAULT_EXACT_HOSTS",
    "DEFAULT_SUBDOMAIN_SUFFIXES",
    "EndpointHostNotAllowedError",
    "check_endpoint",
    "check_endpoint_host",
    "check_send_endpoint",
    "host_is_allowed",
]

# --- the built-in allow-list (ADR 0067) -------------------------------------------------------------------------------
#
# EXACT hosts: only that host matches, never a subdomain.
#
# * fcm.googleapis.com: Chrome (Chromium-based browsers that use Google's push service). Chromium source,
#   components/push_messaging/push_messaging_constants.cc: `kPushMessagingGcmEndpoint[] =
#   "https://fcm.googleapis.com/fcm/send/"` and `kPushMessagingWebpushEndpoint[] = "https://fcm.googleapis.com/wp/"`
#   (https://chromium.googlesource.com/chromium/src/+/HEAD/components/push_messaging/push_messaging_constants.cc); the
#   host matches on any path. Chrome's interop post shows the same host
#   (https://developer.chrome.com/blog/web-push-interop-wins).
# * updates.push.services.mozilla.com: Firefox. Mozilla autopush docs: "Production - Websocket:
#   wss://push.services.mozilla.com/ - Endpoint: https://updates.push.services.mozilla.com/"
#   (https://mozilla-services.github.io/autopush-rs/). The websocket host is the browser's own connection, not a target
#   a server sends to, so it is NOT listed.
DEFAULT_EXACT_HOSTS: Final = frozenset({"fcm.googleapis.com", "updates.push.services.mozilla.com"})
# SUBDOMAIN suffixes: any host with at least one more label in front of the suffix matches, the bare suffix does not.
#
# * push.apple.com: Safari and iOS web push. Apple: "If your network infrastructure limits which URLs your server can
#   access, allow access for https://*.push.apple.com"
#   (https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers);
#   the WebKit blog agrees (https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/). Apple's literal
#   `web.push.apple.com` is covered by this documented wildcard.
# * notify.windows.com: Windows Notification Service. Microsoft's WNS overview says the channel URI domain is
#   "notify.windows.com" and "The subdomain of the channel URI is subject to change"
#   (https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/wns-overview).
#   INFERRED, not documented: that Edge uses WNS for web push (the Edge policy page
#   `ForceBuiltInPushMessagingClient` and third-party reports); the real-phone and Edge spike (T15) is the check.
DEFAULT_SUBDOMAIN_SUFFIXES: Final = frozenset({"push.apple.com", "notify.windows.com"})
# NOT on the list, on purpose: `jmt17.google.com` and `fcm.googleapis.com/preprod/` (Chromium staging for non-Stable
# channels); `updates-autopush.stage.mozaws.net` and `.dev.mozaws.net` (Mozilla stage and dev); the legacy
# `android.googleapis.com/gcm/send` (Chrome stopped advertising it at Chrome 74, public GCM endpoints shut down in
# 2019); `push.services.mozilla.com` (the Firefox client's websocket). KNOWN UNVERIFIED: Samsung Internet, Opera, UC and
# Huawei (no vendor document names a host; they are expected to use FCM), Edge on Android and macOS. A host missing
# here is a loud 422 at subscribe time (ADR 0067), and the operator override covers a pilot's own push service.

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


class EndpointHostNotAllowedError(ValueError):
    """The endpoint's host is not on the allow-list (ADR 0067). The message is fixed: it names neither the endpoint nor
    the host, so it can be logged and answered as it is."""

    def __init__(self) -> None:
        super().__init__("endpoint host is not on the allow-list")


def _matches(name: str, domain: str) -> bool:
    """``name`` is ``domain`` or ends with ``.domain``: the match is on a DNS label boundary."""
    return name == domain or name.endswith("." + domain)


def host_is_allowed(host: str, extra_suffixes: Iterable[str] = ()) -> bool:
    """Whether ``host`` belongs to a push service: the built-in list, or an ``extra_suffixes`` entry.

    The comparison is on DNS labels: the host is lowercased and ONE trailing dot (a rooted name) is dropped; an exact
    entry matches only that host, a subdomain suffix needs at least one more label (``a.push.apple.com``, not
    ``push.apple.com``, not ``evilpush.apple.com``, not ``push.apple.com.evil.example``). An ``extra_suffixes`` entry
    (the operator's override, validated by ``RuntimeConfig``) matches that domain AND its subdomains, on label
    boundaries too, so a pilot can name one push host or a whole domain. A host with a non-ASCII character, an empty
    label or no label never matches (punycode spellings are ASCII and are compared as the labels they are).
    """
    if not host.isascii():  # BEFORE lowercasing: ``str.lower`` maps U+212A KELVIN SIGN to an ASCII "k"
        return False
    name = host.lower().removesuffix(".")
    if not name or "" in name.split("."):
        return False
    if name in DEFAULT_EXACT_HOSTS:
        return True
    if any(name.endswith("." + suffix) for suffix in DEFAULT_SUBDOMAIN_SUFFIXES):
        return True
    return any(_matches(name, extra.lower()) for extra in extra_suffixes if extra)


def check_endpoint_host(value: str, extra_suffixes: Iterable[str] = ()) -> str:
    """The endpoint, when its host is on the allow-list (``host_is_allowed``).

    The host is read the way a URL parser reads it, and anything a parser could read differently from an HTTP client
    is refused outright: credentials, a backslash anywhere in the URL, an ``@`` in the authority, and a non-ASCII
    authority (``str.lower`` maps some non-ASCII characters, such as U+212A KELVIN SIGN, to ASCII letters, so the
    parsed host would differ from the host that is resolved).

    Raises:
        EndpointHostNotAllowedError: Any of the above, or a host that is not on the list. The message names neither the
            endpoint nor the host.
    """
    try:
        parts = urlsplit(value)
        host = parts.hostname
    except ValueError:
        raise EndpointHostNotAllowedError from None
    if (
        host is None
        or parts.username is not None
        or parts.password is not None
        or "@" in parts.netloc
        or "\\" in value
        or not parts.netloc.isascii()
        or not host_is_allowed(host, extra_suffixes)
    ):
        raise EndpointHostNotAllowedError
    return value


def check_send_endpoint(value: str, extra_suffixes: Iterable[str] = ()) -> str:
    """``check_endpoint`` then ``check_endpoint_host``: what the channel runs for every send, and what the route runs
    (the syntactic part as a field validator, the host part with the active config's ``extra_suffixes``).

    Raises:
        ValueError: The syntactic check refused it (``EndpointHostNotAllowedError`` is a subclass: the host is not on
            the list).
    """
    check_endpoint(value)
    return check_endpoint_host(value, extra_suffixes)
