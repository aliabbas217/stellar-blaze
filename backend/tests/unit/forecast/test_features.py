"""The feature builder, the fold statistics and the history features (pre-registration 3.2), on synthetic pairs."""

from datetime import date, timedelta
from statistics import fmean
from typing import Any

import polars as pl
import pytest

from stellar_blaze.domain.forecast.features import (
    BANNED_COLUMNS,
    FORECAST_COLUMN,
    TRUTH_COLUMN,
    FeatureSet,
    FoldStats,
    Target,
    build_features,
    feature_columns,
    fit_fold_stats,
    history_features,
    hour_block_expr,
)
from stellar_blaze.domain.forecast.grid import HOUR_BLOCKS, MODELLED_HOURS_UTC, hour_block
from stellar_blaze.domain.physics.psychrometrics import relative_humidity_pct
from stellar_blaze.domain.weather.schemas import GOLD_PAIRS_SCHEMA
from tests.fixtures.forecast.synthetic import make_pairs

pytestmark = pytest.mark.unit

IFS, GFS = "ecmwf_ifs025", "gfs_seamless"
FIRST_DAY = date(2025, 5, 15)  # summer day 1 of the generator


def modelled(**knobs: object) -> pl.DataFrame:
    """Three stations in three clusters, 28 days from 15 May 2025, leads 0 to 3, the modelled hours (default rates)."""
    defaults: dict[str, object] = {
        "seed": 5,
        "summers": (2025,),
        "station_bias_c": {"OMAA": 1.5},
        "stations": ("OMAA", "OMDB", "OMFJ"),
        "leads": (0, 1, 2, 3),
        "hours_utc": MODELLED_HOURS_UTC,
        "summer_days": range(1, 29),
    }
    return make_pairs(**{**defaults, **knobs})  # type: ignore[arg-type]


@pytest.fixture(scope="module")
def pairs() -> pl.DataFrame:
    return modelled()


@pytest.fixture(scope="module")
def stats(pairs: pl.DataFrame) -> FoldStats:
    return fit_fold_stats(pairs)


@pytest.fixture(scope="module")
def history(pairs: pl.DataFrame) -> pl.DataFrame:
    return history_features(pairs)


def ifs_rows(pairs: pl.DataFrame) -> pl.DataFrame:
    return pairs.filter(pl.col("model") == IFS)


def only(frame: pl.DataFrame, **key: object) -> dict[str, Any]:
    """The single row of ``frame`` that matches the key."""
    rows = frame.filter(*[pl.col(name) == value for name, value in key.items()])
    assert rows.height == 1, f"{key} matched {rows.height} rows"
    return rows.row(0, named=True)


# === the closed lists ===============================================================================================


def test_feature_columns_are_pinned_in_the_preregistered_order() -> None:
    cold = (
        *("lead_days", "hour_utc", "doy"),
        *("fc_t_c", "fc_td_c", "fc_wind_ms", "fc_sw_wm2", "fc_direct_wm2", "fc_pressure_hpa"),
        *("fc_dewpoint_depression_c", "fc_rh_pct", "wbgt_fc_c"),
        *("gfs_t_c", "gfs_td_c", "gfs_wind_ms", "ifs_minus_gfs_t_c", "ifs_minus_gfs_td_c", "ifs_minus_gfs_wind_ms"),
        *("station_elev_m", "grid_elev_m", "elev_diff_m"),
        *("clim_t", "clim_td", "clim_wbgt"),
    )
    assert feature_columns(FeatureSet.COLD) == cold
    assert feature_columns(FeatureSet.SITE) == (
        *cold,
        *("sclim_t", "sclim_td", "sclim_wbgt", "bias7_t", "bias7_td", "bias7_wind"),
    )


def test_feature_columns_exclude_banned() -> None:
    for feature_set in FeatureSet:
        assert not set(feature_columns(feature_set)) & BANNED_COLUMNS
    cold = feature_columns(FeatureSet.COLD)
    assert not [name for name in cold if name.startswith(("bias7_", "sclim_"))]
    assert [name for name in feature_columns(FeatureSet.SITE) if name.startswith(("bias7_", "sclim_"))]


