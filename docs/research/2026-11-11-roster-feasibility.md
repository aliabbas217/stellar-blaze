# Multi-horizon heat-aware rostering: is it feasible and worth building? (2026-11-11)

**Question.** Ali's idea: plan in horizons instead of re-optimising shifts daily: (1) a stable seasonal/monthly roster, (2) weekly adjustment from extended-range forecasts if skilful, (3) daily/hourly changes to breaks, task order and crew rotation inside the fixed shift. Is it feasible with open data and literature, and does each layer earn its build cost before the 20 Nov demo?
**Plan reference:** `docs/context/challenge-07-plan.md` §8.3-§8.5; ADR 0005 (data), 0006 (physics), 0007 (ML); `docs/research/2026-11-11-data-availability.md`.
**Run date:** 2026-11-11. Scripts and result files: `docs/research/scripts/roster/` (section 8). No git commands were run.

> **Erratum (2026-11-11, ADR 0011 v2; `docs/research/2026-11-11-planner-adversarial-review.md`).** The **absolute** numbers below (34.6% / 58.0% avoided, 53.1% / 83.0%, 75.0% / 98.1%, and the in-shift 7.8%) are **superseded for any pitch or design use**. They score 8.5 h rosters with 5.5-6.5 h runs, which break Art. 17/18. They also ignore sleep and compare against a non-compliant baseline. Under legal 8 h templates, a clock-time sleep model and a do-no-harm guard, see `scripts/roster/legal_sleep_templates.py` v2 and `results/legal_sleep_templates_output.txt`. Legalising the common roster removes 7.5% at ≥ 30 and 19.1% at ≥ 32 (per worked hour). A sleep-neutral shape change adds 0-10% at ≥ 30 depending on the assumed bedtime. The in-shift forecast gain on legal shifts is 1.8-5.9% (`within_shift_legal.py`). The **horizon comparisons** (fixed ≈ monthly ≈ weekly ≈ daily-forecast) were made on one library and still describe that library. Whether they hold on the legal library is untested [I].
>
> **Superseded by:** [ADR 0033](../decisions/0033-superseded-roster-headline-numbers.md) (2026-11-11), which lists every superseded number and the only replacements allowed in the pitch. The text below is kept unchanged.

## 0. Verdict

**The seasonal layer is feasible and is where nearly all the value is. The weekly layer is not worth building as a roster-changing layer, and the data say so before the forecast question even matters. The daily layer is worth building only inside the fixed shift.** Evidence wins over the framing; the framing's assumptions are corrected in section 6.

| # | Result | Tag |
|---|---|---|
| 1 | With equal work (8.5 productive hours per day), moving from the 06:00-12:30 + 15:00-17:00 baseline to a **fixed** seasonal split roster (04:30-10:00 + 16:30-19:30) avoids **34.6% of worker-hours at WBGT >= 30 and 58.0% at >= 32** (4 stations, 3 summers, leave-one-summer-out choice). Allowing evening work to 22:00 gives 53.1% / 83.0%; a fixed night shift gives 75.0% / 98.1%. | [C] |
| 2 | **Adding adaptivity on top of that fixed roster adds almost nothing.** Share of the daily-hindsight upper bound's avoided >= 30 hours already captured by the fixed seasonal roster: **96%** (day library), 97% (evening library), 96% (night library). Monthly re-roster: 96%, 98%, 96%. Weekly with perfect knowledge: 97%, 98%, 97%. | [C] |
| 3 | **Real archived forecasts do not beat the fixed roster by more than noise.** Weekly re-roster chosen from IFS day 1-7 forecasts (the weekly horizon *is* testable within 9 days): >= 30 h +0.1% (raw) / 0.0% (bias-corrected) vs fixed, >= 32 h -1.0% / -1.1% (6 clusters, day library). Daily re-roster from the lead-1 forecast: -0.2% / -2.0%. With night shifts in the library, forecast-driven daily switching is **worse** than staying fixed (+4.3% at >= 30 h, lead 1 raw). | [C] |
| 4 | **Stability is nearly free.** With perfect knowledge and exactly 0 roster changes per summer the >= 30 exposure is 498 h; allowing 19 changes (weekly) it is 495 h (6 clusters, day library, DP optimum). The best *start* time never changes: it sits at the earliest allowed time (04:30) in 100% of weeks. Only the 30-minute edges of the midday gap move. | [C] |
| 5 | **The daily layer has real, modest value inside the shift**: allocating task intensities to half-hour slots with the lead-1 forecast cuts excess WBGT above the NIOSH REL by **7.8% versus a fixed heavy-first rule** in the early/late shift (1,698 -> 1,565 degC-hours per worker-summer), 0.2% in the baseline shift. Perfect knowledge: 11.4% / 1.2%. | [C] |
| 6 | **Extended range (weeks 2-4): no open archive can back-test it inside 9 days, and published skill for it is close to climatology.** Gulf humidity or WBGT skill at sub-seasonal leads: none found. Even a perfect weekly forecast is capped by item 2. | [D], [Q], [I] |
| 7 | **Start time cannot solve >= 28 °C.** The best fixed evening-extended roster still has 744 of 1,182 scheduled hours at >= 28 (63%); only the night shift gets below 50% (576 h, 49%). Work-rest cycles, acclimatisation, shade and hydration are the controls at that level. | [C], [I] |

**Recommendation in one line:** build (a) a template-roster scorer from station climatology with a hard cap of one roster change per month, (b) a forecast-driven in-shift advisor for task order and break timing (a sort/assignment problem, not a general optimiser), and (c) document weekly and sub-seasonal layers as evaluated-and-rejected with the numbers below. Details in section 5.

### Evidence tags

- **[D]** downloaded or probed live on 2026-11-11 by a script in `docs/research/scripts/roster/` (script named).
- **[C]** computed from [D] numbers (script named).
- **[Q]** quoted from a page I opened myself (URL given).
- **[R]** reported by a research subagent that opened the page; I did **not** re-open it. Treat as unverified.
- **[FIG]** read off a figure by eye (approximate).
- **[I]** my inference. Not measured.

---

## 1. Data and method

### 1.1 Data (all reproducible)

