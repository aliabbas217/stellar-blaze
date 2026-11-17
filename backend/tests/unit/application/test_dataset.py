"""``build_pairs`` and ``summarize_pairs``: the gold dataset's joins, its WBGT columns and the research's aggregates."""

import math
from datetime import UTC, datetime
from typing import Any

import numpy as np
import polars as pl
import pytest

from stellar_blaze.application.dataset import build_pairs, summarize_pairs
from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.physics.wbgt import WbgtReject, wbgt_liljegren
from stellar_blaze.domain.weather.dataset import ObservationQc, RawError
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import GOLD_PAIRS_SCHEMA, OBS_HOURLY_SCHEMA, SchemaMismatchError
from stellar_blaze.domain.weather.stations import STATIONS, station
from tests.unit.application.support import MIDDAY, forecast_rows, gold_row, hourly_obs, hours_from

pytestmark = pytest.mark.unit

IFS, GFS = NwpModel.ECMWF_IFS025, NwpModel.GFS_SEAMLESS
NO_OBS = pl.DataFrame(schema=OBS_HOURLY_SCHEMA)


def pairs_from(rows: list[dict[str, Any]]) -> pl.DataFrame:
    return pl.DataFrame(rows, schema=GOLD_PAIRS_SCHEMA)


def row_of(pairs: pl.DataFrame, **keys: Any) -> dict[str, Any]:
    matching = pairs.filter(*(pl.col(name) == value for name, value in keys.items()))
    assert matching.height == 1, (keys, matching.height)
    return matching.row(0, named=True)


# === build_pairs: joins =============================================================================================


def two_stations_two_models() -> tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame]:
    """2 stations x 3 hours x leads 0-1, IFS and GFS; IEM misses one hour of OMDB and has a null wind in another."""
    hours = hours_from(MIDDAY, 3)
    frames = []
    for icao in ("OMAA", "OMDB"):
        for lead in (0, 1):
            frames.append(
                forecast_rows(icao, IFS, hours=hours, leads=[lead], sw_wm2=800.0 + 10 * lead, t_c=35.0 + lead)
            )
            frames.append(forecast_rows(icao, GFS, hours=hours, leads=[lead], sw_wm2=500.0, direct_wm2=300.0, t_c=33.0))
    forecasts = pl.concat(frames)
    iem = pl.concat(
        [
            hourly_obs("OMAA", hours),
            hourly_obs("OMDB", hours[:2]),  # OMDB has no report for the third hour
        ]
    ).with_columns(
        pl.when((pl.col("station") == "OMDB") & (pl.col("valid_time") == hours[1]))
        .then(None)
        .otherwise(pl.col("wind_ms"))
        .alias("wind_ms")
    )
    ghcnh = hourly_obs("OMAA", hours, source="ghcnh", t_c=36.5, td_c=14.5, wind_ms=3.5)
    return forecasts, iem, ghcnh


