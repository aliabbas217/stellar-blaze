# Public health data for heat stress in outdoor workers: what exists, what is usable by 20 November (2026-11-11)

**Question.** Is real health data relevant to heat stress in outdoor workers publicly available, and can a competition prototype use it? If yes, ADR 0016 (cut the personal strain model) and ADR 0017 (cut the population view) should be revisited.
**Run date:** 2026-11-11 (prototype due 2026-11-20). Reproduction scripts: `docs/research/scripts/health_data/` (section 9).
**Rules followed.** No TLS bypass (no `-k`, no certificate flags). No registration, no data-use agreement (DUA), no gated download. A dataset that needs a DUA counts as "not available by 20 Nov". No git commands.

### Evidence tags

- **[D]** downloaded or queried by me on 2026-11-11 and counted by a script or API call.
- **[Q]** quoted from a page, abstract or PDF I fetched (URL given).
- **[S]** taken from a web-search result summary only; I did not open the source. Treat as a lead, not a fact.
- **[C]** computed from [D] or [Q] numbers (arithmetic stated).
- **[I]** my inference or estimate. Not measured.

---

## 0. Verdict

| Deferred decision | Can public data validate it? | Verdict |
|---|---|---|
| **ADR 0016, personal strain model** | **Only at lab scale.** Open datasets with per-minute core temperature plus heart rate exist (n=65, n=21, n=21, n=8; section 1). **No public dataset has outdoor workers, a Gulf site, or a full shift with core temperature**: the field datasets (Qatar construction, Kansas City construction, Dammam construction) are on request or have no data statement. | **Keep cut. Correct the ADR's premise**: "can only be validated on simulated workers" is false (lab validation is possible); "cannot be validated on UAE outdoor workers" is true. Public data touches neither the Buller-patent freedom-to-operate gap nor the PHS NaN rate. |
| **ADR 0017, population view** | **No for the UAE.** I found no public UAE or GCC dataset of heat-illness cases, ED visits or work injuries with dates and places (section 2). **Yes for an analogue**: the OSHA Severe Injury Reports hold 2,628 dated, geocoded heat hospitalisations (US, 2015-2025). They show a strong weather dose-response (section 5), but they are too sparse for EARS/CUSUM/Farrington scoring and say nothing about the UAE. | **Keep cut. Correct the ADR's premise**: "there are no real outcome data" should read "there are no public UAE outcome data; a US analogue exists and does not change the decision". The revisit trigger (ADPHC plus a data-sharing agreement) is the right one; the concrete routes are in section 7. |

### Corrections to the framing

1. **The physician-led competitor's "2,628 real heat hospitalisations" is the OSHA Severe Injury Reports file.** Their protocol cites `January2015toNovember2025.zip` and records its SHA-256 [Q `github.com/DrAhmed7887/hack-future-health` `docs/backtest_protocol.md`]. **My download of that file has the identical SHA-256** (`a3f7f434...f846bb0`), and filtering OIICS event codes 531x gives exactly 2,628 rows, all with at least one hospitalisation [D]. So "real" means real events, but **US only, federal-OSHA jurisdiction only, hospitalised only, no denominators, and the exposure they use is the NWS heat index at a region centre, not WBGT** [Q same protocol]. They quote about 25% reporting from one Illinois linkage [Q, their text; not verified by me].
2. **"No real outcome data" is true only for the UAE.** Real heat-outcome data are public elsewhere (OSHA SIR; Arizona Department of Health Services (ADHS) monthly heat-illness ED and inpatient counts; CDC region-level ED rates). Our decision logic should rest on "not UAE, not usable for the claim we make", not on "none exists".
3. **The strongest UAE-relevant evidence that outcome data exist is in regulation and press, not in open portals**: Cabinet Resolution 33 of 2022 makes health authorities report each work injury (name, ID, nationality, place, date, emirate, degree, authority) to MoHRE [Q, section 3]; Abu Dhabi's health authority counted 3,017 heat-illness ED cases in 2010 [Q, section 2]. Those are the pilot data routes; neither is public.
4. **A physiological fact the project should carry into the limitations section**: the HEAT-SHIELD team's own analysis of 982 real exposures found that WBGT "did not work appropriately in windy, hot-dry, conditions where WBGT predicted lower strain due to wind" [Q, section 1, row A2]. Inland UAE afternoons are hot-dry and windy at times. I read this as supporting ADR 0006's decision to compute TWL directly rather than map WBGT bands onto ADOSH zones [I]; I did not test how TWL behaves in the same windy, hot-dry cases.

### The three most useful datasets for the next nine days

| # | Dataset | Why | Licence |
|---|---|---|---|
| 1 | **OSHA Severe Injury Reports** (2,628 heat hospitalisations, daily, geocoded) | The only real, dated, placed heat-outcome file I could download and verify. It lets the technical document say "in a real analogue, event rates rise 15-fold between days under 90 F and days at or above 100 F" with the caveats in section 5. | US federal work, public domain |
| 2 | **HEAT-SHIELD Loughborough** (figshare 25722300; 982 exposures, 75 climate conditions) | Real measured work-capacity loss versus temperature, humidity, wind, solar and clothing, with the climate indices already computed (WBGT, UTCI, humidex). Gives a data-derived productivity curve instead of a literature number. | CC BY 4.0 (cite five papers) |
| 3 | **SDSU heat-tolerance set** (Mendeley g5sb382smp; 65 subjects, per-minute core temperature and heart rate) | Lets the project test its PHS port against measured core temperature, and gives a real denominator for the PHS NaN rate. It cannot test a worker-in-the-field claim. | CC BY 4.0 |

