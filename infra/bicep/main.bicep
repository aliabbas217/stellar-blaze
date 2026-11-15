// The Stellar Blaze demo on Azure Container Apps: logging, environment, PostgreSQL, the migrate job and the three
// processes (api, web, alerts). Resource-group scope; deployed by CI as the deployer identity, or by deploy-local.ps1.
//
// Two phases through `deployApps`:
//   false  monitoring, environment, PostgreSQL and job-migrate only. Then infra/scripts/run-migrate.sh.
//   true   the same, plus api, web and alerts. The api must not start against an unmigrated schema.
//
// CHEAP BY DEFAULT (architect ruling 2026-11-15, "keep things as cheap as possible"). Prices are Azure Retail Prices for
// uaenorth on 2026-11-15, in USD: active vCPU 0.000024 per second, memory 0.000003 per GiB-second, idle vCPU 0.000003 per
// second; every subscription gets 180,000 vCPU-seconds and 360,000 GiB-seconds free each month. What that bought:
//   web     0.25 vCPU / 0.5 GiB, always one replica. It is the public face and measured about 73 MiB.
//   api     0.5 vCPU / 1 GiB, INTERNAL ingress, scale to ZERO by default (apiMinReplicas = 0): a demo that nobody is looking at
//           costs nothing for it. This is safe only because the replay clock is the epoch row in Postgres (ADR 0034 amendment),
//           so an api that restarts from zero loses no state; the price is a cold start on the first request after the
//           300 s scale-down cooldown (infra/scripts/measure-cold-start.sh measures it).
//   alerts  0.25 vCPU / 0.5 GiB, always one replica: an always-on 0.25 vCPU / 0.5 GiB worker billed active is about USD 19.71
//           a month. It stays a worker and NOT a one-minute cron job, on measured evidence (see the alerts module below).
//   Log Analytics is capped at 0.15 GB a day (monitoring.bicep) and PostgreSQL is Burstable B1ms with the minimum 32 GiB.
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

@description('Minimum replicas of the api: 0 (the default) scales it to zero when idle and costs nothing then; 1 keeps it warm and avoids the cold start on the first request (about 0.5 vCPU / 1 GiB, USD 0.000024 x 0.5 + 0.000003 x 1 a second when billed active). The maximum is 1 either way.')
@minValue(0)
@maxValue(1)
param apiMinReplicas int = 0

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

@description('How long the web proxy waits for the api on the SAFETY routes (Stop and the unwell actions), in ms. Deliberately short: a person must get an answer or an error fast, never a long spinner.')
@minValue(1000)
@maxValue(240000)
param webUpstreamTimeoutMs int = 10000

@description('How long the web proxy waits for the api on every other route, in ms. Must cover the cold start of the scale-to-zero api (measured about 29 s) and stay below the 240 s Container Apps ingress request timeout.')
@minValue(1000)
@maxValue(240000)
param webUpstreamReadTimeoutMs int = 45000

// ---- sizes -------------------------------------------------------------------------------------------------------------

// api: 0.5 vCPU / 1 GiB. Measured about 205 MiB at rest, so 1 GiB is about 5x headroom for a PHS worker and the model; the
// smallest Consumption pairing that has it is 0.5 vCPU / 1 GiB. web measured about 73 MiB; the alerts worker's one-off
// dispatch ran inside a 512 MiB limit. 0.25 vCPU / 0.5 GiB is the smallest Consumption size.
param apiCpu string = '0.5'
param apiMemory string = '1Gi'
param webCpu string = '0.25'
param webMemory string = '0.5Gi'
param alertsCpu string = '0.25'
param alertsMemory string = '0.5Gi'

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

// Container Apps secrets: the only place a secret value is written. Each is an OBJECT, secret name to value, passed to a
// `@secure() param secrets object` of the module: Azure redacts a securestring or secureObject parameter from the deployment
// history (Reader on the group sees no value), which it is not known to do for a secure property inside an array parameter.
// The module turns the object into the { name, value } array Container Apps wants. Environment entries refer to a secret by
// name (secretRef); an entry is present only when its value is not empty, because Container Apps refuses an empty secret.
var databaseUrlSecret = {
  'sb-database-url': databaseUrl
}

