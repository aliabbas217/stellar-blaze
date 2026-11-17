"""The canonical JSON writer, the abu_dhabi out-of-fold sample export and the dev exports (Task 12).

The JSON writer is tested on its bytes. The exports run on the small synthetic dev run (``tests/fixtures/forecast/
dev_run.py``): its out-of-fold predictions are computed once for the module.
"""

import dataclasses
import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Final

import numpy as np
import polars as pl
import pyarrow.parquet as pq
import pytest
from pydantic import JsonValue

from stellar_blaze.domain.forecast.features import Target
from stellar_blaze.domain.provenance import Provenance, ProvenanceLabel
from stellar_blaze.ml.data import HoldoutViolationError
from stellar_blaze.ml.evaluate import OofPredictions, coverage_by_forecast_tercile, evaluate_dev, evaluate_summer_split
from stellar_blaze.ml.exporters import (
    PROTOCOL_PATH,
    REPORT_HOUR_BLOCKS,
    REPORT_LEADS,
    SECTION_6_HEADING,
    SECTION_7_1_HEADING,
    dev_skill_payload,
    github_slug,
    oof_samples_frame,
    preflight_dev_exports,
    render_json,
    render_oof_samples,
    write_dev_exports,
    write_json,
    write_oof_samples,
)
from stellar_blaze.ml.selection import EXPORT_CLUSTER, Decision, select_calibration_window
from tests.fixtures.forecast.dev_run import CLUSTERS, dev_cfg, dev_pairs
from tests.fixtures.forecast.trained import CFG_SHA256

pytestmark = pytest.mark.unit

GENERATED: Final = datetime(2026, 11, 14, 9, 30, tzinfo=UTC)
GIT_SHA: Final = "a" * 40
DATA_SHA: Final = "b" * 64
COMMAND: Final = "sb-jobs evaluate-dev --config backend/training/configs/unit.toml --grid"
REPO_ROOT: Final = Path(__file__).resolve().parents[4]


def _provenance() -> Provenance:
    return Provenance(
        protocol_path=PROTOCOL_PATH,
        protocol_anchor="#6-selection-rules-on-2024-2025-loco-out-of-fold-only",
        script="stellar_blaze.ml.exporters",
        function="write_json",
        git_sha=GIT_SHA,
        data_sha256=DATA_SHA,
        model_id=None,
        label=ProvenanceLabel.REAL,
        generated_at=GENERATED,
    )


# === slugs ==========================================================================================================


def test_github_slug_of_the_two_section_headings() -> None:
    assert github_slug(SECTION_6_HEADING) == "6-selection-rules-on-2024-2025-loco-out-of-fold-only"
    assert github_slug(SECTION_7_1_HEADING) == "71-forecast-row-b2-artifactseval2026forecast_skilljson"
    assert github_slug("Hello, World -- a_b (c)") == "hello-world----a_b-c"


def test_the_headings_are_the_ones_in_the_preregistration() -> None:
    document = REPO_ROOT / PROTOCOL_PATH
    if not document.is_file():
        pytest.skip("the pre-registration is not in this checkout")
    lines = {
        line.lstrip("#").strip() for line in document.read_text(encoding="utf-8").splitlines() if line.startswith("#")
    }

    assert SECTION_6_HEADING in lines
    assert SECTION_7_1_HEADING in lines


# === write_json =====================================================================================================


