# ADR 0052: Defer the config admin HTTP API; runtime changes go through `sb-jobs config` (B1 7B), which now writes `config.*` audit events

- **Status:** Accepted (Ali, 2026-11-14); previously Proposed-for-Ali
- **Date:** 2026-11-14
- **Deciders:** the B3 architect (Claude); Ali to accept
- **Supersedes / superseded by:** defers roadmap §5 "Config admin API" and ADR 0010 §3's `POST /api/v1/admin/config/*` routes. **Conflicts** with I1 plan Task 7 Steps 3b-3c and roadmap §8's drill line, which use the HTTP API; they switch to the CLI (below). ADR 0041's "B3's HTTP route must require `expected_previous`" applies when the route is built. **Also conflicts with ADR 0045 §3** (accepted 2026-11-14), which lists the config admin API in the unchanged B3 MUST set; Ali's B3 brief says the opposite. If Ali keeps 0045's wording, B3 plan contingent Task 18 (about 2 h) builds it and this ADR is superseded.
- **Evidence:** Ali's scope ("the settings admin screen is out of F2 scope, but the config store and a CLI exist"; "B3 must expose exactly the API those 9 views need"); B1 `jobs/cli.py` `sb-jobs config {seed,show,history,validate,propose,activate,rollback}` with `--actor`, `--reason`, `--expected-previous`; ADR 0010 §4.4 (CLI writes need DB credentials).

## Decision
1. No `/api/v1/admin/config/*` and no public `/api/v1/config/*` routes in B3. `SB_ADMIN_TOKENS` is not introduced.
2. B3 extends the Postgres config store so `create_version`, `activate` and `rollback` append `config.version_created` / `config.activated` / `config.rollback` / `config.rejected` audit events in the same transaction (ADR 0010 §4.5); `config.auth_failed` has no source until an HTTP route exists.
3. **The I1 drill** runs `sb-jobs config propose|activate|rollback` as a one-off execution of the `job-migrate` image (`az containerapp job start` with a command override), then checks the `api` revision name is unchanged and new decisions carry the new `config_version`.

## Consequences
- **Cost of being wrong:** the demo cannot show a live config change from a browser; the drill is a terminal step. If F2 scope grows to the admin screen, the routes are about 2 h on top of `ConfigService`.
- I1 Steps 3b-3c need an amendment by their owner (the frontend/infra architect).

## Revisit trigger
The settings admin screen returns to F2 scope; a second admin needs access without DB credentials.

## Links
[ADR 0010](0010-runtime-tunable-configuration.md) · [0041](0041-config-rollback-token-and-dev-pin-precedence.md) · [I1 plan](../superpowers/plans/2026-11-11-i1-azure-infra.md) Task 7

## Amendments
- **2026-11-14 (acceptance; decision text unchanged).** Accepted by Ali in chat (ADRs 0046-0058, all 13). Status changed from Proposed-for-Ali. The conflicts named in the Supersedes line (ADR 0045 decision 3; I1 Task 7 Steps 3b-3c) are resolved in favour of this ADR, as follows.
- **2026-11-14 (the admin API stays deferred; Ali can overrule; decision text unchanged).** In the same chat Ali amended [ADR 0045](0045-f2-scope-core-demo-path.md) (a tenth core view and four fold-ins). None of them is the settings admin screen, so the `admin` screen (ADR 0045 view 11) and this admin HTTP API both stay deferred. B3 plan Task 18 stays **contingent**: only the sign-off task, Task 17, was promoted to MUST ([ADR 0053](0053-defer-sign-off-pay-impact-and-task-ordering.md) Amendments). The "config admin API" in the B3 MUST set of ADR 0045 decision 3 is narrowed to this ADR. **Still open for the I1 owner:** I1 Task 7 Steps 3b-3c and the roadmap section 8 drill line still call the HTTP API and need the CLI drill of decision 3; this amendment does not edit them.
