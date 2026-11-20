# ADR 0083: Tier 2 English-only copy for the story, the tour and the proof story; what Tier 1 still guarantees

- **Status:** Accepted (owner decision, 2026-11-17, D2) for the landing story. The proof story and the tour stops follow the same rule, accepted by the architect (owner informed in the controller's report of 2026-11-18).
- **Date:** 2026-11-18
- **Deciders:** Ali (owner); the architect (Claude)
- **Supersedes / superseded by:** none. Amends the i18n tier rule of F2 Task 22 (`frontend/scripts/i18n-sync.mjs`).
- **Evidence:** `CLAIM_PREFIXES` in `i18n-sync.mjs`: `judge.scoreboard.`, `judge.frontier.`, `judge.proof.`, `judge.day.`, `judge.try.`, `judge.governance.`, `judge.landing.story.`, `judge.tour.steps.`, `states.proof.`. `states.proof.` dates from `a00afb4`; `judge.landing.story.` from `39496c1`; `judge.tour.steps.` from `8ecf697`. `messages/review-manifest.json`.

## Context
The story, tour and proof copy carries verdicts and numbers. A machine translation of a verdict is an unverified claim. About 33 more machine translations and a day of right-to-left tuning were not worth it for text a reviewer reads once (05, D2).

## Decision
1. **Tier 2 is English in all six catalogues, by design:** the landing's five chapters, the tour's five stop sentences, and the proof story with the sheet and drawer words, including the chip's own label (`states.proof.chip`, so ar and ur show "Where from"). A test fails when a Tier 2 key differs from `en`.
2. **Tier 1 is still translated into ar, ur, hi, bn and ne** and gated: the hero (title, lede, kicker), the role door (titles, one-line promises, the demo note), the phone sign, buttons, the role entries and badge, the safety view, the settings sheet and the worker screens. `SB_REQUIRE_TRANSLATED=1 pnpm i18n:check` runs in the frontend CI job and fails on any Tier 1 key still in English.
3. **Disclosure.** The ar, ur, hi, bn and ne text is a machine draft, not reviewed by a native speaker. It is listed in `messages/review-manifest.json` and the notice "Machine translation, not yet reviewed by a native speaker" (a safety key) shows on the landing, tour, role entries and safety view. A native reviewer is still needed.
4. English blocks inside a translated page carry `lang="en"` and `dir`, so a screen reader pronounces them correctly.

## Consequences
- **Cost of being wrong:** a reader of Urdu or Arabic meets English paragraphs on the landing story, the tour and the proof drawer, while the hero and the worker screens are in their language. Judges are likely English readers; workers see Tier 1 only.
- The disclosure must stay wherever machine text shows. The 2026-11-14 limitation (no native review) is unchanged.

## Revisit trigger
A native reviewer is found (move keys to `reviewed`); a worker-facing screen needs a story sentence; a judge reports the English blocks as a defect.

## Links
[ADR 0075](0075-three-layer-information-model-and-where-from-chip.md) · [0076](0076-story-order-and-plain-landing-and-verdicts.md) · [0081](0081-un-defer-safety-view-tour-start-and-worker-join.md)
- **2026-11-20 (the rule applied to the real-earth landing; decision text unchanged; the clause below was missing, the rule itself was already written in decisions 1 to 4).** [ADR 0090](0090-landing-is-seven-whole-screen-slides-over-real-imagery-and-terrain.md) replaced the landing, and three statements above no longer match it. (a) The landing has **seven chapters**, not five; Tier 2 is still the chapters' own words (`judge.landing.story.*`, English in all six catalogues, `lang="en" dir="ltr"` on those slides); the words that are the app's own inside them (the level names and what the sign says, the Demo tag, the role door, the video) are Tier 1 and restore the page's language on their own block, and "Ways in" is Tier 1 throughout. (b) The **phone sign no longer exists** on the landing; Tier 1 on the landing is now the chapter rail, the forecast scene's captions and legend words (ICU message templates with locale-neutral digits), the hero title, lede and its two links, the role door, the video strings and the map caption. 28 such strings were added or changed in S10 (`e0f7c13`, `5b696d9`) and the ones with words in them are machine-translated into ar, ur, hi, bn and ne; the unit "WBGT, °C" and the "{hour} / {date}" format are the same in every language (`INVARIANT_KEYS`: `judge.landing.scene.measure`, `judge.landing.scene.eyebrow`). (c) **The disclosure line of decision 3 now sits in the chapter rail**, under the language picker, not at the foot of the page (`MachineTranslationNotice` in `LandingView.tsx`); it is the same component as elsewhere and renders in the page's language and direction. The rule is unchanged: Tier 2 claim text stays English in every language, and a native reviewer is still needed. **State described:** `main` at `b72a81a`.
