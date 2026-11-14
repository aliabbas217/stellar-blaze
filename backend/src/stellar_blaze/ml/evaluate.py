"""The development evaluation harness: out-of-fold predictions of the corrector and baselines, and skill tables.

Two runs produce an ``OofPredictions``:

* ``evaluate_dev`` is leave-one-cluster-out (LOCO) over the six clusters of ``STATIONS`` (pre-registration 2.2, 2.3):
  each fold trains on the other clusters and predicts the held-out one, both dev summers. It is what every selection
  rule of section 6 reads.
* ``evaluate_summer_split`` is the 2026-like diagnostic (ruling R23, never used for selection): train on one dev summer,
  predict the other, all clusters, in both directions.

Fold isolation (L3, L4, L6, L7). Per fold the training frame is ``regimes.split``'s train side and nothing else touches
the model: ``train_corrector`` fits the climatology, boosters, conformal offsets and copulas on it; the baselines
(``fit_baselines`` with ``pooled=True``, so a held-out station's own bias is never used) are fitted on the same fit and
calibration rows' features, built with the same fold statistics. The test side only supplies rows to predict. Its
station history ``bias7_*`` is built from the test frame's own earlier truth, which L3 allows (a valid date at or before
the issue day minus one); its station climatology ``sclim_*`` is absent from the fold statistics (the station was never
in training), so it is null for a held-out station: that is the design, not a defect. Perturbation tests pin this.

The baselines always get the station history (B3 and B3d are pre-registered baselines whatever the corrector's feature
set), so the feature frames are built as the ``site`` set; a ``cold`` corrector reads only its own columns of them.

Memory. A real run is about 218,000 rows, each held-out fold about 36,000. Per fold the frames and arrays are freed
before the next; the per-fold grids are kept as float64 arrays and joined key by key (no wide frame, no per-row loop).

Sign conventions. ``y_*`` in ``OofPredictions.keys`` is the ERROR truth minus forecast (``build_features``), so the
truth is ``raw_* + y_*`` (``truth``); ``bias`` in the skill table is the median forecast minus the truth.
"""

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Final

import numpy as np
import polars as pl
import structlog
from numpy.typing import NDArray

from stellar_blaze.domain.forecast.features import (
    FeatureSet,
    Target,
    build_features,
    feature_columns,
    history_features,
)
from stellar_blaze.domain.forecast.grid import F64, LEVELS, exceedance_probability
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.ml import metrics
from stellar_blaze.ml.baselines import Baseline, fit_baselines, predict_baseline
from stellar_blaze.ml.bootstrap import DEFAULT_SEED, paired_block_bootstrap
from stellar_blaze.ml.conformal import calibration_mask, fit_mask
from stellar_blaze.ml.data import DEV_SUMMERS, TEST_SUMMER, HoldoutViolationError
from stellar_blaze.ml.predict import corrected_grids
from stellar_blaze.ml.regimes import CLUSTERS, Fold, loco_folds, split
from stellar_blaze.ml.train import TrainedCorrector, train_corrector
from stellar_blaze.ml.training_config import TrainingConfig

__all__ = [
    "BRIER_THRESHOLDS_C",
    "CORRECTOR",
    "OofPredictions",
    "coverage_by_forecast_tercile",
    "evaluate_dev",
    "evaluate_summer_split",
    "skill_table",
    "truth",
]

_log = structlog.get_logger(__name__)

CORRECTOR: Final = "corrector"
"""The model name of the corrector in ``OofPredictions.grids`` and in the skill table's columns."""

BRIER_THRESHOLDS_C: Final[tuple[float, ...]] = (28.0, 30.0, 32.0)
"""The WBGT events of pre-registration 7.1 (degrees Celsius)."""

_IFS: Final = NwpModel.ECMWF_IFS025.value
_MEDIAN: Final = LEVELS.index(0.5)
_N_LEVELS: Final = len(LEVELS)
_BASELINES_JOINT: Final = (Baseline.B0, Baseline.B0D, Baseline.B2D, Baseline.B3D, Baseline.B4)
_BASELINES_WBGT: Final = (Baseline.B0, Baseline.B0D, Baseline.B2D, Baseline.B4)  # B3 needs bias7: t, td, wind only
_KEY_COLUMNS: Final = (
    "station",
    "cluster",
    "summer",
    "valid_time",
    "lead_days",
    "hour_utc",
    "hour_block",
    "valid_date",
    "wbgt_fc_c",
    *(f"raw_{target.value}" for target in Target),
    *(f"y_{target.value}" for target in Target),
)
_GROUP_COLUMNS: Final = ("target", "lead_days", "hour_block", "cluster", "station", "fold")
_WORKING_HOURS: Final = range(6, 15)  # UTC 06-14, the working daytime (pre-registration 7.1)
_BLOCKS: Final = ("early", "peak", "late")
_PAIRS: Final = ((0.05, 0.95), (0.10, 0.90), (0.25, 0.75))  # the calibrated pairs of 7.1
_PAIR_NAMES: Final = ("90", "80", "50")
_PIT_BINS: Final = 10
_TERCILE_NAMES: Final = ("low", "mid", "high")


