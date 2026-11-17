# ADR 0030: Hold oasdiff at v1.35.0; defer newer versions to the post-submission dependency sweep

- **Status:** Accepted (inherits 0009, accepted 2026-11-11) (inherits the status of ADR 0009 §5, where the pin was made; becomes Accepted when Ali accepts 0009)
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Records ADR 0009 §5's pin choice with a trigger, which 0009's own revisit trigger does not cover
- **Evidence:** ADR 0009 §5 (v1.35.0 of 2026-10-28 vs v1.37.0 of 2026-11-08; "in the spirit of F1's `minimumReleaseAge`"); `docs/parking-lot.md` row "oasdiff bump beyond v1.35.0"

## Context
CI uses oasdiff to fail breaking changes to `backend/openapi/v1.json` after the 14 Nov freeze. On 11 Nov, v1.36.0 and v1.37.0 were under 7 days old. OpenAPI 3.1 support has been GA since v1.15.0, so v1.35.0 has every feature we use.

## Options considered
| Option | Verdict |
|---|---|
| Latest (v1.37.0) | Rejected: under the 7-day release-age rule the frontend already applies |
| v1.35.0, checksum-verified from the release tarball (chosen) | Accepted |

## Decision
Pin v1.35.0 until after 20 Nov.

## Consequences
- **Cost of being wrong:** a bug fixed in v1.36/1.37 could give a false positive or miss a breaking change in CI. If oasdiff misreports FastAPI's `anyOf`-null fields, record the case (0009 trigger) and bump early.

## Revisit trigger
After 20 Nov, with the next dependency sweep; or oasdiff v1.35.0 misreports a known change in our spec.

## Links
[ADR 0009 §5](0009-evolvability-configurability.md)

## Amendments
- **2026-11-14 (the gate is on, and a possible blind spot; decision text unchanged).** CI runs `oasdiff breaking ... --fail-on ERR` since B3 Task 0 (commit `20fdfc1`), as ADR 0009 §5 said it would; v1.35.0 stays pinned. The v1 contract froze at `d80b65a` (`backend/openapi/v1.json`: 15 operations and 2 health routes). A point in the B3 controller's summary (the reviewer's), **unverified**: oasdiff may not guard `components.schemas` that no path references. Four such components are the artefacts F2 imports at build time (`PolicyScoreboard`, `PlanScoreboard`, `DemoDay`, `ThetaDecision`), so their additive-only rule holds by convention, not by CI. This is the "oasdiff misses a known change" revisit trigger in waiting; no miss has been observed. A scratch check settles it (remove a required field from one of them in a copy of the spec and run oasdiff v1.35.0 against the original); it has not been run. SHAs are commits on branch `feat/b3-warnings-planner` (worktree `D:\dev\stellar-blaze-b3`), not merged; a squash merge changes them, so the paths named are the lasting evidence. The B3 controller's ledger (`progress.md`, `b3-summary.md`) sits under `.superpowers/sdd/2026-11-14-b3-warnings-planner-governance-api/` in that worktree and is deleted after the merge.
