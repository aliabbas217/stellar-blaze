#!/usr/bin/env bash
# The local PRODUCTION REHEARSAL: runs the real images the way the Azure deploy runs them, as far as that is possible
# without Azure, checks it, and tears it down. See infra/local/compose.yaml for what is and is not rehearsed.
#
#   bash infra/local/rehearse.sh [--keep]
#   SB_REHEARSAL_PORT=18080 bash infra/local/rehearse.sh      (when 127.0.0.1:8080 belongs to something else)
#
#   --keep   leave the stack running and the scratch directory (which holds the generated keys and tokens) in place,
#            and print how to remove them. Default: tear everything down and delete the scratch directory.
#
# What it does: generates every secret, a throwaway CA and a server certificate for the host name `db` (gen-db-certs.sh), a
# second unrelated CA, the HBA file and (when the api image can make one) a VAPID key pair, all in a `mktemp -d` directory
# outside the repository; builds and starts the stack (compose.yaml; the first build of the web image can take ten minutes,
# the api image is 1.8 GB on disk); then prints one line per check.
#   R1  the migrate job exited 0                       R2  its log shows the revision and the demo site
#   R3  api healthy, alerts running and dispatching    R4  infra/scripts/smoke-http.sh passes entirely against the proxy
#   R5  infra/scripts/reset-demo.sh through the proxy: 2xx and a NEW epoch (epoch_id above previous_epoch_id). It runs BEFORE the
#       smoke test (H6 drains the BFF general bucket that a reset draws on) and is reported after R4. SKIP when the route
#       answers 404 or 501 (a backend that predates it).
#   R6  a restart of the api does not rewind the replay clock (ADR 0034 amendment of 2026-11-15: the clock counts from the epoch
#       row in Postgres): the replay "now" is read through the BFF (a stop, undone at once, as smoke H3 and H4 do) when the epoch
#       is at least 90 s old, the api container is restarted, and the second reading must be at or after the first and less
#       than 10 minutes later. A backend that predates the epoch clock rewinds to the anchor, so it is detected first (the api
#       image has no stellar_blaze.ports.replay_epoch) and R6 is SKIPPED with that reason, never passed.
#   N1..N6 are NEGATIVE checks: each states a behaviour that must hold, and the check FAILs if it does not.
#     N1  a plaintext database connection is refused
#     N2  verify-full with an unrelated CA fails closed
#     N3  verify-full with the right CA but a host name that is not in the certificate fails
#     N4  verify-full with PGSSLROOTCERT unset fails closed
#     N5  ssl=require CONNECTS even to an impostor (wrong CA, wrong name): why ssl=require is forbidden (ADR 0042)
#     N6  web reached directly with forged X-Forwarded-For values evades the per-client bucket, while through the proxy it
#         does not: why the proxy hop count matters (TRUSTED_PROXY_HOPS)
#     N7  (extra) ssl=require WITH PGSSLROOTCERT set acts as verify-ca, not as no verification: a finding for ADR 0042
# Each check prints PASS, FAIL or SKIP (a check that cannot apply to this tree and says why). Exit status: 0 only if no check
# FAILed; a SKIP is listed in the summary and counted apart, never as a pass. The run takes roughly 5 to 7 minutes warm (the smoke
# script waits 62 s for the rate-limit window, R6 waits for the epoch to age), longer when an image has to be built.
# The images are tagged stellar-blaze-{api,web}:rehearsal (override: SB_API_IMAGE, SB_WEB_IMAGE) and `docker compose build` always
# rebuilds them from the tree this script sits in, so a run never uses an image of another tree.
set -euo pipefail

keep=false
case "${1:-}" in
  "") ;;
  --keep) keep=true ;;
  *)
    printf 'usage: %s [--keep]\n' "$(basename -- "$0")" >&2
    exit 2
    ;;
esac

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo="$(cd -- "$here/../.." && pwd -P)"
compose="$here/compose.yaml"
scripts="$repo/infra/scripts"

