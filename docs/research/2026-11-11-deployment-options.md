# Deployment platform for the Challenge 07 prototype (research, 2026-11-11)

**Status:** research for a decision. Written 2026-11-11 (today). Deadline: prototype and technical documentation due 2026-11-20; evaluation 20 to 30 Nov; top 3 present at GITEX 7 to 11 Dec.
**Scope:** where to host the demo now so it is credible as production-ready, and the path to UAE-resident production. Also (scope extension) the minimum infra building blocks and the adapter ports to define now.

**Evidence tags used throughout**

| Tag | Meaning |
|---|---|
| [V] | Verified today from a primary page (URL in Sources) |
| [V-API] | Read today from the vendor's own machine-readable price list (Azure Retail Prices API, AWS Price List files) |
| [T] | Third-party source only; not confirmed by the vendor |
| [U] | Not verified; do not rely on it |
| [J] | My judgment, not a sourced fact |

Prices are USD, list price, 730 h/month (2,628,000 s) unless stated. Nothing here was taken from memory; where I could not verify a cell, it says so.

---

## 0. Decision (read this first)

**Primary: Azure UAE North (Dubai), end to end, from day one.** Azure Container Apps (Consumption profile) for the API, the Next.js web app and the scheduled jobs, Azure Database for PostgreSQL Flexible Server (Burstable B1MS), Bicep for infrastructure, GitHub Actions for CI/CD. One cloud, one region, one subscription, and the same infrastructure code carries to production.

**Fallback: Render (Frankfurt)** if the Azure account, card or UAE North region access is blocked and cannot be fixed within about 4 hours of trying. The demo uses synthetic data only, so a non-UAE region is acceptable for the demo; the cost is that the "in-UAE" claim becomes a statement about the design rather than the deployment. (First step of the fallback ladder is cheaper: flip the Bicep `location` parameter to another Azure region, see section 9.)

**Monthly cost for the demo:** about **$60 to $65** pay-as-you-go, about **$40 to $46** if the free-account Postgres offer applies, and **$0 cash** for the first 30 days because of the $200 free-account credit. Expected out-of-pocket through GITEX: **about $0 to $15** (section 6). A GPU for a self-hosted LLM is **not** included and is expensive (section 6.3).

### Where the evidence corrected the brief

| Brief said | Evidence says |
|---|---|
| Two stages: demo on a PaaS now, then move to UAE | **Not worth it.** Vercel, Railway, Render, Fly.io, Supabase and Neon have **no Middle East region at all** [V] (section 2). Moving later means a re-platform you do not have days for. Better: one cloud with an in-UAE region from day one; "stage 2" is hardening the same stack, not migrating |
| GCP `me-central1` "Doha? / UAE?" | **Doha is Qatar.** Google Cloud has **no UAE region**. Cloud Run's location list shows Doha, Dammam (Saudi Arabia) and Tel Aviv only [V]. GCP drops out for in-UAE |
| AWS App Runner / ECS Fargate / Lightsail in me-central-1 | **App Runner and Lightsail are not offered in me-central-1**; ECS (Fargate) is [V]. AWS reduces to ECS Fargate + RDS + ALB, which is roughly 2x the cost of Azure for the same sizing (section 6.2) |
| Microsoft for Startups Founders Hub credits | **Founders Hub no longer exists** (name retired July 2025). Current self-serve path: $200 initial credit for 90 days, a further $4,800 only after business verification against a **registered company name** [V]. Not reachable for a solo entrant by 20 Nov |
| "Possibly TimescaleDB/PostGIS" | The plan's own tech stack (section 8.11) puts analysis in Parquet + DuckDB and only app state (consent, audit) in Postgres. **Neither extension is needed.** Both exist on Azure (PostGIS 3.6.1, TimescaleDB 2.24.0) if that changes [V] |
| Azure/Microsoft partnership helps "path to pilot" | **No documentary evidence that judges score on cloud brand.** Microsoft is listed as co-creator; the event page mentions no Azure, credits or perks [V]. Azure is the best technical fit for other reasons (section 7) |
| Prior: Postgres does queue + pub/sub + cache duty | **Confirmed in direction, refined in scope.** The demo needs no queue, no cache and no event bus at all; Postgres is the queue/outbox only when a real need appears (section 5) |
| Prior: S3-compatible object storage | **Conflicts with the Azure choice.** Azure Blob has no native S3 API [V]. The demo does not need runtime object storage; the port is deferred (section 5) |

---

## 1. What the workload needs (from the plan, 8.1 to 8.12 and Part E)

- FastAPI (Python 3.13): physics (thermofeel, pythermalcomfort with numba), LightGBM inference, OR-Tools CP-SAT planner, small JSON API.
- Scheduled jobs a few times a day: fetch forecasts, recompute site risk.
- Postgres for app state (consent ledger, audit log), per 8.11; Parquet + DuckDB stay offline for analysis.
- Pre-rendered alert audio and model artefacts: immutable build outputs (8.6: clips generated once when a template is approved).
- Next.js PWA (offline-first, RTL); another agent decides web vs mobile.
- Optional LLM copilot (could-have); optional self-hosted Gemma/Qwen 14B.
- Governance: demo is synthetic-data only; production may need in-UAE compute and storage (plan E4 cites DoH RAI standard clause 3.1.4.5.1, to be confirmed).

Sizing implication [J]: this is two small always-on containers, one cron job and one small Postgres. Nothing here justifies Kubernetes, a queue broker, a cache cluster or a GPU for the demo.

---

## 2. Region reality (the filter that decides most of this)

| Platform | UAE / Middle East region? | Evidence |
|---|---|---|
| **Azure** | **Yes. UAE North (Dubai, 3 availability zones) and UAE Central (Abu Dhabi, restricted access, no AZs).** Qatar Central (Doha) and Israel Central also exist | Azure regions list [V]. UAE Central is flagged "restricted ... To request access ... see Azure region access request process" |
| **AWS** | **Yes. me-central-1 (UAE).** ECS, RDS for PostgreSQL, S3, SQS, SNS, ElastiCache, Secrets Manager, CloudFront, EventBridge listed there. **App Runner and Lightsail: no** | AWS regional services table [V-API] (note: its `source:version` is 20251113, a Nov 2025 snapshot, so newer launches may be missing); App Runner endpoints page and Lightsail endpoints page list no me-central-1 [V]; ECS endpoints page lists it [V] |
| **GCP** | **No UAE region.** Cloud Run: Doha (me-central1, Tier 2), Dammam (me-central2, Tier 2), Tel Aviv (me-west1, Tier 1). A forum post says "no UAE region" (undated); press results show only a cybersecurity centre in Abu Dhabi, not a region | Cloud Run locations page [V]; search [T] |
| **Vercel** | **No.** 19 compute regions; nearest are Mumbai (bom1) and Cape Town (cpt1) | Vercel regions docs [V] |
| **Railway** | **No.** US West, US East, EU West (Amsterdam), Southeast Asia (Singapore) | Railway regions docs [V] |
| **Render** | **No.** Oregon, Ohio, Virginia, Frankfurt, Singapore | Render regions docs [V] |
| **Fly.io** | **No.** 17 regions listed (ams, arn, cdg, dfw, ewr, fra, gru, iad, jnb, lax, lhr, nrt, ord, sin, sjc, syd, yyz); none in the Middle East | Fly regions docs [V] |
| **Supabase** | **No.** 17 regions; nearest Mumbai | Supabase regions docs [V] |
| **Neon** | **No.** 8 AWS regions (none in ME); Azure regions deprecated for new projects | Neon regions docs [V] |

