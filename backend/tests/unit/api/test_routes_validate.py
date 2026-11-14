"""Try-a-plan: POST /plans/validate."""

from typing import Any

import pytest

from stellar_blaze.config import Settings
from tests.unit.api.support import SITE, client_for, make_world

pytestmark = pytest.mark.unit
B0 = "06:00-12:30 work\n15:00-17:00 work"


def request(**over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "site_id": SITE,
        "date": "2026-07-01",
        "crew": {"workload": "heavy", "headcount": 20, "acclimatised": True, "days_per_week": 6},
        "roster_text": B0,
    }
    body.update(over)
    return body


def test_validate_plan_b0_violations(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        response = client.post("/api/v1/plans/validate", json=request())
    body = response.json()
    assert response.status_code == 200
    assert body["validator"]["passed"] is False
    by_rule = {v["rule_id"]: v for v in body["validator"]["violations"]}
    assert {"P-H3", "P-H2.daily"} <= set(by_rule)
    assert all(v["clause"] and v["source_id"] and v["ranges"] for v in by_rule.values())
    assert body["banner_code"] == "plan.floor_banner"
    assert len(body["zone_hours"]) == 14
    assert (body["forecast_status"], body["config_version"]) == ("fresh", 0)


def test_validate_plan_segments_equal_text(settings: Settings) -> None:
    segments = [
        {"start": "06:00", "end": "12:30", "state": "work"},
        {"start": "15:00", "end": "17:00", "state": "work"},
    ]
    with client_for(make_world(settings)) as client:
        text = client.post("/api/v1/plans/validate", json=request()).json()
        typed = client.post("/api/v1/plans/validate", json=request(roster_text=None, segments=segments)).json()
    assert text == typed


def test_validate_plan_parse_error_422_lines(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        response = client.post(
            "/api/v1/plans/validate", json=request(roster_text="06:00-11:00 work\n\n25:00-26:00 work")
        )
    body = response.json()
    assert response.status_code == 422
    assert body["type"] == "urn:stellar-blaze:problem:roster-invalid"
    assert [e["line"] for e in body["errors"]] == [3]


def test_validate_plan_segment_index_is_the_line(settings: Settings) -> None:
    segments = [
        {"start": "06:00", "end": "09:00", "state": "work"},
        {"start": "08:00", "end": "10:00", "state": "work"},
    ]
    with client_for(make_world(settings)) as client:
        body = client.post("/api/v1/plans/validate", json=request(roster_text=None, segments=segments)).json()
    assert [e["line"] for e in body["errors"]] == [2]


def test_validate_plan_exactly_one_input(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        both = client.post("/api/v1/plans/validate", json=request(segments=[]))
        neither = client.post("/api/v1/plans/validate", json=request(roster_text=None))
    assert (both.status_code, neither.status_code) == (422, 422)


def test_validate_plan_unknown_site_is_404_and_a_legal_roster_passes(settings: Settings) -> None:
    legal = "06:00-11:00 work\n11:00-12:00 break\n15:00-17:00 work"
    with client_for(make_world(settings, hours=dict.fromkeys(range(2, 16), (30.0, 10.0)))) as client:
        assert client.post("/api/v1/plans/validate", json=request(site_id="nope")).status_code == 404
        body = client.post("/api/v1/plans/validate", json=request(roster_text=legal)).json()
    assert body["validator"]["passed"] is True, body["validator"]["violations"]


def test_unacclimatised_crew_is_flagged(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        crew = {"workload": "heavy", "headcount": 20, "acclimatised": False, "days_per_week": 6}
        body = client.post("/api/v1/plans/validate", json=request(crew=crew)).json()
    assert "P-H7.unacclimatised" in {v["rule_id"] for v in body["validator"]["violations"]}


def test_nothing_is_stored(settings: Settings) -> None:
    world = make_world(settings)
    with client_for(world) as client:
        client.post("/api/v1/plans/validate", json=request())
    assert world.plans.records == []
    assert world.signoffs.records == []
    assert world.audit.records == []
