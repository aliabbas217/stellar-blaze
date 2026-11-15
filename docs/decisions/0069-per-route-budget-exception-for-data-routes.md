# ADR 0069: Per-route budget exception for the five data routes (worker and supervisor), with a build-failing cap

- **Status:** Accepted by the architect (Ali informed 2026-11-15; he can overrule)
- **Date:** 2026-11-15
- **Deciders:** the architect (Claude), on the F2 controller's measurements and recommendation
- **Supersedes / superseded by:** narrows the F1 frontend budget (`frontend/lighthouserc.json`: 174,080 B gzip script per route, Lighthouse performance 0.9, LCP 2.5 s, TBT 200 ms) for five routes only; the budget is unchanged everywhere else
- **Evidence:** F2 controller reports of 2026-11-15 (commits `0f26f53`, `30cc3a9`, `e844fc6`): lhci script bytes and `pnpm bundle:check` gzip bytes per route, locked production build, 3 runs, medians, Windows laptop (single runs swing 2x; the host was loaded during some runs); the F2 parking-lot row for option B.

## Context
The worker and supervisor data screens carry the data layer (`@tanstack/query-core` 12.6 KB + `@tanstack/react-query` 1.7 KB + `openapi-fetch` 2.5 KB, 16.8 KB gzip) and the Today or crew UI (about 14 KB), on top of React, next-intl's runtime and zustand. Levers already taken: a lazy personal-level pipeline (recovered 6.4 KB, not the 16 KB priced), per-group client message catalogues (8 to 14.7 KB off the HTML document, 0 B of script), the lucide removal, and server-rendering where the Stop bar did not need the model. No byte-neutral lever is left, and the supervisor levers total under 8 KB. These routes are the worker's phone, so loosening a budget on them is a cost to the primary user, which is why it is bounded and recorded.

Measured (script gzip bytes; lhci perf / LCP / TBT):

| Route | `bundle:check` gzip | lhci bytes | perf | LCP | TBT |
|---|---|---|---|---|---|
| `/en/worker` | 186,288 | 188,326 (194,993 with a pinned phone) | 0.93 (0.84 to 0.89 pinned) | 3.05 s (3.5 to 3.7 s pinned) | 148 ms (234 pinned) |
| `/en/worker/alerts` | 180,200 | 182,316 | not re-measured | not re-measured | not re-measured |
| `/en/worker/alert` (alert card shell) | 186,235 | 186,032 | not re-measured | not re-measured | not re-measured |
| `/en/supervisor` | 187,884 | 190,047 | 0.81 | 3.44 s | 437 ms |
| `/en/supervisor/crews/[crewId]` (plan and sign-off) | 187,756 | 192,486 | 0.81 | 3.52 s | 373 ms |
| `/en/worker/unwell` (safety route, no request) | 155,745 | 156,353 | within budget | within budget | within budget |

## Options
1. **Per-route exception with a build-failing cap (chosen).**
2. **A lighter data layer on these routes** (replace TanStack Query and zustand persist with a small fetch and storage layer): about -15 KB, 3 to 4 h plus a review, and it contradicts the frontend rule "server state always in TanStack" and F1's choice. **Parked as the revisit**, not built before the submission.
3. **Accept the miss without a ruling:** rejected; a silent miss is how budgets erode.

## Decision
Five routes are exempt from the 174,080 B script budget: `/worker`, `/worker/alerts`, `/worker/alert`, `/supervisor` and `/supervisor/crews/[crewId]` (including plan and sign-off). For them:
- **Cap:** 195 KiB gzip script (199,680 B), **build-failing** (`pnpm bundle:check` in CI after the build). The cap is a ceiling, not a target.
- **Lighthouse asserts, worker routes:** performance at least 0.80, LCP at most 3.5 s, TBT at most 350 ms.
- **Lighthouse asserts, supervisor routes:** performance at least 0.75, LCP at most 4.0 s, TBT at most 450 ms (the supervisor is the lower-volume route; its measured medians pass these and do not all pass the worker terms).
- **Every other route** keeps 174,080 B, 0.9, 2.5 s and 200 ms. `/worker/unwell` is outside the exception and keeps its budget with no request. The Stop path is never lazy-loaded. A new dependency on any exempt route needs a bundle diff in its review.
- F2 Task 25 lands the per-URL Lighthouse matrix so that the byte limits and the asserts change together with this ADR. Until then `lhci autorun` stays red on `/en/worker` and `/en/worker/alerts`, as before. The worker routes are re-measured on an idle host in that task and the numbers are added to this ADR as an Amendment.

## Consequences
- **Cost of being wrong:** a slower first load on a slow phone, up to the asserted LCP of 3.5 s on Lighthouse's simulated slow 4G for the worker routes; the pinned-phone worker measurement (3.5 to 3.7 s) is at the edge and the idle re-measure decides whether the worker terms hold. The judge routes (153 to 169 KB) are unaffected.
- The exception does not relax any accessibility, correctness or governance check.

## Revisit trigger
After the submission (build option 2); the idle-host re-measure shows an exempt route missing its asserts; a route grows toward the cap.

## Links
[ADR 0003](0003-frontend-single-nextjs-app-pwa.md) · [0045](0045-f2-scope-core-demo-path.md) · [0059](0059-frontend-governance-invariants-sw-allow-list-and-revocation.md)
