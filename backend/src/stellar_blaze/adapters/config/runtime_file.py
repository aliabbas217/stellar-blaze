"""Read the runtime config seed from a TOML file (ADR 0010: the git default)."""

import tomllib
from pathlib import Path

from stellar_blaze.domain.config.runtime import RuntimeConfig


def load_runtime_config_file(path: Path) -> RuntimeConfig:
    """Parse and validate the TOML file at ``path``.

    Raises:
        FileNotFoundError: ``path`` does not exist.
        tomllib.TOMLDecodeError: The file is not TOML.
        pydantic.ValidationError: The content is not a ``RuntimeConfig`` (unknown keys, including any attempt to set a
            legal floor, are rejected).
    """
    with path.open("rb") as file:
        return RuntimeConfig.model_validate(tomllib.load(file))
