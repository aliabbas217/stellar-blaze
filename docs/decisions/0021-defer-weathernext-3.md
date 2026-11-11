# ADR 0021: Defer the WeatherNext 3 arm to after the submission

- **Status:** Accepted (conditional, see Decision)
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Narrows plan E2/E5 ("could: the WeatherNext 3 arm if access arrives in time")
- **Evidence:** `docs/research/2026-11-11-claims-verification.md` §9 (access 5-7 business days; licence split; disclaimer wording); ADR 0005 Rejected options ("WeatherNext 3 arm"); roadmap §7 last line; `docs/parking-lot.md` row "WeatherNext 3 arm"

## Context
Access is by request form, "typically approved within 5-7 business days" (claims §9). From 11 Nov that lands on 18-20 Nov, after the 19 Nov internal deadline. Historic data is CC BY 4.0; real-time data falls under revocable terms "not intended for consumer use", with the disclaimer "not intended, validated, or approved for real world use". The repo does not record whether the form was submitted on 10 Nov.

## Options considered
| Option | Verdict |
|---|---|
| Wait for access and add the arm on 18-19 Nov | Rejected: lands after the internal deadline, no time to evaluate under the pre-registered protocol |
| Use it as a live forecast source | Rejected: real-time terms do not fit a worker-facing alert product (claims §9) |
| Defer: out of this submission unless access was requested on 10 Nov and arrives before B2 scores 2026 (chosen) | Accepted |

## Decision
WeatherNext 3 is **not in the submission** unless both conditions hold: the form was submitted on 10 Nov, and access arrives before the 12 Nov pre-registration is closed for 2026 scoring. The limitations section says it was not used. Any slide that shows WeatherNext output carries the full disclaimer.

## Consequences
- The AI-weather comparison rests on AIFS vs IFS (ADR 0020 keeps it).
- **Cost of being wrong:** misses a Google-model comparison that a Google-affiliated judge might value. Low to moderate; the IFS vs AIFS comparison carries the same "AI vs physics" story.

## Revisit trigger
Access granted: run it as a post-submission comparison on the archived (CC BY 4.0) data under the same protocol.

## Links
[ADR 0005](0005-data-truth-features-and-validation.md) · [ADR 0020](0020-cut-aifs-feature-corrector.md) · [ADR 0034](0034-demo-strategy.md)
