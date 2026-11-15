# Almanac: editorial data journalism

## (a) In plain English, for Ali

Almanac looks like a serious newspaper's climate investigation. The page is cool white, like newsprint, with near-black
text. The headline is set in a confident book-style serif, and the front page shows one big, careful chart: every
hour of every summer day at Abu Dhabi airport, drawn as 139 thin ridges stacked from May at the back to September
at the front. Colour appears only on the hours that are too hot for heavy work, and it gets darker as the heat gets
worse. The rest of the chart is plain ink on paper. Small notes with pointer lines mark the hottest forecast
(39.4 °C on 3 September), the start and end of the midday ban, and the safety limit. Judges get what they trust in
the FT or Our World in Data: one finding, the evidence right under it, and a source line on every number. Workers
get the same calm voice, made large: "Red until 17:00." in big type, three short instructions with small
safety-sign pictures, the day's heat curve, and an "I feel unwell" button that is always at the bottom of the
screen. Nothing on it looks like a toy or a game. It reads like a page you would believe.

## (b) Closest real pages (opened 2026-11-11)

1. **Our World in Data, Climate Change**: https://ourworldindata.org/climate-change (HTTP 200). Shared: a light page,
   headline then charts, and every chart carries its source. That "numbers you can check" habit is the core of
   Almanac.
2. **Reuters Graphics index**: https://www.reuters.com/graphics/ (HTTP 200; it lists pieces such as "Tracking the
   seasonal fires and smog across northern India and Pakistan"). Shared: a graphics desk's grammar of a quiet ground,
   leader-line annotations and a source line under the chart. Individual story pages returned 403 to my client, so I
   only saw the index, not a full story.
3. **#ShowYourStripes (Ed Hawkins, University of Reading)**: https://showyourstripes.info/ (HTTP 200). Shared: heat
   colour used only as data, on a ramp, with almost no chrome. The crest colouring here follows that rule.

Lineage I did not open today, so it is not cited as evidence: the ridgeline ("joyplot") form comes from the pulsar
CP 1919 plot used on Joy Division's *Unknown Pleasures*.

Not shared with the other two directions: Isotherm is dark with a 3D map of the UAE; Watch is a dark operations
console. Almanac is the only light one, the only one with a serif, and its 3D is a chart over time, not a map.

## (c) For the builder

**Colour (OKLCH).** Paper `oklch(0.975 0.004 240)` (cool, not cream) · paper-2 `0.952 0.005 240` · ink
`0.21 0.016 252` · ink-soft `0.38 0.014 252` · ink-muted `0.50 0.012 252` · hairline `0.86 0.006 245` ·
strong hairline `0.72 0.008 245` · focus `0.48 0.14 252`. Heat: `RAMP_LIGHT` from `_shared/heat.js`, used only from
26.6 °C upward. Level marks (10 to 12 px squares, beside the word only): green `0.56 0.12 150`, amber
`0.76 0.15 80`, orange `0.66 0.17 50`, red `0.52 0.19 27`.

**Heat colour rule (why not colour every line).** About 78 % of hours (2,609 of 3,336) are above the NIOSH limit, so
colouring each line by value would paint the whole chart orange. Instead each ridge is an ink line with a "crest" band
under it, coloured by that hour's WBGT on `RAMP_LIGHT` and thickening with the excess over 26.6 °C. Below the limit
there is no colour at all. Colour therefore marks exactly the hours that matter, and still reads on paper (a hairline
in the ramp's pale end would vanish).

**Type.** Newsreader (Google Fonts, `opsz` 6 to 72, weights 300 to 700, italics) for headlines, the level sentence,
policy names and big numbers; Schibsted Grotesk (400 to 700) for UI, labels, captions and body. Both checked on the
Google Fonts CSS API on 2026-11-11. Scale: 12 · 14 · 16 · 18 · 22 px, then fluid display steps with `clamp()` (rem +
vw); hero headline 64 px at 1440 and 38 px at 390; worker level sentence 48 to 54 px, weight 600; worker body 18 px.
Native-script names in the language row use Noto Nastaliq Urdu, Noto Sans Devanagari, Bengali and Arabic, loaded
as `text=` subsets.

**Shape and space.** Radius 0. Borders, not shadows: a 2 px ink rule opens each section, 1 px hairlines divide rows,
and a double rule sits under the masthead. Spacing on the 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 scale.

**Motion.** The camera dollies slowly along the season (a sine over about 57 s, ±1.2 units in depth and ±0.08 rad in
azimuth), with a "Pause the camera" control. The page uses native scroll-driven reveals (`animation-timeline:
view()`); the ban outline in chapter 1 draws in as you scroll. All of this is off under `prefers-reduced-motion`
and `?still`, and without scroll-timeline support content is simply visible. No scroll-jacking.

**3D budget.** three@0.186.1 from jsdelivr: `three.module.js` 131 kB + `three.core.js` 287 kB gzip, plus 11 kB for
`Line2`/`LineMaterial`/`LineGeometry`, so about 429 kB gzip, loaded by dynamic `import()` only when WebGL exists.
Geometry: 139 fill strips × 93 points = 25,854 vertices and 25,576 triangles (one draw call, a shader colours the
crest from a 256-texel ramp texture baked from `RAMP_LIGHT`); 12,788 ink line segments (one draw call); 3 wide
`Line2` ridges (15 Jun, 3 Sep, 15 Sep); a plane and a dashed rim for the limit. DPR is capped at 2 (1.5 on phones).
Ridges are smoothed 4× with monotone cubic (Fritsch–Carlson) interpolation, so no curve ever overshoots a real
hourly value. The 2D fallback (`?fallback` or no WebGL) is a canvas ridgeline with the same crest rule and the same
annotations (`shots/landing-fallback-1440.png`).

**Known weaknesses.**
- The 3D hero only rotates the camera about 20°, so the depth is subtle. A judge may read it as a very good 2D chart.
  That is deliberate (legibility first), but it is the least "wow" of the three 3D heroes.
- At 390 px the ban annotations are hidden (only the peak and the axis remain) and the 23:00 tick sits at the edge.
  The ban is explained in chapter 1 instead.
- Annotation positions are tuned to the frozen `?still` camera. While the camera moves, the leader lines follow, but
  the 3 Sep label can cross ridges.
- The pictograms are my own ISO 7010-style drawings, not the registered ISO symbols; the rest-in-shade glyph is the
  weakest. Licensed ISO artwork is needed before production.
- Schibsted's tabular figures widen the colon and full stop, so `.num` is kept off sans text that has punctuation.
  Times in sans use proportional figures.
- On the setup page at 390 px the locator map sits below the actions, far from the Site row it belongs to.
- The level colours are a design state, as the worker footnote says; they are not derived from `RAMP_LIGHT`.
