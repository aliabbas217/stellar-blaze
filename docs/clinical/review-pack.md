# Clinical review pack: heat warnings and escalation cards

- **Version:** 2026-11-14, draft for review. The text below is the text to be reviewed; the label in section 7 applies only to this text.
- **For:** an independent clinical consultant, who is not named here or anywhere in the submission.
- **From:** the project team. No person is named in this pack.
- **We need your response by 2026-11-17** to use the review label in the submission. Without it, the submission says the messages are "not clinically reviewed".

## At a glance
- The product is **decision support for heat safety on construction-type sites in Abu Dhabi**. It tells workers and supervisors a warning level and what published rules say to do. **It never diagnoses**, never asks a worker for symptoms, and never sends a symptom or a personal heat level to an employer or a server.
- This pack asks you to review **ten cards** (section 4): the exact English text a worker or crew mate would see, the published clause beside it, and how each line was derived.
- **Every clinical line comes from published text** (sources in section 3) or is marked as our own wording. Where the published sources disagree or are silent, we say so rather than choose. If you want wording we have not got, please name the published source: we do not ship uncited clinical wording.
- **Four known open questions come first** (section 1), then further questions we found while preparing the pack.
- Please fill the response table (section 5) and return it.

## 1. Known open questions

### Q1. The heat code says "notify supervisor"; our rule says a symptom report never reaches an employer dashboard
- **The published text.** First aid for heat stroke begins "Call emergency contact number and notify supervisor" (ADOSH-SF Technical Guideline "Safety in the Heat" v4.0, §4.5(c)(i)). The Code of Practice also puts a duty on workers: "Employees shall ensure they report any symptoms of heat illness suffered by themselves or fellow employees to their supervisor immediately as per ADOSH-SF - Element 07 - Monitoring, Investigation and Reporting." (CoP 11.0, cl. 3.1.2(e)). The guideline's worker messages say the same: "When you feel unwell tell your supervisor or the work clinic if you have one." and "Report all signs of heat illness to the supervisor (feeling faint, dizziness, fatigue, headache, nausea, vomiting, and cramps);" (Technical Guideline, Appendix 1).
- **Our rule.** Individual symptom reports must not appear on any supervisor or employer dashboard, and nothing about a worker's condition is logged by the product. The reason is practical: workers who fear being identified may hide symptoms.
- **Proposed reconciliation (not yet built).** The sheet offers a **one-tap phone call** to the supervisor or to the site first aider, and to the ambulance. The product itself sends, stores and logs nothing about the call. The phone call is the "notify". The supervisor learns by voice, as the code intends; the employer's own reporting under the code is outside the product.
- **Where the design stands today.** The only call control in the build is **Call 998**. A first-aider row is designed but needs a number the site record does not hold. There is **no supervisor call control**, and no supervisor number exists in the data. The screen currently says "Your supervisor does not see this screen." which is true of the product, but could be read as "you need not tell your supervisor", which cl. 3.1.2(e) requires.
- **Please advise:** (1) Is a one-tap call to the supervisor, with nothing logged by the product, an acceptable way to meet "notify supervisor" for a worker or crew mate facing possible heat stroke? (2) Should the ambulance call always come before the supervisor call? (3) Should the privacy line be reworded, for example "This app tells no one. Call your supervisor or first aider yourself."? (4) If it is not acceptable, what is the minimum that is?

### Q2. "Sip water if awake" was removed from the heat-stroke steps. Please confirm.
- An early wireframe had "sip water if awake" in the heat-stroke steps. It is **not** in Technical Guideline §4.5(c) (call, move to shade, cool by soaking, spraying, sponging, showering or fanning), so it was removed: only cited text may appear.
- Context you should have: drinking **is** in the same guideline for the milder illnesses: heat syncope §4.3(c)(ii) "Slowly drink water, clear juice, or a sports beverage."; heat exhaustion §4.4(c)(ii) "Have them drink plenty of water or other cool, nonalcoholic beverages". It is not in the heat-stroke steps, where the symptoms include confusion and hallucinations.
- **Please advise:** (1) Confirm the heat-stroke card carries no instruction to drink. (2) Confirm the milder-illness card (C4) may carry the printed drinking steps. (3) Should any card say not to give drinks to a person who is confused or drowsy? (No published source for that is on file.)

