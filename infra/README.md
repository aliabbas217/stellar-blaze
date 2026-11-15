# Stellar Blaze infrastructure runbook

Operator guide for hosting the demo on Azure UAE North (ADR 0001), written for Ali on Windows 11 in PowerShell.
Every command is copy-paste, and the expected result follows it.

**State described:** branch `feat/i1-azure-infra`. Nothing in this file has been run against Azure: the Azure CLI was not
installed and the account did not exist when it was written. The Bicep was compiled and linted offline (Bicep CLI
0.49.2) and the scripts were tested against stubs. Expected outputs below come from documentation and from those
offline runs, and a line marked "unverified" has never been seen on a real account. If reality differs, trust reality
and fix this file.

## Contents (written in later chunks)

- GitHub variables
- First deploy
- Day-2 checks
- Replay clock (run before every judged session)
- Cost
- Fallback ladder (ADR 0001: change `location`; Render Frankfurt; AWS last)
- Troubleshooting (AADSTS700213 subject casing; AcrPull propagation; `QuotaExceeded` and
  `LocationNotAvailableForResourceType`)

Sections that exist today: Prerequisites, Preflight, Bootstrap (one-time), Re-running bootstrap.

## Prerequisites

You need an Azure subscription on which you are Owner (free-account eligibility and sign-up are in the plan, Task 0).
All commands run from the repository root in PowerShell unless stated.

1. Install the Azure CLI, then open a **new** terminal so `az` is on the path:

   ```powershell
   winget install --exact --id Microsoft.AzureCLI
   ```

2. Check the versions:

   ```powershell
   az version
   ```

   Expect JSON with `"azure-cli"` at `2.92.0` or newer.

   ```powershell
   az bicep install --version v0.49.2
   az bicep version
   ```

   Expect `Bicep CLI version 0.49.2`. The pin matters: the files were linted with this version.

   ```powershell
   az extension add --name containerapp --upgrade
   ```

   The extension is used by the deploy scripts in later sections.

3. Sign in and select the subscription (a browser window opens):

   ```powershell
   az login
   az account list -o table
   az account set --subscription "<subscription id>"
   az account show --query "{sub:id, tenant:tenantId, user:user.name}" -o table
   ```

   Expect one row with the subscription you meant.

4. Register the seven resource providers, once per subscription (2 to 5 minutes; each command returns when its
   provider is registered and normally prints nothing):

   ```powershell
   "Microsoft.App","Microsoft.OperationalInsights","Microsoft.Insights","Microsoft.DBforPostgreSQL","Microsoft.ContainerRegistry","Microsoft.ManagedIdentity","Microsoft.Consumption" | ForEach-Object { az provider register --namespace $_ --wait }
   ```

   Preflight (next section) checks that all seven say `Registered`.

## Preflight

Checks, before anything is created, that UAE North offers Container Apps and PostgreSQL B1ms, that the providers are
registered and that you are Owner. It also chooses the PostgreSQL major version (18 if it can be confirmed, else 17).

The script is bash. Run it with Git Bash's `bash` explicitly: in PowerShell a bare `bash` can resolve to WSL, which
has no `az`.

```powershell
& "C:\Program Files\Git\bin\bash.exe" infra/scripts/preflight.sh
```

Expected (all PASS, exit code 0):

```text
PASS P1 Microsoft.App managedEnvironments in uaenorth
PASS P2 PostgreSQL Standard_B1ms in uaenorth
PASS P3 provider Microsoft.App registered
... (six more P3 lines, one per provider)
PASS P4 signed-in user is Owner on the subscription
POSTGRES_VERSION=18
```

Write down the `POSTGRES_VERSION` value: it becomes the GitHub variable of the same name in a later section.

What a failure means:

- `FAIL P1` or `FAIL P2`: the region does not offer the service to this subscription. File a region-access request
  (portal, Help + support, "Region access", service "PostgreSQL flexible server") and in parallel pick another region
  for `LOCATION` (fallback ladder, step 1).
- `FAIL P3 provider <name>`: run `az provider register --namespace <name> --wait`, then re-run.
- `FAIL P4`: the query sees only direct and inherited role assignments for your user. Ownership that comes through a
  group may not show; check Subscriptions, your subscription, Access control (IAM) in the portal. If you really are Owner,
  continue.
- `WARN could not confirm PostgreSQL 18; using 17` (on stderr, not a failure): the script found Standard_B1ms but no
  version `"18"` entry in the SKU list, so it reports 17. Never run against real Azure output yet (unverified): the
  P2 text matching is there until someone inspects the real JSON once and replaces it with a precise query.

Self-test of the scripts themselves, no Azure needed: `bash infra/scripts/tests/run.sh` (every line starts with `ok`).

## Bootstrap (one-time)

