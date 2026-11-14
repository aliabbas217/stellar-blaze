"""A small development run of the synthetic fixture, shared by the selection, export and command tests (Task 12).

Three stations of three clusters (``abu_dhabi``, ``dubai_sharjah``, ``fujairah``), both dev summers, leads 1-3, four
hours (one early, two peak, one late) and tiny LightGBM parameters. OMAA and OMDB run +3 degrees warm (see
``tests/fixtures/forecast/trained.py`` for why +3 and not +1.5). Lead 0 is removed as the dev loader does (rule L2).
"""

from functools import cache
from typing import Final

import polars as pl

from stellar_blaze.ml.training_config import TrainingConfig
from tests.fixtures.forecast.synthetic import make_pairs
from tests.fixtures.forecast.trained import small_config

STATIONS: Final = ("OMAA", "OMDB", "OMFJ")
CLUSTERS: Final = ("abu_dhabi", "dubai_sharjah", "fujairah")
HOURS: Final = (3, 7, 8, 13)
WARM: Final = ("OMAA", "OMDB")
TINY_GRID: Final = ((7, 20, 5), (7, 20, 12), (15, 20, 5), (15, 20, 12))


def dev_cfg(**overrides: object) -> TrainingConfig:
    """The small config restricted to leads 1-3, with ``overrides`` applied (no validation, as ``model_copy``)."""
    return small_config().model_copy(update={"leads": (1, 2, 3), **overrides})


@cache
def _dev_pairs(with_lead_zero: bool) -> pl.DataFrame:
    pairs = make_pairs(
        seed=7,
        summers=(2024, 2025),
        station_bias_c=dict.fromkeys(WARM, 3.0),
        stations=STATIONS,
        leads=range(4),
        hours_utc=HOURS,
    )
    return pairs if with_lead_zero else pairs.filter(pl.col("lead_days") > 0)


def dev_pairs(*, with_lead_zero: bool = False) -> pl.DataFrame:
    """A copy of the fixture's dev rows (``with_lead_zero`` keeps lead 0, as a gold file does before the loader)."""
    return _dev_pairs(with_lead_zero).clone()
