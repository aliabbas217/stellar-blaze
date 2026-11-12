"""SQLAlchemy table definitions: the schema Alembic migrates (``alembic check`` fails when they disagree)."""

from datetime import datetime
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    MetaData,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
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


class ConfigVersion(Base):
    """One immutable runtime-config version (ADR 0010 section 3): the body exactly as stored, and its hash.

    ``sha256`` is the SHA-256 of the canonical JSON of ``body`` (sorted keys, compact separators), so two proposals of
    the same config are one row. It is computed from the stored body, never from a model dumped again on read: adding a
    tunable later must not change the hash of a version that already exists. A trigger rejects UPDATE, DELETE and
    TRUNCATE (migration 0002); the row is the audit record of what was proposed, by whom and why.

    ``sha256`` is ``text`` with a format check, not ``char(64)`` (ADR 0010 section 3 says ``char(64)``): Squawk's
    ``ban-char-field`` refuses the type, and it would also be the weaker guarantee, since ``char(n)`` pads a short value
    with spaces and accepts any 64 characters, where the check admits only 64 lower-case hex digits. For the same
    reason ``schema_version`` is ``bigint`` (``prefer-bigint-over-int``).
    """

    __tablename__ = "config_version"
    __table_args__ = (
        UniqueConstraint("sha256"),
        CheckConstraint("sha256 ~ '^[0-9a-f]{64}$'", name="sha256_format"),
        CheckConstraint("jsonb_typeof(body) = 'object'", name="body_is_object"),
        CheckConstraint("schema_version >= 1", name="schema_version_positive"),
        CheckConstraint("length(btrim(created_by)) > 0", name="created_by_not_blank"),
        CheckConstraint("length(btrim(reason)) BETWEEN 10 AND 500", name="reason_length"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    sha256: Mapped[str] = mapped_column(Text)
    body: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    schema_version: Mapped[int] = mapped_column(BigInteger)
    created_by: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ConfigActivation(Base):
    """One entry of the append-only activation log; the active config version is the latest entry's version.

    ``previous_activation_id`` is ``UNIQUE NULLS NOT DISTINCT``: an activation names the activation it replaces, and
    Postgres admits one successor per activation (two racing activations on one predecessor produce one unique
    violation) and one seed ever (a second ``NULL`` collides). That is optimistic concurrency without a lock. A
    trigger rejects UPDATE, DELETE and TRUNCATE (migration 0002).
    """

    __tablename__ = "config_activation"
    __table_args__ = (
        UniqueConstraint("previous_activation_id", postgresql_nulls_not_distinct=True),
        CheckConstraint("kind IN ('seed','activate','rollback')", name="kind"),
        CheckConstraint("length(btrim(actor)) > 0", name="actor_not_blank"),
        CheckConstraint("length(btrim(reason)) BETWEEN 10 AND 500", name="reason_length"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    config_version_id: Mapped[int] = mapped_column(ForeignKey("config_version.id"))
    kind: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    previous_activation_id: Mapped[int | None] = mapped_column(ForeignKey("config_activation.id"))
    activated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
