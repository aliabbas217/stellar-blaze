"""The independent plan validator and the roster-text parser (ADR 0011 section 3).

This package shares only ``domain.plans`` (types, ``PlannerRules``, tick helpers), ``domain.risk`` (``Zone``) and the
ruleset types with the rule planner. It must never import ``stellar_blaze.domain.planner`` or
``stellar_blaze.adapters.compute``, directly or indirectly (import-linter contract 7), so that a bug in the planner
cannot hide a bug here. Nothing outside this package's callers re-exports it from ``domain.plans``.
"""
