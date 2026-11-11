import pytest
from pydantic import SecretStr

from stellar_blaze.config import Settings


@pytest.fixture
def settings() -> Settings:
    """Settings for tests that build an app: JSON logs, no ``.env`` file, a database URL that is never connected to."""
    return Settings(
        env="test",
        log_format="json",
        database_url=SecretStr("postgresql+asyncpg://sb:sb@localhost:5432/stellar_blaze"),
        _env_file=None,
    )
