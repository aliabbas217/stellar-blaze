#!/usr/bin/env bash
# Static checks on the deploy workflow. grep, awk and bash only: no yq and no YAML parser, so the checks are line based and
# assume the layout GitHub's own examples use (jobs at two spaces, job keys at four, steps at six). They are a guard against
# a careless edit, not a YAML validator: actionlint (run next to this script in ci.yml) is the syntax check.
#
#   check-workflow.sh [path of deploy.yml]      default: .github/workflows/deploy.yml of this repository
#
# Prints one `PASS|FAIL W<n> <subject>` line per check (reasons indented under a FAIL) and exits 1 on any FAIL.
#   W1  every `uses:` is pinned to a 40-hex commit SHA (a local `./` action excepted)
#   W2  no `pull_request_target`; every job guard that mentions workflow_run also requires the triggering event to be `push`
#   W3  build-api: the step that checks the image's CA bundle (check-db-tls.sh --image) comes BEFORE the step that pushes it
#   W4  deploy: what-if, create, migrate, TLS and revision gates, restart, wait for the cold api, reset, smoke test and the final
#       reset run in order
#   W5  deploy needs build-api and build-web; build-api, build-web and deploy all run in the GitHub environment `demo`
#   W6  no `${{ secrets.* }}` inside any `run:` block (a secret reaches a script only through `env:`)
#   W7  `permissions` is exactly contents: read and id-token: write, nothing broader, at the top and in every job
#   W8  cheap mode: deploy exports API_MIN_REPLICAS from the repository variable (default 0) and uses it: the api gate gets
#       --allow-zero-replicas INSIDE the `if [ "$API_MIN_REPLICAS" = 0 ]` conditional (never in min-1 mode) and the smoke test
#       gets --api-min "$API_MIN_REPLICAS"
#   W9  the final reset-demo.sh step of deploy has always() in its `if:` (its recovery for a stop a failed smoke test left
#       behind must run after that failure)

set -euo pipefail

scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$scripts_dir/lib.sh"

workflow="${1:-$scripts_dir/../../.github/workflows/deploy.yml}"
[ "$#" -le 1 ] || die "usage: check-workflow.sh [path of deploy.yml]"
[ -f "$workflow" ] || die "no such workflow file: $workflow"

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
# raw: the file without carriage returns. clean: the same with every full-line YAML comment blanked, so a comment that
# names a command can never satisfy (or break) a check; line numbers are unchanged.
raw="$tmp/raw.yml"
clean="$tmp/clean.yml"
awk '{ sub(/\r$/, ""); print }' "$workflow" >"$raw"
awk '/^[[:space:]]*#/ { print ""; next } { print }' "$raw" >"$clean"

failed=0

# report <id> <subject> [reason...]: PASS without reasons, FAIL with them.
report() {
  local id="$1" subject="$2" reason
  shift 2
  if [ "$#" -eq 0 ]; then
    printf 'PASS %s %s\n' "$id" "$subject"
  else
    printf 'FAIL %s %s\n' "$id" "$subject"
    for reason in "$@"; do
      printf '  - %s\n' "$reason"
    done
    failed=1
  fi
}

# jobs: the job names, one per line.
jobs() {
  awk '
    /^jobs:[[:space:]]*$/ { in_jobs = 1; next }
    in_jobs && /^[^[:space:]]/ { in_jobs = 0 }
    in_jobs && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { name = $1; sub(/:$/, "", name); print name }
  ' "$clean"
}

# job_bounds <job>: "<first line> <last line>" of the job block, nothing when there is no such job.
job_bounds() {
  awk -v job="$1" '
    /^jobs:[[:space:]]*$/ { in_jobs = 1; next }
    in_jobs && /^[^[:space:]]/ { in_jobs = 0 }
    in_jobs && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ {
      name = $1; sub(/:$/, "", name)
      if (found && !done) { last = NR - 1; done = 1 }
      if (name == job) { first = NR; found = 1 }
      next
    }
    END { if (found) { if (!done) last = NR; print first, last } }
  ' "$clean"
}

# first_match <job> <ERE> <after-line>: the first line number greater than <after-line> inside the job that matches, or nothing.
first_match() {
  local bounds
  bounds="$(job_bounds "$1")"
  [ -n "$bounds" ] || return 0
  awk -v lo="${bounds% *}" -v hi="${bounds#* }" -v after="$3" -v re="$2" '
    NR > lo && NR <= hi && NR > after && $0 ~ re { print NR; exit }
  ' "$clean"
}

