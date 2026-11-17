# 01. Users, jobs and success metrics

Design phase, 2026-11-11. Sources: `docs/context/challenge-07-plan.md` (§5, §8.4-8.9); ADRs 0003, 0004, 0010, 0011,
0017, 0034, 0035 (main repo `D:\dev\stellar-blaze\docs\decisions`); research docs
`2026-11-11-frontend-platform.md` (§1.2, §8), `2026-11-11-judges-and-wow-moment.md` v2 (§0, §4, §8, §9),
`2026-11-11-roster-stakeholders-and-compliance.md` (§2, §5, §9).

**Honesty label for this whole folder:** every persona below is a **proto-persona** built from desk research. No
worker, supervisor, HSE officer or judge has been interviewed or tested. Every validation claim here is
**self-reviewed** (heuristic review, cognitive walkthrough), never user-validated. The human-run methods each
needs are listed at the end.

## Problem statement

Outdoor workers in the UAE summer are protected by a fixed midday ban (12:30 to 15:00, 15 Jun to 15 Sep) and by
ADOSH zone rules that few on site can compute. Heat danger falls outside the ban too, and a naive threshold alarms
all day, so warnings are either missing or ignored. The product turns the evening-before forecast into a level per
hour, an ADOSH-clause work/rest plan per crew, and a warning a low-literacy worker can read in glare. It does this
without exposing any worker's personal risk or symptoms to the employer, and it proves its value on a held-out
summer scored against thermometers.

## Proto-personas and jobs-to-be-done

### P1. Worker (primary user of the worker PWA)

- **Who:** migrant outdoor labourer on a construction or utility site near Abu Dhabi (Musaffah/KEZAD belt).
  Speaks Urdu, Hindi, Bengali, Nepali, Arabic or English; reading ability ranges from none to fluent; often
  reads a second language better than writes it.
- **Device and context:** cheap Android (2 to 3 GB RAM), cracked or dusty screen, direct sun at noon, gloves or
  sweaty hands, intermittent data, phone possibly restricted on site (unverified, frontend-platform §1.2).
- **Top constraint:** must understand the level **without reading** (colour + hatch + pictogram + numeral +
  audio), in under 3 seconds, in sun.
- **Jobs:**
  - J1. *When I start the day or a warning arrives, I want to see how hot it will get and what to do, so I can
    rest and drink at the right times without asking anyone.*
  - J2. *When I feel unwell, I want one big button that tells me exactly what to do and gets help, so I can be
    safe without my supervisor seeing my health.*
  - J3. *When I worry the app reports on me, I want to see what it stores and who asked for it, so I can trust
    it.*
- **Fears (stakeholders §2.7, §2.10):** being reported as weak, losing pay, surveillance.

### P2. Supervisor / crew lead (on site, glanceable)

- **Who:** foreman for 1 to 4 crews of one subcontractor (employer of record). Bilingual; reads English or Hindi/Urdu.
- **Device and context:** mid-range Android or tablet, on site, between tasks; will look for 5 seconds at a time.
- **Top constraint:** must relay to workers who have no phone or no data: large colour state, a short bulletin,
  a pre-rendered audio clip, a printable crew card (ADR 0004 §3).
- **Jobs:**
  - J4. *When I plan tomorrow's work, I want each crew's ADOSH work/rest plan with the clause behind every block,
    so I can sign it off knowing it is legal and protective.*
  - J5. *When the level changes, I want to brief my crew in their language in one move, so nobody is missed.*
  - J6. *When something is too hot, I want to stop work instantly, so I never wait for approval.*
- **Must not see:** any worker's personal risk or symptoms (stakeholders §5).

### P3. HSE officer / regulator view (aggregate only)

- **Who:** the employer's HSE officer or DPO; later ADPHC/ADOSH (roadmap only, ADR 0017).
- **Context:** desktop, weekly review, inspection prep.
- **Jobs:**
  - J7. *When I review the week, I want High-zone hours, plans signed, stops and overrides by site and employer,
    so I can show the programme works and spot gaps.*
  - J8. *When a small group would identify people, I want the number hidden, so I cannot be accused of tracking
    individuals.* (k 10 for health counts, 5 for exposure: ADR 0011 §7.6.)

