# B3 planner: design notes for the B3 plan (input, not the plan), v2

- **Written:** 2026-11-11. **v2** replaces v1 the same day, after `docs/research/2026-11-11-planner-adversarial-review.md`. v1's seasonal-scorer service, publication flow, hysteresis engine, anomaly flag, second approver and pay block are **cut** (parked).
- **Decision:** `docs/decisions/0011-heat-aware-planner.md` (ADR 0011 v2, Proposed).
- **Slot:**
  - MUST on Mon 16 Nov.
  - SHOULD (CP-SAT) on Tue 17 Nov, only if the MUST set is green.
  - The static roster chart's JSON is already produced by the research script (15-16 Nov, about 2 h to wire into the snapshot).
- **Interfaces used:**
  - B1 physics `domain/physics/{wbgt,niosh,twl}.py` (`rel_wbgt_c`, `effective_wbgt_c`, `twl_w_m2_array`, `apply_withdrawal_limits`).
  - B1 Task 7A `Ruleset` / `TunableSpec` / `Floor` / `RuntimeConfig` / `EffectiveParams`, and the `composition.py` registries.
  - B2 calibrated quantile grids (`calibration_pair`).
  - B3's own zone/level policy engine (ADOSH zones + margin, Red band).
  - ADR 0010 config snapshot and audit events.
  - OR-Tools 9.15.6755 is pinned (ADR 0008).

## 1. Components
| # | Component | Location (ADR 0009 contracts) | Priority |
|---|---|---|---|
| 1 | Ruleset `ae-heat-2026.1` `[labour]`: ban, exemptions, hours (8/48, OT 2 h, 144 h/3 wk **total**), Art. 18 (`art18_ban_gap_counts_as_break = false`), weekly rest, juveniles, Ramadan, Table 1 cycles + fluid + duties, the full acclimatisation and re-acclimatisation table, the 7-day heavy-work rule. `[privacy]`: `k_health` ≥ 10, `k_exposure` ≥ 5. Tunables per ADR 0011 §8; POLICY ranges give `policy-bound-violation`. Golden file | `backend/rulesets/`, `domain/rules/ruleset.py` (additive) | MUST |
| 2 | Zone timeline: protective-quantile TWL − margin → zone per 5-min tick (interpolated from hourly), WBGT/REL cross-check, Red-level stop ticks | `domain/planner/zones.py` (pure) | MUST |
| 3 | Rule planner: ADOSH cycles across hour boundaries (rest never shortened), rolling-60-min caps, Art. 18 break at the hottest hour of any > 5 h run, people rules (lone work, unacclimatised, ramp share, 7-day heavy, juveniles, task families), heavy-first ordering, ban, stop-work | `domain/planner/rule_planner.py` (pure) | MUST |
| 4 | **Independent validator**: shares only the ruleset loader and the zone function with the planners; rolling windows; returns violations (rule id, clause, tick range) | `domain/planner/validator.py` (pure) | MUST |
| 5 | Day-plan use case: build the instance (sorted ids), run the rule planner (and CP-SAT if `planner_cpsat_enabled`), validate, attach clause citations + uncertainty, persist the decision row, emit the zone timeline to the Tier A alert path. Unsigned → the rule plan labelled "unsigned fallback" | `application/day_plan.py` | MUST |
| 6 | Sign-off: named supervisor of the employer of record; one-tap only if unchanged and Low-only; otherwise itemised acknowledgement; reason code on deviation. **Never gates alerts or stops** | `application/plan_signoff.py` | MUST |
| 7 | Input-change audit: append-only before/after/actor/reason rows for protection-relevant inputs | B3 governance audit table | MUST |
| 8 | Pay-impact display: paid hours, OT, night-premium position vs B0/B1, unpaid span, ADOSH rest + stops priced as paid. **No gate** | `domain/planner/pay_impact.py` (pure) | MUST (display) |
| 9 | Back-test scorer for ADR 0011 §9: naive / ban-only / rule-plan-raw / rule-plan-corrected, scored by the validator against truth zones on held-out 2026 | `jobs/planner_backtest.py` (`sb-jobs planner backtest`) → `artifacts/eval/2026/planner_scoreboard.json` | MUST (feeds the pitch) |
| 10 | Persistence: `site_profile`, `day_plan`, `plan_signoff`, `input_change` (all with `ruleset_id`, `ruleset_sha256`, `model_id`, `config_version_id`, `config_sha256`; solver metadata nullable). Expand-only migration | Alembic `0003_planner` | MUST |
| 11 | API (in the 14 Nov OpenAPI v1 draft): `POST /api/v1/sites/{site_id}/day-plans`, `GET /api/v1/day-plans/{id}`, `POST /api/v1/day-plans/{id}/sign-off`, `GET /api/v1/sites/{site_id}/roster-frontier` (serves the static JSON). Employer-scoped; problems `plan-invalid` (validator), `review-required`, `policy-bound-violation` | `api/routes/planner.py` | MUST |
| 12 | Static roster frontier: copy `docs/research/scripts/roster/results/roster_frontier.json` into the replay snapshot with a provenance block (script, sha256 of the parquet, run date) | `jobs/export_planner.py` | MUST |
| 13 | CP-SAT sequencer: per-tick booleans, sliding-window caps, run limits (`AddAutomaton`), lexicographic stages 1 (unmet must-do) → 2 (strain) → 3 (deferrable + stability), incumbent fixing, `num_workers=1`, seed `20261111`, `max_deterministic_time` | `ports/day_plan_solver.py`, `adapters/compute/cpsat_day_planner.py` | SHOULD |