Azure Container Apps availability in UAE North: the confidential-compute page states "Azure Container Apps supports confidential compute in the UAE North region" [V]; the Container Apps "express" preview region list includes UAE North [V]; and the August 2026 product update announces **UAE Central** as a newly added region, implying UAE North was already supported [V]. I did not find a single page that says "Consumption profile is GA in UAE North", so the day-1 smoke test in section 10 is mandatory. Azure Database for PostgreSQL Flexible Server in UAE North: a Microsoft announcement says it became available there in 2021 [T via search summary; U for current status]; price meters exist [V-API].

**Caution learned during this research:** a price meter existing for a region does not prove the service is available there. The Azure price API lists Container Apps serverless GPU meters (T4, A100) for UAE North, but the Container Apps documentation's supported-region table does **not** list UAE North [V]. I treat GPU on Container Apps in UAE North as unavailable.

---

## 3. Comparison

### 3.1 Region, jobs, Postgres, cold starts, credits

| Platform | In-UAE / ME | Scheduled jobs | Postgres | Cold start | Free / startup credit (current terms) |
|---|---|---|---|---|---|
| **Azure Container Apps + PG Flexible** | Yes (UAE North) | **Container Apps Jobs**: Schedule trigger, 5-field cron, **evaluated in UTC**, retries, replica timeout; max 100 executions of history kept [V] | PG Flexible Server, PG 11 to 18; PostGIS 3.6.1, TimescaleDB 2.24.0, pg_cron 1.6, pgvector 0.8.2 available [V] | Scale-to-zero available ("Most applications can scale to zero"); duration **not documented**, I did not measure it [V/U]. Use min replicas 1 | Free account: **$200 for 30 days**; 12 months free: 750 h PG Flexible B1MS + 32 GB storage + 32 GB backup; always-free ACA grant 180,000 vCPU-s, 360,000 GiB-s, 2M requests. Startup program: see 4 |
| **AWS ECS Fargate + RDS** | Yes (me-central-1) | EventBridge exists in region [V-API]; Scheduler sub-feature not checked [U] | RDS for PostgreSQL in region [V-API]; Aurora PostgreSQL also listed | Fargate tasks always on; no scale-to-zero by default [J] | Free plan: **$100 on signup + up to $100 more, 6 months**, "limited to select services", **not eligible for promotional credits**; Activate Founders up to $5,000 (start at $1,000, needs a Paid-plan account); Portfolio up to $200,000 needs an Org ID [V] |
| **GCP Cloud Run + Cloud SQL** | **No UAE** (Doha/Dammam/Tel Aviv only) | Cloud Scheduler not checked [U] | Cloud SQL not checked in Doha [U] | Not checked [U] | "$300 in free credits" headline [V]; duration and startup program not checked [U] |
| **Vercel** | No | Not checked [U] | None native (Marketplace) [U] | Not checked [U] | Hobby is **"personal, non-commercial use" only**; Pro $20 per developer seat with $20 included credit [V] |
| **Railway** | No | Cron: schedule in service settings; runs **at least 5 minutes apart, UTC**; a run is skipped if the previous is still running [V] | Template-based Postgres on a volume; backup/PITR story not checked [U] | Not checked [U] | Trial $5 one-time; Hobby $5/month incl. $5 usage; Pro $20/month incl. $20 [V] |
| **Render** | No | Cron jobs: per-second billing, **$1 minimum per job per month**, 12 h max run, no overlapping runs [V] | Managed Postgres. Free DB: 1 GB, **expires 30 days after creation** (+14 days grace) [V] | Free web service **spins down after 15 min idle, resume takes about one minute** [V]; docs: free instances "Do not use them for production applications" [V] | Free tier only; paid prices from third parties [T] |
| **Fly.io** | No | Machines/scheduling not covered by the pricing page [U] | Managed Postgres: from **$38/month (Basic)** + $0.28/GB [V] | Not checked [U] | **No free tier**; $1 trial credit lasting 7 days [V] |
| **Supabase** (Postgres) | No | pg_cron not checked [U] | Postgres | Free: **paused after 1 week of inactivity** [V] | Free: 2 projects, 500 MB; Pro from $25/month incl. $10 compute credit [V] |
| **Neon** (Postgres) | No | n/a | Postgres | Scale-to-zero after 5 min; restart "typically within a few hundred milliseconds" [V] | Free: 100 CU-hours/project, 1 GB; paid $0.106/CU-hour [V] |

### 3.2 Cost, IaC, CI/CD, observability, domain/TLS, solo effort

Cost column = a small always-on demo equivalent to: API 1 vCPU / 2 GiB, web 0.5 vCPU / 1 GiB, one cron job, Postgres about 1 vCPU / 2 GiB / 32 GB. Arithmetic in section 6.

