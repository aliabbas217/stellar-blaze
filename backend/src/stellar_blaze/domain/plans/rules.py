"""``PlannerRules``: the ruleset-derived values that the planner and the validator both read (ADR 0011 section 3).

Built once from a ruleset and the effective tunables by ``planner_rules``. It holds the zone caps and cycles of ADOSH
Table 1, the labour section (ban window, Art. 18 limits, juvenile limits), the acclimatization ramp tables and the
lone-work minimum. It does NOT implement the rolling 60-minute window: the planner and the validator each implement it
independently from the same definitions, so that one cannot hide a bug in the other.
"""

from dataclasses import dataclass

from stellar_blaze.domain.config.runtime import EffectiveParams
from stellar_blaze.domain.plans.model import Workload
from stellar_blaze.domain.risk.levels import Zone
from stellar_blaze.domain.rules.ruleset import (
    Acclimatisation,
    AdoshCycles,
    LabourRules,
    Ruleset,
    RulesetIncompleteError,
)

_HOUR_MINUTES = 60


@dataclass(frozen=True)
class PlannerRules:
    """The rules of a plan. Built by ``planner_rules``; frozen, so a plan and its check read the same values."""

    labour: LabourRules
    cycles: AdoshCycles
    acclimatisation: Acclimatisation
    lone_work_min_headcount: int
    low_zone_voluntary_rest_min: int

    def _column(self, workload: Workload) -> str:
        """The Table 1 column of a workload class: moderate reads the heavy column (a protective reading, a floor)."""
        if workload == "moderate":
            return "heavy" if self.cycles.moderate_uses_heavy else "light"
        return workload

    def cycle(self, zone: Zone, workload: Workload) -> tuple[int, int] | None:
        """The ``(work, rest)`` cycle in minutes that ADOSH Table 1 prescribes, or ``None`` when work is self-paced.

        Low has no imposed cycle, Medium has one for heavy work only, High has one for light and one for heavy work;
        Red is a stop, not a cycle.
        """
        heavy = self._column(workload) == "heavy"
        c = self.cycles
        match Zone(zone):
            case Zone.MEDIUM if heavy:
                return (c.medium_heavy_work_min, c.medium_heavy_rest_min)
            case Zone.HIGH if heavy:
                return (c.high_heavy_work_min, c.high_heavy_rest_min)
            case Zone.HIGH:
                return (c.high_light_work_min, c.high_light_rest_min)
            case _:
                return None

    def cap_minutes(self, zone: Zone, workload: Workload) -> int:
        """Most work minutes in any 60-minute window whose most severe zone is ``zone`` (ADR 0011 section 2).

        Low is 60 minus the voluntary rest tunable, Medium is 60 for light work and the cycle's work length for heavy
        work, High is the cycle's work length, Red is 0.
        """
        zone = Zone(zone)
        if zone is Zone.RED:
            return 0
        cycle = self.cycle(zone, workload)
        if cycle is not None:
            return min(cycle[0], _HOUR_MINUTES)
        if zone is Zone.LOW:
            return _HOUR_MINUTES - self.low_zone_voluntary_rest_min
        return _HOUR_MINUTES


def planner_rules(ruleset: Ruleset, params: EffectiveParams) -> PlannerRules:
    """The ``PlannerRules`` of a ruleset and the effective tunables.

    Raises:
        RulesetIncompleteError: The ruleset predates the B3 sections it needs (``ae-heat-0.1`` has none of them).
        ValueError: The voluntary Low-zone rest is outside ``[0, 60)`` minutes.
    """
    labour, cycles, acclimatisation = ruleset.labour, ruleset.adosh_cycles, ruleset.acclimatisation
    if labour is None or cycles is None or acclimatisation is None:
        missing = [
            name
            for name, section in (("labour", labour), ("adosh_cycles", cycles), ("acclimatisation", acclimatisation))
            if section is None
        ]
        raise RulesetIncompleteError(f"ruleset {ruleset.meta.id} has no section {', '.join(missing)}")
    if not 0 <= params.low_zone_voluntary_rest_min < _HOUR_MINUTES:
        raise ValueError(f"low_zone_voluntary_rest_min must be in [0, 60), got {params.low_zone_voluntary_rest_min}")
    return PlannerRules(
        labour=labour,
        cycles=cycles,
        acclimatisation=acclimatisation,
        lone_work_min_headcount=cycles.lone_work_min_headcount,
        low_zone_voluntary_rest_min=params.low_zone_voluntary_rest_min,
    )
