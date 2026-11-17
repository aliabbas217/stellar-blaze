# 04. Controls, type and the worker screen

Date: 2026-11-17. Prototypes: `prototypes/button-sheet.html` (all tiers and states, both themes), `worker-today.html` (the new Today, sun and night), `landing-hero.html` (type and hierarchy on desktop). Screenshots sit beside each file. The owner approved the palette ("the colors are somewhat ok") and rejected everything else, so section 1 states exactly what stays.

## 1. What stays, what changes (token ledger)

Reference files: `frontend/src/styles/tokens.css` (code), the root `DESIGN.md` (contract). A unit test (`tests/unit/styles/tokens.test.ts`) fails if the two disagree, so every change below is made in both in one commit, followed by `pnpm design:lint` (warnings fail it).

| Group | Decision | Detail |
|---|---|---|
| Colour primitives and semantic colours | KEEP, unchanged | `--ground-deep`, `--ground`, `--panel`, `--raised`, `--slot`, `--hair`, `--edge`, `--ink`, `--ink-2`, `--ink-3`, `--signal`, `--on-signal`, `--focus`, `--scrim`, `--lv-green/amber/orange/red`, `--viz-*`, the sun overrides, the heat ramps. The dark navy base and the heat ramp are the owner-approved palette |
| Colour usage rules | KEEP | Colour is reserved for data (levels, heat). `--signal` is the single UI colour. No level hue in chrome |
| One change of colour usage | CHANGE the role of `--signal` | It becomes the fill of the primary button (the "field button" of DESIGN.md components, already defined: `button-field`), instead of ink. Same token, same value. The desk primary stops being ink for the same reason |
| Spacing scale | KEEP | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96 |
| Targets | KEEP and EXTEND | `--target` 44, `--target-field` 52; ADD `--target-stop` 56 (Stop work, "I feel unwell", language rows) |
| Radius | CHANGE | `--r` 2 px is retired for controls and kept for data marks only (spine cells, the slot, level marks, the scale segments, table rules, stamps). ADD `--r-ctl` 12 px (every control a hand presses), `--r-card` 16 px (panels, sheets, drawers), `--r-pill` 999 px (selection chips and the tab pill). Rationale: "what you read is cut, what you press is rounded". It is a point of view tied to the user (gloved hands), not a generic soft-UI default. The clone-distance gate row "radius has a point of view" is re-written, not dropped |
| Type family | KEEP | Archivo (tabular figures, `wdth` axis for the wordmark), IBM Plex Mono for codes (now auditor layer only), Noto per script. Reason: shipped, preloaded, covers the six scripts' Latin digits |
| Type scale | CHANGE | KEEP 12, 14, 16, 18, 22, 28, 36, 48. ADD 20, 24, 32, 44, 56. RETIRE the 76 px level word on phones (the level word is now 32 px; 76 stays out of the product). Headings move from weight 400 to 600 to 650 (400 display weight read thin on the navy ground). Tracking −0.02 em at 36 px and above in English only (zero in every other script, as DESIGN.md already requires). Body 18 on the worker screen, 20 on the landing, measure capped at 62 ch |
| Control tiers | CHANGE | Four tiers replace "ink slab or hairline box": primary, secondary, quiet, stop (section 2) |
| Chips | CHANGE | Pills with a filled selected state, a check mark and a heavier weight. No more hairline rectangles |
| Depth | KEEP | Flat: tonal steps, no shadows. Panels are `--panel` fills with no border; the 1.5 px `--hair` rule separates rows. (One ring exists: the 1.5 px `--edge` ring of secondary buttons, which is a boundary, not decoration) |
| Motion | KEEP and ADD | 150 to 240 ms opacity stays. ADD 120 ms press (translate 1 px, scale 0.985). Zero under reduced motion |
| Iconography | CHANGE the rules, keep the set | ISO 7010 grammar, solid silhouettes on a 24 grid, no faces, no emoji. One glyph, one meaning (section 4). New glyphs (stop octagon, check, chevron, checklist, lens) are labelled untested in DESIGN.md until a comprehension test exists, as the file already requires for custom glyphs |
| Level display | KEEP the rule, CHANGE the scale | Word plus position on the four-step scale plus a 14 px mark (was 10 px). The scale segments are 6 px tall, the active one 12 px |
| Landing: page order, copy, density | CHANGE | See 02 and the landing prototype |

## 2. The control system

