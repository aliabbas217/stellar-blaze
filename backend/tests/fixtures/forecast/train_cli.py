"""What the ``sb-jobs train`` tests share (unit and integration): a tiny synthetic gold file, a config and a fake repo.

The gold file is written with ``ParquetStore.write_gold`` so its manifest is the real thing. It holds a 2026 summer on
purpose: the command must never load it. Nothing here touches the real gold file or any real 2026 data.
"""

import hashlib
import json
from functools import cache
from pathlib import Path
from typing import Final

import polars as pl

from stellar_blaze.adapters.storage.parquet_store import ParquetStore
from stellar_blaze.domain.weather.dataset import DatasetSummary
from tests.fixtures.forecast.dev_run import HOURS, STATIONS, WARM
from tests.fixtures.forecast.synthetic import make_pairs

CONFIG_NAME: Final = "unit-train"
GIT_SHA: Final = "c" * 40
CONFIG_TOML: Final = f"""\
name = "{CONFIG_NAME}"
feature_set = "site"
levels = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
leads = [1, 2, 3]
hours_utc = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
calibration_window = "september"
wbgt_method = "joint"
n_joint_samples = 20
sample_seed = 20261112

[lgbm]
num_leaves = 7
min_child_samples = 20
n_estimators = 20
learning_rate = 0.3
seed = 20261112
num_threads = 2
deterministic = true
"""


@cache
def _gold_frame() -> pl.DataFrame:
    """Three summers (2026 included) of the fixture stations, lead 0 included, as a gold file holds them."""
    return make_pairs(
        seed=7,
        summers=(2024, 2025, 2026),
        station_bias_c=dict.fromkeys(WARM, 3.0),
        stations=STATIONS,
        leads=range(4),
        hours_utc=HOURS,
    )


def write_gold(data_dir: Path) -> str:
    """Write the synthetic gold file and its manifest under ``data_dir``; returns the SHA-256 of the pairs file."""
    manifest = ParquetStore(data_dir).write_gold(
        _gold_frame().clone(),
        summary=DatasetSummary(pair_counts=[], raw_errors=[], wbgt_rejects={}),
        code_version="test",
        inputs=[],
    )
    return manifest.output.sha256


def fake_repo(root: Path) -> Path:
    """``root/repo/backend/uv.lock`` (LF and CRLF read alike); returns the repo root."""
    repo = root / "repo"
    (repo / "backend").mkdir(parents=True)
    (repo / "backend" / "uv.lock").write_bytes(b"version = 1\n")
    return repo


def manifest_sha256(data_dir: Path) -> str:
    """SHA-256 of the gold ``manifest.json`` with CRLF read as LF (what the model manifest records)."""
    data = (data_dir / "gold" / "manifest.json").read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def dev_skill_payload(
    *, configuration: dict[str, object] | None = None, data_sha256: str | None = None
) -> dict[str, object]:
    """A ``dev_skill.json`` skill table holding what ``loco_headline_metrics`` reads, for t only, with known numbers.

    With ``configuration`` and ``data_sha256`` it also holds the two things a ``--release`` is bound to: the final
    config's JSON and the provenance's data hash.
    """
    columns = ["target", "lead_days", "hour_block", "n_rows", "crps_corrector", "crps_b0", "crps_b2d"]
    rows: list[list[object]] = [
        ["t", 1, "working", 100, 0.5, 2.0, 1.0],
        ["t", 2, "working", 300, 0.6, 2.2, 1.1],
        ["t", 3, "working", 600, 0.7, 2.4, 1.2],
        ["t", 3, "peak", 50, 9.0, 9.0, 9.0],  # another hour block: never read
        ["td", 1, "working", 100, 0.5, 2.0, None],  # a missing B2d number: td is left out
        ["td", 2, "working", 100, 0.5, 2.0, 1.0],
        ["td", 3, "working", 100, 0.5, 2.0, 1.0],
    ]
    payload: dict[str, object] = {"skill": {"columns": columns, "rows": rows}}
    if configuration is not None:
        payload["configuration"] = configuration
    if data_sha256 is not None:
        payload["provenance"] = {"data_sha256": data_sha256}
    return payload


def config_fields(toml: str = CONFIG_TOML) -> dict[str, object]:
    """The JSON fields of a training config TOML (what an evaluation records as its ``configuration``)."""
    import tomllib

    from stellar_blaze.ml.training_config import TrainingConfig

    return dict(json.loads(TrainingConfig.model_validate(tomllib.loads(toml)).model_dump_json()))
