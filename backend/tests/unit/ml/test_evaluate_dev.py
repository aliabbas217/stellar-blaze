"""The dev evaluation harness (Task 11): fold isolation, the baselines, the skill table and the tercile coverage.

Everything runs on the synthetic fixture. Five stations of four clusters (``dubai_sharjah`` holds OMDB and OMSJ), two
dev summers, leads 1-3, four hours (one early, two peak, one late), the default 60 days per summer and tiny LightGBM
parameters. OMAA, OMDB and OMSJ run +3 degrees warm (+1.5 is unreachable on this fixture: the irreducible spread makes
a perfect +1.5 correction a ratio of 0.49, see ``tests/fixtures/forecast/trained.py``).

Expected values are recomputed here from the gold-shaped ``pairs`` or from ``metrics`` and ``bootstrap`` directly, never
with the code under test.
"""

import dataclasses
from collections.abc import Callable
from datetime import date
from functools import cache
from typing import Final

import numpy as np
import polars as pl
import pytest

from stellar_blaze.domain.forecast.features import FeatureSet, Target, feature_columns
from stellar_blaze.domain.forecast.grid import LEVELS, exceedance_probability
from stellar_blaze.ml import baselines, metrics
from stellar_blaze.ml import evaluate as evaluate_module
from stellar_blaze.ml.bootstrap import paired_block_bootstrap
from stellar_blaze.ml.data import HoldoutViolationError
from stellar_blaze.ml.evaluate import (
    BRIER_THRESHOLDS_C,
    OofPredictions,
    coverage_by_forecast_tercile,
    evaluate_dev,
    evaluate_summer_split,
    skill_table,
    truth,
)
from stellar_blaze.ml.training_config import TrainingConfig
from tests.fixtures.forecast.synthetic import make_pairs
from tests.fixtures.forecast.trained import CFG_SHA256, small_config

pytestmark = pytest.mark.unit

IFS: Final = "ecmwf_ifs025"
STATIONS: Final = ("OMAA", "OMDB", "OMSJ", "OMAL", "OMFJ")
BIASED: Final = ("OMAA", "OMDB", "OMSJ")
CLUSTERS: Final = ("abu_dhabi", "dubai_sharjah", "al_ain", "fujairah")
HELD_OUT: Final = "abu_dhabi"
HOURS: Final = (3, 7, 8, 13)
MEDIAN: Final = LEVELS.index(0.5)
TRUTH_COLUMNS: Final = ("obs_t_c", "obs_td_c", "obs_wind_ms", "wbgt_obs_c")
JOINT_AND_WBGT: Final = tuple(Target)


def _cfg(feature_set: FeatureSet = FeatureSet.SITE) -> TrainingConfig:
    return small_config(feature_set=feature_set).model_copy(update={"leads": (1, 2, 3)})


@cache
def _dev_pairs() -> pl.DataFrame:
    """Two dev summers of the fixture stations, lead 0 already removed as the dev loader does (rule L2)."""
    pairs = make_pairs(
        seed=7,
        summers=(2024, 2025),
        station_bias_c=dict.fromkeys(BIASED, 3.0),
        stations=STATIONS,
        leads=range(4),
        hours_utc=HOURS,
    )
    return pairs.filter(pl.col("lead_days") > 0)


def dev_pairs() -> pl.DataFrame:
    return _dev_pairs().clone()


def _shift_truth(pairs: pl.DataFrame, where: pl.Expr, *, alternate: bool = True) -> pl.DataFrame:
    """The truth of the selected rows moved by +20 or -20 (by day parity; always +20 if not ``alternate``)."""
    delta = (pl.col("valid_time").dt.day() % 2) * 40.0 - 20.0 if alternate else pl.lit(20.0)
    return pairs.with_columns(
        pl.when(where).then(pl.col(name) + delta).otherwise(pl.col(name)).alias(name) for name in TRUTH_COLUMNS
    )


@pytest.fixture(scope="module")
def dev() -> tuple[pl.DataFrame, OofPredictions]:
    """The LOCO run of the ``site`` corrector over the four clusters; the abu_dhabi samples are kept."""
    pairs = dev_pairs()
    oof = evaluate_dev(pairs, _cfg(), cfg_sha256=CFG_SHA256, clusters=CLUSTERS, sample_clusters=(HELD_OUT,))
    return pairs, oof


def _cluster_rows(oof: OofPredictions, cluster: str) -> np.ndarray:
    return np.asarray(oof.keys["cluster"].to_numpy() == cluster)


def _assert_same_rows(first: OofPredictions, second: OofPredictions, cluster: str) -> None:
    """The cluster's rows are the same station-hours in the same order in both runs (so grids compare row by row)."""
    columns = ["station", "valid_time", "lead_days"]
    assert (
        first.keys.filter(pl.col("cluster") == cluster)
        .select(columns)
        .equals(second.keys.filter(pl.col("cluster") == cluster).select(columns))
    )


def _grid(oof: OofPredictions, cluster: str, target: Target, model: str) -> np.ndarray:
    return np.asarray(oof.grids[(target, model)][_cluster_rows(oof, cluster)])


# === the run, its shape and the guards ==============================================================================


