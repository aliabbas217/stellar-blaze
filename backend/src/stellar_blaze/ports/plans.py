"""Ports of the plan decisions: stored day plans, crew-lead stops and supervisor sign-offs (all epoch-scoped).

A decision row carries the five identity fields (ruleset id and hash, model id, config version id and hash) and the
epoch. ``day_plan`` and ``plan_signoff`` are append-only; a stop is cleared by setting ``cleared_at`` once.
"""

from collections.abc import Sequence
from datetime import date, datetime
from typing import Literal, Protocol

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, JsonValue


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class _Identity(_Frozen):
    ruleset_id: str
    ruleset_sha256: str
    model_id: str | None
    config_version_id: int
    config_sha256: str


class DayPlanInput(_Identity):
    epoch_id: int
    crew_id: str
    local_date: date
    status: Literal["rule", "fallback"]
    plan: dict[str, JsonValue]
    violations: int = Field(default=0, ge=0)


class DayPlanRecord(DayPlanInput):
    id: int
    created_at: AwareDatetime


class DayPlanStore(Protocol):
    async def insert(self, record: DayPlanInput) -> DayPlanRecord:
        """Append a plan decision."""
        ...

    async def latest(self, crew_id: str, local_date: date, epoch_id: int) -> DayPlanRecord | None:
        """The newest stored plan of the crew for the date in the epoch, or ``None``."""
        ...


class CrewStopRecord(_Frozen):
    """A crew-lead stop. It names the crew, never a member."""

    id: str
    crew_id: str
    epoch_id: int
    started_at: AwareDatetime
    cleared_at: AwareDatetime | None
    reason_code: str
    actor: str
    cleared_by: str | None = None


class CrewStopStore(Protocol):
    async def start(self, crew_id: str, reason_code: str, actor: str, epoch_id: int) -> CrewStopRecord:
        """Record a stop that starts now."""
        ...

    async def clear(self, stop_id: str, actor: str) -> None:
        """End the stop now; idempotent (a cleared or unknown stop is left as it is, the first clearing stands)."""
        ...

    async def get(self, stop_id: str) -> CrewStopRecord | None:
        """The stop, or ``None``."""
        ...

    async def active(self, crew_id: str, epoch_id: int) -> CrewStopRecord | None:
        """The newest not-yet-cleared stop of the crew in the epoch, or ``None``."""
        ...

    async def active_between(
        self, crew_id: str, start: datetime, end: datetime, epoch_id: int
    ) -> Sequence[CrewStopRecord]:
        """The crew's stops in the epoch that overlap ``[start, end)``: ``started_at < end`` and not cleared before
        ``start`` (``cleared_at`` is ``None`` or ``> start``), oldest first."""
        ...


class PlanSignoffInput(_Identity):
    epoch_id: int
    crew_id: str
    local_date: date
    actor: str
    actor_role: str
    acknowledged_items: list[str]
    deviation_reason_code: str | None
    plan_hash: str


class PlanSignoffRecord(PlanSignoffInput):
    id: int
    signed_at: AwareDatetime


class PlanSignoffStore(Protocol):
    async def insert(self, record: PlanSignoffInput) -> PlanSignoffRecord:
        """Append a sign-off (the latest per epoch, crew and date is the current one)."""
        ...

    async def latest(self, crew_id: str, local_date: date, epoch_id: int) -> PlanSignoffRecord | None:
        """The current sign-off, or ``None``."""
        ...
