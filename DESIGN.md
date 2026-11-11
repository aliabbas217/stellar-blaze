---
version: alpha
name: Arish Signal
description: >-
  Visual identity for Stellar Blaze, a heat-stress safety app for outdoor workers in the UAE.
  Gulf shade meets industrial signage. Light-theme semantic values; the dark theme is described
  in the Colors section and lives in frontend/src/styles/tokens.css.
colors:
  primary: "oklch(0.5 0.08 205)"
  on-primary: "oklch(1 0 0)"
  surface: "oklch(0.975 0.012 80)"
  surface-raised: "oklch(0.95 0.02 80)"
  ink: "oklch(0.17 0.015 60)"
  ink-muted: "oklch(0.42 0.035 65)"
  hairline: "oklch(0.83 0.04 76)"
  control: "oklch(0.6 0.045 70)"
  focus: "oklch(0.42 0.07 208)"
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
  # lineHeight is quoted on purpose: @google/design.md 0.4.0 silently drops an unquoted numeric lineHeight.
  # headline and title have none: they inherit the locale line height (1.5, 1.8 for ar, 2.1 for ur).
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
    typography: "{typography.body}"
    rounded: "{rounded.sign}"
    padding: 16px
  caption:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.title}"
    rounded: "{rounded.sign}"
    height: 48px
    padding: 12px
  level-green-badge:
    backgroundColor: "{colors.level-green}"
    textColor: "{colors.on-level-green}"
    typography: "{typography.title}"
    rounded: "{rounded.sign}"
    padding: 12px
  level-amber-badge:
    backgroundColor: "{colors.level-amber}"
    textColor: "{colors.on-level-amber}"
    typography: "{typography.title}"
    rounded: "{rounded.sign}"
    padding: 12px
  level-orange-badge:
    backgroundColor: "{colors.level-orange}"
    textColor: "{colors.on-level-orange}"
    typography: "{typography.title}"
    rounded: "{rounded.sign}"
    padding: 12px
  level-red-badge:
    backgroundColor: "{colors.level-red}"
    textColor: "{colors.on-level-red}"
    typography: "{typography.title}"
    rounded: "{rounded.sign}"
    padding: 12px
  level-green-chip:
    backgroundColor: "{colors.level-green-soft}"
    textColor: "{colors.on-level-green-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.sign}"
    padding: 8px
  level-amber-chip:
    backgroundColor: "{colors.level-amber-soft}"
    textColor: "{colors.on-level-amber-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.sign}"
    padding: 8px
  level-orange-chip:
    backgroundColor: "{colors.level-orange-soft}"
    textColor: "{colors.on-level-orange-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.sign}"
    padding: 8px
  level-red-chip:
    backgroundColor: "{colors.level-red-soft}"
    textColor: "{colors.on-level-red-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.sign}"
    padding: 8px
  rule-hairline:
    backgroundColor: "{colors.hairline}"
    height: 1px
  rule-control:
    backgroundColor: "{colors.control}"
    height: 2px
  focus-ring:
    backgroundColor: "{colors.focus}"
    size: 3px
---

## Overview

**Arish Signal.** The *arish* is the palm-frond canopy of the Gulf: a roof of slats that throws a hard-edged, striped
shadow, and the first thing a worker looks for at noon. Industrial safety signage supplies the other half: hazard
hatching, big plain numerals, flat shapes with cut corners. The product is a sign you can read in glare, with gloves on,
in a second language.

**Three adjectives.** Unmistakable at arm's length. Calm under pressure. Field-tough.

**Signature element: the shade band.** Each forecast hour is a cell. The diagonal hatch in the cell encodes the level:
none for green, sparse for amber, medium for orange, dense cross-hatch for red, like shade slats or hazard tape. Every
cell also carries the level numeral, so the band reads without colour, in sunlight glare, and in print.

