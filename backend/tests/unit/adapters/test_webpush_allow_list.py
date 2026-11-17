"""ADR 0067 at SEND time: ``WebPushChannel.send_to`` re-checks the endpoint host against the allow-list.

A row stored earlier (before the list existed, or by a path that is not the API) on a host that is not on the list is
refused FAILED ``blocked`` before anything is attempted: no connection, no wait for the push service (the hanging
sender below is never started). The operator's extra suffixes (``push_extra_host_suffixes`` of the active config) reach
the channel per send; the log names the subscription id and a class name only, never the endpoint.
"""

import asyncio
import json
import logging
import time
from collections.abc import Sequence
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest
import structlog

from stellar_blaze.adapters.fakes.push import InMemoryPushStore
from stellar_blaze.adapters.notifications.webpush import WebPushChannel
from stellar_blaze.ports.notifications import Audience, DeliveryResult, DeliveryStatus, OutboundMessage
from stellar_blaze.ports.push import NewSubscription, SubscriptionRecord

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]

SUBJECT = "mailto:ops@example.org"
DEFAULT_ENDPOINTS = [
    "https://fcm.googleapis.com/fcm/send/LEAK-CANARY-TOKEN",
    "https://fcm.googleapis.com/wp/LEAK-CANARY-TOKEN",
    "https://updates.push.services.mozilla.com/wpush/v1/LEAK-CANARY-TOKEN",
    "https://web.push.apple.com/LEAK-CANARY-TOKEN",
    "https://wns2-par02p.notify.windows.com/w/?token=LEAK-CANARY-TOKEN",
]


def message() -> OutboundMessage:
    return OutboundMessage(
        site_id="s1",
        audience=Audience.SITE,
        crew_id=None,
        level="red",  # type: ignore[arg-type]
        valid_from=datetime(2026, 11, 11, 9, 0, tzinfo=UTC),
        template_id="level-change",
    )


class Sender:
    """Stands for ``webpush_async``; ``hang`` makes every call wait for ever (a push service that never answers)."""

    def __init__(self, *, hang: bool = False) -> None:
        self.calls: list[dict[str, Any]] = []
        self.hang = hang

    async def __call__(self, **kwargs: Any) -> object:
        self.calls.append(kwargs)
        if self.hang:
            await asyncio.Event().wait()
        return SimpleNamespace(status=201)


async def record_for(endpoint: str) -> tuple[InMemoryPushStore, SubscriptionRecord]:
    store = InMemoryPushStore()
    await store.upsert_by_endpoint(NewSubscription(endpoint=endpoint, p256dh="p", auth="a", site_id="s1"), 1)
    [record] = await store.for_site("s1", 1)
    return store, record


@pytest.mark.parametrize("endpoint", DEFAULT_ENDPOINTS)
async def test_an_endpoint_of_every_default_service_is_sent(endpoint: str) -> None:
    store, record = await record_for(endpoint)
    sender = Sender()

    result = await WebPushChannel("key", SUBJECT, store, sender=sender).send_to(record, message())

    assert result.status is DeliveryStatus.DELIVERED
    assert len(sender.calls) == 1


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://push.example/send/LEAK-CANARY-TOKEN",
        "https://x.fcm.googleapis.com/fcm/send/LEAK-CANARY-TOKEN",
        "https://push.apple.com/LEAK-CANARY-TOKEN",
        "https://evilnotify.windows.com/LEAK-CANARY-TOKEN",
        "https://updates.push.services.mozilla.com.evil.example/LEAK-CANARY-TOKEN",
        "https://updates-autopush.stage.mozaws.net/wpush/v1/LEAK-CANARY-TOKEN",
    ],
)
async def test_a_stored_row_off_the_list_is_blocked_without_starting_the_send(
    endpoint: str, caplog: pytest.LogCaptureFixture
) -> None:
    store, record = await record_for(endpoint)
    sender = Sender(hang=True)  # would hang for ever if it were reached
    started = time.monotonic()

    with caplog.at_level(logging.DEBUG), structlog.testing.capture_logs() as captured:
        result = await asyncio.wait_for(
            WebPushChannel("key", SUBJECT, store, sender=sender).send_to(record, message()), timeout=5
        )

    assert time.monotonic() - started < 2
    assert (result.status, result.detail) == (DeliveryStatus.FAILED, "blocked")
    assert sender.calls == []  # no connection, no encryption, nothing started
    assert [(c["event"], c["subscription_id"], c["error"]) for c in captured] == [
        ("webpush.blocked", record.id, "EndpointRefused")
    ]
    everything = caplog.text + json.dumps(captured, default=str) + repr(result)
    assert "LEAK-CANARY" not in everything
    assert len(await store.for_site("s1", 1)) == 1  # a refused host keeps the row: an operator decides


