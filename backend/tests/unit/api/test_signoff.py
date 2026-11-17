"""Plan sign-off (Task 17): ack items, the one-tap rule, changed-since-signed, and the class (d) invariant."""

import asyncio
import threading
from typing import Any

import pytest
from fastapi.testclient import TestClient

from stellar_blaze.config import Settings
from tests.unit.api.support import OTHER_TOKEN, SITE, bearer, client_for, make_world

pytestmark = pytest.mark.unit
PLAN = "/api/v1/crews/crew-b/day-plan"
SIGN = "/api/v1/crews/crew-b/day-plan/sign-off"
DATE = {"date": "2026-07-01"}
LOW_DAY = dict.fromkeys(range(2, 16), (30.0, 10.0))


def ack_ids(client: TestClient) -> list[str]:
    return [item["id"] for item in client.get(PLAN, params=DATE, headers=bearer()).json()["ack_items"]]


def sign(client: TestClient, items: list[str], **extra: Any) -> Any:
    return client.post(SIGN, params=DATE, json={"acknowledged_items": items, **extra}, headers=bearer())


def test_one_tap_allowed_only_when_unchanged_and_low_only(settings: Settings) -> None:
    low = make_world(settings, hours=LOW_DAY)
    with client_for(low, database_config=True) as client:
        assert ack_ids(client) == []
        first = sign(client, [])
        again = sign(client, [])
    assert (first.status_code, again.status_code) == (201, 201)
    assert first.json()["signed_at"] == again.json()["signed_at"]
    assert len(low.signoffs.records) == 1  # the unchanged plan is not signed twice
    medium = make_world(settings)
    with client_for(medium, database_config=True) as client:
        assert ack_ids(client)
        assert sign(client, []).status_code == 409
        client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer())
    assert medium.signoffs.records == []


def test_review_required_lists_missing_ids(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world, database_config=True) as client:
        ids = ack_ids(client)
        response = sign(client, [*ids[:-1], "bogus-0000"]) if len(ids) > 1 else sign(client, ["bogus-0000"])
    body = response.json()
    assert response.status_code == 409
    assert body["type"] == "urn:stellar-blaze:problem:review-required"
    assert body["missing_items"] == ids[-1:]
    assert world.signoffs.records == []


def test_full_acknowledgement_signs(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world, database_config=True) as client:
        ids = ack_ids(client)
        response = sign(client, [*ids, "unknown-0000"], deviation_reason_code="crew_short")
        plan = client.get(PLAN, params=DATE, headers=bearer()).json()
    body = response.json()
    assert response.status_code == 201
    assert (body["signoff_state"], body["signed_by_role"], body["acknowledged_items"]) == ("signed", "supervisor", ids)
    assert body["deviation_reason_code"] == "crew_short"
    assert (plan["signoff_state"], plan["signoff_label_code"], plan["signed_by_role"]) == ("signed", None, "supervisor")
    assert plan["signed_at"] == body["signed_at"]
    [row] = [r for r in world.audit.records if r.kind == "plan.signed"]
    assert row.epoch_id == 1
    assert row.config_version_id == 7
    assert (row.detail["items"], row.detail["unknown_ids"]) == (len(ids), 1)
    assert "plan_hash" in row.detail
    assert row.actor_role == "supervisor"


def test_signed_then_plan_changes_is_changed_since_signed(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world, database_config=True) as client:
        assert sign(client, ack_ids(client)).status_code == 201
        world.clock.advance(hours=5)
        client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer())
        plan = client.get(PLAN, params=DATE, headers=bearer()).json()
        crews = client.get(f"/api/v1/sites/{SITE}/crews", params=DATE).json()
        timeline = client.get("/api/v1/crews/crew-b/timeline", params=DATE).json()
    assert (plan["signoff_state"], plan["signoff_label_code"]) == ("changed_since_signed", "plan.changed_since_signed")
    assert plan["signed_at"] is not None
    assert next(c for c in crews if c["id"] == "crew-b")["signoff_state"] == "changed_since_signed"
    assert timeline["signoff_state"] == "changed_since_signed"


