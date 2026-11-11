"""The job bodies against fake sources and a temporary directory: what lands on disk, and what the build refuses."""

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from stellar_blaze.adapters.fakes.weather import InMemoryForecastSource, InMemoryObservationSource
from stellar_blaze.adapters.http.client import UpstreamError
from stellar_blaze.adapters.storage.parquet_store import MissingBinningReportError, ParquetStore
from stellar_blaze.composition import Sources
from stellar_blaze.config import Settings
from stellar_blaze.domain.weather.dataset import GoldManifest
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, GOLD_PAIRS_SCHEMA, OBS_HOURLY_SCHEMA
from stellar_blaze.domain.weather.stations import station
from stellar_blaze.jobs.work import DatasetInputError, build_dataset, ingest_forecasts, ingest_observations
from stellar_blaze.logging import configure_logging
from tests.unit.adapters.http_support import json_lines
from tests.unit.jobs.support import (
    SUMMER,
    FailingForecasts,
    fake_sources,
    iem_frames,
)

pytestmark = pytest.mark.unit

OMAA, OMDB = station("OMAA"), station("OMDB")
IFS, GFS = NwpModel.ECMWF_IFS025, NwpModel.GFS_SEAMLESS


async def ingest_everything(sources: Sources, store: ParquetStore) -> None:
    for source_name in ("iem", "ghcnh"):
        await ingest_observations(
            sources=sources, source_name=source_name, stations=[OMAA, OMDB], summers=[SUMMER], store=store
        )
    for model in (IFS, GFS):
        await ingest_forecasts(sources=sources, model=model, stations=[OMAA, OMDB], summers=[SUMMER], store=store)


# === ingest_observations ============================================================================================


@pytest.mark.asyncio
async def test_ingest_observations_stores_each_station_summer_with_its_binning_report(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)

    summary = await ingest_observations(
        sources=fake_sources(), source_name="iem", stations=[OMAA, OMDB], summers=[SUMMER], store=store
    )

    stored = store.read_observations("iem")
    assert stored.schema == OBS_HOURLY_SCHEMA
    assert sorted(stored["station"].unique()) == ["OMAA", "OMDB"]
    assert set(stored["source"]) == {"iem"}
    omaa = stored.filter(pl.col("station") == "OMAA")
    assert omaa.height == 24
    assert omaa.filter(pl.col("valid_time") == datetime(SUMMER, 7, 1, 3, tzinfo=UTC))["t_c"].to_list() == [None]
    reports = store.read_binning_reports("iem")
    assert [(r.station, r.summer, r.n_raw) for r in reports] == [("OMAA", SUMMER, 24), ("OMDB", SUMMER, 24)]
    assert summary["rows"] == 48
    assert summary["source"] == "iem"
    files: Any = summary["files"]
    assert [(f["station"], f["summer"], f["rows"]) for f in files] == [("OMAA", SUMMER, 24), ("OMDB", SUMMER, 24)]


@pytest.mark.asyncio
async def test_a_flagged_ghcnh_value_is_excluded_from_the_audit_values_and_counted(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)

    await ingest_observations(
        sources=fake_sources(), source_name="ghcnh", stations=[OMAA], summers=[SUMMER], store=store
    )

    stored = store.read_observations("ghcnh")
    assert stored.filter(pl.col("valid_time") == datetime(SUMMER, 7, 1, 12, tzinfo=UTC))["t_c"].to_list() == [None]
    (report,) = store.read_binning_reports("ghcnh")
    assert report.n_qc_flagged == {"t_c": 1, "td_c": 0, "wind_ms": 0}  # the 47.7 is counted, not dropped silently
    assert report.n_implausible == {"t_c": 0, "td_c": 0, "wind_ms": 0}


