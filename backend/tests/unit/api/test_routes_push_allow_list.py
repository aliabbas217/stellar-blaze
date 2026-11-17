"""ADR 0067: ``create_push_subscription`` accepts an endpoint only on the allow-list of push-service hosts.

The default list covers Google FCM, Mozilla autopush, Apple Web Push and Windows WNS; the operator extends it
through the active runtime config (``push_extra_host_suffixes``), read per request, never loosened in code. A refusal
is 422 problem+json ``endpoint-host-not-allowed`` that echoes nothing of the request, and stores nothing. The
syntactic checks come first and keep their own answer (``validation-failed``).
"""

import logging
from dataclasses import replace
from typing import Any

import pytest
import structlog

from stellar_blaze.api.models import EndpointHostNotAllowedProblem
from stellar_blaze.api.responses import PROBLEM_EXAMPLES
from stellar_blaze.application.runtime_config import SnapshotHolder
from stellar_blaze.config import Settings
from stellar_blaze.errors import ENDPOINT_HOST_NOT_ALLOWED
from tests.unit.api.support import SITE, build_world, client_for

pytestmark = [pytest.mark.unit]

URL = "/api/v1/push/subscriptions"
TYPE = "urn:stellar-blaze:problem:endpoint-host-not-allowed"
DEFAULTS = [
    "https://fcm.googleapis.com/fcm/send/dXNlci1zdWI6QVBBOTFiR",
    "https://fcm.googleapis.com/wp/ABC-def_123",
    "https://updates.push.services.mozilla.com/wpush/v1/gAAAAABk",
    "https://web.push.apple.com/QGYo0xPxhJ5mP0ZZWmAZ",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAAJ",
]
NOT_ALLOWED = [
    "https://push.example/send/SECRETENDPOINT",
    "https://push.apple.com/SECRETENDPOINT",  # the bare suffix
    "https://evilpush.apple.com/SECRETENDPOINT",
    "https://x.fcm.googleapis.com/SECRETENDPOINT",
    "https://updates.push.services.mozilla.com.evil.example/SECRETENDPOINT",
    "https://updates-autopush.stage.mozaws.net/SECRETENDPOINT",
    "https://jmt17.google.com/SECRETENDPOINT",
]


