"""The model manifest and the registry of model artifacts baked into the image (ADR 0010 sections 1a and 5).

These types are pure data. They live in the domain, not next to the code that scans a directory, because the domain
validates a runtime config against the registry (``validate_runtime_config``) and the application layer holds the
loaded model in the config snapshot; neither may import an adapter. ``stellar_blaze.adapters.config.models`` does the
file reading and the hash verification and builds the registry.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Annotated, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, StringConstraints, field_validator, model_validator

Sha256 = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
# `corrector-<yyyymmdd>-<gitsha7>-<cfg6>`: cfg6 is the first 6 hex characters of the training config's SHA-256, so two
# configs trained at one commit cannot collide (ADR 0010 section 1a).
MODEL_ID = r"^corrector-\d{8}-[0-9a-f]{7}-[0-9a-f]{6}$"


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)


class ManifestFile(_Model):
    """One artifact file of a model: its path inside the model directory and the SHA-256 of its bytes."""

    path: str
    sha256: Sha256

    @field_validator("path")
    @classmethod
    def _path_stays_inside_the_model_directory(cls, value: str) -> str:
        posix = PurePosixPath(value)
        if (
            not value
            or "\\" in value
            or PureWindowsPath(value).drive
            or posix.is_absolute()
            or not posix.parts
            or ".." in posix.parts
        ):
            msg = f"path {value!r} must be a relative path with forward slashes that stays inside the model directory"
            raise ValueError(msg)
        return value


class ModelManifest(_Model):
    """``manifest.json`` of a model directory: provenance, calibration, metrics and the hash of every artifact."""

    model_id: Annotated[str, StringConstraints(pattern=MODEL_ID)]
    created_at: AwareDatetime
    git_sha: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{7,40}$")]
    uv_lock_sha256: Sha256
    gold_manifest_sha256: Sha256
    training_config_path: str
    training_config_sha256: Sha256
    # The symmetric coverage pairs that were calibrated (ADR 0010 section 1, calibration pair); B2 fills it.
    calibrated_pairs: tuple[tuple[float, float], ...]
    metrics: dict[str, dict[str, float]]
    files: tuple[ManifestFile, ...]

    @model_validator(mode="after")
    def _id_names_the_commit_and_the_training_config(self) -> Self:
        _, _, git7, cfg6 = self.model_id.split("-")
        if not self.git_sha.startswith(git7):
            msg = f"model_id says git {git7} but git_sha is {self.git_sha!r}"
            raise ValueError(msg)
        if not self.training_config_sha256.startswith(cfg6):
            msg = f"model_id ends in {cfg6} but training_config_sha256 starts with {self.training_config_sha256[:6]}"
            raise ValueError(msg)
        return self


@dataclass(frozen=True)
class LoadedModel:
    """A manifest and the directory its (hash-verified) artifacts are in. B2's predictor reads ``root``."""

    manifest: ModelManifest
    root: Path


class ModelRegistry:
    """Every model that ships in the image, by id."""

    def __init__(self, models: Sequence[LoadedModel]) -> None:
        """Hold ``models``.

        Raises:
            ValueError: Two models share an id.
        """
        by_id: dict[str, LoadedModel] = {}
        for model in models:
            model_id = model.manifest.model_id
            if model_id in by_id:
                msg = f"duplicate model id {model_id!r}"
                raise ValueError(msg)
            by_id[model_id] = model
        self._by_id = by_id

    def ids(self) -> tuple[str, ...]:
        """Every model id, sorted."""
        return tuple(sorted(self._by_id))

    def get(self, model_id: str) -> LoadedModel:
        """The model with this id.

        Raises:
            KeyError: No such model; the message names the known ids.
        """
        try:
            return self._by_id[model_id]
        except KeyError:
            raise KeyError(f"unknown model {model_id!r}; known: {', '.join(self.ids()) or '(none)'}") from None
