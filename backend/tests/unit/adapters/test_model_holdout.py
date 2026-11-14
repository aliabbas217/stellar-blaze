"""A model carries no 2026 information: the fold-statistics files, ``params.json`` and the loader's refusals.

A model's two ``fold_stats`` parquet files are read at serving time by the corrector. They are climatologies keyed by
``doy`` and ``hour_utc`` (and ``station``): no year column. So "no 2026 rows" is guaranteed in parts, each tested here:

* the files ``write_model`` writes have exactly the pinned column sets (no ``valid_time``, ``summer``, ``date`` or
  ``year``), and ``params.json`` lists only training summers (none of ``HELD_OUT_SUMMERS``);
* ``LightGbmCorrector.load`` refuses (``ModelHoldoutError``) a directory whose ``params.json`` lists a held-out summer,
  whose frames carry a time column holding a held-out year, a time column at all, or any other unexpected column. The
  injection tests rewrite the file AND the ``manifest.json`` hash, so ``scan_models`` passes and the refusal is the
  loader's own;
* ``holdout_violations`` is the same guarantee as a scanner over a model directory; ``test_every_shipped_model...``
  runs it on every ``backend/models/*/`` that exists. There is no such directory today (the first model ships after
  the 2026 evaluation), so that test checks zero models until one is added; the liveness tests run the scanner on a
  tmp model, clean and mutated, so it cannot pass by looking at nothing.

Nothing reads the gold file.
"""

import hashlib
import json
import shutil
from datetime import UTC, date, datetime
from pathlib import Path

import polars as pl
import pytest

from stellar_blaze.adapters.compute.lgbm_corrector import LightGbmCorrector, ModelHoldoutError
from stellar_blaze.adapters.config.models import scan_models
from stellar_blaze.domain.weather.replay import HELD_OUT_SUMMERS
from stellar_blaze.ml.artefacts import write_model
from tests.fixtures.forecast.trained import trained_small

pytestmark = pytest.mark.unit

MODELS_DIR = Path(__file__).resolve().parents[3] / "models"
POOLED_COLUMNS = {"hour_utc", "doy", "clim_t", "clim_td", "clim_wbgt"}
STATION_COLUMNS = {"station", "hour_utc", "doy", "sclim_t", "sclim_td", "sclim_wbgt"}
EXPECTED_COLUMNS = {"pooled": POOLED_COLUMNS, "station": STATION_COLUMNS}
TIME_COLUMNS = {"valid_time", "summer", "date", "year"}


def holdout_violations(model_dir: Path) -> list[str]:
    """What in one model directory could carry a held-out year (empty when nothing does); reads no booster."""
    found: list[str] = []
    summers = set(json.loads((model_dir / "params.json").read_bytes())["summers"])
    found += [f"params.json lists the held-out summer {year}" for year in sorted(summers & HELD_OUT_SUMMERS)]
    for name, allowed in EXPECTED_COLUMNS.items():
        columns = set(pl.read_parquet_schema(model_dir / "fold_stats" / f"{name}.parquet"))
        found += [
            f"fold_stats/{name}.parquet has the time column {column}" for column in sorted(columns & TIME_COLUMNS)
        ]
        if columns != allowed:
            found.append(f"fold_stats/{name}.parquet has the columns {sorted(columns)}, not {sorted(allowed)}")
    return found


@pytest.fixture(scope="module")
def written(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """One model written by ``write_model`` from the small synthetic corrector; tests copy it, never edit it."""
    root = tmp_path_factory.mktemp("written")
    lock = root / "uv.lock"
    lock.write_bytes(b"version = 1\n")
    return write_model(
        trained_small()[1],
        models_dir=root / "models",
        created_at=datetime(2026, 11, 14, 9, 30, tzinfo=UTC),
        git_sha="0123456789abcdef0123456789abcdef01234567",
        uv_lock=lock,
        gold_manifest_sha256="ab" * 32,
        cfg_path="backend/training/configs/unit.toml",
        dev_metrics={},
    )


def _copy(written: Path, tmp_path: Path) -> Path:
    target = tmp_path / "models" / written.name
    shutil.copytree(written, target)
    return target


def _rewrite(model_dir: Path, relative: str, data: bytes) -> None:
    """Replace one file and its hash in ``manifest.json``, so that ``scan_models`` still passes."""
    (model_dir / relative).write_bytes(data)
    manifest_path = model_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_bytes())
    entries = [entry for entry in manifest["files"] if entry["path"] == relative]
    assert len(entries) == 1, f"{relative} is not listed in the manifest"
    entries[0]["sha256"] = hashlib.sha256(data).hexdigest()
    manifest_path.write_bytes(json.dumps(manifest, sort_keys=True).encode("ascii"))


def _set_summers(model_dir: Path, summers: list[int]) -> None:
    document = json.loads((model_dir / "params.json").read_bytes())
    document["summers"] = summers
    _rewrite(model_dir, "params.json", json.dumps(document, sort_keys=True).encode("ascii"))


