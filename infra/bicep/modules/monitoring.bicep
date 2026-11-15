// Log Analytics workspace that receives the Container Apps console and system logs (see environment.bicep).

targetScope = 'resourceGroup'

@description('Workspace name.')
param name string

param location string

param tags object

@description('Days the logs are kept.')
@minValue(30)
@maxValue(730)
param retentionInDays int = 30

@description('Daily ingestion cap in GB (-1 = none). 1 GB a day is far above what three small containers write; the cap bounds the cost if a process loops on errors.')
param dailyQuotaGb int = 1

resource workspace 'Microsoft.OperationalInsights/workspaces@2026-03-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    workspaceCapping: {
      dailyQuotaGb: dailyQuotaGb
    }
  }
}

output workspaceId string = workspace.id
output workspaceName string = workspace.name
