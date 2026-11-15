"""``WebPushChannel`` (pywebpush 2.5.0): the six-key payload, TTL and urgency, the gone and retryable statuses, and that
the endpoint and keys never reach a log line or a result. The library call is captured by a fake ``sender``; one test
runs the REAL library against a local push service to prove the parameter names and the 404/410 behavior."""

import base64
import ipaddress
import json
import logging
import socket
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import aiohttp
import pytest
import structlog
from aiohttp import web
from aiohttp.abc import AbstractResolver, ResolveResult
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException

from stellar_blaze.adapters.fakes.push import InMemoryPushStore
from stellar_blaze.adapters.notifications.webpush import (
    BlockedAddressError,
    PublicOnlyResolver,
    WebPushChannel,
    payload_of,
)
from stellar_blaze.ports.notifications import Audience, DeliveryStatus, OutboundMessage
from stellar_blaze.ports.push import CONNECTION_LIMIT, NewSubscription, SubscriptionRecord

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]

ENDPOINT = "https://push.example/send/SECRET-ENDPOINT-TOKEN"
P256DH = "BP-secret-public-key-material"
AUTH = "secret-auth-bytes"
VALID_FROM = datetime(2026, 11, 11, 9, 0, tzinfo=UTC)
SUBJECT = "mailto:ops@example.org"


def allow_any_endpoint(endpoint: str) -> str:
    """The explicit TEST allowance for the send-time endpoint check (``WebPushChannel(endpoint_check=...)``): a test
    server is a localhost ``http`` URL, which the production check refuses. Production never passes it."""
    return endpoint


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def message(audience: Audience = Audience.SITE) -> OutboundMessage:
    crew = "crew-b" if audience is Audience.CREW else None
    return OutboundMessage(
        site_id="site-demo-mussafah",
        audience=audience,
        crew_id=crew,
        level="amber",  # type: ignore[arg-type]
        valid_from=VALID_FROM,
        template_id="level-change",
    )


async def stored() -> tuple[InMemoryPushStore, SubscriptionRecord]:
    store = InMemoryPushStore()
    sub = NewSubscription(endpoint=ENDPOINT, p256dh=P256DH, auth=AUTH, site_id="site-demo-mussafah")
    sub_id = await store.upsert_by_endpoint(sub, 1)
    [record] = await store.for_site("site-demo-mussafah", 1)
    assert record.id == sub_id
    return store, record


class Sender:
    """Stands for ``pywebpush.webpush_async``: records the keyword arguments it is called with."""

    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.error = error

    async def __call__(self, **kwargs: Any) -> object:
        self.calls.append({**kwargs, "vapid_claims": dict(kwargs["vapid_claims"])})
        if self.error is not None:
            raise self.error
        return SimpleNamespace(status=201)


def failure(status: int | None, **headers: str) -> WebPushException:
    response = None if status is None else SimpleNamespace(status=status, headers=headers, text=ENDPOINT)
    return WebPushException(f"Push failed: {status} {ENDPOINT}", response=response)


async def test_payload_has_exactly_six_keys() -> None:
    store, record = await stored()
    sender = Sender()

    result = await WebPushChannel("key", SUBJECT, store, sender=sender).send_to(record, message(Audience.CREW))

    assert result.status is DeliveryStatus.DELIVERED
    [call] = sender.calls
    assert list(json.loads(call["data"])) == ["v", "audience", "target_id", "level", "template_id", "valid_from"]
    assert json.loads(call["data"]) == {
        "v": 1,
        "audience": "crew",
        "target_id": "crew-b",
        "level": "amber",
        "template_id": "level-change",
        "valid_from": "2026-11-11T09:00:00Z",
    }
    assert " " not in call["data"]  # compact JSON


async def test_a_site_message_targets_the_site() -> None:
    assert payload_of(message())["target_id"] == "site-demo-mussafah"
    assert payload_of(message())["audience"] == "site"


