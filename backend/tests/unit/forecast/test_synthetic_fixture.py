"""The synthetic gold-pair generator that every later forecast-corrector test builds on (no gold file is read)."""

from datetime import UTC, date, datetime

import polars as pl
import pytest
from polars.testing import assert_frame_equal

from stellar_blaze.domain.weather.models import is_working_daytime
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, GOLD_PAIRS_SCHEMA, OBS_HOURLY_SCHEMA, conform
from stellar_blaze.domain.weather.stations import STATIONS
from tests.fixtures.forecast.synthetic import SUMMER_DAYS, clear_cache, forecasts_of, make_pairs, observations_of

pytestmark = pytest.mark.unit

IFS, GFS = "ecmwf_ifs025", "gfs_seamless"
ICAOS = [s.icao for s in STATIONS]
_ONE_STATION = {"stations": ("OMAA",), "summers": (2024,), "station_bias_c": {}}


@pytest.fixture(scope="module")
def default_pairs() -> pl.DataFrame:
    return make_pairs(seed=7, summers=(2024,), station_bias_c={"OMAA": 1.5, "OMDB": -1.0})


def tiny(**knobs: object) -> pl.DataFrame:
    """A few hours of one station; the knobs override the defaults."""
    defaults: dict[str, object] = {
        "seed": 1,
        "summers": (2024,),
        "station_bias_c": {},
        "stations": ("OMAA",),
        "leads": (1,),
        "hours_utc": [6, 7],
        "summer_days": [1, 2],
        "missing_obs_rate": 0.0,
        "reject_rate": 0.0,
        "gfs_missing_rate": 0.0,
    }
    return make_pairs(**{**defaults, **knobs})  # type: ignore[arg-type]


# === determinism, schema, defaults ==================================================================================


def test_synthetic_is_deterministic_and_conforms(default_pairs: pl.DataFrame) -> None:
    clear_cache()  # rebuild from scratch: the same arguments must give the same frame, not just the cached one
    again = make_pairs(seed=7, summers=(2024,), station_bias_c={"OMAA": 1.5, "OMDB": -1.0})
    assert again is not default_pairs
    assert_frame_equal(default_pairs, again)
    assert default_pairs.schema == GOLD_PAIRS_SCHEMA
    assert conform(default_pairs, GOLD_PAIRS_SCHEMA).equals(default_pairs)
    different = make_pairs(seed=8, summers=(2024,), station_bias_c={"OMAA": 1.5, "OMDB": -1.0})
    assert not different.equals(default_pairs)


def test_a_caller_cannot_corrupt_the_cache() -> None:
    first = tiny(seed=11)
    first.insert_column(0, pl.Series("scribble", range(first.height)))  # an in-place edit of the returned frame
    first.drop_in_place("fc_t_c")
    second = tiny(seed=11)
    assert "scribble" not in second.columns
    assert second.schema == GOLD_PAIRS_SCHEMA
    clear_cache()
    assert_frame_equal(second, tiny(seed=11))


def test_the_injected_bias_is_recoverable(default_pairs: pl.DataFrame) -> None:
    errors = default_pairs.filter(pl.col("obs_t_c").is_not_null()).with_columns(
        (pl.col("fc_t_c") - pl.col("obs_t_c")).alias("error")
    )
    by_station = {
        row["station"]: row["error"] for row in errors.group_by("station").agg(pl.col("error").mean()).to_dicts()
    }
    assert by_station["OMAA"] == pytest.approx(1.5, abs=0.1)
    assert by_station["OMDB"] == pytest.approx(-1.0, abs=0.1)
    for icao in set(ICAOS) - {"OMAA", "OMDB"}:
        assert by_station[icao] == pytest.approx(0.0, abs=0.1)


