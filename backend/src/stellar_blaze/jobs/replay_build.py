"""Build a replay snapshot: a hashed copy of one summer's silver forecasts and observations, for the replay sources.

``sb-jobs replay build`` is a plain command around ``build_replay_snapshot``. The snapshot holds three files in
``<replay_dir>/<snapshot_id>/``: ``forecasts.parquet`` (``FORECAST_SCHEMA``, models ``ecmwf_ifs025`` and
``gfs_seamless``, leads 0 to 7), ``observations.parquet`` (the IEM hourly truth, ``OBS_HOURLY_SCHEMA``) and
``snapshot.json`` (a ``ReplaySnapshot`` with the SHA-256 of the two data files). It copies inputs: it never writes a
corrected forecast or a score.

A summer in ``REPLAY_LOCKED_SUMMERS`` (defined once in ``domain.weather.replay``) is never built, whatever the
arguments. The set has been empty since the architect's go-ahead of 2026-11-15, so the real 2026 summer can be copied
for the live demo; the guard still runs before anything is read or written, and a second check on the rows about to be
written fails closed if a window computation ever let a locked year through. Re-locking is a deliberate edit of that
one constant, never a flag, an environment variable or a command-line option. The separate ``HELD_OUT_SUMMERS`` is the
model guard (no model may carry 2026) and is not touched by this module. A snapshot is display data: nothing in
``ml/`` may read it, so it never feeds a model, a threshold or a selection.

``ingest-observations --source iem`` is unsupported over the replay source, by design: the port contract needs every
row's ``source`` to equal the source's ``name`` (``"replay"``) while the silver store needs ``"iem"``, and replay mode
never needs observation ingest (the snapshot already holds the truth). ``ingest-forecasts`` and the fetch-and-bin step
work over it.

Everything is serialized in memory first and written as bytes, with LF line endings in the text file.
``Path.write_text`` would write CRLF on Windows while git stores LF, and the hashes in ``snapshot.json`` would not
match a Linux checkout.
The files are written to a staging directory that is renamed into place, so a failure leaves no half-built snapshot,
and the build refuses to overwrite an existing snapshot or to produce one above ``MAX_SNAPSHOT_BYTES``.
"""

import hashlib
import io
import re
import shutil
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

import polars as pl

from stellar_blaze.adapters.storage.parquet_store import ParquetStore
from stellar_blaze.domain.provenance import Provenance, ProvenanceLabel
from stellar_blaze.domain.weather.models import LEADS_DAYS, MODEL_SUMMERS, NwpModel, summer_window
from stellar_blaze.domain.weather.replay import (
    FORECASTS_FILE,
    MANIFEST_FILE,
    OBSERVATIONS_FILE,
    REPLAY_LOCKED_SUMMERS,
    ReplayFile,
    ReplaySnapshot,
    check_snapshot_id,
    files_digest,
)
from stellar_blaze.domain.weather.stations import Station

MAX_SNAPSHOT_BYTES: Final = 10 * 1024 * 1024
"""The budget of one snapshot, all three files together (a module attribute, so a test can lower it)."""

SNAPSHOT_MODELS: Final = (NwpModel.ECMWF_IFS025, NwpModel.GFS_SEAMLESS)
TRUTH_SOURCE: Final = "iem"


PROTOCOL_PATH: Final = "docs/research/2026-11-12-preregistration-2026-evaluation.md"
PROTOCOL_ANCHOR: Final = "#21-data"  # section 2.1, Data: the sources the evaluation reads

_PARQUET_COMPRESSION: Final = "zstd"
_PARQUET_COMPRESSION_LEVEL: Final = 3
_PARQUET_ROW_GROUP_SIZE: Final = 100_000
_COMMIT = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
_GIT_TIMEOUT_S: Final = 30


class ReplayBuildError(Exception):
    """The snapshot was refused or could not be built; the message says why. Nothing is left on disk."""


class ReplayHoldoutError(ValueError):
    """The snapshot would hold data of a locked summer (``REPLAY_LOCKED_SUMMERS``). Nothing is written."""


def refuse_held_out(summer: int) -> None:
    """Raise unless ``summer`` may be built (the name is kept from the time the whole of 2026 was locked).

    Raises:
        ReplayHoldoutError: ``summer`` is in ``REPLAY_LOCKED_SUMMERS``.
    """
    if summer in REPLAY_LOCKED_SUMMERS:
        raise ReplayHoldoutError(
            f"summer {summer} is locked for replay snapshots until the architect's go-ahead "
            "(REPLAY_LOCKED_SUMMERS in stellar_blaze/domain/weather/replay.py)"
        )


