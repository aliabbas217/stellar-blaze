"""The model registry: every model baked into the image, each file hash verified at startup (ADR 0010 1a, 5)."""

import json
import shutil
import tomllib
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from stellar_blaze.adapters.config.models import ModelIntegrityError, scan_models
from stellar_blaze.domain.config.models import LoadedModel, ModelManifest, ModelRegistry

pytestmark = pytest.mark.unit

BACKEND_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_MODELS = BACKEND_ROOT / "tests" / "fixtures" / "models"
FIRST = "corrector-20261111-0000000-000000"
SECOND = "corrector-20261112-0000000-000001"


def manifest_dict(model_id: str = FIRST) -> dict[str, Any]:
    raw: dict[str, Any] = json.loads((FIXTURE_MODELS / model_id / "manifest.json").read_text(encoding="utf-8"))
    return raw


def copy_models(tmp_path: Path) -> Path:
    directory = tmp_path / "models"
    shutil.copytree(FIXTURE_MODELS, directory)
    return directory


def test_both_fixture_models_load_and_are_listed() -> None:
    registry = scan_models(FIXTURE_MODELS)
    assert registry.ids() == (FIRST, SECOND)
    loaded = registry.get(SECOND)
    assert isinstance(loaded, LoadedModel)
    assert loaded.root == FIXTURE_MODELS / SECOND
    assert loaded.manifest.model_id == SECOND
    assert loaded.manifest.calibrated_pairs == ((0.1, 0.9),)
    assert loaded.manifest.created_at.utcoffset() is not None


def test_an_unknown_model_names_the_known_ids() -> None:
    with pytest.raises(KeyError, match=f"nope.*{FIRST}.*{SECOND}"):
        scan_models(FIXTURE_MODELS).get("nope")


def test_an_edited_artifact_fails_integrity(tmp_path: Path) -> None:
    directory = copy_models(tmp_path)
    (directory / FIRST / "dummy.txt").write_bytes(b"tampered\n")
    with pytest.raises(ModelIntegrityError, match=f"{FIRST}.*dummy.txt"):
        scan_models(directory)


def test_a_listed_file_that_is_missing_fails_integrity(tmp_path: Path) -> None:
    directory = copy_models(tmp_path)
    (directory / SECOND / "dummy.txt").unlink()
    with pytest.raises(ModelIntegrityError, match=f"{SECOND}.*dummy.txt"):
        scan_models(directory)


def test_a_directory_that_is_not_its_model_id_fails(tmp_path: Path) -> None:
    directory = copy_models(tmp_path)
    (directory / FIRST).rename(directory / "corrector-20261113-0000000-000002")
    with pytest.raises(ModelIntegrityError, match=f"corrector-20261113-0000000-000002.*{FIRST}"):
        scan_models(directory)


def test_a_model_directory_without_a_manifest_fails(tmp_path: Path) -> None:
    directory = copy_models(tmp_path)
    (directory / FIRST / "manifest.json").unlink()
    with pytest.raises(ModelIntegrityError, match=f"{FIRST}.*manifest.json"):
        scan_models(directory)


def test_a_manifest_that_is_not_valid_fails_with_the_validation_error_naming_the_directory(tmp_path: Path) -> None:
    directory = copy_models(tmp_path)
    raw = manifest_dict(SECOND)
    raw["surprise"] = 1
    (directory / SECOND / "manifest.json").write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ValidationError, match="surprise") as raised:
        scan_models(directory)
    # The exception type is unchanged; a note says which of the model directories it was.
    assert any(SECOND in note and "manifest.json" in note for note in raised.value.__notes__)
    assert not any(FIRST in note for note in raised.value.__notes__)


