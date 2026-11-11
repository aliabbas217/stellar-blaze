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

    marker = re.search(r"^-- Running (upgrade|downgrade) .*\n", sql, flags=re.MULTILINE)
    assert marker is not None
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
