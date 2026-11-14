"""The canonical JSON writer, the abu_dhabi out-of-fold sample export and the dev exports (Task 12).

The JSON writer is tested on its bytes. The exports run on the small synthetic dev run (``tests/fixtures/forecast/
dev_run.py``): its out-of-fold predictions are computed once for the module.
"""

import dataclasses
import hashlib
import json
from datetime import UTC, datetime
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


def test_oof_samples_frame_needs_the_samples_and_rows(run: tuple[pl.DataFrame, OofPredictions, OofPredictions]) -> None:
    pairs, oof, _ = run

    with pytest.raises(ValueError, match="no joint samples"):
        oof_samples_frame(dataclasses.replace(oof, samples=None, sample_index=None), pairs)
    with pytest.raises(ValueError, match="no row"):
        oof_samples_frame(oof, pairs, cluster="fujairah", lead=7)


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
    metadata_pq = pq.ParquetFile(tmp_path / "a.parquet").metadata
    codecs = {metadata_pq.row_group(0).column(i).compression for i in range(metadata_pq.num_columns)}
    assert codecs == {"ZSTD"}


# === dev_skill.json and the whole export ============================================================================


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
        data_sha256=DATA_SHA,
        command=COMMAND,
        mode="single",
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
    assert selection["chosen_configuration"]["config_sha256"] == CFG_SHA256
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
            data_sha256=DATA_SHA,
            command=COMMAND,
            mode="single",
            n_boot=20,
            now=GENERATED,
        )

    assert list(tmp_path.iterdir()) == []  # nothing, not even the files that do not read the 2026 rows