| Item | Source | Notes |
|---|---|---|
| Hourly T, Td, wind | IEM METAR, 8 UAE airports, 15 May-30 Sep 2024-2026 (`fetch_iem.py`, ADR 0005). Raw joint-valid counts re-derived by `build_wbgt.py` match the data doc table (e.g. OMAA 2024: 3,334) [D] | Whole-degree T and Td. Gaps of at most 3 h linearly filled; all 24 station-summers end with 3,306-3,336 of 3,336 valid WBGT hours (`results/wbgt_build_meta.csv`) |
| Radiation, pressure | **Open-Meteo Archive, `models=ecmwf_ifs`** at each station point (`fetch_radiation.py`: 30 requests, about 90 weighted calls) [D] | Stations have no radiation, so **this is the radiation source** (the existing audit script's default archive series equals `ecmwf_ifs`, per its docstring). ERA5 sensitivity in section 2.3 |
| Forecasts | Open-Meteo Previous Runs, `ecmwf_ifs025`, `previous_day1..7` T, Td, wind (already pulled for the data doc) [D] | Leads 1-7 days, full for all three summers |
| WBGT | `thermofeel` 2.3.0 `calculate_wbgt_liljegren`, solar geometry and preceding-hour-mean convention **ported from `D:\dev\future-health-challenge\scripts\audit_wbgt.py`**, ADR 0006 guards (non-finite or implausible result -> NaN) | Truth WBGT = Liljegren(observed T, Td, wind; archive radiation and pressure). Forecast WBGT uses the **same** archive radiation (ADR 0005 "same-radiation") so differences isolate T/Td/wind error |
| Bias-corrected forecast | Additive bias per station, lead and local hour for T, Td, wind, learned on the other two summers (the ADR 0007 "simple bias correction" baseline) | A conservative stand-in for the LightGBM corrector, which does not exist yet |

### 1.2 Rosters, metric, strategies (`roster_ladder.py`)

- **Exposure** E_x = worker-hours at WBGT >= x for x = 28, 30, 32 degC, one worker, one summer (139 local days, UTC+4). A roster block gets overlap weights against hourly labels (06:00-12:30 weights label 06 by 0.5, labels 07-12 by 1).
- **Equal work.** Every candidate in the optimisation libraries has exactly **8.5 productive hours** (the baseline's), so no roster wins by working less. Midday ban 12:30-15:00 is respected in all candidates, on all days (the legal ban is 15 Jun-15 Sep [Q The National, 2026-06-04: "begins on June 15 and runs until September 15"]; applying it all summer is a simplification).
- **Libraries.** DAY (156 rosters: two blocks inside 04:30-19:30), EVE (332: adds evening work to 22:00), ALL (341: adds continuous night shifts starting 19:00-23:00).
- **Pick rule.** Minimise severity = E28 + E30 + E32 (each hour counts 0 to 3).
- **Strategies**, all scored on observed WBGT over the same valid days:
  - `fixed_baseline`: 06:00-12:30 + 15:00-17:00 every day.
  - `seasonal_loso`: one roster per station-summer chosen on the **other two summers** (honest climatology). `seasonal_oracle`: chosen with hindsight (upper bound).
  - `monthly_loso` / `monthly_oracle`: one roster per calendar month.
  - `weekly_clim_loso`, `weekly_persist` (best roster of the previous observed week), `weekly_fc_raw` / `weekly_fc_bc` (chosen on IFS day 1-7 forecasts: day j of the week uses the lead j+1 forecast), `weekly_oracle`.
  - `daily_fc1_*`, `daily_fc3_*` (lead 1 / lead 3 forecast), `daily_persist`, `daily_oracle`.
- **Headline stations:** OMAA (Abu Dhabi coast), OMDB (Dubai coast), OMAL (Al Ain, inland), OMFJ (Fujairah, east coast). Robustness: 6 clusters from ADR 0005 (OMAA, OMDB, OMDW, OMAL, OMFJ, OMRK; OMAD and OMSJ are twins of OMAA and OMDB). All 8 are in the CSVs.

### 1.3 Verification of the computation

- **Independent re-computation** (`verify_ladder.py`, plain loops, no shared code): the baseline's OMAA 2025 E30 is 729.5 h by direct accumulation over 139 days; the pipeline's 724.0 h comes from 138 days (the night roster in the same table needs the next morning's data on 30 Sep). A brute-force scan of all 156 DAY rosters for OMAA 2025 finds the in-sample best at severity 1,327.0 with `04:30-10:30 + 17:00-19:30`; `ladder.csv` reports 1,327.0 [C].
- **Re-run determinism:** after ruff formatting and lint fixes I re-ran the whole pipeline from the cleaned scripts; ten result CSVs are byte-identical [C].
- **Cross-check against plan fact F3.** Plan F3 (model-based, one Abu Dhabi cell): about 58% of daytime hours at WBGT >= 32 in summer 2025. Station-observation-based, 15 Jun-15 Sep 2025, local hours 06-18: **OMAA 43.0%, OMDB 55.4%, OMAL 29.4%, OMFJ 66.3%** [C]. Using this pipeline with IFS lead-1 forecast inputs at OMAA gives 46.9% [C: `profile_and_f3_check.py`], about at F3's lower bound ("between 47% and 58% across the cells"). So F3's 58% is the high end of a different point, not an error in the pipeline; **cite per-station observed numbers in the submission** (section 6).

---

## 2. Results

### 2.1 Named rosters (Task 1, first bullet)

Mean over OMAA, OMDB, OMAL, OMFJ and the 3 summers, worker-hours per 139 days, one worker. "Share" = exposure divided by scheduled hours [C: `named_rosters.csv`, `report_1_ladder.txt`].

| Roster | Hours/day | >= 28 h | >= 30 h | >= 32 h | Share >= 28 / 30 / 32 |
|---|---|---|---|---|---|
| N1 baseline 06:00-12:30 + 15:00-17:00 | 8.5 | 999 | 795 | 481 | 84.6% / 67.3% / 40.7% |
| N2 05:00-12:30 | 7.5 | 783 | 570 | 325 | 75.1% / 54.7% / 31.2% |
| N3 04:30-11:30 + 16:30-18:30 | 9.0 | 930 | 645 | 314 | 74.4% / 51.6% / 25.1% |
| N4 night 20:00-04:30 | 8.5 | 675 | 261 | 14 | 57.1% / 22.1% / 1.2% |
| N5 07:00-12:30 + 15:00-18:00 | 8.5 | 1,067 | 868 | 522 | 90.3% / 73.5% / 44.1% |
| N6 05:00-10:00 + 17:30-21:00 | 8.5 | 816 | 468 | 149 | 69.1% / 39.6% / 12.6% |

N2 and N3 do not have 8.5 hours, so compare their **share** column, not the hour counts. The pattern is monotone: the more of the 10:00-17:00 window a roster contains, the worse it is. Station spread is large: OMAL baseline has 548 h at >= 30, OMFJ 1,026 h; OMFJ's night shift still has 401 h at >= 30 (humid east coast), OMAL's 44 h [C].

Mean WBGT by local hour, June-August, OMAA (other stations within about 1 °C): 06:00 27.0, 08:00 29.3, 09:00 30.9, 10:00 32.0, 13:00 33.4 (peak), 17:00 31.8, 19:00 30.0, 20:00 29.4, 23:00 29.0 [C: `profile_and_f3_check.py`, `results/profile_and_f3_check_output.txt`; the full-window per-hour means are in `results/diurnal_profiles.csv`]. Evening WBGT falls below the late-morning level only after about 18:00.

### 2.2 The horizon ladder (Task 1, second bullet)

Mean per station-summer (OMAA, OMDB, OMAL, OMFJ x 3 summers), worker-hours per 139 days, 8.5 productive hours per day. "Avoided" is relative to the baseline row (N1) at the same threshold [C: `ladder.csv`, `report_1_ladder.txt`]. "Changes" = roster changes per summer between consecutive decision units, mean of the 6 clusters (weeks for weekly rows, days for daily rows) [C: `switches.csv`].

**Day library** (blocks inside 04:30-19:30):

| Strategy | >= 28 h | >= 30 h | >= 32 h | Avoided 28 / 30 / 32 | Changes |
|---|---|---|---|---|---|
| fixed baseline | 998 | 793 | 478 | 0 | 0 |
| (a) seasonal, from other summers | 831 | 519 | 201 | 16.7% / 34.6% / 58.0% | 0 |
| (a) seasonal, hindsight | 832 | 518 | 200 | 16.7% / 34.7% / 58.2% | 0 |
| (b) monthly, from other summers | 831 | 518 | 200 | 16.7% / 34.6% / 58.3% | 1.9 |
| (b) monthly, hindsight | 831 | 517 | 197 | 16.7% / 34.8% / 58.8% | 2.2 |
| weekly, climatology | 832 | 519 | 200 | 16.7% / 34.5% / 58.2% | 10.3 |
| weekly, persistence | 832 | 520 | 203 | 16.7% / 34.4% / 57.6% | 10.2 |
| weekly, IFS day 1-7 forecast (raw) | 832 | 519 | 200 | 16.7% / 34.6% / 58.2% | 9.7 |
| weekly, IFS day 1-7 forecast (bias-corrected) | 832 | 519 | 200 | 16.6% / 34.6% / 58.1% | 10.6 |
| (c) weekly, perfect knowledge (upper bound) | 831 | 515 | 193 | 16.7% / 35.1% / 59.7% | 9.9 |
| daily, persistence | 835 | 526 | 206 | 16.4% / 33.7% / 56.9% | 50.7 |
| daily, lead-3 forecast (raw) | 832 | 520 | 202 | 16.6% / 34.5% / 57.8% | 39.8 |
| daily, lead-1 forecast (raw) | 832 | 518 | 197 | 16.6% / 34.7% / 58.7% | 39.3 |
| (d) daily, perfect knowledge (upper bound) | 829 | 507 | 179 | 16.9% / 36.1% / 62.5% | 49.9 |

**Evening library** (adds evening work to 22:00) and **night library** (adds night shifts) [C]:

| Strategy | Evening: >= 30 h / >= 32 h | Evening: avoided 28 / 30 / 32 | Night: >= 30 h / >= 32 h | Night: avoided 28 / 30 / 32 |
|---|---|---|---|---|
| fixed baseline | 793 / 478 | 0 | 795 / 481 | 0 |
| (a) seasonal, from other summers | 372 / 81 | 25.4% / 53.1% / 83.0% | 199 / 9 | 42.3% / 75.0% / 98.1% |
| (b) monthly, from other summers | 370 / 80 | 25.4% / 53.4% / 83.2% | 199 / 9 | 42.3% / 74.9% / 98.1% |
| weekly, IFS day 1-7 forecast (raw) | 370 / 80 | 25.5% / 53.4% / 83.2% | 204 / 11 | 40.9% / 74.3% / 97.8% |
| (c) weekly, perfect knowledge | 367 / 78 | 25.6% / 53.8% / 83.6% | 196 / 8 | 42.5% / 75.4% / 98.3% |
| daily, lead-1 forecast (raw) | 369 / 80 | 25.3% / 53.4% / 83.2% | 207 / 17 | 41.1% / 74.0% / 96.4% |
| daily, persistence | 378 / 87 | 24.9% / 52.4% / 81.8% | 241 / 31 | 38.8% / 69.7% / 93.5% |
| (d) daily, perfect knowledge | 359 / 74 | 25.9% / 54.8% / 84.6% | 177 / 9 | 46.2% / 77.8% / 98.0% |

**Reading.**

1. The big step is **roster shape**, not roster timing: baseline to the best fixed day roster removes 35% of the >= 30 hours and 58% of the >= 32 hours; evening work to 22:00 removes 53% and 83%; a night shift 75% and 98%. These gains come from one simple pattern: **start as early as allowed, stop before about 10:00, restart after about 18:00 (or work at night)**. The optimiser sits at the library bounds (04:30 start, 19:30 or 22:00 end, 23:00 night start) in the chosen rosters (`results/chosen_rosters.csv`). So the numbers depend on operational bounds I did not validate (lighting, noise rules, fatigue, permits), though the direction is robust [I].
2. Every horizon from seasonal to weekly-oracle sits within 1 percentage point of the others at >= 30 h. The only visible headroom is the daily upper bound at >= 32 h (62.5% vs 58.0% in the day library, 4.5 points), and that is a roster that changes every day, which the stability requirement forbids.
3. **Forecast-driven daily switching is not an improvement.** In the day library lead-1 raw is +0.7 points at >= 32 (58.7% vs 58.0%), lead-3 is -0.2; with night shifts in the library daily forecast choices are worse than a fixed roster (74.0% vs 75.0% at >= 30; 96.4% vs 98.1% at >= 32) because the night/day decision flips on forecast error at a knife-edge threshold. Daily persistence is worse than fixed in every library.
4. The pattern holds in each summer (4-station day library, avoided >= 30: seasonal 33.0 / 37.1 / 33.6% for 2024 / 2025 / 2026; daily oracle 34.2 / 38.8 / 35.3%) and in each of the 8 stations (day library seasonal avoided >= 30 from 22.2% at OMFJ to 58.7% at OMAL; the daily oracle adds 0.5 to 3.5 points; `report_4_per_station.txt`) [C].

### 2.3 Is the difference between rungs larger than the noise?

Paired differences against the fixed seasonal roster, per station-summer, 6 clusters x 3 summers = 18 pairs, day library [C: `report_2_paired_frontier.txt`]:

| Strategy vs seasonal_loso | >= 30 h diff (% of seasonal) | better / worse of 18 | >= 32 h diff (% of seasonal) | better / worse of 18 |
|---|---|---|---|---|
| monthly, from other summers | -0.2 h (0.0%) | 7 / 7 | -1.4 h (-0.8%) | 12 / 3 |
| weekly, IFS forecast raw | +0.3 h (+0.1%) | 6 / 9 | -1.9 h (-1.0%) | 9 / 5 |
| weekly, IFS forecast bias-corrected | 0.0 h (0.0%) | 7 / 6 | -2.1 h (-1.1%) | 12 / 5 |
| weekly, perfect knowledge | -3.5 h (-0.7%) | 16 / 0 | -9.3 h (-4.8%) | 18 / 0 |
| daily, lead-1 forecast raw | -1.0 h (-0.2%) | 8 / 5 | -3.8 h (-2.0%) | 13 / 4 |
| daily, perfect knowledge | -11.7 h (-2.3%) | 18 / 0 | -24.3 h (-12.7%) | 18 / 0 |

(6-cluster seasonal means are 500 h at >= 30 and 191 h at >= 32; the 4-station ladder above has different means, 519 h and 201 h, so numbers across the two tables are not directly comparable.)

**Noise floor** [C: `sensitivity.py`]: adding U(-0.5, +0.5) °C noise (a proxy for METAR whole-degree rounding, applied on top of any existing rounding, so an upper bound) to T and Td moves a roster's E28/E30/E32 by an SD of 1.2-3.1 worker-hours per summer (OMAA, OMDB, 20 draws). Swapping the radiation source from the IFS archive to ERA5 moves them by 0.1-4.7% (largest: OMDB best day roster at >= 32: 221 vs 212 h). Differences below about 4 h per summer (monthly, weekly-forecast) are therefore **not distinguishable from zero**; only the perfect-knowledge weekly and daily rows clear the floor, and they are not achievable.

### 2.4 Stability of the diurnal pattern (Task 1, third bullet)

| Question | Result | Tag |
|---|---|---|
| Does the best **start** time change week to week? | **No.** Weekly-hindsight best roster has morning start 04:30 in 100% of weeks (day and evening libraries), because earlier is cooler up to the bound | [C] `weekly_best_rosters.csv` |
| Does the best **roster** change? | In the day library 49.7% of week-to-week transitions change the morning-block end by 30 min or more (ends 09:00-11:00; 09:30 26%, 10:00 29%, 10:30 25%); in the evening library 25% (ends 09:00 64%, 09:30 35%). Roster changes per summer for the weekly-hindsight choice: 9.9 (day), 5.2 (evening) | [C] |
| Does it matter? | Holding the seasonal roster costs a median **0.4%** of that week's severity in the day library (0.0% evening); 81% of weeks are within 2% and 95% within 5%; 99th percentile 11% | [C] `weekly_regret.csv` |
| Summer-to-summer diurnal profile | Mean absolute difference between summers' mean hourly profiles 0.21-0.53 °C (max over hours 0.51-0.85 °C); Spearman of the 24-point profile at least 0.99 (strongly diurnal, so high by construction) | [C] `diurnal_stability.csv` |
| Week profile vs other summers | Median Spearman 0.983, 10th percentile 0.93, minimum 0.81; the coolest hour equals the other summers' coolest hour in 60.8% of weeks and is within 1 h in 82.5% | [C] |
| Time WBGT first reaches 30 °C (local) | Station mean 06:36 (OMFJ) to 09:42 (OMAL); SD 73-111 min total, **52-86 min within a week**, only 37-51% of the variance is between weeks | [C] `first_hour_ge30.csv` |
| Stability-vs-exposure frontier (day library, 6 clusters, exact DP over weeks, hindsight): allowed changes per summer 0 / 1 / 2 / 3 / 6 / 14 / 19 | >= 30 h: 498 / 497 / 496 / 496 / 495 / 495 / 495; >= 32 h: 189 / 187 / 185 / 184 / 183 / 181 / 181 (baseline 790 / 482). Changes chosen from climatology instead of hindsight never beat a single seasonal roster by more than 3 h (>= 32 h 188-191 for every k) | [C] `frontier.csv` |

**Conclusion.** Day-to-day variability in when heat starts (about an hour) is larger than the week-to-week drift of the pattern. A weekly layer cannot see the day-to-day part, and a fixed roster that ends the morning block before about 09:30-10:00 already clears it. The free-form bound (any 17 half-hour slots per day, no roster template) says the same: daily hindsight beats the best fixed pattern by 12 h at >= 30 and 27 h at >= 32 in the day window (2.4% / 14.5% of the fixed pattern's hours; 1.5% of the baseline's >= 30 hours), 20 h / 14 h with evening work, 35 h / 4 h with night work [C: `freeform.csv`]. These are the absolute ceilings for any daily adaptation of working hours.

### 2.5 Within-shift daily layer (the part of the design that survives)

Fixed shift, 17 half-hour slots, assumed mix 5 light (180 W), 7 moderate (300 W), 5 heavy (415 W); limit per task = NIOSH REL (acclimatised) = 56.7 - 11.5 log10(M): 30.76 / 28.21 / 26.59 °C [C, matches ADR 0006 test vectors]. Metric: excess WBGT above the task's REL, degC-hours per worker per 139 days, observed WBGT, 6 clusters x 3 summers [C: `within_shift.py`].

| Task order strategy | Baseline shift 06:00-12:30 + 15:00-17:00 | Early/late shift 04:30-10:00 + 16:30-19:30 |
|---|---|---|
| random order (expected value) | 3,505 | 2,005 |
| fixed rule: heavy first | 3,171 | 1,698 |
| exact assignment on lead-3 forecast (raw / bias-corrected) | 3,178 / 3,198 | 1,585 / 1,602 |
| exact assignment on lead-1 forecast (raw / bias-corrected) | 3,165 / 3,179 | 1,565 / 1,578 |
| exact assignment, perfect knowledge | 3,133 | 1,505 |

In the early/late shift the lead-1 forecast improves on the heavy-first rule by 7.8% and perfect knowledge by 11.4%; in the baseline shift there is almost nothing to gain (0.2% / 1.2%) because the hours are all hot. Hours above REL stay high regardless: 78-86% of the 1,182 scheduled hours in the baseline shift and 59-64% in the early/late shift (e.g. 699 h heavy-first, 755 h perfect-knowledge-optimised; the optimiser minimises excess degrees, which can raise the count of marginal hours) [C]. So at NIOSH REL levels almost every UAE summer outdoor hour is over the limit for moderate-to-heavy work; **the in-shift layer's job is mostly work-rest timing and intensity matching, not avoiding the limit**.

### 2.6 What week-2-to-4 information could add, from the data alone

- Upper bound: perfect weekly knowledge adds 0.7% (>= 30) and 4.8% (>= 32) over fixed in the day library, 1.6% / 3.8% in the evening library, and in the night library 2.5 h and 0.4 h per summer (1.6% / 6.5% of a very small base) (section 2.3 and `report_2_paired_frontier.txt`) [C]. A forecast at week 2-4 with any realistic skill captures a fraction of that.
- Predictability from the data itself, using the daily-mean 08:00-17:59 WBGT anomaly relative to the other summers' smoothed climatology (6 clusters; `anomaly_persistence.py`) [C]: daily anomaly SD 1.23 °C; autocorrelation at lag 1 / 2 / 3 / 7 / 14 days = 0.50 / 0.22 / 0.14 / 0.04 / -0.06; **weekly-mean anomaly autocorrelation at lag 1 / 2 / 3 / 4 weeks = 0.22 / -0.16 / -0.19 / +0.05**, i.e. in-sample persistence MSE skill of about 15% at one week ahead and about 0-2% at 2-3 weeks (the 7% at lag 4 is noise: 19 weeks x 3 summers per station, standard error of a correlation about 0.13). Station-level week-1 autocorrelation ranges 0.07 (OMAL) to 0.56 (OMFJ).
- IFS day-1 WBGT error in this pipeline (15 Jun-15 Sep 2025, local 06-18): MAE 0.91 / 0.99 / 0.95 / 1.38 °C raw and 0.84 / 0.86 / 0.87 / 1.42 °C bias-corrected at OMAA / OMDB / OMAL / OMFJ [C: `profile_and_f3_check.py`], comparable to the 1 °C scale at which a 28/30/32 threshold count flips.

---

## 3. Extended-range feasibility (Task 2)

### 3.1 Which open sources could drive a weekly or monthly horizon, and can they be back-tested?

All probes run on 2026-11-11 against OMAA (24.433 N, 54.651 E) with standard TLS verification.

| Source | Horizon and variables | Archive for back-testing summers 2024-2026? | Verdict |
|---|---|---|---|
| Open-Meteo **Previous Runs** (IFS 0.25 deg) | Days 1-7; T, Td, wind, radiation | Yes, full three summers [D, data doc] | **Used here.** Covers weekly decisions made from a 7-day forecast |
| Open-Meteo **Seasonal API** (ECMWF EC46 + SEAS5) | EC46 46 days daily-updated, 36 km, "Data is available for 51 ensemble members", daily T, Td, RH, wind, shortwave; SEAS5 up to 7 months [Q open-meteo.com/en/docs/seasonal-forecast-api]. Probe: daily T/Td/RH/wind/radiation returned for 2026-11-11 to 2026-12-26, 50 member columns [D `probe_seasonal_api.py`] | **No.** `past_days` returns values only for the last 32 days (92-day request: 60 leading nulls; 400-day request: 368 nulls = 446 - 78); explicit windows for 2025-09, 2026-01-03 and 2026-06-08 are **all null**; the API's own message says `start_date` is "out of allowed range from 2025-09-01 to 2027-06-15" for earlier dates [D `probe_seasonal_api2.py`]. The docs say individual members are "only kept for one month" [Q] | Usable as a **live display**; cannot be validated; `six_hourly` with my variable names returned no data (untested whether other names work) |
| Open-Meteo **Ensemble API** | GFS 0.5 deg ensemble up to 35 days, ECMWF IFS ENS 0.25 deg and AIFS 15 days [Q open-meteo.com/en/docs/ensemble-api]; probe populated 34.1 days (GFS 0.5), 14.6 days (IFS ENS), 10.1 days (GFS 0.25) [D] | "You can retrieve up to three days of historical data" [Q] | No archive |
| **NOAA GEFS** on AWS (`noaa-gefs-pds`) | 35-day files exist: `gefs.20250716/00/atmos/pgrb2ap5/gec00.t00z.pgrb2a.0p50.f840` (and 2025-07-09); the f840 index lists `TMP`, `RH`, `TMAX`, `TMIN` at 2 m, 10 m `UGRD/VGRD`, `DSWRF`, and the `pgrb2bp5` file adds `DPT` 2 m and `SPFH` [D, anonymous HTTPS listings and `.idx` reads]; `noaa-gefs-retrospective` has `GEFSv12/reforecast/<year>/` folders from 2000 [D] | **Yes in principle**: operational archive on AWS plus reforecasts. Not decoded | A WBGT-grade input set exists at day 35. Cost for a control-member-only back-test of the 60 summer initialisations (20 weekly x 3 summers) at 6-hourly steps from day 8 to 35: about 20,000 byte-range requests and 4 GB; 31 members about 600,000 requests [I, from the `.idx` byte offsets: 2 m T 141 kB, RH 218 kB]. GRIB2 decoding on this Windows host untested. A multi-day build, not for 20 Nov |
| **NOAA CFSv2** on AWS (`noaa-cfs-pds`) | `cfs.20250716/00/6hrly_grib_01/flxf*`: 6-hourly files past 4 months, index lists `TMP` 2 m, `SPFH` 2 m, 10 m wind, `DSWRF` [D] | Yes in principle (same build cost class) | Not pursued |
| **ECMWF S2S database** (ECDS) | 46-day, ECMWF CY49R1 licence CC BY 4.0, real-time delay 48 h; NCEP CFSv2 CC BY 4.0, 48 h; UKMO 3 weeks; CMA BCC-CPS-S2Sv2 "CC BY NC 4.0" [Q confluence.ecmwf.int/display/S2S/Models]; ECDS page: "allowed with a delay of 48 hours or 1 week depending on the centre"; shows "Login - Register" [Q ecds.ecmwf.int/datasets/s2s-forecasts] | Reforecasts "can be accessed without any restrictions" [R, ECDS licence page, not re-opened] | Needs a registered account; not tested. The "3-week delay" in the 2025 BAMS paper is out of date [Q: that paper still says it; the Confluence page lists 48 h] |
| ECMWF **open real-time catalogue** | "ECMWF has today (1 October 2025) made its entire Real-time Catalogue open to all"; CC-BY-4.0; "S2S Data (sub-seasonal range)" is listed among the free datasets [Q ecmwf.int/node/29497]; whether EC46 is in the open subset, and reforecasts, are **not stated** [Q]. The open-data AWS bucket describes medium-range products only [R] | Not stated | Do not rely on it |

### 3.2 Published skill at weeks 2-4 (what I verified, and what I did not)

- **Global, temperature:** "the multi-model ensemble is more skilful than climatology calculated over the common period 2003-2010 up to week 4 for 2-meter temperature and week 3 for precipitation over most land areas ... the decrease is much slower in the Tropics than at high latitudes, so that by week 3, most of the skill is located in the tropical regions" [Q Vitart et al., BAMS 2025, doi:10.1175/BAMS-D-24-0047.1; I extracted the text from the accepted manuscript PDF]. Approximate land-mean tercile RPSS of weekly 2 m temperature read off its Fig. 4: about 0.30 at days 8-14, 0.14 at 15-21, 0.09 at 22-28 for 2021-23 [FIG, research subagent; the Fig. 4 caption is verified, the bar values are not]. Weeks 3-4 are therefore a small fraction of week 1-2 skill, against a fixed-period climatology that does not remove the warming trend [I].
- **AI era:** ECMWF's AI Weather Quest mid-year report: "surpassing climatology at lead time of 3-4 weeks remains challenging" and "added value for temperature and pressure remains limited to post-processing techniques" [Q ecmwf.int/en/newsletter/187/news/ai-weather-quest-mid-year-global-participation-and-first-insights].
- **Arabian Peninsula:** one 2026 QJRMS paper downscales ECMWF reforecasts (1998-2017) with a 4 km, 11-member WRF ensemble and reports, for daily **Tmax** only, that ECMWF has "pronounced cold biases exceeding -2 °C" and underestimates hot-day frequency by about 30 days while WRF is within +/-1 °C and about +/-10 days, with lower CRPS and higher Brier skill score than ECMWF at weeks 3-4 [Q, abstract summary via the Crossref record of doi:10.1002/qj.70265; no skill values in the abstract; I could not open the full text]. Much of that gain is bias removal [I]. **No humidity, dew-point or WBGT result for the Gulf at sub-seasonal leads was found** after about 8 targeted searches by the subagent [R].
- **Humid heat elsewhere:** WBGT post-processed from IFS extended range beat a climatological reference up to about 15-20 days for European sites (workshop abstract, not peer reviewed) [R]; West African wet-bulb heat waves beyond 2 weeks are sub-optimal [R]. Neither is the Gulf.
- **Not found:** any source separating trend from dynamical skill at weeks 3-4; any BSISO-to-Gulf teleconnection result (one source says BSISO northward-propagation skill "does not exceed 2 weeks" [R]).

### 3.3 Decision

**A weekly horizon can be driven by real forecasts within 9 days only up to day 7** (IFS Previous Runs, done above, result: no gain beyond noise). **Weeks 2-4 can be driven only by climatology plus persistence**: no open archive allows a back-test by 20 Nov, published skill at weeks 3-4 is close to climatology and is not documented for Gulf humidity, and the data's own persistence decays to roughly zero after one week (section 2.6). A live EC46 daily 46-day outlook is obtainable from Open-Meteo's free (non-commercial) API as **context**, labelled unvalidated, outside every safety decision.

---

## 4. Method scan (Task 3)

Sources I opened myself are marked [Q]; the rest were reported by a research subagent [R] and are not verified.

| Topic | Source and finding | Tag |
|---|---|---|
| Value of stochastic planning vs a deterministic plan | Kim & Mehrotra, Operations Research 63(6):1431-1451, 2015 (nurse staffing): the two-stage stochastic model "leads to a significant cost savings" vs deterministic and "The cost savings increase with mean absolute percentage errors in the patient volume forecast" | [Q] |
| Rolling-horizon value | McKinnon & Schulze, Edinburgh ERGO 15-010, 2015 (unit commitment, rolling horizon over two years): "the stochastic approach saves 0.3% of generation costs compared to the best deterministic approach" day-ahead, "the savings are less in intraday scheduling" | [Q] |
| Multi-stage vs two-stage; regularity vs flexibility | Zhang, Tang, Lau, arXiv:2505.22124, 2025 (preprint): "all VSSs are positive"; "a small reduction in the regularity level from 0.6 to 0.4 could remarkably bring higher flexibility" | [R] |
| Cost of last-minute changes; robust buffers | Wickert, Smet, Vanden Berghe, "Quantifying and enforcing robustness in staff rostering" (KU Leuven preprint): repair "often require last-minute changes to rosters, negatively affecting employees' personal lives" | [R] |
| Survey | Van den Bergh et al., EJOR 226(3):367-385, 2013: uncertainty is the classification field "not discussed in any of the review papers"; personnel scheduling "offers an ideal framework for the use of constraint programming methods" | [R] |
| CP-SAT mechanics | OR-Tools docs (github `ortools/sat/docs/model.md`, section "Solution hinting"): "A solution hint is not a hard constraint." and "Solution hints don't need to use all variables: partial solution hints are fine." The official `shift_scheduling_sat.py` example uses weighted soft penalty terms. No official recipe for deviation-from-previous-plan stability or chance constraints | [Q] hints, [R] example |
| Heat-aware schedule optimisation | Yi & Chan, J. Comput. Civ. Eng. 29(5), 2015 (Hong Kong): simulation of the baseline plus 21 additional fixed work patterns; optimised pattern direct-work rate 87.8%, "working from 7:30 a.m. to 12:00 p.m. with a 20 min break at 9:40 a.m."; baseline "start work at 8:00 a.m. and finish work at 6:00 p.m." Also Yi & Chan 2013 (Building and Environment), Yi & Wang 2017 (MILP, "up to 10%" productive time vs a default work-rest schedule). Gulf/Australia/US: none found | [Q] 2015, [R] others |
| Practice | NIOSH: "Use a heat alert program whenever the weather service forecasts a heat wave"; UAE ban 12:30-15:00, 15 Jun-15 Sep; OSHA heat-rule status uncertain (secondary source) | [R], [Q] ban |

**What the literature supports.** (1) Fixed seasonal templates: supported as the legal baseline and as the design object of the heat-scheduling papers; no source quantifies fixed vs adaptive for heat, so **the quantification in this note is new evidence**, within its limits. (2) Weekly and daily re-planning: the verified rolling-horizon study found small gains that shrink at shorter horizons, which agrees with this data; instability cost is documented qualitatively, not as a price. (3) CP-SAT: soft penalties and non-binding hints are official; stability and chance constraints must be hand-modelled.

**Simplest defensible method** [I, reasoned from sections 2 and 4]:

1. **Roster choice = enumerate and score.** Hard constraints (ban, hours) as filters; score each template on station climatology (exact argmin; no solver needed at 156-341 templates). A stability rule is a hysteresis: change only at a month boundary, and only if the new template beats the old by more than the noise floor (about 4 worker-hours per summer here). This is the same answer the DP frontier gives exactly.
2. **In-shift allocation = sort or assignment.** Heavy tasks into the coolest slots; Hungarian/CP-SAT equivalent. CP-SAT earns its place only when tasks have deadlines, dependencies and crew-rotation constraints (plan §8.5), where soft penalties and a hint from the previous solution are documented features.
3. **Weekly layer = exception trigger, not a re-roster.** Weekly hold-vs-best regret exceeds 5% of that week's severity in about 5% of weeks (day library); a forecast-based trigger for those weeks is a hypothesis to test, not something this data supports yet.

---

## 5. Recommendation and what is demo-able by 20 Nov

| Layer | Build? | What it is | Demo by 20 Nov | Evidence |
|---|---|---|---|---|
| Seasonal/monthly roster | **Yes** | Template scorer on observed-station climatology, per site, vs the 06:00-12:30 + 15:00-17:00 baseline, with exposure at >= 28/30/32 and the stability rule | **Yes**: all inputs exist; the numbers are in `results/ladder.csv`, `named_rosters.csv`, `chosen_rosters.csv`. About 1-1.5 days of UI | Sections 2.1-2.2 |
| Stability evidence | **Yes (chart only)** | Frontier chart (exposure vs allowed changes) and the weekly-regret histogram as the justification for "fixed roster" | **Yes**: static from `frontier.csv`, `weekly_regret.csv`; about half a day | Section 2.4 |
| Weekly re-roster | **No** | Documented as evaluated and rejected: perfect weekly knowledge adds at most 0.7% / 4.8% (>= 30 / >= 32 h); IFS day 1-7 adds 0.0-0.1% / 1.0-1.1% (below noise) | Document only | Sections 2.2-2.3 |
| Weekly outlook (informational) | Optional | 7-day post-processed forecast shown for planning acclimatisation, hydration, staffing; no roster change | If the corrector (ADR 0007) is ready | Section 2.6 |
| Sub-seasonal feed | **No** | Live EC46 panel optional as unvalidated context; GEFS/CFS back-test costed but not run | Document only | Section 3 |
| Daily in-shift advisor | **Yes** | Lead-1 to 3 corrected WBGT -> task-intensity allocation and break timing against NIOSH REL, plus the alert levels already planned; counterfactual vs heavy-first | **Yes** once B2/B3 exist: the allocation is about 30 lines (assignment on a 17x17 cost matrix; verified exact), the corrector and policy engine are the real work | Section 2.5 |
| Multi-stage stochastic / robust optimisation | **No** (parking lot) | Literature shows gains of 0.3% (rolling horizon) to "significant" (large forecast error); our ceiling analysis shows no headroom at roster level | Document only | Sections 2.3, 4 |

Documented-but-not-built items to add to `docs/parking-lot.md` (not edited here): exception-triggered weekly re-roster test; GEFS/CFSv2 week 2-5 back-test (cost estimate in section 3.1); shoulder-season (Mar-May, Oct-Nov) replication; site-sensor validation of the roster ranking; a cost model for early/late/night work (lighting, noise, fatigue, wage) so the bounds are priced rather than assumed.

---

## 6. Corrections to the framing and to the plan (evidence wins)

1. **"Weekly adjustment from extended-range forecasts" is the wrong lever.** The ceiling on weekly adaptation of shift times is below 1% of >= 30 exposure, and a 7-day forecast already reaches that ceiling's noise level. Sub-seasonal skill is moot.
2. **The expensive horizon is not the one that changes.** Value comes from the *shape* of the fixed roster (midday gap, early start, evening or night work). This is simple, rule-expressible and independent of forecast quality.
3. **"Stability costs a lot" does not hold on this data**: 0 changes vs 19 changes per summer differs by 3 h at >= 30 (day library, hindsight).
4. **Start-time shifting cannot meet the >= 28 °C level**; the plan's work-rest, acclimatisation and PPE layers (plan §8.2, §8.4) carry that, and should be the demo's headline for moderate-to-heavy work.
5. **Plan F3 (58%)** is the model-based high end; observed station numbers are 29-66% by station (section 1.3). State per-station observed values and the method.
6. **Plan §8.5 "plan against the upper quantile"** is untested here (these results use point forecasts); it remains an untested safety margin, not a measured improvement.

---

## 7. Limitations and what I did not verify

- **WBGT truth is derived** (A2): observed T, Td, wind plus archive radiation and pressure. No on-site globe or wet-bulb data. Radiation source changes exposures by 0.1-4.7%; rounding noise by SD 1-3 h [C].
- **Airports, not worksites.** Shade, surfaces, PPE and metabolic load shift absolute levels; the hourly ranking that drives the results should be more robust than the levels [I, unverified].
- **Three summers, 4-6 independent sites**, 18 station-summers; the OMDB/OMSJ pair share a forecast cell. No claim beyond held-out airports.
- **The optimum sits on the library bounds** (04:30 start; 19:30, 22:00 end; 23:00 night start). The numbers depend on those bounds, which I did not validate operationally.
- **Threshold metrics saturate**: >= 28 is exceeded in 80-100% of hours between 09:00 and 17:00 in the interior of the season, so adaptation shows only at >= 30 and >= 32.
- **Hindsight rows are upper bounds**; "from other summers" rows use the other two summers (including future summers for 2024 and 2025: leave-one-out, not forward-chained).
- **Forecast-driven rows use IFS 0.25 deg only**, raw and a simple additive bias correction, not the LightGBM/CQR corrector (not built) and not AIFS/GFS. A better corrector cannot exceed the perfect-knowledge rows.
- **Only May-September.** Shoulder seasons (Oct-Apr) are unmeasured; adaptation value might be higher where WBGT straddles 28-30 for more of the day.
- **Weeks are 7-day blocks anchored at 15 May**, not ISO weeks. Equal 8.5 productive hours is an assumption that ignores that early/late/night work has costs.
- **Literature:** items tagged [R] were not re-opened. I verified by opening: Vitart et al. 2025 quotes, the AI Weather Quest newsletter quotes, the ECMWF open-catalogue announcement, the S2S licence table, McKinnon & Schulze, Kim & Mehrotra, Yi & Chan 2015, the OR-Tools hint text. The Saharwardi et al. abstract was read only as a summary through the Crossref record; the Wiley page returned 403 to the subagent.
- **Not tested:** ECDS S2S registration and download; GRIB2 decoding of GEFS/CFS on this Windows host; the Open-Meteo `six_hourly` parameter names for the seasonal endpoint; whether GEFS 35-day runs exist on days other than the two Wednesdays listed.
- **Licence:** the free Open-Meteo APIs are non-commercial (ADR 0005); the radiation pull here uses the same disclosed free tier. About 90 weighted calls plus about 10 probe calls were used today.

---

## 8. Reproduction

Python 3.14 via `uv run --no-project --with <pkgs> python -I -X utf8 <script>` (`-X utf8` because the Windows locale codec is gbk). The forecast JSON files from `fetch_forecast_stations.py` were written in the locale codec; `build_wbgt.py` reads them with a utf-8-then-gbk fallback. Lint: ruff 0.17.4, line length 140, rules E,F,W,I,B,UP,SIM,C4, all clean; not mypy-typed, no tests (research tooling, as in the data doc).

```text
# prerequisites from the data doc: data/iem, analysis out/hourly_iem (analyze_obs.py), data/forecast_stations (fetch_forecast_stations.py)
fetch_radiation.py <archive_dir>                         # requests; 30 Open-Meteo archive pulls (IFS 9 km x 8 stations, ERA5 x 2)
check_archive.py <archive_dir>                           # 3,336 rows, no nulls
build_wbgt.py <an_out> <fc_stations> <archive> <out>     # thermofeel==2.3.0 pandas numpy pyarrow -> hourly_wbgt.parquet
roster_ladder.py <hourly_wbgt.parquet> <out/ladder>      # named rosters, ladder, switches, frontier, chosen rosters
extra_analyses.py <hourly_wbgt.parquet> <out/extra>      # + scipy: freeform bound, weekly regret, diurnal stability
within_shift.py <hourly_wbgt.parquet> <out/extra>        # + scipy: task-intensity allocation vs NIOSH REL
anomaly_persistence.py <hourly_wbgt.parquet> <csv>       # week-scale persistence of WBGT anomalies
sensitivity.py <an_out> <archive> <csv>                  # radiation source and rounding noise
verify_ladder.py <hourly_wbgt.parquet> <out/ladder>      # independent brute-force cross-check
probe_seasonal_api.py, probe_seasonal_api2.py <dir>      # Open-Meteo seasonal / ensemble probes (requests)
summarise.py, summarise2.py, summarise3.py, per_station_tables.py <out dirs>   # tables used here
```

`docs/research/scripts/roster/results/` holds every CSV and the printed report text the tables above were copied from (`report_1_ladder.txt` through `report_4_per_station.txt`, `*_output.txt`). The 12.5 MB `hourly_wbgt.parquet` is not committed; `build_wbgt.py` rebuilds it in about 13 seconds. `profile_and_f3_check.py <hourly_wbgt.parquet>` prints the June-August hourly profile and the plan-F3 cross-check.
