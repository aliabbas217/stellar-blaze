# Heat-aware shift planner: stakeholder and compliance assessment

**Date:** 2026-11-11. **Scope:** the three-horizon planner (stable seasonal/monthly roster with fixed shift times; limited weekly adjustments; daily changes to breaks, task order and crew rotation inside fixed shifts) from the angles of workers, employers, operations, compliance, the regulator, and failure modes. **Not covered here (covered elsewhere):** UAE labour-law hours, breaks, rest and notice rules; sleep science; quantitative exposure feasibility on weather data. They are referenced as "covered elsewhere" and not repeated.

**Method.** Primary texts were fetched and read this session where reachable. Every claim carries a source tag. Nothing was fetched with TLS checks bypassed; two hosts that failed certificate checks or refused connections are listed in section 10 and were not worked around.

| Tag | Meaning |
|---|---|
| [P] | Primary text fetched and read in full or in the relevant clause |
| [P-tr] | Primary but an unofficial translation (stated by the host) |
| [P-sum] | Official government web page, read through a summarising fetch tool (paraphrase, not verbatim) |
| [S] | Secondary source (law firm, press, NGO) fetched |
| [Snip] | Search-result excerpt only; the page was not opened |
| [Calc] | My arithmetic from sourced inputs |
| [Inf] | My inference, not stated by any source |
| [UNV] | Unverified; no source found or reachable |

---

## 0. Summary: what changes the design

The evidence supports the planner's overall shape (stable roster, movable pieces inside the shift). It contradicts or sharpens six framing points.

1. **"Heat-aware shift planning" must not mean "move the shift to night or dawn".** Night work is not free for the worker or the employer: the 50% night-overtime premium does not apply to workers on shifts ([S1] Art. 19(3)); ADOSH's own driver-fatigue code says to "avoid departures before 5am" ([S13] cl. 3.4(b)(ii)); Abu Dhabi evening and night work needs a permit and noise control ([S22]); and a commute accident counts as a work injury ([S1] Art. 1). The planner should treat the seasonal horizon as a policy recommendation with explicit costs, not an optimisation variable, and spend its optimisation effort on the daily horizon.
2. **The planner's customer is split.** The principal contractor controls the site and subcontractors "report to and be managed by" it ([S12] cl. 3.1.4, 3.1.5), but each subcontractor is the employer of record for pay, transport, accommodation and the labour-law safety duty ([S1] Art. 13(4), 13(6)). Plans must be scoped per employer; site-level windows (cranes, pours) come from the principal contractor.
3. **Consent is not the legal basis, so consent validity is a design choice rather than a legal shield.** The PDPL lets an employer process without consent for employment obligations and contract performance ([S4] Art. 4(8), 4(9)); a worker cannot object to automated decisions "agreed upon under the contract" ([S4] Art. 18(2)(a)); the ILO code says "Workers may not waive their privacy rights" ([S8] cl. 5.13). The design should not rest on consent clauses.
4. **UAE has not ratified ILO C155** (nor C187, C161, C167). Verified on NORMLEX today: 94 ratifications, UAE absent ([S5]). Do not claim alignment with a ratified OSH convention. UAE has ratified C81 (labour inspection) and C111 (discrimination).
5. **Two schedule facts in the plan are stale or incomplete.** Friday prayer is at 12:45 from 2 January 2026, not 1:15 pm ([S26]). Ramadan 2027 starts about 8 February ([S27]), so Ramadan is not a design driver for the heat season for years (section 2.4).
6. **Small-cell threshold.** The roadmap says k = 5. Published practice ranges from 3 to 40 with "many being 10 to 15", and CMS uses 11 ([S24]). Choose k by data type (section 7).

**Top three risks**
1. Misuse and gaming: green windows read as licence to lengthen days, parameters (workload, PPE, shade, acclimatisation, exempt flags) edited to get green, human sign-off degraded to rubber-stamping.
2. Rescheduling harms workers more than it helps through lost overtime income, unpaid commute and waiting, earlier bus departures and sleep disruption, especially if shifts migrate to dawn or night.
3. Accountability is thinner than the "advisory with human sign-off" label suggests: automation bias, supervisor workload, and an unresolved liability picture (the employer stays the duty-holder and the audit log is evidence of what the employer knew).

---

## 1. Framing check on the three horizons (rule 0)

| Horizon | What can legitimately change | Binding constraints found | Verdict |
|---|---|---|---|
| Seasonal/monthly roster, fixed shift times | Choice of shift window per site and season | Contract hours and pay terms ([S1] Art. 22(1)); a monthly-wage worker moves to hourly or piece pay only with written consent ([S1] Art. 24); hours, ban and notice rules (covered elsewhere); bus timetable; accommodation (CoP 18.0, 25.0 cl. 3.5); noise permits ([S22]); night premium rules ([S1] Art. 19(3)) | Supported, but as a **policy recommendation with a cost sheet**, decided by employer and principal contractor |
| Weekly adjustments | Which crew does exposed vs shaded work; pour and lift scheduling; acclimatisation ramps | Bus schedule is fixed; advance notice rules (covered elsewhere); acclimatisation ramps ([S14]) | Supported, small |
| Daily changes inside fixed shifts | Break timing, task order, crew rotation, escalation to stop | CoP 11.0 Table 1 work/rest, no unacclimatised worker in Medium/High, no lone work ([S14]); self-paced work footnote | Where the safety benefit and the forecast skill actually are |

This agrees with ADOSH's own roster guidance, even though that guidance is written for drivers: "Arranging work rosters to be as regular as possible" and "start times to go forwards in time rather than backwards" ([S13] cl. 3.4(c)). [Inf] The same logic applies to crews, but the code does not say so.

Evidence that fixed windows are not enough supports a daily, conditions-driven layer: ILO says "fixed restrictions on working hours may not be enough to protect workers from heat stress" and suggests the ban "could be adjusted to reflect real-time temperature, humidity and workload" ([S6] Box 5.1). HRW says the evidence on calendar- and time-based bans is growing and shows they may not adequately protect workers (paraphrase of [S16]). ILO 2024 finds "nine out of ten workers globally were exposed to excessive heat outside of a heatwave" and "eight in ten occupational injuries from extreme heat happened outside of heatwaves" ([S7]).

---

## 2. Angle 1: Workers

### 2.1 Pay impact

- **Finding.** UAE construction pay is a monthly (or daily/piece) contract wage plus overtime computed on the **basic wage only**. Overtime is "the wage corresponding to the normal working hours, which is calculated according to the basic wage plus an increase of not less than (25 %)"; between 10 pm and 4 am the increase is at least 50%, and "The workers working based on shifts shall be excluded from this clause" ([S1] Art. 19(2), 19(3); confirmed on the current official page [S2]: "This rule does not apply on workers who work on basis of shifts"). Weekend work: another day off, or pay plus at least 50% of basic ([S1] Art. 19(4)). A monthly-wage worker can be moved to hourly or piece pay only "if the worker agrees on the same in writing" ([S1] Art. 24). Disciplinary wage deductions are capped at 5% of wage ([S1] Art. 25(1)(f)).
- **Evidence on dependence on overtime.** GLMM focus groups in Dubai (94 workers, 31 in construction, Sep 2017 to Mar 2018) report that "low-income workers often need doing as much overtime as possible to compensate for a low base salary. In our sample, this was particularly frequent for workers in the construction sector" ([S18], section 2.2). 55% of construction participants were dissatisfied with overtime payments; one said "if my foreman makes me work for extra hours, I don't have a proof that he has done it so" ([S18], section 4.3). Quoted base wages are anecdotes of AED 700 to 1,800. **Caveats:** Dubai, pre-2021 law, small qualitative sample. I found no current statistic on overtime's share of construction income [UNV].
- **Illustrative size** [Calc, not data]: at the legal maximum of 2 hours overtime a day on an 8-hour day, overtime pays 2 x 1.25 / 8 = 31% above basic, so losing it all removes about 24% of total pay. The percentage does not depend on the wage level. In the ban season the hours cap in morning and evening shifts may already limit overtime (covered elsewhere).
- **Is time lost to heat stoppage paid?** No source found [UNV]. Press reports say hours above the cap count as overtime ([Snip] People Matters via search); nothing states that break time is paid.
- **Risk.** A plan that cuts overtime hours (stoppages, shorter exposed time) cuts income for the people the tool is meant to protect, which gives workers a reason to resist or hide symptoms. A plan that converts the work pattern into formal night "shifts" removes the 50% night premium [Inf from Art. 19(3)]; "shift worker" is not defined in the text I read [UNV].
- **Design implication.** (a) Every plan shows a **paid-hours and overtime delta per crew vs baseline** and flags any plan that reduces scheduled paid hours. (b) The planner cannot enforce pay, so the employer attests, per plan, that stoppage time is paid under the contract (documentation plus UI). (c) The objective penalises night work and pre-06:00 starts (section 2.2). (d) Document the limitation: the tool does not model pay.

