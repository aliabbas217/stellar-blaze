# ADR 0068: Defer the day-view worker-card aside (F2 Task 9)

- **Status:** Accepted by the architect (Ali informed 2026-11-15; he can overrule)
- **Date:** 2026-11-15
- **Deciders:** the architect (Claude), on the F2 controller's announced cut
- **Supersedes / superseded by:** applies item 6 of the cut order in `docs/superpowers/plans/2026-11-14-f2-core-demo-screens.md` ("Task 9 worker-card aside"); narrows [ADR 0045](0045-f2-scope-core-demo-path.md) (day zoom stays, the aside does not)
- **Evidence:** the F2 controller's report of 2026-11-15 (lane A, commit `cec2191`): the contract's `DemoDayHour` carries `truth_zone` and `raw_zone` but no level member; F2 parking-lot row.

## Context
The prototype's day view has an aside showing the card a worker would have seen at a chosen clock hour. A card needs a **level** (Low, Medium, High, Red) for that hour. The exported demo day has only zones. Warning levels come from the warning-level policy (ADR 0046: probability of the High zone against θ, with dwell and edges), so a level is not a pure function of a zone, and any zone-to-level table written for the screen would be new safety wording the evidence does not support.

## Options
1. **Add `level` to `DemoDayHour`** (B3 export change): the 2026 day file is part of the gated run, so changing its schema now touches the pre-registered artefact set days before the run.
2. **A zone-to-level mapping ADR:** wrong meaning (see above).
3. **Defer the aside (chosen).**

## Decision
The aside is not built. The day zoom keeps the truth versus raw zones, the policies' warned hours and the proof chips. The F2 parking-lot row indexes this ADR.

## Consequences
- **Cost of being wrong:** the day zoom shows no "what the worker would have seen" card, which is a smaller demonstration of the worker story; the worker Today and alert screens still show real levels from the live API.
- No safety wording was invented.

## Revisit trigger
A later export that carries a computed level per hour (additive), or time after the submission.

## Links
[ADR 0045](0045-f2-scope-core-demo-path.md) · [0046](0046-warning-level-policy.md) · [0034](0034-demo-strategy.md)
