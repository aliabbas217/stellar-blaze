"""The facade over ``scikit-learn``: a standardized ridge regression on plain float64 numpy arrays.

``sklearn`` is imported only here (import-linter keeps it out of the serving layers and mypy treats it as untyped),
so the baselines (``ml.baselines``) depend on two functions of one small class rather than on scikit-learn's API.

Arrays go in and out as C-contiguous ``float64`` numpy arrays with a fixed column order, at fit and at predict. That
keeps scikit-learn from recording or checking feature names, so it emits no feature-name ``UserWarning`` under
``filterwarnings = ["error"]``.
"""

import numpy as np
from sklearn.linear_model import Ridge as _SklearnRidge
from sklearn.preprocessing import StandardScaler

from stellar_blaze.domain.forecast.grid import F64

__all__ = ["Ridge"]


def _matrix(x: F64, what: str) -> F64:
    array = np.ascontiguousarray(x, dtype=np.float64)
    if array.ndim != 2:
        raise ValueError(f"{what} must be a 2-D array (rows, features), got shape {array.shape}")
    if not np.isfinite(array).all():
        raise ValueError(f"{what} holds a NaN or an infinity: drop or route those rows before the ridge")
    return array


class Ridge:
    """Ridge regression on features standardized with the training mean and standard deviation.

    Standardising is this module's choice, not the pre-registration's (it says "ridge on the cold features" and is
    silent on scaling): the L2 penalty is not scale-free, so unscaled features in degrees, hectopascals, watts per
    square meter and day numbers would be shrunk by an amount that depends on their units alone. The mean and the
    (population) standard deviation come from the rows given to ``fit`` and are applied unchanged at ``predict``; a
    constant column gets a scale of 1 and so a zero coefficient. The intercept is not penalized.

    Args:
        alpha: The L2 penalty on the standardized coefficients (the pre-registered baseline uses 1.0).
    """

    def __init__(self, alpha: float) -> None:
        if not alpha > 0.0:
            raise ValueError(f"alpha must be positive, got {alpha}")
        self._alpha = alpha
        self._scaler = StandardScaler()
        self._ridge = _SklearnRidge(alpha=alpha, fit_intercept=True, solver="cholesky")
        self._n_features: int | None = None

    def fit(self, x: F64, y: F64) -> "Ridge":
        """Fit on ``x`` of shape ``(n, k)`` and ``y`` of shape ``(n,)``, both finite; returns ``self``.

        Raises:
            ValueError: A shape is wrong, there are no rows, or an input holds a NaN or an infinity.
        """
        features = _matrix(x, "x")
        target = np.ascontiguousarray(y, dtype=np.float64)
        if target.shape != (features.shape[0],) or features.shape[0] == 0:
            raise ValueError(f"y must have shape ({features.shape[0]},) and there must be rows, got {target.shape}")
        if not np.isfinite(target).all():
            raise ValueError("y holds a NaN or an infinity: drop those rows before the ridge")
        scaled = self._scaler.fit_transform(features)
        self._ridge.fit(scaled, target)
        self._n_features = features.shape[1]
        return self

    def predict(self, x: F64) -> F64:
        """The predicted target of ``x`` of shape ``(n, k)`` with the ``k`` of the fit, shape ``(n,)``.

        Raises:
            ValueError: The model is not fitted, ``x`` has another number of columns, or it holds a NaN or an infinity.
        """
        if self._n_features is None:
            raise ValueError("the ridge is not fitted")
        features = _matrix(x, "x")
        if features.shape[1] != self._n_features:
            raise ValueError(f"x has {features.shape[1]} columns, the ridge was fitted on {self._n_features}")
        return np.asarray(self._ridge.predict(self._scaler.transform(features)), dtype=np.float64)

    def __repr__(self) -> str:
        return f"Ridge(alpha={self._alpha}, fitted={self._n_features is not None})"
