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
the session is hardened against server-side request forgery (the host allow-list stays parked):

* a REDIRECT is never followed: a ``TraceConfig`` raises ``RedirectRefusedError`` on the first one (FAILED
  ``redirect``); the response that asked for it is the only request that reaches that server;
* a NAME that resolves to any non-global address (private, loopback, link-local, reserved, multicast, unspecified) is
  refused by ``PublicOnlyResolver`` before a connection is made (FAILED ``blocked``). An IP literal is not resolved by
  aiohttp: the subscribe route refuses those (``api.push_validation``);
* the connector allows ``CONNECTION_LIMIT`` connections (the sum of the dispatch's two send lanes).
"""

import ipaddress
import json
import socket
from collections.abc import Awaitable, Callable
from datetime import UTC
from types import SimpleNamespace
from typing import Any, Final

import aiohttp
import structlog
from aiohttp.abc import AbstractResolver, ResolveResult
from pywebpush import WebPushException, webpush_async

from stellar_blaze.ports.notifications import DeliveryResult, DeliveryStatus, OutboundMessage
from stellar_blaze.ports.push import CONNECTION_LIMIT, PushSubscriptionStore, SubscriptionRecord

__all__ = [
    "TTL_SECONDS",
    "BlockedAddressError",
    "PublicOnlyResolver",
    "RedirectRefusedError",
    "WebPushChannel",
    "payload_of",
]

logger = structlog.stdlib.get_logger(__name__)

TTL_SECONDS: Final = 3600  # F1 web-push.md section 3: an alert is dropped rather than delivered an hour late
URGENCY: Final = "high"  # RFC 8030 section 5.3; ADR 0004
CONTENT_ENCODING: Final = "aes128gcm"
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


def _is_public(address: str) -> bool:
    """Globally routable and unicast: ``is_global`` alone still accepts multicast (224.0.0.1), so the listed classes are
    refused explicitly too. An IPv4-mapped IPv6 address (``::ffff:10.0.0.1``) is judged as the IPv4 it carries."""
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified
    )


class PublicOnlyResolver(AbstractResolver):
    """Resolves through ``inner`` (default: aiohttp's ``ThreadedResolver``) and refuses the whole answer when ANY
    address is not public (not ``is_global``, or private, loopback, link-local, reserved, multicast, unspecified): a
    public name that points inside the network must not turn a push into a request to an internal service."""

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


async def _refuse_redirect(
    session: aiohttp.ClientSession, context: SimpleNamespace, params: aiohttp.TraceRequestRedirectParams
) -> None:
    raise RedirectRefusedError


class WebPushChannel:
    """``PushChannel`` for Web Push. ``sender`` replaces ``webpush_async`` in tests; ``resolver`` replaces the
    public-only resolver (a test names a fake DNS)."""

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
    ) -> None:
        self._key = vapid_private_key
        self._subject = vapid_subject
        self._subs = subs
        self._timeout_s = timeout_s
        self._sender: Sender = sender or webpush_async
        self._own_session = sender is None
        self._resolver: AbstractResolver = resolver or PublicOnlyResolver()
        self._connection_limit = connection_limit
        self._session: aiohttp.ClientSession | None = None

    def __repr__(self) -> str:
        return f"WebPushChannel(subject={self._subject!r})"  # never the key

    @property
    def timeout_s(self) -> float:
        """The timeout every ``webpush_async`` call gets; the dispatch adds a hard deadline of its own on top."""
        return self._timeout_s

    async def send_to(self, sub: SubscriptionRecord, message: OutboundMessage) -> DeliveryResult:
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
            arguments["aiohttp_session"] = self._session_in_use()
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
            self._session = aiohttp.ClientSession(connector=connector, trace_configs=[trace])
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
