# ADR 0022: Reject the weekly (and daily) forecast-driven re-roster layer

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Records ADR 0011 v2 §10 rows 1-3 as a standalone decision
- **Evidence:** `docs/research/2026-11-11-roster-feasibility.md` §0 items 2-4, §2.2, §2.3 (noise floor), §2.4; ADR 0011 v2 §10 and "Conflicts" row 3; `docs/research/scripts/roster/results/weekly_regret.csv`, `report_2_paired_frontier.txt`; roadmap "Decisions recorded 2026-11-11" (ADR 0011 v2 scope accepted)

## Context
Ali's multi-horizon idea included a weekly layer that changes shift times from extended-range forecasts. Feasibility measured it on 2024-2026 station truth (6 clusters, day library): weekly re-roster from IFS day 1-7 vs a fixed seasonal roster gives +0.1% raw / 0.0% bias-corrected at WBGT ≥ 30 and −1.0% / −1.1% at ≥ 32, below the ~4 h/summer noise floor, for about 10 roster changes per summer. The perfect-knowledge ceiling is 0.7% / 4.8%. Daily re-roster from lead 1 gives −0.2% / −2.0%, and with night shifts in the library it is worse than fixed (+4.3%). About 5% of weeks show more than 5% regret, but no trigger predicts them.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| Weekly re-roster every week | Gain below noise; ~10 changes/summer cost schedule stability (Sleep §4.2) | Rejected |
| Exception-triggered weekly re-roster (high-regret weeks only) | Untested hypothesis; no back-tested trigger | Parked |
| Daily re-roster from lead 1 | −0.2% / −2.0%; worse with night shifts | Rejected |
| Fixed roster + forecast used for tomorrow's ADOSH zone per hour inside the shift (chosen, ADR 0011) | That is where the forecast pays | Accepted |

## Decision
Shift times are not changed by forecasts. Weekly changes happen only inside the fixed shift (task assignment, acclimatisation ramps, rest cycles; ADR 0011 "Conflicts" row 3).

## Consequences
- These horizon comparisons were made on the 8.5 h exposure-only library. Whether "fixed ≈ adaptive" holds on the legal library is **untested [I]**; it is moot for the demo because the legal library's fixed-roster gain is itself about 0 (ADR 0011 §10).
- **Cost of being wrong:** some heatwave weeks could have been eased by a shift move; the regret is about 5% of weeks. In-shift rest cycles and stop-work rules still respond to those days.

## Revisit trigger
The corrector (ADR 0007) or a new model lifts week-1 WBGT skill enough that a re-run of `roster_ladder.py` with corrected forecasts beats fixed by more than the noise floor on held-out 2026; shoulder-season replication shows larger value; or a forecast-based exception trigger is back-tested on 2024-2026 and beats fixed by more than the noise floor with at most 1 change per month.

## Links
[ADR 0011 §10](0011-heat-aware-planner.md) · [ADR 0023](0023-reject-sub-seasonal-forecasts.md) · [ADR 0024](0024-cut-seasonal-roster-service.md)