def test_dew_point_and_wind_biases_are_recoverable() -> None:
    pairs = make_pairs(
        seed=2,
        summers=(2025,),
        station_bias_c={},
        stations=("OMAL", "OMFJ"),
        td_bias_c={"OMAL": 2.0},
        wind_bias_ms={"OMFJ": -0.8},
    )
    scored = (
        pairs.filter(pl.col("has_joint_obs"))
        .group_by("station")
        .agg(
            (pl.col("fc_td_c") - pl.col("obs_td_c")).mean().alias("td"),
            (pl.col("fc_wind_ms") - pl.col("obs_wind_ms")).mean().alias("wind"),
            (pl.col("fc_t_c") - pl.col("obs_t_c")).mean().alias("t"),
        )
    )
    rows = {row["station"]: row for row in scored.to_dicts()}
    assert rows["OMAL"]["td"] == pytest.approx(2.0, abs=0.1)
    assert rows["OMAL"]["wind"] == pytest.approx(0.0, abs=0.1)
    assert rows["OMFJ"]["wind"] == pytest.approx(-0.8, abs=0.1)
    assert rows["OMFJ"]["td"] == pytest.approx(0.0, abs=0.1)
    assert rows["OMAL"]["t"] == pytest.approx(0.0, abs=0.1)


def test_defaults_cover_all_stations_models_leads_hours_and_the_tests_windows(default_pairs: pl.DataFrame) -> None:
    assert sorted(default_pairs["station"].unique()) == sorted(ICAOS)
    assert sorted(default_pairs["model"].unique()) == [IFS, GFS]
    assert sorted(default_pairs["lead_days"].unique()) == [0, 1, 2, 3]
    assert sorted(default_pairs["hour_utc"].unique()) == list(range(24))  # includes hours outside the modelled 2-15
    assert default_pairs["summer"].unique().to_list() == [2024]
    days = {(d.month, d.day) for d in default_pairs["valid_time"].dt.date().unique()}
    assert len(days) == 60
    assert {(5, 15), (6, 13), (9, 1), (9, 30)} <= days  # the first week and the whole September window exist
    assert (7, 15) not in days
    assert (*range(1, 31), *range(110, 140)) == SUMMER_DAYS
    for station in STATIONS:
        assert set(default_pairs.filter(pl.col("station") == station.icao)["cluster"]) == {station.cluster}


def test_default_rows_are_one_per_key_and_sorted_like_the_gold_dataset(default_pairs: pl.DataFrame) -> None:
    keys = ["station", "model", "valid_time", "lead_days"]
    assert default_pairs.select(keys).is_duplicated().sum() == 0
    assert default_pairs.equals(default_pairs.sort("model", "station", "valid_time", "lead_days"))


def test_valid_times_are_utc_aware_hours_on_the_summer_window(default_pairs: pl.DataFrame) -> None:
    assert default_pairs.schema["valid_time"] == pl.Datetime("us", "UTC")
    times = default_pairs["valid_time"]
    assert times.min() == datetime(2024, 5, 15, 0, tzinfo=UTC)
    assert times.max() == datetime(2024, 9, 30, 23, tzinfo=UTC)
    assert (times.dt.minute() == 0).all()


def test_the_calendar_columns_follow_the_gold_dataset_semantics(default_pairs: pl.DataFrame) -> None:
    times = default_pairs["valid_time"]
    assert default_pairs["summer"].to_list() == times.dt.year().to_list()
    assert default_pairs["hour_utc"].to_list() == times.dt.hour().to_list()
    assert default_pairs["doy"].to_list() == times.dt.ordinal_day().to_list()
    expected_daytime = [is_working_daytime(h) for h in default_pairs["hour_utc"].to_list()]
    assert default_pairs["is_daytime"].to_list() == expected_daytime
    joint = pl.all_horizontal(pl.col(c).is_not_null() for c in ("obs_t_c", "obs_td_c", "obs_wind_ms")).alias("joint")
    assert default_pairs["has_joint_obs"].to_list() == default_pairs.select(joint)["joint"].to_list()


# === truth and forecasts ============================================================================================


def test_truth_is_one_value_per_station_hour_across_leads_and_models(default_pairs: pl.DataFrame) -> None:
    columns = ["obs_t_c", "obs_td_c", "obs_wind_ms", "wbgt_obs_c", "wbgt_obs_reject", "has_joint_obs"]
    distinct = default_pairs.group_by("station", "valid_time").agg(
        *(pl.col(c).n_unique().alias(c) for c in columns[:-2]),
        pl.col("wbgt_obs_reject").n_unique().alias("wbgt_obs_reject"),
        pl.col("has_joint_obs").n_unique().alias("has_joint_obs"),
    )
    assert distinct.select(columns).max().row(0) == (1, 1, 1, 1, 1, 1)


