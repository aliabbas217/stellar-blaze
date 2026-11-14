"""The types of a crew day plan: tick states, shifts, crews, the zone timeline and the plan itself.

A day is a grid of 216 five-minute ticks from 04:00 local (``ticks.day_ticks``). Every instant is timezone-aware UTC;
shift times are local ``time`` values converted with the site's ``ZoneInfo`` at the edge. Pure data: the only behavior
here is ``ZoneTimeline``'s length checks and ``with_zones``.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, time
from enum import StrEnum
from typing import Literal, Self

from stellar_blaze.domain.risk.levels import Zone

Workload = Literal["light", "moderate", "heavy"]


class TickState(StrEnum):
    """What a crew does in one tick; the values are the snake_case wire values."""

    WORK = "work"
    ADOSH_REST = "adosh_rest"
    ART18_BREAK = "art18_break"
    BAN = "ban"
    STOPPED = "stopped"
    OFF = "off"


@dataclass(frozen=True)
class ShiftBlock:
    """One block of a published shift in site-local wall time; ``end`` is exclusive."""

    start: time
    end: time


@dataclass(frozen=True)
class CrewMember:
    """One member of a crew: the inputs of the acclimatization and juvenile rules. PERSONAL data class, ADR 0010 §8.

    These values live only in ``crew_member`` and this type. No API schema, export or log line may carry them or any
    per-member value derived from them.
    """

    days_on_site: int
    days_away: int
    away_reason: Literal["leave", "illness", "none"]
    experienced: bool
    juvenile: bool


@dataclass(frozen=True)
class CrewSpec:
    """A crew and its published shift. ``members=None`` means "all acclimatized experienced adults" (try-a-plan)."""

    crew_id: str
    employer_id: str
    workload: Workload
    headcount: int
    shift: tuple[ShiftBlock, ...]
    days_per_week: int
    members: tuple[CrewMember, ...] | None = None


@dataclass(frozen=True)
class ZoneTimeline:
    """The zone of every tick of a local day, with the heat value behind it.

    ``zones[i]`` is the zone of the tick that starts at ``start_utc + 5 min * i``; ``fallback[i]`` is true where the
    tick had no value and was made ``HIGH`` instead (a missing or stale forecast is never "no constraint").
    ``protective_twl_w_m2[i]`` is the interpolated protective effective TWL of the tick, NaN where there is none; the
    planner uses it only to place the Art. 18 break at the hottest window. All four sequences have one entry per tick.
    Use ``with_zones`` (or ``dataclasses.replace``) to change zones, for instance a crew-lead stop that turns ticks
    ``RED``, without touching the TWL series.
    """

    start_utc: datetime
    zones: tuple[Zone, ...]
    fallback: tuple[bool, ...]
    source: Literal["forecast", "truth", "fallback"]
    protective_twl_w_m2: tuple[float, ...]

    def __post_init__(self) -> None:
        if self.start_utc.tzinfo is None or self.start_utc.utcoffset() is None:
            raise ValueError("start_utc must be timezone-aware")
        if not len(self.zones) == len(self.fallback) == len(self.protective_twl_w_m2):
            raise ValueError(
                "zones, fallback and protective_twl_w_m2 must have the same length, got "
                f"{len(self.zones)}, {len(self.fallback)} and {len(self.protective_twl_w_m2)}"
            )

    @classmethod
    def from_zones(
        cls,
        start_utc: datetime,
        zones: Sequence[Zone | int],
        *,
        fallback: Sequence[bool] | None = None,
        protective_twl_w_m2: Sequence[float] | None = None,
        source: Literal["forecast", "truth", "fallback"] = "forecast",
    ) -> Self:
        """A timeline from a list of zones (tests, crew-lead stops): no fallback and no TWL values unless given."""
        n = len(zones)
        return cls(
            start_utc=start_utc,
            zones=tuple(Zone(z) for z in zones),
            fallback=tuple(fallback) if fallback is not None else (False,) * n,
            source=source,
            protective_twl_w_m2=tuple(protective_twl_w_m2) if protective_twl_w_m2 is not None else (math.nan,) * n,
        )

    def with_zones(self, zones: Sequence[Zone | int]) -> Self:
        """The same timeline with other zones: ``fallback``, the TWL series, ``source`` and the clock are kept.

        Raises:
            ValueError: ``zones`` does not have one zone per tick.
        """
        if len(zones) != len(self.zones):
            raise ValueError(f"with_zones needs one zone per tick ({len(self.zones)}), got {len(zones)}")
        return replace(self, zones=tuple(Zone(z) for z in zones))


@dataclass(frozen=True)
class CrewPlan:
    """The planned state of every tick of one crew's day, with the rules that fired and the minute counters."""

    crew_id: str
    local_date: date
    start_utc: datetime
    states: tuple[TickState, ...]
    rule_ids: tuple[str, ...]
    status: Literal["rule", "fallback"]
    restricted_headcount: int
    restrictions: tuple[str, ...]
    work_minutes: int
    adosh_rest_minutes: int
    art18_minutes: int
    stopped_minutes: int
