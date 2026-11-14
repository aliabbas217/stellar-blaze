"""``site_day``: levels, zones, ban data, stale and fallback labelling, determinism and identity (Task 8)."""

from datetime import UTC, datetime, timedelta

import pytest

from stellar_blaze.adapters.fakes.corrector import FakeCorrector
from stellar_blaze.domain.plans.model import ZoneTimeline
from stellar_blaze.domain.risk.levels import AlertLevel, Zone
from stellar_blaze.domain.rules.ruleset import Ruleset
from tests.unit.application.serving_support import (
    AMBER,
    DAY,
    GREEN_DAY,
    ORANGE,
    RED,
    SHA,
    ExplodingForecasts,
    catalog,
    day_of,
    forecasts_of,
    make_site_day,
    newest_run,
    snapshot,
)

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]

TICKS_PER_HOUR = 12


def zone_at(timeline: ZoneTimeline, hour_utc: int, minute: int = 0) -> tuple[Zone, bool]:
    index = ((hour_utc - 0) * 60 + minute) // 5  # the grid starts at 00:00 UTC (04:00 Asia/Dubai)
    return timeline.zones[index], timeline.fallback[index]


def ruleset() -> Ruleset:
    return catalog().for_local_date(DAY).ruleset


@pytest.mark.parametrize(
    ("weather", "level", "zone"),
    [
        (GREEN_DAY, AlertLevel.GREEN, Zone.LOW),
        (AMBER, AlertLevel.AMBER, Zone.MEDIUM),
        (ORANGE, AlertLevel.ORANGE, Zone.HIGH),
        (RED, AlertLevel.RED, Zone.RED),
    ],
)
async def test_site_day_levels_from_fake_corrector(weather: tuple[float, float], level: AlertLevel, zone: Zone) -> None:
    # Raw T/Td that give an effective TWL below 115 at 10Z make 10Z orange (the brief's example is the ORANGE row).
    day = await make_site_day(forecasts_of(day_of(GREEN_DAY, {10: weather})))

    by_hour = {hour.starts_at.hour: hour for hour in day.hours}
    assert by_hour[10].level is level
    assert by_hour[10].zone is zone
    assert by_hour[9].level is AlertLevel.GREEN  # the neighbours keep their own level
    assert zone_at(day.zones, 10, 30)[0] >= zone  # the tick zone is never milder than the level of its hour
    assert by_hour[10].action_codes == ruleset().alerts.action_codes_by_level[level.value]  # type: ignore[union-attr]


async def test_site_day_covers_the_working_day_in_14_hours() -> None:
    day = await make_site_day(forecasts_of(day_of(GREEN_DAY)))

    assert [hour.starts_at for hour in day.hours] == [datetime(2026, 7, 1, h, tzinfo=UTC) for h in range(2, 16)]
    assert day.local_date == DAY
    assert day.lead_days == 1
    assert len(day.zones.zones) == 216
    first = day.hours[0]
    assert first.wbgt_q05 is not None
    assert first.wbgt_q50 is not None
    assert first.wbgt_q95 is not None
    assert first.wbgt_q05 <= first.wbgt_q50 <= first.wbgt_q95


async def test_ban_data_and_ban_active_hours() -> None:
    day = await make_site_day(forecasts_of(day_of(GREEN_DAY)))

    assert day.ban.active_on_date
    assert (day.ban.starts_at, day.ban.ends_at) == (
        datetime(2026, 7, 1, 8, 30, tzinfo=UTC),
        datetime(2026, 7, 1, 11, 0, tzinfo=UTC),
    )
    active = {hour.starts_at.hour for hour in day.hours if hour.ban_active}
    assert active == {8, 9, 10}  # 08:00-09:00Z holds 30 ban minutes, 10:00-11:00Z ends at 11:00Z exactly


async def test_site_day_is_deterministic() -> None:
    source = forecasts_of(day_of(ORANGE, {8: AMBER, 12: GREEN_DAY}))

    first = await make_site_day(source, corrector=FakeCorrector(2.0))
    second = await make_site_day(source, corrector=FakeCorrector(2.0))

    assert first == second  # includes the NaN-bearing TWL series of the timeline


