# Adversarial review: ADR 0011 (heat-aware planner) and the B3 planner design notes

**Date:** 2026-11-11. **Under review:** `docs/decisions/0011-heat-aware-planner.md` (Proposed) and `docs/superpowers/plans/2026-11-11-b3-planner-design-notes.md`.
**Evidence used:** the three 2026-11-11 roster/sleep/stakeholder research docs, `docs/research/2026-11-11-judges-and-wow-moment.md`, ADRs 0004/0006/0009/0010, the roadmap, `docs/research/scripts/roster/` (scripts and `results/`).
**New computation in this review [C]:** two scratch variants run on the same `hourly_wbgt.parquet` the ADR used (`%TEMP%/claude/stellar-research/roster/out2/`), with `uv run --with pandas --with numpy --with pyarrow [--with scipy]`. Nothing was written into the repo except this file.
- `review.py` imports `legal_sleep_templates.py` unchanged (`build`, `weights`, `day_matrix`) and adds: (a) two extra baselines; (b) a circadian sleep model with a bedtime floor; (c) a strict Art. 18 filter (template must contain a ≥ 1 h gap that does not overlap 12:30-15:00); (d) a "no worse than baseline" guard. Same 4 headline stations × 3 summers, same LOSO severity pick.
- `within_shift.py` copied with three changes only: `SHIFTS` replaced by three legal 8 h templates, task mix 5 light / 6 moderate / 5 heavy (16 half-hours = 8 h instead of 17), slot count 17 → 16. Everything else (REL, Hungarian assignment, forecasts, LOSO bias correction, 6 clusters × 3 summers) is unchanged.
- The ADR's own numbers reproduce: baseline OMAA 2024 E30 = 791.0 h; G1 at ≥ 30 = 16.1% (4 stations), 2026 fold alone 16.3%.

Severity: **Critical** = the decision or its pitch is wrong or unsafe as written, or the 20 Nov plan fails; **Important** = must change before acceptance; **Minor** = fix while building.

---

## Critical

### C1. The sleep model credits a 19:15 bedtime; the 16% headline depends on it
**Evidence.** `legal_sleep_templates.py` defines sleep opportunity as `24 − span − 2·commute − 0.75 − 2.0`. It depends only on the day span, not on clock time. The G1 pick (12/12 folds), 04:30-08:00 + 09:00-12:30 + 15:30-16:30, passes the 7.5 h gate because it assumes **bed at 19:15** (16:30 end + 0:45 commute + 2 h buffer) and **wake at 03:00**. In June, 19:15 is about sunset. The camp evening (meal, washing, prayer, calls home) is the Sleep doc's own 2 h buffer, and people do not advance bedtime one-for-one. The ADR cites Kecklund & Åkerstedt 1995 for P-S3, and that source says "no more than 5 or 6 hours of sleep is obtained before the morning shift if the shift starts at 06.00 hours or earlier" (Sleep §4.1). Tucker 1998 finds the same for 06:00 vs 07:00. So the gate that produces 16% contradicts the evidence the ADR cites a few rows later. This is also the safety case the brief asks about: the tool recommends a 04:30 start (03:45 bus) as "sleep-compatible".

**Recomputed [C]** (sleep = wake − max(end + commute + buffer, bedtime floor), 45-min commute, gate 7.5 h, share of E30 per worked hour avoided vs the ADR baseline):

| Sleep model | ≥ 28 | ≥ 30 | ≥ 32 | Typical pick |
|---|---|---|---|---|
| ADR span model (G1) | 11.5% | 16.1% | 17.2% | 04:30-08:00 + 09:00-12:30 + 15:30-16:30 |
| Bedtime ≥ 21:00 | 2.0% | **7.5%** | 19.1% | 06:00-11:00 + 15:00-18:00 |
| Bedtime ≥ 21:30 | −1.5% | **4.0%** | 18.7% | 06:30-11:30 + 15:30-18:30 |
| Bedtime ≥ 22:00 | −3.7% | **2.0%** | 17.9% | 07:00-11:30 + 15:30-19:00 |

The bedtime floor is an [I] assumption, just as the ADR's 2 h buffer is. Any plausible floor removes most of the ≥ 30 gain. The ≥ 32 gain (~18-19%) is more robust, because it comes from moving work out of 11:00-12:30.

