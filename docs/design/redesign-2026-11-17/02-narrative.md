# 02. The story

Date: 2026-11-17. Role: narrative designer. This replaces the current argument ("here is a statistic, here is a scoreboard, here is proof, and finally here is the product") with a spine in which a person is in trouble first, the product helps them second, and the evidence is the payoff. It changes order, voice and emphasis. It does not change a claim.

## 1. Honesty rules for every line below

Use only the numbers in `D:\dev\stellar-blaze\docs\submission\numbers.md`, quoted exactly, with the ledger key beside them. A number in this document without a key is not a number, it is a placeholder for copy that has no number.

Say: "held-out 2026, every choice fixed on 2024 and 2025 data". "The test plan was written down and locked before the scored run." "One airport station, one summer." "The regulator's zones on the raw forecast raise fewer false alarms and miss more." "The demo site is made up. The demo day is a replay of 14 June 2026." "Hosted in France Central for the demo; designed for UAE North." "Not yet reviewed by a clinician." "Machine-translated, not yet reviewed by a native speaker."

Never say: "beats every policy" (H5 is not met), "never looked at" (raw-forecast diagnostics were read on 11 and 12 November), "prevents illness" or "saves lives" (no worker outcomes), "compliant" or "certified", "legal plan" (aligned with ADOSH rules, not certified), "calibrated probabilities" (reliability: 65 to 75 percent forecast, observed 0.5852; `rel.q.obs_freq`), "in-UAE hosting" for the demo, "the roster shape helps" (the gain is not claimable), "covers hot hours well at every site" (hottest-tercile coverage stays below 0.85; `fc.regime_c.cov90.min` 0.7415, `fc.regime_c.cov90.below_85` 23 strata), anything with the consultant's name, any real worker or patient. "Real-time" is also out: the alert timing to a real phone is not measured; say "within minutes" only as the repo already does ("Crews are notified within about six minutes" on the Stop screen), and only with that source.

## 2. Protagonists and their one-sentence promises

These are composite personas for design and for the video voice-over. They are not real people and are never shown with names or photographs on the site. On screen they are roles.

| Role | Persona (design only) | Their day in one line | The promise, in the user's words |
|---|---|---|---|
| Worker | Imran, 27, rebar fixer on a Musaffah yard, reads Urdu, shares a bunk-room, has one prepaid phone, scans a QR from the crew WhatsApp group | At 05:40 he wants to know one thing: when do I rest today | "My phone tells me, in my language, when to rest and when to stop, and it never asks who I am." |
| Crew lead | Joseph, 41, supervises four crews, reads English, has two minutes between tasks | At 05:30 he needs to know which crew gets hot first and what the plan is | "I see tonight what tomorrow's heat will do to each crew, get a plan that follows the published rules, and stop work in one tap." |
| Safety officer | Fatima, 36, HSE at a contractor, reads reports, answers to ADOSH and to the board | She needs to prove the site follows the rules without becoming a keeper of worker health files | "I can show what we planned, signed and stopped, and I can honestly tell workers that I cannot see their health data." |
| Judge, or a reviewer with ten minutes | An evaluator for the Future Health Digital Innovation Challenge, or an investor | Wants a problem, a product, proof it works, and what happens next, without anyone in the room | "In sixty seconds I understand what this is, I can try it, and when I doubt a number I can see where it comes from." |

Stakeholders beyond the judges are mapped in section 5.

## 3. The story spine of the site

The visitor feels, in order: recognition, relief, trust, then conviction. They learn in this order:

