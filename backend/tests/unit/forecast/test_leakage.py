"""Leakage rules L1-L4, L6 and L8 of the pre-registration, pinned by perturbation tests (synthetic pairs only).

A perturbation test changes the thing that must NOT matter (truth on or after the issue day, rows of another cluster,
the banned columns) and asserts the output is identical, and then changes the thing that MUST matter and asserts the
output moves, so a test cannot pass over a function that ignores its input.
"""

from datetime import date, timedelta

import polars as pl
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from stellar_blaze.domain.forecast.features import (
    BANNED_COLUMNS,
    FeatureSet,
    FoldStats,
    build_features,
    feature_columns,
    fit_fold_stats,
    history_features,
)
from stellar_blaze.domain.forecast.grid import MODELLED_HOURS_UTC
from tests.fixtures.forecast.synthetic import make_pairs
from tests.unit.forecast.test_features import FIRST_DAY, model_rows, reference_climatology

pytestmark = pytest.mark.unit

IFS = "ecmwf_ifs025"
OBS = ("obs_t_c", "obs_td_c", "obs_wind_ms")
BIAS = ("bias7_t", "bias7_td", "bias7_wind")
KEYS = ["station", "valid_date", "lead_days", "hour_block"]
HYPOTHESIS = settings(
    max_examples=25,
    derandomize=True,
    database=None,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


@pytest.fixture(scope="module")
def pairs() -> pl.DataFrame:
    return make_pairs(
        seed=21,
        summers=(2025,),
        station_bias_c={"OMAA": 1.5, "OMFJ": -1.0},
        stations=("OMAA", "OMDB", "OMFJ"),
        leads=range(8),
        hours_utc=MODELLED_HOURS_UTC,
        summer_days=range(1, 29),
    )


@pytest.fixture(scope="module")
def stats(pairs: pl.DataFrame) -> FoldStats:
    return fit_fold_stats(pairs)


def shifted(frame: pl.DataFrame, where: pl.Expr, amount: float, columns: tuple[str, ...] = OBS) -> pl.DataFrame:
    """``frame`` with ``amount`` added to the given columns on the rows of ``where`` (nulls stay null)."""
    return frame.with_columns(*[pl.when(where).then(pl.col(c) + amount).otherwise(pl.col(c)).alias(c) for c in columns])


def on_or_after(day: date) -> pl.Expr:
    return pl.col("valid_time").dt.date() >= day


def history_of(table: pl.DataFrame, day: date, lead: int) -> pl.DataFrame:
    return table.filter((pl.col("valid_date") == day) & (pl.col("lead_days") == lead)).sort(KEYS).select(*KEYS, *BIAS)


# === L3: history reads nothing on or after the issue day ============================================================


@HYPOTHESIS
@given(offset=st.integers(8, 27), lead=st.sampled_from(range(1, 8)), amount=st.sampled_from([-20.0, 20.0]))
def test_history_ignores_truth_on_or_after_issue_day(
    pairs: pl.DataFrame, offset: int, lead: int, amount: float
) -> None:
    day = FIRST_DAY + timedelta(days=offset)
    issue_day = day - timedelta(days=lead)  # D - L
    base = history_of(history_features(pairs), day, lead)
    assert base.height == 9
    assert all(base[column].null_count() == 0 for column in BIAS)  # D - L - 1 >= the first day: there is history

    # every UTC date >= D - L moves by +-20: nothing that is known at the issue time changes
    future = history_features(shifted(pairs, on_or_after(issue_day), amount))
    assert history_of(future, day, lead).equals(base)

    # the day before the issue day (D - L - 1) is in the window: moving it moves every station, block and variable
    last = issue_day - timedelta(days=1)
    moved = history_of(history_features(shifted(pairs, pl.col("valid_time").dt.date() == last, amount)), day, lead)
    for column in BIAS:
        assert (moved[column] != base[column]).all(), column
        assert ((moved[column] - base[column]).abs() > 1e-6).all(), column


@HYPOTHESIS
@given(offset=st.integers(8, 27), lead=st.sampled_from(range(1, 8)), amount=st.sampled_from([-20.0, 20.0]))
def test_site_features_ignore_truth_on_or_after_issue_day(
    pairs: pl.DataFrame, stats: FoldStats, offset: int, lead: int, amount: float
) -> None:
    """End to end through the builder: the features of (D, L) do not move, the target does."""
    day = FIRST_DAY + timedelta(days=offset)
    future = shifted(pairs, on_or_after(day - timedelta(days=lead)), amount)
    columns = list(feature_columns(FeatureSet.SITE))

    def built(frame: pl.DataFrame) -> pl.DataFrame:
        out = build_features(
            model_rows(frame),
            feature_set=FeatureSet.SITE,
            stats=stats,
            history=history_features(frame),
        )
        return out.filter((pl.col("valid_date") == day) & (pl.col("lead_days") == lead)).sort("station", "hour_utc")

    base, perturbed = built(pairs), built(future)
    assert base.height == 3 * 14
    assert perturbed.select(columns).equals(base.select(columns))
    assert not perturbed["y_t"].equals(base["y_t"])  # the truth did move, and only the target saw it


# === L3 + L4: only IFS lead-1 rows make the history and the statistics (L2 for lead 0) ==============================


def test_history_and_fold_stats_ignore_every_row_but_ifs_lead_one(pairs: pl.DataFrame, stats: FoldStats) -> None:
    other = ~((pl.col("model") == IFS) & (pl.col("lead_days") == 1))
    scrambled = shifted(pairs, other, 33.0, (*OBS, "fc_t_c", "fc_td_c", "fc_wind_ms", "wbgt_obs_c"))
    assert history_features(scrambled).equals(history_features(pairs))
    again = fit_fold_stats(scrambled)
    assert again.pooled_climatology.equals(stats.pooled_climatology)
    assert again.station_climatology.equals(stats.station_climatology)
    # ... and a lead-1 row does count
    lead_one = (pl.col("model") == IFS) & (pl.col("lead_days") == 1)
    assert not history_features(shifted(pairs, lead_one, 3.0, ("fc_t_c",))).equals(history_features(pairs))


# === L1: nothing banned is a feature ================================================================================


def test_features_do_not_depend_on_any_banned_column(pairs: pl.DataFrame, stats: FoldStats) -> None:
    """Scramble every gold column of the L1 list (but the keys): the cold features are identical."""
    scrambled = pairs.with_columns(
        *[
            (pl.col(c) * -3.0 + 11.0).alias(c)
            for c in sorted(BANNED_COLUMNS)
            if c in pairs.columns
            and pairs.schema[c] == pl.Float64
            and not c.startswith("audit_")
            and c not in ("grid_lat", "grid_lon")
        ],
        *[pl.lit(99.0).alias(c) for c in ("audit_t_c", "audit_td_c", "audit_wind_ms")],  # null in the synthetic data
        pl.col("has_joint_obs").not_().alias("has_joint_obs"),
        (pl.col("wbgt_obs_reject") + 1).cast(pl.Int8()).alias("wbgt_obs_reject"),
        pl.col("grid_lat") + 1.0,
        pl.col("grid_lon") - 1.0,
    )
    assert scrambled.select("ref_sw_wm2", "obs_t_c").drop_nulls().height > 0  # they hold real values
    columns = list(feature_columns(FeatureSet.COLD))
    base = build_features(model_rows(pairs), feature_set=FeatureSet.COLD, stats=stats, history=None)
    changed = build_features(model_rows(scrambled), feature_set=FeatureSet.COLD, stats=stats, history=None)
    assert changed.select(columns).equals(base.select(columns))
    assert not changed["y_t"].equals(base["y_t"])  # the scramble did reach the targets, which may read the truth


# === L4 + L6: fold statistics come from the fold's training rows only ===============================================


def test_fold_stats_read_only_the_rows_they_are_given(pairs: pl.DataFrame) -> None:
    """The pure-function contract of ``fit_fold_stats`` (L4, L6): the fold is exactly the rows passed in.

    Removing a held-out cluster from the fold is the caller's job and is guarded where the folds are built (Tasks 10
    and 11); here we pin that the statistics are the ones of the given rows and of nothing else: the pooled values equal
    a plain loop over the kept stations, no other station appears, the cluster left in would change them, and so would
    a kept cluster's truth.
    """
    held_out = pl.col("cluster") == "fujairah"
    train = pairs.filter(~held_out)
    reference = fit_fold_stats(train)
    assert set(reference.station_climatology["station"].to_list()) == set(train["station"].to_list())

    # the pooled climatology is the one of the remaining stations (a plain loop), not of all three
    for hour, doy in ((6, 140), (11, 150), (9, 128)):
        for column, source in (("clim_t", "obs_t_c"), ("clim_td", "obs_td_c"), ("clim_wbgt", "wbgt_obs_c")):
            expected = reference_climatology(train, None, hour, doy, source)
            got = reference.pooled_climatology.filter((pl.col("hour_utc") == hour) & (pl.col("doy") == doy))[column][0]
            assert got == pytest.approx(expected, abs=1e-9)

    # sensitivity: with the cluster left in the fold the statistics differ, and a kept cluster moves them too
    assert not fit_fold_stats(pairs).pooled_climatology.equals(reference.pooled_climatology)
    kept = shifted(pairs, pl.col("cluster") == "dubai_sharjah", 25.0, (*OBS, "wbgt_obs_c")).filter(~held_out)
    assert not fit_fold_stats(kept).pooled_climatology.equals(reference.pooled_climatology)


def test_station_history_of_a_station_does_not_use_another_station(pairs: pl.DataFrame) -> None:
    """Features of one station do not depend on another station's truth (the history is per station)."""
    base = history_features(pairs)
    others = history_features(shifted(pairs, pl.col("station") != "OMAA", 20.0))
    own = pl.col("station") == "OMAA"
    assert others.filter(own).equals(base.filter(own))
    assert not others.filter(~own).equals(base.filter(~own))
