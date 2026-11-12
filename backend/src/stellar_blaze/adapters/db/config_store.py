"""The Postgres ``RuntimeConfigStore`` (ADR 0010 section 3).

Versions are inserted once and never changed; activations are appended. Concurrency is decided by the database, not by a
lock: ``config_activation.previous_activation_id`` is ``UNIQUE NULLS NOT DISTINCT``, so of two activations that name the
same predecessor exactly one insert succeeds and the other is a unique violation, which this adapter reports as
``StaleActivationError``. The tables are append-only (triggers; migration 0002).

Reads are bounded by ``read_timeout_s``: the poller, the startup load and the CLI call them, and a database that
accepts the connection and then hangs must not hang them (the engine's ``statement_timeout`` alone would take 30 s). A
read that fails raises ``StoreUnavailableError`` (driver error chained).
"""

import asyncio
from collections.abc import Iterator, Sequence
from contextlib import contextmanager

import asyncpg.exceptions
from sqlalchemy import RowMapping, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.adapters.db.tables import ConfigActivation, ConfigVersion
from stellar_blaze.domain.config.runtime import RuntimeConfig, body_sha256, config_body
from stellar_blaze.ports.config_store import (
    ActivationKind,
    ActivationRecord,
    StaleActivationError,
    StoreUnavailableError,
    VersionNotFoundError,
    VersionRecord,
)

# Named by the naming convention in `tables.py`; migration 0002 creates them with these names.
SUCCESSOR_UNIQUE = "uq_config_activation_previous_activation_id"
PREVIOUS_FK = "fk_config_activation_previous_activation_id_config_activation"
VERSION_FK = "fk_config_activation_config_version_id_config_version"

_VERSION_COLUMNS = (
    ConfigVersion.id,
    ConfigVersion.sha256,
    ConfigVersion.body,
    ConfigVersion.schema_version,
    ConfigVersion.created_by,
    ConfigVersion.reason,
    ConfigVersion.created_at,
)
_ACTIVATION_COLUMNS = (
    ConfigActivation.id,
    ConfigActivation.config_version_id,
    ConfigActivation.kind,
    ConfigActivation.actor,
    ConfigActivation.reason,
    ConfigActivation.previous_activation_id,
    ConfigActivation.activated_at,
)


@contextmanager
def _reads_may_be_unavailable() -> Iterator[None]:
    """A failed read (the database unreachable, refusing, slow, or without the tables) is ``StoreUnavailableError``."""
    try:
        yield
    except (SQLAlchemyError, OSError, TimeoutError) as exc:
        raise StoreUnavailableError(f"{type(exc).__name__}: {exc}") from exc


def _version(row: RowMapping) -> VersionRecord:
    return VersionRecord.model_validate(dict(row))


def _activation(row: RowMapping) -> ActivationRecord:
    return ActivationRecord.model_validate(dict(row))


class PostgresConfigStore:
    """``RuntimeConfigStore`` over the ``config_version`` and ``config_activation`` tables."""

    def __init__(self, engine: AsyncEngine, *, read_timeout_s: float) -> None:
        self._engine = engine
        self._read_timeout_s = read_timeout_s

    async def latest_activation(self) -> ActivationRecord | None:
        statement = select(*_ACTIVATION_COLUMNS).order_by(ConfigActivation.id.desc()).limit(1)
        with _reads_may_be_unavailable():
            async with asyncio.timeout(self._read_timeout_s), self._engine.connect() as connection:
                row = (await connection.execute(statement)).mappings().first()
        return None if row is None else _activation(row)

    async def get_version(self, version_id: int) -> VersionRecord:
        statement = select(*_VERSION_COLUMNS).where(ConfigVersion.id == version_id)
        with _reads_may_be_unavailable():
            async with asyncio.timeout(self._read_timeout_s), self._engine.connect() as connection:
                row = (await connection.execute(statement)).mappings().first()
        if row is None:
            raise VersionNotFoundError(version_id)
        return _version(row)

    async def create_version(self, config: RuntimeConfig, *, actor: str, reason: str) -> VersionRecord:
        body = config_body(config)
        sha256 = body_sha256(body)
        insert_once = (
            insert(ConfigVersion)
            .values(sha256=sha256, body=body, schema_version=config.schema_version, created_by=actor, reason=reason)
            .on_conflict_do_nothing(index_elements=[ConfigVersion.sha256])
            .returning(*_VERSION_COLUMNS)
        )
        async with self._engine.begin() as connection:
            row = (await connection.execute(insert_once)).mappings().first()
            if row is None:  # the hash exists already: that row is the answer, with its first author and reason
                existing = select(*_VERSION_COLUMNS).where(ConfigVersion.sha256 == sha256)
                row = (await connection.execute(existing)).mappings().one()
        return _version(row)

    async def activate(
        self, version_id: int, *, expected_previous: int | None, kind: ActivationKind, actor: str, reason: str
    ) -> ActivationRecord:
        statement = (
            insert(ConfigActivation)
            .values(
                config_version_id=version_id,
                kind=kind,
                actor=actor,
                reason=reason,
                previous_activation_id=expected_previous,
            )
            .returning(*_ACTIVATION_COLUMNS)
        )
        try:
            async with self._engine.begin() as connection:
                row = (await connection.execute(statement)).mappings().one()
        except IntegrityError as exc:
            translated = _translate(exc, version_id=version_id, expected_previous=expected_previous)
            if translated is None:
                raise
            raise translated from exc
        return _activation(row)

    async def history(self, limit: int) -> Sequence[ActivationRecord]:
        if limit < 1:
            msg = f"limit must be at least 1, got {limit}"
            raise ValueError(msg)
        statement = select(*_ACTIVATION_COLUMNS).order_by(ConfigActivation.id.desc()).limit(limit)
        with _reads_may_be_unavailable():
            async with asyncio.timeout(self._read_timeout_s), self._engine.connect() as connection:
                rows = (await connection.execute(statement)).mappings().all()
        return [_activation(row) for row in rows]


def _translate(
    exc: IntegrityError, *, version_id: int, expected_previous: int | None
) -> StaleActivationError | VersionNotFoundError | None:
    """The port's error for a constraint the insert violated, or ``None`` for any other integrity error."""
    cause = exc.orig.__cause__ if exc.orig is not None else None
    if isinstance(cause, asyncpg.exceptions.UniqueViolationError) and cause.constraint_name == SUCCESSOR_UNIQUE:
        return StaleActivationError(expected_previous)  # another activation took this predecessor first
    if isinstance(cause, asyncpg.exceptions.ForeignKeyViolationError):
        if cause.constraint_name == PREVIOUS_FK:
            return StaleActivationError(expected_previous)  # there is no such activation, so it is not the latest
        if cause.constraint_name == VERSION_FK:
            return VersionNotFoundError(version_id)
    return None
