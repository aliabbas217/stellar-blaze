# ADR 0053: Defer plan sign-off, the pay-impact panel and multi-task heavy-first ordering; every B3 plan is the rule plan labelled "unsigned"

- **Status:** Accepted (Ali, 2026-11-14); previously Proposed-for-Ali
- **Date:** 2026-11-14
- **Deciders:** the B3 architect (Claude); Ali to accept
- **Supersedes / superseded by:** defers three ADR 0011 MUST items that no core-path view shows: §7.1 sign-off workflow (named supervisor, itemised acknowledgement, reason codes), §7.3 pay-impact display, §2 step 5 heavy-first ordering across several tasks. **Conflict noted:** ADR 0011 §1 lists them as MUST; Ali's F2 scope (crew plan screen not in the nine views) removes their only consumer. **Also conflicts with ADR 0045 §3**, which keeps "sign-off and stop-work endpoints" in the B3 MUST set. Resolution here: the **crew-lead stop endpoints are kept** (safety, ADR 0011 §2.6; ADR 0051); sign-off is deferred unless Ali answers ADR 0045 flag F1 by building `supervisor-plan`, in which case B3 plan contingent Task 17 (about 2.5 h) builds it and this ADR is superseded for sign-off.
- **Evidence:** Ali's F2 scope; design HANDOFF (sign-off and pay live on `supervisor-crew.html`, not in scope); ADR 0011 §Context 2 (heavy-first is already the rule baseline and ordering is "reported, not headlined"); the demo crew fixture has one workload class per crew (ADR 0057), so ordering has nothing to order.

## Decision
1. **Kept (class d invariants, tested):** sign-off never gates alerts or a stop; with no sign-off a crew's plan is the rule plan with `signoff_state = "unsigned"` and the label code `plan.unsigned_fallback`; the floor banner code on every plan payload.
2. **Deferred:** the sign-off route and table, one-tap rules, reason codes; `pay_impact` block; task lists with heavy-first assignment (a crew has one workload class in B3).
3. The input-change audit (§7.4) is **kept** in its minimal form: loading or changing site data through `sb-jobs site load` appends `input.changed` rows.

## Consequences
- **Cost of being wrong:** the story's "product" step shows an unsigned plan only. The pay-impact numbers (B0 → B1 −0.5 h OT, about −7.2% pay) stay in the deck from ADR 0011 §7.3, not from the app.
- Parking-lot rows added for each deferred item.

## Revisit trigger
The crew-plan screen returns to F2 scope; a pilot employer asks for sign-off; a crew fixture with several workload classes.

## Links
[ADR 0011](0011-heat-aware-planner.md) §2, §7 · [0051](0051-api-v1-surface-for-the-core-demo-path.md) · [0057](0057-plans-row-baselines-and-crew-fixture.md)

## Amendments
- **2026-11-14 (acceptance; decision text unchanged).** Accepted by Ali in chat (ADRs 0046-0058, all 13). Status changed from Proposed-for-Ali.
- **2026-11-14 (Ali, in chat, later the same day: sign-off stays in B3; the sign-off part of decision 2 is reversed; decision text above unchanged).**
  - **Reversed:** plan sign-off (the route, the table, the one-tap and per-item rules, reason codes: ADR 0011 section 7.1) is built in B3. B3 plan **Task 17 is promoted from contingent to MUST** (+2.5 h; the MUST total goes from about 43.5 h to about 46 h). The Supersedes line's own clause applies: Ali answers ADR 0045 flag F1 by building `supervisor-plan`, as the tenth core view ([ADR 0045](0045-f2-scope-core-demo-path.md) Amendments), and "this ADR is superseded for sign-off".
  - **Why:** ADR 0011 section 1 lists sign-off as MUST; ADR 0045 flag F1 named the supervisor plan as its only screen; and the story stepper's "product" step is the supervisor plan (journeys section 6.3 row 4, as ADR 0045 flag F1 cites it). Ali's stated reason for the same-day fold-ins, which he asked about as "what will be the best practice", is that the safety controls and the governance story must be reachable in the judged build (ADR 0045 Amendments).
  - **Unchanged:** the class (d) invariants of decision 1. Sign-off can **never** delay an alert or a stop; with no sign-off a crew's plan is the rule plan with `signoff_state = "unsigned"` and the label `plan.unsigned_fallback`; the floor banner stays on every plan payload. One acknowledgement is one tick per run of consecutive plan blocks at the same warning level above Low (the prototype's `ackItems`; ADR 0045 Amendments).
  - **Still deferred, confirmed by the acceptance:** the pay-impact panel (decision 2; the v2 prototype page `supervisor-plan.html` has no pay panel, so the tenth view does not need it) and multi-task heavy-first ordering. The input-change audit stays as decision 3 says. ADR 0011 section 1 still lists the pay display and ordering as MUST, so that conflict stands for those two; ADR 0011 is not edited.
  - **Consequences:** the parking-lot row for the sign-off workflow carries a dated note. The route is added to the v1 surface ([ADR 0051](0051-api-v1-surface-for-the-core-demo-path.md) Amendments). The title of this ADR ("Defer plan sign-off ...") is history for sign-off. CP-SAT (Task 15), already dropped at 15:00 on 17 Nov unless every MUST task is green, is expected to be dropped.