### P4. Judge (3-minute video + 7-minute live pitch + hands-on link)

- **Who:** panel across ten challenge statements: clinicians, public-health researchers, engineers, investors
  (judges doc §1.1). Strong field assumed (ADR 0034).
- **Context:** large screen or laptop, seconds per screen, sceptical of mock-ups.
- **Jobs:**
  - J9. *When I see a claim, I want to check where the number came from in one click, so I can tell real work
    from a styled mock-up.*
  - J10. *When I watch the replay, I want to see in seconds who was warned and who was not across a whole real
    summer, so I can judge the impact honestly.*
  - J11. *When I am told "it is safe", I want to try my own plan against the rules, so I can see the rules are
    enforced by code.*

### P5. Operator / admin (F2 stretch)

- **Who:** Ali, during the demo; later an employer HSE lead with an admin token.
- **Job:** J12. *When the back-test says a tunable should move, I want to change it within its reviewed range
  with a reason, and roll it back, without a redeploy (ADR 0010).*

## Primary task per surface (the one thing each must make effortless)

| Surface | Primary task | Success metric (type → instrument) | Target |
|---|---|---|---|
| Worker Today | Know the current level and the action | **Task success + time-on-task** → scripted test: "what should you do now?" answered correctly from the screen; time from screen open | ≥ 90 % correct, ≤ 5 s, in each of 6 languages, outdoors (pilot test; not run) |
| Alert card | Act on a warning | Task success → same script from a push tap | ≥ 90 % |
| I feel unwell | Reach the call → move → cool steps | Step count vs minimum → event `unwell.opened` → `unwell.step_viewed` | ≤ 1 tap to the steps, ≤ 2 to call |
| Supervisor crew plan | Sign off a legal plan | Task success + error rate → event `plan.signed` with 0 validator violations; `plan.deviation` reason codes | 100 % of shown plans pass the validator (ADR 0011 §9 metric 6) |
| Crew relay | Brief a crew | Task success → `relay.opened`, `relay.audio_played`, `relay.card_printed` | Relay reachable in 1 tap from any crew |
| HSE | Read the week | SUS (10-item, after a scripted review) | ≥ 68 (pilot; not run) |
| Season scoreboard | Understand who was warned | **5-second test** (judge-proxy): "which policy left the most danger hours unwarned?" | ≥ 4 of 5 correct (not run) |
| Proof chip | Trace a number | Task success → `proof.opened` per number | 1 tap |
| Try a plan | See a rule enforced | Task success → `validator.run` → violations rendered | ≤ 3 taps from template to result |

## Stated assumptions (unanswered questions, made explicit)

| # | Assumption | Why it matters | How to retire it |
|---|---|---|---|
| A1 | Workers can keep a phone on them at least at breaks | Worker PWA is useful at all | Pilot phone and site-rule survey (stakeholders D7) |
| A2 | Supervisors are the main relay for workers without data | Relay mode is first-class | Pilot observation |
| A3 | Pictograms (sun-check, drop, canopy, raised hand, phone-cross) are understood | Low-literacy comprehension | Native-speaker comprehension test before pilot |
| A4 | Urdu Nastaliq is preferred over Naskh by Urdu readers on phones | Font choice | Native-speaker review (frontend-platform §8.2) |
| A5 | "I feel unwell" goes to a first-aider role, not to the supervisor dashboard | Privacy (G9) | B3 confirms the routing; ADR needed for the first-aider endpoint |
| A6 | Judges use a laptop at ≥ 1280 px for the hands-on link | Demo layout | Responsive down to 390 anyway |
| A7 | All demo numbers arrive as exporter JSON with a `provenance` block | Proof chips render, never hand-written | B3 exporter contract (judges §8.2) |

## Human-run methods still needed (not done; listed so no one claims them)

- Worker: in-language comprehension test of the level sign + alert card with 5 workers per language outdoors at
  noon (moderated, think-aloud with an interpreter). High stakes: safety comprehension.
- "I feel unwell": clinical review of the escalation card (ADR 0035; label "not clinically reviewed" until done).
- Supervisor: moderated task run of sign-off and relay with 3 to 5 foremen.
- Judges: a 5-second test of the scoreboard with 5 people outside the team.