@pytest.mark.slow
def test_oof_is_aligned_one_fold_per_cluster_and_every_model_is_present(
    dev: tuple[pl.DataFrame, OofPredictions],
) -> None:
    pairs, oof = dev
    ifs = pairs.filter(pl.col("model") == IFS)
    assert oof.keys.height == ifs.height  # every dev row is tested exactly once
    assert oof.keys.select("station", "valid_time", "lead_days").is_duplicated().sum() == 0
    assert set(oof.keys["fold"].unique()) == {f"loco_{cluster}" for cluster in CLUSTERS}
    # the held-out cluster of a fold is the only cluster in its test rows (OMDB and OMSJ together)
    by_fold = oof.keys.group_by("fold").agg(pl.col("cluster").unique().alias("clusters"))
    for fold, clusters in by_fold.iter_rows():
        assert clusters == [fold.removeprefix("loco_")], fold
    assert set(oof.keys.filter(pl.col("cluster") == "dubai_sharjah")["station"].unique()) == {"OMDB", "OMSJ"}
    n = oof.keys.height
    for target in Target:
        names = set(oof.models(target))
        assert names == ({"corrector", "b0", "b0d", "b2d", "b4"} | ({"b3d"} if target is not Target.WBGT else set()))
        for model in names:
            grid = oof.grids[(target, model)]
            assert grid.shape == ((n,) if model == "b0" else (n, len(LEVELS))), (target, model)
            assert grid.dtype == np.float64
    # B0 is the raw forecast
    raw = oof.keys["raw_t"].to_numpy()
    np.testing.assert_array_equal(oof.grids[(Target.T, "b0")], raw)
    # lead 0 never appears, and neither does an hour outside the modelled hours
    assert int(oof.keys["lead_days"].to_numpy().min()) >= 1
    assert set(oof.keys["hour_utc"].unique()) == set(HOURS)


@pytest.mark.slow
def test_samples_are_kept_for_the_requested_cluster_only(dev: tuple[pl.DataFrame, OofPredictions]) -> None:
    _, oof = dev
    assert oof.samples is not None
    assert oof.sample_index is not None
    held = oof.keys[oof.sample_index]
    assert held["cluster"].unique().to_list() == [HELD_OUT]
    assert held.height == int(_cluster_rows(oof, HELD_OUT).sum())
    assert oof.samples.shape == (held.height, _cfg().n_joint_samples, 3)
    usable = np.isfinite(oof.samples).all(axis=(1, 2))
    assert usable.mean() > 0.9
    assert (oof.samples[usable, :, 1] <= oof.samples[usable, :, 0]).all()
    assert (oof.samples[usable, :, 2] >= 0.0).all()


