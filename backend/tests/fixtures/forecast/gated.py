"""What the gated 2026 run's tests share: a released synthetic model, a synthetic "gold" frame and a fake repository.

Nothing here touches the real gold file or any real 2026 data. ``released()`` trains one tiny corrector per process
(the slowest step) on the synthetic development rows of ``dev_run`` and writes it with ``write_model`` into a temporary
models directory, exactly as a release is written; ``GatedWorld`` lays out a repository tree (protocol, lock, go marker,
development skill file) where every check of pre-registration section 9 holds and ``FakeGit`` answers the gate's git
questions. The synthetic "2026" is the third summer of ``make_pairs``, with lead 0 removed as ``load_test_pairs`` does.
"""

import atexit
import hashlib
import json
import shutil
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import cache
from pathlib import Path
from typing import Final

import polars as pl

from stellar_blaze.adapters.config.models import scan_models
from stellar_blaze.domain.config.models import LoadedModel
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.ml.artefacts import write_model
from stellar_blaze.ml.git import GitError, GitReader
from stellar_blaze.ml.protocol_gate import GateToken, Part, open_gate
from stellar_blaze.ml.train import TrainedCorrector, train_corrector
from tests.fixtures.forecast.dev_run import HOURS, STATIONS, WARM, dev_cfg, dev_pairs
from tests.fixtures.forecast.synthetic import make_pairs
from tests.fixtures.forecast.trained import CFG_SHA256

__all__ = [
    "DEV_EDGES",
    "HEAD",
    "FakeGit",
    "GatedWorld",
    "Released",
    "gold_with_lead_zero",
    "released",
    "synthetic_test_pairs",
    "with_aifs",
]

HEAD: Final = "b" * 40
PROTOCOL_COMMIT: Final = "a" * 40
PROTOCOL_PATH: Final = "docs/research/protocol.md"
PROTOCOL_BYTES: Final = b"# Pre-registration\nline two\n"
FREEZE_PATH: Final = "docs/research/freeze.md"
FREEZE_BYTES: Final = b"# Freeze addendum\n"
DEV_EDGES: Final = (27.0, 30.0)
"""The stored development tercile edges of the synthetic world (degrees Celsius)."""
_AIFS: Final = NwpModel.ECMWF_AIFS025.value


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class Released:
    """A released model of the synthetic fixture: where it is, how it was trained and what it saw."""

    models_dir: Path
    model: LoadedModel
    trained: TrainedCorrector
    dev: pl.DataFrame


@cache
def released() -> Released:
    """One tiny ``site``/``joint`` corrector trained on the synthetic 2024-2025 rows and written like a release."""
    root = Path(tempfile.mkdtemp(prefix="sb-released-"))
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    dev = dev_pairs()
    trained = train_corrector(dev, dev_cfg(), cfg_sha256=CFG_SHA256)
    uv_lock = root / "uv.lock"
    uv_lock.write_bytes(b"version = 1\n")
    directory = write_model(
        trained,
        models_dir=root / "models",
        created_at=datetime(2026, 11, 14, 12, 0, tzinfo=UTC),
        git_sha="c" * 40,
        uv_lock=uv_lock,
        gold_manifest_sha256="0" * 64,
        cfg_path="training/configs/unit.toml",
        dev_metrics={"training": {"fit_rows": float(trained.train_rows), "calibration_rows": float(trained.cal_rows)}},
    )
    model = scan_models(root / "models").get(directory.name)
    return Released(root / "models", model, trained, dev)


def gold_with_lead_zero(*, summers: tuple[int, ...] = (2024, 2025, 2026)) -> pl.DataFrame:
    """The synthetic gold file's rows: three summers, the fixture stations, lead 0 included (the WBGT reference)."""
    return make_pairs(
        seed=7,
        summers=summers,
        station_bias_c=dict.fromkeys(WARM, 3.0),
        stations=STATIONS,
        leads=range(4),
        hours_utc=HOURS,
    )


def synthetic_test_pairs() -> pl.DataFrame:
    """What ``load_test_pairs`` returns for the synthetic gold: lead 0 removed, summers 2024-2026."""
    return gold_with_lead_zero().filter(pl.col("lead_days") > 0)


