# ADR 0012: Decision-record process (MADR-style, append-only, every cut/park/defer is an ADR)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali (owner); the architect (Claude) drafts
- **Supersedes / superseded by:** none
- **Evidence:** ADRs 0001-0011 (current format: Status, Evidence, Context, Decision, Consequences, Rejected options, Revisit trigger); `docs/parking-lot.md`; `docs/superpowers/plans/2026-11-11-roadmap.md` ("Decisions recorded 2026-11-11"); the erratum at the top of `docs/research/2026-11-11-roster-feasibility.md`

## Context
By 11 Nov the project had eleven ADRs, a 57-row parking lot and decisions made in chat that existed only as roadmap bullets. Many cuts (Landsat, 3D, LLM agents, B2 stretch arms) lived only in a research doc's ranking table; some parking-lot rows had a trigger but no recorded reasoning; ADR 0009, 0010 and 0011 carried "Proposed" although parts were accepted in chat. A superseded headline (34.6%) survived only as an erratum. Nobody reading the repo could tell, for any item, who decided it, on what evidence, and what would reopen it.

## Options considered
| Option | Verdict |
|---|---|
| Keep the parking lot as the only record of cuts | Rejected: a row has no options, no evidence trail, no cost of being wrong |
| Edit ADRs in place when decisions change | Rejected: loses history; a reviewer cannot see what a past build was built against |
| MADR-style ADRs, append-only once accepted, one per cut/park/defer, parking lot as an index (chosen) | Small cost per decision (half a page); full audit trail |

## Decision
1. **Template** (MADR-style; existing 0001-0011 stay as written):
   ```
   # ADR NNNN: <title>
   - **Status:** Proposed | Accepted | Superseded by ADR NNNN | Deprecated
   - **Date:** YYYY-MM-DD
   - **Deciders:** Ali; the architect (Claude)
   - **Supersedes / superseded by:** ADR NNNN or none
   - **Evidence:** <doc path §section, script, result file>
   ## Context            (the forces, with numbers)
   ## Options considered (each with evidence)
   ## Decision
   ## Consequences       (incl. "Cost of being wrong")
   ## Revisit trigger    (concrete, observable)
   ## Links
   ## Amendments         (dated, append-only; only when needed)
   ```
2. **Accepted ADRs are never deleted and their decision text is never rewritten.** A change is either an appended, dated **Amendment** note (clarification, status change, pointer) or a **new ADR** that supersedes it; the old one gets a dated "Superseded by ADR NNNN" status line and stays in place. Numbers are never reused. A **Proposed** ADR may be revised in place with a version note (as ADR 0011 v1 → v2 was), because nothing was built against it yet.
3. **Every decision to cut, park, defer or reject something is an ADR.** Grouping is allowed when the items share one context and one decision (each item gets its own heading so it is findable). When an existing ADR already carries the item's decision, evidence and revisit trigger, the index links to that ADR and section instead of duplicating it.
4. **`docs/parking-lot.md` is an index.** Every row links to its ADR. Rows are never deleted; a resolved row gets a dated note ("Built in B3, 2026-11-16" or "Superseded by ADR NNNN").
5. **Superseded numbers stay where they were published**, marked with an erratum that links to the ADR that superseded them (ADR 0033 is the first).
6. **Decisions taken in chat** are recorded the same day as an ADR (or an amendment). The roadmap's "Decisions recorded" list points to them.
7. **Index:** `docs/decisions/README.md` lists number, title, status, date and supersedes / superseded-by for every ADR. Each new ADR adds its row in the same change.

## Consequences
- 24 ADRs (0013-0036) are written today to record decisions already taken; 0010 and 0011 get dated amendment notes for what Ali accepted in chat.
- The "cost of being wrong" line forces each cut to say what a wrong cut would cost the submission.
- **Cost of being wrong:** about 15 min per decision. If the process is too heavy for a nine-day build, the failure mode is decisions skipped silently; the parking-lot index makes that visible (a row with no ADR link).

## Revisit trigger
A decision is found in chat, a plan or a research doc with no ADR; or the parking lot gains a row without an ADR link; or the team grows past one builder (add a review step for status changes).

## Links
[README index](README.md) · [parking lot](../parking-lot.md) · [roadmap](../superpowers/plans/2026-11-11-roadmap.md)
