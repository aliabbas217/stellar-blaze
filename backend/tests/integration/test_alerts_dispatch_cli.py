"""``sb-jobs alerts dispatch`` and ``alerts run`` end to end on Postgres, over the B2 replay fixture (2025-07-10):
the demo site loaded, subscriptions in the active epoch, a recording channel injected through ``composition`` (the
``build_push_channel`` name ``jobs.cli`` looks up), and a crew stop recorded between two runs. The commands run their
own ``asyncio.run``, so these tests are synchronous."""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.adapters.db.engine import build_engine
from stellar_blaze.adapters.db.plans import PostgresCrewStopStore
from stellar_blaze.adapters.db.push import PostgresPushStore
from stellar_blaze.adapters.fakes.notifications import RecordingPushChannel
from stellar_blaze.config import Settings
from stellar_blaze.jobs import cli
from stellar_blaze.ports.push import NewSubscription, PushChannel, PushSubscriptionStore
from tests.fixtures.forecast.replay import SNAPSHOT_ID, build_fixture_snapshot
from tests.integration.b3_app import (
    ACTOR_ARGS,
    DEMO_FIXTURE,
    REPLAY_DATE,
    SITE,
    cli_environment,
    last_json,
    make_workdir,
    rows,
    sb_jobs,
)

pytestmark = pytest.mark.integration

RUN_1 = "2025-07-10T07:10:00Z"  # 11:10 Asia/Dubai, the replay anchor
STOP_AT = datetime(2025, 7, 10, 7, 20, tzinfo=UTC)
RUN_2 = "2025-07-10T07:25:00Z"
ALERTS = "SELECT site_id, crew_id, audience, level, kind, valid_from, delivered, failed, dispatch_interval_minutes, "
ALERTS += "ruleset_id, ruleset_sha256, model_id, config_version_id, config_sha256, epoch_id, template_id "
ALERTS += "FROM alert_event ORDER BY id"


@pytest.fixture
def channel(monkeypatch: pytest.MonkeyPatch) -> RecordingPushChannel:
    """The recording channel ``composition.build_push_channel`` is replaced by (as the supplement's override)."""
    recording = RecordingPushChannel()

    def build(_settings: Settings, _subs: PushSubscriptionStore) -> PushChannel | None:
        return recording

    monkeypatch.setattr(cli, "build_push_channel", build)
    return recording


