// Resource-group half of the bootstrap: identities, the optional GitHub federated credential,
// the container registry and every role assignment. Deployed by bootstrap.bicep.
//
// Only this module creates role assignments, so the CI deployer never needs rights over authorization.

targetScope = 'resourceGroup'

@description('Azure region for the registry and the identities.')
param location string

@description('GitHub account that owns the repository, typed exactly as GitHub shows it (the OIDC subject is case-sensitive). Empty: no federated credential is created.')
param githubOwner string = ''

@description('GitHub repository name, typed exactly as GitHub shows it.')
param githubRepo string = 'stellar-blaze'

@description('GitHub environment whose jobs may sign in as the deployer identity.')
param githubEnvironment string = 'demo'

@description('Object id of the signed-in operator (a user). When non-empty that user gets AcrPush on the registry, so local image pushes do not depend on Owner or Contributor implying it.')
param operatorPrincipalId string = ''

param tags object

// Built-in role definition ids (Microsoft Learn, Azure built-in roles; confirmed 2026-11-15).
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var acrPushRoleId = '8311e382-0749-4cb8-b61a-304f252e45ec'
var contributorRoleId = 'b24988ac-6180-42a0-ab88-20f7382dd24c'

var acrName = 'acrsb${take(uniqueString(resourceGroup().id), 13)}'

// Pulls images for the container apps and jobs.
resource appsIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-sb-apps'
  location: location
  tags: tags
}

// What GitHub Actions signs in as, through the federated credential below.
resource deployerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-sb-deployer'
  location: location
  tags: tags
}

// Only one federated credential exists, so there is no concurrent-write 409 on this identity.
resource githubCredential 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2024-11-30' = if (!empty(githubOwner)) {
  parent: deployerIdentity
  name: 'github-${githubEnvironment}'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubOwner}/${githubRepo}:environment:${githubEnvironment}'
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
    // AcrPull and AcrPush are not honoured in an ABAC-mode registry (and ABAC is announced to become the
    // default), so the permission model is pinned. Revisit together with the role assignments below.
    roleAssignmentMode: 'LegacyRegistryPermissions'
    policies: {
      // A managed-identity image pull from Container Apps authenticates with an ARM-audience token.
      azureADAuthenticationAsArmPolicy: {
        status: 'enabled'
      }
    }
  }
}

// The names use the identity resource ids (known at the start of the deployment); principal ids are only
// known after the identities exist, which a role assignment name may not depend on.
resource appsAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, appsIdentity.id, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: appsIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource deployerAcrPush 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, deployerIdentity.id, acrPushRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPushRoleId)
    principalId: deployerIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// No `scope`: the assignment lands on this resource group.
resource deployerContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, deployerIdentity.id, contributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', contributorRoleId)
    principalId: deployerIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource operatorAcrPush 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(operatorPrincipalId)) {
  name: guid(registry.id, operatorPrincipalId, acrPushRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPushRoleId)
    principalId: operatorPrincipalId
    principalType: 'User'
  }
}

output acrName string = registry.name
output acrLoginServer string = registry.properties.loginServer
output deployerClientId string = deployerIdentity.properties.clientId
output appsIdentityId string = appsIdentity.id
output appsIdentityPrincipalId string = appsIdentity.properties.principalId
