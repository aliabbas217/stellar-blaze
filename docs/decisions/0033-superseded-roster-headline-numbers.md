# ADR 0033: Supersede the roster headline numbers (34.6% / 58.0% and ADR 0011 v1's 16.1% / 17.2%)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** supersedes, for any pitch or design use, the absolute roster numbers listed below. The numbers stay where they were published, marked by the erratum
- **Evidence:** erratum at the top of `docs/research/2026-11-11-roster-feasibility.md`; `docs/research/2026-11-11-planner-adversarial-review.md` C1, C2, I4, I5; ADR 0011 v2 Context table and Status line; `docs/research/scripts/roster/legal_sleep_templates.py` v2, `results/legal_sleep_templates_output.txt`, `results/within_shift_legal_output.txt`

## Context
Feasibility §0 item 1 reported that a fixed split roster (04:30-10:00 + 16:30-19:30) "avoids 34.6% of worker-hours at WBGT ≥ 30 and 58.0% at ≥ 32", with 53.1% / 83.0% (evening) and 75.0% / 98.1% (night), and an in-shift gain of 7.8%. ADR 0011 v1 quoted 16.1% / 17.2% "avoided". The Review found that these scored 8.5 h rosters with 5.5-6.5 h runs (illegal under Art. 17/18), ignored sleep (v1 credited a 19:15 bedtime), and compared against a non-compliant baseline, so they mixed the law's effect with the roster shape.

## Options considered
| Option | Verdict |
|---|---|
| Keep the 34.6% headline with caveats | Rejected: built on illegal rosters; a judge who checks Art. 18 would discard the whole entry's credibility |
| Delete the old numbers | Rejected: violates ADR 0012; hides why the design changed |
| Supersede with an erratum, keep the old text, state the robust replacements (chosen) | Accepted |

## Decision
**Superseded (never quoted again):** 34.6% / 58.0%, 53.1% / 83.0%, 75.0% / 98.1%, in-shift 7.8% (Feasibility §0, §2); 11.5% / 16.1% / 17.2% (ADR 0011 v1).

**Replacements (the only roster numbers allowed in the pitch):** legalising the common roster removes **7.5%** (≥ 30) and **19.1%** (≥ 32) of exposure per worked hour, **credited to the law, never to us** (ADR 0034); every 15 min of one-way commute costs 30 min of sleep; no roster change recommended in 18/18 folds at commutes ≥ 30 min; in-shift forecast ordering gains 1.3-5.9% on legal shifts, reported but not headlined.

**Still valid:** Feasibility's horizon comparisons (fixed ≈ monthly ≈ weekly ≈ daily) describe that library (ADR 0022).

## Consequences
- Any deck, video or doc that quotes a superseded number fails review (the D-day checklist should grep for "34.6").
- **Cost of being wrong:** the replacements are smaller and less exciting. That is the point: the larger numbers were not true under the law.

## Revisit trigger
Counsel's Art. 18 answer (ADR 0011 §12 Q1) or a calibrated sleep model (ADR 0026 item F) changes the legal library or the sleep gate; re-run `legal_sleep_templates.py` and supersede this ADR's replacement numbers by a new ADR.

## Links
[Feasibility erratum](../research/2026-11-11-roster-feasibility.md) · [ADR 0011](0011-heat-aware-planner.md) · [ADR 0022](0022-reject-weekly-and-daily-re-roster.md) · [ADR 0024](0024-cut-seasonal-roster-service.md) · [ADR 0034](0034-demo-strategy.md)
