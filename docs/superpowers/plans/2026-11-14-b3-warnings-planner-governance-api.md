# B3 Warnings, Planner, Governance and API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execution method is fixed:** subagent-driven, Sonnet implementers and Sonnet reviewers, a fresh reviewer per task, controller commits.

> **Note 2026-11-14 (Ali, in chat). The plan text below is kept as written; this note and the dated notes under Task 17, Task 18, the hours table and the decisions list supersede it where they differ.**
> - **ADRs 0046-0058 are accepted** (Ali, 2026-11-14). Wherever this plan says "Proposed-for-Ali" it now means accepted. What they change in the pre-registration is in [pre-registration amendment 1](../../research/2026-11-14-preregistration-amendment-1.md).
> - **Sign-off stays in B3: Task 17 is MUST** (reverses the sign-off deferral of ADR 0053; see its Amendments). Task numbers are unchanged. Task 17 is 2.5 h, so the MUST total is about 43.5 + 2.5 = **46 h**. **Task 18 (config admin API) stays contingent**: Ali's decisions keep the settings admin API and admin screen deferred (ADR 0052 Amendments). The instruction as relayed read "Tasks 17-18, +4.5 h"; Task 18 is the admin API, not sign-off, so only Task 17 is promoted (+2.5 h).
> - **F2 scope is now ten core views plus four fold-ins** (ADR 0045 Amendments). The tenth view is the supervisor plan with sign-off; Stop work sits on supervisor crews; the "I feel unwell" call sheet, the roster-frontier section and the worker access log add no route. Read "the nine core views" in the Goal, the Architecture note and Task 0 as ten.
> - **Knock-on edits for the plan owner, not made here (the original task text is kept):**
>   - **Task 0:** add the route `sign_off_day_plan` (14 operations plus the two health routes, not 13) and widen `DayPlan.signoff_state` from `Literal["unsigned"]`, so that the v1 contract is complete at the freeze.
>   - **Task 7:** the `plan_signoff` table goes into migration 0003, or Task 17 names a migration 0004; plus a store port and a fake.
>   - **Tasks 8 and 10:** `day_plan` and `get_crew_day_plan` return the stored sign-off state.
>   - **Hours table, row 16:** it says "Opus review"; Task 16 Step 3 and ADR 0012 Amendments say Sonnet, and Opus needs Ali's per-use permission.
> - **CP-SAT (Task 15)** was already dropped at 15:00 on 17 Nov unless every MUST task is green. With about 46 MUST hours it is expected to go; the plan's own text says +4.5 h "pushes CP-SAT out entirely".

**Goal:** Turn B2's corrected forecasts into ADOSH warning levels, a per-crew 5-minute rule plan checked by an independent validator, Tier A Web Push alerts, a refused-and-logged employer data request, the scored Warnings and Plans rows of the pre-registered 2026 evaluation, and exactly the `/api/v1` routes the nine core F2 views call.

**Architecture:**
- **Pure domain** (`domain/risk`, `domain/plans`, `domain/planner`, `domain/validator`, `domain/privacy`, `domain/scoreboard.py`): levels, zones, ticks, the rule planner, the validator, suppression, artefact shapes. The validator shares only the ruleset-derived `PlannerRules` and the zone timeline with the planner (import-linter enforced).
- **Application** use cases (`site_day`, `day_plan`, `governance`, `alerts`) over ports (`SiteRepository`, `PushSubscriptionStore`, `AlertStore`, `DayPlanStore`, `AuditLog`) with Postgres adapters (migration `0003_b3`) and fakes.
- **Offline** scoring in `ml/` (θ, warnings, plans, demo day) behind B2's 2026 gate, writing provenance-carrying JSON that F2 imports at build time (ADR 0051).

**Tech Stack:** Python 3.13, FastAPI 0.162.4, Pydantic 2.14.3, SQLAlchemy 2.1.8 + asyncpg, Alembic 1.20.1, Polars 2.0.0, NumPy 2.5.4, thermofeel 2.3.0, OR-Tools 9.15.6755 (SHOULD only), **pywebpush 2.5.0 (the one new dependency, released 2026-08-29)**, pytest 9.2.0 + hypothesis 6.170.15, testcontainers.

**Spec (read before any task; the plan argues from these):**
- ADRs 0004, 0006, 0009, 0010, 0011 v2, 0034, 0039, 0041, 0044; and the B3 decisions **0046-0058** (`docs/decisions/`), especially 0046 (level policy), 0047 (margin, withdrawal, MRT), 0048 (θ), 0049 (personal bands), 0050 (crew timeline, k), 0051 (API), 0054 (governance, audit chain), 0057 (Plans row, fixture), 0058 (alerts, push, stale).
- `docs/research/2026-11-12-preregistration-2026-evaluation.md` §6.5, §7.2-§7.4, §8, §9, §11, §12, §13 (binding; never edited; changes go to its amendment log by Ali).
- `docs/superpowers/plans/2026-11-11-b3-planner-design-notes.md` (acceptance tests AT-1..AT-20; AT-15 corrected by ADR 0057).
- `docs/superpowers/plans/2026-11-12-b2-forecast-corrector.md` Task 1 (interfaces), Tasks 3, 5, 12, 13, 15 (gate, bootstrap, provenance, replay, `evaluate-2026`).
- `docs/research/2026-11-11-shift-regulations-and-sleep.md` §§ on Table 1 and acclimatisation, `…-roster-stakeholders-and-compliance.md` H1-H12 and G11 (clause texts for the ruleset `[clauses]`).
- F1 contracts: `D:\dev\stellar-blaze-f1\docs\contracts\web-push.md`, `crew-timeline.md`, `frontend\openapi\stellar-blaze.mock.openapi.json`, `frontend\src\features\risk\{exceedance,personal}.ts`.

**Branch and worktree:** `feat/b3-warnings-planner-api`, created by the controller from `feat/b2-forecast-corrector` once B2 Task 1 is committed (it is). The controller brings later B2 commits in with `git merge` (never rebase) at task boundaries; B3 tasks that need a B2 artefact say which.

## Global Constraints

