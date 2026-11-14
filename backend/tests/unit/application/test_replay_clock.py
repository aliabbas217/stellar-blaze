"""The replay clock: it starts at the replay anchor, runs at real speed, and the anchor has one derivation."""

from datetime import UTC, date, datetime, timedelta, timezone

import pytest

from stellar_blaze.application.replay_clock import REPLAY_LOCAL_TIME, ReplayClock, domain_clock

pytestmark = pytest.mark.unit

ANCHOR = datetime(2025, 7, 10, 7, 10, tzinfo=UTC)
WALL_START = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)


class Wall:
    """A settable stand-in for the real clock."""

    def __init__(self, now: datetime = WALL_START) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def test_it_starts_at_the_anchor_whatever_the_wall_clock_says() -> None:
    clock = ReplayClock(ANCHOR, Wall())

    assert clock.now() == ANCHOR
    assert clock() == ANCHOR  # the Services.clock shape: a plain callable


def test_it_runs_at_real_speed_from_the_anchor() -> None:
    wall = Wall()
    clock = ReplayClock(ANCHOR, wall)

    wall.now += timedelta(minutes=3, seconds=30)

    assert clock.now() == ANCHOR + timedelta(minutes=3, seconds=30)
    assert clock.now().tzinfo is UTC


def test_a_wall_clock_that_steps_back_never_moves_it_back() -> None:
    wall = Wall()
    clock = ReplayClock(ANCHOR, wall)
    wall.now += timedelta(minutes=10)
    later = clock.now()

    wall.now -= timedelta(minutes=4)  # an NTP correction

    assert clock.now() == later


def test_the_anchor_is_normalized_to_utc() -> None:
    dubai = timezone(timedelta(hours=4))

    clock = ReplayClock(datetime(2025, 7, 10, 11, 10, tzinfo=dubai), Wall())

    assert clock.now() == ANCHOR
    assert clock.now().utcoffset() == timedelta(0)


def test_a_naive_anchor_or_a_naive_wall_clock_is_refused() -> None:
    with pytest.raises(ValueError, match="aware"):
        ReplayClock(datetime(2025, 7, 10, 7, 10), Wall())  # noqa: DTZ001
    with pytest.raises(ValueError, match="aware"):
        ReplayClock(ANCHOR, lambda: datetime(2026, 11, 15, 9, 0))  # noqa: DTZ001
    wall = Wall()
    clock = ReplayClock(ANCHOR, wall)
    wall.now = datetime(2026, 11, 15, 9, 5)  # noqa: DTZ001 (a later naive reading)
    with pytest.raises(ValueError, match="aware"):
        clock.now()


def test_the_replay_local_time_is_11_10() -> None:
    assert (REPLAY_LOCAL_TIME.hour, REPLAY_LOCAL_TIME.minute) == (11, 10)


def test_an_explicit_replay_now_is_the_anchor() -> None:
    explicit = datetime(2025, 7, 11, 5, 0, tzinfo=UTC)

    clock = domain_clock(source="replay", replay_now=explicit, replay_default_date=date(2025, 7, 10), wall=Wall())

    assert clock() == explicit  # replay_now wins over the date


def test_the_default_date_gives_11_10_in_dubai() -> None:
    clock = domain_clock(source="replay", replay_now=None, replay_default_date=date(2025, 7, 10), wall=Wall())

    assert clock() == datetime(2025, 7, 10, 7, 10, tzinfo=UTC)  # 11:10 at UTC+4


def test_replay_with_neither_setting_uses_the_wall_clock() -> None:
    wall = Wall()

    clock = domain_clock(source="replay", replay_now=None, replay_default_date=None, wall=wall)

    assert clock is wall


def test_a_live_source_ignores_both_settings() -> None:
    wall = Wall()

    clock = domain_clock(source="open_meteo", replay_now=ANCHOR, replay_default_date=date(2025, 7, 10), wall=wall)

    assert clock is wall
