"""``ParquetStore``: the silver layer (hourly observations, forecasts, binning reports) and the gold dataset."""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import polars as pl
import pytest

from stellar_blaze.adapters.storage.parquet_store import MissingBinningReportError, ParquetStore
from stellar_blaze.domain.weather.dataset import DatasetSummary, ManifestFile, ObservationQc
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import (
    FORECAST_SCHEMA,
    GOLD_PAIRS_SCHEMA,
    OBS_HOURLY_SCHEMA,
    SchemaMismatchError,
)
from tests.unit.application.support import forecast_rows, gold_row

pytestmark = pytest.mark.unit

HOUR = datetime(2025, 7, 1, 10, tzinfo=UTC)
NOW = datetime(2026, 11, 12, 9, 30, tzinfo=UTC)


def obs_frame(icao: str, *, source: str = "iem", hours: int = 3, t_c: float = 35.0) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "station": [icao] * hours,
            "valid_time": [HOUR + timedelta(hours=h) for h in range(hours)],
            "t_c": [t_c + h for h in range(hours)],
            "td_c": [12.0] * hours,
            "wind_ms": [None] + [3.0] * (hours - 1),
            "source": [source] * hours,
        },
        schema=OBS_HOURLY_SCHEMA,
    )


def fc_frame(icao: str, model: NwpModel = NwpModel.ECMWF_IFS025, *, t_c: float = 35.0) -> pl.DataFrame:
    return forecast_rows(icao, model, hours=[HOUR, HOUR + timedelta(hours=1)], leads=(0, 1), t_c=t_c)


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def empty_summary() -> DatasetSummary:
    return DatasetSummary(pair_counts=[], raw_errors=[], wbgt_rejects={})


def temporary_files(root: Path) -> list[Path]:
    return list(root.rglob("*.tmp"))


# === observations ===================================================================================================


