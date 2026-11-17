import math
from datetime import UTC, datetime, timedelta
from typing import Any

import polars as pl
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from stellar_blaze.domain.weather.binning import PLAUSIBLE, BinningReport, bin_to_nearest_hour
from stellar_blaze.domain.weather.models import QcPolicy
from stellar_blaze.domain.weather.schemas import OBS_HOURLY_SCHEMA, OBS_RAW_SCHEMA, SchemaMismatchError

pytestmark = pytest.mark.unit

VARIABLES = ("t_c", "td_c", "wind_ms")
QC_COLUMNS = {"t_c": "qc_t", "td_c": "qc_td", "wind_ms": "qc_wind"}


def at(hour: int, minute: int = 0, second: int = 0, *, day: int = 1) -> datetime:
    return datetime(2026, 6, day, hour, minute, second, tzinfo=UTC)


def report(
    when: datetime,
    *,
    t: float | None = None,
    td: float | None = None,
    wind: float | None = None,
    qc_t: str | None = None,
    qc_td: str | None = None,
    qc_wind: str | None = None,
    station: str = "OMDB",
    source: str = "iem",
) -> dict[str, Any]:
    return {
        "station": station,
        "obs_time": when,
        "t_c": t,
        "td_c": td,
        "wind_ms": wind,
        "qc_t": qc_t,
        "qc_td": qc_td,
        "qc_wind": qc_wind,
        "source": source,
    }


def frame(*reports: dict[str, Any]) -> pl.DataFrame:
    return pl.DataFrame(list(reports), schema=OBS_RAW_SCHEMA)


def by_hour(df: pl.DataFrame, column: str, station: str = "OMDB") -> dict[datetime, float | None]:
    rows = df.filter(pl.col("station") == station)
    return dict(zip(rows["valid_time"].to_list(), rows[column].to_list(), strict=True))


def test_binning_closest_report_wins() -> None:
    out, _ = bin_to_nearest_hour(frame(report(at(0, 50), t=30.0), report(at(1, 0), t=31.0)), qc_policy=QcPolicy.NONE)
    assert by_hour(out, "t_c") == {at(1): 31.0}


def test_binning_equal_distance_picks_the_earlier_report() -> None:
    out, _ = bin_to_nearest_hour(frame(report(at(0, 50), t=30.0), report(at(1, 10), t=32.0)), qc_policy=QcPolicy.NONE)
    assert by_hour(out, "t_c") == {at(1): 30.0}


def test_binning_equal_distance_picks_the_earlier_report_whatever_the_input_order() -> None:
    out, _ = bin_to_nearest_hour(frame(report(at(1, 10), t=32.0), report(at(0, 50), t=30.0)), qc_policy=QcPolicy.NONE)
    assert by_hour(out, "t_c") == {at(1): 30.0}


@pytest.mark.parametrize(
    ("reported", "binned"),
    [
        (at(0, 30), at(0)),
        (at(1, 30), at(2)),
        (at(2, 30), at(2)),
        (at(3, 30), at(4)),
        (at(23, 30), at(0, day=2)),
        (at(1, 29, 59), at(1)),
        (at(1, 30, 1), at(2)),
        (at(2, 29, 59), at(2)),
        (at(2, 30, 1), at(3)),
    ],
)
def test_binning_half_hour_tie_goes_to_even_hour(reported: datetime, binned: datetime) -> None:
    out, _ = bin_to_nearest_hour(frame(report(reported, t=30.0)), qc_policy=QcPolicy.NONE)
    assert list(by_hour(out, "t_c")) == [binned]


def test_binning_duplicate_timestamps_keep_input_order() -> None:
    first_listed = bin_to_nearest_hour(
        frame(report(at(1, 0), t=30.0), report(at(1, 0), t=33.0)), qc_policy=QcPolicy.NONE
    )[0]
    swapped = bin_to_nearest_hour(frame(report(at(1, 0), t=33.0), report(at(1, 0), t=30.0)), qc_policy=QcPolicy.NONE)[0]
    assert by_hour(first_listed, "t_c") == {at(1): 30.0}
    assert by_hour(swapped, "t_c") == {at(1): 33.0}


def test_binning_duplicate_timestamps_off_the_hour_keep_input_order() -> None:
    out, _ = bin_to_nearest_hour(frame(report(at(0, 55), t=30.0), report(at(0, 55), t=33.0)), qc_policy=QcPolicy.NONE)
    assert by_hour(out, "t_c") == {at(1): 30.0}