die() {
  printf 'rehearse: %s\n' "$*" >&2
  exit 1
}

# Native Windows programs (docker) need C:/... paths; Git Bash's /tmp/... is not one. A no-op elsewhere.
win_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

# --- (a) preconditions -----------------------------------------------------------------------------------------------
for tool in docker openssl curl; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed or not on PATH"
done
docker compose version >/dev/null 2>&1 || die "docker compose (v2) is not available"
docker info >/dev/null 2>&1 || die "the docker daemon is not reachable"
# The proxy is published on 127.0.0.1:${SB_REHEARSAL_PORT:-8080}. Another project may own 8080: set SB_REHEARSAL_PORT.
port="${SB_REHEARSAL_PORT:-8080}"
[[ "$port" =~ ^[0-9]{2,5}$ ]] || die "SB_REHEARSAL_PORT must be a port number, got '$port'"
export SB_PROXY_PORT="$port"
base_url="http://127.0.0.1:$port"
if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
  die "port $port on 127.0.0.1 is already in use; the proxy needs it (choose another with SB_REHEARSAL_PORT=<port>)"
fi
leftover="$(docker ps -a --filter label=com.docker.compose.project=sb-local --format '{{.Names}}' | head -n 1)"
[ -z "$leftover" ] || die "a container of the sb-local project already exists ($leftover); remove it with: docker compose -p sb-local down -v --remove-orphans"

# --- (b) scratch directory -------------------------------------------------------------------------------------------
tmp="$(mktemp -d)"
chmod 700 "$tmp"
tmp_win="$(win_path "$tmp")"
envfile="$tmp/env"

# Windows-style paths so that dc behaves the same with MSYS_NO_PATHCONV=1 (which stops Git Bash rewriting arguments).
compose_win="$(win_path "$compose")"
envfile_win="$(win_path "$envfile")"
dc() {
  docker compose -f "$compose_win" --env-file "$envfile_win" "$@"
}

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$keep" = true ]; then
    printf '\n--keep: the stack is still running on %s and %s holds its secrets.\n' "$base_url" "$tmp"
    printf 'To remove both: docker compose -f %s --env-file %s down -v --remove-orphans && rm -rf %s\n' "$compose" "$envfile" "$tmp"
  else
    if [ -f "$envfile" ]; then
      dc down -v --remove-orphans >/dev/null 2>&1 || true
    fi
    rm -rf -- "$tmp"
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# --- results ---------------------------------------------------------------------------------------------------------
ids=()
verdicts=()
whats=()
failures=0

skips=0

record() { # <id> <PASS|FAIL|SKIP> <what>
  ids+=("$1")
  verdicts+=("$2")
  whats+=("$3")
  printf '%s %s %s\n' "$2" "$1" "$3"
  case "$2" in
    FAIL) failures=$((failures + 1)) ;;
    SKIP) skips=$((skips + 1)) ;;
    *) ;;
  esac
}

# mask: hide the generated password in anything printed.
pg_password=""
mask() { sed "s/${pg_password:-NOPASSWORD}/***/g"; }

# --- (c) secrets, certificates, config ---------------------------------------------------------------------------------
printf 'Generating secrets and certificates in a scratch directory (removed on exit)\n'
demo_token="$(openssl rand -hex 32)"
token_sha="$(printf '%s' "$demo_token" | openssl dgst -sha256 | sed 's/^.* //')"
pg_password="$(openssl rand -hex 32)"
access_tokens="{\"$token_sha\": {\"actor\": \"demo-bff\", \"role\": \"employer\", \"employer_id\": \"emp-demo\"}}"

bash "$scripts/gen-db-certs.sh" --san db --out "$tmp/pki" >/dev/null
bash "$scripts/gen-db-certs.sh" --san db --out "$tmp/pki-unrelated" >/dev/null
printf 'database certificate: %s\n' "$(openssl x509 -in "$tmp/pki/server.crt" -noout -subject -enddate | tr '\n' ' ')"

