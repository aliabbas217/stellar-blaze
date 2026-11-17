# ADR 0015: Cut the LLM supervisor copilot and the shift-plan drafter agent; keep the compliance-report drafter

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Narrows plan §8.6 and E4 (three bounded agents). Judges v1 §3 cut all three; Judges v2 (changelog item 5) keeps the compliance drafter, and that is what is recorded here
- **Evidence:** `docs/research/2026-11-11-judges-and-wow-moment.md` §0 item 6, §3 (row "LLM copilot / compliance agent / shift drafter"), §10 (compliance drafter row); ADR 0010 §8; ADR 0011 v2 §7.7 (the planner has no LLM) and "Conflicts" row 6; roadmap "Decisions recorded 2026-11-11" ("Compliance-report LLM kept (aggregate data only, outside the demo spine)")

## Context
The plan proposed three tool-using, human-approved agents. Judges §3: the chatbot or copilot is the archetype every strong entry will bring (distinctiveness 0), costs 1.5-2 days plus an in-UAE GPU story, and is "a governance liability". A copilot that answers questions about crews would touch `Personal` data, which ADR 0010 §8 confines to self-hosted models. No in-UAE GPU is budgeted ($4.576/h, deployment doc §6.3).

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| All three agents | 1.5-2 days; Personal-data routing needs a self-hosted GPU | Rejected |
| No LLM at all (Judges v1) | Loses one bounded, aggregate-only feature that ADR 0010 already designed for | Rejected |
| Keep only the compliance-report drafter over k-suppressed aggregates, outside the demo spine (chosen) | `LlmInput[NonPersonal]` only; kill switch `compliance_drafter_enabled` (default false) | Accepted |

## Decision
- **Cut:** the supervisor copilot and the shift-plan drafter (the planner stays rule-based, ADR 0011).
- **Kept:** the compliance-report drafter, aggregates only, routed per ADR 0010 §8, not in the demo spine, and the first thing dropped if B3 slips (Judges §10).
- The GPU VM for a self-hosted LLM stays parked (ADR 0031).

## Consequences
- The `LlmClient` port is built only for the drafter. ADR 0002's trigger ("the copilot or compliance-report agent is greenlit") has therefore fired for that one feature.
- Pitch: "no LLM touches a warning or a plan" becomes a governance point.
- **Cost of being wrong:** judges who expect an assistant see none, and time-poor supervisors get no natural-language Q&A. Moderate for "innovation" impressions; nil for safety.

## Revisit trigger
After submission: a pilot asks for Arabic/Urdu supervisor Q&A **and** an in-UAE self-hosted route exists (ADR 0010 §8) **and** an eval run passes. For the shift drafter, additionally a measured gain over the rule planner on the ADR 0011 §9 metrics.

## Links
[ADR 0010 §8](0010-runtime-tunable-configuration.md) · [ADR 0011](0011-heat-aware-planner.md) · [ADR 0002](0002-infra-minimalism-and-ports.md) · [ADR 0031](0031-defer-azure-extras.md)
