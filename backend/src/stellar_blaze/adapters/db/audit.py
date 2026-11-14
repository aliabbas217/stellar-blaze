"""The Postgres ``AuditLog`` (ADR 0054): append-only (migration 0003 triggers) and hash-chained.

``append_in`` runs inside the caller's transaction, so a config activation and its audit row commit or roll back
together (ADR 0010 section 4.5). Appends are serialised with ``pg_advisory_xact_lock``: the lock is held to the end of
the transaction, so the "latest row hash" read under it is always the true tail of the chain, also when 20 appends race.
"""

import asyncio
from collections.abc import Callable, Sequence
from datetime import UTC, datetime

from sqlalchemy import RowMapping, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from stellar_blaze.adapters.db.tables import AuditEvent as AuditEventRow
from stellar_blaze.ports.audit import (
    AUDIT_LOCK_KEY,
    ZERO_HASH,
    AuditEvent,
    AuditKind,
    AuditRecord,
    link_holds,
    row_hash_of,
)

_COLUMNS = (
    AuditEventRow.id,
    AuditEventRow.at,
    AuditEventRow.kind,
    AuditEventRow.actor,
    AuditEventRow.actor_role,
    AuditEventRow.employer_id,
    AuditEventRow.site_id,
    AuditEventRow.epoch_id,
    AuditEventRow.outcome,
    AuditEventRow.detail,
    AuditEventRow.ruleset_id,
    AuditEventRow.ruleset_sha256,
    AuditEventRow.model_id,
    AuditEventRow.config_version_id,
    AuditEventRow.config_sha256,
    AuditEventRow.prev_hash,
    AuditEventRow.row_hash,
)
_VERIFY_BATCH = 1000


def _record(row: RowMapping) -> AuditRecord:
    return AuditRecord.model_validate(dict(row))


def utc_now() -> datetime:
    return datetime.now(UTC)


async def append_in(connection: AsyncConnection, event: AuditEvent, at: datetime) -> AuditRecord:
    """Append ``event`` to the chain inside ``connection``'s open transaction and return the stored row."""
    await connection.execute(select(func.pg_advisory_xact_lock(AUDIT_LOCK_KEY)))
    tail = (
        await connection.execute(select(AuditEventRow.row_hash).order_by(AuditEventRow.id.desc()).limit(1))
    ).scalar_one_or_none()
    prev_hash = tail if tail is not None else ZERO_HASH
    statement = (
        insert(AuditEventRow)
        .values(
            at=at,
            **event.model_dump(),
            prev_hash=prev_hash,
            row_hash=row_hash_of(prev_hash, event, at),
        )
        .returning(*_COLUMNS)
    )
    return _record((await connection.execute(statement)).mappings().one())


class PostgresAuditLog:
    """``AuditLog`` over the ``audit_event`` table."""

    def __init__(self, engine: AsyncEngine, *, clock: Callable[[], datetime] = utc_now) -> None:
        self._engine = engine
        self._clock = clock

    async def append(self, event: AuditEvent) -> AuditRecord:
        async with self._engine.begin() as connection:
            return await append_in(connection, event, self._clock())

    async def site_entries(
        self, site_id: str, kinds: Sequence[AuditKind], limit: int, epoch_id: int
    ) -> Sequence[AuditRecord]:
        if limit < 1:
            raise ValueError(f"limit must be at least 1, got {limit}")
        statement = (
            select(*_COLUMNS)
            .where(AuditEventRow.site_id == site_id, AuditEventRow.epoch_id == epoch_id, AuditEventRow.kind.in_(kinds))
            .order_by(AuditEventRow.id.desc())
            .limit(limit)
        )
        async with self._engine.connect() as connection:
            return [_record(row) for row in (await connection.execute(statement)).mappings()]

    async def verify(self) -> int | None:
        """Walk the chain in id order, in batches, on one snapshot; the id of the first broken row, else ``None``."""
        previous, last_id = ZERO_HASH, 0
        async with self._engine.connect() as connection:
            snapshot = await connection.execution_options(isolation_level="REPEATABLE READ")
            while True:
                batch = (
                    (
                        await snapshot.execute(
                            select(*_COLUMNS)
                            .where(AuditEventRow.id > last_id)
                            .order_by(AuditEventRow.id)
                            .limit(_VERIFY_BATCH)
                        )
                    )
                    .mappings()
                    .all()
                )
                if not batch:
                    return None
                for row in batch:
                    record = _record(row)
                    if not link_holds(record, previous):
                        return record.id
                    previous, last_id = record.row_hash, record.id
                await asyncio.sleep(0)
