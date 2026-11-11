# B3 planner: design notes for the B3 plan (input, not the plan)

**Written:** 2026-11-11. **Decision:** `docs/decisions/0011-heat-aware-planner.md` (ADR 0011, Proposed). **Slot:** roadmap §1 Mon 16 Nov (planner), with exporters on Sun 15 Nov alongside the alert-burden task. **Interfaces used:** B1 physics `domain/physics/{wbgt,niosh,twl,phs}.py` (`rel_wbgt_c`, `effective_wbgt_c`, `twl_w_m2_array`, `apply_withdrawal_limits`), B1 Task 7A `Ruleset` / `TunableSpec` / `Floor` / `RuntimeConfig` / `EffectiveParams`, `composition.py` registries, B2 calibrated quantile grids (`calibration_pair`), ADR 0010 config snapshot and audit events. OR-Tools 9.15.6755 is already pinned (ADR 0008).

## 1. Components
| # | Component | Layer | Location (hexagonal, ADR 0009 contracts) | Must / Should |
|---|---|---|---|---|
| 1 | Ruleset `ae-heat-2026.1` sections `[labour]`, `[planner]`, `[stability]`, `[privacy]` + the ADR 0011 §6 tunables (`sleep_gate_h`, `rest_interval_h`, `notice_days`, `freeze_days`, `noise_floor_wh`, `earliest_start_flag`, `max_consecutive_days`, `stability_alpha`, `fairness_beta`, `planner_det_time_s`, `k_health`, `k_exposure`); floor comparators; golden file | both | `backend/rulesets/`, `domain/rules/ruleset.py` (additive) | Must |
| 2 | Template generator: ruleset labour floors → legal template library (8 h, ban, ≤ 5 h runs + 1 h break, start/end bounds, juvenile variant) | S | `domain/planner/templates.py` (pure) | Must |
| 3 | Roster metrics: E28/E30/E32, REL excess, sleep opportunity, day span, earliest bus departure, paid/overtime/night deltas, split-shift second run | S | `domain/planner/roster_metrics.py` (pure) | Must |
| 4 | Roster scorer: climatology from the Parquet hourly obs WBGT per station, LOSO evaluation mode, gates, lexicographic pick, hysteresis recommendation | S | `application/roster_scorer.py` | Must |
| 5 | Stability rules: freeze, notice, drift, monthly cap, exposure-reducing classifier, SS1-SS7 metrics | S | `domain/planner/stability.py` (pure) | Must (rules), Should (metrics on simulated logs) |
| 6 | Zone and cap builder: forecast quantiles → protective-quantile WBGT/TWL → zone (minus margin) → per-hour work caps per workload class | D | `domain/planner/zones.py` (pure) | Must |
| 7 | `DayPlanSolver` port + CP-SAT adapter (lexicographic 3-stage, `num_workers=1`, fixed seed, `max_deterministic_time`) + rule-based fallback planner | D | `ports/day_plan_solver.py`, `adapters/compute/cpsat_day_planner.py`, `domain/planner/fallback.py` | Must (simple constraint set), Should (pours, precedences, fairness, shelter, rotation behind `planner_full_constraints`) |
| 8 | Day advisor use case: build the instance (sorted ids), solve, validate against the hard rules independently of the solver, attach clause citations + uncertainty band, persist the decision row with solver metadata | D | `application/day_advisor.py` | Must |
| 9 | Governance: employer-of-record scoping, sign-off workflow (review required), input-change audit + edit-to-green anomaly flag + HSE second approver, pay-publish block + attestation, `plan.*` audit events, k-suppression by data class | both | `application/plan_governance.py`, audit table (B3 governance) | Must (scoping, sign-off, audit, pay block, k), Should (second approver UI, anomaly rate report) |
| 10 | Persistence: `site_profile`, `roster_option_run`, `roster_publication`, `day_plan`, `plan_signoff`, `input_change` (all with `ruleset_id`, `ruleset_sha256`, `model_id`, `config_version_id`, `config_sha256`); expand-only migration | both | Alembic `0003_planner` | Must |
| 11 | API (in the 14 Nov OpenAPI v1 draft): `GET /api/v1/sites/{site_id}/roster-options`, `POST /api/v1/sites/{site_id}/roster-publications`, `POST /api/v1/sites/{site_id}/day-plans`, `GET /api/v1/day-plans/{id}`, `POST /api/v1/day-plans/{id}/sign-off`, `GET /api/v1/sites/{site_id}/pay-panel`. All employer-scoped; problem types `plan-infeasible`, `pay-attestation-required`, `freeze-violation`, `notice-violation`, `review-required` | both | `api/routes/planner.py` | Must |
| 12 | Demo exporters (static JSON for `ReplayForecastSource`): `artifacts/planner/roster_explorer.json`, `stability_frontier.json`, `inshift_day.json`, `pay_panel.json` | both | `jobs/export_planner.py` (`sb-jobs planner export`) | Must |

