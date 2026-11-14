"""The Postgres ``PushSubscriptionStore`` (ADR 0058 decision 3). The endpoint is for delivery only, never logged."""

import secrets
from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.adapters.db.tables import PushSubscription
from stellar_blaze.ports.push import NewSubscription, SubscriptionRecord

_COLUMNS = (
    PushSubscription.id,
    PushSubscription.endpoint,
    PushSubscription.p256dh,
    PushSubscription.auth,
    PushSubscription.expiration_time,
    PushSubscription.site_id,
    PushSubscription.crew_id,
    PushSubscription.epoch_id,
    PushSubscription.created_at,
)


class PostgresPushStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def upsert_by_endpoint(self, sub: NewSubscription, epoch_id: int) -> str:
        new_id = f"sub-{secrets.token_hex(8)}"
        statement = (
            insert(PushSubscription)
            .values(id=new_id, epoch_id=epoch_id, **sub.model_dump())
            .on_conflict_do_nothing(index_elements=[PushSubscription.epoch_id, PushSubscription.endpoint])
            .returning(PushSubscription.id)
        )
        async with self._engine.begin() as connection:
            created = (await connection.execute(statement)).scalar_one_or_none()
            if created is not None:
                return str(created)
            existing = select(PushSubscription.id).where(
                PushSubscription.epoch_id == epoch_id, PushSubscription.endpoint == sub.endpoint
            )
            return str((await connection.execute(existing)).scalar_one())

    async def delete(self, subscription_id: str) -> None:
        async with self._engine.begin() as connection:
            await connection.execute(delete(PushSubscription).where(PushSubscription.id == subscription_id))

    async def delete_gone(self, subscription_id: str) -> None:
        await self.delete(subscription_id)

    async def for_site(self, site_id: str, epoch_id: int) -> Sequence[SubscriptionRecord]:
        return await self._select(PushSubscription.site_id == site_id, PushSubscription.epoch_id == epoch_id)

    async def for_crew(self, crew_id: str, epoch_id: int) -> Sequence[SubscriptionRecord]:
        return await self._select(PushSubscription.crew_id == crew_id, PushSubscription.epoch_id == epoch_id)

    async def _select(self, *conditions: object) -> list[SubscriptionRecord]:
        statement = select(*_COLUMNS).where(*conditions).order_by(PushSubscription.created_at, PushSubscription.id)  # type: ignore[arg-type]
        async with self._engine.connect() as connection:
            rows = (await connection.execute(statement)).mappings().all()
        return [SubscriptionRecord.model_validate(dict(row)) for row in rows]
