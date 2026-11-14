"""An in-memory ``AuditLog``: the same chain as Postgres (``ports.audit.row_hash_of``), serialised by one lock."""

import asyncio
from collections.abc import Callable, Sequence
from datetime import UTC, datetime

from stellar_blaze.ports.audit import ZERO_HASH, AuditEvent, AuditKind, AuditRecord, first_broken, row_hash_of


class InMemoryAuditLog:
    """Rows live in ``records`` (a test may edit one to check that ``verify`` notices); ids start at 1."""

    def __init__(self, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._clock = clock
        self._lock = asyncio.Lock()
        self.records: list[AuditRecord] = []

    async def append(self, event: AuditEvent) -> AuditRecord:
        async with self._lock:
            prev = self.records[-1].row_hash if self.records else ZERO_HASH
            at = self._clock()
            record = AuditRecord(
                **event.model_dump(),
                id=len(self.records) + 1,
                at=at,
                prev_hash=prev,
                row_hash=row_hash_of(prev, event, at),
            )
            self.records.append(record)
            return record

    async def site_entries(
        self, site_id: str, kinds: Sequence[AuditKind], limit: int, epoch_id: int
    ) -> Sequence[AuditRecord]:
        if limit < 1:
            raise ValueError(f"limit must be at least 1, got {limit}")
        wanted = [r for r in self.records if r.site_id == site_id and r.epoch_id == epoch_id and r.kind in kinds]
        return list(reversed(wanted))[:limit]

    async def verify(self) -> int | None:
        return first_broken(self.records)
