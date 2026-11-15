---
version: v2-final
name: Qaylula (design phase 2026-11-12)
description: >-
  Visual identity for Stellar Blaze v2: a dark instrument and operations console for heat-stress safety in the UAE,
  merging direction A (Isotherm) and C (Watch), with direction B's landing narrative. Heat colour lives only on data.
  The signature is the legal midday break drawn into time itself. Replaces the v1 "Arish Signal" direction
  (docs/design/DESIGN.md, kept unchanged as the rejected baseline). Tokens: prototype/assets/tokens.css.
colors:
  ground: "oklch(0.17 0.014 245)"
  ground-deep: "oklch(0.145 0.014 245)"
  panel: "oklch(0.205 0.014 245)"
  raised: "oklch(0.24 0.014 245)"
  slot: "oklch(0.125 0.012 245)"
  hair: "oklch(0.3 0.012 245)"
  edge: "oklch(0.51 0.012 245)"
  ink: "oklch(0.95 0.005 245)"
  ink-2: "oklch(0.78 0.01 245)"
  ink-3: "oklch(0.64 0.012 245)"
  signal: "oklch(0.84 0.075 200)"
  lv-green: "oklch(0.72 0.14 150)"
  lv-amber: "oklch(0.83 0.14 85)"
  lv-orange: "oklch(0.73 0.15 52)"
  lv-red: "oklch(0.66 0.19 27)"
  sun-ground: "oklch(0.985 0.002 245)"
  sun-ink: "oklch(0.18 0.012 245)"
  sun-signal: "oklch(0.45 0.09 215)"
typography:
  display:
    fontFamily: Archivo
    fontSize: 3rem
    fontWeight: 400
    letterSpacing: -0.02em
  level:
    fontFamily: Archivo
    fontSize: 4.75rem
    fontWeight: 500
  title:
    fontFamily: Archivo
    fontSize: 1.375rem
    fontWeight: 500
  body:
    fontFamily: Archivo
    fontSize: 1rem
    fontWeight: 400
    lineHeight: "1.5"
  label:
    fontFamily: Archivo
    fontSize: 0.8125rem
    fontWeight: 500
  wordmark:
    fontFamily: Archivo
    fontSize: 0.875rem
    fontWeight: 600
    letterSpacing: 0.16em
  body-ar:
    fontFamily: Noto Sans Arabic
    fontSize: 1rem
  body-ur:
    fontFamily: Noto Nastaliq Urdu
    fontSize: 1rem
    lineHeight: "2.5"
  body-deva:
    fontFamily: Noto Sans Devanagari
    fontSize: 1rem
  body-bn:
    fontFamily: Noto Sans Bengali
    fontSize: 1rem
  code:
    fontFamily: IBM Plex Mono
    fontSize: 0.8125rem
    fontWeight: 400
rounded:
  r: 2px
spacing:
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "6": 24px
  "8": 32px
  "12": 48px
  "16": 64px
components:
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.r}"
    height: 44px
  qaylula-slot:
    backgroundColor: "{colors.slot}"
    textColor: "{colors.ink-3}"
---

# Qaylula: v2-final design direction

**Status.** Design phase, 12 Nov 2026; Ali chose "dark, from A and C, with B's landing story" on 12 Nov. Inputs:
`critique/diagnosis.md` (why v1 read as a toy), `research/references.md` (25 measured references),
`research/friction.md`, `ux/v2-journeys.md`, `critique/directions-critique.md` (independent critique of A/B/C) and
`critique/inner-screens-gap.md` (why the inner screens were weak).

## 1. Direction procedure

**Domain codes.**

