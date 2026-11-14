# Stellar Blaze v2: independent critique of the three visual directions

Judged 2026-11-12 from the rendered pages at http://127.0.0.1:8766/directions/ (A = isotherm, B = almanac, C = watch). I did not read description.md, DESIGN.md or diagnosis.md. Every number below was measured in the live browser (Playwright, DOM computed styles, canvas colour resolution, pixel sampling of my own screenshots) unless marked "from screenshot". The three setup pages were re-rendered after the 2026-11-12 copy change (privacy badge, CSV-only roster).

## Verdict in one screen

| Rank | Direction | Total /48 | Gate | One-line "childish / generic / AI" verdict |
|---|---|---|---|---|
| 1 | B Almanac | 34 | FAIL | Not childish, not toy. Most distinctive and most authored. Only real AI tell is the serif + italic-emphasis trope (H1 phrase, "Stellar *Blaze*" wordmark) plus numbered uppercase eyebrows and a 3-up numbered card row. |
| 2 | A Isotherm | 31 | FAIL | Not childish. Reads serious but is the most generic in genre: near-black + inferno ramp + mono-uppercase eyebrows and table heads + two-tone headline = the default "data product" look. |
| 3 | C Watch | 27 | FAIL | Not childish, but toy-adjacent (voxel columns read as Minecraft/city-builder) and the clearest "AI ops-console" pastiche: 10+ chips per page, 71% of landing text in mono, `>` prompt with block cursor, 10px type. |

No direction passes the three-layer gate (needs >=38/48, every G satisfied, no criterion <2). They are directions, not finished builds, so that is expected; the point is the ordering and what to fix.

Best combination (see "Borrow" below): B landing structure and chart + A worker screen + C hourly strip and event log + A's setup (the only one with a real text input).

## Evidence and method

- Rendered at 1440x900 and 390x844, live, WebGL working in my browser. Animation frozen with `?still&h=14`; also checked `h=6` on A.
- My captures (kept out of the repo): `C:\Users\LEGION\AppData\Local\Temp\claude\c9efb48f6f935e8c\014d9cea-9854-40c1-ad4e-9698e91ae2e0\scratchpad\shots\` : `{A,B,C}-landing-1440(-full).png`, `{A,B,C}-landing-390-vp.png`, `{A,B,C}-worker-390-vp.png`, `{A,B,C}-setup-1440-full.png`, `{A,B,C}-setup-390-vp.png`, `A-landing-h6.png`, `C-crop-field.png`. The fallback shots by the authors (`directions/isotherm/shots/fallback-1440.png`, `directions/almanac/shots/landing-fallback-1440.png`) were also viewed.
- Source gate: `design-lint.mjs --advisory` on all three directories: 0 blocking, 0 advisory (it scanned only 3-4 files per direction, so weak evidence either way).
- `measure.js` against the DEFAULT 4px grid and default type ramp, not the tokens of the project (I deliberately did not read DESIGN.md), so "off-scale" counts below are indicative only.
- axe-core (design-gate runtime), wcag2a/aa/21aa/22aa + best-practice, both viewports:
  - `color-contrast`: no violations on any of the 9 pages at either viewport.
  - A setup: `definition-list` (serious, 1 node) at both viewports. A worker: `page-has-heading-one` (+ `region` at 1440), moderate.
  - B setup: `page-has-heading-one` (moderate). C worker: `region` (moderate, 2-3 nodes). Everything else clean.
- DOM-text contrast computed with canvas colour resolution (oklch-safe) and alpha-composited backgrounds. Canvas/WebGL pixels were sampled by hand where text sits on them.
- Reduced motion: all three heroes animate by default and freeze completely under `prefers-reduced-motion: reduce` (0 changed pixel samples over 2.5 s). Good on all three.
- Keyboard focus ring is visible on the worker page of all three (2-2.7px outline, 2px offset).
- One transient oddity: the B landing logged 2 console errors (`<path> d="MNaN..."`, `<circle> cx="NaN"`, index.html:294) only during a Playwright full-page capture. Not reproducible on load or on a plain viewport resize, so not scored, but worth a guard against zero-height.

### Metrics summary (1440 unless noted)

| Metric | A isotherm | B almanac | C watch |
|---|---|---|---|
| Families | Archivo + IBM Plex Mono | Newsreader + Schibsted Grotesk | Chivo + Chivo Mono |
| Landing: share of text elements in mono | 67% (43/64) | ~0% (1 `code`) | 71% (137/193) |
| Landing: mono-uppercase elements (all uppercase) | 5 | 0 (8 sans) | 11 (24) |
| Landing: text elements <12px | 11 (10, 10.5, 11px) | 9 (8px SVG labels; 3.8px rendered at 390) | 117 of 193 (71 at 10px) |
| Landing H1 | 60px, 5 lines, two-tone | 64px serif 500, 5 lines, italic phrase | 21.6px in a side card |
| Chips/badges on landing | 1 (BAN tag) | 0 | 11 |
| Chips/tags on setup | 1 privacy chip + 9 mono tags | 0 (glyph legend) | 10 chips |
| DOM-text contrast failures | 0 | 0 | 0 (16 "fails" were transparent hidden tick labels; excluded) |
| Lowest DOM-text contrast | 5.4 (setup) | 5.57 | 5.4 |
| Targets <24px (landing) | 1 (wordmark link 18px tall) | 0 | 3 (wordmark 17px, two standalone links 17px) |
| Dead in-page anchors | 3 of 9 links (`#story` x2 incl. primary nav CTA, `#proof`) | 0 | 0 |
| measure.js off-scale spacing (landing/worker/setup) | 41 / 39 / 34 | 5 / 1 / 6 | 9 / 7 / 2 |
| measure.js alignment near-misses (landing/worker/setup) | 15 / 3 / 0 | 12 / 0 / 2 | 40 / 6 / 13 |
| Horizontal overflow | none | none | none |

