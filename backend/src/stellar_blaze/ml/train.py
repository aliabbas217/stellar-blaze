"""Training of the forecast corrector: ``train_corrector`` and the WBGT helpers (pre-registration sections 2.3 and 3.1).

The pipeline of ``train_corrector`` over gold-shaped dev rows (IFS spine plus GFS, leads 1-7, hours 02-15 UTC):

1. *Splits* (``ml.conformal.fit_mask`` and ``calibration_mask``; the calibration rows follow ``cfg.calibration_window``,
   the fit rows are 15 May to 31 August of their summer minus the calibration rows; rule L7).
2. *Fold statistics* (climatology) fitted on the fit and the calibration rows together. The climatology is in-sample for
   both sets, so a September row never gets a null climatology that the fit rows never saw. Rows that are neither (the
   September rows outside the ``weeks_4_8_12_16`` window) are left out, so a truth that no fit or calibration row uses
   leaves no trace in any fitted object.
3. *Features* with those statistics and, for the ``site`` set, the causal station history of every given row.
4. 19 quantile boosters per target on the fit rows (T, Td and wind; WBGT only for ``wbgt_method == "direct"``).
5. *Conformal offsets* per target from the calibration rows' predicted ERROR grids (rows without a truth stay in the
   arrays: the function excludes them itself, so every stratum key exists).
6. *Copulas* per ``<lead>|<block>`` stratum from the PIT of the truth under the calibrated T, Td and wind VALUE grids
   (raw forecast plus calibrated error grid; wind clipped at 0, as it is when served). A stratum with fewer than
   ``MIN_COPULA_ROWS`` usable rows takes the lead-pooled correlation and is recorded.
7. *WBGT*: the direct booster grid, or the joint grid (``sample_joint`` per stratum, then Liljegren). Either way the
   WBGT error grid (grid minus ``raw_wbgt``) is conformalised against ``y_wbgt`` like the other targets, so the WBGT
   interval is calibrated for the H2 coverage test.

WBGT is carried two ways (pre-registration section 3.1, ADR 0007), and the section 6.3 selection rule picks one:

* **joint**: ``wbgt_joint_grid`` runs Liljegren on 50 joint (T, Td, wind) samples and takes their quantiles. The
  computation is ``domain.forecast.sampling.wbgt_joint_grid`` (arrays in, so serving code can use it without importing
  this package); this module only maps a gold-shaped row frame onto its arguments.
* **direct**: ``wbgt_direct_grid`` is the WBGT quantile model's grid.

Both grids are *distribution* grids only up to the caller's own arithmetic: the joint grid is already in WBGT units (the
samples were corrected values), the direct grid is an ERROR grid (truth minus forecast, like every target here) to which
the caller adds the raw forecast WBGT and then the conformal offsets.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Final

import lightgbm as lgb
import numpy as np
import polars as pl
import structlog
from numpy.typing import NDArray

from stellar_blaze.adapters.compute.lgbm_corrector import predict_grid
from stellar_blaze.domain.config.models import MODEL_ID
from stellar_blaze.domain.forecast.conformal import (
    STRATUM_BLOCKS,
    ConformalOffsets,
    apply_offsets,
    block_indices,
    lead_values,
    stratum_key,
)
from stellar_blaze.domain.forecast.features import FeatureSet, FoldStats, Target, build_features, fit_fold_stats
from stellar_blaze.domain.forecast.features import history_features as _history_features
from stellar_blaze.domain.forecast.grid import F64, cdf
from stellar_blaze.domain.forecast.sampling import (
    MIN_COPULA_ROWS,
    WbgtJointGrid,
    fit_copula,
    sample_joint,
)
from stellar_blaze.domain.forecast.sampling import wbgt_joint_grid as _wbgt_joint_grid
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.stations import station
from stellar_blaze.ml.conformal import calibration_mask, fit_mask, fit_symmetric_offsets
from stellar_blaze.ml.quantile_models import feature_matrix, fit_quantile_models
from stellar_blaze.ml.training_config import TrainingConfig

__all__ = [
    "TrainedCorrector",
    "fit_stratum_copulas",
    "model_id",
    "reject_thin_wbgt_rows",
    "train_corrector",
    "value_grid",
    "wbgt_direct_grid",
    "wbgt_joint_grid",
]

_log = structlog.get_logger(__name__)

_ROW_COLUMNS = ("station", "valid_time", "fc_sw_wm2", "fc_direct_wm2", "fc_pressure_hpa")


def _float_column(rows: pl.DataFrame, name: str) -> F64:
    """A column as float64, a null as NaN (the solver rejects it as non-finite input, like the gold build does)."""
    return rows[name].cast(pl.Float64()).to_numpy().astype("float64", copy=False)


def wbgt_joint_grid(samples: F64, rows: pl.DataFrame) -> WbgtJointGrid:
    """The WBGT quantile grid of joint samples, from a gold-shaped row frame (``GOLD_PAIRS_SCHEMA`` columns).

    The radiation and pressure are the FORECAST's own (``fc_sw_wm2``, ``fc_direct_wm2``, ``fc_pressure_hpa``), never the
    ``ref_*`` reference columns: the corrected WBGT is compared with a truth built from the reference radiation, but its
    uncertainty is that of the forecast, which carries its own radiation, exactly as the gold ``wbgt_fc_c`` does. The
    coordinates are the station's (``STATIONS``, as ``build_pairs``) and the time is ``valid_time`` (UTC-aware).

    Args:
        samples: ``(n, n_samples, 3)`` value samples of (t, td, wind), row ``i`` belonging to ``rows`` row ``i``.
        rows: The frame, with columns ``station``, ``valid_time``, ``fc_sw_wm2``, ``fc_direct_wm2`` and
            ``fc_pressure_hpa``.

    Returns:
        ``WbgtJointGrid``: the ``(n, 19)`` quantiles and the per-row count of finite samples (a row with some rejected
        samples uses the finite ones; a row with none is all-NaN with count 0).

    Raises:
        ValueError: A column is missing or ``valid_time`` holds a null, or ``samples`` has a different number of rows.
        KeyError: A station is not one of ``STATIONS``.
    """
    missing = [name for name in _ROW_COLUMNS if name not in rows.columns]
    if missing:
        raise ValueError(f"the frame lacks the columns {missing}")
    if samples.shape[0] != rows.height:
        raise ValueError(f"samples has {samples.shape[0]} rows but the frame has {rows.height}")
    if rows["valid_time"].null_count() or rows["station"].null_count():
        raise ValueError("station and valid_time must not be null")
    where = {icao: station(icao) for icao in rows["station"].unique().to_list()}
    lat = rows["station"].replace_strict({icao: s.lat for icao, s in where.items()}, return_dtype=pl.Float64())
    lon = rows["station"].replace_strict({icao: s.lon for icao, s in where.items()}, return_dtype=pl.Float64())
    return _wbgt_joint_grid(
        samples,
        valid_time=rows["valid_time"].to_list(),
        lat=lat.to_numpy(),
        lon=lon.to_numpy(),
        sw_wm2=_float_column(rows, "fc_sw_wm2"),
        direct_wm2=_float_column(rows, "fc_direct_wm2"),
        pressure_hpa=_float_column(rows, "fc_pressure_hpa"),
    )


def wbgt_direct_grid(boosters: Sequence[lgb.Booster], x: F64) -> F64:
    """The sorted ``(n, 19)`` grid of predicted WBGT ERROR quantiles (truth minus forecast) of the direct model.

    The same convention as every other target (``predict_grid``): the caller adds the raw forecast WBGT
    (``wbgt_fc_c``) and then the conformal offsets to get corrected WBGT quantiles.

    Raises:
        ValueError: There are not 19 boosters, or ``x`` is not a 2-D float64 array.
    """
    return predict_grid(boosters, x)


# === train_corrector ================================================================================================

_IFS_MODEL: Final = NwpModel.ECMWF_IFS025.value
_SHA256: Final = re.compile(r"^[0-9a-f]{64}$")
_GIT_SHA: Final = re.compile(r"^[0-9a-f]{7,40}$")
_JOINT_TARGETS: Final = (Target.T, Target.TD, Target.WIND)
"""The three variables that are boosted whatever the WBGT method, and the order of the copula's columns."""
_CALENDAR_COLUMNS: Final = ("station", "model", "valid_time", "lead_days")
_TRUTH_COLUMNS: Final = tuple(f"y_{target.value}" for target in Target)
_N_BLOCKS: Final = len(STRATUM_BLOCKS)


