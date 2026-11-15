"""The Web Push channel over pywebpush 2.5.0 (ADR 0004, ADR 0058 decision 2, F1 ``web-push.md`` sections 2-3).

One message goes to one subscription: the payload is exactly the six keys ``v, audience, target_id, level,
template_id, valid_from`` as compact JSON (no text, no personal level, no worker identifier), encrypted ``aes128gcm``,
sent with ``TTL: 3600`` and ``Urgency: high`` under a VAPID ``mailto:`` subject. The facts the library imposes (checked
against the installed 2.5.0 source and by ``test_the_real_library_accepts_these_parameters_...``):

* ``webpush_async`` always gets an explicit ``timeout`` (its own default is no timeout: one dead push service would
  stall the dispatch) and a FRESH ``vapid_claims`` dict per call (it writes ``aud`` and ``exp`` into the dict);
* a status above 202 raises ``WebPushException`` with ``status_code``: 404 and 410 mean the subscription is gone (it is
  deleted and the result says ``gone:<status>``); 429 and 5xx are ``http:<status>`` and keep it (``Retry-After`` is
  logged only). NOTHING retries a failed delivery: the event row is stored (and deduplicated) after its sends, so a
  push that failed is never sent again. For a stop that means AT MOST ONCE per recipient per event: a failed stop push
  is visible only in the event row's ``failed`` count and the ``alerts.dispatched`` audit row. Anything else is
  ``error:<ExceptionClass>``;
* ``str(exception)`` quotes the response body and the endpoint: it is never logged or returned. Logs carry the
  subscription id and class names only.

One ``aiohttp.ClientSession`` serves every send of the channel (closed by ``aclose``). Endpoints are public input, so
the session is hardened against server-side request forgery, and the host of every endpoint must be on the allow-list
of push services (ADR 0067), which is what keeps a hostile or hanging host out of the send lanes in the first place:

* a REDIRECT is never followed: a ``TraceConfig`` raises ``RedirectRefusedError`` on the first one (FAILED
  ``redirect``); the response that asked for it is the only request that reaches that server;
* a NAME that resolves to any non-global address (private, loopback, link-local, reserved, multicast, unspecified) or
  to an IPv6 address inside a refused transition network (IPv4-mapped, IPv4-compatible, NAT64, 6to4, Teredo:
  ``_REFUSED_V6_NETWORKS``) is refused by ``PublicOnlyResolver`` before a connection is made (FAILED ``blocked``). An
  IP literal is not resolved by aiohttp: the subscribe route refuses those (``api.push_validation``);
* the endpoint is checked at SEND time (``ports.push_endpoint.check_send_endpoint``, the route's own checks): the
  syntactic check, because aiohttp does not resolve an IP literal, so the resolver alone would let a stored row reach
  ``http://127.0.0.1:...``, and the HOST ALLOW-LIST (ADR 0067: the built-in push services plus the
  ``extra_host_suffixes`` the dispatch passes from the active config), so a row stored from any other host (before the
  list existed, or by a path that is not the API) is FAILED ``blocked`` with no connection and no wait; a test names a
  looser check through ``endpoint_check``;
* the RESPONSE is bounded: pywebpush reads the whole body (``await resp.text()``) and aiohttp inflates a gzip body while
  reading it, so a hostile endpoint could cost gigabytes of memory per send (a 1 MB gzip body inflated to 1 GB in the
  reviewer's probe). The session therefore never decompresses (``auto_decompress=False``) and asks for
  ``Accept-Encoding: identity``, and ``_BoundedSession`` hands the library a response whose ``text()`` stops reading at
  ``MAX_RESPONSE_BYTES`` of wire bytes (FAILED ``response_too_large``; a ``TraceConfig`` cannot do this: aiohttp 3.14
  fires ``on_response_chunk_received`` once, after the whole body is buffered). A body that is not text decodes with
  replacement characters: the status decides the result, never the body. A body over the cap hides the status (a
  410 with a 20 KB body is ``response_too_large``, not ``gone``): no push service answers like that;
* the connector allows ``CONNECTION_LIMIT`` connections (the ordinary lane plus ``SIMULTANEOUS_STOPS_PROVISIONED``
  operator-stop lanes, ``ports.push``; sends beyond it wait for a connection inside their delivery deadline).
"""