---

## 1. Category A: physiology in heat (core and skin temperature, heart rate, sweat rate)

Searches run [D]: Zenodo API (5 queries, 8 hits each), Dryad API (3 queries), Figshare API (3 queries), the full PhysioNet published-project list (760 project versions scanned for heat, thermal, thermoregulation, core temperature, sweat), plus web searches. Search coverage is shallow (8 hits per query); a dataset with unusual wording may be missed.

| # | Name | What it contains | Access | Licence | Fit for Stellar Blaze |
|---|---|---|---|---|---|
| A1 | **SDSU "Predicting heat tolerance status from exercise in thermoneutral conditions"** (Buono) `https://data.mendeley.com/datasets/g5sb382smp`, DOI 10.17632/g5sb382smp.1, 2022-06-14 | 65 subjects, each 2 h treadmill walking in a hot chamber (about 40 C, 40% RH) and in a thermoneutral room (about 22 C, 40% RH). Per-minute core temperature (telemetric pill, "TP") and heart rate, 121 time points, plus RPE, urine specific gravity, VO2max, anthropometry. In the hot trial the per-subject peak core temperature averages 38.97 C; 12% reach 39.0 C or more and 58% reach 38.5 C or more [D, my parse of `HTT data set.xlsx`, 210 KB]. | **Open**, no registration (the public-files URL downloaded with plain `curl`) [D] | CC BY 4.0 [Q Mendeley API] | **Best open lab set for HR to core-temperature work and for a PHS check.** Caveats: lab treadmill, not outdoor work; the associated paper reports 48 heat-intolerant and 17 heat-tolerant subjects [S, Northway et al., *IJOMEH* 2023], so the sample is skewed to intolerance and is not a worker population. Treadmill speed and grade are not in the file I parsed; they must come from the paper (not read). |
| A2 | **HEAT-SHIELD Loughborough datasets** `https://figshare.com/articles/dataset/DATASETS_HEATSHIELD_project_Loughborough_University_averaged_per_condition_and_individual_sessions/25722300`, DOI 10.6084/m9.figshare.25722300.v1, 2024-06-21 | "data from 982 exposures (75 conditions) exercising at a fixed cardiovascular load of 130 b.min-1, in varying temperatures (15-50 C), humidities (20-80%), solar radiation (0-800 W.m-2), wind (0.2-3.5 m.s-1) and two clothing levels" [Q figshare description]. Files: D1 per-condition (73 KB), D2 per-session (2.3 MB; its Data sheet has 1,053 rows against 982 exposures in the description, not reconciled; columns include Ta, RH, wind, solar, globe, natural wet bulb, PWC, PWC loss, WBGT, UTCI and others), D3 to D5 supplements [D]. Outputs: physical work capacity (PWC) loss, skin temperature, core-to-skin gradient, thermal perception. **No core-temperature time series** (skin temperature only). Finding quoted from the record: "WBGT did not work appropriately in windy, hot-dry, conditions where WBGT predicted lower strain due to wind" [Q]. | **Open** (D1 and D2 downloaded with plain `curl`) [D] | CC BY 4.0; the file's Explanation sheet requires citing five source papers (Foster 2021, 2022; Smallcombe 2022; Havenith 2024) [Q] | **Best open source for productivity versus WBGT/UTCI** (category D). Not field data; climate-chamber exercise at a fixed 130 bpm load. Rows carry globe and wet-bulb inputs, so TWL could be computed per row [I, not done]. |
| A3 | **Loughborough PROSPIE dataset** `https://repository.lboro.ac.uk/articles/online_resource/.../26076577`, DOI 10.17028/rd.lboro.26076577.v1, 2024-06-25 | Two papers' data: prediction of rectal temperature from skin and micro-climate temperature, and whether the physiological strain index (PSI) predicts drop-out. 21 volunteers (12 men, 9 women), six trials each, two 40-min treadmill walks, permeable or impermeable clothing, 25 C/50%, 35 C/35%, 40 C/25% [Q figshare API description]. One 6.5 MB xlsx. | Open [D: metadata via the Figshare API; the repository page itself returned 403 to WebFetch, file not downloaded] | **CC BY-NC 4.0** [D] | Good for a core-temperature estimator test and a PSI check. **Non-commercial licence: a grey zone for a prize entry with a "commercial viability" criterion**, the same issue as ADR 0005's Open-Meteo note. Prefer A1. |
| A4 | **Firefighter live-fire dataset** (Mauvieux et al.) `https://data.mendeley.com/datasets/7ghxcsd9sz`, DOI 10.17632/7ghxcsd9sz.1, 2025-10-27 | 21 male firefighters, two sessions (09:00 and 21:30). `Tcore_AM_PM.csv` (Subject_ID, Condition, Time_min, Tcore_C), `HR_RPE_BW.csv` (**HR mean and max only, not a series**), skin and under-PPE microclimate, thermocouple environment [Q]. | Open (download not tested) | CC BY 4.0 [Q] | Core-temperature series in a real hot task, but live-fire training in PPE, not outdoor ambient heat. Low fit. |
| A5 | **EOD ice-vest dataset** (Dryad) `doi:10.5061/dryad.s1rn8pk94`, 2024-09-24 | 8 men walking 4.5 km/h at 35 C/50% in an explosive-ordnance-disposal suit, with or without an ice vest; continuous heart rate, core and skin temperature [D Dryad API]. | Open | CC0 | n=8, heavy PPE. Too small to validate anything. |
| A6 | **Northeast India factory WBGT and strain** (Zenodo 14580573) | One xlsx (416 KB): WBGT readings per indoor factory location, workers per area, perception percentages, heat-strain comparison, sweat rate sheets. **Summary-level, indoor, no time series** [D, sheet inspection]. | Open | CC BY 4.0 [D] | Not usable for validation. |
| A7 | **Japanese outdoor workers, ice slurry** (Figshare 33121543, 2026-07-30) | A field study of heart rate and core temperature in outdoor workers (maximum WBGT 30.2 and 29.4 C) [D, description]. The deposit holds three small spreadsheets named "Table 1", "Table 2", "Table 2.2" (14 to 15 KB each) [D], so almost certainly **summary tables, not raw series** (contents not opened). | Open | CC BY 4.0 [D] | Topic fits; the data likely do not. Worth a 10-minute look only. |
| A8 | **Abertay heat acclimation dataset** (8 men; heart rate, sweat rate, skin and core temperature) | [Q Abertay page] | Page gives no access terms | **"All rights reserved ... including for text and data mining and AI training"** [Q] | **Unusable.** |
| A9 | **HEAT-SHIELD multi-country field study** (Ioannou et al., *Temperature* 9(3):274-291, 2022; PMC9559325) | **372 workers, 893 full shifts, nine countries incl. Qatar construction (ambient up to 43.8 C)**, core temperature (capsule), mean skin temperature, heart rate [Q]. This is the field dataset the project would most want. | **Not deposited.** My grep of the open-access full-text XML found no data statement, no Zenodo, figshare, Dryad, OSF or repository link [D]. Contact the corresponding author (A. D. Flouris). | n/a | **Not available by 20 Nov.** A pilot collaboration lead. |
| A10 | **Kansas City construction pilot** (Specht et al., *JOEH* 22(10), 2025) | 32 construction workers, three summer workdays, core temperature, heart rate, heat index [Q CDC Stacks]. | No data-sharing statement on the record page [Q] | n/a | Not available. |
| A11 | **Dammam construction wearables** (arXiv 2604.19559) | 19 male workers, Garmin Vivosmart 5, June to October 2023; heart rate, HRV, respiration, SpO2; **no core temperature**; labels are threshold-based "adapted from ISO 7243", not measured strain [Q]. | "De-identified data and code are available from the corresponding author upon reasonable request." [Q] | n/a | Not available, and the labels are not ground truth. |
| A12 | **ISO 7933 / PHS validation database** (Malchaire et al., *Ann Occup Hyg* 45(2):123-135, 2001; 909 or 1,113 experiments, sources disagree) | Eight-laboratory validation database [S]. | No public repository found [S] | n/a | Not available. |
| A13 | **PhysioNet** | **No heat-physiology dataset.** Of 760 published project versions, 2 match "heat" or "thermal", both COVID-19 thermal imaging [D, API list scan]. | n/a | n/a | None. |
| A14 | **Kenzen and other wearable vendors** | Proprietary. A peer-reviewed validation exists (52 trials from 4 studies against rectal probes or pills; Hunt, Jay et al., *IJERPH* 2021) [S]. No raw data or algorithm access found [S]. | Closed | Proprietary | Not available. |
| A15 | **US military (USARIEM) heat-strain data** | Aggregate incidence only (Medical Surveillance Monthly Report; section 2). No open physiology dataset found [I, searched once]. | n/a | n/a | Not available. |