def test_banned_columns_cover_every_pattern_of_l1() -> None:
    """L1 names patterns (``obs_*`` ...); every gold column they match, and the named ones, must be banned."""
    patterns = ("obs_", "audit_", "ref_", "wbgt_obs_", "wbgt_fc_refrad_")
    named = {"has_joint_obs", "summer", "station", "cluster", "grid_lat", "grid_lon"}
    matched = {name for name in GOLD_PAIRS_SCHEMA.names() if name.startswith(patterns)}
    assert matched, "the patterns match nothing in the schema"
    assert matched | named == BANNED_COLUMNS
    assert set(GOLD_PAIRS_SCHEMA.names()) >= BANNED_COLUMNS


def test_the_target_column_maps_name_real_gold_columns() -> None:
    assert set(TRUTH_COLUMN) == set(FORECAST_COLUMN) == set(Target)
    assert set(TRUTH_COLUMN.values()) | set(FORECAST_COLUMN.values()) <= set(GOLD_PAIRS_SCHEMA.names())


# === hour-blocks ====================================================================================================


def test_hour_block_expression_agrees_with_the_scalar_function() -> None:
    hours = pl.DataFrame({"hour": [*range(24), None]}, schema={"hour": pl.Int8()})
    blocks = hours.select(hour_block_expr(pl.col("hour")).alias("block"))["block"].to_list()
    for hour, block in zip(hours["hour"].to_list(), blocks, strict=True):
        if hour in MODELLED_HOURS_UTC:
            assert block == hour_block(hour).value
        else:
            assert block is None
    assert {block for block in blocks if block} == {b.value for b in HOUR_BLOCKS}


# === the builder ====================================================================================================


def test_one_row_per_ifs_row_in_order_with_utc_keys(
    pairs: pl.DataFrame, stats: FoldStats, history: pl.DataFrame
) -> None:
    out = build_features(pairs, feature_set=FeatureSet.SITE, stats=stats, history=history)
    ifs = ifs_rows(pairs)
    assert out.height == ifs.height
    assert out["station"].to_list() == ifs["station"].to_list()
    assert out["valid_time"].to_list() == ifs["valid_time"].to_list()
    assert out["lead_days"].to_list() == ifs["lead_days"].to_list()
    assert out["hour_utc"].to_list() == ifs["hour_utc"].to_list()
    assert out["doy"].to_list() == ifs["doy"].to_list()
    assert out["cluster"].to_list() == ifs["cluster"].to_list()
    assert out["summer"].to_list() == ifs["summer"].to_list()
    assert out["valid_date"].to_list() == [t.date() for t in ifs["valid_time"].to_list()]
    assert out["hour_block"].to_list() == [hour_block(h).value for h in ifs["hour_utc"].to_list()]
    expected = ["station", "cluster", "summer", "valid_time", "lead_days", "hour_utc", "hour_block", "valid_date"]
    assert out.columns[: len(expected)] == expected
    assert set(feature_columns(FeatureSet.SITE)) <= set(out.columns)
    assert not set(out.columns) & (BANNED_COLUMNS - {"station", "cluster", "summer"})


def test_features_and_targets_follow_the_formulas(pairs: pl.DataFrame, stats: FoldStats) -> None:
    out = build_features(pairs, feature_set=FeatureSet.COLD, stats=stats, history=None)
    source = ifs_rows(pairs)
    key = {"station": "OMDB", "lead_days": 2}
    row = only(out.filter(pl.col("valid_date") == date(2025, 5, 20), pl.col("hour_utc") == 9), **key)
    raw = only(source.filter(pl.col("valid_time") == row["valid_time"]), **key)
    assert row["raw_t"] == raw["fc_t_c"]
    assert row["fc_dewpoint_depression_c"] == pytest.approx(raw["fc_t_c"] - raw["fc_td_c"])
    assert row["fc_rh_pct"] == pytest.approx(float(relative_humidity_pct(raw["fc_t_c"], raw["fc_td_c"])))
    assert row["elev_diff_m"] == pytest.approx(raw["grid_elev_m"] - raw["station_elev_m"])
    if raw["obs_t_c"] is not None:
        assert row["y_t"] == pytest.approx(raw["obs_t_c"] - raw["fc_t_c"])  # truth minus forecast
    assert row["clim_t"] is not None


