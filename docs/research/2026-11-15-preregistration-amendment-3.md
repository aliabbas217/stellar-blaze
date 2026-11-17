# Pre-registration amendment 3: secondary Warnings rows are not computed; freeze-time rulings recorded

- **Date:** 2026-11-15, written before any 2026 scoring and before the "2026 go" marker.
- **Amends:** `2026-11-12-preregistration-2026-evaluation.md` §7.2 ("Secondary" bullet). The original file is unchanged; the protocol lock must hash it, amendments 1 to 3 and the freeze addendum `2026-11-15-preregistration-freeze.md`.
- **Item 1 decided by:** Ali, in chat, 2026-11-15 (answer "Amend: not run"). **Items 2 and 3 decided by:** the architect (Claude), Ali informed; Ali can overrule either before he signs the go marker.

## 1. Secondary Warnings rows are not computed (decided by Ali)

§7.2 lists as secondary: "the same counters pooled over all 8 stations, regime (a), and regime (c) at OMAA". §8 forbids removing a metric without an amendment. The B2-corrected series that B3 consumes covers OMAA as a known site (regime a) only, so B3 cannot compute the pooled or regime (c) policy counters, and adding an export path near the 2026 gate days before the run was judged not worth its risk.

- **Decision:** the Warnings-row counters (missed danger hours, false-alarm hours, POD, FAR, CSI, alerts per worker-shift) are reported for OMAA, regime (a), at leads 1, 2, 3 (and 5, 7 in the report only), as §7.2 already fixes. The pooled-over-8-stations and regime (c) at OMAA counters are **not computed**, and the report prints "not computed" where those rows would be. No other part of §7.2 changes, including the 2 x 2 truth-zone sensitivity table.
- **Effect on claims:** the Warnings and Plans results describe one known site (OMAA) in an unseen summer (ADR 0034 amendment, item 3). The deck and report make no claim that the warnings or plans generalise to other airports, other sites or held-out clusters. The Forecast row (§7.1, produced by B2) still reports every regime it lists, and is unaffected.
- **Cost of being wrong:** no policy-level evidence outside OMAA. Revisit trigger: a later B2 export of the pooled and regime (c) corrected series (additive; the 2026 run cannot be repeated for it).

## 2. Red edge stays at 85 although the ADR 0046 revisit trigger fired (architect ruling)

ADR 0046's trigger is "truth-Red above 10% of working hours". B3's recomputation on B2's 2024-2025 development out-of-fold rows (effective TWL below 85, lead 1, 06-14 UTC): OMAA 10.3% ban-weighted and 13.9% unweighted (2024: 13.8%, 2025: 6.9%); OMAD 19.2%; both stations 14.8%. Amendment 1 (Ali) froze the Red edge at 85, and a change now would give a new ruleset hash, a new theta run and a new addendum. **Ruling:** keep 85 for the pre-registered evaluation, report the trigger as fired, and revisit after the evaluation. The cost of being wrong is that crews are told to stop more often than necessary, not that protection is lower. The freeze addendum states the figures. This is a choice made after seeing development data from 2024-2025 only, before any 2026 scoring.

## 3. Clarifications recorded in the freeze addendum (architect rulings, all before any 2026 scoring)

The freeze addendum lists these with their costs; they are listed here so the lock hashes one set of decisions:

- **θ weighting (§6.5 is silent):** hours carry the §7.2 ban weights; weighted θ_protect 0.30, θ_balanced 0.45; the unweighted values (0.35, 0.55) are published beside them.
- **H4 at lead 2 (§13):** the "issued by 18:00 GST the evening before" stamp is carried only if H4 holds at **both** leads 1 and 2.
- **H5 "+25%"** is a point estimate, FA(P3) at most 1.25 times FA(P2); **H4 "P2 at least as good"** means on both missed and false-alarm hours.
- **Withdrawal "on" cell** of the 2 x 2 table is the dry-bulb leg only (above 44 °C); no natural wet-bulb source exists.
- **Bootstrap:** a replicate with a zero denominator is dropped alone; the interval is null only if more than 5% of the 2,000 replicates are undefined.

## Obligations

The protocol lock gains amendment 3 and the freeze addendum (`freeze_path`, `freeze_sha256`); the 2026 gate refuses to run unless every hashed file matches. Any change to the freeze addendum after the lock is written changes the lock and voids a signed go marker.
