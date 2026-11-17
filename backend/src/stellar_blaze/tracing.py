"""OpenTelemetry tracing, off unless an OTLP endpoint is configured."""

import os
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, SERVICE_VERSION, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze import __version__
from stellar_blaze.config import Settings

# OTEL_EXPORTER_OTLP_ENDPOINT is the standard OpenTelemetry variable, not an SB_* setting: the exporter reads it itself
# (it appends /v1/traces), which keeps the app portable across collectors. The roadmap (section 2) sanctions this
# single exception to "configuration only through SB_*".
OTLP_ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_ENDPOINT"


def _tracing_enabled() -> bool:
    return bool(os.environ.get(OTLP_ENDPOINT_ENV))


def configure_tracing(app: FastAPI, settings: Settings) -> None:
    """Export spans over OTLP/HTTP and instrument ``app``; do nothing when no endpoint is configured.

    Called from ``create_app``, before the first request: the FastAPI instrumentation wraps ``build_middleware_stack``,
    which Starlette has already run by the time the lifespan starts. The database engine does not exist yet at that
    point, so it is instrumented separately, by ``instrumented_engine``, from the lifespan.
    """
    if not _tracing_enabled():
        return
    resource = Resource.create(
        {
            SERVICE_NAME: "stellar-blaze-api",
            SERVICE_VERSION: __version__,
            "deployment.environment.name": settings.env,
            "vcs.ref.head.revision": settings.git_sha,
        }
    )
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)


@contextmanager
def instrumented_engine(engine: AsyncEngine, *, tracer_provider: TracerProvider | None = None) -> Iterator[None]:
    """Turn the SQL statements of ``engine`` into spans while the block runs; do nothing when tracing is off.

    ``tracer_provider=None`` uses the global provider that ``configure_tracing`` installed. The instrumentor is a
    process-wide singleton that also patches ``create_engine`` globally, so it is switched off again on exit: a later
    lifespan (or any other engine) starts from a clean slate instead of getting a "already instrumented" no-op.
    """
    if not _tracing_enabled():
        yield
        return
    instrumentor = SQLAlchemyInstrumentor()
    # skip_dep_check: contrib 0.66b2 caps SQLAlchemy at < 2.1 although it works on 2.1.8 (stack doc section 7); remove
    # the argument when the contrib release after 0.66b2 ships.
    instrumentor.instrument(engine=engine.sync_engine, tracer_provider=tracer_provider, skip_dep_check=True)
    try:
        yield
    finally:
        instrumentor.uninstrument()
