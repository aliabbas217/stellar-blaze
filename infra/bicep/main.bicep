// The Stellar Blaze demo on Azure Container Apps: logging, environment, PostgreSQL, the migrate job and the three
// processes (api, web, alerts). Resource-group scope; deployed by CI as the deployer identity, or by deploy-local.ps1.
//
// Two phases through `deployApps`:
//   false  monitoring, environment, PostgreSQL and job-migrate only. Then infra/scripts/run-migrate.sh.
//   true   the same, plus api, web and alerts. The api must not start against an unmigrated schema.
//
// The registry and the apps identity come from bootstrap.bicep and are only referenced here.

targetScope = 'resourceGroup'

// ---- where, who, what version -----------------------------------------------------------------------------------------

param location string = resourceGroup().location

@description('Name of the container registry created by bootstrap.bicep.')
param acrName string

@description('Resource id of the user-assigned identity with AcrPull on the registry (bootstrap output appsIdentityId).')
param appsIdentityId string

@description('PostgreSQL major version: 18 only where preflight shows it in the region, otherwise 17.')
@allowed([
  '17'
  '18'
])
param postgresVersion string

@secure()
@description('PostgreSQL administrator password: 64 hex characters, so it needs no URL encoding.')
param pgAdminPassword string

@description('Commit the images were built from; released into SB_GIT_SHA and APP_VERSION and into the migrate job audit actor.')
param gitSha string

@description('false: phase 1 (no apps). true: phase 2 (api, web and, for a real api image, alerts).')
param deployApps bool = true

// ---- images and ports --------------------------------------------------------------------------------------------------

param apiImage string
param apiTargetPort int
param apiLivePath string
param apiReadyPath string
@description('true: a public quickstart image stands in for the api (rehearsal); no environment, no secret, probes on /, no alerts worker.')
param apiIsPlaceholder bool

param webImage string
param webTargetPort int
param webHealthPath string
param webIsPlaceholder bool

@description('Image of the migrate job when the api is a placeholder.')
param jobsImage string

// ---- application configuration -----------------------------------------------------------------------------------------

@description('Public VAPID key; web only. Not a secret.')
param vapidPublicKey string = ''

@description('Contact subject of the VAPID key (mailto: URI); alerts only, and only with the private key.')
param vapidSubject string = ''

@secure()
@description('VAPID private key. Empty: no push is sent (the alerts worker then gets neither the key nor the subject, as the backend requires both or neither).')
param vapidPrivateKey string = ''

@secure()
@description('JSON {sha256(token): {actor, role, employer_id}} of the employer access tokens (ADR 0062). Needed by the api when it is deployed.')
param sbAccessTokens string = ''

@secure()
@description('The employer demo token the web server sends to the api; the plain token whose sha256 is a key of sbAccessTokens. Needed by web when it is deployed.')
param demoEmployerToken string = ''

@description('Pins for back-tests only. The backend refuses both with SB_ENV=prod, so they are omitted from the environment when empty and must stay empty in prod.')
param rulesetId string = ''
param modelId string = ''

@allowed([
  'open_meteo'
  'replay'
])
param forecastSource string = 'replay'

@description('Replay snapshot and clock anchor (backend/README.md). api and alerts must get the same values.')
param replaySnapshotId string = 'demo-omaa-2026'
param replayDefaultDate string = '2026-06-14'
param replayNow string = '2026-06-14T10:10:00+04:00'

@description('Proxies in front of web that add an X-Forwarded-For entry. Container Apps ingress provides only the rightmost entry, so 1 is the documented value.')
@minValue(0)
param trustedProxyHops int = 1

// ---- sizes -------------------------------------------------------------------------------------------------------------

param apiCpu string = '1.0'
param apiMemory string = '2Gi'
param webCpu string = '0.5'
param webMemory string = '1Gi'
param alertsCpu string = '0.5'
param alertsMemory string = '1Gi'

// ---- names, tags, constants -------------------------------------------------------------------------------------------

var tags = {
  project: 'stellar-blaze'
  env: 'demo'
  managedBy: 'bicep'
}

var suffix = uniqueString(resourceGroup().id)
var workspaceName = 'log-stellarblaze-demo'
var environmentName = 'cae-stellarblaze-demo'
var postgresName = 'psql-sb-${suffix}'
var migrateJobName = 'job-migrate'

// ADR 0042: the client verifies the server. asyncpg reads the root file from PGSSLROOTCERT; the Debian bundle in the
// backend image holds both roots Microsoft names for Azure Database for PostgreSQL (DigiCert Global Root G2 and
// Microsoft RSA Root Certificate Authority 2017). `ssl=require` would encrypt without authenticating the server.
var pgSslRootCert = '/etc/ssl/certs/ca-certificates.crt'

