"""The on-disk dataset: silver Parquet files per source and station-summer, and the gold pair dataset with its manifest.

Layout under the data directory (``Settings.data_dir``)::

    silver/observations/<source>/<summer>/<ICAO>.parquet       hourly observations (OBS_HOURLY_SCHEMA)
    silver/observations/<source>/<summer>/<ICAO>.binning.json  what binning discarded for that file (ObservationQc)
    silver/forecasts/<model>/<summer>/<ICAO>.parquet           forecasts (FORECAST_SCHEMA)
    gold/pairs.parquet                                         the pair dataset (GOLD_PAIRS_SCHEMA)
    gold/manifest.json                                         GoldManifest: inputs, output, summary

Every file is written to a temporary file in its own directory, flushed to disk and then renamed over the final name,
so a reader (or a crash, or a full disk) sees the old file or the new one and a failed write leaves neither a partial
file nor a temporary one. Parquet is compressed with zstd. Reads check the schema of every file, so a stale or foreign
file fails loudly instead of being concatenated into a dataset.
"""

import hashlib
import os
import re
import tempfile
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO, Final

import polars as pl

from stellar_blaze.domain.weather.dataset import DatasetSummary, GoldManifest, ManifestFile, ObservationQc
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import (
    FORECAST_SCHEMA,
    GOLD_PAIRS_SCHEMA,
    OBS_HOURLY_SCHEMA,
    SchemaMismatchError,
    conform,
)

_COMPRESSION: Final = "zstd"
_NAME = re.compile(r"[A-Za-z0-9_]+")
_BINNING_SUFFIX: Final = ".binning.json"


class MissingBinningReportError(FileNotFoundError):
    """A silver observation file has no ``.binning.json`` next to it (an interrupted ingest, or one from older code)."""