- **Write scope:** `backend/**`, `artifacts/eval/dev/{theta.json,*.2025.json}`, `artifacts/eval/2026/{policy_scoreboard,plan_scoreboard,demo_day}.json` (controller run only), `artifacts/eval/static/roster_frontier.json`, `docs/parking-lot.md` (append rows only). The freeze addendum `docs/research/2026-11-17-preregistration-freeze.md` is written by the controller (Task 14). Never edit the pre-registration text.
- **Pins:** add exactly `pywebpush==2.5.0` (Task 11). No other new dependency and no bump. `ortools` is already pinned (Task 15).
- **Layers:** the 5 B1 contracts + B2's contract 6 stay green. Task 6 adds contracts 7 and 8: `stellar_blaze.domain.validator` may not import `stellar_blaze.domain.planner` or `stellar_blaze.adapters.compute`; `stellar_blaze.domain.planner` may not import `stellar_blaze.domain.validator`. `jobs` reach adapters only through `composition` or `ml/` helpers (B2 ruling R13).
- **mypy `--strict` + `pydantic.mypy`** on `src` and `tests`. ruff clean. `filterwarnings = ["error"]` stays.
- **Tests:** exactly one tier marker (`unit`, `integration`, `regression`) plus `slow` above 5 s. Unit tests use fakes and synthetic frames (B2 `tests/fixtures/forecast/synthetic.py`), never the gold file. No subagent runs any 2026 scoring (Task 14 is the controller's, after Ali's go).
- **Time:** every instant is timezone-aware UTC in code and `Z` on the wire. Local dates and shift times are converted with `zoneinfo.ZoneInfo(site.timezone)` at the edge (`domain/plans/ticks.py`), never by adding 4 hours by hand. A tick is 5 minutes; the day grid is 04:00-22:00 local (216 ticks). An hourly label `H` covers `[H, H+1)` for display and scoring; tick values are linear interpolations between hourly labels (pre-registration §7.3), NaN outside the labelled range.
- **Values are copied from the ADRs and the pre-registration, never re-derived:** zone edges 140/115 (inclusive milder side), Red edge tunable 85 [60, 115], margin 7 [7, 20], θ default 0.10 [0.05, 0.50], protective quantile `np.quantile(…, 0.10, method="inverted_cdf")`, 50 joint samples, sample seed `20261112`, personal bands 0.10/0.50/0.90, dwell 60 [0, 180], lead 12 [1, 24], stale 30 h [6, 48], k_health 10, k_exposure 5, TTL 3600, `Urgency: high`, bootstrap 7-day blocks / B = 2,000 / seed `20261112`.
- **Words on every plan payload:** banner code `plan.floor_banner` ("Green is not permission to extend work. Legal and ADOSH minimums still apply. Advisory only; the employer remains the duty-holder."). Never "compliant", "minutes avoided" or "illness prevented" in any code, label or export.
- **Personal data:** crew-member acclimatisation counters and the juvenile flag live only in `crew_member` and `CrewMember` (docstring "PERSONAL data class, ADR 0010 §8"); no API schema, export or log line carries them or a per-member value; a contract test checks the OpenAPI document for member-like property names (as F1's governance test does).
- **Every decision row, alert row and audit row** records `ruleset_id`, `ruleset_sha256`, `model_id`, `config_version_id`, `config_sha256`. Persisting a decision needs a DB snapshot (`ConfigSnapshot.version_id is not None`); with a file or env snapshot (dev, tests without DB) nothing is persisted and `config_version` is reported as `0`.
- **Git:** Conventional Commits. Implementers never run `git stash`, `reset`, `rebase`, `checkout -- <path>` or `clean`, never `--no-verify`, and stage by explicit path. If the tree holds changes you did not make, stop and report. The controller commits.
- **US English** in identifiers and copy.
- **Evidence and conventions win over this plan.** If a step is wrong (an API name differs in B1/B2 code, a value contradicts an ADR or the pre-registration), stop, show the evidence and propose the fix. Being corrected is preferred to being obeyed.

## Review Focus

Every reviewer reads this list and checks the owning task's tests cover its line.

1. **A Green window read as permission to extend work.** A Low zone or Green level must never add a work minute beyond the published shift or move a shift edge (P-H10), and an easing zone must never shorten a rest already started. Tests: Task 5 `test_no_added_minutes_property`, `test_rest_never_shortened_on_easing`; Task 6 `P-H10` fixture; Task 10 `test_day_plan_has_banner`.
2. **The validator disagreeing with the planner.** Any rule-plan output that the validator rejects is a planner bug: the API answers 500 `plan-invalid` with an audit row, never a plan marked valid. The two modules share no code beyond `PlannerRules` and the zone timeline. Tests: Task 6 `test_rule_plans_always_pass_property`, import contracts 7-8; Task 8 `test_validator_rejection_is_a_500_and_audited`.
3. **Stale or missing forecasts.** A missing hour or a stale run must make the plan more protective (every on-shift tick High), never fall back to "no constraint", and the response must say `forecast_status = "fallback" | "stale"`. Tests: Task 3 `test_missing_hours_become_high`; Task 8 `test_stale_forecast_is_labelled_and_protective`.
4. **Suppressed small groups leaking via differencing.** A suppressed crew's restricted count must not be recoverable from a published total or from another field. Tests: Task 9 `test_complementary_suppression_defeats_differencing`; Task 8 `test_suppressed_crew_hides_restricted_headcount`; Task 10 `test_crew_timeline_suppressed_crew_keeps_level`.
5. **Audit log tampering.** Rows are append-only and hash-chained; an UPDATE, DELETE or TRUNCATE is refused by trigger, and a row edited with the trigger dropped breaks `sb-jobs audit verify`. Tests: Task 7 `test_audit_update_delete_truncate_refused`, `test_verify_detects_edited_row`.
6. **Tie and threshold edges.** TWL exactly 140 → Low, exactly 115 → Medium, exactly the Red edge → High; P exactly θ → escalates; a limit exactly at p50 → 0.50; a probability exactly at a band minimum takes that band; a work run of exactly 5 h needs no Art. 18 break, 5 h 05 min does. Tests: Task 3 `test_zone_edges`, `test_theta_tie_escalates`; Task 4 vectors; Task 5 `test_art18_exactly_five_hours`.
7. **Time zones.** A local date's ticks must start at 04:00 Asia/Dubai (00:00 UTC), the ban window must be 12:30-15:00 local (08:30-11:00 UTC) on 15 Jun-15 Sep inclusive local dates, and the hour label 08 UTC must carry ban weight 0.5. Tests: Task 3 `test_tick_grid_dubai`; Task 5 `test_ban_window_local`; Task 13 `test_partial_ban_weights`.

---

## File structure

```
backend/
  rulesets/ae-heat-2026.1.toml                 # Task 2 (released; supersedes ae-heat-0.1)
  rulesets/lock.json                           # Task 2 (add the new hash)
  fixtures/demo_site.toml                      # Task 7 (SIMULATED; ADR 0057)
  config/runtime/default.toml                  # Task 2 (keys unchanged), Task 14 (warning_theta)
  alembic/versions/0003_b3.py                  # Task 7
  openapi/v1.json                              # Task 0 (regenerated by every API task)
  src/stellar_blaze/
    domain/rules/floors.py                     # T1 (directions "false", "narrower")
    domain/rules/ruleset.py                    # T2 (optional new sections)
    domain/config/runtime.py                   # T1 (_check_pin tunables), T2 (Tunables, EffectiveParams)
    domain/physics/wbgt.py                     # T3 (globe_temperature_c, mrt_from_globe_c)
    domain/risk/levels.py                      # T3 (Zone, ZoneEdges, zone_of, hour_levels, protective_twl)
    domain/risk/twl_samples.py                 # T3
    domain/risk/personal.py                    # T4 (device mirror)
    domain/risk/policy.py                      # T4 (risk-policy projection)
    domain/plans/model.py                      # T3 (TickState, CrewSpec, CrewMember, CrewPlan, ZoneTimeline)
    domain/plans/ticks.py                      # T3
    domain/plans/rules.py                      # T3 (PlannerRules from ruleset + params; shared by planner and validator)
    domain/planner/rule_planner.py             # T5
    domain/validator/validator.py              # T6
    domain/validator/roster_text.py            # T6
    domain/privacy/suppression.py              # T9
    domain/scoreboard.py                       # T0 (artefact models), T13 (filled)
    application/runtime_config.py              # T1 (date re-validation in the poller)
    application/site_day.py                    # T8
    application/day_plan.py                    # T8
    application/governance.py                  # T10
    application/alerts.py                      # T11
    ports/{sites,push,alerts,plans,audit}.py   # T7
    adapters/db/{tables,sites,push,alerts,plans,audit}.py   # T7
    adapters/db/config_store.py                # T7 (config.* audit events)
    adapters/fakes/{sites,push,alerts,plans,audit}.py       # T7
    adapters/notifications/webpush.py          # T11
    api/auth.py                                # T10
    api/models.py                              # T0 (request/response models)
    api/routers/{sites,crews,plans,push,governance}.py      # T0 stubs, T10/T11 bodies
    api/export_openapi.py                      # T0 (artefact components)
    composition.py, config.py                  # T7, T8, T10, T11
    jobs/cli.py                                # T7 (site load, audit verify), T11 (alerts dispatch)
    jobs/ml_cli.py                             # T12 (freeze theta), T13 (scoreboard dev; evaluate-2026 parts)
    jobs/evaluate_2026.py                      # T13 (warnings, plans parts)
    ml/theta.py, ml/scoreboards.py             # T12, T13
  tests/fixtures/risk/personal_level_vectors.json  # T4
  tests/fixtures/rulesets/ae-heat-2026.1.golden.json # T2
artifacts/eval/dev/theta.json, artifacts/eval/dev/*.2025.json, artifacts/eval/static/roster_frontier.json
```

---

### Task 0: OpenAPI v1 contract (models, stub routes, artefact components)

**Files:**
- Create: `api/models.py`, `api/routers/{sites,crews,plans,push,governance}.py`, `domain/scoreboard.py`
- Modify: `api/app.py` (include routers), `api/export_openapi.py`, `errors.py` (problem type constants), `backend/openapi/v1.json`
- Test: `tests/unit/api/test_openapi_v1_contract.py`

**Interfaces:**
- Produces the wire contract of ADR 0051 §1. Route functions carry the operationIds listed there and, in this task, raise `DomainProblem(type_=NOT_IMPLEMENTED, status=501)`.
- Models (all `ResponseModel` or `extra="forbid"` request models):
  - `Site{id, name, timezone, synthetic}`; `Level = AlertLevel`.
  - `HourForecast{starts_at: AwareDatetime, wbgt_c: {p05,p50,p95: float|None}, site_level: Level|None, action_codes: list[str], ban_active: bool}`.
  - `SiteForecastToday{site_id, date, generated_at, policy_version, config_version: int, mode: Literal["replay","live"], forecast_status: Literal["fresh","stale","fallback"], model_id: str|None, lead_days: int, hours: list[HourForecast]}`.
  - `RiskPolicy{version, config_version, k_suppression, k_health, acclimatisation_days_required, bands: list[{level, min_exceedance_probability}], workload_classes: list[{code: light|moderate|heavy, metabolic_rate_w}], clothing_options: list[{code, adjustment_c, source}]}`.
  - `Crew{id, site_id, name, member_count}`; `CrewHour{starts_at, crew_level: Level|None, ban_active}` (**no `share_above_amber`**, ADR 0050); `CrewTimeline{crew_id, crew_name, site_id, date, suppressed, k, hours}`.
  - `PlanSegment{starts_at, ends_at, state: work|adosh_rest|art18_break|ban|stopped|off, zone: low|medium|high|red|None, rule_id: str, clause: str}`; `Violation{rule_id, clause, source_id, ranges: list[{starts_at, ends_at}], detail}`; `ValidatorResult{passed, violations, checked_rules: list[str]}`.
  - `DayPlan{crew_id, date, status: rule|fallback, signoff_state: Literal["unsigned"], banner_code: Literal["plan.floor_banner"], segments, zone_hours: list[{starts_at, zone, level}], validator: ValidatorResult, suppressed: bool, restricted_headcount: int|None, restrictions: list[str], forecast_status, policy_version, config_version, model_id}`.
  - `PlanValidateRequest{site_id, date, crew: {workload, headcount: int 1-200, acclimatised: bool = True, days_per_week: int 1-7 = 6}, roster_text: str|None (≤ 2000 chars), segments: list[{start: "HH:MM", end: "HH:MM", state: work|rest|break}]|None}`: exactly one of `roster_text` and `segments`. `PlanValidateResponse{validator: ValidatorResult, zone_hours, policy_version, config_version}`.
  - `PushSubscriptionCreate` / `PushSubscriptionCreated`: F1 shapes verbatim.
  - `DataRequestCreate{subject: Literal["worker"], data_class: Literal["health","personal","exposure"], worker_ref: str 1-100}` (no response body model: always a problem).
  - `CrewStopCreate{reason_code: Literal["heat","worker_unwell","other"]}`; `CrewStop{id, crew_id, started_at, cleared_at: AwareDatetime | None}`.
  - `TransparencyLog{site_id, entries: list[{at, kind: Literal["data_request.refused"], outcome: Literal["refused"], actor_role: Literal["employer"], rule, policy_version, config_version, model_id}]}`.
- `domain/scoreboard.py` (artefact shapes; Task 13 fills them): `Interval{lo, hi}`, `Metric{value, ci: Interval|None, n: int, anchor: str}`, `PolicyRow`, `PolicyScoreboard`, `PlanRow`, `PlanScoreboard`, `DemoDayHour`, `DemoDay`, `ThetaDecision` (fields as in Task 12/13), each with `provenance: Provenance` (B2 `domain/provenance.py`; until B2 Task 13 lands, a local stub with the same fields, replaced by an import when merged).
- Problem types: `NOT_IMPLEMENTED`, `INDIVIDUAL_DATA_REFUSED`, `FORBIDDEN_EMPLOYER`, `UNAUTHORIZED`, `PLAN_INVALID`, `ROSTER_INVALID`, `NOT_FOUND` as `urn:stellar-blaze:problem:<kebab>`.

- [ ] **Step 1: Write the failing test** `test_openapi_v1_contract.py`:
  - `test_paths_and_operation_ids`: the generated document has exactly the 13 operations of ADR 0051 (11 for the nine views + `create_crew_stop`, `delete_crew_stop`) plus the two health routes, with those operationIds.
  - `test_no_member_like_properties`: no schema property or parameter name matches `/(worker|member|employee|heart|symptom|acclimat|juvenile)/i` except `worker_ref` in `DataRequestCreate` (allow-listed, write-only).
  - `test_crew_hour_has_no_share_above_amber`.
  - `test_artifact_components_present`: `PolicyScoreboard`, `PlanScoreboard`, `DemoDay`, `ThetaDecision` are in `components.schemas`.
  - `test_every_object_forbids_additional_properties` (request models).
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/api/test_openapi_v1_contract.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the models, stub routers and `export_openapi` merge of `TypeAdapter(Model).json_schema(ref_template="#/components/schemas/{model}")` for the artefact models.
- [ ] **Step 4: Run** the test, then `uv run python -m stellar_blaze.api.export_openapi > openapi/v1.json` and the existing contract tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): openapi v1 contract for the core demo path`. Controller: notify F2 (`pnpm api:gen` against `backend/openapi/v1.json`) and add `--fail-on ERR` to the CI oasdiff step.

---

### Task 1: Pin check compares tunables (ADR 0044) and the poller re-validates on the date change

**Files:**
- Modify: `domain/config/runtime.py` (`_check_pin`), `application/runtime_config.py` (`ConfigPoller`), `docs/decisions/0010-runtime-tunable-configuration.md` is **not** edited by the implementer (the controller adds the amendment line ADR 0044 §3 asks for)
- Test: `tests/unit/config/test_pin_tunables.py`, `tests/unit/application/test_poller_date_revalidation.py`

**Interfaces:**
- Consumes: `RulesetCatalog`, `resolve_effective`, `TunableSpec`.
- Produces: `_check_pin` additionally returns `ConfigViolation("floor-violation", f"ruleset_pin.tunables.{name}.min|max|default", …)` per ADR 0044 §1-2: `safer="higher"` → pinned `min` ≥ in-force `min` and pinned effective default ≥ in-force default; `"lower"` → pinned `max` ≤ in-force `max` and default ≤; `"none"` not compared; a tunable declared in force but absent from the pin → violation `ruleset_pin.tunables.<name>`. `ConfigPoller` re-runs `ConfigService.validate` on the held snapshot when `dubai_today()` changes, and re-reads a refused activation id on the first poll after the date it was refused on.

- [ ] **Step 1: Write the failing tests** with two in-memory released rulesets A (margin default 0, range [0, 20]) and B (default 7, range [7, 20]) where B is in force:
  - `test_pin_to_older_ruleset_with_lower_margin_min_is_refused` (path `ruleset_pin.tunables.twl_margin_w_m2.min`).
  - `test_pin_with_equal_tunables_is_accepted`.
  - `test_lower_safer_tunable_compares_max`.
  - `test_missing_tunable_in_pin_is_a_violation`.
  - `test_dev_pin_is_not_compared` (prod=False).
  - `test_poller_revalidates_after_midnight_dubai` (time-machine: 19:59:59Z → 20:00:01Z; a pin that stops covering the new date flips readiness to `stale` and logs `config.rejected`).
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/config/test_pin_tunables.py tests/unit/application/test_poller_date_revalidation.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus `uv run pytest -m unit tests/unit/config -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(config): pin check compares tunable ranges and defaults (ADR 0044)`.

---

### Task 2: Ruleset `ae-heat-2026.1` (labour, cycles, acclimatisation, workload, privacy, clauses, templates, tunables)

**Files:**
- Create: `rulesets/ae-heat-2026.1.toml`, `tests/fixtures/rulesets/ae-heat-2026.1.golden.json`
- Modify: `domain/rules/floors.py`, `domain/rules/ruleset.py`, `domain/config/runtime.py` (`Tunables`, `EffectiveParams`, `resolve_effective`), `rulesets/lock.json`
- Test: `tests/unit/rules/test_ruleset_2026_1.py`, extend `tests/unit/rules/test_floors.py`, extend the golden test

**Interfaces:**
- `Floor.safer` gains `"false"` (False is more protective) and `"narrower"` (a candidate window must lie inside the reference window).
- New sections, each `RulesetSection`, typed `X | None = None` on `Ruleset` so the released `ae-heat-0.1` still loads. The structural check accepts `RulesetSection | None`; `floor_violations` treats a candidate `None` against a present reference section as one violation at the section path. `Ruleset.require(*names) -> None` raises `RulesetIncompleteError` when a named section is `None`.
  - `labour: LabourRules`: `ban_window: tuple[time, time]` Floor wider = (12:30:00, 15:00:00); `ban_season: tuple[str, str]` Floor wider = ("06-15", "09-15") (inclusive local dates, zero-padded "MM-DD"); `normal_hours_per_day` 8 lower; `normal_hours_per_week` 48 lower; `overtime_hours_per_day` 2 lower; `total_hours_per_3_weeks` 144 lower; `art18_max_run_h` 5 lower; `art18_break_h` 1 higher; `art18_ban_gap_counts_as_break` false Floor false; `art18_adosh_rest_counts_as_break` false Floor false; `juvenile_max_h` 6 lower; `juvenile_max_run_h` 4 lower; `juvenile_window: tuple[time,time]` Floor narrower = (07:00:00, 19:00:00); `ramadan_reduction_h` 2 higher.
  - `adosh_cycles: AdoshCycles`: `medium_heavy_work_min` 45 lower, `medium_heavy_rest_min` 15 higher, `high_light_work_min` 45 lower, `high_light_rest_min` 15 higher, `high_heavy_work_min` 20 lower, `high_heavy_rest_min` 40 higher, `moderate_uses_heavy` true Floor true, `lone_work_min_headcount` 2 higher.
  - `acclimatisation: Acclimatisation`: `new_ramp_pct = {"1"=20,"2"=40,"3"=60,"4"=80,"5"=100}`, `experienced_ramp_pct = {"1"=50,"2"=60,"3"=80,"4"=100,"5"=100}`, `reacclimatisation_pct` flattened `"<band>.<day>"` → pct for bands `lt4` (100), `4-5` (80, 100; the "R/E*" protective reading), `6-12` (80, 100), `12-20` (60, 80, 100), `gt20` (50, 60, 80, 100) — all `dict[str, Annotated[int, Floor("lower")]]`; `unacclimatised_after_days_away` 14 lower; `heavy_work_after_days` 7 higher.
  - `workload: Workload`: `metabolic_w = {light=180.0, moderate=300.0, heavy=415.0}` Floor higher (source `adr-0006`).
  - `privacy: Privacy`: `k_health_floor` 10 higher, `k_exposure_floor` 5 higher.
  - `clauses: Clauses` (`NON_FLOOR_FIELDS = {"entries"}`): `entries: dict[str, ClauseRef{source: str, clause: str}]` for rule ids `P-H1, P-H1a, P-H2.daily, P-H2.weekly, P-H3, P-H4, P-H5.hours, P-H5.run, P-H5.window, P-H7.cap60, P-H7.run, P-H7.lone, P-H7.unacclimatised, P-H8.ramp, P-H8.heavy7, P-H10, STOP.red, STOP.no_acclimatised, FALLBACK.high`; every `source` is a declared `[[sources]]` id.
  - `alerts: AlertCatalog` (non-floor): `template_ids = ["level-change", "level-end"]`, `action_codes_by_level = {green=[...], amber=[...], orange=[...], red=[...]}` (codes such as `cycle.medium.heavy.45-15`, `no-lone-work`, `fluids.over-1.2l`, `stop-work`).
- `[[sources]]` added: MoHRE MR 44/2022 Art. 3; Federal Decree-Law 33/2021 Art. 5, 17, 18, 19, 21; Cabinet Resolution 1/2022 (Exec. Regs.) Art. 15; AD 19/2023 Art. 11; ADOSH Technical Guideline Table 1 and §3; CoP 11.0 3.2. Titles and clause strings are copied from the two research docs named in the Spec.
- `[meta]`: id `ae-heat-2026.1`, `effective_from = 2024-01-01`, open-ended, `status = "released"`, `supersedes = ["ae-heat-0.1"]`. `[twl_zones]`, `[niosh_clothing]`, `[twl_withdrawal]` copied from 0.1 (withdrawal `enabled = false`, ADR 0047).
- `[tunables]` (each with `source`): `twl_margin_w_m2` 7 [7, 20] higher; `warning_theta` 0.10 [0.05, 0.50] lower; `red_twl_w_m2` 85 [60, 115] higher; `personal_band_amber` 0.10 [0.05, 0.30] lower; `personal_band_orange` 0.50 [0.30, 0.70] lower; `personal_band_red` 0.90 [0.70, 0.95] lower; `deescalation_dwell_minutes` 60 [0, 180] higher; `alert_lead_hours` 12 [1, 24] higher; `forecast_stale_after_hours` 30 [6, 48] lower; `k_health` 10 [10, 50] higher; `k_exposure` 5 [5, 50] higher; `low_zone_voluntary_rest_min` 0 [0, 15] higher.
- `Tunables` and `EffectiveParams` gain the same names (`int` for k, minutes and hours where integral). `resolve_effective` also returns `out-of-range` at path `tunables.personal_band_*` unless amber < orange < red.

- [ ] **Step 1: Write the failing tests:**
  - `test_2026_1_loads_and_hash_matches_lock`.
  - `test_0_1_still_loads` and `test_catalog_resolves_2026_1_for_2026_07_01`.
  - `test_every_new_floor_has_a_comparator` (the existing structural test, extended to the new sections and to `X | None`).
  - `test_pin_to_0_1_in_prod_is_refused_after_2026_1` (labour section missing → `floor-violation`; tunable mins higher → violations from Task 1).
  - `test_k_below_floor_rejected` (`k_health=9` → `out-of-range`).
  - `test_personal_bands_must_increase` (0.5 / 0.5 / 0.9 → violation).
  - `test_clause_sources_declared`; `test_ban_window_floor_wider`; `test_juvenile_window_floor_narrower`; `test_art18_switch_floor_false`.
  - Golden: `test_golden_2026_1` pins every floor, tunable range end and `safer`.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/rules -q`. Expected: FAIL.
