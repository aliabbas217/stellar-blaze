"""The one async SQLAlchemy engine of the process."""

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from stellar_blaze.config import Settings


def build_engine(settings: Settings) -> AsyncEngine:
    """Build the async engine for ``settings.database_url``. No connection is opened until it is first used.

    Named ``build_engine`` so it does not shadow SQLAlchemy's ``create_engine``. Every connection gets server-side
    time limits (a statement that waits for a lock fails after 3 s; any statement after 30 s), and ``timeout`` bounds
    the connection handshake. ``pool_pre_ping`` replaces a connection the server dropped (restart, failover, idle
    cut-off) instead of surfacing its error to the next request.
    """
    return create_async_engine(
        settings.database_url.get_secret_value(),
        connect_args={
            "server_settings": {"lock_timeout": "3000", "statement_timeout": "30000"},
            "timeout": settings.readiness_timeout_s,
        },
        pool_pre_ping=True,
        # Statement parameters can be a push endpoint and keys or a token hash: an error message or a log line that
        # carries them leaks a capability. Hidden for every statement in the process.
        hide_parameters=True,
    )
