# 03. Wireframe spec per view (all four states)

Low-to-mid fidelity, content priority top to bottom. "Focal" = the single focal point. Every view lists
**loading / empty / error / ideal** (and **partial** where data can be half there). Empty states are actionable:
primary CTA + one-line reason + next step. Error states: plain words + Retry + request id (copyable), user input
kept. Numbers in the prototype are `⟨slot⟩` placeholders with a PLACEHOLDER stamp; no real-looking figures.

Shared components: Level sign (rimmed), Shade band, Stamp, Proof chip, Proof drawer, Floor banner, Stale banner,
EmptyState, ErrorState, Skeletons, Unwell button, Stop-work button. The prototype view file is in brackets.

---

## Worker (390 px first, light by default, bottom bar Today · Alerts · My data, fixed "I feel unwell")

### W1 Set up once `[worker-setup.html]`
- **Focal:** the consent statement (what is stored, where).
- **Regions:** title "Set up once" · consent box (3 bullets: stored on this phone only; server gets an anonymous
  alert subscription only if you turn alerts on; never used for discipline or employment decisions) · checkbox ·
  site (select) · work type (3 large radio tiles with pictograms: light / moderate / heavy) · first day of hot work
  (date) · clothing (select from policy) · Save.
- **Loading:** skeleton of the fields (policy and sites loading). **Empty:** no sites → "No sites are set up for
  this demo yet" + "Use the demo yard" CTA. **Error:** policy failed → ErrorState + Retry; typed values kept.
  **Ideal:** form. Validation on blur; future date refused inline.

### W2 Today `[worker-today.html]`
- **Focal:** the level sign (rimmed): pictogram, numeral, level name, time window, "your level, worked out on this
  phone" / "site level".
- **Regions:** top: site name + Play audio · level sign · up to 3 action lines (from reviewed templates) · shade
  band (06:00 to 20:00, now inverted, ban hours outlined) · limitation line (closed-app) · footer: policy and config
  version, Draft translation badge · fixed Unwell button · bottom bar.
- **Loading:** hero + band skeletons at final dimensions. **Empty (no profile):** pictogram + "Set up once so we can
  work out your own heat limit, about a minute" + primary "Set up now" → W1 + secondary "See today's site level
  without setup". **Error:** ErrorState (request id) + Retry. **Partial:** Stale banner (> 3 h) or personal level
  unavailable (site level shown + reason) or null hours ("no data" cells). **Fallback:** no fresh forecast → rule
  fallback sign (never weaker than the ban).
- **Locale:** en and ur (RTL, Nastaliq) shown in the prototype; band flows right-to-left in Urdu; digits stay Western.

### W3 Alert card `[worker-alert.html]`
- **Focal:** full-width level sign with the time window ("from 13:00 to 17:00").
- **Regions:** sign · 3 action lines with pictograms (rest, water, never alone) · Play audio (big) · source line ·
  "What changed" (site went from 2 to 3 at 13:00) · Done.
- **Loading:** sign skeleton. **Empty:** alert expired → "This warning ended at 17:00. See today's levels" → W2.
  **Error:** cannot compute personal level → shows the site level from the push payload + reason (partial, never
  blank). **Ideal:** as above.

### W4 I feel unwell `[worker-unwell.html]`
- **Focal:** step 1 "Call" with two large tel: buttons (998 Ambulance · Site first aider).
- **Regions:** title "If you feel unwell" · 3 numbered steps, each a pictogram + one short line: 1 Call · 2 Move to
  shade · 3 Cool down (text slots from ADOSH Technical Guideline §4.5(c) only: soak, spray, sponge, fan; reviewed) ·
  "Stop work now. You will not lose pay for this." **only if** the employer has attested it (else omitted) · optional
  "Tell my first aider" button · clinical label · privacy line "Your supervisor does not see this."
- **Loading:** none (static, works offline from cache). **Empty:** no site first-aider number configured → the 998
  button stays, the second becomes "Ask the nearest person to call your first aider". **Error:** send failed →
  "Not sent yet. We will try again while the app is open" (queued, visible) + call buttons still primary.
  **Ideal:** as above.

### W5 My data `[worker-data.html]`
- **Focal:** "On this phone" box listing the 3 stored fields.
- **Regions:** On this phone (site, work type, start date, clothing) · On the server (anonymous alert subscription:
  on/off) · Who asked for your data (audit list: time, who (role), what, outcome) · Remove my data from this phone
  (destructive, confirm dialog).
