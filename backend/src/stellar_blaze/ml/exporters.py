"""The dev exports: canonical JSON with provenance, the dev skill tables and the abu_dhabi out-of-fold samples.

``write_dev_exports`` writes four files to ``artifacts/eval/dev/`` (pre-registration section 6 and 7.1; it renders every
file in memory first, so a failure at any step leaves the directory untouched):

* ``oof_samples_abu_dhabi.parquet``: the held-out abu_dhabi fold's out-of-fold joint (t, td, wind) samples at lead 1,
  working daytime, with what B3's theta rule (6.5) needs to turn them into TWL and to score them (see
  ``oof_samples_frame``). 2024-2025 rows only: building it asserts that and raises ``HoldoutViolationError``. It is
  not committed (``.gitignore``).
* ``oof_samples_abu_dhabi.manifest.json``: what the parquet is (rows, columns, SHA-256, the command and the commit
  that wrote it); this is the committed record of the parquet.
* ``dev_skill.json``: the skill tables the evaluation report quotes, from ``evaluate.skill_table``.
* ``selection.json``: every decision with its evidence, the chosen configuration, the 6.1 grid scores, the frames each
  decision read and the per-stage counts, plus the SHA-256 of the other three files.

Every number written comes from code. JSON is canonical (sorted keys, compact separators, UTF-8, LF written as bytes
because ``Path.write_text`` writes CRLF on Windows while git stores LF: R21) and carries a ``provenance`` block; the
parquet carries the same block in its key-value metadata WITHOUT ``generated_at``, so identical samples give identical
bytes (a regenerated parquet reproduces the hash its manifest records; the manifest, a JSON file, keeps the
time). Floats in ``dev_skill.json`` are rounded to
``FLOAT_DECIMALS`` places (far below the 0.29 degree noise floor of the METAR truth) so the file stays small; a table
is ``{"columns": [...], "rows": [[...]]}`` (column names once, not per row), a null is a score that is undefined for
its group, and a non-finite float is never written (``write_json`` refuses one).
"""

import hashlib
import io
import json
import math
import unicodedata
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Final, Literal

import numpy as np
import polars as pl
import structlog
from pydantic import JsonValue

from stellar_blaze.domain.provenance import Provenance, ProvenanceLabel, attach_provenance
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.ml.data import DEV_SUMMERS, TEST_SUMMER, HoldoutViolationError
from stellar_blaze.ml.evaluate import OofPredictions, coverage_by_forecast_tercile, skill_table
from stellar_blaze.ml.selection import EXPORT_CLUSTER, WORKING_HOURS_UTC, Decision
from stellar_blaze.ml.training_config import TrainingConfig

__all__ = [
    "FLOAT_DECIMALS",
    "OOF_SAMPLES_FILE",
    "OOF_SAMPLES_MANIFEST_FILE",
    "PREFLIGHT_N_BOOT",
    "PROTOCOL_PATH",
    "REPORT_HOUR_BLOCKS",
    "REPORT_LEADS",
    "SECTION_6_HEADING",
    "SECTION_7_1_HEADING",
    "dev_skill_payload",
    "github_slug",
    "oof_samples_frame",
    "oof_samples_manifest",
    "preflight_dev_exports",
    "render_json",
    "render_oof_samples",
    "table_payload",
    "write_dev_exports",
    "write_json",
    "write_oof_samples",
]

_log = structlog.get_logger(__name__)

PROTOCOL_PATH: Final = "docs/research/2026-11-12-preregistration-2026-evaluation.md"
"""The approved pre-registration the exports follow (repository-relative)."""

SECTION_6_HEADING: Final = "6. Selection rules on 2024-2025 (LOCO out-of-fold only)"
SECTION_7_1_HEADING: Final = "7.1 Forecast row (B2; `artifacts/eval/2026/forecast_skill.json`)"
"""The headings of the sections the dev exports follow, as written in the pre-registration (a test pins both)."""

