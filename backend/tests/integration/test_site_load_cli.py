"""``sb-jobs site load`` and ``sb-jobs audit verify`` end to end against a real Postgres. The commands run
``asyncio.run`` themselves, so these tests are synchronous."""

import json
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner, Result

from stellar_blaze.config import Settings
from stellar_blaze.jobs import cli
from tests.integration.db_admin import fetch_all
from tests.unit.contract.b3_world import FIXTURE_PATH

pytestmark = pytest.mark.integration

ARGS = ("--actor", "ali", "--reason", "load the demo site")


@pytest.fixture(autouse=True)
def environment(monkeypatch: pytest.MonkeyPatch, settings: Settings, tmp_path: Path) -> None:
    monkeypatch.setenv("SB_DATABASE_URL", settings.database_url.get_secret_value())
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.chdir(tmp_path)  # a developer's backend/.env is not read


def invoke(*args: str) -> Result:
    return CliRunner().invoke(cli.app, list(args))


def last_json(result: Result) -> dict[str, Any]:
    parsed: dict[str, Any] = json.loads(result.stdout.strip().splitlines()[-1])
    return parsed


def rows(settings: Settings, sql: str) -> list[dict[str, Any]]:
    return fetch_all(settings.database_url.get_secret_value(), sql)


def changed(settings: Settings) -> list[dict[str, Any]]:
    return rows(settings, "SELECT detail, actor, actor_role, site_id, employer_id FROM audit_event ORDER BY id")


def edited(tmp_path: Path, old: str, new: str) -> Path:
    path = tmp_path / "edited.toml"
    path.write_text(FIXTURE_PATH.read_text(encoding="ascii").replace(old, new, 1), encoding="ascii", newline="\n")
    return path


def test_site_load_is_idempotent_and_audited(settings: Settings) -> None:
    first = invoke("site", "load", str(FIXTURE_PATH), *ARGS)
    second = invoke("site", "load", str(FIXTURE_PATH), "--actor", "bob", "--reason", "load it a second time")

    assert first.exit_code == 0, first.output
    assert last_json(first) == {"site_id": "site-demo-mussafah", "created": True, "changes": 5}
    assert second.exit_code == 0, second.output
    assert last_json(second) == {"site_id": "site-demo-mussafah", "created": False, "changes": 0}
    assert [r["detail"]["field"] for r in changed(settings)] == ["created"] * 5  # the site and its four crews
    assert {r["actor"] for r in changed(settings)} == {"ali"}
    (counts,) = rows(
        settings,
        "SELECT (SELECT count(*) FROM crew) AS crews, (SELECT count(*) FROM crew_member) AS members, "
        "(SELECT count(*) FROM site_epoch) AS epochs",
    )
    assert counts == {"crews": 4, "members": 45, "epochs": 1}  # 12 + 20 + 9 + 4; epoch 1 only


def test_a_changed_field_writes_one_input_changed_row_and_member_changes_are_counts_only(
    settings: Settings, tmp_path: Path
) -> None:
    invoke("site", "load", str(FIXTURE_PATH), *ARGS)
    before = len(changed(settings))
    text = FIXTURE_PATH.read_text(encoding="ascii")
    # crew-a: a new task label and one fewer new member (12 -> 11); the site's supervisor number is replaced.
    new = text.replace('task_label = "Rebar fixing"', 'task_label = "Rebar and mesh"')
    new = new.replace("headcount = 12", "headcount = 11").replace(
        "{ count = 2, days_on_site = 2", "{ count = 1, days_on_site = 2"
    )
    new = new.replace("+12025550143", "+12025550199")
    path = tmp_path / "edited.toml"
    path.write_text(new, encoding="ascii", newline="\n")

    result = invoke("site", "load", str(path), "--actor", "ali", "--reason", "adjust crew a and the contact")

    assert result.exit_code == 0, result.output
    assert last_json(result) == {"site_id": "site-demo-mussafah", "created": False, "changes": 3}
    new_rows = changed(settings)[before:]
    by_field = {r["detail"]["field"]: r["detail"] for r in new_rows}
    assert set(by_field) == {"task_label", "members", "supervisor_phone"}
    assert by_field["task_label"]["before"] == "Rebar fixing"
    assert by_field["task_label"]["after"] == "Rebar and mesh"
    assert by_field["members"]["headcount_before"] == 12
    assert by_field["members"]["headcount_after"] == 11
    assert by_field["members"]["rows_changed"] == 1
    assert by_field["supervisor_phone"]["before"] == "set"
    assert by_field["supervisor_phone"]["after"] == "set"
    assert "+1202" not in json.dumps([r["detail"] for r in new_rows])  # no phone number in the audit log
    assert all(r["site_id"] == "site-demo-mussafah" and r["employer_id"] == "emp-demo" for r in new_rows)
    # No per-member value anywhere in the audit rows.
    assert "days_on_site" not in json.dumps([r["detail"] for r in changed(settings)])
    verified = invoke("audit", "verify")
    assert verified.exit_code == 0
    assert last_json(verified) == {"chain": "intact"}


