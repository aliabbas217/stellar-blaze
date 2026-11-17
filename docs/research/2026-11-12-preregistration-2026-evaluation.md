# Pre-registration: the held-out 2026 evaluation of Stellar Blaze

- **Written:** 2026-11-12 (Thu), by the architect (Claude) for Ali.
- **Status:** DRAFT. It is binding only once Ali approves it and it is committed (§13). Every 2026 number must come from a commit that descends from that commit.
- **What it fixes:** the hypotheses, splits, metrics, baselines, policies, thresholds (or the rules that set them), the demo-day algorithm, the issue-time convention, the uncertainty method, what counts as a negative result, and the one command that produces every 2026 number.
- **What it leaves open:** results only, written as `⟨slot⟩`. Three groups of values are not yet decided: B3's ruleset values, the warning thresholds θ, and the crew fixture. These are frozen by a **freeze addendum** (§11) before the Warnings and Plans rows are scored. Each has a rule fixed here, and each is set from 2024-2025 data or from regulation, never from 2026.
- **Name.** This is the "evaluation protocol" that ADR 0034 §3, the Judges doc v2 §4.3 and §8.1 and the B3 planner notes §5 call `docs/research/2026-11-12-evaluation-protocol.md`. Those references should point here (§14, item 4).
- **Inputs:** ADR 0005, 0006, 0007, 0009, 0010, 0011 (§9), 0019, 0020, 0034; the data-availability research (§5-§7); the Judges doc v2 (§4.2-§4.6, §8); the backend ML stack research (§6.1-§6.2); the gold dataset manifest `docs/research/2026-11-12-gold-dataset-manifest.json` (gold `pairs.parquet` SHA-256 `8124c86c6f3ff55c40184f85be06b54a9ed289cdba1a625347efe4809544a1db`, code `64efe24`).

---

## 0. Three findings that change the claims (read first)

1. **The stamp "forecast as issued at 18:00 the evening before" is not true for every working hour if we use the Open-Meteo `previous_day1` series.**
   - Open-Meteo defines `_previous_day1` as "the value predicted 24 hours before valid time" (Previous Runs API docs, fetched 2026-11-12). The page does not name the run.
   - ECMWF disseminates the 12 UTC IFS run from about 17:45 to 19:34 UTC, which is 21:45-23:34 GST. The 06 UTC run goes out from about 11:45 to 13:34 UTC, which is 15:45-17:34 GST (ECMWF dissemination schedule, Confluence "Dissemination schedule", Set I). Open data are released at or after the end of that schedule.
   - So at 18:00 GST (14:00 UTC) on day D-1, the newest IFS run anyone could hold is **06 UTC D-1**. A 24 h-before value for 12:00-14:59 UTC on day D (16:00-18:59 GST) comes from a run initialised near 12 UTC D-1, which nobody had by 18:00 GST. The leak is at most about 6 hours of model information, but the stamp would be false.
   - **Fix, pre-registered (§4):** the headline uses `lead_days = 1`, worded "**forecast made about 24 hours ahead**". A **strict-availability sensitivity** uses `lead_days = 2`, whose values come from runs published well before 18:00 GST the evening before, and is shown next to it. The words "issued at 18:00 the evening before" are used only for the `lead_days = 2` numbers. B2 Task 2 measures which run feeds `previous_day1` (Single Runs API, 2025 dates only) and records it. If the audit shows `previous_day1` always comes from a run published by 18:00 GST D-1, an amendment may restore the original wording. The numbers do not change.
2. **"2026 was never looked at" would be false.** Raw-forecast diagnostics on 2026 were computed and read on 11-12 Nov (§10). The true claim is narrower: no corrector output, threshold, warning, plan or day has been computed on 2026, and nothing selected below used 2026.
3. **The demo site is a known site.** OMAA is in the 2024-2025 training data. The OMAA scoreboard is regime (a): known site, unseen summer. The "new site" claim rests only on regimes (b) and (c), and it says "held-out airport clusters" (ADR 0005), never "any worksite". The stamp "summer never seen in training" is true; "site never seen" is not, and is never said.

---

## 1. Hypotheses

Each hypothesis is tested on 2026 **once**, with the frozen model (§11.2) and the definitions below. "Beats" means the paired 95% block-bootstrap interval of the difference (§8) excludes zero in the stated direction.

