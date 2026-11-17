"""``run_job`` and its advisory lock: which key it takes and what a refused lock means (no database: fakes)."""

from collections.abc import Mapping

import pytest
from pydantic import JsonValue

from stellar_blaze.config import Settings
from stellar_blaze.jobs.runner import run_job
from tests.unit.jobs.support import FakeLock, FakeRuns, use_fake_database

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_the_lock_key_is_the_job_name_unless_the_caller_gives_one(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    lock = use_fake_database(monkeypatch, FakeRuns())

    async def work() -> Mapping[str, JsonValue]:
        return {}

    await run_job(settings, "build-dataset", {}, work)
    await run_job(settings, "ingest-observations", {}, work, lock_key="ingest-observations:iem")

    assert lock.keys == ["build-dataset", "ingest-observations:iem"]


@pytest.mark.asyncio
async def test_a_refused_lock_is_recorded_under_the_job_name_and_the_work_does_not_run(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    runs = FakeRuns()
    use_fake_database(monkeypatch, runs, FakeLock(granted=False))
    ran: list[bool] = []

    async def work() -> Mapping[str, JsonValue]:
        ran.append(True)
        return {}

    code = await run_job(settings, "ingest-observations", {"source": "iem"}, work, lock_key="ingest-observations:iem")

    assert code == 0
    assert ran == []
    assert runs.skipped == [("ingest-observations", {"source": "iem"})]  # the audit row names the command, not the key
    assert runs.finished == []