- [ ] **Step 3: Implement**, then add `"ae-heat-2026.1": "<sha256 of the file bytes>"` to `rulesets/lock.json` (computed with `python -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" rulesets/ae-heat-2026.1.toml`; there is no lock command in B1, `adapters/config/rulesets.py` only checks it).
- [ ] **Step 4: Run** `uv run pytest -m unit tests/unit/rules tests/unit/config -q && uv run mypy src tests`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(rules): release ae-heat-2026.1 (labour, ADOSH cycles, acclimatisation, B3 tunables)`.

---

### Task 3: TWL samples, zones, warning levels, protective TWL, the tick grid, and the shared plan types

**Files:**
- Create: `domain/risk/twl_samples.py`, `domain/plans/__init__.py`, `domain/plans/ticks.py`, `domain/plans/model.py` (all the types listed under Task 5 "Interfaces", so Tasks 5 and 6 can run in parallel), `domain/plans/rules.py` (`PlannerRules`, `planner_rules`, as specified under Task 5)
- Modify: `domain/physics/wbgt.py`, `domain/risk/levels.py`
- Test: `tests/unit/risk/test_levels.py`, `tests/unit/risk/test_twl_samples.py`, `tests/unit/plans/test_ticks.py`, `tests/unit/physics/test_mrt.py`

**Interfaces:**
- Consumes: B1 `twl_w_m2_array`, `body_level_wind_ms`, `apply_withdrawal_limits`, `relative_humidity_pct`, `solar.mean_cos_zenith_prev_hour`/`cos_zenith`; thermofeel `liljegren.solve_globe`, `calculate_mrt_from_bgt`; B2 `ForecastCorrector.sample` output `(rows, n, 3)`.
- Produces:
  - `wbgt.globe_temperature_c(*, t_c, td_c, wind10m_ms, pressure_hpa, sw_wm2, direct_wm2, lat, lon, valid_time_utc) -> F64` (same geometry, fdir clip and wind scaling as `wbgt_liljegren`; NaN where it does not converge) and `wbgt.mrt_from_globe_c(*, t_c, globe_c, wind10m_ms) -> F64`.
  - `twl_samples.twl_sample_matrix(samples: F64, *, sw_wm2: F64, direct_wm2: F64, pressure_hpa: F64, valid_time_utc: NDArray[datetime64], lat: float, lon: float) -> F64`: `(rows, n)` TWL; truth uses `samples` of shape `(rows, 1, 3)`.
  - `twl_samples.effective_twl(twl: F64, *, margin_w_m2: float, withdrawal: WithdrawalLimits | None, t_c: F64, tnwb_c: F64 | None) -> F64`: cap (only when `withdrawal` is given) then subtract the margin (ADR 0047 §2).
  - `levels.Zone(IntEnum)`: `LOW=0, MEDIUM=1, HIGH=2, RED=3`; `levels.ZoneEdges(low_min, medium_min, red_min)` frozen dataclass with `from_ruleset(ruleset, params)`; `levels.zone_of(twl_eff: F64, edges) -> NDArray[np.int8]` (−1 for NaN); `levels.hour_levels(twl_eff_samples: F64, edges, theta: float) -> NDArray[np.int8]` (ADR 0046 §3; −1 when no finite sample); `levels.protective_twl(twl_eff_samples: F64, q: float = 0.10) -> F64` (`method="inverted_cdf"` over finite samples, NaN if none); `levels.level_for_zone(z: Zone) -> AlertLevel`.
  - `ticks.TICK_MINUTES = 5`; `ticks.day_ticks(local_date: date, tz: ZoneInfo) -> NDArray[datetime64[us]]` (216 UTC instants from 04:00 local); `ticks.interpolate_hourly(labels_utc, values, ticks_utc) -> F64` (linear, NaN outside `[labels[0], labels[-1]]` and across a NaN label); `ticks.in_ban(ticks_utc, local_date, tz, labour: LabourRules) -> NDArray[bool]`; `ticks.hour_ban_weight(label_utc, tz, labour) -> float` (non-ban fraction of `[H, H+1)`, 1.0 outside the season).
  - `ticks.zone_timeline(*, local_date, tz, labels_utc, protective_twl_eff, hour_level_zones, edges) -> ZoneTimeline` (in `domain/plans/model.py`, created here): tick zone = `max(zone_of(interpolated q10), zone of the enclosing hour's level)` (ADR 0046 §4 clamp); a tick with no value is `HIGH` with `fallback=True`.

- [ ] **Step 1: Write the failing tests:**
  - `test_zone_edges`: `zone_of([140.0, 139.999, 115.0, 114.999, 85.0, 84.999, nan])` == `[0, 1, 1, 2, 2, 3, -1]` with edges (140, 115, 85).
  - `test_theta_tie_escalates`: 50 samples, exactly 5 below 115 and the rest above 140, θ 0.10 → `HIGH`; 4 below 115 and 1 in [115, 140) → `MEDIUM`.
  - `test_level_equals_q10_zone_at_theta_010` (hypothesis over random `(n, 50)` matrices, NaN allowed).
  - `test_all_nan_hour_has_no_level`.
  - `test_effective_twl_cap_then_margin` (cap 115, margin 7, T 45 °C → 108).
  - `test_mrt_vectors`: three fixed inputs (OMAA noon, 06:00, night) give `globe_temperature_c` within 0.01 °C of thermofeel called directly in the test, and MRT = T when sw = 0 and wind high, within 0.5 °C.
  - `test_twl_sample_matrix_shape_and_nan` (a NaN sample stays NaN; spread 0 gives identical columns).
  - `test_tick_grid_dubai`: 2026-07-01 → first tick `2026-07-01T00:00Z`, 216 ticks, last `17:55Z`.
  - `test_ban_ticks_local`: ticks 08:30Z-10:55Z are ban on 2026-07-01, none on 2026-06-14 and 2026-09-16; 2026-06-15 and 2026-09-15 are in season.
  - `test_hour_ban_weight`: label 08Z on 2026-07-01 → 0.5; 09Z, 10Z → 0.0; 07Z → 1.0; 08Z on 2026-05-20 → 1.0.
  - `test_missing_hours_become_high`.
  - `test_planner_rules_caps` (`tests/unit/plans/test_rules.py`): `cap_minutes` = Low 60, Medium light 60, Medium heavy 45, Medium moderate 45, High light 45, High heavy 20, Red 0; `cycle(HIGH, "heavy") == (20, 40)`, `cycle(LOW, "heavy") is None`; voluntary Low rest 10 → Low cap 50.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/risk tests/unit/plans -q tests/unit/physics/test_mrt.py`. Expected: FAIL.
- [ ] **Step 3: Implement.** Check the units `solve_globe` expects (K vs °C, RH fraction) against its source before wiring; the test against thermofeel guards it.
- [ ] **Step 4: Run** the same and `uv run lint-imports`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(risk): TWL samples, ADOSH zones, warning levels and the tick grid`.

---

### Task 4: Device-parity personal level and the risk-policy projection

**Files:**
- Create: `domain/risk/personal.py`, `domain/risk/policy.py`, `tests/fixtures/risk/personal_level_vectors.json`
- Test: `tests/unit/risk/test_personal_parity.py`, `tests/unit/risk/test_policy_projection.py`

**Interfaces:**
- Produces:
  - `personal.exceedance_3q(p05: float, p50: float, p95: float, limit: float) -> float`: a line-for-line mirror of F1 `exceedanceProbability` (sort, median-of-three, `limit == p50 → 0.50`, `≤ p05 → 0.95`, `≥ p95 → 0.05`, linear inner segments).
  - `personal.band_level(bands: Sequence[tuple[AlertLevel, float]], p: float) -> AlertLevel | None` (highest minimum ≤ p; ties take the more severe).
  - `personal.displayed_level(site: AlertLevel | None, personal: AlertLevel | None) -> AlertLevel | None` (more severe; ADR 0049 §4).
  - `policy.risk_policy(ruleset: Ruleset, params: EffectiveParams, config_version: int) -> RiskPolicyData` (frozen dataclass mapping 1:1 onto `api.models.RiskPolicy`: bands from the personal tunables with green at 0, `k_suppression = params.k_exposure`, `k_health`, `acclimatisation_days_required = acclimatisation.heavy_work_after_days`, workload classes from `workload.metabolic_w`, clothing options from `niosh_clothing.values_c` with source `niosh-2016`).
  - `scripts`: `uv run python -m stellar_blaze.domain.risk.personal --write-vectors <path>` writes ≥ 40 vectors (edges: limit = p05, p50, p95, all-equal quantiles, unsorted input, each band minimum exactly).

- [ ] **Step 1: Write the failing tests:** `test_tie_at_median_is_half`; `test_all_equal_quantiles`; `test_bounds_005_095`; `test_band_inclusive`; `test_displayed_level_more_severe` (red+green → red; null+orange → orange); `test_vectors_file_matches_functions` (regenerate in memory, compare to the committed file); `test_policy_bands_are_increasing_and_max_le_095`; `test_policy_k_fields`.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/risk/test_personal_parity.py tests/unit/risk/test_policy_projection.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** and write the vectors file.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(risk): personal-level parity vectors and risk-policy projection`. Controller: tell F2 the vector path.

---

### Task 5: The rule planner

**Files:**
- Create: `domain/planner/__init__.py`, `domain/planner/rule_planner.py` (the types and `PlannerRules` below are created in Task 3; they are listed here because the planner is their main user)
- Test: `tests/unit/planner/test_rule_planner.py`, `tests/unit/planner/test_rule_planner_properties.py`

**Interfaces:**
- `model.TickState(StrEnum)`: `WORK, ADOSH_REST, ART18_BREAK, BAN, STOPPED, OFF` (wire values snake_case).
- `model.ShiftBlock(start: time, end: time)` (local, end exclusive); `model.CrewMember` (PERSONAL: `days_on_site: int`, `days_away: int`, `away_reason: Literal["leave","illness","none"]`, `experienced: bool`, `juvenile: bool`); `model.CrewSpec(crew_id, employer_id, workload: Literal["light","moderate","heavy"], headcount: int, shift: tuple[ShiftBlock, ...], days_per_week: int, members: tuple[CrewMember, ...] | None)` (`members=None` means "all acclimatised experienced adults", used by try-a-plan).
- `model.ZoneTimeline(start_utc: datetime, zones: tuple[Zone, ...], fallback: tuple[bool, ...], source: Literal["forecast","truth","fallback"])`.
- `model.CrewPlan(crew_id, local_date, start_utc, states: tuple[TickState, ...], rule_ids: tuple[str, ...], status: Literal["rule","fallback"], restricted_headcount: int, restrictions: tuple[str, ...], work_minutes: int, adosh_rest_minutes: int, art18_minutes: int, stopped_minutes: int)`.
- `rules.PlannerRules` (frozen): built by `planner_rules(ruleset: Ruleset, params: EffectiveParams) -> PlannerRules`; it holds `cap_minutes(zone, workload) -> int` (Low 60 − voluntary rest, Medium light 60 / heavy 45, High light 45 / heavy 20, Red 0; moderate uses heavy), `cycle(zone, workload) -> tuple[int, int] | None` (None = self-paced), the labour limits, ramp tables and lone-work minimum. Both planner and validator use it (ADR 0011 §3: "the ruleset loader").
- `rule_planner.plan_crew(crew: CrewSpec, zones: ZoneTimeline, rules: PlannerRules, *, local_date: date, tz: ZoneInfo) -> CrewPlan`. Order per tick, as ADR 0011 §2 says:
  1. `OFF` outside the shift; `BAN` in the ban window in season;
  2. Art. 18: for each attendance run (consecutive ticks that are neither `OFF` nor `BAN`; ADOSH rest is part of the run; an `OFF` gap of ≥ 60 min outside the ban is credited), if the run is longer than 5 h, place a 60-min `ART18_BREAK` at the 12-tick window with the lowest mean protective TWL such that both sides are ≤ 5 h (repeat greedily for longer runs);
  3. `STOPPED` in `RED` ticks (`STOP.red`) and in `MEDIUM`/`HIGH` ticks when acclimatised headcount < `lone_work_min_headcount` (`P-H7.lone` / `STOP.no_acclimatised`);
  4. cycles: work runs ≤ the cycle's work length; after a run, a full rest of the cycle's rest length; when the zone worsens mid-run, the run is cut to the new work length (immediately if already longer) and a full rest follows; when it eases mid-rest, the rest completes before the lighter cycle; and in every 12-tick window the `WORK` ticks ≤ `cap_minutes` of the most severe zone among that window's `WORK` ticks (the validator uses the same sentence);
  5. people rules produce `restricted_headcount` and `restrictions` (members unacclimatised → Low ticks only; ramp share; heavy work before day 7; juveniles excluded in the ban season); they do not change the crew's tick states except through rule 3.
- `fallback`: if `zones.source == "fallback"` or any on-shift tick has `fallback=True`, `status = "fallback"`.

- [ ] **Step 1: Write the failing tests** (L1 = 06:00-11:00 + 15:00-18:00, date 2026-07-01, heavy, 20 experienced):
  - `test_all_high_heavy_l1`: morning `WORK` 06:00-06:20, 07:00-07:20, … (5 runs), evening 3 runs → `work_minutes == 160`, `adosh_rest_minutes == 320`.
  - `test_all_medium_heavy_l1`: 45/15 → `work_minutes == 360`.
  - `test_all_low_l1`: `work_minutes == 480`, no rest.
  - `test_all_red_stops_everything` (`stopped_minutes == 480`).
  - `test_worsening_cuts_work`: Medium until 06:30 then High → work 06:00-06:30 then rest 06:30-07:10.
  - `test_rest_never_shortened_on_easing`: High until 06:30 then Medium → rest 06:20-07:00 is kept whole.
  - `test_art18_exactly_five_hours` (06:00-11:00 → no break) and `test_art18_break_at_hottest_hour` (06:00-12:30 + 15:00-17:00 → one 60-min break inside 06:00-12:30 at the lowest-TWL window; ban not credited).
  - `test_ban_window_local` (a 06:00-18:00 shift gets `BAN` 12:30-15:00 local on 2026-07-01, none on 2026-10-01).
  - `test_lone_work_stops` (headcount 1, Medium → `STOPPED`).
  - `test_unacclimatised_restricted` (2 members `days_on_site=2` → `restricted_headcount == 2`, `"P-H8.ramp"` in `restrictions`).
  - Properties (hypothesis, random zone sequences and L1/B1/B0 shifts): `test_no_added_minutes_property` (no `WORK` outside the shift; `work_minutes ≤ shift minutes`), `test_rolling_cap_property`, `test_run_length_property`, `test_deterministic` (same input → equal plan).
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/planner -q`. Expected: FAIL.
- [ ] **Step 3: Implement** (pure; no I/O; inputs sorted by id).
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(planner): rule-based ADOSH and Art. 18 planner on 5-minute ticks`.

---

### Task 6: The independent validator and the roster-text parser

**Files:**
- Create: `domain/validator/__init__.py`, `domain/validator/validator.py`, `domain/validator/roster_text.py`
- Modify: `pyproject.toml` (import-linter contracts 7 and 8)
- Test: `tests/unit/validator/test_validator_rules.py`, `tests/unit/validator/test_roster_text.py`, `tests/unit/validator/test_validator_vs_planner.py`

**Interfaces:**
- Consumes: `domain.plans.model`, `domain.plans.rules.PlannerRules`, `domain.risk.levels.Zone`, the ruleset's `clauses`. **Never** `domain.planner`.
- Produces:
  - `Violation(rule_id: str, clause: str, source_id: str, tick_ranges: tuple[tuple[int, int], ...], detail: str)` and `ValidationResult(violations: tuple[Violation, ...], checked_rules: tuple[str, ...])` with `passed` property.
  - `validate_plan(plan: CrewPlan, zones: ZoneTimeline, crew: CrewSpec, rules: PlannerRules, clauses: Mapping[str, ClauseRef], *, published_shift: tuple[ShiftBlock, ...] | None) -> ValidationResult`. Rules (rule id → check): `P-H1` work in a ban tick; `P-H7.cap60` a 12-tick window whose `WORK` count × 5 exceeds the cap of the most severe zone among its `WORK` ticks; `P-H7.run` a work run longer than the cycle's work length; `STOP.red` work in a `RED` tick; `P-H7.lone` work in `MEDIUM`/`HIGH` with headcount < 2; `P-H7.unacclimatised` work in `MEDIUM`/`HIGH` when `crew.members` says the crew has no acclimatised member, or `acclimatised=False` in try-a-plan; `P-H3` an attendance run > 5 h without a credited 60-min break (ban and ADOSH rest not credited while the switches are false); `P-H2.daily` attendance (work + ADOSH rest + stopped) > 8 h when `days_per_week × 3 × hours > 144`, or > 10 h always; `P-H2.weekly` `days_per_week × hours > 48`; `P-H5.*` juvenile rules when any member is a juvenile; `P-H8.heavy7` heavy work with a member before day 7; `P-H10` (only when `published_shift` is given) any `WORK` outside it. `checked_rules` lists every rule evaluated, including the ones that passed.
  - `roster_text.parse_roster(text: str) -> tuple[RosterSegment, ...]`: one segment per non-blank line `HH:MM-HH:MM work|rest|break` (case-insensitive, `#` comments allowed); start < end; within 04:00-22:00; no overlaps; at most 40 lines. Errors raise `RosterParseError(errors: tuple[tuple[int, str], ...])` with 1-based line numbers. `roster_text.plan_from_segments(segments, *, local_date, tz, labour) -> CrewPlan` (`work` → `WORK`, `rest` → `ADOSH_REST`, `break` → `ART18_BREAK`, uncovered → `OFF`, ban ticks stay as typed so `P-H1` can fire).

- [ ] **Step 1: Write the failing tests:**
  - One hand-built violating fixture per rule id above (`test_rule_<id>_fires`), each asserting the rule id, the clause from the ruleset and the first tick range.
  - `test_b0_common_roster_violations`: `"06:00-12:30 work\n15:00-17:00 work"` on 2026-07-01 under all-Medium zones, heavy, headcount 20 → contains `P-H3`, `P-H2.daily`, `P-H7.run`.
  - `test_rule_plans_always_pass_property` (hypothesis: `plan_crew` output on random zones and shifts has no violation with `published_shift` = the crew's shift).
  - `test_checked_rules_listed_when_passing`.
  - Parser: `test_parse_ok`, `test_parse_errors_have_line_numbers` (bad time, overlap, unknown state, outside 04:00-22:00), `test_parse_limits`.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/validator -q`. Expected: FAIL.
- [ ] **Step 3: Implement** independently of `rule_planner.py` (do not read it while writing the validator; write from ADR 0011 §3-§4 and this task).
- [ ] **Step 4: Run** the same and `uv run lint-imports` (8 contracts kept). Expected: PASS.
- [ ] **Step 5: Commit** `feat(validator): independent clause-cited plan validator and roster parser`.

---

### Task 7: Persistence, ports, fakes, the crew fixture, the hash-chained audit log

**Files:**
- Create: `alembic/versions/0003_b3.py`, `ports/{sites,push,alerts,plans,audit}.py`, `adapters/db/{sites,push,alerts,plans,audit}.py`, `adapters/fakes/{sites,push,alerts,plans,audit}.py`, `fixtures/demo_site.toml`
- Modify: `adapters/db/tables.py`, `adapters/db/config_store.py`, `composition.py`, `jobs/cli.py`
- Test: `tests/integration/test_migration_0003.py`, `tests/integration/test_audit_chain_pg.py`, `tests/integration/test_b3_stores_pg.py`, contract suites `tests/unit/contract/test_{sites,push,audit}_contract.py` (run on fakes in unit and on Postgres in integration), `tests/integration/test_site_load_cli.py`

**Interfaces:**
- Tables (expand-only; text ids; `sha256` columns as `text` with the `^[0-9a-f]{64}$` CHECK, as migration 0002): `site(id, name, timezone, station, lat, lon, employer_id, synthetic)`, `crew(id, site_id FK, employer_id, name, workload, shift jsonb, days_per_week)`, `crew_member(id identity, crew_id FK, days_on_site, days_away, away_reason, experienced, juvenile)`, `push_subscription(id text PK, endpoint text UNIQUE, p256dh, auth, expiration_time bigint NULL, site_id FK, crew_id FK NULL, created_at)`, `alert_event(id identity, site_id, audience, crew_id NULL, level, valid_from, template_id, kind, dedupe_key UNIQUE, created_at, delivered, failed, ruleset_id, ruleset_sha256, model_id NULL, config_version_id FK NOT NULL, config_sha256)`, `day_plan(id identity, crew_id, local_date, status, plan jsonb, violations int, created_at, ruleset_id, ruleset_sha256, model_id NULL, config_version_id FK NOT NULL, config_sha256)`, `crew_stop(id text PK, crew_id FK, started_at, cleared_at NULL, reason_code, actor)` (no member reference), `audit_event(id identity, at, kind, actor, actor_role, employer_id NULL, site_id NULL, outcome, detail jsonb, ruleset_id NULL, ruleset_sha256 NULL, model_id NULL, config_version_id NULL, config_sha256 NULL, prev_hash, row_hash UNIQUE)`. `alert_event`, `day_plan` and `audit_event` get the 0002-style UPDATE/DELETE row trigger and TRUNCATE statement trigger.
- Ports: `SiteRepository` (`list_sites()`, `get_site(id)`, `list_crews(site_id)`, `get_crew(id)`, `crew_spec(id) -> CrewSpec`); `PushSubscriptionStore` (`upsert_by_endpoint(sub) -> str`, `delete(id) -> None` idempotent, `for_site(site_id)`, `for_crew(crew_id)`, `delete_gone(id)`); `AlertStore` (`last_for_target(site_id, crew_id) -> AlertRecord | None`, `insert(event) -> AlertRecord | None` returning None on dedupe conflict); `DayPlanStore` (`insert(record)`); `CrewStopStore` (`start(crew_id, reason_code, actor) -> CrewStopRecord`, `clear(stop_id, actor) -> None` idempotent, `active_between(crew_id, start, end) -> Sequence[CrewStopRecord]`; in `ports/plans.py`); `AuditLog` (`append(event: AuditEvent) -> AuditRecord`, `site_entries(site_id, kinds, limit) -> Sequence[AuditRecord]`, `verify() -> int | None` first broken id).
- `AuditEvent` (frozen, `extra="forbid"`): `kind`, `actor`, `actor_role`, `employer_id`, `site_id`, `outcome`, `detail: Mapping[str, JsonValue]`, plus the five identity fields. A validator rejects `detail` keys that match the member-like regex of Task 0.
- Hash: `row_hash = sha256(prev_hash + canonical_json(row without id, prev_hash, row_hash))`; first `prev_hash` = `"0" * 64`; `append` takes `pg_advisory_xact_lock(0x5B_A0D1)` then reads the latest `row_hash`.
- `PostgresConfigStore.create_version` / `activate` (incl. rollback) append `config.version_created` / `config.activated` / `config.rollback` in the same transaction; `ConfigService` refusals append `config.rejected` (ADR 0052 §2).
- `fixtures/demo_site.toml`: exactly ADR 0057 §2.
- CLI: `sb-jobs site load PATH --actor A --reason R` (idempotent upsert; one `input.changed` audit row per changed crew-level field, member changes recorded as counts only) and `sb-jobs audit verify` (exit 0, or 1 with `audit.chain_broken id=<n>`).

- [ ] **Step 1: Write the failing tests:** migration up/down/up and `alembic check` no drift; Squawk 0 issues; `test_audit_update_delete_truncate_refused`; `test_verify_detects_edited_row` (drop the trigger in the test as superuser, edit `detail`, `verify` returns that id); `test_concurrent_appends_keep_one_chain` (20 concurrent appends → `verify() is None`); `test_upsert_by_endpoint_returns_existing_id`; `test_alert_dedupe`; `test_site_load_is_idempotent_and_audited`; `test_config_activation_writes_audit_in_same_txn` (a failing audit insert rolls back the activation); contract suites on fakes and Postgres.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/contract -q` and `uv run pytest -m integration tests/integration/test_migration_0003.py tests/integration/test_audit_chain_pg.py tests/integration/test_b3_stores_pg.py tests/integration/test_site_load_cli.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus `uv run squawk alembic/versions/0003_b3.py` (via the B1 CI helper). Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): B3 tables, stores, crew fixture and hash-chained audit log`.

---

### Task 8: Use cases `site_day` and `day_plan`

**Files:**
- Create: `application/site_day.py`, `application/day_plan.py`
- Modify: `composition.py` (build the corrector from the active model or `FakeCorrector(0.0)`; the forecast source from `SB_FORECAST_SOURCE`), `config.py` (`replay_default_date: date | None`)
- Test: `tests/unit/application/test_site_day.py`, `tests/unit/application/test_day_plan.py`

**Interfaces:**
- Consumes: B1 `WeatherForecastSource.previous_runs`, B2 `corrected_forecast` (or, until B2 Task 10b lands, `FakeCorrector` on the IFS rows) and `ForecastCorrector.sample`, Tasks 3-7.
- Produces:
  - `SiteDay` (frozen): `site`, `local_date`, `mode`, `forecast_status`, `lead_days`, `generated_at`, `hours: tuple[SiteHour, ...]` (`starts_at`, `wbgt_q05/q50/q95`, `level: AlertLevel | None`, `zone: Zone | None`, `ban_active`, `action_codes`), `zones: ZoneTimeline`, `identity` (`ruleset_id`, `ruleset_sha256`, `model_id`, `config_version`, `config_sha256`).
  - `async def site_day(*, site: SiteRecord, local_date: date, snapshot: ConfigSnapshot, catalog: RulesetCatalog, forecasts: WeatherForecastSource, corrector: ForecastCorrector, mode: Literal["replay","live"], now: datetime, lead_days: int = 1) -> SiteDay`. Samples: `corrector.sample(corrected, n_samples=50, seed=20261112)`; TWL via Task 3; levels at `params.warning_theta`; live mode: `stale` when `now − newest run time > forecast_stale_after_hours`; no row for an hour → that hour `level=None`, ticks `fallback`.
  - `class PlannerBugError(Exception)` carrying the `ValidationResult`.
  - `async def day_plan(*, site_day: SiteDay, crew: CrewSpec, catalog, snapshot, plans: DayPlanStore, audit: AuditLog, k_exposure: int) -> DayPlanResult` (`plan`, `validation`, `suppressed = crew.headcount < k_exposure`, `restricted_headcount = None if suppressed else plan.restricted_headcount`). Crew-lead stops (`CrewStopStore.active_between`) turn the covered ticks of the crew's `ZoneTimeline` into `RED` before planning, so the planner stops them and the validator checks them (`STOP.red`); the crew level of those hours is `red`. It runs `plan_crew`, then `validate_plan(..., published_shift=crew.shift)`; any violation → audit `plan.validator_rejected` (detail: rule ids and counts only) then raise `PlannerBugError`. Persists a `day_plan` row only when `snapshot.version_id is not None`.

- [ ] **Step 1: Write the failing tests** (fake forecast source, `FakeCorrector`, fake stores):
  - `test_site_day_levels_from_fake_corrector` (raw T/Td that give TWL < 115 at 10Z → `orange` at 10Z).
  - `test_site_day_is_deterministic` (two calls equal).
  - `test_missing_hour_is_fallback`.
  - `test_stale_forecast_is_labelled_and_protective` (live, run 31 h old → `stale`; all hours missing → `fallback` and every on-shift tick High).
  - `test_replay_never_stale`.
  - `test_identity_fields_present`.
  - `test_validator_rejection_is_a_500_and_audited` (monkeypatch the planner to emit work in a ban tick → `PlannerBugError`, one audit row).
  - `test_suppressed_crew_hides_restricted_headcount` (crew-d, 4 members).
  - `test_no_persist_without_db_snapshot`.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/application/test_site_day.py tests/unit/application/test_day_plan.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): site-day levels and validated crew day plans`.

---

### Task 9: k-suppression with complementary suppression

**Files:**
- Create: `domain/privacy/__init__.py`, `domain/privacy/suppression.py`
- Test: `tests/unit/privacy/test_suppression.py`

**Interfaces:**
- `Cell(key: str, count: int, group_size: int)`; `suppress(cells: Sequence[Cell], *, k: int, publish_total: bool) -> tuple[SuppressedCell, ...]` where `SuppressedCell(key, count: int | None, suppressed: bool, reason: Literal["below_k","complementary"] | None)`. A cell is suppressed when `group_size < k` (or `0 < count < k` for health counts via `k_health`). If `publish_total` and exactly one cell is suppressed, the visible cell with the smallest count is also suppressed (`complementary`); ties broken by key.
- `class DataClass(StrEnum)`: `HEALTH`, `EXPOSURE`; `k_for(data_class, params) -> int`.

- [ ] **Step 1: Write the failing tests:** `test_below_k_suppressed`; `test_complementary_suppression_defeats_differencing` (cells 12, 20, 9, 4 with total published: total − visible must not equal any single suppressed value); `test_no_complementary_without_total`; `test_two_suppressed_need_no_extra`; `test_k_floor_from_params` (k_health 10, k_exposure 5).
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/privacy -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(privacy): k-suppression with complementary suppression`.

---

### Task 10: Read routes, try-a-plan, employer tokens, governance refusal, transparency log

**Files:**
- Create: `api/auth.py`, `application/governance.py`
- Modify: `api/routers/{sites,crews,plans,governance}.py`, `api/deps.py`, `config.py` (`access_tokens: SecretStr | None`, JSON), `composition.py`, `openapi/v1.json`
- Test: `tests/unit/api/test_routes_sites.py`, `test_routes_crews.py`, `test_routes_validate.py`, `test_governance.py`, `tests/integration/test_governance_pg.py`

**Interfaces:**
- `auth.Principal(actor: str, role: Literal["employer"], employer_id: str)`; `auth.parse_access_tokens(raw: str) -> Mapping[str, Principal]` (keys are SHA-256 hex of tokens); dependency `EmployerDep` → 401 `UNAUTHORIZED` (no or unknown bearer; `WWW-Authenticate: Bearer`), the token compared with `hmac.compare_digest` against every key.
- Routes per ADR 0051, built on Task 8:
  - `get_site_forecast_today` → `SiteForecastToday` from `site_day` (hours 06:00-19:00 local).
  - `get_risk_policy` → `policy.risk_policy(...)`.
  - `list_site_crews`, `get_crew_timeline` (crew level = site level; `suppressed = member_count < k_exposure`; `k = k_exposure`).
  - `get_crew_day_plan`: `EmployerDep`; `principal.employer_id != crew.employer_id` → 403 `FORBIDDEN_EMPLOYER` + audit `access.denied`; else `DayPlan` with segments (merged runs of equal state, zone and rule id), clause text from the ruleset; `PlannerBugError` → 500 `PLAN_INVALID`.
  - `validate_plan`: parse → `CrewSpec(members=None, …)` → `validate_plan(..., published_shift=None)` against that day's `ZoneTimeline`; `RosterParseError` → 422 `ROSTER_INVALID` with `errors: [{line, message}]`.
  - `create_data_request`: `EmployerDep`; always 403 `INDIVIDUAL_DATA_REFUSED` (`detail`: "Individual health data is not held by this service and is never released to an employer (ADR 0004)."); audit `data_request.refused` with the five identity fields from the request's snapshot; `worker_ref` validated and dropped.
  - `get_site_transparency_log`: `AuditLog.site_entries(site_id, kinds=("data_request.refused",), limit=50)`.
  - `create_crew_stop` / `delete_crew_stop`: `EmployerDep`, own employer only (else 403 + audit); 201 `CrewStop` / 204 idempotent; audit `crew.stop_started` / `crew.stop_cleared` (no member reference). A stop **never waits for anything**: no sign-off, no validation, no forecast; it is written first and the Red crew push follows (Task 11 hook `on_crew_stop`).
- `application.governance.refuse_individual_data(*, principal, site_id, data_class, snapshot, audit) -> AuditRecord`.

- [ ] **Step 1: Write the failing tests:**
  - `test_forecast_today_shape_and_levels` (fakes; `config_version == 0` with a file snapshot).
  - `test_date_defaults_to_replay_default_date`.
  - `test_risk_policy_projection_route`.
  - `test_crew_timeline_suppressed_crew_keeps_level` (crew-d: `suppressed=true`, `crew_level` non-null).
  - `test_day_plan_requires_token` (401), `test_day_plan_other_employer_403_and_audited`, `test_day_plan_has_banner` (`banner_code == "plan.floor_banner"`, `signoff_state == "unsigned"`).
  - `test_validate_plan_b0_violations` (`roster_text` B0 → `P-H3` and `P-H2.daily` in violations, each with a clause), `test_validate_plan_parse_error_422_lines`, `test_validate_plan_exactly_one_input`.
  - `test_data_request_401_without_token`, `test_data_request_403_and_audit_row` (row has ruleset id/sha, model id, config version; no `worker_ref` anywhere in the row, the logs (caplog) or the response), `test_transparency_log_shows_refusal`.
  - `test_crew_stop_turns_level_red_and_plan_stopped` (stop at 10:00 local → timeline 10:00 hour `red`, day-plan ticks `stopped` from 10:00, validator passed), `test_crew_stop_other_employer_403`, `test_crew_stop_works_without_forecast` (forecast source raising → stop still 201).
  - Integration `test_governance_pg`: POST → 403, then GET transparency log lists it, then `sb-jobs audit verify` exits 0.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/api -q` and `uv run pytest -m integration tests/integration/test_governance_pg.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement**; regenerate `openapi/v1.json` (additive diff only; oasdiff `--fail-on ERR` green).
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): core-path routes, try-a-plan validator and governance refusal`.

---

### Task 11: Alert events, Web Push channel, subscriptions, `sb-jobs alerts dispatch`

**Files:**
- Create: `application/alerts.py`, `adapters/notifications/__init__.py`, `adapters/notifications/webpush.py`
- Modify: `api/routers/push.py`, `jobs/cli.py`, `composition.py`, `config.py` (`vapid_private_key: SecretStr | None`, `vapid_subject: str | None` — must start with `mailto:`), `pyproject.toml` (`pywebpush==2.5.0`), `uv.lock`
- Test: `tests/unit/application/test_alerts.py`, `tests/unit/adapters/test_webpush.py`, `tests/unit/api/test_routes_push.py`, `tests/integration/test_alerts_dispatch_cli.py`

**Interfaces:**
- `alerts.plan_alert_events(levels: Sequence[tuple[datetime, AlertLevel | None]], *, last: AlertRecord | None, now: datetime, dwell_minutes: int, lead_hours: int) -> tuple[NewAlert, ...]` (ADR 0058 §1: escalate immediately; de-escalate only after the milder level has held `dwell_minutes`; nothing earlier than `valid_from − lead_hours`; `None` levels never de-escalate).
- `alerts.dispatch(*, site_day: SiteDay, crews: Sequence[CrewSpec], alerts: AlertStore, subs: PushSubscriptionStore, channel: NotificationChannel, now: datetime) -> DispatchReport` (site events to site subscriptions; crew events to crew subscriptions; a `FAILED` result with `detail` starting `gone:` deletes the subscription).
- `WebPushChannel(vapid_private_key: str, vapid_subject: str, subs: PushSubscriptionStore)`, `name = "webpush"`, implements `NotificationChannel.send` for one subscription target through `send_to(sub, message)`: payload exactly `{"v": 1, "audience", "target_id", "level", "template_id", "valid_from"}` (compact JSON), `ttl=3600`, header `Urgency: high`, aes128gcm. Use `pywebpush.webpush_async` if its signature accepts `ttl` and `headers` (check the installed source); else `asyncio.to_thread(pywebpush.webpush, …)`. HTTP 404/410 → `FAILED`, `detail="gone:<status>"`; never log the endpoint.
- Routes: `create_push_subscription` (unknown site/crew → 404; crew not of that site → 404; repeat endpoint → same id, 201), `delete_push_subscription` (204, idempotent).
- CLI: `sb-jobs alerts dispatch --site ID [--date YYYY-MM-DD] [--as-of ISO]`.
- `alerts.on_crew_stop(stop: CrewStopRecord, …) -> DispatchReport`: one immediate `red` crew event (`template_id = "level-change"`), called by the stop route after the stop row is committed; a push failure never fails the stop request.

- [ ] **Step 1: Write the failing tests:**
  - `test_escalation_is_immediate`; `test_deescalation_waits_for_dwell` (milder for 55 min → none; 60 min → one); `test_dwell_never_delays_escalation_property` (hypothesis); `test_lead_hours_window`; `test_dedupe`.
  - `test_payload_has_exactly_six_keys` (capture the call into a fake `webpush`), `test_ttl_and_urgency`, `test_gone_subscription_deleted_on_404_and_410`, `test_endpoint_never_logged` (caplog).
  - `test_subscription_extra_member_422`, `test_repeat_endpoint_same_id`, `test_delete_idempotent`.
  - Integration `test_alerts_dispatch_cli` (testcontainers; fixture loaded; a recording channel injected via composition override; two events for crew-b, rows carry config identity).
- [ ] **Step 2: Run** the unit and integration commands for these files. Expected: FAIL.
- [ ] **Step 3: Implement**; `uv add pywebpush==2.5.0`; `uv run pip-audit` and `uv run deptry src` green.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(alerts): tier A alert events and Web Push delivery`.

