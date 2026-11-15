#!/usr/bin/env bash
# Self-tests for the infra scripts, with `az` and `curl` replaced by stubs. Run from anywhere:
#   bash infra/scripts/tests/run.sh                  every test (about 6 minutes: the template tests call bicep many times)
#   bash infra/scripts/tests/run.sh --fast           skips every test that needs bicep (template and db-tls --template tests)
#   bash infra/scripts/tests/run.sh <name part>      only the tests whose name contains it, for example
#                                                    run_migrate, healthcheck, smoke, smoke_http, restart_apps, reset_demo,
#                                                    measure_cold_start, resolve_image; --fast and a name part can be combined
# Works under Git Bash and on Ubuntu CI. It does not rely on the executable bit: the stubs are
# committed without it, so the harness runs copies of them that it makes executable.
# One function per case; the first failing assertion stops the run with a non-zero exit.
# Each test gets its own STUB_STATE_DIR; the az stub records every call in $STUB_STATE_DIR/az.log and the curl stub in curl.log.

set -euo pipefail

tests_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scripts_dir="$(cd "$tests_dir/.." && pwd)"
stubs_dir="$tests_dir/stubs"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
bin="$work/bin"
mkdir -p "$bin"

for tool in az curl docker; do
  # A copy made executable here (one process start per call, not two as with a wrapper that execs bash <stub>: under Git Bash
  # a process start costs about 0.1 s and the smoke tests make a few dozen az calls each).
  cp "$stubs_dir/$tool" "$bin/$tool"
  chmod +x "$bin/$tool"
done
real_path="$PATH" # without the stubs: the few tests that need the real docker use it
export PATH="$bin:$PATH"

# shellcheck source=infra/scripts/lib.sh
. "$scripts_dir/lib.sh"
repo_bicep_dir="$(cd "$scripts_dir/../bicep" && pwd)"

# ---- helpers ------------------------------------------------------------------------------------

current_test=""
out=""
err=""
rc=0

fail() {
  printf 'FAIL %s: %s\n' "$current_test" "$*" >&2
  if [ -n "$out" ]; then printf -- '--- stdout ---\n%s\n' "$out" >&2; fi
  if [ -n "$err" ]; then printf -- '--- stderr ---\n%s\n' "$err" >&2; fi
  exit 1
}

# run_cmd <cmd...>: run a command, capture stdout, stderr and the exit status without tripping set -e.
run_cmd() {
  rc=0
  "$@" >"$work/out" 2>"$work/err" || rc=$?
  out="$(cat "$work/out")"
  err="$(cat "$work/err")"
}

# run_preflight <scenario> [args...]
run_preflight() {
  local scenario="$1"
  shift
  STUB_SCENARIO="$scenario" run_cmd bash "$scripts_dir/preflight.sh" "$@"
}

assert_rc() {
  [ "$rc" -eq "$1" ] || fail "expected exit $1, got $rc"
}

assert_out_has() {
  case "$out" in *"$1"*) ;; *) fail "stdout does not contain: $1" ;; esac
}

assert_out_lacks() {
  case "$out" in *"$1"*) fail "stdout unexpectedly contains: $1" ;; *) ;; esac
}

assert_err_has() {
  case "$err" in *"$1"*) ;; *) fail "stderr does not contain: $1" ;; esac
}

# ---- preflight ----------------------------------------------------------------------------------

test_preflight_passes_on_happy_stub() {
  run_preflight ok
  assert_rc 0
  assert_out_has "PASS P1"
  assert_out_has "PASS P2"
  assert_out_has "PASS P3 provider Microsoft.Consumption"
  assert_out_has "PASS P4"
  assert_out_lacks "FAIL"
  assert_out_has "POSTGRES_VERSION=18"
}

test_preflight_picks_17_when_18_absent() {
  run_preflight pg17
  assert_rc 0
  assert_out_has "POSTGRES_VERSION=17"
  assert_err_has "WARN could not confirm PostgreSQL 18; using 17"
}

test_preflight_matches_short_location_name() {
  run_preflight p1_compact
  assert_rc 0
  assert_out_has "PASS P1"
}

test_preflight_accepts_display_name_argument() {
  run_preflight ok --location "UAE North"
  assert_rc 0
  assert_out_has "PASS P1"
}

test_preflight_fails_p1_when_location_missing() {
  run_preflight nolocation
  assert_rc 1
  assert_out_has "FAIL P1"
}

test_preflight_fails_p1_for_other_location() {
  run_preflight ok --location northeurope
  assert_rc 1
  assert_out_has "FAIL P1"
}

test_preflight_fails_p2_when_no_b1ms() {
  run_preflight nob1ms
  assert_rc 1
  assert_out_has "FAIL P2"
  assert_out_lacks "POSTGRES_VERSION"
}

test_preflight_fails_p3_when_provider_not_registered() {
  run_preflight noreg
  assert_rc 1
  assert_out_has "FAIL P3 provider Microsoft.Consumption"
  assert_out_has "PASS P3 provider Microsoft.App"
}

test_preflight_fails_p4_when_not_owner() {
  run_preflight noowner
  assert_rc 1
  assert_out_has "FAIL P4"
  assert_err_has "portal"
}

test_preflight_rejects_unknown_argument() {
  run_preflight ok --bogus
  assert_rc 1
  assert_err_has "unknown argument"
}

# ---- lib.sh -------------------------------------------------------------------------------------

# lib_run <bash code>: run code with lib.sh sourced, in a fresh bash (so `set -e` is in force).
lib_run() {
  # shellcheck disable=SC2016  # the single-quoted program is meant to expand in the child bash
  run_cmd bash -euo pipefail -c '. "$1"; shift; eval "$1"' _ "$scripts_dir/lib.sh" "$1"
}

make_flaky() {
  # flaky.sh <counter-file> <succeed-on-attempt>
  cat >"$work/flaky.sh" <<'EOF'
n=0
[ -f "$1" ] && n="$(cat "$1")"
n=$((n + 1))
printf '%s' "$n" >"$1"
[ "$n" -ge "$2" ]
EOF
  rm -f "$work/counter"
}

test_retry_succeeds_after_failures() {
  make_flaky
  lib_run "retry 5 0 bash '$work/flaky.sh' '$work/counter' 3"
  assert_rc 0
  [ "$(cat "$work/counter")" = "3" ] || fail "expected 3 attempts, saw $(cat "$work/counter")"
}

test_retry_gives_up_and_returns_failure() {
  make_flaky
  lib_run "retry 2 0 bash '$work/flaky.sh' '$work/counter' 9"
  assert_rc 1
  [ "$(cat "$work/counter")" = "2" ] || fail "expected 2 attempts, saw $(cat "$work/counter")"
}

test_require_env_names_every_missing_variable() {
  lib_run "SB_PRESENT=x; export SB_PRESENT; require_env SB_PRESENT SB_MISSING_ONE SB_MISSING_TWO"
  assert_rc 1
  assert_err_has "SB_MISSING_ONE SB_MISSING_TWO"
  case "$err" in *SB_PRESENT*) fail "reported a variable that is set" ;; *) ;; esac
}

test_require_env_passes_when_all_set() {
  lib_run "SB_A=1; SB_B=2; export SB_A SB_B; require_env SB_A SB_B"
  assert_rc 0
}

test_die_exits_1_with_message() {
  lib_run "die boom"
  assert_rc 1
  assert_err_has "ERROR: boom"
}

test_bicep_build_prefers_bicep_bin() {
  printf '#!/usr/bin/env bash\nprintf "bicep-bin %%s\\n" "$*"\n' >"$work/fake-bicep"
  chmod +x "$work/fake-bicep"
  BICEP_BIN="$work/fake-bicep" lib_run "bicep_build main.bicep"
  assert_rc 0
  assert_out_has "bicep-bin build main.bicep --stdout"
}

test_bicep_build_falls_back_to_az() {
  # A PATH of only the stub bin plus the system directories, so a developer's own `bicep` is not found.
  local restricted="$bin:/usr/bin:/bin"
  if PATH="$restricted" command -v bicep >/dev/null 2>&1; then
    printf 'skip %s (bicep found on the restricted PATH)\n' "${FUNCNAME[0]}"
    return 0
  fi
  PATH="$restricted" lib_run "bicep_build main.bicep"
  assert_rc 0
  assert_out_has "az-bicep-build"
  assert_out_has "bicep build --file main.bicep --stdout"
}

# ---- stubs --------------------------------------------------------------------------------------

test_curl_stub_scenarios() {
  STUB_SCENARIO=ok run_cmd curl -fsS http://example.invalid/
  assert_rc 0
  assert_out_has '"status":"ok"'
  STUB_SCENARIO=curlfail run_cmd curl -fsS http://example.invalid/
  assert_rc 22
}

test_docker_stub_records_arguments() {
  STUB_DOCKER_LOG="$work/docker.log" STUB_SCENARIO=ok run_cmd docker run --rm image:tag
  assert_rc 0
  [ "$(cat "$work/docker.log")" = "$(printf 'run\n--rm\nimage:tag')" ] || fail "the docker stub did not record its arguments"
  STUB_SCENARIO=dockerfail run_cmd docker run x
  assert_rc 1
}

test_az_stub_serves_the_container_app_queries() {
  STUB_SCENARIO=ok run_cmd az containerapp show -n api -g rg --query q -o tsv
  assert_rc 0
  assert_out_has "/etc/ssl/certs/ca-certificates.crt"
  STUB_SCENARIO=tls_noenv run_cmd az containerapp job show -n job-migrate -g rg --query q -o tsv
  assert_rc 0
  [ -z "$out" ] || fail "tls_noenv should answer with an empty value"
}

# ---- lib.sh: find_bicep, find_python ------------------------------------------------------------

test_find_bicep_prefers_bicep_bin() {
  BICEP_BIN="/somewhere/bicep" lib_run "find_bicep"
  assert_rc 0
  assert_out_has "/somewhere/bicep"
}

test_find_bicep_fails_when_there_is_none() {
  local restricted="$bin:/usr/bin:/bin"
  if PATH="$restricted" command -v bicep >/dev/null 2>&1; then
    printf 'skip %s (bicep found on the restricted PATH)\n' "${FUNCNAME[0]}"
    return 0
  fi
  PATH="$restricted" HOME="$work/no-home" lib_run "find_bicep"
  assert_rc 1
  [ -z "$out" ] || fail "find_bicep printed something although there is no bicep"
}

test_find_python_returns_an_interpreter() {
  # shellcheck disable=SC2016  # the single-quoted program is meant to expand in the child bash
  lib_run 'p="$(find_python)"; "$p" -c "import sys; print(sys.version_info[0])"'
  assert_rc 0
  assert_out_has "3"
}

# ---- check-template.sh and check-db-tls.sh --template: they evaluate the real template with bicep ----

# bicep_ready: 0 when bicep and python can be found. Otherwise the test is skipped, except in CI where that is a failure.
bicep_ready() {
  if find_bicep >/dev/null 2>&1 && find_python >/dev/null 2>&1; then
    return 0
  fi
  if [ -n "${CI:-}" ]; then
    fail "bicep and python are required in CI (install bicep, see infra/README.md)"
  fi
  printf 'skip %s (bicep or python not found)\n' "$current_test"
  return 1
}

