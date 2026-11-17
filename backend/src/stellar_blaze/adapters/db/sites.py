"""The Postgres site repository, epoch store and fixture store (ADR 0057, 0065, 0066).

``crew_member`` rows are PERSONAL data (ADR 0010 section 8): they are read only by ``crew_spec`` and written only by
``upsert_fixture``; nothing here returns one except inside a ``CrewSpec``.
"""

from collections.abc import Callable, Sequence
from datetime import UTC, datetime, time

from pydantic import JsonValue
from sqlalchemy import RowMapping, delete, func, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from stellar_blaze.adapters.db.audit import append_in, utc_now
from stellar_blaze.adapters.db.tables import Crew, SiteEpoch
from stellar_blaze.adapters.db.tables import CrewMember as CrewMemberRow
from stellar_blaze.adapters.db.tables import Site as SiteRow
from stellar_blaze.domain.plans.model import CrewMember, CrewSpec, ShiftBlock
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

_SITE_COLUMNS = (
    SiteRow.id,
    SiteRow.name,
    SiteRow.timezone,
    SiteRow.station,
    SiteRow.lat,
    SiteRow.lon,
    SiteRow.employer_id,
    SiteRow.synthetic,
    SiteRow.supervisor_phone,
    SiteRow.first_aider_phone,
)
_CREW_COLUMNS = (
    Crew.id,
    Crew.site_id,
    Crew.employer_id,
    Crew.name,
    Crew.task_label,
    Crew.workload,
    Crew.shift,
    Crew.days_per_week,
)
_MEMBER_COLUMNS = (
    CrewMemberRow.days_on_site,
    CrewMemberRow.days_away,
    CrewMemberRow.away_reason,
    CrewMemberRow.experienced,
    CrewMemberRow.juvenile,
)


def shift_to_json(shift: Sequence[ShiftBlock]) -> list[JsonValue]:
    """``[{"start": "06:00", "end": "11:00"}, ...]``: the stored form of a published shift."""
    return [{"start": block.start.strftime("%H:%M"), "end": block.end.strftime("%H:%M")} for block in shift]


def shift_from_json(raw: Sequence[JsonValue]) -> tuple[ShiftBlock, ...]:
    blocks: list[ShiftBlock] = []
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("start"), str) or not isinstance(item.get("end"), str):
            raise ValueError(f"a stored shift block is {{'start': 'HH:MM', 'end': 'HH:MM'}}, got {item!r}")
        blocks.append(ShiftBlock(time.fromisoformat(str(item["start"])), time.fromisoformat(str(item["end"]))))
    return tuple(blocks)


def _crew(row: RowMapping, member_count: int) -> CrewRecord:
    return CrewRecord(
        id=row["id"],
        site_id=row["site_id"],
        employer_id=row["employer_id"],
        name=row["name"],
        task_label=row["task_label"],
        workload=row["workload"],
        shift=shift_from_json(row["shift"]),
        days_per_week=row["days_per_week"],
        member_count=member_count,
    )


