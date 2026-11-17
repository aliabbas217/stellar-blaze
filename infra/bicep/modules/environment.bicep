// Container Apps environment: Consumption workload profile only (a Dedicated profile, a private endpoint or a
// planned-maintenance window each add a fixed hourly meter), logs routed to Azure Monitor and from there to the
// Log Analytics workspace by a diagnostic setting.

targetScope = 'resourceGroup'

@description('Environment name.')
param name string

param location string

param tags object

@description('Resource id of the Log Analytics workspace that receives the logs.')
param workspaceId string

resource environment 'Microsoft.App/managedEnvironments@2026-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    appLogsConfiguration: {
      destination: 'azure-monitor'
    }
    zoneRedundant: false
  }
}

// `destination: 'azure-monitor'` only makes the environment emit logs; the diagnostic setting is what stores them.
// UNVERIFIED (no Azure access when this was written): `logAnalyticsDestinationType: 'Dedicated'` should give the
// resource-specific tables ContainerAppConsoleLogs and ContainerAppSystemLogs; if the logs land in AzureDiagnostics
// instead, query that table (infra/README.md has the fallback query).
resource toLogAnalytics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: environment
  properties: {
    workspaceId: workspaceId
    logAnalyticsDestinationType: 'Dedicated'
    logs: [
      {
        category: 'ContainerAppConsoleLogs'
        enabled: true
      }
      {
        category: 'ContainerAppSystemLogs'
        enabled: true
      }
    ]
  }
}

output id string = environment.id
output name string = environment.name
output defaultDomain string = environment.properties.defaultDomain