Worker screen, 390x844 (first viewport):

| | A | B | C |
|---|---|---|---|
| Level word | "Red" 76px/500, black, 18:1 | "Red until 17:00." 48px serif 600, wraps to 2 lines, 16.4:1 | "Red" 64px/600, black, 16.9:1 |
| Instruction text | 22px/500, 18:1 | 18px/500, 16.4:1 (key numerals bold) | 18px/400, 16.9:1 |
| Smallest text | 13px labels at 5.7:1 | 12px at 5.6:1 | 12px mono caps at 6.4:1 |
| First instruction top (sticky bar starts y=728) | y=534; 2 of 3 fully above the bar | y=580; 1 fully above, 2nd under the bar | y=704; section starts under the bar |
| Severity colour footprint (red px / viewport, from screenshot) | 0.21% (about 6px bar segment) | 0.09% (one 15x15 square; the "Red" scale segment is black) | 1.18% red + 1.7% warm (4-colour scale + hourly strip) |
| Language buttons | 40px high | 40px high | 44px+ |

---

## A. Isotherm (dark, inferno terrain)

### A1 Landing (`isotherm/index.html`)
1. Childish/toy/generic/AI?
   - Not childish, not toy. Genre-generic: near-black ground + inferno ramp + mono caps is the default "forecast/data product" look.
   - Triggers: eyebrow "HEAT STRESS FORECAST . UNITED ARAB EMIRATES" (mono caps, 12px); readout panel in mono ("WBGT in sun, peak", "NIOSH limit, heavy work"); scoreboard header row in mono caps; 12 "scored 12 Nov" mono cells; two-tone H1 (white first sentence, grey second); hairline dividers everywhere; ICAO codes (OMAA, OMDB) in black label boxes that a health-competition judge cannot decode.
   - Stray "." in every cell of the "95% interval" column (render defect).
