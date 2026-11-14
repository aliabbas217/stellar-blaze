# ADR 0055: Defer PHS from the B3 level path; the ADR 0039 consumer mapping is built with the first consumer

- **Status:** Accepted (Ali, 2026-11-14); previously Proposed-for-Ali
- **Date:** 2026-11-14
- **Deciders:** the B3 architect (Claude); Ali to accept
- **Supersedes / superseded by:** none. Defers ADR 0039 decision 3's "B3 carries a test for this mapping" until a consumer exists (ADR 0039's own revisit trigger is "B3 consumes PHS").
- **Evidence:** ADR 0006 (PHS is advisory; NIOSH and TWL drive levels); ADR 0039 (`exceeds_model_range` → most severe band; `t_re_c` not monotone, not a severity scale; first call ≈ 70 s worst case); ADR 0046 (levels come from TWL zones only); the nine core views show no PHS number.

## Decision
B3 does not call `PhsRunner` from any route, job or level computation. Code that would consume PHS must, in the same change, add the `exceeds_model_range` → Red mapping and its test (ADR 0039 §3) and the `PhsRunner.start()` warm-up (parking-lot row).

## Consequences
- **Cost of being wrong:** the demo has no PHS "time to limit" readout. No warning depends on PHS, so no warning can be lost to a PHS rejection.

## Revisit trigger
A view shows PHS duration limits; a pilot supplies body data.

## Links
[ADR 0006](0006-physics-wbgt-phs-niosh-twl.md) · [0039](0039-phs-exceeds-model-range-is-the-most-severe-band.md) · [0046](0046-warning-level-policy.md)

## Amendments
- **2026-11-14 (acceptance; decision text unchanged).** Accepted by Ali in chat (ADRs 0046-0058, all 13). Status changed from Proposed-for-Ali. Nothing else changed.