**Fix.** Replace the span formula with a clock-time model: `bed = max(end + commute + buffer, bedtime_floor)` and `sleep = wake − bed`. Make `bedtime_floor_h` a class (b) tunable (default 21:30 [I], range [20:30, 23:00], safer = later), and label it [I] until a pilot sleep diary exists. Make P-S3 (< 06:00 flagged, < 05:00 needs a reason) a **gate in the lexicographic order**, not only a tie-break. As written, step (4) lets a 04:30 start win whenever it passes the sleep gate. Regenerate the ADR table, the frontier CSV and the AT-2 fixture.

### C2. The baseline is itself non-compliant, so "share avoided" mixes legalisation with shape
**Evidence.** The baseline 06:00-12:30 + 15:00-17:00 is 8.5 h (daily overtime). It has a 6.5 h run, which Art. 18 forbids unless a break sits inside it (Sleep key finding 8). On a 6-day week it is 51 h, which exceeds Art. 17(1) 48 h/week and the Art. 19(1) "in all cases" 144 h per 3 weeks (153 h). The templates it is compared with are legal 8 h templates. Recomputed against a **legal** baseline, 06:00-11:00 + 15:00-18:00 (8 h, the G4 pick) [C]:

| Gate | vs ADR baseline, ≥ 30 / ≥ 32 | vs legal 06-11 + 15-18, ≥ 30 / ≥ 32 |
|---|---|---|
| G1 span model | 16.1% / 17.2% | **9.1% / −3.0%** |
| Bedtime ≥ 21:00 | 7.5% / 19.1% | **0.0% / 0.5%** |
| Bedtime ≥ 21:30 | 4.0% / 18.7% | **−3.8% / 0.2%** |

Simply legalising the common roster (B0 → B1) cuts E30 per worked hour by about 7-10% at every station (OMAA 2024: 93.1 → 86.3 h per worked hour-equivalent). That gain belongs to the law, not to the planner.

**Fix.** The explorer and the pitch show two baselines: "common practice (8.5 h, non-compliant)" and "legal default (06:00-11:00 + 15:00-18:00)". The planner's claim is the gap to the *legal* default, which is about 0-9% at ≥ 30 and about 0% at ≥ 32 under a realistic sleep model. Legalisation is reported as a separate line ("making the common roster legal removes ~7-10%").

### C3. Layer S can recommend a roster with more heat exposure than today's
**Evidence.** §3's lexicographic order is: pass hard rules, pass gates, then minimise severity. Nothing compares the result with the current roster. At a 90-min commute the gate excludes the baseline (7.25 h), so the scorer picks 07:30-12:30 + 15:00-18:00. That roster has **14.5% more** E30 per worked hour (24.3% more vs the legal baseline) in all 12 folds. With a "no worse than current" guard added, **no template is eligible in 12/12 folds** [C]. The tool would publish a recommendation that raises heat exposure and call it sleep-compliant. The real lever, commute or camp, is outside the tool. Because the ADR treats sleep as a gate, sleep beats heat silently, which no one has decided.

**Fix.** Add a do-no-harm rule to Layer S (class d): never *recommend* a template whose E28/E30/E32 at the protective climatology exceed the current roster's. When the gates leave no such template, the output is "no roster change recommended; binding constraint: commute X min / sleep gate Y h". It shows what commute would unlock a gain (from the frontier). Templates that are worse on heat can be shown in the explorer, but never marked recommended. Add a hypothesis property test.

### C4. The CP-SAT stage-1 objective makes "do nothing" optimal, and AT-9 cannot pass
**Evidence.** §5 stage 1 minimises `Σ w·⌈100·max(0, WBGT_q + clo − REL)⌉`, with `u[j] ≥ 0` unmet work as free slack. Stage 2 then minimises Σu with stage 1 fixed. Stage 1's optimum is `w = 0` in every hour above REL. The ADR's own §7 says 59-86% of scheduled hours are above REL. Stage 2 is then locked to that, so the plan leaves most demand unmet: a plan supervisors will discard, or a planner that looks "infeasible". `within_shift.py`, which AT-9 names as the oracle, solves a different problem: a **permutation of a fixed workload** (all 17 tasks done, `linear_sum_assignment`). The oracle test fails by construction.

**Fix.** Reverse stages 1 and 2. Stage 1 minimises unmet *must-do* work subject to every hard cap (ADOSH caps, ban, lone work, acclimatisation, shelter), so safety is already bound by the hard constraints. Stage 2 minimises strain with `Σu` fixed at its optimum. Stage 3 handles stability and fairness. Mark tasks `must_do | deferrable` in the instance. AT-9 then holds, because a single crew with no side constraints and all work done is exactly the assignment problem. Add a test that the stage-1 plan never schedules less work than the fallback rule plan on the same instance.