2. Judge, first 5 seconds: serious yes; memorable yes (the lit terrain plus the 39.3 C readout is the best single "moment" of the three). But the 60px, five-line H1 competes with the terrain for focal point, the readout that gives it meaning sits small at bottom right, and the page is only a hero plus one scoreboard section. The primary nav CTA "Start the 3 minute story" and "How it is proved" go to `#story` / `#proof`, which do not exist (3 of 9 links dead). A judge who clicks the headline CTA gets nothing.
3. Readability: n/a (landing). At 390 the terrain is below the fold and two labels collide (OMDB under OMRK); the nav collapses to one button, so Scoreboard / Proof / For crews / Set up are unreachable from the header.
4. Top 3 fixes: see A-fixes.

### A2 Worker "Today" (`isotherm/worker.html`)
1. Tells: one mono-uppercase eyebrow ("HEAT LEVEL NOW") and a mono date; otherwise plain. The black ISO-style pictograms (shade, cup, two people) are adult, not cartoon. Not childish, not AI-template. This is the best worker screen of the three.
2. 5 seconds: n/a, but the screen is understood in one second ("Red", until 17:00, midday break 12:30 to 15:00).
3. Arm length in sun: strong. 76px level word at 18:1; instructions 22px at 9.6-18:1; 2 of 3 instructions above the sticky bar. Weaknesses: severity colour is 0.21% of the viewport (the "Red" word is black; only a ~6px bar segment is red), so Red and Green look nearly identical at a glance; the four scale labels are 13px; language buttons are 40px high. Tone: adult (reads like a safety sign).
4. Fix: see A-fixes.

### A3 Setup (`isotherm/setup.html`)
1. Tells: 9 mono-uppercase provenance tags ("FROM YOUR SENTENCE" x2, "ASSUMED . CONFIRM", "INFERRED", "INFERRED FROM THIS WEEK", "FROM THE RULESET", "DEFAULT . CHANGE", plus "NEW SITE" and "LOCATION" eyebrows) and a mono left label column = the "AI template" provenance-tag pattern. The new privacy badge is a bordered mono chip that wraps to three lines at 390 ("Private: / our own / server") beside a 12px mono paragraph, the hardest-to-read paragraph in the set. Otherwise plain, restrained, adult.
2. 5 seconds: n/a. Honest and complete: real textbox with caret, mic, "Read it", read-back list, one question, CSV roster, Create/Edit.
3. Readability: all targets >=44px; text >=12px; min contrast 5.4:1. The mono label column and privacy copy are the weak spots.
4. Fix: see A-fixes.

### A-fixes (top 3)
1. Blocker, criterion 8/12, the anchors `#story` (nav CTA + duplicate) and `#proof`: the target ids do not exist. Build the two sections or delete the buttons; make the nav CTA "For crews" (`worker.html`). Give the mobile header a menu so the four hidden links are reachable.
2. Major, criterion 3/5, worker `.level` block: put the level word on a full-width solid band in the level colour (target >=7:1 for the word) instead of a ~6px segment, so colour carries severity; raise the four scale labels from 13px to >=15px; keep the 22px instructions.
3. Major, criterion 6/10, whole direction: collapse the 10 / 10.5 / 11 / 12px sizes to one 12px floor (13px for anything a worker reads); set eyebrows, table headers and provenance tags in sentence-case Archivo 13px and keep mono for numerals and codes only (cuts the mono share from 67% to roughly 20%); replace the stray "." in the interval column with "pending"; add `background: oklch(0.155 0.012 255 / 0.85)` behind `.readout` because the terrain edge slides under "WBGT in sun, peak" (3.9:1 on the live page at 06:00, 1.8:1 in the capture by the author).

---

## B. Almanac (light editorial, ridgeline)