REPORT_LEADS: Final[tuple[int, ...]] = (1, 2, 3, 5, 7)
REPORT_HOUR_BLOCKS: Final[tuple[str, ...]] = ("early", "peak", "late", "working")
FLOAT_DECIMALS: Final = 6
OOF_SAMPLES_FILE: Final = "oof_samples_abu_dhabi.parquet"
OOF_SAMPLES_MANIFEST_FILE: Final = "oof_samples_abu_dhabi.manifest.json"
_EXPORTERS: Final = "stellar_blaze.ml.exporters"
_PARQUET_LEVEL: Final = 19
_IFS: Final = NwpModel.ECMWF_IFS025.value
_PAIR_COLUMNS: Final = (
    "fc_sw_wm2",
    "fc_direct_wm2",
    "fc_pressure_hpa",
    "ref_sw_wm2",
    "ref_direct_wm2",
    "ref_pressure_hpa",
    "obs_t_c",
    "obs_td_c",
    "obs_wind_ms",
    "has_joint_obs",
)
_KEY_COLUMNS: Final = (
    "station",
    "cluster",
    "valid_time",
    "summer",
    "lead_days",
    "hour_utc",
    "raw_t",
    "raw_td",
    "raw_wind",
    "wbgt_fc_c",
)
_DESCRIPTIVE_DROPS: Final = ("pit_", "pinball_", "is_", "brier_", "bss_", "events_", "crps_diff_")


def github_slug(heading: str) -> str:
    """The anchor GitHub gives a heading: lowercase, punctuation dropped (``-`` and ``_`` kept), spaces to ``-``.

    For example the section 6 heading gives ``6-selection-rules-on-2024-2025-loco-out-of-fold-only``.
    """
    kept = "".join(
        char
        for char in heading.lower()
        if char in " -_" or unicodedata.category(char)[0] in {"L", "N"}  # letters and digits, any script
    )
    return kept.replace(" ", "-")


def _anchor(heading: str) -> str:
    return "#" + github_slug(heading)


SELECTION_ANCHOR: Final = _anchor(SECTION_6_HEADING)
SKILL_ANCHOR: Final = _anchor(SECTION_7_1_HEADING)


# === canonical JSON =================================================================================================


def render_json(payload: Mapping[str, JsonValue], provenance: Provenance) -> bytes:
    """The canonical bytes of ``payload`` with its provenance (what ``write_json`` writes).

    Raises:
        ValueError: A float is NaN or infinite, or the payload already has a ``provenance`` key.
    """
    document = attach_provenance(payload, provenance)
    return (
        json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n"
    ).encode("utf-8")


def _write_bytes(path: Path, data: bytes, *, exclusive: bool = False) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if exclusive:
        with path.open("xb") as file:
            file.write(data)
    else:
        path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, payload: Mapping[str, JsonValue], provenance: Provenance, *, exclusive: bool = False) -> str:
    """Write ``payload`` with its provenance as canonical JSON and return the SHA-256 of the bytes written.

    Canonical: keys sorted, separators ``,`` and ``:``, UTF-8 without ``\\u`` escapes, one trailing LF, the bytes
    written as bytes so no platform changes a newline. Non-finite floats are refused (``allow_nan=False``) before
    the file is touched. Parent directories are created.

    Args:
        path: The file.
        payload: JSON-native values; it must not hold a ``provenance`` key.
        provenance: The block attached under ``provenance`` (``attach_provenance``).
        exclusive: Open with mode ``"xb"``: an existing file is an error and is left as it is (the gated 2026 outputs).

    Raises:
        ValueError: A float is NaN or infinite, or the payload already has a ``provenance`` key.
        FileExistsError: ``exclusive`` and ``path`` exists.
    """
    return _write_bytes(path, render_json(payload, provenance), exclusive=exclusive)


