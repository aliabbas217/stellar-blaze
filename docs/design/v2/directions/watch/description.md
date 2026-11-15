# Watch: operations console (direction C)

## For Ali, in plain English

Watch looks like the control room of a company that runs outdoor crews: one dark screen with many small, calm readings
lined up on a grid, and one thing marked as "needs attention". In the middle is a 3D map of the UAE made of 374 small
columns, one for each square of the weather forecast. Taller and brighter columns mean more dangerous heat. A clock at
the top replays Thursday 3 September hour by hour, so you can watch the coast heat up through the day. Around the map:
the eight airport stations with their day as a small line, an event log written from the data ("all 374 squares over
the heavy-work limit at 09:00", "midday ban from 12:30"), and the season scoreboard, still waiting for its 12 Nov
numbers. The crew's phone keeps the same habits (exact numbers, a status strip, a thin scale) but is light, so it can
be read in full sun. Setting up a site works like typing a command: one sentence in, a list back saying where each value
came from, one question, done.

## The 3 closest real products (opened 2026-11-11)

1. **Samsara for Safety**, https://www.samsara.com/solutions/safety : a fleet-safety operations product for people who
   run physical work. Shared: live safety events on one screen, a ranked "who needs attention" list, calm dark chrome.
2. **Anduril Lattice, Command & Control**, https://www.anduril.com/lattice/command-and-control : a mission-control
   picture that fuses many sensors onto one map. Shared: a map at the centre with labelled tracks, a timeline, and one
   signal colour for "selected / act now".
3. **Esri ArcGIS Dashboards**, https://www.esri.com/en-us/arcgis/products/arcgis-dashboards/overview : operational
   map dashboards. Shared: a map surrounded by indicator panels, lists and a log on a fixed grid.

(Samsara's old `/products/safety` URL now redirects to its dash-cam page, so the solutions page is the cited one.)

## For the builder

**Colour (OKLCH).** Console ground `0.2 0.006 250` · panel `0.235 0.006 250` · panel-2 `0.265 0.006 250` · hairline
`0.32 0.006 250` / strong `0.4 0.006 250` · ink `0.94 0.004 250` / `0.78 0.006 250` / `0.66 0.008 250` (labels; about
4.9:1 on the panel). **Signal** (live / selected / needs you) `0.84 0.075 200`, a pale air-traffic cyan; on the light
worker screen `0.5 0.085 215`. Heat colour appears only on data: `RAMP_DARK` on the console, `RAMP_LIGHT` on the crew phone.
Worker ground `0.975 0.002 250`, ink `0.2 0.006 250`. Level marks (10 to 14 px only): green `0.58 0.12 150`, amber
`0.76 0.14 80`, orange `0.66 0.16 50`, red `0.54 0.19 27`.
*Why cyan rather than the suggested sodium amber:* `RAMP_DARK` reaches hue 65 to 100 at L 0.79 to 0.95 for 38 to 40 °C,
so an amber UI accent would read as "hottest data". Hue 200 sits outside every hue either ramp uses.

**Type.** Chivo 400/500/600 for UI, Chivo Mono 400/500 for numerals, times and codes (both served by Google Fonts,
checked 2026-11-11). Scale ratio 1.125 from 12 px: 10.7 · 12 · 13.5 · 15.2 · 17.1 · 19.2 · 21.6 · 24.3. Console labels
are 11 to 12 px, uppercase only for panel labels. Two deliberate exceptions to "mono for every numeral": the 48 px focus
reading and the times inside worker sentences use Chivo with tabular figures, because Chivo Mono's wide `.` and `:`
cells read as "39 . 4" and "17 : 00" at large sizes. Crew phone: 18 px body, 64 px level word, scripts in Noto Nastaliq
Urdu / Sans Devanagari / Bengali / Arabic, each subset with `text=`.

**Space and shape.** Spacing 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64; console panel gap 8; radius 2 px; 1 px hairlines; no
shadows, no glass, no glow.

**Motion.** Only the replay moves: 0.7 replay-hours per second, the cursor and readouts follow it, and the camera is
fixed (ops screens do not spin). Paused by `?still`, `prefers-reduced-motion` and the hero leaving the viewport. Press
feedback is a 120 ms scale(0.98).

**3D budget.** three@0.186.1 from jsdelivr: `three.module.js` + `three.core.js` = 2.12 MB raw / about 420 kB gzip
(the whole library; a real build should tree-shake down to InstancedMesh, BoxGeometry, Lambert, Line and the dashed
material). Data: 92 kB field + 104 kB coast + 19 kB OMAA series. Scene: 1 InstancedMesh with **374 instances** (land
cells are columns, sea cells flat tiles), about 40 coast polylines draped over the column tops plus a ground copy,
graticule, a dashed 26.6 °C limit frame, and 8 pin stems. It renders only when the hour changes. DPR is capped at 2
(1.5 under 900 px). The 2D canvas fallback is `?fallback` or used automatically when WebGL is missing. Every number on
screen comes from the JSON files; the event log is computed from them in `index.html`.

**Known weaknesses.**
- The map fills roughly 60 % of its panel at 1440 × 900. The camera is fitted to the whole IFS box, and most of the
  north of that box is Gulf and Iran.
- At 390 the clustered stations (OMAD, OMSJ, OMDW) hide their map labels unless one of them is the focus; the station
  list still carries all eight.
- Tags and some captions are 10 to 10.7 px mono, which is dense on purpose for the console but below the 12 px floor the
  impeccable hook asks for.
- In a full-page capture at 390, the crew phone's pinned "I feel unwell" dock shows at the first-screen bottom, over the
  content. This is how the capture tool draws sticky elements; on a real phone it stays at the bottom edge.
- The setup locator draws coastline strokes only, with no land fill: the Natural Earth rings are too coarse near Abu
  Dhabi to fill (a sea point at 24.55 N tests as land).
- The 3 Sep data makes some brief events impossible: OMAA never falls below 26.6 °C that day (low 27.4 at 05:00), so
  the log reports "already over the limit at midnight" and "all 374 cells over" instead of a first crossing.
