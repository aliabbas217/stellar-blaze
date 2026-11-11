# ADR 0027: Skip Storybook for the submission; state coverage via Vitest + Playwright per-state snapshots

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. A recorded exception to `frontend-discipline` rule 12 (component stories)
- **Evidence:** `docs/superpowers/plans/2026-11-11-f1-frontend-foundation.md` "Parked" table (Storybook 10.6.7 row); `docs/research/2026-11-11-frontend-platform.md` §7 (storybook 10.6.7, released 2026-11-10); roadmap "Decisions recorded 2026-11-11" ("Storybook skipped (Playwright per-state snapshots)")

## Context
The frontend standard asks for component stories. In a nine-day solo window, Storybook adds a second build pipeline and its own config. The F1 plan already gets four-state coverage per screen from Vitest component tests and Playwright visual snapshots per state, and axe runs on every page.

## Options considered
| Option | Verdict |
|---|---|
| Storybook 10.6.7 with stories for every component | Rejected for now: about 0.5 day of setup plus upkeep; duplicates the snapshot coverage |
| Ladle or another lighter story tool | Not evaluated; no time-boxed need |
| Vitest component tests + Playwright per-state snapshots, axe per page (chosen) | Accepted |

## Decision
No Storybook in `frontend/` for the submission.

## Consequences
- The design gate (F1 Task 14) renders real routes, not stories.
- **Cost of being wrong:** no isolated component catalogue for a reviewer or a second developer; a visual regression in a component used on an untested route can slip. Low inside nine days.

## Revisit trigger
After 20 Nov, or when a second developer joins.

## Links
[ADR 0003](0003-frontend-single-nextjs-app-pwa.md) · [F1 plan](../superpowers/plans/2026-11-11-f1-frontend-foundation.md)
