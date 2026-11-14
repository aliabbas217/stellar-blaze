"""B3: sites, crews, demo epochs, alert and plan decisions, sign-offs, push subscriptions, the audit chain

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Append-only like 0002's tables: no UPDATE, DELETE or TRUNCATE (ADR 0054, ADR 0066). `sb_reject_mutation()` is the
# function 0002 created. Only the owner can drop a trigger (ADR 0010 "Not doing now": separate DB roles); for
# `audit_event` the hash chain makes that visible (`sb-jobs audit verify`).
APPEND_ONLY_TABLES = ("site_epoch", "alert_event", "day_plan", "plan_signoff", "audit_event")

HEX64 = "~ '^[0-9a-f]{64}$'"
E164 = "~ '^\\+[1-9][0-9]{6,14}$'"


def _ts(name: str, *, nullable: bool = False, default_now: bool = False) -> sa.Column[sa.DateTime]:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        server_default=sa.text("now()") if default_now else None,
        nullable=nullable,
    )


def _identity_columns() -> list[sa.Column[str] | sa.Column[int]]:
    """The five identity fields every decision row carries (global constraints)."""
    return [
        sa.Column("ruleset_id", sa.Text(), nullable=False),
        sa.Column("ruleset_sha256", sa.Text(), nullable=False),
        sa.Column("model_id", sa.Text(), nullable=True),
        sa.Column("config_version_id", sa.BigInteger(), nullable=False),
        sa.Column("config_sha256", sa.Text(), nullable=False),
    ]


def _identity_constraints(table: str) -> list[sa.schema.SchemaItem]:
    return [
        sa.CheckConstraint(f"ruleset_sha256 {HEX64}", name=op.f(f"ck_{table}_ruleset_sha256_format")),
        sa.CheckConstraint(f"config_sha256 {HEX64}", name=op.f(f"ck_{table}_config_sha256_format")),
        sa.ForeignKeyConstraint(
            ["config_version_id"], ["config_version.id"], name=op.f(f"fk_{table}_config_version_id_config_version")
        ),
    ]


def _epoch_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(["epoch_id"], ["site_epoch.epoch_id"], name=op.f(f"fk_{table}_epoch_id_site_epoch"))


def _crew_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(["crew_id"], ["crew.id"], name=op.f(f"fk_{table}_crew_id_crew"))


def _site_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(["site_id"], ["site.id"], name=op.f(f"fk_{table}_site_id_site"))


def upgrade() -> None:
    """Upgrade schema."""
    # Keep these two lines first in every migration (Squawk require-lock-timeout / require-statement-timeout).
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '15s'")

    op.create_table(
        "site",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("timezone", sa.Text(), nullable=False),
        sa.Column("station", sa.Text(), nullable=False),
        sa.Column("lat", sa.Double(), nullable=False),
        sa.Column("lon", sa.Double(), nullable=False),
        sa.Column("employer_id", sa.Text(), nullable=False),
        sa.Column("synthetic", sa.Boolean(), nullable=False),
        sa.Column("supervisor_phone", sa.Text(), nullable=True),
        sa.Column("first_aider_phone", sa.Text(), nullable=True),
        sa.CheckConstraint("lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180", name=op.f("ck_site_coordinates")),
        sa.CheckConstraint(
            f"supervisor_phone IS NULL OR supervisor_phone {E164}", name=op.f("ck_site_supervisor_phone_e164")
        ),
        sa.CheckConstraint(
            f"first_aider_phone IS NULL OR first_aider_phone {E164}", name=op.f("ck_site_first_aider_phone_e164")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_site")),
    )
    op.create_table(
        "site_epoch",
        sa.Column("epoch_id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("site_id", sa.Text(), nullable=False),
        _ts("started_at", default_now=True),
        sa.Column("started_by", sa.Text(), nullable=False),
        _site_fk("site_epoch"),
        sa.PrimaryKeyConstraint("epoch_id", name=op.f("pk_site_epoch")),
    )
    op.create_index("ix_site_epoch_site_id_epoch_id", "site_epoch", ["site_id", sa.text("epoch_id DESC")])
    op.create_table(
        "crew",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("site_id", sa.Text(), nullable=False),
        sa.Column("employer_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("task_label", sa.Text(), nullable=False),
        sa.Column("workload", sa.Text(), nullable=False),
        sa.Column("shift", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("days_per_week", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("workload IN ('light','moderate','heavy')", name=op.f("ck_crew_workload")),
        sa.CheckConstraint("days_per_week BETWEEN 1 AND 7", name=op.f("ck_crew_days_per_week")),
        sa.CheckConstraint("jsonb_typeof(shift) = 'array'", name=op.f("ck_crew_shift_is_array")),
        _site_fk("crew"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_crew")),
    )
    op.create_index("ix_crew_site_id", "crew", ["site_id"])
    op.create_table(
        "crew_member",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("crew_id", sa.Text(), nullable=False),
        sa.Column("days_on_site", sa.BigInteger(), nullable=False),
        sa.Column("days_away", sa.BigInteger(), nullable=False),
        sa.Column("away_reason", sa.Text(), nullable=False),
        sa.Column("experienced", sa.Boolean(), nullable=False),
        sa.Column("juvenile", sa.Boolean(), nullable=False),
        sa.CheckConstraint("days_on_site >= 0 AND days_away >= 0", name=op.f("ck_crew_member_counters_not_negative")),
        sa.CheckConstraint("away_reason IN ('leave','illness','none')", name=op.f("ck_crew_member_away_reason")),
        sa.CheckConstraint(
            "(away_reason = 'none') = (days_away = 0)", name=op.f("ck_crew_member_away_reason_matches_days_away")
        ),
        _crew_fk("crew_member"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_crew_member")),
    )
    op.create_index("ix_crew_member_crew_id", "crew_member", ["crew_id"])
    op.create_table(
        "push_subscription",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.Text(), nullable=False),
        sa.Column("auth", sa.Text(), nullable=False),
        sa.Column("expiration_time", sa.BigInteger(), nullable=True),
        sa.Column("site_id", sa.Text(), nullable=False),
        sa.Column("crew_id", sa.Text(), nullable=True),
        sa.Column("epoch_id", sa.BigInteger(), nullable=False),
        _ts("created_at", default_now=True),
        _site_fk("push_subscription"),
        _crew_fk("push_subscription"),
        _epoch_fk("push_subscription"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_push_subscription")),
        sa.UniqueConstraint("epoch_id", "endpoint", name=op.f("uq_push_subscription_epoch_id")),
    )
    op.create_index("ix_push_subscription_epoch_id_site_id", "push_subscription", ["epoch_id", "site_id"])
    op.create_index("ix_push_subscription_epoch_id_crew_id", "push_subscription", ["epoch_id", "crew_id"])
    op.create_table(
        "alert_event",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("site_id", sa.Text(), nullable=False),
        sa.Column("audience", sa.Text(), nullable=False),
        sa.Column("crew_id", sa.Text(), nullable=True),
        sa.Column("epoch_id", sa.BigInteger(), nullable=False),
        sa.Column("level", sa.Text(), nullable=False),
        _ts("valid_from"),
        sa.Column("template_id", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("dedupe_key", sa.Text(), nullable=False),
        _ts("created_at", default_now=True),
        sa.Column("delivered", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("failed", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("dispatch_interval_minutes", sa.BigInteger(), nullable=False),
        *_identity_columns(),
        sa.CheckConstraint("audience IN ('site','crew')", name=op.f("ck_alert_event_audience")),
        sa.CheckConstraint(
            "(audience = 'crew') = (crew_id IS NOT NULL)", name=op.f("ck_alert_event_audience_matches_crew")
        ),
        sa.CheckConstraint("level IN ('green','amber','orange','red')", name=op.f("ck_alert_event_level")),
        sa.CheckConstraint("kind IN ('escalate','deescalate')", name=op.f("ck_alert_event_kind")),
        sa.CheckConstraint("delivered >= 0 AND failed >= 0", name=op.f("ck_alert_event_counts_not_negative")),
        sa.CheckConstraint(
            "dispatch_interval_minutes BETWEEN 1 AND 30", name=op.f("ck_alert_event_dispatch_interval_minutes_range")
        ),
        _site_fk("alert_event"),
        _crew_fk("alert_event"),
        _epoch_fk("alert_event"),
        *_identity_constraints("alert_event"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_alert_event")),
        sa.UniqueConstraint("epoch_id", "dedupe_key", name=op.f("uq_alert_event_epoch_id")),
    )
    op.create_index("ix_alert_event_target", "alert_event", ["epoch_id", "site_id", "crew_id", sa.text("id DESC")])
    op.create_table(
        "day_plan",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("epoch_id", sa.BigInteger(), nullable=False),
        sa.Column("crew_id", sa.Text(), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("plan", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("violations", sa.BigInteger(), nullable=False),
        _ts("created_at", default_now=True),
        *_identity_columns(),
        sa.CheckConstraint("status IN ('rule','fallback')", name=op.f("ck_day_plan_status")),
        sa.CheckConstraint("violations >= 0", name=op.f("ck_day_plan_violations_not_negative")),
        sa.CheckConstraint("jsonb_typeof(plan) = 'object'", name=op.f("ck_day_plan_plan_is_object")),
        _epoch_fk("day_plan"),
        _crew_fk("day_plan"),
        *_identity_constraints("day_plan"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_day_plan")),
    )
    op.create_index("ix_day_plan_crew", "day_plan", ["epoch_id", "crew_id", "local_date", sa.text("id DESC")])
    op.create_table(
        "crew_stop",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("crew_id", sa.Text(), nullable=False),
        sa.Column("epoch_id", sa.BigInteger(), nullable=False),
        _ts("started_at"),
        _ts("cleared_at", nullable=True),
        sa.Column("reason_code", sa.Text(), nullable=False),
        sa.Column("actor", sa.Text(), nullable=False),
        sa.Column("cleared_by", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "cleared_at IS NULL OR cleared_at >= started_at", name=op.f("ck_crew_stop_cleared_after_started")
        ),
        _crew_fk("crew_stop"),
        _epoch_fk("crew_stop"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_crew_stop")),
    )
    op.create_index("ix_crew_stop_crew", "crew_stop", ["epoch_id", "crew_id", "started_at"])
    op.create_table(
        "plan_signoff",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("epoch_id", sa.BigInteger(), nullable=False),
        sa.Column("crew_id", sa.Text(), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        _ts("signed_at", default_now=True),
        sa.Column("actor", sa.Text(), nullable=False),
        sa.Column("actor_role", sa.Text(), nullable=False),
        sa.Column("acknowledged_items", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("deviation_reason_code", sa.Text(), nullable=True),
        sa.Column("plan_hash", sa.Text(), nullable=False),
        *_identity_columns(),
        sa.CheckConstraint(
            "jsonb_typeof(acknowledged_items) = 'array'", name=op.f("ck_plan_signoff_acknowledged_items_is_array")
        ),
        sa.CheckConstraint(f"plan_hash {HEX64}", name=op.f("ck_plan_signoff_plan_hash_format")),
        _epoch_fk("plan_signoff"),
        _crew_fk("plan_signoff"),
        *_identity_constraints("plan_signoff"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_plan_signoff")),
    )
    op.create_index("ix_plan_signoff_crew", "plan_signoff", ["epoch_id", "crew_id", "local_date", sa.text("id DESC")])
    op.create_table(
        "audit_event",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        _ts("at"),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("actor", sa.Text(), nullable=False),
        sa.Column("actor_role", sa.Text(), nullable=False),
        sa.Column("employer_id", sa.Text(), nullable=True),
        sa.Column("site_id", sa.Text(), nullable=True),
        sa.Column("epoch_id", sa.BigInteger(), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("detail", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("ruleset_id", sa.Text(), nullable=True),
        sa.Column("ruleset_sha256", sa.Text(), nullable=True),
        sa.Column("model_id", sa.Text(), nullable=True),
        sa.Column("config_version_id", sa.BigInteger(), nullable=True),
        sa.Column("config_sha256", sa.Text(), nullable=True),
        sa.Column("prev_hash", sa.Text(), nullable=False),
        sa.Column("row_hash", sa.Text(), nullable=False),
        sa.CheckConstraint(f"prev_hash {HEX64}", name=op.f("ck_audit_event_prev_hash_format")),
        sa.CheckConstraint(f"row_hash {HEX64}", name=op.f("ck_audit_event_row_hash_format")),
        sa.CheckConstraint("jsonb_typeof(detail) = 'object'", name=op.f("ck_audit_event_detail_is_object")),
        sa.CheckConstraint(
            f"ruleset_sha256 IS NULL OR ruleset_sha256 {HEX64}", name=op.f("ck_audit_event_ruleset_sha256_format")
        ),
        sa.CheckConstraint(
            f"config_sha256 IS NULL OR config_sha256 {HEX64}", name=op.f("ck_audit_event_config_sha256_format")
        ),
        _epoch_fk("audit_event"),
        sa.ForeignKeyConstraint(
            ["config_version_id"], ["config_version.id"], name=op.f("fk_audit_event_config_version_id_config_version")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_event")),
        sa.UniqueConstraint("row_hash", name=op.f("uq_audit_event_row_hash")),
    )
    op.create_index("ix_audit_event_site_kind", "audit_event", ["site_id", "kind", sa.text("id DESC")])
    for table in APPEND_ONLY_TABLES:
        op.execute(
            f"CREATE TRIGGER trg_{table}_append_only BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION sb_reject_mutation()"
        )
        op.execute(
            f"CREATE TRIGGER trg_{table}_no_truncate BEFORE TRUNCATE ON {table} "
            "FOR EACH STATEMENT EXECUTE FUNCTION sb_reject_mutation()"
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '15s'")
    for table in reversed(APPEND_ONLY_TABLES):
        op.execute(f"DROP TRIGGER trg_{table}_no_truncate ON {table}")
        op.execute(f"DROP TRIGGER trg_{table}_append_only ON {table}")
    for table in ("audit_event", "plan_signoff", "crew_stop", "day_plan", "alert_event", "push_subscription"):
        op.drop_table(table)
    for table in ("crew_member", "crew", "site_epoch", "site"):
        op.drop_table(table)