---

### Task 12: θ under pre-registration §6.5 (`sb-jobs freeze theta`)

**Files:**
- Create: `ml/theta.py`
- Modify: `jobs/ml_cli.py`, `domain/scoreboard.py` (`ThetaDecision`)
- Test: `tests/unit/ml/test_theta.py`

**Interfaces:**
- Consumes: B2 `artifacts/eval/dev/oof_samples_abu_dhabi.parquet` (Task 12/14 of B2; 2024-2025 only, schema per B2), Task 3 functions, B2 `write_json` and `Provenance`.
- Produces:
  - `ThetaDecision{theta_protect: float, theta_balanced: float, grid: list[{theta, pod, far, pss, n_hours}], red_hour_share: float, n_hours: int, rule: Literal["preregistration §6.5"], provenance}`.
  - `select_theta(oof: pl.DataFrame, ruleset: Ruleset, params: EffectiveParams) -> ThetaDecision`: stations of the `abu_dhabi` cluster, lead 1, hours 06-14 UTC, 2024-2025; P(High) per hour = share of the 50 samples with `twl_eff < 115`; truth High = truth `twl_eff < 115`; hours weighted by `hour_ban_weight` (the §7.2 worked-hour weighting, stated in the freeze addendum as a clarification); θ grid {0.05, …, 0.95}; θ_protect = largest θ with POD ≥ 0.90, else 0.05; θ_balanced = argmax Peirce (ties → smaller θ). `red_hour_share` = weighted share of truth hours with `twl_eff < red_twl_w_m2` (information only; ADR 0046).
  - `sb-jobs freeze theta --oof PATH --ruleset ae-heat-2026.1 --out artifacts/eval/dev/theta.json`: refuses if any row has `summer == 2026`.

