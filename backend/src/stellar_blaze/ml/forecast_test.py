"""The gated 2026 forecast row (pre-registration 2.4, 5, 7.1, 8): ``evaluate_forecast_test``.

It scores the 2026 summer once, after the gate has opened, for the regimes of section 2.4:

* **(a) known sites, new summer.** The RELEASED model, read from its directory and run through the serving path
  (``ml.serving_path``), on every station of 2026. The baselines B0, B0d, B2d, B3d and B4 are fitted on 2024-2025 per
  station (``evaluate.evaluate_with_predictor``).
* **(c) new cluster, new summer.** Six ``cold`` models, each refit on the other five clusters of 2024-2025
  (``train_corrector`` through ``evaluate.evaluate_folds``) and tested on the held-out cluster in 2026, with the pooled
  baselines of the training stations.
* **(b-all)** is not built: the pre-registration allows reporting it as ``"not run"`` and this function does.

Both regimes go through the same skill tables as the development run (``exporters.dev_skill_payload``): every variable
by lead {1, 2, 3, 5, 7} by hour-block {early, peak, late, working}, with CRPS, MAE, RMSE, bias, pinball, interval
scores, coverage, PIT counts, Brier and BSS for WBGT >= 28/30/32 against the base rate and B2d, per-cluster and
per-station tables, and the paired 7-day-block bootstrap intervals (B = 2,000, seed 20261112) against each baseline.
Coverage by forecast-WBGT tercile uses the STORED development edges: they come in as ``dev_tercile_edges`` and are never
derived from a 2026 forecast. The reliability data and the raw IFS vs AIFS vs GFS comparison
(``ml.forecast_tables``) and the OMAA corrected series of regime (a) come out with it.

This module never reads a file and never opens the gate: the caller holds the ``GateToken`` and the loaded frame, and
the function only checks them (the token is the real kind, for the forecast part, and its lock names the released
model). A missing forecast or truth is out of the scores and counted; nothing is imputed.
"""

import hashlib
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import polars as pl
import structlog
from pydantic import JsonValue

from stellar_blaze.domain.config.models import LoadedModel
from stellar_blaze.domain.forecast.features import FeatureSet, FoldStats, Target, fit_fold_stats
from stellar_blaze.domain.forecast.grid import F64
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.ml.bootstrap import DEFAULT_SEED
from stellar_blaze.ml.conformal import CalibrationWindow, calibration_mask, fit_mask
from stellar_blaze.ml.data import DEV_SUMMERS, TEST_SUMMER
from stellar_blaze.ml.evaluate import (
    BRIER_THRESHOLDS_C,
    CORRECTOR,
    OofPredictions,
    evaluate_folds,
    evaluate_with_predictor,
    truth,
)
from stellar_blaze.ml.exporters import dev_skill_payload, table_payload
from stellar_blaze.ml.forecast_tables import raw_comparison, reliability_payload, series_frame
from stellar_blaze.ml.protocol_gate import GateToken, Part
from stellar_blaze.ml.regimes import CLUSTERS, regime_c_folds
from stellar_blaze.ml.serving_path import correct_with_released_model, released_training_config
from stellar_blaze.ml.training_config import TrainingConfig

__all__ = ["B_ALL_NOT_RUN", "ForecastTestResult", "cold_config_sha256", "evaluate_forecast_test"]

_log = structlog.get_logger(__name__)

B_ALL_NOT_RUN: Final = "not run"
"""How regime (b-all) is reported: pre-registration 2.4 allows "not run" when it was not built by 14 Nov 23:00 GST."""

_IFS: Final = NwpModel.ECMWF_IFS025.value
_GFS: Final = NwpModel.GFS_SEAMLESS.value
_RELEASED_FOLD: Final = "a_released"
_KEY: Final = ["station", "valid_time", "lead_days"]


@dataclass(frozen=True, eq=False)
class ForecastTestResult:
    """What ``evaluate_forecast_test`` computed (JSON-native tables and the OMAA series frame).

    Attributes:
        skill: The content of ``forecast_skill.json`` (without its provenance block).
        reliability: The content of ``reliability.json`` (without its provenance block).
        series: The corrected series of regime (a) for the series station and the test summer (parquet).
    """

    skill: dict[str, JsonValue]
    reliability: dict[str, JsonValue]
    series: pl.DataFrame


def cold_config_sha256(cfg: TrainingConfig) -> str:
    """SHA-256 of a derived (regime (c)) config's canonical JSON: it has no file, so no file hash."""
    return hashlib.sha256(cfg.model_dump_json().encode("utf-8")).hexdigest()