def _cell(value: object, decimals: int) -> JsonValue:
    if value is None or isinstance(value, bool | int | str):
        return value
    if isinstance(value, float):
        return round(value, decimals) if math.isfinite(value) else None
    if isinstance(value, date):  # datetime is a date
        return value.isoformat()
    raise TypeError(f"cannot write a {type(value).__name__} to JSON: {value!r}")


def table_payload(frame: pl.DataFrame, *, decimals: int = FLOAT_DECIMALS) -> dict[str, JsonValue]:
    """A frame as ``{"columns": [...], "rows": [[...]]}``: floats rounded to ``decimals``, NaN and null as ``null``."""
    rows: list[JsonValue] = [[_cell(value, decimals) for value in row] for row in frame.iter_rows()]
    columns: list[JsonValue] = list(frame.columns)
    return {"columns": columns, "rows": rows}


# === the abu_dhabi out-of-fold samples ==============================================================================


def _refuse_holdout(frame: pl.DataFrame, what: str) -> None:
    years = set(frame["valid_time"].dt.year().unique().to_list())
    summers = set(frame["summer"].unique().to_list())
    if TEST_SUMMER in years or TEST_SUMMER in summers:
        raise HoldoutViolationError(
            f"{what} holds summer {TEST_SUMMER}, the hold-out: the dev exports hold {sorted(DEV_SUMMERS)} only"
        )


def oof_samples_frame(
    oof: OofPredictions, pairs: pl.DataFrame, *, cluster: str = EXPORT_CLUSTER, lead: int = 1
) -> pl.DataFrame:
    """The out-of-fold joint samples of one held-out cluster at one lead, working daytime, with the consumer's columns.

    The consumer is B3's theta rule (pre-registration 6.5). Per row (a station-hour, sorted by station and time):

    * keys: ``station``, ``cluster``, ``valid_time`` (UTC), ``summer``, ``lead_days``;
    * ``samples``: the corrected joint samples as a fixed-size ``(n_joint_samples, 3)`` float32 array, columns (t, td,
      wind), wind already clipped at 0; NaN where the forecast was missing (nothing is imputed);
    * the raw forecast ``raw_t``, ``raw_td``, ``raw_wind`` and ``wbgt_fc_c`` (for the raw-IFS warning policies);
    * the FORECAST radiation and pressure ``fc_sw_wm2``, ``fc_direct_wm2``, ``fc_pressure_hpa``: forecast TWL runs the
      samples through the forecast's own radiation and pressure;
    * the lead-0 reference radiation and pressure ``ref_sw_wm2``, ``ref_direct_wm2``, ``ref_pressure_hpa`` and the
      observed ``obs_t_c``, ``obs_td_c``, ``obs_wind_ms`` with ``has_joint_obs``: truth TWL is built from the
      observations with the reference radiation (assumption A2), so truth High hours and POD can be scored. Null
      where unobserved.

    Raises:
        HoldoutViolationError: ``oof.keys`` (every row, not only the exported ones) or ``pairs`` holds summer 2026,
            by ``summer`` or by the year of ``valid_time``.
        ValueError: The OOF holds no samples, no sample row matches, or a sample row has no IFS row in ``pairs``.
    """
    _refuse_holdout(oof.keys, "the out-of-fold keys")
    _refuse_holdout(pairs, "the pairs")
    if oof.samples is None or oof.sample_index is None:
        raise ValueError("the OOF holds no joint samples: run the evaluation with sample_clusters")
    rows = oof.keys.select(_KEY_COLUMNS).select(pl.all().gather(pl.Series(oof.sample_index))).with_row_index("_s")
    rows = rows.filter(
        (pl.col("cluster") == cluster)
        & (pl.col("lead_days") == lead)
        & pl.col("hour_utc").is_in(list(WORKING_HOURS_UTC))
    )
    if rows.height == 0:
        raise ValueError(f"no row of cluster {cluster!r} at lead {lead} in the working hours has samples")
    reference = pairs.filter(pl.col("model") == _IFS).select("station", "valid_time", "lead_days", *_PAIR_COLUMNS)
    joined = rows.join(reference, on=["station", "valid_time", "lead_days"], how="inner", validate="1:1")
    if joined.height != rows.height:
        raise ValueError(f"{rows.height - joined.height} sample row(s) have no IFS row in the pairs")
    joined = joined.sort("station", "valid_time")
    samples = np.ascontiguousarray(oof.samples[joined["_s"].to_numpy()], dtype=np.float32)
    shape = (int(samples.shape[1]), int(samples.shape[2]))
    frame = joined.drop("_s", "hour_utc").with_columns(
        pl.col("summer").cast(pl.Int16),
        pl.col("lead_days").cast(pl.Int8),
        pl.Series("samples", samples, dtype=pl.Array(pl.Float32, shape)),
    )
    _refuse_holdout(frame, "the sample export")
    return frame.select(
        "station",
        "cluster",
        "valid_time",
        "summer",
        "lead_days",
        "raw_t",
        "raw_td",
        "raw_wind",
        "wbgt_fc_c",
        *_PAIR_COLUMNS,
        "samples",
    )