def test_the_error_spread_grows_with_lead() -> None:
    pairs = make_pairs(seed=4, summers=(2024,), station_bias_c={}, stations=("OMAA", "OMDB"), leads=range(8))
    rmse = {}
    for model in (IFS, GFS):
        scored = pairs.filter((pl.col("model") == model) & pl.col("obs_t_c").is_not_null())
        by_lead = scored.group_by("lead_days").agg(
            ((pl.col("fc_t_c") - pl.col("obs_t_c")) ** 2).mean().sqrt().alias("rmse")
        )
        rmse[model] = by_lead.sort("lead_days")["rmse"].to_list()
        assert all(a < b for a, b in zip(rmse[model], rmse[model][1:], strict=False)), rmse[model]
    assert all(g > i for g, i in zip(rmse[GFS], rmse[IFS], strict=True))  # GFS is the noisier model


def test_forecast_values_are_physically_coherent(default_pairs: pl.DataFrame) -> None:
    night = default_pairs.filter(pl.col("hour_utc").is_in([18, 19, 20, 21, 22, 23, 0, 1]))
    assert (night["fc_sw_wm2"] == 0.0).all()
    assert (night["fc_direct_wm2"] == 0.0).all()
    assert (night["ref_sw_wm2"] == 0.0).all()
    assert (default_pairs["fc_direct_wm2"] <= default_pairs["fc_sw_wm2"]).all()
    noon = default_pairs.filter(pl.col("hour_utc").is_in([8, 9, 10]))
    assert (noon["fc_sw_wm2"] > 100.0).all()
    # diurnal cycle: the afternoon is warmer than the early morning, in every station
    hourly = (
        default_pairs.filter(pl.col("model") == IFS).group_by("hour_utc").agg(pl.col("obs_t_c").mean()).sort("hour_utc")
    )
    mean_by_hour = dict(zip(hourly["hour_utc"], hourly["obs_t_c"], strict=True))
    assert mean_by_hour[10] > mean_by_hour[1] + 4.0
    assert default_pairs["fc_t_c"].is_between(5.0, 60.0).all()
    assert (default_pairs["fc_td_c"] <= default_pairs["fc_t_c"]).all()
    assert (default_pairs["fc_wind_ms"] >= 0.0).all()
    assert default_pairs["fc_pressure_hpa"].is_between(900.0, 1100.0).all()


def test_wbgt_is_finite_by_day_and_reject_codes_are_consistent(default_pairs: pl.DataFrame) -> None:
    day = default_pairs.filter(pl.col("is_daytime"))
    assert day["wbgt_fc_c"].is_finite().all()
    assert (day["wbgt_fc_reject"] == 0).all()
    assert day["wbgt_fc_refrad_c"].is_finite().all()
    for value, reject in (
        ("wbgt_obs_c", "wbgt_obs_reject"),
        ("wbgt_fc_c", "wbgt_fc_reject"),
        ("wbgt_fc_refrad_c", "wbgt_fc_refrad_reject"),
    ):
        frame = default_pairs
        accepted = frame.filter(pl.col(reject) == 0)
        assert accepted[value].is_finite().all()
        rejected = frame.filter(pl.col(reject) != 0)
        assert rejected[value].is_nan().all()  # NaN, never null: as in the real gold file
        assert rejected[value].null_count() == 0
    assert default_pairs.filter(pl.col("wbgt_fc_c").is_finite())["wbgt_fc_c"].is_between(15.0, 50.0).all()


def test_lead_zero_rows_exist_and_carry_the_reference_values(default_pairs: pl.DataFrame) -> None:
    lead0 = default_pairs.filter((pl.col("lead_days") == 0) & (pl.col("model") == IFS))
    assert lead0.height > 0
    assert lead0["ref_sw_wm2"].to_list() == lead0["fc_sw_wm2"].to_list()
    assert lead0["ref_pressure_hpa"].to_list() == lead0["fc_pressure_hpa"].to_list()
    assert lead0["ref_direct_wm2"].to_list() == lead0["fc_direct_wm2"].to_list()
    # the reference is IFS lead-0 whatever the row's own model and lead
    reference = lead0.select("station", "valid_time", pl.col("fc_sw_wm2").alias("expected"))
    joined = default_pairs.join(reference, on=["station", "valid_time"], how="left", validate="m:1")
    assert joined["ref_sw_wm2"].to_list() == joined["expected"].to_list()
    assert default_pairs["ref_sw_wm2"].null_count() == 0