**What it is not.** Not SaaS. No indigo, no Inter, no soft glass cards, no gradient hero, no drop shadows, no rounded
pills. The only saturated colours in the product are the four level fills, so colour always means a level.

**Source of truth.** The values above are the normative light-theme set. `frontend/src/styles/tokens.css` implements
them (and the dark theme) as CSS variables; `frontend/src/styles/globals.css` names them for Tailwind. Components use
only the semantic names below, never a raw value.

## Colors

All colours are authored in OKLCH, and every value is inside the sRGB gamut. The ramps are tinted, not grey: the
neutral is *sand* (hue 60 to 80), the single action hue is *falaj* (the teal of the aflaj irrigation channels, hue 205),
and the four level hues are the traffic-signal set (green 150, amber 85, orange 50, red 27).

| DESIGN.md name | CSS variable | Tailwind classes | Light role |
|---|---|---|---|
| `surface`, `surface-raised` | `--surface`, `--surface-raised` | `bg-surface`, `bg-surface-raised` | page, and one tonal step up |
| `ink`, `ink-muted` | `--ink`, `--ink-muted` | `text-ink`, `text-ink-muted` | text |
| `hairline` | `--hairline` | `border-hairline` | decorative divider, 1 px |
| `control` | `--control` | `border-control` | the edge of an input or toggle, 2 px |
| `primary`, `on-primary` | `--action`, `--on-action` | `bg-action`, `text-on-action` | the one action colour (`primary` is the linter's name for it) |
| `focus` | `--focus` | `outline-focus` | focus ring, 3 px, 2 px offset |
| `level-{l}`, `on-level-{l}` | `--level-{l}`, `--on-level-{l}` | `bg-level-{l}`, `text-on-level-{l}` | level fill and the text on it |
| `level-{l}-soft`, `on-level-{l}-soft` | `--level-{l}-soft`, `--on-level-{l}-soft` | `bg-level-{l}-soft`, `text-on-level-{l}-soft` | quiet tint for chips and rows |

where `{l}` is `green`, `amber`, `orange` or `red`. Primitives (`--ref-sand-50` and so on) exist only in `tokens.css`
and are referenced only by the semantic tier.

### Contrast (WCAG 2.2, measured on the 8-bit sRGB values a browser renders)

| Pair | Light | Dark |
|---|---|---|
| `ink` on `surface` | 17.80 | 17.80 |
| `ink-muted` on `surface` / on `surface-raised` | 7.94 / 7.37 | 11.28 / 9.74 |
| `control` edge against `surface` / `surface-raised` (needs 3.0) | 3.69 / 3.43 | 4.82 / 4.16 |
| `on-primary` on `primary` | 5.79 | 10.58 |
| `focus` against `surface` | 7.67 | 10.58 |
| `on-level-green` on `level-green` | 5.18 | 5.18 |
| `on-level-amber` on `level-amber` | 10.82 | 10.82 |
| `on-level-orange` on `level-orange` | 6.78 | 6.78 |
| `on-level-red` on `level-red` | 6.63 | 6.63 |
| `on-level-{green,amber,orange,red}-soft` on its soft fill | 7.97 / 6.55 / 6.35 / 7.44 | 12.40 / 12.68 / 12.84 / 12.95 |
| level fill against `surface` (graphic edge, needs 3.0) | 4.81 / 1.65 / 2.63 / 6.16 | 3.70 / 10.82 / 6.78 / **2.89** |

Two things in that table are known and deliberate, not silent. The bold value, the red fill's edge on the dark page,
sits a hair under 3:1 and is open for the human gate. The amber and orange fills also have a low edge contrast against
the light page. Neither breaks WCAG 1.4.1 or 1.4.11 because the level is never carried by the fill alone (see Do's and
Don'ts), but they are the first things to revisit if a token value changes.

The text pairs, the `control` and `focus` edges, and the DESIGN.md-to-CSS parity are pinned by
`frontend/tests/unit/styles/tokens.test.ts`, and `pnpm design:lint` fails on any linter warning (the stock CLI exits 0
on a contrast warning). Edit a value in `tokens.css` and this file together, or the tests fail.

### Dark theme

Selected by `[data-theme="dark"]` on any element, and by the system preference when no override is set. Same semantic
names, swapped values: `surface` is sand-950 and `surface-raised` sand-900; `ink` is sand-50 and `ink-muted` sand-300;
`hairline` is sand-700 and `control` is sand-500, the same primitive as in light, because sand-600 fell to 2.99 on a
raised dark surface; `primary` becomes the light falaj (`oklch(0.8 0.08 198)`) with sand-950
text; `focus` is the same light falaj. The level fills and their on-colours do not change. The soft tints become a
dark tint of the same hue (`oklch(0.3 0.05 h)`) with sand-50 text.

### The hatch

The hatch colour is the cell's own `on-level-{l}` colour at 35 percent, mixed in OKLCH, so it follows the level and the
theme. At that strength the hatch line against the fill is only 1.9 to 2.1:1, and the on-colour over a hatch line
drops to 3.5:1 for orange and red. **Text and numerals therefore never sit directly on a hatch.** They sit on a solid
plate of the level fill, and the hatch runs past the plate's edge (a badge) or above and below it (a band cell).

## Typography

Two families per locale: **Barlow Condensed** (600 and 700, SIL OFL, signage-derived) for numerals and headings, and
one **Noto** family per script for everything else. Barlow Condensed covers Latin and digits only, so in every other
script a heading falls through to the locale body family.

| Locale | Script | Body family | Direction |
|---|---|---|---|
| en | Latin | Noto Sans | ltr |
| ar | Arabic | Noto Sans Arabic | rtl |
| ur | Arabic (Nastaliq) | Noto Nastaliq Urdu, fallback Noto Naskh Arabic | rtl |
| hi, ne | Devanagari | Noto Sans Devanagari | ltr |
| bn | Bengali | Noto Sans Bengali | ltr |

Digits are always Western (`0-9`) in every locale, for times, temperatures and level numerals.

Scale (major-third steps, with a jump for display; rem, so browser text zoom works). No text is smaller than 14 px.

| Token | Size | Tailwind | Family | Use |
|---|---|---|---|---|
| `numeral` | 4.768rem | `text-4xl` | Barlow Condensed 700 | the one big number on a screen |
| `display` | 3.052rem | `text-3xl` | Barlow Condensed 700 | level numeral in a badge |
| `headline` | 1.953rem | `text-2xl` | Barlow Condensed 600 | screen heading |
| `title` | 1.5625rem | `text-xl` | Barlow Condensed 600 | section heading, button label |
| `lead` | 1.25rem | `text-lg` | Noto body | the sentence that matters |
| `body` | 1rem | `text-base` | Noto body | running text |
| `label` | 0.875rem | `text-sm`, `text-xs` | Noto body | captions, hour labels |

Line height is 1.5 for body text, 1.8 under `:lang(ar)` and 2.1 under `:lang(ur)` (Nastaliq clips at 1.5). The text
steps set no line height of their own, so headings and titles inherit the locale value. Only `numeral` and `display`
set `1` (`leading-solid`), because they hold Western digits; never put `leading-solid` on text that can be Arabic-script
or Indic. Text containers never get a fixed height; use `min-height`.

Tracking (0.025em on `headline` and `title`, class `tracking-signage`) is for uppercase Latin only. It resolves to 0 in
every non-English language: browsers drop or break the joins of spaced Arabic-script text, and typographers report
that spacing cuts the joined top bar of Devanagari and Bengali (the Indic part is a precaution, not a confirmed browser
behaviour).

## Layout

A 4 px grid. The allowed spacing steps are the Tailwind steps 1, 2, 3, 4, 6, 8, 12, 16 and 24 (4, 8, 12, 16, 24, 32,
48, 64, 96 px). Mobile first, designed at 390 px wide, one column. A 16 px page gutter.

On the worker route group every interactive target is at least 44 px square (gloved hands; this is design judgement
above the WCAG 2.2 floor of 24 px). Layout uses logical properties only (`ms-*`, `pe-*`, `text-start`, `start-0`) so
the screen mirrors for Arabic and Urdu, and the shade band flows in the reading direction.

The shade band is one row of equal cells with a 2 px gap, one cell per forecast hour, each at least 4.5 rem tall, with
the hour label under the cell (not on it). The current hour's label is inverted (`ink` on `surface`).

## Elevation & Depth

There are no shadows. Depth is a 1 px hairline plus a tonal step: `surface-raised` sits one step off `surface`, and a
card is `surface-raised` with a `hairline` edge. Interactive controls are drawn with a 2 px `control` edge. The focus
ring is 3 px `focus` with a 2 px offset and appears on every `:focus-visible` element.

Motion is limited to a 150 ms opacity change on a state change, and is 0 ms under `prefers-reduced-motion`.

## Shapes

Cut-sign corners: a single 2 px radius (`rounded-sign`) on everything, including the shadcn components, whose own
radius classes are remapped to it. 2 px rules. Pictograms are drawn on a 24 unit grid with a 2 unit stroke, mitred
joins and square caps, so they read as signage rather than as a friendly icon set.

| Level | Pictogram | Hatch |
|---|---|---|
| green | sun with a check | none |
| amber | water drop | sparse, 135 degrees, 12 px pitch |
| orange | shade canopy | medium, 135 degrees, 7 px pitch |
| red | raised hand | dense cross-hatch, 135 and 45 degrees, 6 px pitch |

The pictogram set has not been tested with workers. Test it with native speakers before a pilot and claim nothing
about comprehension until then.

## Components

- **Level badge** (`level-*-badge`): solid level fill, `on-level-*` text, a pictogram, the numeral in `display`, the
  level name in `title`. The hatch fills the badge and a solid plate carries the content.
- **Level chip** (`level-*-chip`): the soft tint with its ink, for rows and secondary mentions. Never the only
  carrier of the level; it keeps the numeral or the name.
- **Primary button** (`button-primary`): `primary` fill, `on-primary` text, 48 px tall, `title` type. One per screen.
- **Shade band**: described under Layout; each cell is a level fill with the pattern, a solid numeral plate, and an
  accessible name that gives the hour, the level name and the numeral.
- **Card**: `surface-raised`, hairline edge, 16 px padding, 2 px radius.

## Do's and Don'ts

- Do show every level with colour, hatch, pictogram, numeral and text. Never colour alone (WCAG 1.4.1).
- Don't put text or numerals directly on a hatch. Put them on a solid plate.
- Do use logical properties only: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`. Don't use
  `ml-*`, `mr-*`, `pl-*`, `pr-*`, `left-*`, `right-*`, `text-left`, `text-right`, `rounded-l-*`, `rounded-r-*`.
- Do render times, temperatures and numerals with Western digits in every locale.
- Don't apply letter-spacing to Arabic-script text (or Devanagari and Bengali). Use `tracking-signage`, not `tracking-wide`.
- Don't put `leading-solid` on anything but digits and Latin display words.
- Don't put a hex or OKLCH literal in a component, and don't read a `--ref-*` primitive from one. Use the semantic names.
- Don't use `dark:` variants in components. The theme swap happens in the tokens; a component has one set of classes.
- Don't add a drop shadow, a gradient background, a second corner radius or a second accent colour.
- Don't use a level colour for anything that is not a level. Teal (`primary`) is the only other saturated colour.
- Do keep targets at least 44 px on the worker routes, and never give text a fixed height.
- Do keep the focus ring visible; never remove an outline without replacing it.
- Don't invent safety-action wording in a component. Action text comes from the reviewed message templates.
