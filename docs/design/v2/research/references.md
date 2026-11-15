# Stellar Blaze v2: design reference evidence

**Captured:** 2026-11-11 · **Purpose:** evidence (real screenshots plus measurements) for the v2 redesign. Companion to
[`../critique/diagnosis.md`](../critique/diagnosis.md) (why v1 reads as a toy). This file records what was observed and
measured; it does not choose a direction.

**Scope:** 25 numbered references (30 URLs, 36 screenshots) plus 3 minor captures (3 screenshots) and 1 shell-only capture
of a failed source (ECMWF). The 40 files live in [`refs/`](refs/) (all under 270 KB, JPEG q80). Desktop is 1440×900; mobile is 390×844 where marked. Nothing here was captured from a logged-in session.

## Corrections to the brief (conventions and evidence won)

1. **"Perceptual heat ramps" is not what the field does.** Of the 7 temperature or severity legends I analysed (table in
   section 6), only the NWS HeatRisk categorical scale has monotonic lightness. Every continuous temperature legend I
   measured (Zoom Earth, NASA Worldview, Columbia) rises and falls in lightness (a hump around yellow). A perceptual
   ramp is the right call on the science, but it is a departure from convention and none of these references demonstrates one.
2. **Several named targets did not yield usable evidence.** Climate Pulse never loaded (45 s and 90 s timeouts, blank
   white), ECMWF Charts rendered only its shell, Awwwards returns 403 to headless, and there was no capturable Reuters /
   Bloomberg / NYT / FT heat piece (index pages only, or paywalled). I substituted Tomorrow.io's own heat-wave story,
   FlowingData (which embeds an NYT chart), OWID, Globaia and Columbia. Details in section 5.
3. **Apple:** `https://www.apple.com/watch/health/` redirects to `https://www.apple.com/watch/` (the lineup page). No Apple
   Weather page was captured. Apple is weak evidence for data UI and is kept only for its type scale.
4. **getdesign.md has no weather, climate or map product** in its 550+ catalogue. The two DESIGN.md files I pulled
   (Oura, Sentry) are counter-examples: Oura is the cream paper canvas (`#f7f1e8`) the v1 diagnosis rejected, and Sentry
   is the sticker-mascot / lime look. getdesign.md's own site is set in Geist (Vercel's family), so the "no Linear / Stripe /
   Vercel default" rule applies to it too.
5. **Ops-vendor marketing pages carry almost no data.** Samsara, Palantir, Anduril, Kenzen and SlateSafety show 10 to 35
   text elements in the first viewport and 0 to 5 numeric ones. They are evidence for tone and type, not for dense
   supervisor UI. The dense-UI evidence is the map and science sites (Windy, Zoom Earth, Ventusky, Worldview, NWS).
6. **Gap:** no reference shows a forecast-vs-observation scoreboard (the judge view). The NWS HeatRisk nav has a
   "Verification" tab (visible in `refs/nws-heatrisk.jpg`); I did not open it. Worth a follow-up capture.

## 1. Method

- **Capture:** Playwright 1.63 / headless Chromium (bundled) from `C:\Users\LEGION\.claude\tools\design-gate`, WebGL via
  SwiftShader (CPU), user-agent string spoofed as Chrome 130 (engine is the bundled Chromium), `en-US` locale, 4 to 18 s settle per page, cookie banners dismissed when a
  button matched. Scripts are in the session scratchpad, not in this folder.
- **Computed styles:** for every element intersecting the first viewport (cap 6,000) I read font family, size, weight,
  letter-spacing, text-transform, colours, `font-variant-numeric`, canvas and SVG counts. "Chars" means characters of
  own-text weighted by element, so it is a usage measure, not a count of elements.
- **"Loud paint":** share of screenshot pixels with HSV saturation > 0.55 and value > 0.35 (3× downsampled). It includes
  photos and map fields; read it with the page type in mind.
- **Legend analysis:** pixels sampled from the screenshot legend (3×3 mean), converted sRGB to CIELAB; "monotonic" is the share
  of adjacent steps whose L* does not reverse; ΔE is CIE76; colour-blind simulation is Machado et al. 2009 at severity
  1.0 applied in linear RGB. JPEG sampling makes small ΔE values approximate (about ±2).
- **Motion / weight / timing:** two or three screenshots 0.6 s apart (share of pixels whose max channel changed by more
  than 24), Chrome DevTools `Network.loadingFinished` for bytes and request count, `largest-contentful-paint` and `paint`
  observers. Headless SwiftShader on one laptop: relative comparisons are meaningful, absolute milliseconds are inflated.

## 2. Index

| # | Reference | Captured URL | Shot(s) | One-line takeaway |
|---|---|---|---|---|
| R01 | Windy | `https://www.windy.com/25.200/55.270?temp,25.200,55.270,6` | `windy`, `windy-m` | Densest forecast grid in the set; brand red chrome fights the orange field |
| R02 | Ventusky | `https://www.ventusky.com/?p=25.2;55.3;7&l=temperature-2m` | `ventusky`, `ventusky-m` | Dark pill chrome, day+hour strips; 14-step legend collapses under deuteranopia |
| R03 | earth.nullschool.net | `https://earth.nullschool.net/#current/wind/surface/level/overlay=temp/orthographic=-303.50,25.00,1700` | `nullschool` | 5 canvases, 17 characters of UI, 9 requests, LCP 1.5 s: the cinematic-but-fast benchmark |
| R04 | Zoom Earth | `https://zoom.earth/maps/temperature/#view=25.2,55.3,6z` | `zoom-earth` | City value pills on the field, model + resolution shown in chrome |
| R05 | NASA Worldview | `https://worldview.earthdata.nasa.gov/?v=40,15,75,38&l=Reference_Labels_15m,Reference_Features_15m,Coastlines_15m,MODIS_Terra_Land_Surface_Temp_Day,BlueMarble_NextGeneration&t=2026-11-09-T00%3A00%3A00Z` | `nasa-worldview` | Dark instrument panel, honest data holes, rainbow legend (what not to ramp) |
| R06 | NASA Earth Observatory | `https://earthobservatory.nasa.gov/world-of-change/global-temperatures` | `nasa-earth-observatory` | Baseline-labelled diverging anomaly legend, plain grotesk page |
| R07 | UAE National Center of Meteorology | `https://www.ncm.gov.ae/` | `ncm-uae` | The local authority's warning vocabulary: RTL, amber tag + ticker, radar palette |
| R08 | NWS HeatRisk | `https://www.wpc.ncep.noaa.gov/heatrisk/` | `nws-heatrisk` | 0 to 4 + name + impact sentence + population count; lightness descends monotonically |
| R09 | Heat.gov (NIHHIS) | `https://www.heat.gov/` | `heat-gov` | Government science tone: hairline lists, navy headings |
| R10 | Climate Central, Climate Shift Index | `https://www.climatecentral.org/climate-shift-index` | `climate-central-csi` | Light serif display on navy + humanist sans; yellow only on the donate chip |
| R11 | Tomorrow.io heat-dome story | `https://info.tomorrow.io/heatdome/story` | `tomorrow-heatdome-story`, `tomorrow-heatdome-scroll` | Best severity-bar and scrollytelling reference; condensed 900 headline is the v1 problem |
| R12 | Tomorrow.io product | `https://www.tomorrow.io/` | `tomorrow-io` | Black hero, condensed uppercase, one blue CTA; hero media absent in capture |
| R13 | Our World in Data | `https://ourworldindata.org/grapher/temperature-anomaly` | `owid-temperature` | One accent series, grey uncertainty bounds, title / definition / source / note stack |
| R14 | FlowingData (embedding an NYT chart) | `https://flowingdata.com/2026/09/15/hotter-days-and-more-of-them/` | `flowingdata-hotter-days` | Yellow-to-red ramp only on data, direct labels, no legend box |
| R15 | Globaia, Wet-Bulb Globe Temperature | `https://globaia.org/wbgt/` | `globaia-wbgt` | On-topic WBGT explainer; serif display, hairline cards, data citation line |
| R16 | Columbia, wet-bulb map | `https://blogs.ei.columbia.edu/wp-content/themes/sotp-foundation/dataviz/heat-humidity-map` | `columbia-wetbulb` | Pastel sequential legend on a pale-grey globe; open-ended bounds |
| R17 | #ShowYourStripes | `https://showyourstripes.info/` | `showyourstripes` | One stripe per period, no axes; provenance table under the graphic |
| R18 | Samsara | `https://www.samsara.com/` | `samsara`, `samsara-m` | Warm-grey neutrals + one amber; wide uppercase display is the toy-adjacent part |
| R19 | Kenzen | `https://www.kenzen.com/` | `kenzen`, `kenzen-m` | Heat-stress wearable competitor; calm mixed-case extended grotesk, duotone photo, no data |
| R20 | SlateSafety | `https://www.slatesafety.com/` | `slate-safety` | Heat-stress competitor; techno display type on black reads sci-fi / game |
| R21 | Palantir (AIP, Foundry) | `https://www.palantir.com/platforms/aip/`, `https://www.palantir.com/platforms/foundry/` | `palantir-aip`, `palantir-foundry` | Zero chroma, single-weight grotesk at 100 px, 10 px hairline captions |
| R22 | Anduril Lattice | `https://www.anduril.com/lattice` | `anduril-lattice` | Partial capture (hero video not decoded); 15 px regular nav, one lime accent |
| R23 | Apple Watch | `https://www.apple.com/watch/health/` (redirects to `/watch/`) | `apple-watch-health`, `apple-watch-health-m` | 80 px / 600 / -1.2 px display, 6 sizes total, 88% neutral |
| R24 | getdesign.md (+ Oura, Sentry DESIGN.md) | `https://getdesign.md/`, `https://getdesign.md/design-md/oura/preview.html`, `https://getdesign.md/design-md/sentry/preview.html` | `getdesign-md`, `getdesign-oura-preview`, `getdesign-sentry-preview` | Catalogue has no climate product; the two pulled systems are counter-examples |
| R25 | Galleries: Godly, Lapa Ninja, Siteinspire | `https://godly.website/`, `https://www.lapa.ninja/`, `https://www.siteinspire.com/` | `godly`, `lapa-ninja`, `siteinspire` | Indexes of other people's work; nothing to measure beyond their neutral chrome |