# mutant <name> <file under infra/bicep> <sed expression>: print the path of main.bicep in a copy of infra/bicep whose
# <file> was changed by the sed expression. Fails when the expression no longer changes anything, so a test can never pass
# vacuously because the template was reworded.
mutant() {
  local name="$1" rel="$2" expr="$3" dir="$work/mutants/$1"
  rm -rf "$dir"
  mkdir -p "$dir"
  cp -r "$repo_bicep_dir" "$dir/bicep"
  sed -i -e "$expr" "$dir/bicep/$rel"
  if cmp -s "$repo_bicep_dir/$rel" "$dir/bicep/$rel"; then
    fail "mutation '$name' did not change $rel: update the sed expression"
  fi
  printf '%s\n' "$dir/bicep/main.bicep"
}

# expect_c_fail <name> <check id> <file> <sed expression> <text that must be in the output>
expect_c_fail() {
  local name="$1" id="$2" rel="$3" expr="$4" text="$5" template
  template="$(mutant "$name" "$rel" "$expr")"
  run_cmd bash "$scripts_dir/check-template.sh" --only "$id" "$template"
  assert_rc 1
  assert_out_has "FAIL $id"
  assert_out_has "$text"
}

test_check_template_passes_on_the_repo_template() {
  bicep_ready || return 0
  run_cmd bash "$scripts_dir/check-template.sh" "$repo_bicep_dir/main.bicep"
  assert_rc 0
  local id
  for id in C1 C2 C3 C4 C5 C6 C7 C8 C9 C10; do
    assert_out_has "PASS $id "
  done
  assert_out_lacks "FAIL"
  [ ! -e "$repo_bicep_dir/main.snapshot.json" ] || fail "check-template.sh wrote a snapshot into the repository"
}

test_check_template_rejects_bad_usage() {
  run_cmd bash "$scripts_dir/check-template.sh"
  assert_rc 1
  assert_err_has "usage"
  run_cmd bash "$scripts_dir/check-template.sh" "$work/does-not-exist.bicep"
  assert_rc 1
  assert_err_has "no such template"
}

test_check_template_c1_fails_when_an_output_leaks_a_secret() {
  bicep_ready || return 0
  # shellcheck disable=SC2016  # `$a` is a sed address (the last line), not a shell variable
  expect_c_fail c1 C1 main.bicep '$a\
output leaked string = pgAdminPassword' "leaked"
}

test_check_template_c2_fails_on_a_dedicated_workload_profile() {
  bicep_ready || return 0
  expect_c_fail c2 C2 modules/environment.bicep \
    "s/^    workloadProfiles: \[\$/&\n      { name: 'D4', workloadProfileType: 'D4' }/" "not exactly Consumption"
}

test_check_template_c3_fails_on_an_external_api() {
  bicep_ready || return 0
  expect_c_fail c3-api C3 main.bicep 's/externalIngress: false/externalIngress: true/' "api: ingress external is True"
}

test_check_template_c3_fails_on_two_replicas() {
  bicep_ready || return 0
  expect_c_fail c3-scale C3 modules/container-app.bicep 's/^param maxReplicas int = 1/param maxReplicas int = 2/' "replicas are 1..2"
}

test_check_template_c3_fails_on_allow_insecure() {
  bicep_ready || return 0
  expect_c_fail c3-insecure C3 modules/container-app.bicep 's/allowInsecure: false/allowInsecure: true/' "allowInsecure is True"
}

test_check_template_c3_fails_on_multiple_revisions() {
  bicep_ready || return 0
  expect_c_fail c3-revisions C3 modules/container-app.bicep "s/activeRevisionsMode: 'Single'/activeRevisionsMode: 'Multiple'/" "revision mode is not Single"
}

test_check_template_c4_fails_when_a_pin_is_emitted_empty() {
  bicep_ready || return 0
  expect_c_fail c4 C4 main.bicep \
    "s/empty(rulesetId) ? \[\] : \[{ name: 'SB_RULESET_ID', value: rulesetId }\]/[{ name: 'SB_RULESET_ID', value: rulesetId }]/" \
    "SB_RULESET_ID"
}

test_check_template_c5_fails_when_the_job_runs_alembic() {
  bicep_ready || return 0
  expect_c_fail c5 C5 main.bicep "s/sb-jobs db upgrade && /alembic upgrade head \&\& /" "alembic upgrade head"
}

test_check_template_c6_fails_when_the_worker_args_are_missing() {
  bicep_ready || return 0
  expect_c_fail c6 C6 main.bicep "s/args: \['alerts', 'run'\]/args: []/" "command and args must both be set"
}

test_check_template_c7_fails_when_the_api_gets_the_vapid_key() {
  bicep_ready || return 0
  expect_c_fail c7 C7 main.bicep \
    "s/^var apiEnv = concat(coreEnv, runtimeEnv,/var apiEnv = concat(coreEnv, runtimeEnv, [{ name: 'SB_VAPID_PRIVATE_KEY', secretRef: 'sb-database-url' }],/" \
    "api: has SB_VAPID_PRIVATE_KEY"
}

test_check_template_c7_fails_when_the_subject_is_sent_without_the_key() {
  bicep_ready || return 0
  expect_c_fail c7-subject C7 main.bicep \
    "s/^  runtimeEnv,\$/  runtimeEnv,\n  [{ name: 'SB_VAPID_SUBJECT', value: vapidSubject }],/" \
    "novapid/alerts"
}

test_check_template_c8_fails_when_the_replay_settings_differ() {
  bicep_ready || return 0
  expect_c_fail c8 C8 main.bicep "s/^  runtimeEnv,\$/  [{ name: 'SB_FORECAST_SOURCE', value: 'open_meteo' }],/" "SB_FORECAST_SOURCE"
}

test_check_template_c9_fails_when_a_secret_is_an_env_value() {
  bicep_ready || return 0
  expect_c_fail c9-leak C9 main.bicep \
    "s/^  { name: 'SB_LOG_LEVEL', value: 'INFO' }\$/&\n  { name: 'LEAK', value: pgAdminPassword }/" \
    "carries a secret value"
}

test_check_template_c9_fails_on_a_dangling_secret_ref() {
  bicep_ready || return 0
  expect_c_fail c9-ref C9 main.bicep "s/secretRef: 'sb-access-tokens'/secretRef: 'sb-access-tokenz'/" "unknown secret sb-access-tokenz"
}

test_check_template_c10_fails_when_phase_1_creates_the_api() {
  bicep_ready || return 0
  expect_c_fail c10-phase1 C10 main.bicep "s/^module api 'modules\/container-app.bicep' = if (deployApps) {/module api 'modules\/container-app.bicep' = {/" \
    "phase1 creates apps"
}

test_check_template_c10_fails_when_a_placeholder_api_gets_the_worker() {
  bicep_ready || return 0
  expect_c_fail c10-alerts C10 main.bicep "s/^var deployAlerts = deployApps && !apiIsPlaceholder/var deployAlerts = deployApps/" \
    "placeholder creates"
}

test_check_db_tls_template_passes_on_the_repo_template() {
  bicep_ready || return 0
  run_cmd bash "$scripts_dir/check-db-tls.sh" --template "$repo_bicep_dir/main.bicep"
  assert_rc 0
  assert_out_has "PASS T1"
  assert_out_has "PASS T2"
  assert_out_has "PASS T3"
  assert_out_lacks "FAIL"
}

test_check_db_tls_template_fails_on_ssl_require() {
  bicep_ready || return 0
  local template
  template="$(mutant tls-require main.bicep 's/ssl=verify-full/ssl=require/')"
  run_cmd bash "$scripts_dir/check-db-tls.sh" --template "$template"
  assert_rc 1
  assert_out_has "FAIL T1"
  assert_out_has "FAIL T2"
}

test_check_db_tls_template_fails_on_sslmode() {
  bicep_ready || return 0
  local template
  template="$(mutant tls-sslmode main.bicep 's/?ssl=verify-full/?sslmode=verify-full/')"
  run_cmd bash "$scripts_dir/check-db-tls.sh" --template "$template"
  assert_rc 1
  assert_out_has "FAIL T2"
}

test_check_db_tls_template_fails_without_pgsslrootcert() {
  bicep_ready || return 0
  local template
  template="$(mutant tls-noroot main.bicep "/^  { name: 'PGSSLROOTCERT', value: pgSslRootCert }\$/d")"
  run_cmd bash "$scripts_dir/check-db-tls.sh" --template "$template"
  assert_rc 1
  assert_out_has "FAIL T3"
  assert_out_has "api: PGSSLROOTCERT"
  assert_out_has "alerts: PGSSLROOTCERT"
  assert_out_has "job-migrate: PGSSLROOTCERT"
  assert_out_has "PASS T1"
}

test_check_db_tls_template_fails_when_only_the_job_loses_pgsslrootcert() {
  bicep_ready || return 0
  # api and alerts share coreEnv with the job; give the job a list without the last entry (PGSSLROOTCERT).
  local template
  template="$(mutant tls-jobroot main.bicep "s/^    env: apiIsPlaceholder ? \[\] : coreEnv\$/    env: apiIsPlaceholder ? [] : take(coreEnv, 5)/")"
  run_cmd bash "$scripts_dir/check-db-tls.sh" --template "$template"
  assert_rc 1
  assert_out_has "FAIL T3"
  assert_out_has "job-migrate: PGSSLROOTCERT"
  assert_out_lacks "api: PGSSLROOTCERT"
}

# ---- check-db-tls.sh --deployed / --image -------------------------------------------------------

stub_url_marker="STUBPASSWORD"

assert_no_url_anywhere() {
  case "$out$err" in
    *"$stub_url_marker"* | *"postgresql+asyncpg"*) fail "the database URL (or its password) reached the output" ;;
    *) ;;
  esac
}

test_check_db_tls_deployed_passes_when_everything_verifies() {
  STUB_SCENARIO=ok run_cmd bash "$scripts_dir/check-db-tls.sh" --deployed rg-test
  assert_rc 0
  assert_out_has "PASS T4 api "
  assert_out_has "PASS T4 alerts "
  assert_out_has "PASS T4 job-migrate "
  assert_out_has "PASS T5 api "
  assert_out_has "PASS T5 alerts "
  assert_out_has "PASS T5 job-migrate "
  assert_out_lacks "FAIL"
  assert_no_url_anywhere
}

test_check_db_tls_deployed_fails_when_the_secret_lacks_verify_full() {
  STUB_SCENARIO=tls_require run_cmd bash "$scripts_dir/check-db-tls.sh" --deployed rg-test
  assert_rc 1
  assert_out_has "FAIL T4 api"
  assert_out_has "FAIL T4 alerts"
  assert_out_has "FAIL T4 job-migrate"
  assert_out_has "PASS T5 api"
  assert_no_url_anywhere
}

