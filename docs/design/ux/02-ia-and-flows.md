# 02. Information architecture and flows

## Content inventory → grouping

Grouped by each user's mental model (a simulated card sort on task co-occurrence; **self-reviewed, flag for a
tree test** before pilot). Labels use the user's words ("Today", "Alerts", "My data", "Crew", "Stop work"), not
internal names ("Tier B", "provenance", "k-suppression").

## Sitemap

```
/                                   Role chooser (no login; demo data is synthetic, stated)
├── /worker                         Worker PWA (sun-first light theme, bottom bar: Today · Alerts · My data)
│   ├── /worker                     W2 Today: level sign + shade band + actions          [default]
│   ├── /worker/setup               W1 Set up once: consent + 3 fields (stored on phone only)
│   ├── /worker/alert/:id           W3 Alert card (opened from a push or the band)
│   ├── /worker/unwell              W4 I feel unwell (reachable from every worker screen, fixed button)
│   ├── /worker/alerts              W6 Alerts on/off, push denied / iOS install help
│   └── /worker/my-data             W5 My data: what is stored, who asked (audit), remove my data
├── /supervisor                     Supervisor (top bar: site · date · language · theme)
│   ├── /supervisor?site=           S1 Crews today (list, crew level now, plan status)
│   ├── /supervisor/crews/:id       S2 Crew plan: timeline + break plan + sign-off + Stop work
│   └── /supervisor/crews/:id/relay S3 Crew relay: full-screen level, bulletin, audio, print card
├── /hse                            H1 HSE week view (aggregates, k-suppressed)
├── /admin/config                   A1 Runtime config (F2 stretch; admin token; not linked from worker)
└── /replay                         Demo spine (judges)
    ├── /replay                     D1 Summer 2026 scoreboard: Warnings + Plans rows, season ribbon
    ├── /replay/day                 D2 Pre-registered day: raw vs ours vs station truth → worker card
    ├── (drawer on any number)      D3 Proof drawer
    ├── /replay/validator           D4 Try a plan (independent validator)
    ├── /replay/frontier            D5 Roster frontier (static analysis, ADR 0011 §6)
    ├── /replay/climate             D6 Same summer, warmer (SHOULD; cut first)
    ├── /replay/governance          D7 Governance refusal: employer request → 403 → worker's audit row
    ├── /replay/faults              D8 Break things: offline, stale forecast, feed lost, push lost
    └── /replay/next                D9 What's next (roadmap, status chips)
```

Navigation rules:
- Worker: 3-item bottom bar; the **I feel unwell** button is fixed above the bar on every worker screen (never
  more than one tap away). Back is the browser/system back; no hamburger.
- Supervisor: top bar + breadcrumb (Crews › Crew A). **Stop work** is on every crew screen.
- Replay: a step rail (Season · Day · Proof · Try a plan · Frontier · Climate · Governance · Faults · Next) that
  mirrors the storyboard order (ADR 0034: wow → real work → potential). Each step is a URL, so the pitch can deep-link.
- The role chooser is the only cross-role link. Worker code never links to supervisor/HSE routes (ADR 0009 §7
  route-group isolation).

## Pushback on the requested view list (rule 0)

1. **Added, not requested: D7 Governance refusal and D8 Break things.** Both are on the never-cut lists (ADR 0034
   §9; roadmap §7 item 7), and neither had a screen in the brief. D7 is the second of the top three judge priorities.
2. **Added: W1 Set up and W6 Alerts.** The Today empty state and the push-denied path need somewhere to go; F1 Task 8
   and the alerts page already exist in code.
3. **"I feel unwell" must not notify the supervisor.** Stakeholder G9 (Must): symptom reports never reach supervisor
   or employer dashboards. The design routes to *call 998 / your site first-aider* and the escalation card only. The
   backend destination for a queued "unwell" message is **undecided** (ADR 0004 says it is queued and retried, not
   where it goes): needs a decision before F2 builds the send (assumption A5).
4. **The scoreboard must not autoplay.** A 15 s ticking scrubber is the brand moment in the video, but on the
   hands-on link it opens on its **final frame** with a Play control (WCAG 2.2.2 pause/stop/hide for motion > 5 s,
   and a judge reading in seconds needs the totals, not an animation).
