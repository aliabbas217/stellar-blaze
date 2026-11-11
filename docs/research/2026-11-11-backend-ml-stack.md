# Backend + ML stack: chosen, pinned and smoke-tested (2026-11-11)

**Status:** research output for Stellar Blaze (Challenge 07). Every version below was looked up on 2026-11-11 (PyPI JSON API, GitHub API via `gh`, vendor docs). The full pin set was then locked together with `uv lock` (universal lock, Windows + Linux) and synced on Windows 11 / CPython 3.13.15 (and re-run on 3.14.4). "Verified" means I ran it; "UNVERIFIED" means I did not or could not. Nothing was run on Linux.

Scope reminder: `docs/context/challenge-07-plan.md` §8.2 to 8.12 and Part E. Reused from `D:\dev\future-health-challenge` (FHC): the Open-Meteo fetch + hash-cache pattern, the NOAA solar-geometry code, the Liljegren call, the ban-window definitions, and the dependency floor (numpy 2.5.4, structlog 26.1.0, thermofeel 2.3.0, `requires-python >=3.13`). All of those match this pin set.

---

## 1. Where the evidence disagrees with the plan (read this first)

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| 1 | **`httpx` is stagnant; Pydantic took it over as `httpx2`.** Last stable `httpx` 0.28.1 is from 2024-12-06; 1.0 exists only as dev builds (1.0.dev6, 2026-08-31). `httpx2` 2.16.0 (2026-10-21, BSD-3) is "a continuation" stewarded by Pydantic. `openai` 3.49.0, `anthropic` 2.8.0, `pydantic-ai-slim` 2.67.0 now depend on `httpx2`; Starlette 1.10.0's `TestClient` imports `httpx2` and says using `httpx` is deprecated | PyPI metadata; `pydantic/httpx2` README; `starlette/testclient.py` source | Use `httpx2==2.16.0`. Plan §8.11 and the FHC repo's `requests` are both replaced |
| 2 | **`pythermalcomfort.phs` hangs forever on a NaN input and can return uninitialised memory** (open issues #524, #523, filed 2026-11-04 against 4.8.0). **Reproduced on 4.8.1**: `phs(tdb=nan)` and `phs(met=nan)` never returned (killed at 40 s); `height=0` raised `SystemError` | I ran it; issue bodies read | PHS must sit behind a validating wrapper (finite, in-range, positive height/weight/clo/i_mst) and a hard timeout. A safety engine must not hang on a missing forecast hour |
| 3 | **Polars 2.1.0 has an open silent-wrong-result regression** (#30655): `scan_parquet(...).filter(col + k > x)` drops matching rows when one value in a row group overflows the integer arithmetic. **Reproduced**: eager returns `['b','c']`, scan returns `[]` on 2.1.0; correct on 2.0.0. Realistic weather data (200k rows, 10k-row groups) did not trigger it | I ran both versions | Pin `polars==2.0.0` (2026-10-06) until a release past 2.1.0 fixes it. This deliberately is not the latest version |
| 4 | **No Python NIOSH RAL/REL exists, and `pythermalcomfort.work_capacity_niosh` is not it.** That function is the Bröde et al. (2018) work-capacity (productivity) curve. The RAL/REL formulas in plan §8.2 are confirmed in a primary-literature secondary source (see §6.4) | Docstring read; GitHub/PyPI searches | Write the two-line function ourselves, with the test vectors in §6.4 |
| 5 | **No open TWL (thermal work limit) implementation exists.** Searches found only references and a false positive (see §6.5) | §6.5 | Plan non-goal stands. Do not invent a formula |
| 6 | **CRPS computed from only the 5/50/95 quantiles is badly biased.** `scoringrules.crps_quantile` on a perfectly calibrated N(0,1) forecast gives 28.5% too low with 3 levels, 12% too low with 5, +9.4% with 9, +4.8% with 19, +2.4% with 39, +1.0% with 99 | I measured it (§6.2) | Either fit a dense quantile grid (at least 19 levels) or compute CRPS from joint-sampled ensembles (`crps_ensemble`). Report interval score and pinball loss for the 3-level model; do not quote its CRPS |
| 7 | **OpenTelemetry instrumentation lags the stack in two places.** `opentelemetry-instrumentation-httpx` 0.66b2 does not instrument `httpx2` ("only instruments httpx >= 0.18.0, but no installed version was found"). `opentelemetry-instrumentation-sqlalchemy` 0.66b2 refuses SQLAlchemy 2.1 (`< 2.1.0` cap); the fix was merged to contrib `main` on 2026-10-14 (PR #5120) but is not in 0.66b2 | I ran both | Drop the httpx instrumentation package; create spans manually in the adapters. Keep the SQLAlchemy one with `skip_dep_check=True` (produced `connect` and `select` spans on 2.1.8) until the next release |
| 8 | **MLflow resolves cleanly with this stack, but is not worth it.** `mlflow-skinny 3.18.0` adds 18 packages, full `mlflow` adds 48 (flask, gunicorn, ...). MLflow's default backend moved from `./mlruns` to SQLite in 3.7.0 and the file store is documented as "to be deprecated soon" | `uv lock` experiments; MLflow docs | Plain versioned artefacts + model card (see §3). The plan's "MLflow" line in §8.3 and §8.11 changes to "optional" |
| 9 | **Sentry's defaults capture what this project must not.** sentry-sdk 2.74.0: `include_local_variables=True`, `max_request_body_size="medium"` | Introspected `ClientConstructor` defaults | If used at all: opt-in DSN, `include_local_variables=False`, `max_request_body_size="never"`, scrubber, `send_default_pii=False` (accepted by `init`, verified). Sentry SaaS regions were not checked; assume not in-UAE |
| 10 | **Python 3.14 works too** and is the current CPython line. The whole locked set has cp314 wheels for Windows and Linux (only `pywin32` and `uvloop` are platform-specific, as expected), and a runtime smoke on 3.14.4 passed (PHS, Liljegren, CP-SAT, LightGBM, MAPIE CQR, FastAPI, SQLAlchemy) | Universal lock on `>=3.13`; runtime run | Stay on 3.13 for the 9-day window (your global standard; FHC repo; no 3.14 feature needed; zero interpreter risk) and treat 3.14 as a post-challenge bump. `requires-python = ">=3.13,<3.15"` keeps both open |
| 11 | **Docker trap I hit myself:** the local `postgres:18` image was 7 months old (18.3). `postgres:18` today is 18.6 | `SELECT version()` on both | Pin `postgres:18.6` (or a digest) in compose; never trust a local tag |
| 12 | **Local `uv` is 0.12.23; PyPI has 0.13.7 (2026-11-03).** | `uv --version` vs PyPI | Pin the uv version in CI and update the local one deliberately |
| 13 | **Per-voice Azure availability in UAE North is not verifiable from docs.** The regions page confirms UAE North supports Neural TTS, but only a keyed `voices/list` call lists the actual voices | §6.9 | UNVERIFIED; needs the Speech resource key. Run it before generating any audio |

---

## 2. How this was checked

- **Versions, dates, wheels, licences:** PyPI JSON API (`info`, file list, upload times). Wheel check requires a cp313 / abi3 / `py3-none` wheel for `win_amd64`, `manylinux x86_64` and `manylinux aarch64`; confirmed again from the universal `uv.lock` for every native package.
- **Health:** GitHub API: last commit on the default branch, open issues + PRs, archived flag, releases; plus a keyword scan of open issues created since 2026-08-11 (crash, regression, hang, leak, CVE, ...) for 19 core repos, and targeted reads of every hit that touches our usage.
- **Locking:** one scratch `pyproject.toml` with the exact block in §7: `uv lock` resolved 170 packages (production closure 81; the `train` group adds 7 more: `mapie`, `scikit-learn`, `scoringrules`, `joblib`, `threadpoolctl`, `cloudpickle`, `array-api-compat`). `uv sync` installed them and the installed versions were compared with the pins (all equal).
- **Vulnerabilities:** `pip-audit` over all 168 pinned packages: "No known vulnerabilities found" (the first attempt was vacuous because of a bad export filter; redone and confirmed non-empty).
- **Smoke tests I ran:** FastAPI + RFC 9457 + correlation id + OTel + structlog + `mypy --strict` with the pydantic plugin; SQLAlchemy 2.1.8 / asyncpg 0.32.0 / Alembic 1.20.1 against a real `postgres:18.6` container (up, down, re-up, append-only trigger, `lock_timeout`, Squawk lint); MAPIE CQR with LightGBM; PHS and Liljegren; CP-SAT; Polars to Parquet to DuckDB to LightGBM; httpx2 + stamina against the live Open-Meteo previous-runs API with default TLS verification; uvicorn serving the app; pytest 9.2 with asyncio, hypothesis, time-machine, pytest-socket; import-linter contract.
- **Side effects on this host:** scratch files under `C:\Users\LEGION\AppData\Local\Temp\claude\stellar-research\`; the `postgres:18.6` Docker image was pulled (all probe containers were removed).

---

## 3. The stack (one table)

Legend for **py3.13 wheels**: `W·Lx·La` = native cp313/abi3 wheels exist for Windows x64, manylinux x86_64 and manylinux aarch64 (checked in the file list and in the lock). `pure` = universal `py3-none-any` wheel. **Health** = last commit on default branch; open issues + PRs. "n/s" = not scanned.

| Package | Pin | Released | Licence | py3.13 wheels | Health | Why |
|---|---|---|---|---|---|---|
| **API** | | | | | | |
| fastapi | 0.162.4 | 2026-11-10 | MIT | pure | 2026-11-10; 54 | Plan's choice; hard-requires `opentelemetry-api>=1.44.0` |
| starlette (transitive) | 1.10.0 | 2026-10-24 | BSD-3 | pure | 2026-11-06; 33 | `TestClient` now needs `httpx2` |
| pydantic | 2.14.3 | 2026-11-05 | MIT | pure + pydantic-core 2.50.4 `W·Lx·La` | 2026-11-10; 602 | v2 models everywhere; mypy plugin verified |
| pydantic-settings | 2.16.2 | 2026-10-28 | MIT | pure | 2026-11-06; 86 | Typed 12-factor config |
| uvicorn[standard] | 0.54.0 | 2026-09-25 | BSD-3 | pure (+ httptools, watchfiles native; uvloop non-Windows only) | 2026-11-01; 107 | Served the app on Windows with httptools (verified). Built-in multi-worker; no gunicorn needed |
| typer | 0.29.0 | 2026-11-09 | MIT | pure | 2026-11-09; 49 | Job entry points (`ingest`, `train`, `backtest`) |
| **Persistence and data** | | | | | | |
| sqlalchemy[asyncio] | 2.1.8 | 2026-11-04 | MIT | `W·Lx·La` (+ pure) | 2026-11-10; 207 | Async ORM/Core; verified live on PG 18.6 |
| asyncpg | 0.32.0 | 2026-10-06 | Apache-2.0 | `W·Lx·La` | 2026-10-08; 287 | Mature async Postgres driver (verified live); Apache-2.0 (psycopg is LGPL) |
| alembic | 1.20.1 | 2026-10-22 | MIT | pure | 2026-10-27; 117 | `-t async` template works; up/down/up verified |
| polars | **2.0.0** | 2026-10-06 | MIT | `polars-runtime-32` abi3 `W·Lx·La` | 2026-11-10; 2,940 | Frame library. **One behind latest on purpose** (#30655) |
| duckdb | 2.0.0 | 2026-10-21 | MIT | `W·Lx·La` | 2026-11-10; 62 | Ad-hoc SQL over Parquet; read-only use, so the new major's storage format is irrelevant |
| pyarrow | 26.0.1 | 2026-11-03 | Apache-2.0 | `W·Lx·La` | 2026-11-11; 2,249 | Required by `duckdb .pl()`; do not import directly |
| numpy | 2.5.4 | 2026-10-10 | BSD-3 (+ bundled 0BSD, MIT, Zlib, CC0) | `W·Lx·La` | 2026-11-11; 2,253 | Same pin as FHC |
| pandas (transitive) | 3.1.1 | 2026-11-04 | BSD-3 | `W·Lx·La` | 2026-11-11; 1,881 | Hard dependency of ortools; do not use in our code |
| **Physics and optimisation** | | | | | | |
| thermofeel | 2.3.0 | 2026-07-16 | Apache-2.0 | pure (numpy only) | 2026-07-15 (pushed 2026-11-09); 2 open, 0 issues | Liljegren WBGT; `py.typed`; same as FHC |
| pythermalcomfort | 4.8.1 | 2026-11-05 | MIT | pure; needs numba | 2026-11-05; 74 | ISO 7933 PHS (`phs`); see §6.3 for the hang bug |
| numba (transitive) | 0.68.1 | 2026-10-27 | BSD-2 | `W·Lx·La` | 2026-11-11; 1,844 | Pulled by pythermalcomfort (+ llvmlite 0.50.0) |
| ortools | 9.15.6755 | 2026-01-14 | Apache-2.0 | `W·Lx·La` (no sdist) | `main` 2026-11-09 (default branch 2026-09-17); 139 | CP-SAT; verified on 3.13 and 3.14. Pins `protobuf>=6.33.1,<6.34` |
| lightgbm | 4.7.0 | 2026-07-18 | MIT (PyPI licence field is empty; GitHub says MIT) | `py3-none` platform wheels `W·Lx·La` | 2026-11-10; 536 | Quantile objective; serving needs only `Booster` + numpy |
| **Outbound HTTP** | | | | | | |
| httpx2 | 2.16.0 | 2026-10-21 | BSD-3 | pure | 2026-11-07; 111 | See finding 1. Live call verified |
| stamina | 26.1.0 | 2026-04-13 | MIT | pure | 2026-11-02; 2 | Sane retry defaults (jitter, exponential backoff, caps) over tenacity 9.2.1; `set_testing` for tests |
| **Observability** | | | | | | |
| structlog | 26.1.0 | 2026-06-06 | MIT OR Apache-2.0 | pure | 2026-11-02; 46 | Standard; same as FHC |
| asgi-correlation-id | 5.0.1 | 2026-06-09 | MIT | pure | 2026-06-09; 4 | Request-ID middleware; `py.typed`; verified |
| opentelemetry-api / -sdk / -exporter-otlp-proto-http | 1.45.2 | 2026-10-29 | Apache-2.0 | pure | 2026-11-10; 439 | HTTP/protobuf exporter avoids grpcio. 17 spans for 5 requests verified |
| opentelemetry-instrumentation-fastapi / -sqlalchemy | 0.66b2 | 2026-10-29 | Apache-2.0 | pure | 2026-11-10; 722 | Must move in lockstep with 1.45.x. SQLAlchemy one needs `skip_dep_check=True` |
| **Training group (`train`; not in the API image)** | | | | | | |
| scikit-learn | 1.9.1 | 2026-09-10 | BSD-3 | `W·Lx·La` | 2026-11-11; 2,172 | Required by MAPIE and `LGBMRegressor` |
| scipy | 1.18.1 | 2026-08-21 | BSD-3 | `W·Lx·La` | 2026-11-10; 1,900 | Also pulled by lightgbm and pythermalcomfort |
| mapie | 1.6.0 | 2026-10-19 | BSD-3 | pure | 2026-11-10; 31 | CQR, time-series/ACI, exchangeability tests |
| scoringrules | 0.12.0 | 2026-11-08 | Apache-2.0 | pure | 2026-11-08; 25 | CRPS/interval/pinball; the maintained option |
| **Optional groups (off by default)** | | | | | | |
| azure-cognitiveservices-speech (`tts`) | 1.53.0 | 2026-10-21 | Proprietary (Microsoft terms; closed source) | `py3-none` win_amd64, manylinux1 x86_64, manylinux2014 aarch64 (bundled native libs) | samples repo 2026-11-10; 49 | Build-time clip rendering. Imports on 3.13 and 3.14 |
| openai (`llm`) | 3.49.0 | 2026-11-10 | Apache-2.0 | pure | 2026-11-10; 91 | Client for self-hosted OpenAI-compatible endpoints (§6.10) |
| apscheduler (`scheduler`) | 3.11.3 | 2026-06-28 | MIT | pure | 2026-10-26; 90 | Only for a single-replica compose scheduler; 4.x is pre-release |
| sentry-sdk (`sentry`) | 2.74.0 | 2026-11-05 | MIT | pure | 2026-11-10; 395 | Opt-in; see finding 9 |
| torch (`drn`) | 2.15.0 (CPU index: `2.15.0+cpu`) | 2026-10-28 | Composite (BSD-3 core + Apache-2.0, MIT, ...) | CPU index: win_amd64, manylinux_2_28 x86_64 + aarch64 | 2026-11-11; 18,159 | Small DRN comparator only; CPU wheel avoids the multi-GB CUDA stack on Linux |
| **Dev tooling (`dev`)** | | | | | | |
| pytest | 9.2.0 | 2026-10-27 | MIT | pure | 2026-11-10; 937 | Markers `unit/integration/e2e/regression/slow` |
| pytest-asyncio | 1.4.1.post1 | 2026-11-01 | Apache-2.0 | pure | 2026-11-06; 49 | Strict mode |
| pytest-cov | 7.1.0 | 2026-03-21 | MIT | pure | 2026-10-18; 172 | Coverage |
| pytest-socket | 0.8.1 | 2026-08-19 | MIT | pure | 2026-11-10; 12 | Unit tests cannot reach the network; use `--allow-hosts` (see §6.11) |
| hypothesis | 6.170.15 | 2026-11-06 | MPL-2.0 | `W·Lx·La` | 2026-11-06; 51 | Plan §8.4 requires property-based policy tests |
| time-machine | 3.6.0 | 2026-10-25 | MIT | `W·Lx·La` | 2026-11-04; 11 | Freeze shift/ban clocks |
| testcontainers[postgres] | 4.15.0 | 2026-07-24 | Apache-2.0 | pure | 2026-10-07; 200 | Integration tier. Resolved and installed, **not run** (my DB tests used `docker run`) |
| pvlib | 0.16.1 | 2026-09-26 | BSD-3 | pure | 2026-11-03; 263 | Oracle for the solar-geometry test only (drags in h5py, requests) |
| mypy | 2.4.1 | 2026-10-28 | MIT | pure | 2026-11-10; 3,248 | `--strict` + `pydantic.mypy` verified |
| ruff | 0.17.4 | 2026-11-05 | MIT | `W·Lx·La` | 2026-11-11; 2,314 | Lint + format |
| pre-commit | 4.7.0 | 2026-10-12 | MIT | pure | 2026-11-09; 25 | Hooks (revs in §6.11) |
| commitizen | 4.19.3 | 2026-10-24 | MIT | pure | 2026-10-25; 172 | Conventional Commits |
| pip-audit | 2.10.1 | 2026-06-10 | Apache-2.0 | pure | 2026-10-30; 64 | Run on `uv export` in CI |
| deptry | 0.25.1 | 2026-03-18 | MIT | `W·Lx·La` | 2026-11-09; 82 | Unused/missing dependency check |
| import-linter | 2.16 | 2026-11-06 | BSD | pure | 2026-11-10; 74 | Forbidden-import contract caught `employer -> health` (verified) |
| squawk-cli | 2.71.0 (GitHub: 2.72.0) | 2026-10-29 | Apache-2.0 / MIT | `W·Lx·La` | 2026-11-11; 48 | Migration lint (plan rule 15); PyPI lags GitHub by one release |
| asyncpg-stubs | 0.32.0 | 2026-10-06 | BSD-3 | pure | 2026-10-06; 6 | Version tracks asyncpg |
| pandas-stubs / scipy-stubs | 3.1.0.261029 / 1.18.1.1 | 2026-10-29 / 2026-09-20 | BSD-3 | pure | 2026-11-10; 78 / 2026-11-09; 12 | Strict typing at the library boundary |

Pinning policy: direct dependencies use `==`; `uv.lock` pins and hashes everything else. Let Renovate/Dependabot open the bumps; CI runs `uv lock --check`, `pip-audit` and the tier-1 tests on every bump.

### Component answers (short)

- **API:** FastAPI + Pydantic v2 + pydantic-settings on **uvicorn**. Granian 2.8.7 (BSD-3, active) is parked: at this traffic there is no measured reason to leave the default and its docs/ecosystem.
- **Error model:** hand-rolled RFC 9457 (§6.8). The four library options are single-org, 0.x, tiny (5 to 37 stars) and none fits our typed-extension and request-id needs better than 40 lines we own.
- **Persistence:** Postgres 18.6 + SQLAlchemy 2.1 async + asyncpg + Alembic, for app state only (consent ledger, audit log, sites, crews, plan versions). The case for Postgres over SQLite is governance evidence: the "employer role has no route" and "audit is append-only" claims become database-level facts (trigger demo verified; grants/roles are plain SQL). Note: SQLAlchemy has no row-level-security DDL yet (feature request #13517 is open), so any RLS goes into raw-SQL migrations.
- **TimescaleDB / PostGIS: no.** Volume is about 0.47 M rows per variable set per model (10 stations x 3 summers x 2,232 h x 7 lead days; about 1.4 M across IFS/AIFS/GFS), which Parquet + DuckDB handle in-process. Station matching is nearest-of-10 points. TimescaleDB 2.31.0 is Apache-2.0 only outside the `tsl/` directory, whose code is under the Timescale License (per its LICENSE file; which features that covers was not re-verified today); PostGIS is GPL-2.0. Revisit if hot time-series exceeds roughly 50 M rows or sites need polygons.
- **Analytics / training data:** Parquet (zstd) + **Polars 2.0.0** for transforms, **DuckDB 2.0.0** for ad-hoc SQL. Verified: Polars to Parquet to DuckDB `.pl()` to LightGBM (a Polars DataFrame is accepted by `LGBMRegressor.fit` directly).
- **Scheduling:** no scheduler library in the core. Jobs are idempotent Typer commands run by the platform scheduler (Kubernetes CronJob or equivalent), with `pg_try_advisory_lock` against overlap and a run record in the audit table. Reasons: two data pulls a day and a retrain need no worker tier; an in-process scheduler inside a multi-replica API double-fires; `arq` 0.28.0 is "in maintenance only mode" and needs Redis we do not have; APScheduler 4.x is pre-release ("do NOT use this release in production"). For a Windows/compose demo without cron, the optional `scheduler` group (APScheduler **3.11.3**, stable) runs in one dedicated single-replica container. Queues (procrastinate 3.11.0, taskiq 0.13.0, pgqueuer 2.0.0) solve a problem we do not have yet; dramatiq 2.2.1 is LGPL-3.0.
- **Experiment tracking:** plain versioned artefacts. Per run: LightGBM boosters via `booster_.save_model()` text (round trip verified; no pickle), conformal offsets as JSON, `params.json`, a metrics Parquet, a data manifest (SHA-256 of the input Parquet files), git SHA, `uv.lock` hash, and a `model_card.md`. This is what the judges can read; it needs no server.
- **DRN comparator:** keep behind the `drn` group (torch CPU). Do it after the pipeline is done. Torch-free alternative if time is short: NGBoost 0.6.0 (Apache-2.0, active), though it is not the DRN of the cited literature.

---

## 4. Rejected or parked alternatives

| Candidate | Version looked up | Decision | Reason (evidence) |
|---|---|---|---|
| httpx | 0.28.1 (2024-12-06) | Rejected | Stagnant; Pydantic continues it as httpx2; Starlette deprecates it for tests |
| respx / pytest-httpx | 0.23.1 / 0.36.2 | Rejected | Depend on `httpx` only; use `httpx2.MockTransport` (verified) |
| requests, `retry-requests` | 2.0.0 (2023-05-28) | Rejected | `retry-requests` is GPL-3.0-or-later per its PyPI classifier; do not take it as a dependency. `requests` is replaced by httpx2 |
| openmeteo-requests | 1.7.5 | Rejected | Second HTTP stack (niquests + FlatBuffers SDK); our volume is small and JSON is fine |
| hishel | 2.0.0 (2026-11-05) | Parked | A six-day-old major; our cache is the raw "bronze" Parquet/JSON store |
| aiocache | 0.12.3 (2024-09-25) | Rejected | Stale |
| cachetools | 8.0.0 | Parked | Use only if an in-process TTL cache is needed |
| tenacity (direct) | 9.2.1 | Not needed | Pulled in by stamina |
| fastapi-problem, rfc9457, starlette-problem, fastapi-problem-details, fastapi-error-map | 0.12.1, 0.4.1, 0.13.5, 0.1.5, 1.0.0 | Rejected | Tiny single-org projects; `fastapi-rfc7807` is GPL-3.0 and last released 2021 |
| SQLite as app DB | n/a | Rejected | No roles or grants, so the governance claims cannot be demonstrated at database level |
| psycopg | 3.3.8 | Fallback | LGPL-3.0; asyncpg is Apache-2.0 |
| TimescaleDB 2.31.0, PostGIS | n/a | Parked | See §3 |
| granian | 2.8.7 | Parked | No measured need |
| gunicorn + uvicorn-worker | 27.0.0 / 0.4.0 | Rejected | uvicorn has its own multiprocess supervisor; uvicorn-worker last released 2025-09 |
| APScheduler 4.x | 4.0.0a6 (2025-04-27) | Rejected | README: pre-release, do not use in production |
| arq | 0.28.0 (2026-04-16) | Rejected | "In maintenance only mode" (README) |
| procrastinate / taskiq / pgqueuer / dramatiq | 3.11.0 / 0.13.0 / 2.0.0 / 2.2.1 | Parked | No queue requirement yet |
| properscoring | 0.1 (2015-11-12) | Rejected | Repo archived 2023-03-09; last release 2015 |
| crepes | 0.9.1 | Parked | MAPIE plus our own CQR covers the need |
| xgboost 3.4.1, catboost 1.2.10 | n/a | Not needed | No data-derived reason to leave LightGBM; MAPIE documents LightGBM support |
| mlflow / mlflow-skinny | 3.18.0 | Parked | Resolves fine (verified), but +48 / +18 packages and a server for under 100 runs; file store is on its way out |
| skops 0.16.0, optuna 5.0.0, pandera 0.36.0 | n/a | Parked | Not needed for the must-have scope |
| heatstress | 0.1.1 (2026-11-09) | Rejected | Two days old; thermofeel is ECMWF's and already used |
| pvlib at runtime | 0.16.1 | Rejected for runtime | Drags in pandas, h5py, requests; kept as a dev-only oracle |
| earthkit-meteo | 1.3.0 | Rejected for solar geometry | Differs from pvlib by 2e-3 in cos(zenith) (the FHC code differs by 5e-5) and takes one scalar date per call |
| logfire | 5.5.0 | Rejected | SaaS-first; we want a vendor-neutral OTLP exporter |
| litellm | 1.109.0 | Rejected | See §6.10 (supply-chain incident, heavy tree) |
| langchain, instructor | 1.4.10, 1.17.0 | Rejected | No need; adds weight |
| pyarrow-stubs | 20.0.0.20260819 | Rejected | Targets pyarrow 20; we are on 26 |
| ECMWF open-data path: ecmwf-opendata, eccodes 2.50.0, earthkit-data 1.3.1, xarray 2026.9.0 | `ecmwf-opendata` PyPI 0.3.35 (GitHub shows 0.3.36 released 2026-11-03: PyPI lags) | Parked | Production forecast path; add when the open-data pull is built |
| earthengine-api | 1.7.52 | Parked | Non-commercial terms (plan E2) |

---

## 5. Parking-lot entries to add (`docs/parking-lot.md`; what / why parked / when to revisit)

1. **granian 2.8.7**: parked because uvicorn is sufficient. Revisit if p99 latency under load testing exceeds the target.
2. **Queue (procrastinate or pgqueuer)**: parked because jobs are cron-driven. Revisit when a user-triggered long task (for example an on-demand re-plan) appears.
3. **TimescaleDB / PostGIS**: parked. Revisit above about 50 M hot rows or with site polygons.
4. **MLflow (skinny + SQLite)**: parked. Revisit if more than one person trains models.
5. **hishel / cachetools**: parked. Revisit if the adapters show repeated identical upstream calls.
6. **pandera**: parked. Revisit when a second data producer feeds the Parquet store.
7. **polars 2.0.0 pin**: revisit when #30655 is fixed (look for polars > 2.1.0).
8. **OTel**: remove `skip_dep_check=True` when the contrib release after 0.66b2 ships; replace manual httpx2 spans if `opentelemetry-instrumentation-httpx2` becomes real (today a 0.0.0 placeholder for py>=3.14).
9. **pythermalcomfort wrapper**: remove the NaN/timeout guard only after #524 and #523 are closed and re-verified.
10. **ortools**: re-test and consider 9.14.6206 if the memory-safety report #5297 is confirmed.
11. **Python 3.14**: bump after the challenge (stack verified on 3.14.4).

---

## 6. API notes and gotchas

### 6.1 MAPIE 1.6.0 (conformalized quantile regression)

Verified by introspection and by running it with LightGBM 4.7.0 (6,000 synthetic rows, 90% level).

- **Public names in 1.x** (`mapie.regression`): `SplitConformalRegressor`, `CrossConformalRegressor`, `JackknifeAfterBootstrapRegressor`, `ConformalizedQuantileRegressor`, `CrossConformalizedQuantileRegressor`, `TimeSeriesRegressor`. The 0.x names `MapieRegressor`, `MapieQuantileRegressor`, `MapieTimeSeriesRegressor` are gone from the public namespace (only private `_Mapie*` remain). `alpha=` is now `confidence_level=` (a float, or an iterable on the Split/Cross/Jackknife classes).
- **Workflow:** `fit(X_train, y_train)` then `conformalize(X_calib, y_calib)` then `predict_interval(X)` returning `(point, intervals)`. `intervals` has shape `(n, 2, n_levels)`: `iv[:, 0, 0]` is lower, `iv[:, 1, 0]` upper. `predict(X)` returns the point forecast only.
- **CQR with LightGBM, two verified ways** (identical output; coverage 0.911 at 0.90):
  1. `ConformalizedQuantileRegressor(estimator=LGBMRegressor(objective="quantile", alpha=0.5, ...), confidence_level=0.9)`: MAPIE fits the three quantile models itself.
  2. `prefit=True` with a **list of three fitted regressors in the order `[lower, upper, median]`**, trained at `(1-cl)/2`, `(1+cl)/2` and `0.5`. A `[lower, median, upper]` order is wrong.
- **Inconsistent defaults:** `SplitConformalRegressor(prefit=True)` but `ConformalizedQuantileRegressor(prefit=False)`. Always pass `prefit` explicitly.
- **`predict_interval(..., symmetric_correction=False)` is the default, which means asymmetric correction.** My 12-line symmetric implementation (sort the lower/upper predictions, score `E = max(lo - y, y - hi)`, offset at level `ceil((n+1)(1-a))/n`, interval `[lo - q, hi + q]`) matches MAPIE with `symmetric_correction=True` to 5e-5. The asymmetric mode matched only to about 1e-2 (not replicated exactly). So serving can apply a persisted offset without importing MAPIE, with MAPIE as the test oracle.
- **Crossing quantiles are silently re-sorted** and logged as `INFO:root:The predictions are ill-sorted.` on the **root logger**. Independent LightGBM quantile models do cross; route or filter that logger.
- **Do not use `mapie.utils.train_conformalize_test_split` on time data:** it splits randomly, and open issue #1018 reports wrong sizes for float fractions like 0.8/0.1/0.1. Cut time-blocked calibration windows by hand.
- **Per-stratum calibration (lead x hour band):** one prefit CQR per stratum sharing the same three boosters; cheap.
- **`TimeSeriesRegressor`** (`method="enbpi"` or `"aci"`; ACI is driven by `update(X, y, gamma=...)`) handles a **single series**; `confidence_level` in `update` is deprecated. For a station panel write the ~30-line ACI loop (Gibbs and Candes 2021) over the CQR scores per stratum.
- **`mapie.exchangeability_testing`** exists in 1.6.0 (`OnlineExchangeabilityTest`, `FixedDatasetExchangeabilityTest`, `PermutationTest`, martingale tests): usable to quantify the exchangeability violation that plan §8.3 worries about. Not exercised. `ConditionalSplitConformalRegressor` (Gibbs et al. conditional coverage) imports without cvxpy; not run end to end.
- The estimator must follow the scikit-learn API (`LGBMRegressor`), not a raw `Booster` (open issue #403). No `py.typed`: mypy override. Do not pickle MAPIE objects across versions; persist boosters and offsets.

### 6.2 Scores (scoringrules 0.12.0; needs Python >= 3.12, numpy >= 2, scipy >= 1.14)

- API: `crps_quantile(obs, fct, alpha)`, `quantile_score(obs, fct, alpha)`, `interval_score(obs, lower, upper, alpha)` (here `alpha` is the miscoverage, 0.1 for a 90% interval), `crps_ensemble(obs, fct)`, `crps_normal(obs, mu, sigma)`.
- `crps_quantile` bias on a calibrated N(0,1) forecast against 400,000 N(0,1) observations (exact mean CRPS 0.5634; theory 1/sqrt(pi) = 0.5642):

| Quantile levels | 3 (0.05/0.5/0.95) | 5 | 9 | 19 | 39 | 99 |
|---|---|---|---|---|---|---|
| Bias vs exact | -28.5% | -12.0% | +9.4% | +4.8% | +2.4% | +1.0% |

  CRPS values are only comparable between models scored on the same grid, and absolute values need at least 19 levels. For the 3-level model report pinball loss at 0.05/0.5/0.95, interval score and coverage instead.

### 6.3 pythermalcomfort 4.8.1: PHS (ISO 7933)

- **Function:** `from pythermalcomfort.models import phs`, signature `phs(tdb, tr, v, rh, met, clo, posture, wme=0, round_output=True, model="7933-2023", **kwargs) -> PHS`. Default model is **ISO 7933:2023**; `"7933-2004"` is the alternative. Returned dataclass fields: `t_re, t_sk, t_cr, t_cr_eq, t_sk_t_cr_wg, d_lim_loss_50, d_lim_loss_95, d_lim_t_re, sweat_loss_g, sweat_rate_watt, evap_load_wm2_min`. The `d_lim_*` fields are the duration limits in minutes (water loss for the average and for 95% of workers; rectal temperature).
- **Units trap:** `met` is in **met units** (1 met = 58.2 W/m2); NIOSH RAL/REL (below) use **whole-body watts**. Convert with one body-surface-area definition used everywhere. Posture is `"sitting" | "standing" | "crouching"`.
- **Applicability window** (`limit_inputs=True` by default, returns **NaN** outside): 15 < tdb < 50 C, 0 < (tr - tdb) < 60 C, 0 < v < 3 m/s, 0.1 < clo < 1; metabolic rate 0.96 to 4.3 met (56 to 250 W/m2) in the 2023 standard (1.7 to 7.5 in 2004). Heavy work above 250 W/m2 and heavy PPE therefore return NaN. A random sample drawn inside the nominal ranges (tdb 30 to 48, tr - tdb 0 to 15, v 0.2 to 2, met 1.5 to 4.2, clo 0.6, rh 20 to 70) still returned **19.6% NaN**; cause not investigated, so test the NaN mask before trusting a result.
- **Hang and garbage bugs (open #524, #523), reproduced on 4.8.1:** NaN in `tdb` or `met` never returns (a single NaN in an array call stalls every row). `limit_inputs` does not help (the mask is applied after the kernel). A zero divisor (`i_mst=0`, `height=0`, `clo=0`) returns uninitialised memory or a `SystemError`. **Mitigation:** validate before calling (all finite, in window, `height`, `weight`, `clo`, `i_mst` > 0); call from a bounded worker process with a hard timeout (a numba kernel cannot be interrupted from a thread); precompute PHS lookup tables offline per worker class rather than in the request path; reject outputs outside, say, 36 to 42 C.
- **Cold start:** the first call in a fresh process took 2.2 to 4.3 s (numba compile, `cache=True`); a 2,000-row array call then took 2.2 s in the same process (it compiles the parallel array kernel). Numba writes its cache next to the module, which is read-only or non-writable in many containers: set `NUMBA_CACHE_DIR` to a writable path and warm it in the image build or the lifespan hook.
- **Other functions in the package** (not RAL/REL): `wbgt(twb, tg, ...)` is the ISO 7243 formula from **measured** natural wet-bulb and globe temperatures, not a weather-model Liljegren; `work_capacity_niosh/iso/dunne/hothaps` are Bröde et al. productivity-loss functions; `utci`, `esi`, `heat_index_*`, `two_nodes_gagge`, `jos3` exist.
- No `py.typed`: mypy override plus a typed facade.

### 6.4 NIOSH RAL / REL (our own code)

- Formulas confirmed in Bernard, Flach and Ashley (2023), *Ann Work Expo Health* 67:345, eqs (1) and (2), with WBGT in C and M in watts: acclimatised limit (REL) = 56.7 - 11.5 log10(M); unacclimatised limit (RAL) = 59.9 - 14.1 log10(M). They also note that NIOSH 2016 contains "unintentional discrepancies between the equations ... and the figures" and take the equations as intended; state that in the model card.
- Test vectors (computed from the formulas): M = 180 W gives REL 30.76 and RAL 28.10; M = 300 W gives 28.21 and 24.97; M = 415 W gives 26.59 and 22.99 (all C-WBGT).
- Clothing adjustment (plan §8.2, "to be sourced"): the same paper uses clothing adjustment values of -1.6 C (semi-nude), -1.0 C (semi-clothed) and +11 C (vapour-barrier coveralls) attributing them to ACGIH 2022 and ISO 7243:2017. Treat that as a **lead**, not a source: obtain the primary table before use.
- The FHC script already evaluates REL at 300 W and 180 W; reuse that arithmetic as the base of the tested function.

### 6.5 TWL: no open implementation

Checked on 2026-11-11: GitHub code search (`thermal_work_limit`, `calc_twl`, `ThermalWorkLimit`, ...), GitHub repo search, PyPI names (`twl`, `thermal-work-limit`, `thermalworklimit`, `pytwl` all 404), two web searches. Findings: Wikipedia gives only the definition (maximum sustainable metabolic rate in W/m2 with core temperature up to 38.2 C and sweat rate up to 1.2 kg/h; inputs dry-bulb, wet-bulb, globe, wind, pressure; valid 60 to 380 W/m2) and no equations; a competitor's public evidence pack (`DrAhmed7887/hack-future-health`, not checked against the PDF) says the ADOSH guideline gives no TWL equation and points to an online calculator whose link is blank; a GitHub hit named `TWLcore.py` is the Hong Kong MTR Tsuen Wan Line (false positive); Kestrel meters output a TWL column (their log headers appear in `KestrelReader.py`), which is device firmware. The algorithm is in Brake and Bates (2002), DOI 10.1080/104732202753438261, which I could not verify as openly accessible. Conclusion: the plan's non-goal "no invented TWL formula" stands.

### 6.6 thermofeel 2.3.0 (Liljegren WBGT)

- **Call:** `from thermofeel import calculate_wbgt_liljegren` (also at `thermofeel.thermofeel.calculate_wbgt_liljegren`, which the FHC script uses). Signature `(t2_k, rh, pressure, va, ssrd, fdir, cossza, wind_scaling="liljegren")`, returns **Kelvin**. Units: 2 m temperature K, rh %, pressure **hPa**, 10 m wind m/s, `ssrd` instantaneous W/m2, `fdir` 0 to 1, `cossza` cosine of solar zenith. `wind_scaling="brode"` is the alternative profile.
- **Built-in KNMI guards:** 10 m wind floored at 0.62 m/s; `fdir` clamped to [0, 0.9] and zeroed when the sun is at or below 89.5 degrees zenith. Returns **NaN where the iteration does not converge**. Only dependency: numpy. `py.typed`. No open issues.
- **Throughput:** physically coherent inputs (T 30 to 46 C, RH 20 to 75, wind 0.5 to 6, `ssrd` = `cossza` x 750 to 1000): 100,000 points in 0.78 s, no NaN, WBGT minus air temperature at most 5.1 C. **Incoherent** inputs (up to 1000 W/m2 with `cossza` near 0): about 5,300 points/s, 0.04% NaN and outputs up to 120 C. Garbage in is slow and non-physical, so assert `ssrd` against `cossza` and bound WBGT - T before using a value.
- **Time convention:** Open-Meteo radiation is the mean over the **preceding** hour; thermofeel wants instantaneous values. The FHC script handles this (zenith at the mid-point or the mean over the preceding hour). **Reuse FHC's `cos_zenith` and `mean_cos_zenith_prev_hour` unchanged** as `physics/solar.py`. Cross-check I ran over one Abu Dhabi day: FHC vs pvlib 0.16.1 max |delta cos z| = 5.0e-5; earthkit-meteo 1.3.0 vs pvlib 2.2e-3.
- Do **not** use `calculate_wbgt_simple` (it takes only temperature and humidity). In my spot checks it differed from Liljegren by +2.0, -0.8 and +7.6 C (38.17 vs 36.15, 38.17 vs 38.96, 38.41 vs 30.80), so it is not a stable approximation in either direction (plan §8.2 reports about +5 C in the FHC test).

### 6.7 OR-Tools CP-SAT 9.15.6755

- **API verified on 3.13/Windows and 3.14/Windows:** `from ortools.sat.python import cp_model`; `cp_model.CpModel()`, `new_bool_var`, `new_int_var`, `add_exactly_one`, `add_at_most_one`, `add(expr)`, `minimize`/`maximize`; `solver = cp_model.CpSolver()`; `solver.parameters.max_time_in_seconds`, `num_workers`, `random_seed`, `interleave_search`, `max_deterministic_time`; `st = solver.solve(model)`; `solver.status_name(st)`, `solver.value(v)`, `solver.objective_value`, `solver.best_objective_bound`. Status constants are `cp_model.OPTIMAL`, `FEASIBLE`, `INFEASIBLE`.
- **Plans are not unique:** on a toy 6-task x 10-slot model both `num_workers=1` and `8` reached OPTIMAL with objective 118 but **different assignments**. For reproducible plans use `num_workers=1`, or add a lexicographic tie-breaker to the objective; for multi-worker determinism use `interleave_search=True` with `max_deterministic_time` (I did not test cross-run reproducibility).
- **Typing:** `mypy --strict` passes on the `cp_model` import.
- **Open issues:** #5297 (memory-safety regression in 9.15.6755 on a roughly 16,000-variable model through `repr()`/`str()`/`.Proto()`): I could **not** reproduce it with 16,000 `IntVar`s plus repr, str and `proto` on 3.13/Windows, and maintainers have not confirmed it; 9.14.6206 installs on 3.13 as a fallback. Never f-string a variable; use names. #5474: Windows 11 **Smart App Control** blocks the unsigned `cp_model_helper` `.pyd`; SAC is **off** on this host (registry state 0), but a judge's Windows 11 laptop with SAC on will fail, so demo from containers. #5547: protobuf pin inconsistency: `ortools` pins `protobuf>=6.33.1,<6.34`, which constrains the whole environment (lock resolved 6.33.6; OTLP/HTTP exporter compatible).
- `pandas>=2.0.0` is a hard dependency of ortools, so pandas ships in the API image even though our code is Polars-first.

### 6.8 RFC 9457 problem details (hand-rolled; verified with FastAPI 0.162.4, Starlette TestClient on httpx2)

RFC 9457 (Problem Details for HTTP APIs, 2023, obsoletes RFC 7807): members `type` (default `about:blank`), `title`, `status`, `detail`, `instance`; media type `application/problem+json`; extension members allowed. Verified output for validation (422), a domain error (403 with an extension member), 404 and an unhandled 500 (no internal detail leaked), all with the correct media type and a request id:

```python
PROBLEM_JSON = "application/problem+json"

class Problem(BaseModel):
    model_config = ConfigDict(extra="allow")   # extension members
    type: str = "about:blank"
    title: str
    status: int = Field(ge=100, le=599)
    detail: str | None = None
    instance: str | None = None

class DomainProblem(Exception):
    def __init__(self, *, type_: str, title: str, status: int, detail: str | None = None, **ext: Any) -> None:
        super().__init__(title)
        self.problem = Problem(type=type_, title=title, status=status, detail=detail, **ext)

def _respond(request: Request, p: Problem) -> JSONResponse:
    p.instance = p.instance or request.url.path
    body = p.model_dump(mode="json", exclude_none=True)
    body["request_id"] = correlation_id.get()
    return JSONResponse(body, status_code=p.status, media_type=PROBLEM_JSON)

app.add_middleware(CorrelationIdMiddleware, header_name="X-Request-ID")
app.add_exception_handler(DomainProblem, on_domain)
app.add_exception_handler(RequestValidationError, on_validation)   # 422 -> problem+json with "errors"
app.add_exception_handler(StarletteHTTPException, on_http)          # 404, 405, ...
app.add_exception_handler(Exception, on_unhandled)                  # 500, log with structlog, no leak
```

Gotchas: `mypy --strict` with `pydantic.mypy` (`init_forbid_extra = true`) rejects extension kwargs on `Problem(...)`, so use `# type: ignore[call-arg]` at that one call or build the dict first; handlers must be typed `Exception` and narrowed with `assert isinstance`; the catch-all handler runs in `ServerErrorMiddleware`, so log there. Declare the problem schema in each route's `responses={...}` so OpenAPI shows it.

### 6.9 Azure Speech (TTS pre-rendering)

- **Voices confirmed in the current docs** (language-support page, 2026-11-11), all **Standard** `...Neural`: `ar-AE-FatimaNeural` (F), `ar-AE-HamdanNeural` (M); `hi-IN-SwaraNeural` (F, styles cheerful/empathetic/newscast), `hi-IN-MadhurNeural` (M), plus several more; `ur-PK-UzmaNeural` (F), `ur-PK-AsadNeural` (M); `bn-BD-NabanitaNeural` (F), `bn-BD-PradeepNeural` (M); `ne-NP-HemkalaNeural` (F), `ne-NP-SagarNeural` (M); English has many (en-IN and en-US lists).
- **bn-BD and ne-NP:** the docs footnote says phonemes, custom lexicon and visemes are **not supported**. A mispronounced word cannot be fixed with `<phoneme>`; it has to be rewritten in the text, and native-speaker review of every clip is the only quality gate.
- **UAE North (`uaenorth`)**, regions page updated 2026-10-28: Neural text to speech yes, Batch synthesis yes, Custom voice yes; HD voices, MAI voices and preview voices **no**. The page states Speech "stores and processes speech data in the region where you create your resource". **UNVERIFIED:** whether each of the ten voices above is actually served from `uaenorth`. The docs only point to `GET https://uaenorth.tts.speech.microsoft.com/cognitiveservices/voices/list` (or the SDK's `get_voices_async`), which needs a key; run it before rendering.
- **SDK 1.53.0:** `py3-none` wheels bundling native libraries (2.4 to 3.3 MB); `import azure.cognitiveservices.speech`, `SpeechConfig(subscription=..., region="uaenorth")` and `SpeechSynthesizer(speech_config=cfg, audio_config=None)` all worked on 3.13.15 and 3.14.4 Windows without any network call. Linux prerequisites per docs: Ubuntu 20.04/22.04/24.04 or Debian 11/12, libssl 1.x/3.x, `ca-certificates`, `libasound2`. Debian 13 (the base of the current `python:3.13-slim`) is not listed, so keep the SDK out of the API image (it is in the `tts` group; nothing was run on Linux).
- **REST fallback (documented):** `POST https://uaenorth.tts.speech.microsoft.com/cognitiveservices/v1` with `Ocp-Apim-Subscription-Key` (or `Authorization: Bearer`), `Content-Type: application/ssml+xml`, `X-Microsoft-OutputFormat` (for example `ogg-24khz-16bit-mono-opus` or `audio-24khz-48kbitrate-mono-mp3`) and `User-Agent`; audio over 10 minutes is truncated. Microsoft's own tip says to use the SDK unless you cannot, so the SDK is the default and REST stays a no-native-dependency fallback.
- Output format for offline clips: Opus (small) with an MP3 fallback for old browsers.

### 6.10 LLM client options (report only; keep behind an adapter)

| Option | Version | Released | Licence | Health and notes |
|---|---|---|---|---|
| **openai** (client for any OpenAI-compatible endpoint via `base_url`: vLLM, Ollama, llama.cpp) | 3.49.0 | 2026-11-10 | Apache-2.0 | Active; depends on httpx2. Suits plan §8.6 (self-hosted Gemma 4 / Qwen3-14B). **Default pick** behind our own `LlmPort` Protocol |
| pydantic-ai-slim | 2.67.0 | 2026-11-11 | MIT | Active (1,965 open issues + PRs). `TestModel`, `FunctionModel` (offline deterministic tests) and `OpenAIChatModel` import fine. Use only if the tool-calling copilot is actually built |
| any-llm-sdk (Mozilla.ai) | 1.50.0 | 2026-11-10 | Apache-2.0 | Thin multi-provider gateway; alternative to our own port |
| anthropic | 2.8.0 | 2026-11-10 | Apache-2.0 | Plan notes Claude is not available in-UAE; fine for non-production comparison |
| **litellm** | 1.109.0 | 2026-11-11 | MIT core (plus an enterprise directory; GitHub reports NOASSERTION) | **Reject.** PyPI versions 1.82.7 and 1.82.8 were malicious in March 2026 (credential stealer; about 3 hours before quarantine; 1.82.6 was the last safe; NetSPI, HiddenLayer, SecurityAffairs). Today's release is 5,100 open issues + PRs, a very wide dependency tree (boto3, tiktoken, tokenizers, huggingface-hub, aiohttp, jinja2, ...) and pins `httpx<1.0`. Wrong risk profile for a health-data project |
| instructor / langchain | 1.17.0 / 1.4.10 | 2026-09-09 / 2026-11-10 | MIT | Not needed |

### 6.11 Other gotchas found while testing

- **LightGBM quantile:** one `LGBMRegressor(objective="quantile", alpha=q)` per quantile; models can cross (MAPIE sorts; do the same at serving). Serve from `lgb.Booster(model_file=...)` (text round trip verified). Open issue #7479: quantile loss is 6 to 8 times slower with sample weights. CPU is enough; the CUDA issues do not apply.
- **Polars and pyarrow typing:** keep `pyarrow` out of application imports (stubs lag at pyarrow 20 vs 26); use Polars/DuckDB APIs.
- **SQLAlchemy 2.1 + Alembic + Postgres (verified on 18.6):** `create_async_engine(url, connect_args={"server_settings": {"lock_timeout": "3000"}})`; `alembic init -t async`; Squawk lints `alembic upgrade head --sql` (it flagged the missing `statement_timeout`/`lock_timeout`, so put both in the migration template); `alembic check` needs `target_metadata`. Postgres 18.6 is current; Postgres 14 reaches end of life on 2026-11-12.
- **pytest-socket on Windows:** `--disable-socket` breaks asyncio (the event-loop self-pipe is a socket). Use `addopts = ["--allow-hosts=127.0.0.1,::1"]`: 4 tests passed, including one that proves an outbound connect is blocked.
- **mypy `--strict` boundary:** no `py.typed` for `pythermalcomfort`, `mapie`, `sklearn`, `scoringrules`, `pyarrow`: add overrides and wrap each in a typed facade module. Typed already: ortools (subpackage marker), thermofeel, lightgbm, polars, duckdb, numpy, fastapi, sqlalchemy, alembic, structlog, stamina, httpx2, typer, asgi-correlation-id. Stubs: `scipy-stubs`, `pandas-stubs`, `asyncpg-stubs`.
- **import-linter** contract `sb.employer` forbidden from importing `sb.health` failed as designed (verified): a cheap structural complement to the 403 and purpose-limitation tests in plan §8.8.
- **pre-commit revs (looked up today):** gitleaks v8.30.1 (2026-03-21; repo active, last push 2026-10-28), ruff-pre-commit v0.17.4, commitizen v4.19.3, pre-commit-hooks v6.0.0 (2025-08-09), mirrors-mypy v2.4.1, squawk v2.72.0 (GitHub) / 2.71.0 (PyPI). Run mypy as a `repo: local` hook through `uv run mypy` so the pydantic plugin and stubs resolve; the mirrors hook uses an isolated environment without project dependencies (known behaviour; not re-verified today).
- **Open-Meteo adapter:** one hourly request to `previous-runs-api.open-meteo.com` (`models=ecmwf_ifs025`, `temperature_2m` and `temperature_2m_previous_day1`) returned 24 rows through `httpx2` + `stamina` with default TLS verification. Free tier is non-commercial (plan §8.1).

---

## 7. Ready-to-paste `pyproject.toml` blocks (uv format)

Locked and synced together exactly as written (170 packages; Python 3.13.15 and 3.14.4). Production image: `uv sync --locked --no-default-groups`. Training box: `uv sync --locked --no-default-groups --group train`. Developer machine: `uv sync` (default groups `dev` and `train`). Set `.python-version` to `3.13`.

```toml
[project]
name = "stellar-blaze"
version = "0.1.0"
requires-python = ">=3.13,<3.15"
dependencies = [
    # API
    "fastapi==0.162.4",
    "pydantic==2.14.3",
    "pydantic-settings==2.16.2",
    "uvicorn[standard]==0.54.0",
    "typer==0.29.0",
    # persistence
    "sqlalchemy[asyncio]==2.1.8",
    "asyncpg==0.32.0",
    "alembic==1.20.1",
    # data
    "numpy==2.5.4",
    "polars==2.0.0",          # deliberately one behind 2.1.0 (silent Parquet-filter regression, polars #30655)
    "duckdb==2.0.0",
    "pyarrow==26.0.1",
    # physics, optimisation, inference
    "thermofeel==2.3.0",
    "pythermalcomfort==4.8.1",  # wrap phs(): NaN hang and zero-division bugs (#524, #523)
    "ortools==9.15.6755",
    "lightgbm==4.7.0",
    # outbound HTTP
    "httpx2==2.16.0",
    "stamina==26.1.0",
    # observability
    "structlog==26.1.0",
    "asgi-correlation-id==5.0.1",
    "opentelemetry-api==1.45.2",
    "opentelemetry-sdk==1.45.2",
    "opentelemetry-exporter-otlp-proto-http==1.45.2",
    "opentelemetry-instrumentation-fastapi==0.66b2",
    "opentelemetry-instrumentation-sqlalchemy==0.66b2",  # needs skip_dep_check=True on SQLAlchemy 2.1
]

[dependency-groups]
# Training and calibration only (not in the API image)
train = [
    "scikit-learn==1.9.1",
    "scipy==1.18.1",
    "mapie==1.6.0",
    "scoringrules==0.12.0",
]
dev = [
    "pytest==9.2.0",
    "pytest-asyncio==1.4.1.post1",
    "pytest-cov==7.1.0",
    "pytest-socket==0.8.1",
    "hypothesis==6.170.15",
    "time-machine==3.6.0",
    "testcontainers[postgres]==4.15.0",
    "pvlib==0.16.1",
    "mypy==2.4.1",
    "ruff==0.17.4",
    "pre-commit==4.7.0",
    "commitizen==4.19.3",
    "pip-audit==2.10.1",
    "deptry==0.25.1",
    "import-linter==2.16",
    "squawk-cli==2.71.0",
    "asyncpg-stubs==0.32.0",
    "pandas-stubs==3.1.0.261029",
    "scipy-stubs==1.18.1.1",
]
# Optional, off by default
tts = ["azure-cognitiveservices-speech==1.53.0"]   # build-time clip rendering
llm = ["openai==3.49.0"]                            # self-hosted OpenAI-compatible endpoints
scheduler = ["apscheduler==3.11.3"]                 # only if no platform cron (single replica)
sentry = ["sentry-sdk==2.74.0"]                     # opt-in; see scrubbing settings in section 1
drn = ["torch==2.15.0"]                             # CPU wheel via the explicit index below

[tool.uv]
default-groups = ["dev", "train"]

[tool.uv.sources]
torch = { index = "pytorch-cpu" }

[[tool.uv.index]]
name = "pytorch-cpu"
url = "https://download.pytorch.org/whl/cpu"
explicit = true
```

Tool configuration implied by these pins (both ran clean in the smoke tests):

```toml
[tool.mypy]
python_version = "3.13"
strict = true
plugins = ["pydantic.mypy"]
warn_unreachable = true

[tool.pydantic-mypy]
init_forbid_extra = true
init_typed = true
warn_required_dynamic_aliases = true

[[tool.mypy.overrides]]
module = ["pythermalcomfort.*", "mapie.*", "sklearn.*", "scoringrules.*", "pyarrow.*"]
ignore_missing_imports = true

[tool.pytest.ini_options]
minversion = "9.0"
testpaths = ["tests"]
addopts = ["--strict-markers", "--strict-config", "-ra", "--allow-hosts=127.0.0.1,::1"]
asyncio_mode = "strict"
asyncio_default_fixture_loop_scope = "function"
markers = ["unit", "integration", "e2e", "regression", "slow"]
filterwarnings = ["error"]
```

Compose pins: `postgres:18.6` (digest `sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42` at pull time). OTel instrumentation snippet that worked on SQLAlchemy 2.1.8: `SQLAlchemyInstrumentor().instrument(engine=async_engine.sync_engine, skip_dep_check=True)`.

---

## 8. Unverified or not done (explicit)

- Nothing was executed on Linux. Linux support is established from wheel metadata in the universal lock only.
- Python 3.14: runtime smoke on Windows only (3.14.4).
- Azure: per-voice availability in `uaenorth` (needs a key); SDK on Debian 13; any actual synthesis or audio quality.
- `testcontainers` was resolved and installed but not run; `ConditionalSplitConformalRegressor` and `mapie.exchangeability_testing` were inspected, not run; Alembic autogenerate (`alembic check`) was not configured; granian was not run.
- OR-Tools #5297 was not reproduced (not disproved); PHS NaN mask root cause (19.6% NaN) not investigated.
- Clothing adjustment values and the Brake and Bates TWL algorithm: not obtained from primary sources.
- MLflow 3.13+ blocking the file store: only a third-party project claims it; official docs say "to be deprecated soon". Not checked against MLflow release notes.
- TimescaleDB managed-service availability on the intended UAE host: not checked.
- `ecmwf-opendata`: GitHub shows 0.3.36 but PyPI's latest is 0.3.35 (re-check when the open-data path is built).
- Sentry SaaS data-residency terms: not checked (assumed non-UAE; verify before enabling).
- DuckDB 2.0.0 and `typer` 0.29.0 are new (3 weeks and 2 days old respectively); no open issue touching our usage was found, but the track record is short.
