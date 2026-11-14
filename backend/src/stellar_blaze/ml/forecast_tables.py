"""The tables of the gated forecast row that are not skill-table cuts (pre-registration 7.1), and the OMAA series.

* ``reliability_payload``: the reliability data (bins ``PREREGISTERED_RELIABILITY_EDGES``; the 0.65-0.75 bin is the
  "70%" bin of the "when we say 70%" sentence) for WBGT >= 30 and >= 32, lead 1, working daytime, pooled over stations,
  for the corrector and for B2d (the second reference of the Brier skill score). A bin under 50 forecasts is ``hollow``.
* ``raw_comparison``: raw IFS vs AIFS vs GFS MAE and bias for 2025 and 2026, leads 1-3, on the rows where every model
  has a forecast and the truth exists (so the three are scored on the same hours), with each model's own row count.
* ``series_frame``: the corrected 19-level grids of one station's rows of one summer with the raw forecast and the
  truth, the input of B3's demo day and scoreboard (``series_parquet_bytes``, ``series_manifest``).

Missing data is never filled: an unscored row is out of a table (and counted), and a row without a grid has a null
array.
"""

import hashlib
import io
import json
from collections.abc import Mapping
from typing import Final

import numpy as np
import polars as pl
from numpy.typing import NDArray
from pydantic import JsonValue

from stellar_blaze.domain.forecast.features import FORECAST_COLUMN, TRUTH_COLUMN, Target
from stellar_blaze.domain.forecast.grid import F64, LEVELS, exceedance_probability
from stellar_blaze.domain.provenance import Provenance
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.ml import metrics
from stellar_blaze.ml.exporters import table_payload

__all__ = [
    "RAW_COMPARISON_LEADS",
    "RAW_COMPARISON_SUMMERS",
    "RELIABILITY_EVENTS_C",
    "RELIABILITY_MIN_COUNT",
    "SERIES_REFERENCE_COLUMNS",
    "raw_comparison",
    "reliability_payload",
    "series_frame",
    "series_manifest",
    "series_parquet_bytes",
]

RELIABILITY_EVENTS_C: Final[tuple[float, ...]] = (30.0, 32.0)
"""The WBGT events of the reliability diagram (pre-registration 7.1)."""

RELIABILITY_MIN_COUNT: Final = 50
"""A reliability bin with fewer forecasts is hollow and never quoted (pre-registration 7.1)."""

RAW_COMPARISON_SUMMERS: Final[tuple[int, ...]] = (2025, 2026)
RAW_COMPARISON_LEADS: Final[tuple[int, ...]] = (1, 2, 3)

SERIES_REFERENCE_COLUMNS: Final[tuple[str, ...]] = (
    "obs_t_c",
    "obs_td_c",
    "obs_wind_ms",
    "wbgt_obs_c",
    "has_joint_obs",
    "wbgt_obs_reject",
    "ref_sw_wm2",
    "ref_direct_wm2",
    "ref_pressure_hpa",
)
"""The gold columns the series carries as they are: the truths, the scored-row flags and the lead-0 reference.

``truth_<target>`` is ``raw + error``: it is null wherever the raw forecast (or the observation) is missing, and it
has no flags, so it cannot serve a truth WBGT of the demo day (7.4, B3). ``obs_*`` and ``wbgt_obs_c`` are the
observations whatever the forecast, ``has_joint_obs`` and ``wbgt_obs_reject`` say which of them are scored, and
``ref_*`` (lead-0 radiation and pressure) are the inputs of the truth WBGT. They are exported, never computed on.
"""

_WORKING_HOURS: Final = range(6, 15)  # UTC 06-14
_RELIABILITY_MODELS: Final = ("corrector", "b2d")
_QUOTED_EVENT_C: Final = 32.0
_QUOTED_BIN_LO: Final = 0.65
_RAW_MODELS: Final = (NwpModel.ECMWF_IFS025.value, NwpModel.ECMWF_AIFS025.value, NwpModel.GFS_SEAMLESS.value)
_PARQUET_LEVEL: Final = 19
_N_LEVELS: Final = len(LEVELS)


# === reliability =====================================================================================================


