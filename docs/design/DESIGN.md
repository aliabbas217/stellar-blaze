---
version: alpha
name: Arish Signal (rev. 2, design phase 2026-11-11)
description: >-
  Visual identity for Stellar Blaze, a heat-stress safety product for outdoor workers in the UAE.
  Gulf shade meets industrial signage. Revision 2 of the F1 Task 2 candidate (frontend/DESIGN.md at the
  repo root of stellar-blaze-f1, "DESIGN.md"): same direction, plus a sign rim, sun-first worker theme,
  data-viz and provenance tokens, and a desktop layout for the supervisor, HSE and demo surfaces.
  Light-theme semantic values below; dark values are in tokens/tokens.css.
colors:
  primary: "oklch(0.5 0.08 205)"
  on-primary: "oklch(1 0 0)"
  primary-soft: "oklch(0.93 0.03 205)"
  on-primary-soft: "oklch(0.42 0.07 208)"
  surface: "oklch(0.975 0.012 80)"
  surface-raised: "oklch(0.95 0.02 80)"
  ink: "oklch(0.17 0.015 60)"
  ink-muted: "oklch(0.42 0.035 65)"
  hairline: "oklch(0.83 0.04 76)"
  control: "oklch(0.6 0.045 70)"
  focus: "oklch(0.42 0.07 208)"
  scrim: "oklch(0.17 0.015 60)"
  sign-rim: "oklch(0.17 0.015 60)"
  level-green: "oklch(0.52 0.13 150)"
  on-level-green: "oklch(1 0 0)"
  level-green-soft: "oklch(0.93 0.05 150)"
  on-level-green-soft: "oklch(0.38 0.1 150)"
  level-amber: "oklch(0.82 0.16 85)"
  on-level-amber: "oklch(0.17 0.015 60)"
  level-amber-soft: "oklch(0.95 0.06 90)"
  on-level-amber-soft: "oklch(0.45 0.09 75)"
  level-orange: "oklch(0.7 0.17 50)"
  on-level-orange: "oklch(0.17 0.015 60)"
  level-orange-soft: "oklch(0.93 0.04 55)"
  on-level-orange-soft: "oklch(0.45 0.12 45)"
  level-red: "oklch(0.5 0.19 27)"
  on-level-red: "oklch(1 0 0)"
  level-red-soft: "oklch(0.93 0.035 27)"
  on-level-red-soft: "oklch(0.42 0.16 27)"
typography:
  mega:
    fontFamily: Barlow Condensed
    fontSize: 5.96rem
    fontWeight: 700
    lineHeight: "1"
  numeral:
    fontFamily: Barlow Condensed
    fontSize: 4.768rem
    fontWeight: 700
    lineHeight: "1"
  display:
    fontFamily: Barlow Condensed
    fontSize: 3.052rem
    fontWeight: 700
    lineHeight: "1"
  headline:
    fontFamily: Barlow Condensed
    fontSize: 1.953rem
    fontWeight: 600
    letterSpacing: 0.025em
  title:
    fontFamily: Barlow Condensed
    fontSize: 1.5625rem
    fontWeight: 600
    letterSpacing: 0.025em
  lead:
    fontFamily: Noto Sans
    fontSize: 1.25rem
    fontWeight: 400
    lineHeight: "1.5"
  body:
    fontFamily: Noto Sans
    fontSize: 1rem
    fontWeight: 400
    lineHeight: "1.5"
  label:
    fontFamily: Noto Sans
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: "1.5"
  body-ar:
    fontFamily: Noto Sans Arabic
    fontSize: 1rem
    fontWeight: 400
    lineHeight: "1.8"
  body-ur:
    fontFamily: Noto Nastaliq Urdu
    fontSize: 1rem
    fontWeight: 400
    lineHeight: "2.1"
  body-ur-fallback:
    fontFamily: Noto Naskh Arabic
    fontSize: 1rem
    fontWeight: 400
    lineHeight: "2.1"
  body-deva:
    fontFamily: Noto Sans Devanagari
    fontSize: 1rem
    fontWeight: 400
    lineHeight: "1.5"
  body-bn:
    fontFamily: Noto Sans Bengali
    fontSize: 1rem
    fontWeight: 400
    lineHeight: "1.5"
  mono:
    fontFamily: ui-monospace, Cascadia Mono, Consolas, monospace
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: "1.5"
rounded:
  sign: 2px
