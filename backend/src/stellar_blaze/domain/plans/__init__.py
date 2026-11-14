"""Crew plan types, planner rules and the 5-minute tick grid, shared by the planner and the validator.

The planner and the validator share only what is in this package: the types (``model``), ``PlannerRules`` (``rules``)
and the zone timeline (``ticks``). Nothing here may import ``stellar_blaze.domain.planner`` or
``stellar_blaze.domain.validator``, directly or indirectly.
"""