| # | Beat | What the visitor feels | What they learn (plain) | Screen |
|---|---|---|---|---|
| 1 | The problem, in one sentence and one picture | Recognition: "Of course. Heat in the Gulf." | Tomorrow's heat can be planned for tonight; the midday break alone does not cover the hot hours | Hero |
| 2 | Choose who you are | Agency: it is a product, not a paper | There are four ways in; workers need no account | Role door (in the hero) |
| 3 | The worker's morning | Empathy and ease | One sign in the worker's own language, one instruction, "I feel unwell" always there | Worker screen, shown big |
| 4 | The crew lead's plan | Control | Crews worst first, a plan from the published rules, Stop work in one tap with Undo | Crew screen |
| 5 | The boundary | Trust | The service holds no individual health data, so an employer's request is refused, and every worker at the site can see that it was asked | Governance panel |
| 6 | The evidence, as the payoff | Conviction | We tested this on last summer, with the plan written down first; here is how four ways of warning compared; here is where our approach is not better | Scoreboard excerpt |
| 7 | The limits and the next step | Respect for the honesty | One summer, one airport station, no worker outcomes, not clinically reviewed; what a pilot summer would show | Limits block |
| 8 | Depth on demand | Control again | Any number opens "where this number comes from"; "for auditors" opens the full record | Chip and auditor page |

Principle: every number appears once in the story as a sentence about people ("missed 45.5 of 252.5 danger hours"), once in a chart, and once, only if opened, with its technical record. The number never leads a section; the sentence it completes does.

## 4. The 60-second landing story

Desktop, 1280 by 800. Each beat is one screen of scroll. The role door is in the first screen so a visitor can act at second 8; the story below it is for people who read.

| Second | Screen | On-page copy (draft; US English) | Notes |
|---|---|---|---|
| 0 to 8 | Hero | Kicker: "Tested on last summer's real weather at Abu Dhabi airport". H1: "Plan tomorrow's heat tonight." Lede: "Stellar Blaze turns a day-ahead forecast into a work-and-rest plan for each crew, and a plain warning on each worker's phone, in six languages." Role door: "I work on a site", "I run a crew", "I look after safety", "I am reviewing this" (03 section 2). Caption under the heat field: "Forecast heat across the UAE for one hot day. An illustration, not the day we scored." | The field stays (ADR 0037) but loses its six-line readout |
| 8 to 20 | "A morning on site" | Phone sign: "Orange until 17:00. Work 20 min, rest 40 min in shade." Under it: "The worker sees one sign in their own language, with the next change drawn on the clock. 'I feel unwell' is always one tap away. No account, no name." Disclosure tag: "Demo site, made-up crew" | The sign is real component output on the demo site; the six languages are shown as one line of endonyms |
| 20 to 32 | "Tonight's plan" | Crews listed worst first, one plan strip, a Stop work bar. Copy: "The crew lead sees which crew heats up first and gets a plan that follows the published ADOSH rules. Stop work is one tap. So is Undo. It never waits for a sign-off." | Real component output; the Stop bar is shown as it is in the app |
| 32 to 42 | "The boundary" | A refused request and the worker's log line. Copy: "An employer asks for one worker's health record. The answer is no: the service holds none. Every worker at the site can see that it was asked." | From the governance panel (recorded run) |
| 42 to 56 | "Last summer, replayed" | Four horizontal bars, "danger hours nobody was warned about": midday break only 252.5; fixed 32 °C rule 19.0; regulator's zones 80.5; Stellar Blaze (protective) 45.5. Under it: "Warnings that were false alarms: 0.0, 276.5, 74.5, 183.5 hours." Sentence: "The regulator's own zones raise fewer false alarms and miss more. Our protective setting is the cautious end of that trade. The employer picks the setting." Honesty strip: "Tested on summer 2026. Every setting was chosen using 2024 and 2025 data only. The test plan was locked before the scored run." Each number carries "Where this number comes from" | Ledger: `warn.l1.P0.missed_danger_hours` 252.5, `warn.l1.P1.missed_danger_hours` 19, `warn.l1.P2.missed_danger_hours` 80.5, `warn.l1.P3_protect.missed_danger_hours` 45.5; false alarms 0, 276.5, 74.5, 183.5 |
| 56 to 60 | "What this does not show yet" | "One summer, one airport station, no worker outcomes. Not yet reviewed by a clinician. Translations are machine-made. The demo runs on made-up data hosted in France Central; it is designed for UAE North. A pilot summer is how this becomes a health claim." Buttons: "Take the 3-minute tour", "For auditors" | The honest ending is the memorable one |