def test_targets_null_when_truth_missing(pairs: pl.DataFrame, stats: FoldStats) -> None:
    rows = ifs_rows(pairs).filter(
        pl.col("has_joint_obs") & (pl.col("wbgt_obs_reject") == 0) & (pl.col("lead_days") == 1)
    )
    clean = rows.head(4)
    no_joint = clean.with_columns(
        pl.when(pl.int_range(pl.len()) == 0).then(False).otherwise(True).alias("has_joint_obs")
    )
    rejected = no_joint.with_columns(
        pl.when(pl.int_range(pl.len()) == 1).then(1).otherwise(0).cast(pl.Int8()).alias("wbgt_obs_reject")
    ).with_columns(
        pl.when(pl.int_range(pl.len()) == 2).then(float("nan")).otherwise(pl.col("wbgt_obs_c")).alias("wbgt_obs_c")
    )
    out = build_features(rejected, feature_set=FeatureSet.COLD, stats=stats, history=None)
    y = out.select("y_t", "y_td", "y_wind", "y_wbgt").rows()
    assert y[0][:3] == (None, None, None)  # no joint observation: T, Td and wind are not scored
    assert y[0][3] is not None  # ... but the WBGT truth is its own column
    assert y[1][3] is None  # a rejected WBGT truth nulls only y_wbgt
    assert None not in y[1][:3]
    assert y[2][3] is None  # NaN is null
    assert None not in y[2][:3]
    assert None not in y[3]
    assert out["y_wbgt"][3] == pytest.approx(rejected["wbgt_obs_c"][3] - rejected["wbgt_fc_c"][3])


def test_rejected_or_nan_wbgt_forecast_is_a_null_feature_and_rows_are_kept(
    pairs: pl.DataFrame, stats: FoldStats
) -> None:
    ifs = ifs_rows(pairs)
    flagged = ifs.head(3).with_columns(
        pl.Series("wbgt_fc_reject", [0, 3, 0], dtype=pl.Int8()),
        pl.Series("wbgt_fc_c", [30.0, 31.0, float("nan")], dtype=pl.Float64()),
    )
    out = build_features(flagged, feature_set=FeatureSet.COLD, stats=stats, history=None)
    assert out.height == 3
    assert out["wbgt_fc_c"].to_list() == [30.0, None, None]
    assert out["raw_wbgt"].to_list() == [30.0, None, None]
    assert out["y_wbgt"].to_list()[1:] == [None, None]


def test_gfs_joins_on_the_same_lead(pairs: pl.DataFrame, stats: FoldStats) -> None:
    shifted = pairs.with_columns(
        pl.when((pl.col("model") == GFS) & (pl.col("lead_days") == 2))
        .then(pl.col("fc_t_c") + 10.0)
        .otherwise(pl.col("fc_t_c"))
        .alias("fc_t_c")
    )
    out = build_features(shifted, feature_set=FeatureSet.COLD, stats=stats, history=None)
    gfs = {
        (r["station"], r["valid_time"], r["lead_days"]): r["fc_t_c"]
        for r in shifted.filter(pl.col("model") == GFS).iter_rows(named=True)
    }
    checked = {1: 0, 2: 0}
    for r in out.iter_rows(named=True):
        lead = r["lead_days"]
        expected = gfs.get((r["station"], r["valid_time"], lead))
        assert r["gfs_t_c"] == expected  # the identical lead, never another one
        if lead in checked and expected is not None:
            checked[lead] += 1
    assert min(checked.values()) > 100
    one = only(
        out.filter(pl.col("hour_utc") == 8, pl.col("valid_date") == date(2025, 5, 18)), station="OMAA", lead_days=1
    )
    two = only(
        out.filter(pl.col("hour_utc") == 8, pl.col("valid_date") == date(2025, 5, 18)), station="OMAA", lead_days=2
    )
    both = {lead: gfs.get(("OMAA", row["valid_time"], lead)) for lead, row in ((1, one), (2, two))}
    assert one["gfs_t_c"] == both[1]
    assert two["gfs_t_c"] == both[2]


