"""The gated 2026 evaluation job: ``sb-jobs evaluate-2026`` (pre-registration section 9).

This module is the only code outside ``ml/protocol_gate.py`` and ``ml/data.py`` that calls ``open_gate`` and
``load_test_pairs`` (a static test pins the list), and the only one that calls ``GateToken.recheck``. Every one of them
gets a ``SubprocessGit(...)`` written inline, never a variable or a fake, so no caller can hand the gate a git reader
that lies (tests replace the name ``SubprocessGit`` in this module, which keeps the call sites inline).

Order of a part, the same for every part:

1. ``open_the_gate``: the gate is opened FIRST (lock, protocol hash and commit, clean tree, released model, the
   architect's 2026 go marker, no earlier result). A refusal raises ``GateRefusedError`` listing every reason and no
   data has been touched.
2. Everything cheap that can fail fails now: the model loads and verifies, the stored development tercile edges parse,
   and no output file is in the way (or, with ``--amendment``, the first run can be kept beside the new one).
3. Only then the gold file is loaded (``load_test_pairs``, whose own checks pin the file to the lock's hash) and scored.
4. ``token.recheck`` runs immediately before the first write (HEAD unmoved, tree clean), and the outputs are written
   with exclusive create: a second run that raced past the once-only check fails instead of overwriting.

``--amendment ID`` (a row of the pre-registration's section 13 log) lifts the once-only check; the first output is
kept as ``<name>.run1.<ext>`` (the next free ``runN``) before the new one is written, and the amendment id is
recorded in ``run_meta.json``.

Outputs of the forecast part (``artifacts/eval/2026/``), each JSON with a provenance block (label ``REAL``, the
pre-registration sections 7.1 or 7.4 as anchor, ``git_sha`` the HEAD the gate saw, the model id, the gold hash):
``forecast_skill.json``, ``reliability.json``, ``corrected_series_OMAA.parquet`` (not committed; its
``corrected_series_OMAA.manifest.json`` is) and ``run_meta.json``.

B3 adds ``warnings`` and ``plans`` to ``PART_RUNNERS``.
"""

import hashlib
import json
import shlex
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

import structlog
from pydantic import JsonValue

from stellar_blaze.config import Settings
from stellar_blaze.domain.provenance import Provenance, ProvenanceLabel
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.ml import forecast_test
from stellar_blaze.ml.data import load_test_pairs
from stellar_blaze.ml.exporters import PROTOCOL_PATH, SKILL_ANCHOR, github_slug, write_json
from stellar_blaze.ml.forecast_tables import series_manifest, series_parquet_bytes
from stellar_blaze.ml.git import SubprocessGit
from stellar_blaze.ml.protocol_gate import RESULT_FILES, GateToken, Part, open_gate
from stellar_blaze.ml.serving_path import cold_config, load_released_model, released_training_config

__all__ = [
    "DEV_SKILL_PATH",
    "GO_PATH",
    "LOCK_PATH",
    "PART_RUNNERS",
    "RESULTS_PATH",
    "SERIES_FILE",
    "SERIES_MANIFEST_FILE",
    "SERIES_STATION",
    "evaluate_2026_invocation",
    "open_the_gate",
    "read_dev_tercile_edges",
    "run_forecast",
    "write_bytes_exclusive",
]

_log = structlog.get_logger(__name__)

LOCK_PATH: Final = "backend/training/protocol.lock.toml"
GO_PATH: Final = "backend/training/2026-go.toml"
RESULTS_PATH: Final = "artifacts/eval/2026"
DEV_SKILL_PATH: Final = "artifacts/eval/dev/dev_skill.json"
"""Repository-relative paths of the lock, the architect's go marker, the 2026 results and the dev skill tables."""

SERIES_STATION: Final = "OMAA"
SERIES_FILE: Final = "corrected_series_OMAA.parquet"
SERIES_MANIFEST_FILE: Final = "corrected_series_OMAA.manifest.json"
RELIABILITY_FILE: Final = "reliability.json"
RUN_META_FILE: Final = "run_meta.json"

_FORECAST_FILES: Final = (
    RESULT_FILES[Part.FORECAST],
    RELIABILITY_FILE,
    SERIES_FILE,
    SERIES_MANIFEST_FILE,
    RUN_META_FILE,
)
_DEMO_ANCHOR: Final = "#" + github_slug('7.4 Demo day ("day zoom") selection rule')
_RUN_ANCHOR: Final = "#" + github_slug("9. The gated 2026 run (once)")
_MODULE: Final = "stellar_blaze.ml.forecast_test"
_RAW_MODELS: Final = frozenset({NwpModel.ECMWF_IFS025.value, NwpModel.GFS_SEAMLESS.value, NwpModel.ECMWF_AIFS025.value})
"""IFS and GFS (the corrector's models) and AIFS (the raw comparison of 7.1)."""


