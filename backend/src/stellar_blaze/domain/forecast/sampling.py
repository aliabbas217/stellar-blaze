"""Joint samples of corrected (T, Td, wind) through a Gaussian copula, and the WBGT of those samples.

The corrector gives each variable a calibrated marginal (a ``(n, 19)`` grid of VALUE quantiles, ``grid.ppf`` between
them). WBGT needs the three together, and the three errors are correlated (a hot error comes with a dry or windy one),
so the marginals are joined by a Gaussian copula: ``fit_copula`` estimates its 3x3 correlation from the PIT values of
the calibration period (the caller fits one per lead and hour-block, pre-registration section 3.1), and
``sample_joint`` draws correlated normals, turns them into probabilities, and reads each variable's value off its own
grid. The dew point is capped at the temperature and the wind floored at 0 afterwards, so a draw is always physically
coherent.

``wbgt_joint_grid`` runs the Liljegren solver on every sample, with the forecast's own radiation and pressure at the
row's coordinates and the same solver screens as the gold dataset's ``wbgt_fc_c`` (``application.dataset.build_pairs``),
and returns the 19 empirical quantiles of the WBGT samples of each row. It lives here, not in ``ml``, because the
serving adapter needs it too and serving code may not import ``stellar_blaze.ml`` (import-linter contract 6).

Missing data never turns into a number: a row with a NaN grid has NaN samples, a sample the solver rejects (or whose
input is NaN) is left out of its row's quantiles and counted in ``n_finite``, and a row with no finite sample is
all-NaN.
"""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Final, NamedTuple

import numpy as np
from numpy.typing import NDArray
from scipy.special import ndtr, ndtri

from stellar_blaze.domain.forecast.grid import F64, LEVELS, ppf
from stellar_blaze.domain.physics.wbgt import wbgt_liljegren

__all__ = [
    "MIN_COPULA_ROWS",
    "WbgtJointGrid",
    "fit_copula",
    "nearest_correlation",
    "sample_joint",
    "screen_solver_inputs",
    "wbgt_joint_grid",
]

MIN_COPULA_ROWS: Final = 100
"""Fewest rows with a finite PIT in all three variables that a copula may be fitted on."""

_PIT_CLIP: Final = 1e-4
_EIGENVALUE_FLOOR: Final = 1e-6
_VARIABLES: Final = 3  # (t, td, wind), in this order everywhere

# The solver screens of ``application.dataset._screened`` (private to that module, so copied here, and public here
# through ``screen_solver_inputs`` so that ``features.pairs_from_forecasts`` shares this one copy; see the module
# docstring): finite values that no station or model reports are made missing before the solver, which would reach
# numpy as numbers and raise floating-point warnings. Keep these equal to B1's, a test pins the behavior.
_SOLVER_TEMPERATURE_C: Final = (-60.0, 70.0)

_EPOCH: Final = datetime(1970, 1, 1, tzinfo=UTC)
_MICROSECOND: Final = timedelta(microseconds=1)


class WbgtJointGrid(NamedTuple):
    """The WBGT quantiles of joint samples and how many samples each row's quantiles rest on.

    Attributes:
        grid: ``(n, 19)`` ascending WBGT quantiles (degrees Celsius) at ``LEVELS`` of the finite samples of each row;
            an all-NaN row where no sample is finite.
        n_finite: ``(n,)`` count of finite WBGT samples per row (0 for an all-NaN row); fewer than the draws means the
            solver or a missing input rejected some.
    """

    grid: F64
    n_finite: NDArray[np.int64]


def nearest_correlation(matrix: F64) -> F64:
    """The correlation matrix nearest to a symmetric ``matrix``: eigenvalues floored, then the diagonal made 1.

    Eigenvalues below ``1e-6`` are raised to it (so the result is positive definite and has a Cholesky factor), and the
    result is rescaled to a unit diagonal. A matrix that is already a well-conditioned correlation matrix is returned
    unchanged up to rounding.

    Raises:
        ValueError: ``matrix`` is not a finite square matrix.
    """
    array = np.asarray(matrix, dtype=np.float64)
    if array.ndim != 2 or array.shape[0] != array.shape[1] or not np.isfinite(array).all():
        raise ValueError(f"expected a finite square matrix, got shape {array.shape}")
    values, vectors = np.linalg.eigh((array + array.T) / 2.0)
    repaired = (vectors * np.maximum(values, _EIGENVALUE_FLOOR)) @ vectors.T
    scale = np.sqrt(np.diag(repaired))
    out = repaired / np.outer(scale, scale)
    out = (out + out.T) / 2.0
    np.fill_diagonal(out, 1.0)
    return np.asarray(out, dtype=np.float64)