def test_build_pairs_joins_truth_audit_and_reference() -> None:
    forecasts, iem, ghcnh = two_stations_two_models()

    pairs = build_pairs(forecasts=forecasts, obs_iem=iem, obs_ghcnh=ghcnh)

    assert pairs.schema == GOLD_PAIRS_SCHEMA
    assert pairs.height == forecasts.height == 24  # one row per forecast row
    hours = hours_from(MIDDAY, 3)

    # The reference is IFS lead 0 at the same station and hour, whatever the row's own model and lead.
    for model, lead, own_sw in ((IFS, 0, 800.0), (IFS, 1, 810.0), (GFS, 0, 500.0), (GFS, 1, 500.0)):
        row = row_of(pairs, station="OMAA", model=model.value, lead_days=lead, valid_time=hours[0])
        assert row["fc_sw_wm2"] == own_sw
        assert row["ref_sw_wm2"] == 800.0
        assert row["ref_direct_wm2"] == 600.0
        assert row["ref_pressure_hpa"] == 1000.0

    # Truth is IEM, audit is GHCNh; an hour a source does not have is null.
    omaa = row_of(pairs, station="OMAA", model=IFS.value, lead_days=1, valid_time=hours[2])
    assert (omaa["obs_t_c"], omaa["obs_td_c"], omaa["obs_wind_ms"]) == (36.0, 14.0, 3.0)
    assert (omaa["audit_t_c"], omaa["audit_td_c"], omaa["audit_wind_ms"]) == (36.5, 14.5, 3.5)
    assert omaa["has_joint_obs"] is True
    omdb_missing_hour = row_of(pairs, station="OMDB", model=IFS.value, lead_days=1, valid_time=hours[2])
    assert omdb_missing_hour["obs_t_c"] is None
    assert omdb_missing_hour["audit_t_c"] is None  # GHCNh has no OMDB frame at all
    assert omdb_missing_hour["has_joint_obs"] is False

    # has_joint_obs is false where any one of the three is null.
    omdb_null_wind = row_of(pairs, station="OMDB", model=IFS.value, lead_days=1, valid_time=hours[1])
    assert omdb_null_wind["obs_t_c"] == 36.0
    assert omdb_null_wind["obs_wind_ms"] is None
    assert omdb_null_wind["has_joint_obs"] is False
    assert pairs.filter(pl.col("has_joint_obs"))["station"].value_counts().sort("station")["count"].to_list() == [
        3 * 4,  # OMAA: 3 hours x (2 models x 2 leads)
        1 * 4,  # OMDB: only the first hour is complete
    ]

    # Station attributes come from STATIONS.
    assert set(pairs.filter(pl.col("station") == "OMAA")["cluster"]) == {"abu_dhabi"}
    assert set(pairs.filter(pl.col("station") == "OMDB")["cluster"]) == {"dubai_sharjah"}
    assert set(pairs.filter(pl.col("station") == "OMDB")["station_elev_m"]) == {station("OMDB").elevation_m}

    # Keys.
    first = row_of(pairs, station="OMAA", model=IFS.value, lead_days=0, valid_time=hours[0])
    assert (first["summer"], first["hour_utc"], first["doy"]) == (2025, 10, 182)  # 2025-07-01 is day 182
    assert first["fc_t_c"] == 35.0
    assert (first["grid_lat"], first["grid_lon"], first["grid_elev_m"]) == (24.5, 54.75, 16.0)


def test_is_daytime_is_true_exactly_for_utc_hours_6_to_14() -> None:
    day = datetime(2025, 7, 1, tzinfo=UTC)
    forecasts = forecast_rows("OMAA", IFS, hours=hours_from(day, 24), leads=[0])

    pairs = build_pairs(forecasts=forecasts, obs_iem=NO_OBS, obs_ghcnh=NO_OBS)

    assert pairs.filter(pl.col("is_daytime"))["hour_utc"].to_list() == list(range(6, 15))
    assert pairs.filter(~pl.col("is_daytime")).height == 15
    assert pairs["is_daytime"].null_count() == 0


def test_build_pairs_is_deterministic_whatever_the_input_order() -> None:
    forecasts, iem, ghcnh = two_stations_two_models()

    expected = build_pairs(forecasts=forecasts, obs_iem=iem, obs_ghcnh=ghcnh)
    shuffled = build_pairs(
        forecasts=forecasts.sample(fraction=1.0, shuffle=True, seed=3),
        obs_iem=iem.sample(fraction=1.0, shuffle=True, seed=4),
        obs_ghcnh=ghcnh.sample(fraction=1.0, shuffle=True, seed=5),
    )

    assert shuffled.equals(expected)
    assert expected.equals(expected.sort("model", "station", "valid_time", "lead_days"))


def test_without_ifs_lead_0_the_reference_is_null() -> None:
    forecasts = forecast_rows("OMAA", GFS, hours=hours_from(MIDDAY, 2), leads=[0, 1])

    pairs = build_pairs(forecasts=forecasts, obs_iem=NO_OBS, obs_ghcnh=NO_OBS)

    for column in ("ref_sw_wm2", "ref_direct_wm2", "ref_pressure_hpa"):
        assert pairs[column].null_count() == pairs.height
    assert set(pairs["wbgt_obs_reject"]) == {int(WbgtReject.NONFINITE_INPUT)}  # no obs and no reference
    assert set(pairs["wbgt_fc_refrad_reject"]) == {int(WbgtReject.NONFINITE_INPUT)}
    assert set(pairs["wbgt_fc_reject"]) == {int(WbgtReject.OK)}  # the forecast's own radiation is enough