def reliability_payload(
    keys: pl.DataFrame, truth_wbgt: F64, grids: Mapping[str, F64], *, edges: tuple[float, ...] | None = None
) -> dict[str, JsonValue]:
    """The reliability tables of WBGT >= 30 and >= 32 at lead 1, UTC hours 06-14, pooled over every station of ``keys``.

    Args:
        keys: The rows' ``lead_days`` and ``hour_utc`` (aligned with ``truth_wbgt`` and the grids).
        truth_wbgt: The WBGT truth per row, NaN where unscored.
        grids: Model name (``corrector``, ``b2d``) to its ``(n, 19)`` WBGT value grid, NaN where missing.
        edges: The bin edges (default ``PREREGISTERED_RELIABILITY_EDGES``).

    Returns:
        ``selection`` (what was pooled), ``events`` (per threshold: rows, observed events and one table per model) and
        ``quoted_bin`` (the corrector's 0.65-0.75 bin of the >= 32 event: its count, mean probability, observed
        frequency and whether it is hollow; the report quotes ``obs_freq`` only when ``hollow`` is false).

    Raises:
        ValueError: A model of ``_RELIABILITY_MODELS`` has no grid.
    """
    use_edges = metrics.PREREGISTERED_RELIABILITY_EDGES if edges is None else edges
    absent = [name for name in _RELIABILITY_MODELS if name not in grids]
    if absent:
        raise ValueError(f"reliability needs the grids of {list(_RELIABILITY_MODELS)}, missing {absent}")
    chosen = (
        keys.select(((pl.col("lead_days") == 1) & pl.col("hour_utc").is_in(list(_WORKING_HOURS))).alias("m"))
        .to_series()
        .to_numpy()
    )
    usable = chosen & np.isfinite(truth_wbgt)
    for name in _RELIABILITY_MODELS:
        usable &= np.isfinite(grids[name]).all(axis=1)
    where = np.flatnonzero(usable)
    observed = np.asarray(truth_wbgt[where], dtype=np.float64)
    events: dict[str, JsonValue] = {}
    tables: dict[tuple[float, str], pl.DataFrame] = {}
    for threshold in RELIABILITY_EVENTS_C:
        happened = observed >= threshold
        per_model: dict[str, JsonValue] = {}
        for name in _RELIABILITY_MODELS:
            probability = exceedance_probability(grids[name][where], threshold)
            table = metrics.reliability_bins(probability, happened, edges=use_edges, min_count=RELIABILITY_MIN_COUNT)
            tables[(threshold, name)] = table
            per_model[name] = table_payload(table)
        events[f"{threshold:.0f}"] = {
            "n_rows": int(where.size),
            "n_events": int(happened.sum()),
            "models": per_model,
        }
    quoted = tables[(_QUOTED_EVENT_C, "corrector")]
    row = quoted.filter((pl.col("bin_lo") - _QUOTED_BIN_LO).abs() < 1e-9).to_dicts()
    cell = row[0] if row else {}
    return {
        "selection": {
            "lead_days": 1,
            "hours_utc": [_WORKING_HOURS.start, _WORKING_HOURS.stop - 1],
            "min_count": RELIABILITY_MIN_COUNT,
            "edges": list(use_edges),
            "pooled_over": "every station of the regime",
        },
        "events": events,
        "quoted_bin": {
            "event_wbgt_ge_c": _QUOTED_EVENT_C,
            "model": "corrector",
            "bin_lo": _QUOTED_BIN_LO,
            "n": None if not cell else int(cell["n"]),
            "mean_p": None if not cell or cell["mean_p"] is None else float(cell["mean_p"]),
            "obs_freq": None if not cell or cell["obs_freq"] is None else float(cell["obs_freq"]),
            "hollow": True if not cell else bool(cell["hollow"]),
        },
    }


# === raw model comparison ============================================================================================


