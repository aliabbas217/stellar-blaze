# ADR 0057: On the legal roster, "naive" and "ban only" are the same plan; the Plans row shows three plans; the frozen crew fixture

- **Status:** Accepted (Ali, 2026-11-14); previously Proposed-for-Ali
- **Date:** 2026-11-14
- **Deciders:** the B3 architect (Claude); Ali to accept
- **Supersedes / superseded by:** would amend pre-registration §7.3 (presentation of plans (a) and (b)) through its §13 amendment log, **before any 2026 result**. Corrects B3 design notes AT-15 ("naive > ban-only").
- **Changes a pre-registration freeze value:** **yes:** §11.1 `⟨demo_site_sha256⟩` is the SHA-256 of `backend/fixtures/demo_site.toml` defined here.
- **Evidence:** pre-registration §7.3 ((a) "naive schedule (every shift minute outside the ban)", (b) "ban only", roster L1 06:00-11:00 + 15:00-18:00) and §7.2 (assumed crew of 20 doing heavy work); ADR 0011 §9 (same wording); the ban window 12:30-15:00 lies inside L1's 11:00-15:00 gap, and L1's runs are 5 h and 3 h, so neither the ban nor Art. 18 changes a minute of L1.

## Decision
1. **(a) ≡ (b) on L1, by construction.** The Plans row shows one row labelled "Ban only (= working every shift minute; the legal roster already avoids the ban)", then (c) rule plan on raw IFS, (d) rule plan on the corrected protective quantile. The JSON keeps both keys with identical values and a field `identical_by_construction: ["naive", "ban_only"]`, so nothing is silently dropped. H6 ((d) vs ban only) is unaffected. Using the illegal B0 roster for (a) is rejected: its extra violations are the law's gain (ADR 0034 §6), not ours.
2. **Crew fixture `backend/fixtures/demo_site.toml` (SIMULATED):** site `site-demo-mussafah` "Mussafah M-14 yard (synthetic)", station OMAA, lat 24.36, lon 54.50, Asia/Dubai, employer `emp-demo`, 6 days a week, commute 45 min. Crews (names from the design prototype), all on L1:
   - `crew-a` Rebar fixing, heavy, 12 members, 2 of them new (days on site 2), rest experienced;
   - `crew-b` Concrete pour, heavy, **20 members, all experienced adults: the scored crew** (pre-registration §7.2's crew of 20 heavy);
   - `crew-c` Formwork, moderate, 9 members, 1 returning after 10 days away;
   - `crew-d` Survey and inspection, light, **4 members** (below `k_exposure` = 5: the suppressed crew).
   No juveniles; no exempt tasks.
3. Plans scoring uses `crew-b` only; the other crews exist for the supervisor views.

## Consequences
- **Cost of being wrong:** if Ali declines the amendment, the row shows (a) and (b) side by side with equal numbers and the same note; nothing is re-scored.
- Changing any byte of the fixture after the freeze addendum makes the Plans row "not pre-registered" (§11). The fixture is committed with the ruleset, before θ.

## Revisit trigger
A second roster (for example L2) is added to the Plans row by amendment.

## Links
[ADR 0011](0011-heat-aware-planner.md) §9 · [0034](0034-demo-strategy.md) · [0050](0050-crew-timeline-and-k-suppression-semantics.md) · [pre-registration](../research/2026-11-12-preregistration-2026-evaluation.md) §7.3, §11, §13

## Amendments
- **2026-11-14 (acceptance; decision text unchanged).** Accepted by Ali in chat (ADRs 0046-0058, all 13). Previous status line: "Proposed-for-Ali; **needs Ali's attention** (it asks for a pre-registration amendment-log row before the plans run)". The amendment this ADR asked for is written, before any 2026 result, as [pre-registration amendment 1](../research/2026-11-14-preregistration-amendment-1.md) section 4. It is a separate file because the pre-registration is committed and hashed by the gate; the section 13 table in that file is not edited. The Plans row therefore shows (a) and (b) as one plan; the "if Ali declines" fallback in Consequences does not apply. The fixture SHA is the first setting of the section 11.1 slot, not a change to a recorded SHA.
