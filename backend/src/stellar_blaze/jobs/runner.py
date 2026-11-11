"""Running one job: under its advisory lock, with a ``job_run`` row that says how it ended.

``run_job`` is what every ``sb-jobs`` command goes through, so they all behave alike: a second run of the same command
while one is active is recorded as ``skipped_locked`` and exits 0 (a scheduler's overlap, not an error); a run that
raises is recorded as ``failed`` with a description that carries no credentials, and exits 1.
"""

import asyncio
import re
from collections.abc import Awaitable, Callable, Mapping
from typing import Final

import structlog
from pydantic import JsonValue

from stellar_blaze.adapters.db.engine import build_engine
from stellar_blaze.adapters.db.job_runs import JobRunRepository, advisory_lock
from stellar_blaze.config import Settings

logger = structlog.stdlib.get_logger(__name__)

_MAX_ERROR_CHARS: Final = 2000
# A URL with credentials: scheme://user:password@host. The greedy userinfo runs up to the last "@" before the path, so
# a password that itself holds an "@" is covered as well.
_URL_CREDENTIALS = re.compile(r"(?P<scheme>[A-Za-z][A-Za-z0-9+.\-]*://)[^\s/?#]*@")
# key=value or key: value pairs that look like a credential (libpq DSNs, headers, query strings).
_SECRET_PAIR = re.compile(r"(?i)\b(?P<key>password|passwd|pwd|secret|token|api[_-]?key)\b(?P<sep>\s*[=:]\s*)\S+")


def redact(text: str) -> str:
    """``text`` with URL credentials (``postgresql+asyncpg://user:pass@host``) and ``password=...`` pairs masked."""
    masked = _URL_CREDENTIALS.sub(r"\g<scheme>***@", text)
    return _SECRET_PAIR.sub(r"\g<key>\g<sep>***", masked)


def describe_error(exc: BaseException) -> str:
    """``"<ExceptionType>: <message>"`` for the ``job_run.error`` column, redacted and bounded.

    Not ``repr(exc)``: an exception raised while connecting (a malformed SQLAlchemy URL, a driver error) can quote the
    DSN, and the audit table must never hold a password.
    """
    message = f"{type(exc).__name__}: {redact(str(exc))}".strip()
    return message if len(message) <= _MAX_ERROR_CHARS else message[:_MAX_ERROR_CHARS] + "..."


async def run_job(
    settings: Settings,
    job_name: str,
    params: Mapping[str, JsonValue],
    work: Callable[[], Awaitable[Mapping[str, JsonValue]]],
) -> int:
    """Run ``work`` as the job ``job_name`` and return the process exit code (0 succeeded or skipped, 1 failed).

    Inside ``advisory_lock(engine, job_name)``: when another run holds the lock, ``record_skipped`` and return 0;
    otherwise ``start`` the run, await ``work()`` and ``finish`` it as ``succeeded`` with the summary ``work`` returned.
    When ``work`` raises, the run is finished as ``failed`` (``describe_error``) and 1 is returned; a cancellation
    (Ctrl-C) is recorded the same way and then propagates. Failing to record the failure is logged and does not hide it.

    Raises:
        sqlalchemy.exc.SQLAlchemyError: The database could not be reached or the run could not be recorded as
            started or as succeeded; the job's own work has then not been judged, so the error is not swallowed.
        asyncio.CancelledError: The run was cancelled.
    """
    engine = build_engine(settings)
    runs = JobRunRepository(engine)
    log = logger.bind(job=job_name)
    try:
        async with advisory_lock(engine, job_name) as acquired:
            if not acquired:
                await runs.record_skipped(job_name, params)
                log.warning("job.skipped_locked", params=dict(params))
                return 0
            run_id = await runs.start(job_name, params, settings.git_sha)
            log = log.bind(run_id=str(run_id))
            log.info("job.started", params=dict(params), code_version=settings.git_sha)
            try:
                summary = await work()
            except (Exception, asyncio.CancelledError) as exc:
                error = describe_error(exc)
                log.error("job.failed", error=error, exc_info=True)
                try:
                    await runs.finish(run_id, "failed", None, error)
                except Exception:
                    log.exception("job.failure_not_recorded", error=error)
                if isinstance(exc, asyncio.CancelledError):
                    raise
                return 1
            await runs.finish(run_id, "succeeded", summary, None)
            log.info("job.succeeded", summary=dict(summary))
            return 0
    finally:
        await engine.dispose()