def test_nan_and_infinite_values_are_treated_as_missing() -> None:
    forecasts = forecast_rows("OMAA", IFS, hours=hours_from(MIDDAY, 2), leads=[0]).with_columns(
        pl.Series("t_c", [float("nan"), 35.0]), pl.Series("td_c", [12.0, float("inf")])
    )
    iem = hourly_obs("OMAA", hours_from(MIDDAY, 2)).with_columns(pl.Series("wind_ms", [float("nan"), 3.0]))

    pairs = build_pairs(forecasts=forecasts, obs_iem=iem, obs_ghcnh=NO_OBS)

    assert pairs["fc_t_c"].to_list() == [None, 35.0]
    assert pairs["fc_td_c"].to_list() == [12.0, None]
    assert pairs["obs_wind_ms"].to_list() == [None, 3.0]
    assert pairs["has_joint_obs"].to_list() == [False, True]


def test_build_pairs_refuses_what_would_corrupt_the_join() -> None:
    forecasts, iem, ghcnh = two_stations_two_models()

    with pytest.raises(ValueError, match="duplicate forecast rows"):
        build_pairs(forecasts=pl.concat([forecasts, forecasts.head(1)]), obs_iem=iem, obs_ghcnh=ghcnh)
    with pytest.raises(ValueError, match=r"duplicate.*iem"):
        build_pairs(forecasts=forecasts, obs_iem=pl.concat([iem, iem.head(1)]), obs_ghcnh=ghcnh)
    with pytest.raises(ValueError, match=r"duplicate.*ghcnh"):
        build_pairs(forecasts=forecasts, obs_iem=iem, obs_ghcnh=pl.concat([ghcnh, ghcnh.head(1)]))
    unknown = forecast_rows("KJFK", IFS, hours=hours_from(MIDDAY, 1), leads=[0])
    with pytest.raises(ValueError, match="KJFK"):
        build_pairs(forecasts=unknown, obs_iem=iem, obs_ghcnh=ghcnh)
    with pytest.raises(SchemaMismatchError, match="wrong dtypes"):
        build_pairs(forecasts=forecasts.with_columns(pl.col("lead_days").cast(pl.Int64)), obs_iem=iem, obs_ghcnh=ghcnh)
    with pytest.raises(SchemaMismatchError, match="missing columns"):
        build_pairs(forecasts=forecasts, obs_iem=iem.drop("wind_ms"), obs_ghcnh=ghcnh)


def test_build_pairs_of_nothing_is_an_empty_frame_with_the_schema() -> None:
    pairs = build_pairs(forecasts=forecast_rows("OMAA", IFS, hours=[], leads=[0]), obs_iem=NO_OBS, obs_ghcnh=NO_OBS)

    assert pairs.height == 0
    assert pairs.schema == GOLD_PAIRS_SCHEMA


# === build_pairs: WBGT ==============================================================================================


def direct_wbgt(
    row: dict[str, Any], t: str, td: str, wind: str, pressure: str, sw: str, direct: str
) -> tuple[float, int]:
    lat_lon = next(s for s in STATIONS if s.icao == row["station"])

    def as_array(name: str) -> F64:
        return np.array([row[name]], dtype=np.float64)

    result = wbgt_liljegren(
        t_c=as_array(t),
        td_c=as_array(td),
        wind10m_ms=as_array(wind),
        pressure_hpa=as_array(pressure),
        sw_wm2=as_array(sw),
        direct_wm2=as_array(direct),
        lat=lat_lon.lat,
        lon=lat_lon.lon,
        valid_time_utc=np.array([row["valid_time"].replace(tzinfo=None)], dtype="datetime64[us]"),
    )
    return float(result.wbgt_c[0]), int(result.reject[0])


