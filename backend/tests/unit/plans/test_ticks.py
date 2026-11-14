import math
from datetime import UTC, date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

import numpy as np
import pytest

from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.plans.model import ZoneTimeline
from stellar_blaze.domain.plans.ticks import (
    TICK_MINUTES,
    day_ticks,
    fallback_timeline,
    hour_ban_weight,
    in_ban,
    interpolate_hourly,
    zone_timeline,
)
from stellar_blaze.domain.risk.levels import Zone, ZoneEdges
from stellar_blaze.domain.rules.ruleset import LabourRules
from tests.unit.risk.support import released_ruleset

pytestmark = pytest.mark.unit

DUBAI = ZoneInfo("Asia/Dubai")
EDGES = ZoneEdges(140.0, 115.0, 85.0)
_LABOUR = released_ruleset().labour
assert _LABOUR is not None
LABOUR: LabourRules = _LABOUR
NAN = float("nan")
DAY = date(2026, 7, 1)


def _t(stamp: str) -> np.datetime64:
    return np.datetime64(stamp, "us")


def _hourly_labels(first: int = 2, last: int = 15, day: str = "2026-07-01") -> np.ndarray:
    return np.array([f"{day}T{h:02d}:00" for h in range(first, last + 1)], dtype="datetime64[us]")


def _tick_index(stamp: str, day: str = "2026-07-01") -> int:
    ticks = day_ticks(date.fromisoformat(day), DUBAI)
    return int(np.flatnonzero(ticks == _t(stamp))[0])


def test_tick_minutes_is_five() -> None:
    assert TICK_MINUTES == 5


def test_tick_grid_dubai() -> None:
    ticks = day_ticks(DAY, DUBAI)
    assert ticks.shape == (216,)
    assert ticks.dtype == np.dtype("datetime64[us]")
    assert ticks[0] == _t("2026-07-01T00:00")  # 04:00 Asia/Dubai
    assert ticks[-1] == _t("2026-07-01T17:55")  # 21:55 Asia/Dubai, the last tick before 22:00
    assert (np.diff(ticks) == np.timedelta64(5, "m")).all()


def test_tick_grid_follows_the_zone_not_a_fixed_offset() -> None:
    madrid = day_ticks(DAY, ZoneInfo("Europe/Madrid"))  # UTC+2 in July
    assert madrid[0] == _t("2026-07-01T02:00")
    winter = day_ticks(date(2026, 1, 15), ZoneInfo("Europe/Madrid"))  # UTC+1
    assert winter[0] == _t("2026-01-15T03:00")


def _ban_stamps(local_date: date) -> list[str]:
    ticks = day_ticks(local_date, DUBAI)
    return [str(t)[11:16] for t in ticks[in_ban(ticks, local_date, DUBAI, LABOUR)]]


def test_ban_ticks_local() -> None:
    stamps = _ban_stamps(DAY)
    assert len(stamps) == 30  # 12:30-15:00 local is 30 five-minute ticks
    assert stamps[0] == "08:30"
    assert stamps[-1] == "10:55"  # 11:00Z is 15:00 local, exclusive
    assert _ban_stamps(date(2026, 6, 14)) == []
    assert _ban_stamps(date(2026, 9, 16)) == []
    assert len(_ban_stamps(date(2026, 6, 15))) == 30  # season is inclusive of both end dates
    assert len(_ban_stamps(date(2026, 9, 15))) == 30
    assert _ban_stamps(date(2026, 10, 1)) == []


def test_in_ban_returns_a_bool_array_of_the_same_length() -> None:
    ticks = day_ticks(DAY, DUBAI)
    out = in_ban(ticks, DAY, DUBAI, LABOUR)
    assert out.dtype == np.bool_
    assert out.shape == ticks.shape


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("2026-07-01T08:00", 0.5),  # [08:00, 09:00) Z holds 30 ban minutes (08:30-09:00)
        ("2026-07-01T09:00", 0.0),
        ("2026-07-01T10:00", 0.0),
        ("2026-07-01T07:00", 1.0),
        ("2026-07-01T11:00", 1.0),  # the ban ends at 11:00Z exclusive
        ("2026-05-20T08:00", 1.0),  # outside the season
        ("2026-06-14T09:00", 1.0),
        ("2026-06-15T09:00", 0.0),
        ("2026-09-15T09:00", 0.0),
        ("2026-09-16T09:00", 1.0),
    ],
)
def test_hour_ban_weight(label: str, expected: float) -> None:
    assert hour_ban_weight(_t(label), DUBAI, LABOUR) == pytest.approx(expected)


