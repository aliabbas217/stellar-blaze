# Judges, field and the wow moment (2026-11-11)

**Author role:** competition strategist. **Question:** what do the judges reward, what are the other entries showing now, which features earn their build-days, and which single demo moment separates Stellar Blaze from every other entry while staying true.
**Inputs read:** `docs/context/challenge-07-plan.md`, `docs/context/competition-brief.md`, `docs/superpowers/plans/2026-11-11-roadmap.md`, ADRs 0004-0007, `docs/research/2026-11-11-data-availability.md`, `docs/research/2026-11-11-claims-verification.md`, the organiser captures in `D:\dev\future-health-challenge\research\raw\` (challenge text, landing page, FAQ), and the vault notes "Future Health Challenge", "Judges & Evaluation Mindset", "Past Winners & Participant Experiences", "Competitor Reconnaissance (2026-11)".
**New evidence gathered today:** a public GitHub sweep (`gh search repos` and `gh api` reads only; no git commands, no logins) and a web search pass by a research subagent. Evidence tags: **F** = fetched and read today, **G** = read from a public GitHub repo today, **S** = search-result summary only, **V** = from the vault notes (6 Nov), **R** = from this repo's research files. *Analysis* means my own inference.

**Every number in the wow storyboard that does not exist yet is shown as `⟨name⟩`.** It is produced by B2/B3 code on real data, and the slot names the file that will hold it. Nothing in this document is a result we have not computed.

> **Erratum 2026-11-14 (ADR 0034 amendment; full list at the end of this file).** Four things below are corrected, and the text is kept as written: (1) the "forecast as issued at 18:00 the evening before" stamp is replaced by "forecast made about 24 hours ahead" (18:00 only on the lead-2 sensitivity run); (2) "untouched" and "never looked at" wording becomes "held-out 2026, every choice fixed on 2024-2025 data"; (3) OMAA is a known site, so "new site" claims rest only on the leave-one-cluster-out regimes; (4) the protocol file is `docs/research/2026-11-12-preregistration-2026-evaluation.md` (committed as `661b373`), not `docs/research/2026-11-12-evaluation-protocol.md`.

## Changelog

| Version | Date | Change |
|---|---|---|
| v1 | 2026-11-11 | First version: judges, competitor scan, feature ranking, wow moment "Summer 2026, replayed honestly", video spine |
| v1.1 | 2026-11-11 | Controller steer: differentiation designed against an **assumed strong unseen field** (section 2.1). The competitor scan is shortened and labelled "visible sample, likely incomplete" (section 2.2) |
| v2 | 2026-11-11 | Ali's revision after ADR 0011 v2 (planner). (1) Wow re-checked against the planner numbers; it holds, and the scoreboard gains a **Plans** row scored by the independent validator (section 4.6). (2) New **real-work layer**: three inspectable artefacts and an evidence chip on every number (section 8). (3) New **potential and future layer**: a labelled climate-sensitivity replay of 2026 at +ΔT from IPCC AR6, with a defensibility check, plus a one-screen roadmap (section 9). (4) Priorities, costs and cut order re-ranked (section 10; supersedes section 3 where they differ). The AR6 regional dataset (IPCC-WG1/Atlas, CC BY 4.0) was located; no ΔT has been extracted yet. (5) Corrected: the compliance-report LLM drafter is **kept** as one bounded read-only feature per ADR 0010 §8, not cut; it stays out of the demo spine. (6) Replay mode is the primary demo, because live weather at evaluation (20-30 Nov) and GITEX (7-11 Dec) is mild |

---

## 0. Bottom line

1. **We compete with every entry in the competition, not only Challenge 07 entries.** The landing page names one top three across all ten statements: "The top three teams will be selected solely based on evaluations" and USD 50k/35k/20k "across the top three teams" [F, raw landing]. So the bar is set by the best entry anywhere. Assume the top of each statement brings deep engineering, a film, hundreds of tests and, at best, a pre-registered real-data back-test. At least one visible entry already does each of these (section 2.2: visible sample, likely incomplete). Being the best 07 entry is necessary. It is not sufficient.
2. **We design against an assumed strong, unseen field, not against the visible repos** (controller steer, 11 Nov). Most entries are private until submission, so the public sample is biased and partial. We assume every capable team builds the obvious entry, and we treat all of it as table stakes:
   - a WBGT/heat-index dashboard on live free weather;
   - wearables plus alerts, with simulated physiology;
   - an LLM chatbot or copilot;
   - a generic risk map;
   - multilingual alerts and a supervisor view;
   - an ADOSH/TWL mention;
   - a replay of a real hot day;
   - a polished film and judge sandbox.

   The visible sample (section 2.2) only confirms that these are obvious; it is not used to size our edge.
3. **What is uniquely provable with our data, whatever the field builds.** These follow from the assets we hold: 3 summers × 8 UAE airport stations of instrument observations, archived ECMWF IFS/AIFS and GFS forecasts at fixed lead times, and a pre-registered held-out design [R: data doc, ADR 0005]. A team without this pipeline cannot fake them, and a team with it still has to do the held-out discipline:
   - **(a) Scored against thermometers, not against another model**, with the forecast exactly as it stood the evening before (no hindsight).
   - **(b) An AI correction with calibrated probabilities**, tested on a **summer and sites the model never saw**, with three regimes reported honestly.
   - **(c) The policies a regulator actually uses**, compared on the same real summer: ban-only, a naive threshold, and ADOSH zones on the raw forecast, against ours. The comparison counts both unwarned danger hours and alarm hours.
   - **(d) Raw AIFS (AI) vs IFS (physics) on Gulf humidity.** We found no published evaluation of this (plan E1).

   Points (a) to (c) are the wow moment. Point (d) is a technical-depth exhibit. The obvious entries (dashboard, wearable, chatbot, risk map) can each show a live screen. None can show a season of warnings it would have issued, scored against instruments it did not see.
4. **Chosen wow moment: "Summer 2026, replayed honestly".** It is a 50-second scoreboard replay of the held-out 2026 summer at Abu Dhabi International (OMAA). Four policies run side by side: the midday ban alone, a naive WBGT ≥ 32 rule, the ADOSH zone on the raw forecast, and Stellar Blaze. The scoreboard counts what each would have warned the evening before against what the station's own instruments then recorded. It then zooms into one pre-registered day, then into the worker's phone card for that day. **Marginal build cost: about 1.5 days** on top of B2/B3 work that is already never-cut (section 4.4). **v2:** the wow still holds after ADR 0011. A second scoreboard row, **Plans**, scores the four shift plans with the independent validator against station truth (rule-violation minutes, missed protection). It adds about 0.25 day (section 4.6).
5. **v2 demo spine: wow → real work → potential.**
   - **Wow** (50 s): the summer scoreboard (Warnings + Plans), then one day, then the worker card.
   - **Real work** (20 s): every number carries a "proof" chip opening its protocol line, script, commit and data file. Three artefacts can be inspected in seconds: the pre-registered protocol with the reliability diagram, the validator's clause-cited violation list, and the roster frontier (section 8).
   - **Potential** (25 s): the same 2026 summer replayed at a +ΔT from IPCC AR6 for the Arabian Peninsula, labelled "sensitivity scenario, not a forecast", with humidity bracketed. Then a one-screen roadmap (section 9).
   - **Total marginal build: about 3.1 days with the climate toggle, 2.4 without it**, cut in a fixed order when short (section 10).
6. **Top three to prioritise:**
   1. The honest summer back-test: corrector, calibrated probabilities, Warnings + Plans scoreboard.
   2. The governance refusal shown live: employer → 403 → audit row the worker can see.
   3. The evidence chips plus the independent validator, which makes the depth visibly not a mock-up.

   **Cut:** Landsat, 3D, copilot and shift-drafter LLM agents, the strain model, the population view, DRN, the adaptive conformal arm, the AIFS-feature corrector. The compliance drafter is kept per ADR 0010 but is not in the demo.
   **Demote:** voice audio to one pre-rendered clip; CP-SAT to SHOULD (ADR 0011); real-phone Web Push off the critical path.

---

## 1. The judges

### 1.1 Who they are

- **Still nobody named.** As of 11 Nov there is no judge, mentor, evaluator, checkpoint or webinar speaker named on the Hack2skill page, in the 15 Oct release, or in any search result [F: hack2skill.com/event/futurehealthchallenge; uniindia.com Business Wire copy of the 15 Oct release]. The page still says "an expert panel" and has no pitch round before selection [F].
- **The best predictor is unchanged.** The sibling MIT Solve Future Health Challenge (2026) published 20 judges [V, F: solve.mit.edu/challenges/future-health-challenge]. Half came from DoH and Future Health partners, and the six-person live panel was all DoH plus partners: Al Mannaei (DoH), Al-Bitar (DoH), Koornneef (IHLAD), Shaikh (M42 product), Shchepelina (PureHealth strategy) and a Mubadala Bio representative [V].
- **Expected panel shape** (*Analysis*): strategy, product and population-health executives, plus probably one technical reviewer from a co-creator (Microsoft, MBZUAI or Inception42), plus possibly a Hack2skill pool screener on the first pass.
- **Scoring mechanics** [V, Hack2skill docs]: evaluators open each team's submission sections and click a mark per question. The six criteria are almost certainly the questions. **The package must explain itself with nobody in the room.**

| Likely seat | What they reward | What makes them mark us down |
|---|---|---|
| DoH Health & Life Sciences (Al Mannaei, Al-Bitar) | "act earlier"; "testing and scaling what works in real-world settings"; measurable population outcomes [V] | Unlabelled simulated numbers; a clinical claim wider than the evidence |
| Research-methods (IHLAD, MBZUAI faculty) | Held-out tests, stated failure modes, reproducibility | Circular evaluation (simulator graded by itself); leakage |
| Product (M42, Microsoft) | "Would this ship?": a deployed URL, latency, an offline path, a working phone flow | Slides instead of software; a demo that needs us in the room |
| Strategy and commercial (PureHealth, Mubadala Bio, GITEX audience) | A buyer, a price, a first site, a regulator route | No pilot owner; no cost per worker |
| Hack2skill screener | Can I score this in ten minutes? | A README that does not map to the six criteria |

### 1.2 The six criteria: what a top mark looks like for us

The page's own framing is "Impact first. Then proof that it works." [F, raw landing]. No weights are published.

| # | Criterion | Top-mark evidence for Stellar Blaze | The one artefact a scorer clicks |
|---|---|---|---|
| 1 | **Health impact and clinical relevance** | The ban leaves most dangerous hours uncovered: about 70% of WBGT ≥ 32 hours in the 2025 Abu Dhabi cell [V hub, audited], to be re-derived on station data in B3. We cut unprotected High-zone hours without an all-day alarm. Every action is traced to ADOSH Table 1 or NIOSH, with an escalation card signed by our clinical advisor *if and only if* that review happens | Scoreboard row "unprotected High-zone worker-hours" + the policy-to-clause table |
| 2 | **Technical depth and architecture** | Statistical post-processing (MOS) of temperature and dew point with LightGBM quantiles and CQR. Three validation regimes (known site / held-out cluster / both held out), 2026 as an untouched test summer, CRPS/PIT/coverage, IFS vs AIFS raw comparison, physics kept intact (Liljegren, TWL port, guarded PHS) [R: ADR 0005-0007] | `evaluation-report.md` headline table + reliability diagram |
| 3 | **Working solution and demo quality** | Deployed URL, no login, a "judge's path" of five clicks, the replay runs on frozen data (`ReplayForecastSource`), a 3-minute public video | The replay screen itself |
| 4 | **Responsible AI, safety and data governance** | Employer → individual data = 403 + audit row the worker sees; k-suppression; personal risk computed on the phone; "AI never sets the level"; "why we rejected cameras"; REAL/SIMULATED labels on every number | A 10-second clip of the refusal + the access matrix |
| 5 | **Scalability and deployment readiness** | Azure UAE North (ADR 0001), production data path = ECMWF open data on AWS (CC BY 4.0, commercial use allowed) [R: ADR 0005], hardware-agnostic, offline PWA | One architecture diagram with the in-country boundary drawn |
| 6 | **Commercial viability and path to pilot** | One-page pilot: one site group near the airport cluster, Jun-Sep 2027, KPIs lifted verbatim from statement item 6, buyer = contractor HSE; ADPHC/NCM as data and regulator partners; cost per worker-month **computed from the Azure bill, not guessed** | `docs/pilot-plan.md` |

### 1.3 What won comparable competitions (the signal)

| Event | Winner and what it showed | Lesson for us | Tag |
|---|---|---|---|
| Future Health × MIT Solve 2026 (sibling) | ThinkMD: "more than 9,000 frontline workers across 885 facilities"; signal "before a cholera outbreak in Zambia". Finalists also led with one field number (VectorCam 60% → 90% data completeness; Huna 500,000 lives) | **Lead with one number measured on the real world.** We have no deployment, so our real-world number is a held-out back-test on real instruments | V, F |
| ADGHW 2025 Smart Health Hackathon (DoH) | CloudCare, Limitless; criteria "creativity, feasibility, real-world applicability" | Feasibility and real-world applicability outrank novelty | V, F |
| AI Builders Summit, Abu Dhabi, 11 Sep 2026 (Burjeel/AiMed) | PRISM (triage) gold; live demo day to a jury | Live, legible demos win in this ecosystem | S |
| NSC heat-stress challenge 2025 | Palm-cooling hardware won; pilot grants went to employer-vendor pairs; no pure-prediction product funded | The software-only trap: prediction must end in an action a site will pay for | V |
| Hack2skill / Google Gen AI Exchange 2025 | Jury favoured "production-ready, auditable, explainable" work | Auditability is a scoring axis on this platform | V |
| University of Michigan heat hackathon 2026 | Judged on held-out test metrics | Where data exist, held-out metrics decide | V |

Found nothing new on: named judges; a heat or climate-health AI challenge winner in 2025-2026; ADPHC's heat-index tender; any NCM or MoHRE worker heat-alert product [F/S, research subagent]. The newest policy hook is the MoHAP Health Sector Climate Adaptation Plan 2026-2031 (Gulf News, 23 Oct 2026). It promises "early heat and air-quality warnings" and does not mention outdoor workers [F]. That gives the pitch a policy hook: national plan, worker gap.

**Signal, distilled.** Judges here reward (1) one real-world number in the first breath, (2) proof a stranger can re-run, (3) restraint visibly designed in, and (4) a buyer who could say yes next month. They do not reward screen count, agent count or sponsor tech.

---

## 2. The field

### 2.1 The baseline we design against: an assumed strong, unseen field

Most entries are not public, so we assume the strongest *obvious* entries exist and score well on polish. Everything in this table is treated as table stakes, and the wow moment must beat it on the criteria, not on screen count.

| Obvious entry a capable team builds | What it scores on | Its structural ceiling (why it cannot match our proof) |
|---|---|---|
| WBGT / heat-index dashboard on live free weather, graded levels, multilingual alerts, supervisor view, ADOSH/TWL mapping | Demo quality, local fit | Its numbers are "today's weather through our formula". It has no evidence that its warnings would have been right the night before |
| Wearable + alerts (simulated heart rate or core temperature), often with a Kalman or ML estimator | Personalisation, "AI" | No public worker physiology exists (plan F7), so every performance number is simulated, usually by the same physics as the policy (circular) |
| LLM chatbot / copilot / agents with guardrails, Arabic voice | Novelty, "AI" | Through the judges' governance lens, an LLM near safety decisions is a liability. It shows fluency, not that anyone is safer |
| Generic risk map / regulator heat map | Population framing (the Summit's "To Sense is to Predict" theme) | A map of model output, again with no verification |
| A replay of a real hot day, polished film, judge sandbox, hundreds of tests | Working solution, demo | A day replayed from reanalysis is hindsight. It shows a story, not skill |
| Pre-registered back-test on real outcomes (the best move a top team can make; one visible Challenge 06 entry does it on US data) | Health impact, rigour | The strongest rival archetype. Our counter is the same discipline, on **UAE instruments, the evening-before forecast and the regulator's own zones** |

**Consequence.** Polish, languages, agents, maps and hot-day replays earn no differentiation, whatever any team ships. The only edge that survives a strong unseen field is **proof that would have mattered before the shift, on real UAE instruments, on a summer nobody tuned on** (section 0, point 3). We still match the format standard (five-click judge's path, criteria-to-evidence table, no login) because a strong field will.

### 2.2 Competitor scan (visible sample, likely incomplete: weak evidence only)

A `gh search repos` sweep plus README reads on 11 Nov [G] found 11 public repos naming Challenge 07 (8 on 6 Nov). Visible patterns:
- Real-day replays: Bardan, HeatMitra, Heatline, Shade.
- TWL/ADOSH mentions: Zill, ThermalPulse, SeaGuard.
- Forecast-vs-ERA5 or raw-forecast skill checks: HeatMitra; Zill, with airport METAR spot checks.
- Live voice/LLM features: Bardan, Heatline.
- Visibly simulated evidence: most of the rest.

None of the files I read shows an NWP post-processing correction with calibrated probabilities, held-out sites, or a policy comparison against station truth. A private entry may well do so, so we do not size our edge on this.

Two visible entries set useful *bars*, not competitor sizing:
- **The Challenge 06 Heat Shift Planner** (DrAhmed7887) sets the honesty bar: pre-registered protocols, a rejected model published, a physician-signed card. We match it with section 4.3 and action 6.
- **Bardan** sets the format bar: a judge sandbox, a guided tour, a film, and a criteria table.

One visible technical datum matters for us: Zill measures raw IFS day-1 WBGT bias at three UAE airports of only −0.1 to −0.5 °C. Our corrector's gain on WBGT may therefore be modest, which is why section 4.5 exists.

---

## 3. Signal vs noise: features ranked by judge impact per build-day

Scoring: judge impact 1-5 (how many criteria it moves, and how directly the judges' words point at it) × distinctiveness 1-3 (vs the assumed strong field in section 2.1, not the visible repos) ÷ marginal build-days (beyond what the critical path already pays). "Paid" means the work is on the never-cut path anyway.

| Rank | Feature | Impact | Distinct | Marginal days | Verdict |
|---|---|---|---|---|---|
| 1 | **Policy scoreboard on the held-out 2026 summer** (ban-only vs naive WBGT ≥ 32 vs ADOSH-on-raw vs ours, scored on the evening-before forecast vs station truth) + replay screen | 5 (crit. 1, 2, 3, 6) | 3 | 1.5 (B3 alert-burden is paid; replay JSON + screen are new) | **The wow. Prioritise.** |
| 2 | **Corrector + calibrated probability + 3-regime report** (B2) | 5 (crit. 2, feeds 1) | 3 | paid | **Never cut.** Headline regime (b) next to (a), as ADR 0007 says |
| 3 | **Governance refusal shown live** (403 + audit row visible to the worker; k-suppression) | 4 (crit. 4) | 2 (others describe it; few test it) | 0.25 (tests paid; one screen state for the video) | **Prioritise** as a 10-second beat |
| 4 | **ADOSH TWL zone engine + policy-to-clause table** | 4 (crit. 1, 5) | 1 (now common) | paid | Keep; no longer a headline |
| 5 | **Escalation card signed by a named clinician** (ADOSH §4.5(c) call → move → cool; cite NIOSH/ACSM where readable) | 4 (crit. 1, 4) | 2 | 0.25 + the uncle's review time | **Do it.** A strong clinical team will have one; we must not be weaker |
| 6 | **Raw IFS vs AIFS on Gulf humidity** (one chart) | 3 (crit. 2) | 3 | 0.25 (data ingested) | Keep as one exhibit; it is new evidence |
| 7 | Worker PWA card: 6 locales, pictograms, RTL, offline | 3 (crit. 3, R2) | 1 | paid (F2) | Keep; text + pictogram is enough |
| 8 | Break-things panel (wearable/network/feed lost) | 3 (crit. 3, R4) | 1 | paid | Keep minimal; property test "never less protective than the ban" is the evidence |
| 9 | CP-SAT shift planner, simple | 3 (crit. 1, R5) | 1 (an obvious optimiser feature) | paid | Keep the simple version; **demote the full constraint set** |
| 10 | Web Push to a real phone | 2 | 1 | 0.5 + high risk | **Off the wow path.** Spike stays timeboxed; if it fails, in-app crew relay is the demo |
| 11 | Deterministic one-click ADOSH daily report (no LLM) | 2 (crit. 6) | 1 (obvious) | 0.5 | Could-have, after freeze only if free |
| 12 | Pre-rendered voice clips | 2 | 0 (live voice is an obvious build) | 0.5 + Azure voice check | **Demote**: one Urdu or Hindi clip for the video, review status stated |
| — | Landsat heat layer; 3D site view | 1 | 0 | 1-2 each | **Cut** |
| — | LLM copilot / compliance agent / shift drafter | 2 | 0 (the chatbot archetype; a governance liability) | 1.5-2 + in-UAE GPU story | **Cut** from the submission; one line in the roadmap |
| — | Personal strain model (8.7); population view (8.10) | 1-2 | 0-1 | 1.5-2 each | **Cut** |
| — | DRN comparator; adaptive conformal arm; AIFS-feature corrector | 1 | 0 | 0.5-1 each | **Cut**; name them under "not done" in the report |

**Net effect.** The cuts free about 6 to 9 build-days of stretch work that the roadmap would only have reached if ahead. The wow needs about 1.5. The rest becomes buffer, which a solo build with real-data gates needs (the B1 Task 11 gate can stop B2 cold).

---

## 4. The wow moment

### 4.1 Three candidates, judged

Tests: **TRUE** (backed only by real data or real code behaviour; nothing faked), **≤ 60 s live**, **memorable**, **distinct from the assumed strong field (section 2.1)**, **build cost**.

| Candidate | True? | ≤ 60 s? | Memorable? | Distinct? | Cost | Verdict |
|---|---|---|---|---|---|---|
| **A. "Summer 2026, replayed honestly."** Season scoreboard of four policies on the held-out summer at OMAA, scored on the evening-before forecast vs the station's instruments → zoom to one pre-registered day (three lines: raw forecast, ours with its range, what the station recorded) → that day's worker card | Yes. Weather and forecasts are real; the roster is an assumed shift pattern, labelled | Yes (50 s) | High: a ticking counter of "hours nobody warned about" under the ban is visceral, and it lands the alarm-fatigue point in the same frame | **Yes.** It needs the archived-forecast + station pipeline and a held-out design. The obvious archetypes (dashboard, wearable, chatbot, map, hot-day replay) cannot produce it | ~1.5 d | **Chosen** |
| B. Judge's own phone gets a multilingual voice alert | True (code behaviour) | Yes | Medium. Live multilingual voice is an obvious build for any capable team | No | 1-1.5 d, and the Web Push spike is the roadmap's riskiest integration | Reject as the wow; keep as a 10 s supporting beat only if the spike succeeds |
| C. One-click ADOSH compliance report / regulator heat map | True | Yes | Low on screen; buyer-relevant | No (the generic risk-map / export archetype) | 0.5-1 d | Reject as the wow; optional pilot-slide artefact |

The example in the brief ("time machine replay of a real heat day … raw forecast vs ours vs what actually happened … worker-heat-hours our roster would have avoided") is the right instinct. Evidence says it needs two changes to stay distinctive and true:
1. **Lead with the season, then the day.** A single day can be cherry-picked, and judges know it. Replaying a hot day is an obvious move for a strong field. The season scoreboard is the claim; the day is the illustration.
2. **Avoid "our roster would have avoided" as the headline.** "Avoided" implies an outcome we cannot measure, since no worker data exist (plan F7). The defensible quantity is *exposure warned vs unwarned*: High-zone worker-hours that each policy warned about the evening before, and alarm hours it raised that the station did not justify. That is REAL weather scored against our rules, which is exactly the plan's label for alert burden (plan 8.12).

### 4.2 Definitions (frozen before scoring; commit by end of 12 Nov)

| Term | Definition | Source |
|---|---|---|
| Site | **OMAA, Abu Dhabi International**. Its forecast cell sits next to the Musaffah/KEZAD industrial belt; we claim **only** "the airport station" (ADR 0005: held-out airport clusters, never "any worksite") | ADR 0005 |
| Season | 2026 summer window, 15 May-30 Sep, working daytime 06:00-14:59 UTC (10:00-18:59 GST), **the held-out test summer**, never used for model selection. Report 2024 and 2025 folds in the report, not the video | ADR 0005 |
| Truth | Station "obs-met": Liljegren WBGT and ported TWL from IEM METAR T, Td, wind plus IFS lead-0 radiation and pressure (assumption A2, stated) | ADR 0005, 0006 |
| Danger hour | Truth TWL in the **ADOSH High zone** (< 115 W/m², zoned on TWL − 7 W/m² per the ADR 0006 margin, if B3 adopts it). Heavy-work action per Table 1 = 20 work / 40 rest. Also report WBGT ≥ REL(M) for heavy work as a NIOSH cross-check | Claims doc §2, ADR 0006 |
| Issue time | **18:00 GST the evening before** (lead-1 forecast from the run available then). No information after that time is used: the "no hindsight" rule | — |
| Policies | **P0 ban only** (12:30-15:00, 15 Jun-15 Sep 2026, no other warning); **P1 naive** "WBGT ≥ 32 °C" on the raw IFS forecast; **P2 ADOSH-on-raw**: TWL zone from the raw IFS forecast; **P3 Stellar Blaze**: warn when P(High zone) ≥ θ from the corrected, calibrated forecast, where θ is set on 2024-2025 only | Plan 8.4 |
| Roster (assumed, labelled) | One crew of 20 doing heavy work across the working daytime, minus ban hours when the ban is in force. "Worker-hours" = hours × 20. The weather is real; the crew is an assumption | Plan 8.12 |
| Scoreboard counters | (1) **Unwarned danger worker-hours** (truth High, no evening-before warning); (2) **alarm worker-hours** (warned, truth not High); (3) POD / FAR / CSI; (4) **alerts per worker-shift**. 95% intervals by day-block bootstrap | Plan 8.4, ADR 0007 |
| Demo day | **Pre-registered rule, selected on truth only:** the 2026 test-summer day at OMAA with the **most observed High-zone working hours outside the ban window**; ties go to the earliest date. Chosen *before* looking at P3's performance on it, and shown whatever P3 did that day | Section 4.3 |

**Why select the demo day on truth and not on our performance.** Choosing "the day we did best" is cherry-picking. A judge from research methods will ask, and the strongest rivals will pre-register. If P3 misses hours on that day, the video says so in one line and points to the season scoreboard. An honest miss on a hard day costs less than a suspected cherry-pick.

### 4.3 Pre-registration (0.25 day, 12 Nov, before B2 touches 2026)

Commit `docs/research/2026-11-12-evaluation-protocol.md` containing: section 4.2 verbatim; the metrics; θ-selection on 2024-2025 only; the demo-day rule; the success criterion stated in advance; and the rule that every amendment after scoring is logged with its reason. Proposed success criterion: P3 has fewer unwarned danger hours than P0 **and** fewer alarm hours than P1, both with bootstrap intervals that exclude zero. B2 then scores 2026 **once**.

> **Correction 2026-11-14 (path and wording; the paragraph above is kept).** The pre-registration that was committed is `docs/research/2026-11-12-preregistration-2026-evaluation.md` (commit `661b373`, approved by Ali on 14 Nov, after the "by end of 12 Nov" date above). `docs/research/2026-11-12-evaluation-protocol.md` does not exist. The committed file refines §4.2 rather than quoting it verbatim: the issue time, the held-out wording and the demo-day candidate rule differ, as listed in the erratum at the end of this file.

### 4.4 Storyboard (50 seconds of the video; the same sequence opens the 7-minute live pitch)

| t | Screen | What is on it | Narration (one line) | Numbers that must be real (slot → source file) |
|---|---|---|---|---|
| 0:00-0:08 | **Replay**, map header | Pin on OMAA; date scrubber at 15 May 2026; stamp "Forecast as issued at 18:00 the evening before · scored against the station's thermometers · summer never seen in training" | "This is last summer at Abu Dhabi airport, replayed using only what each forecast knew the night before." | none |
| 0:08-0:28 | **Scoreboard** (four columns: Ban only · WBGT ≥ 32 · ADOSH on raw forecast · Stellar Blaze) | Scrubber runs 15 May → 30 Sep in about 15 s; two counters per column tick up: red "danger hours nobody warned about", grey "alarm hours" | "The ban alone leaves ⟨P0_unwarned_pct⟩ of dangerous hours unwarned. A simple threshold warns almost all day. We warn ⟨P3_POD⟩ of dangerous hours with ⟨P3_alarm_ratio⟩ of the threshold's alarms." | `⟨P0_unwarned_h⟩`, `⟨P1_alarm_h⟩`, `⟨P3_unwarned_h⟩`, `⟨P3_alarm_h⟩`, POD/FAR/CSI per policy, 95% CIs → `artifacts/eval/2026/policy_scoreboard.json` (B3) |
| 0:28-0:42 | **One day** (pre-registered, `⟨demo_date⟩`) | Hour-by-hour band 10:00-19:00: thin line = raw IFS WBGT/TWL as issued; band = our 5-95% range; dots = station truth; ban window shaded; ADOSH High zone shaded red | "On ⟨demo_date⟩ the station was in Abu Dhabi's High-risk zone for ⟨demo_high_h⟩ hours, ⟨demo_high_outside_ban_h⟩ of them outside the ban. The raw forecast called ⟨demo_raw_hits⟩ of them; ours ⟨demo_p3_hits⟩." | per-hour JSON → `artifacts/eval/2026/demo_day.json` (B3) |
| 0:42-0:50 | **Worker card for that day** (phone frame, Urdu, RTL) | Level Red 13:00-17:00; Table 1 action "20 min work / 40 min rest, 1.2 L+ water per hour, never alone"; pictograms; "computed on this phone, never sent to the employer" | "And this is what the crew would have seen the evening before, in their own language." | Action text = ADOSH Table 1 row (claims doc §2); level from the same JSON |

**Disclosures on screen**, small but present throughout:
- "Airport station, not a worksite."
- "Crew of 20 is an assumed schedule."
- "Truth = station temperature, humidity and wind + modelled sunshine."
- "TWL aligned with ADOSH zones, not certified."

**Live variant (7-minute pitch / judge's path).** The scrubber is interactive, and a station selector offers the other clusters (regime (b) numbers). A judge can drag to any 2026 day and see the same three layers, which removes the cherry-pick suspicion entirely.

**Data it needs** (all already on the B1/B2 path): IEM METAR truth for OMAA 2026; Open-Meteo Previous Runs `ecmwf_ifs025` lead-1 for 2024-2026 (T, Td, wind, shortwave, direct, pressure); the B2 corrector quantile grids + CQR offsets; the B1 TWL port + B3 margin decision; the ban calendar as dated configuration. Nothing new to download.

**Build cost**

| Item | Days | Owner / slot |
|---|---|---|
| Pre-registration doc | 0.25 | Ali, 12 Nov |
| `policy_scoreboard` + `demo_day` exporters (four policies, bootstrap CIs, JSON). Extends the B3 alert-burden task, which is already never-cut | 0.5 | B3, 15 Nov |
| Replay screen: scrubber, 4-column scoreboard, day chart with band + dots, worker card reuse (static JSON from `ReplayForecastSource`, no live API) | 0.75 | F2, 17 Nov |
| **Total marginal** | **≈ 1.5** | Funded by the cuts in section 3 |

### 4.5 If the numbers disappoint (decided now, not on 18 Nov)

| Outcome after B2/B3 | What the wow becomes | Why it stays true |
|---|---|---|
| P3 beats P1 on alarms and P0 on unwarned hours (the expected case) | As storyboarded | — |
| The corrector adds little over raw IFS (plausible: Zill measures raw IFS day-1 WBGT bias at only −0.1 to −0.5 °C at three airports [G]; METAR rounding adds about 0.29 °C noise [R]) | Same scoreboard, but the claim shifts from "AI fixes the forecast" to "**calibrated probability lets a supervisor trade alarms for misses knowingly**". Show P3 at two θ values on the same screen. The AI is the uncertainty, not the bias fix | The corrector's real contribution is the honest range (coverage, PIT). Report that the bias gain was small |
| The corrector helps at some clusters (e.g. OMFJ, with large T/Td biases [R]) but not OMAA | Keep OMAA as the replay (the site was pre-registered; never switch after looking). Put the per-cluster table in the report; the live variant lets a judge pick OMFJ | Switching the demo site after seeing results would be cherry-picking |
| P3 is worse than ADOSH-on-raw | Ship the scoreboard anyway, with P2 as the recommended policy. Say "our AI did not beat the regulator's own zones on held-out data; here is why", the way a pre-registered study reports a failed arm | The honest negative is still the only instrument-scored, no-hindsight comparison in the field |

### 4.6 Re-check after ADR 0011 v2 (the planner numbers), and the Plans row

**Does the wow still hold? Yes.** Neither of the planner's findings undercuts it, and one sharpens it:
- **"No roster shape outruns the heat under law, sleep and commute"** (legal templates + sleep model + do-no-harm guard: no change recommended in 18/18 folds at commutes of 30 min or more) [R: ADR 0011 Context 1; `results/roster_frontier.json`]. This removes a tempting false wow ("our optimiser moves the shift and saves X%"). The obvious optimiser entries will claim exactly that. We can show, on real data, why the claim does not survive the law and a night's sleep. It goes in the real-work layer (section 8), not the wow.
- **Legalising the common roster removes 7.5% (≥ 30 °C) and 19.1% (≥ 32 °C) of exposure per worked hour** [R, ADR 0011]. **This gain belongs to the law, not to us.** It may be shown on the frontier chart with that attribution and is never added to our scoreboard.
- **Forecast-driven in-shift ordering gains only 1.3-5.9%** over heavy-first [R]. It is not headlined anywhere.
- **The forecast's real job is tomorrow's ADOSH zone per hour**, turned into the cycles, stop-work and people rules. That is exactly what the scoreboard measures. ADR 0011 §9 makes the planner's own metric the same frame: station truth zones, held-out 2026, the same policies. So the planner **strengthens** the wow. The Warnings row says who was warned; the Plans row says whose shift plan would have actually protected them.

**Plans row** (second row of the same scoreboard; the same pre-registration as section 4.3, extended with ADR 0011 §9 metrics 1-3):

| Column | Plan scored by the independent validator against **truth** zones (ADR 0011 §3) |
|---|---|
| Naive schedule | Every shift minute outside the ban (common practice) |
| Ban only | The ban plus no other control |
| Rule plan, raw forecast | ADR 0011 rule planner fed by raw IFS |
| Rule plan, corrected protective quantile | The same planner fed by B2 |

Counters per column, each with a 95% interval:
- **rule-violation minutes per worker-season** `⟨plan_violation_min_*⟩`;
- **share of truth-High heavy-work minutes the plan would have cycled 20/40** `⟨plan_high_cycled_*⟩`;
- **missed protection**: truth-High/Red ticks scheduled at a lighter cycle, `⟨plan_missed_*⟩`;
- **cost of protection**: rest minutes added vs naive, `⟨plan_rest_added_*⟩` (SIMULATED productivity).

All are written to `artifacts/eval/2026/plan_scoreboard.json` (B3). Roster: the L1 legal default with the assumed crew mix (ADR 0011 §9), labelled.

**What not to say:** "minutes avoided" or "illness prevented". The defensible statement is "rule-violation minutes against the regulator's own table, on instrument truth, that each plan would have scheduled". **Marginal cost: about 0.25 day.** The validator and §9 scoring are already MUST in ADR 0011; this adds only the export and the second row on the screen.

**If the Plans row disappoints** (for example, the corrected and raw plans tie): show it. The tie means "the zone engine and validator do the protecting; the AI's contribution is the honest range". That matches the section 4.5 fallback.

---

## 5. The 3-minute video and pitch spine

One number or one visual per beat. Each slot is filled by real output or the line is cut.

**v2 spine (supersedes the v1 table below where they differ): wow → real work → potential.** Replay mode drives every beat; live weather in late November and December is mild, so a "Today" tab appears only as a 3-second aside ("live feed connected; today is Low zone").

| Time | Beat | The one number or visual | Source |
|---|---|---|---|
| 0:00-0:15 | **Problem** | ~70% of dangerous hours outside the ban (station version if B3 has it) | as below |
| 0:15-1:05 | **Wow** | Scoreboard **Warnings** row → **Plans** row (`⟨plan_violation_min_ban_only⟩` vs `⟨plan_violation_min_corrected⟩` rule-violation minutes per worker-season) → the pre-registered day → the Urdu card | `policy_scoreboard.json`, `plan_scoreboard.json`, `demo_day.json` |
| 1:05-1:25 | **Real work** | Tap a proof chip on the headline number → protocol line (committed before scoring) + reliability diagram; then the validator lists a naive plan's violations with clause IDs; then the roster frontier with "no roster shape outruns the heat" | Section 8 |
| 1:25-2:10 | **Product + governance** | Supervisor plan, worker card offline, break-things; employer → 403 → the worker sees the attempt | Code behaviour (REAL) |
| 2:10-2:35 | **Potential** | The same 2026 summer replayed at +`⟨dT_gwl2⟩` °C (IPCC AR6, Arabian Peninsula): High-zone hours outside the ban `⟨hi_now⟩` → `⟨hi_lo⟩`-`⟨hi_hi⟩` (humidity bracket). Stamp: "sensitivity scenario, not a forecast" | Section 9.1 |
| 2:35-3:00 | **Path to pilot** | One-screen roadmap (section 9.2) + the pilot ask | Section 9.2 |

**v1 table** (kept for history; rows not superseded above still apply to the 7-minute version):

| Time | Beat | The one number or visual | Source |
|---|---|---|---|
| 0:00-0:20 | **Problem** | "The midday break covers 2.5 hours. In summer 2025, about 70% of Abu Dhabi's WBGT ≥ 32 °C daytime hours fell outside it." Visual: one day's heat curve with the ban as a thin shaded slice. Optional context: 51.2 °C at Al Dhafra on 5 Aug 2026 (NCM via Khaleej Times [F]) | Hub audit (city cell, 2025) [V]. **Replace with the B3 station number for 2026 if available**, and say which one is used |
| 0:20-1:10 | **Proof (the wow)** | Section 4.4 scoreboard + day + card | `policy_scoreboard.json`, `demo_day.json` |
| 1:10-1:45 | **Product** | Supervisor: tomorrow's crew plan (heavy tasks moved, rest per Table 1, new workers capped by the acclimatisation ramp). Worker: Urdu/Arabic card offline. Break-things: pull the network → the card stays, the fallback is never weaker than the ban | Code behaviour (REAL); property test green |
| 1:45-2:15 | **Governance** | Switch to the employer role → request one worker's risk → **403**, and the worker's phone shows "Employer tried to view your data · refused · 14:02". Then one line: "No cameras, no individual data to the employer, AI never sets the level" | Governance tests (REAL) |
| 2:15-2:40 | **Depth, in one breath** | One chart: raw IFS vs AIFS dew-point bias across UAE stations (IFS too dry, AIFS too moist: day-1 daytime −1.4 to −1.9 °C vs +1.2 to +1.4 °C [R]). Then the reliability diagram ("when we say 70%, it happens ⟨obs_freq_at_70⟩ of the time") | Data doc §6; B2 report |
| 2:40-3:00 | **Path to pilot** | One site group near the airport cluster, Jun-Sep 2027, KPIs = the statement's item-6 list. Production data = ECMWF open data (commercial use allowed). Hosted in UAE North. Cost per worker-month = `⟨cost_pwm⟩` from the actual Azure bill ÷ an assumed site size. "We are looking for one contractor HSE lead." | ADR 0001, 0005; billing export |

**The opening sentence** (the hub's "first sentence of the video is the headline number" rule):

> "Last summer at Abu Dhabi airport, the midday break left ⟨P0_unwarned_pct⟩ of dangerous working hours unwarned; replayed with only what was known the night before, Stellar Blaze warned ⟨P3_POD⟩ of them with ⟨P3_alarm_ratio⟩ of the alarms a simple threshold raises."

**7-minute live version** (if a jury slot happens before or at GITEX): 0:30 problem → 2:00 interactive replay (a judge picks a day) → 1:30 product + break-things → 1:00 governance refusal → 1:00 pilot and ask → 1:00 "what this does not prove". Keep a recorded fallback, because Wi-Fi fails at events [V].

---

## 6. Actions this creates (for the controller)

| # | Action | When | Owner |
|---|---|---|---|
| 1 | **Confirm the Challenge 07 registration is accepted.** The page says registration closed on 10 Nov (claims doc §11; the subagent re-confirmed today). The roadmap's checklist item 1 is unconfirmed | Today | Ali |
| 2 | Commit the evaluation protocol + demo-day rule (section 4.3) **before** B2 scores 2026 | 12 Nov | Ali |
| 3 | Add `policy_scoreboard` / `demo_day` exporters to the B3 plan (alert-burden task) | When B3 is planned (14 Nov) | Backend architect |
| 4 | Add the replay screen to F2; generate its types from OpenAPI v1 | 14-17 Nov | Frontend architect |
| 5 | Move the cut list (section 3) into `docs/parking-lot.md`; update roadmap §7 | 12 Nov | Ali |
| 6 | Ask the clinical advisor for a dated review of the escalation card and the level-to-action table; if it does not happen, say "not clinically reviewed" | By 17 Nov | Ali |
| 7 | README top: criteria-to-evidence table + five-click judge's path (the format a strong field will use) | 18 Nov | D |
| 8 | Optional: re-run the visible sweep on 18 Nov as a weak signal only. Priorities do not change on it unless a visible entry shows instrument-scored, held-out evidence | 18 Nov | Ali |

## 7. Limits of this analysis

- **The competitor scan is a visible sample, likely incomplete, and is used as weak evidence only.** Differentiation is designed against the assumed strong field in section 2.1.
- **GitHub only shows public builders.** Private or late entries are invisible, so "nobody shows X" means "not in the files I read on 11 Nov". I read READMEs fully for 12 repos and key files for 3 (Bardan forecast model, Zill validation, HeatMitra back-test). I did not read source code for the others.
- **No judge is named**, so section 1 is an inference from the sibling programme and the published criteria.
- **Corrector gain is unknown until B2 runs.** Section 4.5 exists because Zill's airport numbers suggest the raw IFS WBGT bias at OMAA may be small. That cuts against an "AI fixes the forecast" headline and is why the wow compares *policies*.
- **The ~70% and ~58% figures are from the 2025 Abu Dhabi city grid cell (IFS 9 km), not from stations.** B3 will produce station versions; use whichever is stated, never mix them.
- Research subagent findings tagged S (fines, 2024 inspection counts, AI Builders Summit winners) are not cited in any pitch line above.
- **v2:** the AR6 regional dataset was checked for existence, contents and licence only (section 9.1). No ΔT value has been extracted yet, so all climate numbers are slots.

---

## 8. Real-work layer: depth that is visibly not a mock-up (v2)

**The problem it solves.** In a strong field, every entry looks finished: films, tests, sandboxes. A judge cannot tell real analysis from a well-styled mock-up unless the demo lets them **pull the thread on any number in seconds**. The obvious entries cannot offer that, because their numbers come from their own simulator.

### 8.1 The three artefacts judges inspect

| # | Artefact | What it proves | Already on the plan? |
|---|---|---|---|
| 1 | **Pre-registered evaluation protocol + evaluation report with reliability diagram.** `docs/research/2026-11-12-evaluation-protocol.md`, committed before 2026 is scored, so its commit time precedes the results commit; `evaluation-report.md` with the three regimes, CRPS, coverage, PIT and the reliability diagram | The numbers were not tuned after the fact. "When we say 70%, it happens `⟨obs_freq_at_70⟩` of the time" | Yes (section 4.3, B2) |
| 2 | **Independent validator output.** Feed it any plan (the common 06:00-12:30 + 15:00-17:00 roster, our rule plan, a judge's hand edit) and it returns violations with rule id, clause (ADOSH Table 1, Labour Law Art. 18, ban) and tick ranges. It shares no code path with the planners (ADR 0011 §3) | Rules are enforced by code a stranger can poke, not described in a PDF | Yes (ADR 0011 MUST) |
| 3 | **Roster frontier chart.** Exposure vs sleep for 14,596 legal templates, commute slider, B0 vs B1, the legalisation arrow attributed to the law. Caption: "no roster shape outruns the heat under law, sleep and commute" | We tested the obvious optimiser idea on real data and report that it does not survive. A negative result told plainly reads as competence | Yes (ADR 0011 MUST, static) |

> **Correction 2026-11-14 (applies to the path in artefact 1 above; the row is kept).** The protocol file is `docs/research/2026-11-12-preregistration-2026-evaluation.md`, committed as `661b373` on or after 14 Nov, not `docs/research/2026-11-12-evaluation-protocol.md`. "Committed before 2026 is scored" still holds and is what the B2 gate checks; do not quote "12 Nov".

Also available, one click deeper (not in the video): the audit trail (append-only rows including the refused employer request), the governance test names in CI, the data declaration with SHA-256 manifests, and `uv run` one-command reproduction of every scoreboard number.

### 8.2 How the demo surfaces them in seconds: proof chips

- **Every number on every screen carries a small "proof" chip.** Tapping it opens a drawer with four lines:
  - the protocol clause that defined the metric (link and commit);
  - the script and function that computed it;
  - the result file and its SHA-256;
  - the label: REAL / REAL weather + assumed crew / SIMULATED.
- **The drawer content is generated by the exporters**, never hand-written. Each JSON result carries a `provenance` block (protocol path, script path, git SHA, data manifest hash, label), and the UI only renders it.
- **Video beat (20 s):**
  1. Tap the chip on the headline scoreboard number. The protocol line appears, with a commit date before the results.
  2. Switch to the validator. Paste the common roster; 2 seconds later a red list appears ("Art. 18: run 06:00-12:30 exceeds 5 h without a 1 h break …").
  3. Cut to the frontier chart with the one-line verdict.
- **Cost:** `provenance` block in the exporters 0.1 day; drawer component 0.25 day; validator "try a plan" input (a JSON or template picker over the existing validator endpoint) 0.25 day. **≈ 0.6 day.**

---

## 9. Potential and future layer (v2)

### 9.1 Climate-resilience what-if: "the same summer, warmer"

**What it is.** Replay the real 2026 station summer with a temperature increment for a stated global warming level. Recompute WBGT, TWL zones, ADOSH High-zone hours outside the ban, and the rule plan's protective rest minutes. Show how much heavier the same rules become. **It is a sensitivity scenario on a real summer, not a forecast**, and is stamped that way on every pixel.

**Source (checked today, not yet extracted):** IPCC-WG1 Atlas repository, `datasets-aggregated-regionally/data/CMIP6/CMIP6_tas_{land,landsea}`. These are monthly near-surface temperature averaged over the AR6 reference region **ARP (Arabian Peninsula)**, one run per model. The repository also holds the per-model global-warming-level crossing years in `warming-levels/CMIP6_Atlas_WarmingLevels.csv` [G: github.com/IPCC-WG1/Atlas, read 11 Nov].
- **Licence:** "All datasets and notebooks in this repository are provided under the Creative Commons Attribution 4.0 license (CC BY 4.0)". Cite Iturbide et al. 2022 (Sci Data 9, 629) and the IPCC AR6 WGI Atlas chapter [G: `LICENSE.md`].
- **The dataset has temperature and precipitation only. It has no humidity.** That forces the humidity treatment below.

**Method (pre-register with section 4.3 so the scenario numbers cannot be tuned):**
1. **Use warming levels, not years.** AR6 frames regional change by global warming level (GWL); a year like "2050" is an emissions-scenario guess. Primary scenario **+2.0 °C GWL**; secondary +1.5 °C. The 2024-2026 station climatology already sits at a present-day GWL. Per model, take the JJAS mean ARP temperature in the 20-year window centred on the model's GWL-crossing year, minus the same model's 20-year window centred on its present-day level (the crossing of the level matching 2015-2034, from the same CSV). Report the ensemble median ΔT `⟨dT_gwl2⟩` and its 10-90% range. Uniform increment, monthly by JJAS month.
2. **Region choice:** ARP **land** is dominated by the interior desert, where warming is likely larger than on the coast where the stations are. ARP **landsea** includes the Gulf and Red Sea. Report both and headline landsea for the coastal stations [I, stated].
3. **Humidity, bracketed (the defensibility crux).** WBGT and TWL depend strongly on humidity, and the source gives no humidity change.
   - **Lower bracket: hold specific humidity fixed** (keep observed Td, add ΔT to T only; RH falls).
   - **Upper bracket: hold relative humidity fixed** (shift Td so RH is unchanged; specific humidity rises about 6-7% per °C by Clausius-Clapeyron).
   - For the coastal Gulf stations, the moisture source is a warming sea, so the truth is plausibly between the brackets. **The scenario is shown as a range, never a single number.** Report which bracket drives each metric.
   - *(AR6 assesses decreasing near-surface RH over many land regions. I have not verified the ARP-specific statement today, so it is not cited; the brackets cover it either way.)*
4. **Held constant, and stated:**
   - radiation, wind and pressure;
   - the diurnal shape (a mean delta, which understates hot-extreme changes where those warm faster than the mean);
   - ADOSH and the ban rules;
   - the TWL withdrawal-limit decision (ADR 0006). Report how many extra hours fall into the High zone **only because of the >44 °C dry-bulb cap**, because the cap can dominate the result.
5. **Outputs** (`artifacts/scenario/2026_gwl{15,20}.json`, label "SENSITIVITY SCENARIO"):
   - ADOSH High-zone working hours outside the ban, now `⟨hi_now⟩` vs `⟨hi_lo⟩`-`⟨hi_hi⟩`;
   - rule-plan rest minutes per worker-day `⟨rest_now⟩` → `⟨rest_lo⟩`-`⟨rest_hi⟩`;
   - share of the day's ban-season hours outside the ban that are High zone.

**Defensibility verdict: defensible if, and only if:**
- the brackets are shown;
- the GWL framing is used (no calendar year in the headline; "around mid-century under a middle scenario" may appear only in a footnote citing the crossing years from the same CSV);
- the region choice is disclosed;
- the label "sensitivity scenario on a real summer, not a forecast" is on screen.

A judge from research methods will accept a delta-method sensitivity with stated brackets. They will not accept a single "in 2050 workers will lose X hours".

**Value:** Health impact (the problem grows), scalability (the same engine and rules carry forward), commercial (the regulator's tables will bind more hours each decade), and the Summit's "to sense is to predict" framing. It is also unique to us: it needs the station truth replay and the zone engine we already have.

**Cost and risk:**

| Item | Days | Risk |
|---|---|---|
| Fetch the CSVs (small, public), compute per-model ΔT per GWL and month, tests on 2 models by hand | 0.25 | Low. The GWL crossing-year table format must be read correctly; verify on one model against the Atlas web figure |
| Scenario run: shift T (and Td under the RH bracket), re-run Liljegren/TWL/zone + the rule planner on 2026 station truth | 0.25 | Low. It reuses the B1/B3 code paths. TWL cap saturation (above) |
| Replay toggle "2026 · +1.5 °C · +2.0 °C" with the bracket band, plus the label | 0.25 | Low |
| **Total** | **≈ 0.75** | **Main risk is framing**: misread as a forecast. Mitigation: stamp, brackets, GWL wording, proof chip to the method |

**Placement:** SHOULD, built 17 Nov only if the MUST list is green at the 16 Nov gate. If cut, it becomes one static slide from the same computation (0.5 day), or a roadmap line.

### 9.2 Future roadmap: one screen, not built

Each line states what exists today and the trigger to build it. Nothing here is claimed as done.

| Next step | Evidence it is real, not a wish | What exists now | Trigger |
|---|---|---|---|
| **Consented wearable signal** via the existing `ObservationSource` port (ADR 0002) as a per-worker adapter; personal strain computed on the phone (plan 8.7) | The port exists with real (IEM, GHCNh) and in-memory adapters; Kenzen at EGA shows employers will deploy wearables (EGA releases, claims doc §10) | Port + contract tests | A pilot employer with consented devices; freedom-to-operate check vs the Buller patent (plan F8) |
| **Regulator view** (k-suppressed site/zone aggregates for ADPHC: High-zone hours, plans signed, stops) | k-suppression 10/5 and employer scoping already in ADR 0011 §7; CoP 11.0 cl. 4(a)(v) requires incident records | Aggregation rules | ADPHC interest; data-sharing agreement |
| **Production data path: ECMWF open data** (CC BY 4.0, commercial use allowed; AWS replica holds every day since 2023-01-19) | Probed 11 Nov (data doc §3.3, §8) | Probe scripts; `WeatherForecastSource` port | Any commercial pilot (Open-Meteo free tier is non-commercial) |
| **Sub-seasonal outlook (weeks 2-4)** | Rejected *for now* on evidence: no back-testable open archive; weekly anomaly autocorrelation 0.22 at lag 1, ~0 at lags 2-3 (ADR 0011 §10) | Nothing built, by design | An open EC46/GEFS hindcast archive becomes back-testable |
| **Self-hosted LLM for anything touching personal data** | ADR 0010 §8 floor: PERSONAL never leaves our infrastructure; OpenAI-compatible self-hosted route | The routing rule and the bounded compliance drafter (aggregates only) | Pilot needs Arabic/Urdu supervisor Q&A; in-UAE GPU (parking lot) |
| **Pilot design with ADPHC as regulator partner** (proposed; ADPHC not contacted) | KPIs = statement item 6 verbatim; one site group near the airport cluster; one summer (Jun-Sep 2027); shadow mode first (warnings logged, not acted on, for 4 weeks), then live; outcome data = ADOSH incident records + site clinic visits, k-suppressed | Pilot one-pager (D) | A contractor HSE lead says yes; DoH research route confirmed |
| **Non-airport validation** (on-site WBGT/globe sensors at the pilot site) | ADR 0005 revisit trigger; the current claim is limited to held-out airport clusters | — | The pilot site installs a sensor |

**Presentation:** one slide (deck) and the same content as the final screen of the replay ("What's next"), each line with a status chip: *exists* / *designed* / *needs pilot*. **Cost: about 0.1 day** (deck day D).

---

## 10. Re-ranked priorities, costs and cut order (v2; supersedes section 3 where they differ)

Marginal days are on top of the never-cut plan (B1-B3, F1-F2, I1, D) and ADR 0011 MUST.

| Rank | Item | Layer | Marginal days | When | Cut if short? |
|---|---|---|---|---|---|
| 1 | Pre-registration (metrics, demo-day rule, Plans metrics, climate-scenario method) | Wow + real work | 0.25 | 12 Nov | **Never** |
| 2 | Warnings scoreboard exporters + replay screen (season → day → card) | Wow | 1.25 | 15 + 17 Nov | **Never** (fall back to a static chart of the same JSON, 0.25 day) |
| 3 | Plans row (validator-scored, §9 metrics) | Wow | 0.25 | 16 Nov | 4th to cut: keep in the report and the deck |
| 4 | Governance refusal visible to the worker (403 + audit row on the phone) | Product / RAI | 0.25 | 16-17 Nov | **Never** |
| 5 | Proof chips + `provenance` blocks | Real work | 0.35 | 17 Nov | 3rd to cut: replace with a README criteria-to-evidence table linking the same files |
| 6 | Validator "try a plan" input | Real work | 0.25 | 17 Nov | 2nd to cut: show a pre-recorded validator result |
| 7 | Roster frontier chart | Real work | 0 (ADR 0011 MUST) | 15-16 Nov | Per ADR 0011 |
| 8 | Climate what-if toggle | Potential | 0.75 | 17 Nov, if 16 Nov gate green | **1st to cut**: becomes a static slide (0.5 day) or a roadmap line |
| 9 | Roadmap screen/slide | Potential | 0.1 | 19 Nov (D) | Never (it is a slide) |
| 10 | Clinician-signed escalation card | Product | 0.25 + review | by 17 Nov | Never; label "not clinically reviewed" if no review |
| — | One pre-rendered voice clip; CP-SAT (SHOULD per ADR 0011); Web Push real-phone | Product | per roadmap | — | Already demoted |
| — | Landsat, 3D, copilot and shift-drafter agents, strain model, population view, DRN, adaptive conformal, AIFS-feature corrector | — | — | — | **Cut** (parking lot) |
| — | Compliance drafter (LLM, aggregates only) | — | per ADR 0010 | — | Kept per ADR 0010; **not in the demo spine**; first thing dropped if B3 slips |

**Total marginal: ≈ 3.1 days with the climate toggle, ≈ 2.4 days without it** (rows 1-6 and 9-10). The cuts in section 3 freed about 6-9 stretch days, so this fits, but only if the B1 Task 11 data gate passes on 12 Nov. **Cut order when behind:** climate toggle → validator input → proof chips → Plans row. The Warnings scoreboard, the pre-registration and the governance refusal are never cut.

### 10.1 Decisions for Ali

1. **Climate what-if: SHOULD (recommended) or roadmap line only?** It is defensible only with the humidity brackets, GWL framing and the "not a forecast" label. Cost 0.75 day; first to cut.
2. **Headline region for ΔT: ARP landsea (recommended for coastal stations) or ARP land (larger, interior-dominated)?** Both are reported either way.
3. **Accept that the planner's legalisation gain (7.5% / 19.1%) is attributed to the law and never counted in our scoreboard.** Recommended: it protects credibility.

### 10.2 Added actions

| # | Action | When | Owner |
|---|---|---|---|
| 9 | Extend the 12 Nov protocol with ADR 0011 §9 metrics (Plans row) and the climate-scenario method (section 9.1) | 12 Nov | Ali |
| 10 | Add `plan_scoreboard` + `provenance` to B3 exporters; scenario exporter if decision 1 = SHOULD | 15-17 Nov | Backend architect |
| 11 | Proof drawer, Plans row, validator input, climate toggle (if SHOULD), "What's next" screen in F2 | 16-17 Nov | Frontend architect |

## Sources

- Organiser: `D:\dev\future-health-challenge\research\raw\landing_2026-11-06.txt`, `challenges_2026-11-06.txt`, `faq_2026-11-06.txt`; live page http://hack2skill.com/event/futurehealthchallenge/ (F, 11 Nov).
- 15 Oct launch release (Business Wire copy): https://www.uniindia.com/business-wire-india/future-health-launches-global-challenge-to-move-health-innovation-towards-real-world-application-102/214940 (F).
- MIT Solve Future Health Challenge: https://solve.mit.edu/challenges/future-health-challenge (F); Impact Challenge documentary release, 21 Oct 2026: https://www.uniindia.com/business-wire-india/inaugural-future-health-impact-challenge-documentary-released-as-expressions-of-interest-open-for-se/220497 (F).
- MoHAP climate adaptation plan: https://gulfnews.com/uae/health/uae-unveils-national-plan-to-protect-public-health-from-extreme-heat-and-climate-risks-1.500721394 (F).
- 51.2 °C, 5 Aug 2026: https://www.khaleejtimes.com/uae/weather/uae-records-highest-temperature-of-512c-amid-peak-summer-heat-2 (F).
- Midday-break compliance 99%: https://gulfnews.com/amp/story/uae%2Fuaes-midday-work-ban-achieves-99-compliance-1.500635247 (F).
- AI Builders Summit winners: https://www.wam.ae/en/article/c26ysx3-ten-innovative-healthcare-projects-honoured (S).
- GitHub (G, read 11 Nov):
  - https://github.com/NipunDilshanSenevirathne/Bardan (README; `backend/app/forecast/model.py`)
  - https://github.com/Youssef123ya/Future-Health-Digital-Innovation-Challenge (README; `docs/VALIDATION.md`)
  - https://github.com/anshurajbisoyi98-ctrl/heatmitra (README; `docs/BACKTEST.md`)
  - https://github.com/mk-tdev/heatline
  - https://github.com/sidharthunni/thermalpulse-uae
  - https://github.com/DrAhmed7887/hack-future-health
  - https://github.com/samad-zeeshan/shade
  - https://github.com/victorchengwei/seaguard-heatwatch
  - https://github.com/napatkitiprasanpong/heatbank
  - https://github.com/Mariyah52/heatguard
  - https://github.com/abdulmannaan502/heatguard
  - https://github.com/Babigdk/heatshield-ai
- IPCC-WG1 Atlas repository (G, read 11 Nov): https://github.com/IPCC-WG1/Atlas — `datasets-aggregated-regionally/README.md`, `warming-levels/`, `LICENSE.md` (CC BY 4.0). Cite Iturbide et al. 2022, https://doi.org/10.1038/s41597-022-01739-y, and IPCC AR6 WGI Atlas, https://doi.org/10.1017/9781009157896.021.
- Planner evidence (R): `docs/decisions/0011-heat-aware-planner.md` v2; `docs/research/2026-11-11-roster-feasibility.md` (erratum); `docs/research/scripts/roster/results/roster_frontier.json`.
- Vault (V): "Future Health Challenge", "Judges & Evaluation Mindset", "Past Winners & Participant Experiences", "Competitor Reconnaissance (2026-11)" under `C:\Users\LEGION\Documents\Compendium\Ali\Future-Health-Challenge\`.
- Repo (R): `docs/research/2026-11-11-data-availability.md` §5-§7; `docs/research/2026-11-11-claims-verification.md` §1-§3, §11; ADRs 0004-0007; roadmap.

## Erratum 2026-11-14: issue time, held-out wording, known site, protocol path

Added after Ali approved and committed the pre-registration (`docs/research/2026-11-12-preregistration-2026-evaluation.md`, commit `661b373`). Decision record: the "Amendments" of [ADR 0034](../decisions/0034-demo-strategy.md), 2026-11-14. Everything above is kept as written; where it conflicts with this list, this list applies. Evidence: pre-registration §0 (three findings), §4, §10, §14.

| # | Where above | What it says | What applies now |
|---|---|---|---|
| 1 | §0 point 3(a) and point 4; §2.1 (the "evening-before forecast" cell); §3 rank 1; §4.1 candidate A and the "exposure warned vs unwarned" paragraph; §4.2 "Issue time" and "Scoreboard counters"; §4.4 storyboard stamp and narration (0:00-0:08, "as issued" at 0:28-0:42, 0:42-0:50); §5 opening sentence | The forecast is "as issued at 18:00 the evening before", "known the night before" | The headline is **"forecast made about 24 hours ahead"** (`lead_days = 1`, Open-Meteo `previous_day1`). "Issued by 18:00 GST the evening before" is used only for the `lead_days = 2` strict-availability run shown beside it. Reason: the newest IFS run anyone could hold at 18:00 GST on D-1 is the 06 UTC run; the value for 16:00-18:59 GST comes from a run published after 18:00 GST (pre-registration §0.1, §4). The on-screen stamp reads "Forecast made about 24 hours ahead · scored against the station's thermometers · summer never seen in training". The numbers do not change. B2 Task 2 audits `previous_day1`; a further amendment may restore the 18:00 wording if the audit allows |
| 2 | §1.2 criterion 2 ("2026 as an untouched test summer"); §4.2 "Season" ("never used for model selection") | 2026 was untouched | Say **"held-out 2026, every choice fixed on 2024-2025 data"**. Never say "untouched" or "never looked at": raw-forecast diagnostics on 2026 were computed and read on 11-12 Nov (pre-registration §0.2, §10). "Never used for model selection" and "summer never seen in training" stay true |
| 3 | §0 point 3(b) ("sites the model never saw"); §4.2 "Site" and "Season" (the OMAA replay framed as the held-out test) | Reads as if the OMAA scoreboard tested an unseen site | OMAA is in the 2024-2025 training data. The OMAA scoreboard is regime (a), known site and unseen summer. "New site" claims rest only on leave-one-cluster-out regimes (b) and (c), worded "held-out airport clusters", never "any worksite" and never "a site never seen" for OMAA (pre-registration §0.3) |
| 4 | §4.2 heading ("commit by end of 12 Nov"); §4.3; §6 action 2; §8.1 artefact 1 | The protocol is `docs/research/2026-11-12-evaluation-protocol.md`, committed 12 Nov | The file is `docs/research/2026-11-12-preregistration-2026-evaluation.md`, committed as `661b373` after Ali's approval on 14 Nov. §4.2 is refined, not quoted verbatim (for example, demo-day candidates must have all nine working-daytime hours observed; pre-registration §7.4 step 1). The file's own header reads DRAFT and is left unedited because the B2 gate checks its SHA-256 |
| 5 | §9.1 method; §10 row 1 ("climate-scenario method" in the pre-registration) | The climate method is pre-registered with the protocol | The committed file contains no climate-scenario method. Until it is committed (a separate dated file, or a row in the pre-registration's amendment log), no climate number may be shown as pre-registered |