**Category A conclusion.** About 100 subjects of open lab data with core temperature (A1, A3, A4, A5) and one open 982-exposure productivity set (A2). No open core-temperature data from outdoor or Gulf workers.

---

## 2. Category B: heat-illness outcomes (hospital or ED visits, cases, deaths, with dates and places)

| # | Name | What it contains | Access | Licence | Daily counts linkable to WBGT? | Fit |
|---|---|---|---|---|---|---|
| B1 | **OSHA Severe Injury Reports** `https://www.osha.gov/severe-injury-reports` | Employer-reported amputations, in-patient hospitalisations and eye losses under 29 CFR 1904.39 since 2015-01-01; "data from 1/1/2015 through 11/30/2025" [Q, Wayback copy of the page, 2026-09-29]. File: 105,996 rows; **2,628 heat rows (OIICS 531x), all with at least one hospitalisation; 2,627 with latitude and longitude; dates 2015-03-17 to 2025-10-07 on 1,088 distinct days; 95.3% in May to September**; fields include date, NAICS, city, state, coordinates, a short narrative [D]. Top states: Texas 657, Florida 484, Georgia 130, Pennsylvania 123, Arkansas 117. NAICS sectors: construction (23) 605, couriers and warehousing (49) 429, administrative and support services (56) 314 [D]. | **Open CSV zip** (16.2 MB). osha.gov returns HTTP 403 to non-browser clients [D]; I used the Wayback Machine copy of the same URL, whose SHA-256 matches the competitor's recorded hash (section 0). | US federal work. DOL: "Materials created by the federal government are generally part of the public domain ... may be used, reproduced and distributed without permission", but "may not be used in a manner that implies any affiliation or endorsement by the DOL" [Q `dol.gov/general/aboutdol/copyright`]. The file names employers and addresses; no worker names seen in the columns [D]. | **Yes, daily and geocoded.** Section 5 links 452 events to airport weather. | **Best analogue.** Limits: "These data ... represent incidents under federal OSHA jurisdiction only" [Q] (127 heat rows are in state-plan states; the hot-desert states have few: Arizona 13, Nevada 13, New Mexico 12, California 16 [D]); humid-subtropical states dominate; hospitalised only; under-reported; no denominators (workers on site); acclimatisation unrecorded. |
| B2 | **CDC Heat and Health Tracker** (NSSP syndromic data) | "The primary source is emergency department (ED) visits associated with heat-related illness"; rates per 100,000 ED visits by **HHS region**, for a selected day or week [Q `cdc.gov/nssp/php/partnerships/cdc-heat-health-tracker-uses-nssp-data.html`]. | Dashboard. The page does not mention a download [Q]. A catalogue search of `data.cdc.gov` for heat-related illness returned only respiratory, mental-health and NIOSH items, no heat-illness dataset [D, Socrata catalogue API]. Case-level NSSP data (ESSENCE) is reached through state or local health departments [S]. | Not stated | Region-level daily rate: coarse (10 regions), not a worker file | Not downloadable by 20 Nov. |
| B3 | **Arizona DHS heat-related illness reports** `azdhs.gov/documents/preparedness/epidemiology-disease-control/extreme-weather/pubs/heat-related-illness-emergency-department-and-inpatient-admissions-in-arizona-by-year-2021-2025.pdf` | **Hot-desert analogue.** 2025: 4,273 ED visits and 1,215 inpatient admissions; "3.4% of ED visits were work-related, compared with 0.8% among all causes"; monthly counts 2021-2025 (e.g. ED visits in July 2023: 2,088; June 2024: 1,167); preceding activity "Occupational": 129, 108, 98, 152, 104 ED visits for 2021-2025 [D, parsed with `pypdf`; Tables 10, 11, 21]. | Open PDF | Not stated on the document | **Monthly only**, all-population. Fine for seasonal shape, not for a daily dose-response. | Useful hot-desert context and a work-related share (3.4%). |
| B4 | **Maricopa County heat-associated deaths** | Weekly dashboard of confirmed deaths and deaths under investigation [S]. | Dashboard; no file found [S] | Unknown | Weekly, deaths only | Low. |
| B5 | **US military heat illness (MSMR)** | Annual counts and rates by Service; 2025 rates 39.4 (heat stroke) and 170.0 (heat exhaustion) per 100,000 person-years [S, `health.mil`]. | Open tables | US federal | No (annual) | Low. |
| B6 | **Hajj heat illness (Saudi MoH annual reports)** | Heat stroke and heat exhaustion incidence per 100,000 pilgrims, 1980-2019; for example mean heat-stroke incidence 2.1 (cold cycle), 49.3 (previous hot cycle), 12.5 (current hot cycle); mitigation associated with a 74.6% reduction in heat-stroke cases [Q Yezli et al., *J Travel Med* 2024;31(4):taae042]. | **On request**: "Data will be available from the corresponding author on a reasonable request" [Q]; weather needs Saudi National Center for Meteorology approval [Q]. Daily counts appear only in press statements [S]. | n/a | Annual | Not available by 20 Nov. |
| B7 | **Abu Dhabi heat-illness ED counts** | **3,017 cases of heat-related illness treated in Emergency Departments in 2010**, "most of them (66%) from heat exhaustion", heat stroke 4%, "the majority (63%) were from Bangladeshi, Indian and Pakistani nationals" [Q `meconstructionnews.com/687/feeling-the-heat`, 2011-06-09, quoting a Health Authority-Abu Dhabi officer]. A hospital injury-surveillance system for all admissions was piloted in four hospitals "last year" (2011, from the article date) and planned for 38 [Q `thenationalnews.com/uae/health/new-hospital-database-to-shine-a-light-on-heatstroke-cases-1.442350`, 2012-04-29]. | **Not public.** The article does not say the data were published [Q]. | n/a | Annual, 2010 only; no daily series | **The only UAE heat-illness count I found; 15 years old and secondary.** Proves the data exist inside DoH. |
| B8 | **Dubai Health Authority statements** | "Significant decline" in heat-stress cases after the midday break; **no counts given** [Q `thenationalnews.com/.../labourers-midday-break-hailed-for-fewer-heat-exhaustion-cases-1.127929`, 2015-09-15]. | Not data | n/a | No | None. |
| B9 | **UAE open-data portals** | **MOHAP** open-data page 1 (Wayback copy): mortality 2024 by emirate, nationality, sex, location (annual xlsx), statistical annual reports, core health indicators, cancer incidence, AMR report; no injury or heat dataset on that page [D]. **Emirates Health Services** publication plan: "Number of Emergency Patients Visits by Hospitals and Emirates 2022" (annual, not heat-specific) [D, Wayback copy]. **DoH Abu Dhabi** Open Data Dashboards: the dashboard tiles did not render in the fetched text, so contents are **not verified** [Q]. **Bayanat**: single-page app, not enumerable without a browser; no heat or work-injury dataset surfaced in two web searches [S]. **Dubai Pulse**: the catalogue page I fetched contains no health, injury or heat terms [D]; one health dataset (births and deaths) needs a permission request [S]. | Open (annual aggregates) | Per portal | No | **No public UAE heat-outcome series found.** |
| B10 | **Qatar (Hamad Medical Corporation)** | Press-quoted monthly counts only, for example 118 heat-stress cases in June 2014 and 190 in July 2014 [S, *The Peninsula*]. | Not data | n/a | No | None. |
| B11 | **Australia (Safe Work Australia NDS)** | 1,774 accepted heat claims 2009-10 to 2018-19 [S]; a UNSW analysis argues claims are understated "by up to a factor of 20" [S]. | Aggregate tables | Unknown | No | Low. |
| B12 | **US BLS SOII and CFOI** | Annual national and state counts of heat injuries and deaths (2015: 2,830 nonfatal cases with days away from work, 37 deaths) [S]. | Open | US federal | No (annual) | Low. |
| B13 | **Washington State workers' compensation heat claims** (Hesketh et al., *Am J Ind Med* 2020) | 918 confirmed heat-illness claims 2006-2017; third-quarter rates 131.3 (public administration) and 102.6 (agriculture, forestry, fishing) per 100,000 FTE; "The median maximum daytime temperature was below the Washington heat rule threshold for 45% of the accepted HRI claims" [Q abstract via Europe PMC]. | Claims data not open [I] | n/a | n/a | Parameters only (section 4). |
| B14 | **England (UKHSA heat mortality monitoring)** | Not checked. All-population mortality, not occupational. | | | | Out of scope. |

