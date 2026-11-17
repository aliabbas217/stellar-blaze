# ADR 0018: Cut the DRN (distributional regression network) comparator

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none (ADR 0007: "a small DRN ... is a stretch"; roadmap §4 stretch)
- **Evidence:** ADR 0007 Context and Revisit trigger; `docs/context/challenge-07-plan.md` E1; `docs/research/2026-11-11-judges-and-wow-moment.md` §3 (row "DRN comparator ..."), §10; roadmap "Decisions recorded 2026-11-11"

## Context
With about 1,000-1,300 effective station-days (ADR 0005), published comparisons put gradient boosting within a few percent of neural post-processors (plan E1: Rasp & Lerch 2018; Schulz & Lerch 2022). The DRN was there only "to show we checked". Judges §3: impact 1, 0.5-1 day.

## Options considered
| Option | Verdict |
|---|---|
| Train a torch-CPU DRN in the `drn` group | Rejected: the literature already answers the question at this sample size |
| Cut; name it under "not done" in the evaluation report (chosen) | Accepted |

## Decision
Not built. The evaluation report lists it as not done, with the literature reason.

## Consequences
- The `drn` dependency group and the torch CPU wheel stay out of the lock.
- **Cost of being wrong:** a methods judge may ask "did you try a neural model?" and gets a citation, not a number. Low.

## Revisit trigger
More stations or years (ADR 0007 trigger), or the 2026 evaluation shows LightGBM coverage failures that a parametric model might fix.

## Links
[ADR 0007](0007-ml-quantile-corrector-conformal.md) · [ADR 0005](0005-data-truth-features-and-validation.md)