def test_a_missing_gfs_row_gives_null_gfs_features_and_differences() -> None:
    frame = modelled(seed=9, gfs_missing_rate=0.3, leads=(1, 2), stations=("OMAA",))
    out = build_features(frame, feature_set=FeatureSet.COLD, stats=fit_fold_stats(frame), history=None)
    present = {
        (r["station"], r["valid_time"], r["lead_days"])
        for r in frame.filter(pl.col("model") == GFS).iter_rows(named=True)
    }
    assert out.height == ifs_rows(frame).height
    missing = 0
    for r in out.iter_rows(named=True):
        has_gfs = (r["station"], r["valid_time"], r["lead_days"]) in present
        gfs_values = (r["gfs_t_c"], r["gfs_td_c"], r["gfs_wind_ms"])
        diffs = (r["ifs_minus_gfs_t_c"], r["ifs_minus_gfs_td_c"], r["ifs_minus_gfs_wind_ms"])
        assert (None not in gfs_values) == has_gfs
        assert (None not in diffs) == has_gfs
        missing += not has_gfs
    assert missing > 50
    both = out.drop_nulls("gfs_t_c").head(1).row(0, named=True)
    gfs_t = frame.filter(
        (pl.col("model") == GFS)
        & (pl.col("valid_time") == both["valid_time"])
        & (pl.col("lead_days") == both["lead_days"])
    )["fc_t_c"][0]
    assert both["ifs_minus_gfs_t_c"] == pytest.approx(both["fc_t_c"] - gfs_t)


def test_site_needs_history_and_cold_does_not(pairs: pl.DataFrame, stats: FoldStats) -> None:
    with pytest.raises(ValueError, match="history"):
        build_features(pairs, feature_set=FeatureSet.SITE, stats=stats, history=None)
    cold = build_features(pairs, feature_set=FeatureSet.COLD, stats=stats, history=None)
    assert not [name for name in cold.columns if name.startswith(("bias7_", "sclim_"))]


def test_missing_required_columns_are_named(pairs: pl.DataFrame, stats: FoldStats) -> None:
    with pytest.raises(ValueError, match="fc_sw_wm2"):
        build_features(pairs.drop("fc_sw_wm2"), feature_set=FeatureSet.COLD, stats=stats, history=None)


def test_a_serving_frame_without_truth_builds_the_same_features(
    pairs: pl.DataFrame, stats: FoldStats, history: pl.DataFrame
) -> None:
    """R9: no ``obs_*``, ``has_joint_obs``, ``wbgt_obs_*``, ``ref_*``, ``audit_*``, ``cluster``, ``summer``."""
    serving = pairs.drop(
        [name for name in pairs.columns if name.startswith(("obs_", "audit_", "ref_", "wbgt_obs_"))]
        + ["has_joint_obs", "cluster", "summer", "hour_utc", "doy", "wbgt_fc_reject", "grid_lat", "grid_lon"]
    )
    for feature_set in FeatureSet:
        full = build_features(pairs, feature_set=feature_set, stats=stats, history=history)
        served = build_features(serving, feature_set=feature_set, stats=stats, history=history)
        assert not [name for name in served.columns if name.startswith("y_")]
        features = list(feature_columns(feature_set))
        assert full.select(features).equals(served.select(features)), feature_set
        assert full["cluster"].to_list() == served["cluster"].to_list()  # derived from STATIONS
        assert full["summer"].to_list() == served["summer"].to_list()  # the UTC year
        assert {"y_t", "y_td", "y_wind", "y_wbgt"} <= set(full.columns)


