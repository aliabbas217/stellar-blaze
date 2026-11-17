# ADR 0054: The governance refusal stores no subject and is shown to workers as a site transparency log; the audit table is append-only and hash-chained

- **Status:** Accepted (Ali, 2026-11-14); previously Proposed-for-Ali
- **Date:** 2026-11-14
- **Deciders:** the B3 architect (Claude); Ali to accept
- **Supersedes / superseded by:** none. Implements ADR 0034 §9 (never cut: employer → 403 → audit row visible to the worker) and ADR 0010 §4.5 (governance audit trail).
- **Evidence:** ADR 0004 (no personal data on the server; workers have no account, only a push subscription); `api/middleware.py` (the request path is logged, the body is not); ADR 0010 §3 (append-only tables with row and TRUNCATE triggers, owner can still drop them: "separate DB roles" parked); v2 journeys §6.3 step 6 and W5 "My data" (refused employer request row).

## Context
A worker has no server identity, and the employer would name a worker by name or staff number, which the server cannot map and must not store. A path parameter would put that name in the request log.

## Decision
1. **Request:** `POST /api/v1/sites/{site_id}/data-requests` with body `{"subject": "worker", "data_class": "health", "worker_ref": "<free text>"}` and an employer token. The answer is always **403** `urn:stellar-blaze:problem:individual-data-refused` for `data_class` health or personal; no role gets 200 (no such data exists server-side). Without a token: 401. `worker_ref` is validated (1-100 chars) and then discarded: never stored, logged or echoed.
2. **Audit row** `data_request.refused`: time, actor (from the token), role, employer id, site id, outcome, rule (`ADR 0004; PDPL purpose limitation`), ruleset id + SHA-256, model id, config version id + SHA-256. No subject field exists in the schema.
3. **Worker view:** `GET /api/v1/sites/{site_id}/transparency-log` lists the worker-visible kinds (`data_request.refused`) for that site, newest first, limit 50. Every worker of the site sees it; the claim on screen is "an employer request for individual health data at this site was refused", never "about you".
4. **Tamper evidence:** `audit_event` is append-only (row trigger on UPDATE/DELETE, statement trigger on TRUNCATE, as in migration 0002) **and** hash-chained: `row_hash = sha256(prev_hash ‖ canonical JSON of the row)`, `prev_hash` of the first row = 64 zeros, inserts serialised with `pg_advisory_xact_lock(<constant>)`. `sb-jobs audit verify` recomputes the chain and exits 1 at the first break, naming the row id.

## Consequences
- An owner who drops the trigger can still rewrite rows, but cannot do it without breaking the chain unless they rewrite every later row; `verify` runs in CI on the integration database and in the demo checklist. Separate DB roles stay parked (ADR 0010).
- **Cost of being wrong:** the transparency log tells all workers of a site about each refused request (more disclosure, not less). A worker-specific view would need a worker identity, which ADR 0004 avoids.

## Revisit trigger
Worker accounts exist; a regulator view needs the log; the separate DB roles row fires.

## Links
[ADR 0004](0004-tiered-alert-delivery.md) · [0010](0010-runtime-tunable-configuration.md) §3-§4 · [0034](0034-demo-strategy.md) §9 · [0051](0051-api-v1-surface-for-the-core-demo-path.md)

## Amendments
- **2026-11-14 (acceptance; decision text unchanged).** Accepted by Ali in chat (ADRs 0046-0058, all 13). Status changed from Proposed-for-Ali.
- **2026-11-14 (pointer; no change to the decision).** The worker access log that [ADR 0045](0045-f2-scope-core-demo-path.md) Amendments folds into the governance refusal view is backed by this ADR's site transparency log (`get_site_transparency_log`).
- **2026-11-15 (B3 ruling on a limit of the chain; decision text unchanged).** The hash chain detects an edited, deleted or reordered row in the **middle** of the log, but **truncating the tail** (dropping the newest rows) is undetectable from the database alone, because the remaining prefix is still a valid chain. Without an external anchor, "the log has not been truncated" cannot be claimed. B3 therefore makes `sb-jobs audit verify` print `{"chain":"intact","rows","head_id","head"}` (or `audit.chain_broken id=N`, exit 1) and the head hash is to be **recorded outside the database** (the demo checklist and the submission's evidence log) at a stated time; a later `verify` whose chain does not contain the recorded head proves truncation. `audit_event.prev_hash` is UNIQUE, which also blocks a forked chain. Wording rule for the deck and the governance screen: say "tamper-evident" for edits and deletions, and "head hash recorded at <time>" for completeness; never "tamper-proof". **Cost of being wrong:** a claim of an unbroken log that a truncated database would still pass. **Revisit trigger:** a regulator view, or an external append-only store (the separate DB roles row, ADR 0010).
