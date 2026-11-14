"""Serving wiring in the composition root: the corrector of the active model, and the replay default date setting."""

import threading
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr, ValidationError

from stellar_blaze.adapters.fakes.corrector import FakeCorrector
from stellar_blaze.application.runtime_config import ConfigSnapshot
from stellar_blaze.composition import CorrectorProvider
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.models import LoadedModel
from stellar_blaze.domain.config.runtime import RuntimeConfig

pytestmark = pytest.mark.unit

DATABASE_URL = "postgresql+asyncpg://sb:sb@localhost:5432/stellar_blaze"


def settings(**overrides: Any) -> Settings:
    fields: dict[str, Any] = {"env": "test", "database_url": SecretStr(DATABASE_URL)}
    return Settings(_env_file=None, **(fields | overrides))


def snapshot(model: LoadedModel | None) -> ConfigSnapshot:
    return ConfigSnapshot(version_id=None, sha256="d" * 64, config=RuntimeConfig(), source="file", model=model)


def test_no_model_means_the_uncorrected_fake() -> None:
    corrector = CorrectorProvider().for_snapshot(snapshot(None))

    assert isinstance(corrector, FakeCorrector)
    assert corrector.model_id is None


def test_a_snapshot_without_a_model_is_served_by_one_shared_fake() -> None:
    provider = CorrectorProvider()

    assert provider.for_snapshot(snapshot(None)) is provider.for_snapshot(snapshot(None))


def test_a_model_is_loaded_once_and_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    loaded: list[str] = []

    class Loaded:
        model_id = "corrector-20261101-abcdef1-123456"
        needs_history_forecasts = False

    def fake_load(model: LoadedModel) -> Loaded:
        loaded.append(model.manifest.model_id)
        return Loaded()

    monkeypatch.setattr("stellar_blaze.composition.LightGbmCorrector.load", fake_load)
    model = _model("corrector-20261101-abcdef1-123456")
    provider = CorrectorProvider()

    first = provider.for_snapshot(snapshot(model))
    second = provider.for_snapshot(snapshot(model))

    assert first is second
    assert loaded == [model.manifest.model_id]


@pytest.mark.asyncio
async def test_warm_loads_the_model_in_a_worker_thread_so_a_later_request_loads_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded_in: list[int] = []

    class Loaded:
        model_id = "corrector-20261101-abcdef1-123456"
        needs_history_forecasts = False

    def fake_load(model: LoadedModel) -> Loaded:
        loaded_in.append(threading.get_ident())
        return Loaded()

    monkeypatch.setattr("stellar_blaze.composition.LightGbmCorrector.load", fake_load)
    model = _model("corrector-20261101-abcdef1-123456")
    provider = CorrectorProvider()

    await provider.warm(snapshot(model))
    later = provider.for_snapshot(snapshot(model))  # what a request does: no second load

    assert len(loaded_in) == 1
    assert loaded_in[0] != threading.get_ident()  # offloaded, not run on the event loop's thread
    assert isinstance(later, Loaded)
    await provider.warm(snapshot(None))  # no model: nothing to load, no error


def _model(model_id: str) -> LoadedModel:
    class Manifest:
        pass

    manifest = Manifest()
    manifest.model_id = model_id  # type: ignore[attr-defined]
    return LoadedModel(manifest=manifest, root=Path())  # type: ignore[arg-type]


def test_replay_default_date_is_optional_and_parsed_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    assert settings().replay_default_date is None

    monkeypatch.setenv("SB_REPLAY_DEFAULT_DATE", "2026-07-01")

    assert settings().replay_default_date == date(2026, 7, 1)


def test_replay_now_is_optional_aware_and_parsed_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    assert settings().replay_now is None

    monkeypatch.setenv("SB_REPLAY_NOW", "2025-07-10T11:10:00+04:00")

    assert settings().replay_now == datetime(2025, 7, 10, 7, 10, tzinfo=UTC)


@pytest.mark.parametrize("value", ["2025-07-10T11:10:00", "2025-07-10", "noon"])
def test_replay_now_without_an_offset_or_not_a_timestamp_is_refused(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("SB_REPLAY_NOW", value)

    with pytest.raises(ValidationError, match="replay_now"):
        settings()


def test_an_empty_replay_now_means_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SB_REPLAY_NOW", "")  # a copied .env.example line

    assert settings().replay_now is None
