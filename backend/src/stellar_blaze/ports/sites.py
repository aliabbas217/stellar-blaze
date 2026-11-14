"""Ports of the sites, their crews and the demo epochs (ADR 0057, 0065, 0066).

Sites, crews and crew members are static fixture configuration shared by every epoch (``sb-jobs site load`` writes
them); only the rows an actor creates (stops, sign-offs, plans, alert events, subscriptions, data-request audit rows)
are epoch-scoped. A site's active epoch is its highest ``epoch_id``; a non-synthetic site only ever has epoch 1.
"""

import re
from collections.abc import Callable, Sequence
from datetime import time
from typing import Literal, Protocol, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from stellar_blaze.domain.plans.model import CrewMember, CrewSpec, ShiftBlock, Workload
from stellar_blaze.ports.audit import AuditEvent

E164 = re.compile(r"^\+[1-9][0-9]{6,14}$")
DAY_START = time(4, 0)
DAY_END = time(22, 0)  # the planner's day grid is 04:00-22:00 local (domain.plans.ticks)


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class SiteRecord(_Frozen):
    """A site as stored. ``supervisor_phone`` and ``first_aider_phone`` are E.164 or ``None`` (ADR 0065)."""

    id: str
    name: str
    timezone: str
    station: str
    lat: float
    lon: float
    employer_id: str
    synthetic: bool
    supervisor_phone: str | None = None
    first_aider_phone: str | None = None

    @field_validator("supervisor_phone", "first_aider_phone")
    @classmethod
    def _e164(cls, value: str | None) -> str | None:
        if value is not None and not E164.fullmatch(value):
            raise ValueError("a phone number is E.164: '+' and 7 to 15 digits, the first not 0")
        return value


class CrewRecord(_Frozen):
    """A crew as the API lists it: an aggregate (``member_count``), never a member."""

    id: str
    site_id: str
    employer_id: str
    name: str
    task_label: str
    workload: Workload
    shift: tuple[ShiftBlock, ...]
    days_per_week: int
    member_count: int


class MemberFixture(_Frozen):
    """One member row of the fixture. PERSONAL data class (ADR 0010 section 8): never leaves ``crew_member``."""

    days_on_site: int = Field(ge=0)
    days_away: int = Field(ge=0)
    away_reason: Literal["leave", "illness", "none"] = "none"
    experienced: bool = True
    juvenile: bool = False

    @model_validator(mode="after")
    def _a_return_has_a_reason(self) -> Self:
        if (self.away_reason == "none") != (self.days_away == 0):
            raise ValueError("days_away > 0 needs away_reason leave or illness, and away_reason none needs days_away 0")
        return self


class CrewFixture(_Frozen):
    id: str
    name: str
    task_label: str
    workload: Workload
    shift: tuple[ShiftBlock, ...]
    days_per_week: int = Field(ge=1, le=7)
    headcount: int = Field(ge=1)
    members: tuple[MemberFixture, ...]

    @model_validator(mode="after")
    def _members_and_shift_are_plannable(self) -> Self:
        """Refuse what the planner would raise on or silently truncate (the day grid is 04:00-22:00 local)."""
        if len(self.members) != self.headcount:
            raise ValueError(
                f"crew {self.id}: headcount is {self.headcount} but {len(self.members)} members are listed"
            )
        if not self.shift:
            raise ValueError(f"crew {self.id} has no shift block")
        previous_end = DAY_START
        for block in self.shift:
            if not block.start < block.end:
                raise ValueError(f"crew {self.id}: shift block {block.start}-{block.end} must start before it ends")
            if block.start < previous_end:
                raise ValueError(f"crew {self.id}: shift blocks must be sorted and must not overlap ({block.start})")
            if block.end > DAY_END:
                raise ValueError(f"crew {self.id}: shift block ends after {DAY_END:%H:%M} ({block.end})")
            previous_end = block.end
        return self


