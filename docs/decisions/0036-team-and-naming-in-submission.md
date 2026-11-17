# ADR 0036: Solo entrant; only Ali is named in the submission

- **Status:** Accepted
- **Date:** 2026-11-10 (plan §7 "Team"; recorded as an ADR 2026-11-11)
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** supersedes `docs/context/competition-brief.md` line "Our team is 1–2 people" (the brief is not edited; this ADR governs)
- **Evidence:** `docs/context/challenge-07-plan.md` header ("Register under Challenge 07 as a solo entrant (the FAQ allows one to five members)") and §7 ("Team: solo. Ali builds everything. No consultant is named in the submission."); `docs/research/2026-11-11-claims-verification.md` §11 (Hack2skill rules); roadmap header (Ali as controller) and §8 (registration under Challenge 07 to confirm)

## Context
The competition allows 1-5 members. The brief anticipated a second person for the frontend; the plan settled on a solo entry. The clinical consultant reviews privately (ADR 0035). Implementation is done by Ali with AI coding assistance under his control.

## Options considered
| Option | Verdict |
|---|---|
| Two-person team (brief) | Rejected: no second member registered |
| Solo, consultant listed as advisor | Rejected: names a person who has not agreed to be named (ADR 0035) |
| Solo; only Ali named (chosen) | Accepted |

## Decision
- Registered and submitted as a **solo** entrant under Challenge 07.
- **Only Ali is named** in the submission form, deck, video and technical document. No consultant, reviewer or advisor is named; the clinical review uses the ADR 0035 label.
- Scope is sized for one builder (the cut ADRs 0013-0020 follow from this).

## Consequences
- **Cost of being wrong:** judges may weigh a solo entry's "path to pilot" as weaker than a team with a clinician or a business lead. Mitigated by the pilot one-pager and the roadmap screen (ADR 0034).

## Revisit trigger
A person agrees to join as a named member before submission (Hack2skill rules permitting), or the project moves to a pilot with a contracted team.

## Links
[ADR 0035](0035-clinical-review-labelling.md) · [ADR 0034](0034-demo-strategy.md) · [plan](../context/challenge-07-plan.md)
