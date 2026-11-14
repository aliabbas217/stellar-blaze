"""The released model on gold-shaped rows, through the SERVING path (pre-registration 2.4, regime (a)).

Regime (a) scores the model that ships, not a refit: its boosters, conformal offsets, copulas and fold statistics are
read from the model directory by ``LightGbmCorrector.load`` (after ``scan_models`` verified every hash) and every row is
corrected by ``LightGbmCorrector.correct``, the same code the API calls. This module turns gold rows into the frames
``correct`` takes (``FORECAST_SCHEMA`` forecasts, an ``OBS_HOURLY_SCHEMA`` history and, for a ``site`` model, the past
lead-1 IFS forecasts) and puts the answers back as ``(n, 19)`` grids aligned with the IFS rows.

Chunks. Rows are corrected in chunks of one station and one UTC month: the joint WBGT draws are made per batch (see
``adapters.compute.lgbm_corrector``), so chunking bounds memory and the cost of the WBGT solver, and the same chunks
in the same order always give the same numbers. The history of a chunk is the station's whole season of lead-1
forecasts and observations: the feature builder reads, for a row of valid date D and lead L, only the UTC dates
D - L - 7 to D - L - 1 (L3), so handing it later days cannot leak them (a test perturbs the future and checks).

A row that the serving path cannot correct (a null IFS value, ``missing_input``) comes back as NaN, never filled; the
counts per variable and status are returned so the report can state them.
"""

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy as np
import polars as pl
import structlog

from stellar_blaze.adapters.compute.lgbm_corrector import LightGbmCorrector
from stellar_blaze.adapters.config.models import scan_models
from stellar_blaze.domain.config.models import LoadedModel
from stellar_blaze.domain.forecast.features import FeatureSet, Target
from stellar_blaze.domain.forecast.grid import F64, LEVELS
from stellar_blaze.domain.forecast.schemas import VARIABLES, quantile_matrix
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, OBS_HOURLY_SCHEMA
from stellar_blaze.ml.training_config import TrainingConfig

__all__ = [
    "ServedGrids",
    "cold_config",
    "correct_with_released_model",
    "load_released_model",
    "released_training_config",
]

_log = structlog.get_logger(__name__)

_IFS: Final = NwpModel.ECMWF_IFS025.value
_GFS: Final = NwpModel.GFS_SEAMLESS.value
_FORECAST_COLUMNS: Final = {
    "t_c": "fc_t_c",
    "td_c": "fc_td_c",
    "wind_ms": "fc_wind_ms",
    "sw_wm2": "fc_sw_wm2",
    "direct_wm2": "fc_direct_wm2",
    "pressure_hpa": "fc_pressure_hpa",
    "grid_lat": "grid_lat",
    "grid_lon": "grid_lon",
    "grid_elev_m": "grid_elev_m",
}
_OBSERVATION_COLUMNS: Final = {"t_c": "obs_t_c", "td_c": "obs_td_c", "wind_ms": "obs_wind_ms"}


@dataclass(frozen=True, eq=False)
class ServedGrids:
    """What the serving path made of a set of IFS rows.

    Attributes:
        grids: Target to the ``(n, 19)`` calibrated VALUE grid aligned with the IFS rows given, NaN where the corrector
            returned no grid.
        statuses: ``"<variable>:<status>"`` to the number of rows with that status (``ok``, ``missing_input``,
            ``uncorrected``), for every variable.
    """

    grids: dict[Target, F64]
    statuses: dict[str, int]


def load_released_model(models_dir: Path, model_id: str) -> LoadedModel:
    """The model ``model_id`` of ``models_dir``, every file hash-verified (``scan_models``).

    Raises:
        stellar_blaze.adapters.config.models.ModelIntegrityError: A model directory does not verify.
        KeyError: No such model; the message names the known ids.
    """
    return scan_models(models_dir).get(model_id)


def released_training_config(model: LoadedModel) -> tuple[TrainingConfig, str]:
    """The resolved training config of a released model and the hash of its file, from the model's ``params.json``.

    Raises:
        FileNotFoundError: The model has no ``params.json``.
        ValueError: ``params.json`` lacks the config or its hash.
        pydantic.ValidationError: The config is not a ``TrainingConfig``.
    """
    params = json.loads((model.root / "params.json").read_bytes())
    config, digest = params.get("config"), params.get("config_sha256")
    if not isinstance(config, dict) or not isinstance(digest, str):
        raise ValueError(f"{model.manifest.model_id}: params.json holds no 'config' and 'config_sha256'")
    return TrainingConfig.model_validate(config), digest


