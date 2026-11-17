"""The facade over ``mapie``: the one call the oracle test needs, with MAPIE's logging routed through structlog.

``mapie`` (and, through it, ``scikit-learn``) is imported only here (import-linter keeps it out of the serving layers
and mypy treats it as untyped). Production code never calls MAPIE: ``ml.conformal`` applies persisted offsets with
plain numpy, and this module is the independent oracle the unit test compares them with (pre-registration 3.1, stack
doc 6.1).

MAPIE logs on the *root* logger. ``mapie.utils._check_lower_upper_bounds`` runs ``logging.basicConfig(level=INFO)``
and ``logging.info("The predictions are ill-sorted.")`` whenever a quantile model crosses, which has two global side
effects beyond the message: if the root logger has no handler it installs a stderr handler, and it leaves the root
level at INFO. Both outlive the call. ``_routed_to_structlog`` therefore wraps the MAPIE calls: it installs a
filter on the root logger that forwards each record that is logged directly on it to structlog and drops it there,
raises the root level to INFO so that the record is produced at all, and afterwards restores the handlers and the level
exactly as they were. The wrapper is not thread-safe (it edits the root logger for the duration of the call), which is
acceptable for an offline test oracle.
"""

import logging
from collections.abc import Iterator, Sequence
from contextlib import contextmanager

import numpy as np
import structlog
from mapie.regression import ConformalizedQuantileRegressor

from stellar_blaze.domain.forecast.grid import F64

__all__ = ["mapie_symmetric_interval"]

_log = structlog.get_logger(__name__)


class _RootRecordsToStructlog(logging.Filter):
    """Forwards a record logged on the root logger to structlog, then drops it from the stdlib pipeline."""

    def filter(self, record: logging.LogRecord) -> bool:
        # the event name is a constant so the line is greppable; the message is MAPIE's own text
        _log.log(record.levelno, "mapie_message", message=record.getMessage())
        return False


@contextmanager
def _routed_to_structlog() -> Iterator[None]:
    root = logging.getLogger()
    handlers, level = list(root.handlers), root.level
    forwarder = _RootRecordsToStructlog()
    root.addFilter(forwarder)
    root.setLevel(logging.INFO)
    try:
        yield
    finally:
        root.removeFilter(forwarder)
        for handler in list(root.handlers):
            if handler not in handlers:  # the stderr handler that basicConfig adds when there is none
                root.removeHandler(handler)
        root.setLevel(level)


def mapie_symmetric_interval(
    estimators: Sequence[object], x_cal: F64, y_cal: F64, x: F64, *, confidence_level: float
) -> tuple[F64, F64]:
    """The symmetric-corrected CQR interval of MAPIE 1.6.0 for prefit quantile estimators.

    ``ConformalizedQuantileRegressor(prefit=True)`` conformalizes on ``(x_cal, y_cal)`` and
    ``predict_interval(symmetric_correction=True)`` widens ``[lower, upper]`` by one offset on both sides.

    Args:
        estimators: Three fitted scikit-learn-API regressors in the order ``[lower, upper, median]``, trained at the
            quantile levels ``(1 - c) / 2``, ``(1 + c) / 2`` and ``0.5`` (MAPIE does not check the order; a wrong order
            is silently wrong). A native ``lightgbm.Booster`` is not accepted by MAPIE.
        x_cal: Calibration features, shape ``(n_cal, n_features)``.
        y_cal: Calibration targets, shape ``(n_cal,)``.
        x: Features to predict, shape ``(n, n_features)``.
        confidence_level: Nominal coverage, for example 0.9.

    Returns:
        The lower and the upper bound, each of shape ``(n,)``.
    """
    with _routed_to_structlog():
        cqr = ConformalizedQuantileRegressor(estimator=list(estimators), confidence_level=confidence_level, prefit=True)
        cqr.conformalize(x_cal, y_cal)
        _, intervals = cqr.predict_interval(x, symmetric_correction=True)
    bounds = np.asarray(intervals, dtype=np.float64)  # (n, 2, 1): lower, upper, one confidence level
    return bounds[:, 0, 0], bounds[:, 1, 0]
