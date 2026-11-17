# Shift regulations and sleep evidence for the heat-aware shift planner (Stellar Blaze)

**Date accessed for every source below: 2026-11-11.** Scope: the constraints a UAE outdoor-worker shift planner must respect, and the sleep and circadian evidence behind stable, sleep-aware rosters. Feeds `docs/context/challenge-07-plan.md` section 8.5 and ADR 0006.

**How to read this file.**
- Status is VERIFIED / PARTLY / UNOBTAINABLE. "Verified absent" means I read the full text of the instrument and the provision is not there.
- Evidence tags. **[exact]**: copied from a file or rendered page I read myself (PDF text layer, browser DOM, PubMed XML abstract). **[fetch-tool]**: came back from the WebFetch summariser, which can paraphrase, so re-check before putting it in the submission. **[secondary]**: not the originating authority (mirror, news, vendor blog). **[D]**: downloaded and computed by `docs/research/scripts/shift_hour_profile.py`. **[C]**: arithmetic on [D] or [exact] numbers, shown. **[I]**: my inference, not measured.
- Evidence beat the brief's framing in several places. They are collected in section 0.

## Summary

| # | Question | Status | One-line result |
|---|---|---|---|
| 1 | Federal labour law (hours, overtime, breaks, rest, night, notice, Ramadan, juveniles) | VERIFIED for hours, overtime, breaks, weekly rest, night premium, Ramadan, juveniles. **Verified absent**: daily rest between shifts, any notice before changing hours or shifts, any night-work ban for adults. | 8 h/day or 48 h/week; overtime 2 h/day and 144 h per 3 weeks; 5 h max without 1 h of breaks; Ramadan minus 2 h; juveniles 6 h/day, no work 19:00-07:00. UAE law gives **no** legal protection on rest between shifts or schedule notice, so those must be policy constraints, not "compliance". |
| 2 | MoHRE midday break | VERIFIED (window, no resumption before 15:00, exemptions). PARTLY (split-shift mechanics, typical patterns). | MoHRE says daily hours "in the morning and evening shifts" stay at 8 h in the ban months, and more than 8 h in 24 h is overtime. No official typical pattern found; only a vendor blog and a Qatar worker quote. |
| 3 | ADOSH CoP 11.0 + Technical Guideline | VERIFIED (both PDFs read in full) | TWL zone work/rest table, acclimatisation ramps, "work is to be planned so that an appropriate number of employees are acclimatized", and a soft duty to schedule heavy work in the coolest part of the day. |
| 4 | Sleep and circadian evidence | VERIFIED for shift-work literature (Cochrane 2023, quick-returns review 2016, HSE guidance). PARTLY for hot-climate work. UNOBTAINABLE for Gulf labour-camp sleep measurements. | Evidence for "stable start times improve sleep" is **indirect**: the Cochrane review found no study on start-time timing or regularity of shift changes. Early starts at or before 06:00 cost sleep (5-6 h). |
| 5 | Gulf contractor practice | PARTLY | No survey of contractor rosters exists in what I could reach. Field studies show the hazard peak is 09:00-12:00, before the midday ban starts. |
| 6 | Hard vs soft constraints, stability metric | Recommendation (section 6) | Hard = law and ADOSH; soft = sleep, stability, crew continuity, with numeric defaults and a published-vs-executed stability metric. |

## Fetch log: what blocked me, and what I did instead

No TLS or certificate check was bypassed anywhere. No git command was run.

| Site | What happened | Handling |
|---|---|---|
| `uaelegislation.gov.ae` | HTTP 403 (bot challenge page) for curl and WebFetch. | Not bypassed. Used FAOLEX and a legal-notes mirror, both marked [secondary]. |
| `government.ae`, `beta.government.ae` | TLS certificate hostname mismatch. curl schannel `SEC_E_WRONG_PRINCIPAL`; WebFetch: "Hostname/IP does not match certificate's altnames ... DNS:*.tdra.gov.ae". The server presents a TDRA certificate. | Not bypassed. The Cabinet Resolution 1/2022 PDF hosted there was read through a mirror (below). |
| `mohre.gov.ae`, `absher.mohre.gov.ae` | Connection timeout / ECONNREFUSED (185.141.13.47:443) from curl and WebFetch. | Used WAM (state news agency, renders MoHRE releases verbatim) and Wayback copies of the u.ae-hosted MoHRE PDFs. |
| `u.ae` PDFs (Ministerial Resolution 44/2022, Administrative Decision 19/2023, Decree-Law PDF) | HTTP 404 at their former paths (portal restructured). | Read the **Wayback Machine copies of the same PDFs**, [secondary] as a mirror, content is the MoHRE document ("This is not an official translation"). |
| Decree-Law 33/2021 | Official copies unreachable. | FAOLEX (FAO legal database) PDF `uae217212E.pdf`, an unofficial English translation, file created 2023-06-01, so it **pre-dates the 2024 amendment**. Decree-Law 20/2023 replaced only Article 54 (dispute jurisdiction) per search-result summaries [search summary, secondary]; I did not open its text. Articles 5, 17-21, 26 are unaffected by it. |
| Cabinet Resolution 1/2022 | Official copy unreachable (above). | `uae.shushin.io/labourlaw/Cabinet-Resolution-1-of-2022`, a legal-notes site that reproduces the uaelegislation.gov.ae English text, [secondary]. |
| `adphc.gov.ae` | TLS fine. Both PDFs downloaded. | Primary. |
| `eur-lex.europa.eu` | AWS WAF challenge for curl. | Rendered in a real browser, text read from the DOM. |
| `wam.ae` | JavaScript-rendered. | Read from the browser DOM. |
| `pmc.ncbi.nlm.nih.gov`, `journals.lww.com`, `tandfonline.com`, `cochranelibrary.com` | Paywall or reCAPTCHA. | Not bypassed. Abstracts via PubMed E-utilities (primary bibliographic record). Full texts not read. |

---

## 0. What changes in the planner design (evidence versus the brief's framing)

