"""The files of a released corrector and its model card (ADR 0009 section 3, ADR 0010 sections 1a and 5).

``write_model`` stores a ``TrainedCorrector`` as a directory named by its model id::

    <models_dir>/corrector-<yyyymmdd>-<git7>-<cfg6>/
        boosters/<target>/q05.txt.gz ... q95.txt.gz   gzip-compressed LightGBM text, one per level (no pickle)
        conformal.json                                 the offsets (``ConformalOffsets``)
        copula.json                                    the 3x3 correlations per stratum and the fallbacks
        fold_stats/pooled.parquet, station.parquet     the climatologies the features need at serving time
        params.json                                    the resolved training config and the row counts
        model_card.md                                  ``render_model_card``
        manifest.json                                  ``ModelManifest``: provenance and the SHA-256 of every file above

Bytes are what is hashed, so every text file is written as bytes with LF newlines (``Path.write_text`` would write CRLF
on Windows while git stores LF, and a hash computed here would fail ``scan_models`` on a Linux checkout or in the Docker
image). The JSON files are canonical (sorted keys, fixed separators, ASCII) and the parquet files are written with a
fixed codec and no statistics, so the same ``TrainedCorrector`` and ``created_at`` always give the same bytes. Parquet
bytes are not promised identical across Polars versions: the manifest records the SHA-256 of the bytes that were stored,
and that is what ``scan_models`` verifies.

The directory is written beside its final place under a dotted temporary name and renamed into place once complete, so
a reader never sees a half-written model (``scan_models`` ignores dotted directories), and it is refused if it would
exceed ``MAX_MODEL_BYTES`` or if the model id already exists (a released id is never overwritten).

This module imports neither ``mapie``, ``sklearn`` nor ``scoringrules``.
"""

import hashlib
import io
import json
import shutil
import statistics
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

import polars as pl

from stellar_blaze.adapters.compute.lgbm_corrector import dump_booster
from stellar_blaze.domain.config.models import ManifestFile, ModelManifest
from stellar_blaze.domain.forecast.features import feature_columns
from stellar_blaze.domain.forecast.grid import PAIRS
from stellar_blaze.domain.forecast.schemas import QUANTILE_COLUMNS
from stellar_blaze.ml.train import TrainedCorrector, model_id

__all__ = ["LIMITATIONS", "MAX_MODEL_BYTES", "ModelTooLargeError", "render_model_card", "write_model"]

MAX_MODEL_BYTES: Final = 15 * 1024 * 1024
"""A model directory stays at or below this many bytes (global constraints; the image carries the released model)."""

# Pre-registration section 10.4 ("Non-independence and other caveats"), verbatim as committed in 661b373. The section is
# approved; if the pre-registration is amended through its amendment log, re-copy these items from it.
LIMITATIONS: Final[tuple[str, ...]] = (
    "8 stations ≈ 4.2-4.6 independent sites; about 1,000-1,300 effective station-days in total. "
    "OMAA-only rows rest on one site-summer.",
    'All stations are **airports**. The claim is "held-out airport clusters", never "any worksite".',
    "WBGT and TWL truth are **derived** (A2): observed T, Td and wind with modelled lead-0 radiation. "
    "There is no globe or wet-bulb instrument.",
    "Whole-degree METAR truth (about 0.29 °C noise).",
    "2026 is a new IFS cycle (50r1, from 12 May 2026), so regime (a) also tests robustness to a model upgrade. "
    "A failure there may be the upgrade, not the method.",
    "Open-Meteo free tier, non-commercial; data CC BY 4.0 (ADR 0005).",
    "The crew is **SIMULATED**; the weather is **REAL**.",
    'TWL is "aligned with ADOSH zones", not certified; the port reads +3.9 to +7.0 W/m² high (ADR 0006).',
)

_TEXT_ENCODING: Final = "utf-8"
_PARQUET_CODEC: Final = "zstd"
_PARQUET_LEVEL: Final = 3
_BOOSTER_SUFFIX: Final = ".txt.gz"
_MANIFEST: Final = "manifest.json"
_CARD: Final = "model_card.md"