spacing:
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "6": 24px
  "8": 32px
  "12": 48px
  "16": 64px
  "24": 96px
components:
  page:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
  card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sign}"
    padding: 16px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.title}"
    rounded: "{rounded.sign}"
    height: 48px
    padding: 12px
  level-sign:
    backgroundColor: "{colors.level-red}"
    textColor: "{colors.on-level-red}"
    typography: "{typography.display}"
    rounded: "{rounded.sign}"
    padding: 12px
  ours-highlight:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.on-primary-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.sign}"
    padding: 8px
  stamp:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sign}"
    padding: 4px
---

# Arish Signal, revision 2

**Status.** Design-phase direction for the F1/F2 build (13 to 18 Nov 2026). It **keeps** the F1 Task 2 candidate
("Arish Signal", `DESIGN.md` at the root of `stellar-blaze-f1`) and **revises** it in six named places (R1 to R6,
below). Every value not listed under "Revisions" is unchanged from the candidate, which stays the source for the
worker shade band, the per-script type table and the Do's and Don'ts. When F2 adopts this file, the root
`DESIGN.md` and `frontend/src/styles/tokens.css` change together (see `HANDOFF.md`, "Token changes").

## 1. The direction procedure

### 1.1 Domain codes (honor or break)

| Axis | Domain convention (outdoor safety, public-health dashboards) | Decision |
|---|---|---|
| Level colours | Green / amber / orange / red traffic set, as in heat-index and ADOSH-style guidance | **HONOR.** Workers already know it; inventing a new scale would cost comprehension |
| Level redundancy | Signs carry shape + pictogram + text, never colour alone (ISO 3864 practice; WCAG 1.4.1) | **HONOR**, and push further: colour + hatch + pictogram + numeral + word |
| Legibility | High contrast, big type, plain language | **HONOR.** Sun-first polarity on the worker route (R2) |
| Dashboard look | Rounded white cards, soft drop shadows, blue/indigo accent, Inter, donut charts | **BREAK.** Flat sand surfaces, 2 px cut corners, hairline + tonal step depth, condensed signage numerals |
| Map-first heat UI | A red/orange heat map as the hero | **BREAK.** The hero is a time band and a scored season, not a map (ADR 0034: the map is table stakes) |
| Data provenance | Usually a footnote | **BREAK.** Provenance is a first-class visual (stamps and proof chips, R4) because "visibly not a mock-up" is the demo's thesis |

### 1.2 Three behavioural adjectives

**Unmistakable at arm's length · calm under pressure · field-tough.** (Unchanged; derived from the users: a worker
reading in glare with gloves on, a supervisor glancing between tasks, a judge with seconds per screen.)

### 1.3 Named movement

**Arish Signal: industrial safety signage (ISO 3864 / road-sign lineage) crossed with Gulf vernacular shade (the
*arish* palm-frond canopy, striped hard-edged shadow).** Signage supplies flat fills, hazard hatching, black or
white sign bands, big plain numerals, pictograms on a grid. The *arish* supplies the sand neutrals, the slatted
hatch and the one teal (*falaj*, the irrigation channels).

### 1.4 Tokens per axis (each cites its adjective)

| Axis | Token decision | Why |
|---|---|---|
| Colour | Sand tinted neutrals (hue 60 to 80); **one** action hue, falaj teal 205; four level fills, the **only** other saturated colours. 60-30-10: sand ≈ 60+, ink ≈ 30, saturated ≤ 10 per screen | *Calm*: saturation is rationed so a red fill always means danger |
| Type | Barlow Condensed 600/700 (signage-derived, OFL) for numerals and Latin headings; one Noto family per script for text; major-third scale with a display jump; new `mega` step for the desktop scoreboard | *Unmistakable*: condensed numerals read at distance and fit four counters across |
| Shape | One radius, 2 px (`rounded-sign`), everywhere. 2 px rules. **Border fork chosen: borders, not shadows** | *Field-tough*: cut sign plates, nothing pillowy |
| Space | 4 px base, steps 4·8·12·16·24·32·48·64·96. Worker: one column, 16 px gutter, 44 px targets. Desktop: 12-column grid, 24 px gutter, 80 rem max | *Calm*: generous, predictable rhythm |
| Motion | One vocabulary: 150 ms opacity on state change; the replay scrubber is the single brand moment (counters tick as the season runs). 0 ms under reduced motion; the scrubber then lands on its final frame | *Calm under pressure*: nothing moves unless the data moved |
| Depth | Flat. Hairline 1 px + one tonal step (`surface-raised`). **Sign rim** (R1) on standalone level signs | *Field-tough*: print-like, survives glare and photocopying |