var isReplay = forecastSource == 'replay'
var hasVapid = !empty(vapidPrivateKey)
var deployAlerts = deployApps && !apiIsPlaceholder

// ---- registry (created by bootstrap) -----------------------------------------------------------------------------------

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = {
  name: acrName
}

var acrLoginServer = registry.properties.loginServer

// ---- monitoring, environment, database ---------------------------------------------------------------------------------

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    name: workspaceName
    location: location
    tags: tags
  }
}

module environment 'modules/environment.bicep' = {
  name: 'environment'
  params: {
    name: environmentName
    location: location
    tags: tags
    workspaceId: monitoring.outputs.workspaceId
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    name: postgresName
    location: location
    tags: tags
    version: postgresVersion
    administratorPassword: pgAdminPassword
  }
}

// The password is 64 hex characters, so it needs no URL encoding. Goes only into Container Apps secrets.
var databaseUrl = 'postgresql+asyncpg://sbadmin:${pgAdminPassword}@${postgres.outputs.fqdn}:5432/stellar_blaze?ssl=verify-full'

// ---- environment entries (names exactly as infra/local/compose.yaml and backend config.py) -----------------------------

// Shared by api, alerts and job-migrate.
var coreEnv = [
  { name: 'SB_ENV', value: 'prod' }
  { name: 'SB_LOG_FORMAT', value: 'json' }
  { name: 'SB_LOG_LEVEL', value: 'INFO' }
  { name: 'SB_GIT_SHA', value: gitSha }
  { name: 'SB_DATABASE_URL', secretRef: 'sb-database-url' }
  { name: 'PGSSLROOTCERT', value: pgSslRootCert }
]

// api and alerts: the same replay values, because each process runs its own clock from the same anchor.
var runtimeEnv = concat(
  [
    { name: 'SB_FORECAST_SOURCE', value: forecastSource }
  ],
  isReplay
    ? [
        { name: 'SB_REPLAY_SNAPSHOT_ID', value: replaySnapshotId }
        { name: 'SB_REPLAY_DEFAULT_DATE', value: replayDefaultDate }
        { name: 'SB_REPLAY_NOW', value: replayNow }
      ]
    : []
)

// Never an empty string: with SB_ENV=prod the backend refuses either pin when it is set.
var pinEnv = concat(
  empty(rulesetId) ? [] : [{ name: 'SB_RULESET_ID', value: rulesetId }],
  empty(modelId) ? [] : [{ name: 'SB_MODEL_ID', value: modelId }]
)

// No VAPID value on the api: it never sends a push (ADR 0058 decision 5).
var apiEnv = concat(coreEnv, runtimeEnv, [{ name: 'SB_ACCESS_TOKENS', secretRef: 'sb-access-tokens' }], pinEnv)

// The worker needs the database and the push key; it has no employer routes, so no access tokens.
var alertsEnv = concat(
  coreEnv,
  runtimeEnv,
  hasVapid
    ? [
        { name: 'SB_VAPID_PRIVATE_KEY', secretRef: 'sb-vapid-private-key' }
        { name: 'SB_VAPID_SUBJECT', value: vapidSubject }
      ]
    : [],
  pinEnv
)

// Container Apps secrets: the only place a secret value is written. Environment entries refer to them by name.
var databaseUrlSecret = { name: 'sb-database-url', value: databaseUrl }

var apiSecrets = [
  databaseUrlSecret
  { name: 'sb-access-tokens', value: sbAccessTokens }
]

var alertsSecrets = concat(
  [databaseUrlSecret],
  hasVapid ? [{ name: 'sb-vapid-private-key', value: vapidPrivateKey }] : []
)

var jobSecrets = [databaseUrlSecret]

// ---- job-migrate (phase 1) ----------------------------------------------------------------------------------------------

// One shell string: `sb-jobs` is on the image PATH and WORKDIR is /app, so alembic.ini and fixtures/ resolve. Both commands
// are idempotent (backend/README.md): the schema upgrade plus the config seed, then the synthetic demo site.
var migrateScript = 'sb-jobs db upgrade && sb-jobs site load fixtures/demo_site.toml --actor "deploy:${gitSha}" --reason "load the synthetic demo site at deploy ${gitSha}"'

module migrateJob 'modules/container-job.bicep' = {
  name: 'job-migrate'
  params: {
    name: migrateJobName
    location: location
    tags: tags
    environmentId: environment.outputs.id
    image: apiIsPlaceholder ? jobsImage : apiImage
    identityId: appsIdentityId
    acrLoginServer: acrLoginServer
    command: apiIsPlaceholder ? [] : ['/bin/sh', '-c']
    args: apiIsPlaceholder ? [] : [migrateScript]
    env: apiIsPlaceholder ? [] : coreEnv
    secrets: apiIsPlaceholder ? [] : jobSecrets
    cpu: '0.5'
    memory: '1Gi'
    replicaTimeout: 600
    replicaRetryLimit: 0
  }
}