_LARGEST_SHOWN: Final = 5


class ModelTooLargeError(ValueError):
    """A model directory would exceed ``MAX_MODEL_BYTES``; nothing was written.

    Attributes:
        total_bytes: What the directory would take, manifest included.
        cap_bytes: The cap in force (``MAX_MODEL_BYTES`` at the time of the call).
        by_group: Bytes per group, largest first: ``boosters/<target>`` for each target's boosters and ``fold_stats``,
            ``json_and_card`` (conformal, copula, params, card, manifest) for the rest.
        files: Every file and its size, largest first.
    """

    def __init__(
        self,
        model_id: str,
        *,
        total_bytes: int,
        cap_bytes: int,
        by_group: tuple[tuple[str, int], ...],
        files: tuple[tuple[str, int], ...],
        remedies: str,
    ) -> None:
        self.model_id = model_id
        self.total_bytes = total_bytes
        self.cap_bytes = cap_bytes
        self.by_group = by_group
        self.files = files
        groups = ", ".join(f"{name} {size:,}" for name, size in by_group)
        largest = ", ".join(f"{name} {size:,}" for name, size in files[:_LARGEST_SHOWN])
        super().__init__(
            f"model {model_id} would take {total_bytes:,} bytes, over the cap of {cap_bytes:,} "
            f"({total_bytes - cap_bytes:,} too many). By group: {groups}. Largest files: {largest}. "
            f"Remedies: {remedies}. Nothing was written."
        )


def _group_of(path: str) -> str:
    parts = path.split("/")
    if parts[0] == "boosters":
        return f"boosters/{parts[1]}"
    return "fold_stats" if parts[0] == "fold_stats" else "json_and_card"


def _too_large(identifier: str, sizes: Mapping[str, int], cap: int, trained: TrainedCorrector) -> ModelTooLargeError:
    groups: dict[str, int] = {}
    for path, size in sizes.items():
        groups[_group_of(path)] = groups.get(_group_of(path), 0) + size
    lgbm = trained.cfg.lgbm
    remedies = (
        f"fewer trees (n_estimators is {lgbm.n_estimators}), num_leaves=7 (it is {lgbm.num_leaves}), "
        f"the joint WBGT method (wbgt_method is {trained.cfg.wbgt_method!r}; the direct method adds 19 boosters), "
        "or raising MAX_MODEL_BYTES by a recorded decision"
    )
    return ModelTooLargeError(
        identifier,
        total_bytes=sum(sizes.values()),
        cap_bytes=cap,
        by_group=tuple(sorted(groups.items(), key=lambda item: (-item[1], item[0]))),
        files=tuple(sorted(sizes.items(), key=lambda item: (-item[1], item[0]))),
        remedies=remedies,
    )


def _canonical_json(value: object) -> bytes:
    """Sorted keys, compact separators, ASCII only, a final LF; NaN and infinity are errors."""
    text = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    return (text + "\n").encode("ascii")


def _parquet_bytes(frame: pl.DataFrame) -> bytes:
    """The frame as parquet with a fixed codec and no column statistics (the same frame gives the same bytes)."""
    buffer = io.BytesIO()
    frame.write_parquet(buffer, compression=_PARQUET_CODEC, compression_level=_PARQUET_LEVEL, statistics=False)
    return buffer.getvalue()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _manifest_files(files: Mapping[str, bytes]) -> tuple[ManifestFile, ...]:
    return tuple(ManifestFile(path=path, sha256=_sha256(files[path])) for path in sorted(files))


def _numbers(values: list[int]) -> tuple[int, float, int]:
    return min(values), statistics.median(values), max(values)