def fit_copula(pit: F64) -> F64:
    """The 3x3 correlation of the normal scores of PIT values, projected to the nearest positive-definite correlation.

    The normal scores are ``ndtri(clip(pit, 1e-4, 1 - 1e-4))`` (a PIT of exactly 0 or 1 would be infinite); the
    correlation is Pearson's, as is usual for a Gaussian copula fitted on normal scores. A row with a PIT that is NaN or
    infinite in any variable is dropped from all three: the dependence is only observed where all three are. Counting
    them is the caller's (``n - isfinite(pit).all(axis=1).sum()``); fewer than ``MIN_COPULA_ROWS`` remaining is an
    error, not a thin estimate.

    Args:
        pit: ``(n, 3)`` probability integral transform values of (t, td, wind), in [0, 1].

    Returns:
        The ``(3, 3)`` symmetric correlation matrix with unit diagonal and positive eigenvalues.

    Raises:
        ValueError: ``pit`` does not have 3 columns, a finite value lies outside [0, 1], fewer than ``MIN_COPULA_ROWS``
            rows are usable, or a variable has no spread.
    """
    array = np.asarray(pit, dtype=np.float64)
    if array.ndim != 2 or array.shape[1] != _VARIABLES:
        raise ValueError(f"pit has shape (n, {_VARIABLES}), got {array.shape}")
    usable = array[np.isfinite(array).all(axis=1)]
    if usable.shape[0] < MIN_COPULA_ROWS:
        raise ValueError(
            f"need at least {MIN_COPULA_ROWS} rows with a finite PIT in all three variables, got {usable.shape[0]} "
            f"of {array.shape[0]}"
        )
    if usable.min() < 0.0 or usable.max() > 1.0:
        raise ValueError("pit values must lie in [0, 1]")
    scores = np.asarray(ndtri(np.clip(usable, _PIT_CLIP, 1.0 - _PIT_CLIP)), dtype=np.float64)
    if (scores.std(axis=0) == 0.0).any():
        raise ValueError("a variable has no spread in its PIT values, so its correlation is undefined")
    return nearest_correlation(np.asarray(np.corrcoef(scores, rowvar=False), dtype=np.float64))


def sample_joint(grids: Sequence[F64], corr: F64, *, n_samples: int, seed: int) -> F64:
    """Joint value samples of (t, td, wind) from three calibrated marginal grids and a copula correlation.

    Correlated standard normals (Cholesky of ``corr``, ``numpy.random.default_rng(seed)``) are mapped to probabilities
    by the normal distribution function and to values by each variable's ``grid.ppf``. Then the dew point is capped at
    the temperature (``td = min(td, t)``) and the wind floored at 0. The same arguments always give the same samples.

    Args:
        grids: Three ``(n, 19)`` sorted VALUE grids (t, td, wind), one row per forecast. A row with a NaN in any grid
            gives NaN samples for all three variables of that row.
        corr: The 3x3 correlation matrix (``fit_copula``); it must be positive definite.
        n_samples: Draws per row (pre-registration: 50).
        seed: Seed of the generator.

    Returns:
        ``(n, n_samples, 3)`` values in the units of the grids, variables in the order t, td, wind.

    Raises:
        ValueError: There are not three grids of one shape ``(n, 19)`` with sorted rows, ``corr`` is not a symmetric
            3x3 unit-diagonal positive-definite matrix, or ``n_samples`` is below 1.
    """
    if len(grids) != _VARIABLES:
        raise ValueError(f"expected three grids (t, td, wind), got {len(grids)}")
    arrays = [np.asarray(grid, dtype=np.float64) for grid in grids]
    if len({array.shape[:1] for array in arrays}) != 1:
        raise ValueError(f"the grids must have the same number of rows, got {[a.shape[0] for a in arrays]}")
    if n_samples < 1:
        raise ValueError(f"n_samples must be at least 1, got {n_samples}")
    matrix = np.asarray(corr, dtype=np.float64)
    if (
        matrix.shape != (_VARIABLES, _VARIABLES)
        or not np.isfinite(matrix).all()
        or not np.allclose(matrix, matrix.T, atol=1e-9)
        or not np.allclose(np.diag(matrix), 1.0, atol=1e-9)
    ):
        raise ValueError(f"corr must be a symmetric {_VARIABLES}x{_VARIABLES} correlation matrix with unit diagonal")
    try:
        factor = np.linalg.cholesky(matrix)
    except np.linalg.LinAlgError:
        raise ValueError("corr must be positive definite (use fit_copula, which projects to the nearest one)") from None

    rows = arrays[0].shape[0]
    normals = np.random.default_rng(seed).standard_normal((rows, n_samples, _VARIABLES)) @ factor.T
    probability = np.asarray(ndtr(normals), dtype=np.float64)
    samples = np.stack([ppf(array, probability[:, :, k]) for k, array in enumerate(arrays)], axis=2)
    samples[:, :, 1] = np.minimum(samples[:, :, 1], samples[:, :, 0])
    samples[:, :, 2] = np.maximum(samples[:, :, 2], 0.0)
    missing = ~np.stack([np.isfinite(array).all(axis=1) for array in arrays]).all(axis=0)
    samples[missing] = np.nan
    return samples


