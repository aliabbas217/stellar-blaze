"""Application factory: ``uvicorn stellar_blaze.api.app:create_app --factory``."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from asgi_correlation_id import CorrelationIdMiddleware
from fastapi import FastAPI
from fastapi.routing import APIRoute

from stellar_blaze import __version__
from stellar_blaze.adapters.db.engine import build_engine
from stellar_blaze.api.middleware import RequestLogMiddleware
from stellar_blaze.api.routers import health
from stellar_blaze.config import Settings, get_settings
from stellar_blaze.errors import PROBLEM_RESPONSES, REQUEST_ID_HEADER, install_problem_handlers
from stellar_blaze.logging import configure_logging
from stellar_blaze.tracing import configure_tracing, instrumented_engine

API_PREFIX = "/api/v1"


def operation_id(route: APIRoute) -> str:
    """The OpenAPI ``operationId`` is the route function's name (``health_live``), unique by construction.

    FastAPI's default (``health_live_api_v1_health_live_get``) embeds the path and method, so it changes whenever a
    route moves; the generated TypeScript client names its functions after it, and the contract is frozen on 14 Nov.
    """
    return route.name


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the API. ``settings=None`` reads the environment (the production path)."""
    if settings is None:
        settings = get_settings()
    configure_logging(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Creating the engine opens no connection, so a database that is down never prevents startup: /health/ready
        # reports it (503) while /health/live keeps answering and the platform keeps the process.
        engine = build_engine(settings)
        app.state.engine = engine
        try:
            with instrumented_engine(engine):
                yield
        finally:
            await engine.dispose()

    app = FastAPI(
        title="Stellar Blaze API",
        version=__version__,
        openapi_url="/openapi.json",
        responses=PROBLEM_RESPONSES,
        generate_unique_id_function=operation_id,
        lifespan=lifespan,
    )
    app.state.settings = settings

    # add_middleware puts the newest outermost, so the request log runs inside the correlation id middleware.
    app.add_middleware(RequestLogMiddleware)
    app.add_middleware(CorrelationIdMiddleware, header_name=REQUEST_ID_HEADER)
    install_problem_handlers(app)

    app.include_router(health.router, prefix=API_PREFIX)

    configure_tracing(app, settings)
    return app