def test_write_json_is_canonical_and_hashed(tmp_path: Path) -> None:
    path = tmp_path / "out" / "result.json"
    digest = write_json(path, {"b": 1.5, "a": ["x", "°C"], "c": {"z": None, "y": True}}, _provenance())

    raw = path.read_bytes()
    assert digest == hashlib.sha256(raw).hexdigest()
    assert b"\r" not in raw  # LF only, on Windows too (R21)
    assert raw.endswith(b"\n")
    assert not raw.endswith(b"\n\n")
    text = raw.decode("utf-8")
    assert "°C" in text  # UTF-8, not \u escapes
    parsed = json.loads(text)
    assert list(parsed) == sorted(parsed)  # sorted keys
    assert text.index('"a"') < text.index('"b"') < text.index('"c"') < text.index('"provenance"')
    assert ", " not in text  # fixed compact separators
    assert ": " not in text
    assert parsed["provenance"]["protocol_path"] == PROTOCOL_PATH
    assert parsed["provenance"]["generated_at"].startswith("2026-11-14T09:30:00")
    assert parsed["provenance"]["label"] == "REAL"


def test_write_json_does_not_depend_on_key_order(tmp_path: Path) -> None:
    first = write_json(tmp_path / "one.json", {"a": 1, "b": {"x": 1, "y": 2}}, _provenance())
    second = write_json(tmp_path / "two.json", {"b": {"y": 2, "x": 1}, "a": 1}, _provenance())

    assert first == second
    assert (tmp_path / "one.json").read_bytes() == (tmp_path / "two.json").read_bytes()


def test_write_json_exclusive_create_refuses_an_existing_file(tmp_path: Path) -> None:
    path = tmp_path / "result.json"
    write_json(path, {"n": 1}, _provenance(), exclusive=True)
    before = path.read_bytes()

    with pytest.raises(FileExistsError):
        write_json(path, {"n": 2}, _provenance(), exclusive=True)

    assert path.read_bytes() == before  # the first output is untouched
    write_json(path, {"n": 3}, _provenance())  # the default overwrites (dev exports are re-run)
    assert json.loads(path.read_bytes())["n"] == 3


