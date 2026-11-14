"""The manifest of a replay snapshot: a frozen, hashed copy of the forecasts and observations of one summer.

A snapshot is a directory ``replay/<snapshot_id>/`` holding ``forecasts.parquet`` (``FORECAST_SCHEMA``),
``observations.parquet`` (the hourly truth, ``OBS_HOURLY_SCHEMA``, as the ingest stored it) and ``snapshot.json``, which
is a ``ReplaySnapshot``. The builder (``jobs.replay_build``) writes it and the replay sources
(``adapters.sources.replay``) read it, so the manifest lives here, below both. It is plain data: no I/O.
"""

import hashlib
import re
from collections.abc import Sequence
from datetime import UTC
from typing import Annotated, Final, Self

from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from stellar_blaze.domain.config.models import Sha256
from stellar_blaze.domain.provenance import Provenance

FORECASTS_FILE: Final = "forecasts.parquet"
OBSERVATIONS_FILE: Final = "observations.parquet"
MANIFEST_FILE: Final = "snapshot.json"
REQUIRED_FILES: Final = (FORECASTS_FILE, OBSERVATIONS_FILE)

HELD_OUT_SUMMERS: Final = frozenset({2026})
"""Summers no replay snapshot may hold a row of, until the architect records "2026 go". The one definition: the builder,
the manifest model and both replay sources use it, so they cannot drift. Unlocking is a deliberate, reviewed one-line
edit here, never a flag, an environment variable or a command-line option."""

SNAPSHOT_ID_PATTERN: Final = r"^[a-z0-9]+(?:[_-][a-z0-9]+)*$"
"""A snapshot id is a path component: lowercase letters and digits in groups joined by single ``-`` or ``_``."""
_SNAPSHOT_ID = re.compile(SNAPSHOT_ID_PATTERN)
MAX_SNAPSHOT_ID_LENGTH: Final = 64


def check_snapshot_id(value: str) -> str:
    """``value`` if it is a safe snapshot id.

    Raises:
        ValueError: ``value`` is empty, longer than 64 characters or not a lowercase slug (so it could be a path such
            as ``../x`` or hold a separator).
    """
    if len(value) > MAX_SNAPSHOT_ID_LENGTH or not _SNAPSHOT_ID.fullmatch(value):
        raise ValueError(
            f"a snapshot id must be a lowercase slug of at most {MAX_SNAPSHOT_ID_LENGTH} characters "
            f"(letters, digits, single '-' or '_' between groups), got {value!r}"
        )
    return value


SnapshotId = Annotated[str, AfterValidator(check_snapshot_id)]


class ReplayFile(BaseModel):
    """One stored file of the snapshot and the SHA-256 of its bytes."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    path: Annotated[str, StringConstraints(pattern=r"^[a-z_]+\.parquet$")]
    sha256: Sha256


def files_digest(files: Sequence[ReplayFile]) -> str:
    """One SHA-256 for a snapshot's data: over the ``path:sha256`` lines of its files, in path order."""
    listing = "".join(f"{file.path}:{file.sha256}\n" for file in sorted(files, key=lambda file: file.path))
    return hashlib.sha256(listing.encode("ascii")).hexdigest()


class ReplaySnapshot(BaseModel):
    """``snapshot.json``: what the snapshot holds and the hashes that make it tamper-evident.

    Attributes:
        snapshot_id: The directory name.
        created_at: When it was built; timezone-aware.
        stations: ICAO identifiers whose rows it holds.
        models: NWP model names whose forecasts it holds.
        start: First hour of the window it covers (15 May 00:00 UTC of the summer).
        end: Last hour of the window, inclusive (30 Sep 23:00 UTC).
        files: The stored data files, relative to the directory, with the SHA-256 of their bytes.
        provenance: Where the data came from (label ``REAL``: copied silver, no computation).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    snapshot_id: SnapshotId
    created_at: AwareDatetime
    stations: Annotated[list[str], Field(min_length=1)]
    models: Annotated[list[str], Field(min_length=1)]
    start: AwareDatetime
    end: AwareDatetime
    files: list[ReplayFile]
    provenance: Provenance

    @model_validator(mode="after")
    def _window_and_files(self) -> Self:
        held_out = sorted({self.start.astimezone(UTC).year, self.end.astimezone(UTC).year} & HELD_OUT_SUMMERS)
        if held_out:
            raise ValueError(
                f"the window {self.start.isoformat()} to {self.end.isoformat()} touches held-out year(s) {held_out}"
            )
        if self.end < self.start:
            raise ValueError(f"end {self.end.isoformat()} is before start {self.start.isoformat()}")
        paths = sorted(file.path for file in self.files)
        if paths != sorted(REQUIRED_FILES):
            raise ValueError(f"files must be exactly {sorted(REQUIRED_FILES)}, got {paths}")
        if self.provenance.data_sha256 != files_digest(self.files):
            raise ValueError("provenance.data_sha256 does not match the digest of the files listed")
        return self
