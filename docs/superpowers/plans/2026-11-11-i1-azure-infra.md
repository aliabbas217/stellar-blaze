# I1 Azure Infrastructure and Deploy Pipeline Implementation Plan

> **Note 2026-11-14 (Ali, in chat): open dependency. The Azure account is not created, so I1 is blocked.** Task 0.2 (create the subscription) has not been done, and the Fri 13 Nov hosting gate (Task 6 Step 5) passed with no deploy and no fallback taken; no new date for that decision was given. Until Ali creates the account, everything in this plan that touches Azure waits: Task 0, the bootstrap steps of Task 2, the day-1 deploy in Task 6, and Tasks 7 and 9. Agent work that needs only `az bicep build` and `az bicep lint` (authoring and linting Bicep and scripts, Tasks 1-5) does not need the account. The fallback per ADR 0001 is unchanged: if the account is blocked, step 1 (another Azure region), then step 2 (Render Frankfurt); the `render.yaml` blueprint is still parked below. **New floor:** if no hosted deployment can be made, the demo runs locally in Docker; Task 8 (local compose, below) is that floor and needs no Azure account. Task 8 is still marked "optional, cut first"; this note does not change that marking, and the decision to promote it is Ali's. Record: [ADR 0001](../../decisions/0001-hosting-azure-uae-north.md) Amendments 2026-11-14 and the roadmap's "Decisions recorded 2026-11-14". Related: this plan's Execution paragraph says "an Opus review runs at the end"; under Ali's 2026-11-14 model rule (ADR 0012 Amendments) that needs his explicit per-use permission.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Stellar Blaze demo on Azure UAE North with Bicep, and prove the pipeline on day 1 with placeholder `api` and `web` images. The pipeline is a GitHub Actions deploy that uses OIDC to a user-assigned managed identity: no stored Azure secret, a migrate-first step, a health gate that checks the new revision is the one serving, and the §10 smoke tests. Real images replace the placeholders automatically once `backend/Dockerfile` (B1 Task 4) and `frontend/Dockerfile` (F1 Task 1) exist.

**Architecture:** There are two Bicep entry points.
- `bootstrap.bicep` (subscription scope) runs once from Ali's laptop as Owner. It creates the resource group, the $75 budget, two user-assigned identities (`id-sb-apps` pulls images; `id-sb-deployer` is what GitHub Actions logs in as, through a federated credential), the container registry, and every role assignment.
- `main.bicep` (resource-group scope) runs from CI as `id-sb-deployer` (Contributor on the RG, AcrPush on the registry). It creates Log Analytics, the Container Apps environment (Consumption only, Azure Monitor logging), Postgres Flexible B1MS, the apps `api` and `web`, and the jobs `job-refresh` (cron) and `job-migrate` (manual).

Because only bootstrap creates role assignments, CI needs no rights over authorization. A `location` parameter carries fallback ladder step 1.

**Tech Stack:** Bicep CLI v0.49.2 · Azure CLI 2.92.0 (+ `containerapp` extension) · API versions: `Microsoft.App/*` 2026-07-01 · `Microsoft.DBforPostgreSQL/flexibleServers` 2026-10-01 · `Microsoft.ContainerRegistry/registries` 2025-11-01 · `Microsoft.OperationalInsights/workspaces` 2026-03-01 · `Microsoft.ManagedIdentity/userAssignedIdentities` (+ `/federatedIdentityCredentials`) 2024-11-30 · `Microsoft.Consumption/budgets` 2026-06-01 · `Microsoft.Insights/diagnosticSettings` 2021-05-01-preview (the only version published) · `Microsoft.Authorization/roleAssignments` (latest GA, confirmed by the linter in Task 2) · GitHub Actions: `actions/checkout@v7.0.1`, `azure/login@v3.1.0`, `docker/setup-buildx-action@v4.4.1`, `docker/build-push-action@v7.4.0` · actionlint v1.7.12 · shellcheck (runner-provided).

**Spec:** `docs/decisions/0001-hosting-azure-uae-north.md`, `docs/decisions/0002-infra-minimalism-and-ports.md`, `docs/decisions/0009-evolvability-configurability.md` (amended Tasks 3, 5 and 7 on 2026-11-11), `docs/decisions/0010-runtime-tunable-configuration.md` (amended Global Constraints and Task 7 the same day; **no new Azure resource**: runtime config lives in the existing Postgres), `docs/research/2026-11-11-deployment-options.md` (§0, §5.4, §6.1, §8.1, §9, §10), `docs/superpowers/plans/2026-11-11-roadmap.md` (I1 dates, coordination points), `docs/superpowers/plans/2026-11-11-b1-backend-foundation.md` (Task 2 `Settings`, Task 3 health routes, Task 4 Dockerfile). **Amended 2026-11-12 after B1 executed:** also `docs/decisions/0042-postgres-tls-must-be-verified-in-prod.md` (database URL `ssl=verify-full`, the root file, a deploy-time check) and the B1 branch's Task 7B (runtime config store), which makes the `job-migrate` seed a prerequisite of the first real `api` deploy, not a later step.

## Global Constraints

- **Region:** `uaenorth` by default, via a `location` parameter in both entry points. RG name `rg-stellarblaze-demo-uaenorth`.
- **Container Apps:** Consumption profile only. No Dedicated profile, no private endpoint, no planned-maintenance window (each carries a $0.10/h meter, about $73/month; deployment doc §6.1). `api`: 1 vCPU / 2 GiB. `web`: 0.5 vCPU / 1 GiB. Both: min replicas 1, max 1, single revision mode, external HTTPS ingress, `allowInsecure: false`.
- **Backend contract (B1):** container port **8000**. Liveness `GET /api/v1/health/live`. Readiness `GET /api/v1/health/ready` (checks Postgres). Image from `backend/Dockerfile`, WORKDIR `/app`, venv on PATH, console script `sb-jobs`. Env: `SB_ENV=prod`, `SB_LOG_FORMAT=json` (B1 rejects `prod` with `console`), `SB_LOG_LEVEL=INFO`, `SB_DATABASE_URL` (secret, `postgresql+asyncpg://…`), `SB_GIT_SHA=<commit>`. No `OTEL_EXPORTER_OTLP_ENDPOINT` (B1 tracing is a no-op without it; the managed OTel agent is parked).
- **Frontend contract (F1):** container port **3000**. Health `GET /api/healthz` → `{"status":"ok","version":…}`. Env: `API_ORIGIN=https://<api fqdn>`, `VAPID_PUBLIC_KEY`, `APP_VERSION=<commit>`.
- **Web Push keys (proposed for B3):** `SB_VAPID_PUBLIC_KEY`, `SB_VAPID_SUBJECT` (env) and `SB_VAPID_PRIVATE_KEY` (secret) on `api` and `job-refresh`. One VAPID key pair for the whole project, generated once by Ali.
- **Jobs:**
  - `job-refresh`: Schedule trigger, cron `0 */6 * * *`. Container Apps evaluates cron in **UTC**, so it runs at 04:00, 10:00, 16:00 and 22:00 Gulf time. `replicaTimeout` 1800 s, `replicaRetryLimit` 1. Command `["sb-jobs","refresh"]`, enabled only when the GitHub variable `REFRESH_JOB_READY == "true"` (B3 ships `refresh` on `ReplayForecastSource`, so the judged demo never calls the free Open-Meteo API). Until then it runs the placeholder jobs image.
  - `job-migrate`: Manual trigger, command `["alembic","upgrade","head"]`, run before every real `api` rollout, never at app start-up (ADR 0001).
