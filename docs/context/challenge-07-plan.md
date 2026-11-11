# Future Health Challenge: Challenge 07 Plan (Climate-Resilient Worker Health)

**Status:** DRAFT for discussion, 10 Nov 2026. Updated the same day after four verified research checks (state-of-the-art models, Google data, cameras/computer vision, LLMs/agents/voice). **Part E** summarises what changed. Nothing here is final. Sections 1 and 2 are facts we checked. Section 3 lists our assumptions, which are guesses until checked. Sections 4 to 7 are the proposed plan, in plain language. Section 8 holds all the technical detail and jargon, and section 9 is a glossary.

**Reminder: registration closes today, 10 Nov 2026.** Register under Challenge 07 as a solo entrant (the FAQ allows one to five members).

---

## Part A: What the competition asks for

### 1. Competition requirements (from the official pages, captured 6 Nov 2026)

**Key dates**

| Date | What happens |
|---|---|
| 10 Nov 2026 | Registration closes |
| 20 Nov 2026 | Prototype + technical documentation (assumptions, dependencies, limitations) due. Our internal target: 19 Nov |
| 20 to 30 Nov 2026 | Evaluation |
| 7 to 11 Dec 2026 | Top 3 present at GITEX, Dubai |

**Prizes:** USD 50,000 / 35,000 / 20,000. The top 3 are selected "solely based on evaluations".

**The challenge, in the organisers' words:** "How might we protect workers exposed to extreme heat and other climate-related occupational risks through earlier warning, personalized prevention and safer operational decisions?" They add: worker protection must come **before** productivity; poorly calibrated alerts get ignored; over-collecting data becomes surveillance; and individual risk data must not be misused in employment decisions.

**The six things our solution "should" do**

| # | Requirement | In plain words |
|---|---|---|
| R1 | Dynamic heat-risk assessment | Combine weather with workload, shift and (optional, consented) body signals, to estimate rising risk for a person or a crew |
| R2 | Clear, graded warnings | Simple severity levels, in several languages, each with a safe action: drink, rest, cool down, slow down, change shift, get medical help |
| R3 | Worker-first governance | Consent, collect only what is needed, strict access rules, **no disciplinary or employment use** of health data |
| R4 | Field-ready operation | Works in real heat, with dust, PPE, poor connectivity and low battery. It needs a **safe fallback** when sensors or the network fail |
| R5 | Supervisor decision support | Crew and site views to plan breaks, rotation and task timing **without exposing individual medical detail** |
| R6 | Safety and productivity measures | Able to report alert lead time, false-alarm rate, adherence, symptoms and incidents, escalations, compliance and lost work time |

**Judging criteria (six, with no published weights)**
1. Health impact and clinical relevance
2. Technical depth and architecture
3. Working solution and demo quality
4. Responsible AI, safety and data governance
5. Scalability and deployment readiness
6. Commercial viability and path to pilot

**Rules that bind us**
- The organisers provide **no data, not even synthetic**. We may only use data we have the right to use, and we must **declare every source**.
- Each person can be on one team only, and each team enters one challenge.
- **IP:** the FAQ says we keep our IP. But the Terms give the organiser a **6-month right of first refusal** on any exclusive licence, plus a perpetual marketing licence, and the Terms win when the two conflict.
- Missing a checkpoint can disqualify the whole team.
- The pitch is reportedly a 7-minute demo plus 3 minutes of questions.
- **Likely submission form fields** (secondhand, to be confirmed after registration): solution summary (2,000 characters), solution stage, "what was built during the challenge" (1,500 characters), technology type, prototype link, deck upload, software/hardware/both, demo video link.

### 2. Facts we have already established (checked, with evidence)

| # | Fact | Why it matters |
|---|---|---|
| F1 | Abu Dhabi's official heat code (ADOSH-SF CoP 11.0 v4.0, July 2024) uses an index called **TWL**, not WBGT. A worksite that can reach 35 °C during a shift needs a heat-stress programme; new workers need 5 to 7 days of acclimatisation | Our system must speak the local regulation. TWL has **no open formula** we could find, so we state that gap openly |
| F2 | The UAE midday ban runs 12:30 to 15:00, 15 Jun to 15 Sep | This is the "do nothing extra" baseline we compare against |
| F3 | In summer 2025, for one Abu Dhabi grid cell, **about 58% of daytime hours had WBGT ≥ 32 °C** (between 47% and 58% across the cells we tried) | A simple "too hot" alarm would fire most of the day, and workers would ignore it |
| F4 | **About 70% of those dangerous hours fall outside the midday ban** | The ban alone leaves most of the risk uncovered. This is our headline problem statement |
| F5 | Free weather forecasts differ from station readings. Dew point (humidity) is the weakest input, with a typical error of about 2.6 °C | That gap is the opening for AI: correcting forecasts to the actual site |
| F6 | Old forecasts made 1 to 7 days ahead are archived and free (summers 2024 to 2026), and UAE station observations are free | We can **test our forecasts against what really happened**, on real data. Few other challenges allow that |
| F7 | No public dataset of workers' body temperature in heat exists | Anything about individual workers must be tested on **simulated** workers and labelled that way |
| F8 | The best-known heart-rate-to-core-temperature method (Buller, US Army) is **patented** | We avoid it, or keep it behind a flag with a licence note |
| F9 | Rivals already exist: at least 8 public repos for Challenge 07, some with WBGT and heat-strain engines, one with a wristband model. None looked deep when checked on 6 Nov | Physics alone won't stand out. We have to differentiate |

