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
- **2026-11-12 (B1 as built, decision unchanged):** what the build showed about the three ports built now and the job guard. Evidence: B1 rulings 10, 11, 26; `backend/src/stellar_blaze/ports/notifications.py`, `ports/weather.py`, `adapters/db/job_runs.py`, `jobs/cli.py`; commits `42638ba` (Task 7), `c497a1d` (Task 8), `3e8bad1` (Task 9), `7a8e3f5` (Task 3), `64efe24` (Task 10). SHAs are commits on branch `feat/b1-backend-foundation` (HEAD `5f00cbe`, not yet merged; a squash merge changes them, so the paths named are the lasting evidence). Rulings are numbered as in the B1 controller's `b1-summary.md`, which is deleted after the merge.
  1. **`OutboundMessage` has six fields, not four.** Consequences says a message carries "a site id, audience, level code and template id only". The type is `site_id`, `audience`, `crew_id`, `level`, `valid_from`, `template_id` (frozen, `extra="forbid"`; a `crew` message needs `crew_id`, a `site` message must have none). The property the sentence exists for holds: no worker id and no free text can cross the port. `crew_id` and `valid_from` are the crew a message addresses (ADR 0004 already has crew as an audience) and when the level takes effect. The test name `test_outbound_message_carries_exactly_the_adr_0002_fields` overclaims until this note is read with it.
  2. **`AlertLevel` values are the lowercase strings `green`, `amber`, `orange`, `red`** (ruling 10), to match F1's client contract. Members compare as strings, not by severity: B3 needs an explicit rank (their position in the declaration). F1's push payload `target_id` is a wire format that B3's `WebPushChannel` maps to `site_id` plus `crew_id`; if F2 wants the type renamed, that is a rename in B3.
  3. **Contract suites.** The observation contract keeps its empty-window call (`[start, start)` returns no rows, ruling 11) and mocks answer per request window. Both forecast and observation sources, and the `NotificationChannel` fakes (`RecordingChannel`, `FailingChannel`), run the one contract suite against the fake and the real adapter, as the Decision requires.
  4. **The job guard is keyed per piece of work.** Consequences says jobs are guarded by `pg_try_advisory_lock`. As built the key is the command plus its source or model (`ingest-observations:iem`, `ingest-forecasts:<model>`, `build-dataset`), so the two observation ingests no longer share a lock (ruling 26). A run that finds its lock held records `skipped_locked` and **exits 0**, so "every command exited 0" proves less than it seems: the Task 11 procedure checks the `job_run` rows (ADR 0040). A failed unlock is logged ("advisory lock lost") and never raised, so it cannot mask the job's own exception or fail a job that succeeded.
