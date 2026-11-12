"""Structured logging: structlog on top of the stdlib logging tree.

Everything that logs ends up in one root handler and one renderer: structlog loggers (``structlog.stdlib.get_logger``),
plain stdlib loggers (SQLAlchemy, httpx2, ...) and uvicorn's own loggers. ``json`` is the production format (one object
per line); ``console`` is for a developer's terminal.
"""

import logging
import sys
from contextvars import ContextVar
from io import StringIO
from types import TracebackType
from typing import TYPE_CHECKING

import structlog
from asgi_correlation_id import correlation_id
from structlog.dev import ConsoleRenderer, plain_traceback
from structlog.processors import JSONRenderer
from structlog.typing import EventDict, Processor, WrappedLogger

from stellar_blaze.config import Settings
from stellar_blaze.redaction import redact_tree

if TYPE_CHECKING:  # type only: importing composition here would load every adapter whenever logging is configured
    from stellar_blaze.application.runtime_config import ConfigSnapshot
    from stellar_blaze.composition import Runtime


class _LiveStdout:
    """Writes to whatever ``sys.stdout`` is at the moment of each write.

    A handler that captured ``sys.stdout`` once would keep writing to a replaced stream (pytest's capsys, a redirected
    stdout) after the replacement is gone.
    """

    def write(self, text: str) -> int:
        return sys.stdout.write(text)

    def flush(self) -> None:
        sys.stdout.flush()


class _StructlogHandler(logging.StreamHandler[_LiveStdout]):
    """The one root handler this module installs; the type lets ``configure_logging`` replace it idempotently."""


# The exception most recently logged by the application for the request being served (see mark_exception_reported).
_reported_exception: ContextVar[BaseException | None] = ContextVar("sb_reported_exception", default=None)

# What uvicorn logs (on `uvicorn.error`) for every exception that escapes the ASGI application.
_UVICORN_ASGI_ERROR = "Exception in ASGI application"


def mark_exception_reported(exc: BaseException) -> None:
    """Record that the application already logged ``exc``, so uvicorn's own record of the same exception is dropped.

    Starlette re-raises an unhandled exception after the 500 handler ran, and uvicorn then logs it again: two ERROR
    records per failure. Only this exact exception object is dropped; one the application never logged (a failing error
    handler, a ``BaseException``) still reaches the log through uvicorn.
    """
    _reported_exception.set(exc)