---

## Part B: Our assumptions

These are **guesses** until checked. Each one has a planned check.

| # | Assumption | How we will check it | If it is wrong |
|---|---|---|---|
| A1 | Enough UAE station data exists (about 10 stations, 3 summers) to train and fairly test a forecast-correction model | Count complete station-summers before building (a few hours of work) | Use fewer stations and say so, or fall back to correcting only the airport station |
| A2 | A WBGT calculated from station temperature, humidity and wind, plus modelled sunlight, is a fair "truth" to score against | We can't fully check this, because no measured WBGT is public. We state it as a limitation | Stays a stated limitation |
| A3 | The judges are mostly policy and population-health people (Abu Dhabi health authorities and partners) rather than pure ML researchers | This is based on the sibling MIT Solve challenge's judging panel | Re-balance the pitch towards technical depth |
| A4 | The judges value **real-data evidence** and visible governance over flashy AI | This comes from the published criteria and past-winner analysis | Add more visible AI features |
| A5 | Six languages (Arabic, English, Hindi, Urdu, Bengali, Nepali) cover most exposed workers | Native-speaker review, plus published UAE labour-force data | Add Malayalam and Tagalog |
| A6 | Ali, working alone, can deliver the "must" scope in about 9 build days | Fix daily hours today; re-check at the end of 13 Nov | Cut the "could" items first |
| A7 | We don't need real hardware. Wearable signals can be simulated for the demo | Confirm the submission form accepts "software" | No change needed |
| A8 | The organisers accept LLM use if it is human-reviewed and kept out of safety decisions | Ask support | Drop the copilot |

---

## Part C: Our plan (plain language)

### 4. The one-sentence pitch

**Site-specific heat forecasts, corrected by AI and tested on real UAE data, turned into each worker's personal risk and a safe shift plan. Worker health data can never reach the employer.**

### 5. Which problem each part solves

| Problem (from the challenge) | What we build | Proof we can show | Real or simulated? |
|---|---|---|---|
| Generic forecasts don't match the actual site, and are not proven ahead of time (R1, R6) | **Forecast corrector (the AI core):** learns how free forecasts go wrong at each location and fixes them, with an honest "likely range" | Error before vs after correction, scored on summers and stations the model never saw | **REAL** |
| The same weather is dangerous for one worker and fine for another (R1) | **Personal limit:** workload, acclimatisation days, clothing and PPE give each worker their own safe limit | Same weather, three workers, three different warnings | Real formulas, example workers |
| "Too hot" alarms fire all day and get ignored (R2, R6) | **Graded warnings by probability:** "how likely is it that you exceed *your* limit", in 4 levels, each with a fixed action | Alerts per worker-shift: ours vs a simple threshold vs the ban alone | Real weather, our rules |
| Supervisors only have general rules (R5) | **Shift planner:** moves heavy tasks into cooler hours, sets work–rest ratios and rotation, and respects the ban and deadlines | A shift plan built without seeing anyone's health data | Real weather, example crews |
| Workers speak many languages, and some have low literacy (R2) | **Pre-approved messages** in 6 languages, with pictures, colours and voice audio | Side-by-side alert in each language | Real (with review status stated) |
| Supervisors need quick answers ("can crew B work at 2pm?") (R5) | **Supervisor assistant:** answers using our engine and the heat-code text, with cited clauses. It can **never** choose a warning level | Live Q&A in the demo | Real software, example data |
| Health data could be misused by employers (R3) | **Worker-first design:** consent workers can revoke, personal risk calculated on the worker's own phone, no employer access path, small groups hidden | Automated tests showing an employer request for personal data is refused and logged | **REAL** (behaviour of our code) |
| Sensors and networks fail in the field (R4) | **Offline app + safe fallback:** 48 h of forecasts cached, and a fallback schedule never less safe than the ban | A "break things" panel: lose the wearable, network or feed, and see what happens | **REAL** (behaviour of our code) |
| Personal strain from body signals (R1, optional) | **Personal strain model (stretch goal):** learns each worker from consented heart rate | Tracking accuracy on simulated workers | **SIMULATED** |
| Authorities need the bigger picture (links to Challenge 06) | **Site/area view:** anonymous totals and unusual-spike detection | Spike detection on injected test events | Simulated events |

