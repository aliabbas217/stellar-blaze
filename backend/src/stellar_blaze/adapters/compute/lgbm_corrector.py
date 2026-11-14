"""The LightGBM corrector at serving time: ``LightGbmCorrector`` and the booster helpers it is built on.

``LightGbmCorrector.load(model)`` reads a model directory written by ``stellar_blaze.ml.artefacts.write_model`` and
implements the ``ForecastCorrector`` port: ``correct`` turns raw IFS (and GFS) forecasts into calibrated 19-quantile
grids of t, td, wind and WBGT, ``sample`` draws joint (t, td, wind) samples from them. It reproduces the offline
predictor (``ml.predict.corrected_grids``) from the files alone: the same features (``pairs_from_forecasts`` then
``build_features`` with the persisted ``FoldStats``), the same boosters, the same conformal offsets and the same
copulas. Nothing here needs the training libraries (``mapie``, ``sklearn``, ``scoringrules``) or ``stellar_blaze.ml``
(import-linter contract 6, and a subprocess test with those packages blocked); ``lightgbm`` is imported here and in
``stellar_blaze.ml`` only.

What the grid is. A booster is trained on the *error* of a forecast, truth minus forecast (``y_*`` of
``build_features``), so ``predict_grid`` returns **error quantiles**, not corrected values. The corrected quantile is
``raw + error quantile`` (after the conformal offsets, which widen the error grid), and wind is then floored at 0.

Statuses (pre-registration R18/R44), per forecast row:

* If any of the IFS row's t, td, wind, shortwave, direct radiation or pressure is null (or NaN), all four variable rows
  are ``missing_input`` with null quantiles. This gate runs BEFORE any booster, because a real LightGBM booster returns
  a finite, sorted number for a NaN feature. A missing GFS row is only a missing feature (the row is still ``ok``).
* A row whose UTC hour or lead is outside what the model was fitted on (``params.json``) is ``uncorrected``: every
  quantile equals the raw value, because calibration is never claimed outside the fitted range.
* Otherwise ``ok``, except a WBGT row whose raw forecast WBGT the solver rejected, or (joint method) that rests on
  fewer than ``n_joint_samples / 2`` finite samples: that wbgt row alone is ``missing_input``.

Joint WBGT draws are made per ``<lead>|<block>`` stratum from one seeded generator, so a row's samples depend on its
position inside its stratum in the call (``ml.predict`` says the same): the same batch in the same order reproduces
the offline numbers exactly, a different batch or order gives different, equally valid draws. Rows that are gated keep
their position in the batch (with NaN grids), exactly as ``ml.predict`` keeps them.

Station history (the ``site`` feature set). The ``bias7_*`` features are past lead-1 IFS errors, so ``correct`` needs
``history_ifs`` (past lead-1 forecasts) next to ``history`` (observations). They are built with ``history_features``,
which reads, for a row with UTC valid date ``D`` and lead ``L``, only the dates ``D - L - 7`` to ``D - L - 1`` (the
pre-registration's L3 cutoff holds by construction; a caller may pass a longer window). Without ``history_ifs`` the
features are null (LightGBM's missing branch), the row is still corrected and a ``station_history_unavailable`` event
is logged. A ``cold`` model ignores both frames.

Storage. A booster is stored as gzip-compressed LightGBM text (``*.txt.gz``), never pickle. ``dump_booster`` is
byte-reproducible: the gzip header carries no timestamp and no file name, so one booster always gives the same bytes
(and so the same SHA-256 in a manifest).
"""

import gzip
import io
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Final, Literal, Self

import lightgbm as lgb
import numpy as np
import polars as pl
import structlog
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from stellar_blaze.domain.config.models import LoadedModel
from stellar_blaze.domain.forecast.conformal import (
    STRATUM_BLOCKS,
    ConformalOffsets,
    apply_offsets,
    block_indices,
    lead_values,
    stratum_key,
)
from stellar_blaze.domain.forecast.features import (
    FeatureSet,
    FoldStats,
    Target,
    build_features,
    feature_columns,
    history_features,
    hour_block_expr,
    pairs_from_forecasts,
)
from stellar_blaze.domain.forecast.grid import F64, LEVELS, sort_grid
from stellar_blaze.domain.forecast.sampling import sample_joint, wbgt_joint_grid
from stellar_blaze.domain.forecast.schemas import (
    CORRECTED_FORECAST_SCHEMA,
    QUANTILE_COLUMNS,
    VARIABLES,
    CorrectionStatus,
    quantile_matrix,
)
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.replay import HELD_OUT_SUMMERS
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, OBS_HOURLY_SCHEMA, conform
from stellar_blaze.domain.weather.stations import station

