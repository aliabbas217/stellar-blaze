# ADR 0024: Cut the seasonal roster recommender service; ship the static roster-frontier analysis instead

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Replaces the Layer S service of ADR 0011 v1 (v1 was Proposed and replaced in place by v2)
- **Evidence:** ADR 0011 v2 Context finding 1, §1 (MUST static chart), §6, §10 last row; `docs/research/2026-11-11-planner-adversarial-review.md` C3, C5 cut 1; `docs/research/scripts/roster/legal_sleep_templates.py` v2 and `results/roster_frontier.json`, `results/legal_sleep_templates_output.txt`; roadmap "Decisions recorded 2026-11-11"

## Context
Under legal 8 h templates (Art. 17/18), a clock-time sleep model (bedtime floor 21:30 [I]) and the do-no-harm guard, the recommender says "no change" in **18/18 folds at commutes ≥ 30 min**. The binding constraint is the commute, not the roster shape. The residual sleep-neutral gain at ≥ 30 swings from 0% to 10% with the assumed bedtime, so it is not claimable. Review C5: the service (scorer, `roster-options` / `roster-publications` endpoints, publication tables, hysteresis engine) did not fit the one-day planner slot.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| Recommender as a service with publication workflow | About 0.5 day; recommends "no change" for the realistic case | Cut |
| Drop the seasonal question entirely | Loses an honest negative result that reads as competence (Judges §8.1 artefact 3) | Rejected |
| Static frontier chart from `roster_frontier.json`, no endpoint beyond serving the JSON (chosen) | ~2 h; MUST in ADR 0011 | Accepted |

## Decision
No roster service. One chart: E30 per worked hour vs sleep for 14,596 legal templates, commute slider, B0 and B1 marked, the legalisation arrow credited to the law (ADR 0034). The do-no-harm guard stays a class (d) rule for any future recommender.

## Consequences
- The stability engine, publication workflow and pay-block are parked with it (ADR 0025).
- **Cost of being wrong:** a site with a short commute (≤ 15 min, where the frontier shows 10.2% / 23.6%) gets no recommendation from the product. Low for the demo; real for a pilot with on-site accommodation.

## Revisit trigger
A pilot site with a commute ≤ 15 min or on-site accommodation where the frontier shows a guarded gain; or counsel's Art. 18 answer widens the legal library.

## Links
[ADR 0011](0011-heat-aware-planner.md) · [ADR 0025](0025-park-planner-workflow-extras.md) · [ADR 0033](0033-superseded-roster-headline-numbers.md) · [ADR 0034](0034-demo-strategy.md)
