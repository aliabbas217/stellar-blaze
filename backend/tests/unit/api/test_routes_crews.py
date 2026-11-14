"""Crew timeline, day plan and stop routes."""

import asyncio
from datetime import time

import pytest

from stellar_blaze.config import Settings
from stellar_blaze.domain.plans.model import ShiftBlock
from stellar_blaze.ports.sites import CrewFixture, MemberFixture, SiteFixture
from tests.unit.api.support import (
    DEMO_TOKEN,
    OTHER_TOKEN,
    SITE,
    ExplodingForecasts,
    World,
    bearer,
    client_for,
    make_world,
)

pytestmark = pytest.mark.unit
DATE = {"date": "2026-07-01"}


def add_crew(world: World, crew_id: str, *, headcount: int, start: str, end: str, juvenile: bool = False) -> None:
    site = asyncio.run(world.sites.get_site(SITE))
    assert site is not None
    members = tuple(
        MemberFixture(days_on_site=90, days_away=0, away_reason="none", experienced=True, juvenile=juvenile and i == 0)
        for i in range(headcount)
    )
    crew = CrewFixture(
        id=crew_id,
        name=crew_id,
        task_label="Test",
        workload="heavy",
        shift=(ShiftBlock(time.fromisoformat(start), time.fromisoformat(end)),),
        days_per_week=6,
        headcount=headcount,
        members=members,
    )
    asyncio.run(world.sites.upsert_fixture(SiteFixture(site=site, crews=(crew,)), "test"))


def test_crew_timeline_suppressed_crew_keeps_level(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        small = client.get("/api/v1/crews/crew-d/timeline", params=DATE).json()
        big = client.get("/api/v1/crews/crew-b/timeline", params=DATE).json()
    assert (small["suppressed"], small["k"], big["suppressed"]) == (True, 5, False)
    assert all(h["crew_level"] is not None for h in small["hours"])
    assert [h["crew_level"] for h in small["hours"]] == [h["crew_level"] for h in big["hours"]]
    assert big["shift"][0] == {"starts_at": "2026-07-01T02:00:00Z", "ends_at": "2026-07-01T07:00:00Z"}


def test_day_plan_requires_token(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        none = client.get("/api/v1/crews/crew-b/day-plan", params=DATE)
        unknown = client.get("/api/v1/crews/crew-b/day-plan", params=DATE, headers=bearer("nope"))
    assert (none.status_code, unknown.status_code) == (401, 401)
    assert none.headers["www-authenticate"] == "Bearer"
    assert none.json()["type"] == "urn:stellar-blaze:problem:unauthorized"
    assert world.audit.records == []  # a 401 writes no audit row


def test_day_plan_other_employer_403_and_audited(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        response = client.get("/api/v1/crews/crew-b/day-plan", params=DATE, headers=bearer(OTHER_TOKEN))
    assert response.status_code == 403
    assert response.json()["type"] == "urn:stellar-blaze:problem:forbidden-employer"
    [row] = world.audit.records
    assert (row.kind, row.employer_id, row.site_id, row.epoch_id) == ("access.denied", "emp-other", SITE, 1)
    assert row.detail == {"operation": "get_crew_day_plan"}


def test_day_plan_has_banner(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        response = client.get("/api/v1/crews/crew-b/day-plan", params=DATE, headers=bearer())
    body = response.json()
    assert response.status_code == 200
    assert body["banner_code"] == "plan.floor_banner"
    assert (body["signoff_state"], body["signoff_label_code"]) == ("unsigned", "plan.unsigned_fallback")
    assert body["validator"]["passed"] is True
    assert body["segments"][0]["clause"]
    assert body["ban_window"]["active_on_date"] is True
    assert len(body["zone_hours"]) == 14
    assert (body["suppressed"], body["restricted_headcount"]) == (False, 0)


def test_ack_items_match_the_segments(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        body = client.get("/api/v1/crews/crew-b/day-plan", params=DATE, headers=bearer()).json()
    assert body["ack_items"], "an amber (Medium) day has work above Low"
    work = [s for s in body["segments"] if s["state"] in ("work", "adosh_rest") and s["zone"] in ("medium", "high")]
    first = body["ack_items"][0]
    local_start = f"{int(work[0]['starts_at'][11:13]) + 4:02d}{work[0]['starts_at'][14:16]}"  # Dubai is UTC+4
    assert first["id"] == f"medium-{local_start}"
    assert first["starts_at"] == work[0]["starts_at"]
    assert first["text_code"] == "cycle.medium.heavy.45-15"
    assert len({i["id"] for i in body["ack_items"]}) == len(body["ack_items"])
    for item in body["ack_items"]:
        covered = [s for s in work if item["starts_at"] <= s["starts_at"] < item["ends_at"]]
        assert covered
        assert covered[-1]["ends_at"] == item["ends_at"]


def test_suppressed_crew_hides_restricted_headcount_and_ids(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        body = client.get("/api/v1/crews/crew-c/day-plan", params=DATE, headers=bearer()).json()
        small = client.get("/api/v1/crews/crew-d/day-plan", params=DATE, headers=bearer()).json()
    assert (body["suppressed"], body["restricted_headcount"]) == (False, 1)
    assert body["restrictions"]  # crew-c has one returning member: the ids show for a crew of 9
    assert (small["suppressed"], small["restricted_headcount"], small["restrictions"]) == (True, None, [])


def test_crew_stop_turns_level_red_and_plan_stopped(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        world.clock.advance(hours=5)  # 10:00 local
        stop = client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer())
        timeline = client.get("/api/v1/crews/crew-b/timeline", params=DATE).json()
        plan = client.get("/api/v1/crews/crew-b/day-plan", params=DATE, headers=bearer()).json()
        crews = client.get(f"/api/v1/sites/{SITE}/crews", params=DATE).json()
    assert stop.status_code == 201
    assert stop.json()["cleared_at"] is None
    levels = {h["starts_at"]: h["crew_level"] for h in timeline["hours"]}
    assert levels["2026-07-01T06:00:00Z"] == "red"  # 10:00 local
    assert levels["2026-07-01T05:00:00Z"] != "red"
    stopped = [s for s in plan["segments"] if s["state"] == "stopped"]
    assert stopped
    assert stopped[0]["starts_at"] == "2026-07-01T06:00:00Z"
    assert all(s["state"] != "work" for s in plan["segments"] if s["starts_at"] >= "2026-07-01T06:00:00Z")
    assert plan["validator"]["passed"] is True
    crew_b = next(c for c in crews if c["id"] == "crew-b")
    assert (crew_b["stopped"], crew_b["active_stop_id"]) == (True, stop.json()["id"])
    [row] = [r for r in world.audit.records if r.kind == "crew.stop_started"]
    assert (row.epoch_id, row.employer_id, row.detail["crew_id"]) == (1, "emp-demo", "crew-b")


def test_crew_stop_clear_is_idempotent_epoch_scoped_and_audited(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        stop_id = client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "other"}, headers=bearer()).json()[
            "id"
        ]
        url = f"/api/v1/crews/crew-b/stops/{stop_id}"
        assert client.delete(url, headers=bearer()).status_code == 204
        assert client.delete(url, headers=bearer()).status_code == 204
        assert client.delete("/api/v1/crews/crew-b/stops/stop-nope", headers=bearer()).status_code == 404
        assert client.delete(f"/api/v1/crews/crew-a/stops/{stop_id}", headers=bearer()).status_code == 404
        cleared = [r for r in world.audit.records if r.kind == "crew.stop_cleared"]
        assert len(cleared) == 1
        assert cleared[0].epoch_id == 1
        other = client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer()).json()["id"]
        assert client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer()).status_code == 200
        assert client.delete(f"/api/v1/crews/crew-b/stops/{other}", headers=bearer()).status_code == 404


def test_crew_stop_other_employer_403(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        response = client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer(OTHER_TOKEN))
    assert response.status_code == 403
    assert asyncio.run(world.stops.active("crew-b", 1)) is None
    assert [r.kind for r in world.audit.records] == ["access.denied"]


def test_crew_stop_without_a_token_is_401(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        assert client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}).status_code == 401


def test_crew_stop_works_without_forecast(settings: Settings) -> None:
    with client_for(make_world(settings, forecasts=ExplodingForecasts())) as client:
        response = client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer(DEMO_TOKEN))
    assert response.status_code == 201


def test_crew_stop_survives_a_failing_audit_log(settings: Settings) -> None:
    world = make_world(settings)

    async def broken(event: object) -> None:
        raise RuntimeError("audit store down")

    world.audit.append = broken  # type: ignore[method-assign,assignment]
    with client_for(world) as client:
        response = client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer())
    assert response.status_code == 201
    assert asyncio.run(world.stops.active("crew-b", 1)) is not None


