# shellcheck shell=bash
# Shared helpers for the infra scripts. Source this file; it sets no shell options itself,
# the calling script owns `set -euo pipefail`.

# log <msg...>: one line on stderr with an ISO-8601 UTC timestamp.
log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

# die <msg...>: log an error and exit 1.
die() {
  log "ERROR: $*"
  exit 1
}

# require_env VAR...: exit 1 naming every variable that is unset or empty.
require_env() {
  local name missing=()
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      missing+=("$name")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    die "missing required environment variable(s): ${missing[*]}"
  fi
}

# retry <attempts> <sleep_s> <cmd...>: run cmd until it succeeds or attempts are used up.
# Returns the exit status of the last attempt.
retry() {
  local attempts="$1" sleep_s="$2" n=1 rc=0
  shift 2
  while true; do
    rc=0
    "$@" || rc=$?
    if [ "$rc" -eq 0 ]; then
      return 0
    fi
    if [ "$n" -ge "$attempts" ]; then
      log "giving up after $n attempt(s): $*"
      return "$rc"
    fi
    log "attempt $n/$attempts failed (exit $rc), retrying in ${sleep_s}s: $*"
    sleep "$sleep_s"
    n=$((n + 1))
  done
}

# bicep_build <file>: print the compiled ARM template (JSON) on stdout.
# Uses $BICEP_BIN when set, else `bicep` on PATH, else `az bicep build --stdout`.
bicep_build() {
  local file="$1"
  if [ -n "${BICEP_BIN:-}" ]; then
    "$BICEP_BIN" build "$file" --stdout
  elif command -v bicep >/dev/null 2>&1; then
    bicep build "$file" --stdout
  else
    az bicep build --file "$file" --stdout
  fi
}
