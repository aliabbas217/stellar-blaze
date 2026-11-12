# ADR 0009: Evolvability, configurability and low blast radius

- **Status:** Accepted (Ali, in chat, 2026-11-11); previously Proposed (2026-11-11), for Ali's acceptance. **Partially superseded by ADR 0010 (2026-11-11):** §1 "Rules never hot-reload" (operating values now change at runtime within ranges the ruleset declares; rules and floors stay files), §3 rollback via `SB_MODEL_ID` + new revision, §4 for flags safe to flip live, and the "Not doing now" rows on flag services and DB-edited values. The text below is kept as decided.
- **Evidence:** ADR 0001 (single-revision ACA, migrate job before rollout), 0002 (ports), 0004 (WhatsApp never live), 0006 (TWL zone edges, withdrawal limits undecided), 0007 (artefact list); sources cited inline, checked 2026-11-11

## Context
Thresholds, zones, labour-law windows and alert policy will change: B3 has not yet decided the TWL margin or the withdrawal limits, regulators revise rules, and pilots need different values per employer. Every such change should be a reviewed data change with a known blast radius, not a code edit spread across modules. There are 9 days left, so each mechanism below costs at most one small module.

## Decision
**1. Rules are versioned data. Physics stays in code.** The test for "is this data?": a regulator, employer or guideline edition could change it without the science changing. Data: ADOSH TWL zone edges and the bias margin, the withdrawal-limit switch and values, the NIOSH Table 3-2 clothing adjustments, alert-level probability bands, acclimatization schedule, midday-ban dates and hours, work-hour and break limits, k-suppression, planner soft-cost weights, and action codes / template ids. Code: the REL/RAL equations, Liljegren, PHS, the TWL solver and `TwlParams` (these are the model, and published vectors pin them).
- **Format: TOML, parsed with stdlib `tomllib`, validated by frozen `extra="forbid"` Pydantic models.** We use TOML, not YAML. TOML needs no new dependency, and it has native dates and times. PyYAML 6.0.3 (YAML 1.1) parses `ban_start: 12:30` as the integer `750` and `NO` as `False` (reproduced 2026-11-11). `tomllib` on Python 3.13 is TOML 1.0, so times are written `12:30:00`.
- **Layout:** `backend/rulesets/<id>.toml`, with id `<jurisdiction>-heat-<yyyy>.<n>` (for example `ae-heat-2026.1`). Each file has `[meta]` (`id`, `effective_from`, `effective_to`, `status = "draft"|"released"`) and `[[sources]]` (`id`, `title`, `url`, `clause`, `accessed`). Every value section names a `source` id, and the loader rejects unknown source ids.
- **Immutability:** `backend/rulesets/lock.json` maps each released id to the SHA-256 of its file. A released ruleset is never edited. To change one, add a new file with a new id that declares `supersedes = ["<old id>"]`. The superseded ruleset can still be pinned, for audit replay. With `SB_ENV=prod`, the loader refuses drafts.
- **Loading:** once at startup, in the composition root, into an immutable `RulesetCatalog`. Among non-superseded rulesets, effective ranges must not overlap. A decision uses the ruleset effective on its Asia/Dubai local date. A date with no ruleset is an error, never a silent default. `SB_RULESET_ID` pins one ruleset for back-tests or rollback. Rules never hot-reload.
- **Audit:** every decision row, alert row and decision-carrying API response records `ruleset_id`, `ruleset_sha256` and `model_id` (B3 tables: NOT NULL, except `model_id`). The API field is `policy_version`, the name already in F1's contract. structlog binds all three at startup.
- **Testing a change:** each ruleset has `tests/fixtures/rulesets/<id>.golden.json` (inputs → expected zone, level and actions). A ruleset with no golden file fails CI. Golden tests carry the `unit` marker so CI runs them (CI deselects `regression`). Alert words stay in `frontend/messages/*.json`, which F1 already makes the only home for user-visible strings. The ruleset holds only codes, and a B3 test asserts that every code has an `en` key.

