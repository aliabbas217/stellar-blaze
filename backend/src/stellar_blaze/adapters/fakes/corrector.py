"""An in-memory ``ForecastCorrector`` for tests and for building the serving code before the real model exists.

``FakeCorrector(spread_c)`` does no learning: the quantiles of each variable are the raw forecast plus ``spread_c``
times the standard-normal quantile of the level, the same spread for every variable, lead and hour. With a spread of 0
nothing is corrected and every quantile equals the raw value (status ``uncorrected``). The raw WBGT is computed the way
the gold dataset computes ``wbgt_fc_c``: Liljegren over the forecast's own temperature, dew point, wind, radiation and
pressure at the station's coordinates, so a test that compares the two is meaningful.

Samples are independent draws from the three grids (no copula) and are not physically screened: wind can be
negative and the dew point can exceed the temperature, unlike the real corrector's samples. It uses
``statistics.NormalDist`` for the normal quantile: adapters do not import scipy.
"""

import math
from statistics import NormalDist
from typing import Final

import numpy as np
import polars as pl
from numpy.typing import NDArray

from stellar_blaze.domain.forecast.grid import F64, LEVELS, ppf
from stellar_blaze.domain.forecast.schemas import (
    CORRECTED_FORECAST_SCHEMA,
    QUANTILE_COLUMNS,
    VARIABLES,
    CorrectionStatus,
    quantile_matrix,
)
from stellar_blaze.domain.physics.wbgt import wbgt_liljegren
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, OBS_HOURLY_SCHEMA, conform
from stellar_blaze.domain.weather.stations import STATIONS, station

_SAMPLED: Final = ("t", "td", "wind")
_KEY: Final = ["station", "valid_time", "lead_days"]
_NORMAL_QUANTILES: Final[tuple[float, ...]] = tuple(NormalDist().inv_cdf(level) for level in LEVELS)

# The solver is not asked to digest values that no model reports (the same gross-error screens as ``build_pairs`` in
# ``application/dataset.py``, which adapters cannot import): they become missing, and the WBGT with them.
_SOLVER_TEMPERATURE_C: Final = (-60.0, 70.0)


def _array(frame: pl.DataFrame, name: str) -> F64:
    """The column as float64, with nulls as NaN."""
    return np.asarray(frame[name].to_numpy(), dtype=np.float64)


def _raw_wbgt(frame: pl.DataFrame, t: F64, td: F64, wind: F64) -> F64:
    """Liljegren WBGT of each forecast row from its own values (NaN where an input is unusable or rejected)."""
    low, high = _SOLVER_TEMPERATURE_C
    pressure, sw, direct = _array(frame, "pressure_hpa"), _array(frame, "sw_wm2"), _array(frame, "direct_wm2")
    t_ok = np.where((t >= low) & (t <= high), t, np.nan)
    td_ok = np.where((td >= low) & (td <= high), td, np.nan)
    wind_ok = np.where(wind >= 0.0, wind, np.nan)
    pressure_ok = np.where(pressure > 0.0, pressure, np.nan)
    valid_utc = frame["valid_time"].dt.replace_time_zone(None).to_numpy()
    stations = frame["station"].to_numpy()
    out = np.full(frame.height, np.nan, dtype=np.float64)
    for icao in np.unique(stations):
        rows = np.flatnonzero(stations == icao)
        where = station(str(icao))
        out[rows] = wbgt_liljegren(
            t_c=t_ok[rows],
            td_c=td_ok[rows],
            wind10m_ms=wind_ok[rows],
            pressure_hpa=pressure_ok[rows],
            sw_wm2=sw[rows],
            direct_wm2=direct[rows],
            lat=where.lat,
            lon=where.lon,
            valid_time_utc=valid_utc[rows],
        ).wbgt_c
    return out