- **Loading:** audit rows skeleton. **Empty:** "Nobody has asked for your data" + why it matters ("If an employer
  asks, it is refused and shown here") + secondary "Set up" if no profile. **Error:** audit list failed → ErrorState
  inline in that section only, the local section still shows (partial). **Ideal:** includes the **refused employer
  request** row (governance demo).

### W6 Alerts `[worker-alerts.html]`
- **Focal:** the on/off switch with its state sentence.
- **Regions:** state sentence · Turn alerts on (button) · limitation line · help panels by state.
- **States:** idle · subscribed · **denied** (how to allow + fallback "your supervisor will tell you") · **iOS not
  installed** (3 install steps) · unsupported · error (request id + Retry). Loading: button busy keeps its label.

---

## Supervisor (768 px first; works at 390; system theme)

### S1 Crews today `[supervisor-crews.html]`
- **Focal:** the crew table's "level now" column (rimmed mini level sign per crew).
- **Regions:** top bar (site select, date, language, theme) · site level now + next change · crew rows: name,
  members, level now, today's band (compact), plan status (Signed / Unsigned / Changed), Open.
- **Loading:** row skeletons. **Empty:** "Crews appear here once they are added for this site" + "Open the demo
  yard" + "Download the crew template (CSV)". **Error:** ErrorState + request id. **Partial:** suppressed crew
  ("fewer than 5"), forecast stale banner.

### S2 Crew plan `[supervisor-crew.html]`
- **Focal:** the plan timeline (blocks per 5-min tick grouped into segments: Work, ADOSH rest, Art. 18 break, Ban,
  Stopped), each block labelled with its clause.
- **Regions:** breadcrumb · crew level now + **Stop work** (always visible) · floor banner (ADR 0011 §7.2 wording) ·
  shade band (crew level, uncertainty range as text "range 2 to 3") · plan timeline · "Why" list (clause per block,
  e.g. "ADOSH Table 1, High zone, heavy work: 20 work / 40 rest") · pay-impact panel (display only: paid hours,
  overtime, ADOSH rest priced as paid time) · sign-off (named; acknowledge each changed or Medium/High item;
  deviation reason code) · Open relay.
- **Loading:** timeline skeleton. **Empty:** no tasks entered → "Add today's tasks to get a plan" + "Use the
  common roster" + "Import tasks (CSV)". **Error:** planner 500 → ErrorState + request id + "Crews see the rule
  plan meanwhile" (never blank for crews). **Partial:** unsigned fallback label; stale forecast → rule plan; k-suppressed share row.

### S3 Crew relay `[supervisor-relay.html]`
- **Focal:** full-screen level sign readable at 3 m (mega numeral).
- **Regions:** sign · time window · 3 pictogram actions · language chips (crew's languages) · Play audio · Copy
  bulletin text (no health data, no names) · Print crew card (A5, black-and-white-safe hatch).
- **Loading:** sign skeleton. **Empty:** crew has no language set → "Choose the crew's languages" chips. **Error:**
  audio clip missing → "Audio not available in Nepali yet. Read the card aloud" (partial). **Ideal:** as above.

---

## HSE (1440 first; works at 768/390)

### H1 HSE week `[hse.html]`
- **Focal:** the "High-zone working hours outside the ban" tile.
- **Regions:** filters (site, employer, week; in URL) · 4 tiles: High-zone hours outside ban, plans signed before
  shift, stops (crew-lead + Red), deviations by reason · table by site-week, suppressed cells read "fewer than 10"
  (health) / "fewer than 5" (exposure) · Export evidence pack (aggregates only) · "What you cannot see here" note
  (no names, no symptoms, no personal risk).
- **Loading:** tile + table skeletons. **Empty:** "No plans or warnings recorded for this site and week" + "Open
  the demo site" + "How data gets here". **Error:** ErrorState. **Partial:** some sites suppressed.

---

## Demo surfaces (1440 first; must read at 768 and 390; step rail)

Every number: counter + 95 % interval line + proof chip + provenance stamp. Disclosures always visible: "Airport
station, not a worksite" · "Crew of 20 is an assumed schedule" · "Truth = station temperature, humidity and wind +
modelled sunshine" · "TWL aligned with ADOSH zones, not certified" (judges §4.4).

### D1 Summer 2026 scoreboard `[replay-season.html]`
- **Focal:** the "danger hours nobody warned about" counter row across 4 policies.
- **Regions:** stamp line ("Forecast as issued at 18:00 the evening before · scored against the station's
  thermometers · summer never seen in training") · season ribbon (15 May to 30 Sep, hatch = truth High-zone
  hours/day, ban days outlined; accessible as a table) · Play/Pause + scrubber (opens at final frame) · **Warnings
  row**: 4 columns (Ban only · WBGT ≥ 32 · ADOSH on raw forecast · Stellar Blaze, ours highlighted with
  `action-soft`), each: unwarned danger worker-hours (danger counter, rimmed), alarm worker-hours, POD / FAR / CSI,
  alerts per worker-shift · **Plans row**: Naive schedule · Ban only · Rule plan on raw · Rule plan on corrected
  quantile, each: rule-violation minutes per worker-season, share of truth-High heavy minutes cycled 20/40, missed
  protection, rest minutes added (SIMULATED) · "See the pre-registered day" CTA.
- **Loading:** column skeletons. **Empty (no exporter JSON):** "Results appear after the single pre-registered
  scoring run" + "Read the protocol (committed before scoring)" + "See the method". **Error:** ErrorState + request
  id + "Show the static chart" fallback. **Partial:** Plans row missing (cut) → Warnings only + note "Plans results
  in the report".

### D2 Pre-registered day `[replay-day.html]`
- **Focal:** the day chart.
- **Regions:** the rule that chose the day (verbatim, "selected on truth only, before looking at our result") ·
  chart 10:00 to 19:00: ADOSH zone background, raw IFS dashed line, our 5 to 95 % band, station truth dots, ban
  window hatched · 3 counters (High-zone hours, of which outside ban, called by raw / by ours) · "What the crew saw
  the evening before" → phone frame with the Urdu worker card (RTL) · disclosures.
- **States:** loading (chart skeleton) · empty (day not yet pre-registered → protocol link) · error · ideal.

### D3 Proof drawer `[component; open from any proof chip; demo in replay-season.html and replay-day.html]`
- **Focal:** the label stamp (REAL / REAL WEATHER · ASSUMED CREW / SIMULATED).
- **Rows:** Protocol clause (path + commit + commit date, shown as "committed before results") · Script and function
  · Result file + SHA-256 (monospace, copy) · Label. Footer: "Reproduce: `uv run …`" (copy).
- **States:** loading (rows skeleton) · empty (number has no provenance block → "No provenance recorded for this
  number. It is not shown as a result.", and the number itself is hidden upstream) · error · ideal.

### D4 Try a plan `[replay-validator.html]`
- **Focal:** the Validate button and then the result list.
- **Regions:** template picker (Common roster 06:00 to 12:30 + 15:00 to 17:00 · Our rule plan · Naive schedule) ·
  editable shift blocks (start/end time inputs per run) · day (pre-registered day default) · Validate · result:
  count by rule, rows (rule id, clause, tick range, plain-language reason), "Checked: ban, rolling 60-min caps,
  Art. 18, hours, lone work, acclimatisation, juveniles, task family, no added minutes" · stamp "independent
  validator: shares no code with the planners".
- **States:** loading (Validate busy, label kept) · empty-result (0 violations → "No violations against the rules
  checked" + list) · error (request id + "Show a recorded result") · ideal (violations).

### D5 Roster frontier `[replay-frontier.html]`
- **Focal:** the one-line verdict "No roster shape outruns the heat under law, sleep and commute."
- **Regions:** chart (x: sleep opportunity h, y: exposure E30 per worked hour; Pareto front; B0 "common practice,
  not compliant" and B1 "legal default" marked; legalisation arrow labelled "gain credited to the law"; night
  templates greyed "not eligible") · commute slider (15 to 90 min) · caption (bedtime floor 21:30 [I], buffers) ·
  stamp REAL climatology.
- **States:** loading · empty (JSON missing → "Static analysis not exported yet") · error · ideal.

### D6 Same summer, warmer `[replay-climate.html]` (SHOULD, cut first)
- **Focal:** the stamp "SENSITIVITY SCENARIO ON A REAL SUMMER · NOT A FORECAST".
- **Regions:** toggle 2026 · +1.5 °C GWL · +2.0 °C GWL · counters shown as **ranges** (humidity bracket: specific
  humidity fixed … RH fixed): High-zone working hours outside the ban, rule-plan rest minutes per worker-day ·
  "extra hours only because of the 44 °C cap" line · method (ARP land+sea headline, land reported) · no calendar year.
- **States:** loading · empty (scenario not computed → "Shown as a slide in the deck") · error · ideal.

### D7 Governance refusal `[replay-governance.html]`
- **Focal:** the 403 response panel.
- **Regions:** left: employer console "Request individual risk for worker ⟨id⟩" → Send → `403 Forbidden ·
  problem+json` (title, detail "Employers have no route to individual data", request id) · right: phone frame of
  W5 with the new audit row highlighted "Refused" · below: CI test names that prove it (purpose-limitation, RBAC).
- **States:** loading (request in flight) · empty (before sending: "Send the request to see what happens") · error
  (API unreachable → recorded run) · ideal.

### D8 Break things `[replay-faults.html]`
- **Focal:** the worker phone preview reacting to the chosen fault.
- **Regions:** 4 fault toggles (Go offline · Make forecast stale (> 3 h) · Lose weather feed (> 48 h) · Push not
  delivered) · phone preview (W2 in the matching state) · invariant line "Fallback is never less protective than the
  ban" + test name.
- **States:** ideal only + each fault's state (it *is* a states explorer).

### D9 What's next `[replay-next.html]`
- **Focal:** the list.
- **Rows:** 7 roadmap lines (judges §9.2), each: next step, what exists now, trigger, status stamp (EXISTS ·
  DESIGNED · NEEDS PILOT).
- **States:** static (no data dependency).

---

## Admin (F2 stretch)

### A1 Runtime config `[admin-config.html]`
- **Focal:** the active version line ("Active: config v⟨n⟩, activated ⟨time⟩ by ⟨actor⟩").
- **Regions:** tunables table (name, value, range, class b), floors table (read-only, class c, source clause) ·
  Edit drawer: new value, reason (10 to 500 chars, counter), Validate → diff → Activate · history (append-only) with
  Roll back.
- **States:** loading · empty (no versions → "Seed from the default file" CTA, CLI hint) · error (request id; 401 →
  "Admin token needed") · ideal · inline `policy-bound-violation`.
