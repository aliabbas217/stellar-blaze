from datetime import UTC, datetime, timedelta

import pytest

from stellar_blaze.domain.weather.models import (
    LEADS_DAYS,
    MODEL_SUMMERS,
    NwpModel,
    QcPolicy,
    is_working_daytime,
    summer_window,
)

pytestmark = pytest.mark.unit

HOUR = timedelta(hours=1)


@pytest.mark.parametrize("year", [2024, 2025, 2026])
def test_summer_window_has_3336_hours(year: int) -> None:
    start, end = summer_window(year)
    assert (end - start) // HOUR + 1 == 3336


@pytest.mark.parametrize("year", [2024, 2025, 2026])
def test_summer_window_bounds_are_utc_and_inclusive(year: int) -> None:
    start, end = summer_window(year)
    assert start == datetime(year, 5, 15, 0, tzinfo=UTC)
    assert end == datetime(year, 9, 30, 23, tzinfo=UTC)
    assert start.utcoffset() == timedelta(0)
    assert end.utcoffset() == timedelta(0)


def test_nwp_model_values_are_the_open_meteo_model_names() -> None:
    assert {m.name: m.value for m in NwpModel} == {
        "ECMWF_IFS025": "ecmwf_ifs025",
        "GFS_SEAMLESS": "gfs_seamless",
        "ECMWF_AIFS025": "ecmwf_aifs025_single",
    }


def test_model_summers_follow_the_archive_probe() -> None:
    assert set(MODEL_SUMMERS) == set(NwpModel)
    assert MODEL_SUMMERS[NwpModel.ECMWF_IFS025] == frozenset({2024, 2025, 2026})
    assert MODEL_SUMMERS[NwpModel.GFS_SEAMLESS] == frozenset({2024, 2025, 2026})
    assert MODEL_SUMMERS[NwpModel.ECMWF_AIFS025] == frozenset({2025, 2026})


def test_leads_are_day_zero_to_seven() -> None:
    assert list(LEADS_DAYS) == [0, 1, 2, 3, 4, 5, 6, 7]


@pytest.mark.parametrize(
    ("hour_utc", "expected"),
    [(0, False), (5, False), (6, True), (10, True), (14, True), (15, False), (23, False)],
)
def test_working_daytime_is_06_to_14_utc(hour_utc: int, expected: bool) -> None:
    assert is_working_daytime(hour_utc) is expected


def test_qc_policy_members() -> None:
    assert [p.name for p in QcPolicy] == ["NONE", "GHCNH_LENIENT"]
