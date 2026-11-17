"""``write_model`` and ``render_model_card``: the layout, the hashes, the LF bytes, determinism, the size cap, the card.

The model is the small synthetic one of ``tests/fixtures/forecast/trained.py`` (trained once per process). Nothing here
reads the gold file.
"""

import ast
import hashlib
import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Final

import numpy as np
import polars as pl
import pytest

from stellar_blaze.adapters.compute.lgbm_corrector import load_booster, predict_grid
from stellar_blaze.adapters.config.models import ModelIntegrityError, scan_models
from stellar_blaze.domain.config.models import ModelManifest
from stellar_blaze.domain.forecast.conformal import ConformalOffsets
from stellar_blaze.domain.forecast.features import Target
from stellar_blaze.domain.forecast.grid import LEVELS, PAIRS
from stellar_blaze.domain.forecast.schemas import QUANTILE_COLUMNS
from stellar_blaze.ml import artefacts
from stellar_blaze.ml.artefacts import LIMITATIONS, ModelTooLargeError, render_model_card, write_model
from stellar_blaze.ml.train import TrainedCorrector
from tests.fixtures.forecast.trained import CFG_SHA256, trained_small

pytestmark = pytest.mark.unit

CREATED: Final = datetime(2026, 11, 14, 9, 30, tzinfo=UTC)
GIT_SHA: Final = "0123456789abcdef0123456789abcdef01234567"
GOLD_SHA: Final = "ab" * 32
MODEL_ID: Final = f"corrector-20261114-0123456-{CFG_SHA256[:6]}"
METRICS: Final = {"a_known_sites": {"mae_t": 0.81, "crps_t": 0.55}, "b_new_cluster": {"mae_t": 0.97}}
TEXT_SUFFIXES: Final = {".json", ".md"}


def _lock(tmp_path: Path, content: bytes = b"version = 1\n") -> Path:
    path = tmp_path / "uv.lock"
    path.write_bytes(content)
    return path


def _write(tmp_path: Path, name: str = "models", *, trained: TrainedCorrector | None = None, **extra: object) -> Path:
    if trained is None:
        _, trained = trained_small()
    arguments: dict[str, object] = {
        "models_dir": tmp_path / name,
        "created_at": CREATED,
        "git_sha": GIT_SHA,
        "uv_lock": _lock(tmp_path),
        "gold_manifest_sha256": GOLD_SHA,
        "cfg_path": "backend/training/configs/unit.toml",
        "dev_metrics": METRICS,
    }
    arguments.update(extra)
    return write_model(trained, **arguments)  # type: ignore[arg-type]


def _tree(root: Path) -> dict[str, bytes]:
    return {path.relative_to(root).as_posix(): path.read_bytes() for path in sorted(root.rglob("*")) if path.is_file()}


# === the files ======================================================================================================


def test_written_manifest_validates(tmp_path: Path) -> None:
    root = _write(tmp_path)
    assert root.name == MODEL_ID
    manifest = ModelManifest.model_validate_json((root / "manifest.json").read_bytes())
    assert manifest.model_id == MODEL_ID
    # scan_models loads it and verifies every hash
    model = scan_models(tmp_path / "models").get(MODEL_ID)
    assert model.root == root
    assert model.manifest == manifest


