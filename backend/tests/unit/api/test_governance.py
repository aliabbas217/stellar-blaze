"""Governance refusal, transparency log, demo reset and the rate limits."""

import logging

import pytest

from stellar_blaze.config import Settings
from tests.unit.api.support import OTHER_TOKEN, SITE, World, bearer, client_for, make_world

pytestmark = pytest.mark.unit
WORKER_REF = "staff-no-4471-AliKhan"
REQUEST = {"subject": "worker", "data_class": "health", "worker_ref": WORKER_REF}
URL = f"/api/v1/sites/{SITE}/data-requests"


def test_data_request_401_without_token(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        response = client.post(URL, json=REQUEST)
    assert response.status_code == 401
    assert world.audit.records == []


def test_data_request_403_and_audit_row(settings: Settings, caplog: pytest.LogCaptureFixture) -> None:
    world = make_world(settings)
    with caplog.at_level(logging.DEBUG), client_for(world) as client:
        response = client.post(URL, json=REQUEST, headers=bearer())
    assert response.status_code == 403
    assert response.json()["type"] == "urn:stellar-blaze:problem:individual-data-refused"
    assert "never released to an employer (ADR 0004)" in response.json()["detail"]
    [row] = world.audit.records
    assert (row.kind, row.outcome, row.actor_role, row.employer_id, row.site_id) == (
        "data_request.refused",
        "refused",
        "employer",
        "emp-demo",
        SITE,
    )
    assert row.epoch_id == 1
    assert row.ruleset_id == "ae-heat-2026.1"
    assert len(row.ruleset_sha256 or "") == 64
    assert (row.model_id, row.config_version_id) == (None, None)  # file snapshot: version reported as 0
    assert row.config_sha256
    everywhere = response.text + row.model_dump_json() + caplog.text
    assert WORKER_REF not in everywhere
    assert "4471" not in everywhere


def test_data_request_validates_then_drops_the_reference(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        too_long = client.post(URL, json={**REQUEST, "worker_ref": "x" * 101}, headers=bearer())
        unknown = client.post("/api/v1/sites/nope/data-requests", json=REQUEST, headers=bearer())
    assert (too_long.status_code, unknown.status_code) == (422, 404)
    assert "x" * 101 not in too_long.text


def test_transparency_log_shows_refusal(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        assert client.get(f"/api/v1/sites/{SITE}/transparency-log").json()["entries"] == []
        client.post(URL, json=REQUEST, headers=bearer())
        client.post(URL, json={**REQUEST, "data_class": "personal"}, headers=bearer(OTHER_TOKEN))
        body = client.get(f"/api/v1/sites/{SITE}/transparency-log").json()
    assert len(body["entries"]) == 2
    entry = body["entries"][0]
    assert (entry["kind"], entry["outcome"], entry["actor_role"]) == ("data_request.refused", "refused", "employer")
    assert entry["rule"] == "ADR 0004; PDPL purpose limitation"
    assert (entry["policy_version"], entry["config_version"]) == ("ae-heat-2026.1", 0)
    assert WORKER_REF not in str(body)
    assert "emp-" not in str(body)


def test_reads_are_epoch_scoped(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world, database_config=True) as client:
        client.post(URL, json=REQUEST, headers=bearer())
        client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer())
        client.get("/api/v1/crews/crew-b/day-plan", params={"date": "2026-07-01"}, headers=bearer())
        ack = client.get("/api/v1/crews/crew-b/day-plan", params={"date": "2026-07-01"}, headers=bearer()).json()
        client.post(
            "/api/v1/crews/crew-b/day-plan/sign-off?date=2026-07-01",
            json={"acknowledged_items": [i["id"] for i in ack["ack_items"]]},
            headers=bearer(),
        )
        assert client.get(f"/api/v1/sites/{SITE}/transparency-log").json()["entries"]
        reset = client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer())
        assert reset.status_code == 200
        body = reset.json()
        assert (body["site_id"], body["epoch_id"], body["previous_epoch_id"]) == (SITE, 2, 1)
        assert client.get(f"/api/v1/sites/{SITE}/transparency-log").json()["entries"] == []
        crews = client.get(f"/api/v1/sites/{SITE}/crews", params={"date": "2026-07-01"}).json()
        crew_b = next(c for c in crews if c["id"] == "crew-b")
        assert (crew_b["stopped"], crew_b["signoff_state"]) == (False, "unsigned")
        assert client.get("/api/v1/sites").json()[0]["epoch_id"] == 2
        client.post(URL, json=REQUEST, headers=bearer())
        assert len(client.get(f"/api/v1/sites/{SITE}/transparency-log").json()["entries"]) == 1


def test_reset_appends_demo_reset_and_is_not_worker_visible(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer())
        entries = client.get(f"/api/v1/sites/{SITE}/transparency-log").json()["entries"]
    [row] = [r for r in world.audit.records if r.kind == "demo_reset"]
    assert row.detail == {"previous_epoch": 1, "new_epoch": 2}
    assert row.employer_id == "emp-demo"
    assert entries == []
    assert asyncio_verify(world) is None


def asyncio_verify(world: World) -> int | None:
    import asyncio

    return asyncio.run(world.audit.verify())


def test_reset_refused_for_non_synthetic_site(settings: Settings) -> None:
    world = make_world(settings)
    site = world.sites._sites[SITE]  # noqa: SLF001  (flip the flag of the fake's only site)
    world.sites._sites[SITE] = site.model_copy(update={"synthetic": False})  # noqa: SLF001
    with client_for(world) as client:
        response = client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer())
    assert response.status_code == 409
    assert response.json()["type"] == "urn:stellar-blaze:problem:not-a-demo-site"
    assert [r.kind for r in world.audit.records] == ["demo_reset.refused"]
    assert world.audit.records[0].epoch_id == 1