mkdir -p "$tmp/db" "$tmp/ca" "$tmp/unrelated-ca"
cp "$tmp/pki/server.crt" "$tmp/pki/server.key" "$tmp/db/"
cp "$tmp/pki/ca.crt" "$tmp/ca/ca.crt"
cp "$tmp/pki-unrelated/ca.crt" "$tmp/unrelated-ca/ca.crt"
printf '%s\n' \
  '# Local socket for the healthchecks; TLS with a password over TCP; no plaintext TCP rule at all.' \
  'local all all trust' \
  'hostssl all all all scram-sha-256' >"$tmp/db/pg_hba.conf"
chmod 644 "$tmp/db/pg_hba.conf"
chmod 755 "$tmp/db" "$tmp/ca" "$tmp/unrelated-ca"

{
  printf 'SB_REHEARSAL_DIR=%s\n' "$tmp_win"
  printf 'PG_PASSWORD=%s\n' "$pg_password"
  printf 'DEMO_EMPLOYER_TOKEN=%s\n' "$demo_token"
  printf "SB_ACCESS_TOKENS='%s'\n" "$access_tokens"
} >"$envfile"
chmod 600 "$envfile"

# --- (d) build, then the VAPID pair, then start ----------------------------------------------------------------------
printf 'Building images (cached builds are quick; a cold web build can take ten minutes)\n'
if ! dc build >"$tmp/build.log" 2>&1; then
  tail -n 40 "$tmp/build.log" | mask >&2
  die "docker compose build failed"
fi

api_image="${SB_API_IMAGE:-stellar-blaze-api:rehearsal}"
vapid_code='
import base64
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def public_of(vapid) -> str:
    return b64u(vapid.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))


vapid = Vapid02()
vapid.generate_keys()
private = b64u(vapid.private_key.private_numbers().private_value.to_bytes(32, "big"))
# The backend loads the private key with Vapid.from_string: prove the pair round-trips before it is used.
assert public_of(Vapid02.from_string(private)) == public_of(vapid)
print(private)
print(public_of(vapid))
'
vapid_out=""
if vapid_out="$(MSYS_NO_PATHCONV=1 docker run --rm --pull never --entrypoint python "$api_image" -c "$vapid_code" 2>/dev/null)" && [ "$(printf '%s\n' "$vapid_out" | wc -l)" -eq 2 ]; then
  vapid_private="$(printf '%s\n' "$vapid_out" | sed -n '1p')"
  vapid_public="$(printf '%s\n' "$vapid_out" | sed -n '2p')"
  printf 'SB_VAPID_PRIVATE_KEY=%s\nSB_VAPID_SUBJECT=%s\n' "$vapid_private" 'mailto:rehearsal@example.org' >"$tmp/vapid.env"
  chmod 644 "$tmp/vapid.env"
  printf 'VAPID_PUBLIC_KEY=%s\n' "$vapid_public" >>"$envfile"
  push_note="a VAPID key pair was generated with the api image's py_vapid: push is configured on alerts (subject mailto:rehearsal@example.org)"
else
  push_note="no VAPID key pair could be generated: push is NOT configured (events are recorded, nothing is sent)"
fi
printf '%s\n' "$push_note"

printf 'Starting the stack: db, migrate, api and alerts, web, proxy (waits for every health check)\n'
if ! dc up -d --wait --wait-timeout 600 >"$tmp/up.log" 2>&1; then
  tail -n 30 "$tmp/up.log" | mask >&2
  printf -- '--- docker compose ps -a\n' >&2
  dc ps -a >&2 || true
  for service in migrate api alerts web; do
    printf -- '--- last log lines of %s\n' "$service" >&2
    dc logs --no-log-prefix --tail 20 "$service" 2>&1 | mask >&2 || true
  done
  die "the stack did not become healthy"
fi

container_of() { dc ps -a -q "$1" | head -n 1; }