**Category B conclusion.** Daily, geocoded, real heat hospitalisations are public **only for the US (B1)**. No public UAE or GCC heat-illness series with dates and places exists, as far as the open portals I could reach show.

---

## 3. Category C: occupational injury and fatality by month for the UAE or the Gulf

| # | Name | What it contains | Access | Fit |
|---|---|---|---|---|
| C1 | **UAE MoHRE work-injury register** | Cabinet Resolution 33 of 2022: health authorities send work-accident and occupational-disease data to MoHRE; the data "includes the name, ID number, nationality, place of injury, date of injury, emirate, degree of injury, and the name of the health authority" [Q `mohre.gov.ae/en/media-center/news/26/5/2022/...`, Wayback copy]. Employers with 50 or more workers keep an injury register [S]. | **Not public** | **The natural pilot route** (dated, placed, by degree). Needs a data-sharing agreement; not available by 20 Nov. |
| C2 | **UAE federal and emirate portals** (MOHAP, EHS, FCSC, Bayanat, Dubai Pulse) | No work-injury dataset found. MOHAP and EHS publish annual aggregates (section 2, B9). FCSC returned HTTP 403 and was not read [D]. | Open (annual, not injury) | None. |
| C3 | **Saudi GOSI work-injury statistics** `cdn.gosi.gov.sa/StatisticsAndData/files/WorkInjuryStatisticsReport.pdf` | Annual statistics, used in peer-reviewed papers for 2004-2016 and 2016-2021 [S]. The 2-page PDF I fetched had no extractable text [D]. | Open PDF, annual, often Arabic [S] | Annual only; no monthly series found. |
| C4 | **Nepal Foreign Employment Board** | Deaths of Nepali workers abroad, from welfare-fund compensation claims only; causes grouped as cardiac arrest, natural, traffic, suicide, workplace; reported by fiscal year; embassy-quoted monthly averages appear only in press (UAE: 167 deaths in six months) [S]. | Annual tables; undocumented workers excluded [S] | Indirect and confounded (cardiac and "natural" causes dominate). Not usable as a heat signal. |
| C5 | **Qatar, Kuwait, Bahrain** | Nothing found in two searches [S]. | | None. |