def _raw_rows(pairs: pl.DataFrame, target: Target) -> pl.DataFrame:
    """The scored (station, hour, lead, model) rows of one target as ``summer``, ``valid_date``, ``model``, ``error``.

    ``error`` is forecast minus truth. T, Td and wind need ``has_joint_obs``; WBGT needs both rejection codes at 0 (the
    scored-row rule of pre-registration 2.1); in each case the forecast and the truth must be finite.
    """
    forecast, truth = FORECAST_COLUMN[target], TRUTH_COLUMN[target]
    if target is Target.WBGT:
        valid = (pl.col("wbgt_fc_reject") == 0) & (pl.col("wbgt_obs_reject") == 0)
    else:
        valid = pl.col("has_joint_obs")
    return (
        pairs.filter(
            pl.col("model").is_in(list(_RAW_MODELS))
            & pl.col("summer").is_in(list(RAW_COMPARISON_SUMMERS))
            & pl.col("lead_days").is_in(list(RAW_COMPARISON_LEADS))
            & valid
            & pl.col(forecast).is_finite()
            & pl.col(truth).is_finite()
        )
        .with_columns(
            pl.col("valid_time").dt.date().alias("valid_date"), (pl.col(forecast) - pl.col(truth)).alias("error")
        )
        .select("station", "valid_time", "valid_date", "summer", "lead_days", "model", "error")
    )


def raw_comparison(pairs: pl.DataFrame) -> pl.DataFrame:
    """Raw IFS, AIFS and GFS MAE and bias by target, summer (2025, 2026) and lead (1-3), on commonly scored rows.

    ``n_rows`` and ``n_days`` count the rows (and distinct UTC dates) where every model that appears in ``pairs`` has a
    finite forecast and the truth is scored, so the models are compared on the same station-hours; ``n_rows_own``
    counts each model's own scored rows (AIFS has fewer). ``bias`` is forecast minus truth. A model absent from
    ``pairs`` is absent from the table (nothing is filled). "Every model that appears" is judged per target, summer and
    lead: a model that has no row at one lead (AIFS at lead 3, say) does not remove the other models' common rows there.

    Args:
        pairs: Gold-shaped rows of the three models (``load_test_pairs(..., models=...)`` with AIFS).

    Returns:
        Columns ``target``, ``summer``, ``lead_days``, ``model``, ``n_rows``, ``n_days``, ``mae``, ``bias``,
        ``n_rows_own``.
    """
    parts: list[pl.DataFrame] = []
    key = ["station", "valid_time", "lead_days"]
    for target in Target:
        rows = _raw_rows(pairs, target)
        if rows.is_empty():
            continue
        # The models present are counted per (summer, lead): a model missing one lead must not empty the others.
        present = pl.col("model").n_unique().over("summer", "lead_days")
        common = rows.filter(pl.len().over(key) == present)
        own = rows.group_by("summer", "lead_days", "model").agg(pl.len().cast(pl.Int64).alias("n_rows_own"))
        scored = (
            common.group_by("summer", "lead_days", "model")
            .agg(
                pl.len().cast(pl.Int64).alias("n_rows"),
                pl.col("valid_date").n_unique().cast(pl.Int64).alias("n_days"),
                pl.col("error").abs().mean().alias("mae"),
                pl.col("error").mean().alias("bias"),
            )
            .join(own, on=["summer", "lead_days", "model"], how="full", coalesce=True)
            .with_columns(
                pl.lit(target.value).alias("target"), pl.col("n_rows").fill_null(0), pl.col("n_days").fill_null(0)
            )
        )
        parts.append(scored)
    if not parts:
        return pl.DataFrame(
            schema={
                "target": pl.String(),
                "summer": pl.Int16(),
                "lead_days": pl.Int8(),
                "model": pl.String(),
                "n_rows": pl.Int64(),
                "n_days": pl.Int64(),
                "mae": pl.Float64(),
                "bias": pl.Float64(),
                "n_rows_own": pl.Int64(),
            }
        )
    columns = ["target", "summer", "lead_days", "model", "n_rows", "n_days", "mae", "bias", "n_rows_own"]
    return pl.concat(parts).select(columns).sort("target", "summer", "lead_days", "model")


# === the corrected series ============================================================================================


def _array_column(grid: F64) -> pl.Series:
    """An ``(n, 19)`` grid as an ``Array(Float64, 19)`` column; a row that is not finite is null (never a number)."""
    finite = np.isfinite(grid).all(axis=1)
    rows: list[list[float] | None] = [row.tolist() if ok else None for row, ok in zip(grid, finite, strict=True)]
    return pl.Series(rows, dtype=pl.Array(pl.Float64, _N_LEVELS))


