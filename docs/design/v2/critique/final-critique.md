# Stellar Blaze v2 prototype: final independent critique

Judge: independent critic (not the builder). Date: 2026-11-12. Pixels first; rationale docs read only after the verdict was formed.
Prototype: http://127.0.0.1:8766/prototype/. Rendered at 390x844 (worker-*, supervisor-*, both themes) and 1440x900 (desktop pages), plus 390 for every desktop page. 768 not rendered.

## Method and evidence caveats

- Source gate: design-lint.mjs on the prototype folder: 0 blocking, 0 advisory (default 4px scale; static HTML, so this proves little).
- The shared Playwright MCP browser was hijacked mid-run by another process (it was navigated to 127.0.0.1:3000/en/worker and /en/worker/alerts while on admin.html). Every MCP screenshot was checked against the page it was meant to show. All numbers below come from an isolated headless Chromium (shared design-gate runtime) over 15 pages x themes x viewports: font sizes, WCAG contrast (colours resolved through canvas and composited up the ancestor chain), target sizes, overflow, axe (wcag2a/aa/21aa/22aa), first-fold hero area, focus rings.
- Evidence files (scratchpad, `...\scratchpad\m\`): index-390-night.png, judge-*-390-night.png, hse/admin-390-night-full.png, setup-filled-{sun,night}-390*.png, setup-read-sun-390-full.png, crews-focus-390.png, index-1440-night-y{900,1800,3600}.png. MCP shots are in `C:\Users\LEGION\Documents\Claude\.playwright-mcp\`.
- Not covered: motion and cross-document view transitions (stills cannot show them); every loading/empty/error state (I saw default, `?state=filled` and the post-"Read it" state; the 247 files in gate/after were not audited).
- Only console output seen: a favicon.ico 404.

## 1. Childish, toy-like, generic or AI-looking?

Verdict: no screen is childish or toy-like any more. The v1 screens (cream ground, hatched red block, hand icon, condensed slab "4 RED", PLACEHOLDER and DRAFT TEMPLATE tags, boxed icon tiles) are gone. Remaining tells by area:

- Landing (index): none childish. The heat terrain is a real data object (canvas 1440x838), one family (Archivo 400 display, 46px), colour reserved for heat. Mild tells: tracked-caps wordmark "STELLAR BLAZE"; text-left / visual-right split (earned here).
- Judge pages: adult. Tells: (a) 26 "pending" cells on judge-season (6 on judge-day, 4 on index), each marked with a dashed 10px square that reads as an unchecked checkbox; (b) judge-governance stepper: four dashed outline boxes, and three of four panels read "Nothing sent yet / Nothing recorded / Nobody has asked" (wireframe look, not a finished object); (c) mono sprawl on governance: a list of identifiers like test_employer_has_no_route_to_individual_risk and "import contract: sb.employer must not import sb.health" (6 of 52 text nodes in Plex Mono, developer-README tone).
- Worker (today, alert, unwell, data): adult in both themes. No toy tell. Pictograms (shade house, cup, two people) are monochrome and plain. The 6-language row (EN plus five native-script labels) is a chip row but functional; it takes 71-115px above "Orange".
- Supervisor: crews, plan, relay are adult and specific. supervisor-setup in its default state is the one generic screen: a ruled label / value / hint list repeated nine times ("default: change" under each row) that reads as a settings template. The `?state=filled` state (sentence with five underlined, numbered phrases wired to numbered fields) is distinctive and good, but it is not what a visitor sees first.
- HSE / admin: serious, not childish. Tells: the HSE KPI strip spends two of four tiles on the literal text "Pilot data only" (placeholder tell); HSE and admin print internal-document references to users ("ADR 0011 section 7.6 ... (HANDOFF Q3), to be confirmed in B3", "ADR 0006", "(B3)"), an AI/spec-dump tell; admin is 23 of 166 text nodes in Plex Mono (14 %) and reads as an engineer console.
- Decorative gradients: none found; the only gradients are data ramps (legends, terrain). Cartoon icons: none. Centered clichés: none. Chip forests: none above 6 (language rows on worker-today and relay).

## 2. The four inner-screen rules

Hero is measured as share of the first-fold area (largest SVG in the first viewport); DOM-built heroes are judged by eye.

Rule 1, hero object as strong as the landing, at least 35 % of the first fold:
- FAIL supervisor-setup: the hero tiles are far below the fold. "Create site" is at y=1358, the "site's forecast cell" heading at y=1545, tile svg top at y=1576, week strips about y=1900 of a 2253px page. The first fold holds a 22px / weight 400 h1 and a grey sentence box (about 15 % of the fold).
- FAIL judge-governance at first paint: SVG hero 0 %; the answer / audit row / worker view panels are empty until the user acts.
- Borderline but passing by eye: supervisor-relay (SVG strip 12 %, but the 101px "Orange" word is the hero and works); worker-unwell (SVG 4 %, but a 64px timer plus a 104px call button own the screen).
- Pass: worker-today 31 % SVG plus a 76px level word (just under 35 % on SVG alone), worker-alert 30 %, supervisor-crews 37 %, supervisor-plan 33 %, judge-season 31 %, judge-day 30 %, judge-validator 27 % SVG (the plan strip dominates visually), hse (grid fills the fold), admin 59 %.
- Weakness that survives passing: the judge-season and judge-day heroes are half empty because the "Ours" and "Station truth" series are "pending" (fix 1).

Rule 2, one primary action:
- Formally pass, with the permanent "I feel unwell" dock excluded: worker-today (Listen 358x56), worker-alert (Got it 187x56), supervisor-crews (Relay 358x52), supervisor-relay (Play 358x60), hse (Export 145x52), admin (Activate 130x52).
- By pixels it is not clean: worker-today and worker-alert show two solid 56px bars at once (Listen or Got it plus the dock button). worker-data's filled primary is the destructive "Remove my data" (358x56, y=540), the loudest object on a read-only log. supervisor-plan has "Sign off" as the filled block and the safety-critical "Stop work" only as an outline in the pinned bar. worker-unwell keeps an "I feel unwell" dock bar on the "I feel unwell" screen.
- FAIL supervisor-setup: no filled action in the first fold ("Speak" and "Read it" are outline, same weight). judge-validator "Check this plan" sits at y=844 on a 900px fold.

Rule 3, visible sense of time:
- Pass: worker-today, alert, unwell (elapsed timer plus 10-minute track), data (dated log), supervisor-crews, plan, relay, judge-season, judge-day, judge-validator, hse, admin.
- FAIL judge-governance (Now / Next / Then is a sequence, with no clock or axis) and supervisor-setup above the fold (only the 11:10 header clock; week strips are at the bottom).

Rule 4, linking transition: cannot be seen in stills. Code shows `@view-transition { navigation: auto }` and named spine / level / wordmark on index, judge-*, hse, admin and supervisor-crews/plan, but no view-transition-name on any worker-* page (alert-to-Today link unverified; treat as untested).

Type coherence with the landing: one family (Archivo) on every screen, Plex Mono only for identifiers (setup 4 of 65, judge-validator 8 of 102, admin 23 of 166). Coherent. Weakness: 12 / 13 / 14px are three sizes about 8 % apart carrying most text (judge-season: 109 of 123 text nodes; admin: about 161 of 166 at 1440), so the small end of the scale is sprawl while display jumps to 36-101px.

## 3. Worker screens: arm's length in sun, adult in tone?

Adult in tone: yes, both themes. Readable at arm's length: the level word and the actions yes; the time labels no.
- Good (measured): level word 76px / weight 500; text oklch(0.18) on oklch(0.985) in sun mode (about 17:1); no text node under 4.5:1 on any worker screen in either theme (only the Prototype harness chip, 4.43:1); axe clean on all four at 390 in both themes; no horizontal overflow; buttons 56px tall, tabs 48px, language buttons 44px; 2px focus ring on every worker control tabbed.
- Not good (measured): the entire time ladder is 13px / 400 (06:00 to 18:00 labels, and the Green / Amber / Orange / Red labels); waypoint sub-lines 14-15px; tab labels 14px; "Draft wording" 13px; "Why Orange?" 12px. For a worker in glare these are the numbers that matter. Ladder cells for 06:00-10:00 sample at 1.6-2.1:1 against the sun background (the midday-break cell is 1.19:1 by design), so the start of the shift fades in glare; the 4-segment level bar is only 4px thick. "Make it mine" is a standalone link, 101x20.
- worker-unwell: the fixed Prototype chip (x=299, y=140, 69x32) sits on top of the "0:03" digits at 390, in both themes.

## 4. Before vs after

Worker Today. Before (critique/v1-screens/worker-today-390.png): cream ground, red hatch-textured block with a hand icon and a giant "4", "RED" in condensed slab, PLACEHOLDER tag, three boxed-icon rows, DRAFT TEMPLATE tag, a floating "I feel unwell" overlapping body copy: toy-like, no time. Intermediate (directions/isotherm/shots/worker-390.png): "Red" word plus two text rows and a mono date. After: 76px Archivo level word, four-segment bar, a vertical shift ladder in heat colour with the 12:30-15:00 break cut in, a now line and three countdown waypoints, one 56px Listen, plain pictograms. A clear, large improvement; remaining defects are type size on the ladder and the two-bar competition.

Site setup. Before (directions/isotherm/shots/setup-390.png): dark, mono uppercase provenance ("FROM YOUR SENTENCE", "ASSUMED / CONFIRM"), an outlined "Private: our own server" mono chip, a mic-only button, a seven-row ruled table, no time. After, filled state: sentence in large type with five underlined phrases carrying numbered tags that match numbered field rows, provenance in sentence case, mono almost gone. Clearly better. But the default state a judge lands on is the weak one (grey sentence, nine default rows, "Create site" at y=1358, hero tiles at y=1576), and pressing "Read it" there leaves five "Reading on our own server" skeleton rows for the 15 seconds I waited (they never resolve; only the filled state, reached with the query string state=filled, shows the result). Net: better visual language, still not a hero screen, and the headline interaction stalls.

## 5. Rubric (12 criteria, 0-4)

G1 and G2 were not run through measure.js (lint 0 findings, visual alignment only), so they are scored as judged. G5, G6, G8, G9 were measured.

| # | Criterion | Landing | Judge | Worker | Supervisor | HSE+admin |
|---|---|---|---|---|---|---|
| 1 | Alignment (G+J) | 3 | 3 | 3 | 3 | 3 |
| 2 | Spacing rhythm (G+J) | 3 | 3 | 3 | 3 | 3 |
| 3 | Hierarchy | 4 | 3 | 3 | 3 | 3 |
| 4 | Balance | 3 | 3 | 3 | 3 | 3 |
| 5 | Colour and contrast (G+J) | 4 | 4 | 3 | 3 | 3 |
| 6 | Type scale and readability (G+J) | 3 | 3 | 2 | 2 | 3 |
| 7 | Density and whitespace | 3 | 3 | 4 | 3 | 3 |
| 8 | Affordance and target size (G+J) | 3 | 3 | 3 | 2 | 3 |
| 9 | States and empty guidance (G+J) | 3 | 2 | 3 | 2 | 3 |
| 10 | System coherence | 4 | 3 | 4 | 3 | 3 |
| 11 | Motion restraint | 3 | 3 | 3 | 3 | 3 |
| 12 | Polish | 3 | 3 | 3 | 2 | 3 |
| Total /48 | | 39 | 36 | 37 | 32 | 35 |

Mean of the five areas 35.8, call it 36/48. Lowest single scores are 2 (no 0 or 1).

Unmet G-criteria:
- G8 targets under 24px: supervisor-plan has 17 schedule blocks (g.blk, role=button, tabindex=0) 4-22px wide by 83px tall; worker-today "Make it mine" 101x20; hse and admin "STELLAR BLAZE" wordmark link 162x14 and hse "What if someone asks for one worker?" 217x20; judge-governance footer links "Back: warmer summer" 140x21 and "All views" 54x21.
- G6 text under 12px rendered: supervisor-setup week-strip and map SVG labels 8.9-9.7px (10 labels, at 390); admin chart 48 SVG labels at 8.9px at 390; supervisor-crews and supervisor-plan axis and legend SVG labels 11.3px.
- G5 non-text contrast: the crew-row focus indicator on supervisor-crews is a pale band at 1.18:1 (needs 3:1); the focused anchor has outline-style none.
- G9: supervisor-setup "Read it" dead-ends in a permanent skeleton; the scoreboard cells are pending (26).
- Axe: clean on all 15 pages at 390 and 1440 except admin at 390 (scrollable-region-focusable, serious: the config chart scroll container is not keyboard-focusable). One intermittent target-size hit on index at 390, not reproduced.

Gate result: FAIL (total about 36 < 38; G6, G8, G9 unmet). Versus v1 the improvement is large and monotone (toy-like to adult), but it is not at the gate.

Do not claim done. The judge-facing evidence is the weakest point and is a data gap more than a styling gap: judge-season says the scoring run is "scheduled for 12 Nov 2026", which is today, and every scoreboard cell still says pending.

## 6. Top 10 fixes, ordered by impact

Format: criterion, severity, location, concrete fix.

1. #9, Blocker. judge-season.html scoreboard tables (26 "pending" strings across Warnings and Plans), judge-day.html chart legend ("Ours: pending", "Station truth: pending"), index.html scoreboard chapter (4). Run the scoring run and write the result file (policy_scoreboard.json, scheduled today) so the cells and the two missing curves fill. If it cannot land before submission, replace the 24 dashed-square cells with one banner row per table ("Scoring run 12 Nov: not yet written") and draw the Stellar Blaze series on judge-day from the data that exists; delete the dashed-square glyph.
2. #3 / #7, Major. supervisor-setup.html (default state): move "The site's forecast cell" tile (y=1576) and "The week the site runs" (y about 1900) into the first fold under the sentence box and above "Create site" (y=1358); raise the h1 from 22px/400 to the 34-36px/400 landing step; collapse Shift, Midday break, Acclimatisation and Crew languages into one "Defaults" disclosure row; make "Read it" the filled primary.
3. #9, Major. supervisor-setup.html line about 140 (the loop over Site, Crews, Workers, Work, Dates that emits skeleton rows): the skeleton rows never resolve in the default state. After the fake delay swap to the filled rows (what the state=filled view renders) so the headline interaction completes.
4. #6, Major. worker-today.html and worker-alert.html: ladder time labels, level labels, waypoint sub-lines and tab labels at 13/14/15px become 16px (weight 500 for time labels); "Make it mine" min-height 44px; add a 1px ink edge on ladder cells or darken the first two ramp steps in sun mode (06:00-10:00 cells measure 1.6-2.1:1).
5. #8, Major. supervisor-plan.html g.blk[role=button] (17 blocks, 4-22px wide): remove tabindex and role from the SVG blocks and expose the same blocks as a list of 44px-high rows under the chart (or add a transparent hit rect of at least 24px with spacing). supervisor-crews.html crew-row anchor: add a :focus-visible rule of outline 3px solid var(--ink) with outline-offset 2px (current indicator 1.18:1).
6. #6, Major. SVG label sizes: supervisor-setup week strips and map labels 8.9-9.7px, admin chart labels 8.9px at 390, supervisor-crews and plan axes 11.3px. Set a rendered minimum of 12px (scale the SVG font-size by 12 / rendered-scale, or narrow the viewBox on phone). Add tabindex=0, role=region and an aria-label to admin .spine-wrap (axe serious).
7. #12, Major. Prototype harness chip (fixed, x=299, y=140, 69x32, 4.43:1): it covers the "0:03" timer digits on worker-unwell, the h1 word "sentence." on supervisor-setup at 390, and the "Art. 18 break" legend on supervisor-plan. Hide it behind a ?clean flag (default hidden for judges) or pin it bottom-left above the dock; set its text to --ink.
8. #3, Major. worker-data.html: the filled ink "Remove my data" (358x56, y=540) is the loudest object on a read-only audit log. Make it an outline destructive control, enlarge the "Refused" row (the hero event), keep "I feel unwell" as the only filled bar. worker-unwell.html: replace the dock's "I feel unwell" on the unwell screen with "Back to Today".
9. #4 / #9, Major. judge-governance.html first paint: three of four panels empty. Pre-run the first request on load (or show answer, audit row and worker view as a labelled, real-shaped example) so the hero (the 403 beside the worker's audit row) exists at 35 % of the fold; add a clock time to each of Now / Next / Then; cut the test_* list to the three that matter and set sentences in Archivo with only the identifier in Plex Mono.
10. #10 / #6, Minor. Type scale and copy hygiene: collapse 12 / 13 / 14 into two steps (12 captions, 14 UI) plus 16 body, keep 18 / 22 / 36; hse.html KPI strip: merge the two "Pilot data only" tiles into one footnote and promote "112 crew-hours" to full ink; remove internal references from user-facing copy in hse.html ("ADR 0011 section 7.6 ... HANDOFF Q3 ... B3") and admin.html ("ADR 0006", "(B3)"); supervisor-plan.html header subtitle "Concrete pour, 20 people, he..." is ellipsis-truncated, so wrap it to two lines.

Strengths to keep (do not regress): landing heat field and scrubber; worker shift ladder and alert bracket; supervisor-crews strips with the now line and midday slot; supervisor-relay at 101px; judge-validator plan-on-heat strip; HSE sites x days calendar with the hidden-group cells; the filled setup sentence with numbered tags.