### 1.5 Signature element

**The shade band** (unchanged): one cell per forecast hour, hatch density = level (none, sparse, medium, dense
cross-hatch), the level numeral on a solid plate, the current hour inverted. Placed in the **first fold** of the
worker Today screen.

**Extended in revision 2 to the demo:** the **season ribbon**, the same hatch language at one cell per day across
15 May to 30 Sep 2026, sits at the top of the season scoreboard (first fold of the judge's first screen), and the
same band with the station's truth dots is the pre-registered day view (the completion moment of the 50 s
storyboard). One visual idea runs from the worker's phone to the judges' scoreboard, so the demo reads as one
product.

### 1.6 References (system extracted, not screenshots cloned)

- **Real UX:** the Delhi heat-alert pilot's colour boards and voice notes for low-literacy workers (frontend-platform
  research §1.2, [S40]): redundancy of colour, symbol and sound; supervisor as the relay. ISO 3864-1 warning-sign
  construction (yellow field, black band, black symbol) via the standard's catalogue page:
  https://standards.iteh.ai/catalog/standards/iso/e38ba1f3-bbc1-4939-8df8-3078467e1f7c/iso-3864-1-2011 .
- **Craft:** road and wayfinding signage systems (condensed grotesque numerals, plate-and-band construction),
  re-derived against the three adjectives, not copied.