// ---- apps (phase 2) -----------------------------------------------------------------------------------------------------

// INTERNAL ingress: the api is not reachable from the internet; only web calls it.
module api 'modules/container-app.bicep' = if (deployApps) {
  name: 'app-api'
  params: {
    name: 'api'
    location: location
    tags: tags
    environmentId: environment.outputs.id
    image: apiImage
    identityId: appsIdentityId
    acrLoginServer: acrLoginServer
    targetPort: apiTargetPort
    externalIngress: false
    cpu: apiCpu
    memory: apiMemory
    env: apiIsPlaceholder ? [] : apiEnv
    secrets: apiIsPlaceholder ? [] : apiSecrets
    startupPath: apiIsPlaceholder ? '/' : apiLivePath
    livePath: apiIsPlaceholder ? '/' : apiLivePath
    readyPath: apiIsPlaceholder ? '/' : apiReadyPath
  }
}

// web reaches the api over the environment's internal ingress. The host is the module output `fqdn`, which is
// app.properties.configuration.ingress.fqdn (the Bicep types expose it, so nothing is derived by hand); for an internal
// app Azure reports <name>.internal.<environment default domain>. Port 443, so the origin carries no port. `api!` is safe:
// web and api share the condition `deployApps`. If the types ever stop exposing it, build the host as
// api.internal.<environment.outputs.defaultDomain> instead (the environment module already outputs defaultDomain).
// UNVERIFIED (not in Microsoft's docs): that Node trusts the certificate served on the internal FQDN. The smoke test through
// the web proxy shows it. The fallback, to be switched on only if it does not (and kept OFF until then): set
//   API_ORIGIN = 'http://api'   (the app name, plain HTTP inside the environment)
// and `allowInsecure: true` on the api ingress (externalIngress stays false), instead of the https origin below.
var apiOrigin = 'https://${api!.outputs.fqdn}'

var webEnv = [
  { name: 'API_ORIGIN', value: apiOrigin }
  { name: 'VAPID_PUBLIC_KEY', value: vapidPublicKey }
  { name: 'APP_VERSION', value: gitSha }
  { name: 'TRUSTED_PROXY_HOPS', value: string(trustedProxyHops) }
  { name: 'DEMO_EMPLOYER_TOKEN', secretRef: 'demo-employer-token' }
]

// NEXT_PUBLIC_SB_DEMO is a build argument of the web image, never an environment variable here.
module web 'modules/container-app.bicep' = if (deployApps) {
  name: 'app-web'
  params: {
    name: 'web'
    location: location
    tags: tags
    environmentId: environment.outputs.id
    image: webImage
    identityId: appsIdentityId
    acrLoginServer: acrLoginServer
    targetPort: webTargetPort
    externalIngress: true
    cpu: webCpu
    memory: webMemory
    env: webIsPlaceholder ? [] : webEnv
    secrets: webIsPlaceholder ? [] : [{ name: 'demo-employer-token', value: demoEmployerToken }]
    startupPath: webIsPlaceholder ? '/' : webHealthPath
    livePath: webIsPlaceholder ? '/' : webHealthPath
    readyPath: webIsPlaceholder ? '/' : webHealthPath
  }
}

// A long-running loop, not a cron job: no ingress, no probes. `command` and `args` are both set because Microsoft does not
// document whether the image CMD survives when only `command` is set.
module alerts 'modules/container-app.bicep' = if (deployAlerts) {
  name: 'app-alerts'
  params: {
    name: 'alerts'
    location: location
    tags: tags
    environmentId: environment.outputs.id
    image: apiImage
    identityId: appsIdentityId
    acrLoginServer: acrLoginServer
    cpu: alertsCpu
    memory: alertsMemory
    command: ['sb-jobs']
    args: ['alerts', 'run']
    env: alertsEnv
    secrets: alertsSecrets
    terminationGracePeriodSeconds: 60
  }
}

// ---- outputs (no secret, no database URL) -------------------------------------------------------------------------------

@description('Internal FQDN of the api (empty in phase 1).')
output apiFqdn string = api.?outputs.?fqdn ?? ''

@description('Public FQDN of web (empty in phase 1).')
output webFqdn string = web.?outputs.?fqdn ?? ''

output environmentName string = environment.outputs.name

output postgresFqdn string = postgres.outputs.fqdn

output migrateJobName string = migrateJob.outputs.name
