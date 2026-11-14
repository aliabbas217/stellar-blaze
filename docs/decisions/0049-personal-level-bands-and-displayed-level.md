# ADR 0049: Personal (on-device) level bands 0.10 / 0.50 / 0.90; the screen leads with the more severe of site and personal; ties resolve to 0.50

- **Status:** Accepted (Ali, 2026-11-14); previously Proposed-for-Ali
- **Date:** 2026-11-14
- **Deciders:** the B3 architect (Claude); Ali to accept
- **Supersedes / superseded by:** replaces the F1 placeholder bands (0 / 0.10 / 0.30 / 0.60, `frontend/src/mocks/fixtures.ts`). Answers F1 questions 3, 4 and 5 (`.superpowers/sdd/f1-summary.md`, "Questions for B3").
- **Changes a pre-registration freeze value:** no (no personal metric is pre-registered).
- **Evidence:** ADR 0004 §2 (personal risk computed on the phone, never sent); F1 `src/features/risk/exceedance.ts` (3-quantile CDF; `limit === p50 → 0.50`; outputs in [0.05, 0.95], the 0.95 end a lower bound) and `personal.ts` (`bandLevel`: highest band minimum at or below the probability; `displayedLevel` = more severe); ADR 0006 NIOSH vectors (180/300/415 W); CoP 3.2(b)(i) (heavy work after 5-7 days).

## Decision
1. **Bands** (tunables, class b, POLICY [I]): `personal_band_amber` 0.10 [0.05, 0.30], `personal_band_orange` 0.50 [0.30, 0.70], `personal_band_red` 0.90 [0.70, 0.95], all `safer = "lower"`; green starts at 0. Reading: Amber = a 1-in-10 chance of being over your NIOSH limit (mirrors the one-sided 90% of the plan); Orange = more likely than not; Red = near certain. `resolve_effective` rejects a config where they are not strictly increasing.
2. **No band minimum above 0.95** (structural, enforced by the range): the device's exceedance cannot resolve above its 0.95 lower bound, so a higher band would under-classify.
3. **Tie rule confirmed (F1 R40):** a limit exactly at p50 gives 0.50; band selection is inclusive (probability equal to a band minimum takes that band).
4. **Displayed level = the more severe of site and personal (confirmed).** Site Red (stop) always wins over a personal Green; a personal Orange on a Green site shows Orange. Null on one side shows the other.
5. **`acclimatisation_days_required = 7`** (the protective end of "5-7 days", the same value as the planner's heavy-work rule); before it the device uses the RAL.
6. **Parity:** B3 publishes `backend/tests/fixtures/risk/personal_level_vectors.json` (inputs, expected probability to 1e-9, expected level), produced by a Python mirror of the device functions. F2 runs the same file in Vitest.

## Consequences
- **Cost of being wrong:** bands too loose → a worker's own level reads milder than it is; but the site level (ADOSH, θ-scored) still leads whenever it is more severe. Bands are unscored, so they are labelled "policy, not validated".
- Two different physical bases (site: TWL; personal: NIOSH WBGT) meet on one screen; the "Why?" text names both.

## Revisit trigger
A clinical review (ADR 0035) or pilot data on how workers read the levels; NIOSH exceedance metrics are added to an evaluation.

## Links
[ADR 0004](0004-tiered-alert-delivery.md) · [0046](0046-warning-level-policy.md) · [0010](0010-runtime-tunable-configuration.md)

## Amendments
- **2026-11-14 (acceptance; decision text unchanged).** Accepted by Ali in chat (ADRs 0046-0058, all 13). Status changed from Proposed-for-Ali. Nothing else changed.
