#!/usr/bin/env bash
# Revision-aware health gate for one Container App, used after a deployment and after a restart.
#
#   healthcheck.sh --app <name> --rg <resource-group> --image <image> [--no-ingress]
#                  [--url <https url> [--expect-json-key K --expect-json-value V]] [--timeout 300]
#
# Single-revision mode keeps the PREVIOUS revision serving when a new one never becomes ready, so an HTTP 200 alone goes
# green on a failed rollout. The gate therefore reads the revision itself. Exit 0 only when ALL of these hold within the
# timeout (polled every HEALTH_POLL_S seconds, default 10; each failing condition is printed on every poll):
#   from `az containerapp show`:           latestRevisionName == latestReadyRevisionName
#   from `az containerapp revision show` of that revision:
#                                          template.containers[0].image == --image
#                                          provisioningState == Provisioned, runningState == Running
#                                          healthState == Healthy  (--no-ingress: Healthy, None or absent: a worker has no probes)
#                                          trafficWeight == 100    (skipped with --no-ingress)
#                                          replicas >= 1
#   with --url:                            `curl -fsS --max-time 10` answers 200 (and the JSON key/value when asked)
# --url is only ever the PUBLIC web URL (https): the api is private and is gated on its revision state alone.
# The JSON check is a plain string match on `"key": "value"` (no nesting, string values only).
#
# One az call returns each group of values as a list of scalars, which `-o tsv` prints one per line (a null prints as None).
# The `trap` removes the temporary files.

set -euo pipefail

scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$scripts_dir/lib.sh"

usage() {
  printf 'usage: healthcheck.sh --app <name> --rg <resource-group> --image <image> [--no-ingress] [--url <https url> [--expect-json-key K --expect-json-value V]] [--timeout 300]\n' >&2
  exit 1
}

app=""
rg=""
image=""
no_ingress=false
url=""
json_key=""
json_value=""
timeout_s=300
poll_s="${HEALTH_POLL_S:-10}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app | --rg | --image | --url | --expect-json-key | --expect-json-value | --timeout)
      [ "$#" -ge 2 ] || usage
      case "$1" in
        --app) app="$2" ;;
        --rg) rg="$2" ;;
        --image) image="$2" ;;
        --url) url="$2" ;;
        --expect-json-key) json_key="$2" ;;
        --expect-json-value) json_value="$2" ;;
        --timeout) timeout_s="$2" ;;
        *) usage ;;
      esac
      shift 2
      ;;
    --no-ingress)
      no_ingress=true
      shift
      ;;
    *) usage ;;
  esac
done

[ -n "$app" ] && [ -n "$rg" ] && [ -n "$image" ] || usage
[[ "$timeout_s" =~ ^[0-9]+$ ]] || die "--timeout must be a whole number of seconds, got '$timeout_s'"
[[ "$poll_s" =~ ^[0-9]+$ ]] || die "HEALTH_POLL_S must be a whole number, got '$poll_s'"
if [ -n "$url" ]; then
  case "$url" in
    https://*) ;;
    *) die "--url must be the public https URL of web, got '$url'" ;;
  esac
fi
if [ -n "$json_key$json_value" ]; then
  [ -n "$url" ] || die "--expect-json-key/--expect-json-value need --url"
  [ -n "$json_key" ] && [ -n "$json_value" ] || die "--expect-json-key and --expect-json-value go together"
  [[ "$json_key" =~ ^[A-Za-z0-9_.-]+$ ]] || die "--expect-json-key: letters, digits, _ . - only"
  [[ "$json_value" =~ ^[A-Za-z0-9_.:/-]+$ ]] || die "--expect-json-value: letters, digits, _ . : / - only"
fi

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

problems=()

# check_once: fill $problems with every condition that does not hold right now (empty = healthy).
check_once() {
  problems=()
  local raw latest ready rev_image provisioning running health traffic replicas
  local -a lines

  if ! raw="$(az_tsv containerapp show -n "$app" -g "$rg" --query '[properties.latestRevisionName, properties.latestReadyRevisionName]')"; then
    problems+=("cannot read app $app in $rg (az containerapp show failed)")
    return 0
  fi
  mapfile -t lines <<<"$raw"
  latest="${lines[0]:-}"
  ready="${lines[1]:-}"
  if is_null_value "$latest"; then
    problems+=("$app has no latest revision yet")
    return 0
  fi
  if [ "$latest" != "$ready" ]; then
    problems+=("latest revision $latest is not the latest ready revision (${ready:-<none>}): the previous revision may still be serving")
  fi

  if ! raw="$(az_tsv containerapp revision show -n "$app" -g "$rg" --revision "$latest" --query '[properties.template.containers[0].image, properties.provisioningState, properties.runningState, properties.healthState, properties.trafficWeight, properties.replicas]')"; then
    problems+=("cannot read revision $latest (az containerapp revision show failed)")
    return 0
  fi
  mapfile -t lines <<<"$raw"
  rev_image="${lines[0]:-}"
  provisioning="${lines[1]:-}"
  running="${lines[2]:-}"
  health="${lines[3]:-}"
  traffic="${lines[4]:-}"
  replicas="${lines[5]:-}"

  [ "$rev_image" = "$image" ] || problems+=("revision $latest runs image '$rev_image', expected '$image'")
  [ "$provisioning" = "Provisioned" ] || problems+=("revision $latest provisioningState is '$provisioning', expected Provisioned")
  [ "$running" = "Running" ] || problems+=("revision $latest runningState is '$running', expected Running")
  if [ "$no_ingress" = true ]; then
    if [ "$health" != "Healthy" ] && ! is_null_value "$health"; then
      problems+=("revision $latest healthState is '$health', expected Healthy (or None for a worker without probes)")
    fi
  else
    [ "$health" = "Healthy" ] || problems+=("revision $latest healthState is '$health', expected Healthy")
    [ "$traffic" = "100" ] || problems+=("revision $latest trafficWeight is '$traffic', expected 100")
  fi
  if ! [[ "$replicas" =~ ^[0-9]+$ ]] || [ "$replicas" -lt 1 ]; then
    problems+=("revision $latest has '$replicas' replicas, expected at least 1")
  fi

  if [ -n "$url" ]; then
    local status="" body
    status="$(curl -fsS --max-time 10 -o "$tmp/body" -w '%{http_code}' "$url" 2>"$tmp/curl.err")" || true
    if [ "$status" != "200" ]; then
      problems+=("GET $url answered '${status:-000}', expected 200 ($(head -n 1 "$tmp/curl.err" 2>/dev/null || true))")
    elif [ -n "$json_key" ]; then
      body="$(cat "$tmp/body")"
      if ! printf '%s' "$body" | grep -Eq "\"$json_key\"[[:space:]]*:[[:space:]]*\"$json_value\""; then
        problems+=("GET $url answered 200 but its JSON lacks \"$json_key\": \"$json_value\"")
      fi
    fi
  fi
  return 0
}

began="$SECONDS"
while true; do
  check_once
  elapsed=$((SECONDS - began))
  if [ "${#problems[@]}" -eq 0 ]; then
    printf 'PASS healthcheck %s: latest revision ready, image %s, healthy (after %ss)\n' "$app" "$image" "$elapsed"
    exit 0
  fi
  for problem in "${problems[@]}"; do
    printf 'WAIT %s (%ss): %s\n' "$app" "$elapsed" "$problem"
  done
  if [ "$elapsed" -ge "$timeout_s" ]; then
    printf 'FAIL healthcheck %s: not healthy within %ss\n' "$app" "$timeout_s"
    exit 1
  fi
  sleep "$poll_s"
done
