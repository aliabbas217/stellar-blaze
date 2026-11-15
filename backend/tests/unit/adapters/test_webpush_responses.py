"""``WebPushChannel`` against a HOSTILE push service (final-review finding C1/E1): the endpoint of a stored
subscription is public input, so the response must never cost more memory than a small bound, whatever the server
sends. Every test runs the REAL library and the REAL shared session against a raw ``asyncio`` server on localhost
(nothing else is contacted).

Findings these tests pin (see ``adapters.notifications.webpush``): pywebpush 2.5.0 reads the whole body with
``await resp.text()`` and aiohttp 3.14 inflates a gzip body while it is read, so a small gzip body that inflates to
gigabytes, or a plain body of any size, was buffered completely. ``tracemalloc`` measures the peak of one send."""

import asyncio
import base64
import gzip
import json
import logging
import os
import tracemalloc
import zlib
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable, MutableMapping
from datetime import UTC, datetime
from typing import Any

import pytest
import pytest_asyncio
import structlog
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from stellar_blaze.adapters.fakes.push import InMemoryPushStore
from stellar_blaze.adapters.notifications.webpush import MAX_RESPONSE_BYTES, WebPushChannel
from stellar_blaze.ports.notifications import Audience, DeliveryResult, DeliveryStatus, OutboundMessage
from stellar_blaze.ports.push import NewSubscription, SubscriptionRecord

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]

SUBJECT = "mailto:ops@example.org"
PEAK_BOUND = 4_000_000  # bytes: one send of the real library, encryption and signing included, is far below this
CANARY = b"LEAK-CANARY-"  # every hostile body carries it: it must never reach a log line, a result or a detail
type Reply = Callable[[asyncio.StreamWriter], Awaitable[None]]


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def keys() -> tuple[str, str, str]:
    public = (
        ec.generate_private_key(ec.SECP256R1())
        .public_key()
        .public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    )
    vapid = ec.generate_private_key(ec.SECP256R1())
    secret = base64.urlsafe_b64encode(vapid.private_numbers().private_value.to_bytes(32, "big")).rstrip(b"=")
    return secret.decode(), b64(public), b64(os.urandom(16))


def gzip_bomb(inflated_mb: int) -> bytes:
    """A valid gzip stream of ``inflated_mb`` MB of zeros (about 1 KB per MB)."""
    compressor = zlib.compressobj(9, zlib.DEFLATED, 31)
    megabyte = b"\0" * (1 << 20)
    parts = [compressor.compress(megabyte) for _ in range(inflated_mb)]
    parts.append(compressor.flush())
    return b"".join(parts)


async def reply(
    writer: asyncio.StreamWriter,
    status: int,
    pieces: Iterable[bytes],
    *,
    headers: dict[str, str] | None = None,
    length: int | None = None,
) -> None:
    """One response, written piece by piece with ``drain`` (so this process never buffers the whole flood itself):
    chunked transfer when ``length`` is ``None``, else a ``Content-Length`` header."""
    head = f"HTTP/1.1 {status} X\r\n" + "".join(f"{k}: {v}\r\n" for k, v in (headers or {}).items())
    head += "Transfer-Encoding: chunked\r\n" if length is None else f"Content-Length: {length}\r\n"
    writer.write(head.encode() + b"Connection: close\r\n\r\n")
    try:
        for piece in pieces:
            writer.write(piece if length is not None else f"{len(piece):x}\r\n".encode() + piece + b"\r\n")
            await writer.drain()
        if length is None:
            writer.write(b"0\r\n\r\n")
        await writer.drain()
    except ConnectionError:  # the client closed on us: that is the point of the cap
        pass
    finally:
        writer.close()


