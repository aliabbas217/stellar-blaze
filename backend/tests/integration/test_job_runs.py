from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from pydantic import JsonValue
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from stellar_blaze.adapters.db.job_runs import JobRunNotRunningError, JobRunRepository, advisory_lock
from stellar_blaze.adapters.db.tables import JobRun
from stellar_blaze.config import Settings
from stellar_blaze.logging import configure_logging
from tests.unit.adapters.http_support import json_lines


async def load(engine: AsyncEngine, run_id: UUID) -> JobRun:
    async with AsyncSession(engine) as session:
        run = await session.get(JobRun, run_id)
    assert run is not None
    return run


async def held_advisory_locks(engine: AsyncEngine) -> list[str]:
    """The state of every session that currently holds an advisory lock (so the holder's own query is excluded)."""
    async with engine.connect() as connection:
        result = await connection.execute(
            text(
                "SELECT a.state FROM pg_locks l JOIN pg_stat_activity a USING (pid) "
                "WHERE l.locktype = 'advisory' AND l.granted"
            )
        )
        return [row.state for row in result]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_job_run_lifecycle(engine: AsyncEngine) -> None:
    runs = JobRunRepository(engine)
    params: dict[str, JsonValue] = {"stations": ["OMAA", "OMDB"], "days": 2, "dry_run": False}

    run_id = await runs.start("ingest-forecasts", params, "1.2.3")

    assert isinstance(run_id, UUID)
    started = await load(engine, run_id)
    assert started.status == "running"
    assert started.job_name == "ingest-forecasts"
    assert started.params == params
    assert started.code_version == "1.2.3"
    assert started.finished_at is None
    assert started.summary is None
    assert started.error is None

    await runs.finish(run_id, "succeeded", {"rows": 3}, None)

    finished = await load(engine, run_id)
    assert finished.status == "succeeded"
    assert finished.summary == {"rows": 3}
    assert finished.error is None
    assert finished.finished_at is not None
    assert timedelta(0) <= finished.finished_at - finished.started_at < timedelta(seconds=30)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_failed_run_keeps_the_error_and_stores_no_summary_as_sql_null(engine: AsyncEngine) -> None:
    runs = JobRunRepository(engine)
    run_id = await runs.start("train", {}, None)

    await runs.finish(run_id, "failed", None, "ValueError: no rows")

    failed = await load(engine, run_id)
    assert failed.status == "failed"
    assert failed.error == "ValueError: no rows"
    assert failed.code_version is None
    async with engine.connect() as connection:
        # JSON null and SQL NULL are different values; a missing summary must be the latter.
        query = text("SELECT summary IS NULL FROM job_run WHERE id = :id")
        is_sql_null = (await connection.execute(query, {"id": run_id})).scalar_one()
    assert is_sql_null is True


@pytest.mark.integration
@pytest.mark.asyncio
async def test_finish_refuses_a_run_that_is_not_running(engine: AsyncEngine) -> None:
    runs = JobRunRepository(engine)
    run_id = await runs.start("ingest", {}, None)
    await runs.finish(run_id, "succeeded", None, None)

    with pytest.raises(JobRunNotRunningError):
        await runs.finish(run_id, "failed", None, "late")
    with pytest.raises(JobRunNotRunningError):
        await runs.finish(uuid4(), "succeeded", None, None)

    assert (await load(engine, run_id)).status == "succeeded"  # the first outcome stands


@pytest.mark.integration
@pytest.mark.asyncio
async def test_record_skipped_logs_an_instant_skipped_locked_run(engine: AsyncEngine) -> None:
    run_id = await JobRunRepository(engine).record_skipped("ingest", {"day": "2026-11-11"})

    skipped = await load(engine, run_id)
    assert skipped.status == "skipped_locked"
    assert skipped.params == {"day": "2026-11-11"}
    assert skipped.finished_at is not None


@pytest.mark.integration
@pytest.mark.asyncio
async def test_advisory_lock_is_exclusive(engine: AsyncEngine) -> None:
    async with advisory_lock(engine, "ingest") as first:
        assert first is True
        async with advisory_lock(engine, "ingest") as second:
            assert second is False
        async with advisory_lock(engine, "train") as other_key:
            assert other_key is True

    async with advisory_lock(engine, "ingest") as again:
        assert again is True


@pytest.mark.integration
@pytest.mark.asyncio
async def test_advisory_lock_is_released_when_the_body_raises(engine: AsyncEngine) -> None:
    async def crash_while_holding_the_lock() -> None:
        async with advisory_lock(engine, "ingest") as acquired:
            assert acquired
            msg = "job crashed"
            raise RuntimeError(msg)

    with pytest.raises(RuntimeError, match="job crashed"):
        await crash_while_holding_the_lock()

    assert await held_advisory_locks(engine) == []
    async with advisory_lock(engine, "ingest") as again:
        assert again is True


@pytest.mark.integration
@pytest.mark.asyncio
async def test_advisory_lock_does_not_hold_a_transaction_open(engine: AsyncEngine) -> None:
    # A job can run for minutes; an "idle in transaction" session would pin a snapshot and block vacuum for that long.
    async with advisory_lock(engine, "ingest"):
        assert await held_advisory_locks(engine) == ["idle"]
    assert await held_advisory_locks(engine) == []


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_connection_that_lost_the_lock_race_is_not_left_holding_one(engine: AsyncEngine) -> None:
    async with advisory_lock(engine, "ingest"):
        async with advisory_lock(engine, "ingest") as second:
            assert second is False
        # The loser's connection went back to the pool without taking the lock; only the holder's session has it.
        assert len(await held_advisory_locks(engine)) == 1


async def terminate_lock_holders(engine: AsyncEngine) -> None:
    """Kill the database session that holds an advisory lock, as a failover or an idle cut-off would."""
    async with engine.connect() as connection:
        await connection.execute(
            text(
                "SELECT pg_terminate_backend(pid) FROM pg_locks l JOIN pg_stat_activity a USING (pid) "
                "WHERE l.locktype = 'advisory' AND l.granted AND pid <> pg_backend_pid()"
            )
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_failed_unlock_does_not_fail_a_job_that_succeeded(
    engine: AsyncEngine, settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging(settings)

    async with advisory_lock(engine, "ingest") as acquired:
        assert acquired
        await terminate_lock_holders(engine)  # the unlock on exit now fails: the session is gone
    # reaching this line is the point: the block exited without raising

    lost = [line for line in json_lines(capsys.readouterr().out) if line["event"] == "advisory lock lost"]
    assert len(lost) == 1
    assert lost[0]["level"] == "error"
    assert lost[0]["key"] == "ingest"
    assert await held_advisory_locks(engine) == []
    async with advisory_lock(engine, "ingest") as again:  # the dead connection did not go back to the pool
        assert again is True


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_failed_unlock_does_not_mask_the_exception_of_the_body(engine: AsyncEngine) -> None:
    async def crash_after_losing_the_session() -> None:
        async with advisory_lock(engine, "ingest") as acquired:
            assert acquired
            await terminate_lock_holders(engine)
            msg = "job crashed"
            raise RuntimeError(msg)

    with pytest.raises(RuntimeError, match="job crashed"):
        await crash_after_losing_the_session()

    assert await held_advisory_locks(engine) == []
