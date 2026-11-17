# ADR 0020: Cut the AIFS-feature corrector (keep the raw IFS vs AIFS comparison)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none (ADR 0005: AIFS "as a stretch corrector feature"; roadmap §4 stretch)
- **Evidence:** ADR 0005 (AIFS only 2025-2026, one summer of training); `docs/research/2026-11-11-data-availability.md` §3.1, §3.3; `docs/research/2026-11-11-judges-and-wow-moment.md` §3 (row 6 keeps the raw comparison; cut row), §10; roadmap §7 never-cut item 3

## Context
Archived AIFS forecasts exist only for 2025-2026, so a corrector with AIFS features trains on one summer (2025) and is tested on 2026 across a model version change (AIFS v1 to v2). The raw IFS vs AIFS comparison on Gulf humidity is new evidence and stays never-cut.

## Options considered
| Option | Verdict |
|---|---|
| Train with AIFS features | Rejected: one training summer, version change at test time |
| Cut the corrector variant; keep the raw comparison (chosen) | Accepted |

## Decision
The corrector uses IFS + GFS features (ADR 0005). AIFS is ingested for the raw comparison only.

## Consequences
- **Cost of being wrong:** if AIFS humidity is much better, a multi-model corrector that includes it could beat ours. The raw comparison will show that, and it becomes the next experiment.

## Revisit trigger
The raw comparison shows AIFS beating IFS on daytime Td by more than the METAR rounding noise (about 0.29 °C, ADR 0005), and a second AIFS v2 summer (2027) exists.

## Links
[ADR 0005](0005-data-truth-features-and-validation.md) · [ADR 0007](0007-ml-quantile-corrector-conformal.md)
