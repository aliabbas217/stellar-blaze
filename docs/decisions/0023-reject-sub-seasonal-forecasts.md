# ADR 0023: Reject sub-seasonal (weeks 2-4) forecasts for decisions

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Records ADR 0011 v2 §10 row 4 as a standalone decision
- **Evidence:** `docs/research/2026-11-11-roster-feasibility.md` §2.6, §3.1-§3.3; `docs/research/scripts/roster/probe_seasonal_api*.py` and `results/anomaly_persistence.csv`; ADR 0011 v2 §10; `docs/research/2026-11-11-judges-and-wow-moment.md` §9.2 (roadmap line)

## Context
A weekly-to-monthly horizon needs forecasts beyond day 7. Feasibility §3.1: Open-Meteo's seasonal API (EC46, SEAS5) keeps only the last 32 days (`past_days`), so no 2024-2026 back-test is possible; NOAA GEFS has an archive, but a control-member back-test is about 20,000 range requests and 4 GB with a GRIB reader untested on Windows. The data's own weekly WBGT-anomaly autocorrelation is 0.22 at lag 1 and about 0 at lags 2-3 (§2.6). Published skill at weeks 3-4 is close to climatology, and no Gulf humidity or WBGT result was found (§3.2). Even perfect weekly knowledge is capped by ADR 0022's ceiling.

## Options considered
| Option | Verdict |
|---|---|
| EC46 via Open-Meteo, live | Rejected for decisions: cannot be validated; non-commercial free tier |
| GEFS / CFSv2 back-test | Rejected for 20 Nov: multi-day build |
| ECDS S2S account (reforecasts) | Parked: account not tested |
| No sub-seasonal input; roadmap line only (chosen) | Accepted |

## Decision
No week 2-4 forecast drives any decision or display in the submission. A live EC46 panel is allowed later only as context labelled "unvalidated", outside every safety decision.

## Consequences
- **Cost of being wrong:** if Gulf WBGT skill at weeks 2-4 turns out to be real, employers lose early warning for workforce planning. Low for safety (day 1-3 drives warnings), moderate for the commercial story.

## Revisit trigger
An ECDS S2S account or a GEFS reforecast back-test is funded post-submission; published Gulf WBGT or humidity skill at weeks 2-4 appears; an open EC46/GEFS hindcast archive becomes back-testable.

## Links
[ADR 0022](0022-reject-weekly-and-daily-re-roster.md) · [ADR 0011 §10](0011-heat-aware-planner.md)
