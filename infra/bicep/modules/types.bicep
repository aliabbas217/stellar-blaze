// Types shared by the container app and container job modules.

targetScope = 'resourceGroup'

@description('A Container Apps secret. Bicep has no secure array parameter, so the secrecy is declared on the property.')
@export()
type secretType = {
  @description('Secret name; an environment entry refers to it with secretRef.')
  name: string

  @secure()
  @description('Secret value.')
  value: string
}
