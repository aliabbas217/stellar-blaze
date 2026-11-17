#!/usr/bin/env bash
# Preflight checks before the Azure bootstrap (deployment research doc, section 10, checks 2 and 3).
#
#   preflight.sh [--location uaenorth]
#
# Prints one `PASS <check>` or `FAIL <check>` line per check and, when P2 passes, a final
# `POSTGRES_VERSION=<18|17>` line on stdout. Exit 0 only when every check passes.
#
#   P1  Microsoft.App managedEnvironments is available in the location
#   P2  PostgreSQL Flexible Server Standard_B1ms is offered in the location (and which major to use)
#   P3  the seven resource providers are Registered
#   P4  the signed-in user is Owner on the subscription
#
# CAUTION: this script has never run against real Azure output (no Azure account existed when it was
# written). P1, P3 and P4 use `--query` shapes taken from the CLI documentation; P2 deliberately does
# NOT parse the `list-skus` JSON (its shape could not be inspected offline) and greps the raw text.
# Run it once for real and tighten P2 to a JMESPath query if the output shows a stable shape.

set -euo pipefail

# Git Bash on Windows rewrites arguments that look like POSIX paths (/subscriptions/...) into
# C:/Program Files/Git/...; that would break the --scope argument below.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$here/lib.sh"

location="uaenorth"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --location)
      [ "$#" -ge 2 ] || die "--location needs a value"
      location="$2"
      shift 2
      ;;
    -h | --help)
      sed -n '2,10p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
done

# "UAE North" and "uaenorth" are the same region: lower-case, no spaces, no quotes, no CR.
normalize() {
  tr -d ' "\r' | tr '[:upper:]' '[:lower:]'
}

failures=0
pass() { printf 'PASS %s\n' "$1"; }
fail() {
  printf 'FAIL %s\n' "$1"
  failures=$((failures + 1))
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

want="$(printf '%s' "$location" | normalize)"

# --- P1: Container Apps environments are available in the location ------------------------------
p1="P1 Microsoft.App managedEnvironments in $location"
if az provider show -n Microsoft.App \
  --query "resourceTypes[?resourceType=='managedEnvironments'].locations | [0]" \
  -o json >"$tmp/p1.json" 2>"$tmp/p1.err"; then
  # One location per line, then an exact (whole-entry) match on the normalized name. The list goes
  # through a variable, not a pipe into `grep -q`, so pipefail cannot trip on SIGPIPE.
  p1_locations="$(tr -d '\r' <"$tmp/p1.json" | tr ',' '\n' | normalize | tr -d '[]')"
  if grep -Fxq -- "$want" <<<"$p1_locations"; then
    pass "$p1"
  else
    fail "$p1"
    log "P1: '$location' is not in the managedEnvironments location list; try another region (fallback ladder)"
  fi
else
  fail "$p1"
  log "P1: az provider show failed: $(tr -d '\r' <"$tmp/p1.err" | head -n 3)"
fi

# --- P2: Postgres Flexible Server SKU and major version --------------------------------------------
p2="P2 PostgreSQL Standard_B1ms in $location"
pg_version=""
if az postgres flexible-server list-skus --location "$location" -o json >"$tmp/skus.json" 2>"$tmp/p2.err"; then
  if grep -Fq 'Standard_B1ms' "$tmp/skus.json"; then
    pass "$p2"
    # Presence of a "18" version entry anywhere in the raw output is the (unverified) signal for PG 18.
    if grep -Eq '"18"' "$tmp/skus.json"; then
      pg_version=18
    else
      pg_version=17
      printf 'WARN could not confirm PostgreSQL 18; using 17\n' >&2
    fi
  else
    fail "$p2"
    log "P2: Standard_B1ms not found in $location; file a region-access request or try another region"
  fi
else
  fail "$p2"
  log "P2: az postgres flexible-server list-skus failed: $(tr -d '\r' <"$tmp/p2.err" | head -n 3)"
fi

# --- P3: resource providers registered -------------------------------------------------------------
providers=(
  Microsoft.App
  Microsoft.OperationalInsights
  Microsoft.Insights
  Microsoft.DBforPostgreSQL
  Microsoft.ContainerRegistry
  Microsoft.ManagedIdentity
  Microsoft.Consumption
)
for provider in "${providers[@]}"; do
  p3="P3 provider $provider registered"
  state="$(az provider show -n "$provider" --query registrationState -o tsv 2>/dev/null | tr -d '\r' || true)"
  if [ "$state" = "Registered" ]; then
    pass "$p3"
  else
    fail "$p3"
    log "P3: $provider is '${state:-unknown}'; run: az provider register --namespace $provider --wait"
  fi
done

# --- P4: signed-in user is Owner on the subscription ------------------------------------------------
p4="P4 signed-in user is Owner on the subscription"
sub_id="$(az account show --query id -o tsv 2>/dev/null | tr -d '\r' || true)"
user_name="$(az account show --query user.name -o tsv 2>/dev/null | tr -d '\r' || true)"
if [ -z "$sub_id" ] || [ -z "$user_name" ]; then
  fail "$p4"
  log "P4: az account show returned nothing; run az login and az account set first"
else
  owner="$(az role assignment list --assignee "$user_name" --scope "/subscriptions/$sub_id" \
    --include-inherited --include-groups \
    --query "[?roleDefinitionName=='Owner'].roleDefinitionName" -o tsv 2>/dev/null | tr -d '\r' || true)"
  if [ -n "$owner" ]; then
    pass "$p4"
  else
    fail "$p4"
    log "P4: no Owner role assignment seen for $user_name. Ownership inherited through a group or a" \
      "management group may not appear in this query; check Subscriptions > Access control (IAM) in the portal."
  fi
fi

if [ -n "$pg_version" ]; then
  printf 'POSTGRES_VERSION=%s\n' "$pg_version"
fi

if [ "$failures" -gt 0 ]; then
  log "preflight failed: $failures check(s)"
  exit 1
fi
log "preflight passed"
