# 02b. The three-layer information model

Date: 2026-11-17. Owner requirement: the main experience must never show a file path, a function name, a hash, "Not recorded" or an internal markdown path to an investor, a contractor, a regulator or a worker. Auditability must survive, as an opt-in layer. This document is the model and its application; `01b-content-audit.md` has the wording, `05-build-plan.md` has the slices.

## 1. The model

| Layer | Who it is for | What it holds | What it must never hold | How you get there |
|---|---|---|---|---|
| A. Story | Everyone, first | Plain sentences about people and hours: the problem, what the product does, what we found, what we do not know. Reading level about grade 8, sentences up to 20 words, no codes | Paths, function names, hashes, ids, internal vocabulary (P0 to P3, H4, theta, epoch, protocol line), empty fields | The landing, the tour, the plain "Where this number comes from" lines |
| B. Product | Worker, crew lead, safety officer, judge trying it | Role-based screens that do a job: Today, crews, plan, Stop work, join, setup, governance refusal | The same prohibitions as A, plus no demo scaffolding mixed into working screens | The front door, the role entries |
| C. Evidence ("For auditors") | The minority who ask "prove it" | The full technical record, exactly as today: protocol line with link, script and commit, result file, SHA-256 fingerprints, model id, generated time, the lock and its amendments, the verbatim verdict sentences, policy codes and theta values, and the in-browser recount | Anything without a value (no "Not recorded"), and no claim that is not also in A | One deliberate step from any number: "For auditors". Collapsed by default. Visually separate (its own heading, mono type, a different surface), so a reader always knows they have crossed a line |

Rule of descent: A to B to C only by the reader's own action. C never appears unrequested. A and B never link a reader into C without the words "For auditors".

Rule of consistency: every statement in A must be derivable from C. The test for this is in section 6.

## 2. "Where this number comes from": the plain line

This replaces the "Proof" chip and the proof drawer's content. The chip reads "Where from" (visible text; the accessible name is "Where this number comes from: {what}"). It opens a drawer (a bottom sheet under 768 px) with a title and five short lines, then a quiet link "For auditors".

| Line | What it says | Source in the data |
|---|---|---|
| Made by | Who or what produced the number, in plain words | Label and claim family (fixed phrases per family) |
| About | Which place, which period, which hours | Claim parameters (site, dates, working-hours window) that the page already has |
| How we counted | One or two sentences defining the thing counted | Fixed phrase per claim family |
| It shows | The question this number answers | Fixed phrase per family |
| It does not show | The honest limit | Fixed phrase per family; mandatory, never empty |

Plus: a likely range when one exists ("Likely range 27.0 to 66.0"), and the label as a stamp in plain words ("Real weather, assumed crew of 20", "Simulated crew", "From a recorded forecast").

The sentences come from a small catalogue keyed by claim family (policy, plan, day, forecast, frontier, worker level), not from the record. That is the structural fix for a data-driven leak (rule 13: structure over prompt tweaks): the plain text can never contain a path because it is never built from one. The catalogue lives under `states.proof.story.*`, a Tier 2 prefix (English by design, `states.proof.` is in `CLAIM_PREFIXES`), so it costs no translation.

### Worked examples (copy, US English; numbers are ledger numbers)

Example 1: a scoreboard cell, `policy.p3.missed_danger_hours` (ledger `warn.l1.P3_protect.missed_danger_hours` 45.5, interval 27 to 66.01):

> **45.5 danger hours missed**, Stellar Blaze, protective setting
> **Made by.** Our correction of the European weather centre's (ECMWF) forecast, made the day before.
> **About.** Abu Dhabi airport, 15 May to 30 September 2026, working hours. 139 days.
> **How we counted.** An hour is dangerous when the station's own instruments put it in the regulator's High or Red zone. We count the dangerous hours we did not warn about the evening before.
> **It shows.** How many dangerous hours our warnings missed in one summer at one airport. Likely range 27.0 to 66.0 hours.
> **It does not show.** How workers fared, or how this performs at a worksite or at a new site.
> Real weather. Tested on summer 2026; every setting was chosen using 2024 and 2025 data only.
> For auditors

Example 2: the worker's "Why Orange?":

> **Orange for Mussafah M-14 yard, until 17:00** (demo site)
> **Made by.** The day-ahead forecast, adjusted by Stellar Blaze, turned into one of four levels using the published ADOSH heat zones.
> **About.** The whole site, not you. Your own limit can be higher or lower.
> **What to do.** Work 20 minutes, rest 40 minutes in shade, from the published ADOSH work-and-rest table.
> **It does not show.** A medical judgment. The wording has not yet been checked by a clinician.
> For auditors

Example 3: the day, `day.p3` (ledger `demo.p3_hits` 6, `demo.high_hours` 7, `demo.date` 2026-06-14):

> **6 of 7 High-zone working hours warned about**, Stellar Blaze, protective setting, 14 June 2026
> **Made by.** Our correction of the day-before forecast.
> **About.** Abu Dhabi airport, one day chosen by a fixed rule from the station's records alone, before we looked at our own results.
> **It does not show.** Skill. One day is an illustration. The fixed 32 °C rule warned about all 7 hours that day.