async def test_ttl_and_urgency() -> None:
    store, record = await stored()
    sender = Sender()

    await WebPushChannel("key", SUBJECT, store, sender=sender, timeout_s=7.5).send_to(record, message())

    [call] = sender.calls
    assert call["ttl"] == 3600
    assert call["headers"] == {"Urgency": "high"}
    assert call["content_encoding"] == "aes128gcm"
    assert call["timeout"] == 7.5  # always explicit: the library's own default is no timeout at all
    assert call["vapid_private_key"] == "key"
    assert call["vapid_claims"]["sub"] == SUBJECT
    assert call["subscription_info"] == {"endpoint": ENDPOINT, "keys": {"p256dh": P256DH, "auth": AUTH}}


async def test_fresh_vapid_claims_every_call() -> None:
    """The library writes aud and exp into the dict it is given: a shared dict would carry the first call's aud."""
    store, record = await stored()
    seen: list[dict[str, Any]] = []

    async def mutating(**kwargs: Any) -> object:
        seen.append(dict(kwargs["vapid_claims"]))  # what the library is handed, before it writes into it
        kwargs["vapid_claims"]["aud"] = "https://first.example"
        kwargs["vapid_claims"]["exp"] = 1
        return SimpleNamespace(status=201)

    channel = WebPushChannel("key", SUBJECT, store, sender=mutating)
    await channel.send_to(record, message())
    await channel.send_to(record, message())

    assert seen == [{"sub": SUBJECT}, {"sub": SUBJECT}]


@pytest.mark.parametrize("status", [404, 410])
async def test_gone_subscription_deleted_on_404_and_410(status: int) -> None:
    store, record = await stored()

    result = await WebPushChannel("key", SUBJECT, store, sender=Sender(failure(status))).send_to(record, message())

    assert (result.status, result.detail) == (DeliveryStatus.FAILED, f"gone:{status}")
    assert await store.for_site("site-demo-mussafah", 1) == []


@pytest.mark.parametrize("status", [429, 500, 503])
async def test_retryable_statuses_fail_and_keep_the_subscription(status: int) -> None:
    store, record = await stored()

    result = await WebPushChannel(
        "key", SUBJECT, store, sender=Sender(failure(status, **{"Retry-After": "30"}))
    ).send_to(record, message())

    assert (result.status, result.detail) == (DeliveryStatus.FAILED, f"http:{status}")
    assert len(await store.for_site("site-demo-mussafah", 1)) == 1


@pytest.mark.parametrize("error", [failure(None), TimeoutError(ENDPOINT), OSError(ENDPOINT), ValueError(AUTH)])
async def test_other_errors_are_a_failed_result_naming_only_the_class(error: Exception) -> None:
    store, record = await stored()

    result = await WebPushChannel("key", SUBJECT, store, sender=Sender(error)).send_to(record, message())

    assert result.status is DeliveryStatus.FAILED
    assert result.detail == f"error:{type(error).__name__}"
    assert len(await store.for_site("site-demo-mussafah", 1)) == 1


async def test_endpoint_never_logged(caplog: pytest.LogCaptureFixture) -> None:
    store, record = await stored()
    errors = [failure(410), failure(503), failure(None), TimeoutError(ENDPOINT)]
    with caplog.at_level(logging.DEBUG), structlog.testing.capture_logs() as captured:
        for error in errors:
            channel = WebPushChannel("key", SUBJECT, store, sender=Sender(error))
            await channel.send_to(record, message())
        await WebPushChannel("key", SUBJECT, store, sender=Sender()).send_to(record, message())

    everything = caplog.text + json.dumps(captured, default=str) + repr(record)
    for secret in (ENDPOINT, "SECRET-ENDPOINT-TOKEN", P256DH, AUTH):
        assert secret not in everything
    assert any(entry.get("subscription_id") == record.id for entry in captured)