| ID | Hypothesis | Row | Primary? |
|---|---|---|---|
| **H1** | For T and Td (each), the corrector's calibrated 19-level forecast has a lower mean CRPS than **B2d** (static bias correction, dressed; §5), pooled over the 8 stations, leads 1-3, working daytime, regime (a) | Forecast | **Primary** |
| H1-raw | Same, against **B0** (raw IFS, deterministic CRPS = MAE) | Forecast | Secondary (expected; it is mostly bias removal) |
| H1-run | Same, against **B3d** (running 7-day bias correction, dressed) | Forecast | Secondary (the strongest simple adaptive baseline; see §10.3) |
| **H2** | The 90% calibrated interval (pair 0.05/0.95) covers 2026 truth with an empirical coverage inside [0.85, 0.95] in every lead (1-3) × hour-block stratum, for T, Td, wind and WBGT, regime (a) | Forecast | **Primary** (calibration) |
| H3 | For the events WBGT ≥ 30 °C and WBGT ≥ 32 °C, the corrector's event probability has a positive Brier skill score against the 2024-2025 climatological base rate and against B2d's event probability, leads 1-3, working daytime, pooled | Forecast | Secondary |
| **H4** | At OMAA, 2026, working daytime, lead 1: **P3** (Stellar Blaze) has fewer missed danger hours than **P0** (ban only) **and** fewer false-alarm hours than **P1** (WBGT ≥ 32 on raw IFS) | Warnings | **Primary** (the Judges §4.3 criterion) |
| H5 | Same site and season: P3 has fewer missed danger hours than **P2** (ADOSH zones on raw IFS) without more false-alarm hours than P2 + 25% | Warnings | Secondary |
| **H6** | Same site and season, roster L1, the assumed crew (§11.1): **rule plan from the corrected forecast** has fewer truth-zone rule-violation minutes per worker-season than **ban only** | Plans | **Primary** |
| H7 | Rule plan corrected vs rule plan raw: fewer missed-protection ticks | Plans | Secondary (a tie is the expected outcome; §10.4) |

One primary hypothesis per row (H1, H2 for the forecast; H4 Warnings; H6 Plans). Secondary results are reported with intervals, labelled "secondary", and are never promoted to a headline after the fact. No p-values. No multiplicity correction is claimed, because nothing beyond the primaries is used to make a claim.

---

## 2. Data, splits and regimes

### 2.1 Data
- **Gold pairs:** `gold/pairs.parquet` built by `sb-jobs build-dataset` at code `64efe24`, SHA-256 above, 1,708,032 rows. Schema `GOLD_PAIRS_SCHEMA` (`backend/src/stellar_blaze/domain/weather/schemas.py`). Truth = IEM METAR (`obs_*`), nearest-UTC-hour binned. WBGT truth = `wbgt_obs_c` (Liljegren from observed T, Td and wind, with IFS lead-0 radiation and pressure; assumption A2, ADR 0005).
- **Models used:** `ecmwf_ifs025` (the corrected backbone, 2024-2026) and `gfs_seamless` (a feature and a raw comparator, 2024-2026). `ecmwf_aifs025_single` is a raw comparator only (2025-2026). An AIFS-feature corrector is cut (ADR 0020).
- **Leads modelled:** `lead_days` 1-7. Lead 0 is the same-day run, which no one has at the issue time, so it is never used. Headline leads 1-3; secondary leads 5 and 7 (ADR 0005).
- **Hours modelled:** 02:00-15:59 UTC (06:00-19:59 GST). This covers the working daytime 06-14 UTC (ADR 0005) and the planner's L1 roster 06:00-11:00 + 15:00-18:00 GST. Every modelled hour falls on the same calendar date in UTC and GST, so the day key is unambiguous.
- **Rows scored:** for T/Td/wind, rows with `has_joint_obs = true`; for WBGT, rows with `wbgt_obs_reject = 0`. Missing rows are not imputed. The count of scored rows per stratum is reported with every metric.

### 2.2 Clusters (folds): 6
`abu_dhabi` {OMAA, OMAD} · `dubai_sharjah` {OMDB, OMSJ} (one forecast cell) · `al_maktoum` {OMDW} · `al_ain` {OMAL} · `fujairah` {OMFJ} · `ras_al_khaimah` {OMRK}. These are the `cluster` values of `STATIONS` (ADR 0005). A cluster is always held out whole. Random splits and leave-one-station-out are banned.

### 2.3 Train / tune / test
| Use | Data | Rule |
|---|---|---|
| **Training (fit)** | 2024 + 2025, 15 May-31 Aug | Quantile models are fitted here |
| **Calibration (CQR)** | 2024 + 2025, 1-30 Sep (the last 30 days of each training summer; ADR 0007) | Disjoint in time from the fit. The §6.4 rule may switch it once, on 2024-2025 evidence only |
| **Tuning / selection** | 2024 + 2025, **leave-one-cluster-out (LOCO)**: 6 folds | Hyperparameters, feature-set choice, WBGT method, calibration-window rule, θ. Nothing else is tuned |
| **Test** | **2026**, 15 May-30 Sep | Scored **once** (§9), by the command in §12, after the §11 freezes |

### 2.4 Regimes reported (ADR 0005)
| Regime | Model | Test rows | Role |
|---|---|---|---|
| **(a)** known sites, new summer | Final model, all 6 clusters, 2024-2025 | 2026, all stations | **Headline** for H1-H4, H6 (OMAA rows for H4-H7) |
| **(c)** new cluster, new summer | 6 models, each trained on 5 clusters 2024-2025 with the **cold** feature set (§3.2) | 2026, the held-out cluster | Headline next to (a): the "new site" number |
| (b) new cluster, known summers | LOCO on 2024-2025, out-of-fold | 2024-2025 | Reported from the tuning run (dev; not 2026) |
| (b-all) ADR 0005 form | 6 models, each trained on 5 clusters 2024-2026 | Held-out cluster, 2024-2026 | Secondary, run in the gated test run (it trains on 2026). If it has not run by 14 Nov 23:00 GST, it is reported as "not run". That decision is made now, before any result exists |