class FakeCorrector:
    """A ``ForecastCorrector`` that adds a fixed normal spread to the raw IFS forecast."""

    def __init__(self, spread_c: float = 0.0) -> None:
        """Create a fake with the standard deviation of the quantile spread, in the units of each variable.

        Raises:
            ValueError: ``spread_c`` is negative or not finite.
        """
        if not (math.isfinite(spread_c) and spread_c >= 0.0):
            raise ValueError(f"spread_c must be a finite number of at least 0, got {spread_c!r}")
        self._spread = float(spread_c)

    @property
    def model_id(self) -> str | None:
        """A fake has no model artifact."""
        return None

    @property
    def needs_history_forecasts(self) -> bool:
        """The fake builds no station-history features, so it never needs ``history_ifs``."""
        return False

    def correct(
        self,
        *,
        ifs: pl.DataFrame,
        gfs: pl.DataFrame,
        history: pl.DataFrame,
        history_ifs: pl.DataFrame | None = None,
    ) -> pl.DataFrame:
        """Quantiles ``raw + spread_c * Phi^-1(level)`` for each IFS row and variable; ``gfs`` and history are ignored.

        A variable whose raw value is missing (a null or NaN input; for WBGT, any input the solver cannot use) has
        status ``missing_input`` and null quantiles. Otherwise the status is ``ok``, or ``uncorrected`` when the spread
        is 0.

        Raises:
            SchemaMismatchError: A frame does not have its schema.
            ValueError: A station of ``ifs`` is not one of ``STATIONS``.
        """
        forecast = conform(ifs, FORECAST_SCHEMA)
        conform(gfs, FORECAST_SCHEMA)
        conform(history, OBS_HOURLY_SCHEMA)
        if history_ifs is not None:
            conform(history_ifs, FORECAST_SCHEMA)
        unknown = sorted(set(forecast["station"].unique().to_list()) - {s.icao for s in STATIONS})
        if unknown:
            raise ValueError(f"forecasts for stations that are not in STATIONS: {unknown}")

        t, td, wind = _array(forecast, "t_c"), _array(forecast, "td_c"), _array(forecast, "wind_ms")
        raw = np.stack([t, td, wind, _raw_wbgt(forecast, t, td, wind)], axis=1).reshape(-1)  # row i, variable j: 4i+j
        raw = np.where(np.isfinite(raw), raw, np.nan)
        missing = np.isnan(raw)
        quantiles = raw[:, None] + self._spread * np.asarray(_NORMAL_QUANTILES, dtype=np.float64)[None, :]
        present = CorrectionStatus.UNCORRECTED if self._spread == 0.0 else CorrectionStatus.OK
        status = np.where(missing, CorrectionStatus.MISSING_INPUT.value, present.value).tolist()

        source_row = pl.Series(np.repeat(np.arange(forecast.height, dtype=np.int64), len(VARIABLES)))
        n = source_row.len()
        return pl.concat(
            [
                forecast.select(_KEY).select(pl.all().gather(source_row)),
                pl.DataFrame(
                    {
                        "variable": pl.Series(list(VARIABLES) * forecast.height, dtype=pl.String),
                        "raw": pl.Series(raw, dtype=pl.Float64, nan_to_null=True),
                        **{
                            name: pl.Series(quantiles[:, k], dtype=pl.Float64, nan_to_null=True)
                            for k, name in enumerate(QUANTILE_COLUMNS)
                        },
                        "status": pl.Series(status, dtype=pl.String),
                        "model_id": pl.Series([None] * n, dtype=pl.String),
                    }
                ),
            ],
            how="horizontal",
        ).select(list(CORRECTED_FORECAST_SCHEMA))

    def sample(self, corrected: pl.DataFrame, *, n_samples: int, seed: int) -> NDArray[np.float64]:
        """Independent draws from the grids of t, td and wind: shape ``(rows, n_samples, 3)``.

        Raises:
            SchemaMismatchError: ``corrected`` is not a ``CORRECTED_FORECAST_SCHEMA`` frame.
            ValueError: ``n_samples`` is below 1, or a (station, valid_time, lead_days) key lacks one of the
                three variables or repeats one.
        """
        if n_samples < 1:
            raise ValueError(f"n_samples must be at least 1, got {n_samples}")
        frame = conform(corrected, CORRECTED_FORECAST_SCHEMA)
        keys = frame.select(_KEY).unique(maintain_order=True)
        grids = []
        for variable in _SAMPLED:
            rows = frame.filter(pl.col("variable") == variable)
            if rows.select(_KEY).is_duplicated().any():
                raise ValueError(f"duplicate {variable!r} rows for one (station, valid_time, lead_days) key")
            aligned = keys.join(rows, on=_KEY, how="left", maintain_order="left", validate="1:1")
            if aligned["variable"].null_count():
                raise ValueError(f"every forecast row needs a {variable!r} variable row, and some lack it")
            grids.append(quantile_matrix(aligned))
        draws = np.random.default_rng(seed).random((keys.height, n_samples, len(_SAMPLED)))
        return np.stack([ppf(grid, draws[:, :, k]) for k, grid in enumerate(grids)], axis=2)