def _refuse_held_out_rows(forecasts: pl.DataFrame, truth: pl.DataFrame) -> None:
    """Fail closed if a row about to be written falls in a locked year, whatever the window computation said.

    Raises:
        ReplayHoldoutError: A forecast or observation ``valid_time`` is in a year of ``REPLAY_LOCKED_SUMMERS``.
    """
    for label, frame in (("forecasts", forecasts), ("observations", truth)):
        years = set(frame["valid_time"].dt.year().unique().to_list()) & REPLAY_LOCKED_SUMMERS
        if years:
            raise ReplayHoldoutError(
                f"the {label} to write hold rows of locked year(s) {sorted(years)}; refusing, nothing was written"
            )


@dataclass(frozen=True, slots=True)
class BuiltSnapshot:
    """A snapshot that was written.

    Attributes:
        directory: ``<replay_dir>/<snapshot_id>``.
        snapshot: The manifest as stored in ``snapshot.json``.
        size_bytes: The size of the three files together.
    """

    directory: Path
    snapshot: ReplaySnapshot
    size_bytes: int


def repo_root() -> Path:
    """The root of the checkout this module is installed from (``backend/`` is one level below it)."""
    return Path(__file__).resolve().parents[4]


def git_head(root: Path) -> str:
    """The full commit id of HEAD in ``root`` (``git rev-parse HEAD``), run without a shell.

    Raises:
        ReplayBuildError: ``git`` is not on ``PATH``, it failed (not a repository, say), or it answered with something
            that is not a commit id.
    """
    executable = shutil.which("git")
    if executable is None:
        raise ReplayBuildError(
            "the git executable was not found on PATH; a snapshot records the commit it was built at, so it cannot "
            "be built without git"
        )
    # The executable is the one shutil.which resolved and the arguments are a fixed list, with no shell.
    result = subprocess.run(  # noqa: S603
        [executable, "rev-parse", "HEAD"], check=False, capture_output=True, cwd=root, timeout=_GIT_TIMEOUT_S
    )
    answer = result.stdout.decode("ascii", errors="replace").strip()
    if result.returncode != 0 or not _COMMIT.fullmatch(answer):
        detail = result.stderr.decode("utf-8", errors="replace").strip() or f"answered {answer!r}"
        raise ReplayBuildError(f"git rev-parse HEAD failed in {root}: {detail}")
    return answer


def _parquet_bytes(frame: pl.DataFrame) -> bytes:
    """The frame as Parquet with fixed settings, so equal frames give equal bytes (and so equal hashes).

    The frame is rechunked first: two equal frames laid out differently in memory were measured to give different
    bytes (``ParquetStore._serialize``), and a hash must identify the data.
    """
    buffer = io.BytesIO()
    frame.rechunk().write_parquet(
        buffer,
        compression=_PARQUET_COMPRESSION,
        compression_level=_PARQUET_COMPRESSION_LEVEL,
        statistics=True,
        row_group_size=_PARQUET_ROW_GROUP_SIZE,
    )
    return buffer.getvalue()


