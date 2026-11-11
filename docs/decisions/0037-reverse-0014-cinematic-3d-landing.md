# ADR 0037: Reverse ADR 0014 for the judge landing: a cinematic 3D heat field of real IFS data, with a 2D fallback

- **Status:** Accepted (the reversal); the visual treatment follows the v2 direction Ali picks (amend this ADR on the pick)
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** supersedes [ADR 0014](0014-cut-3d-site-heat-view.md) for the judge landing only (0014's cut of a 3D *site* view in the supervisor route still stands). Does not change ADR 0034's wow: the scoreboard stays the wow; the 3D field is the opening frame that leads to it
- **Evidence:** `stellar-blaze-f1/docs/design/v2/critique/diagnosis.md` (why v1 read as a toy: no data, no place, no field on any screen, cause 8); `stellar-blaze-f1/docs/design/v2/research/references.md` R01-R05, §7 P1, P5, P10 (25 real products measured on 2026-11-11); `stellar-blaze-f1/docs/design/v2/directions/isotherm/` (built prototype + Lighthouse JSON in `docs/design/v2/gate/lh-isotherm-*.json`); data pull in `docs/design/v2/prototype/data/` (provenance fields inside each JSON); ADR 0003 (route JS budget); ADR 0034 §1-2

## Context
ADR 0014 cut the 3D view because (a) its only spatial source was Landsat, cut by ADR 0013, so there was "no data to put in it", (b) the judges doc scored it distinctiveness 0, impact 1, 1-2 days, and (c) the chosen wow is evidence, not visuals. Three things changed on 11 Nov:

1. **There is spatial data.** The Open-Meteo Previous Runs archive (already our feature source, ADR 0005) serves ECMWF IFS 0.25° day-1 forecasts at any grid point. A pull of 374 cells (22.5-26.5 N, 51.5-56.75 E) × 24 h for 3 Sep 2026, with WBGT computed by our own `stellar_blaze.domain.physics.wbgt.wbgt_liljegren`, took 7 requests and returned 0 rejected elements (range 20.9-39.3 °C). This is real, reproducible, forecast-as-issued data, not a mock-up.
2. **Ali rejected the v1 front end** as "a game or a UI for kids" and asked explicitly for mesmerising 3D on the landing. The diagnosis located the cause in signage styling and in the absence of any data, place or field on screen; the reference set shows that serious climate products earn gravitas from the physical field itself (nullschool, Windy, Worldview: references §7 P1, P5).
3. **The cost is measured, not estimated.** The Isotherm prototype (three.js, one module) scores Lighthouse 13.5.0 mobile performance **88 with WebGL and 94 on the 2D fallback**, accessibility 100, LCP 2.9 s / 2.1 s, TBT 60 ms / 0 ms, 741 / 675 kB transferred (local server; see Evidence).

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| Keep 0014: no 3D anywhere | The landing then has no field and no place; diagnosis cause 8; Ali's explicit ask | Rejected |
| Animated 2D map only (canvas or MapLibre, no WebGL dependency) | Lighthouse 94 on the 2D path; references R04 (Zoom Earth: static field, 604 kB) | **Kept as the fallback**, not the primary |
| Video loop of a pre-rendered 3D field | No interactivity, no hour scrubber, a second asset pipeline; P5 says a poster frame is enough as the fallback | Rejected |
| deck.gl / MapLibre 3D terrain with basemap tiles | Adds a tile provider and a style dependency; a basemap is not needed to show a 374-cell field; Worldview (8.3 MB) and Windy (LCP 4.0 s) show the cost of map stacks | Rejected for the landing |
| **Single three.js (R3F in production) scene of the IFS WBGT field, real data, 2D fallback, reduced-motion still (chosen)** | Prototype measured above; R3F is the default for Next.js 16 / React 19 (`@react-three/fiber@9`) per the web-3d skill; ADR 0003's route budget is protected by loading it only on the landing | Accepted |

## Decision
1. **The judge landing may carry one WebGL scene** that shows **only real data**: the IFS 0.25° day-1 WBGT field (or, per the picked direction, the OMAA season ridge built from the same archive). Every frame states its provenance (model, lead, day, physics) next to the number, and an illustrative day is labelled as illustrative; the scored day remains the pre-registered one (ADR 0034 §3).
2. **The wow does not move.** The 3D field is the opening frame; the scoreboard is reached in ≤ 2 clicks and is never behind the canvas.
3. **Budget (hard gates, checked in CI on the landing route with Lighthouse mobile):** performance ≥ 80 with WebGL and ≥ 90 on the fallback path; LCP ≤ 3.0 s; TBT ≤ 200 ms; CLS ≤ 0.1; landing route JS for the scene ≤ 200 kB gzip (three core + R3F, code-split, loaded after first paint); scene data ≤ 250 kB raw; DPR capped at 2 (1.5 on phones); vertices ≤ 6,000 desktop / ≤ 1,500 phone (or ≤ 400 instances for an instanced variant).
4. **Fallback and accessibility:** no WebGL, `?static`, a failed init or a performance monitor reading below 30 fps for 2 s → the 2D canvas map of the same field. `prefers-reduced-motion` freezes on the peak hour; the hour scrubber is a keyboard slider with text values; the canvas is `aria-hidden` and every reading it shows is also in DOM text. No scroll-jacking.
5. **Worker, supervisor and HSE routes stay WebGL-free** (ADR 0003's route budget and 0014's supervisor-view cut stand).

## Consequences
- `three` and `@react-three/fiber` become landing-route dependencies (versions checked on the build day; `three@0.186.1` used by the prototype, as 0.187.0 was under two weeks old on 2026-11-11). The parking-lot row "(+ three.js)" now resolves as "three.js on the landing route only, ADR 0037".
- A small exporter step is needed: the IFS field JSON for the replay day(s) (`docs/design/v2/prototype/data/` shows the format and the script inputs).
- **Cost of being wrong:** about 1 day of F2 time for the R3F port and the CI budget; a field is table stakes for some entries (ADR 0034), so if judges read it as "another heat map" the gain is aesthetic only. Mitigated because it is real forecast data with provenance and it hands off to the scoreboard. Technical risk is low: the fallback path alone passes the budget.

## Revisit trigger
The landing fails the budget in CI twice after optimisation; or a user test shows judges stay on the hero instead of reaching the scoreboard (median > 20 s before the first click to it); or the 16 Nov schedule gate needs the day (then ship the 2D fallback as the primary).

## Links
[ADR 0014](0014-cut-3d-site-heat-view.md) · [ADR 0013](0013-cut-landsat-site-heat-layer.md) · [ADR 0003](0003-frontend-single-nextjs-app-pwa.md) · [ADR 0005](0005-data-truth-features-and-validation.md) · [ADR 0034](0034-demo-strategy.md)
