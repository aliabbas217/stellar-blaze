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
3. Only then the gold file is loaded (``load_test_pairs``, whose own checks pin the file to the lock's hash). Before any
   computation ``check_test_coverage`` checks that all six clusters, all eight stations and every requested model have
   2026 rows (a failure names every missing item, exits 1 and writes nothing), and then the frame is scored.
4. Every output is rendered to bytes first (pure: the JSON, the parquet, the manifest, ``run_meta.json``), then
   ``token.recheck`` runs (HEAD unmoved, tree clean), then the earlier outputs are archived (amendment) and the new ones
   are written with exclusive create, ``run_meta.json`` last. The archive and the writes are all or nothing: on any
   exception the files this run created are removed and the archived ones restored, so a failed run never strands
   outputs and never forces an amendment. A second run that raced past the once-only check fails instead of overwriting.

``--amendment ID`` names one of the lock's amendments (``amendment-1``, ``amendment-2``, ... by the order of
``[[amendments]]``; anything else is refused with ``amendment-id-unknown``). It lifts the once-only check; the first
output is
kept as ``<name>.run1.<ext>`` (the next free ``runN``) before the new one is written, and the amendment id is
recorded in ``run_meta.json``, which also holds the SHA-256 of ``backend/uv.lock`` and the versions of ``lightgbm``,
``polars``, ``numpy`` and ``scipy``.

Outputs of the forecast part (``artifacts/eval/2026/``), each JSON with a provenance block (label ``REAL``, the
pre-registration sections 7.1 or 7.4 as anchor, ``git_sha`` the HEAD the gate saw, the model id, the gold hash):
``forecast_skill.json``, ``reliability.json``, ``corrected_series_OMAA.parquet`` (not committed; its
``corrected_series_OMAA.manifest.json`` is) and ``run_meta.json``.

