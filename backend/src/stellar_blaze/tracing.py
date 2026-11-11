"""OpenTelemetry tracing, off unless an OTLP endpoint is configured."""

import os

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, SERVICE_VERSION, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from stellar_blaze import __version__
from stellar_blaze.config import Settings

# OTEL_EXPORTER_OTLP_ENDPOINT is the standard OpenTelemetry variable, not an SB_* setting: the exporter reads it itself
# (it appends /v1/traces), which keeps the app portable across collectors. The roadmap (section 2) sanctions this
# single exception to "configuration only through SB_*".
OTLP_ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_ENDPOINT"


def configure_tracing(app: FastAPI, settings: Settings) -> None:
    """Export spans over OTLP/HTTP and instrument ``app``; do nothing when no endpoint is configured."""
    if not os.environ.get(OTLP_ENDPOINT_ENV):
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