1. **Stable rosters are a precaution, not a proven effect, and not a legal duty.** The Cochrane review of shift-schedule adaptation (2023) listed "Regularity of shift changes" and "Timing of start of shifts" as eligible interventions and concluded "No evidence is available for other shift schedule changes." Direct support is a 2026 cross-sectional dose-response study (more notice, fewer sleep disorders), a 2025 systematic review on sleep-timing regularity in the general population, and HSE guidance. UAE law has no rule on daily rest or schedule notice (section 1). So say "policy and good practice, benchmarked to EU/HSE/Oregon", never "compliant".
2. **The midday window is not where the hazard peaks.** A Saudi field study found the highest WBGT 09:00-12:00 and that complying with a 12-15:00 ban "was not effective in reducing heat stress risk". A UAE returnee told HRW people "fall ill or faint ... between 10 am and 12 noon". My own METAR profile (section 7) has temperature at 38 C by 10:00 and 41 C at 12:00. Do not hard-code 12:30-15:00 as the only high-risk period; keep the hourly WBGT/TWL engine in charge for every hour.
3. **Early starts and night work are not escapes from the heat.** At Abu Dhabi airport, no-sun WBGT at 04:00 averages 28.3 C (p90 30.8 C) over 15 Jun-15 Sep 2024-2026 [D]. That is at or above the NIOSH REL for moderate and heavy work in ADR 0006's test vectors (28.21 at 300 W, 26.59 at 415 W) [C]. Night-time minimums stay at or above 25 C on 100% of nights [D]. Early starts cut exposure (less sun, lower dry bulb) but do not remove it.
4. **Sleep quality is dominated by things the roster cannot set**: air-conditioned accommodation, camp-to-site transport time and bus waiting. In the one UAE worker account I could verify, work ended at 17:00, the camp was reached at 21:00, bed was near midnight and the wake-up was 04:30, which leaves about 4.5 h in bed (quote in section 4.7). The planner needs per-site inputs (commute minutes each way, bus wait, accommodation AC yes/no) or its "sleep-aware" claim is hollow.
5. **A weekly roster is built on climatology, not on the forecast.** Observed temperature varies about 2.0 C day to day around the hourly mean (1.8-2.6 C across three stations), worth about 1.0-1.4 h of the morning heat ramp [D]. The project's own raw IFS errors are RMSE 2.1-2.4 C at 1 day and 2.7-3.1 C at 7 days (all hours, 8 stations, `results/baseline_errors_pooled.csv`) [C]. So at the lead time where a roster would be frozen (about a week), the raw forecast is no better than the hourly climatology for temperature. Use the forecast for day-ahead task mix, rest ratios and stop-work, which cost nothing in sleep, and change start times only on persistent signals (section 6).
6. **Stopping work for heat is not free in wages.** Decree-Law Art. 26(1): "Otherwise, it shall be obliged to pay the wage agreed upon." A heat stop-work hour still costs the wage, so the objective should price cancelled hours, and workers have no wage incentive to hide symptoms.
7. **Juveniles (15-17) cannot be on any shift that starts before 07:00** (Art. 5(2)(d)). A 05:30 template must exclude them from outdoor summer work.
8. **The common "06:00-12:30" morning block conflicts with the 5-hour rule unless a break sits inside it** (Art. 18). It is a legal-interpretation point to settle with MoHRE or counsel (section 8).
9. **Acclimatisation is crew state, which is a second stability argument.** ADOSH bars unacclimatised workers from Medium and High TWL zones and defines "unacclimatised" as new or away more than 14 days. Crew continuity per task keeps people acclimatised; CoP 3.2(d) requires planning for it.

---

## 1. UAE Federal Decree-Law 33/2021 and Cabinet Resolution 1/2022

**Status: VERIFIED** for the items below. Source text: FAOLEX English translation of the Decree-Law, [exact] from the PDF text layer (the layer drops "Th" ligatures, restored in the quotes below), and a mirror of the Executive Regulations, [secondary].

URLs
- Decree-Law (FAOLEX, "NOT an official translation"): https://faolex.fao.org/docs/pdf/uae217212E.pdf
- Executive Regulations mirror: https://uae.shushin.io/labourlaw/Cabinet-Resolution-1-of-2022 (official copy: https://government.ae/-/media/Information-and-services/Jobs/Cabinet-Resolution-Executive-Regulations-DecreeLaw-No-33-5.pdf, unreachable, TLS mismatch)
- Government summary page [fetch-tool]: https://u.ae/en/information-and-services/jobs/sector-of-employment/employment-in-the-private-sector/working-hours

| Topic | Provision | Exact wording |
|---|---|---|
| Daily and weekly hours | Decree-Law Art. 17(1) | "The maximum normal working hours for workers shall be (8) eight hours per day or (48) forty-eight hours per week." |
| Sector changes | Art. 17(2) | "The Cabinet may ... increase or reduce the daily working hours for some economic sectors or some categories of workers, as well as the working hours, break and hours during which it is prohibited to work for certain categories of workers" |
| Commute | Art. 17(3) | "The periods spent by the worker during the commute between his place of residence and the workplace, shall not be counted in the working hours, except for some categories of workers" (Exec. Regs. Art. 15(1): counted only in bad weather per the National Center of Meteorology, employer-transport accident or breakdown, or explicit contract term) |
| Breaks | Art. 18 | "The worker may not work for more than (5) five consecutive hours without a break or breaks of not less than an hour in total, provided that these periods are not included in the working hours. Working hours and breaks shall be arranged at an establishment working according to shifts or for some job categories, as per their nature, such as field jobs, and according to the workers' classification specified in the Implementing Regulation hereof." |
| Overtime | Art. 19(1) | "The employer may instruct the worker to work overtime over the normal working hours, provided that they do not exceed two hours per day. The worker may not be instructed to work for more than that period, except in accordance with the conditions and rules specified by the Implementing Regulation hereof. In all cases, the total working hours shall not exceed (144) one hundred and forty four hours every (3) three weeks." Exec. Regs. Art. 15(3) adds the exception "unless the work is necessary to prevent the occurrence of a gross loss or a serious accident or to eliminate or mitigate its effects." |
| Overtime pay | Art. 19(2), 19(3) | Plus "not less than (25 %)"; for overtime between 10 pm and 4 am, plus "not less than (50%)", and "The workers working based on shifts shall be excluded from this clause." |
| Weekly rest | Art. 21 | "The worker shall be granted a paid weekend of not less than one day, according to the employment contract or the work regulation." Art. 19(4) lets the employer instruct work on the weekend against another day off or a 50% premium; 19(5): "A worker shall not be instructed to work for more than two consecutive weekend days, except for day workers." |
| Ramadan | Exec. Regs. Art. 15(2) | "The normal working hours shall be reduced by two hours during the holy month of Ramadan." (Decree-Law Art. 17(4) delegates it.) u.ae: "During the holy month of Ramadan, working hours are reduced by 2 hours, every day." [fetch-tool] |
| Shift activities | Exec. Regs. Art. 15(4)(d) | Exempt from the maximum-hours limit: "Activities whose technical nature require its performance in successive shifts or rounds provided that the average of working hours does not exceed (56) hours per week." This sits uneasily with the 144 h per 3 weeks rule (48 h per week on average) "in all cases". Use 144. |
| Juveniles (15 to under 18) | Decree-Law Art. 5(2) | "(c) The actual working hours shall not exceed six hours per day and shall include one break or more, which shall not be less than one hour in total, and this period(s) shall be defined, so that the juvenile does not work for more than four consecutive hours. (d) The juvenile shall not work between 7 pm and 7 am. (e) The juvenile shall not be employed in dangerous or arduous works ... (f) The juvenile shall not work overtime, be kept in the workplace after the prescribed hours or work on weekends or official holidays." Art. 5(1): "It is not permissible to employ any person under the age of fifteen years old." |
| Work stopped by the employer | Art. 26(1) | "The wage is paid in exchange for work and the employer shall allow the worker to carry out his work. Otherwise, it shall be obliged to pay the wage agreed upon." |
| Contract terms | Exec. Regs. Art. 10(1) | The contract includes "working hours, rest days". Art. 10(3): changing the work **model** needs "Approval from both the employer and worker." |
| Work regulations | Exec. Regs. Art. 14 | Establishments with 50 or more workers: "The list of work instructions must include the daily working hours, weekend days, official holidays ..." and "The employer must inform the worker of the regulations ... and must make him aware of it in the language he understands." |
| Safety duty | Decree-Law Art. 13(6) | The employer must provide "the necessary means of prevention to protect workers from the risks of occupational diseases and injuries". Art. 13(4): "proper accommodation licensed by the competent authorities" or an allowance. |