__all__ = ["LightGbmCorrector", "ModelHoldoutError", "dump_booster", "load_booster", "predict_grid"]

_log = structlog.get_logger(__name__)


class ModelHoldoutError(ValueError):
    """A model directory could carry information of a held-out summer (``HELD_OUT_SUMMERS``); it is not loaded."""


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


# === LightGbmCorrector ==============================================================================================

_IFS: Final = NwpModel.ECMWF_IFS025.value
_GFS: Final = NwpModel.GFS_SEAMLESS.value
_JOINT: Final = (Target.T, Target.TD, Target.WIND)
"""The three variables that are boosted and sampled jointly, in the order of the copula's columns."""
_N_LEVELS: Final = len(LEVELS)
_N_BLOCKS: Final = len(STRATUM_BLOCKS)
_KEY: Final = ["station", "valid_time", "lead_days"]
_INPUTS: Final = ("fc_t_c", "fc_td_c", "fc_wind_ms", "fc_sw_wm2", "fc_direct_wm2", "fc_pressure_hpa")
"""The IFS values a row needs: if any is missing the row is ``missing_input`` (R44)."""
_EMPTY_HISTORY: Final = pl.Schema(
    {
        "station": pl.String(),
        "valid_date": pl.Date(),
        "lead_days": pl.Int8(),
        "hour_block": pl.String(),
        "bias7_t": pl.Float64(),
        "bias7_td": pl.Float64(),
        "bias7_wind": pl.Float64(),
    }
)
_SAMPLED_VARIABLES: Final = ("t", "td", "wind")
_BOOSTER_DIRECTORY: Final = "boosters"
_POOLED_COLUMNS: Final = frozenset({"hour_utc", "doy", "clim_t", "clim_td", "clim_wbgt"})
_STATION_COLUMNS: Final = frozenset({"station", "hour_utc", "doy", "sclim_t", "sclim_td", "sclim_wbgt"})
_TIME_COLUMNS: Final = frozenset({"summer", "valid_time", "date", "year"})
"""Columns that would tie a fold-statistics row to a calendar year: a model carries none (the frames hold ``doy``)."""


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")


class _Config(_Frozen):
    """The part of the resolved training config (``params.json``, key ``config``) that serving needs."""

    feature_set: FeatureSet
    leads: tuple[int, ...]
    hours_utc: tuple[int, ...]
    wbgt_method: Literal["joint", "direct"]
    n_joint_samples: int = Field(ge=1)
    sample_seed: int


class _Params(_Frozen):
    """``params.json`` as ``ml.artefacts.write_model`` writes it (only the keys serving reads)."""

    config: _Config
    feature_columns: tuple[str, ...]
    boosted_targets: tuple[str, ...]
    summers: tuple[int, ...]


def _floats(frame: pl.DataFrame, name: str) -> F64:
    """A column as a float64 array, a null as NaN."""
    return frame[name].cast(pl.Float64()).fill_null(float("nan")).to_numpy().astype(np.float64, copy=False)


def _value_grid(error_grid: F64, raw: F64, target: Target) -> F64:
    """The VALUE grid of a target: the raw forecast plus the error grid, wind floored at 0 (``ml.train.value_grid``).

    This is the recipe the copula was fitted on (the PIT of the calibrated value grids, wind floored), so serving must
    build the same grids before ``sample_joint``. The floor is monotone, so the rows stay sorted; a NaN raw gives an
    all-NaN row. The two lines live here because serving code may not import ``stellar_blaze.ml``.
    """
    grid = np.asarray(error_grid, dtype=np.float64) + np.asarray(raw, dtype=np.float64)[:, None]
    return np.asarray(np.maximum(grid, 0.0) if target is Target.WIND else grid, dtype=np.float64)


