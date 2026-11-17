# Claims verification: Challenge 07 plan (Stellar Blaze)

**Date accessed for every source below: 2026-11-11.** Scope: the unverified regulatory and source claims in `docs/context/challenge-07-plan.md` (Part A facts F1-F9, Part B assumptions, Part E6) and `docs/context/competition-brief.md`.

**How to read this file.**
- Status is one of VERIFIED / PARTLY / WRONG / UNOBTAINABLE.
- A quote marked **[exact]** was copied from a file or a rendered page I read in full (PDF text layer, browser DOM). A quote marked **[fetch-tool]** came back from the WebFetch summariser, which can paraphrase, so re-check it before putting it in the submission. A **[secondary]** source is not the originating authority.
- Evidence beat the plan's framing in items 3, 8 and 9, and item 11 carries a registration-closed flag. See the summary table and the consolidated corrections at the end.

## Summary

| # | Claim | Status | One-line result |
|---|---|---|---|
| 1 | Midday ban 12:30-15:00, 15 Jun-15 Sep, 2026 | VERIFIED | Matches WAM (MoHRE release, 8 Jun 2026). No change to dates or hours. MoHRE's own site is unreachable from here. |
| 2 | ADOSH-SF CoP 11.0 v4.0 July 2024 uses TWL; text downloadable | VERIFIED | Both PDFs are public. The three TWL zones (140 / 115) and their actions are in Table 1 of the Technical Guideline. |
| 3 | TWL has "no open formula" (F1) | **WRONG as stated** | Equations are published (Brake & Bates 2002, Appendix 1; closed-access paper). An MIT-licensed R implementation exists and reproduces independent published values to within +6.5 W/m2. |
| 4 | DoH Responsible AI Standard cl. 3.1.4.5.1 requires in-UAE compute and storage | VERIFIED | Clause text confirmed. Scope is DoH and licensed healthcare entities, so it does not cover an employer tool by its terms. |
| 5 | PDPL: health data sensitive; employer exceptions; exec regs | VERIFIED (exec-regs status secondary) | Primary text read. Health data is also carved out of the PDPL when other legislation governs it. Executive regulations not issued as of Sep 2026 (law-firm sources). |
| 6 | NIOSH 2016 RAL/REL equations and acclimatisation | VERIFIED | Equations match the plan exactly. NIOSH Table 3-2 supplies the clothing adjustments the plan still lacked. |
| 7 | ACSM EHI consensus citation and actions | PARTLY | Citation and abstract verified. Full text is paywalled (UNOBTAINABLE), so no ACSM clinical wording is quoted. Corroborated by an open UK consensus and by the ADOSH first-aid text. |
| 8 | Landsat C2 L2 ST: licence, overpass | PARTLY | Licence VERIFIED (public domain / no restrictions). Overpass over Abu Dhabi is about 10:46-10:58 local, not "about 10:00". Native thermal resolution is 100 m, not 30 m. |
| 9 | WeatherNext 3 terms | PARTLY | Access form and 5-7 business days VERIFIED. Historic data is CC BY 4.0 (not non-commercial-only). The disclaimer is stronger than the plan's paraphrase. |
| 10 | EGA / Kenzen pilot | VERIFIED | 2022: 50 volunteers. 2023: 350. 2024: about 300. Source is EGA's own press releases. |
| 11 | Hack2skill rules: data, LLM use, IP | PARTLY | Data and IP clauses VERIFIED live. No public rule on LLM use (UNOBTAINABLE). **The live page now says "Registration Closed".** |

## Fetch log: what blocked me, and what I did instead

No TLS or certificate check was bypassed anywhere. No git command was run.

| Site | What happened | Handling |
|---|---|---|
| `www.doh.gov.ae` | TLS handshake failed intermittently (schannel "failed to receive handshake"). The Responsible AI Standard PDF downloaded on a successful handshake. A separate `openssl s_client` probe reported `Verify return code: 0 (ok)`. Later retries of the listing pages all failed. | Used the PDF fetched on the valid handshake. Could not re-check DoH listing pages for a V2, so I used a web search instead (no V2 found). Item 4 is therefore primary text plus secondary currency check. |
| `www.mohre.gov.ae` | Connection timeout / ECONNREFUSED from curl and WebFetch. | Used WAM (UAE state news agency), which carries the MoHRE release verbatim. |
| `usgs.gov` pages | CloudFront 403 for curl. 504 or empty via WebFetch and the browser. | Used the AWS Open Data registry mirror and the Planetary Computer STAC licence link (both secondary). |
| `cdc.gov` | 403 for curl. | WebFetch downloaded the NIOSH PDF; I read its text layer directly. |
| `journals.lww.com`, `researchgate.net`, `pmc.ncbi.nlm.nih.gov` | 402 / 403 / reCAPTCHA. | Not bypassed. ACSM full text recorded as UNOBTAINABLE. |
| `elaws.moj.gov.ae`, `uaelegislation.gov.ae/en/legislations/1209` | Timeout / QUIC error. | Federal Law 2/2019 checked via secondary sources only (see item 5). |
| `tandfonline.com` | 403 (paywall). | Brake & Bates 2002 abstract via PubMed E-utilities. Full text not read. |

---

## 1. UAE midday work ban, 2026