def _utc_microseconds(valid_time: Sequence[datetime]) -> NDArray[np.datetime64]:
    """The UTC-aware instants as naive ``datetime64[us]`` meaning UTC, the form ``wbgt_liljegren`` takes."""
    micros = np.empty(len(valid_time), dtype=np.int64)
    for index, moment in enumerate(valid_time):
        if moment.tzinfo is None or moment.utcoffset() is None:
            raise ValueError(f"valid_time must be UTC-aware datetimes, row {index} is naive")
        micros[index] = (moment - _EPOCH) // _MICROSECOND
    return micros.view("datetime64[us]")


def screen_solver_inputs(t: F64, td: F64, wind: F64, pressure: F64) -> tuple[F64, F64, F64, F64]:
    """The solver's inputs with the sentinel-like values turned into NaN (``application.dataset._screened``).

    Temperature and dew point outside -60 to 70 degrees Celsius, a negative wind and a pressure at or below 0 become
    NaN, which the solver rejects as non-finite input. Shared by ``wbgt_joint_grid`` and by
    ``features.pairs_from_forecasts`` (the serving ``wbgt_fc_c``), so the two screens cannot drift apart.
    """
    low, high = _SOLVER_TEMPERATURE_C
    return (
        np.where((t >= low) & (t <= high), t, np.nan),
        np.where((td >= low) & (td <= high), td, np.nan),
        np.where(wind >= 0.0, wind, np.nan),
        np.where(pressure > 0.0, pressure, np.nan),
    )


def _per_row(name: str, values: F64, rows: int) -> F64:
    array = np.asarray(values, dtype=np.float64)
    if array.shape != (rows,):
        raise ValueError(f"{name} needs one value per row ({rows} rows), got shape {array.shape}")
    return array


def _finite_quantiles(values: F64) -> tuple[F64, NDArray[np.int64]]:
    """Per row, the ``LEVELS`` quantiles (linear interpolation, as ``numpy.quantile``) of its finite values."""
    finite = np.isfinite(values)
    counts = finite.sum(axis=1).astype(np.int64)
    ordered = np.sort(np.where(finite, values, np.inf), axis=1)  # the missing go last and are never read
    levels = np.asarray(LEVELS, dtype=np.float64)
    position = np.maximum(counts - 1, 0)[:, None] * levels[None, :]
    lower = np.floor(position).astype(np.intp)
    upper = np.minimum(lower + 1, np.maximum(counts - 1, 0)[:, None])
    low_value = np.take_along_axis(ordered, lower, axis=1)
    high_value = np.take_along_axis(ordered, upper, axis=1)
    # A row without finite values holds inf; mask it before the arithmetic can make a NaN from inf - inf.
    empty = (counts == 0)[:, None]
    low_value = np.where(empty, 0.0, low_value)
    high_value = np.where(empty, 0.0, high_value)
    grid = low_value + (position - lower) * (high_value - low_value)
    return np.where(empty, np.nan, grid), counts