def cold_config(cfg: TrainingConfig) -> TrainingConfig:
    """``cfg`` with the ``cold`` feature set (regime (c) models see no station history, pre-registration 2.4)."""
    return cfg.model_copy(update={"feature_set": FeatureSet.COLD, "name": f"{cfg.name}-cold"})


def _forecast_frame(rows: pl.DataFrame) -> pl.DataFrame:
    """Gold rows as ``FORECAST_SCHEMA`` forecast rows."""
    return rows.select(
        "station",
        "model",
        "valid_time",
        "lead_days",
        *[pl.col(source).alias(name) for name, source in _FORECAST_COLUMNS.items()],
    ).select(list(FORECAST_SCHEMA))


def _observed_frame(rows: pl.DataFrame) -> pl.DataFrame:
    """The truth of gold rows as ``OBS_HOURLY_SCHEMA`` rows, one per station and valid time; a gap stays null."""
    return (
        rows.select(
            "station",
            "valid_time",
            *[pl.col(source).alias(name) for name, source in _OBSERVATION_COLUMNS.items()],
            pl.lit("iem").alias("source"),
        )
        .unique(subset=["station", "valid_time"], keep="first", maintain_order=True)
        .select(list(OBS_HOURLY_SCHEMA))
    )


def correct_with_released_model(model: LoadedModel, rows: pl.DataFrame) -> ServedGrids:
    """Correct every IFS row of ``rows`` with ``LightGbmCorrector.correct`` (the module docstring has the recipe).

    Args:
        model: The released model (its directory is trusted: ``scan_models`` verified it).
        rows: Gold-shaped IFS and GFS rows (leads 1-7, UTC hours 02-15) with the truth columns ``obs_t_c``,
            ``obs_td_c`` and ``obs_wind_ms``, used only as station history of days before the issue day.

    Returns:
        The grids of t, td, wind and wbgt for the IFS rows in the order they have in ``rows``, and the status counts.

    Raises:
        ValueError: ``rows`` holds no IFS row, or the corrector's answer does not have four rows per input row.
    """
    corrector = LightGbmCorrector.load(model)
    ifs = rows.filter(pl.col("model") == _IFS)
    gfs = rows.filter(pl.col("model") == _GFS)
    if ifs.is_empty():
        raise ValueError("rows holds no IFS row to correct")
    lead_one = ifs.filter(pl.col("lead_days") == 1)
    n_levels = len(LEVELS)
    grids = {target: np.full((ifs.height, n_levels), np.nan, dtype=np.float64) for target in Target}
    counts: Counter[str] = Counter()
    chunks = (
        ifs.with_row_index("_i")
        .group_by("station", pl.col("valid_time").dt.month().alias("_month"), maintain_order=True)
        .agg("_i")
    )
    for station, month, positions in chunks.iter_rows():
        here = np.asarray(positions, dtype=np.int64)
        chunk = ifs[here]
        backup = gfs.filter((pl.col("station") == station) & (pl.col("valid_time").dt.month() == month))
        season = lead_one.filter(pl.col("station") == station)
        answer = corrector.correct(
            ifs=_forecast_frame(chunk),
            gfs=_forecast_frame(backup),
            history=_observed_frame(season),
            history_ifs=_forecast_frame(season) if corrector.needs_history_forecasts else None,
        )
        for variable in VARIABLES:
            target = Target(variable)
            part = answer.filter(pl.col("variable") == variable)
            if part.height != chunk.height:
                raise ValueError(
                    f"the corrector returned {part.height} {variable} rows for {chunk.height} input rows "
                    f"({station}, month {month})"
                )
            grids[target][here] = quantile_matrix(part)
            counts.update(f"{variable}:{status}" for status in part["status"].to_list())
        _log.info("serving_path.chunk", station=station, month=month, rows=chunk.height)
    return ServedGrids(grids, dict(sorted(counts.items())))