The 252.5 figure appears in the story as the first bar of the evidence beat, where it is the "no warning" baseline, and as "about 250" in the cold open of the video. It is not in the hero. The interval (191.5 to 315.5) is "likely range 192 to 316" on the bar's tooltip and in the "where this number comes from" line.

## 5. Stakeholder lens: what each person must understand in 30 seconds

| Stakeholder | What they need to understand in 30 seconds | Screen that delivers it | What they must not be able to misread |
|---|---|---|---|
| Investor or accelerator reviewer (60 seconds, wants problem, product, proof, plan) | There is a real, recurring problem; a working product with three user roles; evidence tested with the plan locked in advance, including a result that is not flattering; a credible next step | Hero, then "A morning on site", "Tonight's plan", the evidence beat, the limits block | That this is a health outcome claim, or that the demo is production |
| Contractor or employer buyer (wants cost, compliance, what it changes on site) | What changes on site: a plan per crew, Stop work with a record, no worker health files to hold. Cost: not stated in the product today (see below) | "Tonight's plan" and "The boundary"; a one-line "what changes on site" under the plan; a deck slide for cost | That the plan is certified or that using it removes the employer's own duties. Cost and pilot terms are not in the repo; the owner must supply them for the deck or the page will say "pilot pricing on request" |
| Government or regulator reviewer (ADOSH, DoH: governance, data protection, evidence) | Workers have no account; the employer role cannot obtain individual health data; every refusal is logged and visible to the worker; the zone engine is aligned with ADOSH rules, not certified; not clinically reviewed | "The boundary" and a new "What is stored where" page (03 section 3.4); "For auditors" for the evidence | That the product is certified, clinically reviewed, or already in use at a real site |
| Worker | When do I rest, where do I join, will it tell my boss about my health | Join flow, Today, "What stays on this phone" | Nothing; this is the screen with the simplest language of the product |
| Judge | The six criteria: impact, depth, a working solution, responsible AI, scalability, viability | Role door "I am reviewing this" leads to the guided tour; criteria table on the tour page | See section 7 |

## 6. Three-minute video: storyboard mapped to real screens

Source: `D:\dev\stellar-blaze\docs\submission\2026-11-16-video-script.md`. The beats, the voice, the numbers and the "receipt" idea are kept. What changed, and why:

1. The product moves before the evidence. The current script spends 0:25 to 1:35 on the scoreboard and the day before any person uses anything. The new order is promise, product, evidence, boundary, limits, close.
2. A line is added that the current script lacks: the regulator's zones raise fewer false alarms and miss more. The current VO compares only against the fixed 32 °C rule, which flatters the product. The limitations file already says it; the video must too.
3. "'I feel unwell' takes three taps" is replaced. In the app, the dock link is one tap to the call sheet and "Call 998" is a second, then the phone's own call button (ADR 0065, journeys doc). Say "two taps in our app, then the phone's call button" and mark it CHECK ON CAPTURE, as the script does for other items.
4. The close "No login" becomes "Workers need no account", because the redesign adds a demo role entry for crew leads and officers (03). "No login" would be false once a role entry exists.
5. The 14 June day is folded into the evidence beat as three sentences, including that the fixed 32 °C rule warned about all 7 hours on that day, because the honest version of the day is stronger than the flattering one.
6. The hosting disclosure is added as print on the roadmap beat.

