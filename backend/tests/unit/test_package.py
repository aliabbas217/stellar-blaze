import re
import tomllib
from pathlib import Path

import pytest

import stellar_blaze

SEMVER = re.compile(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?")
REPO_ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.unit
def test_version_is_semver() -> None:
    assert SEMVER.fullmatch(stellar_blaze.__version__)


@pytest.mark.unit
def test_version_matches_commitizen_config() -> None:
    # .cz.toml sits at the repo root, where no pyproject.toml exists for commitizen's "uv" provider to read.
    config = tomllib.loads((REPO_ROOT / ".cz.toml").read_text(encoding="utf-8"))
    assert config["tool"]["commitizen"]["version"] == stellar_blaze.__version__