def render_oof_samples(frame: pl.DataFrame, provenance: Provenance) -> bytes:
    """The bytes of the sample parquet: zstd at a fixed level, provenance in the key-value metadata.

    The metadata omits ``generated_at``: a wall-clock time inside the file would give every regeneration of the same
    samples a different hash, and the manifest's ``sha256`` could never be reproduced. The deterministic provenance
    (commit, data hash, protocol, script) stays.
    """
    metadata = json.dumps(
        provenance.model_dump(mode="json", exclude={"generated_at"}), sort_keys=True, separators=(",", ":")
    )
    buffer = io.BytesIO()
    frame.rechunk().write_parquet(
        buffer, compression="zstd", compression_level=_PARQUET_LEVEL, metadata={"provenance": metadata}
    )
    return buffer.getvalue()


def write_oof_samples(path: Path, frame: pl.DataFrame, provenance: Provenance) -> str:
    """Write the sample frame as zstd parquet (``render_oof_samples``); return its SHA-256.

    The file is smaller than JSON by far, but the samples dominate its size (50 x 3 float32 per row): see the Task 12
    report for the measured size against the 500 KB commit limit.
    """
    return _write_bytes(path, render_oof_samples(frame, provenance))


def oof_samples_manifest(
    frame: pl.DataFrame, *, parquet_sha256: str, command: str, git_sha: str, git_clean: bool
) -> dict[str, JsonValue]:
    """What a reader needs to check a regenerated ``oof_samples_abu_dhabi.parquet`` against the one that was run.

    The parquet is not committed (``.gitignore``), so this small JSON is: the file name, its row count, its columns
    (name and polars dtype, as strings), the SHA-256 of its bytes, the exact command that wrote it, the commit and
    whether the working tree was clean at that commit (``git_clean``: False means ``git_sha`` does not name all the
    code that ran).
    """
    columns: list[JsonValue] = [{"name": name, "dtype": str(dtype)} for name, dtype in frame.schema.items()]
    return {
        "file": OOF_SAMPLES_FILE,
        "rows": frame.height,
        "columns": columns,
        "sha256": parquet_sha256,
        "command": command,
        "git_sha": git_sha,
        "git_clean": git_clean,
    }


# === dev_skill.json =================================================================================================


def _descriptive(frame: pl.DataFrame) -> pl.DataFrame:
    """The columns of a per-cluster or per-station table: scores and counts, no PIT, Brier, interval or bootstrap."""
    keep = [name for name in frame.columns if not name.startswith(_DESCRIPTIVE_DROPS)]
    return frame.select(keep)