Not in B3 (parked): seasonal scorer service, roster publications, hysteresis/freeze/notice engine, anomaly flag, HSE second approver, pay-block workflow, fairness, shelter, pours, rotation, SS metrics, night modelling, any LLM.

## 2. Demo views (F2 builds; B3 provides JSON + types)
Every number is labelled **REAL** (station weather, forecasts as issued) or **SIMULATED** (crew, demand). Every plan view carries the floor banner. Sleep and bedtime values are labelled "assumption [I]" and "policy benchmark, not legal compliance".

1. **Roster frontier chart** (one chart, `roster_frontier.json`).
   - Scatter/front of E30 per worked hour vs sleep opportunity, with a commute slider (15-90 min).
   - B0 "common practice (8.5 h, not compliant)" and B1 "legal default 06:00-11:00 + 15:00-18:00" are marked.
   - A legalisation arrow: −7.5% at ≥ 30, −19.1% at ≥ 32.
   - Caption: "Under UAE hours law and a night's sleep, no roster shape outruns the heat. Every 15 min of bus costs 30 min of sleep."
   - No template is marked "recommended" unless it passes the do-no-harm guard. At commutes ≥ 30 min none does, so the chart says "no change recommended; binding constraint: commute".
2. **In-shift planner (supervisor, tomorrow).**
   - Hour-by-hour zone band (protective quantile, margin applied), with the uncertainty band.
   - Crew lanes in 5-min ticks: work / ADOSH rest (20/40, 45/15) / Art. 18 break / ban / stop. Clause citation on hover; High-zone duties checklist.
   - A validator badge ("0 violations"), and the same day validated for a **naive schedule** with its violation count.
   - Status chip RULE / OPTIMAL / FEASIBLE / FALLBACK, and an "unsigned fallback" state.
   - Pre-registered demo day where possible, to link with the Judges scoreboard.
3. **Planner scoreboard (2026 held out).** From `planner_scoreboard.json`:
   - truth violation minutes per worker-season for naive, ban-only, rule-plan-raw and rule-plan-corrected;
   - the share of truth-High heavy minutes cycled 20/40;
   - missed under-protected hours (POD/FAR);
   - rest minutes added (SIMULATED).
4. **Pay-impact panel.** Per crew: paid hours, OT, night-premium position vs B0/B1, unpaid span; ADOSH rest and stops shown as paid time. Display only.

