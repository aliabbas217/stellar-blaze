#!/usr/bin/env bash
# ADR 0042: the database client must verify the server, not only encrypt. Prints `PASS|FAIL T<n> <subject>`, exits 1 on any
# FAIL, and NEVER prints the database URL.
#
#   check-db-tls.sh --template <main.bicep>   static, no login: T1 the URL has ssl=verify-full, T2 no weaker mode and no
#                                             sslmode= anywhere, T3 PGSSLROOTCERT is set on api, alerts and job-migrate
#   check-db-tls.sh --deployed <rg>           after the deployment, as the deployer: T4 the stored sb-database-url secret
#                                             of api, alerts and job-migrate matches ssl=verify-full, T5 each one's
#                                             PGSSLROOTCERT env entry has the expected path. Catches a secret or an env
#                                             entry changed outside the template.
#   check-db-tls.sh --image <image>           real images only (build-api, after the push): T6 the image's CA bundle,
#                                             loaded from PGSSLROOTCERT, holds both roots Microsoft names for Azure
#                                             Database for PostgreSQL
#
# Secret hygiene (T4): the value is read with `secret list --show-values` (Microsoft documents `secret show` as not
# printing a value) and piped straight into grep. It is never assigned to a variable, echoed or logged, tracing is off,
# and the CLI's stderr is dropped.

set -euo pipefail

scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$scripts_dir/lib.sh"

expected_root_cert="/etc/ssl/certs/ca-certificates.crt"
secret_name="sb-database-url"
failed=0

usage() {
  printf 'usage: check-db-tls.sh --template <main.bicep> | --deployed <resource-group> | --image <image>\n' >&2
  exit 1
}

# result <PASS|FAIL> <id> <subject>
result() {
  printf '%s %s %s\n' "$1" "$2" "$3"
  if [ "$1" = "FAIL" ]; then
    failed=1
  fi
}

# ---- --template -------------------------------------------------------------------------------------------------------

mode_template() {
  local template="$1" bicep_bin python_bin rc=0 output
  [ -f "$template" ] || die "no such template: $template"
  bicep_bin="$(find_bicep)" || die "bicep not found: set BICEP_BIN, put bicep on PATH or run 'az bicep install'"
  python_bin="$(find_python)" || die "python 3.10+ not found"
  # The helper prints PASS|FAIL T1..T3 lines itself (it never sees a real secret: only dummy values).
  output="$("$python_bin" -I "$scripts_dir/template_checks.py" tls "$template" --bicep "$bicep_bin")" || rc=$?
  printf '%s\n' "$output"
  if [ "$rc" -ne 0 ]; then
    failed=1
  fi
}

# ---- --deployed -------------------------------------------------------------------------------------------------------

# secret_has_verify_full <kind: app|job> <name> <rg>: exit status of grep over the stored secret, nothing printed.
secret_has_verify_full() {
  local kind="$1" name="$2" rg="$3"
  set +x
  if [ "$kind" = "job" ]; then
    az containerapp job secret list -n "$name" -g "$rg" --show-values \
      --query "[?name=='$secret_name'].value | [0]" -o tsv 2>/dev/null | grep -F -- 'ssl=verify-full' >/dev/null
  else
    az containerapp secret list -n "$name" -g "$rg" --show-values \
      --query "[?name=='$secret_name'].value | [0]" -o tsv 2>/dev/null | grep -F -- 'ssl=verify-full' >/dev/null
  fi
}

# deployed_root_cert <kind> <name> <rg>: the value of PGSSLROOTCERT in the first container (not a secret), empty if absent.
deployed_root_cert() {
  local kind="$1" name="$2" rg="$3"
  local query="properties.template.containers[0].env[?name=='PGSSLROOTCERT'].value | [0]"
  if [ "$kind" = "job" ]; then
    az containerapp job show -n "$name" -g "$rg" --query "$query" -o tsv 2>/dev/null | tr -d '\r'
  else
    az containerapp show -n "$name" -g "$rg" --query "$query" -o tsv 2>/dev/null | tr -d '\r'
  fi
}

mode_deployed() {
  local rg="$1" target kind name found
  for target in app:api app:alerts job:job-migrate; do
    kind="${target%%:*}"
    name="${target#*:}"
    if (secret_has_verify_full "$kind" "$name" "$rg"); then
      result PASS T4 "$name stores $secret_name with ssl=verify-full"
    else
      result FAIL T4 "$name: $secret_name is missing, unreadable, or lacks ssl=verify-full"
    fi
    found="$(deployed_root_cert "$kind" "$name" "$rg" || true)"
    if [ "$found" = "$expected_root_cert" ]; then
      result PASS T5 "$name has PGSSLROOTCERT=$expected_root_cert"
    else
      result FAIL T5 "$name: PGSSLROOTCERT is '${found:-<unset>}', expected $expected_root_cert"
    fi
  done
}

# ---- --image ----------------------------------------------------------------------------------------------------------

# Runs inside the image: loads the root file named by PGSSLROOTCERT as a verification bundle and requires both roots.
t6_script='
import os, ssl, sys
path = os.environ["PGSSLROOTCERT"]
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
ctx.load_verify_locations(cafile=path)
names = set()
for cert in ctx.get_ca_certs():
    for rdn in cert.get("subject", ()):
        for key, value in rdn:
            if key == "commonName":
                names.add(value)
required = ("DigiCert Global Root G2", "Microsoft RSA Root Certificate Authority 2017")
missing = [n for n in required if n not in names]
if missing:
    print("missing root CA(s): " + ", ".join(missing), file=sys.stderr)
    sys.exit(1)
'

mode_image() {
  local image="$1" err
  if ! command -v docker >/dev/null 2>&1; then
    result FAIL T6 "docker is not available, cannot inspect $image"
    return 0
  fi
  # --pull never: the image under test is the one just built or pushed, never a different one fetched from a hub.
  # MSYS_NO_PATHCONV: Git Bash would rewrite `PGSSLROOTCERT=/etc/...` into a Windows path (no effect elsewhere).
  if err="$(MSYS_NO_PATHCONV=1 docker run --rm --pull never -e "PGSSLROOTCERT=$expected_root_cert" --entrypoint python "$image" -c "$t6_script" 2>&1)"; then
    result PASS T6 "$image trusts DigiCert Global Root G2 and Microsoft RSA Root Certificate Authority 2017 via $expected_root_cert"
  else
    result FAIL T6 "$image: the CA bundle check failed"
    printf '%s\n' "$err" | tail -n 5 | sed 's/^/  | /'
  fi
}

# ---- main -------------------------------------------------------------------------------------------------------------

[ "$#" -eq 2 ] || usage
case "$1" in
  --template) mode_template "$2" ;;
  --deployed) mode_deployed "$2" ;;
  --image) mode_image "$2" ;;
  *) usage ;;
esac

exit "$failed"
