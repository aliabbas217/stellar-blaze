"""The finished B3 API end to end: a real Postgres, ``sb-jobs`` (migrate, load the demo site, activate a database
config), the app in replay mode over the B2 replay fixture, and the demo employer token.

It walks the demo story: the site's day, crew B's validated plan with its acknowledgement items, a sign-off, a
try-a-plan roster that breaks P-H3 and P-H2.daily, a crew-lead stop (the crew's level turns Red from the stop, the plan
ticks stopped and reads ``changed_since_signed``), the resume, a refused data request (audited with ruleset, model and
config identity and with no trace of the worker reference anywhere), the transparency log, a demo reset and an intact
audit chain. It also walks the alerts: a Web Push subscription through the API, a first alerts dispatch run, and
the next run after the stop, which creates crew B's red event (a recording channel stands in for the push service).
"""

import logging
from collections.abc import Mapping
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from stellar_blaze.adapters.fakes.notifications import RecordingPushChannel
from stellar_blaze.config import Settings
from stellar_blaze.jobs import cli
from stellar_blaze.ports.push import PushChannel, PushSubscriptionStore
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
    last_json,
    make_workdir,
    rows,
    running_app,
    sb_jobs,
)
from tests.privacy import contains_standalone

pytestmark = [pytest.mark.integration, pytest.mark.slow]

DATE = {"date": REPLAY_DATE.isoformat()}
WORKER_REF = "staff-no-4471-AliKhan"
B0_ROSTER = "06:00-12:30 work\n15:00-17:00 work"
BANNER = "plan.floor_banner"
# The replay clock reads 11:10 Asia/Dubai (07:10Z) on the replay day at the START OF THE CURRENT EPOCH (the
# `site_epoch` row) and then follows the real clock, which the test moves by hand: sign-off after 5 minutes, stop after
# 5 more, resume after 10 more. (It used to count from the api process start; now the row is the base, see `wall`.)
SIGNED_AT = "2025-07-10T07:15:00Z"
STOP_AT = "2025-07-10T07:20:00Z"
CLEARED_AT = "2025-07-10T07:30:00Z"
AFTERNOON_SHIFT = "2025-07-10T11:00:00Z"  # crew B works 06:00-11:00 and 15:00-18:00 local; 11:20 is its mid-day break
SHIFT_END = "2025-07-10T14:00:00Z"  # 18:00 local: the end of crew B's last block


def instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def check_ack_items_follow_the_segments(plan: Mapping[str, Any]) -> None:
    """Every acknowledgement item is a run of work and rest segments at one zone above Low, named by its start."""
    segments = [s for s in plan["segments"] if s["state"] in ("work", "adosh_rest") and s["zone"] is not None]
    for item in plan["ack_items"]:
        assert item["zone"] in ("medium", "high", "red")
        start, end = instant(item["starts_at"]), instant(item["ends_at"])
        local = start + timedelta(hours=4)  # Asia/Dubai, no DST
        assert item["id"] == f"{item['zone']}-{local:%H%M}"
        covered = [s for s in segments if start <= instant(s["starts_at"]) and instant(s["ends_at"]) <= end]
        assert covered, item
        assert {s["zone"] for s in covered} == {item["zone"]}
        assert covered[0]["starts_at"] == item["starts_at"]
        assert covered[-1]["ends_at"] == item["ends_at"]
    ordered = [instant(i["starts_at"]) for i in plan["ack_items"]]
    assert ordered == sorted(ordered)
    assert len({i["id"] for i in plan["ack_items"]}) == len(plan["ack_items"])


