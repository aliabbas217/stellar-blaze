# ADR 0056: Defer the compliance-report LLM drafter (and the LLM routing it needs) out of B3

- **Status:** Accepted (Ali, 2026-11-14); previously Proposed-for-Ali
- **Date:** 2026-11-14
- **Deciders:** the B3 architect (Claude); Ali to accept
- **Supersedes / superseded by:** defers the B3 items of roadmap §5 "LLM routing (ADR 0010 §8), only for the kept compliance-report drafter". ADR 0015 (drafter kept) and ADR 0010 §8 (PERSONAL self-hosted only) stand unchanged; this is a timing deferral, not a cut.
- **Evidence:** Ali's scope ("kept but outside the demo spine; give it a thin task only if it fits"); B3 budget 15-17 Nov with the CP-SAT SHOULD already in the 17 Nov slot and dropped at 15:00 if MUST is red; the drafter's input (k-suppressed HSE aggregates) has no view in F2 scope; `llm` is an optional dependency group, not installed in the image.

## Decision
No `LlmClient` port, route catalog, `llm_routes` field, PII detector or drafter in B3. The k-suppression module (ADR 0050) is built so the drafter's builder can use it later. No `compliance_drafter_enabled` flag is added (a flag is added with the code it gates, ADR 0010 §7).

## Consequences
- **Cost of being wrong:** the submission cannot show an LLM feature. The technical document describes the drafter as designed (ADR 0010 §8, 0015) and the roadmap screen stamps it DESIGNED.

## Revisit trigger
B3 MUST and CP-SAT are both green before 17 Nov 15:00 with an idle lane; or after submission.

## Links
[ADR 0010](0010-runtime-tunable-configuration.md) §8 · [0015](0015-cut-llm-copilot-and-shift-drafter.md) · [0050](0050-crew-timeline-and-k-suppression-semantics.md)

## Amendments
- **2026-11-14 (acceptance; decision text unchanged).** Accepted by Ali in chat (ADRs 0046-0058, all 13). Status changed from Proposed-for-Ali. Nothing else changed.
