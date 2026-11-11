# ADR 0011: Heat-aware shift planner: a gated seasonal roster scorer plus a day-ahead/in-shift advisor

- **Status:** Proposed (2026-11-11), for Ali's acceptance. Builds on ADR 0002 (planner runs inline, no queue), 0004 (crew relay, worker stop signal), 0005 (station truth, held-out design), 0006 (TWL zones, NIOSH REL, bias margin), 0007 (calibrated quantiles), 0008 (OR-Tools 9.15.6755 CP-SAT), 0009 (rulesets as data) and 0010 (runtime tunables vs floors; LLM data classes).
- **Evidence:** `docs/research/2026-11-11-shift-regulations-and-sleep.md` (cited "Sleep"), `docs/research/2026-11-11-roster-feasibility.md` ("Feasibility"), `docs/research/2026-11-11-roster-stakeholders-and-compliance.md` ("Stakeholders"), `docs/research/2026-11-11-judges-and-wow-moment.md` ("Judges"). **New computation for this ADR:** `docs/research/scripts/roster/legal_sleep_templates.py`, outputs `results/legal_sleep_templates{.csv,_frontier.csv,_output.txt}` (run 2026-11-11 on the Feasibility `hourly_wbgt.parquet`; baseline exposures reproduce Feasibility's `ladder.csv` exactly, e.g. OMAA 2024 E28/E30/E32 = 1,011.5 / 791.0 / 484.5 h). CP-SAT parameter names checked today against `ortools/sat/sat_parameters.proto` on the `stable` branch.
- **Labels used below.** **LAW** = a UAE federal or Abu Dhabi legal/regulatory rule, quoted in Sleep §1-3 or Stakeholders. **BENCHMARK** = a policy value taken from EU/HSE/Oregon/AASM/ILO practice. **It is not UAE legal compliance and the product must never call it "compliance".** **[C]** = computed. **[I]** = inference, uncalibrated.

## Context
Plan §8.5 framed the planner as one CP-SAT model choosing "which hour each task runs in, the work-rest ratio, and rotation". Ali's revision split it into horizons (seasonal roster, weekly adjustment, daily in-shift changes). Three research passes tested that framing. The short answer is that the seasonal and in-shift layers survive, the weekly and sub-seasonal layers do not, and **the seasonal layer's headline gain mostly disappears once the roster has to be legal and sleep-compatible.** That last finding is new in this ADR and changes how the planner is pitched.

### The finding that changes the design (new, [C])
Feasibility's headline (fixed seasonal roster avoids 34.6% of worker-hours at WBGT ≥ 30 and 58.0% at ≥ 32, captured 96% of the daily perfect-knowledge bound) scored rosters on **exposure only, at 8.5 h/day**. The optimum it found, 04:30-10:00 + 16:30-19:30, breaks three constraints from the other two docs:
- **8 h normal hours (LAW, Art. 17(1); MoHRE 2023: more than 8 h across morning and evening shifts is overtime).** 8.5 h means daily overtime.
- **No run longer than 5 h without at least 1 h of breaks (LAW, Art. 18).** 04:30-10:00 is a 5.5 h run.
- **Sleep opportunity (BENCHMARK, Sleep S1: ≥ 7.5 h in bed = AASM 7 h + 30 min latency).** Wake 03:00 for a 04:30 start with a 45-min commute and 45 min prep. Last work ends at 19:30, home 20:15, then a 2 h evening buffer gives bed at 22:15. That is **4.75 h** in bed. The midday gap is not credited as sleep (no evidence in the three docs supports crediting it).

I regenerated the template library under the legal rules: 8.0 h work, no work 12:30-15:00, no run over 5 h (an unpaid 1 h break is inserted in any block longer than 5 h), starts 04:30-08:00, ends ≤ 19:30 (day) or ≤ 22:00 (evening), 405 templates. I then re-ran Feasibility's leave-one-summer-out seasonal choice under sleep gates. The table shows the share of exposure per worked hour avoided vs the 06:00-12:30 + 15:00-17:00 baseline, averaged over 4 headline stations × 3 summers (the 6-cluster means are within 2 points):

| Gate on the template | ≥ 28 | ≥ 30 | ≥ 32 | Typical chosen template |
|---|---|---|---|---|
| Legal only, day library | 20.0% | 41.3% | 66.8% | 04:30-09:30 + 16:30-19:30 (sleep 4.75 h) |
| Legal only, + evening to 22:00 | 29.2% | 59.5% | 89.0% | 04:30-09:00 + 18:30-22:00 (sleep 2.25 h) |
| **Sleep ≥ 7.5 h, 45-min commute** | **11.5%** | **16.1%** | **17.2%** | 04:30-08:00 + 09:00-12:30 + 15:30-16:30 |
| Sleep ≥ 7.0 h, 45-min commute | 10.2% | 18.8% | 25.1% | 04:30-08:00 + 09:00-12:30 + 16:00-17:00 |
| Sleep ≥ 7.5 h, 45 min, start ≥ 06:00 | 2.0% | 7.5% | 19.1% | 06:00-11:00 + 15:00-18:00 |
| Sleep ≥ 7.5 h, **90-min** commute | −10.5% | −14.5% | −14.3% | 07:30-12:30 + 15:00-18:00 (no template beats the baseline, which itself gives only 7.25 h) |

The sleep formula depends only on the day span plus 2 × commute, so **every 15 min of one-way commute costs 30 min of sleep opportunity**. Shortening the evening buffer by 1 h has the same effect as cutting the commute by 30 min each way. The frontier file has the curve for commutes of 30-90 min and gates of 5-9 h. The prep, buffer and 7.5 h values are [I] defaults from Sleep §6.2.

**Consequences for the design.** (1) The seasonal layer is a **trade-off explorer**, not an optimiser with one right answer. Exposure, sleep, pay and transport trade against each other, and the employer decides with the trade-off visible. (2) The commute and the camp (Sleep §0.4: "Sleep quality is dominated by things the roster cannot set") are levers worth as much as roster shape. The explorer must show them. (3) The pitch must not quote 34.6% / 58.0% without the gate it assumed. The honest seasonal claim is a range: about 16-25% at ≥ 30 for a sleep-compatible roster with a 45-min commute, and 41% if sleep is ignored.

## Decision

### 1. Two layers, and what each may change
| | **Layer S: seasonal roster scorer** | **Layer D: day-ahead and in-shift advisor** |
|---|---|---|
| Decides | Which fixed roster template each site/employer runs, recommended per season or month | Inside the frozen roster: task order per 5-min tick, work/rest per ADOSH zone, break timing, crew-to-task assignment within the employer, stop-work escalation |
| Inputs | Station climatology (hourly obs WBGT/TWL, all prior summers; LOSO in evaluation), site profile, ruleset floors, tunables | Post-processed forecast quantiles (ADR 0007) at leads 1-3 → WBGT and TWL at the **protective quantile** (upper WBGT / lower TWL of the active `calibration_pair`), zoned on TWL minus `twl_margin_w_m2` (ADR 0006); crews, tasks, acclimatisation counters, shelter capacity |
| Method | **Enumerate and score**, no solver: 136-405 templates × hours is an exact argmin in milliseconds (Feasibility §4: "no solver needed") | **CP-SAT** (§5), because tasks have deadlines, dependencies, crew size, acclimatisation, lone-work and shelter-capacity constraints. For a single crew with no side constraints the exact assignment from `within_shift.py` is the test oracle |
| Shows per option | E28/E30/E32 per worker-season, NIOSH-REL excess, sleep opportunity at the site's commute, earliest bus departure, day span (unpaid), paid hours and overtime vs baseline, night minutes and premium status, pre-06:00 starts, split-shift second bus run, permit flag | Zone timeline, binding rule and clause per action, uncertainty band, minutes of work lost vs demand (SIMULATED productivity), REL-excess vs the heavy-first rule |
| Change rules | Hysteresis (§3) | May only **reduce** exposure inside the frozen roster. It never adds minutes or moves work outside the published window |

**Night shifts** are scored and shown in Layer S (Feasibility: fixed night shift avoids 75.0% / 98.1% at ≥ 30 / ≥ 32 in the 8.5 h library). They are **not recommendable** unless the employer attests to a noise/work permit (Stakeholders §3.3), day-sleep-ready accommodation (blackout, room allocation, AC: ADOSH CoP 25.0 cl. 3.5(c)), juvenile exclusion and the night-premium position (Art. 19(3) shift-worker exclusion). Without the attestations the explorer lists them as "not eligible: <reasons>". Modelling night work beyond this is parked.

### 2. Hard constraints (never relaxed by any tunable, input or override)
| ID | Constraint | Value | Source | Scope |
|---|---|---|---|---|
| P-H1 | Midday ban | No outdoor work 12:30-15:00, 15 Jun-15 Sep; no resumption before 15:00. Dated ruleset entry | LAW MR 44/2022 Art. 3; WAM 2026 (MR 122/2026 status open, §8) | Federal |
| P-H1a | Ban exemptions | Only with an attested `exempt_reason` per task (concrete/asphalt that cannot wait, hazard and utility repair, 24 h permit work) and the AD 19/2023 Art. 11 duties checklist. Never inferred from task type | LAW AD 19/2023 Art. 11 | Federal |
| P-H2 | Normal hours | ≤ 8 h/day, ≤ 48 h/week. **Planned overtime = 0 in the ban season** (Sleep S9). Overtime ≤ 2 h/day and ≤ 144 h per rolling 3 weeks is the outer legal cap (the 56 h shift-work average is ignored as less protective) | LAW Art. 17(1), 19(1); Exec. Regs. 15(3)-(4) | Federal |
| P-H3 | Runs and breaks | No work run over 5 h; ≥ 1 h breaks per day, not counted as work. The ban gap does **not** count as the break until counsel says otherwise | LAW Art. 18 | Federal |
| P-H4 | Weekly rest | ≥ 1 rest day in any 7; overrides flagged and audited | LAW Art. 21, 19(4)-(5) | Federal |
| P-H5 | Juveniles 15-17 | ≤ 6 h; ≤ 4 h runs; no work 19:00-07:00; no overtime or weekends; excluded from ban-season outdoor heat tasks by default (arduous-work reading, for counsel) | LAW Art. 5(2) | Federal |
| P-H6 | Ramadan | Normal hours −2 h/day, calendar-driven (does not overlap the heat season before about 2040) | LAW Exec. Regs. 15(2) | Federal |
| P-H7 | TWL zone work/rest | Low ≥ 140: self-paced, no cap. Medium 115-140: heavy 45 work/15 rest per hour; no lone work; no unacclimatised worker. High < 115: light 45/15, heavy 20/40; no lone work; no unacclimatised worker. Fluid per Table 1. Zoned on the protective quantile minus the margin | LAW ADOSH Technical Guideline Table 1; CoP 3.2(e) | Abu Dhabi; applied as BENCHMARK elsewhere |
| P-H8 | Acclimatisation | New 20/40/60/80/100%; experienced 50/60/80/100/100%; > 14 days away resets. Unacclimatised workers are schedulable only in Low-zone hours (inference, for ADPHC) | LAW Technical Guideline §3; CoP 3.2(b)(i), 3.2(d) | Abu Dhabi |
| P-H9 | Cooled shelter | Workers on rest in any tick ≤ the site's cooled-shelter capacity | LAW CoP 3.2(b)(vii), 3.2(i) | Abu Dhabi + federal |
| P-H10 | Task family | No rotation outside a worker's `allowed_task_families` (contract work) | LAW Art. 12; Exec. Regs. Art. 13 | Federal |
| P-H11 | **No added minutes** | A plan never schedules more work minutes per worker than the published roster, and the roster never more than the employer's baseline. Code invariant + hypothesis property test | Stakeholders H2; HRW 2026 | Product rule |
| P-H12 | **Employer-of-record scoping** | A plan covers one employer's crews; the principal contractor publishes site windows (lifts, pours, access); no cross-employer rotation | Stakeholders H4; CoP 53.0 cl. 3.1.4-3.1.5, 3.3.5 | Data model |
| P-H13 | Fixed-duration pours | Pours are non-interruptible intervals; only start, crew size and relief rotation vary | Stakeholders H7; CoP 38.0 cl. 3.3(a)(ix) | Should-have |
| P-H14 | Fallback | No forecast, stale forecast or no solver solution → the conservative rule plan (heavy-first ordering, zone work/rest from the protective quantile, never less protective than the ban) | ADR 0006; roadmap B3 property test | Product rule |

**Flags, not constraints:** lifting tasks in hours with a forecast gust ≥ 38 km/h (CoP 34.0 cl. 3.6.6; the forecast is not the "recorded" wind the code means); a Friday 12:30-13:30 critical task outside the ban season (prayer at 12:45 since 2 Jan 2026).

### 3. Soft costs and policy gates (BENCHMARKS, labelled "policy, not legal compliance")
Layer S ranks templates **lexicographically**, not by weighted sum: (1) pass all hard constraints; (2) pass the policy gates; (3) minimise severity E28 + E30 + E32 (Feasibility's pick rule); (4) tie-break on fewer pre-06:00 starts, then a shorter day span. Gates are per-site tunables, so the trade-off is a visible employer choice rather than a hidden weight.

| ID | Gate or cost | Default | Range (less protective end pinned) | Source |
|---|---|---|---|---|
| P-S1 | Sleep opportunity gate (night window only) | ≥ 7.5 h | [7.0, 9.0] | BENCHMARK AASM/SRS 2015 + latency; Sleep S1 |
| P-S2 | Minimum interval end → next start | ≥ 11 h | [11, 16] | BENCHMARK EU WTD Art. 3; HSE |
| P-S3 | Earliest start | Flag and cost below 06:00; below 05:00 needs a reason + HSE second approver | site value ≥ 04:30 | BENCHMARK Kecklund & Åkerstedt 1995; HSE; CoP 25.0 "avoid departures before 5am" (drivers) |
| P-S4 | Night / early run length | ≤ 3 consecutive pre-06:00 or night starts, then rest; 2 nights' sleep on a day/night switch | fixed | BENCHMARK HSE |
| P-S5 | Split shift | Shown with its second bus run and unpaid day span | cost only | BENCHMARK HSE; vendor note |
| P-S6 | Consecutive days | ≤ 6, prefer 5 | [5, 6] | BENCHMARK HSE; van Selm 2026 |
| P-S7 | Fairness (Layer D) | Rolling 14-day spread of exposed minutes within employer × task-equivalence class, minimised | weight tunable | Stakeholders S3; Art. 4(1) |
| P-S8 | Stability vs previous accepted plan (Layer D) | Penalty per changed task-slot; previous plan as a CP-SAT hint | weight tunable | Feasibility §4 (hints are documented, not binding) |

**Stability rules (Layer S), also BENCHMARKS:**
- **Pre-season adoption** (for example, baseline to the chosen template before 15 Jun) is one announced change. It needs ≥ 14 days' notice and a worker briefing. The 30-min drift cap does not apply to it, but it is flagged as a possible contract variation (§8).
- **In-season change**: at most **1 per calendar month**; a **≤ 30 min** start or end move per step; **≥ 14 days' notice** (floor 7); recommended only when the new template beats the current one by more than the **noise floor** (default 4 worker-hours per worker-summer, pro-rated to the remaining season; Feasibility §2.3 sensitivity: rounding SD 1.2-3.1 h, radiation source 0.1-4.7%).
- **Freeze**: the published roster is frozen for **7 days**. Inside the freeze only **exposure-reducing** changes are allowed: stop, shorten, extra rest, move to shade or indoors. **Correction to Sleep §6.3:** a "delay" is not exposure-reducing in the morning, so it is a normal change that needs notice. A Red escalation or a crew-lead stop is always immediate (ADR 0010 invariant).
- **Metrics** (Sleep SS1-SS7): notice lead time, drift, plan churn ≤ 5% of worker-days (reason codes `heat_reduction`, `emergency`, `absence`, `client_change`), wake-time SD ≤ 30 min over 14 days, pre-06:00 starts per 7 days, acclimatised-pool coverage ≥ 1.0 in every Medium/High hour.

### 4. Safeguards
1. **No added hours** (P-H11) and no "extra window" output. Cumulative daily and 3-week hours are shown against the legal caps.
2. **Green ≠ permission.** Banner on every plan screen: "Green is not permission to extend work. Legal and ADOSH minimums still apply. Advisory only; the employer remains the duty-holder." The banner is a template code, with a test that every plan view renders it.
3. **Input-change audit + anomaly flag.** Every edit to a protection-relevant input (workload class, clothing/PPE, shade, acclimatisation counters, exempt flag, movability class, station mapping, commute, shelter capacity) is logged append-only with before/after, actor and reason. An edit that makes the plan **less protective** needs an HSE second approver. **Anomaly flag ("edit-to-green"):** when a protection-lowering edit lands within 24 h before a sign-off and changes the recommended zone, rest minutes or eligibility of that plan, the plan carries a visible flag. The flag goes into the inspector evidence pack, and the per-employer rate (k-suppressed) is reported to HSE.
4. **Sign-off that requires review.** A named supervisor of the employer of record signs before crews see a plan. One-tap accept is allowed only when the plan has no change from the last accepted plan and no Medium/High-zone work. Otherwise the supervisor must open the change list and acknowledge each changed or Medium/High item; a deviation needs a reason code. Time-to-sign-off and acceptance rate are reported to HSE as rubber-stamp indicators. Any crew lead can stop work without approval. Workers keep self-pacing; plans are bounds, not pace.
5. **Pay neutrality.** Each roster option and day plan shows paid hours, overtime and night-premium deltas vs baseline per crew, plus the unpaid day span. **Publishing is blocked** when paid hours fall unless the employer attests compensation with a reason code. Example: the legal 8 h templates vs the 8.5 h baseline lose 0.5 h of overtime, about 7.2% of daily pay at 25% overtime [C: 0.625 / 8.625]. Heat-stop time is priced as **paid** (Art. 26(1) reading in Sleep §0.6; Stakeholders could not confirm, so counsel decides, §8), and the employer attests that stoppage is paid. The tool does not model wages.
6. **Employer-of-record scoping** (P-H12) in the data model, RBAC and evidence pack.
7. **k-anonymity by data class:** **k = 10** for health-related counts (symptoms, incidents, stop events tied to health) and **k = 5** for exposure-hours and zone counts. Suppression is at site-week or employer level, never crew-day, with complementary suppression. ADR 0010's single `k_suppression` tunable becomes two tunables, `k_health` (min 10) and `k_exposure` (min 5), additively in `ae-heat-2026.1`. Crew plans and exposure bands go to the crew's own supervisor, because they are task allocation and not health data.
8. **No worker physiology, GPS or camera input.** Per-worker inputs are the acclimatisation counter, the task-family set, a juvenile flag and an optional exposure tally. No nationality, sex or age band beyond the juvenile flag. Symptom reports never reach a planner view. No export joins adherence or stop events to named individuals (CI purpose-limitation test). PDPL basis is employment/contract (Art. 4(8)-(9)), **not consent**. Consent covers only optional per-worker features, and refusing it leaves the crew plan unchanged.
9. **No LLM in the planner.** The shift-plan drafter stays cut (Judges §3). The kept compliance-report drafter (ADR 0010 §8) may read only `LlmInput[NonPersonal]` built from k-suppressed planner aggregates.

### 5. CP-SAT formulation (Layer D), sketch
**Instance:** one employer, one site, one local day, the frozen roster window, 5-min ticks (`T ≈ 108` for 9 h), crews `C` (≤ ~10), tasks `J` (≤ ~20), hours `H` of the window. Inputs are sorted by stable id before model build, because variable order affects search.
- **Variables:** `w[c,j,h] ∈ {0..12}` = 5-min work units of crew `c` on task `j` in clock hour `h`; `x[c,j] ∈ {0,1}` assignment; `rest[c,h] = 12 - Σ_j w[c,j,h]` within working hours; for pours `IntervalVar(start_j, dur_j, end_j)` (P-H13); `u[j] ≥ 0` unmet work units; `d[c,j,h] ≥ |w − w_prev|` (stability).
- **Hard constraints:**
  - `w = 0` in ban ticks unless `j` is exempt-attested (P-H1/1a).
  - `Σ_j w[c,j,h] ≤ cap(zone(h), class(j))`: 9 units for a Medium heavy or High light hour, 4 units (20 min) for a High heavy hour, 12 otherwise (P-H7).
  - Lone work: in Medium/High hours, crew headcount on `j` ≥ 2.
  - Unacclimatised headcount = 0 in Medium/High hours; acclimatisation-ramp share caps per worker-day (P-H8).
  - `Σ_c rest[c,h] · size(c) ≤ shelter_capacity` (P-H9).
  - `Σ_{j,h} w[c,j,h] ≤ roster_minutes(c)/5` (P-H11).
  - Runs ≤ 5 h and breaks ≥ 1 h are already guaranteed by the template, re-checked in validation (P-H3).
  - Allowed task families (P-H10); fixed-time tasks and precedences on intervals; P-H5 for juveniles.
- **Objective, lexicographic in three solves.** Each stage fixes the previous optimum as a hard bound:
  1. Minimise heat strain `Σ w[c,j,h] · ⌈100 · max(0, WBGT_q(h) + clo_adj(j) − REL(M_j))⌉`. This is the Feasibility within-shift metric, with WBGT at the protective quantile.
  2. Minimise `Σ_j u[j]` (productivity, labelled SIMULATED).
  3. Minimise `α·Σ d + β·fairness_spread` with `α, β` tunables (P-S7, P-S8).
- **Solver parameters** (verified names, `sat_parameters.proto`):
  - `num_workers = 1`. "A number of 1 means no parallelism"; `num_search_workers` is deprecated.
  - `random_seed = 20261111`: a code constant (class d), not a tunable.
  - `max_deterministic_time = 2.0` per stage: a tunable, range [0.5, 10]. **The limit is deterministic, not `max_time_in_seconds`**, because a wall-clock stop depends on machine load and would make plans irreproducible.
  - `max_time_in_seconds = 10` total wall cap, as a backstop only. If the wall cap fires, the plan is marked `reproducible=false` and the P-H14 fallback is offered alongside it.
  - Same instance + ruleset + config version + `ortools` version ⇒ byte-identical plan (acceptance test). Each solve records status (OPTIMAL/FEASIBLE), objective, best bound, deterministic time and parameters on the decision row with `ruleset_id`, `config_version_id`, `model_id`.
- **Inline call** (ADR 0002): a synchronous API call. If the p95 wall time exceeds 3 s on the demo instance, B3 reduces the tick to 10 min before adding a queue.

### 6. What is runtime-tunable vs a floor (ADR 0010 classes)
| Class | Planner items |
|---|---|
| **(c) floor, ruleset file only** | P-H1 to P-H10 values (ban window/dates/exemptions, 8/48 h, overtime 2 h and 144 h/3 wk, 5 h run + 1 h break, weekly rest, juvenile rules, Ramadan −2 h, TWL work/rest table and fluid, acclimatisation schedule and 14-day reset, lone-work and unacclimatised rules); k floors 10/5; notice floor 7 d; freeze floor 7 d; max 1 in-season change/month; drift step ≤ 30 min; sleep gate floor 7.0 h; rest-interval floor 11 h; earliest start ≥ 04:30 |
| **(b) runtime tunable within range** | Sleep gate (7.5, [7.0, 9.0]); rest interval (11, [11, 16]); notice days (14, [7, 28]); freeze days (7, [7, 14]); noise-floor threshold; earliest-start flag time (06:00); P-S6 day cap (6, [5, 6]); α, β weights; `planner_det_time_s`; `k_health` (10, min 10), `k_exposure` (5, min 5); flag `planner_full_constraints` |
| **(d) code** | No-added-minutes; exposure-reducing-only inside the freeze; immediate escalation and stop; lexicographic order; `num_workers = 1`; seed; tick-to-zone mapping; fallback never weaker than the ban |
| **Site data (employer input, audited per §4.3, not config)** | Commute and bus wait, accommodation AC, cooled-shelter capacity, night permit, site earliest start, station mapping, baseline roster, crews, tasks (workload, movability, exempt reason), acclimatisation counters, juvenile flag |

### 7. Layers evaluated and rejected (numbers from Feasibility, 8.5 h exposure-only libraries)
| Layer | Result | Verdict |
|---|---|---|
| Weekly re-roster from IFS day 1-7 forecasts | vs fixed seasonal: +0.1% raw / 0.0% bias-corrected at ≥ 30 h; −1.0% / −1.1% at ≥ 32 h. Below the ~4 h/summer noise floor (6 clusters × 3 summers, 6-9 of 18 pairs worse). About 10 changes per summer | **Rejected** |
| Weekly, perfect knowledge (ceiling) | −0.7% (≥ 30), −4.8% (≥ 32) vs fixed; 0 vs 19 changes per summer: 498 vs 495 h at ≥ 30 | Ceiling too low to fund the instability |
| Daily re-roster, lead-1 forecast | −0.2% / −2.0%; with night shifts in the library, +4.3% (**worse**) at ≥ 30 | **Rejected** |
| Weekly exception trigger (re-roster only in the ~5% of weeks with > 5% regret) | Untested hypothesis | Parked |
| Sub-seasonal (weeks 2-5: EC46, GEFS, CFSv2) | No open archive back-tests it by 20 Nov (Open-Meteo seasonal `past_days` keeps 32 days); weekly WBGT-anomaly autocorrelation 0.22 at lag 1, about 0 at lags 2-3; no Gulf humidity/WBGT skill found. A GEFS control-only back-test is about 20,000 range requests / 4 GB | **Rejected** for decisions; an EC46 panel would be unvalidated context, parked |
| Multi-stage stochastic / robust rostering | Literature gains 0.3% (rolling horizon); no headroom at roster level here | Parked |

The **in-shift layer is kept**. In Feasibility's early/late shift, lead-1 task allocation cut REL-excess 7.8% vs heavy-first (1,698 → 1,565 °C-h per worker-summer; perfect knowledge 11.4%). In the baseline shift the gain was only 0.2%, because every hour is hot there. 59-86% of scheduled hours stay above REL either way, so **this layer's main job is work/rest timing and intensity matching, not avoiding the limit.**

### 8. Evaluation metrics
- **Layer S** (2026 held out; choice on 2024-2025):
  - E28/E30/E32 per worker-season and share avoided vs baseline, per station (6 clusters) and per gate.
  - Sleep opportunity, earliest bus departure and day span of the chosen template.
  - Paid-hours, overtime and night-minute deltas.
  - Changes per season and regret vs hindsight.
  - A reproduction check: the scorer must match `legal_sleep_templates.csv` to the half-hour.
- **Stability:** SS2 notice lead time, SS3 drift, SS4 churn, SS5 wake-time SD, measured on simulated publish/execute logs for the demo (labelled SIMULATED).
- **Layer D** (2026 held out, observed truth):
  - REL-excess °C-h vs heavy-first and vs the exact oracle.
  - **Hard-rule violations on truth = 0 by construction on the plan's own zones.** The number reported is *misses*: ticks scheduled as Low/Medium whose truth zone was more severe, with POD/FAR per zone. This is the same scoring the Judges scoreboard uses.
  - Minutes lost vs demand (SIMULATED).
  - Solver status mix, deterministic time, wall p95, determinism (byte-identical re-solve).
- **Governance:** added minutes = 0 (property), suppression tests (k 10/5), anomaly-flag precision on seeded edit-to-green cases, sign-off review enforced, pay block enforced.

### 9. Open legal questions for counsel (and one for ADPHC)
1. Does the 12:30-15:00 ban gap count as the Art. 18 break? Does a 5-6.5 h morning block (06:00-12:30, 04:30-10:00) need a break inside it?
2. Is moving start times, or moving to a split or evening pattern, a contract variation that needs worker approval (Exec. Regs. Art. 10(1), 10(3) "work model")? What notice is lawful?
3. Is MR 44/2022 Art. 3 (midday ban) still in force after MR 122/2026? Is MoHRE's 2023 "8 h across morning and evening shifts" still policy?
4. Who is a "shift worker" under Art. 19(3)? Does moving a crew to evening or night hours remove the 50% night overtime premium?
5. Is employer-ordered heat stop time paid (Art. 26(1))? Does an NCM heat warning count as "bad weather" that makes commute time working time (Exec. Regs. Art. 15(1))?
6. Is heavy outdoor summer work "arduous" for juveniles (Art. 5(2)(e))?
7. Does crew rotation across tasks breach Art. 12 without written consent?
8. Where does the tool provider's liability sit? Does Federal Law 2/2019 reach health-adjacent planner data? Do free-zone sites (PDPL Art. 2(2)(g)) need a separate regime?
9. Do exempt-category duties (AD 19/2023 Art. 11) need regulator notice?
10. **ADPHC:** are acclimatisation ramp days restricted to Low-zone hours?

## Conflicts between the research docs, resolved
| # | Conflict | Resolution |
|---|---|---|
| 1 | Feasibility's optimum roster (04:30-10:00 + 16:30-19:30, 8.5 h) vs Art. 17/18 and the sleep benchmark | Template library regenerated under the law; sleep gate applied. Headline falls from 34.6%/58.0% to 16-25% at ≥ 30 (new computation above). Feasibility's horizon conclusions (fixed ≈ adaptive) are not affected, because they compare horizons on one library |
| 2 | Earliest start: Stakeholders default 06:00; Feasibility optimum 04:30; Sleep penalises < 07:00 | A per-site parameter: priced and flagged below 06:00, reason + HSE approval below 05:00, floor 04:30. The default for the demo is Ali's call (decision 1) |
| 3 | Stakeholders allow weekly adjustments ("≤ 1 weekly change"); Feasibility rejects weekly re-rostering | Weekly **shift-time** changes rejected (numbers in §7). Weekly crew/task assignment and acclimatisation ramps stay, inside the frozen roster, in Layer D |
| 4 | Is heat stop time paid? Sleep cites Art. 26(1) (yes); Stakeholders found no source | Priced as paid; employer attestation; counsel question 5 |
| 5 | k = 5 (roadmap, ADR 0010) vs k = 10/5 (Stakeholders) | 10 for health-related counts, 5 for exposure; two tunables with floors |
| 6 | Judges cut all LLM agents; ADR 0010 keeps the compliance drafter | ADR 0010 is the later, accepted-in-principle decision. The planner has no LLM; the drafter reads only k-suppressed aggregates |
| 7 | 30-min drift cap vs a 90-min pre-season move | Pre-season adoption is a single announced change with 14-day notice, flagged as a possible contract variation; the drift cap applies in-season |
| 8 | Sleep §6.3 lists "delay" as heat-reducing | Corrected: only stop, shorten, extra rest and move-to-shade are exposure-reducing |
| 9 | Stakeholders S6 "one-tap accept" vs review-required sign-off | One-tap only for unchanged, Low-only plans; otherwise itemised acknowledgement |
| 10 | Night work: best exposure (Feasibility) vs sleep, permit, premium and transport costs (Sleep, Stakeholders) | Scored and shown; eligible only with attestations; deeper modelling parked |
| 11 | Plan §8.5 "plan against the upper quantile": untested (Feasibility used point forecasts) | Kept as the safety margin, labelled untested; B3 reports the miss rate at the chosen quantile |

## Not doing now
Weekly re-roster, sub-seasonal feeds, night-work modelling beyond scoring, stochastic/robust optimisation, split-sleep crediting, commute heat exposure, cross-employer rotation, wage modelling. All are in `docs/parking-lot.md` with triggers.

## Consequences
- The planner's demo claim changes from "we find the best roster" to "we show the honest exposure-sleep-pay trade-off, and inside the shift we cut REL-excess and enforce ADOSH work/rest from a calibrated forecast". That is consistent with the Judges finding that the planner is an "obvious optimiser feature" (rank 9). Its distinctive part is the honest trade-off and the frontier, not the solver.
- `ae-heat-2026.1` gains `[labour]`, `[planner]`, `[stability]` and `[privacy]` sections and the tunables in §6 (additive; every floor field carries a `Floor` comparator).
- B3 build: about 1.5 days for the must-have set (B3 notes in the roadmap). The full constraint set stays should-have (`planner_full_constraints`).
- Pitch lines must quote the gated numbers with the commute assumption. "Policy benchmark" wording is enforced in message templates.

## Decisions Ali must make
1. Demo default earliest start (recommended: 05:00 floor with a flag below 06:00, showing the 06:00 alternative on the explorer).
2. Demo default sleep gate (recommended: 7.5 h, Sleep S1) and default commute for the demo site (45 min, labelled assumed).
3. Accept k = 10/5 split and the pay-publish block.
4. Whether to commission counsel on questions 1-5 before the pilot narrative (it changes what the deck may claim about legal templates).

## Revisit trigger
Counsel answers §9; a pilot site supplies commute, camp and timesheet data (calibrate the sleep buffers and the gate); a sub-seasonal archive becomes back-testable; shoulder-season (Oct-Apr) replication shows larger adaptive value; the B3 miss rate at the protective quantile is worse than the rule fallback.