async def test_the_real_library_accepts_these_parameters_and_reports_a_gone_subscription(
    unused_tcp_port: int,
) -> None:
    """``pywebpush.webpush_async`` against a local push service: ttl and Urgency arrive as headers, the body is the
    encrypted aes128gcm record of the six-key payload, and 410 becomes ``gone:410``."""
    import http_ece  # transitive of pywebpush; the test is its only user
    from aiohttp import web
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    browser_key = ec.generate_private_key(ec.SECP256R1())
    public = browser_key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    auth = b"0123456789abcdef"
    vapid = ec.generate_private_key(ec.SECP256R1())
    vapid_secret = base64.urlsafe_b64encode(vapid.private_numbers().private_value.to_bytes(32, "big")).rstrip(b"=")
    received: list[tuple[str, dict[str, str], bytes]] = []

    async def handler(request: web.Request) -> web.Response:
        received.append((request.path, dict(request.headers), await request.read()))
        return web.Response(status=410 if request.path.endswith("/gone") else 201)

    app = web.Application()
    app.router.add_post("/{tail:.*}", handler)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", unused_tcp_port).start()
    try:
        store = InMemoryPushStore()

        for name in ("ok", "gone"):
            await store.upsert_by_endpoint(
                NewSubscription(
                    endpoint=f"http://127.0.0.1:{unused_tcp_port}/push/{name}",
                    p256dh=b64(public),
                    auth=b64(auth),
                    site_id="site-demo-mussafah",
                ),
                1,
            )
        records = {r.endpoint.rsplit("/", 1)[1]: r for r in await store.for_site("site-demo-mussafah", 1)}
        channel = WebPushChannel(vapid_secret.decode(), SUBJECT, store, endpoint_check=allow_any_endpoint)
        try:
            delivered = await channel.send_to(records["ok"], message())
            gone = await channel.send_to(records["gone"], message())
        finally:
            await channel.aclose()
    finally:
        await runner.cleanup()

    assert delivered.status is DeliveryStatus.DELIVERED
    assert (gone.status, gone.detail) == (DeliveryStatus.FAILED, "gone:410")
    assert [r.id for r in await store.for_site("site-demo-mussafah", 1)] == [records["ok"].id]
    _, headers, body = received[0]
    lowered = {k.lower(): v for k, v in headers.items()}
    assert lowered["ttl"] == "3600"
    assert lowered["urgency"] == "high"
    assert lowered["content-encoding"] == "aes128gcm"
    assert lowered["authorization"].startswith("vapid ")
    plain = http_ece.decrypt(body, private_key=browser_key, auth_secret=auth)
    assert json.loads(plain) == payload_of(message())


# --- W4: the shared session refuses redirects and names that resolve to non-public addresses -----------------


class FakeDns(AbstractResolver):
    """A resolver with a fixed answer per name; ``asked`` records the names it was asked."""

    def __init__(self, answers: dict[str, list[str]]) -> None:
        self.answers = answers
        self.asked: list[str] = []

    async def resolve(
        self, host: str, port: int = 0, family: socket.AddressFamily = socket.AF_INET
    ) -> list[ResolveResult]:
        self.asked.append(host)
        return [
            ResolveResult(
                hostname=host, host=address, port=port, family=socket.AF_INET, proto=0, flags=socket.AI_NUMERICHOST
            )
            for address in self.answers[host]
        ]

    async def close(self) -> None:
        return None


@pytest.mark.parametrize(
    "address",
    [
        "10.0.0.1",
        "127.0.0.1",
        "169.254.169.254",
        "192.168.1.5",
        "172.16.0.9",
        "100.64.0.1",
        "0.0.0.0",  # noqa: S104
        "224.0.0.1",
        "240.0.0.1",
        "::1",
        "fe80::1",
        "fc00::1",
        "ff02::1",
        "::ffff:10.0.0.1",
    ],
)
async def test_the_public_only_resolver_refuses_a_non_global_answer(address: str) -> None:
    resolver = PublicOnlyResolver(FakeDns({"push.test": [address]}))

    with pytest.raises(BlockedAddressError):
        await resolver.resolve("push.test", 443)


