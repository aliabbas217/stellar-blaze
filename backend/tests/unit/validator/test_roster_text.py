"""The roster-text parser and the plan it builds (try-a-plan, Task 10)."""

from datetime import time
from zoneinfo import ZoneInfo

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from stellar_blaze.domain.plans.model import TickState
from stellar_blaze.domain.risk.levels import Zone
from stellar_blaze.domain.validator.roster_text import (
    RosterParseError,
    RosterSegment,
    parse_roster,
    plan_from_segments,
)
from tests.unit.validator.support import (
    START_UTC,
    SUMMER,
    TICKS,
    at,
    crew_of,
    ids,
    run_validator,
    uniform,
)

pytestmark = pytest.mark.unit

DUBAI = ZoneInfo("Asia/Dubai")


def _errors(text: str) -> tuple[tuple[int, str], ...]:
    with pytest.raises(RosterParseError) as caught:
        parse_roster(text)
    return caught.value.errors


def test_parse_ok() -> None:
    text = "# morning shift\n06:00-11:00 WORK   # first block\n\n11:00-12:00 Break\n12:00-12:30 rest\n"
    assert parse_roster(text) == (
        RosterSegment(line=2, start=time(6, 0), end=time(11, 0), state="work"),
        RosterSegment(line=4, start=time(11, 0), end=time(12, 0), state="break"),
        RosterSegment(line=5, start=time(12, 0), end=time(12, 30), state="rest"),
    )


def test_parse_accepts_one_digit_hours_spaces_and_crlf() -> None:
    segments = parse_roster("6:00 - 7:30   work\r\n7:30-08:00 rest\r\n")
    assert [(s.line, s.start, s.end, s.state) for s in segments] == [
        (1, time(6, 0), time(7, 30), "work"),
        (2, time(7, 30), time(8, 0), "rest"),
    ]


def test_parse_adjacent_segments_do_not_overlap() -> None:
    assert len(parse_roster("06:00-07:00 work\n07:00-08:00 rest")) == 2


def test_parse_grid_edges_are_legal() -> None:
    assert len(parse_roster("04:00-22:00 work")) == 1


@pytest.mark.parametrize(
    ("text", "line", "needle"),
    [
        ("garbage", 1, "expected"),
        ("06:00-07:00", 1, "expected"),
        ("06:00-07:00 sleep", 1, "unknown state"),
        ("6:99-07:00 work", 1, "time"),
        ("25:00-26:00 work", 1, "time"),
        ("07:00-07:00 work", 1, "before"),
        ("08:00-07:00 work", 1, "before"),
        ("03:55-05:00 work", 1, "04:00"),
        ("21:00-22:05 work", 1, "22:00"),
        ("06:03-07:00 work", 1, "5 minutes"),
    ],
)
def test_parse_errors_have_line_numbers(text: str, line: int, needle: str) -> None:
    errors = _errors(text)
    assert [n for n, _ in errors] == [line]
    assert needle in errors[0][1]


def test_parse_overlap_names_both_lines() -> None:
    errors = _errors("06:00-07:00 work\n06:30-07:30 rest")
    assert [n for n, _ in errors] == [2]
    assert "line 1" in errors[0][1]


def test_parse_errors_count_blank_and_comment_lines() -> None:
    errors = _errors("\n\n# note\n06:00-07:00 nap\n\n# more\n06:00-07:00 work\n06:30-07:30 work\n")
    assert [n for n, _ in errors] == [4, 8]


def test_parse_errors_are_reported_together_in_line_order() -> None:
    errors = _errors("06:00-07:00 sleep\n6:99-07:00 work\n06:00-07:00 work\n06:30-07:30 work")
    assert [n for n, _ in errors] == [1, 2, 4]


def test_parse_crlf_line_numbers() -> None:
    assert [n for n, _ in _errors("06:00-07:00 work\r\n\r\nbad\r\n")] == [3]