class PushService:
    """A raw localhost HTTP server; ``requests`` holds the header block of every request it received."""

    def __init__(self) -> None:
        self.requests: list[str] = []
        self.port = 0
        self._server: asyncio.Server | None = None
        self.respond: Reply

    async def start(self, respond: Reply) -> None:
        self.respond = respond

        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            self.requests.append((await reader.readuntil(b"\r\n\r\n")).decode("latin-1"))
            await self.respond(writer)

        self._server = await asyncio.start_server(handle, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()


@pytest_asyncio.fixture
async def service() -> AsyncIterator[PushService]:
    server = PushService()
    yield server
    await server.stop()


def message() -> OutboundMessage:
    return OutboundMessage(
        site_id="s1",
        audience=Audience.SITE,
        crew_id=None,
        level="red",  # type: ignore[arg-type]
        valid_from=datetime(2026, 11, 11, 9, 0, tzinfo=UTC),
        template_id="level-change",
    )


async def send(
    service: PushService, *, peak: bool = False
) -> tuple[DeliveryResult, int, InMemoryPushStore, SubscriptionRecord]:
    """One real send to ``service`` through the real channel; returns the result and the ``tracemalloc`` peak."""
    secret, p256dh, auth = keys()
    store = InMemoryPushStore()
    endpoint = f"http://127.0.0.1:{service.port}/push/LEAK-CANARY-ENDPOINT"
    await store.upsert_by_endpoint(NewSubscription(endpoint=endpoint, p256dh=p256dh, auth=auth, site_id="s1"), 1)
    [record] = await store.for_site("s1", 1)
    channel = WebPushChannel(secret, SUBJECT, store, endpoint_check=allow_any_endpoint)
    try:
        tracemalloc.start()
        tracemalloc.reset_peak()
        try:
            result = await asyncio.wait_for(channel.send_to(record, message()), 30)
            _, high = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
    finally:
        await channel.aclose()
    return result, high, store, record


def allow_any_endpoint(endpoint: str) -> str:
    """The explicit TEST allowance (``WebPushChannel(endpoint_check=...)``): the production check refuses a localhost
    ``http`` endpoint, which is the only kind a test server can serve. Production never passes it."""
    return endpoint


def everything(
    caplog: pytest.LogCaptureFixture, captured: list[MutableMapping[str, Any]], result: DeliveryResult
) -> str:
    return caplog.text + json.dumps(captured, default=str) + repr(result)


async def test_a_gzip_bomb_is_never_inflated_and_the_send_fails_as_too_large(
    service: PushService, caplog: pytest.LogCaptureFixture
) -> None:
    bomb = gzip_bomb(50)  # inflates to 50 MB
    assert len(bomb) > MAX_RESPONSE_BYTES  # a body this big is not a push service's answer
    await service.start(
        lambda w: reply(
            w, 201, [bomb[i : i + 8192] for i in range(0, len(bomb), 8192)], headers={"Content-Encoding": "gzip"}
        )
    )

    with caplog.at_level(logging.DEBUG), structlog.testing.capture_logs() as captured:
        result, high, _, record = await send(service)

    assert high < PEAK_BOUND, f"peak {high} bytes"
    assert (result.status, result.detail) == (DeliveryStatus.FAILED, "response_too_large")
    assert [(c["event"], c["subscription_id"], c["error"]) for c in captured] == [
        ("webpush.response_too_large", record.id, "ResponseTooLargeError")
    ]


@pytest.mark.parametrize("chunked", [True, False], ids=["chunked", "content-length"])
async def test_a_plain_flood_is_cut_at_the_cap(
    service: PushService, chunked: bool, caplog: pytest.LogCaptureFixture
) -> None:
    piece = CANARY * 1365 + b"x" * 4  # 16380 bytes
    pieces = 512  # 8 MB in all
    await service.start(
        lambda w: reply(w, 201, (piece for _ in range(pieces)), length=None if chunked else len(piece) * pieces)
    )

    with caplog.at_level(logging.DEBUG), structlog.testing.capture_logs() as captured:
        result, high, _, _ = await send(service)

    assert high < PEAK_BOUND, f"peak {high} bytes"
    assert (result.status, result.detail) == (DeliveryStatus.FAILED, "response_too_large")
    assert CANARY.decode() not in everything(caplog, captured, result)


async def test_a_server_that_ignores_identity_and_sends_gzip_is_not_inflated_and_a_small_body_is_delivered(
    service: PushService,
) -> None:
    small = gzip.compress(b"created")
    await service.start(lambda w: reply(w, 201, [small], headers={"Content-Encoding": "gzip"}, length=len(small)))

    result, high, _, _ = await send(service)

    assert (result.status, result.detail) == (DeliveryStatus.DELIVERED, None)
    assert high < PEAK_BOUND
    request = service.requests[0].lower()
    assert "accept-encoding: identity" in request  # aiohttp's default (gzip, deflate, br...) is replaced


async def test_the_cap_counts_wire_bytes_so_a_small_gzip_body_is_never_inflated(service: PushService) -> None:
    """1 MB of zeros gzips to about 1 KB: under the cap on the wire, far over it if inflated. With decompression on
    the cap would count the inflated bytes (and aiohttp would buffer them): the session must not inflate at all."""
    small_bomb = gzip_bomb(1)
    assert len(small_bomb) < MAX_RESPONSE_BYTES
    await service.start(
        lambda w: reply(w, 201, [small_bomb], headers={"Content-Encoding": "gzip"}, length=len(small_bomb))
    )

    result, high, _, _ = await send(service)

    assert (result.status, result.detail) == (DeliveryStatus.DELIVERED, None)
    assert high < PEAK_BOUND


@pytest.mark.parametrize(
    "body",
    [b"", b"created", bytes(range(256)) * 4, b"\xff\xfe" + b"\x80" * 100],
    ids=["empty", "short", "binary", "bad-utf8"],
)
async def test_a_legitimate_201_is_delivered_whatever_the_small_body(service: PushService, body: bytes) -> None:
    headers = {"Content-Type": "text/plain; charset=utf-8"}
    await service.start(lambda w: reply(w, 201, [body] if body else [], headers=headers, length=len(body)))

    result, _, _, _ = await send(service)

    assert (result.status, result.detail) == (DeliveryStatus.DELIVERED, None)  # the status decides, never the body


async def test_a_410_with_a_body_is_still_gone_and_deletes_the_subscription(service: PushService) -> None:
    body = CANARY + b"expired"
    await service.start(lambda w: reply(w, 410, [body], length=len(body)))

    result, _, store, _ = await send(service)

    assert (result.status, result.detail) == (DeliveryStatus.FAILED, "gone:410")
    assert await store.for_site("s1", 1) == []


async def test_a_503_with_a_body_is_http_503_and_the_body_is_not_in_the_result(service: PushService) -> None:
    body = CANARY + b"overloaded"
    await service.start(lambda w: reply(w, 503, [body], headers={"Retry-After": "30"}, length=len(body)))

    result, _, store, _ = await send(service)

    assert (result.status, result.detail) == (DeliveryStatus.FAILED, "http:503")
    assert len(await store.for_site("s1", 1)) == 1
    assert CANARY.decode() not in repr(result)


# --- E2: the endpoint is checked again at send time ------------------------------------------------------------


async def test_a_stored_localhost_endpoint_is_blocked_at_send_time_and_nothing_connects(
    service: PushService, caplog: pytest.LogCaptureFixture
) -> None:
    """A row stored before the route's check was tightened (or by a path that is not the API) must not reach an
    internal service: aiohttp does not resolve an IP literal, so only this check stands in the way."""
    await service.start(lambda w: reply(w, 201, [], length=0))
    secret, p256dh, auth = keys()
    store = InMemoryPushStore()
    endpoint = f"http://127.0.0.1:{service.port}/internal/LEAK-CANARY-ENDPOINT"
    await store.upsert_by_endpoint(NewSubscription(endpoint=endpoint, p256dh=p256dh, auth=auth, site_id="s1"), 1)
    [record] = await store.for_site("s1", 1)
    channel = WebPushChannel(secret, SUBJECT, store)  # the production default: no allowance
    try:
        with caplog.at_level(logging.DEBUG), structlog.testing.capture_logs() as captured:
            result = await channel.send_to(record, message())
    finally:
        await channel.aclose()

    assert (result.status, result.detail) == (DeliveryStatus.FAILED, "blocked")
    assert service.requests == []  # no connection was made
    assert [(c["event"], c["subscription_id"], c["error"]) for c in captured] == [
        ("webpush.blocked", record.id, "EndpointRefused")
    ]
    assert "LEAK-CANARY" not in everything(caplog, captured, result)
    assert len(await store.for_site("s1", 1)) == 1  # a refused endpoint keeps the row (an operator decides)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://push.example/send",
        "https://127.0.0.1/send",
        "https://[::1]/send",
        "https://169.254.169.254/latest/meta-data",
        "https://2130706433/send",
        "https://localhost/send",
        "https://intranet/send",
        "https://db.internal/send",
        "https://user:pw@push.example/send",
        "https://push.example:8443/send",
    ],
)
async def test_every_endpoint_the_route_refuses_is_refused_at_send_time(endpoint: str) -> None:
    calls: list[object] = []

    async def sender(**kwargs: object) -> object:
        calls.append(kwargs)
        return None

    store = InMemoryPushStore()
    await store.upsert_by_endpoint(NewSubscription(endpoint=endpoint, p256dh="p", auth="a", site_id="s1"), 1)
    [record] = await store.for_site("s1", 1)

    result = await WebPushChannel("key", SUBJECT, store, sender=sender).send_to(record, message())

    assert (result.status, result.detail) == (DeliveryStatus.FAILED, "blocked")
    assert calls == []


async def test_the_route_and_the_channel_share_one_endpoint_check() -> None:
    from stellar_blaze.api import push_validation
    from stellar_blaze.ports import push_endpoint

    assert push_validation.check_endpoint is push_endpoint.check_endpoint