async def test_missing_hour_is_fallback() -> None:
    hours = day_of(GREEN_DAY)
    del hours[9]
    day = await make_site_day(forecasts_of(hours))

    by_hour = {hour.starts_at.hour: hour for hour in day.hours}
    assert (by_hour[9].level, by_hour[9].zone, by_hour[9].wbgt_q50) == (None, None, None)
    assert by_hour[8].level is AlertLevel.GREEN
    assert by_hour[10].level is AlertLevel.GREEN
    # The ticks around the hole have no value of their own: High, flagged, never "no constraint".
    assert zone_at(day.zones, 9, 30) == (Zone.HIGH, True)
    assert zone_at(day.zones, 8, 30) == (Zone.HIGH, True)  # between a label and the missing one
    assert zone_at(day.zones, 7, 30) == (Zone.LOW, False)
    assert day.forecast_status == "fallback"


async def test_an_hour_with_a_null_input_has_no_level() -> None:
    day = await make_site_day(forecasts_of({**day_of(GREEN_DAY), 11: (None, 10.0)}))

    by_hour = {hour.starts_at.hour: hour for hour in day.hours}
    assert by_hour[11].level is None  # hour_levels == -1 never reaches level_for_zone
    assert by_hour[11].zone is None
    assert zone_at(day.zones, 11, 30)[1] is True


async def test_stale_forecast_is_labelled_and_protective() -> None:
    source = forecasts_of(day_of(GREEN_DAY))

    fresh = await make_site_day(source, mode="live", now=newest_run() + timedelta(hours=29))
    stale = await make_site_day(source, mode="live", now=newest_run() + timedelta(hours=31))
    boundary = await make_site_day(source, mode="live", now=newest_run() + timedelta(hours=30))

    assert (fresh.forecast_status, boundary.forecast_status, stale.forecast_status) == ("fresh", "fresh", "stale")
    assert stale.mode == "live"
    assert stale.generated_at == newest_run()
    assert [hour.level for hour in stale.hours] == [AlertLevel.GREEN] * 14  # the stale forecast is still shown

    # No forecast row at all: fallback, no level anywhere, every tick High and flagged, the clock is the response's.
    now = datetime(2026, 7, 1, 1, tzinfo=UTC)
    empty = await make_site_day(forecasts_of({}), mode="live", now=now)
    assert empty.forecast_status == "fallback"
    assert all(hour.level is None and hour.zone is None for hour in empty.hours)
    assert set(empty.zones.zones) == {Zone.HIGH}
    assert all(empty.zones.fallback)
    assert empty.zones.source == "fallback"
    assert empty.generated_at == now


async def test_a_failing_forecast_source_is_a_fallback_not_an_error() -> None:
    now = datetime(2026, 7, 1, 1, tzinfo=UTC)

    day = await make_site_day(ExplodingForecasts(), mode="live", now=now)

    assert day.forecast_status == "fallback"
    assert set(day.zones.zones) == {Zone.HIGH}
    assert all(day.zones.fallback)
    assert [hour.level for hour in day.hours] == [None] * 14
    assert day.generated_at == now


async def test_replay_never_stale() -> None:
    source = forecasts_of(day_of(GREEN_DAY))

    day = await make_site_day(source, mode="replay", now=newest_run() + timedelta(days=400))

    assert (day.mode, day.forecast_status) == ("replay", "fresh")


async def test_lead_outside_the_model_leads_is_a_caller_error() -> None:
    with pytest.raises(ValueError, match="lead_days"):
        await make_site_day(forecasts_of(day_of(GREEN_DAY)), lead_days=0)


async def test_identity_fields_present() -> None:
    loaded = catalog().for_local_date(DAY)

    file_day = await make_site_day(forecasts_of(day_of(GREEN_DAY)))
    db_day = await make_site_day(forecasts_of(day_of(GREEN_DAY)), config=snapshot(version_id=7))

    assert file_day.identity.ruleset_id == "ae-heat-2026.1" == loaded.ruleset.meta.id
    assert file_day.identity.ruleset_sha256 == loaded.sha256
    assert file_day.identity.model_id is None  # FakeCorrector has no artifact
    assert (file_day.identity.config_version, file_day.identity.config_sha256) == (0, SHA)
    assert db_day.identity.config_version == 7
