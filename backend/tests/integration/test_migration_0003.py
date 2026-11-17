"""Migration 0003 (B3 tables): up, down, up with no drift, the append-only triggers, and the column facts the ports use
(the CHECKs, the per-epoch uniqueness, the foreign keys). Squawk lints the rendered SQL (``alembic upgrade head --sql``;
the command is in the Task 7 report), and ``test_migrations_offline`` renders it."""

import pytest

from stellar_blaze.config import Settings
from tests.integration.db_admin import check_no_drift, fetch_all, migrate
from tests.integration.test_migrations import function_exists, table_exists, trigger_names

pytestmark = pytest.mark.integration

B3_TABLES = (
    "site",
    "site_epoch",
    "crew",
    "crew_member",
    "push_subscription",
    "alert_event",
    "day_plan",
    "crew_stop",
    "plan_signoff",
    "audit_event",
)
APPEND_ONLY = ("site_epoch", "alert_event", "day_plan", "plan_signoff", "audit_event")


def b3_triggers(settings: Settings) -> list[str]:
    return [name for name in trigger_names(settings) if not name.startswith("trg_config_")]


def test_0003_up_down_up_is_clean_and_leaves_no_drift(empty_settings: Settings) -> None:
    migrate(empty_settings, "upgrade", "0002")
    assert not any(table_exists(empty_settings, t) for t in B3_TABLES)

    migrate(empty_settings, "upgrade", "0003")
    assert all(table_exists(empty_settings, t) for t in B3_TABLES)
    assert sorted(b3_triggers(empty_settings)) == sorted(
        [f"trg_{t}_{kind}" for t in APPEND_ONLY for kind in ("append_only", "no_truncate")]
        + [f"trg_crew_stop_{kind}" for kind in ("clear_once", "no_delete", "no_truncate")]
    )
    check_no_drift(empty_settings)

    migrate(
        empty_settings, "downgrade", "0002"
    )  # drops the 13 triggers, the guard function and the ten tables, nothing of 0002
    assert not any(table_exists(empty_settings, t) for t in B3_TABLES)
    assert b3_triggers(empty_settings) == []
    assert function_exists(empty_settings, "sb_reject_mutation")
    assert not function_exists(empty_settings, "sb_crew_stop_guard")
    assert table_exists(empty_settings, "config_version")
    assert table_exists(empty_settings, "job_run")

    migrate(empty_settings, "upgrade", "head")
    assert all(table_exists(empty_settings, t) for t in B3_TABLES)
    check_no_drift(empty_settings)


def test_epoch_scoped_tables_reference_site_epoch_and_decisions_reference_config_version(settings: Settings) -> None:
    url = settings.database_url.get_secret_value()
    foreign_keys = {
        (r["table_name"], r["column_name"], r["foreign_table"])
        for r in fetch_all(
            url,
            "SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name, "
            "c.confrelid::regclass::text AS foreign_table FROM pg_constraint c "
            "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) WHERE c.contype = 'f'",
        )
    }

    for table in ("day_plan", "crew_stop", "alert_event", "push_subscription", "plan_signoff"):
        assert (table, "epoch_id", "site_epoch") in foreign_keys
    for table in ("day_plan", "alert_event", "plan_signoff", "audit_event"):
        assert (table, "config_version_id", "config_version") in foreign_keys
    assert ("crew_member", "crew_id", "crew") in foreign_keys
    assert ("crew", "site_id", "site") in foreign_keys


def test_columns_the_supplement_names_exist_with_their_nullability(settings: Settings) -> None:
    url = settings.database_url.get_secret_value()
    columns = {
        (r["table_name"], r["column_name"]): (r["data_type"], r["is_nullable"])
        for r in fetch_all(
            url,
            "SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns "
            "WHERE table_schema = 'public'",
        )
    }

    assert columns[("crew", "task_label")] == ("text", "NO")
    assert columns[("site", "supervisor_phone")] == ("text", "YES")
    assert columns[("site", "first_aider_phone")] == ("text", "YES")
    assert columns[("alert_event", "dispatch_interval_minutes")] == ("bigint", "NO")
    assert columns[("audit_event", "epoch_id")] == ("bigint", "YES")
    assert columns[("audit_event", "config_version_id")] == ("bigint", "YES")
    assert columns[("day_plan", "config_version_id")] == ("bigint", "NO")
    assert columns[("plan_signoff", "plan_hash")] == ("text", "NO")
    assert columns[("site_epoch", "epoch_id")] == ("bigint", "NO")