CREW_A_SHIFT = 'shift = [{ start = "06:00", end = "11:00" }, { start = "15:00", end = "18:00" }]'
BAD_MEMBER = 'days_away = 0, away_reason = "none", experienced = false'


@pytest.mark.parametrize(
    ("old", "new", "message"),
    [
        (CREW_A_SHIFT, 'shift = [{ start = "03:00", end = "11:00" }]', "must be sorted and must not overlap"),
        (CREW_A_SHIFT, 'shift = [{ start = "06:00", end = "23:00" }]', "ends after 22:00"),
        (CREW_A_SHIFT, 'shift = [{ start = "11:00", end = "06:00" }]', "must start before it ends"),
        (
            CREW_A_SHIFT,
            'shift = [{ start = "15:00", end = "18:00" }, { start = "06:00", end = "11:00" }]',
            "must be sorted and must not overlap",
        ),
        (
            CREW_A_SHIFT,
            'shift = [{ start = "06:00", end = "12:00" }, { start = "11:00", end = "18:00" }]',
            "must be sorted and must not overlap",
        ),
        (CREW_A_SHIFT, "shift = []", "no shift block"),
        ("headcount = 12", "headcount = 13", "headcount is 13 but 12 members"),
        (BAD_MEMBER, 'days_away = 3, away_reason = "none", experienced = false', "away_reason"),
    ],
)
def test_site_load_refuses_input_the_planner_would_raise_on(
    settings: Settings, tmp_path: Path, old: str, new: str, message: str
) -> None:
    path = edited(tmp_path, old, new)

    result = invoke("site", "load", str(path), *ARGS)

    assert result.exit_code == 1
    assert message in result.output
    assert rows(settings, "SELECT count(*) AS n FROM site") == [{"n": 0}]  # nothing was written
    assert rows(settings, "SELECT count(*) AS n FROM audit_event") == [{"n": 0}]


def test_site_load_usage_errors(settings: Settings, tmp_path: Path) -> None:
    assert invoke("site", "load", str(FIXTURE_PATH), "--actor", " ", "--reason", "load the demo site").exit_code == 2
    assert invoke("site", "load", str(FIXTURE_PATH), "--actor", "ali", "--reason", "short").exit_code == 2
    assert invoke("site", "load", str(tmp_path / "missing.toml"), *ARGS).exit_code == 2
    assert rows(settings, "SELECT count(*) AS n FROM audit_event") == [{"n": 0}]


def test_audit_verify_is_clean_then_names_the_first_broken_row(settings: Settings) -> None:
    invoke("site", "load", str(FIXTURE_PATH), *ARGS)
    assert invoke("audit", "verify").exit_code == 0

    fetch_all(settings.database_url.get_secret_value(), "DROP TRIGGER trg_audit_event_append_only ON audit_event")
    fetch_all(settings.database_url.get_secret_value(), "UPDATE audit_event SET outcome = 'forged' WHERE id = 3")
    result = invoke("audit", "verify")

    assert result.exit_code == 1
    assert "audit.chain_broken id=3" in result.output