def with_aifs(pairs: pl.DataFrame) -> pl.DataFrame:
    """``pairs`` plus raw AIFS rows for 2025 and 2026: the IFS rows with the temperature 0.5 degrees warmer."""
    aifs = pairs.filter((pl.col("model") == NwpModel.ECMWF_IFS025.value) & (pl.col("summer") >= 2025)).with_columns(
        pl.lit(_AIFS).alias("model"), (pl.col("fc_t_c") + 0.5).alias("fc_t_c")
    )
    return pl.concat([pairs, aifs])


@dataclass
class FakeGit:
    """A ``GitReader`` whose answers are plain attributes (a test moves ``head_id`` or dirties the tree mid-run)."""

    head_id: str = HEAD
    clean: bool = True
    ancestors: set[tuple[str, str]] = field(default_factory=lambda: {(PROTOCOL_COMMIT, HEAD)})
    files: dict[tuple[str, str], bytes] = field(
        default_factory=lambda: {(PROTOCOL_COMMIT, PROTOCOL_PATH): PROTOCOL_BYTES, (HEAD, FREEZE_PATH): FREEZE_BYTES}
    )
    calls: list[str] = field(default_factory=list)

    def head(self) -> str:
        self.calls.append("head")
        return self.head_id

    def is_clean(self) -> bool:
        self.calls.append("is_clean")
        return self.clean

    def is_ancestor(self, ancestor: str, descendant: str) -> bool:
        self.calls.append("is_ancestor")
        return (ancestor, descendant) in self.ancestors

    def show(self, commit: str, path: str) -> bytes:
        self.calls.append("show")
        try:
            return self.files[(commit, path)]
        except KeyError:
            raise GitError(f"{commit}:{path} not found") from None


class GatedWorld:
    """A repository tree where every check of section 9 holds for the released model and a pinned gold hash."""

    def __init__(self, root: Path, model_id: str, models_dir: Path, *, gold_sha256: str = "7" * 64) -> None:
        self.repo_root = root / "repo"
        self.models_dir = models_dir
        self.model_id = model_id
        self.git = FakeGit()
        self.lock_path = self.repo_root / "backend" / "training" / "protocol.lock.toml"
        self.go_path = self.repo_root / "backend" / "training" / "2026-go.toml"
        self.results_dir = self.repo_root / "artifacts" / "eval" / "2026"
        self.dev_skill_path = self.repo_root / "artifacts" / "eval" / "dev" / "dev_skill.json"
        for path in (self.lock_path.parent, self.dev_skill_path.parent, self.repo_root / "docs" / "research"):
            path.mkdir(parents=True, exist_ok=True)
        (self.repo_root / PROTOCOL_PATH).write_bytes(PROTOCOL_BYTES)
        (self.repo_root / FREEZE_PATH).write_bytes(FREEZE_BYTES)
        self.write_lock(gold_sha256)
        self.write_dev_skill(DEV_EDGES)

    def write_lock(self, gold_sha256: str) -> None:
        digest = sha(PROTOCOL_BYTES)
        self.lock_path.write_text(
            f'protocol_path = "{PROTOCOL_PATH}"\nprotocol_sha256 = "{digest}"\nprotocol_commit = "{PROTOCOL_COMMIT}"\n'
            f'gold_sha256 = "{gold_sha256}"\nmodel_id = "{self.model_id}"\n'
            f'freeze_path = "{FREEZE_PATH}"\nfreeze_sha256 = "{sha(FREEZE_BYTES)}"\n',
            encoding="utf-8",
        )
        self.go_path.write_text(
            f'protocol_sha256 = "{digest}"\nmodel_id = "{self.model_id}"\napproved_by = "the architect"\n'
            "approved_at = 2026-11-15T09:30:00+04:00\n",
            encoding="utf-8",
        )

    def write_dev_skill(self, edges: tuple[float, float]) -> None:
        self.dev_skill_path.write_bytes(json.dumps({"tercile_edges": list(edges), "skill": {}}).encode("utf-8"))

    def token(
        self, part: Part = Part.FORECAST, *, amendment: str | None = None, git: GitReader | None = None
    ) -> GateToken:
        return open_gate(
            repo_root=self.repo_root,
            lock_path=self.lock_path,
            part=part,
            results_dir=self.results_dir,
            models_dir=self.models_dir,
            go_path=self.go_path,
            git=self.git if git is None else git,
            amendment=amendment,
        )