def test_an_hour_outside_the_modelled_hours_has_a_null_block_and_no_features(
    pairs: pl.DataFrame, stats: FoldStats
) -> None:
    ifs = ifs_rows(pairs).head(3)
    odd = ifs.with_columns(
        (
            pl.col("valid_time")
            + pl.lit(pl.Series([timedelta(hours=-2), timedelta(hours=7), timedelta(hours=20)], dtype=pl.Duration("us")))
        ).alias("valid_time")
    )  # the first rows are at 02:00 UTC: this gives 00:00, 09:00 and 22:00 (outside, inside, outside)
    out = build_features(odd, feature_set=FeatureSet.COLD, stats=stats, history=None)
    assert out.height == 3  # never dropped, never a crash
    blocks = out["hour_block"].to_list()
    hours = out["hour_utc"].to_list()
    for block, hour in zip(blocks, hours, strict=True):
        assert (block is None) == (hour not in MODELLED_HOURS_UTC)
    outside = out.filter(pl.col("hour_block").is_null())
    assert outside.height >= 2
    values = [
        c
        for c in out.columns
        if c not in ("station", "cluster", "summer", "valid_time", "lead_days", "hour_utc", "hour_block", "valid_date")
    ]
    assert all(outside[c].null_count() == outside.height for c in values)


# === fold statistics ================================================================================================


def reference_climatology(pairs: pl.DataFrame, station: str | None, hour: int, doy: int, source: str) -> float | None:
    """The pooled (or one station's) mean of the IFS lead-1 truth over doy +- 7, by a plain Python loop."""
    values: list[float] = []
    for r in ifs_rows(pairs).filter(pl.col("lead_days") == 1).iter_rows(named=True):
        if station is not None and r["station"] != station:
            continue
        if r["hour_utc"] != hour or abs(r["doy"] - doy) > 7:
            continue
        if source == "wbgt_obs_c" and r["wbgt_obs_reject"] != 0:
            continue
        value = r[source]
        if value is not None and value == value:
            values.append(value)
    return fmean(values) if values else None


def test_climatology_matches_a_reference_loop_with_truncated_edges(pairs: pl.DataFrame, stats: FoldStats) -> None:
    first_doy = FIRST_DAY.timetuple().tm_yday  # 135
    cases = [(8, first_doy), (8, first_doy + 5), (12, first_doy + 20), (3, first_doy - 4), (14, first_doy + 27 + 7)]
    for hour, doy in cases:
        for column, source in (("clim_t", "obs_t_c"), ("clim_td", "obs_td_c"), ("clim_wbgt", "wbgt_obs_c")):
            expected = reference_climatology(pairs, None, hour, doy, source)
            got = stats.pooled_climatology.filter((pl.col("hour_utc") == hour) & (pl.col("doy") == doy))
            assert got.height == 1
            assert got[column][0] == pytest.approx(expected, abs=1e-9), (hour, doy, column)
        for station in ("OMAA", "OMFJ"):
            expected = reference_climatology(pairs, station, hour, doy, "obs_t_c")
            got = stats.station_climatology.filter(
                (pl.col("station") == station) & (pl.col("hour_utc") == hour) & (pl.col("doy") == doy)
            )
            if expected is None:  # no truth at all in the window: no row (never a filled value)
                assert got.height == 0
            else:
                assert got["sclim_t"][0] == pytest.approx(expected, abs=1e-9), (station, hour, doy)


def test_climatology_window_is_not_circular_and_ends_where_the_data_ends(pairs: pl.DataFrame, stats: FoldStats) -> None:
    first_doy = FIRST_DAY.timetuple().tm_yday
    last_doy = first_doy + 27
    doys = set(stats.pooled_climatology["doy"].to_list())
    assert (min(doys), max(doys)) == (first_doy - 7, last_doy + 7)  # only days within 7 of a day with data
    assert doys.isdisjoint({1, 366})  # not wrapped
    frame = stats.pooled_climatology.filter(pl.col("hour_utc") == 8, pl.col("doy") == first_doy - 7)
    assert frame["clim_t"][0] == pytest.approx(
        reference_climatology(pairs, None, 8, first_doy - 7, "obs_t_c"), abs=1e-9
    )
    assert set(stats.station_climatology["station"].to_list()) == {"OMAA", "OMDB", "OMFJ"}
    assert stats.pooled_climatology.columns == ["hour_utc", "doy", "clim_t", "clim_td", "clim_wbgt"]
    assert stats.station_climatology.columns == ["station", "hour_utc", "doy", "sclim_t", "sclim_td", "sclim_wbgt"]


