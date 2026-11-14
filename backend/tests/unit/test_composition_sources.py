"""``build_sources``: the composition root's assembly of the ingest jobs' upstream sources."""

from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr

from stellar_blaze import composition
from stellar_blaze.adapters.fakes.weather import InMemoryForecastSource
from stellar_blaze.adapters.http.cache import RawResponseCache
from stellar_blaze.adapters.http.pacer import RequestPacer
from stellar_blaze.adapters.sources.ghcnh import GhcnhParquetSource
from stellar_blaze.adapters.sources.iem import IemMetarSource
from stellar_blaze.adapters.sources.open_meteo import OpenMeteoPreviousRunsSource
from stellar_blaze.composition import FORECAST_SOURCES, Sources, UnknownAdapterError, build_sources
from stellar_blaze.config import Settings

pytestmark = pytest.mark.unit


def make_settings(**overrides: Any) -> Settings:
    fields: dict[str, Any] = {
        "env": "test",
        "log_format": "json",
        "database_url": SecretStr("postgresql+asyncpg://sb:sb@localhost:5432/stellar_blaze"),
    }
    return Settings(_env_file=None, **(fields | overrides))


@pytest.mark.asyncio
async def test_build_sources_gives_the_real_adapters_by_name() -> None:
    sources = build_sources(make_settings())

    try:
        assert isinstance(sources, Sources)
        assert sorted(sources.observations) == ["ghcnh", "iem"]
        assert isinstance(sources.observations["iem"], IemMetarSource)
        assert isinstance(sources.observations["ghcnh"], GhcnhParquetSource)
        assert isinstance(sources.forecasts, OpenMeteoPreviousRunsSource)
        assert all(source.name == key for key, source in sources.observations.items())
    finally:
        await sources.close()


@pytest.mark.asyncio
async def test_the_raw_response_cache_is_under_data_dir_bronze_http(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    roots: list[Path] = []

    class RecordingCache(RawResponseCache):
        def __init__(self, root: Path) -> None:
            roots.append(root)
            super().__init__(root)

    monkeypatch.setattr(composition, "RawResponseCache", RecordingCache)

    sources = build_sources(make_settings(data_dir=tmp_path))
    await sources.close()

    assert roots == [tmp_path / "bronze" / "http"]


@pytest.mark.asyncio
async def test_each_service_is_paced_by_its_own_setting(monkeypatch: pytest.MonkeyPatch) -> None:
    intervals: list[float] = []
    real = RequestPacer

    def recording(min_interval_s: float) -> RequestPacer:
        intervals.append(min_interval_s)
        return real(min_interval_s)

    monkeypatch.setattr(composition, "RequestPacer", recording)

    sources = build_sources(make_settings(iem_request_interval_s=3.5, open_meteo_request_interval_s=9.0))
    await sources.close()

    assert sorted(intervals) == [3.5, 9.0]


@pytest.mark.asyncio
async def test_a_registry_passed_in_replaces_the_forecast_source() -> None:
    fake = InMemoryForecastSource({})

    sources = build_sources(make_settings(), registry={"open_meteo": lambda settings, client, cache: fake})
    await sources.close()

    assert sources.forecasts is fake
    assert isinstance(sources.observations["iem"], IemMetarSource)  # the observation adapters stay real


def test_a_forecast_source_nobody_registered_fails_the_assembly() -> None:
    settings = make_settings(forecast_source="replay", replay_snapshot_id="demo-2026")

    with pytest.raises(UnknownAdapterError, match=r"replay.*open_meteo"):
        build_sources(settings, registry={"open_meteo": FORECAST_SOURCES["open_meteo"]})


@pytest.mark.asyncio
async def test_sources_without_a_client_close_without_effect() -> None:
    sources = Sources(observations={}, forecasts=InMemoryForecastSource({}))

    await sources.close()  # does not raise