def _nullable(values: NDArray[np.float64]) -> pl.Series:
    return pl.Series(values, dtype=pl.Float64).fill_nan(None)


def series_frame(
    keys: pl.DataFrame,
    grids: Mapping[Target, F64],
    truths: Mapping[Target, F64],
    *,
    station: str,
    summer: int,
    reference: pl.DataFrame,
) -> pl.DataFrame:
    """One station's rows of one summer with the corrected grids, the raw forecasts and the truths of the four targets.

    Columns: ``station``, ``cluster``, ``valid_time``, ``summer``, ``lead_days``, ``hour_utc``; ``raw_<target>`` and
    ``truth_<target>`` (null where missing or unscored); ``grid_<target>`` (the corrector's 19-level value grid as a
    fixed array, null for a row without a forecast); and the gold columns of ``SERIES_REFERENCE_COLUMNS`` (the
    observations whatever the forecast, the scored-row flags and the lead-0 reference radiation and pressure). Rows are
    sorted by valid time and lead.

    Args:
        keys: The out-of-fold keys (``OofPredictions.keys``).
        grids: Target to the ``(n, 19)`` corrected value grid aligned with ``keys``.
        truths: Target to the truth per row (``raw + error``), aligned with ``keys``.
        station: The station to export.
        summer: The summer to export.
        reference: The gold rows of ``keys``, row for row (the IFS rows of the test frame): ``station``, ``valid_time``,
            ``lead_days`` must equal ``keys``' and the ``SERIES_REFERENCE_COLUMNS`` must be present.

    Raises:
        ValueError: The station has no row in that summer, ``reference`` is not ``keys``' rows or lacks a column.
    """
    missing = [name for name in SERIES_REFERENCE_COLUMNS if name not in reference.columns]
    if missing:
        raise ValueError(f"reference lacks the column(s) {missing}")
    identity = ["station", "valid_time", "lead_days"]
    if reference.height != keys.height or not reference.select(identity).equals(keys.select(identity)):
        raise ValueError("reference is not the rows of keys, in order: the gold columns would be misaligned")
    selected = np.flatnonzero(
        keys.select(((pl.col("station") == station) & (pl.col("summer") == summer)).alias("m")).to_series().to_numpy()
    )
    if selected.size == 0:
        raise ValueError(f"no row of station {station} in summer {summer}")
    rows = keys[selected.tolist()]
    frame = rows.select("station", "cluster", "valid_time", "summer", "lead_days", "hour_utc")
    extra: list[pl.Series] = []
    for target in Target:
        raw = rows[f"raw_{target.value}"].cast(pl.Float64()).fill_null(float("nan")).to_numpy()
        extra.append(_nullable(raw).alias(f"raw_{target.value}"))
    for target in Target:
        extra.append(_nullable(np.asarray(truths[target][selected], dtype=np.float64)).alias(f"truth_{target.value}"))
    for target in Target:
        extra.append(_array_column(grids[target][selected]).alias(f"grid_{target.value}"))
    extra.extend(reference[selected.tolist()].get_column(name) for name in SERIES_REFERENCE_COLUMNS)
    return frame.with_columns(extra).sort("valid_time", "lead_days")


def series_parquet_bytes(frame: pl.DataFrame, provenance: Provenance) -> bytes:
    """The series as zstd parquet (fixed level, the provenance in the key-value metadata)."""
    metadata = json.dumps(provenance.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    buffer = io.BytesIO()
    frame.rechunk().write_parquet(
        buffer, compression="zstd", compression_level=_PARQUET_LEVEL, metadata={"provenance": metadata}
    )
    return buffer.getvalue()


def series_manifest(frame: pl.DataFrame, *, file: str, data: bytes, command: str, git_sha: str) -> dict[str, JsonValue]:
    """What a reader needs to check a regenerated series file: its name, rows, columns, SHA-256, command and commit."""
    columns: list[JsonValue] = [{"name": name, "dtype": str(dtype)} for name, dtype in frame.schema.items()]
    return {
        "file": file,
        "rows": frame.height,
        "columns": columns,
        "sha256": hashlib.sha256(data).hexdigest(),
        "command": command,
        "git_sha": git_sha,
    }