### 6. Scope (what is in and out)

**Must have (the submission fails without these)**
1. Weather and station data pipeline.
2. Heat-stress and personal-limit calculations.
3. AI forecast corrector, with the real-data test results.
4. Graded warnings and the alert-burden comparison.
5. Supervisor view with shift planning (a simple version is fine).
6. Worker-first data rules, with tests.
7. Offline/fallback behaviour, with the "break things" panel.
8. Multilingual message templates.
9. Technical document: assumptions, dependencies, limitations, data sources.
10. Demo video and deck.

**Should have:** the full optimiser-based shift planner; voice audio for alerts; a 3D site heat view.

**Could have (only if time allows):** the supervisor assistant (LLM); the personal strain model from heart rate; the Challenge 06 area view.

**Will not do (non-goals)**
- No diagnosis or medical-device claims. This is occupational safety decision support.
- No real patient or worker data from any source.
- No hardware.
- No invented TWL formula. We state the gap and use NIOSH limits instead.
- No AI that decides warning levels or actions.
- No individual data visible to employers, ever.

**Failure even if it "works" (anti-goals):** an alarm that rings all day; a dashboard that is really surveillance; claiming simulated results as real.

### 7. Timeline (draft, revised for 10 Nov)

| Dates | Work |
|---|---|
| 10 Nov | Register. Data-volume check (A1). Agree hours (A6) |
| 11 to 12 Nov | Data pipeline; heat-stress and personal-limit engine; tests |
| 13 to 14 Nov | Forecast corrector: train, test on held-out summers and stations, produce the results report |
| 15 Nov | Warning levels, rules table from the heat code, alert-burden comparison |
| 16 Nov | Shift planner; worker-first data rules and their tests |
| 17 to 18 Nov | Web app: worker, supervisor and fallback panel; languages; offline mode |
| 19 Nov | Documentation, deck, demo video. **Internal deadline** |
| 20 Nov | Submit (buffer day) |

**Team:** solo. Ali builds everything. No consultant is named in the submission.

**Clinical content without a clinician on the team:** every warning action, escalation red flag and medical phrase is taken from a published source and cited next to it (NIOSH 2016 heat criteria, ADOSH-SF CoP 11.0, the ACSM exertional heat illness consensus). Nothing clinical is written from scratch. If a consultant reviews the wording privately, the submission may say "reviewed by an independent clinical consultant", but only if that review actually happened. Otherwise the limitations section says the wording has not been clinically reviewed.

**Solo scope cuts (in this order if behind):** personal strain model (8.7) → population view (8.10) → shift-plan drafter agent → Landsat layer (8.13). The forecast back-test, warning levels, shift planner, governance tests and the worker/supervisor app are never cut.

### Open questions (need answers)
1. How many hours a day can Ali give until 19 Nov?
2. Does the organiser allow referencing Challenge 06 inside a 07 entry? (Ask support.)
3. Which LLM is acceptable to the organisers, given UAE data-residency rules? (The demo uses only synthetic data.)
4. Can we get the TWL paper or the Abu Dhabi Technical Guideline?
5. What exactly is in the submission form? (Capture it after registering.)

---

## Part D: Technical section (all the jargon lives here)

### 8. Components, algorithms and tools

#### 8.1 Data sources

| Source | What we take | Licence / note |
|---|---|---|
| Open-Meteo **Previous Runs API** | Forecasts at lead days 1 to 7. **Checked live on 10 Nov:** ECMWF IFS 0.25° (`ecmwf_ifs025`) covers summers 2024 to 2026, so it is our **backbone**. IFS 9 km covers **summer 2026 only**, so it is a side check. ECMWF **AIFS** (the AI model) covers summers 2025 and 2026. Native steps are 3-hourly or 6-hourly, interpolated to hourly | CC BY 4.0 data; free tier non-commercial (fine for the prototype). Start dates were spot-checked at one point; confirm over full ranges |
| **NOAA GFS** via Google Earth Engine (optional) | A second traditional forecast model, archived from 2015, with shortwave radiation; dew point only from Jan 2025 | Public domain; Earth Engine non-commercial sign-up needed |
| **Google WeatherNext 3** (optional, if access is granted in time) | Google's AI forecast model: archived forecasts from Jan 2024, hourly, about 11 km, with temperature, dew point, wind and total/direct sunlight, plus uncertainty percentiles | Access form with 5–7 business days' review. **Requested today?** Archived data CC BY 4.0. Google's disclaimer says "not validated for real-world use" |
| **Landsat 8/9** surface temperature (should-have) | Site map of hot surfaces and shade at 30 m, taken about 10:00, every 8 days | Free; licence not fully verified |
| Open-Meteo **Archive** (ECMWF IFS 9 km by default; ERA5 optional) | Back-filled "analysis" weather, including radiation | Same |
| NOAA **GHCNh** hourly station observations | Temperature, dew point, wind for about 10 UAE stations (OMAA airport, Bateen, Al Ain, Al Dhafra, Sweihan, Das, Zirku, ...) | NOAA open data, with attribution. Station pressure is often missing (about 17% complete), so we use model pressure |
| **ECMWF open data** (IFS/AIFS) | Production forecast path | CC-BY-4.0, commercial use allowed; only the last 12 runs are kept, so we must store them ourselves |
| **CAMS** via Open-Meteo | Dust, PM10, PM2.5 | Coarse (about 45 km); secondary hazard only |