def _checked_edges(edges: tuple[float, float]) -> tuple[float, float]:
    low, high = edges
    if not (math.isfinite(low) and math.isfinite(high) and low < high):
        raise ValueError(f"dev_tercile_edges must be two finite ascending numbers, got {edges!r}")
    return float(low), float(high)


def _check_gate(token: GateToken, model: LoadedModel) -> None:
    if type(token) is not GateToken:
        raise TypeError(f"token must be a GateToken from the gate, got {type(token).__name__}")
    if token.part is not Part.FORECAST:
        raise ValueError(f"the forecast row needs the token of the forecast part, got {token.part.value!r}")
    if token.lock.model_id != model.manifest.model_id:
        raise ValueError(
            f"the model {model.manifest.model_id} is not the one the lock names ({token.lock.model_id}): "
            "only the released model is scored"
        )


def _split_summers(core: pl.DataFrame) -> tuple[pl.DataFrame, pl.DataFrame]:
    """The 2024-2025 rows and the 2026 rows of the IFS and GFS frame; any other summer is refused."""
    summers = {int(summer) for summer in core["summer"].unique().to_list()}
    stray = sorted(summers - DEV_SUMMERS - {TEST_SUMMER})
    if stray or TEST_SUMMER not in summers or not summers & DEV_SUMMERS:
        raise ValueError(
            f"the frame must hold the test summer {TEST_SUMMER} and a development summer {sorted(DEV_SUMMERS)}, "
            f"it holds {sorted(summers)}"
        )
    return (
        core.filter(pl.col("summer").is_in(sorted(DEV_SUMMERS))),
        core.filter(pl.col("summer") == TEST_SUMMER),
    )


def _check_leads(core: pl.DataFrame, cfg: TrainingConfig) -> None:
    stray = sorted(set(core.filter(pl.col("model") == _IFS)["lead_days"].unique().to_list()) - set(cfg.leads))
    if stray:
        raise ValueError(
            f"the IFS rows hold lead(s) {stray} outside the config's leads {cfg.leads} (lead 0 is never used)"
        )


def _fold_stats(dev: pl.DataFrame, window: CalibrationWindow) -> FoldStats:
    """The climatology of the training rows of the released model: the fit and calibration rows of 2024-2025."""
    calendar = dev.select(pl.col("valid_time").dt.date().alias("valid_date"), pl.col("summer"))
    return fit_fold_stats(dev.filter(fit_mask(calendar, window) | calibration_mask(calendar, window)))


def _same_rows(served: pl.DataFrame, features: pl.DataFrame) -> None:
    """The IFS rows the serving path corrects are the rows the baselines and the truths are built for, in order."""
    if served.height != features.height or not served.select(_KEY).equals(features.select(_KEY)):
        raise RuntimeError("the serving path's rows are not the feature frame's rows: the grids would be misaligned")


def _regime_payload(
    oof: OofPredictions, cfg: TrainingConfig, *, counts: dict[str, int], n_boot: int, label: str, model_id: str | None
) -> dict[str, JsonValue]:
    payload = dev_skill_payload(oof, cfg=cfg, summer_split=None, counts=counts, n_boot=n_boot)
    payload.pop("summer_split")  # the development-only R23 diagnostic has no meaning here
    payload["description"] = label
    payload["model_id"] = model_id
    return payload


def _reliability(oof: OofPredictions) -> dict[str, JsonValue]:
    return reliability_payload(
        oof.keys,
        truth(oof, Target.WBGT),
        {name: oof.grids[(Target.WBGT, name)] for name in (CORRECTOR, "b2d")},
    )


