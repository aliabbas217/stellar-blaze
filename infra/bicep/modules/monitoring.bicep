// Log Analytics workspace that receives the Container Apps console and system logs (see environment.bicep).

targetScope = 'resourceGroup'

@description('Workspace name.')
param name string

param location string

param tags object

// 30 is the shortest retention the PerGB2018 tier offers, and 31 days are included in the ingestion price, so a shorter
// retention would save nothing (and none is possible).
@description('Days the logs are kept.')
@minValue(30)
@maxValue(730)
param retentionInDays int = 30

// CHEAP MODE: 0.15 GB a day is about 4.5 GB a month, inside the 5 GB a month that every billing account ingests free, and
// still far above what three small containers write (a few MB a day). Once the cap is reached the day's further logs are
// dropped, which is the point: a process that loops on errors cannot run up the bill. A string because the API takes a
// fractional number and a Bicep int cannot hold one; it goes through json() as the container apps' cpu does. '-1' means no cap.
@description('Daily ingestion cap in GB as a string (-1 = none), for example 0.15.')
param dailyQuotaGb string = '0.15'

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
      dailyQuotaGb: json(dailyQuotaGb)
    }
  }
}

output workspaceId string = workspace.id
output workspaceName string = workspace.name
