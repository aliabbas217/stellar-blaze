"""``sb-jobs site load``: an idempotent upsert of the site fixture that audits what changed (ADR 0054, 0057).

One ``input.changed`` audit row per changed site-level or crew-level field, written in the same transaction as the
change. Member changes are recorded as counts only (``headcount_before``, ``headcount_after``, ``rows_changed``):
members are PERSONAL data (ADR 0010 section 8) and an audit row names no person, so no member value reaches the log.
A phone number is recorded as ``set`` or ``unset``. Loading an unchanged fixture writes nothing.
"""

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass

from pydantic import JsonValue

from stellar_blaze.domain.plans.model import CrewMember, ShiftBlock
from stellar_blaze.ports.audit import AuditEvent
from stellar_blaze.ports.sites import CrewFixture, SiteFixture, SiteFixtureStore, SiteRecord, SiteRepository

_SITE_FIELDS = ("name", "timezone", "station", "lat", "lon", "employer_id", "synthetic")
_PHONE_FIELDS = ("supervisor_phone", "first_aider_phone")


@dataclass(frozen=True)
class SiteLoadResult:
    site_id: str
    created: bool
    changes: int  # the number of input.changed rows written


def _shift_text(shift: tuple[ShiftBlock, ...]) -> str:
    return ",".join(f"{b.start:%H:%M}-{b.end:%H:%M}" for b in shift)


def _show(value: object) -> JsonValue:
    """A JSON-safe, float-free form of a field value (an audit detail never holds a float)."""
    if isinstance(value, bool | int | str) or value is None:
        return value
    return str(value)


def _member_key(member: CrewMember) -> tuple[int, int, str, bool, bool]:
    return (member.days_on_site, member.days_away, member.away_reason, member.experienced, member.juvenile)


def _event(site: SiteRecord, actor: str, reason: str, detail: dict[str, JsonValue]) -> AuditEvent:
    return AuditEvent(
        kind="input.changed",
        actor=actor,
        actor_role="operator",
        employer_id=site.employer_id,
        site_id=site.id,
        outcome="applied",
        detail={**detail, "reason": reason},
    )


async def load_site(
    fixture: SiteFixture,
    *,
    sites: SiteRepository,
    store: SiteFixtureStore,
    actor: str,
    reason: str,
) -> SiteLoadResult:
    """Upsert ``fixture`` and audit the difference from what is stored."""
    site = fixture.site
    events: list[AuditEvent] = []

    def record(scope: str, target: str, field: str, **values: JsonValue) -> None:
        events.append(_event(site, actor, reason, {"scope": scope, "target": target, "field": field, **values}))

    existing = await sites.get_site(site.id)
    if existing is None:
        record("site", site.id, "created")
    else:
        for name in _SITE_FIELDS:
            before, after = getattr(existing, name), getattr(site, name)
            if before != after:
                record("site", site.id, name, before=_show(before), after=_show(after))
        for name in _PHONE_FIELDS:
            before, after = getattr(existing, name), getattr(site, name)
            if before != after:
                record("site", site.id, name, before="set" if before else "unset", after="set" if after else "unset")

    for crew in fixture.crews:
        await _diff_crew(sites, crew, record)

    await store.upsert_fixture(fixture, actor, audit_events=events)
    return SiteLoadResult(site_id=site.id, created=existing is None, changes=len(events))


type RecordFn = Callable[..., None]


async def _diff_crew(sites: SiteRepository, crew: CrewFixture, record: RecordFn) -> None:
    wanted = [CrewMember(m.days_on_site, m.days_away, m.away_reason, m.experienced, m.juvenile) for m in crew.members]
    stored_crew = await sites.get_crew(crew.id)
    if stored_crew is None:
        record("crew", crew.id, "created", headcount_after=len(wanted))
        return
    for name in ("name", "task_label", "workload", "days_per_week"):
        before, after = getattr(stored_crew, name), getattr(crew, name)
        if before != after:
            record("crew", crew.id, name, before=_show(before), after=_show(after))
    if stored_crew.shift != crew.shift:
        record("crew", crew.id, "shift", before=_shift_text(stored_crew.shift), after=_shift_text(crew.shift))
    stored = await sites.crew_spec(crew.id)
    before_members = Counter(_member_key(m) for m in (stored.members or ()))
    after_members = Counter(_member_key(m) for m in wanted)
    if before_members != after_members:
        changed = sum(((before_members - after_members) + (after_members - before_members)).values())
        record(
            "crew",
            crew.id,
            "members",
            headcount_before=sum(before_members.values()),
            headcount_after=sum(after_members.values()),
            rows_changed=changed,
        )