def test_evaluate_dev_never_sees_2026(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("2026 reached training: the guard must run first")

    monkeypatch.setattr(evaluate_module, "train_corrector", forbidden)
    pairs = make_pairs(
        seed=7,
        summers=(2024, 2026),
        station_bias_c={},
        stations=("OMAA", "OMFJ"),
        leads=range(3),
        hours_utc=HOURS,
        summer_days=(1, 2, 3),
    ).filter(pl.col("lead_days") > 0)
    assert 2026 in pairs["summer"].unique().to_list()
    with pytest.raises(HoldoutViolationError, match="2026"):
        evaluate_dev(pairs, _cfg(), cfg_sha256=CFG_SHA256)
    with pytest.raises(HoldoutViolationError, match="2026"):
        evaluate_summer_split(pairs, _cfg(), cfg_sha256=CFG_SHA256)
    # a frame that carries 2025 in its summer column but a 2026 timestamp is refused as well
    mislabeled = pairs.with_columns(pl.col("summer").replace({2026: 2025}))
    with pytest.raises(HoldoutViolationError, match="2026"):
        evaluate_dev(mislabeled, _cfg(), cfg_sha256=CFG_SHA256)


def test_lead_zero_is_refused_before_anything_is_trained(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("training started")

    monkeypatch.setattr(evaluate_module, "train_corrector", forbidden)
    with_lead_zero = make_pairs(
        seed=7,
        summers=(2024, 2025),
        station_bias_c={},
        stations=("OMAA", "OMFJ"),
        leads=range(3),
        hours_utc=HOURS,
        summer_days=(1, 2, 3),
    )
    with pytest.raises(ValueError, match="lead"):
        evaluate_dev(with_lead_zero, _cfg(), cfg_sha256=CFG_SHA256)


# === fold isolation (review focus 1) ================================================================================


@pytest.fixture(scope="module")
def cold_base() -> OofPredictions:
    return evaluate_dev(dev_pairs(), _cfg(FeatureSet.COLD), cfg_sha256=CFG_SHA256, clusters=(HELD_OUT,))


@pytest.mark.slow
def test_fold_isolation(cold_base: OofPredictions) -> None:
    """Perturbing ALL the held-out cluster's truth by +-20 leaves its out-of-fold predictions identical to the bit.

    The ``cold`` set has no history, so the corrector reads no truth of the held-out cluster at all: its fold
    statistics, boosters, offsets and copulas were fitted on the other clusters. The static baselines (B0d, B2d, B4)
    too. B3d reads the cluster's own earlier truth (``bias7``), so it MUST move: that proves the perturbation reached
    the fold.
    """
    pairs = dev_pairs()
    perturbed = _shift_truth(pairs, pl.col("cluster") == HELD_OUT)
    assert not perturbed.equals(pairs)
    run = evaluate_dev(perturbed, _cfg(FeatureSet.COLD), cfg_sha256=CFG_SHA256, clusters=(HELD_OUT,))
    _assert_same_rows(cold_base, run, HELD_OUT)
    for target in Target:
        for model in cold_base.models(target):
            before, after = _grid(cold_base, HELD_OUT, target, model), _grid(run, HELD_OUT, target, model)
            if model == "b3d":
                assert not np.allclose(before, after, atol=1e-6), "B3d did not see the perturbed history: vacuous test"
            elif model == "corrector":
                np.testing.assert_array_equal(before, after, err_msg=f"{target.value} corrector saw the held-out truth")
            else:  # the baselines' polars aggregations differ in the last bit between two identical runs
                np.testing.assert_allclose(
                    before, after, rtol=0.0, atol=1e-9, err_msg=f"{target.value}/{model} saw the held-out truth"
                )
    # the truth did move (a vacuous test would pass with y_* unchanged)
    assert not np.allclose(
        np.nan_to_num(cold_base.keys["y_t"].to_numpy()), np.nan_to_num(run.keys["y_t"].to_numpy()), atol=1.0
    )
    # the base rates and the offsets of the fold are fitted on the training clusters: unchanged
    assert cold_base.base_rates.equals(run.base_rates)


@pytest.mark.slow
def test_fold_isolation_with_site_history_respects_the_issue_day(dev: tuple[pl.DataFrame, OofPredictions]) -> None:
    """The ``site`` corrector may read the held-out cluster's EARLIER truth, never truth from the issue day on (L3).

    Truth is shifted only on 25-27 May of each summer. A row issued on D - L can read dates up to D - L - 1, so rows
    with D - L <= 25 May must not move at all, while rows whose 7-day window holds those dates (D - L from 26 May to
    3 June) must move: the history path is real.
    """
    pairs, base = dev
    window = pl.col("valid_time").dt.date().is_in([date(year, 5, day) for year in (2024, 2025) for day in (25, 26, 27)])
    perturbed = _shift_truth(pairs, (pl.col("cluster") == HELD_OUT) & window, alternate=False)
    run = evaluate_dev(perturbed, _cfg(), cfg_sha256=CFG_SHA256, clusters=(HELD_OUT,))
    _assert_same_rows(base, run, HELD_OUT)
    keys = run.keys.with_columns(
        (pl.col("valid_date") - pl.duration(days=pl.col("lead_days").cast(pl.Int32))).alias("issue_day")
    )
    issue_month_day = keys.select(
        (pl.col("issue_day").dt.month().cast(pl.Int32) * 100 + pl.col("issue_day").dt.day().cast(pl.Int32)).alias("md")
    )["md"].to_numpy()
    same_summer_window = (
        keys["issue_day"].dt.month().to_numpy() <= 6
    )  # May-June issue days; September has no window dates
    unaffected = same_summer_window & (issue_month_day <= 525)
    affected = same_summer_window & (issue_month_day >= 526) & (issue_month_day <= 603)
    assert unaffected.sum() > 100
    assert affected.sum() > 100
    for target in (Target.T, Target.TD, Target.WIND):
        before, after = _grid(base, HELD_OUT, target, "corrector"), _grid(run, HELD_OUT, target, "corrector")
        np.testing.assert_array_equal(before[unaffected], after[unaffected], err_msg=f"{target.value} read the future")
        b3_before, b3_after = _grid(base, HELD_OUT, target, "b3d"), _grid(run, HELD_OUT, target, "b3d")
        np.testing.assert_allclose(b3_before[unaffected], b3_after[unaffected], rtol=0.0, atol=1e-9)
        assert (np.abs(b3_before[affected] - b3_after[affected]) > 1e-6).any(
            axis=1
        ).mean() > 0.9  # bias7 carries the earlier truth
    moved = (
        _grid(base, HELD_OUT, Target.T, "corrector")[affected] != _grid(run, HELD_OUT, Target.T, "corrector")[affected]
    )
    assert moved.any(axis=1).mean() > 0.5, "the corrector ignores bias7: the history path is not exercised"


@pytest.mark.slow
def test_summer_split_trains_on_one_summer_and_tests_on_the_other() -> None:
    pairs = dev_pairs()
    cfg = _cfg(FeatureSet.COLD)
    base = evaluate_summer_split(pairs, cfg, cfg_sha256=CFG_SHA256)
    assert set(base.keys["fold"].unique()) == {"train2024_test2025", "train2025_test2024"}
    for fold, summer in (("train2024_test2025", 2025), ("train2025_test2024", 2024)):
        part = base.keys.filter(pl.col("fold") == fold)
        assert part["summer"].unique().to_list() == [summer]
        assert set(part["cluster"].unique()) == set(CLUSTERS)  # all clusters are tested
    # the 2025 truth never reaches the model that predicts 2025 (trained on 2024): perturb it, nothing moves
    perturbed = _shift_truth(pairs, pl.col("summer") == 2025)
    run = evaluate_summer_split(perturbed, cfg, cfg_sha256=CFG_SHA256)
    mask = (base.keys["fold"] == "train2024_test2025").to_numpy()
    for target in Target:
        for model in base.models(target):
            if model == "b3d":
                continue  # reads the test summer's own earlier truth (L3) through bias7
            np.testing.assert_allclose(
                base.grids[(target, model)][mask],
                run.grids[(target, model)][mask],
                rtol=0.0,
                atol=0.0
                if model == "corrector"
                else 1e-9,  # polars aggregations in the baselines differ in the last bit
                err_msg=f"{target.value}/{model}",
            )
    # every station is in the training rows, so the baselines use the PER-STATION bias (pooled=False): B2d removes the
    # +3 of a biased station and leaves an unbiased one alone, where B0d (dressed with the pooled error quantiles, so
    # about -1.8 on the three biased stations of five) is off by about +1.0 at OMAA and -1.8 at OMAL
    observed = truth(base, Target.T)
    for station in ("OMAA", "OMAL"):
        rows = (base.keys["station"] == station).to_numpy() & np.isfinite(observed)
        bias = {
            model: float((base.grids[(Target.T, model)][rows, MEDIAN] - observed[rows]).mean())
            for model in ("b0d", "b2d")
        }
        assert abs(bias["b2d"]) < 0.3, (station, bias)
        assert abs(bias["b0d"]) > 0.8, (station, bias)  # B2d differs from B0d here: B2d is not a strawman
    other = ~mask  # that fold trains on the perturbed 2025: it must move
    assert not np.array_equal(base.grids[(Target.T, "corrector")][other], run.grids[(Target.T, "corrector")][other])
    with pytest.raises(ValueError, match="exactly the dev summers"):
        evaluate_summer_split(pairs.filter(pl.col("summer") == 2024), cfg, cfg_sha256=CFG_SHA256)


class _StopAfterFitError(Exception):
    """Raised by the spy once it has seen the first ``fit_baselines`` call: the rest of the run is not needed."""


@pytest.mark.slow
@pytest.mark.parametrize(
    ("run", "pooled"),
    [
        pytest.param(
            lambda: evaluate_dev(dev_pairs(), _cfg(FeatureSet.COLD), cfg_sha256=CFG_SHA256, clusters=(HELD_OUT,)),
            True,
            id="loco-held-out-cluster",
        ),
        pytest.param(
            lambda: evaluate_summer_split(dev_pairs(), _cfg(FeatureSet.COLD), cfg_sha256=CFG_SHA256),
            False,
            id="summer-split-every-station-in-training",
        ),
    ],
)
def test_the_baseline_bias_is_pooled_only_when_the_test_cluster_is_held_out(
    monkeypatch: pytest.MonkeyPatch, run: Callable[[], OofPredictions], pooled: bool
) -> None:
    """Pre-registration section 5: pooled bias for HELD-OUT clusters only; the summer split keeps each station's own."""
    seen: list[object] = []

    def spy(train: pl.DataFrame, **kwargs: object) -> object:
        seen.append(kwargs["pooled"])
        raise _StopAfterFitError

    monkeypatch.setattr(evaluate_module, "fit_baselines", spy)
    with pytest.raises(_StopAfterFitError):
        run()
    assert seen == [pooled]


# === the corrector is not the raw forecast (review focus 5) =========================================================


@pytest.mark.slow
def test_the_corrector_beats_raw_ifs_on_the_biased_held_out_clusters_by_a_clear_margin(
    dev: tuple[pl.DataFrame, OofPredictions],
) -> None:
    _, oof = dev
    table = skill_table(oof, leads=(1, 2, 3), hours="all", by=["cluster"], n_boot=300).filter(pl.col("target") == "t")
    for row in table.filter(pl.col("cluster").is_in(["abu_dhabi", "dubai_sharjah"])).iter_rows(named=True):
        assert row["crps_corrector"] < 0.5 * row["crps_b0"], row  # B0's CRPS is its MAE, about 3
        assert row["mae_corrector"] < 0.5 * row["mae_b0"], row
        assert row["crps_diff_b0_hi"] < -1.0  # the paired interval is far below zero
        assert abs(row["bias_corrector"]) < 0.5 < abs(row["bias_b0"])
    # the PIT of the truth under the dressed raw forecast piles up low (3 degrees warm); the corrector's does not
    rows = _cluster_rows(oof, "abu_dhabi") & np.isfinite(oof.keys["y_t"].to_numpy())
    observed = truth(oof, Target.T)[rows]
    mean_pit = {
        model: float(metrics.pit(observed, oof.grids[(Target.T, model)][rows]).mean()) for model in ("corrector", "b0d")
    }
    assert abs(mean_pit["corrector"] - 0.5) < 0.1
    assert mean_pit["b0d"] < 0.35
    assert abs(mean_pit["corrector"] - 0.5) < 0.5 * abs(mean_pit["b0d"] - 0.5)


# === the baselines never see the held-out cluster ===================================================================


@pytest.mark.slow
def test_baselines_are_fitted_on_the_training_clusters_only(
    dev: tuple[pl.DataFrame, OofPredictions], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every frame ``fit_baselines`` receives holds no row of the held-out cluster, only fit and calibration rows."""
    pairs, _ = dev
    seen: list[pl.DataFrame] = []
    real = baselines.fit_baselines

    def spy(train: pl.DataFrame, **kwargs: object) -> object:
        seen.append(train)
        return real(train, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(evaluate_module, "fit_baselines", spy)
    evaluate_dev(pairs, _cfg(), cfg_sha256=CFG_SHA256, clusters=(HELD_OUT,))
    assert len(seen) == len(Target)  # one fit per target
    for frame in seen:
        assert HELD_OUT not in set(frame["cluster"].unique())
        assert set(frame["station"].unique()) == {"OMDB", "OMSJ", "OMAL", "OMFJ"}
        assert set(frame["hour_utc"].unique()) == set(HOURS)
    training_rows = pairs.filter((pl.col("model") == IFS) & (pl.col("cluster") != HELD_OUT)).height
    assert seen[0].height == training_rows  # the fixture days are all fit or calibration days


# === the skill table ================================================================================================


def _expected_counts(pairs: pl.DataFrame, *, lead: int, hours: tuple[int, ...]) -> dict[str, int]:
    rows = pairs.filter(
        (pl.col("model") == IFS) & (pl.col("lead_days") == lead) & pl.col("hour_utc").is_in(list(hours))
    )
    scored_t = rows.filter(pl.col("has_joint_obs"))
    scored_wbgt = rows.filter(
        (pl.col("wbgt_obs_reject") == 0)
        & pl.col("wbgt_obs_c").is_finite()
        & (pl.col("wbgt_fc_reject") == 0)
        & pl.col("wbgt_fc_c").is_finite()
    )
    return {
        "rows": rows.height,
        "t": scored_t.height,
        "t_days": scored_t["valid_time"].dt.date().n_unique(),
        "wbgt": scored_wbgt.height,
        "wbgt_days": scored_wbgt["valid_time"].dt.date().n_unique(),
    }


@pytest.mark.slow
def test_skill_table_reports_counts_and_excludes_unscored_rows(dev: tuple[pl.DataFrame, OofPredictions]) -> None:
    pairs, oof = dev
    for hours, hour_set in (
        ("all", HOURS),
        ("working", (7, 8, 13)),
        ("early", (3,)),
        ("peak", (7, 8)),
        ("late", (13,)),
    ):
        table = skill_table(oof, leads=(1,), hours=hours, by=[], n_boot=50, intervals=False)
        expected = _expected_counts(pairs, lead=1, hours=hour_set)
        t = table.filter(pl.col("target") == "t").row(0, named=True)
        assert t["n_rows"] == expected["t"], hours
        assert t["n_days"] == expected["t_days"], hours
        assert t["n_no_truth"] == expected["rows"] - expected["t"], hours
        assert t["n_no_forecast"] == 0
        w = table.filter(pl.col("target") == "wbgt").row(0, named=True)
        assert w["n_rows"] + w["n_no_forecast"] == expected["wbgt"], hours  # a thin joint grid is a missing forecast
        assert w["n_no_truth"] == expected["rows"] - expected["wbgt"], hours
        assert w["n_days"] <= expected["wbgt_days"]
        assert expected["t"] < expected["rows"]  # the fixture does drop rows
        assert expected["wbgt"] < expected["t"]
    # by lead and cluster: the group counts add up to the pooled count
    by_lead = skill_table(oof, leads=(1, 2, 3), hours="all", by=["lead_days", "cluster"], n_boot=50, intervals=False)
    pooled = skill_table(oof, leads=(1, 2, 3), hours="all", by=[], n_boot=50, intervals=False)
    for target in ("t", "td", "wind", "wbgt"):
        assert (
            by_lead.filter(pl.col("target") == target)["n_rows"].sum()
            == pooled.filter(pl.col("target") == target)["n_rows"].item()
        )
    assert by_lead.filter(pl.col("target") == "t").height == 3 * 4


@pytest.mark.slow
def test_skill_table_excludes_rows_without_a_forecast_and_counts_them(dev: tuple[pl.DataFrame, OofPredictions]) -> None:
    _, oof = dev
    baseline = skill_table(oof, leads=(1,), hours="all", by=[], n_boot=50, intervals=False).filter(
        pl.col("target") == "t"
    )
    grids = {key: grid.copy() for key, grid in oof.grids.items()}
    scored = np.isfinite(oof.keys["y_t"].to_numpy()) & (oof.keys["lead_days"].to_numpy() == 1)
    hit = np.flatnonzero(scored)[:25]
    grids[(Target.T, "b4")][hit] = np.nan  # one baseline has no forecast for 25 scored rows
    hurt = skill_table(
        dataclasses.replace(oof, grids=grids), leads=(1,), hours="all", by=[], n_boot=50, intervals=False
    ).filter(pl.col("target") == "t")
    assert hurt["n_no_forecast"].item() == 25
    assert hurt["n_rows"].item() == baseline["n_rows"].item() - 25  # every model is scored on the same rows
    assert hurt["n_no_truth"].item() == baseline["n_no_truth"].item()


@pytest.mark.slow
def test_a_group_with_no_scored_row_appears_with_zero_rows(dev: tuple[pl.DataFrame, OofPredictions]) -> None:
    _, oof = dev
    keys = oof.keys.with_columns(pl.when(pl.col("station") == "OMAL").then(None).otherwise(pl.col("y_t")).alias("y_t"))
    table = skill_table(
        dataclasses.replace(oof, keys=keys), leads=(1,), hours="all", by=["station"], n_boot=50, intervals=False
    ).filter(pl.col("target") == "t")
    omal = table.filter(pl.col("station") == "OMAL").row(0, named=True)
    assert omal["n_rows"] == 0
    assert omal["n_no_truth"] > 0
    assert omal["crps_corrector"] is None
    assert table.filter(pl.col("station") == "OMAA")["n_rows"].item() > 0


@pytest.mark.slow
def test_skill_table_scores_match_an_independent_computation(dev: tuple[pl.DataFrame, OofPredictions]) -> None:
    _, oof = dev
    table = skill_table(oof, leads=(2,), hours="peak", by=["lead_days", "hour_block"], n_boot=50, intervals=False)
    assert table["hour_block"].unique().to_list() == ["peak"]
    row = table.filter(pl.col("target") == "td").row(0, named=True)
    sel = (oof.keys["lead_days"] == 2).to_numpy() & (oof.keys["hour_block"] == "peak").to_numpy()
    sel &= np.isfinite(oof.keys["y_td"].to_numpy())
    for model in ("corrector", "b0", "b0d"):
        sel &= np.isfinite(oof.grids[(Target.TD, model)]).reshape(len(sel), -1).all(axis=1)
    y = truth(oof, Target.TD)[sel]
    grid = oof.grids[(Target.TD, "corrector")][sel]
    assert row["n_rows"] == int(sel.sum())
    assert row["crps_corrector"] == pytest.approx(float(metrics.crps_grid(y, grid).mean()))
    assert row["crps_b0"] == pytest.approx(float(np.abs(oof.grids[(Target.TD, "b0")][sel] - y).mean()))
    assert row["mae_corrector"] == pytest.approx(float(np.abs(grid[:, MEDIAN] - y).mean()))
    assert row["rmse_corrector"] == pytest.approx(float(np.sqrt(((grid[:, MEDIAN] - y) ** 2).mean())))
    assert row["bias_corrector"] == pytest.approx(float((grid[:, MEDIAN] - y).mean()))  # forecast minus truth
    assert row["bias_b0"] == pytest.approx(float((oof.grids[(Target.TD, "b0")][sel] - y).mean()))
    assert row["pinball_05"] == pytest.approx(float(metrics.pinball(y, grid, 0.05).mean()))
    assert row["pinball_50"] == pytest.approx(float(metrics.pinball(y, grid, 0.5).mean()))
    assert row["pinball_95"] == pytest.approx(float(metrics.pinball(y, grid, 0.95).mean()))
    assert row["is_90"] == pytest.approx(float(metrics.interval_score(y, grid[:, 0], grid[:, 18], 0.1).mean()))
    assert row["is_80"] == pytest.approx(float(metrics.interval_score(y, grid[:, 1], grid[:, 17], 0.2).mean()))
    for name, (lo, hi) in {"90": (0, 18), "80": (1, 17), "50": (4, 14)}.items():
        assert row[f"cov_{name}"] == pytest.approx(float(metrics.covered(y, grid[:, lo], grid[:, hi]).mean()))
    counts = np.array([row[f"pit_{i:02d}"] for i in range(10)])
    np.testing.assert_array_equal(counts, metrics.pit_histogram(metrics.pit(y, grid), 10))
    assert counts.sum() == row["n_rows"]


@pytest.mark.slow
def test_paired_bootstrap_intervals_are_the_preregistered_ones(dev: tuple[pl.DataFrame, OofPredictions]) -> None:
    """Seed 20261112, 7-day blocks, dense per-summer days with weight 0 on unscored days, B = 2000."""
    _, oof = dev
    table = skill_table(oof, leads=(1,), hours="working", by=[], n_boot=2000)
    row = table.filter(pl.col("target") == "t").row(0, named=True)
    sel = (oof.keys["lead_days"] == 1).to_numpy() & oof.keys["hour_utc"].is_in([7, 8, 13]).to_numpy()
    sel &= np.isfinite(oof.keys["y_t"].to_numpy())
    y = truth(oof, Target.T)[sel]
    crps_c = metrics.crps_grid(y, oof.grids[(Target.T, "corrector")][sel])
    crps_b = np.abs(oof.grids[(Target.T, "b0")][sel] - y)
    scored = (
        oof.keys.filter(pl.Series(sel))
        .select("summer", "valid_date")
        .with_columns(pl.Series("c", crps_c), pl.Series("b", crps_b))
    )
    days = pl.concat(
        [
            pl.DataFrame({"season": [int(s)] * len(d), "day": d})
            for s in (2024, 2025)
            for d in [pl.date_range(date(s, 5, 15), date(s, 9, 30), "1d", eager=True)]
        ]
    )
    daily = days.join(
        scored.group_by(pl.col("summer").cast(pl.Int64).alias("season"), pl.col("valid_date").alias("day")).agg(
            pl.col("c").sum().alias("c"), pl.col("b").sum().alias("b"), pl.len().cast(pl.Float64).alias("weight")
        ),
        on=["season", "day"],
        how="left",
    ).with_columns(pl.col("c", "b", "weight").fill_null(0.0))
    expected = paired_block_bootstrap(
        daily.select("season", "day", pl.col("c").alias("value"), "weight"),
        daily.select("season", "day", pl.col("b").alias("value"), "weight"),
        value="value",
        weight="weight",
        n_boot=2000,
        seed=20261112,
    )
    assert row["crps_diff_b0"] == pytest.approx(expected.estimate)
    assert row["crps_diff_b0_lo"] == pytest.approx(expected.lo)
    assert row["crps_diff_b0_hi"] == pytest.approx(expected.hi)
    assert row["crps_diff_b0"] == pytest.approx(float(crps_c.mean() - crps_b.mean()))
    assert row["crps_diff_b0_lo"] < row["crps_diff_b0"] < row["crps_diff_b0_hi"]


@pytest.mark.slow
def test_brier_scores_and_skill_use_training_base_rates(dev: tuple[pl.DataFrame, OofPredictions]) -> None:
    pairs, oof = dev
    # the base rate of a fold is the share of its TRAINING rows (the other clusters) at or above the threshold
    rates = oof.base_rates.filter((pl.col("fold") == "loco_abu_dhabi") & (pl.col("threshold_c") == 30.0))
    training = pairs.filter(
        (pl.col("model") == IFS)
        & (pl.col("cluster") != HELD_OUT)
        & (pl.col("wbgt_obs_reject") == 0)
        & pl.col("wbgt_obs_c").is_finite()
        & (pl.col("wbgt_fc_reject") == 0)
        & pl.col("wbgt_fc_c").is_finite()
    ).with_columns(
        pl.when(pl.col("hour_utc") < 6)
        .then(pl.lit("early"))
        .when(pl.col("hour_utc") < 11)
        .then(pl.lit("peak"))
        .otherwise(pl.lit("late"))
        .alias("hour_block")
    )
    expected = training.group_by("hour_block").agg(
        (pl.col("wbgt_obs_c") >= 30.0).mean().alias("rate"), pl.len().alias("n")
    )
    joined = rates.join(expected, on="hour_block", suffix="_expected")
    assert joined.height == 3
    np.testing.assert_allclose(joined["rate"].to_numpy(), joined["rate_expected"].to_numpy())
    assert (joined["n"] == joined["n_expected"]).all()
    assert (
        joined["rate"].n_unique() == 3
    )  # the three blocks differ (the early block almost never, the peak almost always)

    table = skill_table(oof, leads=(1,), hours="all", by=["fold"], n_boot=50, intervals=False)
    row = table.filter((pl.col("target") == "wbgt") & (pl.col("fold") == "loco_abu_dhabi")).row(0, named=True)
    sel = (
        (oof.keys["fold"] == "loco_abu_dhabi").to_numpy()
        & (oof.keys["lead_days"] == 1).to_numpy()
        & np.isfinite(oof.keys["y_wbgt"].to_numpy())
    )
    for model in ("corrector", "b0", "b0d", "b2d", "b4"):
        sel &= np.isfinite(oof.grids[(Target.WBGT, model)]).reshape(len(sel), -1).all(axis=1)
    y = truth(oof, Target.WBGT)[sel]
    block = oof.keys["hour_block"].to_numpy()[sel]
    for threshold in BRIER_THRESHOLDS_C:
        tag = f"{threshold:.0f}"
        event = y >= threshold
        by_block = {
            r["hour_block"]: r["rate"]
            for r in oof.base_rates.filter(
                (pl.col("fold") == "loco_abu_dhabi") & (pl.col("threshold_c") == threshold)
            ).iter_rows(named=True)
        }
        reference = np.array([by_block[b] for b in block])
        bs_clim = float(((reference - event) ** 2).mean())
        bs_c = float(
            ((exceedance_probability(oof.grids[(Target.WBGT, "corrector")][sel], threshold) - event) ** 2).mean()
        )
        bs_b2d = float(((exceedance_probability(oof.grids[(Target.WBGT, "b2d")][sel], threshold) - event) ** 2).mean())
        assert row[f"events_{tag}"] == pytest.approx(float(event.sum()))
        assert row[f"brier_clim_{tag}"] == pytest.approx(bs_clim)
        assert row[f"brier_c_{tag}"] == pytest.approx(bs_c)
        assert row[f"brier_b2d_{tag}"] == pytest.approx(bs_b2d)
        assert row[f"bss_c_clim_{tag}"] == pytest.approx(1.0 - bs_c / bs_clim)
        assert row[f"bss_c_b2d_{tag}"] == pytest.approx(1.0 - bs_c / bs_b2d)
        assert row[f"bss_b2d_clim_{tag}"] == pytest.approx(1.0 - bs_b2d / bs_clim)
    # Brier columns exist for WBGT only
    t = table.filter((pl.col("target") == "t") & (pl.col("fold") == "loco_abu_dhabi")).row(0, named=True)
    assert t["brier_c_30"] is None
    assert t["bss_c_clim_30"] is None


@pytest.mark.slow
def test_the_table_refuses_unknown_arguments(dev: tuple[pl.DataFrame, OofPredictions]) -> None:
    _, oof = dev
    with pytest.raises(ValueError, match="hours"):
        skill_table(oof, leads=(1,), hours="noon", by=[])
    with pytest.raises(ValueError, match="cannot group by"):
        skill_table(oof, leads=(1,), hours="all", by=["summer"])
    with pytest.raises(ValueError, match="at least one lead"):
        skill_table(oof, leads=(), hours="all", by=[])


# === coverage by forecast tercile ===================================================================================


@pytest.mark.slow
def test_coverage_by_forecast_tercile(dev: tuple[pl.DataFrame, OofPredictions]) -> None:
    pairs, oof = dev
    # the edges are terciles of the forecast WBGT over the dev rows (no truth in them), fixed by the harness
    forecast = pairs.filter(
        (pl.col("model") == IFS) & (pl.col("wbgt_fc_reject") == 0) & pl.col("wbgt_fc_c").is_finite()
    )["wbgt_fc_c"].to_numpy()
    low, high = np.quantile(forecast, [1 / 3, 2 / 3])
    assert oof.tercile_edges == pytest.approx((float(low), float(high)))
    table = coverage_by_forecast_tercile(oof, leads=(1, 2, 3))
    assert set(table["tercile"].unique()) == {"low", "mid", "high"}
    assert set(table["lead_days"].unique()) == {1, 2, 3}
    assert (table["edge_low"] == oof.tercile_edges[0]).all()
    row = table.filter((pl.col("target") == "wbgt") & (pl.col("lead_days") == 1) & (pl.col("tercile") == "high")).row(
        0, named=True
    )
    keys = oof.keys
    grid = oof.grids[(Target.WBGT, "corrector")]
    fc = keys["wbgt_fc_c"].to_numpy()
    sel = (keys["lead_days"] == 1).to_numpy() & np.isfinite(keys["y_wbgt"].to_numpy()) & np.isfinite(fc)
    sel &= np.isfinite(grid).all(axis=1) & (fc >= high)
    y = truth(oof, Target.WBGT)[sel]
    inside = (grid[sel, 0] <= y) & (y <= grid[sel, 18])
    assert row["n"] == int(sel.sum())
    assert row["covered"] == int(inside.sum())
    assert row["coverage"] == pytest.approx(float(inside.mean()))
    # the terciles split the rows roughly in thirds (a wrong edge would not)
    per_tercile = table.filter((pl.col("target") == "wbgt") & (pl.col("lead_days") == 1))["n"].to_list()
    assert max(per_tercile) < 1.6 * min(per_tercile)


@pytest.mark.slow
def test_the_tercile_edges_come_from_all_dev_rows_forecast_values_only_not_the_scored_rows(
    dev: tuple[pl.DataFrame, OofPredictions],
) -> None:
    """The edges are the quantiles of ``wbgt_fc_c`` over ALL dev rows (forecast values only, no truth, no fold split).

    Perturbing the scored rows' forecast WBGT moves the terciles' membership, never the edges, which are read from the
    OOF object; heating one cluster's forecasts in the input does move them.
    """
    _, oof = dev
    before = coverage_by_forecast_tercile(oof, leads=(1,))
    shifted = oof.keys.with_columns((pl.col("wbgt_fc_c") + 5.0).alias("wbgt_fc_c"))
    after = coverage_by_forecast_tercile(dataclasses.replace(oof, keys=shifted), leads=(1,))
    assert (before["edge_low"] == after["edge_low"]).all()
    assert (before["edge_high"] == after["edge_high"]).all()
    assert not before.select("n").equals(after.select("n"))  # the membership did move (the test can fail)
    # and the harness fixes the edges from the forecasts of the data it was given
    pairs, _ = dev
    heated = pairs.with_columns(
        pl.when(pl.col("cluster") == HELD_OUT)
        .then(pl.col("wbgt_fc_c") + 5.0)
        .otherwise(pl.col("wbgt_fc_c"))
        .alias("wbgt_fc_c")
    )
    run = evaluate_dev(heated, _cfg(), cfg_sha256=CFG_SHA256, clusters=(HELD_OUT,))
    assert run.tercile_edges[1] > oof.tercile_edges[1]


def _cold_features_and_raw(n: int) -> pl.DataFrame:
    """``n`` complete test-feature rows: every cold feature, every raw forecast and every ``bias7`` present."""
    cold = {name: [1.0] * n for name in feature_columns(FeatureSet.COLD)}
    raw = {f"raw_{target.value}": [20.0] * n for target in Target}
    bias7 = {f"bias7_{target.value}": [0.5] * n for target in (Target.T, Target.TD, Target.WIND)}
    return pl.DataFrame(cold | raw | bias7)


def test_fallback_rows_count_the_null_bias7_and_the_null_cold_feature_rows() -> None:
    """One null ``bias7_t`` (row 0), one null cold feature (row 1) and one row without a raw t (row 2, uncounted)."""
    cold_name = feature_columns(FeatureSet.COLD)[0]
    frame = _cold_features_and_raw(5).with_columns(
        pl.Series("bias7_t", [None, 0.5, None, 0.5, 0.5], dtype=pl.Float64),  # rows 0 and 2 have no history
        pl.Series("raw_t", [20.0, 20.0, None, 20.0, 20.0], dtype=pl.Float64),
        pl.Series(cold_name, [1.0, None, 1.0, 1.0, 1.0], dtype=pl.Float64),
    )

    counts = {
        (row["target"], row["model"]): (row["n_rows"], row["n_fallback"])
        for row in evaluate_module._fallback_rows("fold_x", frame).iter_rows(named=True)  # noqa: SLF001
    }

    assert counts == {
        ("t", "b3d"): (4, 1),  # rows with a raw t: 0, 1, 3, 4; only row 0 lacks bias7 (row 2 has no raw)
        ("t", "b4"): (4, 1),  # only row 1 lacks a cold feature
        ("td", "b3d"): (5, 0),  # the null bias7_t is not td's
        ("td", "b4"): (5, 1),
        ("wind", "b3d"): (5, 0),
        ("wind", "b4"): (5, 1),
        ("wbgt", "b4"): (5, 1),  # B3d is not defined for WBGT: no row
    }


@pytest.mark.slow
def test_the_oof_fallbacks_are_counted_per_fold_from_the_rows_it_scored(
    dev: tuple[pl.DataFrame, OofPredictions],
) -> None:
    _, oof = dev
    fallbacks = oof.fallbacks
    assert set(fallbacks["fold"].unique()) == {f"loco_{cluster}" for cluster in CLUSTERS}
    assert set(fallbacks["model"].unique()) == {"b3d", "b4"}
    assert (fallbacks["n_fallback"] >= 0).all()
    assert (fallbacks["n_fallback"] <= fallbacks["n_rows"]).all()
    for target in Target:  # n_rows is the fold's rows that have a raw forecast of the target
        expected = oof.keys.filter(pl.col(f"raw_{target.value}").is_not_null()).group_by("fold").len()
        got = fallbacks.filter(pl.col("target") == target.value).group_by("fold").agg(pl.col("n_rows").first())
        assert dict(got.iter_rows()) == dict(expected.iter_rows()), target.value


# === the six-fold run ===============================================================================================


@pytest.mark.slow
def test_a_full_six_fold_loco_run_on_all_eight_stations() -> None:
    pairs = make_pairs(
        seed=11,
        summers=(2024, 2025),
        station_bias_c=dict.fromkeys(("OMAA", "OMAD", "OMDB", "OMSJ"), 3.0),
        leads=range(4),
        hours_utc=HOURS,
        summer_days=(*range(1, 21), *range(114, 140)),
    ).filter(pl.col("lead_days") > 0)
    oof = evaluate_dev(pairs, _cfg(), cfg_sha256=CFG_SHA256)
    assert oof.keys["fold"].n_unique() == 6
    assert oof.keys["cluster"].n_unique() == 6
    assert oof.keys.height == pairs.filter(pl.col("model") == IFS).height
    by_fold = oof.keys.group_by("fold").agg(pl.col("station").unique().sort().alias("stations"))
    stations = dict(by_fold.iter_rows())
    assert stations["loco_dubai_sharjah"] == ["OMDB", "OMSJ"]
    assert stations["loco_abu_dhabi"] == ["OMAA", "OMAD"]
    table = skill_table(oof, leads=(1, 2, 3), hours="working", by=["cluster"], n_boot=100)
    assert table.height == 4 * 6
    assert (table["n_rows"] > 0).all()