### B1 Landing (`almanac/index.html`)
1. Childish/toy/generic/AI?
   - Not childish, not toy; nothing decorative.
   - Tells: serif H1 with an italic emphasized phrase ("heavy-work heat limit") and the "Stellar *Blaze*" wordmark; tracked uppercase eyebrows with numbering ("1 . THE PROBLEM", "2 . SCOREBOARD", "3 . PROOF"); a 3-up numbered card row in Proof; a big-number pair (2,609 / 279). Individually these are the 2025 "AI editorial" tropes; collectively they are earned because every figure is traceable (the text alternative of the chart states 2,609 of 3,336 hours over the limit; the caption admits the 279 "flatters the ban").
   - Hairline sameness is limited: thick top rules plus thin separators, and spacing varies by section.
2. Judge, first 5 seconds: the most serious and the most confident. A ridgeline of 139 forecast days with direct labels ("15 Jun . midday ban starts", "NIOSH heavy-work limit, 26.6 C, colour starts at this line") reads like an FT/Economist graphic, and the headline makes a falsifiable claim the chart supports. Memorable (an "Unknown Pleasures" ridgeline of a real summer). Complete page: hero, problem, scoreboard, proof, footer; 0 dead links. Risks: it is a long-form argument rather than an instant "wow"; the scoreboard (all "scored 12 Nov") is empty.
3. Readability: n/a (landing). At 390 the heatmap axis labels render at 3.8px (8px SVG text scaled by 0.476), the "23" on the chart axis is clipped at the right edge, and the "3 Sep, 14:00" annotation overlaps the ridges.
4. Top 3 fixes: see B-fixes.

### B2 Worker "Today" (`almanac/worker.html`)
1. Tells: serif + italic wordmark; "WHAT TO DO NOW" as a 12px tracked-caps eyebrow. Otherwise the most adult in tone (reads like a bulletin). Not childish, not toy. Bold numerals inside instructions ("**20 minutes**, rest **40 minutes**") are a good scanning device.
2. 5 seconds: n/a.
3. Arm length in sun: the weakest of the three. The level headline is 48px serif and wraps to two lines; instructions are 18px; the actionable section is labelled in 12px caps and sits lowest (first instruction at y=580, second tucked under the sticky bar at y=728). Severity colour is one 15x15px red square (0.07% of the viewport) and the "Red" segment of the scale is black; a serif at 500 weight loses stroke under glare. Contrast itself is fine (lowest 5.6:1). Tone: adult, perhaps too literary for a multilingual crew.
4. Fix: see B-fixes.

### B3 Setup (`almanac/setup.html`)
1. Tells: italic serif pull-quote of the sentence (elegant, trope-adjacent); 4 tracked-caps eyebrows. The provenance glyph legend (filled square = said by you, half square = worked out, section sign = UAE rule, empty square = our guess) is the best provenance device of the three and is not a chip. The new privacy badge is labelled "DATA CLASS", which is jargon for a plain privacy promise.
2. 5 seconds: n/a. Functional gap: there is no text input (a query for input, textarea and contenteditable returns 0). The sentence is a static blockquote with "Say it again", so the screen shows the read-back but never the entry state.
3. Readability: text >=12px except 5 elements at 10px; min contrast 5.6:1. The inline "Edit" button is 22x24px (<24 wide). Map latitude labels collide with the coastline (24.3 N, 24.2 N).
4. Fix: see B-fixes.

