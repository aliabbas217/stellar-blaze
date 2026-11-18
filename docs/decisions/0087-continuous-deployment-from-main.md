# ADR 0087: Continuous deployment from `main`; the immutable OIDC subject; the post-submission rule

- **Status:** Accepted (owner decision, 2026-11-17) for `main` as the default branch and for deploying only from it. The post-submission rule is the owner's (2026-11-17) in its core: only small cosmetic changes after the deadline; the pull-request-with-green-CI-and-smoke part is the controller's addition and is **Proposed** until the owner confirms.
- **Date:** 2026-11-18
- **Deciders:** Ali (owner); the architect (Claude)
- **Supersedes / superseded by:** none. Applies [ADR 0073](0073-hosting-design-calls-from-the-i1-lane.md) (two-phase, migrate-first) and [0042](0042-postgres-tls-must-be-verified-in-prod.md).
- **Evidence:** `.github/workflows/{ci,deploy}.yml`; `55e6db9` and PR #2 (`db8b452`), both on `origin/main`; GitHub: default branch `main`, environment `demo` allows branch `main` only, and `main` is **not protected**; run 44158818424, attempt 1: `build-api` and `build-web` failed at "Azure login" (AADSTS700213), attempt 2: logged in and built, failed only at smoke check S6, which defaulted to the region `uaenorth` while the demo runs in `francecentral` (every functional check H1 to H7 passed; fixed in PR #2 so S6 defaults to the resource group's own region); run 44179214215 (head `1a4ad73`, PR #3): all three jobs succeeded, including the smoke test.

## Decision
1. **A push to `main` runs `ci`; after it succeeds, `deploy.yml` runs** (`workflow_run`, with an `event == 'push'` guard so a fork's pull request cannot trigger it; by hand with `workflow_dispatch`). Job environment `demo`, OIDC login (no stored Azure secret), what-if then deploy of two Bicep phases with the migration between, the TLS check on what was deployed, a gate per app, restart, a cold-start wait, a demo reset, the smoke test (S1 to S9 in `smoke.sh`, H1 to H7 in `smoke-http.sh`), a final reset. Nothing rolls back; single-revision mode keeps the old revision serving while a new one is not ready.
2. **The OIDC subject is immutable for repositories created after 15 July 2026:** `repo:OWNER@OWNERID/REPO@REPOID:environment:demo`. `bootstrap-rg.bicep` therefore takes optional `githubOwnerId` and `githubRepoId`: both give the immutable form; none or one gives the classic name-only subject, never a half-formed one. The immutable form is also safer: a deleted and re-created repository cannot inherit the credential.
3. **`main` is the default branch and the only deploy branch.**
4. **Post-submission rule:** after 2026-11-20 22:59 Karachi (23:29 IST, the deadline in the submission plan), only small cosmetic changes; all major work is done before the submission (owner decision, 2026-11-17: the public link is what is submitted, and development may continue after the deadline on that footing). The controller's addition, not yet confirmed by the owner: each such change goes through a pull request with green CI and a green smoke test, because it changes what the judges see.

## Consequences
- **Cost of being wrong:** every push to `main` is a deploy to the live demo. Browser regressions are not caught before it ([ADR 0084](0084-full-browser-e2e-leaves-the-per-push-ci.md)). "Through a pull request" is a convention: branch protection is off.
- The redesign branch failed `bundle:check` on `/hse` after its slices were merged, which would have turned `ci` red and blocked the deploy; [ADR 0088](0088-settings-sheet-body-loads-on-first-open.md) records the fixes (`/hse` 172,472 B of 174,080 B) and `bundle:check` passes for every route on the branch.
- The first deploy needs `-GitHubOwnerId` and `-GitHubRepoId` at bootstrap; the AADSTS700213 row of the runbook explains it.

## Revisit trigger
GITEX teardown (11 Dec); branch protection becomes available; a second contributor; a deploy that cannot be rolled forward.

## Links
[ADR 0073](0073-hosting-design-calls-from-the-i1-lane.md) · [0086](0086-france-central-demo-hosting.md) · [0084](0084-full-browser-e2e-leaves-the-per-push-ci.md) · [0088](0088-settings-sheet-body-loads-on-first-open.md)
