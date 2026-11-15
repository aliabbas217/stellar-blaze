// Every value comes from an environment variable, so no inline `--parameters key=value` is mixed with this file
// (infra/README.md, deploy.yml and deploy-local.ps1 export them). Secrets reach Bicep only this way; none is written
// here, none is passed on a command line.
//
// Always required:
//   ACR_NAME  APPS_IDENTITY_ID  POSTGRES_VERSION (17|18)  PG_ADMIN_PASSWORD  GIT_SHA
//   DEPLOY_APPS (false = phase 1: environment, database, job-migrate; true = phase 2: also api, web, alerts)
//   API_IMAGE  API_TARGET_PORT  API_LIVE_PATH  API_READY_PATH  API_IS_PLACEHOLDER
//   WEB_IMAGE  WEB_TARGET_PORT  WEB_HEALTH_PATH  WEB_IS_PLACEHOLDER  JOBS_IMAGE
// Optional (default in brackets). The three secrets are used only by the apps, so phase 1 works without them:
//   VAPID_PUBLIC_KEY ['']  VAPID_SUBJECT ['']  VAPID_PRIVATE_KEY [''] (secret)
//   SB_ACCESS_TOKENS [''] (secret JSON)  DEMO_EMPLOYER_TOKEN [''] (secret)
//   SB_RULESET_ID ['']  SB_MODEL_ID ['']  (the backend refuses both in prod: leave unset)
//   TRUSTED_PROXY_HOPS [1]
// Not read here, so they keep the template defaults: FORECAST_SOURCE (replay), the SB_REPLAY_* values and the sizes.

using 'main.bicep'

param acrName = readEnvironmentVariable('ACR_NAME')
param appsIdentityId = readEnvironmentVariable('APPS_IDENTITY_ID')
param postgresVersion = readEnvironmentVariable('POSTGRES_VERSION')
param pgAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD')
param gitSha = readEnvironmentVariable('GIT_SHA')
param deployApps = bool(readEnvironmentVariable('DEPLOY_APPS'))

param apiImage = readEnvironmentVariable('API_IMAGE')
param apiTargetPort = int(readEnvironmentVariable('API_TARGET_PORT'))
param apiLivePath = readEnvironmentVariable('API_LIVE_PATH')
param apiReadyPath = readEnvironmentVariable('API_READY_PATH')
param apiIsPlaceholder = bool(readEnvironmentVariable('API_IS_PLACEHOLDER'))

param webImage = readEnvironmentVariable('WEB_IMAGE')
param webTargetPort = int(readEnvironmentVariable('WEB_TARGET_PORT'))
param webHealthPath = readEnvironmentVariable('WEB_HEALTH_PATH')
param webIsPlaceholder = bool(readEnvironmentVariable('WEB_IS_PLACEHOLDER'))

param jobsImage = readEnvironmentVariable('JOBS_IMAGE')

param vapidPublicKey = readEnvironmentVariable('VAPID_PUBLIC_KEY', '')
param vapidSubject = readEnvironmentVariable('VAPID_SUBJECT', '')
param vapidPrivateKey = readEnvironmentVariable('VAPID_PRIVATE_KEY', '')
param sbAccessTokens = readEnvironmentVariable('SB_ACCESS_TOKENS', '')
param demoEmployerToken = readEnvironmentVariable('DEMO_EMPLOYER_TOKEN', '')
param rulesetId = readEnvironmentVariable('SB_RULESET_ID', '')
param modelId = readEnvironmentVariable('SB_MODEL_ID', '')
param trustedProxyHops = int(readEnvironmentVariable('TRUSTED_PROXY_HOPS', '1'))
