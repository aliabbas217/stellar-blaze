# ADR 0062: Public demo access model: the server-side proxy holds a demo employer token, and any visitor can act on the synthetic site

- **Status:** Accepted (Ali, 2026-11-14)
- **Date:** 2026-11-14
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Settles F2 plan decision D4 and Review Focus 5; makes explicit the consequence of ADR 0051 decision 5 ("The BFF holds the demo employer token server-side").
- **Evidence:** ADR 0051 decision 5 and the `/api/v1` table (employer-token routes: `get_crew_day_plan`, `create_data_request`, `create_crew_stop`, `delete_crew_stop`, and `sign_off_day_plan` by the amendment); ADR 0054 (the refusal is the same for every role; the audit row is visible to every worker of the site); ADR 0046 decision 7 (a crew-lead stop raises the crew's level to Red); ADR 0057 (the fixture is SIMULATED, site `site-demo-mussafah`, "(synthetic)"); F2 plan Task 2 (`employerAuth(method, path)` injects the token only on listed method and path pairs for `site-demo-*` and `crew-[a-d]`, strips any client `Authorization`, injects nothing without the env token; `test_bff_injects_token_only_on_allow_list`), Task 15 ("The page never auto-sends"), Task 26 (journey: sign off, then Stop work, then the live 403).

## Context
The deployed demo has no visitor login. For the judged journey (sign off a plan, Stop work with undo, the employer's refused data request) the Next.js server-side proxy (BFF) attaches one demo employer token to a fixed set of calls on the synthetic site. So every visitor of the demo URL can do what an employer supervisor can do there. All data is synthetic; no worker has an account.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| Read-only visitors: employer actions disabled, a recorded run shown instead | Removes the live proof of Stop work, sign-off and the 403; ADR 0034 §9 makes the governance refusal never-cut and the Task 26 journey exercises all three live | Rejected |
| Per-visitor tokens or sessions | Needs token issuance, a session store and clean-up (ADR 0002: no Redis; no auth service); gives each visitor the same powers anyway; cannot land before the 18 Nov freeze | Rejected for the demo; deferred (trigger below) |
| One shared demo token in the proxy; visitors can act on the synthetic site, with guards (chosen) | The allow-list in Task 2 limits the token to a fixed method and path set on synthetic ids | Accepted |

## Decision
1. The proxy holds `DEMO_EMPLOYER_TOKEN` (read at request time, never `NEXT_PUBLIC`) and injects it only on the Task 2 allow-list. Visitors can Stop work, sign off a plan and file the data request on the synthetic site.
2. The synthetic site is labelled on screen ("synthetic demo site") wherever an employer action is available; real data is never loaded into the demo deployment.
3. Rate limits and a reset control keep the demo usable after a visitor has acted (see Consequences: neither is assigned yet).

## Consequences
- **Risk, stated plainly:** a judge may read "anyone can sign off" as weak governance. Mitigations: the banner and the "(synthetic)" site name; ADR 0054's refusal demo, which shows that an employer role cannot obtain individual health data at all; the token is confined to synthetic ids; no real data.
- **A visitor's actions are visible to the next visitor:** a Stop raises crew B to Red (ADR 0046); each data request appends a row to the public transparency log (ADR 0054). Hence the rate limit and the reset.
- **Open, flagged for the architect:** (a) the F2 and B3 plans contain no task for rate limiting, for a reset control, or for the "synthetic demo site" banner wording (the `SIMULATED` stamp and the site name exist; the banner does not); (b) a reset cannot delete audit rows, because ADR 0054 makes `audit_event` append-only and hash-chained (row and TRUNCATE triggers). What "reset" resets must be defined first. Candidates, none chosen: reset stops and sign-off state only; show the transparency log from the last reset; rebuild the demo database before judging. Needs an owner before 17 Nov.
- **Cost of being wrong:** reputational, not a data risk (everything is synthetic). If the shared token is abused, the cost is a reset and a rate-limit setting, not a leak.

## Revisit trigger
Any real pilot site, any non-synthetic data in the deployment, or worker or supervisor accounts (ADR 0054's trigger): then per-user authentication replaces the shared token and the allow-list is removed.

## Links
[ADR 0046](0046-warning-level-policy.md) · [0051](0051-api-v1-surface-for-the-core-demo-path.md) · [0054](0054-governance-refusal-and-hash-chained-audit.md) · [0057](0057-plans-row-baselines-and-crew-fixture.md) · [F2 plan](../superpowers/plans/2026-11-14-f2-core-demo-screens.md) Tasks 2, 15, 26 · [parking lot](../parking-lot.md)

## Amendments
- **2026-11-14 (pointer; decision text unchanged).** [ADR 0066](0066-demo-reset-is-a-new-epoch-audit-stays-append-only.md) defines what "reset" resets: a new epoch of the synthetic site, with reads scoped to it; nothing is deleted and the hash-chained audit continues and records `demo_reset`. That settles Consequences (b) and the reset-control part of (a). Still without a task: the rate limits (decision 3; ADR 0066 decision 5 says per token, which with one shared token is a single ceiling for all visitors) and the "synthetic demo site" banner wording.
