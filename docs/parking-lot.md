# Parking lot

| What | Why parked | Revisit when |
|---|---|---|
| Full repo tooling: pre-commit (gitleaks, ruff, mypy, commitizen), CI, tiered pytest | Repo held only research + one script | **Scheduled 2026-11-11:** B1 Task 1 and Task 4 (`docs/superpowers/plans/2026-11-11-b1-backend-foundation.md`) |
| `backend/` FastAPI + `frontend/` Next.js (+ three.js) scaffold | Stack depended on the chosen challenge | **Scheduled 2026-11-11:** backend in B1; frontend in F1 (ADR 0003) |
| Hack2skill "full requirements shared when you register" | Only visible after registration | Immediately after registering (before 10 Nov) → capture into `research/raw/` |
| Clarify FAQ ("IP stays with you") vs T&C (6-month right of first refusal on exclusive licence) with support+fhdic@hack2skill.com | Not blocking research | Before submission |
| `LlmClient` port (one adapter over `openai` 3.49.0, `base_url`-parameterised) | No caller yet (ADR 0002) | The copilot or compliance-report agent is greenlit |
| `ObjectStore` port (Azure Blob adapter, signed URLs) | Artefacts and audio are baked into images (ADR 0002) | First runtime read or write of a remote blob |
| `JobQueue` port (`procrastinate` on Postgres) | Jobs are cron-driven; planner runs inline (ADR 0002) | A user-triggered long task that must be polled, or alert delivery that needs retries |
| `EventBus` port (outbox + `LISTEN/NOTIFY`, later Service Bus) | Alerts are rows read by cursor (ADR 0002) | A second consumer of alerts |
| Redis / Azure Managed Redis | About $53/month, no demo need | More than one API replica with shared rate-limit or session state |
| GPU VM in UAE North for a self-hosted LLM | $4.576/h, quota unchecked, could-have feature | Copilot ships beyond the video |
| Microsoft for Startups application | Needs a registered company and a fresh Microsoft account | A company exists or the pilot needs credits |
| UAE Central (Abu Dhabi) region | Restricted access, no availability zones | A DR pair or an Abu Dhabi-specific requirement |
| ECMWF open-data AWS replica ingestion (`ecmwf-opendata`, eccodes) | About 32 GB / 41,700 range requests for leads to 3 days; GRIB reader untested on Windows (ADR 0005) | Production forecast path, or Open-Meteo says the prototype is commercial use |
| granian 2.8.7 | uvicorn is sufficient | p99 latency under load testing exceeds the target |
| TimescaleDB / PostGIS | Parquet + DuckDB handle the volume; no polygons | Above about 50 M hot rows, or site polygons |
| MLflow (skinny + SQLite) | Plain versioned artefacts suffice (ADR 0007) | More than one person trains models |
| hishel / cachetools | The raw-response cache covers upstream reuse | Adapters show repeated identical upstream calls |
| pandera | One data producer | A second producer feeds the Parquet store |
| Polars 2.0.0 pin | polars #30655 (silent row loss in 2.1.0) | A release after 2.1.0 fixes #30655 |
| OTel `skip_dep_check=True`; manual httpx2 spans | Contrib 0.66b2 caps SQLAlchemy < 2.1; no httpx2 instrumentation | Contrib release after 0.66b2; a real `opentelemetry-instrumentation-httpx2` |
| pythermalcomfort NaN/timeout guard | Issues #524, #523 (hang, uninitialised memory) | Both closed and re-verified |
| ortools 9.14.6206 fallback | #5297 memory-safety report not reproduced | #5297 confirmed by maintainers |
| Python 3.14 bump | Works, but no need inside the challenge window | After 20 Nov |
| Brake & Bates 2002 Appendix 1 (paywalled) | Needed to verify the TWL port beyond the MIT reference (ADR 0006) | Before any claim stronger than "aligned with ADOSH TWL zones" |
| Primary source for the TWL withdrawal limits (DB > 44 °C, natural WB > 32 °C → 115 W/m²) | Seen only in the meteoHazard code (ADR 0006) | B3 decides whether to apply them |
| WeatherNext 3 arm | Approval lands 18-20 Nov at best (claims doc §9) | Access granted; post-submission comparison |
| Camera / CCTV / per-worker computer vision; PPE detection; pose-to-workload; thermal cameras | Surveillance and employment-misuse risk (plan E3) | Pilot-only, employer-controlled, consented, with a separate governance review |
