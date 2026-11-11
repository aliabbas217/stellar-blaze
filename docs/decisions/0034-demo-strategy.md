# ADR 0034: Demo strategy: replay-mode wow (Warnings + Plans scoreboard), real-work layer, climate what-if as SHOULD, fixed cut order

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Ali; the architect (Claude)
- **Supersedes / superseded by:** none. Adopts `docs/research/2026-11-11-judges-and-wow-moment.md` v2 §0, §4, §8-§10 (v2 §10 supersedes v2 §3 where they differ) and answers its §10.1 decisions
- **Evidence:** Judges v2 §0 (bottom line), §2.1 (assumed strong field), §4.4-§4.6, §8, §9.1-§9.2, §10, §10.1; ADR 0011 v2 §9, §11; roadmap "Decisions recorded 2026-11-11" (Demo line)

## Context
The top three is chosen across all ten statements, so the bar is the best entry anywhere (Judges §0.1). We design against an assumed strong field whose table stakes are a live WBGT dashboard, simulated wearables, an LLM copilot, a risk map, multilingual alerts and a film (§2.1). What only our data can show: warnings scored against thermometers on a held-out summer, with the forecast as it stood the evening before. Live weather during judging (20-30 Nov) and GITEX (7-11 Dec) will be mild.

## Options considered
| Option | Evidence | Verdict |
|---|---|---|
| Live-weather dashboard as the centrepiece | Table stakes; mild weather at judging | Rejected |
| Optimiser headline ("we move the shift and save X%") | Does not survive law + sleep (ADR 0033) | Rejected |
| "Summer 2026, replayed honestly" scoreboard + real-work + potential layers (chosen) | Judges §4, §8, §9; ~3.1 days with the climate toggle, ~2.4 without | Accepted |

## Decision
1. **Replay mode is the demo spine** (`ReplayForecastSource`, ADR 0002). Order: wow (50 s) → real work (20 s) → potential (25 s).
2. **Wow: the scoreboard, two rows.** Warnings: ban-only vs naive WBGT ≥ 32 vs ADOSH zones on raw IFS vs Stellar Blaze, on held-out 2026 at OMAA (pre-registered site), then one pre-registered day, then the worker card. **Plans**: naive schedule vs ban-only vs rule plan on raw vs rule plan on the corrected protective quantile, scored by the independent validator against truth zones (ADR 0011 §9 metrics 1-3), each with a 95% interval. Never say "minutes avoided" or "illness prevented".
3. **Pre-registration** of metrics, demo day, Plans metrics and the climate method is committed on 12 Nov, before 2026 is scored.
4. **Real-work layer:** pre-registered protocol + reliability diagram; the validator's clause-cited violation list with a judge "try a plan" input; the roster frontier chart (ADR 0024); "proof" chips on every number, generated from exporter `provenance` blocks.
5. **Climate what-if is SHOULD** (17 Nov, only if the 16 Nov gate is green): 2026 replayed at +1.5 / +2.0 °C global warming level from the **IPCC AR6 Atlas, Arabian Peninsula region including sea (ARP landsea, headline)**, land reported too; humidity shown as a **range** (specific humidity fixed vs RH fixed); labelled "sensitivity scenario on a real summer, not a forecast"; no calendar year in the headline. If cut: a static slide or a roadmap line.
6. **The legalisation gain (7.5% / 19.1%) is credited to the law**, shown only on the frontier chart, never on our scoreboard (Judges §10.1 decision 3).
7. **A roadmap screen** ("What's next", status chips exists / designed / needs pilot).
8. **Cut order if late:** climate what-if → validator "try a plan" input → proof chips → Plans row (kept in the report and deck).
9. **Never cut:** the Warnings scoreboard (fallback: a static chart of the same JSON), the pre-registration, the governance refusal (employer → 403 → audit row visible to the worker). Roadmap §7's never-cut list also holds.

## Consequences
- If the numbers disappoint, the Judges §4.5 table applies, decided now: the scoreboard ships with the honest result.
- **Cost of being wrong:** about 2.4-3.1 marginal days go to evidence instead of features; if judges reward visible breadth over verified depth, we score lower on "working solution". Mitigated by the scoreboard being a working screen, not a slide.

## Revisit trigger
The B1 Task 11 data gate fails on 12 Nov (the scoreboard has no data); the A6 schedule re-check on 13 Nov shows the marginal days do not fit; or organisers publish judging weights or named judges that change the criteria balance.

## Links
[Judges doc v2](../research/2026-11-11-judges-and-wow-moment.md) · [ADR 0011](0011-heat-aware-planner.md) · [ADR 0024](0024-cut-seasonal-roster-service.md) · [ADR 0033](0033-superseded-roster-headline-numbers.md) · [ADR 0035](0035-clinical-review-labelling.md)
