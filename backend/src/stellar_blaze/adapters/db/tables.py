"""SQLAlchemy table definitions: the schema Alembic migrates (``alembic check`` fails when they disagree)."""

from datetime import datetime
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import CheckConstraint, DateTime, Index, MetaData, Text, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    # Deterministic constraint and index names: Alembic can then drop or alter them by name in later migrations, and
    # `alembic check` has stable names to compare. A CHECK constraint needs an explicit `name=` for the
    # `%(constraint_name)s` token below.
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


class JobRun(Base):
    """One execution of a batch job (``sb-jobs``): what ran, with which inputs and code, and how it ended."""

    __tablename__ = "job_run"
    __table_args__ = (CheckConstraint("status IN ('running','succeeded','failed','skipped_locked')", name="status"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, server_default=text("gen_random_uuid()"))
    job_name: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    params: Mapped[dict[str, JsonValue]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    # none_as_null: "no summary" is SQL NULL, not the JSON value null.
    summary: Mapped[dict[str, JsonValue] | None] = mapped_column(JSONB(none_as_null=True))
    error: Mapped[str | None] = mapped_column(Text)
    code_version: Mapped[str | None] = mapped_column(Text)


# "What did this job do lately?": newest first per job.
Index("ix_job_run_job_name_started_at", JobRun.job_name, JobRun.started_at.desc())
