#!/usr/bin/env bash
# Offline rehearsal of infra/render/render.yaml. It parses THE FILE RENDER READS (PyYAML in a python container), takes the
# start and pre-deploy commands and the environment straight out of it, and runs them against the real images in a throwaway
# Docker network: the official postgres image on a volume (Render's disk), the api and web images, TLS verified with
# `ssl=verify-full` against a CA made by infra/scripts/gen-db-certs.sh for the host name `sb-pg-test`.
#
#   bash infra/render/rehearse-render.sh
#
# Checks (PASS or FAIL per line; exit 0 only if all pass):
#   Y1  the file's structure (services, private api, no managed database, secrets only where they belong, no weak ssl value)
#   Y2  every $VARIABLE a command reads is defined for that service (environment, group or the command itself)
#   P1  sb-pg's command starts Postgres, which accepts TLS; PGDATA is on the volume
#   A1  the api pre-deploy command (db upgrade, then site load) succeeds under verify-full
#   A2  the api start command serves /api/v1/health/ready (which needs the database)
#   L1  the alerts start command runs and logs a dispatch cycle (it writes to the database)
#   W1  the web start command composes API_ORIGIN and proxies the api's readiness through to the database
#   N1  plaintext TCP to the database is refused (control: TLS connects)
#   N2  verify-full with a wrong CA fails          N3  with a host name that is not in the certificate it fails
#   N4  sb-pg's command exits non-zero, before Postgres starts, for a `pending`, empty, mismatched or missing value
#   N5  the api and alerts commands exit non-zero for a `pending` or empty CA
#   N6  the alerts command with a wrong CA does not connect
#   N7  A3: the api reports not-ready when the database is down, and E1: the database restarts on the same volume with the
#       image entrypoint REPLACED (the other reading of Render's Docker Command) and the pre-deploy still succeeds
#
# NOT shown (needs Render itself): that Render passes the environment to the pre-deploy command, resolves `fromService host`
# to the name it shows in the dashboard, splits the command string as one `sh -c` argument, and reaches port 8000.
# Everything it creates is labelled and removed on exit, with its scratch directory (which holds throwaway keys).
set -euo pipefail

# Git Bash rewrites /unix/looking arguments for native programs. docker needs them left alone; openssl (gen-db-certs.sh) needs
# them converted. So the switch is per command: every `docker` call below goes through this function.
docker() { MSYS_NO_PATHCONV=1 command docker "$@"; }

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo="$(cd -- "$here/../.." && pwd -P)"
yaml="$here/render.yaml"
gen_certs="$repo/infra/scripts/gen-db-certs.sh"
api_image="${SB_API_IMAGE:-stellar-blaze-api:i1}"
web_image="${SB_WEB_IMAGE:-stellar-blaze-web:i1}"
py_image="python:3.13-slim"
pyyaml="pyyaml==6.0.3"
tag="sbr$$"
net="$tag-net"
vol="$tag-pgdata"
label="sb-render-rehearsal=$tag"

die() {
  printf 'rehearse-render: %s\n' "$*" >&2
  exit 1
}

win_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

for tool in docker openssl; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed or not on PATH"
done
docker info >/dev/null 2>&1 || die "the docker daemon is not reachable"
[ -f "$yaml" ] || die "$yaml not found"
for image in "$api_image" "$web_image"; do
  docker image inspect "$image" >/dev/null 2>&1 || die "image $image not found locally (build it: docker build -t $image <dir>)"
done

tmp="$(mktemp -d)"
chmod 700 "$tmp"
tmp_win="$(win_path "$tmp")"
pw_raw=""
pw=""

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  local ids
  ids="$(docker ps -aq --filter "label=$label" 2>/dev/null || true)"
  if [ -n "$ids" ]; then
    # shellcheck disable=SC2086  # a list of container ids, split on purpose
    docker rm -f $ids >/dev/null 2>&1 || true
  fi
  docker network rm "$net" >/dev/null 2>&1 || true
  docker volume rm -f "$vol" >/dev/null 2>&1 || true
  rm -rf -- "$tmp"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

failures=0
record() { # <id> <PASS|FAIL> <what>
  printf '%s %s %s\n' "$2" "$1" "$3"
  if [ "$2" = FAIL ]; then failures=$((failures + 1)); fi
}

