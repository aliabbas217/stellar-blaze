"""The Web Push channel over pywebpush 2.5.0 (ADR 0004, ADR 0058 decision 2, F1 ``web-push.md`` sections 2-3).

One message goes to one subscription: the payload is exactly the six keys ``v, audience, target_id, level,
template_id, valid_from`` as compact JSON (no text, no personal level, no worker identifier), encrypted ``aes128gcm``,
sent with ``TTL: 3600`` and ``Urgency: high`` under a VAPID ``mailto:`` subject. The facts the library imposes (checked
against the installed 2.5.0 source and by ``test_the_real_library_accepts_these_parameters_...``):

* ``webpush_async`` always gets an explicit ``timeout`` (its own default is no timeout: one dead push service would
  stall the dispatch) and a FRESH ``vapid_claims`` dict per call (it writes ``aud`` and ``exp`` into the dict);
* a status above 202 raises ``WebPushException`` with ``status_code``: 404 and 410 mean the subscription is gone (it is
  deleted and the result says ``gone:<status>``); 429 and 5xx are ``http:<status>`` and keep it (``Retry-After`` is
  logged only: the next dispatch run is the retry); anything else is ``error:<ExceptionClass>``;
* ``str(exception)`` quotes the response body and the endpoint: it is never logged or returned. Logs carry the
  subscription id and class names only.

One ``aiohttp.ClientSession`` serves every send of the channel (closed by ``aclose``).
"""

import json
from collections.abc import Awaitable, Callable
from datetime import UTC
from typing import Any, Final

import aiohttp
import structlog
from pywebpush import WebPushException, webpush_async

from stellar_blaze.ports.notifications import DeliveryResult, DeliveryStatus, OutboundMessage
from stellar_blaze.ports.push import PushSubscriptionStore, SubscriptionRecord

__all__ = ["TTL_SECONDS", "WebPushChannel", "payload_of"]

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


class WebPushChannel:
    """``PushChannel`` for Web Push. ``sender`` replaces ``webpush_async`` in tests."""

    name = "webpush"

    def __init__(
        self,
        vapid_private_key: str,
        vapid_subject: str,
        subs: PushSubscriptionStore,
        *,
        timeout_s: float = 10.0,
        sender: Sender | None = None,
    ) -> None:
        self._key = vapid_private_key
        self._subject = vapid_subject
        self._subs = subs
        self._timeout_s = timeout_s
        self._sender: Sender = sender or webpush_async
        self._own_session = sender is None
        self._session: aiohttp.ClientSession | None = None

    def __repr__(self) -> str:
        return f"WebPushChannel(subject={self._subject!r})"  # never the key

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
        except Exception as error:  # a delivery failure is a result, never an exception (``PushChannel``)
            logger.warning("webpush.failed", subscription_id=sub.id, error=type(error).__name__)
            return self._result(f"error:{type(error).__name__}")
        return DeliveryResult(channel=self.name, status=DeliveryStatus.DELIVERED)

    async def aclose(self) -> None:
        session, self._session = self._session, None
        if session is not None:
            await session.close()

    def _result(self, detail: str) -> DeliveryResult:
        return DeliveryResult(channel=self.name, status=DeliveryStatus.FAILED, detail=detail)

    def _session_in_use(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
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
