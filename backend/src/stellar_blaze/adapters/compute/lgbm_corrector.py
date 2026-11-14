"""The LightGBM quantile grid at serving time: predict the 19 error quantiles, and store or load a booster.

This is the prediction half of the corrector (the ``LightGbmCorrector`` port implementation joins it in a later task).
Nothing here needs the training libraries (``mapie``, ``sklearn``, ``scoringrules``); ``lightgbm`` is imported here and
in ``stellar_blaze.ml`` only.

What the grid is. A booster is trained on the *error* of a forecast, truth minus forecast (``y_*`` of
``build_features``), so ``predict_grid`` returns **error quantiles**, not corrected values. The corrected quantile is
``raw + error quantile``, and the caller adds ``raw``; wind is then clipped at 0 by the caller.

Storage. A booster is stored as gzip-compressed LightGBM text (``*.txt.gz``), never pickle. ``dump_booster`` is
byte-reproducible: the gzip header carries no timestamp and no file name, so one booster always gives the same bytes
(and so the same SHA-256 in a manifest).
"""

import gzip
from collections.abc import Sequence

import lightgbm as lgb
import numpy as np

from stellar_blaze.domain.forecast.grid import F64, LEVELS, sort_grid

__all__ = ["dump_booster", "load_booster", "predict_grid"]


def predict_grid(boosters: Sequence[lgb.Booster], x: F64) -> F64:
    """The sorted ``(n, 19)`` grid of predicted *error* quantiles (truth minus forecast), one column per level.

    Column ``i`` is the prediction of ``boosters[i]``, the booster of ``LEVELS[i]``. Independently trained quantile
    models can cross, so each row is sorted with ``grid.sort_grid`` (if a booster ever returned NaN for a row, that row
    would come back as an all-NaN row, never a shifted one). ``x`` is not modified.

    Missing inputs are NOT detected here. A real LightGBM booster routes a NaN feature down its learned
    missing-value branch and returns a finite, sorted prediction, even for a row or a whole matrix of NaN. The caller
    must therefore gate rows whose required forecast values are missing *before* calling (the corrector answers
    ``missing_input`` with null quantiles for them) and must not read a number from such a row.

    Args:
        boosters: The 19 boosters, in ``LEVELS`` order.
        x: The feature matrix, ``float64`` with shape ``(n, n_features)``; the columns must be the training columns in
            the training order (NaN marks a missing value; see above).

    Returns:
        A new ``(n, 19)`` array, ascending along each row.

    Raises:
        ValueError: There are not 19 boosters, or ``x`` is not a 2-D float64 array.
    """
    if len(boosters) != len(LEVELS):
        raise ValueError(f"expected {len(LEVELS)} boosters, one per level, got {len(boosters)}")
    if x.ndim != 2 or x.dtype != np.float64:
        raise ValueError(f"x must be a 2-D float64 array, got ndim={x.ndim} dtype={x.dtype}")
    grid = np.empty((x.shape[0], len(boosters)), dtype=np.float64)
    for column, booster in enumerate(boosters):
        grid[:, column] = np.asarray(booster.predict(x), dtype=np.float64)
    return sort_grid(grid)


def dump_booster(b: lgb.Booster) -> bytes:
    """The booster as gzip-compressed LightGBM text, identical bytes for an identical booster.

    ``mtime=0`` and the absence of a file name make the gzip header constant; the compression level is fixed.
    """
    return gzip.compress(b.model_to_string().encode("utf-8"), mtime=0)


def load_booster(data: bytes) -> lgb.Booster:
    """The booster stored by ``dump_booster``.

    Raises:
        gzip.BadGzipFile: ``data`` is not gzip.
        lightgbm.basic.LightGBMError: The text is not a LightGBM model.
    """
    return lgb.Booster(model_str=gzip.decompress(data).decode("utf-8"))
