# ADR 0047: TWL margin 7 W/m² (range 7-20), withdrawal limits off, MRT from the Liljegren globe

- **Status:** Accepted (Ali, 2026-11-14); previously Proposed-for-Ali
- **Date:** 2026-11-14
- **Deciders:** the B3 architect (Claude); Ali to accept
- **Supersedes / superseded by:** decides the two B3 items ADR 0006 left open (margin, withdrawal limits); resolves the parking-lot row "Primary source for the TWL withdrawal limits".
- **Changes pre-registration freeze values:** **yes, explicitly.** §11.1 `⟨margin_w_m2⟩` = **7.0** and `⟨withdrawal_limits⟩` = **off**. Both are fixed from regulation and the B1 port measurement, with no 2026 data. The §7.2 sensitivity table (margin {0, 7} × withdrawal {off, on}) is reported unchanged.
- **Evidence:** ADR 0006 Consequences (port reads +3.9 to +7.0 W/m² above Miller & Bates Table 2, mean +6.2; claims doc +5.7 mean / 6.5 max; recommendation "zone on TWL minus 7"); pre-registration §10.2 (margin 7 already named as regulation-derived); `backend/rulesets/ae-heat-0.1.toml` `[twl_withdrawal]` (meteoHazard code only, primary source unverified); thermofeel 2.3.0 `thermofeel.liljegren.solve_globe` and `calculate_mrt_from_bgt(t2_k, bgt_k, va)` (signatures read from the installed package, 2026-11-14); ADR 0044 (range changes need the pin check first).

## Decision
1. **`twl_margin_w_m2`: default 7.0, min 7.0, max 20.0, `safer = "higher"`.** The minimum is the largest measured port bias, so no runtime value can zone above the published values. Raising `min` from 0 to 7 is a tunable range change, so ADR 0044's pin check lands first (B3 Task 2).
2. **Withdrawal limits stay off** in `ae-heat-2026.1` (`enabled = false`, values unchanged). Reason: the only source is a third-party code comment; ADOSH Table 1 does not contain them; a floor must cite law or a guideline. Order, for when it is ever enabled: cap first, then subtract the margin (more protective than ADR 0011's wording, because a cap of exactly 115 is Medium under the boundary convention).
3. **MRT** for TWL, forecast and truth alike: globe temperature from `thermofeel.liljegren.solve_globe` with the same inputs Liljegren WBGT uses (T, RH, pressure, 2 m wind, shortwave, direct fraction, cos zenith of the preceding hour's midpoint), then `calculate_mrt_from_bgt`. It lives in `domain/physics/wbgt.py`, the only module that imports thermofeel. Truth TWL uses observed T/Td/wind with IFS lead-0 radiation and pressure (assumption A2, ADR 0005). **Body wind:** `body_level_wind_ms(wind_10m)` (B1).
4. Each sample's TWL is computed with B1's `twl_w_m2_array`; NaN stays NaN and is excluded from probabilities (ADR 0046).

## Consequences
- **Cost of being wrong:** margin too small → zones read up to ~7 W/m² optimistic near 115/140; too large → more Amber/Orange hours (false alarms, counted by the scoreboard). Withdrawal off → afternoons above 44 °C dry bulb stay in the zone TWL gives (the 2×2 sensitivity shows the difference).
- `solve_globe` is a public function of a thermofeel submodule but not re-exported at the top level; a thermofeel bump must re-run the MRT test vectors.
- Speed: TWL is a scalar bisection; 50 samples × 14 h per site-day is about 700 solves. The 2026 OMAA scoring (≈ 139 d × 9 h × 50 × 5 leads) is a `slow` job, measured in B3 Task 12.

## Revisit trigger
A primary source for the withdrawal limits; a better TWL reference than Miller & Bates Table 2; the 2×2 sensitivity shows margin or withdrawal flips H4 or H6.

## Links
[ADR 0006](0006-physics-wbgt-phs-niosh-twl.md) · [0044](0044-defer-tunable-range-pin-comparison-to-b3.md) · [0046](0046-warning-level-policy.md) · [parking lot](../parking-lot.md)

## Amendments
- **2026-11-14 (acceptance; decision text unchanged).** Accepted by Ali in chat (ADRs 0046-0058, all 13). Status changed from Proposed-for-Ali. The margin, the withdrawal switch and the MRT method fill slots the pre-registration leaves to the freeze addendum (section 11.1); no pre-registered value is overturned. Recorded, before any 2026 result, in [pre-registration amendment 1](../research/2026-11-14-preregistration-amendment-1.md) section 3. The parking-lot row on the TWL withdrawal limits carries the acceptance note.