**Verified absent (read the full Decree-Law text and Exec. Regs. Arts. 10, 14, 15, no match for "daily rest", "rest period", "between shifts", "notice" of a change in hours):**
- No minimum daily rest between shifts. The only indirect bound is 8 h normal plus 2 h overtime plus at least 1 h of breaks per day.
- No notice period for changing working hours or shift start times. Hours are a contract term and a work-regulation item, so a change is a contract-variation question, which I cannot resolve from the text (section 8).
- No night-work ban for adult workers. Night enters the law only through the 50% overtime premium (non-shift workers) and the juvenile ban 19:00-07:00. No women-specific night restriction appears in the 2021 text.
- No heat-specific rule in the Decree-Law itself.

**Scope caveats.** The Decree-Law covers the mainland private sector. Free zones (ADGM, DIFC and others) and the government sector have separate regimes. A search-result summary says ADGM overtime pay can be contracted out of [search summary, secondary], so do not apply these numbers to a free-zone client without checking.

**Ramadan and the heat season.** Ramadan runs about 11 days earlier each year (2027 starts about 8 February), so it does not overlap 15 June-15 September for decades [I]. Build the Ramadan reduction as a calendar-driven rule anyway, because the planner will also be used outside summer.

---

## 2. MoHRE midday break (12:30-15:00, 15 June-15 September)

**Status: VERIFIED** for the window, the no-resumption rule and the exemptions. **PARTLY** for split-shift mechanics and typical patterns.

**Ministerial Resolution 44/2022, Art. 3 "Noon Work Ban"** [exact, Wayback copy of the u.ae PDF, "This is not an official translation"]:
> "All work performed directly under the sun and in open places shall not be allowed between the peak hours of 12.30 pm and 3 pm from June 15 to September 15 every year. No business shall be resumed before 3pm, while adhering to what is stipulated in the procedures manual in this regard."

> "The procedures manual specifies the exempted processes which are required for technical reasons to be carried out continuously and identify the obligations of employers in this case."

URL: https://web.archive.org/web/2024id_/https://u.ae/-/media/Information-and-services/Jobs/Ministerial-Resolution-No-44--of-2022-1.pdf (original path, now 404: https://u.ae/-/media/Information-and-services/Jobs/Ministerial-Resolution-No-44--of-2022-1.pdf)

**Administrative Decision 19/2023, Art. 11 "Prohibition of Work During the Midday"** [exact, Wayback copy; 26 pages, translated by a third party]:
> "Employers are required to provide shaded areas for their workers to rest during rest periods. For technical reasons, the following works are exempt and must continue uninterrupted: 1. Concrete pouring and asphalt mixing that cannot be completed in the afternoon. 2. Repairs and maintenance necessary to avert dangers, damages, malfunctions or accidental losses including: Cutting off the water supply. Cutting off sewer lines. Disconnection of electrical power. Blocking or obstructing major roads. Cutting off gas or petroleum pipelines. 3. Projects that require permission from the competent authorities due to their impact on traffic and services. This is if the permit requires work 24 hours a day."

> "When technical reasons dictate the continuation of work, employers must provide workers with the following: 1. Provide the worksite with enough cold drinking water to accommodate the number of workers. 2. Hydration fluids, such as lemon juice and minerals, approved by the country's health authorities. 3. On-site first aid materials. 4. A sufficient supply of air conditioning. 5. Canopies and sun shades."

URL: https://web.archive.org/web/2024id_/https://u.ae/-/media/Documents-2nd-half-2023/Administrative-Decision-No-19-of-2023-Relating-to-Occupational-Safety-and-Health--Labour-Accomedatio.pdf

**Must daily hours be split around the break?** The law does not say "split". The MoHRE release says what happens to the hours [exact, WAM, 1 June 2023, rendered DOM]:
> "Daily working hours, in the morning and evening shifts, shall not exceed eight hours during the months of the ban. If an employee is made to work more than eight hours in a 24-hour period, the additional hours will be considered overtime and the employee would be entitled to additional pay, based on the Regulation of Employment Relationship Law. Employers are required to provide a shaded area where workers can rest during the midday break."

URL: https://www.wam.ae/en/details/1395303164508

The 2026 release [exact, WAM, 8 June 2026] states the window and exemptions but **does not repeat** the eight-hour sentence: "During this period, work under direct sunlight and in open areas will be prohibited daily from 12:30 pm until 3:00 pm." and "Under the Occupational Heat Stress Prevention Policy, companies are required to provide shaded areas to protect workers from direct sunlight during work breaks or while carrying out exempted activities." URL: https://www.wam.ae/en/article/c0memda-mohre-announces-return-occupational-heat-stress . Treat the eight-hour rule as stated by MoHRE in 2023 and consistent with Decree-Law Art. 17, and confirm it still holds.

Other primary-adjacent points:
- **No-resumption** "before 3pm" is in the resolution text above, so a "midday gap" is a gap, not a shorter break.
- AD 19/2023 Art. 7(3), on commuting in severe weather: "Practice a high level of flexibility regarding working hours in a manner that achieves the required balance between workers' welfare and the interests of work." [exact]. This is the nearest thing to a MoHRE statement that schedules should flex.
- AD 19/2023 Art. 9(4), worker obligations: "It is important to get adequate sleep at night and to take breaks in designated rest areas if necessary." [exact]. MoHRE puts sleep on the worker. The planner cannot lean on that.
- ADPHC page [fetch-tool]: "employers must not allow workers to perform any outdoor activities from 12:30pm until 3:00pm" from 15 June to 15 September. https://www.adphc.gov.ae/en/Public-Health-Programs/Injury-Prevention/Safety-in-Heat
- Fines are not stated in the WAM texts. Secondary sources conflict (Dh5,000 per worker up to Dh50,000, one older piece Dh15,000). Do not cite a figure.
- **Status of Ministerial Resolution 44/2022.** Clyde & Co (June 2026) says Ministerial Resolution 122/2026 "repeals prior accommodation provisions under Ministerial Resolution No. 44 of 2022 (as amended)" [fetch-tool, secondary]. It does not say the midday-ban article is affected, and the June 2026 WAM release shows the policy running. Confirm before citing Art. 3 as current law. https://www.clydeco.com/en/insights/2026/06/uae-mhre-updates-labour-accommodation-requirements

**Documented typical shift patterns: PARTLY.** No official pattern exists in what I could read. What I found, all [secondary]:
- A vendor blog gives "6:00am to 12:30pm" and "3:00pm to 4:30pm" as an example split with "12:30pm to 3:00pm marked 'No outdoor work'", plus "Earlier starts are the main lever", "keep indoor or shaded work for the afternoon, and schedule concrete pours for early morning or night", and "crews need a second run each day if they return to accommodation during the break." https://www.worldstarmanpower.ae/blog/uae-midday-break-rule-contractor-guide/ [fetch-tool, vendor]. Note that 06:00-12:30 is 6.5 h in a row, which needs a break inside it under Art. 18.
- Another vendor page repeats only "Total daily working hours still cap at eight, split across the morning and evening shifts either side of the break." https://www.inndex.co.uk/en-us/news/uae-midday-break-rule [fetch-tool, vendor]
- Qatar (different window, 10:00-15:30), a construction worker: "We work until 10am and then resume after 3:30pm" https://thepeninsulaqatar.com/article/08/06/2026/workers-contractors-adapt-to-heat-regulations [fetch-tool, news].

---

## 3. ADOSH-SF CoP 11.0 (v4.0, July 2024) and the Technical Guideline "Safety in the Heat" (v4.0)

**Status: VERIFIED.** Both PDFs downloaded from `adphc.gov.ae` (TLS valid) and read from the text layer; Table 1 read from the rendered page 5. Scope: **the Emirate of Abu Dhabi** (CoP 1(a)); other emirates have only the MoHRE rules.

