"""The gated 2026 forecast row (``ml/forecast_test.py``) on a SYNTHETIC "2026": regimes (a) and (c), the tables.

Nothing here reads the gold file. The synthetic third summer of ``make_pairs`` stands in for 2026 (lead 0 removed, as
``load_test_pairs`` does), the released model is a tiny corrector trained on the synthetic 2024-2025 rows and
written with ``write_model``, and the gate token is minted by ``open_gate`` against a fake git and a temporary
lock, go marker and models directory (``tests/fixtures/forecast/gated.py``).
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import numpy as np
import polars as pl
import pytest
from pydantic import JsonValue

from stellar_blaze.domain.forecast.features import FeatureSet, Target, build_features, history_features
from stellar_blaze.domain.forecast.grid import LEVELS
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.ml.evaluate import BRIER_THRESHOLDS_C
from stellar_blaze.ml.forecast_test import B_ALL_NOT_RUN, ForecastTestResult, evaluate_forecast_test
from stellar_blaze.ml.metrics import PREREGISTERED_RELIABILITY_EDGES
from stellar_blaze.ml.predict import corrected_grids
from stellar_blaze.ml.protocol_gate import GateToken, Part
from stellar_blaze.ml.serving_path import cold_config, correct_with_released_model, released_training_config
from tests.fixtures.forecast.dev_run import CLUSTERS
from tests.fixtures.forecast.gated import DEV_EDGES, GatedWorld, released, synthetic_test_pairs, with_aifs

pytestmark = pytest.mark.unit

N_BOOT = 20
_IFS = NwpModel.ECMWF_IFS025.value
_AIFS = NwpModel.ECMWF_AIFS025.value
_GFS = NwpModel.GFS_SEAMLESS.value


@dataclass(frozen=True)
class Evaluated:
    world: GatedWorld
    pairs: pl.DataFrame
    token: GateToken
    result: ForecastTestResult


def dig(value: JsonValue) -> Any:
    """A JSON document to navigate by index (the assertions say what is expected at each step)."""
    return value


def table_rows(table: JsonValue) -> list[dict[str, Any]]:
    """The rows of a ``{"columns": [...], "rows": [[...]]}`` payload as dicts."""
    document = dig(table)
    return [dict(zip(document["columns"], row, strict=True)) for row in document["rows"]]


def regimes(result: ForecastTestResult) -> Mapping[str, Any]:
    value = result.skill["regimes"]
    assert isinstance(value, dict)
    return value


def regime(result: ForecastTestResult, name: str) -> Mapping[str, Any]:
    value = regimes(result)[name]
    assert isinstance(value, dict)
    return value


def mint(tmp_path: Path, *, part: Part = Part.FORECAST) -> tuple[GatedWorld, GateToken]:
    world = GatedWorld(tmp_path, released().model.manifest.model_id, released().models_dir)
    return world, world.token(part)


def run(
    pairs: pl.DataFrame,
    token: GateToken,
    *,
    edges: tuple[float, float] = DEV_EDGES,
    clusters: tuple[str, ...] = CLUSTERS,
    cold_cfg: Any = None,
) -> ForecastTestResult:
    model = released().model
    cold = cold_config(released_training_config(model)[0]) if cold_cfg is None else cold_cfg
    return evaluate_forecast_test(
        pairs, model=model, cold_cfg=cold, token=token, dev_tercile_edges=edges, clusters=clusters, n_boot=N_BOOT
    )


@pytest.fixture(scope="module")
def evaluated(tmp_path_factory: pytest.TempPathFactory) -> Evaluated:
    world, token = mint(tmp_path_factory.mktemp("world"))
    pairs = with_aifs(synthetic_test_pairs())
    return Evaluated(world, pairs, token, run(pairs, token))


# === the 7.1 content ================================================================================================

_MODELS = ("corrector", "b0", "b0d", "b2d", "b3d", "b4")
_BASELINES = ("b0", "b0d", "b2d", "b3d", "b4")
_REQUIRED_COLUMNS = {
    "target",
    "lead_days",
    "hour_block",
    "n_rows",
    "n_days",
    "n_no_truth",
    "n_no_forecast",
    *(f"{metric}_{model}" for model in _MODELS for metric in ("crps", "mae", "rmse", "bias")),
    *("pinball_05", "pinball_50", "pinball_95", "is_90", "is_80", "cov_90", "cov_80", "cov_50"),
    *(f"pit_{i:02d}" for i in range(10)),
    *(f"events_{t:.0f}" for t in BRIER_THRESHOLDS_C),
    *(f"brier_{name}_{t:.0f}" for t in BRIER_THRESHOLDS_C for name in ("c", "b2d", "clim")),
    *(f"bss_{pair}_{t:.0f}" for t in BRIER_THRESHOLDS_C for pair in ("c_clim", "c_b2d", "b2d_clim")),
    *(f"crps_diff_{b}{suffix}" for b in _BASELINES for suffix in ("", "_lo", "_hi")),
}


@pytest.mark.slow
@pytest.mark.parametrize("name", ["a", "c"])
def test_every_7_1_key_is_present_for_both_regimes(evaluated: Evaluated, name: str) -> None:
    payload = regime(evaluated.result, name)
    skill = table_rows(payload["skill"])
    assert set(skill[0]) >= _REQUIRED_COLUMNS
    cells = {(row["target"], row["lead_days"], row["hour_block"]) for row in skill}
    expected = {
        (t.value, lead, block) for t in Target for lead in (1, 2, 3) for block in ("early", "peak", "late", "working")
    }
    assert cells == expected  # the fixture holds leads 1-3; leads 5 and 7 simply have no rows
    for table in ("by_cluster", "by_station", "fallbacks"):
        assert payload[table]["rows"], table
    assert set(payload["coverage_by_forecast_tercile"]) == {"working", "all"}
    assert all(payload["coverage_by_forecast_tercile"][hours]["rows"] for hours in ("working", "all"))
    assert payload["tercile_edges"] == list(DEV_EDGES)
    assert "summer_split" not in payload  # the development-only diagnostic does not belong to the 2026 row


@pytest.mark.slow
@pytest.mark.parametrize("name", ["a", "c"])
def test_intervals_are_present_and_bracket_the_estimate(evaluated: Evaluated, name: str) -> None:
    skill = table_rows(regime(evaluated.result, name)["skill"])
    with_interval = [r for r in skill if r["n_rows"] and r["crps_diff_b2d_lo"] is not None]
    assert len(with_interval) > len(skill) // 2
    for row in with_interval:
        for baseline in _BASELINES:
            lo, hi, estimate = (
                row[f"crps_diff_{baseline}_lo"],
                row[f"crps_diff_{baseline}_hi"],
                row[f"crps_diff_{baseline}"],
            )
            if lo is not None:
                assert lo <= estimate + 1e-5
                assert hi >= estimate - 1e-5
                assert lo <= hi


@pytest.mark.slow
def test_scored_rows_and_unscored_rows_add_up_to_every_row_of_2026(evaluated: Evaluated) -> None:
    """Counts are reported with every number and nothing disappears: scored + no truth + no forecast = all rows."""
    test_ifs = evaluated.pairs.filter((pl.col("summer") == 2026) & (pl.col("model") == _IFS)).height
    assert test_ifs > 0
    for name in ("a", "c"):
        skill = table_rows(regime(evaluated.result, name)["skill"])
        for target in Target:
            parts = [
                r["n_rows"] + r["n_no_truth"] + r["n_no_forecast"]
                for r in skill
                if r["target"] == target.value and r["hour_block"] != "working"
            ]
            assert sum(parts) == test_ifs, (name, target)  # the three blocks and leads partition every IFS row
        counts = regime(evaluated.result, name)["counts"]
        assert sum(counts["rows_by_summer"].values()) == test_ifs
        assert set(counts["rows_by_summer"]) == {"2026"}
        assert (
            counts["test_rows"]
            == evaluated.pairs.filter((pl.col("summer") == 2026) & (pl.col("model") != _AIFS)).height
        )
    assert set(regime(evaluated.result, "c")["counts"]["rows_by_cluster"]) == set(CLUSTERS)
    assert regimes(evaluated.result)["b_all"] == B_ALL_NOT_RUN == "not run"


@pytest.mark.slow
def test_the_corrector_beats_raw_ifs_on_the_biased_stations_in_the_released_regime(evaluated: Evaluated) -> None:
    """The warm +3 degree stations: if the serving path returned raw numbers this could not hold."""
    by_station = table_rows(regime(evaluated.result, "a")["by_station"])
    warm = [r for r in by_station if r["target"] == "t" and r["station"] in ("OMAA", "OMDB") and r["lead_days"] == 1]
    assert warm
    for row in warm:
        assert row["mae_corrector"] < 0.6 * row["mae_b0"]


@pytest.mark.slow
def test_tercile_edges_are_the_stored_development_edges_everywhere(evaluated: Evaluated) -> None:
    assert evaluated.result.skill["tercile_edges"] == list(DEV_EDGES)
    assert evaluated.result.reliability["tercile_edges"] == list(DEV_EDGES)
    for name in ("a", "c"):
        for hours in ("working", "all"):
            table = table_rows(regime(evaluated.result, name)["coverage_by_forecast_tercile"][hours])
            assert table
            assert {row["edge_low"] for row in table} == {DEV_EDGES[0]}
            assert {row["edge_high"] for row in table} == {DEV_EDGES[1]}


@pytest.mark.slow
def test_perturbing_the_2026_wbgt_forecast_leaves_the_edges_unchanged(tmp_path: Path) -> None:
    """The 2026 forecasts must never define the edges: shift every 2026 forecast WBGT and the edges stay."""
    world, token = mint(tmp_path)
    pairs = synthetic_test_pairs()
    shifted = pairs.with_columns(
        pl.when(pl.col("summer") == 2026)
        .then(pl.col("wbgt_fc_c") + 8.0)
        .otherwise(pl.col("wbgt_fc_c"))
        .alias("wbgt_fc_c")
    )
    first = run(pairs, token, clusters=("fujairah",))
    second = run(shifted, world.token(), clusters=("fujairah",))
    assert first.skill["tercile_edges"] == second.skill["tercile_edges"] == list(DEV_EDGES)
    # the perturbation is real (the shifted forecasts fall in other terciles), so the equality above is not vacuous
    a_first = table_rows(regime(first, "a")["coverage_by_forecast_tercile"]["all"])
    a_second = table_rows(regime(second, "a")["coverage_by_forecast_tercile"]["all"])
    assert {r["edge_low"] for r in a_first} == {r["edge_low"] for r in a_second} == {DEV_EDGES[0]}
    assert [r["n"] for r in a_first] != [r["n"] for r in a_second]


# === the reliability data, the raw comparison and the series ==========================================


@pytest.mark.slow
def test_reliability_uses_the_preregistered_bins_and_marks_thin_bins_hollow(evaluated: Evaluated) -> None:
    for name in ("a", "c"):
        reliability = dig(evaluated.result.reliability)["regimes"][name]
        assert reliability["selection"]["edges"] == list(PREREGISTERED_RELIABILITY_EDGES)
        assert reliability["selection"]["lead_days"] == 1
        assert set(reliability["events"]) == {"30", "32"}
        for event in reliability["events"].values():
            for table in event["models"].values():
                rows = table_rows(table)
                assert len(rows) == len(PREREGISTERED_RELIABILITY_EDGES) - 1
                assert sum(row["n"] for row in rows) == event["n_rows"]
                for row in rows:
                    assert row["hollow"] == (row["n"] < 50)
        quoted = reliability["quoted_bin"]
        assert quoted["bin_lo"] == 0.65
        assert quoted["event_wbgt_ge_c"] == 32.0
        assert quoted["hollow"] is (quoted["n"] is None or quoted["n"] < 50)


@pytest.mark.slow
def test_the_raw_comparison_scores_the_three_models_on_the_same_rows(evaluated: Evaluated) -> None:
    table = table_rows(evaluated.result.skill["raw_comparison"])
    assert {row["model"] for row in table} == {_IFS, _AIFS, _GFS}
    assert {row["summer"] for row in table} == {2025, 2026}
    assert {row["lead_days"] for row in table} == {1, 2, 3}
    for row in table:
        assert row["n_rows"] <= row["n_rows_own"]
    t_rows = {(row["model"], row["summer"], row["lead_days"]): row for row in table if row["target"] == "t"}
    for summer in (2025, 2026):
        ifs, aifs = t_rows[(_IFS, summer, 1)], t_rows[(_AIFS, summer, 1)]
        assert ifs["n_rows"] == aifs["n_rows"] > 0
        assert aifs["bias"] - ifs["bias"] == pytest.approx(0.5, abs=1e-5)  # the synthetic AIFS is IFS + 0.5 degrees


@pytest.mark.slow
def test_the_omaa_series_has_the_corrected_grids_the_raw_forecast_and_the_truth(evaluated: Evaluated) -> None:
    series = evaluated.result.series
    omaa = evaluated.pairs.filter(
        (pl.col("summer") == 2026) & (pl.col("model") == _IFS) & (pl.col("station") == "OMAA")
    )
    assert series.height == omaa.height > 0
    assert set(series["station"]) == {"OMAA"}
    assert set(series["summer"]) == {2026}
    for target in Target:
        assert series[f"grid_{target.value}"].dtype == pl.Array(pl.Float64, len(LEVELS))
    assert series.select(f"raw_{t.value}" for t in Target).width == 4
    t_grid = series.filter(pl.col("grid_t").is_not_null())
    assert t_grid.height > 0
    grids = np.asarray(t_grid["grid_t"].to_list())
    assert np.all(np.diff(grids, axis=1) >= 0)  # a quantile grid is sorted
    # corrected median is closer to the truth than the raw forecast at the warm station (the +3 degree bias)
    scored = t_grid.filter(pl.col("truth_t").is_not_null() & pl.col("raw_t").is_not_null())
    median = np.asarray(scored["grid_t"].to_list())[:, LEVELS.index(0.5)]
    assert (
        np.abs(median - scored["truth_t"].to_numpy()).mean()
        < np.abs(scored["raw_t"].to_numpy() - scored["truth_t"].to_numpy()).mean()
    )


# === the serving path ===============================================================================================


def _ifs(pairs: pl.DataFrame) -> pl.DataFrame:
    return pairs.filter((pl.col("summer") == 2026) & (pl.col("model") == _IFS))


@pytest.mark.slow
def test_the_serving_path_reproduces_the_offline_predictor_for_t_td_and_wind() -> None:
    """The gold-to-serving conversion (frames, history, chunks) must give the offline predictor's numbers."""
    model = released()
    pairs = synthetic_test_pairs()
    # A few IFS rows with a missing input the serving path must refuse (the generator never drops an IFS value).
    holes = (pl.int_range(pl.len()) % 53 == 0) & (pl.col("model") == _IFS) & (pl.col("summer") == 2026)
    test = pairs.filter(pl.col("summer") == 2026).with_columns(
        pl.when(holes).then(None).otherwise(pl.col("fc_sw_wm2")).alias("fc_sw_wm2")
    )
    served = correct_with_released_model(model.model, test)
    features = build_features(
        test, feature_set=FeatureSet.SITE, stats=model.trained.stats, history=history_features(test)
    )
    offline = corrected_grids(model.trained, features)
    present = np.isfinite(
        _ifs(test.with_columns(pl.lit(2026, dtype=pl.Int16).alias("summer")))
        .select("fc_t_c", "fc_td_c", "fc_wind_ms", "fc_sw_wm2", "fc_direct_wm2", "fc_pressure_hpa")
        .to_numpy()
    ).all(axis=1)
    assert present.sum() > 0
    assert not present.all()
    for target in (Target.T, Target.TD, Target.WIND):
        assert np.isfinite(served.grids[target][present]).all()
        np.testing.assert_allclose(served.grids[target][present], offline[target][present], rtol=0, atol=1e-9)
        assert np.isnan(served.grids[target][~present]).all()  # missing input is never a number
    assert served.statuses["t:ok"] == int(present.sum())
    assert served.statuses["t:missing_input"] == int((~present).sum())