def test_hour_ban_weight_accepts_an_aware_datetime() -> None:
    assert hour_ban_weight(datetime(2026, 7, 1, 8, 0, tzinfo=UTC), DUBAI, LABOUR) == pytest.approx(0.5)


def test_interpolate_hourly_is_linear_between_labels() -> None:
    labels = _hourly_labels(2, 5)
    values = np.array([100.0, 160.0, 130.0, 130.0])
    ticks = np.array(
        ["2026-07-01T02:00", "2026-07-01T02:30", "2026-07-01T03:00", "2026-07-01T03:15"], dtype="datetime64[us]"
    )
    out = interpolate_hourly(labels, values, ticks)
    assert out.tolist() == pytest.approx([100.0, 130.0, 160.0, 160.0 - 7.5])


def test_interpolate_hourly_is_nan_outside_the_labelled_range() -> None:
    labels = _hourly_labels(2, 4)
    values = np.array([100.0, 110.0, 120.0])
    ticks = np.array(
        ["2026-07-01T01:55", "2026-07-01T02:00", "2026-07-01T04:00", "2026-07-01T04:05"], dtype="datetime64[us]"
    )
    out = interpolate_hourly(labels, values, ticks)
    assert math.isnan(out[0])
    assert out[1] == 100.0
    assert out[2] == 120.0  # exactly the last label is inside
    assert math.isnan(out[3])


def test_interpolate_hourly_is_nan_across_a_nan_label() -> None:
    labels = _hourly_labels(2, 5)
    values = np.array([100.0, NAN, 120.0, 130.0])
    ticks = np.array(
        [
            "2026-07-01T02:00",
            "2026-07-01T02:30",
            "2026-07-01T03:00",
            "2026-07-01T03:30",
            "2026-07-01T04:00",
            "2026-07-01T04:30",
        ],
        dtype="datetime64[us]",
    )
    out = interpolate_hourly(labels, values, ticks)
    assert out[0] == 100.0  # exactly on a finite label: its value, even if the next label is missing
    assert math.isnan(out[1])  # between a finite and a NaN label
    assert math.isnan(out[2])  # on the NaN label
    assert math.isnan(out[3])  # between the NaN label and a finite one
    assert out[4] == 120.0
    assert out[5] == pytest.approx(125.0)


def test_interpolate_hourly_single_label_and_validation() -> None:
    one = np.array(["2026-07-01T02:00"], dtype="datetime64[us]")
    out = interpolate_hourly(
        one, np.array([123.0]), np.array(["2026-07-01T02:00", "2026-07-01T02:05"], dtype="datetime64[us]")
    )
    assert out[0] == 123.0
    assert math.isnan(out[1])
    with pytest.raises(ValueError, match="increasing"):
        interpolate_hourly(_hourly_labels(2, 3)[::-1].copy(), np.array([1.0, 2.0]), one)
    with pytest.raises(ValueError, match="one value per label"):
        interpolate_hourly(_hourly_labels(2, 4), np.array([1.0, 2.0]), one)


def _timeline(
    twl: F64, *, hour_zones: list[Zone | int] | None = None, source: Literal["forecast", "truth"] = "forecast"
) -> ZoneTimeline:
    return zone_timeline(
        local_date=DAY,
        tz=DUBAI,
        labels_utc=_hourly_labels(),
        protective_twl_eff=twl,
        hour_level_zones=hour_zones,
        edges=EDGES,
        source=source,
    )


def test_zone_timeline_follows_the_interpolated_protective_twl() -> None:
    twl = np.full(14, 150.0)
    twl[6] = 130.0  # label 08Z
    timeline = _timeline(twl)
    assert len(timeline.zones) == len(timeline.fallback) == len(timeline.protective_twl_w_m2) == 216
    assert timeline.start_utc == datetime(2026, 7, 1, 0, 0, tzinfo=UTC)
    assert timeline.source == "forecast"
    assert timeline.zones[_tick_index("2026-07-01T07:00")] == Zone.LOW  # 150 interpolates down to 130 after 07:00
    assert timeline.zones[_tick_index("2026-07-01T07:55")] == Zone.MEDIUM  # 131.67
    assert timeline.zones[_tick_index("2026-07-01T08:00")] == Zone.MEDIUM
    assert timeline.protective_twl_w_m2[_tick_index("2026-07-01T08:00")] == 130.0
    assert timeline.protective_twl_w_m2[_tick_index("2026-07-01T07:30")] == pytest.approx(140.0)
    assert timeline.zones[_tick_index("2026-07-01T07:30")] == Zone.LOW  # exactly 140 is Low