URLs
- CoP 11.0: https://www.adphc.gov.ae/-/media/Project/ADPHC/ADPHC/PDF/OSHAD-SF/Codes-of-Practise/11---Safety-in-the-Heat-v31-English.pdf
- Technical Guideline: https://www.adphc.gov.ae/-/media/Project/ADPHC/ADPHC/PDF/OSHAD-SF/Technical-Guidelines/Safety-in-the-Heat--Eng.pdf

**Work/rest, hydration and zone rules (Technical Guideline Table 1, page 5) [exact, rendered page]:**

| Zone (TWL, W/m2) | Interventions as printed | Rehydration per hour | Work-rest (minutes) |
|---|---|---|---|
| Low Risk Unrestricted, "140 - 220 <" | "No limits on self-paced work for educated, hydrated workers." | Light work 600 ml - 1 litre | "Safe for all continuous self-paced work" |
| Medium Risk Cautionary, "115 - 140" | "Practicable Engineering control measures ..."; "Working alone to be avoided"; "No unacclimatised person to work"; "Ensure adequate fluid intakes appropriate for type of work" | Light 1 - 1.2 L; heavy > 1.2 L | Light: "Safe for continuous self-paced light work". Heavy: "Continuous paced work 45 work - 15 rest" |
| High Risk, "< 115" | "Strict Work/Rest cycling required"; "No person to work alone"; "No unacclimatised person to work"; "High Risk induction required emphasising hydration and identifying signs of heat strain"; "Provide personal water bottle (2 litre capacity) on-site at all times" | All work > 1.2 L | Light: 45 work - 15 rest. Heavy: **20 work - 40 rest** |

Footnotes as printed: "Unacclimatised workers are defined as new workers or those who have been off work for more than 14 days due to illness or vacation leave (in a cool climate area)"; "Heavy work - carrying, climbing, lifting, pushing, whole-body work"; "Self-paced work - workers must be allowed to adjust their work rate according to environmental conditions. Paced work is when the work rate is not under the worker's control." In the heavy-work High Risk zone a shift yields at most one third of its hours as work, so 8 h is a ceiling, not a target [C].

**Acclimatisation (Technical Guideline section 3) [exact]:** new employee 20% / 40% / 60% / 80% / 100% of the full assignment on days 1-5; experienced employee 50 / 60 / 80 / 100 / 100. Re-acclimatisation by days away: under 4 days 100%; 4-5 days (illness 1-3) "R/E*" then 100%; 6-12 days (illness 4-5) 80% then 100%; 12-20 days (illness 6-8) 60 / 80 / 100; over 20 days (illness over 8) 50 / 60 / 80 / 100. "Table used courtesy of the National Safety Council". §5.1: "It takes over two weeks to become fully acclimatized; however adaptation is rapid in the first few days."

**CoP clauses the planner must trace to [exact]:**
- 3.1.1(e): "Any worksite that has, or it is reasonably foreseeable to have, a temperature at or above 35 degrees Celsius at any time during a work shift, shall implement an effective heat stress program, unless they can document through risk assessments and Thermal Work Limit (TWL) that there is no risk to employees."
- 3.1.1(g): "Employers shall ensure worksites adhere to the UAE Ministry of Labour requirements for a midday break during the summer months for employees working outside."
- 3.1.1(k): "Employers shall ensure an allowance is made for self-pacing of work and appropriate rest breaks are provided to exposed employees."
- 3.2(b)(i): "acclimatization program for new employees, employees that have been on vacation, and employees that are moving from a worksite that has climate control to a worksite that has high temperatures with an allowance of 5-7 days for acclimatization before starting hard work in a hot environment;"
- 3.2(b)(ii): "process for assessing environmental conditions utilizing the Thermal Work Limit (TWL) to determine work/rest breaks and water consumption requirements for employees"
- 3.2(b)(vii): "provision for design and placement of shade and cooling shelters for employees working outside during summer months and appropriate cooled accommodation / shelter for the summer months during the midday break periods set by the Ministry of Labour;"
- **3.2(b)(viii): "process for scheduling physical activities in the summer months during the coolest part of the day to the extent reasonably practicable;"**
- **3.2(d): "Work is to be planned so that an appropriate number of employees are acclimatized and prepared to work in a high temperature environment."**
- 3.2(e): "Employees shall not work alone in heat stress areas ..."
- 3.2(i): "Employees working in high temperature environments shall be provided a cooler area to rest during breaks in order to reduce body heat. Duration of breaks, extent of clothing removal, and rest area shall be appropriate for conditions at the site."
- 2(d)(ii): drinking "at least 2 litres every 2-3 hours"; 3.2(b)(v): "programmed drinking where appropriate every hour".

**Rescheduling to cooler hours.** CoP 3.2(b)(viii) is a soft duty ("to the extent reasonably practicable"). Technical Guideline §5.4(a): "(i) Schedule maintenance and repair jobs in hot areas for cooler months; (ii) Schedule hot jobs for the cooler part of the day; (iii) Acclimatize employees by exposing them for progressively longer periods to hot work environments; (iv) Reduce the physical demands of employees; (v) Use relief employees or assign extra employees for physically demanding jobs;" and, for employees, "(iii) Schedule heavy work during the coolest parts of day". Item (i) (Technical Guideline page 10) is a **seasonal, long-horizon** scheduling cue that the day-by-day planner currently lacks.

**Sleep in the regulator's own text.** The Technical Guideline's key points for workers include "4. Get plenty of sleep and rest at night" (Technical Guideline page 13). It sets no numeric sleep rule.

**Unacclimatised workers during the ramp [I].** Table 1 bars unacclimatised workers from the Medium and High zones entirely, while the acclimatisation table has them working 20-80% on days 1-4. The two are consistent only if the ramp days fall in the Low zone (TWL at or above 140). So an unacclimatised worker is schedulable on a given hour only if that hour's TWL is at or above 140. Confirm with ADPHC.

---

## 4. Sleep and circadian evidence for shift design

**Status: VERIFIED** for the general shift-work literature; **PARTLY** for hot-climate outdoor work; **UNOBTAINABLE** for measured sleep of Gulf labour-camp workers (a PubMed search on sleep and migrant or camp workers in Qatar, Saudi, Kuwait, Emirates, Bahrain returned nothing; the nearest items are US farmworkers, Spanish outdoor workers and Australian fly-in-fly-out camps).

### 4.1 Early starts and timing
- Kecklund and Åkerstedt 1995, *J Sleep Res* (a narrative review, not systematic), PMID 10607211 [exact]: "no more than 5 or 6 hours of sleep is obtained before the morning shift if the shift starts at 06.00 hours or earlier. Therefore, it is suggested that the morning shift should not start before 07.00 hours." It also says "at least 16 hours is needed [as free time between shifts] and that quick change-overs should be avoided."
- Tucker, Smith and Macdonald 1998, *J Occup Health Psychol*, field study of 6:00 vs 7:00 a.m. changeovers, PMID 9684216 [exact]: "Night sleeps between consecutive shifts that started at 6 a.m. were shorter and more disrupted than those starting at 7 a.m. ... Early starts were associated with poorer psychological and physical health."
- HSE, *Managing shift work* (HSG256) [exact, PDF text]: "If not strictly necessary for business needs, try to avoid early morning starts before 7.00 am." and "Where possible, arrange shift start/end times to be convenient for public transport or consider providing transport for workers on particular shifts." and "Avoid split shifts unless absoloutely necessary to meet business needs." https://www.hse.gov.uk/pubns/priced/hsg256.pdf
- **Tension with the UAE summer:** a 07:00 start is not workable for heavy outdoor work (temperature is 38 C by 10:00, section 7), and the legal pattern in the ban months is early start plus late block, which is a split shift by definition. The planner has to pay the sleep price knowingly, then minimise it.