@pytest.fixture
def loaded(settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    """A migrated database with the demo site, the replay environment, and the settings the commands will read."""
    built = build_fixture_snapshot(tmp_path / "silver")
    cli_environment(monkeypatch, settings, make_workdir(tmp_path))
    monkeypatch.setenv("SB_FORECAST_SOURCE", "replay")
    monkeypatch.setenv("SB_REPLAY_DIR", str(built.directory.parent))
    monkeypatch.setenv("SB_REPLAY_SNAPSHOT_ID", SNAPSHOT_ID)
    monkeypatch.setenv("SB_REPLAY_DEFAULT_DATE", REPLAY_DATE.isoformat())
    assert sb_jobs("db", "upgrade").exit_code == 0
    assert sb_jobs("site", "load", str(DEMO_FIXTURE), *ACTOR_ARGS).exit_code == 0
    return settings


def with_engine[T](settings: Settings, work: Callable[[AsyncEngine], Awaitable[T]]) -> T:
    async def go() -> T:
        engine: AsyncEngine = build_engine(settings)
        try:
            return await work(engine)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def subscribe(settings: Settings, endpoint: str, crew: str | None = None) -> str:
    async def work(engine: AsyncEngine) -> str:
        return await PostgresPushStore(engine).upsert_by_endpoint(
            NewSubscription(endpoint=endpoint, p256dh="k", auth="a", site_id=SITE, crew_id=crew), 1
        )

    return with_engine(settings, work)


def start_stop(settings: Settings, crew: str) -> None:
    async def work(engine: AsyncEngine) -> None:
        await PostgresCrewStopStore(engine, clock=lambda: STOP_AT).start(crew, "heat", "lead-b", 1)

    with_engine(settings, work)


def crew_rows(settings: Settings, crew: str) -> list[dict[str, Any]]:
    return [r for r in rows(settings, ALERTS) if r["crew_id"] == crew]


def test_a_stop_between_two_runs_is_escalated_by_the_next_run_and_the_rows_carry_identity_and_the_interval(
    loaded: Settings, channel: RecordingPushChannel
) -> None:
    site_sub = subscribe(loaded, "https://push.example/site-only")
    crew_sub = subscribe(loaded, "https://push.example/crew-b", crew="crew-b")
    [activation] = rows(loaded, "SELECT config_version_id FROM config_activation ORDER BY id")

    first = sb_jobs("alerts", "dispatch", "--site", SITE, "--as-of", RUN_1)

    assert first.exit_code == 0, first.output
    summary = last_json(first)
    assert summary["push"] == "configured"
    assert summary["interval_minutes"] == 5
    assert summary["config_version"] == activation["config_version_id"]
    after_first = rows(loaded, ALERTS)
    assert after_first
    assert summary["events_created"] == len(after_first)
    assert {r["site_id"] for r in after_first} == {SITE}
    assert {r["crew_id"] for r in after_first if r["audience"] == "site"} == {None}
    crew_b_first = crew_rows(loaded, "crew-b")
    # the replay day is orange from 07:00Z and turns red from 10:00Z: both are announced at the first run
    assert [(r["level"], r["valid_from"].hour) for r in crew_b_first] == [("orange", 7), ("red", 10)]
    # a site event reaches both subscriptions of the site, a crew event only the crew's
    site_events = [r for r in after_first if r["audience"] == "site"]
    assert {r["delivered"] for r in site_events} == {2}
    assert {r["delivered"] for r in crew_rows(loaded, "crew-b")} == {1}
    assert {r["delivered"] for r in crew_rows(loaded, "crew-a")} == {0}  # nobody subscribed to crew-a
    assert {sid for sid, m in channel.sent if m.crew_id == "crew-b"} == {crew_sub}
    assert site_sub in {sid for sid, m in channel.sent if m.crew_id is None}

    start_stop(loaded, "crew-b")  # recorded between the two runs
    second = sb_jobs("alerts", "dispatch", "--site", SITE, "--as-of", RUN_2)

    assert second.exit_code == 0, second.output
    assert last_json(second)["events_created"] == 1  # exactly one new event: crew-b's red NOW, no one else's
    crew_b = crew_rows(loaded, "crew-b")
    assert len(crew_b) == 3  # orange, red from 10:00Z, and now the stop: red from the hour it started in
    red = crew_b[-1]
    assert (red["level"], red["kind"], red["audience"], red["template_id"]) == (
        "red",
        "escalate",
        "crew",
        "level-change",
    )
    assert red["valid_from"] == datetime(2025, 7, 10, 7, tzinfo=UTC)  # the hour of the stop: no dwell, no sign-off
    assert red["delivered"] == 1
    assert [m.level.value for sid, m in channel.sent if sid == crew_sub][-1] == "red"

    third = sb_jobs("alerts", "dispatch", "--site", SITE, "--as-of", "2025-07-10T07:30:00Z")
    assert last_json(third)["events_created"] == 0  # nothing new: dedupe and the last-event comparison

    for row in rows(loaded, ALERTS):
        assert row["config_version_id"] == activation["config_version_id"]
        assert row["ruleset_id"] == "ae-heat-2026.1"
        assert len(row["ruleset_sha256"]) == len(row["config_sha256"]) == 64
        assert row["model_id"] is None  # the model-less path says so
        assert row["dispatch_interval_minutes"] == 5
        assert row["epoch_id"] == 1
    audited = rows(
        loaded,
        "SELECT detail, site_id, epoch_id, config_version_id, ruleset_id, model_id FROM audit_event "
        "WHERE kind = 'alerts.dispatched' ORDER BY id",
    )
    assert len(audited) == 2  # one per run that created something; the run that created nothing is only a job_run
    assert [a["detail"]["events_created"] for a in audited] == [summary["events_created"], 1]
    assert {a["detail"]["interval_minutes"] for a in audited} == {5}
    assert {(a["site_id"], a["epoch_id"], a["config_version_id"]) for a in audited} == {
        (SITE, 1, activation["config_version_id"])
    }
    jobs = rows(loaded, "SELECT job_name, status FROM job_run WHERE job_name = 'alerts-dispatch' ORDER BY id")
    assert [j["status"] for j in jobs] == ["succeeded"] * 3

    verified = sb_jobs("audit", "verify")
    assert verified.exit_code == 0, verified.output
    assert last_json(verified)["chain"] == "intact"


def test_without_vapid_settings_events_are_recorded_and_nothing_is_sent(
    loaded: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    subscribe(loaded, "https://push.example/site-only")

    result = sb_jobs("alerts", "dispatch", "--site", SITE, "--as-of", RUN_1)  # the real build_push_channel: no key

    assert result.exit_code == 0, result.output
    assert "push not configured" in result.stderr
    summary = last_json(result)
    assert summary["push"] == "not configured"
    assert summary["events_created"] > 0
    assert summary["delivered"] == 0
    assert {(r["delivered"], r["failed"]) for r in rows(loaded, ALERTS)} == {(0, 0)}
    [audited] = rows(loaded, "SELECT detail FROM audit_event WHERE kind = 'alerts.dispatched'")
    assert audited["detail"]["push_configured"] is False


def test_an_unknown_site_fails_the_job_and_a_bad_as_of_is_a_usage_error(
    loaded: Settings, channel: RecordingPushChannel
) -> None:
    unknown = sb_jobs("alerts", "dispatch", "--site", "site-nowhere", "--as-of", RUN_1)
    naive = sb_jobs("alerts", "dispatch", "--as-of", "2025-07-10T07:10:00")

    assert unknown.exit_code == 1
    assert naive.exit_code == 2
    assert rows(loaded, "SELECT status FROM job_run WHERE job_name = 'alerts-dispatch'") == [{"status": "failed"}]
    assert rows(loaded, ALERTS) == []


def test_the_loop_waits_the_interval_of_the_active_config_read_again_every_cycle(
    loaded: Settings, channel: RecordingPushChannel, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    proposal = tmp_path / "interval-2.toml"
    proposal.write_text(
        "schema_version = 1\n[tunables]\nalert_dispatch_interval_minutes = 2\n[flags]\n", encoding="utf-8"
    )
    proposed = sb_jobs("config", "propose", str(proposal), "--actor", "ali", "--reason", "tighten the cadence to 2 min")
    assert proposed.exit_code == 0, proposed.output
    new_version = str(last_json(proposed)["version_id"])
    waits: list[float] = []

    async def sleeper(seconds: float, stop: asyncio.Event) -> None:
        waits.append(seconds)
        if len(waits) == 1:  # between cycle 1 and cycle 2 an operator activates the tighter cadence
            activated = await asyncio.to_thread(
                sb_jobs, "config", "activate", new_version, "--actor", "ali", "--reason", "tighten the cadence"
            )
            assert activated.exit_code == 0, activated.output
        else:
            stop.set()  # the process is told to stop: it ends after the current run

    monkeypatch.setattr(cli, "alerts_sleeper", sleeper)
    monkeypatch.setattr(
        cli, "alerts_clock", lambda: 0.0
    )  # a frozen clock: a run "takes" no time, the wait is the period

    result = sb_jobs("alerts", "run", "--site", SITE)

    assert result.exit_code == 0, result.output
    assert waits == [300.0, 120.0]  # 5 minutes under the first config, 2 under the activated one
    runs = rows(loaded, "SELECT status FROM job_run WHERE job_name = 'alerts-dispatch' ORDER BY id")
    assert [r["status"] for r in runs] == ["succeeded", "succeeded"]
    intervals = rows(
        loaded,
        "SELECT detail->>'interval_minutes' AS minutes FROM audit_event WHERE kind = 'alerts.dispatched' ORDER BY id",
    )
    # Only a run that created or sent something is audited (job_run is the heartbeat): the second cycle changed nothing.
    assert [i["minutes"] for i in intervals] == ["5"]
    assert channel.closed  # the process released its channel on the way out
