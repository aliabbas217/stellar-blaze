# ADR 0048: θ is a runtime tunable, set to θ_protect by a config activation after the ruleset is frozen

- **Status:** Accepted (Ali, 2026-11-14); previously Proposed-for-Ali
- **Date:** 2026-11-14
- **Deciders:** the B3 architect (Claude); Ali to accept
- **Supersedes / superseded by:** none. Implements pre-registration §6.5 and §11.2.
- **Changes a pre-registration freeze value:** no value changes; it fixes **where** θ lives. `⟨theta_protect⟩` and `⟨theta_balanced⟩` are produced by the §6.5 rule, unchanged.
- **Evidence:** pre-registration §6.5 (θ grid {0.05 … 0.95}, POD ≥ 0.90, Peirce for θ_balanced, abu_dhabi LOCO OOF, 2024-2025, lead 1), §11 (ruleset frozen first, then θ); ADR 0010 §1(b) (probability bands are runtime tunables); ADR 0046 §3.

## Context
θ depends on the ruleset (margin, Red edge) but the ruleset cannot depend on θ, or its hash would change after θ is computed and the freeze order (§11.1 before §11.2) would be circular.

## Decision
1. `ae-heat-2026.1` declares `[tunables.warning_theta]`: default **0.10** (the one-sided 90% of §7.3), min 0.05, max 0.50, `safer = "lower"` (a lower θ warns more).
2. After the ruleset is released, the controller runs `sb-jobs freeze theta` (B3 Task 12) on `artifacts/eval/dev/oof_samples_abu_dhabi.parquet`. It writes `artifacts/eval/dev/theta.json` (θ_protect, θ_balanced, POD and Peirce per grid θ, n hours, provenance).
3. The freeze addendum records θ_protect and θ_balanced. Then `sb-jobs config propose/activate` sets `tunables.warning_theta = θ_protect`, and `backend/config/runtime/default.toml` gets the same value so a fresh seed matches.
4. If θ_protect falls outside [0.05, 0.50] (the rule allows 0.05-0.95), the product uses the nearest end and the report says so; the scoreboard uses the rule's value as pre-registered.
5. θ_balanced is a scoreboard operating point only; it never drives a push.

## Consequences
- The 2026 run reads θ from the freeze addendum file, never from the live config, so a later tuning cannot leak into the scored row.
- **Cost of being wrong:** none on scoring; on the product, an activation step that is forgotten leaves θ = 0.10 (still protective). The exit checklist includes the activation.

## Revisit trigger
θ_protect > 0.50 (the product would warn less than the default; Ali decides); pilot alert-burden data.

## Links
[ADR 0010](0010-runtime-tunable-configuration.md) · [0046](0046-warning-level-policy.md) · [pre-registration](../research/2026-11-12-preregistration-2026-evaluation.md) §6.5, §11

## Amendments
- **2026-11-14 (acceptance; decision text unchanged).** Accepted by Ali in chat (ADRs 0046-0058, all 13). Status changed from Proposed-for-Ali. Nothing else changed.