def body(endpoint: str, *, crew: str | None = None) -> dict[str, Any]:
    return {
        "subscription": {
            "endpoint": endpoint,
            "expirationTime": None,
            "keys": {"p256dh": "BP-key", "auth": "auth-secret"},
        },
        "site_id": SITE,
        "crew_id": crew,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", DEFAULTS)
async def test_an_endpoint_of_every_default_service_is_stored(settings: Settings, endpoint: str) -> None:
    world = await build_world(settings)
    with client_for(world) as client:
        created = client.post(URL, json=body(endpoint, crew="crew-b"))

    assert created.status_code == 201, created.text
    [record] = await world.services.subs.for_crew("crew-b", 1)
    assert record.endpoint == endpoint


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", NOT_ALLOWED)
async def test_a_host_off_the_list_is_422_endpoint_host_not_allowed_and_nothing_is_stored(
    settings: Settings, endpoint: str, caplog: pytest.LogCaptureFixture
) -> None:
    world = await build_world(settings)
    with caplog.at_level(logging.DEBUG), structlog.testing.capture_logs() as captured, client_for(world) as client:
        response = client.post(URL, json=body(endpoint))

    assert response.status_code == 422, endpoint
    assert response.headers["content-type"].startswith("application/problem+json")
    problem = response.json()
    assert (problem["type"], problem["title"], problem["status"]) == (TYPE, "Endpoint host not allowed", 422)
    assert problem["detail"] == "The endpoint host is not on the allow-list of push services."
    assert problem["instance"] == URL
    assert problem["request_id"]
    EndpointHostNotAllowedProblem.model_validate(problem)
    assert "errors" not in problem  # not the framework's validation shape: a client tells the two apart by `type`
    everything = response.text + caplog.text + str(captured)
    for fragment in ("SECRETENDPOINT", "evil", "push.example", "stage.mozaws", "jmt17", "apple.com", "googleapis"):
        assert fragment not in everything, fragment
    assert await world.services.subs.for_site(SITE, 1) == []


@pytest.mark.asyncio
async def test_the_syntactic_checks_still_answer_validation_failed_first(settings: Settings) -> None:
    world = await build_world(settings)
    with client_for(world) as client:
        response = client.post(URL, json=body("http://fcm.googleapis.com/fcm/send/x"))  # not https

    assert response.status_code == 422
    assert response.json()["type"] == "about:blank"
    assert response.json()["detail"] == "Request validation failed"


@pytest.mark.asyncio
async def test_the_operator_override_adds_a_host_and_only_that_host(settings: Settings) -> None:
    world = await build_world(settings)
    pilot = "https://ntfy.example.org/up/abc"
    with client_for(world, push_hosts=("ntfy.example.org",)) as client:
        added = client.post(URL, json=body(pilot))
        subdomain = client.post(URL, json=body("https://eu.ntfy.example.org/up/abc"))
        default = client.post(URL, json=body(DEFAULTS[0]))  # the override extends, never replaces
        look_alike = client.post(URL, json=body("https://evilntfy.example.org/up/abc"))
        other = client.post(URL, json=body("https://push.example/up/abc"))

    assert [r.status_code for r in (added, subdomain, default)] == [201, 201, 201]
    assert (look_alike.status_code, look_alike.json()["type"]) == (422, TYPE)
    assert (other.status_code, other.json()["type"]) == (422, TYPE)
    assert len(await world.services.subs.for_site(SITE, 1)) == 3


@pytest.mark.asyncio
async def test_the_same_host_is_refused_without_the_override(settings: Settings) -> None:
    world = await build_world(settings)
    with client_for(world) as client:
        response = client.post(URL, json=body("https://ntfy.example.org/up/abc"))

    assert (response.status_code, response.json()["type"]) == (422, TYPE)


@pytest.mark.asyncio
async def test_the_list_is_read_from_the_active_config_on_every_request(settings: Settings) -> None:
    """No restart: swapping the active snapshot (what an activation does) changes the next answer."""
    world = await build_world(settings)
    pilot = "https://ntfy.example.org/up/abc"
    with client_for(world) as client:
        before = client.post(URL, json=body(pilot))
        holder = client.app.state.runtime.config  # type: ignore[attr-defined]
        current = holder.current()
        widened = current.config.model_validate(
            {**current.config.model_dump(mode="json"), "push_extra_host_suffixes": ["ntfy.example.org"]}
        )
        holder.swap(replace(current, config=widened))
        during = client.post(URL, json=body(pilot))
        holder.swap(current)
        after = client.post(URL, json=body(pilot + "-2"))

    assert (before.status_code, during.status_code, after.status_code) == (422, 201, 422)


@pytest.mark.asyncio
async def test_no_loaded_config_means_the_default_list_and_never_a_503(settings: Settings) -> None:
    world = await build_world(settings)
    with client_for(world) as client:
        app = client.app
        app.state.runtime = replace(app.state.runtime, config=SnapshotHolder())  # type: ignore[attr-defined]
        accepted = client.post(URL, json=body(DEFAULTS[0]))
        refused = client.post(URL, json=body("https://push.example/up/abc"))

    assert accepted.status_code == 201, accepted.text
    assert (refused.status_code, refused.json()["type"]) == (422, TYPE)


@pytest.mark.asyncio
async def test_hundreds_of_hanging_public_subscriptions_cannot_be_created_through_the_route(settings: Settings) -> None:
    """ADR 0067 closes I1 at the door: 450 endpoints on hosts nobody vouches for (distinct subdomains and distinct query
    variants of one host: the final review's flood) are all refused, so none of them can ever reach the send lane."""
    world = await build_world(settings)
    endpoints = [f"https://hang-{n}.example/send/abc" for n in range(150)]
    endpoints += [f"https://hang.example/send?n={n}" for n in range(150)]
    endpoints += [f"https://hang-{n}.evil.example.com/send/abc?n={n}" for n in range(150)]
    assert len(endpoints) == 450
    with client_for(world) as client:
        answers = [client.post(URL, json=body(endpoint, crew="crew-b")) for endpoint in endpoints]

    assert {a.status_code for a in answers} == {422}
    assert {a.json()["type"] for a in answers} == {TYPE}
    assert await world.services.subs.for_site(SITE, 1) == []


def test_the_example_and_the_type_constant_agree() -> None:
    example = PROBLEM_EXAMPLES["endpoint-host-not-allowed"]

    assert ENDPOINT_HOST_NOT_ALLOWED == TYPE == example["type"]
    EndpointHostNotAllowedProblem.model_validate(example)