def wbgt_joint_grid(
    samples: F64,
    *,
    valid_time: Sequence[datetime],
    lat: F64,
    lon: F64,
    sw_wm2: F64,
    direct_wm2: F64,
    pressure_hpa: F64,
) -> WbgtJointGrid:
    """The 19 WBGT quantiles of joint (t, td, wind) samples, Liljegren run on every sample.

    The conventions are those of the gold dataset's ``wbgt_fc_c``: ``wbgt_liljegren`` in its default (mid-point) mode,
    radiation as the mean over the hour ending at ``valid_time``, the solver screens of ``build_pairs`` (temperature and
    dew point outside -60 to 70 degrees Celsius, wind below 0 and pressure at or below 0 are made missing), and every
    other rejection (non-finite input, incoherent radiation, no convergence, out-of-band result) left to the solver. A
    rejected sample is NaN, is left out of its row's quantiles and is not counted in ``n_finite``.

    Args:
        samples: ``(n, n_samples, 3)`` value samples of (t in degrees Celsius, td in degrees Celsius, wind in m/s);
            NaN marks a missing sample.
        valid_time: ``n`` UTC-aware datetimes (hour-ending labels; any offset is converted to UTC).
        lat: ``(n,)`` latitudes in degrees north.
        lon: ``(n,)`` longitudes in degrees east.
        sw_wm2: ``(n,)`` shortwave radiation, the forecast's own (not a reference's), W/m2.
        direct_wm2: ``(n,)`` direct-beam shortwave radiation, W/m2.
        pressure_hpa: ``(n,)`` surface pressure, hPa.

    Returns:
        The quantile grid and the per-row count of finite samples (see ``WbgtJointGrid``).

    Raises:
        ValueError: ``samples`` is not ``(n, n_samples >= 1, 3)``, a per-row argument does not have ``n`` rows, a
            ``valid_time`` is naive, or a coordinate is not a finite number in range.
    """
    values = np.asarray(samples, dtype=np.float64)
    if values.ndim != 3 or values.shape[2] != _VARIABLES or values.shape[1] < 1:
        raise ValueError(f"samples has shape (n, n_samples >= 1, {_VARIABLES}), got {values.shape}")
    rows, draws, _ = values.shape
    if len(valid_time) != rows:
        raise ValueError(f"valid_time needs one value per row ({rows} rows), got {len(valid_time)}")
    latitude, longitude = _per_row("lat", lat, rows), _per_row("lon", lon, rows)
    shortwave, direct = _per_row("sw_wm2", sw_wm2, rows), _per_row("direct_wm2", direct_wm2, rows)
    pressure = _per_row("pressure_hpa", pressure_hpa, rows)
    utc = _utc_microseconds(valid_time)

    wbgt = np.full((rows, draws), np.nan, dtype=np.float64)
    if rows:
        _, group = np.unique(np.stack([latitude, longitude], axis=1), axis=0, return_inverse=True)
        group = group.reshape(-1)
        for index in range(int(group.max()) + 1):
            chosen = np.flatnonzero(group == index)
            t, td, wind, p = screen_solver_inputs(
                values[chosen, :, 0].ravel(),
                values[chosen, :, 1].ravel(),
                values[chosen, :, 2].ravel(),
                np.repeat(pressure[chosen], draws),
            )
            result = wbgt_liljegren(
                t_c=t,
                td_c=td,
                wind10m_ms=wind,
                pressure_hpa=p,
                sw_wm2=np.repeat(shortwave[chosen], draws),
                direct_wm2=np.repeat(direct[chosen], draws),
                lat=float(latitude[chosen[0]]),
                lon=float(longitude[chosen[0]]),
                valid_time_utc=np.repeat(utc[chosen], draws),
            )
            wbgt[chosen] = result.wbgt_c.reshape(chosen.size, draws)
    grid, counts = _finite_quantiles(wbgt)
    return WbgtJointGrid(grid=grid, n_finite=counts)
