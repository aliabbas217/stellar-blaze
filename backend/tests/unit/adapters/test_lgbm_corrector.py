"""``LightGbmCorrector``: the serving adapter reproduces the offline predictor from a written model directory.

The models are the small synthetic ones of ``tests/fixtures/forecast/trained.py`` (a site/joint, a cold/joint and a
site/direct one, each trained once per module), written with ``write_model`` and read back with ``scan_models`` and
``LightGbmCorrector.load``. Nothing reads the gold file. The truth for the degenerate-model test is the synthetic
generator's.

Joint WBGT draws depend on the batch (module docstring of the adapter): the equality tests with the offline predictor
feed both the same rows in the same order.
"""

import copy
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Final

import numpy as np
import polars as pl
import pytest
import structlog
from scipy.stats import spearmanr

from stellar_blaze.adapters.compute import lgbm_corrector
from stellar_blaze.adapters.compute.lgbm_corrector import LightGbmCorrector, predict_grid
from stellar_blaze.adapters.config.models import scan_models
from stellar_blaze.domain.config.models import LoadedModel
from stellar_blaze.domain.forecast import sampling
from stellar_blaze.domain.forecast.features import (
    FeatureSet,
    Target,
    build_features,
    history_features,
    pairs_from_forecasts,
)
from stellar_blaze.domain.forecast.grid import LEVELS
from stellar_blaze.domain.forecast.sampling import WbgtJointGrid
from stellar_blaze.domain.forecast.schemas import (
    CORRECTED_FORECAST_SCHEMA,
    QUANTILE_COLUMNS,
    VARIABLES,
    CorrectionStatus,
    quantile_matrix,
)
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, SchemaMismatchError
from stellar_blaze.ml.artefacts import write_model
from stellar_blaze.ml.predict import corrected_grids
from stellar_blaze.ml.train import TrainedCorrector, train_corrector
from stellar_blaze.ports.corrector import ForecastCorrector
from tests.fixtures.forecast.synthetic import forecasts_of, observations_of
from tests.fixtures.forecast.trained import CFG_SHA256, small_config, small_pairs, trained_small
from tests.unit.forecast.contract import assert_respects_history_cutoff

pytestmark = pytest.mark.unit

IFS, GFS = "ecmwf_ifs025", "gfs_seamless"
DAY: Final = date(2024, 5, 15) + timedelta(days=124)  # summer day 125, 16 September 2024
GIT_SHA: Final = "0123456789abcdef0123456789abcdef01234567"
MEDIAN: Final = LEVELS.index(0.5)
_COLUMN = {"t": "t_c", "td": "td_c", "wind": "wind_ms"}


@dataclass(frozen=True)
class Bundle:
    """One written model, the corrector loaded from it and the trained object it was written from."""

    name: str
    trained: TrainedCorrector
    loaded: LoadedModel
    corrector: LightGbmCorrector


def _bundle(name: str, trained: TrainedCorrector, root: Path) -> Bundle:
    lock = root / "uv.lock"
    lock.write_bytes(b"version = 1\n")
    path = write_model(
        trained,
        models_dir=root / "models",
        created_at=datetime(2026, 11, 14, 9, 30, tzinfo=UTC),
        git_sha=GIT_SHA,
        uv_lock=lock,
        gold_manifest_sha256="ab" * 32,
        cfg_path="backend/training/configs/unit.toml",
        dev_metrics={},
    )
    loaded = scan_models(path.parent).get(path.name)
    return Bundle(name, trained, loaded, LightGbmCorrector.load(loaded))


@pytest.fixture(scope="module")
def pairs() -> pl.DataFrame:
    return small_pairs()


@pytest.fixture(scope="module")
def site(tmp_path_factory: pytest.TempPathFactory) -> Bundle:
    return _bundle("site", trained_small()[1], tmp_path_factory.mktemp("site"))


@pytest.fixture(scope="module")
def cold(tmp_path_factory: pytest.TempPathFactory, pairs: pl.DataFrame) -> Bundle:
    trained = train_corrector(pairs, small_config(feature_set=FeatureSet.COLD), cfg_sha256=CFG_SHA256)
    return _bundle("cold", trained, tmp_path_factory.mktemp("cold"))


