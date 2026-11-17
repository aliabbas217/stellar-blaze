// Every value comes from this file or from an environment variable, so no inline `--parameters key=value`
// is mixed with it. Set the variables in the shell that runs `az deployment sub ...` (see infra/README.md).
//
//   LOCATION               default uaenorth
//   GITHUB_OWNER           default empty: no federated credential yet
//   GITHUB_REPO            default stellar-blaze
//   GITHUB_OWNER_ID        default empty; with GITHUB_REPO_ID the immutable OIDC subject (repositories created after 15 July 2026)
//   GITHUB_REPO_ID         default empty; the numeric ids: gh api repos/OWNER/REPO --jq '.owner.id, .id'
//   BUDGET_CONTACT_EMAIL   required, no default
//   OPERATOR_PRINCIPAL_ID  default empty: no operator AcrPush
//   BUDGET_MONTH           default empty = current UTC month; yyyy-MM from the first run when re-running later

using 'bootstrap.bicep'

param location = readEnvironmentVariable('LOCATION', 'uaenorth')
param githubOwner = readEnvironmentVariable('GITHUB_OWNER', '')
param githubRepo = readEnvironmentVariable('GITHUB_REPO', 'stellar-blaze')
param githubOwnerId = readEnvironmentVariable('GITHUB_OWNER_ID', '')
param githubRepoId = readEnvironmentVariable('GITHUB_REPO_ID', '')
param budgetContactEmail = readEnvironmentVariable('BUDGET_CONTACT_EMAIL')
param operatorPrincipalId = readEnvironmentVariable('OPERATOR_PRINCIPAL_ID', '')
param budgetMonth = readEnvironmentVariable('BUDGET_MONTH', '')