def test_write_json_refuses_non_finite_numbers_and_writes_nothing(tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    for bad in (float("nan"), float("inf"), float("-inf")):
        payload: dict[str, JsonValue] = {"value": bad}
        with pytest.raises(ValueError, match=r"Out of range float|nan|inf"):
            write_json(path, payload, _provenance())
    assert not path.exists()


def test_write_json_refuses_a_payload_that_already_has_provenance(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="provenance"):
        write_json(tmp_path / "x.json", {"provenance": {}}, _provenance())


# === the dev run ====================================================================================================


@pytest.fixture(scope="module")
def run() -> tuple[pl.DataFrame, OofPredictions, OofPredictions]:
    pairs, cfg = dev_pairs(), dev_cfg()
    oof = evaluate_dev(pairs, cfg, cfg_sha256=CFG_SHA256, clusters=CLUSTERS, sample_clusters=(EXPORT_CLUSTER,))
    split = evaluate_summer_split(pairs, cfg, cfg_sha256=CFG_SHA256)
    return pairs, oof, split


def _with_keys(oof: OofPredictions, keys: pl.DataFrame) -> OofPredictions:
    return dataclasses.replace(oof, keys=keys)


# === the abu_dhabi sample export ====================================================================================


@pytest.mark.slow
def test_oof_samples_frame_holds_the_consumer_columns_for_lead_one_working_hours(
    run: tuple[pl.DataFrame, OofPredictions, OofPredictions],
) -> None:
    pairs, oof, _ = run
    frame = oof_samples_frame(oof, pairs)

    assert frame.columns == [
        "station",
        "cluster",
        "valid_time",
        "summer",
        "lead_days",
        "raw_t",
        "raw_td",
        "raw_wind",
        "wbgt_fc_c",
        "fc_sw_wm2",
        "fc_direct_wm2",
        "fc_pressure_hpa",
        "ref_sw_wm2",
        "ref_direct_wm2",
        "ref_pressure_hpa",
        "obs_t_c",
        "obs_td_c",
        "obs_wind_ms",
        "has_joint_obs",
        "samples",
    ]
    assert set(frame["cluster"]) == {EXPORT_CLUSTER}
    assert set(frame["station"]) == {"OMAA"}
    assert set(frame["lead_days"]) == {1}
    assert set(frame["summer"]) == {2024, 2025}
    assert set(frame["valid_time"].dt.hour()) <= set(range(6, 15))
    assert frame.schema["valid_time"] == pl.Datetime("us", "UTC")
    n_samples = oof.samples.shape[1] if oof.samples is not None else -1
    assert frame.schema["samples"] == pl.Array(pl.Float32, (n_samples, 3))
    assert frame.select("station", "valid_time").is_duplicated().sum() == 0
    assert frame.equals(frame.sort("station", "valid_time"))
    ifs = pairs.filter((pl.col("model") == "ecmwf_ifs025") & (pl.col("lead_days") == 1) & (pl.col("station") == "OMAA"))
    expected_rows = ifs.filter(pl.col("hour_utc").is_in(list(range(6, 15)))).height
    assert frame.height == expected_rows


@pytest.mark.slow
def test_oof_samples_frame_values_come_from_the_oof_and_the_pairs(
    run: tuple[pl.DataFrame, OofPredictions, OofPredictions],
) -> None:
    pairs, oof, _ = run
    frame = oof_samples_frame(oof, pairs)
    assert oof.samples is not None
    assert oof.sample_index is not None

    row = frame.filter(pl.col("has_joint_obs")).row(5, named=True)
    source = pairs.filter(
        (pl.col("model") == "ecmwf_ifs025")
        & (pl.col("station") == row["station"])
        & (pl.col("valid_time") == row["valid_time"])
        & (pl.col("lead_days") == row["lead_days"])
    ).row(0, named=True)
    for name in (
        "fc_sw_wm2",
        "fc_direct_wm2",
        "fc_pressure_hpa",
        "ref_sw_wm2",
        "ref_direct_wm2",
        "ref_pressure_hpa",
        "obs_t_c",
        "obs_td_c",
        "obs_wind_ms",
        "wbgt_fc_c",
    ):
        assert row[name] == source[name], name
    assert row["raw_t"] == source["fc_t_c"]
    position = (
        oof.keys.with_row_index("_i")
        .filter(
            (pl.col("station") == row["station"])
            & (pl.col("valid_time") == row["valid_time"])
            & (pl.col("lead_days") == row["lead_days"])
        )["_i"]
        .item()
    )
    in_samples = int(np.flatnonzero(oof.sample_index == position)[0])
    np.testing.assert_array_equal(
        np.asarray(row["samples"], dtype=np.float32), oof.samples[in_samples].astype(np.float32)
    )


@pytest.mark.slow
def test_oof_export_refuses_2026_rows(run: tuple[pl.DataFrame, OofPredictions, OofPredictions]) -> None:
    pairs, oof, _ = run
    exported = oof.keys.with_row_index("_i").filter(
        (pl.col("cluster") == EXPORT_CLUSTER) & (pl.col("lead_days") == 1) & pl.col("hour_utc").is_in([7, 8])
    )["_i"][0]

    def with_summer(frame: pl.DataFrame, row: int) -> pl.DataFrame:
        return (
            frame.with_row_index("_r")
            .with_columns(
                pl.when(pl.col("_r") == row).then(2026).otherwise(pl.col("summer")).cast(pl.Int16).alias("summer")
            )
            .drop("_r")
        )

    in_exported_row = _with_keys(oof, with_summer(oof.keys, int(exported)))
    in_a_row_not_exported = _with_keys(
        oof, with_summer(oof.keys, oof.keys.height - 1)
    )  # the last row is lead 3, fujairah
    by_time = _with_keys(
        oof,
        oof.keys.with_row_index("_r")
        .with_columns(
            pl.when(pl.col("_r") == int(exported))
            .then(
                pl.datetime(
                    2026,
                    pl.col("valid_time").dt.month(),
                    pl.col("valid_time").dt.day(),
                    pl.col("valid_time").dt.hour(),
                    time_zone="UTC",
                )
            )  # the summer column still says 2024 or 2025: only the time reveals the hold-out
            .otherwise(pl.col("valid_time"))
            .alias("valid_time")
        )
        .drop("_r"),
    )

    for tampered in (in_exported_row, in_a_row_not_exported, by_time):
        with pytest.raises(HoldoutViolationError):
            oof_samples_frame(tampered, pairs)
    with pytest.raises(HoldoutViolationError):  # the pairs the export joins from are checked too
        oof_samples_frame(oof, with_summer(pairs, 0))
    assert oof_samples_frame(oof, pairs).height > 0  # the untampered run is fine


@pytest.mark.slow
def test_oof_samples_frame_needs_the_samples_and_rows(run: tuple[pl.DataFrame, OofPredictions, OofPredictions]) -> None:
    pairs, oof, _ = run

    with pytest.raises(ValueError, match="no joint samples"):
        oof_samples_frame(dataclasses.replace(oof, samples=None, sample_index=None), pairs)
    with pytest.raises(ValueError, match="no row"):
        oof_samples_frame(oof, pairs, cluster="fujairah", lead=7)


@pytest.mark.slow
def test_write_oof_samples_is_zstd_parquet_with_provenance_and_is_deterministic(
    run: tuple[pl.DataFrame, OofPredictions, OofPredictions], tmp_path: Path
) -> None:
    pairs, oof, _ = run
    frame = oof_samples_frame(oof, pairs)
    first = write_oof_samples(tmp_path / "a.parquet", frame, _provenance())
    second = write_oof_samples(tmp_path / "b.parquet", frame, _provenance())

    assert first == second == hashlib.sha256((tmp_path / "a.parquet").read_bytes()).hexdigest()
    back = pl.read_parquet(tmp_path / "a.parquet")
    assert back.schema == frame.schema
    np.testing.assert_array_equal(back["samples"].to_numpy(), frame["samples"].to_numpy())
    metadata = pl.read_parquet_metadata(tmp_path / "a.parquet")
    assert json.loads(metadata["provenance"])["script"] == "stellar_blaze.ml.exporters"
    assert json.loads(metadata["provenance"])["git_sha"] == GIT_SHA  # the deterministic provenance stays
    assert "generated_at" not in json.loads(metadata["provenance"])  # a clock inside the file would change its hash
    metadata_pq = pq.ParquetFile(tmp_path / "a.parquet").metadata
    codecs = {metadata_pq.row_group(0).column(i).compression for i in range(metadata_pq.num_columns)}
    assert codecs == {"ZSTD"}


@pytest.mark.slow
def test_the_parquet_bytes_do_not_depend_on_the_generation_time(
    run: tuple[pl.DataFrame, OofPredictions, OofPredictions], tmp_path: Path
) -> None:
    pairs, oof, _ = run
    frame = oof_samples_frame(oof, pairs)
    later = _provenance().model_copy(update={"generated_at": GENERATED + timedelta(days=3, seconds=17)})

    first = render_oof_samples(frame, _provenance())
    second = render_oof_samples(frame, later)

    assert first == second
    assert write_oof_samples(tmp_path / "a.parquet", frame, _provenance()) == hashlib.sha256(first).hexdigest()
    # the JSON files keep the time: only the parquet is made reproducible
    assert render_json({"n": 1}, _provenance()) != render_json({"n": 1}, later)


@pytest.mark.slow
def test_samples_are_float32_with_nan_where_the_forecast_was_missing(
    run: tuple[pl.DataFrame, OofPredictions, OofPredictions],
) -> None:
    pairs, oof, _ = run
    assert oof.samples is not None
    assert oof.sample_index is not None
    exported = (
        oof.keys[oof.sample_index]
        .with_row_index("_s")
        .filter((pl.col("lead_days") == 1) & pl.col("hour_utc").is_in(list(range(6, 15))))
    )
    missing = exported.row(3, named=True)
    samples = oof.samples.copy()
    samples[missing["_s"]] = np.nan  # the forecast was missing: nothing is imputed
    mask = oof.keys.with_row_index("_i")["_i"] == int(oof.sample_index[missing["_s"]])
    keys = oof.keys.with_columns(
        *(pl.when(mask).then(None).otherwise(pl.col(name)).alias(name) for name in ("raw_t", "raw_td", "raw_wind"))
    )

    frame = oof_samples_frame(dataclasses.replace(oof, samples=samples, keys=keys), pairs)

    n_samples = dev_cfg().n_joint_samples
    assert samples.shape[1:] == (n_samples, 3)
    assert frame.schema["samples"] == pl.Array(pl.Float32, (n_samples, 3))
    values = frame["samples"].to_numpy()
    assert values.dtype == np.float32
    assert values.shape == (frame.height, n_samples, 3)
    nan_rows = np.flatnonzero(np.isnan(values).all(axis=(1, 2)))
    row = frame.row(int(nan_rows[0]), named=True)
    assert nan_rows.size == 1
    assert (row["station"], row["valid_time"]) == (missing["station"], missing["valid_time"])
    assert row["raw_t"] is None
    assert np.isfinite(np.delete(values, nan_rows, axis=0)).all()  # and every other row is finite


# === dev_skill.json and the whole export ============================================================================


@pytest.mark.slow
def test_dev_skill_payload_has_every_table_the_report_quotes(
    run: tuple[pl.DataFrame, OofPredictions, OofPredictions],
) -> None:
    _, oof, split = run
    payload = dev_skill_payload(oof, cfg=dev_cfg(), summer_split=split, counts={"oof_rows": oof.keys.height}, n_boot=20)

    assert set(payload) >= {
        "float_decimals",
        "report_leads",
        "report_hour_blocks",
        "models",
        "configuration",
        "counts",
        "tercile_edges",
        "skill",
        "coverage_by_forecast_tercile",
        "by_cluster",
        "by_station",
        "fallbacks",
        "summer_split",
    }
    assert payload["report_leads"] == list(REPORT_LEADS) == [1, 2, 3, 5, 7]
    assert payload["report_hour_blocks"] == list(REPORT_HOUR_BLOCKS) == ["early", "peak", "late", "working"]
    skill = _table(payload["skill"])
    present_leads = sorted(set(oof.keys["lead_days"].unique().to_list()) & set(REPORT_LEADS))
    expected = {
        (target.value, lead, block) for target in Target for lead in present_leads for block in REPORT_HOUR_BLOCKS
    }
    assert set(skill.select("target", "lead_days", "hour_block").iter_rows()) == expected
    for model in ("corrector", "b0", "b0d", "b2d", "b4"):
        for metric in ("crps", "mae", "rmse", "bias"):
            assert f"{metric}_{model}" in skill.columns, (metric, model)
    assert {"crps_b3d", "mae_b3d", "rmse_b3d", "bias_b3d"} <= set(skill.columns)
    for name in (
        "n_rows",
        "n_days",
        "pinball_05",
        "pinball_50",
        "pinball_95",
        "is_90",
        "is_80",
        "cov_90",
        "cov_80",
        "cov_50",
        *(f"pit_{i:02d}" for i in range(10)),
        *(f"brier_c_{t}" for t in (28, 30, 32)),
        *(f"brier_b2d_{t}" for t in (28, 30, 32)),
        *(f"brier_clim_{t}" for t in (28, 30, 32)),
        *(f"bss_c_b2d_{t}" for t in (28, 30, 32)),
        "crps_diff_b2d",
        "crps_diff_b2d_lo",
        "crps_diff_b2d_hi",
        "crps_diff_b0",
    ):
        assert name in skill.columns, name
    tercile = payload["coverage_by_forecast_tercile"]
    assert isinstance(tercile, dict)
    assert set(tercile) == {"working", "all"}
    assert _table(tercile["working"]).columns[:3] == ["target", "lead_days", "tercile"]
    assert set(_table(payload["by_cluster"])["cluster"]) == set(CLUSTERS)
    assert set(_table(payload["by_station"])["station"]) == {"OMAA", "OMDB", "OMFJ"}
    summer_split = payload["summer_split"]
    assert isinstance(summer_split, dict)
    assert set(_table(summer_split["skill"])["fold"]) == {"train2024_test2025", "train2025_test2024"}
    assert payload["tercile_edges"] == pytest.approx(list(oof.tercile_edges))
    json.dumps(payload, allow_nan=False)  # every number is finite JSON


@pytest.mark.slow
def test_dev_skill_payload_without_a_summer_split_says_so(
    run: tuple[pl.DataFrame, OofPredictions, OofPredictions],
) -> None:
    _, oof, _ = run
    payload = dev_skill_payload(oof, cfg=dev_cfg(), summer_split=None, counts={}, n_boot=20)

    assert payload["summer_split"] is None


def _table(value: object) -> pl.DataFrame:
    assert isinstance(value, dict)
    columns, rows = value["columns"], value["rows"]
    assert isinstance(columns, list)
    assert isinstance(rows, list)
    return pl.DataFrame(rows, schema=[str(c) for c in columns], orient="row", infer_schema_length=None)


@pytest.mark.slow
def test_write_dev_exports_writes_four_hashed_files_with_provenance(
    run: tuple[pl.DataFrame, OofPredictions, OofPredictions], tmp_path: Path
) -> None:
    pairs, oof, split = run
    decision = select_calibration_window(
        coverage_by_forecast_tercile(oof, leads=(1, 2, 3), hours="working"), "september"
    )
    hashes = write_dev_exports(
        oof,
        (decision,),
        tmp_path,
        pairs=pairs,
        cfg=dev_cfg(),
        cfg_sha256=CFG_SHA256,
        git_sha=GIT_SHA,
        git_clean=True,
        data_sha256=DATA_SHA,
        command=COMMAND,
        mode="single",
        calibration_targets="all",
        summer_split=split,
        counts={"oof_rows": oof.keys.height},
        n_boot=20,
        now=GENERATED,
    )

    assert sorted(hashes) == [
        "dev_skill.json",
        "oof_samples_abu_dhabi.manifest.json",
        "oof_samples_abu_dhabi.parquet",
        "selection.json",
    ]
    for name, digest in hashes.items():
        assert digest == hashlib.sha256((tmp_path / name).read_bytes()).hexdigest(), name
    selection = json.loads((tmp_path / "selection.json").read_bytes())
    skill = json.loads((tmp_path / "dev_skill.json").read_bytes())
    assert selection["decisions"] == [json.loads(decision.model_dump_json())]
    assert selection["mode"] == "single"
    assert selection["applied"] is False
    assert selection["exports"] == {  # every export but selection.json itself; agrees with the returned hashes
        "dev_skill.json": hashes["dev_skill.json"],
        "oof_samples_abu_dhabi.manifest.json": hashes["oof_samples_abu_dhabi.manifest.json"],
        "oof_samples_abu_dhabi.parquet": hashes["oof_samples_abu_dhabi.parquet"],
    }
    chosen = selection["chosen_configuration"]
    assert chosen["config_fingerprint"] == CFG_SHA256  # the TOML's hash in single mode, a fingerprint in grid mode
    assert "config_sha256" not in chosen
    assert chosen["fingerprint_of"] == "toml_file"
    assert {key: chosen[key] for key in ("feature_set", "wbgt_method", "calibration_window")} == {
        "feature_set": dev_cfg().feature_set.value,
        "wbgt_method": dev_cfg().wbgt_method,
        "calibration_window": dev_cfg().calibration_window,
    }  # the field values `train --release` compares
    assert chosen["lgbm"] == json.loads(dev_cfg().lgbm.model_dump_json())
    assert selection["git_clean"] is True
    assert selection["allow_dirty"] is False
    assert selection["calibration_targets"] == "all"
    assert selection["chosen_configuration"]["lgbm"]["num_leaves"] == 7
    assert selection["counts"] == {"oof_rows": oof.keys.height}
    assert selection["provenance"]["protocol_anchor"] == "#6-selection-rules-on-2024-2025-loco-out-of-fold-only"
    assert skill["provenance"]["protocol_anchor"] == "#71-forecast-row-b2-artifactseval2026forecast_skilljson"
    manifest_bytes = (tmp_path / "oof_samples_abu_dhabi.manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    samples = pl.read_parquet(tmp_path / "oof_samples_abu_dhabi.parquet")
    assert manifest_bytes.endswith(b"}\n")
    assert b"\r" not in manifest_bytes
    assert manifest_bytes == (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    assert {key: manifest[key] for key in manifest if key != "provenance"} == {
        "file": "oof_samples_abu_dhabi.parquet",
        "rows": samples.height,
        "columns": [{"name": name, "dtype": str(dtype)} for name, dtype in samples.schema.items()],
        "sha256": hashlib.sha256((tmp_path / "oof_samples_abu_dhabi.parquet").read_bytes()).hexdigest(),
        "command": COMMAND,
        "git_sha": GIT_SHA,
        "git_clean": True,
    }
    assert manifest["rows"] == selection["samples_rows"] > 0
    assert {"name": "samples", "dtype": str(samples.schema["samples"])} in manifest["columns"]
    assert manifest["provenance"]["function"] == "oof_samples_manifest"
    for block in (selection["provenance"], skill["provenance"], manifest["provenance"]):
        assert block["git_sha"] == GIT_SHA
        assert block["data_sha256"] == DATA_SHA
        assert block["model_id"] is None
        assert block["label"] == "REAL"
        assert block["protocol_path"] == PROTOCOL_PATH
    parquet = json.loads(pl.read_parquet_metadata(tmp_path / "oof_samples_abu_dhabi.parquet")["provenance"])
    assert parquet["protocol_anchor"] == selection["provenance"]["protocol_anchor"]
    assert (tmp_path / "selection.json").stat().st_size < 500_000
    assert (tmp_path / "dev_skill.json").stat().st_size < 500_000


@pytest.mark.slow
def test_write_dev_exports_never_writes_when_the_holdout_is_in_the_rows(
    run: tuple[pl.DataFrame, OofPredictions, OofPredictions], tmp_path: Path
) -> None:
    pairs, oof, _ = run
    tampered = _with_keys(oof, oof.keys.with_columns(pl.col("summer").cast(pl.Int16).replace({2025: 2026})))
    decision = Decision(rule="6.4 calibration window", choice="september", evidence={"floor": 0.85}, tie_broken=False)

    with pytest.raises(HoldoutViolationError):
        write_dev_exports(
            tampered,
            (decision,),
            tmp_path,
            pairs=pairs,
            cfg=dev_cfg(),
            cfg_sha256=CFG_SHA256,
            git_sha=GIT_SHA,
            git_clean=True,
            data_sha256=DATA_SHA,
            command=COMMAND,
            mode="single",
            calibration_targets="all",
            n_boot=20,
            now=GENERATED,
        )

    assert list(tmp_path.iterdir()) == []  # nothing, not even the files that do not read the 2026 rows


def _export_kwargs(oof: OofPredictions, pairs: pl.DataFrame, **overrides: object) -> dict[str, object]:
    decision = Decision(rule="6.4 calibration window", choice="september", evidence={"floor": 0.85}, tie_broken=False)
    return {
        "decisions": (decision,),
        "pairs": pairs,
        "cfg": dev_cfg(),
        "cfg_sha256": CFG_SHA256,
        "git_sha": GIT_SHA,
        "git_clean": True,
        "data_sha256": DATA_SHA,
        "command": COMMAND,
        "mode": "single",
        "calibration_targets": "all",
        "n_boot": 20,
        "now": GENERATED,
        **overrides,
    }


@pytest.mark.slow
def test_two_exports_of_the_same_inputs_at_different_times_have_the_same_parquet_and_hash(
    run: tuple[pl.DataFrame, OofPredictions, OofPredictions], tmp_path: Path
) -> None:
    pairs, oof, _ = run
    first = write_dev_exports(oof, out_dir=tmp_path / "one", **_export_kwargs(oof, pairs))  # type: ignore[arg-type]
    second = write_dev_exports(
        oof,
        out_dir=tmp_path / "two",
        **_export_kwargs(oof, pairs, now=GENERATED + timedelta(hours=5)),  # type: ignore[arg-type]
    )

    name = "oof_samples_abu_dhabi.parquet"
    assert (tmp_path / "one" / name).read_bytes() == (tmp_path / "two" / name).read_bytes()
    assert first[name] == second[name]
    manifests = [
        json.loads((tmp_path / d / "oof_samples_abu_dhabi.manifest.json").read_bytes()) for d in ("one", "two")
    ]
    assert manifests[0]["sha256"] == manifests[1]["sha256"] == first[name]  # the reproducible hash the manifest records
    assert manifests[0]["provenance"]["generated_at"] != manifests[1]["provenance"]["generated_at"]  # JSON keeps it


@pytest.mark.slow
def test_a_failure_while_building_the_last_file_leaves_the_directory_untouched(
    run: tuple[pl.DataFrame, OofPredictions, OofPredictions], tmp_path: Path
) -> None:
    pairs, oof, _ = run
    out = tmp_path / "exports"
    unwritable = {"bad": pl.DataFrame({"x": [timedelta(days=1)]})}  # a type table_payload refuses, found last

    with pytest.raises(TypeError, match="cannot write"):
        write_dev_exports(oof, out_dir=out, tables=unwritable, **_export_kwargs(oof, pairs))  # type: ignore[arg-type]

    assert not out.exists()  # not even created: nothing was written before the failure


@pytest.mark.slow
def test_a_dirty_tree_and_an_allowed_dirty_run_are_recorded(
    run: tuple[pl.DataFrame, OofPredictions, OofPredictions], tmp_path: Path
) -> None:
    pairs, oof, _ = run
    write_dev_exports(
        oof,
        out_dir=tmp_path,
        **_export_kwargs(oof, pairs, git_clean=False, allow_dirty=True, calibration_targets="wbgt"),  # type: ignore[arg-type]
    )

    selection = json.loads((tmp_path / "selection.json").read_bytes())
    manifest = json.loads((tmp_path / "oof_samples_abu_dhabi.manifest.json").read_bytes())
    assert (selection["git_clean"], selection["allow_dirty"], selection["calibration_targets"]) == (False, True, "wbgt")
    assert manifest["git_clean"] is False
    assert "git_clean" not in selection["provenance"]  # Provenance is extra="forbid" and not ours to extend


@pytest.mark.slow
def test_the_preflight_builds_the_export_and_refuses_what_the_export_would_refuse(
    run: tuple[pl.DataFrame, OofPredictions, OofPredictions],
) -> None:
    pairs, oof, _ = run
    tampered = _with_keys(oof, oof.keys.with_columns(pl.col("summer").cast(pl.Int16).replace({2025: 2026})))

    preflight_dev_exports(oof, pairs, dev_cfg())  # builds the sample frame and the skill tables, writes nothing
    with pytest.raises(HoldoutViolationError):
        preflight_dev_exports(tampered, pairs, dev_cfg())
    with pytest.raises(ValueError, match="no joint samples"):
        preflight_dev_exports(dataclasses.replace(oof, samples=None, sample_index=None), pairs, dev_cfg())
