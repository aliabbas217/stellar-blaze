#!/usr/bin/env bash
# HTTP smoke test of a deployed Stellar Blaze demo, through the PUBLIC web URL only.
#
#   smoke-http.sh <base-url> [--wait] [--reset-on-h3-failure]
#
# It runs against the local production rehearsal (http://127.0.0.1:8080, infra/local/rehearse.sh) and against the real
# public URL (https://<web fqdn>), and needs only bash and curl (no jq, no python). The api is private in production, so
# the script never calls it directly: everything goes through the web app's BFF (`/api/v1/*` is proxied to the api and the
# BFF injects the demo employer token, ADR 0062), which is also what a visitor's browser does.
#
# Output: one `PASS|FAIL|SKIP H<n> <subject>` line per check. Exit 1 if any check FAILed, else 0. Checks run in the order
# H1 H2 H3 H4 H5 H7 H6 (H6 last, see below):
#   H1  GET /api/healthz is 200 with "status":"ok" and a "version" (printed). The web container is up.
#   H2  GET /api/v1/health/ready through the BFF is 200 with "status":"ok". Proves web to api, the api's database
#       connection (with whatever TLS the deployment demands) and a loaded runtime config.
#   H3  Stop and undo through the BFF with NO Authorization header of our own (the BFF injects the demo token):
#       POST /api/v1/crews/crew-b/stops {"reason_code":"other"} is 201 with an `id` and `started_at`; then
#       DELETE /api/v1/crews/crew-b/stops/<id> within 10 s is 204 (the undo window); then GET
#       /api/v1/crews/crew-b/timeline has no "crew_level":"red" (an undone stop leaves no trace in levels).
#       RECOVERY: when H3 fails AFTER the stop was created (the undo failed, took more than 10 s, or the timeline is red or
#       unreadable) the stop may still be active, and an active stop leaves crew-b Red until the end of the replay shift. The FAIL
#       output then says how to recover: POST /api/v1/sites/site-demo-mussafah/demo-reset through the web starts a new epoch, and
#       the stop belongs to the old one (ADR 0066; the BFF allow-list contains the route). The script performs that reset ONCE,
#       and only, when --reset-on-h3-failure is given (default off: a smoke test does not change state it was not asked to).
#   H4  The replay clock. `started_at` of the stop of H3 is the api's replay "now" (UTC). Dubai is UTC+4 all year (no
#       DST), so the clock is started_at + 4 h and must be between 10:00 and 17:30. DEMO-WINDOW ASSUMPTION: crew B's shift
#       is 06:00-18:00 with a midday break (11:10 is inside the break), the replay anchor is SB_REPLAY_NOW =
#       2026-06-14T10:10:00+04:00 and the clock is that anchor plus the real time since the start of the CURRENT EPOCH (the
#       `site_epoch` row in Postgres, which the api and the alerts worker both read: ADR 0034 amendment of 2026-11-15; a
#       restart of either does not move it). It leaves the window about 7 h 20 min after an epoch starts, and a demo reset
#       starts a new epoch. Outside the window a Stop no longer lands on a working hour and the demo is misleading: the
#       failure says to run `bash infra/scripts/reset-demo.sh <web-url>`. The date is not checked, only the time of day.
#   H5  Only for an https URL: http:// on the same host must not answer 200 (a redirect or a refusal passes). SKIP
#       otherwise.
#   H7  A forged `Authorization: Bearer x` on a route that is NOT on the BFF allow-list (POST /api/v1/crews/crew-z/stops)
#       is answered 401, 403 or 404, never 201: a visitor's own credentials neither reach the api nor stand in for the
#       demo token.
#   H6  Forged X-Forwarded-For: 30 sequential GET /api/v1/crews/crew-b/day-plan, request i carrying
#       `X-Forwarded-For: 203.0.113.<i>`. PASS iff a 429 with a Retry-After header appears at some request number <= 30.
#       The BFF's per-client limit is 20 per 61 s and its global one is 40, so a 429 before request 41 proves the limiter
#       keys on the entry the trusted proxy appended (rightmost, TRUSTED_PROXY_HOPS=1), not on the spoofable left one:
#       with the left entry every request would be a new client and only the global limit would stop request 41.
#       H6 RUNS LAST because it drains the demo's general rate-limit bucket: for the next 61 s day-plan reads, sign-offs
#       and data requests through the BFF answer 429. Stop work has its own reserve and is not affected. With --wait the
#       script sleeps 62 s before it exits, so that whatever runs next starts with a full bucket.
#
# Running the script repeatedly is allowed and leaves traces by design: every run records one stop and its undo (stop rows
# and `crew.stop_started` / `crew.stop_cleared` audit rows, which are append-only, ADR 0054) and eats one drained bucket.
# It changes no other state. It is not a load test.
set -uo pipefail

