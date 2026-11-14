"""Forecasts and observations replayed from a hashed snapshot directory instead of fetched from the upstream services.

A snapshot (``domain.weather.replay``) is a frozen copy of one summer's silver forecasts and hourly observations. Both
sources check every data file against the SHA-256 in ``snapshot.json`` when they are built, so a file that was edited,
truncated or replaced is refused before any number is served, and they read the bytes they hashed (not the file a
second time), so the data cannot change between the check and the use. They also refuse a snapshot with a row in a
held-out year (``HELD_OUT_SUMMERS``) or outside the window its manifest declares, hashes or not.

``ReplayForecastSource`` follows the ``WeatherForecastSource`` port as the Open-Meteo adapter does: the same lead rule,
one row per valid hour and requested lead (a value the snapshot holds as null stays null), and UTC dates. It answers
what the snapshot does not hold (another station, model or date) with an empty frame, as the in-memory fake does.

``ReplayObservationSource`` serves the stored hourly truth as raw reports. The snapshot keeps what the ingest stored
(``OBS_HOURLY_SCHEMA``, one binned value per hour), because the raw METAR reports are not kept in silver; each hour is
served as one report exactly on the hour, with no quality codes, so the job path's binning gives the stored hour back
unchanged. ``name`` is ``"replay"`` and so is every row's ``source``, as the port requires.
"""

import hashlib
import io
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

import polars as pl
from pydantic import ValidationError

from stellar_blaze.domain.weather.models import LEADS_DAYS, NwpModel
from stellar_blaze.domain.weather.replay import (
    FORECASTS_FILE,
    HELD_OUT_SUMMERS,
    MANIFEST_FILE,
    OBSERVATIONS_FILE,
    REQUIRED_FILES,
    ReplaySnapshot,
)
from stellar_blaze.domain.weather.schemas import (
    FORECAST_SCHEMA,
    OBS_HOURLY_SCHEMA,
    OBS_RAW_SCHEMA,
    SchemaMismatchError,
    conform,
)
from stellar_blaze.domain.weather.stations import Station
from stellar_blaze.ports.weather import SourceUnavailableError

SOURCE_NAME = "replay"


class ReplaySnapshotError(SourceUnavailableError):
    """A snapshot directory cannot be trusted or read: a missing or malformed file, or a hash that does not match."""


def _read_verified(snapshot_dir: Path) -> tuple[ReplaySnapshot, dict[str, bytes]]:
    """The manifest and the bytes of every data file, each checked against its SHA-256.

    Raises:
        ReplaySnapshotError: The manifest is missing or invalid, the directory is not named after the snapshot, a data
            file is missing, or a file's SHA-256 differs from the manifest's.
    """
    manifest_path = snapshot_dir / MANIFEST_FILE
    try:
        raw = manifest_path.read_bytes()
    except FileNotFoundError:
        raise ReplaySnapshotError(f"{manifest_path}: the manifest is missing") from None
    try:
        snapshot = ReplaySnapshot.model_validate_json(raw)
    except ValidationError as exc:
        raise ReplaySnapshotError(f"{manifest_path}: not a valid {MANIFEST_FILE}: {exc}") from exc
    if snapshot_dir.name != snapshot.snapshot_id:
        raise ReplaySnapshotError(
            f"{snapshot_dir}: the directory is named {snapshot_dir.name!r} but the manifest says it is snapshot "
            f"{snapshot.snapshot_id!r}"
        )
    contents: dict[str, bytes] = {}
    for file in snapshot.files:
        path = snapshot_dir / file.path
        try:
            content = path.read_bytes()
        except FileNotFoundError:
            raise ReplaySnapshotError(f"{path}: the data file is missing") from None
        actual = hashlib.sha256(content).hexdigest()
        if actual != file.sha256:
            raise ReplaySnapshotError(
                f"{path}: sha256 {actual} does not match the manifest's {file.sha256}; the file was changed after "
                "the snapshot was built"
            )
        contents[file.path] = content
    if sorted(contents) != sorted(REQUIRED_FILES):  # the manifest validator already insists; a second look is cheap
        raise ReplaySnapshotError(f"{snapshot_dir}: the manifest does not list {', '.join(REQUIRED_FILES)}")
    return snapshot, contents


def _frame(path: Path, content: bytes, schema: pl.Schema) -> pl.DataFrame:
    try:
        return conform(pl.read_parquet(io.BytesIO(content)), schema)
    except (SchemaMismatchError, pl.exceptions.PolarsError) as exc:
        raise ReplaySnapshotError(f"{path}: not the expected Parquet frame: {exc}") from exc


def _check_rows(snapshot: ReplaySnapshot, path: Path, frame: pl.DataFrame, column: str) -> None:
    """Refuse a frame with a row in a held-out year or outside the manifest's ``[start, end]``.

    The hashes only say the files are what the builder wrote; this says what they hold is allowed to be served. It runs
    on the frame already decoded from the verified bytes.

    Raises:
        ReplaySnapshotError: A ``column`` value is in a year of ``HELD_OUT_SUMMERS`` (the message says so), or outside
            the window the manifest declares.
    """
    held_out = sorted(set(frame[column].dt.year().unique().to_list()) & HELD_OUT_SUMMERS)
    if held_out:
        raise ReplaySnapshotError(f"{path}: holds rows of held-out year(s) {held_out}; a replay never serves them")
    outside = frame.filter((pl.col(column) < snapshot.start) | (pl.col(column) > snapshot.end))
    if outside.height:
        raise ReplaySnapshotError(
            f"{path}: {outside.height} rows have {column} outside the manifest's window "
            f"{snapshot.start.isoformat()} to {snapshot.end.isoformat()}, for example {outside[column][0]}"
        )


