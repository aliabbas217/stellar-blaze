"""Scoring frames for the scoreboards, from the 2025 out-of-fold export or (behind the gate) from the 2026 series.

Both builders return a ``ScoringInputs`` whose ``rows`` follow the scoring frame documented in
``ml.scoreboards`` and are made with the product's own TWL functions (``ml.twl_rows``: ``twl_sample_matrix``,
``effective_twl``, ``ZoneEdges``).

* ``dev_inputs``: the abu_dhabi OOF samples (lead 1, UTC 06-14, 2024-2025; ``--summer`` picks one). There is no
  corrected WBGT grid in it (the demo day's corrected WBGT is computed from the samples) and no
  ``wbgt_obs_reject``.
* ``inputs_2026``: the OMAA rows of the forecast part's ``corrected_series_OMAA.parquet`` (19-level grids; no joint
  samples), the IFS radiation and pressure of the gold rows, and the joint samples drawn from the grids by the released
  model's sampler (``ForecastCorrector.sample(..., n_samples=50, seed=20261112)``) in ONE call over every row of the
  frame in series order: a row's draws depend on the other rows of its stratum in the call, so the single call, its
  order (valid time, then lead) and the seed are part of the definition (the Warnings and Plans parts make the same
  call and so see the same samples).

The truth is the observed T, Td and wind with the lead-0 radiation and pressure (assumption A2); a row without a fully
observed truth has a NaN truth TWL and is never scored, never imputed.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, time
from pathlib import Path
from typing import Final

import numpy as np
import polars as pl

from stellar_blaze.domain.config.runtime import EffectiveParams
from stellar_blaze.domain.forecast.schemas import CORRECTED_FORECAST_SCHEMA, QUANTILE_COLUMNS, CorrectionStatus
from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.physics.wbgt import wbgt_liljegren
from stellar_blaze.domain.plans.model import CrewSpec, ShiftBlock
from stellar_blaze.domain.risk.levels import Zone, ZoneEdges, protective_twl, zone_of
from stellar_blaze.domain.risk.twl_samples import effective_twl, withdrawal_limits
from stellar_blaze.domain.rules.ruleset import Ruleset
from stellar_blaze.domain.scoreboard import ThetaDecision
from stellar_blaze.domain.weather.stations import station as station_row
from stellar_blaze.ml.data import DEV_SUMMERS, TEST_SUMMER, HoldoutViolationError
from stellar_blaze.ml.selection import EXPORT_CLUSTER
from stellar_blaze.ml.twl_rows import forward_effective, raw_twl, truth_raw_twl
from stellar_blaze.ports.corrector import ForecastCorrector

__all__ = [
    "DEV_LABEL",
    "DEV_ROSTER_NOTE",
    "N_SAMPLES",
    "SAMPLE_SEED",
    "SCORING_LEADS",
    "ScoringInputs",
    "clip_crew_to_labels",
    "dev_inputs",
    "inputs_2026",
    "load_theta",
    "sha256_texts",
]

DEV_LABEL: Final = "DEV 2025, LOCO out-of-fold: not the result"
DEV_ROSTER_NOTE: Final = "L1 clipped to the labelled hours of the dev export (UTC 06-14): 10:00-11:00 + 15:00-18:00 GST"
N_SAMPLES: Final = 50
SAMPLE_SEED: Final = 20261112
SCORING_LEADS: Final[tuple[int, ...]] = (1, 2, 3, 5, 7)
_MODELLED_HOURS: Final = range(2, 16)
_LABELLED_LOCAL: Final = (time(10, 0), time(18, 0))  # UTC 06-14 in Asia/Dubai
_P05, _P50, _P95 = 0, 9, 18  # indexes of the 0.05, 0.50 and 0.95 levels in the 19-level grid
_STRICT_VARIABLES: Final = ("t", "td", "wind")


@dataclass(frozen=True)
class ScoringInputs:
    """The scoring frame (every lead), its demo-day helpers and whether ``wbgt_obs_reject`` is available."""

    rows: pl.DataFrame
    reject_available: bool
    wbgt: Callable[[date], pl.DataFrame]
    """The corrected WBGT ``p05``, ``p50``, ``p95`` per ``valid_time`` of one local date at lead 1."""

    def truth_frame(self) -> pl.DataFrame:
        """What ``select_demo_day`` may read: observations only (lead 1)."""
        columns = ["valid_time", "has_joint_obs", "truth_twl", "truth_t_c"]
        if self.reject_available:
            columns.append("wbgt_obs_reject")
        return self.rows.filter(pl.col("lead_days") == 1).select(columns)

    def present_frame(self) -> pl.DataFrame:
        """Whether every policy's lead-1 forecast input is present, per hour (no forecast value is passed on)."""
        return (
            self.rows.filter(pl.col("lead_days") == 1)
            .select(
                "valid_time",
                (pl.col("raw_wbgt_c").is_finite() & pl.col("raw_twl_eff").is_finite() & (pl.col("n_finite") > 0)).alias(
                    "present"
                ),
            )
            .with_columns(pl.col("present").fill_null(False))
        )


