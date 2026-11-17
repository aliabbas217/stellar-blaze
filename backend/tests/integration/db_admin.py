"""Database administration for the integration tests: create and drop databases, run Alembic, ad-hoc queries.

Everything here runs ``asyncio.run`` (directly, or inside Alembic's async ``env.py``), which cannot start inside a
running event loop. The work therefore always happens on a fresh worker thread, so the same helpers are safe from sync
tests, session fixtures and async tests alike.
"""

import asyncio
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Literal

from alembic import command
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from stellar_blaze.config import Settings
from tests.alembic_support import alembic_config


def run_in_thread[T](work: Callable[[], T]) -> T:
    """Run ``work`` on a fresh thread (no running event loop there) and return its result or raise its exception."""
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(work).result()


def settings_for(url: str) -> Settings:
    return Settings(env="test", log_format="json", database_url=SecretStr(url), _env_file=None)


def url_for_database(url: str, database: str) -> str:
    return make_url(url).set(database=database).render_as_string(hide_password=False)


def fetch_all(url: str, sql: str, params: Mapping[str, Any] | None = None) -> list[dict[str, Any]]:
    """Run one statement in autocommit mode on its own connection; return its rows (empty for DDL)."""

    async def run() -> list[dict[str, Any]]:
        engine = create_async_engine(url, poolclass=NullPool, isolation_level="AUTOCOMMIT")
        try:
            async with engine.connect() as connection:
                result = await connection.execute(text(sql), params or {})
                return [dict(row) for row in result.mappings()] if result.returns_rows else []
        finally:
            await engine.dispose()

    return run_in_thread(lambda: asyncio.run(run()))


def create_database(server_url: str, name: str, *, template: str | None = None) -> None:
    clause = f' TEMPLATE "{template}"' if template else ""
    fetch_all(server_url, f'CREATE DATABASE "{name}"{clause}')


def drop_database(server_url: str, name: str) -> None:
    fetch_all(server_url, f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def migrate(settings: Settings, direction: Literal["upgrade", "downgrade"], revision: str) -> None:
    """``alembic upgrade|downgrade <revision>`` against the database in ``settings``."""
    config = alembic_config(settings)
    if direction == "upgrade":
        run_in_thread(lambda: command.upgrade(config, revision))
    else:
        run_in_thread(lambda: command.downgrade(config, revision))


def check_no_drift(settings: Settings) -> None:
    """``alembic check``: raises if the models and the migrated schema disagree."""
    config = alembic_config(settings)
    run_in_thread(lambda: command.check(config))
