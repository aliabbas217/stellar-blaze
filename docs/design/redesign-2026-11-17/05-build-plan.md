# 05. Build plan

Date: 2026-11-17 (written late; the freeze decision is pending for Thu 19 Nov morning). Audience: the controller and Sonnet implementers. Scope: build 01 to 04 in slices. This file creates no ADR; section 4 lists the ADRs the controller must write.

Estimate convention: hours are implementer hours for one Sonnet implementer including tests and one review round. They are my estimates from reading the code, not measurements, and every one carries the risk noted. Wall-clock is shorter if slices run in parallel lanes, but `messages/en.json` and `src/styles/tokens.css` are shared files: the controller must serialize commits that touch them (hazard from the parallel-agent rules: a plain commit sweeps the index).

## 1. Order by value, with the 24-hour cut line

| # | Slice | Value to a judge | Value to a worker | Hours | Cumulative |
|---|---|---|---|---|---|
| S1 | Proof layer: "Where this number comes from" and "For auditors" | Highest (credibility, the owner's loudest complaint) | None | 4.5 | 4.5 |
| S2 | Landing story, role door, story order, no Proof step | Highest | Low | 6.5 | 11.0 |
| S3 | Plain copy on scoreboard, day, try a plan, governance | High (first click lands on the scoreboard) | None | 2.5 | 13.5 |
| S4 | Control system and tokens | High | High | 3.5 | 17.0 |
| S5 | Worker Today restructure and settings sheet | Medium (the product beat) | Highest | 5.0 | 22.0 |
| S6a | Worker join: replace the dead end (find site and crew, `/worker/join` link) | Medium | Highest | 2.5 | **24.5** |
| ---- | **24-hour cut line** | | | | |
| S6b | Worker join: language and warnings steps, privacy card | Low | High | 2.0 | 26.5 |
| S7 | Role entries (crew lead, officer), `/hse` minimal page, `/tour`, role badge | High (answers "is there auth") | None | 3.5 | 30.0 |
| S8 | Crew QR page (real join links, print sheet) | Medium (the live demo beat that connects crew lead to worker) | Medium | 2.5 | 32.5 |
| S9 | Roster CSV preview (client only) | Low | None | 3.0 | deferred |
| S10 | New site form, HSE weekly table and export | None without a backend | None | n/a | deferred |
| S11 | Sign-in (Entra, invitation links), roles beyond `employer` | None | None | n/a | deferred, plan only |
| S12 | Worker heat-profile form | None | Low (personal level is inert) | n/a | parked |
| S13 | Glossary page (8 entries, English) | Low | None | 1.0 | optional |
| S14 | `/replay/audit` index and a static copy of the locked test plan | Medium for auditors | None | 2.0 | optional (owner decision D6) |

Everything above the line fits in about 24 hours. The stretch to about 30 hours adds the rest of the worker join and the role entries; the QR page makes 32.5. If the owner moves the freeze, add in this order: S7, S6b, S8. If the freeze holds at Thu morning, S6b, S7 and S8 are what to show instead of build (section 3).

Dependencies: S4 before S5 (class lists), S1 before S3 (S3 reuses the structured verdict fields), S2 and S7 share the role door component (build the component in S2), S6a before S8 (the QR encodes the join link). S1, S2 and S4 are independent and can start together.

## 2. Slices

Common gates for every slice (the project's own, unchanged): `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm design:lint`, `SB_REQUIRE_TRANSLATED=1 pnpm i18n:check`, `pnpm e2e:registered` (every Playwright test title is listed in `tests/e2e/registered-tests.json`), axe in each theme, the overflow checks at 320, 390 and 768 px in en, ur and ar (`field-widths.spec.ts`), `pnpm bundle:check`, and the Lighthouse matrix of ADR 0069 for any new route. "Done" needs a screenshot compared against the prototype.

### S1. Proof layer (4.5 h)

- Files: `src/components/provenance/{proof.ts, ProofRows.tsx, ProofChip.tsx, ProofDrawer.tsx}`, `src/features/judge/{ProofSheet.tsx, proof-claims.ts}`, new `src/components/provenance/proof-story.ts`, `messages/en.json` and the five catalogues (via `pnpm i18n:sync`).
- Work: add `ProofStory` and a pure `buildStory(family, params)` (02b section 2); keep every existing `Proof` field; split `ProofRows` into `StoryRows` and `AuditRows`; `AuditRows` skips null fields and renders no placeholder; delete `states.proof.notRecorded`; replace the four-step timeline with a three-step version shown only for scored claims (`evaluation` present); chip label "Where from" with accessible name "Where this number comes from: {what}"; "For auditors" `<details>` (collapsed) on the sheet and a link to `#audit` from the drawer. Fix `proofFromForecast` so the worker drawer never prints `policy=... config=...` or the API operation name outside the auditor layer.
- Strings: about 30 new English-only keys under `states.proof.story.*` and `states.proof.audit.*` (Tier 2: `states.proof.` is in `CLAIM_PREFIXES`, so no translation), 6 removed. Translation cost: none.
- Bundle: the drawer is a dynamic import and stays one; the chip is already in first load. Expected change under 1 KB gzip. Verify on `/` and `/replay` (174,080 B budget).
- Tests: new unit tests: `buildStory` per family (numbers equal the fixture fields), the jargon lint over the rendered story, "no empty field" over `AuditRows`; update e2e that click or name "Proof" (search for `Proof` in `tests/e2e/judge-*.spec.ts` and `kit.spec.ts`; the dev kit section `common.kit.sections.proof`), register changed titles.
- ADR: three-layer model and plain proof (A1).
- Risk: medium. Existing tests assert the chip name; claims with partial provenance must keep their current behavior (no number without a complete record).

### S2. Landing story, role door, story order (6.5 h)

- Files: `src/app/[locale]/page.tsx`, `src/features/judge/landing/LandingView.tsx` (restructure; keep `FieldGate`, `FieldPoster`, the field and its loading rules), new `src/features/judge/landing/RoleDoor.tsx` (server component, four links), `src/components/shell/{story-steps.ts, StoryNav.tsx}`, `src/app/[locale]/(judge)/replay/layout.tsx` (nav labels), `messages/*.json` (`judge.landing.*`, `judge.story.*`, `shell.desk.nav`, `shell.roleChooser.*`).
- Work: hero per 02 (H1, lede, role door, phone sign built from existing presentational components with static demo props, field kept with its caption; remove the six-line readout and the hook from the hero); sections "A morning on site", "Tonight's plan", "The boundary", "Last summer, replayed" (four bars from the scored file, ledger numbers read by the existing loaders, never typed), "What this does not show yet"; footer links "For auditors" and the machine-translation notice. `STORY_STEPS` becomes: problem, product, evidence, day, boundary, with the Proof step removed and the product step linking to the guided tour (`/tour`, built in S7; until then link to `/worker`). Reduce chips to three.
- Strings: about 45 rewritten in `judge.landing.*`; 4 role-door titles plus 4 lines plus 1 demo note. Decision D2: put the story sections' copy (about 35 strings) under a Tier 2 prefix (add `judge.landing.story.` to `CLAIM_PREFIXES`) so only the hero, role door and CTAs (about 12 strings) need five machine translations. Without D2 the landing needs about 45 strings in five languages.
- Bundle: the landing is mostly server rendered; removing the hook block and the readout reduces first-load client code slightly. Budget 174,080 B.
- Tests to update: `judge-landing.spec.ts`, `judge-landing-contrast.spec.ts` (data-contrast names), `judge-landing-sw.spec.ts`, `hero-share.spec.ts`, `landing-display-face.spec.ts`, `demo-journey.spec.ts`, `StoryNav` unit test (it asserts flags against route files), a11y (`/en`, `/ar`), overflow in ur and ar (display line heights are tuned; re-measure), the Lighthouse landing row.
- ADRs: story order (A2); Tier 2 for story copy (A10).
- Risk: high for RTL and for the hero's tuned line heights; keep the CSS custom properties `--sign-leading-display` etc.

### S3. Plain copy on the judge surfaces (2.5 h)

- Files: `messages/en.json` (`judge.scoreboard.*`, `judge.day.*`, `judge.try.*`, `judge.governance.*`), `src/features/judge/{VerdictList.tsx, policy-tradeoff.ts, table-text.ts, adapters.ts}`, new `src/features/judge/verdict-plain.ts`.
- Work: apply `01b-content-audit.md` section 3: policy names without codes, the regulator-zones honesty sentence under the table, plain verdicts composed from structured fields by fixed templates (H4 and H5, see the implementation note in 01b), Plans heading rewrites, day counters, "rule checker". The verbatim sentences move to the auditor layer (S1).
- Strings: about 40 replaced, English only (claims prefixes). No translation.
- Tests: unit tests asserting every number in a plain verdict equals its source field and the ledger value for the committed fixtures, and that "met" or "not met" equals the file's flag; the jargon lint over `judge.*`; update `judge-scoreboard.spec.ts`, `judge-day.spec.ts`, `judge-try.spec.ts`, `judge-governance.spec.ts` text assertions.
- Risk: honesty. A wrong template is worse than the jargon. Review each template against the ledger by a second agent.

### S4. Control system and tokens (3.5 h)

- Files: `src/styles/tokens.css`, `src/styles/globals.css` (`@theme` radius and type steps), root `DESIGN.md`, `src/components/states/actions.ts`, `src/components/ui/button.tsx`, `src/components/shell/{LanguageChips.tsx, DemoModeSwitch.tsx, WorkerDock.tsx, SunToggle.tsx}` (restyle only), `src/features/supervisor/StopWorkBar.tsx` (restyle only), `tests/unit/styles/tokens.test.ts`.
- Work: add `--r-ctl`, `--r-card`, `--r-pill`, `--target-stop`, the type steps; re-point `ACTION_PRIMARY` to the signal fill, `ACTION_SECONDARY` to the tonal fill and ring, add `ACTION_QUIET` and `ACTION_STOP`; chips and tabs become pills; update DESIGN.md in the same commit; extend `scripts/contrast.mjs` for hover and pressed mixes.
- Strings: 0.
- Bundle: 0 (CSS only). Expect a small CSS increase.
- Tests: tokens test, `design:lint`, axe in both themes on every route, overflow at 320, 390 and 768 px in en, ur and ar (buttons use `min-height` so Nastaliq grows, keep that rule), `kit.spec.ts` (measures the sign boxes), any visual baselines (none are registered that I could see; unverified).
- ADR: radius and control tiers, amending the root DESIGN.md (A3).
- Risk: medium. It touches every screen at once; run the full e2e before merging.

### S5. Worker Today restructure and settings sheet (5.0 h)

- Files: `src/features/today/{TodayView.tsx, LevelHeader.tsx, ActionLead.tsx, ShiftSpine.tsx, action-codes.ts}`, `src/components/shell/FieldShell.tsx` (header), `LanguageChips.tsx` (becomes the settings pill), new `SettingsSheet.tsx`, `src/components/level/LevelSign.tsx` (hero size 32 px), `TodaySkeleton` heights.
- Work: per 04 section 3: action sentence first, level row, horizontal strip (`TimeSpine orientation="h" surface="field"`, already supported), at most three "Also now" rows with one glyph each (stop mapping three rules to the buddy glyph), one clinical note, a quiet warnings row, the settings sheet. Build the sheet as a native `<dialog>` or `<details>` with no client JavaScript beyond what the header already has, because `/worker` has a 199,680 B ceiling and I do not know its current headroom (the brief says about 6 KB on the crew-plan route). Do not use `components/ui/sheet.tsx` (Base UI) on this route without measuring.
- Employer duties: stop rendering "No unacclimatised person to work", "High Risk induction required ..." and "Provide personal water bottle ..." on Today; render them on the crew plan page under "Site duties today" only if the crew-plan route stays under its budget (otherwise show them nowhere for now and park them: the codes still exist in the data).
- Strings: about 9 new Tier 1 (settings title, "Screen colors", Automatic, Bright, Night, "Change crew", plus the "Demo" tag and the unified clinical note), each needing five machine translations; about 6 removed.
- Tests: `worker-today.spec.ts`, `worker-today-notlive.spec.ts` (the stale, offline, fallback states), `worker-alert.spec.ts` (shared sign), `field-widths.spec.ts` (the "no QR: empty" case clicks `entry.demo`; it changes in S6a), `rtl.spec.ts` (the strip mirrors), `kit.spec.ts`, axe, Lighthouse `/worker`, `bundle:check`.
- ADRs: clinical note placed once (A4, amends ADR 0035 placement; the label itself stays); language chosen at join and a header pill (A5).
- Risk: highest. Skeleton heights and CLS (budget 0.1), Nastaliq line heights, and the three-state strip.

### S6a. Worker join, part 1 (2.5 h) and S6b, part 2 (2.0 h)

- Files: new `src/app/[locale]/(worker)/worker/join/page.tsx` (a route without the dock), new `src/features/join/{JoinView.tsx, StepCrew.tsx, StepLanguage.tsx, StepWarnings.tsx}`, `src/features/today/SiteEntry.tsx` (replace the dead-end with a redirect to join), `src/features/push/AlertsSettings.tsx` (the "Choose your site first" state links to join), `src/features/profile/choose-site.ts` (reuse `chooseDeviceSite`, unchanged), `src/api/queries.ts` (check for an existing `list_site_crews` query; the supervisor crews screen reads crews so one probably exists: unverified).
- S6a: `/worker/join?s=&c=` shows the confirm card (reads the site and the crew from the public endpoints), pins on "Yes, this is my crew", then goes to Today; with no query it lists workplaces then crews; "Just looking? Try the demo yard" stays. S6b: language step (six rows) and the warnings step with the privacy card and the in-app-browser banner (a string and a user-agent check; the list of in-app browsers is unverified).
- Strings: about 22 new Tier 1 (steps, buttons, privacy card), five machine translations each; S6a is about 12 of them.
- Bundle: a new route with its own 174,080 B budget; it imports the query client and loads the profile store lazily (as `chooseDeviceSite` does). Measure.
- Tests: new `worker-join.spec.ts` (register in the manifest; cases: QR link, picker, wrong crew, expired code, offline, ur right-to-left), update `field-widths.spec.ts` and `worker-today.spec.ts` first-run cases, a11y for the new route, Lighthouse row.
- ADR: un-defer worker-join (A7), supersedes ADR 0045 deferred entry 1.
- Risk: medium. The API lists only the demo site today, so "pick your workplace" has one entry; say so in the demo.

### S7. Role entries, minimal HSE page, tour, role badge (3.5 h)

- Files: new `src/app/[locale]/(supervisor)/supervisor/enter/page.tsx`, `(hse)/hse/enter/page.tsx`, rewrite `(hse)/hse/page.tsx`, new `src/app/[locale]/tour/page.tsx`, new `src/lib/demo-role.ts` (`sessionStorage`), `SupervisorFrame.tsx` (badge and sign out), the front-door `/start` page reusing `RoleDoor`.
- Work: 03 sections 2, 4.1, 5, 6. The role is navigation state only; the BFF allow-list (ADR 0062) is untouched and is the only gate. `/hse` reads the public crews endpoint and shows plan status, signed or not, stopped or not, the privacy sentence and the boundary panel. Demo controls (Replay or Live, Reset) move into a "Demo controls" sheet.
- Strings: about 26: role entries (6, Tier 1), HSE page (10, Tier 1), tour (about 10, Tier 2 English by design), badge (2, Tier 1).
- Tests: new specs (register), the existing `/en/hse` axe test must keep passing, `supervisor-crews.spec.ts` (the demo switch moves), `shell.spec.ts`.
- ADR: demo role entry and the production access plan (A6); worker accounts rejected (in A6).
- Risk: low to medium. The risk is a reviewer reading the role entry as real authentication; the on-screen sentence ("Demo access. Anyone can enter") is required.

### S8. Crew QR page (2.5 h)

- Files: new `src/app/[locale]/(supervisor)/supervisor/crews/[crewId]/join/page.tsx`, a small server-side QR helper, print CSS.
- Work: a server component renders the join link as an inline SVG QR (no client JavaScript), crew language chips (server links), "Print the A5 sheet" (`window.print` through a tiny inline handler or a print link), copy link.
- Dependency: a QR encoder is needed; I did not research one. Per the project's rules, check the current release, last commit, maintenance, license and size before choosing, and prefer a package that works in a server component with no browser APIs. If none passes, write the encoder inline (a version 3 to 5 QR is about 150 lines), which I do not recommend in a day.
- Strings: about 8 Tier 1. Tests: new spec (decode the SVG's link with a test-only decoder or assert the `href` text), axe, overflow.
- Risk: medium (dependency). Nothing else depends on this slice.

## 3. What to show instead of the deferred work

| Deferred | Show instead |
|---|---|
| Crew QR (if S8 is cut) | The `supervisor-onboarding.html` screenshot on a deck slide labelled DESIGNED; in the video, the worker joins through "I work on a site" (S6a) |
| Roster CSV preview, new site form (S9, S10) | The same screenshot, labelled DESIGNED, in the roadmap beat of the video (02 section 6) and the deck. ADR 0045 already requires the label (decision 5) |
| HSE weekly table and export | One deck slide labelled DESIGNED; the minimal `/hse` page is the product beat if S7 ships, otherwise the boundary beat |
| Sign-in (S11) | A roadmap slide: invitation links and Microsoft Entra, with the honest sentence "the demo uses a shared token on made-up data" |
| Worker heat profile (S12) | Not shown; "personal level" is not claimed anywhere |
| Glossary, audit index (S13, S14) | Auditors use the per-number "For auditors" section |

## 4. ADRs the controller must write (this plan creates none)

| # | Title | Type |
|---|---|---|
| A1 | Three-layer information model; the proof chip becomes "Where from"; the auditor layer keeps the full record | New; refines ADR 0034 section 4 (the rule that a number without provenance is not shown stays) |
| A2 | Story order: problem, product, evidence, day, boundary; the Proof step is removed | New; supersedes the story-step list |
| A3 | Control radius and tiers; the 2 px radius becomes data-only | New; amends the root DESIGN.md |
| A4 | Worker Today: one clinical note per screen; employer duties off the worker screen | New; amends ADR 0035 placement |
| A5 | Language chosen at join; the header pill replaces the six chips | New |
| A6 | Access model: demo role entry, production plan, worker accounts rejected | New; extends ADR 0062 and 0054 |
| A7 | Un-defer worker-join, the crew QR and a minimal HSE page | New; supersedes ADR 0045 deferred entries 1, 7 and 10 in part (the trigger fired) |
| A8 | Defer sign-in with Entra or invitation links, roles beyond `employer`, per-user tokens | New; the trigger is ADR 0062's |
| A9 | Defer supervisor-setup, roster import and the HSE weekly table; park the worker heat-profile form | New (ADR 0045 pattern: one ADR per deferral, nothing deleted) |
| A10 | Tier 2 (English by design) for the new story copy and plain-proof copy | New; amends the i18n tier rule |
| A11 | Publish a static copy of the locked test plan for auditors (only if D6 is yes) | New |

## 5. Decisions for the owner before build starts

| # | Decision | Recommendation |
|---|---|---|
| D1 | When is the freeze? The slices above the cut line need about 24 implementer hours | Freeze Thu 19 Nov at noon at the earliest, with S1 to S6a only; do not cut S1 or S4 |
| D2 | Is English-only story copy acceptable on the landing (Tier 2), with the hero and role door in six languages? | Yes; saves about 33 machine translations and a day of RTL tuning |
| D3 | Stop work: ink slab (recommended) or safety red | Ink slab; see 04 section 2 |
| D4 | Language in a header pill and a settings sheet instead of six always-visible chips | Yes, with the language chosen at join; it is a recommendation, not proven with workers |
| D5 | "Not yet checked by a clinician" once per screen instead of twice | Yes, but it is a clinical-honesty control; the ADR 0035 owner must agree |
| D6 | Publish the locked test plan as a static page for auditors (the protocol link is null today) | Yes; auditors should not have to find a repository |
| D7 | The 3D heat field: stay in the hero beside the phone, or move to "Last summer, replayed" | Stay, with the readout removed; the phone leads |
| D8 | Cost and pilot terms for the buyer: supply a one-line statement or say "pilot pricing on request" | The repo has no cost figure; do not invent one |
| D9 | Landing numbers 1,624, 279 and 370 of 374 are not in the ledger | Keep them off the video and deck; on the site they stay only in the auditor layer or the "gap" chapter with their recorded-forecast label |
| D10 | Video: adopt the reordered script of 02 section 6 | Yes; re-record the VO, especially the regulator-zones line |

## 6. Risks across the plan

1. i18n: `SB_REQUIRE_TRANSLATED=1 pnpm i18n:check` fails on any Tier 1 key still in English. Count of new Tier 1 strings above the line: S2 about 12, S5 about 9, S6a about 12, total about 33, each in five languages. Machine drafts need the existing disclosure (they are labelled).
2. Bundle: `/worker`, `/worker/alerts`, `/worker/alert`, `/supervisor` and `/supervisor/crews/[crewId]` have a 199,680 B ceiling and the crew-plan route only about 6 KB of headroom; every other route is 174,080 B. Run `pnpm bundle:check` after S4, S5 and S6a. No new client dependency is proposed above the line.
3. The Lighthouse matrix (ADR 0069) has per-route rows; each new route (`/worker/join`, `/start`, `/tour`, the role entries) needs one.
4. Shared-file conflicts: `messages/*.json` and `tokens.css`. Serialize.
5. Honesty regression: the jargon lint and the number-equality tests are part of the slices, not follow-ups.
6. The in-app-browser detection and the QR dependency are unverified.