@dataclass(frozen=True, eq=False)
class OofPredictions:
    """Out-of-fold predictions of the corrector and the baselines, aligned row by row.

    ``eq=False`` because frames and arrays have no scalar equality.

    Attributes:
        keys: One row per scored-or-not test row of every fold: the ``build_features`` key columns (``station``,
            ``cluster``, ``summer``, ``valid_time``, ``lead_days``, ``hour_utc``, ``hour_block``, ``valid_date``), the
            forecast WBGT ``wbgt_fc_c``, the raw forecasts ``raw_<target>``, the ERROR truths ``y_<target>`` (truth
            minus forecast, null where unscored) and ``fold``. Every dev row is a test row of exactly one fold.
        grids: ``(target, model)`` to the predictions aligned with ``keys``: ``(n, 19)`` sorted VALUE grids for the
            corrector (``"corrector"``) and the dressed baselines (``"b0d"``, ``"b2d"``, ``"b3d"`` for t, td, wind
            only, ``"b4"``), ``(n,)`` for the deterministic raw forecast ``"b0"``. NaN rows are missing forecasts.
        samples: The corrector's joint (t, td, wind) samples ``(m, n_joint_samples, 3)`` for the clusters asked for, or
            ``None``.
        sample_index: The ``m`` row positions in ``keys`` that ``samples`` belongs to, or ``None``.
        base_rates: Columns ``fold``, ``hour_block``, ``threshold_c``, ``rate``, ``n``: the share of the fold's TRAINING
            rows with a scored truth WBGT at or above the threshold, per hour-block (the climatological reference of the
            Brier skill score; no test truth in it).
        tercile_edges: The two edges of the forecast-WBGT terciles (``wbgt_fc_c`` over every dev row; forecast values
            only, no truth), used by ``coverage_by_forecast_tercile``.
        fallbacks: Columns ``fold``, ``target``, ``model``, ``n_rows``, ``n_fallback``: test rows (with a raw forecast)
            for which B3d (null ``bias7``) or B4 (a null cold feature) fell back to B2d.
    """

    keys: pl.DataFrame
    grids: dict[tuple[Target, str], F64]
    samples: F64 | None
    sample_index: NDArray[np.int64] | None
    base_rates: pl.DataFrame
    tercile_edges: tuple[float, float]
    fallbacks: pl.DataFrame

    def models(self, target: Target) -> tuple[str, ...]:
        """The models that have a prediction for ``target``, the corrector first."""
        names = [model for (t, model) in self.grids if t is target]
        return tuple(sorted(names, key=lambda name: (name != CORRECTOR, name)))


def truth(oof: OofPredictions, target: Target) -> F64:
    """The truth of ``target`` per row, ``raw + y`` (NaN where unscored)."""
    raw = oof.keys[f"raw_{target.value}"].cast(pl.Float64()).fill_null(float("nan")).to_numpy()
    error = oof.keys[f"y_{target.value}"].cast(pl.Float64()).fill_null(float("nan")).to_numpy()
    return np.asarray(raw + error, dtype=np.float64)


# === the folds ======================================================================================================


def _refuse_holdout(pairs: pl.DataFrame) -> None:
    """Raise before anything is computed if the frame holds summer 2026 (by ``summer`` or the year of the time)."""
    years = set(pairs["valid_time"].dt.year().unique().to_list())
    summers = set(pairs["summer"].unique().to_list()) if "summer" in pairs.columns else set()
    if TEST_SUMMER in years or TEST_SUMMER in summers:
        raise HoldoutViolationError(
            f"the frame holds summer {TEST_SUMMER}, the hold-out: this harness works on {sorted(DEV_SUMMERS)}"
        )


def _check_input(pairs: pl.DataFrame, cfg: TrainingConfig) -> None:
    _refuse_holdout(pairs)
    missing = [name for name in ("cluster", "summer", "model", "lead_days") if name not in pairs.columns]
    if missing:
        raise ValueError(f"pairs lacks the columns {missing}")
    stray = sorted(set(pairs.filter(pl.col("model") == _IFS)["lead_days"].unique().to_list()) - set(cfg.leads))
    if stray:
        raise ValueError(
            f"the IFS rows hold lead(s) {stray} outside the config's leads {cfg.leads} (lead 0 is never used)"
        )


@dataclass(frozen=True, eq=False)
class _FoldOutput:
    keys: pl.DataFrame
    grids: dict[tuple[Target, str], F64]
    samples: F64 | None
    sample_rows: NDArray[np.int64] | None  # positions inside this fold's keys
    base_rates: pl.DataFrame
    fallbacks: pl.DataFrame