def test_fold_stats_use_ifs_lead_one_rows_only(pairs: pl.DataFrame, stats: FoldStats) -> None:
    """Truth is one number per station-hour; a row of another model or lead must not enter (or double count) it."""
    scrambled = pairs.with_columns(
        *[
            pl.when((pl.col("model") == IFS) & (pl.col("lead_days") == 1))
            .then(pl.col(name))
            .otherwise(pl.col(name) + 50.0)
            .alias(name)
            for name in ("obs_t_c", "obs_td_c", "wbgt_obs_c")
        ]
    )
    again = fit_fold_stats(scrambled)
    assert again.pooled_climatology.equals(stats.pooled_climatology)
    assert again.station_climatology.equals(stats.station_climatology)


def test_fold_stats_ignore_wbgt_truth_that_is_rejected(pairs: pl.DataFrame, stats: FoldStats) -> None:
    poisoned = pairs.with_columns(
        pl.when(pl.col("wbgt_obs_reject") != 0).then(1.0e6).otherwise(pl.col("wbgt_obs_c")).alias("wbgt_obs_c")
    )
    assert (pairs["wbgt_obs_reject"] != 0).sum() > 0
    assert fit_fold_stats(poisoned).pooled_climatology.equals(stats.pooled_climatology)


def test_a_cold_feature_row_carries_the_pooled_climatology(pairs: pl.DataFrame, stats: FoldStats) -> None:
    out = build_features(pairs, feature_set=FeatureSet.COLD, stats=stats, history=None)
    row = out.row(5, named=True)
    expected = stats.pooled_climatology.filter((pl.col("hour_utc") == row["hour_utc"]) & (pl.col("doy") == row["doy"]))
    assert row["clim_t"] == expected["clim_t"][0]
    assert out.null_count()["clim_t"][0] == 0


# === history features ===============================================================================================


def reference_bias7(pairs: pl.DataFrame, station: str, block: str, day: date, lead: int, variable: str) -> float | None:
    """The mean over dates [D - L - 7, D - L - 1] of the daily mean lead-1 error, by a plain Python loop."""
    forecast, truth = {
        "t": ("fc_t_c", "obs_t_c"),
        "td": ("fc_td_c", "obs_td_c"),
        "wind": ("fc_wind_ms", "obs_wind_ms"),
    }[variable]
    daily: dict[date, list[float]] = {}
    for r in ifs_rows(pairs).filter(pl.col("lead_days") == 1, pl.col("station") == station).iter_rows(named=True):
        if hour_block(r["hour_utc"]).value != block or r[forecast] is None or r[truth] is None:
            continue
        daily.setdefault(r["valid_time"].date(), []).append(r[forecast] - r[truth])
    window = [day - timedelta(days=lead + back) for back in range(1, 8)]
    means = [fmean(daily[d]) for d in window if d in daily]
    return fmean(means) if means else None


def test_history_matches_a_reference_loop(pairs: pl.DataFrame, history: pl.DataFrame) -> None:
    checked = 0
    for station in ("OMAA", "OMFJ"):
        for block in ("early", "peak", "late"):
            for day, lead in (
                (date(2025, 5, 24), 1),
                (date(2025, 6, 2), 2),
                (date(2025, 6, 8), 3),
                (date(2025, 5, 19), 3),
            ):
                row = only(history, station=station, valid_date=day, lead_days=lead, hour_block=block)
                for variable in ("t", "td", "wind"):
                    expected = reference_bias7(pairs, station, block, day, lead, variable)
                    got = row[f"bias7_{variable}"]
                    if expected is None:
                        assert got is None
                    else:
                        assert got == pytest.approx(expected, abs=1e-9), (station, block, day, lead, variable)
                        checked += 1
    assert checked > 60