Minor captures (section 4): Meteomatics, The Pudding, FT Visual and data journalism.

### 2.1 Corpus measurements at a glance

| Page type | Pages | Loud-paint share | Reading |
|---|---|---|---|
| Non-field pages (marketing, editorial, galleries, chart pages) | 25 captures | **median 0.9%**, max 9.7% (Anduril photo) | Consistent with the 0.7% median quoted in `diagnosis.md` (different metric, same order of magnitude) |
| Field / map views | nullschool 91.7, Windy 75.4, Zoom Earth 63.5, Worldview 36.2, Show Your Stripes 17.9, Ventusky 15.2, NCM 11.6, NWS 11.2 | 11 to 92% | In every case the saturated area is the data; chrome is neutral or dark (exception: Windy's red bar) |
| v1 (from `diagnosis.md`) | 9 screens | saturated fills as surfaces on 4 of 5 measured pages | Heat colour spent on whole bands of chrome rather than on data |

---

## 3. Entries

Each entry: **Shot** · **URL** · **Captured** 2026-11-11, then the measured and observed principles under the headings that
apply, ending with Steal / Don't steal.

### R01 Windy

![Windy desktop](refs/windy.jpg) ![Windy mobile](refs/windy-m.jpg)

**URL:** `https://www.windy.com/25.200/55.270?temp,25.200,55.270,6` · **Captured:** 2026-11-11 (1440×900 and 390×844)

- **Type scale:** body is the system UI stack (`-apple-system`) 14 px / 400; 14 distinct sizes from 6.5 to 25 px, the
  big four are 12, 13, 14, 14.3 px. 1,338 of 1,368 characters are weight 400 (the rest 700). No mono, no
  declared `tabular-nums`; numerals are aligned by the grid, not by the font.
- **Density:** 385 text elements and 279 numeric ones in the first viewport, 10 table rows. The bottom panel is a
  5-day × 8-column (3-hourly) meteogram with rows Temperature °C, Feels like, Rain mm, Wind kt, Wind gusts kt, Wind dir,
  Warnings. This is the densest first fold in the set.
- **Colour restraint:** 75.4% loud paint desktop (55.9% mobile): the orange-red field is the whole map. The chrome then
  adds a brand-red bottom bar (`#9d0300`) and a gold "Go Premium" chip, so the hot field and the brand colour collide.
  Wind-speed cells in the grid carry their own green-cyan-yellow ramp, a second ramp inside the same screen.
- **Severity without a toy look:** forecast confidence is a number ("80% predictability", "90% predictability") in a
  small green pill above each day; a "Warnings" row carries one line of text under a thin amber rule; "Weather warnings"
  is an amber circle button. No filled danger plates.
- **Motion:** only the particle streaks move: 4.3 to 5.0% of pixels change per 0.6 s; all UI is static.
- **3D / map and degradation:** flat WebGL map canvas (1440×900) plus a separate 1200×191 canvas for the forecast graph.
  Mobile keeps both: map shrinks to the top ~55% (0 to 470 of 844 px) and the forecast rows sit below (11 / 12 px).
  402 requests, 1.2 MB by 8 s, LCP 4.0 s (SwiftShader), so it is the heavy end of the map apps.
- **Steal:** hourly grid with day separators and a numeric predictability pill; map-on-top / numbers-below mobile split.
- **Don't steal:** brand-red chrome over a hot field; a second colour ramp (wind) in the same grid.

### R02 Ventusky

![Ventusky desktop](refs/ventusky.jpg) ![Ventusky mobile](refs/ventusky-m.jpg)

**URL:** `https://www.ventusky.com/?p=25.2;55.3;7&l=temperature-2m` · **Captured:** 2026-11-11 (1440×900 and 390×844)

- **Type scale:** Helvetica Neue, 13.4 px dominant (855 of 1,192 chars), weights 400 and 700 only, 7 sizes from 8.3 to 19.2 px.
- **Density:** 141 text elements, 41 numeric. Left layer list of 14 pills; bottom time scrubber with 3-hourly ticks (2 AM
  to 11 PM), "Today, 2026/11/11" date chip, Previous / Play / Next.
- **Colour restraint:** 19 distinct background colours and 9 hue buckets (the loudest palette of the map apps); loud paint
  15.2%. Chrome is dark translucent pills with white text; the field here is a pink-magenta ramp (about 80 to 90 °F).
- **Severity / legend:** 14 discrete steps (-40 to 100 °F) in a vertical key with the number inside each swatch. Measured:
  lightness reverses (only 38% of steps keep L* rising), and under simulated deuteranopia two adjacent steps differ by
  ΔE 0.8 (indistinguishable); protanopia minimum ΔE 7.2. The numbers inside the swatches are the only thing that saves it.
- **Units trap:** the en-US capture defaulted to °F. A UAE worker product must set °C explicitly, not inherit the locale.
- **Motion:** 10.7% of pixels change per 0.6 s (the wind particles). 153 requests, 691 KB, LCP 1.2 s.
- **3D / map and degradation:** first capture at 7 s showed the grey base map with no temperature field; at 16 s the field
  was present, so a loading state for the field is required. Mobile swaps the left list for a single "Temperature °F,
  ICON" chip with an altitude select, and replaces the scrubber with two strips (day chips Su to Sa, then hour chips).
  The chip also names the model ("ICON"), so provenance survives on mobile.
- **Steal:** day-then-hour two-strip time control on mobile; model name carried in the layer chip.
- **Don't steal:** a 14-step multi-hue key with no lightness order; locale-driven units.

### R03 earth.nullschool.net

![nullschool](refs/nullschool.jpg)

**URL:** `https://earth.nullschool.net/#current/wind/surface/level/overlay=temp/orthographic=-303.50,25.00,1700` · **Captured:** 2026-11-11 (1440×900)

- **Type scale:** one family (`MPLUS1-base`), two sizes (13 and 18 px), weight 400, text `#eee` on `#000005`. The viewport holds
  **17 characters** of DOM text in total (the "earth" menu button and a "get the app!" toast).
- **Density:** deliberately zero; the field is the interface. Legend, units and layers sit behind the menu.
- **Colour restraint:** 91.7% loud paint, all of it the field: an earthy olive → ochre → rust ramp with green-teal for
  cool, drawn at moderate chroma over a near-black page. No UI colour at all.
- **Motion:** 5 stacked 1440×900 canvases; only the particle streamlines move (3.4 to 4.4% of pixels per 0.6 s).
  Nothing else on the page animates.
- **3D / map treatment:** orthographic globe view (here a regional crop, UAE-centred), thin white coastlines and graticule at
  low opacity. **Weight and speed (headless, SwiftShader): 9 requests, 898 KB, FCP 0.7 s, LCP 1.5 s**: the fastest
  full-bleed field in the set.
- **Degradation:** none observed; the page is URL-addressable (hash encodes layer, projection, centre, zoom), so any state is shareable.
- **Steal:** the budget (9 requests, under 1 MB, near-zero DOM) and the hash-encoded state; field as the only chroma.
- **Don't steal:** no visible scale in the default view; an adult worker UI needs the number and the key on screen.

### R04 Zoom Earth

![Zoom Earth](refs/zoom-earth.jpg)

**URL:** `https://zoom.earth/maps/temperature/#view=25.2,55.3,6z` · **Captured:** 2026-11-11 (1440×900)

- **Type scale:** Museo Sans Cyrl, 11 / 13 / 16 px (5 sizes total), weights 700 (557 chars), 900 (115), 500 (87): heavy weights
  chosen for legibility over a coloured field. `tabular-nums` declared on 53 elements (the only page in the set that declares it).
- **Density:** 138 text elements, 64 numeric. City value pills (`Dubai 30°`, `Muscat 30°`) sit on the field, each a small
  white or dark rounded label with the degree sign; a stepper reads `11 Nov 18 : 06`.
- **Colour restraint:** 63.5% loud paint (field); 7 hue buckets, but chrome is translucent panels tinted by the field beneath.
- **Severity / legend:** bottom-left key `°C −30 … 50` as one continuous bar. Measured over 26 samples: L* rises from 50
  to a peak of 92 at yellow then falls to 19, a classic hump; ΔE per step mean 15.2, sd 8.4 (uneven).
- **Provenance in chrome:** a model switch `ICON 13 km | GFS 22 km` is always visible, so every pixel states its source and resolution.
- **Motion:** 0% pixel change in 1.2 s (the field did not move in the capture; wind and radar layers were not enabled).
  604 KB, 219 requests, LCP 1.9 s.
- **Steal:** value pills on the field; model + resolution toggle; static field until the user presses play.
- **Don't steal:** the rainbow key; olive translucent panels (read as chrome fighting the data).

### R05 NASA Worldview

![NASA Worldview](refs/nasa-worldview.jpg)

**URL:** `https://worldview.earthdata.nasa.gov/?v=40,15,75,38&l=Reference_Labels_15m,Reference_Features_15m,Coastlines_15m,MODIS_Terra_Land_Surface_Temp_Day,BlueMarble_NextGeneration&t=2026-11-09-T00%3A00%3A00Z` · **Captured:** 2026-11-11 (1440×900; first attempt at 9 s was a black frame, drawn at 18 s)

- **Type scale:** Public Sans 10.4 px dominant (347 of 655 chars) then 12 and 13 px; weights 400 (597 chars) and 500; Droid Sans
  Mono for 29 characters (4%).
- **Density:** 36 text elements in the viewport, but 6 stacked WebGL canvases and a left panel listing layers with their
  source line ("Terra / MODIS · v6.1 NRT") in small italic (about 10 px).
- **Colour restraint:** 36.2% loud paint: the land-surface-temperature layer over a dark Blue Marble. Panels are `#282828` /
  `#333`; the only chrome accents are an orange-red CTA ("Add Layers") and blue links.
- **Severity / legend:** inline gradient bar `< 200.0 K` to `≥ 350.0 K`, a jet-style rainbow. Measured L*: 49 → 32 → 96 → 50
  (hump at cyan-yellow); ΔE step mean 20.6, sd 13.5.
- **Honest gaps:** cloud-masked pixels are left as holes (transparent patches over the Blue Marble basemap in the north)
  rather than interpolated, so missing data is visible.
- **Motion:** none beyond load (0.2% pixel change). Timeline scrubber at the bottom: monthly and yearly ticks, `2026 NOV 09`
  stepper, camera and compare tools.
- **Weight and timing:** 152 requests, **8.3 MB**, LCP 8.4 s. It is the heaviest science page and the slowest to first paint.
- **Steal:** layer card with source and version on every layer; visible holes for missing data; scrubber with a stepper.
- **Don't steal:** the jet legend; an 8.3 MB first load.

### R06 NASA Earth Observatory, World of Change

![NASA EO](refs/nasa-earth-observatory.jpg)

**URL:** `https://earthobservatory.nasa.gov/world-of-change/global-temperatures` · **Captured:** 2026-11-11 (1440×900)

- **Type scale:** H1 Inter 48 px / 700; body Public Sans 15.2 px; 9 sizes (12 to 48 px); weights 400 / 600 / 700.
  Uppercase 6% of chars (small section labels).
- **Colour restraint:** page is white with a black nav (`#17171b`); the chrome has **0 saturated hue buckets**. The only colour
  is the map and its legend.
- **Severity / legend:** `Temperature Anomaly (°C compared to 1951-1980 average)`: the baseline is in the legend title.
  Diverging blue → near-white → yellow → orange → red; measured L* 36 → 100 (centre) → 40, symmetric as a diverging
  scale should be; ΔE step mean 8.6, sd 4.1.
- **Density:** 28 text elements, 0 numeric in the first fold; a sidebar list of "World of Change" links.
- **Steal:** baseline named in the legend; near-white centre so "normal" is quiet. Maps well to forecast minus threshold.
- **Don't steal:** the page frame (generic CMS), the heavy black masthead.

### R07 UAE National Center of Meteorology (NCM)

![NCM](refs/ncm-uae.jpg)

**URL:** `https://www.ncm.gov.ae/` · **Captured:** 2026-11-11 (1440×900; Arabic, RTL)

- **Type scale:** Droid Arabic Kufi (570 chars) for UI and Droid Arabic Naskh (146 chars) for body, 11.2 to 16 px, weights
  400 only (5 characters bold). Latin falls back to Helvetica Neue.
- **Severity without a toy look:** official warnings use a **thin pale strip with a small amber tag ("تحذير", warning)**
  at the start and a ticker strip (9 CSS animations running; the text is cut at the edge, consistent with a scrolling marquee). The tag is `#ffcc33`; the text stays dark on
  light. Radar uses a green → blue → yellow → red rain palette (5 hue buckets, 11.6% loud) over a dark slate basemap (`#38435b`).
- **Why it matters for v2:** this is the vocabulary UAE workers and supervisors already read as "official warning". It
  also shows RTL layout, an Arabic-first font stack, and bilingual toggle ("English") as chrome.
- **Weight:** 165 requests, 4.1 MB, LCP 2.3 s.
- **Steal:** the warning-strip-with-tag pattern (thin, not a plate); Arabic type stack; RTL-first thinking.
- **Don't steal:** the marquee ticker; a five-hue radar key.

### R08 NWS HeatRisk

![NWS HeatRisk](refs/nws-heatrisk.jpg)

**URL:** `https://www.wpc.ncep.noaa.gov/heatrisk/` · **Captured:** 2026-11-11 (1440×900; second capture at 18 s; map tiles load, the HeatRisk overlay did not draw: unknown whether November category-0 emptiness or a headless limit)

- **Type scale:** Roboto 14.4 px dominant (879 of 1,358 chars), 16 px for the title, 12 / 12.8 px for table text; weights 400 and 700.
- **Density:** 44 text elements, 13 table rows. A 7-day segmented selector (`Wed 11/11 … Tue 11/17`), an address search, a
  validity block ("Valid: Wed Nov 11; Updated: Nov 11, 2026 5:49 PM GMT+0500").
- **Severity without a toy look:** a **5-row table: Category (name + index 0 to 4) + "Risk of Heat-Related Impacts" sentence**:
  Green 0 "Little to no risk"; Yellow 1 "Minor: primarily affects those who are extremely sensitive to heat and without
  cooling/hydration"; Orange 2 "Moderate"; Red 3 "Major: affects anyone without cooling/hydration as well as health
  systems and industries"; Magenta 4 "Extreme: rare and/or long-duration extreme heat with no overnight relief". The map
  legend adds "Est. Population by Category" per class, so each level carries a count.
- **Colour:** the five fills are flat and saturated (the table is the v1 failure mode if used as page chrome), but the scale
  is **luminance-ordered**: measured L* 96 → 29 monotonic (100% of steps), adjacent ΔE76 mean 61.9 (min 48.8). Under
  simulated deuteranopia the closest pair is still ΔE 20.4, protanopia 31.0: all five remain separable. Level 0 is
  near-white (`#e7fae6`), so the quiet state has no loudness.
- **Motion:** none. **3D / map:** flat tiled map in a bordered panel with a layer switch and a population-weighted legend.
- **Steal:** impact-language per level (who is affected and what protective factor matters); index + name + sentence + count;
  level 0 near-white; validity and "updated" stamps; 7-day strip.
- **Don't steal:** flat saturated cell fills as large page surfaces; Bootstrap-default blue links.

### R09 Heat.gov (NIHHIS)

![Heat.gov](refs/heat-gov.jpg)

**URL:** `https://www.heat.gov/` · **Captured:** 2026-11-11 (1440×900; HTTP 202 on first response)

- **Type scale:** Public Sans only (809 chars): 16 / 24 / 32 px; headings 700 in navy `#2f3b85`; 7 sizes (12 to 32 px).
- **Density:** 24 text elements; list rows are headline + calendar-icon date + category tag, separated by hairline rules.
- **Colour restraint:** 0.8% loud paint; amber `#ffbe4f` and rust `#cf6a17` appear only in the logo sun. A cropped globe image of a
  heat anomaly (orange-red on pale blue) is the one data image.
- **Steal:** hairline list rows with date + category meta.
- **Don't steal:** the generic gov template; a cropped hero image with an empty gap beneath it.

### R10 Climate Central, Climate Shift Index

![Climate Central](refs/climate-central-csi.jpg)

**URL:** `https://www.climatecentral.org/climate-shift-index` · **Captured:** 2026-11-11 (1440×900)

- **Type scale:** H1 **Maitree 72 px / 300** (light serif) at -1 px tracking; sub-heading Maitree 44 px / 300; body **Work Sans 18 px / 400**
  in navy `#032849`. 7 sizes (14 to 72 px).
- **Colour restraint:** 0.9% loud paint; navy hero, tabs with a single underline; the only saturated chip is yellow `#fee003`
  (Donate). Tabs include "Climate Shift Index: Humid Heat" (a heat-attribution index presented as an index, not a plate).
- **Steal:** light-weight serif display on a deep navy band with a quiet sans body.
- **Don't steal:** a yellow donate chip as the loudest element (irrelevant here, but note the pattern: one loud chip = one action).

### R11 Tomorrow.io heat-dome story

![Tomorrow story hero](refs/tomorrow-heatdome-story.jpg) ![Tomorrow story, scrolled](refs/tomorrow-heatdome-scroll.jpg)

**URL:** `https://info.tomorrow.io/heatdome/story` · **Captured:** 2026-11-11 (1440×900; the second shot is the same URL scrolled 3,200 px)

- **Type scale:** H1 **Roboto Condensed 900 / 78 px, uppercase**; body Roboto 15 to 16 px; labels **Roboto Mono 11 px,
  letter-spaced uppercase** ("TOMORROW.IO · FOCUS · JUN 27 – JUL 6, 2026", "BIG-METRO AMERICANS BY PEAK FELT-HEAT",
  "50 metros · 184M · FOCUS×Census"): 26% of first-view characters are mono. The big "69%" is Roboto Condensed ~74 px.
- **Density:** 18 to 30 text elements per view, 6 to 20 numeric; one idea per screen, a dot progress rail at right.
- **Colour restraint:** page `#000`, basemap in greys; the only chroma is data: blue `#2a5e92`, amber `#ba6e29`,
  red-orange `#d43e15`, red `#fd2a18`. Loud paint 0.0% on the hero and 1.9% on the chart view.
- **Severity without a toy look:** a **single 100%-stacked bar** (23% / 9% / 69%) with a four-row legend: swatch + range +
  **word** + percentage in mono: `< 90°F 22.6%`, `90–103° Ext. Caution 8.8%`, `103–115° Danger 68.6%`, `115°+ Extreme 0.0%`. The
  copy states the scope honestly: "an exposure estimate, not the NOAA HeatRisk health index".
- **Colour redundancy check:** measured L* 39 → 55 only; under protanopia the three warm steps collapse (min ΔE 3.1;
  deuteranopia 8.0), so the words and percentages carry the meaning. Good practice for v2: the label is mandatory, colour is garnish.
- **Motion:** static until scroll (0.02% pixels change over 1.2 s); "Scroll; the map moves with the story" (camera moves on
  scroll), dot rail advances, a "Capture frame" button sits bottom-right.
- **3D / map and degradation:** dark Mapbox basemap in the hero (greyscale, labels at 10 to 12 px). "Or open the live
  interactive map →" is the escape hatch. 63 requests, 1.8 MB, LCP 1.7 s (headless).
- **Steal:** mono eyebrow with a date range; stacked bar with swatch + range + word + number; scope caveat in copy; map
  that moves with scroll and a static escape link; a "Capture frame" control (useful for judges).
- **Don't steal:** the 900-weight condensed uppercase headline (it is the v1 poster-type problem, and it is what makes
  this otherwise sober page read as signage).

