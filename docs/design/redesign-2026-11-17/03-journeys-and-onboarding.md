# 03. Front door, onboarding and access

Date: 2026-11-17. This is the missing product the owner described: a front door that asks "who are you", an onboarding journey for each role that answers "how do workers join a crew, how are they linked, how do they pick a workplace", and an honest access model. It reuses the deferred designs (ADR 0045: worker-join, supervisor-setup, supervisor-roster, supervisor-qr, HSE site setup H0; `docs/design/v2/ux/v2-journeys.md` sections 3 to 5) and says for each piece what is real and what is demo-only. The prototypes are `prototypes/front-door.html`, `worker-join.html` and `supervisor-onboarding.html`.

## 1. The access model in two sentences

Workers keep having no account, which is the governance headline (ADR 0054), and join by a crew code or by picking their site and crew, with everything stored on the phone. Crew leads and safety officers get a role-based demo entry now (one tap, no credentials, using the shared demo token behind the server-side allow-list of ADR 0062) and a stated production plan: invitation links from an employer administrator and single sign-on with Microsoft Entra, with the API roles extended beyond today's single `employer` role.

## 2. The front door

Where: the hero of the landing page (`/`), as four tiles directly under the lede, and the same component at `/start` (the target of "Change role" in every header). It is not a modal and not a separate splash page: a visitor must be able to act within 8 seconds of arriving.

| Tile (button text) | One-line promise under it | Goes to | Remembered as |
|---|---|---|---|
| I work on a site | "See today's heat and when to rest. No account." | `/worker/join` (Step 1 picks site and crew) | No role stored. The device pin is the only memory |
| I run a crew | "See tonight's plan for your crews. Stop work in one tap." | `/supervisor/enter` (the role entry, section 4.1) | Demo role "crew lead" on this device |
| I look after safety | "See which crews planned, signed and stopped. See what you cannot see about workers." | `/hse/enter`, then `/hse` | Demo role "safety officer" |
| I am reviewing this | "A 3-minute tour, then try anything." | `/tour` | None |

Rules: the four tiles have equal weight and a fixed order (worker, crew, safety, reviewing) so the layout is stable; a visitor who arrived by a crew link never sees the front door (they go straight to join). A small "Already joined? Open Today" line sits under the tiles when a pin exists. Tiles are 72 px tall with a pictogram from the existing set (the worker tile uses the shade glyph, the crew tile the buddy glyph, the safety tile the cross, the reviewing tile the clock), real focus rings and 44 px targets.

Demo scaffolding (Replay/Live, Reset demo site) moves out of the working screens into a "Demo controls" sheet reachable from the header of any screen and listed on `/tour`. Replay is the default.

## 3. Worker onboarding

### 3.1 The three entries

| Entry | How | What happens | Real or demo |
|---|---|---|---|
| A. Crew code (the main path) | The crew lead prints or shares a QR; the worker scans with the camera or opens the link in the crew's group. URL: `/<locale>/worker/join?s=<siteId>&c=<crewId>`; the locale prefix is the crew's language | Step 1 shows a confirm card with the site and crew names read from the API (`GET /api/v1/sites`, `GET /api/v1/sites/{id}/crews`, both public); one tap "Yes, this is my crew". The phone is pinned (`chooseDeviceSite`) | Real on the demo site: the QR codes on the supervisor's crew page encode real join links |
| B. Find my site | The worker has no code (torn poster, new phone). Tile "I work on a site" or the first-run screen | Step 1 lists workplaces (from `list_sites`; search box when there are more than 6), then crews (name and task, from `list_site_crews`). If the crew is missing: "Ask your supervisor to show you the crew code" | Real on the demo site. Today the API lists only the demo site(s) |
| C. In-app browser | The link is opened inside WhatsApp or another in-app browser, where push cannot work | A banner on Step 3: "To get warnings on this phone, open this page in your browser" with Copy link. Today and the unwell sheet still work | Designed in W7; the detection is a user-agent check (unverified list of in-app browsers) |

First run with no code and no tile (typing the URL): `/worker` shows the join flow, not "Scan your crew's code" with a single "See the demo yard" button. "See the demo yard" stays as one quiet row at the top of Step 1, labelled "Just looking? Try the demo yard".

### 3.2 The three steps (390 px)

| Step | Screen | What the worker does | What is stored where |
|---|---|---|---|
| 1. Your crew | Confirm card: site name, crew name and task, a "Wrong crew?" link back to the list | One tap | Pin (site id, crew id) on the phone. Not sent anywhere |
| 2. Your language | Six large rows in their own script, the current one selected. Preselected from the link's locale, else the crew's language, else the browser's, else English | Zero taps if right, one tap to change | The language is the URL's locale prefix and a cookie on the phone. Not sent anywhere beyond the normal page request |
| 3. Warnings | A short privacy card, then two buttons: "Turn on warnings" and "Not now". On iOS outside the home screen: the existing install steps card | One tap (plus the browser's own permission prompt) | If they turn on warnings: a push address (the push service's endpoint and keys), the site id and the crew id are sent to the server so a warning can reach this phone. No name, no phone number, no ID, no location |

