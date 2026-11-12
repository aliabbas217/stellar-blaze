"""No credential reaches a log line through an exception, a traceback, a message or a stack, whoever logs it.

An exception quotes what it was given (a connection string, a header, a request body), and a renderer prints it. The
shared logging configuration therefore renders every exception itself and masks credentials in the text
(``stellar_blaze.logging.redact_exceptions``). These tests log the same failing call through every path the code
base has, in both formats, and read what actually reached stdout.
"""

import asyncio
import io
import json
import logging
import time
from collections.abc import AsyncIterator, Iterator, Mapping
from contextlib import asynccontextmanager
from typing import Any, cast

import pytest
import structlog
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import JsonValue, SecretStr
from sqlalchemy.ext.asyncio import AsyncEngine
from structlog.processors import ExceptionRenderer, JSONRenderer
from structlog.tracebacks import ExceptionDictTransformer

from stellar_blaze.adapters.db.job_runs import advisory_lock
from stellar_blaze.api.app import create_app
from stellar_blaze.config import Settings
from stellar_blaze.jobs.runner import run_job
from stellar_blaze.logging import configure_logging
from tests.unit.jobs.support import FakeRuns, use_fake_database

pytestmark = pytest.mark.unit

PASSWORD = "S3cretPass"  # noqa: S105  (a canary that stands in for a real credential)
TOKEN = "abc.def.ghi"  # noqa: S105
SECRETS = (PASSWORD, TOKEN)
DSN = f"postgresql+asyncpg://sb:{PASSWORD}@db:5432/x"
HEADER = f"Authorization: Bearer {TOKEN}"
MESSAGE = f"cannot reach {DSN} ({HEADER})"


def settings_for(log_format: str) -> Settings:
    return Settings(
        env="dev" if log_format == "console" else "test",
        log_format="console" if log_format == "console" else "json",
        database_url=SecretStr("postgresql+asyncpg://sb:sb@localhost:5432/stellar_blaze"),
        _env_file=None,
    )


@pytest.fixture(params=["json", "console"])
def log_format(request: pytest.FixtureRequest) -> str:
    fmt: str = request.param
    configure_logging(settings_for(fmt))
    return fmt


def explode() -> None:
    credentials = DSN  # a frame local: it must not be rendered either
    del credentials
    raise RuntimeError(MESSAGE)


def assert_no_secret(out: str) -> None:
    for secret in SECRETS:
        assert secret not in out, f"{secret!r} reached the log output:\n{out}"


def assert_exception_is_still_described(out: str, log_format: str) -> None:
    """The log line still says what failed: the exception type and the redacted message, in a traceback."""
    assert "Traceback (most recent call last)" in out
    assert "RuntimeError: cannot reach" in out
    assert "***" in out
    if log_format == "json":
        lines = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
        exceptions = [line["exception"] for line in lines if "exception" in line]
        assert exceptions, "no log line carries an exception"
        assert all(
            isinstance(text, str) and "RuntimeError: cannot reach" in text and "***" in text for text in exceptions
        )


# --- the runner's own paths --------------------------------------------------------------------------------------