### C5. B3 planner scope does not fit the 20 Nov plan
**Evidence.** The roadmap gives the planner **one day** (Mon 16 Nov). That day also holds governance (consent, RBAC 403 + audit, k-suppression, purpose limitation), API routes, the config admin API and `config.*` audit events. Sun 15 already holds risk levels and alert burden. B2 is on the critical path (B1 Task 11 → B2 → B3 numbers → D), and the wow scoreboard needs about 1.5 days (Judges §3). The design notes estimate the planner's must-have set alone at 1.5-2 days: 12 components, 21 acceptance tests, 6 endpoints, 5 problem types, 6 new tables, 4 F2 views. Judges §3 ranks the planner 9th ("an obvious optimiser feature … keep the simple version; demote the full constraint set"). The ADR moves the other way.

**Fix: cut, in this order.**
1. **Layer S as a service.** Drop `roster_scorer.py`, `roster-options`/`roster-publications` endpoints, `roster_publication` and `roster_option_run` tables, and the hysteresis/freeze/notice engine (AT-4). Ship the explorer and the frontier as **static JSON exported from the research scripts** (after C1-C3), labelled REAL climatology. That keeps the honest finding and saves about half a day.
2. **Governance extras.** Drop the edit-to-green anomaly flag, the HSE second approver and the anomaly-rate report (AT-13). Keep the input-change audit as a plain append-only row.
3. **Pay block as a workflow.** Show the pay panel as static JSON. Drop the `pay-attestation-required` publish gate (AT-14), because there is no roster publication in the demo once cut 1 is made.
4. **CP-SAT itself.** See I5: on legal shifts the solver adds 2-4% over heavy-first. Build the **rule planner** first: heavy-first plus per-tick ADOSH caps plus ban, lone-work and unacclimatised rules. It is P-H14's fallback and already a must. Build the **independent validator** (AT-6) and no-added-minutes (AT-5). CP-SAT (simple set, C4 fixed) is should-have, and its demo value is the OPTIMAL vs FALLBACK chip.
5. Fairness, stability, shelter, pours, rotation, SS metrics: already should-have; leave them in the parking lot.

**Never cut:** P-H1 to P-H8 in the ruleset, the validator, no-added-minutes, the banner, employer scoping, k-suppression (shared governance) and determinism. Realistic must-have after the cuts: about 1 day for one Sonnet implementer plus a reviewer, which fits 16 Nov.

---

## Important

### I1. Clock-hour caps do not enforce ADOSH work/rest cycles
**Evidence.** §5 caps `Σ_j w[c,j,h] ≤ 9` (45 min) or `≤ 4` (20 min) **per clock hour**, without saying which ticks within the hour. A legal solution can work 10:15-11:00 and 11:00-11:45, which is 90 min continuous in a Medium heavy zone. It can also work 20 + 20 = 40 continuous minutes in a High heavy zone, where Table 1 says "Strict Work/Rest cycling required … 20 work - 40 rest". The ADR says "task order per 5-min tick", but the variables are hourly.

