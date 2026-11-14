# ADR 0066: Demo reset is a new epoch; the audit stays append-only

- **Status:** Proposed by the architect, awaiting Ali's confirmation (the epoch key is still undecided)
- **Date:** 2026-11-14
- **Deciders:** Ali (owner); the architect (Claude) drafts. The acceptance reached the docs agent through the architect's instruction; no quotation from Ali is on file for this ADR.
- **Supersedes / superseded by:** none. Settles the open items of [ADR 0062](0062-public-demo-access-model.md) decision 3 and Consequences (a) and (b) as far as the reset control goes; rate limits and the banner wording still have no task.
- **Evidence:** ADR 0062 (decision 3: "Rate limits and a reset control keep the demo usable after a visitor has acted"; Consequences (b): "a reset cannot delete audit rows ... What 'reset' resets must be defined first", three candidates, none chosen); ADR 0054 decision 4 (`audit_event` append-only by row trigger on UPDATE and DELETE and statement trigger on TRUNCATE; hash-chained; `sb-jobs audit verify` exits 1 at the first break); B3 plan Task 7 (the `day_plan`, `alert_event` and `audit_event` tables get the same row and TRUNCATE triggers; `site(..., synthetic)`; `crew(id, site_id FK, ...)`; `crew_stop(id, crew_id FK, started_at, cleared_at NULL, ...)`); ADR 0046 decision 7 (a crew-lead stop raises the crew's level to Red); ADR 0058 decision 1 (an alert event is compared with "the last event sent for that target"); ADR 0057 decision 2 (the frozen fixture `demo_site.toml`, site `site-demo-mussafah`, crews `crew-a` to `crew-d`); F2 plan Task 2 (the BFF token allow-list for `site-demo-*` and `crew-[a-d]`).

## Context
On the public demo every visitor can act as an employer on the synthetic site (ADR 0062). A visitor's Stop raises crew B to Red; each data request appends a row to the transparency log every worker of the site can read (ADR 0054). The next visitor, or the judge, sees what the last visitor did. A reset is needed, but the tables that hold these actions are protected: `audit_event`, `day_plan` and `alert_event` refuse UPDATE, DELETE and TRUNCATE by trigger, and the audit table is hash-chained. ADR 0062 listed three candidates and chose none: reset stops and sign-off state only; show the transparency log from the last reset; rebuild the demo database before judging.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| Delete the rows (stops, sign-offs, plans, data requests, audit) | The triggers refuse it; dropping them to do it breaks the append-only invariant that the governance demo itself states (ADR 0054), and `audit verify` would exit 1 at the first rewritten row | Rejected |
| Restore a database snapshot | It rewinds `audit_event` as well and drops every row appended since the snapshot. The chain would still verify, but the record of what happened would be gone, which is what append-only prevents. No snapshot or restore task exists in the plans (Postgres only, ADR 0002) | Rejected |
| Reset only stops and sign-off state (ADR 0062 candidate 1) | Leaves data requests in the worker-visible transparency log; it is the epoch idea for two tables only | Not chosen alone; the epoch covers it |
| A new epoch: a fresh synthetic site instance; reads are scoped to the current epoch; the audit continues (chosen) | Nothing is deleted or rewritten; the invariant holds; the next visitor starts from the frozen fixture | Accepted |

## Decision
1. **"Reset demo site" creates a fresh synthetic site instance, an epoch,** instantiated from the frozen fixture (ADR 0057). No byte of `demo_site.toml` changes, so `demo_site_sha256` is unchanged.
2. **Plans, sign-offs, stop events and data requests are scoped to the epoch.** A read returns only the current epoch's rows. Earlier epochs' rows stay in their tables, unread by the demo.
3. **The hash-chained audit (ADR 0054) continues across epochs, unbroken, and records a `demo_reset` event** (time, actor from the token, role, employer id, site id, old and new epoch). The event is not worker-visible: ADR 0054 decision 3 names the worker-visible kinds and this ADR adds none.
4. **The reset is guarded to the synthetic site.** It is refused for any site whose `synthetic` flag is false. The exact status code and audit kind of the refusal belong to the B3 task. The BFF allow-list (F2 plan Task 2) must list the reset call deliberately, on `site-demo-*` ids only.
5. **Rate limits are per token (ADR 0062 decision 3)** and cover the reset and the other employer actions. The values are not decided here.

## Consequences
- **Open, flagged for the B3 and F2 tasks (none exists yet; no estimate on file).**
  - **How the epoch is keyed is not decided.** Option A: a new site id per epoch (the allow-list already matches `site-demo-*`); the transparency log reads audit rows by `site_id`, so it is scoped with no change to `audit_event`. Option B: an `epoch_id` column on the scoped tables; then `audit_event` needs the column too and `verify` must accept older rows without it.
  - **Crew ids collide.** `crew.id` is a global key and the allow-list, the F2 routes (`/en/supervisor/crews/crew-b`) and the e2e journey (Task 26) use fixed ids `crew-a` to `crew-d`. A second site instance needs epoch-scoped crew keys or a composite key.
  - **Alert events and push subscriptions are not in the list above but hang off site and crew.** ADR 0058 compares a new timeline with "the last event sent for that target": if the previous visitor's Red persists as that last event, the next visitor's Stop may not raise a Red push. Subscriptions tied to one site id would not follow a new site id.
- **Shared token, one limit.** ADR 0062 holds a single demo token, so "per token" means one ceiling for all visitors, not one per visitor; a per-visitor limit needs a client key at the BFF. A judge can still lose their state if another visitor resets mid-journey; the rate limit bounds how often, it does not prevent it.
- **Guards the task must carry:** `test_reads_are_epoch_scoped`; `test_reset_refused_for_non_synthetic_site`; `sb-jobs audit verify` passes after a reset (the existing CI step); the reset appends `demo_reset`.
- **Cost of being wrong.** A read that misses the epoch filter shows one visitor's synthetic actions to the next: reputational only, no real data. A reset not guarded by `synthetic` could reach a real site if one is ever added: severe, hence the guard and its test. Old epochs accumulate without deletion; the volume is small and bounded by the rate limit.

## Revisit trigger
Any non-synthetic site or data in the deployment (ADR 0062's trigger: the reset is removed); per-visitor sessions (an epoch per visitor); the epoch key proves incompatible with the crew ids or the alert event rule; or old epochs need a retention rule.

## Links
[ADR 0062](0062-public-demo-access-model.md) · [0054](0054-governance-refusal-and-hash-chained-audit.md) · [0057](0057-plans-row-baselines-and-crew-fixture.md) · [0046](0046-warning-level-policy.md) · [0058](0058-alert-events-push-contract-and-stale-forecast-fallback.md) · [B3 plan](../superpowers/plans/2026-11-14-b3-warnings-planner-governance-api.md) Task 7 · [F2 plan](../superpowers/plans/2026-11-14-f2-core-demo-screens.md) Tasks 2 and 26 · [parking lot](../parking-lot.md)
