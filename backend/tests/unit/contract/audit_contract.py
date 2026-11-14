"""Contract suite of ``AuditLog`` (fake in unit, Postgres in integration)."""

import asyncio

import pytest

from stellar_blaze.domain.audit import ZERO_HASH
from stellar_blaze.ports.audit import WORKER_VISIBLE_KINDS, AuditEvent, AuditKind
from tests.unit.contract.b3_world import SITE_ID, Check, World, seeded


def event(
    kind: AuditKind = "data_request.refused", *, epoch_id: int | None, site_id: str | None = SITE_ID, tag: str = "x"
) -> AuditEvent:
    return AuditEvent(
        kind=kind,
        actor="emp-token",
        actor_role="employer",
        employer_id="emp-demo",
        site_id=site_id,
        epoch_id=epoch_id,
        outcome="refused",
        detail={"rule": "ADR 0004; PDPL purpose limitation", "tag": tag},
        ruleset_id="ae-heat-2026.1",
        ruleset_sha256="b" * 64,
        model_id=None,
    )


async def check_an_empty_log_verifies(world: World) -> None:
    assert await world.audit.verify() is None


async def check_rows_are_chained_from_64_zeros(world: World) -> None:
    epoch = await seeded(world)

    first = await world.audit.append(event(epoch_id=epoch, tag="1"))
    second = await world.audit.append(event(epoch_id=epoch, tag="2"))

    assert first.prev_hash == ZERO_HASH
    assert second.prev_hash == first.row_hash
    assert len({first.row_hash, second.row_hash}) == 2
    assert second.id > first.id
    assert (first.kind, first.actor, first.epoch_id, first.ruleset_sha256) == (
        "data_request.refused",
        "emp-token",
        epoch,
        "b" * 64,
    )
    assert first.at.utcoffset() is not None
    assert await world.audit.verify() is None


async def check_site_entries_are_filtered_by_site_kind_and_epoch_newest_first(world: World) -> None:
    epoch = await seeded(world)
    other = await world.sites.start_epoch(SITE_ID, "demo-token")
    await world.audit.append(event(epoch_id=epoch, tag="old-1"))
    await world.audit.append(event(epoch_id=other, tag="new-1"))
    await world.audit.append(event(epoch_id=other, tag="new-2"))
    await world.audit.append(event("demo_reset", epoch_id=None, tag="reset"))
    await world.audit.append(event("access.denied", epoch_id=other, tag="denied"))
    await world.audit.append(event(epoch_id=None, site_id=None, tag="no-site"))

    new = await world.audit.site_entries(SITE_ID, WORKER_VISIBLE_KINDS, 50, epoch_id=other)
    old = await world.audit.site_entries(SITE_ID, WORKER_VISIBLE_KINDS, 50, epoch_id=epoch)
    limited = await world.audit.site_entries(SITE_ID, WORKER_VISIBLE_KINDS, 1, epoch_id=other)

    assert [r.detail["tag"] for r in new] == ["new-2", "new-1"]
    assert [r.detail["tag"] for r in old] == ["old-1"]
    assert [r.detail["tag"] for r in limited] == ["new-2"]
    assert await world.audit.site_entries("site-other", WORKER_VISIBLE_KINDS, 50, epoch_id=other) == []
    # demo_reset is never worker-visible: asking for the worker kinds never returns it.
    assert all(r.kind == "data_request.refused" for r in new)
    with pytest.raises(ValueError, match="limit"):
        await world.audit.site_entries(SITE_ID, WORKER_VISIBLE_KINDS, 0, epoch_id=other)


async def check_concurrent_appends_keep_one_chain(world: World) -> None:
    epoch = await seeded(world)

    rows = await asyncio.gather(*(world.audit.append(event(epoch_id=epoch, tag=str(i))) for i in range(20)))

    assert await world.audit.verify() is None
    by_id = sorted(rows, key=lambda r: r.id)
    assert [r.prev_hash for r in by_id[1:]] == [r.row_hash for r in by_id[:-1]]  # one chain, no fork
    assert len({r.prev_hash for r in rows}) == 20  # no two rows share a predecessor


CHECKS: dict[str, Check] = {
    name.removeprefix("check_"): fn for name, fn in sorted(globals().items()) if name.startswith("check_")
}