**Why even monthly data would be a weak heat signal [C].** The best pooled injury estimate is a relative risk of 1.010 per degree C above reference temperature (Fatima 2021, section 4). Across a 10 C seasonal swing that is 1.010^10 = 1.105, about +10%. Monthly UAE counts in the tens or hundreds cannot show a 10% change against Poisson noise.

---

## 4. Category D: published dose-response relationships usable as fixed parameters

All values below are literature parameters. None was derived from UAE data. Label them that way in the technical document.

| # | Relationship | Value | Source | Fit and limits |
|---|---|---|---|---|
| D1 | **Heat strain odds versus WBGT** (workers, one shift) | Working a single shift under heat stress "(defined as wet-bulb globe temperature beyond 22.0 or 24.8 C depending on work intensity)" gives **4.01 times** (95% CI 2.45 to 6.58; nine studies, 11,582 workers) the odds of occupational heat strain versus thermoneutral work; core temperature +0.7 C (0.4 to 1.0); urine specific gravity +14.5%; 35% (31 to 39) of workers show heat strain and 30% (21 to 39) report productivity loss during or at the end of a shift under heat stress [Q Flouris et al., *Lancet Planet Health* 2018;2(12):e521-e531, abstract via Europe PMC, PMID 30526938] | A binary threshold at WBGT 22.0 or 24.8 C, far below Abu Dhabi summer WBGT; the pooled studies are heterogeneous (the abstract notes "large heterogeneity" [S]). Good for a "why we warn at all" line, not for graded risk. |
| D2 | **Occupational injury risk versus temperature** | Relative risk **1.010 per 1 C** above reference (95% CI 1.009 to 1.011; 22 studies, about 22 million injuries, six countries); **1.174 during heatwaves** (1.057 to 1.291); humid subtropical 1.017 (1.014 to 1.020) [Q Fatima et al., *Environ Int* 2021;148:106384, abstract via Europe PMC, PMID 33472088] | Injuries, not heat illness; Australia, Canada, China, Italy, Spain, USA only; no hot-desert zone, no Gulf. |
| D3 | **Productivity (work capacity) versus WBGT, ILO** | "Temperatures above 24-26 C are associated with reduced labour productivity. At 33-34 C, a worker operating at moderate work intensity loses 50 per cent of his or her work capacity." Method: exposure-response curves for 200, 300 and 400 W work, each "the cumulative distribution function of a general normal distribution", fitted to Sahu, Sett and Kjellstrom (2013; r = 0.98, samples of 10 to 18 workers), Wyndham (1969) and ISO 7243:1989; work in the afternoon sun adds 2 to 3 C to in-shade WBGT [Q ILO, *Working on a warmer planet*, 2019, executive summary and Appendix I (printed pp. 90-91), text extracted from the PDF `wcms_711919.pdf`] | The mean and standard deviation of each curve are drawn in Figure AI.1, not tabulated in the text I extracted. Small underlying samples. ILO copyright: "short excerpts ... may be reproduced without authorization, on condition that the source is indicated" [Q imprint page]. |
| D4 | **Work capacity versus WBGT, Kjellstrom** | "The work capacity rapidly reduces as the WBGT exceeds 26-30 C"; continuous work acceptable at about 25.5 C WBGT at 500 W, 75% rest needed at about 31 C at 500 W [Q Kjellstrom, Holmer and Lemke, "Workplace heat stress, health and productivity - an increasing challenge for low and middle-income countries during climate change", 2009 (title, authors and Table 2 text read from the PDF at `climatechip.org/sites/default/files/publications/2047-5172-2-PB.pdf`; journal given as *Glob Health Action* from the file name, not printed in the text I read); the extracted text renders degrees as "8C", read here as C] | A published guideline table, not an epidemiological fit. |
| D5 | **Measured work-capacity loss versus climate indices** | Raw data for 982 exposures (A2). Authors report UTCI and WBGT had the highest predictive power for PWC loss, and WBGT failed in windy hot-dry conditions [Q figshare description] | **The only item in this table that is raw data.** Refit with TWL or WBGT using your own port (ADR 0006). |
| D6 | **Heat illness versus daily temperature, workers' compensation** | 45% of accepted heat-illness claims occurred when the median maximum daytime temperature was below the Washington heat-rule threshold [Q Hesketh et al., *Am J Ind Med* 2020, abstract via Europe PMC]; 76% of claims on days with Tmax at or above 80 F [S Spector et al., 2006-2021 claims] | Shows that rules keyed to a single threshold miss many cases. US, claims-based, under-reported. |
| D7 | **Hajj mitigation effect** | Mitigation measures associated with a 74.6% reduction in heat-stroke cases and a 47.6% decrease in case fatality rate [Q Yezli et al. 2024] | An ecological before-after across decades; not causal. |
| D8 | **Heat illness versus daily weather, OSHA analogue (this report)** | Rate per 1,000 weekdays rises from 7.6 (Tmax under 90 F) to 114.5 (at or above 100 F), rate ratio 15.1 (crude 95% interval 9.9 to 22.9) [D, section 5] | Own exploratory estimate; US humid subtropical; no denominators; no WBGT. |
| D9 | **ADOSH TWL zones versus outcomes** | **No public relationship found.** Miller and Bates (2007) validated TWL in a chamber and in the field and describe management protocols; my search found no incidence-versus-TWL table [S]. | Do not claim an outcome-validated TWL threshold. |

