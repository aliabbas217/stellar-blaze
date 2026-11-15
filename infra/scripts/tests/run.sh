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

for tool in az curl; do
  printf '#!/usr/bin/env bash\nexec bash "%s/%s" "$@"\n' "$stubs_dir" "$tool" >"$bin/$tool"
  chmod +x "$bin/$tool"
done
export PATH="$bin:$PATH"

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
)

for current_test in "${tests[@]}"; do
  out=""
  err=""
  "$current_test"
  printf 'ok %s\n' "${current_test#test_}"
done
printf 'all %s tests passed\n' "${#tests[@]}"
