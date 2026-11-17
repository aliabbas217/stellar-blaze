"""``create_push_subscription`` and ``delete_push_subscription`` (public routes, ADR 0058 decision 3)."""

import logging
from typing import Any

import pytest
import structlog

from stellar_blaze.config import Settings
from tests.unit.api.support import SITE, build_world, client_for

pytestmark = [pytest.mark.unit]

ENDPOINT = "https://push.example/send/abc123-SECRET"
# The explicit TEST allowance of the push host allow-list (ADR 0067): the active config of these routes names the host
# of the made-up endpoints, as an operator's `push_extra_host_suffixes` does. Production code is not loosened.
PUSH_HOSTS = ("push.example",)


def body(*, site: str = SITE, crew: str | None = None, endpoint: str = ENDPOINT, **extra: Any) -> dict[str, Any]:
    return {
        "subscription": {
            "endpoint": endpoint,
            "expirationTime": None,
            "keys": {"p256dh": "BP-key", "auth": "auth-secret"},
        },
        "site_id": site,
        "crew_id": crew,
    } | extra


@pytest.mark.asyncio
async def test_a_subscription_is_stored_in_the_active_epoch(settings: Settings) -> None:
    world = await build_world(settings)
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        created = client.post("/api/v1/push/subscriptions", json=body(crew="crew-b"))

    assert created.status_code == 201, created.text
    sub_id = created.json()["id"]
    assert created.json() == {"id": sub_id}
    [record] = await world.services.subs.for_crew("crew-b", 1)
    assert (record.id, record.site_id, record.epoch_id, record.endpoint) == (sub_id, SITE, 1, ENDPOINT)


@pytest.mark.asyncio
async def test_repeat_endpoint_same_id(settings: Settings) -> None:
    world = await build_world(settings)
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        first = client.post("/api/v1/push/subscriptions", json=body())
        second = client.post("/api/v1/push/subscriptions", json=body())
        other = client.post("/api/v1/push/subscriptions", json=body(endpoint=ENDPOINT + "-2"))

    assert (first.status_code, second.status_code) == (201, 201)
    assert first.json() == second.json()
    assert other.json()["id"] != first.json()["id"]
    assert len(await world.services.subs.for_site(SITE, 1)) == 2


@pytest.mark.asyncio
async def test_a_new_epoch_stores_the_same_endpoint_again(settings: Settings) -> None:
    world = await build_world(settings)
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        first = client.post("/api/v1/push/subscriptions", json=body())
        await world.services.epochs.start_epoch(SITE, "test", audit=None)
        second = client.post("/api/v1/push/subscriptions", json=body())

    assert first.json()["id"] != second.json()["id"]
    assert [r.id for r in await world.services.subs.for_site(SITE, 2)] == [second.json()["id"]]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [body(site="site-nowhere"), body(crew="crew-nowhere")],
    ids=["unknown-site", "unknown-crew"],
)
async def test_unknown_site_or_crew_is_404(settings: Settings, payload: dict[str, Any]) -> None:
    world = await build_world(settings)
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        response = client.post("/api/v1/push/subscriptions", json=payload)

    assert response.status_code == 404
    assert response.json()["type"] == "urn:stellar-blaze:problem:not-found"
    assert await world.services.subs.for_site(SITE, 1) == []


@pytest.mark.asyncio
async def test_a_crew_of_another_site_is_404(settings: Settings) -> None:
    world = await build_world(settings)
    other = (await world.sites.get_site(SITE)).model_copy(update={"id": "site-other"})  # type: ignore[union-attr]
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        # crew-b exists, but not at this (existing) second site: the pair does not match.
        world.sites._sites["site-other"] = other  # noqa: SLF001
        response = client.post("/api/v1/push/subscriptions", json=body(site="site-other", crew="crew-b"))

    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "extra",
    [{"worker_id": "w-1"}, {"member": "x"}, {"personal_level": "red"}],
    ids=["worker", "member", "level"],
)
async def test_subscription_extra_member_422(settings: Settings, extra: dict[str, Any]) -> None:
    world = await build_world(settings)
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        response = client.post("/api/v1/push/subscriptions", json=body(**extra))

    assert response.status_code == 422
    assert await world.services.subs.for_site(SITE, 1) == []


@pytest.mark.asyncio
async def test_extra_member_inside_the_subscription_is_422_too(settings: Settings) -> None:
    payload = body()
    payload["subscription"]["keys"]["employee"] = "e"
    world = await build_world(settings)
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        assert client.post("/api/v1/push/subscriptions", json=payload).status_code == 422


@pytest.mark.asyncio
async def test_delete_idempotent(settings: Settings) -> None:
    world = await build_world(settings)
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        sub_id = client.post("/api/v1/push/subscriptions", json=body()).json()["id"]
        first = client.delete(f"/api/v1/push/subscriptions/{sub_id}")
        second = client.delete(f"/api/v1/push/subscriptions/{sub_id}")
        unknown = client.delete("/api/v1/push/subscriptions/sub-never-existed")

    assert (first.status_code, second.status_code, unknown.status_code) == (204, 204, 204)
    assert first.content == b""
    assert await world.services.subs.for_site(SITE, 1) == []


@pytest.mark.asyncio
async def test_the_endpoint_never_reaches_a_log_line(settings: Settings, caplog: pytest.LogCaptureFixture) -> None:
    world = await build_world(settings)
    with (
        caplog.at_level(logging.DEBUG),
        structlog.testing.capture_logs() as captured,
        client_for(world, push_hosts=PUSH_HOSTS) as client,
    ):
        sub_id = client.post("/api/v1/push/subscriptions", json=body()).json()["id"]
        client.post("/api/v1/push/subscriptions", json=body(worker="w"))  # a 422 must not echo it either
        client.delete(f"/api/v1/push/subscriptions/{sub_id}")

    everything = caplog.text + str(captured)
    assert "SECRET" not in everything
    assert "auth-secret" not in everything