def test_the_runner_job_failed_path_logs_no_secret(
    log_format: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    runs = FakeRuns()
    use_fake_database(monkeypatch, runs)

    async def work() -> Mapping[str, JsonValue]:
        explode()
        return {}

    code = asyncio.run(run_job(settings_for(log_format), "demo", {}, work))

    out = capsys.readouterr().out
    assert code == 1
    assert "job.failed" in out
    assert_no_secret(out)
    assert_exception_is_still_described(out, log_format)
    (status, _, error) = runs.finished[0]  # the audit row was already masked (describe_error)
    assert status == "failed"
    assert error is not None
    assert_no_secret(error)


def test_the_runner_failure_not_recorded_path_logs_no_secret(
    log_format: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # The database failure that stops the failure from being recorded quotes the connection string, too.
    use_fake_database(monkeypatch, FakeRuns(finish_error=ConnectionError(f"lost {DSN}; {HEADER}")))

    async def work() -> Mapping[str, JsonValue]:
        explode()
        return {}

    code = asyncio.run(run_job(settings_for(log_format), "demo", {}, work))

    out = capsys.readouterr().out
    assert code == 1
    assert "job.failure_not_recorded" in out
    assert_no_secret(out)
    assert "ConnectionError" in out


class FakeResult:
    def scalar_one(self) -> bool:
        return True


class FakeConnection:
    """A connection that takes the lock and then fails to release it, with a message that quotes the DSN."""

    def __init__(self) -> None:
        self.calls = 0

    async def execution_options(self, **options: object) -> "FakeConnection":
        return self

    async def execute(self, statement: object, parameters: object = None) -> FakeResult:
        self.calls += 1
        if self.calls > 1:
            raise ConnectionError(f"connection to {DSN} lost; {HEADER}")
        return FakeResult()

    async def invalidate(self) -> None:
        return None


class FakeConnectingEngine:
    @asynccontextmanager
    async def connect(self) -> AsyncIterator[FakeConnection]:
        yield FakeConnection()


def test_the_advisory_lock_lost_log_masks_the_exception(log_format: str, capsys: pytest.CaptureFixture[str]) -> None:
    async def hold() -> None:
        async with advisory_lock(cast(AsyncEngine, FakeConnectingEngine()), "demo") as acquired:
            assert acquired

    asyncio.run(hold())  # the failed release is logged, not raised

    out = capsys.readouterr().out
    assert "advisory lock lost" in out
    assert "ConnectionError" in out
    assert_no_secret(out)


# --- other loggers -------------------------------------------------------------------------------------------------


def test_a_plain_structlog_exception_log_in_unrelated_code_logs_no_secret(
    log_format: str, capsys: pytest.CaptureFixture[str]
) -> None:
    log = structlog.stdlib.get_logger("unrelated.module")
    try:
        explode()
    except RuntimeError:
        log.exception("something broke", attempt=3)

    out = capsys.readouterr().out
    assert "something broke" in out
    assert_no_secret(out)
    assert_exception_is_still_described(out, log_format)


def test_exc_info_given_as_an_exception_or_a_tuple_is_covered_too(
    log_format: str, capsys: pytest.CaptureFixture[str]
) -> None:
    log = structlog.stdlib.get_logger("unrelated.module")
    try:
        explode()
    except RuntimeError as exc:
        log.error("as instance", exc_info=exc)
        log.error("as tuple", exc_info=(type(exc), exc, exc.__traceback__))

    out = capsys.readouterr().out
    assert "as instance" in out
    assert "as tuple" in out
    assert_no_secret(out)


def test_a_stdlib_logger_exception_routed_through_the_shared_handler_logs_no_secret(
    log_format: str, capsys: pytest.CaptureFixture[str]
) -> None:
    try:
        explode()
    except RuntimeError:
        logging.getLogger("some.library").exception("library failure")

    out = capsys.readouterr().out
    assert "library failure" in out
    assert_no_secret(out)
    assert_exception_is_still_described(out, log_format)


def test_a_secret_in_a_stdlib_message_argument_or_a_stack_is_masked(
    log_format: str, capsys: pytest.CaptureFixture[str]
) -> None:
    # `%s` of an exception puts its text in the message; stack_info renders the source line of the call, which holds the
    # DSN literal here.
    logging.getLogger("some.library").error("failed: %s", DSN, stack_info=True)  # postgresql+asyncpg://sb:S3cretPass@x
    try:
        explode()
    except RuntimeError as exc:
        logging.getLogger("some.library").error("failed with %s", exc)
        structlog.stdlib.get_logger("unrelated.module").error(f"failed with {exc}", stack_info=True)

    out = capsys.readouterr().out
    assert "failed" in out
    assert_no_secret(out)


def test_the_applications_unhandled_error_log_masks_the_exception(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    app: FastAPI = create_app(settings)

    @app.get("/test/boom")
    async def boom() -> None:
        explode()

    TestClient(app, raise_server_exceptions=False).get("/test/boom")

    out = capsys.readouterr().out
    assert "request.unhandled" in out
    assert_no_secret(out)
    assert_exception_is_still_described(out, "json")


# --- the control: without the processor the same exception leaks --------------------------------------------------


@pytest.fixture
def old_chain_logger() -> Iterator[tuple[logging.Logger, io.StringIO]]:
    """A logger with the renderer chain this module's processor replaced: structlog's own exception renderer."""
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            processors=[
                structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                ExceptionRenderer(ExceptionDictTransformer(show_locals=False)),
                JSONRenderer(),
            ]
        )
    )
    logger = logging.getLogger("control.without.the.processor")
    logger.propagate = False
    logger.addHandler(handler)
    try:
        yield logger, stream
    finally:
        logger.removeHandler(handler)


def test_control_without_the_processor_the_same_exception_leaks(
    old_chain_logger: tuple[logging.Logger, io.StringIO],
) -> None:
    # This is what makes the tests above non-vacuous: with structlog's exception renderer alone (the chain before this
    # fix), the very same call puts both secrets in the output.
    logger, stream = old_chain_logger
    try:
        explode()
    except RuntimeError:
        logger.exception("library failure")

    out: Any = stream.getvalue()
    assert PASSWORD in out
    assert TOKEN in out


def test_an_exception_that_quotes_a_megabyte_costs_a_bounded_time_and_still_masks_and_keeps_its_end(
    log_format: str, capsys: pytest.CaptureFixture[str]
) -> None:
    # Final review I1: redact() runs over every logged traceback, and an exception can quote a whole response body. The
    # traceback is cut to its head and tail around an elision marker; the exception line's end (here the secret, then a
    # last word) is in the tail, masked.
    body = "a-" * (512 * 1024)
    log = structlog.stdlib.get_logger("test.oversized")

    try:
        raise RuntimeError(f"upstream answered {body} password={PASSWORD} last-word")
    except RuntimeError:
        started = time.perf_counter()
        log.error("upstream.failed", exc_info=True)
        elapsed = time.perf_counter() - started

    out = capsys.readouterr().out
    assert elapsed < 1.0
    assert_no_secret(out)
    assert "RuntimeError: upstream answered" in out
    assert "chars elided" in out
    assert "password=*** last-word" in out