### 4.2 Variable start times and schedule instability
- Cochrane review, Hulsegge et al. 2023, *Cochrane Database Syst Rev* CD010639, PMID 37694838 [exact abstract]: 11 studies, 2,125 participants. Eligible components included "Regularity of shift changes", "Timing of start of shifts", "Time off between shifts", "Split shifts". Conclusion: "No evidence is available for other shift schedule changes. There is a need for more high-quality studies (preferably RCTs) for all shift schedule interventions". https://pubmed.ncbi.nlm.nih.gov/37694838/
- Park et al. 2026, *J Occup Health*, PMID 42536410, cross-sectional, Korea and Europe [exact]: "Unpredictable schedule changes were associated with higher odds of sleep disorders in Korea (adjusted odds ratio [aOR] = 2.544 ...) and Europe (aOR = 1.787 ...). Risk increased progressively as advance notice shortened, demonstrating a clear dose-response relationship." Not construction, not causal.
- Kalkanis et al. 2025, *Sleep Med Rev* systematic review of sleep regularity, 59 studies, PMID 41259946 [exact]: "Consistent, moderate-certainty evidence linked greater sleep-timing irregularity to higher depressive and anxiety symptoms, elevated body mass index, insulin resistance, hypertension, and incident cardiovascular events ... Five low-bias cohorts showed 20-88 % higher all-cause mortality for the least regular sleepers". General population, not shift workers, observational.
- HSE (HSG256) on rotation [exact]: "Either rotate shifts very quickly, eg every 2-3 days or slowly, eg every 3-4 weeks and avoid weekly/fortnightly rotating shift schedules."
- **Read-across:** direction is consistent (predictability and regular sleep timing are better), the size of the benefit for outdoor construction crews is unmeasured. That is why section 6 sets stability as a soft, tunable constraint with a stated rationale and a metric, not a number from a trial.

### 4.3 Rotation direction and speed
- Cochrane 2023 [exact]: "Forward and faster rotation may reduce sleepiness during shifts, and may make no difference to sleep quality, but the evidence is very uncertain. Very low-certainty evidence indicated that sleep duration off-shift decreases with faster rotation." (Faster rotation: about 0.38 h less sleep per day, very low certainty.) Forward vs backward came from one usable CBA trial of 62 participants.
- HSE [exact]: "Where possible, adopt a forward-rotating schedule for rotating shifts rather than a backward-rotating schedule." and "When switching from day to night shifts or vice versa, allow workers a minimum of 2 nights' full sleep." and "In general, limit consecutive working days to a maximum of 5-7 days ... Where shifts are long (> 8 hours), for night shifts and for shifts with early morning starts, it may be better to set a limit of 2-3 consecutive shifts."
- Folkard and Tucker 2003, *Occup Med*, PMID 12637593 [exact]: "safety declines over successive night shifts, with increasing hours on duty and between successive rest breaks."
- Relevance: rotation matters only if the planner puts crews on night or alternating early/late patterns. If it does not, forward-rotation is moot.

### 4.4 Minimum rest between shifts
- EU Working Time Directive 2003/88/EC, Art. 3 [exact, EUR-Lex DOM]: "every worker is entitled to a minimum daily rest period of 11 consecutive hours per 24-hour period." Art. 8(b): "night workers whose work involves special hazards or heavy physical or mental strain do not work more than eight hours in any period of 24 hours during which they perform night work." Art. 5: weekly rest "a minimum uninterrupted rest period of 24 hours plus the 11 hours' daily rest". https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32003L0088
- Vedaa et al. 2016, *Ergonomics* systematic review of "quick returns" (11.0 h or less between shifts), 22 studies, PMID 26072668 [exact]: "There were some indications of detrimental effects of quick returns on proximate problems (e.g., sleep, sleepiness and fatigue), although the evidence of associations with more chronic outcome measures ... was inconclusive."
- HSE [exact]: "Under the WTR, the minimum time allowed between shifts is 11 hours."
- Oregon predictive-scheduling statute (retail, hospitality and food, 500+ employees) [fetch-tool]: "you can't be scheduled to work during the first 10 hours following the end of a previous calendar day's work", schedules posted "at least 14 calendar days in advance". https://www.oregon.gov/boli/workers/pages/predictive-scheduling.aspx
- **UAE: no equivalent** (section 1). Eleven hours is therefore a benchmark, not a legal floor here.

### 4.5 How much sleep, and what commuting costs
- AASM and SRS consensus 2015, *Sleep* 38(6):843-844 [exact, PDF text layer]: "Adults should sleep 7 or more hours per night on a regular basis to promote optimal health." and "Sleeping less than 7 hours per night on a regular basis is associated with adverse health outcomes". https://www.aasm.org/resources/pdf/adultsleepdurationconsensus.pdf
- Petrov et al. 2018, *Am J Prev Med*, actigraphy, 760 US Hispanic/Latino non-shift workers, PMID 29338957 [exact]: "each additional hour of commute time conferred 15 minutes of sleep loss". Not Gulf, not shift workers.
- Commute is **not** working time under UAE law (section 1), so it is not capped by the 8 h rule, yet it consumes the sleep window.

### 4.6 Heat, hot nights and recovery (hot-climate and worker evidence)
- Raja et al. 2026, *Ann Occup Environ Med*, systematic review of heat and sleep in heat-exposed workers, 11 studies, PMID 41680965 [exact]: "Heat exposure consistently impaired sleep quality and duration ... Night-time temperatures above 25°C and high workplace wet bulb globe temperature values were strongly linked with reduced sleep efficiency and delayed sleep onset. Vulnerable groups included shift workers, petrochemical and steel labourers, women, older adults, and low-income workers in urban heat islands and poorly ventilated housing." Recommends "revised work-rest schedules" with cooling and better housing. Studies spanned Asia, Australia, North America and global cohorts; the abstract names no Gulf study.
- Montanari et al. 2026, *J Clim Change Health*, PMID 42920703, 13 Spanish outdoor workers over one summer [exact]: each 1 C of indoor temperature cost 3.18 minutes of total sleep time (95% CI 0.70-5.67). Very small sample; the effect size is per 1 C.
- van Selm et al. 2026, *Int J Hyg Environ Health*, PMID 42561787, 300 California farmworkers [exact]: heat-related illness odds were higher for "those reporting heat-related sleep problems (aOR: 3.25, 95%CI: 1.50-7.02)" and "those working more than 5 days per week (aOR: 2.19 ...)". Cross-sectional, self-reported.
- Keramidas and Botonis 2021, *Exp Physiol*, narrative review, PMID 33745159 [exact]: "Limited to moderate evidence suggests that sleep deprivation per se impairs thermoregulatory defence mechanisms during exposure to thermal extremes. Future research is required to establish whether inadequate sleep enhances the risk for cold- and heat-related illnesses." So the sleep-to-heat-illness link is plausible and supported by a farmworker association, but not established.
- Nag and Nag 2001, *J Hum Ergol*, PMID 14564876, textile workers (13 night, 16 rotating day) [exact]: "the night workers were more vulnerable and less tolerant to heat, the tolerance time being less by about 15% (31 degrees C ET) to 40% (39 degrees C ET), compared to the rotating day workers." Very small, old, industrial; a caution against assuming night work is "cooler therefore safer".
- Vital Signs Partnership [fetch-tool]: for the Gulf in June 2022 "nighttime temperatures stayed above 30ºC for 278 of 290 night hours". The page names no city or station. Section 7 gives the station-level numbers. https://vitalsignsproject.org/research/report-3/
- Beranek et al. 2025, *Sleep Breath*, PMID 40965743, 538 Australian fly-in-fly-out miners in camps [exact]: "Two-thirds (n = 366) rated their sleep environment as moderately or highly sleep-disruptive", with room temperature, noise, light and bedding comfort among the factors. Camp analogue, not Gulf.