def test_the_demo_day_runs_end_to_end_on_postgres_in_replay_mode(
    settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    built = build_fixture_snapshot(tmp_path / "silver")
    replay_dir = built.directory.parent
    assert built.directory.name == SNAPSHOT_ID
    cli_environment(monkeypatch, settings, make_workdir(tmp_path))

    # --- the operator's side: migrate and seed the config (activated in the database), then load the demo site ----
    upgraded = sb_jobs("db", "upgrade")
    assert upgraded.exit_code == 0, upgraded.output
    loaded = sb_jobs("site", "load", str(DEMO_FIXTURE), *ACTOR_ARGS)
    assert loaded.exit_code == 0, loaded.output
    assert last_json(loaded)["created"] is True
    [activation] = rows(settings, "SELECT id, config_version_id FROM config_activation ORDER BY id")
    assert activation["config_version_id"] is not None

    # The REAL clock is injected and starts exactly at the epoch's `started_at` (the row `site load` wrote through the
    # CLI, with the real clock): replay time is `anchor + (wall - epoch start)`, so SIGNED_AT, STOP_AT and CLEARED_AT
    # are exact (07:10Z + 5 min, + 10 min, + 20 min). The replay clock itself is production code.
    [first_epoch] = rows(settings, "SELECT started_at FROM site_epoch")
    wall = ManualWall(first_epoch["started_at"])
    started_wall = wall.now
    app_cfg = app_settings(settings, replay_dir=replay_dir, snapshot_id=SNAPSHOT_ID)
    with caplog.at_level(logging.DEBUG), running_app(app_cfg, wall=wall, wait_for_database_config=True) as client:
        # --- the site's day -------------------------------------------------------------------------------------
        forecast = client.get(f"/api/v1/sites/{SITE}/forecast/today", params=DATE)
        assert forecast.status_code == 200, forecast.text
        day = forecast.json()
        assert (day["mode"], day["forecast_status"], day["date"]) == ("replay", "fresh", REPLAY_DATE.isoformat())
        assert day["config_version"] == activation["config_version_id"]  # a database config, not the file seed
        assert len(day["hours"]) == 14
        assert all(h["site_level"] in ("green", "amber", "orange", "red") for h in day["hours"])

        baseline_timeline = client.get("/api/v1/crews/crew-b/timeline", params=DATE).json()  # before any stop

        # --- crew B's validated day plan ------------------------------------------------------------------------
        plan_response = client.get("/api/v1/crews/crew-b/day-plan", params=DATE, headers=bearer())
        assert plan_response.status_code == 200, plan_response.text
        plan = plan_response.json()
        assert plan["validator"]["passed"] is True
        assert plan["validator"]["violations"] == []
        assert plan["banner_code"] == BANNER
        assert plan["segments"]
        assert all(s["rule_id"] and s["clause"] for s in plan["segments"] if s["state"] != "off")
        assert {s["state"] for s in plan["segments"]} <= {"work", "adosh_rest", "art18_break", "off", "ban", "stopped"}
        check_ack_items_follow_the_segments(plan)
        assert (plan["signoff_state"], plan["signoff_label_code"]) == ("unsigned", "plan.unsigned_fallback")
        assert plan["signed_at"] is None
        assert plan["signed_by_role"] is None
        assert plan["config_version"] == activation["config_version_id"]
        stored_plans = rows(settings, "SELECT id FROM day_plan WHERE crew_id = 'crew-b'")
        again = client.get("/api/v1/crews/crew-b/day-plan", params=DATE, headers=bearer())
        assert again.json()["segments"] == plan["segments"]
        assert rows(settings, "SELECT id FROM day_plan WHERE crew_id = 'crew-b'") == stored_plans  # review I5

        # --- sign-off with every ack id --------------------------------------------------------------------------
        ack_ids = [item["id"] for item in plan["ack_items"]]
        wall.advance(minutes=5)
        signed = client.post(
            "/api/v1/crews/crew-b/day-plan/sign-off",
            params=DATE,
            json={"acknowledged_items": ack_ids},
            headers=bearer(),
        )
        assert signed.status_code == 201, signed.text
        assert signed.json()["signoff_state"] == "signed"
        assert signed.json()["signed_at"] == SIGNED_AT  # the replay day, not today
        after_sign = client.get("/api/v1/crews/crew-b/day-plan", params=DATE, headers=bearer()).json()
        assert (after_sign["signoff_state"], after_sign["signoff_label_code"]) == ("signed", None)
        assert after_sign["signed_by_role"] == "supervisor"  # a role, never a name

        # --- try-a-plan with the B0 roster ----------------------------------------------------------------------
        tried = client.post(
            "/api/v1/plans/validate",
            json={
                "site_id": SITE,
                "date": REPLAY_DATE.isoformat(),
                "crew": {"workload": "heavy", "headcount": 20, "acclimatised": True, "days_per_week": 6},
                "roster_text": B0_ROSTER,
            },
        )
        assert tried.status_code == 200, tried.text
        verdict = tried.json()
        assert verdict["validator"]["passed"] is False
        by_rule = {v["rule_id"]: v for v in verdict["validator"]["violations"]}
        assert {"P-H3", "P-H2.daily"} <= set(by_rule)
        assert all(by_rule[rule]["clause"] and by_rule[rule]["source_id"] for rule in ("P-H3", "P-H2.daily"))

        # --- alerts: crew B subscribes through the API, the first dispatch run announces the day -----------------
        recording = RecordingPushChannel()

        def build_channel(_settings: Settings, _subs: PushSubscriptionStore) -> PushChannel | None:
            return recording

        monkeypatch.setattr(cli, "build_push_channel", build_channel)
        monkeypatch.setenv("SB_FORECAST_SOURCE", "replay")
        monkeypatch.setenv("SB_REPLAY_DIR", str(replay_dir))
        monkeypatch.setenv("SB_REPLAY_SNAPSHOT_ID", SNAPSHOT_ID)
        monkeypatch.setenv("SB_REPLAY_DEFAULT_DATE", REPLAY_DATE.isoformat())
        subscribed = client.post(
            "/api/v1/push/subscriptions",
            json={
                "subscription": {
                    # A host of the built-in allow-list (ADR 0067): the route refuses any other, and this flow runs on
                    # the default config. The recording channel below stands in for the push service itself.
                    "endpoint": "https://fcm.googleapis.com/fcm/send/crew-b-phone",
                    "expirationTime": None,
                    "keys": {"p256dh": "BP-key", "auth": "auth-secret"},
                },
                "site_id": SITE,
                "crew_id": "crew-b",
            },
        )
        assert subscribed.status_code == 201, subscribed.text
        first_dispatch = sb_jobs("alerts", "dispatch", "--site", SITE, "--as-of", "2025-07-10T07:15:00Z")
        assert first_dispatch.exit_code == 0, first_dispatch.output
        crew_b_alerts = "SELECT level, kind, valid_from FROM alert_event WHERE crew_id = 'crew-b' ORDER BY id"
        announced = rows(settings, crew_b_alerts)
        assert announced  # the day's levels were announced before the stop

        # --- a crew-lead stop: the crew's level turns Red from the stop, the plan stops, the sign-off is stale ----
        wall.advance(minutes=5)
        stop_wall = wall.now
        stop = client.post("/api/v1/crews/crew-b/stops", json={"reason_code": "heat"}, headers=bearer())
        assert stop.status_code == 201, stop.text
        assert stop.json()["started_at"] == STOP_AT  # on the replay day: "Stop work" visibly does something
        stopped_timeline = client.get("/api/v1/crews/crew-b/timeline", params=DATE).json()
        levels = {h["starts_at"]: h["crew_level"] for h in stopped_timeline["hours"]}
        assert levels["2025-07-10T07:00:00Z"] == "red"  # the hour the stop starts in
        # An active stop covers up to the end of crew B's shift (18:00 local = 14:00Z), not to the end of the day.
        assert all(level == "red" for start, level in levels.items() if "2025-07-10T07:00:00Z" <= start < SHIFT_END)
        assert all(level != "red" for start, level in levels.items() if start >= SHIFT_END)
        assert levels["2025-07-10T06:00:00Z"] != "red"
        stopped_plan = client.get("/api/v1/crews/crew-b/day-plan", params=DATE, headers=bearer()).json()
        stopped_segments = [s for s in stopped_plan["segments"] if s["state"] == "stopped"]
        assert stopped_segments
        assert stopped_segments[0]["starts_at"] == AFTERNOON_SHIFT  # the afternoon block, the first work after the stop
        assert all(s["state"] != "work" for s in stopped_plan["segments"] if s["starts_at"] >= STOP_AT)
        assert stopped_plan["signoff_state"] == "changed_since_signed"
        assert stopped_plan["signoff_label_code"] == "plan.changed_since_signed"
        assert stopped_plan["validator"]["passed"] is True

        # --- the NEXT dispatch run escalates the stop: one red crew event from the stop's hour ------------------
        second_dispatch = sb_jobs("alerts", "dispatch", "--site", SITE, "--as-of", "2025-07-10T07:25:00Z")
        assert second_dispatch.exit_code == 0, second_dispatch.output
        assert last_json(second_dispatch)["events_created"] == 1
        escalated = rows(
            settings,
            "SELECT level, kind, valid_from, delivered, failed, config_version_id, ruleset_id, model_id, "
            "dispatch_interval_minutes, epoch_id FROM alert_event WHERE crew_id = 'crew-b' ORDER BY id",
        )
        assert len(escalated) == len(announced) + 1
        red = escalated[-1]
        assert (red["level"], red["kind"], red["valid_from"]) == ("red", "escalate", instant("2025-07-10T07:00:00Z"))
        assert (red["delivered"], red["failed"], red["epoch_id"]) == (1, 0, 1)
        assert red["config_version_id"] == activation["config_version_id"]
        assert (red["ruleset_id"], red["model_id"], red["dispatch_interval_minutes"]) == ("ae-heat-2026.1", None, 5)
        assert [(m.crew_id, m.level.value) for _, m in recording.sent][-1] == ("crew-b", "red")

        # --- resume ----------------------------------------------------------------------------------------------
        wall.advance(minutes=10)
        resumed = client.delete(f"/api/v1/crews/crew-b/stops/{stop.json()['id']}", headers=bearer())
        assert resumed.status_code == 204
        [stop_row] = rows(settings, "SELECT started_at, cleared_at FROM crew_stop")
        assert (stop_row["started_at"], stop_row["cleared_at"]) == (instant(STOP_AT), instant(CLEARED_AT))
        resumed_plan = client.get("/api/v1/crews/crew-b/day-plan", params=DATE, headers=bearer()).json()
        # Back to the pre-stop plan (the forecast's own Red hours stay `stopped`), so the sign-off holds again.
        assert resumed_plan["segments"] == plan["segments"]
        assert resumed_plan["signoff_state"] == "signed"

        # --- a refused data request -----------------------------------------------------------------------------
        refused = client.post(
            f"/api/v1/sites/{SITE}/data-requests",
            json={"subject": "worker", "data_class": "health", "worker_ref": WORKER_REF},
            headers=bearer(),
        )
        assert refused.status_code == 403
        assert refused.json()["type"] == "urn:stellar-blaze:problem:individual-data-refused"
        [refusal] = rows(
            settings,
            "SELECT kind, outcome, actor_role, employer_id, site_id, epoch_id, ruleset_id, ruleset_sha256, model_id, "
            "config_version_id, config_sha256, detail FROM audit_event WHERE kind = 'data_request.refused'",
        )
        assert (refusal["outcome"], refusal["actor_role"], refusal["employer_id"], refusal["site_id"]) == (
            "refused",
            "employer",
            "emp-demo",
            SITE,
        )
        assert refusal["epoch_id"] == 1
        assert refusal["ruleset_id"] == "ae-heat-2026.1"
        assert len(refusal["ruleset_sha256"]) == 64
        assert refusal["model_id"] is None  # model-less path: the uncorrected forecast says so
        assert refusal["config_version_id"] == activation["config_version_id"]
        assert len(refusal["config_sha256"]) == 64
        everywhere = refused.text + str(rows(settings, "SELECT * FROM audit_event")) + caplog.text
        assert WORKER_REF not in everywhere
        assert "AliKhan" not in everywhere
        # not a bare `in`: random hex holds "4471" by chance (tests/privacy.py)
        assert not contains_standalone(everywhere, "4471")

        listed = client.get(f"/api/v1/sites/{SITE}/transparency-log").json()["entries"]
        assert [(e["kind"], e["outcome"]) for e in listed] == [("data_request.refused", "refused")]
        assert listed[0]["config_version"] == activation["config_version_id"]

        # --- reset -----------------------------------------------------------------------------------------------
        reset = client.post(f"/api/v1/sites/{SITE}/demo-reset", headers=bearer())
        assert reset.status_code == 200, reset.text
        assert reset.json()["epoch_id"] == 2
        assert client.get(f"/api/v1/sites/{SITE}/transparency-log").json()["entries"] == []
        fresh = client.get("/api/v1/crews/crew-b/day-plan", params=DATE, headers=bearer()).json()
        assert fresh["signoff_state"] == "unsigned"  # the sign-off belonged to epoch 1
        assert fresh["segments"] == plan["segments"]  # no stop of epoch 1 carries over
        fresh_timeline = client.get("/api/v1/crews/crew-b/timeline", params=DATE).json()
        assert fresh_timeline["hours"] == baseline_timeline["hours"]  # the stop's Red is not in epoch 2's timeline
        [second_epoch] = rows(settings, "SELECT started_at FROM site_epoch WHERE epoch_id = 2")
        assert second_epoch["started_at"] == wall.now  # the reset's epoch starts at the real clock: re-anchored

    verified = sb_jobs("audit", "verify")
    assert verified.exit_code == 0, verified.output
    report = last_json(verified)
    assert report["chain"] == "intact"
    assert report["rows"] == report["head_id"] == len(rows(settings, "SELECT id FROM audit_event"))
    kinds = {r["kind"] for r in rows(settings, "SELECT DISTINCT kind FROM audit_event")}
    assert {
        "input.changed",
        "data_request.refused",
        "demo_reset",
        "plan.signed",
        "crew.stop_started",
        "alerts.dispatched",
    } <= kinds
    # The domain rows are on the replay day, the audit rows keep the REAL time (the injected wall clock).
    [signoff_row] = rows(settings, "SELECT signed_at FROM plan_signoff")
    assert signoff_row["signed_at"] == instant(SIGNED_AT)
    audit_at = {r["kind"]: r["at"] for r in rows(settings, "SELECT kind, at FROM audit_event WHERE kind LIKE 'crew.%'")}
    assert audit_at["crew.stop_started"] == stop_wall
    assert audit_at["crew.stop_started"] > started_wall
    [signed_audit] = rows(settings, "SELECT at FROM audit_event WHERE kind = 'plan.signed'")
    assert signed_audit["at"] == started_wall + timedelta(minutes=5)