test_check_db_tls_deployed_names_the_one_weak_container() {
  STUB_SCENARIO=tls_alerts run_cmd bash "$scripts_dir/check-db-tls.sh" --deployed rg-test
  assert_rc 1
  assert_out_has "FAIL T4 alerts"
  assert_out_has "PASS T4 api"
  assert_out_has "PASS T4 job-migrate"
  assert_no_url_anywhere
}

test_check_db_tls_deployed_fails_without_the_root_cert_env() {
  STUB_SCENARIO=tls_noenv run_cmd bash "$scripts_dir/check-db-tls.sh" --deployed rg-test
  assert_rc 1
  assert_out_has "FAIL T5 api"
  assert_out_has "FAIL T5 alerts"
  assert_out_has "FAIL T5 job-migrate"
  assert_out_has "PASS T4 api"
}

test_check_db_tls_deployed_keeps_the_url_out_of_a_shell_trace() {
  STUB_SCENARIO=tls_require run_cmd bash -x "$scripts_dir/check-db-tls.sh" --deployed rg-test
  assert_rc 1
  assert_no_url_anywhere
}

test_check_db_tls_image_runs_the_ca_check_in_the_image() {
  STUB_DOCKER_LOG="$work/docker.log" STUB_SCENARIO=ok run_cmd bash "$scripts_dir/check-db-tls.sh" --image reg.example/sb-api:abc
  assert_rc 0
  assert_out_has "PASS T6 reg.example/sb-api:abc"
  local logged want
  logged="$(cat "$work/docker.log")"
  for want in run --rm "--pull" never "PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt" "--entrypoint" python \
    "reg.example/sb-api:abc" "-c" "DigiCert Global Root G2" "Microsoft RSA Root Certificate Authority 2017" \
    "load_verify_locations(cafile=path)" "get_ca_certs()"; do
    case "$logged" in *"$want"*) ;; *) fail "docker was not given: $want" ;; esac
  done
}

test_check_db_tls_image_fails_when_the_ca_check_fails() {
  STUB_SCENARIO=dockerfail run_cmd bash "$scripts_dir/check-db-tls.sh" --image reg.example/sb-api:abc
  assert_rc 1
  assert_out_has "FAIL T6"
  assert_out_has "missing root CA"
}

test_check_db_tls_image_against_a_real_image() {
  local image="stellar-blaze-api:i1"
  if ! PATH="$real_path" docker image inspect "$image" >/dev/null 2>&1; then
    printf 'skip %s (docker or %s not available)\n' "${FUNCNAME[0]}" "$image"
    return 0
  fi
  PATH="$real_path" run_cmd bash "$scripts_dir/check-db-tls.sh" --image "$image"
  assert_rc 0
  assert_out_has "PASS T6 $image"
  PATH="$real_path" run_cmd bash "$scripts_dir/check-db-tls.sh" --image "stellar-blaze-api:no-such-tag-for-the-test"
  assert_rc 1
  assert_out_has "FAIL T6"
}

test_check_db_tls_rejects_bad_usage() {
  run_cmd bash "$scripts_dir/check-db-tls.sh"
  assert_rc 1
  assert_err_has "usage"
  run_cmd bash "$scripts_dir/check-db-tls.sh" --bogus x
  assert_rc 1
  assert_err_has "usage"
}

# ---- deploy scripts: helpers --------------------------------------------------------------------

az_log() {
  cat "$STUB_STATE_DIR/az.log" 2>/dev/null || true
}

# az_count <fixed text>: how many recorded az calls contain the text.
az_count() {
  local n
  n="$(az_log | grep -cF -- "$1" || true)"
  printf '%s' "$n"
}

# az_line <fixed text>: the line numbers (space separated) of the recorded az calls that contain the text.
az_line() {
  az_log | grep -nF -- "$1" | cut -d: -f1 | tr '\n' ' ' || true
}

assert_az_count() { # <fixed text> <expected>
  local n
  n="$(az_count "$1")"
  [ "$n" = "$2" ] || fail "expected $2 az call(s) containing '$1', saw $n"
}

assert_no_az_calls() {
  [ -z "$(az_log)" ] || fail "az was called: $(az_log | head -n 3 | tr '\n' '|')"
}

# ---- resolve-image.sh ---------------------------------------------------------------------------

test_resolve_image_placeholder_when_no_dockerfile() {
  mkdir -p "$work/ri-empty"
  local svc
  for svc in api web; do
    run_cmd bash "$scripts_dir/resolve-image.sh" "$svc" "$work/ri-empty" abc acr.example
    assert_rc 0
    assert_out_has "image=mcr.microsoft.com/k8se/quickstart:latest"
    assert_out_has "port=80"
    assert_out_has "live=/"
    assert_out_has "ready=/"
    assert_out_has "health=/"
    assert_out_has "placeholder=true"
  done
}

test_resolve_image_real_api() {
  mkdir -p "$work/ri-api"
  : >"$work/ri-api/Dockerfile"
  run_cmd bash "$scripts_dir/resolve-image.sh" api "$work/ri-api" abc acr.example
  assert_rc 0
  assert_out_has "image=acr.example/sb-api:abc"
  assert_out_has "port=8000"
  assert_out_has "live=/api/v1/health/live"
  assert_out_has "ready=/api/v1/health/ready"
  assert_out_has "placeholder=false"
  assert_out_lacks "health=/api/healthz"
}

test_resolve_image_real_web() {
  mkdir -p "$work/ri-web"
  : >"$work/ri-web/Dockerfile"
  run_cmd bash "$scripts_dir/resolve-image.sh" web "$work/ri-web" abc acr.example
  assert_rc 0
  assert_out_has "image=acr.example/sb-web:abc"
  assert_out_has "port=3000"
  assert_out_has "health=/api/healthz"
  assert_out_has "placeholder=false"
}

test_resolve_image_appends_to_github_output() {
  mkdir -p "$work/ri-out"
  : >"$work/ri-out/Dockerfile"
  printf 'earlier=1\n' >"$work/github-output"
  GITHUB_OUTPUT="$work/github-output" run_cmd bash "$scripts_dir/resolve-image.sh" api "$work/ri-out" abc acr.example
  assert_rc 0
  [ "$(head -n 1 "$work/github-output")" = "earlier=1" ] || fail "GITHUB_OUTPUT was overwritten, not appended"
  grep -qxF "image=acr.example/sb-api:abc" "$work/github-output" || fail "image= line missing from GITHUB_OUTPUT"
  grep -qxF "placeholder=false" "$work/github-output" || fail "placeholder= line missing from GITHUB_OUTPUT"
}

test_resolve_image_rejects_values_that_could_inject_an_output_line() {
  mkdir -p "$work/ri-bad"
  : >"$work/ri-bad/Dockerfile"
  : >"$work/github-output"
  GITHUB_OUTPUT="$work/github-output" run_cmd bash "$scripts_dir/resolve-image.sh" api "$work/ri-bad" "$(printf 'abc\nplaceholder=true')" acr.example
  assert_rc 1
  assert_err_has "not a valid image tag"
  [ ! -s "$work/github-output" ] || fail "something was written to GITHUB_OUTPUT for a bad tag"
  run_cmd bash "$scripts_dir/resolve-image.sh" api "$work/ri-bad" abc "acr.example/evil"
  assert_rc 1
  assert_err_has "not a valid registry login server"
  run_cmd bash "$scripts_dir/resolve-image.sh" db "$work/ri-bad" abc acr.example
  assert_rc 1
  assert_err_has "usage"
}

# ---- run-migrate.sh -----------------------------------------------------------------------------

run_migrate() { # <args...>: no waiting between polls or attempts
  MIGRATE_POLL_S=0 MIGRATE_RETRY_WAIT_S=0 run_cmd bash "$scripts_dir/run-migrate.sh" "$@"
}

test_run_migrate_skips_when_placeholder() {
  run_migrate rg-test mcr.microsoft.com/k8se/quickstart:latest true
  assert_rc 0
  assert_out_has "skip: placeholder"
  assert_no_az_calls
}

test_run_migrate_succeeds() {
  run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 0
  assert_out_has "migrate ok: execution job-migrate-exec1 Succeeded"
  assert_az_count "containerapp job start" 1
}

test_run_migrate_polls_until_the_execution_ends() {
  STUB_MIGRATE_STATUSES="Running+Running+Succeeded" run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 0
  assert_az_count "containerapp job execution show" 3
  assert_az_count "containerapp job start" 1
}

test_run_migrate_fails_on_a_failed_execution_after_two_attempts() {
  STUB_MIGRATE_STATUSES="Failed" run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 1
  assert_az_count "containerapp job start" 2
  assert_out_has "migrate FAILED after 2 attempt(s)"
  assert_out_has "job-migrate-exec2"
  assert_out_has 'ContainerAppConsoleLogs | where ContainerGroupName startswith "job-migrate" | order by TimeGenerated desc | take 50'
}

test_run_migrate_succeeds_on_the_second_attempt() {
  STUB_MIGRATE_STATUSES="Failed Succeeded" run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 0
  assert_az_count "containerapp job start" 2
  assert_out_has "execution job-migrate-exec2 Succeeded (attempt 2)"
}

test_run_migrate_retries_after_stopped_and_degraded() {
  STUB_MIGRATE_STATUSES="Stopped Degraded" run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 1
  assert_az_count "containerapp job start" 2
  assert_out_has "last execution job-migrate-exec2, result Degraded"
}

test_run_migrate_treats_a_timeout_as_a_failed_attempt() {
  STUB_MIGRATE_STATUSES="Running" MIGRATE_TIMEOUT_S=0 run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 1
  assert_az_count "containerapp job start" 2
  assert_out_has "result timeout"
}

test_run_migrate_honours_the_attempts_setting() {
  STUB_MIGRATE_STATUSES="Failed Failed Succeeded" MIGRATE_ATTEMPTS=3 run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 0
  assert_az_count "containerapp job start" 3
}

test_run_migrate_fails_when_the_job_is_missing() {
  STUB_JOB_MISSING=1 run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 1
  assert_err_has "job-migrate not found"
  assert_az_count "containerapp job start" 0
}

test_run_migrate_stops_before_starting_when_the_job_runs_another_image() {
  STUB_JOB_IMAGE="reg.example/sb-api:old" run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 1
  assert_err_has "does not run the image of this deploy"
  assert_az_count "containerapp job start" 0
  assert_az_count "execution show" 0
}

test_run_migrate_never_overrides_the_job() {
  STUB_MIGRATE_STATUSES="Failed Succeeded" run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 0
  assert_az_count "job update" 0
  assert_az_count "containerapp job create" 0
  assert_az_count "--command" 0
  assert_az_count "--args" 0
  assert_az_count "--image" 0
}

