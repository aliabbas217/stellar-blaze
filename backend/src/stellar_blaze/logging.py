"""Structured logging: structlog on top of the stdlib logging tree.

Everything that logs ends up in one root handler and one renderer: structlog loggers (``structlog.stdlib.get_logger``),
plain stdlib loggers (SQLAlchemy, httpx2, ...) and uvicorn's own loggers. ``json`` is the production format (one object
per line); ``console`` is for a developer's terminal.
"""

import logging
import sys
from contextvars import ContextVar

import structlog
from asgi_correlation_id import correlation_id
from structlog.dev import ConsoleRenderer, plain_traceback
from structlog.processors import ExceptionRenderer, JSONRenderer
from structlog.tracebacks import ExceptionDictTransformer
from structlog.typing import EventDict, Processor, WrappedLogger

from stellar_blaze.config import Settings


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
    ]
    renderers: list[Processor]
    if settings.log_format == "json":
        # show_locals=False: a traceback in a log line must never carry local variables (settings, connection strings).
        renderers = [ExceptionRenderer(ExceptionDictTransformer(show_locals=False)), JSONRenderer()]
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
