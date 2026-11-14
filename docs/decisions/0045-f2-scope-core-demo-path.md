# ADR 0045: F2 scope: the core demo path only (9 of the 24 prototype views); 15 views deferred, each with a trigger

- **Status:** Accepted (Ali, 2026-11-14). Flags F1-F9 below need his confirmation; none of them changes which nine views are in scope
- **Date:** 2026-11-14
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Narrows the screen scope that ADR 0034 §4, §5 and §7 and the v1 `HANDOFF.md` per-screen build list implied. It does not touch backend (B1-B3) scope
- **Evidence:**
  - The v2-final prototype, `docs/design/v2/prototype/` in the F1 worktree (`D:\dev\stellar-blaze-f1\docs\design\v2\prototype\`): `views.html` (the index: 24 views in five groups; with the index page itself the folder holds 25 HTML files), `BUILD-BRIEF.md`.
  - `docs/design/v2/ux/v2-journeys.md` §3.2, §4.2, §5.2, §6.2-§6.4, §10; `docs/design/v2/critique/final-critique.md` (36/48 against a 38 gate, 12 Nov; pages were edited after it, latest 05:58 against the critique's 05:43, and no re-score is on file).
  - `docs/design/HANDOFF.md` (F1 worktree; the per-screen build list gives an owner and a day for each v1 screen; F1 already owns Today, Alerts and Crews).
  - The F1 worktree routes on 2026-11-14: `frontend/src/app/[locale]/` has `(worker)/worker`, `(worker)/worker/alerts`, `(supervisor)/supervisor`, `(hse)/hse`, the root page, `offline` and `dev/specimen`.
  - Roadmap §1 (calendar), §7 (never cut), §8 (checklist), §9 (risks); ADR 0034 §1, §4-§9; ADR 0011, 0024, 0035, 0038; Judges v2 §3, §5, §8-§10.

## Context
- **Time.** Feature freeze is Wed 18 Nov 18:00, the internal deadline Thu 19 Nov, submission Fri 20 Nov (roadmap §1). On 14 Nov F2 has not started (Ali). The roadmap had F2 starting 14 Nov from the B3 Task 0 OpenAPI draft; B3 has no plan yet, so Task 0 has not started either.
- **Surface.** The prototype has 24 views: Worker 6, Supervisor 6, HSE and admin 2, Judges "the story" 5, Judges "go deeper" 5. Every view carries four or more states (journeys §10) and has to pass a render-and-critique design gate. The only independent critique on file scored the prototype below that gate.
- **What the judge sees.** ADR 0034 §1 fixes the spine: wow (scoreboard) → real work → potential. The judge's own path (journeys §6.3) uses the landing, the scoreboard, a proof chip, the story stepper, "try a plan" and the governance refusal; the product beat shows the worker card and the crews view.
- **What F1 already ships** (F1 worktree, 2026-11-14): worker Today, `worker/alerts`, a supervisor page and an HSE page as F1 built them.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| Build all 24 views to the v2-final prototype | F2 not started; freeze in four days; the design gate already failed once on the prototype itself (36 < 38) | Rejected |
| **Core demo path only: 9 views** (chosen) | Covers the judge's path (journeys §6.3), the two never-cut beats that are screens (scoreboard, governance refusal; ADR 0034 §9) and one worker and one supervisor view for the product beat | Accepted |
| Core path plus the safety-critical views (`worker-unwell`, `supervisor-plan` with Stop work) | Raised by the architect while writing this ADR; the nine views link to both and earlier text names both as never-cut (flags F1, F2). Ali did not weigh it | Open: decided by his answer to F1 and F2 |

## Decision
1. **F2 builds exactly these nine views**, to the v2-final prototype, with their states and the design gate:

   | # | View | Prototype file | Journeys id | Role on the path |
   |---|---|---|---|---|
   | 1 | Landing and story | `index.html` | L0 + story stepper | First click; the "problem" step |
   | 2 | Season scoreboard (Warnings and Plans rows) | `judge-season.html` | D1 | The wow (ADR 0034 §2) |
   | 3 | One day | `judge-day.html` | D2 | The pre-registered day |
   | 4 | Proof | `judge-proof.html`, plus the shared `ProofChip` and `ProofDrawer` component | D3 | Every number carries the chip |
   | 5 | Try a plan | `judge-validator.html` | D4 | The independent validator, live |
   | 6 | Worker today | `worker-today.html` | W2 | Product beat |
   | 7 | Worker alert | `worker-alert.html` | W3 | Product beat |
   | 8 | Supervisor crews | `supervisor-crews.html` | S1 | Product beat |
   | 9 | Governance refusal | `judge-governance.html` | D7 | Never cut (ADR 0034 §9) |

   "Proof drawer" in the decision is read as D3: the `judge-proof` page and the drawer component HANDOFF R4 puts on every number. The page count is nine only with that reading.
2. **The other 15 views are deferred, not cut.** They stay in `docs/design/v2/prototype/` as design assets; each has its own heading below and a row in `docs/parking-lot.md`.
3. **"Deferred" means:** F2 does not build or restyle the view. Pages F1 already ships stay as F1 built them. Nothing is deleted. This ADR governs F2 screens only: the B3 MUST set (planner, independent validator, sign-off and stop-work endpoints, governance, k-suppression, config admin API) is unchanged, and its evidence is tests and exported JSON, not screens.
4. **Links from the nine into deferred views** are resolved by F2 (hide the link, or point at the F1 page where one exists). The links are:
   - `worker-today` → `worker-alerts` (an F1 page exists), `worker-data`, `worker-join`, `worker-unwell`;
   - `worker-alert` → `worker-alerts`, `worker-data`, `worker-unwell`;
   - `supervisor-crews` → `supervisor-plan`, `supervisor-relay`, `supervisor-roster`, `supervisor-setup`;
   - the "What's next" link in the header of every judge page, and the "go deeper" row on `judge-validator` and `judge-governance` (→ climate, faults, frontier, next);
   - `index` → `admin`, `hse`, `supervisor-setup`, `judge-next`.

   The worker dock (the permanent "I feel unwell" control plus the Today, Alerts and My data tabs) is the one case that needs Ali's ruling (flags F2 and F9).
5. **Labelling.** A deferred view may appear in the deck or video only as a design asset labelled DESIGNED (ADR 0034 §7 status chips; Judges §9.2), never as a feature that exists.

## Deferred views
Each entry: what it is, why it is deferred, what the deferral costs, and the revisit trigger. Build-day figures are quoted only where a document on file gives one; "no estimate on file" means none exists. The re-entry order, when a trigger fires, is the order of the flags in the next section (safety first).

### Worker

#### 1. `worker-join`: join from the crew code, and "open in your browser" (W0 + W7)
- **What:** the crew-QR landing. `/worker/join?s&c` stores site and crew on the device and redirects to Today. Inside a WhatsApp or other in-app browser it shows "Open in your browser to get warnings on this phone" with Copy link, and the site level below it.
- **Why deferred:** not on the judge's path (journeys §6.3); the demo opens on a seeded site (Today's empty state offers "See the demo yard").
- **Cost of deferring:** nobody can scan in during the demo, so the zero-field first run (FR §2, journeys §3.3 steps 1-2) is shown only in the prototype. A link opened inside WhatsApp, where push does not work, gets no explanation (journeys U6). No estimate on file.
- **Revisit trigger:** the nine pass the design gate with time left before the freeze, or a pilot crew is onboarded by link.

#### 2. `worker-alerts`: turn warnings on, denied, iOS install card, unsupported (W6)
- **What:** the Web Push opt-in screen and its unhappy states (denied, iOS not installed, unsupported).
- **Why deferred:** F1 Task 7 already ships `/worker/alerts` (present in the F1 worktree). F2 would only restyle it.
- **Cost of deferring:** the denied and iOS-install states keep the F1 look. The roadmap §8 checklist item "Web Push delivered to a real Android phone; iOS install card shown" depends on the F1 page, not on this view, so it is not affected. No estimate on file.
- **Revisit trigger:** the real-phone Web Push check passes and the nine are green (restyle), or the F1 page fails that checklist item.

#### 3. `worker-unwell`: I feel unwell (W4)

> **Amendment 2026-11-14: no longer deferred.** Folded into worker Today as a call sheet (see Amendments below). The entry is kept as written.

- **What:** the emergency card. Step 1 call 998 (and the site first aider where set), step 2 move to shade, step 3 cool down, text from ADOSH CoP 11.0 §4.5(c) only; works offline; the clinical label per ADR 0035.
- **Why deferred:** the destination of the unwell message is an open decision (HANDOFF decision 2) and two content questions are open (HANDOFF Q1, Q2); the card needs the clinical review that ADR 0035 labels.
- **Cost of deferring:** the dock control "I feel unwell" on `worker-today` and `worker-alert` has no target, and the clinician-reviewed escalation card has no screen (flag F2). HANDOFF slots the view F2 15 Nov, "static, offline-cached; tel: links". No estimate on file.
- **Revisit trigger:** Ali answers flag F2. Otherwise first in line when the nine are green.

#### 4. `worker-data`: my data, who asked, remove my data (W5)

> **Amendment 2026-11-14: folded in part.** The worker access log is built inside the governance refusal view; "Remove my data" and the dock's My data tab stay deferred under this entry (see Amendments below). The entry is kept as written.

- **What:** the dated log of what is stored on the phone and who used or asked for it, including the refused employer request, and "Remove my data" behind a confirm dialog.
- **Why deferred:** it needs a B3 audit-read route for the device's subscription id (HANDOFF). The governance beat is carried by `judge-governance`, which renders the worker's view next to the 403.
- **Cost of deferring:** the audit row exists only as a panel on the governance page, not on a live worker screen (flag F9). "Remove my data" has no designed screen; F1 built the revoke logic, but its UI is outside the nine. The dock's My data tab has no target. No estimate on file.
- **Revisit trigger:** the B3 audit-read route lands and the nine are green, or Ali rules on flag F9.

### Supervisor

#### 5. `supervisor-setup`: new site, zero-form (S0)
- **What:** the short form (a preview card with defaults and provenance chips) plus the sentence-and-voice accelerator of ADR 0038 Tier B, with the GPU-less fail-closed refusal.
- **Why deferred:** the demo site is a seeded SIMULATED fixture (`backend/fixtures/demo_site.toml`, B3 notes §5). The independent critique rated this the weakest inner screen: it failed the hero, primary-action and time rules and its "Read it" button stalls on skeleton rows.
- **Cost of deferring:** no zero-form onboarding in the demo. ADR 0038 Tier B (voice site setup, SHOULD, gated) loses its screen: the 15 s video beat and the second governance beat (the refused mic, journeys §6.3 row 7) have nothing to run on (flag F8). HSE site setup (H0) is the same flow and is also absent. ADR 0038 Tier A (ports and tests, MUST) is backend and unaffected. No estimate on file.
- **Revisit trigger:** ADR 0038 decision D1 is made in favour of Tier B, or the nine are green with at least a day before the freeze.

#### 6. `supervisor-roster`: roster from a spreadsheet (S0b)
- **What:** CSV import. The file is parsed in the browser; the name column is detected and dropped before upload.
- **Why deferred:** depends on setup (view 5); not on the judge's path.
- **Cost of deferring:** the demo metric "CSV import leaks no names" (journeys §9: 0 name bytes uploaded, a network-capture test, FR-R21) has no UI to run against. No estimate on file.
- **Revisit trigger:** with `supervisor-setup`.

#### 7. `supervisor-qr`: crew codes (S0c)
- **What:** one QR code per crew to print or share; sets the crew language.
- **Why deferred:** depends on setup and join (views 1 and 5).
- **Cost of deferring:** with `worker-join`, the QR onboarding journey cannot be shown. No estimate on file.
- **Revisit trigger:** with `worker-join`.

#### 8. `supervisor-plan`: crew plan (S2)

> **Amendment 2026-11-14: no longer deferred.** Promoted to the tenth core view, with sign-off; Stop work also sits on supervisor crews (see Amendments below). The entry is kept as written.

- **What:** the plan timeline (work, ADOSH rest, Art. 18 break, ban, stopped), the floor banner, pay impact (display only), sign-off with per-item acknowledgement, and the **Stop work** control (no confirm dialog, 10 s undo, audit row, crews notified).
- **Why deferred:** it needs the most backend (B3 planner, validator, sign-off, stop-work endpoints), which lands 16 Nov at the earliest; the Plans row and "try a plan" already show the validator in the nine.
- **Cost of deferring:** there is no Stop work UI anywhere in the judged build. `supervisor-crews` copy says "Stop work still works from each crew's plan". The sign-off, floor-banner and pay-impact panels cannot be shown (flag F1). HANDOFF slots the view F2 16 Nov. No estimate on file.
- **Revisit trigger:** Ali answers flag F1. Otherwise second in line when the nine are green.

#### 9. `supervisor-relay`: relay to the crew (S3)
- **What:** a full-screen level, crew-language chips, audio, a name-free bulletin to copy, and a print-ready A5 card.
- **Why deferred:** needs the pre-rendered audio clips (HANDOFF) and is not on the judge's path.
- **Cost of deferring:** the in-app relay is the declared fallback if the real-phone Web Push spike fails (flag F3). No estimate on file.
- **Revisit trigger:** the Web Push spike fails or has no recorded result by the 16 Nov gate; or the nine are green.

### HSE and admin

#### 10. `hse`: HSE week (H1)
- **What:** the employer HSE officer's weekly view: KPI tiles, a site-by-day table with k-suppressed cells ("fewer than k"), URL filters and an aggregate-only export.
- **Why deferred:** employer-side, not on the judge's path; its evidence (suppression, no route to individual data) is B3 tests.
- **Cost of deferring:** k-suppression is shown nowhere on screen. The roadmap §1 row for 16 Nov ("F2 supervisor + HSE screens") narrows. F1's `(hse)/hse` skeleton stays as built. No estimate on file.
- **Revisit trigger:** the nine are green, or a judge-facing requirement names k-suppression as something to see.

#### 11. `admin`: runtime config (A1-A3)
- **What:** active config line, tunables editable within range, floors read-only, edit drawer with diff, history with rollback.
- **Why deferred:** already stretch item 5a in the roadmap §7 ("if it is cut, runtime tuning still works through the admin API and `sb-jobs config`"). This ADR does not change that.
- **Cost of deferring:** none beyond 5a. The ADR 0010 switch-and-rollback drill (roadmap §8) runs through the admin API and the CLI.
- **Revisit trigger:** as 5a: the nine are green and a day is spare, or a non-engineer must change a tunable (ADR 0010).

### Judges

#### 12. `judge-next`: what's next (D9)
- **What:** seven next steps on the calendar each depends on, with status chips exists, designed or needs pilot (Judges §9.2).
- **Why deferred:** static content, owner D (19 Nov) in HANDOFF; Judges §10 already says "it is a slide".
- **Cost of deferring:** about 0.1 day (Judges §9.2), moved to the deck. The story stepper's sixth step has no page and the "What's next" header link goes (ADR 0034 §7 says "a roadmap screen"; flag F7).
- **Revisit trigger:** the nine are green and day D (19 Nov) has an hour; otherwise the deck slide is the delivery.

#### 13. `judge-frontier`: roster frontier (D5)

> **Amendment 2026-11-14: no longer deferred.** Folded into the season scoreboard as a section (see Amendments below). The entry is kept as written.

- **What:** one chart of 14,596 legal roster templates, exposure against sleep, with a commute slider, the legalisation arrow credited to the law, and the verdict "no roster shape outruns the heat under law, sleep and commute".
- **Why deferred:** not on the shortest judge path; the finding is also stated in the technical document.
- **Cost of deferring:** artefact 3 of the real-work layer (Judges §8.1) is not on screen. The JSON stays: B3 component 12 copies `roster_frontier.json` into the replay snapshot (about 2 h, B3 notes). Marginal cost 0 days (Judges §10: it is an ADR 0011 MUST), so this is not a time saving but a scope narrowing (flag F4). HANDOFF slots it F2 15-16 Nov.
- **Revisit trigger:** Ali answers flag F4. Otherwise third in line when the nine are green.

#### 14. `judge-climate`: the same summer, warmer (D6)
- **What:** the real 2026 summer replayed at +1.5 and +2.0 °C global warming with a humidity range, stamped "sensitivity scenario on a real summer, not a forecast".
- **Why deferred:** SHOULD and first to cut (ADR 0034 §5, Judges §10 row 8). It also has no committed method: the pre-registration does not contain the climate-scenario method that ADR 0034 §3 listed (see the ADR 0034 amendment of 2026-11-14), and no AR6 ΔT has been extracted (Judges §7).
- **Cost of deferring:** the "potential" beat (25 s of the 3-minute spine) has no screen. ADR 0034 §5 already names the fallbacks: a static slide (0.5 day) or a roadmap line. The full toggle was 0.75 day (Judges §9.1).
- **Revisit trigger:** ADR 0034 §5 as written (the 16 Nov gate is green) and the method is committed first.

#### 15. `judge-faults`: break things (D8)
- **What:** fault toggles (lose the wearable, the network, the feed); each shows its fallback, "at least as safe as the midday break".
- **Why deferred:** the toggles should drive real service-worker and cache states (HANDOFF), which is integration work after the nine.
- **Cost of deferring:** the roadmap §7 never-cut item 7 and the §8 checklist item name this panel (flag F5). What survives as evidence: the B3 property test "fallback never less protective than the ban" (B3 notes AT-9) and the F1 offline end-to-end tests. HANDOFF slots the view F2 17 Nov. No estimate on file.
- **Revisit trigger:** Ali answers flag F5. Otherwise fourth in line when the nine are green.

## Flags: where this ADR departs from earlier text (Ali to confirm each)
Order is the suggested re-entry order. For each, Ali either narrows the earlier text (this ADR then stands) or restores the view.

**Safety actions with no screen**
- **F1. Stop work.** The control lives on `supervisor-plan` (journeys S2 step 7; HANDOFF `StopWorkButton`). Earlier text: roadmap §7 never-cut item 5 (the supervisor view with shift planning, B3 plus F2), ADR 0011 §7, the Judges §5 product beat, and the story stepper's "product" step (journeys §6.3 row 4: "supervisor plan"). The backend stop endpoints stay in B3.
- **F2. "I feel unwell".** A permanent dock control on the worker core screens (BUILD-BRIEF "every screen must" 2; HANDOFF `WorkerDock`) that links to deferred W4. Earlier text: Judges §10 row 10 (the clinician-reviewed escalation card, "Never" cut), ADR 0035. Options: remove the dock control from the nine, or build W4 in its minimum form (static, offline, `tel:` links, no send: HANDOFF decision 2 option b). This ADR does not choose.
- **F3. Crew relay as the Web Push fallback.** Judges §3 row 10 ("if it fails, in-app crew relay is the demo") and roadmap §9 ("crew relay become the primary demo path"). `docs/research/2026-11-13-web-push-spike.md`, where F1 Task 15 records the result, is not in this worktree.

**Earlier never-cut, MUST or scheduled text that narrows**
- **F4. Roster frontier chart.** ADR 0011 MUST (a static chart), ADR 0024 (the static frontier replaces the cut service), Judges §8.1 artefact 3, B3 notes §2 item 1.
- **F5. Break-things panel.** Roadmap §7 never-cut item 7, roadmap §8 checklist, Judges §3 row 8.
- **F6. HSE screens.** Roadmap §1, the Mon 16 row. No never-cut item is affected.
- **F7. Roadmap screen.** ADR 0034 §7 says a screen; Judges §10 row 9 says a slide. The ADR 0034 wording narrows to the slide.
- **F8. ADR 0038 Tier B.** The only screen that hosts it is deferred, while ADR 0038 is still Proposed with decision D1 open.
- **F9. Governance on the phone.** ADR 0034 §9 and Judges §10 row 4 say the worker's phone shows the audit row. D7 (in scope) shows the worker's view as a panel next to the 403; the live worker screen (W5) is deferred. Confirm that the panel satisfies "never cut".

## Consequences
- F2's time to the 18 Nov 18:00 freeze goes to nine views, each through the design gate; the surface that has to be fixed after the 36/48 critique shrinks from 24 views to 9.
- The product beat of the three-minute spine (Judges §5, "Product + governance") can show only what the nine views and the F1 pages show. The deferred views are design assets and are labelled DESIGNED wherever they appear (Decision 5).
- **Cost of being wrong.** Too narrow: judges scoring "working solution" and "responsible AI" meet a build in which the two actions a crew lead and a worker need first, Stop work and "I feel unwell", have no screen (F1, F2). Too wide: F2 does not finish the nine, and the scoreboard and governance beats (ADR 0034 §9), which are the wow, are at risk. The flags put the two safety views first in line so that a wrong cut is cheap to reverse: both exist as finished prototype pages.
- The deferred prototype pages exist only where the prototype directory is committed. On 2026-11-14 it lives in the F1 worktree, and an earlier read-only status of that worktree listed other `docs/design/` paths as untracked; whether `docs/design/v2/` is committed was not verified. Until it is, "deferred, not cut" rests on an uncommitted folder.
- The other worktrees (`stellar-blaze-b2`) hold their own copy of `docs/decisions/`. The number 0045 is taken here; a B2 ADR must use 0046 or later.

## Revisit trigger
The nine views pass the design gate (render and critique at or above the gate) with time left before the 18 Nov 18:00 freeze: re-enter deferred views in the order of the flags. Or Ali confirms or reverses any of F1-F9. Or a judge-facing requirement or a pilot names a deferred view.

## Links
[parking lot](../parking-lot.md) · [ADR 0034](0034-demo-strategy.md) · [ADR 0011](0011-heat-aware-planner.md) · [ADR 0024](0024-cut-seasonal-roster-service.md) · [ADR 0035](0035-clinical-review-labelling.md) · [ADR 0038](0038-agentic-workflows-and-voice.md) · [ADR 0012](0012-decision-record-process.md) · [roadmap](../superpowers/plans/2026-11-11-roadmap.md) · [Judges doc v2](../research/2026-11-11-judges-and-wow-moment.md)

## Amendments

### 2026-11-14 (Ali, in chat): the scope grows from nine to ten core views, and four items are folded into core views; the text above is unchanged
Ali asked "what will be the best practice" for the safety and governance items this ADR left open (flags F1, F2, F4, F9). The architect's answer, which Ali adopted, was to fold all four into the core views so that the safety controls and the governance story are reachable, and to add the supervisor plan as a tenth core view. The settings admin API and the admin screen stay deferred.

**Evidence:** ADR 0011 sections 2.6 and 7.1; the prototype `supervisor-plan.html` ("Medium and High zone work needs a tick per item ... Signing never delays an alert or a stop") and `assets/crews.js` `ackItems` (F1 worktree, `docs/design/v2/prototype/`); B3 plan Tasks 10 and 17; ADR 0051 decisions 1 and 3; ADR 0054; ADR 0035.

**1. A tenth core view: `supervisor-plan` (S2), "supervisor plan with sign-off".**
- Prototype `supervisor-plan.html`, journeys S2. Supervisor crews links to it in the prototype.
- **Sign-off is one tick per run of the same warning level.** The prototype groups the blocks above Low into runs of consecutive same-level blocks and asks for one tick per run (`ackItems`). This amendment reads ADR 0011 section 7.1's "each changed or Medium/High item" that way.
- **Sign-off can never delay an alert or a stop** (ADR 0011 sections 2.6 and 7.1; ADR 0053 decision 1).
- Its backend is B3 plan Task 17, now MUST ([ADR 0053](0053-defer-sign-off-pay-impact-and-task-ordering.md) Amendments). The view leaves the deferred list (entry 8).

**2. Four items are folded into core views as sections or sheets, not new screens.**

| Folded item | Was | Now | Backed by |
|---|---|---|---|
| "I feel unwell" call sheet | Deferred view 3 `worker-unwell` (flag F2) | A sheet on worker Today (view 6) | Static and offline; no route. Read as the minimum form named in flag F2 (static, offline-cached, `tel:` links, no message sent), because Ali's words were "call sheet". If a message is to be sent, HANDOFF decision 2 and its Q1 and Q2 return. The ADR 0035 label applies either way |
| Supervisor Stop work | Part of deferred view 8 `supervisor-plan` (flag F1) | The control on supervisor crews (view 8 of the core list, S1) | `create_crew_stop` and `delete_crew_stop` ([ADR 0051](0051-api-v1-surface-for-the-core-demo-path.md)); no confirm dialog, 10 s undo, audit row, crews notified, as the prototype and entry 8 above describe; it never waits for sign-off |
| Roster-frontier chart | Deferred view 13 `judge-frontier` (flag F4) | A section of the season scoreboard (view 2) | The static `artifacts/eval/static/roster_frontier.json` (ADR 0051 decision 3); no route |
| Worker access log | Deferred view 4 `worker-data` (flag F9), in part | A section inside the governance refusal view (view 9) | `get_site_transparency_log` ([ADR 0054](0054-governance-refusal-and-hash-chained-audit.md)) |

**3. What is deferred after this amendment.** The 24 prototype views are now 10 core, 2 folded in whole (3 and 13), 1 folded in part (4) and 11 deferred. The 11 deferred entries keep their headings, text and triggers above: 1 `worker-join`, 2 `worker-alerts`, 5 `supervisor-setup`, 6 `supervisor-roster`, 7 `supervisor-qr`, 9 `supervisor-relay`, 10 `hse`, 11 `admin`, 12 `judge-next`, 14 `judge-climate`, 15 `judge-faults`; the remainder of 4 (Remove my data; the dock's My data tab) stays under its entry.
- **Stay deferred, stated plainly:** the crew relay (entry 9), the break-things panel (entry 15), the settings admin screen (entry 11) and, with it, the config admin HTTP API ([ADR 0052](0052-defer-config-admin-http-api.md); B3 plan Task 18 stays contingent). This is the architect's recommendation, adopted by Ali for now; **Ali can overrule any of them**, the admin screen and API included.

**4. Flags after this amendment.**

| Flag | Status |
|---|---|
| F1 Stop work | Answered: Stop work on supervisor crews; sign-off on the tenth view. The prototype's S2 page also carries a Stop work bar; whether the bar stays on both pages is not decided here (default: as the prototype, same endpoints) |
| F2 "I feel unwell" | Answered: the call sheet on worker Today. Open detail: the dock control on worker alert (view 7) needs the same target; Ali's words name worker Today only |
| F3 relay as the push fallback | Not answered: the relay stays deferred |
| F4 roster frontier | Answered: a section of the season scoreboard; the ADR 0011 static-chart MUST is met again |
| F5 break-things panel | Not answered: the panel stays deferred |
| F6, F7, F8 | Unaffected |
| F9 governance on the phone | Addressed: the worker access log is built inside the governance refusal view. Ali's answer to F9's own question (does the panel satisfy "never cut") was not recorded separately. The prototype's W5 also lists what is stored on the phone, which the site transparency log does not cover |

**5. Effect on the decision text above (which is not edited).**
- Decision 1, "exactly these nine views": read as ten, with row 10 `supervisor-plan.html`, S2, plus the four fold-ins.
- Decision 2, "the other 15 views are deferred": read as the 11 above plus the remainder of view 4.
- Decision 3, "the B3 MUST set (planner, independent validator, sign-off and stop-work endpoints, governance, k-suppression, config admin API) is unchanged": the sign-off and stop-work endpoints are kept and now have consumers; the config admin API is narrowed by ADR 0052 (accepted the same day).
- Decision 4, links: those into `worker-unwell`, `supervisor-plan` and `judge-frontier` resolve to the folded items; the dock's My data tab still has no target of its own; the other links are as written.
- Decision 5, labelling: the folded items are built, so they are not labelled DESIGNED.

**6. Consequences.**
- F2 has ten views and four fold-in items before the 18 Nov 18:00 freeze, and the design gate applies to each. The HANDOFF slots quoted in the entries above are worker-unwell 15 Nov, supervisor-plan 16 Nov and judge-frontier 15-16 Nov; no estimate is on file for the access log or for Stop work on crews.
- B3 gains Task 17 (+2.5 h): the MUST total goes from about 43.5 h to about 46 h, and the CP-SAT SHOULD is expected to be dropped (B3 plan header note).
- **Cost of being wrong.** Too wide: F2 does not finish the nine original views, and the scoreboard and governance beats (ADR 0034 section 9), which are the wow, are at risk. Too narrow was the cost recorded under Consequences above. This amendment records no cut order for the added items; the re-entry order above (safety first) and Ali's reason (the safety controls and the governance story must be reachable) argue that the call sheet, Stop work and the access log go last.

**Revisit trigger (added).** Ali re-scopes F2 again, or the design gate fails on an added item (which item goes is then his call).

### 2026-11-14 (citation erratum and pointer; the text above is unchanged)
Deferred-view entry 3 `worker-unwell` says "text from ADOSH CoP 11.0 §4.5(c) only". **§4.5(c) is a clause of the ADOSH-SF Technical Guideline "Safety in the Heat" v4.0, not of CoP 11.0.** Both PDFs were read on 2026-11-14 (MD5s in [ADR 0065](0065-unwell-flow-reconciles-with-cop-3-1-2e.md)): Technical Guideline §4.5 is "Heat Stroke" and (c) reads "First Aid, take the following steps to treat an employee with heat stroke: (i) Call emergency contact number and notify supervisor; (ii) Move the sick employee to a cool shaded area; (iii) Cool the employee using methods such as: 1. Soaking their clothes with water; 2. Spraying, sponging, or showering them with water; and 3. Fanning their body." CoP 11.0 has five sections (1 Introduction, 2 Training and Competency, 3 Requirements, 4 Record Keeping, 5 Document Amendment Record) and no §4.5. The step wording this ADR relies on is unaffected; only the document name is wrong. The same erratum is in ADR 0035 Amendments, the F2 plan, and the judges research doc.

Pointer: the same read found CoP 11.0 cl. 3.1.2(e): "Employees shall ensure they report any symptoms of heat illness suffered by themselves or fellow employees to their supervisor immediately as per ADOSH-SF - Element 07 - Monitoring, Investigation and Reporting." It bears on step 1 ("notify supervisor"). The "call sheet" row in the table above said that if a message is to be sent, HANDOFF decision 2 and its Q1 and Q2 return. [ADR 0065](0065-unwell-flow-reconciles-with-cop-3-1-2e.md) answers it: the sheet offers three one-tap calls (supervisor, site first-aider, 998) and sends or logs nothing.