# --- (e) checks ------------------------------------------------------------------------------------------------------
migrate_id="$(container_of migrate)"
migrate_state="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$migrate_id")"
if [ "$migrate_state" = "exited 0" ]; then
  record R1 PASS "migrate exited 0 (db upgrade, then site load, under ssl=verify-full)"
else
  record R1 FAIL "migrate is '$migrate_state', expected 'exited 0'"
fi

migrate_log="$(dc logs --no-log-prefix migrate 2>&1 | mask)"
revision="$(printf '%s\n' "$migrate_log" | sed -n 's/.*"revision": *"\([^"]*\)".*/\1/p' | tail -n 1)"
if [ -n "$revision" ] && printf '%s\n' "$migrate_log" | grep -q 'site-demo-mussafah'; then
  record R2 PASS "migrate log shows revision $revision and site-demo-mussafah"
else
  record R2 FAIL "migrate log lacks the revision ('$revision') or site-demo-mussafah"
fi

api_health="$(docker inspect -f '{{.State.Health.Status}}' "$(container_of api)")"
alerts_id="$(container_of alerts)"
alerts_state="$(docker inspect -f '{{.State.Status}} restarts={{.RestartCount}}' "$alerts_id")"
# The alerts loop dispatches once at start and then every few minutes; each site of a cycle is a job_run that logs
# `job.succeeded` (jobs/runner.py). Poll for it for up to 90 s.
alerts_cycle=false
for _ in $(seq 1 18); do
  if dc logs --no-log-prefix alerts 2>&1 | grep -q 'job\.succeeded'; then
    alerts_cycle=true
    break
  fi
  sleep 5
done
if [ "$api_health" = healthy ] && [ "$alerts_state" = "running restarts=0" ] && [ "$alerts_cycle" = true ]; then
  record R3 PASS "api healthy; alerts $alerts_state and logged a dispatch cycle (job.succeeded)"
else
  record R3 FAIL "api health '$api_health'; alerts '$alerts_state'; alerts dispatch cycle logged: $alerts_cycle"
fi

# R5 runs BEFORE the smoke test and is recorded after R4: a demo reset draws on the BFF general bucket, which smoke H6 drains
# for 61 s, and the upstream allows one reset per 60 s. Its verdict is decided here and recorded below, so the table keeps the
# order R1 R2 R3 R4 R5 R6.
printf 'Resetting the demo through the proxy (R5, before the smoke test: its H6 drains the rate-limit bucket)\n'
reset_rc=0
reset_out="$(bash "$scripts/reset-demo.sh" "$base_url" 2>&1)" || reset_rc=$?
printf '%s\n' "$reset_out" | sed 's/^/    | /'
reset_epochs="$(printf '%s\n' "$reset_out" | sed -n 's/^PASS D1 demo reset: epoch \([0-9][0-9]*\) -> \([0-9][0-9]*\)$/\1 \2/p' | head -n 1)"
reset_previous="${reset_epochs%% *}"
reset_new="${reset_epochs##* }"
reset_status="$(printf '%s\n' "$reset_out" | sed -n 's/^FAIL D1 demo reset: answered \([0-9][0-9][0-9]\).*/\1/p' | head -n 1)"
if [ "$reset_rc" -eq 0 ] && [ -n "$reset_epochs" ] && [ "$reset_new" -gt "$reset_previous" ]; then
  r5_verdict=PASS
  r5_what="demo reset through the proxy with no Authorization header: epoch $reset_previous -> $reset_new"
elif [ "$reset_status" = 404 ] || [ "$reset_status" = 501 ]; then
  r5_verdict=SKIP
  r5_what="demo-reset answered $reset_status: this backend or web predates the route ($(printf '%s' "$reset_out" | tail -n 1 | cut -c1-200))"
else
  r5_verdict=FAIL
  r5_what="demo reset: exit $reset_rc, epochs '${reset_epochs:-none}' (a PASS needs epoch_id above previous_epoch_id): $(printf '%s' "$reset_out" | tail -n 1 | cut -c1-200)"
fi

printf 'Running the HTTP smoke test against %s (takes about 70 s: H6 drains a rate-limit window)\n' "$base_url"
smoke_rc=0
bash "$scripts/smoke-http.sh" "$base_url" --wait >"$tmp/smoke.out" 2>&1 || smoke_rc=$?
sed 's/^/    | /' "$tmp/smoke.out"
smoke_passes="$(grep -c '^PASS H' "$tmp/smoke.out" || true)"
if [ "$smoke_rc" -eq 0 ] && [ "$smoke_passes" -eq 6 ] && grep -q '^SKIP H5' "$tmp/smoke.out"; then
  record R4 PASS "smoke test: H1 H2 H3 H4 H6 H7 passed, H5 skipped (needs https)"
else
  record R4 FAIL "smoke test exit $smoke_rc with $smoke_passes of 6 expected passes"
fi
proxied_first_429="$(sed -n 's/.* at request \([0-9][0-9]*\) of 30.*/\1/p' "$tmp/smoke.out" | head -n 1)"

record R5 "$r5_verdict" "$r5_what"

# R6: a restart of the api does not rewind the replay clock. Only on a backend that has the epoch clock (ADR 0034 amendment of
# 2026-11-15): the older process-start clock restarts at SB_REPLAY_NOW with the process, so there the check would FAIL for a
# reason that is the old design, not a defect. Support is detected from the image just built, not assumed.
replay_anchor="$(sed -n 's/^ *SB_REPLAY_NOW: *"\(.*\)" *$/\1/p' "$compose" | head -n 1)"
[ -n "$replay_anchor" ] || die "cannot read SB_REPLAY_NOW from $compose"
anchor_s="$(date -u -d "$replay_anchor" +%s)"

# read_replay_now: the replay "now" as the api sees it, through the BFF with no Authorization header of our own: create a stop
# and undo it at once (inside the 10 s undo window, as smoke H3 and H4 do); started_at of the stop is the replay clock. Sets
# replay_iso and replay_s (epoch seconds); returns 1 when it could not be read.
replay_iso=""
replay_s=0
read_replay_now() {
  local code stop_id started
  replay_iso=""
  code="$(curl -sS --max-time 20 -X POST -H 'Content-Type: application/json' --data '{"reason_code":"other"}' -o "$tmp/stop.json" -w '%{http_code}' "$base_url/api/v1/crews/crew-b/stops" 2>/dev/null)" || return 1
  [ "$code" = 201 ] || return 1
  stop_id="$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp/stop.json" | head -n 1)"
  started="$(sed -n 's/.*"started_at"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp/stop.json" | head -n 1)"
  [ -n "$stop_id" ] && [ -n "$started" ] || return 1
  code="$(curl -sS --max-time 20 -X DELETE -o /dev/null -w '%{http_code}' "$base_url/api/v1/crews/crew-b/stops/$stop_id" 2>/dev/null)" || return 1
  [ "$code" = 204 ] || return 1
  replay_s="$(date -u -d "$started" +%s)" || return 1
  replay_iso="$started"
}