Narration is about 330 words for 180 seconds (the current script's 315 words leave long pauses; the new one fills them with action, not speech). Record at 140 to 150 words per minute.

| Time | Beat | Screen (real route) | Voice-over | On-screen print |
|---|---|---|---|---|
| 0:00 to 0:12 | Cold open | Black, one line, then the heat field settling on the Abu Dhabi airport pin (landing hero) | "Last summer, at Abu Dhabi airport, about 250 working hours were in the High-risk zone. A midday ban does not cover them." (unchanged) | "Hours the station's own instruments put in the ADOSH High zone, summer 2026, working daytime. 95% interval 192 to 316. One airport station, not a worksite. Safety margin of 7 W/m2 assumed." Ledger `warn.l1.truth_danger_hours`, `warn.margin_w_m2` |
| 0:12 to 0:25 | The promise and the front door | Landing hero with the role door; tap "I run a crew" | "This is Stellar Blaze. Tonight it turns tomorrow's forecast into a work-and-rest plan for each crew, and a plain warning on each worker's phone. Pick who you are." | "Demo site. The crews and people are made up." |
| 0:25 to 1:05 | The product | `/supervisor`: crews worst first (the focal sentence); open a crew plan; "try a plan": a long run without a break is refused with the cited article (CHECK ON CAPTURE); Stop work, then Undo. Cut to the phone, Urdu, right to left: the sign, the action sentence; the "I feel unwell" sheet: tap, tap | "A crew lead sees which crew heats up first, and gets a plan that follows the published rules. Try a run that is too long: the rule checker says no and names the article. Stop work is one tap. So is Undo. The worker sees one sign, in their own language, right to left in Urdu. 'I feel unwell' is two taps in our app, then the phone's own call button. It sends nothing to anyone." | "Machine translation, not yet reviewed by a native speaker. Wording of the safety actions: not yet reviewed by a clinician." |
| 1:05 to 1:55 | The evidence | `/replay` scoreboard counters; tap one number: "Where this number comes from"; then `/replay/day` for 14 June | "We replayed summer 2026 against the airport's own instruments, using only a forecast made a day ahead. We wrote down how we would be judged before we ran it, and ran it once. Four ways to warn. The midday break alone warns on none of those hours. A fixed 32-degree rule catches 92 percent and raises about 280 false-alarm hours. The regulator's own zones raise far fewer, about 75, and miss more. Our protective setting misses 45 and raises about 180. Every setting is a trade, and the trade belongs to the employer. Tap any number and it tells you where it comes from. On 14 June, a day chosen by a fixed rule, 7 working hours reached the High zone: we warned about 6 the evening before, the regulator's zones 5, the 32-degree rule all 7. One day is an illustration, not proof." | "Real weather, assumed crew of 20. Fixed rule 276.5 false-alarm hours; ours 183.5; regulator's zones 74.5. Missed danger hours: ban only 252.5, fixed rule 19.0, regulator's zones 80.5, ours 45.5. Ledger keys `warn.l1.*`, `demo.*`" |
| 1:55 to 2:20 | The boundary | `/replay/governance`: send the employer request, the refusal, the worker's log line | "Now an employer asks to see one worker's health record. The answer is no: the service holds none. The attempt is written to a tamper-evident log, and every worker at the site can see it." | "Demo site, recorded run if the live call is unavailable" |
| 2:20 to 2:50 | What this does not show yet, and what is next | A single static slide of the limits and the pilot plan | "One summer, one airport station, public weather data. No worker outcomes, so this is not yet a health claim. The wording of the safety actions has not been reviewed by a clinician, and the translations are machine-made. A pilot summer with sensors on site and workers' own reports is how this becomes one. Here is what it needs." | "Demo runs on made-up data hosted in France Central; designed for UAE North. One test summer. Derived heat-stress truth." |
| 2:50 to 3:00 | Close | Landing, the role door, the address | "Stellar Blaze. Every number says where it comes from. Try it yourself." | "Workers need no account." |

Check against the rules: no "beats everyone" language; the regulator comparison is stated; "ran it once" matches the scored-run claim (the limitations file also says raw-forecast diagnostics were read on 11 and 12 November, which is why the script says "every choice fixed on 2024 and 2025 data" in print and never "untouched"). Add a print line during 1:05 to 1:55: "Every setting was chosen using 2024 and 2025 data only."

## 7. Judge's guided path (the "I am reviewing this" tile)

A single page `/tour` (or the first story step) with the six criteria as plain questions and one link each, in the order a scorer would click: health relevance (the evidence beat), technical depth (for auditors), working solution (try it as a worker, crew lead), responsible AI (the boundary), scale and deployment (limits block and architecture note), viability (the pilot slide). The criteria come from `docs/research/2026-11-11-judges-and-wow-moment.md` section 1.2 and are inference from the sibling programme, not published weights. Build cost is in 05; if it does not fit, the tile opens the existing story at step 1.
