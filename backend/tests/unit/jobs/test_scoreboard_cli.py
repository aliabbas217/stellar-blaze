"""``sb-jobs scoreboard dev`` and ``sb-jobs export roster-frontier`` (synthetic OOF; the roster source is committed)."""

import hashlib
import json
from pathlib import Path
from typing import Final

import pytest
from typer.testing import CliRunner, Result

from stellar_blaze.domain.scoreboard import DemoDay, PlanScoreboard, PolicyScoreboard
from stellar_blaze.jobs.cli import app
from stellar_blaze.jobs.roster_export import GUARD, RosterExportError, render_roster_frontier
from tests.fixtures.scoreboard.oof import Hour, oof_frame, utc
from tests.unit.rules.support import RULESETS_DIR

pytestmark = pytest.mark.unit

REPO: Final = Path(__file__).resolve().parents[4]
ROSTER_SOURCE: Final = REPO / "docs" / "research" / "scripts" / "roster" / "results" / "roster_frontier.json"


def source_bytes() -> bytes:
    return ROSTER_SOURCE.read_bytes().replace(b"\r\n", b"\n")


# === the roster-frontier export =====================================================================================


def test_roster_export_is_byte_identical_data() -> None:
    source = source_bytes()

    exported = render_roster_frontier(ROSTER_SOURCE.read_bytes(), source="docs/research/scripts/roster/x.json")

    # The data member is the source's own bytes (LF line ends), embedded unchanged; the export is one JSON document.
    assert exported.startswith(b'{"data":' + source.strip() + b',"provenance":')
    document = json.loads(exported)
    assert document["data"] == json.loads(source)
    provenance = document["provenance"]
    assert provenance["script"] == json.loads(source)["generated_by"]
    assert provenance["source_sha256"] == hashlib.sha256(source.strip() + b"\n").hexdigest()
    assert provenance["run_date"] is None
    assert "no run date" in provenance["run_date_note"]
    assert provenance["guard"] == f"{GUARD}: asserted"
    assert render_roster_frontier(source, source="docs/research/scripts/roster/x.json") == exported  # CRLF-independent


def test_the_roster_export_records_a_given_run_date_and_refuses_a_bad_one() -> None:
    exported = render_roster_frontier(source_bytes(), source="s.json", run_date="2026-11-11")
    assert json.loads(exported)["provenance"]["run_date"] == "2026-11-11"
    with pytest.raises(RosterExportError, match="YYYY-MM-DD"):
        render_roster_frontier(source_bytes(), source="s.json", run_date="11 Nov")


def test_the_guard_refuses_a_frontier_that_recommends_a_change_at_45_minutes() -> None:
    document = json.loads(source_bytes())
    row = next(r for r in document["frontier_absolute_gate"] if r["commute_min"] == 45)
    row["avoided_vs_legal_default_ge30"] = 0.01
    with pytest.raises(RosterExportError, match="the guard fails"):
        render_roster_frontier(json.dumps(document).encode(), source="s.json")

    document = json.loads(source_bytes())
    document["assumptions"]["bedtime_floor"] = "22:00"
    with pytest.raises(RosterExportError, match="floor 21:30"):
        render_roster_frontier(json.dumps(document).encode(), source="s.json")
    with pytest.raises(RosterExportError, match="not JSON"):
        render_roster_frontier(b"not json", source="s.json")


def test_the_export_command_writes_the_file_and_refuses_a_failed_guard(tmp_path: Path) -> None:
    out = tmp_path / "static" / "roster_frontier.json"
    ok = CliRunner().invoke(app, ["export", "roster-frontier", "--src", str(ROSTER_SOURCE), "--out", str(out)])
    assert ok.exit_code == 0, ok.output
    assert out.read_bytes() == render_roster_frontier(source_bytes(), source=ROSTER_SOURCE.as_posix())

    bad = tmp_path / "bad.json"
    document = json.loads(source_bytes())
    document["assumptions"]["bedtime_floor"] = "22:00"
    bad.write_text(json.dumps(document), encoding="utf-8")
    refused = CliRunner().invoke(
        app, ["export", "roster-frontier", "--src", str(bad), "--out", str(tmp_path / "no.json")]
    )
    assert refused.exit_code == 2
    assert not (tmp_path / "no.json").exists()


