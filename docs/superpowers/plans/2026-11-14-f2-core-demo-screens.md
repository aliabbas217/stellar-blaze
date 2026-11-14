# F2 Core Demo Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execution method is fixed:** subagent-driven, **Sonnet** implementers and **Sonnet** reviewers, a fresh reviewer per task, controller commits. Opus is never used without Ali's explicit per-use permission (ADR 0012 amendment 2026-11-14). Every dispatch brief says: "conventions and evidence win over this plan; you will be corrected, not punished, for saying so".

**Goal:** Turn the approved v2 "Qaylula" prototype into the ten core demo views of Stellar Blaze, built in the F1 worktree on the F1 infrastructure: landing and story, season scoreboard (Warnings, Plans, roster frontier), day zoom, proof drawer and sheet, try-a-plan checker, worker Today and alert (with the "I feel unwell" call sheet and sun mode), supervisor crews (with Stop work), governance refusal (with the worker's access log) and supervisor plan with sign-off.

**Architecture:** One Next.js 16.4.6 app, same route groups as F1 plus a `(judge)` group. Task 1 swaps the F1 "Arish Signal" tokens for Qaylula (night default, `data-theme="sun"` for field surfaces) before any screen work. Shared components (`LevelSign`, `TimeSpine` with the recessed midday slot, `ProofChip` and `ProofDrawer`, `ScoreboardTable`, isotherm hero charts) are built once and composed by the views. Screens render **real exporter JSON** (build-time imports with `provenance` blocks) and the **B3 `/api/v1` contract**; until B3 lands (routes 17 Nov), development runs on MSW handlers typed from the same contract, then the generated client is pointed at the real API.

**Tech Stack:** unchanged F1 pins (Next 16.4.6, React 19.3.1, TypeScript 6.0.3 strict, Tailwind 4.3.5 CSS-first, next-intl 4.14.9, TanStack Query 5.107.1, Zustand 5.1.0, openapi-typescript 7.13.0 + openapi-fetch 0.17.0, MSW 3.0.4, Vitest 5.1.0, Playwright 1.65.0 + axe 4.14.0, @lhci/cli 0.16.0, @google/design.md 0.4.0, Serwist 9.5.13). **No new runtime dependency is planned** (charts are hand-written SVG, the landing uses plain WebGL, URL state is a 30-line hook). A task that wants one stops and asks.

**Spec (executors read these, in this order):**
- `D:\dev\stellar-blaze-f1\docs\design\v2\DESIGN.md` (Qaylula), `v2\prototype\BUILD-BRIEF.md` (the seven "every screen must" rules), `v2\critique\inner-screens-gap.md` and `final-critique.md` (36/48 against a 38 gate; its top-10 fixes are requirements here), `v2\ux\v2-journeys.md` (§3-§7 journeys, §10 states, §12 rules), `v2\prototype\*.html` and `assets/{kit,heat,judge,crews}.js` (the reference implementation: copy structure and numbers, not code style), `docs\design\HANDOFF.md` (component inventory; its v1 token and light-theme items are superseded by v2).
- ADR 0003, 0004, 0009, 0010, 0011 (v2), 0027, 0034 (with its 2026-11-14 amendment), 0035, 0037, 0038, 0045 (being amended in parallel; **Ali's 2026-11-14 list in this plan wins**), 0046-0058; `docs/superpowers/plans/2026-11-14-b3-warnings-planner-governance-api.md` (Task 0 Interfaces are the wire contract; Task 17 sign-off); `2026-11-12-b2-forecast-corrector.md` Task 12 (`Provenance`); F1 plan and `D:\dev\stellar-blaze-f1\.superpowers\sdd\f1-summary.md` (47 rulings; invariants (a) and (b)).

**Branch and worktree:** `feat/f1-frontend-foundation` in `D:\dev\stellar-blaze-f1` (F2 commits on top of F1's 23; nothing is pushed or merged by this plan). Two lanes edit the same worktree, so the **controller-commit protocol** applies: implementers stage nothing and never run `git stash`, `reset`, `rebase`, `checkout -- <path>`, `clean` or `--no-verify`; on a tree holding changes they did not make they STOP and report; the controller commits per task by explicit path. Lanes touch disjoint files except the listed hazards (see Ordering).

> **Note 2026-11-14 (outcomes of decisions D1-D8, appended after the plan was written; no task text below is edited).** Recorded the same day under ADR 0012 rule 6, as relayed by the architect; Ali's own words are in chat, not in this repo. Where an outcome differs from a bracketed default or a task step below, the outcome wins.
>
> | Decision | Outcome | Record |
> |---|---|---|
> | D1 B3 Task 17 as MUST (C2) | Confirmed earlier the same day: sign-off is built in B3 and used by the tenth view | [ADR 0053](../../decisions/0053-defer-sign-off-pay-impact-and-task-ordering.md) Amendments; [ADR 0045](../../decisions/0045-f2-scope-core-demo-path.md) Amendments; [ADR 0051](../../decisions/0051-api-v1-surface-for-the-core-demo-path.md) Amendments |
> | D2 SW allow-list extension (C6) | **No.** The list stays the two patterns; supervisor views are online-only. Task 23 Interfaces (1)'s "unless Ali approves D2" branch does not apply | [ADR 0060](../../decisions/0060-offline-allow-list-stays-closed.md) |
> | D3 Listen (C8) | **Deferred**, as planned. No Listen button in F2 | [ADR 0061](../../decisions/0061-defer-listen-audio-action.md) |
> | D4 BFF demo employer token | **Accepted for the demo**: any visitor can act on the synthetic site. **Open:** no task yet for rate limits, a reset control or the "synthetic demo site" banner, and a reset cannot delete audit rows (ADR 0054); the architect assigns an owner before Tue 17 Nov | [ADR 0062](../../decisions/0062-public-demo-access-model.md) |
> | D5 Lighthouse sandbox | **`--no-sandbox`, CI runner only.** Task 25 Step 3 puts `chromeFlags` in `lighthouserc.json`, which also reaches local runs: set it where only CI reads it | [ADR 0063](../../decisions/0063-lighthouse-ci-no-sandbox-on-ephemeral-runner.md) |
> | D6 Clinical review of the unwell card by 17 Nov | The default stands: "Not clinically reviewed" until a review completes. The review pack for the consultant is prepared; the label "Reviewed by an independent clinical consultant, <date>" is used only after a completed review (ADR 0035 unchanged) | [`docs/clinical/review-pack.md`](../../clinical/review-pack.md) |
> | D7 Opus whole-branch review | **Sonnet only.** Already carried by the ADR 0012 amendment of 2026-11-14 (cross-link only, no new ADR); Task 27 Step 2 stays a Sonnet reviewer | [ADR 0012](../../decisions/0012-decision-record-process.md) Amendments |
> | D8 ADRs for invariants (a), (b) and the allow-list | **Written**, so Task 23 no longer blocks on D8 | [ADR 0059](../../decisions/0059-frontend-governance-invariants-sw-allow-list-and-revocation.md), [ADR 0060](../../decisions/0060-offline-allow-list-stays-closed.md) |
>
> Conflicts C3, C4, C5 and C12, and the `share_above_amber` removal, are recorded in [ADR 0064](../../decisions/0064-f2-demo-copy-and-data-rulings.md). **Task 27 Step 3:** the parking-lot row for the service-worker guard for the R38 window already exists ([ADR 0059](../../decisions/0059-frontend-governance-invariants-sw-allow-list-and-revocation.md)); do not add it twice. Rows for ADR 0060, 0061, 0062 and 0063 also exist.

## Global Constraints

- **Direction:** Qaylula (v2-final). Night is the default; `[data-theme="sun"]` is the high-contrast light theme for the worker and supervisor phone surfaces while the sun is above the horizon, and under `prefers-contrast: more`; one tap overrides until the next local midnight. Judge, HSE and admin routes are night only. Heat colour appears **only on data** (hero charts, spine cells); level marks only as the thin scale segment and a 10 px mark beside the level word; **no hatch, no filled level plate, no shadows, no glass, radius 2 px everywhere**; `--signal` (pale cyan) is the one UI colour; the recessed `--slot` is the only shape below the ground.
- **Type:** Archivo (tabular figures) for all Latin text, IBM Plex Mono only for codes, hashes and identifiers (at most 10 % of text nodes on a screen). Scale **12 · 14 · 16 · 18 · 22 · 28 · 36 · 48 · 64 · 76 px** (the prototype's 13 px step is dropped: critique fix 10). Floor 12 px rendered. Worker and supervisor phone screens: every time label and level label is **16 px or larger** (critique fix 4). Urdu line height 2.5, Naskh fallback, no fixed heights on Arabic-script text.
- **The slot is drawn only when the ban is in force.** Window and dates come from the API (`ban_window`, request R1; never a literal): 12:30 to 15:00, 15 Jun to 15 Sep inclusive local dates (ADR 0011, ruleset). Outside it: no slot on worker axes; a dashed, labelled outline on supervisor, judge and desk axes ("Midday break by law: not in force until 15 Jun"). The replay day is inside the window.
- **Every number has provenance or is not shown.** A scored number renders only with a `Proof` built from an exporter `provenance` block (ADR 0034 §4); no provenance renders `MissingProvenance`, never the value. Files that do not exist yet render `###` (tabular, `aria-label="not scored yet"`) under one `PendingBanner` per table, never per-cell glyphs (critique fix 1). Dev (2025 out-of-fold) files render only outside production and always under a `DEV 2025` stamp. Wording: never "compliant", "minutes avoided" or "illness prevented" (ADR 0034 §2; B3 constraint).
- **Headline wording:** forecasts are "made about 24 hours ahead" (ADR 0034 amendment 2026-11-14 item 1); "issued by 18:00 the evening before" appears only beside the lead-2 sensitivity. The held-out wording is "held-out 2026, every choice fixed on 2024-2025 data"; OMAA is a known site (regime a). The pre-registration is `661b373`; quote a date only after reading the commit.
- **Copy:** every user-visible string is in `messages/*.json` (`en` authored, five machine drafts, `_meta.review_status`); US English; no em or en dashes in visible copy; no ADR, HANDOFF, B2, B3 or request-id jargon in product copy except the request id itself on error states (critique fix 10); verb plus number ("Rest 40 min in shade every hour"), explanations behind "Why?" or the proof drawer. Times and numerals are Western digits in every locale (`numberingSystem: "latn"`), rendered in the site's `Asia/Dubai` zone, wrapped in `<bdi>` inside RTL text.
- **Governance (ADR 0004, 0050, 0054; F1 invariants):** personal risk and the worker profile never leave the device. **(a)** the service-worker runtime-cache allow-list changes only through Task 23's recorded decision; **(b)** revocation never reports success while data remains, and now also clears the site pin (the supervisor Stop outbox belongs to the supervisor role and is not touched by a worker revoke). Employer-scoped and token routes (`get_crew_day_plan`, `create_data_request`, `create_crew_stop`, `delete_crew_stop`, `sign_off_day_plan`, `get_site_transparency_log`) are `NetworkOnly`. A crew's level uses no member data; a suppressed crew still shows its level and "fewer than k people, health detail hidden".
- **Safety actions never wait:** Stop work and "I feel unwell" are always rendered, never inside a form, never disabled by sign-off, loading or offline state. Stop work has no confirm dialog and a 10 s undo; it is never shown as delivered when it was not; the server's `CrewStop` row is "recorded", not "crew alerted" (the API does not confirm delivery).
- **Types and state:** TS strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; no `any`; no `@ts-ignore` without a one-line reason. Server state in TanStack Query (query keys in `src/api/query-keys.ts`), global client state Zustand, URL state through `src/lib/url-state.ts` (**ruling: not nuqs**, the worker route family has 1,498 B of headroom, F1 summary; revisit after 20 Nov), form state local until a form needs RHF. RSC by default; `'use client'` as deep as possible.
- **Web interface guidelines (checked per task):** text inputs 16 px or larger on mobile; paste never blocked; loading buttons keep their label next to the spinner; submit is never pre-disabled; `:focus-visible` ring from `--focus`, never `outline: none` without a replacement; `transition: all` banned (named properties, 150 or 240 ms, `cubic-bezier(0.2, 0, 0, 1)`, opacity and transform only); tabular numerals on every number; `touch-action: manipulation`; the worker dock respects `env(safe-area-inset-bottom)`; skeletons mirror the final layout at final size; scroll containers are keyboard-focusable; `<meta name="theme-color">` follows the active theme; filters and the commute slider live in the URL.
- **A11y:** WCAG 2.2 AA (axe tags in `tests/e2e/axe.ts`, zero violations per route and state, both themes on field routes). Targets 44 px or more on field surfaces, 24 px or more elsewhere. Level is never conveyed by colour alone: word, position on the four-step scale, small mark. Charts are `role="img"` with an `aria-label` and have a table alternative one tap away; the landing canvas is `aria-hidden` and every reading it shows is also DOM text.
- **Budgets:** route JS 170 KB gzip (174,080 B, Lighthouse `resource-summary:script:size`) for every route; landing scene chunk and worker file inside the same total unless Task 25 measures otherwise; LCP at most 2.5 s (3.0 s on the landing, ADR 0037), CLS at most 0.1, TBT at most 200 ms, performance at least 0.9 (0.8 with WebGL, ADR 0037). Fonts self-hosted via `next/font`; nothing from Google at runtime (CSP `font-src 'self'`).
- **No voice:** no `getUserMedia`, no mic UI, no speech synthesis (ADR 0038: refused on the live URL; F1 `Permissions-Policy` already denies the microphone). No geolocation: sun mode uses the UAE centroid 24.4 N, 54.4 E (journeys O3), because `Site` carries no coordinates.
- **CSP and workers:** F1 policy stays (`worker-src 'self'`, `connect-src 'self'`, no `blob:`); the landing worker is a same-origin module worker. Any new origin needs a change in `next.config.ts` and its header test first.
- **Verification commands (from `frontend/`):** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm design:lint`, `pnpm api:check`, `pnpm build`, `CI=true pnpm e2e`, `pnpm exec lhci autorun`. pnpm 12.18.0 is called through its native binary on this host (F1 R9).
- **Evidence and conventions win over this plan.** If a step is wrong (an API name differs in the generated schema, a value contradicts an ADR), stop, show the evidence and propose the fix.

## Review Focus

Every reviewer reads this list and checks the owning task's tests cover its line.

1. **A number on screen without provenance, or a pending or dev number read as a result.** Expected: the value is not rendered; `###` plus one banner; a `DEV 2025` stamp; a production build with `SB_REQUIRE_SCORED=1` fails when a 2026 file is missing. Tests: Task 7 `test_counter_without_provenance_renders_missing` and `test_pending_table_has_no_cells_with_proof`, Task 6 `test_build_requires_scored_files`, Task 27 (final build with `SB_REQUIRE_SCORED=1`).
2. **The midday slot where the ban is not in force, or 30 minutes off where it is.** Expected: replay day draws 12:30 to 15:00; a November date draws none on worker axes and a dashed labelled outline on desk axes; the edges come from `ban_window`. Tests: Task 5 `test_slot_edges_from_ban_window`, `test_no_slot_out_of_season_field`, `test_dashed_outline_out_of_season_desk`; Task 16 e2e `out of season Today has no slot`.
3. **Stop work and sign-off interfering.** Expected: Stop works while a sign-off request is in flight or failed; offline it reads "Not sent: no signal. Tell the crew now."; undo inside 10 s calls `delete_crew_stop`; copy never claims the crew was alerted. Tests: Task 19 `test_stop_never_disabled`, Task 20 `test_stop_works_while_signoff_pending`, Task 23 `test_stop_outbox_survives_reload_and_never_reports_sent`.
4. **Right-to-left and Arabic-script layout.** Expected: Urdu and Arabic mirror the spine and waypoints, keep clock digits unmirrored and Western, never clip Nastaliq, and show the draft-translation badge. Tests: Task 5 `test_spine_mirrors_in_rtl`, Task 22 `test_no_fixed_height_on_text`, Task 26 e2e `ur worker today is rtl and unclipped`.
5. **Personal or employer data leaking to a shared device or a public caller.** Expected: no `day-plan`, `data-requests`, `stops`, `sign-off` or `transparency-log` response is in CacheStorage; the BFF injects the demo employer token only on the allow-listed method and path pairs of the demo fixture and strips any client `Authorization`; revoke clears the site pin. Tests: Task 2 `test_bff_injects_token_only_on_allow_list`, Task 23 e2e `no employer route is cached`, Task 16 unit `revoke_clears_site_pin`.
6. **Replay and live confusion.** Expected: `mode: "replay"` is stamped on every screen that shows forecast data; the replay clock is the API date at 11:10 Asia/Dubai (override `?at=HH:MM`); `forecast_status: stale | fallback` is never drawn as live; the forecast not covering "now" never yields a personal level. Tests: Task 3 `test_replay_instant_dubai`, Task 16 `test_stale_and_fallback_are_not_live`.

## Calendar and what is known on 14 Nov

| When (Gulf time) | Fact | Consequence |
|---|---|---|
| Sun 15 12:00 | B3 Task 0 merges the OpenAPI v1 contract | F2 swaps the mock contract for `backend/openapi/v1.json` (Task 2 last step, else Task 24) |
| Mon 16 | B3 Tasks 3-9 (domain only); no new routes | F2 builds on MSW |
| Tue 17 AM | B3 Task 10 (all read routes, validate, governance, stops) and Task 11 (alerts); Task 17 sign-off in the free lane | real wiring starts Tue afternoon (Task 24) |
| Tue 17 evening to Wed 18 AM | B3 Task 13 dev exports, Task 14 gated 2026 runs (Ali's go) | 2026 JSON lands Wed AM: data swap in Task 27 |
| Wed 18 18:00 | Feature freeze. Thu 19 internal deadline; Fri 20 submission | no feature work after Wed 12:00 except wiring, data swap, gate fixes |

## Evidence, conflicts and requests (read before Task 0)

**Conflicts found.** Each is resolved here only as stated; the owner confirms or reverses.

| # | Conflict | Resolution in this plan | Owner |
|---|---|---|---|
| C1 | ADR 0045 text (nine views; `supervisor-plan`, `worker-unwell`, the frontier deferred) against Ali's 14 Nov list (ten views, plan with sign-off, unwell call sheet, frontier as a scoreboard section, worker access log) | Ali's list wins; ADR 0045 is being amended by the architect | architect |
| C2 | ADR 0053 and 0051 defer sign-off and list no sign-off route; B3 plan Task 17 is "contingent" | Task 20 needs it: **B3 Task 17 becomes MUST (+2.5 h on a B3 lane, Tue 17)**; ADR 0053 is superseded for sign-off; the route is `sign_off_day_plan` (`POST /api/v1/crews/{crew_id}/day-plan/sign-off`) | Ali, B3 controller |
| C3 | Prototype copy "forecast the evening before" (landing, scoreboard) against ADR 0034's 14 Nov amendment ("about 24 hours ahead") | F2 copy follows the ADR | executors |
| C4 | Prototype Plans table has four rows; ADR 0057 makes "naive" and "ban only" one plan on roster L1 | the table renders from `identical_by_construction` (one merged row labelled "Ban only (= working every shift minute...)"), so either outcome of Ali's amendment works | Ali (0057) |
| C5 | Prototype governance page (`GET /v1/workers/{id}/heat-risk`, problem type `employer-no-individual-route`, a Purpose select, "asked for your heat risk") against ADR 0054 (`POST /sites/{site_id}/data-requests`, `urn:stellar-blaze:problem:individual-data-refused`, no purpose field, a site-level claim, "never about you") | ADR 0054 wins: the Purpose select is dropped (a control that sends nothing is a defect), wording is "an employer request for individual health data at this site was refused" | executors |
| C6 | F1 invariant (a) (allow-list = forecast/today and risk-policy only) against the supervisor offline state in journeys SU8 ("S1/S2 from cache") | Task 23 proposes adding three public, non-personal reads (`list_sites`, `list_site_crews`, `get_crew_timeline`; ADR 0050: crew level uses no member data). **Default if Ali does not answer: not added; supervisor offline shows the notice and Stop-work outbox only** | Ali (governance change) |
| C7 | Journeys U8 ("after Remove my data, Today returns to the site level") against F1 invariant (b) and the consent copy that names the crew | the site pin is part of the device store and is cleared by revoke; Today then shows the empty state with "See the demo yard" | Ali |
| C8 | Journeys §12 and BUILD-BRIEF: Today's primary action is **Listen**; no pre-rendered audio exists (roadmap stretch 8 "needs the Azure voice check"; ADR 0038) | no Listen button in F2 (a button that does nothing is a defect). Today's one primary action is "Turn on warnings" (to `/worker/alerts`) while push is off, none otherwise. Listen is DESIGNED | Ali |
| C9 | ADR 0037 landing budgets (scene up to 200 KB, LCP 3.0 s) against the F1 170 KB route budget | one 174,080 B script budget on every route, including the landing's scene chunk and worker; Task 25 measures and trims before any exception | Ali |
| C10 | F1 Global Constraint "level by colour plus pattern plus pictogram plus numeral plus text" against v2 "no hatch, word plus scale plus mark" | v2 was approved by Ali on 12 Nov; the F1 constraint is rewritten in Global Constraints above | architect |
| C11 | F1 `notificationTargetUrl` opens `/worker?from=push&level=...`; the alert card is a separate view | Task 17 changes it to `/worker/alert?audience=&target=&level=&valid_from=` (the payload has no alert id; a query is the only identity) and updates F1's unit tests | executors |
| C12 | Journeys P7 stepper at `/replay?step=<id>` with six steps; ADR 0045 F7 makes the roadmap a deck slide | `StoryNav` is a previous/next link row with five steps (problem, scoreboard, day, proof, product); no roadmap step | Ali (F7) |
| C13 | `docs/design/v2/` may be uncommitted (ADR 0045 consequences) | Task 0: the controller commits the folder before executors start | controller |

**Contract requests to B3 (additive; send before Task 0 merges Sun 12:00, else as a Task 0b).** Without them the fallback shown is what F2 ships.

| # | Request | View that needs it | Fallback if refused |
|---|---|---|---|
| R1 | `ban_window: {starts_at, ends_at} \| null` on `SiteForecastToday` and `CrewTimeline` (ruleset-derived; null out of season) | slot edges on every spine (journeys P1: "dates come from the ruleset, never a literal") | hour-granular slot (12:00 to 15:00), 30 minutes wrong: **not acceptable**; the slot is then not drawn and a text line states the window from `DayPlan.segments` where available |
| R2 | `Crew.task_label: str`, `Crew.workload: light\|moderate\|heavy`, `CrewTimeline.shift: [{starts_at, ends_at}]`, `CrewTimeline.signoff_state: unsigned\|signed` | crews strips (task, shift, plan status without N+1 `get_crew_day_plan` calls); worker "Shift ends" waypoint | four parallel `get_crew_day_plan` calls (employer token via BFF); no shift-end waypoint on Today |
| R3 | Sign-off contract (Task 17): `DayPlan.ack_items: [{id, zone, starts_at, ends_at, text_code}]` (one per run of the same Medium, High or Red zone), `DayPlan.signoff: {state, signed_at, signed_by_role}`; request `{acknowledged_items: [id], deviation_reason_code: null}`; 409 `review-required` lists missing ids | Task 20 | F2 derives items with `deriveAckItems` (contract-tested against the server's list once it exists) |

**Decisions Ali must make** (defaults in brackets are what the plan assumes; none blocks Task 1): D1 confirm B3 Task 17 as MUST (C2); D2 SW allow-list extension (C6) [no]; D3 Listen deferred (C8) [yes]; D4 the BFF holds the demo employer token, so **any visitor of the demo URL can call stop-work, sign-off and day-plan on the synthetic site** (ADR 0051 §5; mitigated by the allow-list in Task 2, synthetic ids only, backend `synthetic` flag) [accept for the demo]; D5 Lighthouse on `ubuntu-24.04` needs `--no-sandbox` or a sysctl step (F1 open item; the implementer's sysctl edit was denied) [`--no-sandbox` via `chromeFlags`]; D6 whether the clinical review of the unwell card happened by 17 Nov (label "Reviewed by an independent clinical consultant, <date>" else "Not clinically reviewed", ADR 0035) [not reviewed]; D7 Opus whole-branch review wanted? [Sonnet only]; D8 the F1 "write an ADR for invariants (a) and (b)" (F1 open item) and the allow-list ADR are architect work that Task 23 blocks on.

## File structure

```
DESIGN.md                                        # Task 1: replaced by Qaylula (lint-clean)
docs/design/f2/gate/<view>/                      # gate PNGs, JSON, critic report (per task)
frontend/
  openapi/stellar-blaze.openapi.json             # Task 2 (mock from B3 Task 0 text) -> Task 24 (backend/openapi/v1.json)
  data/static/{uae_ifs025_d1_wbgt_2026-09-03,omaa_2026_ifs_d1_wbgt_hourly,omaa_2026_ifs_d1_wbgt_dailymax,coast}.json  # copied from the prototype; MANIFEST.json (sha256, source, label)
  data/eval/{2026,dev}/                          # synced exporter JSON (policy_scoreboard, plan_scoreboard, demo_day, theta, *.2025, roster_frontier)
  data/recorded/governance-run.json              # Task 15
  scripts/{sync-eval-data,build-data-manifest,contrast,record-governance-run,sync-b3-fixtures,i18n-sync}.mjs
  messages/{en,ar,ur,hi,bn,ne}.json  messages/review-manifest.json
  src/styles/{tokens.css,globals.css}            # Task 1
  src/app/fonts.ts                               # Task 1 (Archivo, IBM Plex Mono, per-script bodies)
  src/app/[locale]/page.tsx                      # landing (Tasks 11-13)
  src/app/[locale]/(judge)/replay/{layout.tsx,page.tsx,day/page.tsx,proof/[claim]/page.tsx}
  src/app/[locale]/(judge)/replay/(live)/{layout.tsx,try/page.tsx,governance/page.tsx}   # (live) mounts QueryProvider; URLs unchanged
  src/app/[locale]/(worker)/worker/{page.tsx,alert/page.tsx,unwell/page.tsx,data/page.tsx}
  src/app/[locale]/(supervisor)/supervisor/{page.tsx,crews/[crewId]/page.tsx}
  src/app/[locale]/dev/kit/page.tsx              # per-state component gallery (ADR 0027: no Storybook)
  src/components/{level,spine,states,provenance,charts,governance,shell}/
  src/lib/{heat/ramp.ts,sun/solar.ts,url-state.ts,time/clock.ts}
  src/features/{judge,supervisor,today,alert,unwell,demo}/   # today and alert, unwell join WORKER_FEATURES; demo is shared-safe (no personal data)
  src/api/{query-keys.ts,queries.ts}
  tests/unit/**  tests/e2e/{demo-journey,gate,visual,offline-f2,rtl}.spec.ts
```

## Design gate protocol (every view task ends with it)

1. **Render, look, fix, twice.** The implementer screenshots every state at 390 and 1440 (768 for supervisor), night, plus sun for field routes, looks at each PNG, fixes and re-renders (BUILD-BRIEF rule). No claim of done without PNGs in `docs/design/f2/gate/<view>/`.
2. **Deterministic checks** (`tests/e2e/gate.ts`, `gateReport(page)`, asserted in each view's e2e): console clean; horizontal overflow 0; rendered text at least 12 px (field time and level labels at least 16 px); targets at least 24 px (44 field); axe zero; `[data-hero]` area at least 35 % of the first fold at the main width (390x844 field, 1440x900 judge); at most one `[data-primary]` in the first fold, excluding `[data-emergency]` (dock "I feel unwell", Stop work bar); a `[data-spine]` element; shared `view-transition-name` values `wordmark`, `spine`, `level` where the element exists; no visible text matching `/ADR \d|HANDOFF|\bB[123]\b/` or an em or en dash in `en`.
3. **Independent critique:** `design-craft:visual-critic` on **Sonnet** scores the 12-criterion rubric (0 to 4 each) on the rendered pixels; **gate 38 of 48 per surface**. Criteria 5, 6, 8, 9 (contrast, type, targets, states) are measured and never waived. One fix round, then re-gate; a surface still under 38 after two rounds ships only with the recorded exception and Ali told.
4. **Reviewer pass:** the Sonnet task reviewer audits the changed files against the web-interface-guidelines rules (`file:line, rule, fix`) and the Review Focus lines that name the task.

---

### Task 0: Controller preflight (1 h, controller)

**Files:** `.superpowers/sdd/2026-11-14-f2-core-demo-screens/progress.md` (git-ignored ledger). No code.

- [ ] **Step 1:** Commit `docs/design/v2/` if untracked (C13); record `pnpm test` (1253 expected), `pnpm lint`, `pnpm typecheck`, `pnpm build` green as the baseline.
- [ ] **Step 2:** Run `pnpm build` then `pnpm exec lhci autorun`; record the gzip script size of `/en/worker`, `/en/worker/alerts`, `/en/supervisor`, `/en` into the ledger (F1: 161,018 B and 172,582 B). Task 25 uses these.
- [ ] **Step 3:** Research and record: (a) `viewTransition` in `frontend/node_modules/next/dist/docs` (Next 16.4.6) and whether React 19.3.1's `<ViewTransition>` is stable; choose (i) Next flag plus `<ViewTransition name>`, (ii) a client `TransitionLink` calling `document.startViewTransition` with feature detection, or (iii) neither (then the linking-transition rule is recorded as unmet, not faked). Cross-document `@view-transition { navigation: auto }` does **not** fire on Next `<Link>` navigations, which are client-side. (b) the Turbopack bundle analyzer command available in 16.4.6 (`node_modules/next/dist/docs`). (c) next-intl `localeDetection: false` in `defineRouting`.
- [ ] **Step 4:** Send R1-R3 to the B3 controller; record answers or defaults; record Ali's D1-D8 or the defaults taken.
- [ ] **Step 5:** Create the ledger with one row per task (status, commits, review rounds, rulings) and an "estimate vs actual hours" column (the estimates below are uncalibrated; recalibrate after Tasks 1 and 2).

---

### Task 1: Qaylula tokens, DESIGN.md, fonts, sun mode (4 h, Lane A, tier M)

Blocks every other task. The v2 `DESIGN.md` fails the F1 gate today: **`pnpm design:lint` on it reports 14 warnings (13 orphaned tokens, missing `primary`; measured 2026-11-14)** and `design:lint` fails on warnings (F1 R15).

**Files:**
- Modify: `DESIGN.md` (root), `frontend/src/styles/tokens.css`, `frontend/src/styles/globals.css`, `frontend/src/app/fonts.ts`, `frontend/src/components/shell/theme-script.ts`, `frontend/src/components/shell/ThemeToggle.tsx` (replaced by `SunToggle.tsx`), `frontend/src/features/pwa/manifest.ts` (`MANIFEST_COLORS` from tokens), `frontend/src/components/ui/*` (adapter), `frontend/src/app/[locale]/dev/specimen/page.tsx`, `frontend/tests/unit/styles/tokens.test.ts`, `frontend/tests/utils/colour.ts`
- Create: `frontend/src/lib/sun/solar.ts`, `frontend/scripts/contrast.mjs` (port of `docs/design/critique/contrast.mjs`), `frontend/tests/unit/lib/sun/solar.test.ts`
- Delete: `--pattern-*`, `--shade-*`, `--level-*-soft`, `--on-level-*`, the F1 `LevelBadge` styling that depends on them (the component itself is rebuilt in Task 4)

**Interfaces:**
- Produces semantic tokens (CSS vars and Tailwind names): `ground`, `ground-deep`, `panel`, `raised`, `slot`, `hair`, `edge`, `ink`, `ink-2`, `ink-3`, `signal`, `on-signal`, `focus`, `scrim`, `lv-green`, `lv-amber`, `lv-orange`, `lv-red`, `viz-truth`, `viz-raw`, `viz-ours`, `viz-grid`; `--t-12 ... --t-76`; `--s-1 ... --s-24`; `--r: 2px`; `--target: 44px`; `--target-field: 52px`; `--dur-1: 150ms`; `--dur-2: 240ms`; `--ease`. Values are exactly those of `docs/design/v2/prototype/assets/tokens.css`. Class migration for F1 code: `surface`->`ground`, `surface-raised`->`panel`, `ink-muted`->`ink-2`, `hairline`->`hair`, `control`->`edge`, `action`->`ink` (primary button is `ink` on `ground`; the field primary is `signal`), `focus` unchanged.
- `solarElevationDeg(lat: number, lon: number, at: Date): number` and `export const UAE_CENTROID = { lat: 24.4, lon: 54.4 } as const`.
- `sunScript: string` (inline, runs before hydration): for field paths (`/<locale>/worker`, `/<locale>/supervisor`) sets `data-theme="sun"` when `localStorage["sb-theme"]` override `{theme, until}` says so, else when `prefers-contrast: more`, else (replay mode, the default, `localStorage["sb-demo"] !== "live"`) **assumes the replay moment is daytime**, else when `solarElevationDeg(UAE_CENTROID, now) > 0`; desk paths never set it. `SunToggle` stores `{theme, until: next local midnight}`.

- [ ] **Step 1: Write the failing tests.** `tokens.test.ts` (rewritten for a night default plus a sun override block): `test_contrast_pairs_match_design_md` computes WCAG ratios from the oklch values and asserts each is at or above its floor and within 0.02 of DESIGN.md §3 (night: ink 16.57, ink-2 9.55, ink-3 5.69, signal 12.05, edge 3.2 on ground; sun: ink 18.01, ink-3 6.28, signal 6.78, edge 3.48; level marks night 8.18, 11.21, 7.62, 5.63, sun 4.38, 3.32, 4.03, 5.82, floor 3.0); `test_tokens_css_equals_design_md`; `test_sun_overrides_exactly_the_documented_set`; `test_no_hatch_or_shade_tokens_remain`; `test_ur_leading_is_2_5`; `test_type_scale_has_no_13px_step`. `solar.test.ts`: elevation above 0 at 2026-09-03T07:10Z and below 0 at 2026-11-14T15:00Z (19:00 GST) for the centroid; `sunScript` evaluated in jsdom sets `sun` on `/en/worker`, not on `/en/replay`, honours an unexpired override and ignores an expired one.
- [ ] **Step 2: Run** `pnpm test tests/unit/styles tests/unit/lib/sun`. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace root `DESIGN.md` with the v2 text, adding `primary: "{colors.signal}"` and component entries (`panel`, `panel-raised`, `slot`, `level-mark-green|amber|orange|red`, `text-secondary`, `edge-control`, `ground-deep`) so every colour is referenced; label font size becomes `0.875rem` (14 px). Port `tokens.css` as three tiers (primitives, semantic, theme) with the sun block. Re-point `globals.css` (`@theme` stays closed: palette, text, radius, shadow, blur cleared) and the shadcn adapter variables onto the new names (primary uses `ink`/`ground`). Fonts: Archivo (`wdth` axis, latin, preload only this one file) as `--font-display` and the English `--font-body`, IBM Plex Mono 400 latin as `--font-mono`; remove Barlow Condensed and Noto Sans; per-script bodies unchanged; Urdu `--leading-ur: 2.5`.
- [ ] **Step 4: Verify.** `pnpm lint && pnpm typecheck && pnpm test && pnpm design:lint` (0 warnings) and `node scripts/contrast.mjs` (prints the DESIGN.md §3 table; commit its output into `docs/design/f2/gate/tokens/contrast.txt`).
- [ ] **Step 5: Gate (specimen).** `/en/dev/specimen` renders both themes; render, look, fix twice; PNGs to `docs/design/f2/gate/tokens/`. Commit `feat(design): Qaylula tokens, fonts and sun mode replace Arish Signal`.

---

### Task 2: Contract adoption, demo fixtures, MSW handlers, BFF employer token (4 h, Lane B, tier M)

**Files:**
- Create: `frontend/openapi/stellar-blaze.openapi.json`, `frontend/src/api/query-keys.ts`, `frontend/src/api/queries.ts`, `frontend/src/app/api/v1/[...path]/employer-auth.ts`, `frontend/tests/unit/api/employer-auth.test.ts`
- Modify: `frontend/package.json` (`api:gen` source), `frontend/src/mocks/{fixtures,handlers}.ts`, `frontend/scripts/mock-api.ts`, `frontend/src/app/api/v1/[...path]/route.ts`, `frontend/src/api/schema.d.ts` (generated), `tests/unit/api/contract-governance.test.ts`, `tests/unit/mocks/handlers.test.ts`

**Interfaces:**
- Consumes: B3 plan Task 0 "Interfaces" (the 13 operationIds of ADR 0051 with snake_case names; models `Site`, `HourForecast`, `SiteForecastToday`, `RiskPolicy`, `Crew`, `CrewHour`, `CrewTimeline`, `PlanSegment`, `Violation`, `ValidatorResult`, `DayPlan`, `PlanValidateRequest/Response`, `PushSubscription*`, `DataRequestCreate`, `CrewStopCreate`, `CrewStop`, `TransparencyLog`, plus requests R1-R3 and the sign-off route of Task 17). The file is hand-written from that text until `backend/openapi/v1.json` exists.
- Produces: `crewsQueryOptions(siteId)`, `crewTimelineQueryOptions(crewId, date?)`, `crewDayPlanQueryOptions(crewId, date?)`, `validatePlanMutation()`, `dataRequestMutation(siteId)`, `transparencyLogQueryOptions(siteId)`, `stopMutation(crewId)`, `signOffMutation(crewId)` (all through `call()`/`ApiProblem`, `networkMode: "offlineFirst"` only on the two allow-listed reads); `employerAuth(method: string, path: string): {inject: boolean}` and `forwardHeaders(incoming: Headers, token: string | undefined): Headers`.
- Fixtures (ADR 0057, SIMULATED): site `site-demo-mussafah` "Mussafah M-14 yard (synthetic)"; crews `crew-a` (12), `crew-b` (20), `crew-c` (9), `crew-d` (4, `suppressed: true`, `k: 5`); replay day hourly WBGT taken from `data/static/omaa_2026_ifs_d1_wbgt_hourly.json` (real numbers), levels from a documented placeholder rule labelled `model_id: "mock"`; `share_above_amber` removed everywhere (ADR 0050). Scenario header `x-sb-mock-scenario: error | stale | empty | fallback | suppressed` (forwarded only outside production or with `SB_MOCK_SCENARIOS=1`).

- [ ] **Step 1: Write the failing tests.** `employer-auth.test.ts`: `test_bff_injects_token_only_on_allow_list` (GET `/api/v1/crews/crew-b/day-plan`, POST `/api/v1/sites/site-demo-mussafah/data-requests`, POST and DELETE `/api/v1/crews/crew-b/stops...`, POST `/api/v1/crews/crew-b/day-plan/sign-off` inject; GET `/api/v1/sites`, a crew id outside `crew-[a-d]`, a site id not starting `site-demo-`, and every other path do not), `test_client_authorization_is_stripped`, `test_no_injection_without_env_token`. `handlers.test.ts`: one case per operationId (status, shape from the generated types), `data-requests` always 403 problem `urn:stellar-blaze:problem:individual-data-refused` and appends to the in-memory log, `sign-off` 409 `review-required` then 200, `validate` for roster B0 returns `P-H3` and `P-H2.daily` with clause text. `contract-governance.test.ts` still finds no member-like property (allow-list: `worker_ref`).
- [ ] **Step 2: Run** `pnpm test tests/unit/api tests/unit/mocks`. Expected: FAIL.
- [ ] **Step 3: Implement.** Regenerate `schema.d.ts` (`pnpm api:gen`); fix every compile error the removed field and renamed ids cause; rewrite fixtures and handlers; `employer-auth.ts` as a pure matcher used by `route.ts`, reading `DEMO_EMPLOYER_TOKEN` at request time (never `NEXT_PUBLIC`).
- [ ] **Step 4: Verify.** `pnpm lint && pnpm typecheck && pnpm test && pnpm api:check`. If `backend/openapi/v1.json` is on disk (B3 Task 0 merged), copy it to `openapi/stellar-blaze.openapi.json`, regenerate and fix the diff; otherwise record "contract swap pending" for Task 24.
- [ ] **Step 5: Commit** `feat(api): adopt the v1 contract, demo fixtures and the BFF employer-token allow-list`.

---

### Task 3: Shell, route groups, isolation, demo clock, site pin (3.5 h, Lane B, tier M)

**Files:**
- Create: `frontend/src/lib/url-state.ts`, `frontend/src/lib/time/clock.ts`, `frontend/src/features/demo/{DemoProvider.tsx,useClock.ts,constants.ts}`, `frontend/src/components/shell/{FieldShell,DeskShell,WorkerDock,SunToggle,LanguageChips,DemoModeSwitch}.tsx`, `frontend/src/app/[locale]/(judge)/replay/layout.tsx`, tests under `tests/unit/{lib,features/demo,shell}`
- Modify: `frontend/eslint.config.mjs` and `tests/unit/lint/route-group-isolation.test.ts`, `frontend/src/app/[locale]/layout.tsx` (move `QueryProvider` out), worker and supervisor `layout.tsx`, `frontend/src/i18n/routing.ts` (`localeDetection: false`), `frontend/src/features/profile/store.ts` (a `site` slice)

**Interfaces:**
- `replayInstant(date: string, hhmm: string, tz: string): Date` (the instant of local `hhmm` on `date`); `useClock(): Date` returns the replay instant when the last forecast response says `mode: "replay"` (date from the response, `11:10` local unless `?at=HH:MM`), else `new Date()`. `DEMO_CREW_ID = "crew-b"` (ADR 0057, the scored crew); the demo site is the first `list_sites` entry with `synthetic: true`, never a literal id.
- `useUrlParam(key: string, parse: (raw: string | null) => T, fallback: T): [T, (next: T) => void]` using `useSearchParams` and `router.replace` with `scroll: false`.
- `useDeviceSite(): { siteId: string | null; crewId: string | null; choose(siteId: string, crewId: string | null): void; clear(): void }` stored in the F1 profile store (`site: {siteId, crewId} | null`), **cleared by `revoke()`** (C7).
- `DemoModeSwitch`: URL `?demo=live|replay`; replay passes `date` explicitly to the forecast and timeline calls, live omits it (the server decides; if the response says `mode: "replay"` the switch shows "Live is not running on this deployment"). The `mode` stamp comes from the API field, not from the switch.
- `WorkerDock`: `[data-emergency]` link "I feel unwell" (view-transition name `unwell`) plus tabs Today, Alerts, My data (the My data tab is rendered only when Task 21 ships).
- Isolation: new route group `(judge)` and `features/judge`; `src/app/[locale]/page.tsx` and `(judge)/**` may not import worker, supervisor or HSE code; worker features list becomes `today, profile, risk, push, alert, unwell`; supervisor and HSE may not import worker code (unchanged). Shared components never import a feature.
- `QueryProvider` is mounted only in `(worker)`, `(supervisor)`, and the two judge routes that mutate (`replay/try`, `replay/governance`) through a `(live)` sub-layout; static judge pages and the landing carry no TanStack Query (JS budget, Task 25).

- [ ] **Step 1: Write the failing tests:** `test_replay_instant_dubai` (2026-09-03 11:10 Asia/Dubai is 07:10Z), `test_use_clock_replay_vs_live`, `test_url_state_roundtrip_and_fallback_on_bad_value`, `test_revoke_clears_site_pin`, `test_judge_group_cannot_import_worker_code` and `test_landing_page_cannot_import_worker_code` (the lint test resolves the real config per path), `test_root_slash_serves_english_without_accept_language`, `test_dock_has_emergency_link_always`.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the shells as presentational compositions (header: site and crew, clock in `<bdi>`, `SunToggle`; six language chips as endonyms with `aria-current`; desk header with wordmark and menu). The linking transition follows Task 0's decision: wrap navigations in the chosen mechanism with names `wordmark`, `spine`, `level`, `unwell`; none under `prefers-reduced-motion`.
- [ ] **Step 4: Verify** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; `CI=true pnpm e2e` still 82 green (F1 suite).
- [ ] **Step 5: Commit** `feat(shell): field and desk shells, judge route group, replay clock and site pin`.

---

### Task 4: Level primitives, pictograms, states, stamps, kit gallery (3 h, Lane A, tier M)

**Files:**
- Create: `frontend/src/components/level/{LevelSign,LevelScale}.tsx`, `frontend/src/components/level/Pictogram.tsx` (replaces `pictograms.tsx`), `frontend/src/components/states/{EmptyState,ErrorState,StaleBanner,OfflineBanner,PendingBanner,MissingProvenance,Skeletons}.tsx`, `frontend/src/components/provenance/Stamp.tsx`, `frontend/src/app/[locale]/dev/kit/page.tsx`, tests under `tests/unit/components/{level,states}`, `tests/e2e/visual.spec.ts` (state snapshots of the kit page)
- Modify: `frontend/src/components/level/level.ts` (keeps `Level`, `moreSevere`)

**Interfaces:**
- `type LevelKind = "live" | "stale" | "fallback"`; `LevelSignProps { level: Level | null; kind: LevelKind; size: "hero" | "mini"; until?: string; kicker: string }`: the level word (76 px hero, 22 px mini) with `until`, `LevelScale` beneath; `level === null` renders "Site rules" and no scale marker. `LevelScaleProps { level: Level | null; kind: LevelKind }`: four segments, current one marked, `role="img"` and `aria-label="Level 3 of 4, Orange"` (stale: "Last known level 3 of 4, Orange"); stale and fallback use a dashed marker, never a hatch (journeys P6).
- `Pictogram`: `name: "shade" | "water" | "buddy" | "cross" | "speaker" | "handset" | "clock" | "sun" | "moon"`, 24 grid, `currentColor`, decorative unless `label` is given (a plain medical cross for unwell, not phone plus cross). At most four per screen is a convention, not enforced.
- `EmptyState { title: string; reason: string; primary: {label: string; href: string}; secondary?: ...; level?: Level }` (actionable: never blank, never links to a deferred view); `ErrorState { title; detail; onRetry: () => void; requestId: string | null }` with a copy-request-id button; `StaleBanner { updatedAt: string; ageLabel: string }`; `OfflineBanner`; `PendingBanner { what: string }`; `MissingProvenance { what: string }`; skeletons take `height` props equal to the final element height (no CLS).
- `Stamp { kind: "REPLAY" | "RECORDED" | "SIMULATED" | "DESIGNED" | "DEV_2025" | "NOT_CLINICALLY_REVIEWED"; detail?: string }`.

- [ ] **Step 1: Write the failing tests:** `test_level_scale_aria_and_marker` (each level, stale, null), `test_level_sign_never_uses_colour_alone` (word and scale and mark all present), `test_stale_marker_is_dashed_not_hatched`, `test_error_state_has_retry_and_request_id`, `test_empty_state_primary_not_deferred_route`, `test_skeleton_heights_match_final`, kit e2e `kit states have no axe violation` (both themes).
- [ ] **Step 2: Run** the unit tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Delete the F1 hatch-based level components and their tests; migrate F1 consumers (`AlertsSettings`, `InstallCard`, `DraftBadge`) to the new tokens and primitives.
- [ ] **Step 4: Verify** unit, lint, typecheck, build; `CI=true pnpm e2e -g kit`.
- [ ] **Step 5: Gate (kit page).** Render states in both themes; PNGs to `docs/design/f2/gate/kit/`. Commit `feat(ui): level sign, pictograms, states and stamps`.

---

### Task 5: TimeSpine with the qaylula slot, and the heat ramp (3.5 h, Lane B, tier M)

**Files:**
- Create: `frontend/src/lib/heat/ramp.ts`, `frontend/src/components/spine/{TimeSpine,QaylulaSlot,SpineLabels}.tsx`, `frontend/tests/unit/lib/heat/ramp.test.ts`, `frontend/tests/unit/components/spine/*.test.tsx`
- Port from: `assets/heat.js` (ramps) and `assets/kit.js` `spine()`.

**Interfaces:**
- `heatColor(wbgtC: number, theme: "night" | "sun"): string` (an `oklch(...)` string; stops copied from `RAMP_DARK` and `RAMP_LIGHT`, hue unwrapped, lightness monotonic).
- `type BanState = { kind: "in-force"; fromHour: number; toHour: number } | { kind: "not-in-force"; resumesLabel: string | null }`; `banStateFrom(window: {starts_at: string; ends_at: string} | null, tz: string, date: string): BanState` (null, or a date outside the season, is `not-in-force`).
- `TimeSpineProps { orientation: "h" | "v"; from: number; to: number; cells: readonly {hour: number; wbgtC: number | null}[]; now: number | null; ban: BanState; waypoints?: readonly {at: number; title?: string; detail?: string}[]; surface: "field" | "desk"; dir: "ltr" | "rtl"; aria: string }`. It renders `data-spine`, hour cells in heat colour (null cells in `--hair`), the recessed slot (`--slot`, two 1 px rules, "Midday break" once) when `in-force`, a dashed labelled outline when `not-in-force` and `surface: "desk"`, nothing when `not-in-force` and `surface: "field"`, a `--signal` now line. Rendered label size is at least 16 px on `field` and at least 12 px on `desk` (viewBox scaled to the container; the prototype's `--k` trick). In `rtl`, horizontal geometry mirrors and vertical labels move to the inline start; clock digits are never mirrored. Cells are decorative; the waypoints are real text.

- [ ] **Step 1: Write the failing tests:** `test_heat_color_lightness_is_monotonic` (both themes, 26 to 40.5), `test_heat_color_matches_prototype_stops`, `test_slot_edges_from_ban_window` (6 to 18 vertical: slot spans exactly 12.5 to 15), `test_no_slot_out_of_season_field`, `test_dashed_outline_out_of_season_desk`, `test_spine_mirrors_in_rtl`, `test_spine_label_sizes` (rendered font size at least 16 at 390 px width on `field`), `test_null_hours_are_not_coloured_as_data`, `test_ban_state_from_window_in_and_out_of_season`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** as server-renderable SVG; a thin client wrapper only for the resize scale and the RTL read.
- [ ] **Step 4: Verify** unit tests, lint, typecheck; add the spine to `/dev/kit` in all four variants.
- [ ] **Step 5: Gate (kit page, spine).** Both themes, both orientations, in and out of season, `ltr` and `rtl`. Commit `feat(spine): time spine with the recessed midday slot and the heat ramp`.

---

### Task 6: Proof chip, proof drawer, provenance adapters, data manifest (3.5 h, Lane A, tier M)

**Files:**
- Create: `frontend/src/components/provenance/{ProofChip,ProofDrawer,Proof}.tsx` and `proof.ts`, `frontend/scripts/{build-data-manifest,sync-eval-data}.mjs`, `frontend/src/features/judge/data.ts` (server-only loaders), `frontend/data/static/MANIFEST.json`, tests under `tests/unit/{components/provenance,features/judge}`
- Copy: the four prototype data files into `frontend/data/static/` (and to `public/data/static/`).

**Interfaces:**
- `interface Proof { what: string; protocol: string; protocolHref: string | null; script: string; file: string; fileSha256: string | null; sourceSha256: string | null; label: "REAL" | "REAL weather + assumed crew" | "SIMULATED" | "DEV 2025" | "RECORDED"; modelId: string | null; generatedAt: string | null }`.
- `proofFromProvenance(p: Provenance, anchor: string, what: string, fileSha256: string | null): Proof | null` (`null` when a required field is missing; `Provenance` is the generated schema type, B2 Task 12: `protocol_path`, `protocol_anchor`, `script`, `function`, `git_sha`, `data_sha256`, `model_id`, `label`, `generated_at`); `proofFromForecast(f: SiteForecastToday, what: string): Proof` (policy version, config version, model id, label REAL or SIMULATED from `Site.synthetic`).
- `<ProofChip proof={Proof | null} />` renders nothing for `null` (the caller hides the number); `<ProofDrawer />` is a native `<dialog>` lazy-loaded on the first chip click, focus returns to the chip, Esc closes, rows: Number, Protocol line (link), Script, Result file, SHA-256 (file fingerprint of what this page drew, plus the exporter's source fingerprint), Label; a "Recount in this browser" button re-hashes `public/data/...` with `crypto.subtle` and says "Matches" or "Does not match: report this".
- `loadEval(): {policy: PolicyScoreboard | null; plans: PlanScoreboard | null; day: DemoDay | null; frontier: ... | null; source: "2026" | "dev-2025" | "none"}`; resolution: `data/eval/2026/*.json`, else (non-production only) `data/eval/dev/*.2025.json` with the `DEV_2025` stamp, else nulls. `SB_REQUIRE_SCORED=1` makes `next build` fail when a 2026 file is missing. `build-data-manifest.mjs` writes `src/features/judge/manifest.generated.ts` (sha256 per file, like F1's `sw-strings.ts`) and a test fails on drift.

- [ ] **Step 1: Write the failing tests:** `test_proof_from_provenance_null_when_field_missing`, `test_proof_chip_null_renders_nothing`, `test_drawer_focus_return_and_escape`, `test_drawer_recount_matches_and_flags_a_changed_file`, `test_load_eval_prefers_2026_and_never_returns_dev_in_production`, `test_manifest_matches_files`, `test_build_requires_scored_files` (script level).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The drawer's JS is a dynamic import; the chip is a plain button with `data-proof-id` and a context lookup (no JSON in attributes).
- [ ] **Step 4: Verify** unit tests, lint, typecheck, build; kit page shows the chip and drawer.
- [ ] **Step 5: Gate (kit page, drawer open at 390 and 1440).** Commit `feat(proof): proof chip and drawer from exporter provenance, data manifest`.

---

### Task 7: Evidence components: table, counter, verdict, season ribbon, day chart, frontier chart (5 h, Lane A, tier M)

**Files:**
- Create: `frontend/src/components/charts/{SeasonRibbon,SeasonPlayer,DayChart,FrontierChart,IsothermBands}.tsx`, `frontend/src/components/provenance/{ScoreboardTable,Counter,Verdict}.tsx`, `frontend/src/features/judge/{adapters.ts,facts.ts,limit.ts}`, tests under `tests/unit/{components/charts,features/judge}`
- Port from: `assets/judge.js` (`seasonRibbon`, `seasonFacts`, `heatCalendar`, `dayChart`).

**Interfaces:**
- `limit.ts`: `HEAVY_WORK_LIMIT_WBGT_C = 26.6` with a citation comment; a test asserts equality with F1's `rel(415)` (the only place a judge file touches a worker file is this test).
- `seasonFacts(series: HourlySeries): { n; over; inBan; peaks; perDay; pk; pkI; lo; loI; daysOver }`; the ban dates come from the series' own metadata or `ban_window`, never a literal.
- `ScoreCell { value: string; interval?: string; proof: Proof }`, `ScoreRow { id: string; label: string; sublabel: string; ours: boolean; cells: ScoreCell[] }`, `ScoreboardTableProps { caption: string; columns: {key: string; heading: string}[]; rows: readonly ScoreRow[]; pending?: boolean }` (ours is distinguished by position, weight and `aria-current`, one accent; below 640 px rows stack). `toPolicyRows(sb: PolicyScoreboard, lead: 1): ScoreRow[]` and `toPlanRows(sb: PlanScoreboard): ScoreRow[]` (merges the rows named in `identical_by_construction` into one labelled row; C4).
- `CounterProps { value: string; unit: string; interval?: string; proof: Proof | null; size: "mega" | "numeral"; danger?: boolean }` (no proof renders `MissingProvenance` and never the value); `Verdict { sentence: string | null; proof: Proof | null }` (null sentence renders the pending text "Chosen from the pre-registered outcome table after the single scoring run").
- `SeasonRibbon { days: string[]; peaks: number[]; ban: {fromIndex: number; toIndex: number}; upto?: number; compact?: boolean }` (hypsometric silhouette, 1 °C isotherm contours at each degree, the NIOSH line dashed and labelled once, the slot cut below the ground for the ban period, annotations as DOM-positioned text) with a table alternative; `SeasonPlayer` (client) adds Play and Pause: never autoplays, 139 days in 8 s, reduced motion lands on the final frame. `DayChart { raw: number[]; ours?: {p05: number; p50: number; p95: number}[]; truth?: number[]; ban: BanState; from: number; to: number }`. `FrontierChart { data: RosterFrontier; commuteMin: 15 | 30 | 45 | 60 | 75 | 90 }` with the commute value in the URL.

- [ ] **Step 1: Write the failing tests:** `test_season_facts_match_prototype_counts` (1,624 of 1,807 hours; 279 in the break; 139 of 139 days, from the committed hourly file), `test_limit_equals_f1_rel_415`, `test_pending_table_has_no_cells_with_proof`, `test_scoreboard_row_without_proof_is_not_rendered_as_number`, `test_plans_collapse_identical_rows`, `test_ours_marked_by_aria_current_not_colour_only`, `test_ribbon_has_table_alternative`, `test_player_never_autoplays_and_reduced_motion_final_frame`, `test_frontier_commute_in_url`, `test_day_chart_draws_only_series_that_exist`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Chart colour comes from `--viz-*` and `heatColor`; labels at least 12 px rendered (critique fix 6); no chart library.
- [ ] **Step 4: Verify** unit tests, lint, typecheck; components in `/dev/kit` with real data and the pending variant.
- [ ] **Step 5: Gate (kit page).** Commit `feat(charts): scoreboard table, counters, season ribbon, day and frontier charts`.

---

### Task 8: View - season scoreboard with Warnings, Plans and the roster frontier (4.5 h: 3.5 M + 1 S frontier, Lane A)

**Route:** `/[locale]/replay` (`(judge)/replay/page.tsx`, static, RSC). **Files:** `page.tsx`, `src/features/judge/{ScoreboardView,FrontierSection}.tsx`, `tests/unit/features/judge/scoreboard.test.tsx`, `tests/e2e/judge-scoreboard.spec.ts`.

**Interfaces:** consumes Tasks 4-7. One hero (`data-hero`): `SeasonRibbon` with the tally (days over, hours over, hours in the break) at 35 % or more of the first fold; one primary action: `SeasonPlayer` "Play the season" (secondary: none); time spine: the ribbon with the slot; `StoryNav current="scoreboard"`. Sections in order: verdict (`Verdict`), Warnings (`ScoreboardTable` from `PolicyScoreboard`: P0 ban only, P1 raw WBGT at or above 32, P2 ADOSH zones on the raw forecast, P3 Stellar Blaze at the headline threshold; a second P3 line for the balanced threshold only if the file carries it, B3 Task 13), Plans (three rows, C4), frontier section `#frontier` ("No roster shape outruns the heat under law, sleep and commute. Making the common roster legal does more." with commute slider in the URL; the legalisation gain is credited to the law, ADR 0034 §6, here only), limits line (airport station, assumed crew of 20, modelled sunshine, TWL aligned with ADOSH not certified).
States: ideal (final frame), playing, loading (skeleton at final size), empty (no 2026 file: `PendingBanner` plus link to the protocol, `###` cells, no proofs), partial (Plans file absent: notice), error (file unreadable: static ribbon plus request-less message), api-down (identical: this page needs no API), `DEV 2025` stamp variant.

- [ ] **Step 1: Write the failing tests:** unit `test_empty_state_shows_banner_not_cells`, `test_warnings_rows_in_order_ours_last`, `test_headline_says_24_hours_ahead_not_evening_before`; e2e `scoreboard final frame at first paint` (ribbon visible, Play not playing), `proof chip opens drawer with sha` (opens, SHA row non-empty, Esc returns focus), `scoreboard renders with the API stopped`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the page from `loadEval()`; the verdict sentence only from `PolicyScoreboard` data (never composed here).
- [ ] **Step 4: Verify** unit, `pnpm build && CI=true pnpm e2e -g scoreboard`.
- [ ] **Step 5: Gate (390 and 1440, all states).** Commit `feat(replay): season scoreboard with warnings, plans and the roster frontier`.

---

### Task 9: View - day zoom (2.5 h, Lane A, tier M; the worker-card aside is S)

**Route:** `/[locale]/replay/day`. **Files:** `(judge)/replay/day/page.tsx`, `src/features/judge/{DayView,WorkerCardPreview}.tsx`, tests.

**Interfaces:** hero: `DayChart` (raw forecast as made about 24 hours ahead, ours 5 to 95 % range, station truth, limit, slot) at 35 % of the fold; one primary action: "Read the day rule" (opens the proof drawer); four counters from `DemoDay` (high-zone hours, outside 12:30 to 15:00, called by the raw forecast, called by Stellar Blaze), each with `ProofChip`. The day is whatever `demo_day.json` says (the pre-registered rule: most observed High-zone working hours outside the ban, ties to the earliest); until the file exists the page draws the raw hourly series of the replay day with "Ours and station truth: added by the scoring run" and `###` counters. Aside (S): `WorkerCardPreview`, a presentational composition of `LevelSign` and a vertical `TimeSpine` (no worker imports), linking to `/worker`. A table alternative for the hours.

- [ ] **Step 1: Failing tests:** `test_day_chart_series_absent_until_scored`, `test_counters_have_proofs_or_hashes`, e2e `day page keyboard: chart table toggle and day rule drawer`.
- [ ] **Step 2-5:** run, implement, verify, **gate** (390, 1440; ideal, loading, empty, error). Commit `feat(replay): day zoom`.

---

### Task 10: View - proof sheet (2 h, Lane A, tier M)

**Route:** `/[locale]/replay/proof/[claim]`. **Files:** `(judge)/replay/proof/[claim]/page.tsx`, `src/features/judge/ProofSheet.tsx`, `generateStaticParams` from the claim ids in the loaded data.

**Interfaces:** claim ids are stable slugs derived from exporter `Metric.anchor` (for example `policy.p3.missed_danger_hours`) plus the forecast facts (`hours`, `break`). The sheet is a large number, the `Proof` rows, a "number's timeline" (forecast made, protocol committed, scoring run, shown) and the "Recount it in this browser" button. An unknown claim or one without provenance renders the empty state "No provenance recorded for this number. It is not shown as a result." (journeys D3 E) with a link to a number that has proof.

- [ ] **Step 1: Failing tests:** `test_unknown_claim_is_the_empty_state`, `test_sheet_recount_button_reports_match`, e2e `drawer links to the sheet and back`.
- [ ] **Steps 2-5:** implement, verify, **gate** (ideal, loading, empty, error). Commit `feat(replay): proof sheet`.

---

### Task 11: View - landing hero, 2D field first (3 h, Lane A, tier M)

**Route:** `/[locale]` (`src/app/[locale]/page.tsx`, replaces the F1 role chooser). **Files:** `page.tsx`, `src/features/judge/landing/{FieldHero,FieldCanvas2D,HourScrubber,FieldReadout,field-data.ts}.tsx`, tests.

**Interfaces:** the first focusable element is "Skip to the scoreboard" (link to `/replay`). RSC renders the copy; the LCP element is the `h1` ("Heat that stops work, forecast about 24 hours ahead.") painted from SSR with the preloaded Archivo file, **not** the canvas. Client islands (loaded after first paint, no SSR): `FieldCanvas2D` draws the IFS WBGT field with isotherm contours from `public/data/static/uae_ifs025_d1_wbgt_2026-09-03.json` (92 KB) and `coast.json` (104 KB), together at most 250 KB raw (ADR 0037); `HourScrubber` is a `role="slider"` with arrow-key and Home/End support, a Play button, and DOM text values; `FieldReadout` (`aria-live="polite"`) states the hottest point, OMAA value, the 26.6 limit and the provenance line, so every canvas reading is also text. Reduced motion freezes on the peak hour; the landing plays the day once (the only autoplay in the product) and never when `prefers-reduced-motion` is set. Hero (`data-hero`) is the field; one primary action "See the scoreboard"; secondary "Walk me through it" (`#problem`). Provenance chip on the field (`proofFromProvenance` of the field file's own fields). `?static` forces the 2D path.
States: ideal (field), loading (poster frame at final size, CLS 0), error ("The forecast files did not load" with the scoreboard link), reduced motion.

- [ ] **Step 1: Failing tests:** `test_first_focusable_is_skip_link`, `test_scrubber_keyboard_and_values_in_dom`, `test_reduced_motion_no_autoplay`, `test_field_data_within_250kb_raw`, `test_readout_text_equals_canvas_values`; e2e `landing to scoreboard in one click` (assert one click, URL `/en/replay`, under 10 s), `landing LCP element is the h1`.
- [ ] **Steps 2-5:** implement, verify, **gate** (390, 1440; ideal, loading, error, reduced motion). Commit `feat(landing): data hero with 2D field, scrubber and readout`.

---

### Task 12: Landing WebGL upgrade (2.5 h, Lane A, tier S: cut 2)

**Files:** `src/features/judge/landing/{FieldCanvasGL,terrain.worker}.ts(x)`, tests. Port `assets/terrain-worker.js`.

**Interfaces:** `FieldCanvasGL` upgrades `FieldCanvas2D` after idle when `OffscreenCanvas` and WebGL context creation succeed; otherwise, a context loss, an init failure, or a frames-per-second monitor below 30 for 2 s falls back to the 2D canvas of the same field. Same-origin module worker only (`new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" })`; CSP `worker-src 'self'`, no `blob:`). Vertices at most 6,000 desktop and 1,500 phone; DPR capped at 2 (1.5 phone); unlit, relief from height and 1 °C isotherms. The chunk loads through `next/dynamic({ ssr: false })` after `requestIdleCallback`.

- [ ] **Step 1: Failing tests:** `test_falls_back_to_2d_without_offscreencanvas`, `test_falls_back_when_fps_below_30_for_2s` (fake clock), `test_worker_is_same_origin_module`, `test_vertex_budget_phone_and_desktop`; e2e `landing falls back with ?static` and a Lighthouse assertion in Task 25.
- [ ] **Steps 2-5:** implement, verify, gate (WebGL and fallback screenshots; headless Chromium uses SwiftShader, record which path ran). Commit `feat(landing): plain WebGL terrain in a worker with 2D fallback`.

---

### Task 13: View - landing chapters and story navigation (2.5 h, Lane A, tier M; chapters day and proof are S)

**Files:** `src/features/judge/landing/{Chapters,ProblemChapter,ProductChapter}.tsx`, `src/components/shell/StoryNav.tsx`, tests.

**Interfaces:** `STEPS = [problem, scoreboard, day, proof, product] as const`; `StoryNav { current: StepId }` renders previous and next links (48 px, keyboard), "Copy link to this step" copies the URL. Chapter 1 "The problem": `heatCalendar` (days by working hours, the slot cut in) with the three counts from `seasonFacts` (each with a proof chip) and a table alternative. Chapter 2 teaser: `SeasonRibbon compact` plus `ScoreboardTable` mini from `loadEval()` (pending banner when absent) and "Open the scoreboard". Chapters 3 and 4 (S): the day chart teaser and three artefacts (pre-registration `661b373`, forecast file with its SHA, scoring run). Chapter 5 "The product": four live surfaces only (worker Today, crews today, crew plan with sign-off, governance refusal); the deferred surfaces (setup, HSE, admin) are not shown (ADR 0045 §5: a deferred view may appear only labelled DESIGNED, and here it simply does not appear). No roadmap chapter (C12).

- [ ] **Step 1: Failing tests:** `test_story_nav_five_steps_and_hrefs`, `test_product_chapter_links_only_built_routes`, `test_problem_counts_have_proofs`, e2e `story nav keyboard next and previous`.
- [ ] **Steps 2-5:** implement, verify, gate. Commit `feat(landing): story chapters and navigation`.

---

### Task 14: View - try a plan (3.5 h: 2 M + 1.5 S time editing, Lane A)

**Route:** `/[locale]/replay/try` (inside the `(live)` sub-layout). **Files:** `(judge)/replay/(live)/try/page.tsx`, `src/features/judge/validator/{TryPlanView,PlanStrip,RunsForm,ViolationList,runs.ts}.tsx`, tests.

**Interfaces:** `runsToSegments(runs: {start: string; end: string}[]): PlanValidateRequest["segments"]` (HH:MM, steps of 5 minutes) reconciled with B3 Task 6's `PlanValidateRequest` docstring (what `segments` must cover); `useValidatePlan()` calls `validate_plan` with the replay site and date and a crew `{workload: "heavy", headcount: 20}`. Templates (S off, M on): "Common roster" (06:00 to 12:30, 15:00 to 17:00), "Legal default" (06:00 to 11:00, 15:00 to 18:00), "Straight through" (06:00 to 17:00) from the roster-frontier baselines. Hero: `PlanStrip` (the plan on the heat curve with the slot cut through, violations numbered and attached to their blocks); one primary action "Check this plan"; result: `ViolationList` (rule id in mono, clause, time range, rule text) or "0 rules broken" plus "what was checked" from `checked_rules`; the copy says the validator is independent and shares no code with the planners. **The result is the API's answer; nothing is re-implemented in the browser** (HANDOFF: production calls the validator, "not run" for nothing). S: three editable runs (text inputs at least 16 px, `inputmode="numeric"`, `hh:mm`, on-blur validation, paste allowed, never `type=time`).
States: ideal (violations), empty (0 violations), loading (button keeps its label), error (validator did not answer: times kept, retry, request id, "Show a recorded result" stamped RECORDED from a build-time fixture of the B0 run), 422 `roster-invalid` per-line messages.

- [ ] **Step 1: Failing tests:** `test_runs_to_segments_rounds_trip`, `test_b0_template_reports_p_h3_and_p_h2_daily_with_clauses` (against MSW now, B3's own expectation later), `test_submit_never_pre_disabled`, `test_error_keeps_times_and_offers_recorded_result`, e2e `try a plan: common roster shows violations, keyboard only`.
- [ ] **Steps 2-5:** implement, verify, gate. Commit `feat(replay): try-a-plan checker on the independent validator`.

---

### Task 15: View - governance refusal and the worker access log (3.5 h, Lane A, tier M)

**Route:** `/[locale]/replay/governance` (inside `(live)`). **Files:** `(judge)/replay/(live)/governance/page.tsx`, `src/features/judge/governance/{GovernanceView,RequestCard,AnswerCard,AuditCard}.tsx`, `src/components/governance/AccessLog.tsx` (shared: presentational, no personal data), `scripts/record-governance-run.mjs`, `data/recorded/governance-run.json`, tests.

**Interfaces:** the page is a time-ordered four-step sequence with a clock time on each step (critique fix 9): (1) the employer's request (`POST /api/v1/sites/{site_id}/data-requests`, body `{subject: "worker", data_class: "health", worker_ref}` with an obviously synthetic example reference that the API discards; **no Purpose select**, C5), button "Send the employer's request" (primary); (2) the answer: `403` and the `application/problem+json` body verbatim (`type: urn:stellar-blaze:problem:individual-data-refused`, `title`, `detail`, `request_id`); (3) the audit row from `get_site_transparency_log` newest entry (`at`, `kind`, `outcome`, `actor_role`, `rule`, `policy_version`, `config_version`, `model_id`); (4) the worker's phone: `AccessLog { entries: TransparencyLogEntry[]; empty: ReactNode }` ("An employer request for individual health data at this site was refused", time; never "about you", ADR 0054 §3). **First paint shows a completed run** (the hero must exist at first paint, journeys §10 amendment): the build-time `RECORDED` fixture, produced by `record-governance-run.mjs` against a real B3 run (`SIMULATED` from MSW until then), under a `Stamp RECORDED`; "Send again" does the live call and appends a row. The page never auto-sends (each send is a visible audit row for every worker of the site). Copy in sentences, only identifiers in mono; the proof list shows three real B3 test names (`test_data_request_403_and_audit_row`, `test_transparency_log_shows_refusal`, `test_verify_detects_edited_row`) as a collapsed `<details>`.
States: recorded (first paint), live ideal, loading (button keeps its label), empty (log has no rows), error (API unreachable: recorded run plus "Nothing was sent, so nothing was recorded" and request id), 401 (token missing on a deployment without the BFF token: states it).

- [ ] **Step 1: Failing tests:** `test_first_paint_is_the_recorded_run`, `test_send_again_posts_and_shows_403_and_new_log_row`, `test_no_purpose_control`, `test_copy_is_site_level_not_about_you`, `test_page_never_auto_sends`, e2e `governance refusal visible in the worker log` (send, assert the 403 card and the new `AccessLog` row, then reload and see it in the log).
- [ ] **Steps 2-5:** implement, verify (including `test_access_log_is_shared_and_imports_no_feature`), gate. Commit `feat(replay): governance refusal with the worker access log`.

---

### Task 16: View - worker Today (5 h, Lane B, tier M)

**Route:** `/[locale]/worker`. **Files:** `src/app/[locale]/(worker)/worker/page.tsx`, `src/features/today/{TodayView,LevelHeader,ShiftSpine,ActionLead,SiteEntry}.tsx`, `src/features/today/useTodayModel.ts` (extends F1's `useSiteToday`), tests, `tests/e2e/worker-today.spec.ts`.

**Interfaces:** reuses F1's view model (freshness, `displayedLevel` = more severe of site and personal, personal only when the policy `config_version` equals the forecast's) and adds the replay clock (`useClock`), `ban` (from `ban_window`), waypoints (Now, Break in X, Back to work, Shift ends only when `CrewTimeline.shift` exists). Layout (one column, 440 px): header (site, crew, clock in `<bdi>`, `SunToggle`), `LanguageChips`, `LevelSign hero` with until time, vertical `ShiftSpine` (`data-hero`, waypoint labels at least 16 px), `ActionLead` (verb plus number from the hour's `action_codes` mapped to message keys; an unknown code renders "Follow the site rules", never invented wording; marked "Draft wording, awaiting clinical review"), "Also now" list (water, never work alone) only from codes, "Why Orange?" `ProofChip` (`proofFromForecast`), the dock. The one primary action is "Turn on warnings" while push is off (C8). **QR-less demo entry:** the empty state ("Scan your crew's code", reason, primary "See the demo yard") calls `useDeviceSite().choose(demoSite.id, DEMO_CREW_ID)`; `?site=` and `?crew=` also pin (for e2e).
States (all through the API scenario header): ideal site level, personal (a profile exists and is more severe: "Your own level is higher"), partial (personal unavailable: site level plus reason), loading (skeleton at final size), empty (no pin), error (site rules plus retry plus request id), stale ("Last known level", absolute time and age, dashed marker), offline (clock pictogram, "Offline. Updated 09:40, 1 h 30 min ago"), fallback (`forecast_status: "fallback"`: "Site rules: rest in shade every hour, drink water"), out of season (no slot, "No midday break by law after 15 Sep"), no shift.

- [ ] **Step 1: Failing tests:** `test_stale_and_fallback_are_not_live`, `test_out_of_season_has_no_slot`, `test_unknown_action_code_falls_back_to_site_rules`, `test_primary_action_is_turn_on_warnings_when_push_off`, `test_demo_yard_entry_pins_site_and_crew`, `test_revoke_clears_site_pin` (with Task 3), `test_personal_level_never_shown_when_forecast_does_not_cover_now`; e2e `QR-less demo entry reaches a level in two taps`, `out of season Today has no slot`, `sun mode follows the replay clock and the toggle overrides until midnight`.
- [ ] **Steps 2-5:** implement, verify, **gate** (390, night and sun, en and ur, every state). Commit `feat(worker): Today on the Qaylula spine`.

---

### Task 17: View - worker alert and the push target (3 h, Lane B, tier M)

**Route:** `/[locale]/worker/alert?audience=site|crew&target=<id>&level=<level>&valid_from=<ISO>`. **Files:** `(worker)/worker/alert/page.tsx`, `src/features/alert/{AlertView,ChangedBracket,alert-params.ts}.tsx`, modify `src/features/push/notification.ts` and its unit tests (C11).

**Interfaces:** `parseAlertParams(search): AlertParams | null` (invalid, missing or an unknown level redirects to Today); `alertWindow(hours: readonly HourForecast[], validFrom: string): { level: Level; from: string; to: string | null; previous: Level | null } | null` (the run of hours from `valid_from` at that level). `notificationTargetUrl(locale, payload)` returns `/${locale}/worker/alert?audience=${payload.audience}&target=${payload.target_id}&level=${payload.level}&valid_from=${encodeURIComponent(payload.valid_from)}`. View: kicker ("Site heat warning, sent 09:40"), `LevelSign hero` ("from 10:00"), a horizontal `TimeSpine` "what changed in your shift" with the changed window bracketed and the unchanged parts dimmed, one primary action "Got it" (to Today), three action lines, "Why?" proof chip; personal level recomputed on open and shown only when more severe ("Your level is higher: ..."). No audio (C8).
States: ideal, personal more severe, loading, empty (the warning ended: "This warning ended at 17:00", link to Today), partial (personal not computable: site level plus reason), offline (saved on the phone), invalid params.

- [ ] **Step 1: Failing tests:** `test_notification_target_url_carries_alert_identity`, `test_alert_window_run_and_previous_level`, `test_ended_alert_is_empty_state`, `test_invalid_params_redirect_to_today`, e2e `tapping a notification opens the alert in the worker's language` (extends F1's push e2e).
- [ ] **Steps 2-5:** implement, verify (F1 push tests still green), gate (390, night and sun, en and ur). Commit `feat(worker): alert card and push target`.

---

### Task 18: View - "I feel unwell" call sheet (2 h, Lane B, tier M: safety, never cut)

**Route:** `/[locale]/worker/unwell`. **Files:** `(worker)/worker/unwell/page.tsx`, `src/features/unwell/{UnwellView,ElapsedTimer,clinical-label.ts}.tsx`, modify `src/features/pwa/fallback.ts` (precache `/<locale>/worker/unwell` for every locale, next to the offline pages), tests.

**Interfaces:** static RSC, precached, works offline; no analytics, nothing is sent (ADR 0045 F2 option b, the minimal form; the first-aider call row is DESIGNED because `Site` carries no phone). Hero: a 104 px "Call 998" `tel:998` link (ambulance), `data-hero`, and an elapsed timer since the tap (kept in `sessionStorage` only, a 10-minute ruler), the dock shows "Back to Today" instead of "I feel unwell" on this page (critique fix 8). Steps in ADOSH's exact words (CoP 11.0 Technical Guideline, section 4.5(c)): "Call emergency contact number and notify supervisor", "Move the sick employee to a cool shaded area", "Cool the employee using methods such as: soaking their clothes with water; spraying, sponging, or showering them with water; and fanning their body." (no other clinical wording; no "sip water"); citation line; `clinical-label.ts` exports `CLINICAL_REVIEW: string | null = null` and the label per ADR 0035 ("Reviewed by an independent clinical consultant, <date>" only when non-null; else "Not clinically reviewed"); "Your supervisor does not see this screen." (HANDOFF Q1, the "notify supervisor" step versus rule G9, is an open owner question: the exact ADOSH text is shown unedited and the question stays open).
States: ideal, empty (no first-aider number: "Ask the nearest person to call your first aider"), offline ("Calling works without internet"), reviewed versus not reviewed.

- [ ] **Step 1: Failing tests:** `test_call_998_link_present_in_every_state`, `test_steps_are_the_exact_adosh_text`, `test_unwell_precached_for_every_locale`, `test_dock_shows_back_to_today_here`, `test_timer_state_never_leaves_the_device` (no fetch, no storage other than sessionStorage), e2e `unwell sheet works offline after one visit` (go offline, open, `tel:998` link visible).
- [ ] **Steps 2-5:** implement, verify, gate (390, night and sun, en and ur). Commit `feat(worker): unwell call sheet, offline and precached`.

---

### Task 19: View - supervisor crews with Stop work (3.5 h, Lane B, tier M)

**Route:** `/[locale]/supervisor`. **Files:** `(supervisor)/supervisor/page.tsx`, `src/features/supervisor/{CrewsView,CrewStrips,FocalSentence,StopWorkBar,useStopWork,stop-outbox}.tsx`, `src/features/supervisor/crew-model.ts`, tests, `tests/e2e/supervisor-crews.spec.ts`.

**Interfaces:** `CrewStripModel { crew: Crew; level: Level | null; working: boolean; until: string | null; startsAt: string | null; planState: "signed" | "unsigned" | "changed"; suppressed: boolean; cells: {hour: number; level: Level | null; onShift: boolean}[] }`; `buildCrewModels(crews, timelines, dayPlans?, now)` ranks worst first (rank = level index times 10 plus working); the focal sentence is a message with slots ("Crew B is Orange until 17:00 (work 20, rest 40); midday break in 1 h 20 min."). Hero (`data-hero`): `CrewStrips`, one `TimeSpine` row per crew across the day, bar height is the level, colour is heat, the slot through every row (dashed labelled outline out of season), a now line; each row is a link (focus ring 3 px `--ink`, critique fix 5). **Primary action: "Open Crew B plan"** (the prototype's Relay is deferred). **`StopWorkBar` (`data-emergency`) is pinned for the focal crew**: ink, always rendered, no dialog; `useStopWork(crewId)` returns `{ state: "idle" | "sending" | "stopped" | "queued"; stopId: string | null; undoSecondsLeft: number; stop(): void; undo(): void; resume(): void }`; `stop()` posts `create_crew_stop`, shows "Crew B stopped 11:10. Stop recorded; the crew's phones are being alerted." with a 10 s Undo (`delete_crew_stop`); after 10 s the bar reads "Work stopped 11:10" with a secondary "Resume work" behind a confirm dialog; offline `stop()` writes `stop-outbox` (IndexedDB `sb-stop-outbox-v1`, crew id and client time only), shows "Not sent: no signal. Tell the crew now." and drains on reconnect and app open. k-suppressed crew D: footnote "Crew D has fewer than 5 people, so its health detail is hidden to protect privacy. Its level is shown." Replay stamp. Push-off banner. Journeys SU8, SU9, SU10, SU13.
States: ideal, loading, empty (no crews: no deferred links), error, stale (rule-plan fallback note), offline (notice; data only if C6 approved), partial (suppressed), push-off.

- [ ] **Step 1: Failing tests:** `test_crews_ranked_worst_first`, `test_suppressed_crew_keeps_level_and_hides_detail`, `test_stop_never_disabled` (idle, sending, offline, validator-failed plan), `test_stop_undo_calls_delete_within_10s`, `test_stop_copy_never_claims_delivery`, `test_offline_stop_goes_to_outbox_and_reads_not_sent`, e2e `stop work then undo`, `focused crew row has a visible focus ring`.
- [ ] **Steps 2-5:** implement, verify, **gate** (390 and 768, night and sun). Commit `feat(supervisor): crews today with Stop work`.

---

### Task 20: View - supervisor plan with sign-off (6 h, Lane B, tier M)

**Route:** `/[locale]/supervisor/crews/[crewId]`. **Files:** `(supervisor)/supervisor/crews/[crewId]/page.tsx`, `src/features/supervisor/plan/{PlanView,PlanStrip,BlockRows,FloorBanner,SignOffForm,derive-ack.ts}.tsx`, tests, `tests/e2e/supervisor-plan.spec.ts`.

**Interfaces:** data from `get_crew_day_plan` (BFF adds the token). `FloorBanner` renders the banner code `plan.floor_banner` text from messages ("Green is not permission to extend work. Legal and ADOSH minimums still apply. Advisory only; the employer remains the duty-holder."). Hero (`data-hero`): `PlanStrip` (plan blocks against the WBGT curve, slot cut through, now line). Blocks are **44 px rows under the chart**, not SVG buttons (critique fix 5): time, state (Work, Rest in shade, Art. 18 break, Midday break, Stop work), clause on expand. `deriveAckItems(segments: PlanSegment[], zoneHours: DayPlan["zone_hours"]): AckItem[]` with `AckItem { id: string; zone: "medium" | "high" | "red"; startsAt: string; endsAt: string }` and `id = ${zone}@${startsAt}`: **one item per run of the same level** (consecutive hours at one zone merge; Low zone needs none), used only when the server's `ack_items` (R3) is absent; a contract test compares both once B3 Task 17 lands. `SignOffForm`: one tick per item, a message "N items need a tick: ...", submit never pre-disabled, "Tick N more items to sign" with focus on the first unticked, `sign_off_day_plan` on success then `signed` ("Signed 11:12 by the site supervisor. Crews see this plan."); a 409 `review-required` shows the server's missing ids. **Sign-off never delays or gates an alert or a stop:** `StopWorkBar` (shared with Task 19) is outside the form and untouched by its state; unsigned at shift start reads "Not signed. Crews see the rule plan, labelled unsigned fallback. Alerts and Stop work do not wait for you." Pay impact is not shown (ADR 0053 stays deferred for it). One primary action: "Sign off" (the Stop bar is the permanent emergency control, `data-emergency`, and is visually at least as prominent as the primary, critique 2).
States: ideal, loading, empty (no plan today; no link to a deferred view), error (the plan did not load; crews see the rule plan; request id), **validator-failed** (500 `plan-invalid`: "This plan failed the rule check and is not shown. Crews see the site-rules fallback, never less protective than the midday ban. Sign-off is off until a plan passes." plus request id; the Stop bar stays), unsigned, stale (rule plan), signed, stopped, stopped offline.

- [ ] **Step 1: Failing tests:** `test_derive_ack_items_one_per_run` (hours Low, Medium, Medium, High, High, Medium give three items; Low gives none), `test_signoff_blocks_until_ticked_without_disabling_submit`, `test_stop_works_while_signoff_pending`, `test_validator_failed_plan_is_never_shown_and_signoff_off`, `test_blocks_are_rows_with_44px_targets`, `test_unsigned_banner_says_alerts_and_stop_do_not_wait`, e2e `sign off a plan: tick each run then Sign off, then Stop work`.
- [ ] **Steps 2-5:** implement, verify, **gate** (390 and 768, night and sun, every state). Commit `feat(supervisor): crew plan with sign-off and stop`.

---

### Task 21: View - worker My data (2.5 h, Lane B, tier S: cut 1)

**Route:** `/[locale]/worker/data`. **Files:** `(worker)/worker/data/page.tsx`, `src/features/profile/MyDataView.tsx`.

**Interfaces:** the `AccessLog` of Task 15 fed by `get_site_transparency_log` for the pinned site (the refused request is the hero event, enlarged); a stored-on-this-phone list (what the F1 store holds, with the `storage.persist()` result); **"Remove my data" as an outline destructive control** behind `ConfirmDialog` (native `<dialog>`), reusing F1's revoke (never reports success while data remains, invariant b; shows incomplete states). No filled primary on this screen (critique fix 8). Wires the dock's My data tab.
States: ideal with the refused row, loading, empty ("Nobody has asked for your data"), error (log section only; the local section still shows), confirm, removed, offline (unsubscribe queued).

- [ ] **Step 1: Failing tests:** `test_remove_confirm_and_incomplete_state`, `test_log_error_keeps_local_section`, `test_no_filled_primary_on_data_page`, e2e `refused request visible on the worker's own log`.
- [ ] **Steps 2-5:** implement, verify, gate. Commit `feat(worker): my data with the access log`.

---

### Task 22: i18n pass and right-to-left (3 h, Lane A, tier M)

**Files:** `frontend/scripts/i18n-sync.mjs`, `frontend/messages/*.json`, `frontend/messages/review-manifest.json`, `tests/unit/i18n/{messages-parity,review-manifest,copy-rules}.test.ts`, `tests/e2e/rtl.spec.ts`.

**Interfaces:** each view task adds its `en` keys (own namespace, by `Edit`, never `Write`) and runs `node scripts/i18n-sync.mjs`, which copies missing keys into the five other catalogues as the English text and records them in `review-manifest.json` as `{locale, key, status: "untranslated", safety: boolean}`. This task translates every `untranslated` entry (ar, ur, hi, bn, ne; Sonnet drafts) to `machine-draft`, keeps `_meta.review_status: "machine-draft"` and the `DraftBadge` on every non-`en` screen, and tags `safety: true` for level words, action lines, alert, unwell, push and stop-work keys. **Native review needed:** the manifest is the reviewer's list; it includes the F1 strings Ali counted as 30 (the implementer reports the real F1 and F2 totals if they differ). The exact ADOSH steps are machine drafts of an exact English source: shown with the draft badge and `Not clinically reviewed`. Copy rules asserted in `en`: no em or en dash, no `ADR \d|HANDOFF|\bB[123]\b`, ICU placeholders equal across locales, Western digits only.

- [ ] **Step 1: Failing tests:** `test_review_manifest_lists_every_non_en_key`, `test_no_untranslated_when_release_flag` (`SB_REQUIRE_TRANSLATED=1`), `test_en_copy_rules`, `test_placeholders_equal`, `test_no_fixed_height_on_text` (a scan of the Tailwind classes on text elements), e2e `ur worker today is rtl and unclipped` (screenshot plus computed `direction`, `line-height` at least 2.5 on Urdu body, no fixed `height` on Urdu text nodes), `ar replay scoreboard mirrors and keeps Western digits`.
- [ ] **Steps 2-5:** run, translate, verify, **gate** (Urdu and Arabic screenshots of Today, alert, unwell, crews, scoreboard). Commit `feat(i18n): machine drafts for the F2 strings with a native-review manifest`.

---

### Task 23: Offline behaviour, service worker changes, device outbox (2 h, Lane B, tier M; only the allow-list extension waits on D2 and D8)

**Files:** `frontend/src/features/pwa/{api-cache,runtime-caching,fallback}.ts` and their tests, `tests/e2e/offline-f2.spec.ts`.

**Interfaces:** (1) the allow-list **stays exactly** forecast/today and risk-policy unless Ali approves D2 and the architect's ADR exists, in which case `OFFLINE_API_ALLOW_LIST` gains `GET /api/v1/sites`, `GET /api/v1/sites/{id}/crews`, `GET /api/v1/crews/{id}/timeline` (public, non-personal, ADR 0050); `API_CACHE_MAX_ENTRIES` 20 holds (about 9 entries). (2) every employer, token or write route stays `NetworkOnly` (the existing rule for `/api/` covers them; a new test enumerates each F2 operationId). (3) the `/worker/unwell` precache (Task 18) is verified. (4) offline per view: Today stale or offline banner, unwell opens, supervisor shows the Stop outbox state, judge pages render from the document cache after one visit, the governance and try pages fall to the RECORDED fixtures.

- [ ] **Step 1: Failing tests:** `test_every_f2_operation_has_a_cache_rule` (allow-listed or NetworkOnly, none cached by default), `test_stop_outbox_survives_reload_and_never_reports_sent`, e2e `no employer route is cached` (after the whole journey, `caches.keys()` contents contain no `day-plan`, `data-requests`, `stops`, `sign-off`, `transparency-log` URL), `judge pages render offline after one visit`, `offline Today shows the stale banner`.
- [ ] **Steps 2-5:** implement, verify (F1 SW tests green), commit `feat(pwa): F2 offline rules, precache unwell, device outbox`.

---

### Task 24: Real API wiring and parity vectors (2.5 h, Lane B, tier M)

**Files:** `frontend/openapi/stellar-blaze.openapi.json` (from `backend/openapi/v1.json`), `frontend/src/api/schema.d.ts`, `frontend/scripts/sync-b3-fixtures.mjs`, `frontend/tests/fixtures/risk/personal_level_vectors.json`, `tests/unit/features/risk/personal-vectors.test.ts`, `frontend/playwright.config.ts` (a `live` project), `frontend/package.json` (`e2e:live`).

- [ ] **Step 1:** copy B3's `backend/openapi/v1.json` (Task 0, updated by Tasks 10, 11, 17), `pnpm api:gen`, fix every type error (each is a contract difference to report to B3, not to patch around).
- [ ] **Step 2: Failing test then implement:** `personal-vectors.test.ts` runs B3's `personal_level_vectors.json` (ADR 0049 §6: inputs, expected probability to 1e-9, expected level) against F1's `exceedance.ts` and `personal.ts` (bands 0.10, 0.50, 0.90 now arrive in `RiskPolicy.bands`; update the F1 fixture bands 0, 0.10, 0.30, 0.60).
- [ ] **Step 3:** contract tests for sign-off: `deriveAckItems` equals the server's `ack_items` on the fixture crew.
- [ ] **Step 4: Verify live.** With B3 running (`API_ORIGIN` set, `DEMO_EMPLOYER_TOKEN` set): `E2E_API_ORIGIN=... pnpm e2e:live` runs the Task 26 journey spec against the real API; record each difference.
- [ ] **Step 5: Commit** `feat(api): swap to the B3 v1 contract, parity vectors, live e2e project`.

---

### Task 25: JS budget, Lighthouse and Docker (3 h, Lane A, tier M)

**JS budget plan.** F1 measured `/en/worker` 161,018 B and `/en/worker/alerts` 172,582 B against 174,080 B (Task 0 re-measures with the Qaylula build). The plan holds every route under the same number by these steps, in this order, stopping when every route passes:

| Step | Change | Why it should pay |
|---|---|---|
| 1 | `QueryProvider` only in `(worker)`, `(supervisor)` and the two `(live)` judge routes (done in Task 3) | static judge pages and the landing carry no Query |
| 2 | Judge pages are RSC reading build-time JSON; client islands only for Play, the drawer (dynamic), the scrubber, the validator and governance forms | scoreboard, day and proof ship almost no page JS |
| 3 | `ProofDrawer` and `FieldCanvasGL` through `next/dynamic` after idle | off the critical path and out of first-load chunks |
| 4 | No `zod`, no `lucide-react`, no `cn` on worker, supervisor and judge routes (F1 R29; inline SVG pictograms); zod stays with the held profile form | the 15 KB zod cost F1 measured |
| 5 | Messages pruned per route group in `NextIntlClientProvider` (`pick`), not the full catalogue | smaller HTML and hydration payload |
| 6 | `SerwistProvider` kept (offline needs it); check its client cost in the analyzer; if it is above 4 KB gzip, register the worker from a tiny inline script instead | one provider on every route |
| 7 | Remove unused F1 shadcn components from the build (`sheet`, `select`, `radio-group`) if no F2 route imports them | dead code |

**Files:** `frontend/lighthouserc.json`, `frontend/scripts/serve-stack.mjs` (if needed), `frontend/Dockerfile` (`ARG APP_VERSION`), `.github/workflows/ci.yml` (job `frontend` only), `frontend/package.json` (`analyze`).

- [ ] **Step 1:** run the analyzer recorded in Task 0; produce the per-route table (route, first-load JS gzip, largest three chunks) into `docs/design/f2/gate/budget.md`.
- [ ] **Step 2:** apply the steps above until passing; every removal is a task-report line with its bytes.
- [ ] **Step 3:** `lighthouserc.json`: `assertMatrix` per URL: `/en`, `/en?static`, `/en/replay`, `/en/replay/day`, `/en/replay/try`, `/en/replay/governance`, `/en/worker`, `/en/worker/alert?...`, `/en/worker/unwell`, `/en/supervisor`, `/en/supervisor/crews/crew-b`. All: script size at most 174,080 B, accessibility 1, CLS at most 0.1, TBT at most 200 ms, LCP at most 2,500 (3,000 on `/en`), performance at least 0.9 (0.8 on `/en`, WebGL path). Runs: 3 on `/en`, `/en/worker`, `/en/supervisor`; 1 elsewhere. `chromeFlags: --no-sandbox` per D5.
- [ ] **Step 4:** Dockerfile passes `APP_VERSION` at build (F1 open item) so the precache revision is stable; add the `frontend` CI step order unchanged plus `pnpm exec lhci autorun` with the new URLs.
- [ ] **Step 5: Verify** `pnpm build && pnpm exec lhci autorun` exit 0; commit `perf: route budgets, Lighthouse matrix and a stable precache revision`.

---

### Task 26: End-to-end demo journey, axe, keyboard, RTL and visual baselines (4 h, Lane B, tier M; baselines S)

**Files:** `tests/e2e/{demo-journey,gate,rtl,visual}.spec.ts`, `tests/e2e/helpers/scenario.ts` (`withScenario(page, "stale")` sets `x-sb-mock-scenario`), `tests/e2e/a11y.spec.ts` (new pages and states).

- [ ] **Step 1: Write `demo-journey.spec.ts`** (mobile and desktop projects, replay mode, MSW stack):
  1. landing to scoreboard in one click (`click count == 1`, URL `/en/replay`), first Warnings proof chip opens the drawer with a SHA, Esc returns focus;
  2. worker QR-less entry: empty Today, "See the demo yard", a level shown within two taps; sun toggle changes theme and persists until midnight (fake clock);
  3. the unwell sheet: from Today tap the dock, `tel:998` visible, repeat offline;
  4. supervisor: crews worst first, open crew B plan, tick every item, Sign off, then Stop work, Undo within 10 s, Stop again and wait: "Work stopped";
  5. governance: send the employer request, 403 card shown, the worker's `AccessLog` row appears, reload, still there.
- [ ] **Step 2:** `a11y.spec.ts`: every F2 route, every state reachable by `withScenario`, both themes on field routes, zero axe findings; a keyboard-only pass per view (tab order, focus visible, drawer focus return, dialog trap).
- [ ] **Step 3:** `gate.ts` helpers (hero 35 %, one primary, spine present, transition names, copy-rule scan) asserted per view.
- [ ] **Step 4 (S):** `visual.spec.ts` baselines per state, generated inside the pinned Playwright container (Linux; not run by `pnpm e2e`, F1 R-config), PNGs to `docs/design/f2/gate/`.
- [ ] **Step 5: Verify** `pnpm build && CI=true pnpm e2e` (F1's 82 plus the new specs green); commit `test(e2e): demo journey, axe, keyboard and RTL`.

---

### Task 27: Freeze: data swap, final build and whole-branch review (2 h controller plus a Sonnet reviewer, tier M)

- [ ] **Step 1 (Wed 18 AM, after B3 Task 14):** `node scripts/sync-eval-data.mjs` from the committed `artifacts/eval/2026/*.json` and `artifacts/eval/static/roster_frontier.json`; `node scripts/record-governance-run.mjs` against the real API; `pnpm build` with `SB_REQUIRE_SCORED=1 SB_REQUIRE_TRANSLATED=0`; refresh snapshots; look at every judge screenshot (no `###` left, every number has a chip).
- [ ] **Step 2:** a fresh Sonnet reviewer takes the whole F1 plus F2 diff (F1's whole-branch review was never run) against the Review Focus lists of both plans and the web-interface-guidelines; findings are fixed or ruled.
- [ ] **Step 3:** append the parking-lot rows F1 asked for (Cache Components adoption; ESLint 9 to 10 blocked by jsx-a11y; CSP nonces; the service-worker guard for the R38 window) plus F2's deferred items (Listen audio, first-aider call row, HSE week, site setup, roster import, crew codes and join, relay, config admin screen, climate what-if, break-things panel, worker re-allow help); each with what, why parked, revisit trigger.
- [ ] **Step 4:** final run of every verification command and `pnpm exec lhci autorun`; write the freeze summary (`.superpowers/sdd/f2-summary.md`): tasks, rulings, gate scores per surface, open items.

## Ordering, lanes and hours

Lane A is design system and judge evidence; Lane B is field surfaces and glue. Hours are uncalibrated Sonnet wall-clock including one reviewer round and one design-gate round; recalibrate after Tasks 1 and 2. Capacity is about 40 h per lane (Sun 15 to Wed 18, 08:00 to 18:00 at about 10 h a day).

| Task | h | Tier | Lane | Needs | Day |
|---|---|---|---|---|---|
| 0 Preflight | 1 | M | controller | - | Sun AM |
| 1 Tokens, fonts, sun | 4 | M | A | - | Sun |
| 2 Contract, fixtures, BFF | 4 | M | B | - | Sun |
| 3 Shell, clock, pin | 3.5 | M | B | 1, 2 | Sun |
| 4 Primitives and states | 3 | M | A | 1 | Sun |
| 5 TimeSpine and ramp | 3.5 | M | B | 1 | Sun |
| 6 Proof and data | 3.5 | M | A | 4 | Sun/Mon |
| 7 Evidence components | 5 | M | A | 4, 5, 6 | Mon |
| 8 Scoreboard view | 3.5 (+1 S) | M | A | 7 | Mon |
| 9 Day view | 2.5 | M | A | 7 | Mon |
| 10 Proof sheet | 2 | M | A | 6, 7 | Tue |
| 11 Landing 2D | 3 | M | A | 4, 6 | Tue |
| 12 Landing WebGL | 2.5 | S | A | 11 | Tue |
| 13 Landing chapters | 2.5 | M | A | 7, 11 | Wed |
| 14 Try a plan | 2 (+1.5 S) | M | A | 5, 2 | Tue |
| 15 Governance | 3.5 | M | A | 4, 2 | Tue |
| 16 Worker Today | 5 | M | B | 3, 5, 4 | Mon |
| 17 Worker alert | 3 | M | B | 16 | Mon |
| 18 Unwell sheet | 2 | M | B | 3, 4 | Mon |
| 19 Crews and Stop | 3.5 | M | B | 5, 3, 2 | Tue |
| 20 Plan and sign-off | 6 | M | B | 19, 6 | Tue |
| 21 My data | 2.5 | S | B | 15, 16 | Wed |
| 22 i18n and RTL | 3 | M | A | all views | Wed |
| 23 Offline and SW | 2 | M | B | 18, 19, D8 | Wed |
| 24 Real API wiring | 2.5 | M | B | B3 Tasks 10, 17 | Tue PM/Wed |
| 25 Budget and Lighthouse | 3 | M | A | views | Wed |
| 26 E2E journey and gates | 4 | M | B | views | Tue/Wed |
| 27 Freeze and review | 2 + review | M | controller | all | Wed |
| **M total** | **82.5** (A 40.5, B 39, controller 3 with Task 0) | | | | |
| **S total** | **7.5** (Tasks 12 and 21; 1 h of Task 8; 1.5 h of Task 14) | | | | |

Lane capacity is 80 h against 79.5 h of lane M work, so there is no slack: the S items are scheduled only if both lanes are ahead of this table at the Tue 12:00 checkpoint.

**Day map.** Sun: A 1, 4, 6; B 2, 3, 5. Mon: A 7, 8, 9; B 16, 17, 18. Tue: A 10, 11, 14, 15 (Task 12 if ahead); B 19, 20 (the B3 routes land Tue AM, so the real-API checks of Tasks 14, 15, 19, 20 are run by their lane that evening against `e2e:live`, formal wiring is Task 24). Wed: A 13, 22, 25, then gate fixes; B 24, 23, 26, then live e2e; 12:00 feature freeze for new code (wiring, data swap, gate fixes only); 18:00 hard freeze.

**Checkpoints (controller):** Sun 20:00 (Tasks 1 and 2 merged; recalibrate hours); Mon 20:00 (5, 7, 16 merged); **Tue 12:00 cut decision** (if Task 9 or Task 18 is not merged, apply the cut order below); Tue 20:00 (every view ideal state done against MSW; wiring started); Wed 12:00 (data swap ready); Wed 18:00 freeze.

**Same-file hazards (never concurrent):** `messages/en.json` (Edit by namespace, never Write; each task then runs `i18n-sync`), `eslint.config.mjs` (Task 3 only), `src/styles/*` (Task 1 only, afterwards read-only; a token change goes through the controller), `src/features/pwa/*` (Tasks 18, 23), `src/features/profile/store.ts` (Tasks 3, 21), `frontend/package.json` and `pnpm-lock.yaml` (Tasks 1, 2, 24, 25: serial), `src/api/schema.d.ts` (Tasks 2, 24), `lighthouserc.json` and `.github/workflows/ci.yml` (Task 25; the `frontend` job block only, the file is shared with B1 and I1).

**Cut order if behind (decided now, applied by the controller):** 1. Task 21 My data (hide the dock tab; the access log stays on the governance page; 2.5 h). 2. Task 12 WebGL (ship the 2D field as primary, which ADR 0037's revisit trigger allows; 2.5 h). 3. Task 8 frontier section becomes a static table plus the verdict sentence (1 h, ADR 0024 allows a static chart). 4. Task 13 chapters 3 and 4. 5. Task 14 time editing, then Task 14 whole (ADR 0034 §8). 6. Task 9 worker-card aside. 7. Task 26 visual baselines. 8. then ADR 0034 §8 in order: proof chips on secondary tables, the Plans row (kept in the report and deck). **Never cut:** Tasks 1 to 7, the Warnings row with its chips, Tasks 15, 16, 17, 18, 19, 20, 23, 24, 26 and the governance refusal (ADR 0034 §9).

## Exit criteria

- Every verification command green; `pnpm design:lint` 0 warnings; `pnpm api:check` clean; Lighthouse matrix passes (Task 25); `CI=true pnpm e2e` and `pnpm e2e:live` green.
- Ten views reachable: landing and story (`/en`), season scoreboard (`/en/replay`), day (`/en/replay/day`), proof (`/en/replay/proof/<claim>` and the drawer), try a plan (`/en/replay/try`), worker Today, alert and unwell (`/en/worker`, `/en/worker/alert`, `/en/worker/unwell`), supervisor crews (`/en/supervisor`), supervisor plan (`/en/supervisor/crews/crew-b`), governance (`/en/replay/governance`); the dock links resolve to built routes only.
- Every judge number has a chip or is not shown; no `###` or `DEV 2025` stamp in the frozen build; the headline says "about 24 hours ahead".
- Gate score at least 38 of 48 on each of: landing, judge pages, worker, supervisor (recorded exceptions listed, none on criteria 5, 6, 8, 9).
- Demo journey (Task 26) passes: landing to scoreboard in one click; QR-less worker entry; unwell sheet offline; sign-off then Stop work with undo; governance refusal visible in the worker log.
- Six locales render, Arabic and Urdu right to left, the draft-translation badge and `review-manifest.json` list what needs native review; no personal or employer response in CacheStorage; revoke clears the pin.

## Erratum and pointers 2026-11-14 (the Task 18 and D4 text above is kept)
- **Citation, Task 18 Interfaces.** The text says the steps are "ADOSH's exact words (CoP 11.0 Technical Guideline, section 4.5(c))". §4.5(c) is a clause of the **ADOSH-SF Technical Guideline "Safety in the Heat" v4.0** (§4.5 Heat Stroke, page 9 of 24), a separate document that CoP 11.0 cites for guidance (cl. 3.1.1(f), 3.2(b)(ii)); CoP 11.0 itself has no §4.5 (its §4 is Record Keeping). Both PDFs were read on 2026-11-14 (MD5s in ADR 0065). **The built citation line must say "ADOSH-SF Technical Guideline "Safety in the Heat" v4.0, §4.5(c)"**, not "CoP 11.0 §4.5(c)". Where the old wording sits, in the F1 worktree: the v1 prototype `docs/design/prototype/worker-unwell.html` (footer "The steps cite ADOSH CoP 11.0 §4.5(c)." and three slot labels) and the v2 page `docs/design/v2/prototype/worker-unwell.html` (source line "ADOSH-SF CoP 11.0, Technical Guideline ..., §4.5(c)", which names the right document but presents it as part of the CoP); do not copy either line. The quoted step text is unaffected: it matches the PDF word for word.
- **Task 18 content (ADR 0065).** Task 18 designs a Call 998 hero and a first-aider row ("DESIGNED because `Site` carries no phone") and has no supervisor row. [ADR 0065](../../decisions/0065-unwell-flow-reconciles-with-cop-3-1-2e.md) accepts three one-tap calls (supervisor, site first-aider, 998), numbers from `Site.supervisor_phone` and `Site.first_aider_phone` (synthetic on the demo), nothing sent or logged. **No task or estimate exists for the two fields** (the B3 `site` table has neither; a fixture change also moves `demo_site_sha256`, ADR 0057). The line "Your supervisor does not see this screen." must not stand alone (ADR 0065 decision 4); the row order is the consultant's question.
- **D4, reset control (ADR 0066).** D4's open item is defined by [ADR 0066](../../decisions/0066-demo-reset-is-a-new-epoch-audit-stays-append-only.md): reset creates a new epoch of the synthetic site, reads are scoped to it, the audit stays append-only and records `demo_reset`. The BFF allow-list (Task 2) needs the reset call listed on `site-demo-*` only. Rate limits and the banner wording still have no task.
