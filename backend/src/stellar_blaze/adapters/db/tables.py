"""SQLAlchemy table definitions: the schema Alembic migrates (``alembic check`` fails when they disagree)."""

from datetime import date, datetime
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Double,
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


# === B3 (migration 0003): sites, crews, epochs, decisions, push, audit ===============================================
# Append-only tables (row trigger for UPDATE and DELETE plus a TRUNCATE statement trigger, as in 0002): site_epoch,
# alert_event, day_plan, plan_signoff, audit_event. `sha256` columns are `text` with the 64-hex CHECK, as in 0002.

_HEX64 = "~ '^[0-9a-f]{64}$'"
_E164 = "~ '^\\+[1-9][0-9]{6,14}$'"
APPEND_ONLY_B3 = ("site_epoch", "alert_event", "day_plan", "plan_signoff", "audit_event")


class Site(Base):
    """A site. Static fixture configuration shared by every epoch; ``synthetic`` marks demo data (ADR 0066)."""

    __tablename__ = "site"
    __table_args__ = (
        CheckConstraint("lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180", name="coordinates"),
        CheckConstraint(f"supervisor_phone IS NULL OR supervisor_phone {_E164}", name="supervisor_phone_e164"),
        CheckConstraint(f"first_aider_phone IS NULL OR first_aider_phone {_E164}", name="first_aider_phone_e164"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    timezone: Mapped[str] = mapped_column(Text)
    station: Mapped[str] = mapped_column(Text)
    lat: Mapped[float] = mapped_column(Double)
    lon: Mapped[float] = mapped_column(Double)
    employer_id: Mapped[str] = mapped_column(Text)
    synthetic: Mapped[bool] = mapped_column(Boolean)
    supervisor_phone: Mapped[str | None] = mapped_column(Text)
    first_aider_phone: Mapped[str | None] = mapped_column(Text)


class SiteEpoch(Base):
    """A demo epoch (ADR 0066 option B): a site's active epoch is its highest ``epoch_id``. Append-only."""

    __tablename__ = "site_epoch"

    epoch_id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("site.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_by: Mapped[str] = mapped_column(Text)


Index("ix_site_epoch_site_id_epoch_id", SiteEpoch.site_id, SiteEpoch.epoch_id.desc())


class Crew(Base):
    __tablename__ = "crew"
    __table_args__ = (
        CheckConstraint("workload IN ('light','moderate','heavy')", name="workload"),
        CheckConstraint("days_per_week BETWEEN 1 AND 7", name="days_per_week"),
        CheckConstraint("jsonb_typeof(shift) = 'array'", name="shift_is_array"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("site.id"))
    employer_id: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    task_label: Mapped[str] = mapped_column(Text)
    workload: Mapped[str] = mapped_column(Text)
    shift: Mapped[list[JsonValue]] = mapped_column(JSONB)
    days_per_week: Mapped[int] = mapped_column(BigInteger)


Index("ix_crew_site_id", Crew.site_id)


class CrewMember(Base):
    """One crew member. PERSONAL data class (ADR 0010 section 8): read only by the planner, never by the API."""

    __tablename__ = "crew_member"
    __table_args__ = (
        CheckConstraint("days_on_site >= 0 AND days_away >= 0", name="counters_not_negative"),
        CheckConstraint("away_reason IN ('leave','illness','none')", name="away_reason"),
        CheckConstraint("(away_reason = 'none') = (days_away = 0)", name="away_reason_matches_days_away"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    crew_id: Mapped[str] = mapped_column(ForeignKey("crew.id"))
    days_on_site: Mapped[int] = mapped_column(BigInteger)
    days_away: Mapped[int] = mapped_column(BigInteger)
    away_reason: Mapped[str] = mapped_column(Text)
    experienced: Mapped[bool] = mapped_column(Boolean)
    juvenile: Mapped[bool] = mapped_column(Boolean)


Index("ix_crew_member_crew_id", CrewMember.crew_id)


class PushSubscription(Base):
    """A Web Push subscription; the endpoint is unique per epoch and is never logged (ADR 0058)."""

    __tablename__ = "push_subscription"
    __table_args__ = (UniqueConstraint("epoch_id", "endpoint"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    endpoint: Mapped[str] = mapped_column(Text)
    p256dh: Mapped[str] = mapped_column(Text)
    auth: Mapped[str] = mapped_column(Text)
    expiration_time: Mapped[int | None] = mapped_column(BigInteger)
    site_id: Mapped[str] = mapped_column(ForeignKey("site.id"))
    crew_id: Mapped[str | None] = mapped_column(ForeignKey("crew.id"))
    epoch_id: Mapped[int] = mapped_column(ForeignKey("site_epoch.epoch_id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


Index("ix_push_subscription_epoch_id_site_id", PushSubscription.epoch_id, PushSubscription.site_id)
Index("ix_push_subscription_epoch_id_crew_id", PushSubscription.epoch_id, PushSubscription.crew_id)


class AlertEvent(Base):
    """An alert event (ADR 0058 decision 1). Append-only; carries the five identity fields and the dispatch cadence."""

    __tablename__ = "alert_event"
    __table_args__ = (
        UniqueConstraint("epoch_id", "dedupe_key"),
        CheckConstraint("audience IN ('site','crew')", name="audience"),
        CheckConstraint("(audience = 'crew') = (crew_id IS NOT NULL)", name="audience_matches_crew"),
        CheckConstraint("level IN ('green','amber','orange','red')", name="level"),
        CheckConstraint("kind IN ('escalate','deescalate')", name="kind"),
        CheckConstraint("delivered >= 0 AND failed >= 0", name="counts_not_negative"),
        CheckConstraint(f"ruleset_sha256 {_HEX64}", name="ruleset_sha256_format"),
        CheckConstraint(f"config_sha256 {_HEX64}", name="config_sha256_format"),
        CheckConstraint("dispatch_interval_minutes BETWEEN 1 AND 30", name="dispatch_interval_minutes_range"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("site.id"))
    audience: Mapped[str] = mapped_column(Text)
    crew_id: Mapped[str | None] = mapped_column(ForeignKey("crew.id"))
    epoch_id: Mapped[int] = mapped_column(ForeignKey("site_epoch.epoch_id"))
    level: Mapped[str] = mapped_column(Text)
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    template_id: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    dedupe_key: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    delivered: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    failed: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    dispatch_interval_minutes: Mapped[int] = mapped_column(BigInteger)
    ruleset_id: Mapped[str] = mapped_column(Text)
    ruleset_sha256: Mapped[str] = mapped_column(Text)
    model_id: Mapped[str | None] = mapped_column(Text)
    config_version_id: Mapped[int] = mapped_column(ForeignKey("config_version.id"))
    config_sha256: Mapped[str] = mapped_column(Text)


Index("ix_alert_event_target", AlertEvent.epoch_id, AlertEvent.site_id, AlertEvent.crew_id, AlertEvent.id.desc())


class DayPlan(Base):
    """A crew day plan decision. Append-only; only plans that passed the validator are stored."""

    __tablename__ = "day_plan"
    __table_args__ = (
        CheckConstraint("status IN ('rule','fallback')", name="status"),
        CheckConstraint("violations >= 0", name="violations_not_negative"),
        CheckConstraint("jsonb_typeof(plan) = 'object'", name="plan_is_object"),
        CheckConstraint(f"ruleset_sha256 {_HEX64}", name="ruleset_sha256_format"),
        CheckConstraint(f"config_sha256 {_HEX64}", name="config_sha256_format"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    epoch_id: Mapped[int] = mapped_column(ForeignKey("site_epoch.epoch_id"))
    crew_id: Mapped[str] = mapped_column(ForeignKey("crew.id"))
    local_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(Text)
    plan: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    violations: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ruleset_id: Mapped[str] = mapped_column(Text)
    ruleset_sha256: Mapped[str] = mapped_column(Text)
    model_id: Mapped[str | None] = mapped_column(Text)
    config_version_id: Mapped[int] = mapped_column(ForeignKey("config_version.id"))
    config_sha256: Mapped[str] = mapped_column(Text)


Index("ix_day_plan_crew", DayPlan.epoch_id, DayPlan.crew_id, DayPlan.local_date, DayPlan.id.desc())


class CrewStop(Base):
    """A crew-lead stop (ADR 0046 decision 7). It names the crew, never a member; ``cleared_at`` is set once."""

    __tablename__ = "crew_stop"
    __table_args__ = (CheckConstraint("cleared_at IS NULL OR cleared_at >= started_at", name="cleared_after_started"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    crew_id: Mapped[str] = mapped_column(ForeignKey("crew.id"))
    epoch_id: Mapped[int] = mapped_column(ForeignKey("site_epoch.epoch_id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reason_code: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(Text)
    cleared_by: Mapped[str | None] = mapped_column(Text)


Index("ix_crew_stop_crew", CrewStop.epoch_id, CrewStop.crew_id, CrewStop.started_at)


class PlanSignoff(Base):
    """A supervisor's sign-off of a day plan. Append-only; the latest row per (epoch, crew, date) is the current one."""

    __tablename__ = "plan_signoff"
    __table_args__ = (
        CheckConstraint("jsonb_typeof(acknowledged_items) = 'array'", name="acknowledged_items_is_array"),
        CheckConstraint(f"plan_hash {_HEX64}", name="plan_hash_format"),
        CheckConstraint(f"ruleset_sha256 {_HEX64}", name="ruleset_sha256_format"),
        CheckConstraint(f"config_sha256 {_HEX64}", name="config_sha256_format"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    epoch_id: Mapped[int] = mapped_column(ForeignKey("site_epoch.epoch_id"))
    crew_id: Mapped[str] = mapped_column(ForeignKey("crew.id"))
    local_date: Mapped[date] = mapped_column(Date)
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actor: Mapped[str] = mapped_column(Text)
    actor_role: Mapped[str] = mapped_column(Text)
    acknowledged_items: Mapped[list[JsonValue]] = mapped_column(JSONB)
    deviation_reason_code: Mapped[str | None] = mapped_column(Text)
    plan_hash: Mapped[str] = mapped_column(Text)
    ruleset_id: Mapped[str] = mapped_column(Text)
    ruleset_sha256: Mapped[str] = mapped_column(Text)
    model_id: Mapped[str | None] = mapped_column(Text)
    config_version_id: Mapped[int] = mapped_column(ForeignKey("config_version.id"))
    config_sha256: Mapped[str] = mapped_column(Text)


Index("ix_plan_signoff_crew", PlanSignoff.epoch_id, PlanSignoff.crew_id, PlanSignoff.local_date, PlanSignoff.id.desc())


class AuditEvent(Base):
    """The governance audit log (ADR 0054): append-only and hash-chained; ``epoch_id`` is part of the hashed row."""

    __tablename__ = "audit_event"
    __table_args__ = (
        UniqueConstraint("row_hash"),
        UniqueConstraint("prev_hash"),  # a fork is impossible at the database level (review I3)
        CheckConstraint(f"prev_hash {_HEX64}", name="prev_hash_format"),
        CheckConstraint(f"row_hash {_HEX64}", name="row_hash_format"),
        CheckConstraint("jsonb_typeof(detail) = 'object'", name="detail_is_object"),
        CheckConstraint("ruleset_sha256 IS NULL OR ruleset_sha256 ~ '^[0-9a-f]{64}$'", name="ruleset_sha256_format"),
        CheckConstraint("config_sha256 IS NULL OR config_sha256 ~ '^[0-9a-f]{64}$'", name="config_sha256_format"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    kind: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(Text)
    actor_role: Mapped[str] = mapped_column(Text)
    employer_id: Mapped[str | None] = mapped_column(Text)
    site_id: Mapped[str | None] = mapped_column(Text)
    epoch_id: Mapped[int | None] = mapped_column(ForeignKey("site_epoch.epoch_id"))
    outcome: Mapped[str] = mapped_column(Text)
    detail: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    ruleset_id: Mapped[str | None] = mapped_column(Text)
    ruleset_sha256: Mapped[str | None] = mapped_column(Text)
    model_id: Mapped[str | None] = mapped_column(Text)
    config_version_id: Mapped[int | None] = mapped_column(ForeignKey("config_version.id"))
    config_sha256: Mapped[str | None] = mapped_column(Text)
    prev_hash: Mapped[str] = mapped_column(Text)
    row_hash: Mapped[str] = mapped_column(Text)


# "What did this site's governance log say lately?": newest first per site and kind.
Index("ix_audit_event_site_kind", AuditEvent.site_id, AuditEvent.kind, AuditEvent.id.desc())