### Q3. The TWL margin and the level names
- **What a level means.** The product uses the Thermal Work Limit (TWL, W/m²) that ADOSH adopts. It computes an effective TWL = TWL minus a **7 W/m² margin** (a safety margin: the project's calculation reads up to 7.0 W/m² above published reference values, so the margin makes warnings earlier, never later). The level of an hour is the most severe zone that at least 10% of the forecast samples reach (the 10% is adjustable).

| Level word | ADOSH zone (Technical Guideline Table 1, as printed) | Effective TWL edge | Source status |
|---|---|---|---|
| Green | "Low Risk Unrestricted", "140 - 220 <" | 140 W/m² and above | ADOSH zone, our colour word |
| Amber | "Medium Risk Cautionary", "115 - 140" | 115 to under 140 | ADOSH zone, our colour word |
| Orange | "High Risk", "< 115" | 85 to under 115 | ADOSH zone, our colour word |
| Red ("stop") | **none: Table 1 has no stop level** | under 85 | **Our policy**, shown as "POLICY: beyond the ADOSH table; stop work" |

- **The Red edge is ours.** 85 W/m² is derived from assumed metabolic rates (light work 180 W for 45 minutes plus seated rest about 115 W for 15 minutes, over a 1.94 m² body), not from a published threshold. It is adjustable between 60 and 115. We state the limitation openly: a heavy 20 work / 40 rest cycle averages about 111 W/m², so between about 85 and 111 a heavy crew is within ADOSH's rule but above the model's sustainable load.
- **Please advise:** (1) Are "Green, Amber, Orange, Red" acceptable level names for workers? The level is also shown by the word, a position on a four-step scale and a small mark, never by colour alone. (2) Is a fourth "stop" level below ADOSH's High zone appropriate, and is an edge of 85 W/m² defensible, or should stop be decided differently? (3) Is a 7 W/m² margin acceptable? (4) Is "Orange" fairly worded when it means "at least a 10% chance that the hour is High risk"? We say "aligned with ADOSH TWL zones", never "certified" or "compliant".

### Q4. Translations are machine drafts
- The product has six languages: English (the source) and Arabic, Urdu, Hindi, Bengali and Nepali. **All five non-English catalogues are machine-drafted and marked as such** on every screen ("This translation is a machine draft. A native speaker has not reviewed it yet."). The ADOSH steps are machine translations of an exact English source.
- **Your review covers the English text only**, unless you tell us you can assess another language. A native-speaker review of the safety strings (level words, action lines, alert, unwell, push and stop-work text) in all five languages is a separate step that has **not** happened. The review label will not be applied to any non-English text on your review alone.
- ADOSH publishes an official Arabic edition of CoP 11.0, and awareness roll-ups in Arabic, English, Urdu, Hindi, Bengali and Tagalog (none in Nepali). We have not yet used them as a cross-check (their licence is unchecked).
- **Please advise:** which languages, if any, you can assess; and whether any English line is likely to translate dangerously (for example "Confusion/dizziness", "cool", "shade").

### Further questions found while preparing this pack
| # | Question | Card |
|---|---|---|
| F1 | **Cooling method.** ADOSH orders call, move to shade, then cool by soaking clothes, spraying, sponging, showering or fanning. The 2024 UK pre-hospital consensus prefers cold water immersion where possible, otherwise "Shade, strip, spray and fan (S3F)", and "rapid and effective cooling prior to transfer". The card carries ADOSH only. Is that adequate for a worker or crew mate with no first-aid training? Should "strip" (remove outer clothing) be added, and from which source? | C1 |
| F2 | **Hydration figures.** Our line "Drink 1.2 litres of water every hour" matches no single published figure. Table 1 gives per-hour ranges ("600 ml - 1 litre", "1 - 1.2 L", "> 1.2 L") and the same guideline says "2 liters every 2-3 hours" (§5.2); CoP 2(d)(ii) says "at least 2 litres every 2-3 hours". Which figure, if any, should a worker see? Is an upper limit needed? (None is on file.) | C7 |
| F3 | **Acclimatisation.** Table 1 says "No unacclimatised person to work" in the Medium and High zones, yet the guideline's own schedule has new workers working 20% to 80% on days 1 to 4. These are consistent only if those days fall in the Low zone. That is our inference and has not been confirmed with the regulator. Is "no work for you until 18:00" the right message for an unacclimatised worker? | C8 |
| F4 | **Population.** The ACSM abstract speaks of "the athlete"; the UK consensus is about pre-hospital management of exertional heat illness; ADOSH is written for the workplace. Are the principles transferable to site workers, and does the "time is tissue" principle change any card? | C1, C3 |
| F5 | **No signal.** A call needs a mobile network, not internet. The sheet says "Calling works without internet." and has nothing for a phone with no signal. What should it say? Also, the number for the ambulance (998) is verified; the sheet has no number for a site without a first aider. | C2 |
| F6 | **Overlap of signs.** ADOSH lists dizziness and confusion under both heat exhaustion and heat stroke. The text does not say how a layperson tells them apart or when to escalate. The UK consensus says "CNS dysfunction is the key feature differentiating severe EHI from mild EHI". Should the cards give a simple escalation rule, and from which source? | C3, C4 |
| F7 | **Personal level.** A worker's own level is worked out on their phone from type of work, the date they started in heat and clothing. Its three probability bands (10%, 50%, 90%) are a policy and have not been validated clinically. Is it appropriate to show a personal level at all before validation? | C6, C8 |

## 2. Purpose, scope and limits

**Purpose.** To help workers, crew mates and supervisors act on heat risk before illness occurs, and to give a clear route to emergency help when it does.

**What the product tells a worker:** the heat level for their site and crew now and for the shift (Green, Amber, Orange, Red); what to do at that level (work and rest minutes, shade, water, never work alone); a warning when the site or crew level changes; their own level, worked out on their phone, shown only when it is more severe; and an "I feel unwell" sheet that routes to a phone call.

**What the product tells a supervisor:** the level for each crew, the planned work and rest, and a Stop work control. A supervisor never sees an individual's symptoms or personal level; very small crews show their level but hide health detail.

**What it never does:** diagnose or name an illness; ask for, store or transmit symptoms; send a personal level to the server or an employer; give treatment beyond the published first-aid steps quoted below; say a site is "compliant".

**Limits you should weigh.**
- Levels come from a **weather forecast** and a published heat index, not from measuring a person.
- The demonstration uses a **synthetic site and crews**. No real worker data exists.
- The wording below is **draft** until you review it. Until then every clinical card shows "Not clinically reviewed" and, on the worker screens, "Draft wording, awaiting clinical review".
- Strings are quoted from the design prototype and build plan as of 2026-11-14. The build writes the final strings; if any differs, this pack is re-issued before your review closes.

## 3. Sources and what was verified

| Short name | Source | Verification status |
|---|---|---|
| **TG** | ADOSH-SF Technical Guideline "Safety in the Heat", version 4.0, 15 July 2024, 24 pages. https://www.adphc.gov.ae/-/media/Project/ADPHC/ADPHC/PDF/OSHAD-SF/Technical-Guidelines/Safety-in-the-Heat--Eng.pdf | Read from the published PDF (text layer). Sections 3, 4, 5 and Appendix 1 re-read on 2026-11-14; Table 1 read from the rendered page on 2026-11-11 |
| **CoP** | ADOSH-SF Code of Practice CoP 11.0 "Safety in the Heat", version 4.0, July 2024, 12 pages. https://www.adphc.gov.ae/-/media/Project/ADPHC/ADPHC/PDF/OSHAD-SF/Codes-of-Practise/11---Safety-in-the-Heat-v31-English.pdf | Read in full 2026-11-11; clauses 2, 3.1.1, 3.1.2 and 3.2 re-read 2026-11-14 |
| **NIOSH** | "Criteria for a Recommended Standard: Occupational Exposure to Heat and Hot Environments, Revised Criteria 2016", DHHS (NIOSH) Publication No. 2016-106 | Quotes verified against the PDF text on 2026-11-11. The PDF could not be re-fetched on 2026-11-14 (HTTP 403), so those quotes are unchecked since |
| **ACSM** | "ACSM Expert Consensus Statement on Exertional Heat Illness: Recognition, Management, and Return to Activity", Current Sports Medicine Reports 2021;20(9):470-484, doi:10.1249/JSR.0000000000000878; republished 2023;22(4):134-149, doi:10.1249/jsr.0000000000001058 | **Abstract only.** The full text is paywalled and was not read. No ACSM clinical wording is used in any card. Anything attributed to ACSM beyond the abstract is **unverified** |
| **UK consensus** | "Consensus Statement on the Pre-Hospital Management of Exertional Heat Illness", November 2024, 38 pages. https://fphc.rcsed.ac.uk/media/3665/fphc-exertional-heat-illness-consensus-statement-2024-v14-_final.pdf | Open access, read in full 2026-11-11. Used for questions only, never in card text |
| **UAE portal** | "Handling emergencies", https://u.ae/en/information-and-services/justice-safety-and-the-law/Safety/handling-emergencies | Opened 2026-11-14: "998 for ambulance, 999 for police, and 997 for fire department (civil defence)." |

**Citation note.** "§4.5(c)" is a section of the **Technical Guideline**, a separate ADOSH-SF document that CoP 11.0 cites for guidance (for example cl. 3.1.1(f) and 3.2(b)(ii)). It is not a section of CoP 11.0, whose own numbering differs (its section 4 is Record Keeping). Some of our earlier internal papers cite "CoP §4.5(c)"; this pack cites the Technical Guideline.

**Status words used in every card.**
- **Verbatim:** word for word from the cited text (a stated change in punctuation or layout is noted).
- **Adapted:** derived from the cited text with a change we describe.
- **Our wording needing review:** our own words or number, not in any cited text.

**Build status words:** **BUILT** = in the current build plan; **DESIGNED** = in the design prototype, not buildable yet; **PROPOSED** = not planned; shown only if you approve it.

## 4. The cards

### C1. Heat-stroke first aid: call, move, cool
**Appears:** the emergency sheet, below the call buttons. **Build status:** BUILT.

> **Heat-stroke first aid, in ADOSH's words**
> 1. Call emergency contact number and notify supervisor
> 2. Move the sick employee to a cool shaded area
> 3. Cool the employee, using methods such as: soaking their clothes with water; spraying, sponging, or showering them with water; and fanning their body.
>
> Exact text of the ADOSH-SF Technical Guideline "Safety in the Heat" v4.0, §4.5(c).
> Not clinically reviewed · Draft wording

| Line | Source clause (exact) | Status |
|---|---|---|
| Step 1 | TG §4.5(c)(i): "Call emergency contact number and notify supervisor;" | Verbatim |
| Step 2 | TG §4.5(c)(ii): "Move the sick employee to a cool shaded area;" | Verbatim |
| Step 3 | TG §4.5(c)(iii): "Cool the employee using methods such as: 1. Soaking their clothes with water; 2. Spraying, sponging, or showering them with water; and 3. Fanning their body." | Verbatim; the three list items are joined into one sentence and the first letters lowered |
| Heading, source line, labels | none | Our wording needing review |

Context printed with the clause (TG §4.5(a)): "Heat stroke is the most serious heat-related disorder. ... When heat stroke occurs, the body temperature can rise to 106 degrees Fahrenheit or higher within 10 to 15 minutes. Heat stroke can cause death or permanent disability if emergency treatment is not given."

**Review questions.** (1) Step 1 and Q1. (2) The text is written for a first aider ("the sick employee"). Is it understandable and safe when read by the worker or a crew mate? (3) F1: is call, move, cool, with no mention of removing clothing or staying with the person, enough? (4) Q2: no drinking instruction here. (5) Is the order right if the person is already unconscious?

### C2. "I feel unwell": the call sheet
**Appears:** opened from a button that is always visible on every worker screen. Nothing is sent or logged; the timer lives only on the phone for the session. **Build status:** the Call 998 button is BUILT; the first-aider row is DESIGNED (no number in the site record); a supervisor call row is PROPOSED (Q1).

> **You tapped at 11:10** · timer 0:00, a ruler from "Tap" to "10 min"
> **Call 998** · Ambulance *(BUILT; second button text: "Call 998 · Ambulance")*
> **Call first aider** · Site first aider, `<site name>` *(DESIGNED; shown only when the site has a number)*
> Calling works without internet.
> *When offline:* Offline. Calling still works. It does not need internet.
> *When no first-aider number is set:* Ask the nearest person to call your first aider. No first aider number is set for this site.
> **Your supervisor does not see this screen.**
> Then the card C1.

| Line | Source | Status |
|---|---|---|
| Call an emergency number first | TG §4.5(c)(i): "Call emergency contact number and notify supervisor;" CoP 3.2(j)(ii): "ensure fellow employees and/or supervisors know how to call for additional emergency medical assistance if required or if the employee complains of chest pains, or has symptoms of heat stroke." | Adapted |
| "998" and "Ambulance" | Not in ADOSH text. The UAE portal: "998 for ambulance" (opened 2026-11-14) | Our wording needing review (the number is verified) |
| "Call first aider" | CoP 3.2(j)(i): "Ensure first aid or medical treatment is readily available if an employee begins to feel symptoms of heat illness or dehydration" | Adapted |
| "Your supervisor does not see this screen." | None; reflects our rule (Q1) | Our wording needing review |
| Timer and 10-minute ruler | None. A design choice; the only related published fact is TG §4.5(a), "within 10 to 15 minutes" | Our wording needing review |
| "Calling works without internet." and the offline and empty-state lines | None | Our wording needing review |

**Review questions.** (1) Q1 in full. (2) Should 998 or the first aider come first, and what if both are available? (3) Is a visible elapsed timer helpful, or could it add pressure or false reassurance? (4) F5: what should the sheet say with no signal? (5) Should the sheet say anything about staying with the person while calling?

### C3. Warning signs that need emergency help
**Appears:** not in the current build. **Build status:** PROPOSED.

> **Call for emergency help now if you see:**
> - Hot, dry skin or profuse sweating
> - Hallucinations
> - Chills
> - Throbbing headache
> - High body temperature
> - Confusion/dizziness
> - Slurred speech
> - Chest pains

| Line | Source clause (exact) | Status |
|---|---|---|
| The seven signs, in this order | TG §4.5(b): "Symptoms of heat stroke include: (i) Hot, dry skin or profuse sweating; (ii) Hallucinations; (iii) Chills; (iv) Throbbing headache; (v) High body temperature; (vi) Confusion/dizziness; and (vii) Slurred speech." | Verbatim (list items only) |
| "Chest pains" | CoP 3.2(j)(ii): "...call for additional emergency medical assistance if required or if the employee complains of chest pains, or has symptoms of heat stroke." | Adapted (the source's word, placed in the list) |
| "Call for emergency help now if you see:" | None | Our wording needing review |

Not on the list because **no verified source gives it**: collapse, seizure, loss of consciousness. An earlier internal suggestion included "collapse" and "seizure"; it was not sourced and is not used.

**Review questions.** (1) Is a single emergency list safe, given that "profuse sweating", "dizziness" and "confusion" also appear under heat exhaustion (F6)? Does it risk over-calling, and does that matter? (2) Should collapse, seizure or loss of consciousness be added? From which published source? (3) Terms such as "hallucinations" and "slurred speech" may be hard for low-literacy workers: pictograms or simpler words? (4) F4: does ACSM's principle ("time is tissue") change the wording? Only the abstract is verified.

### C4. Milder signs and what to do now (cramps, faint or dizzy, exhaustion)
**Appears:** not in the current build. **Build status:** PROPOSED.

> **Muscle cramps** (muscle pain or spasms, usually in the abdomen, arms, or legs)
> - Stop all activity, and sit in a cool place
> - Drink clear juice or a sports beverage
> - Do not return to strenuous work for a few hours after the cramps subside because further exertion may lead to heat exhaustion or heat stroke
> - Seek medical attention if any of the following apply: the employee has heart problems; the employee is on a low-sodium diet; and the cramps do not subside within one hour
>
> **Faint or dizzy** (light-headedness, dizziness, fainting)
> - Sit or lie down in a cool place when they begin to feel symptoms
> - Slowly drink water, clear juice, or a sports beverage
>
> **Heat exhaustion** (heavy sweating; extreme weakness or fatigue; dizziness, confusion; nausea; clammy, moist skin; pale or flushed complexion; muscle cramps; slightly elevated body temperature; fast and shallow breathing)
> - Have them rest in a cool, shaded or air-conditioned area
> - Have them drink plenty of water or other cool, nonalcoholic beverages
> - Have them take a cool shower, bath, or sponge bath

| Block | Source clause | Status |
|---|---|---|
| Cramps | TG §4.2(b)(i) and (c)(i)-(iv) | Verbatim (lists joined; item 4's three conditions joined into one sentence) |
| Faint or dizzy | TG §4.3(b)(i)-(iii) and (c)(i)-(ii) | Verbatim |
| Heat exhaustion | TG §4.4(b)(i)-(ix) and (c)(i)-(iii) | Verbatim |
| The three bold headings | None | Our wording needing review |

**Review questions.** (1) F6: the lists overlap with heat stroke and the text gives no rule for escalating. What is the simplest safe rule? (2) Q2 and Q1: should each block also say to tell the supervisor, as TG Appendix 1 and CoP 3.1.2(e) do? (3) "Drink clear juice or a sports beverage" sits beside advice elsewhere in the same guideline to avoid "large amounts of sugar" (§5.4(a)(vi)) and that sports drinks are "not designed for prolonged consumption at work" (§5.6(c)(i)). Acceptable as printed? (4) The cramp advice to seek medical attention for "heart problems" and a "low-sodium diet" asks a worker to apply facts about their own health that the product does not hold. Keep?

### C5. Crew-mate prompt
**Appears:** proposed as a one-line prompt on the worker screen at Orange and Red, and on the emergency sheet. **Build status:** PROPOSED. The "Never work alone" line and a two-person pictogram are BUILT (card C7).

> **Look out for signs of heat illness in the people you work with and take them to a shady area and cool them down. Call for help.**

| Line | Source clause (exact) | Status |
|---|---|---|
| The prompt | TG Appendix 1: "Look out for signs of heat illness in the people you work with and take them to a shady area and cool them down - call for help." | Adapted: the source's dash and lower-case "call" become a full stop and a capital, because the product bans dashes in visible text |
| Optional second line | TG §5.5(a)(viii): "Monitor your physical condition and that of your co-workers." | Verbatim |
| When it is shown (Orange and Red) | None | Our wording needing review |

**Review questions.** (1) Is it right to show this at all levels, only at Orange and Red, or only on the emergency sheet? (2) CoP 3.1.2(e) also makes it a duty to report a fellow employee's symptoms to the supervisor immediately (Q1): should the prompt say so? (3) Is "take them to a shady area" safe if the person has collapsed?

### C6. Rest and shade prompt for each warning level
**Appears:** the one line under the level on the worker's Today screen and on the alert card. **Build status:** BUILT (the build maps a code to a message; an unknown code shows "Follow the site rules").

| Level | Exact text | Source clause (exact) | Status |
|---|---|---|---|
| Green | Work at your own pace, drink water | Table 1, Low Risk Unrestricted: "No limits on self-paced work for educated, hydrated workers."; work-rest: "Safe for all continuous self-paced work" | Adapted |
| Amber | Work 45 min, rest 15 min in shade | Table 1, Medium Risk Cautionary, work-rest: Light "Safe for continuous self-paced light work"; Heavy "Continuous paced work 45 work - 15 rest". CoP 3.2(i): "...provided a cooler area to rest during breaks..." | Adapted: the heavy-work cycle is shown for everyone (protective reading); a light-work crew is told more than Table 1 requires |
| Orange | Work 20 min, rest 40 min in shade | Table 1, High Risk: Light "45 work - 15 rest"; Heavy "20 work - 40 rest"; "Strict Work/Rest cycling required" | Adapted: heavy-work cycle for everyone; a light-work crew sees 20/40 where Table 1 allows 45/15 |
| Red | Stop work. Go to shade | **None. Table 1 has no stop level** | **Our wording needing review** (the level is our policy, Q3) |

Companion lines: "Site level, the same for everyone at this site." and "Your own level, worked out on this phone." (our wording); when the personal level is higher, "Your own level is higher." (our wording). A forecast-based level is shown with "until 17:00" style end times.

**Review questions.** (1) Is it acceptable to apply the heavy-work cycle to all work (more protective, but it will often be wrong for light work)? (2) Table 1 distinguishes "self-paced" (the worker may adjust) from "paced" work. "Work 45 min, rest 15 min" reads as paced. Does that matter? (3) Is "rest in shade" enough at Orange, or should it say a cool or air-conditioned area where one exists (CoP 3.2(i); TG §4.4(c)(i) names "air-conditioned")? (4) Q3 for Red. (5) F7 for the personal level.

### C7. Water and "never work alone" lines
**Appears:** the "Also now" list on Today and on the alert card. **Build status:** BUILT.

| Exact text | Source clause (exact) | Status |
|---|---|---|
| Drink 1.2 litres of water every hour | Table 1, rehydration per hour: Low light "600 ml - 1 litre"; Medium light "1 - 1.2 L", heavy "> 1.2 L"; High "> 1.2 L". TG §5.2: "...you should be drinking 4-6 liters of water per day while in the Gulf region (2 liters every 2-3 hours)." CoP 2(d)(ii): "(at least 2 litres every 2-3 hours)". TG §5.3(b): "Drink regularly, even if you don't feel thirsty." | **Our wording needing review.** "1.2 litres" is not a printed target (it is the edge between "1 - 1.2 L" and "> 1.2 L"); the sources differ among themselves (F2). The build's code reads "over 1.2 L", which matches Table 1 better than the text above |
| Never work alone | CoP 3.2(e): "Employees shall not work alone in heat stress areas, in accordance with ADOSH-SF - CoP 30.0 - Lone Work and/or in Remote Locations." Table 1: Medium "Working alone to be avoided"; High "No person to work alone" | Adapted: stronger than Table 1's Medium wording, equal to the CoP's "shall not" |
| (Green line) "drink water" | TG §5.3(b) and §5.5(a)(v): "Drink water frequently. Drink enough water that you never become thirsty;" | Adapted |

**Review questions.** (1) F2: which hydration figure, if any, belongs on a worker's screen, and should it vary by level and by type of work? (2) Is an upper limit needed to avoid over-drinking? (No published limit is on file.) (3) TG §5.6 advises "a little extra salt to their meals" and that "salt tablets are not permitted". Does the product need to say anything about salt or electrolytes?

### C8. Acclimatisation messages
**Appears:** Today and the alert card, for a worker whose own level is higher because they are new to the heat. The worker tells the app how long they have worked in heat (the first build asks for a start date; the later design replaces it with two choices, "new" and "experienced"); anyone who does not answer is counted as new (protective default in the later design). **Build status:** BUILT in design; the personal level is worked out on the phone.

> **New to this heat: no work for you until 18:00**
> Waypoints: "You are new to this heat" · "Still no work for you" · "Amber or Orange until 18:00"
> Alert: **For you: new to this heat.** "Your own level, worked out on this phone. ADOSH Table 1: no unacclimatised person works in the Medium or High zone, so no work for you until 18:00."

| Line | Source clause (exact) | Status |
|---|---|---|
| "no work for you" in Amber or Orange | Table 1 Medium and High: "No unacclimatised person to work" | Adapted |
| Who counts as new | Table 1 footnote: "Unacclimatised workers are defined as new workers or those who have been off work for more than 14 days due to illness or vacation leave (in a cool climate area)" | Adapted (what the app asks is not settled: a start date in the first build, "new" or "experienced" in the later design; a long absence is not clearly asked) |
| Ramp (not shown to workers yet) | TG §3: new employee 20%, 40%, 60%, 80%, 100% of the full work assignment on days 1 to 5; experienced employee 50%, 60%, 80%, 100%, 100%. CoP 3.2(b)(i): "an allowance of 5-7 days for acclimatization before starting hard work in a hot environment". TG §5.1: "It takes over two weeks to become fully acclimatized; however adaptation is rapid in the first few days." NIOSH: "Gradually increase exposure time in hot environmental conditions over a period of 7 to 14 days." "For new workers, the schedule should be no more than 20% of the usual duration of work in the hot environment on day 1 and a no more than 20% increase on each additional day." | Verbatim as quoted; not yet in any message |
| The sentences themselves, "until 18:00" | None | Our wording needing review |

**Review questions.** (1) F3: is "no work for you until 18:00" correct, given the ramp? (2) Should the message say what the worker should do instead (rest in shade, tell the supervisor, ask for light duties)? (3) Could a blunt "no work for you" lead workers to hide how long they have been in the heat? (4) Is defaulting a worker who did not answer to "new" acceptable? (5) Should the app ask about an absence of more than 14 days, which makes a worker "unacclimatised" again under Table 1?

### C9. Stop-work messages
**Appears:** the worker's Red level (above, C6) and the supervisor's crew screen. **Build status:** BUILT. These are the supervisor-side lines; the clinical question is about stopping and resuming, not delivery.

> Worker, Red: **Stop work. Go to shade**
> Supervisor, after Stop: **Crew B stopped 11:10. Stop recorded.** A 10 second Undo follows; afterwards **Work stopped 11:10**, with **Resume work** behind a confirmation.
> Supervisor, no signal: **Not sent: no signal. Tell the crew now.**
> Plan banner: **Green is not permission to extend work. Legal and ADOSH minimums still apply. Advisory only; the employer remains the duty-holder.**

| Line | Source | Status |
|---|---|---|
| Stop work. Go to shade | None. The Red level is our policy (Q3) | Our wording needing review |
| Stop and resume lines, banner | None. The product lets a supervisor stop at any time; it states the employer remains the duty-holder | Our wording needing review |

The product records the stop; it does not confirm that any phone was alerted, so the text does not say so.

**Review questions.** (1) Resuming work is one confirmation with no clinical prompt. ACSM's title includes "Return to Activity" but its full text is unverified, so we hold no source on return to work. Should "Resume work" carry a prompt, for example to check that no one who showed signs is returning to work? From which source? (2) Is "Go to shade" sufficient after "Stop work", or should it say what to do next?

### C10. No fresh forecast: site rules
**Appears:** Today and the alert card when the forecast is missing, expired or cannot be reached. **Build status:** BUILT.

> **Site rules: rest in shade every hour, drink water**
> *Longer form in the prototype:* Until it loads, follow the site rules: midday break 12:30 to 15:00, rest in shade every hour, drink water.
> *Stale forecast:* Last known level · "This may be out of date. Levels refresh when you are back online."

| Line | Source | Status |
|---|---|---|
| "rest in shade every hour, drink water" | Table 1, High Risk: "Strict Work/Rest cycling required"; CoP 3.2(i) (cooler area to rest) | Adapted |
| "midday break 12:30 to 15:00" | The UAE midday break, 15 June to 15 September (not clinical; verified from the state news release on 2026-11-11) | Adapted |
| "Last known level", "This may be out of date..." | None | Our wording needing review |

**Review questions.** (1) When there is no forecast the planner treats every working hour as the High zone (a protective plan), but the text gives no durations. Should it say 20 work, 40 rest (heavy) and 45/15 (light), or stay general? (2) Is "rest in shade every hour" enough?

## 5. Response table
Please mark each row **Approve**, **Change** or **Reject**, add a comment, and give the date. For "Change", please name the published source for any new clinical wording.

| Item | Approve / Change / Reject | Comment or requested change (source please) | Date |
|---|---|---|---|
| Q1 supervisor and the privacy line | | | |
| Q2 drinking and heat stroke | | | |
| Q3 level names, Red edge, 7 W/m² margin | | | |
| Q4 translations: languages you can assess | | | |
| F1 cooling method | | | |
| F2 hydration figures | | | |
| F3 acclimatisation | | | |
| F4 population | | | |
| F5 no signal | | | |
| F6 overlap of signs | | | |
| F7 personal level | | | |
| C1 Heat-stroke first aid | | | |
| C2 "I feel unwell" call sheet | | | |
| C3 Warning signs needing emergency help | | | |
| C4 Milder signs and what to do now | | | |
| C5 Crew-mate prompt | | | |
| C6 Rest and shade prompt per level | | | |
| C7 Water and "never work alone" | | | |
| C8 Acclimatisation messages | | | |
| C9 Stop-work messages | | | |
| C10 No fresh forecast: site rules | | | |
| **Overall: review complete** (Yes / No, with the date) | | | |

## 6. What your review will not be used for
- The review covers the English cards and the design in this pack. It does not cover the forecasting model or the engineering.
- It does not add uncited clinical wording: any change you ask for goes back to a published source before it appears.
- Nothing from your response will name you, give your title or institution, or be quoted without your agreement.

## 7. The review label
The label **"Reviewed by an independent clinical consultant, `<date>`"** will be used **only after a completed review of this pack**, with the date of completion, and with **no name, no title and no institution** anywhere in the submission, deck, video or repository. It applies only to the English text as reviewed: not to a string changed afterwards, not to the machine-drafted translations (Q4), and not to any card marked not reviewed in the table above. Until then, and for any card not reviewed, the product shows **"Not clinically reviewed"**.

## Internal traceability (for the project team; remove before sending)
- Decisions: ADR 0035 (label and no name), ADR 0004 (no personal data on the server), ADR 0045 amendments (the call sheet; flag F2), ADR 0046 and 0047 (level policy, Red edge, 7 W/m² margin), ADR 0058 (no-forecast fallback), ADR 0059 and 0061, ADR 0062.
- Prototype and plan text: `docs/design/v2/prototype/{worker-unwell,worker-today,worker-alert,supervisor-crews}.html` (F1 worktree) and `docs/superpowers/plans/2026-11-14-f2-core-demo-screens.md` Tasks 16 to 20.
- Earlier open questions: `docs/design/HANDOFF.md` Q1, Q2, Q6, and decision 2.
- Research: `docs/research/2026-11-11-claims-verification.md` §2, §6, §7; `docs/research/2026-11-11-shift-regulations-and-sleep.md` §3; `docs/research/2026-11-11-roster-stakeholders-and-compliance.md` G9 and §2.7.
- C9: F2 plan Task 19 words the Stop confirmation "Stop recorded; the crew's phones are being alerted." That conflicts with the plan's own rule (Global Constraints and Review Focus 3: the server row is "recorded", never "crew alerted"; ADR 0058: pushes run only from `sb-jobs alerts dispatch`, with no HTTP trigger). The pack uses the rule-consistent text; the plan text needs correcting before the build.
- The first-aider and supervisor call rows need phone numbers the `Site` record does not carry (F2 plan Task 18); only Call 998 is buildable as planned.
- Clause quotes marked "re-read 2026-11-14" were extracted from the two ADOSH PDFs downloaded that day; the extraction is in the session scratchpad, not in the repository.
- **Change note 2026-11-14 (citation; corrected in place because this pack is new and unsent).** Three places said or implied that "§4.5(c)" belongs to CoP 11.0. (1) The source line of card C1 read "Exact text of ADOSH-SF CoP 11.0, Technical Guideline "Safety in the Heat" v4.0, §4.5(c)."; it now reads "Exact text of the ADOSH-SF Technical Guideline "Safety in the Heat" v4.0, §4.5(c)." (2) The Citation note in section 3 said the Technical Guideline "sits under CoP 11.0"; it now says it is a separate document that the CoP cites for guidance. (3) Q2 said "ADOSH §4.5(c)"; it now says "Technical Guideline §4.5(c)". Checked against both ADOSH PDFs on 2026-11-14: Technical Guideline §4.5 is "Heat Stroke" and (c) is the first-aid clause (page 9 of 24); CoP 11.0 has sections 1 to 5 and its §4 is Record Keeping (MD5s in ADR 0065). The quoted clause text was not changed. The same fix is made by dated erratum in ADR 0035, ADR 0045, the F2 plan, the judges research doc and (as a verification note) the claims-verification doc.
- **Change note 2026-11-14 (ADR 0065; not an edit).** Q1 and C2 are left as written, because they describe the proposal and the build state. ADR 0065 (accepted 2026-11-14) adopts three one-tap calls (supervisor, site first-aider, 998) subject to this review. The status words "PROPOSED" (supervisor row) and "DESIGNED" (first-aider row) change when the plan has a task for the `Site` phone fields. The line "Your supervisor does not see this screen." is still in the card text; ADR 0065 decision 4 flags it as risky and leaves its replacement to Q1 question 3.