def test_build_pairs_wbgt_columns() -> None:
    forecasts, iem, ghcnh = two_stations_two_models()

    pairs = build_pairs(forecasts=forecasts, obs_iem=iem, obs_ghcnh=ghcnh)

    row = row_of(pairs, station="OMAA", model=IFS.value, lead_days=1, valid_time=MIDDAY)
    expected_obs = direct_wbgt(
        row, "obs_t_c", "obs_td_c", "obs_wind_ms", "ref_pressure_hpa", "ref_sw_wm2", "ref_direct_wm2"
    )
    expected_fc = direct_wbgt(row, "fc_t_c", "fc_td_c", "fc_wind_ms", "fc_pressure_hpa", "fc_sw_wm2", "fc_direct_wm2")
    expected_refrad = direct_wbgt(
        row, "fc_t_c", "fc_td_c", "fc_wind_ms", "ref_pressure_hpa", "ref_sw_wm2", "ref_direct_wm2"
    )
    assert row["wbgt_obs_c"] == pytest.approx(expected_obs[0], abs=1e-9)
    assert row["wbgt_fc_c"] == pytest.approx(expected_fc[0], abs=1e-9)
    assert row["wbgt_fc_refrad_c"] == pytest.approx(expected_refrad[0], abs=1e-9)
    assert (row["wbgt_obs_reject"], row["wbgt_fc_reject"], row["wbgt_fc_refrad_reject"]) == (0, 0, 0)
    assert 20.0 < row["wbgt_obs_c"] < 45.0  # a real number, not a placeholder
    # The three variants differ because their inputs do: that is what the comparison isolates.
    assert len({row["wbgt_obs_c"], row["wbgt_fc_c"], row["wbgt_fc_refrad_c"]}) == 3


def test_every_row_has_the_wbgt_of_its_own_inputs() -> None:
    # The solver runs once per distinct set of inputs and the results are joined back: each row must still carry the
    # value of its own inputs, in every column, including the rows without observations or with a null wind.
    forecasts, iem, ghcnh = two_stations_two_models()

    pairs = build_pairs(forecasts=forecasts, obs_iem=iem, obs_ghcnh=ghcnh)

    variants = {
        "obs": ("obs_t_c", "obs_td_c", "obs_wind_ms", "ref_pressure_hpa", "ref_sw_wm2", "ref_direct_wm2"),
        "fc": ("fc_t_c", "fc_td_c", "fc_wind_ms", "fc_pressure_hpa", "fc_sw_wm2", "fc_direct_wm2"),
        "fc_refrad": ("fc_t_c", "fc_td_c", "fc_wind_ms", "ref_pressure_hpa", "ref_sw_wm2", "ref_direct_wm2"),
    }
    assert pairs.height == 24
    for row in pairs.iter_rows(named=True):
        for name, inputs in variants.items():
            expected_c, expected_reject = direct_wbgt(row, *inputs)
            got_c, got_reject = row[f"wbgt_{name}_c"], row[f"wbgt_{name}_reject"]
            assert got_reject == expected_reject, (name, row["station"], row["valid_time"], row["lead_days"])
            if math.isnan(expected_c):
                assert math.isnan(got_c), (name, row["station"], row["valid_time"], row["lead_days"])
            else:
                assert got_c == pytest.approx(expected_c, abs=1e-9), (name, row["station"], row["lead_days"])


def test_a_row_without_observations_has_nan_wbgt_obs_and_a_reason() -> None:
    forecasts, iem, ghcnh = two_stations_two_models()

    pairs = build_pairs(forecasts=forecasts, obs_iem=iem, obs_ghcnh=ghcnh)

    row = row_of(pairs, station="OMDB", model=IFS.value, lead_days=1, valid_time=hours_from(MIDDAY, 3)[2])
    assert row["obs_t_c"] is None
    assert math.isnan(row["wbgt_obs_c"])  # NaN, not null: it is numpy output, and the reject code carries the reason
    assert row["wbgt_obs_reject"] == WbgtReject.NONFINITE_INPUT
    assert not math.isnan(row["wbgt_fc_c"])  # the forecast variants do not need the observation
    assert row["wbgt_fc_reject"] == WbgtReject.OK
    assert pairs.schema["wbgt_obs_reject"] == pl.Int8