---

## 3. The corrector being tested (fixed design)

### 3.1 Model
- **Targets:** the forecast error (truth minus IFS) for T, Td and wind, and **direct WBGT error** (`wbgt_obs_c - wbgt_fc_c`). The corrected quantile is the IFS value plus the predicted error quantile. Corrected wind is clipped at 0.
- **Learner:** `lightgbm` 4.7.0, one `LGBMRegressor(objective="quantile", alpha=q)` per level per target. **19 levels: 0.05, 0.10, …, 0.95** (ADR 0007). Crossing quantiles are sorted at prediction time. The seed is `20261112`, with `deterministic=true` and `num_threads` fixed in the training config.
- **Calibration:** symmetric CQR offsets per **lead × hour-block** for each of the 9 symmetric pairs (0.05/0.95 … 0.45/0.55). The median is unchanged. The calibrated grid is re-sorted. `mapie` 1.6.0 `ConformalizedQuantileRegressor(prefit=True, symmetric_correction=True)` is the test oracle (stack doc §6.1).
- **Hour-blocks (fixed now):** `early` 02-05 UTC (06:00-09:59 GST, morning rise); `peak` 06-10 UTC (10:00-14:59 GST, includes the ban window); `late` 11-15 UTC (15:00-19:59 GST). 7 leads × 3 blocks = 21 strata. n per stratum is reported.
- **WBGT uncertainty, two ways (ADR 0007):** (i) **joint**: 50 joint samples of corrected (T, Td, wind) through a Gaussian copula (rank correlations of 2024-2025 PIT values per lead × hour-block), Td capped at T, then Liljegren with the forecast's own radiation and pressure; (ii) **direct**: the WBGT quantile model. The §6.3 rule picks one before 2026.

### 3.2 Features (closed list) and leakage rules
**Feature sets.** `site` = all of the below. `cold` = all except the station-history group. The §6.2 rule decides whether regime (a) uses `site` or `cold`. Regime (c) always uses `cold`.

| Group | Features |
|---|---|
| Timing | `lead_days`, `hour_utc`, `doy` |
| IFS forecast (same row) | `fc_t_c`, `fc_td_c`, `fc_wind_ms`, `fc_sw_wm2`, `fc_direct_wm2`, `fc_pressure_hpa`, dew-point depression, relative humidity, `wbgt_fc_c` |
| GFS forecast (same station, valid time and lead) | GFS T, Td, wind; IFS minus GFS for each |
| Geometry | `station_elev_m`, `grid_elev_m`, their difference |
| Climatology | Pooled training-fold mean of observed T, Td and WBGT by hour and ±7-day window (pooled over training stations, so it is legal in `cold`) |
| **Station history** (`site` only) | Station climatology (as above, this station only); `bias7_{t,td,wind}`: the station's mean lead-1 error (IFS minus truth) in the same hour-block over the 7 UTC days ending on day D − L − 1 |

**Leakage rules (each has a test in B2):**
- **L1.** Never a feature: `obs_*`, `audit_*`, `ref_*` (lead-0 radiation and pressure: same-day information), `wbgt_obs_*`, `wbgt_fc_refrad_*`, `has_joint_obs`, `summer`, `station`, `cluster`, `grid_lat`, `grid_lon` (a site identifier in disguise).
- **L2.** Lead 0 never enters training, tuning or scoring.
- **L3.** A history feature for valid day D at lead L uses only truth with a valid date ≤ D − L − 1 (UTC). That is before the issue day under both the `previous_dayL` reading and the strict 18:00 GST reading. The first days of each summer therefore have null history; nothing is back-filled.
- **L4.** Every fitted statistic is computed inside its fold from that fold's training rows only: climatologies, bias means, dressing quantiles, copula correlations, CQR offsets, θ and event base rates.
- **L5.** 2026 rows are unreachable from training and tuning code. Only the gated loader (§9) can return them.
- **L6.** A held-out cluster is removed whole, including from climatology and dressing.
- **L7.** Calibration rows (1-30 Sep) are never fitting rows.
- **L8.** GFS features join on the identical `(station, valid_time, lead_days)`.

---

## 4. Issue time

| Name | Series | What it is | Used for |
|---|---|---|---|
| **Headline ("~24 h ahead")** | `lead_days = 1` (`*_previous_day1`) | "Predicted 24 hours before valid time" (Open-Meteo). For 12-15 UTC valid hours it may come from a run published after 18:00 GST D-1 (§0.1) | H1-H7 headline; the scoreboard; the demo day |
| **Strict ("issued by 18:00 GST the evening before")** | `lead_days = 2` | Every value is from a run published before 18:00 GST on D-1 (a 48 h-before value lands on a run published by about 01:34 UTC on D-1 at the latest) | Shown next to the headline on the Warnings scoreboard and in the report for H4; the only numbers that may carry the 18:00 stamp |