**2. Boundaries.** The domain is pure. Ports and adapters follow ADR 0002. Only `stellar_blaze/composition.py` reads `Settings` to choose implementations. It does so through plain dict registries (for example `FORECAST_SOURCES: Mapping[ForecastSourceKind, factory]`). There is no DI framework, and no service locator anywhere else: handlers receive dependencies through FastAPI `Depends` from `app.state.runtime`. The import-linter contracts are B1's four plus one more:
(1) layers `api | jobs` > `application` > `ports` > `domain`;
(2) `domain` must not import I/O libraries or outer packages;
(3) `application` must not import `adapters`, `api` or `jobs`;
(4) `adapters` must not import `application`, `api` or `jobs`;
**(5) new:** `api` and `jobs` must not import `adapters.sources`, `adapters.fakes`, `adapters.compute` or `adapters.config`, with `allow_indirect_imports = true`. That flag lets them reach adapters only through `composition`. import-linter's forbidden contracts treat indirect imports as violations unless the flag is set (docs, "Forbidden modules"). Fakes can therefore never be wired into a production path.

**3. Model artefacts.** `backend/models/<model_id>/`, with id `corrector-<yyyymmdd>-<gitsha7>`. It holds the ADR 0007 files plus `manifest.json`: `model_id`, `created_at`, `git_sha`, `uv_lock_sha256`, `gold_manifest_sha256`, per-regime metrics, and `files[{path, sha256}]`. The loader verifies every hash at startup. `SB_MODEL_ID` selects the model; unset means raw NWP, labelled "uncorrected". The image ships the current model and the previous one. A rollback is a config change only: changing an env var creates a new Container Apps revision (env is under `properties.template`, a revision-scope change; MS Learn "Update and deploy changes"). It needs no rebuild.

**4. Feature flags are typed `Settings` fields only, and each is added together with the code it gates:**
- `SB_FORECAST_SOURCE=open_meteo|replay` (B1; `replay` is registered in B3 and is the prod value on `job-refresh`).
- `SB_ENABLE_WHATSAPP_ADAPTER=false` (B3/F2 payload inspector; a validator rejects `true` with `SB_ENV=prod`, per ADR 0004).
- `SB_ENABLE_LLM_COPILOT=false` (only when the parked `LlmClient` port is built).
- Config pins (not flags): `SB_RULESET_ID` and `SB_MODEL_ID`.

On the frontend, runtime flags are read on the server. Next.js inlines `NEXT_PUBLIC_*` values into the bundle at `next build`, so they "will be frozen with the value evaluated at build time" (Next.js docs, Environment Variables).

**5. API evolution.** Everything lives under `/api/v1`. Changes are additive only after the 14 Nov freeze; a breaking change means `/api/v2`. FastAPI's spec is committed as `backend/openapi/v1.json`, and a unit test fails when it drifts. CI runs **oasdiff v1.35.0**: `oasdiff breaking <base>:backend/openapi/v1.json backend/openapi/v1.json`. Before the freeze it only reports; B3 Task 0 adds `--fail-on ERR`. We take v1.35.0 (2026-10-28) rather than v1.37.0 (2026-11-08), in the spirit of F1's `minimumReleaseAge`. 3.1 support has been GA since v1.15.0. The binary comes from the release tarball, checked against `checksums.txt`. F2 generates the client from that committed file.

**6. Database.** Alembic migrations are reversible, with up/down/up tested in CI and Squawk lint (ADR 0008). **Expand/contract is mandatory, not optional.** `job-migrate` runs before rollout, and single-revision mode keeps the old revision serving until the new one is ready (ADR 0001; MS Learn). The old code must therefore work against the new schema: add first, backfill, switch, then drop in a later release.

**7. Frontend.** Tokens (`tokens.css`) and messages (`messages/*.json`) are data. The client is generated (`openapi-typescript`). Route groups are isolated by ESLint core `no-restricted-imports`, which adds no new dependency. Worker code (profile, risk) and supervisor code cannot import each other, so a supervisor screen cannot reach on-device personal data.