The privacy card (this is the visible answer to "what do you hold about me"), copy for English:

> **On this phone:** your site and crew, your language, your site's emergency numbers.
> **On our server, only if you turn on warnings:** a code that lets us send a warning to this phone, and which crew it is for. Nothing about you.
> **Never:** your name, your phone number, your ID, your location, your health. "I feel unwell" calls and sends nothing.
> You can remove everything from this phone at any time: Alerts, "Remove my data from this phone".

Basis: `site-pin.ts` (what the pin holds), `PushSubscriptionCreate` in the OpenAPI file (site id, crew id, endpoint, keys), ADR 0065 (the unwell sheet sends nothing), `AlertsSettings.tsx` (revoke). The push endpoint is a pseudonymous identifier; the card says "a code", not "nothing".

Taps from scan to warnings on, Android: 0 on the screen for step 1 if the QR carries both ids and the worker accepts, plus one confirm tap, zero for language, one tap for "Turn on warnings", plus the OS prompt: 2 taps and 1 OS step, inside the budget of 5 taps (FR-R6, `v2-journeys.md` 3.5). Fields typed: 0.

### 3.3 Changing and leaving

A header settings sheet (04) holds: Language, Screen colors, Change crew (re-opens Step 1), Remove my data from this phone (the existing revoke). "Change crew" is one new row; the revoke already exists on Alerts.

### 3.4 "What is stored where" page

One static page (`/privacy`, English by design plus the privacy card above in six languages) for the regulator reviewer and the worker who asks: the table above, the sentence that the employer role cannot obtain individual health data (the refusal), and the sentence "This demo holds no real worker data". Counsel has not reviewed the data-protection position (limitations file); the page says so.

### 3.5 Not in this phase

The optional heat profile (work type, time on the job, whether you have worked in a UAE summer): the store and schema exist, no screen does, and personal levels therefore never appear. Building it needs a form with validation; the schema pulls zod (about 15 KB gzip) onto a route that has about 6 KB of headroom (05). Park it with an ADR and do not mention "your own level" in new copy. Today's strings that mention it stay inert.

## 4. Crew lead (supervisor) onboarding

### 4.1 Role entry (demo-only)

`/supervisor/enter`: a plain card. Heading "Crew lead, demo". Lines: "You are entering as the demo crew lead for Mussafah M-14 yard. In a real deployment this screen is a sign-in: an invitation link from your employer, then your company account." One primary button: "Continue as the demo crew lead". A quiet link: "Change role". After the tap, the role is kept for this browser session (`sessionStorage`), the header shows a small role badge ("Crew lead, demo") and "Sign out" (clears it and returns to the front door). The role gate is for navigation and labelling only; it is not a security boundary and says so in one line under the button ("Demo access. Anyone can enter; the demo site is made up."). No email, no password, no field of any kind: a form that accepts anything would pretend to be authentication.

### 4.2 Setting a site up (the designed flow, mostly shown rather than built)

| Step | Journey id | What it is | Build status |
|---|---|---|---|
| New site | S0 | Name, place, number of crews, shift start, with every default filled and a "protective default" label | Designed only. No create-site endpoint exists in `openapi/stellar-blaze.openapi.json`. Show in the prototype and the deck as DESIGNED; do not build a form that saves nothing |
| Roster from a spreadsheet | S0b | Choose a CSV; it is parsed in the browser; the name column is detected and struck through; only crew letter, trade and acclimatization date would be kept; a preview reads "2 crews, 40 rows, 3 shift patterns" | A client-only preview is buildable (one route, no dependency, about 120 lines). Nothing is uploaded because no endpoint exists, so the screen says "Preview only in this demo. In a real deployment only the name-free structure is sent." The claim "names never leave your browser" is true here only because nothing leaves at all; say that, do not market it as a tested property until a network-capture test exists (FR-R21) |
| One QR per crew | S0c | A page per crew with a QR, the crew's language chips, a "Print A5" button and "Copy link" | Real and buildable now for the four demo crews: the QR encodes the real join link of S1 above. This is the one piece that connects supervisor to worker for real and is therefore the first thing to build |

The QR generator should run on the server (a server component emitting inline SVG) so no client JavaScript is added to the route. A dependency is needed; it must be researched (current release, maintenance, license, size) before choosing. I did not research it.

### 4.3 Daily use

Unchanged: `/supervisor` crews worst first, plan, sign-off, Stop work with Undo. Changes: the demo scaffolding leaves the screen (section 2); the role badge appears; a "Crew codes" link in the page footer opens S0c.

## 5. Safety officer (HSE) onboarding

