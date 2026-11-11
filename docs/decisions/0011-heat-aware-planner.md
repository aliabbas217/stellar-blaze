# ADR 0011: Heat-aware shift planner: a rule-based ADOSH work/rest planner with an independent validator; the roster question answered by a static analysis

- **Status:** Accepted (Ali, in chat, 2026-11-11); previously Proposed, **v2** (2026-11-11), for Ali's acceptance. v2 replaces v1 of the same day. It answers every Critical and Important finding of `docs/research/2026-11-11-planner-adversarial-review.md` (disposition table at the end) and re-scopes the planner to the 16-17 Nov slot. **All v1 numbers (16.1% / 17.2% "avoided", in-shift 7.8%) are superseded.**
- **Builds on:** ADR 0002 (planner inline, no queue), 0004 (Tier A crew alerts, crew relay, stop signal), 0005 (station truth, held-out 2026), 0006 (TWL zones, NIOSH REL, bias margin, withdrawal limits), 0007 (calibrated quantiles), 0008 (OR-Tools 9.15.6755), 0009 (rulesets as data), 0010 (tunables vs floors, `Personal` data class, immediate escalation).
- **Evidence:**
  - Research docs: `docs/research/2026-11-11-shift-regulations-and-sleep.md` ("Sleep"), `…-roster-feasibility.md` ("Feasibility", erratum added), `…-roster-stakeholders-and-compliance.md` ("Stakeholders"), `…-judges-and-wow-moment.md` ("Judges"), `…-planner-adversarial-review.md` ("Review").
  - **Computation, re-run 2026-11-11** on the Feasibility `hourly_wbgt.parquet`:
    - `docs/research/scripts/roster/legal_sleep_templates.py` **v2**, writing `results/legal_sleep_templates.csv`, `results/legal_sleep_templates_output.txt` and `results/roster_frontier.json`;
    - `docs/research/scripts/roster/within_shift_legal.py`, writing `results/within_shift_legal.csv` and `results/within_shift_legal_output.txt`.
  - CP-SAT parameter names checked against `ortools/sat/sat_parameters.proto` (`stable` branch, 2026-11-11).
- **Labels:**
  - **LAW** = UAE federal or Abu Dhabi rule, quoted in Sleep §1-3 / Stakeholders.
  - **PROTECTIVE READING** = our reading of a law where the text is ambiguous, pending counsel.
  - **POLICY** = a benchmark from EU, HSE, Oregon, AASM or ILO. **Never shown as "compliance".**
  - **[C]** = computed; **[I]** = assumption.

## Context: what the numbers say (v2, [C])
Three findings drive the design.

**1. No roster shape outruns the heat once rosters are legal and leave a night's sleep.** Method:
- **Templates:** 14,596 legal 8 h templates (0.5 h grid). No work 12:30-15:00. No run over 5 h. At least 1 h of non-ban break per day. Each attendance block holds at least 2 h of work. Start 04:30-08:00, end ≤ 22:00.
- **Sleep model (clock time):** wake = start − commute − 45 min; bed = max(end + commute + 2 h, **bedtime floor**); sleep = wake + 24 − bed.
- **Pick:** leave-one-summer-out on station climatology. The **do-no-harm guard** excludes any template worse than the legal default at ≥ 28, ≥ 30 or ≥ 32.