**Where the competitor's 2,628 comes from (the question asked in D).** It is B1, the OSHA Severe Injury Reports; no other public source of that size and detail exists for heat hospitalisations.

---

## 5. Exploratory check: does the OSHA analogue carry a usable weather signal?

This is an [D] exploratory analysis. It was not pre-registered, it is not a validation of anything in the UAE, and it should not be cited as evidence of a UAE relationship.

**Method.** Events: the 2,628 heat rows, restricted to the station's state and within 40 km of nine airport stations (Houston Hobby, Dallas Love, San Antonio, Austin, Orlando, Jacksonville, Tampa, Atlanta, Kansas City). Weather: IEM daily summaries (public domain), daily maximum temperature and IEM's maximum "feel" (apparent temperature). Days: May to September 2015-2025, **weekdays only** (91% of events fall Monday to Friday, so weekends would dilute the denominator). Rate = events per 1,000 weekdays. Script: `docs/research/scripts/health_data/osha_heat_weather_exposure.py`.

**Result: 452 events on 10,826 weekdays (41.8 per 1,000).**

| Daily maximum temperature | Weekdays | Events | Per 1,000 weekdays | Rate ratio vs under 90 F | Crude 95% interval |
|---|---|---|---|---|---|
| under 90 F | 4,344 | 33 | 7.6 | 1.00 | 0.62 to 1.62 |
| 90 to 94 F | 3,972 | 179 | 45.1 | 5.93 | 4.09 to 8.60 |
| 95 to 99 F | 1,951 | 176 | 90.2 | 11.87 | 8.19 to 17.22 |
| 100 F or more | 559 | 64 | 114.5 | 15.07 | 9.90 to 22.94 |

| Daily maximum apparent temperature | Weekdays | Events | Per 1,000 weekdays | Rate ratio vs under 95 F | Crude 95% interval |
|---|---|---|---|---|---|
| under 95 F | 4,593 | 40 | 8.7 | 1.00 | 0.65 to 1.55 |
| 95 to 99 F | 2,621 | 84 | 32.1 | 3.68 | 2.53 to 5.36 |
| 100 to 104 F | 2,603 | 189 | 72.6 | 8.34 | 5.93 to 11.73 |
| 105 to 109 F | 851 | 100 | 117.5 | 13.49 | 9.35 to 19.47 |
| 110 F or more | 158 | 39 | 246.8 | 28.34 | 18.23 to 44.06 |

