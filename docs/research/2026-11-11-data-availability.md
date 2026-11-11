# Data availability check for assumption A1 (2026-11-11)

**Question.** Is there enough hourly UAE station observation data, plus archived past forecasts at matching times, for the summers (15 May to 30 Sep) of 2024, 2025 and 2026, to train and fairly evaluate the forecast post-processor (temperature, dew point, wind; WBGT derived)?
**Plan reference:** `docs/context/challenge-07-plan.md`, Part B assumption A1, section 8.1, Part E.
**Run date:** 2026-11-11 (prototype due 2026-11-20). All scripts and result files are in `docs/research/scripts/` (see section 10).

## 0. Verdict

**A1 HOLDS, with five quantitative corrections to how the plan words it.** The data to train and test a T/Td/wind corrector exists, is almost complete, and was downloaded and counted. The binding constraint is not the number of hours; it is the number of independent sites (about 4 to 5), the quality of the "truth", and one licence decision.

| # | Result | Evidence tag |
|---|---|---|
| 1 | **8 usable stations, not "about 10"**, each with all three summers: Abu Dhabi Intl (OMAA), Al Bateen (OMAD), Al Ain (OMAL), Dubai Intl (OMDB), Al Maktoum (OMDW), Fujairah (OMFJ), Sharjah (OMSJ), Ras Al Khaimah (OMRK). Joint valid T+Td+wind hours (IEM METAR) are 95.4% to 100.0% of the 3,336 summer hours per station-summer (20 of 24 at or above 99%). Sweihan, Das Island, Zirku, Al Dhafra, Delma, Sir Abu Nair, Liwa, Medina Zayed have no usable 2024 to 2026 hourly data. | [D] |
| 2 | **Matched (forecast, observation) pairs: 26,608 / 26,413 / 26,633 per lead per summer** (2024 / 2025 / 2026, 8 stations, IFS 0.25 deg, IEM truth), **79,654 over three summers; 29,922 of them in 10:00 to 18:59 local**. The count is identical for every lead 0 to 7 days because forecast coverage is 100%: observations are the only limit. | [D] |
| 3 | **Effective independent sample is about 1,000 to 1,300 station-days, not 79,654 hours.** Error autocorrelation leaves about 55% to 67% of station-days independent; the 8 stations behave like only **4.2 to 4.6 independent sites** (OMDB and OMSJ map to the same forecast cell, error correlation 0.88 to 0.89). | [D] then [C] |
| 4 | **Forecast archives cover all three summers for ECMWF IFS 0.25 deg and NOAA GFS at leads 1 to 7 days (T, Td, wind, shortwave radiation, direct radiation, pressure, 3,336 of 3,336 hours); ECMWF AIFS only 2025 and 2026; IFS 9 km only 2026.** | [D] |
| 5 | **Licence risk: the free Open-Meteo API is non-commercial only**, and a prize competition entry by a private individual that is scored on "commercial viability" is a grey zone under its own terms. Two clean alternatives exist (section 4). | [Q] and [I] |

**Things the plan or the brief assumed that the data contradict** (details in section 8): the "ECMWF open data keeps only 12 runs" statement is false for the AWS replica (it holds every day from 2023-01-19); Meteostat is now CC BY 4.0 but is unusable as truth; NOAA ISD "global-hourly" stopped on 2025-08-24; GHCNh 2026 data has no QC yet; station pressure is 0 to 33% complete, not 17%; METAR truth is whole degrees Celsius; there is no observed solar radiation anywhere in the open sources.

### Evidence tags used throughout

- **[D]** downloaded and counted by a script in `docs/research/scripts/` on 2026-11-11 (script named).
- **[C]** computed from [D] numbers (arithmetic stated).
- **[Q]** quoted from a web page (URL given; a "(fetch summary)" mark means the quote came from a page-reading tool, not a raw HTML check).
- **[I]** my inference or estimate. Not measured.

---

## 1. Observation sources compared

Summer window = 15 May 00:00 UTC to 30 Sep 23:00 UTC = 139 days = **3,336 hourly bins**; daytime = 06:00 to 14:59 UTC (10:00 to 18:59 UAE time) = **1,251 bins**. Observations were assigned to the nearest UTC hour (a METAR at HH:50 goes to HH+1); the observation closest to the hour wins. "Joint" = T, Td and wind all valid in that hour. Plausibility limits: T -10 to 60 C, Td -30 to 40 C, wind 0 to 60 m/s.

| Source | What it is | Coverage found | Completeness for the 8 core stations | QC / caveats | Verdict |
|---|---|---|---|---|---|
| **IEM (Iowa Environmental Mesonet) METAR archive** `mesonet.agron.iastate.edu/cgi-bin/request/asos.py` [D `fetch_iem.py`, `analyze_obs.py`] | Hourly METAR plus specials, network `AE__ASOS`, 16 station IDs | All 8 core stations have all three summers; OMAB, OMAZ, OMDL, OMDM, OMLW, OMMZ, OMTH returned empty files, QGX one row in 2025 | 95.4% to 100.0% joint (table O1); longest gap 17 h | No QC flags. T, Td whole degrees C. No radiation. Altimeter hourly, no station pressure | **Primary truth**: most complete, no QC lag, 2026 complete |
| **NOAA GHCNh v1.1.0** `ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/<Y>/parquet/` [D `fetch_ghcnh.py`, `analyze_obs.py`] | METAR + SYNOP merged, QC flags per element | Same 8 stations, all three summers. 23 UAE and border stations listed; 14 have no usable 2024 to 2026 data (table O2); 9 qualify, of which 8 are UAE and 1 is Omani | Lenient 94.9% to 99.9%; strict-QC 91.4% to 98.9% for 2024/2025, **0% for 2026** | 2026 rows have a blank QC code (NOAA has not run QC yet); a 5-day 2025 stretch (starting 29 or 30 Aug 2025) also has blank QC. See section 2.2 | **Audit layer**: adds SYNOP tenths and QC flags |
| **NOAA ISD "global-hourly"** `noaa-global-hourly-pds.s3.amazonaws.com/<Y>/<USAF-WBAN>.csv` [D, `curl`] | Legacy product | OMAA 2025 file ends **2025-08-24T21:00**; the 2026 file returns HTTP 404 | Summer 2025 truncated; summer 2026 absent | NOAA states GHCNh "replaces the legacy Global Hourly product" [Q `ghcnh_DOCUMENTATION.pdf`, v1.1.0 dated March 10, 2026] | **Do not use** |
| **Meteostat bulk** `bulk.meteostat.net/v2/hourly/<WMO>.csv.gz` [D `count_meteostat.py`] | Aggregated hourly | 7 stations tried; file ends 2025-10-15 (HTTP header last-modified 2025-10-05); 2026 rows 0 | **100% (3,336 of 3,336) for every variable incl. pressure** at every station in 2024 and 2025 | Meteostat's own page: "By default, Meteostat returns a combination of real observations and model-derived data." [Q `dev.meteostat.net/quality`] | **Do not use as truth** (mixes model data into the target, frozen) |
| **Ogimet SYNOP** `ogimet.com/cgi-bin/getsynop` [D, one-day sample, `curl`] | Raw SYNOP text | OMAA 2025-07-01: 8 reports, 3-hourly | n/a (sample only) | No sunshine or radiation groups in the sample; same reports GHCNh already merges | Not needed |