Out of scope for B3: night-work modelling, commute heat exposure, cross-employer rotation, any LLM (ADR 0011 §4.9).

## 2. Demo views (F2 builds; B3 provides JSON + types)
Every number is labelled **REAL** (station weather, forecasts as issued) or **SIMULATED** (crew, demand, pay baseline). Every view carries the floor banner ("Green is not permission …") and the "policy benchmark, not legal compliance" note next to sleep, notice and stability values.

1. **Roster-exposure explorer.**
   - Pick a station (6 clusters), a commute (30/45/60/90 min) and a sleep gate.
   - See the legal templates as a scatter: exposure at ≥ 30 vs sleep opportunity, colour = earliest start. The baseline and the recommended template are marked.
   - Each option's cost card shows E28/E30/E32, sleep h, bus departure, day span, paid-hours/overtime delta, night minutes, split-shift second run and a permit flag.
   - Night templates appear greyed with "not eligible: <attestations missing>".
   - The point of the view: at 45 min the best sleep-compatible template avoids ~16% (≥ 30), at 90 min none beats the baseline. Commute is a lever (`legal_sleep_templates_frontier.csv`).
2. **Stability-frontier chart.**
   - Left: exposure vs allowed roster changes per summer (0/1/2/3/6/14/19), hindsight and climatology lines, from Feasibility `frontier.csv`. 498 → 495 h at ≥ 30.
   - Right: the weekly-regret histogram (`weekly_regret.csv`: median 0.4%, 95% of weeks within 5%).
   - Caption: "Changing the roster weekly would buy < 1% at ≥ 30 °C; we hold it fixed and adapt inside the shift."
3. **In-shift advisor (supervisor, tomorrow).**
   - Hour-by-hour zone band (protective quantile, margin applied) with the uncertainty band.
   - Crew lanes with task blocks and rest blocks per ADOSH Table 1, ban shaded, clause citation on hover.
   - Counterfactual line: REL-excess vs the heavy-first rule.
   - Status chip OPTIMAL/FEASIBLE/FALLBACK; the change list to acknowledge before sign-off; the anomaly flag if present.
   - Uses the pre-registered demo day where possible (Judges §4.2) so it links to the scoreboard.
4. **Pay-neutrality panel.**
   - Per crew: paid hours, overtime, night premium status, unpaid day span vs baseline.
   - Red "publish blocked" state until the employer attests compensation (reason code).
   - Heat-stop minutes priced as paid, with the attestation tick.
   - The worked 8 h-vs-8.5 h example shown (−7.2% daily pay without compensation).

