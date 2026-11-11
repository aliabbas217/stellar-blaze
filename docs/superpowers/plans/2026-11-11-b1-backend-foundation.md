# B1 Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A production-grade backend skeleton for Stellar Blaze that ingests real UAE station observations and archived forecasts into a verified Parquet training set, and ships tested physics (WBGT, PHS, NIOSH, TWL), behind a FastAPI app with health routes, a first migration, a Docker image and backend CI.

**Architecture:** Hexagonal `src` layout in `backend/`: pure `domain/` (physics, weather), `ports/` (Protocols), `adapters/` (HTTP sources, Parquet store, Postgres, process-isolated PHS, in-memory fakes), `application/` (use cases), `api/` (FastAPI), `jobs/` (Typer CLI). Import-linter enforces the layers. Training data lives in Parquet under `SB_DATA_DIR`; Postgres holds app state (only `job_run` in B1).

**Tech Stack:** Python 3.13, uv 0.13.7, FastAPI 0.162.4, Pydantic 2.14.3, SQLAlchemy 2.1.8 + asyncpg 0.32.0 + Alembic 1.20.1, Polars 2.0.0, httpx2 2.16.0 + stamina 26.1.0, structlog 26.1.0, OpenTelemetry 1.45.2, thermofeel 2.3.0, pythermalcomfort 4.8.1, Typer 0.29.0, pytest 9.2.0, testcontainers 4.15.0, Postgres 18.6.

**Spec:** `docs/decisions/0001`-`0008` (read 0002, 0005, 0006, 0008 before starting); `docs/research/2026-11-11-backend-ml-stack.md` (pins and API gotchas are authoritative); `docs/research/2026-11-11-data-availability.md` (data facts and expected counts); `docs/superpowers/plans/2026-11-11-roadmap.md` §2 (coordination points).

## Global Constraints

