"""Port for the forecast corrector: calibrated quantile forecasts of t, td, wind and WBGT from raw model output.

The frames are Polars frames in the schemas of ``stellar_blaze.domain.weather.schemas`` (inputs) and
``stellar_blaze.domain.forecast.schemas`` (output). This is the interface the serving code (B3) is written against; the
LightGBM corrector and the in-memory fake both implement it.
"""

from typing import Protocol

import numpy as np
import polars as pl
from numpy.typing import NDArray


class ForecastCorrector(Protocol):
    """Turns raw IFS forecasts into calibrated quantile forecasts, and draws joint samples from them."""

    @property
    def model_id(self) -> str | None:
        """The id of the model artifact (``corrector-<yyyymmdd>-<gitsha7>-<cfg6>``), or ``None`` if it has none."""
        ...

    @property
    def needs_history_forecasts(self) -> bool:
        """Whether ``correct`` needs ``history_ifs``: true for a corrector with station-history (``bias7``) features.

        Those features are lead-1 forecast errors, not observations, so they need the past lead-1 IFS forecasts as well
        as the past observations. A caller that gets ``True`` must pass ``history_ifs``; a caller that wants no history
        features, or a corrector that has none, may ignore this.
        """
        ...

    def correct(
        self,
        *,
        ifs: pl.DataFrame,
        gfs: pl.DataFrame,
        history: pl.DataFrame,
        history_ifs: pl.DataFrame | None = None,
    ) -> pl.DataFrame:
        """Correct the IFS forecasts in ``ifs``, using the GFS forecasts and the past as inputs.

        Args:
            ifs: IFS forecasts to correct, ``FORECAST_SCHEMA`` rows.
            gfs: GFS forecasts for the same stations and hours, ``FORECAST_SCHEMA`` rows; a row may be absent.
            history: Past hourly observations, ``OBS_HOURLY_SCHEMA`` rows (the station-history features).
            history_ifs: Past lead-1 IFS forecasts, ``FORECAST_SCHEMA`` rows, needed to build the ``bias7`` features
                when ``needs_history_forecasts`` is true; ignored otherwise.

        Returns:
            ``CORRECTED_FORECAST_SCHEMA`` rows, one per row of ``ifs`` and variable (``t``, ``td``, ``wind``,
            ``wbgt``), grouped by the input row and in its order.

        History cutoff (pre-registration L3, a contract every implementation must keep): for the row being corrected,
        with UTC valid date ``D`` and ``lead_days`` ``L``, the forecast was issued on ``D - L``, so only ``history``
        and ``history_ifs`` rows whose UTC valid date is ``<= D - L - 1`` may influence that row's output. The
        implementation MUST ignore later rows itself: a caller may pass one window for all rows (for a lead-3 row it
        then holds the truth of ``D - 3`` and ``D - 2``, which did not exist at issue time). The helper
        ``assert_respects_history_cutoff`` in ``tests/unit/forecast/contract.py`` checks it for any implementation.

        Statuses and what a caller may rely on:

        * ``ok``: calibrated, sorted quantiles.
        * ``missing_input``: null quantiles and, if the raw value itself cannot be computed, null ``raw``; it is for
          an IFS row that lacks a value the corrector needs. A missing GFS row is not ``missing_input``: it is a
          missing feature (null GFS features) and the row is still corrected.
        * ``uncorrected``: the quantile columns are populated and all equal to ``raw`` (null quantiles occur only for
          ``missing_input``). A grid of equal quantiles gives ``exceedance_probability(grid, raw) == 0.5`` (mid-rank),
          so compare ``status`` with ``CorrectionStatus`` instead of inferring "uncorrected" from the grid. A real
          corrector also returns ``uncorrected`` for a row outside ``MODELLED_HOURS_UTC`` or ``MODEL_LEADS``: it never
          claims calibration it does not have. ``FakeCorrector`` does not distinguish those rows.
        """
        ...

    def sample(self, corrected: pl.DataFrame, *, n_samples: int, seed: int) -> NDArray[np.float64]:
        """Draw ``n_samples`` joint samples of (t, td, wind) for each forecast row in ``corrected``.

        Args:
            corrected: A ``CORRECTED_FORECAST_SCHEMA`` frame with the ``t``, ``td`` and ``wind`` rows of every forecast
                row (the ``wbgt`` rows are not sampled: the caller computes WBGT or TWL from the samples).
            n_samples: Number of samples per forecast row, at least 1.
            seed: Seed of the random generator; the same inputs and seed give the same samples.

        Returns:
            An array of shape ``(rows, n_samples, 3)``, the last axis (t, td, wind) in degrees Celsius and meters per
            second. ``rows`` are the distinct (station, valid_time, lead_days) keys of ``corrected`` in order of first
            appearance. The samples of a forecast row with any of the three variables ``missing_input`` are NaN for
            that variable.

            The real corrector's samples satisfy ``td <= t`` and ``wind >= 0``. ``FakeCorrector`` does not screen its
            samples (wind can be negative, ``td`` can exceed ``t``), so code that needs those properties must not rely
            on the fake to supply them.

        Raises:
            ValueError: ``n_samples`` is below 1, or a key lacks one of the three variables or repeats one.
        """
        ...