- [ ] **Step 1: Write the failing tests:** `test_theta_rule_on_synthetic` (constructed so POD crosses 0.90 between 0.30 and 0.35 → 0.30); `test_no_theta_reaches_pod_090_gives_005`; `test_balanced_ties_go_lower`; `test_refuses_2026_rows`; `test_output_has_provenance`.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/ml/test_theta.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ml): pre-registered warning threshold selection`.

---

### Task 13: Warnings and Plans scoreboards, demo day, dev dry run, roster-frontier export

**Files:**
- Create: `ml/scoreboards.py`
- Modify: `domain/scoreboard.py`, `jobs/evaluate_2026.py`, `jobs/ml_cli.py`
- Test: `tests/unit/ml/test_scoreboards.py`, `tests/unit/jobs/test_evaluate_2026_b3_parts.py`, `tests/regression/test_scoreboard_fixture.py`

**Interfaces:**
- Consumes: B2 `open_gate`, `Part`, `load_test_pairs`, `paired_block_bootstrap`, `write_json`, `Provenance`, `corrected_series_OMAA.parquet` and the released model's sampler (through an `ml/` helper); Tasks 3, 5, 6, 12; the freeze addendum (θ values, ruleset id, fixture sha).
- Produces (shapes in `domain/scoreboard.py`):
  - `select_demo_day(truth: pl.DataFrame, forecasts_present: pl.DataFrame, ruleset, params) -> DemoDay`: pre-registration §7.4 verbatim (candidates with all 9 hours 06-14 UTC `has_joint_obs` and `wbgt_obs_reject == 0` and lead-1 inputs; score = Σ `hour_ban_weight` over truth-High hours; max; ties → earliest; runner-up recorded). It reads no forecast output.
  - `warnings_scoreboard(rows: pl.DataFrame, *, theta_protect, theta_balanced, ruleset, params, leads=(1, 2, 3, 5, 7)) -> PolicyScoreboard`: policies P0 (ban only: warns nothing outside ban hours), P1 (raw `wbgt_fc_c ≥ 32`), P2 (raw TWL zone High, i.e. `twl_eff < 115` on the raw values), P3 at θ_protect and θ_balanced; per lead: weighted missed danger hours (truth `twl_eff < 115`, weight > 0, not warned), false-alarm hours, POD, FAR, CSI, alerts per worker-shift (= warned runs per day), worker-hours ×20 labelled "assumed"; paired bootstrap intervals (7-day blocks, B 2,000, seed 20261112); the 2×2 truth sensitivity (margin {0, 7} × withdrawal {off, on}); H4/H5 verdict strings per §13; lead 2 labelled "issued by 18:00 GST the evening before", lead 1 "about 24 hours ahead".
  - `plans_scoreboard(rows, *, crew: CrewSpec, ruleset, params) -> PlanScoreboard`: crew-b on L1; plans `naive`, `ban_only`, `rule_raw` (zones from raw values), `rule_corrected` (q10 of the corrected samples, ADR 0046 §4 without the clamp, as pre-registered); scored by `validate_plan` against truth `ZoneTimeline`s; per plan: violation minutes per worker-season (ticks with ≥ 1 violation × 5), share of truth-High-or-Red on-shift heavy ticks whose plan zone ≥ High, missed-protection ticks (plan zone < truth zone on worked ticks), rest minutes added vs naive; intervals as above; `identical_by_construction: ["naive", "ban_only"]` when equal (ADR 0057); H6/H7 verdicts.
  - `jobs/evaluate_2026.py --part warnings` writes `policy_scoreboard.json` and `demo_day.json`; `--part plans` writes `plan_scoreboard.json`; both open the B2 gate first, refuse unless `docs/research/2026-11-17-preregistration-freeze.md` is committed and its recorded hashes match (ruleset, fixture, theta.json), and refuse a second run without `--amendment`.
  - `sb-jobs scoreboard dev --summer 2025 --out artifacts/eval/dev/` writes `policy_scoreboard.2025.json`, `plan_scoreboard.2025.json`, `demo_day.2025.json` from the B2 OOF samples (label "DEV 2025, LOCO out-of-fold: not the result") so F2 builds on real shapes before the 2026 run.
  - `sb-jobs export roster-frontier --src docs/research/scripts/roster/results/roster_frontier.json --out artifacts/eval/static/roster_frontier.json`: byte-identical data under `data`, plus provenance (script path, source SHA-256, run date from the file's own metadata); the guard check "nothing recommended at 45 min commute, floor 21:30" is asserted.
- Every export: `provenance.protocol_anchor` per section (`#72-warnings-row-…`, `#73-plans-row-…`, `#74-demo-day-…`), each `Metric.anchor` set, label `REAL weather + assumed crew` for plans and `REAL` for warnings and the demo day.