### R12 Tomorrow.io product page

![Tomorrow.io product](refs/tomorrow-io.jpg)

**URL:** `https://www.tomorrow.io/` · **Captured:** 2026-11-11 (1440×900; hero media absent in capture)

- **Type scale:** H1 Roboto Condensed 600 / 72 px uppercase on `#000`; body Roboto 16 / 24 px; 5 sizes (14 to 72 px).
- **Colour restraint:** loud paint 0.8%; the only chroma is electric blue `#0100ff` on the CTA. The hero video/background did
  not render headless, leaving a black void under the headline, which is a useful picture of a failed hero.
- **Steal:** one CTA colour, everything else neutral.
- **Don't steal:** condensed uppercase hero (same family of v1's mistake); a hero that is a black rectangle when media fails.

### R13 Our World in Data

![OWID](refs/owid-temperature.jpg)

**URL:** `https://ourworldindata.org/grapher/temperature-anomaly` · **Captured:** 2026-11-11 (1440×900; a first capture caught the cookie banner and was replaced)

- **Type scale:** title **Playfair Display 25 px / 600**; body **Lato 12 to 16 px** in navy `#1d3d63`; axis labels 12 px;
  9 sizes (12 to 25 px). Caps only for the side-panel header (6% of chars).
- **Density:** 56 text elements, 22 numeric; a chart, a region list, a table/line/bar switch, a timeline slider, then the
  stack **title → definition → data source → note (baseline) → licence (CC BY) → download / share**.