def _fit_and_test_frames(
    train: pl.DataFrame, test: pl.DataFrame, trained: TrainedCorrector
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """The baselines' training rows and the test rows as ``site`` feature frames under the fold's statistics.

    Training rows are the fit and calibration rows of the training clusters (the rows the corrector sees too); the
    test rows are every modelled test row.
    """
    window = trained.cfg.calibration_window
    train_features = build_features(
        train, feature_set=FeatureSet.SITE, stats=trained.stats, history=history_features(train)
    ).filter(pl.col("hour_block").is_not_null())
    train_features = train_features.filter(fit_mask(train_features, window) | calibration_mask(train_features, window))
    test_features = build_features(
        test, feature_set=FeatureSet.SITE, stats=trained.stats, history=history_features(test)
    ).filter(pl.col("hour_block").is_not_null())
    return train_features, test_features


def _base_rates(fold: str, train_features: pl.DataFrame) -> pl.DataFrame:
    """Per hour-block share of the training rows with a scored WBGT truth at or above each threshold."""
    scored = train_features.filter((pl.col("y_wbgt").is_finite()) & pl.col("raw_wbgt").is_finite()).select(
        "hour_block", (pl.col("raw_wbgt") + pl.col("y_wbgt")).alias("truth")
    )
    parts = [
        scored.group_by("hour_block")
        .agg((pl.col("truth") >= threshold).mean().alias("rate"), pl.len().alias("n"))
        .with_columns(pl.lit(threshold).alias("threshold_c"), pl.lit(fold).alias("fold"))
        for threshold in BRIER_THRESHOLDS_C
    ]
    return pl.concat(parts).select("fold", "hour_block", "threshold_c", "rate", "n").sort("threshold_c", "hour_block")


def _fallback_rows(fold: str, test_features: pl.DataFrame) -> pl.DataFrame:
    """How many test rows B3d and B4 sent to their B2d fallback (counted here, from the rows, never from the model)."""
    cold = list(feature_columns(FeatureSet.COLD))
    no_cold = pl.any_horizontal(pl.col(name).is_null() for name in cold)
    rows: list[dict[str, object]] = []
    for target in Target:
        has_raw = pl.col(f"raw_{target.value}").is_not_null()
        n_rows = test_features.filter(has_raw).height
        counts: dict[str, int] = {Baseline.B4.value: test_features.filter(has_raw & no_cold).height}
        if target is not Target.WBGT:
            counts[Baseline.B3D.value] = test_features.filter(
                has_raw & pl.col(f"bias7_{target.value}").is_null()
            ).height
        rows.extend(
            {"fold": fold, "target": target.value, "model": model, "n_rows": n_rows, "n_fallback": n}
            for model, n in counts.items()
        )
    return pl.DataFrame(
        rows,
        schema={
            "fold": pl.String(),
            "target": pl.String(),
            "model": pl.String(),
            "n_rows": pl.Int64(),
            "n_fallback": pl.Int64(),
        },
    )


def _run_fold(
    pairs: pl.DataFrame, fold: Fold, cfg: TrainingConfig, cfg_sha256: str, sample_clusters: Collection[str]
) -> _FoldOutput:
    """Train on ``fold``'s training rows, predict its test rows with the corrector and every baseline."""
    train, test = split(pairs, fold)
    _log.info("evaluate.fold", fold=fold.name, train_rows=train.height, test_rows=test.height)
    trained = train_corrector(train, cfg, cfg_sha256=cfg_sha256)
    train_features, test_features = _fit_and_test_frames(train, test, trained)
    del train, test
    keys = test_features.select(_KEY_COLUMNS).with_columns(pl.lit(fold.name).alias("fold"))

    wanted = test_features["cluster"].is_in(sorted(sample_clusters)).to_numpy() if sample_clusters else None
    sample_rows = np.flatnonzero(wanted).astype(np.int64) if wanted is not None and wanted.any() else None
    grids: dict[tuple[Target, str], F64] = {}
    samples: F64 | None = None
    if sample_rows is None:
        corrected = corrected_grids(trained, test_features)
    else:
        corrected, all_samples = corrected_grids(trained, test_features, joint_samples=True)
        samples = np.ascontiguousarray(all_samples[sample_rows])
        del all_samples
    for target, grid in corrected.items():
        grids[(target, CORRECTOR)] = grid
    for target in Target:
        model = fit_baselines(train_features, target=target, pooled=True)
        for baseline in _BASELINES_WBGT if target is Target.WBGT else _BASELINES_JOINT:
            grids[(target, baseline.value)] = predict_baseline(model, test_features, baseline)
    base_rates = _base_rates(fold.name, train_features)
    fallbacks = _fallback_rows(fold.name, test_features)
    return _FoldOutput(keys, grids, samples, sample_rows, base_rates, fallbacks)


def _assemble(outputs: list[_FoldOutput], sample_clusters: Collection[str]) -> OofPredictions:
    """Join the per-fold outputs, one grid key at a time (each fold's array is released as it is copied in)."""
    sizes = [output.keys.height for output in outputs]
    offsets = np.concatenate([[0], np.cumsum(sizes)]).astype(np.int64)
    keys = pl.concat([output.keys for output in outputs])
    grids: dict[tuple[Target, str], F64] = {}
    for key in list(outputs[0].grids):
        shape = outputs[0].grids[key].shape[1:]
        joined = np.empty((int(offsets[-1]), *shape), dtype=np.float64)
        for output, begin, end in zip(outputs, offsets[:-1], offsets[1:], strict=True):
            joined[begin:end] = output.grids.pop(key)
        grids[key] = joined
    samples: F64 | None = None
    sample_index: NDArray[np.int64] | None = None
    if any(output.samples is not None for output in outputs):
        kept = [
            (output, int(begin))
            for output, begin in zip(outputs, offsets[:-1], strict=True)
            if output.samples is not None
        ]
        samples = np.concatenate([output.samples for output, _ in kept if output.samples is not None])
        sample_index = np.concatenate(
            [begin + output.sample_rows for output, begin in kept if output.sample_rows is not None]
        ).astype(np.int64)
    forecast = keys["wbgt_fc_c"].cast(pl.Float64()).to_numpy()
    forecast = forecast[np.isfinite(forecast)]
    if forecast.size == 0:
        raise ValueError("no row has a finite forecast WBGT: the terciles cannot be computed")
    edge_low, edge_high = (float(edge) for edge in np.quantile(forecast, [1.0 / 3.0, 2.0 / 3.0]))
    _log.info("evaluate.done", rows=keys.height, folds=len(outputs), sample_clusters=sorted(sample_clusters))
    return OofPredictions(
        keys=keys,
        grids=grids,
        samples=samples,
        sample_index=sample_index,
        base_rates=pl.concat([output.base_rates for output in outputs]),
        tercile_edges=(edge_low, edge_high),
        fallbacks=pl.concat([output.fallbacks for output in outputs]),
    )


def _run(
    pairs: pl.DataFrame, folds: Sequence[Fold], cfg: TrainingConfig, cfg_sha256: str, sample_clusters: Collection[str]
) -> OofPredictions:
    outputs: list[_FoldOutput] = []
    for fold in folds:
        outputs.append(_run_fold(pairs, fold, cfg, cfg_sha256, sample_clusters))
    return _assemble(outputs, sample_clusters)


def evaluate_dev(
    pairs: pl.DataFrame,
    cfg: TrainingConfig,
    *,
    cfg_sha256: str,
    clusters: Sequence[str] | None = None,
    sample_clusters: Collection[str] = (),
) -> OofPredictions:
    """Leave-one-cluster-out out-of-fold predictions of the corrector and the baselines (module docstring).

    Folds are ``loco_folds`` of the summers in ``pairs``: ``dubai_sharjah`` holds out OMDB and OMSJ together. Every
    fold fits its statistics, history, offsets, copulas and baselines on the other clusters only (L4, L6): the
    corrector from ``train_corrector``, the baselines B0, B0d, B2d, B3d (t, td, wind) and B4 with ``pooled=True``.

    Args:
        pairs: Gold-shaped development rows (``load_dev_pairs`` shape: leads 1-7 in ``cfg.leads``, hours 02-15 UTC).
        cfg: The training config of the corrector.
        cfg_sha256: SHA-256 of the config file.
        clusters: The clusters to hold out, in order; ``None`` for all six (each must have rows). A fixture with fewer
            clusters passes the ones it has; the training side is always "every other cluster that has rows".
        sample_clusters: Clusters whose joint (t, td, wind) samples are kept (``OofPredictions.samples``).

    Returns:
        The out-of-fold predictions, rows ordered fold by fold.

    Raises:
        HoldoutViolationError: ``pairs`` holds summer 2026 (checked before anything is computed).
        ValueError: A column is missing, a lead is outside ``cfg.leads`` (lead 0 included), a cluster is unknown, or a
            fold has no training or test rows.
    """
    _check_input(pairs, cfg)
    wanted = tuple(CLUSTERS if clusters is None else clusters)
    unknown = sorted(set(wanted) - set(CLUSTERS))
    if unknown:
        raise ValueError(f"unknown cluster(s) {unknown}; the clusters are {list(CLUSTERS)}")
    summers = frozenset(int(summer) for summer in pairs["summer"].unique().to_list())
    folds = [fold for fold in loco_folds(summers) if next(iter(fold.test_clusters)) in wanted]
    return _run(pairs, folds, cfg, cfg_sha256, sample_clusters)


def evaluate_summer_split(
    pairs: pl.DataFrame, cfg: TrainingConfig, *, cfg_sha256: str, sample_clusters: Collection[str] = ()
) -> OofPredictions:
    """The 2026-like diagnostic (ruling R23; never used for selection): train on one dev summer, test on the other.

    Two folds, ``train2024_test2025`` and ``train2025_test2024``, all clusters on both sides, the same corrector and
    baseline machinery and the same ``OofPredictions`` shape (``fold`` is the fold's name). It measures the in-sample
    climatology asymmetry: the training and calibration features of ``train_corrector`` carry climatology fitted on
    their own summer's days (in-sample), while the test summer's features carry that climatology applied out of
    sample, as 2026 will. A model that leans on the in-sample climatology looks worse here than in the LOCO run, which
    tests on a held-out cluster of the SAME summers.

    Raises:
        HoldoutViolationError: ``pairs`` holds summer 2026.
        ValueError: ``pairs`` does not hold exactly the two dev summers, or as for ``evaluate_dev``.
    """
    _check_input(pairs, cfg)
    summers = sorted(int(summer) for summer in pairs["summer"].unique().to_list())
    if set(summers) != set(DEV_SUMMERS):
        raise ValueError(f"the summer split needs exactly the dev summers {sorted(DEV_SUMMERS)}, got {summers}")
    first, second = summers
    folds = [
        Fold(f"train{a}_test{b}", frozenset(CLUSTERS), frozenset(CLUSTERS), frozenset({a}), frozenset({b}))
        for a, b in ((first, second), (second, first))
    ]
    return _run(pairs, folds, cfg, cfg_sha256, sample_clusters)


# === skill tables ===================================================================================================


def _row_selection(keys: pl.DataFrame, leads: Sequence[int], hours: str) -> NDArray[np.int64]:
    """Positions of the rows with a lead in ``leads`` and the hours of ``hours`` ("all", "working" or a block name)."""
    if not leads:
        raise ValueError("leads must name at least one lead")
    if hours == "all":
        in_hours = pl.lit(True)
    elif hours == "working":
        in_hours = pl.col("hour_utc").is_in(list(_WORKING_HOURS))
    elif hours in _BLOCKS:
        in_hours = pl.col("hour_block") == hours
    else:
        raise ValueError(f"hours must be 'all', 'working' or one of {list(_BLOCKS)}, got {hours!r}")
    mask = keys.select((pl.col("lead_days").is_in(list(leads)) & in_hours).alias("m")).to_series().to_numpy()
    return np.flatnonzero(mask).astype(np.int64)


def _group_columns(by: Sequence[str]) -> list[str]:
    unknown = sorted(set(by) - set(_GROUP_COLUMNS))
    if unknown:
        raise ValueError(f"cannot group by {unknown}; the columns are {list(_GROUP_COLUMNS)}")
    return [name for name in dict.fromkeys(by) if name != "target"]


def _calendar(keys: pl.DataFrame) -> pl.DataFrame:
    """Every UTC date from the first to the last of each summer of the OOF rows, with its position (``_day_ix``).

    The bootstrap needs each season's days dense (a day without a scored row has weight 0), so the calendar is the
    whole OOF's, not the group's.
    """
    spans = keys.group_by("summer").agg(
        pl.col("valid_date").min().alias("first"), pl.col("valid_date").max().alias("last")
    )
    parts = [
        pl.DataFrame(
            {
                "season": pl.Series([int(summer)] * len(days), dtype=pl.Int64()),
                "day": days,
            }
        )
        for summer, first, last in spans.sort("summer").iter_rows()
        for days in [pl.date_range(first, last, interval="1d", eager=True)]
    ]
    return pl.concat(parts).with_row_index("_day_ix")


def _gather(frame: pl.DataFrame, positions: NDArray[np.int64]) -> pl.DataFrame:
    return frame.select(pl.all().gather(pl.Series(positions)))


def _floats(frame: pl.DataFrame, name: str) -> F64:
    return np.asarray(frame[name].cast(pl.Float64()).fill_null(float("nan")).to_numpy(), dtype=np.float64)


@dataclass(frozen=True, eq=False)
class _Scored:
    """The scored rows of one target: per-row scores with their group keys, and the arrays behind them."""

    rows: pl.DataFrame
    scored: NDArray[np.bool_]  # which of the selected rows are scored
    truth: F64  # truth of the scored rows
    grids: dict[str, F64]  # model to the scored rows' grid ((m,) for b0)


def _score_rows(oof: OofPredictions, target: Target, positions: NDArray[np.int64], group: list[str]) -> _Scored:
    """The per-row scores of every model of ``target`` over the selected rows that are scored."""
    models = oof.models(target)
    keys = oof.keys
    count = len(positions)
    y = _floats(keys, f"y_{target.value}")[positions]
    raw = _floats(keys, f"raw_{target.value}")[positions]
    selected = {model: oof.grids[(target, model)][positions] for model in models}
    has_forecast = np.logical_and.reduce(
        [np.isfinite(grid).reshape(count, -1).all(axis=1) for grid in selected.values()]
    )
    scored = np.isfinite(y) & np.isfinite(raw) & has_forecast
    where = np.flatnonzero(scored)
    observed = np.asarray((raw + y)[where], dtype=np.float64)
    grids = {model: np.ascontiguousarray(grid[where]) for model, grid in selected.items()}
    del selected
    columns: dict[str, F64] = {}
    for model, grid in grids.items():
        median = grid if grid.ndim == 1 else grid[:, _MEDIAN]
        columns[f"crps_{model}"] = (
            metrics.crps_deterministic(observed, grid) if grid.ndim == 1 else metrics.crps_grid(observed, grid)
        )
        columns[f"ae_{model}"] = np.abs(median - observed)
        columns[f"se_{model}"] = (median - observed) ** 2
        columns[f"err_{model}"] = median - observed
    corrector = grids[CORRECTOR]
    for level in (0.05, 0.5, 0.95):
        columns[f"pinball_{round(level * 100):02d}"] = metrics.pinball(observed, corrector, level)
    for name, (lower, upper) in zip(_PAIR_NAMES, _PAIRS, strict=True):
        lo, hi = corrector[:, LEVELS.index(lower)], corrector[:, LEVELS.index(upper)]
        columns[f"cov_{name}"] = metrics.covered(observed, lo, hi).astype(np.float64)
        if name != "50":
            columns[f"is_{name}"] = metrics.interval_score(observed, lo, hi, round(1.0 - (upper - lower), 2))
    base = _gather(
        keys.select(list(dict.fromkeys([*group, "summer", "valid_date", "fold", "hour_block"]))), positions[where]
    ).with_columns(pl.lit(0).alias("_g"))
    frame = base.with_columns(*[pl.Series(name, values) for name, values in columns.items()])
    return _Scored(frame, scored, observed, grids)


def _with_brier(oof: OofPredictions, scored: _Scored) -> pl.DataFrame:
    """The rows plus per-row event indicators and Brier scores of the corrector, B2d and the base rate (WBGT)."""
    frame = scored.rows
    extra: list[pl.Series] = []
    for threshold in BRIER_THRESHOLDS_C:
        event = scored.truth >= threshold
        tag = f"{threshold:.0f}"
        rates = oof.base_rates.filter(pl.col("threshold_c") == threshold).select("fold", "hour_block", "rate")
        reference = frame.select("fold", "hour_block").join(
            rates, on=["fold", "hour_block"], how="left", maintain_order="left"
        )["rate"]
        if reference.null_count():
            raise ValueError(f"the training base rate of WBGT >= {tag} is missing for some fold and hour-block")
        extra.append(pl.Series(f"event_{tag}", event.astype(np.float64)))
        extra.append(pl.Series(f"brier_clim_{tag}", metrics.brier(reference.to_numpy(), event)))
        for model, name in ((CORRECTOR, "c"), ("b2d", "b2d")):
            probability = exceedance_probability(scored.grids[model], threshold)
            extra.append(pl.Series(f"brier_{name}_{tag}", metrics.brier(probability, event)))
    return frame.with_columns(*extra)


def _aggregates(models: Sequence[str], frame: pl.DataFrame) -> list[pl.Expr]:
    out: list[pl.Expr] = [
        pl.len().cast(pl.Int64).alias("n_rows"),
        pl.col("valid_date").n_unique().cast(pl.Int64).alias("n_days"),
    ]
    for model in models:
        out += [
            pl.col(f"crps_{model}").mean(),
            pl.col(f"ae_{model}").mean().alias(f"mae_{model}"),
            pl.col(f"se_{model}").mean().sqrt().alias(f"rmse_{model}"),
            pl.col(f"err_{model}").mean().alias(f"bias_{model}"),
        ]
    out += [pl.col(name).mean() for name in ("pinball_05", "pinball_50", "pinball_95", "is_90", "is_80")]
    out += [pl.col(f"cov_{name}").mean() for name in _PAIR_NAMES]
    for name in frame.columns:
        if name.startswith("event_"):
            out.append(pl.col(name).sum().alias(name.replace("event_", "events_")))
        elif name.startswith("brier_"):
            out.append(pl.col(name).mean())
    return out


def _per_group_extras(
    frame: pl.DataFrame,
    scored: _Scored,
    key: list[str],
    models: Sequence[str],
    calendar: pl.DataFrame,
    *,
    n_boot: int,
    intervals: bool,
) -> pl.DataFrame:
    """PIT counts of the corrector and the paired CRPS differences with their bootstrap intervals, per group."""
    pits = metrics.pit(scored.truth, scored.grids[CORRECTOR])
    day_ix = frame.join(
        calendar, left_on=["summer", "valid_date"], right_on=["season", "day"], how="left", maintain_order="left"
    )["_day_ix"].to_numpy()
    size = calendar.height
    numbered = frame.with_row_index("_row").with_columns(pl.Series("_day_ix", day_ix))
    baselines = [model for model in models if model != CORRECTOR]
    rows: list[dict[str, object]] = []
    for group_key, part in numbered.partition_by(key, as_dict=True, maintain_order=True).items():
        index = part["_row"].to_numpy()
        record: dict[str, object] = dict(zip(key, group_key, strict=True))
        record.update({f"pit_{i:02d}": int(c) for i, c in enumerate(metrics.pit_histogram(pits[index], _PIT_BINS))})
        days = part["_day_ix"].to_numpy()
        weight = np.bincount(days, minlength=size).astype(np.float64)
        crps_c = np.bincount(days, weights=part[f"crps_{CORRECTOR}"].to_numpy(), minlength=size)
        for baseline in baselines:
            crps_b = np.bincount(days, weights=part[f"crps_{baseline}"].to_numpy(), minlength=size)
            estimate = float(crps_c.sum() / weight.sum() - crps_b.sum() / weight.sum())
            lo: float | None = None
            hi: float | None = None
            if intervals:
                daily_a = calendar.select("season", "day").with_columns(
                    pl.Series("value", crps_c), pl.Series("weight", weight)
                )
                daily_b = calendar.select("season", "day").with_columns(
                    pl.Series("value", crps_b), pl.Series("weight", weight)
                )
                try:
                    interval = paired_block_bootstrap(
                        daily_a, daily_b, value="value", weight="weight", n_boot=n_boot, seed=DEFAULT_SEED
                    )
                    estimate, lo, hi = interval.estimate, interval.lo, interval.hi
                except ValueError as error:  # a replicate drew only days without scored rows: too sparse
                    _log.warning("skill.bootstrap_skipped", group=list(group_key), reason=str(error))
            record[f"crps_diff_{baseline}"] = estimate
            record[f"crps_diff_{baseline}_lo"] = lo
            record[f"crps_diff_{baseline}_hi"] = hi
        rows.append(record)
    schema: dict[str, pl.DataType | type[pl.DataType]] = {name: frame.schema[name] for name in key}
    for i in range(_PIT_BINS):
        schema[f"pit_{i:02d}"] = pl.Int64
    for baseline in baselines:
        for suffix in ("", "_lo", "_hi"):
            schema[f"crps_diff_{baseline}{suffix}"] = pl.Float64
    return pl.DataFrame(rows, schema=schema)


def _skill_one_target(
    oof: OofPredictions,
    target: Target,
    positions: NDArray[np.int64],
    group: list[str],
    calendar: pl.DataFrame,
    *,
    n_boot: int,
    intervals: bool,
) -> pl.DataFrame:
    scored = _score_rows(oof, target, positions, group)
    key = ["_g", *group]
    models = oof.models(target)
    y = _floats(oof.keys, f"y_{target.value}")[positions]
    meta = _gather(oof.keys.select("summer", *group), positions).with_columns(
        pl.lit(0).alias("_g"),
        pl.Series("_no_truth", ~np.isfinite(y)),
        pl.Series("_no_forecast", np.isfinite(y) & ~scored.scored),
    )
    counts = meta.group_by(key).agg(
        pl.col("_no_truth").sum().cast(pl.Int64).alias("n_no_truth"),
        pl.col("_no_forecast").sum().cast(pl.Int64).alias("n_no_forecast"),
    )
    frame = _with_brier(oof, scored) if target is Target.WBGT else scored.rows
    aggregated = frame.group_by(key).agg(_aggregates(models, frame))
    extras = _per_group_extras(frame, scored, key, models, calendar, n_boot=n_boot, intervals=intervals)
    table = counts.join(aggregated, on=key, how="left", nulls_equal=True).join(
        extras, on=key, how="left", nulls_equal=True
    )
    table = table.with_columns(pl.col("n_rows").fill_null(0))
    if target is Target.WBGT:
        table = table.with_columns(_skill_scores())
    return table.with_columns(pl.lit(target.value).alias("target")).drop("_g")


def _skill_scores() -> list[pl.Expr]:
    """``1 - BS / BS_reference`` for the corrector against the base rate and B2d, and B2d against the base rate."""

    def score(model: str, reference: str, tag: str) -> pl.Expr:
        ref = pl.col(f"brier_{reference}_{tag}")
        return pl.when(ref > 0).then(1.0 - pl.col(f"brier_{model}_{tag}") / ref).alias(f"bss_{model}_{reference}_{tag}")

    tags = [f"{threshold:.0f}" for threshold in BRIER_THRESHOLDS_C]
    return [
        expr for tag in tags for expr in (score("c", "clim", tag), score("c", "b2d", tag), score("b2d", "clim", tag))
    ]


def skill_table(
    oof: OofPredictions,
    *,
    leads: Sequence[int],
    hours: str,
    by: Sequence[str],
    n_boot: int = 2000,
    intervals: bool = True,
) -> pl.DataFrame:
    """The skill table: one row per (target, ``by`` group) over the chosen leads and hours.

    Scored rows. T, Td and wind: rows whose truth exists (``y_*`` finite, so ``has_joint_obs`` was true). WBGT: rows
    whose truth WBGT is finite (the reject-free truth). A row is also dropped when any model of the target has no
    forecast for it, so every model is scored on the same rows (paired comparisons). ``n_rows`` counts the scored rows,
    ``n_days`` their distinct UTC dates, ``n_no_truth`` the selected rows without a truth and ``n_no_forecast`` the rows
    with a truth but a missing forecast. A group whose rows are all unscored appears with ``n_rows`` 0 and null scores.

    Columns (``<model>`` is ``corrector``, ``b0``, ``b0d``, ``b2d``, ``b3d`` (t, td, wind), ``b4``):

    * ``crps_<model>`` (the grid CRPS; B0's is its MAE), ``mae_<model>``, ``rmse_<model>`` (of the median),
      ``bias_<model>`` (median forecast MINUS truth);
    * for the corrector: ``pinball_05``, ``pinball_50``, ``pinball_95``, ``is_90``, ``is_80`` (interval scores of the
      0.05/0.95 and 0.10/0.90 pairs), ``cov_90``, ``cov_80``, ``cov_50`` (coverage of 0.05/0.95, 0.10/0.90 and
      0.25/0.75), ``pit_00`` .. ``pit_09`` counts;
    * ``crps_diff_<baseline>`` with ``_lo`` and ``_hi``: corrector minus baseline mean CRPS and its paired 95%
      moving-block bootstrap interval (7-day blocks, ``n_boot`` replicates, seed 20261112, dense per-summer days with
      weight 0 on unscored days). Negative means the corrector is better. Null bounds where a replicate resampled only
      empty days;
    * WBGT only (null for the other targets): ``events_<t>`` (observed events), ``brier_c_<t>``, ``brier_b2d_<t>``,
      ``brier_clim_<t>`` for ``t`` in 28, 30, 32, and ``bss_c_clim_<t>``, ``bss_c_b2d_<t>``, ``bss_b2d_clim_<t>``
      (``1 - BS / BS_reference``, null where the reference is 0). The climatological reference is the base rate per
      hour-block of the fold's TRAINING rows (``OofPredictions.base_rates``).

    Args:
        oof: The out-of-fold predictions.
        leads: Leads to include.
        hours: ``"working"`` (UTC 06-14), ``"early"``, ``"peak"``, ``"late"`` or ``"all"``.
        by: Grouping columns, any of ``target``, ``lead_days``, ``hour_block``, ``cluster``, ``station``, ``fold``. The
            target is always a group (units differ) and comes first.
        n_boot: Bootstrap replicates (the pre-registration's 2,000).
        intervals: ``False`` skips the bootstrap (the ``_lo`` and ``_hi`` columns are null).

    Returns:
        One row per target and group, sorted by the group columns.

    Raises:
        ValueError: ``leads`` is empty, ``hours`` or a ``by`` column is unknown, or the OOF holds no target.
    """
    group = _group_columns(by)
    positions = _row_selection(oof.keys, leads, hours)
    calendar = _calendar(oof.keys)
    tables = [
        _skill_one_target(oof, target, positions, group, calendar, n_boot=n_boot, intervals=intervals)
        for target in Target
        if any(t is target for t, _ in oof.grids)
    ]
    if not tables:
        raise ValueError("the OOF predictions hold no target")
    table = pl.concat(tables, how="diagonal")
    return table.select("target", *group, *[c for c in table.columns if c not in ("target", *group)]).sort(
        ["target", *group]
    )


def coverage_by_forecast_tercile(
    oof: OofPredictions,
    *,
    leads: Sequence[int] = (1, 2, 3),
    hours: str = "all",
    targets: Sequence[Target] = tuple(Target),
) -> pl.DataFrame:
    """Coverage of the corrector's 90% interval (0.05/0.95) by forecast-WBGT tercile, per target and lead.

    The tercile of a row is where its forecast WBGT ``wbgt_fc_c`` falls against ``oof.tercile_edges`` (``low`` below
    the first edge, ``mid`` below the second, ``high`` from it on). The edges are fixed once by the harness, as the
    33.3% and 66.7% quantiles of ``wbgt_fc_c`` over every development row (forecast values only, no truth, pooled over
    leads and clusters: pre-registration 7.1 and 6.4 say "edges from 2024-2025"); they are read from the OOF object,
    never recomputed from the rows scored here, so scoring a subset or perturbing the scored rows cannot move them.
    It is never conditioned on the truth tercile. A row is counted when its truth, its corrector grid and its forecast
    WBGT are all finite.

    Returns:
        Columns ``target``, ``lead_days``, ``tercile``, ``n``, ``covered``, ``coverage``, ``edge_low``, ``edge_high``.

    Raises:
        ValueError: ``leads`` is empty or ``hours`` is unknown.
    """
    positions = _row_selection(oof.keys, leads, hours)
    low, high = oof.tercile_edges
    forecast = _floats(oof.keys, "wbgt_fc_c")[positions]
    lead = oof.keys["lead_days"].to_numpy()[positions]
    tercile = np.where(forecast < low, 0, np.where(forecast < high, 1, 2))
    parts: list[pl.DataFrame] = []
    for target in targets:
        grid = oof.grids[(target, CORRECTOR)][positions]
        y = _floats(oof.keys, f"y_{target.value}")[positions]
        raw = _floats(oof.keys, f"raw_{target.value}")[positions]
        usable = np.isfinite(y) & np.isfinite(raw) & np.isfinite(forecast) & np.isfinite(grid).all(axis=1)
        where = np.flatnonzero(usable)
        inside = metrics.covered((raw + y)[where], grid[where, LEVELS.index(0.05)], grid[where, LEVELS.index(0.95)])
        parts.append(
            pl.DataFrame(
                {
                    "lead_days": lead[where],
                    "tercile": np.asarray(_TERCILE_NAMES)[tercile[where]],
                    "covered": inside.astype(np.int64),
                }
            )
            .group_by("lead_days", "tercile")
            .agg(pl.len().cast(pl.Int64).alias("n"), pl.col("covered").sum().cast(pl.Int64))
            .with_columns(pl.lit(target.value).alias("target"))
        )
    return (
        pl.concat(parts)
        .with_columns(
            (pl.col("covered") / pl.col("n")).alias("coverage"),
            pl.lit(low).alias("edge_low"),
            pl.lit(high).alias("edge_high"),
        )
        .select("target", "lead_days", "tercile", "n", "covered", "coverage", "edge_low", "edge_high")
        .sort("target", "lead_days", "tercile")
    )
