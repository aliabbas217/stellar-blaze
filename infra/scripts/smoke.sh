#!/usr/bin/env bash
# Post-deploy smoke test of the Azure deployment. Prints `PASS|FAIL|SKIP S<n> <subject>`, exits 1 on any FAIL.
#
#   smoke.sh <resource-group> [--placeholder] [--expect-location uaenorth] [--no-wait] [--api-min 0|1]
#
# The api has INTERNAL ingress (architect ruling 2026-11-15), so nothing here calls it over HTTP: it is gated on its own
# revision state (healthcheck.sh) and exercised through the web BFF, which is also the path a visitor takes. In cheap mode the
# api scales to zero (API_MIN_REPLICAS=0, the default), so the first request meets a cold start: smoke-http.sh waits for it.
#   S1  the environment's workload profiles are exactly Consumption, and the group has no private endpoint (cost guard:
#       a Dedicated profile or a private endpoint adds a USD 0.10/h meter)
#   S2  replicas: web and alerts are min 1 / max 1, the api is min <--api-min> (default 0, the deploy passes its
#       API_MIN_REPLICAS) / max 1 (api and web only with --placeholder)
#   S3  the PUBLIC web: /api/healthz is 200 with "status":"ok" and /api/v1/health/ready THROUGH the web is 200 (the H1 and H2
#       lines of smoke-http.sh). With --placeholder: https://<web fqdn>/ is 200.
#   S4  the api is NOT public: ingress.external is false for api and true for web, and alerts has no ingress
#   S5  the alerts worker: running, image matches its template, at least one replica (healthcheck.sh --no-ingress)
#   S6  every resource in the group is in the expected region (a display name such as "UAE North" matches uaenorth)
#   S7  plain http://<web fqdn>/ does not answer 200 (a redirect or a refusal passes)
#   S8  check-db-tls.sh --deployed passes (ADR 0042)
#   S9  the rest of smoke-http.sh (H3 stop and undo, H4 demo-window check of the epoch replay clock (its failure says to run
#       reset-demo.sh), H5, H7 forged bearer, H6 forged X-Forwarded-For)
# With --placeholder only S1, S2 (api, web), S6, S7 and S3 (the `/` check) run; S4, S5, S8 and S9 print SKIP.
# smoke-http.sh runs last: its H6 drains the BFF rate-limit bucket, and unless --no-wait the script waits 62 s for it to refill.
#
# Environment: SMOKE_HTTP_SCRIPT (default smoke-http.sh next to this file; the self-tests replace it), SMOKE_S5_TIMEOUT
# (default 120 s) and HEALTH_POLL_S (healthcheck.sh).

set -euo pipefail

scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$scripts_dir/lib.sh"

usage() {
  printf 'usage: smoke.sh <resource-group> [--placeholder] [--expect-location uaenorth] [--no-wait] [--api-min 0|1]\n' >&2
  exit 1
}

rg=""
placeholder=false
expect_location="uaenorth"
wait_flag="--wait"
api_min="0"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --placeholder)
      placeholder=true
      shift
      ;;
    --no-wait)
      wait_flag=""
      shift
      ;;
    --expect-location)
      [ "$#" -ge 2 ] || usage
      expect_location="$2"
      shift 2
      ;;
    --api-min)
      [ "$#" -ge 2 ] || usage
      api_min="$2"
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
case "$api_min" in
  0 | 1) ;;
  *) die "--api-min must be 0 or 1, got '$api_min'" ;;
esac

http_script="${SMOKE_HTTP_SCRIPT:-$scripts_dir/smoke-http.sh}"
s5_timeout="${SMOKE_S5_TIMEOUT:-120}"
failed=0

# result <PASS|FAIL|SKIP> <id> <subject>
result() {
  printf '%s %s %s\n' "$1" "$2" "$3"
  if [ "$1" = "FAIL" ]; then
    failed=1
  fi
}

# app_values <app> <query>: the az tsv lines of one query on the app, one per line (empty on any error).
app_values() {
  az_tsv containerapp show -n "$1" -g "$rg" --query "$2" || true
}

# http_status <url>: the status code curl reports, 000 when the request failed. No redirect is followed.
http_status() {
  local code
  code="$(curl -sS --max-time 20 --max-redirs 0 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)" || true
  printf '%s' "${code:-000}"
}

apps=(api web)
if [ "$placeholder" = false ]; then
  apps+=(alerts)
fi