@pytest.fixture(scope="module")
def direct(tmp_path_factory: pytest.TempPathFactory, pairs: pl.DataFrame) -> Bundle:
    trained = train_corrector(pairs, small_config(wbgt_method="direct"), cfg_sha256=CFG_SHA256)
    return _bundle("direct", trained, tmp_path_factory.mktemp("direct"))


@pytest.fixture(params=["site", "cold", "direct"])
def bundle(request: pytest.FixtureRequest, site: Bundle, cold: Bundle, direct: Bundle) -> Bundle:
    return {"site": site, "cold": cold, "direct": direct}[str(request.param)]


def _on(frame: pl.DataFrame, day: date) -> pl.DataFrame:
    return frame.filter(pl.col("valid_time").dt.date() == day)


@pytest.fixture(scope="module")
def ifs(pairs: pl.DataFrame) -> pl.DataFrame:
    return _on(forecasts_of(pairs, IFS), DAY)


@pytest.fixture(scope="module")
def gfs(pairs: pl.DataFrame) -> pl.DataFrame:
    return _on(forecasts_of(pairs, GFS), DAY)


@pytest.fixture(scope="module")
def history(pairs: pl.DataFrame) -> pl.DataFrame:
    return observations_of(pairs)


@pytest.fixture(scope="module")
def history_ifs(pairs: pl.DataFrame) -> pl.DataFrame:
    return forecasts_of(pairs, IFS).filter(pl.col("lead_days") == 1)


def _correct(
    corrector: LightGbmCorrector,
    ifs: pl.DataFrame,
    gfs: pl.DataFrame,
    history: pl.DataFrame,
    history_ifs: pl.DataFrame | None,
) -> pl.DataFrame:
    return corrector.correct(ifs=ifs, gfs=gfs, history=history, history_ifs=history_ifs)


def _grid(corrected: pl.DataFrame, variable: str) -> np.ndarray:
    return quantile_matrix(corrected.filter(pl.col("variable") == variable))


def _row(corrected: pl.DataFrame, i: int) -> pl.DataFrame:
    """The four output rows of input row ``i``."""
    return corrected.slice(len(VARIABLES) * i, len(VARIABLES))


# === the port, the files and the schema =============================================================================


def test_the_corrector_satisfies_the_port(bundle: Bundle) -> None:
    corrector: ForecastCorrector = bundle.corrector  # mypy checks the structural fit; the Protocol is not runtime
    assert corrector.model_id == bundle.loaded.manifest.model_id
    assert corrector.needs_history_forecasts is (bundle.name != "cold")
    for member in ("correct", "sample"):
        assert callable(getattr(corrector, member))


def test_load_reads_every_part_of_the_model_directory(site: Bundle, direct: Bundle) -> None:
    assert set(site.corrector._boosters) == {Target.T, Target.TD, Target.WIND}  # noqa: SLF001
    assert set(direct.corrector._boosters) == set(Target)  # noqa: SLF001
    assert all(len(boosters) == len(LEVELS) for boosters in direct.corrector._boosters.values())  # noqa: SLF001