# === the dev scoreboards ============================================================================================


def synthetic_oof(*, year: int = 2025) -> list[Hour]:
    """Twelve days of 20-31 May, UTC hours 06-14: truth High at 07-09 UTC on even days (P(High) 0.9; 0.1 elsewhere)."""
    hours = []
    for day in range(12):
        for hour in range(6, 15):
            high = day % 2 == 0 and 7 <= hour <= 9
            hours.append(Hour(utc(year, 5, 20 + day, hour), 45 if high else 5, "high" if high else "low", summer=year))
    return hours


@pytest.fixture
def environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SB_DATABASE_URL", "postgresql+asyncpg://sb:hunter2@localhost:5432/stellar_blaze")
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.setenv("SB_RULESETS_DIR", str(RULESETS_DIR))
    return tmp_path


def run(*arguments: str) -> Result:
    return CliRunner().invoke(app, list(arguments))


def prepare(directory: Path, hours: list[Hour]) -> tuple[Path, Path]:
    oof = directory / "oof.parquet"
    oof_frame(hours).write_parquet(oof)
    theta = directory / "theta.json"
    assert run("freeze", "theta", "--oof", str(oof), "--out", str(theta)).exit_code == 0
    return oof, theta


def test_scoreboard_dev_writes_the_three_labelled_files(environment: Path) -> None:
    oof, theta = prepare(environment, synthetic_oof())
    out = environment / "dev"

    result = run("scoreboard", "dev", "--summer", "2025", "--oof", str(oof), "--theta", str(theta), "--out", str(out))

    assert result.exit_code == 0, result.output
    summary = json.loads(result.stdout.strip().splitlines()[-1])
    assert summary["seconds"] >= 0
    assert set(summary["files"]) == {
        "policy_scoreboard.2025.json",
        "plan_scoreboard.2025.json",
        "demo_day.2025.json",
    }
    label = "DEV 2025, LOCO out-of-fold: not the result"
    policy = PolicyScoreboard.model_validate_json((out / "policy_scoreboard.2025.json").read_bytes())
    plans = PlanScoreboard.model_validate_json((out / "plan_scoreboard.2025.json").read_bytes())
    demo = DemoDay.model_validate_json((out / "demo_day.2025.json").read_bytes())
    for artifact in (policy, plans, demo):
        assert artifact.evaluation_set == "dev_2025"
        assert artifact.evaluation_label == label
        assert artifact.station == "OMAA"
    # Lead 1 is scored; leads 2, 3, 5 and 7 are listed as not available in the dev export (no number is invented).
    assert [lead.lead_days for lead in policy.leads] == [1, 2, 3, 5, 7]
    assert policy.leads[0].rows
    assert all(not lead.rows for lead in policy.leads[1:])
    assert all("not available in the dev export" in lead.label for lead in policy.leads[1:])
    # The demo day is the first of the tied days (every even day has the same 3 High hours): 20 May.
    assert demo.date.isoformat() == "2025-05-20"
    assert demo.score == 3.0
    assert len(demo.hours) == 9
    assert plans.identical_by_construction == ["naive", "ban_only"]
    assert "10:00-11:00 + 15:00-18:00" in plans.roster
    assert plans.provenance.label.value == "REAL weather + assumed crew"


def test_scoreboard_dev_refuses_2026_rows_and_other_summers_and_writes_nothing(environment: Path) -> None:
    oof, theta = prepare(environment, synthetic_oof())
    holdout = environment / "holdout.parquet"
    oof_frame([*synthetic_oof(), Hour(utc(2026, 6, 1, 8), 0, "low")]).write_parquet(holdout)
    out = environment / "dev"

    refused = run(
        "scoreboard", "dev", "--summer", "2025", "--oof", str(holdout), "--theta", str(theta), "--out", str(out)
    )
    other = run("scoreboard", "dev", "--summer", "2024", "--oof", str(oof), "--theta", str(theta), "--out", str(out))

    assert refused.exit_code == 2
    assert other.exit_code == 2
    assert not out.exists()