Cross-check between the two usable sources [D `compare_sources.py`, `results/source_crosscheck.csv`]: on hours where both have a value, mean absolute difference is **0.00 to 0.09 C** (T), **0.00 to 0.11 C** (Td), **0.03 to 0.04 m/s** (wind); 2026 T differences are 0.00 to 0.01 C. They are the same underlying METARs, so agreement is not independent validation.

## 2. Observation tables and truth quality

### 2.1 Table O1: the 8 core stations [D `analyze_obs.py`; `results/obs_counts_*.csv`]

Joint valid T+Td+Wind hours out of 3,336. "IEM day-hours" is out of 1,251. "GHCNh stn-pressure" is hours with a valid station-level pressure; "IEM altimeter" is hours with a valid altimeter setting.

| Station | Summer | IEM joint (h, %) | IEM day-hours | IEM longest gap (h) | GHCNh lenient | GHCNh strict-QC | GHCNh stn-pressure (h) | IEM altimeter (h) |
|---|---|---|---|---|---|---|---|---|
| OMAA Abu Dhabi Intl | 2024 | 3334 (99.9%) | 1249 | 2 | 3253 (97.5%) | 3253 (97.5%) | 1090 | 3334 |
| OMAA Abu Dhabi Intl | 2025 | 3335 (100.0%) | 1251 | 1 | 3287 (98.5%) | 3168 (95.0%) | 1075 | 3335 |
| OMAA Abu Dhabi Intl | 2026 | 3335 (100.0%) | 1250 | 1 | 3333 (99.9%) | 0 (0.0%) | 1104 | 3335 |
| OMAD Al Bateen | 2024 | 3325 (99.7%) | 1249 | 2 | 3251 (97.5%) | 3251 (97.5%) | 1084 | 3325 |
| OMAD Al Bateen | 2025 | 3335 (100.0%) | 1251 | 1 | 3319 (99.5%) | 3201 (96.0%) | 1062 | 3335 |
| OMAD Al Bateen | 2026 | 3335 (100.0%) | 1250 | 1 | 3333 (99.9%) | 0 (0.0%) | 1099 | 3335 |
| OMAL Al Ain Intl | 2024 | 3331 (99.9%) | 1247 | 2 | 3243 (97.2%) | 3243 (97.2%) | 1088 | 3331 |
| OMAL Al Ain Intl | 2025 | 3335 (100.0%) | 1251 | 1 | 3267 (97.9%) | 3148 (94.4%) | 1074 | 3335 |
| OMAL Al Ain Intl | 2026 | 3336 (100.0%) | 1251 | 0 | 3334 (99.9%) | 0 (0.0%) | 1108 | 3336 |
| OMDB Dubai Intl | 2024 | 3331 (99.9%) | 1249 | 2 | 3258 (97.7%) | 3258 (97.7%) | 1090 | 3331 |
| OMDB Dubai Intl | 2025 | 3335 (100.0%) | 1251 | 1 | 3314 (99.3%) | 3196 (95.8%) | 1071 | 3335 |
| OMDB Dubai Intl | 2026 | 3319 (99.5%) | 1249 | 17 | 3317 (99.4%) | 0 (0.0%) | 993 | 3319 |
| OMDW Al Maktoum Intl | 2024 | 3333 (99.9%) | 1249 | 2 | 3243 (97.2%) | 3243 (97.2%) | 0 | 3333 |
| OMDW Al Maktoum Intl | 2025 | 3290 (98.6%) | 1236 | 14 | 3303 (99.0%) | 3185 (95.5%) | 0 | 3290 |
| OMDW Al Maktoum Intl | 2026 | 3317 (99.4%) | 1248 | 17 | 3315 (99.4%) | 0 (0.0%) | 0 | 3317 |
| OMFJ Fujairah Intl | 2024 | 3336 (100.0%) | 1251 | 0 | 3300 (98.9%) | 3300 (98.9%) | 1076 | 3336 |
| OMFJ Fujairah Intl | 2025 | 3267 (97.9%) | 1248 | 2 | 3285 (98.5%) | 3172 (95.1%) | 453 | 3268 |
| OMFJ Fujairah Intl | 2026 | 3334 (99.9%) | 1251 | 1 | 3332 (99.9%) | 0 (0.0%) | 616 | 3334 |
| OMSJ Sharjah Intl | 2024 | 3332 (99.9%) | 1248 | 2 | 3247 (97.3%) | 3247 (97.3%) | 1078 | 3332 |
| OMSJ Sharjah Intl | 2025 | 3334 (99.9%) | 1251 | 1 | 3322 (99.6%) | 3204 (96.0%) | 1069 | 3334 |
| OMSJ Sharjah Intl | 2026 | 3336 (100.0%) | 1251 | 0 | 3334 (99.9%) | 0 (0.0%) | 1108 | 3336 |
| OMRK Ras Al Khaimah | 2024 | 3286 (98.5%) | 1232 | 2 | 3203 (96.0%) | 3203 (96.0%) | 0 | 3292 |
| OMRK Ras Al Khaimah | 2025 | 3182 (95.4%) | 1210 | 9 | 3165 (94.9%) | 3049 (91.4%) | 0 | 3187 |
| OMRK Ras Al Khaimah | 2026 | 3321 (99.6%) | 1249 | 2 | 3319 (99.5%) | 0 (0.0%) | 4 | 3320 |