mask() { sed -e "s|${pw_raw:-NOPASSWORD}|***|g" -e "s|${pw:-NOPASSWORD}|***|g"; }

# --- (a) the extractor: runs inside python:3.13-slim; reads the real YAML; writes commands and env files --------------------
mkdir -p "$tmp/ex" "$tmp/pki" "$tmp/pki-other"
cat >"$tmp/extract.py" <<'PY'
import json, re, shlex, sys
import yaml

doc = yaml.safe_load(open("/in/render.yaml", encoding="utf8"))
supply = {}
for line in open("/ex/supply.env", encoding="utf8"):
    line = line.rstrip("\n")
    if line:
        key, _, value = line.partition("=")
        supply[key] = value

out = []
def check(cid, ok, text):
    out.append("%s\t%s\t%s" % ("PASS" if ok else "FAIL", cid, text))

problems = []
def need(cond, text):
    if not cond:
        problems.append(text)

services = {s["name"]: s for s in doc.get("services", [])}
groups = {g["name"]: g for g in doc.get("envVarGroups", [])}

# ---- Y1: structure -------------------------------------------------------------------------------------------------
need("databases" not in doc, "a managed database is declared (it cannot do verify-full)")
need(set(services) == {"sb-pg", "sb-api", "sb-alerts", "sb-web"}, "services are %s" % sorted(services))
want_type = {"sb-pg": "pserv", "sb-api": "pserv", "sb-alerts": "worker", "sb-web": "web"}
for name, svc in services.items():
    need(svc.get("type") == want_type.get(name), "%s has type %s" % (name, svc.get("type")))
    need(svc.get("region") == "frankfurt", "%s is not in frankfurt" % name)
    need(svc.get("autoDeployTrigger") == "off", "%s does not turn auto deploy off" % name)
    need(("healthCheckPath" in svc) == (name == "sb-web"), "%s: healthCheckPath is for the web service only" % name)
need(services["sb-web"].get("healthCheckPath") == "/api/healthz", "sb-web health check path")
pg = services["sb-pg"]
need(pg.get("runtime") == "image" and "@sha256:" in pg["image"]["url"], "sb-pg image is not pinned by digest")
need(pg["disk"]["mountPath"] == "/var/lib/postgresql", "sb-pg disk is not mounted at /var/lib/postgresql")
need(services["sb-api"].get("dockerfilePath") == "./backend/Dockerfile" and services["sb-api"].get("dockerContext") == "./backend", "sb-api build")
for gname, grp in groups.items():
    for ev in grp["envVars"]:
        need("sync" not in ev and "fromService" not in ev, "group %s: %s uses sync or fromService" % (gname, ev["key"]))

def service_vars(svc):
    """-> (static {key: value}, supplied [key], group names)"""
    static, supplied, used = {}, [], []
    for ev in svc.get("envVars", []):
        if "fromGroup" in ev:
            used.append(ev["fromGroup"])
            for gv in groups[ev["fromGroup"]]["envVars"]:
                if "value" in gv:
                    static[gv["key"]] = str(gv["value"])
                elif gv.get("generateValue"):
                    supplied.append(gv["key"])
        elif "value" in ev:
            static[ev["key"]] = str(ev["value"])
        elif "fromService" in ev or ev.get("sync") is False or ev.get("generateValue"):
            supplied.append(ev["key"])
        else:
            need(False, "%s: %s has no value" % (svc["name"], ev["key"]))
    return static, supplied, used

secret_keys = {}
for name, svc in services.items():
    static, supplied, used = service_vars(svc)
    secret_keys[name] = sorted(k for k in (e["key"] for e in svc.get("envVars", []) if e.get("sync") is False))
    # the file Render reads, as an env file for docker
    with open("/ex/%s.env" % name, "w", encoding="utf8") as handle:
        for key, value in static.items():
            handle.write("%s=%s\n" % (key, value))
        for key in supplied:
            need(key in supply, "%s needs %s and the rehearsal does not supply it" % (name, key))
            handle.write("%s=%s\n" % (key, supply.get(key, "")))
    svc["_static"], svc["_supplied"], svc["_groups"] = static, supplied, used

