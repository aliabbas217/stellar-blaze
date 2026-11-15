// One container app. Used for api (internal ingress), web (external ingress) and alerts (no ingress, no probes).
//
// Single revision mode, a fixed replica count, a user-assigned identity that pulls the image, and probes written out
// explicitly: Container Apps adds default probes only in the portal, not for a template or an ARM deployment.

targetScope = 'resourceGroup'

@description('App name; also the first label of its ingress FQDN.')
param name string

param location string

param tags object

@description('Resource id of the Container Apps environment.')
param environmentId string

@description('Full image reference, for example acrname.azurecr.io/sb-api:<sha>.')
param image string

@description('Resource id of the user-assigned identity that pulls from the registry (AcrPull).')
param identityId string

@description('Registry login server, for example acrname.azurecr.io.')
param acrLoginServer string

@description('Container port. 0 means no ingress at all (a worker).')
@minValue(0)
@maxValue(65535)
param targetPort int = 0

@description('Whether the ingress is reachable from the internet. Ignored when targetPort is 0.')
param externalIngress bool = false

@description('vCPU, as a string so that 0.5 is not a bicep int: passed through json().')
param cpu string

@description('Memory, for example 1Gi. It must pair with the vCPU (Consumption: 0.5 vCPU / 1 Gi, 1 vCPU / 2 Gi).')
param memory string

@description('Container command (overrides the image ENTRYPOINT). Empty keeps the image default.')
param command array = []

@description('Container arguments (override the image CMD). Empty keeps the image default.')
param args array = []

@description('Environment entries: { name, value } or { name, secretRef }.')
param env array = []

@secure()
@description('Container Apps secrets as an object: secret name to secret value. A secureObject, so Azure redacts the whole value from the deployment history; the array of { name, value } that Container Apps wants is built below.')
param secrets object = {}

@description('Startup probe path. All three paths empty means no probes.')
param startupPath string = ''

@description('Liveness probe path.')
param livePath string = ''

@description('Readiness probe path.')
param readyPath string = ''

@description('Seconds the platform waits for the process to stop before it kills it. Unset keeps the platform default.')
param terminationGracePeriodSeconds int?

@minValue(0)
param minReplicas int = 1

@minValue(1)
param maxReplicas int = 1

// The names are all that objectKeys() returns of a secure object; each value is read by name.
var secretEntries = [for secretName in objectKeys(secrets): {
  name: secretName
  value: secrets[secretName]
}]

var hasIngress = targetPort > 0
var hasProbes = !empty(startupPath) || !empty(livePath) || !empty(readyPath)

// Schema limits (Microsoft.App/containerApps): failureThreshold <= 10, periodSeconds <= 240, initialDelaySeconds <= 60.
var probes = hasProbes
  ? [
      {
        type: 'Startup'
        httpGet: {
          path: startupPath
          port: targetPort
          scheme: 'HTTP'
        }
        periodSeconds: 15
        failureThreshold: 10
        timeoutSeconds: 5
      }
      {
        type: 'Liveness'
        httpGet: {
          path: livePath
          port: targetPort
          scheme: 'HTTP'
        }
        periodSeconds: 30
        failureThreshold: 3
        timeoutSeconds: 5
      }
      {
        type: 'Readiness'
        httpGet: {
          path: readyPath
          port: targetPort
          scheme: 'HTTP'
        }
        periodSeconds: 10
        failureThreshold: 3
        timeoutSeconds: 5
      }
    ]
  : []

resource app 'Microsoft.App/containerApps@2026-07-01' = {
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
      activeRevisionsMode: 'Single'
      ingress: hasIngress
        ? {
            external: externalIngress
            targetPort: targetPort
            transport: 'auto'
            allowInsecure: false
          }
        : null
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
          probes: probes
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
      terminationGracePeriodSeconds: terminationGracePeriodSeconds
    }
  }
}

output name string = app.name
@description('Ingress FQDN; empty for an app without ingress. An internal app has the form <name>.internal.<environment domain>.')
output fqdn string = app.properties.configuration.?ingress.?fqdn ?? ''
output latestRevisionName string = app.properties.latestRevisionName