B3 adds ``warnings`` and ``plans`` to ``PART_RUNNERS``.
"""

import hashlib
import json
import shlex
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from importlib.metadata import version
from pathlib import Path
from typing import Final

import structlog
from pydantic import JsonValue

from stellar_blaze.config import Settings
from stellar_blaze.domain.provenance import Provenance, ProvenanceLabel
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.stations import STATIONS
from stellar_blaze.ml import forecast_test
from stellar_blaze.ml.data import load_test_pairs
from stellar_blaze.ml.exporters import PROTOCOL_PATH, SKILL_ANCHOR, github_slug, render_json
from stellar_blaze.ml.forecast_tables import series_manifest, series_parquet_bytes
from stellar_blaze.ml.git import SubprocessGit
from stellar_blaze.ml.protocol_gate import RESULT_FILES, GateRefusedError, GateToken, Part, load_lock, open_gate
from stellar_blaze.ml.regimes import CLUSTERS
from stellar_blaze.ml.serving_path import cold_config, load_released_model, released_training_config

__all__ = [
    "DEV_SKILL_PATH",
    "EXPECTED_CLUSTERS",
    "EXPECTED_STATIONS",
    "GO_PATH",
    "LOCK_PATH",
    "PART_RUNNERS",
    "RESULTS_PATH",
    "SERIES_FILE",
    "SERIES_MANIFEST_FILE",
    "SERIES_STATION",
    "UV_LOCK_PATH",
    "amendment_ids",
    "evaluate_2026_invocation",
    "open_the_gate",
    "read_dev_tercile_edges",
    "resolve_settings",
    "run_forecast",
    "write_bytes_exclusive",
]

_log = structlog.get_logger(__name__)

LOCK_PATH: Final = "backend/training/protocol.lock.toml"
GO_PATH: Final = "backend/training/2026-go.toml"
RESULTS_PATH: Final = "artifacts/eval/2026"
DEV_SKILL_PATH: Final = "artifacts/eval/dev/dev_skill.json"
UV_LOCK_PATH: Final = "backend/uv.lock"
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
_RECORDED_PACKAGES: Final = ("lightgbm", "polars", "numpy", "scipy")
"""Installed versions written to ``run_meta.json`` next to the SHA-256 of ``uv.lock`` (the environment that scored)."""
_RAW_MODELS: Final = frozenset({NwpModel.ECMWF_IFS025.value, NwpModel.GFS_SEAMLESS.value, NwpModel.ECMWF_AIFS025.value})
"""IFS and GFS (the corrector's models) and AIFS (the raw comparison of 7.1)."""
EXPECTED_CLUSTERS: Final[tuple[str, ...]] = CLUSTERS
EXPECTED_STATIONS: Final[tuple[str, ...]] = tuple(station.icao for station in STATIONS)
"""The six clusters and eight stations the 2026 frame must hold before anything is scored (``check_test_coverage``)."""


def evaluate_2026_invocation(part: str, amendment: str | None) -> str:
    """The ``sb-jobs evaluate-2026`` invocation that was run, from its real arguments (shell-quoted)."""
    words = ["sb-jobs", "evaluate-2026", "--part", part]
    if amendment:
        words += ["--amendment", amendment]
    return shlex.join(words)


def amendment_ids(count: int) -> tuple[str, ...]:
    """The ids a re-run may name: ``amendment-1`` ... ``amendment-<count>``, by the order of the lock's amendments."""
    return tuple(f"amendment-{number}" for number in range(1, count + 1))


def _refuse_unknown_amendment(root: Path, amendment: str | None) -> None:
    """``--amendment`` must be one of the lock's amendments (``amendment-N``): a typo must not lift the once-only rule.

    An unreadable lock is left to ``open_gate``, which reports it (``lock-missing`` or ``lock-invalid``).

    Raises:
        stellar_blaze.ml.protocol_gate.GateRefusedError: ``amendment-id-unknown``.
    """
    if not amendment:
        return
    try:
        lock = load_lock(root / LOCK_PATH)
    except (OSError, ValueError):  # a missing, non-TOML or invalid lock: the gate says which
        return
    valid = amendment_ids(len(lock.amendments))
    if amendment not in valid:
        raise GateRefusedError(
            (
                f"amendment-id-unknown: {amendment!r} is not an amendment of {LOCK_PATH}; valid ids, by the order of "
                f"its [[amendments]]: {', '.join(valid) or 'none (the lock has no amendments)'}",
            )
        )


def resolve_settings(settings: Settings, root: Path) -> Settings:
    """``settings`` with ``models_dir`` and ``data_dir`` absolute: the working directory cannot change what is read.

    The defaults (``models``, ``data``) are relative to ``backend/``, where the project is run from; a relative path
    is resolved against ``<root>/backend``, never against the current directory. The model directory must exist: the
    job refuses here, before the gate reads anything.

    Raises:
        ValueError: ``models_dir`` does not exist.
    """
    backend = root / "backend"
    models_dir = settings.models_dir if settings.models_dir.is_absolute() else backend / settings.models_dir
    data_dir = settings.data_dir if settings.data_dir.is_absolute() else backend / settings.data_dir
    if not models_dir.is_dir():
        raise ValueError(
            f"models_dir {models_dir} does not exist (SB_MODELS_DIR={settings.models_dir}; a relative path is read "
            f"against {backend}): nothing was read"
        )
    return settings.model_copy(update={"models_dir": models_dir, "data_dir": data_dir})


def open_the_gate(settings: Settings, root: Path, part: Part, amendment: str | None) -> GateToken:
    """Open the pre-registration gate for ``part`` (the first step of every part; no data is touched).

    Raises:
        stellar_blaze.ml.protocol_gate.GateRefusedError: At least one condition of section 9 fails (``reasons`` has
            every one), or ``amendment`` is not one of the lock's amendments (``amendment-id-unknown``).
    """
    _refuse_unknown_amendment(root, amendment)
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

    def commit(self, files: Mapping[str, bytes]) -> None:
        """Archive the earlier outputs, then write ``files`` (name to bytes) with exclusive create, all or nothing.

        On any exception (an I/O error, a file that appeared meanwhile, an interrupt) exactly what this call created is
        removed, the archived outputs move back and the directories it made are removed, so the output directory is as
        it was before the call; then the exception propagates. The caller has rendered every byte string already: the
        only failures left here are the file system's.
        """
        made = self._missing_directories()
        moved: list[tuple[Path, Path]] = []
        written: list[Path] = []
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            for source, destination in self.keep.items():
                source.rename(destination)
                moved.append((source, destination))
            for name, data in files.items():
                write_bytes_exclusive(self.directory / name, data)
                written.append(self.directory / name)
        except BaseException:
            _roll_back(written, moved, made)
            raise

    def _missing_directories(self) -> list[Path]:
        """The output directory and the ancestors that do not exist yet, deepest first (``commit`` makes them)."""
        missing: list[Path] = []
        for candidate in (self.directory, *self.directory.parents):
            if candidate.exists():
                break
            missing.append(candidate)
        return missing


def _roll_back(written: list[Path], moved: list[tuple[Path, Path]], made: list[Path]) -> None:
    """Undo ``_Plan.commit``: delete what it wrote, move the archived files back, remove the directories it made.

    Every step is attempted even when an earlier one fails (the original exception is the one that propagates); a
    step that fails is logged at error level with its path, because the directory then needs a human.
    """
    for path in reversed(written):
        _attempt("remove", path, partial(path.unlink, missing_ok=True))
    for source, destination in reversed(moved):
        _attempt("restore", source, partial(destination.rename, source))
    for directory in made:
        _attempt("rmdir", directory, directory.rmdir)


def _attempt(action: str, path: Path, step: Callable[[], object]) -> None:
    try:
        step()
    except OSError:
        _log.exception("evaluate_2026.rollback_failed", action=action, path=str(path))


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
    """Write ``data`` with exclusive create (``"xb"``) and return its SHA-256.

    An existing file raises ``FileExistsError`` and is left untouched; a failure after the file was created removes the
    partial file again, so a raise never leaves a file this call made.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as file:
        try:
            file.write(data)
        except BaseException:
            file.close()
            path.unlink(missing_ok=True)
            raise
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
    # Before any computation: a missing cluster, station or model fails now, with everything named, not after the hour.
    forecast_test.check_test_coverage(pairs, clusters=EXPECTED_CLUSTERS, stations=EXPECTED_STATIONS, models=_RAW_MODELS)
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

    # Everything that can fail on its own is rendered first (pure): no file exists until every byte string does.
    command = evaluate_2026_invocation(Part.FORECAST.value, amendment)
    series_provenance = provenance(_DEMO_ANCHOR, "series_frame")
    series_bytes = series_parquet_bytes(result.series, series_provenance)
    manifest = series_manifest(result.series, file=SERIES_FILE, data=series_bytes, command=command, git_sha=token.head)
    rendered: dict[str, bytes] = {
        RESULT_FILES[Part.FORECAST]: render_json(result.skill, provenance(SKILL_ANCHOR, "evaluate_forecast_test")),
        RELIABILITY_FILE: render_json(result.reliability, provenance(SKILL_ANCHOR, "reliability_payload")),
        SERIES_FILE: series_bytes,
        SERIES_MANIFEST_FILE: render_json(manifest, provenance(_DEMO_ANCHOR, "series_manifest")),
    }
    hashes: dict[str, JsonValue] = {name: hashlib.sha256(data).hexdigest() for name, data in rendered.items()}
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
        "uv_lock_sha256": hashlib.sha256((root / UV_LOCK_PATH).read_bytes().replace(b"\r\n", b"\n")).hexdigest(),
        "versions": {package: version(package) for package in _RECORDED_PACKAGES},
        "dev_skill_sha256": hashlib.sha256((root / DEV_SKILL_PATH).read_bytes()).hexdigest(),
        "tercile_edges": [edges[0], edges[1]],
        "amendment": amendment or None,
        "command": command,
        "regime_b_all": forecast_test.B_ALL_NOT_RUN,
        "files": dict(hashes),
    }
    rendered[RUN_META_FILE] = render_json(meta, provenance(_RUN_ANCHOR, "run_forecast"))  # last: it names the others
    hashes[RUN_META_FILE] = hashlib.sha256(rendered[RUN_META_FILE]).hexdigest()

    # The last act before the first byte is written: HEAD unmoved, tree clean. Then nothing slow happens, and the
    # archive and the writes are all or nothing (a failure restores the directory as it was).
    token.recheck(SubprocessGit(root))
    plan.commit(rendered)
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
