#!/usr/bin/env bash
# Restart the three Container Apps of the demo (api, alerts, web) back to back and wait until they are healthy again.
#
#   restart-apps.sh <resource-group> [--timeout 300]
#
# WHY: Container Apps creates no new revision when only secret VALUES change, so rotated secrets (the demo token, the access
# tokens, the database password) reach running replicas only after a restart. CI and deploy-local.ps1 run this script as the
# LAST step before the smoke test. It is also what to run after rotating a secret by hand.
#
# The restart is `az containerapp revision restart` on the latest revision of each app. ALL restarts are issued before ANY
# wait (a wait first would put the second restart a whole wait behind the first). The apps are independent of each other: the
# replay clock of the demo is the epoch row in Postgres (ADR 0034 amendment), so a restart of any app rewinds nothing and the
# apps need not restart together; the order is only the order of the report.
#
# After the restarts it waits until the replica names of each app change OR a settle time has passed (RESTART_SETTLE_S, default
# 60), THEN runs the revision conditions of healthcheck.sh on each app (latest revision ready, image unchanged, running, healthy,
# a replica). UNVERIFIED (no Azure access): whether `revision restart` gives the replicas NEW names or restarts them in place. If
# they get new names the wait ends as soon as they appear; if the restart is in place the names never change, and the settle
# time is what stops the wait (a restart that is in place cannot be told from one that never happened by the names alone, so
# the healthcheck that follows is the gate, not the names). Nothing else is modified: no image, no secret, no scale, no
# environment.
#
# CHEAP MODE: the api scales to zero (API_MIN_REPLICAS=0, read from the app: properties.template.scale.minReplicas). With
# minReplicas 0 the api may have NO replica at any moment (it scales down after a 300 s cooldown, and the checks before this
# step take minutes), so:
#   - an api with no replica when the script starts has nothing to restart and holds no secret in memory (it reads its secrets
#     at its next cold start): its restart is SKIPPED (the script says so);
#   - a restart that fails because the replica scaled down meanwhile is tolerated (logged) when the api has no replica after
#     the failure; a restart that fails with a replica still there is an error;
#   - its gate is ALWAYS healthcheck.sh --allow-zero-replicas (revision ready, image, provisioned): zero replicas at gate time is
#     normal, but a replica that IS there must still meet every rule.
# With minReplicas 1 the api always has a replica: it is always restarted, a failed restart or a failed replica list is an
# error (an az failure is never read as "no replica"), and the gate is strict. The alerts worker and web are always one replica
# and are always restarted.
#
# Environment: HEALTH_POLL_S (default 10; also the poll of the replica wait), RESTART_SETTLE_S (default 60; tests 0).

set -euo pipefail

scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$scripts_dir/lib.sh"

usage() {
  printf 'usage: restart-apps.sh <resource-group> [--timeout 300]\n' >&2
  exit 1
}

rg=""
timeout_s=300
poll_s="${HEALTH_POLL_S:-10}"
settle_s="${RESTART_SETTLE_S:-60}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --timeout)
      [ "$#" -ge 2 ] || usage
      timeout_s="$2"
      shift 2
      ;;
    -*) usage ;;
    *)
      [ -z "$rg" ] || usage
      rg="$1"
      shift
      ;;
  esac
done
[ -n "$rg" ] || usage
[[ "$timeout_s" =~ ^[0-9]+$ ]] || die "--timeout must be a whole number of seconds, got '$timeout_s'"
[[ "$poll_s" =~ ^[0-9]+$ ]] || die "HEALTH_POLL_S must be a whole number, got '$poll_s'"
[[ "$settle_s" =~ ^[0-9]+$ ]] || die "RESTART_SETTLE_S must be a whole number, got '$settle_s'"

apps=(api alerts web)

# app_value <app> <query>: one az value, empty on error.
app_value() {
  az_tsv containerapp show -n "$1" -g "$rg" --query "$2" || true
}

# replica_names <app> <revision>: the replica names of the revision, one per line. The exit status is az's: an az error and
# "no replica" are NOT the same thing (empty output with status 0 is "none"); callers that do not care add `|| true`.
replica_names() {
  az_tsv containerapp replica list -n "$1" -g "$rg" --revision "$2" --query '[].name'
}

# wait_replicas_or_settle <app> <old names>: return when the app's latest revision has replicas and none of the old names is
# left, or when RESTART_SETTLE_S has passed since the restarts were issued (the replicas may be restarted in place).
wait_replicas_or_settle() {
  local app="$1" old="$2" revision current name stale
  while true; do
    revision="$(app_value "$app" 'properties.latestRevisionName')"
    current=""
    if ! is_null_value "$revision"; then
      current="$(replica_names "$app" "$revision" || true)"
    fi
    stale=""
    for name in $current; do
      if printf '%s\n' "$old" | grep -Fxq -- "$name"; then
        stale="$stale $name"
      fi
    done
    if [ -n "$current" ] && [ -z "$stale" ]; then
      log "$app: replicas replaced ($(printf '%s' "$current" | tr '\n' ' '))"
      return 0
    fi
    if [ $((SECONDS - issued_at)) -ge "$settle_s" ]; then
      log "$app: the replica names did not change within ${settle_s}s (current: ${current:-none}); assuming an in-place restart and going on with the health conditions"
      return 0
    fi
    sleep "$poll_s"
  done
}