| Tier | Use | Shape and size | Look (night, sun) | States |
|---|---|---|---|---|
| Primary | The one next step on a screen: "Yes, this is my crew", "Turn on warnings", "See the scoreboard" | 52 px tall on phones and landing, 44 px in dense desk views; radius 12; padding 20 px; 18 px text weight 600 | `--signal` fill, `--on-signal` text: pale cyan with dark text at night, deep teal with white text in sun | Hover: mix 12 percent ink. Pressed: mix 22 percent ink, translate 1 px, scale 0.985, 120 ms. Focus: 3 px `--focus` ring, 2 px offset, on every control. Busy: label kept, a 1 em ring spinner after it, 85 percent opacity, not disabled (a disabled control on a first-run screen is a dead end). Disabled: 50 percent, `not-allowed` |
| Secondary | A real alternative: "Take the 3-minute tour", "Turn on" | Same size and radius | `--raised` fill, `--ink` text, a 1.5 px `--edge` ring (3.3 to 3.5:1 against the ground per DESIGN.md section 3) | Hover 8 percent, pressed 16 percent |
| Quiet | A text action: "Skip", "For auditors", "Wrong crew? Pick another" | 44 px hit area, no fill | `--ink-2` text, `--ink` and a 7 percent wash on hover | Same focus ring |
| Stop | The emergency action only: "Stop work, Crew A", "I feel unwell" | 56 px tall, full width, radius 12, 20 px text weight 600, always with a glyph (octagon for Stop work, the plain cross for unwell) | `--ink` fill with `--ground` text: near-white slab at night, near-black in sun. The only solid ink slab on any screen | Fixed at the bottom, never moves, never disabled, never behind a dialog (unchanged from ADR 0045 and 0065) |

