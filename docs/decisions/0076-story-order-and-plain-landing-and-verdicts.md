# ADR 0076: Story order (problem, product, evidence, day, boundary); a landing of ledger numbers only; plain verdicts that never claim to beat the regulator's zones

- **Status:** Accepted (owner decision, 2026-11-17): the redesign direction, and D10 (the reordered video script).
- **Date:** 2026-11-18
- **Deciders:** Ali (owner); the architect (Claude)
- **Supersedes / superseded by:** supersedes [ADR 0064](0064-f2-demo-copy-and-data-rulings.md) §5 (the stepper "problem, scoreboard, day, proof, product"). Nothing else in 0064 changes.
- **Evidence:** `02-narrative.md`, `01b-content-audit.md` §3; slice S2 `39496c1`, `d7da7f4`, `da9770b`, `674384a` (merge `8d0d989`); slice S3 `00dcfc4`, `1122079` (merge `a7dd6f3`); `frontend/src/components/shell/story-steps.ts`; ledger keys `warn.l1.P2.missed_danger_hours` 80.5, `warn.l1.P2.false_alarm_hours` 74.5, `warn.l1.P3_protect.missed_danger_hours` 45.5, `warn.l1.P3_protect.false_alarm_hours` 183.5.

## Context
The old story opened with a statistic and a scoreboard and showed the product last. A person met numbers before a reason to care.

## Decision
1. **Order:** problem, product, evidence, day, boundary (`STORY_STEPS`). There is no Proof step: the proof sheet is reached from any number's "Where from" chip ([ADR 0075](0075-three-layer-information-model-and-where-from-chip.md)). The product step is an app screen: Back and Next pass over it, so a reader is never sent to a page with no way on.
2. **Landing:** the hero is "Plan tomorrow's heat tonight.", a lede, the role door (four equal tiles in a fixed order: worker, crew, safety, reviewing) and a phone sign built from the app's own components with fixed demo props and labelled **Demo**. The 3D field stays beside the phone with a caption. Chapters follow: a morning on site, tonight's plan, the boundary, last summer replayed, what this does not show yet.
3. **Only ledger numbers.** The four bars are read from the scored Warnings file by the existing loaders; no number is typed. The unledgered season counts of the old chapter 1 (listed in `da9770b` and in 05 D9) are off the page.
4. **Plain verdicts.** `features/judge/verdict-plain.ts` composes each verdict from the file's structured fields by a fixed template: "met" is the file's own `outcome` flag, every number is read from a field, and a direction word ("fewer", "more", "too small to tell apart") comes from the paired 95% interval. An incomplete record gets one neutral line and no number. `policy-tradeoff.ts` writes the honesty paragraph under the Warnings table. **Nothing says Stellar Blaze beats the regulator's zones**: on the raw forecast the zones raise fewer false alarms (74.5 against 183.5 hours) and miss more danger hours (80.5 against 45.5); H5 is not met. The verbatim sentences stay in the auditor layer.

## Consequences
- **Cost of being wrong:** evidence is the third step, so a judge who stops early sees four bars and a sentence, not the full scoreboard. A wrong template would be worse than the jargon it replaced; the number-equality tests and a second-agent review of each template are the guard.
- Open: the product step still links to `/worker` although `/tour` now exists (`story-steps.ts` header says to flip one href).

## Revisit trigger
A judge test shows the scoreboard is reached too late; the video order changes again; the template for H4 or H5 disagrees with a re-scored file.

## Amendments
- **2026-11-20 (try a plan joins the story; decision 1 amended, the rest unchanged).** A live audit found that the pager and the 3-minute tour walked past the interactive validator: "Next" on the day page went straight to the boundary, so the five-click judge path (replay, evidence, day, try, governance) worked only from the top nav, and on a phone not even there. **Ruling:** the order is problem, product, evidence, day, **try a plan**, boundary (`STORY_STEPS`, six steps, "Step n of 6"); `/replay/try` carries the story footer (Back to the day, Next to the boundary); the tour gains a "Try a plan" stop between the crew lead's screen and the refusal. The product step is still an app step that Back and Next pass over. **Cost of being wrong:** one more step before the boundary, and the validator page grows by the footer (one small client component the day and governance pages already ship). **Revisit trigger:** a judge test shows the story is now too long.

## Links
[ADR 0064](0064-f2-demo-copy-and-data-rulings.md) · [0034](0034-demo-strategy.md) · [0075](0075-three-layer-information-model-and-where-from-chip.md) · [02-narrative](../design/redesign-2026-11-17/02-narrative.md)
