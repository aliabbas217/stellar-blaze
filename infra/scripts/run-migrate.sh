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
# Which execution is ours: what `az containerapp job start` prints is undocumented (it may print nothing, or `None`). The names
# of the existing executions are recorded BEFORE the start; when the start names nothing usable, the execution is the one that
# appears in the list and is NOT in that record (polled for MIGRATE_IDENTIFY_TIMEOUT_S), and the attempt FAILS if none appears.
# A name from the record is never polled: the previous deploy's execution is already Succeeded, and reading it would let the
# apps roll out against an un-migrated schema.
# Never calls `az containerapp job update`. Environment (all optional):
#   MIGRATE_POLL_S 10   MIGRATE_TIMEOUT_S 600 (per execution)   MIGRATE_ATTEMPTS 2   MIGRATE_RETRY_WAIT_S 90
#   MIGRATE_IDENTIFY_TIMEOUT_S 60 (how long to look for the new execution in the list; 0 = one look)
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
identify_timeout_s="${MIGRATE_IDENTIFY_TIMEOUT_S:-60}"
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

for number in "$poll_s" "$timeout_s" "$attempts" "$retry_wait_s" "$identify_timeout_s"; do
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

# execution_names: the names of every execution of the job, one per line (a `None` or empty line is dropped). Returns az's
# status, because a FAILED list is not an empty list (an unreadable "before" set must never be mistaken for "no executions").
execution_names() {
  local listed line
  listed="$(az_tsv containerapp job execution list -n "$job" -g "$rg" --query '[].name')" || return
  while IFS= read -r line; do
    if ! is_null_value "$line"; then
      printf '%s\n' "$line"
    fi
  done <<<"$listed"
}

# is_listed <name> <newline separated names>: success when the name is one of them (whole line, no pipe).
is_listed() {
  local line
  while IFS= read -r line; do
    if [ "$line" = "$1" ]; then
      return 0
    fi
  done <<<"$2"
  return 1
}

# find_new_execution <names known before the start>: print the first execution name that is NOT among them, polling the list
# (an execution may not be listed the instant after `start`) for at most MIGRATE_IDENTIFY_TIMEOUT_S; 1 when none appears.
# The newest-by-time guess this replaces could return the PREVIOUS deploy's execution (already Succeeded) while the new one was
# not listed yet, and the deploy would roll the apps out against an un-migrated schema.
find_new_execution() {
  local known="$1" began="$SECONDS" current candidate
  while true; do
    if current="$(execution_names)"; then
      while IFS= read -r candidate; do
        if [ -n "$candidate" ] && ! is_listed "$candidate" "$known"; then
          printf '%s\n' "$candidate"
          return 0
        fi
      done <<<"$current"
    fi
    if [ $((SECONDS - began)) -ge "$identify_timeout_s" ]; then
      log "no execution other than the ones that existed before the start was listed within ${identify_timeout_s}s"
      return 1
    fi
    sleep "$poll_s"
  done
}

# start_execution: print the name of the execution just started. `job start` is documented to return the execution, but what
# the CLI prints is not specified (and `-o tsv` prints `None` for a null). The names that exist BEFORE the start are recorded;
# when the start names nothing usable, the execution is the one that appears in the list and is not in that record. A name
# from the record is never returned, so the status of an earlier deploy's execution is never read as this one's.
start_execution() {
  local known="" known_ok=true name
  if ! known="$(execution_names)"; then
    known_ok=false
    known=""
    log "could not list the executions before the start; the start's own answer is the only way to tell which one is ours"
  fi
  name="$(az_tsv containerapp job start -n "$job" -g "$rg" --query name || true)"
  if ! is_null_value "$name" && is_listed "$name" "$known"; then
    log "the start answered $name, which existed before it; not trusting that answer"
    name=""
  fi
  if is_null_value "$name"; then
    if [ "$known_ok" != true ]; then
      return 1
    fi
    name="$(find_new_execution "$known")" || return 1
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