class SiteFixture(_Frozen):
    """``backend/fixtures/demo_site.toml`` parsed (ADR 0057 section 2): one site and its crews."""

    site: SiteRecord
    crews: tuple[CrewFixture, ...]
    # ADR 0057: the demo site's commute (45 min). The plans scoring reads it from the file; it is not stored.
    commute_minutes: int | None = Field(default=None, ge=0)


class SiteNotFoundError(LookupError):
    """No site has this id."""

    def __init__(self, site_id: str) -> None:
        super().__init__(f"site {site_id!r} does not exist")
        self.site_id = site_id


class CrewNotFoundError(LookupError):
    """No crew has this id."""

    def __init__(self, crew_id: str) -> None:
        super().__init__(f"crew {crew_id!r} does not exist")
        self.crew_id = crew_id


class NotADemoSiteError(Exception):
    """A demo reset (``start_epoch``) was asked for a site whose ``synthetic`` flag is false (ADR 0066 decision 4)."""

    def __init__(self, site_id: str) -> None:
        super().__init__(f"site {site_id!r} is not a demo site: only a synthetic site can start a new epoch")
        self.site_id = site_id


type EpochAudit = Callable[[int, int], AuditEvent]
"""``(previous_epoch_id, new_epoch_id) -> AuditEvent``: the ``demo_reset`` row appended in the epoch's transaction."""


class SiteRepository(Protocol):
    """Read side: sites, crews, crew specs and the active epoch."""

    async def list_sites(self) -> Sequence[SiteRecord]:
        """Every site, by id."""
        ...

    async def get_site(self, site_id: str) -> SiteRecord | None:
        """The site, or ``None``."""
        ...

    async def list_crews(self, site_id: str) -> Sequence[CrewRecord]:
        """The site's crews by id (empty for an unknown site)."""
        ...

    async def get_crew(self, crew_id: str) -> CrewRecord | None:
        """The crew, or ``None``."""
        ...

    async def crew_spec(self, crew_id: str) -> CrewSpec:
        """The crew as the planner takes it, members included (members in ``crew_member.id`` order).

        Raises:
            CrewNotFoundError: There is no such crew.
        """
        ...

    async def active_epoch(self, site_id: str) -> int:
        """The site's active epoch: its highest ``epoch_id``.

        Raises:
            SiteNotFoundError: There is no such site.
        """
        ...


class EpochStore(Protocol):
    """Demo epochs (ADR 0066): a reset starts a new epoch; nothing is deleted."""

    async def start_epoch(self, site_id: str, actor: str, *, audit: EpochAudit | None = None) -> int:
        """Start a new epoch of a synthetic site and return its id (greater than the previous one).

        If ``audit`` is given, the event it returns is appended to the audit chain in the same transaction.

        Raises:
            SiteNotFoundError: There is no such site.
            NotADemoSiteError: The site is not synthetic. Nothing was written.
        """
        ...


class SiteFixtureStore(Protocol):
    """Write side of ``sb-jobs site load``: an idempotent upsert of a site, its crews and members."""

    async def upsert_fixture(
        self, fixture: SiteFixture, actor: str, *, audit_events: Sequence[AuditEvent] = ()
    ) -> None:
        """Write the fixture so the stored site, crews and members equal it; a new site gets epoch 1. Idempotent.

        ``audit_events`` are appended to the audit chain in the same transaction, so a change and its record commit or
        roll back together.
        """
        ...


def spec_of(crew: CrewRecord, members: Sequence[CrewMember]) -> CrewSpec:
    """The planner's ``CrewSpec`` of a stored crew; ``headcount`` is the member count."""
    return CrewSpec(
        crew_id=crew.id,
        employer_id=crew.employer_id,
        workload=crew.workload,
        headcount=len(members),
        shift=crew.shift,
        days_per_week=crew.days_per_week,
        members=tuple(members),
    )