@pytest.mark.parametrize(
    ("column", "value", "fc_column", "refrad_affected"),
    [
        ("t_c", -999.0, "fc_t_c", True),
        ("t_c", 120.0, "fc_t_c", True),
        ("td_c", -300.0, "fc_td_c", True),
        ("pressure_hpa", 0.0, "fc_pressure_hpa", False),  # the same-radiation variant takes the reference pressure
        ("pressure_hpa", -5.0, "fc_pressure_hpa", False),
        ("wind_ms", -1.0, "fc_wind_ms", True),
    ],
)
def test_finite_sentinel_inputs_never_reach_the_solver_as_numbers(
    column: str, value: float, fc_column: str, refrad_affected: bool
) -> None:
    # A sentinel such as -999 is finite, so only a guard in front of the solver keeps numpy from warning (and the test
    # run, with warnings as errors, from failing); such a row is rejected as non-finite and its columns are kept.
    overrides: dict[str, float | None] = {column: value}
    forecasts = pl.concat(
        [
            forecast_rows("OMAA", IFS, hours=[MIDDAY], leads=[0]),  # a sound reference
            forecast_rows("OMAA", GFS, hours=[MIDDAY], leads=[0], **overrides),
        ]
    )

    pairs = build_pairs(forecasts=forecasts, obs_iem=hourly_obs("OMAA", [MIDDAY]), obs_ghcnh=NO_OBS)

    row = row_of(pairs, model=GFS.value)
    assert row[fc_column] == value  # the delivered value stays in the dataset, where the error statistics see it
    assert math.isnan(row["wbgt_fc_c"])
    assert row["wbgt_fc_reject"] == WbgtReject.NONFINITE_INPUT
    expected_refrad = WbgtReject.NONFINITE_INPUT if refrad_affected else WbgtReject.OK
    assert row["wbgt_fc_refrad_reject"] == expected_refrad
    assert row["wbgt_obs_reject"] == WbgtReject.OK  # the observation variant does not use the forecast's own values


# === summarize_pairs ================================================================================================


def hand_built() -> pl.DataFrame:
    """Four IFS 2025 lead-1 rows and one GFS 2025 lead-3 row whose counts and errors are computed by hand below."""
    return pairs_from(
        [
            # A: complete, working daytime
            gold_row(
                hour_offset=0, fc_t_c=35.0, fc_td_c=12.0, fc_wind_ms=4.0, obs_t_c=36.0, obs_td_c=14.0, obs_wind_ms=3.0
            ),
            # B: complete, 20:00 UTC (not daytime)
            gold_row(
                hour_offset=10,
                fc_t_c=38.0,
                fc_td_c=12.0,
                fc_wind_ms=4.0,
                obs_t_c=36.0,
                obs_td_c=10.0,
                obs_wind_ms=6.0,
                wbgt_obs_reject=int(WbgtReject.OUT_OF_BOUNDS),
            ),
            # C: no observed temperature, so has_joint_obs is false
            gold_row(
                hour_offset=1,
                fc_t_c=35.0,
                fc_td_c=12.0,
                fc_wind_ms=4.0,
                obs_t_c=None,
                obs_td_c=11.0,
                obs_wind_ms=4.0,
                has_joint_obs=False,
                wbgt_obs_reject=int(WbgtReject.NONFINITE_INPUT),
            ),
            # D: all observed, but no forecast wind: not joint although has_joint_obs is true
            gold_row(
                hour_offset=2,
                fc_t_c=34.0,
                fc_td_c=12.0,
                fc_wind_ms=None,
                obs_t_c=36.0,
                obs_td_c=13.0,
                obs_wind_ms=3.0,
                wbgt_fc_reject=int(WbgtReject.NONFINITE_INPUT),
            ),
            # E: another model and lead
            gold_row(
                hour_offset=0,
                model="gfs_seamless",
                lead_days=3,
                fc_t_c=30.0,
                fc_td_c=10.0,
                fc_wind_ms=2.0,
                obs_t_c=31.0,
                obs_td_c=10.0,
                obs_wind_ms=2.0,
            ),
        ]
    )


