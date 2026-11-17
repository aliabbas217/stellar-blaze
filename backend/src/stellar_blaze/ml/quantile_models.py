"""Train the 19 LightGBM quantile models of one target (pre-registration section 3.1).

One booster per level of ``grid.LEVELS``, each on the *error* of the forecast: ``y_<target>`` is truth minus forecast
(``features.build_features``). The corrected quantile is therefore ``raw + predicted error quantile``, and what
``adapters.compute.lgbm_corrector.predict_grid`` returns for these boosters is the grid of error quantiles.

LightGBM is driven through its native API (``lgb.train``), not the scikit-learn wrapper, so no feature-name check
exists to warn about a container change. Even so the matrix is the same everywhere: a float64 numpy array whose columns
are ``feature_columns(cfg.feature_set)`` in that order, with the names passed to the ``Dataset``.

Config name to native parameter name:

* ``min_child_samples`` -> ``min_data_in_leaf``
* ``n_estimators`` -> ``num_boost_round`` (an argument of ``lgb.train``, not a parameter)
* ``levels[i]`` -> ``alpha`` (the quantile) with ``objective="quantile"``

The other names are identical. ``deterministic=True``, ``force_row_wise=True`` and a fixed ``num_threads`` make a refit
byte-identical in one environment (LightGBM does not promise it across machines or versions); ``verbosity=-1`` keeps
the library quiet.
"""

from collections.abc import Sequence
from typing import Final

import lightgbm as lgb
import numpy as np
import polars as pl
import structlog

from stellar_blaze.domain.forecast.features import FeatureSet, Target, feature_columns
from stellar_blaze.domain.forecast.grid import F64, LEVELS
from stellar_blaze.ml.training_config import LgbmParams, TrainingConfig

__all__ = ["MIN_TRAIN_ROWS", "feature_matrix", "fit_quantile_models", "lgbm_native_params"]

MIN_TRAIN_ROWS: Final = 100
"""Default fewest scored rows a target may be trained on (a guard against a silently empty or filtered fold)."""

_log = structlog.get_logger(__name__)


def feature_matrix(rows: pl.DataFrame, feature_set: FeatureSet) -> F64:
    """The ``(n, n_features)`` float64 matrix of a feature frame, columns in ``feature_columns`` order.

    A null becomes NaN (LightGBM's missing value). Use this at fit and at predict so the layout cannot differ.

    Raises:
        ValueError: A feature column is missing from ``rows``.
    """
    columns = feature_columns(feature_set)
    missing = [name for name in columns if name not in rows.columns]
    if missing:
        raise ValueError(f"the frame lacks the {feature_set.value} feature columns {missing}")
    matrix = rows.select(pl.col(name).cast(pl.Float64()) for name in columns).to_numpy()
    return np.ascontiguousarray(matrix, dtype=np.float64)


def lgbm_native_params(params: LgbmParams, *, alpha: float) -> dict[str, float | int | bool | str]:
    """The native LightGBM parameters of one quantile level (see the module docstring for the name mapping)."""
    return {
        "objective": "quantile",
        "alpha": alpha,
        "num_leaves": params.num_leaves,
        "min_data_in_leaf": params.min_child_samples,
        "learning_rate": params.learning_rate,
        "feature_fraction": params.feature_fraction,
        "bagging_fraction": params.bagging_fraction,
        "bagging_freq": params.bagging_freq,
        "lambda_l2": params.lambda_l2,
        "seed": params.seed,
        "num_threads": params.num_threads,
        "deterministic": params.deterministic,
        "force_row_wise": True,
        "verbosity": -1,
    }


def _outside(scored: pl.DataFrame, column: str, allowed: Sequence[int]) -> list[int]:
    """The distinct values of ``column`` in ``scored`` that are not in ``allowed`` (sorted)."""
    return sorted(scored.filter(~pl.col(column).is_in(list(allowed)))[column].unique().to_list())