- [ ] **Step 1: Write the failing tests:**
  - `test_partial_ban_weights` (label 08Z = 0.5 in season).
  - `test_demo_day_rule` (synthetic 10 days: max wins; tie → earliest; a day with one missing hour is not a candidate).
  - `test_p0_warns_nothing_outside_ban`, `test_pod_far_csi_weighted` (hand-computed 6-hour example).
  - `test_plans_naive_equals_ban_only_on_l1` and `test_rule_corrected_le_naive_violations` on a committed 10-day synthetic fixture with hand-computed counts (AT-15 corrected).
  - `test_exports_have_provenance_and_anchors`.
  - `test_parts_refuse_without_freeze_file` and `test_parts_refuse_second_run`.
  - Regression (`regression`, `slow`, skipif no OOF file): `sb-jobs scoreboard dev --summer 2025` runs and its JSON validates against the models.
- [ ] **Step 2: Run** `uv run pytest -m unit tests/unit/ml/test_scoreboards.py tests/unit/jobs/test_evaluate_2026_b3_parts.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** Measure the TWL cost on one 2025 month and print it; if the full dev run exceeds 30 min, cache TWL per `(station, valid_time, lead, sample)` in `$SB_DATA_DIR/cache/twl/` (parquet), never in the repo.
- [ ] **Step 4: Run** the same. Expected: PASS. Then (controller) run `sb-jobs scoreboard dev --summer 2025` and `sb-jobs export roster-frontier`; commit the outputs.
- [ ] **Step 5: Commit** `feat(eval): warnings and plans scoreboards, demo day and dev exports`.

---

### Task 14: Controller step: freeze addendum, θ, config activation, the gated runs

**Files:** `docs/research/2026-11-17-preregistration-freeze.md`, `artifacts/eval/dev/theta.json`, `backend/config/runtime/default.toml`, `artifacts/eval/2026/{policy_scoreboard,demo_day,plan_scoreboard}.json`.

- [ ] **Step 1:** After Tasks 2, 7 and 12 are committed and B2's OOF export exists: `uv run sb-jobs freeze theta …`; commit `theta.json`.
- [ ] **Step 2:** Write the freeze addendum with only the §11 slots: `ae-heat-2026.1` id and SHA-256; margin 7.0; withdrawal off; `demo_site.toml` SHA-256; the ban window as dated config; model id and `selection.json` SHA-256 (from B2); θ_protect, θ_balanced and the `theta.json` SHA-256; the clarification that §6.5 hours carry §7.2 ban weights; the ADR 0046 Red edge and the 2024-2025 truth-Red share (information). Ali reviews and commits it, plus the ADR 0057 amendment-log row if he accepts it.
- [ ] **Step 3:** `sb-jobs config propose` + `activate` with `tunables.warning_theta = θ_protect` (clamped to [0.05, 0.50], ADR 0048 §4), reason "pre-registered θ (ADR 0048)"; set the same in `default.toml`; commit.
- [ ] **Step 4 (only after Ali's go, on a clean tree):** `uv run sb-jobs evaluate-2026 --part warnings`, then `--part plans`. Record commit, time and output hashes in the pre-registration results log via an amendment-log row (Ali). Commit `feat(eval): 2026 warnings and plans rows (pre-registered)`.

---

### Task 15 (SHOULD, 17 Nov; drop at 15:00 if any MUST task is not green): CP-SAT in-shift sequencer

**Files:** Create `ports/day_plan_solver.py`, `adapters/compute/cpsat_day_planner.py`; modify `domain/config/runtime.py` (`RuntimeFlags.planner_cpsat_enabled: bool = False`), `application/day_plan.py`, `composition.py`. Test: `tests/unit/adapters/test_cpsat_day_planner.py`.

**Interfaces:** `DayPlanSolver.solve(crew: CrewSpec, zones: ZoneTimeline, rules: PlannerRules, *, det_time_s: float) -> SolverResult(plan: CrewPlan | None, status: Literal["OPTIMAL","FEASIBLE","INFEASIBLE","UNKNOWN"], stages: tuple[StageStat, ...], reproducible: bool)`. ADR 0011 §5 verbatim: per-tick booleans, 12-tick sliding caps, run limits via forbidden k+1 runs, Art. 18 `brk` ticks, stage 1 (unmet must-do work) → stage 2 (strain) with incumbent fixing; `num_workers = 1`, `random_seed = 20261111`, `max_deterministic_time = det_time_s`, `max_time_in_seconds = 10`. Every output passes `validate_plan` or the rule plan is served with status `FALLBACK`.

- [ ] Steps as AT-19/AT-20: failing tests (`test_stage1_ge_rule_plan_work`, `test_output_passes_validator`, `test_byte_identical_resolve_in_subprocess`, `test_flag_off_serves_rule_plan`), run, implement, run, commit `feat(planner): CP-SAT in-shift sequencer behind planner_cpsat_enabled`.

---

### Task 17 (contingent: only if Ali answers ADR 0045 flag F1 by building `supervisor-plan`): plan sign-off

> **PROMOTED TO MUST, 2026-11-14 (Ali, in chat).** The word "contingent" in the heading above no longer applies: sign-off stays in B3, and ADR 0045 flag F1 is answered by building `supervisor-plan` as the tenth core view (ADR 0045 Amendments; ADR 0053 Amendments). The task number, the steps and the 2.5 h estimate are unchanged; it counts in the MUST total (about 46 h). Additions to the text below:
> 1. **One acknowledgement is one tick per run of the same warning level.** The server derives the item list from the day plan (runs of consecutive plan blocks at the same zone above Low, as the prototype's `ackItems` groups them) and `acknowledged_items` carries those ids. Fix the id format in Task 0's contract.
> 2. **The class (d) invariant is a MUST test, not a note: sign-off can never delay an alert or a stop.** A stop (`create_crew_stop`, Task 10) and an alert dispatch (Task 11) neither read nor wait on sign-off state. Test both with no sign-off, with a refused sign-off (409 `review-required`) and with a sign-off in flight. With no sign-off the plan stays `unsigned` with the label `plan.unsigned_fallback`.
> 3. **Scheduling:** the table's "free lane" no longer fits a MUST task; the controller assigns Task 17 to a lane after Tasks 8 and 10. "Supersedes ADR 0053 for sign-off" is now literal.

ADR 0011 §7.1 as written: `POST /api/v1/crews/{crew_id}/day-plan/sign-off` (`sign_off_day_plan`, employer token) with `{acknowledged_items: list[str], deviation_reason_code: str | None}`; one-tap allowed only when the plan equals the last accepted plan and has no Medium/High work, else `review-required` (409) unless every Medium/High item is acknowledged; `plan_signoff` table; audit `plan.signed`. Test AT-10: with no sign-off, alerts and stops still fire and the plan says `unsigned`. About 2.5 h; supersedes ADR 0053 for sign-off.

### Task 18 (contingent: only if Ali keeps ADR 0045 §3's "config admin API"): config admin HTTP API

> **2026-11-14: stays contingent, not promoted with Task 17.** Ali kept the settings admin API and the admin screen deferred (ADR 0052 Amendments; ADR 0045 Amendments). He can overrule.

Roadmap §5 / ADR 0010 §3-4 as written, on B1's `ConfigService`: `POST /api/v1/admin/config/versions`, `/activations` (`expected_previous_activation_id` required, ADR 0041), `/rollback`; `SB_ADMIN_TOKENS`; 401/403 `unauthorized` + `config.auth_failed` audit, 409 `stale-activation`, 422 `config-invalid` with `violations`. About 2 h; supersedes ADR 0052.

### Task 16: End-to-end replay smoke and whole-branch review

- [ ] **Step 1:** Integration test `tests/integration/test_b3_e2e_replay.py` (`slow`): testcontainers Postgres, `sb-jobs db upgrade`, `sb-jobs site load fixtures/demo_site.toml`, a small replay snapshot (B2 fixture), the app with `SB_FORECAST_SOURCE=replay`: GET forecast today → 14 hours with levels; GET crew-b day plan with the demo token → validator passed, banner present; POST validate B0 → violations; POST data request → 403; transparency log lists it; `sb-jobs alerts dispatch` with a recording channel → events with config identity; `sb-jobs audit verify` → 0.
- [ ] **Step 2:** `uv run pytest -q -m "unit or integration"`, `uv run lint-imports`, `uv run mypy src tests`, `uv run ruff check`, oasdiff `--fail-on ERR` against the Task 0 snapshot. Expected: all green.
- [ ] **Step 3:** Whole-branch review on **Sonnet** against this plan's Review Focus and ADRs 0046-0058 (ADR 0012 amendment 2026-11-14: Opus only with Ali's explicit per-use permission; ask him if a second, Opus review is wanted).
- [ ] **Step 4:** Commit `test(b3): end-to-end replay smoke`.

---

## Ordering, parallelism and hours

| Task | Est. h | Needs | Lane | Day |
|---|---|---|---|---|
| 0 OpenAPI v1 contract | 3 | B2 T1 (done) | A | Sun 15 AM (F2 unblocked by 12:00) |
| 1 Pin check + date re-validation | 2 | — | B | Sun 15 AM |
| 2 Ruleset `ae-heat-2026.1` | 3.5 | 1 | B | Sun 15 |
| 3 TWL samples, zones, levels, ticks, plan types, `PlannerRules` | 4.5 | 2 | A | Sun 15 PM |
| 7 Persistence, audit chain, fixture | 4 | 2 | B | Sun 15 PM |
| 5 Rule planner | 3.5 | 3 | A | Mon 16 AM |
| 6 Validator + parser | 3 | 3 (not 5) | B | Mon 16 AM |
| 4 Personal parity + policy | 1.5 | 2 | B | Mon 16 |
| 9 k-suppression | 1.5 | — | B | Mon 16 |
| 8 `site_day` + `day_plan` | 3 | 3, 5, 6, 7 | A | Mon 16 PM |
| 10 Routes + governance + crew stop | 4.5 | 4, 8, 9 | A | Tue 17 AM |
| 11 Alerts + Web Push | 3 | 7, 8 | B | Tue 17 AM |
| 12 θ | 2 | 2, 3; B2 OOF export (B2 T12/T14) | B | Mon 16 PM or Tue 17 |
| 13 Scoreboards + dev exports | 4.5 | 5, 6, 12; B2 T3, T5, T12, T13, T15 command | A | Tue 17 PM |
| 14 Freeze, θ activation, gated runs (controller) | 1.5 + compute | 2, 7, 12, 13; Ali's go | — | Tue 17 evening / Wed 18 AM |
| 16 E2E smoke + Opus review | 2 + review | all MUST | — | Tue 17 evening |
| **MUST total** | **≈ 43.5 h** across two lanes (≈ 22 h each over three days); **≈ 46 h with Task 17 from 2026-11-14 (≈ 23 h each)** | | | |
| 17 Sign-off (contingent, ADR 0045 flag F1) → **MUST 2026-11-14, counts in the total** | 2.5 | 8, 10 | free lane → a lane set by the controller | Tue 17 |
| 18 Config admin API (contingent, ADR 0045 §3) → **stays contingent 2026-11-14** | 2 | 7 | free lane | Tue 17 |
| 15 CP-SAT (SHOULD) | 5 | 5, 6, 8 | whichever lane is free | Tue 17, **dropped at 15:00 unless every MUST task is green** |

- **What can start after B2 Task 1 (now):** Tasks 0, 1, 2, then 3-9 entirely on `FakeCorrector` and synthetic frames. Only Task 12 (needs the OOF export), Task 13 (needs B2's gate, bootstrap, provenance, replay and the 2026 series) and the `LightGbmCorrector` path of Task 8 wait for later B2 commits; the controller merges them in at task boundaries.
- **Same-file hazards (never concurrent):** `composition.py` (7, 8, 10, 11), `jobs/cli.py` (7, 11), `jobs/ml_cli.py` (12, 13), `api/app.py` and `openapi/v1.json` (0, 10, 11), `pyproject.toml` (6, 11), `domain/config/runtime.py` (1, 2, 15).
- **Realistic CP-SAT outlook:** with ≈ 42 MUST hours on two lanes, CP-SAT fits only if Tasks 10, 11 and 13 are green by about 13:00 Tue. Expect the RULE chip to be the demo (ADR 0011 §1 allows it).
- **Cut order if behind (within MUST, decided now):** Task 13's leads 5 and 7 → the 2×2 sensitivity beyond margin {0, 7} with withdrawal off → `sb-jobs scoreboard dev` → Task 11's crew-level pushes (site pushes stay). Never cut: validator, no-added-minutes, unsigned label, employer scoping, k, banner, determinism, governance refusal + audit chain, the Warnings row.

## Exit criteria for B3

- CI green: unit + integration + 8 import contracts + mypy + ruff + Squawk + pip-audit + oasdiff `--fail-on ERR`.
- `openapi/v1.json` matches ADR 0051; F2 has regenerated types; the F1 governance test passes against it.
- `ae-heat-2026.1` released, locked, golden-tested; the ADR 0044 pin check and date re-validation landed **before** it.
- Every shown plan passed the validator; a rejected plan is a 500 with an audit row (tested).
- The governance refusal works on the deployed URL: 403, audit row with ruleset/model/config identity, visible in the transparency log; `sb-jobs audit verify` is 0.
- A Web Push from `sb-jobs alerts dispatch` reaches a real Android phone (with F1 Task 15).
- Freeze addendum committed before any 2026 Warnings or Plans number; `warning_theta` activated; the three 2026 JSON files committed with provenance.

## Decisions Ali must make (before Task 2 is released, unless noted)

1. Accept ADRs 0046-0058 (all Proposed-for-Ali). The ones that change freeze-addendum values: **0047** (margin 7, withdrawal off), **0046** (Red edge 85 W/m² inside the ruleset hash), **0057** (fixture SHA).
2. **ADR 0057:** add the amendment-log row collapsing plans (a) and (b) on L1 (before the plans run), or keep both rows with equal numbers.
3. **Conflict between your B3 brief ("exactly the API the 9 views need") and ADR 0045 §3 ("B3 MUST set unchanged: sign-off and stop-work endpoints, config admin API").** This plan keeps the crew-lead stop endpoints (safety) and defers sign-off (ADR 0053) and the admin API (ADR 0052). Pick: confirm the deferrals, or run contingent Tasks 17 and/or 18 (+4.5 h, which pushes CP-SAT out entirely).
4. **ADR 0052:** if confirmed, the I1 owner amends Task 7 Steps 3b-3c to the CLI drill.
5. Task 14: the go for the gated 2026 Warnings and Plans runs after reading the freeze addendum.

**Resolved 2026-11-14 (Ali, in chat; the list above is kept as written):**
1. ADRs 0046-0058 are accepted.
2. ADR 0057's amendment is written as [pre-registration amendment 1](../../research/2026-11-14-preregistration-amendment-1.md) section 4, a separate file, because a row inside the committed pre-registration would break the gate hash; plans (a) and (b) collapse on L1. Task 14 Step 2's "ADR 0057 amendment-log row" therefore means this file: the freeze addendum cites it, and the B2 controller extends the protocol lock to hash it.
3. The conflict is settled as follows: the crew-lead stop endpoints are kept (Stop work on supervisor crews now uses them); **sign-off is built (Task 17, MUST)**; the config admin API stays deferred (Task 18 stays contingent). CP-SAT is expected to be dropped.
4. ADR 0052 is confirmed. The I1 owner still has to amend Task 7 Steps 3b-3c to the CLI drill; that edit is not made here.
5. Task 14's go for the gated 2026 runs is not given by this note; it stays Ali's, after he reads the freeze addendum.
