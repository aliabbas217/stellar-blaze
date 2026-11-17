"""Fix round (C2, I1): the PUBLIC subscription route refuses what it must not store, caps what it does store, and never
logs an endpoint or a key, not even when the database error carries them as statement parameters."""

import logging
from typing import Any

import pytest
import structlog
from sqlalchemy.exc import DBAPIError

from stellar_blaze.config import Settings
from tests.unit.api.support import SITE, build_world, client_for

pytestmark = [pytest.mark.unit]

ENDPOINT = "https://push.example/send/abc123"
# The explicit TEST allowance of the push host allow-list (ADR 0067): the active config of these routes names the host
# of the made-up endpoints, as an operator's `push_extra_host_suffixes` does. Production code is not loosened.
PUSH_HOSTS = ("push.example",)
SECRET_ENDPOINT = "https://push.example/send/SECRETENDPOINT"  # noqa: S105  (a made-up value the tests hunt for)
URL = "/api/v1/push/subscriptions"
BAD_ENDPOINTS = [
    "http://169.254.169.254/latest/meta-data",
    "http://push.example/plain-http",
    "https://127.0.0.1:5432/",
    "https://[::1]/x",
    "https://[::ffff:7f00:1]/x",
    "https://2130706433/x",
    "https://0x7f.0.0.1/x",
    "https://127.0.0.0x1/x",
    "https://10.0.0.5/x",
    "https://localhost/x",
    "https://printer.local/x",
    "https://db.internal/x",
    "https://intranet/x",
    "https://user:pw@push.example/x",
    "https://push.example:5432/x",
    "ftp://push.example/x",
    "javascript:alert(1)",
    "not a url at all",
    "https://push.example/a\x00b",
    "https://push.example/a\nb",
    "",
]


def body(*, crew: str | None = None, endpoint: str = ENDPOINT, keys: dict[str, str] | None = None) -> dict[str, Any]:
    return {
        "subscription": {
            "endpoint": endpoint,
            "expirationTime": None,
            "keys": keys or {"p256dh": "BP-key", "auth": "auth-secret"},
        },
        "site_id": SITE,
        "crew_id": crew,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", BAD_ENDPOINTS)
async def test_a_non_public_endpoint_is_422_and_nothing_is_stored(settings: Settings, endpoint: str) -> None:
    world = await build_world(settings)
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        response = client.post(URL, json=body(endpoint=endpoint))

    assert response.status_code == 422, endpoint
    assert response.json()["detail"] == "Request validation failed"
    assert all("input" not in e for e in response.json()["errors"])
    assert not endpoint.strip() or endpoint.strip() not in response.text
    assert await world.services.subs.for_site(SITE, 1) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "keys",
    [
        {"p256dh": "has space", "auth": "ok"},
        {"p256dh": "ok", "auth": "a\x00b"},
        {"p256dh": "ok", "auth": "not+base64/url"},
        {"p256dh": "", "auth": "ok"},
        {"p256dh": "ok", "auth": "x" * 300},
    ],
    ids=["space", "nul", "plus-slash", "empty", "too-long"],
)
async def test_bad_keys_are_422(settings: Settings, keys: dict[str, str]) -> None:
    world = await build_world(settings)
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        response = client.post(URL, json=body(keys=keys))

    assert response.status_code == 422
    assert await world.services.subs.for_site(SITE, 1) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("expiry", ["NaN", "Infinity", "-Infinity", "1e30", "-1", "9223372036854775808"])
async def test_a_bad_expiration_time_is_422(settings: Settings, expiry: str) -> None:
    keys = '{"p256dh": "BP-key", "auth": "auth-secret"}'
    raw = f'{{"subscription": {{"endpoint": "{SECRET_ENDPOINT}", "expirationTime": {expiry}, "keys": {keys}}}, '
    raw += f'"site_id": "{SITE}", "crew_id": null}}'
    world = await build_world(settings)
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        response = client.post(URL, content=raw, headers={"content-type": "application/json"})

    assert response.status_code == 422
    assert await world.services.subs.for_site(SITE, 1) == []


@pytest.mark.asyncio
async def test_a_valid_expiration_time_is_stored(settings: Settings) -> None:
    payload = body()
    payload["subscription"]["expirationTime"] = 1_893_456_000_000
    world = await build_world(settings)
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        assert client.post(URL, json=payload).status_code == 201

    [record] = await world.services.subs.for_site(SITE, 1)
    assert record.expiration_time == 1_893_456_000_000