def test_reference_is_null_when_no_lead_zero_is_generated() -> None:
    pairs = tiny(leads=(1, 2))
    assert pairs["ref_sw_wm2"].null_count() == pairs.height
    assert pairs["wbgt_obs_reject"].unique().to_list() == [1]  # NONFINITE_INPUT: the truth WBGT needs the reference


# === knobs ==========================================================================================================


def test_subsets_equal_the_filtered_full_frame() -> None:
    full = make_pairs(seed=5, summers=(2024, 2025), station_bias_c={"OMDB": 1.0}, stations=("OMAA", "OMDB", "OMFJ"))
    subset = make_pairs(
        seed=5,
        summers=(2025,),
        station_bias_c={"OMDB": 1.0},
        stations=("OMDB", "OMFJ"),
        leads=(0, 2),
        hours_utc=[3, 9, 15],
        summer_days=[2, 111, 139],
    )
    day_of_summer = (pl.col("valid_time").dt.date() - pl.lit(date(2025, 5, 15))).dt.total_days() + 1
    expected = full.filter(
        (pl.col("summer") == 2025)
        & pl.col("station").is_in(["OMDB", "OMFJ"])
        & pl.col("lead_days").is_in([0, 2])
        & pl.col("hour_utc").is_in([3, 9, 15])
        & day_of_summer.is_in([2, 111, 139])
    )
    assert subset.height > 0
    assert_frame_equal(subset, expected)


def test_stations_leads_hours_and_days_knobs_select_exactly_what_they_name() -> None:
    pairs = tiny(stations=("OMDB", "OMRK"), leads=(0, 3), hours_utc=[2, 15], summer_days=[1, 139])
    assert sorted(pairs["station"].unique()) == ["OMDB", "OMRK"]
    assert sorted(pairs["lead_days"].unique()) == [0, 3]
    assert sorted(pairs["hour_utc"].unique()) == [2, 15]
    assert sorted(set(pairs["valid_time"].dt.date().unique())) == [date(2024, 5, 15), date(2024, 9, 30)]
    assert pairs.height == 2 * 2 * 2 * 2 * 2  # stations x leads x hours x days x models


def test_several_summers_are_stacked() -> None:
    pairs = tiny(summers=(2024, 2025, 2026))
    assert sorted(pairs["summer"].unique()) == [2024, 2025, 2026]
    assert pairs.height == 3 * 2 * 2 * 2


def test_missing_obs_rate_gives_null_truth_and_no_joint_obs() -> None:
    full = make_pairs(seed=3, summers=(2024,), station_bias_c={}, stations=("OMAA", "OMDB"), missing_obs_rate=0.0)
    some = make_pairs(seed=3, summers=(2024,), station_bias_c={}, stations=("OMAA", "OMDB"), missing_obs_rate=0.02)
    assert full["has_joint_obs"].all()
    assert full["obs_t_c"].null_count() == 0
    missing = some.filter(~pl.col("has_joint_obs"))
    share = missing.height / some.height
    assert 0.005 < share < 0.05
    assert missing["obs_t_c"].null_count() == missing.height
    assert missing["obs_td_c"].null_count() == missing.height
    assert missing["obs_wind_ms"].null_count() == missing.height
    assert (missing["wbgt_obs_reject"] != 0).all()
    assert missing["wbgt_obs_c"].is_nan().all()
    # the same forecasts regardless of the truth that is missing
    assert some.select("fc_t_c", "fc_td_c").equals(full.select("fc_t_c", "fc_td_c"))


def test_the_truth_is_missing_for_every_model_and_lead_of_that_hour() -> None:
    some = make_pairs(seed=3, summers=(2024,), station_bias_c={}, stations=("OMAA",), missing_obs_rate=0.1)
    per_hour = some.group_by("station", "valid_time").agg(pl.col("has_joint_obs").n_unique())
    assert per_hour["has_joint_obs"].max() == 1
    assert (~some["has_joint_obs"]).any()


