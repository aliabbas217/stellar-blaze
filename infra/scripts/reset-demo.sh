#!/usr/bin/env bash
# Reset the demo: start a NEW epoch of the synthetic demo site through the PUBLIC web URL, which re-anchors the replay clock.
#
#   reset-demo.sh <web-url> [--retry-after-once]
#
# Run it after every deploy (the replay clock counts from the epoch start, which the first `site load` wrote) and before each
# judged session: the demo window is about 7 h 20 min per epoch (replay time passes 17:30 Dubai), and smoke-http.sh H4 fails
# once it is over. Stops, sign-offs, alert events and push subscriptions belong to an epoch, so a reset also drops the push
# subscriptions: do not reset between a judge's sign-up for push and the push they expect.
#
# It POSTs <web-url>/api/v1/sites/site-demo-mussafah/demo-reset with NO Authorization header: the web BFF allow-lists the route
# and injects the demo employer token itself (ADR 0062), so no secret is needed here and none can leak from here. Needs only
# bash, curl, sed and grep (no jq).
#
# Output: one line, `PASS D1 demo reset: epoch <previous_epoch_id> -> <epoch_id>` or `FAIL D1 demo reset: <why>`. Exit 0 on
# PASS, 1 on FAIL, 2 on a usage error. FAIL covers: a status that is not 2xx (the status and the first 200 characters of the
# body are printed; 409 `not-a-demo-site` means the site is not synthetic), no answer at all, and a 2xx whose body does not
# carry numeric `epoch_id` and `previous_epoch_id`.
#
# RATE LIMITS: upstream allows 1 reset per 60 s and 10 per hour, and the BFF's general bucket also counts it (smoke-http.sh H6
# drains that bucket for about 61 s). A 429 prints its Retry-After. With --retry-after-once the script waits that long
# (capped at RESET_MAX_WAIT_S, default 70; a missing or non-numeric Retry-After counts as 61) and retries ONCE; a second 429
# is a FAIL. Without the flag it never retries: a reset changes state, so it is not repeated unasked.
#
# Environment: RESET_MAX_WAIT_S (default 70; the self-tests use 0).
set -uo pipefail

usage() {
  printf 'usage: %s <web-url> [--retry-after-once]\n' "$(basename -- "$0")" >&2
  exit 2
}

base=""
retry_once=false
for arg in "$@"; do
  case "$arg" in
    --retry-after-once) retry_once=true ;;
    -h | --help) usage ;;
    -*) printf 'unknown option: %s\n' "$arg" >&2; usage ;;
    *)
      [ -z "$base" ] || usage
      base="$arg"
      ;;
  esac
done
[ -n "$base" ] || usage
case "$base" in
  http://* | https://*) ;;
  *) printf 'web-url must start with http:// or https://: %s\n' "$base" >&2; usage ;;
esac
base="${base%/}"
max_wait="${RESET_MAX_WAIT_S:-70}"
[[ "$max_wait" =~ ^[0-9]+$ ]] || { printf 'RESET_MAX_WAIT_S must be a whole number, got %s\n' "$max_wait" >&2; exit 2; }

command -v curl >/dev/null 2>&1 || { printf 'curl is required\n' >&2; exit 2; }

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

route="/api/v1/sites/site-demo-mussafah/demo-reset"
status=""
body=""

# post_reset: one POST, no Authorization header and no body of our own. Sets $status (000 when curl itself failed) and $body;
# the response headers are in $tmp/headers.
post_reset() {
  : >"$tmp/headers"
  : >"$tmp/body"
  status="$(curl -sS --max-time 30 -X POST -o "$tmp/body" -D "$tmp/headers" -w '%{http_code}' "$base$route" 2>"$tmp/err")" || status="000"
  body="$(cat "$tmp/body")"
}

# json_int <name> <text>: the first non-negative integer value of "name" in a JSON text (flat fields only).
json_int() {
  printf '%s' "$2" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" | head -n 1
}

# retry_after: the Retry-After header of the last response, empty when absent.
retry_after() {
  grep -i '^retry-after:' "$tmp/headers" | head -n 1 | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r'
}

fail() {
  printf 'FAIL D1 demo reset: %s\n' "$*"
  exit 1
}

post_reset
if [ "$status" = "429" ]; then
  after="$(retry_after)"
  printf 'NOTE demo-reset answered 429, Retry-After %s (upstream: 1 per 60 s and 10 per hour; the BFF general bucket counts it too)\n' "${after:-missing}"
  if [ "$retry_once" != true ]; then
    fail "answered 429 (Retry-After ${after:-missing}); run again after that, or pass --retry-after-once"
  fi
  [[ "$after" =~ ^[0-9]+$ ]] || after=61
  wait_s="$after"
  if [ "$wait_s" -gt "$max_wait" ]; then wait_s="$max_wait"; fi
  printf 'NOTE --retry-after-once: waiting %s s (Retry-After %s, cap %s), then retrying once\n' "$wait_s" "$after" "$max_wait"
  sleep "$wait_s"
  post_reset
  if [ "$status" = "429" ]; then
    fail "answered 429 again after the wait (Retry-After $(retry_after)); not retrying a second time"
  fi
fi

case "$status" in
  2[0-9][0-9]) ;;
  000) fail "no answer from $base$route: $(head -c 200 "$tmp/err")" ;;
  *) fail "answered $status: $(printf '%s' "$body" | head -c 200)" ;;
esac

epoch_id="$(json_int epoch_id "$body")"
previous_epoch_id="$(json_int previous_epoch_id "$body")"
if [ -z "$epoch_id" ] || [ -z "$previous_epoch_id" ]; then
  fail "answered $status but the body has no numeric epoch_id and previous_epoch_id: $(printf '%s' "$body" | head -c 200)"
fi
printf 'PASS D1 demo reset: epoch %s -> %s\n' "$previous_epoch_id" "$epoch_id"
