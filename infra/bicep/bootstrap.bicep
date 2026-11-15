// One-time bootstrap, run by the operator (Owner on the subscription) from a laptop:
// resource group, monthly budget, the two identities, the container registry and every role assignment.
// main.bicep (resource-group scope) is deployed later by CI as the deployer identity created here.

targetScope = 'subscription'

@description('Azure region. Carries fallback-ladder step 1: change it to move the whole stack.')
param location string = 'uaenorth'

param resourceGroupName string = 'rg-stellarblaze-demo-${location}'

@description('GitHub account that owns the repository, typed exactly as GitHub shows it (case-sensitive). Empty: no federated credential is created, so the bootstrap works before the repository exists. Re-run with a value to add it.')
param githubOwner string = ''

param githubRepo string = 'stellar-blaze'

param githubEnvironment string = 'demo'

@description('Object id of the signed-in operator. When non-empty that user gets AcrPush on the registry. Get it with: az ad signed-in-user show --query id -o tsv')
param operatorPrincipalId string = ''

// Cheap-mode estimate about USD 45-55 a month with a paid Postgres (infra/README.md "What costs money") plus margin; the alerts at 80 % and 100 % of this and a
// forecast at 100 % go to budgetContactEmail.
@minValue(1)
param budgetAmount int = 75

@description('Where the budget alerts go. No default and never committed.')
param budgetContactEmail string

@description('Month the budget starts, as yyyy-MM, from the FIRST bootstrap run. Empty means the current UTC month. The Consumption API rejects a start date that is not the first of a month or is in the past, so a re-run in a later month must pass the original value.')
@maxLength(7)
param budgetMonth string = ''

@description('Current UTC month (yyyy-MM). Only a parameter default may call utcNow(), so it is captured here; do not set it.')
param currentMonth string = utcNow('yyyy-MM')

var tags = {
  project: 'stellar-blaze'
  env: 'demo'
  managedBy: 'bicep'
}

var effectiveBudgetMonth = empty(budgetMonth) ? currentMonth : budgetMonth
var budgetStartDate = '${effectiveBudgetMonth}-01T00:00:00Z'

resource rg 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module resources 'modules/bootstrap-rg.bicep' = {
  name: 'sb-bootstrap-rg'
  scope: rg
  params: {
    location: location
    githubOwner: githubOwner
    githubRepo: githubRepo
    githubEnvironment: githubEnvironment
    operatorPrincipalId: operatorPrincipalId
    tags: tags
  }
}

resource budget 'Microsoft.Consumption/budgets@2026-06-01' = {
  name: 'budget-sb-monthly'
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: [
          budgetContactEmail
        ]
      }
      actual100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: [
          budgetContactEmail
        ]
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: [
          budgetContactEmail
        ]
      }
    }
  }
}

output resourceGroupName string = rg.name
output acrName string = resources.outputs.acrName
output acrLoginServer string = resources.outputs.acrLoginServer
output deployerClientId string = resources.outputs.deployerClientId
output appsIdentityId string = resources.outputs.appsIdentityId
output appsIdentityPrincipalId string = resources.outputs.appsIdentityPrincipalId
output tenantId string = tenant().tenantId
output subscriptionId string = subscription().subscriptionId