#### 8.2 Physics core (deterministic)
- **WBGT, Liljegren (2008) method**, via `thermofeel` 2.3.0 (`calculate_wbgt_liljegren`).
  - Inputs: 2 m temperature, humidity, pressure, 10 m wind, shortwave radiation and its direct fraction, and cos(solar zenith) from NOAA solar geometry.
  - **Never** use the "simple WBGT" approximation: it read about 5 °C too high in our test.
- **ISO 7933:2023 Predicted Heat Strain (PHS)**, via `pythermalcomfort` 4.8.1 (`phs`). It predicts rectal temperature, sweat loss and duration limits. Its scope excludes impermeable PPE, so it gets a caveat for PPE classes. The first run compiles numba (slow), so we cache it.
- **NIOSH 2016 limits** (in °C-WBGT, with M = metabolic rate in watts):
  - RAL (unacclimatised) = 59.9 − 14.1·log10(M)
  - REL (acclimatised) = 56.7 − 11.5·log10(M)
- **Acclimatisation state machine:** NIOSH day-by-day ramp (new workers: at most 20% of normal duration on day 1, then +20% a day), aligned with the CoP 11.0 rule of 5 to 7 days. The counter resets after time away or after transfer from a climate-controlled site.
- **PPE/clothing adjustment:** clothing-adjustment values added to effective WBGT. The exact values are to be sourced and cited before use (not yet verified).

#### 8.3 AI core: forecast post-processing (the headline AI)
- **Task:** statistical post-processing (in meteorology this is called **MOS**, Model Output Statistics) of temperature and dew point at station sites, for lead times of 1 to 7 days.
- **Why correct the inputs, not WBGT itself:** we correct T and Td, then recompute WBGT through Liljegren. The physics stays intact, and the correction targets the weakest input (dew point).
- **Model:** **LightGBM quantile regression**, predicting the 5th, 50th and 95th percentiles of the error. Small tabular data suits gradient-boosted trees better than deep learning.
- **Features:** raw forecast variables; lead time; hour of day; day of year; station static features (distance to coast, elevation); recent observed bias at that station; dust/AOD.
- **Calibration:** **conformalized quantile regression (CQR)**, so the stated ranges have the coverage they claim (for example, 90% intervals contain the truth about 90% of the time).
- **Baselines it must beat:**
  1. the raw forecast;
  2. **EMOS** or linear MOS (the classic method);
  3. climatology;
  4. persistence.
- **Validation design:**
  - **leave-one-summer-out** (time generalisation);
  - **leave-one-station-out** (generalisation to new sites; this matters most for "any worksite").
  - No random splits, because hourly weather is autocorrelated and random splits leak.
- **Metrics:**
  - MAE and RMSE in °C;
  - **CRPS** (a score for probabilistic forecasts);
  - **PIT histograms and coverage** (are the ranges honest?);
  - for each warning level and lead day, **POD** (probability of detection), **FAR** (false-alarm ratio) and **CSI** (critical success index).
