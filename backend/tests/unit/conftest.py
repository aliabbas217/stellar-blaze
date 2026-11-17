import pytest
from pydantic import SecretStr

from stellar_blaze.config import Settings


@pytest.fixture
def settings() -> Settings:
    """Settings for tests that build an app: JSON logs, no ``.env`` file, and a database URL that never connects.

    Port 1 on loopback is closed. The URL must not be the README's local Postgres (``localhost:5432``, user ``sb``):
    the config poller connects to whatever the URL names, so a developer's seeded database would otherwise change what
    a unit test serves.
    """
    return Settings(
        env="test",
        log_format="json",
        database_url=SecretStr("postgresql+asyncpg://sb:sb@127.0.0.1:1/stellar_blaze"),
        _env_file=None,
    )