| Axis | Convention | Decision |
|---|---|---|
| Heat fields | Rainbow ramps that hump in lightness (references §6, P3) | **BREAK**: one perceptual ramp, monotonic lightness, colour only on data |
| Danger | Filled coloured signs (v1) | **BREAK**: word + position on a thin scale + a small mark (NWS HeatRisk, R08) |
| Dark ops consoles | Mono everywhere, chips on every row, neon (direction C's failure) | **BREAK**: one sans with tabular figures; mono only for codes; tags only where the tag is the information |
| Time | Hour strips and scrubbers (Windy R01) | **HONOR**, and make it the spine of every screen |
| Legibility outdoors | Positive polarity in sun (v1 R2 evidence) | **HONOR** via sun mode (§6), without giving up the dark identity |

**Three adjectives.** *Exact · calm · on-the-clock.* (Exact: real data and provenance on every number. Calm: dark,
quiet chrome; nothing moves unless time moves. On-the-clock: every screen answers "what now, and until when".)

**Named movement.** *Instrument modernism over a Gulf night*: the restraint of scientific instruments and
ops consoles (nullschool, Windy, flight-ops strips) on a blue-black ground tinted toward the night sky over the Gulf.

**Why "Qaylula".** *Qaylula* (قيلولة) is the midday rest. The UAE's midday break (12:30 to 15:00, 15 June to
15 September) is the one heat rule every outdoor worker in the country already knows. It becomes the identity.

## 2. Signature element: the qaylula slot on the time spine

