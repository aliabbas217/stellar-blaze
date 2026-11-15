// One manually triggered container app job (job-migrate). Started by infra/scripts/run-migrate.sh; the command line
// is part of this definition, not a CLI override, so a deployment and a run can never disagree about it.

import { secretType } from 'types.bicep'

targetScope = 'resourceGroup'

@description('Job name.')
param name string

param location string

param tags object

@description('Resource id of the Container Apps environment.')
param environmentId string

@description('Full image reference.')
param image string

@description('Resource id of the user-assigned identity that pulls from the registry (AcrPull).')
param identityId string

@description('Registry login server.')
param acrLoginServer string

@description('Container command. Empty keeps the image ENTRYPOINT.')
param command array = []

@description('Container arguments. Empty keeps the image CMD.')
param args array = []

@description('Environment entries: { name, value } or { name, secretRef }.')
param env array = []

@description('Container Apps secrets; the value of each is secure (types.bicep).')
param secrets secretType[] = []

@description('vCPU, as a string passed through json().')
param cpu string

param memory string

@description('Seconds before a running execution is stopped.')
param replicaTimeout int

@description('Retries of a failed execution.')
param replicaRetryLimit int = 0

resource job 'Microsoft.App/jobs@2026-07-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: replicaTimeout
      replicaRetryLimit: replicaRetryLimit
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: acrLoginServer
          identity: identityId
        }
      ]
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: name
          image: image
          command: empty(command) ? null : command
          args: empty(args) ? null : args
          env: env
          resources: {
            cpu: json(cpu)
            memory: memory
          }
        }
      ]
    }
  }
}

output name string = job.name
output id string = job.id