def render_model_card(
    manifest: ModelManifest,
    selection: Mapping[str, object] | None,
    *,
    trained: TrainedCorrector | None = None,
) -> str:
    """The model card (Markdown, US English) of a model, deterministic for the same arguments.

    Nothing in it is a timestamp other than ``manifest.created_at``. The manifest gives the provenance and the dev
    metrics; ``trained`` (``write_model`` passes it) gives the data, the features, the calibration strata and the
    copula fallbacks, and the card says so where they are not available.

    Args:
        manifest: The manifest (``files`` is not read: the manifest is the authority for hashes).
        selection: The content of ``selection.json`` (selection rules 1-4 on 2024-2025), or ``None``.
        trained: The trained corrector, for the sections that need more than the manifest holds.

    Returns:
        The card, ending in one newline.
    """
    lines: list[str] = [f"# Model card: {manifest.model_id}", ""]
    lines += [
        f"- Created: {manifest.created_at.astimezone(UTC).isoformat()}",
        f"- Code: git {manifest.git_sha}",
        f"- Training config: `{manifest.training_config_path}` (SHA-256 {manifest.training_config_sha256})",
        f"- Dependency lock SHA-256: {manifest.uv_lock_sha256}",
        f"- Calibrated pairs: {', '.join(f'{low:g}/{high:g}' for low, high in manifest.calibrated_pairs)}",
        "",
    ]

    lines += ["## Data", ""]
    lines += [f"- Gold pair dataset manifest SHA-256: {manifest.gold_manifest_sha256}"]
    lines += [
        "- Forecasts: ECMWF IFS 0.25 degree (corrected backbone) and GFS (feature), previous runs, leads 1-7 days."
    ]
    lines += ["- Truth: IEM METAR observations binned to the nearest UTC hour (whole-degree)."]
    lines += ["- Modelled hours: 02-15 UTC (06:00-19:59 GST); one calendar date in UTC and GST."]
    if trained is None:
        lines += ["- Summers, stations and row counts: not recorded in this card."]
    else:
        lines += [
            f"- Summers: {', '.join(str(year) for year in trained.summers) or 'none'}",
            f"- Stations: {', '.join(trained.stations) or 'none'}",
            f"- Fit rows: {trained.train_rows}; calibration rows: {trained.cal_rows}; "
            f"rows without a usable joint WBGT grid: {trained.wbgt_rejected_rows}",
        ]
    lines += [""]

    lines += ["## Splits and regimes", ""]
    window = "not recorded" if trained is None else trained.cfg.calibration_window
    lines += [
        "- Fit: 15 May to 31 August of each training summer (pre-registration 2.3).",
        f"- Calibration (conformal offsets and copulas): window `{window}`, disjoint in time from the fit.",
        "- The climatology features are fitted on the fit and calibration rows together, so they are in-sample for "
        "both sets. A fit row within 7 days of a calibration day reads that day's truth through the climatology, and "
        "a fit row after a calibration day reads it through the station history (`bias7_*`, which is legal: it uses "
        "only truth before the issue day). The boosters can therefore move when a calibration-day truth moves; the "
        "conformal offsets are fitted on the calibration rows' own errors regardless.",
        "- Regime (a): known sites, new summer (final model, all clusters). Regime (c): a new cluster and a new summer "
        "(cold feature set). Regime (b): new cluster, known summers (leave-one-cluster-out on 2024-2025).",
        "- Folds are whole clusters (Abu Dhabi, Dubai/Sharjah, Al Maktoum, Al Ain, Fujairah, Ras Al Khaimah); "
        "random splits and leave-one-station-out are not used.",
        "",
    ]

    lines += ["## Features", ""]
    if trained is None:
        lines += ["The feature list is in `params.json`.", ""]
    else:
        columns = feature_columns(trained.cfg.feature_set)
        lines += [
            f"- Feature set: `{trained.cfg.feature_set.value}` ({len(columns)} features)",
            f"- Columns: {', '.join(f'`{name}`' for name in columns)}",
            f"- WBGT uncertainty: `{trained.cfg.wbgt_method}`",
            "- Station history (`bias7_*`, station climatology) uses only truth up to the day before the issue day.",
            "",
        ]

    lines += ["## Metrics per regime (dev, 2024-2025 only)", ""]
    if manifest.metrics:
        names = sorted({name for values in manifest.metrics.values() for name in values})
        lines += ["| regime | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
        for regime in sorted(manifest.metrics):
            cells = [
                format(manifest.metrics[regime][name], ".6g") if name in manifest.metrics[regime] else ""
                for name in names
            ]
            lines += [f"| {regime} | " + " | ".join(cells) + " |"]
    else:
        lines += ["No development metrics were recorded for this model."]
    lines += [""]

    lines += ["## Calibration strata", ""]
    if trained is None:
        lines += ["Not recorded in this card (see `conformal.json`).", ""]
    else:
        offsets = trained.offsets
        first = next(iter(sorted(offsets.n)), None)
        strata = sorted(offsets.n[first]) if first else []
        n_leads, n_blocks = len({key.split("|")[0] for key in strata}), len({key.split("|")[1] for key in strata})
        lines += [
            f"Lead x hour-block strata ({n_leads} leads x {n_blocks} blocks = {len(strata)} per target); "
            "n counts rows, not independent days.",
            "",
            "| target | strata | n min | n median | n max | lead-pooled fallbacks | negative offsets |",
            "|---|---|---|---|---|---|---|",
        ]
        for target in sorted(offsets.n):
            low, middle, high = _numbers(list(offsets.n[target].values()))
            lines += [
                f"| {target} | {len(offsets.n[target])} | {low} | {middle:g} | {high} | "
                f"{len(offsets.fallback[target])} | {offsets.negative[target]} |"
            ]
        lines += [""]
        for target in sorted(offsets.fallback):
            if offsets.fallback[target]:
                lines += [f"- Offset fallbacks, {target}: {', '.join(offsets.fallback[target])}"]
        lines += [f"- Copula fallbacks (lead-pooled correlation): {', '.join(trained.copula_fallback) or 'none'}", ""]

    if selection:
        lines += ["## Selection (2024-2025, leave-one-cluster-out)", ""]
        lines += [
            f"- {key}: `{json.dumps(selection[key], sort_keys=True, ensure_ascii=True)}`" for key in sorted(selection)
        ]
        lines += [""]

    lines += ["## Limitations", ""]
    lines += [f"- {item}" for item in LIMITATIONS]
    lines += [""]

    lines += ["## Intended use", ""]
    lines += [
        "Probabilistic (19 quantiles, 5% to 95%) correction of the IFS forecast of temperature, dew point, wind speed "
        "and WBGT at UAE airport METAR stations, 1 to 7 days ahead, for 06:00-19:59 GST, as an input to worker heat "
        "safety planning. It is a research and demonstration model: its intervals are calibrated on past summers and "
        "are not a regulatory or medical determination.",
        "",
    ]

    lines += ["## Not validated for non-airport sites", ""]
    lines += [
        "This model is not validated for non-airport sites. Every station is an airport; a worksite's microclimate "
        "(surface, shade, urban heat) is not represented. The claim is held-out airport clusters, never any worksite.",
        "",
    ]
    return "\n".join(lines)


def write_model(
    trained: TrainedCorrector,
    *,
    models_dir: Path,
    created_at: datetime,
    git_sha: str,
    uv_lock: Path,
    gold_manifest_sha256: str,
    cfg_path: str,
    dev_metrics: Mapping[str, Mapping[str, float]],
    selection: Mapping[str, object] | None = None,
) -> Path:
    """Write the model directory of ``trained`` under ``models_dir`` and return its path.

    Args:
        trained: The trained corrector.
        models_dir: The directory that holds model directories (created if missing).
        created_at: A timezone-aware creation time (the only timestamp in the model; its UTC date is in the id).
        git_sha: The commit the model was trained at (7 to 40 lowercase hex characters).
        uv_lock: The ``uv.lock`` file; its SHA-256 is recorded with CRLF read as LF, like the config hash (R20).
        gold_manifest_sha256: The SHA-256 of the gold dataset manifest the rows came from.
        cfg_path: The config path to record (as committed, relative to the repository).
        dev_metrics: Regime to metric name to value (finite numbers) for the model card and the manifest.
        selection: The content of ``selection.json`` for the model card, if there is one.

    Returns:
        ``models_dir / model_id``.

    Raises:
        ModelTooLargeError: The directory would exceed ``MAX_MODEL_BYTES`` (a ``ValueError``; it carries the total,
            the cap and the sizes per group and per file, and names the remedies).
        ValueError: ``created_at`` is naive, or a hash or the metrics are malformed.
        FileExistsError: The model directory already exists (a model is never overwritten).
    """
    if created_at.tzinfo is None or created_at.utcoffset() is None:
        raise ValueError("created_at must be timezone-aware")
    identifier = model_id(created_at.astimezone(UTC).date(), git_sha, trained.cfg_sha256)
    final = models_dir / identifier
    if final.exists():
        raise FileExistsError(f"model directory {final} already exists; a released model id is never overwritten")

    files: dict[str, bytes] = {}
    for target in sorted(trained.boosters, key=lambda item: item.value):
        for column, booster in zip(QUANTILE_COLUMNS, trained.boosters[target], strict=True):
            files[f"boosters/{target.value}/{column}{_BOOSTER_SUFFIX}"] = dump_booster(booster)
    files["conformal.json"] = _canonical_json(trained.offsets.model_dump(mode="json"))
    files["copula.json"] = _canonical_json(
        {
            "variables": ["t", "td", "wind"],
            "corr": {key: matrix.tolist() for key, matrix in trained.copulas.items()},
            "fallback": list(trained.copula_fallback),
        }
    )
    files["fold_stats/pooled.parquet"] = _parquet_bytes(trained.stats.pooled_climatology)
    files["fold_stats/station.parquet"] = _parquet_bytes(trained.stats.station_climatology)
    files["params.json"] = _canonical_json(
        {
            "config": trained.cfg.model_dump(mode="json"),
            "config_sha256": trained.cfg_sha256,
            "feature_columns": list(feature_columns(trained.cfg.feature_set)),
            "boosted_targets": sorted(target.value for target in trained.boosters),
            "counts": {
                "train_rows": trained.train_rows,
                "cal_rows": trained.cal_rows,
                "wbgt_rejected_rows": trained.wbgt_rejected_rows,
            },
            "summers": list(trained.summers),
            "stations": list(trained.stations),
        }
    )

    def manifest_of(listed: Mapping[str, bytes]) -> ModelManifest:
        return ModelManifest(
            model_id=identifier,
            created_at=created_at,
            git_sha=git_sha,
            uv_lock_sha256=_sha256(uv_lock.read_bytes().replace(b"\r\n", b"\n")),
            gold_manifest_sha256=gold_manifest_sha256,
            training_config_path=cfg_path,
            training_config_sha256=trained.cfg_sha256,
            calibrated_pairs=PAIRS,
            metrics={regime: dict(values) for regime, values in dev_metrics.items()},
            files=_manifest_files(listed),
        )

    # The card cannot list its own hash: it is rendered from the manifest of the other files, then hashed itself.
    files[_CARD] = render_model_card(manifest_of(files), selection, trained=trained).encode(_TEXT_ENCODING)
    manifest_bytes = _canonical_json(manifest_of(files).model_dump(mode="json"))
    sizes = {path: len(data) for path, data in files.items()} | {_MANIFEST: len(manifest_bytes)}
    if sum(sizes.values()) > MAX_MODEL_BYTES:
        raise _too_large(identifier, sizes, MAX_MODEL_BYTES, trained)

    models_dir.mkdir(parents=True, exist_ok=True)
    partial = models_dir / f".{identifier}.partial"
    if partial.exists():  # left by a crashed run of this very id; dotted directories are ours and ignored by the scan
        shutil.rmtree(partial)
    try:
        for path, data in {**files, _MANIFEST: manifest_bytes}.items():
            destination = partial / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        partial.rename(final)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    return final
