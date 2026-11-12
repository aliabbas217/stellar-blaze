"""``alembic upgrade --sql`` renders the migrations without a database (this is what Squawk lints in CI)."""

import io
import os
import re
import subprocess
import sys

import pytest
from alembic import command

from stellar_blaze.config import Settings
from tests.alembic_support import BACKEND_DIR, alembic_config


def render(settings: Settings, direction: str) -> str:
    config = alembic_config(settings)
    config.output_buffer = io.StringIO()
    if direction == "upgrade":
        command.upgrade(config, "head", sql=True)
    else:
        command.downgrade(config, "head:base", sql=True)
    return config.output_buffer.getvalue()


@pytest.mark.unit
@pytest.mark.parametrize("direction", ["upgrade", "downgrade"])
def test_every_migration_direction_sets_timeouts_before_its_first_statement(settings: Settings, direction: str) -> None:
    sql = render(settings, direction)

    # One "-- Running ..." marker per migration, and each one is followed by the two SET lines (Squawk checks the
    # first; the template's contract is that every migration starts with them).
    markers = list(re.finditer(r"^-- Running (upgrade|downgrade) .*\n", sql, flags=re.MULTILINE))
    assert len(markers) == 2
    for marker in markers:
        assert sql[marker.end() :].startswith("\nSET lock_timeout = '3s';\n\nSET statement_timeout = '15s';\n")


@pytest.mark.unit
def test_upgrade_sql_creates_job_run_and_its_index(settings: Settings) -> None:
    sql = render(settings, "upgrade")

    assert "CREATE TABLE job_run" in sql
    assert "CREATE INDEX ix_job_run_job_name_started_at ON job_run (job_name, started_at DESC)" in sql
    assert "INSERT INTO alembic_version (version_num) VALUES ('0001')" in sql


@pytest.mark.unit
def test_cli_prints_nothing_but_sql_on_stdout() -> None:
    # The real command line, as CI runs it before `squawk`: `alembic upgrade head --sql > migration.sql`. The URL comes
    # from SB_DATABASE_URL (Settings), and Alembic's log lines must stay on stderr, never in the SQL file.
    environment = {**os.environ, "SB_DATABASE_URL": "postgresql+asyncpg://x:x@localhost/x", "SB_LOG_FORMAT": "json"}

    completed = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head", "--sql"],
        cwd=BACKEND_DIR,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )

    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.startswith("BEGIN;")
    assert completed.stdout.rstrip().endswith("COMMIT;")
    assert "[alembic" not in completed.stdout
    assert "Running upgrade" in completed.stderr


@pytest.mark.unit
def test_upgrade_sql_creates_the_config_tables_the_append_only_function_and_the_triggers(settings: Settings) -> None:
    sql = render(settings, "upgrade")

    assert "-- Running upgrade 0001 -> 0002" in sql
    assert "CREATE TABLE config_version (" in sql
    assert "CREATE TABLE config_activation (" in sql
    assert "UNIQUE NULLS NOT DISTINCT (previous_activation_id)" in sql
    assert "GENERATED ALWAYS AS IDENTITY" in sql
    assert "CREATE FUNCTION sb_reject_mutation() RETURNS trigger" in sql
    for table in ("config_version", "config_activation"):
        assert f"CREATE TRIGGER trg_{table}_append_only BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW" in sql
        assert f"CREATE TRIGGER trg_{table}_no_truncate BEFORE TRUNCATE ON {table} FOR EACH STATEMENT" in sql
    assert "UPDATE alembic_version SET version_num='0002' WHERE alembic_version.version_num = '0001'" in sql


@pytest.mark.unit
def test_downgrade_sql_drops_the_triggers_the_function_and_the_tables_in_dependency_order(settings: Settings) -> None:
    sql = render(settings, "downgrade")

    order = [
        sql.index("DROP TRIGGER trg_config_activation_no_truncate"),
        sql.index("DROP TRIGGER trg_config_activation_append_only"),
        sql.index("DROP TRIGGER trg_config_version_no_truncate"),
        sql.index("DROP TRIGGER trg_config_version_append_only"),
        sql.index("DROP FUNCTION sb_reject_mutation()"),
        sql.index("DROP TABLE config_activation"),
        sql.index("DROP TABLE config_version"),
    ]
    assert order == sorted(order)
    assert sql.index("DROP TABLE config_version") < sql.index("DROP TABLE job_run")  # 0002 is undone before 0001
