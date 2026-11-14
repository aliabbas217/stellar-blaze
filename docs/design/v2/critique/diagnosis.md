# Diagnosis: why v1 ("Arish Signal" rev. 2) reads as a game or a UI for kids

**Date:** 2026-11-11. **Baseline:** `docs/design/prototype/` (v1, kept unchanged as the rejected baseline).
**Method:** served v1 on `127.0.0.1:8765` (stopped afterwards), captured 9 screens at 390 and 1440 px with Playwright
(`v1-screens/*.png`), and read computed styles on every visible element of each page at 1440 px (font family,
font size, background colours, radii). Numbers below are from that run unless marked [read from source].

## Verdict in three lines

1. v1 spends its loudest visual budget on **signage**: four saturated traffic-light plates with hazard hatch, a
   rimmed sign frame and a hand pictogram are the largest object on every screen, so the product looks like a
   warning sticker or a board-game tile rather than an instrument.
2. The type and surface are **poster/vernacular** (Barlow Condensed 700 headlines on cream "sand" paper, 16 px body
   everywhere, big outlined buttons), which signals "printed notice" and "friendly app", not "scientific product".
3. There is **almost no data on screen** and no imagery: placeholders, framed stamps and chrome take the space where a
   serious climate product shows dense numbers, a field, a map or a chart, so nothing carries scientific gravitas.

## Located causes (ranked by visual weight)

| # | Cause | Where (screenshot) | Evidence | Why it reads as childish |
|---|---|---|---|---|
| 1 | **Saturated four-colour level fills used as surfaces**, not as data | `index-1440` (the four 1-2-3-4 tiles above "Choose your role"); `replay-season-1440` ribbon; `supervisor-crews-1440` band cells; `worker-today-390` hero | 4 level fills at OKLCH chroma 0.13 to 0.19 (green 0.52/0.13/150, amber 0.82/0.16/85, orange 0.70/0.17/50, red 0.50/0.19/27) are present as backgrounds on 4 of 5 measured pages; the season ribbon is ~1,200 × 48 px of solid green-amber-orange-red | Fully saturated primaries in a repeating row is the visual grammar of toys, game HUDs and kids' learning apps. Serious products spend saturated colour on < 1 % of paint (measured corpus median first-accent coverage 0.7 %); v1 spends it on whole bands |
| 2 | **Hazard hatch + 2 px "sign rim" on every level element** | `worker-today-390` (red plate with a hatched border), `supervisor-relay-390`, `index-1440` tile 4, crew band cells | Diagonal and cross-hatch patterns at 4 densities on orange/red/amber cells | Hatching inside a coloured tile looks like candy wrapping or a board-game square; on a dense band it becomes visual noise that competes with the numbers |
| 3 | **Oversized pictograms used as decoration** | `worker-today-390` (hand icon inside the hero, shade/cup/people icons in framed squares), `index-1440` (calendar/people/eye icons heading three cards) | 22 to 25 inline SVGs per page; icons drawn in a 24-grid 2 px outline style in framed beige squares | Rounded outline icons in tinted squares are the generic "feature card" kit; a raised hand inside a red plate reads like a stop-sign sticker for children |
| 4 | **Condensed poster display type** | Every heading: "Summer 2026, replayed honestly", "Crews today", "STELLAR BLAZE" wordmark | Barlow Condensed 600/700 at 25 to 95 px on every page (14 to 51 elements per page); the level word "RED" and numeral "4" in 700 condensed | Bold condensed grotesk is road-sign and sports-poster type; paired with flat primaries it reads as signage or a game scoreboard. Scientific/editorial products use a precise grotesk or a serif with restrained weights |
| 5 | **Cream "warm paper" surface** | All pages | Page `oklch(0.975 0.012 80)`, raised `oklch(0.95 0.02 80)`; the impeccable detector already flagged `cream-palette` on every page in v1's own gate | Cream + flat primaries is the generic "friendly, hand-made" AI default; it removes the cool, measured feel of instruments and atlases |
| 6 | **Big framed controls and stamps** | `index-1440` "Start the judges' replay" teal slab button; `replay-season-1440` four framed stamps in a row; "Listen" outlined button | 2 px ink frames around stamps, chips, buttons, cards and the verdict block; `rounded` 0/2 px everywhere | Many equal-weight framed boxes = the "sticker sheet" look; no hierarchy between the outcome and the labels about the outcome |
| 7 | **No data density** | `replay-season-1440`: first fold is a title, a paragraph, four stamps, a placeholder sentence, a ribbon of fake colours | 16 px body is the dominant size on every page (69 to 209 elements); the largest number on the season page is a placeholder; first fold at 1440 shows **zero real numbers** | Judges see words about evidence instead of evidence. Scientific products lead with a field, a chart or a number set in tabular figures |
| 8 | **No imagery, no geography, no physical world** | All pages | 0 raster images, 0 maps, 0 fields; the UAE never appears visually | Weather/climate intelligence products (Windy, nullschool, ECMWF charts, Climate Pulse) earn gravitas from the physical field itself. v1 shows a heat product without heat or place |
| 9 | **Role-picker landing ("Choose your role") as the front door** | `index-1440` | Three equal cards with icons + a list of every view | A role picker is a prototype index, not a product front page; it looks like an onboarding screen of a consumer app |
| 10 | **Prototype chrome in every capture** | Dashed control bar at the top of all pages, mono font | `ui-monospace` used for the control bar on every page | Fine for review, but it cheapens every screenshot; v2 hides prototype controls behind a single toggle |

## What v1 got right (keep)

- The **information architecture and the honesty mechanics**: provenance on every number, pre-registration, the
  governance refusal next to the worker's audit row, the "fewer than k" rule, the clause-cited plan. These are the
  substance; the redesign changes the skin and the front door, not the claims.
- **Redundant coding** of level (never colour alone) and **RTL/Nastaliq** handling.
- The **hour band** as an idea (one cell per hour) is sound; its *styling* (saturated hatched tiles) is the problem.

## Implications for v2 (what every direction must do)

1. Heat colour lives **only in data** (a field, a chart mark, a band), from a perceptual ramp; chrome is neutral.
2. Danger is shown the way serious products show it: a **number + a word + position on a scale**, with colour as a
   thin accent, not a filled plate. No hatch.
3. A precise type system with tabular figures for data; no condensed poster type.
4. The landing shows the **physical field** (the UAE, real IFS-derived WBGT) and the **scoreboard** in the first
   two scrolls; the role picker moves into navigation.
5. Pictograms become **adult safety-sign conventions** (ISO 7010 solid silhouettes, small), not decorative icons.
6. Worker screen: large but adult. One focal reading, one instruction, one action; no sticker frames.