A real 18:00 GST product would use the 06 UTC D-1 run at leads of 24-32 h. That lies between the two series, so the pair brackets it: lead 1 is slightly optimistic, lead 2 pessimistic. No information after the issue time enters any feature (L3).

---

## 5. Baselines (fixed)

| ID | Baseline | Probabilistic form |
|---|---|---|
| **B0** | Raw IFS | Deterministic; CRPS = absolute error |
| B0d | Raw IFS, dressed | 19 empirical quantiles of the training-fold error per lead × hour-block added to the raw value |
| **B2 / B2d** | Static additive bias correction per station × lead × hour-block from training (ADR 0007). For held-out clusters (regimes b, c): the pooled bias of the training stations | B2d = B2 plus the training-fold residual quantiles per lead × hour-block |
| **B3 / B3d** | Running bias correction: subtract `bias7` (the L3 rule) | B3d = B3 plus residual quantiles |
| B4 | Linear MOS (ridge on the `cold` features, per target), if built by 14 Nov 18:00 GST; otherwise reported as "not built" (decided now) | Dressed as B2d |
| R-GFS, R-AIFS | Raw GFS (2024-2026) and raw AIFS (2025-2026) | Deterministic; the raw model comparison table (plan E5) |

---

## 6. Selection rules on 2024-2025 (LOCO out-of-fold only)

All selection uses LOCO predictions on 2024-2025, leads 1-3, working daytime, with the §8 bootstrap. The output of each rule is written to `artifacts/eval/dev/selection.json` with its inputs.

1. **Hyperparameters.** Grid: `num_leaves` ∈ {7, 15} × `min_child_samples` ∈ {200, 1000} × `n_estimators` ∈ {150, 400}, at `learning_rate` 0.05, `feature_fraction` 0.8, `bagging_fraction` 0.8 (freq 1) and `lambda_l2` 1.0. Score: mean pinball loss over levels {0.1, 0.5, 0.9} for the T and Td errors. Choose the lowest. Configurations within 1% of the best are ties, broken toward fewer leaves, then fewer trees. The chosen values apply to all four targets.
2. **Station-history features.** Regime (a) uses `site` only if `site` lowers LOCO CRPS (T and Td, each) by ≥ 1% relative to `cold`, with the paired interval excluding zero. Otherwise it uses `cold`.
3. **WBGT method.** Score both on the same 19-level grid: joint samples reduced to their 19 empirical quantiles, then `crps_quantile`. The lower LOCO CRPS wins. A difference under 1% is a tie, and a tie goes to **joint** (physically consistent).
4. **Calibration window.** If LOCO coverage of the 90% interval in the **top forecast-WBGT tercile** (tercile edges from 2024-2025) is below 0.85 for any lead 1-3, the calibration window switches from "1-30 Sep" to "the 4th, 8th, 12th and 16th week of each training summer". It switches once and is never switched back.
5. **Warning thresholds θ** (for P3; used by B3, frozen in §11): from LOCO out-of-fold P(High zone) at the **abu_dhabi** cluster held out, 2024-2025, lead 1, working daytime:
   - **θ_protect** = the largest θ on the grid {0.05, 0.10, …, 0.95} whose POD for truth-High hours is ≥ 0.90. This is the headline.
   - **θ_balanced** = the θ maximising the Peirce skill score. It is shown as the second operating point (Judges §4.5).
   - If no θ reaches POD 0.90, θ_protect = 0.05, and the report says so.
   - **Who computes it:** TWL needs B3's weather-to-TWL pipeline (MRT and body-level wind, ADR 0006) and the frozen margin. So B2 exports the LOCO out-of-fold joint samples for the held-out abu_dhabi fold (`artifacts/eval/dev/oof_samples_abu_dhabi.parquet`, 2024-2025 only). B3 applies this rule to them after the ruleset is released, and the result goes into the freeze addendum (§11.2).

---

## 7. Metrics

### 7.1 Forecast row (B2; `artifacts/eval/2026/forecast_skill.json`)
For each variable (T, Td, wind, WBGT) × lead {1, 2, 3, 5, 7} × hour-block {early, peak, late, working-daytime 06-14 UTC} × regime {(a), (c)}:
- **CRPS** on the 19-level grid (`scoringrules.crps_quantile`; only comparable within the same grid; stack doc §6.2). For B0, the CRPS is the MAE.
- MAE and RMSE of the median; bias.
- Pinball loss at 0.05, 0.5 and 0.95; interval score for the 90% and 80% pairs.
- **Coverage** of the calibrated pairs 0.05/0.95, 0.10/0.90 and 0.25/0.75. Coverage is also given conditional on forecast-WBGT tercile (edges from 2024-2025). It is never conditioned on truth tercile in a headline, because a user cannot know the truth tercile.
- **PIT histogram** (10 bins) and a reliability diagram for event probabilities.
- **Brier score and BSS** for events WBGT ≥ 28, ≥ 30 and ≥ 32 °C. The references are (i) the 2024-2025 climatological base rate per hour-block and (ii) B2d's event probability.
- Per-station and per-cluster tables (descriptive, no interval).
- Raw comparison: IFS vs AIFS vs GFS MAE and bias, 2025 and 2026, leads 1-3.

