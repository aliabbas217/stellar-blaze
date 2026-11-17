# ADR 0032: Reject CCTV and per-worker computer vision (PPE detection, pose-to-workload, thermal cameras)

- **Status:** Accepted
- **Date:** 2026-11-10 (plan E3; recorded as an ADR 2026-11-11)
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none
- **Evidence:** `docs/context/challenge-07-plan.md` E3, E5 ("Will not do (added)"), §6 non-goals and anti-goals; `docs/research/2026-11-11-roster-stakeholders-and-compliance.md` §2.10 (surveillance concerns), §6.1 (PDPL); roadmap §6 (governance slide "why we rejected cameras")

## Context
The challenge text warns against surveillance and employment misuse. Plan E3: Abu Dhabi's city cameras (Falcon Eye) are state-run with no access route; worksite cameras belong to employers; the PDPL lets employers skip consent for "employment rights" purposes, which is exactly the misuse risk. PPE detection reads as disciplinary and its main datasets are non-commercial; no validated pose-to-workload method was found; thermal cameras are poor at absolute body temperature (bias about −1.4 °C).

## Options considered
| Option | Verdict |
|---|---|
| CCTV integration | Rejected: no access route; surveillance |
| PPE detection, pose-to-workload, thermal cameras | Rejected: not heat prevention / no validated method / inaccurate |
| No camera input; show the restraint on a governance slide (chosen) | Accepted |

## Decision
No camera, video or per-worker vision input anywhere. The planner takes no physiology, GPS or camera input (ADR 0011 §7.7). The deck has a "why we rejected cameras" slide.

## Consequences
- The only remote-sensing idea (Landsat, no worker data) is also cut (ADR 0013), so the submission has no computer vision at all.
- **Cost of being wrong:** loses automated workload estimation that could tighten NIOSH limits per task. Accepted: workload comes from task metadata entered by the supervisor (audited input).

## Revisit trigger
Pilot-only, employer-controlled, consented, after a separate governance review; or a validated pose-to-workload method is published.

## Links
[ADR 0011 §7](0011-heat-aware-planner.md) · [ADR 0013](0013-cut-landsat-site-heat-layer.md)
