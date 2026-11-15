# Stellar Blaze infrastructure runbook

Operator guide for hosting the demo on Azure UAE North (ADR 0001). Written for Ali on Windows 11, in one PowerShell window.
Every command is copy-paste. The expected result follows it.

**State described:** branch `feat/i1-azure-infra`, not merged. **Nothing in this file has run against Azure or Render.** The
Azure CLI is not installed on the build machine and the Azure account did not exist when this was written. The Bicep and the
scripts were checked offline (section 8). A line marked "unverified" has never been seen on a real account. If reality
differs, trust reality and fix this file. The design calls and every place where the I1 plan no longer holds are in
`docs/superpowers/plans/2026-11-15-i1-plan-deltas.md`.

> **Read this first: the demo is cheap by default, and that has a price.** The `api` scales to zero when nobody uses it. The
> web proxy gives up on the api after a fixed 10 seconds (`frontend/src/app/api/v1/[...path]/route.ts`,
> `UPSTREAM_TIMEOUT_MS = 10_000`) and answers `502`. An api cold start took about 29 seconds in the local rehearsal, and an
> image pull on Azure comes on top. So the first visitor after about 5 idle minutes can get an error for a while. Therefore:
>
> - Before every judged session and every recording, run `.\infra\scripts\deploy-local.ps1 -Action Warm`.
> - Recommended: keep the api warm from 18 November to 11 December. Judges can arrive at any time. It costs about USD 12 a
>   month more (section 7).
> - Run `-Action Cool` afterwards, and while you build and test.
>
> `Deploy` and the smoke test inside it wait out a cold start. The configurable timeouts are already in the Bicep: it sets
> `UPSTREAM_TIMEOUT_MS` 10000 (safety routes) and `UPSTREAM_READ_TIMEOUT_MS` 45000 (everything else) on `web` (check C13), and
> the architect asked the frontend lane to read them. **Nothing reads them until that frontend change is merged**, so the
> fixed 10 seconds above is what a visitor meets today.

## Contents