**Fix.** Use per-tick boolean work variables with a sliding-window constraint (in every 12-tick window, work ≤ cap, and work runs ≤ the cycle's work length). Alternatively, fix rest ticks at set offsets in each hour (for example :45-:00). AT-6's validator must check **rolling** 60-min windows, not clock hours.

### I2. The template generator contradicts P-H3 on the ban gap, and Art. 18 is over-read
**Evidence.** P-H3: "The ban gap does **not** count as the break until counsel says otherwise." `legal_sleep_templates.py` docstring: "for split days the gap is the break". Only 134 of 405 templates have a non-ban gap of ≥ 1 h [C]. Not compliant under P-H3 as written: G0's 04:30-09:30 + 16:30-19:30, the G4 pick, the G3 pick and the legal baseline. Under strict P-H3 plus a 21:30 bedtime floor, **no** template is eligible [C], because the generator only inserts breaks into blocks over 5 h. Separately, Art. 18's text ("may not work for more than (5) five consecutive hours without a break or breaks of not less than an hour in total") ties the 1 h to the 5 h run. P-H3's "≥ 1 h breaks per day" reads it as a daily minimum. That reading may be more protective than the law, but it is then not "LAW". AT-1 bakes in the generator's reading ("136 day / 269 evening").

**Fix.** Add one ruleset switch, `art18_ban_gap_counts_as_break` (class c, default `false` = protective), that both the generator and the validator read. The generator must be able to insert a 1 h break into short blocks as well, and place it in the hottest hour, not the midpoint (G1's 08:00-09:00 break is in the coolest part of the day). Label "≥ 1 h per day" as a protective reading pending counsel (§9 Q1). Re-derive AT-1's counts from the switch.

### I3. Policy and law are mixed up in both directions; class (c) holds benchmarks
**Evidence.**
- P-H2 lists "Planned overtime = 0 in the ban season (Sleep S9)" under hard constraints sourced "LAW". S9 is a Sleep-doc **soft** constraint. Art. 19(1) permits 2 h/day of overtime at +25%. The Context paragraph's claim that "8.5 h means daily overtime" breaks a constraint is therefore wrong as law. It is overtime, which is lawful and paid.
- The reverse also holds. The law does bind once days per week are counted: 6 × 8 h = 48 h/week = exactly 144 h per 3 weeks, so **any** daily overtime on a 6-day week breaches Art. 19(1) "in all cases" and 17(1). The defensible hard rule is the weekly/3-week cap evaluated on the site's days per week, not "overtime = 0" as such. Also, "overtime ≤ 144 h per rolling 3 weeks" misquotes the law: 144 h is **total** hours, not overtime.
- §6 class (c) ("Legal and regulatory floors", ADR 0010) lists BENCHMARK values: notice floor 7 d, freeze 7 d, max 1 change/month, drift ≤ 30 min, sleep gate floor 7.0 h, rest interval 11 h, earliest start 04:30. A `floor-violation` problem on any of these would present a policy benchmark as a legal floor. That breaks the ADR's own rule: "must never call it compliance". The monthly change cap and the drift cap are also not "safer" in one direction: they can block an exposure-reducing roster change in a heatwave.

**Fix.** P-H2 becomes "normal ≤ 8 h/day, ≤ 48 h/week; total ≤ 144 h per 3 weeks (total, not overtime); overtime ≤ 2 h/day at +25%". "Overtime = 0" moves to §3 as P-S9 (policy), with a note that on 6-day weeks the 144 h cap makes it binding. Move the benchmark values out of class (c) into `[tunables]` with pinned ranges (ADR 0010 §2 point 2, which already provides "less-protective end pinned"), and use a distinct problem code, `policy-bound-violation`, with "policy benchmark" wording. Exempt exposure-reducing changes from the monthly cap and drift cap.

### I4. Misquoted and omitted numbers in the ADR
**Evidence.**
- "The honest seasonal claim is a range: about 16-25% at ≥ 30" (Context, and Conflicts row 1). 25.1% is the G2 figure **at ≥ 32**. At ≥ 30 the G1/G2 range is 16.1-18.8%.
- The table omits G5 (sleep ≥ 7.5 h + start ≥ 05:00), the row that matches the ADR's own recommended default (Decision 1: 05:00 floor). G5 gives **10.9% at ≥ 30** (4 stations) and 11.6% (6 clusters).
- "The 6-cluster means are within 2 points": false for G0 DAY+EVE (≥ 28: 29.2 vs 32.6; ≥ 30: 59.5 vs 63.3).
- Conflicts row 1 says "Feasibility's horizon conclusions (fixed ≈ adaptive) are not affected". That is untested on the legal library; it should be labelled [I].

**Fix.** Correct the figures. Add the G5 row and the C1/C2 rows. After C1-C3 the pitch range at ≥ 30 is about 0-9% vs a legal default and about 4-16% vs common practice, depending on the sleep model.

### I5. The in-shift gain was measured on a roster the ADR rejects; on legal rosters it is 0-4%
**Evidence.** §7 keeps the in-shift layer on "7.8% vs heavy-first (1,698 → 1,565)". That was measured on 04:30-10:00 + 16:30-19:30, which the ADR itself rules out (5.5 h run, 8.5 h, 4.75 h sleep). Recomputed with the same method on legal 8 h templates [C] (REL-excess °C-h per worker-summer, 6 clusters × 3 summers, lead-1 raw forecast vs heavy-first; perfect knowledge in brackets):

| Shift | heavy-first | lead-1 | gain | perfect |
|---|---|---|---|---|
| 06:00-11:00 + 15:00-18:00 (legal default) | 2,624 | 2,577 | **1.8%** | 3.2% |
| 06:30-11:30 + 15:30-18:30 (bedtime 21:30 pick) | 2,849 | 2,747 | **3.6%** | 5.0% |
| 04:30-08:00 + 09:00-12:30 + 15:30-16:30 (G1 pick) | 2,289 | 2,305 | **−0.7%** | 0.8% |

By comparison, heavy-first vs random is a 10-18% cut. The fixed rule captures most of what ordering can buy, and the forecast-driven optimiser adds little. The in-shift layer's real value is enforcing ADOSH zone work/rest, lone-work and acclimatisation from a calibrated next-day forecast. Its REL-excess optimisation adds little.

**Fix.** Replace the 7.8% claim with these numbers. Evaluate Layer D on the scoreboard's own metric (zone POD/FAR on held-out 2026, as §8 already does) and on "hard-rule violations prevented vs the ban-only policy". Make the rule planner the default, with CP-SAT as an add-on (C5 cut 4).

### I6. Acclimatisation rule is less protective than the source
**Evidence.** P-H8: "> 14 days away resets". Technical Guideline §3 (Sleep §3, quoted exactly) has a graded re-acclimatisation table: 6-12 days away (illness 4-5) → 80% then 100%; 12-20 days → 60/80/100; over 20 days → 50/60/80/100. CoP 3.2(b)(i) also requires "5-7 days for acclimatization before starting hard work". A worker back after 10 days, or after 5 days ill, gets 100% under the ADR.

**Fix.** Encode the full re-acclimatisation table and the 5-7-day hard-work rule in `[labour]` (class c). Add the counter fields "days away" and "away reason (leave/illness)". Add AT-6 cases.

### I7. ADOSH rest minutes and pay: an incentive to under-report
**Evidence.** In High-zone heavy work, 40 of every 60 minutes are rest. Art. 18 breaks are "not included in the working hours" (that is, unpaid). If an employer books ADOSH rest as Art. 18 break time, a hot day cuts pay. That is exactly the incentive the ADR's Art. 26(1) reasoning is meant to remove, and it pushes workers to hide symptoms. The ADR prices "heat-stop" time as paid but does not classify ADOSH cycle rest. Separately, §4.5 says "Publishing is blocked when paid hours fall unless the employer attests". As written, that could block an in-freeze "shorten" or "stop", the exposure-reducing changes the ADR wants to be frictionless.

**Fix.** State that ADOSH cycle rest and heat stops are priced as paid working time, add this to counsel Q5, and show it on the pay panel. Scope the pay block to **roster publications only**. Never apply it to day plans, exposure-reducing changes or stops (class d invariant plus a test).

### I8. Sign-off must never gate safety signals (ADR 0004 / 0010 consistency)
**Evidence.** §4.4: "A named supervisor … signs before crews see a plan." ADR 0004 Tier A site/crew alerts and ADR 0010's "escalate immediately" invariant are independent of the plan. The ADR does not say what crews see when no one signs (supervisor absent, or sign-off rejected). A reading where crews get nothing is possible.

**Fix.** Add a class (d) invariant: Tier A alerts, Red escalation and crew-lead stop are never gated by plan sign-off. An unsigned day shows crews the P-H14 conservative rule plan, labelled "unsigned fallback". Add an AT.

### I9. Judge value: the planner must be reframed, not dropped
**Evidence.** Judges ranks the planner 9/10, "an obvious optimiser feature". A competing **"Challenge 06 Heat Shift Planner"** (Judges §2.1) already sets the honesty bar. The ADR's proposed framing, "honest trade-off … inside the shift we cut REL-excess", still leans on an optimiser gain that I5 shows is 0-4%.

**Fix (a stronger, true framing).** "**Under UAE law and a realistic night's sleep, no roster shape outruns the heat.** Moving start times buys about 0-9% at ≥ 30 °C over a legal 06:00 roster, and nothing at a 90-min commute. Making the common 8.5 h roster legal is worth more than any optimiser. So we hold the roster fixed and spend the forecast where it pays: tomorrow's ADOSH zone timeline, rest cycles, acclimatisation and lone-work rules per crew, checked by an independent validator and scored on a summer we never tuned on." This publishes a negative result, matching the honesty bar Judges sets. It also ties the planner to the wow scoreboard (same POD/FAR scoring), and it is distinctive because the obvious entries claim optimiser gains. Keep the explorer as **one** chart: E30 vs sleep, commute slider, legal-default and common-practice baselines. The commute slider is the memorable beat: "every 15 min of bus costs 30 min of sleep".

---

## Minor

- **M1. Edit-to-green window.** A 24 h window is easy to evade by editing 25 h before sign-off. Flag any protection-lowering edit **since the last accepted plan** for that site.
- **M2. G1 is operationally odd.** It has a 1 h afternoon block (15:30-16:30) after a 3 h wait. That means a second bus run, or 3 h on site in the ban window, and a 12 h unpaid day span for 8 h of pay. The cost card shows this, but the tie-break should also penalise blocks shorter than 2 h, or exclude them unless the employer opts in.
- **M3. Juveniles.** Art. 5(2)(d) (no work 19:00-07:00) excludes juveniles from **every** template that starts before 07:00, which is most of the library. State this as a template-eligibility rule. Add "official holidays" and "not kept at the workplace after hours" (Art. 5(2)(f)).
- **M4. Lexicographic fixing on FEASIBLE.** When a stage stops at the deterministic limit, fix the next stage to the **incumbent** objective, not the "optimum". Record the gap. AT-10 should test the FEASIBLE path.
- **M5. Low-zone cap of 12/12.** A paced 60-min work hour conflicts with the "self-paced" footnote and with "plans are bounds, not pace". Render Low-zone work as a bound, and offer S10's optional voluntary rest cycle.
- **M6. High-zone duties.** "High Risk induction required" and the "personal 2 L water bottle" are ADOSH Table 1 duties. Add them as flags or checklist items next to the fluid rule.
- **M7. AT-2 reproducibility.** The 12.5 MB parquet is not committed. AT-2 needs a committed fixture subset (4 stations × 3 summers, the hours used) or it cannot run in CI.
- **M8. Earliest-start site floor 04:30.** CoP 25.0 says to "avoid departures before 5am" (drivers). A 04:30 start with a 45-min commute means a 03:45 bus. Treat bus departure < 05:00 as the flagged quantity, not the work start.

---

## Consistency with ADRs 0004, 0009, 0010

| Item | Status |
|---|---|
| ADR 0010 classes | Mostly consistent: weights, det-time and gates are (b); seed and `num_workers` are (d). **Inconsistent:** benchmark values sit in class (c) (I3). The `k_health`/`k_exposure` split is additive and has floors, which is fine. |
| ADR 0010 "escalation immediate" | Respected for Red and crew-lead stop. Must also hold against sign-off and the pay block (I7, I8). |
| ADR 0010 audit/decision linkage | Consistent: decision rows carry `ruleset_id`, `config_version_id` and solver metadata (AT-18). |
| ADR 0009 rulesets as data | Consistent if the Art. 18 switch (I2) and the acclimatisation table (I6) live in the ruleset with `Floor` comparators. |
| ADR 0004 | Planner data is crew-level; no personal risk on the server. The juvenile flag and acclimatisation counters are personal employment data and should be typed `Personal` (ADR 0010 §8) so they can never reach the drafter. |
| ADR 0006 | The protective quantile and the TWL-minus-margin direction are correct. The withdrawal-limit decision feeds the zone builder, and that dependency is correctly listed. |

## Verdict
**Rework before approval, bounded.** The two-layer architecture, the hard-rule table (with the I2/I3/I6 corrections), the governance safeguards and the rejection of weekly and sub-seasonal layers all stand. Four things must be redone before Ali accepts it:
1. The headline numbers (C1, C2, I4).
2. The Layer S do-no-harm rule (C3).
3. The CP-SAT objective order and per-tick caps (C4, I1).
4. B3 scope cut to fit 16 Nov (C5).

The pitch should use the I9 framing.

## How to reproduce the [C] numbers
1. Copy `legal_sleep_templates.py` to a temp dir. Write a driver that adds baselines `((6,11),(15,18))` and `((6,9),(10,12.5),(15,17.5))`, the circadian sleep function `wake − max(end + c + 2, B)` with `wake = start − c − 0.75`, the strict-gap filter, and the guard `other ≤ other[baseline]`. Run it with `uv run --with pandas --with numpy --with pyarrow python -B driver.py <hourly_wbgt.parquet> <dir>`.
2. Copy `within_shift.py`, `extra_analyses.py` and `roster_ladder.py`. Replace `SHIFTS` with the three templates above, use `MIX` 5/6/5, change 17 → 16 slots, and run with `--with scipy`.
