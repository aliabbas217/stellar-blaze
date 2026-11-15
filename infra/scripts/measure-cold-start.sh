#!/usr/bin/env bash
# Measure the cold start of the demo from scale-to-zero: ALI-RUN, OFF-HOURS, never during the judging window.
#
#   measure-cold-start.sh <resource-group> [<path>] [--i-know]
#
# In cheap mode the api ALREADY scales to zero (API_MIN_REPLICAS=0, the default of infra/bicep/main.bicep), so nothing is scaled
# here and nothing needs restoring: this script changes no setting of the deployment at all. The api is private, so the
# measurement is the visitor's path: the request goes to the public web URL and the web BFF calls the api. Steps:
#   1. refuse between 2026-11-20 and 2026-12-11 inclusive (the judging window) unless --i-know is given;
#   2. require the api to be allowed to scale to zero (minReplicas 0); with 1 it never does, and the script says so and stops;
#   3. wait until `az containerapp replica list` of the api is empty (at most COLD_TIMEOUT_S, default 1200: the scale-down
#      cooldown is 300 s after the last request, and the alerts worker does not call the api);
#   4. time the first request: curl -o /dev/null -w '%{time_total}' https://<web fqdn><path> (default /api/v1/health/ready).
#      The web BFF gives up on the api after 10 s (frontend UPSTREAM_TIMEOUT_MS) and answers with an error, so when the cold
#      start takes longer than that the first call is NOT a 200: the script then asks again every COLD_POLL_S seconds, for at
#      most COLD_RETRY_S (default 300), and reports both the first call's status and the time to the first 200. That is what
#      a visitor would see: an error first, then the page. The number is only a cold start if a 200 comes at the end;
#   5. print the seconds and a note.
# The note: scaling the api to zero and back restarts it, which does NOT touch the replay clock: the clock counts from the demo
# epoch row in Postgres (ADR 0034 amendment, backend/README.md "Alerts and the demo replay clock"), which the api and the
# alerts worker both read, so nothing needs restarting afterwards. (That holds for a backend that has the epoch clock.)
#
# Environment: COLD_POLL_S (default 15; also the wait between retries when the first call is not a 200), COLD_TIMEOUT_S (default
# 1200), COLD_RETRY_S (default 300), COLD_START_TODAY (YYYY-MM-DD, for the self-tests).

set -euo pipefail

scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$scripts_dir/lib.sh"

window_start="2026-11-20"
window_end="2026-12-11"
poll_s="${COLD_POLL_S:-15}"
timeout_s="${COLD_TIMEOUT_S:-1200}"
retry_s="${COLD_RETRY_S:-300}"

usage() {
  printf 'usage: measure-cold-start.sh <resource-group> [<path>] [--i-know]\n' >&2
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
[ "${#positional[@]}" -ge 1 ] && [ "${#positional[@]}" -le 2 ] || usage
rg="${positional[0]}"
path="${positional[1]:-/api/v1/health/ready}"

case "$path" in
  /*) ;;
  *) die "<path> must start with /, got '$path'" ;;
esac
[[ "$poll_s" =~ ^[0-9]+$ && "$timeout_s" =~ ^[0-9]+$ && "$retry_s" =~ ^[0-9]+$ ]] || die "COLD_POLL_S, COLD_TIMEOUT_S and COLD_RETRY_S must be whole numbers"

# ---- the judging window -------------------------------------------------------------------------------------------------

today="${COLD_START_TODAY:-$(date +%Y-%m-%d)}"
[[ "$today" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "COLD_START_TODAY must be YYYY-MM-DD, got '$today'"
if [[ ! "$today" < "$window_start" && ! "$today" > "$window_end" ]]; then
  if [ "$i_know" != true ]; then
    die "refusing to measure a cold start on $today: it is inside the judging window ($window_start to $window_end) and the wait for the api to scale down would leave the demo cold for a visitor. Run it outside the window, or pass --i-know."
  fi
  log "WARNING: $today is inside the judging window ($window_start to $window_end); continuing because of --i-know"
fi

# ---- the api must be allowed to scale to zero ---------------------------------------------------------------------------

web_fqdn="$(az_tsv containerapp show -n web -g "$rg" --query 'properties.configuration.ingress.fqdn' || true)"
if is_null_value "$web_fqdn"; then
  die "web has no public FQDN in $rg (is the deployment complete?)"
fi

scale="$(az_tsv containerapp show -n api -g "$rg" --query '[properties.template.scale.minReplicas, properties.template.scale.maxReplicas]' || true)"
min_r=""
{ read -r min_r || true; } <<<"$scale"
if [ "$min_r" != "0" ]; then
  die "the api has minReplicas '${min_r:-unreadable}', so it never scales to zero and there is no cold start to measure. Deploy with API_MIN_REPLICAS=0 (the cheap default) first."
fi

# ---- wait for the api to be gone ----------------------------------------------------------------------------------------

began="$SECONDS"
while true; do
  replicas="$(az_tsv containerapp replica list -n api -g "$rg" --query '[].name' || true)"
  if [ -z "$replicas" ]; then
    log "api has no replica"
    break
  fi
  if [ $((SECONDS - began)) -ge "$timeout_s" ]; then
    die "api still has replica(s) after ${timeout_s}s: $(printf '%s' "$replicas" | tr '\n' ' ')"
  fi
  sleep "$poll_s"
done

# ---- the measurement ----------------------------------------------------------------------------------------------------

url="https://$web_fqdn$path"
measured="$(curl -sS --max-time 180 -o /dev/null -w '%{http_code} %{time_total}' "$url" 2>/dev/null)" || measured="000 0"
code="${measured%% *}"
seconds="${measured#* }"
note=""
if [ "$code" != "200" ]; then
  # The BFF answered an error (or nothing) while the api was still starting: keep asking, and time until the first 200.
  first_code="$code"
  first_seconds="$seconds"
  log "the first call answered $first_code after ${first_seconds}s (the web BFF cuts its call to the api after 10 s); asking again every ${poll_s}s for up to ${retry_s}s"
  start_s="${EPOCHREALTIME:-$SECONDS}"
  retry_began="$SECONDS"
  tries=1
  while [ "$code" != "200" ]; do
    if [ $((SECONDS - retry_began)) -ge "$retry_s" ]; then
      die "$url answered $code after the first call's $first_code and ${retry_s}s of retries: not a successful cold start, so not a measurement"
    fi
    sleep "$poll_s"
    tries=$((tries + 1))
    measured="$(curl -sS --max-time 180 -o /dev/null -w '%{http_code} %{time_total}' "$url" 2>/dev/null)" || measured="000 0"
    code="${measured%% *}"
  done
  end_s="${EPOCHREALTIME:-$SECONDS}"
  seconds="$(awk -v a="$start_s" -v b="$end_s" -v f="$first_seconds" 'BEGIN { printf "%.1f", (b - a) + f }')"
  note=" after $tries calls (the first answered $first_code after ${first_seconds}s)"
fi

printf 'COLD START: %s s to first 200 from %s%s (api scaled to zero)\n' "$seconds" "$url" "$note"
printf '\nThe api restarted from zero. The replay clock counts from the demo epoch in the database, so it is unchanged and nothing needs restarting.\n'
printf 'Nothing was scaled or changed: the api scales itself down again after its cooldown.\n'
