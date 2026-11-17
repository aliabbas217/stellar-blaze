"""In-memory ``DayPlanStore``, ``CrewStopStore`` and ``PlanSignoffStore``."""

import itertools
from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime

from stellar_blaze.ports.plans import (
    CrewStopRecord,
    DayPlanInput,
    DayPlanRecord,
    PlanSignoffInput,
    PlanSignoffRecord,
)


class InMemoryDayPlanStore:
    def __init__(self, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._clock = clock
        self.records: list[DayPlanRecord] = []

    async def insert(self, record: DayPlanInput) -> DayPlanRecord:
        stored = DayPlanRecord(**record.model_dump(), id=len(self.records) + 1, created_at=self._clock())
        self.records.append(stored)
        return stored

    async def latest(self, crew_id: str, local_date: date, epoch_id: int) -> DayPlanRecord | None:
        for record in reversed(self.records):
            if (record.crew_id, record.local_date, record.epoch_id) == (crew_id, local_date, epoch_id):
                return record
        return None


class InMemoryCrewStopStore:
    def __init__(self, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._clock = clock
        self._ids = itertools.count(1)
        self._stops: dict[str, CrewStopRecord] = {}

    async def start(self, crew_id: str, reason_code: str, actor: str, epoch_id: int) -> CrewStopRecord:
        stop = CrewStopRecord(
            id=f"stop-{next(self._ids):08d}",
            crew_id=crew_id,
            epoch_id=epoch_id,
            started_at=self._clock(),
            cleared_at=None,
            reason_code=reason_code,
            actor=actor,
        )
        self._stops[stop.id] = stop
        return stop

    async def clear(self, stop_id: str, actor: str) -> None:
        stop = self._stops.get(stop_id)
        if stop is not None and stop.cleared_at is None:
            self._stops[stop_id] = stop.model_copy(update={"cleared_at": self._clock(), "cleared_by": actor})

    async def get(self, stop_id: str) -> CrewStopRecord | None:
        return self._stops.get(stop_id)

    async def active(self, crew_id: str, epoch_id: int) -> CrewStopRecord | None:
        open_stops = [
            s for s in self._stops.values() if s.crew_id == crew_id and s.epoch_id == epoch_id and s.cleared_at is None
        ]
        return max(open_stops, key=lambda s: s.started_at, default=None)

    async def active_between(
        self, crew_id: str, start: datetime, end: datetime, epoch_id: int
    ) -> Sequence[CrewStopRecord]:
        found = [
            s
            for s in self._stops.values()
            if s.crew_id == crew_id
            and s.epoch_id == epoch_id
            and s.started_at < end
            and (s.cleared_at is None or s.cleared_at > start)
        ]
        return sorted(found, key=lambda s: s.started_at)


class InMemoryPlanSignoffStore:
    def __init__(self, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._clock = clock
        self.records: list[PlanSignoffRecord] = []

    async def insert(self, record: PlanSignoffInput) -> PlanSignoffRecord:
        stored = PlanSignoffRecord(**record.model_dump(), id=len(self.records) + 1, signed_at=self._clock())
        self.records.append(stored)
        return stored

    async def latest(self, crew_id: str, local_date: date, epoch_id: int) -> PlanSignoffRecord | None:
        for record in reversed(self.records):
            if (record.crew_id, record.local_date, record.epoch_id) == (crew_id, local_date, epoch_id):
                return record
        return None