| Platform | Demo cost / month | IaC | GitHub Actions fit | Observability | Custom domain + TLS | Solo effort [J] |
|---|---|---|---|---|---|---|
| **Azure ACA + PG Flex (UAE North)** | **about $60 to $65 PAYG; about $40 to $46 with free-account PG** | **Bicep** native; Terraform `azurerm_container_app_job` (documents `schedule_trigger_config`) [V]; Pulumi has a `Job` resource [V]; `azd` FastAPI + PG Flexible + ACA template with Bicep exists [V] | `azd` can set up a repo with a GitHub Actions pipeline [V]; federated-credential details not verified [U] | Managed OpenTelemetry agent at no extra compute cost [V]; Log Analytics destination is now **legacy**, Azure Monitor recommended for new deployments (Aug 2026 update) [V]; ingestion $3.29/GB beyond the free tier [V-API] | **Free managed certificate**; CNAME must point **directly** at the app's generated domain (no proxy such as Cloudflare in between); CAA must allow digicert.com [V] | 0.5 to 1 day first time, then low. Highest learning curve of the viable options |
| **AWS ECS Fargate + RDS + ALB** | **about $100 to $115** | CloudFormation/CDK/Terraform [U] | Not verified [U] | CloudWatch in region [V-API] | ACM in region [V-API] | 1 to 2 days; more moving parts (VPC, ALB, task roles) |
| **GCP** | not priced | Terraform [U] | [U] | [U] | [U] | n/a: no UAE region |
| **Vercel** | Pro $20/seat (frontend only) | Not verified [U] | Not verified [U] | Not verified [U] | Not verified [U] | Frontend only; the Python backend still needs a host |
| **Railway** | Usage-metered: CPU $20/vCPU-mo, RAM $10/GB-mo, volume $0.15/GB-mo, egress $0.05/GB [V]; an idle stack is likely about $15 to $35 [J, not measured] | Not verified [U] | Not verified [U] | Not verified [U] | Not verified [U] | 1 to 2 hours |
| **Render** | about $25 to $55 [T prices; not verified against render.com] | **Blueprints (`render.yaml`)**: "single source of truth" for services, databases and environment groups [V]; Terraform provider linked in docs nav [V] | Auto-deploy from Git [U] | Not verified [U] | Not verified [U] | 1 to 2 hours |
| **Fly.io** | roughly $60 to $75: machines $2.19 (256 MB) / $6.70 (1 GB) per month + MPG $38 + storage [V; sum is mine] | Not verified [U] | Not verified [U] | Not verified [U] | Not verified [U] | 2 to 4 hours |
| **Supabase / Neon** | $25 (Supabase Pro) / usage (Neon) | n/a | n/a | n/a | n/a | n/a: no ME region; only worth it as a convenience, which this project does not need |

**Verdict on the table:** every platform in the brief except Azure and AWS fails the region test, and AWS costs about twice as much for no offsetting benefit. The remaining cells I could not fill do not change the decision.

---

## 4. Credits and free offers (current terms, read 2026-11-11)

| Offer | Terms | Usable for this project? |
|---|---|---|
| **Azure free account** | "$200 Azure credit ... for the first 30 days" plus a limited quantity of free services for 12 months. "Your subscription and services are disabled when your credit runs out or expires at the end of 30 days. To continue ... you must upgrade". After upgrade you keep the 12-month free services. Needs a phone number and a **non-prepaid** credit/debit card; **new Azure customers only**; "If your country is not listed, the offer is not available in your region" [V] | **Yes, this is the one to use.** The free 12-month PG Flexible B1MS (750 h, 32 GB + 32 GB backup) removes the largest fixed line; the always-free Container Apps grant stays |
| **Microsoft for Startups (successor of Founders Hub)** | Founders Hub name retired (changes page, July 2025). No-referral path: **$200 initial credit for 90 days, then $4,800 for 180 days after business verification**. Investor-referral path starts at $100,000. Eligibility: software product the company owns, privately held, for-profit, headquartered in an Azure country; "Registered startup name (must match your legal documents)"; a **new personal Microsoft account never used with Azure Free Trial** or other Azure offers; credit card required; decisions in about 3 business days [V] | **No for now.** Needs a registered company; and the same Microsoft account cannot also have used the Azure free account. Park it (parking-lot entry below). Its $200/90-day starter is longer than the free account's $200/30 days, but you lose the 12-month free Postgres |
| **AWS Free plan / Activate** | See table 3.1 [V] | Not needed unless the fallback ladder reaches AWS |
| **GCP $300** | Headline only [V] | Not applicable (no UAE region) |

**Timing trap [J]:** if the Azure free account is created on 11 Nov, the credit lapses about 11 Dec, which is the last day of GITEX. **Upgrade to pay-as-you-go around 1 Dec** (you keep the 12-month free services) so the subscription is never disabled during evaluation or the GITEX demo.

**Unknown to resolve with Ali:** whether Ali's Microsoft account already has an Azure subscription or ever used a free trial (the plan mentions Azure TTS, so it may). If yes, the free account and the startup offer are both unavailable on that account, and the cost is simply pay-as-you-go (about $60 to $65 per month).

---

## 5. Infra building blocks and ports

**Constraint from the user:** do not over-engineer; minimum moving parts for the demo.
**Prior to test:** Postgres does queue + pub/sub + cache-ish duty, S3-compatible storage, platform env secrets, no Redis unless a real need appears.

### 5.1 Verdict on the prior

| Prior | Verdict | Evidence |
|---|---|---|
| No Redis | **Confirmed, strongly.** | (a) Azure Cache for Redis Basic/Standard/Premium "will be retired on September 30, 2028" and Microsoft recommends Azure Managed Redis [V]. (b) The replacement costs more: Azure Managed Redis Balanced B0 = $0.0726/h, about **$53/month** in UAE North; B1 = $0.182/h, about $133/month [V-API]. That alone nearly doubles the demo bill. (c) `arq`, the usual small-Redis Python queue, states "**In maintenance only mode**" in its README [V]. (d) Upstash lists no Middle East region [V] |
| Postgres as the queue | **Confirmed as the production choice; but the demo needs no queue at all.** | PostgreSQL docs: `SKIP LOCKED` "can be used to avoid lock contention with multiple consumers accessing a queue-like table" [V]. The demo workload is cron-driven (a Container Apps Job runs the refresh) plus a synchronous planner call, so there is no producer/consumer split to build [J] |
| Postgres as pub/sub | **Confirmed with caveats; and not needed yet.** | `NOTIFY` payload "must be shorter than 8000 bytes"; Postgres itself says to put larger data in a table and send the key [V]. Notifications are not durable (a listener that is down misses them) [J, follows from the queue semantics]. PgBouncer in transaction pooling supports `LISTEN`: "Never" [V], so listeners need a direct session connection |
| Postgres as cache | **Refuted as a design.** | Use in-process TTL caching, or better: the scheduled job already precomputes site risk several times a day (plan 8.1/8.4), so reads are cheap table reads and no cache layer exists to build [J] |
| S3-compatible storage | **Refuted for this platform.** | Microsoft Q&A: Azure Blob "does not support S3 API directly"; gateways such as s3proxy exist (2024 answers) [V/T]. Cloudflare R2 offers location hints wnam, enam, weur, eeur, apac, oc and jurisdictions eu, fedramp, us: **no Middle East** [V]. Use a port and an Azure Blob adapter when needed |
| Platform env secrets | **Confirmed for the demo; Key Vault references for production.** | Container Apps docs: secrets can be a value or a Key Vault reference; "Avoid specifying the value of a secret directly in a production environment. Instead, use a reference to a secret stored in Azure Key Vault" [V]. Key Vault operations $0.0396 per 10K in UAE North [V-API]. The app only ever reads env vars, so there is no code change between the two |

### 5.2 Capability comparison

**Job queue**

