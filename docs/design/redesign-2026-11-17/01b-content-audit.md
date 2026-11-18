# 01b. Content and jargon audit

Date: 2026-11-17. Scope: everything a visitor can read: `frontend/messages/en.json` (1,122 strings), the components that assemble text (`components/provenance`, `features/judge`), and the data records the screens render verbatim (provenance blocks, verdict sentences, policy and plan labels). Method: a regular-expression scan of the English catalogue (values, not keys), counted per distinct string, then a read of the matching strings and the code that renders data records. My counts differ slightly from the owner's (he measured protocol 12, SHA 32, pre-registered 9, theta 2, P0 3, P3 6, epoch 2) because the regular expressions differ, for example mine treats "pre-regist*" and "locked before" together and counts "SHA" only in values. The distribution is the same: the volume sits in `states.proof.*`, `judge.proof.*`, `judge.scoreboard.*` and `judge.day.*`, which are the "claims surfaces". Those four prefixes are English by design in all six catalogues (`CLAIM_PREFIXES` in `scripts/i18n-sync.mjs`), so rewriting them costs no translation work. That is the single most useful fact for the schedule.

Counts (distinct strings, my method): protocol 10, "SHA-256" or fingerprint or hash 5, pre-registered or locked 18, theta 2, policy codes P0 to P3 6, "lead" (forecast lead) in data only, k-suppression wording 4, epoch 2, replay 6, synthetic or simulated 13, WBGT 6, NIOSH 1, ADOSH 14, interval 6, held-out 4, "danger hours" or "false alarm" 20, script or function 5, file or .json or .md 21, "Not recorded" 2, validator 8, corrector or model 4, qaylula or spine or slot 10.

## 1. Decision rule

| Code | Meaning |
|---|---|
| (i) Replace | Say it in plain words everywhere in the Story and Product layers |
| (ii) Keep and explain once | A term a stakeholder will meet in the wild (ADOSH, WBGT) keeps its name, with a one-line gloss at first use on the page and a glossary entry (`/glossary` or a `<details>` on the landing; one new static page, English by design) |
| (iii) Auditor layer | Keep exactly as is, but only inside "For auditors" (02b) |

Honesty rule for every rewrite: plainer is allowed, softer is not. Every replaced sentence keeps its numbers, its label (real or assumed), and its negative results. A plain sentence for a "not supported" verdict must say "not met", not "mostly met".

## 2. Where the jargon is, and what to do with each term