def test_parse_empty_roster_is_an_error() -> None:
    assert _errors("") == ((1, "the roster has no segments"),)
    assert [n for n, _ in _errors("\n# nothing\n")] == [1]


def test_parse_limits() -> None:
    lines = [
        f"{4 + i // 12:02d}:{(i % 12) * 5:02d}-{4 + (i + 1) // 12:02d}:{((i + 1) % 12) * 5:02d} work" for i in range(41)
    ]
    assert len(parse_roster("\n".join(lines[:40]))) == 40
    errors = _errors("\n".join(lines))
    assert errors == ((41, "too many segments (at most 40 lines)"),)


def test_parse_limit_counts_non_blank_lines_only() -> None:
    lines = [
        f"{4 + i // 12:02d}:{(i % 12) * 5:02d}-{4 + (i + 1) // 12:02d}:{((i + 1) % 12) * 5:02d} work" for i in range(40)
    ]
    padded = "\n# comment\n\n".join(lines)
    assert len(parse_roster(padded)) == 40


def test_roster_parse_error_message_lists_the_lines() -> None:
    with pytest.raises(RosterParseError, match=r"line 1: .*\n.*line 2: ") as caught:
        parse_roster("bad\nworse")
    assert caught.value.errors[0][0] == 1


@settings(max_examples=200, deadline=None)
@given(st.text(max_size=300))
def test_parse_never_raises_anything_but_the_roster_error(text: str) -> None:
    try:
        segments = parse_roster(text)
    except RosterParseError as error:
        problems = error.errors
        assert problems
        assert all(n >= 1 for n, _ in problems)
        assert all(message for _, message in problems)
    else:
        assert 1 <= len(segments) <= 40
        assert all(time(4, 0) <= s.start < s.end <= time(22, 0) for s in segments)


def test_plan_from_segments_maps_states_and_leaves_the_rest_off() -> None:
    segments = parse_roster("06:00-07:00 work\n07:00-07:30 rest\n07:30-08:30 break")
    plan = plan_from_segments(segments, local_date=SUMMER, tz=DUBAI)
    assert len(plan.states) == TICKS
    assert plan.states[at("06:00")] is TickState.WORK
    assert plan.states[at("07:00") - 1] is TickState.WORK
    assert plan.states[at("07:00")] is TickState.ADOSH_REST
    assert plan.states[at("07:30")] is TickState.ART18_BREAK
    assert plan.states[at("08:30") - 1] is TickState.ART18_BREAK
    assert plan.states[at("08:30")] is TickState.OFF
    assert plan.states[at("05:55")] is TickState.OFF
    assert (plan.work_minutes, plan.adosh_rest_minutes, plan.art18_minutes, plan.stopped_minutes) == (60, 30, 60, 0)
    assert plan.local_date == SUMMER
    assert plan.start_utc == START_UTC  # 04:00 Asia/Dubai is 00:00 UTC
    assert plan.restrictions == ()
    assert plan.restricted_headcount == 0
    assert plan.status == "rule"


def test_plan_from_segments_keeps_work_typed_in_the_ban_window_so_p_h1_fires() -> None:
    segments = parse_roster("12:00-13:00 work")
    plan = plan_from_segments(segments, local_date=SUMMER, tz=DUBAI)
    assert plan.states[at("12:30")] is TickState.WORK
    result = run_validator(plan, uniform(Zone.LOW), crew_of(workload="light"))
    assert "P-H1" in ids(result)


def test_plan_from_segments_ban_window_ticks_nobody_typed_are_not_work() -> None:
    segments = parse_roster("06:00-12:30 work\n15:00-17:00 work")
    plan = plan_from_segments(segments, local_date=SUMMER, tz=DUBAI)
    assert plan.states[at("12:30")] is TickState.OFF
    assert plan.states[at("14:55")] is TickState.OFF
    assert plan.states[at("15:00")] is TickState.WORK
