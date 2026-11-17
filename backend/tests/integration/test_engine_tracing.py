import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.tracing import instrumented_engine


@pytest.mark.integration
@pytest.mark.asyncio
async def test_sql_statements_become_spans_while_the_block_runs(
    monkeypatch: pytest.MonkeyPatch, engine: AsyncEngine
) -> None:
    # Unit-green is not live-works: contrib 0.66b2 refuses SQLAlchemy 2.1 unless skip_dep_check=True, so prove that
    # a real asyncpg statement on a real engine produces a span.
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318")
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))

    with instrumented_engine(engine, tracer_provider=provider):
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 42 AS answer"))

    spans = exporter.get_finished_spans()
    attributes = [dict(span.attributes) for span in spans if span.attributes]
    assert any("SELECT 42" in str(a.get("db.statement", "")) for a in attributes), [s.name for s in spans]
    assert all(a.get("db.system") == "postgresql" for a in attributes)
