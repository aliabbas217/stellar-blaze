"""The Postgres ``PushSubscriptionStore`` (ADR 0058 decision 3). The endpoint is for delivery only, never logged."""

import secrets
from collections.abc import Sequence

from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from stellar_blaze.adapters.db.tables import PushSubscription
from stellar_blaze.ports.push import NewSubscription, SubscriptionCapError, SubscriptionRecord

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

    async def upsert_by_endpoint(
        self, sub: NewSubscription, epoch_id: int, *, site_cap: int | None = None, crew_cap: int | None = None
    ) -> str:
        """The count and the insert run in ONE transaction under a transaction-scoped advisory lock on (site, epoch).

        Read committed lets two concurrent transactions both count ``cap - 1`` rows and both insert, so a check alone
        cannot hold a cap, and a single conditional ``INSERT ... SELECT ... WHERE count < cap`` has the same race (each
        statement's snapshot excludes the other's uncommitted row). The lock serializes the inserts of one site and
        epoch; every crew belongs to exactly one site, so the same lock guards the crew cap with no lock ordering to
        get wrong (no deadlock). It is taken only when a cap is given and is released at commit or rollback; the
        subscribe route is low-rate and the held section is two counts and an insert.
        """
        new_id = f"sub-{secrets.token_hex(8)}"
        statement = (
            insert(PushSubscription)
            .values(id=new_id, epoch_id=epoch_id, **sub.model_dump())
            .on_conflict_do_nothing(index_elements=[PushSubscription.epoch_id, PushSubscription.endpoint])
            .returning(PushSubscription.id)
        )
        existing = select(PushSubscription.id).where(
            PushSubscription.epoch_id == epoch_id, PushSubscription.endpoint == sub.endpoint
        )
        async with self._engine.begin() as connection:
            if site_cap is not None or crew_cap is not None:
                await connection.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
                    {"key": f"push-subscription:{sub.site_id}:{epoch_id}"},
                )
                known = (await connection.execute(existing)).scalar_one_or_none()
                if known is not None:
                    return str(known)  # a repeat is not counted against a cap
                await self._enforce_caps(connection, sub, epoch_id, site_cap, crew_cap)
            created = (await connection.execute(statement)).scalar_one_or_none()
            if created is not None:
                return str(created)
            return str((await connection.execute(existing)).scalar_one())

    async def _enforce_caps(
        self,
        connection: AsyncConnection,
        sub: NewSubscription,
        epoch_id: int,
        site_cap: int | None,
        crew_cap: int | None,
    ) -> None:
        if site_cap is not None:
            held = await self._count_in(
                connection, PushSubscription.site_id == sub.site_id, PushSubscription.epoch_id == epoch_id
            )
            if held >= site_cap:
                raise SubscriptionCapError("site")
        if crew_cap is not None and sub.crew_id is not None:
            held = await self._count_in(
                connection, PushSubscription.crew_id == sub.crew_id, PushSubscription.epoch_id == epoch_id
            )
            if held >= crew_cap:
                raise SubscriptionCapError("crew")

    async def id_for_endpoint(self, endpoint: str, epoch_id: int) -> str | None:
        statement = select(PushSubscription.id).where(
            PushSubscription.epoch_id == epoch_id, PushSubscription.endpoint == endpoint
        )
        async with self._engine.connect() as connection:
            found = (await connection.execute(statement)).scalar_one_or_none()
        return None if found is None else str(found)

    async def count_for_site(self, site_id: str, epoch_id: int) -> int:
        return await self._count(PushSubscription.site_id == site_id, PushSubscription.epoch_id == epoch_id)

    async def count_for_crew(self, crew_id: str, epoch_id: int) -> int:
        return await self._count(PushSubscription.crew_id == crew_id, PushSubscription.epoch_id == epoch_id)

    async def _count(self, *conditions: object) -> int:
        async with self._engine.connect() as connection:
            return await self._count_in(connection, *conditions)

    @staticmethod
    async def _count_in(connection: AsyncConnection, *conditions: object) -> int:
        statement = select(func.count()).select_from(PushSubscription).where(*conditions)  # type: ignore[arg-type]
        return int((await connection.execute(statement)).scalar_one())

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
