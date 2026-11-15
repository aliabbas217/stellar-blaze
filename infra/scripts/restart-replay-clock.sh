#!/usr/bin/env bash
# Restart the replay clock of the demo: run before every judged session (the clock walks through the replay day in about
# 8 hours, and leaves the 10:00-17:30 demo window about 7 h 20 min after a start).
#
#   restart-replay-clock.sh <resource-group> [--now <ISO 8601 date-time with offset>] [--timeout 300]
#
# In replay mode the api and the alerts worker each start their clock at SB_REPLAY_NOW when THEY start and run at real
# speed from there, so the two must restart TOGETHER or their clocks differ. This script touches only those two apps:
#   without --now  restarts the latest revision of api and of alerts back to back (`az containerapp revision restart`;
#                  both are issued before either is waited for), then waits until each has NEW replicas;
#   with --now     sets SB_REPLAY_NOW on both (`az containerapp update --set-env-vars`, which creates a new revision of each:
#                  both restart) and checks the revisions carry it.
# Then it waits for each app with the revision conditions of healthcheck.sh (latest revision ready, image unchanged, running,
# healthy, a replica). --now is validated (a real ISO 8601 date-time WITH an offset: Z or +hh:mm) before anything changes.
# Nothing else is modified: no image, no secret, no scale. The next Bicep deploy resets SB_REPLAY_NOW to the template value.
#
# Environment: HEALTH_POLL_S (default 10; also the poll of the replica wait).

set -euo pipefail

scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$scripts_dir/lib.sh"

usage() {
  printf 'usage: restart-replay-clock.sh <resource-group> [--now <ISO 8601 date-time with offset, e.g. 2026-06-14T10:10:00+04:00>] [--timeout 300]\n' >&2
  exit 1
}

rg=""
now_iso=""
timeout_s=300
poll_s="${HEALTH_POLL_S:-10}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --now)
      [ "$#" -ge 2 ] || usage
      now_iso="$2"
      shift 2
      ;;
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
if [ -n "$now_iso" ]; then
  is_iso8601_offset_datetime "$now_iso" || die "--now must be an ISO 8601 date-time WITH an offset (Z or +hh:mm), e.g. 2026-06-14T10:10:00+04:00; got '$now_iso'. Nothing was changed."
fi

apps=(api alerts)

# app_value <app> <query>: one az value, empty on error.
app_value() {
  az_tsv containerapp show -n "$1" -g "$rg" --query "$2" || true
}

# replica_names <app> <revision>: the replica names of the revision, one per line.
replica_names() {
  az_tsv containerapp replica list -n "$1" -g "$rg" --revision "$2" --query '[].name' || true
}

# wait_new_replicas <app> <revision> <old names>: wait until the revision has replicas and none of the old ones is left.
wait_new_replicas() {
  local app="$1" revision="$2" old="$3" began="$SECONDS" current name stale
  while true; do
    current="$(replica_names "$app" "$revision")"
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
    if [ $((SECONDS - began)) -ge "$timeout_s" ]; then
      log "$app: replicas were not replaced within ${timeout_s}s (current: ${current:-none}, old still present:${stale:- none})"
      return 1
    fi
    sleep "$poll_s"
  done
}

declare -A latest old_replicas
failed=0

if [ -z "$now_iso" ]; then
  for app in "${apps[@]}"; do
    latest[$app]="$(app_value "$app" 'properties.latestRevisionName')"
    is_null_value "${latest[$app]}" && die "$app has no latest revision in $rg (is it deployed? alerts exists only for a real image)"
    old_replicas[$app]="$(replica_names "$app" "${latest[$app]}")"
  done
  restarted_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # Back to back: both are issued before either is waited for.
  for app in "${apps[@]}"; do
    log "restarting $app revision ${latest[$app]}"
    az containerapp revision restart -n "$app" -g "$rg" --revision "${latest[$app]}" >/dev/null
  done
  for app in "${apps[@]}"; do
    wait_new_replicas "$app" "${latest[$app]}" "${old_replicas[$app]}" || failed=1
  done
else
  restarted_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for app in "${apps[@]}"; do
    log "setting SB_REPLAY_NOW=$now_iso on $app (a new revision, so it restarts)"
    az containerapp update -n "$app" -g "$rg" --set-env-vars "SB_REPLAY_NOW=$now_iso" >/dev/null
  done
fi

# ---- wait with the healthcheck conditions, then verify the anchor ------------------------------------------------------
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
  bash "$scripts_dir/healthcheck.sh" "${gate_args[@]}" || failed=1
done

anchors=""
for app in "${apps[@]}"; do
  value="$(app_value "$app" "properties.template.containers[0].env[?name=='SB_REPLAY_NOW'].value | [0]")"
  anchors="$anchors $app=${value:-<unset>}"
  if [ -n "$now_iso" ] && [ "$value" != "$now_iso" ]; then
    log "$app: SB_REPLAY_NOW is '${value:-<unset>}', expected '$now_iso'"
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  printf 'FAILED: the replay clock restart did not complete cleanly; check the lines above, then run this script again (it restarts both apps).\n'
  exit 1
fi

printf 'Replay clock restarted.\n'
printf '  anchor (SB_REPLAY_NOW):%s\n' "$anchors"
printf '  restart issued at:     %s (UTC)\n' "$restarted_at"
printf '  Each process runs its replay clock from the moment it started, so restarting only ONE of api and alerts desynchronises their clocks: always restart both (this script does).\n'
printf '  The next Bicep deploy resets SB_REPLAY_NOW to the template value (the replayNow parameter of infra/bicep/main.bicep).\n'