def test_history_has_sign_forecast_minus_truth() -> None:
    frame = modelled(seed=3, stations=("OMAA",), station_bias_c={"OMAA": 3.0}, leads=(1,), missing_obs_rate=0.0)
    row = only(history_features(frame), station="OMAA", valid_date=date(2025, 6, 5), lead_days=1, hour_block="peak")
    assert row["bias7_t"] == pytest.approx(3.0, abs=0.7)  # a warm model gives a positive bias7


def test_history_keys_and_ordering(pairs: pl.DataFrame, history: pl.DataFrame) -> None:
    assert history.columns == ["station", "valid_date", "lead_days", "hour_block", "bias7_t", "bias7_td", "bias7_wind"]
    assert history.select("station", "valid_date", "lead_days", "hour_block").is_unique().all()
    assert history.equals(history.sort("station", "valid_date", "lead_days", "hour_block"))
    assert set(history["lead_days"].to_list()) == {1, 2, 3}  # lead 0 has no history rows
    # one row per station, UTC date, lead and block of the IFS rows
    assert history.height == 3 * 28 * 3 * 3


def test_history_date_boundary_is_utc() -> None:
    """A truth row belongs to its UTC date: hour 23 (GST of the next day) is no block, hour 15 and hour 2 are in."""
    frame = make_pairs(
        seed=4,
        summers=(2025,),
        station_bias_c={},
        stations=("OMAA",),
        leads=(1, 2),
        hours_utc=(2, 15, 23),
        summer_days=range(50, 64),  # 2025-07-03 .. 2025-07-16
        missing_obs_rate=0.0,
    )
    boundary = date(2025, 7, 9)  # 23:00 UTC of July 9 is already July 10 in GST
    assert frame.filter(pl.col("valid_time").dt.date() == boundary)["hour_utc"].unique().sort().to_list() == [2, 15, 23]

    def bump(hour: int) -> pl.DataFrame:
        return frame.with_columns(
            pl.when((pl.col("valid_time").dt.date() == boundary) & (pl.col("hour_utc") == hour))
            .then(pl.col("obs_t_c") + 20.0)
            .otherwise(pl.col("obs_t_c"))
            .alias("obs_t_c")
        )

    base = history_features(frame)

    def bias(table: pl.DataFrame, day: date, lead: int, block: str) -> object:
        return only(table, station="OMAA", valid_date=day, lead_days=lead, hour_block=block)["bias7_t"]

    # July 9 enters the window of D = July 11 at lead 1 and of D = July 12 at lead 2 (the window ends at D - L - 1) ...
    for hour, block in ((15, "late"), (2, "early")):
        moved = history_features(bump(hour))
        assert bias(moved, date(2025, 7, 11), 1, block) != pytest.approx(bias(base, date(2025, 7, 11), 1, block))
        assert bias(moved, date(2025, 7, 12), 2, block) != pytest.approx(bias(base, date(2025, 7, 12), 2, block))
        # ... and not the one of D = July 10 at lead 1 or of D = July 11 at lead 2 (it would, if the day were D - L)
        assert bias(moved, date(2025, 7, 10), 1, block) == bias(base, date(2025, 7, 10), 1, block)
        assert bias(moved, date(2025, 7, 11), 2, block) == bias(base, date(2025, 7, 11), 2, block)
    # 23:00 UTC of July 9 is July 10 in GST. It is in no block (and in no GST-dated window either): nothing moves.
    assert history_features(bump(23)).equals(base)


def test_history_null_in_the_first_week(history: pl.DataFrame) -> None:
    for lead in (1, 2, 3):
        for offset in range(8):
            day = FIRST_DAY + timedelta(days=offset)
            for row in history.filter(pl.col("valid_date") == day, pl.col("lead_days") == lead).iter_rows(named=True):
                # the newest allowed date is D - L - 1; the data start on 15 May
                has_data = day - timedelta(days=lead + 1) >= FIRST_DAY
                for column in ("bias7_t", "bias7_td", "bias7_wind"):
                    assert (row[column] is not None) == has_data, (day, lead, column)
    first = only(history, station="OMAA", valid_date=FIRST_DAY, lead_days=1, hour_block="peak")
    assert [first["bias7_t"], first["bias7_td"], first["bias7_wind"]] == [None, None, None]