### 4.7 Gulf migrant labour: what workers say (testimony, not measurement)
HRW, 31 May 2023 [exact, page text read in full]: https://www.hrw.org/news/2023/05/31/gulf-states-migrant-workers-serious-risk-dangerous-heat
> "Migrant workers also said that their commuting and accommodation arrangements affected their ability to recover from the workday's exposure to extreme heat. One construction worker from the UAE said: 'I finish work at 5 pm but have to wait for the company bus until 7 pm, so I don't get back to my camp until 9 pm ...[when I go to sleep] it's close to midnight, only to wake up at 4:30 the next morning. I don't feel well-rested.' Another said that night rotations, while relatively cooler but still humid, still pose risks to health and safety. 'Sleeping during the day can never substitute for a good night's sleep so I always feel tired.'"

> "Without air conditioning, the overcrowded rooms with up to 10 people would become unbearable. The only way to sleep was out of exhaustion." (Qatar-based worker)

> "A UAE returnee said, 'While the company never tried to make us work during the summer afternoons, people would still fall ill or faint earlier in the mornings, between 10 am and 12 noon.'"

HRW 23 June 2026 [exact]: "Gulf states have the means and capacity to adopt these protections, including restricting working hours based on actual temperature thresholds rather than fixed schedules." and "Only Qatar, in 2021, has introduced the index with an upper WBGT threshold of 32.1 degrees Celsius (89.78 degrees Fahrenheit) to stop outdoor work, but the threshold is too high and enforcement gaps remain." https://www.hrw.org/news/2026/06/23/gulf-states-migrant-workers-heat-protections-fall-short . HRW is an advocacy source with small interview samples (6-20 workers per report).

The accommodation rule that would bear on sleep: AD 19/2023 requires employer vehicles to be "licensed, air-conditioned, equipped with adequate seating" (Art. 7(1)) and Decree-Law Art. 13(4) requires "proper accommodation licensed by the competent authorities". The 2026 resolution that reportedly replaces the accommodation provisions of MR 44/2022 is not read (section 2).

---

## 5. Practical industry practice in the Gulf

**Status: PARTLY.** I found no survey or dataset of how contractors actually roster in summer. What exists is regulation, field measurements and testimony.

- **Field measurement, Saudi Arabia** (Al-Bouwarthan et al. 2019, *Ann Work Expo Health*, PMID 31051037) [exact]: "Complying with a midday outdoor work ban (12-3 p.m.) was not effective in reducing heat stress risk. The highest intensity of exposure was outdoors from 9 a.m. to 12 p.m.; a period identified with the highest hourly mean WBGT values (31-33°C) and the least allowable working time according to ACGIH guidelines." Follow-up (PMID 32219304, 23 workers, 260 person-days): the WBGT limit "was exceeded frequently, on 63 person-days indoors (44%) and 91 (78%) outdoors", workers "began and ended their shifts dehydrated", and "The ability to self-pace work was associated with a lower frequency of HRR >= 30%."
- **Field measurement, UAE** (Ahmed et al. 2020, *Ind Health*, PMID 31308288) [exact]: site "labeled as Acclimatization Zone implying that no un-acclimatized worker should work here and working alone should be avoided" (older zone naming for TWL 115-140) and "Scheduling of the work earlier or later (after sunset) along with breaks for rest on cool shaded areas are recommended."
- **Injuries despite a ban, Kuwait** (Alahmad et al. 2023, *Occup Environ Med*, PMID 37068948) [exact]: relative risk of injury 1.44 (95% CI 1.34-1.53) at 39.4 C versus the 10th-percentile day, during the ban; "'Calendar-based' regulations may be inadequate".
- **Qatar** is the only Gulf state with a real-time index rule (WBGT 32.1 C stop-work, 2021; HRW quote above). The ban window is 10:00-15:30 (1 June-15 September, Ministerial Decision 17/2021) [secondary, news].
- **Testimony** (HRW 2023, section 4.7): a 5 pm finish, bus until 7 pm, camp at 9 pm, bed near midnight, wake 4:30, spans about 16.5 hours from wake-up to return to camp (04:30 to 21:00) [C], which suggests a start around 05:00-06:00 [I]. The company "never tried to make us work during the summer afternoons" but people fainted 10:00-12:00. HRW 2026, on delivery riders: "others were able to adjust their schedules to include cooler night hours."
- **Night work.** Legal for adults in the UAE (no ban; overtime premium only). Large-project night shifts exist but I found no source quantifying their use. Worker testimony says night work is "relatively cooler but still humid". Section 7 shows why.
- **Vendor guidance** (section 2): 06:00-12:30 plus a short afternoon block; second commute run if crews return to camp at midday.

---

## 6. Recommended constraints for the planner

Numbers marked **[I]** are my proposals with the stated rationale; they need calibration with a site operator. Everything else is a quoted value.

### 6.1 HARD constraints (legal and regulatory)