import ipaddress
import json
import socket
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC
from types import SimpleNamespace
from typing import Any, Final, cast

import aiohttp
import structlog
from aiohttp.abc import AbstractResolver, ResolveResult
from pywebpush import WebPushException, webpush_async

from stellar_blaze.ports.notifications import DeliveryResult, DeliveryStatus, OutboundMessage
from stellar_blaze.ports.push import CONNECTION_LIMIT, PushSubscriptionStore, SubscriptionRecord
from stellar_blaze.ports.push_endpoint import check_send_endpoint

__all__ = [
    "MAX_RESPONSE_BYTES",
    "TTL_SECONDS",
    "BlockedAddressError",
    "PublicOnlyResolver",
    "RedirectRefusedError",
    "ResponseTooLargeError",
    "WebPushChannel",
    "payload_of",
]

logger = structlog.stdlib.get_logger(__name__)

TTL_SECONDS: Final = 3600  # F1 web-push.md section 3: an alert is dropped rather than delivered an hour late
URGENCY: Final = "high"  # RFC 8030 section 5.3; ADR 0004
CONTENT_ENCODING: Final = "aes128gcm"
# A push service answers 201 with an empty body and an error with a few hundred bytes: wire bytes read per response.
MAX_RESPONSE_BYTES: Final = 16 * 1024
_GONE: Final = frozenset({404, 410})  # RFC 8030 section 7.3 (404 expired); 410 is the browsers' usual answer

type Sender = Callable[..., Awaitable[object]]