def test_the_output_is_a_corrected_forecast_frame(
    bundle: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    out = _correct(bundle.corrector, ifs, gfs, history, history_ifs)
    assert out.schema == CORRECTED_FORECAST_SCHEMA
    assert out.height == len(VARIABLES) * ifs.height
    assert out["variable"].to_list() == list(VARIABLES) * ifs.height
    assert (
        out.select("station", "valid_time", "lead_days")
        .gather_every(4)
        .equals(ifs.select("station", "valid_time", "lead_days"))
    )
    assert out["model_id"].unique().to_list() == [bundle.loaded.manifest.model_id]
    assert out["status"].unique().to_list() == [CorrectionStatus.OK.value]
    for variable in VARIABLES:
        grid = _grid(out, variable)
        assert np.isfinite(grid).all()
        assert (np.diff(grid, axis=1) >= 0).all(), f"{variable} quantiles must be sorted"
    assert (_grid(out, "wind") >= 0).all()


def test_raw_is_the_ifs_value_and_the_forecast_wbgt(
    site: Bundle,
    pairs: pl.DataFrame,
    ifs: pl.DataFrame,
    gfs: pl.DataFrame,
    history: pl.DataFrame,
    history_ifs: pl.DataFrame,
) -> None:
    out = _correct(site.corrector, ifs, gfs, history, history_ifs)
    for variable, column in _COLUMN.items():
        assert out.filter(pl.col("variable") == variable)["raw"].to_list() == ifs[column].to_list()
    gold = pairs.filter((pl.col("model") == IFS) & (pl.col("valid_time").dt.date() == DAY))
    np.testing.assert_allclose(
        out.filter(pl.col("variable") == "wbgt")["raw"].to_numpy(), gold["wbgt_fc_c"].to_numpy(), atol=1e-12, rtol=0
    )


# === equality with the offline predictor ============================================================================


def _offline(bundle: Bundle, pairs: pl.DataFrame, serving: pl.DataFrame | None = None) -> dict[Target, np.ndarray]:
    """``ml.predict.corrected_grids`` on the ``build_features`` rows of DAY (gold ``pairs`` or a ``serving`` frame)."""
    trained = bundle.trained
    history = history_features(pairs) if trained.cfg.feature_set is FeatureSet.SITE else None
    features = build_features(
        pairs if serving is None else serving, feature_set=trained.cfg.feature_set, stats=trained.stats, history=history
    )
    return corrected_grids(trained, features.filter(pl.col("valid_date") == DAY))


def test_corrector_matches_offline_prediction(
    bundle: Bundle,
    pairs: pl.DataFrame,
    ifs: pl.DataFrame,
    gfs: pl.DataFrame,
    history: pl.DataFrame,
    history_ifs: pl.DataFrame,
) -> None:
    """From the written files alone: t, td, wind and (identical batch) WBGT equal ``corrected_grids`` to 1e-12."""
    out = _correct(bundle.corrector, ifs, gfs, history, history_ifs)
    offline = _offline(bundle, pairs)
    for target in Target:
        assert offline[target].shape[0] == ifs.height
        np.testing.assert_allclose(_grid(out, target.value), offline[target], atol=1e-12, rtol=0, err_msg=target.value)


def test_batch_order_changes_only_the_joint_wbgt_draws(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    """The documented batch dependence: t, td, wind are per row, the joint WBGT draws are not (one seed)."""
    full = _correct(site.corrector, ifs, gfs, history, history_ifs)
    reversed_ = _correct(site.corrector, ifs.reverse(), gfs, history, history_ifs)
    again = _correct(site.corrector, ifs, gfs, history, history_ifs)
    assert full.equals(again), "the same batch in the same order is reproducible"
    flipped = reversed_.select(pl.all().gather(np.arange(reversed_.height).reshape(-1, 4)[::-1].reshape(-1)))
    for variable in ("t", "td", "wind"):
        np.testing.assert_allclose(_grid(flipped, variable), _grid(full, variable), atol=1e-12, rtol=0)
    assert not np.allclose(_grid(flipped, "wbgt"), _grid(full, "wbgt"), atol=1e-9)


def test_low_wind_is_floored_before_the_joint_draws_and_in_the_grid(
    site: Bundle,
    pairs: pl.DataFrame,
    ifs: pl.DataFrame,
    gfs: pl.DataFrame,
    history: pl.DataFrame,
    history_ifs: pl.DataFrame,
) -> None:
    """Where the floor binds the wind grid is clipped at 0 and the joint WBGT still equals the offline recipe."""
    calm = ifs.with_columns(pl.when(pl.col("lead_days") >= 5).then(0.05).otherwise(pl.col("wind_ms")).alias("wind_ms"))
    out = _correct(site.corrector, calm, gfs, history, history_ifs)
    wind = _grid(out, "wind")
    floored = calm["lead_days"].to_numpy() >= 5
    assert (wind[floored][:, 0] == 0.0).sum() >= 5, "the floor must bind on this fixture, or the test is vacuous"
    assert (wind >= 0).all()
    assert (np.diff(wind, axis=1) >= 0).all()

    offline = _offline(site, pairs, pairs_from_forecasts(calm, gfs))
    for target in Target:
        np.testing.assert_allclose(_grid(out, target.value), offline[target], atol=1e-12, rtol=0, err_msg=target.value)


# === missing input and out-of-range rows ============================================================================


def test_a_booster_answers_a_number_for_a_nan_feature(site: Bundle) -> None:
    """Why the gate exists: a real booster is finite on an all-NaN row, so only the gate can make it missing."""
    names = site.corrector._feature_names  # noqa: SLF001
    grid = predict_grid(site.trained.boosters[Target.T], np.full((1, len(names)), np.nan))
    assert np.isfinite(grid).all()


@pytest.mark.parametrize("column", ["td_c", "t_c", "wind_ms", "sw_wm2", "direct_wm2", "pressure_hpa"])
def test_a_null_ifs_value_gives_four_missing_input_rows_and_leaves_the_neighbors_alone(
    site: Bundle,
    ifs: pl.DataFrame,
    gfs: pl.DataFrame,
    history: pl.DataFrame,
    history_ifs: pl.DataFrame,
    column: str,
) -> None:
    baseline = _correct(site.corrector, ifs, gfs, history, history_ifs)
    broken = ifs.with_columns(pl.when(pl.int_range(pl.len()) == 10).then(None).otherwise(pl.col(column)).alias(column))
    out = _correct(site.corrector, broken, gfs, history, history_ifs)
    rows = _row(out, 10)
    assert rows["status"].to_list() == [CorrectionStatus.MISSING_INPUT.value] * 4
    assert rows.select(QUANTILE_COLUMNS).null_count().to_numpy().sum() == 4 * len(QUANTILE_COLUMNS)
    assert baseline["status"].unique().to_list() == [CorrectionStatus.OK.value]
    # every other row is untouched, the joint WBGT included (a gated row keeps its slot in the batch)
    keep = np.arange(out.height) // 4 != 10
    assert out.filter(pl.Series(keep)).equals(baseline.filter(pl.Series(keep)))


def test_a_nan_ifs_value_is_missing_too(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    broken = ifs.with_columns(
        pl.when(pl.int_range(pl.len()) == 3).then(float("nan")).otherwise(pl.col("t_c")).alias("t_c")
    )
    out = _correct(site.corrector, broken, gfs, history, history_ifs)
    assert _row(out, 3)["status"].to_list() == ["missing_input"] * 4
    assert _row(out, 3)["raw"].to_list()[1:3] == ifs["td_c"].to_list()[3:4] + ifs["wind_ms"].to_list()[3:4]
    assert _row(out, 3)["raw"][0] is None


def test_a_missing_gfs_row_is_a_missing_feature_not_a_missing_input(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    with_gfs = _correct(site.corrector, ifs, gfs, history, history_ifs)
    without = _correct(site.corrector, ifs, gfs.head(0), history, history_ifs)
    assert without["status"].unique().to_list() == [CorrectionStatus.OK.value]
    assert np.isfinite(_grid(without, "t")).all()
    assert not np.allclose(_grid(without, "t"), _grid(with_gfs, "t"), atol=1e-9), "GFS features must matter"


def _at_night(frame: pl.DataFrame, rows: list[int]) -> pl.DataFrame:
    """The rows moved from the day to 20 UTC (still the same station), with the sun down so the WBGT is coherent."""
    chosen = pl.int_range(pl.len()).is_in(rows)
    return frame.with_columns(
        pl.when(chosen)
        .then(pl.col("valid_time") + pl.duration(hours=17))
        .otherwise(pl.col("valid_time"))
        .alias("valid_time"),
        *(pl.when(chosen).then(0.0).otherwise(pl.col(name)).alias(name) for name in ("sw_wm2", "direct_wm2")),
    )


def test_hours_and_leads_outside_the_fitted_range_are_uncorrected(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    odd = _at_night(ifs.head(8), [0]).with_columns(
        pl.when(pl.int_range(pl.len()) == 1)
        .then(0)
        .when(pl.int_range(pl.len()) == 2)
        .then(8)
        .otherwise(pl.col("lead_days"))
        .cast(pl.Int8())
        .alias("lead_days"),
    )
    out = _correct(site.corrector, odd, gfs.head(0), history, history_ifs)
    for i in (0, 1, 2):
        rows = _row(out, i)
        assert rows["status"].to_list() == [CorrectionStatus.UNCORRECTED.value] * 4, i
        quantiles = rows.select(QUANTILE_COLUMNS).to_numpy()
        np.testing.assert_array_equal(quantiles, np.repeat(rows["raw"].to_numpy()[:, None], len(LEVELS), axis=1))
    for i in range(3, 8):
        assert _row(out, i)["status"].to_list() == [CorrectionStatus.OK.value] * 4


def test_a_missing_input_wins_over_uncorrected(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    night = _at_night(ifs.head(2), [0, 1]).with_columns(
        pl.when(pl.int_range(pl.len()) == 0).then(None).otherwise(pl.col("td_c")).alias("td_c"),
    )
    out = _correct(site.corrector, night, gfs.head(0), history, history_ifs)
    assert _row(out, 0)["status"].to_list() == ["missing_input"] * 4
    assert _row(out, 1)["status"].to_list() == ["uncorrected"] * 4


def test_a_rejected_forecast_wbgt_is_missing_for_the_wbgt_row_only(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    hot = ifs.with_columns(pl.when(pl.int_range(pl.len()) == 4).then(75.0).otherwise(pl.col("t_c")).alias("t_c"))
    out = _correct(site.corrector, hot, gfs, history, history_ifs)
    assert _row(out, 4)["status"].to_list() == ["ok", "ok", "ok", "missing_input"]
    assert _row(out, 4)["raw"][3] is None
    assert _row(out, 4)["raw"][0] == 75.0


@pytest.mark.parametrize(("finite", "status"), [(9, "missing_input"), (10, "ok")])
def test_a_joint_wbgt_on_fewer_than_half_the_samples_is_missing_for_the_wbgt_row_only(
    site: Bundle,
    monkeypatch: pytest.MonkeyPatch,
    ifs: pl.DataFrame,
    gfs: pl.DataFrame,
    history: pl.DataFrame,
    history_ifs: pl.DataFrame,
    finite: int,
    status: str,
) -> None:
    """R30: fewer than ``n_joint_samples / 2`` (10 of 20 here) finite samples is no distribution; half is kept."""
    real = sampling.wbgt_joint_grid

    def thin(*args: Any, **kwargs: Any) -> WbgtJointGrid:
        result = real(*args, **kwargs)
        return WbgtJointGrid(grid=result.grid, n_finite=np.full_like(result.n_finite, finite))

    monkeypatch.setattr(lgbm_corrector, "wbgt_joint_grid", thin)
    out = _correct(site.corrector, ifs.head(6), gfs, history, history_ifs)
    for i in range(6):
        assert _row(out, i)["status"].to_list() == ["ok", "ok", "ok", status]


# === input checks ===================================================================================================


def test_empty_input_gives_an_empty_frame(site: Bundle, history: pl.DataFrame, history_ifs: pl.DataFrame) -> None:
    empty = pl.DataFrame(schema=FORECAST_SCHEMA)
    out = _correct(site.corrector, empty, empty, history, history_ifs)
    assert out.schema == CORRECTED_FORECAST_SCHEMA
    assert out.height == 0


def test_wrong_inputs_are_refused(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    with pytest.raises(ValueError, match="ifs must hold only"):
        _correct(site.corrector, gfs, gfs, history, history_ifs)
    with pytest.raises(ValueError, match="gfs must hold only"):
        _correct(site.corrector, ifs, ifs, history, history_ifs)
    with pytest.raises(SchemaMismatchError):
        _correct(site.corrector, ifs.drop("td_c"), gfs, history, history_ifs)
    with pytest.raises(ValueError, match="duplicate"):
        _correct(site.corrector, pl.concat([ifs, ifs.head(1)]), gfs, history, history_ifs)
    with pytest.raises(ValueError, match="history"):
        _correct(site.corrector, ifs, gfs, pl.concat([history, history.head(1)]), history_ifs)


# === station history, the L3 cutoff =================================================================================


@pytest.mark.slow
def test_history_cutoff_holds_for_a_site_model(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    """Truth and lead-1 forecasts after ``D - L - 1`` cannot move the output; the check is not vacuous (see below)."""
    assert_respects_history_cutoff(
        site.corrector, ifs=ifs, gfs=gfs, history=history, history_ifs=history_ifs, uses_history=True
    )


@pytest.mark.slow
@pytest.mark.parametrize("lead", [1, 3, 7])
def test_neither_history_frame_alone_can_leak_past_the_cutoff(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame, lead: int
) -> None:
    """The truth alone, or the lead-1 forecasts alone, shifted after ``D - lead - 1``, leave the row unchanged.

    ``assert_respects_history_cutoff`` shifts truth and forecasts by the same amount, which cancels in the error
    (forecast minus truth) that ``bias7_*`` averages, so a window that leaked would pass it. Each frame is shifted on
    its own here, and the leaking window of the mutation table in the report fails this test.
    """
    cutoff = DAY - timedelta(days=lead + 1)
    rows = ifs.filter((pl.col("lead_days") == lead) & (pl.col("valid_time").dt.hour() == 7))
    assert rows.height == 3
    base = _correct(site.corrector, rows, gfs, history, history_ifs)
    after = pl.col("valid_time").dt.date() > cutoff
    moved_truth = history.with_columns(pl.when(after).then(pl.col("t_c") + 100.0).otherwise(pl.col("t_c")).alias("t_c"))
    moved_forecast = history_ifs.with_columns(
        pl.when(after).then(pl.col("t_c") + 100.0).otherwise(pl.col("t_c")).alias("t_c")
    )
    assert history.filter(after).height > 0, "the history must reach past the cutoff, or the test is vacuous"
    assert _correct(site.corrector, rows, gfs, moved_truth, history_ifs).equals(base)
    assert _correct(site.corrector, rows, gfs, history, moved_forecast).equals(base)


def test_a_site_model_really_uses_the_history_before_the_cutoff(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    """The cutoff test above would pass trivially for a model that ignored history; this one cannot."""
    base = _correct(site.corrector, ifs, gfs, history, history_ifs)
    shifted_truth = history.with_columns((pl.col("t_c") + 5.0).alias("t_c"))
    moved = _correct(site.corrector, ifs, gfs, shifted_truth, history_ifs)
    assert not np.allclose(_grid(moved, "t"), _grid(base, "t"), atol=1e-6)


@pytest.mark.slow
def test_history_cutoff_holds_for_a_cold_model_that_ignores_history_altogether(
    cold: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    assert_respects_history_cutoff(
        cold.corrector, ifs=ifs, gfs=gfs, history=history, history_ifs=history_ifs, uses_history=False
    )
    assert cold.corrector.needs_history_forecasts is False


def test_a_site_model_without_history_ifs_still_corrects_and_says_so(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    with structlog.testing.capture_logs() as logs:
        out = _correct(site.corrector, ifs, gfs, history, None)
    assert out["status"].unique().to_list() == [CorrectionStatus.OK.value]
    events = [entry for entry in logs if entry["event"] == "station_history_unavailable"]
    assert len(events) == 1
    assert events[0]["model_id"] == site.loaded.manifest.model_id
    assert events[0]["log_level"] == "warning"
    with structlog.testing.capture_logs() as logs:
        _correct(site.corrector, ifs, gfs, history, history_ifs)
    assert not [entry for entry in logs if entry["event"] == "station_history_unavailable"]


def test_a_cold_model_does_not_complain_about_missing_history(
    cold: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame
) -> None:
    with structlog.testing.capture_logs() as logs:
        out = _correct(cold.corrector, ifs, gfs, history.head(0), None)
    assert out["status"].unique().to_list() == [CorrectionStatus.OK.value]
    assert not logs


# === the degenerate guard (Review Focus 5) ==========================================================================


def test_the_corrected_median_is_not_the_raw_forecast_and_removes_the_bias(
    site: Bundle, pairs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    """On the +3.0 C biased stations the served median differs from raw and cuts the median absolute error by half.

    +3.0 C, not +1.5: with the fixture's irreducible spread a perfect correction of 1.5 C cannot halve the error.
    """
    september = (pl.col("valid_time").dt.month() == 9) & pl.col("station").is_in(["OMAA", "OMDB"])
    september_ifs = forecasts_of(pairs, IFS).filter(september & (pl.col("lead_days") <= 3))
    september_gfs = forecasts_of(pairs, GFS).filter(september & (pl.col("lead_days") <= 3))
    out = _correct(site.corrector, september_ifs, september_gfs, history, history_ifs)
    served = out.filter(pl.col("variable") == "t").with_columns(pl.col("q50").alias("median"))
    truth = history.select("station", "valid_time", pl.col("t_c").alias("truth"))
    scored = served.join(truth, on=["station", "valid_time"], how="inner").drop_nulls(["raw", "median", "truth"])
    assert scored.height > 400
    raw_error = float(np.median(np.abs((scored["raw"] - scored["truth"]).to_numpy())))
    served_error = float(np.median(np.abs((scored["median"] - scored["truth"]).to_numpy())))
    assert np.mean((scored["median"] != scored["raw"]).to_numpy()) > 0.99, "a corrector that equals raw is degenerate"
    assert raw_error > 2.5, "the fixture's bias must be visible in the raw forecast"
    assert served_error < 0.5 * raw_error


# === sample =========================================================================================================


def test_sample_returns_joint_samples_in_row_order(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    out = _correct(site.corrector, ifs, gfs, history, history_ifs)
    samples = site.corrector.sample(out, n_samples=30, seed=5)
    assert samples.shape == (ifs.height, 30, 3)
    assert np.isfinite(samples).all()
    assert (samples[:, :, 1] <= samples[:, :, 0]).all(), "td <= t"
    assert (samples[:, :, 2] >= 0).all(), "wind >= 0"
    np.testing.assert_array_equal(samples, site.corrector.sample(out, n_samples=30, seed=5))
    assert not np.array_equal(samples, site.corrector.sample(out, n_samples=30, seed=6))
    # first-appearance order of the distinct keys: reversing the frame reverses the rows
    reversed_rows = site.corrector.sample(out.reverse(), n_samples=30, seed=5)
    assert reversed_rows.shape == samples.shape
    assert np.isfinite(reversed_rows).all()


def test_samples_follow_the_marginals_of_the_corrected_rows(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    out = _correct(site.corrector, ifs, gfs, history, history_ifs)
    samples = site.corrector.sample(out, n_samples=4000, seed=1)
    for k, variable in enumerate(("t", "td", "wind")):
        grid = _grid(out, variable)
        median = np.median(samples[:, :, k], axis=1)
        assert np.abs(median - grid[:, MEDIAN]).max() < 0.35, variable


def test_a_missing_or_uncorrected_row_has_nan_samples_for_the_whole_row(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    odd = ifs.head(6).with_columns(
        pl.when(pl.int_range(pl.len()) == 1).then(None).otherwise(pl.col("td_c")).alias("td_c"),
        pl.when(pl.int_range(pl.len()) == 2)
        .then(pl.col("valid_time") + pl.duration(hours=17))
        .otherwise(pl.col("valid_time"))
        .alias("valid_time"),
    )
    out = _correct(site.corrector, odd, gfs.head(0), history, history_ifs)
    samples = site.corrector.sample(out, n_samples=10, seed=3)
    assert samples.shape == (6, 10, 3)
    assert np.isnan(samples[1]).all()
    assert np.isnan(samples[2]).all()
    assert np.isfinite(samples[[0, 3, 4, 5]]).all()


def _with_copulas(site: Bundle, root: Path, rho_by_stratum: dict[str, float]) -> LightGbmCorrector:
    """A corrector whose copula.json holds the given (t, td) correlation per stratum (0 elsewhere)."""
    target = root / "edited"
    shutil.copytree(site.loaded.root, target)
    path = target / "copula.json"
    document = json.loads(path.read_bytes())
    for key in document["corr"]:
        rho = rho_by_stratum.get(key, 0.0)
        document["corr"][key] = [[1.0, rho, 0.0], [rho, 1.0, 0.0], [0.0, 0.0, 1.0]]
    path.write_text(json.dumps(document), encoding="utf-8")
    return LightGbmCorrector.load(LoadedModel(manifest=site.loaded.manifest, root=target))


def test_each_row_is_sampled_with_the_correlation_of_its_own_stratum(
    site: Bundle,
    tmp_path: Path,
    ifs: pl.DataFrame,
    gfs: pl.DataFrame,
    history: pl.DataFrame,
    history_ifs: pl.DataFrame,
) -> None:
    corrector = _with_copulas(site, tmp_path, {"1|peak": 0.9})
    rows = ifs.filter(
        (pl.col("station") == "OMAA") & pl.col("lead_days").is_in([1, 2]) & (pl.col("valid_time").dt.hour() == 7)
    )
    out = _correct(corrector, rows, gfs, history, history_ifs)
    samples = corrector.sample(out, n_samples=4000, seed=2)
    by_lead = dict(zip(rows["lead_days"].to_list(), samples, strict=True))
    tied = spearmanr(by_lead[1][:, 0], by_lead[1][:, 1]).statistic
    free = spearmanr(by_lead[2][:, 0], by_lead[2][:, 1]).statistic
    assert tied > 0.85, "the 1|peak row uses rho 0.9"
    assert abs(free) < 0.1, "the 2|peak row uses rho 0"


def test_sample_refuses_bad_arguments(
    site: Bundle, ifs: pl.DataFrame, gfs: pl.DataFrame, history: pl.DataFrame, history_ifs: pl.DataFrame
) -> None:
    out = _correct(site.corrector, ifs.head(3), gfs, history, history_ifs)
    with pytest.raises(ValueError, match="at least 1"):
        site.corrector.sample(out, n_samples=0, seed=0)
    with pytest.raises(ValueError, match="'td'"):
        site.corrector.sample(out.filter(pl.col("variable") != "td"), n_samples=2, seed=0)
    with pytest.raises(ValueError, match="duplicate"):
        site.corrector.sample(pl.concat([out, out.head(1)]), n_samples=2, seed=0)
    with pytest.raises(SchemaMismatchError):
        site.corrector.sample(out.drop("q50"), n_samples=2, seed=0)


# === loading is checked =============================================================================================


def test_load_refuses_parts_that_disagree(site: Bundle, tmp_path: Path) -> None:
    def broken(edit_name: str, edit: str) -> LoadedModel:
        target = tmp_path / edit_name
        shutil.copytree(site.loaded.root, target)
        if edit == "features":
            path = target / "params.json"
            document = json.loads(path.read_bytes())
            document["feature_columns"] = document["feature_columns"][:-1]
            path.write_text(json.dumps(document), encoding="utf-8")
        elif edit == "copula":
            path = target / "copula.json"
            document = json.loads(path.read_bytes())
            document["corr"].pop("1|peak")
            path.write_text(json.dumps(document), encoding="utf-8")
        return LoadedModel(manifest=copy.copy(site.loaded.manifest), root=target)

    with pytest.raises(ValueError, match="feature columns"):
        LightGbmCorrector.load(broken("a", "features"))
    with pytest.raises(ValueError, match=r"copula\.json"):
        LightGbmCorrector.load(broken("b", "copula"))
    with pytest.raises(FileNotFoundError):
        LightGbmCorrector.load(LoadedModel(manifest=site.loaded.manifest, root=tmp_path / "nowhere"))


# === layering: serving never needs the training libraries ===========================================================


@pytest.mark.slow
def test_the_adapter_imports_without_the_training_stack(tmp_path: Path) -> None:
    code = (
        "import sys\n"
        "for name in ('mapie', 'sklearn', 'scoringrules'):\n"
        "    sys.modules[name] = None\n"
        "import stellar_blaze.adapters.compute.lgbm_corrector as adapter\n"
        "assert adapter.LightGbmCorrector\n"
        "loaded = sorted(m for m in sys.modules if m == 'stellar_blaze.ml' or m.startswith('stellar_blaze.ml.'))\n"
        "assert not loaded, loaded\n"
    )
    done = subprocess.run(  # noqa: S603
        [sys.executable, "-c", code], cwd=tmp_path, capture_output=True, text=True, check=False
    )
    assert done.returncode == 0, done.stderr