Rules: one primary per screen; the stop bar is never counted as the primary; a screen never has two stop bars (Today has "I feel unwell"; the crew screen has "Stop work"); adjacent targets are at least 8 px apart; every control has a text label (a glyph never stands alone except the sun toggle's replacement, which is hidden in settings).

Selection controls: chips (language, crew, filters) are 44 px pills; the selected pill is filled `--ink` with `--ground` text, a check mark and weight 600, so selection never relies on colour. The tab bar is a segmented pill: the selected tab has a `--raised` fill and the 1.5 px `--edge` ring. Language rows in the join flow are 56 px.

Decision for the owner (D3 in 05): should Stop work be safety red instead of ink? Recommendation: no. ISO 3864 uses red for stop and prohibition, so red is defensible, but this product's `--lv-red` already means "Red level", so a red Stop bar on an Orange screen reads as an escalation of the level, and the owner's rule is colour only on data. The ink slab is differentiated by being the only solid slab, by its glyph, and by its fixed position.

Contrast: the primary's pair (on-signal on signal) is the same pair as signal on ground that DESIGN.md measures at 12.05:1 (night) and 6.78:1 (sun); the secondary ring is 3.34 and 3.48:1. I did not compute the mixed hover and pressed colors; `scripts/contrast.mjs` must be extended to cover them before merge, and axe must run in both themes.

## 3. The worker screen: a 3-second read

### 3.1 Reading order (the question, then the answer)

| Seconds | The worker asks | The screen answers | Element |
|---|---|---|---|
| 0 to 1 | "What do I do?" | "Work 20 min, rest 40 min in shade" with the shade glyph, 28 px weight 600, top of the hero card | Action sentence |
| 1 to 2 | "How serious, until when?" | The level word (32 px), a 14 px mark, the four-step scale with the active step taller, and "until 17:00" at the card's top right | Level row |
| 2 to 3 | "What about the rest of my day?" | One horizontal strip across the full width: 12 hourly cells in the heat ramp, a line and label at now, labels at 06, 09, 12, 15, 18 | Shift strip |
| After | "Anything else?" | At most two or three "Also now" rows, a one-line clinical note with "Why Orange?", a one-line "Warnings are off" row | Secondary content |
| Always | "I am sick" | The stop bar, then the tabs | Dock |

In the prototype the action sentence starts about 292 px from the top of the phone (it is at about 345 px in the current screen), and the whole shift is visible in the first 844 px fold above the dock.

### 3.2 Specific fixes

| Complaint | Fix | Measured or reasoned |
|---|---|---|
| Giant "Orange" | Level word 32 px inside a card; the action sentence is the largest text | The action line is now 28 px against 22 px before |
| Tall narrow chart | Replace the vertical spine with a horizontal strip at full width (358 px of a 390 px phone): cells about 28 px wide, 44 px tall, plus labels. In right-to-left locales the strip mirrors (time flows in the reading direction, as the spine already does). The recessed midday slot is drawn only where the break is in force, as the identity requires | Was about 65 px wide and about 330 px tall; becomes 358 by about 80 px |
| Same pictogram for different rules | One glyph, one meaning. Keep: shade (the lead), water (drink water), buddy (never work alone), clock (only if the self-paced line is kept). The other three lines carry no glyph. Never reuse buddy | `alsoPictogram()` maps three rules to buddy today |
| Employer duties shown to the worker | Show the worker only what the worker does: water, never alone, self-paced work. Move "No unacclimatised person to work", "High Risk induction required ...", "Provide personal water bottle ..." to the crew lead's plan page under "Site duties today", keeping the ADOSH wording verbatim | The text is addressed to duty holders (ADOSH Technical Guideline); a worker cannot act on it |
| "Draft wording" twice | Once per screen: one line "Not yet checked by a clinician." beside "Why Orange?", covering the lead and the list. Needs the ADR 0035 owner's agreement because the label is a clinical-honesty control | `ActionLead.tsx` and the also-list both print it today |
| "Sun mode: on" | Colours switch automatically by sun position (unchanged). The toggle leaves the header; it becomes a three-way row in the settings sheet: "Screen colors: Automatic, Bright, Night" | The word "Sun mode" explained nothing |
| Six scripts in the header | The language is chosen at join (step 2) and kept. The header shows one pill with the current language's own name and a chevron; it opens the settings sheet (six 56 px rows, Change crew, Screen colors, Remove my data). The six chips stay on the first-run and join screens | This trades one extra tap for a language change against 44 px on every screen, because the join flow makes a wrong language unlikely. Recommendation, not proven; D4 in 05 |
| Header crowding | Site name (18 px, wraps, never cut) with a "Demo" tag in place of "(synthetic)" in the name, crew name below, clock at the right (22 px), language pill | Two lines instead of three |
| Black slabs | Only the unwell bar is solid; "Turn on warnings" becomes a quiet secondary row ("Warnings are off on this phone [Turn on]") because it is a one-time setup done at join | See section 2 |
| "Replay" stamp | Moves to a single demo ribbon; a worker never sees it in a real deployment | Demo scaffolding, not product |

### 3.3 States that must survive the redesign

Loading skeleton at final heights (CLS), no site (the join flow now), error with request id and retry, stale ("Last known level"), offline (age label, clock glyph), fallback ("No fresh forecast: protective plan"), out of season (no slot, one line), no shift today (an empty state with the next shift time), personal level (inert today, not designed here), partial. The existing `describe.ts` model is unchanged; only the layout and class lists change.

## 4. Supervisor, landing and desk surfaces

Supervisor crews: the demo controls leave the working screen; the site banner becomes one 32 px ribbon ("Demo day, 14 June 2026. The crews and people are made up."); the dashed "Midday break not in force" column becomes one legend line; "Open Crew A plan" becomes a primary button (signal); Stop work stays the only slab. Crew strips keep the identity (height is level, colour is heat).

Landing and judge pages: H1 56/650, section headings 44/650 (36 on laptops under 900 px height), lede 22, body 20, measure 62 ch; one idea per screen; at most three "Where from" chips on the landing; the nav is "Take the 3-minute tour" and "For auditors" on the landing and the plain names on judge pages: Evidence, One day, Try a plan, The boundary, Crews.

## 5. Where this lands in code (so the build plan is honest about cost)

`frontend/src/components/states/actions.ts` (two class lists used by every state component and link), `components/ui/button.tsx` (a shadcn base with its own radius), `LanguageChips.tsx`, `SunToggle.tsx`, `DemoModeSwitch.tsx`, `WorkerDock.tsx`, `features/supervisor/StopWorkBar.tsx`, `features/today/{TodayView,LevelHeader,ActionLead,ShiftSpine}.tsx`, `components/spine/TimeSpine.tsx` (already supports `orientation="h"` with `surface="field"`, used by the alert card, so Today switches orientation rather than gaining a new variant), `src/styles/tokens.css` and `globals.css`, the root `DESIGN.md`, and `tests/unit/styles/tokens.test.ts`. The token change is global and small; the Today restructure is the expensive part.