**Reliability diagram (the "when we say 70%" sentence):** pooled over stations, events WBGT ≥ 30 and ≥ 32, lead 1, working daytime, bins of width 0.1. A bin with fewer than 50 forecasts is drawn hollow and never quoted. `⟨obs_freq_at_70⟩` is the observed frequency in the 0.65-0.75 bin of the WBGT ≥ 32 event.

### 7.2 Warnings row (B3 computes; definitions fixed here; `artifacts/eval/2026/policy_scoreboard.json`)
- **Site, season, hours:** OMAA; 2026, 15 May-30 Sep; working daytime 06:00-14:59 UTC (10:00-18:59 GST).
- **Truth danger hour:** truth TWL in the ADOSH **High** zone (< 115 W/m²). TWL comes from the B1 port (ADR 0006), using the margin and the withdrawal-limit decision of the frozen ruleset (§11.1). Hours with partial ban overlap carry their non-ban fraction as weight. **Sensitivity (fixed, always reported):** truth zones under margin {0, 7} W/m² × withdrawal limits {off, on}, a 2 × 2 table.
- **Policies:**
  - **P0** ban only: 12:30-15:00 GST, 15 Jun-15 Sep 2026; no warning otherwise.
  - **P1** naive: warn when raw IFS WBGT ≥ 32 °C.
  - **P2** ADOSH on raw: warn when the raw-IFS TWL zone is High.
  - **P3** Stellar Blaze: warn when P(High) ≥ θ_protect (also shown at θ_balanced). P(High) comes from the corrected joint samples through TWL (or the direct method, per §6.3).
  - A policy "warns" an hour when its evening-before forecast puts that hour in a warning. P0 "warns" only ban hours, which are not worked.
- **Counters,** each with a 95% interval: **missed danger hours** (truth High, worked, not warned); **false-alarm hours** (warned, truth not High); POD, FAR and CSI; alerts per worker-shift. Worker-hours are hours × 20, the assumed crew of 20 doing heavy work (labelled "assumed").
- **Lead-stratified:** leads 1 (headline), 2 (strict), 3; leads 5 and 7 in the report only.
- **Secondary:** the same counters pooled over all 8 stations, regime (a), and regime (c) at OMAA.

### 7.3 Plans row (B3 computes; ADR 0011 §9 metrics 1-3; `artifacts/eval/2026/plan_scoreboard.json`)
- **Scorer:** the independent validator (ADR 0011 §3) against **truth zones** (as in §7.2), 5-minute ticks interpolated from hourly values.
- **Roster:** L1 legal default, 06:00-11:00 + 15:00-18:00 GST, with the crew of the frozen fixture (§11.1). It is labelled SIMULATED.
- **Plans compared:** (a) naive schedule (every shift minute outside the ban); (b) ban only; (c) rule plan from raw IFS; (d) rule plan from the corrected **protective quantile**, defined as the 10th percentile of TWL from the corrected joint samples (one-sided 90% protection; fixed now).
- **Counters** per plan, each with a 95% interval:
  1. truth rule-violation minutes per worker-season;
  2. the share of truth-High heavy-work minutes cycled 20/40;
  3. **missed protection** (truth High or Red ticks scheduled at a lighter cycle);
  4. rest minutes added vs naive (SIMULATED).
- **Words:** never "minutes avoided" or "illness prevented" (ADR 0034).

### 7.4 Demo day ("day zoom") selection rule
Applied by code (`select_demo_day`), on **truth only**, before any P3 output for that day is read:
1. **Candidates:** 2026 dates at OMAA, 15 May-30 Sep, where all 9 working-daytime hours (06-14 UTC) have `has_joint_obs = true` and `wbgt_obs_reject = 0`, and every policy's forecast inputs at lead 1 are present.
2. **Score:** the observed High-zone working hours outside the ban window. Truth TWL comes from the frozen ruleset (§11.1). Partial-ban hours carry their non-ban fraction.
3. **Pick** the maximum; ties go to the **earliest date** (Judges §4.2).
4. The selected date, its score and the runner-up are written to `demo_day.json` with provenance. The day is shown whatever P3 did on it. The demo site is never switched after results (Judges §4.5).

Step 1 is a clarification of the Judges §4.2 rule: a day with missing hours cannot be drawn.

---

## 8. Uncertainty