1. [Status and what this is](#1-status-and-what-this-is)
2. [What Ali does, in order](#2-what-ali-does-in-order)
3. [Verify the public URL](#3-verify-the-public-url)
4. [The replay clock and the demo epoch](#4-the-replay-clock-and-the-demo-epoch)
5. [Real-phone push check](#5-real-phone-push-check)
6. [Roll back and recover](#6-roll-back-and-recover)
7. [What costs money, and how to stop it](#7-what-costs-money-and-how-to-stop-it)
8. [What the offline checks prove, and what only Azure can show](#8-what-the-offline-checks-prove-and-what-only-azure-can-show)
9. [The Azure steps that close the gap](#9-the-azure-steps-that-close-the-gap)
10. [The GitHub path (optional)](#10-the-github-path-optional)
11. [Run the offline checks yourself](#11-run-the-offline-checks-yourself)
12. [Fallbacks](#12-fallbacks)
13. [Troubleshooting](#13-troubleshooting)
14. [Deploy log and preflight log](#14-deploy-log-and-preflight-log)

## 1. Status and what this is

The demo is three Container Apps and one job on the Consumption profile, plus a Postgres server, in one resource group.
Only `web` is public. The `api` has internal ingress: nothing outside the Container Apps environment can call it, so
everything about the api is judged from its revision state and through the web proxy.

```text
  browser (judge, phone)
      |  https, public
      v
  web  (Next.js, public ingress, 0.25 vCPU / 0.5 GiB, always 1 replica)
      |        holds the demo token, per-client and global rate limits (ADR 0062)
      |  https, internal FQDN only
      v
  api  (FastAPI, internal ingress, 0.5 vCPU / 1 GiB, 0 or 1 replica)     alerts  (sb-jobs alerts run, no ingress,
      |                                                                          0.25 vCPU / 0.5 GiB, always 1 replica)
      +--------------------+-------------------+        job-migrate (run by hand by the deploy:
                           |                            infra/bicep/scripts/migrate.sh)
                           v                                     |
        Postgres Flexible Server (B1ms, 32 GiB, TLS verified, ADR 0042) <+
```

Names you will meet: resource group `rg-stellarblaze-demo-uaenorth`, apps `api`, `web`, `alerts`, job `job-migrate`,
registry `acrsb...` (Basic), identities `id-sb-apps` (pulls images) and `id-sb-deployer` (what GitHub Actions signs in as).

### 1.1 Cheap mode, the default design

Ali's ruling was "as cheap as possible". What that means in the Bicep:

| Part | Size and setting |
|---|---|
| `web` | 0.25 vCPU, 0.5 GiB, minimum 1 and maximum 1 replica (it measured about 73 MiB) |
| `api` | 0.5 vCPU, 1 GiB, internal ingress, maximum 1; **minimum 0 (cool, the default) or 1 (warm)** |
| `alerts` | an always-on worker app (`sb-jobs alerts run`), 0.25 vCPU, 0.5 GiB, no ingress, one replica |
| `job-migrate` | runs `infra/bicep/scripts/migrate.sh`: `sb-jobs db upgrade`, `sb-jobs site load`, and `alert_dispatch_interval_minutes = 1` in the runtime config. Every step is idempotent |
| Postgres | Burstable B1ms, 32 GiB (the minimum), 7-day backup |
| Log Analytics | daily cap 0.15 GB (inside the free 5 GB ingestion per billing account), retention 30 days (31 are free, a shorter retention saves nothing) |
| Registry | Basic |
| Budget alert | USD 75 a month, Bicep parameter `budgetAmount` in `infra/bicep/bootstrap.bicep` |

**Why the alerts app is a worker and not a job.** A one-minute scheduled job was built and measured, and rejected. One
`sb-jobs alerts dispatch` takes 58 to 62 seconds at 0.25 vCPU (Python imports alone: `sb-jobs --help` takes 17.7 seconds).
Executions would overlap the one-minute tick, and a Container Apps job has no concurrency policy. At that duration the job
costs about what the always-on worker costs (USD 19.44 against 19.71 a month), so there is no saving and more moving parts.
The reasoning and the parked option are in the plan deltas.

**Stop to phone in about 1 min 30 s.** `migrate.sh` sets the dispatch interval to 1 minute, so the alerts loop runs a cycle
every 60 seconds. A Stop an operator records reaches a phone within one period (60 s), plus the forecast-leg deadline
(15 s: `min(30 s, period / 4)`), plus one delivery deadline (15 s). That is about 1 min 30 s. The bound is in the docstring
of `backend/src/stellar_blaze/jobs/alerts.py` and in the help of `sb-jobs alerts run`. With the default interval of 5 minutes
it would be about 5 min 45 s.

### 1.2 Cool and warm: scale to zero

| Mode | Api minimum replicas | When | Cost |
|---|---|---|---|
| **cool** (default) | 0 | Building, testing, waiting | The api bills only while it runs |
| **warm** | 1 | Before every judged session and recording; recommended 18 November to 11 December | About USD 12 a month more (the idle rate of 0.5 vCPU and 1 GiB) |

Cool means a request after about 5 idle minutes meets an api that is not running (a cold start measured about 29 seconds in
the local rehearsal; the image pull on Azure comes on top). Today the web proxy answers `502 Upstream unavailable` after 10
seconds, so the visitor sees an error until the api has started. The architect has asked the frontend lane to make that
timeout configurable: `UPSTREAM_TIMEOUT_MS` for the safety routes (Stop work and the unwell actions; stays 10000) and
`UPSTREAM_READ_TIMEOUT_MS` for everything else (this deploy sets 45000 on `web` through Bicep, check C13). Until that frontend
change is merged nothing reads those two variables. Whether the ingress would hold a request during scale-from-zero is not
documented and is not verified. Either way the safety routes keep the short timeout, so keep the api WARM while judges can
arrive.

**The default sequence (architect's ruling, with dates):**

| When | Command | Why |
|---|---|---|
| Mon 16 to Tue 17 November | `Deploy` (cool, the default) | build, test, rehearse; the api bills only while it runs |
| **Wed 18 November** | `-Action Warm` | the api stays warm from now on; Warm ends with one demo reset |
| Before each judged session (20 to 30 November) and each GITEX day (7 to 11 December) | `-Action ResetDemo` | a fresh demo day (about 7 h 20 min per epoch); subscribe phones AFTER the reset |
| **After GITEX, 11 December** | `-Action Cool`, then teardown | stop paying for a warm api, then delete everything: `-Action Teardown` prints the command, you run it |

```powershell
.\infra\scripts\deploy-local.ps1 -Action Warm
.\infra\scripts\deploy-local.ps1 -Action Cool
```

`Warm` runs `az containerapp update --min-replicas 1 --max-replicas 1` on the api, waits until the new revision passes the
revision gate (a replica must run and be healthy), checks that Azure reports the scale you asked for, runs one demo reset (a
new epoch, section 4; if the reset answers 429 it waits the `Retry-After`, up to 120 seconds, and tries once more), and only
then records the mode in `state.json`. `Cool` does the same with `--min-replicas 0`, accepts a revision with no replica, and
does not reset. If a step fails, the recorded mode does not change. The scale itself is already changed once the update has
run, so a failure at the reset leaves the api warm and the mode still recorded as cool: the error says so, `Status` warns
about the difference, and running `-Action Warm` again is safe. A `Deploy` without `-Warm` or `-Cool` keeps the recorded
mode, so a re-deploy never flips it. `Status` shows the mode.

Two ways to deploy share the same Bicep and the same two-phase order:

- **The local path (this file, sections 2 to 9).** `.\infra\scripts\deploy-local.ps1`, native PowerShell, your own `az`
  session, your own Docker. State and secrets live outside the repository, in `%LOCALAPPDATA%\stellar-blaze-i1\`:
  `secrets.json` (the database password, the demo token, the VAPID key pair; readable by your Windows account only) and
  `state.json` (identifiers only, no secrets). Nothing secret is ever written to the repository or printed.
- **The GitHub path (section 10, optional).** `.github/workflows/deploy.yml`, once the repository exists.

The scripts under `infra/scripts/*.sh` are used by the GitHub path and by the offline tests. On Windows you do not run them
by hand, except where this file says so (section 13, last rows).

## 2. What Ali does, in order

Do these in one PowerShell window, from the repository root (the folder that holds `infra\`). Keep that window open: a new
window loses the `$Email` variable of step 4.

| Step | What | Time | Costs money? | What it proves |
|---|---|---|---|---|
| 1 | Azure account | 60 to 90 min | No | You can create a subscription |
| 2 | Tools and sign-in | 15 to 30 min | No | `az` and Docker work |
| 3 | `Doctor` | 1 to 2 min | No | Region, quota, providers, Owner role look right |
| 4 | `InitSecrets` | seconds | No | Secrets exist outside the repository |
| 5 | `Bootstrap` | 2 to 4 min | Registry (about USD 5 a month) | Your account can create the foundation |
| 6 | Wait | 10 min | No | The registry pull permission has propagated |
| 7 | `Validate` | 1 to 3 min | No | Azure accepts both Bicep phases (read-only) |
| 8 | `Deploy -Placeholder` (optional) | 15 to 30 min | Yes, from here | The Azure plumbing works with public images |
| 9 | `Deploy` | 30 to 60 min the first time | Yes | The real images run, migrate and pass the smoke test |
| 10 | Verify; `Warm` on Wed 18 November (not before); `ResetDemo` | 5 min | Warm adds about USD 12 a month | The public URL works, with no cold start once warm, inside the demo window |

The times are estimates from the image sizes and Azure's documented timings (unverified). Slow-network facts: the api image is
1.8 GB on disk and 427 MB compressed, the web build can take 10 minutes, and Postgres creation takes 5 to 15 minutes
during which nothing prints. Do not close the window while a step runs.

### Step 1. The Azure account (plan Task 0)

1. **Check free-account eligibility.** The Azure free account (USD 200 credit for 30 days, plus 12 months of a free B1ms
   Postgres) is for new Azure customers only. If your Microsoft account has ever had an Azure subscription or trial, the free
   account is unavailable on it and everything is pay-as-you-go (section 7).
2. **Sign up** at https://azure.microsoft.com/free with a phone number and a **non-prepaid** card. Confirm Pakistan is in the
   offer's country list.
3. If the card is rejected or the sign-up is blocked and not fixed within about 4 hours, stop and take fallback step 2
   (section 12). A sign-up you have not tried has not failed.
4. Around 1 December, upgrade the free account to pay-as-you-go (portal, Subscriptions, Upgrade). That keeps the 12-month free
   services and stops the subscription being disabled when the credit lapses. The USD 200 credit lasts 30 days from the day
   the account was created (an account created on 16 November lapses about 16 December, after GITEX), not until 11 December;
   11 December is the teardown date (section 7). Note the sign-up date and add 30 days (ADR 0001).

### Step 2. Tools and sign-in

Docker Desktop and Git for Windows are needed. If either is missing, install it:

```powershell
winget install --exact --id Docker.DockerDesktop
winget install --exact --id Git.Git
```

Docker Desktop needs a restart or a sign-out after its first install, and it must be **running** (wait until it says so)
before any step that builds or checks the daemon. Open a new PowerShell window after installing Git so `git` is on the path.
Then check:

```powershell
Set-Location D:\dev\stellar-blaze-i1
docker info --format '{{.ServerVersion}}'
git --version
```

Expect a Docker server version (for example `29.5.3`) and `git version 2.x`. If `docker info` says it cannot connect to the
daemon, Docker Desktop is not running yet. Change the `Set-Location` path if your checkout is
elsewhere. Then allow local scripts to run and clear any download marks on the repository scripts:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
Get-ChildItem -Path .\infra -Recurse -Filter *.ps1 | Unblock-File
```

Expect no output. Install the Azure CLI, then close the window and open a **new** PowerShell window in the repository root so
`az` is on the path:

```powershell
winget install --exact --id Microsoft.AzureCLI
```

Expect a download and `Successfully installed`. After the new window is open:

```powershell
Set-Location D:\dev\stellar-blaze-i1
az version
```

Expect JSON with `"azure-cli"` at `2.92.0` or newer. Then:

```powershell
az bicep install --version v0.49.2
az bicep version
az extension add --name containerapp --upgrade
```

Expect `Bicep CLI version 0.49.2` from the second command. The pin matters: the files were linted with this version. The
extension add prints nothing or a short progress line.

Sign in (a browser window opens), and pick the subscription:

```powershell
az login
az account list -o table
```

If the table has one row, you are done with the subscription. If it has several, copy the `SubscriptionId` of the right one:

```powershell
az account set --subscription "00000000-0000-0000-0000-000000000000"
```

(Replace the zeros with your id.) Then confirm:

```powershell
az account show --query "{sub:id, tenant:tenantId, user:user.name}" -o table
```

Expect one row with the subscription and account you meant. Register the seven resource providers, once per subscription
(2 to 5 minutes; each command returns when its provider is registered and normally prints nothing):

```powershell
"Microsoft.App","Microsoft.OperationalInsights","Microsoft.Insights","Microsoft.DBforPostgreSQL","Microsoft.ContainerRegistry","Microsoft.ManagedIdentity","Microsoft.Consumption" | ForEach-Object { az provider register --namespace $_ --wait }
```

### Step 3. Doctor (nothing is created)

Doctor is the preflight. It checks the tools, the sign-in, the seven providers, that UAE North offers Container Apps
environments and Postgres B1ms, that you are Owner, and the state of the git tree. It also picks the Postgres major version
(18 if a `"18"` entry can be found in the SKU list, else 17) and saves it in `state.json`.

```powershell
.\infra\scripts\deploy-local.ps1 -Action Doctor
```

Expect about 17 `PASS` lines and the summary `Doctor: 17 PASS, 0 WARN, 0 FAIL.` (exit code 0), then the api mode line and the
cost reminder, for example:

```text
PASS az 2.92.0
PASS az bicep: Bicep CLI version 0.49.2 (...)
PASS az extension containerapp ...
PASS docker daemon reachable (server 29.5.3)
PASS signed in as <you>
PASS subscription <name> (<id>)
PASS provider Microsoft.App registered          (seven of these)
PASS Microsoft.App managed environments available in uaenorth
PASS PostgreSQL Standard_B1ms offered in uaenorth; a version 18 entry exists, so PostgreSQL 18 will be used (unverified text match)
PASS signed-in user is Owner on the subscription
PASS git working tree is clean

Doctor: 17 PASS, 0 WARN, 0 FAIL.
api mode : cool (the next Deploy puts the api at minReplicas 0; ...)
```

A `WARN` is not a failure: `PostgreSQL 17 will be used` means no 18 entry was found, and a dirty git tree means Deploy will
refuse to build until you commit (or pass `-AllowDirty`). A `FAIL` says what to run; fix it and run Doctor again. Write
the result in the Preflight log (section 14).

### Step 4. InitSecrets (back up the file now)

Type your real email address once (the push services see it as the VAPID subject, so it must be an address you read):

```powershell
$Email = Read-Host 'Your real email address'
.\infra\scripts\deploy-local.ps1 -Action InitSecrets -VapidSubject "mailto:$Email"
```

Expect `Secrets written to: C:\Users\<you>\AppData\Local\stellar-blaze-i1\secrets.json`, the VAPID public key (not a secret),
and `Back this file up in your password manager now`. The script refuses placeholder subjects such as `example.com`. If the
file already exists it is **not** changed (replacing it needs `-Force`, and the new database password would no longer match a
database that already exists).

Back the file up now. Open its folder and attach `secrets.json` to a password-manager entry:

```powershell
explorer "$env:LOCALAPPDATA\stellar-blaze-i1"
```

Without this file you cannot redeploy to the same database or rebuild the same keys.

### Step 5. Bootstrap (one time, as Owner)

Creates, at subscription scope: the resource group, a USD 75 monthly budget with email alerts (section 7), two managed
identities, the registry (Basic) and every role assignment. It shows the what-if first, then asks before it creates anything.

```powershell
.\infra\scripts\deploy-local.ps1 -Action Bootstrap -ContactEmail $Email
```

Expect, in order: the line `[1/3] what-if (nothing is created yet; expect only + Create on a first run)`, the what-if
listing only `+ Create` entries (no `-` delete, no `~` modify): the resource group, the budget, two identities, the registry
and the role assignments. Then the prompt `Create these resources now? Type 'yes' to continue`. Type `yes`. Then
`[2/3] creating (2 to 4 minutes)...`, `[3/3] reading the outputs...`, and:

```text
Registry: acrsb<13 characters>.azurecr.io    Resource group: rg-stellarblaze-demo-uaenorth
Saved to state.json (identifiers only, no secrets).
```

Bootstrap saves the budget month in `state.json`, so a re-run in a later month uses the same month (the Consumption API
rejects a budget start date in the past; `-BudgetMonth yyyy-MM` supplies it if `state.json` is lost). To add the GitHub
federated credential later, re-run it with `-GitHubOwner` (section 10). To use another region, pass `-Location` (section 12).

### Step 6. Wait 10 minutes

The AcrPull role assignment of `id-sb-apps` takes minutes to propagate. Until it does, the first image pull fails with an
unhelpful provisioning error (Microsoft documents up to about 10 minutes).

```powershell
Start-Sleep -Seconds 600
```

Expect the prompt to return after 10 minutes. If you do step 8 next, its 15 to 30 minutes cover the wait as well.

### Step 7. Validate (read-only)

```powershell
.\infra\scripts\deploy-local.ps1 -Action Validate
```

It runs `az deployment group validate` and `what-if` for both phases (phase 1: environment, Postgres, `job-migrate`; phase 2:
the three apps). It creates nothing and costs nothing. The images need not exist. Expect:

```text
PASS phase 1 (DEPLOY_APPS=false) template validation by ARM (az deployment group validate)
PASS phase 1 (DEPLOY_APPS=false) what-if: <n> create, 0 modify, 0 delete, <n> no change
PASS phase 2 (DEPLOY_APPS=true) template validation by ARM (az deployment group validate)
PASS phase 2 (DEPLOY_APPS=true) what-if: <n> create, ...
Validate: all checks passed.
```

Phase 2 may list the job and Postgres as no change or as create. That is what a deployment on top of phase 1 would do. A
`FAIL` prints the first lines of the Azure error and nothing was created. Add `-Placeholder` to validate the placeholder set.
`-Warm` or `-Cool` validates with the api at one replica or zero.

This is the first time Azure itself reads the template. Two things only Azure can show may surface here or in phase 1 of the
deploy: whether ARM accepts a fractional `dailyQuotaGb` (0.15) and `objectKeys` on a secure object (section 8). If either is
rejected, the error says which.

### Step 8. Deploy -Placeholder (optional rehearsal, creates billable resources)

Rehearses the Azure plumbing with public Microsoft quickstart images: no build, no push, no migration, no alerts worker. It
needs no Docker. It creates the environment, the log workspace, Postgres, `job-migrate` and two placeholder apps.

```powershell
.\infra\scripts\deploy-local.ps1 -Action Deploy -Placeholder
```

Expect a summary (subscription, resource group, tag `placeholder`, mode PLACEHOLDER, PostgreSQL version, api mode), the
template checks `PASS T1`, `PASS T2`, `PASS T3`, then the prompt `This creates billable Azure resources` (type `yes`), then
the steps `[1/18]` to `[18/18]`. Step `[8/18]` (phase 1) prints nothing for 5 to 15 minutes while Postgres is created. At the
end:

```text
PASS GET https://web.<environment>.uaenorth.azurecontainerapps.io/ answered 200 (the demo smoke test is skipped for placeholders)
Web (public) : https://web.<...>.azurecontainerapps.io
```

Open that URL: the Microsoft quickstart page appears. This does not prove the registry pull (placeholders come from a public
registry) and the demo smoke test does not run. It does prove: the Bicep deploys, the environment and Postgres exist, ingress
works, and the revision gates read the apps. The real `Deploy` replaces these apps and keeps the database.

### Step 9. Deploy (the real thing)

Commit your changes first: Deploy refuses a dirty git tree because the image tag is the commit (`-AllowDirty` tags
`<sha>-dirty-<timestamp>` instead).

```powershell
.\infra\scripts\deploy-local.ps1 -Action Deploy
```

What it does, in order (each prints `[n/18]`):

1. `[1/18]` pre-checks (`az` signed in, the containerapp extension, Docker, the Postgres version, the api mode) and a refusal
   of a dirty git tree; `[2/18]` the image tag.
2. `[3/18]` the ADR 0042 template checks **T1 to T3**, offline, before anything is built: the database URL has
   `ssl=verify-full`, no weaker mode exists, and `PGSSLROOTCERT` is defined for api, alerts and `job-migrate`. Then the cost
   reminder and the prompt `This creates billable Azure resources` (type `yes`, or pass `-Yes`).
3. `[4/18]` to `[7/18]`: logs in to the registry, builds the api and web images with your local Docker (ACR Tasks is paused
   for free-credit subscriptions), checks that the api image trusts both Azure Postgres root certificates (ADR 0042), and
   pushes both images (the api is 427 MB compressed: the slow step on a slow network).
4. `[8/18]` Bicep phase 1: environment, Postgres, `job-migrate` (5 to 15 minutes if Postgres is new).
5. `[9/18]` the migration: `job-migrate` runs `migrate.sh` (upgrade, site load, dispatch interval 1; all idempotent). One
   automatic retry after 90 seconds covers a late AcrPull assignment. The first `site load` starts epoch 1 of the demo site.
6. `[10/18]` Bicep phase 2: api (internal, minimum 0 or 1 by mode), web (public), alerts worker.
7. `[11/18]` the deployed checks **T4** (the stored `sb-database-url` secret of api, alerts and `job-migrate` has
   `ssl=verify-full`) and **T5** (their `PGSSLROOTCERT` entry has the expected path). Secret values are never printed.
8. `[12/18]` the revision gates, up to 300 seconds: for each app the latest revision must be the latest *ready* revision,
   run the image just built, be `Provisioned`, `Running` and `Healthy`, and (apps with ingress) carry 100 percent of
   traffic. A cool api may have 0 replicas and still pass. The state (`lastTag`, the addresses, the mode) is saved right
   after the gates and before the smoke test, so a failed smoke test is retried against the real deployment.
9. `[13/18]` the exposure and cost checks **S1** (only the Consumption profile, no private endpoint), **S2** (web and alerts
   are 1 / 1, the api is 0 / 1 cool or 1 / 1 warm), **S4** (api ingress internal, web external, alerts none) and **S6** (every
   resource in one region).
10. `[14/18]` restarts api (when it has a replica), alerts and web back to back, then gates them again. Container Apps makes
    no new revision when only secret values change, so rotated secrets reach running replicas only after a restart. A
    scaled-to-zero api has nothing to restart: it reads its secrets at the next cold start.
11. `[15/18]` waits up to 2 minutes for `/api/healthz`, then up to 5 minutes for `/api/v1/health/ready` through the web (this
    is the wait that wakes a scaled-to-zero api; the first Deploy prints a cold-start notice there, which is normal), and
    starts a new demo epoch (a demo reset, section 4).
12. `[16/18]` the HTTP smoke test through the web (section 3). It waits for the web and the api first, and for 62 seconds at
    the end, so the rate-limit window it drained is clear.
13. `[17/18]` a final demo reset (a clean epoch and a fresh clock for the first session); `[18/18]` done.

Expect at the end:

```text
[18/18] done

Web (public) : https://web.<environment>.uaenorth.azurecontainerapps.io
Api (INTERNAL, not reachable from the internet; web calls it): https://api.internal.<...>
Api mode: cool (the api scales to zero when idle; the first request after idle is slow). ...
Demo day: Deploy ended with a new epoch, so the replay day starts at the anchor (10:10 Asia/Dubai) now and lasts about 7 h 20 min ...
```

Every `Deploy` is safe to re-run: Bicep is incremental, the migration is idempotent, and a failed step stops the run. A real
deploy with no `job-migrate` is an error, never a silent skip. Record the run in the Deploy log (section 14).

Switches of `Deploy`: `-Warm` or `-Cool` (the api mode; not both), `-SkipBuild` (reuse the images already in the registry for
this commit; needs a clean tree), `-AllowDirty`, `-Placeholder`, `-PostgresVersion 17|18`, `-NoRevoke` (section 13),
`-Yes` (answer the prompt).

### Step 10. Verify, Warm and ResetDemo

Section 3 verifies the URL. The first `Deploy` leaves the api **cool**, and the default sequence (section 1.2) keeps it cool
until **Wednesday 18 November**. So `Warm` is not part of the first deploy:

- **Default.** Run `-Action Warm` on Wed 18 November, or at once if the first deploy happens on or after the 18th, and keep
  it warm until the end of GITEX (section 1.2).
- **Alternative, cool until the 18th.** Do not run `Warm` yet. Verify with `Test-DemoHttp.ps1 -BaseUrl <web url>
  -WaitReady` (section 3), and run `-Action Warm` before any judged session or recording that comes earlier.

```powershell
.\infra\scripts\deploy-local.ps1 -Action Warm
```

Expect `PASS gate api`, `PASS S2 api scale is min 1 / max 1`, then the demo reset, and only then `The api is warm (recorded
at <time>)`:

```text
POST https://web.<...>/api/v1/sites/site-demo-mussafah/demo-reset
Demo reset: epoch <n> started (the epoch before was <n-1>) at <time>.
```

`Warm` already runs a reset (it waits out one 429 by itself, up to 120 seconds, for example when a smoke test ran a minute
ago). If the api is already warm and a session is coming, run only the reset:

```powershell
.\infra\scripts\deploy-local.ps1 -Action ResetDemo
```

Do not run `ResetDemo` within a minute of `Warm` (or of another reset): the reset is limited to 1 per 60 seconds and a second
one answers 429.

All actions of `deploy-local.ps1` (`-Action`, one of):

| Action | What it does | Creates or changes Azure? |
|---|---|---|
| `Doctor` | Preflight (step 3) | No |
| `InitSecrets` | Writes `secrets.json` (step 4) | No |
| `ShowSecrets -IUnderstand` | Prints five values for the Render fallback (section 12) | No |
| `Bootstrap` | The foundation (step 5) | Yes |
| `Validate` | Validate and what-if of both phases (step 7) | No |
| `Deploy` | Build, push, migrate, deploy, check, restart, reset, smoke, reset (step 9) | Yes |
| `Warm` | Api minimum 1, then one demo reset | Yes (scale) |
| `Cool` | Api minimum 0 | Yes (scale) |
| `ResetDemo` | A new demo epoch through the web; restarts nothing. `ResetClock` is the old name and still works | No |
| `Smoke` | The HTTP checks again (section 3) | No (writes one stop and its undo to the audit) |
| `Status` | Reads the apps, the api mode, the anchor and the last recorded reset | No |
| `Teardown` | Prints the delete command; never runs it (section 7) | No |

Other switches: `-Location`, `-ResourceGroup`, `-ContactEmail`, `-VapidSubject`, `-GitHubOwner`, `-BudgetMonth`, `-Force`
(`InitSecrets` only: replace `secrets.json`), `-IUnderstand` (`ShowSecrets` only). `-Warm` and `-Cool` as switches go only
with `Deploy` or `Validate`.

## 3. Verify the public URL

Read the address from `state.json` and look at it:

```powershell
$s = Get-Content "$env:LOCALAPPDATA\stellar-blaze-i1\state.json" -Raw | ConvertFrom-Json
"https://$($s.webFqdn)"
curl.exe -s "https://$($s.webFqdn)/api/healthz"
```

Expect the URL, then JSON with `status` `ok` and a `version` that is the image tag (the 12-character commit). This answers
from the web alone and never wakes the api.

```powershell
curl.exe -s "https://$($s.webFqdn)/api/v1/health/ready"
```

Expect JSON with `"status":"ok"`. That is the web proxy reaching the api, and the api reaching Postgres over verified TLS.

**Cold api.** If the api is cool and idle, this call can answer `502` with a problem document titled `Upstream unavailable`
after 10 seconds. That is the cold start, not a fault. Ask again every few seconds; it should turn `200` within about a
minute (unverified on Azure). `Warm` avoids it.

The api is private. From outside the environment, its address must not answer:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" "https://$($s.apiFqdn)/api/v1/health/live"
```

Expect `404` (Container Apps answers 404 to a caller outside the environment) or no answer. Never `200`. Unverified.

Then run the smoke test. With a cool api, use the version that waits for it:

```powershell
.\infra\scripts\Test-DemoHttp.ps1 -BaseUrl "https://$($s.webFqdn)" -WaitReady
```

`-Action Smoke` runs the same checks without the cold-start wait, so use it when the api is warm (after `Warm`). On a cool,
idle api it fails within seconds with a `502` on H2, because the web proxy gives up after 10 seconds (run `-Action Warm`
first, or use the `-WaitReady` form above):

```powershell
.\infra\scripts\deploy-local.ps1 -Action Smoke
```

Expect these lines (the `Deploy` run already printed them once):

```text
PASS H1 GET /api/healthz 200, status ok, version <tag>
PASS H2 GET /api/v1/health/ready through the BFF 200, status ok (web to api works)
PASS H3 Stop work: stop <id> created 201, cleared 204 after <n> s, timeline has no red
PASS H4 replay clock reads <time> Asia/Dubai (inside 10:00-17:30)
PASS H5 plain http is not served: ...
PASS H7 a forged Authorization header on a route off the allow-list is refused: <401|403|404>
PASS H6 forged X-Forwarded-For did not escape the rate limit: 429 with Retry-After <n> at request <i>
SMOKE OK
```

What each proves: **H1** web is up. **H2** web reaches the api, and the api reaches the database (its curl limit is 180
seconds; with `-WaitReady` the api has already been woken by the poll that runs first, `Wait-DemoApi`, 30 seconds per poll,
so H2 only confirms it). **H3** a Stop and its undo work through the proxy (the
BFF injects the demo token). **H4** the replay clock is inside the demo window (section 4). **H5** plain HTTP is not served.
**H7** a visitor's own bearer token does not stand in for the demo token. **H6** a forged `X-Forwarded-For` still hits the
rate limit, which is the proof of `TRUSTED_PROXY_HOPS=1` behind the real ingress. H6 runs last and drains the general
rate-limit bucket for about a minute: for that minute day-plan reads answer 429, and a demo reset does too, because the
reset draws on the same bucket. Wait a minute before `ResetDemo` or a judged session. Every smoke run also records one stop
and its undo in the append-only audit (ADR 0054), by design, and leaves a trace in the epoch: run `ResetDemo` after it.

Then open it in a browser and look: `https://<web>/en` (landing), `https://<web>/en/supervisor/crews/crew-b` (the Stop work
button), `https://<web>/en/worker/alerts` (alerts), `https://<web>/en/replay/governance` (the Reset demo site button). The
pages load, the synthetic-demo label shows, and data appears.

## 4. The replay clock and the demo epoch

In replay mode the clock is the anchor `SB_REPLAY_NOW` (default `2026-06-14T10:10:00+04:00`, 10:10 in Dubai) plus the wall time
since the **start of the current epoch**. The epoch is a row in Postgres, so the api and the alerts worker read the same
value and always agree, and a restart of either changes nothing (ADR 0034, amendment of 2026-11-15; backend commit b731bd4).
Consequences:

- `sb-jobs site load` starts epoch 1 at the **first** deploy only. A later deploy does not move the clock by itself.
- A **demo reset** starts a new epoch and re-anchors the clock. It is `POST
  /api/v1/sites/site-demo-mussafah/demo-reset` through the web, which injects the demo token. The `Reset demo site` button on
  `/en/replay/governance` does the same.
- One epoch lasts about **7 h 20 min** (replay time passes 17:30 Asia/Dubai), whether or not anyone looks. After that the
  smoke check H4 fails, until the next reset.
- A reset drops the stops, sign-offs, alert events and **push subscriptions** of the old epoch. Nothing is deleted and the
  audit continues. Subscribe a phone only **after** the last reset before a session.
- The reset is limited upstream to 1 per 60 seconds and 10 per hour. The web's general rate-limit bucket counts it too, and
  smoke check H6 drains that bucket for about a minute.

So run this before every judged session and every recording:

```powershell
.\infra\scripts\deploy-local.ps1 -Action ResetDemo
```

`ResetClock` still works as an old name and prints a note; it restarts nothing. Expect:

```text
POST https://web.<...>/api/v1/sites/site-demo-mussafah/demo-reset
Demo reset: epoch <n> started (the epoch before was <n-1>) at <time>.
The demo day restarts at the replay anchor (SB_REPLAY_NOW, 10:10 Asia/Dubai) and lasts about 7 h 20 min. ...
Nothing was restarted: the clock of api and alerts follows the epoch, which the database holds.
```

On a cool, idle api, `ResetDemo` returns a `502` within seconds: the web proxy aborts its call to the api after 10 seconds
until the frontend change that makes the timeout configurable is merged (the script prints the status it got). Run
`-Action Warm` first (it ends with a reset). A `429` prints its `Retry-After`: wait that long and run it again.

`Deploy` ends with this sequence on its own: restart (the api only if it has a replica, then alerts and web), reset, smoke
test, final reset. The bash twin for the GitHub path and for a laptop with Git Bash is `bash infra/scripts/reset-demo.sh
<web-url>` (add `--retry-after-once` to wait out one 429). `bash infra/scripts/restart-apps.sh <resource-group>` exists only so
that rotated secret **values** reach running replicas; it is not needed for the clock. The old `restart-replay-clock.sh` and
the `-ReplayNow` switch no longer exist: a restart does not move the clock, and the anchor is set in the Bicep.

To look without changing anything:

```powershell
.\infra\scripts\deploy-local.ps1 -Action Status
```

Expect one block per app (`OK` or `NOT OK`, revision, replicas, image), the line `api mode : cool|warm (recorded in
state.json ...)`, a `WARN` if the api's scale does not match the recorded mode, the replay anchor, and
`Last reset recorded by this script: epoch <n>, <time> (<h> h ago)`. Status cannot read the epoch (it is a row in the
database), so it cannot say where the clock is now; it warns when more than 7 h 20 min have passed since the last reset it
recorded. To read the clock, the H4 line of a smoke test is the evidence.

## 5. Real-phone push check

Needs a real phone and a real push service. It cannot be tested offline. Do it once, in daylight, with 15 minutes to spare.
With a cool api, run `-Action Warm` first.

1. **Prepare.** Run `-Action ResetDemo` (section 4) and wait for it to finish. Do **not** reset again after this point:
   push subscriptions belong to the current epoch (ADR 0066), so a reset after subscribing drops yours.
2. **Open the URL on the phone** (the https address from section 3). Android: Chrome. iOS: Safari 16.4 or newer.
3. **Install the PWA.** Android: browser menu, Install app (or Add to Home screen). iOS: Share, Add to Home Screen, then open
   it **from the home-screen icon**: iOS delivers web push only to an installed PWA.
4. **Subscribe.** Open `/en/worker/alerts` and press `Turn on alerts`. Allow the notification prompt. Expect `Alerts are on for
   this site.` If it says `This browser's push service is not supported, so alerts cannot be turned on here.`, the server
   answered 422 `endpoint-host-not-allowed`: ADR 0067 accepts only these push hosts, HTTPS only: Google FCM
   (`fcm.googleapis.com`), Mozilla autopush (`updates.push.services.mozilla.com`), Apple Web Push (`*.push.apple.com`) and
   Windows WNS. Use a phone browser that uses one of them.
5. **Trigger a Stop** from a laptop: open `https://<web>/en/supervisor/crews/crew-b`, press `Stop work`, pick a reason. **Do not
   press Undo.** A stop undone within 10 seconds is ignored entirely for levels and alerts, so nothing would be sent.
6. **Wait about 2 minutes.** The alerts worker runs a cycle every 60 seconds (`migrate.sh` sets the dispatch interval to 1),
   and a stop an operator records is delivered within about 1 min 30 s (section 1.1). If nothing came after 2 minutes, see
   below; do not tap Stop again.
7. **Expect** a notification on the phone about crew B going to Red. Check that the VAPID subject in `secrets.json` is the
   real `mailto:` address you typed in step 4, not a placeholder.
8. **Record the measured stop-to-phone time, with the date** (the architect's wording rule, ADR 0072: until this is measured,
   any copy says only "within a few minutes"; the 1 min 30 s of section 1.1 is COMPUTED from the documented deadlines, never
   measured). Do three runs. For each: press `Stop work` and start a stopwatch at the same moment, stop it when the phone
   buzzes. A crew that is already Red sends nothing new, so use a different crew per run (`crew-b`, `crew-c`, `crew-d` at
   `https://<web>/en/supervisor/crews/<crew>`) if the phone is subscribed for the whole site; if it turns out to be
   subscribed to one crew only, run `-Action ResetDemo`, subscribe again (step 4) and use `crew-b` each time. Write the three
   numbers, the date, the phone and the browser in the table in section 14 ("Push measurements"). Quote the median once you
   have it; until then say "within a few minutes".

VAPID: the subject (`mailto:...`) in `secrets.json` must be a real address (push services, Apple's in particular, can reject a
token whose subject is not a valid `mailto:` or `https:` address, which is why InitSecrets refuses `example.com`). The public
key the web app serves and the private key the alerts worker signs with must be a pair: both come from `secrets.json`. If you
ever replace `secrets.json` with `-Force`, deploy again.

If nothing arrives, read the alerts worker's log. The quick way (unverified for this setup):

```powershell
az containerapp logs show --name alerts --resource-group rg-stellarblaze-demo-uaenorth --type console --tail 50
```

Or in the portal, Log Analytics workspace of the resource group, Logs (a few minutes of delay):

```text
ContainerAppConsoleLogs | where ContainerAppName == "alerts" | order by TimeGenerated desc | take 50
```

If that table does not exist (the Dedicated log tables are unverified; the diagnostic setting may write to the shared table),
use the fallback:

```text
AzureDiagnostics | where Category == "ContainerAppConsoleLogs" and ContainerAppName_s == "alerts" | project TimeGenerated, Log_s | order by TimeGenerated desc | take 50
```

What to look for: `alerts.event` with `delivered=1 failed=0` is a delivery. `delivered=0 failed=0` means no subscription for
that crew (subscribe again, after any reset). `alerts.send_deadline`, `alerts.channel_raised`, `alerts.deliver_failed` or
`alerts.cycle_failed` are failures with a reason. No `alerts.event` line at all after 2 minutes means the worker never saw the
stop: check that you did not undo the stop, that no reset happened after it, and that the alerts app has one replica
(`-Action Status`). The log only holds what fits under the daily cap of 0.15 GB (section 1.1).

## 6. Roll back and recover

- **A new revision that is not ready.** The apps run in single-revision mode, so the old revision keeps serving while a new
  one is not ready. A failed `Deploy` therefore leaves the last good demo up. The revision gate says which app and why.
- **Run `Deploy` again.** It is safe to re-run. After fixing a cause (for example waiting for AcrPull), re-run it.
- **Go back to an earlier commit.** The same commands redeploy any commit: check out the commit, then deploy.
  `-SkipBuild` reuses the images already in the registry for that commit (needs a clean tree):

  ```powershell
  $s = Get-Content "$env:LOCALAPPDATA\stellar-blaze-i1\state.json" -Raw | ConvertFrom-Json
  az acr repository show-tags --name $s.acrName --repository sb-api --orderby time_desc --top 5 -o table
  ```

  Pick a tag (it is the 12-character commit), `git switch --detach <that commit>`, then
  `.\infra\scripts\deploy-local.ps1 -Action Deploy -SkipBuild`. Database migrations are never undone (they are fix-forward),
  so an older image runs against the newer schema: safe only if the migrations were backward compatible.
- **A stuck Stop.** A Stop that was not undone within 10 seconds stays Red to the end of the shift. Run
  `.\infra\scripts\deploy-local.ps1 -Action ResetDemo` (or press `Reset demo site` on `/en/replay/governance`): it starts a new
  epoch of the synthetic site, so the old Stop is no longer read (ADR 0066: nothing is deleted, the audit continues). The web
  allow-list includes `POST /api/v1/sites/site-demo-mussafah/demo-reset`, limited upstream to 1 per 60 seconds and 10 per
  hour. Check the status of ADR 0066 in `docs/decisions/` (its epoch key was undecided when this was written); the reset exists in the code. Then
  subscribe to alerts again (section 5).
- **Config rollback.** A runtime-config change is undone with `sb-jobs config rollback --actor <name> --reason "<at least 10
  characters>"` (`backend/README.md`). That needs a shell in the api container, and a cool api must be running (`-Action Warm`).
  Whether `az containerapp exec` works for this Container Apps setup (internal ingress, Consumption) is **unverified**:

  ```powershell
  az containerapp exec --name api --resource-group rg-stellarblaze-demo-uaenorth --command "sb-jobs config history --limit 5"
  ```

  If it does not, use the Console blade of the `api` app in the portal. The demo ships no config admin HTTP API (ADR 0052).
  Note that `migrate.sh` puts `alert_dispatch_interval_minutes = 1` into the active config only while the active config lacks
  it, so a rollback to a version without it is replaced by the next `Deploy`.
- **A rotated secret.** Container Apps makes no new revision for a secret-only change. After changing a secret value, run
  `Deploy` (it restarts the apps in step 14), or `bash infra/scripts/restart-apps.sh <resource-group>`.
- **Start over.** Section 7 prints the delete command. After it, run Bootstrap again before the next Deploy.

## 7. What costs money, and how to stop it

Billing starts at step 5 (the registry) and step 8 (everything else). The prices are the Azure Retail Prices API for UAE North
of 2026-11-15. They are list prices and a back-of-envelope, **not a quote**. A month is 730 hours (2,628,000 seconds).

**Unit prices (USD, UAE North).**

| Item | Price |
|---|---|
| Container Apps, active vCPU | 0.000024 per vCPU-second |
| Container Apps, active memory | 0.000003 per GiB-second |
| Container Apps, idle vCPU | 0.000003 per vCPU-second |
| Container Apps, idle memory | 0.000003 per GiB-second (memory is not cheaper when idle) |
| Container Apps, requests | 0.40 per million |
| PostgreSQL Flexible Server, Burstable B1ms | 0.02 per hour (14.60 a month) plus 32 GiB storage at 0.138 per GB-month (4.42): **19.02 a month**; the 7-day backup within 100 percent of the provisioned storage is free |
| Container Registry, Basic | 0.1666 per day, **5.07 a month**, 10 GiB included |
| Log Analytics | first 5 GB a month per billing account free, then 3.29 per GB; 31 days of retention are included in the ingestion price |
| Budget alert | free |

**Free grants applied.** Container Apps gives every **subscription** one monthly pool of the first 180,000 vCPU-seconds, 360,000
GiB-seconds and 2 million requests, free. The Azure free account adds a USD 200 credit that lasts **30 days** (the subscription
is disabled when it runs out, until it is upgraded to pay-as-you-go; the credit does not renew), and 12 months of a free B1ms
Postgres (750 hours, 32 GB storage, 32 GB backup). The free-account offers apply **only to new Azure customers**.

**Monthly totals, USD.** Assumptions: web active 30 minutes a day and idle otherwise; api (cool) active 2 hours a month and
scaled to zero otherwise; api (warm) up 8 hours a day for 30 days, 1 hour a day active and the rest idle; the alerts worker billed at
the **active** rate all month (it polls the database); 100,000 requests a month; Log Analytics inside the free 5 GB; cold-start
and image-pull seconds and the 300-second scale-down cooldown not modelled. "Grants A" takes the free vCPU-seconds from the
active meter first (cheapest case), "grants B" from the idle meter first (upper bound). How Microsoft allocates the grant
across meters is not documented.

| Scenario | Before grants | After grants A | After grants B | After grants A, Postgres on the free offer |
|---|---|---|---|---|
| **Cheap, cool** (api scaled to zero; the default) | 50.15 | 44.71 | 48.49 | 25.69 (B: 29.47) |
| **Cheap, warm 8 h a day** (api minimum 1 for 8 h a day) | 55.17 | 49.73 | 53.51 | 30.71 (B: 34.49) |
| Previous design (api 1 vCPU / 2 GiB min 1, web 0.5 / 1 min 1, alerts worker 0.5 / 1) | 101.90 | 96.46 | 100.24 | 77.44 (B: 81.22) |

Cheap mode saves about USD 50 a month against the previous design. The Container Apps part alone, after grants A, is 20.62
(cool), 25.64 (warm) and 72.37 (previous). The fixed items are the registry 5.07, Postgres 19.02 (0 on the free offer) and Log
Analytics 0. Keeping the api warm all day from 18 November to 11 December costs the idle rate of 0.5 vCPU and 1 GiB, about USD
11.83 a month before grants (0.5 x 0.000003 + 1 x 0.000003 per second, over 2,628,000 seconds).

**The rejected alerts job, for the record.** The alerts worker (0.25 vCPU, 0.5 GiB, always on, billed active) costs 19.71 a
month. A one-minute job at 60 seconds an execution costs 19.44 (a 30-day month of ticks): no saving. At 0.5 vCPU a dispatch
takes about 39 seconds and the job would cost about 25, more than the worker.

**The budget alert.** The Bicep parameter `budgetAmount` in `infra/bicep/bootstrap.bicep` defaults to **USD 75** (the
cheap-mode estimate of about 45 to 55 plus a 50 percent margin). It emails the address you gave Bootstrap at 80 and 100
percent of actual cost and at 100 percent of forecast cost. It sends email and changes nothing. To use another amount, add a
line `param budgetAmount = <n>` to `infra/bicep/bootstrap.bicepparam` and re-run Bootstrap, which shows the change in its
what-if before it asks (not exercised against a real budget).

**Caveats.**

1. The free Postgres offer is for **new** Azure customers only, and that it applies in UAE North is not verified.
2. The USD 200 credit lasts 30 days from the day the account was created (16 November gives about 16 December). Plan the
   upgrade to pay-as-you-go for about 1 December, or before the lapse date if the account is older (step 1, item 4; ADR 0001).
3. A meter `Environment Management Hour` at USD 0.10 an hour (USD 73 a month) exists in UAE North since 2026-11-01. Microsoft's
   pages say plan-management charges apply to Dedicated workload profiles only, but nothing confirms that a
   Consumption-only environment is exempt. **Check Cost Analysis after 24 to 48 hours** (section 9). If the meter applies, every
   figure above goes up by 73 and the budget alert fires, which is what it is for.
4. Scale-to-zero cold start: the first request after the api has been idle for 5 minutes waits for a replica to start (image
   pull, warm cache, config load). Microsoft's cold-start page says to retry on the client side and gives the ingress timeout
   as 240 seconds; whether the request is held is not documented. The web proxy gives up after 10 seconds. Use `-Action Warm`
   before judged sessions and recording.
5. These are list prices, not a quote.

**To stop all charges,** delete the resource group **after GITEX, 11 December 2026**. This command is **never run for you**.
Look at what it would delete:

```powershell
.\infra\scripts\deploy-local.ps1 -Action Teardown
```

It prints the command, which you copy and run yourself (for the default region):

```powershell
az group delete --name rg-stellarblaze-demo-uaenorth --yes --no-wait
```

It deletes everything in the group: apps, job, the database and its data, the registry and its images, the identities and
the logs. It cannot be undone. It does **not** delete the subscription budget or the bootstrap deployment record, nor your
local `secrets.json` and `state.json`. It returns at once. Confirm with `az group exists --name rg-stellarblaze-demo-uaenorth`,
which prints `false` after about 10 minutes.

**The Render fallback** costs about USD 28 a month at the measured sizes (four services at USD 7 plus a 1 GB disk;
`infra/render/README.md`). Nothing there scales to zero. It is only the TLS-correct fallback, not a cheaper way to host.

**An alternative that was costed and not built: one small VM.** (Decision: the architect.) One Standard_B2als_v2 Linux VM (2
vCPU, 4 GiB) in UAE North running the rehearsal compose behind Caddy for automatic HTTPS, deallocated when idle. Prices: VM
0.0451 an hour, 32 GiB Standard SSD E4 2.88 a month, Standard static public IPv4 0.005 an hour (3.65 a month, billed even
when the VM is deallocated).

| VM usage | USD a month |
|---|---|
| Running 24 hours a day | 32.92 + 2.88 + 3.65 = **39.45** (with a 64 GiB disk, E6 at 5.76: 42.33) |
| Deallocated all month | 2.88 + 3.65 = **6.53** (disk and IP only) |
| Running 8 hours a day, deallocated otherwise | 10.97 + 2.88 + 3.65 = **17.50** |

Excluded: disk operations, egress beyond the first 100 GB free, and SKU availability and quota in UAE North (unverified). The
operational risks are the reason it was not built: OS and Docker patching are ours; Postgres runs in a container on that
disk, so backups, restore and disk-full are ours; there is no managed-identity registry pull (images must reach the VM another
way); it is a single point of failure with only Docker's restart policy; TLS comes from Caddy's ACME on a
`<label>.uaenorth.cloudapp.azure.com` name; ports 80 and 443 are open to the internet; and the static IP keeps the address while
deallocated, which is why it costs money while idle. It is cheaper only when deallocated most of the time. Against Azure cheap
mode with a paid Postgres (about 45 to 50) it saves about 5 running 24 hours a day and about 25 to 30 at 8 hours a day, for much
more operational work.

## 8. What the offline checks prove, and what only Azure can show

Everything below ran with no Azure account. The totals come from each tool's own summary; the controller runs the final pass.

| Check | What it proves | What it cannot prove |
|---|---|---|
| Rehearsal R1 (migrate job exits 0) | `migrate.sh` (`sb-jobs db upgrade`, `site load`, the interval setting) runs against a TLS-only Postgres from the built api image | That Azure's Postgres accepts the same connection |
| R2 (migrate log shows the revision and the demo site) | The seed loads the synthetic site | Anything about Azure |
| R3 (api healthy, alerts running and dispatching with `interval_minutes 1`) | The apps start from the real images, the worker loops and reads the active config | Behavior on Container Apps |
| R4 (smoke test passes through a proxy) | The smoke script and web to api path work behind an nginx that appends `X-Forwarded-For` (H5 is skipped there: no https) | The real ingress's header behavior |
| R5 (`reset-demo.sh`: a new epoch) | The demo reset through the BFF starts a new epoch (skipped on a backend that predates the route) | Container Apps rate limits |
| R6 (an api restart does not rewind the replay clock) | The epoch clock survives a restart (skipped, never passed, on a backend that predates the epoch clock) | Anything about a real scale-from-zero |
| R7 (config has `alert_dispatch_interval_minutes` 1; a second migrate changes nothing) | `migrate.sh` is idempotent | Anything about Azure |
| R8 (one `alerts dispatch` at 0.25 vCPU / 0.5 GiB, timed) | Why the always-on worker stands: it prints SKIP when one dispatch exceeds 45 s, which is what the measurement shows (58 to 62 s) | Real Container Apps CPU limits (a docker quota stands in) |
| N1 (plaintext refused) | The database accepts TLS connections only | That Azure enforces it |
| N2 (wrong CA fails) | `ssl=verify-full` fails closed with an unrelated CA | The real Microsoft CA chain |
| N3 (wrong host name fails) | `verify-full` checks the host name | The real server certificate name |
| N4 (missing root fails) | `verify-full` with no `PGSSLROOTCERT` fails closed | Whether Azure's image trust store suffices (the deploy checks that) |
| N5 (`ssl=require` connects to an impostor) | Why `ssl=require` is forbidden (ADR 0042) | n/a |
| N6 (forged header evades the limiter only without the proxy) | Why the proxy hop count matters (`TRUSTED_PROXY_HOPS`) | The hop count behind the real ingress (smoke H6 on the public URL) |
| N7 (`ssl=require` with a root acts as `verify-ca`) | A finding for ADR 0042: the root file changes the behavior | n/a |
| Bicep lint and build (Bicep 0.49.2) | Syntax, types, linter rules; one accepted warning (`use-recent-api-versions`, diagnostic settings) | That ARM accepts the deployment |
| PSRule for Azure | Well-Architected rules over the expanded Bicep | Runtime behavior |
| Checkov (over the compiled templates) | Common misconfigurations | Runtime behavior |
| actionlint and `act` dry run | Workflow syntax; the `infra` job of `ci.yml` runs | A real GitHub run, OIDC login |
| hadolint | Dockerfile rules | The image's runtime behavior |
| trivy image scan (report only) | Known CVEs: api 60 HIGH and 1 CRITICAL (certifi, GHSA-6q48-6c7w-9gw2), web 54 HIGH, in dependencies and OS packages | That they are exploitable here |
| ShellCheck, PSScriptAnalyzer | Shell and PowerShell static rules | Behavior |
| Template checks `check-template.sh` (C1 to C13, B1 to B5) | The evaluated Bicep: outputs, environment, apps (the api's minimum follows `API_MIN_REPLICAS`, tried at 0 and 1), pins, the migrate job, VAPID, replay settings, secrets, phases; C11 every secret-carrying module parameter is a `securestring` or `secureObject`; C12 the cheap-mode sizes, the log cap and retention; C13 the web upstream timeouts (`UPSTREAM_TIMEOUT_MS` 10000 and `UPSTREAM_READ_TIMEOUT_MS` 45000, on `web` only); B1 to B5 the bootstrap (budget start, federated subject, role assignments, registry, budget amount) | That ARM accepts it, or that the deployed values match |
| `check-db-tls.sh --template` (T1 to T3) | The evaluated Bicep keeps `ssl=verify-full`, no weaker mode, and `PGSSLROOTCERT` on api, alerts and `job-migrate` | The deployed values (T4 and T5 check those, in `Deploy` and in the workflow) |
| `check-workflow.sh` (W1 to W9) | Actions pinned to a commit SHA, no `pull_request_target`, step order of the deploy job, `demo` environment, no secrets in `run:` blocks, least-privilege permissions, cheap-mode `API_MIN_REPLICAS` handling | A real GitHub run |
| Fake-`az` bash tests (244 tests, `infra/scripts/tests/run.sh`) | The bash scripts' logic: arguments, order, retries, failure paths, against stubs that return invented JSON | The real shape of `az` output |
| Pester suites (`infra/scripts/tests/ps`; 292 passed) | The PowerShell logic: secret masking, the migration retry, revision gates (including scale to zero), build arguments, the Doctor, Bootstrap, Validate, Warm, Cool, ResetDemo and Deploy flows, the T and S checks, the VAPID key format against the backend's `py_vapid`, `Test-DemoHttp.ps1` against a local mock server | The real `az` on Windows |
| Render rehearsal (`infra/render/rehearse-render.sh`) | `render.yaml` parses, its commands run against the real images, the negative TLS checks | How Render behaves (it was never applied) |

`infra/validate/accepted-risks.json` holds the 22 accepted findings, each with a reason and a date. The trivy findings are
report only and not accepted: the architect routes the follow-up to the backend and frontend lanes.

**Only real Azure can show:**

- the federated credential and the OIDC subject (`repo:<owner>/stellar-blaze:environment:demo`);
- AcrPull propagation (up to about 10 minutes);
- budget creation and the budget email;
- region, quota, and PostgreSQL 18 in UAE North;
- the real Microsoft CA chain under `verify-full`, the first real database connection (ADR 0042's end-to-end proof);
- whether Node trusts the certificate on the api's internal FQDN (the web answers 502 on `/api/v1/*` if not);
- the Dedicated log tables (`ContainerAppConsoleLogs` or `AzureDiagnostics`);
- the real shapes of `az` output (the revision JSON of a worker without ingress, `az containerapp job start`, `list-skus`);
- whether ARM accepts a fractional `dailyQuotaGb` (0.15) and `objectKeys` on a `secureObject`;
- what `az containerapp revision show` reports for a scaled-to-zero revision (the cool gate accepts 0 replicas);
- whether the ingress holds a request during scale-from-zero, and the real cold-start time;
- real timings and the real cost (the `Environment Management Hour`, Private Endpoint and Planned Maintenance meters);
- `X-Forwarded-For` behind the real ingress (smoke H6 on the public URL);
- real push delivery on a phone (section 5).

## 9. The Azure steps that close the gap

In order. Each creates nothing until you say so.

1. **Bootstrap what-if** (step 5). The what-if is shown before the prompt and creates nothing. Only after you type `yes` it
   creates the resource group, the budget, two identities, the registry (Basic) and the role assignments (and the federated
   credential if `-GitHubOwner` was given).
2. **`-Action Validate`** (step 7). Creates nothing, costs nothing. Shows that Azure accepts both phases in this region and
   with this quota (the first sight of region, quota and Postgres availability beyond Doctor).
3. **`-Action Deploy -Placeholder`** (step 8). Creates the environment, workspace, Postgres, `job-migrate` and two placeholder
   apps. Costs begin.
4. **`-Action Deploy`** (step 9). Creates the images in the registry, the migration run, the three real apps, and runs the
   template checks T1 to T3, the deployed checks T4 and T5 and the exposure checks S1, S2, S4 and S6 on the way.

The local `Deploy` runs the same database TLS checks as the GitHub workflow: T1 to T3 on the Bicep (step `[3/18]`) and T4 and T5
on what was deployed (step `[11/18]`). To run the offline template check by hand after changing `infra/bicep`, it needs Git
Bash, Python 3.10 or newer and Bicep, and costs nothing:

```powershell
& "C:\Program Files\Git\bin\bash.exe" infra/scripts/check-db-tls.sh --template infra/bicep/main.bicep
```

Expect `PASS T1`, `PASS T2` and `PASS T3`. Smoke check H2 is the end-to-end evidence: the api reaches the database with the
TLS mode it was deployed with.

After the first real deploy, run these read-only checks once. They create and change nothing.

```powershell
$s = Get-Content "$env:LOCALAPPDATA\stellar-blaze-i1\state.json" -Raw | ConvertFrom-Json
$rg = $s.resourceGroupName
az containerapp show -n api -g $rg --query properties.configuration.ingress.external
```

Expect `false` (the api has no public ingress). `Deploy` checked this as S4; this is the independent look.

```powershell
foreach ($phase in 'p1','p2') { "--- main $phase"; az deployment group show -g $rg -n "sb-main-$phase-$($s.lastTag)" --query "[properties.parameters.pgAdminPassword.value != null, properties.parameters.vapidPrivateKey.value != null, properties.parameters.sbAccessTokens.value != null, properties.parameters.demoEmployerToken.value != null]" -o tsv }
foreach ($n in 'app-api','app-web','app-alerts','job-migrate') { "--- $n"; az deployment group show -g $rg -n $n --query "properties.parameters.secrets.value != null" -o tsv }
```

These commands print **existence only**, never a value: each answer is `True` or `False`, so nothing secret can reach the
console or its scrollback. Do not replace them with a command that prints `properties.parameters` or
`properties.parameters.secrets`: if ARM does not redact them, that prints the database password, the tokens and the VAPID
key. Expect `False` on every line. `False` means ARM redacted the value from the deployment history (good). The `secrets`
parameter belongs to the nested module deployments (`app-api`, `app-web`, `app-alerts`, `job-migrate`), not to the main
one, so each is read by its own name; the main deployments carry four secure strings of their own (database password,
VAPID private key, access tokens, demo token), which are the four values on each `--- main` line. The module parameter is a
`secureObject`, which ARM redacts from the deployment history; whether ARM redacts every key inside it has not been seen,
and this check exists for that.

**If any line says `True`, the values are stored in the deployment history: treat every secret as leaked.** Do this, in
order:

1. Run `.\infra\scripts\deploy-local.ps1 -Action InitSecrets -Force` (a new database password, demo token and VAPID key
   pair; the old `secrets.json` is replaced, so back the new file up, step 4).
2. Run `Deploy` again (the new values reach the database and the apps; the VAPID pair changes, so subscribe phones again
   after the next reset).
3. Delete the old deployment records, which hold the old values: `az deployment group delete -g $rg -n <name>` for every
   name above that said `True`, and for every earlier `sb-main-p1-...` and `sb-main-p2-...` record
   (`az deployment group list -g $rg --query "[].name" -o tsv` lists them). It deletes the record, not the resources. The
   Deploy of step 2 wrote new records, and if ARM stores values they hold the NEW secrets: run the check again and delete
   those records too.
4. Tell the architect, and do not deploy again with secrets as plain parameters until they move to a Key Vault reference.
   Until then anyone who can read the resource group can read the stored values, so do not share access to it.

**After 24 to 48 hours:** portal, Cost Management, Cost analysis, scope the subscription, group by Meter. Expect no
`Environment Management Hour`, `Environment Private Endpoint` or `Environment Planned Maintenance Hour` meter, Container Apps
compute small (the `alerts` worker bills active, `web` mostly idle, the `api` almost nothing when cool, section 7), and
Postgres B1ms at USD 0 if the free offer applies. If `Environment Management Hour` shows, the monthly figure goes up by
USD 73 (section 7, caveat 3): tell the architect, who decides between keeping it, the Render fallback (about USD 28 a month at the measured sizes, no UAE region, `infra/render/README.md`) and the single small VM costed in section 7. Do not delete anything on your own. Write what you see in the Deploy log. Also confirm the budget under Cost
Management, Budgets, with your address.

## 10. The GitHub path (optional)

Do this when the GitHub repository exists. The repository must be named `stellar-blaze`: the federated credential subject is
`repo:<owner>/stellar-blaze:environment:demo`, and the script does not take another repository name. Owner and repository
names are case-sensitive in that subject. In the same PowerShell window:

```powershell
gh auth status
$Owner = Read-Host 'GitHub owner exactly as GitHub shows it (case matters)'
$Repo = "$Owner/stellar-blaze"
gh repo create $Repo --private --source . --remote origin
```

Push the branch yourself when ready (`git push -u origin main`). Create the `demo` environment:

```powershell
gh api -X PUT "repos/$Repo/environments/demo"
```

Then in the browser: Settings, Environments, `demo`, Deployment branches and tags, Selected branches, add `main` (deploy.yml
asks for this). Add the federated credential by re-running Bootstrap with the owner:

```powershell
.\infra\scripts\deploy-local.ps1 -Action Bootstrap -ContactEmail $Email -GitHubOwner $Owner
```

Expect a what-if with one `+ Create` for the federated credential and nothing else changing, then the prompt. Its subject
must read exactly `repo:<owner>/stellar-blaze:environment:demo`.

**Variables** that `.github/workflows/deploy.yml` reads (identifiers, not secrets; they come from the bootstrap outputs,
`state.json` and `secrets.json`):

```powershell
$o = az deployment sub show --name sb-bootstrap --query properties.outputs -o json | ConvertFrom-Json
$s = Get-Content "$env:LOCALAPPDATA\stellar-blaze-i1\state.json" -Raw | ConvertFrom-Json
$k = Get-Content "$env:LOCALAPPDATA\stellar-blaze-i1\secrets.json" -Raw | ConvertFrom-Json
$pg = $s.postgresVersion
if ($s.postgresVersionDeployed) { $pg = $s.postgresVersionDeployed }
gh variable set AZURE_CLIENT_ID --env demo --repo $Repo --body $o.deployerClientId.value
gh variable set AZURE_TENANT_ID --env demo --repo $Repo --body $o.tenantId.value
gh variable set AZURE_SUBSCRIPTION_ID --env demo --repo $Repo --body $o.subscriptionId.value
gh variable set AZURE_RESOURCE_GROUP --env demo --repo $Repo --body $s.resourceGroupName
gh variable set ACR_NAME --env demo --repo $Repo --body $s.acrName
gh variable set APPS_IDENTITY_ID --env demo --repo $Repo --body $s.appsIdentityId
gh variable set POSTGRES_VERSION --env demo --repo $Repo --body $pg
gh variable set VAPID_PUBLIC_KEY --env demo --repo $Repo --body $k.vapidPublicKey
gh variable set VAPID_SUBJECT --env demo --repo $Repo --body $k.vapidSubject
```

Optional variable `API_MIN_REPLICAS`: unset or `0` scales the api to zero (cool, the default); `1` keeps it warm. For the
judged weeks:

```powershell
gh variable set API_MIN_REPLICAS --env demo --repo $Repo --body 1
```

Leave `SB_RULESET_ID` and `SB_MODEL_ID` unset (the backend refuses both in prod). Leave `NEXT_PUBLIC_SB_DEMO` unset or empty:
that is demo mode, the safe default, and it must never be `0`.

**Secrets** (four). No secret goes on a command line: each value is piped from `secrets.json` into `gh secret set`, which reads
standard input when `--body` is not given, and nothing is printed:

```powershell
$k.pgAdminPassword | gh secret set PG_ADMIN_PASSWORD --env demo --repo $Repo
$k.vapidPrivateKey | gh secret set VAPID_PRIVATE_KEY --env demo --repo $Repo
$k.accessTokens | gh secret set SB_ACCESS_TOKENS --env demo --repo $Repo
$k.demoEmployerToken | gh secret set DEMO_EMPLOYER_TOKEN --env demo --repo $Repo
```

Windows PowerShell adds a line break to piped text. `gh` trims trailing line breaks from standard input (believed from its
behavior, not exercised here); if a later deploy fails to authenticate to Postgres, set `PG_ADMIN_PASSWORD` again with the
interactive prompt (`gh secret set PG_ADMIN_PASSWORD --env demo --repo $Repo`, paste the value). `-Action ShowSecrets
-IUnderstand` prints three of the four secrets, but not the database password, and it leaves them in the console
scrollback, so the pipe above is preferred. The values must equal those in `secrets.json`: the database already exists
with that password, and a different `SB_ACCESS_TOKENS` or `DEMO_EMPLOYER_TOKEN` would stop the web and api agreeing.

**How the workflow runs.** After a green `ci` run on a push to `main`, or by hand:

```powershell
gh workflow run deploy.yml --ref main --repo $Repo
gh run watch --repo $Repo
```

It builds both images in parallel on GitHub, then `deploy` runs the template checks (`check-db-tls.sh --template`,
`check-template.sh`), the same two Bicep phases with the migration between, the database TLS check on what was deployed, a
gate per app, a restart of the apps (`restart-apps.sh`), a wait for the cold api through the web (`wait-ready.sh`), a demo
reset, the smoke test and a final reset. On the first run, open the `azure/login` step and check that "Federated token
details" shows the subject `repo:<owner>/stellar-blaze:environment:demo`. An `AADSTS700213` error means the subject does not
match (section 13). The workflow ends with a reset, so the demo day starts then: run `-Action ResetDemo` before a judged
session all the same, because one epoch lasts about 7 h 20 min.

## 11. Run the offline checks yourself

The PowerShell path needs no bash:

```powershell
.\infra\scripts\validate-local.ps1
```

It runs every offline validator (Bicep lint and build, PSRule for Azure, Checkov, actionlint, an `act` dry run, hadolint,
the trivy image scan, ShellCheck, PSScriptAnalyzer, the script tests) and prints one `PASS`, `FAIL`, `SKIP` or `WARN` line
per step; exit code 1 on any `FAIL`. The last full run was **PASS with 22 reviewed accepted findings**, each with a reason in
`infra/validate/accepted-risks.json`. The trivy image scan is **report only** (a `WARN` with the counts): api 60 HIGH and 1
CRITICAL (certifi, GHSA-6q48-6c7w-9gw2) and web 54 HIGH, in dependencies and OS packages. The architect routes the follow-up
to the backend and frontend lanes. Tools install on first use into `%LOCALAPPDATA%\stellar-blaze-i1\tools`,
checksum-verified. `-Only bicep,psrule` runs a subset, `-Skip <steps>` leaves some out, `-Rehearsal` adds the slow
rehearsal, `-StrictImages` makes any HIGH or CRITICAL image finding a `FAIL`. Details: `infra/validate/README.md`.

The Pester suites and PSScriptAnalyzer alone:

```powershell
Install-Module Pester -MinimumVersion 5.5 -Scope CurrentUser
Install-Module PSScriptAnalyzer -Scope CurrentUser
.\infra\scripts\tests\ps\run-ps-tests.ps1
```

Expect the Pester summary (292 passed in the last full run). On Windows PowerShell 5.1, `Install-Module Pester` can refuse
because of the built-in Pester 3; add `-Force -SkipPublisherCheck`. `-ModulePath <folder>` points the run at a folder that
already holds both modules; `-SkipDocker` skips the tests that need the local image `stellar-blaze-api:i1`; `-PesterOnly`
skips PSScriptAnalyzer.

The bash tests and the rehearsal need Git Bash. Run them with Git Bash's `bash` explicitly, because a bare `bash` in
PowerShell can resolve to WSL, which has no tools:

```powershell
& "C:\Program Files\Git\bin\bash.exe" infra/scripts/tests/run.sh --fast
```

Expect lines that start with `ok`, plus `skip ...` lines for the tests that need `bicep`, and a last line `all <n> tests
passed (<m> skipped by --fast)`. The full run is 244 tests and ends `all 244 tests passed` (about 6 minutes: the template
tests call `bicep` many times). `--fast` skips the tests that call `bicep`; a name part runs a subset, for example `run_migrate` or `healthcheck`. Set
`CI=true` to make a missing `bicep` or Python a failure instead of a skip. The static checks on their own:

```powershell
& "C:\Program Files\Git\bin\bash.exe" infra/scripts/check-template.sh infra/bicep/main.bicep
& "C:\Program Files\Git\bin\bash.exe" infra/scripts/check-db-tls.sh --template infra/bicep/main.bicep
& "C:\Program Files\Git\bin\bash.exe" infra/scripts/check-workflow.sh
```

Expect only `PASS` lines (C1 to C13 and B1 to B5; T1 to T3; W1 to W9). The production rehearsal (Docker; 5 to 7 minutes warm,
much longer when the images must be built, the first web build can take 10 minutes):

```powershell
$env:SB_REHEARSAL_PORT = '18080'
& "C:\Program Files\Git\bin\bash.exe" infra/local/rehearse.sh
```

Set `SB_REHEARSAL_PORT` only when 8080 is taken (another project often owns it). Expect an `ID RESULT CHECK` table of 15 rows
(R1 to R8 and N1 to N7) and `REHEARSAL OK: 15 checks passed, none skipped`. Three rows can legitimately say `SKIP`, and the last
line then counts them apart (`a skipped check is not a pass`): **R5** on a backend that predates the demo-reset route,
**R6** on a backend that predates the epoch clock, and **R8** when one `alerts dispatch` takes more than 45 seconds at
0.25 vCPU, which is why the scheduled alerts job was rejected.
`--keep` leaves the stack running (section 12). The Render fallback has its own:
`& "C:\Program Files\Git\bin\bash.exe" infra/render/rehearse-render.sh`.

## 12. Fallbacks

The ladder is ADR 0001. Take a step only when the step above it is blocked.

1. **Another Azure region.** If UAE North refuses Container Apps or Postgres for the new subscription (Doctor says so, or
   `QuotaExceeded`, `LocationNotAvailableForResourceType`), use the same Bicep in another region. List the regions that offer
   Container Apps environments, run Doctor for one, then Bootstrap and Deploy with the same `-Location`:

   ```powershell
   az provider show --namespace Microsoft.App --query "resourceTypes[?resourceType=='managedEnvironments'].locations[]" -o tsv
   .\infra\scripts\deploy-local.ps1 -Action Doctor -Location westeurope
   ```

   Replace `westeurope` with a region from the list, written lowercase with no spaces (the list shows display names such as
   "West Europe"; the `-Location` value is `westeurope`). The resource group name carries the region
   (`rg-stellarblaze-demo-<region>`), so Bootstrap creates a new group. The "in-UAE" claim is then a design property only.
2. **Render Frankfurt.** Only if the Azure account or card itself is blocked and not fixable in about 4 hours; the architect
   decides. It costs about USD 28 a month at the measured sizes and nothing scales to zero. The steps, the caveats (no UAE
   region; `verify-full` through a Postgres you run yourself, because Render's managed Postgres cannot verify; never
   applied on Render) and the unverified list are in `infra/render/README.md`. It needs the values from `-Action ShowSecrets
   -IUnderstand`.
3. **The local stack, the floor.** No hosted deployment: run the production rehearsal and leave it up.

   ```powershell
   & "C:\Program Files\Git\bin\bash.exe" infra/local/rehearse.sh --keep
   .\infra\scripts\Test-DemoHttp.ps1 -BaseUrl http://127.0.0.1:8080
   ```

   (Use the port you set in `SB_REHEARSAL_PORT`.) `--keep` prints how to remove the stack and the scratch directory, which
   holds generated keys. With no deployed URL, the in-country architecture claim and the "deployed URL" criterion cannot be
   claimed (ADR 0001 amendment of 2026-11-14).

## 13. Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| The first request after idle fails or is slow: a `502` with `Upstream unavailable` on `/api/v1/*`, or a page with no data | Scale to zero. The api is not running and the web gives up after 10 s (`UPSTREAM_TIMEOUT_MS`); the cold start took about 29 s locally, plus the image pull on Azure | Ask again in a few seconds. For a judged session or a recording: `.\infra\scripts\deploy-local.ps1 -Action Warm`. Section 1.2 |
| `AADSTS700213` in the `azure/login` step | The OIDC subject does not match: owner or repository casing, or the environment name | Compare the subject in the step log with the credential. Re-run Bootstrap with the owner exactly as GitHub shows it. If Azure rejects an in-place change, delete it and re-run: `az identity federated-credential delete --name github-demo --identity-name id-sb-deployer --resource-group rg-stellarblaze-demo-uaenorth --yes` |
| First image pull fails; migration `Failed`, or a revision will not provision, right after Bootstrap | AcrPull propagation (up to about 10 minutes) | Wait 10 minutes and re-run `Deploy`. It already retries the migration once after 90 seconds. Change nothing |
| `QuotaExceeded` or `LocationNotAvailableForResourceType` | The region or quota is not available to this subscription | Ladder step 1: another region with `-Location` (section 12). For Postgres, a region-access request (portal, Help + support, Region access) |
| Doctor `FAIL PostgreSQL Standard_B1ms is not offered` | Same, for Postgres | Same as above |
| PostgreSQL 18 is not offered, or phase 1 fails on the version | 18 is not available in the region | Re-run with `-PostgresVersion 17`. `Deploy` refuses to change the major version of an existing server: use the version already deployed |
| Validate or phase 1 fails on `dailyQuotaGb` or on `objectKeys` | ARM did not accept a fractional daily cap, or `objectKeys` on a secure object (both unverified until the first real run) | Copy the first lines of the error to the architect, who decides the fix |
| Smoke H4 fails: `replay clock reads <time> Asia/Dubai, outside 10:00-17:30` | The epoch is older than about 7 h 20 min, or the clock is not what you think | `.\infra\scripts\deploy-local.ps1 -Action ResetDemo`, then smoke again (wait a minute after a smoke test: the reset is rate limited) |
| `ResetDemo` answers 429 | The reset is limited to 1 per 60 s and 10 per hour, and the web's general bucket counts it (smoke H6 drains that bucket for about a minute) | Wait the `Retry-After` it prints, then run it again. `Deploy` waits it out by itself |
| `ResetDemo` or `-Action Smoke` answers 502 or no answer | The api is cold (scaled to zero) and the web gave up after 10 s | Run `-Action Warm` first (it ends with a reset), or wait a minute and try again |
| Smoke H6 fails: no 429 in 30 requests | The hop count is wrong: the limiter keys on a header entry the caller can forge | This is a finding, not a reason to loosen the limiter. Check `TRUSTED_PROXY_HOPS` (it is 1) against the real ingress and tell the architect (section 8) |
| Smoke H2 or the web answers 502 on `/api/v1/*` even with the api warm | The web cannot reach the api: Node does not trust the certificate on the api's internal FQDN, or `API_ORIGIN` is wrong | First `-Action Warm`, to rule out the cold start. Then check `az containerapp logs show --name web --resource-group rg-stellarblaze-demo-uaenorth --type console --tail 50`. The documented fallback is the comment above `apiOrigin` in `infra/bicep/main.bicep` (`API_ORIGIN = 'http://api'` with `allowInsecure: true` on the api ingress, reachable only inside the environment); keep it off until this happens |
| Cost Analysis shows a meter `Environment Management Hour` (USD 0.10 an hour) | The Consumption-only environment is not exempt from the plan-management charge (unconfirmed) | The month costs about USD 73 more (section 7, caveat 3). The budget alert will fire. Tell the architect; do not delete anything on your own |
| `FAIL docker daemon is not reachable` | Docker Desktop is not running | Start Docker Desktop, wait until it says running, run Doctor |
| `FAIL az is not on PATH` | `az` was installed in this window's lifetime | Close the window, open a new PowerShell window in the repository root |
| `curl.exe` fails with a revocation error (`CRYPT_E_NO_REVOCATION_CHECK` or "unable to check revocation") | Windows cannot reach the certificate revocation server on this network | Add `-NoRevoke` to `Deploy`, `Smoke` and `ResetDemo` (it passes `--ssl-revoke-best-effort` to every HTTP check; a revoked certificate is still refused). `Test-DemoHttp.ps1` has the same `-NoRevoke` switch |
| `running scripts is disabled on this system` | PowerShell execution policy | `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force` |
| A bash script from this repo fails in PowerShell | A bare `bash` can be WSL; Git Bash rewrites `/subscriptions/...` arguments and `az.cmd` output carries `\r` | Do not run the deploy scripts by hand. Use `deploy-local.ps1`. For the offline tests, the static checks and the rehearsal, `& "C:\Program Files\Git\bin\bash.exe" <script>` |
| `Deploy` refuses: the working tree has uncommitted or untracked changes | The image tag is the commit | Commit, or pass `-AllowDirty` |
| `state.json has no 'acrName'` | Bootstrap has not run (or ran under another state directory) | Run Bootstrap (step 5) |
| Template checks FAILED (`T1`, `T2` or `T3`) | The Bicep has a weaker database TLS mode, or an app lacks `PGSSLROOTCERT` | Nothing was built or created. Do not weaken the check (ADR 0042); tell the architect |
| Deployed checks FAILED (`T4` or `T5`), or post-deploy checks FAILED (`S1`, `S2`, `S4`, `S6`) | A stored secret, an environment entry, a scale, an ingress or a region differs from the design | The apps are deployed but not handed out. Read the `FAIL` lines, fix the cause, run `Deploy` again, or delete everything (section 7) |
| The redaction check of section 9 prints `True` on any line | ARM stored secret values in the deployment history: treat every secret as leaked | Section 9: `-Action InitSecrets -Force`, `Deploy` again, delete the old and the new deployment records with `az deployment group delete`, tell the architect. Never print `properties.parameters` to look at it |
| Migration `Failed twice` | An image pull error (AcrPull), a database certificate error, or a migration error | Read the log (below) |
| `Revision gate failed after 300 s` | A new revision is not ready; the old one may still serve | `az containerapp revision list --name <app> --resource-group rg-stellarblaze-demo-uaenorth -o table` and `az containerapp logs show --name <app> --resource-group rg-stellarblaze-demo-uaenorth --type system` |

**Reading a failed migration.** List the executions, then read the log:

```powershell
az containerapp job execution list --name job-migrate --resource-group rg-stellarblaze-demo-uaenorth -o table
```

In the portal, Log Analytics, Logs (a few minutes of delay; use the `AzureDiagnostics` fallback of section 5 if the table is
missing):

```text
ContainerAppConsoleLogs | where ContainerGroupName startswith "job-migrate" | order by TimeGenerated desc | take 50
```

What the lines mean: `ClientConfigurationError: root certificate file ... does not exist` or `FileNotFoundError` is the root
file missing (asyncpg fails closed); `ssl.SSLCertVerificationError` is an untrusted chain or a wrong host name (the first real
`verify-full` connection to Azure has never run, ADR 0042); an image pull or `ImagePullBackOff` message is AcrPull propagation;
a line starting `migrate: ERROR:` comes from `migrate.sh` and names the step (the config proposal, the version id, or the
activation).

## 14. Deploy log and preflight log

Fill these in as you go. They are the record the architect reads.

**Preflight log** (step 3, Doctor):

| Date | Command | Result (PASS, WARN, FAIL counts) | Region | Postgres version chosen | Notes |
|---|---|---|---|---|---|
| | | | | | |

**Deploy log** (steps 8 and 9, and every later deploy; paste the smoke lines):

| Date | Command | Result | Web FQDN | Postgres version | Api mode | Smoke output |
|---|---|---|---|---|---|---|
| | | | | | | |

### Push measurements (section 5, step 8)

| Date | Phone and browser | Run 1 (s) | Run 2 (s) | Run 3 (s) | Median (s) | Note |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |
