# ADR 0084: Full browser e2e leaves the per-push CI; it runs by hand before a large merge

- **Status:** Accepted by the architect (owner informed in the controller's report of 2026-11-18; the owner can overrule). The split was made by the CI work in `551ecc2`, which asked for this ADR.
- **Date:** 2026-11-18
- **Deciders:** the architect (Claude)
- **Supersedes / superseded by:** none. Defers a gate and deletes nothing.
- **Evidence:** `551ecc2` and its message; `.github/workflows/ci.yml` (`frontend` job); `.github/workflows/frontend-e2e.yml`; `frontend/tests/e2e/registered-tests.json` (1,196 titles at `656d663`, 1,164 before the redesign); `gh run list --workflow frontend-e2e.yml` returns no runs.

## Context
`ci.yml` runs on every pull request and on a push to `main`. On a runner, the frontend job passed lint, types, catalogues, the API schema, the unit tests, the build and the bundle budget, then ran `pnpm e2e` (1,164 tests, two projects, one worker by design for the service-worker push tests) for 16 minutes, got through 118 tests at about 8 s each, 14 of them failing, and was cancelled by the job limit. The suite had never run on Linux. The repository is private on the free plan, with a monthly allowance of runner minutes.

## Decision
1. **The `frontend` job in `ci.yml` runs:** lint, typecheck, `i18n:check` with `SB_REQUIRE_TRANSLATED=1`, `api:check`, the unit suite, the build with `SB_REQUIRE_SCORED=1`, `bundle:check`, and `e2e:registered` (lists every Playwright test title and compares it with the manifest; no browser, no server).
2. **The browser e2e, the design lint and Lighthouse move to `frontend-e2e.yml`**, started by hand (`gh workflow run frontend-e2e.yml --ref <branch>`): the e2e in 6 shards in parallel, plus a `quality` job (design lint; Lighthouse over 14 URLs, 3 runs each, against the matrix of [ADR 0069](0069-per-route-budget-exception-for-data-routes.md)). No schedule.
3. **Compensation:** run `frontend-e2e.yml` before every merge of a large branch, starting with the redesign branch. A merge is not done until it is green.

## Options considered
Full suite on every PR (above; rejected: over the limit and the allowance); shards on every PR (rejected: runner minutes on every push); a scheduled run (rejected until the cost is known); a small smoke subset on PRs (not tried; the right next step if regressions reach `main`).

## Consequences
- **Cost:** a browser, accessibility, right-to-left or design regression can reach `main`; only the deploy smoke test (S1 to S9, H1 to H7, [ADR 0087](0087-continuous-deployment-from-main.md)) stands between a push and the live demo.
- **Cost in minutes:** the commit estimates a full run on the order of 150 runner-minutes (1,164 tests at about 8 s on one aborted run); the workflow header says "several hundred". It has not been measured end to end.
- **Risk:** the first run on GitHub may show Linux-only failures nobody has seen.

## Revisit trigger
A regression reaches `main`; the first real run gives a measured cost; a second contributor; a free-minutes change.

## Links
[ADR 0069](0069-per-route-budget-exception-for-data-routes.md) · [0087](0087-continuous-deployment-from-main.md) · [0063](0063-lighthouse-ci-no-sandbox-on-ephemeral-runner.md)
