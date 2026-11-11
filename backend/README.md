# Stellar Blaze backend

FastAPI service and batch jobs for the Stellar Blaze heat-stress early-warning system. Hexagonal layout under `src/stellar_blaze/`: a pure `domain/` (weather, physics), `ports/` (Protocols), `adapters/` (HTTP sources, Parquet store, Postgres, fakes), `application/` (use cases), `api/` (FastAPI) and `jobs/` (Typer CLI). `import-linter` enforces the layer boundaries. The decisions behind the stack are in [`docs/decisions/0008-backend-stack.md`](../docs/decisions/0008-backend-stack.md).

## Prerequisites

- [uv](https://docs.astral.sh/uv/) **0.13.7** (`uv self update 0.13.7`; CI and the Docker image pin the same version). uv installs Python 3.13 from `.python-version`.
- Docker, for the local Postgres and the integration tests (testcontainers).

## Setup

```bash
cd backend
uv sync                 # default groups: dev + train
```

Install the git hooks once per clone (from the repository root):

```bash
uv run --project backend pre-commit install
```

## Tests

Every test carries exactly one tier marker. Unit tests never touch the network (pytest-socket allows only loopback).

```bash
uv run pytest -m unit           # no network, no Docker; includes the PHS worker-process tests (about a minute)
uv run pytest -m "unit and not slow"   # the quick loop
uv run pytest -m integration    # needs Docker (Postgres 18.6 via testcontainers, one migrated database per test)
uv run pytest -m regression     # real-data gate (slow; added with the dataset task)
uv run pytest -m e2e            # end to end
uv run pytest -m "not slow"     # everything except tests over 5 s
```

## Quality gates

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy src tests           # strict, with the pydantic plugin
uv run lint-imports             # layer and purity contracts
uv run deptry src               # unused, missing and transitive dependencies
```

## Configuration

All settings are `SB_*` environment variables (typed in `src/stellar_blaze/config.py`). Copy `.env.example` to `.env` for local development; `SB_DATABASE_URL` is the only required one. Tracing stays off until the standard `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

```bash
uv run uvicorn stellar_blaze.api.app:create_app --factory --reload    # http://127.0.0.1:8000/api/v1/health/live
```

## Rulesets, models and the runtime config

Policy values are data (ADR 0009, ADR 0010); the process loads them once at startup in `composition.build_runtime`, and any error there fails startup.

- **Rulesets** (`rulesets/<id>.toml`, schema in `domain/rules/ruleset.py`): legal floors (ADOSH zone edges, withdrawal limits, NIOSH Table 3-2 clothing adjustments), cited sources, and the reviewed range of each tunable. A **released** ruleset is immutable: `rulesets/lock.json` holds the SHA-256 of its bytes (`sha256sum rulesets/<id>.toml`; the files are LF), and a changed byte fails startup. To change one, add a new file with a new id and `supersedes = ["<old id>"]`, its `tests/fixtures/rulesets/<id>.golden.json`, and its lock entry; the old file stays pinnable for audit replay. Drafts load only outside `SB_ENV=prod`. The ruleset in force is the one covering the Asia/Dubai local date; a date no ruleset covers is an error, never a default.
- **Models** (`models/<model_id>/manifest.json` + artifacts): every file's hash is verified at startup. `models/` is empty until B2.
- **Runtime config** (`config/runtime/default.toml`, schema in `domain/config/runtime.py`): the ruleset pin, the active model id, the tunables and the flags that may change without a release. Legal floors cannot be set here. In B1 this file is the initial snapshot; `SB_RULESET_ID` and `SB_MODEL_ID` pin a ruleset or model for back-tests and runs without a database, and are refused with `SB_ENV=prod`. Handlers read the snapshot through `Depends(get_snapshot)`.

## OpenAPI snapshot

`openapi/v1.json` is the committed API contract (ADR 0009 section 5); a unit test fails when it drifts from the app. After changing a route or a response model:

```bash
uv run python -m stellar_blaze.api.export_openapi openapi/v1.json
```

## Local Postgres and migrations

```bash
docker run -d --name sb-db -p 5432:5432 -e POSTGRES_USER=sb -e POSTGRES_PASSWORD=sb -e POSTGRES_DB=stellar_blaze postgres:18.6
uv run alembic upgrade head          # reads SB_DATABASE_URL (see .env.example)
uv run alembic check                 # fails when the models in adapters/db/tables.py and the schema disagree
```

New migration (the template adds the lock and statement timeouts every migration must start with; revision ids are
zero-padded and sequential):

```bash
uv run alembic revision --autogenerate --rev-id 0002 -m "add sites"   # then review and edit the generated file
```

Lint what would run in production with Squawk (Git-Bash), rendering the SQL to a temporary file, never into the
repository. `.squawk.toml` holds the one excluded rule and why; Alembic logs to stderr, so stdout is pure SQL:

```bash
SQL=$(mktemp)
SB_DATABASE_URL=postgresql+asyncpg://x:x@localhost/x uv run alembic upgrade head --sql > "$SQL"
uv run squawk "$SQL"
rm -f "$SQL"
```

`GET /api/v1/health/ready` answers 200 when the database answers `SELECT 1` within `SB_READINESS_TIMEOUT_S` and 503
(problem details, `dependency: database`) otherwise; `GET /api/v1/health/live` never looks at the database. The
application creates its engine in the FastAPI lifespan, so the API starts even while the database is down.

## Container image

`Dockerfile` builds the API image from this directory (context `backend/`). The base image and uv are pinned by digest;
`rulesets/` and `models/` ship inside the image (ADR 0009), the app runs as uid 10001 with `/app` as its working
directory, and `/app/.numba-cache` is the only writable path. The build warms that cache for the PHS heat-strain
kernel as the app user (`warm()` in `adapters/compute/phs_process.py`), so a fresh container does not recompile it, and
`THIRD_PARTY_NOTICES.md` ships in `/app`.

```bash
docker build -t stellar-blaze-api:dev .
docker run --rm -p 8000:8000 -e SB_DATABASE_URL=postgresql+asyncpg://sb:sb@host.docker.internal:5432/stellar_blaze stellar-blaze-api:dev
curl -s localhost:8000/api/v1/health/live        # {"status":"ok"}

# the migration job runs the same image:
docker run --rm -e SB_DATABASE_URL=... stellar-blaze-api:dev alembic upgrade head
```

CI (`.github/workflows/ci.yml`, job `backend`) runs every gate above on Python 3.13.15 (the interpreter the image ships)
plus the pre-commit hooks, a gitleaks scan of the full git history, Squawk, `pip-audit`, an `oasdiff` report on
`openapi/v1.json`, and builds and smoke-tests this image.

## Jobs

`sb-jobs` (Typer, `uv run sb-jobs --help`) builds the hindcast dataset that B2 trains on: observed truth, archived
forecasts, and the joined "gold" pair dataset. The research it must reproduce is in
[`docs/research/2026-11-11-data-availability.md`](../docs/research/2026-11-11-data-availability.md) (§5.1 for the pair
counts) and [ADR 0005](../docs/decisions/0005-data-truth-features-and-validation.md).

| Command | What it does |
|---|---|
| `ingest-observations --source iem\|ghcnh --summer YEAR ... [--station ICAO ...]` | Pulls the station's reports for 15 May 00:00 to 1 Oct 00:00 UTC, bins them to the nearest UTC hour (IEM: no QC codes; GHCNh: lenient, code `1` or blank), keeps the bins of 15 May 00:00 to 30 Sep 23:00, and stores them with what binning discarded. |
| `ingest-forecasts --model ecmwf_ifs025\|gfs_seamless\|ecmwf_aifs025_single --summer YEAR ... [--station ICAO ...]` | Pulls the model's Previous Runs forecasts (15 May to 30 Sep, leads 0 to 7 days, six variables) at the station's coordinates. AIFS has 2025 and 2026 only; another summer is a usage error (exit 2) before any request. |
| `build-dataset` | Joins every silver file into `gold/pairs.parquet` and writes `gold/manifest.json`. |

`--summer` repeats; `--station` repeats and defaults to the eight core stations (`OMAA OMAD OMAL OMDB OMSJ OMDW OMFJ
OMRK`). Stations and summers run one after another; the first failure stops the command, what was stored before it
stays, and a rerun refetches nothing that the raw-response cache holds.

Every command records a row in `job_run` (name, parameters, `SB_GIT_SHA`, status, a summary or the error) and takes a
Postgres advisory lock named after the command and what it works on: `ingest-observations:iem`,
`ingest-observations:ghcnh`, `ingest-forecasts:<model>`, `build-dataset`. A second run of the same thing while one is
active records `skipped_locked` (under the command's name) and exits 0, so a script that must not miss an ingest should
check `job_run` rather than the exit code alone; runs of different sources or models may overlap. Exit codes: 0
succeeded or skipped, 1 failed (`job_run.error` is `<ExceptionType>: <message>` with credentials masked), 2 usage or
configuration error (nothing recorded). The last runs:
`SELECT job_name, status, started_at, error FROM job_run ORDER BY started_at DESC LIMIT 10;`.

Log lines never carry a credential: the shared logging chain renders every exception itself and masks URL credentials,
`password=`/`token=` pairs, `Authorization` headers, bearer tokens and cookies in the message, the traceback and the stack
(`redaction.redact`, `logging.redact_exceptions`). The JSON `exception` field is that redacted traceback as text.

### Where the files go

Under `SB_DATA_DIR` (default `data`, so `backend/data/`, git-ignored). Writes are atomic (a temporary file in the same
directory, then a rename): a failed write leaves the previous file intact and no temporary file.

```text
bronze/http/<ab>/<sha256>.bin                                raw upstream responses, one per request (the cache)
silver/observations/<source>/<summer>/<ICAO>.parquet         hourly t_c, td_c, wind_ms of one station-summer
silver/observations/<source>/<summer>/<ICAO>.binning.json    what binning discarded: n_raw, n_implausible, n_qc_flagged
silver/forecasts/<model>/<summer>/<ICAO>.parquet             forecasts at leads 0-7 with the grid cell
gold/pairs.parquet                                           one row per forecast row: truth, audit, reference, WBGT
gold/manifest.json                                           inputs (path, sha256, rows), output, summary, code version
```

**The raw-response cache never expires and is not re-validated on read.** A directory that already holds responses is a
snapshot of the day they were fetched, and a window that reaches "now" (a summer still in progress) stays as it was. For
a clean rebuild, point `SB_DATA_DIR` at a new directory.

### What the gold dataset holds

`GOLD_PAIRS_SCHEMA` (`domain/weather/schemas.py`) lists the columns: keys, grid geometry, forecast (`fc_*`), the IFS
lead-0 radiation and pressure at the same station and hour (`ref_*`), the IEM truth (`obs_*`), the GHCNh audit values
(`audit_*`) and three WBGT variants with their reject codes (Liljegren, mid-point of the preceding hour, at the
station's coordinates).

- `joint` (a pair that counts) is `has_joint_obs` (observed temperature, dew point and wind all present) **and** the
  forecast's `fc_t_c`, `fc_td_c` and `fc_wind_ms` all present. This is the research's `pairs_joint` (`match_pairs.py`);
  `has_joint_obs` alone would ignore the forecast side. `joint_daytime` is `joint` and `is_daytime` (06:00 to 14:59 UTC).
- `wbgt_obs_c` is Liljegren of the observed temperature, dew point and wind with the IFS lead-0 radiation and pressure;
  `wbgt_fc_c` of the forecast alone; `wbgt_fc_refrad_c` of the forecast temperature, dew point and wind with the same
  IFS lead-0 radiation and pressure. **A rejected WBGT is NaN, not null** (it is numpy output, and Polars treats the two
  differently: a mean over the column is NaN, not the average of the rest). `*_reject` is the `WbgtReject` code, so
  filter on `wbgt_*_reject == 0`. A temperature or dew point outside -60 to 70 degrees, a pressure at or below 0 and a
  negative wind are made missing before the solver (the row is rejected as `NONFINITE_INPUT`); the `fc_*` and `obs_*`
  columns keep the value.
- Values that binning excluded (outside the plausibility range, or a GHCNh value with a QC flag) are null in `obs_*` and
  `audit_*` and are counted per source, station and summer in `manifest.json` under `summary.observation_qc`. ADR 0005
  says QC-flagged rows are "kept and flagged"; what is built is "excluded and counted", which keeps the research's
  counts, and the ADR text should say so.
- `summary.pair_counts` and `summary.raw_errors` are keyed `model, summer, lead_days` (and `var`); the research CSV
  `baseline_errors_pooled.csv` is keyed `model, year, lead_d, var`. `domain.weather.dataset.RESEARCH_CSV_KEYS` maps
  `year -> summer` and `lead_d -> lead_days`. `summarize_pairs(pl.read_parquet("gold/pairs.parquet"))` recomputes the
  summary from the dataset itself, so a check need not trust `manifest.json`.
- `manifest.json` holds paths relative to `SB_DATA_DIR`, in POSIX form. Export `SB_GIT_SHA` so that `code_version` is
  not `unknown`.

### Fetch windows, pacing and limits

- Observations are fetched for `[15 May 00:00, 1 Oct 00:00)` UTC, the research's IEM download, and binned from there. The
  research read GHCNh's whole-year files, so its 15 May 00:00 audit bin could include a report from 14 May 23:30 to
  23:59; here that report is not fetched. On the research's own files 1 cell of 476,991 compared differs (OMFJ 2026,
  wind at 15 May 00:00: 6.2 against 5.7 m/s). It touches the audit columns only, which no gate checks.
- Requests that reach a service are spaced: `SB_IEM_REQUEST_INTERVAL_S` (2 s) and `SB_OPEN_METEO_REQUEST_INTERVAL_S` (6
  s; a 139-day request for 48 series weighs about 48 of the free tier's 600 weighted calls a minute). A cache hit is not
  a request and is not delayed. A 429 or 5xx is retried (6 attempts within 10 minutes, backing off exponentially from 1 s).
- An IEM, GHCNh or Open-Meteo request may take up to 180 s to answer (the research scripts that downloaded exactly
  these requests all used `timeout=180`); `SB_HTTP_TIMEOUT_S` is the client default for any other call.
- Open-Meteo's free tier allows 10,000 weighted calls a day and the full pull below is about 3,100. If the allowance
  runs out the command fails; run it again after 00:00 UTC and it resumes from the cache.

### The real-data run (Task 11)

From `backend/`, in PowerShell, with Postgres running and migrated (see *Local Postgres and migrations*):

```powershell
$env:SB_DATABASE_URL = "postgresql+asyncpg://sb:sb@localhost:5432/stellar_blaze"
$env:SB_GIT_SHA = (git rev-parse --short HEAD)       # recorded in job_run and in the manifest
# $env:SB_DATA_DIR = "data-2026-11-12"               # a fresh directory for a clean rebuild (the cache never expires)

uv run alembic upgrade head
uv run sb-jobs ingest-observations --source iem --summer 2024 --summer 2025 --summer 2026
uv run sb-jobs ingest-observations --source ghcnh --summer 2024 --summer 2025 --summer 2026
uv run sb-jobs ingest-forecasts --model ecmwf_ifs025 --summer 2024 --summer 2025 --summer 2026
uv run sb-jobs ingest-forecasts --model gfs_seamless --summer 2024 --summer 2025 --summer 2026
uv run sb-jobs ingest-forecasts --model ecmwf_aifs025_single --summer 2025 --summer 2026
uv run sb-jobs build-dataset
```

Every command must exit 0 (`$LASTEXITCODE`). `build-dataset` runs the WBGT solver over about 1.7 million rows and takes
about 2 minutes (122 s on a laptop, 1,708,032 rows with radiation present). A `--station OMAA` run of each command is a
quick trial of the whole chain. The pair counts and raw errors that `build-dataset` writes into `manifest.json` match the
research's (`pair_counts.csv`, `baseline_errors_pooled.csv`) to floating-point rounding (about 1e-15). That was checked
offline by serving the research's own downloads through the real adapters and job bodies.
