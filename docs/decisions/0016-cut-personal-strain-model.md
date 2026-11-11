# ADR 0016: Cut the personal strain model (plan §8.7)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none (plan §6 "could have"; roadmap §7 stretch item 1)
- **Evidence:** `docs/research/2026-11-11-judges-and-wow-moment.md` §0 item 6, §3 (row "Personal strain model"), §9.2 (roadmap line "consented wearable signal"); `docs/context/challenge-07-plan.md` §8.7 (patent caution, simulated validation only) and §7 "Solo scope cuts" (first to cut); roadmap "Decisions recorded 2026-11-11"

## Context
§8.7 is a Bayesian state-space model (PHS as the process model, a particle filter on consented heart rate). It can only be validated on **simulated** workers, has no freedom-to-operate analysis against the Buller patent, and PHS returns NaN for about 19.6% of inputs even inside nominal ranges (ADR 0006). Judges §3: impact 1-2, distinctiveness 0-1, 1.5-2 days.

## Options considered
| Option | Verdict |
|---|---|
| Build behind a flag with simulated validation | Rejected: the claim would rest on our own simulator, the opposite of the wow (ADR 0034) |
| Cut; show it as a roadmap line via the existing `ObservationSource` port (chosen) | Accepted |

## Decision
Not built. It appears on the roadmap screen as "designed, needs pilot".

## Consequences
- Personal risk stays the NIOSH/TWL calculation on the device (ADR 0004 Tier B).
- **Cost of being wrong:** judges looking for personalisation see a weather-and-workload model only, and wearable entries look more "personal". Accepted: their physiology is simulated, our numbers are instrument-scored.

## Revisit trigger
A pilot employer with consented wearables, plus a freedom-to-operate check against the Buller patent (plan F8).

## Links
[ADR 0034](0034-demo-strategy.md) · [ADR 0004](0004-tiered-alert-delivery.md) · [ADR 0006](0006-physics-wbgt-phs-niosh-twl.md)
