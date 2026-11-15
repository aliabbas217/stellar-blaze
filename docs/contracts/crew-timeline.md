# Crew timeline contract (proposal)

- **Status:** Proposal from the F1 frontend foundation (Task 5), 2026-11-11, amended by fix round 1 (ruling R24). B3 Task 0 owns the real contract from 14 Nov.
- **Evidence:** ADR 0004 (personal risk is computed on the device and never sent to the server; supervisor views show crew aggregates only), plan section 8.8, `frontend/openapi/stellar-blaze.mock.openapi.json` (`CrewTimeline`, `CrewHour`).
- **Endpoint:** `GET /api/v1/crews/{crew_id}/timeline?date=YYYY-MM-DD` returns `CrewTimeline`: `{crew_id, crew_name, site_id, date, suppressed, k, hours: [{starts_at, crew_level, share_above_amber, ban_active}]}`.

## The rule (written into the OpenAPI descriptions, which B3 inherits if it adopts the spec)

1. **Where the aggregates come from.** `crew_level` and `share_above_amber` derive only from inputs the server holds about the site and the crew. They never derive from personal risk reported by a device. The server never receives personal risk (ADR 0004), so no aggregate over members' personal levels can exist on it.
2. **What a suppressed crew withholds.** A crew with fewer than `k` members has `suppressed: true`. Then `share_above_amber` is `null` on every hour, and `crew_level` carries no member-derived information: it comes from site and crew inputs, or it is `null`. Nothing else in the response may single out a member.
3. **Why.** In a crew of three, a level taken as the maximum over members, or a share such as 0.33, points at one person. Suppression only helps if every field of the response respects it, not just the share.

What exists today: the mock data follows the rule (`crew-b`: 3 members, `suppressed: true`, `k: 5`, share `null` on every hour). What is planned and not built yet (the supervisor screen, plan Task 11, is on hold): for a suppressed crew the screen shows the crew level and a message naming `k`, never a percentage. `frontend/tests/unit/api/contract-governance.test.ts` fails if these descriptions disappear from the OpenAPI document.

## To B3: two questions for Task 0

1. **Name the data source of `share_above_amber`.** "The share of the crew above amber" reads as a count of people whose personal level is above amber, which needs per-person levels on the server and contradicts ADR 0004. Say what server-held crew input produces it (and from which tables), or replace or drop the field. The planned supervisor screen will display it only, as a whole percentage, when `suppressed` is false.
2. **Confirm the suppression semantics.** Confirm that `suppressed` is true exactly when the crew has fewer than `k` members, where `k` comes from the runtime configuration above the legal floor (ADR 0010, `k_suppression` in `RiskPolicy` and in this response); that `share_above_amber` is `null` on every hour of a suppressed crew; and that `crew_level` for a suppressed crew is derived from site and crew inputs only, or `null`. If you would rather return `null` there, the planned supervisor screen treats a null hour as "no data", so nothing else changes.

This file and the mock OpenAPI are a proposal. Adopt or replace them in B3 Task 0; keep the rule above (the frontend test checks it against whatever OpenAPI document `api:gen` reads) and regenerate `frontend/src/api/schema.d.ts` with `pnpm api:gen`.
