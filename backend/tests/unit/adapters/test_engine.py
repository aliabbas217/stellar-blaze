"""The one engine hides statement parameters: an endpoint, keys or a token hash must never ride along in an error."""

import pytest
from sqlalchemy.exc import DBAPIError

from stellar_blaze.adapters.db.engine import build_engine
from stellar_blaze.config import Settings

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_the_engine_hides_statement_parameters(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SB_DATABASE_URL", "postgresql+asyncpg://sb:pw@127.0.0.1:1/stellar_blaze")
    monkeypatch.setenv("SB_ENV", "test")
    engine = build_engine(Settings(_env_file=None))
    try:
        assert engine.sync_engine.hide_parameters is True
        error = DBAPIError.instance(
            "INSERT INTO t VALUES (:v)",
            {"v": "SECRETENDPOINT"},
            RuntimeError("boom"),
            RuntimeError,
            hide_parameters=engine.sync_engine.hide_parameters,
        )
        assert "SECRETENDPOINT" not in str(error)
    finally:
        await engine.dispose()
