# Why the inner screens fall short of the landing pages (and the fix)

**Date:** 2026-11-12. **Asked by Ali:** the Isotherm (A) and Watch (C) landing pages work; the worker Today, site setup and
inner screens do not, and he cannot say why. **Method:** the same first-fold measurements on every screen (Playwright,
computed styles, at the size each screen is used: landing 1440, worker 390, setup 1440 and 390), the screenshots in
`../directions/*/shots/`, the independent critique (`directions-critique.md`), and benchmarks below.

## 1. The measured gap (first fold only)

| Screen | Largest graphic, % of fold | Numbers on screen | Max type | Mono share of text | Buttons in fold (filled) | Time shown |
|---|---|---|---|---|---|---|
| A landing (1440) | **100 %** (the 3D field) | 8 | 60 px | 58 % | 4 (2) | 24 h scrubber |
| C landing (1440) | 26 % (column map) + panels | **87** | 48 px | 74 % | 1 (0) | 24 h timeline |
| A worker Today (390) | **0 %** | **1** | 76 px | 9 % | **8** (2) | "until 17:00" as text |
| C worker Today (390) | **0 %** | 19 | 64 px | 41 % | **7** (1) | hour strip, half below fold |
| A setup (1440) | 10 % (location map) | 1 | 40 px | 58 % | 2 (1) | none |
| C setup (1440) | 9 % | 19 | **22 px** | 51 % | 4 (1) | none |

Read across: the landings each have **one object that owns the fold** (a live field), real numbers and a time axis.
The inner screens have **no object at all** (0-10 % graphic), almost no numbers, up to 8 competing buttons, and time
appears only as a phrase. That is the whole difference Ali sees without being able to name it.

## 2. Diagnosis against the suspects (each confirmed or rejected with evidence)

| # | Suspect | Verdict | Evidence |
|---|---|---|---|
| 1 | No single strong idea on inner screens; they fall back to stacked rows | **Confirmed, the main cause** | 0 % graphic in the worker fold (A and C); setup is a ruled table of 7 fields. The landing's idea (heat as a physical field in time) stops at the landing |
| 2 | No clear primary action | **Confirmed** | A worker: 8 buttons in fold (6 language buttons, Listen, I feel unwell); C setup: 4. The filled button on the worker screen is the emergency button, so the everyday action has no emphasis |
| 3 | Weak hierarchy: what must a worker know *now*? | **Partly** | The level word is big (76 / 64 px), but the second thing a worker needs, *when the next rest is*, is a table row (A) or below the fold (C: first instruction at y = 704 of 844, critique §worker) |
| 4 | No sense of time (now → next break → end of shift) | **Confirmed** | No screen draws the shift. The midday break is a text row. The landing's strongest device, the hour scrubber, is not reused inside |
| 5 | Generic components (cards, pills, chips) | **Confirmed for C**, partly for A | C: 11 chips on the landing, 10 on setup, a tag on nearly every row; A: 9 provenance tags on setup. Tags were used as decoration, not information |
| 6 | Density mismatch | **Confirmed, both ways** | C landing 184 text elements, 114 under 12 px; A worker 32 elements and 1 number. The landing is dense, the inner screens are sparse, so they read as different products |
| 7 | No transitions connecting screens | **Confirmed** | Plain page loads; no shared element between landing → scoreboard → worker. The landing's motion stops at its edge |
| 8 | Type scale inconsistent with the landing | **Confirmed** | 7-9 distinct sizes per screen; landing display is 400 weight at 48-60 px, inner screens jump to 600 weight at 20-22 px with no display step; setup's largest type is 22 px |
| 9 | Weak iconography | **Confirmed** | Pictograms are hand-drawn approximations (critique: the rest-in-shade glyph is weak in A and B); none follow a tested ISO 7010 source |
| 10 | Missing states and feedback | **Confirmed** | Direction stills show the ideal state only; no loading, empty, error, stale or offline, and no feedback after a tap |
| 11 | Copy that explains instead of tells | **Confirmed** | "Design still: the level is a design state…", "Read by our own AI on our own server, never sent to another company…" in body text; worker instructions are full sentences where a verb + number would do |
| 12 | Wrong theme for the room | **New finding** | The worker screens were light-only, so they broke from the dark identity Ali chose. The sun-mode decision (DESIGN.md §6) fixes this: night by default, light only while the sun is up at the site |

## 3. Benchmarks (what the best equivalents do; we take the system, not the look)