### 2.2 Transport from labour camps

- **Finding.** Commute time is not working time: "The periods spent by the worker during the commute between his place of residence and the workplace, shall not be counted in the working hours, except for some categories of workers" ([S1] Art. 17(3)). A secondary 2026 summary says the Executive Regulations count commute time in three cases: officially recognised adverse weather or emergencies, delays in employer-arranged transport due to operational issues, and explicit agreement ([S20]; I could not read the Executive Regulations text, see section 10). A commute accident is a work injury "without interruption or deviation from the normal route" ([S1] Art. 1, "Work Injury").
- **Evidence on commute reality.** GLMM, a mid-skilled construction worker: "Even if we are finishing the work on time, then we have to wait for three hours, two hours, or 4 hours"; a low-skilled construction worker: "During summers specially, it is a big problem as on one seat three people are sitting, we are all squashed, so it becomes extremely hot and unbearable" ([S18], section 5.6). A hotel worker in the same study: "we don't get overtime for extra hours [spent waiting for the bus]" ([S18], section 2.2; hospitality, not construction). GLMM reports about 70% of all participants satisfied with transport, with construction workers more dissatisfied than hospitality workers (section 5.6). The 2009 labour-accommodation manual it cites requires that "the vehicle should be air-conditioned" (Art. 9 of the General Standards Manual, Cabinet Decision 13 of 2009, as described by GLMM; the instrument in force today, Administrative Decision 19 of 2023, was not read). The National, 15 May 2014, Dubai: "If it is a 6am to 6pm shift, then they have to report at 4am", the bus "will take two hours", and "The bus can fit 60 to 65 people comfortably, but 80 people are usually fitted inside" ([S19]). **Caveats:** 2014 press and Dubai; I found no current Abu Dhabi or Mussafah commute data [UNV].
- **Benchmark.** ADOSH CoP 25.0 (v4.0, July 2024), written for drivers including "pick & drop transport": "set schedules that minimize periods of night driving" and "avoid departures before 5am" ([S13] cl. 3.4(b)(i)-(ii)). A 05:00 site start implies a bus departure around 03:00 to 04:00 under the commute times above [Calc]; that conflicts with the benchmark.
- **Risk.** Earlier or later shifts lengthen the unpaid day, put buses on dark roads, and add waiting in heat that no model sees.
- **Design implication.** Shift start and end are inputs with a configurable **earliest-start parameter (default 06:00, flagged below it)** and a soft cost on night hours; the plan lists the bus timetable as an assumption the employer confirms. Commute and waiting heat exposure is out of scope for the demo and recorded as a limitation (later: read bus waiting time as an exposure term).

### 2.3 Sleep and meals

- **Sleep science:** covered elsewhere. What I add is the accommodation side. Employers must provide accommodation ([S1] Art. 13(4)). ADOSH CoP 25.0 cl. 3.5(c) lists what night workers need: "suitable window coverings to prevent light penetration", "organization and allocation of shared rooms to avoid disturbance of night time workers", noise reduction, and "adequate provisions to ensure thermal comfort of the accommodation for ease of sleep" ([S13]). It also says time should be allowed for rest and acclimatisation "where drivers are required to significantly change shift patterns, for example moving between day and night shifts" (cl. 3.4(b)(viii)).
- **Meals:** GLMM reports that "Construction workers housed in camps are usually provided food", and cites the 2009 Cabinet Decision requirement that "a schedule specifying the meal times should be placed at the entrance of the mess hall" and central air conditioning in rooms and mess halls (Art. 3.5 and 2.4.1 as described by GLMM, [S18] sections 5.3 and 5.4; the current instrument was not read). 42% of construction participants were dissatisfied with kitchen facilities, and a Pakistani construction worker said good food "happens only on the checking days" ([S18] section 5.3). CoP 19.0 covers food handling in accommodation kitchens and dining halls ([S15] listing; clause not read). I found no rule or data on meal timing for dawn or night starts [UNV]. [Inf] A camp mess hall run to a posted schedule will not serve a 03:30 breakfast unless the employer changes it, so an early start is a catering decision too.
- **Risk.** A roster change that ignores camp conditions (shared rooms, noise, AC) produces sleep debt, which raises heat risk. [Inf]
- **Design implication.** Roster-change recommendations carry a checklist for the employer (blackout, room allocation, meal timing for a dawn start); weekly changes that flip a crew between day and night are blocked by default (soft costs S1 and S2 in section 9).

### 2.4 Prayer times and Ramadan

- **Friday prayer:** "The Friday prayer will be held at exactly 12.45pm" from 2 January 2026, replacing 1:15 pm, announced by the General Authority of Islamic Affairs, Endowments and Zakat ([S26], The National, 10 Dec 2025).
- **Daily prayer:** solar noon in Abu Dhabi falls between about 12:06 and 12:31 across the year [Calc, simple equation-of-time formula; Dhuhr is a few minutes later; check the official timetable]. In the ban season (15 Jun to 15 Sep, 12:30 to 15:00) the midday break covers Dhuhr and Friday prayer. Outside the ban season, which includes hot months such as April, May and October, a Friday crew working at 12:45 has no automatic break.
- **Ramadan:** working hours "are reduced by 2 hours, every day" ([S2]). Ramadan 2027 is expected to begin about 8 February ([S27] Snip), and it moves about 11 days earlier a year ([S27]). By my arithmetic [Calc] it does not reach the 15 Jun to 15 Sep window until roughly 2040 or later. **Ramadan is not a driver for the 2026 to 2027 heat season.**
- **Legal entitlement to prayer time:** not found [UNV].
- **Design implication.** Prayer and Ramadan are **configurable calendar rules** (Friday 12:45; Ramadan hours reduction), not optimisation variables. Soft rule: do not place critical tasks across 12:30 to 13:30 on Fridays outside the ban season. Document that the 2026 build does not model Ramadan.

### 2.5 Fairness of rotation (who gets the hot tasks)

- **Finding.** The ADOSH rule that no unacclimatised person works in the Medium or High zones ([S14], Table 1) concentrates hot tasks on acclimatised workers. The labour law prohibits discrimination on "race, colour, sex, religion, national or social origin or disability" and says "Employers are prohibited to discriminate against workers in jobs involving similar tasks" ([S1] Art. 4(1)). Age is not listed in Art. 4. The DoH Standard lists "race, gender, age, socioeconomic status, disability" ([S9] cl. 3.1.5). The labour law's own preamble cites Federal Decree-Law 2 of 2015 on combating discrimination and hatred ([S1]). UAE ratified ILO C111 on 28 Jun 2001 ([S5]); I did not read the Convention's list of grounds.
- **Limits of rotation.** Trades and competences differ (CoP 34.0 and 38.0 require trained operators), and workers belong to different employers on one site. Rotation is therefore only meaningful among workers who do the same task for the same employer. [Inf]
- **Risk.** Hot slots fall repeatedly on one crew, one subcontractor or one nationality-heavy trade, with no one measuring it.
- **Design implication.** (a) A fairness measure: cumulative exposed hours per worker pseudonym within a task-equivalence class and employer, over a rolling 14 days, as a **soft cost** (differences penalised) and as a supervisor-visible spread (not individual rankings). (b) The planner does not ingest nationality, sex or age. (c) A fairness audit across protected attributes runs outside the planner by joining to HR records under access control, aggregate-only, with small-cell suppression (section 7); this resolves the tension between PDPL Art. 5(3) data minimisation ([S4]) and DoH cl. 3.1.5.1.2 representativeness audits ([S9]).

### 2.6 Autonomy and the right to stop work

