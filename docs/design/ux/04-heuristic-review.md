# 04. Heuristic review and cognitive walkthrough (self-reviewed)

**Label:** expert self-review by the design lead and one independent reviewer agent (impeccable Assessment A,
`critique/README.md`). **This is not usability testing.** No worker, supervisor, HSE officer or judge used the
prototype. The human-run methods still owed are listed in `01-users-and-jobs.md`.

## Nielsen's 10 (independent reviewer, before fixes): 27/40 "Acceptable to Good"

| # | Heuristic | Score | Main finding | Status after the fix batch |
|---|---|---|---|---|
| 1 | Visibility of system status | 3 | Scrubber opens at "final" with no cue that it moves | Kept: Play button + "final" label; the cue is the button |
| 2 | Match with the real world | 3 | POD/FAR/CSI unexplained; inverted TWL axis on the day chart | POD/FAR/CSI defined inline; axis caption kept (TWL is inverse by definition: lower = hotter) |
| 3 | User control and freedom | 3 | No re-open after sign-off | Open, F2 to add "Withdraw sign-off" with reason (audit row) |
| 4 | Consistency | 2 | Today action list differed from Alert/Relay; validator count wrong | Fixed: `actions-list` pattern; "N violations across M rules" |
| 5 | Error prevention | 3 | Free-text hh:mm in the validator | Kept on purpose: `type=time` shows AM/PM in English locales and contradicts the 24-hour copy |
| 6 | Recognition over recall | 3 | 5-swatch plan legend | Kept; each segment also carries its word label at ≥ 48rem |
| 7 | Flexibility | 2 | Long supervisor plan page, no jump links | Open: F2 adds an in-page index (Level, Plan, Why, Pay, Sign-off) |
| 8 | Aesthetic and minimalist | 2 | Plans card grid broke at 1440 (P0); four equal red tiles | Fixed: container-query key/value pairs; ink counters + verdict block |
| 9 | Error recovery | 4 | Worker error keeps the unwell path alive | Kept |
| 10 | Help | 3 | No glossary for judges | Partly: inline definitions on the scoreboard; glossary parked |

## Laws of UX applied as decisions

- **Fitts:** worker targets ≥ 44 px; "I feel unwell" and Stop work in the thumb zone; full-width primary on phones.
- **Hick:** worker bottom bar has 3 items; the alert card has 1 primary action (Listen) and Done.
- **Von Restorff:** the only saturated colours are level fills; the "ours" column is the only teal-tinted card.
- **Peak-end:** the replay ends on "What's next" with honest status stamps; the scoreboard opens on the verdict
  sentence, the same size whether we won or lost.
- **Doherty (< 400 ms):** worker Today renders from the service-worker cache before the network answers.
- **Jakob:** bottom tab bar, native `<dialog>`, native radios and selects, browser back.

## Cognitive walkthrough (Wharton et al., 4 questions), worker "act on a Red alert", Rafiq persona

| Step | Will he try to do the right thing? | Will he notice the control? | Will he link it to the goal? | Will he see progress? |
|---|---|---|---|---|
| Tap the notification | Yes (phone buzzes, level numeral 4 in the title) | Yes | Yes | Card opens on the red sign |
| Read what to do | Partly: text is a second language | Pictograms on plates, Listen button | Yes if audio plays | Audio playing state |
| Rest in shade | Yes | n/a | n/a | n/a |
| Feel unwell | Yes | Fixed button on every screen | Yes (phone-with-cross pictogram, untested) | Steps appear at once, call works offline |

**Weakest link:** comprehension of untranslated action text in Urdu (the F1 catalogue holds "wording awaits
review" for all three lines). Pictograms carry the meaning until native-reviewed strings exist; this must be closed
before any pilot (native-speaker review + comprehension test).

## Heuristic severity 3-4 items fixed before handoff

1. Plans grid collapse at 1440 (P0) → container query.
2. Red-filled counters with no focal point → ink counters, danger marker, verdict block.
3. Worker action pictograms orphaned at 390 → `actions-list` grid with plates.
4. Validator header count mismatch → counts violations and distinct rule ids.
5. Prototype and breadcrumb links under 24 px; season ribbon `role="img"` without a name → fixed (gate).
