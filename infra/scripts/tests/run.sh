#!/usr/bin/env bash
# Self-tests for the infra scripts, with `az` and `curl` replaced by stubs. Run from anywhere:
#   bash infra/scripts/tests/run.sh
# Works under Git Bash and on Ubuntu CI. It does not rely on the executable bit: the stubs are
# committed without it, so each is invoked through a generated wrapper that calls `bash <stub>`.
# One function per case; the first failing assertion stops the run with a non-zero exit.

set -euo pipefail

tests_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scripts_dir="$(cd "$tests_dir/.." && pwd)"
stubs_dir="$tests_dir/stubs"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
bin="$work/bin"
mkdir -p "$bin"

for tool in az curl docker; do
  printf '#!/usr/bin/env bash\nexec bash "%s/%s" "$@"\n' "$stubs_dir" "$tool" >"$bin/$tool"
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
)

# An optional argument selects the tests whose name contains it (for example: bash run.sh check_db_tls_deployed).
filter="${1:-}"
ran=0
for current_test in "${tests[@]}"; do
  case "$current_test" in *"$filter"*) ;; *) continue ;; esac
  out=""
  err=""
  "$current_test"
  printf 'ok %s\n' "${current_test#test_}"
  ran=$((ran + 1))
done
if [ "$ran" -eq 0 ]; then
  printf 'no test matches "%s"\n' "$filter" >&2
  exit 1
fi
printf 'all %s tests passed\n' "$ran"
