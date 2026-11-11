# ADR 0014: Cut the 3D (three.js) site heat view

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none (narrows plan §6 "should have" and §8.11 "three.js for the 3D site heat view")
- **Evidence:** `docs/research/2026-11-11-judges-and-wow-moment.md` §0 item 6, §3, §10; `docs/research/2026-11-11-frontend-platform.md` §6.2 (3D "out of scope for this decision"); ADR 0003 (route JS budget); roadmap §7 stretch item 9 and "Decisions recorded 2026-11-11"

## Context
The plan listed a 3D site heat view as should-have, and the brief mentioned three.js. Its only spatial data source would have been the Landsat layer (cut, ADR 0013). Judges §3 scores it impact 1, distinctiveness 0, 1-2 days.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| R3F / three.js scene in the supervisor view | 1-2 days; no data to put in it once Landsat is cut | Rejected |
| 2D site plan or GeoJSON map (frontend doc §6.2, MapLibre, no tiles) | Should-have only, not on the wow path | Not decided here; F2's call |
| Cut (chosen) | — | Accepted |

## Decision
No 3D view in the submission. `three` is not added to `frontend/`.

## Consequences
- The parking-lot scaffold row "(+ three.js)" resolves as "three.js not scaffolded".
- **Cost of being wrong:** loses a visual effect that obvious entries may show. Mitigated because the chosen wow is evidence, not visuals (ADR 0034). Near-zero technical risk.

## Revisit trigger
A pilot supplies site geometry plus a spatial heat source worth showing in 3D, or a 2D view fails a user test for spatial understanding.

## Links
[ADR 0013](0013-cut-landsat-site-heat-layer.md) · [ADR 0003](0003-frontend-single-nextjs-app-pwa.md) · [ADR 0034](0034-demo-strategy.md)
