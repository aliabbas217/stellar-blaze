# ADR 0061: Defer the "Listen" audio action; the worker Today primary action is "Turn on warnings"

- **Status:** Accepted by the architect (default; Ali informed 2026-11-14 and can overrule)
- **Date:** 2026-11-14
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Settles F2 plan conflict C8 and decision D3. Narrows the "Listen" primary action of v2 journeys §12 and the prototype `BUILD-BRIEF.md`; does not touch ADR 0038 (still Proposed) or ADR 0004.
- **Evidence:** F2 plan conflict C8, Task 16 (ActionLead, "The one primary action is 'Turn on warnings' while push is off"), Task 17 ("No audio (C8)"), Global Constraints "No voice"; ADR 0038 §2 (no `TextToSpeech` runtime port; alert clips pre-rendered with Azure Neural TTS at build time, class `NonPersonal`), §8 ("Dynamic runtime TTS: Reject (no licence-clean ur/bn voices)"); ADR 0004 Consequences (a notification cannot play a clip; audio plays in-app after a gesture); prototype `worker-today.html` (`<button class="btn signal listen">`); roadmap stretch 8, which "needs the Azure voice check" (F2 plan C8).

## Context
The prototype's worker Today has "Listen" as its one primary action, aimed at workers who read little. No audio asset exists, none is scheduled before the 18 Nov freeze, and the roadmap lists pre-rendered audio as a stretch that first needs an Azure voice check. The F2 plan's rule is that a button that does nothing is a defect.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| A "Listen" button that is present but inert, or labelled "coming soon" | Plan C8: a control that does nothing is a defect; BUILD-BRIEF wants a real primary action | Rejected |
| Read the lines aloud with the browser's speech synthesis | Plan Global Constraints: no speech synthesis in F2; ADR 0038 §8 rejects dynamic TTS (no licence-clean ur/bn voices); the lines are clinical wording that is not yet reviewed | Rejected |
| Defer Listen; Today's one primary action is "Turn on warnings" (to `/worker/alerts`) while push is off, and there is none otherwise (chosen) | Plan Task 16; pictograms and short action lines carry the meaning | Accepted |

## Decision
1. **No Listen button anywhere in F2** (Today, alert, call sheet). Listen stays DESIGNED: wherever the deck or video shows it, it carries the DESIGNED stamp (ADR 0045 decision 5).
2. **Worker Today's primary action** is "Turn on warnings" while push is off; with push on there is no primary action, only the dock and the "Why?" proof chip.
3. **When audio returns** it is pre-rendered Azure Neural TTS clips of fixed, approved action lines (class `NonPersonal`, ADR 0038 §1 and §4), produced per language and reviewed by a native speaker before use. Audio of clinical wording is subject to the same clinical review as the text (ADR 0035; `docs/clinical/review-pack.md`).

## Consequences
- The low-literacy leg of the design (audio) is absent from the judged build; the text, pictogram and level-scale legs remain. The claim "voice output" is not made.
- **Cost of being wrong:** low for judging (ADR 0038 Context rates live voice as table stakes with distinctiveness 0; the wow is the scoreboard, ADR 0034). Higher for a pilot with non-reading workers, where audio is the access route.
- Task 16's `test_primary_action_is_turn_on_warnings_when_push_off` guards the decision.

## Revisit trigger
Pre-rendered Azure TTS clips for the level action lines exist (the Azure voice check passed) **and** a native speaker has reviewed each language's text and audio. Or a pilot shows workers cannot use the text and pictograms.

## Links
[ADR 0004](0004-tiered-alert-delivery.md) · [0035](0035-clinical-review-labelling.md) · [0038](0038-agentic-workflows-and-voice.md) · [0045](0045-f2-scope-core-demo-path.md) · [F2 plan](../superpowers/plans/2026-11-14-f2-core-demo-screens.md) Tasks 16, 17