def dev_skill_payload(
    oof: OofPredictions,
    *,
    cfg: TrainingConfig,
    summer_split: OofPredictions | None,
    counts: Mapping[str, int],
    n_boot: int = 2000,
) -> dict[str, JsonValue]:
    """The dev skill tables of pre-registration 7.1 for the corrector beside B0, B0d, B2d, B3d and B4.

    Tables (each ``table_payload``): ``skill`` (target x lead in ``REPORT_LEADS`` x hour block in
    ``REPORT_HOUR_BLOCKS``, with CRPS, MAE, RMSE and bias per model, pinball, interval scores, coverage, PIT counts,
    Brier and BSS, and the paired CRPS differences with their 95% block-bootstrap intervals), ``coverage_by_forecast_
    tercile`` (``working`` and ``all`` hours), ``by_cluster`` and ``by_station`` (descriptive, working daytime, no
    interval), ``fallbacks`` (rows B3d and B4 sent to B2d) and ``summer_split`` (the R23 diagnostic by lead and fold,
    descriptive; ``None`` when it did not run). Leads the data does not hold simply have no rows.

    Args:
        oof: The final configuration's LOCO predictions.
        cfg: Its config (written under ``configuration``).
        summer_split: The summer-split OOF, or ``None``.
        counts: Counts to carry (``selection``'s per-stage counts).
        n_boot: Bootstrap replicates (the pre-registered 2,000).
    """
    leads = list(REPORT_LEADS)
    blocks = [
        skill_table(oof, leads=leads, hours=block, by=["lead_days"], n_boot=n_boot).with_columns(
            pl.lit(block).alias("hour_block")
        )
        for block in REPORT_HOUR_BLOCKS
    ]
    skill = pl.concat(blocks).select(
        "target", "lead_days", "hour_block", pl.exclude("target", "lead_days", "hour_block")
    )
    by_cluster = skill_table(oof, leads=leads, hours="working", by=["lead_days", "cluster"], intervals=False)
    by_station = skill_table(oof, leads=leads, hours="working", by=["lead_days", "station"], intervals=False)
    tercile = {
        hours: table_payload(coverage_by_forecast_tercile(oof, leads=leads, hours=hours))
        for hours in ("working", "all")
    }
    fallbacks = (
        oof.fallbacks.group_by("target", "model", maintain_order=True)
        .agg(pl.col("n_rows").sum(), pl.col("n_fallback").sum())
        .sort("target", "model")
    )
    split_payload: JsonValue = None
    if summer_split is not None:
        split_table = skill_table(
            summer_split, leads=[1, 2, 3], hours="working", by=["lead_days", "fold"], intervals=False
        )
        split_payload = {
            "skill": table_payload(_descriptive(split_table)),
            "rows_by_fold": _count_by(summer_split.keys, "fold"),
        }
    models = sorted({model for (_, model) in oof.grids}, key=lambda name: (name != "corrector", name))
    return {
        "float_decimals": FLOAT_DECIMALS,
        "report_leads": list(REPORT_LEADS),
        "report_hour_blocks": list(REPORT_HOUR_BLOCKS),
        "models": list(models),
        "configuration": json.loads(cfg.model_dump_json()),
        "counts": {
            **{name: int(value) for name, value in counts.items()},
            "rows_by_cluster": _count_by(oof.keys, "cluster"),
            "rows_by_summer": _count_by(oof.keys, "summer"),
            "rows_by_fold": _count_by(oof.keys, "fold"),
        },
        "tercile_edges": [float(edge) for edge in oof.tercile_edges],
        "skill": table_payload(skill),
        "coverage_by_forecast_tercile": tercile,
        "by_cluster": table_payload(_descriptive(by_cluster)),
        "by_station": table_payload(_descriptive(by_station)),
        "fallbacks": table_payload(fallbacks),
        "summer_split": split_payload,
    }


def _count_by(keys: pl.DataFrame, column: str) -> dict[str, JsonValue]:
    table = keys.group_by(column).len().sort(column)
    return {str(name): int(count) for name, count in table.iter_rows()}