# IPv6 forms that embed an IPv4 address (fix round 2, finding B). Python 3.13.15 already refuses every one of them
# (``is_reserved`` for ::/8 and so 64:ff9b::/96, ``is_private`` for the rest), but the verdict then rests on the
# stdlib's tables, which changed across 3.12.x/3.13.x; ``_REFUSED_V6_NETWORKS`` states it in the code.
EMBEDDING_FORMS = [
    "::ffff:127.0.0.1",  # IPv4-mapped, loopback
    "::ffff:10.0.0.1",  # IPv4-mapped, private
    "::ffff:93.184.216.34",  # IPv4-mapped, PUBLIC: still refused (no push service is reached through a mapped address)
    "64:ff9b::7f00:1",  # NAT64 well-known prefix, loopback
    "64:ff9b::a00:1",  # NAT64, private
    "64:ff9b::5db8:d822",  # NAT64, public 93.184.216.34
    "64:ff9b:1::7f00:1",  # NAT64 local-use prefix, loopback
    "64:ff9b:1::a00:1",  # NAT64 local-use, private
    "2002:7f00:1::1",  # 6to4, loopback
    "2002:0a00:0001::1",  # 6to4, private
    "2002:5db8:d822::1",  # 6to4, public 93.184.216.34
    "2001:0:4136:e378:8000:63bf:80ff:fffe",  # Teredo, obfuscated client 127.0.0.1
    "2001:0:4136:e378:8000:63bf:f5ff:fffe",  # Teredo, obfuscated client 10.0.0.1
    "::127.0.0.1",  # deprecated IPv4-compatible, loopback
    "::10.0.0.1",  # deprecated IPv4-compatible, private
]
PUBLIC_ADDRESSES = ["93.184.216.34", "8.8.8.8", "2606:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001::200e"]


@pytest.mark.parametrize("address", EMBEDDING_FORMS)
async def test_the_public_only_resolver_refuses_an_ipv6_address_that_embeds_an_ipv4(address: str) -> None:
    resolver = PublicOnlyResolver(FakeDns({"push.test": [address]}))
    with pytest.raises(BlockedAddressError):
        await resolver.resolve("push.test", 443)

    mixed = PublicOnlyResolver(FakeDns({"push.test": ["2606:4700::1111", address]}))
    with pytest.raises(BlockedAddressError):  # ONE refused address blocks the whole name
        await mixed.resolve("push.test", 443)


@pytest.mark.parametrize("address", PUBLIC_ADDRESSES)
async def test_the_public_only_resolver_passes_public_ipv4_and_ipv6(address: str) -> None:
    resolver = PublicOnlyResolver(FakeDns({"push.test": [address]}))

    assert [a["host"] for a in await resolver.resolve("push.test", 443)] == [address]


def _constant(value: bool) -> property:
    return property(lambda _self: value)


