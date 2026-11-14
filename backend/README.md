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

- **Rulesets** (`rulesets/<id>.toml`, schema in `domain/rules/ruleset.py`): legal floors (ADOSH zone edges, withdrawal limits, NIOSH Table 3-2 clothing adjustments), cited sources, and the reviewed range of each tunable. A **released** ruleset is immutable: `rulesets/lock.json` holds the SHA-256 of its bytes (`sha256sum rulesets/<id>.toml`; the files are LF), and a changed byte fails startup. To change one, add a new file with a new id and `supersedes = ["<old id>"]`, its `tests/fixtures/rulesets/<id>.golden.json`, and its lock entry. The old file stays loaded and can be found by id (audit replay through the catalog), but once the `Tunables` model has fields it does not declare it can no longer be pinned or used to resolve a config: the failure is one `unknown-tunable` ("has no default in ruleset") violation per missing tunable (`ae-heat-0.1` is in this state since `ae-heat-2026.1`; parking lot). Drafts load only outside `SB_ENV=prod`. The ruleset in force is the one covering the Asia/Dubai local date; a date no ruleset covers is an error, never a default.
- **Models** (`models/<model_id>/manifest.json` + artifacts): every file's hash is verified at startup. `models/` is empty until B2.
- **Runtime config** (`config/runtime/default.toml`, schema in `domain/config/runtime.py`): the ruleset pin, the active model id, the tunables and the flags that may change without a release. Legal floors cannot be set here. The file is the git default: `sb-jobs config seed` stores it in the database as the first version, and the database decides what is active from then on (see *Runtime config in the database* below). `SB_ENV=prod` starts from the database only; outside prod the file is the first snapshot until the database has an activation. `SB_RULESET_ID` and `SB_MODEL_ID` pin a ruleset or model for runs without a database, and are refused with `SB_ENV=prod`; a ruleset can be pinned only if it declares every tunable of the `Tunables` model (`ae-heat-2026.1` does, `ae-heat-0.1` no longer does). Handlers read the snapshot through `Depends(get_snapshot)`.

## Runtime config in the database

Operating values change without a release (ADR 0010). A **version** (`config_version`) is one validated config body, immutable, with its SHA-256, who proposed it and why. The **activation log** (`config_activation`) is append-only; the active version is the latest entry's. Both tables reject UPDATE, DELETE and TRUNCATE (triggers, migration `0002`). Each activation names the one it replaces and Postgres admits one successor per activation (`UNIQUE NULLS NOT DISTINCT`), so two people activating at once cannot both win: the second gets `stale` (exit 1) and decides again. There is no lock.

```bash
uv run sb-jobs config validate proposal.toml                 # offline, against this release's rulesets and models
uv run sb-jobs config propose proposal.toml --actor ali --reason "B3 margin trial"        # stores version N, activates nothing
uv run sb-jobs config activate N --actor ali --reason "start the margin trial"            # running processes follow within SB_CONFIG_POLL_INTERVAL_S (5 s)
uv run sb-jobs config rollback --actor ali --reason "revert the margin trial" [--expected-previous ID]   # re-activates the version that was active before
uv run sb-jobs config show                                    # the active version: activation, hash, body (JSON)
uv run sb-jobs config history --limit 20                      # newest first, one JSON object per line
```

`proposal.toml` has the shape of `config/runtime/default.toml` (`[tunables]`, `[flags]`, optional `ruleset_pin` and `model_id`); a tunable outside the range its ruleset declares, an unknown key (a legal floor, for instance), an unknown model or, in prod, a pin that is not released, does not cover today or is less protective than the ruleset in force is refused with its code and path (exit 1). Every write needs `--actor` and a `--reason` of 10 to 500 characters (exit 2 otherwise). `activate` and `rollback` default `--expected-previous` to the latest activation they read; pass the one you saw to make a stale change fail instead (`rollback` sent twice, or by two people at once, with the same `--expected-previous` rolls back once; the second is `stale`, exit 1). A rollback activates the version of the activation before the latest, so a second rollback undoes the first; both are `kind="rollback"` entries in the history, and a rollback is validated like any other activation. It is refused (exit 1) when the previous activation holds the version that is already active, because it would change nothing. **B3's HTTP rollback route must require `expected_previous`**: the command line may default it because its operator reads the history first, a route acting on a view it showed someone may not. The first activation ever is recorded as `kind="seed"`.