def evaluate_2026_invocation(part: str, amendment: str | None) -> str:
    """The ``sb-jobs evaluate-2026`` invocation that was run, from its real arguments (shell-quoted)."""
    words = ["sb-jobs", "evaluate-2026", "--part", part]
    if amendment:
        words += ["--amendment", amendment]
    return shlex.join(words)


def open_the_gate(settings: Settings, root: Path, part: Part, amendment: str | None) -> GateToken:
    """Open the pre-registration gate for ``part`` (the first step of every part; no data is touched).

    Raises:
        stellar_blaze.ml.protocol_gate.GateRefusedError: At least one condition of section 9 fails; ``reasons`` has
            every one.
    """
    return open_gate(
        repo_root=root,
        lock_path=root / LOCK_PATH,
        part=part,
        results_dir=root / RESULTS_PATH,
        models_dir=settings.models_dir,
        go_path=root / GO_PATH,
        git=SubprocessGit(root),
        amendment=amendment,
    )


def read_dev_tercile_edges(path: Path) -> tuple[float, float]:
    """The forecast-WBGT tercile edges of the committed development run (``dev_skill.json``, key ``tercile_edges``).

    Raises:
        ValueError: The file is not JSON, or the key is not two finite ascending numbers.
        OSError: The file cannot be read.
    """
    document = json.loads(path.read_bytes())
    edges = document.get("tercile_edges") if isinstance(document, dict) else None
    if (
        not isinstance(edges, list)
        or len(edges) != 2
        or not all(isinstance(edge, int | float) and not isinstance(edge, bool) for edge in edges)
        or not edges[0] < edges[1]
    ):
        raise ValueError(f"{path} has no 'tercile_edges' of two ascending numbers, found {edges!r}")
    return float(edges[0]), float(edges[1])


# === output files ====================================================================================================


def _run_name(name: str, number: int) -> str:
    """``forecast_skill.json`` -> ``forecast_skill.run1.json`` (the last suffix is kept)."""
    path = Path(name)
    return f"{path.stem}.run{number}{path.suffix}"


@dataclass(frozen=True)
class _Plan:
    """Where each output goes, and which earlier outputs are kept beside the new ones (an amendment run)."""

    directory: Path
    names: tuple[str, ...]
    keep: dict[Path, Path]  # an existing output -> where it moves before the new one is written

    def refuse_a_file_in_the_way(self) -> None:
        for name in self.names:
            target = self.directory / name
            if target.exists() and target not in self.keep:
                raise FileExistsError(f"{target} exists: a result is never overwritten")

    def keep_first_run(self) -> None:
        for source, destination in self.keep.items():
            source.rename(destination)


def _plan(directory: Path, names: tuple[str, ...], *, amendment: str | None) -> _Plan:
    """With an amendment each existing output moves to its next free ``runN``; without one none may exist."""
    keep: dict[Path, Path] = {}
    if amendment:
        for name in names:
            source = directory / name
            if not source.exists():
                continue
            number = 1
            while (directory / _run_name(name, number)).exists():
                number += 1
            keep[source] = directory / _run_name(name, number)
    plan = _Plan(directory, names, keep)
    plan.refuse_a_file_in_the_way()
    return plan


