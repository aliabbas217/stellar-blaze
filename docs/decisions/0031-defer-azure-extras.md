# ADR 0031: Defer Azure extras: GPU VM for a self-hosted LLM, UAE Central region (Microsoft for Startups is in ADR 0001)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Follows from ADR 0001 (single region, UAE North) and ADR 0015 (copilot cut); one heading per item
- **Evidence:** `docs/research/2026-11-11-deployment-options.md` §2, §6.3, §11 ("Parking-lot entries to add"); ADR 0001 Rejected options (Microsoft for Startups)

## Context
Stage 1 is one region and a $75/month budget alert (ADR 0001). No demo feature needs a GPU once the copilot is cut (ADR 0015) and the drafter uses `NonPersonal` data only (ADR 0010 §8).

## Items
| Item | Evidence | Revisit trigger |
|---|---|---|
| **GPU VM in UAE North** for a self-hosted LLM | $4.576/h, quota unchecked (deployment §6.3); no Personal-data LLM feature in scope | A Personal-data LLM feature or the copilot ships beyond the video |
| **UAE Central (Abu Dhabi) region** | Restricted access, no availability zones (deployment §2, §11) | A DR pair or an Abu Dhabi-specific requirement |
| Microsoft for Startups credits | Decided in ADR 0001 Rejected options (needs a registered company and a fresh Microsoft account) | A company exists or a pilot needs credits |

## Options considered
| Option | Verdict |
|---|---|
| Provision now "to be ready" | Rejected: cost and quota risk for no demo need |
| Defer with triggers (chosen) | Accepted |

## Decision
Neither the GPU VM nor UAE Central is used for the submission.

## Consequences
- The development LLM for any `Personal` experiment is the local RTX 3080 (ADR 0010 §8), never production.
- **Cost of being wrong:** a judge asks "where does the LLM run in the UAE?"; the answer is the ADR 0010 §8 route design with no running instance. Low.

## Revisit trigger
Per item above.

## Links
[ADR 0001](0001-hosting-azure-uae-north.md) · [ADR 0010 §8](0010-runtime-tunable-configuration.md) · [ADR 0015](0015-cut-llm-copilot-and-shift-drafter.md)
