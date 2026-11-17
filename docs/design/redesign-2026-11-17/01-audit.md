# 01. Audit: the first 60 seconds, for each audience

Date: 2026-11-17. Author role: senior UX and product designer. Status: diagnosis only. Nothing here was tested with a worker, a crew lead, an officer or a judge; where I say "a worker would", it is a design inference, marked as such.

## 0. Evidence base and what I did not verify

What I looked at: the three screenshots the owner supplied (`audit-landing-1280.jpg`, `audit-worker-today-390.png`, `audit-supervisor-390.png`; the landing capture is committed as a JPEG re-encode at quality 82 because the repository's large-file hook rejects the original 837 KB PNG, which stays untracked in the worktree), the proof-sheet capture (`audit-proof-1280.png`), and five more captures I took of the live France Central demo with a handful of GETs and no clicks (`audit-worker-firstrun-390.png`, `audit-worker-unwell-390.png`, `audit-worker-alerts-390.png`, `audit-hse-1280.png`, `audit-replay-1280.png`). Before the first-run capture I cleared this browser's own localStorage (local only, no state on the live site changed), because the browser profile already held a site pin. The code is the source of truth: `frontend/src/features/{today,judge,supervisor,profile,unwell}`, `frontend/src/components/{shell,provenance,level,states,ui}`, `frontend/messages/en.json`, `frontend/src/styles/tokens.css`, the root `DESIGN.md`, ADRs 0035, 0045, 0054, 0062, 0065, 0071, `docs/design/v2/ux/v2-journeys.md`, and the submission ledger and video script.

Not verified: other locales on screen (I read the English catalogue and the code only), tablet widths, Lighthouse numbers, the scoreboard table below the first fold of `/replay` (not captured), the supervisor plan and sign-off screens, and the real-phone push path. Everything below that depends on those is marked "unverified".

## 1. Corrections to the brief (conventions beat instructions)

1. The identity contract is the root `DESIGN.md` ("Qaylula", Archivo, night and sun themes, `--signal` cyan), not `docs/design/DESIGN.md`. The latter is the rejected v1 "Arish Signal" baseline (Barlow Condensed, sand palette) and is kept only as history. The prototypes here use the Qaylula values from `frontend/src/styles/tokens.css`.
2. Complaint 2 (box buttons) is not an implementation slip. It is the written spec: root `DESIGN.md` says "2 px everywhere", `tokens.css` has one radius `--r: 2px`, and the shared action classes in `components/states/actions.ts` are `rounded-sign` with `bg-ink` (a solid black slab) for the primary and a hairline border for the secondary. The system did exactly what it was told. The fix is a spec change (see 04), not a CSS patch.
3. The "Proof" step of the story is worse than the owner said. Step 4 of 5 opens `/replay/proof/forecast.hours_over_limit`, a count taken from a recorded forecast file. Its own sheet says "Protocol committed: No scoring protocol" and "Scoring run: Not a scoring run: nothing here is scored", and three fields read "Not recorded". The step that is meant to prove the pre-registered evaluation lands on a page that says nothing was scored.
4. Step 5 "The product" links to `/worker`. `StoryNav` is only rendered on judge pages (landing, scoreboard, day, proof), not inside the worker or supervisor frames, so the story ends in a dead end with no Back or Next.
5. The brief says the worker profile store exists but "no screen fills it". Confirmed and stronger: `ProfileSchema` is referenced only by its own unit test, no component saves a profile, `MY_DATA_TAB_ENABLED = false`, and `profile.*` strings (consent, workload, clothing) exist in the catalogue with no consumer. The "personal level" feature can therefore never trigger in the product. It is an inert code path, not an unfinished screen.
6. Numbers on the landing that are not in the submission ledger: 1,624 working hours, 279 inside the midday break, "370 of 374" grid cells, "33.7 °C hottest cell". They are computed from the recorded forecast file and are honestly labelled on the page, but they are not ledger numbers, so the video and deck must not reuse them. The ledger numbers on the landing are 252.5 with interval 191.5 to 315.5 and 139 days.

## 2. The five complaints, with the specific faults behind each

### Complaint 1: "A giant presentation, with just numbers and visuals. The storytelling is bad."

| Fault | Evidence |
|---|---|
| The first content after the headline is a statistic ("252.5 danger hours", an interval and a three-line definition with "thermal margin of 7 W/m²") before any person appears | Landing capture, `LandingView.tsx` hook block |
| The hero carries six numbers at once: the hook, plus a readout panel with a coordinate ("25.25 N 55.75 E"), "370 of 374", "26.6 °C", "32.5 °C", "33.7" | Landing capture |
| The five-step story puts "The product" last, so the page is an argument with the evidence first and the thing being argued for last | `story-steps.ts`: problem, scoreboard, day, proof, product |
| "Open the apps: Worker / Supervisor" is at the very bottom, as two bordered boxes, under the story nav and above a machine-translation notice | `LandingView.tsx`, end of file |
| I count 18 "Proof" chips on the 1280 landing capture (the owner estimated about 14): 1 hook, 1 readout, 3 counters, 1 "scored once", 10 in the five-row table, 2 under the verdicts | Landing capture |
| Dense paragraphs of expert language: "theta 0.30", "P0 to P3", "H4 supported at lead 1 ... 95% interval [-261.5, -154.5]", "H5 not supported at lead 1 (secondary)". The verdict sentences are printed verbatim from the scoring export (`VerdictList.tsx`: "never composed here"), so the exporter's internal ids reach the page | Landing capture, `VerdictList.tsx` |
| A bridging paragraph apologises for two different counts ("These 1,624 hours and the 252.5 danger hours count different things against different limits"). When a page has to explain why its own two numbers differ, the structure is wrong | `problem.bridge` string |
| No human, no place, no moment. Nobody on the page is doing anything. The only "who" is "a crew" | Whole page |

### Complaint 2: "The box-shaped buttons are wrong."

| Fault | Evidence |
|---|---|
| Primary action = solid ink rectangle, 2 px corners, used for every primary on every surface: "See the scoreboard", "Open the scoreboard", "Open Crew A plan", "Turn on warnings", "See the demo yard" | `actions.ts` (`ACTION_PRIMARY`), all captures |
| Secondary = hairline rectangle: "Walk me through it", "Worker", "Supervisor", "Next: Scoreboard", "Copy link to this step", "Reset demo site", "Show the daily numbers as a table" | Captures |
| Six language chips and the Replay/Live switch are also hairline rectangles, so selection, navigation and action all look the same shape | `LanguageChips.tsx`, `DemoModeSwitch.tsx` |
| Everything is the same weight. On the worker screen four solid or framed rectangles compete in one fold: "Sun mode: on", the selected language, "I feel unwell", "Turn on warnings" | Worker capture |
| Stop work is a solid black slab with an inner double border, which is correct for the one emergency action, but it no longer stands out because nine other things are also black slabs | Supervisor capture |
| There is no pressed, busy or focus language beyond a 1 px translate; the button hierarchy is shape-only, with no secondary or quiet tier | `button.tsx`, `actions.ts` |

### Complaint 3: "The worker screen UI is the worst and odd."

Measured on the 390 px capture (device pixels equal CSS pixels):

| Fault | Evidence |
|---|---|
| The word "Orange" is set at 76 px and takes about a fifth of the first fold, while the instruction the worker needs ("Work 20 min, rest 40 min in shade") is set at 22 px beneath it | Capture; `LevelSign` hero size |
| The time chart is a tall, narrow column about 65 px wide in a 358 px content width (18 percent of the width), set 12 hours tall. The remaining 82 percent of the row is blank except a "Now" label. It also runs under the fixed dock, so the day is cut in two by the "I feel unwell" bar in the full-page capture | Capture; `ShiftSpine.tsx` (vertical spine) |
| The same pictogram ("buddy", two figures) stands for three different rules: "Never work alone", "No unacclimatised person to work", "High Risk induction required ...". A pictogram that stands for several rules means nothing | `alsoPictogram()` in `action-codes.ts` |
| Employer duties are shown to the worker as if they were the worker's actions: "High Risk induction required emphasising hydration and identifying signs of heat strain", "Provide personal water bottle (2 litre capacity) on-site at all times", "No unacclimatised person to work". A worker cannot provide a bottle or hold an induction. This is an audience error: the text comes from the ADOSH Technical Guideline table written for duty holders | `worker.today.also.*` strings |
| "Draft wording, awaiting clinical review" is printed twice: once under the lead (always, in `ActionLead.tsx`) and once under the list (when any item carries clinical wording). The label is required (ADR 0035) but one instance per screen carries it | Capture; code |
| "Sun mode: on" is jargon. It does not say what it does, what "on" means, or why a worker would touch it. It also sits beside the clock in the header, where it reads as a status | `SunToggle.tsx` |
| Six language endonyms in a scrolling row directly under the header, always visible, competing with the site name. In a 390 px frame the scrollbar of the row is visible in the capture. The code comment explains why (a worker must find a language without a menu), which is a good reason but solved at the wrong place: it should be solved once at join, not on every screen forever | `LanguageChips.tsx` |
| The header spends two or three lines on the site name ("Mussafah M-14 yard (synthetic)"), a crew line, the clock and the toggle, then another 44 px on languages, then a "Site level now / Replay / until 17:00" row, before the level word. The first answer starts about a quarter of the way down the screen | Capture |
| The bottom dock is about 128 px (the unwell bar plus the two tabs) fixed over a 844 px viewport, 15 percent of the screen, always | `WorkerDock.tsx`. Correct for safety, but the tabs are text with a 2 px underline and no tab shape |
| "Replay" appears as a button-like stamp on the level row, with no explanation for a worker | Capture |

What a worker would see in three seconds today (inference): the word Orange, a drawing with two bars of orange, and a black bar. The action sentence is the third thing read.

### Complaint 4: "No onboarding flow. Nothing."

Confirmed, and it is a chain of dead ends, not only a missing screen:

1. First run on a phone with no pin shows "Scan your crew's code. Point your camera at the poster on site, or open the link in your crew's group. No account, nothing to type." and one button, "See the demo yard" (`audit-worker-firstrun-390.png`). A visitor with no poster has one choice, which is the demo yard. A real worker whose poster is torn has none.
2. `/worker/alerts` on that phone says "Choose your site first. Alerts are sent for one site." and shows a greyed "Turn on alerts" with no way to choose a site from that screen (`audit-worker-alerts-390.png`).
3. There is no `/worker/join` route, so the QR flow the code comments assume (`?site=&crew=` pins the phone) works only by hand-built URLs. `useTodayModel` already reads `?site=` and `?crew=` and pins them, so the missing piece is a screen and a QR, not plumbing.
4. Nothing explains what is stored where. The promise ("no personal data on the server") is the headline of the whole project and a worker never sees it. The phone does hold a pin, the site's two call numbers and an optional push subscription, and none of it is named anywhere a worker can read.
5. The API already offers `GET /api/v1/sites` and `GET /api/v1/sites/{id}/crews` with no credential, so "pick your workplace, then your crew" needs no backend work.
6. Supervisor and HSE onboarding (new site, roster, QR per crew) was designed (S0, S0b, S0c, H0 in `v2-journeys.md`), deferred by ADR 0045, and has no backend: there is no create-site, create-crew or roster endpoint in `openapi/stellar-blaze.openapi.json`. Any screen for these is demo-only or client-side until the API grows.
7. The HSE officer has no screen. `/hse` renders a bare "HSE overview" heading on a dark page (`audit-hse-1280.png`); a localized empty state with a "Preview the supervisor view" button exists in the catalogue but is not wired; the landing does not link to `/hse` at all.

### Complaint 5: "Don't we have any auth, so people could sign up and sign in, different types of users?"

What is true today: workers have no account by design and that is the headline governance claim (ADR 0054). Employers: the API has an `employer` role with hashed bearer tokens (`api/auth.py`, only role value accepted is `employer`), and the web server holds one shared demo token that any visitor can use on the synthetic site (ADR 0062). So there are roles on the API, none in the UI, and no visible way to say "I am a crew lead" versus "I am an officer". The owner's reading ("there is no auth") is correct from the visitor's seat. See 03 for the access model.

## 3. The first 60 seconds, by audience

### 3.1 Judge, arriving at the URL (laptop, 1280 px)

| Second | What they see | Verdict |
|---|---|---|
| 0 to 5 | Wordmark, a six-item menu (The story, Scoreboard, One day, Try a plan, Governance, For crews), the headline "Heat that stops work, forecast about 24 hours ahead", a lede, two rectangular buttons, a 3D heat map on the right with a six-line numeric readout | The headline is accurate but it names a physical phenomenon, not a product or a person. The menu uses insider words ("Governance", "For crews") with no role door |
| 5 to 15 | "252.5 danger hours at Abu Dhabi airport", an interval, a definition | A number first. The reader does not yet know what the product is |
| 15 to 40 | Scroll: three counters, a calendar heat map, an explanatory paragraph, a scoreboard table with codes P0 to P3 | Rigorous and honest, but it reads as a paper's results section, not a pitch |
| 40 to 60 | Verdict paragraphs with theta and H4/H5, then a five-step nav, then at the bottom "Open the apps" | The product is the last thing on the page. A judge who leaves at 40 seconds never sees it |

Second click ("See the scoreboard", `audit-replay-1280.png`): the first fold of `/replay` is the season chart and three counts about the raw forecast ("139 days", "1,624 working hours", "279"), preceded by the line "These are not hours that were actually over the limit". So the first numbers on the scoreboard page are not scores. The scored table is further down (unverified, not captured).

The proof sheet (`audit-proof-1280.png`) is covered in section 4.

### 3.2 Worker, on a phone (390 px)

First run: see complaint 4. After pinning (the demo yard): the Today screen of complaint 3. The alert, unwell and alerts screens:

| Screen | What works | What fails |
|---|---|---|
| Unwell sheet (`audit-worker-unwell-390.png`) | One tap from any worker screen; "Call 998" as one large control; a running timer ("You tapped at ... 0:02"); the site's supervisor and first-aider numbers are stored on the phone for offline use; honest note "Calling works without internet. It needs a phone signal." | When the numbers are not yet saved it shows two dashed boxes of explanation, which is correct and honest but visually reads as an error. The "Call 998" bar is a teal slab, so the emergency screen introduces a third button style |
| Alerts | Clear opt-in text, a visible "Remove my data from this phone" | Dead end without a site (complaint 4.2). The page is the only place a worker can read what the app stores, and it says only "personal risk ... is worked out on this phone and never sent" |
| Today | The strongest piece of the product: honest "Why Orange?" proof, offline fallback, six languages | See complaint 3 |

### 3.3 Crew lead (supervisor, phone)

`audit-supervisor-390.png` (the fixed bars floating mid-page are a full-page capture artifact, as the owner noted):

| Fault | Evidence |
|---|---|
| Judge-facing demo controls ("Replay | Live" switch, a second "Replay" stamp, "Reset demo site") sit inside the crew lead's working screen, so a first-time visitor cannot tell product from scaffolding | Capture |
| A site banner ("Synthetic demo site: no real people, no real data") is honest but costs a full band above the content on a phone | Capture |
| The focal sentence ("Crew A is Orange until 11:00 (work 20, rest 40).") is good: verb and number, worst crew first | Keep |
| The crew strips draw a dashed "Midday break by law: not in force until 15 Jun" box through every crew, so the most prominent mark on the screen is a rule that does not apply today | Capture. The honest label is right (P1 premise in the journeys doc) but it should be one line in the legend, not a column through the data |
| "Open Crew A plan" is another black slab beneath the Stop work slab | Capture |

### 3.4 HSE officer

There is no first 60 seconds. The page is a heading. The only HSE-shaped material in the product is on the judge surfaces (governance refusal, "fewer than 5 people" privacy footnote), and nothing connects those to a role. The officer's questions ("which sites and crews stopped, were plans signed, what can I see about workers") have no screen. ADR 0045 deferred it deliberately (H1) and said what to show instead.

## 4. The proof sheet and the provenance layer (owner's added requirement)

The captured sheet prints: "Protocol line: Open-Meteo Previous Runs API, ecmwf_ifs025, *_previous_day1 (issued the day before), fetched 2026-11-11", "Script: src/features/judge/facts.ts:seasonFacts", "Result file: static/omaa_2026_ifs_d1_wbgt_hourly.json", a 64 character SHA-256, three fields "Not recorded", a label "RECORDED", a four step timeline that contradicts itself, and a "Recount in this browser" button.

Root cause (read in `components/provenance/proof.ts` and `ProofRows.tsx`): the leak is data-driven, not wording-driven. The `Proof` type holds `protocol`, `script`, `file`, `fileSha256`, `sourceSha256`, `modelId`, `generatedAt` as raw strings, and `ProofRows` renders every row unconditionally, substituting the string "Not recorded" for a null. `proofFromProvenance` builds `protocol` as `<repo path>#<anchor>` and `script` as `module:function @ commit`; `proofFromStaticFile` takes free text written for engineers. The catalogue is clean (the owner is right about that), which is why a copy edit cannot fix it. The fix is a plain-language projection of the record plus a separate auditor layer, designed in `02b-information-layers.md`. Auditability itself is a strength and must survive: every field stays, behind "For auditors".

Related finding: the plain-language problem is also in the other verbatim surfaces: the verdict sentences (exporter text), the policy codes (`P0` to `P3_balanced`), the "theta" strings, and the Plans table headings ("Share of High-zone heavy work planned as cycled"). See `01b-content-audit.md`.

## 5. What already works and must be kept

| Keep | Why |
|---|---|
| Honest numbers with their intervals, the "REAL weather + assumed crew" and "SIMULATED" labels, and the wording "Held-out 2026, every choice fixed on 2024-2025 data" | It is the project's credibility; the redesign changes where and how it is said, never what is claimed |
| "Why Orange?" on Today and the proof drawer | A worker-facing explanation exists and works. It stays, with plainer content (02b) |
| Stop work always reachable, with Undo and the offline outbox ("Not sent: no signal. Tell the crew now.") | Safety control; it never waits for sign-off |
| "I feel unwell" is a link in the fixed dock, works offline, calls via `tel:` and sends nothing (ADR 0065) | Safety control; do not add a step |
| Six languages including right-to-left Arabic and Urdu, Noto fonts per script, bidi isolation of times and names | Hard-won (overflow and RTL e2e tests exist) |
| Offline behaviour: Today from cache with an age label, protective plan when the forecast is stale | Safety and credibility |
| The level scale: word plus position plus a 10 px mark, never colour alone | Accessibility and the palette rule |
| The time spine and the recessed midday slot, drawn only when the break is in force | The signature of the identity |
| The colour palette (owner approved): the dark navy base, the heat ramp, the sun theme | Constraint from the owner |
| The governance refusal and the access log on the judge surfaces | Never cut (ADR 0034) |
| Four states per screen, skeletons sized to the final layout (CLS), WCAG 2.2 AA axe gates, per-route bundle budgets | Production-team standard |

## 6. Ranking by value to a judge and a worker

1. Fix the proof layer (a judge who opens one number sees a file path today). Highest credibility risk, small code change.
2. Put the product before the evidence on the landing, with a role door. Fixes complaints 1 and 5 at once.
3. Redesign the worker Today for a 3-second read. Fixes complaint 3, the most-used screen.
4. Button and chip system. Fixes complaint 2 across everything at once because it is token-level.
5. Worker join. Fixes complaint 4 for the user who matters most.
6. Supervisor and HSE onboarding screens. Shown mostly as the designed flow; build only the crew QR and a thin demo sign-in.