def test_manifest_records_provenance_and_lists_every_other_file_once(tmp_path: Path) -> None:
    lock = tmp_path / "crlf.lock"  # CRLF on disk, as an autocrlf checkout would have it
    lock.write_bytes(b"version = 1\r\nrevision = 3\r\n")
    root = _write(tmp_path)
    root_crlf = _write(tmp_path, "models2", uv_lock=lock)
    manifest = ModelManifest.model_validate_json((root / "manifest.json").read_bytes())
    assert manifest.created_at == CREATED
    assert manifest.git_sha == GIT_SHA
    assert manifest.gold_manifest_sha256 == GOLD_SHA
    assert manifest.training_config_path == "backend/training/configs/unit.toml"
    assert manifest.training_config_sha256 == CFG_SHA256
    assert manifest.calibrated_pairs == PAIRS
    assert manifest.metrics == METRICS
    assert manifest.uv_lock_sha256 == hashlib.sha256(b"version = 1\n").hexdigest()
    # the lock is hashed as LF whatever the checkout wrote (R20)
    crlf = ModelManifest.model_validate_json((root_crlf / "manifest.json").read_bytes())
    assert crlf.uv_lock_sha256 == hashlib.sha256(b"version = 1\nrevision = 3\n").hexdigest()
    listed = [file.path for file in manifest.files]
    assert listed == sorted(listed)
    assert "manifest.json" not in listed
    assert set(listed) == set(_tree(root)) - {"manifest.json"}
    for file in manifest.files:
        assert file.sha256 == hashlib.sha256((root / file.path).read_bytes()).hexdigest()


def test_layout_has_19_boosters_per_target_named_by_quantile_column(tmp_path: Path) -> None:
    _, trained = trained_small()
    root = _write(tmp_path)
    for target in ("t", "td", "wind"):
        names = sorted(path.name for path in (root / "boosters" / target).iterdir())
        assert names == sorted(f"{column}.txt.gz" for column in QUANTILE_COLUMNS)
    assert not (root / "boosters" / "wbgt").exists(), "the joint method has no WBGT boosters"
    for name in ("conformal.json", "copula.json", "params.json", "model_card.md", "manifest.json"):
        assert (root / name).is_file()
    assert (root / "fold_stats" / "pooled.parquet").is_file()
    assert (root / "fold_stats" / "station.parquet").is_file()
    # a stored booster is the booster that was trained: same predictions
    first = trained.boosters[Target.T][9]
    x = np.random.default_rng(0).normal(30.0, 5.0, size=(5, first.num_feature()))
    stored = load_booster((root / "boosters" / "t" / "q50.txt.gz").read_bytes())
    np.testing.assert_allclose(np.asarray(stored.predict(x)), np.asarray(first.predict(x)), atol=1e-12)
    assert predict_grid(trained.boosters[Target.T], x).shape == (5, len(LEVELS))


def test_json_artefacts_round_trip(tmp_path: Path) -> None:
    _, trained = trained_small()
    root = _write(tmp_path)
    offsets = ConformalOffsets.model_validate_json((root / "conformal.json").read_bytes())
    assert offsets == trained.offsets
    copula = json.loads((root / "copula.json").read_bytes())
    assert copula["variables"] == ["t", "td", "wind"]
    assert set(copula["corr"]) == set(trained.copulas)
    for key, matrix in trained.copulas.items():
        np.testing.assert_array_equal(np.array(copula["corr"][key]), matrix)
    assert tuple(copula["fallback"]) == trained.copula_fallback
    params = json.loads((root / "params.json").read_bytes())
    assert params["config"]["name"] == "unit"
    assert params["config"]["wbgt_method"] == "joint"
    assert params["config_sha256"] == CFG_SHA256
    assert params["boosted_targets"] == ["t", "td", "wind"]
    assert params["counts"] == {
        "train_rows": trained.train_rows,
        "cal_rows": trained.cal_rows,
        "wbgt_rejected_rows": trained.wbgt_rejected_rows,
    }
    assert params["feature_columns"][0] == "lead_days"


def test_canonical_json_has_sorted_keys_and_fixed_separators(tmp_path: Path) -> None:
    root = _write(tmp_path)
    for name in ("conformal.json", "copula.json", "params.json", "manifest.json"):
        raw = (root / name).read_bytes()
        value = json.loads(raw)
        assert raw == json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode() + b"\n", name