## 3. Acceptance tests (the B3 plan turns each into a task step)
| ID | Test | Marker |
|---|---|---|
| AT-1 | Template generator: every template has 8.0 h work, no tick in 12:30-15:00 in the ban season, no run > 5 h, ≥ 1 h break; count matches 136 day / 269 evening for the research bounds | unit (hypothesis) |
| AT-2 | Scorer reproduces `docs/research/scripts/roster/results/legal_sleep_templates.csv` chosen template and shares (±0.001) for OMAA/OMDB/OMAL/OMFJ × 3 summers on the fixture parquet | regression |
| AT-3 | Baseline exposure equals Feasibility `ladder.csv` (OMAA 2024: 1,011.5 / 791.0 / 484.5) | regression |
| AT-4 | Hysteresis: no recommendation when the gain is below the noise floor; never 2 changes in a month; drift > 30 min rejected in-season; notice < `notice_days` rejected with `notice-violation`; inside the freeze only stop/shorten/rest/shade accepted, a delay rejected | unit |
| AT-5 | **No added minutes:** for random instances, plan work minutes per worker ≤ roster minutes ≤ baseline minutes | unit (hypothesis) |
| AT-6 | Hard rules hold on every solver output **and** on every fallback output, checked by an independent validator: ban, zone caps (20/40, 45/15), lone work, unacclimatised in Medium/High, acclimatisation ramp, shelter capacity, task families, juveniles | unit (hypothesis) |
| AT-7 | Fallback never less protective than the ban; solver failure, stale forecast or wall-cap hit → fallback offered, status recorded | unit |
| AT-8 | Determinism: the same instance + ruleset + config version solved twice (and in a fresh process) gives a byte-identical plan; parameters record `num_workers=1`, the seed and `max_deterministic_time` | unit |
| AT-9 | Oracle: single crew, no side constraints → CP-SAT stage-1 objective equals the exact assignment from `within_shift.py` logic | unit |
| AT-10 | Lexicographic order: stage 2/3 never worsen the stage-1 strain objective | unit |
| AT-11 | Employer scoping: employer B cannot read or plan employer A's crews (403 + audit row); no cross-employer rotation in any plan | integration |
| AT-12 | Sign-off: plans with changes or Medium/High work reject one-tap (`review-required`) until every item is acknowledged; a deviation without a reason code fails | integration |
| AT-13 | Input-change audit: every protection-relevant edit writes before/after/actor/reason; a protection-lowering edit within 24 h before sign-off sets the anomaly flag and requires the HSE second approver | integration |
| AT-14 | Pay block: publishing a roster with fewer paid hours than baseline returns `pay-attestation-required` until an attestation exists | integration |
| AT-15 | k-suppression: health-related counts < 10 and exposure counts < 5 suppressed at site-week/employer level with complementary suppression; `k_health` < 10 or `k_exposure` < 5 rejected as `out-of-range` by config validation | unit + integration |
| AT-16 | Floors: a runtime config that sets any §6 floor, or a tunable outside its range, is rejected (ADR 0010 `floor-violation` / `out-of-range`); every new floor field has a `Floor` comparator | unit |
| AT-17 | Every plan view payload carries the floor banner code and every action carries a clause citation; every code has an `en` message key | unit |
| AT-18 | Decision rows carry `ruleset_id`, `ruleset_sha256`, `model_id`, `config_version_id`, `config_sha256`, solver status, objective, bound and deterministic time | integration |
| AT-19 | Exporters write the four JSON files from the replay snapshot; each value has a REAL/SIMULATED label; the F2 types generate from the committed OpenAPI | e2e |
| AT-20 | Performance: demo instance (≤ 10 crews, ≤ 20 tasks, 5-min ticks) wall p95 ≤ 3 s on the `api` container | slow |
| AT-21 | Purpose limitation: no planner export or endpoint joins stop events or adherence to a named worker | unit (CI) |

## 4. Order and budget (fits the roadmap's 15-16 Nov slot)
1. Ruleset sections + tunables (component 1), half a morning.
2. Template generator, metrics, scorer, exporters for the explorer and the frontier (2-4, 12), half a day. AT-1 to AT-3 pin it to the research.
3. Zones, fallback, then the CP-SAT simple set (6-8), half a day.
4. Governance, persistence and API (9-11), half a day, sharing B3's governance work.
5. Should-have: the full constraint set behind `planner_full_constraints`, SS metrics on simulated logs, the anomaly rate report.

Must-have total about 1.5-2 days; cut order if behind: SS metrics → full constraint set → anomaly rate report. The scoping, sign-off, no-added-minutes, pay block and k tests are never cut.

## 5. Open inputs the B3 plan must not invent
- Demo site profile (commute, shelter capacity, crew sizes, task list): state as SIMULATED assumptions in `backend/fixtures/demo_site.toml`.
- Ali's decisions in ADR 0011 (earliest-start default, sleep gate, k split, pay block, counsel).
- B2's chosen `calibration_pair` and B3's TWL margin and withdrawal-limit decisions (ADR 0006) feed the zone builder.