class PostgresSiteStore:
    """``SiteRepository``, ``EpochStore``, ``SiteFixtureStore`` and ``ReplayEpochSource`` over ``site``, ``crew``,
    ``crew_member`` and ``site_epoch``.

    ``clock`` is the application's WALL clock. It stamps the audit rows and each epoch's ``started_at`` (written
    explicitly, never the server's ``now()``): the replay clock reads ``anchor + (wall now - started_at)``, so the
    stored start and the wall clock it is subtracted from must share one time base."""

    def __init__(self, engine: AsyncEngine, *, clock: Callable[[], datetime] = utc_now) -> None:
        self._engine = engine
        self._clock = clock

    # --- SiteRepository -----------------------------------------------------------------------------------------

    async def list_sites(self) -> Sequence[SiteRecord]:
        async with self._engine.connect() as connection:
            rows = (await connection.execute(select(*_SITE_COLUMNS).order_by(SiteRow.id))).mappings().all()
        return [SiteRecord.model_validate(dict(row)) for row in rows]

    async def get_site(self, site_id: str) -> SiteRecord | None:
        async with self._engine.connect() as connection:
            row = (await connection.execute(select(*_SITE_COLUMNS).where(SiteRow.id == site_id))).mappings().first()
        return None if row is None else SiteRecord.model_validate(dict(row))

    async def list_crews(self, site_id: str) -> Sequence[CrewRecord]:
        counts = select(CrewMemberRow.crew_id, func.count().label("n")).group_by(CrewMemberRow.crew_id).subquery()
        statement = (
            select(*_CREW_COLUMNS, func.coalesce(counts.c.n, 0).label("member_count"))
            .outerjoin(counts, counts.c.crew_id == Crew.id)
            .where(Crew.site_id == site_id)
            .order_by(Crew.id)
        )
        async with self._engine.connect() as connection:
            rows = (await connection.execute(statement)).mappings().all()
        return [_crew(row, row["member_count"]) for row in rows]

    async def get_crew(self, crew_id: str) -> CrewRecord | None:
        async with self._engine.connect() as connection:
            row = (await connection.execute(select(*_CREW_COLUMNS).where(Crew.id == crew_id))).mappings().first()
            if row is None:
                return None
            count = (
                await connection.execute(select(func.count()).where(CrewMemberRow.crew_id == crew_id))
            ).scalar_one()
        return _crew(row, count)

    async def crew_spec(self, crew_id: str) -> CrewSpec:
        async with self._engine.connect() as connection:
            row = (await connection.execute(select(*_CREW_COLUMNS).where(Crew.id == crew_id))).mappings().first()
            if row is None:
                raise CrewNotFoundError(crew_id)
            members = await _members(connection, crew_id)
        return spec_of(_crew(row, len(members)), members)

    async def active_epoch(self, site_id: str) -> int:
        async with self._engine.connect() as connection:
            epoch = (
                await connection.execute(select(func.max(SiteEpoch.epoch_id)).where(SiteEpoch.site_id == site_id))
            ).scalar_one()
        if epoch is None:
            raise SiteNotFoundError(site_id)
        return int(epoch)

    # --- ReplayEpochSource --------------------------------------------------------------------------------------

    async def current_epoch_start(self) -> datetime | None:
        statement = (
            select(func.max(SiteEpoch.started_at))
            .join(SiteRow, SiteRow.id == SiteEpoch.site_id)
            .where(SiteRow.synthetic.is_(True))
        )
        async with self._engine.connect() as connection:
            started = (await connection.execute(statement)).scalar_one()
        return None if started is None else started.astimezone(UTC)

    # --- EpochStore ---------------------------------------------------------------------------------------------

    async def start_epoch(self, site_id: str, actor: str, *, audit: EpochAudit | None = None) -> int:
        async with self._engine.begin() as connection:
            # The row lock serialises two resets of one site; the new epoch is then previous + one or more.
            synthetic = (
                await connection.execute(select(SiteRow.synthetic).where(SiteRow.id == site_id).with_for_update())
            ).scalar_one_or_none()
            if synthetic is None:
                raise SiteNotFoundError(site_id)
            if not synthetic:
                raise NotADemoSiteError(site_id)
            previous = (
                await connection.execute(select(func.max(SiteEpoch.epoch_id)).where(SiteEpoch.site_id == site_id))
            ).scalar_one()
            new = (
                await connection.execute(
                    insert(SiteEpoch)
                    .values(site_id=site_id, started_at=self._clock(), started_by=actor)
                    .returning(SiteEpoch.epoch_id)
                )
            ).scalar_one()
            if audit is not None:
                await append_in(connection, audit(int(previous), int(new)), self._clock)
        return int(new)

    # --- SiteFixtureStore ---------------------------------------------------------------------------------------

    async def upsert_fixture(
        self, fixture: SiteFixture, actor: str, *, audit_events: Sequence[AuditEvent] = ()
    ) -> None:
        site = fixture.site
        async with self._engine.begin() as connection:
            # The site row lock is the serialisation point (`start_epoch` takes it too): the first writer of a new site
            # holds the unique-index entry until it commits, a second `upsert_fixture` waits there and then sees the
            # epoch row, so the "first epoch" check below cannot race.
            stored_synthetic = (
                await connection.execute(select(SiteRow.synthetic).where(SiteRow.id == site.id).with_for_update())
            ).scalar_one_or_none()
            if stored_synthetic is not None and stored_synthetic != site.synthetic:
                raise SiteSyntheticChangeError(site.id, stored=stored_synthetic)
            values = site.model_dump()
            await connection.execute(
                pg_insert(SiteRow)
                .values(**values)
                .on_conflict_do_update(index_elements=[SiteRow.id], set_={k: v for k, v in values.items() if k != "id"})
            )
            has_epoch = (
                await connection.execute(select(func.count()).where(SiteEpoch.site_id == site.id))
            ).scalar_one()
            if not has_epoch:
                await connection.execute(
                    insert(SiteEpoch).values(site_id=site.id, started_at=self._clock(), started_by=actor)
                )
            for crew in fixture.crews:
                await _upsert_crew(connection, site, crew)
            for event in audit_events:
                await append_in(connection, event, self._clock)


async def _members(connection: AsyncConnection, crew_id: str) -> list[CrewMember]:
    rows = (
        await connection.execute(
            select(*_MEMBER_COLUMNS).where(CrewMemberRow.crew_id == crew_id).order_by(CrewMemberRow.id)
        )
    ).mappings()
    return [
        CrewMember(
            days_on_site=row["days_on_site"],
            days_away=row["days_away"],
            away_reason=row["away_reason"],
            experienced=row["experienced"],
            juvenile=row["juvenile"],
        )
        for row in rows
    ]


async def _upsert_crew(connection: AsyncConnection, site: SiteRecord, crew: CrewFixture) -> None:
    values = {
        "id": crew.id,
        "site_id": site.id,
        "employer_id": site.employer_id,
        "name": crew.name,
        "task_label": crew.task_label,
        "workload": crew.workload,
        "shift": shift_to_json(crew.shift),
        "days_per_week": crew.days_per_week,
    }
    await connection.execute(
        pg_insert(Crew)
        .values(**values)
        .on_conflict_do_update(index_elements=[Crew.id], set_={k: v for k, v in values.items() if k != "id"})
    )
    wanted = [CrewMember(m.days_on_site, m.days_away, m.away_reason, m.experienced, m.juvenile) for m in crew.members]
    if await _members(connection, crew.id) == wanted:
        return  # unchanged: keep the rows (and their ids) as they are
    await connection.execute(delete(CrewMemberRow).where(CrewMemberRow.crew_id == crew.id))
    await connection.execute(
        insert(CrewMemberRow),
        [
            {
                "crew_id": crew.id,
                "days_on_site": m.days_on_site,
                "days_away": m.days_away,
                "away_reason": m.away_reason,
                "experienced": m.experienced,
                "juvenile": m.juvenile,
            }
            for m in wanted
        ],
    )