def test_fold_stats_parquet_round_trips(tmp_path: Path) -> None:
    _, trained = trained_small()
    root = _write(tmp_path)
    assert pl.read_parquet(root / "fold_stats" / "pooled.parquet").equals(trained.stats.pooled_climatology)
    assert pl.read_parquet(root / "fold_stats" / "station.parquet").equals(trained.stats.station_climatology)


def test_parquet_bytes_are_deterministic() -> None:
    _, trained = trained_small()
    for frame in (trained.stats.pooled_climatology, trained.stats.station_climatology):
        # the private encoder is pinned directly: it is what makes the manifest hashes reproducible
        assert artefacts._parquet_bytes(frame) == artefacts._parquet_bytes(frame.clone())  # noqa: SLF001
        assert artefacts._parquet_bytes(frame) == artefacts._parquet_bytes(frame)  # noqa: SLF001


# === bytes, determinism and the cap =================================================================================


def test_no_text_file_has_crlf(tmp_path: Path) -> None:
    """Text is written as bytes with LF (R21): ``write_text`` would write CRLF on Windows and break the hashes.

    The binary files (gzip, parquet) can hold the bytes 0D 0A by chance, so only the text files are searched.
    """
    root = _write(tmp_path)
    texts = [path for path in root.rglob("*") if path.is_file() and path.suffix in TEXT_SUFFIXES]
    assert {path.name for path in texts} == {
        "conformal.json",
        "copula.json",
        "params.json",
        "manifest.json",
        "model_card.md",
    }
    for path in texts:
        data = path.read_bytes()
        assert b"\r\n" not in data, path.name
        assert data.endswith(b"\n")
        assert not data.endswith(b"\n\n")
    scan_models(tmp_path / "models")  # and the hashes were computed over the bytes that are on disk


def test_two_writes_with_the_same_inputs_are_byte_identical(tmp_path: Path) -> None:
    first = _write(tmp_path, "one")
    second = _write(tmp_path, "two")
    assert _tree(first) == _tree(second)
    assert first.name == second.name


def test_a_different_creation_time_changes_only_the_manifest_the_card_and_the_id(tmp_path: Path) -> None:
    first = _write(tmp_path, "one")
    later = _write(tmp_path, "two", created_at=CREATED + timedelta(days=1))
    assert first.name != later.name
    one, two = _tree(first), _tree(later)
    assert {path for path in one if one[path] != two[path]} == {"manifest.json", "model_card.md"}


def test_the_id_date_is_the_utc_date_of_created_at(tmp_path: Path) -> None:
    gst = timezone(timedelta(hours=4))
    root = _write(tmp_path, created_at=datetime(2026, 11, 15, 1, 0, tzinfo=gst))  # 2026-11-14 21:00 UTC
    assert root.name == MODEL_ID


def test_refuses_to_overwrite_an_existing_model(tmp_path: Path) -> None:
    root = _write(tmp_path)
    before = _tree(root)
    with pytest.raises(FileExistsError, match="never overwritten"):
        _write(tmp_path)
    assert _tree(root) == before