- **Experiment tracking:** MLflow (runs, parameters, metrics, model registry).
- **Stated limitation:** "truth" WBGT is derived from station T, Td and wind plus modelled radiation, not measured with a globe thermometer on site.
- **Updates after the 10 Nov state-of-the-art check:**
  - **Backbone data:** train and test on IFS 0.25° for 2024 to 2026. Use IFS 9 km only as a separate check on summer 2026, so a resolution change isn't mixed into the results. Note that ECMWF upgraded its models on 12 May 2026, so summer 2026 runs a different model version. We report results per summer.
  - **AI weather model comparison (new, a must-have):** score raw IFS against raw **AIFS** (ECMWF's AI model) against UAE stations for 2025 to 2026, by lead time and hour, for temperature, dew point and WBGT. We found **no published evaluation of AI weather models for Gulf humidity or WBGT**, so this result is new evidence in its own right.
  - **Multi-model correction:** feed IFS and AIFS (plus GFS, and WeatherNext 3 if access arrives) as features into the same LightGBM corrector.
  - **Comparator:** one small neural post-processor (a distributional regression network, DRN) as a check. The literature shows DRN wins mainly with hundreds of stations or years of data. With our roughly 10 stations, boosting is within a few percent, so LightGBM stays the main model.
  - **WBGT uncertainty done properly:** ranges for temperature and dew point cannot simply be combined into a WBGT range. We either sample temperature and dew point jointly (a copula, or ensemble-copula coupling) or also correct WBGT directly. Run both and compare; the literature says direct correction of the heat index is slightly best.
  - **Calibration caveat:** standard conformal prediction assumes data points are interchangeable, but hourly weather isn't, and the May 2026 model change breaks that further. So we calibrate separately per lead time and hour band, use time-blocked calibration sets, and test **adaptive (online) conformal prediction**.
  - **Not doing:** running AI weather models ourselves (AIFS needs 24 GB or more of GPU memory; we have 16 GB). We also won't use WeatherNext 2 (it has no dew point or sunlight) or CorrDiff (it needs gridded high-resolution training targets).

#### 8.4 Risk and warning levels
- **Exceedance probability:** P(effective WBGT > personal limit), taken from the calibrated forecast distribution.
- **Four levels:** Green, Amber, Orange, Red, set by probability thresholds and the ratio to the limit. HEAT-SHIELD used 80%, 100% and 120% of the limit as a precedent. Our final thresholds will be set from the back-test, not guessed.
- **Policy engine:** a deterministic lookup from level to action set, with each action traced to a CoP 11.0 clause or a NIOSH recommendation. It is versioned, and its tests are a **property-based test suite** that checks safety rules always hold.
- **Crew risk:** the distribution across members (for example, the highest-risk member and the share above Amber), not the average.
- **Alert-burden metric:** alerts per worker-shift, compared with (a) a naive "WBGT ≥ 32" rule and (b) the ban only.

#### 8.5 Shift planner (decision support)
- **Method:** constraint programming with **Google OR-Tools CP-SAT**.
- **Decision:** which hour each task runs in, the work–rest ratio, and rotation across crew members.
- **Constraints:**
  - midday ban hours;
  - task deadlines and dependencies;
  - crew size;
  - a maximum share of work at each risk level;
  - mandatory rest per NIOSH/CoP;
  - acclimatisation limits for new workers.
- **Objective:** minimise expected heat strain first, productivity loss second.
- **Uncertainty handling:** plan against the upper quantile (the pessimistic end) of the forecast. This is a simple **chance-constraint** approach and keeps "safety before productivity" built in.

#### 8.6 Communication layer (no safety decisions)
- **Alert templates:** fixed, human-reviewed strings in 6 languages. Right-to-left layout for Arabic and Urdu, plus pictograms and colour flags. We state the native-review status for each language.
- **Voice (decided after the 10 Nov check): pre-render the audio.**
  - Alerts are fixed templates, so we generate each clip **once**, when the template is approved, using **Azure Neural TTS in the UAE North region**. That service has voices for ar-AE, hi-IN, bn-BD, ne-NP, ur-PK and English, and processes speech in the region.
  - Clips ship as static audio files, so they work offline and a native speaker can check each one.
  - Free or open voice models were ruled out: Meta MMS is non-commercial; Piper has no Urdu or Bengali and restrictive voice licences; AI4Bharat models lack Urdu or Nepali.
  - To check: that every voice above is actually served from UAE North.
- **No runtime LLM in worker alerts.** The Qwen3 and Gemma model cards don't name Urdu, Bengali or Nepali, so an LLM never generates or translates a worker alert.
- **LLM and agent uses (could-have, all human-approved, none touching safety decisions), ranked by value:**
  1. **Compliance-report agent:**
     - **What it does:** writes the daily/weekly heat-safety report for a site.
     - **Numbers:** every number comes from engine logs, never from the LLM.
     - **Citations:** each claim carries a CoP 11.0 clause.
  2. **Supervisor copilot:**
     - **What it does:** answers questions ("can crew B pour at 14:00?").
     - **How:** read-only **tool calling** into our engine, plus **RAG** over the CoP 11.0 text, with cited answers.
     - **Guardrails:** it cannot set or override a level, and it refuses when evidence is missing.
  3. **Shift-plan drafter:**
     - **What it does:** proposes a plan, but can only call `propose_plan`.
     - **Safety check:** the engine re-validates every proposal against the hard safety rules, which cannot be relaxed.
     - **Approval:** a human approves it.
- **Model choice:**
  - **Self-hosted open models: Gemma 4 or Qwen3-14B.** Both are Apache-2.0 with stated tool-calling support. Benchmark both on our tool-calling test set, in Arabic and English. In production, the same weights run on in-UAE GPUs, which meets the DoH rule that AI compute and storage must be in the UAE.
  - **Jais 2 8B:** optional Arabic polish (Inception42, Apache-2.0, gated). It covers only Arabic/English, has an 8k context, and its card doesn't mention tool calling.
  - **Cloud alternatives:** Azure GPT models stay in the UAE only under "Regional Provisioned" capacity (the cheaper "Global" tiers may process data anywhere). Claude is not available in-UAE.
  - **Embeddings:** local BGE-M3.
- **LLM evaluation:**
  - faithfulness (every claim supported by a retrieved passage);
  - exact clause-ID citation match;
  - **every number equals the engine value**;
  - tool-argument accuracy;
  - refusal tests ("override the stop-work level");
  - prompt-injection tests through the documents;
  - all reported per language.
- **Data:** synthetic only.

#### 8.7 Personal strain model (stretch goal)
- **Method:** a **Bayesian state-space model**. PHS is the process model (environment → expected core temperature), and per-worker parameters (fitness, acclimatisation) carry priors, updated from consented heart rate with a **particle filter** or an ensemble Kalman filter.
- **Patent caution:** this differs from Buller's heart-rate-only extended Kalman filter, but **no freedom-to-operate analysis has been done**, so it stays behind a feature flag with a licence note.
- **Validation:** **simulated virtual workers** (varied age, BMI, acclimatisation, PPE and task) with realistic sensor noise, dropout and dust/PPE degradation. Heart-rate rules: NIOSH sustained HR > 180 − age, and the HR-only Physiological Strain Index variant.

#### 8.8 Governance and privacy (built into the architecture)
- **Consent ledger:** granular, revocable, and separate from the employment contract. The worker can see who accessed what (an audit log).
- **Data minimisation:** individual risk is computed **on the device**; the server receives only levels, aggregated.
- **Access control:** role-based access control (RBAC). The employer role has **no API route** to individual health data, and tests prove it: such a request returns HTTP 403 and is logged.
- **Small-cell suppression:** aggregates covering fewer than k workers are hidden. The value of k is to be decided; 5 is a common choice.
- **Purpose-limitation tests:** automated tests that fail the build if individual data leaks into supervisor or employer views.
- **Regulation:**
  - the DoH Responsible AI Standard (including in-UAE compute and storage for production);
  - UAE Federal Law No. 2 of 2019 (health-data localisation);
  - the PDPL;
  - a model card and a data declaration for every model and source.

#### 8.9 Field-readiness
- **Offline-first PWA:** a service worker, 48 h of forecasts cached, and the rules engine running locally.
- **Degraded modes:** wearable lost → weather-only risk; network lost → cached forecast plus rules; weather feed lost → a conservative fixed schedule. A printable crew card and colour flags are the last fallback.
- **Fault-injection tests** for every mode. The invariant: the fallback is never less protective than the ban alone.

#### 8.10 Population view (link to Challenge 06, could-have)
- Anonymous site- and area-level aggregates.
- Spike detection using **EARS C2/C3**, **CUSUM** and the **Farrington** algorithm, scored on injected test events.

#### 8.11 Tech stack

| Layer | Choice |
|---|---|
| Language/tooling | Python 3.13, `uv`, `ruff`, `mypy --strict`, `pytest` (unit/integration/e2e tiers), pre-commit, CI |
| Data storage | Parquet files + DuckDB for analysis; Postgres for app state (consent, audit) |
| ML | LightGBM, scikit-learn, MAPIE or our own CQR code, MLflow |
| Physics | thermofeel, pythermalcomfort |
| Optimisation | OR-Tools CP-SAT |
| Backend | FastAPI, Pydantic, structlog |
| Frontend | Next.js PWA, RTL support, three.js for the 3D site heat view (should-have) |
| Repo | `D:\dev\future-health-challenge` |

Every version gets checked and pinned at build time, not before.

#### 8.12 What gets reported in the submission (each line labelled)

| Metric | Label |
|---|---|
| Forecast error before/after AI correction, CRPS, coverage, POD/FAR/CSI by lead day | REAL |
| Alerts per worker-shift: ours vs naive threshold vs ban-only | REAL weather, our rules |
| Data latency per feed | REAL |
| Behaviour under faults; privacy tests passing | REAL (our code) |
| Strain-hours avoided, simulated incidents, lost work minutes vs ban-only | SIMULATED |
| Adherence scenarios (50% to 95%) | SIMULATED |
| Personal strain tracking accuracy | SIMULATED |

#### 8.13 Site heat layer from satellite (should-have, the only computer vision we use)
- **Source:** Landsat 8/9 land-surface temperature, 30 m, about 10:00 local time, every 8 days, free.
- **Output:** a map of hot surfaces and shade at each site, shown as **context** for supervisors (in the 3D/site view).
- **Contains no worker data.**
- **Limits:**
  - surface temperature is not air temperature or WBGT;
  - the morning pass misses the afternoon peak;
  - cloud cover was not checked.

  We say all of this on screen.

---

## Part E: Research update (10 Nov 2026): answers to "is it state of the art, Google, cameras, LLMs?"

### E1. Are our model choices state of the art?
- **For our data size, yes.**
  - With about 10 stations and 3 summers, published comparisons show gradient boosting within a few percent of the best neural post-processors.
  - The neural ones win mainly with hundreds of stations or many years of data (Rasp & Lerch 2018; Schulz & Lerch 2022).
  - So LightGBM with calibrated ranges is a defensible, near-state-of-the-art choice. We add one small neural comparator to show we checked.
- **The real frontier is AI weather models.** ECMWF AIFS, Google WeatherNext and Microsoft Aurora are now operational or close to it.
  - We **use** them as inputs and **evaluate** them in the UAE. We don't run them ourselves, because they need 24 GB+ of GPU memory and we have 16 GB.
  - Nobody has published how they perform on Gulf humidity/WBGT, so our comparison is new.
- **Fixes the check forced on the plan:**
  1. Backbone data is IFS 0.25° (9 km has only summer 2026).
  2. WBGT uncertainty must be built jointly, not by stacking the ranges.
  3. Calibration must respect time order and the May 2026 model upgrade.

### E2. Google
- **No "Google Earth weather API" as such.** Earth Engine hosts datasets, two of which help us:
  - **WeatherNext 3**, Google's AI model: past forecasts from 2024, with sunlight and dew point. Access needs a form and **5–7 business days**. **Action: request it today** at https://developers.google.com/weathernext/guides/access-forecast, and email weathernext@google.com asking for urgent onboarding and written OK for a safety pilot.
  - **NOAA GFS:** past forecasts from 2015, with sunlight.
- **Not useful:** the Maps Platform Weather API. It has no sunlight data, keeps only 24 hours of history, and its terms forbid storing the data.
- **Earth Engine terms:** free for non-commercial projects only. A commercial pilot needs a paid plan.

### E3. Cameras and computer vision
- **UAE CCTV integration: rejected.**
  - Abu Dhabi's city camera system (Falcon Eye, run by the Monitoring and Control Centre) is state-run, so a team has no access route.
  - Worksite cameras belong to employers.
  - Any per-worker video conflicts with the challenge's own warning about surveillance and employment misuse.
  - The PDPL even lets employers skip consent for "employment rights" purposes, which is exactly the misuse risk. We go stricter than the law on purpose.
- **Other computer-vision ideas: rejected for now.**
  - **PPE detection:** it isn't heat prevention, reads as disciplinary, and the main datasets are non-commercial.
  - **Pose-to-workload:** no validated method was found.
  - **Thermal cameras:** they're poor at absolute body temperature (bias about −1.4 °C).
  - We record all of these as "pilot-only, employer-controlled, consented" in the repo's parking lot.
- **Kept:** the Landsat site heat layer (8.13). It carries no worker data.
- **A governance slide in the deck:** "Why we rejected cameras", citing the challenge text. Showing the restraint scores points under Responsible AI.

### E4. LLMs and agents
- **Yes, but in bounded roles** (see 8.6): a compliance-report agent, a supervisor copilot and a shift-plan drafter, all tool-using and human-approved. None of them decides a warning level.
- **Worker alerts never come from an LLM.** They are pre-approved, native-reviewed templates with pre-rendered audio.
- **Models:** self-hosted Gemma 4 or Qwen3-14B (Apache-2.0) for UAE data residency; Jais 2 optional for Arabic.
- **Regulation:** the DoH Responsible AI Standard (Oct 2025) requires in-UAE AI compute and storage (clause 3.1.4.5.1), human oversight, graceful degradation and audit trails. It formally covers licensed healthcare entities, so whether it covers an employer-deployed tool needs confirming with DoH. We treat it as a design rule either way.

### E5. Changes to scope
- **Must (added):**
  - the IFS vs AIFS comparison in the UAE;
  - multi-model correction;
  - joint WBGT uncertainty.
- **Should (added):**
  - the Landsat site heat layer;
  - pre-rendered voice clips.
- **Could:** the three LLM agents (compliance report first), and the WeatherNext 3 arm if access arrives in time.
- **Will not do (added):**
  - camera or CCTV integration and any per-worker computer vision;
  - running AI weather models locally;
  - LLM-generated or translated worker alerts.

### E6. Still unverified (check before relying on it)
- Exact archive start dates across full ranges (spot-checked at one point only).
- Which Azure voices are actually served from UAE North.
- The Landsat licence wording.
- Gemma 4 / Qwen3 quality in Urdu, Bengali and Nepali.
- Jais 2 tool calling.
- Earth Engine commercial pricing.
- Whether the DoH AI Standard applies to employers.

---

### 9. Glossary

| Term | Meaning |
|---|---|
| **WBGT** (Wet Bulb Globe Temperature) | The standard heat-stress number that combines temperature, humidity, sunlight and wind. Higher means more dangerous |
| **TWL** (Thermal Work Limit) | Abu Dhabi's official heat index: how much work (in W/m²) a body can safely sustain. We could not find its formula published openly |
| **Liljegren method** | A physics method for calculating WBGT from ordinary weather data |
| **PHS** (Predicted Heat Strain, ISO 7933) | A body model that predicts sweating, core temperature and safe work time |
| **NIOSH RAL / REL** | US safe-heat limits by workload: RAL for unacclimatised workers, REL for acclimatised ones |
| **Acclimatisation** | The body getting used to heat over about 1 to 2 weeks; new workers are at higher risk |
| **Metabolic rate (M)** | How hard the body is working, in watts. Heavy work means a lower safe limit |
| **Lead time** | How far ahead a forecast is made (1 day ahead, 3 days ahead, ...) |
| **MOS / post-processing** | Using statistics or ML to correct a weather model's known errors at a location |
| **EMOS** | A classic statistical post-processing method; our baseline to beat |
| **Quantile regression** | A model that predicts a range (for example, low, middle and high values) instead of one number |
| **Conformal prediction / CQR** | A technique that makes predicted ranges statistically honest |
| **LightGBM** | A fast gradient-boosted decision-tree library; strong on table-shaped data |
| **CRPS** | A score for how good a range forecast is (lower is better) |
| **PIT / coverage** | Checks on whether stated uncertainty ranges match reality |
| **POD / FAR / CSI** | Warning-quality scores: how many real events we caught, how many alarms were false, and an overall balance |
| **Leave-one-out validation** | Testing on a whole summer or station the model never saw, to prove it generalises |
| **Back-test** | Running the system on past data as if live, to measure how it would have performed |
| **Constraint programming / CP-SAT** | A solver that finds the best schedule satisfying all the rules |
| **Chance constraint** | Planning so that rules hold even in a bad-but-plausible forecast case |
| **Deterministic policy engine** | Fixed rules (not AI) that turn a risk level into actions; always the same output for the same input |
| **LLM** | Large language model (a ChatGPT-style AI) |
| **RAG** | Letting an LLM look up real documents and cite them, instead of answering from memory |
| **Tool calling** | Letting an LLM call our own functions (for example, "get crew B's risk at 14:00") |
| **Jais 2** | An Arabic/English LLM family by Inception42 (one of the challenge co-creators) |
| **TTS** | Text-to-speech |
| **Bayesian state-space model** | A model that tracks a hidden quantity (for example, core temperature) over time and updates its belief as new readings arrive |
| **Particle filter / Kalman filter** | Algorithms that do that updating |
| **Physiological Strain Index (PSI)** | A 0 to 10 strain score from heart rate (and core temperature) |
| **PWA** | Progressive Web App: a website that installs like an app and works offline |
| **RBAC** | Role-based access control: what each role (worker, supervisor, employer) can see |
| **Small-cell suppression** | Hiding totals for very small groups so individuals can't be identified |
| **Fault injection** | Deliberately breaking parts (sensor, network, feed) to prove the system stays safe |
| **EARS / CUSUM / Farrington** | Standard public-health algorithms for spotting unusual spikes in counts |
| **FTO** (freedom to operate) | A legal check that we don't infringe someone's patent |
| **SaMD** | Software as a Medical Device: a regulated category we avoid by not diagnosing |
| **ADOSH-SF CoP 11.0** | Abu Dhabi's occupational safety code for working in heat |
| **ECMWF / IFS / ERA5** | The European weather centre / its forecast model / its historical weather reconstruction |
| **AIFS** | ECMWF's AI weather model, operational alongside IFS |
| **WeatherNext** | Google DeepMind's AI weather forecasts (version 3 is current) |
| **GFS** | The US (NOAA) global forecast model |
| **NWP** | Numerical weather prediction: physics-based forecast models like IFS and GFS |
| **DRN** | Distributional regression network: a small neural network that predicts a forecast's full uncertainty |
| **Copula / ensemble-copula coupling** | Ways to keep temperature and dew point errors linked when sampling them together |
| **Adaptive conformal prediction** | A version of conformal prediction that keeps adjusting when data drifts over time |
| **Multi-model MOS** | Correcting a forecast using several weather models as inputs at once |
| **Land-surface temperature (LST)** | How hot the ground surface is, as measured from satellite; not the same as air temperature |
| **Landsat** | NASA/USGS Earth-observation satellites with a thermal camera |
| **Faithfulness** | Whether every claim an LLM makes is supported by the documents it retrieved |
| **Prompt injection** | Hidden instructions inside documents that try to hijack an LLM |
| **PDPL** | The UAE's personal data protection law (Federal Decree-Law 45 of 2021) |
| **Data residency** | The rule that data and computing must stay inside a country (here, the UAE) |
| **GHCNh** | NOAA's global hourly weather-station dataset |
| **CAMS** | Copernicus atmosphere service (dust and air-quality forecasts) |

---

*Sources: the full evidence and citations are in the Compendium vault (`Ali/Future-Health-Challenge/`, notes "Future Health Challenge" and "07 Climate-Resilient Worker Health") and in the repo's `research/raw/` captures.*