def _feature_matrix(frame: pl.DataFrame, names: Sequence[str]) -> F64:
    """The ``(n, n_features)`` float64 matrix, columns in the training order, a null as NaN (as ``ml`` builds it)."""
    matrix = frame.select(pl.col(name).cast(pl.Float64()) for name in names).to_numpy()
    return np.ascontiguousarray(matrix, dtype=np.float64)


def _stratum_name(code: int) -> str:
    """The ``"<lead>|<block>"`` key of a stratum id ``lead * 3 + block index``."""
    lead_id, block_index = divmod(code, _N_BLOCKS)
    return stratum_key(lead_id, STRATUM_BLOCKS[block_index])


def _strata(lead: NDArray[np.int8], block: pl.Series | Sequence[str]) -> NDArray[np.int64]:
    """``lead * 3 + block index`` of each row."""
    rows = len(lead)
    return lead_values(lead, rows) * _N_BLOCKS + block_indices(block, rows).astype(np.int64)


def _years_in(column: pl.Series) -> set[int]:
    """The calendar years a time-like column holds: dates and datetimes by their year, integers and strings as years."""
    if column.dtype in (pl.Date, pl.Datetime):
        years = column.dt.year()
    elif column.dtype.is_integer():
        years = column
    else:
        years = column.cast(pl.String).str.slice(0, 4).cast(pl.Int64, strict=False)
    return {int(year) for year in years.drop_nulls().unique().to_list()}


def _read_fold_stats(identifier: str, directory: Path, name: str, allowed: frozenset[str]) -> pl.DataFrame:
    """One ``fold_stats`` frame, refused if it carries a time column or any column beyond ``allowed``.

    The frames are keyed by ``doy`` and ``hour_utc`` (and ``station``) and hold climatology values: no year. A column
    that names a year, a date or a summer is refused even when it holds only training years, and one that holds a
    held-out year is named as such. Any other unexpected column is refused too, because it is unreviewed content.
    """
    frame = pl.read_parquet(io.BytesIO(directory.joinpath("fold_stats", f"{name}.parquet").read_bytes()))
    for column in frame.columns:
        if column not in _TIME_COLUMNS:
            continue
        held = sorted(_years_in(frame[column]) & HELD_OUT_SUMMERS)
        if held:
            raise ModelHoldoutError(
                f"{identifier}: fold_stats/{name}.parquet column {column!r} holds held-out year(s) {held}"
            )
        raise ModelHoldoutError(f"{identifier}: fold_stats/{name}.parquet carries the time column {column!r}")
    unexpected = [column for column in frame.columns if column not in allowed]
    if unexpected:
        raise ModelHoldoutError(f"{identifier}: fold_stats/{name}.parquet has unexpected column(s) {unexpected}")
    return frame


def _require_model(frame: pl.DataFrame, expected: str, name: str) -> None:
    stray = frame.filter(pl.col("model") != expected)["model"].unique().to_list()
    if stray:
        raise ValueError(f"{name} must hold only {expected!r} rows, found {stray}")


def _require_unique(frame: pl.DataFrame, keys: Sequence[str], label: str) -> None:
    if frame.select(keys).is_duplicated().any():
        raise ValueError(f"{label} repeats a ({', '.join(keys)}) key")


