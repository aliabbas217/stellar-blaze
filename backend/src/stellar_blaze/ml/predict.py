"""The offline corrected-forecast predictor: calibrated 19-level VALUE grids from a ``TrainedCorrector``.

``corrected_grids`` is the training-side twin of the serving adapter (``adapters.compute.lgbm_corrector`` plus its
composition): it turns ``build_features`` rows into the same grids ``train_corrector`` computed on its own calibration
rows, and the serving adapter is checked against it. It shares the recipe with ``train_corrector`` through
``ml.train.calibrated_value_grids``, ``joint_wbgt_value_grid`` and ``draw_joint_samples`` instead of copying it:

1. the booster ERROR grids of t, td and wind (``predict_grid``: sorted, truth minus forecast);
2. the conformal offsets of the row's ``<lead>|<block>`` stratum, then the raw forecast is added and wind is floored
   at 0 (``train.value_grid``): the calibrated VALUE grids;
3. WBGT per ``cfg.wbgt_method``: ``direct`` is the WBGT booster's error grid plus the WBGT offsets plus ``raw_wbgt``;
   ``joint`` draws ``cfg.n_joint_samples`` joint samples per stratum from that stratum's copula (the lead-pooled one
   for a stratum in ``copula_fallback``), runs Liljegren on them (``wbgt_joint_grid``; a row with fewer than half the
   samples finite is missing) and conformalises the result the way ``train_corrector`` fitted the offsets: error grid =
   grid minus ``raw_wbgt``, ``apply_offsets``, plus ``raw_wbgt``.

Missing input is never a number. A target's grid row is NaN when its ``raw_<target>`` is missing (a null forecast, a
rejected WBGT forecast); the joint WBGT grid and the joint samples of a row are NaN when any of t, td or wind is. A row
outside the modelled hours (null ``hour_block``) is NaN everywhere. A missing GFS value is only a missing feature
(LightGBM's missing branch), as in training.

Joint samples are drawn per stratum from one seeded generator, so a row's draws depend on its position inside its
stratum in the frame: the same frame gives the same samples, a different row subset or order gives different
(equally valid) draws. Feed the same rows in the same order when comparing two runs.
"""

from typing import Literal, overload

import numpy as np
import polars as pl
from numpy.typing import NDArray

from stellar_blaze.adapters.compute.lgbm_corrector import predict_grid
from stellar_blaze.domain.forecast.conformal import apply_offsets
from stellar_blaze.domain.forecast.features import Target
from stellar_blaze.domain.forecast.grid import F64, LEVELS
from stellar_blaze.ml.quantile_models import feature_matrix
from stellar_blaze.ml.train import (
    TrainedCorrector,
    calibrated_value_grids,
    draw_joint_samples,
    joint_wbgt_value_grid,
    stratum_codes,
    value_grid,
)

__all__ = ["corrected_grids"]

_N_LEVELS = len(LEVELS)
_JOINT = (Target.T, Target.TD, Target.WIND)


def _floats(frame: pl.DataFrame, name: str) -> F64:
    """A column as a float64 array, a null as NaN."""
    return frame[name].cast(pl.Float64()).fill_null(float("nan")).to_numpy().astype(np.float64, copy=False)


def _expand(compact: F64, rows: int, index: NDArray[np.int64] | None) -> F64:
    """``compact`` placed at ``index`` of an all-NaN array of ``rows`` rows (no copy when every row is modelled)."""
    if index is None:
        return compact
    full = np.full((rows, *compact.shape[1:]), np.nan, dtype=np.float64)
    full[index] = compact
    return full


@overload
def corrected_grids(
    trained: TrainedCorrector, rows: pl.DataFrame, *, joint_samples: Literal[False] = False
) -> dict[Target, F64]: ...


@overload
def corrected_grids(
    trained: TrainedCorrector, rows: pl.DataFrame, *, joint_samples: Literal[True]
) -> tuple[dict[Target, F64], F64]: ...


def corrected_grids(
    trained: TrainedCorrector, rows: pl.DataFrame, *, joint_samples: bool = False
) -> dict[Target, F64] | tuple[dict[Target, F64], F64]:
    """The calibrated ``(n, 19)`` VALUE grids of t, td, wind and WBGT of ``build_features`` rows (module docstring).

    Args:
        trained: The corrector.
        rows: A ``build_features`` frame (any feature set that holds ``trained.cfg.feature_set``'s columns), with
            ``raw_t``, ``raw_td``, ``raw_wind``, ``raw_wbgt``, ``lead_days``, ``hour_block`` and, for the joint WBGT,
            ``station``, ``valid_time``, ``fc_sw_wm2``, ``fc_direct_wm2`` and ``fc_pressure_hpa``. The leads must be in
            the trained strata.
        joint_samples: Also return the joint (t, td, wind) samples that the joint WBGT is made of.

    Returns:
        ``{Target: (n, 19) sorted grid}`` with NaN rows for missing input (module docstring); with
        ``joint_samples=True`` a pair of that dict and the ``(n, cfg.n_joint_samples, 3)`` samples in the order of
        ``(t, td, wind)`` (NaN rows where any grid is missing). Wind grids are floored at 0 exactly as
        ``train.value_grid``.

    Raises:
        ValueError: A column is missing.
        KeyError: A row's lead or hour-block has no conformal stratum in the trained model (no silent fallback).
    """
    cfg = trained.cfg
    needed = ["lead_days", "hour_block", *(f"raw_{target.value}" for target in Target)]
    absent = [name for name in needed if name not in rows.columns]
    if absent:
        raise ValueError(f"rows lacks the columns {absent}")
    total = rows.height
    modelled = rows["hour_block"].is_not_null()
    index: NDArray[np.int64] | None = None
    work = rows
    if not modelled.all():
        index = np.flatnonzero(modelled.to_numpy()).astype(np.int64)
        work = rows.filter(modelled)

    if work.height == 0:
        grids = {target: np.full((total, _N_LEVELS), np.nan) for target in Target}
        return (grids, np.full((total, cfg.n_joint_samples, 3), np.nan)) if joint_samples else grids

    x = feature_matrix(work, cfg.feature_set)
    lead = work["lead_days"].cast(pl.Int8()).to_numpy()
    block = work["hour_block"]
    raw = {target: _floats(work, f"raw_{target.value}") for target in Target}
    error_grids = {target: predict_grid(trained.boosters[target], x) for target in _JOINT}
    values = calibrated_value_grids(error_grids, raw, lead, block, trained.offsets)
    del error_grids

    codes = stratum_codes(lead, block)
    samples: F64 | None = None  # set on both branches below exactly when joint_samples is true
    if cfg.wbgt_method == "direct":
        error = predict_grid(trained.boosters[Target.WBGT], x)
        wbgt = value_grid(
            apply_offsets(error, lead, block, trained.offsets, Target.WBGT), raw[Target.WBGT], Target.WBGT
        )
        if joint_samples:
            samples = draw_joint_samples(values, trained.copulas, cfg, codes)
    else:
        if joint_samples:
            samples = np.full((work.height, cfg.n_joint_samples, 3), np.nan, dtype=np.float64)
        joint, _ = joint_wbgt_value_grid(work, values, trained.copulas, cfg, codes, samples_out=samples)
        error = joint - raw[Target.WBGT][:, None]
        wbgt = value_grid(
            apply_offsets(error, lead, block, trained.offsets, Target.WBGT), raw[Target.WBGT], Target.WBGT
        )

    compact = {**values, Target.WBGT: wbgt}
    grids = {target: _expand(compact[target], total, index) for target in Target}
    if samples is None:
        return grids
    return grids, _expand(samples, total, index)