## 3. Acceptance tests
| ID | Test | Marker |
|---|---|---|
| AT-1 | Ruleset `[labour]` loads; every floor field has a `Floor` comparator; POLICY tunables outside range → `policy-bound-violation`, floors → `floor-violation`; `k_health` < 10 or `k_exposure` < 5 rejected | unit |
| AT-2 | Zone builder: protective quantile gives TWL ≤ the median TWL; margin subtraction; boundary conventions 140 → Low, 115 → Medium (ADR 0006) | unit |
| AT-3 | Cycles cross hour boundaries: for random zone sequences, no rolling 60-min window exceeds its cap and no work run exceeds its cycle length (Medium heavy 45, High light 45, High heavy 20); rest is never shortened when the zone eases | unit (hypothesis) |
| AT-4 | Art. 18: no work run > 5 h without a 1 h break; ban time and ADOSH rest are not credited when the switch is false; the break is placed in the hottest hour of the run; flipping the switch changes only Art. 18 results | unit |
| AT-5 | Acclimatisation: the new/experienced ramps and every re-acclimatisation row (including illness days and the "R/E*" protective reading); unacclimatised workers never in Medium/High ticks; heavy work only from day 7 | unit (table-driven) |
| AT-6 | People rules: no lone work in Medium/High; juveniles never on a template starting < 07:00 or ending > 19:00, ≤ 6 h, ≤ 4 h runs; task families respected | unit |
| AT-7 | **No added minutes**: the plan's work minutes per worker ≤ the shift's minus mandatory breaks; the shift is never extended | unit (hypothesis) |
| AT-8 | **Validator independence**: the validator flags hand-built violating plans for every rule (one fixture per rule id); every rule-planner and CP-SAT output on random instances passes; the validator module does not import either planner (import-linter contract) | unit + lint |
| AT-9 | Fallback: no forecast, stale forecast, solver failure or wall-cap hit → the rule plan; never less protective than the ban (property) | unit |
| AT-10 | **Sign-off never gates safety**: with no sign-off, Tier A alerts and Red stops still fire and crews see the "unsigned fallback" rule plan; one-tap is rejected (`review-required`) for changed or Medium/High plans | integration |
| AT-11 | Employer scoping: employer B cannot read or plan employer A's crews (403 + audit row) | integration |
| AT-12 | Input-change audit rows written with before/after/actor/reason for each protection-relevant field | integration |
| AT-13 | Pay impact: B0 → B1 shows −0.5 h OT, about −7.2% daily pay at +25%; ADOSH rest and stops counted as paid; no planner endpoint returns a pay-related block for a day plan or a stop | unit |
| AT-14 | Roster frontier: the exporter reproduces `roster_frontier.json` from the **committed fixture subset** (4 stations × 3 summers, the hours used; Review M7) within ±0.001; the guard marks nothing recommended at a 45-min commute and floor 21:30 | regression |
| AT-15 | Back-test scorer: on a committed 10-day fixture, naive > ban-only ≥ rule-plan violation minutes, and the counts equal the hand-computed fixture values | regression |
| AT-16 | Decision rows carry `ruleset_id`, `ruleset_sha256`, `model_id`, `config_version_id`, `config_sha256`, plus solver status/objective/bound/det-time when CP-SAT ran | integration |
| AT-17 | Every plan payload carries the banner code and a clause per action state; every code has an `en` key | unit |
| AT-18 | Purpose limitation: no planner export joins stop events or adherence to a named worker; the acclimatisation and juvenile fields are typed `Personal` and rejected by the managed LLM adapter type | unit (CI) |
| AT-19 (SHOULD) | CP-SAT: stage-1 must-do work ≥ the rule plan's on the same instance; stage 2 never worsens stage 1; FEASIBLE stops fix the incumbent and record the gap; single crew without side constraints equals the exact assignment oracle; byte-identical re-solve in a fresh process with `num_workers=1`, seed and `max_deterministic_time` recorded | unit |
| AT-20 (SHOULD) | Performance: demo instance (≤ 10 crews, ≤ 20 tasks, ≤ 108 ticks) wall p95 ≤ 3 s on the `api` container | slow |

