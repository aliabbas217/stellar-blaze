"""Which ticks a crew-lead stop covers: one helper for the plan, the timeline, the alert dispatch and the stop origin.

Grid of every case: the local day 2026-07-01 in Asia/Dubai (UTC+4), 216 ticks of 5 minutes from 04:00 local = 00:00Z, so
tick ``i`` starts at ``00:00Z + 5 min * i`` (06:00Z = tick 72, 07:10Z = tick 86, 14:00Z = tick 168).
Crew B's shift is 06:00-11:00 and 15:00-18:00 local = 02:00Z-07:00Z and 11:00Z-14:00Z, so its shift ends at 14:00Z.
"""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from stellar_blaze.application.day_plan import STOP_UNDO_WINDOW_S, effective_stops, shift_end_utc, stopped_mask
from stellar_blaze.domain.plans.model import ShiftBlock

pytestmark = pytest.mark.unit

START = datetime(2026, 7, 1, 0, tzinfo=UTC)
SHIFT_END = datetime(2026, 7, 1, 14, tzinfo=UTC)
DUBAI = ZoneInfo("Asia/Dubai")
CREW_B = (ShiftBlock(time(6), time(11)), ShiftBlock(time(15), time(18)))


def at(hour: int, minute: int = 0, second: int = 0) -> datetime:
    return datetime(2026, 7, 1, hour, minute, second, tzinfo=UTC)


def ticks(mask: list[bool]) -> list[int]:
    return [i for i, covered in enumerate(mask) if covered]


def test_the_window_is_the_named_ten_second_constant() -> None:
    assert STOP_UNDO_WINDOW_S == 10  # F2 stop UI spec: "no confirm dialog and a 10 s undo"


def test_the_shift_end_is_the_end_of_the_last_block_in_utc() -> None:
    assert shift_end_utc(CREW_B, date(2026, 7, 1), DUBAI) == SHIFT_END  # 18:00 local


@pytest.mark.parametrize("seconds", [0, 1, 8, 10])
def test_a_stop_cleared_within_the_window_is_ignored_entirely(seconds: int) -> None:
    stop = (at(6), at(6) + timedelta(seconds=seconds))  # would overlap tick 72 (06:00-06:05)
    assert effective_stops([stop], SHIFT_END) == []
    assert ticks(stopped_mask([stop], START, SHIFT_END)) == []


def test_a_stop_cleared_one_second_after_the_window_covers_the_tick_it_overlaps() -> None:
    stop = (at(6), at(6, 0, 11))
    assert effective_stops([stop], SHIFT_END) == [stop]
    assert ticks(stopped_mask([stop], START, SHIFT_END)) == [72]  # 06:00-06:05


def test_a_stop_cleared_after_25_minutes_covers_exactly_the_overlapped_ticks() -> None:
    # [06:00, 06:25) overlaps ticks starting 06:00, 06:05, 06:10, 06:15, 06:20 = 72..76; 06:25 (77) is free.
    assert ticks(stopped_mask([(at(6), at(6, 25))], START, SHIFT_END)) == [72, 73, 74, 75, 76]


def test_a_stop_that_starts_mid_tick_covers_that_tick_and_ends_on_a_boundary_exclusive() -> None:
    # [06:03, 06:30): tick 72 (06:00-06:05) overlaps; the last is 77 (06:25-06:30); tick 78 starts at 06:30: free.
    assert ticks(stopped_mask([(at(6, 3), at(6, 30))], START, SHIFT_END)) == [72, 73, 74, 75, 76, 77]


def test_an_active_stop_covers_to_the_end_of_the_shift_and_not_after() -> None:
    # Active from 06:00Z (tick 72) to the shift end 14:00Z (tick 168, exclusive): 72..167, nothing in 168..215.
    covered = ticks(stopped_mask([(at(6), None)], START, SHIFT_END))
    assert covered == list(range(72, 168))


def test_an_active_stop_recorded_in_the_midday_break_still_stops_the_afternoon_block() -> None:
    # 07:10Z = 11:10 local, between the blocks (02:00-07:00Z and 11:00-14:00Z): ticks 86..167 cover the 15:00 block.
    assert ticks(stopped_mask([(at(7, 10), None)], START, SHIFT_END)) == list(range(86, 168))


def test_an_active_stop_recorded_before_the_shift_covers_from_its_own_tick_to_the_shift_end() -> None:
    assert ticks(stopped_mask([(at(1), None)], START, SHIFT_END)) == list(range(12, 168))  # 01:00Z = tick 12


@pytest.mark.parametrize("started", [at(14), at(14, 30), at(17)])
def test_an_active_stop_recorded_at_or_after_the_shift_end_covers_nothing(started: datetime) -> None:
    # Nothing is left to stop; the stop record itself stands (the crew list still shows it) until cleared.
    assert effective_stops([(started, None)], SHIFT_END) == []
    assert ticks(stopped_mask([(started, None)], START, SHIFT_END)) == []


def test_a_cleared_stop_is_not_cut_at_the_shift_end() -> None:
    # [13:58, 14:30) overlaps ticks 167 (13:55-14:00) .. 173 (14:25-14:30): a cleared stop covers its own interval.
    assert ticks(stopped_mask([(at(13, 58), at(14, 30))], START, SHIFT_END)) == list(range(167, 174))


def test_stops_combine_and_the_ignored_one_does_not_hide_the_real_one() -> None:
    undone = (at(6), at(6, 0, 5))
    real = (at(9), at(9, 10))  # ticks 108 (09:00) and 109 (09:05)
    assert ticks(stopped_mask([undone, real], START, SHIFT_END)) == [108, 109]
