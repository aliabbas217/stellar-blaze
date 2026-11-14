"""An in-memory ``AlertStore``."""

from collections.abc import Callable
from datetime import UTC, datetime

from stellar_blaze.ports.alerts import AlertEventInput, AlertRecord


class InMemoryAlertStore:
    def __init__(self, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._clock = clock
        self.records: list[AlertRecord] = []

    async def last_for_target(self, site_id: str, crew_id: str | None, epoch_id: int) -> AlertRecord | None:
        for record in reversed(self.records):
            if record.site_id == site_id and record.crew_id == crew_id and record.epoch_id == epoch_id:
                return record
        return None

    async def insert(self, event: AlertEventInput) -> AlertRecord | None:
        if any(r.epoch_id == event.epoch_id and r.dedupe_key == event.dedupe_key for r in self.records):
            return None
        record = AlertRecord(**event.model_dump(), id=len(self.records) + 1, created_at=self._clock())
        self.records.append(record)
        return record