## 4. Order and budget
- **16 Nov (MUST, about 1 day for one implementer + reviewer):**
  1. Component 1 → 2 → 3 → 4, test-first (AT-1 to AT-9).
  2. Then 5-8 and 10-12 (AT-10 to AT-14, AT-16 to AT-18), sharing B3's governance work (RBAC, audit, k).
  3. Then 9 (AT-15), which needs the B2 corrected quantiles. On raw IFS until they land.
- **17 Nov (SHOULD):** component 13 behind `planner_cpsat_enabled` (AT-19, AT-20). If not green by 15:00, ship without it; the RULE chip is the demo.
- **Never cut:** the validator, no-added-minutes, sign-off-never-gates, scoping, k, banner, determinism.

## 5. Inputs the B3 plan must not invent
- Demo site profile (shift = B1, days per week, commute, crew sizes, task list with must-do flags), stated as SIMULATED in `backend/fixtures/demo_site.toml`.
- Ali's ADR 0011 decisions (scope, bedtime floor for the chart, Art. 18 reading, k split, counsel).
- B2's `calibration_pair`; B3's TWL margin, withdrawal-limit decision and Red band (ADR 0006/0010).
- The §9 metrics are pre-registered in `docs/research/2026-11-12-evaluation-protocol.md` before 2026 is scored.
  - **Correction 2026-11-14:** that file name is wrong. The pre-registration is `docs/research/2026-11-12-preregistration-2026-evaluation.md` (committed as `661b373`). See the erratum at the end of this file.

## Erratum 2026-11-14: the pre-registration is committed; what B3 owes it

Added after Ali approved and committed `docs/research/2026-11-12-preregistration-2026-evaluation.md` (commit `661b373`). Decision record: the "Amendments" of [ADR 0034](../../decisions/0034-demo-strategy.md), 2026-11-14. The notes above are kept as written; where they conflict with this list, the pre-registration applies, because the B2 gate checks its SHA-256.

1. **Path.** `docs/research/2026-11-12-evaluation-protocol.md` (the last bullet of §5) does not exist; use the file named above.
2. **Issue time and wording.** Headline numbers are "forecast made about 24 hours ahead" (`lead_days = 1`); "issued by 18:00 GST the evening before" is only for the `lead_days = 2` strict run. The OMAA scoreboard is regime (a), known site and unseen summer; "new site" claims rest only on the leave-one-cluster-out regimes. Pre-registration §0, §4.
3. **The back-test runs through the gate.** Component 9 and the scoreboard text above say `sb-jobs planner backtest` and `planner_scoreboard.json`. The pre-registration fixes the command `sb-jobs evaluate-2026 --part warnings|plans` (B3 adds the `warnings` and `plans` parts to B2's command) and the files `policy_scoreboard.json`, `demo_day.json` and `plan_scoreboard.json` (§9, §12). 2026 rows are reachable only through the gated loader (leakage rule L5), so a separate command that reads 2026 would bypass the gate. The B3 plan must build the back-test as the `plans` part.
4. **Definitions B3 computes are already fixed:** truth danger hour, policies P0-P3 and counters (§7.2), the plan comparison, the protective quantile (the 10th percentile of TWL from the corrected joint samples) and the four counters (§7.3), and the demo-day rule as code, `select_demo_day` (§7.4). The 2 × 2 truth-zone sensitivity (margin 0 or 7 W/m² × withdrawal limits off or on) is always reported (§7.2).
5. **Freeze addendum (§11), a gate for the `warnings` and `plans` parts.** B3 owes: the released ruleset id and SHA-256 (`ae-heat-2026.1`) with the margin and the withdrawal-limit switch; the SHA-256 of `backend/fixtures/demo_site.toml`; and θ_protect and θ_balanced, which B3 computes from B2's exported 2024-2025 out-of-fold samples for the held-out `abu_dhabi` fold once the ruleset is frozen (§6 rule 5). The ruleset must therefore be frozen before θ is computed. If any §11 value changes after a 2026 Warnings or Plans number exists, that row loses its headline.