**Status: VERIFIED** (via WAM, the UAE state news agency; MoHRE's site itself was unreachable).

**Quotes** [exact, WAM article rendered in a browser, dated "Monday, June 8, 2026 5:17PM"]:

> "The Ministry of Human Resources and Emiratisation (MoHRE) has announced the return of the Occupational Heat Stress Prevention Policy for the 22nd consecutive year, effective from 15th June until 15th September 2026."

> "During this period, work under direct sunlight and in open areas will be prohibited daily from 12:30 pm until 3:00 pm."

> "...certain activities are exempt where work must continue uninterrupted for technical reasons, including asphalt laying and concrete pouring works where interruption or postponement is not feasible. Exemptions also apply to work necessary to prevent hazards or repair faults affecting the wider community, such as interruptions to water supply lines, electricity services, traffic movement, and other essential public services."

> "Employers must also provide appropriate cooling equipment, such as fans, adequate supplies of drinking water, hydration supplements including salts and other locally approved products, as well as adequate comfort facilities and first-aid equipment at work sites."

The same WAM page lists the 2025 release in its "Related news" panel [exact]: "...prohibiting work under direct sunlight and in open-air spaces between 12:30 pm and 3:00 pm, from 15 June to 15 September 2025." So hours and dates are unchanged year on year.

**URLs**
- https://www.wam.ae/en/article/c0memda-mohre-announces-return-occupational-heat-stress (primary-equivalent; JavaScript-rendered, so a plain HTTP fetch returns an empty shell)
- Corroboration [fetch-tool]: https://www.thenationalnews.com/news/uae/2026/06/04/midday-break-for-outdoor-workers-to-begin-on-june-15/ (4 Jun 2026); https://gulfnews.com/uae/government/midday-outdoor-work-ban-returns-across-uae-for-22nd-year-1.500567381 (8 Jun 2026); https://www.khaleejtimes.com/uae/heat-annual-midday-break-policy-ends-september-15 (published 15 Sep 2026, confirming the policy ended that day).

**2026 changes.** None to dates or hours. The 2026 release adds the exemption detail and the hydration-salts wording above. Delivery-rider provisions were reported in July 2026 (Khaleej Times, [fetch-tool]: "Delivery on foot is prohibited from 12.30pm to 3pm", "Riders must not be assigned more than three delivery orders"), but I found no source saying whether these are new in 2026. Rest-station numbers rose from "more than 10,000" (2025) to 12,000+ (2026) per secondary reports.

**Fines.** The WAM text states none. Secondary sources say Dh5,000 per worker, up to Dh50,000 (Khaleej Times headline), and one older Gulf News piece says Dh15,000. These conflict, so do not cite a fine figure in the submission. Legal basis (secondary, Gulf Business): Ministerial Resolution No. 44 of 2022. Not verified from primary text.

**Implication for the build**
- F2 stands as written. The 2026 ban **ended on 15 Sep 2026**, so the "ban-only baseline" is a replay of 2024-2026 summers, or a forecast for 2027. Make the ban window configuration (start date, end date, start time, end time) with effective dates, not a constant. The 2027 announcement does not exist yet.
- The Abu Dhabi code makes the ban binding on employers: CoP 11.0 cl. 3.1.1(g) (item 2).
- Report the exempt-work categories (asphalt, concrete, utility repair) in the supervisor view. A fixed "no work 12:30-15:00" rule would be wrong for those crews, and they are the highest-risk ones.

---

## 2. ADOSH-SF CoP 11.0 "Safety in the Heat" and the Technical Guideline

**Status: VERIFIED.** The code and its Technical Guideline are public PDFs, and both use TWL. The plan's F1 about the 35 °C trigger and 5-7 days is correct, with one qualification on each (below).

**Current version.** The ADPHC Codes of Practice listing page (accessed today) shows: "11.0 / Safety in the Heat / V 4.0 / 15 July 2024". The PDF cover reads [exact] "CoP 11.0 - Safety in the Heat / Version 4.0 / July 2024". The file name says `v31`, but the content is v4.0. The listing also links at least one file under a `2026/` folder (the asbestos code, v4.1), so ADPHC does publish revisions; none is listed for CoP 11.0.

**URLs (downloadable, no login)**
- CoP 11.0 (English): https://www.adphc.gov.ae/-/media/Project/ADPHC/ADPHC/PDF/OSHAD-SF/Codes-of-Practise/11---Safety-in-the-Heat-v31-English.pdf (12 pages; PDF creation date 4 Jul 2024)
- CoP 11.0 (Arabic): same path, `...-v31-Arabic.pdf`
- Technical Guideline "Safety in the Heat" v4.0, 24 pages: https://www.adphc.gov.ae/-/media/Project/ADPHC/ADPHC/PDF/OSHAD-SF/Technical-Guidelines/Safety-in-the-Heat--Eng.pdf
- Listing page: https://www.adphc.gov.ae/en/Legislation/Code-of-Practices

**Quotes from the CoP** [exact]
- cl. 3.1.1(e): "Any worksite that has, or it is reasonably foreseeable to have, a temperature at or above 35 degrees Celsius at any time during a work shift, shall implement an effective heat stress program, unless they can document through risk assessments and Thermal Work Limit (TWL) that there is no risk to employees."
- cl. 3.1.1(f): "Employer shall implement a process for assessing the environmental conditions and comparing it to the TWL heat stress index and implementation of the requirements of the relevant work zone control measures..."
- cl. 3.1.1(g): "Employers shall ensure worksites adhere to the UAE Ministry of Labour requirements for a midday break during the summer months for employees working outside."
- cl. 3.2(b)(i): "acclimatization program for new employees, employees that have been on vacation, and employees that are moving from a worksite that has climate control to a worksite that has high temperatures with an allowance of 5-7 days for acclimatization before starting hard work in a hot environment;"
- cl. 3.2(b)(ii): "process for assessing environmental conditions utilizing the Thermal Work Limit (TWL) to determine work/rest breaks and water consumption requirements for employees..."
- cl. 3.2(b)(iii): "system to communicate current environmental conditions to employees so they can take the appropriate control measures to prevent heat stress injuries and illnesses;"
- cl. 3.2(e): "Employees shall not work alone in heat stress areas..."
- cl. 3.2(b)(viii): "process for scheduling physical activities in the summer months during the coolest part of the day to the extent reasonably practicable;"
- cl. 4(a)(v): records of "heat stress related incidents" must be kept.

**Qualifications to F1.** (1) The 35 °C trigger has an exit: an employer can document "through risk assessments and Thermal Work Limit (TWL) that there is no risk". (2) The "5-7 days" is an "allowance ... before starting hard work", and the Technical Guideline §5.1 adds [exact] "It takes over two weeks to become fully acclimatized; however adaptation is rapid in the first few days."

**Quotes from the Technical Guideline** [exact]
- §2.1(a): "The Thermal Work Limit (TWL), which has been validated for Gulf conditions, is the heat stress index that has been researched and adopted by within the Emirate of Abu Dhabi to enable safe management of work in heat."
- §2.1(b): "TWL, measured in watts per square meter (W/m2), is the maximum rate at which heat can be lost to the environment in the conditions. TWL is calculated from environmental parameters assuming that employees are well hydrated and acclimatized to the conditions and are self-paced."
- §2.2(a): the inputs are dry bulb, wet bulb, globe temperature (degrees C) and wind speed (m/s).
- §2.2(c): "...individual readings entered into the online Thermal Work Limit calculator available at:  to calculate the overall TWL heat stress index result and working zone." The URL is **blank in the PDF** (text layer and rendered page 4 both show nothing).

**Table 1 (page 5, image, read from the rendered page).** "Thermal Work Limit - Working Zones: Control Interventions, Rest-Work and Rehydration Schedules"

| Zone | TWL (W/m2) | Interventions (as printed) | Rehydration per hour | Work-rest (minutes) |
|---|---|---|---|---|
| Low Risk, Unrestricted | "140 - 220 <" | "No limits on self-paced work for educated, hydrated workers." | Light work: 600 ml - 1 litre | Safe for all continuous self-paced work |
| Medium Risk, Cautionary | "115 - 140" | "Practicable engineering control measures..."; "Working alone to be avoided"; "No unacclimatised person to work"; "Ensure adequate fluid intakes appropriate for type of work" | Light: 1 - 1.2 L; heavy: > 1.2 L | Light: safe for continuous self-paced work. Heavy: "Continuous paced work 45 work - 15 rest" |
| High Risk | "< 115" | "Strict Work/Rest cycling required"; "No person to work alone"; "No unacclimatised person to work"; "High Risk induction required emphasising hydration and identifying signs of heat strain"; "Provide personal water bottle (2 litre capacity) on-site at all times" | All work: > 1.2 L | Light: 45 work - 15 rest. Heavy: 20 work - 40 rest |

Footnotes as printed: "Unacclimatised workers are defined as new workers or those who have been off work for more than 14 days due to illness or vacation leave (in a cool climate area)". Light work is "sitting or standing, light arm work". Heavy work is "carrying, climbing, lifting, pushing, whole-body work". "Self-paced work - workers must be allowed to adjust their work rate according to environmental conditions."

**Acclimatisation table (§3, exact values).** New employee: day 1 20%, day 2 40%, day 3 60%, day 4 80%, day 5 100%. Experienced employee: 50%, 60%, 80%, 100%, 100%. Re-acclimatisation by days away is also tabulated ("Table used courtesy of the National Safety Council"). These match the NIOSH ramp (item 6).

**Heat-stroke first aid in the guideline (§4.5(c), exact):** "(i) Call emergency contact number and notify supervisor; (ii) Move the sick employee to a cool shaded area; (iii) Cool the employee using methods such as: soaking their clothes with water; spraying, sponging, or showering them with water; and fanning their body." Note the sequence is **call, then move, then cool**. It does not mention cold-water immersion (see item 7).

**Wikipedia disagrees with the primary source.** Wikipedia's TWL page labels 140-220 an "Acclimatization Zone" and ">220" the "Unrestricted Zone". The ADPHC Table 1 above calls 140-220+ the "Low Risk Unrestricted Zone". Use ADPHC.

**ADPHC heat programme pages (found)**
- https://www.adphc.gov.ae/en/Public-Health-Programs/Injury-Prevention/Safety-in-Heat : annual "Safety in Heat" programme. Awareness materials in Arabic and English; roll-ups in **Arabic, English, Urdu, Hindi, Bengali, Tagalog**; a bilingual "Thermal Work Limit" PDF at `.../Safety-in-Heat/Ther-Bi.pdf` (12.4 MB; my download timed out, so I did not read it).
- https://www.adphc.gov.ae/en/Media-Center/News/Shl : programme relaunch news, 15 Jun 2022.

**Implication for the build**
- The regulator's own control table is keyed to TWL (140 / 115 W/m2). Mapping WBGT bands to those zones would be a guess (item 3 shows TWL can be computed instead).
- Keep ADOSH's three zones as the regulatory layer in the policy engine, with every action traced to Table 1 or a CoP clause. Our four probability levels (Green/Amber/Orange/Red) become an overlay and need an explicit mapping to the three zones. They are not 1:1.
- Hard rules the engine must encode from the primary text: no unacclimatised person works in the Medium or High zones; no lone work in either; "unacclimatised" means new or away more than 14 days; the work/rest and litres/hour values in Table 1.
- CoP 3.2(b)(iii) ("system to communicate current environmental conditions to employees") is a direct regulatory hook for the worker-alert feature. Cite it in the deck.
- A5 (languages): ADPHC itself issues roll-ups in Arabic, English, Urdu, Hindi, Bengali and Tagalog. The plan's six languages overlap on five; Nepali is not in ADPHC's set and Tagalog is. Do not copy ADPHC materials without checking their licence. Use them only as a cross-check.

---

## 3. TWL method: original paper, equations, open-source implementations

**Status: WRONG as stated** (plan F1: "TWL has **no open formula** we could find"; plan non-goal: "No invented TWL formula"). The equations are published. The free full text is UNOBTAINABLE. An open-source implementation exists.

**Original paper.** Brake DJ, Bates GP. "Limiting metabolic rate (thermal work limit) as an index of thermal stress." *Applied Occupational and Environmental Hygiene* 2002;17(3):176-186. doi:10.1080/104732202753438261. PMID 11871754 (confirmed via PubMed E-utilities and Crossref/OpenAlex metadata). OpenAlex reports `is_oa: false`, `oa_status: closed`, with no repository full text. Taylor & Francis returned 403, so I did not read the paper.

**Abstract** [exact, PubMed]: "TWL is defined as the limiting (or maximum) sustainable metabolic rate that euhydrated, acclimatized individuals can maintain in a specific thermal environment, within a safe deep body core temperature (< 38.20 degrees C) and sweat rate (< 1.2 kg/hr(-1)). The index has been developed using published experimental studies of human heat transfer, and established heat and moisture transfer equations through clothing. Clothing parameters can be varied and the protocol can be extended to unacclimatized workers."

**Where the equations are.** The MIT-licensed code below cites "Brake & Bates (2002), Appendix 1 / Figure 3" for the evaporation model and "Table 1 ... p. 181" for validation values. That is the author's attribution; I could not confirm it against the paper. Miller & Bates (2007, *Ann Occup Hyg* 51(6):553-561, doi:10.1093/annhyg/mem035; free PDF at https://www.hqinc.net/wp-content/uploads/2012/05/ANNOHBatesThermalWorkLimitWBGT2007.pdf) gives only the inputs [exact]: "TWL uses five environmental parameters (dry bulb, wet bulb and globe temperatures, wind speed and atmospheric pressure) and accommodates for clothing factors to arrive at a prediction of a safe maximum continuously sustainable metabolic rate (W m-2)". It does not print the equations.

**Open-source implementation found:** https://github.com/vorpalvorpal/meteoHazard (R package; `generate_twl()` calls `solve_twl_single()`).
- Licence: `License: MIT + file LICENSE` (copyright holder "TWL authors", 2026).
- Maintenance signals: single maintainer, 0 stars, created 2026-01-28, last push 2026-09-29, version 0.4.0. Its `DESCRIPTION` cites the wrong DOI (`10.1080/104732202317070947`; the real one is `...753438261`). Its source also notes the paper's published Zone B formula has a typo ("1.8x-0.46" vs "x-0.46") that the author corrected. Treat it as a reference implementation to cross-check, not a vetted library.
- The tests compare against "Table 1 from Brake & Bates (2002), p. 181" with 5 W/m2 tolerance on 58 cases and 14 W/m2 on four extreme low-humidity cases. I could not check the author's transcription of that table.
- Inputs it needs: air temperature, wind speed, RH or dew point, pressure, mean radiant temperature. Wet-bulb and globe temperature are accepted but **unused** in the heat balance. That fits forecast data (T, Td, wind, pressure, plus MRT from solar radiation).
- No other open implementation found: GitHub repository search returned eight "thermal work limit" README hits, of which only `meteoHazard` implements it. A thermalpulse-uae README mentions an "Abu Dhabi OSHAD TWL Calculator" but I did not find its code. `pythermalcomfort` 4.8.1 (PyPI summary) does not list TWL.

**My independent check (throwaway port, not in the repo).** I ported `solve_twl_single` to Python (bisection on skin temperature; constants as in the repo defaults: LR 16.5, lambda 2430 kJ/kg, core limit 38.2 C, max sweat rate 0.67 kg/m2/h) and ran it against 11 published TWL values from Miller & Bates 2007 Table 2 (chamber, 0.12 clo, sea-level pressure 101.3 kPa, MRT assumed = dry bulb; the paper does not print vapour permeability `icl`):

| Setting | Mean diff vs published | Max abs diff | Notes |
|---|---|---|---|
| `icl` = 0.45 (repo default, set before looking at the data) | **+5.7 W/m2** | 6.5 | 11/11 within 6.5; rank order correct; consistent positive bias |
| `icl` = 0.38 (tried afterwards) | +2.1 | 3.1 | A fitted value, so this is **not** independent validation |

Four spot checks against the repo's own Table 1 values were within 3 W/m2 (port 177.1 vs 175; 115.5 vs 114; 124.6 vs 125; 131.3 vs 134). The zone edges are 25 W/m2 apart, so an error of about +6 W/m2 can misplace a reading that sits near 115 or 140.

**Other evidence on TWL itself.** Bernard, Ashley, Kapanowski, *Ann Work Expo Health* 2022;66(8):1081-1085, doi:10.1093/annweh/wxac029 [fetch-tool]: "the TWL was less restrictive than WBGT but with higher risk"; the authors report TWL specificity of about 0.15-0.22 and say it "requires a higher level of risk acceptance than the WBGT method". That paper does not publish the TWL equation or name a source; it says only that TWL "is integrated into a commercial heat stress monitor". So Abu Dhabi has adopted an index whose method sits in a paywalled paper and commercial instruments.

**Implication for the build**
- Replace the non-goal "No invented TWL formula" with: "TWL implemented from the published Brake & Bates algorithm, cross-checked against published values, labelled *aligned with ADOSH TWL zones, not the certified calculator*." Do not call it "ADOSH-compliant".
- Before claiming a faithful implementation, read Appendix 1 of the 2002 paper (paywalled; a one-off purchase or inter-library loan). Until then, state it as "implementation ported from an MIT-licensed R reference, validated within +6.5 W/m2 on 11 published values".
- Wind needs care: TWL expects wind at body level, and the R code scales 10 m wind to 1 m with a log profile (factor 0.667 at z0 = 0.01 m). Take MRT from thermofeel's mean-radiant-temperature routine and keep Liljegren WBGT as the second physics layer.
- Report both indices side by side in the back-test; the literature says they disagree (TWL is less conservative).
- Add the licence line for the reference code to the data/dependency declaration the organisers require.

---

## 4. DoH Abu Dhabi Responsible AI Standard

**Status: VERIFIED** for the clause text. **Scope: answered** (the formal scope is narrower than the plan's open question assumed).

**Document** [exact, cover page]: "Responsible Artificial Intelligence (AI) Standard", "Document Ref. Number: DoH/ST/DDGO/RAI/V1/2025", "Version: V1", "Publication Date: Oct 2025", "Effective Date: Oct 2025", "Revision Date: Oct 2026", "Revision Period: One year", contact "DDG@doh.gov.ae".
URL: https://www.doh.gov.ae/-/media/Feature/Resources/Standards/2025/Responsible-AI-Standard-V1.ashx (PDF, 490 KB, retrieved on a valid TLS handshake; see fetch log).

**Clause 3.1.4.5.1** [exact]: "3.1.4.5 Infrastructure Security and Sovereignty. 3.1.4.5.1 The compute and storage infrastructure of AI systems for both active and disaster recovery sites must be situated within the UAE. Additionally, remote access for development and support teams should be exclusively from within the UAE."

The plan's reference to "cl. 3.1.4.5.1" is correct. Note the second sentence: remote access for development and support "should be exclusively from within the UAE". A developer working from outside the UAE on a production system would be out of line with it.

**Scope** [exact]:
- Cl. 1.2: "The standard applies to the DoH and all licensed healthcare entities within the Emirate of Abu Dhabi that are engaged in the development, procurement, or deployment of artificial intelligence (AI) systems. It pertains to AI-enabled tools, devices, datasets, agents, platforms employed for clinical, financial, administrative and other related functions. It applies to AI systems developed internally, sourced from third-party vendors, or created through research collaborations..."
- Cl. 2.1 defines "Abu Dhabi Healthcare Ecosystem" as "Organizations, institutions, and stakeholders involved in delivering, managing, regulating, or supporting healthcare services, regulated by DoH. This includes healthcare providers, hospitals, clinics, research institutions, and any affiliated organizations that contribute to or interact with healthcare data, digital health services, and patient care within Abu Dhabi."
- Cl. 6.1: "DoH may impose sanctions in relation to any breach ... in accordance with the Disciplinary Regulations of the Abu Dhabi Healthcare Sector governed by the UAE federal laws."

**Answer to the E6 open item.** By its terms the Standard binds DoH and DoH-licensed healthcare entities. An employer-deployed heat-warning tool is not named. The broad definition in cl. 2.1 ("affiliated organizations that ... interact with healthcare data") and cl. 1.2 ("sourced from third-party vendors") would pull the tool in the moment it is procured by, or feeds data to, a DoH-licensed entity (for example an occupational-health clinic or a hospital). Treat it as a design rule, as the plan already does, and state the scope accurately.

**Currency.** The document sets its own revision date as Oct 2026. A web search found no V2 and no 2026 revision of the Standard (DoH published a separate "AI Clinician Framework" on 21 Oct 2026, per WAM; that is not a revision). I could not re-open DoH's listing pages to confirm (TLS failures), so "no V2" rests on search results.

**Other clauses worth citing** [exact]: 3.1.1.2.1 "AI systems shall incorporate human-in-the-loop or human-on-the-loop mechanisms..."; 3.1.1.2.2 "AI systems must always function under human oversight. Clear escalation protocols shall be established..."; 3.1.4.4.3 "All AI systems must incorporate data anonymization, differential privacy, secure multi-party computation, and federate learning into system architectures..." (the last applies only to in-scope entities; the plan's architecture does not include differential privacy, secure multi-party computation or federated learning, so say so if the Standard is used as a benchmark).

**Implication for the build**
- Keep the self-hosted model plan (Gemma / Qwen on in-UAE GPUs) as the production path. The demo uses synthetic data only, so cl. 3.1.4.5.1 does not bind the prototype, but the architecture document should say where production compute and storage would sit.
- In the technical document, write "the Standard formally applies to DoH and licensed healthcare entities; we apply it as a design benchmark", not "we comply with it".
- The plan's governance layer maps onto 3.1.1.2 (human oversight) cleanly; cite those clauses next to the policy engine.

---

## 5. UAE PDPL (Federal Decree-Law 45 of 2021)

**Status: VERIFIED** from the primary text (UAE Legislation portal, "The site was last updated on: 11/11/2026"). The executive-regulations status rests on secondary sources.

URL: https://uaelegislation.gov.ae/en/legislations/1972 (rendered in a browser; curl gets a 403).

**Health data is sensitive** [exact, Art. 1]: "Sensitive Personal Data: Any data which directly or indirectly reveals a natural person's family, ethnic origin, political or philosophical opinions, religious beliefs, criminal record, biometric data, or any data relating to such person's health and physical, psychological, mental, genetic or sexual condition, including information related to the provision of healthcare services to him/her which reveals his/her health status"

**Carve-out you did not list** [exact, Art. 2(2)]: "Provisions of this Decree by Law shall not apply to the following: ... e. Personal Health Data that has legislation regulating its protection and processing. ... g. Companies and establishments located in free zones in the Country and have special legislations regarding Personal Data protection." (The preamble lists Federal Law No. 2 of 2019 on ICT in the Health Fields.)

**Employer / occupational exceptions** [exact, Art. 4, "It is prohibited to process Personal Data without the consent of its owner. The following cases shall be excluded from such prohibition:"]:
- 4(4): "If the processing is necessary for purposes of occupational or preventive medicine in order to assess the employees' ability of to work, performing medical diagnosis, providing health or social care, treatment or health insurance services, managing health or social care systems and services in accordance with the legislation in force in the State."
- 4(8): "If the processing is necessary for the purposes of the Controller or Data Subject carrying out their obligations and exercising their legally established rights in the field of employment, social security or laws concerned with social protection, to the extent permitted by such Laws."
- 4(11): "Any other cases set out in the Executive Regulations of this Decree by Law."

So the plan's E3 statement, "The PDPL even lets employers skip consent for 'employment rights' purposes", is accurate (Art. 4(8), and 4(4) for occupational medicine). Art. 5(3) also requires data to be "sufficient and limited to what is necessary".

**Executive regulations.** Art. 28 [exact]: "The Council of Ministers ... shall issue the Executive Regulations of this Decree by Law within six (6) months as of the date on which the Decree by Law is promulgated." Art. 29 gives six months from issue to regularise. Art. 31 [exact]: "...shall come into force as of 02 January 2022." Whether the regulations have since been issued: **not issued** as of the latest reviews I found:
- Al Tamimi & Company, "UAE Establishes New Federal Authority for AI and Data", edited 1 Sep 2026 [exact, browser-rendered]: "Although the UAE PDPL came into force on 2 January 2022, at the time of writing, Executive Regulations have not yet been issued." The same piece reports that on 14 Jun 2026 the UAE announced a new Artificial Intelligence and Data Authority that consolidates the UAE Data Office, among other bodies. URL: https://www.tamimi.com/law_update_articles/uae-establishes-new-federal-authority-for-ai-and-data-a-significant-step-in-the-evolution-of-digital-regulation/ [secondary]
- Chambers Data Protection & Privacy 2026, updated 10 Mar 2026 [fetch-tool, secondary]: "The Implementing Regulations, intended to clarify key aspects of the law, have yet to be issued." URL: https://practiceguides.chambers.com/practice-guides/data-protection-privacy-2026/uae/trends-and-developments/O24528
- Three commercial blogs (itsecnow, promptquorum, jservo) claim the regulations were issued in 2026. None cites an official instrument; I discount them. A negative cannot be proven from the portal text, so check the portal again before submission.

**Health-data localisation (Federal Law 2/2019), secondary only.** Chambers (updated 10 Mar 2026) [fetch-tool]: Law 2/2019 says health information "may not be stored, processed, generated or transferred outside the UAE" without a Health Authority decision. The English translation hosted by Emirates Health Services quotes Art. 13 as "The health information and data related to the health services provided in the State may only be stored, processed, generated or transferred outside the State in the cases prescribed by virtue of a decision issued by the Health Authority in coordination with the Ministry" (via search excerpt) and a fine of AED 500,000-700,000. I could not open the primary text (timeouts). Whether Law 2/2019 reaches a non-healthcare employer's tool was not checked.

**Implication for the build**
- Say in the documentation that the PDPL is in force but its executive regulations were not issued as of Sep 2026, so consent mechanics and penalties rest on the statute text and sector rules.
- For individual health signals, the operative regime may be Law 2/2019 rather than the PDPL (Art. 2(2)(e)). The architecture (on-device personal risk, no employer path) is stricter than both and holds either way. Do not claim "PDPL compliant"; claim "designed to exceed PDPL Art. 5 and Art. 4(4)/(8) minimums", and name Law 2/2019 as the likely governing law for health data.
- The "go stricter than the law on purpose" slide is supported by the text of Art. 4(4) and 4(8).

---

## 6. NIOSH 2016 Criteria for a Recommended Standard

**Status: VERIFIED.** The plan's equations match the document exactly.

Source: "Criteria for a Recommended Standard: Occupational Exposure to Heat and Hot Environments, Revised Criteria 2016", Jacklitsch B, Williams WJ, Musolin K, Coca A, Kim J-H, Turner N. DHHS (NIOSH) Publication No. 2016-106. 192 pages. The document states [exact] "This document is in the public domain and may be freely copied or reprinted."
URL: https://www.cdc.gov/niosh/docs/2016-106/pdfs/2016-106.pdf (PDF retrieved via WebFetch; text layer read in full).

**Equations** [exact, Chapter 8.1, printed page 93]: "The RALs and RELs are represented by the following equations, where M represents the metabolic rate in Watts (W):
RAL [C-WBGT] = 59.9 - 14.1 log10 M [W]
REL [C-WBGT] = 56.7 - 11.5 log10 M [W]"

**Which is which** [exact, same page]: "The total heat exposure to unacclimatized workers should be controlled so that unprotected healthy workers are not exposed to combinations of metabolic and environmental heat greater than the applicable RALs; see Figure 8-1. The total heat exposure to acclimatized workers should be controlled so that unprotected healthy workers are not exposed to combinations of metabolic and environmental heat greater than the applicable RELs; see Figure 8-2." RAL = unacclimatised, REL = acclimatised, as the plan has it. The limits "take work/rest schedules into consideration so are shown for 60, 45, 30, and 15 minute time periods of work".

**Acclimatisation** [exact, the "Acclimatization plan" table and again in the prevention text]: "Gradually increase exposure time in hot environmental conditions over a period of 7 to 14 days." "For new workers, the schedule should be no more than 20% of the usual duration of work in the hot environment on day 1 and a no more than 20% increase on each additional day." "For workers who have had previous experience with the job, the acclimatization regimen should be no more than 50% of the usual duration of work in the hot environment on day 1, 60% on day 2, 80% on day 3, and 100% on day 4."

**Clothing adjustments (answers the plan's "not yet verified" item in 8.2).** Table 3-2, "Clothing adjustment factors for types of clothing" (C-WBGT; adapted from ACGIH/Bernard 2014): work clothing 0 / 0; cloth coveralls 3.5 (previous) / 0 (2006); double-layer cloth 5 / 3; SMS coveralls "-" / 0.5; polyolefin coveralls "-" / 1; limited-use vapor-barrier coveralls "-" / 11. A separate passage [exact]: "When a two-layer clothing ensemble is worn, the RAL and REL should be lowered by 2C (3.8F). When a partially air and/or vapor impermeable ensemble or heat reflective or protective aprons, leggings, gauntlets, etc., are worn, the RAL and REL should be lowered 4C (7.2F). These suggested corrections of the RAL or REL are scientific judgments that have not been substantiated by controlled laboratory studies or long-term workplace experience."

**Implication for the build**
- The RAL/REL code in 8.2 is correct as written. Test it against hand-computed values, for example M = 300 W gives REL = 56.7 - 11.5 x log10(300) = 28.2 C-WBGT.
- NIOSH 20/40/60/80/100 and ADOSH (item 2) agree for new workers, and both give 50/60/80/100 for experienced workers. One state machine can cite both. NIOSH's induction window is 7-14 days; ADOSH's "5-7 days" is the allowance before hard work. Keep them as two named parameters.
- Use Table 3-2 for PPE offsets, and label each as "NIOSH Table 3-2 (ACGIH-derived)". Flag the 2 C / 4 C corrections as expert judgment, per NIOSH's own caveat.
- Public-domain status means the equations and tables can be reproduced in the submission with citation.

---

## 7. ACSM exertional heat illness consensus

**Status: PARTLY.** Citation and abstract VERIFIED. Full text UNOBTAINABLE (paywalled). I quote no ACSM clinical wording beyond the abstract.

**Citation (two publications).**
- Roberts WO, Armstrong LE, Sawka MN, Yeargin SW, Heled Y, O'Connor FG. "ACSM Expert Consensus Statement on Exertional Heat Illness: Recognition, Management, and Return to Activity." *Current Sports Medicine Reports* 2021;20(9):470-484. doi:10.1249/JSR.0000000000000878 (PMID 34524191).
- The same title and author list is published again in *Curr Sports Med Rep* 2023;22(4):134-149. doi:10.1249/jsr.0000000000001058 (PMID 37036463). It is the later version; the abstract wording is nearly identical. I could not diff the two.
- Neither is open access (Europe PMC: "Subscription required"). Publisher attempts returned 402 / 403 and were not bypassed.

**Abstract** [exact, Crossref metadata for the 2023 version]: "Exertional heat stroke is a true medical emergency with potential for organ injury and death. This consensus statement emphasizes that optimal exertional heat illness management is promoted by a synchronized chain of survival that promotes rapid recognition and management, as well as communication between care teams. ... Identifying the athlete with suspected exertional heat stroke early in the course, stopping activity (body heat generation), and providing rapid total body cooling are essential for survival, and like any critical life-threatening situation (cardiac arrest, brain stroke, sepsis), time is tissue. ... Most exertional heat illnesses can be prevented with the recognition and modification of well-described risk factors ideally addressed through leadership, policy, and on-site health care."

**Usable corroboration (open, secondary to ACSM).** "Consensus Statement on the Pre-Hospital Management of Exertional Heat Illness", Hemingway R, et al., November 2024, 38 pages (https://fphc.rcsed.ac.uk/media/3665/fphc-exertional-heat-illness-consensus-statement-2024-v14-_final.pdf; text layer read in full) [exact]:
- "9. Severe exertional heat illness is a time critical illness and the priority is rapid and effective cooling prior to transfer (grade D)."
- "EHI is therefore one of the few conditions where transport to hospital should be delayed to prioritise rapid on-site cooling."
- "10. Cold water immersion is the preferred and recommended method of cooling patients with severe exertional heat illness. (Grade: C)"; where immersion is not possible, "Shade, strip, spray and fan (S3F)".
- "11. Active cooling via cold water immersion should cease when core body temperature reaches 38.5-39C. (Grade: C)"
- Severe EHI signs (Table 2): "Core temperature usually >40C and Central nervous system dysfunction (less than 'Alert' on ACVPU scale)"; "CNS dysfunction is the key feature differentiating severe EHI from mild EHI".
Press coverage of the 2015 NATA position statement (search excerpt, secondary) also gives "cool first, transport second", with cold-water immersion at 35-59 F (1.7-15 C).

**Where the sources disagree.** The ADOSH Technical Guideline's heat-stroke first aid (item 2) orders the steps call / move to shade / cool by soaking, spraying, fanning. The open consensus puts on-site rapid cooling ahead of transfer and prefers cold-water immersion. A worker message cannot reconcile these on its own.

**Implication for the build**
- Citing "ACSM 2023" in the submission is safe for the citation and the "time is tissue / rapid cooling" principle only. State that the full text was not accessed. Do not attribute cooling temperatures, immersion details or thresholds to ACSM.
- Worker and supervisor messages should stay at the level both the ADOSH text and the open consensus support: red flags (confusion, collapse, seizure, hot skin), "call emergency services now", "start cooling immediately: shade, remove outer clothing, wet and fan", "do not leave the person alone". Cold-water immersion instructions belong only in a trained-first-aider card, if at all, with the UK consensus as the cited source.
- This matches the plan's rule that no clinical wording is invented. Keep the "not clinically reviewed" statement in the limitations section unless a clinician actually reviews it.

---

## 8. Landsat 8/9 Collection 2 Level-2 surface temperature

**Status: PARTLY.** Licence VERIFIED (public domain / no restrictions; primary pages blocked, so via mirrors). Overpass and resolution corrections below.

**Licence** (plan E6: "The Landsat licence wording")
- AWS Open Data registry, which reproduces the USGS wording [exact, secondary mirror]: "There are no restrictions on Landsat data downloaded from the USGS; it can be used or redistributed as desired. We do request that you include a statement of the data source when citing, copying, or reprinting USGS Landsat data or images." https://registry.opendata.aws/usgs-landsat/
- Microsoft Planetary Computer STAC collection `landsat-c2-l2` [exact, JSON]: `"license": "proprietary"` with a link `rel: license`, `title: "Public Domain"`, `href: https://www.usgs.gov/core-science-systems/hdds/data-policy`. https://planetarycomputer.microsoft.com/api/stac/v1/collections/landsat-c2-l2
- USGS FAQ pages (not fetchable from here; a search excerpt shows USGS stating Landsat data are "in the public domain" and asking for acknowledgement): https://www.usgs.gov/faqs/are-there-any-restrictions-use-or-redistribution-landsat-data
- Suggested credit line from a USGS newsletter (search excerpt): "Landsat Collection 2 Level-2 image courtesy of the U.S. Geological Survey".

**Overpass time over Abu Dhabi: measured, not assumed.** I queried the Planetary Computer STAC API (`landsat-c2-l2`, point 24.45 N / 54.38 E):
- Summer 2025 (1 Jun-30 Sep): 30 Landsat 8/9 scenes; **acquisition times 06:46-06:58 UTC**, which is **10:46-10:58 Gulf Standard Time (UTC+4)**. Two adjacent paths cover the point (path/row 160/043 at about 06:46 UTC and 161/043 at about 06:52 UTC). 28 of the 30 scenes had <20% cloud (27 had <5%; median 0.46%).
- 2026 (1 Jun-11 Nov): 39 scenes, both Landsat 8 (19) and Landsat 9 (20) still acquiring; the latest was 2026-11-03 06:46:40 UTC (Landsat 9). Times 06:45-06:52 UTC.
- Cadence over Abu Dhabi (15 Jun-15 Sep 2025, 23 scenes): scenes arrive as a pair on consecutive days, then a gap of about 7 days. That is about two scenes per 8-day cycle, not one.
- The nominal figure is a local solar time at the equator. NASA [fetch-tool]: "Nominally 10:12 AM (+/- 5 min) local time (descending node)" and "This constellation observes the same location on Earth every 8 days" (https://science.nasa.gov/mission/landsat-9). At 24 N and 54 E that becomes about 10:50 on UAE clocks.

**Resolution.** In the same STAC metadata the surface-temperature band `lwir11` has `gsd: 100` while the delivered raster grid is `spatial_resolution: 30`. The thermal sensor's native pixel is 100 m, delivered on a 30 m grid. Features smaller than about 100 m (single shade structures, vehicles) are not resolved.

**Implication for the build**
- Change "about 10:00 local" to "about 10:50 UAE time (06:46-06:58 UTC)", and say it misses the 14:00-16:00 afternoon peak (the plan already notes the morning-pass limit). Change "every 8 days" to "about two scenes per 8-day cycle from adjacent paths". Change "30 m" to "30 m grid, 100 m native thermal resolution".
- Cloud is not the constraint over Abu Dhabi in summer (28 of 30 scenes below 20%), which resolves the plan's "cloud cover was not checked".
- The licence is permissive. Add one line to the data declaration: "Landsat Collection 2 Level-2 courtesy of the U.S. Geological Survey, public domain, source acknowledged."
- Search through the Planetary Computer STAC API (search is anonymous; asset downloads need a free signed URL from the same service) rather than Earth Engine, which avoids the Earth Engine non-commercial terms for this one layer.

---

## 9. Google WeatherNext 3 access terms

**Status: PARTLY.** Access process VERIFIED. Two plan statements need correction: the data is not non-commercial-only, and the disclaimer is stronger than paraphrased.

**Access** [fetch-tool, https://developers.google.com/weathernext/guides/access-forecast]: "Requests are reviewed on a rolling basis and are typically approved within 5-7 business days." No paid Google Cloud contract is required. The Earth Engine catalog page says [exact]: "To request access to the experimental dataset, please submit the WeatherNext Data Request form."

**Licence split by data age** [exact, Earth Engine catalog "Terms of Use"]: "The Historic Experimental Data is licensed under the Creative Commons Attribution International License, Version 4.0 (CC BY 4.0). The Real-Time Experimental Data is made available under the following GDM Real-Time Weather Forecasting Experimental Data Terms of Use." The terms document defines the split as 1 hour (cover page, "Last modified: 3 September 2026"): "Any data that relates to a time 1 hour ago or more is licensed under the Creative Commons Attribution International License, Version 4.0 (CC BY 4.0)."

**Disclaimer, exact wording** [exact, Earth Engine catalog citation text]: "This data is intended for experimental modelling only and is not intended, validated, or approved for real world use." The plan's paraphrase ("not validated for real-world use") understates it: the text also says *not intended* and *not approved*.

**Real-time terms** [exact, https://storage.googleapis.com/weathernext-public/terms-of-use.pdf, 7 pages]:
- Section 2: "Subject to your compliance with these Terms and Google's Generative AI Prohibited Use Policy, you may access, use and modify the Real-Time Experimental Data solely for the following purposes: (a) any internal purpose; (b) to create and share a Value Added Service in accordance with Section 3; ..." The licence is "non-exclusive, royalty-free, revocable, non-transferable and non-sublicensable".
- Section 6(a): "The Real-Time Experimental Data is approximate and for informational purposes only. It is provided on an 'as is' basis, ... and not intended for consumer use." It also says the data "in no way replaces official alerts, warnings or notices published by such agencies or departments".
- I found **no "non-commercial" wording** in either the terms PDF or the Earth Engine catalog text (searched both).
- The terms point to weathernext@google.com for "purposes not currently permitted under these terms".

**Earth Engine platform terms** [exact, Earth Engine catalog page]: "Earth Engine is free to use for research, education, and nonprofit use." The plan's separate claim that Earth Engine is non-commercial-only is consistent with that line; the commercial pricing item in E6 was not checked.

**Dataset facts, cross-checked** [Earth Engine catalog, exact]: availability "2024-01-01T00:00:00Z-2026-11-10T18:00:00Z"; "0.1 deg (~11 km)"; hourly; 19 variables with mean, p10, p25, p50, p75, p90 (114 bands), including `dewpoint_temperature_2m_*`, `surface_solar_radiation_downwards_1hr_*` and `total_sky_direct_solar_radiation_at_surface_1hr_*`. This matches plan 8.1.

**Implication for the build**
- Timing: 5-7 business days from today (11 Nov) lands on 18-20 Nov, after the 19 Nov internal deadline. If the form was not submitted on 10 Nov, drop the WeatherNext arm from "could" to "not in this submission". Say so in the limitations section; do not imply it was used.
- For the archive back-test, the data is CC BY 4.0 with attribution, which is compatible with the competition's data rules. For any live-forecast demo, the real-time terms apply: revocable, "internal purpose" or Value-Added-Service, and "not intended for consumer use". A worker-facing alert product does not fit that cleanly. That is another reason to base the live path on ECMWF open data.
- Put the full disclaimer, not the paraphrase, on any slide that shows WeatherNext output.

---

## 10. EGA (Emirates Global Aluminium) / Kenzen wearable pilot

**Status: VERIFIED.** The plan text does not currently state EGA figures, so this fills the open "year, number of workers, source" item.

| Year | Workers | What was said | Source |
|---|---|---|---|
| 2022 | **50** volunteers, all in the potlines | first trial; devices monitor "core body temperature, heart rate, and sweating rate" | W.Media, 28 Jun 2022 [fetch-tool]: https://w.media/emirates-global-aluminium-trials-wearable-technology-to-prevent-heat-related-illness/ ; EGA release 9 Aug 2023 [fetch-tool]: "EGA used wearable devices for the first time in a trial of 50 volunteers last summer." |
| 2023 | **350** employee volunteers | "expanded the use of Kenzen, a wearable technology platform, to 350 employee volunteers" | EGA, 9 Aug 2023 [fetch-tool]: https://media.ega.ae/ega-extends-use-of-wearable-technology-to-beat-the-heat-in-the-uae-summer/ |
| 2024 | about **300** employees | "Some 300 EGA employees wore Kenzen's wearable devices this summer, to monitor key physiological indicators such as core body temperature and heart rate." "EGA has also trialled wearable technology since 2022, in partnership with US technology firm Kenzen." | EGA, 22 Oct 2024 [fetch-tool]: https://media.ega.ae/ega-achieved-third-consecutive-summer-of-zero-heat-related-illnesses/ |

Outcomes as EGA states them: zero heat-related illnesses in 2019 and 2022; two treated cases in 2021 (2023 release); "third consecutive summer of zero heat-related illnesses" in 2024 (release title). The releases credit training, hydration checks, breaks and cooling showers alongside the wearables, so zero illnesses is not an attributable effect of the device. Neither release says whether core temperature is measured or estimated, and none gives a 2025 or 2026 figure (I found none).

**Design contrast worth using.** EGA's data goes to both parties: the devices "provide feedback in real time to both the wearer and EGA's safety team" (2024 release). That is the employer-visible individual model the challenge text warns about. Stellar Blaze's on-device, no-employer-path design is the differentiator, and this is a sourced example of the alternative.

**Implication for the build**
- Use "EGA piloted Kenzen wearables from 2022 with 50 volunteers, expanding to 350 in 2023 and about 300 in 2024" as the evidence that an in-UAE industrial pilot path exists. Do not use "zero heat illness" as proof the wearable works.
- Cite as company press releases, not independent evaluation.

---

## 11. Hack2skill / Future Health challenge rules

**Status: PARTLY.** Data, third-party and IP clauses VERIFIED against the live pages today. The LLM-use rule is UNOBTAINABLE. One material change since 6 Nov: registration is closed.

**Registration status (new).** The live event page (https://hack2skill.com/event/futurehealthchallenge/, rendered today) shows "Registration Closed" where the 6 Nov capture showed "Register Now". The plan says "Register today, 10 Nov 2026". **Confirm that registration under Challenge 07 happened by 10 Nov.** After closure it cannot be fixed from the participant side.

**Sources compared.** The live pages today versus the 6 Nov raw captures in `D:\dev\future-health-challenge\research\raw\`. The live Terms page (browser-rendered) carries the same IP, conduct, eligibility and precedence passages as the 6 Nov capture. The three FAQ answers on data and IP, and the "What do we need to submit?" answer, were opened live and match the capture.
- Challenge rules / Terms: https://hack2skill.com/event/futurehealthchallenge/tnc
- Event page: https://hack2skill.com/event/futurehealthchallenge/

**Data and third-party content** [exact]
- FAQ "What data can we use?": "The organisers will not provide any data, including synthetic data. Use only data you have the legal right to use, declare every data source, and avoid personal data you do not need."
- Terms, Rules of Conduct: "Participants must not use any content protected under third-party rights or subject to confidentiality obligations to third parties and must permit the 'Organiser' to use the content for the intended purposes"
- Terms, IP section: "The results shall, in no Hackathon, infringe in any manner or induce infringement of any third-party intellectual property rights. Should the right from identified third-party right owners not be commercially available, the result may not be qualified to win the prize. The Participant undertakes to indemnify the Organiser against all claims asserted by third parties..."
- Terms, Protection of IP: participants warrant they "will not submit content that is copyrighted, protected by trade secret, or otherwise subject to third-party intellectual property rights ... unless the participant is the owner of such rights or has permission from the rightful owner".

**IP clause** [exact, Terms, "Intellectual Property Rights"]: "...a Participant will grant the Organiser a right of first refusal for the acquisition of any exclusive license for all materials including software, source code, documentation, data, and concepts ... submitted to the Organiser during the Hackathon, for a period of 6 months following the conclusion of the Hackathon. During this period, the Participant may not sell, transfer, or license exclusively their intellectual property rights to a third party, without first offering the Organiser the opportunity to acquire or license the Materials on the same terms and conditions offered by the third party, whereby the Organiser will have 30 days to accept the Participant's offer."
Further [exact]: "The Participants expressly authorize the Organiser, to publish, to communicate, to expose and to disclose, divulge and represent the submitted ideas verbally, graphically or in writing, in any medium worldwide and without restrictions in time..." and a "worldwide, perpetual, irrevocable, non-exclusive right and license, with the right to sublicense" for "Marketing Content". Precedence [exact]: "The Terms and Conditions herein shall prevail over any inconsistent terms, conditions, provisions, or representations contained in any other promotional or advertising materials for the Hackathon."
FAQ, for contrast [exact]: "You retain full ownership of your IP. Whether you participate as an individual or a startup, all IP rights remain with you." and "Intellectual property stays with you and your team. You may be asked to share your code base where possible for evaluation purposes."
The plan's description (6-month right of first refusal on exclusive licences, perpetual marketing licence, Terms prevail) is accurate. Detail the plan omits: the organiser has **30 days** to accept an offer, and the restriction covers sale, transfer or **exclusive** licence only (non-exclusive licensing is not restricted by the clause).

**LLM / AI-tool use: UNOBTAINABLE.** Neither the Terms (searched for "AI", "LLM", "generative", "artificial": no match) nor the FAQ contains a rule on LLM use or on declaring AI-assisted work. The FAQ says "Do we have to use a particular technology? No. The Challenge is technology-neutral" (6 Nov capture) and "Full requirements are shared when you register." The submission requirements are not public. Assumption A8 (organisers accept LLM use if human-reviewed) therefore cannot be confirmed from public sources. Contact for questions: support+fhdic@hack2skill.com.

**Implication for the build**
- Declare every data source in the technical document as the FAQ requires. Include licence, URL, access date and how it was used.
- **Prize-eligibility risk (my inference from the quoted clause, not stated by the organisers):** "Should the right from identified third-party right owners not be commercially available, the result may not be qualified to win the prize." The plan's own data table says the Open-Meteo free tier is non-commercial; Open-Meteo's terms [fetch-tool] list "Commercial products or promotional activities" as commercial use while stating the data itself is under CC BY 4.0. Earth Engine is "free ... for research, education, and nonprofit use". WeatherNext real-time data is revocable. Mitigation: use only CC BY / public-domain data in the prototype path (ECMWF open data and NOAA are), declare Open-Meteo as a prototype convenience with its CC BY data licence, and say which sources would change in production.
- Do not describe the LLM features as "accepted by the organisers". Either ask support (the plan already lists this) or describe them as optional and human-approved. If no answer arrives, the "could" status in the plan is right.
- The IP clause does not stop non-exclusive licensing or open-sourcing parts of the code; say in the commercial-path section that any exclusive deal within 6 months of the end of the hackathon needs a 30-day offer to the organiser first.

---

## Consolidated corrections to the plan

1. **F1 / non-goal on TWL:** replace "no open formula" with "published algorithm (paywalled paper) plus an MIT-licensed reference implementation, cross-checked within +6.5 W/m2 on 11 published values". Adopt ADOSH's TWL zones (140 / 115 W/m2) as the regulatory layer; do not map via WBGT. (Items 2, 3.)
2. **Registration:** the event page now reads "Registration Closed". Confirm the Challenge 07 registration was completed on or before 10 Nov. (Item 11.)
3. **WeatherNext 3:** a request made today clears on 18-20 Nov, too late for the 19 Nov internal deadline. Demote to not-in-this-submission unless requested on 10 Nov. Correct the disclaimer wording and the non-commercial claim. (Item 9.)
4. **Landsat:** about 10:50 UAE time (not 10:00); about two scenes per 8-day cycle; 100 m native thermal resolution on a 30 m grid; licence is public domain, credit USGS. (Item 8.)
5. **DoH Responsible AI Standard:** clause number correct. Its formal scope is DoH and licensed healthcare entities; say "applied as a design benchmark", not "complies". Revision was due Oct 2026; no V2 found. (Item 4.)
6. **PDPL:** executive regulations not issued as of Sep 2026 (secondary). Health data carve-out (Art. 2(2)(e)) means Law 2/2019 may be the governing law. Employer exceptions are Art. 4(4) and 4(8), as the plan says. (Item 5.)
7. **ACSM:** cite the 2023 re-publication (and 2021 original) for the principle only; the full text was not accessible. Use the open UK consensus and the ADOSH text for message wording. (Item 7.)
8. **Open gaps remaining:** (a) LLM-use rule (no public source); (b) Brake & Bates 2002 Appendix 1 not read; (c) Federal Law 2/2019 primary text not read; (d) DoH listing pages not re-checked for a V2 (TLS failures); (e) MoHRE primary site not reachable; (f) ADPHC bilingual TWL poster not read.

## Verification note 2026-11-14: where the heat-stroke first-aid clause sits (no correction needed here)
Item 2 above says "Heat-stroke first aid in the guideline (§4.5(c), exact)". **That is correct as written.** Re-checked on 2026-11-14 against the two ADOSH PDFs (CoP 11.0 v4.0, MD5 `547ac9046f67928998c640da026f3797`; Technical Guideline v4.0, MD5 `6852c2e296bfed231214df101cc4e28b`): §4.5(c)(i)-(iii) is in the **Technical Guideline** (§4.5 "Heat Stroke", page 9 of 24) and the quoted words match. It is **not** in CoP 11.0, whose sections are 1 Introduction, 2 Training and Competency, 3 Requirements, 4 Record Keeping and 5 Document Amendment Record; the CoP's §4(a)(v) is "records of heat stress related incidents". Other project texts that cite the clause as "CoP 11.0 §4.5(c)" (ADR 0045, the F2 plan's Task 18 wording) carry their own dated erratum.

Added because this file is the evidence base for the clause. **CoP 11.0 cl. 3.1.2(e)** [exact, PDF text layer, page 7]: "Employees shall ensure they report any symptoms of heat illness suffered by themselves or fellow employees to their supervisor immediately as per ADOSH-SF - Element 07 - Monitoring, Investigation and Reporting." It makes the report to the supervisor a duty of the employee, and bears on the "notify supervisor" in §4.5(c)(i); see ADR 0065. **Not read:** ADOSH-SF Element 07, so the reporting route it prescribes is unverified.