usage() {
  printf 'usage: %s <base-url> [--wait] [--reset-on-h3-failure]\n' "$(basename -- "$0")" >&2
  exit 2
}

base=""
wait_after=false
reset_on_h3_failure=false
for arg in "$@"; do
  case "$arg" in
    --wait) wait_after=true ;;
    --reset-on-h3-failure) reset_on_h3_failure=true ;;
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
  *) printf 'base-url must start with http:// or https://: %s\n' "$base" >&2; usage ;;
esac
base="${base%/}"

command -v curl >/dev/null 2>&1 || { printf 'curl is required\n' >&2; exit 2; }

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

failures=0
status=""
body=""

pass() { printf 'PASS %s %s\n' "$1" "$2"; }
skip() { printf 'SKIP %s %s\n' "$1" "$2"; }
fail() {
  printf 'FAIL %s %s\n' "$1" "$2"
  failures=$((failures + 1))
}
note() { printf '     %s\n' "$*"; }

# call <METHOD> <path> [curl args...]: sets $status (000 when curl itself failed) and $body; the response headers of
# the last call are in $tmp/headers. Each call is bounded in time; nothing here retries.
call() {
  local method="$1" path="$2"
  shift 2
  : >"$tmp/headers"
  : >"$tmp/body"
  status="$(curl -sS --max-time 20 -X "$method" -o "$tmp/body" -D "$tmp/headers" -w '%{http_code}' "$@" "$base$path" 2>"$tmp/err")" || status="000"
  body="$(cat "$tmp/body")"
}

# json_string <name> <text>: the first string value of "name" in a JSON text (no nesting awareness, which is enough for
# the flat fields read here).
json_string() {
  printf '%s' "$2" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

has_json_pair() { # <name> <value> <text>
  printf '%s' "$3" | grep -Eq "\"$1\"[[:space:]]*:[[:space:]]*\"$2\""
}

# --- H1 -------------------------------------------------------------------------------------------------------------
call GET /api/healthz
version="$(json_string version "$body")"
if [ "$status" = "200" ] && has_json_pair status ok "$body" && [ -n "$version" ]; then
  pass H1 "web is up: GET /api/healthz is 200, status ok, version $version"
else
  fail H1 "GET /api/healthz: expected 200 with status ok and a version, got $status: $(printf '%s' "$body" | head -c 200)"
fi

# --- H2 -------------------------------------------------------------------------------------------------------------
call GET /api/v1/health/ready
if [ "$status" = "200" ] && has_json_pair status ok "$body"; then
  pass H2 "web to api to database to config: GET /api/v1/health/ready through the BFF is 200, status ok"
else
  fail H2 "GET /api/v1/health/ready through the BFF: expected 200 with status ok, got $status: $(printf '%s' "$body" | head -c 200)"
fi

# --- H3 -------------------------------------------------------------------------------------------------------------
stop_id=""
started_at=""
call POST /api/v1/crews/crew-b/stops -H 'Content-Type: application/json' --data '{"reason_code":"other"}'
if [ "$status" = "201" ]; then
  stop_id="$(json_string id "$body")"
  started_at="$(json_string started_at "$body")"
fi
h3_ok=true
if [ -z "$stop_id" ] || [ -z "$started_at" ]; then
  h3_ok=false
  fail H3 "Stop through the BFF: POST /api/v1/crews/crew-b/stops expected 201 with an id and started_at, got $status: $(printf '%s' "$body" | head -c 200)"
else
  undo_began=$SECONDS
  call DELETE "/api/v1/crews/crew-b/stops/$stop_id"
  undo_status="$status"
  undo_elapsed=$((SECONDS - undo_began))
  if [ "$undo_status" != "204" ]; then
    h3_ok=false
    fail H3 "Undo: DELETE /api/v1/crews/crew-b/stops/$stop_id expected 204, got $undo_status"
  elif [ "$undo_elapsed" -gt 10 ]; then
    h3_ok=false
    fail H3 "Undo took ${undo_elapsed}s, outside the 10 s undo window; the leave-no-trace check below would be void"
  else
    call GET /api/v1/crews/crew-b/timeline
    if [ "$status" != "200" ]; then
      h3_ok=false
      fail H3 "GET /api/v1/crews/crew-b/timeline expected 200, got $status"
    elif printf '%s' "$body" | grep -Eq '"crew_level"[[:space:]]*:[[:space:]]*"red"'; then
      h3_ok=false
      fail H3 "an undone stop left a red hour in the timeline of crew-b"
    fi
  fi
  if [ "$h3_ok" = true ]; then
    pass H3 "stop $stop_id: 201, undone with 204 after ${undo_elapsed}s, and the crew-b timeline has no red hour"
  else
    # A stop was created and H3 failed after it: the stop may still be active, and an active stop leaves crew-b Red to the end
    # of the replay shift, which spoils the demo for whoever looks next.
    note "the stop $stop_id may still be active: an active stop leaves crew-b Red until the end of the replay shift (18:00)"
    note "recovery: POST /api/v1/sites/site-demo-mussafah/demo-reset through the web ($base) starts a new epoch, and the stop"
    note "belongs to the old one (ADR 0066; the BFF allow-list contains this route; limit 1 per 60 s and 10 per hour)"
    if [ "$reset_on_h3_failure" = true ]; then
      call POST /api/v1/sites/site-demo-mussafah/demo-reset
      if [ "$status" = "200" ]; then
        note "--reset-on-h3-failure: demo-reset done (200), crew-b is back to a clean epoch"
      else
        note "--reset-on-h3-failure: demo-reset FAILED with $status; do it by hand: curl -X POST $base/api/v1/sites/site-demo-mussafah/demo-reset"
      fi
    else
      note "this run did not reset anything; --reset-on-h3-failure performs that one reset after an H3 failure (default off)"
    fi
  fi
fi

# --- H4 -------------------------------------------------------------------------------------------------------------
if [ -z "$started_at" ]; then
  fail H4 "no stop was recorded, so the replay clock could not be read"
elif [[ "$started_at" =~ T([0-9]{2}):([0-9]{2}):[0-9]{2}(\.[0-9]+)?(Z|\+00:00)$ ]]; then
  # 10# forces base 10 (08 and 09 are not octal).
  minutes=$(((10#${BASH_REMATCH[1]} * 60 + 10#${BASH_REMATCH[2]} + 240) % 1440))
  clock="$(printf '%02d:%02d' $((minutes / 60)) $((minutes % 60)))"
  if [ "$minutes" -ge 600 ] && [ "$minutes" -le 1050 ]; then
    pass H4 "replay clock is inside the demo window: $clock Asia/Dubai (started_at $started_at)"
  else
    fail H4 "replay clock is outside the demo window: run: bash infra/scripts/reset-demo.sh <web-url>"
    note "the api's replay clock reads $clock Asia/Dubai (started_at $started_at); the window is 10:00 to 17:30"
    note "a demo reset starts a new epoch and so re-anchors the clock; here: bash infra/scripts/reset-demo.sh $base"
  fi
else
  fail H4 "started_at '$started_at' is not a UTC timestamp (Z or +00:00); cannot read the replay clock"
fi

# --- H5 -------------------------------------------------------------------------------------------------------------
case "$base" in
  https://*)
    plain="http://${base#https://}"
    plain_status="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$plain/api/healthz" 2>/dev/null)" || plain_status="000"
    if [ "$plain_status" = "200" ]; then
      fail H5 "$plain/api/healthz answered 200 over plain http; it must redirect or refuse"
    else
      pass H5 "plain http is not served: $plain/api/healthz answered $plain_status"
    fi
    ;;
  *) skip H5 "plain-http refusal needs an https URL (this one is $base)" ;;
esac

# --- H7 -------------------------------------------------------------------------------------------------------------
call POST /api/v1/crews/crew-z/stops -H 'Content-Type: application/json' -H 'Authorization: Bearer x' --data '{"reason_code":"other"}'
case "$status" in
  401 | 403 | 404) pass H7 "a forged Authorization header on a route off the allow-list is refused: $status" ;;
  *) fail H7 "POST /api/v1/crews/crew-z/stops with a forged bearer expected 401, 403 or 404, got $status" ;;