def test_reject_rate_gives_nan_wbgt_obs_with_a_reject_code_where_the_truth_exists() -> None:
    clean = make_pairs(seed=3, summers=(2024,), station_bias_c={}, stations=("OMAA", "OMDB"), reject_rate=0.0)
    noisy = make_pairs(seed=3, summers=(2024,), station_bias_c={}, stations=("OMAA", "OMDB"), reject_rate=0.05)
    assert (clean.filter(pl.col("has_joint_obs"))["wbgt_obs_reject"] == 0).all()
    rejected = noisy.filter(pl.col("has_joint_obs") & (pl.col("wbgt_obs_reject") != 0))
    assert 0.02 < rejected.height / noisy.height < 0.09
    assert rejected["wbgt_obs_c"].is_nan().all()
    assert rejected["wbgt_obs_c"].null_count() == 0
    assert set(rejected["wbgt_obs_reject"].unique().to_list()) <= {2, 3, 4}
    assert rejected["obs_t_c"].null_count() == 0  # the temperature truth is still there: only the WBGT was rejected
    assert noisy.select("fc_t_c", "obs_t_c").equals(clean.select("fc_t_c", "obs_t_c"))


def test_gfs_missing_rate_removes_gfs_rows_only() -> None:
    kept = make_pairs(seed=3, summers=(2024,), station_bias_c={}, stations=("OMAA",), gfs_missing_rate=0.0)
    some = make_pairs(seed=3, summers=(2024,), station_bias_c={}, stations=("OMAA",), gfs_missing_rate=0.05)

    def count(frame: pl.DataFrame, model: str) -> int:
        return frame.filter(pl.col("model") == model).height

    assert count(some, IFS) == count(kept, IFS)
    assert 0.02 < 1 - count(some, GFS) / count(kept, GFS) < 0.09
    assert some.filter(pl.col("model") == IFS).equals(kept.filter(pl.col("model") == IFS))


def test_a_rate_of_one_removes_everything_it_governs() -> None:
    pairs = tiny(gfs_missing_rate=1.0, missing_obs_rate=1.0)
    assert set(pairs["model"]) == {IFS}
    assert not pairs["has_joint_obs"].any()


@pytest.mark.parametrize(
    ("knobs", "message"),
    [
        ({"summers": ()}, "summers"),
        ({"stations": ("OMXX",)}, "station"),
        ({"stations": ()}, "stations"),
        ({"station_bias_c": {"OMXX": 1.0}}, "OMXX"),
        ({"td_bias_c": {"OMXX": 1.0}}, "OMXX"),
        ({"wind_bias_ms": {"OMXX": 1.0}}, "OMXX"),
        ({"leads": (8,)}, "lead"),
        ({"leads": ()}, "lead"),
        ({"hours_utc": [24]}, "hour"),
        ({"hours_utc": []}, "hour"),
        ({"summer_days": [0]}, "summer_days"),
        ({"summer_days": [140]}, "summer_days"),
        ({"missing_obs_rate": 1.5}, "missing_obs_rate"),
        ({"reject_rate": -0.1}, "reject_rate"),
        ({"gfs_missing_rate": 2.0}, "gfs_missing_rate"),
    ],
)
def test_invalid_arguments_are_rejected(knobs: dict[str, object], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        tiny(**knobs)


# === helpers ========================================================================================================


def test_forecasts_of_returns_the_model_rows_in_the_forecast_schema(default_pairs: pl.DataFrame) -> None:
    ifs = forecasts_of(default_pairs, IFS)
    assert ifs.schema == FORECAST_SCHEMA
    assert ifs.height == default_pairs.filter(pl.col("model") == IFS).height
    assert set(ifs["model"]) == {IFS}
    assert ifs["t_c"].to_list() == default_pairs.filter(pl.col("model") == IFS)["fc_t_c"].to_list()


def test_observations_of_returns_one_row_per_station_hour_with_truth(default_pairs: pl.DataFrame) -> None:
    obs = observations_of(default_pairs)
    assert obs.schema == OBS_HOURLY_SCHEMA
    expected = default_pairs.filter(pl.col("has_joint_obs")).select("station", "valid_time").unique()
    assert obs.height == expected.height
    assert obs.select("station", "valid_time").is_duplicated().sum() == 0
    assert obs["t_c"].null_count() == 0
    assert set(obs["source"]) == {"iem"}
    values = obs.join(
        default_pairs.filter((pl.col("model") == IFS) & (pl.col("lead_days") == 0)), on=["station", "valid_time"]
    )
    assert values["t_c"].to_list() == values["obs_t_c"].to_list()