- **Finding.** The ADOSH Technical Guideline defines "Self-paced work - workers must be allowed to adjust their work rate according to environmental conditions" ([S14], Table 1 footnote, as quoted in the claims-verification doc). The labour law gives a worker who faces "grave danger at the workplace that threatens the worker's safety or health" the right to quit without notice, provided the employer knows and does nothing ([S1] Art. 45(3)); the grave-danger rules sit in the Executive Regulations, which I could not read ([Snip]: Art. 26 of Cabinet Resolution 1/2022). I found **no UAE text giving a worker an explicit right to stop work and stay employed** [UNV]. The worker duty is to implement the establishment's OSH instructions ([S1] Art. 16(6)).
- **Evidence of pressure.** HRW 2024, workers' words: "If we slow down [at work because of the heat], the foreman threatens us with three days' wage deduction" (location not stated) ([S17]). HRW 2026, UAE road-construction worker: "we have to work until 11:30 a.m. no matter what" ([S16]). Three days of a 30-day month is about 10% of wage, above the 5% cap on disciplinary deductions [Calc against Art. 25(1)(f)]; whether such a deduction is disciplinary or for unpaid absence is not clear.
- **Risk.** A planner that sets the work pace removes the self-paced principle in practice; supervisors may treat a worker's stop as non-compliance.
- **Design implication.** Plans are **bounds, not pace**: they set windows and minimum rest; workers retain self-pacing and a stop signal. A "need to rest or stop" message is first-class, queued offline (ADR 0004), carries no performance analytics, and never feeds adherence reports on named individuals.

### 2.7 Fear of reporting symptoms

- **Finding.** ILO 2019: language barriers "make it harder for workers to report symptoms and raise concerns with their managers, or even just to explain that they need to take a break or drink some water" ([S6] Box 5.1). HRW 2026 reports (paraphrase) that workers described fear of losing income or jobs, which made refusing unsafe work difficult; a UAE-based worker is quoted as saying "Maybe tomorrow it will be our turn." HRW says protections depend on supervisors and employers ([S16]). The 2026 HRW release does not discuss retaliation directly; the closest content is fear of losing income or jobs.
- **Design implication.** The symptom path must be **outside the employer's view**: individual symptom reports stay on the device or go to a first-aider or clinic, never to a supervisor dashboard; supervisors see only crew-level levels and counts above the suppression threshold. No "who reported" lists. Document honestly that this limits what the supervisor can act on, and that first-aid escalation (call, move to shade, cool) uses the cited steps.

### 2.8 Language and literacy

- **Finding.** ILO commentary on consent: "a worker might be illiterate or not understand a given language. In such cases, information and consent may have to be given verbally" ([S8], commentary on informed and explicit consent). GLMM: a worker signed a contract in a language he did not read: "We don't know Arabic language ... They just make us sign it" ([S18]). ADPHC issues roll-ups in Arabic, English, Urdu, Hindi, Bengali and Tagalog (claims doc §2).
- **Design implication.** Plan changes reach workers through a **supervisor-led briefing** with colour boards, pictograms, pre-rendered audio and a printable crew card (ADR 0004 already makes this first-class). Consent for any optional feature is given verbally or by picture, recorded, and explained in the worker's language. Language coverage is a stated limitation (Nepali is not in ADPHC's set; Tagalog is).

### 2.9 Digital access

- **Finding.** No primary data on construction-worker smartphone ownership or on-site phone rules found [UNV]. A 2019 commercial survey (Ding, expats across four Gulf states) reports 73% use WhatsApp most often ([Snip]; sample not described). A Gulf News report of 29 April 2026 says MOHRE is "mandating free internet access" in worker accommodation ([S28], secondary; the instrument is not named).
- **Design implication.** Keep ADR 0004's position: the supervisor relay is the primary channel, personal phones are optional, and **the plan never depends on a worker owning or carrying a phone**. Phone ownership and site phone rules are pilot questions (ADR 0004 revisit trigger).

### 2.10 Surveillance concerns

- **Finding.** ILO Code of Practice on Protection of Workers' Personal Data (1997, non-binding by its own text): "Decisions concerning a worker should not be based solely on the automated processing of that worker's personal data" (5.5); "Personal data collected by electronic monitoring should not be the only factors in evaluating worker performance" (5.6); "Workers may not waive their privacy rights" (5.13); "Continuous monitoring should be permitted only if required for health and safety or the protection of property" (6.14(3)); workers' representatives "should be informed and consulted ... concerning the introduction or modification of automated systems that process worker's personal data" (12.2) ([S8]). The challenge text itself warns that over-collecting data becomes surveillance (plan, Part A).
- **Design implication.** Plan inputs are task, crew, time and conditions, not worker physiology. Per-worker data is limited to the acclimatisation counter (days on site, days away) and an optional exposure-hours tally, both employment records the employer already holds. No GPS, no cameras (plan E3), no wearable data in the planner. A pilot protocol includes a worker briefing and a feedback channel before go-live (ILO 12.2).

---

## 3. Angle 2: Employers and contractors

### 3.1 Productivity and cost

- **Finding.** ILO 2019: "in 2030, 2.2 per cent of total working hours worldwide will be lost to high temperatures - a productivity loss equivalent to 80 million full-time jobs", and the figure "goes up to 3.8 per cent" if agricultural and construction work is assumed to be done in the sun ([S6]). For the Arab States: "Most of the impact of heat stress in the Arab States is driven by the construction sector, which is expected to account for 40 per cent of the total loss of working hours due to heat stress in 2030. Moreover, workers in this sector are often migrants with low adaptive capacity." "Bahrain and the United Arab Emirates are also expected to lose more than 2 per cent of their GDP by 2030 as a result of heat stress." "At 33-34 C, a worker operating at moderate work intensity loses 50 per cent of his or her work capacity" ([S6]). ILO 2024: better prevention "could save up to US$361 billion globally" in lost income and medical costs ([S7]).
- **Caveats.** These are macro projections under ILO's assumptions, not site-level measurements. I found **no published UAE estimate of the productivity gain from rescheduling** [UNV]; a Khaleej Times figure of USD 7.5 billion a year is an explicit rough estimate ([Snip]). The project can only simulate gains (plan 8.12 labels this SIMULATED).
- **Design implication.** The pitch must not claim measured productivity gains. Report minutes lost vs the ban-only baseline as SIMULATED, with ILO's 50% capacity at WBGT 33 to 34 as the stated mechanism.

### 3.2 Contract deadlines and delay penalties

- **Finding.** Under FIDIC 2017 Sub-Clause 8.5(c), an extension of time needs "exceptionally adverse climatic conditions", defined as unforeseeable having regard to climatic data; "it is not enough to simply say that it was hot" ([S25], law-firm commentary). In the UAE summer heat is foreseeable, and the midday break recurs every year [Inf]. I found no Gulf decision on whether summer heat qualifies [UNV]. Contract terms vary.
- **Implication.** Contractors cannot expect to recover time for routine heat stoppages, so they carry the schedule risk themselves. This is a reason to want a tool that reduces lost time, and also a **pressure to override protective plans near deadlines**.
- **Design implication.** The planner reports schedule impact in minutes of lost work per task, never as a recommendation to relax a protective action. Overrides near a deadline take the same sign-off and reason code as any other (section 9, G6).

### 3.3 Overtime and night-work costs

- **Finding.** Overtime is paid at basic plus 25%, and 50% between 10 pm and 4 am except for shift workers ([S1] Art. 19). Night work on construction sites in Abu Dhabi needs a permit: the municipality "called on workers in the construction sector to obtain work permits outside the authorized hours, especially evening and night hours" and stressed "the permissible levels of noise, especially in projects close to residential areas" (Abu Dhabi City Municipality, 12 March 2025, [S22]). The page does not state the permitted hours or the procedure. Older press says night permits are conditional on keeping noise down and can be cancelled on resident complaints ([Snip]). Costs of lighting, supervision and noise mitigation: no published figure found [UNV]. Dubai rules not researched.
- **Employer incentive to note.** Formal night shifts avoid the 50% premium ([S1] Art. 19(3)), so employers may prefer them. That is a transfer from worker to employer, outside the heat benefit. [Inf]
- **Design implication.** The cost sheet shows overtime and night-premium effects and a "permit required" flag for any shift touching evening or night hours; permit status is an employer input, not something the tool decides.

### 3.4 Insurance and liability

