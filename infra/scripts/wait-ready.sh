#!/usr/bin/env bash
# Wait until the api answers THROUGH the public web URL: the cold-start wait of the cheap deployment.
#
#   wait-ready.sh <web-url> [--timeout 300]
#
# In cheap mode the api scales to zero (API_MIN_REPLICAS=0, infra/bicep/main.bicep), so the first request after the 300 s
# cooldown meets an api that is not running yet. The web BFF cuts its call to the api after 10 s (frontend
# src/app/api/v1/[...path]/route.ts UPSTREAM_TIMEOUT_MS) and answers with an error, so a single request with a long timeout
# does not wait for the cold start: this script asks again every WAIT_READY_POLL_S seconds (default 5) until
# GET <web-url>/api/v1/health/ready is 200 with "status":"ok", the answer that proves web to api to database to config.
# Each request is bounded by --max-time 20, so a hanging connection cannot outlast the poll.
#
# The first answer that is not ready prints `waiting for the api to start (cold start)`. Output ends with one line:
#   `PASS ready: ...` (exit 0) or `FAIL ready: ...` (exit 1, the last status and the last 200 bytes of the body).
# The result lines do not start with PASS/FAIL followed by H<n>, so smoke-http.sh and rehearse.sh can print them as notes.
# Needs only bash and curl. Exit 2 on a usage error.

set -uo pipefail

usage() {
  printf 'usage: %s <web-url> [--timeout 300]\n' "$(basename -- "$0")" >&2
  exit 2
}

base=""
timeout_s=300
while [ "$#" -gt 0 ]; do
  case "$1" in
    --timeout)
      [ "$#" -ge 2 ] || usage
      timeout_s="$2"
      shift 2
      ;;
    -h | --help) usage ;;
    -*)
      printf 'unknown option: %s\n' "$1" >&2
      usage
      ;;
    *)
      [ -z "$base" ] || usage
      base="$1"
      shift
      ;;
  esac
done
[ -n "$base" ] || usage
case "$base" in
  http://* | https://*) ;;
  *)
    printf 'web-url must start with http:// or https://: %s\n' "$base" >&2
    usage
    ;;
esac
base="${base%/}"
poll_s="${WAIT_READY_POLL_S:-5}"
[[ "$timeout_s" =~ ^[0-9]+$ ]] || {
  printf -- '--timeout must be a whole number of seconds, got %s\n' "$timeout_s" >&2
  exit 2
}
[[ "$poll_s" =~ ^[0-9]+$ ]] || {
  printf 'WAIT_READY_POLL_S must be a whole number, got %s\n' "$poll_s" >&2
  exit 2
}
command -v curl >/dev/null 2>&1 || {
  printf 'curl is required\n' >&2
  exit 2
}

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

began="$SECONDS"
announced=false
status="000"
while true; do
  : >"$tmp/body"
  status="$(curl -sS --max-time 20 -o "$tmp/body" -w '%{http_code}' "$base/api/v1/health/ready" 2>"$tmp/err")" || status="000"
  if [ "$status" = "200" ] && grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' "$tmp/body"; then
    printf 'PASS ready: the api answered through %s after %ss\n' "$base" "$((SECONDS - began))"
    exit 0
  fi
  if [ "$announced" = false ]; then
    printf 'waiting for the api to start (cold start)\n'
    announced=true
  fi
  if [ $((SECONDS - began)) -ge "$timeout_s" ]; then
    printf 'FAIL ready: GET %s/api/v1/health/ready answered %s %ss after the first try: %s\n' \
      "$base" "$status" "$((SECONDS - began))" "$(head -c 200 "$tmp/body" 2>/dev/null | tr '\r\n' '  ')"
    exit 1
  fi
  sleep "$poll_s"
done