@pytest.mark.asyncio
async def test_ingest_observations_logs_one_line_per_station_summer_with_the_binning_report(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    configure_logging(settings)

    await ingest_observations(
        sources=fake_sources(),
        source_name="ghcnh",
        stations=[OMAA, OMDB],
        summers=[SUMMER],
        store=ParquetStore(tmp_path),
    )

    lines = [line for line in json_lines(capsys.readouterr().out) if line["event"] == "ingest.observations"]
    assert [(line["station"], line["summer"], line["source"]) for line in lines] == [
        ("OMAA", SUMMER, "ghcnh"),
        ("OMDB", SUMMER, "ghcnh"),
    ]
    assert lines[0]["rows"] == 24
    assert lines[0]["n_raw"] == 24
    assert lines[0]["n_qc_flagged"] == {"t_c": 1, "td_c": 0, "wind_ms": 0}
    assert lines[0]["n_implausible"] == {"t_c": 0, "td_c": 0, "wind_ms": 0}


@pytest.mark.asyncio
async def test_a_station_summer_without_reports_is_stored_empty_and_warned_about(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    configure_logging(settings)
    store = ParquetStore(tmp_path)

    summary = await ingest_observations(
        sources=fake_sources(icaos=("OMAA",)), source_name="iem", stations=[OMDB], summers=[SUMMER], store=store
    )

    assert summary["rows"] == 0
    assert store.read_observations("iem").height == 0
    (report,) = store.read_binning_reports("iem")  # the empty file still has its report: the build can account for it
    assert report.n_raw == 0
    events = [line["event"] for line in json_lines(capsys.readouterr().out)]
    assert "ingest.observations_empty" in events


@pytest.mark.asyncio
async def test_the_first_failure_stops_the_job_and_keeps_what_was_stored(tmp_path: Path) -> None:
    class FailsFor(InMemoryObservationSource):
        async def observations(self, *, station: Any, start: datetime, end: datetime) -> pl.DataFrame:
            if station.icao == "OMDB":
                raise UpstreamError("GET x returned HTTP 503", url="https://x", status=503)
            return await super().observations(station=station, start=start, end=end)

    sources = Sources(
        observations={"iem": FailsFor(iem_frames("OMAA", "OMDB"), name="iem")}, forecasts=InMemoryForecastSource({})
    )
    store = ParquetStore(tmp_path)

    with pytest.raises(UpstreamError, match="503"):
        await ingest_observations(
            sources=sources, source_name="iem", stations=[OMAA, OMDB, station("OMAL")], summers=[SUMMER], store=store
        )

    assert sorted(store.read_observations("iem")["station"].unique()) == ["OMAA"]  # OMAA kept, OMAL never tried


@pytest.mark.asyncio
async def test_ingest_observations_is_idempotent(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    sources = fake_sources()
    for _ in range(2):
        await ingest_observations(sources=sources, source_name="iem", stations=[OMAA], summers=[SUMMER], store=store)

    assert store.read_observations("iem").height == 24
    assert len(store.read_binning_reports("iem")) == 1


@pytest.mark.asyncio
async def test_an_unknown_source_name_is_a_key_error(tmp_path: Path) -> None:
    with pytest.raises(KeyError, match="meteostat"):
        await ingest_observations(
            sources=fake_sources(),
            source_name="meteostat",
            stations=[OMAA],
            summers=[SUMMER],
            store=ParquetStore(tmp_path),
        )


# === ingest_forecasts ===============================================================================================


@pytest.mark.asyncio
async def test_ingest_forecasts_stores_each_station_summer_of_the_model(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)

    summary = await ingest_forecasts(
        sources=fake_sources(), model=GFS, stations=[OMAA, OMDB], summers=[SUMMER], store=store
    )

    stored = store.read_forecasts()
    assert stored.schema == FORECAST_SCHEMA
    assert set(stored["model"]) == {"gfs_seamless"}
    assert sorted(stored["station"].unique()) == ["OMAA", "OMDB"]
    assert stored.height == 2 * 24 * 8
    assert summary["rows"] == 2 * 24 * 8
    assert summary["model"] == "gfs_seamless"
    assert (tmp_path / "silver" / "forecasts" / "gfs_seamless" / str(SUMMER) / "OMDB.parquet").is_file()


@pytest.mark.asyncio
async def test_ingest_forecasts_refuses_a_summer_the_archive_does_not_have_and_keeps_the_earlier_ones(
    tmp_path: Path,
) -> None:
    store = ParquetStore(tmp_path)

    with pytest.raises(ValueError, match=r"ecmwf_aifs025_single.*2024"):
        await ingest_forecasts(
            sources=fake_sources(models=(NwpModel.ECMWF_AIFS025,)),
            model=NwpModel.ECMWF_AIFS025,
            stations=[OMAA],
            summers=[2025, 2024],  # 2025 is stored; 2024 has no archive and stops the job
            store=store,
        )

    stored = store.read_forecasts()
    assert stored.height == 24 * 8
    assert set(stored["model"]) == {"ecmwf_aifs025_single"}


@pytest.mark.asyncio
async def test_a_failing_forecast_source_fails_the_job(tmp_path: Path) -> None:
    sources = Sources(observations={}, forecasts=FailingForecasts(UpstreamError("quota", url="https://x", status=429)))

    with pytest.raises(UpstreamError, match="quota"):
        await ingest_forecasts(
            sources=sources, model=IFS, stations=[OMAA], summers=[SUMMER], store=ParquetStore(tmp_path)
        )


# === build_dataset ==================================================================================================


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.mark.asyncio
async def test_build_dataset_writes_the_pairs_and_a_manifest_that_describes_them(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    await ingest_everything(fake_sources(), store)

    summary = await build_dataset(store=store, code_version="abc1234")

    pairs_path = tmp_path / "gold" / "pairs.parquet"
    pairs = pl.read_parquet(pairs_path)
    assert pairs.schema == GOLD_PAIRS_SCHEMA
    assert pairs.height == 2 * 2 * 24 * 8  # stations x models x hours x leads
    manifest = GoldManifest.model_validate(
        json.loads((tmp_path / "gold" / "manifest.json").read_text(encoding="utf-8"))
    )
    assert manifest.code_version == "abc1234"
    assert manifest.output.path == "gold/pairs.parquet"
    assert manifest.output.sha256 == sha256_of(pairs_path)
    assert manifest.output.rows == pairs.height
    assert [file.path for file in manifest.inputs] == sorted(_silver_parquets(tmp_path))
    assert len(manifest.inputs) == 4 + 4  # 2 stations x 2 observation sources, 2 stations x 2 models
    assert all(file.sha256 == sha256_of(tmp_path / file.path) for file in manifest.inputs)
    assert summary == {
        "rows": pairs.height,
        "sha256": manifest.output.sha256,
        "path": "gold/pairs.parquet",
        "inputs": 8,
        "code_version": "abc1234",
    }


def _silver_parquets(root: Path) -> list[str]:
    return [path.relative_to(root).as_posix() for path in (root / "silver").rglob("*.parquet")]


@pytest.mark.asyncio
async def test_the_manifest_summary_records_what_binning_excluded(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    await ingest_everything(fake_sources(), store)

    await build_dataset(store=store, code_version="x")

    manifest = GoldManifest.model_validate_json((tmp_path / "gold" / "manifest.json").read_text(encoding="utf-8"))
    qc = {(q.source, q.station): q for q in manifest.summary.observation_qc}
    assert sorted(qc) == [("ghcnh", "OMAA"), ("ghcnh", "OMDB"), ("iem", "OMAA"), ("iem", "OMDB")]
    assert qc[("ghcnh", "OMAA")].n_qc_flagged["t_c"] == 1
    assert qc[("iem", "OMAA")].n_qc_flagged["t_c"] == 0
    assert qc[("iem", "OMAA")].n_raw == 24


@pytest.mark.asyncio
async def test_the_pairs_carry_truth_audit_and_reference_from_the_silver_layer(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    await ingest_everything(fake_sources(), store)

    await build_dataset(store=store, code_version="x")

    pairs = pl.read_parquet(tmp_path / "gold" / "pairs.parquet")
    noon = pairs.filter(
        (pl.col("station") == "OMAA")
        & (pl.col("model") == "gfs_seamless")
        & (pl.col("lead_days") == 3)
        & (pl.col("valid_time") == datetime(SUMMER, 7, 1, 12, tzinfo=UTC))
    ).row(0, named=True)
    assert noon["fc_t_c"] == 33.0 + 3  # forecasts_for: 33 + lead
    assert noon["obs_t_c"] is not None
    assert noon["audit_t_c"] is None  # the flagged 47.7 is not in the audit values
    assert noon["ref_sw_wm2"] == 800.0
    assert noon["has_joint_obs"] is True
    three = pairs.filter(
        (pl.col("station") == "OMAA") & (pl.col("valid_time") == datetime(SUMMER, 7, 1, 3, tzinfo=UTC))
    )
    assert three["has_joint_obs"].to_list() == [False] * three.height  # the null observed temperature


@pytest.mark.asyncio
async def test_two_builds_of_the_same_silver_layer_give_the_same_dataset_bytes(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    await ingest_everything(fake_sources(), store)

    first = await build_dataset(store=store, code_version="x")
    second = await build_dataset(store=store, code_version="x")

    assert first["sha256"] == second["sha256"]


@pytest.mark.asyncio
async def test_build_dataset_without_forecasts_or_truth_says_what_to_run_first(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    with pytest.raises(DatasetInputError, match="ingest-forecasts"):
        await build_dataset(store=store, code_version="x")

    await ingest_forecasts(sources=fake_sources(), model=IFS, stations=[OMAA], summers=[SUMMER], store=store)
    with pytest.raises(DatasetInputError, match=r"iem.*ingest-observations"):
        await build_dataset(store=store, code_version="x")

    assert not (tmp_path / "gold").exists()


@pytest.mark.asyncio
async def test_without_audit_observations_the_build_goes_on_with_a_warning(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    configure_logging(settings)
    store = ParquetStore(tmp_path)
    sources = fake_sources()
    await ingest_observations(sources=sources, source_name="iem", stations=[OMAA], summers=[SUMMER], store=store)
    await ingest_forecasts(sources=sources, model=IFS, stations=[OMAA], summers=[SUMMER], store=store)

    await build_dataset(store=store, code_version="x")

    pairs = pl.read_parquet(tmp_path / "gold" / "pairs.parquet")
    assert pairs["audit_t_c"].null_count() == pairs.height
    assert "build_dataset.no_audit_observations" in [line["event"] for line in json_lines(capsys.readouterr().out)]


@pytest.mark.asyncio
async def test_a_silver_observation_file_without_its_binning_report_stops_the_build(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    await ingest_everything(fake_sources(), store)
    (tmp_path / "silver" / "observations" / "iem" / str(SUMMER) / "OMDB.binning.json").unlink()

    with pytest.raises(MissingBinningReportError, match=r"iem/2025/OMDB"):
        await build_dataset(store=store, code_version="x")

    assert not (tmp_path / "gold").exists()


@pytest.mark.asyncio
async def test_a_silver_file_that_changes_during_the_build_stops_it(tmp_path: Path) -> None:
    class ChangesUnderneath(ParquetStore):
        """Another ingest replaces a station's observations just after the build has read the forecasts."""

        def read_forecasts(self) -> pl.DataFrame:
            frames = super().read_forecasts()
            other = fake_sources().observations["iem"]
            replacement = iem_frames("OMAA")["OMAA"].with_columns(pl.col("t_c") + 1.0)
            self.write_observations("iem", SUMMER, "OMAA", _hourly(replacement, other.name))
            return frames

    def _hourly(raw: pl.DataFrame, name: str) -> pl.DataFrame:
        return raw.select(
            "station", pl.col("obs_time").alias("valid_time"), "t_c", "td_c", "wind_ms", pl.lit(name).alias("source")
        )

    store = ChangesUnderneath(tmp_path)
    await ingest_everything(fake_sources(), store)

    with pytest.raises(DatasetInputError, match="changed while the dataset was built"):
        await build_dataset(store=store, code_version="x")

    assert not (tmp_path / "gold").exists()
