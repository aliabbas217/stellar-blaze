"""An in-memory ``PushSubscriptionStore``."""

import itertools
from collections.abc import Callable, Sequence
from datetime import UTC, datetime

from stellar_blaze.ports.push import NewSubscription, SubscriptionRecord


class InMemoryPushStore:
    def __init__(self, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._clock = clock
        self._rows: dict[str, SubscriptionRecord] = {}
        self._ids = itertools.count(1)

    async def upsert_by_endpoint(self, sub: NewSubscription, epoch_id: int) -> str:
        for row in self._rows.values():
            if row.epoch_id == epoch_id and row.endpoint == sub.endpoint:
                return row.id
        new_id = f"sub-{next(self._ids):08d}"
        self._rows[new_id] = SubscriptionRecord(
            **sub.model_dump(), id=new_id, epoch_id=epoch_id, created_at=self._clock()
        )
        return new_id

    async def id_for_endpoint(self, endpoint: str, epoch_id: int) -> str | None:
        return next((r.id for r in self._rows.values() if r.epoch_id == epoch_id and r.endpoint == endpoint), None)

    async def count_for_site(self, site_id: str, epoch_id: int) -> int:
        return len(await self.for_site(site_id, epoch_id))

    async def count_for_crew(self, crew_id: str, epoch_id: int) -> int:
        return len(await self.for_crew(crew_id, epoch_id))

    async def delete(self, subscription_id: str) -> None:
        self._rows.pop(subscription_id, None)

    async def delete_gone(self, subscription_id: str) -> None:
        self._rows.pop(subscription_id, None)

    async def for_site(self, site_id: str, epoch_id: int) -> Sequence[SubscriptionRecord]:
        return [r for r in self._rows.values() if r.site_id == site_id and r.epoch_id == epoch_id]

    async def for_crew(self, crew_id: str, epoch_id: int) -> Sequence[SubscriptionRecord]:
        return [r for r in self._rows.values() if r.crew_id == crew_id and r.epoch_id == epoch_id]
