"""ADR 0067 in the dispatch: the allow-list closes the permanent-loss flood of the final review (I1).

The dispatch hands the ACTIVE snapshot's ``push_extra_host_suffixes`` to every ``send_to`` (read per run: an activation
applies to the next run), and rows already stored on a host that is not on the list fail at once with ``blocked``
instead of occupying a send lane for a whole delivery deadline.
"""

import asyncio
import time
from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from stellar_blaze.adapters.notifications.webpush import WebPushChannel
from stellar_blaze.application.alerts import dispatch
from stellar_blaze.domain.config.runtime import RuntimeConfig
from stellar_blaze.ports.push import SubscriptionRecord
from tests.unit.application.serving_support import catalog, snapshot
from tests.unit.application.test_alerts import AMBER_FROM_10, World, world

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]

RUN_AT = datetime(2026, 7, 1, 3, tzinfo=UTC)  # amber from 06:00Z is inside the lead: one site event and one per crew
SUBJECT = "mailto:ops@example.org"


def with_extras(*suffixes: str) -> Any:
    base = snapshot(version_id=3)
    return replace(base, config=RuntimeConfig(push_extra_host_suffixes=suffixes))


async def run(w: World, channel: Any, config: Any) -> Any:
    return await dispatch(
        site_day=w.day,
        crews=w.crews,
        sites=w.sites,
        stops=w.stops,
        alerts=w.alerts,
        subs=w.subs,
        audit=w.audit,
        channel=channel,
        snapshot=config,
        catalog=catalog(),
        now=RUN_AT,
    )


async def test_every_send_gets_the_active_snapshots_extra_suffixes() -> None:
    w = await world(AMBER_FROM_10)
    await w.subscribe("https://ntfy.example.org/a")
    await w.subscribe("https://ntfy.example.org/b", crew="crew-b")

    await run(w, w.channel, with_extras("ntfy.example.org", "push.example"))

    assert w.channel.extras_seen  # the fake recorded what each send_to call received
    assert set(w.channel.extras_seen) == {("ntfy.example.org", "push.example")}


async def test_the_extras_are_read_per_run_so_an_activation_applies_to_the_next_run() -> None:
    w = await world(AMBER_FROM_10)
    await w.subscribe("https://ntfy.example.org/a")

    await run(w, w.channel, snapshot(version_id=3))
    first = list(w.channel.extras_seen)
    w.channel.extras_seen.clear()
    w.alerts.records.clear()  # a second run sends the same event again
    await run(w, w.channel, with_extras("ntfy.example.org"))

    assert set(first) == {()}
    assert set(w.channel.extras_seen) == {("ntfy.example.org",)}


class HangingSender:
    """``webpush_async`` of a push service that never answers; ``calls`` holds the endpoint of every send started."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def __call__(self, **kwargs: Any) -> object:
        endpoint = kwargs["subscription_info"]["endpoint"]
        self.calls.append(endpoint)
        if "fcm.googleapis.com" in endpoint:
            return SimpleNamespace(status=201)
        await asyncio.Event().wait()
        raise AssertionError("unreachable")


async def test_450_hanging_subscriptions_on_hosts_off_the_list_are_blocked_at_once_and_starve_nobody() -> None:
    """The review's I1: 450 hanging public subscriptions (distinct subdomains and query variants) ahead of one real
    worker made the site event store ``delivered=0, failed=451`` (about 386 sends fit in the run budget at 16 per 12 s).
    Now the 450 rows fail ``blocked`` without a connection and the real one is delivered; the run takes well under the
    12 s a single hanging send would have cost."""
    w = await world(AMBER_FROM_10)
    for n in range(150):
        await w.subscribe(f"https://hang-{n}.example/send/abc")
    for n in range(150):
        await w.subscribe(f"https://hang.example/send?n={n}")
    for n in range(150):
        await w.subscribe(f"https://hang-{n}.evil.example.com/send/abc?n={n}")
    await w.subscribe("https://fcm.googleapis.com/fcm/send/real-worker")  # registered LAST, behind the flood
    sender = HangingSender()
    channel = WebPushChannel("key", SUBJECT, w.subs, sender=sender)
    started = time.monotonic()

    report = await asyncio.wait_for(run(w, channel, snapshot(version_id=3)), timeout=30)

    assert time.monotonic() - started < 8  # one delivery deadline is 12 s: no send waited for it
    [site_row] = w.site_events()
    assert (site_row.delivered, site_row.failed) == (1, 450)
    assert sender.calls == ["https://fcm.googleapis.com/fcm/send/real-worker"]  # nothing else was ever started
    assert report.failed >= 450


async def test_rows_off_the_list_are_delivered_when_the_active_config_names_their_host() -> None:
    w = await world(AMBER_FROM_10)
    for n in range(20):
        await w.subscribe(f"https://pilot.example/send/{n}")
    sent: list[str] = []

    async def fast(**kwargs: Any) -> object:
        sent.append(kwargs["subscription_info"]["endpoint"])
        return SimpleNamespace(status=201)

    channel = WebPushChannel("key", SUBJECT, w.subs, sender=fast)

    await run(w, channel, with_extras("pilot.example"))
    [site_row] = w.site_events()

    assert (site_row.delivered, site_row.failed) == (20, 0)
    assert len(sent) == 20


async def test_the_recording_channel_still_satisfies_the_push_channel_contract() -> None:
    w = await world(AMBER_FROM_10)
    sub_id = await w.subscribe("https://fcm.googleapis.com/fcm/send/x")
    [record] = list(await w.subs.for_site("site-demo-mussafah", 1))
    assert isinstance(record, SubscriptionRecord)

    result = await w.channel.send_to(record, SimpleNamespace(), extra_host_suffixes=("a.example",))  # type: ignore[arg-type]

    assert result.status.value == "delivered"
    assert w.channel.extras_seen == [("a.example",)]
    assert sub_id == record.id
