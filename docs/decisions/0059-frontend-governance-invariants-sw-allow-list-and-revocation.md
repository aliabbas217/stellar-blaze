# ADR 0059: Frontend governance invariants: the service worker caches only two non-personal endpoints, and "remove my data" never reports success while data remains

- **Status:** Accepted by the architect (security invariants from the F1 build; Ali informed 2026-11-14)
- **Date:** 2026-11-14
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Records as an ADR what F1 enforces in code and tests (the F1 summary's "ADR: write one, or amend ADR 0004"). Implements ADR 0004 (nothing personal on the server or in a shared cache) and ADR 0009's "plus a test".
- **Evidence:** F1 summary `D:\dev\stellar-blaze-f1\.superpowers\sdd\f1-summary.md` (Security fixes; Governance invariants; rulings R25, R27, R31-R39; Awaiting the user); F1 commit `58cfc13` (Task 6 security fix) and commits `ff3f624..d0f1d2b` (Task 8 revocation fix rounds), each with its review diff under `.superpowers/sdd/2026-11-11-f1-frontend-foundation/`; code read 2026-11-14: `frontend/src/app/sw.ts`, `frontend/src/features/pwa/{api-cache,runtime-caching}.ts`; the ledger entry for R32 in `progress.md`.

## Context
Workers can share a phone (comment on `OFFLINE_API_ALLOW_LIST`). Serwist's `defaultCache` keeps every same-origin `/api/` GET in a cache named `apis`; a unit test shows `/api/v1/crews/crew-a/timeline` would land there without our rules. Two defects were found by coordinator review and fixed in F1: the worker cached more of the API than ADR 0004 allows, and "remove my data" could say it had finished while caches, Serwist's expiration rows (their URLs name the sites a worker looked at) or an unconfirmed server registration remained. The fixes were rulings in a git-ignored ledger; no ADR recorded them.

## Options considered
| Option | Verdict |
|---|---|
| Leave the invariants as F1 code comments and ledger rulings | Rejected: ADR 0012 rule 6; F2 plan Task 23 and Global Constraints cite them as binding and nothing in `docs/` does |
| Amend ADR 0004 only | Rejected as the record (a pointer is added, see Amendments there): the decision is frontend-wide and carries its own tests and consequences |
| A new ADR naming the two invariants, the tests that guard them and the known limits (chosen) | Accepted |

## Decision
1. **(a) Cache allow-list.** The service worker keeps exactly two API responses: `GET /api/v1/sites/{site_id}/forecast/today` and `GET /api/v1/risk-policy` (`OFFLINE_API_ALLOW_LIST`), `NetworkFirst` into `sb-api` (20 entries, 48 h, 4 s network timeout). Every other same-origin `/api/` GET is `NetworkOnly`, registered ahead of Serwist's `defaultCache`; non-GET requests have no route. Adding a pattern is a governance decision: an ADR first (ADR 0060 is the first and adds nothing), then the list and its pin test change together. Pages stay cacheable because F1 pages carry no personal data (R27); revoke clears them anyway, because a page URL can carry `?site=<id>` (R33).
2. **(b) Revocation.** "Remove my data" never reports success while device data or an unconfirmed server registration remains. It clears the profile, the API and page caches and Serwist's expiration rows (committed, strict durability), checks again afterwards (`deviceDataRemains`; not knowing is not an all-clear), reports `pending` or `failed` instead of `done`, and keeps a durable "incomplete" marker (a version, a time and step names, no personal data) that is retried each time Alerts opens. A revoke epoch and a storage listener stop a second tab or an in-flight subscribe from writing revoked data back (R34), and a revoke supersedes a running resume (R39).
3. **The opaque registration id (R32).** If deleting the server's push registration fails, the device keeps only that id, under its own key (`sb-push-pending-delete-v1`), writes it before the profile is cleared, retries the DELETE on the next revoke, Alerts open and reconcile, and drops it on a 2xx or 404/410. While an id is outstanding, revoke says "pending", not "removed" (`alerts.removeData.pending`). The registration on the server (endpoint, site, optional crew; ADR 0058) stays until the server confirms.
4. **F2 extends (b):** revoke also clears the site pin (F2 plan C7, Task 3); no employer or token response may reach CacheStorage (Task 23).

**Tests that guard them** (F1 worktree, all green at the F1 stop: 1253 unit, 82 e2e):
- (a): `tests/unit/features/pwa/runtime-caching.test.ts` (a real production `defaultCache` guards against a vacuous pass; without our rules a crew timeline would be cached in `apis`; the two allow-listed paths are `NetworkFirst` in `sb-api`; fourteen other paths, including `/api/v1/sites`, `.../crews`, `.../timeline` and `.json` look-alikes, are `NetworkOnly`; POST/PUT/PATCH/DELETE have no route; our rules sit ahead of every default rule); `api-cache.test.ts` ("is exactly the forecast of one site and the risk policy"; the cache names match the installed Serwist); e2e `pwa.spec.ts` "no API response outside the allow-list is kept in any cache".
- (b): `tests/unit/features/profile/store.test.ts` (for example: a failed DELETE keeps "the id, and only the id"; the id is written before the profile is cleared; a failed expiration clearing is "never done"; a clearing that cannot check is not an all-clear; the marker "holds no personal data and no id"), `revoke-marker.test.ts`, `api-cache.test.ts` (expiration rows deleted in one strict-durability transaction; a changed Serwist store is rejected, not guessed at); e2e `revoke.spec.ts` (four tests: nothing left with the worker running; registration still owed; expiration record not clearable; incomplete state survives a reload).

## Consequences
- **Known limits, accepted:** a response that lands after the post-clear check can re-cache the non-personal forecast once (R38; a service-worker-side guard is parked); Serwist's `serwist-expiration` database is emptied, not deleted, so an empty shell remains (R35); a new personal cache must be added to `DEVICE_CACHE_NAMES` (R37); a 5xx reads as "stale", not "error" (R26).
- **Open, not decided here:** the consent copy (`profile.consent.server`, `revoke`) does not mention that one opaque registration id can remain after revoke until the server confirms (R32; F1 "Awaiting the user"). It needs Ali's answer; the pending message already tells the worker the subscription is not yet cancelled.
- **Cost of being wrong:** too strict, less offline coverage (ADR 0060: supervisors get none). Too loose, a shared phone shows another person's data, or tells a worker their data is gone while a URL naming their site remains.

## Revisit trigger
Authentication arrives (R27: personal HTML would then be cached); a Serwist upgrade renames a default cache or changes the expiration database (the tests fail on purpose); a new cache or store holds anything personal.

## Links
[ADR 0004](0004-tiered-alert-delivery.md) · [0009](0009-evolvability-configurability.md) · [0058](0058-alert-events-push-contract-and-stale-forecast-fallback.md) · [0060](0060-offline-allow-list-stays-closed.md) · [F2 plan](../superpowers/plans/2026-11-14-f2-core-demo-screens.md) Global Constraints, Task 23