@pytest.mark.slow
def test_a_future_observation_never_reaches_an_earlier_forecast() -> None:
    """The history of day D reads only dates up to D - lead - 1: later truth cannot move an earlier correction."""
    model = released()
    pairs = synthetic_test_pairs()
    test = pairs.filter(pl.col("summer") == 2026)
    cutoff = pl.date(2026, 9, 20)
    shaken = test.with_columns(
        pl.when(pl.col("valid_time").dt.date() >= cutoff)
        .then(pl.col("obs_t_c") + 7.0)
        .otherwise(pl.col("obs_t_c"))
        .alias("obs_t_c")
    )
    before = correct_with_released_model(model.model, test)
    after = correct_with_released_model(model.model, shaken)
    early = _ifs(pairs).select((pl.col("valid_time").dt.date() <= cutoff).alias("m")).to_series().to_numpy()
    assert early.any()
    np.testing.assert_array_equal(before.grids[Target.T][early], after.grids[Target.T][early])
    assert not np.array_equal(before.grids[Target.T][~early], after.grids[Target.T][~early])  # the shake is real


# === refusals =======================================================================================================


def test_a_forged_token_is_refused(tmp_path: Path) -> None:
    impostor = MagicMock(spec=GateToken)
    impostor.part = Part.FORECAST
    with pytest.raises(TypeError, match="GateToken"):
        run(synthetic_test_pairs(), impostor)