def _column(frame: pl.DataFrame, name: str) -> F64:
    return np.asarray(frame[name].cast(pl.Float64).fill_null(float("nan")).to_numpy(), dtype=np.float64)


def _scoring_rows(
    frame: pl.DataFrame,
    samples: F64,
    *,
    ruleset: Ruleset,
    params: EffectiveParams,
    raw_wbgt: F64,
    truth_wbgt: F64,
) -> pl.DataFrame:
    """The scoring frame of ``frame`` (one row per forecast) with its ``(rows, n, 3)`` joint ``samples``."""
    edges = ZoneEdges.from_ruleset(ruleset, params)
    effective = forward_effective(frame, samples, ruleset=ruleset, params=params)
    zones = zone_of(effective, edges)
    finite = zones >= 0
    raw_eff = effective_twl(
        raw_twl(frame, "raw_t", "raw_td", "raw_wind", "fc_sw_wm2", "fc_direct_wm2", "fc_pressure_hpa"),
        margin_w_m2=params.twl_margin_w_m2,
        withdrawal=withdrawal_limits(ruleset),
        t_c=_column(frame, "raw_t"),
        tnwb_c=None,
    )
    return pl.DataFrame(
        {
            "valid_time": frame["valid_time"],
            "lead_days": frame["lead_days"].cast(pl.Int64),
            "truth_twl": truth_raw_twl(frame),
            "truth_t_c": _column(frame, "obs_t_c"),
            "truth_wbgt_c": truth_wbgt,
            "raw_wbgt_c": raw_wbgt,
            "raw_twl_eff": raw_eff,
            "n_high": ((zones >= int(Zone.HIGH)) & finite).sum(axis=1).astype(np.float64),
            "n_finite": finite.sum(axis=1).astype(np.float64),
            "protective_twl": protective_twl(effective),
            "has_joint_obs": frame["has_joint_obs"].fill_null(False),
        }
    )


def _truth_wbgt(frame: pl.DataFrame, icao: str) -> F64:
    where = station_row(icao)
    result = wbgt_liljegren(
        t_c=_column(frame, "obs_t_c"),
        td_c=_column(frame, "obs_td_c"),
        wind10m_ms=_column(frame, "obs_wind_ms"),
        pressure_hpa=_column(frame, "ref_pressure_hpa"),
        sw_wm2=_column(frame, "ref_sw_wm2"),
        direct_wm2=_column(frame, "ref_direct_wm2"),
        lat=where.lat,
        lon=where.lon,
        valid_time_utc=np.asarray(frame["valid_time"].dt.replace_time_zone(None).to_numpy(), dtype="datetime64[us]"),
    )
    return np.where(frame["has_joint_obs"].fill_null(False).to_numpy(), result.wbgt_c, np.nan)