def payload_of(message: OutboundMessage) -> dict[str, str | int]:
    """The six-key payload of ``message``. ``valid_from`` is UTC with a ``Z``."""
    crew = message.crew_id
    return {
        "v": 1,
        "audience": message.audience.value,
        "target_id": message.site_id if crew is None else crew,
        "level": message.level.value,
        "template_id": message.template_id,
        "valid_from": message.valid_from.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


class RedirectRefusedError(Exception):
    """The push service answered with a redirect: it is never followed (the target could be an internal address)."""


class BlockedAddressError(Exception):
    """A host name resolved to an address that is not globally routable: no connection is made."""


class ResponseTooLargeError(Exception):
    """The push service's response is bigger than ``MAX_RESPONSE_BYTES`` on the wire: reading stopped, the connection
    is closed. Carries nothing of the body."""


# IPv6 networks that carry an IPv4 address (or are a transition mechanism to one). No push service is reached through
# them, and they can smuggle an internal IPv4 target past a check that only reads the IPv6 flags, so they are refused
# outright (not unwrapped and judged: a resolver answer in one of them is never a legitimate public push service). The
# verdict must not rest on the standard library's tables, which gained and changed rows across 3.12.x and 3.13.x
# (``ipaddress`` once called 64:ff9b::7f00:1 global); ``is_global`` below stays as the second, general check.
_REFUSED_V6_NETWORKS: Final = tuple(
    ipaddress.IPv6Network(prefix)
    for prefix in (
        "::/96",  # IPv4-compatible (deprecated, RFC 4291 2.5.5.1), also the unspecified and loopback addresses
        "::ffff:0:0/96",  # IPv4-mapped (RFC 4291 2.5.5.2)
        "64:ff9b::/96",  # NAT64 well-known prefix (RFC 6052)
        "64:ff9b:1::/48",  # NAT64 local-use prefix (RFC 8215)
        "2002::/16",  # 6to4 (RFC 3056; deprecated by RFC 7526)
        "2001::/32",  # Teredo (RFC 4380)
        # Not routable unicast, though ``ipaddress.is_global`` (3.13.15) still accepts the rows marked (global): refused
        # outright, the verdict does not rest on the standard library's tables. Probed with ``ipaddress`` on 3.13.15.
        "fec0::/10",  # deprecated site-local (RFC 3879) (global)
        "3ffe::/16",  # 6bone test network, returned to IANA in 2006 (RFC 3701) (global)
        "5f00::/16",  # SRv6 SIDs (RFC 9602) (global)
        "100::/64",  # discard-only (RFC 6666)
        "100:0:0:1::/64",  # dummy IPv6 prefix (RFC 9780) (global)
        "2001:2::/48",  # benchmarking (RFC 5180)
        "2001:10::/28",  # deprecated ORCHID (RFC 4843)
        "2001:20::/28",  # ORCHIDv2 (RFC 7343), not globally reachable by registry (global)
        "2001:30::/28",  # Drone Remote ID tags (RFC 9374), not routable (global)
        "2001:db8::/32",  # documentation (RFC 3849)
        "3fff::/20",  # documentation (RFC 9637)
    )
)


def _is_public(address: str) -> bool:
    """Globally routable unicast, and not in a refused IPv6 transition network (``_REFUSED_V6_NETWORKS``): ``is_global``
    alone still accepts multicast (224.0.0.1), so the listed classes are refused explicitly too."""
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and any(ip in network for network in _REFUSED_V6_NETWORKS):
        return False
    return ip.is_global and not (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified
    )


class PublicOnlyResolver(AbstractResolver):
    """Resolves through ``inner`` (default: aiohttp's ``ThreadedResolver``) and refuses the whole answer when ANY
    address is not public (not ``is_global``, or private, loopback, link-local, reserved, multicast, unspecified, or in
    a refused IPv6 transition network): a public name that points inside the network must not turn a push into a
    request to an internal service."""

    def __init__(self, inner: AbstractResolver | None = None) -> None:
        self._inner = inner  # the default is built on first use: ``ThreadedResolver`` needs a running event loop

    def _resolver(self) -> AbstractResolver:
        if self._inner is None:
            self._inner = aiohttp.ThreadedResolver()
        return self._inner

    async def resolve(
        self, host: str, port: int = 0, family: socket.AddressFamily = socket.AF_INET
    ) -> list[ResolveResult]:
        found = await self._resolver().resolve(host, port, family)
        for address in found:
            if not _is_public(address["host"]):
                raise BlockedAddressError(host)
        return found

    async def close(self) -> None:
        if self._inner is not None:
            await self._inner.close()


class _BoundedResponse:
    """The response as pywebpush sees it: ``status``, ``reason`` and ``headers`` of the real one, and a ``text()`` that
    reads at most ``limit`` bytes (cached: the library calls it again for a status above 202)."""

    def __init__(self, response: aiohttp.ClientResponse, limit: int) -> None:
        self._response = response
        self._limit = limit
        self._text: str | None = None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._response, name)

    async def text(self) -> str:
        if self._text is None:
            self._text = (await self._read()).decode("utf-8", errors="replace")
        return self._text

    async def _read(self) -> bytes:
        response = self._response
        declared = response.content_length
        if declared is not None and declared > self._limit:
            response.close()
            raise ResponseTooLargeError
        body = bytearray()
        async for piece in response.content.iter_any():
            body += piece
            if len(body) > self._limit:
                response.close()  # drop the connection: the rest of the flood is never read
                raise ResponseTooLargeError
        return bytes(body)


class _BoundedSession:
    """The only part of ``aiohttp.ClientSession`` pywebpush uses (``post``), with the response bounded."""

    def __init__(self, session: aiohttp.ClientSession, limit: int = MAX_RESPONSE_BYTES) -> None:
        self._session = session
        self._limit = limit

    async def post(self, url: str, **kwargs: Any) -> _BoundedResponse:
        return _BoundedResponse(await self._session.post(url, **kwargs), self._limit)


async def _refuse_redirect(
    session: aiohttp.ClientSession, context: SimpleNamespace, params: aiohttp.TraceRequestRedirectParams
) -> None:
    raise RedirectRefusedError