def test_the_token_must_be_the_forecast_parts(tmp_path: Path) -> None:
    _, token = mint(tmp_path, part=Part.WARNINGS)
    with pytest.raises(ValueError, match="forecast part"):
        run(synthetic_test_pairs(), token)


def test_the_token_must_name_the_model_that_is_scored(tmp_path: Path) -> None:
    from stellar_blaze.ml.serving_path import load_released_model

    _, token = mint(tmp_path)
    other = load_released_model(released().models_dir, released().model.manifest.model_id)
    forged = type(other)(
        manifest=other.manifest.model_copy(update={"model_id": "corrector-20261113-0000000-000009"}), root=other.root
    )
    with pytest.raises(ValueError, match="only the released model is scored"):
        evaluate_forecast_test(
            synthetic_test_pairs(),
            model=forged,
            cold_cfg=cold_config(released_training_config(other)[0]),
            token=token,
            dev_tercile_edges=DEV_EDGES,
            clusters=CLUSTERS,
            n_boot=N_BOOT,
        )


@pytest.mark.parametrize(
    ("edges", "match"),
    [
        ((30.0, 27.0), "ascending"),
        ((27.0, 27.0), "ascending"),
        ((float("nan"), 30.0), "finite"),
        ((27.0, math.inf), "finite"),
    ],
)
def test_the_edges_must_be_two_finite_ascending_numbers(tmp_path: Path, edges: tuple[float, float], match: str) -> None:
    _, token = mint(tmp_path)
    with pytest.raises(ValueError, match=match):
        run(synthetic_test_pairs(), token, edges=edges)