@dataclass(frozen=True, eq=False)
class TrainedCorrector:
    """A trained corrector: boosters, conformal offsets, copulas and the statistics its features need.

    ``eq=False`` because boosters, arrays and frames have no scalar equality. Everything is what ``train_corrector``
    fitted; ``write_model`` stores it and the serving adapter reads it back.

    Attributes:
        cfg: The training config.
        cfg_sha256: SHA-256 of the config file (the ``cfg6`` of the model id).
        boosters: Target to its 19 boosters in ``LEVELS`` order. They predict ERROR quantiles (truth minus forecast).
            WBGT has boosters only when ``cfg.wbgt_method == "direct"``.
        offsets: The conformal offsets of all four targets (WBGT included, whichever method carries it), one stratum
            per ``cfg.leads`` x hour-block.
        copulas: Stratum key ``"<lead>|<block>"`` to the 3x3 correlation of (t, td, wind).
        copula_fallback: The strata whose own PIT sample was too thin and that took the lead-pooled correlation.
        stats: The fold statistics (climatology) the features were built with.
        train_rows: Rows the quantile models were fitted on (before each target drops the rows without its truth).
        cal_rows: Calibration rows.
        wbgt_rejected_rows: Calibration rows whose joint WBGT grid rests on fewer than ``n_joint_samples / 2`` finite
            samples (no usable forecast input, or the solver rejected the samples); they are treated as missing and left
            out of the WBGT offsets. Always 0 for the direct method.
        summers: The summers of the fit and calibration rows.
        stations: The stations of the fit and calibration rows (for the model card).
    """

    cfg: TrainingConfig
    cfg_sha256: str
    boosters: Mapping[Target, tuple[lgb.Booster, ...]]
    offsets: ConformalOffsets
    copulas: Mapping[str, F64]
    copula_fallback: tuple[str, ...]
    stats: FoldStats
    train_rows: int
    cal_rows: int
    wbgt_rejected_rows: int
    summers: tuple[int, ...] = ()
    stations: tuple[str, ...] = ()