var apiSecrets = union(databaseUrlSecret, empty(sbAccessTokens) ? {} : { 'sb-access-tokens': sbAccessTokens })

var alertsSecrets = union(databaseUrlSecret, hasVapid ? { 'sb-vapid-private-key': vapidPrivateKey } : {})

var jobSecrets = databaseUrlSecret

var webSecrets = empty(demoEmployerToken) ? {} : { 'demo-employer-token': demoEmployerToken }

// ---- job-migrate (phase 1) ----------------------------------------------------------------------------------------------

// The whole job is the file infra/bicep/scripts/migrate.sh, loaded as text and run as `/bin/sh -c <text>`: the schema upgrade and
// config seed, the synthetic demo site, then the active runtime config with alert_dispatch_interval_minutes = 1. The rehearsal
// (infra/local/compose.yaml) mounts and runs the very same file, so the two cannot drift. `sb-jobs` is on the image PATH and
// WORKDIR is /app, so alembic.ini, fixtures/ and config/ resolve. Every step is idempotent (backend/README.md).
var migrateScript = loadTextContent('scripts/migrate.sh')

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
    secrets: apiIsPlaceholder ? {} : jobSecrets
    cpu: '0.5'
    memory: '1Gi'
    replicaTimeout: 600
    replicaRetryLimit: 0
  }
}

// ---- apps (phase 2) -----------------------------------------------------------------------------------------------------

// INTERNAL ingress: the api is not reachable from the internet; only web calls it. With apiMinReplicas = 0 there is no scale
// rule of our own, so Container Apps applies its default HTTP rule (10 concurrent requests) and removes the last replica
// after the 300 s cooldown; the first request after that waits for a cold start (the startup probe allows 150 s).
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
    minReplicas: apiMinReplicas
    env: apiIsPlaceholder ? [] : apiEnv
    secrets: apiIsPlaceholder ? {} : apiSecrets
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
  // Cold start of the scale-to-zero api (measured about 29 s) is longer than the BFF's old fixed 10 s, so the read routes get a
  // longer wait. The safety routes (Stop, unwell actions) keep the short one on purpose: they must fail fast, not hang.
  { name: 'UPSTREAM_TIMEOUT_MS', value: string(webUpstreamTimeoutMs) }
  { name: 'UPSTREAM_READ_TIMEOUT_MS', value: string(webUpstreamReadTimeoutMs) }
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
    secrets: webIsPlaceholder ? {} : webSecrets
    startupPath: webIsPlaceholder ? '/' : webHealthPath
    livePath: webIsPlaceholder ? '/' : webHealthPath
    readyPath: webIsPlaceholder ? '/' : webHealthPath
  }
}

// A long-running loop, not a cron job: no ingress, no probes. `command` and `args` are both set because Microsoft does not
// document whether the image CMD survives when only `command` is set.
//
// WHY NOT A ONE-MINUTE CRON JOB (`sb-jobs alerts dispatch`, which would bill only while it runs; the architect asked for it to be
// tried and the rehearsal, infra/local/rehearse.sh R8, measures it). One dispatch in a fresh container of the api image against
// the migrated database took 11-12 s unconstrained but 57-62 s (3 runs) at 0.25 vCPU / 512 MiB and 38.7 s at 0.5 vCPU, in a
// docker CPU quota that stands in for the Container Apps limit; `sb-jobs --help` alone takes 17.7 s at 0.25 vCPU, because
// the python imports are paid in full by every start. At the job's size a run does not finish inside one minute (a
// Container Apps job has no concurrency policy, so runs would overlap), and at 0.5 vCPU it takes about 39 s, which at
// USD 0.000024 x 0.5 + 0.000003 x 1 a second is about USD 25 a month, more than this worker's USD 19.71. The worker pays
// the imports once. Revisit if the import time drops (a backend change, not an infrastructure one).
//
// Its cadence is max(60 s, alert_dispatch_interval_minutes x 60) of the ACTIVE config; job-migrate (scripts/migrate.sh) sets
// that to 1, so a stop reaches a phone in about 1 min 30 s (60 s period + 15 s forecast leg + 15 s delivery).
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
