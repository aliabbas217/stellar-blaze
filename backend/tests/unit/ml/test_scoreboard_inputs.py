"""``ml.scoreboard_inputs``: the scoring frames (OOF export; synthetic 2026 series) and the series reader.

The 2026 path is exercised only with synthetic frames and ``FakeCorrector`` (the real series and sampler exist only
behind the gate); what is pinned here is the wiring: one sampler call for every row in series order, the columns the
scorer reads, the missing-grid rows that are never scored, and the reader's token and hash checks.
"""

import hashlib
import json
from datetime import UTC, date, datetime, time
from pathlib import Path

import polars as pl
import pytest

from stellar_blaze.adapters.fakes.corrector import FakeCorrector
from stellar_blaze.domain.plans.model import CrewSpec, ShiftBlock
from stellar_blaze.ml import data
from stellar_blaze.ml.protocol_gate import Part
from stellar_blaze.ml.scoreboard_inputs import clip_crew_to_labels, dev_inputs, inputs_2026
from tests.fixtures.forecast.gated import GatedWorld, released
from tests.fixtures.scoreboard.oof import Hour, off_season, oof_frame
from tests.unit.risk.support import default_params, released_ruleset

pytestmark = pytest.mark.unit

HIGH, LOW = (38.0, 20.0, 2.0), (30.0, 12.0, 3.0)


def grid(value: float) -> list[float]:
    return [value] * 19


def series(*, with_grid: bool = True) -> pl.DataFrame:
    """OMAA 2026, two days, hours 01-16 UTC, leads 1 and 2 (and 4, which is not scored): HIGH weather all day."""
    rows = []
    for day in (date(2026, 5, 20), date(2026, 5, 21)):
        for hour in range(1, 17):
            for lead in (1, 2, 4):
                rows.append(
                    {
                        "station": "OMAA",
                        "cluster": "abu_dhabi",
                        "valid_time": datetime(day.year, day.month, day.day, hour, tzinfo=UTC),
                        "summer": 2026,
                        "lead_days": lead,
                        "raw_t": HIGH[0],
                        "raw_td": HIGH[1],
                        "raw_wind": HIGH[2],
                        "raw_wbgt": 33.0,
                        "grid_t": grid(HIGH[0]) if with_grid else None,
                        "grid_td": grid(HIGH[1]) if with_grid else None,
                        "grid_wind": grid(HIGH[2]) if with_grid else None,
                        "grid_wbgt": grid(31.0 + 0.1 * hour) if with_grid else None,
                        "obs_t_c": HIGH[0],
                        "obs_td_c": HIGH[1],
                        "obs_wind_ms": HIGH[2],
                        "wbgt_obs_c": 32.5,
                        "has_joint_obs": True,
                        "wbgt_obs_reject": 0,
                        "ref_sw_wm2": 800.0,
                        "ref_direct_wm2": 600.0,
                        "ref_pressure_hpa": 1000.0,
                    }
                )
    schema = {"grid_t": pl.Array(pl.Float64, 19), "grid_td": pl.Array(pl.Float64, 19)}
    schema |= {"grid_wind": pl.Array(pl.Float64, 19), "grid_wbgt": pl.Array(pl.Float64, 19)}
    return pl.DataFrame(rows, schema_overrides=schema).with_columns(
        pl.col("lead_days").cast(pl.Int64), pl.col("summer").cast(pl.Int64)
    )


def radiation(frame: pl.DataFrame) -> pl.DataFrame:
    return frame.select("station", "valid_time", "lead_days").with_columns(
        pl.lit(800.0).alias("fc_sw_wm2"), pl.lit(600.0).alias("fc_direct_wm2"), pl.lit(1000.0).alias("fc_pressure_hpa")
    )


class SpyCorrector(FakeCorrector):
    """A fake that records every ``sample`` call (the 2026 frame must make exactly one)."""

    def __init__(self) -> None:
        super().__init__(0.0)
        self.calls: list[tuple[pl.DataFrame, int, int]] = []

    def sample(self, corrected: pl.DataFrame, *, n_samples: int, seed: int):  # type: ignore[no-untyped-def]
        self.calls.append((corrected, n_samples, seed))
        return super().sample(corrected, n_samples=n_samples, seed=seed)


def test_the_2026_frame_is_one_sampler_call_over_the_scored_rows_in_series_order() -> None:
    frame = series()
    spy = SpyCorrector()

    inputs = inputs_2026(frame, radiation(frame), spy, released_ruleset(), default_params())

    kept = frame.filter(pl.col("lead_days").is_in([1, 2]) & pl.col("valid_time").dt.hour().is_between(2, 15))
    assert inputs.rows.height == kept.height == 2 * 14 * 2  # lead 4 and the hours 01 and 16 UTC are not scored
    ((corrected, n, seed),) = spy.calls
    assert (n, seed) == (50, 20261112)
    assert corrected.height == 3 * kept.height  # t, td and wind rows of every kept forecast, in one frame
    first_keys = corrected.filter(pl.col("variable") == "t").select("valid_time", "lead_days")
    assert first_keys.equals(kept.sort("valid_time", "lead_days").select("valid_time", "lead_days"))
    # HIGH weather in every sample while the sun is up (the synthetic 800 W/m2 is incoherent after sunset, 15 UTC, and
    # such a sample is NaN, never scored): every finite sample is High, the q10 is below the High edge, truth is HIGH.
    daytime = inputs.rows.filter(pl.col("valid_time").dt.hour() <= 14)
    assert daytime["n_finite"].to_list() == [50.0] * daytime.height
    assert daytime["n_high"].to_list() == [50.0] * daytime.height
    assert max(daytime["protective_twl"].to_list()) < 115.0
    assert max(daytime["truth_twl"].to_list()) - 7.0 < 115.0
    night = inputs.rows.filter(pl.col("valid_time").dt.hour() == 15)
    assert night["n_finite"].to_list() == [0.0] * night.height
    assert inputs.rows["truth_wbgt_c"].to_list() == [32.5] * inputs.rows.height
    assert inputs.reject_available
    assert "wbgt_obs_reject" in inputs.truth_frame().columns


