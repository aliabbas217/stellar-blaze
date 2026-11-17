# ADR 0064: F2 demo copy and data rulings: where the ADRs win over the prototype

- **Status:** Accepted by the architect (ADRs win over the prototype; Ali informed 2026-11-14)
- **Date:** 2026-11-14
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Groups five rulings that share one context and one decision (ADR 0012 rule 3: each has its own heading). Records the resolution of F2 plan conflicts C3, C4, C5 and C12, and the `share_above_amber` removal that the plan's Task 2 applies.
- **Evidence:** F2 plan "Evidence, conflicts and requests" (C3, C4, C5, C12), Task 2 Fixtures, Tasks 8, 15, 19; ADR 0034 Amendments 2026-11-14 item 1; ADR 0057 decision 1; ADR 0054 decisions 1-3; ADR 0050 decision 1; ADR 0045 flag F7; the v2 prototype pages under `D:\dev\stellar-blaze-f1\docs\design\v2\prototype\`; F1 `frontend/messages/en.json` (`supervisor.timeline.shareRow`).

## Context
The v2 prototype (approved 12 Nov) was built before the 14 Nov ADRs. Where its copy or data shapes disagree with an accepted ADR, the F2 plan resolved each conflict "only as stated; the owner confirms or reverses". This ADR records the confirmation for the four that change what a judge or worker reads. The prototype pages are not edited; they stay design assets.

## Decision
**The ADR wins over the prototype in each case below.**

### 1. "Made about 24 hours ahead", not "the evening before" (C3)
Landing and scoreboard copy say forecasts are "made about 24 hours ahead" (ADR 0034 Amendments, item 1: `lead_days = 1`, `previous_day1`). "Issued by 18:00 the evening before" appears only beside the lead-2 sensitivity run. The held-out line is "held-out 2026, every choice fixed on 2024-2025 data"; OMAA is a known site. Guard: Task 8 `test_headline_says_24_hours_ahead_not_evening_before`.
- **Cost of being wrong:** none visible; the numbers do not change. **Revisit:** B2 Task 2 shows `previous_day1` always comes from a run published by 18:00 GST, and a further ADR 0034 amendment restores the original wording.

### 2. The Plans table has three rows: "naive" and "ban only" are one (C4)
On roster L1 the two plans are identical by construction (ADR 0057), so the table renders one row, "Ban only (= working every shift minute; the legal roster already avoids the ban)", from the file's `identical_by_construction` field, followed by the rule plans (c) and (d). The prototype's four rows become three. Guard: Task 7 `test_plans_collapse_identical_rows`.
- **Cost of being wrong:** if the amendment behind ADR 0057 were reversed, the same code shows two equal rows with the same note (the plan's design). **Revisit:** a second roster joins the Plans row by amendment.

### 3. The governance page follows ADR 0054, not the prototype (C5)
The page posts `POST /api/v1/sites/{site_id}/data-requests` (body `subject`, `data_class`, `worker_ref`), shows the `403` problem `urn:stellar-blaze:problem:individual-data-refused` verbatim, and says "an employer request for individual health data at this site was refused", never "about you". The prototype's `GET /v1/workers/{id}/heat-risk`, the problem type `employer-no-individual-route`, "asked for your heat risk" and the **Purpose select** are dropped (a control that sends nothing is a defect). Guards: Task 15 `test_no_purpose_control`, `test_copy_is_site_level_not_about_you`.
- **Cost of being wrong:** the page tells every worker of the site about each refused request (ADR 0054's own stated cost). **Revisit:** worker accounts exist, or a regulator view needs the log.

### 4. No `share_above_amber` anywhere (ADR 0050)
The field is removed from fixtures, MSW handlers and generated types; the supervisor crews view shows the crew level and plan state. F1's `supervisor.timeline.shareRow` ("Share of crew above Amber") must be deleted with it. Guards: Task 2's handlers and fixtures, and `contract-governance.test.ts` (it must drop `share_above_amber` from its allowed property names and still find no member-like property). If a crew-share number is ever wanted it is a new field, "share of the crew's shift in Orange or worse", not this one.
- **Cost of being wrong:** a one-line change (ADR 0050). **Revisit:** a pilot where workers opt in to send their personal level (needs ADR 0004 to change).

### 5. The story stepper has five steps and no roadmap step (C12)
`StoryNav` links problem, scoreboard, day, proof, product. The prototype's sixth step ("what's next") has no page: ADR 0045 flag F7 narrows ADR 0034 §7 to a deck slide. **Revisit:** the roadmap screen returns to scope.

## Not in this ADR
C1, C2 and C13 are settled by the ADR 0045 and 0053 amendments; C6 by [ADR 0060](0060-offline-allow-list-stays-closed.md); C7 by [ADR 0059](0059-frontend-governance-invariants-sw-allow-list-and-revocation.md); C8 by [ADR 0061](0061-defer-listen-audio-action.md). C9 (one script budget on every route against ADR 0037's landing budgets), C10 and C11 stay as the plan resolves them; no decision on C9 or C11 was relayed on 2026-11-14.

## Consequences
- The product and the prototype now differ on purpose. Any prototype screenshot used in the deck keeps the DESIGNED stamp (ADR 0045 decision 5).
- Each guard is a named test in the F2 plan; none needs new tooling.

## Revisit trigger
Per item, under each heading. In general: an accepted ADR changes one of the four sources (0034, 0050, 0054, 0057), or Ali reverses a ruling.

## Links
[ADR 0034](0034-demo-strategy.md) · [0045](0045-f2-scope-core-demo-path.md) · [0050](0050-crew-timeline-and-k-suppression-semantics.md) · [0054](0054-governance-refusal-and-hash-chained-audit.md) · [0057](0057-plans-row-baselines-and-crew-fixture.md) · [F2 plan](../superpowers/plans/2026-11-14-f2-core-demo-screens.md)

> **Amendment pointer, 2026-11-18:** section 5 (the five-step stepper) is superseded by [ADR 0076](0076-story-order-and-plain-landing-and-verdicts.md).