5. **Climate what-if is designed but marked cut-first** (ADR 0034 §5, §8). F2 builds it only if the 16 Nov gate is
   green; the prototype view carries a "SHOULD · cut first" note so nobody schedules it as MUST.
6. **Admin config stays minimal.** Floors (class c) are shown read-only with their source; only class (b) tunables
   are editable within range. Editing rules in a UI is explicitly out (ADR 0010 §7).

## Task flows (happy path) and user flows (with unhappy paths)

Notation: `[screen]`, `(decision)`, `→` next, `⚠` unhappy branch.

### F-W1. Worker: first open → Today
`[Role chooser]` → `[W2 Today]` (no profile) → **empty state**: "Set up once so we can work out your own heat
limit, about a minute" → `[W1 Set up]` consent (what is stored, on this phone only; nothing for discipline) → 3
fields → Save → `[W2 Today]` with personal level.
- ⚠ Skips setup → secondary CTA "See today's site level without setup" → W2 with the **site** level and a line saying so.
- ⚠ Consent not ticked → Save stays enabled; submitting shows the inline reason at the checkbox (no pre-disabled
  submit, web-interface-guidelines).

### F-W2. Worker: warning arrives → act
Server push (site/crew level only, ADR 0004 Tier A) → notification "Level 3 Orange from 13:00" → tap →
`[W3 Alert card]`: level sign, time window, up to 3 actions, Play audio, source line → personal level recomputed on
open (Tier B) → if personal is more severe, the card shows the personal level and says so.
- ⚠ **Push denied** → W6 shows "Alerts are blocked" + how to allow in browser settings + the fallback: "Your
  supervisor will tell you, and Today still works when you open it."
- ⚠ **iOS not installed** → W6 install steps (Share → Add to Home Screen).
- ⚠ **App closed and personal level higher than site** → the push carries only the site level; the limitation line
  is on W2, W3 and W6 (ADR 0004 consequence, stated openly).

### F-W3. Worker: offline / stale forecast
Open W2 offline → served from the service-worker cache → banner "Last updated 09:40. This may be out of date. Levels
refresh when you are back online." (≤ 3 h old: no banner; > 3 h: banner; > 48 h or none cached: see below).
- ⚠ **Forecast older than its expiry (48 h cache exhausted)** → hero switches to the **fallback plan level**:
  "No fresh forecast. Follow the site rules: rest in shade every hour, drink water, midday break 12:30 to 15:00",
  never less protective than the ban (plan §8.9, P-H12), with a "printed crew card" pointer.
- ⚠ Personal level unavailable (missing profile field or null quantile) → site level shown, line says why.

### F-W4. Worker: I feel unwell
Fixed button (every worker screen) → `[W4]` opens straight onto the **escalation card**: 1 Call (998 / site first
aider, big tel: buttons) · 2 Move to shade · 3 Cool down (steps from ADOSH CoP 11.0 §4.5(c), reviewed text slots) →
optional "Tell my first-aider" (queued if offline: "Will send when you are online", retried while open).
- ⚠ Offline → call buttons still work (tel: does not need data); message queued with a visible queued state.
- ⚠ Label: "Reviewed by an independent clinical consultant, ⟨date⟩" **only if** the review happened, else "Not
  clinically reviewed" (ADR 0035).
- Never: a supervisor notification, a stored symptom history, any analytics.

### F-W5. Worker: my data / consent withdrawn
`[W5 My data]` → what is on this phone (3 fields), what the server has (an anonymous alert subscription for the
site), who asked for what (audit rows), **Remove my data from this phone** → confirm dialog (destructive) → profile
cleared, push unsubscribed, cache cleared → W2 returns to its empty state with a one-line confirmation.
- ⚠ **Consent withdrawn** is exactly this path; there is no server-side personal record to delete (computed on
  device). The confirmation says so.
- ⚠ Unsubscribe fails (offline) → local data cleared anyway; "We will stop alerts when you are back online" queued.

### F-W6. Employer data request refused (governance, D7 + W5)
Employer console requests "individual risk for worker ⟨id⟩" → API **403 problem+json** "Employers have no route to
individual data" + request id → audit row written (actor, time, purpose, outcome **refused**) → the worker's W5
audit list shows "An employer account asked for individual data. Refused. ⟨time⟩".
- In the demo (D7) both sides are on one screen: the request on the left, the phone's audit on the right.