def test_illegal_shift_is_422_with_clause_not_500(settings: Settings) -> None:
    world = make_world(settings)
    add_crew(world, "crew-long", headcount=8, start="06:00", end="18:00")  # 12 h on a 6-day week
    with client_for(world) as client:
        response = client.get("/api/v1/crews/crew-long/day-plan", params=DATE, headers=bearer())
    body = response.json()
    assert response.status_code == 422
    assert body["type"] == "urn:stellar-blaze:problem:shift-not-legal"
    assert "P-H2.daily" in {v["rule_id"] for v in body["violations"]}
    assert all(v["clause"] and v["source_id"] for v in body["violations"])
    assert all(set(v) == {"rule_id", "clause", "source_id"} for v in body["violations"])
    assert world.audit.records == []  # a shift is not a planner bug: no audit row


def test_shift_not_legal_for_a_suppressed_crew_hides_juvenile_rules(settings: Settings) -> None:
    world = make_world(settings)
    add_crew(world, "crew-minor", headcount=4, start="06:00", end="18:00", juvenile=True)
    add_crew(world, "crew-minor-big", headcount=8, start="06:00", end="18:00", juvenile=True)
    with client_for(world) as client:
        small = client.get("/api/v1/crews/crew-minor/day-plan", params=DATE, headers=bearer()).json()
        big = client.get("/api/v1/crews/crew-minor-big/day-plan", params=DATE, headers=bearer()).json()
    assert any(v["rule_id"].startswith("P-H5.") for v in big["violations"])
    assert small["violations"]
    assert not any(v["rule_id"].startswith("P-H5.") for v in small["violations"])