- Write only under `backend/`, `.github/workflows/ci.yml` (job `backend` only), these repo-root files: `.editorconfig`, `.gitattributes`, `.gitignore`, `.pre-commit-config.yaml`, `.cz.toml`, `README.md`, and (Task 11 only) `docs/research/2026-11-12-gold-dataset-manifest.json`. Do not create `compose.yaml` or anything under `frontend/` or `infra/`.
- `backend/pyproject.toml` dependency pins are **copied verbatim** from `docs/research/2026-11-11-backend-ml-stack.md` §7 (`[project]` dependencies, `[dependency-groups]`, `[tool.uv]`, `[tool.uv.sources]`, `[[tool.uv.index]]`, `[tool.mypy]`, `[tool.pydantic-mypy]`, mypy overrides, `[tool.pytest.ini_options]`). Do not bump any pin. `polars==2.0.0` stays (polars #30655). Use `httpx2`, never `httpx` or `requests`.
- Python `>=3.13,<3.15`; `.python-version` = `3.13`. uv `0.13.7`.
- `mypy --strict` with `pydantic.mypy` passes on `src` and `tests`. Libraries without `py.typed` (`pythermalcomfort`, `mapie`, `sklearn`, `scoringrules`, `pyarrow`) are imported only inside one facade module each.
- Tests carry exactly one tier marker: `unit`, `integration`, `e2e`, `regression`; add `slow` where a test takes over 5 s. Async tests use `@pytest.mark.asyncio` (strict mode). Unit tests never touch the network: pytest-socket (`--allow-hosts=127.0.0.1,::1`) is on; HTTP adapters are tested with `httpx2.MockTransport` replaying **recorded** fixtures committed under `backend/tests/fixtures/`.
- `filterwarnings = ["error"]` stays. A third-party warning may get one targeted `ignore` entry naming the package, with a comment saying why; never a blanket ignore.
- All timestamps are timezone-aware UTC (`datetime` with `UTC`, Polars `Datetime("us", "UTC")`). GST (UTC+4) appears only in prose. Summer window = 15 May 00:00 to 30 Sep 23:00 UTC inclusive (3,336 hourly bins). Working daytime = UTC hours 06-14 inclusive.
- Config only via env vars with prefix `SB_` (`pydantic-settings`); no cloud SDK imports anywhere in B1.
- API routes live under `/api/v1`; errors are RFC 9457 `application/problem+json` with a `request_id` member; domain problem `type` values are URNs `urn:stellar-blaze:problem:<slug>`.
- Identifiers use US English (`vapor`, `acclimatization`); comments may quote sources verbatim.
- Conventional Commits; one commit per task minimum. **Never run `git stash`, `git reset`, `git rebase`, `git checkout -- <path>` or `git clean`.** If the working tree contains changes you did not make, stop and report. Never use `--no-verify`; fix the failing hook.
- Evidence and conventions win over this plan: if a step is wrong (an API name differs, a value contradicts the cited source), stop, say what the evidence shows, and propose the correction. Being corrected is preferred to being obeyed.

## Review Focus

1. **A missing forecast hour reaching PHS** (NaN in any input): the safety engine must return a rejection, not hang. Task 14 proves the timeout against the real NaN hang.
2. **METAR specials and tie-breaking in hourly binning** (reports at HH:50, HH:30 ties, duplicate times, empty cells): binning must be deterministic and reproduce the research counts. Task 5 pins tie rules; Task 11 checks counts.
3. **Silent unit drift from Open-Meteo** (wind defaults to km/h; radiation is a preceding-hour mean): the adapter asserts `hourly_units` and fails loudly. Task 9.
4. **Incoherent radiation inputs to Liljegren** (radiation while the sun is down; garbage in gives values up to 120 °C): such elements become NaN with a reason, never a number. Task 6.
5. **GHCNh 2026 rows with blank QC codes and QC-flagged extreme values**: lenient policy keeps blank-QC rows; flagged values are excluded from the audit columns but counted, never dropped silently. Task 5 and Task 8.

---

## File structure

```
.editorconfig  .gitattributes  .gitignore  .pre-commit-config.yaml  .cz.toml  README.md
.github/workflows/ci.yml                      # job "backend" (F1 adds job "frontend")
backend/
  pyproject.toml  uv.lock  .python-version  .env.example  .dockerignore  Dockerfile  README.md
  alembic.ini
  alembic/env.py  alembic/script.py.mako  alembic/versions/0001_create_job_run.py
  src/stellar_blaze/
    __init__.py  config.py  logging.py  errors.py  tracing.py
    domain/
      weather/{__init__,stations,models,schemas,binning}.py
      physics/{__init__,psychrometrics,solar,wbgt,niosh,metabolic,twl,phs}.py
      risk/{__init__,levels}.py
    ports/{__init__,weather,notifications}.py
    adapters/
      http/{__init__,client,cache}.py
      sources/{__init__,iem,ghcnh,open_meteo}.py
      storage/{__init__,parquet_store}.py
      db/{__init__,engine,tables,job_runs}.py
      compute/{__init__,phs_process}.py
      fakes/{__init__,weather,notifications}.py
    application/{__init__,ingest,dataset}.py
    api/{__init__,app,deps}.py  api/routers/{__init__,health}.py
    jobs/{__init__,cli}.py
    ml/__init__.py                                 # empty until B2
  tests/
    conftest.py
    fixtures/{iem,ghcnh,open_meteo,wbgt,twl}/...
    unit/...  integration/...  regression/...
```

---

### Task 1: Repository tooling and backend scaffold

**Files:**
- Create: `.editorconfig`, `.gitattributes`, `.gitignore`, `.pre-commit-config.yaml`, `.cz.toml`, `README.md`
- Create: `backend/pyproject.toml`, `backend/.python-version`, `backend/src/stellar_blaze/__init__.py`, every `__init__.py` in the tree above, `backend/README.md`
- Test: `backend/tests/unit/test_package.py`

**Interfaces:**
- Produces: importable package `stellar_blaze` with `__version__: str = "0.1.0"`; console script `sb-jobs = "stellar_blaze.jobs.cli:app"` (target created in Task 10; until then `jobs/cli.py` holds `app = typer.Typer(no_args_is_help=True)`).

- [ ] **Step 1: Root files.** `.editorconfig`: utf-8, LF, final newline, trim trailing whitespace, 4 spaces for `*.py`, 2 for `*.{yml,yaml,json,toml,md,ts,tsx}`. `.gitattributes`: `* text=auto eol=lf`, `*.parquet binary`. `.gitignore`: Python (`__pycache__/`, `.venv/`, `.mypy_cache/`, `.ruff_cache/`, `.pytest_cache/`, `.coverage`, `htmlcov/`), `.env`, `backend/data/`, `.numba-cache/`. `.cz.toml`: `[tool.commitizen] name = "cz_conventional_commits"`, `version = "0.1.0"`, `tag_format = "v$version"`, `update_changelog_on_bump = true`. Root `README.md`: one paragraph on the project, links to `docs/context/challenge-07-plan.md`, `docs/decisions/`, `backend/README.md`.
- [ ] **Step 2: `.pre-commit-config.yaml`** with exactly these hooks and revs (stack doc §6.11):
  - `pre-commit/pre-commit-hooks` `v6.0.0`: `trailing-whitespace`, `end-of-file-fixer`, `check-added-large-files` (`args: [--maxkb=500]`), `check-yaml`, `check-toml`, `check-json`, `detect-private-key`.
  - `gitleaks/gitleaks` `v8.30.1`: `gitleaks`.
  - `astral-sh/ruff-pre-commit` `v0.17.4`: `ruff-check` (`args: [--fix]`), `ruff-format`.
  - `repo: local`, id `mypy`, `entry: uv run --project backend mypy backend/src backend/tests`, `language: system`, `pass_filenames: false`, `files: ^backend/.*\.py$`.
  - `commitizen-tools/commitizen` `v4.19.3`: `commitizen` (stage `commit-msg`), `commitizen-branch` (stage `pre-push`).
- [ ] **Step 3: `backend/pyproject.toml`.** Paste the stack doc §7 blocks verbatim. Add:
  - `[build-system] requires = ["uv_build>=0.13.7,<0.14"]`, `build-backend = "uv_build"`; `[project.scripts] sb-jobs = "stellar_blaze.jobs.cli:app"`.
  - `[tool.ruff] line-length = 120`, `target-version = "py313"`, `src = ["src", "tests"]`; `[tool.ruff.lint] select = ["E","F","W","I","B","UP","SIM","C4","N","S","ASYNC","DTZ","PT","RUF","PTH","T20","SLF"]`; per-file ignore `tests/** = ["S101"]`.
  - `[tool.importlinter]` `root_package = "stellar_blaze"`, `include_external_packages = true`, four contracts: (1) **layers** `stellar_blaze.api | stellar_blaze.jobs` > `stellar_blaze.application` > `stellar_blaze.ports` > `stellar_blaze.domain`; (2) **forbidden**: `stellar_blaze.domain` must not import `httpx2`, `sqlalchemy`, `asyncpg`, `fastapi`, `typer`, `stellar_blaze.adapters`, `stellar_blaze.application`, `stellar_blaze.api`, `stellar_blaze.jobs`; (3) **forbidden**: `stellar_blaze.application` must not import `stellar_blaze.adapters`, `stellar_blaze.api`, `stellar_blaze.jobs`; (4) **forbidden**: `stellar_blaze.adapters` must not import `stellar_blaze.application`, `stellar_blaze.api`, `stellar_blaze.jobs`.
  - `[tool.deptry.per_rule_ignores] DEP002 = ["uvicorn", "asyncpg", "pyarrow", "opentelemetry-exporter-otlp-proto-http", "lightgbm", "ortools", "duckdb"]` with a TOML comment: "runtime-loaded or used from B2/B3; remove each when first imported".
  - `[tool.coverage.run] source = ["stellar_blaze"]`, `branch = true`.
- [ ] **Step 4: Write the failing test** `tests/unit/test_package.py`:

```python
import pytest
import stellar_blaze

@pytest.mark.unit
def test_version_is_semver() -> None:
    assert stellar_blaze.__version__ == "0.1.0"
```

- [ ] **Step 5: Run it to verify it fails.** `cd backend && uv sync && uv run pytest tests/unit/test_package.py -v` → FAIL (`__version__` missing).
- [ ] **Step 6: Implement** `__version__` and the empty package tree. `uv lock` must resolve; commit `uv.lock`.
- [ ] **Step 7: Verify.** From `backend/`: `uv run pytest -m unit -v` PASS; `uv run ruff check . && uv run ruff format --check .`; `uv run mypy src tests`; `uv run lint-imports` (4 contracts kept); `uv run deptry src`. From repo root: `uv run --project backend pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push` then `uv run --project backend pre-commit run --all-files` → all hooks pass.
- [ ] **Step 8: Backend README** (`backend/README.md`): prerequisites (uv 0.13.7, Docker), `uv sync`, test commands per marker, the local Postgres command `docker run -d --name sb-db -p 5432:5432 -e POSTGRES_USER=sb -e POSTGRES_PASSWORD=sb -e POSTGRES_DB=stellar_blaze postgres:18.6`, `uv run alembic upgrade head`, and a jobs section filled in Task 10.
- [ ] **Step 9: Commit** `chore: scaffold backend package and repository tooling`.

---

### Task 2: App core: config, logging, RFC 9457 errors, app factory, liveness

**Files:**
- Create: `src/stellar_blaze/config.py`, `logging.py`, `errors.py`, `tracing.py`, `api/app.py`, `api/deps.py`, `api/routers/health.py`, `backend/.env.example`
- Test: `tests/unit/test_config.py`, `tests/unit/api/test_errors.py`, `tests/unit/api/test_health_live.py`, `tests/unit/test_logging.py`

**Interfaces:**
- Produces:
  - `class Settings(BaseSettings)` (`env_prefix="SB_"`, `env_file=".env"`, `extra="ignore"`, `frozen=True`) with fields: `env: Literal["dev","test","prod"] = "dev"`, `database_url: SecretStr` (required), `log_level: Literal["DEBUG","INFO","WARNING","ERROR"] = "INFO"`, `log_format: Literal["json","console"] = "json"`, `data_dir: Path = Path("data")`, `http_timeout_s: float = 60.0`, `http_user_agent: str = "stellar-blaze/0.1"`, `open_meteo_previous_runs_url: str = "https://previous-runs-api.open-meteo.com/v1/forecast"`, `iem_asos_url: str = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"`, `ghcnh_base_url: str = "https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year"`, `readiness_timeout_s: float = 2.0`, `phs_timeout_s: float = 10.0`. A model validator rejects `env="prod"` with `log_format="console"`. `def get_settings() -> Settings` (cached).
  - `def configure_logging(settings: Settings) -> None` (structlog; JSON renderer for `json`, console renderer for `console`; contextvars merged; stdlib and uvicorn loggers routed through structlog; `request_id` bound from asgi-correlation-id).
  - `errors.py`: `PROBLEM_JSON = "application/problem+json"`, `class Problem(BaseModel)`, `class DomainProblem(Exception)`, `def install_problem_handlers(app: FastAPI) -> None` exactly as stack doc §6.8 (handlers for `DomainProblem`, `RequestValidationError` → 422 with an `errors` member, `StarletteHTTPException`, catch-all `Exception` → 500 with `title="Internal Server Error"`, no exception text, logged with traceback).
  - `tracing.py`: `def configure_tracing(app: FastAPI, settings: Settings) -> None`: no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set; then OTLP-HTTP exporter + `FastAPIInstrumentor`.
  - `api/app.py`: `def create_app(settings: Settings | None = None) -> FastAPI` (title "Stellar Blaze API", version from package, `CorrelationIdMiddleware(header_name="X-Request-ID")`, problem handlers, routers mounted under `/api/v1`, OpenAPI at `/openapi.json`).
  - `GET /api/v1/health/live` → 200 `{"status": "ok"}`, response model `LiveResponse`.

- [ ] **Step 1: Write failing tests.**
  - `test_settings_reads_sb_prefixed_env(monkeypatch)`: set `SB_DATABASE_URL`, `SB_ENV=test`; `Settings().env == "test"`; `Settings().database_url.get_secret_value()` equals the value.
  - `test_settings_rejects_console_logs_in_prod`: `Settings(env="prod", log_format="console", database_url=...)` raises `ValidationError`.
  - `test_unknown_route_returns_problem_json`: `TestClient(create_app(settings)).get("/api/v1/nope")` → 404, `content-type` starts with `application/problem+json`, body has `type == "about:blank"`, `status == 404`, `instance == "/api/v1/nope"`, non-empty `request_id`.
  - `test_domain_problem_keeps_extension_members`: a test-only route raising `DomainProblem(type_="urn:stellar-blaze:problem:forbidden", title="Forbidden", status=403, reason="employer_role")` → 403 and body `reason == "employer_role"`.
  - `test_validation_error_is_422_problem`: test-only route with a query `int` param called with `?x=abc` → 422, `errors` is a non-empty list.
  - `test_unhandled_error_leaks_nothing`: test-only route raising `RuntimeError("secret-db-password")` with `TestClient(app, raise_server_exceptions=False)` → 500, `"secret" not in response.text`.
  - `test_live_is_ok`: `GET /api/v1/health/live` → 200 `{"status": "ok"}`; response header `X-Request-ID` present.
  - `test_json_log_line_has_request_id(capsys)`: with `log_format="json"`, a request emits at least one JSON line with keys `event`, `level`, `timestamp`, `request_id`.
- [ ] **Step 2: Run to verify they fail.** `uv run pytest tests/unit -m unit -v` → FAIL (modules missing).
- [ ] **Step 3: Implement** the interfaces above. Extension kwargs on `Problem(...)` need the single `# type: ignore[call-arg]` the stack doc §6.8 describes, or build a dict first. `.env.example` lists every `SB_` variable with a dev value (`SB_DATABASE_URL=postgresql+asyncpg://sb:sb@localhost:5432/stellar_blaze`, `SB_LOG_FORMAT=console`, `SB_ENV=dev`).
- [ ] **Step 4: Run to verify they pass.** `uv run pytest -m unit -v` PASS; ruff, mypy, lint-imports clean.
- [ ] **Step 5: Commit** `feat(api): add settings, structured logging, RFC 9457 errors and liveness route`.

---

### Task 3: Persistence: async engine, Alembic, `job_run` migration, readiness

**Files:**
- Create: `alembic.ini`, `alembic/env.py` (from `alembic init -t async`, then edited), `alembic/script.py.mako`, `alembic/versions/0001_create_job_run.py`, `src/stellar_blaze/adapters/db/engine.py`, `tables.py`, `job_runs.py`
- Modify: `api/app.py` (lifespan), `api/deps.py`, `api/routers/health.py`
- Test: `tests/integration/conftest.py`, `tests/integration/test_migrations.py`, `tests/integration/test_job_runs.py`, `tests/integration/test_health_ready.py`, `tests/unit/api/test_health_ready_unavailable.py`

**Interfaces:**
- Consumes: `Settings`, `create_app`, `DomainProblem` (Task 2).
- Produces:
  - `def build_engine(settings: Settings) -> AsyncEngine` (named to avoid shadowing SQLAlchemy's `create_engine`; `connect_args={"server_settings": {"lock_timeout": "3000", "statement_timeout": "30000"}, "timeout": settings.readiness_timeout_s}`, `pool_pre_ping=True`).
  - `tables.py`: `class Base(DeclarativeBase)`, `class JobRun(Base)` mapped to table `job_run`.
  - `job_runs.py`: `class JobRunRepository` with `__init__(self, engine: AsyncEngine)`, `async def start(self, job_name: str, params: Mapping[str, JsonValue], code_version: str | None) -> UUID`, `async def finish(self, run_id: UUID, status: Literal["succeeded","failed"], summary: Mapping[str, JsonValue] | None, error: str | None) -> None`, `async def record_skipped(self, job_name: str, params: Mapping[str, JsonValue]) -> UUID`; and `@asynccontextmanager async def advisory_lock(engine: AsyncEngine, key: str) -> AsyncIterator[bool]` (holds one connection; `SELECT pg_try_advisory_lock(hashtext(:key))`; unlocks on exit).
  - `GET /api/v1/health/ready` → 200 `{"status": "ok", "checks": {"database": "ok"}}`, or 503 problem `type="urn:stellar-blaze:problem:dependency-unavailable"`, `title="Dependency unavailable"`, member `dependency="database"`. The check runs `SELECT 1` bounded by `readiness_timeout_s`.
  - Lifespan creates the engine on startup and disposes it on shutdown; startup never fails because the DB is down.
  - `tracing.py` gains an optional `engine: AsyncEngine | None` argument: when tracing is enabled, `SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine, skip_dep_check=True)` (stack doc §7; remove `skip_dep_check` when the contrib release after 0.66b2 ships).
- Table `job_run` (migration `0001`, revision id `0001`):

| Column | Type | Constraint |
|---|---|---|
| `id` | `uuid` | PK, server default `gen_random_uuid()` |
| `job_name` | `text` | not null |
| `status` | `text` | not null, `CHECK (status IN ('running','succeeded','failed','skipped_locked'))` |
| `started_at` | `timestamptz` | not null, default `now()` |
| `finished_at` | `timestamptz` | null |
| `params` | `jsonb` | not null, default `'{}'::jsonb` |
| `summary` | `jsonb` | null |
| `error` | `text` | null |
| `code_version` | `text` | null |

  Index `ix_job_run_job_name_started_at` on `(job_name, started_at DESC)`. `upgrade()` and `downgrade()` both begin with `op.execute("SET lock_timeout = '3s'")` and `op.execute("SET statement_timeout = '15s'")`; the same two lines go into `script.py.mako` so every future migration carries them. `env.py` reads the URL from `Settings`, sets `target_metadata = Base.metadata`, and supports offline mode (`--sql`).

- [ ] **Step 1: Write failing tests.**
  - `tests/integration/conftest.py`: session-scoped `PostgresContainer("postgres:18.6", driver="asyncpg")` fixture yielding a `Settings` whose `database_url` points at it.
  - `test_upgrade_downgrade_upgrade` (`integration`): run `alembic upgrade head`, `downgrade base`, `upgrade head` via `alembic.command` against the container; after the final upgrade, `job_run` exists and `alembic check` reports no drift.
  - `test_job_run_lifecycle` (`integration`): `start(...)` returns a UUID with status `running`; `finish(..., "succeeded", {"rows": 3}, None)` sets `finished_at` and `summary`.
  - `test_advisory_lock_is_exclusive` (`integration`): inside `advisory_lock(engine, "ingest")` yielding `True`, a second `advisory_lock(engine, "ingest")` yields `False`; after exit, a new attempt yields `True`.
  - `test_ready_ok_with_database` (`integration`): `GET /api/v1/health/ready` → 200, `checks.database == "ok"`.
  - `test_ready_503_without_database` (`unit`): settings pointing at `postgresql+asyncpg://sb:sb@127.0.0.1:1/x` → 503 problem with `dependency == "database"`, returned within 5 s.
- [ ] **Step 2: Run to verify they fail.** `uv run pytest -m "unit or integration" -v` → FAIL.
- [ ] **Step 3: Implement** the interfaces and migration.
- [ ] **Step 4: Lint the migration.** `SB_DATABASE_URL=postgresql+asyncpg://x:x@localhost/x uv run alembic upgrade head --sql > ../migration.sql && uv run squawk ../migration.sql` → no violations (delete `migration.sql` afterwards).
- [ ] **Step 5: Run to verify they pass.** `uv run pytest -m "unit or integration" -v` PASS (Docker must be running).
- [ ] **Step 6: Commit** `feat(db): add async engine, job_run migration and readiness probe`.

---

### Task 4: Dockerfile and backend CI

**Files:**
- Create: `backend/Dockerfile`, `backend/.dockerignore`, `.github/workflows/ci.yml`
- Test: CI run itself; local `docker build`

**Interfaces:**
- Produces: image listening on port 8000, `CMD ["uvicorn", "stellar_blaze.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]`; env `NUMBA_CACHE_DIR=/app/.numba-cache` (writable by the app user); non-root uid 10001. Workflow `ci.yml` with job id `backend`.

- [ ] **Step 1: Dockerfile.** Multi-stage. `FROM ghcr.io/astral-sh/uv:0.13.7 AS uv`; base `python:3.13.15-slim-trixie` pinned by digest (resolve with `docker buildx imagetools inspect python:3.13.15-slim-trixie` and paste the index digest). Build stage: `UV_COMPILE_BYTECODE=1`, `UV_LINK_MODE=copy`, `UV_PYTHON_DOWNLOADS=never`; copy `pyproject.toml uv.lock`, `uv sync --locked --no-default-groups --no-install-project`; copy `src/ alembic/ alembic.ini`; `uv sync --locked --no-default-groups`. Runtime stage: copy `/app` from build, create `/app/.numba-cache` owned by uid 10001, `PATH=/app/.venv/bin:$PATH`, `PYTHONUNBUFFERED=1`, `USER 10001`, `EXPOSE 8000`. `.dockerignore` excludes `.venv`, `data`, `tests`, caches, `.env`.
- [ ] **Step 2: Verify the image locally.** `docker build -t stellar-blaze-api:dev backend` succeeds; `docker run --rm -p 8000:8000 -e SB_DATABASE_URL=postgresql+asyncpg://sb:sb@host.docker.internal:5432/stellar_blaze stellar-blaze-api:dev` then `curl -s localhost:8000/api/v1/health/live` → `{"status":"ok"}`; `docker run --rm stellar-blaze-api:dev id -u` → `10001`.
- [ ] **Step 3: `ci.yml`.** Triggers: `push` to `main`, `pull_request`. `permissions: contents: read`. `concurrency` per ref with cancel-in-progress. Job `backend` on `ubuntu-24.04`, `defaults.run.working-directory: backend`. Steps:
  1. `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1`
  2. `astral-sh/setup-uv@68559e99cc807c1eb7e9238fd43a15bba460eec2  # v10.3.3` with `version: "0.13.7"`, `enable-cache: true`, `cache-dependency-glob: backend/uv.lock`
  3. `uv python install 3.13` and `uv sync --locked`
  4. `uv lock --check`
  5. With `working-directory: .`: `uv run --project backend pre-commit run --all-files --show-diff-on-failure`
  6. `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy src tests`, `uv run lint-imports`, `uv run deptry src`
  7. `uv run pytest -m unit --cov --cov-report=term-missing`
  8. `uv run pytest -m integration`
  9. `SB_DATABASE_URL=postgresql+asyncpg://x:x@localhost/x uv run alembic upgrade head --sql > "$RUNNER_TEMP/migration.sql"` then `uv run squawk "$RUNNER_TEMP/migration.sql"`
  10. `uv export --locked --format requirements-txt -o "$RUNNER_TEMP/req.txt"` then `uv run pip-audit --disable-pip --no-deps -r "$RUNNER_TEMP/req.txt"`
  11. `docker build -t stellar-blaze-api:ci .`
  Add a YAML comment at the top: "Job `frontend` is added by the F1 plan as a sibling of `backend`; do not edit the `backend` job from F1."
- [ ] **Step 4: Verify** with `uv run --project backend pre-commit run check-yaml --files .github/workflows/ci.yml` (and `actionlint` if installed). The real check is the first CI run after Ali pushes; record its URL in the task's commit body if available.
- [ ] **Step 5: Commit** `ci: add backend workflow and container image`.

---

### Task 5: Weather domain: stations, models, schemas, hourly binning, psychrometrics

**Files:**
- Create: `domain/weather/stations.py`, `models.py`, `schemas.py`, `binning.py`, `domain/physics/psychrometrics.py`
- Test: `tests/unit/domain/test_stations.py`, `test_binning.py`, `test_psychrometrics.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True, slots=True) class Station: icao: str; name: str; lat: float; lon: float; elevation_m: float; ghcnh_id: str; cluster: str`; `STATIONS: Final[tuple[Station, ...]]`; `def station(icao: str) -> Station` (raises `KeyError` with the known list). Values (coordinates from `docs/research/scripts/fetch_forecast_stations.py`, elevations from data doc §3.2, clusters from ADR 0005):

| icao | name | lat | lon | elevation_m | ghcnh_id | cluster |
|---|---|---|---|---|---|---|
| OMAA | Abu Dhabi Intl | 24.4330 | 54.6511 | 26.8 | AEI0000OMAA | abu_dhabi |
| OMAD | Al Bateen | 24.4283 | 54.4581 | 4.9 | AEI0000OMAD | abu_dhabi |
| OMAL | Al Ain Intl | 24.2617 | 55.6092 | 264.9 | AEI0000OMAL | al_ain |
| OMDB | Dubai Intl | 25.2550 | 55.3643 | 10.4 | AEI0000OMDB | dubai_sharjah |
| OMSJ | Sharjah Intl | 25.3286 | 55.5172 | 33.8 | AEI0000OMSJ | dubai_sharjah |
| OMDW | Al Maktoum Intl | 24.8861 | 55.1722 | 18.9 | AEI0000OMDW | al_maktoum |
| OMFJ | Fujairah Intl | 25.1122 | 56.3240 | 46.3 | AEI0000OMFJ | fujairah |
| OMRK | Ras Al Khaimah | 25.6130 | 55.9390 | 31.1 | AEU041184-1 | ras_al_khaimah |

  - `models.py`: `class NwpModel(StrEnum)`: `ECMWF_IFS025 = "ecmwf_ifs025"`, `GFS_SEAMLESS = "gfs_seamless"`, `ECMWF_AIFS025 = "ecmwf_aifs025_single"`; `MODEL_SUMMERS: Final[Mapping[NwpModel, frozenset[int]]]` = IFS and GFS `{2024, 2025, 2026}`, AIFS `{2025, 2026}`; `LEADS_DAYS: Final = range(0, 8)`; `def summer_window(year: int) -> tuple[datetime, datetime]` (15 May 00:00 UTC, 30 Sep 23:00 UTC inclusive); `def is_working_daytime(hour_utc: int) -> bool` (6 ≤ h ≤ 14); `class QcPolicy(StrEnum)`: `NONE`, `GHCNH_LENIENT`.
  - `schemas.py`: Polars schema mappings `OBS_RAW_SCHEMA` (`station: String, obs_time: Datetime(us, UTC), t_c, td_c, wind_ms: Float64, qc_t, qc_td, qc_wind: String, source: String`), `OBS_HOURLY_SCHEMA` (`station, valid_time, t_c, td_c, wind_ms, source`), `FORECAST_SCHEMA` (`station, model: String, valid_time: Datetime(us, UTC), lead_days: Int8, t_c, td_c, wind_ms, sw_wm2, direct_wm2, pressure_hpa, grid_lat, grid_lon, grid_elev_m: Float64`), `GOLD_PAIRS_SCHEMA` (Task 10 table); `class SchemaMismatchError(ValueError)`; `def conform(df: pl.DataFrame, schema: Mapping[str, pl.DataType]) -> pl.DataFrame` (selects and orders the schema columns; raises `SchemaMismatchError` naming missing columns or wrong dtypes; never casts silently).
  - `binning.py`: `PLAUSIBLE: Final = {"t_c": (-10.0, 60.0), "td_c": (-30.0, 40.0), "wind_ms": (0.0, 60.0)}`; `def bin_to_nearest_hour(raw: pl.DataFrame, *, qc_policy: QcPolicy) -> tuple[pl.DataFrame, BinningReport]`. Rules, per station and **per variable independently** (as in `docs/research/scripts/analyze_obs.py`): (1) null out implausible values; (2) under `GHCNH_LENIENT`, null out a value whose QC code is neither `"1"` nor null and count it; (3) assign each report to the nearest UTC hour, **exact HH:30:00 ties resolve to the even hour** (matches the research's pandas `round("h")`); (4) within an hour bin the report closest to the hour wins; equal distance → the earlier report. `BinningReport` is a frozen dataclass: `n_raw: int`, `n_implausible: dict[str, int]`, `n_qc_flagged: dict[str, int]`.
  - `psychrometrics.py` (all numpy-vectorised, `F64 = NDArray[np.float64]`): `saturation_vapor_pressure_kpa(t_c)` (Buck 1996: `0.61121 * exp((18.678 - t/234.5) * (t / (257.14 + t)))`), `vapor_pressure_kpa_from_dewpoint(td_c)`, `relative_humidity_pct(t_c, td_c)` (clipped to [0, 100]), `dewpoint_c_from_vapor_pressure(e_kpa)` (vectorised bisection on [-60, 60] °C, tolerance 1e-6 °C), `vapor_pressure_kpa_from_wet_bulb(t_c, twb_c, pressure_hpa)` (WMO ventilated-psychrometer form `e = es(Tw) - 6.53e-4·(1 + 0.000944·Tw)·p·(T - Tw)` in hPa, converted to kPa; cite WMO-No. 8 Annex 4.B in the docstring).

- [ ] **Step 1: Write failing tests.**
  - `test_eight_stations_six_clusters`: `len(STATIONS) == 8`; `len({s.cluster for s in STATIONS}) == 6`; `station("OMSJ").cluster == station("OMDB").cluster`; `station("OMRK").ghcnh_id == "AEU041184-1"`.
  - `test_summer_window_has_3336_hours`: hours between the bounds inclusive == 3,336 for 2024, 2025, 2026.
  - `test_binning_closest_report_wins`: reports at 00:50 (T=30) and 01:00 (T=31) → bin 01:00 has 31; report at 01:10 (T=32) with 00:50 → equal distance → 30.
  - `test_binning_half_hour_tie_goes_to_even_hour`: a report at 01:30:00 lands in bin 02:00; at 02:30:00 lands in 02:00.
  - `test_binning_per_variable_independence`: report A at 01:00 has T only, report B at 00:50 has Td only → bin 01:00 has T from A and Td from B.
  - `test_binning_drops_implausible_and_counts`: T=61 → null in output, `n_implausible["t_c"] == 1`.
  - `test_ghcnh_lenient_keeps_blank_qc_and_counts_flags`: qc `None` kept; qc `"1"` kept; qc `"2"` nulled and `n_qc_flagged["td_c"] == 1`.
  - `test_buck_at_zero_is_constant`: `saturation_vapor_pressure_kpa(0.0) == pytest.approx(0.61121, rel=1e-9)`.
  - `test_buck_agrees_with_magnus`: for t in 0..50 step 1, `|buck/magnus - 1| < 0.003` with Magnus `0.61094*exp(17.625 t / (t + 243.04))` (Alduchov & Eskridge 1996).
  - `test_relative_humidity_vector`: `relative_humidity_pct(30.0, 20.0) == approx(55.083, abs=0.01)`; `relative_humidity_pct(25.0, 25.0) == 100.0`.
  - `test_dewpoint_round_trip`: for x in -10..40 step 0.5, `dewpoint_c_from_vapor_pressure(saturation_vapor_pressure_kpa(x)) == approx(x, abs=1e-4)`.
  - `test_wet_bulb_vapor_pressure_formula`: `vapor_pressure_kpa_from_wet_bulb(38.7, 28.6, 1013.0) == approx(3.22949, abs=1e-4)`.
- [ ] **Step 2: Run to verify they fail.** `uv run pytest tests/unit/domain -v` → FAIL.
- [ ] **Step 3: Implement** the interfaces.
- [ ] **Step 4: Run to verify they pass**, plus mypy and lint-imports.
- [ ] **Step 5: Commit** `feat(domain): add stations, weather schemas, hourly binning and psychrometrics`.

---

### Task 6: Solar geometry and Liljegren WBGT (port of `audit_wbgt.py`)

**Files:**
- Create: `domain/physics/solar.py`, `domain/physics/wbgt.py`, `tests/fixtures/wbgt/golden_omaa_2025-07-15.json`
- Test: `tests/unit/physics/test_solar.py`, `tests/unit/physics/test_wbgt.py`

**Interfaces:**
- Consumes: `relative_humidity_pct` (Task 5).
- Produces:
  - `solar.py`: `cos_zenith(lat_deg: float, lon_deg: float, utc: NDArray[np.datetime64]) -> F64` and `mean_cos_zenith_prev_hour(lat_deg: float, lon_deg: float, utc: NDArray[np.datetime64]) -> F64`: **verbatim ports** of the same-named functions in `D:\dev\future-health-challenge\scripts\audit_wbgt.py` (typing tightened, behaviour unchanged).
  - `wbgt.py`: `class CosZenithMode(StrEnum)`: `MIDPOINT = "midpoint"` (default; FHC primary variant A), `MEAN = "mean"`; `class WbgtReject(IntEnum)`: `OK = 0`, `NONFINITE_INPUT = 1`, `INCOHERENT_RADIATION = 2`, `NO_CONVERGENCE = 3`, `OUT_OF_BOUNDS = 4`; `class WbgtResult(NamedTuple): wbgt_c: F64; reject: NDArray[np.int8]`;
    `def wbgt_liljegren(*, t_c: F64, td_c: F64, wind10m_ms: F64, pressure_hpa: F64, sw_wm2: F64, direct_wm2: F64, lat: float, lon: float, valid_time_utc: NDArray[np.datetime64], mode: CosZenithMode = CosZenithMode.MIDPOINT) -> WbgtResult`.
    Behaviour: radiation is the mean over the hour ending at `valid_time_utc`; `rh = relative_humidity_pct(t_c, td_c)`; `fdir = clip(direct/sw, 0, 0.9)`, 0 where `sw <= 1e-6`; `cz` = `clip(cos_zenith(lat, lon, t - 30 min), 0)` for MIDPOINT or `mean_cos_zenith_prev_hour` for MEAN; call `thermofeel.calculate_wbgt_liljegren(t_k, rh, pressure_hpa, wind10m_ms, sw, fdir, cz)` (returns K) and convert to °C. Reject (value NaN, code set) in this precedence: any input non-finite → 1; `sw > 10` while `mean_cos_zenith_prev_hour == 0` → 2; thermofeel NaN → 3; result outside `[t_c - 30, t_c + 10]` → 4. Rejected elements are excluded from the thermofeel call (garbage inputs are slow, stack doc §6.6).

- [ ] **Step 1: Generate the golden fixture outside the repo.** In a scratch directory (not the repo), write a script that copies `cos_zenith` from `audit_wbgt.py` unchanged, builds the 24 UTC hours of 2025-07-15 at OMAA (24.4330, 54.6511) with `h = 0..23`: `t = 34 + 7 sin(2π(h-4)/24)`, `td = 24 - 4 sin(2π(h-4)/24)`, `wind = 3 + 1.5 sin(2π(h-6)/24)`, `p = 998.0`, `sw = 950 * mean_cos_zenith_prev_hour(...)` (FHC function), `direct = 0.8 * sw`; computes `rh` with the Buck formula of Task 5, `fdir` and `cz_mid` exactly as FHC variant A; calls `thermofeel.calculate_wbgt_liljegren` (thermofeel 2.3.0, `uv run --no-project --with thermofeel==2.3.0 python -I script.py`). Save inputs and the 24 outputs (°C, full float precision) with a `provenance` field naming the FHC file and function to `tests/fixtures/wbgt/golden_omaa_2025-07-15.json`.
- [ ] **Step 2: Write failing tests.**
  - `test_cos_zenith_matches_pvlib` (`unit`): 288 five-minute timestamps on 2025-07-15 at OMAA; `max |cos_zenith - cos(radians(pvlib.solarposition.get_solarposition(...)["zenith"]))| <= 1e-4` (stack doc measured 5.0e-5).
  - `test_wbgt_matches_fhc_golden`: inputs from the fixture → `wbgt_c` equals golden with `atol=1e-9`; all `reject == 0`.
  - `test_night_wbgt_not_above_air_temperature` (hypothesis, 200 examples): sw = direct = 0 at 20:00 UTC, t in [25, 45], td in [-5, t-1], wind in [0.5, 8], p in [990, 1010] → `wbgt_c <= t_c + 0.1`.
  - `test_wbgt_increases_with_dewpoint` (hypothesis): same daytime inputs, `td + 2` (still ≤ t) gives `wbgt >= wbgt(td) - 1e-6`.
  - `test_radiation_at_night_is_rejected`: sw = 300 at 22:00 UTC → NaN, reject `INCOHERENT_RADIATION`.
  - `test_nan_input_is_rejected`: one NaN in `td_c` → that element NaN with reject `NONFINITE_INPUT`; other elements computed.
- [ ] **Step 3: Run to verify they fail.**
- [ ] **Step 4: Implement** `solar.py` and `wbgt.py`.
- [ ] **Step 5: Run to verify they pass.** `uv run pytest tests/unit/physics -v`.
- [ ] **Step 6: Commit** `feat(physics): port solar geometry and Liljegren WBGT with input guards`.

---

### Task 7: Ports, fakes and contract suites

**Files:**
- Create: `ports/weather.py`, `ports/notifications.py`, `domain/risk/levels.py`, `adapters/fakes/weather.py`, `adapters/fakes/notifications.py`
- Test: `tests/unit/contract/observation_contract.py`, `forecast_contract.py`, `notification_contract.py`, `tests/unit/contract/test_fakes_satisfy_contracts.py`

**Interfaces:**
- Consumes: `Station`, `NwpModel`, schemas (Task 5).
- Produces:
  - `ports/weather.py`:
    `class ObservationSource(Protocol): name: str; async def observations(self, *, station: Station, start: datetime, end: datetime) -> pl.DataFrame` (returns `OBS_RAW_SCHEMA` rows with `start <= obs_time < end`; an empty window returns an empty frame with the schema, never raises).
    `class WeatherForecastSource(Protocol): async def previous_runs(self, *, station: Station, model: NwpModel, start: date, end: date, leads_days: Sequence[int]) -> pl.DataFrame` (returns `FORECAST_SCHEMA`; one row per `valid_time` x lead; `start` and `end` are inclusive UTC dates; missing upstream values are nulls).
  - `domain/risk/levels.py`: `class AlertLevel(StrEnum)`: `GREEN`, `AMBER`, `ORANGE`, `RED` (plan §8.4; B3 owns the thresholds).
  - `ports/notifications.py`: `class Audience(StrEnum)`: `SITE`, `CREW`; `class OutboundMessage(BaseModel)` (`frozen=True`, `extra="forbid"`): `site_id: str`, `audience: Audience`, `crew_id: str | None`, `level: AlertLevel`, `valid_from: AwareDatetime`, `template_id: str`; validator: `crew_id` required iff `audience == CREW`. `class DeliveryStatus(StrEnum)`: `DELIVERED`, `FAILED`, `SKIPPED`; `class DeliveryResult(BaseModel)` (frozen): `channel: str`, `status: DeliveryStatus`, `provider_message_id: str | None = None`, `detail: str | None = None`; `class NotificationChannel(Protocol): name: str; async def send(self, message: OutboundMessage) -> DeliveryResult` (never raises for delivery failures; returns `FAILED`).
  - Fakes: `InMemoryObservationSource(frames: Mapping[str, pl.DataFrame], name: str = "fake")` (keyed by ICAO), `InMemoryForecastSource(frames: Mapping[tuple[str, NwpModel], pl.DataFrame])`, `RecordingChannel()` with `sent: list[OutboundMessage]`, `FailingChannel(detail: str = "injected failure")`.
  - Contract suites as plain async functions, reused by Tasks 8-9 against the real adapters: `async def check_observation_source(source: ObservationSource, station: Station, start: datetime, end: datetime) -> None`, `async def check_forecast_source(source: WeatherForecastSource, station: Station, model: NwpModel, start: date, end: date, leads_days: Sequence[int]) -> None`, `async def check_notification_channel(channel: NotificationChannel, message: OutboundMessage, expect: DeliveryStatus) -> None`.

- [ ] **Step 1: Write failing tests** in `test_fakes_satisfy_contracts.py`, each calling the contract suite on the fake:
  - observation contract: schema conformance via `conform`; all `obs_time` in `[start, end)`; all `station == icao`; an empty window → `height == 0` with the full schema.
  - forecast contract: schema conformance; `set(lead_days) == set(leads_days)`; `valid_time` dates within `[start, end]`; `model` column equals the requested model value.
  - notification contract: `RecordingChannel.send(msg)` → `DELIVERED` and the message recorded; `FailingChannel.send(msg)` → `FAILED`, no exception.
  - `test_outbound_message_forbids_extra_fields`: `OutboundMessage(..., worker_id="w1")` raises `ValidationError`.
  - `test_crew_audience_requires_crew_id`: `audience=CREW, crew_id=None` raises `ValidationError`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** ports, levels, fakes, contract suites.
- [ ] **Step 4: Run to verify they pass**; `lint-imports` still keeps all contracts.
- [ ] **Step 5: Commit** `feat(ports): add weather and notification ports with fakes and contract suites`.

---

### Task 8: HTTP infrastructure and observation adapters (IEM truth, GHCNh audit)

**Files:**
- Create: `adapters/http/client.py`, `adapters/http/cache.py`, `adapters/sources/iem.py`, `adapters/sources/ghcnh.py`, fixtures `tests/fixtures/iem/OMAA_2025-07-01_03.csv`, `tests/fixtures/ghcnh/GHCNh_AEI0000OMAA_2025_0701-0703.parquet`
- Test: `tests/unit/adapters/test_http.py`, `test_iem.py`, `test_ghcnh.py`

**Interfaces:**
- Consumes: `Settings`, `Station`, `OBS_RAW_SCHEMA`, `check_observation_source` (Task 7).
- Produces:
  - `client.py`: `def build_async_client(settings: Settings, transport: httpx2.AsyncBaseTransport | None = None) -> httpx2.AsyncClient` (timeout `http_timeout_s`, `User-Agent` = `settings.http_user_agent`, default TLS verification); `class UpstreamError(Exception)` with `url: str`, `status: int | None`; `async def get_bytes(client: httpx2.AsyncClient, url: str, params: Sequence[tuple[str, str]], *, cache: RawResponseCache | None) -> bytes`: cache hit returns without a request; otherwise GET with `stamina` retry on `httpx2.TransportError` and on status 429/500/502/503/504 (attempts 6, total timeout 600 s); any other non-2xx raises `UpstreamError` without retry; a 2xx body is written to the cache before returning. Each call runs inside a manual OpenTelemetry span `http.get` with attributes `url.full` and `http.response.status_code`.
  - `cache.py`: `class RawResponseCache: def __init__(self, root: Path) -> None; @staticmethod def key(url: str, params: Sequence[tuple[str, str]]) -> str` (SHA-256 hex of `url` + canonical, order-preserving params); `def get(self, key: str) -> bytes | None`; `def put(self, key: str, body: bytes) -> Path` (atomic write via temp file + rename; layout `root/<key[:2]>/<key>.bin`).
  - `iem.py`: `class IemMetarSource` (`name = "iem"`): `__init__(self, client: httpx2.AsyncClient, base_url: str, cache: RawResponseCache | None)`. Request params, in this order: `station=<icao>`, `data=tmpf`, `data=dwpf`, `data=sknt`, `year1, month1, day1` from `start`, `year2, month2, day2` from `end`, `tz=Etc/UTC`, `format=onlycomma`, `latlon=no`, `elev=no`, `missing=empty`, `trace=T`, `direct=no`, `report_type=3`, `report_type=4`. Parse: `valid` (`%Y-%m-%d %H:%M`, UTC); `t_c = (tmpf - 32) * 5/9`; `td_c = (dwpf - 32) * 5/9`; `wind_ms = sknt * 0.514444`; empty or non-numeric → null; `qc_*` null; `source = "iem"`; keep rows with `start <= obs_time < end`.
  - `ghcnh.py`: `class GhcnhParquetSource` (`name = "ghcnh"`): same constructor. Downloads `{base_url}/{year}/parquet/GHCNh_{station.ghcnh_id}_{year}.parquet` once per year touched by `[start, end)` (HTTP 404 → empty result for that year, logged as a warning), reads with Polars from bytes, maps `DATE` → `obs_time` (UTC), `temperature` → `t_c`, `dew_point_temperature` → `td_c`, `wind_speed` → `wind_ms`, `*_Quality_Code` → `qc_t`, `qc_td`, `qc_wind` (cast to String), `source = "ghcnh"`. No filtering by QC here (Task 5 binning applies the policy).

- [ ] **Step 1: Record fixtures** (network, done once by the implementer; commit the files):
  - `curl -sS -o tests/fixtures/iem/OMAA_2025-07-01_03.csv "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=OMAA&data=tmpf&data=dwpf&data=sknt&year1=2025&month1=7&day1=1&year2=2025&month2=7&day2=3&tz=Etc%2FUTC&format=onlycomma&latlon=no&elev=no&missing=empty&trace=T&direct=no&report_type=3&report_type=4"`
  - Download `.../by-year/2025/parquet/GHCNh_AEI0000OMAA_2025.parquet` to a scratch directory outside the repo; with Polars keep rows whose `DATE` falls in 2025-07-01 00:00 to 2025-07-03 00:00 UTC (all columns), write to `tests/fixtures/ghcnh/GHCNh_AEI0000OMAA_2025_0701-0703.parquet` (must be under 500 KB).
  - Record in `tests/fixtures/README.md`: URL, access date, licence line (IEM public domain; NOAA NCEI GHCNh v1.1.0), and how the GHCNh file was trimmed.
- [ ] **Step 2: Write failing tests.**
  - `test_cache_hit_skips_network`: a `MockTransport` that fails the test if called; pre-populated cache → `get_bytes` returns the cached body.
  - `test_retries_429_then_succeeds`: transport returns 429 twice then 200 → body returned; `stamina.set_testing(True)` keeps it fast.
  - `test_404_raises_upstream_error_without_retry`: transport counts calls → exactly 1, `UpstreamError.status == 404`.
  - `test_iem_request_params_and_parse`: `MockTransport` asserts the exact ordered params and serves the CSV fixture; result passes `check_observation_source`; the first OMAA report's `t_c` equals `(tmpf - 32) * 5/9` from the fixture's first row (read the value from the CSV in the test, not hard-coded); `wind_ms` equals `sknt * 0.514444`.
  - `test_iem_empty_cells_become_null`: a modified copy of two CSV lines with empty `dwpf` → `td_c` null.
  - `test_ghcnh_maps_columns_and_keeps_qc_codes`: serves the trimmed parquet for URL `.../2025/parquet/GHCNh_AEI0000OMAA_2025.parquet`; passes the contract; `qc_td` dtype String; at least one row has a non-null `qc_t`.
  - `test_ghcnh_missing_year_is_empty`: 404 → empty frame with schema, warning logged.
- [ ] **Step 3: Run to verify they fail.**
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run to verify they pass** (`uv run pytest tests/unit/adapters -v`), mypy clean.
- [ ] **Step 6: Commit** `feat(adapters): add cached retrying HTTP client and IEM/GHCNh observation sources`.

---

### Task 9: Open-Meteo Previous Runs forecast adapter

**Files:**
- Create: `adapters/sources/open_meteo.py`, fixture `tests/fixtures/open_meteo/ifs025_OMAA_2025-07-01_02.json`
- Test: `tests/unit/adapters/test_open_meteo.py`

**Interfaces:**
- Consumes: `get_bytes`, `RawResponseCache` (Task 8); `FORECAST_SCHEMA`, `NwpModel` (Task 5); `check_forecast_source` (Task 7).
- Produces: `class OpenMeteoPreviousRunsSource` implementing `WeatherForecastSource`, `__init__(self, client: httpx2.AsyncClient, base_url: str, cache: RawResponseCache | None)`. Base variables `temperature_2m`, `dew_point_2m`, `wind_speed_10m`, `shortwave_radiation`, `direct_radiation`, `surface_pressure`; for each, lead 0 is the bare name and lead k ≥ 1 is `<var>_previous_day<k>`. Params, in order: `latitude`, `longitude` (station coordinates, 4 decimals), `models=<model>`, `timezone=UTC`, `start_date`, `end_date` (ISO dates), `hourly=<comma-joined names>`. **Wind is requested in the default km/h and divided by 3.6** (this reproduces the research's matched-pair MAEs exactly). Before parsing, assert `hourly_units`: temperature and dew point `°C`, wind `km/h`, radiation `W/m²`, pressure `hPa`; any mismatch raises `UpstreamError` with the offending unit. A variable missing from the response yields a null column (AIFS may lack some). `grid_lat`, `grid_lon`, `grid_elev_m` come from the response's `latitude`, `longitude`, `elevation`. A response body containing `"error": true` raises `UpstreamError` with the `reason`.

- [ ] **Step 1: Record the fixture**: `curl -sS -o tests/fixtures/open_meteo/ifs025_OMAA_2025-07-01_02.json "https://previous-runs-api.open-meteo.com/v1/forecast?latitude=24.4330&longitude=54.6511&models=ecmwf_ifs025&timezone=UTC&start_date=2025-07-01&end_date=2025-07-02&hourly=<the 48 names in base-variable order, lead 0..7>"`. Note the access date and "Open-Meteo free tier, data CC BY 4.0" in `tests/fixtures/README.md`.
- [ ] **Step 2: Write failing tests.**
  - `test_request_params_exact`: `MockTransport` asserts the ordered params and the 48 `hourly` names.
  - `test_parse_long_format`: result passes `check_forecast_source` for leads 0..7; `height == 48 * 8`; for one row the `t_c` equals the JSON value of `temperature_2m_previous_day3` at the same index, and `wind_ms == json_kmh / 3.6`.
  - `test_unit_mismatch_fails_loudly`: fixture copy with `wind_speed_10m` unit `m/s` → `UpstreamError` mentioning `wind_speed_10m`.
  - `test_missing_variable_is_null_column`: fixture copy without `direct_radiation*` keys → `direct_wm2` all null, other columns intact.
  - `test_error_body_raises`: status 400 with body `{"error": true, "reason": "Cannot initialize WeatherVariable from invalid String value"}` → `UpstreamError` whose message contains the reason, after exactly one request.
- [ ] **Step 3: Run to verify they fail.**
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run to verify they pass.**
- [ ] **Step 6: Commit** `feat(adapters): add Open-Meteo Previous Runs forecast source`.

---

### Task 10: Ingestion use cases, Parquet store, gold dataset build and the `sb-jobs` CLI

**Files:**
- Create: `application/ingest.py`, `application/dataset.py`, `adapters/storage/parquet_store.py`, `jobs/cli.py`
- Modify: `domain/weather/schemas.py` (add `GOLD_PAIRS_SCHEMA`), `backend/README.md` (jobs runbook)
- Test: `tests/unit/application/test_ingest.py`, `test_dataset.py`, `tests/unit/adapters/test_parquet_store.py`, `tests/integration/test_jobs_cli.py`

**Interfaces:**
- Consumes: ports and fakes (Task 7), adapters (Tasks 8-9), binning and `QcPolicy` (Task 5), `wbgt_liljegren` (Task 6), `JobRunRepository`, `advisory_lock`, `build_engine` (Task 3).
- Produces:
  - `application/ingest.py`: `async def fetch_hourly_observations(source: ObservationSource, station: Station, summer: int, qc_policy: QcPolicy) -> tuple[pl.DataFrame, BinningReport]` (fetch window `[15 May 00:00, 1 Oct 00:00)` UTC, then `bin_to_nearest_hour`, then restrict to `summer_window`); `async def fetch_forecasts(source: WeatherForecastSource, station: Station, model: NwpModel, summer: int) -> pl.DataFrame` (raises `ValueError` if `summer not in MODEL_SUMMERS[model]`; dates 15 May to 30 Sep; leads 0..7).
  - `application/dataset.py`: `def build_pairs(*, forecasts: pl.DataFrame, obs_iem: pl.DataFrame, obs_ghcnh: pl.DataFrame) -> pl.DataFrame` returning `GOLD_PAIRS_SCHEMA`; `def summarize_pairs(pairs: pl.DataFrame) -> DatasetSummary` (pydantic model: `pair_counts` list of `{model, summer, lead_days, joint, joint_daytime}`; `raw_errors` list of `{model, summer, lead_days, var, n, bias, mae, rmse}` for `var in {"t", "td", "ws"}` computed over rows where that variable's forecast and IEM observation are both non-null; `wbgt_rejects` mapping `column -> {reason_name: count}`).
  - `GOLD_PAIRS_SCHEMA` columns, one row per forecast row (all models, all leads, all summers):

| Group | Columns |
|---|---|
| Keys | `station`, `cluster`, `model`, `summer` (Int16), `valid_time`, `lead_days` (Int8), `hour_utc` (Int8), `doy` (Int16), `is_daytime` (Boolean) |
| Geometry | `station_elev_m`, `grid_lat`, `grid_lon`, `grid_elev_m` |
| Forecast | `fc_t_c`, `fc_td_c`, `fc_wind_ms`, `fc_sw_wm2`, `fc_direct_wm2`, `fc_pressure_hpa` |
| Reference (IFS lead 0, same station and hour) | `ref_sw_wm2`, `ref_direct_wm2`, `ref_pressure_hpa` |
| Truth (IEM, binned) | `obs_t_c`, `obs_td_c`, `obs_wind_ms`, `has_joint_obs` (Boolean: all three non-null) |
| Audit (GHCNh lenient, binned) | `audit_t_c`, `audit_td_c`, `audit_wind_ms` |
| WBGT (Task 6, station lat/lon, MIDPOINT) | `wbgt_obs_c` (obs T/Td/wind + ref radiation and pressure), `wbgt_fc_c` (forecast incl. its own radiation and pressure), `wbgt_fc_refrad_c` (forecast T/Td/wind + ref radiation and pressure), plus `wbgt_obs_reject`, `wbgt_fc_reject`, `wbgt_fc_refrad_reject` (Int8 `WbgtReject` codes; `summarize_pairs` counts them) |

  - `adapters/storage/parquet_store.py`: `class ParquetStore(root: Path)` with `write_observations(source: str, summer: int, icao: str, df) -> Path` (`root/silver/observations/<source>/<summer>/<icao>.parquet`), `read_observations(source: str) -> pl.DataFrame`, `write_forecasts(model: NwpModel, summer: int, icao: str, df) -> Path` (`root/silver/forecasts/<model>/<summer>/<icao>.parquet`), `read_forecasts() -> pl.DataFrame`, `write_gold(pairs, manifest: GoldManifest) -> Path` (`root/gold/pairs.parquet` + `root/gold/manifest.json`). Parquet with zstd; writes are atomic (temp + rename). `GoldManifest` (pydantic): `created_at`, `code_version` (`SB_GIT_SHA` env or `"unknown"`), `inputs: list[{path, sha256, rows}]`, `output: {path, sha256, rows}`, `summary: DatasetSummary`.
  - `jobs/cli.py`: Typer `app` with commands
    - `ingest-observations --source [iem|ghcnh] --summer INT (repeatable) [--station ICAO (repeatable, default all 8)]`
    - `ingest-forecasts --model [ecmwf_ifs025|gfs_seamless|ecmwf_aifs025_single] --summer INT (repeatable) [--station ICAO]`
    - `build-dataset`
    Each command: `configure_logging`; build adapters with `RawResponseCache(settings.data_dir / "bronze" / "http")`; inside `advisory_lock(engine, <command name>)`: if not acquired → `record_skipped`, log a warning, exit 0; else `start` → work (stations sequentially) → `finish("succeeded", summary)`; on exception → `finish("failed", None, repr(exc))`, exit code 1. Each ingest logs one line per station-summer with row counts and the `BinningReport`.

- [ ] **Step 1: Write failing tests.**
  - `test_fetch_hourly_observations_bins_and_windows` (fake source with reports at 14 May 23:50, 15 May 00:10 and 1 Oct 00:05): the 14 May 23:50 report is outside the fetch window and absent; output hours lie within `summer_window`.
  - `test_fetch_forecasts_refuses_aifs_2024`: `ValueError` mentioning `ecmwf_aifs025_single` and `2024`.
  - `test_build_pairs_joins_truth_audit_and_reference` (synthetic frames, 2 stations x 3 hours x leads 0-1, IFS and GFS): GFS rows carry IFS lead-0 `ref_*`; `has_joint_obs` false where any obs is null; `cluster` filled from `STATIONS`; `is_daytime` true exactly for hours 6-14.
  - `test_build_pairs_wbgt_columns`: `wbgt_obs_c` equals `wbgt_liljegren` called on obs + ref inputs for one row (atol 1e-9); a row with null obs has NaN `wbgt_obs_c`.
  - `test_summarize_pairs_counts_and_mae`: hand-built 4-row frame → expected `joint`, `joint_daytime`, `mae`, `bias`, `n`.
  - `test_parquet_store_round_trip_and_atomicity` (`tmp_path`): write/read observations and forecasts; `write_gold` produces a manifest whose `output.sha256` matches the file.
  - `test_cli_records_job_run` (`integration`, Postgres container, fake sources injected by monkeypatching `jobs.cli.build_sources`, Typer `CliRunner`): `ingest-observations --source iem --summer 2025 --station OMAA` exits 0, writes the silver file, and leaves one `job_run` row with status `succeeded`; a second invocation while the lock is held records `skipped_locked`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** The CLI builds real adapters by default; tests swap them through one factory function `jobs.cli.build_sources(settings) -> Sources` that tests monkeypatch.
- [ ] **Step 4: Run to verify they pass.** `uv run pytest -m "unit or integration" -v`.
- [ ] **Step 5: README runbook.** Add the exact command sequence for Task 11 (below) to `backend/README.md`.
- [ ] **Step 6: Commit** `feat(jobs): add ingestion, gold pair dataset build and sb-jobs CLI`.

---

### Task 11: Real-data run and dataset regression gate (controller step, needs network)

This task is run by the controller on Ali's machine, not by a subagent, because it calls live services (about 3,100 weighted Open-Meteo calls; run it **after 00:00 UTC on 12 Nov**, because the research used about 5,600 of the 10,000-per-day free allowance on 11 Nov).

**Files:**
- Create: `tests/regression/test_gold_dataset.py`
- Test: that file (markers `regression`, `slow`; CI deselects `regression`)

**Interfaces:**
- Consumes: `sb-jobs` (Task 10); `docs/research/scripts/results/baseline_errors_pooled.csv` (read directly by the test via `Path(__file__).parents[3] / "docs/research/scripts/results/baseline_errors_pooled.csv"`).

- [ ] **Step 1: Write the regression test** (fails now because no gold dataset exists):
  - `test_pair_counts_match_research`: for `model in {ecmwf_ifs025, gfs_seamless}` and every lead 0..7, `joint` per summer equals `{2024: 26608, 2025: 26413, 2026: 26633}` and `joint_daytime` equals `{2024: 9974, 2025: 9949, 2026: 9999}`; for `ecmwf_aifs025_single`, summers 2025 and 2026 with the same values (data doc §5.1).
  - `test_raw_errors_match_research`: for every row of the CSV (`model, year, lead_d, var, n, bias, mae, rmse`), the summary row with the same keys has identical `n` and `|mae - csv| <= 0.005`, `|bias - csv| <= 0.005`.
  - `test_wbgt_rejects_are_explained`: for each WBGT column and its `*_reject` column, among rows whose inputs are all non-null, the share with a reject code other than `NONFINITE_INPUT` is below 0.1% (thermofeel produced no NaN on 100,000 coherent inputs, stack doc §6.6); the test prints the first 10 such rows when it fails.
  - If `SB_DATA_DIR/gold/pairs.parquet` is absent, the module skips with reason "gold dataset not built"; Step 4 requires zero skips.
- [ ] **Step 2: Start Postgres and migrate** (`backend/README.md` commands): `docker run ... postgres:18.6`, `uv run alembic upgrade head`.
- [ ] **Step 3: Run the ingestion** from `backend/` (PowerShell):

```powershell
uv run sb-jobs ingest-observations --source iem --summer 2024 --summer 2025 --summer 2026
uv run sb-jobs ingest-observations --source ghcnh --summer 2024 --summer 2025 --summer 2026
uv run sb-jobs ingest-forecasts --model ecmwf_ifs025 --summer 2024 --summer 2025 --summer 2026
uv run sb-jobs ingest-forecasts --model gfs_seamless --summer 2024 --summer 2025 --summer 2026
uv run sb-jobs ingest-forecasts --model ecmwf_aifs025_single --summer 2025 --summer 2026
uv run sb-jobs build-dataset
```

  Expected: every command exits 0; a 429 burst is retried; if the daily allowance is exhausted, the command fails and re-running after the next 00:00 UTC resumes from the raw-response cache.
- [ ] **Step 4: Run the gate.** `uv run pytest -m regression -v -rs` → 3 passed, 0 skipped.
- [ ] **Step 5: If any assertion fails, stop.** Use superpowers:systematic-debugging on at least three station-summers before changing code; do not loosen a tolerance or edit the expected values. B2 does not start until this gate passes.
- [ ] **Step 6: Commit** the test and the manifest's summary (not the data): copy `data/gold/manifest.json` to `docs/research/2026-11-12-gold-dataset-manifest.json`; commit `test(regression): gate gold dataset on research pair counts and raw errors`.

---

### Task 12: NIOSH RAL/REL, clothing adjustments and metabolic conversions

**Files:**
- Create: `domain/physics/niosh.py`, `domain/physics/metabolic.py`
- Test: `tests/unit/physics/test_niosh.py`, `test_metabolic.py`

**Interfaces:**
- Produces:
  - `niosh.py`: `def rel_wbgt_c(metabolic_rate_w: ArrayLike) -> F64` (acclimatized, `56.7 - 11.5·log10(M)`), `def ral_wbgt_c(metabolic_rate_w: ArrayLike) -> F64` (unacclimatized, `59.9 - 14.1·log10(M)`); `M` must be finite and > 0, else `ValueError`. `class Clothing(StrEnum)`: `WORK_CLOTHES`, `CLOTH_COVERALLS`, `DOUBLE_LAYER_WOVEN`, `SMS_COVERALLS`, `POLYOLEFIN_COVERALLS`, `LIMITED_USE_VAPOR_BARRIER`; `CLOTHING_ADJUSTMENT_C: Final[Mapping[Clothing, float]]` = `{WORK_CLOTHES: 0.0, CLOTH_COVERALLS: 0.0, DOUBLE_LAYER_WOVEN: 3.0, SMS_COVERALLS: 0.5, POLYOLEFIN_COVERALLS: 1.0, LIMITED_USE_VAPOR_BARRIER: 11.0}` (NIOSH 2016 Table 3-2, current column, ACGIH-derived; docstring says so); `def effective_wbgt_c(wbgt_c: ArrayLike, clothing: Clothing) -> F64` (adds the adjustment).
  - `metabolic.py`: `W_PER_M2_PER_MET: Final = 58.2`; `def body_surface_area_dubois_m2(weight_kg: float, height_m: float) -> float` (`0.202·W^0.425·H^0.725`); `def met_to_watts(met: ArrayLike, bsa_m2: float) -> F64`; `def watts_to_met(watts: ArrayLike, bsa_m2: float) -> F64`.

- [ ] **Step 1: Write failing tests.**
  - `test_niosh_vectors`: parametrize `(180, 30.76, 28.10), (300, 28.21, 24.97), (415, 26.59, 22.99)`; `rel_wbgt_c(M) == approx(rel, abs=0.005)` and `ral_wbgt_c(M) == approx(ral, abs=0.005)` (NIOSH 2016 ch. 8.1; values from stack doc §6.4).
  - `test_limits_fall_with_workload` (hypothesis, M in [100, 1000]): both functions strictly decreasing; `ral < rel`.
  - `test_nonpositive_rate_rejected`: `rel_wbgt_c(0)` and `ral_wbgt_c(float("nan"))` raise `ValueError`.
  - `test_vapor_barrier_adds_eleven`: `effective_wbgt_c(28.0, LIMITED_USE_VAPOR_BARRIER) == 39.0`.
  - `test_dubois_vector`: `body_surface_area_dubois_m2(70, 1.75) == approx(1.8438, abs=0.0005)`.
  - `test_met_round_trip`: `watts_to_met(met_to_watts(2.5, 1.8), 1.8) == approx(2.5)`; `met_to_watts(1.0, 1.0) == 58.2`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** `feat(physics): add NIOSH RAL/REL, clothing adjustments and metabolic conversions`.

---

### Task 13: Thermal Work Limit (port of meteoHazard `solve_twl_single`)

**Files:**
- Create: `domain/physics/twl.py`, `tests/fixtures/twl/miller_bates_2007_table2.json`, `backend/THIRD_PARTY_NOTICES.md`
- Test: `tests/unit/physics/test_twl.py`

**Interfaces:**
- Consumes: `saturation_vapor_pressure_kpa`, `vapor_pressure_kpa_from_wet_bulb`, `dewpoint_c_from_vapor_pressure` (Task 5).
- Produces:
  - `@dataclass(frozen=True, slots=True) class TwlParams`: `clothing_clo: float = 0.6`, `vapor_permeability: float = 0.45`, `max_core_temp_c: float = 38.2`, `max_sweat_rate_kg_m2_h: float = 0.67`, `lewis_relation_k_per_kpa: float = 16.5`, `latent_heat_kj_kg: float = 2430.0` (meteoHazard defaults at the pinned commit).
  - `TWL_FLOOR_W_M2: Final = 60.0`, `TWL_CEILING_W_M2: Final = 380.0`.
  - `def twl_w_m2(*, t_c: float, td_c: float, wind_body_ms: float, pressure_kpa: float, mrt_c: float, params: TwlParams = TwlParams()) -> float` (scalar port of `solve_twl_single` + `three_zone_evaporation`; vapour pressure from dew point; result clamped to [floor, ceiling]; non-finite input → `math.nan`).
  - `def twl_w_m2_array(...) -> F64` (same keywords as arrays; loops the scalar).
  - `def body_level_wind_ms(wind_ms: ArrayLike, height_m: float = 10.0, z0_m: float = 0.01) -> F64` (`v·ln(1/z0)/ln(height/z0)`, then clipped to [0.2, 4.0]).
  - `def apply_withdrawal_limits(twl: ArrayLike, *, t_c: ArrayLike, natural_wet_bulb_c: ArrayLike | None) -> F64` (caps at 115 when `t_c > 44` or `natural_wet_bulb_c > 32`; docstring: "ported from meteoHazard; primary source not verified; B3 decides whether to apply", ADR 0006).

- [ ] **Step 1: Verify the licence before porting.** `curl -s https://raw.githubusercontent.com/vorpalvorpal/meteoHazard/5633d5719225d15d84f2608189e2b3d654dba73d/LICENSE` must print the CRAN MIT stub (`YEAR: 2026`, `COPYRIGHT HOLDER: TWL authors`) and `DESCRIPTION` at the same commit must contain `License: MIT + file LICENSE`. If either differs, **stop and report**; the fallback is implementing from the published equations, which needs Ali's decision.
- [ ] **Step 2: Read the reference** at the pinned commit: `R/solve_twl.R`, `R/constants.R`, `R/psychrometrics.R`, and the wind-height section of `R/generate_twl.R`. Write `THIRD_PARTY_NOTICES.md` with the MIT notice, the repo URL, the commit SHA, and the note that its DOI is wrong (the paper is `10.1080/104732202753438261`).
- [ ] **Step 3: Write the fixture** `miller_bates_2007_table2.json` with the 11 rows below (Miller & Bates 2007, *Ann Occup Hyg* 51(6):553-561, Table 2, session means; 0.12 clo per the table note; chamber, so `mrt_c = t_c`, sea-level 101.3 kPa, wind used as body-level wind without height correction) and, per row, the output of an independent scratch port run on 2026-11-11 (`scratch_port_w_m2`, WMO psychrometer conversion of the wet bulb, `vapor_permeability = 0.45`):

| session | t_c | twb_c | wind_ms | published_twl | scratch_port_w_m2 |
|---|---|---|---|---|---|
| 1 | 38.7 | 28.6 | 0.23 | 154 | 160.2 |
| 2 | 38.4 | 28.7 | 0.24 | 156 | 162.9 |
| 3 | 39.0 | 28.1 | 0.23 | 160 | 165.6 |
| 4 | 38.9 | 27.6 | 0.21 | 160 | 166.3 |
| 5 | 38.7 | 25.0 | 0.22 | 198 | 201.9 |
| 6 | 38.1 | 27.9 | 0.21 | 159 | 166.0 |
| 7 | 39.1 | 27.3 | 0.24 | 172 | 178.7 |
| 8 | 38.6 | 27.3 | 0.22 | 168 | 174.6 |
| 9 | 38.3 | 27.2 | 0.20 | 164 | 170.5 |
| 10 | 38.3 | 27.6 | 0.21 | 162 | 168.9 |
| 11 | 38.2 | 28.4 | 0.22 | 156 | 162.1 |

- [ ] **Step 4: Write failing tests.**
  - `test_matches_miller_bates_within_8`: for each row, `e = vapor_pressure_kpa_from_wet_bulb(t, twb, 1013.0)`, `td = dewpoint_c_from_vapor_pressure(e)`, `twl = twl_w_m2(t_c=t, td_c=td, wind_body_ms=wind, pressure_kpa=101.3, mrt_c=t, params=TwlParams(clothing_clo=0.12))`; `abs(twl - published) <= 8.0` (the reference port's measured max deviation is 6.5-7.0 W/m², ADR 0006); collect and print the residual table.
  - `test_agrees_with_independent_port`: `abs(twl - scratch_port_w_m2) <= 1.0` for every row.
  - `test_bias_direction_is_documented`: mean of `twl - published` lies in `[3.0, 8.0]` (a change of sign or size means the port changed; update ADR 0006 before touching this test).
  - `test_more_humid_means_lower_twl` (hypothesis): t in [30, 46], wind in [0.3, 3], td_low < td_high ≤ t - 2 → `twl(td_high) <= twl(td_low) + 1e-6`.
  - `test_clamped_to_floor_and_ceiling`: very hot humid (t=50, td=35, wind 0.2) → `>= 60`; cool windy (t=20, td=5, wind 4) → `<= 380`.
  - `test_body_level_wind_factor`: `body_level_wind_ms(3.0) == approx(3.0 * math.log(100) / math.log(1000), rel=1e-12)` (≈ 2.0); `body_level_wind_ms(0.1) == 0.2`.
  - `test_withdrawal_limits_cap_at_115`: `apply_withdrawal_limits([200, 200, 200], t_c=[45, 40, 40], natural_wet_bulb_c=[25, 33, 25])` → `[115, 115, 200]`.
- [ ] **Step 5: Run to verify they fail.**
- [ ] **Step 6: Implement** the port, keeping a comment per equation with the reference's citation (ASHRAE / EESAM equation numbers as in the R source).
- [ ] **Step 7: Run to verify they pass**; write the residual table into the `twl.py` module docstring.
- [ ] **Step 8: Commit** `feat(physics): port Thermal Work Limit solver with Miller & Bates 2007 vectors`.

---

### Task 14: PHS (ISO 7933) behind validation and a process-isolated timeout

**Files:**
- Create: `domain/physics/phs.py`, `adapters/compute/phs_process.py`
- Modify: `backend/Dockerfile` (warm the numba cache at build), `pyproject.toml` (`pythermalcomfort` already in the mypy override)
- Test: `tests/unit/physics/test_phs_validation.py`, `tests/unit/adapters/test_phs_process.py`

**Interfaces:**
- Consumes: `Settings.phs_timeout_s`.
- Produces:
  - `domain/physics/phs.py` (pure): `class PhsInputs(BaseModel)` (frozen, extra forbid): `tdb_c`, `tr_c`, `v_ms`, `rh_pct`, `met`, `clo`, `posture: Literal["sitting","standing","crouching"] = "standing"`, `weight_kg: float = 75.0`, `height_m: float = 1.8`; `class PhsResult(BaseModel)`: `t_re_c`, `d_lim_t_re_min`, `d_lim_loss_50_min`, `d_lim_loss_95_min`, `sweat_loss_g`; `class PhsRejected(BaseModel)`: `reason: Literal["invalid_input","out_of_scope","timeout","nan_output","implausible_output","worker_crashed"]`, `detail: str`; `PhsOutcome = PhsResult | PhsRejected`; `def validate_phs_inputs(i: PhsInputs) -> PhsRejected | None` (all finite and `weight_kg, height_m, clo > 0` else `invalid_input`; window `15 < tdb < 50`, `0 < tr - tdb < 60`, `0 < v < 3`, `0.1 < clo < 1`, `0.96 <= met <= 4.3` else `out_of_scope`; stack doc §6.3); `def check_phs_output(r: PhsResult) -> PhsRejected | None` (any NaN → `nan_output`; `t_re_c` outside [36, 42] → `implausible_output`).
  - `adapters/compute/phs_process.py`: `class PhsRunner` (`__init__(self, timeout_s: float)`, `run(self, inputs: PhsInputs) -> PhsOutcome`, `close(self) -> None`, context manager). One long-lived worker process (`multiprocessing.get_context("spawn")`) receives kwargs over a `Pipe` and calls `pythermalcomfort.models.phs(..., model="7933-2023")`; the parent waits with `conn.poll(timeout_s)`; on timeout it kills the worker, returns `PhsRejected(reason="timeout")`, and starts a fresh worker on the next call; a dead worker returns `worker_crashed`. `run` validates first and never sends invalid inputs. `_execute(self, kwargs: Mapping[str, float | str]) -> PhsOutcome` sends raw kwargs without validation (used by `run` after validation and by the hang test). `def warm() -> None` runs one valid call in-process to populate the numba cache.

- [ ] **Step 1: Confirm the library signature.** `uv run python -c "import inspect, pythermalcomfort.models as m; print(inspect.signature(m.phs)); print(m.phs.__doc__)"`; map `weight_kg`/`height_m` to the documented keyword names. If the names differ from `weight`/`height`, use the documented ones and say so in the docstring.
- [ ] **Step 2: Write failing tests.**
  - `test_nan_rejected_before_kernel`: `PhsInputs(tdb_c=nan, ...)` → `validate_phs_inputs` returns `invalid_input`.
  - `test_out_of_window_rejected`: `tdb_c=52` → `out_of_scope`; `met=5.0` → `out_of_scope`; `tr_c == tdb_c` → `out_of_scope`.
  - `test_zero_height_rejected`: `height_m=0` → `invalid_input` (the kernel would raise `SystemError`).
  - `test_valid_call_returns_result` (`slow`): `PhsRunner(timeout_s=60).run(PhsInputs(tdb_c=40, tr_c=45, v_ms=0.3, rh_pct=33, met=2.5, clo=0.5))` → `PhsResult` with `36 <= t_re_c <= 42`. Record the returned values into the test as a golden regression guard (`approx(rel=1e-6)`) with a comment "pythermalcomfort 4.8.1 output; a bump that changes it needs review". If 4.8.1 returns NaN for this input (about 19.6% of in-window inputs do, stack doc §6.3), stop and report the input rather than picking another one silently.
  - `test_real_nan_hang_is_cut_by_timeout` (`slow`): with a warmed runner (`timeout_s=10`), `runner._execute({...valid kwargs..., "tdb": float("nan")})` returns `PhsRejected(reason="timeout")` within 30 s, and a following valid `run(...)` succeeds (fresh worker). This exercises the real upstream hang (#524), not a fake.
  - `test_implausible_output_rejected`: `check_phs_output(PhsResult(t_re_c=43.5, ...))` → `implausible_output`.
- [ ] **Step 3: Run to verify they fail.**
- [ ] **Step 4: Implement.** Wrap the `pythermalcomfort` import in `phs_process.py` only (typed facade; the mypy override exists).
- [ ] **Step 5: Dockerfile warm-up.** In the runtime stage, as uid 10001: `RUN python -c "from stellar_blaze.adapters.compute.phs_process import warm; warm()"` so `/app/.numba-cache` is populated in the image. Rebuild and confirm `docker run --rm stellar-blaze-api:dev ls /app/.numba-cache` is non-empty.
- [ ] **Step 6: Run to verify they pass.** `uv run pytest tests/unit -m "unit" -v` (the `slow` ones included locally).
- [ ] **Step 7: Commit** `feat(physics): guard ISO 7933 PHS with validation and a process timeout`.

---

## Exit criteria for B1

- CI `backend` job green on the main branch.
- Task 11 gate: `uv run pytest -m regression -v -rs` → 3 passed, 0 skipped, on the real dataset; manifest copied to `docs/research/2026-11-12-gold-dataset-manifest.json`.
- `docker run` of the image answers `/api/v1/health/live` and, with a database, `/api/v1/health/ready`.
- Physics: WBGT golden + pvlib oracle, NIOSH vectors, TWL Miller & Bates vectors, PHS hang test: all pass.
- Parking-lot entries in `docs/parking-lot.md` unchanged or extended (nothing silently dropped).

## Ordering and parallelism

Sequential by default (each task's reviewer gate before the next). Tasks 12-14 depend only on Task 5 and may run in parallel with Tasks 7-11 under the controller-commit protocol (implementers do not commit; the controller commits after review), because they touch disjoint files. Task 11 must pass before B2 starts; Tasks 12-14 may spill into 13 Nov alongside B2.