- **Method:** a moving-block bootstrap over **days**, with blocks of 7 consecutive days, B = 2,000 and seed `20261112`. A resampled day carries every station and hour of that day, which preserves the cross-station correlation (data doc §5.3). Intervals are 95% percentile intervals.
- **Comparisons are paired:** model and baseline are resampled on the same blocks, and the interval is of the difference.
- **Clusters are not bootstrapped:** with 6 clusters (about 4.2-4.6 independent sites), a cluster bootstrap would be meaningless. Per-cluster results are shown as a table, and the spread across clusters is described, not tested.
- **OMAA-only rows** (Warnings, Plans) resample OMAA's days. About 139 days and roughly 20 effective blocks give wide intervals, and the report says so.
- **Noise floor:** METAR whole-degree truth adds about 0.29 °C noise (ADR 0005). A CRPS or MAE difference below 0.1 °C is reported as "not distinguishable" even if its interval excludes zero.
- **No p-hacking:** no metric, stratum, lead, site, threshold or baseline is added or removed after the 2026 run without an amendment (§13). Every computed number is written to the result files; there is no unreported analysis.

---

## 9. The gated 2026 run (once)

- **Entry point:** `sb-jobs evaluate-2026 --part forecast|warnings|plans` (B2 builds the command and the `forecast` part; B3 adds `warnings` and `plans` to the same command).
- **The gate refuses to run** unless all of these hold:
  - `backend/training/protocol.lock.toml` exists;
  - this file's SHA-256 equals the lock's `protocol_sha256`;
  - the lock's `protocol_commit` is an ancestor of HEAD, and this file at that commit has the same hash;
  - the working tree is clean;
  - the lock names a released `model_id` that is present in `backend/models/`;
  - for `warnings` and `plans`: the freeze addendum (§11) is committed and its hashes match;
  - no result file for that part exists yet in `artifacts/eval/2026/`, unless `--amendment <id>` names a row of the §13 log.
- **"Once"** means one run per part at one commit. The output records the commit, the model id, the gold SHA-256 and the protocol hash.
- **Bug found after the run:**
  - a re-run is allowed only for a defect shown on 2024-2025 data or by a failing unit test;
  - the first output is kept beside the new one (`*.run1.json`);
  - both are reported, and the amendment row says what changed and why.

---

## 10. Disclosure: 2026 information already seen, and why it does not select anything