| Option | Moving parts | Extra cost | Fit / health (checked today) |
|---|---|---|---|
| **None (cron job + inline planner)** | 0 | $0 | Right for the demo. Run CP-SAT with a solver time limit inside the request, or in a worker thread [J; confirm with a load test] |
| Postgres + `procrastinate` | 0 new services | $0 | 3.10.0, released 2026-09-23, MIT, repo pushed 2026-11-10, 1,447 stars; supports "periodic tasks, retries, arbitrary task locks"; async/sync [V] |
| Postgres + `pgqueuer` | 0 new services | $0 | **2.0.0 released 2026-11-09 (two days ago, a fresh major)**, MIT, Python 3.11 to 3.15, 13 open issues; claims `FOR UPDATE SKIP LOCKED`, enqueue in the same transaction as your data, cron-style recurring tasks, in-memory mode, Postgres schema installed by SQL [V] |
| Redis + `arq` | + Redis | $53/month (AMR B0) | arq 0.28.0 (2026-04-16), **maintenance-only** [V]. Avoid |
| Redis + `taskiq` | + Redis (or other broker) | $53/month | 0.13.0 (2026-09-26), MIT, pre-1.0, repo pushed 2026-11-07 [V]; broker pricing as for Redis |
| Azure Service Bus | + managed service | Standard: $10/month base + $1.056 per million operations at the first tier (UAE North) [V-API] | Fine in production at scale; no demo value |
| AWS SQS | + managed service | not priced | In me-central-1 [V-API]; not on the Azure path |
| GCP Pub/Sub | n/a | n/a | No UAE region for GCP; excluded |

**Cache and rate limit**

| Option | Verdict |
|---|---|
| In-process TTL (`cachetools`) | **Use for the demo** if a hot read ever needs it. Pin API `maxReplicas = 1` so in-process state is coherent [J] |
| Azure Managed Redis B0 | $53/month [V-API]. Only when you run more than one API replica and need shared rate-limit state |
| Azure Cache for Redis (Basic C0 $0.029/h) | **Do not start new work on a retiring SKU** (retires 2028-09-30) [V]; price [V-API] |
| ElastiCache | In me-central-1 [V-API]; not on the Azure path |
| Upstash | No Middle East region [V] |

**Pub/sub fan-out for alerts**

| Option | Verdict |
|---|---|
| **Alerts table + cursor read (SSE or short polling)** | **Demo.** The refresh job writes alert rows; the API serves "alerts since cursor". No bus, no listener, no failure mode beyond a normal query [J] |
| Postgres outbox + `LISTEN/NOTIFY` wake-up | **Production step 1.** Table is the source of truth; `NOTIFY` carries only an id (payload under 8,000 bytes [V]); polling stays as the fallback; listeners use a direct connection, not transaction-pooled [V] |
| Azure Service Bus topics / Event Grid | Stage 2+, if consumers multiply. Event Grid price lookup returned nothing for UAE North [U] |
| AWS SNS | In me-central-1 [V-API]; not on the Azure path |
| Redis pub/sub | Same cost and retirement concerns as above |

**Push / SMS / WhatsApp delivery (providers only; the frontend agent covers WhatsApp)**

| Channel | Providers |
|---|---|
| Web Push (PWA) | VAPID Web Push, vendor-free; Python `pywebpush` 2.5.0 (2026-08-30, MPL-2.0) [V]; Azure Notification Hubs as a managed option [U] |
| SMS | Azure Communication Services; Twilio; AWS SNS / AWS End User Messaging (the latter listed in me-central-1 [V-API]); Infobip via ACS Messaging Connect [V] |
| WhatsApp | Meta WhatsApp Cloud API |

**Do not wire real SMS or WhatsApp for the demo.** ACS documents that "preregistered" alphanumeric sender IDs, needed in countries that require registration, "usually" take 4 to 6 weeks; I could not confirm UAE coverage or whether the UAE requires registration [V for the lead time; U for the UAE]. Either way that cannot be finished by 20 Nov [J]. Governance point [J]: recipients should be pseudonymous push subscriptions carrying site-level messages, not phone numbers tied to individual health state (consistent with plan 8.8: individual risk computed on-device, server sees only levels).

**Object storage**

| Option | Price / fit |
|---|---|
| **Bake into the image (demo)** | Pre-rendered audio and model artefacts are immutable build outputs (plan 8.6). Ship them in the container or `public/` with content-hashed names [J]. The audio set is small (about 6 languages times roughly a dozen templates [J, estimate]) |
| Azure Blob (production) | Hot LRS $0.020275 per GB-month in UAE North [V-API]; SDK `azure-storage-blob` 12.31.1 (2026-10-29) [V]; local emulator Azurite 3.38.0 supports Blob/Queue/Table, but "diverges" on error and presigning paths so real-account tests are still needed [V/T] |
| AWS S3 | In me-central-1 [V-API]; `aioboto3` 15.5.0 (2025-10-30) [V] |
| GCS / R2 | No UAE region (GCP); R2 no ME location hint [V] |

**Secrets**

| Option | Verdict |
|---|---|
| Container Apps secrets (platform env) | Demo [V] |
| Key Vault references | Stage 2; the app code is unchanged [V] |
| AWS Secrets Manager | In me-central-1 [V-API]; not on the Azure path |

### 5.3 Ports: what to define now, and what not to

Principle: a port is justified only when there are at least two real implementations, or when the fake is needed for fault-injection tests that the plan already requires (the "break things" panel, plan 8.9). Otherwise it is a layer of indirection with no payoff.

