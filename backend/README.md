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
uv run pytest -m unit           # fast, no network, no Docker
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
directory, and `/app/.numba-cache` is the only writable path.

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

Filled in with the ingest task (`sb-jobs` commands, their flags and the runbook).
