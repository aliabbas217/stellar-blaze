"""A small trained corrector on the synthetic fixture, shared by the training, artefact and serving tests (Task 10).

Training is the slowest step of a unit test, so ``trained_small`` trains once per process and every caller reads the
same immutable ``TrainedCorrector``. The configuration is tiny on purpose (7 leaves, 20 trees of learning rate 0.3:
enough to learn a 3 degree station bias, quick to fit). The hours are one in the early block (03), two in the peak
block (07, 08) and one in the late block (13), so that with three stations the early and late strata hold about 90
calibration rows (below ``MIN_COPULA_ROWS``, so they take the lead-pooled copula) and the peak strata about 180 (their
own copula); all seven leads and all three blocks exist, so all 21 strata of each target are present.
"""

import hashlib
from collections.abc import Sequence
from functools import cache
from typing import Final

import polars as pl

from stellar_blaze.domain.forecast.features import FeatureSet
from stellar_blaze.domain.forecast.grid import LEVELS, MODELLED_HOURS_UTC
from stellar_blaze.ml.train import TrainedCorrector, train_corrector
from stellar_blaze.ml.training_config import TrainingConfig
from tests.fixtures.forecast.synthetic import make_pairs

# The bias is +3 degrees, not 1.5: the synthetic error has an irreducible spread of about 0.95 degrees at lead 1, so a
# perfect correction of 1.5 degrees leaves a ratio of 0.49 against the raw error (no margin under one half).
BIAS_C: Final = 3.0
BIASED: Final = ("OMAA", "OMDB")
UNBIASED: Final = ("OMFJ",)
STATIONS: Final = (*BIASED, *UNBIASED)
HOURS: Final = (3, 7, 8, 13)
CFG_SHA256: Final = hashlib.sha256(b"unit-training-config").hexdigest()


def small_config(
    *,
    feature_set: FeatureSet = FeatureSet.SITE,
    wbgt_method: str = "joint",
    window: str = "september",
    n_joint_samples: int = 20,
) -> TrainingConfig:
    """A training config small enough for a unit test (all 7 leads, the 14 modelled hours)."""
    return TrainingConfig.model_validate(
        {
            "name": "unit",
            "feature_set": feature_set.value,
            "levels": list(LEVELS),
            "leads": [1, 2, 3, 4, 5, 6, 7],
            "hours_utc": list(MODELLED_HOURS_UTC),
            "lgbm": {
                "num_leaves": 7,
                "min_child_samples": 20,
                "n_estimators": 20,
                "learning_rate": 0.3,
                "num_threads": 2,
                "seed": 20261112,
                "deterministic": True,
            },
            "calibration_window": window,
            "wbgt_method": wbgt_method,
            "n_joint_samples": n_joint_samples,
        }
    )


def small_pairs(*, summer_days: Sequence[int] | None = None, seed: int = 7) -> pl.DataFrame:
    """Gold-shaped dev rows (one summer, leads 1-7, the ``HOURS``): IFS and GFS rows, lead 0 already removed.

    Lead 0 is generated (it is the reference of the truth WBGT) and dropped, as the real dev loader does (rule L2).
    The default days are 15 May to 13 June (fit) and all of September (calibration).
    """
    pairs = make_pairs(
        seed=seed,
        summers=(2024,),
        station_bias_c=dict.fromkeys(BIASED, BIAS_C),
        stations=STATIONS,
        leads=range(8),
        hours_utc=HOURS,
        summer_days=summer_days,
    )
    return pairs.filter(pl.col("lead_days") > 0)


@cache
def _trained_small() -> tuple[pl.DataFrame, TrainedCorrector]:
    pairs = small_pairs()
    return pairs, train_corrector(pairs, small_config(), cfg_sha256=CFG_SHA256)


def trained_small() -> tuple[pl.DataFrame, TrainedCorrector]:
    """The ``small_pairs()`` frame (a copy) and the ``joint``/``site``/``september`` corrector trained on it."""
    pairs, trained = _trained_small()
    return pairs.clone(), trained