# read_replay_now_retry: read_replay_now, up to 12 tries 5 s apart (web needs a moment to reach a restarted api).
read_replay_now_retry() {
  for _ in $(seq 1 12); do
    if read_replay_now; then return 0; fi
    sleep 5
  done
  return 1
}

if docker run --rm --pull never --entrypoint python "$api_image" -c 'import stellar_blaze.ports.replay_epoch' >/dev/null 2>&1; then
  printf 'Restarting the api and reading the replay clock around it (R6)\n'
  r6_error=""
  clock_before=""
  clock_before_s=0
  if ! read_replay_now_retry; then
    r6_error="the replay clock could not be read through the BFF before the restart"
  else
    # The epoch must be old enough (90 s) for a rewind to the anchor to show: the replay clock reads anchor + epoch age.
    epoch_age=$((replay_s - anchor_s))
    if [ "$epoch_age" -lt 90 ]; then
      sleep $((90 - epoch_age + 1))
      read_replay_now_retry || r6_error="the replay clock could not be read through the BFF before the restart (second try)"
    fi
    clock_before="$replay_iso"
    clock_before_s="$replay_s"
  fi
  if [ -z "$r6_error" ]; then
    dc restart api >"$tmp/restart-api.log" 2>&1 || r6_error="docker compose restart api failed: $(tail -n 3 "$tmp/restart-api.log" | mask | tr '\n' ' ')"
  fi
  if [ -z "$r6_error" ]; then
    api_cid="$(container_of api)"
    r6_healthy=false
    for _ in $(seq 1 60); do
      if [ "$(docker inspect -f '{{.State.Health.Status}}' "$api_cid")" = healthy ]; then
        r6_healthy=true
        break
      fi
      sleep 2
    done
    [ "$r6_healthy" = true ] || r6_error="the api was not healthy 120 s after its restart"
  fi
  if [ -z "$r6_error" ] && ! read_replay_now_retry; then
    r6_error="the replay clock could not be read through the BFF after the restart"
  fi
  if [ -n "$r6_error" ]; then
    record R6 FAIL "$r6_error"
  else
    r6_delta=$((replay_s - clock_before_s))
    if [ "$r6_delta" -ge 0 ] && [ "$r6_delta" -lt 600 ]; then
      record R6 PASS "a restart of the api did not rewind the replay clock: $clock_before, then $replay_iso (+${r6_delta}s across the restart)"
    else
      record R6 FAIL "the replay clock read $clock_before before the api restart and $replay_iso after (${r6_delta}s; it must be 0 to 599 s later)"
    fi
  fi
