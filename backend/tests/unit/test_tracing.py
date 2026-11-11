import pytest
from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from starlette.middleware.errors import ServerErrorMiddleware

from stellar_blaze.config import Settings
from stellar_blaze.tracing import configure_tracing


def is_instrumented(app: FastAPI) -> bool:
    # FastAPIInstrumentor wraps the stack: ServerErrorMiddleware -> OpenTelemetryMiddleware -> the original stack.
    stack = app.build_middleware_stack()
    return isinstance(stack, ServerErrorMiddleware) and isinstance(stack.app, OpenTelemetryMiddleware)


@pytest.mark.unit
def test_tracing_is_a_noop_without_an_endpoint(settings: Settings) -> None:
    app = FastAPI()
    configure_tracing(app, settings)
    assert not is_instrumented(app)


@pytest.mark.unit
def test_tracing_instruments_the_app_when_an_endpoint_is_set(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318")
    app = FastAPI()
    try:
        configure_tracing(app, settings)
        assert is_instrumented(app)
    finally:
        FastAPIInstrumentor.uninstrument_app(app)
        provider = trace.get_tracer_provider()
        if isinstance(provider, TracerProvider):
            provider.shutdown()