# === selection.json and the whole export ============================================================================


def _provenance(
    anchor: str, script: str, function: str, *, git_sha: str, data_sha256: str, generated_at: datetime
) -> Provenance:
    return Provenance(
        protocol_path=PROTOCOL_PATH,
        protocol_anchor=anchor,
        script=script,
        function=function,
        git_sha=git_sha,
        data_sha256=data_sha256,
        model_id=None,
        label=ProvenanceLabel.REAL,
        generated_at=generated_at,
    )


PREFLIGHT_N_BOOT: Final = 2
"""Bootstrap replicates of the preflight's skill tables (it checks that the export builds, not the numbers)."""


def preflight_dev_exports(oof: OofPredictions, pairs: pl.DataFrame, cfg: TrainingConfig) -> None:
    """Build what the dev exports build from one LOCO run, discarding it: a run of hours must not die at its export.

    ``evaluate-dev`` calls this right after the first LOCO run, so a 2026 row, a missing sample cluster, a column the
    skill tables cannot score or a non-finite number stops the command minutes into it and not at its last step. The
    skill tables use ``PREFLIGHT_N_BOOT`` replicates and no summer split.

    Raises:
        HoldoutViolationError: The OOF keys or the pairs hold summer 2026.
        ValueError: The OOF holds no joint samples or the skill tables hold a non-finite number.
    """
    oof_samples_frame(oof, pairs)
    skill = dev_skill_payload(oof, cfg=cfg, summer_split=None, counts={}, n_boot=PREFLIGHT_N_BOOT)
    json.dumps(skill, allow_nan=False)