Totals over the 8 stations (IEM joint) [C from the table]: 2024 = 26,608 of 26,688 (99.7%); 2025 = 26,413 (99.0%); 2026 = 26,633 (99.8%). Daytime: 9,974 / 9,949 / 9,999 of 10,008.
OMRK's IEM ID `OMRK` was matched to GHCNh station `AEU041184-1` (ISD coordinates 25.613 N, 55.939 E used for the forecast point); the two agree to 0.01 to 0.09 C (mean absolute) on T.

### 2.2 Table O2: stations that do not qualify [D `analyze_obs.py`; `results/obs_counts_ghcnh_lenient.csv`]

GHCNh joint valid hours (and raw observation rows in that station-year file). "no file" = HTTP 404 from NCEI for that year.

| Station | 2024 | 2025 | 2026 |
|---|---|---|---|
| OMAB Buhasa, OMAH Al Hamra, OMAJ Jebel Dhanna, OMAS Das Island, OMAW Sweihan, OMAZ Zirku, OMDM Dubai Minhad, 40449 Ash Shariqah SW | no file | no file | no file |
| OMAM Al Dhafra | no file | 3 h (6 rows) | no file |
| OMDL Delma | 0 h (18 rows) | 0 h (309 rows) | no file |
| OMLW Liwa AB | no file | no file | 0 h (1,752 rows) |
| OMQS Qusaiwera AB | 0 h (19 rows) | 0 h (157 rows) | no file |
| OMSN Sir Abu Nair | 0 h (3 rows) | 0 h (30 rows) | no file |
| 41226 Medina Zayed | no file | no file | 0 h (877 rows) |
| 41244 Buraimi (Oman, 14 km from Al Ain) | 3,019 h | 3,126 h | 118 h (wind largely missing) |

Sir Bani Yas and Ruwais (UAE) do not appear in the NOAA GHCNh station list or in ISD history (searched by name) [D, `curl` + grep]. The official UAE National Center of Meteorology automatic-station network is not open data and was not tested [I].

### 2.3 What limits the "truth"

All [D] unless marked.

1. **Resolution.** 100% of IEM temperatures are whole degrees C (`iem_T_whole_degree_share` = 1.0 in `source_crosscheck.csv`); GHCNh adds tenths only at SYNOP hours. A whole-degree rounding adds about 0.29 C of noise (1/sqrt(12)) [C]; against raw day-1 IFS T errors of 1.6 to 1.8 C MAE (RMSE 2.1 to 2.4 C) and Td errors of 2.9 to 3.1 C (RMSE 4.3 to 4.6 C) that is small, but it sets a noise floor when comparing correctors that differ by about 0.1 to 0.2 C.
2. **No observed radiation, no observed WBGT.** GHCNh has 64 value columns and none is radiation or sunshine; the IEM request returns no radiation; the Ogimet one-day OMAA sample has no radiation groups; a web search found only papers using UAE ground radiation, no open dataset (not exhaustive). So WBGT "truth" stays derived from observed T, Td, wind plus modelled radiation (assumption A2 stands unchanged).
3. **Pressure.** GHCNh station-level pressure exists only at SYNOP hours: 993 to 1,108 of 3,336 hours (30% to 33%) at OMAA, OMAD, OMAL, OMDB, OMSJ in all years and at OMFJ in 2024; 453 (2025) and 616 (2026) at OMFJ; 0 at OMDW in all years and at OMRK in 2024 and 2025, 4 at OMRK in 2026 (METAR-only). The plan's "about 17%" is too low where it exists and too high for METAR-only airports. Hourly pressure is available only as a METAR altimeter setting (QNH; 3,187 to 3,336 hours), which is not station pressure. The plan's choice (use model pressure) is consistent with this.
4. **GHCNh QC.** For 2026, QC codes are blank on most rows, so "strict" gives 0 hours; I therefore report a "lenient" mode (QC code 1 or blank, plausible range). Where QC exists, it flags about 1% of dew points as code 2 "suspect": e.g. OMAA 2024 38 rows, OMFJ 2024 101 rows. Flagged dew-point values span -1 to 31 C, and the flags include one 47.7 C temperature at OMAA 2025 and 46.5 C at OMDB 2025 [D `check_qc_rejections.py`]. I did not verify whether those are real. A QC that removes the hottest observed hours would bias a heat-stress evaluation; do not drop QC-flagged rows blindly.
5. **Stations are airports.** All eight are METAR airport sensors; a construction site is not an airport. The claim "generalises to any worksite" cannot be supported by these eight points alone (see section 7).
6. **Valid-time alignment** between a METAR taken at HH:50 and a model value at HH:00 was not validated (up to 10 minutes of offset) [I].

---

## 3. Archived forecasts

### 3.1 Which forecasts exist, and from when [D `probe_forecast_archive.py`, `summarize_forecast_probe.py`, `results/forecast_archive_probe_result.json`]

Point = OMAA (24.433 N, 54.651 E); request window 2021-01-01 to 2026-11-10; times UTC. "PrevRuns day1" is `<var>_previous_day1`, "the value predicted 24 hours before valid time" [Q `open-meteo.com/en/docs/previous-runs-api`]. "HistFcst" is the Historical Forecast API, which is "built by stitching the first hours of each successive model run" [Q `open-meteo.com/en/docs/historical-forecast-api` (fetch summary)]: it has no fixed lead and cannot be used to score day-ahead forecasts.

**Table F1: first non-null date**