def _name(kind: str, value: str) -> str:
    """``value`` if it is safe as one path component.

    Raises:
        ValueError: ``value`` is empty or holds anything but letters, digits and underscores.
    """
    if not _NAME.fullmatch(value):
        raise ValueError(f"{kind} must be a plain identifier (letters, digits, underscore) to be a path, got {value!r}")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _stage(path: Path, write: Callable[[BinaryIO], None]) -> Path:
    """Write the content ``write`` produces to a temporary file next to ``path``; return the temporary file.

    The file is flushed to disk before it is returned, and removed again if writing fails.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            write(handle)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return temporary


def _commit(temporary: Path, path: Path) -> None:
    """Rename the staged file over ``path`` (the commit point); on failure the staged file is removed."""
    try:
        temporary.replace(path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def _text(content: str) -> Callable[[BinaryIO], None]:
    """A ``write`` for ``_stage`` that stores ``content`` (UTF-8, ending in a newline)."""

    def write(handle: BinaryIO) -> None:
        handle.write(content.encode() + b"\n")

    return write


def _write_atomic(path: Path, write: Callable[[BinaryIO], None]) -> Path:
    _commit(_stage(path, write), path)
    return path


def _serialize(frame: pl.DataFrame) -> Callable[[BinaryIO], None]:
    """A ``write`` for ``_stage`` that stores ``frame`` as zstd Parquet.

    The frame is rechunked first: two equal frames of 480,000 rows, one with the solved WBGT joined back and one
    assembled row by row, were measured to give different bytes, and a manifest hash must identify the data, not how
    the frame happened to be laid out in memory.
    """

    def write(handle: BinaryIO) -> None:
        frame.rechunk().write_parquet(handle, compression=_COMPRESSION)

    return write


def _write_parquet(path: Path, frame: pl.DataFrame) -> Path:
    return _write_atomic(path, _serialize(frame))


def _read_parquet(path: Path, schema: Mapping[str, pl.DataType]) -> pl.DataFrame:
    """The file as a frame in ``schema``'s columns.

    Raises:
        SchemaMismatchError: The file's columns or dtypes differ from the schema; the message names the file.
    """
    try:
        # Not memory-mapped: a frame that still points into the file would block the rename of its replacement on
        # Windows, where a file that is open cannot be replaced.
        return conform(pl.read_parquet(path, memory_map=False, glob=False), schema)
    except SchemaMismatchError as exc:
        raise SchemaMismatchError(f"{path}: {exc}") from exc


def _require_only(frame: pl.DataFrame, column: str, value: str, *, label: str) -> None:
    stray = frame.filter(pl.col(column).ne_missing(value))[column].unique().to_list()
    if stray:
        raise ValueError(f"{label}: column {column!r} must be {value!r} on every row, found {stray}")


class ParquetStore:
    """The silver and gold files under ``root``."""

    def __init__(self, root: Path) -> None:
        self._root = root

    # --- silver: observations -----------------------------------------------------------------------------------

    def _observation_dir(self, source: str, summer: int | None = None) -> Path:
        base = self._root / "silver" / "observations" / _name("source", source)
        return base if summer is None else base / str(summer)

    def write_observations(self, source: str, summer: int, icao: str, df: pl.DataFrame) -> Path:
        """Store a station-summer of hourly observations of ``source`` and return the file.

        Raises:
            SchemaMismatchError: ``df`` is not ``OBS_HOURLY_SCHEMA``.
            ValueError: ``df`` holds rows of another station or source than the ones named, or a name is not a plain
                identifier.
            OSError: The file could not be written; the previous file, if any, is untouched.
        """
        path = self._observation_dir(source, summer) / f"{_name('station', icao)}.parquet"
        frame = conform(df, OBS_HOURLY_SCHEMA)
        label = f"observations of {source}/{summer}/{icao}"
        _require_only(frame, "station", icao, label=label)
        _require_only(frame, "source", source, label=label)
        return _write_parquet(path, frame)

    def read_observations(self, source: str) -> pl.DataFrame:
        """Every stored station-summer of ``source``, in path order; empty (with the schema) when there is none.

        Raises:
            SchemaMismatchError: A file does not hold ``OBS_HOURLY_SCHEMA``; the message names the file.
        """
        files = sorted(self._observation_dir(source).glob("*/*.parquet"))
        frames = [_read_parquet(path, OBS_HOURLY_SCHEMA) for path in files]
        return pl.concat(frames) if frames else pl.DataFrame(schema=OBS_HOURLY_SCHEMA)

    def write_binning_report(self, report: ObservationQc) -> Path:
        """Store what binning discarded for a station-summer, next to its observations; return the file.

        The report names its own source, station and summer, which give the path.
        """
        path = self._observation_dir(report.source, report.summer) / (
            _name("station", report.station) + _BINNING_SUFFIX
        )
        return _write_atomic(path, _text(report.model_dump_json(indent=2)))

    def read_binning_reports(self, source: str) -> list[ObservationQc]:
        """The binning report of every stored station-summer of ``source``, in path order.

        Raises:
            MissingBinningReportError: A silver observation file has no report: its exclusions would go unrecorded.
        """
        directory = self._observation_dir(source)
        missing = [
            path.relative_to(self._root / "silver" / "observations").with_suffix("").as_posix()
            for path in sorted(directory.glob("*/*.parquet"))
            if not path.with_suffix("").with_suffix(_BINNING_SUFFIX).is_file()
        ]
        if missing:
            raise MissingBinningReportError(
                f"no {_BINNING_SUFFIX} next to the silver observations of {', '.join(missing)}; "
                "ingest them again so their exclusions are recorded"
            )
        return [
            ObservationQc.model_validate_json(path.read_bytes())
            for path in sorted(directory.glob(f"*/*{_BINNING_SUFFIX}"))
        ]

    # --- silver: forecasts --------------------------------------------------------------------------------------

    def write_forecasts(self, model: NwpModel, summer: int, icao: str, df: pl.DataFrame) -> Path:
        """Store a station-summer of one model's forecasts and return the file.

        Raises:
            SchemaMismatchError: ``df`` is not ``FORECAST_SCHEMA``.
            ValueError: ``df`` holds rows of another station or model than the ones named.
            OSError: The file could not be written; the previous file, if any, is untouched.
        """
        path = self._root / "silver" / "forecasts" / model.value / str(summer) / f"{_name('station', icao)}.parquet"
        frame = conform(df, FORECAST_SCHEMA)
        label = f"forecasts of {model.value}/{summer}/{icao}"
        _require_only(frame, "station", icao, label=label)
        _require_only(frame, "model", model.value, label=label)
        return _write_parquet(path, frame)

    def read_forecasts(self) -> pl.DataFrame:
        """Every stored forecast file of every model, in path order; empty (with the schema) when there is none.

        Raises:
            SchemaMismatchError: A file does not hold ``FORECAST_SCHEMA``; the message names the file.
        """
        files = sorted((self._root / "silver" / "forecasts").glob("*/*/*.parquet"))
        frames = [_read_parquet(path, FORECAST_SCHEMA) for path in files]
        return pl.concat(frames) if frames else pl.DataFrame(schema=FORECAST_SCHEMA)

    # --- silver: provenance -------------------------------------------------------------------------------------

    def silver_inputs(self) -> list[ManifestFile]:
        """Path, SHA-256 and row count of every silver Parquet file, in path order.

        Two calls differ when a file was added, replaced or removed in between, which is how a build notices that its
        inputs changed while it ran.
        """
        files = sorted((self._root / "silver").glob("**/*.parquet"))
        return [self._describe(path) for path in files]

    def _describe(self, path: Path) -> ManifestFile:
        rows = pl.scan_parquet(path, glob=False).select(pl.len()).collect().item()
        return ManifestFile(path=path.relative_to(self._root).as_posix(), sha256=_sha256(path), rows=rows)

    # --- gold ---------------------------------------------------------------------------------------------------

    def write_gold(
        self,
        pairs: pl.DataFrame,
        *,
        summary: DatasetSummary,
        code_version: str,
        inputs: Sequence[ManifestFile],
        created_at: datetime | None = None,
    ) -> GoldManifest:
        """Store the pair dataset and its manifest, and return the manifest.

        The manifest records ``inputs`` (``silver_inputs()`` as the caller read them), the SHA-256 and row count of the
        file written here, the ``summary`` and ``code_version``. It is built here, from the staged bytes, because the
        output's hash exists only once the dataset is serialized. Both files are staged first and renamed one after the
        other, so the only window in which they disagree is between two renames; ``output.sha256`` lets a reader
        detect even that. A failure leaves the previous dataset and manifest in place.

        Raises:
            SchemaMismatchError: ``pairs`` is not ``GOLD_PAIRS_SCHEMA``.
            OSError: A file could not be written.
        """
        frame = conform(pairs, GOLD_PAIRS_SCHEMA)
        pairs_path = self._root / "gold" / "pairs.parquet"
        manifest_path = self._root / "gold" / "manifest.json"
        staged_pairs = _stage(pairs_path, _serialize(frame))
        try:
            manifest = GoldManifest(
                created_at=created_at or datetime.now(UTC),
                code_version=code_version,
                inputs=list(inputs),
                output=ManifestFile(
                    path=pairs_path.relative_to(self._root).as_posix(), sha256=_sha256(staged_pairs), rows=frame.height
                ),
                summary=summary,
            )
            staged_manifest = _stage(manifest_path, _text(manifest.model_dump_json(indent=2)))
        except BaseException:
            staged_pairs.unlink(missing_ok=True)
            raise
        try:
            _commit(staged_pairs, pairs_path)
        except BaseException:
            staged_manifest.unlink(missing_ok=True)
            raise
        _commit(staged_manifest, manifest_path)
        return manifest
