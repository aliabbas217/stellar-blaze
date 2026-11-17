# ADR 0008: Backend stack and tooling

- **Status:** Accepted (Ali, 2026-11-11)
- **Evidence:** `docs/research/2026-11-11-backend-ml-stack.md` (§1, §3, §4, §6.7-6.11, §7: the pins there are authoritative and were locked together with `uv lock`)

## Decision
| Area | Choice (exact pins in the stack doc §7) |
|---|---|
| Runtime | Python 3.13 (`requires-python = ">=3.13,<3.15"`, `.python-version` 3.13), uv **0.13.7** pinned in CI and Docker |
| API | FastAPI 0.162.4, Pydantic 2.14.3, pydantic-settings 2.16.2, uvicorn[standard] 0.54.0 |
| Errors | Hand-rolled RFC 9457 `application/problem+json` handler (stack doc §6.8), `request_id` extension member |
| Persistence | SQLAlchemy[asyncio] 2.1.8 + asyncpg 0.32.0 + Alembic 1.20.1 (async template); Postgres 18.6 locally |
| Training data | Polars **2.0.0** (deliberately one behind: 2.1.0 silently drops rows in `scan_parquet().filter()`, polars #30655), DuckDB 2.0.0, Parquet (zstd), pyarrow 26.0.1 (never imported directly) |
| Outbound HTTP | **httpx2 2.16.0** (Pydantic-stewarded continuation of httpx; Starlette's TestClient needs it), stamina 26.1.0; tests use `httpx2.MockTransport` |
| Observability | structlog 26.1.0 (JSON in prod, console in dev), asgi-correlation-id 5.0.1, OpenTelemetry 1.45.2 / 0.66b2 with OTLP-HTTP |
| Jobs | Typer 0.29.0 CLI commands run by Container Apps cron; no scheduler library; `pg_try_advisory_lock` + `job_run` record |
| Optimisation | OR-Tools 9.15.6755 CP-SAT |
| Quality | ruff 0.17.4, mypy 2.4.1 `--strict` + `pydantic.mypy`, pytest 9.2.0 with markers `unit`, `integration`, `e2e`, `regression`, `slow`; pytest-socket blocks the network in tests (`--allow-hosts=127.0.0.1,::1`) |
| Hooks | pre-commit 4.7.0: pre-commit-hooks v6.0.0 (whitespace, EOF, large files, yaml/toml/json, private key), gitleaks v8.30.1, ruff-pre-commit v0.17.4, mypy as a local `uv run` hook, commitizen v4.19.3 (`commit-msg`, `commitizen-branch` on pre-push); Conventional Commits |
| LLM | `openai` 3.49.0 (optional `llm` group) behind our own adapter when the `LlmClient` port is created (ADR 0002); no LiteLLM |

## Additions beyond the brief (from the evidence; say so if unwanted)
- **CI also runs** `uv lock --check`, `lint-imports` (import-linter 2.16: layer contract, plus "domain imports no I/O library"), `deptry` 0.25.1, `pip-audit` 2.10.1 on `uv export`, and **Squawk** 2.71.0 on `alembic upgrade head --sql` (engineering rule 15: lint migrations; up/down/up is tested against Postgres 18.6 via testcontainers 4.15.0).
- **No `gpu` pytest marker:** nothing in this project runs on a GPU (LightGBM on CPU; torch DRN on the CPU wheel).

## Consequences
- **OpenTelemetry gaps:** `opentelemetry-instrumentation-httpx` does not instrument httpx2, so adapters create spans manually; `opentelemetry-instrumentation-sqlalchemy` 0.66b2 caps SQLAlchemy below 2.1, so it runs with `skip_dep_check=True` until the next contrib release.
- **mypy boundary:** `pythermalcomfort`, `mapie`, `sklearn`, `scoringrules`, `pyarrow` have no `py.typed`; each sits behind a typed facade with a mypy override.
- **pandas ships in the API image** because ortools hard-depends on it; our code stays Polars-first.
- **Windows Smart App Control** blocks OR-Tools' unsigned `.pyd` (ortools #5474): demo from containers.
- **pythermalcomfort numba cache** needs `NUMBA_CACHE_DIR` set to a writable path and warmed in the image build.
- Sentry stays off by default; if enabled: `include_local_variables=False`, `max_request_body_size="never"`, `send_default_pii=False`.
- Production image: `uv sync --locked --no-default-groups`; training: `--group train`.

## Rejected options
| Option | Why rejected |
|---|---|
| httpx 0.28.1, requests, respx, pytest-httpx | Stagnant / replaced by httpx2 |
| Polars 2.1.0 | Silent wrong-result regression reproduced |
| APScheduler 4.x, arq | Pre-release / maintenance-only |
| MLflow | Parked (ADR 0007) |
| LiteLLM 1.109.0 | Malicious 1.82.7/1.82.8 releases in March 2026; very wide dependency tree |
| RFC 9457 libraries | Tiny single-org projects; one is GPL-3.0 |
| psycopg 3 | LGPL-3.0; asyncpg is Apache-2.0 (psycopg is the fallback) |
| Python 3.14 | Works (smoke-tested), but no feature need inside the window; bump after the challenge |

## Revisit trigger
polars > 2.1.0 fixes #30655; the OTel contrib release after 0.66b2; pythermalcomfort closes #524/#523; ortools #5297 confirmed (fallback 9.14.6206); after 20 Nov, the Python 3.14 bump.

## Amendments
- **2026-11-12 (B1 as built, decision text unchanged):** differences between the table above and what shipped. Evidence: B1 rulings 3, 4, 5, 6, 15, 16, 24; `backend/Dockerfile`, `.github/workflows/ci.yml`, `.pre-commit-config.yaml`, `backend/tests/unit/adapters/test_http.py`, `backend/tests/integration/conftest.py`, `backend/.squawk.toml`; commits `0e15309` and `5f35ebf` (Task 4), `c497a1d` (Task 8), `64efe24` (Task 10), `5f00cbe` (final wave). SHAs are commits on branch `feat/b1-backend-foundation` (HEAD `5f00cbe`, not yet merged; a squash merge changes them, so the paths named are the lasting evidence). Rulings are numbered as in the B1 controller's `b1-summary.md`, which is deleted after the merge.
  1. **Python patch pin.** The image is `python:3.13.15-slim-trixie` (digest-pinned) and CI sets `UV_PYTHON=3.13.15`, so the tested interpreter is the shipped one (rulings 3 and 6). 3.13.18 exists; the bump belongs to the post-submission dependency sweep. uv 0.13.7 is pinned in CI and in the Dockerfile (digest). Windows development needs `tzdata` for `Asia/Dubai`: not added, because it is a pin change and Ali's choice.
  2. **gitleaks is also a CI step.** The Hooks row lists gitleaks as a pre-commit hook. The hook scans staged changes (`gitleaks git --pre-commit --staged`), which on a fresh CI checkout is nothing, so CI also runs a pinned gitleaks 8.30.1 over the whole history, honoring `.gitleaksignore` (two reviewed false positives), and skips the hook in the pre-commit step (ruling 5). Every pre-commit `rev` is now a commit SHA with its tag in a `# frozen:` comment (no version change).
  3. **Download integrity.** The gitleaks and oasdiff archives are checked against a sha256 pinned inline in `ci.yml`, not against a `checksums.txt` fetched from the same release (ADR 0009 §5 carries the oasdiff side; ADR 0030 holds v1.35.0, ruling 4).
  4. **Other CI and test facts.** Squawk runs from `backend/` with `.squawk.toml` excluding `prefer-text-field` (it fires on Alembic's own `alembic_version`). CI builds the image and smoke-tests it (uid 10001, one Alembic head, `/health/live`). Retry tests use `stamina.set_testing(True, attempts=3)` (plain `True` means one attempt, ruling 16). The testcontainers import is `testcontainers.community.postgres`, because the implementer found the older import path deprecated. The numba cache is baked into the image with `NUMBA_CPU_NAME=generic` so it stays valid across CPUs.
  5. **HTTP client.** `UpstreamError(message, *, url, status, body_excerpt)`; `get_bytes` takes a `validate` callable and stores a body only after it passes (ruling 15); retries are 6 attempts within 600 s; `Retry-After` is not honored (parking-lot row).
  6. **Logging.** The JSON `exception` field is a redacted string, not structlog's frame dictionaries: [ADR 0043](0043-structural-log-redaction.md) (ruling 24).
  7. **Postgres.** asyncpg's default `ssl` does not verify the server: [ADR 0042](0042-postgres-tls-must-be-verified-in-prod.md).
- **2026-11-14 (pywebpush adds a second HTTP stack; decision text unchanged).** B3 Task 11 (not built at the time of writing) adds `pywebpush==2.5.0` (ADR 0058 decision 2). It brings `aiohttp` (the client behind `webpush_async`) alongside `httpx2`, the "Outbound HTTP" choice above. Accepted for the demo; revisit trigger: production hardening (one HTTP stack, or a reviewed reason to keep two). Facts from the B3 pre-flight (2026-11-14, resolved on a scratch copy of the lock): no existing pin changes; 14 packages are new (pywebpush, py-vapid, http-ece, cryptography, cffi, pycparser, aiohttp, aiohappyeyeballs, aiosignal, attrs, frozenlist, multidict, propcache, yarl); pip-audit is clean; pywebpush is MPL-2.0 and ships no `py.typed`; `requests`, which it also needs, was already locked, so [ADR 0058](0058-alert-events-push-contract-and-stale-forecast-fallback.md)'s "pulls aiohttp and requests into the image" is right about the image but only aiohttp is new. Carried into the Task 11 brief: `pywebpush.*` joins the mypy `ignore_missing_imports` override, every call passes an explicit `timeout=` (the default `None` reaches aiohttp unchanged) and a fresh `vapid_claims` dict (the library mutates it). SHAs are commits on branch `feat/b3-warnings-planner` (worktree `D:\dev\stellar-blaze-b3`), not merged; a squash merge changes them, so the paths named are the lasting evidence. The B3 controller's ledger (`progress.md`, `b3-summary.md`) sits under `.superpowers/sdd/2026-11-14-b3-warnings-planner-governance-api/` in that worktree and is deleted after the merge.