def model_id(created: date, git_sha: str, cfg_sha256: str) -> str:
    """``corrector-<yyyymmdd>-<git_sha[:7]>-<cfg_sha256[:6]>``, the id that B1's ``ModelManifest`` accepts.

    Raises:
        ValueError: ``git_sha`` is not 7 to 40 lowercase hex characters, or ``cfg_sha256`` is not 64.
    """
    if not _GIT_SHA.match(git_sha):
        raise ValueError(f"git_sha must be 7 to 40 lowercase hex characters, got {git_sha!r}")
    if not _SHA256.match(cfg_sha256):
        raise ValueError(f"cfg_sha256 must be 64 lowercase hex characters, got {cfg_sha256!r}")
    identifier = f"corrector-{created:%Y%m%d}-{git_sha[:7]}-{cfg_sha256[:6]}"
    if not re.fullmatch(MODEL_ID, identifier):  # cannot happen after the checks above; the manifest regex is the law
        raise ValueError(f"{identifier!r} does not match the model id pattern {MODEL_ID}")
    return identifier


def value_grid(error_grid: F64, raw: F64, target: Target) -> F64:
    """The VALUE quantile grid of a target: the raw forecast plus the error grid, wind clipped at 0.

    The corrected wind is never negative (pre-registration 3.1). The clip keeps the rows sorted (it is monotone) and
    makes ties at 0, which ``grid.cdf`` and ``grid.ppf`` handle. A row whose raw forecast is NaN comes back all-NaN.

    Args:
        error_grid: ``(n, 19)`` sorted error quantiles (``predict_grid``, optionally conformalised).
        raw: ``(n,)`` raw forecast of the target (NaN where missing).
        target: The variable.
    """
    grid = np.asarray(error_grid, dtype=np.float64) + np.asarray(raw, dtype=np.float64)[:, None]
    return np.asarray(np.maximum(grid, 0.0) if target is Target.WIND else grid, dtype=np.float64)


