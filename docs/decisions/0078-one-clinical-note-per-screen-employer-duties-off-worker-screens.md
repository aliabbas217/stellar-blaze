# ADR 0078: One clinical note per worker screen; employer duties come off the worker screens

- **Status:** Accepted (owner decision, 2026-11-17, D5) for the single clinical note. The removal of the three employer duties from the worker screens is accepted by the architect (owner informed in the controller's report of 2026-11-18), inside the approved redesign direction.
- **Date:** 2026-11-18
- **Deciders:** Ali (owner); the architect (Claude)
- **Supersedes / superseded by:** none. Amends the per-screen wording and placement set by the review pack (`docs/clinical/review-pack.md`, "Draft wording, awaiting clinical review") and F2. [ADR 0035](0035-clinical-review-labelling.md) is not changed: it says nothing about placement, and its label rule stands.
- **Evidence:** slice S5, `cb7e4fa` (merge `0dc6fc6`); `TodayView.tsx`, `AlertView.tsx`, `features/today/action-codes.ts`; `04-visual-fixes.md` §3.2; the ADOSH Technical Guideline wording the three codes carry.

## Context
Today printed the clinical label twice (the lead and the also-list). Three of the "Also now" lines are addressed to duty holders: a worker cannot hold an induction or provide a bottle.

## Decision
1. **One note per screen.** Today and the alert card each show "Not yet checked by a clinician." once. On Today it sits beside "Why <level>?" and covers the action and the list; it is not drawn on a day with no shift. It replaces "Draft wording, awaiting clinical review". The key stays `worker.today.draftWording`, a safety key.
2. **ADR 0035 stands.** "Reviewed by an independent clinical consultant, <date>" is shown only after a real review (`CLINICAL_REVIEW` is `null`). The note's wording differs from 0035's fallback "not clinically reviewed" on purpose (plain language); the unwell sheet keeps "Not clinically reviewed" ([ADR 0065](0065-unwell-flow-reconciles-with-cop-3-1-2e.md)). When a review completes, both strings change together.
3. **Employer duties are not shown to workers.** `EMPLOYER_DUTY_CODES` holds `no-unacclimatised`, `high-risk-induction`, `personal-water-bottle-2l`. The codes stay in the data and `actionPlan` drops them like an unknown code. Their words left the catalogues; the verbatim text was: "No unacclimatised person to work"; "High Risk induction required emphasising hydration and identifying signs of heat strain"; "Provide personal water bottle (2 litre capacity) on-site at all times".
4. **Parked, not built:** a "Site duties today" block on the crew plan page, with this wording verbatim. The only mention of it in the code is a comment. At `656d663` the crew-plan route is 196,193 B against 199,680 B, so a block has to fit in 3,487 B ([ADR 0088](0088-settings-sheet-body-loads-on-first-open.md)).

## Consequences
- **Cost of being wrong:** until the block exists, the three duties appear nowhere in the product. Workers lose no instruction they could act on, but the crew lead gets no reminder either.
- A lone note can be read as covering text it does not; it is placed to cover the lead and the list.

## Revisit trigger
The crew plan route has bytes to spare, or the block is wanted for the video; a clinical review completes; the owner reverses D5.

## Links
[ADR 0035](0035-clinical-review-labelling.md) · [0065](0065-unwell-flow-reconciles-with-cop-3-1-2e.md) · [0082](0082-deferrals-after-the-redesign.md) · [parking lot](../parking-lot.md)