def write_dev_exports(
    oof: OofPredictions,
    decisions: Sequence[Decision],
    out_dir: Path,
    *,
    pairs: pl.DataFrame,
    cfg: TrainingConfig,
    cfg_sha256: str,
    git_sha: str,
    git_clean: bool,
    data_sha256: str,
    command: str,
    mode: Literal["grid", "single"],
    calibration_targets: str,
    allow_dirty: bool = False,
    grid_scores: pl.DataFrame | None = None,
    tables: Mapping[str, pl.DataFrame] | None = None,
    summer_split: OofPredictions | None = None,
    counts: Mapping[str, int] | None = None,
    n_boot: int = 2000,
    now: datetime | None = None,
) -> dict[str, str]:
    """Write the parquet, its manifest, ``dev_skill.json`` and ``selection.json`` to ``out_dir``.

    Every file is rendered in memory (with the 2026 assertion and every JSON check) before the first is written, so a
    failure at any step leaves ``out_dir`` untouched, not even created. ``selection.json`` carries the hashes of the
    other three. The parquet is not committed (``.gitignore``); the manifest, ``dev_skill.json`` and ``selection.json``
    are.

    The chain from a released model back to this evaluation: the model's manifest holds the SHA-256 of its training
    config TOML (``training_config_sha256``); ``sb-jobs train --release --dev-skill`` refuses a TOML whose fields differ
    from ``dev_skill.json``'s ``configuration`` (and from this file's ``chosen_configuration``) or whose gold hash
    differs from the provenance's ``data_sha256``. ``chosen_configuration.config_fingerprint`` is the TOML's hash in
    ``single`` mode and, in ``grid`` mode where the chosen configuration has no file, a fingerprint of the derived
    configuration (its field values are in ``chosen_configuration`` for ``train`` to compare).

    Args:
        oof: The final configuration's LOCO predictions (with abu_dhabi samples).
        decisions: The selection decisions in order.
        out_dir: The directory (created).
        pairs: The dev rows the OOF was computed from (the sample export joins radiation, pressure and observations).
        cfg: The final configuration.
        cfg_sha256: Its hash (``DevSelection.cfg_sha256``).
        git_sha: The commit the run was at.
        git_clean: Whether the working tree was clean at ``git_sha`` (recorded in ``selection.json`` and the sample
            manifest, not in ``Provenance``).
        data_sha256: SHA-256 of the gold pairs file (from its manifest).
        command: The exact ``sb-jobs evaluate-dev`` invocation (repository-relative paths), in the sample manifest.
        mode: ``"grid"`` (the decisions were applied) or ``"single"`` (only the 6.4 coverage report; not applied).
        calibration_targets: The 6.4 reading, ``"wbgt"`` or ``"all"`` (recorded in ``selection.json``).
        allow_dirty: ``--allow-dirty`` was given (recorded as ``allow_dirty``).
        grid_scores: The 6.1 scores, if the grid ran.
        tables: The frames each decision read, written under ``inputs``.
        summer_split: The R23 diagnostic OOF, if it ran.
        counts: Per-stage counts.
        n_boot: Bootstrap replicates for the skill tables.
        now: The generation time (default now, UTC).

    Returns:
        File name to SHA-256 of the file's bytes, for all four files.

    Raises:
        HoldoutViolationError: The OOF keys or the pairs hold summer 2026.
    """
    generated_at = datetime.now(UTC) if now is None else now
    stage_counts = dict(counts or {})
    samples = oof_samples_frame(oof, pairs)
    skill = dev_skill_payload(oof, cfg=cfg, summer_split=summer_split, counts=stage_counts, n_boot=n_boot)
    inputs: dict[str, JsonValue] = {
        name: table_payload(frame, decimals=12) for name, frame in sorted((tables or {}).items())
    }

    def provenance(anchor: str, script: str, function: str) -> Provenance:
        return _provenance(
            anchor, script, function, git_sha=git_sha, data_sha256=data_sha256, generated_at=generated_at
        )

    files: dict[str, bytes] = {}
    files[OOF_SAMPLES_FILE] = render_oof_samples(samples, provenance(SELECTION_ANCHOR, _EXPORTERS, "oof_samples_frame"))
    files[OOF_SAMPLES_MANIFEST_FILE] = render_json(
        oof_samples_manifest(
            samples,
            parquet_sha256=hashlib.sha256(files[OOF_SAMPLES_FILE]).hexdigest(),
            command=command,
            git_sha=git_sha,
            git_clean=git_clean,
        ),
        provenance(SELECTION_ANCHOR, _EXPORTERS, "oof_samples_manifest"),
    )
    files["dev_skill.json"] = render_json(skill, provenance(SKILL_ANCHOR, _EXPORTERS, "dev_skill_payload"))
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    selection: dict[str, JsonValue] = {
        "mode": mode,
        "applied": mode == "grid",
        "git_clean": git_clean,
        "allow_dirty": allow_dirty,
        "calibration_targets": calibration_targets,
        "decisions": [json.loads(decision.model_dump_json()) for decision in decisions],
        "chosen_configuration": {
            "name": cfg.name,
            "feature_set": cfg.feature_set.value,
            "wbgt_method": cfg.wbgt_method,
            "calibration_window": cfg.calibration_window,
            "lgbm": json.loads(cfg.lgbm.model_dump_json()),
            "config_fingerprint": cfg_sha256,
            "fingerprint_of": "toml_file" if mode == "single" else "derived_configuration",
        },
        "grid_scores": None if grid_scores is None else table_payload(grid_scores, decimals=12),
        "inputs": inputs,
        "counts": {name: int(value) for name, value in stage_counts.items()},
        "samples_rows": samples.height,
        "exports": dict(sorted(hashes.items())),
    }
    files["selection.json"] = render_json(
        selection, provenance(SELECTION_ANCHOR, "stellar_blaze.ml.selection", "run_dev_selection")
    )
    for name, data in files.items():  # the first write: everything above has been built and checked
        hashes[name] = _write_bytes(out_dir / name, data)
    _log.info("exports.written", directory=str(out_dir), hashes=hashes, sample_rows=samples.height)
    return dict(sorted(hashes.items()))