- **`sb-jobs db upgrade`** runs `alembic upgrade head` and then `config seed`; this is what the migration job runs. Run it from the directory that holds `alembic.ini` and `alembic/` (`backend/`; `/app` in the image). It validates the seed file before it migrates, never replaces a config that is already active (the seed only activates when nothing was ever activated), and is re-runnable; the seed step is race-safe (two runs cannot both activate it), but do not run two migrations at once: Alembic takes no lock of its own. The seed's actor is `seed:<SB_GIT_SHA>` (`seed:local` outside a release). **Deploy coupling:** push this together with I1 Task 7 Step 1b (`job-migrate` runs `sb-jobs db upgrade` instead of `alembic upgrade head`); an API revision with this code but no migrated database starts, and reports not ready (below).
- **Startup and following.** With `SB_ENV=prod` the lifespan reads the active version once before serving. A database that is down, or nothing seeded, does not stop startup: `/health/live` answers, `/health/ready` is 503 with `dependency: config` (decision routes answer the same 503), and the config loads as soon as it exists. The cause of a failed startup read is logged once, as `config.startup_load_failed`, with the exception type, its message and the cause it was raised from, credentials masked. Outside prod the file snapshot serves until the first poll finds an activation, which then replaces it. A snapshot built from `SB_RULESET_ID` / `SB_MODEL_ID` (`source="env"`, for back-tests and runs without a database, ADR 0010 section 4.6) is never replaced: the poller does not read the database and logs `config.db_activations_ignored` once, at startup; unset the pins to follow the database. Every `SB_CONFIG_POLL_INTERVAL_S` seconds (1 to 60, default 5) each process reads the latest activation, one single-row query, and loads, re-validates and swaps only when its version changed. `SB_READINESS_TIMEOUT_S` (default 2 s) is also the budget of every read of the config store: the startup load, each poll and each `sb-jobs config` command; a read that takes longer is a failed read (a stale poll, or exit 1 from the CLI). Request logs carry `config_version` and `config_sha256` (bound by `get_snapshot`, and by the readiness probe).
- **When it cannot follow.** A database that stops answering (`reason: database-unavailable`), a poll that fails for any other reason (`poll-error`: a bug, not an outage), or a version this process refuses (a row inserted by SQL with a value outside the range, an unknown key, a hash that is not the hash of its body: logged once as `config_rejected` with the codes), leaves the last good snapshot serving. `/health/ready` then answers 200 with `checks.config: "stale"`, and a change of status or of reason is logged once at `error` (`config.status_changed`, with `reason`, `previous_reason` and the exception type, message and cause, credentials masked), not on every poll; a replica that started with its database down is `missing` before and after its first failed poll, and that poll's line is the first to say why. `"missing"` (no snapshot at all) is the 503 above. With the database itself down readiness is the database's 503 first.
- **The hash.** `config_version.sha256` is the SHA-256 of the canonical JSON (sorted keys, compact) of the **stored** body, never of a model dumped again on read, so adding a tunable later does not change the hash of a version that already exists. Proposing the same config twice is one version; a version written before a new tunable existed and the same config proposed after it are two versions with the same meaning.
- **Not yet.** The activating process swaps its own snapshot at once; other processes take up to one poll interval. The model is loaded from the image and checked against its manifest, with no smoke prediction until B2 has a predictor. The HTTP admin routes, the governance audit events and bearer-token actors are B3 (`ConfigService` is what they will call).

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
check `job_run` rather than the exit code alone; runs of different sources or models may overlap as jobs, but run the
forecast ingests one process at a time (see *Fetch windows, pacing and limits*). Exit codes: 0
succeeded or skipped, 1 failed (`job_run.error` is `<ExceptionType>: <message>` with credentials masked), 2 usage or
configuration error (nothing recorded). The last runs:
`SELECT job_name, status, started_at, error FROM job_run ORDER BY started_at DESC LIMIT 10;`.

Credentials in exception text are masked by pattern, which is not a guarantee: the shared logging chain renders every
exception itself and masks what looks like a credential (URL user and password, `password=`/`token=`-style pairs,
`Authorization` headers, bearer tokens, JSON Web Tokens and cookies) in the message, the traceback and the stack
(`redaction.redact`, `logging.redact_exceptions`). A secret in any other shape is not recognized, and the other fields of
a log line are not scanned, so code must keep secrets out of messages and fields; the mask is the last line of defense.
Text over 32 KB keeps its first and last 16 KB around an elision marker; each end is masked, together with 20 KB of the
text past the cut, before it is cut, so a credential that straddles a cut is masked like any other (one with no bound
in the patterns, such as a URL password or a quoted value, that runs over 20 KB past a cut is the exception). The JSON
`exception` field is the redacted traceback as text.

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
  a request and is not delayed. **The pacer is per process:** two `ingest-forecasts` processes at once (even for two
  models, which the advisory lock allows) send twice the rate, about 960 weighted calls a minute against the 600 the free
  tier allows, so run the forecast ingests one at a time. A 429 or 5xx is retried (6 attempts within 10 minutes, backing
  off exponentially from 1 s); `Retry-After` is not read.
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

Run them one at a time, each to completion, in this order: the Open-Meteo pacer (one request every 6 s) is per process,
so two `ingest-forecasts` running together send twice the rate the free tier allows. Every command must exit 0
(`$LASTEXITCODE`). `build-dataset` runs the WBGT solver over about 1.7 million rows and takes
about 2 minutes (122 s on a laptop, 1,708,032 rows with radiation present). A `--station OMAA` run of each command is a
quick trial of the whole chain. The pair counts and raw errors that `build-dataset` writes into `manifest.json` match the
research's (`pair_counts.csv`, `baseline_errors_pooled.csv`) to floating-point rounding (about 1e-15). That was checked
offline by serving the research's own downloads through the real adapters and job bodies.
