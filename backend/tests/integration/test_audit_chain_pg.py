"""The Postgres audit chain (ADR 0054, ADR 0066): append-only by trigger, tamper-evident by hash, one chain under
concurrency, and the epoch id inside the hashed row (architect ruling R-P)."""

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.adapters.db.audit import PostgresAuditLog
from stellar_blaze.adapters.db.sites import PostgresSiteStore
from stellar_blaze.config import Settings
from stellar_blaze.ports.audit import ZERO_HASH, AuditEvent
from tests.integration.db_admin import fetch_all
from tests.unit.contract.audit_contract import event
from tests.unit.contract.b3_world import SITE_ID, demo_fixture

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest_asyncio.fixture
async def audit(engine: AsyncEngine) -> AsyncIterator[PostgresAuditLog]:
    await PostgresSiteStore(engine).upsert_fixture(demo_fixture(), "chain-test")
    yield PostgresAuditLog(engine)


def sql(settings: Settings, statement: str) -> list[dict[str, Any]]:
    return fetch_all(settings.database_url.get_secret_value(), statement)


async def three_rows(audit: PostgresAuditLog) -> list[int]:
    return [(await audit.append(event(epoch_id=1, tag=str(i)))).id for i in range(3)]


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_event SET outcome = 'allowed'",
        "DELETE FROM audit_event",
        "TRUNCATE audit_event",
    ],
)
async def test_audit_update_delete_truncate_refused(
    audit: PostgresAuditLog, engine: AsyncEngine, statement: str
) -> None:
    await audit.append(event(epoch_id=1))

    with pytest.raises(DBAPIError, match="append-only"):
        async with engine.begin() as connection:
            await connection.execute(text(statement))

    assert await audit.verify() is None
    assert len(await audit.site_entries(SITE_ID, ["data_request.refused"], 10, epoch_id=1)) == 1


async def test_verify_detects_edited_row(audit: PostgresAuditLog, settings: Settings) -> None:
    ids = await three_rows(audit)
    assert await audit.verify() is None

    # The owner can drop the trigger (ADR 0010 "Not doing now": separate DB roles) ...
    sql(settings, "DROP TRIGGER trg_audit_event_append_only ON audit_event")
    sql(settings, f'UPDATE audit_event SET detail = \'{{"rule": "forged"}}\'::jsonb WHERE id = {ids[1]}')  # noqa: S608

    # ... but not without breaking the chain at that row.
    assert await audit.verify() == ids[1]


@pytest.mark.parametrize(
    "assignment",
    [
        "epoch_id = 2",  # R-P: the epoch id is inside the hashed payload
        "actor = 'someone-else'",
        "at = at + interval '1 second'",
        "site_id = 'site-other'",
        "config_sha256 = repeat('e', 64)",
    ],
)
async def test_verify_detects_every_hashed_column(
    audit: PostgresAuditLog, engine: AsyncEngine, settings: Settings, assignment: str
) -> None:
    await PostgresSiteStore(engine).start_epoch(SITE_ID, "demo-token")  # epoch 2 exists for the edit
    ids = await three_rows(audit)
    sql(settings, "DROP TRIGGER trg_audit_event_append_only ON audit_event")

    sql(settings, f"UPDATE audit_event SET {assignment} WHERE id = {ids[2]}")  # noqa: S608

    assert await audit.verify() == ids[2]


async def test_verify_detects_a_deleted_row(audit: PostgresAuditLog, settings: Settings) -> None:
    ids = await three_rows(audit)
    sql(settings, "DROP TRIGGER trg_audit_event_append_only ON audit_event")

    sql(settings, f"DELETE FROM audit_event WHERE id = {ids[1]}")  # noqa: S608

    assert await audit.verify() == ids[2]


async def test_concurrent_appends_keep_one_chain(audit: PostgresAuditLog) -> None:
    rows = await asyncio.gather(*(audit.append(event(epoch_id=1, tag=str(i))) for i in range(20)))

    assert await audit.verify() is None
    by_id = sorted(rows, key=lambda r: r.id)
    assert by_id[0].prev_hash == ZERO_HASH
    assert [r.prev_hash for r in by_id[1:]] == [r.row_hash for r in by_id[:-1]]


async def test_a_detail_survives_the_jsonb_round_trip_with_the_same_hash(audit: PostgresAuditLog) -> None:
    detail: Any = {
        "z": 1,
        "a": [True, None, "café - 日本", {"nested": {"k": "v"}}],
        "big": 12345678901234567890,
        "neg": -7,
        "empty": {},
    }

    written = await audit.append(
        AuditEvent(kind="input.changed", actor="a", actor_role="operator", outcome="x", detail=detail)
    )

    assert await audit.verify() is None
    assert written.detail == detail


async def test_audit_verify_passes_after_start_epoch_and_demo_reset_row(
    audit: PostgresAuditLog, engine: AsyncEngine
) -> None:
    sites = PostgresSiteStore(engine)
    await audit.append(event(epoch_id=1, tag="before"))

    def demo_reset(previous: int, new: int) -> AuditEvent:
        return AuditEvent(
            kind="demo_reset",
            actor="demo-token",
            actor_role="employer",
            employer_id="emp-demo",
            site_id=SITE_ID,
            outcome="reset",
            detail={"previous_epoch_id": previous, "epoch_id": new},
        )

    new = await sites.start_epoch(SITE_ID, "demo-token", audit=demo_reset)
    await audit.append(event(epoch_id=new, tag="after"))

    assert await audit.verify() is None
    assert await audit.site_entries(SITE_ID, ["data_request.refused"], 10, epoch_id=1) != []  # old rows are still there
    # demo_reset carries no epoch of its own and is never worker-visible: the worker kinds never return it.
    assert await audit.site_entries(SITE_ID, ["data_request.refused"], 10, epoch_id=new) == [
        r
        for r in await audit.site_entries(SITE_ID, ["data_request.refused"], 10, epoch_id=new)
        if r.detail["tag"] == "after"
    ]


async def test_a_failed_start_epoch_audit_rolls_the_epoch_back(audit: PostgresAuditLog, engine: AsyncEngine) -> None:
    sites = PostgresSiteStore(engine)
    before = await sites.active_epoch(SITE_ID)

    def broken(previous: int, new: int) -> AuditEvent:
        raise RuntimeError("audit event could not be built")

    with pytest.raises(RuntimeError):
        await sites.start_epoch(SITE_ID, "demo-token", audit=broken)

    assert await sites.active_epoch(SITE_ID) == before