test_run_migrate_identifies_the_new_execution_by_the_list_when_start_prints_nothing() {
  STUB_JOB_START_SILENT=1 run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 0
  assert_out_has "migrate ok: execution job-migrate-exec1 Succeeded"
  # one list BEFORE the start (the record of existing executions), one after it
  assert_az_count "containerapp job execution list" 2
  local lines list_before start_line list_after
  lines="$(az_line "containerapp job execution list")"
  list_before="${lines%% *}"
  list_after="$(printf '%s' "$lines" | awk '{print $2}')"
  start_line="$(az_line "containerapp job start" | awk '{print $1}')"
  [ "$list_before" -lt "$start_line" ] && [ "$list_after" -gt "$start_line" ] || fail "the executions were not listed before and after the start (list $lines, start $start_line)"
}

test_run_migrate_fails_when_start_prints_nothing_and_only_an_old_execution_is_listed() {
  # The reviewer's proof: the new execution is not listed yet, the list holds the previous deploy's execution, which is
  # Succeeded. That must never read as success: the apps would roll out against an un-migrated schema.
  STUB_JOB_START_SILENT=1 STUB_JOB_OLD_EXECUTIONS="job-migrate-old1" STUB_JOB_LIST_LAG=1000000 MIGRATE_IDENTIFY_TIMEOUT_S=0 \
    run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 1
  assert_out_lacks "migrate ok"
  assert_out_has "migrate FAILED"
  assert_az_count "job-migrate-old1" 0
  assert_az_count "containerapp job execution show" 0
}

test_run_migrate_ignores_an_old_execution_when_the_new_one_is_listed() {
  STUB_JOB_START_SILENT=1 STUB_JOB_OLD_EXECUTIONS="job-migrate-old1 job-migrate-old2" run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 0
  assert_out_has "migrate ok: execution job-migrate-exec1 Succeeded"
  assert_az_count "job-migrate-old" 0
}

test_run_migrate_waits_for_the_new_execution_to_appear_in_the_list() {
  STUB_JOB_START_SILENT=1 STUB_JOB_OLD_EXECUTIONS="job-migrate-old1" STUB_JOB_LIST_LAG=2 MIGRATE_IDENTIFY_TIMEOUT_S=20 \
    run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 0
  assert_out_has "migrate ok: execution job-migrate-exec1 Succeeded"
  assert_az_count "job-migrate-old1" 0
  # the record before the start, then the lagging list polled three times
  assert_az_count "containerapp job execution list" 4
}

test_run_migrate_treats_none_from_the_start_as_empty() {
  # az -o tsv prints `None` for a null; it must not become an execution name that gets polled
  STUB_JOB_START_NONE=1 run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 0
  assert_out_has "migrate ok: execution job-migrate-exec1 Succeeded"
  assert_az_count "--job-execution-name None" 0
  assert_az_count "containerapp job execution list" 2
}

test_run_migrate_does_not_trust_a_start_answer_that_existed_before_the_start() {
  STUB_JOB_START_REUSES_OLD=1 STUB_JOB_OLD_EXECUTIONS="job-migrate-old1" run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 0
  assert_out_has "migrate ok: execution job-migrate-exec1 Succeeded"
  assert_az_count "job-migrate-old1" 0
}

test_run_migrate_fails_when_the_list_is_unreadable_and_start_prints_nothing() {
  # an unreadable list is not an empty list: with no record of the old executions nothing can be told apart
  STUB_JOB_START_SILENT=1 STUB_JOB_LIST_FAIL=1 STUB_JOB_OLD_EXECUTIONS="job-migrate-old1" run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 1
  assert_out_lacks "migrate ok"
  assert_az_count "containerapp job execution show" 0
}

test_run_migrate_uses_the_start_answer_when_the_list_is_unreadable() {
  STUB_JOB_LIST_FAIL=1 run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 0
  assert_out_has "migrate ok: execution job-migrate-exec1 Succeeded"
}

test_run_migrate_fails_when_the_job_cannot_be_started() {
  STUB_JOB_START_FAIL=1 run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 1
  assert_out_has "migrate FAILED after 2 attempt(s)"
}

test_run_migrate_rejects_bad_usage() {
  MIGRATE_IDENTIFY_TIMEOUT_S=soon run_migrate rg-test reg.example/sb-api:abc false
  assert_rc 1
  assert_err_has "whole numbers"
  assert_no_az_calls
  run_migrate rg-test reg.example/sb-api:abc maybe
  assert_rc 1
  assert_err_has "usage"
  run_migrate rg-test
  assert_rc 1
  assert_err_has "usage"
}

# ---- healthcheck.sh -----------------------------------------------------------------------------

run_health() { # <extra args...>: api, no waiting between polls; the test passes --timeout
  HEALTH_POLL_S=0 run_cmd bash "$scripts_dir/healthcheck.sh" --app api --rg rg-test --image reg.example/sb-api:abc "$@"
}

test_healthcheck_passes_on_the_happy_fixture() {
  run_health --timeout 0
  assert_rc 0
  assert_out_has "PASS healthcheck api"
  assert_az_count "containerapp revision show -n api -g rg-test --revision api--rev1" 1
}

test_healthcheck_fails_when_the_active_image_differs() {
  # The plan's Review Focus 1: the old revision still serves, so everything is green except the image it runs.
  STUB_REV_IMAGE="old" run_health --timeout 0
  assert_rc 1
  assert_out_has "runs image 'old', expected 'reg.example/sb-api:abc'"
  assert_out_has "FAIL healthcheck api"
}

test_healthcheck_fails_when_latest_ready_differs_from_latest() {
  STUB_LATEST="api--rev2" STUB_LATEST_READY="api--rev1" run_health --timeout 0
  assert_rc 1
  assert_out_has "latest revision api--rev2 is not the latest ready revision (api--rev1)"
}

test_healthcheck_fails_when_unhealthy() {
  STUB_HEALTH="Unhealthy" run_health --timeout 0
  assert_rc 1
  assert_out_has "healthState is 'Unhealthy'"
}

test_healthcheck_fails_while_provisioning() {
  STUB_PROV="Provisioning" run_health --timeout 0
  assert_rc 1
  assert_out_has "provisioningState is 'Provisioning'"
}

test_healthcheck_fails_when_not_running() {
  STUB_RUNNING="Failed" run_health --timeout 0
  assert_rc 1
  assert_out_has "runningState is 'Failed'"
}

test_healthcheck_fails_when_traffic_is_not_100() {
  STUB_TRAFFIC="0" run_health --timeout 0
  assert_rc 1
  assert_out_has "trafficWeight is '0'"
}

test_healthcheck_fails_without_a_replica() {
  STUB_REPLICAS="0" run_health --timeout 0
  assert_rc 1
  assert_out_has "has '0' replicas"
}

test_healthcheck_no_ingress_accepts_none_but_the_default_does_not() {
  STUB_HEALTH="None" run_health --timeout 0
  assert_rc 1
  assert_out_has "healthState is 'None'"
  STUB_HEALTH="None" STUB_TRAFFIC="None" run_health --timeout 0 --no-ingress
  assert_rc 0
  STUB_HEALTH="Unhealthy" run_health --timeout 0 --no-ingress
  assert_rc 1
}

test_healthcheck_polls_until_healthy() {
  STUB_HEALTH_SEQ="Unhealthy Unhealthy Healthy" run_health --timeout 60
  assert_rc 0
  assert_out_has "WAIT api"
  assert_az_count "containerapp revision show" 3
}

test_healthcheck_makes_one_attempt_with_timeout_zero() {
  STUB_HEALTH="Unhealthy" run_health --timeout 0
  assert_rc 1
  assert_az_count "containerapp revision show" 1
}

test_healthcheck_url_failure_fails() {
  STUB_CURL_RULES="https://=503" run_health --timeout 0 --url https://web.example.invalid/api/healthz
  assert_rc 1
  assert_out_has "answered '503', expected 200"
  # the revision itself was fine: only the URL condition is reported
  assert_out_lacks "runs image"
}

test_healthcheck_url_passes_and_checks_the_json() {
  run_health --timeout 0 --url https://web.example.invalid/api/healthz --expect-json-key status --expect-json-value ok
  assert_rc 0
  STUB_CURL_BODY='{"status":"degraded"}' run_health --timeout 0 --url https://web.example.invalid/api/healthz --expect-json-key status --expect-json-value ok
  assert_rc 1
  assert_out_has 'lacks "status": "ok"'
}

test_healthcheck_only_takes_an_https_url() {
  run_health --timeout 0 --url http://web.example.invalid/
  assert_rc 1
  assert_err_has "--url must be the public https URL"
  run_health --timeout 0 --expect-json-key status --expect-json-value ok
  assert_rc 1
  assert_err_has "need --url"
  assert_no_az_calls
}

test_healthcheck_reports_an_unreadable_revision() {
  STUB_REVISION_MISSING=1 run_health --timeout 0
  assert_rc 1
  assert_out_has "cannot read revision"
}

test_healthcheck_rejects_bad_usage() {
  run_cmd bash "$scripts_dir/healthcheck.sh" --app api
  assert_rc 1
  assert_err_has "usage"
  run_health --timeout soon
  assert_rc 1
  assert_err_has "whole number"
}

# ---- smoke.sh -----------------------------------------------------------------------------------

make_fake_smoke_http() {
  cat >"$work/fake-smoke-http.sh" <<'EOF'
printf '%s\n' "$*" >"$FAKE_HTTP_ARGS"
for id in H1 H2 H3 H4 H5 H7 H6; do
  if [ "${FAKE_HTTP_FAIL:-}" = "$id" ]; then
    printf 'FAIL %s fake failure\n' "$id"
  else
    printf 'PASS %s fake ok\n' "$id"
  fi
done
if [ -n "${FAKE_HTTP_FAIL:-}" ]; then
  printf 'SMOKE FAILED: 1 check(s) failed\n'
  exit 1
fi
printf 'SMOKE OK\n'
EOF
}

run_smoke() { # <args...>: the real healthcheck.sh and check-db-tls.sh on the stub, smoke-http.sh replaced by a fake
  make_fake_smoke_http
  SMOKE_HTTP_SCRIPT="$work/fake-smoke-http.sh" FAKE_HTTP_ARGS="$work/fake-http-args" SMOKE_S5_TIMEOUT=0 HEALTH_POLL_S=0 \
    STUB_CURL_RULES="${STUB_CURL_RULES-http://=301}" run_cmd bash "$scripts_dir/smoke.sh" "$@"
}

test_smoke_passes_on_the_happy_run() {
  run_smoke rg-test --no-wait
  assert_rc 0
  local id
  for id in S1 S2 S4 S5 S6 S7 S8; do
    assert_out_has "PASS $id "
  done
  assert_out_has "PASS S3 H1 fake ok"
  assert_out_has "PASS S3 H2 fake ok"
  assert_out_has "PASS S9 H3 fake ok"
  assert_out_has "PASS S9 H6 fake ok"
  assert_out_has "PASS S2 alerts"
  assert_out_has "PASS S6 all 3 resources are in uaenorth"
  assert_out_has "SMOKE OK"
  assert_out_lacks "FAIL"
  [ "$(cat "$work/fake-http-args")" = "https://web.stub.uaenorth.azurecontainerapps.io" ] || fail "smoke-http.sh got: $(cat "$work/fake-http-args")"
  assert_az_count "containerapp job start" 0
  assert_az_count "update" 0
}

