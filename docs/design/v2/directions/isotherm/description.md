# Direction A: Isotherm (the scientific instrument)

## In plain words

Isotherm looks like the screen of a weather scientist's instrument. The front page is dark and quiet, and the only
colour on it is the heat itself: a slowly turning 3D landscape of the UAE where the height and colour of the ground
show how dangerous the heat is, hour by hour, through one real summer day, with thin contour lines like a weather
chart. The words are set in a clean, precise typeface and every number is in a typewriter-style face, so it reads
as measurement, not marketing. The worker's phone screen keeps the same calm: white for direct sun, one big word for
the level ("Red"), a thin scale underneath instead of a coloured sign, three plain instructions with small
safety-sign symbols, and a small chart of the day. The site setup is one sentence; the screen then shows, line by
line, what it understood and where each answer came from, and asks one question back.

## The three closest real products

| Product | What we share |
|---|---|
| earth.nullschool.net (https://earth.nullschool.net) | A dark ground where the physical field is the only colour; tiny monospaced readouts; the data is the hero |
| Windy (https://www.windy.com) | An hour timeline under the map that plays the day; model and provenance next to the reading; a labelled colour key |
| NWS HeatRisk (https://www.wpc.ncep.noaa.gov/heatrisk/) | Danger shown as level number + word + position on a scale whose lightness steps down monotonically; the only colour-blind-safe heat legend in our reference set |

Evidence for each: `../../research/references.md` entries R01, R03, R08 (screenshots in `../../research/refs/`).
ECMWF charts (contour-line convention) was the intended third, but its site served a bot challenge to our capture.

## Screens

| Screen | File | Shots |
|---|---|---|
| Judge landing, 3D hero | `index.html` (`?still&h=14` freezes the hour; `?fallback` forces the 2D map) | `shots/landing-1440.png`, `shots/landing-390.png`, full pages `*-full.png`; motion stills `shots/motion-h6/h10/h18-1440.png`; 2D fallback `shots/fallback-*.png` |
| Worker Today | `worker.html` | `shots/worker-390.png`, `shots/worker-1440.png` |
| Zero-form site setup | `setup.html` | `shots/setup-1440-full.png`, `shots/setup-390.png` |

## For the builder

- **Colour (OKLCH).** Dark ground 0.155 0.012 255, raised 0.19, ink 0.94, ink-2 0.74, ink-3 0.58, hairline 0.32,
  strong hairline 0.45, focus 0.86 0.12 85 (the only chromatic UI colour). Worker (sun-first): ground 0.985 0.002 255,
  ink 0.18. Level marks only on the thin scale: green 0.58 0.12 150, amber 0.78 0.14 82, orange 0.66 0.17 48,
  red 0.53 0.19 27. Heat colour = `RAMP_DARK` / `RAMP_LIGHT` (OKLCH, monotonic lightness, hue unwrapped) only on data.
- **Type.** Archivo (variable width; 400 for display at 60 px, wordmark at width 118 + 0.14 em tracking) and IBM Plex
  Mono 400/500 for every number, time and code, tabular figures. Worker body 18-19 px, level word 76 px.
- **Shape and depth.** Radius 2 px, hairline borders, no shadows. The 3D surface is unlit on purpose: lighting would
  change the encoded colour, i.e. the value.
- **Motion.** The hero plays the day at 1.4 h/s and orbits at 0.025 rad/s; it pauses off screen; reduced motion and
  `?still` freeze it. Hour scrubber is a keyboard slider.
- **3D budget (measured 2026-11-11).** three.js 0.186.1 (one module from jsdelivr) + 92 kB field JSON + 104 kB coast
  JSON; 5,525 vertices (85 × 65) desktop, 1,419 phone; isotherms by marching squares each hour change (≤ 24,000
  segments buffer). Lighthouse 13.5.0 mobile, local server: **performance 88 with WebGL, 94 on the 2D fallback**;
  accessibility 100 / 100; LCP 2.9 s / 2.1 s; TBT 60 ms / 0 ms; CLS 0.101 (web-font swap: fix with `size-adjust`
  fallback metrics or self-hosted fonts via `next/font`); transfer 741 kB / 675 kB.
- **Data.** `../../prototype/data/uae_ifs025_d1_wbgt_2026-09-03.json` (374 IFS 0.25° cells × 24 h, day-1 forecasts,
  Liljegren WBGT from `stellar_blaze.domain.physics.wbgt`), `omaa_2026_ifs_d1_wbgt_hourly.json` (139 days).

## Known weaknesses

- The coast mask is not applied: sea cells are drawn like land, which is physically valid for WBGT but may confuse;
  a land mask (or dimming the sea) is a one-hour change.
- Station labels can collide (OMDB, OMSJ, OMDW are within 0.5°); three are hidden today.
- Fonts other than Plex Mono and Archivo are not yet checked for Urdu Nastaliq line height on this worker layout.