class WebPushChannel:
    """``PushChannel`` for Web Push. ``sender`` replaces ``webpush_async`` in tests; ``resolver`` replaces the
    public-only resolver (a test names a fake DNS); ``endpoint_check`` replaces the production endpoint check, which is
    ``check_send_endpoint(endpoint, extra_host_suffixes)``: the syntactic check and the host allow-list (a test that
    serves a localhost ``http`` endpoint names a looser one: production never passes it)."""

    name = "webpush"

    def __init__(
        self,
        vapid_private_key: str,
        vapid_subject: str,
        subs: PushSubscriptionStore,
        *,
        timeout_s: float = 10.0,
        sender: Sender | None = None,
        resolver: AbstractResolver | None = None,
        connection_limit: int = CONNECTION_LIMIT,
        endpoint_check: Callable[[str, Sequence[str]], str] = check_send_endpoint,
    ) -> None:
        self._key = vapid_private_key
        self._subject = vapid_subject
        self._subs = subs
        self._timeout_s = timeout_s
        self._sender: Sender = sender or webpush_async
        self._own_session = sender is None
        self._resolver: AbstractResolver = resolver or PublicOnlyResolver()
        self._connection_limit = connection_limit
        self._endpoint_check = endpoint_check
        self._session: aiohttp.ClientSession | None = None

    def __repr__(self) -> str:
        return f"WebPushChannel(subject={self._subject!r})"  # never the key

    @property
    def timeout_s(self) -> float:
        """The timeout every ``webpush_async`` call gets; the dispatch adds a hard deadline of its own on top."""
        return self._timeout_s

    async def send_to(
        self, sub: SubscriptionRecord, message: OutboundMessage, *, extra_host_suffixes: Sequence[str] = ()
    ) -> DeliveryResult:
        try:
            self._endpoint_check(sub.endpoint, extra_host_suffixes)
        except ValueError:  # the message never holds the endpoint; neither does the log line
            logger.warning("webpush.blocked", subscription_id=sub.id, error="EndpointRefused")
            return self._result("blocked")
        arguments: dict[str, Any] = {
            "subscription_info": {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            "data": json.dumps(payload_of(message), separators=(",", ":")),
            "vapid_private_key": self._key,
            "vapid_claims": {"sub": self._subject},  # fresh every call: the library writes aud and exp into it
            "content_encoding": CONTENT_ENCODING,
            "timeout": self._timeout_s,
            "ttl": TTL_SECONDS,
            "headers": {"Urgency": URGENCY},
        }
        if self._own_session:
            arguments["aiohttp_session"] = cast(aiohttp.ClientSession, _BoundedSession(self._session_in_use()))
        try:
            await self._sender(**arguments)
        except WebPushException as error:
            return await self._failed(sub, error)
        except RedirectRefusedError:
            logger.warning("webpush.redirect_refused", subscription_id=sub.id, error="RedirectRefusedError")
            return self._result("redirect")
        except BlockedAddressError:
            logger.warning("webpush.blocked", subscription_id=sub.id, error="BlockedAddressError")
            return self._result("blocked")
        except ResponseTooLargeError:
            logger.warning("webpush.response_too_large", subscription_id=sub.id, error="ResponseTooLargeError")
            return self._result("response_too_large")
        except Exception as error:  # a delivery failure is a result, never an exception (``PushChannel``)
            logger.warning("webpush.failed", subscription_id=sub.id, error=type(error).__name__)
            return self._result(f"error:{type(error).__name__}")
        return DeliveryResult(channel=self.name, status=DeliveryStatus.DELIVERED)

    async def aclose(self) -> None:
        session, self._session = self._session, None
        if session is not None:
            await session.close()
            await self._resolver.close()

    def _result(self, detail: str) -> DeliveryResult:
        return DeliveryResult(channel=self.name, status=DeliveryStatus.FAILED, detail=detail)

    def _session_in_use(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            trace = aiohttp.TraceConfig()
            trace.on_request_redirect.append(_refuse_redirect)
            connector = aiohttp.TCPConnector(limit=self._connection_limit, resolver=self._resolver)
            self._session = aiohttp.ClientSession(
                connector=connector,
                trace_configs=[trace],
                auto_decompress=False,  # a gzip bomb is never inflated; the cap counts wire bytes
                headers={"Accept-Encoding": "identity"},  # replaces aiohttp's gzip, deflate, br default
            )
        return self._session

    async def _failed(self, sub: SubscriptionRecord, error: WebPushException) -> DeliveryResult:
        status = error.status_code
        if status in _GONE:
            await self._subs.delete_gone(sub.id)
            logger.info("webpush.subscription_gone", subscription_id=sub.id, status=status)
            return self._result(f"gone:{status}")
        if status is not None:
            logger.warning("webpush.rejected", subscription_id=sub.id, status=status, retry_after=error.retry_after)
            return self._result(f"http:{status}")
        logger.warning("webpush.failed", subscription_id=sub.id, error=type(error).__name__)
        return self._result(f"error:{type(error).__name__}")
