# ADR 0017: Cut the Challenge 06 population view (plan §8.10)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none (plan §6 "could have"; roadmap §7 stretch item 2)
- **Evidence:** `docs/research/2026-11-11-judges-and-wow-moment.md` §0 item 6, §3 (row "population view"), §9.2 (regulator-view line); `docs/context/challenge-07-plan.md` §8.10 and §7 "Solo scope cuts"; roadmap "Decisions recorded 2026-11-11"

## Context
§8.10 adds anonymous area aggregates with EARS C2/C3, CUSUM and Farrington spike detection, scored on injected events. There are no real outcome data, so every number would be synthetic. Judges §3: impact 1-2, 1.5-2 days.

## Options considered
| Option | Verdict |
|---|---|
| Build with injected test events | Rejected: synthetic-only evaluation, off the wow path |
| Cut; keep a "regulator view" roadmap line on k-suppressed aggregates (chosen) | Accepted |

## Decision
Not built. The HSE route shows k-suppressed site aggregates only (ADR 0011 §7.6).

## Consequences
- **Cost of being wrong:** no link to Challenge 06 for judges reading across statements. Low: the top three is chosen across all statements on depth (Judges §0).

## Revisit trigger
ADPHC interest plus a data-sharing agreement that supplies real incident or clinic-visit counts.

## Links
[ADR 0034](0034-demo-strategy.md) · [ADR 0011](0011-heat-aware-planner.md)