# ---- S1 -----------------------------------------------------------------------------------------------------------------
env_name="$(az_tsv containerapp env list -g "$rg" --query '[0].name' || true)"
if is_null_value "$env_name"; then
  result FAIL S1 "no Container Apps environment found in $rg"
else
  profile_names="$(az_tsv containerapp env show -n "$env_name" -g "$rg" --query 'properties.workloadProfiles[].name' || true)"
  profile_types="$(az_tsv containerapp env show -n "$env_name" -g "$rg" --query 'properties.workloadProfiles[].workloadProfileType' || true)"
  endpoints="$(az_tsv network private-endpoint list -g "$rg" --query '[].name' || true)"
  # one value per line -> "a,b,c"
  profile_names="${profile_names//$'\n'/,}"
  profile_types="${profile_types//$'\n'/,}"
  endpoints="${endpoints//$'\n'/,}"
  if [ "$profile_names" != "Consumption" ] || [ "$profile_types" != "Consumption" ]; then
    result FAIL S1 "environment $env_name workload profiles are [${profile_names:-none}] of type [${profile_types:-none}], expected exactly Consumption (a Dedicated profile is billed while idle)"
  elif [ -n "$endpoints" ]; then
    result FAIL S1 "the group has private endpoint(s): $endpoints (each adds a USD 0.10/h meter)"
  else
    result PASS S1 "environment $env_name has only the Consumption profile and the group has no private endpoint"
  fi
fi

# ---- S2 -----------------------------------------------------------------------------------------------------------------
for app in "${apps[@]}"; do
  scale="$(app_values "$app" '[properties.template.scale.minReplicas, properties.template.scale.maxReplicas]')"
  min_r=""
  max_r=""
  { read -r min_r || true; read -r max_r || true; } <<<"$scale"
  want_min=1
  if [ "$app" = "api" ]; then
    want_min="$api_min"
  fi
  if [ "$min_r" = "$want_min" ] && [ "$max_r" = "1" ]; then
    result PASS S2 "$app scale is min $want_min / max 1"
  else
    result FAIL S2 "$app scale is min ${min_r:-?} / max ${max_r:-?}, expected $want_min / 1"
  fi
done

web_fqdn="$(app_values web 'properties.configuration.ingress.fqdn')"
if is_null_value "$web_fqdn"; then
  web_fqdn=""
fi

# ---- S3 (placeholder form) ----------------------------------------------------------------------------------------------
if [ "$placeholder" = true ]; then
  if [ -z "$web_fqdn" ]; then
    result FAIL S3 "web has no public FQDN"
  else
    code="$(http_status "https://$web_fqdn/")"
    if [ "$code" = "200" ]; then
      result PASS S3 "placeholder web: https://$web_fqdn/ is 200"
    else
      result FAIL S3 "placeholder web: https://$web_fqdn/ answered $code, expected 200"
    fi
  fi
fi

# ---- S4 -----------------------------------------------------------------------------------------------------------------
if [ "$placeholder" = true ]; then
  result SKIP S4 "placeholder"
else
  for app in api web alerts; do
    external="$(app_values "$app" 'properties.configuration.ingress.external')"
    external="${external,,}"
    case "$app" in
      api)
        if [ "$external" = "false" ]; then
          result PASS S4 "api ingress is internal (not public)"
        else
          result FAIL S4 "api ingress.external is '${external:-unreadable}', expected false: the api must not be public"
        fi
        ;;
      web)
        if [ "$external" = "true" ]; then
          result PASS S4 "web ingress is external"
        else
          result FAIL S4 "web ingress.external is '${external:-unreadable}', expected true"
        fi
        ;;
      alerts)
        if is_null_value "$external"; then
          result PASS S4 "alerts has no ingress"
        else
          result FAIL S4 "alerts has an ingress (external=$external), expected none"
        fi
        ;;
      *) ;;
    esac
  done
fi

# ---- S5 -----------------------------------------------------------------------------------------------------------------
if [ "$placeholder" = true ]; then
  result SKIP S5 "placeholder"
else
  alerts_image="$(app_values alerts 'properties.template.containers[0].image')"
  if is_null_value "$alerts_image"; then
    result FAIL S5 "alerts: cannot read its current image"
  elif gate="$(bash "$scripts_dir/healthcheck.sh" --app alerts --rg "$rg" --image "$alerts_image" --no-ingress --timeout "$s5_timeout" 2>&1)"; then
    result PASS S5 "alerts worker is running its template image with at least one healthy replica"
  else
    result FAIL S5 "alerts worker is not running as expected"
    printf '%s\n' "$gate" | tail -n 6 | sed 's/^/     /'
  fi
