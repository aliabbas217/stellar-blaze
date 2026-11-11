# ADR 0002: Postgres-only infrastructure; three ports now, four deferred with triggers

- **Status:** Accepted (Ali, 2026-11-11)
- **Evidence:** `docs/research/2026-11-11-deployment-options.md` §5; `docs/research/2026-11-11-backend-ml-stack.md` §3 (scheduling, persistence); `docs/research/2026-11-11-frontend-platform.md` §2, §6

## Context
The demo workload is two small containers, scheduled jobs a few times a day, a synchronous planner call and one small Postgres. A port is worth its indirection only when a second real implementation exists or when a fake is needed for tests the plan already requires (fault injection, plan §8.9).

## Decision
**Infrastructure:** Postgres is the only stateful service. No Redis, no queue broker, no event bus, no object store for the demo. Alerts are rows read by cursor (`alerts_since(cursor)`); immutable artefacts (model files, audio clips) ship inside the images.

**Ports built now** (`backend/src/stellar_blaze/ports/`, `typing.Protocol`), each with one real adapter plus an in-memory fake under `adapters/fakes/`, and one contract-test suite run against both:

| Port | Real adapter(s) | Fake(s) | Built in |
|---|---|---|---|
| `WeatherForecastSource` | `OpenMeteoPreviousRunsSource` | `InMemoryForecastSource` | B1 |
| `ObservationSource` | `IemMetarSource` (truth) and `GhcnhParquetSource` (audit layer, ADR 0005) | `InMemoryObservationSource` | B1 |
| `NotificationChannel` | `WebPushChannel` (pywebpush, ADR 0004) | `RecordingChannel`, `FailingChannel` | Protocol + fakes in B1; real adapter in B3 |

**Deferred ports** (recorded in `docs/parking-lot.md`):

| Port | Trigger that creates it | Production alternative (one line) |
|---|---|---|
| `LlmClient` | The copilot or compliance-report agent is greenlit | One adapter over the `openai` client, parameterised by `base_url` (vLLM/Ollama/Azure OpenAI v1) |
| `ObjectStore` | First runtime read or write of a remote blob | Azure Blob adapter with signed URLs |
| `JobQueue` | A user-triggered long task that must be polled, or delivery that needs retries | `procrastinate` on the same Postgres |
| `EventBus` | A second consumer of alerts | Postgres outbox + `LISTEN/NOTIFY` wake-up, later Service Bus topics |

**Not ports:** cache (`cachetools` inside a read path if ever needed), secrets (env vars via `pydantic-settings`), scheduler (Container Apps cron), clock (inject `now: Callable[[], datetime]`), TTS (build-time script).

## Consequences
- Two refinements to "one real adapter per port", both from the evidence: `ObservationSource` has two real adapters because ADR 0005 makes GHCNh the audit layer; `WeatherForecastSource` gets a second, demo-default adapter in B3, `ReplayForecastSource`, reading a committed Parquet snapshot so the judged demo never depends on a free live API (deployment doc §5.3, risk table §10).
- `NotificationChannel` messages carry a site id, audience, level code and template id only (no worker id, no free text); the type forbids extra fields. This makes "no individual health data in any outbound payload" a type-level property (frontend doc §2).
- Jobs are idempotent CLI commands guarded by `pg_try_advisory_lock` and recorded in a `job_run` table (Container Apps jobs are at-least-once).

## Rejected options
| Option | Why rejected |
|---|---|
| Redis (Azure Managed Redis B0) | About $53/month for no demo need; Azure Cache for Redis retires 2028-09-30 |
| `arq` | README: "in maintenance only mode"; needs Redis |
| S3-compatible store | Azure Blob has no native S3 API |
| Ports for every dependency up front | Indirection with no second implementation and no test that needs it |

## Revisit trigger
Any trigger in the deferred table fires; or the API runs more than one replica (shared state then needs Redis or Postgres).

## Amendments
- **2026-11-11 (pointer, decision unchanged):** the `LlmClient` trigger ("the copilot or compliance-report agent is greenlit") has fired for the compliance-report drafter only (ADR 0015); the copilot is cut. ADR 0010 §8 governs that port's routing. The remaining deferred ports are indexed in `docs/parking-lot.md` per ADR 0012.