async def test_the_operators_extra_suffixes_reach_the_check_per_send() -> None:
    store, record = await record_for("https://ntfy.example.org/up/LEAK-CANARY-TOKEN")
    sender = Sender()
    channel = WebPushChannel("key", SUBJECT, store, sender=sender)

    refused = await channel.send_to(record, message())
    wrong = await channel.send_to(record, message(), extra_host_suffixes=("other.example.org",))
    allowed = await channel.send_to(record, message(), extra_host_suffixes=("ntfy.example.org",))

    assert (refused.detail, wrong.detail) == ("blocked", "blocked")
    assert allowed.status is DeliveryStatus.DELIVERED
    assert len(sender.calls) == 1  # only the allowed send started


async def test_an_extra_suffix_never_loosens_the_syntactic_check_or_a_default_rule() -> None:
    sender = Sender()
    for endpoint in (
        "http://ntfy.example.org/up/x",  # not https
        "https://ntfy.example.org:8443/up/x",  # not 443
        "https://user:pw@ntfy.example.org/up/x",
        "https://127.0.0.1/up/x",
        "https://push.apple.com/x",  # the bare default suffix stays refused whatever the extras say
    ):
        store, record = await record_for(endpoint)
        result = await WebPushChannel("key", SUBJECT, store, sender=sender).send_to(
            record, message(), extra_host_suffixes=("ntfy.example.org", "127.0.0.1", "push.example")
        )

        assert (result.status, result.detail) == (DeliveryStatus.FAILED, "blocked"), endpoint
    assert sender.calls == []


async def test_the_injected_endpoint_check_is_the_explicit_test_allowance_and_takes_the_extras() -> None:
    seen: list[tuple[str, tuple[str, ...]]] = []

    def check(endpoint: str, extra: Sequence[str]) -> str:
        seen.append((endpoint, tuple(extra)))
        return endpoint

    store, record = await record_for("http://127.0.0.1:9/local")
    sender = Sender()
    channel = WebPushChannel("key", SUBJECT, store, sender=sender, endpoint_check=check)

    result = await channel.send_to(record, message(), extra_host_suffixes=("ntfy.example.org",))

    assert result.status is DeliveryStatus.DELIVERED
    assert seen == [("http://127.0.0.1:9/local", ("ntfy.example.org",))]


async def test_the_default_check_is_the_one_shared_with_the_route() -> None:
    from stellar_blaze.ports import push_endpoint

    store, _ = await record_for("https://fcm.googleapis.com/fcm/send/x")
    channel = WebPushChannel("key", SUBJECT, store, sender=Sender())

    assert channel._endpoint_check is push_endpoint.check_send_endpoint  # noqa: SLF001


async def test_a_result_is_a_delivery_result_never_an_exception_for_a_refused_host() -> None:
    store, record = await record_for("https://push.example/x")

    result = await WebPushChannel("key", SUBJECT, store, sender=Sender()).send_to(record, message())

    assert isinstance(result, DeliveryResult)