- **Finding.** The employer must provide "the necessary means of prevention to protect workers from the risks of occupational diseases and injuries ... conducting periodic evaluation" ([S1] Art. 13(6)). If a worker has a work injury or occupational disease the employer pays treatment, pays "a full wage throughout the treatment period or for (6) six months, whichever is less", and, on death, compensation equal to 24 months of basic wage, between AED 18,000 and AED 200,000 ([S1] Art. 37). Injuries must be reported to MOHRE within 48 hours ([P-sum] [S3]: Ministerial Resolution 657 of 2022). CoP 11.0 cl. 3.1.1(e) and (f) set a heat-stress programme and TWL assessment duty for sites where 35 C is foreseeable, regardless of any tool ([S14]).
- **Who is liable if an alert is ignored?** The duty sits with the employer (and, for site control, the principal contractor, [S12] cl. 3.3.5(a), 3.3.5(h)). The tool does not transfer or reduce that duty. [Inf] Criminal negligence exposure exists but I could not settle the article: The National cites Art. 342, Chambers cites Art. 387, and neither text was read ([Snip]) [UNV]. Whether insurers condition cover on heat-code compliance: not researched [UNV]. Liability of the tool provider: not researched [UNV].
- **Evidence-trail point** [Inf]. An alert log that shows the employer saw a Red level and proceeded is evidence of foreseeability. That is a reason for employers to be wary of the tool, and a reason the log must be accurate and inspection-ready rather than hidden.
- **Design implication.** Wording on every screen and in the technical document: decision support only; the employer remains the duty-holder. A pre-pilot legal review of liability allocation and an insurer conversation are listed as pilot gates, not claimed done.

### 3.5 What makes employers adopt it

| Driver | Evidence |
|---|---|
| Existing legal duty to run a heat programme, assess TWL, and schedule hard work in the coolest part of the day "to the extent reasonably practicable" | CoP 11.0 cl. 3.1.1(e)-(f), 3.2(b)(ii), 3.2(b)(viii) ([S14]) |
| Inspection evidence | CoP 11.0 cl. 4(a)(v) requires records of heat-stress incidents ([S14]); an evidence pack (section 7) |
| Avoided injury cost | Art. 37 liabilities above |
| Reduced lost capacity | ILO 50% capacity at WBGT 33 to 34 ([S6]) |
| Real-world precedent | EGA and Kenzen pilot (claims doc §10, from EGA press releases) |