The median daily-maximum-temperature percentile of event days is 0.67 to 0.87 at every station [D].

**What it shows.** Event rates rise steeply and monotonically with heat in a real analogue, pooled over nine metros. The weekday restriction changes the ratios little (all-days run: rate ratio 14.7 at 100 F or more).

**What it does not show, and why it cannot validate the population view:**
- **Range mismatch.** The top US bin (100 F or more, 38 C) is a normal Abu Dhabi summer afternoon (ADR 0006 notes dry bulb above 44 C is common). The analogue says nothing about relationships at UAE exposure levels, under the midday ban, or for newly arrived workers.
- **No denominators.** Workers on site per day are unknown; the rate is per weekday, not per worker-hour. The hottest bins cluster in July and August, when the outdoor headcount may differ from May, so part of the slope can be seasonal exposure rather than weather.
- **Sparse for detectors.** 2,628 events over 49 states and 10.6 years: 2,212 state-days with at least one event, 306 with two or more, 80 with three or more; Texas, the largest state, has 657 events on 477 days (about 0.17 per day statewide) [D]. EARS C2/C3, CUSUM and Farrington need baseline counts; on these counts scoring would mostly measure noise.
- **Crude intervals.** The log-Poisson interval ignores over-dispersion and clustering by day, so it is too narrow. Airport weather is not site weather. No WBGT: IEM has no globe or radiation; WBGT would need Open-Meteo or ERA5 radiation, and the free Open-Meteo tier is already near its daily budget (ADR 0005 consequences).
- **Reporting.** About 25% reporting in one Illinois linkage [Q, competitor's protocol]; the 2,628 are a floor.

---

## 6. Verdict per deferred decision

### ADR 0016, personal strain model (Bayesian state-space, PHS process model, particle filter on consented heart rate)

**Can it be validated with public data? Partially, and not on the claim that matters.**

| What the ADR says | What the evidence shows |
|---|---|
| "can only be validated on **simulated** workers" | **Wrong as written.** Open lab datasets with per-minute core temperature and heart rate exist: SDSU n=65 (CC BY), PROSPIE n=21 (CC BY-NC), firefighters n=21 (CC BY, heart rate not a series), EOD n=8 (CC0) [D/Q, section 1]. A filter could be scored against real measured core temperature in the lab. |
| (implicit) wearable entries "look more personal" because their physiology is simulated | Still true for any **field** claim. No open core-temperature data exist for outdoor workers, construction, or the Gulf. The one multi-country field set (372 workers, 893 shifts, Qatar included) is not deposited; Kansas City and Dammam have no public data. |
| No freedom-to-operate analysis against the Buller patent; PHS NaN for 19.6% of inputs | **Unchanged by public data.** |

**Recommendation.**
1. **Keep the cut.** A lab validation on 65 mostly heat-intolerant volunteers on a treadmill would support "the filter reproduces core temperature in the lab", not "personal strain for UAE outdoor workers". That is the weaker version of the wow ADR 0034 rejected, and costs 1.5 to 2 days.
2. **Fix the ADR text** (premise above) so the cost-of-being-wrong paragraph does not overclaim.
3. **Optional, separate from the strain model:** use A1 to check the **PHS port** (ADR 0006) against measured core temperature, which also gives the first measured PHS NaN rate on real inputs. Estimated 0.5 to 1 day [I]. Risk: the metabolic-rate assumption (treadmill speed and grade are not in the dataset file; take them from Northway et al. 2023, which I did not read) can dominate the error and tempt tuning. If done, pre-register the comparison before looking at results.

### ADR 0017, population view (anonymous aggregates, EARS C2/C3, CUSUM, Farrington, scored on injected events)

**Is there public outcome data for the UAE or an analogue? No for the UAE. Yes for a US analogue that is too sparse and too distant to change the decision.**

| What the ADR says | What the evidence shows |
|---|---|
| "There are no real outcome data, so every number would be synthetic" | **True for the UAE** (section 2: no public series; section 3: injury register not public). **False in general**: OSHA SIR holds 2,628 real events and shows a clear weather response (section 5). |
| "Build with injected test events: rejected, synthetic-only evaluation" | Still right for the UAE. A US-analogue replay would be real events but 80 state-days with three or more events in 10.6 years, no denominators, and no engagement with ADPHC or DoH, who are the judges' reference point. |
| Revisit trigger "ADPHC interest plus a data-sharing agreement that supplies real incident or clinic-visit counts" | **Correct.** Sharpen it with the two named routes: DoH heat-illness ED data (the system existed from 2011; 3,017 cases in 2010) and MoHRE work-injury records under Cabinet Resolution 33 of 2022. |

**Recommendation.**
1. **Keep the cut.**
2. **Fix the ADR text** (premise above).
3. **Use B1 only as supporting evidence** in the technical document: one paragraph, labelled "US analogue, exploratory", stating the 15-fold rate ratio with the caveats in section 5. Do not present it as UAE validation, and do not copy the competitor's framing ("real data") without the US, federal-states-only, heat-index caveats.

---

## 7. What could be done by 20 November versus a pilot

Nine days remain. Effort is my estimate [I].

| Item | By 20 Nov? | Effort | Value | Note |
|---|---|---|---|---|
| Literature parameter table (D1 to D4, D6, D7) in the technical document, labelled "not UAE data" | **Yes** | 0.25 day | Medium | Cite exact figures from section 4. |
| OSHA analogue paragraph (section 5) with the script reference | **Yes** | 0.25 day | Medium | Already computed. Re-run if the OSHA file is refreshed. |
| Refit work-capacity loss from HEAT-SHIELD D2 against WBGT and TWL | Possible | 0.5 day | Medium | Rows have globe, wet-bulb and wind inputs; TWL computable with the project's port [I]. Productivity, not safety; confirm it is wanted. |
| PHS port check against SDSU core temperature, with pre-registration | Possible | 0.5 to 1 day | Medium | Not the strain model. Needs protocol parameters from the paper. |
| Build the strain model on public lab data | **No (recommend against)** | 1.5 to 2 days | Low | Section 6. |
| Build the population view on OSHA | **No (recommend against)** | 1.5 to 2 days | Low | Section 5 sparsity. |
| Any UAE outcome data (DoH ED visits, MoHRE injury register, ADPHC incident records) | **No** | Weeks | High (pilot) | Needs a DUA; counts as unavailable. |
| HEAT-SHIELD field data (372 workers, Qatar included) | **No** | Weeks | High (pilot) | Request through the corresponding author; also a possible pilot partner. |
| CDC NSSP/ESSENCE case-level data, Hajj MoH data | **No** | Weeks | Low | Through a jurisdiction or on request. |

**Pilot path (Jun to Sep 2027, as in the roadmap).** Outcome data: DoH heat-illness ED counts and MoHRE or ADOSH incident records, k-suppressed, under a data-sharing agreement with ADPHC as regulator partner (ADR 0017 revisit trigger). Physiology: a consented wearable sub-study with a capsule validation arm, ideally with the HEAT-SHIELD group, which holds Qatar construction data (ADR 0016 revisit trigger, plus the Buller freedom-to-operate check).

---

## 8. What I could not verify

- **UAE government sites from this network.** `mohap.gov.ae` reset the connection, `mohre.gov.ae` refused it, `opendata.fcsc.gov.ae` returned 403, `dha.gov.ae/en/open-data` returned 404. I used Wayback Machine copies for MOHAP page 1, the MoHRE Cabinet Resolution 33 page and the EHS publication plan; those copies show page state at an unknown 2026 date. No certificate checks were bypassed.
- **DoH Abu Dhabi Open Data Dashboards** (tiles not rendered), **Bayanat** (single-page app) and **Dubai Pulse** (catalogue page lacks health terms) could not be enumerated. A relevant dataset behind a tile or a search box may exist.
- **osha.gov** blocks non-browser clients (403). The OSHA page text and the zip came from the Wayback Machine (page snapshot 2026-09-29); the zip's SHA-256 equals the competitor's recorded hash, which is the integrity check I have.
- **Search coverage.** Zenodo, Dryad and Figshare queries returned about 8 hits each. PhysioNet's listing was scanned in full (760 project versions) but only by title and short description.
- **Papers not read in full:** Northway et al. 2023 (SDSU protocol), Fatima 2021 and Flouris 2018 (abstracts only), Spector et al. (search summary), Hunt et al. 2021, Malchaire 2001.
- **[S] items** (MSMR, Maricopa, Hajj press counts, Qatar HMC counts, Safe Work Australia, BLS, GOSI details, Nepal data, Kenzen, PHS database) come from search summaries and should be re-checked before they go in a submission.
- **Contents not opened:** the Japanese outdoor-worker tables (A7), the firefighter files (A4 download), the PROSPIE xlsx (A3), the HEAT-SHIELD D3 to D5 supplements. HEAT-SHIELD D2 was inspected for columns only; no model was fitted.
- **ILO exposure-response parameters** (mean and standard deviation per work intensity) are only in Figure AI.1; I did not read them off the figure.
- **UKHSA** and **Qatar's Planning and Statistics Authority** were not checked.
- **Downloaded files** (OSHA zip and CSV, three small xlsx datasets, IEM daily CSVs) are in my temporary directory, not in this repository. The OSHA file contains employer names and addresses and short incident narratives, no worker names in its columns; do not commit it.

## 9. Reproduction

Python via `uv run --with <pkgs> python -I -X utf8 <script>`; downloaded data in its own directory, scripts elsewhere. Scripts are ruff-clean (line length 140; rules E, F, W, I, B, UP, SIM, C4); not typed under `mypy --strict`, not covered by tests.

```text
# 1. OSHA SIR zip: osha.gov returns 403, so fetch the archived copy of the same URL
curl -L -C - -o sir.zip "https://web.archive.org/web/20260929145806if_/https://www.osha.gov/sites/default/files/January2015toNovember2025.zip"
# expect SHA-256 a3f7f434e200fb956131f12277378e592993a25db3f328716fbece106f846bb0 (16,224,511 bytes), one CSV of 57,403,269 bytes
osha_sir_heat_profile.py <csv>            # 105,996 rows; 2,628 heat rows (Event 531x); distributions in section 2 B1
fetch_iem_daily_us.py <out_dir>           # nine US airport daily CSVs (IEM resets connections; the script retries)
osha_heat_weather_exposure.py <csv> <out_dir> weekdays   # section 5 tables; omit "weekdays" for the all-days run
```

Ad hoc checks not in scripts: Zenodo, Dryad, Figshare and Mendeley API metadata queries; PhysioNet `api/v1/project/published/` list scan; Socrata catalogue search of `data.cdc.gov`; `pypdf` text extraction of the ILO report, the Kjellstrom 2009 paper and the ADHS report; Europe PMC abstracts for PMIDs 30526938, 33472088, 31994776; SHA-256 of the OSHA zip.