class _DropReportedAsgiError(logging.Filter):
    """Drops uvicorn's "Exception in ASGI application" record when the app already logged that exception."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not record.getMessage().startswith(_UVICORN_ASGI_ERROR) or record.exc_info is None:
            return True
        return record.exc_info[1] is not _reported_exception.get()


def _add_request_id(_logger: WrappedLogger, _method_name: str, event_dict: EventDict) -> EventDict:
    """Stamp the correlation id of the request being served (set by ``CorrelationIdMiddleware``), if any."""
    if (request_id := correlation_id.get()) is not None:
        event_dict.setdefault("request_id", request_id)
    return event_dict


type _ExcInfo = tuple[type[BaseException], BaseException, TracebackType | None]


def _exc_info_tuple(value: object) -> _ExcInfo | None:
    """The ``(type, value, traceback)`` of what a caller passed as ``exc_info``: ``True``, an exception or a tuple."""
    if value is True:
        value = sys.exc_info()
    if isinstance(value, BaseException):
        return type(value), value, value.__traceback__
    if isinstance(value, tuple) and len(value) == 3 and isinstance(value[1], BaseException):
        return value
    return None


def redact_exceptions(_logger: WrappedLogger, _method_name: str, event_dict: EventDict) -> EventDict:
    """A processor that renders the exception of a log line itself and masks credentials in all of its text.

    Exceptions quote what they were given: a connection string, a header, a request body. Left to the renderers, that
    text reaches the log as it is. This processor takes ``exc_info`` out of the event (so no raw exception object
    reaches a renderer), renders it as the plain traceback text into ``exception``, and runs ``redact`` over that, over
    ``stack`` (the rendered ``stack_info``) and over the message ``event``. Frame locals are never in that text, so a
    secret that only sat in a variable never gets as far as redaction.

    It is the same for both output formats on purpose: the structlog chain is cached on first use, so a choice that
    depended on the format would survive a later ``configure_logging`` with the other one. It runs in the shared chain,
    so it covers structlog loggers and stdlib records alike, whichever logger raised them (the application's,
    SQLAlchemy's, uvicorn's).
    """
    exc_info = _exc_info_tuple(event_dict.pop("exc_info", None))
    if exc_info is not None:
        buffer = StringIO()
        plain_traceback(buffer, exc_info)
        event_dict["exception"] = buffer.getvalue().rstrip()
    for key in ("event", "exception", "stack", "stack_info"):
        if key in event_dict:
            event_dict[key] = redact_tree(event_dict[key])
    return event_dict


def configure_logging(settings: Settings) -> None:
    """Route all logging through structlog. Idempotent: a second call replaces the first call's handler."""
    shared: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        _add_request_id,
        structlog.processors.StackInfoRenderer(),
        # After the stack is rendered and before any renderer: the one place where exceptions become text, so a
        # credential in an exception message, a traceback or a stack never reaches the output (see its docstring).
        redact_exceptions,
    ]
    renderers: list[Processor]
    if settings.log_format == "json":
        # No exception renderer on purpose: redact_exceptions has rendered `exception` and removed `exc_info`.
        renderers = [JSONRenderer()]
    else:
        renderers = [ConsoleRenderer(colors=sys.stdout.isatty(), exception_formatter=plain_traceback)]

    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            *shared,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    handler = _StructlogHandler(_LiveStdout())
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=shared,
            processors=[structlog.stdlib.ProcessorFormatter.remove_processors_meta, *renderers],
        )
    )
    root = logging.getLogger()
    for existing in [h for h in root.handlers if isinstance(h, _StructlogHandler)]:
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(settings.log_level)

    # uvicorn installs its own handlers and levels when it starts; hand its loggers to the root handler instead.
    for name in ("uvicorn", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.setLevel(logging.NOTSET)
        uvicorn_logger.propagate = True
    error_logger = logging.getLogger("uvicorn.error")
    for existing_filter in [f for f in error_logger.filters if isinstance(f, _DropReportedAsgiError)]:
        error_logger.removeFilter(existing_filter)
    error_logger.addFilter(_DropReportedAsgiError())
    # request.completed (RequestLogMiddleware) replaces uvicorn's access log: same facts plus request_id and duration.
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers.clear()
    access_logger.addHandler(logging.NullHandler())
    access_logger.propagate = False


def bind_runtime_ids(runtime: "Runtime") -> None:
    """Bind the loaded ruleset ids and model ids to the current context, so every log line names the rules in force.

    ``ruleset_ids`` and ``model_ids`` are comma-joined and fixed for the life of the process. The active ruleset pin,
    model id and config version can change at runtime, so they are bound per request by ``get_snapshot``.

    A context variable bound inside the lifespan is visible only in uvicorn's lifespan task, not in request tasks
    (probed with a real server), so the lifespan calls this for its own log lines and ``RequestLogMiddleware`` calls it
    again for each request.
    """
    structlog.contextvars.bind_contextvars(
        ruleset_ids=",".join(runtime.rulesets.ids()), model_ids=",".join(runtime.models.ids())
    )


def bind_config_identity(snapshot: "ConfigSnapshot") -> None:
    """Bind the identity of the config a request is served with, so every line of that request names it.

    ``config_version`` is ``None`` for a file or env snapshot. Called from the ``get_snapshot`` dependency and from the
    readiness probe (whose log line then shows which version each replica serves, which is how a rollout of a config
    change is watched). Request-scoped: the next request starts clean.
    """
    structlog.contextvars.bind_contextvars(
        config_version=snapshot.version_id,
        config_sha256=snapshot.sha256,
        ruleset_pin=snapshot.config.ruleset_pin,
        model_id=snapshot.config.model_id,
    )
