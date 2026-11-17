# ADR 0013: Cut the Landsat land-surface-temperature site heat layer

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none (narrows plan §8.13 and E5 "should have")
- **Evidence:** `docs/research/2026-11-11-judges-and-wow-moment.md` §0 item 6, §3 (row "Landsat heat layer; 3D site view"), §10; `docs/research/2026-11-11-claims-verification.md` §8; `docs/context/challenge-07-plan.md` §8.13, E5; roadmap "Decisions recorded 2026-11-11" (judges doc v2 adopted); ADR 0010 Evidence line ("cuts approved")

## Context
Plan §8.13 made Landsat 8/9 LST a should-have site context map (the only computer vision in scope). Claims §8 checked it: the licence is public domain, but the overpass is about 10:50 UAE time (it misses the 14:00-16:00 peak), thermal resolution is 100 m native on a 30 m grid (single shade structures are not resolved), and surface temperature is not air temperature or WBGT. Judges §3 scores it impact 1, distinctiveness 0, cost 1-2 days.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| Build the layer (Planetary Computer STAC, no Earth Engine) | 1-2 days; no criterion moved by more than 1 (Judges §3) | Rejected |
| One static image in the deck | Invites a "surface is not WBGT" question with no payoff | Rejected |
| Cut, keep the verified facts for a pilot (chosen) | Claims §8 facts stay valid | Accepted |

## Decision
Not built for the 20 Nov submission. The verified overpass, resolution and licence facts stay in claims §8 for later use.

## Consequences
- Frees 1-2 build-days for the wow path (ADR 0034). No computer vision ships at all (see also ADR 0032).
- **Cost of being wrong:** a judge who values site-level spatial context sees none; the supervisor view relies on station-cluster forecasts only. Low: the claim is already limited to held-out airport clusters (ADR 0005).

## Revisit trigger
A pilot site needs within-site shade or hot-surface planning, or an afternoon thermal source (an overpass near 14:00) is confirmed for the site.

## Links
[ADR 0034](0034-demo-strategy.md) · [ADR 0032](0032-reject-cctv-computer-vision.md) · [parking lot](../parking-lot.md)