- **Evidence for R2:** dark-on-light (positive polarity) text is more legible, attributed to higher display
  luminance constricting the pupil (Piepenbrock, Mayr and Buchner 2014, *Ergonomics*; dissertation summary at
  https://docserv.uni-duesseldorf.de/servlets/DerivateServlet/Derivate-31413 ; glance-reading under ambient light,
  *Applied Ergonomics* 2017, https://pubmed.ncbi.nlm.nih.gov/28166901/ ). Read at abstract/summary level on
  2026-11-11, not full text.

### 1.7 Clone-distance gate

| Check | Result |
|---|---|
| Accent is not indigo / `#6366f1` / purple gradient | PASS: falaj teal `#157079`, domain-derived |
| Base font is not Inter by default | PASS: Barlow Condensed + Noto per script, justified by signage and script coverage |
| Radius is a deliberate scale with a point of view | PASS: a single 2 px, not 8 to 16 px |
| Depth fork chosen | PASS: borders and tonal steps, no shadows |
| ≥ 3 tokens match a Linear / Stripe / Vercel / Geist template | PASS: 0 of type, accent, radius, depth, surface match |
| Signature element present | PASS: shade band + season ribbon |

**Gate: PASS.**

## 2. Revisions vs the candidate (R1 to R6)

**R1. Sign rim (fixes the open 2.89:1 issue, and two more the candidate under-reported).** Measured on the rendered
8-bit sRGB values (`critique/contrast.mjs`): the red fill's edge is 2.89:1 on the dark page and **2.50:1 on dark
`surface-raised`** (not in the candidate table); amber is 1.65:1 and orange 2.63:1 on the light page. A
standalone level sign (worker hero, alert card, level badge, relay sign; on the scoreboard only a small danger marker, see Counter) now carries a 2 px
`--sign-rim`: **ink in light, sand-50 in dark**, the black or white band of a warning sign. Rim vs page is
17.80:1 in both themes; rim vs fill is ≥ 6.16:1 for every fill in both themes. Shade-band cells inside a band do
**not** get the rim (the 2 px gap plus the numeral plate carry them; a rim per cell would turn the band into a
grid of boxes). Fills are not changed, so every on-level text pair stays as measured.

**R2. Sun-first worker theme.** The worker route defaults to **light** whatever the system preference, and keeps a
visible toggle (the worker's explicit choice is stored and wins). Supervisor, HSE and demo routes follow the
system. Reason: positive polarity is more legible in bright surroundings (references above); workers read
outdoors at noon. Dark stays fully supported for night shifts and the evening-before briefing.

**R3. Data-viz tokens** for the demo and supervisor charts (the candidate defined none, and charts must not borrow
level colours for non-level meaning):

| Token | Light | Dark | Role |
|---|---|---|---|
| `--viz-truth` | ink | ink | station truth (dots, solid) |
| `--viz-raw` | ink-muted | ink-muted | raw forecast as issued (dashed line) |
| `--viz-ours` | action | action | Stellar Blaze series and its 5-95 % band (band = 22 % mix with surface) |
| `--viz-grid` | hairline | hairline | gridlines |
| `--viz-ban` | hairline hatch | hairline hatch | ban window (12:30-15:00) shading |
| `--viz-danger` | level-red | level-red | truth High-zone hours only, the one place a level hue appears in a chart, because those hours *are* the danger level |

Series are told apart by **mark shape and dash** as well as colour (dot / dashed line / filled band), so the day
chart survives greyscale and colour-vision deficiency.

**R4. Provenance: stamps and proof chips.** A **stamp** is a label (uppercase when three words or fewer, sentence case when longer, after the detector flagged 35-56 character uppercase runs) in a 2 px ink frame on the page
colour, never a fill: `REAL`, `REAL WEATHER · ASSUMED CREW`, `SIMULATED`, `SENSITIVITY SCENARIO · NOT A FORECAST`,
`PLACEHOLDER`. Stamps never use a level or action colour, so they never compete with a level. A **proof chip** is a
small framed button (`proof`) after every number on the demo surfaces; it opens the proof drawer (protocol line,
script, result file + SHA-256, label). Both are monochrome by design: credibility is shown as rigour, not colour.

**R5. Desktop layout.** The candidate was designed at 390 px only. Supervisor, HSE and demo surfaces use a
12-column grid, 24 px gutter, `--content-max: 80rem`, text measure capped at 66ch. The scoreboard uses the new
`mega` type step (5.96rem, the next major-third step) for its counters at ≥ 1024 px only; on phones counters drop
to `numeral`. All counters use tabular figures (`font-variant-numeric: tabular-nums`).

**R6. "Ours" highlight.** `primary-soft` / `on-primary-soft` (6.77:1 light, 12.43:1 dark) marks the Stellar Blaze
column on the scoreboard and the selected plan. It is the action hue at low chroma, so "ours" and "act here" share
one family and no second accent is introduced.

## 3. Colours

All values OKLCH, in sRGB gamut. Primitives (`--ref-*`) exist only in `tokens/tokens.css`. Contrast is measured on
the browser's 8-bit values by `critique/contrast.mjs` (the method the candidate's unit test uses).

| Pair | Light | Dark | Floor |
|---|---|---|---|
| ink on surface | 17.80 | 17.80 | 4.5 |
| ink-muted on surface / surface-raised | 7.94 / 7.37 | 11.28 / 9.74 | 4.5 |
| on-primary on primary | 5.79 | 10.58 | 4.5 |
| on-primary-soft on primary-soft (R6) | 6.77 | 12.43 | 4.5 |
| control edge vs surface | 3.69 | 4.82 | 3.0 |
| focus vs surface | 7.67 | 10.58 | 3.0 |
| on-level text on fill (green/amber/orange/red) | 5.18 / 10.82 / 6.78 / 6.63 | same | 4.5 |
| **sign-rim vs page (R1)** | **17.80** | **17.80** | 3.0 |
| **sign-rim vs fill, worst case (R1)** | **6.16** (red) | **6.16** (red) | 3.0 |
| level fill vs page, without rim (band cells only) | 4.81 / 1.65 / 2.63 / 6.16 | 3.70 / 10.82 / 6.78 / 2.89 | n/a: numeral plate carries the level (1.4.1, 1.4.11) |

Every candidate figure re-measured with `contrast.mjs` matched to two decimals, so the method agrees with the
candidate's `tokens.test.ts`.

## 4. Typography

Unchanged from the candidate (per-script Noto table; Barlow Condensed Latin only; Western digits in every locale;
line height 1.5 / 1.8 for `ar` / 2.1 for `ur`; no tracking outside English; no `leading-solid` on script text).
Added: `mega` 5.96rem (desktop scoreboard counters only) and the rule **all numerals that change or are compared
use `tabular-nums`**. Added `mono` (the system monospace stack, no web font): SHA-256 hashes and
reproduce commands in the proof drawer only, because a hash must be read character by character.

**Nastaliq.** Urdu body text in Noto Nastaliq Urdu with Noto Naskh Arabic as fallback, line height 2.1, no fixed
heights anywhere a Urdu string can land (the alert card, the hero action lines, buttons). Buttons grow with their
text (`min-height`, never `height`). Native-speaker review decides Nastaliq vs Naskh (frontend-platform §8.2:
no readability study found).

**Bengali and Devanagari.** Noto Sans Bengali / Devanagari, line height 1.5, no letter-spacing; conjuncts need
the same `min-height` rule.

## 5. Layout

- **Worker (phone first, 390 px):** one column, 16 px gutter, max 30rem, bottom bar (Today · Alerts · My data),
  every target ≥ 44 px. Logical properties only; the band flows in reading direction. No charts on the worker
  route (ADR 0003).
- **Supervisor (tablet and phone):** top bar (site, date, locale, theme); crew timeline is the band per crew.
  Relay mode is full-screen, one level, readable at 3 m.
- **HSE and demo (desktop first, 1440 px; must still work at 768 and 390):** 12-column grid, 24 px gutter, 80rem
  max. The scoreboard is 4 columns at ≥ 1024 px, 2 at 768, 1 at 390, in the **same order at every width** (policy
  order P0 to P3, ours last and highlighted). Reordering on phones would split visual order from focus and reading
  order (WCAG 1.3.2, 2.4.3), so it is not done.

## 6. Elevation, depth, motion

No shadows. Hairline + tonal step; sign rim on standalone level signs (R1). Focus ring 3 px `focus`, 2 px offset,
on every `:focus-visible`. Motion: 150 ms opacity on state change; the replay scrubber ticks counters over ≈ 15 s
(the brand moment) and lands on its final frame instantly under `prefers-reduced-motion`. Animate opacity and
transform only.

## 7. Shapes and pictograms

Unchanged: 2 px radius, 24-unit pictogram grid, 2-unit stroke, mitred joins (sun-check, drop, canopy, raised hand).
Added pictograms for the worker flows, same construction: **phone-with-cross** ("I feel unwell"), **eye** (my data
/ who looked), **speaker** (play audio), **cloud-off** (offline). None tested with workers; claim nothing about
comprehension until a native-speaker test.

## 8. Components (new or changed in revision 2)

- **Level sign** (was "level badge"): fill + hatch + plate + pictogram + numeral + name, **plus the 2 px sign rim**.
- **Alert card**: a level sign at full width, the time window, up to three action lines from reviewed templates,
  a play-audio button, the source line ("site level" or "your level, worked out on this phone").
- **Stamp** and **proof chip** (R4). **Proof drawer**: a side sheet (bottom sheet under 768 px) with four lines.
- **Counter**: `mega`/`numeral` tabular number in ink + unit + 95 % interval line + proof chip. The `danger` variant adds a small rimmed, hatched red marker beside the label; it does **not** fill the number red (critique: four red tiles spent the colour on a statistic before its value was known and removed the focal point). The pre-registered outcome sentence sits above the scoreboard in a framed verdict block, the same size whether the result is good or bad.
- **Season ribbon**: 139 day cells, hatch by truth High-zone hours, accessible as a table.
- **Day chart**: SVG, hours on x, TWL zones as background bands, raw dashed line, ours band, truth dots, ban hatch.
- **Validator result list**: violation rows with rule id, clause, tick range; clause text in `label`.
- **Floor banner**: ink frame, "Green is not permission to extend work…" (ADR 0011 §7.2), on every plan view.
- **k-suppressed cell**: em-dash + "fewer than k" note; never a zero.

## 9. Do's and Don'ts (additions to the candidate's list)

- Do put the sign rim on every standalone level sign; don't put it on band cells.
- Do stamp every demo number with its provenance; don't style a stamp with a level or action colour.
- Do use `--viz-*` tokens in charts; don't use a level hue in a chart except `--viz-danger` for truth High-zone hours.
- Don't write a fake-looking real figure anywhere in a prototype or fixture: use the `⟨slot⟩` notation and a
  `PLACEHOLDER` stamp until the exporter's JSON exists.
- Don't say "minutes avoided", "illness prevented" or "compliant" on any screen (ADR 0034, stakeholder D1).
- Don't show a k-suppressed value as 0; show "fewer than k".
- Don't use an em-dash or en-dash in visible copy (second opinion T2); use a full stop, comma or colon.
- Don't number section eyebrows on product screens, add decorative dots, or draw filled-track progress bars
  (second opinion T4 to T6, `critique/taste-direction-second-opinion.md`).
- Do give every empty state a level element or pictogram in view, so a sparse screen still reads as this
  product and not as generic warm paper (second opinion T1).