def test_signoff_other_employer_403_and_audited(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world, database_config=True) as client:
        response = client.post(SIGN, params=DATE, json={"acknowledged_items": []}, headers=bearer(OTHER_TOKEN))
    assert response.status_code == 403
    assert world.signoffs.records == []
    assert [(r.kind, r.epoch_id) for r in world.audit.records] == [("access.denied", 1)]


def test_signoff_is_append_only_and_audited(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world, database_config=True) as client:
        first = ack_ids(client)
        sign(client, first)
        world.clock.advance(hours=5)
        client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer())
        sign(client, ack_ids(client))
    assert len(world.signoffs.records) == 2
    assert world.signoffs.records[0].plan_hash != world.signoffs.records[1].plan_hash
    assert len([r for r in world.audit.records if r.kind == "plan.signed"]) == 2
    assert asyncio.run(world.audit.verify()) is None


def test_signoff_without_a_database_config_is_503(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:  # a file snapshot has no config version row to record against
        response = sign(client, ack_ids(client))
    assert response.status_code == 503
    assert response.json()["dependency"] == "config"
    assert world.signoffs.records == []


def test_signoff_of_an_illegal_shift_is_422(settings: Settings) -> None:
    from tests.unit.api.test_routes_crews import add_crew

    world = make_world(settings)
    add_crew(world, "crew-long", headcount=8, start="06:00", end="18:00")
    with client_for(world, database_config=True) as client:
        response = client.post(
            "/api/v1/crews/crew-long/day-plan/sign-off", params=DATE, json={"acknowledged_items": []}, headers=bearer()
        )
    assert response.status_code == 422
    assert response.json()["type"] == "urn:stellar-blaze:problem:shift-not-legal"


# --- class (d): sign-off never delays a stop ----------------------------------------------------------------------


def stop(client: TestClient) -> Any:
    return client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer())


def test_stop_is_never_gated_by_signoff_without_a_signoff(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:  # AT-10: no sign-off, the stop still works and the plan says unsigned
        assert stop(client).status_code == 201
        plan = client.get(PLAN, params=DATE, headers=bearer()).json()
    assert (plan["signoff_state"], plan["signoff_label_code"]) == ("unsigned", "plan.unsigned_fallback")
    assert any(s["state"] == "stopped" for s in plan["segments"])


def test_stop_is_never_gated_by_signoff_after_a_refused_signoff(settings: Settings) -> None:
    with client_for(make_world(settings), database_config=True) as client:
        assert sign(client, []).status_code == 409
        assert stop(client).status_code == 201


def test_stop_is_never_gated_by_signoff_in_flight(settings: Settings) -> None:
    world = make_world(settings)
    release = threading.Event()
    inserting = threading.Event()
    real_insert = world.signoffs.insert

    async def slow_insert(record: Any) -> Any:
        inserting.set()
        await asyncio.to_thread(release.wait, 10)
        return await real_insert(record)

    world.signoffs.insert = slow_insert  # type: ignore[method-assign]
    with client_for(world, database_config=True) as client:
        ids = ack_ids(client)
        results: list[int] = []
        worker = threading.Thread(target=lambda: results.append(sign(client, ids).status_code))
        worker.start()
        assert inserting.wait(10), "the sign-off never reached its store"
        stopped = stop(client)  # completes while the sign-off is still blocked
        assert results == []
        release.set()
        worker.join(10)
    assert stopped.status_code == 201
    assert results == [201]


def test_the_stop_route_does_not_touch_the_signoff_store(settings: Settings) -> None:
    world = make_world(settings)

    async def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("the stop path read the sign-off store")

    world.signoffs.latest = forbidden  # type: ignore[method-assign]
    world.signoffs.insert = forbidden  # type: ignore[method-assign,assignment]
    with client_for(world) as client:
        assert stop(client).status_code == 201
        assert client.delete("/api/v1/crews/crew-b/stops/stop-nope", headers=bearer()).status_code == 404