else
  record R6 SKIP "backend predates the epoch clock (ADR 0034 amendment): the image has no stellar_blaze.ports.replay_epoch"
fi

# --- (f) negative checks ---------------------------------------------------------------------------------------------
migrate_cmd='sb-jobs db upgrade && sb-jobs site load fixtures/demo_site.toml --actor "deploy:local" --reason "load the synthetic demo site (rehearsal)"'
unrelated_mount="$tmp_win/unrelated-ca:/tls-unrelated:ro"
db_url_base="postgresql+asyncpg://sbadmin:${pg_password}@"
db_url_tail=":5432/stellar_blaze"

# run_migrate <docker compose run options...> -- <shell command>: a one-off migrate container with overrides and its own
# command; sets run_rc and run_out (masked).
run_rc=0
run_out=""
run_migrate() {
  local args=() command
  while [ "$1" != "--" ]; do
    args+=("$1")
    shift
  done
  shift
  command="$1"
  run_rc=0
  MSYS_NO_PATHCONV=1 dc run --rm --no-deps -T "${args[@]}" migrate /bin/sh -c "$command" >"$tmp/run.out" 2>&1 || run_rc=$?
  run_out="$(mask <"$tmp/run.out")"
}
# last_line <text>: the most telling line of a failed run: the last one that names an error, else the last non-empty one.
last_line() {
  local picked
  picked="$(printf '%s\n' "$1" | grep -Ei 'migration failed|FATAL' | tail -n 1)"
  [ -n "$picked" ] || picked="$(printf '%s\n' "$1" | grep -Ei 'error' | tail -n 1)"
  [ -n "$picked" ] || picked="$(printf '%s\n' "$1" | grep -v '^[[:space:]]*$' | tail -n 1)"
  printf '%s' "$picked" | cut -c1-260
}