def reject_thin_wbgt_rows(grid: F64, n_finite: NDArray[np.int64], n_samples: int) -> tuple[F64, int]:
    """Rows of a joint WBGT grid that rest on fewer than ``n_samples / 2`` finite samples become all-NaN (R30).

    A row with some rejected samples still has a grid from the finite ones, but one that rests on a minority of the
    draws is no distribution of the forecast: it is treated as missing, so it is excluded from the offsets.

    Returns:
        A new grid and the number of rows set to NaN, counting rows that were all-NaN already.
    """
    thin = np.asarray(n_finite) < n_samples / 2.0
    return np.where(thin[:, None], np.nan, np.asarray(grid, dtype=np.float64)), int(thin.sum())


def _floats(frame: pl.DataFrame, name: str) -> F64:
    """A column as a float64 array, a null as NaN."""
    return frame[name].cast(pl.Float64()).fill_null(float("nan")).to_numpy().astype(np.float64, copy=False)


def _stratum_codes(lead: NDArray[np.int8], block: pl.Series) -> NDArray[np.int64]:
    """``lead * 3 + block index`` of each row (the stratum id of ``ml.conformal``)."""
    rows = len(lead)
    return lead_values(lead, rows) * _N_BLOCKS + block_indices(block, rows).astype(np.int64)


def _key_of(code: int) -> str:
    lead_id, block_index = divmod(code, _N_BLOCKS)
    return stratum_key(lead_id, STRATUM_BLOCKS[block_index])


def fit_stratum_copulas(
    pit: F64, lead: NDArray[np.int8], block: Sequence[str] | pl.Series, *, leads: Sequence[int]
) -> tuple[dict[str, F64], tuple[str, ...]]:
    """One Gaussian-copula correlation per ``<lead>|<block>`` stratum, thin strata pooled over the lead's blocks.

    A stratum with at least ``MIN_COPULA_ROWS`` rows whose PIT is finite in all three variables keeps its own
    ``fit_copula`` correlation. A thinner one (including a stratum with no row) takes the correlation of its lead pooled
    over all hour-blocks and is listed in the returned fallback. If the pooled lead is thin too, an error is raised: a
    correlation is never invented.

    Args:
        pit: ``(n, 3)`` PIT values of (t, td, wind); NaN where a variable has no truth.
        lead: Lead in days of each row.
        block: Hour-block of each row.
        leads: The leads that need a copula (all of ``cfg.leads``), whether or not they have rows.

    Returns:
        The correlation per stratum key (every lead x block) and the fallback keys in lead-then-block order.

    Raises:
        ValueError: A lead's pooled rows are too few, or ``fit_copula`` rejects a sample.
    """
    rows = pit.shape[0]
    lead_ids = lead_values(lead, rows)
    block_ids = block_indices(block, rows)
    usable = np.isfinite(pit).all(axis=1)
    copulas: dict[str, F64] = {}
    fallback: list[str] = []
    for lead_id in sorted(leads):
        in_lead = lead_ids == lead_id
        pooled: F64 | None = None
        for block_index, block_name in enumerate(STRATUM_BLOCKS):
            key = stratum_key(lead_id, block_name)
            chosen = in_lead & (block_ids == block_index)
            if int(usable[chosen].sum()) >= MIN_COPULA_ROWS:
                copulas[key] = fit_copula(pit[chosen])
                continue
            if pooled is None:
                available = int(usable[in_lead].sum())
                if available < MIN_COPULA_ROWS:
                    raise ValueError(
                        f"lead {lead_id} has {available} rows with a finite PIT over all hour-blocks, fewer than "
                        f"MIN_COPULA_ROWS={MIN_COPULA_ROWS}, so stratum {key} has no lead-pooled copula to fall back to"
                    )
                pooled = fit_copula(pit[in_lead])
            copulas[key] = pooled
            fallback.append(key)
    return copulas, tuple(fallback)


