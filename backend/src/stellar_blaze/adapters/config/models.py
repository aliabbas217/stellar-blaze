"""Scan the models that ship in the image and verify every artifact hash (ADR 0010 section 5)."""

import hashlib
from pathlib import Path

from stellar_blaze.domain.config.models import LoadedModel, ModelManifest, ModelRegistry

MANIFEST = "manifest.json"


class ModelIntegrityError(Exception):
    """A model directory is not what its manifest says: a missing or changed artifact, or a misnamed directory."""


def _sha256_of(path: Path) -> str:
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def scan_models(models_dir: Path) -> ModelRegistry:
    """Read ``<models_dir>/*/manifest.json`` and verify every listed file against its hash.

    Each model directory must be named by its ``model_id`` and every file its manifest lists must exist and hash to the
    recorded value. Loose files and directories whose name starts with a dot are ignored. A directory with no models
    in it is a valid, empty registry.

    Raises:
        ModelIntegrityError: ``models_dir`` is missing, a model directory has no manifest or is not named by its id, or
            a listed artifact is missing or has a different hash.
        pydantic.ValidationError: A manifest is not valid (including an id that does not match its training config).
    """
    if not models_dir.is_dir():
        raise ModelIntegrityError(f"models directory not found: {models_dir} (SB_MODELS_DIR)")
    models: list[LoadedModel] = []
    for directory in sorted(p for p in models_dir.iterdir() if p.is_dir() and not p.name.startswith(".")):
        manifest_path = directory / MANIFEST
        if not manifest_path.is_file():
            raise ModelIntegrityError(f"model directory {directory.name} has no {MANIFEST}")
        manifest = ModelManifest.model_validate_json(manifest_path.read_bytes())
        if manifest.model_id != directory.name:
            raise ModelIntegrityError(
                f"directory {directory.name} holds the manifest of {manifest.model_id}: "
                "a model directory is named by its id"
            )
        for artifact in manifest.files:
            artifact_path = directory / artifact.path
            if not artifact_path.is_file():
                raise ModelIntegrityError(f"{manifest.model_id}: listed file {artifact.path} is missing")
            actual = _sha256_of(artifact_path)
            if actual != artifact.sha256:
                raise ModelIntegrityError(
                    f"{manifest.model_id}: {artifact.path} has sha256 {actual}, the manifest says {artifact.sha256}"
                )
        models.append(LoadedModel(manifest=manifest, root=directory))
    return ModelRegistry(models)