fi

# ---- S6 -----------------------------------------------------------------------------------------------------------------
want_norm="${expect_location// /}"
want_norm="${want_norm,,}"
resources="$(az_tsv resource list -g "$rg" --query '[].[name, location]' || true)"
if [ -z "$resources" ]; then
  result FAIL S6 "no resource listed in $rg: cannot confirm the region"
else
  total=0
  misplaced=""
  while IFS=$'\t' read -r res_name res_location; do
    [ -n "$res_name" ] || continue
    total=$((total + 1))
    loc_norm="${res_location// /}"
    loc_norm="${loc_norm,,}"
    if [ "$loc_norm" != "$want_norm" ]; then
      misplaced="$misplaced $res_name($res_location)"
    fi
  done <<<"$resources"
  if [ -z "$misplaced" ]; then
    result PASS S6 "all $total resources are in $expect_location"
  else
    result FAIL S6 "resources outside $expect_location:$misplaced"
  fi
fi

# ---- S7 -----------------------------------------------------------------------------------------------------------------
if [ -z "$web_fqdn" ]; then
  result FAIL S7 "web has no public FQDN"
else
  code="$(http_status "http://$web_fqdn/")"
  if [ "$code" = "200" ]; then
    result FAIL S7 "http://$web_fqdn/ answered 200 over plain http; it must redirect or refuse"
  else
    result PASS S7 "plain http is not served: http://$web_fqdn/ answered $code"
  fi
fi

# ---- S8 -----------------------------------------------------------------------------------------------------------------
if [ "$placeholder" = true ]; then
  result SKIP S8 "placeholder"
elif tls="$(bash "$scripts_dir/check-db-tls.sh" --deployed "$rg" 2>&1)"; then
  result PASS S8 "check-db-tls.sh --deployed: the stored database URLs verify the server (ADR 0042)"
else
  result FAIL S8 "check-db-tls.sh --deployed failed"
  printf '%s\n' "$tls" | grep -E '^FAIL' | sed 's/^/     /' || true
fi

# ---- S9 (and the web half of S3): smoke-http.sh, last --------------------------------------------------------------------
if [ "$placeholder" = true ]; then
  result SKIP S9 "placeholder"
elif [ -z "$web_fqdn" ]; then
  result FAIL S3 "web has no public FQDN"
  result FAIL S9 "web has no public FQDN"
else
  printf 'NOTE running smoke-http.sh against https://%s (about 2 minutes with the rate-limit wait)\n' "$web_fqdn"
  http_rc=0
  http_tmp="$(mktemp)"
  # shellcheck disable=SC2086  # $wait_flag is empty or exactly --wait
  bash "$http_script" "https://$web_fqdn" $wait_flag >"$http_tmp" 2>&1 || http_rc=$?
  http_out="$(cat "$http_tmp")"
  rm -f -- "$http_tmp"
  seen=0
  http_fails=0
  while IFS= read -r line; do
    if [[ "$line" =~ ^(PASS|FAIL|SKIP)\ (H[0-9]+)\ (.*)$ ]]; then
      seen=$((seen + 1))
      case "${BASH_REMATCH[2]}" in
        H1 | H2) group="S3" ;;
        *) group="S9" ;;
      esac
      result "${BASH_REMATCH[1]}" "$group" "${BASH_REMATCH[2]} ${BASH_REMATCH[3]}"
      if [ "${BASH_REMATCH[1]}" = "FAIL" ]; then
        http_fails=$((http_fails + 1))
      fi
    elif [[ "$line" =~ ^(SMOKE\ OK|SMOKE\ FAILED) ]]; then
      :
    elif [ -n "$line" ]; then
      printf '     %s\n' "$line"
    fi
  done <<<"$http_out"
  if [ "$seen" -eq 0 ]; then
    result FAIL S9 "smoke-http.sh printed no check lines (exit $http_rc)"
  elif [ "$http_rc" -ne 0 ] && [ "$http_fails" -eq 0 ]; then
    result FAIL S9 "smoke-http.sh exited $http_rc without a FAIL line"
  fi
fi

if [ "$failed" -ne 0 ]; then
  printf 'SMOKE FAILED\n'
  exit 1
fi
printf 'SMOKE OK\n'
