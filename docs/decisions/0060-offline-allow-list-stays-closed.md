# ADR 0060: The offline allow-list stays closed: supervisor views are online-only; three public reads are not added

- **Status:** Accepted by the architect (default; Ali informed 2026-11-14 and can overrule)
- **Date:** 2026-11-14
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Settles F2 plan conflict C6 and decision D2; applies the rule in [ADR 0059](0059-frontend-governance-invariants-sw-allow-list-and-revocation.md) decision 1 (any addition is decided in an ADR first). This ADR adds nothing, so it is also the "defer / reject" record for the three reads.
- **Evidence:** F2 plan (`docs/superpowers/plans/2026-11-14-f2-core-demo-screens.md`) conflict C6, Task 19 States ("offline (notice; data only if C6 approved)"), Task 23 Interfaces (1); v2 journeys SU8 ("S1/S2 from cache"); ADR 0050 decision 2 (a crew's level uses no member data); ADR 0051 decision 1 (the three reads are public); F1 `src/features/pwa/api-cache.ts` (`API_CACHE_MAX_AGE_SECONDS` 48 h, `API_CACHE_MAX_ENTRIES` 20) and `tests/unit/features/pwa/runtime-caching.test.ts` (the three paths are asserted `NetworkOnly` today).

## Context
The F2 plan proposed adding `GET /api/v1/sites`, `GET /api/v1/sites/{id}/crews` and `GET /api/v1/crews/{id}/timeline` to `OFFLINE_API_ALLOW_LIST` so that supervisor screens S1 and S2 could be read offline from cache (about 9 entries; the cache holds 20). They are public and, by ADR 0050, carry no member data. But a cached crew list and timeline holds crew names, headcounts and the `suppressed`/`k` flags for up to 48 hours on whatever device the supervisor used, and the device-clearing path of ADR 0059 is a worker's "remove my data": F2 plans no equivalent for a supervisor (the Stop outbox "is not touched by a worker revoke").

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| Add the three reads; supervisor views readable offline | Meets journeys SU8 literally; costs a governance change and a new clearing story | Rejected for the demo |
| Leave the list at two entries; supervisor offline shows a notice and the Stop-work outbox (chosen) | Judges are online (replay mode, ADR 0034); Stop work still queues and never reports "sent" (F2 plan Task 19, 23) | Accepted |
| Add them later for a pilot, after a privacy review of k-suppressed crew data | Needs a supervisor-side clearing path and a written view on crew sizes under k | Deferred (the revisit trigger) |

## Decision
**No.** `OFFLINE_API_ALLOW_LIST` stays exactly the two patterns of ADR 0059. The supervisor routes are online-only. Offline, `/supervisor` shows the offline notice and the Stop-work outbox state. F2 Task 23 keeps its other work: every F2 operationId has a cache rule (allow-listed or `NetworkOnly`), the unwell sheet is precached, and the e2e `no employer route is cached` runs. The `api-cache.test.ts` pin ("is exactly the forecast of one site and the risk policy") stays unchanged.

## Consequences
- A supervisor without signal sees no crew levels; the safety action (Stop work) still works from the outbox and says "Not sent: no signal. Tell the crew now."
- The judged demo is unaffected (online, replay). The cost falls on a real site with patchy connectivity, which no judge sees.
- **Cost of being wrong:** a pilot supervisor in a dead zone gets less than the design promised (SU8). Reversal is one list entry plus its pin test, once the review below is done.

## Revisit trigger
A pilot with patchy site connectivity, **and** a privacy review of k-suppressed crew data (what a stale copy on a supervisor's device reveals) **and** a supervisor-side way to clear the cache. All three, not any one.

## Links
[ADR 0050](0050-crew-timeline-and-k-suppression-semantics.md) · [0051](0051-api-v1-surface-for-the-core-demo-path.md) · [0059](0059-frontend-governance-invariants-sw-allow-list-and-revocation.md) · [parking lot](../parking-lot.md)
