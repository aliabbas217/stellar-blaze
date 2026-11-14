"""Postgres stores of day plans, crew stops and plan sign-offs (all epoch-scoped; ADR 0066)."""

import secrets
from collections.abc import Callable, Sequence
from datetime import date, datetime

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.adapters.db.audit import utc_now
from stellar_blaze.adapters.db.tables import CrewStop, DayPlan, PlanSignoff
from stellar_blaze.ports.plans import (
    CrewStopRecord,
    DayPlanInput,
    DayPlanRecord,
    PlanSignoffInput,
    PlanSignoffRecord,
)

_PLAN_COLUMNS = tuple(DayPlan.__table__.columns)
_STOP_COLUMNS = tuple(CrewStop.__table__.columns)
_SIGNOFF_COLUMNS = tuple(PlanSignoff.__table__.columns)


class PostgresDayPlanStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def insert(self, record: DayPlanInput) -> DayPlanRecord:
        statement = insert(DayPlan).values(**record.model_dump()).returning(*_PLAN_COLUMNS)
        async with self._engine.begin() as connection:
            row = (await connection.execute(statement)).mappings().one()
        return DayPlanRecord.model_validate(dict(row))

    async def latest(self, crew_id: str, local_date: date, epoch_id: int) -> DayPlanRecord | None:
        statement = (
            select(*_PLAN_COLUMNS)
            .where(DayPlan.epoch_id == epoch_id, DayPlan.crew_id == crew_id, DayPlan.local_date == local_date)
            .order_by(DayPlan.id.desc())
            .limit(1)
        )
        async with self._engine.connect() as connection:
            row = (await connection.execute(statement)).mappings().first()
        return None if row is None else DayPlanRecord.model_validate(dict(row))


class PostgresCrewStopStore:
    def __init__(self, engine: AsyncEngine, *, clock: Callable[[], datetime] = utc_now) -> None:
        self._engine = engine
        self._clock = clock

    async def start(self, crew_id: str, reason_code: str, actor: str, epoch_id: int) -> CrewStopRecord:
        statement = (
            insert(CrewStop)
            .values(
                id=f"stop-{secrets.token_hex(8)}",
                crew_id=crew_id,
                epoch_id=epoch_id,
                started_at=self._clock(),
                reason_code=reason_code,
                actor=actor,
            )
            .returning(*_STOP_COLUMNS)
        )
        async with self._engine.begin() as connection:
            row = (await connection.execute(statement)).mappings().one()
        return CrewStopRecord.model_validate(dict(row))

    async def clear(self, stop_id: str, actor: str) -> None:
        statement = (
            update(CrewStop)
            .where(CrewStop.id == stop_id, CrewStop.cleared_at.is_(None))
            .values(cleared_at=func.greatest(self._clock(), CrewStop.started_at), cleared_by=actor)
        )
        async with self._engine.begin() as connection:
            await connection.execute(statement)

    async def get(self, stop_id: str) -> CrewStopRecord | None:
        async with self._engine.connect() as connection:
            row = (await connection.execute(select(*_STOP_COLUMNS).where(CrewStop.id == stop_id))).mappings().first()
        return None if row is None else CrewStopRecord.model_validate(dict(row))

    async def active(self, crew_id: str, epoch_id: int) -> CrewStopRecord | None:
        statement = (
            select(*_STOP_COLUMNS)
            .where(CrewStop.epoch_id == epoch_id, CrewStop.crew_id == crew_id, CrewStop.cleared_at.is_(None))
            .order_by(CrewStop.started_at.desc())
            .limit(1)
        )
        async with self._engine.connect() as connection:
            row = (await connection.execute(statement)).mappings().first()
        return None if row is None else CrewStopRecord.model_validate(dict(row))

    async def active_between(
        self, crew_id: str, start: datetime, end: datetime, epoch_id: int
    ) -> Sequence[CrewStopRecord]:
        statement = (
            select(*_STOP_COLUMNS)
            .where(
                CrewStop.epoch_id == epoch_id,
                CrewStop.crew_id == crew_id,
                CrewStop.started_at < end,
                (CrewStop.cleared_at.is_(None)) | (CrewStop.cleared_at > start),
            )
            .order_by(CrewStop.started_at)
        )
        async with self._engine.connect() as connection:
            rows = (await connection.execute(statement)).mappings().all()
        return [CrewStopRecord.model_validate(dict(row)) for row in rows]


class PostgresPlanSignoffStore:
    """``signed_at`` is stamped by ``clock`` (the domain clock: the replay day in replay mode), not by the database."""

    def __init__(self, engine: AsyncEngine, *, clock: Callable[[], datetime] = utc_now) -> None:
        self._engine = engine
        self._clock = clock

    async def insert(self, record: PlanSignoffInput) -> PlanSignoffRecord:
        statement = (
            insert(PlanSignoff).values(**record.model_dump(), signed_at=self._clock()).returning(*_SIGNOFF_COLUMNS)
        )
        async with self._engine.begin() as connection:
            row = (await connection.execute(statement)).mappings().one()
        return PlanSignoffRecord.model_validate(dict(row))

    async def latest(self, crew_id: str, local_date: date, epoch_id: int) -> PlanSignoffRecord | None:
        statement = (
            select(*_SIGNOFF_COLUMNS)
            .where(
                PlanSignoff.epoch_id == epoch_id,
                PlanSignoff.crew_id == crew_id,
                PlanSignoff.local_date == local_date,
            )
            .order_by(PlanSignoff.id.desc())
            .limit(1)
        )
        async with self._engine.connect() as connection:
            row = (await connection.execute(statement)).mappings().first()
        return None if row is None else PlanSignoffRecord.model_validate(dict(row))
