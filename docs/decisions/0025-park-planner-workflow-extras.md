# ADR 0025: Park the planner's workflow extras (stability engine, anomaly flag, second approver, pay-block, full CP-SAT constraint set)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Records ADR 0011 v2 §1 "Cut / parked" row as one grouped decision; each item has its own heading below
- **Evidence:** `docs/research/2026-11-11-planner-adversarial-review.md` C5 (cuts 1-5), M1, I7; ADR 0011 v2 §1, §6, §7.3-§7.4, §5; `docs/research/scripts/roster/within_shift_legal.py` (`results/within_shift_legal_output.txt`); roadmap "Decisions recorded 2026-11-11" (smaller planner scope accepted)

## Context
Review C5: the planner has one day (16 Nov) that also holds governance, API routes and the config admin API. The must-have set in the design notes was 1.5-2 days (12 components, 21 acceptance tests, 6 endpoints). Once the seasonal service is cut (ADR 0024) there is no roster publication, so every workflow around publication has nothing to act on. Shared context and decision; one heading per item.

## Items

### A. Roster stability engine and SS1-SS7 metrics
Hysteresis ≤ 1 change/month, 7-day freeze, 14-day notice, ≤ 30-min drift, exposure-reducing changes exempt. **Parked**: kept as POLICY text in ADR 0011 §6. **Trigger:** the roster recommender (ADR 0024) is built.

### B. Edit-to-green anomaly flag
**Parked** (Review C5 cut 2). The input-change audit row stays (ADR 0011 §7.4). If built, flag any protection-lowering edit since the last accepted plan, not a 24 h window (Review M1). **Trigger:** before any pilot, or a reviewer asks how gaming is detected.

### C. HSE second approver for protection-lowering edits
**Parked** with B, same trigger.

### D. Pay-block workflow
Publication blocked on paid-hour loss until employer attestation. **Cut**: pay impact is display-only and must never block an exposure-reducing change or a stop (ADR 0011 §7.3, Review I7). **Trigger:** roster publications are built **and** counsel answers Q5 (are ADOSH rest and heat stops paid time).

### E. CP-SAT full constraint set
Fairness spread, shelter capacity, fixed-duration pours, precedences, crew rotation, stability vs the previous plan. **Parked**: the simple CP-SAT sequencer is itself SHOULD (17 Nov); ordering gains on legal shifts are 1.3-5.9% over heavy-first (`within_shift_legal.py`). **Trigger:** the SHOULD sequencer ships and a pilot supplies real task lists with dependencies.

## Options considered
| Option | Verdict |
|---|---|
| Build all of A-E on 16-17 Nov | Rejected: does not fit (Review C5) |
| Rule planner + validator MUST, CP-SAT simple SHOULD, A-E parked (chosen) | Accepted |

## Consequences
- **Never cut** (Review C5): P-H1-P-H8 in the ruleset, the validator, no-added-minutes, the banner, employer scoping, k-suppression, determinism.
- **Cost of being wrong:** a pilot reviewer finds no anti-gaming control beyond the audit row (B, C) and no rotation fairness (E). Low for the demo; B/C must exist before any pilot.

## Revisit trigger
Per item above.

## Links
[ADR 0011](0011-heat-aware-planner.md) · [ADR 0024](0024-cut-seasonal-roster-service.md) · [ADR 0026](0026-park-planner-modelling-extensions.md)
