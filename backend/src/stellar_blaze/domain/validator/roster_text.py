"""Roster text (try-a-plan, Task 10): ``HH:MM-HH:MM work|rest|break`` lines parsed and turned into a ``CrewPlan``.

The text is untrusted user input. ``parse_roster`` reports every problem with its 1-based line number over the ORIGINAL
text (blank and comment lines count as lines) and raises ``RosterParseError``; it never raises anything else.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from typing import Final, Literal
from zoneinfo import ZoneInfo

from stellar_blaze.domain.plans.model import CrewPlan, TickState
from stellar_blaze.domain.plans.ticks import TICK_MINUTES
from stellar_blaze.domain.rules.ruleset import LabourRules

MAX_LINES: Final = 40
_DAY_START_MINUTE: Final = 4 * 60
_DAY_END_MINUTE: Final = 22 * 60
_DAY_TICKS: Final = (_DAY_END_MINUTE - _DAY_START_MINUTE) // TICK_MINUTES

type RosterState = Literal["work", "rest", "break"]

_STATES: Final[dict[str, TickState]] = {
    "work": TickState.WORK,
    "rest": TickState.ADOSH_REST,
    "break": TickState.ART18_BREAK,
}
_LINE: Final = re.compile(r"(?P<start>\d{1,2}:\d{2})\s*-\s*(?P<end>\d{1,2}:\d{2})\s+(?P<state>\S+)", re.ASCII)
_TIME: Final = re.compile(r"(?P<h>\d{1,2}):(?P<m>\d{2})", re.ASCII)


@dataclass(frozen=True)
class RosterSegment:
    """One typed line: its 1-based line number, the half-open local time range and the state."""

    line: int
    start: time
    end: time
    state: RosterState


class RosterParseError(ValueError):
    """The roster text has problems; ``errors`` is ``(line number, message)`` pairs in line order."""

    def __init__(self, errors: Sequence[tuple[int, str]]) -> None:
        self.errors: tuple[tuple[int, str], ...] = tuple(errors)
        lines = "\n".join(f"  line {number}: {message}" for number, message in self.errors)
        super().__init__(f"invalid roster:\n{lines}")


def _minutes(wall: time) -> int:
    return wall.hour * 60 + wall.minute


def _parse_time(token: str) -> time | None:
    found = _TIME.fullmatch(token)
    if found is None:
        return None
    hours, minutes = int(found["h"]), int(found["m"])
    if hours > 23 or minutes > 59:
        return None
    return time(hours, minutes)


def _check_line(number: int, text: str) -> RosterSegment | str:
    """The segment of one non-blank line, or the message of its first problem."""
    found = _LINE.fullmatch(text)
    if found is None:
        return "expected 'HH:MM-HH:MM work|rest|break'"
    start, end = _parse_time(found["start"]), _parse_time(found["end"])
    if start is None or end is None:
        bad = found["start"] if start is None else found["end"]
        return f"bad time {bad!r}: hours are 0-23 and minutes 0-59"
    state = found["state"].lower()
    if state not in _STATES:
        return f"unknown state {found['state']!r}: use work, rest or break"
    if _minutes(start) >= _minutes(end):
        return "the start must be before the end"
    if _minutes(start) % TICK_MINUTES or _minutes(end) % TICK_MINUTES:
        return f"times must be multiples of {TICK_MINUTES} minutes"
    if _minutes(start) < _DAY_START_MINUTE or _minutes(end) > _DAY_END_MINUTE:
        return "times must lie within 04:00-22:00"
    return RosterSegment(line=number, start=start, end=end, state=state)  # type: ignore[arg-type]


def parse_roster(text: str) -> tuple[RosterSegment, ...]:
    """The segments of a roster text, in text order.

    One segment per non-blank line ``HH:MM-HH:MM work|rest|break`` (state case-insensitive; ``#`` starts a comment),
    start before end, on the 5-minute grid within 04:00-22:00, no overlap between lines, at most ``MAX_LINES`` lines. An
    empty roster (no segment at all) is an error too.

    Raises:
        RosterParseError: Any of the above is violated; ``errors`` lists every problem with its line number (the
            scan stops at the first line beyond the limit).
    """
    segments: list[RosterSegment] = []
    errors: list[tuple[int, str]] = []
    count = 0
    for number, raw in enumerate(text.split("\n"), start=1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        count += 1
        if count > MAX_LINES:
            errors.append((number, f"too many segments (at most {MAX_LINES} lines)"))
            break
        checked = _check_line(number, line)
        if isinstance(checked, str):
            errors.append((number, checked))
            continue
        clash = next((s for s in segments if checked.start < s.end and s.start < checked.end), None)
        if clash is not None:
            errors.append((number, f"overlaps line {clash.line}"))
            continue
        segments.append(checked)
    if not errors and not segments:
        errors.append((1, "the roster has no segments"))
    if errors:
        raise RosterParseError(errors)
    return tuple(segments)


def plan_from_segments(
    segments: Sequence[RosterSegment],
    *,
    local_date: date,
    tz: ZoneInfo,
    labour: LabourRules,
) -> CrewPlan:
    """The day plan a roster text states: ``work`` is ``WORK``, ``rest`` ``ADOSH_REST``, ``break`` ``ART18_BREAK``.

    Ticks that no line covers are ``OFF``. Nothing is rewritten for the ban: a ``work`` typed into the midday ban
    window stays ``WORK`` so that the validator's ``P-H1`` fires on it. ``labour`` is part of the call contract (Task 10
    passes the ruleset's labour section) but no ban state is derived from it, because the validator reads the ban
    window from the same section itself. The plan declares no restrictions: it is a raw typed plan to be validated.
    """
    del labour  # accepted for the call contract; ban ticks are deliberately left as typed (see the docstring)
    states = [TickState.OFF] * _DAY_TICKS
    for segment in segments:
        first = (_minutes(segment.start) - _DAY_START_MINUTE) // TICK_MINUTES
        last = (_minutes(segment.end) - _DAY_START_MINUTE) // TICK_MINUTES
        for tick in range(first, last):
            states[tick] = _STATES[segment.state]

    def minutes(state: TickState) -> int:
        return TICK_MINUTES * states.count(state)

    start_utc = datetime.combine(local_date, time(4, 0), tzinfo=tz).astimezone(UTC)
    return CrewPlan(
        crew_id="roster-text",
        local_date=local_date,
        start_utc=start_utc,
        states=tuple(states),
        rule_ids=(),
        status="rule",
        restricted_headcount=0,
        restrictions=(),
        work_minutes=minutes(TickState.WORK),
        adosh_rest_minutes=minutes(TickState.ADOSH_REST),
        art18_minutes=minutes(TickState.ART18_BREAK),
        stopped_minutes=minutes(TickState.STOPPED),
    )