declare -A latest old_replicas restart_rc
failed=0
api_list_rc=0

# ---- what the apps look like BEFORE (the old replica names), then every restart back to back --------------------------
for app in "${apps[@]}"; do
  latest[$app]="$(app_value "$app" 'properties.latestRevisionName')"
  is_null_value "${latest[$app]}" && die "$app has no latest revision in $rg (is it deployed? alerts exists only for a real image)"
  if [ "$app" = "api" ]; then
    # the api's list decides whether it is restarted at all, so its az status is kept
    old_replicas[$app]="$(replica_names "$app" "${latest[$app]}")" || api_list_rc=$?
  else
    old_replicas[$app]="$(replica_names "$app" "${latest[$app]}" || true)"
  fi
done

# The api's scale floor decides how its absence is read (see the header): with minReplicas 0 a missing replica is normal.
api_min="$(app_value api 'properties.template.scale.minReplicas')"
[[ "$api_min" =~ ^[0-9]+$ ]] || die "cannot read the minReplicas of the api in $rg (got '${api_min:-nothing}'): it decides whether a missing api replica is normal"
api_min_zero=false
[ "$api_min" -eq 0 ] && api_min_zero=true

# What to do with the api:
#   minReplicas 0, list ok and empty    skip it: nothing to restart, it reads its secrets at its next cold start
#   minReplicas 0, list ok and a name   restart it; a restart that fails because the replica is gone meanwhile is tolerated
#   minReplicas 0, list failed          state unknown: try the restart, tolerate it the same way
#   minReplicas >= 1                    always restart it, strictly; a failed list is an error, never "no replica"
to_restart=()
api_skipped=false
for app in "${apps[@]}"; do
  if [ "$app" != "api" ]; then
    to_restart+=("$app")
  elif [ "$api_list_rc" -ne 0 ]; then
    if [ "$api_min_zero" = true ]; then
      log "api: cannot list its replicas (az exit $api_list_rc); its state is unknown, so the restart is tried and a replica that is gone is tolerated"
      to_restart+=("$app")
    else
      die "api: cannot list its replicas (az exit $api_list_rc); with minReplicas $api_min it always has one, so a restart must not be skipped on a guess: run this script again"
    fi
  elif [ -z "${old_replicas[$app]}" ] && [ "$api_min_zero" = true ]; then
    api_skipped=true
    log "api: skipped, it has no replica (scaled to zero); it reads its secrets at its next cold start"
  else
    to_restart+=("$app")
  fi
done

restarted_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
for app in "${to_restart[@]}"; do
  log "restarting $app revision ${latest[$app]}"
  restart_rc[$app]=0
  az containerapp revision restart -n "$app" -g "$rg" --revision "${latest[$app]}" >/dev/null || restart_rc[$app]=$?
done
issued_at=$SECONDS

# A failed restart is looked at only now, after EVERY restart was issued (the others are not delayed by it). Only the api of
# a minReplicas-0 app may fail this way harmlessly, and only when it has no replica now: it scaled down between the list and
# the restart (300 s cooldown), so there is nothing left to restart. Anything else is a real failure.
still_restarting=()
for app in "${to_restart[@]}"; do
  if [ "${restart_rc[$app]}" -eq 0 ]; then
    still_restarting+=("$app")
  elif [ "$app" = "api" ] && [ "$api_min_zero" = true ]; then
    relist_rc=0
    now="$(replica_names api "${latest[api]}")" || relist_rc=$?
    if [ "$relist_rc" -eq 0 ] && [ -z "$now" ]; then
      api_skipped=true
      log "api: the restart failed and the api has no replica now (scaled to zero meanwhile); it reads its secrets at its next cold start"
    else
      die "api: the restart failed and the api still has a replica or its replicas cannot be listed (az exit ${restart_rc[$app]}); run this script again"
    fi
  else
    die "$app: the restart failed (az exit ${restart_rc[$app]}); run this script again"
  fi
done
to_restart=("${still_restarting[@]}")

# ---- only now wait: new replica names or the settle time, then the healthcheck conditions -------------------------------
for app in "${to_restart[@]}"; do
  wait_replicas_or_settle "$app" "${old_replicas[$app]}"
done

for app in "${apps[@]}"; do
  image="$(app_value "$app" 'properties.template.containers[0].image')"
  if is_null_value "$image"; then
    log "$app: cannot read its current image"
    failed=1
    continue
  fi
  gate_args=(--app "$app" --rg "$rg" --image "$image" --timeout "$timeout_s")
  if [ "$app" = "alerts" ]; then
    gate_args+=(--no-ingress)
  fi
  if [ "$app" = "api" ] && [ "$api_min_zero" = true ]; then
    gate_args+=(--allow-zero-replicas)
  fi
  bash "$scripts_dir/healthcheck.sh" "${gate_args[@]}" || failed=1
done

if [ "$failed" -ne 0 ]; then
  printf 'FAILED: the restart did not complete cleanly; check the lines above, then run this script again (it restarts every app).\n'
  exit 1
fi

printf 'Apps restarted.\n'
printf '  restart issued at:     %s (UTC)\n' "$restarted_at"
printf '  restarted:             %s\n' "${to_restart[*]}"
if [ "$api_skipped" = true ]; then
  printf '  skipped:               api (scaled to zero: it reads its secrets at its next cold start)\n'
fi
printf '  Running replicas have now read the current secret values.\n'