def test_binning_per_variable_independence() -> None:
    out, _ = bin_to_nearest_hour(frame(report(at(1, 0), t=31.0), report(at(0, 50), td=20.0)), qc_policy=QcPolicy.NONE)
    assert by_hour(out, "t_c") == {at(1): 31.0}
    assert by_hour(out, "td_c") == {at(1): 20.0}


def test_binning_a_closer_report_with_a_null_value_does_not_hide_a_farther_one() -> None:
    out, _ = bin_to_nearest_hour(
        frame(report(at(1, 0), td=20.0), report(at(0, 50), t=30.0, td=19.0)), qc_policy=QcPolicy.NONE
    )
    assert by_hour(out, "t_c") == {at(1): 30.0}
    assert by_hour(out, "td_c") == {at(1): 20.0}


def test_binning_drops_implausible_and_counts() -> None:
    out, rep = bin_to_nearest_hour(frame(report(at(1, 0), t=61.0, td=20.0, wind=3.0)), qc_policy=QcPolicy.NONE)
    assert by_hour(out, "t_c") == {at(1): None}
    assert by_hour(out, "td_c") == {at(1): 20.0}
    assert rep.n_implausible == {"t_c": 1, "td_c": 0, "wind_ms": 0}


def test_binning_falls_back_to_a_farther_plausible_report() -> None:
    out, rep = bin_to_nearest_hour(frame(report(at(1, 0), t=61.0), report(at(0, 45), t=30.0)), qc_policy=QcPolicy.NONE)
    assert by_hour(out, "t_c") == {at(1): 30.0}
    assert rep.n_implausible["t_c"] == 1


def test_plausibility_ranges_are_the_adr_0005_ranges() -> None:
    assert PLAUSIBLE == {"t_c": (-10.0, 60.0), "td_c": (-30.0, 40.0), "wind_ms": (0.0, 60.0)}


@pytest.mark.parametrize(
    ("variable", "value", "kept"),
    [
        ("t_c", -10.0, True),
        ("t_c", -10.1, False),
        ("t_c", 60.0, True),
        ("t_c", 60.1, False),
        ("td_c", -30.0, True),
        ("td_c", -30.1, False),
        ("td_c", 40.0, True),
        ("td_c", 40.1, False),
        ("wind_ms", 0.0, True),
        ("wind_ms", -0.1, False),
        ("wind_ms", 60.0, True),
        ("wind_ms", 60.1, False),
        ("t_c", math.nan, False),
        ("t_c", math.inf, False),
    ],
)
def test_plausibility_bounds_are_inclusive_and_non_finite_values_are_implausible(
    variable: str, value: float, kept: bool
) -> None:
    raw = {"t_c": None, "td_c": None, "wind_ms": None} | {variable: value}
    out, rep = bin_to_nearest_hour(
        frame(report(at(1), t=raw["t_c"], td=raw["td_c"], wind=raw["wind_ms"])), qc_policy=QcPolicy.NONE
    )
    assert out.height == (1 if kept else 0)
    assert rep.n_implausible[variable] == (0 if kept else 1)


def test_missing_values_are_not_counted_as_implausible() -> None:
    _, rep = bin_to_nearest_hour(frame(report(at(1), t=30.0)), qc_policy=QcPolicy.GHCNH_LENIENT)
    assert rep.n_implausible == {"t_c": 0, "td_c": 0, "wind_ms": 0}
    assert rep.n_qc_flagged == {"t_c": 0, "td_c": 0, "wind_ms": 0}


def test_ghcnh_lenient_keeps_blank_qc_and_counts_flags() -> None:
    out, rep = bin_to_nearest_hour(
        frame(
            report(at(1), t=30.0, td=20.0, qc_t=None, qc_td="2"),
            report(at(2), t=31.0, td=21.0, qc_t="1", qc_td="1"),
        ),
        qc_policy=QcPolicy.GHCNH_LENIENT,
    )
    assert by_hour(out, "t_c") == {at(1): 30.0, at(2): 31.0}
    assert by_hour(out, "td_c") == {at(1): None, at(2): 21.0}
    assert rep.n_qc_flagged == {"t_c": 0, "td_c": 1, "wind_ms": 0}