def _add_column(model_dir: Path, name: str, column: str, value: object) -> None:
    path = model_dir / "fold_stats" / f"{name}.parquet"
    frame = pl.read_parquet(path).with_columns(pl.lit(value).alias(column))
    path.unlink()
    frame.write_parquet(path)
    _rewrite(model_dir, f"fold_stats/{name}.parquet", path.read_bytes())


def _load(model_dir: Path) -> LightGbmCorrector:
    """Through ``scan_models`` (hashes must hold), then ``LightGbmCorrector.load``."""
    return LightGbmCorrector.load(scan_models(model_dir.parent).get(model_dir.name))


# === what is written ================================================================================================


def test_the_written_fold_stats_have_exactly_the_pinned_columns(written: Path) -> None:
    for name, allowed in EXPECTED_COLUMNS.items():
        columns = set(pl.read_parquet_schema(written / "fold_stats" / f"{name}.parquet"))
        assert columns == allowed
        assert not columns & TIME_COLUMNS


def test_the_written_params_list_only_training_summers(written: Path) -> None:
    summers = json.loads((written / "params.json").read_bytes())["summers"]
    assert summers == [2024]
    assert not set(summers) & HELD_OUT_SUMMERS
    assert 2026 in HELD_OUT_SUMMERS, "the guarantee below is about 2026; revisit these tests if the set changes"


# === what the loader refuses ========================================================================================


def test_an_untouched_rewrite_passes_scan_and_load(written: Path, tmp_path: Path) -> None:
    """The harness itself: a rewrite that changes nothing of substance loads, so every refusal below is the loader's."""
    model_dir = _copy(written, tmp_path)
    _set_summers(model_dir, [2024])
    assert _load(model_dir).model_id == written.name


@pytest.mark.parametrize("summers", [[2026], [2024, 2026], [2025, 2026, 2024]])
def test_load_refuses_a_params_file_that_lists_a_held_out_summer(
    written: Path, tmp_path: Path, summers: list[int]
) -> None:
    model_dir = _copy(written, tmp_path)
    _set_summers(model_dir, summers)
    with pytest.raises(ModelHoldoutError, match=r"held-out summer\(s\) \[2026\]"):
        _load(model_dir)


@pytest.mark.parametrize("name", ["pooled", "station"])
@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("year", 2026),
        ("summer", 2026),
        ("valid_time", datetime(2026, 7, 1, 6, tzinfo=UTC)),
        ("date", date(2026, 7, 1)),
        ("date", "2026-07-01"),
    ],
)
def test_load_refuses_a_time_column_holding_a_held_out_year(
    written: Path, tmp_path: Path, name: str, column: str, value: object
) -> None:
    model_dir = _copy(written, tmp_path)
    _add_column(model_dir, name, column, value)
    with pytest.raises(ModelHoldoutError, match=rf"column '{column}' holds held-out year\(s\) \[2026\]"):
        _load(model_dir)


@pytest.mark.parametrize("name", ["pooled", "station"])
@pytest.mark.parametrize(
    ("column", "value"),
    [("year", 2024), ("summer", 2025), ("valid_time", datetime(2024, 7, 1, 6, tzinfo=UTC)), ("date", date(2025, 7, 1))],
)
def test_load_refuses_any_time_column_even_of_training_years(
    written: Path, tmp_path: Path, name: str, column: str, value: object
) -> None:
    model_dir = _copy(written, tmp_path)
    _add_column(model_dir, name, column, value)
    with pytest.raises(ModelHoldoutError, match=rf"carries the time column '{column}'"):
        _load(model_dir)


@pytest.mark.parametrize("name", ["pooled", "station"])
def test_load_refuses_an_unexpected_column(written: Path, tmp_path: Path, name: str) -> None:
    model_dir = _copy(written, tmp_path)
    _add_column(model_dir, name, "extra_t", 1.5)
    with pytest.raises(ModelHoldoutError, match=r"unexpected column\(s\) \['extra_t'\]"):
        _load(model_dir)


# === the scanner ====================================================================================================


def test_the_scanner_is_clean_on_a_written_model(written: Path) -> None:
    assert holdout_violations(written) == []


def test_the_scanner_reports_each_kind_of_violation(written: Path, tmp_path: Path) -> None:
    """Liveness: a scanner that returned [] for everything would pass the repository scan below vacuously."""
    model_dir = _copy(written, tmp_path)
    _set_summers(model_dir, [2024, 2026])
    _add_column(model_dir, "pooled", "year", 2026)
    _add_column(model_dir, "station", "extra_t", 1.5)
    found = holdout_violations(model_dir)
    assert "params.json lists the held-out summer 2026" in found
    assert "fold_stats/pooled.parquet has the time column year" in found
    assert any("fold_stats/pooled.parquet has the columns" in item for item in found)
    assert any("fold_stats/station.parquet has the columns" in item for item in found)


def test_every_shipped_model_carries_no_held_out_year() -> None:
    """Every ``backend/models/*/`` that exists (none today: the first model ships after the 2026 evaluation)."""
    directories = sorted(path for path in MODELS_DIR.glob("*/") if path.is_dir() and not path.name.startswith("."))
    assert {path.name: holdout_violations(path) for path in directories} == {path.name: [] for path in directories}