| Model | PrevRuns day1 T | PrevRuns day1 Td | PrevRuns day1 shortwave | HistFcst T | HistFcst Td |
|---|---|---|---|---|---|
| ecmwf_ifs025 | 2024-02-04 | 2024-02-29 | 2024-03-06 | 2024-02-03 | 2024-02-28 |
| ecmwf_ifs (9 km) | 2025-10-01 | 2025-10-01 | 2025-10-01 | 2021-01-01 (window start) | 2021-01-01 (window start) |
| ecmwf_aifs025_single | 2025-02-18 | 2025-02-18 | 2025-02-17 | 2025-02-17 | 2025-02-17 |
| gfs_seamless | 2021-03-24 | 2024-01-19 | 2024-01-19 | 2021-03-23 | 2021-03-23 |
| gfs_global | 2021-03-24 | 2024-01-19 | 2024-01-19 | 2021-03-23 | 2021-03-23 |
| ncep_aigfs025 | 2026-01-22 | none | none | 2026-01-06 | none |
| icon_global | 2024-01-19 | 2024-01-19 | 2024-01-19 | 2022-11-16 | 2022-11-16 |
| gem_global | 2024-01-19 | 2024-01-19 | 2024-01-19 | 2022-11-23 | 2023-05-17 |
| ukmo_global_deterministic_10km | 2024-08-08 | 2024-08-08 | 2025-01-03 | 2022-03-01 | 2022-03-01 |

A first non-null date is not contiguous coverage. For `ecmwf_ifs` the wind series starts 2025-01-02 yet summer 2025 is empty; Table F2 is the authority.

**Table F2: non-null hours in each summer (of 3,336), day-1 to day-7 leads** [D, same script; each cell is T / Td / shortwave at that lead; wind, direct radiation and surface pressure were probed too and follow the same pattern for the models marked "full"]

| Model | Summer 2024 | Summer 2025 | Summer 2026 |
|---|---|---|---|
| **ecmwf_ifs025** | **full** (3,336 for every variable and every lead 0 to 7) | **full** | **full** |
| ecmwf_ifs (9 km) | 0 at every lead | 0 at every lead (incl. wind) | full |
| **ecmwf_aifs025_single** | 0 | **full** | **full** |
| **gfs_seamless / gfs_global** | **full** | **full** | **full** |
| ncep_aigfs025 | 0 | 0 | partial T 2,808 to 3,336, wind 2,448 to 3,336; **no Td, no shortwave** |
| icon_global | full leads 0 to 5; **lead 7 = 0** | same | same |
| gem_global | full | full | 3,072 to 3,336 (about 92% to 100%) |
| ukmo_global_deterministic_10km | sparse: T 548 to 1,248 at leads 1 to 5; no shortwave | T 2,048 to 2,950; shortwave only at day 1 | T 2,789 to 3,336; shortwave only at day 1 |

Plan statements checked: IFS 0.25 deg backbone for 2024 to 2026 **confirmed**; AIFS "2025 and 2026" **confirmed**; IFS 9 km "2026 only" **confirmed** (summer 2025 = 0 of 3,336).

The "previous day N" values are lead-dependent (day-1 daytime dew-point MAE rises with lead in every model: IFS 2025, 2.93 / 3.40 / 4.04 C at day 1 / 3 / 7 [D, Table E1]), which is what real archived forecasts would do. That the archive holds genuine past runs rather than back-filled data rests on Open-Meteo's documentation, which I did not independently verify [I].

### 3.2 Station-level forecast pulls [D `fetch_forecast_stations.py`]

64 downloads: 8 stations x (IFS 0.25 deg x 3 summers + AIFS x 2 + GFS x 3), variables T, Td, 10 m wind at day 0 and day 1 to 7. Each station's value is its nearest *land* grid cell as chosen by Open-Meteo (not always the geometrically nearest):

| Station | Station elev (m) | IFS/AIFS cell (lat, lon) | Cell elev (m) | Distance station to cell (km) |
|---|---|---|---|---|
| OMAA | 26.8 | 24.50, 54.75 | 16 | 12.5 |
| OMAD | 4.9 | 24.50, 54.50 | 4 | 9.0 |
| OMAL | 264.9 | 24.25, 55.50 | 254 | 11.1 |
| OMDB | 10.4 | **25.25, 55.50** | 2 | 13.7 |
| OMSJ | 33.8 | **25.25, 55.50** | 25 | 8.9 |
| OMDW | 18.9 | 25.00, 55.25 | 47 | 14.9 |
| OMFJ | 46.3 | 25.00, 56.25 | 30 | 14.5 |
| OMRK | 31.1 | 25.50, 56.00 | 23 | 14.0 |

**OMDB and OMSJ receive identical IFS and AIFS forecasts** (same cell): 7 distinct forecast points for 8 stations [D]. GFS gives 8 distinct cells.

### 3.3 ECMWF open data directly (the licence-clean route)