want_secrets = {
    "sb-pg": ["PG_SERVER_CERT_B64", "PG_SERVER_KEY_B64"],
    "sb-api": ["SB_ACCESS_TOKENS", "SB_DB_CA_B64"],
    "sb-alerts": ["SB_DB_CA_B64", "SB_VAPID_PRIVATE_KEY", "SB_VAPID_SUBJECT"],
    "sb-web": ["DEMO_EMPLOYER_TOKEN", "VAPID_PUBLIC_KEY"],
}
for name, want in want_secrets.items():
    need(secret_keys[name] == want, "%s: secrets are %s, expected %s" % (name, secret_keys[name], want))
need("sb-common" in services["sb-api"]["_groups"] and "sb-common" in services["sb-alerts"]["_groups"], "api and alerts must share sb-common")
need("sb-common" not in services["sb-pg"]["_groups"] and "sb-common" not in services["sb-web"]["_groups"], "sb-common leaks to pg or web")
need("DB_PASSWORD" in services["sb-pg"]["_supplied"] and "DB_PASSWORD" in services["sb-api"]["_supplied"] and "DB_PASSWORD" in services["sb-alerts"]["_supplied"], "DB_PASSWORD is not one shared generated value")
need("SB_VAPID_PRIVATE_KEY" not in services["sb-api"]["_supplied"] and "SB_ACCESS_TOKENS" not in services["sb-alerts"]["_supplied"], "secret on the wrong service")
need(not any("NEXT_PUBLIC_SB_DEMO" in json.dumps(s) for s in services.values()), "NEXT_PUBLIC_SB_DEMO is set (a build arg on Render)")

# commands: each must be exactly `sh -c '<script>'`
commands = {
    "sb-pg": services["sb-pg"]["dockerCommand"],
    "sb-api": services["sb-api"]["dockerCommand"],
    "sb-api.pre": services["sb-api"]["preDeployCommand"],
    "sb-alerts": services["sb-alerts"]["dockerCommand"],
    "sb-web": services["sb-web"]["dockerCommand"],
}
scripts = {}
for key, command in commands.items():
    argv = shlex.split(command)
    need(argv[:2] == ["sh", "-c"] and len(argv) == 3, "%s: command is not exactly sh -c '<script>'" % key)
    scripts[key] = argv[2] if len(argv) == 3 else ""
    with open("/ex/%s.cmd" % key, "w", encoding="utf8") as handle:
        handle.write(scripts[key])

# no weak ssl value anywhere a value can live (comments are not in the parsed document)
blob = json.dumps(doc)
need(not re.search(r"ssl=(require|prefer|allow|disable|verify-ca)|sslmode", blob), "a weak ssl setting is a value in the file")
for key in ("sb-api", "sb-api.pre", "sb-alerts"):
    need("?ssl=verify-full" in scripts[key] and "PGSSLROOTCERT=" in scripts[key], "%s does not use ssl=verify-full with PGSSLROOTCERT" % key)
need("hostssl all all all scram-sha-256" in scripts["sb-pg"], "sb-pg pg_hba has no hostssl rule")
need(not re.search(r"\bhost\s+all", scripts["sb-pg"]), "sb-pg pg_hba has a plaintext host rule")

check("Y1", not problems, "render.yaml structure holds: 4 services in frankfurt, api and db private, no managed database, no weak ssl value, secrets placed" if not problems else "; ".join(problems))

# ---- Y2: every variable a command reads is defined ------------------------------------------------------------------
undefined = []
owner = {"sb-pg": "sb-pg", "sb-api": "sb-api", "sb-api.pre": "sb-api", "sb-alerts": "sb-alerts", "sb-web": "sb-web"}
for key, script in scripts.items():
    svc = services[owner[key]]
    defined = set(svc["_static"]) | set(svc["_supplied"])
    assigned = set(re.findall(r"(?:^|[\s;])([A-Za-z_]\w*)=", script))
    referenced = set(re.findall(r"\$\{#?([A-Za-z_]\w*)", script)) | set(re.findall(r"\$([A-Za-z_]\w*)", script))
    missing = referenced - defined - assigned - {"RENDER_GIT_COMMIT"}
    if missing:
        undefined.append("%s reads %s" % (key, sorted(missing)))
