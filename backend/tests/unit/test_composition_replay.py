"""Replay mode in the composition root: ``Settings`` for it, the registered factory, and ``build_sources`` wiring both
the forecast and the observation side to one verified snapshot."""

import shutil
from pathlib import Path
from typing import Any

import polars as pl
import pytest
from pydantic import SecretStr, ValidationError

from stellar_blaze.adapters.sources.replay import ReplayForecastSource, ReplayObservationSource, ReplaySnapshotError
from stellar_blaze.adapters.storage.parquet_store import ParquetStore
from stellar_blaze.composition import FORECAST_SOURCES, UnknownAdapterError, build_forecast_source, build_sources
from stellar_blaze.config import Settings
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.stations import station
from stellar_blaze.jobs.work import ingest_forecasts
from tests.fixtures.forecast.replay import SNAPSHOT_ID, SUMMER, build_fixture_snapshot

pytestmark = pytest.mark.unit

DATABASE_URL = "postgresql+asyncpg://sb:sb@localhost:5432/stellar_blaze"


def make_settings(**overrides: Any) -> Settings:
    fields: dict[str, Any] = {"env": "test", "log_format": "json", "database_url": SecretStr(DATABASE_URL)}
    return Settings(_env_file=None, **(fields | overrides))


@pytest.fixture(scope="module")
def replay_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A directory whose ``replay/`` holds the fixture snapshot."""
    root = tmp_path_factory.mktemp("composition-replay")
    build_fixture_snapshot(root)
    return root


def replay_settings(root: Path, **overrides: Any) -> Settings:
    return make_settings(
        forecast_source="replay", replay_dir=root / "replay", replay_snapshot_id=SNAPSHOT_ID, **overrides
    )


# --- Settings -------------------------------------------------------------------------------------------------------


def test_settings_require_snapshot_id_for_replay() -> None:
    with pytest.raises(ValidationError, match="SB_REPLAY_SNAPSHOT_ID"):
        make_settings(forecast_source="replay")


def test_settings_do_not_need_a_snapshot_id_for_open_meteo() -> None:
    settings = make_settings()

    assert settings.forecast_source == "open_meteo"
    assert settings.replay_snapshot_id is None
    assert settings.replay_dir == Path("replay")


def test_settings_read_the_replay_variables_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("SB_FORECAST_SOURCE", "replay")
    monkeypatch.setenv("SB_REPLAY_DIR", "/srv/snapshots")
    monkeypatch.setenv("SB_REPLAY_SNAPSHOT_ID", "demo-2026")

    settings = Settings(_env_file=None)

    assert settings.replay_dir == Path("/srv/snapshots")
    assert settings.replay_snapshot_id == "demo-2026"


def test_an_empty_snapshot_id_variable_means_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("SB_FORECAST_SOURCE", "replay")
    monkeypatch.setenv("SB_REPLAY_SNAPSHOT_ID", "")

    with pytest.raises(ValidationError, match="SB_REPLAY_SNAPSHOT_ID"):  # not the empty id, which would be a path
        Settings(_env_file=None)


@pytest.mark.parametrize(
    "snapshot_id", ["../secrets", "a/b", "Upper", "with space", "x" * 65, "con", "aux", "nul", "com1", "lpt9"]
)
def test_settings_refuse_a_snapshot_id_that_is_not_a_slug(snapshot_id: str) -> None:
    """The id becomes a directory name under ``replay_dir``: it must not be able to climb out of it."""
    with pytest.raises(ValidationError, match="snapshot id"):
        make_settings(forecast_source="replay", replay_snapshot_id=snapshot_id)


# --- the registry and the factory -----------------------------------------------------------------------------------


def test_replay_is_registered_next_to_open_meteo() -> None:
    assert set(FORECAST_SOURCES) == {"open_meteo", "replay"}
    with pytest.raises(TypeError):  # still read-only
        FORECAST_SOURCES["fake"] = FORECAST_SOURCES["replay"]  # type: ignore[index]


@pytest.mark.asyncio
async def test_the_replay_factory_builds_the_replay_forecast_source(replay_root: Path) -> None:
    from stellar_blaze.adapters.http.client import build_async_client

    settings = replay_settings(replay_root)
    client = build_async_client(settings)
    try:
        source = build_forecast_source(settings, client, None)
    finally:
        await client.aclose()

    assert isinstance(source, ReplayForecastSource)
    assert source.snapshot.snapshot_id == SNAPSHOT_ID


def test_a_registry_without_replay_names_the_registered_kinds(replay_root: Path) -> None:
    with pytest.raises(UnknownAdapterError, match=r"replay.*open_meteo"):
        build_sources(replay_settings(replay_root), registry={"open_meteo": FORECAST_SOURCES["open_meteo"]})


# --- build_sources --------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_sources_replay_wires_both(replay_root: Path) -> None:
    sources = build_sources(replay_settings(replay_root))

    try:
        assert isinstance(sources.forecasts, ReplayForecastSource)
        assert sorted(sources.observations) == ["iem"]  # the key the job code asks for ...
        observations = sources.observations["iem"]
        assert isinstance(observations, ReplayObservationSource)  # ... answered from the snapshot, not from IEM
        assert observations.name == "replay"
    finally:
        await sources.close()


@pytest.mark.asyncio
async def test_replay_sources_serve_the_same_snapshot(replay_root: Path) -> None:
    sources = build_sources(replay_settings(replay_root))

    try:
        assert isinstance(sources.forecasts, ReplayForecastSource)
        assert isinstance(sources.observations["iem"], ReplayObservationSource)
        assert sources.forecasts.snapshot == sources.observations["iem"].snapshot
    finally:
        await sources.close()


@pytest.mark.asyncio
async def test_build_sources_refuses_a_tampered_snapshot(replay_root: Path, tmp_path: Path) -> None:
    shutil.copytree(replay_root / "replay", tmp_path / "replay")
    path = tmp_path / "replay" / SNAPSHOT_ID / "observations.parquet"
    path.write_bytes(path.read_bytes() + b"\x00")

    with pytest.raises(ReplaySnapshotError, match=r"observations\.parquet.*sha256"):
        build_sources(replay_settings(tmp_path))


@pytest.mark.asyncio
async def test_build_sources_names_a_snapshot_that_is_not_there(tmp_path: Path) -> None:
    with pytest.raises(ReplaySnapshotError, match=rf"{SNAPSHOT_ID}.*snapshot\.json.*missing"):
        build_sources(replay_settings(tmp_path))


@pytest.mark.asyncio
async def test_open_meteo_mode_still_builds_the_real_observation_sources() -> None:
    sources = build_sources(make_settings())

    try:
        assert sorted(sources.observations) == ["ghcnh", "iem"]
    finally:
        await sources.close()


@pytest.mark.asyncio
async def test_the_forecast_ingest_job_runs_unchanged_over_the_replay_sources(
    replay_root: Path, tmp_path: Path
) -> None:
    """``ingest_forecasts`` (the job code) reads the snapshot through ``Sources`` and stores what it holds."""
    sources = build_sources(replay_settings(replay_root))
    store = ParquetStore(tmp_path)

    try:
        result = await ingest_forecasts(
            sources=sources,
            model=NwpModel.ECMWF_IFS025,
            stations=[station("OMAA")],
            summers=[SUMMER],
            store=store,
        )
    finally:
        await sources.close()

    stored = store.read_forecasts()
    assert result["rows"] == stored.height > 0
    assert stored["model"].unique().to_list() == ["ecmwf_ifs025"]
    assert sorted(stored["lead_days"].unique().to_list()) == list(range(8))
    assert stored.select(pl.col("valid_time").dt.date().n_unique()).item() == 3  # the fixture's three days
