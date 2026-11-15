"""``mode`` (``live`` | ``replay``) on ``CrewTimeline`` and ``DayPlan``: from the site day, optional in the schema."""

from datetime import date
from typing import Any

import pytest

from stellar_blaze.api.app import create_app
from stellar_blaze.config import Settings
from tests.unit.api.support import bearer, client_for, make_world

pytestmark = pytest.mark.unit
REPLAY_DAY = date(2026, 7, 1)
TIMELINE = "/api/v1/crews/crew-b/timeline"
PLAN = "/api/v1/crews/crew-b/day-plan"
DESCRIPTION = "Whether the day was computed against the live clock and live forecasts or the fixed replay snapshot."


def replay(settings: Settings) -> Settings:
    return settings.model_copy(
        update={"forecast_source": "replay", "replay_snapshot_id": "snap", "replay_default_date": REPLAY_DAY}
    )


@pytest.mark.parametrize("path", [TIMELINE, PLAN])
def test_mode_is_live_in_live_mode(settings: Settings, path: str) -> None:
    with client_for(make_world(settings)) as client:
        response = client.get(path, params={"date": "2026-07-01"}, headers=bearer())
    assert response.status_code == 200
    assert response.json()["mode"] == "live"


@pytest.mark.parametrize("path", [TIMELINE, PLAN])
def test_mode_is_replay_in_replay_mode(settings: Settings, path: str) -> None:
    with client_for(make_world(replay(settings))) as client:
        response = client.get(path, headers=bearer())  # no date: the replay default date
    assert response.status_code == 200
    assert response.json()["mode"] == "replay"


@pytest.mark.parametrize("model", ["CrewTimeline", "DayPlan"])
def test_mode_is_an_optional_enum_property_with_its_description(settings: Settings, model: str) -> None:
    spec: dict[str, Any] = create_app(settings).openapi()
    schema = spec["components"]["schemas"][model]
    assert schema["properties"]["mode"]["enum"] == ["replay", "live"]
    assert schema["properties"]["mode"]["description"] == DESCRIPTION
    assert "mode" not in schema["required"]  # additive: a generated client that does not know it keeps working
    assert "null" not in str(schema["properties"]["mode"])  # present means live or replay, never null
