import pytest
from sqlalchemy.exc import IntegrityError

from stellar_blaze.config import Settings
from tests.integration.db_admin import check_no_drift, fetch_all, migrate


def table_exists(settings: Settings, name: str) -> bool:
    url = settings.database_url.get_secret_value()
    rows = fetch_all(url, "SELECT to_regclass(:name) IS NOT NULL AS present", {"name": f"public.{name}"})
    return bool(rows[0]["present"])


@pytest.mark.integration
def test_upgrade_downgrade_upgrade(empty_settings: Settings) -> None:
    # Its own empty database: downgrading to base here cannot disturb any other test.
    migrate(empty_settings, "upgrade", "head")
    assert table_exists(empty_settings, "job_run")

    migrate(empty_settings, "downgrade", "base")
    assert not table_exists(empty_settings, "job_run")

    migrate(empty_settings, "upgrade", "head")
    assert table_exists(empty_settings, "job_run")
    check_no_drift(empty_settings)  # `alembic check`: the models and the migrated schema agree


@pytest.mark.integration
def test_job_run_columns_match_the_specification(settings: Settings) -> None:
    url = settings.database_url.get_secret_value()
    rows = fetch_all(
        url,
        "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = 'job_run' ORDER BY ordinal_position",
    )

    assert [(r["column_name"], r["data_type"], r["is_nullable"], r["column_default"]) for r in rows] == [
        ("id", "uuid", "NO", "gen_random_uuid()"),
        ("job_name", "text", "NO", None),
        ("status", "text", "NO", None),
        ("started_at", "timestamp with time zone", "NO", "now()"),
        ("finished_at", "timestamp with time zone", "YES", None),
        ("params", "jsonb", "NO", "'{}'::jsonb"),
        ("summary", "jsonb", "YES", None),
        ("error", "text", "YES", None),
        ("code_version", "text", "YES", None),
    ]


@pytest.mark.integration
def test_job_run_keys_constraints_and_index(settings: Settings) -> None:
    url = settings.database_url.get_secret_value()
    constraints = {
        r["conname"]: r["definition"]
        for r in fetch_all(
            url,
            "SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint "
            "WHERE conrelid = 'public.job_run'::regclass",
        )
    }
    index_rows = fetch_all(url, "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'job_run'")
    indexes = {r["indexname"]: r["indexdef"] for r in index_rows}

    assert constraints["pk_job_run"] == "PRIMARY KEY (id)"
    assert constraints["ck_job_run_status"] == (
        "CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text, 'skipped_locked'::text])))"
    )
    assert indexes["ix_job_run_job_name_started_at"].endswith("USING btree (job_name, started_at DESC)")


@pytest.mark.integration
def test_job_run_rejects_an_unknown_status(settings: Settings) -> None:
    url = settings.database_url.get_secret_value()

    with pytest.raises(IntegrityError, match="ck_job_run_status"):
        fetch_all(url, "INSERT INTO job_run (job_name, status) VALUES ('ingest', 'exploded')")

    fetch_all(url, "INSERT INTO job_run (job_name, status) VALUES ('ingest', 'running')")  # a valid one still works
    assert fetch_all(url, "SELECT count(*) AS n FROM job_run")[0]["n"] == 1