def dev_inputs(
    oof: pl.DataFrame, ruleset: Ruleset, params: EffectiveParams, *, summer: int, icao: str = "OMAA"
) -> ScoringInputs:
    """The scoring frame of one development summer of the OOF export (lead 1, UTC 06-14, ``icao`` only).

    Raises:
        HoldoutViolationError: ``summer`` is not a development summer, or the file holds a 2026 row.
        ValueError: No row is left.
    """
    years = set(oof["valid_time"].dt.year().unique().to_list()) | set(oof["summer"].unique().to_list())
    if TEST_SUMMER in years:
        raise HoldoutViolationError(f"the OOF holds summer {TEST_SUMMER}: the dev scoreboards use 2024-2025 only")
    if summer not in DEV_SUMMERS:
        raise HoldoutViolationError(f"summer {summer} is not a development summer {sorted(DEV_SUMMERS)}")
    frame = oof.filter(
        (pl.col("cluster") == EXPORT_CLUSTER)
        & (pl.col("station") == icao)
        & (pl.col("summer") == summer)
        & (pl.col("lead_days") == 1)
    ).sort("valid_time")
    if frame.is_empty():
        raise ValueError(f"no row of {icao} (cluster {EXPORT_CLUSTER}) at lead 1 in summer {summer}")
    samples = np.asarray(frame["samples"].to_numpy(), dtype=np.float64)
    rows = _scoring_rows(
        frame,
        samples,
        ruleset=ruleset,
        params=params,
        raw_wbgt=_column(frame, "wbgt_fc_c"),
        truth_wbgt=_truth_wbgt(frame, icao),
    )

    def wbgt(day: date) -> pl.DataFrame:
        chosen = np.flatnonzero((frame["valid_time"].dt.date() == day).to_numpy())
        part = frame[chosen.tolist()]
        n = part.height
        picked = samples[chosen]
        where = station_row(icao)
        result = wbgt_liljegren(
            t_c=picked[:, :, 0],
            td_c=np.minimum(picked[:, :, 1], picked[:, :, 0]),
            wind10m_ms=np.maximum(picked[:, :, 2], 0.0),
            pressure_hpa=np.repeat(_column(part, "fc_pressure_hpa")[:, None], N_SAMPLES, axis=1),
            sw_wm2=np.repeat(_column(part, "fc_sw_wm2")[:, None], N_SAMPLES, axis=1),
            direct_wm2=np.repeat(_column(part, "fc_direct_wm2")[:, None], N_SAMPLES, axis=1),
            lat=where.lat,
            lon=where.lon,
            valid_time_utc=np.repeat(
                np.asarray(part["valid_time"].dt.replace_time_zone(None).to_numpy(), dtype="datetime64[us]")[:, None],
                N_SAMPLES,
                axis=1,
            ),
        ).wbgt_c
        quantiles = np.full((n, 3), np.nan)
        for i in range(n):
            finite = result[i][np.isfinite(result[i])]
            if finite.size:
                quantiles[i] = np.quantile(finite, [0.05, 0.50, 0.95])
        return pl.DataFrame(
            {
                "valid_time": part["valid_time"],
                "p05": pl.Series(quantiles[:, 0]).fill_nan(None),
                "p50": pl.Series(quantiles[:, 1]).fill_nan(None),
                "p95": pl.Series(quantiles[:, 2]).fill_nan(None),
            }
        )

    return ScoringInputs(rows=rows, reject_available=False, wbgt=wbgt)


def _grid(series: pl.DataFrame, name: str) -> F64:
    """An ``Array(Float64, 19)`` column as ``(rows, 19)``; a null row is NaN."""
    nan_row = [float("nan")] * len(QUANTILE_COLUMNS)
    return np.asarray([row if row is not None else nan_row for row in series[name].to_list()], dtype=np.float64)


def _corrected_frame(series: pl.DataFrame) -> pl.DataFrame:
    """The ``CORRECTED_FORECAST_SCHEMA`` frame of the series' t, td and wind grids (variable blocks, series order)."""
    blocks = []
    for variable in _STRICT_VARIABLES:
        grid = _grid(series, f"grid_{variable}")
        ok = np.isfinite(grid).all(axis=1)
        columns = {
            name: pl.Series(grid[:, k], dtype=pl.Float64).fill_nan(None) for k, name in enumerate(QUANTILE_COLUMNS)
        }
        blocks.append(
            pl.DataFrame(
                {
                    "station": series["station"],
                    "valid_time": series["valid_time"],
                    "lead_days": series["lead_days"].cast(pl.Int8),
                    "variable": pl.Series([variable] * series.height, dtype=pl.String),
                    "raw": series[f"raw_{variable}"].cast(pl.Float64),
                    **columns,
                    "status": pl.Series(
                        [CorrectionStatus.OK.value if flag else CorrectionStatus.MISSING_INPUT.value for flag in ok],
                        dtype=pl.String,
                    ),
                    "model_id": pl.Series([None] * series.height, dtype=pl.String),
                }
            )
        )
    return pl.concat(blocks).select(list(CORRECTED_FORECAST_SCHEMA))


