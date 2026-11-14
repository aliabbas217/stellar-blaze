# ADR 0044: Defer the comparison of tunable defaults and ranges in the prod pin check to B3, with a hard gate before `ae-heat-2026.1`

- **Status:** Accepted-by-controller (B1 ruling, awaiting Ali's review); **needs Ali's attention**: it records a guarantee of ADR 0010 §4.3 that holds for floors only
- **Date:** 2026-11-12
- **Deciders:** the B1 controller (Claude); recorded for the architect (Claude); Ali's review pending
- **Supersedes / superseded by:** none. Qualifies [ADR 0010](0010-runtime-tunable-configuration.md) §4.3 (0010 carries a dated amendment pointing here). Parking-lot row: "Tunable defaults and ranges are not compared by the prod pin check"
- **Evidence:** B1 controller rulings 22 and 23 (`b1-summary.md`, deleted after merge; the paths below last); `backend/src/stellar_blaze/domain/config/runtime.py` (`_check_pin`, `validate_runtime_config`, `resolve_effective`); `backend/src/stellar_blaze/domain/rules/floors.py` (`floor_violations`); `backend/rulesets/ae-heat-0.1.toml`; Task 7A review, commits `c44bfe9` and `7702720` on `feat/b1-backend-foundation`

## Context
ADR 0010 §4.3: "In prod, a pin is accepted only if it is released, covers today, and every floor is at least as protective as the floor in today's date-resolved ruleset. This gives instant rollback to a previous ruleset when the floors did not change, and refuses it when the law tightened." §4.2 separately says tunables are not floors: each ruleset declares a `[tunables.<name>]` table with `default`, `min`, `max` and `safer`, and a runtime value must fall inside the range of the ruleset it resolves against.

The Task 7A review found the seam between the two. `floor_violations` walks `Floor` fields only, and a tunable resolves against the **pinned** ruleset's own range. If a later ruleset raises `twl_margin_w_m2`'s `min` or `default` (more protective), a prod pin to the older ruleset is accepted and permits the lower value. The §4.3 sentence therefore holds for floors and not for the one tunable that is safety-relevant, the TWL margin (ADR 0006: a higher TWL reads less protective by about 6.2 W/m², and zone edges are 25 W/m² apart).

It is **latent**: `ae-heat-0.1` is the only ruleset, its margin default is 0 and its range is 0-20 (`safer = "higher"`), so nothing can be restored to a worse value yet.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| Implement the comparison in B1 | B1 has one ruleset, so there is no case with two differing ranges to derive the semantics from or to test against (engineering rules 8, 9: no change without data to verify it) | Rejected |
| Treat tunable ranges and defaults as floors | They would stop being tunable at runtime; defeats ADR 0010's purpose (the margin must be tunable after the back-test) | Rejected |
| Defer to B3 with a hard gate (chosen) | The gate is concrete and the change is small | Accepted |

## Decision
No B1 code change. **Before B3 changes any tunable default or range (that is, before `ae-heat-2026.1` is merged), `_check_pin` must be extended** and tested with two rulesets that differ:
1. For each tunable, compare the pinned ruleset's less-protective range end with the one in force today, per `safer`: `higher` means the pin's `min` must be at least the in-force `min`; `lower` means the pin's `max` must be at most the in-force `max`; `none` is not compared.
2. Compare the effective default the pin would give (the value `resolve_effective` returns for a config that sets nothing) with the in-force ruleset's, per `safer`.
3. A failure is a `floor-violation`-class violation naming the tunable, and the ADR 0010 §4.3 text is amended again when the check lands.

Closed in B1 (ruling 23, test-only, `7702720`): the structural guard that every `Floor` field has a comparator no longer skips `time`/`timedelta` fields, plain-model sections or nested models.

## Consequences
- **Cost of being wrong:** B3 must land the check before `ae-heat-2026.1`. If it did not, a prod pin (the instant-rollback path of the I1 drill) could silently restore a smaller TWL margin.
- Related items parked in `docs/parking-lot.md` under the same ADR 0010 sections, each fail-safe or latent: `floor_violations` compares a threshold even when the reference's `enabled` switch is off (a candidate is refused, never wrongly accepted); the served config is validated on the load date and not again when a ruleset's `effective_to` passes (B3 adds a second ruleset: re-validate on the Asia/Dubai date change).
- Until the check exists, an admin who pins an older ruleset in prod relies on the floors check alone. The I1 rollback drill pins only `ae-heat-0.1`, which is the only ruleset, so it is unaffected.

## Revisit trigger
B3 opens `ae-heat-2026.1` or any change to a `[tunables]` default or range (the gate fires); a second released ruleset exists in `backend/rulesets/`.

## Links
[ADR 0010](0010-runtime-tunable-configuration.md) §4.2-4.3 · [ADR 0009](0009-evolvability-configurability.md) · [ADR 0006](0006-physics-wbgt-phs-niosh-twl.md) · [parking lot](../parking-lot.md)

## Amendments
- **2026-11-14 (gate met; two sentences of the text gone stale; decision text unchanged).**
  - **The gate is met.** The comparison this ADR required before `ae-heat-2026.1` landed as B3 Task 1 (commit `20da791`), ordered before Task 2, and was tested with two rulesets that differ, as decision points 1-3 ask (a pin that lacks a tunable is also refused). [ADR 0010](0010-runtime-tunable-configuration.md) carries the matching dated amendment (decision point 3). SHAs are commits on branch `feat/b3-warnings-planner` (worktree `D:\dev\stellar-blaze-b3`), not merged; a squash merge changes them, so the paths named are the lasting evidence. The B3 controller's ledger (`progress.md`, `b3-summary.md`) sits under `.superpowers/sdd/2026-11-14-b3-warnings-planner-governance-api/` in that worktree and is deleted after the merge.
  - **"`ae-heat-0.1` is the only ruleset" is stale.** The Context ("It is **latent**: `ae-heat-0.1` is the only ruleset, its margin default is 0"), the Consequences bullet on the I1 rollback drill ("which is the only ruleset, so it is unaffected") and the same sentence in the parking-lot row describe the state before B3 Task 2, which adds `ae-heat-2026.1` (`supersedes = ["ae-heat-0.1"]`, margin default 7, range 7-20, ADR 0047). As of this note Task 2 is not committed, so the sentence is still true of the B1 and B2 trees and becomes false when B3 merges.
  - **A consequence the text did not foresee.** With `ae-heat-2026.1` in force, a prod pin to `ae-heat-0.1` is refused by design (the margin default would move 7 to 0 and `safer = "higher"`; the B3 plan carries `test_pin_to_0_1_in_prod_is_refused_after_2026_1`). The I1 plan's runtime drill (Step 3b: "the same procedure with `ruleset_pin` pins a ruleset") therefore cannot use `ae-heat-0.1` as its rollback target in prod, and an audit replay against `ae-heat-0.1` needs a dev or test pin (ADR 0010 §4.6). The I1 plan text is not edited here; its drill needs a re-read before Step 3b.
