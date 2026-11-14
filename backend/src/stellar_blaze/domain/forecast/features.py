"""The leakage-safe feature frame of the corrector: fold statistics, station history and the feature builder.

Everything here is a Polars expression over a gold-shaped pair frame (``GOLD_PAIRS_SCHEMA``); nothing loops over rows.
The rules are pre-registration section 3.2 (the closed feature list and leakage rules L1 to L8):

* A *day* is a UTC date (``valid_time.dt.date()`` of the UTC column) and an *hour-block* is made of UTC hours
  (``grid.HOUR_BLOCKS``). Every modelled hour (UTC 02-15) has the same calendar date in UTC and GST, so the key is
  unambiguous; an hour outside 02-15 has no block, and no feature, target or raw value is built for it.
* Sign convention: ``bias7_*`` is the mean of (forecast minus truth) over its window, and the target ``y_*`` is
  (truth minus forecast). A positive ``bias7_t`` means the model has run warm recently, so the model should learn a
  negative correction.
* Missing data is never filled: a mean is taken over the days (or station-hours) that have data, and a window with
  none gives null. A WBGT that gold stores as NaN (rejected) or flags as rejected becomes null.
* The truth of a row is one number per station-hour whatever the model and the lead. Statistics fitted from it
  (``fit_fold_stats``) read the IFS lead-1 row only, so each station-hour counts once.

``build_features`` never reads ``ref_*``, ``audit_*`` or any truth column to make a *feature*: truth only fills the
``y_*`` targets, and only when the truth columns are present, so the same function builds a serving frame.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Final

import numpy as np
import polars as pl

from stellar_blaze.domain.forecast.grid import HOUR_BLOCKS, MODEL_LEADS
from stellar_blaze.domain.physics.psychrometrics import relative_humidity_pct
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.stations import STATIONS

__all__ = [
    "BANNED_COLUMNS",
    "FORECAST_COLUMN",
    "TRUTH_COLUMN",
    "FeatureSet",
    "FoldStats",
    "Target",
    "build_features",
    "feature_columns",
    "fit_fold_stats",
    "history_features",
    "hour_block_expr",
]


class Target(StrEnum):
    """The four corrected variables."""

    T = "t"
    TD = "td"
    WIND = "wind"
    WBGT = "wbgt"


TRUTH_COLUMN: Final[Mapping[Target, str]] = MappingProxyType(
    {Target.T: "obs_t_c", Target.TD: "obs_td_c", Target.WIND: "obs_wind_ms", Target.WBGT: "wbgt_obs_c"}
)
"""The gold column that holds the truth of each target."""

FORECAST_COLUMN: Final[Mapping[Target, str]] = MappingProxyType(
    {Target.T: "fc_t_c", Target.TD: "fc_td_c", Target.WIND: "fc_wind_ms", Target.WBGT: "wbgt_fc_c"}
)
"""The gold column that holds the IFS forecast of each target."""


class FeatureSet(StrEnum):
    """``SITE`` is every feature; ``COLD`` leaves out the station-history group (for a station never trained on)."""

    SITE = "site"
    COLD = "cold"


_TIMING: Final = ("lead_days", "hour_utc", "doy")
_IFS: Final = (
    "fc_t_c",
    "fc_td_c",
    "fc_wind_ms",
    "fc_sw_wm2",
    "fc_direct_wm2",
    "fc_pressure_hpa",
    "fc_dewpoint_depression_c",
    "fc_rh_pct",
    "wbgt_fc_c",
)
_GFS: Final = (
    "gfs_t_c",
    "gfs_td_c",
    "gfs_wind_ms",
    "ifs_minus_gfs_t_c",
    "ifs_minus_gfs_td_c",
    "ifs_minus_gfs_wind_ms",
)
_GEOMETRY: Final = ("station_elev_m", "grid_elev_m", "elev_diff_m")
_CLIMATOLOGY: Final = ("clim_t", "clim_td", "clim_wbgt")
_STATION_HISTORY: Final = ("sclim_t", "sclim_td", "sclim_wbgt", "bias7_t", "bias7_td", "bias7_wind")

_COLD_FEATURES: Final = (*_TIMING, *_IFS, *_GFS, *_GEOMETRY, *_CLIMATOLOGY)
_SITE_FEATURES: Final = (*_COLD_FEATURES, *_STATION_HISTORY)


def feature_columns(feature_set: FeatureSet) -> tuple[str, ...]:
    """The feature columns of a set, in the fixed order of the pre-registration table (section 3.2).

    ``dewpoint depression`` is ``fc_t_c - fc_td_c``, ``elev_diff_m`` is ``grid_elev_m - station_elev_m``, and
    ``ifs_minus_gfs_*`` is IFS minus GFS.
    """
    return _SITE_FEATURES if feature_set is FeatureSet.SITE else _COLD_FEATURES


BANNED_COLUMNS: Final[frozenset[str]] = frozenset(
    {
        # obs_*
        "obs_t_c",
        "obs_td_c",
        "obs_wind_ms",
        # audit_*
        "audit_t_c",
        "audit_td_c",
        "audit_wind_ms",
        # ref_*: lead-0 radiation and pressure, same-day information
        "ref_sw_wm2",
        "ref_direct_wm2",
        "ref_pressure_hpa",
        # wbgt_obs_*
        "wbgt_obs_c",
        "wbgt_obs_reject",
        # wbgt_fc_refrad_*
        "wbgt_fc_refrad_c",
        "wbgt_fc_refrad_reject",
        "has_joint_obs",
        "summer",
        "station",
        "cluster",
        "grid_lat",  # a site identifier in disguise
        "grid_lon",
    }
)
"""Never a feature (pre-registration L1), as the concrete columns of ``GOLD_PAIRS_SCHEMA`` the patterns name."""

_IFS_MODEL: Final = NwpModel.ECMWF_IFS025.value
_GFS_MODEL: Final = NwpModel.GFS_SEAMLESS.value
_WINDOW_DAYS: Final = 7  # the climatology half-window and the history length, in days
_MAX_DOY: Final = 366
_CLUSTER_OF: Final = {s.icao: s.cluster for s in STATIONS}

_KEYS: Final = ("station", "cluster", "summer", "valid_time", "lead_days", "hour_utc", "hour_block", "valid_date")
_HISTORY_KEYS: Final = ("station", "valid_date", "lead_days", "hour_block")
_HISTORY_TRUTH: Final = ("obs_t_c", "obs_td_c", "obs_wind_ms")
_REQUIRED: Final = (
    "station",
    "model",
    "valid_time",
    "lead_days",
    "fc_t_c",
    "fc_td_c",
    "fc_wind_ms",
    "fc_sw_wm2",
    "fc_direct_wm2",
    "fc_pressure_hpa",
    "wbgt_fc_c",
    "station_elev_m",
    "grid_elev_m",
)


def hour_block_expr(hour_utc: pl.Expr) -> pl.Expr:
    """The hour-block name of a UTC-hour expression, null outside the modelled hours (vectorized ``hour_block``)."""
    return pl.coalesce(
        [pl.when(hour_utc.is_in(list(hours))).then(pl.lit(block.value)) for block, hours in HOUR_BLOCKS.items()]
    )


def _require(frame: pl.DataFrame, columns: tuple[str, ...], what: str) -> None:
    missing = [name for name in columns if name not in frame.columns]
    if missing:
        raise ValueError(f"{what} lacks the required columns {missing}")


def _num(name: str) -> pl.Expr:
    """A float column with NaN turned into null (gold stores NaN for a rejected WBGT), so counts are honest."""
    return pl.col(name).fill_nan(None)


def _calendar() -> list[pl.Expr]:
    """Date, hour and day of year of the UTC ``valid_time`` (never GST), and the hour-block of that hour."""
    return [
        pl.col("valid_time").dt.date().alias("valid_date"),
        pl.col("valid_time").dt.hour().cast(pl.Int8()).alias("hour_utc"),
        pl.col("valid_time").dt.ordinal_day().cast(pl.Int16()).alias("doy"),
    ]


@dataclass(frozen=True, eq=False)
class FoldStats:
    """The statistics fitted on one fold's training rows (L4); applying them to other rows reads nothing else.

    ``eq=False`` because a frame has no scalar equality: compare the two frames with ``DataFrame.equals``.

    Attributes:
        pooled_climatology: Keys ``hour_utc``, ``doy``; columns ``clim_t``, ``clim_td``, ``clim_wbgt``. The mean truth
            over every training station-hour in the window, pooled over all the stations of the fold.
        station_climatology: Keys ``station``, ``hour_utc``, ``doy``; columns ``sclim_t``, ``sclim_td``, ``sclim_wbgt``,
            the same mean for one station.
    """

    pooled_climatology: pl.DataFrame
    station_climatology: pl.DataFrame


def _windowed_means(rows: pl.DataFrame, keys: list[str], columns: Mapping[str, str]) -> pl.DataFrame:
    """Mean of each source column over ``doy`` +- 7 days, per ``keys`` and hour; the window is not circular.

    A window that runs past the first or last day with data (or past day 1 or 366) is simply truncated: it has fewer
    days, never wrapped days. A target day is kept only if some column has a value in its window.
    """
    daily = rows.group_by([*keys, "hour_utc", "doy"], maintain_order=True).agg(
        [pl.col(source).sum().alias(f"{name}__sum") for name, source in columns.items()]
        + [pl.col(source).count().alias(f"{name}__n") for name, source in columns.items()]
    )
    offsets = pl.DataFrame({"offset": list(range(-_WINDOW_DAYS, _WINDOW_DAYS + 1))}, schema={"offset": pl.Int32()})
    expanded = (
        daily.join(offsets, how="cross")
        .with_columns((pl.col("doy").cast(pl.Int32()) + pl.col("offset")).alias("target_doy"))
        .filter(pl.col("target_doy").is_between(1, _MAX_DOY))
    )
    pooled = expanded.group_by([*keys, "hour_utc", "target_doy"], maintain_order=True).agg(
        [pl.col(f"{name}__sum").sum() for name in columns] + [pl.col(f"{name}__n").sum() for name in columns]
    )
    means = pooled.select(
        *keys,
        "hour_utc",
        pl.col("target_doy").cast(pl.Int16()).alias("doy"),
        *[
            pl.when(pl.col(f"{name}__n") > 0).then(pl.col(f"{name}__sum") / pl.col(f"{name}__n")).alias(name)
            for name in columns
        ],
    )
    return means.filter(pl.any_horizontal(pl.col(name).is_not_null() for name in columns)).sort(
        [*keys, "hour_utc", "doy"]
    )


def fit_fold_stats(train_pairs: pl.DataFrame) -> FoldStats:
    """The climatologies of one fold, from its training rows only (L4, L6).

    Only the IFS lead-1 rows are read, so each station-hour counts once (the truth does not depend on the model or the
    lead). The window is +-7 days centred on ``doy``, truncated at the ends and never wrapped, and the mean is over the
    station-hours of the window (row-weighted: a station with more rows weighs more). ``wbgt_obs_c`` counts only where
    ``wbgt_obs_reject == 0`` and it is finite; temperature and dew point use their own non-null truth. Whatever is in
    ``train_pairs`` is the fold: a held-out cluster must be removed by the caller and then leaves no trace.

    Args:
        train_pairs: A gold-shaped frame with ``station``, ``model``, ``valid_time``, ``lead_days``, ``obs_t_c``,
            ``obs_td_c``, ``wbgt_obs_c`` and ``wbgt_obs_reject``.

    Raises:
        ValueError: A required column is missing.
    """
    _require(
        train_pairs,
        ("station", "model", "valid_time", "lead_days", "obs_t_c", "obs_td_c", "wbgt_obs_c", "wbgt_obs_reject"),
        "train_pairs",
    )
    rows = (
        train_pairs.filter((pl.col("model") == _IFS_MODEL) & (pl.col("lead_days") == MODEL_LEADS[0]))
        .with_columns(*_calendar())
        .select(
            "station",
            "hour_utc",
            "doy",
            _num("obs_t_c").alias("truth_t"),
            _num("obs_td_c").alias("truth_td"),
            pl.when(pl.col("wbgt_obs_reject") == 0).then(_num("wbgt_obs_c")).alias("truth_wbgt"),
        )
    )
    names = {"t": "truth_t", "td": "truth_td", "wbgt": "truth_wbgt"}
    pooled = _windowed_means(rows, [], {f"clim_{name}": source for name, source in names.items()})
    per_station = _windowed_means(rows, ["station"], {f"sclim_{name}": source for name, source in names.items()})
    return FoldStats(pooled_climatology=pooled, station_climatology=per_station)


def history_features(pairs: pl.DataFrame) -> pl.DataFrame:
    """The station-history feature ``bias7_*`` for every (station, UTC date, lead, hour-block) of the IFS rows.

    From the IFS lead-1 rows: the daily mean error (forecast minus truth) per station, hour-block and UTC date, then
    for target day D at lead L the mean of the daily values over the UTC dates D - L - 7 to D - L - 1. Truth of a date
    on or after D - L is never read (L3: it is not known when the forecast is issued). Days with no data are skipped
    and the mean is over the days that have it; a window with none, such as the first week of a summer, is null and is
    never filled. Each variable uses its own non-null truth, so a row without a wind observation still contributes to
    ``bias7_t``. Only leads 1 and above get a row, and rows of other hours than 02-15 UTC have no block, so none.

    Args:
        pairs: A gold-shaped frame with ``station``, ``model``, ``valid_time``, ``lead_days``, ``fc_t_c``, ``fc_td_c``,
            ``fc_wind_ms``, ``obs_t_c``, ``obs_td_c`` and ``obs_wind_ms``. Pass the rows the history may come from: a
            caller that fits inside a fold passes that fold's rows.

    Returns:
        Keys ``station``, ``valid_date``, ``lead_days``, ``hour_block``; columns ``bias7_t``, ``bias7_td``,
        ``bias7_wind``; sorted by the keys.

    Raises:
        ValueError: A required column is missing.
    """
    _require(
        pairs,
        ("station", "model", "valid_time", "lead_days", "fc_t_c", "fc_td_c", "fc_wind_ms", *_HISTORY_TRUTH),
        "pairs",
    )
    ifs = (
        pairs.filter(pl.col("model") == _IFS_MODEL)
        .with_columns(*_calendar())
        .with_columns(hour_block_expr(pl.col("hour_utc")).alias("hour_block"))
        .filter(pl.col("hour_block").is_not_null())
    )
    targets = ifs.filter(pl.col("lead_days") >= MODEL_LEADS[0]).select(_HISTORY_KEYS).unique()
    daily = (
        ifs.filter(pl.col("lead_days") == MODEL_LEADS[0])
        .group_by("station", "hour_block", "valid_date", maintain_order=True)
        .agg(
            (_num("fc_t_c") - _num("obs_t_c")).mean().alias("e_t"),
            (_num("fc_td_c") - _num("obs_td_c")).mean().alias("e_td"),
            (_num("fc_wind_ms") - _num("obs_wind_ms")).mean().alias("e_wind"),
        )
        .rename({"valid_date": "window_date"})
    )
    days_back = pl.DataFrame({"back": list(range(1, _WINDOW_DAYS + 1))}, schema={"back": pl.Int32()})
    window = (
        targets.join(days_back, how="cross")
        # the dates D - L - 1 ... D - L - 7, as UTC dates
        .with_columns(
            (pl.col("valid_date") - pl.duration(days=pl.col("lead_days").cast(pl.Int32()) + pl.col("back"))).alias(
                "window_date"
            )
        )
        .join(daily, on=["station", "hour_block", "window_date"], how="left", validate="m:1")
    )
    return (
        window.group_by(_HISTORY_KEYS, maintain_order=True)
        .agg(
            pl.col("e_t").mean().alias("bias7_t"),
            pl.col("e_td").mean().alias("bias7_td"),
            pl.col("e_wind").mean().alias("bias7_wind"),
        )
        .sort(_HISTORY_KEYS)
    )


def _humidity(frame: pl.DataFrame) -> list[pl.Series]:
    """Relative humidity from the physics module, a null wherever the temperature or the dew point is."""
    t = frame["fc_t_c"].to_numpy()
    td = frame["fc_td_c"].to_numpy()
    rh = np.asarray(relative_humidity_pct(t, td), dtype=np.float64)
    return [pl.Series("fc_rh_pct", rh, dtype=pl.Float64()).fill_nan(None)]


def build_features(
    pairs: pl.DataFrame, *, feature_set: FeatureSet, stats: FoldStats, history: pl.DataFrame | None
) -> pl.DataFrame:
    """The model frame: one row per IFS row of ``pairs``, with the features, the raw forecasts and the targets.

    Input contract. Required columns: ``station``, ``model``, ``valid_time`` (UTC), ``lead_days``, ``fc_t_c``,
    ``fc_td_c``, ``fc_wind_ms``, ``fc_sw_wm2``, ``fc_direct_wm2``, ``fc_pressure_hpa``, ``wbgt_fc_c``,
    ``station_elev_m`` and ``grid_elev_m``. Optional: ``cluster`` (default: the cluster of ``STATIONS``), ``summer``
    (default: the UTC year), ``wbgt_fc_reject``, and the truth columns ``obs_t_c``, ``obs_td_c``, ``obs_wind_ms``,
    ``has_joint_obs``, ``wbgt_obs_c`` and ``wbgt_obs_reject``. ``hour_utc`` and ``doy`` come from ``valid_time``, never
    from the frame. Columns ``ref_*``, ``audit_*``, ``grid_lat``, ``grid_lon`` and any other are ignored: a serving
    frame, with no truth at all, builds the same features as a gold frame.

    The IFS rows are the spine; the output keeps their order, and never drops a row. The GFS row with the identical
    (``station``, ``valid_time``, ``lead_days``) gives the GFS features, and where there is none they are null, as are
    the IFS-minus-GFS differences (L8). A row whose hour is outside 02-15 UTC has a null ``hour_block``; its features
    (other than the ``lead_days`` and ``hour_utc`` that are also its keys), its ``raw_*`` and its ``y_*`` are
    all null, so it can neither be trained on nor scored.

    Targets ``y_*`` are truth minus forecast, present only for the truth columns the frame has. ``y_t``, ``y_td`` and
    ``y_wind`` are null where the truth is missing or ``has_joint_obs`` is false (when that column exists);
    ``y_wbgt`` is null where ``wbgt_obs_reject != 0`` or the truth or forecast WBGT is NaN or null. A WBGT forecast
    with ``wbgt_fc_reject != 0`` (or NaN) is null in ``wbgt_fc_c`` and ``raw_wbgt``.

    Args:
        pairs: The gold-shaped frame described above.
        feature_set: ``SITE`` or ``COLD``.
        stats: The fold statistics (``fit_fold_stats`` on the fold's training rows).
        history: The ``history_features`` frame; required for ``SITE`` and ignored for ``COLD``.

    Returns:
        Columns: ``station``, ``cluster``, ``summer``, ``valid_time``, ``lead_days``, ``hour_utc``, ``hour_block``,
        ``valid_date``, then the other feature columns of ``feature_columns(feature_set)`` in order, then ``raw_t``,
        ``raw_td``, ``raw_wind``, ``raw_wbgt``, then the ``y_*`` that the truth columns allow.

    Raises:
        ValueError: A required column is missing, or the set is ``SITE`` and ``history`` is ``None``.
    """
    _require(pairs, _REQUIRED, "pairs")
    if feature_set is FeatureSet.SITE and history is None:
        raise ValueError("the site feature set needs the station history (history_features); only cold may omit it")
    have = set(pairs.columns)

    gfs = pairs.filter(pl.col("model") == _GFS_MODEL).select(
        "station",
        "valid_time",
        "lead_days",
        _num("fc_t_c").alias("gfs_t_c"),
        _num("fc_td_c").alias("gfs_td_c"),
        _num("fc_wind_ms").alias("gfs_wind_ms"),
    )
    wbgt_fc: pl.Expr = _num("wbgt_fc_c")
    if "wbgt_fc_reject" in have:
        wbgt_fc = pl.when(pl.col("wbgt_fc_reject") == 0).then(wbgt_fc)
    defaults: list[pl.Expr] = []
    if "cluster" not in have:
        defaults.append(
            pl.col("station").replace_strict(_CLUSTER_OF, default=None, return_dtype=pl.String()).alias("cluster")
        )
    if "summer" not in have:
        defaults.append(pl.col("valid_time").dt.year().cast(pl.Int16()).alias("summer"))
    frame = (
        pairs.filter(pl.col("model") == _IFS_MODEL)
        .with_columns(*_calendar())
        .with_columns(
            hour_block_expr(pl.col("hour_utc")).alias("hour_block"),
            *[_num(name).alias(name) for name in _REQUIRED if name.startswith("fc_")],
            wbgt_fc.alias("wbgt_fc_c"),
            *defaults,
        )
    )
    frame = frame.with_columns(
        *_humidity(frame),
        (pl.col("fc_t_c") - pl.col("fc_td_c")).alias("fc_dewpoint_depression_c"),
        (pl.col("grid_elev_m") - pl.col("station_elev_m")).alias("elev_diff_m"),
    )
    frame = frame.join(
        gfs, on=["station", "valid_time", "lead_days"], how="left", validate="m:1", maintain_order="left"
    ).with_columns(
        (pl.col("fc_t_c") - pl.col("gfs_t_c")).alias("ifs_minus_gfs_t_c"),
        (pl.col("fc_td_c") - pl.col("gfs_td_c")).alias("ifs_minus_gfs_td_c"),
        (pl.col("fc_wind_ms") - pl.col("gfs_wind_ms")).alias("ifs_minus_gfs_wind_ms"),
    )
    frame = frame.join(
        stats.pooled_climatology, on=["hour_utc", "doy"], how="left", validate="m:1", maintain_order="left"
    )
    if feature_set is FeatureSet.SITE and history is not None:
        frame = frame.join(
            stats.station_climatology,
            on=["station", "hour_utc", "doy"],
            how="left",
            validate="m:1",
            maintain_order="left",
        ).join(history, on=list(_HISTORY_KEYS), how="left", validate="m:1", maintain_order="left")

    raw = [pl.col(FORECAST_COLUMN[target]).alias(f"raw_{target.value}") for target in Target]
    errors: list[pl.Expr] = []
    for target in Target:
        truth_name = TRUTH_COLUMN[target]
        if truth_name not in have:
            continue
        truth: pl.Expr = _num(truth_name)
        if target is Target.WBGT and "wbgt_obs_reject" in have:
            truth = pl.when(pl.col("wbgt_obs_reject") == 0).then(truth)
        elif target is not Target.WBGT and "has_joint_obs" in have:
            truth = pl.when(pl.col("has_joint_obs")).then(truth)
        errors.append((truth - pl.col(FORECAST_COLUMN[target])).alias(f"y_{target.value}"))
    frame = frame.with_columns(*raw, *errors)

    modelled = pl.col("hour_block").is_not_null()
    values = [name for name in feature_columns(feature_set) if name not in _KEYS]
    values += [expr.meta.output_name() for expr in (*raw, *errors)]
    return frame.select(*_KEYS, *[pl.when(modelled).then(pl.col(name)).alias(name) for name in values])