def inputs_2026(
    series: pl.DataFrame,
    radiation: pl.DataFrame,
    sampler: ForecastCorrector,
    ruleset: Ruleset,
    params: EffectiveParams,
    *,
    icao: str = "OMAA",
) -> ScoringInputs:
    """The scoring frame of the 2026 OMAA series (gated: the caller holds a token for the part).

    ``series`` is ``corrected_series_OMAA.parquet``; ``radiation`` has ``station``, ``valid_time``, ``lead_days``
    and the IFS ``fc_sw_wm2``, ``fc_direct_wm2``, ``fc_pressure_hpa`` of the same rows (the series does not
    carry them).

    Raises:
        ValueError: The series has no 2026 row of ``icao`` at the scored leads, or a row has no radiation row.
    """
    frame = (
        series.filter(
            (pl.col("station") == icao)
            & (pl.col("summer") == TEST_SUMMER)
            & pl.col("lead_days").is_in(list(SCORING_LEADS))
            & pl.col("valid_time").dt.hour().is_in(list(_MODELLED_HOURS))
        )
        .sort("valid_time", "lead_days")
        .join(
            radiation.select("station", "valid_time", "lead_days", "fc_sw_wm2", "fc_direct_wm2", "fc_pressure_hpa"),
            on=["station", "valid_time", "lead_days"],
            how="left",
            maintain_order="left",
            validate="1:1",
        )
    )
    if frame.is_empty():
        raise ValueError(f"the series has no {TEST_SUMMER} row of {icao} at leads {list(SCORING_LEADS)}")
    samples = sampler.sample(_corrected_frame(frame), n_samples=N_SAMPLES, seed=SAMPLE_SEED)
    if samples.shape[0] != frame.height:
        raise ValueError(f"the sampler returned {samples.shape[0]} rows for {frame.height} forecasts")
    rows = _scoring_rows(
        frame,
        np.asarray(samples, dtype=np.float64),
        ruleset=ruleset,
        params=params,
        raw_wbgt=_column(frame, "raw_wbgt"),
        truth_wbgt=_column(frame, "wbgt_obs_c"),
    ).with_columns(frame["wbgt_obs_reject"].alias("wbgt_obs_reject"))

    def wbgt(day: date) -> pl.DataFrame:
        part = frame.filter((pl.col("lead_days") == 1) & (pl.col("valid_time").dt.date() == day)).sort("valid_time")
        grid = _grid(part, "grid_wbgt")
        return pl.DataFrame(
            {
                "valid_time": part["valid_time"],
                "p05": pl.Series(grid[:, _P05], dtype=pl.Float64).fill_nan(None),
                "p50": pl.Series(grid[:, _P50], dtype=pl.Float64).fill_nan(None),
                "p95": pl.Series(grid[:, _P95], dtype=pl.Float64).fill_nan(None),
            }
        )

    return ScoringInputs(rows=rows, reject_available=True, wbgt=wbgt)


def clip_crew_to_labels(
    crew: CrewSpec, *, start: time = _LABELLED_LOCAL[0], end: time = _LABELLED_LOCAL[1]
) -> CrewSpec:
    """``crew`` with every shift block cut to ``[start, end]`` (the dev export's labelled hours); empty blocks go."""
    blocks = tuple(
        ShiftBlock(max(block.start, start), min(block.end, end))
        for block in crew.shift
        if max(block.start, start) < min(block.end, end)
    )
    return CrewSpec(
        crew_id=crew.crew_id,
        employer_id=crew.employer_id,
        workload=crew.workload,
        headcount=crew.headcount,
        shift=blocks,
        days_per_week=crew.days_per_week,
        members=crew.members,
    )


def load_theta(path: Path) -> ThetaDecision:
    """The frozen ``theta.json`` (written by ``sb-jobs freeze theta``, never read from the live config).

    Raises:
        OSError: The file cannot be read.
        ValueError: It is not a ``ThetaDecision``.
    """
    document = json.loads(path.read_bytes())
    return ThetaDecision.model_validate(document)


def sha256_texts(data: bytes) -> tuple[str, str]:
    """The SHA-256 of ``data`` as read and with CRLF read as LF (a text file checked out on Windows)."""
    import hashlib

    return hashlib.sha256(data).hexdigest(), hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest()