def assert_error(error: RawError, *, n: int, bias: float, mae: float, rmse: float) -> None:
    assert error.n == n
    assert error.bias == pytest.approx(bias, abs=1e-12)
    assert error.mae == pytest.approx(mae, abs=1e-12)
    assert error.rmse == pytest.approx(rmse, abs=1e-12)


def test_summarize_pairs_counts_and_mae() -> None:
    summary = summarize_pairs(hand_built())

    counts = {(c.model, c.summer, c.lead_days): (c.joint, c.joint_daytime) for c in summary.pair_counts}
    assert counts == {
        ("ecmwf_ifs025", 2025, 1): (2, 1),  # A and B; C lacks the observation, D the forecast wind; only A is daytime
        ("gfs_seamless", 2025, 3): (1, 1),
    }
    errors = {(e.model, e.summer, e.lead_days, e.var): e for e in summary.raw_errors}
    # forecast minus observation: A -1, B +2, D -2 (C has no observed temperature)
    assert_error(errors[("ecmwf_ifs025", 2025, 1, "t")], n=3, bias=-1 / 3, mae=5 / 3, rmse=math.sqrt(3))
    # A -2, B +2, C +1, D -1
    assert_error(errors[("ecmwf_ifs025", 2025, 1, "td")], n=4, bias=0.0, mae=1.5, rmse=math.sqrt(2.5))
    # A +1, B -2, C 0 (D has no forecast wind)
    assert_error(errors[("ecmwf_ifs025", 2025, 1, "ws")], n=3, bias=-1 / 3, mae=1.0, rmse=math.sqrt(5 / 3))
    assert_error(errors[("gfs_seamless", 2025, 3, "t")], n=1, bias=-1.0, mae=1.0, rmse=1.0)
    assert len(summary.raw_errors) == 6  # 2 groups x 3 variables


def test_summary_rows_are_sorted_with_the_research_variable_order() -> None:
    summary = summarize_pairs(hand_built())

    assert [(c.model, c.summer, c.lead_days) for c in summary.pair_counts] == [
        ("ecmwf_ifs025", 2025, 1),
        ("gfs_seamless", 2025, 3),
    ]
    assert [(e.model, e.lead_days, e.var) for e in summary.raw_errors] == [
        ("ecmwf_ifs025", 1, "t"),
        ("ecmwf_ifs025", 1, "td"),
        ("ecmwf_ifs025", 1, "ws"),
        ("gfs_seamless", 3, "t"),
        ("gfs_seamless", 3, "td"),
        ("gfs_seamless", 3, "ws"),
    ]


def test_a_group_with_no_pairs_of_a_variable_has_no_error_row_but_still_a_count() -> None:
    rows = [gold_row(fc_t_c=None, has_joint_obs=True)]

    summary = summarize_pairs(pairs_from(rows))

    assert [(c.joint, c.joint_daytime) for c in summary.pair_counts] == [(0, 0)]
    assert {e.var for e in summary.raw_errors} == {"td", "ws"}


def test_wbgt_rejects_are_counted_by_reason_name_for_each_column() -> None:
    summary = summarize_pairs(hand_built())

    assert set(summary.wbgt_rejects) == {"wbgt_obs_c", "wbgt_fc_c", "wbgt_fc_refrad_c"}
    expected_names = {reason.name for reason in WbgtReject}
    for counts in summary.wbgt_rejects.values():
        assert set(counts) == expected_names  # every reason is listed, zero included
        assert sum(counts.values()) == 5
    assert summary.wbgt_rejects["wbgt_obs_c"] == {
        "OK": 3,
        "NONFINITE_INPUT": 1,
        "INCOHERENT_RADIATION": 0,
        "NO_CONVERGENCE": 0,
        "OUT_OF_BOUNDS": 1,
    }
    assert summary.wbgt_rejects["wbgt_fc_c"]["NONFINITE_INPUT"] == 1
    assert summary.wbgt_rejects["wbgt_fc_refrad_c"]["OK"] == 5