check("Y2", not undefined, "every variable a command reads is defined for its service" if not undefined else "; ".join(undefined))

json.dump({"pg_image": pg["image"]["url"]}, open("/ex/meta.json", "w"))
open("/ex/checks.txt", "w", encoding="utf8").write("\n".join(out) + "\n")
PY

# --- (b) secrets, certificates, VAPID pair ---------------------------------------------------------------------------------
printf 'Generating throwaway secrets and certificates in a scratch directory (removed on exit)\n'
pw_raw="$(openssl rand -base64 32)" # what generateValue gives: base64, with + / =
pw="$(printf '%s' "$pw_raw" | tr -dc 'A-Za-z0-9')"
[ "${#pw}" -ge 32 ] || die "the generated password is too short after filtering"
demo_token="$(openssl rand -hex 32)"
token_sha="$(printf '%s' "$demo_token" | openssl dgst -sha256 | sed 's/^.* //')"
access_tokens="{\"$token_sha\": {\"actor\": \"demo-bff\", \"role\": \"employer\", \"employer_id\": \"emp-demo\"}}"
bash "$gen_certs" --san sb-pg-test --out "$tmp/pki" --b64 >/dev/null
bash "$gen_certs" --san sb-pg-test --out "$tmp/pki-other" --b64 >/dev/null
ca_b64="$(tr -d '\n' <"$tmp/pki/ca.crt.b64")"
cert_b64="$(tr -d '\n' <"$tmp/pki/server.crt.b64")"
key_b64="$(tr -d '\n' <"$tmp/pki/server.key.b64")"
other_ca_b64="$(tr -d '\n' <"$tmp/pki-other/ca.crt.b64")"
other_key_b64="$(tr -d '\n' <"$tmp/pki-other/server.key.b64")"

vapid_code='
import base64
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02
def b64u(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()
v = Vapid02()
v.generate_keys()
print(b64u(v.private_key.private_numbers().private_value.to_bytes(32, "big")))
print(b64u(v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)))
'
vapid_out="$(docker run --rm --pull never --entrypoint python "$api_image" -c "$vapid_code")" || die "could not generate a VAPID pair with the api image"
vapid_private="$(printf '%s\n' "$vapid_out" | sed -n '1p')"
vapid_public="$(printf '%s\n' "$vapid_out" | sed -n '2p')"

{
  printf 'DB_HOST=sb-pg-test\n'
  printf 'API_HOST=sb-api-test\n'
  printf 'DB_PASSWORD=%s\n' "$pw_raw"
  printf 'SB_DB_CA_B64=%s\n' "$ca_b64"
  printf 'PG_SERVER_CERT_B64=%s\n' "$cert_b64"
  printf 'PG_SERVER_KEY_B64=%s\n' "$key_b64"
  printf 'SB_ACCESS_TOKENS=%s\n' "$access_tokens"
  printf 'SB_VAPID_PRIVATE_KEY=%s\n' "$vapid_private"
  printf 'SB_VAPID_SUBJECT=mailto:rehearsal@example.org\n'
  printf 'VAPID_PUBLIC_KEY=%s\n' "$vapid_public"
  printf 'DEMO_EMPLOYER_TOKEN=%s\n' "$demo_token"
} >"$tmp/ex/supply.env"
chmod 644 "$tmp/ex/supply.env"
chmod 755 "$tmp/ex"

# --- (c) parse the real YAML --------------------------------------------------------------------------------------------------
printf 'Parsing %s with PyYAML (in %s)\n' "infra/render/render.yaml" "$py_image"
if ! docker run --rm -v "$(win_path "$here"):/in:ro" -v "$tmp_win/ex:/ex" -v "$tmp_win/extract.py:/extract.py:ro" "$py_image" \
  sh -c "pip install -q --root-user-action=ignore --disable-pip-version-check $pyyaml >/dev/null 2>&1 && python -I /extract.py" >"$tmp/extract.out" 2>&1; then
  cat "$tmp/extract.out" >&2
  die "the extractor failed (is PyPI reachable?)"