def test_ticks_outside_the_labelled_hours_are_high_fallback() -> None:
    timeline = _timeline(np.full(14, 150.0))
    first, last = _tick_index("2026-07-01T02:00"), _tick_index("2026-07-01T15:00")
    outside = [i for i in range(216) if i < first or i > last]
    assert len(outside) == 59
    assert all(timeline.zones[i] == Zone.HIGH and timeline.fallback[i] for i in outside)
    assert all(math.isnan(timeline.protective_twl_w_m2[i]) for i in outside)
    assert not any(timeline.fallback[first : last + 1])
    assert all(z == Zone.LOW for z in timeline.zones[first : last + 1])


def test_missing_hours_become_high() -> None:
    twl = np.full(14, 150.0)
    twl[5] = NAN  # label 07Z
    timeline = _timeline(twl)
    missing = range(_tick_index("2026-07-01T06:05"), _tick_index("2026-07-01T07:55") + 1)
    assert len(missing) == 23
    assert all(timeline.zones[i] == Zone.HIGH and timeline.fallback[i] for i in missing)
    assert all(math.isnan(timeline.protective_twl_w_m2[i]) for i in missing)
    assert timeline.zones[_tick_index("2026-07-01T06:00")] == Zone.LOW
    assert not timeline.fallback[_tick_index("2026-07-01T06:00")]
    assert timeline.zones[_tick_index("2026-07-01T08:00")] == Zone.LOW
    assert not timeline.fallback[_tick_index("2026-07-01T08:00")]


def test_all_missing_forecast_is_a_fallback_timeline() -> None:
    timeline = _timeline(np.full(14, NAN))
    assert timeline.source == "fallback"
    assert all(z == Zone.HIGH for z in timeline.zones)
    assert all(timeline.fallback)
    expected = fallback_timeline(DAY, DUBAI)
    assert (timeline.zones, timeline.fallback, timeline.source, timeline.start_utc) == (
        expected.zones,
        expected.fallback,
        expected.source,
        expected.start_utc,
    )


def test_hour_level_clamp_makes_the_tick_at_least_as_severe_as_its_hour() -> None:
    twl = np.full(14, 150.0)  # every tick Low from the q10 alone
    hour_zones: list[Zone | int] = [Zone.LOW] * 14
    hour_zones[6] = Zone.HIGH  # the hour [08:00Z, 09:00Z) has level High
    hour_zones[8] = Zone.RED
    timeline = _timeline(twl, hour_zones=hour_zones)
    hour_08 = range(_tick_index("2026-07-01T08:00"), _tick_index("2026-07-01T08:55") + 1)
    hour_10 = range(_tick_index("2026-07-01T10:00"), _tick_index("2026-07-01T10:55") + 1)
    assert all(timeline.zones[i] == Zone.HIGH for i in hour_08)
    assert all(timeline.zones[i] == Zone.RED for i in hour_10)
    assert timeline.zones[_tick_index("2026-07-01T07:55")] == Zone.LOW
    assert timeline.zones[_tick_index("2026-07-01T09:00")] == Zone.LOW


def test_hour_level_clamp_never_makes_a_tick_milder() -> None:
    twl = np.full(14, 100.0)  # q10 says High everywhere
    hour_zones: list[Zone | int] = [Zone.LOW] * 14
    timeline = _timeline(twl, hour_zones=hour_zones)
    assert all(
        z == Zone.HIGH for z in timeline.zones[_tick_index("2026-07-01T02:00") : _tick_index("2026-07-01T15:00") + 1]
    )


def test_no_clamp_when_hour_levels_are_none() -> None:
    twl = np.full(14, 150.0)
    timeline = _timeline(twl, hour_zones=None)
    assert timeline.zones[_tick_index("2026-07-01T08:00")] == Zone.LOW