- **ECMWF's own server keeps only a rolling window**: "Data are retained for the most recent 12 forecast runs, corresponding to approximately 2-3 days of forecasts" [Q `ecmwf.int/en/forecasts/datasets/open-data`, raw HTML checked]. (A Confluence page I read via a page-reading tool says "approximately for 4 days"; the two pages disagree; neither matters for the replica.)
- **The AWS replica is a real archive.** Public bucket `ecmwf-forecasts` [D `probe_ecmwf_open_aws.py`]: 1,386 date prefixes from **2023-01-19 to 2026-11-11**; **139 of 139 days present in each of the summers 2023, 2024, 2025, 2026**; 7 missing days in the whole span (2023-04-27 to 2023-05-02 and 2025-10-20); four run prefixes per day (00z, 06z, 12z, 18z).
- **Files exist and byte-range reads work** [D `probe_ecmwf_open_files*.py`, `probe_ecmwf_range_get.py`]: IFS `0p25/oper` 2024-07-15 00z has 65 step files (0 to 240 h); 2025-07-15 and 2026-07-15 have 85 (0 to 360 h); AIFS 2024 (`aifs/0p25/oper`) 61 steps, 2025 and 2026 (`aifs-single/0p25/oper`) 61 steps (6-hourly to 360 h). A byte-range GET of the 2 m temperature message returned HTTP 206 with the correct length and a `GRIB` header for 2024-07-15, 2025-07-15 and 2026-07-15 (IFS) and 2025-07-15 and 2026-07-15 (AIFS single).
- **Cost to build it ourselves** [C from the `.index` sidecar sizes, `probe_ecmwf_index_sizes.py`]: 2 m T 0.66 MB + 2 m Td 0.68 MB + 10 m u 0.87 MB + 10 m v 0.86 MB = **3.07 MB per step** (IFS 2025-07-15); adding surface solar radiation (1.29 MB) gives 4.36 MB. One run per day (00z) at 3-hourly steps to 72 h: 25 steps, 77 MB per day, **10.7 GB per summer, 32 GB for three summers, about 41,700 range requests**. To day 7 (53 steps): 163 MB per day, **22.6 GB per summer, 68 GB for three, about 88,400 requests**. Global fields cannot be sub-set spatially; point extraction needs a GRIB reader (eccodes or cfgrib), not tested on this Windows host [I]. That is a multi-day build, not a back-test shortcut; it is the path for production, not for 20 November.
- Practical environment note: the regional virtual-host endpoint `ecmwf-forecasts.s3.eu-central-1.amazonaws.com` reset connections intermittently on this network; the global endpoint `ecmwf-forecasts.s3.amazonaws.com` worked.
- ECMWF's IFS cycle history: **IFS cycle 50r1 and AIFS v2 went live on 12 May 2026** (from the 06 UTC run) [Q `ecmwf.int/en/about/media-centre/news/2026/ifs-cycle-50r1-aifsv2-live` (search result summary)]. 49r1 is dated "November 2024" in an ECMWF slide deck [Q, search summary; exact day not verified]. So the three summers are three different IFS versions (2024: the pre-49r1 cycle by inference [I]; 2025: 49r1; 2026: 50r1), and AIFS changes from v1 (2025) to v2 (2026). Leave-one-summer-out therefore also tests robustness to a model upgrade.

---

## 4. Licences (quoted)

