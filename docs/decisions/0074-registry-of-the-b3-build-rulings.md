# ADR 0074: Registry of the B3 build rulings (R-A to R-AU and U-1 to U-10)

- **Status:** Accepted by the architect (Ali informed 2026-11-16)
- **Date:** 2026-11-16
- **Deciders:** the architect (Claude); the rulings were made by the B3 controller (Claude, Sonnet) and the architect during the B3 build, 2026-11-12 to 2026-11-16
- **Supersedes / superseded by:** none. Completes the record that ADR 0011, 0034, 0042, 0054, 0058, 0066, 0067 and 0072 started: those carry the rulings that changed an ADR; this ADR indexes the rest
- **Evidence:** `docs/research/2026-11-16-b3-rulings-digest.md` (41 rows: id, the ruling, the cost if wrong, the commit or file that carries it, whether a user or judge can see it), copied from the B3 controller's digest; the B3 ledger (`progress.md`) and `b3-summary.md` in the B3 worktree's git-ignored SDD folder; the commits named in each row on branch `feat/b3-warnings-planner`

## Context
The B3 build produced about 50 rulings on plan conflicts, edge cases and process. Ali's rule is that decisions get recorded and nothing is lost. Most rulings are implementation choices with small costs; none is a cut (every cut has its own ADR). They lived only in a git-ignored ledger that is deleted after the merge.

## Decision
1. **The rulings in the digest are accepted as built**, with the corrections listed at the end of the digest file: R-C is superseded by the architect's R-C2 (the lookahead window cap of ADR 0011 section 2 is built); R-G is withdrawn by R-I; R-AH is the revised ruling; costs marked "(derived)" are plausible, not measured.
2. **The 17 user-visible rulings** (a user or a judge can see the behaviour) are the ones to read first: R-AU (the epoch-anchored replay clock), U-1 (what a Stop covers, the 10 s undo window, `effective_stops`), U-2 (the seed pins the released model and theta 0.30; `mode`), R-AH (a source outage degrades to the protective all-High day), R-W (a forecast gap shows as High), R-V (wind floor at calm hours), R-X (people rules are declared restrictions, not work violations), R-Z and U-3 (422 `shift-not-legal` against 500), U-4 (suppressed crews show no headcount), U-5 (sign-off needs a DB-activated config), R-J (three-valued sign-off state), R-Q (Stop has its own rate bucket), R-C (the window cap, as reversed), R-N (the per-tick protective TWL), R-B (the `rule_corrected` plan is unclamped), U-6 (the scoreboard shapes).
3. **Where a ruling conflicts with a user-facing claim,** the claim follows the ruling. In particular: the plan declares restrictions and does not enforce them per member (ADR 0011 amendment, R-X); a stop is never throttled by other calls (R-Q); the replay "now" starts at the first deploy and needs a reset (R-AU).

## Consequences
- **Cost of being wrong:** a "(derived)" cost may understate a real cost; the digest's `Built` column names the code to check. A later reader should treat the code and tests as the authority and the digest as the index.
- No code change.

## Revisit trigger
A rule in the digest fails in a pilot; the B3 code is refactored; after the submission, the ledger is deleted with the worktree and this ADR and the digest file are the lasting record.

## Links
[ADR 0011](0011-heat-aware-planner.md) · [0034](0034-demo-strategy.md) · [0058](0058-alert-events-push-contract-and-stale-forecast-fallback.md) · [0066](0066-demo-reset-is-a-new-epoch-audit-stays-append-only.md) · [0067](0067-push-endpoint-host-allow-list.md) · [0072](0072-cheap-by-default-demo-hosting.md)
