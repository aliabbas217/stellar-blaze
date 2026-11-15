"""An undone stop on a real Postgres: ignored by levels and plans, both audit rows (and the stop row) stay.

The replay clock starts at 11:10 Asia/Dubai (07:10Z) on the replay day 2025-07-10 and follows the injected real clock,
which this test moves by hand: a stop undone 8 s later is inside the 10 s undo window (``STOP_UNDO_WINDOW_S``).
"""

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from stellar_blaze.config import Settings
from tests.fixtures.forecast.replay import SNAPSHOT_ID, build_fixture_snapshot
from tests.integration.b3_app import (
    ACTOR_ARGS,
    DEMO_FIXTURE,
    REPLAY_DATE,
    SITE,
    ManualWall,
    app_settings,
    bearer,
    cli_environment,
    make_workdir,
    rows,
    running_app,
    sb_jobs,
)

pytestmark = [pytest.mark.integration, pytest.mark.slow]

DATE = {"date": REPLAY_DATE.isoformat()}


def test_a_stop_undone_within_ten_seconds_leaves_the_levels_and_the_plan_alone_but_both_audit_rows_stay(
    settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    built = build_fixture_snapshot(tmp_path / "silver")
    cli_environment(monkeypatch, settings, make_workdir(tmp_path))
    assert sb_jobs("db", "upgrade").exit_code == 0
    assert sb_jobs("site", "load", str(DEMO_FIXTURE), *ACTOR_ARGS).exit_code == 0

    wall = ManualWall(datetime.now(UTC))
    config = app_settings(settings, replay_dir=built.directory.parent, snapshot_id=SNAPSHOT_ID)
    with running_app(config, wall=wall, wait_for_database_config=True) as client:
        before = client.get("/api/v1/crews/crew-b/timeline", params=DATE).json()
        plan_before = client.get("/api/v1/crews/crew-b/day-plan", params=DATE, headers=bearer()).json()

        stop = client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer()).json()
        wall.advance(seconds=8)
        assert client.delete(f"/api/v1/crews/crew-b/stops/{stop['id']}", headers=bearer()).status_code == 204

        after = client.get("/api/v1/crews/crew-b/timeline", params=DATE).json()
        plan_after = client.get("/api/v1/crews/crew-b/day-plan", params=DATE, headers=bearer()).json()
        crews = client.get(f"/api/v1/sites/{SITE}/crews", params=DATE).json()

    assert [h["crew_level"] for h in after["hours"]] == [h["crew_level"] for h in before["hours"]]
    assert plan_after["segments"] == plan_before["segments"]
    assert not [s for s in plan_after["segments"] if s["state"] == "stopped" and s not in plan_before["segments"]]
    crew_b = next(c for c in crews if c["id"] == "crew-b")
    assert (crew_b["stopped"], crew_b["active_stop_id"]) == (False, None)

    [stop_row] = rows(settings, "SELECT started_at, cleared_at FROM crew_stop")  # the row stays
    assert stop_row["cleared_at"] - stop_row["started_at"] == timedelta(seconds=8)
    kinds = [r["kind"] for r in rows(settings, "SELECT kind FROM audit_event WHERE kind LIKE 'crew.stop%' ORDER BY id")]
    assert kinds == ["crew.stop_started", "crew.stop_cleared"]  # both audit rows stay
