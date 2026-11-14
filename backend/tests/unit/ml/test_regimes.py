"""The folds and ``split`` (Task 11): whole clusters held out, never a row in both sides, no data read."""

import dataclasses
from typing import Final

import polars as pl
import pytest

from stellar_blaze.domain.weather.stations import STATIONS
from stellar_blaze.ml.data import DEV_SUMMERS
from stellar_blaze.ml.regimes import CLUSTERS, Fold, loco_folds, regime_b_all_folds, regime_c_folds, split
from tests.fixtures.forecast.synthetic import make_pairs

pytestmark = pytest.mark.unit

FIXTURE_STATIONS: Final = ("OMAA", "OMAD", "OMDB", "OMSJ", "OMAL", "OMFJ")
EXPECTED_CLUSTERS: Final = {"abu_dhabi", "dubai_sharjah", "al_maktoum", "al_ain", "fujairah", "ras_al_khaimah"}


def _pairs() -> pl.DataFrame:
    """A tiny two-summer frame of six stations from four clusters (the cluster column is the gold one)."""
    return make_pairs(
        seed=3,
        summers=(2024, 2025),
        station_bias_c={},
        stations=FIXTURE_STATIONS,
        leads=(1,),
        hours_utc=(7,),
        summer_days=(1, 2),
    )


def test_six_loco_folds_hold_out_whole_clusters() -> None:
    folds = loco_folds(DEV_SUMMERS)
    assert len(folds) == 6
    assert set(CLUSTERS) == EXPECTED_CLUSTERS == {s.cluster for s in STATIONS}
    assert {next(iter(fold.test_clusters)) for fold in folds} == EXPECTED_CLUSTERS  # each cluster is held out once
    for fold in folds:
        assert len(fold.test_clusters) == 1
        assert fold.train_clusters == frozenset(CLUSTERS) - fold.test_clusters  # the other five, never the held-out one
        assert fold.train_summers == fold.test_summers == DEV_SUMMERS
    assert len({fold.name for fold in folds}) == 6


def test_dubai_sharjah_holds_out_omdb_and_omsj_together() -> None:
    fold = next(f for f in loco_folds(DEV_SUMMERS) if f.test_clusters == {"dubai_sharjah"})
    train, test = split(_pairs(), fold)
    assert set(test["station"].unique()) == {"OMDB", "OMSJ"}  # both stations leave together
    assert not {"OMDB", "OMSJ"} & set(train["station"].unique())
    assert {s.icao for s in STATIONS if s.cluster == "dubai_sharjah"} == {"OMDB", "OMSJ"}


def test_regime_c_describes_five_clusters_on_dev_summers_against_the_sixth_in_2026(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("a regime description must not read data")

    monkeypatch.setattr(pl, "read_parquet", forbidden)
    monkeypatch.setattr(pl, "scan_parquet", forbidden)
    folds = regime_c_folds()
    assert len(folds) == 6
    for fold in folds:
        assert fold.train_summers == DEV_SUMMERS
        assert fold.test_summers == frozenset({2026})
        assert len(fold.train_clusters) == 5
        assert not fold.train_clusters & fold.test_clusters
    assert {next(iter(f.test_clusters)) for f in folds} == EXPECTED_CLUSTERS


def test_regime_b_all_trains_and_tests_on_all_three_summers() -> None:
    folds = regime_b_all_folds()
    assert len(folds) == 6
    for fold in folds:
        assert fold.train_summers == fold.test_summers == DEV_SUMMERS | {2026}
        assert len(fold.test_clusters) == 1


def test_fold_construction_refuses_an_overlap_an_empty_side_and_an_unknown_cluster() -> None:
    every = frozenset(CLUSTERS)
    with pytest.raises(ValueError, match="share cluster"):
        Fold("overlap", every, frozenset({"abu_dhabi"}), DEV_SUMMERS, DEV_SUMMERS)
    with pytest.raises(ValueError, match="empty"):
        Fold("empty", every, frozenset(), DEV_SUMMERS, DEV_SUMMERS)
    with pytest.raises(ValueError, match="unknown cluster"):
        Fold("unknown", frozenset({"atlantis"}), frozenset({"abu_dhabi"}), DEV_SUMMERS, DEV_SUMMERS)
    # the same clusters on separate summers is a legitimate fold (the summer split)
    Fold("summers", every, every, frozenset({2024}), frozenset({2025}))


def test_split_partitions_the_rows_and_never_shares_one() -> None:
    pairs = _pairs()
    for fold in loco_folds(DEV_SUMMERS):
        if not fold.test_clusters & set(pairs["cluster"].unique()):
            continue  # the fixture holds four of the six clusters
        train, test = split(pairs, fold)
        assert train.height + test.height == pairs.height
        assert fold.test_clusters == set(test["cluster"].unique())
        assert not fold.test_clusters & set(train["cluster"].unique())
        both = train.select("station", "valid_time", "model", "lead_days").join(
            test.select("station", "valid_time", "model", "lead_days"),
            on=["station", "valid_time", "model", "lead_days"],
        )
        assert both.is_empty()


def test_split_raises_on_overlap() -> None:
    pairs = _pairs()
    fold = next(f for f in loco_folds(DEV_SUMMERS) if f.test_clusters == {"abu_dhabi"})
    # a fold altered after construction (the constructor refuses this one) is still caught on the data
    leaky = dataclasses.replace(fold)
    object.__setattr__(leaky, "train_clusters", frozenset(CLUSTERS))  # the held-out cluster is now in train
    with pytest.raises(ValueError, match=r"both train and test|in the training rows"):
        split(pairs, leaky)
    summer_leak = Fold("s", frozenset(CLUSTERS), frozenset(CLUSTERS), frozenset({2024}), frozenset({2025}))
    object.__setattr__(summer_leak, "test_summers", frozenset({2024, 2025}))  # test summer 2024 is in train too
    with pytest.raises(ValueError, match=r"both train and test|in the training rows"):
        split(pairs, summer_leak)


def test_split_raises_on_an_empty_side_and_a_missing_column() -> None:
    pairs = _pairs()
    ras_al_khaimah = next(f for f in loco_folds(DEV_SUMMERS) if f.test_clusters == {"ras_al_khaimah"})
    with pytest.raises(ValueError, match="no test rows"):
        split(pairs, ras_al_khaimah)  # the fixture has no OMRK
    only = pairs.filter(pl.col("cluster") == "abu_dhabi")
    abu_dhabi = next(f for f in loco_folds(DEV_SUMMERS) if f.test_clusters == {"abu_dhabi"})
    with pytest.raises(ValueError, match="no training rows"):
        split(only, abu_dhabi)
    with pytest.raises(ValueError, match="lacks the columns"):
        split(pairs.drop("cluster"), abu_dhabi)
