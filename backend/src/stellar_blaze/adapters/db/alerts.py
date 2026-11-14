"""The Postgres ``AlertStore`` over the append-only ``alert_event`` table (ADR 0058 decision 1)."""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.adapters.db.tables import AlertEvent
from stellar_blaze.ports.alerts import AlertEventInput, AlertRecord

_COLUMNS = tuple(AlertEvent.__table__.columns)


class PostgresAlertStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def last_for_target(self, site_id: str, crew_id: str | None, epoch_id: int) -> AlertRecord | None:
        crew_filter = AlertEvent.crew_id.is_(None) if crew_id is None else AlertEvent.crew_id == crew_id
        statement = (
            select(*_COLUMNS)
            .where(AlertEvent.epoch_id == epoch_id, AlertEvent.site_id == site_id, crew_filter)
            .order_by(AlertEvent.id.desc())
            .limit(1)
        )
        async with self._engine.connect() as connection:
            row = (await connection.execute(statement)).mappings().first()
        return None if row is None else AlertRecord.model_validate(dict(row))

    async def exists(self, epoch_id: int, dedupe_key: str) -> bool:
        statement = (
            select(AlertEvent.id).where(AlertEvent.epoch_id == epoch_id, AlertEvent.dedupe_key == dedupe_key).limit(1)
        )
        async with self._engine.connect() as connection:
            return (await connection.execute(statement)).first() is not None

    async def insert(self, event: AlertEventInput) -> AlertRecord | None:
        statement = (
            insert(AlertEvent)
            .values(**event.model_dump(mode="json") | {"valid_from": event.valid_from, "level": event.level.value})
            .on_conflict_do_nothing(index_elements=[AlertEvent.epoch_id, AlertEvent.dedupe_key])
            .returning(*_COLUMNS)
        )
        async with self._engine.begin() as connection:
            row = (await connection.execute(statement)).mappings().first()
        return None if row is None else AlertRecord.model_validate(dict(row))
