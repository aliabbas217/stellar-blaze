"""The release smoke check and the headline dev metrics of ``sb-jobs train``."""

import copy

import numpy as np
import polars as pl
import pytest

from stellar_blaze.domain.forecast.features import Target
from stellar_blaze.domain.forecast.grid import F64, LEVELS
from stellar_blaze.ml import predict
from stellar_blaze.ml.release_check import DegenerateModelError, loco_headline_metrics, release_smoke_check
from stellar_blaze.ml.train import TrainedCorrector
from tests.fixtures.forecast.train_cli import dev_skill_payload
from tests.fixtures.forecast.trained import trained_small

pytestmark = pytest.mark.unit

SUMMER = 2024  # the summer of ``small_pairs``
CORRECTED_GRIDS = "stellar_blaze.ml.release_check.corrected_grids"


# === the smoke check ================================================================================================


@pytest.mark.slow
def test_a_real_corrector_passes_and_the_sample_is_deterministic_and_bounded() -> None:
    pairs, trained = trained_small()

    first = release_smoke_check(trained, pairs, max_rows=300, summer=SUMMER)
    second = release_smoke_check(trained, pairs, max_rows=300, summer=SUMMER)

    assert first == second
    assert set(first) == {"t", "td", "wind"}
    assert first["t"] > 1.0  # the fixture runs +3 degrees warm at two stations: the correction is real


def _unchanged(*targets: Target) -> object:
    """A ``corrected_grids`` double: the given targets' median is the raw forecast itself (a constant corrector)."""
    real = predict.corrected_grids

    def corrected(trained: TrainedCorrector, rows: pl.DataFrame) -> dict[Target, F64]:
        grids = real(trained, rows)
        for target in targets:
            raw = rows[f"raw_{target.value}"].cast(pl.Float64()).fill_null(float("nan")).to_numpy()
            grids[target] = np.repeat(raw[:, None], len(LEVELS), axis=1)
        return grids

    return corrected


@pytest.mark.slow
@pytest.mark.parametrize("target", [Target.T, Target.TD, Target.WIND])
def test_a_corrector_that_changes_nothing_for_one_target_is_refused_and_names_it(
    monkeypatch: pytest.MonkeyPatch, target: Target
) -> None:
    pairs, trained = trained_small()
    monkeypatch.setattr(CORRECTED_GRIDS, _unchanged(target))

    with pytest.raises(DegenerateModelError, match=rf"for {target.value}\b"):
        release_smoke_check(trained, pairs, max_rows=300, summer=SUMMER)


@pytest.mark.slow
def test_a_corrector_that_changes_nothing_for_any_target_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    pairs, trained = trained_small()
    monkeypatch.setattr(CORRECTED_GRIDS, _unchanged(Target.T, Target.TD, Target.WIND))

    with pytest.raises(DegenerateModelError, match="t, td, wind"):
        release_smoke_check(trained, pairs, max_rows=300, summer=SUMMER)


@pytest.mark.slow
def test_a_summer_with_no_rows_is_refused() -> None:
    pairs, trained = trained_small()

    with pytest.raises(DegenerateModelError, match="no modelled row of summer 2025"):
        release_smoke_check(trained, pairs, max_rows=300, summer=2025)


# === the headline metrics ===========================================================================================


def test_loco_metrics_pool_the_three_leads_by_scored_rows_and_leave_out_what_is_missing() -> None:
    metrics = loco_headline_metrics(dev_skill_payload())

    assert set(metrics) == {"loco_crps_t"}  # td has a missing B2d number: omitted, not invented
    assert metrics["loco_crps_t"] == pytest.approx(
        {
            "corrector": (100 * 0.5 + 300 * 0.6 + 600 * 0.7) / 1000,
            "b0": (100 * 2.0 + 300 * 2.2 + 600 * 2.4) / 1000,
            "b2d": (100 * 1.0 + 300 * 1.1 + 600 * 1.2) / 1000,
        }
    )


def test_a_target_without_all_three_leads_is_left_out() -> None:
    payload = copy.deepcopy(dev_skill_payload())
    table = payload["skill"]
    assert isinstance(table, dict)
    table["rows"] = [row for row in table["rows"] if not (row[0] == "t" and row[1] == 2)]

    assert loco_headline_metrics(payload) == {}


def test_a_lead_without_scored_rows_leaves_the_target_out() -> None:
    payload = copy.deepcopy(dev_skill_payload())
    table = payload["skill"]
    assert isinstance(table, dict)
    for row in table["rows"]:
        if row[0] == "t" and row[1] == 3:
            row[3] = 0

    assert "loco_crps_t" not in loco_headline_metrics(payload)


@pytest.mark.parametrize(
    "payload",
    [{}, {"skill": []}, {"skill": {"columns": ["target"], "rows": []}}, {"skill": {"columns": 1, "rows": []}}],
)
def test_a_malformed_skill_table_raises(payload: dict[str, object]) -> None:
    with pytest.raises(ValueError, match="skill"):
        loco_headline_metrics(payload)