### B-fixes (top 3)
1. Major, criterion 5/6, ridgeline ramp and heatmap: the lowest stops of the crest ramp measure 1.09-1.25:1 against the paper (#f4f7f9) for 26.6-30 C and about 1.9:1 at 33 C (graphical objects need 3:1), so the hours just over the limit, the whole point of the headline, are the faintest marks. Start the ramp at about oklch(0.80 0.15 80) (>=3:1) or add a darker 0.5px outline to crests. Make the heatmap SVG axis text >=11px at rendered size (currently 8px, 3.8px at 390): set the size in CSS px outside the scaled viewBox or scale it inversely.
2. Major, criterion 3/5, worker: make the level band carry colour (the Red segment plus a >=8px rule or full-width band in the level colour instead of a 15px square); promote "What to do now" from a 12px caps eyebrow to a >=22px heading; raise instructions from 18px to 22px (match A) so at least two sit above the sticky bar at 844px height (shrink the header or move the language tabs into a sheet to buy ~90px).
3. Major, criterion 9/8, setup: add the entry state above the read-back (textarea + mic + "Read it", per A) and show the empty/error variants; rename "DATA CLASS" to "Private . own server"; enlarge inline Edit/Confirm/Change to >=24px hit area; add an h1 (axe).

---

## C. Watch (dark ops console, voxel field)

### C1 Landing (`watch/index.html`)
1. Childish/toy/generic/AI?
   - Not childish, but toy-adjacent and the most "AI cyber dashboard".
   - Triggers: the voxel/column field (reads Minecraft or city-builder; foreground columns tower, one lone stalk sits in the Gulf near 52.5 E as an apparent outlier or bug, and the labels OMDB/OMSJ/OMRK/OMAD/OMDW pile up with leader lines); 11 chips ("HOTTEST STATION" in cyan, plus OMAA / FIELD / RULESET on every event-log row); 71% of text in mono; mono-caps panel titles (NEEDS ATTENTION, EVENT LOG, STATIONS, WBGT FIELD, SUN-EXPOSED); a "REPLAY . PAUSED" status bar; every panel boxed with a 1px hairline (hairline-everything sameness); 117 of 193 text elements below 12px (71 at 10px).
2. Judge, first 5 seconds: reads as "serious and operational" but not as the product, and not memorable beyond "a dashboard". Eight equal-weight panels, a 21.6px H1 in a side card, no single focal point; the 3D field is entirely over the limit (374/374 cells), so it has no contrast between safe and unsafe. No narrative. The judge-facing scoreboard is 12 "scored 12 Nov" mono cells at 11-12px.
3. Readability: n/a (landing). At 390 the 3D field is cropped on the left, the timeline hour labels overlap, and the nav is hidden entirely (the crew phone and setup are reachable only through two 17px text links further down).
4. Top 3 fixes: see C-fixes.

### C2 Worker "Today" (`watch/worker.html`)
1. Tells: black mono header strap ("MUSSAFAH M-14 YARD / THU 3 SEP . 11:10") feels terminal; "Red" followed by a small decorative red square; mono caps eyebrows ("HEAT LEVEL NOW", "TODAY, 06:00 TO 19:00", "DO THIS NOW"). Otherwise adult and operational; not childish. The four-colour (green/amber/orange/red) scale is conventional rather than toy.
2. 5 seconds: n/a. Best content ideas in the set: the hourly heat strip with a "now" marker and a "break" bracket; and "Starts in 1 h 20 min. Stop work and go to shade.", the only actionable countdown anywhere.
3. Arm length in sun: mixed. Level word 64px at 16.9:1; the colour footprint is the largest (1.18% red + 1.7% warm) and the strip is the best at-a-glance read. But "Do this now" starts at y=704 of 844, directly under the sticky bar (y=728): on the first screen the worker cannot read a single instruction. Instructions are 18px/400, labels 12px mono caps. Tone: adult.
4. Fix: see C-fixes.

### C3 Setup (`watch/setup.html`)
1. Tells: 10 chips ("PRIVATE . OWN SERVER", "SENTENCE . MAP", "SENTENCE", "ASSUMED . CONFIRM" filled cyan, "INFERRED", "INFERRED . EDIT", "RULESET", "DEFAULT . CHANGE", "NEEDS YOU" filled cyan, "NAMES STAY ON DEVICE"); numbered step cards 01-04 with a gutter; the sentence set in mono with a prompt glyph and block cursor; 10px mono labels (33 of 91 text elements under 12px). The "AI terminal template" pattern at full strength.
2. 5 seconds: n/a. Useful content: the "Rules this site will use" panel (NIOSH 26.6 C, ban dates and hours, ADOSH levels, forecast source) is the clearest statement of what the site will do. Layout: an 88px dead left gutter at 1440 against a right rail.
3. Readability: contrast fine (5.4:1 min), but 10px chip text and 10.5-10.7px labels are far below a comfortable floor on a projector or a phone.
4. Fix: see C-fixes.

### C-fixes (top 3)
1. Blocker, criterion 6/7, everywhere: 117 of 193 landing text elements are under 12px (71 at 10px). Set a 12px floor (13px for anything read on the phone), cut mono to numerals and codes, delete the chip on every event-log row (source as a colour dot, or drop it), remove "HOTTEST STATION", and replace the ten setup chips with plain 13px text beside each value.
2. Major, criterion 3/10, landing: give it one focal point: H1 >=40px above or beside a 3D field that takes >=60% of the width; move Stations, Event log and Scoreboard below the fold; replace the voxel columns (and the lone stalk) with a continuous surface, or at minimum cap station labels at 3-4; the field must show some cells under the limit or it cannot tell a story.
3. Major, criterion 3/8, worker: put "Do this now" above the hourly strip so at least the first two instructions clear the sticky bar (first item currently y=704, bar y=728); shrink or drop the black mono strap; make the two standalone links in the landing cards "How the numbers are made" at least 24px tall (currently 17px).

---

## 12-criterion rubric

G = decided by measurements; J = judgment grounded in them. 0 broken, 1 poor, 2 acceptable, 3 good, 4 exemplary.

| # | Criterion | A | B | C | Basis |
|---|---|---|---|---|---|
| 1 | Alignment and grid (G+J) | 3 | 3 | 2 | Near-miss drift 1-6px: A 15/3/0, B 12/0/2, C 40/6/13 (landing/worker/setup; mostly tick marks and tiny labels) |
| 2 | Spacing rhythm (G+J) | 2 | 3 | 3 | Off-scale vs default 4px grid: A 41/39/34, B 5/1/6, C 9/7/2 (indicative; project tokens not used) |
| 3 | Visual hierarchy (J) | 3 | 3 | 2 | A: terrain vs 5-line H1 split focus; B: strong, weak only on worker; C: eight equal panels, 21.6px H1 |
| 4 | Balance (J) | 3 | 3 | 3 | None has an unmotivated empty quadrant; C is crowded, not lopsided |
| 5 | Colour and contrast (G+J) | 3 | 2 | 3 | DOM text passes everywhere; crest ramp of B is 1.09-1.9:1 for the lowest stops (unmet G, non-text under 3:1); readout label of A is 3.9:1 at 06:00 |
| 6 | Type scale and readability (G+J) | 2 | 3 | 1 | A: 11 sizes, four within 2px under 13px; B: 8px SVG labels, 2 families; C: 117/193 under 12px, 71% mono |
| 7 | Density / whitespace (J) | 3 | 3 | 2 | C is cramped; A and B comfortable |
| 8 | Affordance and targets (G+J) | 2 | 3 | 2 | A: dead primary CTA, 1 target under 24px; B: 2 targets under 24px (wordmark 20px, inline Edit 22x24), all links live; C: 3 targets under 24px (17px) |
| 9 | State coverage and empty-state guidance (G+J) | 2 | 2 | 2 | None shows hover/disabled/loading/empty/error; scoreboard is an empty placeholder in all three; B setup has no entry state |
| 10 | Brand coherence, not generic AI (J) | 3 | 3 | 2 | A coherent but genre-default; B coherent and distinctive despite the serif/italic trope; C chips/mono/terminal pastiche |
| 11 | Motion need and restraint (J) | 3 | 3 | 3 | All animate by default and freeze fully under reduced motion; motion is a time replay (purposeful) |
| 12 | Polish and finish (J) | 2 | 3 | 2 | A: dead links, stray ".", 06:00 overlap, label collisions; B: mobile chart label illegibility and clipped "23" (counted under #6); C: label pile-up, lone stalk, 3D crop at 390 |
| | **Total /48** | **31** | **34** | **27** | |
| | Unmet G | 6 (type sprawl), 8 (dead CTA, 18px link), 2 | 5 (non-text contrast), 6 (8px labels), 8 (two targets under 24px) | 6 (text under 12px), 8 (17px links), 1 (40 drifts) | |
| | Any criterion under 2 | no | no | yes (#6 = 1) | |
| | PASS/FAIL | FAIL | FAIL | FAIL | needs >=38/48, every G, none under 2 |

Stop condition: single pass with comparative scoring across directions (no previous iteration to diff against). Not a PASS; findings are surfaced, not waved through.

## Ranking and reasons

1. **B Almanac (34).** The only direction where the page argues something checkable (all 139 days crossed the limit; the ban covers about one in ten of the hours over it) and where every chart label is direct. Most adult, most distinctive silhouette (serif display + ridgeline), complete landing (no dead links), best measured spacing, zero mono-uppercase noise. Its failures are fixable and specific: the ramp starts too pale, the heatmap labels are 8px, the worker screen under-signals severity and buries the actions, and the setup screen has no input.
2. **A Isotherm (31).** The best single moment (lit terrain plus 39.3 C) and the best worker screen. Loses on genre-genericness, mono/type sprawl, 41 off-scale spacing values, and an unfinished landing (three dead links including the primary CTA, one section only).
3. **C Watch (27).** The richest data ideas (event log, station sparklines, hourly strip, rules panel) in the least legible and most template-like skin: 71% of text under 12px or in mono, chips on every row, a voxel field with a bug-looking outlier, no focal point.

If the owner has a strong instinct for "dark and dramatic" rather than "editorial and trusted", A is the fallback, but only after its dead CTAs and type sprawl are fixed. Do not choose C as the skeleton.

## Cross-cutting findings (all three)

- The scoreboard, the judge-facing proof, is an empty placeholder in every direction (12 cells reading "scored 12 Nov"; today is 12 Nov). Show the numbers, or show a dated pending state that says when they land and what each metric will be, rather than twelve identical placeholders. A also prints a stray "." in the interval column.
- Severity colour is under-used on every worker screen (0.09% to 1.2% of the viewport); words carry the level. For a screen read at arm length in sun, the level should sit on a full-width solid band (text >=7:1), the way a safety sign does. This is also the adult, non-toy way to spend colour.
- No screen shows hover, disabled, loading, empty or error states; criterion 9 is capped at 2 for all.
- All worker screens show "Draft wording, awaiting clinical review" to the worker: fine for a design still, remove in the build.

## Borrow from the losers

- From A: the worker screen as the base (76px level word, 22px/500 instructions, ISO pictograms, plain list); the readout panel (39.3 C against the 26.6 NIOSH line) as the hero caption for B; the entry state of the setup screen (real textbox + mic + "Read it").
- From B: the structure (problem, scoreboard, proof), direct chart annotations, the 2,609 / 279 honesty block, the provenance glyph legend (replaces the chips in A and C), bold numerals inside instructions.
- From C: the hourly heat strip with "now" and "break" markers for the worker screen (best data design of the nine screens); the "Starts in 1 h 20 min. Stop work and go to shade." line; the event log ("derived from the data") as a way to make the scoreboard area tell a story before scores exist; the "Rules this site will use" panel on setup; the station sparkline list as a secondary view.

## Limits of this critique

- Contrast of text drawn inside WebGL canvases was spot-checked by pixel sampling, not exhaustively.
- measure.js used default scales, so spacing and type "off-scale" counts are indicative; alignment near-misses are mostly tick marks and small labels.
- The no-WebGL fallback was reviewed from the screenshots by the authors only (A: pixelated flat rectangle crowding the H1 and readout; B: flat ridgeline with clipped right-edge labels; C: none provided, so unverified).
- Animation was verified only for presence and the reduced-motion freeze, not for pacing.