test_smoke_waits_out_the_rate_limit_window_unless_told_not_to() {
  run_smoke rg-test
  assert_rc 0
  [ "$(cat "$work/fake-http-args")" = "https://web.stub.uaenorth.azurecontainerapps.io --wait" ] || fail "smoke-http.sh got: $(cat "$work/fake-http-args")"
}

test_smoke_reports_fail_s1_on_dedicated_profile() {
  STUB_SCENARIO=dedicated run_smoke rg-test --no-wait
  assert_rc 1
  assert_out_has "FAIL S1"
  assert_out_has "[Consumption,D4]"
  assert_out_has "PASS S4"
  assert_out_has "SMOKE FAILED"
}

test_smoke_reports_fail_s1_on_a_private_endpoint() {
  STUB_PRIVATE_ENDPOINTS="pe-db" run_smoke rg-test --no-wait
  assert_rc 1
  assert_out_has "FAIL S1 the group has private endpoint(s): pe-db"
}

test_smoke_reports_fail_s4_when_the_api_ingress_is_external() {
  STUB_SCENARIO=api_external run_smoke rg-test --no-wait
  assert_rc 1
  assert_out_has "FAIL S4 api ingress.external is 'true', expected false"
  assert_out_has "PASS S4 web ingress is external"
  assert_out_has "PASS S4 alerts has no ingress"
}

test_smoke_reports_fail_s4_when_the_worker_has_an_ingress() {
  STUB_INGRESS_EXTERNAL_ALERTS="false" run_smoke rg-test --no-wait
  assert_rc 1
  assert_out_has "FAIL S4 alerts has an ingress"
}

test_smoke_reports_fail_s2_when_max_replicas_is_3() {
  STUB_SCENARIO=max3 run_smoke rg-test --no-wait
  assert_rc 1
  assert_out_has "FAIL S2 api scale is min 1 / max 3"
  assert_out_has "PASS S2 web"
  assert_out_has "PASS S2 alerts"
}

test_smoke_reports_fail_s6_on_a_resource_in_another_region() {
  STUB_SCENARIO=other_region run_smoke rg-test --no-wait
  assert_rc 1
  assert_out_has "FAIL S6 resources outside uaenorth: stray-db(westeurope)"
  # a display-name location ("UAE North") is the same region, not a failure
  assert_out_lacks "pg-test"
}

test_smoke_s6_follows_expect_location() {
  run_smoke rg-test --no-wait --expect-location "UAE North"
  assert_rc 0
  assert_out_has "PASS S6"
  run_smoke rg-test --no-wait --expect-location westeurope
  assert_rc 1
  assert_out_has "FAIL S6 resources outside westeurope: api(uaenorth)"
}

test_smoke_reports_fail_s7_when_plain_http_is_served() {
  STUB_CURL_RULES="" run_smoke rg-test --no-wait
  assert_rc 1
  assert_out_has "FAIL S7"
  assert_out_has "answered 200 over plain http"
}

test_smoke_s7_accepts_a_refusal() {
  STUB_CURL_RULES="http://=000" run_smoke rg-test --no-wait
  assert_rc 0
  assert_out_has "PASS S7 plain http is not served: http://web.stub.uaenorth.azurecontainerapps.io/ answered 000"
}

test_smoke_reports_fail_s5_when_the_worker_is_not_running() {
  STUB_RUNNING_ALERTS="Failed" run_smoke rg-test --no-wait
  assert_rc 1
  assert_out_has "FAIL S5"
  assert_out_has "runningState is 'Failed'"
}

test_smoke_reports_fail_s8_when_the_database_url_is_weak() {
  STUB_SCENARIO=tls_require run_smoke rg-test --no-wait
  assert_rc 1
  assert_out_has "FAIL S8"
  assert_no_url_anywhere
}

test_smoke_passes_the_http_failures_through_as_s3_and_s9() {
  FAKE_HTTP_FAIL=H2 run_smoke rg-test --no-wait
  assert_rc 1
  assert_out_has "FAIL S3 H2 fake failure"
  assert_out_has "PASS S3 H1"
  FAKE_HTTP_FAIL=H6 run_smoke rg-test --no-wait
  assert_rc 1
  assert_out_has "FAIL S9 H6 fake failure"
}

test_smoke_placeholder_runs_only_the_cost_and_reachability_checks() {
  rm -f "$work/fake-http-args"
  run_smoke rg-test --placeholder --no-wait
  assert_rc 0
  assert_out_has "PASS S1 "
  assert_out_has "PASS S2 api"
  assert_out_has "PASS S2 web"
  assert_out_lacks "S2 alerts"
  assert_out_has "PASS S3 placeholder web: https://web.stub.uaenorth.azurecontainerapps.io/ is 200"
  assert_out_has "PASS S6 "
  assert_out_has "PASS S7 "
  local id
  for id in S4 S5 S8 S9; do
    assert_out_has "SKIP $id placeholder"
  done
  assert_az_count "containerapp secret list" 0
  [ ! -e "$work/fake-http-args" ] || fail "smoke-http.sh ran for a placeholder"
}

test_smoke_placeholder_fails_when_the_web_root_is_not_200() {
  STUB_CURL_RULES="https://=503 http://=301" run_smoke rg-test --placeholder --no-wait
  assert_rc 1
  assert_out_has "FAIL S3 placeholder web"
}

test_smoke_rejects_bad_usage() {
  run_smoke
  assert_rc 1
  assert_err_has "usage"
  run_smoke rg-test --bogus
  assert_rc 1
  assert_err_has "usage"
}

# ---- smoke-http.sh ------------------------------------------------------------------------------

run_smoke_http() { # <extra args...>: the real script; curl is the BFF stub (stubs/curl-demo-bff), the base URL needs no network
  mkdir -p "$work/bff-bin"
  cp "$stubs_dir/curl-demo-bff" "$work/bff-bin/curl"
  chmod +x "$work/bff-bin/curl"
  FAKE_CURL_LOG="$STUB_STATE_DIR/bff.log" FAKE_STATE_DIR="$STUB_STATE_DIR" PATH="$work/bff-bin:$PATH" \
    run_cmd bash "$scripts_dir/smoke-http.sh" http://127.0.0.1:8080 "$@"
}

# bff_count <fixed text>: how many requests the BFF stub recorded that contain the text.
bff_count() {
  local n
  n="$(grep -cF -- "$1" "$STUB_STATE_DIR/bff.log" || true)"
  printf '%s' "$n"
}

reset_route='POST /api/v1/sites/site-demo-mussafah/demo-reset'

test_smoke_http_passes_and_never_resets_when_h3_passes() {
  run_smoke_http --reset-on-h3-failure
  assert_rc 0
  assert_out_has "PASS H3"
  assert_out_has "SMOKE OK"
  assert_out_lacks "demo-reset"
  [ "$(bff_count "$reset_route")" = "0" ] || fail "a reset was sent although H3 passed"
}

test_smoke_http_h3_failure_prints_the_recovery_and_resets_nothing_by_default() {
  FAKE_UNDO_STATUS=500 run_smoke_http
  assert_rc 1
  assert_out_has "FAIL H3 Undo: DELETE /api/v1/crews/crew-b/stops/stop-1 expected 204, got 500"
  assert_out_has "an active stop leaves crew-b Red until the end of the replay shift"
  assert_out_has "POST /api/v1/sites/site-demo-mussafah/demo-reset through the web"
  assert_out_has "starts a new epoch"
  assert_out_has "--reset-on-h3-failure performs that one reset"
  [ "$(bff_count "$reset_route")" = "0" ] || fail "a reset was sent without --reset-on-h3-failure"
}

test_smoke_http_h3_failure_with_the_flag_resets_exactly_once() {
  FAKE_UNDO_STATUS=500 run_smoke_http --reset-on-h3-failure
  assert_rc 1
  assert_out_has "FAIL H3"
  assert_out_has "POST /api/v1/sites/site-demo-mussafah/demo-reset through the web"
  assert_out_has "demo-reset done (200)"
  [ "$(bff_count "$reset_route")" = "1" ] || fail "expected exactly one reset, saw $(bff_count "$reset_route")"
}

test_smoke_http_h3_failure_with_the_flag_reports_a_reset_that_fails() {
  FAKE_UNDO_STATUS=500 FAKE_RESET_STATUS=429 run_smoke_http --reset-on-h3-failure
  assert_rc 1
  assert_out_has "demo-reset FAILED with 429"
  assert_out_has "do it by hand"
  [ "$(bff_count "$reset_route")" = "1" ] || fail "expected one reset attempt, saw $(bff_count "$reset_route")"
}

test_smoke_http_a_red_timeline_after_the_undo_also_gets_the_recovery() {
  FAKE_TIMELINE='{"hours":[{"crew_level":"red"}]}' run_smoke_http --reset-on-h3-failure
  assert_rc 1
  assert_out_has "an undone stop left a red hour in the timeline of crew-b"
  assert_out_has "demo-reset done (200)"
  [ "$(bff_count "$reset_route")" = "1" ] || fail "expected exactly one reset, saw $(bff_count "$reset_route")"
}

test_smoke_http_no_reset_when_no_stop_was_created() {
  # nothing to recover from: the flag must not change state when the stop itself was refused
  FAKE_STOP_STATUS=429 run_smoke_http --reset-on-h3-failure
  assert_rc 1
  assert_out_has "FAIL H3 Stop through the BFF"
  assert_out_lacks "demo-reset"
  [ "$(bff_count "$reset_route")" = "0" ] || fail "a reset was sent although no stop was created"
}

test_smoke_http_rejects_an_unknown_option_and_documents_the_flag() {
  run_smoke_http --reset-on-h3
  assert_rc 2
  assert_err_has "unknown option: --reset-on-h3"
  assert_err_has "[--reset-on-h3-failure]"
}

test_smoke_http_h4_outside_the_window_says_to_run_reset_demo() {
  local started
  # 14:00 UTC is 18:00 Dubai and 05:00 UTC is 09:00 Dubai: both outside 10:00-17:30; neither run changes anything by itself
  for started in 2026-06-14T14:00:00Z 2026-06-14T05:00:00Z; do
    FAKE_STARTED_AT="$started" run_smoke_http
    assert_rc 1
    assert_out_has "FAIL H4 replay clock is outside the demo window: run: bash infra/scripts/reset-demo.sh <web-url>"
    assert_out_has "here: bash infra/scripts/reset-demo.sh http://127.0.0.1:8080"
    assert_out_lacks "restart-replay-clock"
    [ "$(bff_count "$reset_route")" = "0" ] || fail "an H4 failure sent a reset"
  done
  FAKE_STARTED_AT=2026-06-14T13:30:00Z run_smoke_http
  assert_rc 0
  assert_out_has "PASS H4 replay clock is inside the demo window: 17:30 Asia/Dubai"
}

# ---- restart-apps.sh ----------------------------------------------------------------------------