# N1: plaintext to the database is refused. The control (sslmode=require connects) shows the refusal is about TLS only.
n1_ctl_rc=0
PGPASSWORD="$pg_password" dc exec -T -e PGPASSWORD db psql "host=127.0.0.1 dbname=stellar_blaze user=sbadmin sslmode=require connect_timeout=5" -Atc 'select 1' >/dev/null 2>&1 || n1_ctl_rc=$?
n1_rc=0
PGPASSWORD="$pg_password" dc exec -T -e PGPASSWORD db psql "host=127.0.0.1 dbname=stellar_blaze user=sbadmin sslmode=disable connect_timeout=5" -Atc 'select 1' >"$tmp/n1.out" 2>&1 || n1_rc=$?
n1_out="$(mask <"$tmp/n1.out")"
if [ "$n1_ctl_rc" -eq 0 ] && [ "$n1_rc" -ne 0 ] && printf '%s' "$n1_out" | grep -Eqi 'no encryption|SSL (off|required)|rejects connection'; then
  record N1 PASS "plaintext TCP refused (control: sslmode=require connects): $(last_line "$n1_out")"
else
  record N1 FAIL "plaintext to the database: control rc=$n1_ctl_rc, plaintext rc=$n1_rc: $(last_line "$n1_out")"
fi

# N2: the right host name, but an unrelated CA.
run_migrate -v "$unrelated_mount" -e PGSSLROOTCERT=/tls-unrelated/ca.crt -- "$migrate_cmd"
if [ "$run_rc" -ne 0 ] && printf '%s' "$run_out" | grep -Eqi 'verify|certificate'; then
  record N2 PASS "verify-full with an unrelated CA fails closed (exit $run_rc): $(last_line "$run_out")"
else
  record N2 FAIL "unrelated CA: expected a non-zero exit with a verify error, got exit $run_rc: $(last_line "$run_out")"
fi

# N3: the right CA, but through a name that is not in the certificate (db-alt, a second network alias of the database).
SB_DATABASE_URL="${db_url_base}db-alt${db_url_tail}?ssl=verify-full" \
  run_migrate -e SB_DATABASE_URL -- "$migrate_cmd"
if [ "$run_rc" -ne 0 ] && printf '%s' "$run_out" | grep -Eqi 'host ?name|not valid for|does not match|verify|certificate'; then
  record N3 PASS "verify-full via a name outside the certificate fails (exit $run_rc): $(last_line "$run_out")"
else
  record N3 FAIL "host name mismatch: expected a non-zero exit with a name or verify error, got exit $run_rc: $(last_line "$run_out")"
fi

# N4: no root certificate at all.
run_migrate -- "unset PGSSLROOTCERT; $migrate_cmd"
if [ "$run_rc" -ne 0 ] && printf '%s' "$run_out" | grep -Eqi 'root certificate|ClientConfigurationError|verify|certificate'; then
  record N4 PASS "verify-full with PGSSLROOTCERT unset fails closed (exit $run_rc): $(last_line "$run_out")"
else
  record N4 FAIL "no root certificate: expected a non-zero exit with a certificate error, got exit $run_rc: $(last_line "$run_out")"
fi

# N5: ssl=require with NO root certificate (the case ADR 0042 probed) accepts a server that is not the one asked for: here
# a name that is not in the certificate. The connection is encrypted and nothing is authenticated.
SB_DATABASE_URL="${db_url_base}db-alt${db_url_tail}?ssl=require" \
  run_migrate -e SB_DATABASE_URL -- "unset PGSSLROOTCERT; $migrate_cmd"
if [ "$run_rc" -eq 0 ]; then
  record N5 PASS "ssl=require CONNECTED through a name outside the certificate: encryption without authentication, which is why ssl=require is forbidden (ADR 0042)"
else
  record N5 FAIL "ssl=require was expected to connect (that is the hazard); got exit $run_rc: $(last_line "$run_out")"
fi

# N7 (characterization, not in the brief): the same ssl=require WITH PGSSLROOTCERT set, which is how the deploy runs. asyncpg
# then behaves like libpq: a root file that exists turns `require` into chain verification (verify-ca), so an unrelated CA
# fails, while the right CA still accepts a wrong host name. It is a finding for ADR 0042, not a reason to allow `require`.
SB_DATABASE_URL="${db_url_base}db-alt${db_url_tail}?ssl=require" \
  run_migrate -v "$unrelated_mount" -e SB_DATABASE_URL -e PGSSLROOTCERT=/tls-unrelated/ca.crt -- "$migrate_cmd"