def test_ghcnh_lenient_judges_each_variable_by_its_own_qc_code() -> None:
    out, rep = bin_to_nearest_hour(
        frame(report(at(1), t=30.0, td=20.0, wind=3.0, qc_t="5", qc_td="1", qc_wind=None)),
        qc_policy=QcPolicy.GHCNH_LENIENT,
    )
    assert by_hour(out, "t_c") == {at(1): None}
    assert by_hour(out, "td_c") == {at(1): 20.0}
    assert by_hour(out, "wind_ms") == {at(1): 3.0}
    assert rep.n_qc_flagged == {"t_c": 1, "td_c": 0, "wind_ms": 0}


def test_ghcnh_lenient_falls_back_to_a_farther_unflagged_report() -> None:
    out, _ = bin_to_nearest_hour(
        frame(report(at(1, 0), t=47.7, qc_t="3"), report(at(0, 40), t=30.0, qc_t="1")),
        qc_policy=QcPolicy.GHCNH_LENIENT,
    )
    assert by_hour(out, "t_c") == {at(1): 30.0}


def test_a_value_that_is_implausible_and_flagged_is_counted_once_as_implausible() -> None:
    _, rep = bin_to_nearest_hour(frame(report(at(1), t=99.0, qc_t="3")), qc_policy=QcPolicy.GHCNH_LENIENT)
    assert rep.n_implausible["t_c"] == 1
    assert rep.n_qc_flagged["t_c"] == 0


def test_qc_policy_none_ignores_qc_codes() -> None:
    out, rep = bin_to_nearest_hour(
        frame(report(at(1), t=30.0, td=20.0, wind=3.0, qc_t="2", qc_td="9", qc_wind="X")),
        qc_policy=QcPolicy.NONE,
    )
    assert out.row(0, named=True) == {
        "station": "OMDB",
        "valid_time": at(1),
        "t_c": 30.0,
        "td_c": 20.0,
        "wind_ms": 3.0,
        "source": "iem",
    }
    assert rep.n_qc_flagged == {"t_c": 0, "td_c": 0, "wind_ms": 0}


def test_report_counts_every_raw_row_and_is_frozen() -> None:
    _, rep = bin_to_nearest_hour(
        frame(report(at(1), t=30.0), report(at(1, 5), t=99.0), report(at(1, 10))), qc_policy=QcPolicy.NONE
    )
    assert isinstance(rep, BinningReport)
    assert rep.n_raw == 3
    with pytest.raises(AttributeError):
        rep.n_raw = 4  # type: ignore[misc]


def test_bins_without_any_valid_variable_are_not_emitted() -> None:
    out, rep = bin_to_nearest_hour(frame(report(at(1), t=99.0), report(at(2), t=30.0)), qc_policy=QcPolicy.NONE)
    assert out["valid_time"].to_list() == [at(2)]
    assert rep.n_raw == 2


def test_stations_and_sources_are_binned_separately() -> None:
    out, _ = bin_to_nearest_hour(
        frame(
            report(at(1), t=30.0, station="OMDB"),
            report(at(1), t=35.0, station="OMAL"),
            report(at(1), t=31.0, station="OMDB", source="ghcnh"),
        ),
        qc_policy=QcPolicy.NONE,
    )
    assert out.select("station", "source", "t_c").rows() == [
        ("OMAL", "iem", 35.0),
        ("OMDB", "ghcnh", 31.0),
        ("OMDB", "iem", 30.0),
    ]


def test_output_conforms_to_the_hourly_schema_and_is_sorted() -> None:
    out, _ = bin_to_nearest_hour(
        frame(report(at(3), t=30.0), report(at(1), t=29.0), report(at(2), t=28.0, station="OMAA")),
        qc_policy=QcPolicy.NONE,
    )
    assert out.schema == OBS_HOURLY_SCHEMA
    assert out.select("station", "valid_time").rows() == [("OMAA", at(2)), ("OMDB", at(1)), ("OMDB", at(3))]


def test_empty_input_gives_an_empty_typed_frame_and_a_zero_report() -> None:
    out, rep = bin_to_nearest_hour(pl.DataFrame(schema=OBS_RAW_SCHEMA), qc_policy=QcPolicy.GHCNH_LENIENT)
    assert out.height == 0
    assert out.schema == OBS_HOURLY_SCHEMA
    assert rep == BinningReport(
        n_raw=0,
        n_implausible={"t_c": 0, "td_c": 0, "wind_ms": 0},
        n_qc_flagged={"t_c": 0, "td_c": 0, "wind_ms": 0},
    )