Example 4: an incomplete record (replaces "Not recorded" and the amber MissingProvenance): one plain sentence at the bottom of the drawer, only when something is genuinely missing: "Some technical details for this number were not recorded. The figures above are unaffected." If the missing item is one the number cannot be shown without (as today's rule: no complete provenance, no number), keep the existing behavior: do not show the number, and say "This number is not shown because its record is incomplete."

## 3. The auditor layer ("For auditors")

Entry points: a quiet link at the foot of every "Where this number comes from" drawer; the footer of the landing and of every judge page; the `/replay/proof/[claim]` URL stays as is (tests and links keep working); optional index page `/replay/audit`.

Content and rules:

1. Heading "For auditors: the full record". One sentence: "The technical record behind this number, for anyone who wants to check it."
2. A `<details>` element, collapsed, inside the sheet page; in the drawer it is a link to the sheet's auditor section (`#audit`), so the drawer stays short.
3. Fields: Protocol (with the link when `PROTOCOL_BASE_URL` is set), Script and commit, Result file, Fingerprint of the file, Fingerprint of the input data, Model id, Generated at, Lock and amendments (scored claims only), Verbatim verdict sentence (verdict claims only), Policy code and threshold (policy claims only). Mono type, `break-all`, small, as now.
4. Hide-empty: a field with no value is not rendered, and no placeholder replaces it. The string `states.proof.notRecorded` is deleted.
5. The in-browser recount button lives here only, with its current behavior (only for files under `/data`, "unpublished" note otherwise).
6. The timeline ("Forecast made, Protocol committed, Scoring run, Shown here") is shown here, only for claims that have a scoring run, with three steps that cannot contradict: "Plan written down and locked", "Scored once on summer 2026", "Shown here as scored". For a recorded-forecast count, no timeline.
7. If a test plan link is needed by auditors and `PROTOCOL_BASE_URL` is null (it is today: "no public URL for it yet"), the auditor layer must not print a repo path that a reader cannot open. Owner decision: publish a static copy of the locked plan and its three amendments under `/audit/` (a build-time copy of the markdown rendered as HTML), or link a public repository, or say nothing. Recommended: static copy, because a judge asking for evidence should not have to find a repository.

## 4. Applying the model, screen by screen

| Screen | Layer A and B change | Layer C |
|---|---|---|
| Landing | Role door; story sections; at most three "Where from" lines (the cold bars of the evidence beat); the 18 chips become 3 plain chips | Link in the footer to For auditors |
| Scoreboard `/replay` | Plain policy names, no codes; "Where from" chip per column header, not per cell (10 chips become 2); plain verdicts; the regulator-zones sentence | Per-cell proof sheets keep working at `/replay/proof/<claim>`; codes and theta there |
| One day `/replay/day` | Plain counters; the rule in one sentence | The rule's protocol anchor, the day file hash |
| Proof `/replay/proof/<claim>` | Becomes "Where this number comes from": the five lines, the stamp, a "Back to the scoreboard" link | `<details>` For auditors with the full record |
| Try a plan | "Rule checker" wording; clause names written as the rule's own name and article | The validator's input and output record |
| Governance | Already plain; "epoch" removed | The hash-chain details |
| Worker Today, "Why Orange?" | Example 2; no function name ("get_site_forecast_today"), no `policy=... config=...` | For auditors link inside the drawer; hidden for a worker unless they tap it |
| Supervisor plan | Clause citations as human names ("ADOSH Technical Guideline, Table 1"); site duties moved here | Clause ids and ruleset version |
| HSE week (later) | k-suppressed cells explained in one sentence | Suppression rules |

Note on the worker drawer: `proofFromForecast` currently fills `protocol` with `policy=<version> config=<n>` and `script` with the API operation name. These leak to workers today.

## 5. What changes in the code (summary; details in 05)

1. `components/provenance/proof.ts`: add `ProofStory` and a pure `buildStory(family, params)`; keep every existing field (nothing the auditors see disappears). `Proof.story` is required for any proof shown outside the auditor layer.
2. `ProofRows.tsx`: split into `StoryRows` (new, plain) and `AuditRows` (existing rows, null-skipping, no placeholder).
3. `ProofChip.tsx`: label "Where from"; same dynamic-import drawer behavior.
4. `ProofDrawer.tsx` and `ProofSheet.tsx`: story first, auditors second.
5. `story-steps.ts`: remove the "proof" step (see 02 and 05).
6. Messages: new `states.proof.story.*` and `states.proof.audit.*` keys (Tier 2); delete `states.proof.notRecorded` and the "Not recorded" paths; rename English labels; the four `judge.proof.timeline.*` strings are reused only in the auditor layer.

## 6. Tests that keep it honest

1. Jargon lint (from 01b section 5) over Story and Product namespaces, and over the rendered output of `buildStory` for every claim family.
2. Consistency: for each of the five claim families, a unit test renders the story for a fixture record and asserts that every number and every "met or not met" word in it equals the structured field it was read from (and therefore the ledger value for the committed fixtures).
3. No empty field: render AuditRows for a record with every nullable field null; assert no "Not recorded", no empty `<dd>`.
4. e2e: tap a chip on the scoreboard, assert the drawer contains "Where this number comes from" and does not match `/[A-Za-z0-9_-]+\.json|[0-9a-f]{40,}|src\//`; tap "For auditors", assert the technical record appears.
5. axe on the sheet and drawer in the three themes the app has (night, sun, and reduced-motion).

## 7. What this does not change

The facts, the numbers, the labels' meaning, the rule that a number without a complete record is not shown, the recount, and the hash chain. The model changes what a stranger meets first, not what an auditor can verify.
