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


def fit_quantile_models(
    rows: pl.DataFrame, *, target: Target, cfg: TrainingConfig, min_rows: int = MIN_TRAIN_ROWS
) -> tuple[lgb.Booster, ...]:
    """Fit one quantile booster per level on the error ``y_<target>`` (truth minus forecast).

    Rows whose ``y_<target>`` is null or NaN (no truth, a rejected WBGT, an hour outside 02-15 UTC) are excluded, and
    nothing is filled. Feature nulls stay as NaN. The 19 boosters come back in ``LEVELS`` order and must be used with
    ``predict_grid``, which returns *error* quantiles: the corrected value is ``raw + error quantile``.

    Args:
        rows: A ``build_features`` frame holding the ``cfg.feature_set`` columns and ``y_<target>``. The caller has
            already restricted it to the fold's training rows and to ``cfg.leads``.
        target: The corrected variable.
        cfg: The training config.
        min_rows: The fewest rows with a target that may remain.

    Returns:
        19 boosters, ``LEVELS[i]`` at index ``i``.

    Raises:
        ValueError: A column is missing, or fewer than ``min_rows`` rows have a target.
    """
    label_name = f"y_{target.value}"
    if label_name not in rows.columns:
        raise ValueError(f"the frame has no target column {label_name!r}")
    scored = rows.filter(pl.col(label_name).fill_nan(None).is_not_null())
    if scored.height < min_rows:
        raise ValueError(
            f"only {scored.height} rows have {label_name!r} of {rows.height}; at least {min_rows} are needed to train"
        )
    columns = list(feature_columns(cfg.feature_set))
    x = feature_matrix(scored, cfg.feature_set)
    y = scored[label_name].cast(pl.Float64()).to_numpy()
    _log.info("quantile_models.fit", target=target.value, rows=scored.height, excluded=rows.height - scored.height)
    boosters: list[lgb.Booster] = []
    for level in LEVELS:
        params = lgbm_native_params(cfg.lgbm, alpha=level)
        dataset = lgb.Dataset(x, label=y, feature_name=columns, params=params)
        boosters.append(lgb.train(params, dataset, num_boost_round=cfg.lgbm.n_estimators))
    return tuple(boosters)
