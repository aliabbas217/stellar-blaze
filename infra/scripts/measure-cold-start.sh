#!/usr/bin/env bash
# Measure the cold start of the demo from scale-to-zero: ALI-RUN, OFF-HOURS, never during the judging window.
#
#   measure-cold-start.sh <resource-group> [<path>] [<app>] [--i-know]
#
# The api is private, so the measurement is the visitor's path: the request goes to the public web URL and the web BFF
# calls the api. By default web AND api are scaled to zero (min replicas 0), so the time includes both cold starts;
# <app> (web or api) scales only that one. Steps:
#   1. refuse between 2026-11-20 and 2026-12-11 inclusive (the judging window) unless --i-know is given;
#   2. `az containerapp update --min-replicas 0` on the chosen apps;
#   3. wait until `az containerapp replica list` is empty for each (at most 20 minutes: Container Apps removes the replica
#      after its scale-down cooldown);
#   4. time one request: curl -o /dev/null -w '%{time_total}' https://<web fqdn><path> (default /api/v1/health/ready), which
#      must answer 200, otherwise the number is not a cold start and the script fails;
#   5. ALWAYS restore min replicas to 1 on every chosen app, in a trap (also on failure, Ctrl-C and termination);
#   6. print the seconds and a note.
# The note: scaling the api to zero and back restarts it, which does NOT touch the replay clock: the clock counts from the demo
# epoch row in Postgres (ADR 0034 amendment, backend/README.md "Alerts and the demo replay clock"), which the api and the
# alerts worker both read, so nothing needs restarting afterwards. (That holds for a backend that has the epoch clock.)
#
# Environment: COLD_POLL_S (default 15), COLD_TIMEOUT_S (default 1200), COLD_START_TODAY (YYYY-MM-DD, for the self-tests).

set -euo pipefail

scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$scripts_dir/lib.sh"

window_start="2026-11-20"
window_end="2026-12-11"
poll_s="${COLD_POLL_S:-15}"
timeout_s="${COLD_TIMEOUT_S:-1200}"

usage() {
  printf 'usage: measure-cold-start.sh <resource-group> [<path>] [<app: web|api>] [--i-know]\n' >&2
  exit 1
}

positional=()
i_know=false
for arg in "$@"; do
  case "$arg" in
    --i-know) i_know=true ;;
    -*) usage ;;
    *) positional+=("$arg") ;;
  esac
done
[ "${#positional[@]}" -ge 1 ] && [ "${#positional[@]}" -le 3 ] || usage
rg="${positional[0]}"
path="${positional[1]:-/api/v1/health/ready}"
only_app="${positional[2]:-}"

case "$path" in
  /*) ;;
  *) die "<path> must start with /, got '$path'" ;;
esac
case "$only_app" in
  "") apps=(web api) ;;
  web | api) apps=("$only_app") ;;
  *) die "<app> must be web or api (the alerts worker is never scaled), got '$only_app'" ;;
esac
[[ "$poll_s" =~ ^[0-9]+$ && "$timeout_s" =~ ^[0-9]+$ ]] || die "COLD_POLL_S and COLD_TIMEOUT_S must be whole numbers"

# ---- the judging window -------------------------------------------------------------------------------------------------

today="${COLD_START_TODAY:-$(date +%Y-%m-%d)}"
[[ "$today" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "COLD_START_TODAY must be YYYY-MM-DD, got '$today'"
if [[ ! "$today" < "$window_start" && ! "$today" > "$window_end" ]]; then
  if [ "$i_know" != true ]; then
    die "refusing to scale web and api to zero on $today: it is inside the judging window ($window_start to $window_end) and a visitor would hit a cold start. Run it outside the window, or pass --i-know."
  fi
  log "WARNING: $today is inside the judging window ($window_start to $window_end); continuing because of --i-know"
fi

# ---- scale to zero, always restore --------------------------------------------------------------------------------------

touched=()

restore() {
  local app rc=0
  trap - EXIT INT TERM
  for app in "${touched[@]}"; do
    log "restoring $app: min replicas 1"
    if ! az containerapp update -n "$app" -g "$rg" --min-replicas 1 >/dev/null; then
      log "ERROR: could not restore min replicas 1 on $app: run 'az containerapp update -n $app -g $rg --min-replicas 1' NOW"
      rc=1
    fi
  done
  return "$rc"
}

# shellcheck disable=SC2329  # invoked through the EXIT trap below
on_exit() {
  local status=$?
  restore || status=1
  exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

web_fqdn="$(az_tsv containerapp show -n web -g "$rg" --query 'properties.configuration.ingress.fqdn' || true)"
if is_null_value "$web_fqdn"; then
  die "web has no public FQDN in $rg (is the deployment complete?)"
fi

for app in "${apps[@]}"; do
  touched+=("$app") # before the call: a half-applied update is restored too
  log "scaling $app to zero (min replicas 0)"
  az containerapp update -n "$app" -g "$rg" --min-replicas 0 >/dev/null
done

for app in "${apps[@]}"; do
  began="$SECONDS"
  while true; do
    replicas="$(az_tsv containerapp replica list -n "$app" -g "$rg" --query '[].name' || true)"
    if [ -z "$replicas" ]; then
      log "$app has no replica"
      break
    fi
    if [ $((SECONDS - began)) -ge "$timeout_s" ]; then
      die "$app still has replica(s) after ${timeout_s}s: $(printf '%s' "$replicas" | tr '\n' ' ')"
    fi
    sleep "$poll_s"
  done
done

# ---- the measurement ----------------------------------------------------------------------------------------------------

measured="$(curl -sS --max-time 180 -o /dev/null -w '%{http_code} %{time_total}' "https://$web_fqdn$path")" || die "the request to https://$web_fqdn$path failed"
code="${measured%% *}"
seconds="${measured#* }"
[ "$code" = "200" ] || die "https://$web_fqdn$path answered $code after ${seconds}s: not a successful cold start, so not a measurement"

# Restore now (the trap stays as the safety net for every earlier exit), then report.
restore_rc=0
restore || restore_rc=$?
touched=()

printf 'COLD START: %s s to first 200 from https://%s%s (scaled to zero: %s)\n' "$seconds" "$web_fqdn" "$path" "${apps[*]}"
case " ${apps[*]} " in
  *" api "*)
    printf '\nThe api restarted. The replay clock counts from the demo epoch in the database, so it is unchanged and nothing needs restarting.\n'
    ;;
  *) printf '\nThe api was not scaled.\n' ;;
esac
exit "$restore_rc"