def build_replay_snapshot(
    *,
    store: ParquetStore,
    replay_dir: Path,
    summer: int,
    stations: Sequence[Station],
    snapshot_id: str,
    git_sha: str,
    created_at: datetime | None = None,
) -> BuiltSnapshot:
    """Copy the silver forecasts and IEM observations of ``stations`` for the summer into ``replay_dir/snapshot_id``.

    The window is the summer's 15 May 00:00 to 30 Sep 23:00 UTC; the forecasts are those of ``SNAPSHOT_MODELS`` at
    leads 0 to 7. Rows are sorted and the files serialized with fixed settings, so the same silver inputs and
    ``created_at`` give the same bytes.

    Args:
        store: The silver dataset to read (``$SB_DATA_DIR``).
        replay_dir: The directory that holds the snapshots (``backend/replay``); created when absent.
        summer: The year of the summer to copy.
        stations: The stations to copy, at least one; each is listed once.
        snapshot_id: The directory name: a lowercase slug of at most 64 characters.
        git_sha: The commit the build ran at (``git_head``), recorded in the provenance.
        created_at: When it was built; now (UTC) by default.

    Returns:
        The directory written, its manifest and its size.

    Raises:
        ReplayHoldoutError: ``summer`` is in ``REPLAY_LOCKED_SUMMERS`` (raised before anything is read or written), or a
            row to be written falls in a locked year.
        ReplayBuildError: The id is not a safe slug, no station was named, the summer is not one the archive covers,
            the snapshot directory (or a staging directory of it) already exists, a station has no silver
            forecasts for a model or no observations in the window, or the files together exceed
            ``MAX_SNAPSHOT_BYTES``. No snapshot is written in any of these cases.
        SchemaMismatchError: A silver file does not hold its schema (from ``ParquetStore``).
        OSError: The files could not be written.
    """
    refuse_held_out(summer)
    try:
        check_snapshot_id(snapshot_id)
    except ValueError as exc:
        raise ReplayBuildError(f"refusing the snapshot id: {exc}") from exc
    unique = list(dict.fromkeys(station.icao for station in stations))
    if not unique:
        raise ReplayBuildError("name at least one station to copy")
    uncovered = [model.value for model in SNAPSHOT_MODELS if summer not in MODEL_SUMMERS[model]]
    if uncovered:
        raise ReplayBuildError(f"the archive holds no {summer} summer for {', '.join(uncovered)}")
    target = replay_dir / snapshot_id
    staging = replay_dir / f".{snapshot_id}.building"
    for path in (target, staging):
        if path.exists():
            raise ReplayBuildError(
                f"{path} already exists; a snapshot is never overwritten (choose another id"
                + ("" if path == target else ", or remove the staging directory a crashed build left")
                + ")"
            )

    first, last = summer_window(summer)
    forecasts = (
        store.read_forecasts()
        .filter(
            pl.col("station").is_in(unique)
            & pl.col("model").is_in([model.value for model in SNAPSHOT_MODELS])
            & pl.col("valid_time").is_between(first, last)
            & pl.col("lead_days").is_in(list(LEADS_DAYS))
        )
        .sort("model", "station", "valid_time", "lead_days")
    )
    truth = (
        store.read_observations(TRUTH_SOURCE)
        .filter(pl.col("station").is_in(unique) & pl.col("valid_time").is_between(first, last))
        .sort("station", "valid_time")
    )
    _refuse_held_out_rows(forecasts, truth)

    held = {(row[0], row[1]) for row in forecasts.select("station", "model").unique().rows()}
    missing = [
        f"{icao}/{model.value}" for icao in unique for model in SNAPSHOT_MODELS if (icao, model.value) not in held
    ]
    if missing:
        raise ReplayBuildError(
            f"no silver forecasts in the {summer} window for {', '.join(missing)}; ingest them first "
            "(sb-jobs ingest-forecasts)"
        )
    without_truth = [icao for icao in unique if icao not in set(truth["station"].to_list())]
    if without_truth:
        raise ReplayBuildError(
            f"no observations of {TRUTH_SOURCE} in the {summer} window for {', '.join(without_truth)}; ingest them "
            "first (sb-jobs ingest-observations)"
        )

    contents = {FORECASTS_FILE: _parquet_bytes(forecasts), OBSERVATIONS_FILE: _parquet_bytes(truth)}
    files = [ReplayFile(path=name, sha256=hashlib.sha256(content).hexdigest()) for name, content in contents.items()]
    moment = created_at or datetime.now(UTC)
    manifest = ReplaySnapshot(
        snapshot_id=snapshot_id,
        created_at=moment,
        stations=unique,
        models=[model.value for model in SNAPSHOT_MODELS],
        start=first,
        end=last,
        files=files,
        provenance=Provenance(
            protocol_path=PROTOCOL_PATH,
            protocol_anchor=PROTOCOL_ANCHOR,
            script=__name__,
            function=build_replay_snapshot.__name__,
            git_sha=git_sha,
            data_sha256=files_digest(files),
            model_id=None,
            label=ProvenanceLabel.REAL,
            generated_at=moment,
        ),
    )
    # Bytes, never write_text: LF on every platform, so the hashes match what git stores and a Linux checkout reads.
    contents[MANIFEST_FILE] = manifest.model_dump_json(indent=2).encode("utf-8") + b"\n"
    size = sum(len(content) for content in contents.values())
    if size > MAX_SNAPSHOT_BYTES:
        raise ReplayBuildError(
            f"the snapshot is {size} bytes, over the budget of {MAX_SNAPSHOT_BYTES} bytes; name fewer stations "
            "or build several snapshots"
        )

    replay_dir.mkdir(parents=True, exist_ok=True)
    staging.mkdir()  # fails if another build of this id is running: the directory is the lock
    try:
        for name, content in contents.items():
            (staging / name).write_bytes(content)
        staging.rename(target)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return BuiltSnapshot(directory=target, snapshot=manifest, size_bytes=size)
