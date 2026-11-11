# ADR 0005: Data: IEM METAR truth, GHCNh audit, Open-Meteo Previous Runs features, cluster-held-out validation

- **Status:** Accepted (Ali, 2026-11-11)
- **Evidence:** `docs/research/2026-11-11-data-availability.md` (§0, §1-§7); `docs/research/2026-11-11-claims-verification.md` §9, §11

## Context
8 UAE airport stations have hourly T, Td and wind for all three summers (95.4-100% joint completeness; IEM 2026 complete, GHCNh 2026 not yet QC'd). Open-Meteo Previous Runs serves archived forecasts at fixed leads: IFS 0.25° and GFS full for 2024-2026, AIFS only 2025-2026, IFS 9 km only 2026. The 8 stations behave like 4.2-4.6 independent sites (OMDB and OMSJ share one forecast cell; error correlation 0.88-0.89); effective sample is about 1,000-1,300 station-days, not 79,654 hours. Station biases correlate 0.98-0.99 (T) across summers, so leave-one-summer-out mostly measures memorised station bias.

## Decision
- **Truth:** IEM METAR (network `AE__ASOS`, routine + specials) at **OMAA, OMAD, OMAL, OMDB, OMDW, OMFJ, OMSJ, OMRK**; nearest-UTC-hour binning, closest report wins, plausibility ranges only (T -10..60 °C, Td -30..40 °C, wind 0..60 m/s). **GHCNh v1.1.0 (lenient QC: code 1 or blank)** is the audit layer; QC-flagged rows are kept and flagged, never dropped silently (flags include 47.7 °C at OMAA, data doc §2.3).
- **Summer window:** 15 May 00:00 UTC to 30 Sep 23:00 UTC (3,336 h). **Working daytime:** 06:00-14:59 UTC (10:00-18:59 GST).
- **Features:** Open-Meteo **Previous Runs**, `ecmwf_ifs025` + `gfs_seamless`, leads 0-7 days: T, Td, 10 m wind, shortwave, direct radiation, surface pressure. `ecmwf_aifs025_single` is ingested for the raw IFS-vs-AIFS comparison (must-have) and as a stretch corrector feature (one summer of training only).
- **Splits:** train 2024-2025, **test 2026** (the IFS 50r1 + AIFS v2 summer; never used for model selection). **6 clusters**: {OMAA, OMAD}, {OMDB, OMSJ}, {OMDW}, {OMAL}, {OMFJ}, {OMRK}. Report three regimes separately: (a) leave-one-summer-out, known sites; (b) leave-one-cluster-out, all summers; (c) new cluster and new summer. Random splits and plain leave-one-station-out are banned (twin leakage).
- **Headline leads 1-3 days**; leads 5 and 7 secondary. One model with lead as a feature.
- **WBGT truth (assumption A2, stated as a limitation):** Liljegren(observed T, Td, wind; IFS lead-0 surface pressure and radiation at the station's cell). The same lead-0 IFS radiation and pressure are also used on a "same-radiation" forecast WBGT so the comparison isolates T/Td/wind error; the operational forecast WBGT uses each model's own radiation. (Data doc §7 item 9 recommends same-radiation; the lead-0 IFS choice avoids an untested ERA5 source.)
- **Licence:** Open-Meteo free API is **non-commercial**; we use it for the one-off back-test and **disclose** it with its CC BY 4.0 data licence. The **production path is the ECMWF open-data AWS replica** (`ecmwf-forecasts`, CC BY 4.0, commercial use allowed; every day from 2023-01-19 present). Ask Open-Meteo in writing in parallel.
- **Claims:** "generalises to **held-out airport clusters**". Never "any worksite".

## Consequences
- Whole-degree METAR temperatures add about 0.29 °C rounding noise: correctors that differ by 0.1-0.2 °C are not distinguishable; say so.
- Calibration strata are bounded by the effective sample (ADR 0007).
- Free-tier budget: under 10,000 weighted calls/day. The research already used about 5,600 on 11 Nov; the full B1 pull (8 stations x 8 model-summers x 48 variables) is about 3,100 more, so it runs after 00:00 UTC on 12 Nov, through a content-addressed raw-response cache so it can resume.
- B1's dataset build must reproduce the research's pair counts exactly (IFS, IEM truth: 26,608 / 26,413 / 26,633 per lead) and its pooled raw MAEs (`docs/research/scripts/results/baseline_errors_pooled.csv`); a mismatch stops B2.
- Data declaration lists IEM (public domain, attribution appreciated), NOAA GHCNh, Open-Meteo (free tier, CC BY 4.0 data), ECMWF (production path), with access dates.

## Rejected options
| Option | Why rejected |
|---|---|
| GHCNh as truth | 2026 has no QC; IEM is more complete; the two agree to 0.00-0.11 °C |
| NOAA ISD global-hourly | OMAA 2025 ends 2025-08-24; 2026 absent; superseded by GHCNh |
| Meteostat | Mixes model data into observations; bulk frozen at 2025-10-15 |
| Building the ECMWF replica now | About 32 GB / 41,700 range requests for leads to 3 days; multi-day build; GRIB reader untested on Windows |
| WeatherNext 3 arm | Access approval lands 18-20 Nov even if requested 10 Nov |
| Random or leave-one-station-out splits | Autocorrelation leakage; OMDB/OMSJ twin leakage |

## Revisit trigger
Open-Meteo answers on non-commercial status; a commercial pilot (switch to the ECMWF replica); a non-airport site with its own sensors (new validation domain).