def test_input_that_does_not_match_the_raw_schema_is_rejected() -> None:
    with pytest.raises(SchemaMismatchError, match="'qc_wind'"):
        bin_to_nearest_hour(frame(report(at(1), t=30.0)).drop("qc_wind"), qc_policy=QcPolicy.NONE)


@pytest.mark.parametrize("column", ["station", "obs_time", "source"])
def test_a_null_key_column_is_a_contract_violation(column: str) -> None:
    raw = frame(report(at(1), t=30.0)).with_columns(pl.lit(None, dtype=OBS_RAW_SCHEMA[column]).alias(column))
    with pytest.raises(ValueError, match=f"'{column}'"):
        bin_to_nearest_hour(raw, qc_policy=QcPolicy.NONE)


def reference_bin(
    reports: list[dict[str, Any]], policy: QcPolicy
) -> tuple[dict[tuple[str, str, datetime], dict[str, float]], dict[str, int], dict[str, int]]:
    """Straight-line restatement of the four rules, one report at a time, with no Polars."""
    implausible = dict.fromkeys(VARIABLES, 0)
    flagged = dict.fromkeys(VARIABLES, 0)
    best: dict[tuple[str, str, datetime, str], tuple[timedelta, datetime, int, float]] = {}
    for index, rep in enumerate(reports):
        floor = rep["obs_time"].replace(minute=0, second=0, microsecond=0)
        past = rep["obs_time"] - floor
        half = timedelta(minutes=30)
        up = past > half or (past == half and floor.hour % 2 == 1)
        hour = floor + timedelta(hours=1) if up else floor
        distance = abs(rep["obs_time"] - hour)
        for name in VARIABLES:
            value = rep[name]
            if value is None:
                continue
            low, high = PLAUSIBLE[name]
            if not low <= value <= high:
                implausible[name] += 1
                continue
            code = rep[QC_COLUMNS[name]]
            if policy is QcPolicy.GHCNH_LENIENT and code not in (None, "1"):
                flagged[name] += 1
                continue
            key = (rep["station"], rep["source"], hour, name)
            candidate = (distance, rep["obs_time"], index, value)
            if key not in best or candidate[:3] < best[key][:3]:
                best[key] = candidate
    cells: dict[tuple[str, str, datetime], dict[str, float]] = {}
    for (station, source, hour, name), (_, _, _, value) in best.items():
        cells.setdefault((station, source, hour), {})[name] = value
    return cells, implausible, flagged


reports_strategy = st.lists(
    st.builds(
        report,
        st.builds(
            lambda minutes, seconds: at(0) + timedelta(minutes=minutes, seconds=seconds),
            st.integers(0, 5 * 60),
            st.sampled_from([0, 0, 0, 30]),
        ),
        t=st.one_of(st.none(), st.integers(-12, 62).map(float)),
        td=st.one_of(st.none(), st.integers(-32, 42).map(float)),
        wind=st.one_of(st.none(), st.integers(-2, 62).map(float)),
        qc_t=st.sampled_from([None, "1", "2"]),
        qc_td=st.sampled_from([None, "1", "5"]),
        qc_wind=st.sampled_from([None, "1", "3"]),
        station=st.sampled_from(["OMDB", "OMAL"]),
        source=st.sampled_from(["iem", "ghcnh"]),
    ),
    max_size=40,
)


@pytest.mark.parametrize("policy", list(QcPolicy))
@settings(max_examples=150, deadline=None, database=None, derandomize=True)
@given(reports=reports_strategy)
def test_binning_matches_the_reference_model(reports: list[dict[str, Any]], policy: QcPolicy) -> None:
    out, rep = bin_to_nearest_hour(frame(*reports), qc_policy=policy)
    cells, implausible, flagged = reference_bin(reports, policy)
    actual = {
        (row["station"], row["source"], row["valid_time"]): {k: row[k] for k in VARIABLES if row[k] is not None}
        for row in out.iter_rows(named=True)
    }
    assert actual == cells
    assert rep.n_raw == len(reports)
    assert rep.n_implausible == implausible
    assert rep.n_qc_flagged == flagged