def test_an_unknown_reject_code_is_an_error_not_a_silent_bucket() -> None:
    rows = [gold_row(wbgt_fc_reject=9)]

    with pytest.raises(ValueError, match="9"):
        summarize_pairs(pairs_from(rows))


def test_the_observation_qc_counts_are_carried_into_the_summary() -> None:
    qc = ObservationQc(
        source="ghcnh",
        station="OMAA",
        summer=2025,
        n_raw=10,
        n_implausible={"t_c": 0, "td_c": 0, "wind_ms": 0},
        n_qc_flagged={"t_c": 1, "td_c": 0, "wind_ms": 0},
    )

    assert summarize_pairs(hand_built()).observation_qc == []
    assert summarize_pairs(hand_built(), observation_qc=[qc]).observation_qc == [qc]


def test_summarize_pairs_of_nothing_is_an_empty_summary() -> None:
    summary = summarize_pairs(pl.DataFrame(schema=GOLD_PAIRS_SCHEMA))

    assert summary.pair_counts == []
    assert summary.raw_errors == []
    assert all(sum(counts.values()) == 0 for counts in summary.wbgt_rejects.values())


def test_summarize_pairs_refuses_a_frame_that_is_not_the_gold_schema() -> None:
    with pytest.raises(SchemaMismatchError):
        summarize_pairs(hand_built().drop("fc_t_c"))


def test_the_pooled_errors_equal_the_research_weighted_station_averages() -> None:
    # match_pairs.py computes bias, MAE and RMSE per station and pools them by n-weighted averages; the summary computes
    # them over all pairs at once. They are the same numbers; this is the check that the aggregation has not changed it.
    rng = np.random.default_rng(20261112)
    rows = []
    for icao, cluster in (("OMAA", "abu_dhabi"), ("OMDB", "dubai_sharjah"), ("OMFJ", "fujairah")):
        for hour in range(int(rng.integers(40, 80))):
            fc = rng.normal(35.0, 3.0, size=3).tolist()
            ob = rng.normal(35.0, 3.0, size=3).tolist()
            missing = [bool(rng.random() < 0.1) for _ in range(6)]
            rows.append(
                gold_row(
                    hour_offset=hour,
                    station=icao,
                    cluster=cluster,
                    fc_t_c=None if missing[0] else fc[0],
                    fc_td_c=None if missing[1] else fc[1],
                    fc_wind_ms=None if missing[2] else fc[2],
                    obs_t_c=None if missing[3] else ob[0],
                    obs_td_c=None if missing[4] else ob[1],
                    obs_wind_ms=None if missing[5] else ob[2],
                )
            )
    pairs = pairs_from(rows)

    summary = summarize_pairs(pairs)

    for var, fc_col, obs_col in (
        ("t", "fc_t_c", "obs_t_c"),
        ("td", "fc_td_c", "obs_td_c"),
        ("ws", "fc_wind_ms", "obs_wind_ms"),
    ):
        per_station = []
        for _, part in pairs.partition_by("station", as_dict=True).items():
            both = part.drop_nulls([fc_col, obs_col])
            e = (both[fc_col] - both[obs_col]).to_numpy()
            per_station.append((len(e), e.mean(), np.abs(e).mean(), float(np.sqrt((e**2).mean()))))
        n, bias, mae, rmse = (np.array(column) for column in zip(*per_station, strict=True))
        got = next(e for e in summary.raw_errors if e.var == var)
        assert got.n == n.sum()
        assert got.bias == pytest.approx(float(np.average(bias, weights=n)), abs=1e-12)
        assert got.mae == pytest.approx(float(np.average(mae, weights=n)), abs=1e-12)
        assert got.rmse == pytest.approx(float(np.sqrt(np.average(rmse**2, weights=n))), abs=1e-12)


def test_counts_are_kept_apart_per_summer() -> None:
    later = gold_row(valid_time=datetime(2026, 7, 1, 10, tzinfo=UTC), summer=2026)
    summary = summarize_pairs(pairs_from([gold_row(), later]))

    assert {(c.summer, c.joint) for c in summary.pair_counts} == {(2025, 1), (2026, 1)}