def test_a_row_without_a_grid_has_no_samples_and_is_not_present() -> None:
    frame = series(with_grid=False)

    inputs = inputs_2026(frame, radiation(frame), SpyCorrector(), released_ruleset(), default_params())

    assert inputs.rows["n_finite"].to_list() == [0.0] * inputs.rows.height  # never a confident number from nothing
    assert not inputs.present_frame()["present"].any()
    assert inputs.wbgt(date(2026, 5, 20))["p50"].null_count() == 14  # null, not a made-up range


def test_the_corrected_wbgt_range_is_read_from_the_series_grid() -> None:
    frame = series()
    inputs = inputs_2026(frame, radiation(frame), SpyCorrector(), released_ruleset(), default_params())

    shown = inputs.wbgt(date(2026, 5, 20))

    assert shown.height == 14  # lead 1, hours 02-15 UTC
    assert shown["p05"].to_list() == pytest.approx([31.0 + 0.1 * h for h in range(2, 16)])
    assert shown["p50"].to_list() == shown["p95"].to_list()  # a constant grid


def test_the_2026_frame_refuses_a_series_without_2026_rows() -> None:
    frame = series().with_columns(pl.lit(2025).cast(pl.Int64).alias("summer"))
    with pytest.raises(ValueError, match="no 2026 row"):
        inputs_2026(frame, radiation(frame), SpyCorrector(), released_ruleset(), default_params())


# === the dev frame ==================================================================================================


def dev_hours() -> list[Hour]:
    return [Hour(off_season(i, hour=7 + i % 3), 40 if i % 2 else 5, "high" if i % 2 else "low") for i in range(6)]


def test_the_dev_frame_has_counts_truth_and_a_wbgt_range_from_the_samples() -> None:
    inputs = dev_inputs(oof_frame(dev_hours()), released_ruleset(), default_params(), summer=2025)

    rows = inputs.rows
    assert rows["n_finite"].to_list() == [50.0] * 6
    assert rows["n_high"].to_list() == [5.0, 40.0, 5.0, 40.0, 5.0, 40.0]
    assert rows["truth_twl"].is_finite().all()
    assert rows["truth_wbgt_c"].is_finite().all()
    assert not inputs.reject_available
    assert "wbgt_obs_reject" not in inputs.truth_frame().columns
    day = rows["valid_time"][0].date()
    shown = inputs.wbgt(day)
    assert shown.height == 1  # one row on that date in the fixture
    assert shown["p05"][0] <= shown["p50"][0] <= shown["p95"][0]


def test_the_dev_frame_refuses_2026_and_a_non_dev_summer() -> None:
    from stellar_blaze.ml.data import HoldoutViolationError

    holdout = oof_frame([*dev_hours(), Hour(datetime(2026, 6, 1, 8, tzinfo=UTC), 0, "low")])
    with pytest.raises(HoldoutViolationError, match="2026"):
        dev_inputs(holdout, released_ruleset(), default_params(), summer=2025)
    with pytest.raises(HoldoutViolationError, match="not a development summer"):
        dev_inputs(oof_frame(dev_hours()), released_ruleset(), default_params(), summer=2023)


def test_the_roster_is_clipped_to_the_labelled_hours() -> None:
    crew = CrewSpec(
        crew_id="c",
        employer_id="e",
        workload="heavy",
        headcount=0,
        shift=(ShiftBlock(time(6, 0), time(11, 0)), ShiftBlock(time(15, 0), time(18, 0))),
        days_per_week=6,
        members=(),
    )
    clipped = clip_crew_to_labels(crew)
    assert [(b.start, b.end) for b in clipped.shift] == [(time(10, 0), time(11, 0)), (time(15, 0), time(18, 0))]
    early = ShiftBlock(time(6, 0), time(9, 0))
    assert clip_crew_to_labels(CrewSpec("c", "e", "heavy", 0, (early,), 6, ())).shift == ()


# === the series reader ==============================================================================================


def written(tmp_path: Path) -> tuple[Path, Path]:
    path, manifest = tmp_path / "corrected_series_OMAA.parquet", tmp_path / "corrected_series_OMAA.manifest.json"
    series().write_parquet(path)
    manifest.write_text(json.dumps({"sha256": hashlib.sha256(path.read_bytes()).hexdigest()}), encoding="utf-8")
    return path, manifest


def test_the_series_reader_needs_a_warnings_or_plans_token_and_a_matching_hash(tmp_path: Path) -> None:
    world = GatedWorld(tmp_path, released().model.manifest.model_id, released().models_dir)
    path, manifest = written(tmp_path)

    assert data.read_corrected_series(path, manifest, token=world.token(Part.WARNINGS)).height == series().height
    assert data.read_corrected_series(path, manifest, token=world.token(Part.PLANS)).height == series().height
    with pytest.raises(data.HoldoutViolationError, match="warnings and plans"):
        data.read_corrected_series(path, manifest, token=world.token(Part.FORECAST))
    bad_manifest = tmp_path / "bad.manifest.json"
    bad_manifest.write_text(json.dumps({"sha256": "0" * 64}), encoding="utf-8")
    with pytest.raises(ValueError, match="sha256"):
        data.read_corrected_series(path, bad_manifest, token=world.token(Part.WARNINGS))
    with pytest.raises(TypeError, match="GateToken"):
        data.read_corrected_series(path, manifest, token=object())  # type: ignore[arg-type]