| ID | Constraint | Value | Source | Scope |
|---|---|---|---|---|
| H1 | No outdoor work in direct sun or open areas during the midday window | 12:30-15:00 daily, 15 Jun-15 Sep; "No business shall be resumed before 3pm". Make dates and hours configuration with effective dates per year (2027 announcement does not exist yet). | MR 44/2022 Art. 3; WAM 2026 | Federal |
| H1a | Exempt activities may run through the window, with duties | Concrete pouring and asphalt mixing that cannot be completed later; hazard and utility repairs; permit work needing 24 h cover. Require cold water, hydration fluids, first aid, air conditioning, canopies. The planner must carry an `exempt_reason` per task and may not infer exemption from task type alone. | AD 19/2023 Art. 11 | Federal |
| H2 | Normal hours per worker | at most 8 h/day and 48 h/week; in the ban months at most 8 h across morning and evening shifts, more than 8 h in 24 h is overtime | Decree-Law Art. 17(1); MoHRE 2023 release | Federal |
| H3 | Overtime | at most 2 h/day (except to prevent gross loss or serious accident), and total hours at most **144 h in any rolling 3 weeks**. Ignore the 56 h/week shift-work average. | Art. 19(1); Exec. Regs. 15(3) | Federal |
| H4 | Continuous work and breaks | no continuous work block over 5 h; at least 1 h of breaks in total, not counted as working hours. Whether the ban window counts as the break is **unsettled** (section 8). Default: do not count it. | Art. 18 | Federal |
| H5 | Weekly rest | at least 1 rest day in any 7 days (the law allows working it against a compensatory day or +50%, so treat as hard by default and flag overrides) | Art. 21, 19(4)-(5) | Federal |
| H6 | Juveniles (15-17) | at most 6 h/day; at least 1 h of breaks and no more than 4 consecutive hours; **no work 19:00-07:00**; no overtime, weekends or holidays; no dangerous or arduous work; none under 15 | Art. 5 | Federal |
| H7 | Ramadan | normal hours minus 2 h/day (calendar-driven) | Exec. Regs. 15(2) | Federal |
| H8 | TWL zone rules | Medium (115-140): no unacclimatised worker, no lone work, heavy work 45 work / 15 rest. High (below 115): strict work/rest cycling, no lone work, no unacclimatised worker, light 45/15, heavy 20/40. Low (140 and above): no limit on self-paced work. Fluid per hour per Table 1. Zone boundary convention per ADR 0006. | Technical Guideline Table 1; CoP 3.2(e) | Abu Dhabi only |
| H9 | Acclimatisation | unacclimatised = new, or off more than 14 days (illness or leave); ramp 20/40/60/80/100% (new) or 50/60/80/100/100% (experienced); re-acclimatisation table by days away; hard work only after 5-7 days | CoP 3.2(b)(i); Technical Guideline section 3 and Table 1 notes | Abu Dhabi only |
| H10 | Heat programme trigger | any shift with, or foreseeably with, 35 C or more needs a heat stress programme unless TWL documents no risk | CoP 3.1.1(e) | Abu Dhabi only |
| H11 | Cooled rest and cooled shelter during breaks and the midday gap | a rest-area resource constraint per site: capacity at least the number of workers on break | CoP 3.2(b)(vii), 3.2(i); AD 19/2023 Art. 11 | Abu Dhabi and federal |
| H12 | Publish and communicate the roster | daily hours stated in work instructions (50+ workers), in a language the worker understands | Exec. Regs. Art. 14 | Federal |
| H13 | Rotating workers across different tasks (the plan's "rotation across crew members") | A worker "may not be assigned to undertake work that is fundamentally different from the work agreed upon in the employment contract, unless it is necessary in order to prevent the occurrence of an accident or to rectify the resulting damages"; otherwise only "provided that the worker provides his consent in writing." Exec. Regs. Art. 13 caps the exceptional assignment at 90 days a year. Model a per-worker `allowed_task_families` set and reject plans that rotate outside it. | Decree-Law Art. 12(1)-(2); Exec. Regs. Art. 13 (mirror) | Federal |

**Cost terms, not constraints:** a heat stop-work hour is a paid hour (Art. 26(1)); night overtime between 22:00 and 04:00 carries a 50% premium for non-shift workers (Art. 19(3)); ordinary overtime carries 25%.

**Not hard anywhere in UAE law, so do not present as "compliance":** daily rest between shifts, notice of a schedule change, a night-work ban for adults.

### 6.2 SOFT constraints (sleep, stability, crew continuity, preference)

| ID | Constraint | Default | Evidence anchor | Confidence |
|---|---|---|---|---|
| S1 | Sleep opportunity: time in bed available per night | at least **7.5 h** (7 h sleep per AASM plus about 30 min latency [I]). Compute from the shift: `next_start - commute_out - prep` minus `end + commute_home + evening_buffer`. Defaults [I]: prep 45 min, evening buffer 2 h (meals, washing, calls home), commute and bus wait from the site record. | AASM/SRS 2015; HRW testimony; Petrov 2018 | Value from consensus; buffers are [I] |
| S1x | Worked example [C] | Commute 45 min each way: minimum interval from end of work to next start = 7.5 + 0.75 + 0.75 + 0.75 + 2.0 = **11.75 h** (lands near the 11 h benchmark). Commute 90 min each way: 7.5 + 1.5 + 1.5 + 0.75 + 2.0 = **13.25 h**. A 05:30 start therefore needs work to end by 17:45 (short commute) or 16:15 (long commute). The HRW account (finish 17:00, camp 21:00, wake 04:30) leaves about 4.5 h in bed. | arithmetic on the parameters above | [C] |
| S2 | Minimum interval between end of work and next start | at least 11 h (EU WTD, HSE); S1 is usually the stricter of the two | WTD Art. 3; HSE; Vedaa 2016. Kecklund and Åkerstedt 1995 suggest "at least 16 hours" of free time between shifts in rotating systems. | Benchmark, not UAE law |
| S3 | Earliest start | penalty rising for starts before 07:00, steeper before 06:00; starts before 05:00 only with a documented reason and sign-off. Penalty weights to be calibrated. | Kecklund and Åkerstedt 1995 (5-6 h sleep if 06:00 or earlier); Tucker 1998; HSE | Direction verified; weights [I] |
| S4 | Night and early run length | consecutive starts before 06:00 or night shifts at most 3, then a rest day; switching between day and night patterns needs 2 full nights of sleep. Soft because a 6-day week cannot meet it. | HSE | Guidance, optimal count "unclear" per HSE |
| S5 | Rotation | forward only (morning, then afternoon, then night); no weekly or fortnightly rotation; fast (2-3 days) or slow (3-4 weeks) | HSE; Cochrane 2023 (very low certainty) | Low |
| S6 | Split shifts | penalise a split shift when a single-block alternative exists; price the second commute run | HSE ("Avoid split shifts unless absolutely necessary"); vendor note on second run | Medium |
| S7 | Consecutive working days | at most 6, prefer 5 | HSE "5-7 days"; van Selm 2026 (more than 5 days a week, aOR 2.19) | Low-medium |
| S8 | Crew continuity | keep the acclimatised pool: reserve at least the number of acclimatised workers each hazardous task needs; penalise moving an acclimatised worker off a hot task for more than 14 days (the expiry) | CoP 3.2(d); Table 1 notes | High for the rule, [I] for the penalty |
| S9 | Overtime | planned overtime zero in the ban season; overtime counts as heat exposure and is excluded by default | H3; Folkard and Tucker 2003 | Medium |
| S10 | Work/rest in the Low zone | none required, but allow a configurable voluntary rest cycle (no source mandates one) | Table 1 | n/a |

### 6.3 Schedule-stability metric and notice rules

The asymmetry is the key design rule: **heat-driven reductions (delay, shorten, stop, move indoors) may be made at any time, because they cut exposure and cost no sleep; advances, extensions, crew changes and start-time changes need notice.**

| ID | Metric | Definition | Proposed target [I] | Rationale |
|---|---|---|---|---|
| SS1 | Roster freeze horizon | Start times, crew composition and break windows are frozen for the next **7 days** at publication. Inside the freeze only heat-reducing changes are allowed. | 7 days | Weekly granularity: the day-specific anomaly is worth about 1-1.4 h of ramp (section 7), and weekly roster lead times sit where raw forecast skill is about climatology. |
| SS2 | Notice lead time | `L = time of effect - time of publication of the change`, for any non-reducing change | 14 days target (Oregon statute benchmark), 7 days floor; P(L >= 14 d) at least 90%, P(L < 7 d) at most 5% excluding heat-reducing changes | Park 2026 shows a dose-response with notice; Oregon statute uses 14 days |
| SS3 | Start-time drift | per crew per week: `abs(median planned start this week - median planned start last week)` | at most 30 min per change step, at most 1 step per rolling 4 weeks; larger seasonal moves announced 14 days ahead | HSE: avoid weekly rotation, "slowly, eg every 3-4 weeks"; step size under the 1-1.4 h anomaly so a step needs a persistent signal (for example 3 consecutive days of forecast shift) |
| SS4 | Plan churn | share of worker-days where the executed start or crew differs from the roster published at least 7 days earlier | at most 5%; every exception logged with a reason code (`heat_reduction`, `emergency`, `absence`, `client_change`) | Published-versus-executed is the auditable form of stability |
| SS5 | Planned wake-time variability | SD over a rolling 14 days of `start - commute_out - prep` per worker | at most 30 min | Sleep-regularity review (direction only; the review gives no threshold, so [I]) |
| SS6 | Early-start dose | count of starts before 06:00 per worker per rolling 7 days | report only at first; cap after calibration | S3, S4 |
| SS7 | Acclimatised-pool coverage | per task-hour, `acclimatised workers assigned / required` | at least 1.0 for every Medium or High zone hour | H8, H9, CoP 3.2(d) |

**Adjust-as-forecasts-update loop [I]:** (1) Season template from climatology and the legal calendar, set before 15 June. (2) Weekly roster, frozen 7 days. (3) Day-ahead plan: tasks, rest ratios, breaks inside the frozen start and end. (4) Intraday: stop-work and rest triggers from observed WBGT/TWL. The CP-SAT objective keeps the existing order (expected heat strain, then productivity) and adds sleep and stability terms between them, with a distance-to-previous-plan term for rolling-horizon re-solves.

---

## 7. Data check: what the heat looks like by hour, and how stable the ramp is [D]

Script: `docs/research/scripts/shift_hour_profile.py`; output `docs/research/scripts/results/shift_hour_profile.csv`. Data: IEM METAR archive (same source as `fetch_iem.py`), local time Asia/Dubai, **15 Jun-15 Sep of 2024, 2025 and 2026**, stations OMAA (Abu Dhabi Intl), OMDB (Dubai Intl), OMAL (Al Ain); 20,067 hourly rows. Limits: airport sensors, not worksites or camps; `WBGT0 = 0.7*Tw + 0.3*T` with Stull wet-bulb is the no-solar-load WBGT and is valid only with the sun down, so it is a lower bound near dawn and not the project's Liljegren WBGT (ADR 0006).

| Local hour | OMAA T mean / p90 (C) | OMAA wet-bulb mean (C) | OMAA WBGT0 mean / p90 (C, sun down) | OMDB T mean (C) | OMAL T mean (C) |
|---|---|---|---|---|---|
| 00 | 34.4 / 37.0 | 27.4 | 29.5 / 31.3 | 35.9 | 35.0 |
| 04 | 32.9 / 36.0 | 26.4 | 28.3 / 30.8 | 34.1 | 32.9 |
| 06 | 32.1 / 35.0 | 25.7 | n/a (sun up) | 33.4 | 32.1 |
| 08 | 33.8 / 36.0 | 25.4 | n/a | 34.8 | 34.0 |
| 10 | 38.1 / 41.0 | 25.4 | n/a | 38.4 | 37.9 |
| 12 | 41.2 / 44.0 | 25.4 | n/a | 40.8 | 41.2 |
| 15 | 41.1 / 44.4 | 26.7 | n/a | 40.1 | 43.8 |
| 20 | 36.2 / 39.0 | 27.8 | 30.3 / 31.9 | 37.3 | 39.0 |
| 22 | 35.2 / 38.0 | 27.8 | 30.0 / 31.8 | 36.7 | 36.6 |

**Findings**
- **Nights never cool.** Overnight (22:00-05:59) minimum temperature is 25 C or higher on 100% of nights at all three stations, and 30 C or higher on 95% (OMAA), 99% (OMDB), 89% (OMAL). The median overnight minimum is 32.0 C (OMAA), 34.0 C (OMDB), 32.0 C (OMAL). The Raja 2026 review links night-time temperatures above 25 C to reduced sleep efficiency. Accommodation without air conditioning cannot support the 7 h target at any roster.
- **Wet-bulb barely moves through the day** (OMAA 25.4-27.8 C), so earlier starts reduce exposure through dry-bulb and sun, not humidity. At 04:00 the no-sun WBGT0 already averages 28.3 C.
- **The ramp is predictable.** Mean rise 08:00 to 11:00 is 2.0 C/h (OMAA), 1.7 (OMDB), 1.9 (OMAL). The first hour at 38 C or above is 10:00 (median) at all three stations, within plus or minus 1 h on **83% (OMAA), 82% (OMDB), 75% (OMAL)** of 270-274 days each. Day-to-day SD of temperature around the hourly mean is 2.0, 2.0 and 2.6 C (08:00-11:00), worth **1.0, 1.1 and 1.4 h of ramp**.
- **Forecast comparison [C].** Raw IFS temperature RMSE in `results/baseline_errors_pooled.csv` is 2.06-2.38 C at 1 day and 2.66-3.13 C at 7 days (all hours, 8 stations, three summers). Different sample from the table above, so this is an order-of-magnitude comparison, not a skill score. The corrector (ADR 0007) may change it; re-test once it exists.

---

## 8. UNOBTAINABLE items and what to confirm

| Item | Why it matters | How to resolve |
|---|---|---|
| Official text of Decree-Law 33/2021 and Cabinet Resolution 1/2022 (uaelegislation.gov.ae 403, government.ae TLS mismatch, mohre.gov.ae unreachable) | I read an unofficial FAOLEX translation (2023) and a legal-notes mirror; wording may differ from the Arabic original, and there may be amendments after mid-2023 beyond Art. 54 | Ask MoHRE or counsel for the consolidated text; re-fetch when the portals respond |
| Whether the midday ban window counts as the Art. 18 break, and whether a 06:00-12:30 block needs a break inside | Decides whether a 6.5 h morning block is legal | MoHRE inspection guidance or counsel |
| Whether changing shift start times is a contract variation needing worker consent | No notice rule exists, but hours are a contract term (Exec. Regs. Art. 10(1)) | Counsel; check the client's contract templates |
| Whether MR 44/2022 Art. 3 survives MR 122/2026 | Legal basis for the ban | Read MR 122/2026 on MoHRE |
| Whether the "eight hours across morning and evening shifts" sentence is still MoHRE policy (absent from the 2026 release) | Hard constraint H2 in the ban season | MoHRE or counsel |
| Measured sleep of Gulf labour-camp workers | Would calibrate S1 buffers and S3 weights | Pilot with a client site: sleep diary or wearable, with consent |
| Typical contractor rosters in the UAE | Would validate the split-shift templates | Interview two or three contractors; or the client's own timesheets |
| ADPHC "online Thermal Work Limit calculator" URL (blank in the PDF) | Cross-check of the TWL port | Already tracked in ADR 0006 |
| Whether the ramp-day workload (20-80%) is allowed only in the Low TWL zone | Section 3 inference | ADPHC |

## 9. Sources (all accessed 2026-11-11)

Primary or primary-equivalent: FAOLEX Decree-Law PDF; WAM releases (2023, 2026); Ministerial Resolution 44/2022 and Administrative Decision 19/2023 (Wayback copies of the u.ae PDFs); ADPHC CoP 11.0 and Technical Guideline PDFs; EUR-Lex Directives 2003/88/EC and 2019/1152; HSE HSG256; AASM/SRS statement PDF; PubMed records for PMIDs 37694838, 26072668, 12637593, 10607211, 9684216, 41259946, 42536410, 41680965, 42920703, 42561787, 33745159, 14564876, 29338957, 40965743, 31051037, 32219304, 31308288, 37068948 (abstracts via NCBI E-utilities). Testimony: HRW 2023 and 2026 pages. Secondary: legal-notes mirror of Cabinet Resolution 1/2022; u.ae and Oregon BOLI pages and vendor and news pages via WebFetch; Clyde & Co note; Vital Signs Partnership report.

EUR-Lex Directive 2019/1152 Art. 10 (read, no number) says only that a worker with an unpredictable pattern must be informed "within a reasonable notice period established in accordance with national law, collective agreements or practice"; it gives no days, which is why the Oregon 14-day figure is the numeric benchmark.