@pytest.mark.asyncio
async def test_bad_inputs_never_reach_a_log_line(settings: Settings, caplog: pytest.LogCaptureFixture) -> None:
    world = await build_world(settings)
    with (
        caplog.at_level(logging.DEBUG),
        structlog.testing.capture_logs() as captured,
        client_for(world, push_hosts=PUSH_HOSTS) as client,
    ):
        for endpoint in ("http://169.254.169.254/SECRETENDPOINT", "https://push.example/SECRETENDPOINT\x00"):
            client.post(URL, json=body(endpoint=endpoint))
        client.post(
            URL, json=body(endpoint=SECRET_ENDPOINT, keys={"p256dh": "KEYSECRET\x00", "auth": "AUTHSECRET\x00"})
        )

    everything = caplog.text + str(captured)
    for secret in ("SECRETENDPOINT", "KEYSECRET", "AUTHSECRET"):
        assert secret not in everything


@pytest.mark.asyncio
async def test_a_store_error_with_parameters_never_reaches_a_log_line(
    settings: Settings, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The reviewer's 500: a DBAPIError carries ``[parameters: (...)]`` and the unhandled-exception log printed them."""
    world = await build_world(settings)

    async def failing(*_: object, **__: object) -> str:
        raise DBAPIError(
            "INSERT INTO push_subscription ...",
            (SECRET_ENDPOINT, "P256DHSECRET", "AUTHSECRET"),
            RuntimeError("connection reset"),
        )

    monkeypatch.setattr(world.services.subs, "upsert_by_endpoint", failing)
    payload = body(endpoint=SECRET_ENDPOINT, keys={"p256dh": "P256DHSECRET", "auth": "AUTHSECRET"})
    with (
        caplog.at_level(logging.DEBUG),
        structlog.testing.capture_logs() as captured,
        client_for(world, push_hosts=PUSH_HOSTS) as client,
    ):
        response = client.post(URL, json=payload)

    assert response.status_code == 500
    everything = caplog.text + str(captured) + response.text
    for secret in ("SECRETENDPOINT", "P256DHSECRET", "AUTHSECRET", "parameters"):
        assert secret not in everything
    assert "DBAPIError" in caplog.text  # the class name is the only trace


@pytest.mark.asyncio
async def test_the_site_cap_is_422_and_a_repeat_endpoint_at_the_cap_still_answers(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("stellar_blaze.api.routers.push.MAX_SUBSCRIPTIONS_PER_SITE", 3)
    world = await build_world(settings)
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        ids = [client.post(URL, json=body(endpoint=f"{ENDPOINT}-{n}")).json()["id"] for n in range(3)]
        over = client.post(URL, json=body(endpoint=f"{ENDPOINT}-new"))
        repeat = client.post(URL, json=body(endpoint=f"{ENDPOINT}-1"))
        client.delete(f"{URL}/{ids[0]}")
        after_delete = client.post(URL, json=body(endpoint=f"{ENDPOINT}-new"))

    assert over.status_code == 422
    assert "too many subscriptions for this site" in over.text
    assert ENDPOINT not in over.text
    assert (repeat.status_code, repeat.json()["id"]) == (201, ids[1])
    assert after_delete.status_code == 201
    assert len(await world.services.subs.for_site(SITE, 1)) == 3


@pytest.mark.asyncio
async def test_the_crew_cap_is_per_crew_and_per_epoch(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("stellar_blaze.api.routers.push.MAX_SUBSCRIPTIONS_PER_CREW", 2)
    world = await build_world(settings)
    with client_for(world, push_hosts=PUSH_HOSTS) as client:
        for n in range(2):
            assert client.post(URL, json=body(crew="crew-b", endpoint=f"{ENDPOINT}-{n}")).status_code == 201
        over = client.post(URL, json=body(crew="crew-b", endpoint=f"{ENDPOINT}-over"))
        site_wide = client.post(URL, json=body(endpoint=f"{ENDPOINT}-site"))
        await world.services.epochs.start_epoch(SITE, "test", audit=None)
        new_epoch = client.post(URL, json=body(crew="crew-b", endpoint=f"{ENDPOINT}-over"))

    assert over.status_code == 422
    assert "too many subscriptions for this crew" in over.text
    assert (site_wide.status_code, new_epoch.status_code) == (201, 201)
