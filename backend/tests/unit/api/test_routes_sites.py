"""Site, forecast and policy routes (public) over the in-memory world."""

from datetime import date

import pytest
from pydantic import SecretStr

from stellar_blaze.config import Settings
from tests.unit.api.support import SITE, ExplodingForecasts, client_for, make_world

pytestmark = pytest.mark.unit


def test_list_sites_has_epoch_and_phones(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        body = client.get("/api/v1/sites").json()
    assert body == [
        {
            "id": SITE,
            "name": "Mussafah M-14 yard (synthetic)",
            "timezone": "Asia/Dubai",
            "synthetic": True,
            "epoch_id": 1,
            "supervisor_phone": "+12025550143",
            "first_aider_phone": "+12025550144",
        }
    ]


def test_forecast_today_shape_and_levels(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        response = client.get(f"/api/v1/sites/{SITE}/forecast/today", params={"date": "2026-07-01"})
    body = response.json()
    assert response.status_code == 200
    assert len(body["hours"]) == 14
    assert body["hours"][0]["starts_at"] == "2026-07-01T02:00:00Z"
    assert body["config_version"] == 0  # a file snapshot
    assert body["forecast_status"] == "fresh"
    assert body["mode"] == "live"
    assert body["policy_version"] == "ae-heat-2026.1"
    assert body["generated_at"]
    levels = {h["site_level"] for h in body["hours"]}
    assert levels <= {"green", "amber", "orange", "red"}
    assert all(h["action_codes"] for h in body["hours"])
    # 12:30-15:00 local is 08:30-11:00 UTC: the hours 08, 09 and 10 UTC carry the ban (08 partly)
    assert [h["ban_active"] for h in body["hours"][6:10]] == [True, True, True, False]
    assert body["ban_window"] == {
        "start": "12:30",
        "end": "15:00",
        "season_start": "06-15",
        "season_end": "09-15",
        "timezone": "Asia/Dubai",
        "active_on_date": True,
        "starts_at": "2026-07-01T08:30:00Z",
        "ends_at": "2026-07-01T11:00:00Z",
    }


def test_date_defaults_to_replay_default_date(settings: Settings) -> None:
    replay = settings.model_copy(
        update={"forecast_source": "replay", "replay_snapshot_id": "snap", "replay_default_date": date(2026, 7, 1)}
    )
    with client_for(make_world(replay)) as client:
        body = client.get(f"/api/v1/sites/{SITE}/forecast/today").json()
    assert (body["date"], body["mode"]) == ("2026-07-01", "replay")


def test_date_defaults_to_site_local_today_in_live_mode(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:  # the test clock reads 05:00 on 2026-07-01 in Dubai
        assert client.get(f"/api/v1/sites/{SITE}/forecast/today").json()["date"] == "2026-07-01"


def test_forecast_source_down_is_a_protective_fallback_not_an_error(settings: Settings) -> None:
    with client_for(make_world(settings, forecasts=ExplodingForecasts())) as client:
        body = client.get(f"/api/v1/sites/{SITE}/forecast/today", params={"date": "2026-07-01"}).json()
    assert body["forecast_status"] == "fallback"
    assert body["model_id"] is None
    assert all(h["site_level"] is None for h in body["hours"])


def test_unknown_site_is_404(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        response = client.get("/api/v1/sites/nope/forecast/today")
    assert response.status_code == 404
    assert response.json()["type"] == "urn:stellar-blaze:problem:not-found"


def test_risk_policy_projection_route(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        body = client.get("/api/v1/risk-policy").json()
    assert (body["version"], body["config_version"], body["k_suppression"], body["k_health"]) == (
        "ae-heat-2026.1",
        0,
        5,
        10,
    )
    assert [b["level"] for b in body["bands"]] == ["green", "amber", "orange", "red"]


def test_list_site_crews_status_fields(settings: Settings) -> None:
    with client_for(make_world(settings)) as client:
        crews = client.get(f"/api/v1/sites/{SITE}/crews", params={"date": "2026-07-01"}).json()
    assert [c["id"] for c in crews] == ["crew-a", "crew-b", "crew-c", "crew-d"]
    crew_b = crews[1]
    assert crew_b["shift"] == [{"start": "06:00", "end": "11:00"}, {"start": "15:00", "end": "18:00"}]
    assert (crew_b["signoff_state"], crew_b["plan_status"], crew_b["stopped"]) == ("unsigned", "rule", False)
    assert (crew_b["active_stop_id"], crew_b["stopped_at"], crew_b["member_count"]) == (None, None, 20)


def test_secret_tokens_are_not_needed_for_public_routes(settings: Settings) -> None:
    without = settings.model_copy(update={"access_tokens": SecretStr("{}")})
    with client_for(make_world(without)) as client:
        assert client.get("/api/v1/sites").status_code == 200
