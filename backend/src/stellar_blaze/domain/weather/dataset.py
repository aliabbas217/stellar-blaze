"""What a gold dataset build reports about itself: the summary and the manifest that sits next to ``pairs.parquet``.

These are plain data (pydantic, no I/O) so that the use case that computes the summary and the adapter that writes the
manifest both import them downward (preflight F4). ``DatasetSummary`` is what the research's ``match_pairs.py`` printed
(matched pairs and raw forecast errors per model, summer and lead), plus what was excluded on the way: the binning
counts and the WBGT reject counts. ``docs/research/scripts/results/baseline_errors_pooled.csv`` is the reference for
``raw_errors``; ``RESEARCH_CSV_KEYS`` maps its column names to this module's.
"""

from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

# The research CSV's key columns that are named differently here: CSV column -> field of ``RawError`` / ``PairCount``.
# ``model``, ``var`` and ``n`` are named the same. A test that compares a summary with the CSV renames through this.
RESEARCH_CSV_KEYS: Final[Mapping[str, str]] = MappingProxyType({"year": "summer", "lead_d": "lead_days"})


class _Record(BaseModel):
    """Base of the records below: immutable, and an unknown field is an error (a misspelled key must not vanish)."""

    model_config = ConfigDict(frozen=True, extra="forbid")


class PairCount(_Record):
    """Matched forecast and observation hours for one model, summer and lead, summed over the stations.

    ``joint`` counts the hours with an IEM observation of temperature, dew point and wind and a forecast of all three
    at that lead (the research's ``pairs_joint``); ``joint_daytime`` is those of them in the working daytime, 06:00 to
    14:59 UTC (``pairs_joint_daytime``).
    """

    model: str
    summer: int
    lead_days: int
    joint: int = Field(ge=0)
    joint_daytime: int = Field(ge=0)


class RawError(_Record):
    """Forecast minus IEM observation for one model, summer, lead and variable, pooled over the stations.

    Only the hours where the forecast and the observation of this variable are both present count (``n``); this is
    ``var`` ``t`` (temperature), ``td`` (dew point) or ``ws`` (wind speed), as in the research. Units are degrees
    Celsius and meters per second.
    """

    model: str
    summer: int
    lead_days: int
    var: str
    n: int = Field(gt=0)
    bias: float
    mae: float
    rmse: float


class ObservationQc(_Record):
    """What binning discarded for one source, station and summer (from the ``BinningReport`` of that ingest).

    The per-variable keys are ``t_c``, ``td_c`` and ``wind_ms``. A value counts once, as implausible or else as
    QC-flagged. These values are absent from the truth and audit columns of the gold dataset; this is the record that
    they existed (ADR 0005: QC-flagged values are never dropped silently).
    """

    source: str
    station: str
    summer: int
    n_raw: int = Field(ge=0)
    n_implausible: dict[str, int]
    n_qc_flagged: dict[str, int]


class DatasetSummary(_Record):
    """The checkable numbers of a gold dataset.

    ``wbgt_rejects`` maps each WBGT column (``wbgt_obs_c``, ``wbgt_fc_c``, ``wbgt_fc_refrad_c``) to the number of rows
    per ``WbgtReject`` name, every name present (zero included), so the counts add up to the number of rows.
    ``observation_qc`` is empty when the summary was computed from the pairs alone.
    """

    pair_counts: list[PairCount]
    raw_errors: list[RawError]
    wbgt_rejects: dict[str, dict[str, int]]
    observation_qc: list[ObservationQc] = Field(default_factory=list)


class ManifestFile(_Record):
    """A file a build read or wrote: its path (relative, POSIX, to the data directory), SHA-256 and row count."""

    path: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    rows: int = Field(ge=0)


class GoldManifest(_Record):
    """``gold/manifest.json``: which silver files the dataset was built from, the dataset itself, and its summary.

    ``code_version`` is ``Settings.git_sha`` (``SB_GIT_SHA``; ``"unknown"`` outside a release), so a dataset can be
    traced to the code that built it.
    """

    created_at: AwareDatetime
    code_version: str
    inputs: list[ManifestFile]
    output: ManifestFile
    summary: DatasetSummary