- **Postgres:** Flexible Server, Burstable `Standard_B1ms`, 32 GiB, version `18` if preflight shows it GA in UAE North, else `17`. Password auth only (Entra auth parked). Public access with the "Allow Azure services" rule `0.0.0.0–0.0.0.0` (stage 1; VNet is stage 2). TLS required. HA off. Backups 7 days, no geo-redundancy. Database `stellar_blaze`, admin `sbadmin`. The password is **64 hex chars** (`openssl rand -hex 32`), so it never needs URL encoding.
- **Database TLS (ADR 0042, amended 2026-11-12):** the server already requires TLS (`require_secure_transport` stays ON); the **client must verify it too**. `databaseUrl` ends `?ssl=verify-full`, and `api`, `job-migrate` and `job-refresh` set `PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt` (asyncpg reads the root file from that variable; `sslrootcert` cannot be passed through a SQLAlchemy URL). `ssl=require` is **not** acceptable: with asyncpg 0.32.0 it is encryption without authentication (`CERT_NONE`, no host-name check), and so is asyncpg's default. The Debian bundle in the B1 image holds both roots Microsoft names for Azure Database for PostgreSQL (DigiCert Global Root G2 and Microsoft RSA Root CA 2017; checked 2026-11-12). Never trust intermediate CAs or pin server certificates. A Private Endpoint or VNet (stage 2) may force `verify-ca` because the host name then differs; decide then. `check-db-tls.sh` (Task 4) fails the deploy when any of this is missing.
- **Migration job and runtime config (ADR 0010, B1 Task 7B; amended 2026-11-12):** B1's image refuses to serve without a seeded runtime config (readiness answers 503, `dependency=config`). `job-migrate` therefore runs `sb-jobs db upgrade` (Alembic `upgrade head`, then the idempotent seed) **from the first real deploy**: Task 3's job definition, Task 4's `run-migrate.sh` (which overrides the command on every run) and Task 7 Step 1b all say so. Task 7B and this change ship together, or the first deploy fails the health gate (the old revision keeps serving, and the deploy is blocked).
- **Registry: ACR Basic, not GHCR.** Reason: ACR gives a keyless path end to end. CI pushes with the OIDC-federated `id-sb-deployer` (AcrPush), and Container Apps pulls with `id-sb-apps` (AcrPull) through `registries[].identity`. GHCR would need a registry username and a long-lived GitHub token stored as a Container Apps secret, or public images. That contradicts "no long-lived secrets" for $5.06/month of savings (deployment doc §6.1). `adminUserEnabled: false`, `anonymousPullEnabled: false`.
- **Secrets:** Container Apps secrets now, filled from GitHub environment secrets at deploy time. Key Vault references are stage 2 (ADR 0001). The only GitHub secrets are `PG_ADMIN_PASSWORD` and `VAPID_PRIVATE_KEY`. There is no Azure credential secret anywhere.
- **Logging:** environment `appLogsConfiguration.destination: "azure-monitor"` plus a diagnostic setting routing `ContainerAppConsoleLogs` and `ContainerAppSystemLogs` to the Log Analytics workspace. The `log-analytics` destination is legacy since Aug 2026 (ACA issue #1812; Microsoft Learn "Change Container Apps logging from Log Analytics to Azure Monitor", 2026-08-12). Workspace `PerGB2018`, 30-day retention, `dailyQuotaGb: 1`.
- **Budget:** subscription scope, $75/month, `Monthly`. Notifications: Actual ≥ 80%, Actual ≥ 100%, Forecasted ≥ 100%, to the email Ali passes at deploy time (never committed). `startDate` must be the first of the month (Consumption API).
- **GitHub:** one environment `demo`. Federated credential subject `repo:<GH_OWNER>/<GH_REPO>:environment:demo`, issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`. Subjects match **case-sensitively** (azure/login README troubleshooting).
- **Repo layout (fixed):** Bicep only under `infra/bicep/`. Scripts go under `infra/scripts/`, the local runbook under `infra/README.md`, optional local compose under `infra/local/`. Workflows only in `.github/workflows/deploy.yml` (owned here) and job `infra` in `.github/workflows/ci.yml` (B1 owns `backend`, F1 owns `frontend`; edit only your own block).
- **Git (executors):** Conventional Commits. Never `git stash`, `reset`, `rebase`, `checkout -- <path>` or `--no-verify`. On an unexpected tree, STOP. Stage only the listed paths. **Agents never run `az` commands that create, change or delete Azure resources.** Only Ali runs bootstrap, and CI runs main. Agents may run `az bicep build`, `az bicep lint` and read-only `az … show/list`.
- **Runtime config (ADR 0010):** model, ruleset pin and tunable changes are runtime activations in Postgres, not deploys. Leave the `demo` variables `SB_RULESET_ID` and `SB_MODEL_ID` **unset**: with `SB_ENV=prod` the backend refuses to start when either is set. Tasks 3 and 5 need no change, because empty values are already omitted. No App Configuration store, no Redis.
- **Conventions win:** if a current Microsoft doc contradicts a property here, follow the doc, keep the resource and parameter names, and say so in the task report.

## Review Focus

1. **The gate passes on the old revision.** Single-revision mode keeps the previous revision serving when the new one never becomes ready, so `/health/ready` still answers 200 and a naive gate goes green on a failed deploy. Expected: the gate also checks that the active, healthy revision runs the image just built. Pinned by Task 4 test `healthcheck fails when the active image differs`.
2. **AcrPull not yet effective on first pull.** Role assignments take minutes to propagate. If the apps' identity cannot pull, the first real-image deploy fails with an unhelpful provisioning error. Expected: bootstrap (which creates the assignment) runs well before the first real image, and the day-1 deploy uses public MCR placeholders, so propagation is never on the critical path. Pinned by Task 6 (day-1 deploy with placeholders) and the Task 7 checklist.
3. **Migration ordering.** A new `api` revision must not start against an un-migrated schema. Expected: `job-migrate` runs with the new image and succeeds before `main.bicep` rolls out the new `api` image, and the deploy stops if it fails. Pinned by Task 4 test `run-migrate skips when placeholder and fails on Failed execution`.
4. **Budget start date on re-deploy.** Re-running bootstrap in a later month with a past `startDate`, or a non-first-of-month date, is rejected. Expected: the parameter is derived as the first of the current UTC month at deploy time, and the runbook says to pass the original value when re-running. Pinned by Task 2 step `budget start date is first-of-month`.
5. **OIDC subject mismatch.** Owner or repo casing, or a portal-generated subject with numeric IDs, gives `AADSTS700213`. Expected: the subject is built from parameters Ali types exactly as GitHub shows them, and the runbook includes the troubleshooting line. Pinned by the Task 2 what-if output check and the Task 6 first-login step.
6. **Unverified TLS reaching production (ADR 0042, added 2026-11-12).** `ssl=require` (the earlier wiring) and asyncpg's default both encrypt without authenticating the server, and nothing would show it. Expected: `ssl=verify-full` plus `PGSSLROOTCERT` on `api`, `job-migrate` and `job-refresh`, and a deploy that fails when any is missing. Pinned by the Task 4 tests `check-db-tls --template fails on ssl=require` and `... fails without PGSSLROOTCERT`, and by the first real `job-migrate` under `verify-full` (Task 7 Step 1).

---

## File Structure

```
infra/
  README.md                       # Ali's runbook (Task 0 steps, re-run notes, fallback ladder)
  bicep/
    bicepconfig.json
    bootstrap.bicep               # targetScope = 'subscription'
    bootstrap.bicepparam
    main.bicep                    # targetScope = 'resourceGroup'
    main.bicepparam               # values from env vars (readEnvironmentVariable)
    modules/
      bootstrap-rg.bicep          # identities, FIC, ACR, role assignments
      monitoring.bicep            # Log Analytics workspace
      environment.bicep           # managed environment + diagnostic setting
      postgres.bicep              # flexible server, db, firewall rule
      container-app.bicep         # generic app (used for api and web)
      container-job.bicep         # generic job (used for refresh and migrate)
  scripts/
    lib.sh                        # shared helpers (retry, log, require_env)
    preflight.sh                  # §10 checks 2 and 3 (+ PG version)
    resolve-image.sh              # real image vs placeholder per service
    run-migrate.sh                # migrate-first step
    healthcheck.sh                # HTTP + active-revision gate
    smoke.sh                      # §10 automatable checks after deploy
    check-db-tls.sh               # ADR 0042: template, deployed and image TLS-verification checks
    measure-cold-start.sh         # §10 check 6 (Ali-run, off-hours)
    tests/run.sh                  # self-tests with stubbed az/curl
    tests/stubs/{az,curl}
  local/compose.yaml              # optional local full stack (Task 8)
.github/workflows/deploy.yml
.github/workflows/ci.yml          # job `infra` only
```

---

### Task 0 (Ali, about 60–90 min, Wed 11 Nov): accounts, CLI, GitHub repo

Do these yourself. Agents cannot create accounts or sign in for you.

- [ ] **0.1 Check free-account eligibility.** The Azure free account ($200 for 30 days plus 12 months of free B1MS Postgres) is for **new Azure customers only**. If your Microsoft account has ever had an Azure subscription or trial, the free account and the startup offer are unavailable on it, and the cost is pay-as-you-go (about $60–65/month; deployment doc §4). Pick the account accordingly.
- [ ] **0.2 Create the subscription.** Go to https://azure.microsoft.com/free and sign up with a phone number and a **non-prepaid** card. Confirm Pakistan is in the offer's country list. If the card is rejected or the signup is blocked and not fixed **within about 4 hours**, stop and take fallback step 2 (Render Frankfurt; ADR 0001). Decide by end of Fri 13 Nov.
- [ ] **0.3 Install the CLIs** (PowerShell):

```powershell
winget install --exact --id Microsoft.AzureCLI
# new terminal, then:
az version                      # expect azure-cli >= 2.92.0
az bicep install --version v0.49.2
az bicep version                # expect 0.49.2
az extension add --name containerapp --upgrade
```

- [ ] **0.4 Sign in and select the subscription:**

```powershell
az login                        # browser opens; pick the account from 0.2
az account list -o table
az account set --subscription "<subscription id>"
az account show --query "{sub:id, tenant:tenantId, user:user.name}" -o table
```

- [ ] **0.5 Register resource providers** (once per subscription, about 2–5 min):

```powershell
"Microsoft.App","Microsoft.OperationalInsights","Microsoft.Insights","Microsoft.DBforPostgreSQL","Microsoft.ContainerRegistry","Microsoft.ManagedIdentity","Microsoft.Consumption" | ForEach-Object { az provider register --namespace $_ --wait }
```

- [ ] **0.6 Create the GitHub repo and the `demo` environment.** The repo currently has no remote. Owner and repo names are case-sensitive in the OIDC subject; note them exactly.

```powershell
gh auth status
gh repo create <GH_OWNER>/stellar-blaze --private --source D:\dev\stellar-blaze --remote origin
# you push the branch yourself when ready: git push -u origin main
gh api -X PUT repos/<GH_OWNER>/stellar-blaze/environments/demo
```

- [ ] **0.7 Generate the two secrets locally** (Git Bash; nothing is written to the repo):

```bash
openssl rand -hex 32                                   # -> PG admin password (64 hex chars)
pnpm dlx web-push@4.0.0 generate-vapid-keys --json     # -> {"publicKey": "...", "privateKey": "..."}
```

Store them in the environment now. Choose the VAPID subject email yourself; push services see it.

```powershell
gh secret set PG_ADMIN_PASSWORD --env demo --repo <GH_OWNER>/stellar-blaze
gh secret set VAPID_PRIVATE_KEY --env demo --repo <GH_OWNER>/stellar-blaze
gh variable set VAPID_PUBLIC_KEY --env demo --repo <GH_OWNER>/stellar-blaze --body "<publicKey>"
gh variable set VAPID_SUBJECT --env demo --repo <GH_OWNER>/stellar-blaze --body "mailto:<an address you choose>"
gh variable set REFRESH_JOB_READY --env demo --repo <GH_OWNER>/stellar-blaze --body "false"
```

Also put the same VAPID pair in `frontend/.env.spike.local` for the F1 Task 15 spike.

---

### Task 1: Preflight script (§10 checks 2 and 3) and runbook skeleton

**Files:**
- Create: `infra/scripts/lib.sh`, `infra/scripts/preflight.sh`, `infra/scripts/tests/run.sh`, `infra/scripts/tests/stubs/az`, `infra/scripts/tests/stubs/curl`, `infra/README.md`

**Interfaces:**
- Produces:
  - `lib.sh` functions: `log <msg>` (stderr, ISO timestamp), `die <msg>` (exit 1), `require_env VAR…`, `retry <attempts> <sleep_s> <cmd…>`.
  - `preflight.sh [--location uaenorth]`. Exit 0 when all pass. Prints `PASS|FAIL <check>` lines and finally `POSTGRES_VERSION=<18|17>`. Checks:
    - **P1:** `az provider show -n Microsoft.App --query "resourceTypes[?resourceType=='managedEnvironments'].locations | [0]"` contains `UAE North`.
    - **P2:** `az postgres flexible-server list-skus --location <loc> -o json` lists `Standard_B1ms` with no restriction. The highest supported major among 18/17 is chosen; the implementer inspects the JSON once and fixes the query path in the script.
    - **P3:** all seven providers from Task 0.5 are `Registered`.
    - **P4:** `az account show` user has the Owner role on the subscription (`az role assignment list --assignee <user> --scope /subscriptions/<id> --query "[?roleDefinitionName=='Owner']"`, non-empty).
  - Self-tests use `PATH`-prepended stubs in `tests/stubs/` that return canned JSON chosen by the env var `STUB_SCENARIO`.

- [ ] **Step 1: Write the failing self-tests** in `tests/run.sh` (plain bash, `set -euo pipefail`, one function per case, a non-zero exit on the first failure):
  - `preflight passes on happy stub`: `STUB_SCENARIO=ok` → exit 0 and stdout contains `POSTGRES_VERSION=18`.
  - `preflight picks 17 when 18 absent`: `STUB_SCENARIO=pg17` → `POSTGRES_VERSION=17`.
  - `preflight fails when UAE North missing`: `STUB_SCENARIO=noaca` → exit 1 and `FAIL P1`.
  Run `bash infra/scripts/tests/run.sh`. Expected: FAIL (script missing).
- [ ] **Step 2: Implement** `lib.sh` and `preflight.sh` (`set -euo pipefail`, `jq`-free: use `--query`/`-o tsv`). Run the self-tests: PASS. Run `shellcheck infra/scripts/*.sh infra/scripts/tests/*.sh`: clean.
- [ ] **Step 3: Write the runbook** `infra/README.md` with these sections:
  - Prerequisites (Task 0 summary)
  - Preflight
  - Bootstrap (one-time)
  - GitHub variables
  - First deploy
  - Day-2 checks
  - Re-running bootstrap (pass the original `budgetStartDate`)
  - Fallback ladder (ADR 0001: flip `location`; Render Frankfurt; AWS last)
  - Troubleshooting (AADSTS700213 subject casing; AcrPull propagation, wait 10 min and re-run; `QuotaExceeded`/`LocationNotAvailableForResourceType` → ladder step 1)
- [ ] **Step 4 (Ali): run it.** `bash infra/scripts/preflight.sh`. Record the output in the runbook's "Preflight log" (date, PASS/FAIL lines, chosen PG version). If P1 or P2 fails, file the region-access request (portal → Help + support → "Region access", service PostgreSQL flexible server) and in parallel choose a fallback region for `location`.
- [ ] **Step 5: Commit.** `git add infra/scripts infra/README.md` then `git commit -m "build(infra): azure preflight checks and runbook"`.

---

### Task 2: Bootstrap Bicep (RG, budget, identities, federated credential, ACR, role assignments)

**Files:**
- Create: `infra/bicep/bicepconfig.json`, `infra/bicep/bootstrap.bicep`, `infra/bicep/bootstrap.bicepparam`, `infra/bicep/modules/bootstrap-rg.bicep`
- Modify: `infra/README.md` (bootstrap commands + outputs → GitHub variables)

**Interfaces:**
- Produces:
  - `bootstrap.bicep` (`targetScope = 'subscription'`) parameters:
    - `location string = 'uaenorth'`
    - `resourceGroupName string = 'rg-stellarblaze-demo-uaenorth'`
    - `githubOwner string`, `githubRepo string = 'stellar-blaze'`, `githubEnvironment string = 'demo'`
    - `budgetAmount int = 75`
    - `budgetContactEmail string` (no default; passed on the CLI)
    - `budgetMonth string = utcNow('yyyy-MM')`, with `var budgetStartDate = '${budgetMonth}-01T00:00:00Z'`
  - Outputs: `resourceGroupName`, `acrName`, `acrLoginServer`, `deployerClientId`, `appsIdentityId`, `appsIdentityPrincipalId`, `tenantId`, `subscriptionId`.
  - `bootstrap-rg.bicep` (RG scope) creates:
    - UAMIs `id-sb-apps` and `id-sb-deployer`.
    - FIC `github-demo` on `id-sb-deployer` with subject `'repo:${githubOwner}/${githubRepo}:environment:${githubEnvironment}'`, issuer and audience per Global Constraints.
    - ACR `acrsb${take(uniqueString(resourceGroup().id), 13)}`, Basic.
    - Role assignments, each named `guid(scope.id, principalId, roleDefinitionId)` with `principalType: 'ServicePrincipal'`:
      - AcrPull (`7f951dda-4ed3-4680-a7ca-43fe172d538d`) for apps on the ACR;
      - AcrPush (`8311e382-0749-4cb8-b61a-304f252e45ec`) for the deployer on the ACR;
      - Contributor (`b24988ac-6180-42a0-ab88-20f7382dd24c`) for the deployer on the RG.
    - Confirm each built-in role GUID with `az role definition list --name "<role>" --query "[0].name" -o tsv` before committing.
  - Budget `budget-sb-monthly` per Global Constraints, at subscription scope.

- [ ] **Step 1: `bicepconfig.json`.** Enable the core analyzers at `warning`, and set `use-recent-api-versions` and `no-hardcoded-location` to `warning` and `secure-secrets-in-params` to `error`. (`use-recent-api-versions` warns on `diagnosticSettings@2021-05-01-preview`; that is expected and is the only published version.)
- [ ] **Step 2: Write the Bicep** per the Interfaces. Use `scope: resourceGroup(resourceGroupName)` for the module. Use `existing` references only where needed.
- [ ] **Step 3: Verify it compiles and lints.** `az bicep build --file infra/bicep/bootstrap.bicep --stdout > NUL` (PowerShell) or `> /dev/null` (bash), and `az bicep lint --file infra/bicep/bootstrap.bicep`. Expected: exit 0, no errors.
- [ ] **Step 4: Budget start date is first-of-month.** `az bicep build --file infra/bicep/bootstrap.bicep --stdout` then search the JSON: `budgetStartDate` is built as `concat(parameters('budgetMonth'), '-01T00:00:00Z')`. Paste the matching line in the task report.
- [ ] **Step 5 (Ali): what-if, then deploy** (needs Owner; about 2–4 min):

```powershell
az deployment sub what-if --location uaenorth --template-file infra/bicep/bootstrap.bicep --parameters infra/bicep/bootstrap.bicepparam --parameters githubOwner=<GH_OWNER> budgetContactEmail=<your email>
# check the FIC subject in the what-if output reads exactly repo:<GH_OWNER>/stellar-blaze:environment:demo
az deployment sub create --name sb-bootstrap --location uaenorth --template-file infra/bicep/bootstrap.bicep --parameters infra/bicep/bootstrap.bicepparam --parameters githubOwner=<GH_OWNER> budgetContactEmail=<your email>
az deployment sub show --name sb-bootstrap --query properties.outputs -o json
```

  If the FIC resource fails, create it by hand and continue:

  ```powershell
  az identity federated-credential create --name github-demo --identity-name id-sb-deployer --resource-group rg-stellarblaze-demo-uaenorth --issuer https://token.actions.githubusercontent.com --subject "repo:<GH_OWNER>/stellar-blaze:environment:demo" --audiences api://AzureADTokenExchange
  ```

- [ ] **Step 6 (Ali): copy the outputs into GitHub variables** (not secrets; client and tenant IDs are identifiers, not credentials):

```powershell
$o = az deployment sub show --name sb-bootstrap --query properties.outputs -o json | ConvertFrom-Json
$r = "<GH_OWNER>/stellar-blaze"
gh variable set AZURE_CLIENT_ID       --env demo --repo $r --body $o.deployerClientId.value
gh variable set AZURE_TENANT_ID       --env demo --repo $r --body $o.tenantId.value
gh variable set AZURE_SUBSCRIPTION_ID --env demo --repo $r --body $o.subscriptionId.value
gh variable set AZURE_RESOURCE_GROUP  --env demo --repo $r --body $o.resourceGroupName.value
gh variable set ACR_NAME              --env demo --repo $r --body $o.acrName.value
gh variable set APPS_IDENTITY_ID      --env demo --repo $r --body $o.appsIdentityId.value
gh variable set POSTGRES_VERSION      --env demo --repo $r --body "<18 or 17 from preflight>"
```

- [ ] **Step 7: Commit.** `git add infra/bicep infra/README.md` then `git commit -m "build(infra): bootstrap bicep with oidc deployer identity, acr and budget"`.

---

### Task 3: Main Bicep (monitoring, environment, Postgres, apps, jobs)

**Files:**
- Create: `infra/bicep/main.bicep`, `infra/bicep/main.bicepparam`, `infra/bicep/modules/{monitoring,environment,postgres,container-app,container-job}.bicep`

**Interfaces:**
- Consumes: bootstrap outputs (`acrLoginServer` is derived from `acrName` via an `existing` reference; `appsIdentityId`).
- Produces:
  - `main.bicep` parameters:
    - `location string = resourceGroup().location`, `acrName string`, `appsIdentityId string`, `postgresVersion string` (allowed `'17'`, `'18'`), `@secure() pgAdminPassword string`, `@secure() vapidPrivateKey string`, `vapidPublicKey string`, `vapidSubject string`, `gitSha string`
    - `apiImage string`, `apiTargetPort int`, `apiLivePath string`, `apiReadyPath string`, `apiIsPlaceholder bool`
    - `webImage string`, `webTargetPort int`, `webHealthPath string`, `webIsPlaceholder bool`
    - `refreshEnabled bool`, `jobsImage string`
    - (ADR 0009) `rulesetId string = ''`, `modelId string = ''`, `forecastSource string = 'replay'` (allowed `'open_meteo'`, `'replay'`)
  - Outputs: `apiFqdn`, `webFqdn`, `environmentName`, `postgresFqdn`.
  - `main.bicepparam` sets every parameter from `readEnvironmentVariable('<NAME>')` with the same upper-snake names: `ACR_NAME`, `APPS_IDENTITY_ID`, `POSTGRES_VERSION`, `PG_ADMIN_PASSWORD`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `GIT_SHA`, `API_IMAGE`, `API_TARGET_PORT`, `API_LIVE_PATH`, `API_READY_PATH`, `API_IS_PLACEHOLDER`, `WEB_IMAGE`, `WEB_TARGET_PORT`, `WEB_HEALTH_PATH`, `WEB_IS_PLACEHOLDER`, `REFRESH_ENABLED`, `JOBS_IMAGE`, `SB_RULESET_ID`, `SB_MODEL_ID` (both via `readEnvironmentVariable('<NAME>', '')`, so unset means empty). Ints and bools are converted with `int()` / `bool()`.
  - `container-app.bicep` parameters: `name`, `location`, `environmentId`, `image`, `targetPort`, `cpu string` (e.g. `'1.0'`, passed through `json()`), `memory`, `identityId`, `acrLoginServer`, `env array`, `secrets array` (`@secure()` object array), `livePath`, `readyPath`, `startupPath`, `minReplicas int = 1`, `maxReplicas int = 1`. It uses `properties.environmentId` (not the deprecated `managedEnvironmentId`), `configuration.activeRevisionsMode: 'Single'`, ingress `{external: true, targetPort, transport: 'auto', allowInsecure: false}` and `registries: [{server: acrLoginServer, identity: identityId}]`.
    - Probes: Startup HTTP on `startupPath`, period 5, failureThreshold 30. Liveness on `livePath`, period 30. Readiness on `readyPath`, period 10, failureThreshold 3.
    - Outputs `fqdn`, `latestRevisionName`.
  - `container-job.bicep` parameters: `name`, `location`, `environmentId`, `image`, `command array`, `triggerType` (`'Schedule' | 'Manual'`), `cronExpression string = ''`, `replicaTimeout int`, `replicaRetryLimit int`, `cpu`, `memory`, `identityId`, `acrLoginServer`, `env array`, `secrets array`. `scheduleTriggerConfig {cronExpression, parallelism: 1, replicaCompletionCount: 1}` or `manualTriggerConfig {parallelism: 1, replicaCompletionCount: 1}`. An empty `command` means no `command` property.
  - `environment.bicep`: workload profiles `[{name: 'Consumption', workloadProfileType: 'Consumption'}]`, `appLogsConfiguration: {destination: 'azure-monitor'}`, `zoneRedundant: false`, and a `Microsoft.Insights/diagnosticSettings` named `to-log-analytics` scoped to the environment with `logs: [{category: 'ContainerAppConsoleLogs', enabled: true}, {category: 'ContainerAppSystemLogs', enabled: true}]` and `workspaceId`.
  - `postgres.bicep`: the server per Global Constraints, child `databases/stellar_blaze` (UTF8, `en_US.utf8`), child `firewallRules/AllowAllAzureServices` (`0.0.0.0`–`0.0.0.0`). Outputs `fqdn`.
  - Wiring in `main.bicep`:
    - `databaseUrl = 'postgresql+asyncpg://sbadmin:${pgAdminPassword}@${postgres.outputs.fqdn}:5432/stellar_blaze?ssl=verify-full'` goes into the secret `sb-database-url` (**amended 2026-11-12, ADR 0042: it was `?ssl=require`, which does not authenticate the server**).
    - (ADR 0042) `PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt` is an env entry on `api`, `job-migrate` and `job-refresh` whenever they carry `SB_DATABASE_URL` (so not on placeholders).
    - The `api` env:
      - `SB_ENV=prod`, `SB_LOG_FORMAT=json`, `SB_LOG_LEVEL=INFO`, `SB_GIT_SHA`;
      - `SB_DATABASE_URL` secretRef `sb-database-url`;
      - `SB_VAPID_PUBLIC_KEY`, `SB_VAPID_SUBJECT`;
      - `SB_VAPID_PRIVATE_KEY` secretRef `sb-vapid-private-key`;
      - (ADR 0009) `SB_RULESET_ID` and `SB_MODEL_ID` **only when the parameter is non-empty** (build the env array with `concat(base, empty(rulesetId) ? [] : [{name: 'SB_RULESET_ID', value: rulesetId}], …)`). An empty string would reach `Settings` as `""`, not `None`, and fail to resolve.
    - When `apiIsPlaceholder`, env and secrets are empty and all three probe paths are `/`.
    - `web` env: `API_ORIGIN = 'https://${api.outputs.fqdn}'`, `VAPID_PUBLIC_KEY`, `APP_VERSION = gitSha`. When `webIsPlaceholder`, the env is empty and the probe paths are `/`.
    - `job-refresh`: image `refreshEnabled ? apiImage : jobsImage`, command `refreshEnabled ? ['sb-jobs','refresh'] : []`, the same env and secrets as `api` when enabled **plus `SB_FORECAST_SOURCE = forecastSource`** (default `replay`, so the judged demo never calls the free Open-Meteo API; ADR 0009 §4), cron per Global Constraints, 1 vCPU / 2 GiB.
    - `job-migrate`: image `apiIsPlaceholder ? jobsImage : apiImage`, command `apiIsPlaceholder ? [] : ['sb-jobs','db','upgrade']` (**amended 2026-11-12, ADR 0010: it was `['alembic','upgrade','head']`**), env `SB_ENV`, `SB_LOG_FORMAT`, `SB_DATABASE_URL`, `SB_GIT_SHA` (the seed actor is `seed:<sha>`), `PGSSLROOTCERT`, `replicaTimeout` 600, retry 0, 0.5 vCPU / 1 GiB.
  - Tags on every resource: `project: stellar-blaze`, `env: demo`, `managedBy: bicep`.

- [ ] **Step 1: Write the modules and `main.bicep`.**
- [ ] **Step 2: Verify compile, lint and params.** With dummy env values exported (`ACR_NAME=acrsbdummy`, a 64-hex password, placeholders for images: `API_IS_PLACEHOLDER=true`, …), run:
  - `az bicep build --file infra/bicep/main.bicep --stdout > /dev/null`
  - `az bicep lint --file infra/bicep/main.bicep`
  - `az bicep build-params --file infra/bicep/main.bicepparam --stdout > /dev/null`

  Expected: exit 0. The only warning allowed is `use-recent-api-versions` on diagnosticSettings.
- [ ] **Step 3: Secret hygiene check.** `az bicep build --file infra/bicep/main.bicep --stdout | grep -c '"outputs"'`, then inspect the `outputs` block. No output references `pgAdminPassword`, `vapidPrivateKey` or `databaseUrl`. Paste the outputs block into the task report.
- [ ] **Step 4: Commit.** `git add infra/bicep` then `git commit -m "build(infra): main bicep for container apps, jobs, postgres and logging"`.

---

### Task 4: Deploy scripts (resolve image, migrate-first, health gate, smoke)

**Files:**
- Create: `infra/scripts/{resolve-image,run-migrate,healthcheck,smoke,measure-cold-start,check-db-tls}.sh`
- Modify: `infra/scripts/tests/run.sh`, `infra/scripts/tests/stubs/{az,curl}`

**Interfaces:**
- Consumes: `lib.sh`.
- Produces:
  - `resolve-image.sh <svc: api|web> <dir> <sha> <acrLoginServer>` appends to `$GITHUB_OUTPUT` (or prints when it is unset):
    - real when `<dir>/Dockerfile` exists:
      - api → `image=<acr>/sb-api:<sha> port=8000 live=/api/v1/health/live ready=/api/v1/health/ready placeholder=false`
      - web → `image=<acr>/sb-web:<sha> port=3000 health=/api/healthz placeholder=false`
    - placeholder otherwise: `image=mcr.microsoft.com/k8se/quickstart:latest port=80 live=/ ready=/ health=/ placeholder=true`
    - Before first use, confirm both placeholder images resolve with `docker manifest inspect mcr.microsoft.com/k8se/quickstart:latest` and `…/quickstart-jobs:latest`. If a name changed, use the one in the Container Apps quickstart docs and report it.
  - `run-migrate.sh <rg> <apiImage> <placeholder:true|false>`:
    - exits 0 with `skip: placeholder` when the placeholder is true;
    - exits 0 with `skip: job not created yet` when `az containerapp job show -n job-migrate` fails;
    - otherwise runs `az containerapp job update -n job-migrate --image <apiImage> --command sb-jobs db upgrade` (**amended 2026-11-12, ADR 0010: it was `alembic upgrade head`. This override wins over the Bicep command at every deploy, so the two must agree**), then `az containerapp job start`, then polls `az containerapp job execution show` every 10 s for up to 600 s. It exits 0 on `Succeeded` and 1 on `Failed` or timeout (printing the execution name and the log query hint).
  - `healthcheck.sh --url <https url> --app <name> --rg <rg> --image <image> [--expect-json-key status --expect-json-value ok] [--timeout 300]` exits 0 only when, within the timeout, all of these hold:
    - (a) `curl -fsS --max-time 10 <url>` returns 200;
    - (b) the active revision with traffic > 0 (`az containerapp revision list -n <app> -g <rg> --query "[?properties.active && properties.trafficWeight > \`0\`]"`) has `properties.template.containers[0].image == <image>`;
    - (c) that revision has `properties.healthState == 'Healthy'`.
    It polls every 10 s and prints each failing condition.
  - `smoke.sh <rg>` prints `PASS|FAIL S<n>` and exits non-zero on any FAIL. The checks map to deployment doc §10:

    | id | check | §10 item |
    |---|---|---|
    | S1 | environment workload profiles are exactly `["Consumption"]`; `az network private-endpoint list -g <rg>` is empty | cost guard §6.1 |
    | S2 | `api` and `web` scale is min 1 / max 1 | ADR 0001 |
    | S3 | `https://<api>/api/v1/health/ready` → 200 when not a placeholder; `https://<web>/api/healthz` → 200 when not a placeholder; otherwise `/` → 200 for each | §10.4 |
    | S4 | when both are real: `https://<web>/api/v1/health/live` → 200 (proves the web→api BFF path) | integration |
    | S5 | `az containerapp job start -n job-refresh` then the execution is `Succeeded` within 900 s | §10.4 ("run the job once") |
    | S6 | every resource in the RG has `location == uaenorth` (or the `--expect-location` value) | residency claim |
    | S7 | `http://<web>/` does not serve 200 over plain HTTP (redirect or refusal) | TLS |
| S8 | when `api` is not a placeholder: `check-db-tls.sh --deployed <rg>` passes (otherwise `skip: placeholder`) | ADR 0042 |

  - `check-db-tls.sh` (added 2026-11-12, ADR 0042; prints `PASS|FAIL T<n> <subject>` and exits 1 on any FAIL; never prints the database URL). Three modes:
    - `--template <main.bicep>` (static, no login): compiles the template with `az bicep build --stdout` and requires **T1** the `sb-database-url` secret expression contains `ssl=verify-full`; **T2** the compiled template contains none of `ssl=require`, `ssl=prefer`, `ssl=allow`, `ssl=disable`, `ssl=false`, `sslmode=`; **T3** `PGSSLROOTCERT` is defined for `api`, `job-migrate` and `job-refresh`.
    - `--deployed <rg>` (deployer login, after `az deployment group create`): **T4** for `api` (`az containerapp secret show`) and for `job-migrate` and `job-refresh` (`az containerapp job secret show`; the implementer inspects `--help` once and fixes the flags), the value of `sb-database-url` matches `ssl=verify-full`, tested by piping the CLI's stdout straight into `grep -q`, with `set +x` and no `-o json`, so the URL is never printed, logged or stored; **T5** each one's `properties.template.containers[0].env` has `PGSSLROOTCERT` with the expected path. This catches a secret or env changed outside the template.
    - `--image <image>` (real images only, in `build-api` after the push): **T6** `docker run --rm -e PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt --entrypoint python <image> -c "$SCRIPT"` exits 0, where the script loads that file with `ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT).load_verify_locations(cafile=...)` and requires the common names `DigiCert Global Root G2` and `Microsoft RSA Root Certificate Authority 2017` among `get_ca_certs()` (a base-image change that drops one fails the build; the script was run against `stellar-blaze-api:dev` on 2026-11-12, exit 0, and exit 1 with a name that is not there).
  - `measure-cold-start.sh <rg> <app> <path>` (Ali-run, off-hours, never between 20 Nov and 11 Dec):
    - sets `--min-replicas 0`;
    - polls `az containerapp replica list` until it is empty (max 20 min);
    - times `curl -o /dev/null -w '%{time_total}' https://<fqdn><path>`;
    - restores `--min-replicas 1`, in a `trap` so it always restores;
    - prints the seconds.

- [ ] **Step 1: Write the failing self-tests** (stubs keyed by `STUB_SCENARIO`):
  - `resolve-image placeholder when no Dockerfile` (temp dir without a Dockerfile → `placeholder=true`, `port=80`)
  - `resolve-image real api` (temp dir with a Dockerfile → `image=acr.example/sb-api:abc`, `port=8000`, `ready=/api/v1/health/ready`)
  - `run-migrate skips when placeholder and fails on Failed execution` (scenario `migrate-failed` → exit 1)
  - `run-migrate succeeds` (scenario `migrate-ok` → exit 0)
  - `healthcheck fails when the active image differs` (curl 200 but the revision image is `old` → exit 1 within a 30 s timeout set by the test)
  - `healthcheck passes` (scenario `healthy`)
  - `smoke reports FAIL S1 on dedicated profile` (scenario `dedicated`)
  - (added 2026-11-12) `run-migrate starts job-migrate with sb-jobs db upgrade`: the stubbed `az` records its arguments; assert `--command` carries `sb-jobs db upgrade` and never `alembic upgrade head`
  - (added 2026-11-12) `check-db-tls --template fails on ssl=require` (T1/T2), `check-db-tls --template fails without PGSSLROOTCERT` (T3), `check-db-tls --template passes on ssl=verify-full with the root file` (fixture templates), `check-db-tls --deployed fails when the secret lacks verify-full` and its output never contains the stubbed URL

  Run `bash infra/scripts/tests/run.sh`. Expected: the new cases FAIL.
- [ ] **Step 2: Implement** the five scripts. Run the self-tests: PASS. Run shellcheck: clean.
- [ ] **Step 3: Commit.** `git add infra/scripts` then `git commit -m "build(infra): deploy scripts with migrate-first, revision-aware health gate and smoke"`.

---

### Task 5: `deploy.yml` and the `infra` CI job

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/ci.yml` (add job `infra` only; if the file does not exist yet, create it with the header in F1 Task 1 Step 6, which matches B1 Task 4's triggers, permissions and concurrency)

**Interfaces:**
- Consumes: Tasks 2–4. GitHub environment `demo` variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `ACR_NAME`, `APPS_IDENTITY_ID`, `POSTGRES_VERSION`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `REFRESH_JOB_READY`, optional `SB_RULESET_ID` and `SB_MODEL_ID` (ADR 0009 config pins; unset = backend defaults), and secrets `PG_ADMIN_PASSWORD`, `VAPID_PRIVATE_KEY`.
- Produces: `deploy.yml`:
  - **Triggers:** `workflow_run` of workflow `ci`, `types: [completed]`, `branches: [main]`, with job-level `if: github.event.workflow_run.conclusion == 'success'`; plus `workflow_dispatch` (day 1, before `ci.yml` exists, and manual redeploys).
  - **Checkout ref:** `${{ github.event.workflow_run.head_sha || github.sha }}`, exported once as `GIT_SHA`.
  - **Workflow settings:** `permissions: {contents: read, id-token: write}`; `concurrency: {group: deploy-demo, cancel-in-progress: false}`; env `AZURE_CORE_OUTPUT: none` (azure/login README warning about secrets in stdout; commands that need output pass `-o tsv`).
  - **Jobs:**
    1. `build-api` and `build-web` (parallel, `environment: demo`, `ubuntu-24.04`): checkout → `resolve-image.sh` (step id `img`) → if `steps.img.outputs.placeholder == 'false'`: `azure/login@v3.1.0` (`client-id`, `tenant-id`, `subscription-id` from vars) → `az acr login -n $ACR_NAME` → `docker/setup-buildx-action@v4.4.1` → `docker/build-push-action@v7.4.0` (`context: backend` or `frontend`, `push: true`, `tags: <image>`, `build-args: APP_VERSION=<sha>` for web, `cache-from/to: type=gha,scope=<svc>`). Job outputs pass all `img` outputs through. (Amended 2026-11-12, ADR 0042: when `placeholder == 'false'`, `build-api` also runs `bash infra/scripts/check-db-tls.sh --image <image>` after the push.)
    2. `deploy` (`needs: [build-api, build-web]`, `environment: demo`), in order:
       1. checkout
       2. azure/login
       3. `az bicep install --version v0.49.2`
       4. `run-migrate.sh "$AZURE_RESOURCE_GROUP" "$API_IMAGE" "$API_IS_PLACEHOLDER"`
       5. export every `main.bicepparam` variable from job outputs, vars and secrets (`REFRESH_ENABLED` = `vars.REFRESH_JOB_READY == 'true' && api placeholder == 'false'`; `JOBS_IMAGE=mcr.microsoft.com/k8se/quickstart-jobs:latest`; `SB_RULESET_ID=${{ vars.SB_RULESET_ID }}` and `SB_MODEL_ID=${{ vars.SB_MODEL_ID }}`, empty when unset)
       6. `bash infra/scripts/check-db-tls.sh --template infra/bicep/main.bicep` (amended 2026-11-12, ADR 0042: fails the run before anything is created if the database URL would not verify the server), then `az deployment group what-if -g … --template-file infra/bicep/main.bicep --parameters infra/bicep/main.bicepparam -o none` (fails the run on template errors)
       7. `az deployment group create --name main-${GIT_SHA::12} …`, then `bash infra/scripts/check-db-tls.sh --deployed "$AZURE_RESOURCE_GROUP"` (amended 2026-11-12: the deployed secret and env still verify)
       8. read the `apiFqdn`/`webFqdn` outputs (`-o tsv`)
       9. `healthcheck.sh` for `api` (url `https://$API_FQDN$API_READY_PATH`, image `$API_IMAGE`)
       10. `healthcheck.sh` for `web` (url `https://$WEB_FQDN$WEB_HEALTH_PATH`, image `$WEB_IMAGE`)
       11. `smoke.sh "$AZURE_RESOURCE_GROUP"`
       12. append both URLs and the S1–S7 lines to `$GITHUB_STEP_SUMMARY`
  - **Secrets handling:** secrets reach Bicep only as env vars read by `readEnvironmentVariable`. Never echo them, never pass them on the command line.
- Produces: the `ci.yml` job `infra` (`ubuntu-24.04`, runs on every PR and push; no Azure login):
  - checkout;
  - `az bicep install --version v0.49.2`;
  - `az bicep build` + `az bicep lint` for both entry points;
  - `az bicep build-params` with dummy env;
  - `shellcheck infra/scripts/*.sh infra/scripts/tests/*.sh`;
  - `bash infra/scripts/tests/run.sh`;
  - `bash infra/scripts/check-db-tls.sh --template infra/bicep/main.bicep` with the dummy env (ADR 0042, amended 2026-11-12);
  - actionlint v1.7.12, downloaded as a pinned release binary with its checksum verified, on `.github/workflows/*.yml`.

- [ ] **Step 1: Write both workflow changes.**
- [ ] **Step 2: Verify statically.** Run actionlint v1.7.12 locally (`go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12` or the release binary) on `.github/workflows/`. Expected: no findings. Run the `infra` job's steps locally in order. Expected: green.
- [ ] **Step 3: Commit.** `git add .github/workflows/deploy.yml .github/workflows/ci.yml` then `git commit -m "ci(infra): oidc deploy workflow with migrate-first, health gate and smoke; infra ci job"`.

---

### Task 6 (Ali + agent, Wed 11 / Thu 12 Nov): day-1 hello-world deploy

Placeholders prove the whole path (OIDC login → Bicep → ACA → Postgres → job run → gate → smoke) before any app code exists. Container Apps pulls the public MCR quickstart images, so this does not depend on AcrPull propagation.

- [ ] **Step 1 (Ali): push** `main` with Tasks 1–5 merged (you run `git push`; the agent does not).
- [ ] **Step 2 (Ali): trigger.** `gh workflow run deploy.yml --ref main --repo <GH_OWNER>/stellar-blaze` then `gh run watch --repo <GH_OWNER>/stellar-blaze`. On the first run, open the `azure/login` step and confirm "Federated token details" shows subject `repo:<GH_OWNER>/stellar-blaze:environment:demo`. Postgres creation takes about 5–15 minutes.
- [ ] **Step 3: Expected result.** Both build jobs report `placeholder=true` and skip the push. `run-migrate` prints `skip: placeholder`. The deployment succeeds. The health gates pass on `/`. Smoke prints S1, S2, S3, S5, S6 and S7 as PASS (S4 skipped). Open the two URLs from the run summary in a browser: the quickstart page appears.
- [ ] **Step 4: Record** in `infra/README.md` → "Deploy log": date, run URL, the two FQDNs, the Postgres version used, and the smoke output. Commit `docs(infra): record day-1 placeholder deploy`.
- [ ] **Step 5: Hosting gate (end of Fri 13 Nov, roadmap).** If this task is not green by then, take fallback step 1 (`location`) or step 2 (Render). Write the decision into `infra/README.md` and tell the coordinator.

---

### Task 7 (event-driven): switch to real images and verify

Triggered automatically. As soon as `backend/Dockerfile` (B1 Task 4) and `frontend/Dockerfile` (F1 Task 1) are on `main` and CI is green, `deploy.yml` builds and pushes them.

- [ ] **Step 1: First real `api` run.** `run-migrate` updates `job-migrate` to the new image and runs `sb-jobs db upgrade` (B1's migrations `0001` and `0002`, then the idempotent config seed; amended 2026-11-12) → `Succeeded`. The `api` gate passes on `/api/v1/health/ready` with the new image active. If the readiness probe fails, check `SB_DATABASE_URL`: with `ssl=verify-full` (ADR 0042) a missing or wrong root file shows in `ContainerAppConsoleLogs` as `ClientConfigurationError: root certificate file ... does not exist` or `FileNotFoundError` (asyncpg fails closed), and an untrusted chain or a wrong host name as `ssl.SSLCertVerificationError`. **This first real database connection is the end-to-end proof that verification works against Azure; it has not been exercised yet** (the day-1 placeholder deploy opens no database connection). If Microsoft's cross-signed-roots warning applies, point `PGSSLROOTCERT` at a file holding the Microsoft RSA Root CA 2017 (Microsoft Learn, "Configure TLS Connection") and record it in the Deploy log. Query it with `ContainerAppConsoleLogs | where ContainerAppName == "api" | order by TimeGenerated desc | take 50` in the workspace (Azure Monitor destination; tables without `_CL`).
- [ ] **Step 1b: Seed the runtime config (ADR 0010). Push this change in the same push as B1 Task 7B.** **Amended 2026-11-12: B1 is executed and its branch already contains Task 7B, so this is no longer a later step. The `job-migrate` command and `SB_GIT_SHA` below are now in Task 3's job definition and Task 4's `run-migrate.sh` (which overrides the command at every deploy), and must be on `main` no later than the B1 merge. If 7B reaches `main` without them, the first real deploy fails the `api` readiness gate with a 503 (`dependency=config`): the old revision keeps serving, and the deploy is blocked.** The rest of this step is the original text, kept as the rationale and for the check that `checks.config == "ok"` after the first deploy. Before Task 7B, `sb-jobs db upgrade` does not exist. After Task 7B, a prod `api` with no seeded config is 503 by design, so the first 7B deploy would fail the health gate; the old revision keeps serving, which is safe, but the deploy is blocked. Change `job-migrate`'s command in `main.bicep` from `['alembic','upgrade','head']` to `['sb-jobs','db','upgrade']` (Alembic `upgrade head`, then the idempotent `config seed`), and give `job-migrate` `SB_GIT_SHA` so the seed actor is `seed:<sha>`. Re-run deploy. The `api` gate then shows `checks.config == "ok"` (before the seed, readiness is 503 `dependency=config` by design). Commit `build(infra): migrate job seeds the runtime config`.
- [ ] **Step 2: First real `web` run.** The gate passes on `/api/healthz` with `"version":"<sha>"`. S4 passes (web → api proxy). Open `https://<web>/en/worker` on a phone; this is the HTTPS URL for the F1 Task 15 spike.
- [ ] **Step 3: Refresh job (when B3 ships `sb-jobs refresh` on `ReplayForecastSource`).** Ali sets `gh variable set REFRESH_JOB_READY --env demo --body true` and re-runs deploy. S5 then runs the real refresh once and must be `Succeeded`. The source is selected by `SB_FORECAST_SOURCE=replay`, which Task 3 already sets on `job-refresh` (ADR 0009 §4); B3 only registers `replay` in `composition.FORECAST_SOURCES`.
- [ ] **Step 3b: Runtime switch-and-rollback drill (ADR 0010; replaces 0009's env-var drill).** Do this once B3's admin API is deployed and B2 has shipped two model ids in the image.
  1. Note the `api` revision name: `az containerapp revision list -n api -g … --query "[?properties.active].name" -o tsv`.
  2. `POST /api/v1/admin/config/versions` with the current config and `model_id=<previous id>`, then `POST /api/v1/admin/config/activations` with a reason. Both calls use the bearer token from Step 3c.
  3. Within 5 s, `ContainerAppConsoleLogs` shows request lines with the new `config_version` and `model_id`.
  4. The revision name is **unchanged**. The audit table has `config.version_created` and `config.activated` rows.
  5. `POST /api/v1/admin/config/rollback` with a reason, and confirm the previous version is back.

  Record everything in the Deploy log. The same procedure with `ruleset_pin` pins a ruleset; prod refuses a pin that falls below today's floors.
- [ ] **Step 3c: Admin tokens (when B3's admin API lands; ADR 0010 §4.4).** Ali generates one token per admin (`openssl rand -hex 32`) and stores a GitHub secret `SB_ADMIN_TOKENS` holding the JSON `{"<actor>": "<sha256 of token>"}`. Only hashes go into the secret; Ali keeps the raw tokens in a password manager. Add `@secure() adminTokens string` to `main.bicep` and `ADMIN_TOKENS` to `main.bicepparam`. Wire them as the Container Apps secret `sb-admin-tokens` and the `api` env `SB_ADMIN_TOKENS` (secretRef). Export it in `deploy.yml` from `secrets.SB_ADMIN_TOKENS`. Never echo it. Commit `build(infra): admin token secret for the config api`.
- [ ] **Step 4: Roadmap gate (Fri 13 Nov).** "I1 pipeline deploys `api` with `/api/v1/health/ready` green". Record it in the Deploy log.

---

### Task 8 (optional, cut first if behind): local full stack via compose

**Why own it:** B1 ships no compose (roadmap coordination point 4). The 17 Nov integration ("end-to-end flow") needs `web` against a real `api` locally, and this file also proves portability rule 1 (ADR 0001). If cut, local integration uses B1's README `docker run` Postgres plus `uv run` and `pnpm dev` with `API_ORIGIN=http://localhost:8000`.

**Files:**
- Create: `infra/local/compose.yaml`, `infra/local/.env.example`

**Interfaces:**
- Produces: services
  - `db`: `postgres:18.6`, env `POSTGRES_USER=sb`, `POSTGRES_PASSWORD=sb`, `POSTGRES_DB=stellar_blaze`, healthcheck `pg_isready`;
  - `migrate`: build `../../backend`, command `alembic upgrade head`, depends on `db` healthy;
  - `api`: build `../../backend`, port 8000, env `SB_ENV=dev`, `SB_LOG_FORMAT=console`, `SB_DATABASE_URL=postgresql+asyncpg://sb:sb@db:5432/stellar_blaze`, depends on `migrate` completed successfully;
  - `web`: build `../../frontend`, port 3000, env `API_ORIGIN=http://api:8000`, `VAPID_PUBLIC_KEY` from `.env`.

- [ ] **Step 1: Write the files.** `docker compose -f infra/local/compose.yaml config`: exit 0.
- [ ] **Step 2: Verify.** `docker compose -f infra/local/compose.yaml up -d --build`, then `curl -s localhost:8000/api/v1/health/ready` → `"status":"ok"`, and `curl -s localhost:3000/api/v1/health/live` → `{"status":"ok"}` (through the BFF). Then `down -v`.
- [ ] **Step 3: Commit.** `git add infra/local` then `git commit -m "build(infra): local compose for full-stack integration"`.

---

### Task 9 (Ali, day 2 and later): checks that need time or a human

- [ ] **Day 2 (Thu 12 / Fri 13), 24–48 h after Task 6:** in the portal, go to Cost Management → Cost analysis, scope the subscription, group by Meter.
  - No `Environment Management Hour`, `Environment Private Endpoint` or `Environment Planned Maintenance Hour` meters.
  - Container Apps compute shows mostly the idle rate. Once B1 Task 7B is deployed, re-check: the 5 s runtime-config poll (ADR 0010 §6) should keep `api` under the idle threshold (1,000 B/s, ADR 0001). If it does not, raise `SB_CONFIG_POLL_INTERVAL_S` to 30 and record that.
  - Postgres B1MS is $0 if the 12-month free offer applies (§10 checks 5 and 8).
  - Record the findings in the runbook.
- [ ] **Cold start (§10.6), once, before 20 Nov, off-hours:** `bash infra/scripts/measure-cold-start.sh rg-stellarblaze-demo-uaenorth api /api/v1/health/ready`. Record the seconds. Min replicas stay 1 during judging regardless.
- [ ] **TTS voices in UAE North (§10.7), only if pre-rendered audio stays in scope** (roadmap stretch item 8). Create a free Speech resource: `az cognitiveservices account create -n sb-speech -g rg-stellarblaze-demo-uaenorth --kind SpeechServices --sku F0 -l uaenorth --yes`. Fetch the key with `az cognitiveservices account keys list …`, then `curl -s -H "Ocp-Apim-Subscription-Key: <key>" https://uaenorth.tts.speech.microsoft.com/cognitiveservices/voices/list`. Check that `ar-AE-FatimaNeural`, `hi-IN-SwaraNeural`, `ur-PK-UzmaNeural`, `bn-BD-NabanitaNeural` and `ne-NP-HemkalaNeural` are present. Record the result. Never commit the key.
- [ ] **Around 1 Dec:** upgrade the free account to pay-as-you-go (portal → Subscriptions → Upgrade). This keeps the 12-month free services, and the subscription is not disabled during evaluation or GITEX (credit lapses about 11 Dec; ADR 0001).
- [ ] **Budget email:** confirm the 80% test email arrives, or at least that the budget appears under Cost Management → Budgets with your address.

---

## Parked (add to `docs/parking-lot.md` in Task 5's commit)

| What | Why parked | Revisit when |
|---|---|---|
| Key Vault references for secrets | Stage 1 uses Container Apps secrets (ADR 0001) | Stage 2 / before any pilot |
| Entra (managed identity) auth for Postgres, drop the password | Needs asyncpg token plumbing in B1/B3 | Stage 2 |
| VNet + private endpoints for Postgres and the environment | About $73/month meter plus setup | Stage 2 |
| Managed OpenTelemetry agent → Application Insights | No collector need for the demo; B1 tracing is a no-op without an endpoint | When traces are needed for a pilot |
| Custom domain + managed certificate | The generated `*.azurecontainerapps.io` FQDN is enough for judging; CNAME must point directly at the app (no proxy) and CAA must allow digicert.com (deployment doc §3.2) | If a branded URL is wanted for GITEX |
| Automatic rollback on failed gate | Single-revision mode keeps the old revision serving when the new one never gets ready | Multiple deploys per day, or multi-revision traffic splitting |
| PR-time `what-if` (needs a second, read-only federated credential for `pull_request`) | Contributor identity must not run on PRs | When a second contributor opens PRs |
| Render Frankfurt Blueprint (`render.yaml`) | Fallback ladder step 2, only if Azure fails by end of 13 Nov | That decision |
| Narrow CA bundle (only the Azure roots) instead of the image's Debian bundle (ADR 0042; already a row in `docs/parking-lot.md`) | The default trusts about 150 public roots, bounded by the `verify-full` host-name check; Microsoft also says to keep the complete Azure root set, which then needs maintenance | Stage 2, a pilot with regulated data, Microsoft announces a root change, or the first real `job-migrate` fails verification |

## Execution

Execution method already chosen: **subagent-driven** (superpowers:subagent-driven-development). Sonnet implements each agent task, a fresh Sonnet reviewer checks it, and an Opus review runs at the end. Ali-only tasks (0, 2 Steps 5–6, 6 Steps 1–2, 9) are done by Ali in the same order. Order: Task 0 (Ali) → 1 → 2 (Ali deploys) → 3 → 4 → 5 → 6 (Ali triggers) by end of Thu 12 Nov. Task 7 follows B1 Task 4 and F1 Task 1 automatically. Task 8 is optional. Task 9 runs on its dates.

> **Note 2026-11-14 (ADR 0012 Amendments, process note; the paragraph above is kept as written):** from 2026-11-14 all subagents, final reviews included, run on Sonnet. Where this paragraph says an Opus review runs at the end, that now needs Ali's explicit per-use permission, requested through a prompt that gives the reasons; without it the final review runs on Sonnet. Every dispatch passes its model explicitly.