### F-S1. Supervisor: plan → sign-off → relay
`[S1 Crews]` → crew row (level now, plan status: Unsigned / Signed / Changed since signed) → `[S2 Crew plan]` →
timeline (work / ADOSH rest / Art. 18 break / ban / stopped, each with its clause on focus or tap) → floor banner →
pay-impact panel (display only) → **Sign off** (named supervisor): one-tap only if unchanged and no Medium/High
work, else acknowledge each changed or Medium/High item; deviation needs a reason code → signed → **Relay** →
`[S3]` full-screen sign + bulletin + Play audio (crew language) + Print crew card.
- ⚠ **Unsigned at shift start** → crews see the rule plan labelled "unsigned fallback"; alerts and Stop work are
  unaffected (ADR 0011 §7.1). The supervisor screen shows "Not signed. Crews see the rule plan."
- ⚠ **Stale or missing forecast** → plan becomes the rule-plan fallback (P-H12) with a banner.
- ⚠ **k-suppressed crew** (fewer than 5) → share-above-amber hidden: "Fewer than 5 people, detail hidden to protect
  privacy".
- ⚠ **Stop work** → immediate; no confirmation dialog (an undo toast for 10 s instead), audit row, crews alerted.

### F-H1. HSE: week review
`[H1]` → site/employer/week filters (in the URL) → tiles: High-zone hours, plans signed on time, stops, overrides
by reason → table by site-week, k-suppressed cells as "fewer than k" → evidence-pack export (crew-level and
aggregate only).
- ⚠ No data for the week → empty state "No plans or warnings recorded for this site and week" + "Open the demo
  site" + "How data gets here" (forecast refresh + supervisor sign-off).

### F-D1. Judge: replay spine
`[D1 Season]` (opens on the final frame; Play runs 15 May → 30 Sep) → tap any counter's **proof** → `[D3 drawer]`
→ `[D2 Day]` (pre-registered rule stated on screen) → "What the crew saw" → worker card (Urdu, RTL) → `[D4 Try a
plan]` (template picker → edit times → Validate → clause-cited violations) → `[D5 Frontier]` → `[D6 Climate]` →
`[D7 Governance]` → `[D9 What's next]`.
- ⚠ **Scoreboard JSON missing** (data gate fails) → D1 shows a static chart of whatever JSON exists, stamped, and
  never a fabricated number; if none, an empty state explaining the pre-registration and linking the protocol.
- ⚠ **Ours lost** (judges §4.5) → the scoreboard ships as is; no styling changes for a bad result; the copy slot
  for the headline sentence comes from the pre-registered outcome table.
- ⚠ Validator endpoint error → error state with request id + "Show a recorded result" (cut-order fallback).

### F-A1. Admin: change and roll back a tunable
`[A1]` → tunables table (value, range, class) → Edit → value + reason (10 to 500 chars) → Validate → diff → Activate
→ new version row → Roll back (one action, with reason).
- ⚠ Out of range → inline `policy-bound-violation` "Outside the reviewed range [a, b]"; a floor value is not editable
  at all ("Legal floor, changes only by a reviewed ruleset release").
- ⚠ Conflict (someone activated first) → "Config changed since you opened it" + reload diff.

## Edge data to design for

| Data | 0 | 1 | many / longest |
|---|---|---|---|
| Forecast hours on Today | none cached → fallback | 1 hour | 15 hours (06:00 to 20:00); null hours as "no data" cells |
| Crews on a site | empty state | 1 | 12 crews; long crew names truncate with full name on focus |
| Violations in Try a plan | "No violations against the rules checked" + list of what was checked | 1 | 40 rows, grouped by rule, collapsible |
| Audit rows on My data | "Nobody has asked for your data" | 1 | paginated, newest first |
| Languages | English | Urdu (RTL, Nastaliq, line height 2.1) | Bengali/Nepali conjunct-heavy strings in buttons |
| Numbers | k-suppressed | 0 shown as "0", never as suppressed | 5-digit worker-hours with tabular figures |
