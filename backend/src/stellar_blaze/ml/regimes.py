"""The folds of the evaluation regimes (pre-registration sections 2.2 and 2.4) and the split of a frame by a fold.

A ``Fold`` is a description: which clusters and which summers train, which clusters and summers test. ``loco_folds``,
``regime_c_folds`` and ``regime_b_all_folds`` only build descriptions; none of them reads data (the 2026 summer appears
here as a number, never as rows). ``split`` applies a fold to a frame that the caller already holds.

Rules (L6 and the ban on random splits, section 2.2):

* a cluster is always held out whole, with every station it holds (``dubai_sharjah`` is OMDB and OMSJ together);
* a row is in at most one of train and test: a fold whose train and test sets share both a cluster and a summer is
  refused at construction, and ``split`` re-checks the frames it returns (a fold altered afterwards cannot leak);
* neither side may be empty.

A LOCO fold trains and tests on the same summers (different clusters); regime (c) trains on 2024-2025 and tests on 2026
(different clusters and different summers); the summer split of ``ml.evaluate`` keeps all clusters and separates the
summers.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final

import polars as pl

from stellar_blaze.domain.weather.stations import STATIONS
from stellar_blaze.ml.data import DEV_SUMMERS, TEST_SUMMER

__all__ = [
    "CLUSTERS",
    "Fold",
    "loco_folds",
    "regime_b_all_folds",
    "regime_c_folds",
    "split",
]

CLUSTERS: Final[tuple[str, ...]] = tuple(dict.fromkeys(s.cluster for s in STATIONS))
"""The six clusters (folds) of ``STATIONS`` in the order they first appear there (ADR 0005)."""


@dataclass(frozen=True)
class Fold:
    """One train/test partition.

    Attributes:
        name: A label, for example ``"loco_abu_dhabi"``; it becomes the ``fold`` column of the out-of-fold frame.
        train_clusters: Clusters (``STATIONS`` ``cluster`` values) whose rows train.
        test_clusters: Clusters whose rows test.
        train_summers: Summers (years) whose rows train.
        test_summers: Summers whose rows test.

    Raises:
        ValueError: A set is empty, a cluster is not one of ``CLUSTERS``, or a row could be in both sides (the clusters
            overlap and so do the summers).
    """

    name: str
    train_clusters: frozenset[str]
    test_clusters: frozenset[str]
    train_summers: frozenset[int]
    test_summers: frozenset[int]

    def __post_init__(self) -> None:
        for label, values in (
            ("train_clusters", self.train_clusters),
            ("test_clusters", self.test_clusters),
            ("train_summers", self.train_summers),
            ("test_summers", self.test_summers),
        ):
            if not values:
                raise ValueError(f"fold {self.name!r}: {label} is empty")
        unknown = sorted((self.train_clusters | self.test_clusters) - set(CLUSTERS))
        if unknown:
            raise ValueError(f"fold {self.name!r}: unknown cluster(s) {unknown}; the clusters are {list(CLUSTERS)}")
        shared_clusters = self.train_clusters & self.test_clusters
        shared_summers = self.train_summers & self.test_summers
        if shared_clusters and shared_summers:
            raise ValueError(
                f"fold {self.name!r}: train and test share cluster(s) {sorted(shared_clusters)} in summer(s) "
                f"{sorted(shared_summers)}, so a row would be in both"
            )


def loco_folds(summers: frozenset[int]) -> tuple[Fold, ...]:
    """Leave-one-cluster-out: six folds, each holding one whole cluster out (selection and regime (b), section 2.3).

    Every fold trains on the other five clusters and tests on the held-out one, both over all ``summers``.

    Args:
        summers: The summers of the data (the development summers, 2024 and 2025).

    Raises:
        ValueError: ``summers`` is empty.
    """
    return tuple(
        Fold(
            name=f"loco_{cluster}",
            train_clusters=frozenset(CLUSTERS) - {cluster},
            test_clusters=frozenset({cluster}),
            train_summers=summers,
            test_summers=summers,
        )
        for cluster in CLUSTERS
    )


def regime_c_folds() -> tuple[Fold, ...]:
    """Regime (c), new cluster and new summer: train on 2024-2025 and five clusters, test 2026 on the sixth.

    A description only: it reads no data and returns no rows.
    """
    return tuple(
        Fold(
            name=f"c_{cluster}",
            train_clusters=frozenset(CLUSTERS) - {cluster},
            test_clusters=frozenset({cluster}),
            train_summers=DEV_SUMMERS,
            test_summers=frozenset({TEST_SUMMER}),
        )
        for cluster in CLUSTERS
    )


def regime_b_all_folds() -> tuple[Fold, ...]:
    """Regime (b-all), the ADR 0005 form: train on five clusters and 2024-2026, test the sixth over 2024-2026.

    A description only: it reads no data and returns no rows (it trains on 2026, so it runs inside the gated run).
    """
    every = DEV_SUMMERS | {TEST_SUMMER}
    return loco_folds(frozenset(every))


def _cells(frame: pl.DataFrame) -> set[tuple[str, int]]:
    """The distinct (cluster, summer) cells of a frame."""
    return {(str(cluster), int(summer)) for cluster, summer in frame.select("cluster", "summer").unique().iter_rows()}


def _restrict(pairs: pl.DataFrame, clusters: Iterable[str], summers: Iterable[int]) -> pl.DataFrame:
    return pairs.filter(pl.col("cluster").is_in(list(clusters)) & pl.col("summer").is_in(list(summers)))


def split(pairs: pl.DataFrame, fold: Fold) -> tuple[pl.DataFrame, pl.DataFrame]:
    """The training and the test rows of ``fold``.

    Train is ``train_clusters`` x ``train_summers``, test is ``test_clusters`` x ``test_summers``. The two returned
    frames are checked against each other: no (cluster, summer) cell may be in both, and neither may be empty.

    Args:
        pairs: A gold-shaped frame with ``cluster`` and ``summer`` columns (the cluster is the gold column, never
            recomputed from the station).
        fold: The partition.

    Returns:
        ``(train, test)``.

    Raises:
        ValueError: A column is missing; a cluster-summer cell is in both sides; or a side has no row.
    """
    missing = [name for name in ("cluster", "summer") if name not in pairs.columns]
    if missing:
        raise ValueError(f"pairs lacks the columns {missing}")
    train = _restrict(pairs, fold.train_clusters, fold.train_summers)
    test = _restrict(pairs, fold.test_clusters, fold.test_summers)
    leaked = sorted(_cells(train) & _cells(test))
    if leaked:
        raise ValueError(f"fold {fold.name!r}: the cluster-summer cell(s) {leaked} are in both train and test")
    held_out = sorted(_cells(train) & {(c, s) for c in fold.test_clusters for s in fold.test_summers})
    if held_out:
        raise ValueError(f"fold {fold.name!r}: held-out cell(s) {held_out} are in the training rows")
    if train.is_empty():
        raise ValueError(f"fold {fold.name!r}: no training rows (train clusters {sorted(fold.train_clusters)})")
    if test.is_empty():
        raise ValueError(f"fold {fold.name!r}: no test rows (test clusters {sorted(fold.test_clusters)})")
    return train, test