esac

# --- H6 (last) ------------------------------------------------------------------------------------------------------
printf 'NOTE H6 now drains the demo general rate-limit bucket for 61 s: day-plan reads, sign-offs and data requests answer 429 until then (Stop work is unaffected).\n'
first_429=""
retry_after=""
i=1
while [ "$i" -le 30 ]; do
  call GET /api/v1/crews/crew-b/day-plan -H "X-Forwarded-For: 203.0.113.$i"
  if [ "$status" = "429" ]; then
    first_429="$i"
    retry_after="$(grep -i '^retry-after:' "$tmp/headers" | head -n 1 | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r')"
    break
  fi
  i=$((i + 1))
done
if [ -n "$first_429" ] && [ -n "$retry_after" ]; then
  pass H6 "forged X-Forwarded-For does not evade the per-client limit: 429 with Retry-After $retry_after at request $first_429 of 30"
elif [ -n "$first_429" ]; then
  fail H6 "a 429 appeared at request $first_429 but without a Retry-After header"
else
  fail H6 "30 requests with 30 forged X-Forwarded-For values and no 429: the limiter keys on a spoofable entry (check TRUSTED_PROXY_HOPS and the proxy in front of web)"
fi

if [ "$wait_after" = true ]; then
  printf 'NOTE waiting 62 s for the rate-limit window to clear\n'
  sleep 62
fi

if [ "$failures" -gt 0 ]; then
  printf 'SMOKE FAILED: %s check(s) failed\n' "$failures"
  exit 1
fi
printf 'SMOKE OK\n'
