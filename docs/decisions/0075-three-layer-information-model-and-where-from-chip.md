# ADR 0075: Three-layer information model; the proof chip reads "Where from"; the raw record lives only under "For auditors"

- **Status:** Accepted (owner decision, 2026-11-17) for the model, which was the owner's requirement and part of the redesign direction the owner approved. The chip wording and the Tier 2 placement are the architect's calls (owner informed in the controller's report of 2026-11-18).
- **Date:** 2026-11-18
- **Deciders:** Ali (owner); the architect (Claude)
- **Supersedes / superseded by:** none. Amends [ADR 0034](0034-demo-strategy.md) §4 ("proof chips on every number, generated from exporter `provenance` blocks") and [ADR 0045](0045-f2-scope-core-demo-path.md) decision 1, row 4 (the Proof page and the shared `ProofChip` and `ProofDrawer`): what the chip opens changes; the rule that a number without a complete record is not shown stays.
- **Evidence:** `docs/design/redesign-2026-11-17/02b-information-layers.md` (the owner's requirement and the model); `01-audit.md` and `01b-content-audit.md`; slice S1 on `integration/redesign`: `c265e06`, `9846491`, `9d297b3`, `31936fa`, merged by `b6dd1c2`. The bad state it fixes is in the message of `c265e06`: the drawer and sheet printed file paths, function names, 64-character hashes, "Not recorded" three times and a self-contradicting timeline, and the worker's drawer printed `policy=... config=...` and an API operation name.

## Context
The owner's requirement: the main experience must never show a file path, a function name, a hash or "Not recorded" to an investor, a contractor, a regulator or a worker, and auditability must survive as an opt-in layer.

## Decision
1. **Three layers.** Story: plain English about people and hours (design target: about grade 8, sentences of about 20 words or fewer, no codes). Product: role screens that do a job. Evidence: the full record, under "For auditors". A reader goes down a layer only by their own action. Story and Product never link into Evidence without the words "For auditors".
2. **The chip reads "Where from".** Its accessible name is "Where from: {what}", so it contains the visible text (WCAG 2.5.3). The sheet and drawer title stays "Where this number comes from". The redesign plan said "Where this number comes from: {what}" for the accessible name; the build changed it on purpose.
3. **The protocol line, script, commit, result-file path, SHA-256 fingerprints and model id never show outside the auditor layer.** This is structural, not a copy rule: the Story is built by the pure `buildStory(family, params)` in `components/provenance/proof-story.ts` from structured fields by fixed templates, never from a path, script or hash string and never from the scoring export's verbatim sentences. A path cannot leak because the text is never built from one.
4. **Hide-empty.** A field with no value is not rendered and no placeholder replaces it. `states.proof.notRecorded` is deleted. A record that lacks its file fingerprint says so once, in one sentence.
5. **Kept:** every existing `Proof` field; the rule that no complete record means no number (`ProofChip` renders nothing without a proof); the in-browser recount (auditor layer only); the `/replay/proof/[claim]` URL.
6. **Story words are Tier 2** (English by design, `states.proof.story.*`): see [ADR 0083](0083-tier-2-english-only-story-copy.md).

## Consequences
- Tests: `buildStory` per family against the committed 2026 files and the submission ledger; a jargon lint over the rendered story of every variant; a no-empty-field check over the auditor rows.
- **Cost of being wrong:** an auditor needs one more click; a Story sentence could drift from its record. The number-equality tests are the guard.
- **Open:** `PROTOCOL_BASE_URL` is `null`, so the locked test plan has no public URL. Publishing a static copy (redesign decision D6) is undecided.

## Revisit trigger
A Story sentence that cannot be derived from its record; D6 decided; an auditor or judge cannot find the record.

## Links
[ADR 0034](0034-demo-strategy.md) · [0045](0045-f2-scope-core-demo-path.md) · [0083](0083-tier-2-english-only-story-copy.md) · [02b](../design/redesign-2026-11-17/02b-information-layers.md)