def _load(snapshot_dir: Path) -> tuple[ReplaySnapshot, pl.DataFrame, pl.DataFrame]:
    """The verified manifest and both decoded frames (forecasts, hourly observations), rows checked.

    Both sources load both files: a snapshot is one unit, so a bad row in either file stops either source.

    Raises:
        ReplaySnapshotError: As ``_read_verified``, ``_frame`` and ``_check_rows``.
    """
    snapshot, contents = _read_verified(snapshot_dir)
    forecasts_path, observations_path = snapshot_dir / FORECASTS_FILE, snapshot_dir / OBSERVATIONS_FILE
    forecasts = _frame(forecasts_path, contents[FORECASTS_FILE], FORECAST_SCHEMA)
    hourly = _frame(observations_path, contents[OBSERVATIONS_FILE], OBS_HOURLY_SCHEMA)
    _check_rows(snapshot, forecasts_path, forecasts, "valid_time")
    _check_rows(snapshot, observations_path, hourly, "valid_time")
    return snapshot, forecasts, hourly


class ReplayForecastSource:
    """A ``WeatherForecastSource`` over the ``forecasts.parquet`` of a snapshot."""

    def __init__(self, snapshot_dir: Path) -> None:
        """Verify every file of the snapshot and load its forecasts.

        Raises:
            ReplaySnapshotError: The snapshot is missing a file, has a file whose hash differs from the manifest, holds
                a file that is not ``FORECAST_SCHEMA``, or holds a row in a held-out year or outside its window.
        """
        self.snapshot, forecasts, _ = _load(snapshot_dir)
        self._frame = forecasts.sort("valid_time", "lead_days")

    async def previous_runs(
        self, *, station: Station, model: NwpModel, start: date, end: date, leads_days: Sequence[int]
    ) -> pl.DataFrame:
        """Return the stored forecasts of the station and model with a UTC valid-time date in ``[start, end]``.

        Rows are one per valid hour and requested lead, ordered by valid time and then lead; the leads are asked for
        once each. A value the snapshot holds as null is returned as null.

        Raises:
            ValueError: A lead is outside 0 to 7, the range the Previous Runs API serves.
        """
        outside = sorted({lead for lead in leads_days if lead not in LEADS_DAYS})
        if outside:
            raise ValueError(f"leads_days must be within {LEADS_DAYS.start}..{LEADS_DAYS[-1]}, got {outside}")
        first = datetime.combine(start, time.min, tzinfo=UTC)
        after_last = datetime.combine(end + timedelta(days=1), time.min, tzinfo=UTC)
        return self._frame.filter(
            (pl.col("station") == station.icao)
            & (pl.col("model") == model.value)
            & (pl.col("valid_time") >= first)
            & (pl.col("valid_time") < after_last)
            & pl.col("lead_days").is_in(sorted(set(leads_days)))
        )


class ReplayObservationSource:
    """An ``ObservationSource`` over the ``observations.parquet`` of a snapshot."""

    name = SOURCE_NAME

    def __init__(self, snapshot_dir: Path) -> None:
        """Verify every file of the snapshot and load its observations.

        Raises:
            ReplaySnapshotError: The snapshot is missing a file, has a file whose hash differs from the manifest, holds
                a file that is not ``OBS_HOURLY_SCHEMA``, or holds a row in a held-out year or outside its window.
        """
        self.snapshot, _, hourly = _load(snapshot_dir)
        no_code = pl.lit(None, dtype=pl.String)
        self._frame = conform(
            hourly.select(
                "station",
                pl.col("valid_time").alias("obs_time"),
                "t_c",
                "td_c",
                "wind_ms",
                no_code.alias("qc_t"),
                no_code.alias("qc_td"),
                no_code.alias("qc_wind"),
                pl.lit(self.name, dtype=pl.String).alias("source"),
            ).sort("station", "obs_time"),
            OBS_RAW_SCHEMA,
        )

    async def observations(self, *, station: Station, start: datetime, end: datetime) -> pl.DataFrame:
        """Return the station's stored reports with ``start <= obs_time < end``, as ``OBS_RAW_SCHEMA`` rows.

        The window is a pair of instants: any timezone offset is accepted and compared as the instant it denotes.

        Raises:
            ValueError: ``start`` or ``end`` is naive.
        """
        if start.tzinfo is None or end.tzinfo is None:
            raise ValueError(f"start and end must be timezone-aware, got {start.isoformat()} and {end.isoformat()}")
        return self._frame.filter(
            (pl.col("station") == station.icao) & (pl.col("obs_time") >= start) & (pl.col("obs_time") < end)
        )
