# ADR 0019: Cut the adaptive (online) conformal arm

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none (ADR 0007 Consequences: "an adaptive (online) conformal arm is a B2 stretch")
- **Evidence:** ADR 0007; `docs/research/2026-11-11-data-availability.md` §3.3, §7 item 7; `docs/research/2026-11-11-judges-and-wow-moment.md` §3, §10; roadmap "Decisions recorded 2026-11-11"

## Context
Hourly weather is not exchangeable, and the May 2026 IFS 50r1 / AIFS v2 upgrade breaks exchangeability further (data doc §3.3). ADR 0007 handles this with time-blocked CQR per lead and hour band. An online arm would adapt during 2026, but it adds a second calibration story to explain. Judges §3: impact 1, 0.5-1 day.

## Options considered
| Option | Verdict |
|---|---|
| Add an online arm next to CQR | Rejected: no judged gain, and it risks muddling the pre-registered protocol (ADR 0034) |
| Cut; report per-stratum coverage on 2026 honestly (chosen) | Accepted |

## Decision
Not built. B2 reports CQR coverage per stratum on 2026 and lists the arm under "not done".

## Consequences
- **Cost of being wrong:** if 2026 coverage drifts after the model upgrade, we report the miss instead of fixing it online. Moderate for the "calibrated probability" claim; the fallback wording is already in Judges §4.5.

## Revisit trigger
2026 per-stratum coverage misses its nominal level (ADR 0007 trigger), or a production feed runs long enough to need online recalibration.

## Links
[ADR 0007](0007-ml-quantile-corrector-conformal.md) · [ADR 0034](0034-demo-strategy.md)