run_restart() { # <args...>: no waiting between polls and no settle time unless the test sets RESTART_SETTLE_S
  HEALTH_POLL_S=0 RESTART_SETTLE_S="${RESTART_SETTLE_S:-0}" run_cmd bash "$scripts_dir/restart-apps.sh" "$@"
}

# assert_issued_back_to_back <expected count>: the az calls that change anything (restart or update) are exactly that many
# and sit on consecutive lines of the call log, so no wait (a show, a replica list) came between them.
assert_issued_back_to_back() {
  local lines first last n
  lines="$(az_log | grep -nE '^containerapp (update|revision restart) ' | cut -d: -f1 | tr '\n' ' ' || true)"
  n="$(printf '%s' "$lines" | wc -w | tr -d ' ')"
  [ "$n" -eq "$1" ] || fail "expected $1 restart/update calls, saw $n (lines: $lines)"
  first="${lines%% *}"
  last="$(printf '%s' "$lines" | awk '{print $NF}')"
  [ "$((last - first))" -eq "$(($1 - 1))" ] || fail "the $1 restarts are not back to back: a wait came between them (lines: $lines)"
  # and nothing waits before the last one is issued: the first revision show comes after it
  local first_wait
  first_wait="$(az_line "revision show" | awk '{print $1}')"
  [ -n "$first_wait" ] && [ "$first_wait" -gt "$last" ] || fail "a wait started before every restart was issued"
}

test_restart_apps_restarts_api_alerts_and_web_back_to_back_before_any_wait() {
  run_restart rg-test --timeout 0
  assert_rc 0
  assert_az_count "containerapp revision restart -n api -g rg-test --revision api--rev1" 1
  assert_az_count "containerapp revision restart -n alerts -g rg-test --revision alerts--rev1" 1
  assert_az_count "containerapp revision restart -n web -g rg-test --revision web--rev1" 1
  assert_issued_back_to_back 3
  # the order of the calls and of the report: api, alerts, web
  local order
  order="$(az_log | grep '^containerapp revision restart ' | awk '{print $5}' | tr '\n' ' ')"
  [ "$order" = "api alerts web " ] || fail "restart order is '$order', expected 'api alerts web '"
  assert_az_count "containerapp update" 0
  assert_out_has "Apps restarted."
  assert_out_has "restarted:             api alerts web"
  assert_out_lacks "clock"
}

test_restart_apps_waits_with_the_healthcheck_conditions() {
  run_restart rg-test --timeout 0
  assert_rc 0
  assert_out_has "PASS healthcheck api"
  assert_out_has "PASS healthcheck alerts"
  assert_out_has "PASS healthcheck web"
  assert_az_count "containerapp revision show -n alerts -g rg-test --revision alerts--rev1" 1
  assert_az_count "containerapp revision show -n web -g rg-test --revision web--rev1" 1
}

test_restart_apps_goes_on_after_the_settle_time_when_the_replica_names_do_not_change() {
  # Container Apps may restart in place: the names never change, so the wait must end on the settle time and the
  # healthcheck conditions decide (a false FAIL here would have the operator redo a perfectly good restart)
  local began=$SECONDS
  STUB_REPLICAS_STATIC=1 RESTART_SETTLE_S=2 run_restart rg-test --timeout 0
  assert_rc 0
  [ $((SECONDS - began)) -ge 2 ] || fail "the settle time of 2 s was not waited out"
  assert_err_has "the replica names did not change within 2s"
  assert_out_has "PASS healthcheck api"
  assert_out_has "PASS healthcheck alerts"
  assert_out_has "PASS healthcheck web"
  assert_out_has "Apps restarted."
}

test_restart_apps_does_not_wait_out_the_settle_time_when_the_replicas_are_replaced() {
  HEALTH_POLL_S=0 RESTART_SETTLE_S=600 run_cmd timeout 60 bash "$scripts_dir/restart-apps.sh" rg-test --timeout 0
  assert_rc 0
  assert_err_has "api: replicas replaced"
  assert_err_has "alerts: replicas replaced"
  assert_err_has "web: replicas replaced"
}

test_restart_apps_fails_when_an_app_is_unhealthy_afterwards() {
  # whichever app it is: api and web have an ingress to check, alerts is the worker without one
  local app
  for app in api alerts web; do
    : >"$STUB_STATE_DIR/az.log"
    rm -f "$STUB_STATE_DIR"/restarted-* "$STUB_STATE_DIR"/health-*
    case "$app" in
      api) STUB_HEALTH_API="Unhealthy" run_restart rg-test --timeout 0 ;;
      alerts) STUB_HEALTH_ALERTS="Unhealthy" run_restart rg-test --timeout 0 ;;
      *) STUB_HEALTH_WEB="Unhealthy" run_restart rg-test --timeout 0 ;;
    esac
    assert_rc 1
    assert_out_has "FAIL healthcheck $app"
    assert_out_has "FAILED"
    assert_out_lacks "Apps restarted."
  done
}

test_restart_apps_gates_every_app_even_after_the_first_failure() {
  # one run reports every unhealthy app
  STUB_HEALTH_API="Unhealthy" STUB_HEALTH_WEB="Unhealthy" run_restart rg-test --timeout 0
  assert_rc 1
  assert_out_has "FAIL healthcheck api"
  assert_out_has "PASS healthcheck alerts"
  assert_out_has "FAIL healthcheck web"
}

test_restart_apps_restarts_nothing_when_an_app_has_no_latest_revision() {
  STUB_LATEST_ALERTS=None run_restart rg-test --timeout 0
  assert_rc 1
  assert_err_has "alerts has no latest revision"
  assert_az_count "revision restart" 0
}

test_restart_apps_touches_nothing_else() {
  run_restart rg-test --timeout 0
  assert_rc 0
  local line
  while IFS= read -r line; do
    case "$line" in
      "containerapp show -n api "* | "containerapp show -n alerts "* | "containerapp show -n web "* | \
        "containerapp replica list -n api "* | "containerapp replica list -n alerts "* | "containerapp replica list -n web "* | \
        "containerapp revision restart -n api "* | "containerapp revision restart -n alerts "* | "containerapp revision restart -n web "* | \
        "containerapp revision show -n api "* | "containerapp revision show -n alerts "* | "containerapp revision show -n web "*) ;;
      *) fail "unexpected az call: $line" ;;
    esac
  done <<<"$(az_log)"
  assert_az_count "containerapp update" 0
  assert_az_count "job" 0
  assert_az_count "--image" 0
  assert_az_count "secret" 0
  assert_az_count "--set-env-vars" 0
}

test_restart_apps_rejects_bad_usage() {
  run_restart
  assert_rc 1
  assert_err_has "usage"
  run_restart rg-test --timeout soon
  assert_rc 1
  assert_err_has "whole number"
  RESTART_SETTLE_S=soon run_restart rg-test
  assert_rc 1
  assert_err_has "RESTART_SETTLE_S must be a whole number"
  run_restart rg-test --bogus
  assert_rc 1
  assert_err_has "usage"
  # the options of the script this one replaced no longer exist
  run_restart rg-test --with-web
  assert_rc 1
  assert_err_has "usage"
  run_restart rg-test --now 2026-06-14T10:10:00+04:00
  assert_rc 1
  assert_err_has "usage"
  run_restart rg-test other-rg
  assert_rc 1
  assert_err_has "usage"
  assert_no_az_calls
}

# ---- reset-demo.sh ------------------------------------------------------------------------------

# run_reset <args...>: the real script; curl is the BFF stub; no waiting on a Retry-After unless the test sets RESET_MAX_WAIT_S.
# The request headers the script sends are recorded in $STUB_STATE_DIR/headers.log.
run_reset() {
  mkdir -p "$work/bff-bin"
  cp "$stubs_dir/curl-demo-bff" "$work/bff-bin/curl"
  chmod +x "$work/bff-bin/curl"
  FAKE_CURL_LOG="$STUB_STATE_DIR/bff.log" FAKE_STATE_DIR="$STUB_STATE_DIR" FAKE_HEADERS_LOG="$STUB_STATE_DIR/headers.log" \
    RESET_MAX_WAIT_S="${RESET_MAX_WAIT_S:-0}" PATH="$work/bff-bin:$PATH" \
    run_cmd bash "$scripts_dir/reset-demo.sh" http://127.0.0.1:8080 "$@"
}

test_reset_demo_prints_the_epochs_of_a_successful_reset() {
  run_reset
  assert_rc 0
  assert_out_has "PASS D1 demo reset: epoch 1 -> 2"
  [ "$(bff_count "$reset_route")" = "1" ] || fail "expected exactly one reset, saw $(bff_count "$reset_route")"
  [ "$(wc -l <"$STUB_STATE_DIR/bff.log" | tr -d ' ')" = "1" ] || fail "the script made a request other than the reset"
  # any 2xx is a success (the route answers 200; a 201 would be too), and the ids come from whatever the body says
  FAKE_RESET_STATUS=201 FAKE_RESET_BODY='{"site_id":"site-demo-mussafah","epoch_id":12,"previous_epoch_id":11,"reset_at":"2026-11-16T05:00:00Z"}' run_reset
  assert_rc 0
  assert_out_has "PASS D1 demo reset: epoch 11 -> 12"
  # a pretty-printed body and fields in another order
  FAKE_RESET_BODY='{
  "reset_at": "2026-11-16T05:00:00Z",
  "previous_epoch_id": 99,
  "epoch_id": 100,
  "site_id": "site-demo-mussafah"
}' run_reset
  assert_rc 0
  assert_out_has "PASS D1 demo reset: epoch 99 -> 100"
}

test_reset_demo_sends_no_authorization_header_and_posts_to_the_one_route() {
  run_reset
  assert_rc 0
  grep -qxF "$reset_route" "$STUB_STATE_DIR/bff.log" || fail "the request was not '$reset_route': $(cat "$STUB_STATE_DIR/bff.log")"
  if [ -e "$STUB_STATE_DIR/headers.log" ] && grep -qi 'authorization' "$STUB_STATE_DIR/headers.log"; then
    fail "an Authorization header was sent"
  fi
  # not even when a token is in the environment: nothing here reads one
  DEMO_EMPLOYER_TOKEN=do-not-send-this-token run_reset
  assert_rc 0
  assert_out_lacks "do-not-send-this-token"
  if [ -e "$STUB_STATE_DIR/headers.log" ] && grep -q 'do-not-send-this-token' "$STUB_STATE_DIR/headers.log"; then
    fail "the token reached a request header"
  fi
  # a trailing slash on the URL does not double the slash
  FAKE_CURL_LOG="$STUB_STATE_DIR/bff2.log" FAKE_STATE_DIR="$STUB_STATE_DIR" PATH="$work/bff-bin:$PATH" \
    run_cmd bash "$scripts_dir/reset-demo.sh" http://127.0.0.1:8080/
  assert_rc 0
  grep -qxF "$reset_route" "$STUB_STATE_DIR/bff2.log" || fail "a trailing slash broke the route: $(cat "$STUB_STATE_DIR/bff2.log")"
}