def test_history_skips_missing_days_and_is_null_when_all_seven_are_missing() -> None:
    frame = modelled(seed=6, stations=("OMAA",), leads=(1, 2), missing_obs_rate=0.0, summer_days=range(1, 29))
    day = date(2025, 6, 10)
    lead = 2
    window = {day - timedelta(days=lead + back) for back in range(1, 8)}
    gap = sorted(window)[:3]
    gapped = frame.filter(~pl.col("valid_time").dt.date().is_in(gap))
    got = only(history_features(gapped), station="OMAA", valid_date=day, lead_days=lead, hour_block="peak")
    assert got["bias7_t"] == pytest.approx(reference_bias7(gapped, "OMAA", "peak", day, lead, "t"), abs=1e-9)
    assert got["bias7_t"] == pytest.approx(
        fmean(
            fmean(
                r["fc_t_c"] - r["obs_t_c"]
                for r in ifs_rows(gapped)
                .filter(
                    pl.col("lead_days") == 1, pl.col("valid_time").dt.date() == d, pl.col("hour_utc").is_between(6, 10)
                )
                .iter_rows(named=True)
            )
            for d in sorted(window)[3:]
        ),
        abs=1e-9,
    )
    emptied = frame.filter(~pl.col("valid_time").dt.date().is_in(sorted(window)))
    assert (
        only(history_features(emptied), station="OMAA", valid_date=day, lead_days=lead, hour_block="peak")["bias7_t"]
        is None
    )


def test_each_variable_uses_its_own_truth(pairs: pl.DataFrame) -> None:
    """A row with no wind truth (no joint observation) still counts in ``bias7_t`` and ``bias7_td``."""
    no_wind = pairs.with_columns(
        pl.when(pl.col("hour_utc") == 8).then(None).otherwise(pl.col("obs_wind_ms")).alias("obs_wind_ms"),
        (pl.col("hour_utc") != 8).alias("has_joint_obs"),
    )
    base = history_features(pairs)
    changed = history_features(no_wind)
    keys = ["station", "valid_date", "lead_days", "hour_block"]
    assert changed.select(keys, "bias7_t", "bias7_td").equals(base.select(keys, "bias7_t", "bias7_td"))
    peak = changed.filter(pl.col("hour_block") == "peak", pl.col("valid_date") > date(2025, 5, 20))
    peak_base = base.filter(pl.col("hour_block") == "peak", pl.col("valid_date") > date(2025, 5, 20))
    assert not peak["bias7_wind"].equals(peak_base["bias7_wind"])  # the wind mean really lost that hour
    assert peak["bias7_wind"].null_count() == 0


def test_history_needs_the_truth_columns(pairs: pl.DataFrame) -> None:
    with pytest.raises(ValueError, match="obs_wind_ms"):
        history_features(pairs.drop("obs_wind_ms"))


def test_site_features_use_the_history_and_the_station_climatology(
    pairs: pl.DataFrame, stats: FoldStats, history: pl.DataFrame
) -> None:
    out = build_features(pairs, feature_set=FeatureSet.SITE, stats=stats, history=history)
    row = only(out.filter(pl.col("hour_utc") == 8), station="OMFJ", valid_date=date(2025, 6, 4), lead_days=2)
    expected = only(history, station="OMFJ", valid_date=date(2025, 6, 4), lead_days=2, hour_block="peak")
    assert row["bias7_t"] == expected["bias7_t"]
    assert row["bias7_t"] is not None
    sclim = only(stats.station_climatology.filter(pl.col("station") == "OMFJ"), hour_utc=8, doy=row["doy"])
    assert row["sclim_t"] == sclim["sclim_t"]
    pooled = only(stats.pooled_climatology, hour_utc=8, doy=row["doy"])
    assert row["clim_t"] == pooled["clim_t"]
    assert row["clim_t"] != row["sclim_t"]
    assert (
        out.filter(pl.col("lead_days") == 0).select("bias7_t").null_count()["bias7_t"][0]
        == out.filter(pl.col("lead_days") == 0).height
    )  # lead 0 has no history (and never enters a fit)