- **Colour restraint:** 1.6% loud paint; one red series, grey upper and lower bounds, dotted grid, a solid zero line.
  Header navy `#002147` with a red underline.
- **Severity / uncertainty:** the uncertainty is drawn as two thin grey bound lines labelled "Upper bound / Average / Lower
  bound" directly at the line end (no legend box).
- **Weight:** 30 requests, 2.0 MB, LCP 4.1 s.
- **Steal:** direct end-of-line labels; the title / definition / source / note stack; grey bounds for uncertainty; one accent per chart.
- **Don't steal:** the yellow cookie banner as a fold-hiding object.

### R14 FlowingData, embedding an NYT chart

![FlowingData](refs/flowingdata-hotter-days.jpg)

**URL:** `https://flowingdata.com/2026/09/15/hotter-days-and-more-of-them/` · **Captured:** 2026-11-11 (1440×900)

- **Type scale:** H1 **Gotham SSm 28 px / 600**, body **Mercury SSm 18 px / 400** (sans headline + serif text);
  chart labels are baked into the image (not measurable).
- **Colour restraint:** page is white; the chart sits in a near-black panel and uses a yellow → orange → red ramp **only for
  the data lines**; loud paint 3.5%, all of it the chart.
- **Severity:** thousands of thin lines (days above 90°F heat index, 1995 to 2025 per county) fade from yellow (few days)
  to coral (200+ days); a handful of counties are highlighted with start → end labels ("Hidalgo County, Texas 190 → 212 days").
