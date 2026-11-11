import os

import pytest
from pydantic import SecretStr

from stellar_blaze.config import Settings


@pytest.fixture(autouse=True)
def _clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the developer's shell from leaking configuration into unit tests.

    Every ``SB_*`` variable and the OTLP endpoint are removed before each test; a test that needs one sets it itself.
    """
    for name in list(os.environ):
        if name.startswith("SB_") or name == "OTEL_EXPORTER_OTLP_ENDPOINT":
            monkeypatch.delenv(name)


@pytest.fixture
def settings() -> Settings:
    """Settings for tests that build an app: JSON logs, no ``.env`` file, a database URL that is never connected to."""
    return Settings(
        env="test",
        log_format="json",
        database_url=SecretStr("postgresql+asyncpg://sb:sb@localhost:5432/stellar_blaze"),
        _env_file=None,
    )