| Term | Where it appears | Who sees it | Action |
|---|---|---|---|
| File paths, function names, commit ids (`src/features/judge/facts.ts:seasonFacts`, `static/omaa_2026_ifs_d1_wbgt_hourly.json`, `docs/research/...md#anchor`, `@ 661b373`) | Proof sheet and drawer rows `protocol`, `script`, `file` (data-driven, `proof.ts`) | Every visitor who taps a chip | (iii) |
| SHA-256 hashes, "data hash", "lock hash" | `states.proof.rows.sha`, `.lock.hash`, proof sheet | Same | (iii) |
| "Not recorded" | `states.proof.notRecorded`, rendered for every null field | Same | Delete. Hide a field with no value. If the record is incomplete, say it once in one sentence (02b) |
| "Protocol line", "Protocol committed", "Scoring run", "Shown here" timeline | `judge.proof.timeline.*`, `judge.proof.notes.*` | Same | Story layer gets a three-sentence plain line; the timeline moves to (iii) and shows only for scored claims |
| "Pre-registered", "locked before the run", "commit of the pre-registered protocol" | Scoreboard evaluation line, day rule, verdict headings | Every judge, investor, regulator | (i) "written down before we ran it"; the lock and commit move to (iii) |
| `P0`, `P1`, `P2`, `P3, protective`, `P3, balanced` | `judge.scoreboard.warnings.policies.*.code`, verdict text from the export | Judge, investor | (i) drop the codes from Story and Product; names carry the meaning; codes stay in (iii) |
| "theta 0.30 / 0.45" | `warnings.tradeoff.missed` and `.balanced` | Judge | (i) "protective setting" and "balanced setting"; theta values in (iii) |
| "H4 supported at lead 1", "H5 not supported at lead 1 (secondary)" | Verdict sentences printed verbatim from the scoring export (`VerdictList.tsx`) | Judge, investor, regulator | (i) plain verdict composed from structured fields by a fixed reviewed template (see section 3), verbatim sentence kept in (iii) |
| "lead 1", "lead 2" | Inside the verdict text and some column notes | Judge | (i) "a day ahead", "two days ahead" |
| "95% interval [a, b]" | Counters, table cells, verdicts | Everyone | (ii) "likely range a to b" with a gloss "95% interval: if we repeated the test many times, 95 out of 100 ranges built this way would contain the true value" |
| WBGT, "NIOSH heavy-work limit", "ADOSH High or Red zone", "ECMWF IFS" | Landing readout, problem chapter, day chart, verdicts | Everyone | (ii) first use: "heat stress index (WBGT)", "the regulator's High or Red zone (ADOSH, Abu Dhabi's workplace-safety authority)", "the European weather centre's forecast (ECMWF)". Glossary entry for each |
| "thermal margin of 7 W/m² is an assumption" | `hook.definition` | Everyone | (iii) plus one sentence under "what this does not show": "The danger-hour count uses a safety margin we chose, not a measurement at a worksite" |
| "Corrected forecast", "corrector", "model id `corrector-20261114-d327987-6edafa`" | Policy sublabels, day counters, drawer `model` row | Everyone | (ii) "our corrected forecast (the weather model's forecast, adjusted for known local errors)"; model id in (iii) |
| "Independent validator" | `judge.try.*`, `judge.scoreboard.plans.sub` | Judge, regulator | (i) "independent rule checker" with the existing good sentence "shares no code with the planner" |
| "Replay", "Live" | Header switch, level stamp, landing kicker, scoreboard title "replayed honestly" | Everyone | (ii) "Demo day: a recorded day, 14 June 2026, plays as if it were today" for Replay; "Live: today's real forecast". Drop "replayed honestly" as a title (see 02) |
| "Synthetic", "SIMULATED", "RECORDED", "REAL" | Banner, stamps, proof label | Everyone | (i) "Demo site: the crews and people are made up" for the banner; labels become "Real weather, assumed crew", "Simulated crew", "From a recorded forecast". The label wording must not change meaning |
| "Epoch", "new epoch 3", "append-only" | Reset toast, governance note | Judge, regulator | (i) "Demo reset. The log keeps every earlier entry." (the audit property is the point, so keep "kept, not deleted") |
| "k-suppression", "fewer than {k} people, detail hidden to protect privacy" | Crew footnotes | Crew lead, officer | The sentence is already plain; keep. Never write "k-suppression" in the UI |
| "Hash-chained", "tamper-evident" | Governance page, video | Regulator, officer | (ii) keep "tamper-evident log" with gloss "each entry includes the one before it, so a change shows" |
| "Held-out" | Scoreboard sub line, evaluation line | Judge, investor | (ii) "held-out: not used to choose any setting". Keep the phrase "every choice fixed on 2024 and 2025 data" |
| "Qaylula", "spine", "slot" | Component docs and `common.kit.*`; `qaylula` appears in the shared tokens | Developers only | Not user-facing on the product screens; the dev kit is excluded from the audience |
| "Plan zone", "cycled", "violation minutes per worker-season", "missed protection ticks" | `judge.scoreboard.plans.columns.*` | Judge, officer | (i) see section 3, Plans table |
| "Draft wording, awaiting clinical review" | Worker Today twice, alerts | Worker | One instance per screen; plain: "Not yet checked by a clinician" (needs the ADR 0035 owner's agreement) |
| "Sun mode: on" | Header toggle on every field screen | Worker, crew lead | (i) automatic screen colours with a settings entry; see 04 |

## 3. Exact replacement wording for the most visible text

All numbers below are ledger numbers (`numbers.md`) quoted exactly. Where I give a rounded figure it is marked "about" and the exact figure stays one tap away.

### 3.1 Landing

| Now | Replace with |
|---|---|
| Kicker: "Summer 2026, replayed against airport thermometers" | "Tested on last summer's real weather at Abu Dhabi airport" |
| Title: "Heat that stops work, forecast about 24 hours ahead." | "Plan tomorrow's heat tonight." |
| Lede: "Hour-by-hour heat levels, legal shift plans and warnings in six languages, for the crews on a worksite, shift by shift." | "Stellar Blaze turns a day-ahead forecast into a work-and-rest plan for each crew, and a plain warning on each worker's phone, in six languages." (Drop "legal": the plan follows the published ADOSH heat rules but is not certified.) |
| Hook: "252.5 danger hours at Abu Dhabi airport, summer 2026, 95% interval 191.5 to 315.5. A danger hour is an hour in the ADOSH High or Red zone during working daytime, 06:00-14:59 UTC (10:00-18:59 GST) ..." | Chapter "The gap" (not the hero): "Last summer the airport's own instruments recorded about 250 working hours in the High-risk zone. The midday break does not cover them. Likely range: 192 to 316. This is one airport station, not a worksite." The 06:00 to 14:59 definition and the 7 W/m² margin go to the "How we counted" line |
| "Hottest grid cell at 18:00 ... 25.25 N 55.75 E", "Grid cells above the limit 370 of 374" | Remove from the hero. A single caption under the field: "Forecast heat across the UAE for one hot day. An illustration, not the day we scored." |
| "Open the apps" | Replaced by the role door in the hero (03 section 2) |
| "Walk me through it" | "Take the 3-minute tour" |

### 3.2 Scoreboard (`/replay`)

| Now | Replace with |
|---|---|
| Title: "Summer 2026, replayed honestly" | "How four ways of warning a crew would have done last summer" |
| Sub: "Four ways to warn a crew, each judged on the forecast it had about 24 hours ahead, against what the station's thermometers then recorded." | Keep, it is good. Add: "We wrote down how we would be judged before we ran the test, and ran it once." |
| Evidence line: "Scored once on summer 2026, under a protocol locked before the run." | "Tested on summer 2026. Every setting was chosen using 2024 and 2025 data only. The test plan was written down and locked before the scored run; three later changes are logged for auditors." (ledger: `run.amendments` = 3; do not write "never looked at") |
| Columns: "Danger hours nobody was warned about", "False-alarm hours" | Keep. Add one line once: "A false-alarm hour is an hour we warned about that the station did not record as dangerous." |
| Policy names | "Midday break only", "Fixed 32 °C rule", "Regulator's zones, raw forecast", "Stellar Blaze, protective setting", "Stellar Blaze, balanced setting". Codes P0 to P3 removed from the Story layer |
| Table row note for the regulator's zones | Add a visible sentence under the table (honesty rule, P2 is better on false alarms): "The regulator's zones on the raw forecast raise fewer false alarms (74.5 hours against our 183.5) and miss more danger hours (80.5 against our 45.5). Our protective setting is the cautious end of that trade; the balanced setting is the other end." Ledger: `warn.l1.P2.false_alarm_hours` 74.5, `warn.l1.P3_protect.false_alarm_hours` 183.5, `warn.l1.P2.missed_danger_hours` 80.5, `warn.l1.P3_protect.missed_danger_hours` 45.5 |
| H4 verbatim | "Against the midday break alone, our protective setting missed 207 fewer danger hours (likely range 154.5 to 261.5 fewer), and raised 93 fewer false-alarm hours than the fixed 32 °C rule (likely range 37.0 to 148.5 fewer). This was the main check and it was met." Ledger: `warn.H4.P3_protect_vs_P0.missed_danger_hours` -207 [-261.5, -154.5]; `warn.H4.P3_protect_vs_P1.false_alarm_hours` -93 [-148.5, -36.98] |
| H5 verbatim | "Against the regulator's own zones on the raw forecast, our protective setting missed 35 fewer danger hours (likely range 19.5 to 54 fewer) but raised 109 more false-alarm hours (likely range 67.5 to 160 more). That is more extra false alarms than we had allowed in advance, so this check was not met. We do not claim to beat the regulator's zones." Ledger: `warn.H5.P3_protect_vs_P2.missed_danger_hours` -35 [-54, -19.5]; `.false_alarm_hours` 109 [67.49, 160] |

Implementation note (it matters for honesty): the verdict list is deliberately verbatim ("never composed here"). The replacement must not weaken that guarantee. Compose each plain verdict from the structured fields of the export (id, supported flag, deltas, intervals) with a fixed, reviewed sentence template per verdict id, assert in a unit test that every number in the sentence equals the field it was read from and that the "met or not met" word equals the file's `supported` flag, and keep the exporter's verbatim sentence in the auditor layer under "Exactly as the scoring run wrote it". If a verdict id has no template, show the verbatim sentence in the auditor layer only and one neutral line in the story layer ("See the audit detail for this check").

### 3.3 One day (`/replay/day`)

| Now | Replace with |
|---|---|
| "One day, hour by hour, chosen by a rule before we looked" | "One day, hour by hour: 14 June 2026" (ledger `demo.date`). Keep the sub line: "We chose this day by a fixed rule, from the station's data alone, before looking at our own results. One day is an illustration, not proof of skill." |
| "The protocol fixes it by rule, on truth only: the day with the most observed High-zone working hours outside the midday break, ties to the earliest date." | "The rule: the day with the most working hours in the High-risk zone outside the midday break, judged on the station's records only." Ledger: `demo.candidates` 138 days considered |
| "Called by ADOSH zones on the raw forecast" | "Warned about by the regulator's zones" ; "Called by Stellar Blaze, protective threshold" becomes "Warned about by Stellar Blaze (protective)". Ledger values: of 7 High-zone hours (`demo.high_hours`), raw 5, ours 6, fixed 32 °C rule 7 |
| "Called means the forecast put that hour in the High or Red zone." | "Warned about means the forecast put that hour in the High or Red zone the evening before." |

### 3.4 Try a plan, governance, worker, supervisor

| Surface | Now | Replace with |
|---|---|---|
| Try a plan | "The validator is independent: it shares no code with the planners that make our plans, so a plan cannot pass by construction." | "This rule checker is independent: it shares no code with the planner that builds our plans, so a plan cannot pass just because it was built by us." |
| Try a plan | "What the validator found" | "What the rule checker found" |
| Governance | "Reset starts a new demo epoch for this synthetic site. Nothing is deleted: the audit log stays append-only." | "Reset starts the demo site fresh. Nothing is deleted: the log keeps every earlier entry." |
| Governance | "...writes the refusal to a log that every worker at the site can read" | Keep; it is plain and exactly right |
| Shell | "Synthetic demo site: no real people, no real data" | "Demo site. The crews and people are made up." |
| Shell | "Sun mode: on" | Removed from the header; Settings sheet entry "Screen colors: Automatic" (04) |
| Worker Today | "Draft wording, awaiting clinical review" (twice) | Once: "Not yet checked by a clinician." |
| Worker Today | "Site level now" / "Last known level" | Keep ("Site level now"), it is plain |
| Worker | "No unacclimatised person to work", "High Risk induction required...", "Provide personal water bottle (2 litre capacity) on-site at all times" | Not shown to the worker. Shown on the crew lead's plan page under "Site duties today" with the ADOSH wording intact |
| Supervisor | "Replay | Live" switch and a second "Replay" stamp | Move to a footer "Demo controls" sheet; one demo ribbon at the top ("Demo day, 14 June 2026") |

### 3.5 Plans table headings (scoreboard)

| Now | Replace with |
|---|---|
| "Rule-violation minutes per worker-season" | "Minutes a worker would have worked against the rules, per season" |
| "Share of High-zone heavy work planned as cycled" | "Share of dangerous-hour heavy work that the plan broke into work and rest" |
| "Minutes worked in a milder plan zone than the truth" | "Minutes the plan treated as safer than the station's record" |
| "Rest minutes added per worker-season" | "Extra rest minutes per worker, per season" |

All four rows keep the label "REAL weather + assumed crew" (ledger label) written as "Real weather, assumed crew of 20 doing heavy work".

## 4. Summary of the three buckets

| Bucket | Strings and fields |
|---|---|
| (i) Replace | about 38 catalogue strings in the four claims prefixes plus the verdict, policy-code and plan-heading labels; all English-only, so no translation work |
| (ii) Explain once | ADOSH, WBGT, interval, held-out, tamper-evident log, corrected forecast: one glossary of 8 entries (English only) |
| (iii) Auditor layer | every provenance field (`protocol`, `script`, `file`, hashes, model id, time, lock and amendments), the verbatim verdict sentences, the policy codes and theta values |

## 5. Gate to stop it coming back

Add a unit test that scans the rendered Story and Product namespaces (all messages outside `states.proof.audit.*` and `judge.audit.*`) for these patterns and fails on a match: `\.(json|md|ts|tsx|py)\b`, `[0-9a-f]{40,64}`, `Not recorded`, `\bP[0-3]\b`, `\bH[0-9]\b`, `\btheta\b`, `\bSHA\b`, `\bepoch\b`, `src/`, `docs/`. A second test renders each claim type's "Where this number comes from" projection and asserts the same patterns do not appear in the output (the leak was data-driven, so the test must run on data, not only on the catalogue).