def test_reset_other_employer_403(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        response = client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer(OTHER_TOKEN))
    assert response.status_code == 403
    assert [r.kind for r in world.audit.records] == ["access.denied"]


# --- rate limits --------------------------------------------------------------------------------------------------


def test_429_after_limit_with_retry_after(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        codes = [client.post(URL, json=REQUEST, headers=bearer()).status_code for _ in range(60)]
        over = client.post(URL, json=REQUEST, headers=bearer())
    assert set(codes) == {403}
    assert over.status_code == 429
    assert over.headers["retry-after"] == "60"
    assert over.json()["type"] == "urn:stellar-blaze:problem:rate-limited"
    assert len([r for r in world.audit.records if r.kind == "data_request.refused"]) == 60  # the 429 wrote nothing


def test_window_slides(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        for _ in range(60):
            client.post(URL, json=REQUEST, headers=bearer())
        world.clock.advance(seconds=30)
        assert client.post(URL, json=REQUEST, headers=bearer()).headers["retry-after"] == "30"
        world.clock.advance(seconds=31)
        assert client.post(URL, json=REQUEST, headers=bearer()).status_code == 403


def test_limit_is_per_token(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        for _ in range(60):
            client.post(URL, json=REQUEST, headers=bearer())
        assert client.post(URL, json=REQUEST, headers=bearer()).status_code == 429
        assert client.post(URL, json=REQUEST, headers=bearer(OTHER_TOKEN)).status_code == 403


def test_reset_has_its_own_limits(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        assert client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer()).status_code == 200
        second = client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer())
        assert (second.status_code, second.headers["retry-after"]) == (429, "60")
        for _ in range(9):
            world.clock.advance(seconds=61)
            assert client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer()).status_code == 200
        world.clock.advance(seconds=61)
        hourly = client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer())
        assert hourly.status_code == 429
        assert int(hourly.headers["retry-after"]) > 60
        # the general bucket was charged by each reset, not drained by the refused ones
        assert client.get("/api/v1/crews/crew-b/day-plan", headers=bearer()).status_code != 429


def test_exhausted_employer_bucket_does_not_block_stop(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        codes = [client.post(URL, json=REQUEST, headers=bearer()).status_code for _ in range(61)]
        assert codes[-1] == 429
        assert (
            client.delete("/api/v1/crews/crew-b/stops/stop-x", headers=bearer()).status_code == 429
        )  # resume: general
        stop = client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer())
    assert stop.status_code == 201


def test_stop_bucket_exhaustion_blocks_only_stop(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        codes = [
            client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer()).status_code
            for _ in range(31)
        ]
        over = client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer())
        other = client.post(URL, json=REQUEST, headers=bearer())
    assert codes[:30] == [201] * 30
    assert codes[30] == 429
    assert over.headers["retry-after"] == "60"
    assert other.status_code == 403  # every other operation is unaffected


def test_stop_survives_reset_limit(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer())
        assert client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer()).status_code == 429
        assert (
            client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer()).status_code == 201
        )


def test_a_401_is_not_charged(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        assert {client.post(URL, json=REQUEST).status_code for _ in range(70)} == {401}
        assert client.post(URL, json=REQUEST, headers=bearer()).status_code == 403
