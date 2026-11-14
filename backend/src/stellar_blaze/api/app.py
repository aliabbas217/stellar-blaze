"""Application factory: ``uvicorn stellar_blaze.api.app:create_app --factory``."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from asgi_correlation_id import CorrelationIdMiddleware
from fastapi import FastAPI
from fastapi.routing import APIRoute

from stellar_blaze import __version__
from stellar_blaze.adapters.db.engine import build_engine
from stellar_blaze.api.middleware import RequestLogMiddleware
from stellar_blaze.api.openapi import install_openapi
from stellar_blaze.api.routers import crews, governance, health, plans, push, sites
from stellar_blaze.application.runtime_config import ConfigPoller, ConfigService, SnapshotHolder
from stellar_blaze.composition import build_config_service, build_config_store, build_runtime, dubai_today
from stellar_blaze.config import Settings, get_settings
from stellar_blaze.errors import PROBLEM_RESPONSES, REQUEST_ID_HEADER, install_problem_handlers
from stellar_blaze.logging import bind_runtime_ids, configure_logging
from stellar_blaze.redaction import describe_exception
from stellar_blaze.tracing import configure_tracing, instrumented_engine

API_PREFIX = "/api/v1"
logger = structlog.stdlib.get_logger(__name__)


def operation_id(route: APIRoute) -> str:
    """The OpenAPI ``operationId`` is the route function's name (``health_live``), unique by convention.

    Nothing in FastAPI stops two routes from sharing a function name; the contract test
    ``test_operation_ids_are_unique_and_are_the_route_function_names`` enforces it.

    FastAPI's default (``health_live_api_v1_health_live_get``) embeds the path and method, so it changes whenever a
    route moves; the generated TypeScript client names its functions after it, and the contract is frozen on 14 Nov.
    """
    return route.name


async def load_initial_config(service: ConfigService, holder: SnapshotHolder) -> None:
    """Put the database-active config into ``holder``, once, before the app serves (the first step of prod startup).

    A database that is down, or an active version this release refuses, does not stop startup: ``/health/live`` keeps
    answering, the holder stays empty, readiness is 503 (``dependency: config``) and decision routes answer 503, and the
    poller loads the config as soon as there is one. The exception is logged with its message and the cause it was
    raised from, credentials masked (``describe_exception``), because an operator needs the cause (refused, timed out,
    authentication failed) to act on it. The poller's own line (``config.status_changed``, status ``missing``) follows
    when its first poll fails, with the same cause, and again if the reason changes.
    """
    try:
        snapshot = await service.load_active()
    except Exception as exc:  # startup must survive any failure to read: readiness reports what is wrong
        logger.error("config.startup_load_failed", error=describe_exception(exc))
        return
    if snapshot is not None:
        holder.swap(snapshot)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the API. ``settings=None`` reads the environment (the production path)."""
    if settings is None:
        settings = get_settings()
    configure_logging(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # The rules in force come first and fail startup on any ruleset, model or config error: the process never
        # starts serving on wrong rules, and readiness cannot go green (ADR 0009: loud failure). The decision date is
        # the Asia/Dubai local date. No engine exists yet, so a failure here leaves nothing to dispose.
        runtime = build_runtime(settings, today=dubai_today())
        app.state.runtime = runtime
        bind_runtime_ids(runtime)

        # Creating the engine opens no connection, so a database that is down never prevents startup: /health/ready
        # reports it (503) while /health/live keeps answering and the platform keeps the process.
        engine = build_engine(settings)
        app.state.engine = engine
        try:
            service = build_config_service(runtime, build_config_store(engine, settings))
            poller = ConfigPoller(service, runtime.config, settings.config_poll_interval_s)
            app.state.config_poller = poller
            if settings.env == "prod":
                # In prod the database holds the only config: read it before serving anything. Outside prod the file or
                # env snapshot is already in the holder: the poller replaces a file snapshot once the database has an
                # activation, and never replaces an env one (the pins are for runs without a database, ADR 0010 4.6).
                await load_initial_config(service, runtime.config)
            snapshot = runtime.config.peek()
            logger.info(
                "runtime.ready",
                config_source=None if snapshot is None else snapshot.source,
                config_version=None if snapshot is None else snapshot.version_id,
                config_sha256=None if snapshot is None else snapshot.sha256,
            )
            poller.start()
            try:
                with instrumented_engine(engine):
                    yield
            finally:
                await poller.stop()
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

    for router in (health.router, sites.router, crews.router, plans.router, push.router, governance.router):
        app.include_router(router, prefix=API_PREFIX)
    install_openapi(app)

    configure_tracing(app, settings)
    return app