test_reset_demo_prints_the_retry_after_of_a_429_and_does_not_retry_by_default() {
  FAKE_RESET_STATUS=429 run_reset
  assert_rc 1
  assert_out_has "Retry-After 7"
  assert_out_has "FAIL D1 demo reset: answered 429 (Retry-After 7)"
  assert_out_has "--retry-after-once"
  [ "$(bff_count "$reset_route")" = "1" ] || fail "retried without --retry-after-once: $(bff_count "$reset_route") requests"
}

test_reset_demo_waits_the_retry_after_once_and_succeeds() {
  FAKE_RESET_STATUSES="429 200" run_reset --retry-after-once
  assert_rc 0
  assert_out_has "Retry-After 7"
  assert_out_has "waiting 0 s (Retry-After 7, cap 0)"
  assert_out_has "PASS D1 demo reset: epoch 1 -> 2"
  [ "$(bff_count "$reset_route")" = "2" ] || fail "expected two requests, saw $(bff_count "$reset_route")"
  # a 201 on the retry too
  rm -f "$STUB_STATE_DIR/reset-calls" "$STUB_STATE_DIR/bff.log"
  FAKE_RESET_STATUSES="429 201" run_reset --retry-after-once
  assert_rc 0
  assert_out_has "PASS D1"
}

test_reset_demo_caps_the_wait_and_copes_with_a_missing_retry_after() {
  # the wait is the Retry-After clamped to RESET_MAX_WAIT_S (default 70): a huge value (the hourly limit) does not hang the run
  local began=$SECONDS
  FAKE_RESET_STATUSES="429 200" FAKE_RESET_RETRY_AFTER=3600 RESET_MAX_WAIT_S=1 run_reset --retry-after-once
  assert_rc 0
  assert_out_has "waiting 1 s (Retry-After 3600, cap 1)"
  [ $((SECONDS - began)) -ge 1 ] || fail "the capped wait of 1 s did not happen"
  [ $((SECONDS - began)) -lt 30 ] || fail "the wait was not capped"
  # no Retry-After header at all: 61 s (the upstream window is 60 s), still capped
  rm -f "$STUB_STATE_DIR/reset-calls"
  FAKE_RESET_STATUSES="429 200" FAKE_RESET_RETRY_AFTER=none run_reset --retry-after-once
  assert_rc 0
  assert_out_has "Retry-After missing"
  assert_out_has "waiting 0 s (Retry-After 61, cap 0)"
  # a Retry-After that is not a number (an HTTP date) is the same
  rm -f "$STUB_STATE_DIR/reset-calls"
  FAKE_RESET_STATUSES="429 200" FAKE_RESET_RETRY_AFTER="Mon, 16 Nov 2026 05:00:00 GMT" run_reset --retry-after-once
  assert_rc 0
  assert_out_has "waiting 0 s (Retry-After 61, cap 0)"
}

test_reset_demo_gives_up_after_a_second_429() {
  FAKE_RESET_STATUS=429 run_reset --retry-after-once
  assert_rc 1
  assert_out_has "FAIL D1 demo reset: answered 429 again after the wait"
  [ "$(bff_count "$reset_route")" = "2" ] || fail "expected exactly two requests, saw $(bff_count "$reset_route")"
}

test_reset_demo_fails_on_a_409_without_retrying() {
  FAKE_RESET_STATUS=409 run_reset --retry-after-once
  assert_rc 1
  assert_out_has "FAIL D1 demo reset: answered 409"
  assert_out_has "not-a-demo-site"
  assert_out_lacks "PASS"
  [ "$(bff_count "$reset_route")" = "1" ] || fail "retried a 409: $(bff_count "$reset_route") requests"
}

test_reset_demo_fails_on_a_server_error_without_retrying() {
  local code
  for code in 500 502 503 404; do
    rm -f "$STUB_STATE_DIR/bff.log"
    FAKE_RESET_STATUS="$code" run_reset --retry-after-once
    assert_rc 1
    assert_out_has "FAIL D1 demo reset: answered $code"
    assert_out_lacks "PASS"
    [ "$(bff_count "$reset_route")" = "1" ] || fail "retried a $code: $(bff_count "$reset_route") requests"
  done
}

test_reset_demo_fails_on_a_body_it_cannot_parse() {
  local body
  for body in '<html>ok</html>' '' '{"epoch_id":2}' '{"previous_epoch_id":1}' '{"epoch_id":"2","previous_epoch_id":"1"}' '[]'; do
    FAKE_RESET_BODY="$body" run_reset
    assert_rc 1
    assert_out_has "FAIL D1 demo reset: answered 200 but the body has no numeric epoch_id and previous_epoch_id"
    assert_out_lacks "PASS"
  done
}

test_reset_demo_fails_when_nothing_answers() {
  # the plain curl stub: exit 7 and %{http_code} 000, as a refused connection
  STUB_CURL_RULES="http://=000" run_cmd bash "$scripts_dir/reset-demo.sh" http://127.0.0.1:1
  assert_rc 1
  assert_out_has "FAIL D1 demo reset: no answer from http://127.0.0.1:1/api/v1/sites/site-demo-mussafah/demo-reset"
}

test_reset_demo_rejects_bad_usage() {
  run_cmd bash "$scripts_dir/reset-demo.sh"
  assert_rc 2
  assert_err_has "usage"
  assert_err_has "[--retry-after-once]"
  run_cmd bash "$scripts_dir/reset-demo.sh" ftp://host
  assert_rc 2
  assert_err_has "must start with http:// or https://"
  run_cmd bash "$scripts_dir/reset-demo.sh" http://a http://b
  assert_rc 2
  assert_err_has "usage"
  run_cmd bash "$scripts_dir/reset-demo.sh" http://a --retry
  assert_rc 2
  assert_err_has "unknown option: --retry"
  RESET_MAX_WAIT_S=soon run_cmd bash "$scripts_dir/reset-demo.sh" http://a
  assert_rc 2
  assert_err_has "RESET_MAX_WAIT_S must be a whole number"
  [ ! -s "$STUB_STATE_DIR/curl.log" ] || fail "curl was called on a usage error"
}

# ---- measure-cold-start.sh ----------------------------------------------------------------------

run_cold() { # <args...>: no waiting; today is outside the judging window unless the test says otherwise
  COLD_START_TODAY="${COLD_START_TODAY:-2026-11-15}" COLD_POLL_S=0 run_cmd bash "$scripts_dir/measure-cold-start.sh" "$@"
}

test_measure_cold_start_refuses_inside_the_judging_window() {
  local day
  for day in 2026-11-20 2026-11-25 2026-12-11; do
    COLD_START_TODAY="$day" run_cold rg-test
    assert_rc 1
    assert_err_has "judging window"
    assert_no_az_calls
  done
}

test_measure_cold_start_runs_just_outside_the_window() {
  local day
  for day in 2026-11-19 2026-12-12; do
    : >"$STUB_STATE_DIR/az.log"
    COLD_START_TODAY="$day" run_cold rg-test
    assert_rc 0
    assert_out_has "COLD START:"
  done
}

test_measure_cold_start_i_know_overrides_the_window() {
  COLD_START_TODAY=2026-11-25 run_cold rg-test --i-know
  assert_rc 0
  assert_err_has "WARNING"
  assert_out_has "COLD START:"
}

test_measure_cold_start_scales_to_zero_measures_and_restores() {
  run_cold rg-test
  assert_rc 0
  assert_out_has "COLD START: 0.123 s to first 200 from https://web.stub.uaenorth.azurecontainerapps.io/api/v1/health/ready"
  assert_out_has "The api restarted. The replay clock counts from the demo epoch in the database, so it is unchanged and nothing needs restarting."
  assert_out_lacks "REMINDER"
  assert_out_lacks "restart-replay-clock"
  assert_az_count "containerapp update -n web -g rg-test --min-replicas 0" 1
  assert_az_count "containerapp update -n api -g rg-test --min-replicas 0" 1
  assert_az_count "containerapp update -n web -g rg-test --min-replicas 1" 1
  assert_az_count "containerapp update -n api -g rg-test --min-replicas 1" 1
  assert_az_count "alerts" 0
  # restored only after the zero-wait: the last two updates are the restores
  local zeros ones
  zeros="$(az_line "--min-replicas 0" | awk '{print $NF}')"
  ones="$(az_line "--min-replicas 1" | awk '{print $1}')"
  [ "$ones" -gt "$zeros" ] || fail "min replicas were restored before the measurement"
  grep -qF "https://web.stub.uaenorth.azurecontainerapps.io/api/v1/health/ready" "$STUB_STATE_DIR/curl.log" || fail "curl did not call the web URL"
}

test_measure_cold_start_takes_a_path_and_one_app() {
  run_cold rg-test /api/healthz web
  assert_rc 0
  assert_out_has "https://web.stub.uaenorth.azurecontainerapps.io/api/healthz (scaled to zero: web)"
  assert_az_count "containerapp update -n api" 0
  assert_out_has "The api was not scaled."
  assert_out_lacks "nothing needs restarting"
  run_cold rg-test /x alerts
  assert_rc 1
  assert_err_has "must be web or api"
}

test_measure_cold_start_restores_when_the_replicas_never_leave() {
  STUB_REPLICAS_STAY=1 COLD_TIMEOUT_S=0 run_cold rg-test
  assert_rc 1
  assert_err_has "still has replica(s)"
  assert_az_count "containerapp update -n web -g rg-test --min-replicas 1" 1
  assert_az_count "containerapp update -n api -g rg-test --min-replicas 1" 1
  assert_out_lacks "COLD START:"
}

test_measure_cold_start_restores_when_the_request_fails() {
  STUB_CURL_RULES="https://=503" run_cold rg-test
  assert_rc 1
  assert_err_has "answered 503"
  assert_az_count "containerapp update -n web -g rg-test --min-replicas 1" 1
  assert_az_count "containerapp update -n api -g rg-test --min-replicas 1" 1
  : >"$STUB_STATE_DIR/az.log"
  STUB_CURL_RULES="https://=000" run_cold rg-test
  assert_rc 1
  assert_az_count "--min-replicas 1" 2
}

test_measure_cold_start_restores_the_apps_it_had_touched_when_scaling_fails_midway() {
  # a failing update on the way down: whatever was touched (including the failed one) is restored, and a failed restore is loud
  STUB_UPDATE_FAIL=1 run_cold rg-test
  assert_rc 1
  assert_err_has "run 'az containerapp update -n web -g rg-test --min-replicas 1' NOW"
  assert_az_count "--min-replicas 1" 1
}

test_measure_cold_start_rejects_bad_usage() {
  run_cold
  assert_rc 1
  assert_err_has "usage"
  run_cold rg-test api/v1
  assert_rc 1
  assert_err_has "must start with /"
}

# ---- runner -------------------------------------------------------------------------------------