| Result | ≥ 28 | ≥ 30 | ≥ 32 | Notes |
|---|---|---|---|---|
| **Legalising the common roster** (B0 06:00-12:30 + 15:00-17:00, 8.5 h, 6.5 h run) → **legal default B1** 06:00-11:00 + 15:00-18:00, per worked hour | 2.2% | **7.5%** (1.8-16.9% by station-summer) | **19.1%** | 6 clusters × 3 summers. This gain comes from the law, not the planner |
| Sleep of B1, 45-min commute | — | — | — | 7.5 h (bedtime floor 21:00), **7.0 h (21:30)**, 6.5 h (22:00) |
| Sleep of B1, 90-min commute | — | — | — | 6.25 h (21:00 or 21:30), 5.75 h (22:00) |
| Best shape change that is **sleep-neutral** (sleep ≥ B1's) and no worse on heat, vs B1, 45-min commute | 0.0 / 1.0 / 2.7% | **0.0 / 3.7 / 10.4%** | 0.0 / 10.8 / 23.7% | Bedtime floor 21:00 / 21:30 / 22:00, 4 headline stations. The 6-cluster means are within 0.6 points. Typical pick at 21:30: 06:00-11:00 + **15:30-18:30** (evening block 30 min later) |
| Same, 90-min commute | 2.4 / 0.0 / 1.0% | 3.8 / 0.0 / 3.7% | 2.0 / 0.0 / 10.8% | Floors 21:00 / 21:30 / 22:00 |
| With an absolute sleep gate of 7.5 h + guard, floor 21:30 | — | — | — | **No change recommended in 18/18 folds at any commute ≥ 30 min**, because the binding constraint is the commute. At 15 min: 10.2% (≥ 30) / 23.6% (≥ 32) |
| Ignoring sleep entirely (legal hours, evening work to 22:00) | 27.9% | 57.0% | 87.0% | Sleep 2.25 h at a 45-min commute. **Never recommendable** |
| *v1 span model (superseded)* | *11.5%* | *16.1%* | *17.2%* | *Credited a 19:15 bedtime; compared with a non-compliant baseline* |

The bedtime floor, the 2 h buffer and the 45-min prep are **[I]**. The residual shape gain at ≥ 30 swings from 0% to 10% across plausible floors, so it is **not a claim we can make**. The robust statements are these. Legalising the common roster removes about 7.5% at ≥ 30 and 19% at ≥ 32. Every 15 min of one-way commute costs 30 min of sleep. At commutes of 30 min or more, even the legal default leaves less than 7.5 h in bed.

**2. The forecast adds little to task ordering inside a legal shift ([C], `within_shift_legal.py`).** REL-excess is in °C-h per worker-summer, 6 clusters × 3 summers, mix 5 light / 6 moderate / 5 heavy half-hours:

| Shift | heavy-first rule | lead-1 raw (bias-corr.) | Gain | Perfect knowledge |
|---|---|---|---|---|
| L1 legal default 06:00-11:00 + 15:00-18:00 | 2,624 | 2,577 (2,591) | **1.8%** (1.3%) | 3.2% |
| L2 06:00-11:00 + 15:30-18:30 | 2,505 | 2,418 (2,432) | 3.5% (2.9%) | 5.1% |
| L3 06:00-10:30 + 15:30-19:00 | 2,385 | 2,245 (2,259) | 5.9% (5.3%) | 7.8% |

For L1, heavy-first vs random order is already a 10.2% cut (2,922 → 2,624). **The fixed rule captures most of what ordering can buy.** The forecast earns its keep elsewhere: deciding **tomorrow's ADOSH zone per hour**, and from that the rest cycles, acclimatisation limits, lone-work rules and stop-work. That is safety enforcement, not optimisation.

**3. Scope.** The roadmap gives the planner one day, and Judges ranks it 9th ("an obvious optimiser feature"). The demo-first planner is therefore a **rule planner plus an independent validator**. CP-SAT is should-have. The seasonal question is answered by the static analysis above and shown as one chart.

## Decision

### 1. Scope for 16-17 Nov
| Priority | Item |
|---|---|
| **MUST (16 Nov)** | **Rule planner** (§2) for a given shift and the day-ahead forecast: zone per hour from TWL (protective quantile − margin) with WBGT/NIOSH as a cross-check; ADOSH work/rest cycles with continuous-exposure caps across hour boundaries; the Art. 18 break inside every run that would exceed 5 h, with ban time not counted; the graded acclimatisation table; lone-work and unacclimatised rules; the stop-work rule. Worker and crew alerts (ADR 0004 Tier A) are generated from its zone timeline |
| **MUST (16 Nov)** | **Independent validator** (§3) that checks any plan (rule, CP-SAT, hand-edited, or a naive schedule) against the hard rules on rolling windows. It produces the planner's measurable value (§9) |
| **MUST** | Invariants: no added minutes; sign-off never gates alerts or a stop; unsigned day → rule plan labelled "unsigned"; employer-of-record scoping; k 10/5; floor banner; determinism. Pay-impact **display** (§7) |
| **MUST (static, 15-16 Nov, ~2 h)** | **Roster frontier chart** from `results/roster_frontier.json`: E30 vs sleep Pareto front, commute slider, B0 and B1 marked, the legalisation line. No service, no endpoint beyond serving the static JSON |
| **SHOULD (17 Nov, if MUST is green)** | **CP-SAT in-shift sequencer** (§5) with the corrected two-stage objective, per-tick variables, deterministic. Its demo value is the OPTIMAL / FALLBACK chip and the REL-excess delta vs heavy-first |
| **Cut / parked** | Seasonal scorer as a service; roster publication workflow; hysteresis/freeze/notice engine; edit-to-green anomaly flag; HSE second approver; the pay-block workflow; fairness, stability, shelter, pours, rotation constraints beyond the simple set; SS1-SS7 stability metrics (`docs/parking-lot.md`) |

### 2. Rule planner (MUST)
**Input:** one employer's crews on one site for one local day:
- the shift template (site input; validated against §4);
- tasks with workload class (light/moderate/heavy → M, ADR 0006), clothing, movability, `exempt_reason`;
- per-worker acclimatisation counters (days on site, days away, away reason) and a juvenile flag, both typed `Personal` (ADR 0010 §8);
- B2's calibrated quantiles at leads 1-3.

**Steps** (5-min ticks, deterministic, pure domain code):
1. **Zone per tick.**
   - TWL at the **protective quantile**: the lower TWL from the upper T/Td of the active `calibration_pair`.
   - Subtract `twl_margin_w_m2`, apply the ADR 0006 withdrawal-limit decision, then zone: Low ≥ 140, Medium 115-140, High < 115.
   - WBGT vs NIOSH REL(M) + clothing is computed alongside as a cross-check and shown. It does not loosen the ADOSH zone.
2. **Work/rest cycles.** ADOSH Table 1 per crew and workload class:
   - Low: self-paced, no imposed cycle. This is a **bound, not a pace**; an optional voluntary rest cycle is a tunable.
   - Medium: light = self-paced; heavy = 45 work / 15 rest.
   - High: light = 45 / 15; heavy = **20 / 40**.
   - Cycles are anchored at the shift start and run **across hour boundaries**. When the zone worsens, the current work segment is cut to the new cycle's work length and a full rest follows. When the zone eases, the current rest is completed before the lighter cycle starts. Rest is never shortened.
   - Each crew also gets a rolling 60-min cap: in any 60-min window, work ≤ the cap of the most severe zone touched in that window. Each continuous work run ≤ that cycle's work length. This answers Review I1.
3. **Art. 18 break.**
   - Any run of work + ADOSH rest that would exceed 5 h without an Art. 18 break gets a 1 h break, placed at the **hottest** hour of that run (protective-quantile WBGT), not the midpoint.
   - **Ban time never counts as the break** (ruleset switch `art18_ban_gap_counts_as_break = false`, class c).
   - **ADOSH cycle rest does not count as the Art. 18 break.** It is priced as paid working time (§7). Counsel Q1.
4. **People rules.**
   - No lone work in Medium/High (crew headcount on task ≥ 2).
   - No unacclimatised worker in Medium/High ticks.
   - Acclimatisation ramp share caps the worker's exposure minutes per day.
   - Heavy work only after 7 days for new or returning workers (protective end of CoP 3.2(b)(i) "5-7 days").
   - Juveniles: never on a template starting before 07:00 or ending after 19:00. ≤ 6 h, ≤ 4 h runs. Excluded from ban-season outdoor heat tasks by default.
5. **Ordering.** Heavy tasks go into the coolest available work ticks first (heavy-first by tick WBGT_q). This is the rule baseline that captures most of the ordering value.
6. **Stop-work.** All work stops in a tick when the B3 risk policy level is **Red** (POLICY: the probability band of the ruleset, ADR 0010 tunable range). Any tick in High zone for a crew that has no acclimatised members is unworkable. A crew lead can stop at any time. Stops are immediate and never wait for sign-off.
7. **Ban.** No outdoor work 12:30-15:00 (15 Jun-15 Sep) unless the task carries an attested `exempt_reason`. Exempt tasks still get every ADOSH rule and the AD 19/2023 Art. 11 duties checklist.

**Output:**
- A per-crew tick timeline (work / ADOSH rest / Art. 18 break / ban / stopped), with a clause citation per state.
- The uncertainty band, and the zone timeline that feeds Tier A alerts.
- Minutes of demand not done (SIMULATED productivity).
- REL-excess vs naive order, and a pay-impact block.

The rule planner is also the P-H12 **fallback** (no forecast, stale forecast, solver failure, unsigned day).

### 3. Independent validator (MUST)
A separate pure module that shares **no code path** with either planner except the ruleset loader and the zone function. Input: any plan + the zone timeline (forecast zones for "plan-time" validation; **truth zones** for back-test scoring). It checks:
- ban;
- rolling-60-min work caps and maximum run length per zone and workload class;
- Art. 18 (no run > 5 h without a 1 h non-ban break);
- normal hours ≤ 8 h/day and the weekly / 3-week totals (P-H2) given the site's days per week;
- lone work; unacclimatised in Medium/High; acclimatisation share; the 7-day heavy-work rule;
- juvenile rules; allowed task families; no added minutes vs the published shift.

It returns violations with a rule id, a clause and tick ranges. A plan with any violation at plan time is never shown as valid; a planner bug surfaces as a 500 problem plus an audit row, never as a silent pass.

### 4. Hard constraints (LAW unless marked)
| ID | Constraint | Value | Source | Scope |
|---|---|---|---|---|
| P-H1 | Midday ban | No outdoor work 12:30-15:00, 15 Jun-15 Sep; no resumption before 15:00; dated ruleset entry | MR 44/2022 Art. 3; WAM 2026 (MR 122/2026 status: counsel Q3) | Federal |
| P-H1a | Ban exemptions | Only with an attested `exempt_reason` + the Art. 11 duties checklist; never inferred | AD 19/2023 Art. 11 | Federal |
| P-H2 | Hours | Normal ≤ 8 h/day and ≤ 48 h/week; overtime ≤ 2 h/day at +25% (+50% 22:00-04:00 except shift workers); **total hours ≤ 144 per rolling 3 weeks (total, not overtime)**. On a 6-day week of 8 h, any overtime breaches the 144 h cap, so it is binding there. The 56 h shift-work average is ignored as less protective | Art. 17(1), 19(1)-(3); Exec. Regs. 15(3)-(4) | Federal |
| P-H3 | Art. 18 | No more than 5 consecutive hours of work without breaks of at least 1 h in total, not counted as working hours. **PROTECTIVE READING:** ban time is not credited (`art18_ban_gap_counts_as_break = false`); ADOSH cycle rest is not credited; at least 1 h of such break per working day | Art. 18; counsel Q1 | Federal |
| P-H4 | Weekly rest | ≥ 1 rest day in 7 (flag overrides) | Art. 21, 19(4)-(5) | Federal |
| P-H5 | Juveniles | ≤ 6 h; ≤ 4 h runs; no work 19:00-07:00 (so no template starting before 07:00); no overtime, weekends, official holidays, or being kept after hours; no arduous work (outdoor summer heat tasks excluded: PROTECTIVE READING, counsel Q6) | Art. 5(2)(c)-(f) | Federal |
| P-H6 | Ramadan | Normal hours −2 h/day, calendar rule | Exec. Regs. 15(2) | Federal |
| P-H7 | TWL zone work/rest | Table 1 cycles above; no lone work and no unacclimatised worker in Medium/High; fluid per hour; High-zone duties as checklist flags ("High Risk induction", personal 2 L bottle). Zoned on the protective quantile minus the margin | ADOSH Technical Guideline Table 1; CoP 3.2(e) | Abu Dhabi; applied as POLICY elsewhere and labelled so |
| P-H8 | Acclimatisation | **New:** 20/40/60/80/100%. **Experienced:** 50/60/80/100/100%. **Re-acclimatisation by days away (illness days):** < 4 → 100%; 4-5 (1-3) → "R/E*", undefined in the source, so we apply 80% then 100% [PROTECTIVE READING]; 6-12 (4-5) → 80, 100; 12-20 (6-8) → 60, 80, 100; > 20 (> 8) → 50, 60, 80, 100. "Unacclimatised" = new or off > 14 days; schedulable only in Low ticks (inference, ADPHC Q10). Heavy work only after 7 days (protective end of "5-7 days") | Technical Guideline §3, Table 1 notes; CoP 3.2(b)(i), 3.2(d) | Abu Dhabi |
| P-H9 | Task family | No assignment outside `allowed_task_families` | Art. 12; Exec. Regs. Art. 13 | Federal |
| P-H10 | No added minutes | A plan never schedules more work minutes per worker than the shift, and never extends the shift. Code invariant + hypothesis test | Product rule (Stakeholders H2) | — |
| P-H11 | Employer-of-record scoping | One employer's crews per plan; site windows from the principal contractor; no cross-employer rotation | Product rule (CoP 53.0 cl. 3.1.4-3.1.5, 3.3.5) | — |
| P-H12 | Fallback | Missing or stale forecast, solver failure, or no sign-off → the rule plan; never less protective than the ban | Product rule (ADR 0006) | — |

**Flags, not constraints:** lifting tasks in hours with a forecast gust ≥ 38 km/h (CoP 34.0 cl. 3.6.6); Friday 12:30-13:30 critical tasks outside the ban season; bus departure before 05:00 (CoP 25.0, drivers), which is flagged on the **bus departure**, not the work start.

### 5. CP-SAT in-shift sequencer (SHOULD)
**Instance:** one employer, one site, one day, the frozen shift, **5-min ticks** (≤ 108), crews ≤ ~10, tasks ≤ ~20. Inputs are sorted by stable id before the model is built.

**Variables:**
- `work[c,t] ∈ {0,1}`, `on[c,j,t] ∈ {0,1}` (with `Σ_j on[c,j,t] = work[c,t]`), `brk[c,t] ∈ {0,1}` (Art. 18).
- `u[j] ≥ 0`: unmet 5-min units of task `j`; tasks are flagged `must_do | deferrable`.
- Interval variables for fixed-duration tasks (full set only).

**Hard constraints:**
- `work = 0` in ban ticks unless exempt, and in rule-planner Stop ticks.
- **Sliding windows:** for every crew and every 12-tick window, `Σ work ≤ cap(window)`, where cap is the most severe zone's work minutes for the crew's heaviest task class in that window. Every run of consecutive work ticks ≤ the cycle work length (via `AddAutomaton` or forbidden k+1-runs). This replaces v1's per-clock-hour caps (Review I1).
- Art. 18 run limit with `brk` ticks (no ban credit).
- No lone work and no unacclimatised worker in Medium/High; acclimatisation caps.
- `Σ_t work[c,t] ≤ shift_ticks(c) − mandatory breaks` (P-H10).
- Allowed task families; juvenile rules.

**Objective, lexicographic, corrected per Review C4:**
1. **Stage 1:** minimise `Σ_{j ∈ must_do} u[j]`. Safety is already bound by the hard constraints.
2. **Stage 2:** with stage 1 fixed at its **incumbent** value, minimise strain `Σ on[c,j,t] · ⌈100 · max(0, WBGT_q(t) + clo(j) − REL(M_j))⌉`.
3. **Stage 3:** with stage 2 fixed at its incumbent, minimise deferrable unmet work, then deviation from the previous accepted plan (weight tunable).

When a stage stops FEASIBLE at its limit, the next stage fixes the **incumbent** and the gap is recorded (Review M4). Tested: the stage-1 plan never schedules less must-do work than the rule plan on the same instance. For a single crew with no side constraints and all work done, stage 2 equals the exact assignment (`within_shift_legal.py` logic): this is the oracle test.

**Parameters** (names verified in `sat_parameters.proto`):
- `num_workers = 1` ("A number of 1 means no parallelism"; `num_search_workers` is deprecated).
- `random_seed = 20261111` (code constant).
- `max_deterministic_time = 2.0` per stage (tunable, range [0.5, 10]), **not** `max_time_in_seconds`, because a wall-clock stop depends on machine load.
- `max_time_in_seconds = 10` as a backstop. If the backstop fires, the plan is `reproducible=false` and the rule plan is offered alongside it.

Every CP-SAT output passes the §3 validator before it is shown. Same instance + ruleset + config version + `ortools` version ⇒ byte-identical plan. Decision rows record status, objective, bound and deterministic time per stage.

### 6. Seasonal roster question: static analysis only
- **What ships:** `legal_sleep_templates.py` v2 → `results/roster_frontier.json`, copied into the demo snapshot by an exporter. It is one chart. There is no scorer service, publication flow, hysteresis engine or endpoint.
- **The chart:** E30 per worked hour (REAL climatology, 6 clusters) vs sleep opportunity. It shows the Pareto front for the selected commute (15-90 min slider), with B0 "common practice, not compliant" and B1 "legal default" marked, and a legalisation arrow (−7.5% at ≥ 30, −19.1% at ≥ 32). The caption states the [I] bedtime floor (21:30) and buffers.
- **Do-no-harm guard** (code, class d, for any future roster recommender and for the chart's "recommended" marker): never mark a template recommended if its climatological E28, E30 or E32 per worked hour exceeds the current legal roster's. With no such template, the output is "no change recommended; binding constraint: commute X min / sleep gate Y h".
- **Night templates:** shown greyed with "not eligible: permit, day-sleep accommodation, premium position, juvenile exclusion".
- **Stability rules** (≤ 1 change a month, 7-day freeze, 14-day notice, ≤ 30-min steps, exposure-reducing changes exempt from the caps and the notice) are kept as **POLICY text** for a future recommender, parked, not built.

### 7. Safeguards (invariants are class d, with tests)
1. **Sign-off never gates safety.** Tier A alerts, Red escalation and crew-lead stop are independent of plan sign-off. An unsigned day shows crews the rule plan labelled "unsigned fallback". Sign-off records a named supervisor of the employer of record. One-tap accept is allowed only when the plan has no change from the last accepted plan and no Medium/High work; otherwise the supervisor acknowledges each changed or Medium/High item, and a deviation needs a reason code.
2. **No added minutes** (P-H10) and the banner on every plan view: "Green is not permission to extend work. Legal and ADOSH minimums still apply. Advisory only; the employer remains the duty-holder."
3. **Pay impact is displayed, never a gate.** Per crew the display shows:
   - paid hours, overtime and the night-premium position vs B0 and B1;
   - the unpaid day span;
   - **ADOSH cycle rest and heat stops, priced as paid working time** (Art. 26(1) reading; counsel Q5);
   - the B0 → B1 legalisation effect: 8.5 → 8 h loses 0.5 h of overtime, about 7.2% of daily pay at +25% [C: 0.625 / 8.625].

   Nothing in the planner may block, delay or require attestation for an exposure-reducing change, a stop or a day plan.
4. **Input-change audit:** every edit to a protection-relevant input (workload, clothing, shade, acclimatisation counters, exempt flag, movability, station mapping, shift template) is an append-only row with before, after, actor and reason. The anomaly flag and the HSE second approver are parked.
5. **Employer scoping** (P-H11) in the data model, RBAC and exports.
6. **k-anonymity by data class:** `k_health` (default and floor 10) and `k_exposure` (default and floor 5), suppressed at site-week or employer level with complementary suppression. These replace ADR 0010's single `k_suppression` additively in `ae-heat-2026.1`.
7. **Data minimisation:** acclimatisation counters and the juvenile flag are typed `Personal` and can never reach an LLM route (ADR 0010 §8). No physiology, GPS or camera input. No export joins stop events or adherence to a named worker. The PDPL basis is employment/contract, not consent. The planner has no LLM, and the shift-plan drafter stays cut.

### 8. Runtime-tunable vs floor (ADR 0010 classes)
| Class | Items |
|---|---|
| **(c) floor, ruleset file** (LAW + PROTECTIVE READINGS) | P-H1-P-H9 values: ban window, dates and exemptions; 8/48 h, overtime 2 h, 144 h/3 wk total; Art. 18 5 h / 1 h and `art18_ban_gap_counts_as_break = false`; weekly rest; juvenile rules; Ramadan; Table 1 cycles, fluid and duties; the acclimatisation table, 14-day definition and 7-day heavy-work rule; k floors 10/5 |
| **(b) tunable within a range** (POLICY values; out-of-range → `policy-bound-violation`, wording "policy benchmark", distinct from `floor-violation`) | Sleep gate (7.5, [7.0, 9.0]); bedtime floor for the chart (21:30, [20:30, 23:00], safer = later); rest interval (11 h, [11, 16]); bus-departure flag (05:00); Red probability band (ADR 0010); voluntary Low-zone rest; `planner_det_time_s` (2.0, [0.5, 10]); stage-3 weight; `k_health` ≥ 10; `k_exposure` ≥ 5; flag `planner_cpsat_enabled` (default false until the SHOULD lands) |
| **(d) code** | No added minutes; sign-off never gates alerts or a stop; unsigned → rule plan; do-no-harm guard; rest never shortened on a zone change; lexicographic order; `num_workers = 1`; seed; validator independence; fallback never weaker than the ban |
| **Site data** (audited input, not config) | Shift template, days per week, commute and bus wait, crews, tasks (workload, clothing, movability, exempt reason), acclimatisation counters, juvenile flag, cooled-shelter capacity, station mapping |

### 9. The planner's own measurable value (B3 metrics, held-out 2026, REAL weather + SIMULATED crew)
Scored with the §3 validator against **truth zones** (station-obs TWL/WBGT, ADR 0005 A2), on L1 and the B0 common roster, for one assumed crew mix:
1. **Hard-rule violation minutes per worker-season.** Compare: (a) a **naive schedule** (work every shift minute outside the ban); (b) the ban-only policy; (c) the rule plan from the **raw** IFS forecast; (d) the rule plan from the **corrected protective quantile**. Headline: the share of truth-High heavy-work minutes that the plan would have cycled 20/40.
2. **Compliance rate of plans:** the share of worker-days with zero truth-zone violations, (a)-(d) above.
3. **Missed stop-work / under-protected hours:** truth-High or Red ticks that the plan scheduled at a lighter cycle. POD/FAR per zone, using the same scoring as the Judges scoreboard.
4. **Cost of protection:** rest minutes added vs naive (SIMULATED productivity), and paid-time impact.
5. **Ordering:** REL-excess vs heavy-first (expect 1.3-1.8% on L1, §Context table). Reported, not headlined.
6. **Engineering:** validator pass = 100% on every shown plan; determinism; solver status mix; wall p95 ≤ 3 s.

Pre-register these with the Judges evaluation protocol (12 Nov) before B3 scores 2026.

### 10. Layers evaluated and rejected (Feasibility, 8.5 h exposure-only library; still valid as horizon comparisons on that library)
| Layer | Result | Verdict |
|---|---|---|
| Weekly re-roster from IFS day 1-7 forecasts | vs fixed seasonal: +0.1% raw / 0.0% bias-corrected at ≥ 30; −1.0% / −1.1% at ≥ 32. Below the ~4 h/summer noise floor; about 10 changes per summer | **Rejected** |
| Weekly, perfect knowledge (ceiling) | −0.7% (≥ 30), −4.8% (≥ 32); 0 vs 19 changes per summer = 498 vs 495 h | Ceiling too low to fund the instability |
| Daily re-roster, lead-1 | −0.2% / −2.0%; with night shifts in the library, +4.3% (worse) | **Rejected** |
| Sub-seasonal (EC46, GEFS, CFSv2) | No back-testable open archive (Open-Meteo seasonal `past_days` keeps 32 days); weekly WBGT-anomaly autocorrelation 0.22 at lag 1, ~0 at lags 2-3; GEFS control-only back-test ≈ 20,000 range requests / 4 GB | **Rejected** for decisions |
| Seasonal recommender as a service | Under legal hours, the sleep model and the guard: no change in 18/18 folds at commutes ≥ 30 min (§Context). Static chart instead | **Cut** (parked) |

Whether "fixed ≈ adaptive" also holds on the legal library is **untested [I]**. The legal library's fixed-roster gain is itself ≈ 0, so the question is moot for the demo.

### 11. Pitch framing (Review I9)
> "Under UAE law and a realistic night's sleep, no roster shape outruns the heat. Making today's common 8.5-hour roster legal removes about 7.5% of the hottest-hour exposure at WBGT ≥ 30 °C and 19% at ≥ 32 °C. That is more than any start-time optimiser, and every 15 minutes of bus ride costs half an hour of sleep. So we hold the roster fixed and spend the forecast where it pays: tomorrow's ADOSH zone for every hour, the 20/40 and 45/15 rest cycles, acclimatisation and no-lone-work rules for each crew. Each plan is checked by an independent validator and scored on a summer we never tuned on: ⟨violation minutes prevented vs the ban alone⟩, ⟨share of truth-High heavy minutes cycled⟩."

The ⟨⟩ slots are filled only by §9 output.

### 12. Open legal questions (counsel), and one for ADPHC
1. Does the ban gap count as the Art. 18 break? Does ADOSH cycle rest count? Is the 1 h tied to each 5 h run or to the day?
2. Is changing start times, or moving to a split or evening pattern, a contract variation needing worker approval (Exec. Regs. Art. 10(1), 10(3))? What notice is lawful?
3. Is MR 44/2022 Art. 3 still in force after MR 122/2026? Is MoHRE 2023's "8 h across morning and evening shifts" still policy?
4. Who is a "shift worker" under Art. 19(3), so that the night premium would not apply?
5. Are ADOSH cycle rest and employer-ordered heat stops paid working time (Art. 18 "not included in the working hours" vs Art. 26(1))? Does an NCM heat warning make commute time working time (Exec. Regs. 15(1))?
6. Is outdoor summer heat work "arduous" for juveniles (Art. 5(2)(e))?
7. Does rotating crews across tasks need written consent (Art. 12)?
8. Where does the tool provider's liability sit? Does Federal Law 2/2019 reach health-adjacent planner data? Do free-zone sites need a separate regime?
9. Do exempt-category duties (AD 19/2023 Art. 11) require regulator notice?
10. **ADPHC:** are ramp days restricted to Low-zone hours, and what does "R/E*" mean in the re-acclimatisation table?

## Review findings: disposition
| Finding | Disposition |
|---|---|
| C1 bedtime | Accepted. Clock-time sleep with a bedtime floor ([I], tunable, safer = later); P-S3 is now a gate (bus departure ≥ 05:00 flag). Numbers in Context |
| C2 baseline | Accepted. Two baselines (B0 common, non-compliant; B1 legal default); legalisation reported separately (7.5% / 19.1%) |
| C3 do-no-harm | Accepted. Guard is a class (d) rule; output "no change; binding constraint". It fires in 18/18 folds at commutes ≥ 30 min (gate 7.5 h, floor 21:30) |
| C4 objective | Accepted. Stage 1 unmet must-do work, stage 2 strain, stage 3 stability; oracle and no-less-work tests |
| C5 scope | Accepted, per the architect's direction: rule planner + validator MUST; CP-SAT SHOULD; seasonal layer static |
| I1 cycles | Accepted. Cycles span hours; rolling 60-min caps and run limits in the planner, validator and CP-SAT |
| I2 Art. 18 | Accepted with one **disagreement**. The Review's strict filter rejects any gap that overlaps 12:30-15:00 at all. We credit the **non-ban part** of a gap (for example, 11:00-12:30 in B1). The law prohibits work in the ban window; it says nothing to make adjacent non-ban rest stop being rest, so the open question is only whether ban minutes count. Under the Review's strict filter no template survives a 21:30 floor, which would make even the legal default illegal on a reading the text does not require. The switch is in the ruleset, the protective default does not credit ban time, and counsel Q1 settles it. Breaks go at the hottest hour. "≥ 1 h per day" is labelled PROTECTIVE READING |
| I3 labels | Accepted. P-H2 corrected (144 h is total hours); "overtime = 0" removed from hard rules; benchmarks moved to (b) with `policy-bound-violation` |
| I4 numbers | Accepted. All superseded numbers flagged; G5-type gates included in the v2 scenarios (`…_output.txt`); Feasibility erratum added |
| I5 in-shift | Accepted. Legal-shift numbers 1.3-5.9%; the rule planner is the default |
| I6 acclimatisation | Accepted. Full graded table + 7-day heavy-work rule |
| I7 pay | Accepted. Display only; ADOSH rest and stops priced as paid; never blocks |
| I8 sign-off | Accepted. Class (d) invariant + unsigned fallback |
| I9 pitch | Accepted. §11 |
| M1 | Moot (anomaly flag parked) |
| M2 | Blocks < 2 h excluded in the generator |
| M3 | Juvenile eligibility rule in P-H5 |
| M4 | Incumbent fixing |
| M5 | Low zone is a bound |
| M6 | Duties as flags |
| M7 | AT uses a committed fixture subset (B3 notes) |
| M8 | Bus-departure flag |

## Conflicts between the research docs, resolved
| # | Conflict | Resolution |
|---|---|---|
| 1 | Feasibility's 8.5 h exposure-only optimum vs Art. 17/18 and sleep | Legal library + clock-time sleep + guard; the seasonal gain over the legal default is ≈ 0-10% at ≥ 30 and depends on an [I] bedtime |
| 2 | Earliest start: Stakeholders 06:00; Feasibility 04:30; Sleep < 07:00 penalty | Moot for the roster (no early-start template survives sleep + guard). Bus departure < 05:00 is a flag |
| 3 | Weekly adjustments (Stakeholders) vs no weekly re-roster (Feasibility) | Shift-time changes rejected; weekly task assignment and acclimatisation ramps happen daily inside the shift |
| 4 | Heat-stop pay: Sleep (Art. 26(1), paid) vs Stakeholders (unverified) | Priced as paid, display only; counsel Q5 |
| 5 | k = 5 (roadmap) vs 10/5 (Stakeholders) | 10 health / 5 exposure |
| 6 | Judges cut all LLM agents vs ADR 0010 keeping the compliance drafter | ADR 0010 governs; the planner has no LLM; the drafter sees only k-suppressed aggregates |
| 7 | Night work: best exposure vs sleep, permit and premium | Shown on the chart as ineligible without attestations; parked |
| 8 | "Delay" listed as heat-reducing (Sleep §6.3) | Not exposure-reducing in the morning; stop, shorten, rest and shade are |
| 9 | Plan §8.5 "plan against the upper quantile" untested | Kept (protective quantile); §9 metric 3 measures it |

## Not doing now
Everything listed as "Cut / parked" in §1, plus the items already parked in v1. See `docs/parking-lot.md` for triggers.

## Consequences
- The planner's value is **measurable safety enforcement** (§9), not an optimiser gain. That is distinctive because the obvious entries claim optimiser gains.
- `ae-heat-2026.1` gains `[labour]` (P-H1-P-H9, the Art. 18 switch, the acclimatisation table) and `[planner]` / `[privacy]` sections, plus the §8 tunables (additive; floors carry `Floor` comparators).
- B3 effort: MUST ≈ 1 day (16 Nov); SHOULD ≈ 0.5-1 day (17 Nov, only if MUST is green). Roadmap updated.

## Decisions Ali must make
1. Accept the scope cut: rule planner + validator MUST, CP-SAT SHOULD, seasonal question static.
2. The chart's default bedtime floor (21:30 recommended, [I]). It moves the residual shape gain from 0% to 10% at ≥ 30, so the pitch quotes only the robust numbers (legalisation, the commute rule, "no shape outruns the heat").
3. Accept the Art. 18 protective reading (ban time not credited; non-ban part of a gap credited; ADOSH rest not credited) pending counsel. It differs from the Review's stricter filter.
4. Accept k = 10/5.
5. Whether to brief counsel on Q1, Q3 and Q5 before the deck claims the legal default is "legal".

## Revisit trigger
Counsel answers §12; a pilot supplies commute, sleep-diary and timesheet data (calibrate the floor and buffers); §9 shows the rule plan does not reduce truth violations vs the ban-only policy; a sub-seasonal archive becomes back-testable; shoulder-season replication.

## Amendments
- **2026-11-11 (status: Accepted, v2; text unchanged):** Ali accepted v2 in chat (roadmap "Decisions recorded 2026-11-11"): decision 1 (MUST rule planner + independent validator + 2026 plan back-test; SHOULD CP-SAT, dropped 17 Nov 15:00 if MUST is not green); decision 2 (bedtime floor 21:30, labelled an assumption); decision 3 (Art. 18 protective reading behind a ruleset switch, listed as an open question); decision 4 (k = 10/5); decision 5 (no counsel before 20 Nov; the deck says "our reading of Art. 18, open question listed"). The cuts and parks are recorded as ADR 0022-0026; the superseded v1 numbers as ADR 0033.
