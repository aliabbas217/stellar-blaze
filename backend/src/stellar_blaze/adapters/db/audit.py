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
from stellar_blaze.domain.audit import ZERO_HASH, link_holds
from stellar_blaze.ports.audit import AUDIT_LOCK_KEY, AuditEvent, AuditKind, AuditRecord, ChainReport, row_hash_of

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


async def append_in(connection: AsyncConnection, event: AuditEvent, clock: Callable[[], datetime]) -> AuditRecord:
    """Append ``event`` to the chain inside ``connection``'s open transaction and return the stored row.

    ``clock`` is read AFTER the advisory lock is held, so ``at`` is monotonic with ``id`` (two writers cannot take
    their instants before the lock and append them in the other order).

    Raises:
        ValueError: ``clock`` returned a naive datetime.
    """
    await connection.execute(select(func.pg_advisory_xact_lock(AUDIT_LOCK_KEY)))
    at = clock()
    if at.tzinfo is None or at.utcoffset() is None:
        raise ValueError("the audit clock must return a timezone-aware datetime")
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
            return await append_in(connection, event, self._clock)

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
        return (await self.chain_report()).broken_id

    async def chain_report(self) -> ChainReport:
        """Walk the chain in id order, in batches, on one snapshot, hashing the raw stored values (never a validated
        ``AuditEvent``, so a tampered kind, key or float names its row instead of raising)."""
        previous, last_id, rows = ZERO_HASH, 0, 0
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
                    return ChainReport(None, rows, last_id or None, previous)
                for row in batch:
                    raw = dict(row)
                    if not link_holds(raw, previous):
                        return ChainReport(int(raw["id"]), rows, None, ZERO_HASH)
                    previous, last_id, rows = str(raw["row_hash"]), int(raw["id"]), rows + 1
                await asyncio.sleep(0)