## Not doing now, and why
| Option | Why not |
|---|---|
| Rules engine (Drools, OPA/Rego, json-logic, GoRules) | Our rules are parameters: tables, edges and date windows. The logic stays in typed code under mypy and hypothesis ("never less protective than the ban"). An engine would move safety logic outside those checks. Drools is JVM; OPA is an authorization-policy engine |
| Flag SaaS / OpenFeature / Azure App Configuration | An env change already gives a new revision. Any of these adds a runtime network dependency on the safety path |
| Hot-reload or DB-edited rules (admin UI) | Unreviewed rule changes; revision-pinned rules are the audit trail |
| Plugin system (entry points, pluggy), microservices, DI framework | One deployable, all adapters in the repo, two containers (ADR 0001/0002); a dict registry suffices |

Parked in `docs/parking-lot.md` with triggers.

## Consequences
- Each rules change touches one TOML file, one golden file and the lock; the blast radius is visible in one PR.
- B1 grows by one task (7A, about 2 h) and a few steps; no dependency is added.
- Demo risk: a missing or overlapping ruleset fails at startup, and readiness stays red. That is intended: loud failure, never wrong rules.

## Revisit trigger
A non-engineer must change rules without a deploy; more than one environment needs different flags at runtime; a second deployable appears; oasdiff reports false positives on FastAPI's `anyOf`-null fields (record them; the 3.1 docs cover only type arrays).

## Plan amendments
| File | Task | Change |
|---|---|---|
| `2026-11-11-b1-backend-foundation.md` | Header, File structure | Spec line adds ADR 0009; tree adds `composition.py`, `domain/rules/`, `adapters/config/`, `rulesets/`, `models/`, `openapi/v1.json` |
| same | Task 2 | `Settings` gains `forecast_source`, `ruleset_id`, `model_id`, `rulesets_dir`, `models_dir`; tests for them; committed `openapi/v1.json` + drift test |
| same | Task 4 | Dockerfile copies `rulesets/` and `models/`; CI installs oasdiff v1.35.0 (checksum-verified), report-only breaking check |
| same | Global Constraints | ADR 0009 bullet: regenerate the spec when routes change; policy values only in rulesets; adapters chosen only in `composition` |
| same | **Task 7A (new)** | Ruleset schema, loader, lock, catalog, released seed `ae-heat-0.1` (Table 3-2, zone edges 140/115, withdrawal limits disabled), golden harness, model-manifest loader, `composition.py`, contract 5, lifespan + log binding |
| same | Task 10 | `build_sources` moves to `composition`; tests inject fakes through the registry argument, not monkeypatching |
| same | Task 12 | `effective_wbgt_c(wbgt_c, adjustment_c)`; the Table 3-2 mapping lives in the ruleset (7A test pins the values) |
| same | Task 13 | `apply_withdrawal_limits(..., limits: WithdrawalLimits)`; the values default to the reference's and are mirrored in the ruleset |
| same | Exit criteria, Ordering | Ruleset + contract 5 in exit criteria; 7A after Task 7 |
| `2026-11-11-f1-frontend-foundation.md` | Global Constraints | Rule: runtime flags are server-read, never `NEXT_PUBLIC_*`; action/template codes come from the ruleset |
| same | Task 4 | ESLint `no-restricted-imports` blocks between route groups + a test |
| same | Task 5 | `RiskPolicy.version` / `policy_version` = ruleset id |
| same | Execution | F2's `api:gen` source = committed `backend/openapi/v1.json` |
| `2026-11-11-i1-azure-infra.md` | Task 3 | Optional `forecastSource`, `rulesetId`, `modelId` params; env entries emitted only when non-empty; `SB_FORECAST_SOURCE=replay` on `job-refresh` |
| same | Task 5, Task 7 | deploy exports `SB_RULESET_ID`, `SB_MODEL_ID` from `demo` variables; Task 7 Step 3 names the env var; new Step 3b: config-only rollback drill |
| `2026-11-11-roadmap.md` | Inputs, §1, §2, §3, §4, §5, §8 | ADR 0009; Thu adds B1 7A; env vars; 15 B1 tasks; B2 artefact convention; B3 ruleset `ae-heat-2026.1`, audit columns, `replay` registration, oasdiff `--fail-on ERR`; checklist item |
| `docs/parking-lot.md` | — | Six rows: ruleset admin UI, per-employer overlays, flag service, OPA for RBAC, oasdiff bump, LFS/object store for models |