fi
while IFS=$'\t' read -r verdict cid text; do
  if [ -n "$verdict" ]; then record "$cid" "$verdict" "$text"; fi
done <"$tmp/ex/checks.txt"
if [ "$failures" -gt 0 ]; then
  printf 'the YAML contract failed; not starting any container\n' >&2
  exit 1
fi
pg_image="$(sed -n 's/.*"pg_image": "\([^"]*\)".*/\1/p' "$tmp/ex/meta.json")"
[ -n "$pg_image" ] || die "no postgres image url found"
docker image inspect "$pg_image" >/dev/null 2>&1 || docker pull -q "$pg_image" >/dev/null || die "cannot pull $pg_image"

# --- (d) helpers for the container checks ---------------------------------------------------------------------------------
docker network create --label "$label" "$net" >/dev/null
docker volume create --label "$label" "$vol" >/dev/null
ex_win="$tmp_win/ex"
printf '' >"$tmp/none.env"
none_win="$tmp_win/none.env"

pg_script() { cat "$tmp/ex/sb-pg.cmd"; }

# override_env <file> KEY=VALUE...: an env file that overrides the service's own (a second --env-file wins).
override_env() {
  local file="$1"
  shift
  printf '%s\n' "$@" >"$file"
}

run_rc=0
run_out=""
# run_once <image> <service-env-file> <override-env-file> <script-file> [timeout seconds]: a one-shot container; sets run_rc, run_out.
run_once() {
  local image="$1" envf="$2" over="$3" script="$4" limit="${5:-180}"
  run_rc=0
  timeout "$limit" docker run --rm --pull never --label "$label" --network "$net" --env-file "$envf" --env-file "$over" \
    "$image" sh -c "$(cat "$script")" >"$tmp/run.out" 2>&1 || run_rc=$?
  run_out="$(mask <"$tmp/run.out")"
}
last_line() { printf '%s\n' "$1" | grep -v '^[[:space:]]*$' | tail -n 1 | cut -c1-220; }

wait_pg() { # up to 90 s
  for _ in $(seq 1 45); do
    if [ "$(docker inspect -f '{{.State.Status}}' "$tag-pg" 2>/dev/null)" != running ]; then return 1; fi
    if docker exec "$tag-pg" pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

node_get() { # <container> <url>: exit 0 when the answer is 2xx
  docker exec "$1" node -e "fetch('$2').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1
}
py_get() {
  docker exec "$1" python -c "import urllib.request; urllib.request.urlopen('$2', timeout=3)" >/dev/null 2>&1
}

# --- (e) P1: sb-pg ------------------------------------------------------------------------------------------------------------
printf 'Starting sb-pg from its command (postgres 18.6 on a volume, TLS only)\n'
docker run -d --pull never --name "$tag-pg" --label "$label" --network "$net" --network-alias sb-pg-test --network-alias sb-pg-alt \
  --env-file "$ex_win/sb-pg.env" -v "$vol:/var/lib/postgresql" "$pg_image" sh -c "$(pg_script)" >/dev/null
if wait_pg; then
  on_disk="$(docker run --rm --pull never --label "$label" -v "$vol:/v:ro" --entrypoint sh "$pg_image" -c 'test -f /v/18/docker/PG_VERSION && echo yes' 2>/dev/null || true)"
  tls_on="$(docker exec -e PGPASSWORD="$pw" "$tag-pg" psql "host=127.0.0.1 dbname=stellar_blaze user=sbadmin sslmode=require" -Atc 'show ssl' 2>/dev/null || true)"
  if [ "$on_disk" = yes ] && [ "$tls_on" = on ]; then
    record P1 PASS "sb-pg is up: ssl=on, scram login with the filtered password works, PGDATA is /var/lib/postgresql/18/docker on the volume"
  else
    record P1 FAIL "sb-pg is up but PGDATA on the volume='$on_disk' ssl='$tls_on'"
  fi
else
  docker logs --tail 20 "$tag-pg" 2>&1 | mask >&2 || true
  record P1 FAIL "sb-pg did not become ready"
  die "cannot continue without the database"
fi

# --- A1: the api pre-deploy command -------------------------------------------------------------------------------------------
run_once "$api_image" "$ex_win/sb-api.env" "$none_win" "$tmp/ex/sb-api.pre.cmd"
if [ "$run_rc" -eq 0 ] && printf '%s' "$run_out" | grep -q 'site-demo-mussafah'; then
  record A1 PASS "api preDeployCommand exited 0 under ssl=verify-full: db upgrade, then site load (site-demo-mussafah in the log)"
else
  record A1 FAIL "api preDeployCommand rc=$run_rc: $(last_line "$run_out")"
fi

# --- A2: the api start command --------------------------------------------------------------------------------------------------
docker run -d --pull never --name "$tag-api" --label "$label" --network "$net" --network-alias sb-api-test --env-file "$ex_win/sb-api.env" \
  "$api_image" sh -c "$(cat "$tmp/ex/sb-api.cmd")" >/dev/null
api_ready=false
for _ in $(seq 1 30); do
  if py_get "$tag-api" 'http://127.0.0.1:8000/api/v1/health/ready'; then
    api_ready=true
    break
  fi
  sleep 2
done
if [ "$api_ready" = true ]; then
  record A2 PASS "api start command serves /api/v1/health/ready (a 200 needs the database under verify-full)"
else
  docker logs --tail 15 "$tag-api" 2>&1 | mask >&2 || true
  record A2 FAIL "api did not become ready"
fi

# --- L1: the alerts start command --------------------------------------------------------------------------------------------
docker run -d --pull never --name "$tag-alerts" --label "$label" --network "$net" --env-file "$ex_win/sb-alerts.env" \
  "$api_image" sh -c "$(cat "$tmp/ex/sb-alerts.cmd")" >/dev/null
alerts_cycle=false
for _ in $(seq 1 24); do
  if docker logs "$tag-alerts" 2>&1 | grep -q 'job\.succeeded'; then
    alerts_cycle=true
    break
  fi
  sleep 4
done
alerts_state="$(docker inspect -f '{{.State.Status}}' "$tag-alerts")"
if [ "$alerts_cycle" = true ] && [ "$alerts_state" = running ]; then
  record L1 PASS "alerts start command is running and logged a dispatch cycle (job.succeeded) over verify-full"
else
  docker logs --tail 15 "$tag-alerts" 2>&1 | mask >&2 || true
  record L1 FAIL "alerts state '$alerts_state', dispatch cycle logged: $alerts_cycle"
fi

# --- W1: the web start command --------------------------------------------------------------------------------------------------
docker run -d --pull never --name "$tag-web" --label "$label" --network "$net" --env-file "$ex_win/sb-web.env" \
  "$web_image" sh -c "$(cat "$tmp/ex/sb-web.cmd")" >/dev/null
web_ok=false
for _ in $(seq 1 30); do
  if node_get "$tag-web" 'http://127.0.0.1:3000/api/healthz'; then
    web_ok=true
    break
  fi
  sleep 2
done
if [ "$web_ok" = true ] && node_get "$tag-web" 'http://127.0.0.1:3000/api/v1/health/ready'; then
  record W1 PASS "web start command: /api/healthz answers and /api/v1/health/ready is proxied to http://sb-api-test:8000 and through to the database"
else
  docker logs --tail 15 "$tag-web" 2>&1 | mask >&2 || true
  record W1 FAIL "web healthz up: $web_ok, or the proxy to the api did not answer"
fi

# --- N1: plaintext refused ------------------------------------------------------------------------------------------------------
psql_try() { # <sslmode>: from a separate client container over the network
  PGPASSWORD="$pw" timeout 60 docker run --rm --pull never --label "$label" --network "$net" -e PGPASSWORD --entrypoint psql "$pg_image" \
    "host=sb-pg-test dbname=stellar_blaze user=sbadmin sslmode=$1 connect_timeout=5" -Atc 'select 1' 2>&1 | mask
}
n1_rc=0
n1_out="$(psql_try disable)" || n1_rc=$?
n1_ctl_rc=0
n1_ctl="$(psql_try require)" || n1_ctl_rc=$?
if [ "$n1_ctl_rc" -eq 0 ] && [ "$n1_ctl" = 1 ] && [ "$n1_rc" -ne 0 ] && printf '%s' "$n1_out" | grep -Eqi 'no encryption|SSL required|rejects'; then
  record N1 PASS "plaintext TCP refused (control: sslmode=require connects): $(last_line "$n1_out")"
else
  record N1 FAIL "plaintext: rc=$n1_rc control rc=$n1_ctl_rc: $(last_line "$n1_out")"
fi

# --- N2, N3: verify-full is real -----------------------------------------------------------------------------------------------
override_env "$tmp/o-wrongca.env" "SB_DB_CA_B64=$other_ca_b64"
run_once "$api_image" "$ex_win/sb-api.env" "$tmp_win/o-wrongca.env" "$tmp/ex/sb-api.pre.cmd"
if [ "$run_rc" -ne 0 ] && printf '%s' "$run_out" | grep -Eqi 'certificate verify failed|unable to get local issuer|self.signed'; then
  record N2 PASS "wrong CA: the api pre-deploy fails closed: $(last_line "$run_out")"
else
  record N2 FAIL "wrong CA: rc=$run_rc: $(last_line "$run_out")"
fi
override_env "$tmp/o-wronghost.env" "DB_HOST=sb-pg-alt"
run_once "$api_image" "$ex_win/sb-api.env" "$tmp_win/o-wronghost.env" "$tmp/ex/sb-api.pre.cmd"
if [ "$run_rc" -ne 0 ] && printf '%s' "$run_out" | grep -Eqi 'hostname|mismatch|does not match|certificate verify failed'; then
  record N3 PASS "host name not in the certificate: the api pre-deploy fails: $(last_line "$run_out")"
else
  record N3 FAIL "wrong host: rc=$run_rc: $(last_line "$run_out")"
fi

# --- N4: sb-pg refuses to start without a valid certificate -----------------------------------------------------------------------
n4_fail=""
n4_cases=0
n4_case() { # <label> <expected message, a regex> KEY=VALUE...
  local what="$1" expect="$2"
  shift 2
  override_env "$tmp/o-n4.env" "$@"
  n4_cases=$((n4_cases + 1))
  # No volume: the container's own filesystem, so the real data directory is never touched.
  run_rc=0
  timeout 60 docker run --rm --pull never --label "$label" --network "$net" --env-file "$ex_win/sb-pg.env" --env-file "$tmp_win/o-n4.env" \
    "$pg_image" sh -c "$(pg_script)" >"$tmp/run.out" 2>&1 || run_rc=$?
  run_out="$(mask <"$tmp/run.out")"
  if [ "$run_rc" -eq 0 ] || ! printf '%s' "$run_out" | grep -Eq "$expect" || printf '%s' "$run_out" | grep -q 'database system is ready'; then
    n4_fail="$n4_fail [$what: rc=$run_rc: $(last_line "$run_out")]"
  fi
}
# `pending` is accepted by GNU base64 -d (it decodes without padding), so the second guard, "is not a certificate", is what
# stops it: both messages are acceptable, the point is the non-zero exit before Postgres starts.
n4_case "pending cert and key" "not valid base64|is not a certificate" "PG_SERVER_CERT_B64=pending" "PG_SERVER_KEY_B64=pending"
n4_case "pending key only" "PG_SERVER_KEY_B64 is not (valid base64|a private key)" "PG_SERVER_KEY_B64=pending"
n4_case "empty cert" "is not a certificate" "PG_SERVER_CERT_B64="
n4_case "empty key" "is not a private key" "PG_SERVER_KEY_B64="
n4_case "key of another certificate" "do not match" "PG_SERVER_KEY_B64=$other_key_b64"
n4_case "base64 of text, not a certificate" "is not a certificate" "PG_SERVER_CERT_B64=$(printf 'hello' | base64)"
n4_case "no DB_PASSWORD" "DB_PASSWORD is missing" "DB_PASSWORD="
if [ -z "$n4_fail" ]; then
  record N4 PASS "sb-pg exits non-zero before Postgres starts for $n4_cases bad inputs (pending, empty, wrong key, not a certificate, no password)"
else
  record N4 FAIL "$n4_fail"
fi

# --- N5, N6: clients refuse a bad CA -----------------------------------------------------------------------------------------------
n5_fail=""
for service in sb-api sb-api.pre sb-alerts; do
  for bad in "pending:not valid base64|holds no certificate" ":holds no certificate"; do
    value="${bad%%:*}"
    expect="${bad#*:}"
    override_env "$tmp/o-n5.env" "SB_DB_CA_B64=$value"
    env_service="${service%.pre}"
    run_once "$api_image" "$ex_win/$env_service.env" "$tmp_win/o-n5.env" "$tmp/ex/$service.cmd" 60
    if [ "$run_rc" -eq 0 ] || ! printf '%s' "$run_out" | grep -Eq "$expect"; then
      n5_fail="$n5_fail [$service '$value': rc=$run_rc: $(last_line "$run_out")]"
    fi
  done
done
if [ -z "$n5_fail" ]; then
  record N5 PASS "api start, api pre-deploy and alerts start all exit non-zero for a pending or an empty CA"
else
  record N5 FAIL "$n5_fail"
fi

# The alerts loop does not exit on a database error (it logs `alerts.cycle_failed` and retries), so run it detached and look
# at its log: the verification error must appear and no cycle may succeed.
override_env "$tmp/o-n6.env" "SB_DB_CA_B64=$other_ca_b64"
docker run -d --pull never --name "$tag-alerts-bad" --label "$label" --network "$net" --env-file "$ex_win/sb-alerts.env" \
  --env-file "$tmp_win/o-n6.env" "$api_image" sh -c "$(cat "$tmp/ex/sb-alerts.cmd")" >/dev/null
n6_seen=false
for _ in $(seq 1 20); do
  if docker logs "$tag-alerts-bad" 2>&1 | grep -q 'SSLCertVerificationError'; then
    n6_seen=true
    break
  fi
  sleep 3
done
sleep 5
n6_log="$(docker logs "$tag-alerts-bad" 2>&1 | mask)"
docker rm -f "$tag-alerts-bad" >/dev/null
if [ "$n6_seen" = true ] && ! printf '%s' "$n6_log" | grep -q 'job\.succeeded'; then
  record N6 PASS "alerts with a wrong CA never connects (it logs and retries): $(printf '%s\n' "$n6_log" | grep 'SSLCertVerificationError' | head -n 1 | cut -c1-160)"
else
  record N6 FAIL "alerts with a wrong CA: verification error logged: $n6_seen; $(last_line "$n6_log")"
fi

# --- N7: A3 (db down -> api not ready) and E1 (restart on the volume with the entrypoint replaced) --------------------------------------
docker stop -t 10 "$tag-pg" >/dev/null
a3_notready=false
for _ in $(seq 1 10); do
  if ! py_get "$tag-api" 'http://127.0.0.1:8000/api/v1/health/ready'; then
    a3_notready=true
    break
  fi
  sleep 2
done
docker rm -f "$tag-pg" >/dev/null
docker run -d --pull never --name "$tag-pg" --label "$label" --network "$net" --network-alias sb-pg-test --network-alias sb-pg-alt \
  --env-file "$ex_win/sb-pg.env" -v "$vol:/var/lib/postgresql" --entrypoint "" "$pg_image" sh -c "$(pg_script)" >/dev/null
if wait_pg; then
  run_once "$api_image" "$ex_win/sb-api.env" "$none_win" "$tmp/ex/sb-api.pre.cmd"
  if [ "$a3_notready" = true ] && [ "$run_rc" -eq 0 ]; then
    record N7 PASS "api not ready while the database was down; the database restarted on the same volume with the image entrypoint replaced and the pre-deploy still passes under verify-full"
  else
    record N7 FAIL "api not-ready with db down: $a3_notready; pre-deploy after restart rc=$run_rc: $(last_line "$run_out")"
  fi
else
  docker logs --tail 15 "$tag-pg" 2>&1 | mask >&2 || true
  record N7 FAIL "the database did not come back on the same volume with the entrypoint replaced (api not-ready with db down: $a3_notready)"
fi

if [ "$failures" -eq 0 ]; then
  printf 'ALL CHECKS PASSED (UNVERIFIED on Render itself: see the header of this file and infra/render/README.md)\n'
else
  printf '%s CHECK(S) FAILED\n' "$failures"
  exit 1
fi