### 10.1 What was seen (all before this document)
| # | When / where | 2026 information computed and read |
|---|---|---|
| 1 | Data-availability research, 11 Nov (`docs/research/2026-11-11-data-availability.md` §2, §5, §6; `scripts/results/`) | 2026 observation completeness and pair counts. **Raw** forecast errors on 2026 for IFS, AIFS and GFS: pooled MAE at leads 1/3/7 (for example IFS d1 T 1.83, Td 3.12, wind 1.12) and pooled day-1 daytime bias (IFS +1.07 / -1.44 / -0.66). **Per-station day-1 daytime IFS biases**, for example OMFJ T +4.75, Td -6.20; OMDB T +1.62, Td -2.81; OMAD Td +2.63; OMDW Td +0.17. **Bias-vector correlations across summers including 2026** (T 0.98-0.99, Td 0.90-0.98, wind 0.50-0.93). Error autocorrelation, effective sample size and inter-station error correlation computed over all three summers |
| 2 | B1 Task 11 gate, 12 Nov (gold manifest `summary.raw_errors`, committed) | The same raw bias / MAE / RMSE per model, summer (incl. 2026) and lead 0-7, recomputed from the gold dataset; WBGT reject counts over all rows |
| 3 | Roster feasibility research and ADR 0011, 11 Nov (`scripts/roster/`) | **2026 station WBGT truth** (diurnal profiles 2024-2026, summer-vs-summer profile agreement, per-summer exposure counts at WBGT ≥ 28/30/32, for example "seasonal avoided ≥ 30: 33.6% in 2026"). **IFS lead-1 and lead-3 forecast WBGT on 2026, raw and leave-one-summer-out bias-corrected** (trained on 2024 + 2025, which is B2's static baseline in another form), used inside roster and in-shift ordering metrics pooled over 6 clusters × 3 summers (for example, in-shift excess °C·h, fc1_bc ≈ fc1_raw). The legal-template frontier (`roster_frontier.json`) uses 2026 truth WBGT in its folds |
| 4 | Judges doc v2, 11 Nov | No 2026 numbers; it fixed the site, season, policies and demo-day rule before any scoring |

**Never computed on 2026:** any corrector, quantile or conformal output; any TWL zone, warning or plan; any WBGT-threshold event probability; any choice of θ, margin or day.

### 10.2 Why this does not select the model, thresholds or days
- **Model class, targets, quantile grid, CQR and baselines** were fixed by ADR 0007 on 11 Nov, from the literature, the effective sample size and the CRPS-grid measurement, not from 2026 skill. Splits and clusters were fixed by ADR 0005 from twin-cell correlation.
- **Hyperparameters, feature set, WBGT method, calibration window and θ** are chosen by §6 rules on 2024-2025 LOCO only. The code cannot read 2026 during selection (L5, enforced by test).
- **Thresholds** come from regulation or prior plan text: ADOSH 115/140 W/m²; WBGT 28/30/32 (plan, roster research); the TWL margin of 7 W/m² from the Miller & Bates port bias (ADR 0006); the ban window from MoHRE. None came from 2026 performance.
- **Demo site** OMAA was chosen in the Judges doc for its proximity to the industrial belt. The **demo day** is selected on truth only. Seeing 2026 truth WBGT (row 3) can reveal hot days, but it says nothing about how P3 will do on them, which is the quantity a cherry-pick would exploit.

### 10.3 Where the seen information could still bias us (stated, not waved away)
1. **The 2026 bias shift is known.** IFS was warmer in 2026 (pooled d1 daytime T bias +1.07 vs +0.62/+0.79) and less dry in Td (-1.44 vs -1.87/-1.89). So a static correction trained on 2024-2025 will probably under-correct T and over-moisten Td in 2026. Running-bias features (`bias7`) and the running baseline B3 would partly track that.
   - **Risk:** our feature design benefits from hindsight.
   - **Mitigations:** `bias7` was already listed in the roadmap (§4, "recent observed bias") before B2 began; its inclusion is decided by the §6.2 rule on 2024-2025 only; **B3d (running correction) is a pre-registered baseline**, so the corrector cannot win merely by adapting where a static baseline cannot; adaptive conformal stays cut (ADR 0019) and is not reintroduced.
2. **Expected Plans tie.** Row 3 showed that LOSO-bias-corrected and raw lead-1 forecasts give nearly identical in-shift ordering outcomes (pooled, incl. 2026). We therefore expect H7 to tie, and say so now (Judges §4.6 already planned for it).
3. **Station-level biases at OMFJ are large and were seen,** so a per-cluster "win at Fujairah" would be unsurprising. Per-cluster tables are descriptive only (§8), and the demo site is not switched (§7.4).

### 10.4 Non-independence and other caveats (reported with every headline)
- 8 stations ≈ 4.2-4.6 independent sites; about 1,000-1,300 effective station-days in total. OMAA-only rows rest on one site-summer.
- All stations are **airports**. The claim is "held-out airport clusters", never "any worksite".
- WBGT and TWL truth are **derived** (A2): observed T, Td and wind with modelled lead-0 radiation. There is no globe or wet-bulb instrument.
- Whole-degree METAR truth (about 0.29 °C noise).
- 2026 is a new IFS cycle (50r1, from 12 May 2026), so regime (a) also tests robustness to a model upgrade. A failure there may be the upgrade, not the method.
- Open-Meteo free tier, non-commercial; data CC BY 4.0 (ADR 0005).
- The crew is **SIMULATED**; the weather is **REAL**.
- TWL is "aligned with ADOSH zones", not certified; the port reads +3.9 to +7.0 W/m² high (ADR 0006).

---

## 11. Freeze addendum (must be committed before the `warnings` and `plans` parts run)

A short file `docs/research/2026-11-1x-preregistration-freeze.md`, committed before `sb-jobs evaluate-2026 --part warnings`. It fills these slots from the named sources only:

### 11.1 From B3 (regulation and policy; no 2026 data)
- Ruleset id and SHA-256 (`ae-heat-2026.1`): `⟨ruleset_id⟩`, `⟨ruleset_sha256⟩`. This fixes the TWL margin `⟨margin_w_m2⟩` and the withdrawal-limit switch `⟨withdrawal_limits⟩` (ADR 0006).
- The crew fixture `backend/fixtures/demo_site.toml` SHA-256 `⟨demo_site_sha256⟩` (SIMULATED; the B3 notes §5).
- The ban window as dated configuration (the ruleset).

### 11.2 From B2 (2024-2025 only)
- The released model id `⟨model_id⟩` and the `selection.json` SHA-256 `⟨selection_sha256⟩`.
- θ_protect `⟨theta_protect⟩` and θ_balanced `⟨theta_balanced⟩`, from §6.5. B3 computes them from B2's exported 2024-2025 out-of-fold samples with the §11.1 ruleset, so the ruleset must be frozen first.

**If any §11 value is changed after a 2026 Warnings or Plans number exists,** that row is reported as "not pre-registered" and loses its headline.

---

## 12. What produces every number

- **Command:** `sb-jobs evaluate-2026 --part forecast|warnings|plans` (module `stellar_blaze/jobs/evaluate_2026.py`, with the scoring in `stellar_blaze/ml/`). The commit is recorded in the results log below once run.
- **Inputs:** `gold/pairs.parquet` (SHA-256 above); `backend/models/⟨model_id⟩/`; the frozen ruleset and fixture.
- **Outputs:**
  - `artifacts/eval/2026/forecast_skill.json`, `reliability.json`, `corrected_series_OMAA.parquet`;
  - `policy_scoreboard.json`, `demo_day.json`, `plan_scoreboard.json` (B3).
  - Each file carries a `provenance` block: protocol path and line anchor, script and function, git SHA, gold SHA-256, model id, and the label REAL / REAL weather + assumed crew / SIMULATED.
  - The deck, the video, the proof chips and the report quote only these files.

**Results log (filled after the run; numbers only from the files):**

| Part | Commit | Run at (UTC) | Output SHA-256 | Notes |
|---|---|---|---|---|
| forecast | `⟨sha⟩` | `⟨ts⟩` | `⟨sha256⟩` | |
| warnings | `⟨sha⟩` | `⟨ts⟩` | `⟨sha256⟩` | |
| plans | `⟨sha⟩` | `⟨ts⟩` | `⟨sha256⟩` | |

### 12.1 Headline slots (filled only from the files)
- **Forecast:**
  - `⟨crps_t_corr⟩` vs `⟨crps_t_b2d⟩`, Δ `⟨d_crps_t⟩` [CI `⟨lo⟩`, `⟨hi⟩`]; the same for Td `⟨…⟩`;
  - coverage of the 90% pair per stratum `⟨cov90_min⟩`-`⟨cov90_max⟩`;
  - BSS for WBGT ≥ 32 `⟨bss32⟩`;
  - `⟨obs_freq_at_70⟩`.
- **Warnings (OMAA, lead 1 / lead 2):**
  - missed danger hours `⟨P0_missed⟩` / `⟨P1_missed⟩` / `⟨P2_missed⟩` / `⟨P3_missed⟩`;
  - false-alarm hours `⟨P0_fa⟩` / `⟨P1_fa⟩` / `⟨P2_fa⟩` / `⟨P3_fa⟩`;
  - POD/FAR/CSI `⟨…⟩`, each with a CI.
- **Demo day:** `⟨demo_date⟩`, `⟨demo_high_h⟩`, `⟨demo_high_outside_ban_h⟩`, `⟨demo_raw_hits⟩`, `⟨demo_p3_hits⟩`.
- **Plans:** `⟨plan_violation_min_{naive,ban,raw,corr}⟩`, `⟨plan_high_cycled_*⟩`, `⟨plan_missed_*⟩`, `⟨plan_rest_added_*⟩`.

---

## 13. Negative results: what counts, and what we show

Decided now. The Judges §4.5 table applies, made concrete:

| Outcome on 2026 | Counts as | What we show |
|---|---|---|
| H1 fails (the interval vs B2d includes 0 or favours B2d) | **Negative** for "AI beats simple correction" | The forecast row with the honest result. The claim becomes "**calibrated uncertainty**": H2 and H3 carry it, and the scoreboard shows P3 at θ_protect and θ_balanced as a knowing trade-off. We never re-tune |
| H2 fails in some strata (coverage < 0.85) | **Negative** for calibration in those strata | Name the strata (expected risk: `late` block or top heat tercile). The reliability diagram is shown as is. The app labels intervals in failing strata "under-calibrated in testing" |
| H4 fails on the P0 side or the P1 side | **Negative** for the Warnings headline | The scoreboard ships as is (ADR 0034 never-cut), with the narration naming the failing side. If P2 ≥ P3, P2 is shown as the recommended policy: "our AI did not beat the regulator's own zones on held-out data" |
| H6 fails | **Negative** for the Plans row | Show it. "The zone engine and validator do the protecting; the forecast adds the honest range." If the row is cut for time, it stays in the report (ADR 0034 cut order) |
| Regime (c) ≪ regime (a) | Expected (data doc §6) | Both shown side by side; "new site" claims quote (c) only |
| Lead 2 (strict) contradicts lead 1 on H4 | **Negative** for the "evening before" stamp | The stamp is dropped from the video, and the strict number is shown |

**Amendment log** (after commit, every change to this file is a new row, never an edit of the text above):

| # | Date | Section | Change | Reason | Before or after any 2026 result? |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

---

## 14. For Ali to approve before commit

1. **The issue-time fix (§0.1, §4):** headline = lead 1 worded "about 24 hours ahead"; the strict 18:00 stamp only on lead 2. This **amends ADR 0034 §2 and the Judges §4.2/§4.4 stamp**.
2. **The known-site framing (§0.3):** the OMAA scoreboard is regime (a); regime (c) sits next to it.
3. **Primary hypotheses H1, H2, H4, H6** and the θ rule (§6.5, POD ≥ 0.90).
4. **Doc pointers:** ADR 0034, the Judges doc §4.3/§8.1 and the B3 notes §5 should cite this file. That is a docs-only amendment.
5. **The freeze-addendum mechanism (§11)** for the B3 values that do not exist yet.

Then commit this file alone (`docs(research): pre-register the 2026 evaluation`), and B2 writes `backend/training/protocol.lock.toml` with that commit's SHA.

## Sources
- Open-Meteo Previous Runs API, https://open-meteo.com/en/docs/previous-runs-api (fetched 2026-11-12).
- ECMWF dissemination schedule (Set I real-time times), https://confluence.ecmwf.int/display/DAC/Dissemination+schedule; ECMWF open data, https://www.ecmwf.int/en/forecasts/datasets/open-data (via search 2026-11-12; the per-run open-data release time is "at the end of the real-time dissemination schedule").
- In-repo: ADR 0005, 0006, 0007, 0011 §9, 0034; `docs/research/2026-11-11-data-availability.md`; `docs/research/2026-11-11-judges-and-wow-moment.md` v2; `docs/research/2026-11-11-backend-ml-stack.md` §6.1-§6.2; `docs/research/scripts/roster/` results; gold manifest.
