# ADR 0051: The `/api/v1` surface is exactly what the nine core views need; operationId = the route function's snake_case name; scored numbers ship as static files, not routes

- **Status:** Accepted (Ali, 2026-11-14); previously Proposed-for-Ali
- **Date:** 2026-11-14
- **Deciders:** the B3 architect (Claude); Ali to accept
- **Supersedes / superseded by:** adopts and replaces the F1 mock contract (`frontend/openapi/stellar-blaze.mock.openapi.json`, 0.1.0-mock; `docs/contracts/web-push.md`, `crew-timeline.md`); roadmap §5's planner routes (`POST /sites/{id}/day-plans`, `POST /day-plans/{id}/sign-off`, `GET /sites/{id}/roster-frontier`) are not built (ADR 0053, ADR 0045 scope).
- **Evidence:** Ali's F2 scope (core path: landing + story, season scoreboard, day zoom, proof drawer, try-a-plan, worker today + alert, supervisor crews, governance refusal); `backend/src/stellar_blaze/api/app.py` `operation_id()` (route name, contract test of uniqueness); F1 uses `openapi-fetch` keyed by path, operationIds appear only in a test message (`tests/unit/api/contract-governance.test.ts`); v2 journeys §6.3 ("D1, D2, D3, D5, D9 are static JSON, SSG'd and precached: they render with the API stopped").

## Decision
1. **Routes** (all under `/api/v1`, problems as RFC 9457):

| View | Method + path | operationId | Auth |
|---|---|---|---|
| worker today, supervisor | `GET /sites` | `list_sites` | public |
| worker today, day zoom card | `GET /sites/{site_id}/forecast/today?date=` | `get_site_forecast_today` | public |
| worker today, alert | `GET /risk-policy` | `get_risk_policy` | public |
| supervisor crews, worker join | `GET /sites/{site_id}/crews` | `list_site_crews` | public |
| supervisor crews | `GET /crews/{crew_id}/timeline?date=` | `get_crew_timeline` | public |
| supervisor crews, story "product" | `GET /crews/{crew_id}/day-plan?date=` | `get_crew_day_plan` | employer token, own employer only |
| try-a-plan | `POST /plans/validate` | `validate_plan` | public |
| worker alert | `POST /push/subscriptions`, `DELETE /push/subscriptions/{subscription_id}` | `create_push_subscription`, `delete_push_subscription` | public |
| governance refusal | `POST /sites/{site_id}/data-requests` | `create_data_request` | employer token; always 403 for individual data |
| governance refusal (worker side) | `GET /sites/{site_id}/transparency-log` | `get_site_transparency_log` | public |
| none in the nine (kept by ADR 0045 §3; safety: ADR 0011 §2.6 "a crew lead can stop at any time") | `POST /crews/{crew_id}/stops`, `DELETE /crews/{crew_id}/stops/{stop_id}` | `create_crew_stop`, `delete_crew_stop` | employer token, own employer only |

**Conflict recorded:** Ali's B3 brief says "exactly the API those 9 views need, nothing more"; ADR 0045 §3 (accepted by Ali the same day) says the B3 MUST set, "sign-off and stop-work endpoints … config admin API", is unchanged. This ADR keeps the stop endpoints (a safety control is never scoped out for want of a screen) and defers sign-off and the config admin API (ADR 0052, 0053), with contingent plan tasks if Ali prefers ADR 0045's wording.

2. **operationId scheme confirmed:** the route function's name, snake_case `verb_noun` (existing `operation_id()` and its uniqueness test). F1's camelCase ids are not kept; nothing in the frontend depends on them.
3. **Scored and static numbers are files, not routes:** `artifacts/eval/2026/{policy_scoreboard,plan_scoreboard,demo_day}.json`, `artifacts/eval/dev/theta.json` and `artifacts/eval/static/roster_frontier.json`, each with a `provenance` block (B2 `domain/provenance.py`). F2 imports them at build time. Their pydantic models are added to `openapi/v1.json` `components.schemas` by `export_openapi` so one `pnpm api:gen` types them.
4. **Times:** every instant is ISO 8601 UTC (`Z`); `date` query parameters are the site's local date (`Site.timezone`, Asia/Dubai); a missing `date` is the site's local today in live mode and `Settings.replay_default_date` in replay mode.
5. **Auth (demo-time):** `SB_ACCESS_TOKENS` (Container Apps secret, JSON `{sha256(token): {actor, role, employer_id}}`), compared with `hmac.compare_digest`. Role `employer` only. Workers have no account; worker routes return non-personal data only. The BFF holds the demo employer token server-side.
6. **v1 freeze:** after Task 0 merges, oasdiff gains `--fail-on ERR`; changes are additive.

## Consequences
- The F1 contract changes in three places: `share_above_amber` removed (ADR 0050), additive fields (`forecast_status`, `mode`, `k_health`), new paths. F2 regenerates types.
- The roadmap's "API contract v1 frozen 14 Nov" slips to 15 Nov noon (B3 Task 0). **Cost:** half a day of F2 working on the mock.

## Revisit trigger
A view is added to F2 scope (its route is added additively); HSE week or settings admin returns to scope (ADR 0052).

## Links
[ADR 0004](0004-tiered-alert-delivery.md) · [0009](0009-evolvability-configurability.md) §5 · [0050](0050-crew-timeline-and-k-suppression-semantics.md) · [0052](0052-defer-config-admin-http-api.md) · [0053](0053-defer-sign-off-pay-impact-and-task-ordering.md) · [0054](0054-governance-refusal-and-hash-chained-audit.md)

## Amendments
- **2026-11-14 (acceptance; decision text unchanged).** Accepted by Ali in chat (ADRs 0046-0058, all 13). Status changed from Proposed-for-Ali.
- **2026-11-14 (route surface after Ali's screen-scope decisions; decision text unchanged).** Consequences of the same-day amendments to [ADR 0045](0045-f2-scope-core-demo-path.md) (a tenth core view and four fold-ins) and [ADR 0053](0053-defer-sign-off-pay-impact-and-task-ordering.md) (sign-off stays in B3). The title's and the Evidence's "nine core views" read as ten from this date.
  - **One route is added, additively:** `POST /crews/{crew_id}/day-plan/sign-off`, operationId `sign_off_day_plan` (the route function's name; the scheme of decision 2 is unchanged), employer token, own employer only. It is B3 plan Task 17 (ADR 0011 section 7.1), now MUST. The Supersedes line lists roadmap section 5's `POST /day-plans/{id}/sign-off` among the routes that "are not built"; that no longer holds for sign-off: the path is crew-scoped, as Task 17 states, and the capability is built. The surface is **14 operations** (the 13 of decision 1 plus this one) and the two health routes. Because the contract freezes after B3 Task 0, Task 0's models and its operation-count test must carry the route from the start (B3 plan header note).
  - **The stop routes now have a consumer.** The row marked "none in the nine" is called by the Stop work control on supervisor crews (ADR 0045 Amendments); they are no longer kept only for want of a screen.
  - **The folded-in items add no route.** The call sheet is static; the roster-frontier chart is the static file of decision 3; the worker access log reads `get_site_transparency_log`; Stop work uses `create_crew_stop` and `delete_crew_stop`.
  - **The conflict recorded under decision 1 is settled by Ali:** the stop endpoints are kept and used, sign-off is built, and the config admin API stays deferred ([ADR 0052](0052-defer-config-admin-http-api.md)).