def evaluate_forecast_test(
    pairs: pl.DataFrame,
    *,
    model: LoadedModel,
    cold_cfg: TrainingConfig,
    token: GateToken,
    dev_tercile_edges: tuple[float, float],
    clusters: Sequence[str] | None = None,
    series_station: str = "OMAA",
    n_boot: int = 2000,
) -> ForecastTestResult:
    """Score the forecast row of 2026 (module docstring): regimes (a) and (c), the reliability data, the OMAA series.

    Args:
        pairs: The gold rows 2024-2026 that ``load_test_pairs`` returned (IFS, GFS and, for the raw comparison, AIFS),
            leads 1-7, UTC hours 02-15.
        model: The released model (``scan_models`` verified it); it must be the one the token's lock names.
        cold_cfg: The config of the six regime (c) models (the released config with the ``cold`` feature set:
            ``serving_path.cold_config``).
        token: The gate token of the forecast part.
        dev_tercile_edges: The two forecast-WBGT tercile edges stored by the development run
            (``artifacts/eval/dev/dev_skill.json``, key ``tercile_edges``). 2026 forecasts never define them.
        clusters: The clusters regime (c) holds out (default all six; each must have 2026 rows).
        series_station: The station of the corrected-series export.
        n_boot: Bootstrap replicates (the pre-registered 2,000; a test passes fewer).

    Returns:
        The tables and the series.

    Raises:
        TypeError: ``token`` is not a real ``GateToken``.
        ValueError: The token is not the forecast part's, its lock names another model, the frame does not hold 2026
            and a development summer (or holds another summer), a lead is outside the config's leads, the cold config
            is not ``cold``, the edges are not two ascending finite numbers, or a cluster is unknown.
    """
    _check_gate(token, model)
    edges = _checked_edges(dev_tercile_edges)
    if cold_cfg.feature_set is not FeatureSet.COLD:
        raise ValueError(f"cold_cfg must use the cold feature set, got {cold_cfg.feature_set.value!r}")
    wanted = tuple(CLUSTERS if clusters is None else clusters)
    unknown = sorted(set(wanted) - set(CLUSTERS))
    if unknown:
        raise ValueError(f"unknown cluster(s) {unknown}; the clusters are {list(CLUSTERS)}")
    released_cfg, _ = released_training_config(model)
    core = pairs.filter(pl.col("model").is_in([_IFS, _GFS]))
    dev, test = _split_summers(core)
    _check_leads(core, released_cfg)
    _check_leads(core, cold_cfg)
    _log.info("forecast_test.start", model_id=model.manifest.model_id, dev_rows=dev.height, test_rows=test.height)

    statuses: dict[str, int] = {}

    def serve(features: pl.DataFrame) -> dict[Target, F64]:
        served = correct_with_released_model(model, test)
        _same_rows(test.filter(pl.col("model") == _IFS), features)
        statuses.update(served.statuses)
        return dict(served.grids)

    oof_a = evaluate_with_predictor(
        dev,
        test,
        fold_name=_RELEASED_FOLD,
        window=released_cfg.calibration_window,
        stats=_fold_stats(dev, released_cfg.calibration_window),
        predict=serve,
        tercile_edges=edges,
    )
    counts = {"dev_rows": dev.height, "test_rows": test.height}
    regime_a = _regime_payload(
        oof_a,
        released_cfg,
        counts=counts,
        n_boot=n_boot,
        label="known sites, new summer: the released model through the serving path",
        model_id=model.manifest.model_id,
    )
    reliability_a = _reliability(oof_a)
    series = series_frame(
        oof_a.keys,
        {target: oof_a.grids[(target, CORRECTOR)] for target in Target},
        {target: truth(oof_a, target) for target in Target},
        station=series_station,
        summer=TEST_SUMMER,
    )
    del oof_a

    folds = [fold for fold in regime_c_folds() if next(iter(fold.test_clusters)) in wanted]
    oof_c = evaluate_folds(core, folds, cold_cfg, cfg_sha256=cold_config_sha256(cold_cfg), tercile_edges=edges)
    regime_c = _regime_payload(
        oof_c,
        cold_cfg,
        counts=counts,
        n_boot=n_boot,
        label="new cluster, new summer: six cold models, each refit without the held-out cluster",
        model_id=None,
    )
    reliability_c = _reliability(oof_c)
    del oof_c

    skill: dict[str, JsonValue] = {
        "part": Part.FORECAST.value,
        "model_id": model.manifest.model_id,
        "regimes": {"a": regime_a, "c": regime_c, "b_all": B_ALL_NOT_RUN},
        "tercile_edges": [edges[0], edges[1]],
        "tercile_edges_source": "artifacts/eval/dev/dev_skill.json (key tercile_edges), 2024-2025 forecasts only",
        "serving_statuses": dict(statuses),
        "bootstrap": {"block_days": 7, "n_boot": n_boot, "seed": DEFAULT_SEED, "interval": "95% percentile"},
        "brier_thresholds_c": list(BRIER_THRESHOLDS_C),
        "baselines": {
            "b0": "built",
            "b0d": "built",
            "b2d": "built",
            "b3d": "built (t, td, wind; WBGT has no bias7)",
            "b4": "built",
        },
        "raw_comparison": table_payload(raw_comparison(pairs)),
    }
    reliability: dict[str, JsonValue] = {
        "regimes": {"a": reliability_a, "c": reliability_c, "b_all": B_ALL_NOT_RUN},
        "tercile_edges": [edges[0], edges[1]],
    }
    return ForecastTestResult(skill=skill, reliability=reliability, series=series)
