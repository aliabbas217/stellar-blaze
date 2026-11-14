# v2 journeys: per-role context, end-to-end journeys, friction budgets, pilot metrics, screen states

**Date:** 2026-11-12 (build 13-18 Nov, feature freeze Wed 18 Nov 18:00, prototype due 20 Nov). **Author role:** senior UX designer.
**Status:** design only. Nothing here has been tested with a worker, supervisor, HSE officer or judge; every number in a "target" column is a target, not a measurement. Every seconds figure is an estimate for a target to be checked in the prototype.
**Builds on (not repeated here):** `../research/friction.md` (cited **FR §n**, requirements **FR-R#**), ADR 0003, 0004, 0010 §8, 0011, 0015, 0034, 0035, 0037, 0038 (`D:\dev\stellar-blaze\docs\decisions\`), v1 UX `../../ux/01-04` (cited **v1-01** to **v1-04**, v1 screen ids W1-W6, S1-S3, H1, D1-D9, A1), `../../HANDOFF.md` (Q1-Q8).

---

## 0. Decisions taken (stated, not reopened) and where the evidence disagrees with the brief

### 0.1 Taken

| # | Decision | Source |
|---|---|---|
| T1 | Visual direction **v2-final "Qaylula"**: dark overall (instrument + ops console); heat colour only on data; the legal midday break (12:30-15:00, 15 Jun-15 Sep) drawn as a **recessed slot** on time axes (see P1 for the out-of-season case). Not yet written up in the repo (no `DESIGN.md` mentions it on 2026-11-12); this doc uses only the three rules above. | Ali, via the brief |
| T2 | **Sun mode.** Worker and supervisor phone surfaces switch automatically to a high-contrast light theme when solar elevation at the site is > 0° (computed on the device from the site coordinates, no sensor) and on `prefers-contrast: more`. One tap toggles; the explicit choice wins until the next local day at the site. Desktop roles (HSE, judge, admin) stay dark. Reason: positive polarity is more legible in bright light (v1 DESIGN.md R2), and AmbientLightSensor is still behind a flag in Chrome for Android (MDN browser-compat-data 8.1.8, 2026-11-02). | Ali, via the brief |
| T3 | Everything that hears or reads free text is PERSONAL and self-hosted only; on the live URL (no GPU) the mic **and** the sentence parser fail closed with: "Voice needs our private server, which isn't running here. Type in the form instead." Roster import is CSV with the name column dropped in the browser. No worker voice input. "I feel unwell" is a button. | ADR 0038, FR §11 amendment |
| T4 | Replay mode is the demo spine; the scoreboard is the wow; the 3D IFS field is only the opening frame and never sits in front of the scoreboard. Never cut: Warnings scoreboard, pre-registration, governance refusal. | ADR 0034, 0037 |
| T5 | Rule planner + independent validator; sign-off never gates alerts or a stop; unsigned day = rule plan labelled "unsigned fallback"; k 10 (health) / 5 (exposure). | ADR 0011 §3, §7 |
| T6 | Clinical label only if the review happened: "Reviewed by an independent clinical consultant, ⟨date⟩", else "Not clinically reviewed". | ADR 0035 |

### 0.2 Premises I disagree with or must qualify (rule 0)

| # | Premise | What the evidence says | What this doc does |
|---|---|---|---|
| P1 | "The midday break drawn as a recessed slot on **every** time axis." | The ban runs 15 Jun-15 Sep (ADR 0011 P-H1, ruleset floor). The live URL is judged 20-30 Nov and today is 12 Nov: on any live date the break is **not in force**. A recessed slot on a November worker axis tells a worker there is a legal stop that does not exist (or that work at 13:00 is unlawful). The v2 setup brief already prints "Midday ban = not in force". | Slot drawn **only for dates inside the ruleset window** (all replay days, the season ribbon, the frontier). Outside the window: no slot on worker axes; on supervisor/HSE/judge axes a hairline outline with the label "Midday break by law: not in force until 15 Jun". The dates come from the ruleset, never a literal. |
| P2 | "≤ 2 taps for any worker action." | Three worker actions cannot meet it because the OS owns the extra steps: **iOS push** (Home Screen install is a manual Share-sheet path, WebKit R3, FR C2/C4), **calling** (`tel:` opens the dialler; the OS needs a press to call), **re-allowing push after a denial** (browser settings). One more exceeds it by design: **Remove my data** (destructive, needs a confirm). | Each is flagged in the worker budget (§3.5) with the reason. Our own UI never adds a third tap. |
| P3 | Pilot metrics such as "% alerts opened within 10 min" and "unwell-button time-to-call". | v1 F-W4 rules "never any analytics" on the unwell path, and the worker's top fear is surveillance (v1-01 P1). Per-device open telemetry keyed to a push subscription is a pseudonymous engagement record (FR C7). | Alert opens counted only as an **anonymous per-push counter** (no subscription id stored, k-suppressed per crew). Unwell timing measured **only by moderated observation**, never by telemetry. See §8. |
| P4 | "HSE/regulator" as one role. | ADR 0017 cut the population view; a regulator view is a **roadmap line only** (HANDOFF Q4: DESIGNED). | The HSE journey is the employer's HSE officer. The regulator appears only on the roadmap step, stamped DESIGNED. |
| P5 | Sentence-to-config as the setup path. | On the live URL there is no PERSONAL route, so the sentence path fails closed (T3); judges will use the **short form** live, and the agent is a recorded 15 s video beat (ADR 0038 §7). | The short form (the preview card with defaults, chips and steppers) is the primary design target; the sentence is an accelerator on top of it. The budget is measured on the short form. |
| P6 | v2 direction rules vs FR §4's stale spec. | FR §4 says a stale level is drawn with "the hatch overlay of the fallback plan"; the v2 brief bans hatch and filled plates ("danger = word + position on a thin 4-step scale + a small colour mark"). | Stale and fallback states are carried by **words + clock pictogram + absolute and relative time + a dashed (not hatched) scale marker**. FR §4's wording and thresholds otherwise stand. |
| P7 | Story-mode URLs. | FR §10 recommends `/replay?step=day`. The brief's six steps include "problem" and "product", which are not replay pages. | One stepper at `/replay?step=<id>` with ids `problem · scoreboard · day · proof · product · roadmap`; each step renders the existing component (landing field, D1, D2, D3, worker card + D7, D9). No duplicate pages. |

---

## 1. What carries over from v1 and what changes

v1 was rejected for its looks, not its structure (v1-04: 27/40 Nielsen). The IA (v1-02 sitemap) holds.

| Area | v1 (keep unless listed) | v2 change | Why |
|---|---|---|---|
| `/` | Role chooser, 3 equal cards | Landing: 3D IFS field (ADR 0037), one sentence, primary **"See the scoreboard"**; role chooser becomes a secondary row; "Skip to the scoreboard" first focusable | FR §10, FR-R1, FR-R2 |
| Worker first run | W1 "Set up once": consent checkbox + site select + work type + start date + clothing (5 inputs) | **Scan lands on Today with the site level** (0 fields). Personalise is an optional 3-chip sheet; start date replaced by two chips; consent checkbox replaced by a one-tap "what stays on this phone" acknowledgement; site comes from the QR | FR §2, C9, FR-R5/R6 |
| Worker theme | Light by default on worker routes (R2) | **Sun mode** (T2), automatic from solar elevation, on worker **and** supervisor phones | T2 |
| Level identity | Rimmed filled sign, hatch | Word + position on a 4-step scale + small colour mark; no plate, no hatch | v2 BRIEF hard rules |
| Supervisor setup | Not designed (v1 assumed seeded demo data) | **Zero-form site setup** (short form; sentence/voice as gated accelerator) + **CSV roster import** with names dropped in the browser | FR §11, ADR 0038 |
| Supervisor crews | S1 table | First fold = one focal sentence + crews worst-first, normal crews grey | FR §9, FR-R18 |
| Worker alert, unwell, my data, alerts | W3-W6 | Kept; pictogram for unwell changes to the E004 + E003 composite; "anonymous" becomes "pseudonymous"; My data gains the persist() result | FR C7, C8, FR-R11 |
| Demo spine | D1-D9 step rail | Kept; story mode stepper (P7); every page renders with the API down | FR-R3, FR-R4 |
| Admin | A1 | Kept; adds the LLM-route floor rejection (ADR 0038 §3) as a visible unhappy path | ADR 0010 §8, 0038 |

---

## 2. Shared conventions for every journey

- **Tap counting.** "Taps" = taps on our UI. OS steps (permission dialog, dialler, file picker, Share sheet) are counted separately as **+OS** and included in the totals that the budget checks. Camera-app QR scan = 1 OS tap (the "open link" banner).
- **Fields typed** = keyboard entries. A chip, stepper or tile is a tap, not a field.
- **Seconds** are targets on a mid-range Android on throttled 4G (FR-R5 test profile), unless stated.
- **Sun mode rules (T2), made testable:** evaluate solar elevation at load and every 5 min from the site lat/lon and device clock; switch only between interactions (never mid-tap); a manual toggle stores `{theme, siteDate}` and expires at the next local midnight at the site; with no site yet (pre-scan, or a judge opening a worker page) the elevation check uses the UAE centroid (24.4 N, 54.4 E), so no geolocation prompt is ever needed for theming (proposal, O3).
- **Time axes:** 06:00-20:00 on worker phones, mirrored in `ar`/`ur` (FR §8); ban slot per P1; times written as "from 13:00 to 17:00" with bidi isolation.
- **State vocabulary** (used in §9): ideal · loading · empty · error, plus stale · partial · offline · refused (fail-closed or 403) where relevant.

---

## 3. Worker

### 3.1 Device context

| Factor | Context | Design consequence |
|---|---|---|
| Device | Low-end Android (2-3 GB RAM), cracked or dusty screen, storage near full; some iPhones; links often opened inside WhatsApp's in-app browser | ≤ 2 s first render from the SW cache; `storage.persist()`; in-app-browser detection screen (FR §3) |
| Place | Open site, Musaffah/KEZAD belt; noise near plant (unmeasured, FR §5.6) | Never audio-only; vibration + text + pictogram |
| Light | Direct sun 20-120 klx at midday; also pre-dawn bus and night | Sun mode (T2); ink-on-surface action text ≥ 7:1 nominal, ≥ 18 px, action lines ≥ 22 px (FR-R13) |
| Hands | Gloves, sweat, one hand holding tools | Targets 48 px, 56 px for Play and Unwell; nothing needs a swipe or long-press |
| Time pressure | Glances of 3-5 s; the alert moment can be urgent | One focal answer per screen |
| Literacy / language | None to fluent; en, ar, ur, hi, bn, ne; second-language reading common | Six endonym chips in the first fold; audio for the closed phrase set; ≤ 4 pictograms per screen, always with words |

**Density:** lowest in the product. One focal answer, ≤ 3 action lines, ≤ 4 pictograms per screen, no tables, no charts beyond the hour strip.

### 3.2 Surfaces

| Id | Screen | Route | v1 origin |
|---|---|---|---|
| W0 | Join (redirect only; never seen as a page) | `/worker/join?s=⟨site⟩&c=⟨crew⟩` | new (FR §2; `/w/join` alias only if QR density needs it) |
| W2 | Today | `/worker` | W2 |
| W1' | Personalise sheet (optional, 3 chips) | sheet over `/worker` | replaces W1 |
| W6 | Alerts (enable warnings, denied, iOS install card) | `/worker/alerts` | W6 |
| W3 | Alert card | `/worker/alert/:id` | W3 |
| W4 | I feel unwell | `/worker/unwell` | W4 |
| W5 | My data (stored fields, persist result, who asked, remove) | `/worker/my-data` | W5 |
| W7 | Open in your browser (in-app browser detected) | interstitial | new (FR §3) |

### 3.3 End-to-end journey

| # | Phase | Screen | Worker does | System does | Taps (+OS) · s |
|---|---|---|---|---|---|
| 1 | First run | Site poster / WhatsApp link | Scans the crew QR with the camera app | Opens `/worker/join?s&c`; stores site + crew on the device; redirects | 0 (+1 OS) · 2 s |
| 2 | First run | W2 Today | Looks | Shows the **site** level for the next 15 h; language = crew language set by the supervisor, else nearest `navigator.languages`, else English; sun mode from solar elevation; Listen, Unwell, six language chips in the first fold; precaches Today, Unwell, the locale font subset and ~25 clips | 0 · ≤ 2 s to level |
| 3 | First run | W2 | (Optional) taps a language chip | Re-renders in place, keeps state, re-precaches that locale's clips | 1 · < 1 s |
| 4 | First run | W1' Personalise | Taps "Make it mine" then work type tile, time-on-job chip, "UAE summer before?" yes/no; each answer saves at once | Stores on device only; "This stays on this phone" + audio; unanswered = protective default ("new", "away unknown", heavy) | 1 + 3 (each answer 1 tap) · 10 s |
| 5 | First run | W2 → W6 | Taps "Turn on warnings" | Android: OS permission prompt from the tap (never on load); on Allow, `storage.persist()`, then offers install once (captured `beforeinstallprompt`) | 1 (+1 OS) · 4 s; install +1 (+1 OS) |
| 6 | Daily use | W2 | Opens the app at the bus or at the break | Renders from cache (< 400 ms), then refreshes; personal level (Tier B) shown if a profile exists, else site level with a line saying so; hour strip with the ban slot only in season (P1) | 0 · ≤ 3 s to answer "what do I do now" |
| 7 | Daily use | W2 | Taps Listen | Plays the level clip and action lines; pause/stop for clips > 3 s | 1 |
| 8 | Alert | Notification | Phone vibrates: "Level Red from 13:00" (site/crew level code only, ADR 0004 Tier A) | Payload = level code + site/crew id; text rendered from the cached catalogue | 0 |
| 9 | Alert | W3 Alert card | Taps the notification | Opens the card on the level word + time window + 3 actions; recomputes the personal level on open (Tier B) and shows it if more severe ("Your level is higher: …"); tries autoplay, else a 56 px Play in the first fold | 1 · ≤ 2 s |
| 10 | Alert | W3 | Taps Done (or nothing) | Returns to Today | 1 |
| 11 | Unwell | Any worker screen → W4 | Taps the fixed "I feel unwell" | Opens straight onto step 1 Call (998 · site first aider), 2 Move to shade, 3 Cool down (ADOSH CoP 11.0 §4.5(c) text only); clinical label per T6; "Your supervisor does not see this." Works offline. | 1 · ≤ 2 s |
| 12 | Unwell | W4 → dialler | Taps "Call 998" | `tel:` opens the dialler pre-filled; worker presses call | 1 (+1 OS) · ≤ 5 s from step 11 |
| 13 | Unwell | W4 | (Optional, if the destination is decided, HANDOFF decision 2) "Tell my first aider" | Queued in IndexedDB, retried while open; visible "Not sent yet" state | 1 |
| 14 | Trust | W5 My data | Taps My data | Lists what is on this phone, what the server holds (pseudonymous alert subscription), "Offline copy protected: yes/no", and who asked for data | 1 |

**Unhappy paths**

| # | Case | Screen | Worker does | System does | Taps (+OS) |
|---|---|---|---|---|---|
| U1 | **Offline** | W2, W4 | Opens the app with no signal | Today from cache with "Updated 09:40 · 3 h ago" + clock pictogram; Unwell and call buttons work (tel: needs no data); Listen plays cached clips | 0 |
| U2 | **Stale forecast** (age > tunable threshold) | W2, W3 | Opens | Level reads "**Last known level**", absolute time + age, dashed scale marker (P6); never rendered as live | 0 |
| U3 | **Expired forecast** (> expiry tunable, or none cached) | W2 | Opens | Hero becomes the fallback: "No fresh forecast. Follow the site rules: rest in shade every hour, drink water" (+ "midday break 12:30 to 15:00" only in season); never less protective than the ban (P-H12) | 0 |
| U4 | **Push permission denied** | W6 | Taps "Turn on warnings" after a denial | "Warnings are blocked on this phone." Pictogram steps to re-allow in browser settings + fallback line: "Your supervisor will tell you, and Today still works when you open it." | 1 (+3-5 OS, outside our control) |
| U5 | **iOS, not installed** | W6 iOS card | Taps "Turn on warnings" in Safari | Card with 3 numbered pictograms + audio: Share → Add to Home Screen → open from the new icon; inside the installed app the first screen carries the permission button | 1 + Share 1 + Add 1 + open 1 + enable 1 (+1 OS) = **5 (+1 OS)** |
| U6 | **In-app browser** (WhatsApp) | W7 | Scans the link from the group | "Open in Chrome / Safari" + Copy link; the site level is still shown below (no dead end) | 1-2 |
| U7 | **Audio blocked** | W3 | Notification tap does not count as activation (unverified, FR §5) | Play button 56 px; vibration already fired; text and pictograms present | +1 |
| U8 | **Consent withdrawn / remove my data** | W5 → confirm dialog | Taps "Remove my data from this phone", confirms | Before confirm, says: "This also removes the list of who asked for your data from this phone." Clears profile, unsubscribes push, deletes the server endpoint, clears caches; Today returns to the site level with a one-line confirmation. Offline: local data cleared at once, "We will stop warnings when you are back online" queued | 3 (My data, Remove, Confirm) |
| U9 | **Employer data request refused** | W5 | Opens My data (a quiet dot on the My data tab, no push, no sound) | New audit row: "An employer account asked for your individual data. Refused. ⟨date time⟩" with the purpose shown; tap expands what "refused" means (no route exists) | 1-2 |
| U10 | Personal level unavailable (no profile, null quantile) | W2, W3 | Opens | Site level + "Your own level needs 3 answers. Make it mine" (1 tap to W1') | 0 |
| U11 | Unwell send fails (if send exists) | W4 | n/a | "Not sent yet. We will try again while the app is open"; call buttons stay primary | 0 |
| U12 | Sun mode wrong for the moment (shade, night shift lighting) | any | Taps the theme toggle | Switches; the choice holds until the next local day at the site | 1 |

### 3.4 Not applicable to the worker
Validator rejects a plan (worker sees only the resulting crew plan or "unsigned fallback"); k-suppressed aggregate; config floor; GPU-less voice (no worker voice input exists).

### 3.5 Friction budget (worker): target ≤ 2 taps per action, 0 fields

| Action | Taps (+OS) | Seconds | Fields | Budget | Why exceeded, and what was removed |
|---|---|---|---|---|---|
| Scan to see today's level | 0 (+1 OS) | ≤ 2 | 0 | Met | v1 needed W1 (5 inputs) first; removed |
| Change language | 1 | < 1 | 0 | Met | |
| Personalise (optional) | 1 + 3 | ~10 | 0 | **Over (4)** | Three independent facts the device cannot infer (FR C9). Mitigated: each answer is its own 1-tap action that saves immediately; skippable; protective defaults. Cannot remove without guessing in the unsafe direction |
| Enable warnings, Android | 1 (+1 OS) | ~4 | 0 | Met | Install offered after, optional (+1 +1 OS) |
| Enable warnings, iOS | 5 (+1 OS) | ~25 | 0 | **Over** | WebKit: push only for Home Screen web apps, permission from a gesture inside the app (FR C4). Platform-imposed; not removable |
| Read an alert | 1 (+1 if audio blocked) | ≤ 2 | 0 | Met | |
| I feel unwell → call | 2 (+1 OS) | ≤ 5 | 0 | **Over by the OS step** | `tel:` cannot auto-dial; the dialler press is the OS's. Our UI = 2 taps |
| See my data | 1 | ≤ 2 | 0 | Met | |
| Remove my data | 3 | ~6 | 0 | **Over (3)** | Destructive and irreversible; a confirm is required (web interface guidelines). Kept deliberately |
| Re-allow push after denial | 1 (+3-5 OS) | 20-40 | 0 | **Over** | Browser settings are outside the page. Fallback (supervisor relay) makes it non-blocking |
| Override sun mode | 1 | < 1 | 0 | Met | |

---

## 4. Supervisor / crew lead

### 4.1 Device context

| Factor | Context | Design consequence |
|---|---|---|
| Device | Mid-range Android phone; sometimes a site tablet for relay; laptop at the site office for setup and CSV | Phone first at 390 px, tablet 768 px; setup works at both |
| Place | On site between tasks; site office for setup | Sun mode on phone and tablet (T2) |
| Light | Sun on site; office lighting for setup | Same rules as the worker on phone; desktop setup stays dark |
| Hands | Often one hand free | Stop work and Relay in the thumb zone; no drag-only controls |
| Time pressure | 5-second looks; a Stop decision must be instant | First fold answers "which crew, what level, when" |
| Literacy / language | Bilingual; reads English or Hindi/Urdu; relays to crews in their languages | Supervisor UI in their language; relay in the crew's languages |

**Density:** medium. Crew list with one row per crew (≤ 12), compact hour strips, plan timeline with clause on demand; in-page index on the plan page (v1-04 #7).

### 4.2 Surfaces

| Id | Screen | Route |
|---|---|---|
| S0 | Site setup (short form = preview card; sentence/mic row on top) | `/supervisor/setup` |
| S0b | Roster CSV import (map columns, names dropped in browser, preview, confirm) | `/supervisor/setup/roster` |
| S0c | Crew QR sheet (print or share link per crew) | `/supervisor/crews/:id/join` |
| S1 | Crews today (focal sentence + crews worst-first) | `/supervisor` |
| S2 | Crew plan (timeline, Why, floor banner, pay impact, sign-off, Stop work) | `/supervisor/crews/:id` |
| S3 | Crew relay (full-screen level, bulletin, audio, print A5 card) | `/supervisor/crews/:id/relay` |

### 4.3 Agentic zero-form site setup (supervisor or HSE)

The short form is the baseline; the sentence is an accelerator (P5). Example: "Two crews, 40 workers, Mussafah, concrete work this week".

| # | Screen | User does | System does | Taps (+OS) · s · fields |
|---|---|---|---|---|
| A1 | S0 | Opens setup from the invite link | Probes `GET /api/v1/site-setup/capabilities`. **Preview card is already open below** with every default filled and a provenance chip per field: *default*, *from your phone*, amber *protective default* (FR §11.4). Above it, one row: "Describe your site in one sentence" + mic, with the notice (crew letters not names; processed on our own server; deleted when you confirm; prefer a form?) | 0 · ≤ 2 s |
| A2 | S0 | Types or dictates the sentence (local GPU build only) | Client pre-screen blocks digit runs ≥ 8, `@`, Emirates ID patterns; `POST /site-setup/drafts` → self-hosted STT + LLM (`SiteSetupExtraction`, temperature 0, schema-constrained) → code builds `SiteConfigDraft`; workload class from the ruleset table (unknown → heavy) | mic 2 (+1 OS) or 1 field · 3-6 s |
| A3 | S0 preview | Reads the card | Fields update with chips **you said** (span highlighted), **default**, **from your phone**, **protective default**: Site Mussafah (gazetteer, 24.36 N 54.50 E, drag to fix) · Crews 2 · Workers 40, split 20/20 (assumed: confirm) · Work concrete pour → heavy (ruleset table, "not clinically reviewed") · Dates this week (resolved by code) · Midday break: not in force (ruleset; P1) · Acclimatisation: everyone new (protective) | 0 |
| A4 | S0 one question | Answers the one question shown ("When does the shift start?" 06:00 · 07:00 · Other) | `missing[]` computed by code; questions are templated chips, never LLM text; only one visible at a time | 1 |
| A5 | S0 | Taps "Looks right. Start." | Writes through the audited config path (actor, reason "initial setup"); draft and transcript deleted; drafts were never readable by planner or alert code | 1 · ≤ 2 s |
| A6 | S0c | Taps "Crew QR codes" | One QR per crew, print or share to the crew WhatsApp group; crew language chips set here (default: supervisor's language) | 1-2 |

**Fail-closed on the live URL (no GPU):** in step A1 the capability probe returns no PERSONAL route. The sentence row shows, inline and before any attempt: "Voice needs our private server, which isn't running here. Type in the form instead." The card below is the form. If the user taps the mic anyway, the client asks the server for a voice session **before** calling `getUserMedia`, gets a problem response, writes an audit row (zero outbound calls), and no audio is captured. Typed sentence: same refusal on submit; the text stays in the browser and is cleared. This is the governance beat, at zero cost to a real user.

**Short-form path (live URL, no CSV):** "Use my location" 1 (+1 OS) → snapped to the gazetteer · crews stepper 1 · task tile (applies to all crews) 1 · shift chip 1 · Start 1. Headcount stays at the per-crew default unless changed (stepper, 5 per tap) or set by CSV.

**Setup unhappy paths**

| # | Case | Behaviour | Extra taps |
|---|---|---|---|
| SU1 | GPU-less refusal (live URL) | As above; card is already there | 0 |
| SU2 | Possible names or IDs in the sentence | Blocked on the device before send: "Please remove names and numbers that identify people. We only need counts." | 0 (edit) |
| SU3 | Contradiction (40 workers, crews 20 + 30) | Conflict row with both values as chips; nothing picked silently | 1 |
| SU4 | Place not in gazetteer / location denied | Map pin pre-centred; no external geocoder gets the typed place | 1-2 |
| SU5 | Supervisor lowers a protective default (heavy → light) | Requires a reason chip + audit row (ADR 0011 §7.4) | +1 |
| SU6 | Offline | Card works as a local editable form with the same defaults; syncs on reconnect | 0 |
| SU7 | Draft abandoned | Expires after 24 h (ADR 0038 §5); nothing reads it | 0 |

### 4.4 Roster CSV import (names dropped in the browser)

| # | Screen | User does | System does | Taps (+OS) |
|---|---|---|---|---|
| R1 | S0 / S2 | Taps "Add roster (CSV)" | Opens the file picker; accepts `.csv` only (photo OCR deferred, ADR 0038 §8) | 1 (+1 OS) |
| R2 | S0b | Picks the file | Parsed **in the browser**; headers matched by synonym lists in six languages; the name column is detected and shown struck through: "Names stay on this phone and are removed before upload." Only crew letter, trade and acclimatisation date are kept (ADR 0038 §5) | (+1 OS) |
| R3 | S0b | (If no name column detected) taps the column that holds names | Column removed in the browser | +1 |
| R4 | S0b preview | Reads "2 crews · 40 rows · 3 shift patterns" | Rows grouped by identical start/end pairs; headcounts per crew; preview shows no names | 0 |
| R5 | S0b | Taps "Use this roster" | Uploads the name-free structure only; audit row "roster import" | 1 |

Unhappy: wrong encoding or delimiter → first rows shown raw, tap the start and end columns (+2); unmapped columns → one ask-back per column (chips); network capture test proves no name column leaves the browser (FR-R21).

### 4.5 End-to-end journey (after setup)

| # | Phase | Screen | Supervisor does | System does | Taps · s |
|---|---|---|---|---|---|
| 1 | First run | S0 → S0c | Setup + roster + crew QR (4.3, 4.4) | | see budget |
| 2 | Daily | S1 | Opens the app at 05:30 | Focal sentence: "Crew B: Red from 13:00 (in 42 min)." Crews worst-first; normal crews grey; plan status (Signed / Unsigned / Changed) | 0 · ≤ 3 s |
| 3 | Daily | S2 | Taps a crew | Plan timeline (Work, ADOSH rest, Art. 18 break, Ban (in season), Stopped) with clause per block; floor banner; pay impact (display only) | 1 |
| 4 | Daily | S2 | Signs off | One tap if unchanged and no Medium/High work; else acknowledge each changed or Medium/High item; deviation needs a reason chip (ADR 0011 §7.1) | 1, or 1 + n |
| 5 | Daily | S3 | Taps Relay | Full-screen level, crew-language chips, Play, Copy bulletin (no names, no health data), Print A5 | 1 · Play +1 |
| 6 | Alert | Notification → S1 | Push "Crew B: Red from 13:00" | Opens S1 scrolled to Crew B | 1 |
| 7 | Alert | S2 | Taps **Stop work** | Immediate; no dialog; 10 s undo toast; audit row; crews pushed; "Crew notified" confirmation | 1 · < 1 s |

**Unhappy paths**

| # | Case | Behaviour |
|---|---|---|
| SU8 | **Offline** | S1/S2 from cache with age label. **Stop work offline:** recorded locally and shown as "Not sent: no signal. Tell the crew now." with Relay one tap away; sends on reconnect. Never shown as delivered when it was not |
| SU9 | **Stale forecast** | Banner with time and age; plans fall back to the rule plan (P-H12) labelled so |
| SU10 | **Push denied / iOS not installed** | Same W6-style help; S1 shows "Warnings are off on this phone. Open the app at shift start." |
| SU11 | **Validator rejects a plan** | A plan that fails the independent validator is **never shown as valid**: S2 shows ErrorState "This plan failed the rule check and is not shown" + request id + "Crews see the site-rules fallback (never less protective than the ban)"; planner bug surfaces as a 500 + audit row (ADR 0011 §3). Sign-off is unavailable for a plan that did not pass |
| SU12 | **Unsigned at shift start** | "Not signed. Crews see the rule plan." Alerts and Stop work unaffected |
| SU13 | **k-suppressed crew** (< 5) | Share-above-amber row reads "Fewer than 5 people, detail hidden to protect privacy" |
| SU14 | **GPU-less voice** | As SU1 |
| SU15 | Relay audio missing for a language | "Audio not available in Nepali yet. Read the card aloud." |

### 4.6 Friction budget (supervisor): target zero forms; ≤ 6 taps for setup (FR-R19)

| Action | Taps (+OS) | Seconds | Fields | Budget | Note |
|---|---|---|---|---|---|
| Setup, sentence path (local GPU) | 1 question + 1 confirm = 2 (mic: +2, +1 OS) | ~20 | 1 sentence (or 0 with mic) | Met | |
| Setup, short form (live URL), demo site | location 1 (+1 OS) + crews 1 + task 1 + shift 1 + Start 1 = 5 (+1 OS) | ~25 | 0 | Met | |
| Setup, short form, headcounts set by stepper (no CSV) | +2 per crew per 10 workers (40 workers in 2 crews from a default of 10 each = +4) | +8 | 0 | **Over (9 + OS)** | Headcount cannot be inferred without a roster. Fix offered: CSV import sets it at 0 taps; or accept the default (headcount only drives display and lone-work checks) |
| Roster CSV import | 3 (+2 OS), +1 if names not auto-detected | ~30 | 0 | Met (≤ 6) | |
| Crew status | 0 | ≤ 3 | 0 | Met | |
| Stop work | 1 | < 1 | 0 | Met | |
| Sign-off, unchanged plan | 1 | ~3 | 0 | Met | |
| Sign-off, changed or Medium/High plan | 1 + n acks (+ reason chip) | 10-30 | 0 | **Over by design** | ADR 0011 §7.1: per-item acknowledgement is the safety control |
| Relay a crew | 1 + Play 1 | ~5 | 0 | Met | |

---

## 5. HSE officer (employer); regulator = roadmap only (P4)

### 5.1 Device context
Desktop or laptop at 1440 px (works at 768/390), office light, mouse and keyboard, weekly review and inspection prep (low time pressure), English or Arabic, high literacy. **Dark theme.** **Density:** high (tiles + site-week table), with every suppressed cell explained in words.

### 5.2 Surfaces
H0 Site setup (same S0 flow, launched from HSE for a new site) · H1 HSE week (`/hse`, filters in the URL) · H2 Evidence pack export (aggregates only) · H3 Data request result (the 403 problem panel when an individual-level request is attempted).

### 5.3 Journey

| # | Phase | Screen | HSE does | System does | Clicks · s |
|---|---|---|---|---|---|
| 1 | First run | H0 | Sets up a site (4.3) and invites the supervisor | Same card; actor recorded as HSE | ≤ 6 |
| 2 | Weekly | H1 | Opens the bookmarked URL | Tiles: High-zone working hours outside the ban (in season), plans signed before shift, stops, deviations by reason; table by site-week; "What you cannot see here" note | 0 · ≤ 3 s |
| 3 | Weekly | H1 | Changes site / week | URL updates; back button works | 1-2 |
| 4 | Weekly | H2 | Exports the evidence pack | Aggregate-only file, suppression applied, provenance + config version in the header | 1 |
| 5 | Refused | H3 | Tries "individual risk for worker ⟨id⟩" (only in the governance demo; no such button exists in the product) | `403 problem+json` "Employers have no route to individual data" + request id; audit row (actor, time, purpose, outcome refused) that the worker sees in W5 (U9) | 1 |

**Unhappy paths:** **k-suppressed aggregate** → cells read "fewer than 10" (health: stops) or "fewer than 5" (exposure), with complementary suppression so totals cannot be subtracted; a tile whose value is suppressed reads "Hidden: fewer than k" (never 0; 0 is shown as 0, v1-02 edge table) · **no data for the week** → empty state + "Open the demo site" + "How data gets here" · **stale data** → freshness line "Latest plan data: ⟨time⟩" · **API down** → ErrorState + request id; export disabled with the reason in text · **GPU-less voice** in H0 → as SU1.

### 5.4 Friction budget (HSE)

| Action | Clicks | Seconds | Fields | Budget |
|---|---|---|---|---|
| Read the week | 0 | ≤ 3 | 0 | Met |
| Filter | 1-2 | ~3 | 0 | Met |
| Export | 1 | ~3 | 0 | Met |
| Site setup | as 4.6 | | 0 | Met (short form) |

---

## 6. Judge

### 6.1 Device context
Laptop ≥ 1280 px most likely (v1-01 A6), sometimes a phone from a link in the submission; office light; seconds per screen; sceptical of mock-ups; no setup tolerance; may watch the 3-minute video first; may open the link during 20-30 Nov when live weather is mild (ADR 0034). English default, no locale redirect. **Dark theme.** **Density:** medium-high on the scoreboard (four policies × few measures), low on the landing.

### 6.2 Surfaces
L0 Landing `/` (3D IFS field, 2D fallback, one sentence, "See the scoreboard", role row, video link) · D1 Scoreboard `/replay` (opens on the final frame) · D2 Pre-registered day · D3 Proof drawer · D4 Try a plan · D5 Frontier · D6 Climate (SHOULD, cut first) · D7 Governance refusal · D8 Break things · D9 What's next · Story stepper `/replay?step=problem|scoreboard|day|proof|product|roadmap`.

### 6.3 Journey

| # | Screen | Judge does | System does | Clicks · s |
|---|---|---|---|---|
| 1 | L0 | Opens the link | No login, cookie wall, permission prompt or locale redirect. IFS 0.25° WBGT field with provenance in DOM text; LCP ≤ 3.0 s (ADR 0037); "Skip to the scoreboard" is the first focusable | 0 · ≤ 3 s |
| 2 | D1 | Clicks "See the scoreboard" | Final frame: verdict sentence + Warnings row (ban only · WBGT ≥ 32 · ADOSH on raw IFS · Stellar Blaze) + Plans row, 95 % intervals, proof chips; Play is optional and pausable | **1** · ≤ 10 s from link |
| 3 | D3 | Clicks a proof chip | Protocol clause + commit date ("committed before results"), script, result file + SHA-256, label | 1 |
| 4 | Story | Clicks "Walk me through it" (or opens `?step=problem`) | Stepper: **problem** (field + one-line problem) → **scoreboard** (D1) → **day** (D2, rule that chose the day, raw vs ours vs station truth) → **proof** (D3 open, pre-registration) → **product** (worker card as the crew saw it, in sun mode because the hour is daytime; supervisor plan; governance 403 + worker audit row) → **roadmap** (D9 with EXISTS / DESIGNED / NEEDS PILOT). Prev/Next by keyboard; Play 50 s pausable; reduced motion lands on final frames; "Copy link to this step" | 5 Nexts · ≤ 50 s on Play |
| 5 | D4 | Tries a plan (if not cut) | Template → edit times → Validate → clause-cited violations, "independent validator: shares no code with the planners" | ≤ 3 |
| 6 | D7 | Sends the employer request | Live 403 + the worker's new audit row side by side | 1 |
| 7 | S0 (optional) | Opens setup from the role row and taps the mic | Fail-closed refusal + form (SU1): a second governance beat | 1-2 |

**Unhappy paths**

| Case | Behaviour |
|---|---|
| **API down** | L0 field, D1, D2, D3, D5, D9 are static JSON, SSG'd and precached: they render with the API stopped and offline after one visit (FR-R4). D4 → "Show a recorded result", stamped RECORDED. D7 → recorded run, stamped RECORDED, with the CI test names. Video fallback link on L0 |
| No WebGL / slow GPU | 2D canvas fallback of the same field (ADR 0037 §4); `?static` forces it |
| Scoreboard JSON missing | Static chart of whatever JSON exists, stamped; never a fabricated number; else empty state linking the protocol |
| Ours lost | Ships as is; same layout; verdict from the pre-registered outcome table |
| Climate cut | Story skips it; D9 roadmap line instead |

**Judge on a phone (390 px):** landing uses the phone budget (≤ 1,500 vertices, DPR 1.5) or the 2D fallback; "See the scoreboard" full-width in the first fold. D1 stacks the four policies as rows with ours highlighted by position and a single accent, the verdict sentence first, intervals as text. Stepper controls fixed at the bottom (48 px). The worker card in the product step renders full-width (no phone-in-a-phone frame). Charts have table alternatives one tap away.

### 6.4 Friction budget (judge): ≤ 2 clicks to the wow, zero setup

| Action | Clicks | Seconds | Fields | Budget |
|---|---|---|---|---|
| Landing → scoreboard final frame | 1 | ≤ 10 | 0 | Met (target ≤ 2, FR-R1 ≤ 1) |
| Trace a number | 1 | ~3 | 0 | Met |
| Whole story | 1 + 5 | ≤ 50 on Play | 0 | Met |
| Try a plan | ≤ 3 | ~15 | 0-2 time edits (optional) | Met (edits optional; templates need none) |
| See the governance refusal | 1 | ~3 | 0 | Met |

---

## 7. Admin / config (Ali in the demo; later an employer HSE lead with an admin token)

### 7.1 Device context
Desktop, office, keyboard; deliberate, low time pressure; English; high literacy; **dark**. **Density:** high (tunables table, floors table, history).

### 7.2 Surfaces
A1 Runtime config (`/admin/config`: active version line, tunables (class b) editable within range, floors (class c) read-only with source clause, LLM route assignment) · A2 Edit drawer (value, reason, Validate → diff → Activate) · A3 History with Roll back.

### 7.3 Journey

| # | Screen | Admin does | System does | Clicks · fields |
|---|---|---|---|---|
| 1 | A1 | Opens with the admin token | "Active: config v⟨n⟩, activated ⟨time⟩ by ⟨actor⟩" | 0 |
| 2 | A2 | Edits a tunable (e.g. TWL margin after the back-test) | Range shown next to the input | 1 · 1 field |
| 3 | A2 | Writes the reason (10-500 chars), Validate | Server-side Pydantic + bounds + floors + model/calibration checks; diff | 1 · 1 field |
| 4 | A2 | Activates | One transaction: activation row + audit; replicas pick it up within the poll interval; new `config_version` on later decisions | 1 |
| 5 | A3 | Rolls back | One action with a reason | 1 · 1 field |

**Unhappy paths:** **out of range** → inline `policy-bound-violation` "Outside the reviewed range [a, b]" · **floor change attempted** → floors are not editable; a crafted payload gets `floor-violation` "Legal floor: changes only by a reviewed ruleset release" · **PERSONAL LLM route pointed at a managed route** → `floor-violation` (ADR 0010 §8, ADR 0038 §3), shown with the route's hosting value · **someone activated first** → `409 stale-activation` "Config changed since you opened it" + reload diff · **401** → "Admin token needed" · a replica refuses the version → `checks.config = stale` shown on A1.

### 7.4 Friction budget (admin)

| Action | Clicks | Fields | Budget | Why exceeded |
|---|---|---|---|---|
| Change a tunable | 4 | **2** (value, reason) | **Over "zero forms"** | The reason is the audit record (ADR 0010 §3, `reason NOT NULL`). Proposed mitigation: reason chips ("back-test result", "pilot feedback", "rollback after incident") pre-filling the text, still editable. Value entry cannot be inferred |
| Roll back | 2 | 1 | Over (1 field) | Same |

---

## 8. Budget violations that remain (all roles)

| # | Where | Exceeds by | Cause | Removable? |
|---|---|---|---|---|
| V1 | Worker iOS enable warnings | 5 taps + OS | WebKit Home Screen rule | No (platform) |
| V2 | Worker unwell → call | 1 OS tap | `tel:` dialler press | No (OS safety) |
| V3 | Worker re-allow push | 3-5 OS taps | Browser settings | No; supervisor relay is the fallback |
| V4 | Worker remove my data | 1 tap | Destructive confirm | Deliberately kept |
| V5 | Worker personalise | 2 taps (as a set) | Three facts a device cannot infer | Each answer is 1 tap and optional; kept |
| V6 | Supervisor headcount without CSV | ~4 taps | No roster, no inference | Partly: CSV import or accept default |
| V7 | Supervisor sign-off of changed / Medium-High plan | n acks | ADR 0011 §7.1 safety control | Deliberately kept |
| V8 | Admin tunable edit | 2 typed fields | Audit reason required | Partly: reason chips proposed |
| V9 | Sentence path (local GPU only) | 1 typed field | It is the feature | Mic path removes it; short form needs none |

---

## 9. Success metrics for a pilot (and what the demo can measure)

"Demo" = measurable before 20 Nov with Playwright, Lighthouse or our own timing; "pilot" = needs real users on real sites. Worker metrics respect P3: no per-device telemetry on alerts or the unwell path.

| Role | Metric | How measured | Target | Demo / pilot |
|---|---|---|---|---|
| Worker | Time from QR scan to level on screen | Playwright, throttled 4G, Moto-class profile; pilot: moderated stopwatch | ≤ 2 s (FR-R5) | Demo + pilot |
| Worker | Taps from scan to push enabled (Android) | e2e tap counter | ≤ 5 (FR-R6) | Demo |
| Worker | "What should you do now?" correct from Today | Moderated outdoor test at noon, interpreter, 5 per language (usability check, not ISO) | ≥ 90 % correct, ≤ 5 s (v1-01) | Pilot |
| Worker | Pictogram comprehension (level, rest, drink, never alone, unwell incl. "no phones" confusion) | ISO 9186-1 structure, ≥ 50 respondents per language population, categoriser outside the team | ≥ 85 % correct, ≤ 5 % critical confusion (ANSI, FR C5) | Pilot |
| Worker | % of alerts opened within 10 min | Anonymous per-push counter incremented on card open (no subscription id stored), reported per crew only if ≥ 5 subscribers | ≥ 60 % (assumption to calibrate) | Pilot |
| Worker | Unwell button to dialler | Moderated scenario with a stopwatch; never telemetry | ≤ 5 s median, 100 % reach the call step | Demo (scripted) + pilot |
| Worker | Offline Today + Unwell render | Airplane mode after one visit, production build | 100 % (FR-R9) | Demo |
| Worker | Persist granted rate | Shown on the device; pilot: asked in the debrief | Report only | Pilot |
| Worker | Remove-my-data completes offline and online | e2e | 100 % | Demo |
| Supervisor | Time to crew status | 5-second test with 5 foremen: "which crew stops first, and when?" | ≥ 4 of 5 correct within 3 s (FR §9) | Pilot (proxy in demo with 5 people outside the team) |
| Supervisor | Site setup completion | e2e on the short form; pilot: moderated | ≤ 6 taps, 0 fields, ≤ 60 s (FR-R19) | Demo + pilot |
| Supervisor | Plan sign-off before shift start | `plan.signed` timestamp vs shift start, per crew | ≥ 90 % of crew-days | Pilot |
| Supervisor | Stop work to crews notified | Server timestamps stop → push sent | p95 ≤ 10 s | Demo + pilot |
| Supervisor | Shown plans passing the validator | CI + runtime count | 100 % (ADR 0011 §9 metric 6) | Demo |
| Supervisor | CSV import leaks no names | Network capture test | 0 name bytes uploaded (FR-R21) | Demo |
| HSE | Weekly review usability | SUS after a scripted review | ≥ 68 | Pilot |
| HSE | Suppression correctness | Unit tests incl. complementary suppression | 0 cells below k shown | Demo |
| Judge | Time to scoreboard | Playwright: clicks from `/`; Lighthouse LCP | 1 click, ≤ 10 s, LCP ≤ 3.0 s | Demo |
| Judge | Scoreboard read in 5 s | 5-second test, 5 people outside the team | ≥ 4 of 5 name the policy that left most danger hours unwarned | Demo-period proxy |
| Judge | Works with the API down | `next build && next start` with the API stopped | D1, D2, D3, D5, D9 render | Demo |
| Judge | Median time on hero before first click to scoreboard | Observed proxy test | ≤ 20 s (ADR 0037 revisit trigger) | Demo-period proxy |
| Admin | Config change to live | Activation → replica applied | ≤ poll interval (5 s) | Demo |
| Admin | Floor attempts refused | Test suite (T3 config floor, ADR 0038 §6) | 100 % | Demo |

---

## 10. Screens the prototype must show (with states)

Abbreviations: **I** ideal · **L** loading · **E** empty (actionable) · **Er** error (plain words, Retry, request id) · **St** stale · **P** partial · **O** offline · **R** refused (fail-closed or 403). Sun mode = show both the light (sun up) and dark variant for worker and supervisor phone screens.

### Worker (390 px, sun mode light + dark, en + ur RTL)

| Screen | States |
|---|---|
| W2 Today | I (site level) · I (personal level) · L (skeleton at final size) · E (no site: "Scan your crew's code" + "See the demo yard") · Er · St ("Last known level") · O · P (personal unavailable → site level + reason) · fallback (forecast expired) · out of season (no ban slot) vs in season (slot) |
| W1' Personalise sheet | I · P (some answered, protective defaults labelled) · Er (save failed: kept on screen, retry) |
| W6 Alerts | I (off) · I (on) · L (button busy, label kept) · denied · iOS not installed · unsupported · Er |
| W3 Alert card | I · I (personal more severe) · L · E (alert ended → Today) · P (personal not computable → site level + reason) · audio blocked (Play shown) · O |
| W4 I feel unwell | I · E (no first-aider number → 998 only + "Ask the nearest person…") · O · queued / not sent · clinical label: reviewed vs not reviewed |
| W5 My data | I (with the **refused employer request** row) · L (audit rows) · E ("Nobody has asked for your data") · Er (audit section only; local section still shown) · remove confirm dialog · removed confirmation · O (unsubscribe queued) |
| W7 Open in your browser | I |

### Supervisor (390 phone in sun mode light + dark; 768 tablet; setup also at 1440 dark)

| Screen | States |
|---|---|
| S0 Site setup | I (card with provenance chips) · sentence-filled (local GPU) · **R (fail-closed: GPU-less refusal + form)** · one question · conflict row · PII blocked · L (draft in progress) · Er · O (local form) |
| S0b Roster CSV | I (preview, names struck through) · L (parsing) · E (no rows) · Er (encoding/delimiter → raw rows + column tap) · P (unmapped columns ask-back) |
| S0c Crew QR | I · E (no crews yet → back to setup) |
| S1 Crews today | I (focal sentence, worst-first) · L · E (no crews → setup / CSV) · Er · St · O · P (k-suppressed crew) · push off banner |
| S2 Crew plan | I · L · E (no tasks → common roster / CSV) · Er · **validator-failed (plan not shown, fallback stated)** · unsigned fallback · St (rule plan) · signed · Stop work with undo toast · Stop work offline ("Not sent") |
| S3 Crew relay | I · L · E (no crew languages → chips) · P (audio missing for a language) · print A5 preview |

### HSE (1440 dark; check 768 and 390)

| Screen | States |
|---|---|
| H0 Site setup | as S0 (dark, desktop) |
| H1 HSE week | I · L · E (no data this week) · Er · P (**k-suppressed cells and tiles**) · St (freshness line) · out of season (ban-related tile reads "Midday break not in force") |
| H2 Export | I · L · Er (API down, export disabled with reason) |
| H3 Data request refused | **R (403 problem panel + audit row)** |

### Judge (1440 dark; 390)

| Screen | States |
|---|---|
| L0 Landing | I (WebGL) · fallback (2D) · reduced motion (frozen peak hour) · L (poster frame) |
| D1 Scoreboard | I (final frame) · playing · L · E (no exporter JSON → protocol) · Er (→ static chart) · P (Plans row cut) · API down (static, identical) |
| Story stepper | each of 6 steps · reduced motion · keyboard focus · phone layout |
| D2 Day · D3 Proof · D5 Frontier · D9 Next | I · L · E · Er (D3 E = "No provenance recorded for this number. It is not shown as a result.") |
| D4 Try a plan | I (violations) · E (0 violations + what was checked) · L · Er → recorded result (RECORDED stamp) |
| D7 Governance | I (completed run shown on arrival, amended 2026-11-12 after the final critique: the hero must exist at first paint; "Send again" re-runs it) · E (before sending, via ?state=empty) · L · API down → recorded run |
| D8 Break things | each fault state |
| D6 Climate (SHOULD) | I · E ("Shown as a slide") |

### Admin (1440 dark)

| Screen | States |
|---|---|
| A1 Runtime config | I · L · E (no versions → seed CTA) · Er · 401 · replica stale |
| A2 Edit drawer | I (diff) · policy-bound-violation · floor-violation (incl. PERSONAL route → managed) · 409 stale-activation · L (validating) |
| A3 History | I · E · rollback confirm |

---

## 11. Open questions this doc raises (owners needed)

| # | Question | Suggested owner |
|---|---|---|
| O1 | Accept P1 (ban slot only in season; ghost outline + label on non-worker axes outside it)? | Ali |
| O2 | Accept P3 (anonymous per-push open counter, k-suppressed; unwell timing by observation only)? | Ali + governance |
| O3 | Sun mode without a site (judge phone, pre-scan): UAE centroid for the elevation check? Supervisor tablet in a shaded site office may prefer dark; is the one-tap override enough? | Ali; pilot observation |
| O4 | Worker "dot on My data" for a refused request: helpful transparency or alarming? Test with workers | pilot |
| O5 | Unwell destination (HANDOFF decision 2) and Q1 (ADOSH "notify supervisor" vs G9) still open; W4 ships tel:-only until decided | Ali + clinical consultant |
| O6 | Default per-crew headcount when no roster and no sentence (drives V6) | Ali |
| O7 | Admin reason chips (V8): acceptable under ADR 0010 §3's `reason` rule? | architect |

## 12. Addendum 2026-11-12: inner-screen rules from the gap diagnosis

Source: `../critique/inner-screens-gap.md` (measured: inner screens had 0-10 % graphic in the first fold against 26-100 %
on the landings, up to 8 competing buttons, and time only as text). Every screen in §10 now also meets:

1. **One hero object** from real data, ≥ 35 % of the first fold (worker: the shift spine; supervisor: crew strips;
   HSE: the week calendar; setup: the sentence wired to its fields; judge screens: the season ribbon or day chart).
2. **One primary action** per screen (worker Today: Listen; alert: Got it; unwell: Call; My data: Remove my data;
   crews: Relay; plan: Sign off; relay: Play to crew; HSE: Export; admin: Activate; setup: Create site; judge: Next).
   "I feel unwell" is the permanent emergency control in the dock and is not counted.
3. **A time spine** (now → next break → end of shift, the day, or the week). The qaylula slot (12:30-15:00) is drawn
   only when the ban is in force on that date (15 Jun-15 Sep, premise P1 above); out of season the axis shows no
   slot on worker screens and a dashed, labelled outline on desktop screens.
4. **A linking transition**: cross-document View Transitions with shared names (`spine`, `level`, `wordmark`);
   none under reduced motion.

Friction budgets in §3-§7 are unchanged by these rules: they add no taps.
