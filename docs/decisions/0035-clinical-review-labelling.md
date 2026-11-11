# ADR 0035: Clinical review of escalation cards by an unnamed independent consultant; labelling rule

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** supersedes the "signed by a named clinician" wording in `docs/research/2026-11-11-judges-and-wow-moment.md` §3 row 5 and §1.2 row 1 (that doc is not edited; this ADR governs)
- **Evidence:** roadmap "Decisions recorded 2026-11-11" (last bullet); `docs/context/challenge-07-plan.md` §7 "Team" and "Clinical content without a clinician on the team"; roadmap §6 (limitations: "messages not clinically reviewed unless a review actually happened"); `docs/research/2026-11-11-claims-verification.md` §7 (ACSM full text unobtainable; no clinical wording invented)

## Context
Judges §3 ranks a clinically reviewed escalation card 5th ("a strong clinical team will have one; we must not be weaker"). The team has no clinician (ADR 0036). Every clinical phrase is taken from a published source (NIOSH 2016, ADOSH-SF CoP 11.0, ACSM abstract) and cited. A clinical consultant has agreed to review the escalation cards and the design privately; the consultant is identified only in the roadmap's chat record.

## Options considered
| Option | Verdict |
|---|---|
| Name the clinician on the card and in the submission (Judges §3) | Rejected: the plan's rule is that no consultant is named; naming implies an affiliation and responsibility we have not agreed |
| No review; "not clinically reviewed" | Fallback only |
| Review by an unnamed independent consultant, dated label (chosen) | Accepted |

## Decision
- Scope of review: the escalation cards (ADOSH §4.5(c) call → move → cool) and the design.
- Label, only if the review actually happened: **"Reviewed by an independent clinical consultant, <date>"**. No name, no title, no institution, anywhere in the submission, deck, video or repo outputs.
- If the review has not happened by 17 Nov: label "not clinically reviewed", and the limitations section says so.
- The review never adds uncited clinical wording; changes go back to a cited source.

## Consequences
- **Cost of being wrong:** an unnamed review carries less weight with a clinical judge than a named one. Accepted to protect the consultant and to keep the claim exactly as large as the fact.

## Revisit trigger
The consultant agrees in writing to be named; or a pilot needs a formal clinical sign-off (then a named, contracted clinical lead replaces this rule by a new ADR).

## Links
[ADR 0036](0036-team-and-naming-in-submission.md) · [ADR 0034](0034-demo-strategy.md) · [roadmap](../superpowers/plans/2026-11-11-roadmap.md)