def _checked_levels(levels: Sequence[float] | None) -> tuple[float, ...]:
    """``LEVELS`` by default; otherwise the requested levels, each one of the 19 and none repeated."""
    if levels is None:
        return LEVELS
    chosen = tuple(levels)
    if not chosen or len(set(chosen)) != len(chosen):
        raise ValueError(f"levels must be a non-empty, duplicate-free subset of the 19 levels, got {chosen}")
    unknown = [level for level in chosen if not any(abs(level - known) < 1e-9 for known in LEVELS)]
    if unknown:
        raise ValueError(f"levels {unknown} are not among the 19 pre-registered levels {LEVELS}")
    return chosen


def fit_quantile_models(
    rows: pl.DataFrame,
    *,
    target: Target,
    cfg: TrainingConfig,
    min_rows: int = MIN_TRAIN_ROWS,
    levels: Sequence[float] | None = None,
) -> tuple[lgb.Booster, ...]:
    """Fit one quantile booster per level on the error ``y_<target>`` (truth minus forecast).

    Rows whose ``y_<target>`` is not a finite number (null, NaN or infinite: no truth, a rejected WBGT, an hour
    outside 02-15 UTC) are excluded, and nothing is filled. Feature nulls stay as NaN. The 19 boosters come back in
    ``LEVELS`` order and must be used with ``predict_grid``, which returns *error* quantiles: the corrected value is
    ``raw + error quantile``.

    ``cfg.leads`` and ``cfg.hours_utc`` are part of the config hash and so of the model id, therefore they are
    enforced, not trusted: a row that would be trained on (one with a finite target) whose ``lead_days`` is not in
    ``cfg.leads`` or whose ``hour_utc`` is not in ``cfg.hours_utc`` raises instead of being dropped, so a model never
    differs from the config that names it. This also keeps lead 0 out of training (L2). Rows without a finite target
    are never trained on, so their lead and hour do not matter.

    Args:
        rows: A ``build_features`` frame holding ``lead_days``, ``hour_utc``, the ``cfg.feature_set`` columns and
            ``y_<target>``, already restricted by the caller to the fold's training rows.
        target: The corrected variable.
        cfg: The training config.
        min_rows: The fewest rows with a target that may remain.
        levels: Fit only these levels, in this order (each must be one of the 19; used by the cheap hyperparameter
            scoring of selection rule 6.1, which needs 0.1, 0.5 and 0.9). ``None`` is the 19 levels, which is what every
            released model uses; all the guards above apply either way.

    Returns:
        One booster per level: 19 in ``LEVELS`` order by default, ``levels[i]`` at index ``i`` otherwise.

    Raises:
        ValueError: A column is missing, a trained row lies outside ``cfg.leads`` or ``cfg.hours_utc``, fewer than
            ``min_rows`` rows have a target, or ``levels`` is empty, repeated or not a subset of the 19.
    """
    fitted_levels = _checked_levels(levels)
    label_name = f"y_{target.value}"
    missing = [name for name in (label_name, "lead_days", "hour_utc") if name not in rows.columns]
    if missing:
        raise ValueError(f"the frame lacks the required columns {missing}")
    scored = rows.filter(pl.col(label_name).cast(pl.Float64()).is_finite())
    for column, allowed in (("lead_days", cfg.leads), ("hour_utc", cfg.hours_utc)):
        stray = _outside(scored, column, allowed)
        if stray:
            raise ValueError(
                f"{len(stray)} {column} value(s) with a target lie outside the config's {tuple(allowed)}: "
                f"{stray[:5]}; restrict the frame before training"
            )
    if scored.height < min_rows:
        raise ValueError(
            f"only {scored.height} rows have {label_name!r} of {rows.height}; at least {min_rows} are needed to train"
        )
    columns = list(feature_columns(cfg.feature_set))
    x = feature_matrix(scored, cfg.feature_set)
    y = scored[label_name].cast(pl.Float64()).to_numpy()
    _log.info("quantile_models.fit", target=target.value, rows=scored.height, excluded=rows.height - scored.height)
    boosters: list[lgb.Booster] = []
    for level in fitted_levels:
        params = lgbm_native_params(cfg.lgbm, alpha=level)
        dataset = lgb.Dataset(x, label=y, feature_name=columns, params=params)
        boosters.append(lgb.train(params, dataset, num_boost_round=cfg.lgbm.n_estimators))
    return tuple(boosters)