tests=(
  test_preflight_passes_on_happy_stub
  test_preflight_picks_17_when_18_absent
  test_preflight_matches_short_location_name
  test_preflight_accepts_display_name_argument
  test_preflight_fails_p1_when_location_missing
  test_preflight_fails_p1_for_other_location
  test_preflight_fails_p2_when_no_b1ms
  test_preflight_fails_p3_when_provider_not_registered
  test_preflight_fails_p4_when_not_owner
  test_preflight_rejects_unknown_argument
  test_retry_succeeds_after_failures
  test_retry_gives_up_and_returns_failure
  test_require_env_names_every_missing_variable
  test_require_env_passes_when_all_set
  test_die_exits_1_with_message
  test_bicep_build_prefers_bicep_bin
  test_bicep_build_falls_back_to_az
  test_curl_stub_scenarios
  test_docker_stub_records_arguments
  test_az_stub_serves_the_container_app_queries
  test_find_bicep_prefers_bicep_bin
  test_find_bicep_fails_when_there_is_none
  test_find_python_returns_an_interpreter
  test_check_template_passes_on_the_repo_template
  test_check_template_rejects_bad_usage
  test_check_template_c1_fails_when_an_output_leaks_a_secret
  test_check_template_c2_fails_on_a_dedicated_workload_profile
  test_check_template_c3_fails_on_an_external_api
  test_check_template_c3_fails_on_two_replicas
  test_check_template_c3_fails_on_allow_insecure
  test_check_template_c3_fails_on_multiple_revisions
  test_check_template_c4_fails_when_a_pin_is_emitted_empty
  test_check_template_c5_fails_when_the_job_runs_alembic
  test_check_template_c6_fails_when_the_worker_args_are_missing
  test_check_template_c7_fails_when_the_api_gets_the_vapid_key
  test_check_template_c7_fails_when_the_subject_is_sent_without_the_key
  test_check_template_c8_fails_when_the_replay_settings_differ
  test_check_template_c9_fails_when_a_secret_is_an_env_value
  test_check_template_c9_fails_on_a_dangling_secret_ref
  test_check_template_c10_fails_when_phase_1_creates_the_api
  test_check_template_c10_fails_when_a_placeholder_api_gets_the_worker
  test_check_db_tls_template_passes_on_the_repo_template
  test_check_db_tls_template_fails_on_ssl_require
  test_check_db_tls_template_fails_on_sslmode
  test_check_db_tls_template_fails_without_pgsslrootcert
  test_check_db_tls_template_fails_when_only_the_job_loses_pgsslrootcert
  test_check_db_tls_deployed_passes_when_everything_verifies
  test_check_db_tls_deployed_fails_when_the_secret_lacks_verify_full
  test_check_db_tls_deployed_names_the_one_weak_container
  test_check_db_tls_deployed_fails_without_the_root_cert_env
  test_check_db_tls_deployed_keeps_the_url_out_of_a_shell_trace
  test_check_db_tls_image_runs_the_ca_check_in_the_image
  test_check_db_tls_image_fails_when_the_ca_check_fails
  test_check_db_tls_image_against_a_real_image
  test_check_db_tls_rejects_bad_usage
  test_resolve_image_placeholder_when_no_dockerfile
  test_resolve_image_real_api
  test_resolve_image_real_web
  test_resolve_image_appends_to_github_output
  test_resolve_image_rejects_values_that_could_inject_an_output_line
  test_run_migrate_skips_when_placeholder
  test_run_migrate_succeeds
  test_run_migrate_polls_until_the_execution_ends
  test_run_migrate_fails_on_a_failed_execution_after_two_attempts
  test_run_migrate_succeeds_on_the_second_attempt
  test_run_migrate_retries_after_stopped_and_degraded
  test_run_migrate_treats_a_timeout_as_a_failed_attempt
  test_run_migrate_honours_the_attempts_setting
  test_run_migrate_fails_when_the_job_is_missing
  test_run_migrate_stops_before_starting_when_the_job_runs_another_image
  test_run_migrate_never_overrides_the_job
  test_run_migrate_identifies_the_new_execution_by_the_list_when_start_prints_nothing
  test_run_migrate_fails_when_start_prints_nothing_and_only_an_old_execution_is_listed
  test_run_migrate_ignores_an_old_execution_when_the_new_one_is_listed
  test_run_migrate_waits_for_the_new_execution_to_appear_in_the_list
  test_run_migrate_treats_none_from_the_start_as_empty
  test_run_migrate_does_not_trust_a_start_answer_that_existed_before_the_start
  test_run_migrate_fails_when_the_list_is_unreadable_and_start_prints_nothing
  test_run_migrate_uses_the_start_answer_when_the_list_is_unreadable
  test_run_migrate_fails_when_the_job_cannot_be_started
  test_run_migrate_rejects_bad_usage
  test_healthcheck_passes_on_the_happy_fixture
  test_healthcheck_fails_when_the_active_image_differs
  test_healthcheck_fails_when_latest_ready_differs_from_latest
  test_healthcheck_fails_when_unhealthy
  test_healthcheck_fails_while_provisioning
  test_healthcheck_fails_when_not_running
  test_healthcheck_fails_when_traffic_is_not_100
  test_healthcheck_fails_without_a_replica
  test_healthcheck_no_ingress_accepts_none_but_the_default_does_not
  test_healthcheck_polls_until_healthy
  test_healthcheck_makes_one_attempt_with_timeout_zero
  test_healthcheck_url_failure_fails
  test_healthcheck_url_passes_and_checks_the_json
  test_healthcheck_only_takes_an_https_url
  test_healthcheck_reports_an_unreadable_revision
  test_healthcheck_rejects_bad_usage
  test_smoke_passes_on_the_happy_run
  test_smoke_waits_out_the_rate_limit_window_unless_told_not_to
  test_smoke_reports_fail_s1_on_dedicated_profile
  test_smoke_reports_fail_s1_on_a_private_endpoint
  test_smoke_reports_fail_s4_when_the_api_ingress_is_external
  test_smoke_reports_fail_s4_when_the_worker_has_an_ingress
  test_smoke_reports_fail_s2_when_max_replicas_is_3
  test_smoke_reports_fail_s6_on_a_resource_in_another_region
  test_smoke_s6_follows_expect_location
  test_smoke_reports_fail_s7_when_plain_http_is_served
  test_smoke_s7_accepts_a_refusal
  test_smoke_reports_fail_s5_when_the_worker_is_not_running
  test_smoke_reports_fail_s8_when_the_database_url_is_weak
  test_smoke_passes_the_http_failures_through_as_s3_and_s9
  test_smoke_placeholder_runs_only_the_cost_and_reachability_checks
  test_smoke_placeholder_fails_when_the_web_root_is_not_200
  test_smoke_rejects_bad_usage
  test_smoke_http_passes_and_never_resets_when_h3_passes
  test_smoke_http_h3_failure_prints_the_recovery_and_resets_nothing_by_default
  test_smoke_http_h3_failure_with_the_flag_resets_exactly_once
  test_smoke_http_h3_failure_with_the_flag_reports_a_reset_that_fails
  test_smoke_http_a_red_timeline_after_the_undo_also_gets_the_recovery
  test_smoke_http_no_reset_when_no_stop_was_created
  test_smoke_http_rejects_an_unknown_option_and_documents_the_flag
  test_smoke_http_h4_outside_the_window_says_to_run_reset_demo
  test_restart_apps_restarts_api_alerts_and_web_back_to_back_before_any_wait
  test_restart_apps_waits_with_the_healthcheck_conditions
  test_restart_apps_goes_on_after_the_settle_time_when_the_replica_names_do_not_change
  test_restart_apps_does_not_wait_out_the_settle_time_when_the_replicas_are_replaced
  test_restart_apps_fails_when_an_app_is_unhealthy_afterwards
  test_restart_apps_gates_every_app_even_after_the_first_failure
  test_restart_apps_restarts_nothing_when_an_app_has_no_latest_revision
  test_restart_apps_touches_nothing_else
  test_restart_apps_rejects_bad_usage
  test_reset_demo_prints_the_epochs_of_a_successful_reset
  test_reset_demo_sends_no_authorization_header_and_posts_to_the_one_route
  test_reset_demo_prints_the_retry_after_of_a_429_and_does_not_retry_by_default
  test_reset_demo_waits_the_retry_after_once_and_succeeds
  test_reset_demo_caps_the_wait_and_copes_with_a_missing_retry_after
  test_reset_demo_gives_up_after_a_second_429
  test_reset_demo_fails_on_a_409_without_retrying
  test_reset_demo_fails_on_a_server_error_without_retrying
  test_reset_demo_fails_on_a_body_it_cannot_parse
  test_reset_demo_fails_when_nothing_answers
  test_reset_demo_rejects_bad_usage
  test_measure_cold_start_refuses_inside_the_judging_window
  test_measure_cold_start_runs_just_outside_the_window
  test_measure_cold_start_i_know_overrides_the_window
  test_measure_cold_start_scales_to_zero_measures_and_restores
  test_measure_cold_start_takes_a_path_and_one_app
  test_measure_cold_start_restores_when_the_replicas_never_leave
  test_measure_cold_start_restores_when_the_request_fails
  test_measure_cold_start_restores_the_apps_it_had_touched_when_scaling_fails_midway
  test_measure_cold_start_rejects_bad_usage
)

# needs_bicep <test name>: success for the tests that compile the real template with bicep (slow: about 6 minutes in total).
needs_bicep() {
  case "$1" in
    test_check_template_rejects_bad_usage) return 1 ;;
    test_check_template_* | test_check_db_tls_template_*) return 0 ;;
    *) return 1 ;;
  esac
}

# Arguments: --fast and/or a name part that selects the tests whose name contains it (for example: bash run.sh check_db_tls_deployed).
fast=false
filter=""
for arg in "$@"; do
  case "$arg" in
    --fast) fast=true ;;
    -*)
      printf 'unknown option: %s (usage: run.sh [--fast] [name part])\n' "$arg" >&2
      exit 2
      ;;
    *) filter="$arg" ;;
  esac
done

ran=0
skipped=0
for current_test in "${tests[@]}"; do
  case "$current_test" in *"$filter"*) ;; *) continue ;; esac
  if [ "$fast" = true ] && needs_bicep "$current_test"; then
    printf 'skip %s (--fast: needs bicep)\n' "${current_test#test_}"
    skipped=$((skipped + 1))
    continue
  fi
  out=""
  err=""
  # a fresh state directory per test: the az stub keeps its counters and its call log (az.log) there, the curl stub curl.log
  STUB_STATE_DIR="$work/state/$current_test"
  rm -rf "$STUB_STATE_DIR"
  mkdir -p "$STUB_STATE_DIR"
  export STUB_STATE_DIR
  export STUB_AZ_LOG="$STUB_STATE_DIR/az.log"
  export STUB_CURL_LOG="$STUB_STATE_DIR/curl.log"
  "$current_test"
  printf 'ok %s\n' "${current_test#test_}"
  ran=$((ran + 1))
done
if [ "$ran" -eq 0 ]; then
  printf 'no test matches "%s"\n' "$filter" >&2
  exit 1
fi
if [ "$skipped" -gt 0 ]; then
  printf 'all %s tests passed (%s skipped by --fast)\n' "$ran" "$skipped"
else
  printf 'all %s tests passed\n' "$ran"
fi