| Port | Define now? | Demo adapter | Likely production adapter | In-memory fake for tests |
|---|---|---|---|---|
| `WeatherForecastSource` | **Yes** | `ReplayForecastSource` reading a committed Parquet snapshot (the judged demo must not depend on a live free API) + `OpenMeteoPreviousRuns` for the refresh job | ECMWF open data ingested and stored by us (plan 8.1: only the last 12 runs are kept upstream); a licensed provider if the pilot is commercial (Open-Meteo free tier is non-commercial) | `InMemoryForecastSource` |
| `ObservationSource` | **Yes** | `GhcnhParquetSource` (NOAA GHCNh snapshot) | UAE national met service feed or on-site sensors, adapter TBD | `InMemoryObservationSource` |
| `NotificationChannel` | **Yes, thin** (one `send` method returning a delivery result) | `OutboxChannel` (writes a row, shown in a visible delivery log in the UI) and optionally `WebPushChannel` | ACS SMS / Twilio / SNS / WhatsApp Cloud API; web push | `RecordingChannel`, plus a `FailingChannel` to drive the fault-injection panel |
| `LlmClient` | **Not yet.** Define the day the copilot is greenlit (could-have). Then **one adapter parameterised by `base_url`**, not a family | vLLM or Ollama (both expose OpenAI-style chat completions; Ollama's docs mark tools as supported; vLLM supports named, auto, required tool choice) [V] or Azure OpenAI's `/openai/v1/` route, which works with the standard OpenAI client and needs no `api-version` [V] | same code, different `base_url` | `ScriptedLlm` returning canned tool calls (also serves the eval suite in 8.6) |
| `ObjectStore` | **Not yet.** First runtime read/write from remote storage creates it | none (assets baked in) | `AzureBlobStore`, with a signed-URL method | `InMemoryObjectStore` (Azurite only for integration) |
| `JobQueue` | **Not yet.** Triggers: a supervisor-initiated recompute that must be polled, or alert delivery that needs retries | none; cron job + inline planner | `procrastinate` or `pgqueuer` on the same Postgres (vendor the SQL into the migration tool, per rule 15) | in-memory (pgqueuer ships an in-memory mode [V]) |
| `EventBus` | **Not yet.** A repository method `alerts_since(cursor)` is enough | table + cursor | outbox + `LISTEN/NOTIFY` wake-up; later Service Bus topics | n/a |
| `Cache` | **Never as a port for now.** Use `cachetools` inside the two read paths that need it | n/a | Azure Managed Redis only if multi-replica | n/a |
| `SecretProvider` | **No.** Configuration is already an abstraction: `pydantic-settings` reads env vars; the platform fills them from Container Apps secrets or Key Vault references | n/a | n/a | env fixtures |
| `TTS` | **No runtime port.** It is a build-time script that renders each approved template once (plan 8.6) | `scripts/render_audio.py` calling Azure Speech in UAE North (voice availability per region is an open item, plan E6) | same | n/a |
| `Scheduler` | **No.** Cron lives in infrastructure (Container Apps Job, UTC); code exposes CLI entry points (`python -m app.jobs.refresh`). Jobs must be idempotent: Microsoft documents that maintenance can interrupt long jobs and says to design for at-least-once | | | |
| `Clock` | **Not a port class.** Inject `now: Callable[[], datetime]` for deterministic tests of time-dependent risk | | | |

Port count to build now: **three** (`WeatherForecastSource`, `ObservationSource`, `NotificationChannel`). Everything else is deferred with a stated trigger, which satisfies the "defer, do not discard" rule; record the triggers in `docs/parking-lot.md`.

### 5.4 Minimum moving parts for the demo

| Part | Count |
|---|---|
| Container Apps: `api`, `web` (drop `web` if the frontend ships as a static export, saving about $6 to $12 per month [J]) | 2 |
| Container Apps Jobs: `refresh-and-recompute` (cron), `migrate` (manual, run by CI before deploy) | 2 |
| Postgres Flexible Server | 1 |
| Container registry (ACR Basic, or GitHub Container Registry to save $5/month at the cost of pull credentials) | 1 |
| Redis, queue broker, event bus, Key Vault, Blob account | **0** |

---

## 6. Cost estimate

### 6.1 Stage 1: Azure UAE North, demo (monthly, USD)

Rates from the Azure Retail Prices API for `uaenorth`, queried today: vCPU active $0.000024/s, vCPU idle $0.000003/s, memory $0.000003 per GiB-s (active and idle), requests $0.40 per million; free per subscription per month: 180,000 vCPU-s, 360,000 GiB-s, 2M requests (billing doc) [V, V-API].

| Line | Basis | Monthly |
|---|---|---|
| `api` | 1 vCPU / 2 GiB, min 1 replica, assumed 5% of the month active, rest idle | 10.64 (vCPU) + 15.77 (memory) = **26.41** |
| `web` | 0.5 vCPU / 1 GiB, same assumption | 5.32 + 7.88 = **13.20** |
| Jobs | 4 runs/day x 3 min x 1 vCPU / 2 GiB, active rate | 0.52 + 0.13 = **0.65** |
| Container Apps subtotal | before free grants | **40.27** |
| Free grant credit | 180,000 vCPU-s and 360,000 GiB-s | about -1.6 to -5.4; net **about 35 to 39** |
| PostgreSQL Flexible B1MS | $0.02/h x 730 = 14.60; 32 GB x $0.138 = 4.42 | **19.02** (**$0** for 12 months under the free account) |
| ACR Basic | $0.1666/day | **5.06** |
| Log Analytics / Azure Monitor | minimal volume | about **0 to 3** [J] |
| **Total** | | **about $60 to $65 PAYG; about $40 to $46 with free-account Postgres** |

Assumptions that can move this, and what to do:

- **Idle pricing is conditional.** A replica is billed at the idle rate only if it handles no HTTP requests, uses under 0.01 vCPU and receives under 1,000 bytes per second [V]. If background work in the API keeps CPU above that, the active rate applies all month: about **$118** for the same two apps (my arithmetic). Set a Cost Management budget alert at $75 today and check Cost Analysis after 48 hours.
- **Do not add a private endpoint or a planned-maintenance window in Stage 1.** The price API shows `Environment Private Endpoint`, `Environment Planned Maintenance Hour` and `Environment Management Hour` meters at $0.10/hour each (about **$73/month each**) in UAE North. The billing doc says private endpoints and planned maintenance carry that charge "regardless of whether you use the Consumption or Dedicated plans", while the environments doc says a Consumption-only environment has no environment cost and the Dedicated fee applies only if you use a Dedicated workload profile. A GitHub update says the label is being renamed from "Dedicated Plan Management" (effective December 2026) and "billing behavior ... unchanged" [V]. Net: a Consumption-only environment with no private endpoint and no maintenance window should not incur it, and Cost Analysis on day 2 confirms.
- Scale to zero outside the judging windows if cost matters: warm for the whole 20 Nov to 11 Dec window is about 3 weeks of the warm figure; scale-to-zero otherwise saves up to half [J]. The numba compile on first call (plan 8.2) argues for keeping `api` warm and caching the numba compile in the image [J].

### 6.2 Same sizing on the alternatives (monthly)

| Stack | Arithmetic | Monthly |
|---|---|---|
| **AWS me-central-1: ECS Fargate x86 + ALB + RDS t4g.micro** [V-API] | api 1 vCPU x $0.0526 x 730 + 2 GB x $0.0058 x 730 = 46.87; web 0.5/1 = 23.43; ALB $0.028224/h = 20.60; RDS db.t4g.micro $0.019/h + 20 GB gp3 x $0.14 = 16.67; two public IPv4 at $0.005/h = 7.30 | **about $115** (ARM Fargate lowers it to about $100; no free-plan credit assumed) |
| **Railway** [V rates; usage-metered] | at full allocation: api $40, web $20, Postgres $20, volume $0.75, plan $5 incl. $5 usage | $80 at full allocation; **an idle stack is likely $15 to $35** [J, unmeasured] |
| **Render** | Starter $7 and Standard $25 per web service; cron min $1; Postgres uncertain | **about $25 to $55** [T] |
| **Fly.io** | machines $2.19 to $6.70 + MPG $38 + $0.28/GB | **about $60 to $75** [V rates; sum mine] |

### 6.3 GPU hosting for a self-hosted LLM (separate from the above; Stage 2)

| Option | Price | Status |
|---|---|---|
| Container Apps serverless GPU, UAE North | T4 $0.000104/s (about $0.37/h); A100 $0.000756/s (about $2.72/h) in the price API | **Do not plan on it**: the docs' supported-region table does not list UAE North [V]. Quota request also needed |
| Azure VM `Standard_NV36ads_A10_v5` (full A10, 24 GB), UAE North | **$4.576/h** (about $3,340/month 24x7; about $183 for 40 hours of demos) | Price [V-API]; GPU VM quota for a new subscription not checked [U] |
| Azure VM `Standard_NC40ads_H100_v5`, UAE North | $9.98/h | Price [V-API]; overkill for a 14B model |
| AWS me-central-1 GPU instances | not checked | [U] |

Recommendation [J]: the copilot is a could-have and the demo is synthetic-data only, so for the demo call a managed endpoint through the one `base_url` adapter (or record the copilot in the demo video). A GPU VM in UAE North is a Stage-2 line item you start only for scheduled sessions.

### 6.4 Stage 2: UAE-resident production (order of magnitude, not a quote)

| Item | Note |
|---|---|
| Postgres General Purpose + HA | General Purpose 2-vCore compute meter is $0.217/h [V-API]; unit (per SKU or per vCore) is ambiguous in the API output, so budget **about $160 to $320 per month** for compute depending on HA and verify in the Azure pricing calculator [U] |
| Private networking | Container Apps private endpoint meter $0.10/h, about **$73/month** [V-API]; Front Door/WAF not priced [U] |
| Key Vault, Blob + CDN, Azure Monitor alerts | small [J] |
| GPU VM for LLM | $4.576/h on demand (6.3) |

---

## 7. Where Microsoft and Azure UAE North actually help (evidence only)

| Claim | Evidence | Strength |
|---|---|---|
| Microsoft is a co-creator of the challenge | Event page lists Microsoft as "Co-creator" [V]; WAM press piece via search: co-created with MBZUAI, Inception42 and Microsoft [T via search; the WAM page itself returned no text] | Strong |
| The event offers Azure credits or perks to participants | **None.** The page lists no credits or perks; participant resources are recorded live sessions; selected solutions "may also receive a readiness assessment and a possible pathway beyond the Challenge" [V] | Absent |
| Judges score on cloud brand | **No evidence.** The two relevant criteria are the bare phrases "Scalability and deployment readiness" and "Commercial viability and path to pilot" with no further explanation [V] | Absent. Do not claim it |
| Abu Dhabi runs a Microsoft/G42 sovereign cloud | Abu Dhabi Government signed with Microsoft and Core42 on 18 March 2025; quote: "Core42's Sovereign Public Cloud, powered by Azure and enhanced by our sovereign controls platform"; the article "does not explicitly mention data residency" [V] | Strong for the sovereign-cloud lineage |
| Core42 sovereign cloud is approved by the Abu Dhabi health regulator | I found **no** DoH approval for health data; healthcare material is vendor marketing [T] | Not established |
| In-UAE health data is a legal baseline | Federal Law No. 2 of 2019 Article 13 generally bars storing, processing, generating or transferring health data outside the UAE, with exceptions under Ministerial Decision No. 51 of 2021 [T via law-firm summaries; the official text link is on the Ministry of Justice site but I did not fetch it]. Secondary sources on the DoH side disagree on whether Abu Dhabi licensed entities may use cloud at all (one says DoH approval is required first; one says discontinue health-data cloud services, in or out of the UAE) [T] | Treat residency as necessary, not sufficient |

**How to use this in the pitch [J]:** say "runs in-country (Azure UAE North), single-tenant IaC that can be deployed into a customer's own tenant or a sovereign cloud such as Core42's Azure-based offering". Do not say "Microsoft-aligned scores higher". The honest strength is that the demo's hosting claims are verifiable and match the plan's own residency design rule; the unproven part (DoH acceptance of any cloud) belongs in the limitations section, consistent with plan E4/E6, which already flags that whether the DoH standard covers an employer-deployed tool is unconfirmed.

---

## 8. Recommended path

### 8.1 Stage 1: demo now (11 to 13 Nov; leave the rest for the build, the video and the deck)

**Provision (one resource group in `uaenorth`, Bicep, parameterised `location`):**

| # | Resource | Setting |
|---|---|---|
| 1 | Resource group | `rg-stellarblaze-demo-uaenorth` |
| 2 | Azure Container Registry | Basic (or GHCR) |
| 3 | Container Apps environment | Workload-profiles type, **Consumption profile only**; no private endpoint, no maintenance window; logging to Azure Monitor (Log Analytics destination is legacy for new deployments [V]) |
| 4 | Container App `api` | FastAPI, 1 vCPU / 2 GiB, **min 1, max 1** (in-process state stays coherent), HTTP ingress, health probes, system-assigned identity, secrets via Container Apps secrets |
| 5 | Container App `web` | Next.js `standalone` build, 0.5 vCPU / 1 GiB, min 1; omit if the frontend is a static export served via the API or a CDN |
| 6 | Container Apps Job `refresh-and-recompute` | Schedule trigger, cron `0 */6 * * *` (UTC; Gulf Standard Time is UTC+4, so runs fall at 04:00, 10:00, 16:00, 22:00 local [J]), `replicaRetryLimit` of 1 or more, idempotent |
| 7 | Container Apps Job `migrate` | Manual trigger running `alembic upgrade head` (reversible migrations, rule 15) before each deploy |
| 8 | PostgreSQL Flexible Server | Burstable B1MS, 32 GiB, PG 18 if the portal offers it as GA, else 17; **no extensions** needed initially |
| 9 | Custom domain | `app.<your-domain>` CNAME **directly** to the app's generated domain, free managed certificate [V] |
| 10 | Cost Management budget | alert at $75/month; free |

**CI/CD (GitHub Actions):** build both images (`uv`, multi-stage, non-root) and push to the registry; run `migrate`; update the apps; smoke-test `/healthz` end to end (rule 12). Start from the `azd` FastAPI + PG Flexible + Container Apps template for the Bicep skeleton and the workflow, then prune [V that it exists; its last-updated date not checked, so review before trusting].

**Portability rules (what keeps this off a lock-in path) [J]:**

1. One Dockerfile per service; `docker compose up` (Postgres + api + web) is the local and CI end-to-end environment. If it runs there, it runs on Render in an afternoon.
2. Twelve-factor configuration: everything via environment variables through `pydantic-settings`; no cloud SDK imports outside adapter modules.
3. Logs are JSON to stdout (structlog); no files, no local state.
4. Migrations are a separate job, never in the app's start-up path.
5. Cron is infrastructure, jobs are plain CLI entry points, so they run unchanged under Render cron, GitHub Actions `schedule`, or Container Apps.
6. Bicep is the source of truth; a `location` parameter and a per-tenant parameter file give the "deploy into the customer's tenant" story.

### 8.2 Stage 2: UAE-resident production (after the challenge, same stack)

| Hardening step | Why |
|---|---|
| Postgres General Purpose with zone-redundant HA in UAE North | Availability; UAE North has 3 AZs, UAE Central none [V] |
| Environment into a VNet with private endpoints (note the $73/month meter) | Remove public data paths |
| Key Vault references + managed identities | Container Apps docs recommend this for production [V] |
| Blob + CDN for audio and model artefacts; define `ObjectStore` then | First real remote-storage need |
| Azure Monitor alerts, uptime checks, structured audit export | Plan 8.8 audit trail |
| Front Door + WAF, Entra ID | Edge protection, SSO for supervisors |
| GPU VM for the LLM in UAE North, started on schedule | Meets the in-UAE AI compute rule if the copilot ships (plan 8.6) |
| DoH consultation | Decide where the product is allowed to run for a pilot; the rule's applicability is unconfirmed (plan E6) |

---

## 9. Fallback ladder

1. **Region blocked (Postgres or Container Apps "location restricted / not available" in UAE North for the new subscription):** file the region-access request (Microsoft's capacity-error guidance points to a "Region access" request under the PostgreSQL flexible server support topic [T: search summary of a Microsoft Learn page I did not fetch]), and in parallel deploy the same Bicep to another Azure region by changing the `location` parameter. Data is synthetic, so this is acceptable for the demo. Community threads report that these tickets can be slow [T], so do not wait on it.
2. **Account, card or credit blocked** (for example a Pakistani card is rejected; the free account requires a non-prepaid card [V]; Pakistan acceptance of the offer is not verified [U]): switch to **Render (Frankfurt)**: Docker web services, a cron job ($1 minimum), managed Postgres, `render.yaml` Blueprint as IaC [V]. If the portability rules in 8.1 held, this is a 2 to 4 hour job [J]. Railway (Amsterdam; cron at least every 5 minutes, UTC [V]) is the equal alternate.
3. **AWS me-central-1** only if a UAE-resident host is mandatory and Azure is unusable: ECS Fargate + RDS + ALB, about $115 per month, more setup effort.

Do not use Vercel as the primary host: no Middle East region, Hobby is non-commercial, and it does not host the Python backend [V; the last point is [U]].

---

## 10. Risks and day-1 checks

| Risk | Likelihood / impact [J] | Mitigation |
|---|---|---|
| New subscription cannot create Postgres or Container Apps in UAE North | Medium / high | Smoke test today (below); fallback step 1 |
| Free-account credit lapses mid-GITEX (about 11 Dec if created today) | High if ignored / high | Upgrade to pay-as-you-go about 1 Dec; keep free services |
| Idle-rate eligibility fails, bill jumps to about $118 | Medium / medium | Budget alert; check Cost Analysis after 48 h; lean sizing |
| A surprise $73/month environment meter | Low / medium | No private endpoint or maintenance window; confirm in Cost Analysis |
| Cold start on a scaled-to-zero app during judging | Medium / high | min replicas 1 for `api` and `web` during 20 Nov to 11 Dec; numba cache baked into the image |
| B1MS burstable CPU credits exhausted | Low / low | Demo load is tiny; if sustained, step up to B2S ($0.079/h) [V-API] |
| Live free weather API down or rate-limited during judging | Medium / high | `ReplayForecastSource` as the demo default; live only for the refresh job |
| Azure account complexity eats build days | Medium / high | Timebox infra to about 1 day; if not live by end of 13 Nov, take fallback step 2 |
| DoH acceptance of any cloud is unresolved | High / medium (production only) | State it in limitations; per-tenant IaC; plan E6 already tracks it |
| Postgres 18 not GA in UAE North | Low / low | Use 17 |

**Day-1 checks (I could not run these from here; Ali runs them in the first hour):**

1. Create the Azure free account (or confirm Ali's account is eligible; see section 4). Confirm Pakistan is offered and the card is accepted.
2. `az provider show -n Microsoft.App --query "resourceTypes[?resourceType=='managedEnvironments'].locations"` includes UAE North.
3. `az postgres flexible-server list-skus --location uaenorth` returns B1MS and no restriction.
4. Create the environment, one hello-world app and one scheduled job; run the job once.
5. After 24 to 48 hours, open Cost Analysis: no `Environment Management Hour` charge; compute billed at the idle rate.
6. Measure cold-start time of `api` (including the numba compile) with min replicas 0 and 1.
7. Confirm which Azure Speech voices (ar-AE, hi-IN, bn-BD, ne-NP, ur-PK) are served from UAE North (plan E6).
8. Free-offer applicability in UAE North for the 12-month PG B1MS (the offer page does not say it is region-limited, nor that it is not).

---

## 11. Unverified, parked, and open

| Item | State |
|---|---|
| Render, Railway, Fly, Vercel observability, domain/TLS, CI details | Not verified; irrelevant to the primary decision |
| Render paid prices | Third-party blogs only; render.com/pricing returned no figures to my fetch |
| GCP Cloud Run / Cloud SQL pricing and GCP startup credits | Not researched beyond region and the $300 headline (no UAE region) |
| AWS GPU instances in me-central-1 | Not checked |
| Azure Notification Hubs, ACS UAE SMS coverage and sender-ID rules | Not verified |
| Event Grid pricing in UAE North | Query returned nothing |
| Official text of Federal Law 2/2019 Article 13 and DoH cloud rules | Law-firm and press summaries only; DoH document not read |
| Container Apps cold-start duration, UAE North Consumption GA statement | Not documented in what I read; measure on day 1 |
| `azd` template freshness | Not checked |

**Parking-lot entries to add** (`docs/parking-lot.md`; what / why parked / when to revisit):

| What | Why parked | Revisit when |
|---|---|---|
| Microsoft for Startups application | Needs a registered company and a fresh Microsoft account; conflicts with using the free account on the same account | A company exists or the pilot needs credits |
| `ObjectStore`, `JobQueue`, `EventBus`, `LlmClient` ports | Each has no second implementation or no caller yet | First runtime blob IO; first user-triggered async job or retrying delivery; second consumer of alerts; copilot greenlit |
| Redis / Azure Managed Redis | $53/month, no demo need | More than one API replica with shared rate-limit or session state |
| GPU VM in UAE North | $4.576/h, quota unchecked, could-have feature | Copilot ships beyond the video |
| UAE Central (Abu Dhabi) | Restricted access, no AZs | A DR pair or an Abu Dhabi-specific requirement |

---

## 12. Sources (all read 2026-11-11 unless noted)

**Azure**
1. Azure regions list: https://learn.microsoft.com/en-us/azure/reliability/regions-list
2. Container Apps billing: https://learn.microsoft.com/en-us/azure/container-apps/billing
3. Container Apps environments: https://learn.microsoft.com/en-us/azure/container-apps/environment
4. Container Apps jobs: https://learn.microsoft.com/en-us/azure/container-apps/jobs
5. Container Apps custom domains and managed certificates: https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates
6. Container Apps secrets (Key Vault references): https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets
7. Container Apps serverless GPU regions: https://learn.microsoft.com/en-us/azure/container-apps/gpu-serverless-overview
8. Container Apps confidential compute (UAE North): https://learn.microsoft.com/en-us/azure/container-apps/confidential-compute
9. Container Apps express overview (region list): https://learn.microsoft.com/en-us/azure/container-apps/express-overview
10. Container Apps August 2026 updates (UAE Central added; Log Analytics legacy): https://github.com/microsoft/azure-container-apps/issues/1834
11. Container Apps October 2026 updates (billing label rename): https://github.com/microsoft/azure-container-apps/issues/1886
12. PostgreSQL Flexible Server extensions and versions: https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions
13. Azure Retail Prices API (queried with filters on `armRegionName eq 'uaenorth'`): https://prices.azure.com/api/retail/prices
14. Azure free account FAQ page: https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account
15. Avoid charges with the free account: https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/avoid-charges-free-account
16. Microsoft for Startups changes (July 2025): https://learn.microsoft.com/microsoft-for-startups/changes-microsoft-for-startups
17. Microsoft for Startups FAQ (updated 2026-10-30): https://learn.microsoft.com/en-us/startups/microsoft-for-startups/mfs-faqs
18. Microsoft for Startups application and eligibility: https://learn.microsoft.com/en-us/startups/microsoft-for-startups/application
19. Azure Cache for Redis retirement FAQ: https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/retirement-faq
20. Python azd templates overview: https://learn.microsoft.com/en-us/azure/developer/python/overview-azd-templates
21. azd FastAPI + PG Flexible + ACA template: https://github.com/Azure-Samples/azure-fastapi-postgres-flexible-aca
22. Terraform `azurerm_container_app_job`: https://registry.terraform.io/providers/hashicorp/azurerm/4.21.0/docs/resources/container_app_job
23. Azure OpenAI v1 API: https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle
24. ACS alphanumeric sender ID: https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/sms/enable-alphanumeric-sender-id
25. Azure Storage Azurite: https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite
26. S3 API support over Azure Blob (Q&A): https://learn.microsoft.com/en-us/answers/questions/1183760/s3-api-support-over-azure-blob-storage

**AWS**
27. Regional services table (snapshot 20251113): https://api.regional-table.region-services.aws.a2z.com/index.json
28. App Runner endpoints: https://docs.aws.amazon.com/general/latest/gr/apprunner.html
29. Lightsail endpoints: https://docs.aws.amazon.com/general/latest/gr/lightsail.html
30. ECS endpoints: https://docs.aws.amazon.com/general/latest/gr/ecs-service.html
31. Price list, ECS/Fargate me-central-1 (published 2026-10-19): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/me-central-1/index.json
32. Price list, RDS me-central-1 (published 2026-10-29): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/me-central-1/index.json
33. Price list, ELB me-central-1: https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/me-central-1/index.json
34. AWS Free Tier: https://aws.amazon.com/free/
35. AWS Activate credits: https://aws.amazon.com/startups/credits

**GCP and PaaS**
36. Google Cloud locations: https://cloud.google.com/about/locations
37. Cloud Run locations: https://docs.cloud.google.com/run/docs/locations
38. Vercel regions: https://vercel.com/docs/regions
39. Vercel Hobby plan: https://vercel.com/docs/plans/hobby
40. Vercel pricing: https://vercel.com/pricing
41. Railway plans: https://docs.railway.com/reference/pricing/plans
42. Railway regions: https://docs.railway.com/reference/deployment-regions
43. Railway cron: https://docs.railway.com/reference/cron-jobs
44. Render regions: https://render.com/docs/regions
45. Render free tier: https://render.com/docs/free
46. Render cron jobs: https://render.com/docs/cronjobs
47. Render Blueprints: https://render.com/docs/infrastructure-as-code
48. Fly.io regions: https://docs.fly.io/reference/regions
49. Fly.io pricing: https://docs.fly.io/about/pricing
50. Supabase regions: https://supabase.com/docs/guides/platform/regions
51. Supabase pricing: https://supabase.com/pricing
52. Neon regions: https://neon.com/docs/introduction/regions
53. Neon pricing: https://neon.com/pricing

**Building blocks**
54. PostgreSQL `SELECT` (SKIP LOCKED): https://www.postgresql.org/docs/current/sql-select.html
55. PostgreSQL `NOTIFY`: https://www.postgresql.org/docs/current/sql-notify.html
56. PgBouncer feature matrix: https://www.pgbouncer.org/features.html
57. PyPI JSON for procrastinate, pgqueuer, arq, taskiq, pywebpush, azure-storage-blob, aioboto3, sse-starlette, redis, valkey: https://pypi.org/pypi/<package>/json
58. GitHub API repo metadata: procrastinate-org/procrastinate, janbjorge/pgqueuer, python-arq/arq, taskiq-python/taskiq
59. arq README ("In maintenance only mode"): https://github.com/python-arq/arq
60. pgqueuer README: https://github.com/janbjorge/pgqueuer
61. Upstash regions: https://upstash.com/docs/redis/features/globaldatabase
62. Cloudflare R2 data location: https://developers.cloudflare.com/r2/reference/data-location/
63. vLLM OpenAI-compatible server: https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/
64. Ollama OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility

**Context and governance**
65. Event page (Microsoft listed as co-creator; criteria wording): http://hack2skill.com/event/futurehealthchallenge/
66. Abu Dhabi Media Office, Microsoft/G42/Core42 sovereign cloud (18 Mar 2025): https://www.mediaoffice.abudhabi/en/technology/abu-dhabi-government-accelerates-digital-strategy-with-landmark-microsoft-g42-partnership/
67. Core42 Sovereign Public Cloud: https://core42.ai/en/resources/core42-sovereign-public-cloud/
68. Federal Law No. 2 of 2019 (official text, not fetched): https://elaws.moj.gov.ae/UAE-MOJ_LC-En/00_Health/UAE-LC-En_2019-02-06_00002_Kait.html?val=EL1
69. Trade.gov on UAE health data flows and ADHICS (secondary): https://www.trade.gov/market-intelligence/united-arab-emirates-regulations-limit-cross-border-health-data-flows
70. Baker McKenzie summary of the DoH localisation circular (secondary, 2022): https://globalcompliancenews.com/2022/10/07/https-insightplus-bakermckenzie-com-bm-data-technology-uae-abu-dhabi-department-of-health-requires-licensed-entities-to-comply-with-strict-data-localization-requirements_09222022/
71. Challenge plan: `D:\dev\stellar-blaze\docs\context\challenge-07-plan.md` (sections 8.1 to 8.12, Part E)