def _joint_wbgt_grid(
    cal: pl.DataFrame,
    values: Mapping[Target, F64],
    copulas: Mapping[str, F64],
    cfg: TrainingConfig,
    codes: NDArray[np.int64],
) -> tuple[F64, int]:
    """The pre-conformal joint WBGT value grid of the calibration rows, and how many rows were rejected (R30)."""
    grid = np.full((cal.height, 19), np.nan, dtype=np.float64)
    n_finite = np.zeros(cal.height, dtype=np.int64)
    for code in np.unique(codes).tolist():
        chosen = codes == code
        samples = sample_joint(
            [values[target][chosen] for target in _JOINT_TARGETS],
            copulas[_key_of(code)],
            n_samples=cfg.n_joint_samples,
            seed=cfg.sample_seed,
        )
        result = wbgt_joint_grid(samples, cal.filter(pl.Series(chosen)))
        grid[chosen], n_finite[chosen] = result.grid, result.n_finite
    return reject_thin_wbgt_rows(grid, n_finite, cfg.n_joint_samples)


def train_corrector(pairs: pl.DataFrame, cfg: TrainingConfig, *, cfg_sha256: str) -> TrainedCorrector:
    """Fit the boosters, the conformal offsets and the copulas of one corrector (see the module docstring).

    ``pairs`` are gold-shaped dev rows (``GOLD_PAIRS_SCHEMA``: the IFS spine and the GFS rows, leads 1 to 7, UTC hours
    02 to 15, with the truth columns). The caller restricts them to the rows the model may see (a fold, a cluster); the
    function derives its own splits from the dates, never from a flag in the frame.

    Args:
        pairs: The rows described above. Their IFS leads must all be in ``cfg.leads``.
        cfg: The training config.
        cfg_sha256: SHA-256 of the config file (``load_training_config``).

    Returns:
        The ``TrainedCorrector``.

    Raises:
        ValueError: ``cfg_sha256`` is malformed; a required column is missing; an IFS row has a lead outside
            ``cfg.leads`` (lead 0 included); there are no calibration rows, or a ``<lead>|<block>`` stratum of
            ``cfg.leads`` has none; a stratum is too thin to calibrate even pooled over its lead; or a copula cannot be
            fitted. An error is raised rather than a thin estimate being invented.
    """
    if not _SHA256.match(cfg_sha256):
        raise ValueError(f"cfg_sha256 must be 64 lowercase hex characters, got {cfg_sha256!r}")
    missing = [name for name in _CALENDAR_COLUMNS if name not in pairs.columns]
    if missing:
        raise ValueError(f"pairs lacks the required columns {missing}")
    stray = sorted(set(pairs.filter(pl.col("model") == _IFS_MODEL)["lead_days"].unique().to_list()) - set(cfg.leads))
    if stray:
        raise ValueError(
            f"the IFS rows hold lead(s) {stray} outside the config's leads {cfg.leads} (lead 0 is never used)"
        )
    window = cfg.calibration_window

    # Splits by date, before any statistic is fitted, so the statistics can be restricted to the rows that are used.
    summer = pl.col("summer") if "summer" in pairs.columns else pl.col("valid_time").dt.year().cast(pl.Int16())
    calendar = pairs.select(pl.col("valid_time").dt.date().alias("valid_date"), summer.alias("summer"))
    stats = fit_fold_stats(pairs.filter(fit_mask(calendar, window) | calibration_mask(calendar, window)))
    history = _history_features(pairs) if cfg.feature_set is FeatureSet.SITE else None
    frame = build_features(pairs, feature_set=cfg.feature_set, stats=stats, history=history).filter(
        pl.col("hour_block").is_not_null()
    )
    absent = [name for name in _TRUTH_COLUMNS if name not in frame.columns]
    if absent:
        raise ValueError(f"pairs lacks the truth columns behind {absent}; a corrector cannot be trained without truth")
    in_fit, in_cal = fit_mask(frame, window), calibration_mask(frame, window)
    fit_rows, cal = frame.filter(in_fit), frame.filter(in_cal)
    if cal.height == 0:
        raise ValueError(f"no calibration rows in the {window!r} window")
    lead = cal["lead_days"].cast(pl.Int8()).to_numpy()
    block = cal["hour_block"]
    codes = _stratum_codes(lead, block)
    expected = {stratum_key(lead_id, name) for lead_id in cfg.leads for name in STRATUM_BLOCKS}
    absent_strata = sorted(expected - {_key_of(code) for code in np.unique(codes).tolist()})
    if absent_strata:
        raise ValueError(f"the calibration rows have no row in the strata {absent_strata}")
    _log.info("train.split", fit_rows=fit_rows.height, cal_rows=cal.height, window=window, wbgt=cfg.wbgt_method)

    direct = cfg.wbgt_method == "direct"
    boosted = (*_JOINT_TARGETS, Target.WBGT) if direct else _JOINT_TARGETS
    boosters = {target: fit_quantile_models(fit_rows, target=target, cfg=cfg) for target in boosted}

    x_cal = feature_matrix(cal, cfg.feature_set)
    error_grids = {target: predict_grid(boosters[target], x_cal) for target in boosted}
    raw = {target: _floats(cal, f"raw_{target.value}") for target in Target}
    truth_error = {target: _floats(cal, f"y_{target.value}") for target in Target}
    offsets = {
        target: fit_symmetric_offsets(error_grids[target], truth_error[target], lead, block, target=target)
        for target in boosted
    }

    values = {
        target: value_grid(
            apply_offsets(error_grids[target], lead, block, offsets[target], target), raw[target], target
        )
        for target in _JOINT_TARGETS
    }
    pit = np.stack([cdf(values[target], raw[target] + truth_error[target]) for target in _JOINT_TARGETS], axis=1)
    copulas, copula_fallback = fit_stratum_copulas(pit, lead, block, leads=cfg.leads)

    rejected = 0
    if not direct:
        joint, rejected = _joint_wbgt_grid(cal, values, copulas, cfg, codes)
        offsets[Target.WBGT] = fit_symmetric_offsets(
            joint - raw[Target.WBGT][:, None], truth_error[Target.WBGT], lead, block, target=Target.WBGT
        )
    merged = offsets[Target.T].merge(offsets[Target.TD]).merge(offsets[Target.WIND]).merge(offsets[Target.WBGT])
    for name, strata in merged.offsets.items():
        if set(strata) != expected:
            raise ValueError(f"the {name} offsets cover {sorted(set(strata) ^ expected)} differently from the config")

    used = frame.filter(in_fit | in_cal)
    return TrainedCorrector(
        cfg=cfg,
        cfg_sha256=cfg_sha256,
        boosters=boosters,
        offsets=merged,
        copulas=copulas,
        copula_fallback=copula_fallback,
        stats=stats,
        train_rows=fit_rows.height,
        cal_rows=cal.height,
        wbgt_rejected_rows=rejected,
        summers=tuple(sorted(int(year) for year in used["summer"].unique().to_list())),
        stations=tuple(sorted(str(icao) for icao in used["station"].unique().to_list())),
    )