**Barriers.** Small subcontractors: "Good companies provide all facilities. In smaller companies, however, such facilities do not exist" ([S16], a worker's words). Deadline pressure (3.2). Fear of an evidence trail (3.4). Supervisor workload (4.5).

---

## 4. Angle 3: Operational and technical work constraints

### 4.1 Concrete pouring

- **Finding.** ACI 301-20 and ACI 305.1-14 "limit the maximum concrete temperature to 95 F (35 C) at the time of discharge"; exceeding it needs "successful past field experience or preconstruction testing" and prior approval ([S21], ACI FAQ). A 35 C figure also appears for Dubai Municipality's ready-mix guide TG 02-2024 ([Snip] only; the PDF URL redirected to the homepage, so unverified [UNV]). I could not read ACI 305R-20's evaporation-rate guidance in primary text; the 1.0 kg/m2/h threshold appears only in secondary sources ([Snip]) [UNV]. I found no Abu Dhabi specification.
- **Operational facts.** The midday-ban exemption covers asphalt laying or concrete pouring that cannot be postponed ([S3] paraphrase; claims doc §1 lists "asphalt, concrete, utility repair"). ADOSH CoP 38.0 v4.1 (16 Feb 2026) requires a risk assessment that considers "the effects of high winds on concrete placing booms" (cl. 3.2.2(b)(vii)) and a "time schedule assessment to complete the work prior to commencing a major pour which allows for: 1. weather" (cl. 3.3(a)(ix)) ([S11]; clause numbers from a text extraction).
- **Implication.** A pour is a long, non-interruptible block that runs through whatever heat there is. Exempt crews are the highest-risk crews.
- **Design implication.** Treat pours as **fixed-duration blocks**: the planner varies start time, crew size and rotation inside the block, never the duration. Exempt-category use is an explicit, attested flag. The planner shows a discharge-temperature reminder as an external check against the project specification and does not compute concrete temperature.

### 4.2 Cranes and lifting

- **Finding (primary).** ADOSH CoP 34.0 v4.1 (February 2026) cl. 3.6.6: "Employers shall regularly obtain (at least daily) meteorological reports for the area where cranes are being used for lifting operations" and "In all cases employers shall ensure that lifting operations cease when the recorded wind speed reaches or gusts in excess of 38 km/h (20.5) knots" ([S10]). Manufacturer wind-off speed also applies (cl. 3.6.6(c)). A blog repost gave 20 knots (10 m/s) for material lifts and 15 knots for personnel; the code text above is the authority and the blog's personnel figure was not confirmed ([Snip], discarded).
- **Design implication.** Wind is a site-window input supplied by the principal contractor, not an optimisation objective. The planner shows the wind forecast next to lift tasks and flags tasks that sit in windows forecast above the limit. Moving lifts to cooler hours concentrates them in the early or late window, and that window must still satisfy the wind rule.

### 4.3 Work that cannot move to night

Pours already under way (4.1), road and utility repairs, work needing a government permit (exempt categories), lifts limited by wind, work near residents (noise permit, [S22]), crane-dependent sequences. [Inf from the cited clauses] The planner marks each task with a **movability class** (movable, movable with permit, fixed-duration, fixed-time) supplied by the supervisor; it never infers it.

### 4.4 Multi-subcontractor sites

Principal contractor: "plan, coordinate, supervise and oversee construction ... in a way that prevents or minimizes ... risks to the health and safety of all persons at or near the work site", "Monitor and enforce the compliance of all persons at the work site" ([S12] cl. 3.3.5(a), 3.3.5(h)); subcontractors "report to and be managed by the principal contractor" (cl. 3.1.5(b)). Pay, transport and accommodation remain with each employer ([S1] Art. 13). **Design implication:** a two-level model. The principal contractor publishes site windows and shared constraints; each employer's supervisor builds and signs its own crew plan; no cross-employer rotation; the evidence pack aggregates per employer and per site.

### 4.5 Supervisor workload

No UAE data [UNV]. The automation-bias review finds that "workload, task complexity, and time constraint" pressurise cognitive resources and that "training and emphasizing user accountability" mitigate it ([S23], abstract). **Design implication:** plan updates are batched at fixed times (not continuous), exception-driven (only changes that matter), and one-tap to accept; but acceptance records who and why. Test with at least three supervisors before claiming usability [UNV]; no such test has been done.

---

## 5. Cross-cutting: who decides and who sees what

This map follows from sections 2 to 4 and drives the data model.

| Party | Decides | Holds legal duty for | Sees in the planner | Must not see |
|---|---|---|---|---|
| Principal contractor | Site windows: crane and lift limits, pour sequence, shared access ([S12] cl. 3.3.5) | Site OSH coordination and monitoring of all persons on site ([S12] cl. 3.3.5(a), (h)) | Site-level zone timeline, per-employer plan status, aggregates | Individual workers' risk, symptoms or stop events |
| Subcontractor (employer of record) | Shift windows (seasonal), crew plans, approvals, pay terms, transport, accommodation | Safe work environment, accommodation, injury compensation ([S1] Art. 13(4), 13(6), 37) | Its own crews' plans, exposure bands, fairness spread, overrides | Other employers' crews; any worker's health data |
| Supervisor / crew lead | Daily plan sign-off, break timing, rotation, immediate stop | Applying the plan and stopping work when needed | Crew-level level, range, tasks, own crew's exposure hours | Individual symptoms or personal risk |
| Worker | Own pace within bounds; stop signal; optional personal features | Following OSH instructions ([S1] Art. 16(6)) | Crew-level level; own personal risk on own device | Others' data |
| HSE officer / DPO (employer side) | Parameter second approval; override review; DPIA | Programme and records ([S14] cl. 3.2, 4(a)(v)) | Audit log, evidence pack, aggregates | Named individuals' health data |
| Regulator or inspector | Inspection and enforcement | Enforcement | Evidence pack: aggregates and site-level records only | Anything below the suppression threshold; any names |

[Inf] The "must not see" column is a design position that goes beyond the law (PDPL Art. 4(4) and 4(8) would let an employer process some of this without consent); it follows from the challenge's R3 and R5.

## 6. Angle 4: Compliance and governance

### 6.1 UAE PDPL (Federal Decree-Law 45 of 2021) [S4, read in full, 2026-11-11]

| Provision | Text (verbatim unless marked) | Consequence for the planner |
|---|---|---|
| Art. 1 "Sensitive Personal Data" | includes "any data relating to such person's health and physical, psychological, mental ... condition" (also in claims doc §5) | Zone levels computed from forecasts for a crew are not personal data; per-worker risk or symptoms are health data |
| Art. 1 "Profiling" | "analyzing or predicting aspects related to his/her ... health, personal preferences, interests, behavior, location, movements or reliability" | Per-worker strain prediction is profiling |
| Art. 2(2)(e), (g) | The law "shall not apply to ... Personal Health Data that has legislation regulating its protection and processing" and to free-zone entities with their own data law | Federal Law 2/2019 may govern health data; worksites in a free zone may follow another regime |
| Art. 4 | Processing without consent is allowed where necessary "for purposes of occupational or preventive medicine in order to assess the employees' ability of to work" (4(4)), "in the field of employment ... to the extent permitted by such Laws" (4(8)), "to perform a contract" (4(9)), to fulfil legal obligations (4(10)) | **Consent is not the legal basis for employer processing.** Consent for optional features is a design promise |
| Art. 5(3), 5(7) | Data "sufficient and limited to what is necessary"; not kept after the purpose is exhausted, unless anonymised | Minimisation and retention limits |
| Art. 6 | Consent must be provable, "clear, simple, unambiguous and easily accessible"; must include "the right to withdraw it easily"; withdrawal possible "at any time" | Consent ledger with proof and one-tap withdrawal |
| Art. 9 | Breach notification to the Bureau and data subjects | Incident process in documentation |
| Art. 10 | DPO required for processing with high-level risk from new technologies, "a systematic and comprehensive assessment of Sensitive Personal Data, including Profiling and Automated Processing", or large volumes of sensitive data | Pilot needs a DPO if per-worker features run |
| Art. 18 | Data subject may "object to any decisions resulting from automated processing, including profiling, particularly those decisions which have legal impact on or adversely affect the Data Subject", **except** where the processing "is agreed upon under the contract", "required under other legislations", or the subject gave prior consent (18(2)); "The Controller shall include the human element in reviewing automated processing decisions at the request of the Data Subject" (18(4)) | A contract clause could remove the right to object, so do not rely on it. Provide a human-review request path regardless |
| Art. 21 | Impact assessment before processing that includes "a systematic and comprehensive assessment of the personal aspects of the Data Subject, using automated processing, including profiling, having legal consequences or serious impact", or "a large volume of Sensitive Personal Data" | DPIA before a pilot with per-worker features |
| Art. 22, 23 | Transfers outside the State need approval of the Bureau, or contractual safeguards, or "explicit consent granted by the Data Subject ... provided that such transfer shall not contradict the public or security interest" | Production compute and storage stay in the UAE (also DoH cl. 3.1.4.5.1); no transfer of personal data in the prototype |
| Art. 28 | Executive Regulations due within 6 months of 2021 | Not issued as of 1 Sep 2026 per Al Tamimi (claims doc §5, secondary); recheck before submission |

**Consent validity in an employment relationship.** The PDPL text is silent on power imbalance. A common comparator is EU guidance that treats employee consent as presumptively not freely given; I tried to fetch EDPB Guidelines 05/2020 and could not retrieve the text, so I cannot quote it ([UNV]). The ILO commentary already supports the design point: informed consent must be genuine, and "Workers may not waive their privacy rights" ([S8] cl. 5.13). **Design implication:** do not use consent as the legal basis for crew-level planning; use it only for optional per-worker features, make refusal consequence-free by construction (the crew plan does not change when a worker declines), and record the refusal as normal.

### 6.2 Federal Law 2/2019 (ICT in the health fields)

Primary text unreachable (section 10). The PDPL preamble lists the law ([S4]). The Ministry's copy, as a search excerpt, gives Art. 13 as: health information and data related to health services provided in the State "may only be stored, processed, generated or transferred outside the State in the cases prescribed by virtue of a decision issued by the Health Authority in coordination with the Ministry", with a fine of AED 500,000 to 700,000 ([Snip]). Whether it reaches a non-health employer's planning tool is unresolved [UNV]. **Design implication:** keep health-adjacent data (per-worker risk, symptoms) on the device or in the UAE region; state that Law 2/2019 is the likely governing law for health data and that legal advice is needed before a pilot.

### 6.3 DoH Responsible AI Standard as a design benchmark [S9, read]

Scope (already verified in claims doc §4): binds DoH and licensed healthcare entities; applied here as a benchmark, not a compliance claim. Mapping:

| Clause (verbatim) | Planner feature |
|---|---|
| 3.1.1.2.1 "AI systems shall incorporate human-in-the-loop or human-on-the-loop mechanisms" | Supervisor sign-off on every plan |
| 3.1.1.2.2 "Clear escalation protocols shall be established ... outlining specific actions and decision points based on varying risk levels" | Level-to-action policy engine; Red escalates to stop |
| 3.1.5 "operate without bias, delivering equitable treatment ... regardless of race, gender, age, socioeconomic status, disability" and 3.1.5.1.2 "Regular data representativeness audit" | Fairness spread and the out-of-planner audit (2.5) |
| 3.1.6 "provide human-interpretable explanations tailored to clinicians, administrators, and patients, with a clear disclosure of input factors and reasoning pathways" | Role-specific explanation per recommendation (6.5) |
| 3.1.6.1.3 "Patients must be informed of their right to opt out of AI-driven services where applicable" | Opt-out for per-worker features; not applicable to the crew plan, which is an employer operational decision |
| 3.1.6.2.3 "end-to-end traceability logs of inputs, outputs, and version history" | Audit log (6.5) |
| 3.1.7.2.3 "Override mechanisms and audit trails must be embedded" | Override with reason code and log |
| 3.1.7.1.2 teams assigned for "Reviewing flagged cases or override events" | Named HSE reviewer of overrides |
| 3.1.4.4.3 anonymisation, differential privacy, secure multi-party computation, federated learning (claims doc §4) | Not implemented; say so |

### 6.4 Anti-discrimination, labour law and ILO conventions

- **Labour law Art. 4(1)** quoted in 2.5 [S1]. A rotation or exclusion rule keyed to nationality or sex would be prohibited discrimination in "equal treatment in the employment". Age is not a listed ground, but DoH 3.1.5 and ILO Code cl. 5.10 ("The processing of personal data should not have the effect of unlawfully discriminating in employment or occupation", [S8]) point the same way. Physiology-based rules (acclimatisation, TWL zone) are legitimate when documented and applied uniformly.
- **ILO conventions** (NORMLEX, read 2026-11-11, URL pattern in [S5]):

| Convention | UAE status |
|---|---|
| C155 Occupational Safety and Health, 1981 | **Not ratified** (94 ratifications; Bahrain ratified 9 Sep 2009) |
| C187 Promotional Framework for OSH, 2006 | Not ratified |
| C161 Occupational Health Services, 1985 | Not ratified |
| C167 Safety and Health in Construction, 1988 | Not ratified |
| C95 Protection of Wages, 1949 | Not ratified |
| C81 Labour Inspection, 1947 | Ratified 27 May 1982 |
| C111 Discrimination (Employment and Occupation), 1958 | Ratified 28 Jun 2001 |
| C100 Equal Remuneration, 1951 | Ratified 24 Feb 1997 |
| C29 Forced Labour, 1930; C105 Abolition of Forced Labour, 1957 | Ratified (27 May 1982; 24 Feb 1997) |
| C1 Hours of Work (Industry), 1919 | Ratified 27 May 1982 (hours: covered elsewhere) |

  HRW 2026 urges Gulf governments to ratify the relevant ILO instrument ([S16]); I could not confirm which. **Documentation implication:** do not say "aligned with C155". Say "UAE has not ratified C155 or C187; the planner follows CoP 11.0 and applies the ILO personal-data code (non-binding) as a benchmark".
- **Labour-law deductions and discipline.** Disciplinary deductions are capped at 5% of wage ([S1] Art. 25(1)(f)). Disciplinary sanctions are in Art. 39 (text not read in detail). Any use of plan-adherence data for sanctions would sit here, which is why the design bans it (6.6).

### 6.5 Accountability: sign-off, audit log, explainability

- **Sign-off.** A plan is published to crews only after a named supervisor of the employer of record approves it. Any crew lead can trigger an immediate stop without approval. The automation-bias review warns that humans over-rely on decision support; mitigators were "training and emphasizing user accountability", showing "confidence levels ... with the output", and whether the system "provides information or a recommendation" ([S23]). **Design implication:** show the uncertainty range, make the supervisor name the reason when departing from the recommendation, and show the recommendation as a recommendation. A sign-off that cannot be refused or edited is the rubber stamp the Standard's "human-in-the-loop" language is meant to prevent. [Inf]
- **Audit log (append-only), minimum fields** [Inf, mapped to DoH 3.1.6.2.3 and CoP 11.0 cl. 4(a)(v)]: forecast source and run time; model and rules versions; every planner input (task movability class, workload class, PPE class, shade, acclimatisation counts, exempt flag, station mapping); recommended plan; approver, time and any edits with reason code; observed-vs-forecast deltas and escalations; stop events at crew level; parameter changes with before and after values.
- **Explainability.** Per recommendation, role-specific: worker (colour, pictogram, one action); supervisor (zone, range, binding rule and clause, why this crew in this slot); HSE (inputs, uncertainty, deviations). Cite the CoP 11.0 clause or Table 1 row next to each action (already the policy-engine design).

### 6.6 The challenge's own governance requirements

R3 and R5 (plan Part A): consent, minimisation, strict access, **no disciplinary or employment use**, crew views "without exposing individual medical detail". Technical enforcement already planned: employer role with no route to individual data (403 plus audit row), k-suppression, purpose-limitation tests in CI. **Additions from this research:** (a) no export that joins plan adherence or stop events to named individuals; (b) a deployment agreement forbidding use of tool outputs for disciplinary action or the Art. 25(1)(f) deduction path, plus a human-review request path ([S4] Art. 18(4)); (c) a DPIA ([S4] Art. 21) and DPO decision as pilot gates.

---

## 7. Angle 5: Regulator, ADPHC and ADOSH

- **Regulators.** Abu Dhabi: ADPHC supervises OSHAD-SF ([Snip], Middle East Construction News); the municipality regulates construction permits and noise ([S22]); MOHRE enforces the federal midday break and receives injury reports ([S3]). Which body inspects a given site depends on its location (mainland vs free zone) [Inf].
- **What helps an inspection without surveillance.** An **inspector evidence pack** per site-day: the TWL/WBGT zone timeline and the forecast version used; the signed plan; which windows were fixed by the principal contractor; exempt-category attestations; parameter changes; overrides and reason codes; crew-level stop events; and aggregates only. It maps directly to CoP 11.0 cl. 3.2(b)(ii) ("process for assessing environmental conditions utilizing the Thermal Work Limit (TWL) to determine work/rest breaks"), cl. 3.2(b)(iii) ("system to communicate current environmental conditions to employees") and cl. 4(a)(v) (heat-stress incident records) ([S14]). It does not contain names, symptoms or per-worker risk.
- **Aggregate-only reporting and small-cell suppression.** Published practice for suppression: a California guide's threshold is "a small numerator is less than 11"; it notes that thresholds "range from 3 to 40 with many being 10 to 15", CDC WONDER "suppresses cells with numerators less than 10", and another network suppresses counts "greater than 0 but less than 6" ([S24]); CMS uses 11 ([Snip]). Crews are often smaller than 11 [UNV, no data].
- **Design implication.** Choose k **by data type**, not one number: k = 10 for any count of symptoms, incidents or escalations tied to health; k = 5 for exposure-hours and zone counts that carry no health information [Inf from [S24]; the roadmap's k = 5 stays for the second class only]. Suppress at site-week and employer level, never crew-day. Apply complementary suppression so a total cannot reveal a suppressed cell (the CHHS page does not discuss it, so cite the technique but not that page for it [UNV]). Crew-level **plans and exposure bands** are shown to the crew's own supervisor because they are task allocation, not health information; crew-level health counts are not. Document this boundary.
- **Honesty point.** With crews under k, a crew-level "symptom" metric cannot exist. R6 asks for symptoms and incidents; report them at site-week level, and state that this is a deliberate limit.

---

## 8. Angle 6: Failure modes and misuse

| Failure mode | Evidence | Safeguard |
|---|---|---|
| Employer uses green windows to justify longer days or more work | HRW 2026: "we have to work until 11:30 a.m. no matter what"; ILO: "limited labour inspection undermines the policy's effectiveness" ([S16], [S6]); TWL Low zone says "No limits on self-paced work" ([S14]) | Plans cannot add scheduled minutes vs baseline; no "extra window" display; cumulative daily hours vs legal cap shown; "Green is not permission to extend hours" copy |
| Gaming the inputs (workload class, PPE, shade, acclimatisation, exempt flag, nearest station) | [Inf]; Bernard et al. 2022 say TWL "requires a higher level of risk acceptance than the WBGT method" (claims doc §3) | Conservative defaults; every edit logged with before/after; edits that lower protection need an HSE second approver; edits appear in the evidence pack |
| Wrong forecast leads to harm | Dew point error about 2.6 C (plan F5); TWL port reads +3.9 to +7.0 W/m2 above published values (ADR 0006) | Plan on the upper quantile; zone on TWL minus 7 W/m2 near edges (ADR 0006 recommendation); observed-vs-forecast escalation; plan expiry on stale forecast; fixed conservative fallback never less protective than the ban |
| Over-reliance and rubber-stamping | Goddard 2012: 74 studies; mediated by workload and time constraint ([S23]) | Show ranges; require reason codes on deviations; periodic drills; report override and acceptance rates to HSE |
| Alert fatigue | Plan F3: about 58% of daytime hours had WBGT of at least 32 in one cell, so a naive alarm fires most of the day; in clinical decision support drug-safety alerts are "overridden by clinicians in 49% to 96% of cases" (van der Sijs 2006, [Snip]; analogy, not occupational) | Probability-graded levels and an alert budget; alert-burden metric vs naive thresholds (already planned) |
| Supervisor pressure on workers to ignore the plan | HRW 2024 "three days' wage deduction" ([S17]) | Plans are bounds not pace; stop signal; no named-individual adherence reports |
| Disciplinary use of data | Art. 25(1)(f) deduction path ([S1]); ILO 5.5, 5.6 ([S8]) | No joins to identity; purpose-limitation tests; deployment agreement |
| Wrong "movability" or exempt flag lets a hot task into the ban window | [Inf] | Exempt category is an attested flag with reason; never inferred; shown on the evidence pack |
| Night and early-start side effects | Sections 2.1 to 2.3 | Earliest-start parameter, night soft cost, pay panel, camp checklist |
| Authority split, plan pushed across employers | CoP 53.0 ([S12]) | Plans scoped per employer; site windows published by the principal contractor |

**Safeguard principles that survive all rows:** advisory only; never relax a legal or ADOSH minimum; the plan can only keep or reduce protective exposure; conservative near zone edges; uncertainty shown; every deviation recorded.

---

## 9. Consolidated requirements for the planner

Types: **HARD** = hard rule in solver or policy engine; **SOFT** = soft cost in the objective; **UI/GOV** = UI or governance safeguard; **DOC** = documentation only. Priority: **Must** = needed for the 20 Nov demo and submission; **Should** = valuable and cheap; **Later** = parked.

| ID | Requirement | Type | Source | Priority |
|---|---|---|---|---|
| H1 | Legal and ADOSH minimums are fixed constants outside the optimiser: midday-ban window as dated config; CoP 11.0 Table 1 work/rest; no unacclimatised worker in Medium/High; no lone work. A green level never relaxes any of them | HARD | [S14]; [S1] Art. 13(6); ILO "fixed restrictions ... may not be enough" [S6] (ban is a floor) | Must |
| H2 | The plan cannot increase any worker's scheduled work minutes vs the baseline plan; cumulative daily hours vs the legal cap are displayed; no "extra window" output | HARD | [S1] Art. 19; HRW [S16]; GLMM excess-hours finding [S18] | Must |
| H3 | Acclimatisation state machine as planned: new 20/40/60/80/100, experienced 50/60/80/100, more than 14 days away resets | HARD | [S14]; NIOSH (claims doc §6) | Must |
| H4 | Plans are scoped to one employer of record; principal contractor publishes site windows; no cross-employer rotation | HARD (data model) | [S12] cl. 3.1.4-3.1.5, 3.3.5; [S1] Art. 13 | Must |
| H5 | Plan against the upper forecast quantile; zone on TWL minus 7 W/m2 near edges; stale forecast expires the plan into the conservative fallback | HARD | ADR 0006; plan 8.5, 8.9 | Must |
| H6 | Exempt-category use (concrete, asphalt, utility repair, permit work) is an explicit attested flag with reason, never inferred | HARD | [S3]; claims doc §1 | Must |
| H7 | Pours are fixed-duration blocks; the planner varies start, crew size and rotation only | HARD | [S3]; [S11] cl. 3.3(a)(ix) | Should |
| H8 | Lifting tasks flagged when forecast wind or gusts reach 38 km/h; manufacturer limit shown if supplied | HARD (flag, not optimise) | [S10] cl. 3.6.6(c)-(e) | Should |
| H9 | Earliest shift start is a site parameter (default 06:00, flagged below it); the plan lists the bus timetable as an employer-confirmed assumption | HARD (configurable cap) plus SOFT | [S13] cl. 3.4(b)(ii); [S19]; [S18] | Should |
| S1 | Stability cost: penalty per change of shift start or crew composition vs the baseline roster; at most one weekly change unless escalated to Red | SOFT | [S13] cl. 3.4(c); Section 1 | Must |
| S2 | Night cost: penalty on work 22:00 to 05:00 and on flipping a crew between day and night | SOFT | [S1] Art. 19(3); [S13] cl. 3.4(b)(viii), 3.5; [S22] | Should |
| S3 | Fairness: rolling 14-day spread of exposed hours per worker pseudonym within a task-equivalence class and employer, minimised | SOFT | [S1] Art. 4(1); [S9] cl. 3.1.5 | Should |
| S4 | Overtime and night-premium estimate per crew vs baseline shown in the plan; weight set by the employer | SOFT | [S1] Art. 19(2)-(3) | Should |
| S5 | Secondary objective: minutes lost vs ban-only baseline (SIMULATED label) | SOFT | Plan 8.5, 8.12 | Must |
| S6 | Update batching: plan changes presented at fixed times, exceptions only, except Red | SOFT | [S23] workload mediator | Should |
| S7 | Commute and waiting heat as an exposure term | SOFT | [S18]; [S19] | Later |
| G1 | Advisory-only banner and floor notice on every plan screen: "Green is not permission to extend work. Legal and ADOSH minimums still apply" | UI/GOV | Section 8 | Must |
| G2 | Supervisor sign-off by name before a plan reaches crews; any crew lead can trigger an immediate stop without approval | UI/GOV | [S9] cl. 3.1.1.2; [S23] | Must |
| G3 | Append-only audit log with the fields in 6.5 | UI/GOV | [S9] cl. 3.1.6.2.3, 3.1.7.1.3; [S14] cl. 4(a)(v) | Must |
| G4 | Role-specific explanation per recommendation, with clause citation and uncertainty range | UI/GOV | [S9] cl. 3.1.6, 3.1.6.3; [S23] | Must |
| G5 | Parameter-change control: before/after log; lowering protection needs an HSE second approver; conservative defaults | UI/GOV | Section 8; [S9] cl. 3.1.7.1.3 | Must (log), Should (second approver) |
| G6 | Deviation from the recommendation requires a reason code; override and acceptance rates reported to HSE | UI/GOV | [S9] cl. 3.1.7.1.2, 3.1.7.2.3; [S23] | Should |
| G7 | Pay-neutrality panel: paid-hours and overtime delta per crew vs baseline; employer attestation that stoppage time is paid under the contract | UI/GOV | [S1] Art. 19, 22(1), 24; [S18] | Should |
| G8 | Worker stop and rest signal: first-class, queued offline, no analytics, excluded from adherence reports | UI/GOV | [S14] self-paced footnote; ADR 0004; [S17] | Should |
| G9 | Symptom reports never reach supervisor or employer dashboards; first-aid escalation only | UI/GOV | [S6] Box 5.1; [S16]; plan R3 | Must (already a design rule; add a test) |
| G10 | No export joins plan adherence or stop events to named individuals; purpose-limitation test in CI | UI/GOV | [S8] cl. 5.5, 5.6; [S1] Art. 25(1)(f) | Must |
| G11 | Small-cell suppression by data type: k = 10 for health-related counts, k = 5 for exposure and zone counts; site-week or employer granularity; complementary suppression | UI/GOV | [S24]; roadmap k = 5 | Must (rule and test) |
| G12 | Inspector evidence pack per site-day, crew-level and aggregate only | UI/GOV | [S14] cl. 3.2(b)(ii)-(iii), 4(a)(v) | Should |
| G13 | Supervisor-led briefing kit: colour boards, pictograms, audio, printable crew card; verbal-consent flow for optional features | UI/GOV | [S8] consent commentary; ADR 0004 | Must (templates), Should (consent flow) |
| G14 | Human-review request path for any plan-driven decision affecting a worker, independent of contract wording | UI/GOV | [S4] Art. 18(2)(a), 18(4) | Should |
| G15 | Alert budget and alert-burden metric vs naive threshold and ban-only | UI/GOV | Plan 8.4; [S23] | Must |
| G16 | Uncertainty range shown with every recommendation | UI/GOV | [S23] mitigators | Must |
| G17 | Fairness audit across protected attributes outside the planner, by HR join, aggregate-only, k-suppressed | UI/GOV | [S9] cl. 3.1.5.1.2; [S4] Art. 5(3) | Later |
| D1 | State the PDPL position: in force, executive regulations not issued (as of the cited sources), Art. 4(8) and 4(9) mean consent is not the basis, Art. 18(2)(a) contract exception, Law 2/2019 likely governs health data; claim "designed to exceed", not "compliant" | DOC | [S4]; claims doc §5 | Must |
| D2 | State DoH RAI scope accurately and include the clause mapping in 6.3, including features not implemented (cl. 3.1.4.4.3) | DOC | [S9]; claims doc §4 | Must |
| D3 | State that UAE has not ratified C155, C187, C161, C167; C81 and C111 are ratified; the ILO personal-data code is non-binding | DOC | [S5]; [S8] | Should |
| D4 | Limitations list: no measured productivity gain or pay effect; GLMM is Dubai 2017 to 2018 and qualitative; commute data are 2014; night-work costs unquantified; no supervisor usability test; nobody has reviewed liability allocation | DOC | Sections 2 to 4 | Must |
| D5 | Liability statement: decision support only; the employer remains the duty-holder; the audit log is evidence; legal and insurer review are pilot gates | DOC | [S1] Art. 13(6), 37; [S14] cl. 3.1.1 | Must (wording), Later (review) |
| D6 | Ramadan and prayer times are configurable calendar rules (Friday 12:45 since 2 Jan 2026; Ramadan hours reduced by 2); Ramadan is not modelled in the 2026 build | DOC | [S26]; [S27]; [S2] | Should |
| D7 | Pilot gates: DPIA and DPO decision, worker briefing and feedback channel in each language, employer deployment agreement banning disciplinary use, phone and site-rule survey, permit status for night work | DOC | [S4] Art. 10, 21; [S8] cl. 12.2; ADR 0004 | Should |
| D8 | State the free-zone caveat: PDPL Art. 2(2)(g) lets free-zone data laws apply to establishments there | DOC | [S4] | Later |

**Changes to the existing design (from this research)**
1. Add the **no-added-hours rule (H2)** and the **floor notice (G1)**; they are cheap and answer the most likely misuse.
2. Add **per-employer plan scoping (H4)**; it affects the data model now, not later.
3. Add the **soft costs for stability, night work and fairness (S1 to S3)**; they define the three-horizon behaviour.
4. Add the **pay-neutrality panel (G7)** and the **limitations (D4)**.
5. Split **k by data type (G11)**.
6. Correct **Friday prayer to 12:45** and demote **Ramadan** from the plan.

---

## 10. Open items, unverified claims, and what I could not reach

**Not reachable or not read (not worked around):**
- `uaelegislation.gov.ae` labour-law and Executive-Regulation pages returned HTTP 403, or Cloudflare "Attention Required" in a browser. The PDPL page loaded in a browser. Consequence: Cabinet Resolution 1/2022 (Executive Regulations: commute categories, grave danger Art. 26, Ramadan hours) was **not read**; the labour-law text used is the u.ae-hosted unofficial translation of the 2021 text, which may predate amendments (Decree-Laws 14/2022, 20/2023, 9/2024 per search results).
- `mohre.gov.ae`, `elaws.moj.gov.ae` and `ehs.gov.ae` refused connections or timed out. `government.ae` failed certificate validation (certificate for another domain) and was not bypassed. Consequence: Federal Law 2/2019 and Administrative Decision 19 of 2023 (accommodation and transport provisions, Art. 11 shade) were **not read**.
- `edpb.europa.eu` Guidelines 05/2020 returned 404 on the paths tried.
- Dubai Municipality TG 02-2024 PDF redirected to the homepage.
- NORMLEX and the PDPL were read through a browser tool; other pages through a fetch tool, whose summaries are marked [P-sum].

**Unverified claims to avoid asserting:** current UAE construction base wages and overtime share; whether heat-stoppage time is paid; whether "shift worker" status removes the night premium for a crew moved to night hours; ACI evaporation threshold in primary text; Dubai 35 C placing limit; Abu Dhabi hot-weather concrete specification; permitted night-work hours in Abu Dhabi; criminal-negligence article; insurer conditions; construction-worker phone ownership; any UAE productivity gain from rescheduling.

**Decisions needed from Ali**
1. Accept k split by data type (10 for health-related counts, 5 for exposure)?
2. Default earliest start (06:00) and whether H9 is hard or soft in the demo.
3. Whether to request a legal review of liability and Law 2/2019 scope before the pilot narrative (it affects what the deck can claim).

---

## 11. Source register

| Tag | Source and URL | Status |
|---|---|---|
| S1 | Federal Decree-Law 33 of 2021 (unofficial English translation hosted by u.ae, original 2021 text): https://assets.u.ae/api/public/content/eb65a60bbff949fa912eddd566613014?v=7174ed78 | [P-tr] |
| S2 | UAE Government, Working hours and overtime: https://u.ae/en/information-and-services/jobs/Sector-of-employment/employment-in-the-private-sector/working-hours | [P-sum] |
| S3 | UAE Government, Health and safety at workplace: https://u.ae/en/information-and-services/jobs/workplace-regulations/health-and-safety-at-workplace | [P-sum] |
| S4 | Federal Decree-Law 45 of 2021 (PDPL), read 2026-11-11: https://uaelegislation.gov.ae/en/legislations/1972 | [P] |
| S5 | ILO NORMLEX, ratifications of C155: https://normlex.ilo.org/dyn/nrmlx_en/f?p=NORMLEXPUB:11300:0::NO:11300:P11300_INSTRUMENT_ID:312300 (other conventions by instrument ID in the same pattern: C187 312332, C81 312226, C111 312256, C100 312245, C29 312174, C105 312250, C161 312306, C167 312312, C95 312240, C1 312146) | [P] |
| S6 | ILO, Working on a warmer planet (2019): https://www.ilo.org/wcmsp5/groups/public/---dgreports/---dcomm/---publ/documents/publication/wcms_711919.pdf | [P] |
| S7 | ILO, "More workers than ever are losing the fight against heat stress" (2024): https://www.ilo.org/resource/news/more-workers-ever-are-losing-fight-against-heat-stress | [P-sum] |
| S8 | ILO, Protection of workers' personal data: code of practice (1997): https://www.ilo.org/wcmsp5/groups/public/---ed_protect/---protrav/---safework/documents/normativeinstrument/wcms_107797.pdf | [P] |
| S9 | DoH Abu Dhabi, Responsible AI Standard V1 (Oct 2025): https://www.doh.gov.ae/-/media/Feature/Resources/Standards/2025/Responsible-AI-Standard-V1.ashx | [P] |
| S10 | ADOSH-SF CoP 34.0 v4.1 (Feb 2026): https://www.adphc.gov.ae/-/media/Project/ADPHC/ADPHC/PDF/OSHAD-SF/Codes-of-Practise/2026/COP-340--Safe-Use-of-Lifting-Equipment-and-Lifting-Accessories-v41-English.pdf | [P] |
| S11 | ADOSH-SF CoP 38.0 v4.1 (16 Feb 2026): https://www.adphc.gov.ae/-/media/Project/ADPHC/ADPHC/PDF/OSHAD-SF/Codes-of-Practise/2026/COP-380--Concrete-Placing-Equipment-v41-English.pdf | [P] |
| S12 | ADOSH-SF CoP 53.0 v4.0 (July 2024): https://www.adphc.gov.ae/-/media/Project/ADPHC/ADPHC/PDF/OSHAD-SF/Codes-of-Practise/53---OSH-Management--Eng.pdf | [P] |
| S13 | ADOSH-SF CoP 25.0 v4.0 (July 2024): https://www.adphc.gov.ae/-/media/Project/ADPHC/ADPHC/PDF/OSHAD-SF/Codes-of-Practise/25---Driver-Fatigue-Prevention-Eng.pdf | [P] |
| S14 | ADOSH-SF CoP 11.0 v4.0 and Technical Guideline, as quoted in `docs/research/2026-11-11-claims-verification.md` §2 (not re-fetched today): https://www.adphc.gov.ae/-/media/Project/ADPHC/ADPHC/PDF/OSHAD-SF/Codes-of-Practise/11---Safety-in-the-Heat-v31-English.pdf | [P] via earlier work |
| S15 | ADPHC Codes of Practice listing: https://www.adphc.gov.ae/en/Legislation/Code-of-Practices | [P-sum] |
| S16 | HRW, "Gulf States: Migrant Workers' Heat Protections Fall Short" (23 Jun 2026): https://www.hrw.org/news/2026/06/23/gulf-states-migrant-workers-heat-protections-fall-short | [P-sum] |
| S17 | HRW, "Gulf States: Inadequate Heat Protection Putting Workers in Peril" (8 Aug 2024): https://www.hrw.org/news/2024/08/08/gulf-states-inadequate-heat-protection-putting-workers-peril | [P-sum] |
| S18 | Fargues, Shah, Brouwer, GLMM Research Report 2/2019, working and living conditions of low-income migrant workers in UAE hospitality and construction: https://media.business-humanrights.org/media/documents/files/documents/GLMM_EN_2019_RR02.pdf | [P] |
| S19 | The National, 15 May 2014 (Dubai bus commute): https://www.thenationalnews.com/uae/dubai-death-crash-has-labourers-on-edge-about-bus-journey-to-work-1.242602 | [S] dated |
| S20 | ATB Legal, 26 Mar 2026, commute time as working hours: https://atblegal.com/blog/news/uae-clarifies-exceptional-circumstances-where-commute-time-may-be-treated-as-working-hours/ | [S] |
| S21 | ACI FAQ on maximum concrete temperature: https://www.concrete.org/frequentlyaskedquestions.aspx?faqid=15 | [P-sum] |
| S22 | Abu Dhabi City Municipality, 12 Mar 2025: https://dmt.gov.ae/en/adm/Media-Centre/News/12Mar2025 | [P-sum] |
| S23 | Goddard, Roudsari, Wyatt, "Automation bias: a systematic review", JAMIA 2012;19:121-127: https://pmc.ncbi.nlm.nih.gov/articles/PMC3240751 | [P-sum] abstract |
| S24 | California CHHS, justification of thresholds: https://kb.data.chhs.ca.gov/ddg-1/6.-justification-of-thresholds-identified | [P-sum] |
| S25 | Fenwick Elliott, "When the heat is on: extensions of time and extreme weather" (29 Dec 2022): https://www.fenwickelliott.com/knowledge-hub/annual-review/ar-2022/when-the-heat-is-on-extensions-of-time-and-extreme-weather/ | [S] |
| S26 | The National, 10 Dec 2025, Friday prayer 12:45 from 2 Jan 2026: https://www.thenationalnews.com/news/uae/2025/12/10/uae-friday-prayers-timing-change-2026 | [S] |
| S27 | Ramadan 2027 (Gulf News, Wego): https://gulfnews.com/uae/ramadan/when-does-ramadan-2027-begin-everything-you-need-to-know-1.500630523 ; https://blog.wego.com/ramadan-2027/ | [Snip] |
| S28 | Gulf News, 29 Apr 2026, worker housing free internet: https://gulfnews.com/uae/government/worker-housing-in-uae-mohre-mandates-free-internet-24-hour-clinics-and-recreational-areas-1.500522852 | [S] |
| Other [Snip] | van der Sijs et al. 2006, JAMIA 13(2):138-147, https://pmc.ncbi.nlm.nih.gov/articles/PMC1447540 ; CMS cell suppression policy, https://www.hhs.gov/guidance/document/cms-cell-suppression-policy (403 on fetch) ; Federal Law 2/2019, https://elaws.moj.gov.ae/UAE-MOJ_LC-En/00_Health/UAE-LC-En_2019-02-06_00002_Kait.html?val=EL1 (unreachable) | not opened |
| Project | `docs/context/challenge-07-plan.md`, `docs/decisions/0004-tiered-alert-delivery.md`, `docs/decisions/0006-physics-wbgt-phs-niosh-twl.md`, `docs/research/2026-11-11-claims-verification.md`, `docs/superpowers/plans/2026-11-11-roadmap.md` | read |