# job_if <job>: the text of the job-level `if:` (the key line and its continuation lines), nothing when there is none.
job_if() {
  local bounds
  bounds="$(job_bounds "$1")"
  [ -n "$bounds" ] || return 0
  awk -v lo="${bounds% *}" -v hi="${bounds#* }" '
    NR <= lo || NR > hi { next }
    grabbing {
      if ($0 ~ /^[[:space:]]*$/) next
      match($0, /^ */)
      if (RLENGTH > 4) { text = text " " $0; next }
      grabbing = 0
    }
    /^    if:/ { text = $0; grabbing = 1 }
    END { if (text != "") print text }
  ' "$clean"
}

# ---- W1 ---------------------------------------------------------------------------------------------------------------

check_w1() {
  local problems=() line number ref seen=0
  while IFS= read -r line; do
    number="${line%%:*}"
    ref="${line#*uses:}"
    ref="${ref%%#*}"
    ref="${ref//[[:space:]]/}"
    case "$ref" in ./*) continue ;; *) ;; esac
    seen=$((seen + 1))
    if ! [[ "$ref" =~ @[0-9a-f]{40}$ ]]; then
      problems+=("line $number: '$ref' is not pinned to a 40-hex commit SHA")
    fi
  done < <(grep -nE '^[[:space:]]*(-[[:space:]]+)?uses:' "$clean" || true)
  if [ "$seen" -eq 0 ]; then
    problems+=("no 'uses:' line was found: the check saw nothing")
  fi
  report W1 "every action is pinned to a 40-hex commit SHA" ${problems[@]+"${problems[@]}"}
}

# ---- W2 ---------------------------------------------------------------------------------------------------------------

check_w2() {
  local problems=() line job text
  while IFS= read -r line; do
    problems+=("pull_request_target is used: ${line}")
  done < <(grep -nE 'pull_request_target' "$clean" || true)
  if grep -qE '^[[:space:]]+workflow_run:' "$clean"; then
    while IFS= read -r job; do
      text="$(job_if "$job")"
      case "$text" in
        "") problems+=("job $job has no 'if:' although the workflow runs on workflow_run") ;;
        *"workflow_run.event == 'push'"*) ;;
        *) problems+=("job $job: its 'if:' does not require github.event.workflow_run.event == 'push'") ;;
      esac
    done < <(jobs)
  else
    problems+=("the workflow has no workflow_run trigger: the guard this check pins is gone")
  fi
  report W2 "no pull_request_target; the workflow_run guard requires event == 'push' in every job" ${problems[@]+"${problems[@]}"}
}

# ---- W3 ---------------------------------------------------------------------------------------------------------------

check_w3() {
  local problems=() verify push
  verify="$(first_match build-api 'check-db-tls[.]sh --image' 0)"
  push="$(first_match build-api 'docker push|^[[:space:]]+push: true' 0)"
  if [ -z "$verify" ]; then
    problems+=("build-api has no step running check-db-tls.sh --image")
  fi
  if [ -z "$push" ]; then
    problems+=("build-api has no step that pushes the image (docker push or push: true)")
  fi
  if [ -n "$verify" ] && [ -n "$push" ] && [ "$verify" -gt "$push" ]; then
    problems+=("build-api pushes the image (line $push) before check-db-tls.sh --image (line $verify)")
  fi
  report W3 "build-api checks the image (check-db-tls.sh --image) before it pushes it" ${problems[@]+"${problems[@]}"}
}

# ---- W4 ---------------------------------------------------------------------------------------------------------------

check_w4() {
  local problems=() i line after=0
  local -a labels=(
    "check-db-tls.sh --template"
    "check-template.sh"
    "phase 1 what-if"
    "phase 1 create"
    "run-migrate.sh"
    "phase 2 what-if"
    "phase 2 create"
    "check-db-tls.sh --deployed"
    "healthcheck.sh gate api"
    "healthcheck.sh gate web"
    "healthcheck.sh gate alerts"
    "restart-apps.sh"
    "wait-ready.sh (the api may be cold)"
    "reset-demo.sh (before the smoke test)"
    "smoke.sh"
    "reset-demo.sh --retry-after-once (final)"
  )
  local -a patterns=(
    'check-db-tls[.]sh --template'
    'check-template[.]sh'
    'deployment group what-if'
    'deployment group create.*main-p1-'
    'run-migrate[.]sh'
    'deployment group what-if'
    'deployment group create.*main-p2-'
    'check-db-tls[.]sh --deployed'
    'healthcheck[.]sh --app api'
    '--app web'
    'healthcheck[.]sh --app alerts'
    'restart-apps[.]sh'
    'wait-ready[.]sh'
    'reset-demo[.]sh'
    'smoke[.]sh'
    'reset-demo[.]sh.*--retry-after-once'
  )
  for i in "${!patterns[@]}"; do
    line="$(first_match deploy "${patterns[$i]}" "$after")"
    if [ -z "$line" ]; then
      problems+=("deploy: ${labels[$i]} is missing, or comes before line $after")
      break
    fi
    after="$line"
  done
  report W4 "deploy runs checks, what-if, create, migrate, gates, restart, cold-start wait, reset, smoke and a final reset in order" ${problems[@]+"${problems[@]}"}
}

# ---- W5 ---------------------------------------------------------------------------------------------------------------

check_w5() {
  local problems=() line job text
  line="$(first_match deploy '^    needs:' 0)"
  if [ -z "$line" ]; then
    problems+=("deploy has no 'needs:'")
  else
    text="$(awk -v n="$line" 'NR == n { print }' "$clean")"
    for job in build-api build-web; do
      case "$text" in *"$job"*) ;; *) problems+=("deploy: needs does not list $job ($text)") ;; esac
    done
  fi
  for job in build-api build-web deploy; do
    if [ -z "$(first_match "$job" '^    environment: demo[[:space:]]*$' 0)" ]; then
      problems+=("job $job does not run in 'environment: demo'")
    fi
  done
  report W5 "deploy needs [build-api, build-web]; all three jobs run in environment demo" ${problems[@]+"${problems[@]}"}
}

# ---- W6 ---------------------------------------------------------------------------------------------------------------

check_w6() {
  local problems=() line
  # On the raw text: a `#` line inside a block scalar is still script text, and Actions expands expressions in it.
  while IFS= read -r line; do
    problems+=("a secret expression is inside a run: block: ${line}")
  done < <(
    awk '
      function indent_of(s) { match(s, /^ */); return RLENGTH }
      in_run {
        if ($0 ~ /^[[:space:]]*$/) next
        if (indent_of($0) > key_col) {
          if ($0 ~ /[$][{][{][^}]*secrets/) print NR ": " $0
          next
        }
        if ($0 ~ /^[[:space:]]*#/) next
        in_run = 0
      }
      $0 ~ /^[[:space:]]*(-[[:space:]]+)?run:/ {
        match($0, /^[[:space:]]*(-[[:space:]]+)?/)
        key_col = RLENGTH
        rest = $0
        sub(/^[[:space:]]*(-[[:space:]]+)?run:[[:space:]]*/, "", rest)
        if (rest ~ /^[|>][-+0-9]*[[:space:]]*$/) { in_run = 1 }
        else if (rest ~ /[$][{][{][^}]*secrets/) print NR ": " $0
      }
    ' "$raw"
  )
  report W6 "no \${{ secrets.* }} inside a run: block (secrets only under env:)" ${problems[@]+"${problems[@]}"}
}

# ---- W7 ---------------------------------------------------------------------------------------------------------------

check_w7() {
  local problems=() line
  while IFS= read -r line; do
    problems+=("$line")
  done < <(
    awk '
      function indent_of(s) { match(s, /^ */); return RLENGTH }
      $0 ~ /^[[:space:]]*$/ { next }
      in_block {
        if (indent_of($0) > block_indent) {
          key = $0; sub(/^[[:space:]]+/, "", key); value = key
          sub(/:.*$/, "", key); sub(/^[^:]*:[[:space:]]*/, "", value); sub(/[[:space:]]*#.*$/, "", value)
          if (key == "contents" && value == "read") { if (scope == "top") have_contents = 1 }
          else if (key == "id-token" && value == "write") { if (scope == "top") have_id_token = 1 }
          else print "line " NR ": " scope " permissions " key ": " value " is not allowed"
          next
        }
        in_block = 0
      }
      /^permissions:/ || /^    permissions:/ {
        scope = ($0 ~ /^permissions:/) ? "top" : "job"
        if (scope == "top") seen_top = 1
        value = $0; sub(/^[[:space:]]*permissions:[[:space:]]*/, "", value); sub(/[[:space:]]*#.*$/, "", value)
        if (value != "") print "line " NR ": " scope " permissions is the inline value " value
        else { in_block = 1; block_indent = indent_of($0) }
      }
      END {
        if (!seen_top) print "there is no top-level permissions block"
        if (!have_contents) print "top-level permissions lacks contents: read"
        if (!have_id_token) print "top-level permissions lacks id-token: write"
      }
    ' "$clean"
  )
  report W7 "permissions are exactly contents: read and id-token: write" ${problems[@]+"${problems[@]}"}
}

# ---- W8 ---------------------------------------------------------------------------------------------------------------

# api_gate_conditional: the text of the first `if [ "$API_MIN_REPLICAS" = 0 ]` conditional of the deploy job, from the `if` up to
# and including its `fi` (nothing when the job has no such conditional).
api_gate_conditional() {
  local bounds
  bounds="$(job_bounds deploy)"
  [ -n "$bounds" ] || return 0
  awk -v lo="${bounds% *}" -v hi="${bounds#* }" '
    NR <= lo || NR > hi { next }
    !inif && /if \[ "[$]API_MIN_REPLICAS" = 0 \]/ { inif = 1 }
    inif {
      print
      if ($0 ~ /(^|[[:space:];])fi([[:space:];]|$)/) exit
    }
  ' "$clean"
}

check_w8() {
  local problems=() i conditional
  local -a labels=(
    "the job env entry API_MIN_REPLICAS from vars.API_MIN_REPLICAS with a default"
    "the api gate passing its flags array to healthcheck.sh --app api"
    "smoke.sh --api-min \"\$API_MIN_REPLICAS\""
  )
  local -a patterns=(
    '^      API_MIN_REPLICAS: [$][{][{] vars[.]API_MIN_REPLICAS [|][|] '
    'healthcheck[.]sh --app api .*flags[[]@[]]'
    '--api-min "[$]API_MIN_REPLICAS"'
  )
  for i in "${!patterns[@]}"; do
    if [ -z "$(first_match deploy "${patterns[$i]}" 0)" ]; then
      problems+=("deploy lacks ${labels[$i]}")
    fi
  done
  # the flag must be inside the conditional on API_MIN_REPLICAS = 0: a flag anywhere else (or a conditional on another value)
  # would excuse a missing replica in min-1 mode, or never excuse it in cheap mode
  conditional="$(api_gate_conditional)"
  if [ -z "$conditional" ]; then
    problems+=("deploy lacks the conditional if [ \"\$API_MIN_REPLICAS\" = 0 ] that adds the api gate flag")
  else
    case "$conditional" in
      *"flags+=(--allow-zero-replicas)"*) ;;
      *) problems+=("deploy lacks the api gate flag --allow-zero-replicas inside if [ \"\$API_MIN_REPLICAS\" = 0 ]") ;;
    esac
  fi
  if [ -z "$(first_match deploy '--allow-zero-replicas' 0)" ]; then
    problems+=("deploy lacks the api gate flag --allow-zero-replicas")
  fi
  report W8 "deploy takes API_MIN_REPLICAS (default 0) and passes it to the api gate (--allow-zero-replicas only when it is 0) and the smoke test" ${problems[@]+"${problems[@]}"}
}

# ---- W9 ---------------------------------------------------------------------------------------------------------------

# step_if <job> <ERE>: the `if:` text (key line plus continuation lines) of the LAST step of the job that has a line matching
# <ERE>; nothing when no step matches or the step has no `if:`. Steps start at `      - ` (six spaces), their keys sit at eight.
step_if() {
  local bounds
  bounds="$(job_bounds "$1")"
  [ -n "$bounds" ] || return 0
  awk -v lo="${bounds% *}" -v hi="${bounds#* }" -v re="$2" '
    function indent_of(s) { match(s, /^ */); return RLENGTH }
    function close_step() { if (hit) result = iftext; hit = 0; iftext = ""; grabbing = 0 }
    NR <= lo || NR > hi { next }
    /^      - / { close_step() }
    grabbing {
      if ($0 ~ /^[[:space:]]*$/) next
      if (indent_of($0) > 8) { iftext = iftext " " $0; next }
      grabbing = 0
    }
    /^        if:/ { iftext = $0; grabbing = 1 }
    $0 ~ re { hit = 1 }
    END { close_step(); if (result != "") print result }
  ' "$clean"
}

check_w9() {
  local problems=() text
  if [ -z "$(first_match deploy 'reset-demo[.]sh.*--retry-after-once' 0)" ]; then
    problems+=("deploy has no final reset-demo.sh --retry-after-once step")
  else
    text="$(step_if deploy 'reset-demo[.]sh.*--retry-after-once')"
    case "$text" in
      "") problems+=("the final reset-demo.sh step has no 'if:': it would not run after a failed step, and the stop a failed smoke test leaves behind would stay") ;;
      *"always()"*) ;;
      *) problems+=("the final reset-demo.sh step's 'if:' lacks always(): it would not run after a failed step ($text)") ;;
    esac
  fi
  report W9 "the final reset of the deploy job runs even after a failed step (if: always() && ...)" ${problems[@]+"${problems[@]}"}
}

check_w1
check_w2
check_w3
check_w4
check_w5
check_w6
check_w7
check_w8
check_w9

exit "$failed"