| Source | Exact wording | Commercial use | URL |
|---|---|---|---|
| **Open-Meteo free API** [Q, raw HTML checked 2026-11-11] | "You may only use the free API services for non-commercial purposes." "Less than 10'000 API calls per day, 5'000 per hour and 600 per minute." "Non-commercial use is defined as elaborated by creative commons." Non-commercial examples: "Private or non-profit websites or apps that do not have subscriptions or advertising." "Public research conducted at public institutions." "Use in educational content." Commercial examples: "Websites or apps that have subscriptions or display advertisements." "Commercial products or promotional activities." "Undisclosed research at commercial entities." | **No** on the free tier | `https://open-meteo.com/en/terms` |
| Open-Meteo pricing page [Q, raw HTML] | "The free API is for non-commercial use, rate-limited to 10,000 calls/day, and carries no uptime guarantee. The customer API runs on dedicated servers, has no daily rate limit, and includes a commercial use licence." Plans: API Standard 1M calls/month, Professional 5M, Enterprise 50M+. **No prices appear in the page text I fetched.** Monthly free limit in the table: 300,000. | Paid plans: yes | `https://open-meteo.com/en/pricing` |
| Open-Meteo data licence [Q, raw HTML] | "The server code is open-source under AGPLv3; the weather data is CC BY 4.0." "While you are permitted to utilise and distribute the data, including for commercial purposes, attribution is a requirement under this licence." Attribution: "You must include a link next to any location Open-Meteo data are displayed" (licence page). Free tier: "You accept to the CC-BY 4.0 licence, as specified in the licence conditions." | Data: yes with attribution; *service* use on the free tier: no | `https://open-meteo.com/en/pricing`, `https://open-meteo.com/en/licence` |
| **ECMWF open data** [Q, raw HTML] | "Their use is governed by the Creative Commons CC-BY-4.0 licence and the ECMWF Terms of Use. This means that the data may be redistributed and used commercially, subject to appropriate attribution." | **Yes** | `https://www.ecmwf.int/en/forecasts/datasets/open-data` |
| ECMWF data on AWS [Q (fetch summary)] | "This ECMWF data is published under a Creative Commons Attribution 4.0 International license." Suggested citation: "ECMWF real-time forecasts was accessed on `DATE` from https://registry.opendata.aws/ecmwf-forecasts." DOI 10.21957/open-data. "The AWS replica bucket is updated as new data are published and may retain older data conventions/versions over time." | Yes | `https://registry.opendata.aws/ecmwf-forecasts/` |
| **IEM** [Q, raw HTML] | "The materials found on this website are in the public domain and may be used freely by anyone for any lawful purpose. Attributing the Iowa Environmental Mesonet of Iowa State University would be appreciated." Also: "We therefore provide this information without any warranty of accuracy." The underlying METARs originate with the UAE aviation weather service; I did not check any international data-exchange policy that may apply upstream [I]. | Yes | `https://mesonet.agron.iastate.edu/disclaimer.php` |
| **NOAA GHCNh** [D] | The product page and the 2026-03-10 v1.1.0 documentation text contain no licence or use-constraint statement (grep of both found none). NOAA/NCEI is a US-government provider and its data are normally open with a citation request, but I did not find that stated verbatim. | Not stated on the pages read | `https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly` |
| Meteostat [Q, raw HTML] | "This data is published under the terms of the Creative Commons Attribution 4.0 International (CC BY 4.0) license." (the brief's "CC BY-NC?" is out of date). "The data provided by Meteostat is not intended to be used in any context where human life or property may be at risk." | Yes, but see section 1 (not usable as truth) | `https://dev.meteostat.net/license`, `https://dev.meteostat.net/terms` |

**What this means for the competition.** The back-test would use Open-Meteo's free service. Its own definition of commercial use includes "Commercial products or promotional activities", while "public research conducted at public institutions" is listed as non-commercial. A solo private entrant in a prize competition whose criteria include "Commercial viability and path to pilot" is not clearly in the safe examples [I, my reading, not legal advice]. Options, in order of cost:

1. **Disclose and keep the free tier for the one-off back-test**, listing Open-Meteo, its CC BY 4.0 data licence and the free-tier status in the declared data sources; state that production uses the licensed path below. Cheapest; carries the interpretation risk above.
2. **Ask Open-Meteo in writing** (their contact on the terms page) whether a prize-competition prototype counts as non-commercial. Free; the answer may not arrive before 20 November.
3. **Use a clean-licence arm for the headline numbers**: the ECMWF AWS replica (CC BY 4.0, commercial allowed) for IFS and AIFS, built as in section 3.3. About 32 GB and 41,700 requests for leads up to 3 days; a multi-day build.
4. **Pay for an Open-Meteo plan** (a subscription grants a commercial licence; price not found on the page I read).

My recommendation: option 1 now, option 2 in parallel, and state option 3 as the production path in the technical document. That keeps the 20 November deadline and does not misstate the licence position.

---

## 5. Training-set size: matched (forecast, observation) pairs

Obs = IEM METAR, joint T+Td+wind in the hour, forecast value present at that lead [D `match_pairs.py`; `results/pair_counts.csv`]. Forecasts are 100% populated at every lead 0 to 7 for IFS 0.25 deg, AIFS and GFS in their covered summers, so **the pair count is the same at every lead** (identical in all 8 columns of the pivot, all models). Per-lead numbers below therefore apply to each of leads 1 to 7.

### 5.1 Summed over the 8 stations, per lead

| Model | Summer | Joint pairs (all hours) | Daytime pairs (10:00 to 18:59 local) | Same with GHCNh lenient as truth |
|---|---|---|---|---|
| ecmwf_ifs025 | 2024 | 26,608 | 9,974 | 25,998 |
| ecmwf_ifs025 | 2025 | 26,413 | 9,949 | 26,262 |
| ecmwf_ifs025 | 2026 | 26,633 | 9,999 | 26,617 |
| **ecmwf_ifs025 total** | 3 summers | **79,654** | **29,922** | **78,877** |
| ecmwf_aifs025_single | 2025 | 26,413 | 9,949 | 26,262 |
| ecmwf_aifs025_single | 2026 | 26,633 | 9,999 | 26,617 |
| **ecmwf_aifs025_single total** | 2 summers | **53,046** | **19,948** | **52,879** |
| gfs_seamless | 2024 / 2025 / 2026 | 26,608 / 26,413 / 26,633 (79,654) | 9,974 / 9,949 / 9,999 | 25,998 / 26,262 / 26,617 |

### 5.2 Per station and summer (IFS 0.25 deg, any lead; joint pairs / daytime pairs)

| Station | 2024 | 2025 | 2026 |
|---|---|---|---|
| OMAA | 3,334 / 1,249 | 3,335 / 1,251 | 3,335 / 1,250 |
| OMAD | 3,325 / 1,249 | 3,335 / 1,251 | 3,335 / 1,250 |
| OMAL | 3,331 / 1,247 | 3,335 / 1,251 | 3,336 / 1,251 |
| OMDB | 3,331 / 1,249 | 3,335 / 1,251 | 3,319 / 1,249 |
| OMDW | 3,333 / 1,249 | 3,290 / 1,236 | 3,317 / 1,248 |
| OMFJ | 3,336 / 1,251 | 3,267 / 1,248 | 3,334 / 1,251 |
| OMRK | 3,286 / 1,232 | 3,182 / 1,210 | 3,321 / 1,249 |
| OMSJ | 3,332 / 1,248 | 3,334 / 1,251 | 3,336 / 1,251 |

### 5.3 How many of those are really independent [D then C]

- **In time.** Daily mean of the daytime day-1 IFS error, lag-1 autocorrelation within each station-summer: T 0.30, Td 0.24, wind 0.21 on average. Effective independent days = N(1-r)/(1+r), summed over station-summers: **1,827 (T), 2,146 (Td), 2,229 (wind) of 3,335 station-days** [D `results/effective_sample_size.csv`].
- **In space.** Correlation of daily daytime day-1 errors between stations, constant bias removed [D `results/error_corr_e_*.csv`]:

| Pair | T | Td | Wind |
|---|---|---|---|
| OMDB - OMSJ (17 km, same forecast cell) | 0.88 | 0.89 | 0.81 |
| OMAA - OMAD (20 km) | 0.60 | 0.61 | 0.57 |
| OMDW - OMDB / OMSJ / OMAA | 0.52 / 0.52 / 0.53 | 0.45 / 0.46 / 0.48 | 0.54 / 0.55 / 0.36 |
| OMRK - OMDB / OMSJ | 0.51 / 0.45 | 0.47 / 0.49 | 0.38 / 0.29 |
| OMFJ - every other station | -0.25 to +0.26 | -0.22 to +0.35 | 0.03 to 0.12 |
| OMAL - every other station | -0.23 to 0.36 | -0.11 to 0.26 | 0.08 to 0.37 |

  Participation ratio of the correlation matrix eigenvalues: **4.20 (T), 4.45 (Td), 4.62 (wind) effective independent stations out of 8.**
- **Combined** (rough product of the two separately measured factors, not a joint estimate) [C]: 1,827 x 4.20/8 = about 960 (T), 2,146 x 4.45/8 = about 1,190 (Td), 2,229 x 4.62/8 = about 1,290 (wind) independent station-days. **Plan on roughly 1,000 to 1,300 effective samples for the whole corrector, not 79,654.**

---

## 6. Is there anything to correct? Raw forecast error vs observations [D `match_pairs.py`; `results/baseline_errors_pooled.csv`]

Pooled over the 8 stations, IEM truth, MAE in C (wind in m/s). Daytime bias = forecast minus observation, 10:00 to 18:59 local, lead 1. Full table in `results/baseline_errors_pooled.csv`.

| Model | Summer | d1 T MAE | d1 Td MAE | d1 wind MAE | d3 T | d3 Td | d3 wind | d7 T | d7 Td | d7 wind | d1 daytime bias T / Td / wind |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ecmwf_ifs025 | 2024 | 1.60 | 2.91 | 1.12 | 1.82 | 3.55 | 1.21 | 2.08 | 4.20 | 1.43 | +0.62 / -1.89 / -0.18 |
| ecmwf_ifs025 | 2025 | 1.74 | 2.93 | 1.20 | 1.92 | 3.40 | 1.27 | 2.16 | 4.04 | 1.49 | +0.79 / -1.87 / -0.84 |
| ecmwf_ifs025 | 2026 | 1.83 | 3.12 | 1.12 | 2.02 | 3.79 | 1.18 | 2.41 | 4.52 | 1.37 | +1.07 / -1.44 / -0.66 |
| ecmwf_aifs025_single | 2025 | 1.67 | 2.90 | 1.20 | 1.73 | 3.04 | 1.25 | 1.85 | 3.44 | 1.38 | -0.49 / +1.19 / -0.79 |
| ecmwf_aifs025_single | 2026 | 1.77 | 3.11 | 1.16 | 1.81 | 3.28 | 1.17 | 1.96 | 3.68 | 1.33 | -0.08 / +1.36 / -0.70 |
| gfs_seamless | 2024 | 1.77 | 4.40 | 1.23 | 1.92 | 5.22 | 1.33 | 2.16 | 5.49 | 1.48 | +0.49 / -4.22 / +0.45 |
| gfs_seamless | 2025 | 2.02 | 4.10 | 1.26 | 2.09 | 4.83 | 1.33 | 2.26 | 5.42 | 1.49 | +0.41 / -3.91 / +0.43 |
| gfs_seamless | 2026 | 2.03 | 4.38 | 1.24 | 2.10 | 5.28 | 1.34 | 2.37 | 5.74 | 1.45 | +0.39 / -3.86 / +0.70 |

Findings that matter for the design:

1. **There is a signal.** Day-1 daytime dew point is 1.4 to 1.9 C too dry in IFS (3.9 to 4.2 C too dry in GFS) and about 1.2 to 1.4 C too moist in AIFS; day-1 dew-point MAE is 2.9 to 3.1 C (IFS). This agrees with the plan's fact F5 (about 2.6 C) in order of magnitude; my number is pooled over 8 stations and three summers, so it is not the same quantity.
2. **Biases are large, site-specific and stable between summers.** Day-1 daytime IFS T bias by station (2024 / 2025 / 2026): OMFJ +2.83 / +3.55 / +4.75 C, OMDB +1.00 / +1.46 / +1.62, OMAD -0.85 / -0.62 / -1.02. Td bias: OMFJ -4.24 / -5.79 / -6.20, OMDB -2.81 / -3.19 / -2.81. The correlation of the 8-station bias vectors between any two summers is **0.98 to 0.99 for T, 0.90 to 0.98 for Td** [D `match_pairs.py` log], but only 0.50 to 0.93 for wind.
3. **Some bias is not stable.** OMAD Td bias +0.80 / +0.31 / +2.63 C and OMDW Td bias -1.22 / -0.56 / +0.17 C across the three summers (2026 is the IFS 50r1 summer). IFS day-1 daytime T bias drifts +0.62 / +0.79 / +1.07 C and day-1 T MAE rises 1.60 / 1.74 / 1.83 C across 2024 to 2026 (causes not investigated: model version, weather or sensors).

Consequence: a corrector will look very good under leave-one-summer-out simply by memorising each station's bias (that is a "known site, new summer" scenario). The honest test of "any worksite" is a held-out station, where the 8 stations' large idiosyncratic biases (OMFJ in particular) cannot be learned from the others unless static features such as coast distance and elevation difference explain them. Expect a much smaller gain there.

---

## 7. Recommended training and evaluation design (derived from the numbers above)

All numbers cited are from sections 1 to 6. These are recommendations [I], not measurements.

1. **Truth.** IEM METAR as the pipeline source (most complete, reproducible, 2026 complete), nearest-hour binned, plausible-range check only. Keep GHCNh (lenient mode) as an audit layer for 2024 and 2025; review QC-flagged rows by hand before dropping any (section 2.3 point 4). Declare the whole-degree resolution as a limitation.
2. **Stations.** Use all 8. Treat OMDB and OMSJ as one site everywhere (same forecast cell, error correlation 0.88 to 0.89). Define clusters {OMAA, OMAD}, {OMDB, OMSJ}, {OMDW}, {OMAL}, {OMFJ}, {OMRK}: 6 folds.
3. **Three evaluation regimes, reported separately** (do not headline the easiest):
   - (a) leave-one-summer-out, known sites: operational scenario for sites that already have history; the easy one (bias vectors correlate 0.98 to 0.99 across summers);
   - (b) leave-one-cluster-out, all summers: the "new worksite" test the plan's claim needs;
   - (c) both held out (new site, new summer): the strictest; training on 5 clusters x 2 summers.
   Plain leave-one-station-out is not safe for OMDB/OMSJ (a held-out twin leaks). Random splits stay banned.
4. **Held-out summer.** Make **2026 the primary final test** (train 2024 and 2025). Reasons: it is the most recent; it is the IFS 50r1 + AIFS v2 summer, so it mimics deploying after an upgrade (section 3.3); every model has 2026 forecasts. Also report folds with 2024 and 2025 held out. Do not use 2026 for model selection.
5. **Leads.** Headline leads 1 to 3 days; report 5 and 7 as secondary. At day 7 the raw IFS dew-point MAE is 4.0 to 4.5 C versus 2.9 to 3.1 C at day 1, so the corrector's room to gain grows with lead. Use one model with lead as a feature rather than seven separate models, because the effective sample is about 1,000 to 1,300 (section 5.3); keep capacity small and regularised.
6. **Multi-model plan.** Corrector inputs IFS and GFS (3 summers each, full). **AIFS exists only for 2025 and 2026 and changes version v1 to v2 between them**: run raw IFS vs raw AIFS vs observations for 2025 and 2026 (53,046 pairs per lead) as the plan's AI-model comparison, but treat an AIFS-feature corrector as a stretch trained on one summer and tested on the other. IFS 9 km is 2026-only; keep it as a side check.
7. **Calibration (CQR).** Use time-blocked calibration inside the training summers (for example the last 30 days of each), per lead and hour band, as the plan already says. With bias drift across summers (section 6 finding 3), plan on an adaptive/online calibration arm.
8. **Daytime weighting.** Report metrics for 10:00 to 18:59 local separately: 9,974 / 9,949 / 9,999 pairs per summer per lead for all 8 stations, which is the working-hours exposure window.
9. **WBGT.** Keep A2 as a stated limitation: "truth" WBGT = Liljegren(observed T, Td, wind, model pressure, modelled radiation). Use the same modelled radiation on both the forecast and the truth side so the comparison isolates T, Td and wind errors. The radiation source for the truth side (for example ERA5 via the Open-Meteo archive) was not tested here [I].
10. **Do not claim** "generalises to any worksite" on the strength of 8 airport METAR sensors; state "generalises to held-out airport clusters" and that construction sites are out of the validated domain.

---

## 8. Corrections to the plan and the brief

| Where | Statement | What the data say |
|---|---|---|
| Plan A1, 8.1 | "about 10 stations", incl. "Sweihan, Das, Zirku" | Sweihan, Das and Zirku return HTTP 404 for 2024, 2025 and 2026 [D]. 8 stations qualify; 7 distinct forecast cells; 4.2 to 4.6 effective independent. |
| Plan 8.1 | Station pressure "about 17% complete" | 30% to 33% at five airports, 453 to 616 h at OMFJ in 2025 and 2026, 0 at OMDW (all years) and OMRK (2024, 2025) [D]. |
| Plan 8.1 | ECMWF open data "only the last 12 runs are kept, so we must store them ourselves" | True on ECMWF's own server [Q]; the AWS replica has every day from 2023-01-19 and 139 of 139 summer days in 2023 to 2026 [D]. Storing ourselves is only needed for production after the replica's retention changes (its retention policy was not found). |
| Plan 8.1 | GFS dew point "only from Jan 2025" (Earth Engine) | Open-Meteo Previous Runs has GFS day-1 dew point from 2024-01-19 and full coverage for all three summers [D]. |
| Plan 8.1 | Open-Meteo free tier "fine for the prototype" | Not safe to assume for a prize entry (section 4). |
| Plan 8.1 | NOAA GHCNh | Right choice, but 2026 data has no QC yet and a 5-day QC gap sits in 2025 [D]. |
| Brief | "NOAA NCEI Global Hourly / ISD" URLs | The ISD file for OMAA ends 2025-08-24 and 2026 is absent [D]; NOAA says GHCNh replaces it [Q]. |
| Brief | Meteostat "CC BY-NC?" | Now CC BY 4.0 [Q]; unusable as truth: mixes model data [Q], bulk ends 2025-10-15, 100% complete even for pressure [D]. |
| Brief | "UAE stations: Sir Bani Yas, Ruwais, Delma ..." | Delma, Sir Abu Nair, Qusaiwera, Liwa, Medina Zayed have rows but zero valid hourly T/Td/wind hours in the summer windows; Sir Bani Yas and Ruwais are not in NOAA's lists [D]. |
| Brief | "METAR has no solar radiation" | Confirmed; GHCNh also has none, and no open ground-radiation dataset was found [D, search]. |

## 9. What I did not do or could not verify

- The UAE National Center of Meteorology network, Ogimet at scale (one-day sample only), Google WeatherNext 3 and Earth Engine GFS were not tested.
- Open-Meteo's paid prices were not found in the fetched pricing page text.
- Whether Open-Meteo Previous Runs are genuine archived runs (documentation says so) was not independently verified; lead-dependent error growth is consistent with it.
- eccodes/cfgrib point extraction on this Windows host, and throughput of the ECMWF AWS replica, were not tested.
- Valid-time alignment of METAR minutes against model hours; the radiation source for WBGT truth; reasons for the 2024 to 2026 bias drift.
- Quality-flag semantics beyond code 1 (passed) and 2 (suspect): the GHCNh quality-code table did not extract from the PDF; I treated code 1 as passed and 2 and 4 as flagged.
- The regional AWS S3 endpoint reset connections during this run; I used the global endpoint for the last probe. The earlier listings used the regional endpoint and succeeded before the resets began.
- Free-tier use during this check: about 5,600 weighted Open-Meteo calls [C] against the 10,000-per-day free limit (18 first-date probes at 153 each, 27 summer probes at 48 each, 64 station pulls at 24 each).
- The scripts are research tooling: ruff-clean (line length 140; rules E, F, W, I, B, UP, SIM, C4) and formatted, but not typed under `mypy --strict` and not covered by tests. Re-running the formatted copies reproduced the same CSV outputs byte for byte.

## 10. Reproduction

Python 3.14 via `uv run --with <pkgs> python -I <script>`; downloads go to a data directory kept separate from the scripts. In order:

```text
fetch_ghcnh.py <dir>              # GHCNh parquet, 23 stations x 2024-2026 (needs requests)
fetch_iem.py <dir>                # IEM METAR CSVs (needs requests)
analyze_obs.py <ghcnh> <iem> <out>        # counts + hourly tables (pandas, pyarrow)
compare_sources.py <out>                  # GHCNh vs IEM, resolution, station distances
check_qc_rejections.py <ghcnh> <out>/hourly_iem   # what GHCNh QC flags
count_meteostat.py <dir>                  # Meteostat legacy bulk count
probe_forecast_archive.py <dir>           # first dates + per-summer coverage, 9 models
summarize_forecast_probe.py <dir>
fetch_forecast_stations.py <dir>          # 64 station-model-summer pulls
match_pairs.py <out> <fc_dir> <res_dir>   # matched pairs, raw errors, ESS, error correlation
report_tables.py <out> <res_dir> <probe_dir>      # markdown tables used here
probe_ecmwf_open_aws.py, probe_ecmwf_open_files.py, probe_ecmwf_open_files2.py,
probe_ecmwf_index_sizes.py, probe_ecmwf_range_get.py   # ECMWF open-data replica checks
```

Result files copied to `docs/research/scripts/results/`: `obs_counts_{iem,ghcnh_lenient,ghcnh_strict}.csv`, `source_crosscheck.csv`, `pair_counts.csv`, `baseline_errors.csv`, `baseline_errors_pooled.csv`, `effective_sample_size.csv`, `error_corr_e_{t,td,ws}.csv`, `forecast_archive_probe_result.json`, `ecmwf_open_aws_probe.json`.
Ad hoc `curl` checks (not in scripts): ISD OMAA 2024 to 2026 files and end dates, NOAA and IEM licence pages, Open-Meteo terms/pricing/licence pages, ECMWF open-data page, Meteostat licence pages, Ogimet one-day sample, station-list greps.
