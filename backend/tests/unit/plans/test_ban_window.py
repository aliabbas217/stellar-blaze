"""``ban_window_for``: the ban as data for the API, matching the frozen ``BanWindow`` model field for field."""

import dataclasses
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest

from stellar_blaze.api.models import BanWindow
from stellar_blaze.domain.plans.ticks import BanWindowData, ban_window_for
from tests.unit.risk.support import released_ruleset

pytestmark = pytest.mark.unit

DUBAI = ZoneInfo("Asia/Dubai")


def window(local_date: date, tz: ZoneInfo = DUBAI) -> BanWindowData:
    labour = released_ruleset().labour
    assert labour is not None
    return ban_window_for(local_date, tz, labour)


@pytest.mark.parametrize("local_date", [date(2026, 6, 15), date(2026, 7, 1), date(2026, 9, 15)])
def test_in_season_dates_are_inclusive_and_carry_the_utc_instants(local_date: date) -> None:
    data = window(local_date)

    assert data.active_on_date
    assert data.starts_at == datetime(local_date.year, local_date.month, local_date.day, 8, 30, tzinfo=UTC)
    assert data.ends_at == datetime(local_date.year, local_date.month, local_date.day, 11, 0, tzinfo=UTC)


@pytest.mark.parametrize("local_date", [date(2026, 6, 14), date(2026, 9, 16), date(2026, 12, 31)])
def test_out_of_season_dates_have_no_instants(local_date: date) -> None:
    data = window(local_date)

    assert not data.active_on_date
    assert (data.starts_at, data.ends_at) == (None, None)
    assert (data.start, data.end, data.season_start, data.season_end) == ("12:30", "15:00", "06-15", "09-15")


def test_every_field_of_the_frozen_model_is_filled_and_it_validates() -> None:
    data = window(date(2026, 7, 1))

    assert data.timezone == "Asia/Dubai"
    model = BanWindow.model_validate(dataclasses.asdict(data))
    assert set(dataclasses.asdict(data)) == set(BanWindow.model_fields)
    assert model.starts_at == data.starts_at


def test_the_instants_follow_the_site_time_zone() -> None:
    data = window(date(2026, 7, 1), ZoneInfo("Europe/Madrid"))  # CEST, UTC+2

    assert data.timezone == "Europe/Madrid"
    assert (data.starts_at, data.ends_at) == (
        datetime(2026, 7, 1, 10, 30, tzinfo=UTC),
        datetime(2026, 7, 1, 13, 0, tzinfo=UTC),
    )
