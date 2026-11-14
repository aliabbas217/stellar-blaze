"""The history-cutoff contract of the corrector port (pre-registration L3), and the helper that checks it."""

from collections.abc import Callable
from datetime import date, timedelta
from typing import NamedTuple

import numpy as np
import polars as pl
import pytest

from stellar_blaze.adapters.fakes.corrector import FakeCorrector
from stellar_blaze.domain.forecast.schemas import QUANTILE_COLUMNS, VARIABLES
from stellar_blaze.ports.corrector import ForecastCorrector
from tests.fixtures.forecast.synthetic import forecasts_of, make_pairs, observations_of
from tests.unit.forecast.contract import assert_respects_history_cutoff

pytestmark = pytest.mark.unit

IFS, GFS = "ecmwf_ifs025", "gfs_seamless"

# Which history dates a test double reads for a row with this UTC valid date and lead.
type _Rule = Callable[[date, int], Callable[[date], bool]]


class _HistoryUser(FakeCorrector):
    """A fake whose temperature grid is shifted by the mean temperature of the history dates its rule allows."""

    def __init__(self, rule: _Rule) -> None:
        super().__init__(spread_c=1.0)
        self._rule = rule

    def correct(
        self,
        *,
        ifs: pl.DataFrame,
        gfs: pl.DataFrame,
        history: pl.DataFrame,
        history_ifs: pl.DataFrame | None = None,
    ) -> pl.DataFrame:
        base = super().correct(ifs=ifs, gfs=gfs, history=history, history_ifs=history_ifs)
        dates = history["valid_time"].dt.date().to_list()
        values = history["t_c"].to_list()
        shifts = []
        for valid_time, lead in zip(ifs["valid_time"].to_list(), ifs["lead_days"].to_list(), strict=True):
            allowed = self._rule(valid_time.date(), lead)
            used = [v for d, v in zip(dates, values, strict=True) if allowed(d)]
            shifts.append(float(np.mean(used)) if used else 0.0)
        per_row = pl.Series(np.repeat(shifts, len(VARIABLES)))
        is_t = pl.col("variable") == "t"
        return base.with_columns(
            pl.when(is_t).then(pl.col(name) + per_row).otherwise(pl.col(name)).alias(name) for name in QUANTILE_COLUMNS
        )


def _before_issue_day(valid: date, lead: int) -> Callable[[date], bool]:
    return lambda d: d <= valid - timedelta(days=lead + 1)


def _everything(valid: date, lead: int) -> Callable[[date], bool]:
    return lambda d: True


def _day_before_valid(valid: date, lead: int) -> Callable[[date], bool]:
    # The previous day's truth regardless of the lead: fine at lead 1, a leak at lead 2 and 3.
    return lambda d: d == valid - timedelta(days=1)


class _Inputs(NamedTuple):
    ifs: pl.DataFrame
    gfs: pl.DataFrame
    history: pl.DataFrame
    history_ifs: pl.DataFrame | None


@pytest.fixture(scope="module")
def inputs() -> _Inputs:
    pairs = make_pairs(
        seed=9,
        summers=(2024,),
        station_bias_c={},
        stations=("OMAA",),
        leads=(1, 2, 3),
        hours_utc=[2, 6, 10, 14],
        summer_days=range(1, 11),
        missing_obs_rate=0.0,
        reject_rate=0.0,
        gfs_missing_rate=0.0,
    )
    return _Inputs(
        ifs=forecasts_of(pairs, IFS),
        gfs=forecasts_of(pairs, GFS),
        history=observations_of(pairs),
        history_ifs=forecasts_of(pairs, IFS),
    )


def _check(corrector: ForecastCorrector, given: _Inputs, *, uses_history: bool = False) -> None:
    assert_respects_history_cutoff(
        corrector,
        ifs=given.ifs,
        gfs=given.gfs,
        history=given.history,
        history_ifs=given.history_ifs,
        uses_history=uses_history,
    )


def test_the_fake_passes_the_contract_and_declares_no_use_of_history(inputs: _Inputs) -> None:
    corrector: ForecastCorrector = FakeCorrector(spread_c=0.8)
    _check(corrector, inputs)
    _check(corrector, inputs._replace(history_ifs=None))


def test_a_corrector_that_reads_only_before_the_issue_day_passes_when_it_declares_it_uses_history(
    inputs: _Inputs,
) -> None:
    _check(_HistoryUser(_before_issue_day), inputs, uses_history=True)


def test_declaring_no_history_use_while_using_it_fails(inputs: _Inputs) -> None:
    with pytest.raises(AssertionError, match="before the cutoff"):
        _check(_HistoryUser(_before_issue_day), inputs, uses_history=False)


@pytest.mark.parametrize("rule", [_everything, _day_before_valid])
def test_a_corrector_that_reads_history_after_the_cutoff_fails(inputs: _Inputs, rule: _Rule) -> None:
    with pytest.raises(AssertionError, match="later than the cutoff date"):
        _check(_HistoryUser(rule), inputs, uses_history=True)


def test_a_history_with_nothing_after_any_cutoff_is_rejected_as_vacuous(inputs: _Inputs) -> None:
    # The earliest forecast row is valid on 15 May with lead 1, so its cutoff is 13 May: history up to 13 May is
    # all "allowed" for every row and there is nothing to shift.
    early = inputs.history.filter(pl.col("valid_time").dt.date() <= date(2024, 5, 13))
    assert early.height == 0
    with pytest.raises(AssertionError, match="vacuous"):
        _check(FakeCorrector(), inputs._replace(history=early))