def test_a_manifest_that_is_not_json_names_the_directory_too(tmp_path: Path) -> None:
    directory = copy_models(tmp_path)
    (directory / FIRST / "manifest.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(ValidationError, match="Invalid JSON") as raised:
        scan_models(directory)
    assert any(FIRST in note for note in raised.value.__notes__)


def test_an_empty_directory_is_an_empty_registry(tmp_path: Path) -> None:
    registry = scan_models(tmp_path)
    assert registry.ids() == ()
    with pytest.raises(KeyError):
        registry.get(FIRST)


def test_the_committed_models_directory_is_loadable() -> None:
    # Every committed model directory verifies (ids, manifest, file hashes) and is listed; loose files (.gitkeep) are
    # skipped. The expectation is derived from the directory listing so a later model needs no edit here, and the
    # released id comes from the protocol lock so a model removed from the repo while the lock names it fails.
    models_dir = BACKEND_ROOT / "models"
    committed = {path.name for path in models_dir.iterdir() if path.is_dir() and not path.name.startswith(".")}
    lock = tomllib.loads((BACKEND_ROOT / "training" / "protocol.lock.toml").read_text(encoding="utf-8"))
    released = lock["model_id"]
    registry = scan_models(models_dir)
    assert set(registry.ids()) == committed
    assert released in registry.ids()


def test_hidden_directories_and_loose_files_are_ignored(tmp_path: Path) -> None:
    directory = copy_models(tmp_path)
    (directory / ".cache").mkdir()
    (directory / "README.txt").write_text("not a model", encoding="utf-8")
    assert scan_models(directory).ids() == (FIRST, SECOND)


def test_a_missing_models_directory_fails_loudly(tmp_path: Path) -> None:
    with pytest.raises(ModelIntegrityError, match="SB_MODELS_DIR"):
        scan_models(tmp_path / "nowhere")


# --- the manifest schema -----------------------------------------------------------------------------------------


def test_the_id_suffix_must_be_the_first_six_hex_of_the_training_config_hash() -> None:
    raw = manifest_dict(FIRST)
    raw["model_id"] = "corrector-20261111-0000000-ffffff"
    with pytest.raises(ValidationError, match="training_config_sha256"):
        ModelManifest.model_validate(raw)


def test_the_id_git_prefix_must_match_the_git_sha() -> None:
    raw = manifest_dict(FIRST)
    raw["git_sha"] = "abcdef0123"
    with pytest.raises(ValidationError, match="git_sha"):
        ModelManifest.model_validate(raw)


@pytest.mark.parametrize(
    "model_id",
    [
        "corrector-20261111-0000000",  # the ADR 0009 form, before the training-config suffix
        "corrector-20261111-0000000-00000",
        "corrector-20261111-0000000-00000g",
        "Corrector-20261111-0000000-000000",
        "corrector-2026111-0000000-000000",
        "../corrector-20261111-0000000-000000",
        "",
    ],
)
def test_model_ids_that_break_the_naming_scheme(model_id: str) -> None:
    raw = manifest_dict(FIRST)
    raw["model_id"] = model_id
    with pytest.raises(ValidationError, match="model_id"):
        ModelManifest.model_validate(raw)


@pytest.mark.parametrize("field", ["uv_lock_sha256", "gold_manifest_sha256", "training_config_sha256"])
@pytest.mark.parametrize("bad", ["", "abc", "G" * 64, "A" * 64, "0" * 63])
def test_hashes_are_64_lowercase_hex_characters(field: str, bad: str) -> None:
    raw = manifest_dict(FIRST)
    raw[field] = bad
    with pytest.raises(ValidationError, match=field):
        ModelManifest.model_validate(raw)


def test_an_artifact_path_may_not_leave_the_model_directory() -> None:
    for bad in ["../outside.txt", "/etc/passwd", "a/../../b", "", "C:\\Windows\\win.ini", "a\\b", "./x/../../y"]:
        raw = manifest_dict(FIRST)
        raw["files"] = [{"path": bad, "sha256": "0" * 64}]
        with pytest.raises(ValidationError, match="path"):
            ModelManifest.model_validate(raw)


def test_a_naive_creation_time_is_rejected() -> None:
    raw = manifest_dict(FIRST)
    raw["created_at"] = "2026-11-11T00:00:00"
    with pytest.raises(ValidationError, match="created_at"):
        ModelManifest.model_validate(raw)


def test_metrics_must_be_finite() -> None:
    raw = manifest_dict(FIRST)
    raw["metrics"] = {"all": {"crps_ratio": float("nan")}}
    with pytest.raises(ValidationError):
        ModelManifest.model_validate(raw)


def test_manifests_are_immutable_and_forbid_unknown_keys() -> None:
    manifest = ModelManifest.model_validate(manifest_dict(FIRST))
    with pytest.raises(ValidationError, match="frozen"):
        manifest.model_id = "x"  # type: ignore[misc]


def test_a_registry_rejects_the_same_id_twice() -> None:
    loaded = scan_models(FIXTURE_MODELS).get(FIRST)
    with pytest.raises(ValueError, match=f"duplicate.*{FIRST}"):
        ModelRegistry([loaded, loaded])
