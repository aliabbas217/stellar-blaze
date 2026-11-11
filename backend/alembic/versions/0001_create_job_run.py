"""create job_run

Revision ID: 0001
Revises:
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Fail fast instead of queueing behind a long transaction (and blocking everything behind us). Keep these two lines
    # first in every migration; Squawk's require-lock-timeout and require-statement-timeout rules check for them.
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '15s'")
    op.create_table(
        "job_run",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("job_name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("params", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("summary", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("code_version", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('running','succeeded','failed','skipped_locked')", name=op.f("ck_job_run_status")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_job_run")),
    )
    # Same transaction as the CREATE TABLE, so a plain (blocking) index build locks nothing anyone else can touch.
    op.create_index("ix_job_run_job_name_started_at", "job_run", ["job_name", sa.text("started_at DESC")])


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '15s'")
    op.drop_index("ix_job_run_job_name_started_at", table_name="job_run")
    op.drop_table("job_run")
