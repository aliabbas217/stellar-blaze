// PostgreSQL Flexible Server for the demo: Burstable B1ms, public access limited to Azure services by the
// 0.0.0.0 firewall rule (stage 1; a VNet is stage 2), password authentication only. `require_secure_transport`
// is left at its default (on); the clients verify the server certificate (ADR 0042, see main.bicep).

targetScope = 'resourceGroup'

@description('Server name; part of the public host name, so it must be globally unique.')
param name string

param location string

param tags object

@description('Major version. 18 only where preflight shows it available in the region, otherwise 17.')
@allowed([
  '17'
  '18'
])
param version string

@description('Administrator login.')
param administratorLogin string = 'sbadmin'

@secure()
@description('Administrator password: 64 hex characters, so it needs no URL encoding in the database URL.')
param administratorPassword string

@description('Application database.')
param databaseName string = 'stellar_blaze'

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2026-10-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: version
    createMode: 'Default'
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

// "Allow public access from any Azure service within Azure to this server" is the 0.0.0.0 - 0.0.0.0 rule.
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2026-10-01' = {
  parent: server
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// Child operations on one flexible server are serialised: concurrent writes fail with a "server is busy" conflict.
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2026-10-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
  dependsOn: [
    allowAzureServices
  ]
}

output fqdn string = server.properties.fullyQualifiedDomainName
output name string = server.name
output databaseName string = database.name