- **Density:** 25 text elements in the page area; the chart is one object with 6 direct county labels and a small inset key-line instead of a legend box.
- **Steal:** direct labels with start → end values; a dark chart panel on a light page so the ramp reads at full intensity.
- **Don't steal:** the membership upsell sidebar; the pink pull-quote panel.

### R15 Globaia, Wet-Bulb Globe Temperature

![Globaia WBGT](refs/globaia-wbgt.jpg)

**URL:** `https://globaia.org/wbgt/` · **Captured:** 2026-11-11 (1440×900)

- **Type scale:** H1 **Comma Serif 67.2 px / 300** with "Wet-Bulb" and "Temperature" in bold and "Globe" in light inside one heading;
  an italic serif standfirst ~32.8 px; body **Alcyone 15.2 px**; 12 px eyebrow "HABITABILITY · HEAT STRESS" in letter-spaced
  caps; 8 sizes (12 to 67 px).
- **Colour restraint:** page is a dark brown-olive gradient over a near-black base, text near-white; the only accents are cyan
  `#00bfff` (links) and a small amber glyph. 0.6% loud paint, 68% tinted (the gradient).
- **On-topic content:** explains WBGT in two paragraphs ("compress all four ingredients: heat, humidity, wind, solar
  radiation into a single number that maps cleanly to how long a person can safely work in the sun") and cites the data
  in a 12 px line: "Kong & Huber (2025), *Scientific Data* 12:246, Liljegren method, ERA5 (1994 to 2023), 15-model CMIP6".
- **Interaction cues:** two hairline-bordered cards ("Open the interactive map: click any pixel for its value", "The heat
  doesn't stop after dark"). The interactive map itself is behind the first card and was not captured.
- **Motion:** the page was still transitioning at 8 s (88.7% of pixels changed in the first 0.6 s, then 6.3% per 0.6 s as the
  background drifted), so any ambient animation here is slow and low-contrast. 28 requests, 2.1 MB, LCP 1.1 s.
- **Steal:** WBGT-in-one-paragraph explainer; cite-the-dataset line under the lead; "click any pixel for its value".
- **Don't steal:** inline emoji-style glyphs in running text; a brown gradient as atmosphere (v2 should keep chroma for data).

### R16 Columbia Climate School, wet-bulb map

![Columbia wet-bulb](refs/columbia-wetbulb.jpg)

**URL:** `https://blogs.ei.columbia.edu/wp-content/themes/sotp-foundation/dataviz/heat-humidity-map` · **Captured:** 2026-11-11 (1440×900, scrolled 1,050 px; the data layer did not draw headless, so the basemap and legend are what was observed)

- **Type scale:** H1 **Source Serif 51 px / 400**, body **Source Sans 18 px**; legend labels 12 px; a clean serif + sans pair.
- **Colour restraint:** pale-grey globe, labels in grey 10 to 12 px; 0.5% loud paint. The legend is a pastel ramp.
- **Severity / legend:** one continuous bar, 8 tick labels including **open-ended bounds** ("< 17.75" … "33.5 >"),
  teal → pale green → pale yellow → coral → red. Measured: ΔE step mean 4.0, sd 1.6 (the most even ramp measured), but
  lightness is still hump-shaped (L* 77 → 96 at pale yellow → 57), so the midpoint looks like "no data".
- **Steal:** pastel low-chroma ramp on a pale basemap; open-ended end labels.
- **Don't steal:** a pale-yellow midpoint (reads as empty) if the scale is meant to be ordered by danger.

### R17 #ShowYourStripes

![Show Your Stripes](refs/showyourstripes.jpg)

**URL:** `https://showyourstripes.info/` · **Captured:** 2026-11-11 (1440×900)

- **Type scale:** Roboto 12 / 14 / 16 / 20 px, weights 400 and 500; tab labels uppercase (18% of chars).
- **Colour restraint:** dark UI (`#303030` / `#222`) with a single cyan accent (`#00bcd4`); the graphic is one blue → red diverging strip
  (end swatches `#4292c6` and `#a40f16`, L* 19 to 92).
- **Provenance:** an "Information" table: Region / Date Range 1850 to 2025 / Data Source UK Met Office / Creator / Licensor /
  licence badge (CC BY), plus a credits footer naming Berkeley Earth, NOAA, UK Met Office, MeteoSwiss, DWD, SMHI, UoR, ZAMG.
- **Steal:** one stripe per period with no axes (a "season of hours" or "season of days" ribbon for the judge view);
  provenance table beneath the graphic.
- **Don't steal:** Material-style cards, a floating teal FAB.

### R18 Samsara

![Samsara desktop](refs/samsara.jpg) ![Samsara mobile](refs/samsara-m.jpg)

**URL:** `https://www.samsara.com/` · **Captured:** 2026-11-11 (1440×900 and 390×844)

- **Type scale:** H1 **Samsara Sans 700 / 72 px, uppercase, extended**; body **FK Grotesk 14 to 24 px**; 5% of chars are FK
  Grotesk Mono in bracketed eyebrows (`[ FLEET FUEL MANAGEMENT ]`). Mobile H1 drops to 48 px.
- **Colour restraint:** neutrals `#eae8e3` (warm grey) and `#1c1917` (near-black); one saturated colour, amber `#feae0f`
  on the primary CTA. 2.8% loud paint (the aerial photo contributes most of it).
- **Density:** 17 text elements, 4 numeric: a marketing fold.
- **Weight and timing:** 529 requests, **5.5 MB**, LCP 3.1 s; the hero is full-bleed aerial footage (likely video).
- **Steal:** warm-grey neutrals plus a single amber; bracketed mono eyebrow; operator photography for credibility.
- **Don't steal:** wide uppercase 700 display type (road-sign / sports-poster register, the same as v1).

### R19 Kenzen

![Kenzen desktop](refs/kenzen.jpg) ![Kenzen mobile](refs/kenzen-m.jpg)

**URL:** `https://www.kenzen.com/` · **Captured:** 2026-11-11 (1440×900 and 390×844; page navigation timed out at 45 s but rendered)

- **Type scale:** H1 "Protect People." **Normalidad Extended 60 px / 400**, mixed case, teal `#00a99d`; body **Normalidad Text 24 px / 300**
  in `#304755`; nav Sofachrome 12 px / 100 uppercase. Weights 100 / 300 / 400 only.
- **Colour restraint:** duotone navy photograph of a welder (`#112836`), a pale blue-grey band (`#cad6de`), teal and sky as the only
  accents. 0.8% loud paint.
- **Density / data:** none in the first fold (10 text elements, 0 numeric); no product UI is shown. This is a heat-stress
  wearable competitor whose marketing shows no data.
- **Steal:** a calm extended grotesk at weight 400 in mixed case reads adult; duotone photography with real workers.
- **Don't steal:** stock-style hero with no evidence of the product.

### R20 SlateSafety

![SlateSafety](refs/slate-safety.jpg)

**URL:** `https://www.slatesafety.com/` · **Captured:** 2026-11-11 (1440×900)

- **Type scale:** H1 "THE #1 HEAT STRESS PREVENTION SYSTEM" **Conthrax 700 / 60 px** (wide techno display); body BasisGrotesque /
  system 16 to 20 px.
- **Colour restraint:** black hero, orange `#f2692d` CTA pill and an orange marquee banner; 4.4% loud paint.
- **Density / data:** 10 text elements, no data or product UI in the fold; the claim is "#1".
- **Read:** the display face and orange-on-black are sci-fi / gaming register (the family v1 drifted into with signage).
- **Steal:** nothing typographic. The "real-time" framing is the only useful content.
- **Don't steal:** a techno display face; claims-first heroes.

### R21 Palantir (AIP and Foundry)

![Palantir AIP](refs/palantir-aip.jpg) ![Palantir Foundry](refs/palantir-foundry.jpg)

**URL:** `https://www.palantir.com/platforms/aip/` and `https://www.palantir.com/platforms/foundry/` · **Captured:** 2026-11-11 (1440×900; AIP needed 15 s to paint)

- **Type scale:** Foundry H1 **Alliance No.2 100 px / 400, -2 px tracking** on white; body Alliance No.1 18 px; AIP microcopy
  **10 px uppercase** (34% of characters) set in captions with a 1 px left rule ("TIME: 3 MNS · SCROLL TO EXPLORE").
  Weights: AIP 400 / 500, Foundry 400 only.
- **Colour restraint:** **0 saturated hue buckets**; AIP is near-black navy `#1e1f2b`, Foundry is white with `#1e2124` ink.
- **Density:** 30 to 35 text elements, 1 to 3 numeric; marketing, no data.
- **Steal:** one weight at a very large size with negative tracking; hairline-ruled 10 px captions; zero chroma chrome.
- **Don't steal:** the empty first fold with no data or product evidence.

### R22 Anduril Lattice

![Anduril Lattice](refs/anduril-lattice.jpg)

**URL:** `https://www.anduril.com/lattice` · **Captured:** 2026-11-11 (1440×900; partial: the full-bleed hero video / canvas was not decoded headless and a silhouette frame was caught)

- **Type scale:** HelveticaNowDisplay; nav 15 px / 400 (the only rendered text in the fold; an unrendered template heading `@[shortTitle]` also sits in the DOM).
- **Colour restraint:** black page, white text, a single lime `#dff140` (hue 66) accent; the amber photograph inflates loud paint to 9.7%.
- **Steal:** nav at 15 px regular with no weight contrast; one accent hue.
- **Don't steal:** an unlabelled full-bleed hero with no fallback (the failure frame is the evidence).

### R23 Apple Watch

![Apple Watch desktop](refs/apple-watch-health.jpg) ![Apple Watch mobile](refs/apple-watch-health-m.jpg)

**URL:** `https://www.apple.com/watch/health/` (resolved to `https://www.apple.com/watch/`) · **Captured:** 2026-11-11 (1440×900 and 390×844)

- **Type scale:** H1 **SF Pro Display 80 px / 600, -1.2 px tracking** (40 px on mobile); body SF Pro Text 17 px; 6 sizes in total
  (10 to 80 px); weights 400 and 600 only (225 and 211 chars).
- **Colour restraint:** 88.4% neutral pixels; loud paint 0.4%; the only saturated marks are the Activity-rings icon and one
  orange "New" label and blue links.
- **Density:** 34 text elements, 5 numeric; tinted product cards (cream / charcoal / sky) with big watch faces.
- **Steal:** few sizes, two weights, tight tracking at display size; tinted card surfaces that stay low-chroma.
- **Don't steal:** product-hero pacing; there is no data UI here.

### R24 getdesign.md and two pulled DESIGN.md files

![getdesign.md](refs/getdesign-md.jpg) ![Oura preview](refs/getdesign-oura-preview.jpg) ![Sentry preview](refs/getdesign-sentry-preview.jpg)

**URL:** `https://getdesign.md/` plus `https://getdesign.md/design-md/oura/preview.html` and `https://getdesign.md/design-md/sentry/preview.html` · **Captured:** 2026-11-11 (1440×900). Raw files fetched from `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/<brand>/DESIGN.md` (HTTP 200; Oura 31.8 KB, Sentry 35.4 KB, Kraken 4.4 KB).

- **getdesign.md itself:** Geist 13 to 16 px with **Geist Mono 11% of chars** for eyebrows ("USE A DESIGN.MD TO", `01 … 05` numbered rows
  separated by hairlines, "Design System Analysis" table header) on `#161618`. A good example of mono-label-plus-hairline
  structure, but Geist is Vercel's face, so it is not the identity to copy.
- **Catalogue check:** the homepage lists 550+ systems; the nearest to this product are Sentry (dark, data-dense), PostHog,
  ClickHouse, Kraken, Oura. **No weather, climate or map product** appears.
- **Oura (DESIGN.md):** canvas `#f7f1e8` cream, Editorial New serif display 110 px / 300 (80, 68, 40 px steps), AkkuratLL body 18 / 16 px,
  hairline `#e1dcd3`, one action blue `#2a72de`, earth accents (mustard `#af751b`, clay `#6b443d`, olive `#5c6f5d`),
  `error #e33a22`. Lesson: cream paper only works with a light high-contrast serif and earth-toned data; flat primaries on cream is exactly v1.
- **Sentry (DESIGN.md):** `#1f1633` / `#150f23` midnight, lime `#c2ef4e`, pink `#fa7faa`, violet `#6a5fc1`; a "chunky, near-condensed" display,
  Rubik UI, Monaco code, **sticker mascots**; 10 px micro-caps for status labels. It reads as a game: a counter-example.
- **Steal:** the DESIGN.md tokens-plus-rationale format; mono eyebrow + numbered hairline rows.
- **Don't steal:** cream canvas (Oura) with primaries; mascot / lime / near-condensed (Sentry); Geist as a signature.

### R25 Galleries: Godly, Lapa Ninja, Siteinspire

![Godly](refs/godly.jpg) ![Lapa Ninja](refs/lapa-ninja.jpg) ![Siteinspire](refs/siteinspire.jpg)

**URLs:** `https://godly.website/`, `https://www.lapa.ninja/`, `https://www.siteinspire.com/` · **Captured:** 2026-11-11 (1440×900). Awwwards returned HTTP 403; Mobbin and Refero need logins (not attempted).

- **What they are:** indexes of other people's work. Godly: Inter 13 px, white page, 3 sizes total, 0 saturated hue buckets in chrome.
  Lapa Ninja: Inter 16 / 48 px / 700, -1.2 px tracking, one purple CTA. Siteinspire: a single grotesk (Scto Grotesk A) at 14 / 20 / 24 px,
  weight 400 everywhere, a single red dot as the logo.
- **Takeaway:** all three keep their own chrome near-neutral so the work shown carries the colour: the same rule as the map apps.
  None had a climate / data category visible in the first fold; to mine them for relevant work search inside the gallery
  (Godly "data", Siteinspire "Typographic"), which was not done here.
- **Steal:** neutral chrome around coloured content.
- **Don't steal:** Inter-at-13-px defaults as an identity.

---

## 4. Minor captures (low signal, kept for completeness)

| Page | URL | Shot | Observed |
|---|---|---|---|
| Meteomatics | `https://www.meteomatics.com/en/` | `meteomatics` | Avantt 48 / 80 px / 600 headline, navy `#003652` + lime `#defd83` + turquoise `#40e0d0` (4 hue buckets); hero media blank in capture. The lime pill CTA is the loudest element. |
| The Pudding | `https://pudding.cool/` | `pudding` | Atlas Grotesk + **Atlas Typewriter (25% mono)** + a hand-lettered logo; thumbnails are flat red / ochre / magenta squares (35.5% loud paint). The mono `#228` chips and `NOV 2026` date labels are a good detail; the flat primary squares and script logo are the playful register, a useful "childish" contrast. |
| FT Visual and data journalism | `https://www.ft.com/visual-and-data-journalism` | `ft-visual-data` | Financier Display 40 px / 300 + Metric 16 px on FT pink paper `#fff1e5`; navy `#082a4d` band, teal rule. An index page, not a heat piece. A tinted-paper page (FT pink) works there because the type is a light serif display with small sans text and chroma is tiny; v1's cream paired with condensed sans and primaries did not. |

![Meteomatics](refs/meteomatics.jpg) ![The Pudding](refs/pudding.jpg) ![FT Visual and data journalism](refs/ft-visual-data.jpg)

## 5. Failed, partial, or login-gated sources

| Source | Outcome |
|---|---|
| Mobbin, Refero | Login required; not attempted. |
| Awwwards (`/websites/data-visualization/`) | HTTP 403 to headless; no capture. |
| Copernicus Climate Pulse (`https://pulse.climate.copernicus.eu/`) | Navigation timed out at 45 s (SwiftShader args) and at 90 s (plain args); desktop and mobile came back blank white; WebFetch returned only the title and tagline (client-rendered). **No evidence captured.** |
| ECMWF Charts (`https://charts.ecmwf.int/`) | First attempt returned a bot challenge ("Making sure you're not a bot!"); with default Chromium args only the **shell** rendered (black header and footer, white body, Open Sans 12.6 px). Kept as `refs/ecmwf-charts-plain.jpg` (shell only). A deep meteogram URL timed out on screenshot. |
| NASA Worldview | First capture was a black frame at 9 s; the second (18 s) drew. Heavy: 8.3 MB, LCP 8.4 s. |
| Reuters Graphics, Bloomberg Green, NYT, FT heat pieces | No capturable heat piece: Reuters `/graphics/` is a general news index (captured and dropped), Bloomberg and NYT are paywalled, the FT piece found by search could not be confirmed as a heat story. Substituted R11, R13, R14, R15, R16. |
| Tomorrow.io product, Meteomatics, Anduril | Hero media (video / canvas) did not render headless: black or blank hero. Captured as-is and labelled. |
| NWS HeatRisk overlay, Columbia wet-bulb data layer | Basemap, table and legend rendered; the data overlay did not draw. Unknown whether this is off-season emptiness or a headless limit. |
| Globaia interactive WBGT map | Behind a button; only the explainer page was captured. |
| Apple Weather page | Not captured; `/watch/health/` redirects to `/watch/`. |
| ventusky first run | Temperature field missing at 7 s; replaced by a 16 s capture. |

ECMWF shell-only capture (the chart canvas never loaded): ![ECMWF Charts shell](refs/ecmwf-charts-plain.jpg)

---

## 6. Measurements: palettes for temperature and severity fields

| Legend | Kind | Samples | L* path | Monotonic L* | ΔE76 per step | Colour-blind check |
|---|---|---|---|---|---|---|
| Zoom Earth, °C −30 to 50 | continuous rainbow | 26 | 50 → **max 92 (yellow)** → 19 | 56% up / 60% down | mean 15.2, sd 8.4 | not run (continuous) |
| NASA Worldview LST, 200 to 350 K | continuous jet | 24 | 49 → 32 → **96** → 50 | 43% / 61% | mean 20.6, sd 13.5 | not run |
| Ventusky, −40 to 100 °F | 14 discrete steps, multi-hue | 14 | 80 → 27 (reversals) | 38% up | mean 32.8, sd 14.6 | deuteranopia min pair **ΔE 0.8**; protanopia 7.2 |
| NWS HeatRisk 0 to 4 | 5 discrete, green → magenta | 5 | 96 → 29 | **100% down** | mean 61.9, min 48.8 | deut min pair **20.4**; prot **31.0** |
| Tomorrow.io heat-dome bar | 4 discrete (blue, amber, red-orange, red) | 4 | 39 → 55 | 67% up | mean 46.7, min 19.8 | deut min pair 8.0; prot **3.1** (warm steps collapse) |
| Columbia wet-bulb, 17.75 to 33.5 °C | continuous pastel sequential | 30 | 77 → **max 96** → 57 | 45% up / 66% down | mean 4.0, sd 1.6 | not run |
| NASA EO anomaly | continuous diverging | 32 | 36 → **100 (centre)** → 40 | symmetric, as intended | mean 8.6, sd 4.1 | not run |
| Show Your Stripes | diverging blue ↔ red | 59 | 19 to 92 | n/a | n/a | endpoints `#4292c6` / `#a40f16` |

Reading: the continuous rainbows (Zoom Earth, Worldview) are the least uniform (ΔE sd / mean 0.55 and 0.66); Columbia is the
most even (0.40) but is hump-shaped in lightness; only NWS orders its categories by lightness, and it is the only one whose
steps all survive both colour-vision simulations with ΔE > 20. Nobody measured uses a named perceptually-uniform sequential
ramp (nullschool's ramp was not sampled because no legend is visible by default).

---

## 7. Synthesis: cross-cutting principles for Stellar Blaze v2

**P1. Heat colour lives only in the data; chrome stays neutral or dark.**
Evidence: non-field pages median **0.9%** loud paint (max 9.7%, 25 captures); field views 11 to 92%, and in every one the
saturated area is the data (R01 to R05, R07, R08, R17). The one clash is Windy's brand-red chrome on an orange field (R01).
Dark neutral surrounds (R03, R04, R11, R05) or a pale-grey basemap (R16) both work; beige does not (R24 Oura). Supervisor
and HSE tables stay under about 4% loud paint; the landing field may be the only high-chroma object.

**P2. Danger is shown as number + word + position on a scale, with colour as a small key, never a filled plate.**
Evidence: NWS HeatRisk pairs index 0 to 4, a name, an impact sentence ("affects anyone without cooling/hydration") and an
estimated-population count per level (R08); Tomorrow.io's bar gives swatch + range + word + percentage in mono
(`103–115° Danger 68.6%`) (R11); NCM marks warnings with a thin strip and a small amber "تحذير" tag, not a plate (R07);
Windy shows forecast confidence as "80% predictability" (R01). Because warm steps collapse under protanopia (R11, ΔE 3.1) and
a 14-step key collapses under deuteranopia (R02, ΔE 0.8), the text must carry the level and colour is redundant. Make level 0
near-white (R08, `#e7fae6`, L* 96) so the quiet state is quiet.

**P3. Temperature-field palettes: the field convention is rainbow, and it fails the measurable tests.**
Evidence in section 6: Zoom Earth and Worldview (R04, R05) humps in L* (peak 92 and 96); Ventusky's 14 steps reverse
lightness and collapse under deuteranopia (R02); Columbia's pastel ramp is the most even but hump-shaped (R16); NASA EO's diverging
anomaly scale is correct for a baseline comparison (R06). The only palette whose every step survives both simulations is the
luminance-ordered categorical NWS scale (R08). For v2: a single-hue-family sequential ramp with monotonic L* for fields, a diverging scale
only where a baseline exists (forecast minus threshold, per R06 / R17), and a lightness-ordered 4 or 5 step categorical key for levels.
Named perceptual ramps (e.g. Matplotlib's) were not observed in any reference and were not verified here.

**P4. Type pairings in climate and scientific products.**
Observed: light or regular serif display with a humanist sans body for explainers and editorial (OWID Playfair Display 25 / 600 + Lato, R13;
Climate Central Maitree 72 / 300 + Work Sans 18, R10; Globaia Comma Serif 67 / 300 + Alcyone 15, R15; Columbia Source Serif + Source Sans, R16;
FlowingData Gotham + Mercury, R14; FT Financier Display 300 + Metric, section 4). Map and instrument UIs use a neutral sans at 10 to 14 px
with weights 400 and 700 only (Windy system stack 14 px, R01; Ventusky Helvetica Neue 13.4 px, R02; Worldview Public Sans 10.4 px, R05)
and **mono only for labels, units and eyebrows** (Tomorrow.io Roboto Mono 11 px letter-spaced, 26% of first-view characters, R11;
getdesign Geist Mono 11%, R24; Samsara FK Grotesk Mono 5%, R18; Pudding Atlas Typewriter 25%, section 4). `tabular-nums` was declared by
only one page (Zoom Earth, 53 elements, R04), so declaring it is a differentiator, not a convention. The condensed or extended
uppercase display faces are all **ops-vendor marketing** (Tomorrow.io Roboto Condensed 900 / 600, R11 / R12; Samsara Sans 700, R18;
SlateSafety Conthrax 700, R20): the signage register v1 was rejected for. The serious ops pages go the other way: Palantir
Alliance No.2 at **weight 400, 100 px, -2 px tracking** (R21) and Apple SF Pro 80 px / 600 / -1.2 px with 6 sizes in total (R23).

**P5. What makes a hero cinematic but fast.**
Evidence: nullschool = 5 canvases, **17 characters of DOM text, 9 requests, 898 KB, FCP 0.7 s, LCP 1.5 s**, and only particles move
(3.4 to 4.4% of pixels per 0.6 s) (R03). Ventusky: 153 requests, 691 KB, LCP 1.2 s, 10.7% motion (R02). Zoom Earth: static field, 0%
motion until play, 604 KB (R04). Tomorrow.io's story is static (0.02%) until scroll, then the camera moves with the story (R11).
The heavy ones are the counter-evidence: Windy 402 requests, LCP 4.0 s (R01); Worldview 8.3 MB, LCP 8.4 s (R05); Samsara 5.5 MB (R18).
Recipe: one full-bleed field, motion limited to the physical flow (particles or slow drift), almost no chrome, a dark neutral surround,
LCP under the 2.5 s budget. A hero that is video or WebGL must have a static poster frame, because the failure frames here
(Tomorrow.io product black void R12, Anduril silhouette R22, Meteomatics blank, Climate Pulse white) look unfinished.
All timings are headless SwiftShader on one laptop: use them as ratios.

**P6. Childish versus serious, from the evidence.**
Childish signals observed: flat saturated rectangles as primary content (Pudding 35.5% loud paint, section 4); wide, condensed or
techno display faces at 600 to 900 weight in uppercase (R11, R12, R18, R20); mascots, stickers, lime + pink (Sentry, R24); cream
paper with primaries (Oura only works with a 300-weight editorial serif and earth tones, R24); marquee tickers and gradient atmosphere
used as decoration (R07, R15). Serious signals: loud paint ≤ 4% outside the field (median 0.9%); 3 to 6 sizes and 1 to 3
weights in the fold (Palantir weights 400 / 500, R21; Apple 400 / 600, R23; Godly 3 sizes, R25); hairline rules and source lines
(R13, R17, R09); direct labels and baselines instead of legend boxes (R13, R14, R06); units and provenance beside the number (R04, R13, R17, R15);
real density where users act (Windy 279 numeric elements in one viewport, R01; Zoom Earth 64, R04; NWS 13 table rows, R08). The v1 first fold had zero real numbers.

**P7. Density: supervisors and judges should look like Windy or Zoom Earth, not like a marketing page.**
Benchmarks per first viewport: Windy 385 text elements / 279 numeric (R01), Zoom Earth 138 / 64 (R04), Ventusky 141 / 41 (R02), NWS 44 to 59 /
11 to 20 (R08), OWID 56 / 22 (R13); marketing folds are 10 to 35 / 0 to 5 (R18 to R23). Workers need the opposite end, but adult:
Apple's 80 px / 2 weights / 6 sizes (R23) is the large-and-calm reference, not the sticker frame.

**P8. Provenance, resolution and scope belong in the chrome, next to the number.**
Evidence: Zoom Earth's persistent `ICON 13 km | GFS 22 km` toggle (R04); Ventusky's "Temperature °F, ICON" chip (R02); Worldview's per-layer
"Terra / MODIS · v6.1 NRT" (R05); OWID's definition + source + baseline note + CC BY stack (R13); Show Your Stripes' information table (R17); Globaia's dataset citation (R15);
Tomorrow.io's "an exposure estimate, not the NOAA HeatRisk health index" (R11); NWS "Valid / Updated" stamp (R08). For a scoreboard that grades warnings
against airport thermometers, the station, instrument and scoring-rule line belongs under every number.

**P9. Time is a scrubber with a labelled axis; forecasts show their confidence.**
Evidence: Ventusky 3-hourly ticks plus a "Today" chip and Prev / Play / Next, and on mobile day chips then hour chips (R02); Windy's 5-day × 8-column
grid with per-day predictability (R01); Worldview's month / year timeline with a stepper (R05); NWS 7-day segmented selector (R08). The judge
replay is a scrubber over days and hours; the supervisor hour band should read like a row of the Windy grid, not like a row of tiles.

**P10. Show gaps and failures honestly, and degrade on purpose.**
Evidence: Worldview leaves cloud holes as holes (R05); Tomorrow.io offers "Or open the live interactive map" under the story and a "Capture frame"
export (R11); mobile map apps shrink the field to the top ~55% and move numbers below (Windy R01) or reduce the layer list to one chip (Ventusky R02);
the field was missing at 7 s on Ventusky and blank at 9 s on Worldview, so there must be a loading state and a no-WebGL still (R02, R05).

**P11. Local convention: the UAE already has a warning vocabulary and a script.**
Evidence: NCM (R07) uses a thin pale strip with an amber "تحذير" tag, Arabic Kufi (UI) and Naskh (body) at 11 to 16 px, RTL layout, and an English toggle.
Default units are a trap: Ventusky defaulted to °F for an en-US client (R02); the UAE audience needs °C set explicitly. Keep the
Arabic stack and RTL as first-class, not a mirrored afterthought.

**P12. Light and dark are both viable; the constant is neutral chrome and a thin structure.**
Dark: nullschool, Zoom Earth, Worldview, Tomorrow.io (R03, R04, R05, R11). Light: OWID, NASA EO, Columbia, FlowingData (R13, R06, R16, R14).
What they share: hairlines instead of boxes (R09, R13, R24), one accent chip at most (R10, R18, R12), and a page tint that stays out of the data
(no beige except the FT and Oura, which pair it with a serif).

---

## 8. Open items for the next pass

1. Capture the NWS HeatRisk **Verification** tab and any forecast-vs-observation scoreboard (the judge view has no reference yet).
2. Capture Globaia's interactive WBGT map (click-to-read pixel value) and ECMWF's published products with a longer settle on a real GPU.
3. Sample nullschool's temperature ramp from its in-app legend (not visible by default) to complete section 6.
4. Mobbin / Refero screens for worker-alert and crew-list patterns need a login (owner action).
5. Re-run the timing figures on a real GPU and a throttled network; SwiftShader inflates absolute numbers.
