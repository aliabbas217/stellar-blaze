# ADR 0026: Park the planner's modelling extensions (night work, sleep, commute, costs, validation scope)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Records the planner rows of `docs/parking-lot.md` that ADR 0011 v2 "Not doing now" points to; one heading per item
- **Evidence:** ADR 0011 v2 Context, §6, §7.3, §12, P-H11, Revisit trigger; `docs/research/2026-11-11-roster-stakeholders-and-compliance.md` §2.2, §3.3; `docs/research/2026-11-11-shift-regulations-and-sleep.md` §6.2; `docs/research/2026-11-11-roster-feasibility.md` §4, §7; roadmap "Decisions recorded 2026-11-11"

## Context
ADR 0011 v2 deliberately models only what the evidence supports by 20 Nov: legal templates, a clock-time sleep model with [I] buffers, one summer window (May-Sep) and airport stations. Each extension below lacks data, a cited method, or a legal answer. Shared context and decision; one heading per item.

## Items
| # | Item | Why parked (evidence) | Revisit trigger |
|---|---|---|---|
| A | Night-shift modelling beyond scoring (circadian, day-sleep quality, rotation, night premium, lighting/noise cost) | Night templates shown greyed as ineligible (0011 §6); evidence small and old (Nag 2001); costs unquantified (Stakeholders §3.3) | A pilot employer runs or plans permitted night work with day-sleep-ready accommodation, or counsel answers the Art. 19(3) question |
| B | Split-sleep crediting (midday sleep in cooled rooms) | No supporting evidence in the three planner research docs | A cited review on split/napped sleep in shift workers plus a pilot site with a midday bus run and cooled rooms |
| C | Multi-stage stochastic / robust rostering | Literature gain 0.3% (rolling horizon); no roster-level headroom in our data (Feasibility §4) | Roster-level headroom appears, or forecast errors grow materially |
| D | Commute and bus-waiting heat as an exposure term | No current Abu Dhabi commute data (Stakeholders §2.2) | A pilot site supplies bus timetables and waiting locations |
| E | Cost model for early/late/night work | No published figures (Stakeholders §3.3); shown as flags only | A pilot employer shares cost data |
| F | Calibration of the sleep buffers (45-min prep, 2 h evening) and the 7.5 h gate, 21:30 floor | [I] defaults (Sleep §6.2); residual gain swings 0-10% across floors | Consented sleep-diary or wearable study; contractor timesheets |
| G | Shoulder-season (Mar-May, Oct-Nov) replication | Only May-Sep measured | After 20 Nov, before any year-round claim |
| H | Site-sensor validation of the roster ranking | Airport stations, not worksites (Feasibility §7) | A pilot site with a WBGT sensor |
| I | Cross-employer crew rotation | Employer of record owns pay, transport and the duty (0011 P-H11) | A shared-labour agreement that counsel clears |
| J | Wage modelling | Pay deltas are display-only, never a gate (0011 §7.3) | A pilot employer provides pay rules and asks for cost-per-plan |

The Art. 18 strict reading is not parked here: ADR 0011 decides it (Review I2 disposition) behind a ruleset switch, with counsel Q1 as the trigger.

## Options considered
| Option | Verdict |
|---|---|
| Model A-J with assumed values | Rejected: each would add an [I] number to the pitch |
| Park with triggers; state the assumptions on the chart caption (chosen) | Accepted |

## Consequences
- **Cost of being wrong:** the frontier chart may misstate sleep for crews with very long bus waits (D) or split sleep (B); the caption labels the [I] values, and the pitch quotes only the robust numbers (0011 §11).

## Revisit trigger
Per item above.

## Links
[ADR 0011](0011-heat-aware-planner.md) · [ADR 0025](0025-park-planner-workflow-extras.md) · [parking lot](../parking-lot.md)