## Amendments
- **2026-11-12 (B1 as built, decision text unchanged):** what Tasks 2, 4, 7A and the final wave changed or decided in practice. Evidence: B1 rulings 2, 4, 5, 14, 20; `.github/workflows/ci.yml`, `backend/src/stellar_blaze/api/app.py`, `backend/openapi/v1.json`, `backend/rulesets/lock.json`, `backend/src/stellar_blaze/domain/rules/ruleset.py`, `domain/config/models.py`, `api/middleware.py`, `domain/physics/twl.py`; commits `f605902` (Task 2), `7a8e3f5` (Task 3), `5f35ebf` (Task 4), `c44bfe9`, `dbe5840` and `7702720` (Task 7A), `5f00cbe` (final wave). SHAs are commits on branch `feat/b1-backend-foundation` (HEAD `5f00cbe`, not yet merged; a squash merge changes them, so the paths named are the lasting evidence). Rulings are numbered as in the B1 controller's `b1-summary.md`, which is deleted after the merge.
  1. **§5, oasdiff integrity.** "The binary comes from the release tarball, checked against `checksums.txt`" was replaced by an expected sha256 pinned inline in `ci.yml` (taken on 2026-11-12 from the v1.35.0 release's `checksums.txt`; the release asset's `digest` in the GitHub API agrees). A checksum file served next to the archive proves nothing when that place is what an attacker controls. The version stays v1.35.0 (ADR 0030, ruling 4). The step uses the git-ref form `oasdiff breaking <base>:backend/openapi/v1.json backend/openapi/v1.json`, report-only, and has not yet run on a real runner (the first GitHub Actions run is the exit criterion).
  2. **§5, `operationId` scheme (needs F2's confirmation before the 14 Nov freeze).** FastAPI's default operation id embeds the path and method and changes whenever a route moves. B1 sets it to the route function's name (`health_live`) with `generate_unique_id_function`; uniqueness is by convention and `test_operation_ids_are_unique_and_are_the_route_function_names` enforces it (ruling 2). F2's `openapi-typescript` client names its functions after it, so the scheme is part of the contract that freezes on 14 Nov. **Cost of being wrong:** one OpenAPI regeneration before the freeze if F2 wants another scheme; after the freeze it is a breaking change.
  3. **§1, ruleset id pattern.** The pattern `<jurisdiction>-heat-<yyyy>.<n>` did not match the seed `ae-heat-0.1`; the loader accepts a year part of `0` (`(\d{4}|0)`) for that pre-calendar seed only. `ae-heat-0.1` is released (`effective_from` 2024-01-01), its lock entry is `7cfb5d10…d954`, it has a golden file, and a prod start logs `ruleset_ids=ae-heat-0.1`.
  4. **§1, audit binding.** "structlog binds all three at startup" holds for the process-wide ids, but a context bound in the lifespan does not reach request handlers, so `api/middleware.py` rebinds `ruleset_ids` and `model_ids` for each request. The `config_version` and `config_sha256` of the snapshot in use are bound where a request resolves its snapshot (`get_snapshot` in `api/deps.py`; the readiness probe does it itself).
  5. **§2, where the registry types live.** `ModelRegistry`, `ModelManifest` and `LoadedModel` are in `domain/config/models.py`, not under `adapters/config/`: contracts 2 and 3 forbid the domain and application from importing adapters, and `ConfigService` needs those types. The five import contracts are all kept (`lint-imports`).
  6. **Plan amendments table, Task 13.** "the values default to the reference's" no longer holds: `apply_withdrawal_limits(..., limits)` takes `limits` with no default, because a caller that could omit it would apply the reference's numbers whatever the ruleset in force says (final wave, `5f00cbe`). The `WithdrawalLimits` dataclass keeps the reference's defaults only so a golden test can pin the seed ruleset's `[twl_withdrawal]` section to them.
  7. **Plan amendments table, Task 4.** "CI installs oasdiff v1.35.0 (checksum-verified)" is the pinned-sha256 form above; the Dockerfile also needed `COPY config/ config/`, added after Task 7A (`dbe5840`, ruling 20).
