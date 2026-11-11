"""Application factory: ``uvicorn stellar_blaze.api.app:create_app --factory``."""

from asgi_correlation_id import CorrelationIdMiddleware
from fastapi import FastAPI

from stellar_blaze import __version__
from stellar_blaze.api.middleware import RequestLogMiddleware
from stellar_blaze.api.routers import health
from stellar_blaze.config import Settings, get_settings
from stellar_blaze.errors import PROBLEM_RESPONSES, REQUEST_ID_HEADER, install_problem_handlers
from stellar_blaze.logging import configure_logging
from stellar_blaze.tracing import configure_tracing

API_PREFIX = "/api/v1"


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the API. ``settings=None`` reads the environment (the production path)."""
    if settings is None:
        settings = get_settings()
    configure_logging(settings)

    app = FastAPI(
        title="Stellar Blaze API",
        version=__version__,
        openapi_url="/openapi.json",
        responses=PROBLEM_RESPONSES,
    )
    app.state.settings = settings

    # add_middleware puts the newest outermost, so the request log runs inside the correlation id middleware.
    app.add_middleware(RequestLogMiddleware)
    app.add_middleware(CorrelationIdMiddleware, header_name=REQUEST_ID_HEADER)
    install_problem_handlers(app)

    app.include_router(health.router, prefix=API_PREFIX)

    configure_tracing(app, settings)
    return app
