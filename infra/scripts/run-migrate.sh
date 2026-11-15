#!/usr/bin/env bash
# Migrate-first step of the deploy: run the Container Apps job `job-migrate` to completion BEFORE the apps roll out.
#
#   run-migrate.sh <resource-group> <apiImage> <placeholder: true|false>
#
# The job's image, command and arguments are defined by the Bicep (phase 1 of the deployment creates it), never by a CLI
# override: `sb-jobs db upgrade && sb-jobs site load ...` needs `-c` and `--actor`, which `az ... --command/--args` would
# parse as its own options, and starting a job with overrides needs write permission on the job. So this script
#   1. exits 0 with `skip: placeholder` for a placeholder image (the placeholder job runs nothing useful);
#   2. otherwise REQUIRES the job to exist (a missing job is an error for a real image, never a silent skip: the apps
#      would roll out against an un-migrated schema) and to run exactly <apiImage>, and stops BEFORE starting anything if not;
#   3. starts the job (`az containerapp job start`, no overrides), polls the execution until it ends, and retries with a NEW
#      execution after Failed, Stopped, Degraded or a timeout: the first real image pull can fail while the AcrPull role
#      assignment propagates (up to about 10 minutes), and both commands are idempotent.
# Never calls `az containerapp job update`. Environment (all optional):
#   MIGRATE_POLL_S 10   MIGRATE_TIMEOUT_S 600 (per execution)   MIGRATE_ATTEMPTS 2   MIGRATE_RETRY_WAIT_S 90
# Exit 0 on Succeeded, 1 otherwise.

set -euo pipefail

scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$scripts_dir/lib.sh"

job="job-migrate"
poll_s="${MIGRATE_POLL_S:-10}"
timeout_s="${MIGRATE_TIMEOUT_S:-600}"
attempts="${MIGRATE_ATTEMPTS:-2}"
retry_wait_s="${MIGRATE_RETRY_WAIT_S:-90}"
log_hint='ContainerAppConsoleLogs | where ContainerGroupName startswith "job-migrate" | order by TimeGenerated desc | take 50'

usage() {
  printf 'usage: run-migrate.sh <resource-group> <apiImage> <placeholder: true|false>\n' >&2
  exit 1
}

[ "$#" -eq 3 ] || usage
rg="$1"
api_image="$2"
placeholder="$3"

case "$placeholder" in
  true)
    printf 'skip: placeholder\n'
    exit 0
    ;;
  false) ;;
  *) usage ;;
esac

for number in "$poll_s" "$timeout_s" "$attempts" "$retry_wait_s"; do
  [[ "$number" =~ ^[0-9]+$ ]] || die "MIGRATE_* settings must be whole numbers, got '$number'"
done
[ "$attempts" -ge 1 ] || die "MIGRATE_ATTEMPTS must be at least 1"
[ -n "$api_image" ] || die "the api image is empty"

# ---- the job exists and runs the image this deploy built ----------------------------------------------------------------

deployed_image="$(az_tsv containerapp job show -n "$job" -g "$rg" --query 'properties.template.containers[0].image' || true)"
if is_null_value "$deployed_image"; then
  die "job $job not found (or unreadable) in $rg. The deploy runs phase 1 of main.bicep (deployApps=false) first, which creates it; a real image is never migrated 'later'."
fi
if [ "$deployed_image" != "$api_image" ]; then
  log "job $job runs      $deployed_image"
  log "this deploy built  $api_image"
  die "job $job does not run the image of this deploy; refusing to start it. Re-run phase 1 of main.bicep with apiImage=$api_image."
fi
log "job $job runs $api_image"

# ---- start, poll, retry -------------------------------------------------------------------------------------------------

# start_execution: print the name of the execution just started. `job start` is documented to return the
# execution, but what the CLI prints is not specified, so an empty answer falls back to the newest execution by start time.
start_execution() {
  local name
  name="$(az_tsv containerapp job start -n "$job" -g "$rg" --query name || true)"
  if is_null_value "$name"; then
    name="$(az_tsv containerapp job execution list -n "$job" -g "$rg" --query 'sort_by([], &properties.startTime)[-1].name' || true)"
  fi
  if is_null_value "$name"; then
    return 1
  fi
  printf '%s\n' "$name"
}

# wait_execution <name>: poll until the execution ends. Prints the final status; Succeeded returns 0, any other end 1.
wait_execution() {
  local name="$1" began="$SECONDS" status last=""
  while true; do
    status="$(az_tsv containerapp job execution show -n "$job" -g "$rg" --job-execution-name "$name" --query properties.status || true)"
    if [ "$status" != "$last" ]; then
      log "execution $name: ${status:-<unreadable>}"
      last="$status"
    fi
    case "$status" in
      Succeeded)
        printf 'Succeeded\n'
        return 0
        ;;
      Failed | Stopped | Degraded)
        printf '%s\n' "$status"
        return 1
        ;;
      *) ;;
    esac
    if [ $((SECONDS - began)) -ge "$timeout_s" ]; then
      printf 'timeout\n'
      return 1
    fi
    sleep "$poll_s"
  done
}

attempt=1
last_name="<none>"
last_result="not started"
while true; do
  log "attempt $attempt of $attempts: starting $job"
  name=""
  if name="$(start_execution)" && [ "$name" != "$last_name" ]; then
    last_name="$name"
    if last_result="$(wait_execution "$name")"; then
      printf 'migrate ok: execution %s Succeeded (attempt %s)\n' "$name" "$attempt"
      exit 0
    fi
  else
    last_result="no new execution could be identified after the start"
    log "$last_result"
  fi
  if [ "$attempt" -ge "$attempts" ]; then
    break
  fi
  log "attempt $attempt ended ($last_result); starting a new execution in ${retry_wait_s}s (the first real image pull can fail while AcrPull propagates)"
  sleep "$retry_wait_s"
  attempt=$((attempt + 1))
done

printf 'migrate FAILED after %s attempt(s): last execution %s, result %s\n' "$attempt" "$last_name" "$last_result"
printf 'Log Analytics query for the output of the job:\n  %s\n' "$log_hint"
exit 1