Every operational screen draws time as a **spine** (the landing's hour scrubber, the season ribbon, the worker's shift
spine, the supervisor's crew strips, the HSE week calendar, the plan strip). Where the midday break is in force, it is
**cut into the spine as a recessed slot**: a band one step *below* the ground (`--slot`), framed by two 1 px rules,
labelled "Midday break" once. It is the only shape in the system that goes below the ground, so it reads as "work
stops here" without a sign, a hatch or a colour. Outside 15 Jun to 15 Sep the slot is not drawn on worker screens and
is a dashed labelled outline on desktop screens (journeys §0.2, P1). First fold: the landing scrubber; completion
moment: the worker's spine at the end of the story.

Second signature: **isotherm contours**. Every heat field (the 3D terrain, the season ribbon's daily peaks) carries
thin contour lines at each 1 °C, the convention of weather charts, so heat reads as measured, not decorated.

## 3. Colour

- Night ground hue 245, chroma 0.014 (tinted, never pure grey). Panels are one tonal step up, the slot one step down.
  Separation by 1 px hairlines and tonal steps; no shadows, no glass, no glow.
- **One UI colour, `--signal`** (pale cyan, hue 200): live, selected, "needs you", focus. It sits outside the heat
  ramp's hues, so it never reads as heat.
- **Heat** = `RAMP_DARK` on night, `RAMP_LIGHT` in sun (prototype/assets/heat.js): OKLCH, lightness monotonic, hue
  unwrapped (no green/cyan sweep), safe in greyscale and for colour-vision deficiency by lightness. Data only.
- **Level marks** (green, amber, orange, red) appear only as the thin scale segment and a 10 px mark beside the word.

Contrast (8-bit sRGB, computed from tokens.css):

| Pair | Night (ground / panel) | Sun (ground / panel) | Floor |
|---|---|---|---|
| ink | 16.57 / 15.50 | 18.01 / 16.48 | 4.5 |
| ink-2 | 9.55 / 8.93 | 9.59 / 8.78 | 4.5 |
| ink-3 (labels, 13 px minimum) | 5.69 / 5.32 | 6.28 / 5.75 | 4.5 |
| signal | 12.05 / 11.27 | 6.78 / 6.21 | 4.5 |
| edge (control boundaries) | 3.2 / 3.0 | 3.48 / 3.18 | 3.0 |
| level marks green / amber / orange / red | 8.18 / 11.21 / 7.62 / 5.63 on ground | 4.38 / 3.32 / 4.03 / 5.82 on ground | 3.0 (graphic) |

## 4. Typography

- **Archivo** for everything, with `font-variant-numeric: tabular-nums` (verified: "1111" and "0000" render at the
  same width). Display 400 weight, tight tracking (as the A landing); UI 500; never condensed widths for text.
- **IBM Plex Mono only for codes**: station codes, coordinates, SHA-256, commands. Target ≤ 10 % of text (C was 74 %).
- Scale: 12 · 13 · 14 · 16 · 18 · 22 · 28 · 36 · 48 · 64 · 76 px. **12 px floor** (C had 114 elements under 12 px).
  Worker: body 18, actions 22 weight 500, level word 76.
- Scripts: Noto Sans Arabic (ar), Noto Nastaliq Urdu with Naskh fallback, line height 2.5 for ur (friction §7:
  Nastaliq content area 2.5 em), Noto Sans Devanagari (hi, ne), Noto Sans Bengali (bn).

## 5. Layout and density per role (one system, five densities)

| Role | Device | Theme | Density | Layout |
|---|---|---|---|---|
| Worker | Phone, outdoors | Night; **sun mode while the sun is up** | Glance: 1 hero, 1 action, ≤ 12 text elements in the fold | One column, 440 px max, dock with "I feel unwell" + 3 tabs |
| Supervisor | Phone or tablet on site | Night; sun mode as worker | Exception-first: crew strips, 3-second status | Strips across the day; relay full-screen |
| HSE | Desktop | Night | Analytical: calendar + table | 12 columns, 88 rem max |
| Judge | Desktop (works on phone) | Night | Story: one chapter per screen, dense where evidence is | Landing hero + stepper |
| Admin | Desktop | Night | Dense table + history | 12 columns |

Inner-screen rules (from `critique/inner-screens-gap.md`): one hero object from real data owning ≥ 35 % of the fold;
one primary action; a time spine; a linking transition.

## 6. Sun mode (decision)

- **Evidence.** Positive polarity (dark on light) is more legible in bright surroundings (v1 DESIGN.md R2, Piepenbrock
  et al. 2014; *Applied Ergonomics* 2017). Ali wants the product dark. A light-sensor switch is not available: the
  `AmbientLightSensor` API is behind `#enable-experimental-web-platform-features` in Chrome and Chrome for Android and
  absent in Safari, Firefox and Samsung Internet (MDN browser-compat-data 8.1.8, 2026-11-02).
- **Decision.** Worker and supervisor phone surfaces switch to `[data-theme="sun"]` when the **sun is above the horizon
  at the site** (solar elevation from the site coordinates and the device clock, computed on the device; no sensor,
  no permission), and whenever `prefers-contrast: more`. One tap on the sun/night control overrides until the next
  local midnight. HSE, judge and admin are night only. Sun mode keeps every structure (spine, slot, scale); only the
  tokens change, so the product still reads as one.

## 7. Motion

One vocabulary: 150-240 ms, `cubic-bezier(0.2, 0, 0, 1)`, opacity and transform only. Cross-document View
Transitions (`@view-transition { navigation: auto }`) with shared names `wordmark`, `spine`, `level`. The landing
plays the day (the only autoplay); the scoreboard ticks once on arrival; everything else moves only on input.
`prefers-reduced-motion`: no animation, final frames, same layout.

## 8. 3D (ADR 0037)

The landing's IFS WBGT terrain from A (unlit, contours, sea dimmed), with C's console panels below the hero instead of
voxel columns. Budget and fallback per ADR 0037. No WebGL on worker, supervisor, HSE or admin routes.

## 9. Iconography

ISO 7010 grammar: solid silhouettes on a 24 grid, no faces, no emoji, ≤ 4 per screen, always with words and audio.
Custom glyphs are labelled untested until a comprehension test reaches ≥ 85 % correct with ≤ 5 % critical confusion
(ANSI criterion; friction §6). "I feel unwell" uses a plain medical cross, not a phone-with-cross.

## 10. Do's and don'ts

- Do give every number its provenance (proof chip or source line); don't put a tag on every row.
- Do draw time; don't write "until 17:00" without drawing it.
- Don't use a level hue in chrome or a heat hue in UI. Don't fill a level. Don't hatch.
- Don't use mono for prose or for numbers. Don't go below 12 px.
- Don't write a fake-looking real number: pending results say "scored 12 Nov" or show the pending state.
- Copy tells: verb + number ("Rest 40 min in shade every hour"); explanations go behind "Why?" or into the proof drawer.

## 11. Clone-distance gate

| Check | Result |
|---|---|
| Accent not indigo / purple gradient | PASS: pale cyan signal, outside the heat hues |
| Base font not Inter by default | PASS: Archivo, chosen for tabular figures and the width axis on the wordmark |
| Radius has a point of view | PASS: 2 px everywhere |
| Depth fork chosen | PASS: borders + tonal steps + one recessed slot; no shadows |
| ≥ 3 tokens match Linear / Stripe / Vercel / Geist | PASS: 0 (ground is blue-tinted night, not #08090a; no Geist; no gradient) |
| Signature present | PASS: the qaylula slot on every time spine + isotherm contours |