| Our screen | Benchmark | What it does that we do not | Evidence |
|---|---|---|---|
| Worker Today (glance) | Apple Weather (iOS) | One number + one sentence, then an **hour strip** directly under it: time is the second element, not the fifth | Pattern known from the shipping app; Apple's guide page did not open on the Weather topic in our capture (`bench/apple-weather.jpg` shows the guide index), so this row is an inference |
| | Windy (`../research/refs/windy*.jpg`, references R01) | The timeline is the spine of the screen; everything is "at this hour" | Captured 2026-11-11 |
| | CARROT Weather (`bench/carrot.jpg`) | The anti-model: one big number + one sentence works, but with cartoon art it becomes the toy look v1 was rejected for | Captured 2026-11-12 |
| Worker alert / relay | NWS HeatRisk (R08) | Level number + name + one impact sentence + who is affected; no plate | Captured 2026-11-11 |
| Supervisor crews timeline | Flightradar24 (`bench/flightradar.jpg`) | Map or timeline first; a **ranked exception list** on the side ("most tracked"); a Playback control; live tags only where live | Captured 2026-11-12 |
| | Air-traffic flight-progress strips (public descriptions) | One row per object, time runs left to right, the controller reads exceptions, not rows | Pattern, not captured |
| Zero-form setup | Command palettes (Linear, Raycast) | One input, results appear **as you type**, structured, keyboard-first; nothing else on screen until needed | Linear docs and Raycast did not capture (DNS / timeout); pattern stated from the products, not from a capture |
| HSE week | NASA Earth Observatory anomaly calendars (R06), #ShowYourStripes (R17) | One calendar-shaped graphic of the whole period; colour only on data | Captured 2026-11-11 |

## 4. The fix: four rules every inner screen must meet (carried into DESIGN.md §5 and the journeys)

1. **One hero object, as strong as the landing's field**, built from real data and owning ≥ 35 % of the first fold.
2. **One primary action** (filled), at most one secondary; the emergency "I feel unwell" is a separate, permanent
   control in the dock and does not count as the screen's action.
3. **A time spine**: every operational screen draws time (now → next break → end of shift, or the day, or the week)
   with the **qaylula slot** (the legal 12:30-15:00 break) cut into it. The landing's scrubber, the worker's shift
   spine, the crew strips and the HSE calendar are the same component at different scales.
4. **A transition that links it to the previous screen**: cross-document View Transitions with shared names
   (`spine`, `level`, `wordmark`), so the landing's time axis becomes the scoreboard's season axis and the worker's
   alert becomes the Today spine. Reduced motion: no animation, same layout.

Plus: one type scale for all screens (DESIGN.md §4, 12 px floor, mono only for codes), tags only where the
information is the tag, states for every screen, and copy that tells (verb + number) with explanations moved behind
a "why" link or the proof drawer.

### Hero, primary action and time spine per screen

| Screen | Hero object | Primary action | Time spine |
|---|---|---|---|
| Worker Today | The **shift spine**: today's shift as a vertical band in heat colour, the qaylula slot cut in, a now line, and three waypoints with countdowns (now, next break, end of shift) | Listen (in my language) | The spine itself |
| Worker alert | The changed segment of the spine, enlarged, with the new level and its start time | Got it (acknowledge) | Spine segment |
| I feel unwell | One large call button + an elapsed timer since the tap | Call the first-aider | Elapsed time |
| My data | The access log as a vertical timeline (who, when, what, refused requests marked) | Remove my data | Log timeline |
| Supervisor crews | **Crew strips**: one row per crew across the day, exceptions sorted first, the qaylula slot through all rows, a now line | Relay to crew | Shared day axis |
| Crew plan | The plan as a strip of work / rest / break blocks against the heat curve, clause per block | Sign off | Day axis |
| Crew relay | Full-screen level word + the next two hours as a strip, readable at 3 m | Play to crew | Next 2 h |
| HSE week | A sites × days heat calendar with "fewer than k" cells | Export | Week |
| Admin config | The change history as a timeline with floors drawn as fixed lines | Activate | Version timeline |
| Zero-form setup | The **sentence is the form**: the typed sentence with each understood phrase underlined and wired to its field, which appears as you type; the site's forecast cell on a small terrain tile | Create site | The week the site runs, with ban status |
| Judge scoreboard, day, proof, validator, frontier, climate, governance, roadmap | Season ribbon / day chart / proof sheet / plan strip / frontier / paired ribbons / the 403 next to the worker's audit row / a time-ordered roadmap | One per screen (Next in story mode) | Season or day axis |

## 5. Before and after

Before: `../directions/isotherm/shots/worker-390.png`, `../directions/watch/shots/worker-390.png`,
`../directions/isotherm/shots/setup-1440.png`, `../directions/watch/shots/setup-1440.png`.
After: `../gate/after/` (written when the v2-final prototype is rendered; listed in the final report).
