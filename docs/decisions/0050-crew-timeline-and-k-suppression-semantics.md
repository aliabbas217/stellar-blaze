# ADR 0050: Drop `share_above_amber`; a crew's level never uses member data; suppression withholds member-derived fields only; complementary suppression on every published total

- **Status:** Accepted (Ali, 2026-11-14); previously Proposed-for-Ali
- **Date:** 2026-11-14
- **Deciders:** the B3 architect (Claude); Ali to accept
- **Supersedes / superseded by:** replaces F1's proposed `CrewHour.share_above_amber` (`docs/contracts/crew-timeline.md`, mock OpenAPI 0.1.0-mock). Answers F1 questions 1 and 2. Applies ADR 0011 §7.6 (k 10/5).
- **Changes a pre-registration freeze value:** no.
- **Evidence:** ADR 0004 §2 (the server never receives personal risk); `docs/research/2026-11-11-roster-stakeholders-and-compliance.md` G11 and §7 ("k = 10 for health-related counts, k = 5 for exposure and zone counts; site-week or employer granularity; complementary suppression"; "crew-level plans and exposure bands are shown to the crew's own supervisor because they are task allocation"); design HANDOFF Q3 (k mapping inference).

## Decision
1. **`share_above_amber` is removed.** No server-held input can produce "the share of the crew above amber": it would need per-person levels (ADR 0004). The supervisor crews view shows the crew level and the plan state instead.
2. **`crew_level`** = the site level of that hour, raised to Red by a crew-lead stop. It reads no member field, so it is returned for every crew, suppressed or not, and means the same thing in both.
3. **`suppressed`** is true when the crew's member count is below `k_exposure` (default and floor 5). It withholds **member-derived** fields only: in the day plan, `restricted_headcount` (members limited by acclimatisation, the 7-day heavy rule or the juvenile rule) is `null` and each restriction is shown as "some members restricted" without a count. Plan ticks stay visible to the crew's own employer-of-record supervisor (task allocation, needed to obey the law).
4. **`k_health`** (default and floor 10) applies to any count tied to health (stops, unwell reports, escalations). No core-path view publishes one in B3; the domain function and its tests exist for the deferred HSE view and the drafter.
5. **Complementary suppression** (`domain/privacy/suppression.py`): when a response publishes a total over cells, and exactly one cell is suppressed, the next-smallest cell is suppressed too, so total − visible cells cannot recover it. A test runs the differencing attack.
6. `RiskPolicy.k_suppression` = `k_exposure` (unchanged name for the device); `RiskPolicy.k_health` is added. `CrewTimeline.k` = `k_exposure`.

## Consequences
- The frontend's governance test still passes (no worker-like property); `pnpm api:gen` drops one field. Cost: a one-line F2 change.
- **Cost of being wrong:** if Ali wants a crew-share number, it can only be "share of the crew's shift in Orange or worse" (a time share from crew inputs), which is a new field, not this one.

## Revisit trigger
A pilot where workers opt in to sending their personal level (needs ADR 0004 to change); the HSE week view is built.

## Links
[ADR 0004](0004-tiered-alert-delivery.md) · [0011](0011-heat-aware-planner.md) §7.6 · [0046](0046-warning-level-policy.md)

## Amendments
- **2026-11-14 (acceptance; decision text unchanged).** Accepted by Ali in chat (ADRs 0046-0058, all 13). Status changed from Proposed-for-Ali. Nothing else changed.
