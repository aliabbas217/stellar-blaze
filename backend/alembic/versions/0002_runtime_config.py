"""runtime config: immutable versions and an append-only activation log (ADR 0010)

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Both tables are append-only: no UPDATE, DELETE or TRUNCATE, ever, so a version and an activation are the audit record
# of what changed, by whom and why. A row trigger does not fire for TRUNCATE, hence the second, statement-level trigger.
# The demo connects as the table owner, so this stops an accident, not an owner who drops the trigger (ADR 0010 "Not
# doing now": separate DB roles).
APPEND_ONLY_TABLES = ("config_version", "config_activation")


def upgrade() -> None:
    """Upgrade schema."""
    # Fail fast instead of queueing behind a long transaction (and blocking everything behind us). Keep these two lines
    # first in every migration; Squawk's require-lock-timeout and require-statement-timeout rules check for them.
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '15s'")
    op.create_table(
        "config_version",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("body", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("schema_version", sa.BigInteger(), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("sha256 ~ '^[0-9a-f]{64}$'", name=op.f("ck_config_version_sha256_format")),
        sa.CheckConstraint("jsonb_typeof(body) = 'object'", name=op.f("ck_config_version_body_is_object")),
        sa.CheckConstraint("schema_version >= 1", name=op.f("ck_config_version_schema_version_positive")),
        sa.CheckConstraint("length(btrim(created_by)) > 0", name=op.f("ck_config_version_created_by_not_blank")),
        sa.CheckConstraint("length(btrim(reason)) BETWEEN 10 AND 500", name=op.f("ck_config_version_reason_length")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_config_version")),
        sa.UniqueConstraint("sha256", name=op.f("uq_config_version_sha256")),
    )
    op.create_table(
        "config_activation",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("config_version_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("actor", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("previous_activation_id", sa.BigInteger(), nullable=True),
        sa.Column("activated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("kind IN ('seed','activate','rollback')", name=op.f("ck_config_activation_kind")),
        sa.CheckConstraint("length(btrim(actor)) > 0", name=op.f("ck_config_activation_actor_not_blank")),
        sa.CheckConstraint("length(btrim(reason)) BETWEEN 10 AND 500", name=op.f("ck_config_activation_reason_length")),
        sa.ForeignKeyConstraint(
            ["config_version_id"],
            ["config_version.id"],
            name=op.f("fk_config_activation_config_version_id_config_version"),
        ),
        sa.ForeignKeyConstraint(
            ["previous_activation_id"],
            ["config_activation.id"],
            name=op.f("fk_config_activation_previous_activation_id_config_activation"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_config_activation")),
        # Optimistic concurrency without a lock: one successor per activation, and (NULLS NOT DISTINCT) one first
        # activation ever. Two activations racing on one predecessor produce one unique violation.
        sa.UniqueConstraint(
            "previous_activation_id",
            name=op.f("uq_config_activation_previous_activation_id"),
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.execute(
        """
        CREATE FUNCTION sb_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION '% on % is not allowed: the table is append-only', TG_OP, TG_TABLE_NAME
                USING ERRCODE = 'restrict_violation';
        END;
        $$
        """
    )
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
    op.execute("DROP FUNCTION sb_reject_mutation()")
    op.drop_table("config_activation")
    op.drop_table("config_version")
