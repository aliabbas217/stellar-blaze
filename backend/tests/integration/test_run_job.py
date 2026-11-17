"""``run_job`` against a real Postgres: what a job run leaves behind when its work succeeds, fails or is cancelled."""

import asyncio
from collections.abc import Mapping
from typing import Any

import pytest
from pydantic import JsonValue

from stellar_blaze.adapters.db.job_runs import JobRunRepository
from stellar_blaze.config import Settings
from stellar_blaze.jobs.runner import run_job
from stellar_blaze.logging import configure_logging
from tests.integration.db_admin import fetch_all
from tests.unit.adapters.http_support import json_lines


def runs(settings: Settings) -> list[dict[str, Any]]:
    return fetch_all(
        settings.database_url.get_secret_value(),
        "SELECT job_name, status, summary, error FROM job_run ORDER BY started_at",
    )


async def rows(settings: Settings) -> list[dict[str, Any]]:
    # fetch_all already runs its query on a worker thread (an event loop cannot start inside this running one).
    return runs(settings)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_job_that_succeeds_is_recorded_with_its_summary_and_exit_code_0(settings: Settings) -> None:
    async def work() -> Mapping[str, JsonValue]:
        return {"rows": 3}

    code = await run_job(settings, "demo", {"a": 1}, work)

    assert code == 0
    assert [(r["job_name"], r["status"], r["summary"], r["error"]) for r in await rows(settings)] == [
        ("demo", "succeeded", {"rows": 3}, None)
    ]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_job_that_raises_is_recorded_failed_with_exit_code_1(settings: Settings) -> None:
    async def work() -> Mapping[str, JsonValue]:
        raise ValueError("no rows")

    code = await run_job(settings, "demo", {}, work)

    assert code == 1
    assert [(r["status"], r["summary"], r["error"]) for r in await rows(settings)] == [
        ("failed", None, "ValueError: no rows")
    ]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_cancelled_job_is_recorded_failed_and_the_cancellation_propagates(settings: Settings) -> None:
    async def work() -> Mapping[str, JsonValue]:
        raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await run_job(settings, "demo", {}, work)

    # Ctrl-C during a long job must not leave a "running" row behind that nobody will ever finish.
    assert [(r["status"], r["error"]) for r in await rows(settings)] == [("failed", "CancelledError:")]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_failure_that_cannot_be_recorded_is_logged_and_does_not_hide_the_job_error(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging(settings)

    async def database_gone(self: JobRunRepository, *args: object, **kwargs: object) -> None:
        raise ConnectionError("database went away")

    monkeypatch.setattr(JobRunRepository, "finish", database_gone)

    async def work() -> Mapping[str, JsonValue]:
        raise ValueError("the real problem")

    code = await run_job(settings, "demo", {}, work)

    assert code == 1  # the job failed; that is what the exit code says, whatever happened to its record
    events = {line["event"]: line for line in json_lines(capsys.readouterr().out)}
    assert events["job.failed"]["error"] == "ValueError: the real problem"
    assert events["job.failure_not_recorded"]["error"] == "ValueError: the real problem"