def test_hour_without_a_level_does_not_clamp() -> None:
    twl = np.full(14, 150.0)
    hour_zones: list[Zone | int] = [-1] * 14  # no finite sample in any hour: no level, no clamp
    timeline = _timeline(twl, hour_zones=hour_zones)
    assert timeline.zones[_tick_index("2026-07-01T08:00")] == Zone.LOW


def test_a_tick_with_no_value_still_respects_a_red_hour() -> None:
    twl = np.full(14, 150.0)
    twl[5] = NAN  # label 07Z: ticks 06:05-07:55 have no value
    hour_zones: list[Zone | int] = [Zone.LOW] * 14
    hour_zones[5] = Zone.RED  # the hour [07:00Z, 08:00Z) is Red
    timeline = _timeline(twl, hour_zones=hour_zones)
    assert timeline.zones[_tick_index("2026-07-01T07:30")] == Zone.RED
    assert timeline.fallback[_tick_index("2026-07-01T07:30")]  # still flagged as having no value
    assert timeline.zones[_tick_index("2026-07-01T06:30")] == Zone.HIGH


def test_hour_levels_must_match_the_labels() -> None:
    with pytest.raises(ValueError, match="one zone per label"):
        _timeline(np.full(14, 150.0), hour_zones=[Zone.LOW] * 3)
    with pytest.raises(ValueError, match="one value per label"):
        _timeline(np.full(3, 150.0))


def test_source_truth_is_passed_through() -> None:
    assert _timeline(np.full(14, 150.0), source="truth").source == "truth"


def test_protective_twl_series_survives_with_zones() -> None:
    twl = np.full(14, 150.0)
    twl[5] = NAN
    timeline = _timeline(twl)
    stops = list(timeline.zones)
    stops[_tick_index("2026-07-01T09:00")] = Zone.RED
    changed = timeline.with_zones(stops)
    assert changed.zones[_tick_index("2026-07-01T09:00")] == Zone.RED
    assert (
        changed.protective_twl_w_m2 == timeline.protective_twl_w_m2
    )  # NaN-aware tuple equality via identity of floats
    assert changed.fallback == timeline.fallback
    assert changed.start_utc == timeline.start_utc
    with pytest.raises(ValueError, match="one zone per tick"):
        timeline.with_zones(stops[:10])


def _labels_without(*hours: int, first: int = 2, last: int = 15) -> np.ndarray:
    return np.array(
        [f"2026-07-01T{h:02d}:00" for h in range(first, last + 1) if h not in hours], dtype="datetime64[us]"
    )


def _timeline_with_labels(labels: np.ndarray, twl: float = 150.0) -> ZoneTimeline:
    return zone_timeline(
        local_date=DAY,
        tz=DUBAI,
        labels_utc=labels,
        protective_twl_eff=np.full(labels.size, twl),
        hour_level_zones=None,
        edges=EDGES,
    )


def _assert_high_fallback(timeline: ZoneTimeline, first: str, last: str) -> None:
    span = range(_tick_index(first), _tick_index(last) + 1)
    assert all(timeline.zones[i] == Zone.HIGH and timeline.fallback[i] for i in span), (first, last)
    assert all(math.isnan(timeline.protective_twl_w_m2[i]) for i in span)


def test_a_removed_hourly_label_is_a_gap_not_a_bridge() -> None:
    # Review I1: labels 06Z, 07Z, 09Z (08Z removed, not NaN). The ticks strictly between 07Z and 09Z used to be
    # interpolated (Low, no fallback); a missing hour must be High + fallback. The labelled ticks stay as they were.
    timeline = _timeline_with_labels(_labels_without(8))
    _assert_high_fallback(timeline, "2026-07-01T07:05", "2026-07-01T08:55")
    for stamp in ("2026-07-01T07:00", "2026-07-01T09:00", "2026-07-01T09:30"):
        assert timeline.zones[_tick_index(stamp)] == Zone.LOW
        assert not timeline.fallback[_tick_index(stamp)]


def test_two_removed_labels_are_one_gap() -> None:
    timeline = _timeline_with_labels(_labels_without(8, 9))
    _assert_high_fallback(timeline, "2026-07-01T07:05", "2026-07-01T09:55")
    assert not timeline.fallback[_tick_index("2026-07-01T07:00")]
    assert not timeline.fallback[_tick_index("2026-07-01T10:00")]