1. Role entry `/hse/enter`: same pattern as 4.1: "Safety officer, demo".
2. `/hse` becomes a real, small page instead of a bare heading. It reads what the public crew list already returns (`Crew` has `stopped`, `stopped_at`, `plan_status`, `signoff_state`, `member_count`): a table of crews with plan status, signed or not, stopped or not; one sentence on privacy ("Crews with fewer than 5 people show their level only"); and a panel "What you cannot see here" that states the boundary and links to the governance refusal. The weekly site-by-day table with k-suppressed cells (H1) and the export are not buildable without new endpoints; show them as DESIGNED. Real versus demo: the table is real data on the synthetic site.
3. Site setup (H0) is the same designed flow as 4.2.

## 6. Judge and reviewer path

`/tour` (plain static page, English by design): a one-line promise, a three-minute video link (when it exists), six numbered stops with one link each (the evidence, the audit detail, try as a worker, try as a crew lead, the boundary, limits and next steps), a table "Real or demo" (section 8) and the Demo controls (Replay or Live, Reset). The six stops map to the scoring criteria in `docs/research/2026-11-11-judges-and-wow-moment.md` section 1.2. It replaces "Walk me through it".

## 7. Access: options and trade-offs

| Option | What it is | For | Against | Verdict |
|---|---|---|---|---|
| A. As is | No sign-in anywhere; one shared token behind an allow-list | Zero work; frictionless demo; honest (ADR 0062) | A visitor cannot tell roles apart; "is there auth" has no visible answer; looks like a prototype to a buyer | Not enough |
| B. Role entry for the demo, production plan stated (recommended) | Section 4.1: one tap per role, no credentials, a role badge and sign-out | Visible roles; honest about what is demo; no fake form; about 2 hours; keeps ADR 0062 intact | Not a security control; must be labelled as such | Recommended |
| C. Real employer sign-in (email magic link) before submission | Issue per-person tokens; send emails; store sessions | Real | Needs an email service, token issuance, session store, rate limits and a reset story; cannot land by the freeze; changes the ADR 0062 allow-list model and its trigger ("worker or supervisor accounts") | Defer with an ADR; show as the production plan |
| D. Worker accounts | A login for each worker | Cross-device continuity; verified rosters | Creates the identifier the governance claim says does not exist: "no individual data on the server" becomes "we hold accounts and promise not to look". Adds a health-adjacent record (profile plus push address plus identity) the data-protection position has not been reviewed for. Friction: shared phones, prepaid phones, low literacy, resets. Gives an employer a lever to ask for per-person data. No feature needs identity: the personal level is computed on the phone | Rejected for this product. Revisit only if a pilot needs verified attendance and counsel agrees, as an opt-in pseudonymous account |

### Production plan for employer staff (a proposal, not built, not fully verified)

1. An employer administrator is created by Stellar Blaze for each contractor, then invites crew leads and safety officers by a signed, single-use, expiring link (72 hours is a proposal). Invitation links avoid needing the contractor's IT department.
2. Sign-in by the contractor's own Microsoft Entra account where they have one (OIDC through the server-side proxy, an httpOnly session cookie, the role from a claim), with a magic-link fallback for small contractors. A product decision is needed between Entra workforce guest access and Entra External ID: I found only that Azure AD B2C stopped being sold to new customers on 1 May 2025 (Microsoft Q&A and FAQ) and that Entra External ID is the successor; I did not verify guest-versus-External-ID details. Needs a one-day spike.
3. Roles: today the API accepts exactly one role value, `employer` (`api/auth.py` raises on any other). The plan needs `crew_lead` (their crews: view plan, sign off, Stop work), `safety_officer` (their sites: read aggregates, export, no Stop work), `site_admin` (sites, crews, roster, QR codes) and `employer_admin` (invitations). That is backend work and a migration, and it belongs after the pilot is agreed.
4. Audit: every action already records the actor (the token's principal). Per-person tokens make the audit row name a person instead of "demo".

## 8. Real versus demo, in one table

| Piece | Status in the demo |
|---|---|
| Worker join by code or by picking site and crew | Real, on the demo site only |
| What is stored on the phone, what goes to the server | Real; the card describes the actual behavior |
| Warnings on a real phone | Real if the push spike passed (roadmap check; not verified here) |
| Role entry for crew lead and officer | Demo-only (shared token, no credentials) |
| Crew QR codes | Real (encode real join links for the four demo crews) |
| New site form, roster upload, HSE weekly table, export | Designed only; roster preview optional, client-side |
| Sign-in with Entra, invitation links, roles beyond `employer` | Plan only |
| All data on the screens | Made up (synthetic site); the weather in Replay is real recorded weather, the crew is assumed |

## 9. Journeys at a glance

| Role | Fastest path | Taps (OS steps separate) | Fields |
|---|---|---|---|
| Worker, with a code | Scan, confirm, (language), turn on warnings | 2 (+ scan, + permission prompt) | 0 |
| Worker, without a code | Tile, pick site, pick crew, confirm, warnings | 5 (+ permission prompt) | 0 |
| Crew lead | Tile, "Continue as the demo crew lead" | 2 | 0 |
| Safety officer | Tile, "Continue as the demo safety officer" | 2 | 0 |
| Judge | Tile, then the tour | 1 | 0 |