def test_the_frame_must_hold_2026_and_nothing_beyond_the_three_summers(tmp_path: Path) -> None:
    _, token = mint(tmp_path)
    without = synthetic_test_pairs().filter(pl.col("summer") != 2026)
    with pytest.raises(ValueError, match="must hold the test summer 2026"):
        run(without, token)
    stray = synthetic_test_pairs().with_columns(
        pl.when(pl.col("summer") == 2025).then(pl.lit(2023, dtype=pl.Int16)).otherwise(pl.col("summer")).alias("summer")
    )
    with pytest.raises(ValueError, match=r"must hold the test summer 2026 and a development summer"):
        run(stray, token)


def test_a_lead_outside_the_config_and_a_warm_cold_config_and_an_unknown_cluster_are_refused(tmp_path: Path) -> None:
    _, token = mint(tmp_path)
    pairs = synthetic_test_pairs()
    trimmed = released_training_config(released().model)[0]
    with pytest.raises(ValueError, match="cold feature set"):
        run(pairs, token, cold_cfg=trimmed)  # the released (site) config is not a regime (c) config
    with pytest.raises(ValueError, match="unknown cluster"):
        run(pairs, token, clusters=("atlantis",))
    four = make_four_leads(pairs)
    with pytest.raises(ValueError, match=r"outside the config's leads"):
        run(four, token)


def make_four_leads(pairs: pl.DataFrame) -> pl.DataFrame:
    """The frame plus IFS rows of lead 4 (the fixture's model leads are 1-3): copies of the lead-3 rows."""
    extra = pairs.filter(pl.col("lead_days") == 3).with_columns(pl.lit(4, dtype=pl.Int8).alias("lead_days"))
    return pl.concat([pairs, extra])