Creates, at subscription scope and as Owner from your laptop: the resource group `rg-stellarblaze-demo-uaenorth`, the
USD 75 monthly budget with e-mail alerts, two managed identities (`id-sb-apps` pulls images; `id-sb-deployer` is what
GitHub Actions signs in as), the container registry (Basic), and every role assignment. CI never needs rights over
authorization because only this step creates assignments.

Set the inputs as environment variables. The parameter file reads every value from the environment, so nothing is
passed inline and nothing secret is written to the repository.

```powershell
$env:LOCATION = 'uaenorth'
$env:BUDGET_CONTACT_EMAIL = '<the address that should receive budget alerts>'
$env:OPERATOR_PRINCIPAL_ID = (az ad signed-in-user show --query id -o tsv)
$env:BUDGET_MONTH = (Get-Date).ToUniversalTime().ToString('yyyy-MM', [System.Globalization.CultureInfo]::InvariantCulture)
$env:BUDGET_MONTH
```

The last line prints the current UTC month, for example `2026-11`. **Write it down**: re-runs in a later month must
pass this same value (see Re-running bootstrap). `OPERATOR_PRINCIPAL_ID` gives your own user AcrPush on the registry, so
you can push images from your laptop.

Do not set `GITHUB_OWNER` yet if the GitHub repository does not exist: when it is unset the bootstrap simply creates no
federated credential. When the repository exists, set `$env:GITHUB_OWNER = '<owner exactly as GitHub shows it>'`
(case-sensitive) and re-run; `GITHUB_REPO` defaults to `stellar-blaze`.

Preview first:

```powershell
az deployment sub what-if --name sb-bootstrap --location $env:LOCATION --parameters infra/bicep/bootstrap.bicepparam
```

Expect only `+ Create` entries (no `-` delete, no `~` modify on a first run): the resource group, the budget, two
identities, the registry and the role assignments (plus the federated credential when `GITHUB_OWNER` is set). With
`GITHUB_OWNER` set, the credential's subject must read exactly `repo:<owner>/stellar-blaze:environment:demo`. Unverified:
the number of entries in the real what-if output.

Deploy (2 to 4 minutes):

```powershell
az deployment sub create --name sb-bootstrap --location $env:LOCATION --parameters infra/bicep/bootstrap.bicepparam
```

Expect a JSON document ending in `"provisioningState": "Succeeded"`. `--template-file` is not needed: the parameter file
names its template (`using 'bootstrap.bicep'`; Azure CLI 2.53 or newer).

Read the outputs at any time:

```powershell
az deployment sub show --name sb-bootstrap --query properties.outputs -o json
```

Expect eight entries, each `{"type": "String", "value": "..."}`: `resourceGroupName`, `acrName` (`acrsb` plus 13
characters), `acrLoginServer` (`<acrName>.azurecr.io`), `deployerClientId`, `appsIdentityId`, `appsIdentityPrincipalId`,
`tenantId`, `subscriptionId`. To use them in PowerShell:

```powershell
$o = az deployment sub show --name sb-bootstrap --query properties.outputs -o json | ConvertFrom-Json
$o.acrName.value
$o.deployerClientId.value
```

These are identifiers, not credentials. The later "GitHub variables" section copies them into the `demo` environment.

**Wait before the first deploy.** A role assignment takes time to propagate, and the first image pull by `id-sb-apps`
fails with an unhelpful provisioning error until its AcrPull assignment is effective (Microsoft documents up to about
10 minutes). After the bootstrap, wait at least 10 minutes before the first real deploy, and if the first pull still
fails, wait and re-run the deploy rather than changing anything.

If the federated credential resource fails when `GITHUB_OWNER` is set, create it by hand and carry on:

```powershell
az identity federated-credential create --name github-demo --identity-name id-sb-deployer --resource-group rg-stellarblaze-demo-uaenorth --issuer https://token.actions.githubusercontent.com --subject "repo:<owner>/stellar-blaze:environment:demo" --audiences api://AzureADTokenExchange
```

## Re-running bootstrap

The bootstrap is idempotent; re-run it to add the federated credential once the repository exists, or to change the
budget amount, the operator or the e-mail address.

1. Set the same variables as the first run, with `BUDGET_MONTH` **equal to the month you wrote down**, not the current
   month. The Consumption API rejects a budget start date that is not the first of a month or is in the past, and the
   template builds the start date from this month (`<BUDGET_MONTH>-01T00:00:00Z`). Left unset, it defaults to the
   current UTC month, which is wrong for a re-run in a later month.
2. Add what changed, for example `$env:GITHUB_OWNER = '<owner>'`.
3. Run the same `what-if` and then `create`. Expect only the intended `+ Create` or `~ Modify` lines.

If the repository is ever renamed or moved, the federated credential subject changes, so re-run with the new
`GITHUB_OWNER` and `GITHUB_REPO`. The credential keeps the name `github-demo`; whether Azure updates its subject in
place is unverified, so if the deployment rejects the change, delete the credential in the portal and re-run.
