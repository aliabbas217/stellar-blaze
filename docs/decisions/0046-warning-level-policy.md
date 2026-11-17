# ADR 0046: The warning level is the ADOSH zone of the effective TWL at the warning quantile θ, with a fourth "stop" edge

- **Status:** Accepted (Ali, 2026-11-14); previously Proposed-for-Ali
- **Date:** 2026-11-14
- **Deciders:** the B3 architect (Claude); Ali to accept
- **Supersedes / superseded by:** replaces the F1/design-phase **stand-in** bands (`docs/design/v2/prototype/assets/crews.js`: WBGT 30/34/39 °C heavy, +1.5/+3 °C for moderate/light). Refines ADR 0011 §2 step 1: the protective quantile is the one the pre-registration fixed (§7.3), not "the lower TWL from the upper T/Td of the active `calibration_pair`" (0011 is not edited; this ADR is the pointer).
- **Changes a pre-registration freeze item:** yes. The Red edge and the level rule live in `ae-heat-2026.1`, whose SHA-256 is a §11.1 freeze value. No number already in the freeze addendum changes (it has none yet).
- **Evidence:** ADR 0004 §1 (Tier A level is non-personal, site/crew only), 0006 (TWL zones, boundary convention, port bias), 0010 §1(b) (probability bands are tunables), 0011 §2 (zones, Table 1, stop-work), pre-registration §6.5 (θ rule), §7.2 (P3 warns when P(High) ≥ θ), §7.3 (protective quantile = TWL 10th percentile of the corrected joint samples), §3.1 (50 joint samples); `docs/research/2026-11-11-shift-regulations-and-sleep.md` (Technical Guideline Table 1, page 5); F1 `src/features/risk/personal.ts` (the device computes the personal level separately).

## Context
Four places need a level: the Tier A push, the worker's site level, the supervisor's crew level and the scoreboard's P3. The frontend uses Green/Amber/Orange/Red; ADOSH has three zones. The pre-registration scores P3 as "P(High) ≥ θ" and the Plans row on the TWL 10th percentile. ADR 0011 needs a Red level that stops all work, but ADOSH Table 1 has no stop: High (< 115 W/m²) prescribes 20 work / 40 rest for heavy work and 45/15 for light. A probability-only Red ("P(High) ≥ 0.9") would stop work on most summer afternoons at OMAA, far past the regulator, so it is not the right edge.

## Decision
1. **Effective TWL.** `twl_eff = TWL − twl_margin_w_m2` (ADR 0047), per joint sample, after the withdrawal cap when it is enabled (it is off, ADR 0047). TWL uses the corrected (T, Td, 10 m wind) sample with the raw IFS radiation and pressure of the same row.
2. **Zones on `twl_eff`, edges inclusive on the milder side:** `≥ 140` Low · `≥ 115` Medium · `≥ red_twl_w_m2` High · `< red_twl_w_m2` **Red (stop)**. Exactly 140 is Low, exactly 115 is Medium (ADR 0006), exactly the Red edge is High.
3. **Level of an hour** = the most severe zone `z` such that `count(samples with zone ≥ z) / count(finite samples) ≥ θ` (`warning_theta`, ADR 0048). The comparison is `≥` (a tie at θ escalates). No finite sample → no level (`null`), and the hour falls back (ADR 0058). Mapping: Low → `green`, Medium → `amber`, High → `orange`, Red → `red`. This is exactly P3 for the Orange decision, so the product and the scoreboard share one rule.
4. **The planner's tick zone** is the zone of the **protective TWL** = `np.quantile(twl_eff_samples, 0.10, method="inverted_cdf")` (pre-registration §7.3), linearly interpolated from hourly labels to 5-minute ticks. With `inverted_cdf`, "q10 below an edge" is identical to "P(below the edge) ≥ 0.10", so at θ = 0.10 the level and the plan agree hour by hour. **Product clamp:** a plan tick is never in a milder zone than its hour's level (`plan_zone = max(zone(q10 tick), zone(level of the hour))`). The scoreboard's plan (d) stays the pre-registered q10 plan. If θ_protect ≥ 0.10 the clamp never binds (P(High) ≥ θ ≥ 0.10 implies q10 is High); if θ_protect < 0.10 the deck must say the product plan is the stricter of the two, or Ali amends §7.3 before the plans run.
5. **Red edge** `red_twl_w_m2` is a ruleset **tunable** (class b, POLICY, not law): default **85 W/m²**, range [60, 115], `safer = "higher"`. Derivation [C from assumptions, labelled]: the hour-averaged heat load of the mildest High-zone cycle (light work 180 W for 45 min, seated rest about 115 W for 15 min) over a 1.94 m² body is (45·180 + 15·115)/60/1.94 ≈ 85 W/m². Below it, no ADOSH cycle keeps metabolic heat under the limit. The same arithmetic puts heavy 20/40 at about 111 W/m², which is why ADOSH's own High edge (115) is consistent. Labelled on every screen "POLICY: beyond the ADOSH table; stop work".
6. **Workload classes:** Table 1 has light and heavy only. Moderate uses the **heavy** column (PROTECTIVE READING, ruleset switch `moderate_uses_heavy = true`, a floor).
7. **Crew level** = the site level of that hour, raised to Red by a crew-lead stop. It uses no member input (ADR 0050).
8. **What Red does:** every crew's plan is `stopped` in a Red tick (ADR 0011 §2.6); a Red push goes out immediately (ADR 0058).

## Consequences
- One rule, one place (`domain/risk/levels.py`), shared by alerts, API, planner zones and P3. A unit test pins "θ = 0.10 ⇒ level zone == q10 zone" on random samples.
- The Red frequency is not known yet. B3 reports the share of truth-Red working hours at OMAA in 2024-2025 in the freeze addendum (information, not selection). **Cost of being wrong:** if 85 W/m² is too high, crews stop more than needed (productivity, labelled POLICY); if too low, the gap below High is covered only by 20/40 (ADOSH's own rule), never by less.
- The heavy 20/40 hour average (≈ 111 W/m²) sits just below 115: between about 85 and 111 heavy crews are within ADOSH but above the model's sustainable load. Stated as a limitation, not hidden.

## Revisit trigger
ADPHC or counsel names a stop-work threshold; the 2024-2025 truth-Red share is above 10% of working hours; θ_protect < 0.10 (the clamp binds).

## Links
[ADR 0004](0004-tiered-alert-delivery.md) · [0006](0006-physics-wbgt-phs-niosh-twl.md) · [0011](0011-heat-aware-planner.md) · [0047](0047-twl-margin-withdrawal-and-mrt.md) · [0048](0048-warning-theta-is-a-runtime-tunable.md) · [0050](0050-crew-timeline-and-k-suppression-semantics.md) · [pre-registration](../research/2026-11-12-preregistration-2026-evaluation.md)

## Amendments
- **2026-11-14 (acceptance; decision text unchanged).** Accepted by Ali in chat (ADRs 0046-0058, all 13). Status changed from Proposed-for-Ali. This ADR defines terms the pre-registration leaves to the freeze addendum (the level rule, the Red edge inside the ruleset hash); that is recorded, before any 2026 result, in [pre-registration amendment 1](../research/2026-11-14-preregistration-amendment-1.md) section 2. The standing condition of decision 4 is not closed by acceptance: if the frozen theta_protect is below 0.10, the deck says the product plan is the stricter of the two, or Ali amends pre-registration section 7.3 before the plans run.
