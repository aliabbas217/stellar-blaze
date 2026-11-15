"""Alembic environment: async engine, URL from ``Settings``, models from ``stellar_blaze.adapters.db.tables``.

``alembic upgrade head`` reads ``SB_DATABASE_URL`` like the rest of the application. A caller that runs Alembic in
process (the integration tests) hands over a ``Settings`` through ``config.attributes["settings"]`` instead, so it never
has to touch ``os.environ``. ``alembic upgrade head --sql`` renders the migration without a database (Squawk lints it).
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from stellar_blaze.adapters.db.tables import Base
from stellar_blaze.config import Settings

config = context.config

provided = config.attributes.get("settings")
settings = provided if isinstance(provided, Settings) else Settings()

# Alembic's own logging (alembic.ini) writes to stderr. It must not go through the application's structlog handler:
# that one writes to stdout, which `alembic upgrade head --sql` uses for the SQL it renders. An in-process caller turns
# this off with config.attributes["configure_logger"] = False (fileConfig would replace the root handlers).
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Render the SQL for the migrations to the script output instead of executing it."""
    context.configure(
        url=settings.database_url.get_secret_value(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    # NullPool: a migration is one short-lived connection, closed when it finishes.
    engine = create_async_engine(
        settings.database_url.get_secret_value(),
        poolclass=pool.NullPool,
        hide_parameters=True,  # a failing statement must not print row values (a migration may backfill data)
    )
    try:
        async with engine.connect() as connection:
            await connection.run_sync(do_run_migrations)
    finally:
        await engine.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