def test_observations_round_trip_in_the_documented_layout(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    omaa_2025 = obs_frame("OMAA")
    omdb_2025 = obs_frame("OMDB", t_c=40.0)

    first = store.write_observations("iem", 2025, "OMAA", omaa_2025)
    second = store.write_observations("iem", 2025, "OMDB", omdb_2025)
    store.write_observations("ghcnh", 2025, "OMAA", obs_frame("OMAA", source="ghcnh", t_c=1.0))

    assert first == tmp_path / "silver" / "observations" / "iem" / "2025" / "OMAA.parquet"
    assert second == tmp_path / "silver" / "observations" / "iem" / "2025" / "OMDB.parquet"
    read = store.read_observations("iem")
    assert read.schema == OBS_HOURLY_SCHEMA
    assert read.equals(pl.concat([omaa_2025, omdb_2025]))  # the other source is not in it
    assert store.read_observations("ghcnh")["t_c"].to_list() == [1.0, 2.0, 3.0]


def test_an_observation_write_replaces_the_file_even_while_an_earlier_read_is_alive(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    store.write_observations("iem", 2025, "OMAA", obs_frame("OMAA", t_c=30.0))
    earlier = store.read_observations("iem")  # still referenced: on Windows an open mapping would block the rename

    store.write_observations("iem", 2025, "OMAA", obs_frame("OMAA", t_c=31.0))

    assert earlier["t_c"][0] == 30.0
    assert store.read_observations("iem")["t_c"][0] == 31.0


def test_reading_with_nothing_written_gives_an_empty_frame_with_the_schema(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)

    observations = store.read_observations("iem")
    forecasts = store.read_forecasts()

    assert observations.height == 0
    assert observations.schema == OBS_HOURLY_SCHEMA
    assert forecasts.height == 0
    assert forecasts.schema == FORECAST_SCHEMA


def test_an_empty_observation_frame_is_stored_and_read_back(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)

    store.write_observations("iem", 2025, "OMAA", pl.DataFrame(schema=OBS_HOURLY_SCHEMA))

    assert store.read_observations("iem").schema == OBS_HOURLY_SCHEMA
    assert [file.rows for file in store.silver_inputs()] == [0]


def test_observation_write_refuses_a_frame_of_another_station_or_source(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)

    with pytest.raises(ValueError, match=r"'station'.*OMDB"):
        store.write_observations("iem", 2025, "OMAA", obs_frame("OMDB"))
    with pytest.raises(ValueError, match=r"'source'.*ghcnh"):
        store.write_observations("iem", 2025, "OMAA", obs_frame("OMAA", source="ghcnh"))

    assert not (tmp_path / "silver").exists()


def test_observation_write_refuses_a_frame_with_the_wrong_schema(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    wrong = obs_frame("OMAA").with_columns(pl.col("t_c").cast(pl.Int64))

    with pytest.raises(SchemaMismatchError, match="wrong dtypes"):
        store.write_observations("iem", 2025, "OMAA", wrong)


@pytest.mark.parametrize(("source", "icao"), [("../iem", "OMAA"), ("iem", "../OMAA"), ("", "OMAA"), ("iem", "OM/AA")])
def test_names_that_are_not_plain_identifiers_never_become_a_path(tmp_path: Path, source: str, icao: str) -> None:
    with pytest.raises(ValueError, match="plain identifier"):
        ParquetStore(tmp_path).write_observations(source, 2025, icao, obs_frame("OMAA"))


def test_reading_a_file_that_does_not_match_the_schema_names_the_file(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    store.write_observations("iem", 2025, "OMAA", obs_frame("OMAA"))
    path = tmp_path / "silver" / "observations" / "iem" / "2025" / "OMAA.parquet"
    pl.read_parquet(path).with_columns(pl.col("t_c").cast(pl.Int64)).write_parquet(path)

    with pytest.raises(SchemaMismatchError, match=r"OMAA\.parquet.*wrong dtypes"):
        store.read_observations("iem")


# === atomicity ======================================================================================================


def test_a_failed_write_keeps_the_previous_file_intact_and_leaves_no_temporary_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = ParquetStore(tmp_path)
    final = store.write_observations("iem", 2025, "OMAA", obs_frame("OMAA", t_c=30.0))
    before = final.read_bytes()

    def disk_full(self: Path, target: Path) -> Path:
        raise OSError("disk full")

    with monkeypatch.context() as patch:
        patch.setattr(Path, "replace", disk_full)  # the rename is the commit point of the atomic write
        with pytest.raises(OSError, match="disk full"):
            store.write_observations("iem", 2025, "OMAA", obs_frame("OMAA", t_c=99.0))

    assert final.read_bytes() == before
    assert temporary_files(tmp_path) == []
    assert store.read_observations("iem")["t_c"][0] == 30.0


def test_a_failed_first_write_leaves_neither_file_nor_temporary_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = ParquetStore(tmp_path)

    def disk_full(self: Path, target: Path) -> Path:
        raise OSError("disk full")

    with monkeypatch.context() as patch:
        patch.setattr(Path, "replace", disk_full)
        with pytest.raises(OSError, match="disk full"):
            store.write_forecasts(NwpModel.ECMWF_IFS025, 2025, "OMAA", fc_frame("OMAA"))

    assert [path for path in tmp_path.rglob("*") if path.is_file()] == []


def test_a_successful_write_leaves_no_temporary_file(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)

    store.write_forecasts(NwpModel.ECMWF_IFS025, 2025, "OMAA", fc_frame("OMAA"))
    store.write_observations("iem", 2025, "OMAA", obs_frame("OMAA"))

    assert temporary_files(tmp_path) == []


# === forecasts ======================================================================================================


def test_forecasts_round_trip_across_models_summers_and_stations(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    ifs = fc_frame("OMAA")
    gfs = fc_frame("OMDB", NwpModel.GFS_SEAMLESS, t_c=33.0)

    path = store.write_forecasts(NwpModel.ECMWF_IFS025, 2025, "OMAA", ifs)
    store.write_forecasts(NwpModel.GFS_SEAMLESS, 2025, "OMDB", gfs)

    assert path == tmp_path / "silver" / "forecasts" / "ecmwf_ifs025" / "2025" / "OMAA.parquet"
    read = store.read_forecasts()
    assert read.schema == FORECAST_SCHEMA
    assert read.height == ifs.height + gfs.height
    assert set(read["model"]) == {"ecmwf_ifs025", "gfs_seamless"}
    assert read.filter(pl.col("model") == "gfs_seamless").equals(gfs)


def test_forecast_write_refuses_a_frame_of_another_model_or_station(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)

    with pytest.raises(ValueError, match=r"'model'.*gfs_seamless"):
        store.write_forecasts(NwpModel.ECMWF_IFS025, 2025, "OMAA", fc_frame("OMAA", NwpModel.GFS_SEAMLESS))
    with pytest.raises(ValueError, match=r"'station'.*OMDB"):
        store.write_forecasts(NwpModel.ECMWF_IFS025, 2025, "OMAA", fc_frame("OMDB"))


# === binning reports ================================================================================================


def qc(
    source: str, station: str, summer: int, *, n_raw: int = 100, implausible: int = 1, flagged: int = 2
) -> ObservationQc:
    return ObservationQc(
        source=source,
        station=station,
        summer=summer,
        n_raw=n_raw,
        n_implausible={"t_c": implausible, "td_c": 0, "wind_ms": 0},
        n_qc_flagged={"t_c": flagged, "td_c": 0, "wind_ms": 0},
    )


def test_binning_reports_round_trip_next_to_the_silver_files(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    store.write_observations("ghcnh", 2025, "OMAA", obs_frame("OMAA", source="ghcnh"))
    store.write_observations("ghcnh", 2025, "OMDB", obs_frame("OMDB", source="ghcnh"))
    first = qc("ghcnh", "OMAA", 2025, flagged=7)
    second = qc("ghcnh", "OMDB", 2025)

    path = store.write_binning_report(first)
    store.write_binning_report(second)

    assert path == tmp_path / "silver" / "observations" / "ghcnh" / "2025" / "OMAA.binning.json"
    assert store.read_binning_reports("ghcnh") == [first, second]
    assert store.read_observations("ghcnh").height == 6  # the .json files are not mistaken for observations


def test_a_silver_observation_file_without_its_binning_report_is_an_error(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    store.write_observations("iem", 2025, "OMAA", obs_frame("OMAA"))
    store.write_observations("iem", 2025, "OMDB", obs_frame("OMDB"))
    store.write_binning_report(qc("iem", "OMAA", 2025))

    with pytest.raises(MissingBinningReportError, match=r"iem/2025/OMDB"):
        store.read_binning_reports("iem")


def test_a_binning_report_is_stored_under_the_names_it_carries(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)

    with pytest.raises(ValueError, match="plain identifier"):
        store.write_binning_report(qc("../iem", "OMAA", 2025))


# === gold ===========================================================================================================


def gold_frame(rows: int = 3) -> pl.DataFrame:
    return pl.DataFrame([gold_row(hour_offset=h) for h in range(rows)], schema=GOLD_PAIRS_SCHEMA)


def test_write_gold_produces_a_manifest_that_matches_the_files(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    store.write_observations("iem", 2025, "OMAA", obs_frame("OMAA"))
    store.write_forecasts(NwpModel.ECMWF_IFS025, 2025, "OMAA", fc_frame("OMAA"))
    pairs = gold_frame()
    summary = empty_summary()

    manifest = store.write_gold(
        pairs, summary=summary, code_version="abc1234", inputs=store.silver_inputs(), created_at=NOW
    )

    output = tmp_path / "gold" / "pairs.parquet"
    assert manifest.output == ManifestFile(path="gold/pairs.parquet", sha256=sha256_of(output), rows=3)
    assert manifest.created_at == NOW
    assert manifest.code_version == "abc1234"
    assert manifest.summary == summary
    assert [(file.path, file.rows) for file in manifest.inputs] == [
        ("silver/forecasts/ecmwf_ifs025/2025/OMAA.parquet", 4),
        ("silver/observations/iem/2025/OMAA.parquet", 3),
    ]
    for file in manifest.inputs:
        assert file.sha256 == sha256_of(tmp_path / file.path)
    on_disk = json.loads((tmp_path / "gold" / "manifest.json").read_text(encoding="utf-8"))
    assert on_disk["output"]["sha256"] == sha256_of(output)
    assert type(manifest).model_validate(on_disk) == manifest
    assert pl.read_parquet(output).equals(pairs)
    assert temporary_files(tmp_path) == []


def test_write_gold_is_deterministic_for_the_same_pairs(tmp_path: Path) -> None:
    first_store, second_store = ParquetStore(tmp_path / "a"), ParquetStore(tmp_path / "b")

    first = first_store.write_gold(gold_frame(), summary=empty_summary(), code_version="x", inputs=[], created_at=NOW)
    second = second_store.write_gold(gold_frame(), summary=empty_summary(), code_version="x", inputs=[], created_at=NOW)

    assert first.output.sha256 == second.output.sha256


def test_a_failed_gold_write_keeps_the_previous_dataset_and_manifest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = ParquetStore(tmp_path)
    store.write_gold(gold_frame(3), summary=empty_summary(), code_version="old", inputs=[], created_at=NOW)
    pairs_before = (tmp_path / "gold" / "pairs.parquet").read_bytes()
    manifest_before = (tmp_path / "gold" / "manifest.json").read_bytes()

    def disk_full(self: Path, target: Path) -> Path:
        raise OSError("disk full")

    with monkeypatch.context() as patch:
        patch.setattr(Path, "replace", disk_full)
        with pytest.raises(OSError, match="disk full"):
            store.write_gold(gold_frame(5), summary=empty_summary(), code_version="new", inputs=[], created_at=NOW)

    assert (tmp_path / "gold" / "pairs.parquet").read_bytes() == pairs_before
    assert (tmp_path / "gold" / "manifest.json").read_bytes() == manifest_before
    assert temporary_files(tmp_path) == []


def test_write_gold_refuses_pairs_that_do_not_have_the_gold_schema(tmp_path: Path) -> None:
    wrong = gold_frame().with_columns(pl.col("fc_t_c").cast(pl.Int64))

    with pytest.raises(SchemaMismatchError, match="wrong dtypes"):
        ParquetStore(tmp_path).write_gold(wrong, summary=empty_summary(), code_version="x", inputs=[], created_at=NOW)

    assert not (tmp_path / "gold").exists()


def test_silver_inputs_list_every_silver_parquet_file_with_relative_posix_paths(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path)
    store.write_observations("iem", 2025, "OMAA", obs_frame("OMAA"))
    store.write_binning_report(qc("iem", "OMAA", 2025))  # not an input: its content is in the manifest summary
    store.write_forecasts(NwpModel.GFS_SEAMLESS, 2025, "OMAA", fc_frame("OMAA", NwpModel.GFS_SEAMLESS))

    inputs = store.silver_inputs()

    assert [file.path for file in inputs] == [
        "silver/forecasts/gfs_seamless/2025/OMAA.parquet",
        "silver/observations/iem/2025/OMAA.parquet",
    ]
    assert inputs == store.silver_inputs()  # stable: a changed file is what makes two calls differ
