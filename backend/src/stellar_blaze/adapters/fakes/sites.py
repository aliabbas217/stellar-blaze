"""An in-memory site repository, epoch store and fixture store (the fake of ``ports.sites``)."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime

from stellar_blaze.adapters.fakes.audit import InMemoryAuditLog
from stellar_blaze.domain.plans.model import CrewMember, CrewSpec
from stellar_blaze.ports.audit import AuditEvent
from stellar_blaze.ports.sites import (
    CrewFixture,
    CrewNotFoundError,
    CrewRecord,
    EpochAudit,
    NotADemoSiteError,
    SiteFixture,
    SiteNotFoundError,
    SiteRecord,
    SiteSyntheticChangeError,
    spec_of,
)


@dataclass
class _Crew:
    record: CrewRecord
    members: list[CrewMember] = field(default_factory=list)


def _members(crew: CrewFixture) -> list[CrewMember]:
    return [CrewMember(m.days_on_site, m.days_away, m.away_reason, m.experienced, m.juvenile) for m in crew.members]


class InMemorySiteStore:
    """``SiteRepository``, ``EpochStore``, ``SiteFixtureStore`` and ``ReplayEpochSource`` over dicts. ``audit`` is where
    an epoch's ``demo_reset`` row goes (Postgres appends it in the epoch's own transaction); a store built without one
    refuses every call that would produce an audit event instead of silently dropping it. ``clock`` is the WALL clock
    that stamps each epoch's start (as the Postgres store does), so a test's manual clock is the replay clock's base."""

    def __init__(
        self, audit: InMemoryAuditLog | None = None, *, clock: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        self._audit = audit
        self._clock = clock
        self._epoch_started: dict[int, datetime] = {}
        self._sites: dict[str, SiteRecord] = {}
        self._crews: dict[str, _Crew] = {}
        self._epochs: dict[str, list[int]] = {}
        self._next_epoch = 1

    async def list_sites(self) -> Sequence[SiteRecord]:
        return [self._sites[i] for i in sorted(self._sites)]

    async def get_site(self, site_id: str) -> SiteRecord | None:
        return self._sites.get(site_id)

    async def list_crews(self, site_id: str) -> Sequence[CrewRecord]:
        return [c.record for _, c in sorted(self._crews.items()) if c.record.site_id == site_id]

    async def get_crew(self, crew_id: str) -> CrewRecord | None:
        crew = self._crews.get(crew_id)
        return None if crew is None else crew.record

    async def crew_spec(self, crew_id: str) -> CrewSpec:
        crew = self._crews.get(crew_id)
        if crew is None:
            raise CrewNotFoundError(crew_id)
        return spec_of(crew.record, crew.members)

    async def active_epoch(self, site_id: str) -> int:
        if site_id not in self._sites:
            raise SiteNotFoundError(site_id)
        return max(self._epochs[site_id])

    async def start_epoch(self, site_id: str, actor: str, *, audit: EpochAudit | None = None) -> int:
        site = self._sites.get(site_id)
        if site is None:
            raise SiteNotFoundError(site_id)
        if not site.synthetic:
            raise NotADemoSiteError(site_id)
        previous = max(self._epochs[site_id])
        new = self._allocate_epoch(site_id)
        if audit is not None:
            await self._require_audit().append(audit(previous, new))
        return new

    async def upsert_fixture(
        self, fixture: SiteFixture, actor: str, *, audit_events: Sequence[AuditEvent] = ()
    ) -> None:
        site = fixture.site
        stored = self._sites.get(site.id)
        if stored is not None and stored.synthetic != site.synthetic:
            raise SiteSyntheticChangeError(site.id, stored=stored.synthetic)
        if audit_events:
            self._require_audit()
        self._sites[site.id] = site
        if site.id not in self._epochs:
            self._allocate_epoch(site.id)
        for crew in fixture.crews:
            record = CrewRecord(
                id=crew.id,
                site_id=site.id,
                employer_id=site.employer_id,
                name=crew.name,
                task_label=crew.task_label,
                workload=crew.workload,
                shift=crew.shift,
                days_per_week=crew.days_per_week,
                member_count=len(crew.members),
            )
            self._crews[crew.id] = _Crew(record, _members(crew))
        for event in audit_events:
            await self._require_audit().append(event)

    def _require_audit(self) -> InMemoryAuditLog:
        if self._audit is None:
            raise RuntimeError("this InMemorySiteStore has no audit log: build it with one to record audit events")
        return self._audit

    async def current_epoch_start(self) -> datetime | None:
        starts = [
            self._epoch_started[epoch]
            for site_id, epochs in self._epochs.items()
            if self._sites[site_id].synthetic
            for epoch in epochs
        ]
        return max(starts, default=None)

    def _allocate_epoch(self, site_id: str) -> int:
        epoch = self._next_epoch
        self._next_epoch += 1
        self._epoch_started[epoch] = self._clock()
        self._epochs.setdefault(site_id, []).append(epoch)
        return epoch
