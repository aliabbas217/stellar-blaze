"""The pre-registered baselines B0, B0d, B2/B2d, B3/B3d and B4 (pre-registration section 5), fitted inside one fold.

Every baseline predicts an *error* and the corrected value is ``raw + predicted error`` (``y_*`` of
``build_features`` is truth minus forecast, ``bias7_*`` is forecast minus truth). The input is a ``build_features``
frame: ``raw_<target>`` and ``y_<target>`` are read for every target, ``bias7_<target>`` for B3 (a ``site`` frame) and
the ``cold`` feature columns for B4. Nothing here reads truth other than through ``y_*``, and a fitted statistic
(static bias, dressing quantiles, ridge) is a function of the rows given to ``fit_baselines`` only (L4, L6): the
caller removes a held-out cluster first.

* **B0** raw IFS, shape ``(n,)``. **B0d** raw plus the 19 empirical quantiles (``LEVELS``, ``numpy.quantile`` linear
  interpolation) of the training error per lead x hour-block.
* **B2** raw plus the mean training error per station x lead x hour-block; with ``pooled=True`` (held-out clusters,
  regimes b and c) per lead x hour-block, the row-weighted mean over the training stations present, and the station of a
  row is never read. **B2d** is B2 plus the quantiles of the training error after that correction.
* **B3** raw minus ``bias7_<target>``, B2 for a row whose ``bias7`` is null; **B3d** adds the quantiles of the training
  error after the running correction (the rows that have ``bias7``), B2d for a row whose ``bias7`` is null. Defined for
  ``t``, ``td`` and ``wind`` only, as ``bias7`` is (3.2): ``Target.WBGT`` raises ``UnsupportedBaselineError``.
* **B4** ridge (alpha 1.0) on the ``cold`` features, one per target, fitted to the error ``y_<target>``; the features
  are standardized with the training mean and standard deviation (``_sklearn.Ridge``; scaling is this module's
  choice, the pre-registration only says "ridge on the cold features"). Dressed with its own ridge residuals. A row
  with a null cold feature cannot be scored by the ridge and falls back to B2d.

Missing data is never filled. A row whose ``y_<target>`` is null is excluded from every fit and residual (and counted in
``BaselineModel.n_null_target``). A row whose ``raw_<target>`` is null (a rejected WBGT forecast, an hour outside
02-15 UTC) predicts NaN, so the caller scores it as missing. A quantile stratum with fewer than ``MIN_STRATUM_ROWS``
residuals takes the quantiles pooled over the hour-blocks of the same lead and is listed in
``BaselineModel.dressing_fallback``; a lead with fewer than that raises ``ValueError``. A stratum the training never saw
raises ``KeyError`` at prediction (never another lead's value).

Wind is not clipped at 0 here: the pre-registration clips the corrector's wind (3.1) and defines the baselines as
"added to the raw value", so a dressed wind baseline can have negative low quantiles.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import Final

import numpy as np
import polars as pl
import structlog
from numpy.typing import NDArray

from stellar_blaze.domain.forecast.features import FeatureSet, Target, feature_columns
from stellar_blaze.domain.forecast.grid import F64, LEVELS, HourBlock, sort_grid
from stellar_blaze.ml._sklearn import Ridge

__all__ = [
    "MIN_STRATUM_ROWS",
    "RIDGE_ALPHA",
    "Baseline",
    "BaselineModel",
    "UnsupportedBaselineError",
    "fit_baselines",
    "predict_baseline",
]

_log = structlog.get_logger(__name__)

type _Mask = NDArray[np.bool_]

MIN_STRATUM_ROWS: Final = 30
"""The fewest residuals a lead x hour-block stratum needs for its own quantiles (conformal's rule, pre-registration)."""

RIDGE_ALPHA: Final = 1.0
"""The pre-registered ridge penalty (on standardized features)."""

_QUANTILE_COLUMNS: Final = tuple(f"q{index:02d}" for index in range(len(LEVELS)))
_BLOCKS: Final = tuple(block.value for block in HourBlock)
_BIAS7_COLUMN: Final = MappingProxyType({Target.T: "bias7_t", Target.TD: "bias7_td", Target.WIND: "bias7_wind"})
_COLD: Final = feature_columns(FeatureSet.COLD)
_SHOWN_STRATA: Final = 5  # how many missing strata a KeyError names before it says "and N more"


class Baseline(StrEnum):
    """The pre-registered baselines; a ``d`` is the dressed (probabilistic) form."""

    B0 = "b0"
    B0D = "b0d"
    B2 = "b2"
    B2D = "b2d"
    B3 = "b3"
    B3D = "b3d"
    B4 = "b4"


class UnsupportedBaselineError(ValueError):
    """The baseline is not defined for this target, or this model was fitted without what it needs."""


@dataclass(frozen=True, eq=False)
class BaselineModel:
    """The statistics of every baseline for one target, fitted on one fold's training rows.

    ``eq=False`` because the tables are frames (compare them with ``DataFrame.equals``).

    Attributes:
        target: The corrected variable.
        pooled: Whether the static bias is pooled over stations (held-out clusters).
        static_bias: Keys ``station`` (absent when pooled), ``lead``, ``hour_block``; columns ``bias`` (the mean
            training error) and ``n`` (the rows it is made of; there is no minimum for the static bias).
        dressing: Per dressed baseline (``B0D``, ``B2D``, ``B3D``, ``B4``) a frame with keys ``lead``, ``hour_block``
            and the columns ``q00`` to ``q18`` (the quantiles at ``LEVELS``) and ``n``. ``B3D`` is absent when the
            training frame has no ``bias7`` column or the target is WBGT.
        dressing_fallback: Per baseline name (``"b0d"`` ...) the ``(lead_days, hour_block)`` strata that took the
            lead-pooled quantiles because they had fewer than ``MIN_STRATUM_ROWS`` residuals.
        ridge: The B4 ridge.
        n_fit_rows: Training rows with a target (those that fit anything).
        n_null_target: Training rows excluded because ``y_<target>`` was null.
        n_ridge_rows: Training rows the ridge was fitted on (a target and every cold feature).
        fallback_counts: Per baseline name (``"b3"``, ``"b3d"``, ``"b4"``) the number of rows of the LAST
            ``predict_baseline`` call for that baseline that took the fallback (B2 or B2d); replaced by every call,
            never accumulated, so predicting the same rows twice gives the same count. Rows that predict NaN are not
            counted.
    """

    target: Target
    pooled: bool
    static_bias: pl.DataFrame
    dressing: dict[Baseline, pl.DataFrame]
    dressing_fallback: dict[str, tuple[tuple[int, str], ...]]
    ridge: Ridge
    n_fit_rows: int
    n_null_target: int
    n_ridge_rows: int
    fallback_counts: dict[str, int] = field(default_factory=dict[str, int])


def _clean(name: str) -> pl.Expr:
    """A float column with NaN turned into null, so a missing value is one thing."""
    return pl.col(name).cast(pl.Float64()).fill_nan(None)


def _bias7_name(target: Target) -> str | None:
    return _BIAS7_COLUMN.get(target)


def _require_columns(frame: pl.DataFrame, columns: Sequence[str], what: str) -> None:
    missing = [name for name in columns if name not in frame.columns]
    if missing:
        raise ValueError(f"{what} lacks the required columns {missing}")


def _require_supported(target: Target, baseline: Baseline) -> None:
    if baseline in (Baseline.B3, Baseline.B3D) and target is Target.WBGT:
        raise UnsupportedBaselineError(
            f"{baseline.value} is not defined for the target {target.value}: bias7 exists for t, td and wind only "
            "(pre-registration 3.2, 5)"
        )


def _complete(columns: Sequence[str]) -> pl.Expr:
    return pl.all_horizontal(pl.col(name).is_not_null() for name in columns)


def _quantile_table(
    label: Baseline, residuals: pl.DataFrame, leads: Sequence[int]
) -> tuple[pl.DataFrame, tuple[tuple[int, str], ...]]:
    """The dressing table of one baseline from its ``lead``, ``hour_block``, ``res`` residuals (``BaselineModel``)."""
    aggregates = [
        pl.col("res").quantile(level, interpolation="linear").alias(name)
        for level, name in zip(LEVELS, _QUANTILE_COLUMNS, strict=True)
    ]
    per_lead = residuals.group_by("lead").agg(pl.len().alias("n_lead"), *aggregates)
    counts = dict(zip(per_lead["lead"].to_list(), per_lead["n_lead"].to_list(), strict=True))
    thin_leads = {lead: counts.get(lead, 0) for lead in leads if counts.get(lead, 0) < MIN_STRATUM_ROWS}
    if thin_leads:
        shown = ", ".join(f"lead_days={lead} ({n} rows)" for lead, n in sorted(thin_leads.items()))
        raise ValueError(
            f"{label.value}: too few training residuals for {shown}; need at least {MIN_STRATUM_ROWS} per lead"
        )
    per_stratum = residuals.group_by("lead", "hour_block").agg(pl.len().alias("n"), *aggregates)
    strata = pl.DataFrame({"lead": sorted(leads)}, schema={"lead": pl.Int16()}).join(
        pl.DataFrame({"hour_block": list(_BLOCKS)}), how="cross"
    )
    joined = strata.join(per_stratum, on=["lead", "hour_block"], how="left", validate="1:1").join(
        per_lead.select("lead", *[pl.col(name).alias(f"{name}_pooled") for name in _QUANTILE_COLUMNS]),
        on="lead",
        how="left",
        validate="m:1",
    )
    thin = pl.col("n").is_null() | (pl.col("n") < MIN_STRATUM_ROWS)
    table = joined.with_columns(
        pl.col("n").fill_null(0),
        *[
            pl.when(thin).then(pl.col(f"{name}_pooled")).otherwise(pl.col(name)).alias(name)
            for name in _QUANTILE_COLUMNS
        ],
        thin.alias("pooled_fallback"),
    ).sort("lead", "hour_block")
    fallback = tuple(
        (int(lead), str(block))
        for lead, block in table.filter("pooled_fallback").select("lead", "hour_block").iter_rows()
    )
    return table.select("lead", "hour_block", *_QUANTILE_COLUMNS, "n"), fallback


def fit_baselines(train: pl.DataFrame, *, target: Target, pooled: bool) -> BaselineModel:
    """Fit every baseline of one target on a fold's training rows.

    Args:
        train: A ``build_features`` frame of the fold's training rows (only those; L4, L6) with ``station``,
            ``lead_days``, ``hour_block``, ``raw_<target>``, ``y_<target>`` and the ``cold`` feature columns; a
            ``bias7_<target>`` column (a ``site`` frame) is needed for B3 and B3d, which are skipped without it.
        target: The corrected variable.
        pooled: Pool the static bias over the training stations per lead x hour-block (held-out clusters, regimes b and
            c) instead of keeping it per station.

    Returns:
        The fitted model; predict with ``predict_baseline``.

    Raises:
        ValueError: A required column is missing, the frame has no row with a target, a feature column is not
            numeric, or a lead has fewer than ``MIN_STRATUM_ROWS`` residuals for some baseline.
    """
    name = target.value
    bias7 = _bias7_name(target)
    _require_columns(train, ["station", "lead_days", "hour_block", f"raw_{name}", f"y_{name}", *_COLD], "train")
    if train.is_empty():
        raise ValueError("train is empty: nothing to fit the baselines on")
    has_history = bias7 is not None and bias7 in train.columns
    work = train.select(
        "station",
        pl.col("lead_days").cast(pl.Int16()).alias("lead"),
        "hour_block",
        _clean(f"y_{name}").alias("y"),
        *([_clean(bias7).alias("bias7")] if has_history and bias7 is not None else []),
        *[_clean(column) for column in _COLD],
    )
    rows = work.filter(pl.col("y").is_not_null() & pl.col("lead").is_not_null() & pl.col("hour_block").is_not_null())
    n_null_target = train.height - rows.height
    if rows.is_empty():
        raise ValueError(f"train has no row with a {name} target (y_{name} is null everywhere)")
    leads = sorted(rows["lead"].unique().to_list())

    bias_keys = ["lead", "hour_block"] if pooled else ["station", "lead", "hour_block"]
    static_bias = rows.group_by(bias_keys).agg(pl.col("y").mean().alias("bias"), pl.len().alias("n")).sort(bias_keys)
    corrected = rows.join(static_bias.select(*bias_keys, "bias"), on=bias_keys, how="left", validate="m:1")

    residuals: dict[Baseline, pl.DataFrame] = {
        Baseline.B0D: rows.select("lead", "hour_block", pl.col("y").alias("res")),
        Baseline.B2D: corrected.select("lead", "hour_block", (pl.col("y") - pl.col("bias")).alias("res")),
    }
    if has_history:
        residuals[Baseline.B3D] = rows.filter(pl.col("bias7").is_not_null()).select(
            "lead", "hour_block", (pl.col("y") + pl.col("bias7")).alias("res")
        )
    fit_x = rows.filter(_complete(_COLD))
    if fit_x.is_empty():
        raise ValueError(f"train has no row with a {name} target and every cold feature: the B4 ridge cannot be fitted")
    ridge = Ridge(RIDGE_ALPHA).fit(fit_x.select(_COLD).to_numpy(), fit_x["y"].to_numpy())
    ridge_error = fit_x["y"].to_numpy() - ridge.predict(fit_x.select(_COLD).to_numpy())
    residuals[Baseline.B4] = fit_x.select("lead", "hour_block").with_columns(pl.Series("res", ridge_error))

    dressing: dict[Baseline, pl.DataFrame] = {}
    dressing_fallback: dict[str, tuple[tuple[int, str], ...]] = {}
    for baseline, frame in residuals.items():
        dressing[baseline], dressing_fallback[baseline.value] = _quantile_table(baseline, frame, leads)
    _log.info(
        "baselines_fitted",
        target=name,
        pooled=pooled,
        fit_rows=rows.height,
        null_target_rows=n_null_target,
        ridge_rows=fit_x.height,
        thin_strata={label: len(strata) for label, strata in dressing_fallback.items() if strata},
    )
    return BaselineModel(
        target=target,
        pooled=pooled,
        static_bias=static_bias,
        dressing=dressing,
        dressing_fallback=dressing_fallback,
        ridge=ridge,
        n_fit_rows=rows.height,
        n_null_target=n_null_target,
        n_ridge_rows=fit_x.height,
    )


def _prediction_frame(model: BaselineModel, rows: pl.DataFrame, baseline: Baseline) -> pl.DataFrame:
    """The columns of ``rows`` that ``baseline`` reads, under internal names (``lead``, ``raw``, ``bias7``, ...)."""
    name = model.target.value
    needs_bias = baseline not in (Baseline.B0, Baseline.B0D)
    required = ["lead_days", "hour_block", f"raw_{name}"]
    if needs_bias and not model.pooled:
        required.append("station")
    bias7 = _bias7_name(model.target)
    if baseline in (Baseline.B3, Baseline.B3D):
        if bias7 is None or Baseline.B3D not in model.dressing:
            raise UnsupportedBaselineError(
                f"{baseline.value} needs bias7_{name} in the training frame (a site feature frame); "
                "this model was fitted without it"
            )
        required.append(bias7)
    if baseline is Baseline.B4:
        required.extend(_COLD)
    _require_columns(rows, required, "rows")
    columns: list[pl.Expr] = [
        pl.col("lead_days").cast(pl.Int16()).alias("lead"),
        pl.col("hour_block"),
        _clean(f"raw_{name}").alias("raw"),
    ]
    if needs_bias and not model.pooled:
        columns.append(pl.col("station"))
    if baseline in (Baseline.B3, Baseline.B3D) and bias7 is not None:
        columns.append(_clean(bias7).alias("bias7"))
    if baseline is Baseline.B4:
        columns.extend(_clean(column) for column in _COLD)
    return rows.select(columns)


def _raise_missing(table: str, joined: pl.DataFrame, keys: Sequence[str]) -> None:
    labels = {"lead": "lead_days"}
    strata = joined.select(keys).unique().sort(keys)
    shown = [
        " ".join(f"{labels.get(key, key)}={value}" for key, value in zip(keys, row, strict=True))
        for row in strata.head(_SHOWN_STRATA).iter_rows()
    ]
    more = f" and {strata.height - len(shown)} more" if strata.height > len(shown) else ""
    raise KeyError(f"the {table} has no training stratum for: {'; '.join(shown)}{more}")


def _static_bias(model: BaselineModel, frame: pl.DataFrame) -> F64:
    """The static bias of each row; a stratum the training never saw raises ``KeyError`` (a NaN raw row needs none)."""
    keys = ["lead", "hour_block"] if model.pooled else ["station", "lead", "hour_block"]
    joined = frame.select(*keys, "raw").join(
        model.static_bias.select(*keys, "bias"), on=keys, how="left", validate="m:1", maintain_order="left"
    )
    missing = joined.filter(pl.col("bias").is_null() & pl.col("raw").is_not_null())
    if not missing.is_empty():
        _raise_missing("static bias", missing, keys)
    return np.asarray(joined["bias"].fill_null(float("nan")).to_numpy(), dtype=np.float64)


def _offsets(model: BaselineModel, frame: pl.DataFrame, baseline: Baseline) -> F64:
    """The ``(n, 19)`` residual quantiles of each row's lead x hour-block, NaN for a row without a raw value."""
    keys = ["lead", "hour_block"]
    joined = frame.select(*keys, "raw").join(
        model.dressing[baseline], on=keys, how="left", validate="m:1", maintain_order="left"
    )
    missing = joined.filter(pl.col(_QUANTILE_COLUMNS[0]).is_null() & pl.col("raw").is_not_null())
    if not missing.is_empty():
        _raise_missing(f"{baseline.value} dressing table", missing, keys)
    return np.asarray(joined.select(_QUANTILE_COLUMNS).to_numpy(), dtype=np.float64)


def _raw(frame: pl.DataFrame) -> F64:
    return np.asarray(frame["raw"].fill_null(float("nan")).to_numpy(), dtype=np.float64)


def _b2_point(model: BaselineModel, frame: pl.DataFrame, raw: F64, rows: _Mask | None = None) -> F64:
    """``raw + static bias``; with ``rows`` (a boolean mask) only those rows are looked up, the others are NaN."""
    if rows is None:
        return raw + _static_bias(model, frame)
    out = np.full(raw.shape, np.nan)
    if rows.any():
        out[rows] = raw[rows] + _static_bias(model, frame.filter(pl.Series(rows)))
    return out


def _running_point(model: BaselineModel, frame: pl.DataFrame, raw: F64) -> tuple[F64, _Mask]:
    """B3's point forecast and the mask of the rows that fell back to B2."""
    bias7 = np.asarray(frame["bias7"].fill_null(float("nan")).to_numpy(), dtype=np.float64)
    fallback = np.isnan(bias7) & ~np.isnan(raw)
    point = raw - bias7
    point[fallback] = _b2_point(model, frame, raw, fallback)[fallback]
    return point, fallback


def _ridge_point(model: BaselineModel, frame: pl.DataFrame, raw: F64) -> tuple[F64, _Mask]:
    """B4's point forecast and the mask of the rows that fell back to B2 (a null cold feature)."""
    x = np.ascontiguousarray(frame.select(_COLD).to_numpy(), dtype=np.float64)
    complete = np.isfinite(x).all(axis=1)
    fallback = ~complete & ~np.isnan(raw)
    point = np.full(raw.shape, np.nan)
    if complete.any():
        point[complete] = raw[complete] + model.ridge.predict(x[complete])
    point[fallback] = _b2_point(model, frame, raw, fallback)[fallback]
    return point, fallback


def _dressed(model: BaselineModel, frame: pl.DataFrame, point: F64, baseline: Baseline, fallback: _Mask | None) -> F64:
    """``point`` plus the quantiles of ``baseline``'s table; rows in ``fallback`` use B2d's table instead."""
    if fallback is None or not fallback.any():
        return sort_grid(point[:, None] + _offsets(model, frame, baseline))
    offsets = np.full((point.shape[0], len(LEVELS)), np.nan)
    own = ~fallback
    if own.any():
        offsets[own] = _offsets(model, frame.filter(pl.Series(own)), baseline)
    offsets[fallback] = _offsets(model, frame.filter(pl.Series(fallback)), Baseline.B2D)
    return sort_grid(point[:, None] + offsets)


def predict_baseline(model: BaselineModel, rows: pl.DataFrame, baseline: Baseline) -> F64:
    """The corrected forecast of ``rows`` under one baseline.

    A row with a null ``raw_<target>`` gives NaN (a ``(n, 19)`` row of NaN for a dressed baseline): never a value. The
    count of rows that took B3's, B3d's or B4's fallback replaces ``model.fallback_counts[baseline.value]``.

    Args:
        model: From ``fit_baselines``.
        rows: A ``build_features`` frame with ``lead_days``, ``hour_block`` and ``raw_<target>``; also ``station``
            unless the model is pooled, ``bias7_<target>`` for B3 and B3d, the ``cold`` feature columns for B4.
        baseline: Which baseline.

    Returns:
        Shape ``(n,)`` for B0, B2 and B3; shape ``(n, 19)`` sorted along the 19 ``LEVELS`` for the dressed ones.

    Raises:
        UnsupportedBaselineError: B3 or B3d for the WBGT target, or for a model fitted without ``bias7``.
        ValueError: A column the baseline reads is missing from ``rows``.
        KeyError: A row's station x lead x hour-block (lead x hour-block when pooled) was not in the training rows; the
            message names it. Nothing is filled from another stratum.
    """
    _require_supported(model.target, baseline)
    frame = _prediction_frame(model, rows, baseline)
    raw = _raw(frame)
    fallback: _Mask | None = None
    match baseline:
        case Baseline.B0:
            return raw
        case Baseline.B0D:
            return _dressed(model, frame, raw, baseline, None)
        case Baseline.B2:
            return _b2_point(model, frame, raw)
        case Baseline.B2D:
            return _dressed(model, frame, _b2_point(model, frame, raw), baseline, None)
        case Baseline.B3 | Baseline.B3D:
            point, fallback = _running_point(model, frame, raw)
        case Baseline.B4:
            point, fallback = _ridge_point(model, frame, raw)
    model.fallback_counts[baseline.value] = int(fallback.sum())
    if baseline is Baseline.B3:
        return point
    return _dressed(model, frame, point, baseline, fallback)