def test_two_separate_removed_labels_are_two_gaps() -> None:
    timeline = _timeline_with_labels(_labels_without(6, 10))
    _assert_high_fallback(timeline, "2026-07-01T05:05", "2026-07-01T06:55")
    _assert_high_fallback(timeline, "2026-07-01T09:05", "2026-07-01T10:55")
    assert not any(timeline.fallback[_tick_index("2026-07-01T07:00") : _tick_index("2026-07-01T09:00") + 1])


def test_a_removed_first_or_last_label_shortens_the_labelled_range() -> None:
    first_gone = _timeline_with_labels(_labels_without(2))
    _assert_high_fallback(first_gone, "2026-07-01T00:00", "2026-07-01T02:55")
    assert not first_gone.fallback[_tick_index("2026-07-01T03:00")]
    last_gone = _timeline_with_labels(_labels_without(15))
    assert not last_gone.fallback[_tick_index("2026-07-01T14:00")]
    _assert_high_fallback(last_gone, "2026-07-01T14:05", "2026-07-01T17:55")


def test_a_nan_label_is_still_a_gap_and_contiguous_labels_still_interpolate() -> None:
    twl = np.full(14, 150.0)
    twl[5] = NAN  # 07Z
    timeline = zone_timeline(
        local_date=DAY,
        tz=DUBAI,
        labels_utc=_hourly_labels(),
        protective_twl_eff=twl,
        hour_level_zones=None,
        edges=EDGES,
    )
    _assert_high_fallback(timeline, "2026-07-01T06:05", "2026-07-01T07:55")
    ticks = np.array(["2026-07-01T09:30"], dtype="datetime64[us]")
    assert interpolate_hourly(_hourly_labels(), np.arange(100.0, 114.0), ticks).tolist() == [pytest.approx(107.5)]


def test_interpolate_hourly_gap_gives_nan_between_but_not_on_the_labels() -> None:
    labels = _labels_without(8, first=6, last=10)  # 06Z 07Z 09Z 10Z
    values = np.array([100.0, 110.0, 130.0, 140.0])
    stamps = ["2026-07-01T06:30", "2026-07-01T07:00", "2026-07-01T07:30", "2026-07-01T08:00", "2026-07-01T09:00"]
    out = interpolate_hourly(labels, values, np.array(stamps, dtype="datetime64[us]"))
    assert out[0] == pytest.approx(105.0)
    assert out[1] == 110.0  # exactly on a label that exists
    assert math.isnan(out[2])
    assert math.isnan(out[3])
    assert out[4] == 130.0


def test_interpolate_hourly_treats_infinity_as_no_value_without_a_warning() -> None:
    # filterwarnings = error: an inf - inf or inf * 0 in the blend would raise a RuntimeWarning here.
    labels = _hourly_labels(2, 5)
    values = np.array([100.0, np.inf, 120.0, -np.inf])
    stamps = ["2026-07-01T02:30", "2026-07-01T03:00", "2026-07-01T03:30", "2026-07-01T04:30", "2026-07-01T05:00"]
    out = interpolate_hourly(labels, values, np.array(stamps, dtype="datetime64[us]"))
    assert np.isnan(out).all()


@pytest.mark.parametrize(
    ("day", "start_utc"),
    [
        (date(2026, 3, 28), "2026-03-28T03:00"),  # CET, UTC+1
        (date(2026, 3, 29), "2026-03-29T02:00"),  # the clocks went forward at 02:00 local: CEST, UTC+2
        (date(2026, 10, 24), "2026-10-24T02:00"),  # CEST
        (date(2026, 10, 25), "2026-10-25T03:00"),  # the clocks went back at 03:00 local: CET, UTC+1
    ],
)
def test_tick_grid_on_daylight_saving_days_starts_at_local_four(day: date, start_utc: str) -> None:
    ticks = day_ticks(day, ZoneInfo("Europe/Madrid"))
    assert ticks[0] == _t(start_utc)  # 04:00 local, converted with zoneinfo and not a fixed offset
    assert ticks.shape == (216,)
    assert (np.diff(ticks) == np.timedelta64(5, "m")).all()  # equally spaced in UTC (documented in the module)