n7_unrelated_rc=$run_rc
n7_unrelated_out="$run_out"
SB_DATABASE_URL="${db_url_base}db-alt${db_url_tail}?ssl=require" \
  run_migrate -e SB_DATABASE_URL -- "$migrate_cmd"
n7_right_rc=$run_rc
if [ "$n7_unrelated_rc" -ne 0 ] && printf '%s' "$n7_unrelated_out" | grep -Eqi 'verify|certificate' && [ "$n7_right_rc" -eq 0 ]; then
  record N7 PASS "ssl=require with PGSSLROOTCERT set acts as verify-ca: an unrelated CA fails, the right CA connects through the wrong host name"
else
  record N7 FAIL "ssl=require with a root file: unrelated CA exit $n7_unrelated_rc ($(last_line "$n7_unrelated_out")), right CA through a wrong name exit $n7_right_rc"
fi

# N6: web reached directly (from inside its own container, no proxy) with forged X-Forwarded-For values. 41 requests with
# 41 different left entries are 41 different clients, so only the global limit (40) can stop the 41st; through the proxy the
# appended rightmost entry is one client and the per-client limit (20) stops request 21 (H6 above). Nothing else touched
# the general bucket for the last 62 s, because the smoke test waited.
probe='
(async () => {
  let first = 0;
  for (let i = 1; i <= 41; i += 1) {
    const response = await fetch("http://127.0.0.1:3000/api/v1/crews/crew-b/day-plan", {
      headers: { "x-forwarded-for": "203.0.113." + i },
    });
    if (response.status === 429 && first === 0) first = i;
  }
  console.log("FIRST_429=" + first);
})();
'
n6_rc=0
n6_out="$(dc exec -T web node -e "$probe" 2>&1)" || n6_rc=$?
direct_first_429="$(printf '%s\n' "$n6_out" | sed -n 's/^FIRST_429=//p' | head -n 1)"
if [ "$n6_rc" -eq 0 ] && [ -n "$direct_first_429" ] && { [ "$direct_first_429" -eq 0 ] || [ "$direct_first_429" -ge 41 ]; } && [ -n "$proxied_first_429" ] && [ "$proxied_first_429" -le 30 ]; then
  record N6 PASS "directly at web the forged header evades the per-client limit (first 429: ${direct_first_429/#0/none}, only the global limit at 41); through the proxy the first 429 was request $proxied_first_429"
else
  record N6 FAIL "direct probe rc=$n6_rc first 429 '$direct_first_429' (needs none or >= 41); through the proxy '$proxied_first_429' (needs <= 30): $(last_line "$n6_out")"
fi

# --- summary ---------------------------------------------------------------------------------------------------------
printf '\n%s\n' "$push_note"
printf '\n%-4s %-5s %s\n' ID RESULT CHECK
for index in "${!ids[@]}"; do
  printf '%-4s %-5s %s\n' "${ids[$index]}" "${verdicts[$index]}" "${whats[$index]}"
done
if [ "$failures" -gt 0 ]; then
  printf '\nREHEARSAL FAILED: %s check(s) failed\n' "$failures"
  exit 1
fi
if [ "$skips" -gt 0 ]; then
  skipped_ids=()
  for index in "${!ids[@]}"; do
    if [ "${verdicts[$index]}" = SKIP ]; then skipped_ids+=("${ids[$index]}"); fi
  done
  printf '\nREHEARSAL OK: %s checks passed, %s SKIPPED (%s): a skipped check is not a pass\n' "$((${#ids[@]} - skips))" "$skips" "${skipped_ids[*]}"
else
  printf '\nREHEARSAL OK: %s checks passed, none skipped\n' "${#ids[@]}"
fi
