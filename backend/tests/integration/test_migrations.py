from typing import Any

import pytest
from sqlalchemy.exc import IntegrityError

from stellar_blaze.config import Settings
from tests.integration.db_admin import check_no_drift, fetch_all, migrate


def table_exists(settings: Settings, name: str) -> bool:
    url = settings.database_url.get_secret_value()
    rows = fetch_all(url, "SELECT to_regclass(:name) IS NOT NULL AS present", {"name": f"public.{name}"})
    return bool(rows[0]["present"])


def function_exists(settings: Settings, name: str) -> bool:
    url = settings.database_url.get_secret_value()
    rows = fetch_all(url, "SELECT count(*) AS n FROM pg_proc WHERE proname = :name", {"name": name})
    return bool(rows[0]["n"])


def trigger_names(settings: Settings) -> list[str]:
    url = settings.database_url.get_secret_value()
    rows = fetch_all(url, "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname")
    return [r["tgname"] for r in rows]


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
def test_0002_up_down_up_is_clean_and_leaves_no_drift(empty_settings: Settings) -> None:
    config_objects = ("config_version", "config_activation")
    migrate(empty_settings, "upgrade", "0001")
    assert not any(table_exists(empty_settings, t) for t in config_objects)

    migrate(empty_settings, "upgrade", "0002")
    assert all(table_exists(empty_settings, t) for t in config_objects)
    assert function_exists(empty_settings, "sb_reject_mutation")
    assert len(trigger_names(empty_settings)) == 4
    check_no_drift(empty_settings)

    migrate(empty_settings, "downgrade", "0001")  # drops the triggers, the function and both tables, nothing else
    assert not any(table_exists(empty_settings, t) for t in config_objects)
    assert not function_exists(empty_settings, "sb_reject_mutation")
    assert trigger_names(empty_settings) == []
    assert table_exists(empty_settings, "job_run")

    migrate(empty_settings, "upgrade", "head")
    assert all(table_exists(empty_settings, t) for t in config_objects)
    assert len(trigger_names(empty_settings)) == 4
    check_no_drift(empty_settings)


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


@pytest.mark.integration
def test_config_tables_match_the_specification(settings: Settings) -> None:
    url = settings.database_url.get_secret_value()

    def columns(table: str) -> list[tuple[Any, ...]]:
        rows = fetch_all(
            url,
            "SELECT column_name, data_type, is_nullable, column_default, is_identity, identity_generation "
            "FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :table "
            "ORDER BY ordinal_position",
            {"table": table},
        )
        return [
            (
                r["column_name"],
                r["data_type"],
                r["is_nullable"],
                r["column_default"],
                r["is_identity"],
                r["identity_generation"],
            )
            for r in rows
        ]

    assert columns("config_version") == [
        ("id", "bigint", "NO", None, "YES", "ALWAYS"),
        ("sha256", "text", "NO", None, "NO", None),
        ("body", "jsonb", "NO", None, "NO", None),
        ("schema_version", "bigint", "NO", None, "NO", None),
        ("created_by", "text", "NO", None, "NO", None),
        ("reason", "text", "NO", None, "NO", None),
        ("created_at", "timestamp with time zone", "NO", "now()", "NO", None),
    ]
    assert columns("config_activation") == [
        ("id", "bigint", "NO", None, "YES", "ALWAYS"),
        ("config_version_id", "bigint", "NO", None, "NO", None),
        ("kind", "text", "NO", None, "NO", None),
        ("actor", "text", "NO", None, "NO", None),
        ("reason", "text", "NO", None, "NO", None),
        ("previous_activation_id", "bigint", "YES", None, "NO", None),
        ("activated_at", "timestamp with time zone", "NO", "now()", "NO", None),
    ]


@pytest.mark.integration
def test_config_constraints_match_the_specification(settings: Settings) -> None:
    url = settings.database_url.get_secret_value()

    def constraints(table: str) -> dict[str, str]:
        rows = fetch_all(
            url,
            "SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint "
            "WHERE conrelid = CAST(:table AS regclass) AND contype <> 'n'",  # PostgreSQL 18 lists NOT NULL as 'n'
            {"table": f"public.{table}"},
        )
        return {r["conname"]: r["definition"] for r in rows}

    version = constraints("config_version")
    assert version["pk_config_version"] == "PRIMARY KEY (id)"
    assert version["uq_config_version_sha256"] == "UNIQUE (sha256)"
    assert version["ck_config_version_created_by_not_blank"] == "CHECK ((length(btrim(created_by)) > 0))"
    assert version["ck_config_version_reason_length"] == (
        "CHECK (((length(btrim(reason)) >= 10) AND (length(btrim(reason)) <= 500)))"
    )
    assert set(version) == {
        "pk_config_version",
        "uq_config_version_sha256",
        "ck_config_version_created_by_not_blank",
        "ck_config_version_reason_length",
        "ck_config_version_sha256_format",
        "ck_config_version_schema_version_positive",
        "ck_config_version_body_is_object",
    }

    activation = constraints("config_activation")
    assert activation["pk_config_activation"] == "PRIMARY KEY (id)"
    assert activation["uq_config_activation_previous_activation_id"] == (
        "UNIQUE NULLS NOT DISTINCT (previous_activation_id)"
    )
    assert activation["fk_config_activation_config_version_id_config_version"] == (
        "FOREIGN KEY (config_version_id) REFERENCES config_version(id)"
    )
    assert activation["fk_config_activation_previous_activation_id_config_activation"] == (
        "FOREIGN KEY (previous_activation_id) REFERENCES config_activation(id)"
    )
    assert activation["ck_config_activation_kind"] == (
        "CHECK ((kind = ANY (ARRAY['seed'::text, 'activate'::text, 'rollback'::text])))"
    )
    assert set(activation) == {
        "pk_config_activation",
        "uq_config_activation_previous_activation_id",
        "fk_config_activation_config_version_id_config_version",
        "fk_config_activation_previous_activation_id_config_activation",
        "ck_config_activation_kind",
        "ck_config_activation_actor_not_blank",
        "ck_config_activation_reason_length",
    }


@pytest.mark.integration
def test_both_config_tables_reject_mutation_with_one_function_and_two_triggers_each(settings: Settings) -> None:
    url = settings.database_url.get_secret_value()
    rows = fetch_all(
        url,
        "SELECT c.relname AS tbl, t.tgname AS trigger, pg_get_triggerdef(t.oid) AS definition "
        "FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal ORDER BY c.relname, t.tgname",
    )

    assert [(r["tbl"], r["trigger"]) for r in rows] == [
        ("config_activation", "trg_config_activation_append_only"),
        ("config_activation", "trg_config_activation_no_truncate"),
        ("config_version", "trg_config_version_append_only"),
        ("config_version", "trg_config_version_no_truncate"),
    ]
    for r in rows:
        assert "EXECUTE FUNCTION sb_reject_mutation()" in r["definition"]
        if r["trigger"].endswith("append_only"):
            assert "BEFORE DELETE OR UPDATE" in r["definition"]
            assert "FOR EACH ROW" in r["definition"]
        else:
            assert "BEFORE TRUNCATE" in r["definition"]
            assert "FOR EACH STATEMENT" in r["definition"]
