# ADR 0082: Deferrals after the redesign (six items, each with a trigger)

- **Status:** Accepted by the architect (owner informed in the controller's report of 2026-11-18; the owner can overrule). The owner decided the Thursday 19 Nov freeze.
- **Date:** 2026-11-18
- **Deciders:** the architect (Claude); Ali (owner)
- **Supersedes / superseded by:** none. Follows the [ADR 0045](0045-f2-scope-core-demo-path.md) pattern: one ADR, one heading per deferral, nothing deleted. Items 2, 3 and 5 keep ADR 0045 entries 5, 6, 10 and 7 as written.
- **Evidence:** `05-build-plan.md` §1 (cut line), §3 (what to show instead), §4 (A8, A9); `03-journeys` §3.5, §4.2, §5, §7; no create-site endpoint in the OpenAPI file.

## Context
The freeze leaves no time for these, and several need a backend. Each is shown instead as a labelled DESIGNED screen or not claimed ([ADR 0045](0045-f2-scope-core-demo-path.md) decision 5).

## 1. Real sign-in and accounts for employer staff
- **What:** invitation links and organisation sign-in ([ADR 0080](0080-demo-role-entry-and-access-model.md) decision 4), roles beyond `employer`, per-user tokens.
- **Why parked:** needs identity and email integration, token issuance, a session store, rate limits and a backend migration; no pilot.
- **Revisit:** a pilot with an employer; non-synthetic data ([ADR 0062](0062-public-demo-access-model.md)).

## 2. Supervisor site setup and roster import
- **What:** the new-site form and the roster CSV preview (S0, S0b, S9, S10).
- **Why parked:** no create-site endpoint exists, so a form would save nothing; the CSV preview is client-only, so it shows nothing real.
- **Revisit:** a create-site endpoint; a pilot onboarding; the ADR 0038 tier B decision.

## 3. HSE weekly table and export
- **What:** the site-by-day table with k-suppressed cells and an aggregate export (H1).
- **Why parked:** needs endpoints that do not exist.
- **Revisit:** an aggregate endpoint with suppression; a judge-facing requirement to see k-suppression.

## 4. Worker heat-profile form
- **What:** work type, time on the job, UAE-summer experience (S12).
- **Why parked:** the store and schema exist, no screen does, so personal levels stay inert and copy never says "your own level". Its validation library would add roughly 15 KB gzip (03's estimate) to a route near its ceiling.
- **Revisit:** a pilot wants personal levels and the route has bytes to spare.

## 5. Crew QR page (S8) and its dependency
- **What:** a server-rendered QR of the real join link, language chips, a print sheet.
- **Why parked:** it depends on S6a being verified, and **the QR encoder has not been researched** (release, last commit, maintenance, licence, size must be checked first; writing one inline is not advised).
- **Revisit:** S6a merged and about a day free; research first.

## 6. Worker join steps 2 and 3 (S6b)
- **What:** the language step, and the warnings step with the privacy card and the in-app-browser banner.
- **Why parked:** after the cut line; the header pill already changes language; the in-app-browser list is unverified.
- **Revisit:** S6a verified; a crew onboards by link.

## Consequences
- **Cost of being wrong:** judges looking for onboarding find a designed screen, not a working one. Every such screen carries DESIGNED.
- Not decided here: S13 (glossary), S14 (audit index) and D6 (static copy of the locked test plan).

## Links
[ADR 0045](0045-f2-scope-core-demo-path.md) · [0080](0080-demo-role-entry-and-access-model.md) · [0081](0081-un-defer-safety-view-tour-start-and-worker-join.md) · [parking lot](../parking-lot.md)
