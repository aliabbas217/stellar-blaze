# ADR 0081: Un-defer the minimal safety view, the 3-minute tour, the front door and the worker join flow

- **Status:** Accepted by the architect (owner informed in the controller's report of 2026-11-18; the owner can overrule) for `/hse`, `/tour`, `/start` and `/worker/join`. `/worker/join` was Proposed until slice S6a was verified; it was merged and checked on 2026-11-18.
- **Date:** 2026-11-18
- **Deciders:** the architect (Claude); Ali (owner) approved the role-entry prototypes
- **Supersedes / superseded by:** supersedes the deferred entries of [ADR 0045](0045-f2-scope-core-demo-path.md): entry 10 `hse` **in part** (the weekly table and export stay deferred, see [ADR 0082](0082-deferrals-after-the-redesign.md)) and entry 1 `worker-join` (when S6a lands). Entry 7 `supervisor-qr` stays deferred. `/tour` and `/start` were never ADR 0045 entries. Answers flag F6.
- **Evidence:** slice S7, `51257ce` etc. (merge `56786a3`); slice S6a: `bc70e04`, `883e2bb`, `92d8dbc`, `e52716b` (merge `adcade6`; unit suite 187 files, 4047 tests; `worker-join.spec.ts` 11 of 11 and `field-widths.spec.ts` 39 of 39 on the mobile project; `/worker/join` 162,569 B of 174,080 B after `46db54e`); `05-build-plan.md` S6a and S7; `03-journeys` §3 and §5.

## Context
ADR 0045 deferred these because they were off the judge's path. The redesign needs a front door and a way for a worker to join, and the owner asked how a worker finds a crew.

## Decision
1. **`/hse`** is a minimal real page: static server markup plus the crews table, which reads the public crews endpoint the supervisor screen already reads (no endpoint of its own). It shows each crew's plan (Signed, Not signed, Changed since signed) and whether work is stopped. Also: the sentence "The service holds no individual worker health data.", the boundary panel "What you cannot see here" linking to the governance refusal, and the Demo controls (Replay or Live, Reset) in a closed section.
2. **`/tour`** has five stops (the story, the worker's phone, the crew lead's screen, the refusal, the scoreboard). Each is one plain sentence and a link to the real screen. The stop sentences are Tier 2 ([ADR 0083](0083-tier-2-english-only-story-copy.md)).
3. **`/start`** is the role door as a page, the target of "Switch role".
4. **`/worker/join` (built, slice S6a).** `?s=<site>&c=<crew>` shows "Is this your crew?" from the public site and crew endpoints; "Yes" pins the phone and opens Today; without a code a picker lists workplaces, then crews; a wrong or garbled crew, an unknown site and an offline phone each have a plain state with a way forward. "Just looking? Try the demo yard" stays. The API lists only the demo site today, and the page says so. A phone with no pin that opens `/worker` is handed on to the join page; the Alerts "choose your site first" dead end and "Change crew" lead to it; Alerts falls back to the device pin so a phone that just joined can turn warnings on. The page reads its two endpoints without TanStack Query (the query client is about 19 KB gzip and the first build was 2,801 B over the route budget): an abortable effect in `features/join/reads.ts`. The join page has no dock, so it has no "I feel unwell" link; the rule "the unwell link is on every worker page" now reads "on every worker page that has the dock". The steps after joining (language, warnings, privacy card) are deferred ([ADR 0082](0082-deferrals-after-the-redesign.md)).

## Consequences
- The built tour differs from 03: five stops, not six, and no "Real or demo" table or video link yet.
- **Cost of being wrong:** a reviewer takes the role-entry pages for sign-in ([ADR 0080](0080-demo-role-entry-and-access-model.md)); a phone that opens the join page offline with a crew link cannot confirm the crew (the page says so and offers a retry); the join page has no quick way to the unwell sheet.
- `/hse` measured 174,740 B against 174,080 B after the merge and 172,472 B after the fixes of [ADR 0088](0088-settings-sheet-body-loads-on-first-open.md).

## Revisit trigger
A judge asks for the weekly view; the owner moves the freeze; a pilot needs the join steps after the crew confirmation.

## Links
[ADR 0045](0045-f2-scope-core-demo-path.md) · [0080](0080-demo-role-entry-and-access-model.md) · [0082](0082-deferrals-after-the-redesign.md) · [0088](0088-settings-sheet-body-loads-on-first-open.md)
