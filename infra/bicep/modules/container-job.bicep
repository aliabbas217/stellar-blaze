// One manually triggered container app job (job-migrate). Started by infra/scripts/run-migrate.sh; the command line
// is part of this definition, not a CLI override, so a deployment and a run can never disagree about it.

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

@secure()
@description('Container Apps secrets as an object: secret name to secret value. A secureObject, so Azure redacts the whole value from the deployment history; the array of { name, value } that Container Apps wants is built below.')
param secrets object = {}

@description('vCPU, as a string passed through json().')
param cpu string

param memory string

@description('Seconds before a running execution is stopped.')
param replicaTimeout int

@description('Retries of a failed execution.')
param replicaRetryLimit int = 0

// The names are all that objectKeys() returns of a secure object; each value is read by name.
var secretEntries = [for secretName in objectKeys(secrets): {
  name: secretName
  value: secrets[secretName]
}]

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
      secrets: secretEntries
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
