"""Integration-tier fixtures: one Postgres container per session, one migrated database per test.

Isolation: the session migrates a template database once; every test gets ``CREATE DATABASE ... TEMPLATE`` from it, so
a test sees exactly the migrated schema, owns its data, and cannot be broken by another test's downgrade.
"""

import uuid
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncEngine
from testcontainers.community.postgres import PostgresContainer

from stellar_blaze.adapters.db.engine import build_engine
from stellar_blaze.config import Settings
from tests.integration.db_admin import (
    create_database,
    drop_database,
    migrate,
    settings_for,
    url_for_database,
)

HERE = Path(__file__).resolve().parent
# Same image as production (stack doc 7, I1 plan).
POSTGRES_IMAGE = "postgres:18.6"


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Let the integration tier reach Docker (preflight F3).

    pytest-socket runs with ``--allow-hosts=127.0.0.1,::1`` and without ``--allow-unix-socket``, which blocks
    docker-py's ``/var/run/docker.sock`` on Linux CI. ``pytestmark`` in a conftest does not apply to the tests next to
    it, but the ``enable_socket`` marker added here does: pytest-socket reads it before fixtures are set up. Unit tests
    are untouched (the hook only marks items under this directory). ``HERE`` is resolved, so ``item.path`` is resolved
    too: a checkout reached through a symlink must not silently lose the marker.
    """
    for item in items:
        if item.path.resolve().is_relative_to(HERE):
            item.add_marker(pytest.mark.enable_socket)


@pytest.fixture(scope="session")
def postgres_container() -> Iterator[PostgresContainer]:
    with PostgresContainer(POSTGRES_IMAGE, driver="asyncpg") as container:
        yield container


@pytest.fixture(scope="session")
def server_url(postgres_container: PostgresContainer) -> str:
    """The container's default database; used to create and drop the per-test databases."""
    return postgres_container.get_connection_url()


@pytest.fixture(scope="session")
def template_database(server_url: str) -> Iterator[str]:
    """A database migrated to ``head``, never connected to by tests (a template must have no open sessions)."""
    name = f"sb_template_{uuid.uuid4().hex[:8]}"
    create_database(server_url, name)
    try:
        migrate(settings_for(url_for_database(server_url, name)), "upgrade", "head")
        yield name
    finally:
        drop_database(server_url, name)


@pytest.fixture
def new_database(server_url: str) -> Iterator[Callable[[str | None], Settings]]:
    """Factory: ``new_database(template)`` creates a database (empty when ``template`` is None) and returns settings."""
    created: list[str] = []

    def create(template: str | None) -> Settings:
        name = f"sb_test_{uuid.uuid4().hex[:12]}"
        create_database(server_url, name, template=template)
        created.append(name)
        return settings_for(url_for_database(server_url, name))

    yield create
    for name in created:
        drop_database(server_url, name)


@pytest.fixture
def settings(new_database: Callable[[str | None], Settings], template_database: str) -> Settings:
    """Settings for a private, fully migrated database."""
    return new_database(template_database)


@pytest.fixture
def empty_settings(new_database: Callable[[str | None], Settings]) -> Settings:
    """Settings for a private database with no schema at all (for tests that run the migrations themselves)."""
    return new_database(None)


@pytest_asyncio.fixture
async def engine(settings: Settings) -> AsyncIterator[AsyncEngine]:
    engine = build_engine(settings)
    try:
        yield engine
    finally:
        await engine.dispose()