def test_size_cap_refuses(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(artefacts, "MAX_MODEL_BYTES", 1024)
    with pytest.raises(ValueError, match="cap"):
        _write(tmp_path)
    models = tmp_path / "models"
    assert not models.exists() or list(models.iterdir()) == [], "nothing, not even a partial directory, is left"


def test_size_cap_error_is_actionable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    reference = _tree(_write(tmp_path, "reference"))
    total = sum(len(data) for data in reference.values())
    cap = total // 2
    monkeypatch.setattr(artefacts, "MAX_MODEL_BYTES", cap)
    with pytest.raises(ModelTooLargeError) as caught:
        _write(tmp_path, "capped")
    error = caught.value
    assert isinstance(error, ValueError)
    assert (error.total_bytes, error.cap_bytes) == (total, cap)
    # every file with its true size, largest first
    assert dict(error.files) == {path: len(data) for path, data in reference.items()}
    sizes = [size for _, size in error.files]
    assert sizes == sorted(sizes, reverse=True)
    # per group (each target's boosters, the fold statistics, the small files), largest first, adding up to the total
    assert {name for name, _ in error.by_group} == {
        "boosters/t",
        "boosters/td",
        "boosters/wind",
        "fold_stats",
        "json_and_card",
    }
    assert sum(size for _, size in error.by_group) == total
    group_sizes = [size for _, size in error.by_group]
    assert group_sizes == sorted(group_sizes, reverse=True)
    message = str(error)
    for text in (
        f"{total:,}",
        f"{cap:,}",
        error.files[0][0],
        "fewer trees",
        "num_leaves=7",
        "joint WBGT",
        "MAX_MODEL_BYTES",
    ):
        assert text in message, text
    assert "Nothing was written" in message
    capped = tmp_path / "capped"
    assert not capped.exists() or list(capped.iterdir()) == []


def test_the_size_cap_is_15_mib_and_the_small_model_is_far_below_it(tmp_path: Path) -> None:
    assert artefacts.MAX_MODEL_BYTES == 15 * 1024 * 1024
    total = sum(len(data) for data in _tree(_write(tmp_path)).values())
    assert 0 < total < artefacts.MAX_MODEL_BYTES


def test_a_failed_write_leaves_no_directory_behind(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(self: Path, target: object) -> Path:
        raise OSError("disk says no")

    monkeypatch.setattr(Path, "rename", refuse)
    with pytest.raises(OSError, match="disk says no"):
        _write(tmp_path)
    assert list((tmp_path / "models").iterdir()) == []


def test_scan_models_notices_a_changed_artefact(tmp_path: Path) -> None:
    root = _write(tmp_path)
    scan_models(tmp_path / "models")
    target = root / "conformal.json"
    target.write_bytes(target.read_bytes().replace(b"0", b"1", 1))
    with pytest.raises(ModelIntegrityError, match=r"conformal\.json"):
        scan_models(tmp_path / "models")


def test_bad_arguments_are_refused(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="timezone"):
        _write(tmp_path, created_at=datetime(2026, 11, 14, 9, 30))  # noqa: DTZ001
    with pytest.raises(ValueError, match="sha"):
        _write(tmp_path, git_sha="not-a-sha")
    with pytest.raises(ValueError, match="gold_manifest_sha256"):
        _write(tmp_path, gold_manifest_sha256="zz")
    with pytest.raises(ValueError, match=r"finite|inf|nan"):
        _write(tmp_path, dev_metrics={"a": {"mae_t": float("nan")}})
    assert not (tmp_path / "models").exists() or list((tmp_path / "models").iterdir()) == []


# === the model card =================================================================================================


def _card(tmp_path: Path) -> str:
    return (_write(tmp_path) / "model_card.md").read_text(encoding="utf-8")


def test_model_card_has_limitations(tmp_path: Path) -> None:
    card = _card(tmp_path)
    assert "airport" in card
    assert "derived" in card
    for item in LIMITATIONS:
        assert item in card, item
    assert len(LIMITATIONS) == 8  # the eight bullets of pre-registration 10.4
    assert "not validated for non-airport sites" in card.lower()


def test_model_card_sections_and_facts(tmp_path: Path) -> None:
    _, trained = trained_small()
    card = _card(tmp_path)
    for heading in (
        f"# Model card: {MODEL_ID}",
        "## Data",
        "## Splits and regimes",
        "## Features",
        "## Metrics per regime",
        "## Calibration strata",
        "## Limitations",
        "## Intended use",
        "## Not validated for non-airport sites",
    ):
        assert heading in card, heading
    assert GOLD_SHA in card
    assert "OMAA, OMDB, OMFJ" in card
    assert "2024" in card
    assert "2026-11-14T09:30:00+00:00" in card
    assert f"git {GIT_SHA}" in card
    assert f"Fit rows: {trained.train_rows}; calibration rows: {trained.cal_rows}" in card
    assert f"rows without a usable joint WBGT grid: {trained.wbgt_rejected_rows}" in card
    assert "Lead x hour-block strata (7 leads x 3 blocks = 21 per target)" in card
    # R23, stated plainly: the climatology is in-sample for both sets and reaches the boosters
    assert "fitted on the fit and calibration rows together" in card
    assert "in-sample" in card
    assert "boosters can therefore move" in card
    # the metrics table, sorted
    assert "| a_known_sites | 0.55 | 0.81 |" in card
    assert "| b_new_cluster |  | 0.97 |" in card
    # the strata table: 21 strata per target, the counts of this model
    n_t = list(trained.offsets.n["t"].values())
    assert f"| t | 21 | {min(n_t)} | " in card
    assert "| wbgt | 21 | " in card
    assert "Copula fallbacks (lead-pooled correlation): 1|early, 1|late" in card
    assert "negative offsets" in card


def test_model_card_is_deterministic_and_us_english(tmp_path: Path) -> None:
    _, trained = trained_small()
    root = _write(tmp_path)
    manifest = ModelManifest.model_validate_json((root / "manifest.json").read_bytes())
    first = render_model_card(manifest, {"rule_1": {"num_leaves": 7}}, trained=trained)
    assert first == render_model_card(manifest, {"rule_1": {"num_leaves": 7}}, trained=trained)
    assert '- rule_1: `{"num_leaves": 7}`' in first
    assert first.endswith("\n")
    assert "\r" not in first
    for british in ("normalis", "behaviour", "colour", "centre", "optimis", "licence", "whilst", "modelling"):
        assert british not in first.lower(), british
    # the only date-like text is the manifest's created_at: the card does not read a clock
    assert first.count("2026-11-14T09:30:00+00:00") == 1


def test_model_card_renders_without_a_trained_model_or_metrics(tmp_path: Path) -> None:
    root = _write(tmp_path)
    manifest = ModelManifest.model_validate_json((root / "manifest.json").read_bytes()).model_copy(
        update={"metrics": {}}
    )
    card = render_model_card(manifest, None)
    assert "No development metrics were recorded" in card
    assert "not recorded" in card.lower()
    for item in LIMITATIONS:
        assert item in card


def test_limitations_match_the_preregistration_section_10_4() -> None:
    """The constant is a copy of section 10.4 (R16); this reads only that section, never 10.1-10.3."""
    path = Path(__file__).resolve().parents[4] / "docs" / "research" / "2026-11-12-preregistration-2026-evaluation.md"
    if not path.is_file():
        pytest.skip("the pre-registration is not in this checkout")
    text = path.read_text(encoding="utf-8")
    start = text.index("### 10.4 ")
    section = text[start : text.index("\n---", start)]
    bullets = [line[2:] for line in section.splitlines() if line.startswith("- ")]
    assert tuple(bullets) == LIMITATIONS


# === isolation of the training libraries ============================================================================


def test_artefacts_does_not_import_the_training_libraries() -> None:
    tree = ast.parse(Path(artefacts.__file__).read_text(encoding="utf-8"))
    imported = {
        name.split(".")[0]
        for node in ast.walk(tree)
        for name in (
            [alias.name for alias in node.names]
            if isinstance(node, ast.Import)
            else [node.module or ""]
            if isinstance(node, ast.ImportFrom)
            else []
        )
    }
    assert imported.isdisjoint({"mapie", "sklearn", "scoringrules"}), imported


def test_artefacts_imports_with_the_training_libraries_blocked() -> None:
    code = (
        "import sys\n"
        "for name in ('mapie', 'sklearn', 'scoringrules'):\n"
        "    sys.modules[name] = None\n"
        "import stellar_blaze.ml.artefacts\n"
    )
    result = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, check=False)  # noqa: S603
    assert result.returncode == 0, result.stderr