class LightGbmCorrector:
    """The ``ForecastCorrector`` of one model directory: 19 LightGBM quantile boosters per target plus calibration.

    Build it with ``LightGbmCorrector.load``. Instances are immutable after construction and ``correct`` and ``sample``
    keep no state, so one instance can serve many calls. Both are synchronous and CPU-bound (a fraction of a second
    for a demo-sized batch, dominated by the WBGT solver); an async caller may call them directly.
    """

    def __init__(
        self,
        *,
        identifier: str,
        config: _Config,
        boosters: Mapping[Target, tuple[lgb.Booster, ...]],
        offsets: ConformalOffsets,
        copulas: Mapping[str, F64],
        stats: FoldStats,
    ) -> None:
        """Hold the parts ``load`` read (private: construct through ``load``, which validates their consistency)."""
        self._identifier = identifier
        self._config = config
        self._boosters = dict(boosters)
        self._offsets = offsets
        self._copulas = dict(copulas)
        self._stats = stats
        self._feature_names = feature_columns(config.feature_set)

    @classmethod
    def load(cls, model: LoadedModel) -> Self:
        """Read a model directory (``write_model`` layout) into a corrector.

        The directory is trusted to be intact (``scan_models`` verified every hash); what is checked here is that the
        parts agree with each other and with this code: the feature columns, the boosters' feature names, the target
        set for the WBGT method, and the strata of the offsets and the copulas against the config's leads.

        Raises:
            FileNotFoundError: A file of the layout is missing.
            pydantic.ValidationError: ``params.json`` or ``conformal.json`` is malformed.
            ModelHoldoutError: ``params.json`` lists a held-out summer, or a fold-statistics frame has a time column
                (``summer``, ``valid_time``, ``date``, ``year``) or any column it should not have (a ``ValueError``).
            ValueError: The parts disagree (the message names what).
        """
        root, identifier = model.root, model.manifest.model_id
        params = _Params.model_validate_json((root / "params.json").read_bytes())
        config = params.config
        held_out = sorted(set(params.summers) & HELD_OUT_SUMMERS)
        if held_out:
            raise ModelHoldoutError(
                f"{identifier}: params.json lists the held-out summer(s) {held_out} as training data"
            )
        stats = FoldStats(  # read (and refused if it carries a year) before the larger files
            pooled_climatology=_read_fold_stats(identifier, root, "pooled", _POOLED_COLUMNS),
            station_climatology=_read_fold_stats(identifier, root, "station", _STATION_COLUMNS),
        )
        names = feature_columns(config.feature_set)
        if params.feature_columns != names:
            raise ValueError(
                f"{identifier}: params.json lists the feature columns {list(params.feature_columns)}, this code's "
                f"{config.feature_set.value} set is {list(names)}; retrain the model"
            )
        targets = (*_JOINT, Target.WBGT) if config.wbgt_method == "direct" else _JOINT
        if set(params.boosted_targets) != {target.value for target in targets}:
            raise ValueError(
                f"{identifier}: boosted targets {sorted(params.boosted_targets)} do not fit the "
                f"{config.wbgt_method} WBGT method"
            )
        boosters: dict[Target, tuple[lgb.Booster, ...]] = {}
        for target in targets:
            loaded = tuple(
                load_booster((root / _BOOSTER_DIRECTORY / target.value / f"{column}.txt.gz").read_bytes())
                for column in QUANTILE_COLUMNS
            )
            if any(booster.feature_name() != list(names) for booster in loaded):
                raise ValueError(f"{identifier}: a {target.value} booster was trained on other features")
            boosters[target] = loaded

        offsets = ConformalOffsets.model_validate_json((root / "conformal.json").read_bytes())
        expected = {stratum_key(lead, block) for lead in config.leads for block in STRATUM_BLOCKS}
        for target in Target:
            strata = set(offsets.offsets.get(target.value, {}))
            if strata != expected:
                raise ValueError(
                    f"{identifier}: the {target.value} offsets cover {sorted(strata)}, "
                    f"the config needs {sorted(expected)}"
                )
        return cls(
            identifier=identifier,
            config=config,
            boosters=boosters,
            offsets=offsets,
            copulas=_read_copulas(identifier, json.loads((root / "copula.json").read_bytes()), expected),
            stats=stats,
        )

    @property
    def model_id(self) -> str | None:
        """The manifest's model id."""
        return self._identifier

    @property
    def needs_history_forecasts(self) -> bool:
        """True exactly when the feature set is ``site`` (the ``bias7_*`` features need past lead-1 IFS forecasts)."""
        return self._config.feature_set is FeatureSet.SITE

    # --- correct ---------------------------------------------------------------------------------------------------

    def correct(
        self,
        *,
        ifs: pl.DataFrame,
        gfs: pl.DataFrame,
        history: pl.DataFrame,
        history_ifs: pl.DataFrame | None = None,
    ) -> pl.DataFrame:
        """Calibrated quantile grids for each IFS row and variable (the port's contract; module docstring: the rules).

        The result has ``CORRECTED_FORECAST_SCHEMA``, four rows (``t``, ``td``, ``wind``, ``wbgt``) per row of ``ifs``,
        grouped by input row and in its order. ``raw`` is the IFS value (for WBGT the forecast's own WBGT, null where
        the solver rejects it). Joint WBGT draws depend on the batch (module docstring): the same ``ifs`` rows in the
        same order give the same numbers.

        Raises:
            SchemaMismatchError: A frame does not have its schema.
            ValueError: A station is not one of ``STATIONS``; ``ifs`` holds a row that is not IFS or ``gfs`` one that is
                not GFS; a key repeats in ``ifs``, ``gfs``, ``history`` or the lead-1 rows of ``history_ifs``.
        """
        forecast = conform(ifs, FORECAST_SCHEMA)
        backup = conform(gfs, FORECAST_SCHEMA)
        observed = conform(history, OBS_HOURLY_SCHEMA)
        past = None if history_ifs is None else conform(history_ifs, FORECAST_SCHEMA)
        _require_model(forecast, _IFS, "ifs")
        _require_model(backup, _GFS, "gfs")
        n = forecast.height
        pairs = pairs_from_forecasts(forecast, backup)  # raises on an unknown station or a repeated key
        spine, backup_rows = pairs.head(n), pairs.slice(n)

        raw = np.stack(
            [
                _floats(spine, "fc_t_c"),
                _floats(spine, "fc_td_c"),
                _floats(spine, "fc_wind_ms"),
                np.where(spine["wbgt_fc_reject"].to_numpy() == 0, _floats(spine, "wbgt_fc_c"), np.nan),
            ],
            axis=1,
        )
        raw = np.where(np.isfinite(raw), raw, np.nan)
        present = np.isfinite(np.stack([_floats(spine, name) for name in _INPUTS], axis=1)).all(axis=1)
        modelled = np.isin(spine["lead_days"].to_numpy(), self._config.leads) & np.isin(
            spine["hour_utc"].to_numpy(), self._config.hours_utc
        )
        usable = present & modelled  # the gate of R44, BEFORE any booster: a booster answers a number for a NaN feature
        grids = self._calibrated_grids(spine, backup_rows, raw, usable, modelled, observed, past)
        return self._frame(spine, raw, grids, present=present, modelled=modelled, usable=usable)

    def _calibrated_grids(
        self,
        spine: pl.DataFrame,
        backup_rows: pl.DataFrame,
        raw: F64,
        usable: NDArray[np.bool_],
        modelled: NDArray[np.bool_],
        history: pl.DataFrame,
        history_ifs: pl.DataFrame | None,
    ) -> dict[str, F64]:
        """The ``(n, 19)`` calibrated VALUE grid of each variable; NaN rows where nothing could be computed."""
        out = {variable: np.full((spine.height, _N_LEVELS), np.nan, dtype=np.float64) for variable in VARIABLES}
        if not usable.any():
            return out
        rows = spine.filter(pl.Series(usable))
        features = build_features(
            pl.concat([rows, backup_rows]),
            feature_set=self._config.feature_set,
            stats=self._stats,
            history=self._history(rows, history, history_ifs),
        )
        if features.height != rows.height:  # build_features keeps the IFS spine whole; a change would misalign rows
            raise RuntimeError(f"build_features returned {features.height} rows for {rows.height} IFS rows")
        x = _feature_matrix(features, self._feature_names)
        lead = rows["lead_days"].to_numpy()
        block = features["hour_block"]
        raw_at = {target: raw[usable, index] for index, target in enumerate(Target)}

        def calibrated(target: Target, error: F64) -> F64:
            return _value_grid(apply_offsets(error, lead, block, self._offsets, target), raw_at[target], target)

        values = {target: calibrated(target, predict_grid(self._boosters[target], x)) for target in _JOINT}
        if self._config.wbgt_method == "direct":
            wbgt = calibrated(Target.WBGT, predict_grid(self._boosters[Target.WBGT], x))
        else:
            wbgt = self._joint_wbgt(spine, raw, values, usable, modelled)
        for target, grid in {**values, Target.WBGT: wbgt}.items():
            out[target.value][usable] = grid
        return out

    def _joint_wbgt(
        self,
        spine: pl.DataFrame,
        raw: F64,
        values: Mapping[Target, F64],
        usable: NDArray[np.bool_],
        modelled: NDArray[np.bool_],
    ) -> F64:
        """The conformalised joint WBGT value grid of the usable rows (``ml.predict``'s recipe, step by step).

        The draws are made over the batch of every MODELLED row, in call order, with NaN grids for the rows that were
        gated: a gated row keeps its slot, as it does offline, so a usable row's samples do not depend on whether a
        neighbor was gated.
        """
        config = self._config
        batch = spine.filter(pl.Series(modelled))
        size = batch.height
        lead = batch["lead_days"].to_numpy()
        block = batch.select(hour_block_expr(pl.col("hour_utc")).alias("hour_block"))["hour_block"]
        in_batch = usable[modelled]
        grids = {target: np.full((size, _N_LEVELS), np.nan, dtype=np.float64) for target in _JOINT}
        for target in _JOINT:
            grids[target][in_batch] = values[target]
        where = {icao: station(icao) for icao in batch["station"].unique().to_list()}
        lat = np.array([where[icao].lat for icao in batch["station"]], dtype=np.float64)
        lon = np.array([where[icao].lon for icao in batch["station"]], dtype=np.float64)
        shortwave, direct = _floats(batch, "fc_sw_wm2"), _floats(batch, "fc_direct_wm2")
        pressure = _floats(batch, "fc_pressure_hpa")
        valid_time = batch["valid_time"].to_list()

        codes = _strata(lead, block)
        joint = np.full((size, _N_LEVELS), np.nan, dtype=np.float64)
        n_finite = np.zeros(size, dtype=np.int64)
        for code in np.unique(codes).tolist():
            chosen = codes == code
            if not in_batch[chosen].any():
                continue  # nothing to draw for a stratum of gated rows; the strata have independent generators
            samples = sample_joint(
                [grids[target][chosen] for target in _JOINT],
                self._copulas[_stratum_name(code)],
                n_samples=config.n_joint_samples,
                seed=config.sample_seed,
            )
            result = wbgt_joint_grid(
                samples,
                valid_time=[moment for moment, keep in zip(valid_time, chosen.tolist(), strict=True) if keep],
                lat=lat[chosen],
                lon=lon[chosen],
                sw_wm2=shortwave[chosen],
                direct_wm2=direct[chosen],
                pressure_hpa=pressure[chosen],
            )
            joint[chosen], n_finite[chosen] = result.grid, result.n_finite
        thin = n_finite < config.n_joint_samples / 2.0  # R30: a minority of finite draws is no distribution
        joint = np.where(thin[:, None], np.nan, joint)
        raw_wbgt = raw[modelled, 3]
        error = apply_offsets(joint - raw_wbgt[:, None], lead, block, self._offsets, Target.WBGT)
        return _value_grid(error, raw_wbgt, Target.WBGT)[in_batch]

    def _history(
        self, rows: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame | None
    ) -> pl.DataFrame | None:
        """The ``bias7_*`` frame of the ``rows`` to correct (``None`` for a cold model, null features if unavailable).

        The past lead-1 IFS errors (forecast minus truth) come from ``history_ifs`` joined to ``history``; the target
        rows are appended without truth so ``history_features`` has their keys. ``history_features`` reads, for a row
        of valid date ``D`` and lead ``L``, only the dates ``D - L - 7`` to ``D - L - 1`` (L3), whatever window the
        caller passed.
        """
        if self._config.feature_set is not FeatureSet.SITE:
            return None
        lead_one = (
            pl.DataFrame(schema=FORECAST_SCHEMA)
            if history_ifs is None
            else history_ifs.filter((pl.col("model") == _IFS) & (pl.col("lead_days") == 1))
        )
        if history_ifs is None or lead_one.is_empty() or history.is_empty():
            if history_ifs is None:
                reason = "no history_ifs was given"
            elif lead_one.is_empty():
                reason = "history_ifs holds no lead-1 IFS rows"
            else:
                reason = "history holds no observations"
            _log.warning("station_history_unavailable", model_id=self._identifier, reason=reason, rows=rows.height)
        if lead_one.is_empty():
            return pl.DataFrame(schema=_EMPTY_HISTORY)
        _require_unique(lead_one, ["station", "valid_time"], "the lead-1 rows of history_ifs")
        _require_unique(history, ["station", "valid_time"], "history")
        truth = history.select(
            "station",
            "valid_time",
            *(
                pl.when(pl.col(name).is_finite()).then(pl.col(name)).alias(target)
                for name, target in (("t_c", "obs_t_c"), ("td_c", "obs_td_c"), ("wind_ms", "obs_wind_ms"))
            ),
        )
        forecast = {"t_c": "fc_t_c", "td_c": "fc_td_c", "wind_ms": "fc_wind_ms"}
        past = lead_one.select(
            "station",
            "model",
            "valid_time",
            "lead_days",
            *(pl.when(pl.col(name).is_finite()).then(pl.col(name)).alias(target) for name, target in forecast.items()),
        ).join(truth, on=["station", "valid_time"], how="left", validate="m:1", maintain_order="left")
        targets = rows.select(
            "station",
            "model",
            "valid_time",
            "lead_days",
            "fc_t_c",
            "fc_td_c",
            "fc_wind_ms",
            *(pl.lit(None, dtype=pl.Float64()).alias(name) for name in ("obs_t_c", "obs_td_c", "obs_wind_ms")),
        )
        return history_features(pl.concat([past, targets]))

    def _frame(
        self,
        spine: pl.DataFrame,
        raw: F64,
        grids: Mapping[str, F64],
        *,
        present: NDArray[np.bool_],
        modelled: NDArray[np.bool_],
        usable: NDArray[np.bool_],
    ) -> pl.DataFrame:
        """The output frame: status, raw and quantiles of each (row, variable), in ``CORRECTED_FORECAST_SCHEMA``."""
        n = spine.height
        quantiles = np.full((n, len(VARIABLES), _N_LEVELS), np.nan, dtype=np.float64)
        status = np.full((n, len(VARIABLES)), CorrectionStatus.MISSING_INPUT.value, dtype="<U16")
        for index, variable in enumerate(VARIABLES):
            grid = grids[variable]
            corrected = usable & np.isfinite(grid).all(axis=1)
            uncorrected = present & ~modelled & np.isfinite(raw[:, index])
            quantiles[corrected, index] = grid[corrected]
            status[corrected, index] = CorrectionStatus.OK.value
            quantiles[uncorrected, index] = raw[uncorrected, index][:, None]
            status[uncorrected, index] = CorrectionStatus.UNCORRECTED.value
        source = pl.Series(np.repeat(np.arange(n, dtype=np.int64), len(VARIABLES)))
        flat = quantiles.reshape(-1, _N_LEVELS)
        return pl.concat(
            [
                spine.select(_KEY).select(pl.all().gather(source)),
                pl.DataFrame(
                    {
                        "variable": pl.Series(list(VARIABLES) * n, dtype=pl.String),
                        "raw": pl.Series(raw.reshape(-1), dtype=pl.Float64, nan_to_null=True),
                        **{
                            name: pl.Series(flat[:, k], dtype=pl.Float64, nan_to_null=True)
                            for k, name in enumerate(QUANTILE_COLUMNS)
                        },
                        "status": pl.Series(status.reshape(-1).tolist(), dtype=pl.String),
                        "model_id": pl.Series([self._identifier] * (n * len(VARIABLES)), dtype=pl.String),
                    }
                ),
            ],
            how="horizontal",
        ).select(list(CORRECTED_FORECAST_SCHEMA))

    # --- sample ----------------------------------------------------------------------------------------------------

    def sample(self, corrected: pl.DataFrame, *, n_samples: int, seed: int) -> NDArray[np.float64]:
        """Joint (t, td, wind) samples of each forecast row of ``corrected``, through each row's stratum copula.

        Rows are the distinct (station, valid_time, lead_days) keys in order of first appearance; the result is
        ``(rows, n_samples, 3)``. The marginals are the ``t``, ``td`` and ``wind`` grids of ``corrected`` (VALUE
        grids, as the copula was fitted on) and the correlation is that of the row's ``<lead>|<block>`` stratum
        (``copula.json``; the lead-pooled one for a stratum that fell back, as recorded). ``td <= t`` and
        ``wind >= 0`` hold.

        A row whose ``t``, ``td`` or ``wind`` is not ``ok`` (``missing_input`` or ``uncorrected``) gives NaN for all
        three variables of that row: ``missing_input`` has no grid, and ``uncorrected`` has no calibrated distribution
        to draw from, so no sample is better than a confident one. Rows are drawn per stratum, each stratum from its
        own generator derived from ``seed`` and the stratum, so rows of different strata do not share random numbers;
        the same ``corrected``, ``n_samples`` and ``seed`` give the same samples.

        Raises:
            SchemaMismatchError: ``corrected`` is not a ``CORRECTED_FORECAST_SCHEMA`` frame.
            ValueError: ``n_samples`` is below 1; a key lacks one of the three variables or repeats one; an ``ok`` row
                lies in a stratum this model was not fitted on.
        """
        if n_samples < 1:
            raise ValueError(f"n_samples must be at least 1, got {n_samples}")
        frame = conform(corrected, CORRECTED_FORECAST_SCHEMA)
        keys = frame.select(_KEY).unique(maintain_order=True)
        grids: list[F64] = []
        ok = np.ones(keys.height, dtype=bool)
        for variable in _SAMPLED_VARIABLES:
            rows = frame.filter(pl.col("variable") == variable)
            if rows.select(_KEY).is_duplicated().any():
                raise ValueError(f"duplicate {variable!r} rows for one (station, valid_time, lead_days) key")
            aligned = keys.join(rows, on=_KEY, how="left", maintain_order="left", validate="1:1")
            if aligned["variable"].null_count():
                raise ValueError(f"every forecast row needs a {variable!r} variable row, and some lack it")
            grids.append(quantile_matrix(aligned))
            ok &= (aligned["status"] == CorrectionStatus.OK.value).to_numpy() & np.isfinite(grids[-1]).all(axis=1)
        out = np.full((keys.height, n_samples, len(_SAMPLED_VARIABLES)), np.nan, dtype=np.float64)
        if not ok.any():
            return out
        drawn = keys.filter(pl.Series(ok))
        codes = _strata(
            drawn["lead_days"].to_numpy(),
            drawn.select(hour_block_expr(pl.col("valid_time").dt.hour()).alias("block"))["block"],
        )
        for code in np.unique(codes).tolist():
            chosen = np.zeros(keys.height, dtype=bool)
            chosen[np.flatnonzero(ok)[codes == code]] = True
            correlation = self._copulas.get(_stratum_name(code))
            if correlation is None:
                raise ValueError(f"a row with status ok lies in stratum {_stratum_name(code)}, which this model lacks")
            stratum_seed = int(np.random.SeedSequence([seed, code]).generate_state(1, dtype=np.uint64)[0])
            out[chosen] = sample_joint(
                [grid[chosen] for grid in grids],
                correlation,
                n_samples=n_samples,
                seed=stratum_seed,
            )
        return out


def _read_copulas(identifier: str, document: object, expected: set[str]) -> dict[str, F64]:
    """The 3x3 correlation of each stratum from the parsed ``copula.json`` (every stratum present, each finite)."""
    if not isinstance(document, dict) or document.get("variables") != list(_SAMPLED_VARIABLES):
        raise ValueError(f"{identifier}: copula.json must name the variables {list(_SAMPLED_VARIABLES)}")
    corr = document.get("corr")
    if not isinstance(corr, dict) or set(corr) != expected:
        raise ValueError(f"{identifier}: copula.json must hold exactly the strata {sorted(expected)}")
    out: dict[str, F64] = {}
    for key, matrix in corr.items():
        array = np.asarray(matrix, dtype=np.float64)
        if array.shape != (len(_SAMPLED_VARIABLES),) * 2 or not np.isfinite(array).all():
            raise ValueError(f"{identifier}: the copula of {key} is not a finite 3x3 matrix")
        out[key] = array
    return out
