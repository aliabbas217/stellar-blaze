"""Job run records and the cross-process lock that keeps two runs of one job from overlapping.

Jobs are idempotent Typer commands started by the platform scheduler (stack doc 3). Two guards complement each other:
``advisory_lock`` stops a second run from starting while one is active, and ``JobRunRepository`` leaves an audit row
for every attempt, including the ones that were turned away.
"""

from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from typing import Literal
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import func, insert, text, update
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.adapters.db.tables import JobRun


class JobRunNotRunningError(LookupError):
    """``finish`` was called for a run that does not exist or has already finished (a bug in the calling job)."""

    def __init__(self, run_id: UUID) -> None:
        super().__init__(f"job run {run_id} is not in status 'running'")
        self.run_id = run_id


class JobRunRepository:
    """Writes the ``job_run`` audit table. Every method is one short transaction of its own."""

    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def start(self, job_name: str, params: Mapping[str, JsonValue], code_version: str | None) -> UUID:
        """Record a run that has begun (status ``running``) and return its id."""
        statement = (
            insert(JobRun)
            .values(job_name=job_name, status="running", params=dict(params), code_version=code_version)
            .returning(JobRun.id)
        )
        async with self._engine.begin() as connection:
            return (await connection.execute(statement)).scalar_one()

    async def finish(
        self,
        run_id: UUID,
        status: Literal["succeeded", "failed"],
        summary: Mapping[str, JsonValue] | None,
        error: str | None,
    ) -> None:
        """Close a running run with its outcome; raises ``JobRunNotRunningError`` rather than update nothing."""
        statement = (
            update(JobRun)
            .where(JobRun.id == run_id, JobRun.status == "running")
            .values(
                status=status,
                finished_at=func.now(),
                summary=dict(summary) if summary is not None else None,
                error=error,
            )
        )
        async with self._engine.begin() as connection:
            result = await connection.execute(statement)
        if result.rowcount != 1:
            raise JobRunNotRunningError(run_id)

    async def record_skipped(self, job_name: str, params: Mapping[str, JsonValue]) -> UUID:
        """Record an attempt that found the job's advisory lock held (status ``skipped_locked``, finished at once)."""
        statement = (
            insert(JobRun)
            .values(job_name=job_name, status="skipped_locked", params=dict(params), finished_at=func.now())
            .returning(JobRun.id)
        )
        async with self._engine.begin() as connection:
            return (await connection.execute(statement)).scalar_one()


@asynccontextmanager
async def advisory_lock(engine: AsyncEngine, key: str) -> AsyncIterator[bool]:
    """Try to take the Postgres session-level advisory lock named ``key``; yield whether this caller now holds it.

    Never waits: a caller that yields ``False`` should skip its run (``record_skipped``). The lock lives on one
    dedicated connection for the whole block, in autocommit mode so that connection is not parked "idle in
    transaction" for the length of a job. It is released on exit, including when the body raises.
    """
    async with engine.connect() as connection:
        await connection.execution_options(isolation_level="AUTOCOMMIT")
        acquired: bool = (
            await connection.execute(text("SELECT pg_try_advisory_lock(hashtext(:key))"), {"key": key})
        ).scalar_one()
        try:
            yield acquired
        finally:
            if acquired:
                try:
                    await connection.execute(text("SELECT pg_advisory_unlock(hashtext(:key))"), {"key": key})
                except BaseException:
                    # State unknown: closing the session is what releases a session-level lock, and it must not be
                    # returned to the pool still holding it.
                    await connection.invalidate()
                    raise