@pytest.mark.parametrize("address", EMBEDDING_FORMS)
async def test_the_refused_prefixes_do_not_depend_on_the_standard_librarys_tables(
    address: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Simulate a Python whose tables call every address global (the NAT64 and 6to4 rows were added to ``ipaddress``
    in 3.12.4/3.13: an older patch release judged ``64:ff9b::7f00:1`` global): the explicit list still refuses."""
    for attribute, value in (
        ("is_global", True),
        ("is_private", False),
        ("is_reserved", False),
        ("is_loopback", False),
        ("is_link_local", False),
        ("is_multicast", False),
        ("is_unspecified", False),
    ):
        monkeypatch.setattr(ipaddress.IPv6Address, attribute, _constant(value))
    resolver = PublicOnlyResolver(FakeDns({"push.test": [address]}))
    with pytest.raises(BlockedAddressError):
        await resolver.resolve("push.test", 443)

    ok = PublicOnlyResolver(FakeDns({"push.test": ["2606:4700::1111"]}))
    assert [a["host"] for a in await ok.resolve("push.test", 443)] == ["2606:4700::1111"]


# Final review E3: IPv6 prefixes that are not routable unicast, found by probing ``ipaddress`` on 3.13.15. The rows
# marked "global" are the ones ``is_global`` still ACCEPTS (so the explicit list is what refuses them); the rest the
# standard library refuses today, listed so that the verdict does not depend on its tables.
NON_ROUTABLE_V6 = [
    "fec0::1",  # deprecated site-local fec0::/10 (global)
    "feff:ffff::1",  # the top of fec0::/10 (global)
    "3ffe::1",  # 6bone 3ffe::/16 (global)
    "5f00::1",  # SRv6 5f00::/16 (global)
    "100::1",  # discard-only 100::/64
    "100:0:0:1::1",  # dummy prefix 100:0:0:1::/64 (global)
    "2001:2::1",  # benchmarking 2001:2::/48
    "2001:10::1",  # deprecated ORCHID 2001:10::/28
    "2001:20::1",  # ORCHIDv2 2001:20::/28 (global)
    "2001:2f:ffff::1",  # the top of 2001:20::/28 (global)
    "2001:30::1",  # drone remote ID 2001:30::/28 (global)
    "2001:db8::1",  # documentation 2001:db8::/32
    "3fff::1",  # documentation 3fff::/20
    "3fff:fff:ffff::1",  # the top of 3fff::/20
]


@pytest.mark.parametrize("address", NON_ROUTABLE_V6)
async def test_the_public_only_resolver_refuses_a_non_routable_ipv6_prefix(address: str) -> None:
    resolver = PublicOnlyResolver(FakeDns({"push.test": [address]}))
    with pytest.raises(BlockedAddressError):
        await resolver.resolve("push.test", 443)

    mixed = PublicOnlyResolver(FakeDns({"push.test": ["2606:4700::1111", address]}))
    with pytest.raises(BlockedAddressError):
        await mixed.resolve("push.test", 443)


@pytest.mark.parametrize("address", NON_ROUTABLE_V6)
async def test_the_non_routable_ipv6_prefixes_do_not_depend_on_the_standard_librarys_tables(
    address: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    for attribute, value in (
        ("is_global", True),
        ("is_private", False),
        ("is_reserved", False),
        ("is_loopback", False),
        ("is_link_local", False),
        ("is_multicast", False),
        ("is_unspecified", False),
    ):
        monkeypatch.setattr(ipaddress.IPv6Address, attribute, _constant(value))
    with pytest.raises(BlockedAddressError):
        await PublicOnlyResolver(FakeDns({"push.test": [address]})).resolve("push.test", 443)


@pytest.mark.parametrize("address", EMBEDDING_FORMS)
async def test_a_name_that_resolves_to_an_embedding_address_is_blocked_before_any_connection(address: str) -> None:
    """The send itself: FAILED ``blocked``, and the fake DNS was asked exactly once (nothing else was attempted)."""
    secret, p256dh, auth = _real_keys()
    store = InMemoryPushStore()
    dns = FakeDns({"push.example.test": [address]})
    record = await _record_for(store, "https://push.example.test/send", p256dh, auth)
    channel = WebPushChannel(secret, SUBJECT, store, resolver=PublicOnlyResolver(dns))
    try:
        result = await channel.send_to(record, message())
    finally:
        await channel.aclose()

    assert (result.status, result.detail) == (DeliveryStatus.FAILED, "blocked")
    assert dns.asked == ["push.example.test"]


async def test_the_public_only_resolver_refuses_when_any_address_is_non_global_and_passes_public_ones() -> None:
    mixed = PublicOnlyResolver(FakeDns({"push.test": ["93.184.216.34", "10.0.0.1"]}))
    public = PublicOnlyResolver(FakeDns({"push.test": ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]}))

    with pytest.raises(BlockedAddressError):
        await mixed.resolve("push.test", 443)
    assert [a["host"] for a in await public.resolve("push.test", 443)] == [
        "93.184.216.34",
        "2606:2800:220:1:248:1893:25c8:1946",
    ]


async def _local_service(port: int, hits: list[str], redirect_to: str | None = None) -> web.AppRunner:
    async def handler(request: web.Request) -> web.Response:
        hits.append(request.path)
        if request.path == "/redirect" and redirect_to is not None:
            return web.Response(status=307, headers={"Location": redirect_to})
        return web.Response(status=201)

    app = web.Application()
    app.router.add_post("/{tail:.*}", handler)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    return runner


def _real_keys() -> tuple[str, str, str]:
    public = (
        ec.generate_private_key(ec.SECP256R1())
        .public_key()
        .public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    )
    vapid = ec.generate_private_key(ec.SECP256R1())
    secret = base64.urlsafe_b64encode(vapid.private_numbers().private_value.to_bytes(32, "big")).rstrip(b"=")
    return secret.decode(), b64(public), b64(b"0123456789abcdef")


async def _record_for(store: InMemoryPushStore, endpoint: str, p256dh: str, auth: str) -> SubscriptionRecord:
    await store.upsert_by_endpoint(NewSubscription(endpoint=endpoint, p256dh=p256dh, auth=auth, site_id="s1"), 1)
    [record] = await store.for_site("s1", 1)
    return record


async def test_a_redirect_is_refused_and_the_target_never_receives_a_request(
    unused_tcp_port: int, caplog: pytest.LogCaptureFixture
) -> None:
    hits: list[str] = []
    runner = await _local_service(unused_tcp_port, hits, redirect_to=f"http://127.0.0.1:{unused_tcp_port}/internal")
    try:
        secret, p256dh, auth = _real_keys()
        store = InMemoryPushStore()
        record = await _record_for(store, f"http://127.0.0.1:{unused_tcp_port}/redirect", p256dh, auth)
        channel = WebPushChannel(secret, SUBJECT, store, endpoint_check=allow_any_endpoint)
        try:
            with caplog.at_level(logging.DEBUG), structlog.testing.capture_logs() as captured:
                result = await channel.send_to(record, message())
        finally:
            await channel.aclose()
    finally:
        await runner.cleanup()

    assert (result.status, result.detail) == (DeliveryStatus.FAILED, "redirect")
    assert hits == ["/redirect"]  # the target of the redirect ("/internal") was never requested
    assert [(c["event"], c["subscription_id"], c["error"]) for c in captured] == [
        ("webpush.redirect_refused", record.id, "RedirectRefusedError")
    ]
    assert "/internal" not in caplog.text + json.dumps(captured, default=str)
    assert len(await store.for_site("s1", 1)) == 1  # a refused redirect keeps the subscription


async def test_a_name_that_resolves_to_a_private_address_is_blocked_before_connecting(unused_tcp_port: int) -> None:
    hits: list[str] = []
    runner = await _local_service(unused_tcp_port, hits)  # a live listener: nothing may reach it
    try:
        secret, p256dh, auth = _real_keys()
        store = InMemoryPushStore()
        dns = FakeDns({"push.example.test": ["10.0.0.1"]})
        record = await _record_for(store, f"http://push.example.test:{unused_tcp_port}/send", p256dh, auth)
        channel = WebPushChannel(
            secret, SUBJECT, store, resolver=PublicOnlyResolver(dns), endpoint_check=allow_any_endpoint
        )
        try:
            result = await channel.send_to(record, message())
        finally:
            await channel.aclose()
    finally:
        await runner.cleanup()

    assert (result.status, result.detail) == (DeliveryStatus.FAILED, "blocked")
    assert dns.asked == ["push.example.test"]
    assert hits == []


async def test_the_default_resolver_is_public_only_and_the_connector_fits_the_ordinary_and_four_stop_lanes() -> None:
    store = InMemoryPushStore()
    channel = WebPushChannel("key", SUBJECT, store)
    try:
        session = channel._session_in_use()  # noqa: SLF001
        connector = session.connector
        assert isinstance(connector, aiohttp.TCPConnector)
        assert connector.limit == CONNECTION_LIMIT == 816
        assert isinstance(connector._resolver, PublicOnlyResolver)  # noqa: SLF001
    finally:
        await channel.aclose()