def write_bytes_exclusive(path: Path, data: bytes) -> str:
    """Write ``data`` with exclusive create (``"xb"``) and return its SHA-256; an existing file raises, untouched."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as file:
        file.write(data)
    return hashlib.sha256(data).hexdigest()


# === the forecast part ===============================================================================================


def run_forecast(settings: Settings, token: GateToken, root: Path, *, amendment: str | None) -> dict[str, JsonValue]:
    """Score the forecast row of 2026 and write its outputs (blocking; the module docstring has the order).

    Raises:
        stellar_blaze.ml.protocol_gate.GateRefusedError: HEAD moved or the tree went dirty since the gate opened
            (checked immediately before the first write; nothing is written).
        FileExistsError: An output file is in the way (nothing is written).
        ValueError: The stored tercile edges are unusable, or the gold hash is not pinned.
    """
    lock = token.lock
    gold_sha256, model_id = lock.gold_sha256, lock.model_id
    if gold_sha256 is None or model_id is None:  # the gate refuses both; this keeps the types honest
        raise ValueError("the lock pins no gold file or no model: the gate should have refused")
    directory = root / RESULTS_PATH
    plan = _plan(directory, _FORECAST_FILES, amendment=amendment)
    model = load_released_model(settings.models_dir, model_id)
    cold = cold_config(released_training_config(model)[0])
    edges = read_dev_tercile_edges(root / DEV_SKILL_PATH)

    pairs = load_test_pairs(
        settings.data_dir / "gold" / "pairs.parquet",
        token=token,
        part=Part.FORECAST,
        expected_sha256=gold_sha256,
        models=_RAW_MODELS,
    )
    result = forecast_test.evaluate_forecast_test(
        pairs,
        model=model,
        cold_cfg=cold,
        token=token,
        dev_tercile_edges=edges,
        series_station=SERIES_STATION,
    )
    del pairs

    now = datetime.now(UTC)

    def provenance(anchor: str, function: str) -> Provenance:
        return Provenance(
            protocol_path=PROTOCOL_PATH,
            protocol_anchor=anchor,
            script=_MODULE,
            function=function,
            git_sha=token.head,
            data_sha256=gold_sha256,
            model_id=model_id,
            label=ProvenanceLabel.REAL,
            generated_at=now,
        )

    command = evaluate_2026_invocation(Part.FORECAST.value, amendment)
    series_provenance = provenance(_DEMO_ANCHOR, "series_frame")
    series_bytes = series_parquet_bytes(result.series, series_provenance)
    manifest = series_manifest(result.series, file=SERIES_FILE, data=series_bytes, command=command, git_sha=token.head)
    meta: dict[str, JsonValue] = {
        "part": Part.FORECAST.value,
        "head": token.head,
        "protocol_path": lock.protocol_path,
        "protocol_sha256": lock.protocol_sha256,
        "protocol_commit": lock.protocol_commit,
        "amendments": [{"path": a.path, "sha256": a.sha256, "commit": a.commit} for a in lock.amendments],
        "gold_sha256": gold_sha256,
        "model_id": model_id,
        "go_sha256": hashlib.sha256((root / GO_PATH).read_bytes()).hexdigest(),
        "dev_skill_sha256": hashlib.sha256((root / DEV_SKILL_PATH).read_bytes()).hexdigest(),
        "tercile_edges": [edges[0], edges[1]],
        "amendment": amendment or None,
        "command": command,
        "regime_b_all": forecast_test.B_ALL_NOT_RUN,
    }

    # The last act before the first byte is written: HEAD unmoved, tree clean. Then nothing slow happens.
    token.recheck(SubprocessGit(root))
    plan.keep_first_run()
    hashes: dict[str, JsonValue] = {}
    hashes[RESULT_FILES[Part.FORECAST]] = write_json(
        directory / RESULT_FILES[Part.FORECAST],
        result.skill,
        provenance(SKILL_ANCHOR, "evaluate_forecast_test"),
        exclusive=True,
    )
    hashes[RELIABILITY_FILE] = write_json(
        directory / RELIABILITY_FILE,
        result.reliability,
        provenance(SKILL_ANCHOR, "reliability_payload"),
        exclusive=True,
    )
    hashes[SERIES_FILE] = write_bytes_exclusive(directory / SERIES_FILE, series_bytes)
    hashes[SERIES_MANIFEST_FILE] = write_json(
        directory / SERIES_MANIFEST_FILE, manifest, provenance(_DEMO_ANCHOR, "series_manifest"), exclusive=True
    )
    meta["files"] = dict(hashes)
    hashes[RUN_META_FILE] = write_json(
        directory / RUN_META_FILE, meta, provenance(_RUN_ANCHOR, "run_forecast"), exclusive=True
    )
    _log.info("evaluate_2026.written", part="forecast", directory=str(directory), head=token.head)
    return {
        "part": Part.FORECAST.value,
        "model_id": model_id,
        "head": token.head,
        "directory": str(directory),
        "amendment": amendment or None,
        "series_rows": result.series.height,
        "files": dict(sorted(hashes.items())),
    }


PART_RUNNERS: Final[dict[Part, Callable[..., dict[str, JsonValue]]]] = {Part.FORECAST: run_forecast}
"""The parts that exist (B3 adds ``Part.WARNINGS`` and ``Part.PLANS``); ``--part all`` runs exactly these."""
