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

# find_bicep: print the path of a bicep executable: $BICEP_BIN, else `bicep` on PATH, else the copy that
# `az bicep install` leaves in ~/.azure/bin. Returns 1 (and prints nothing) when there is none.
find_bicep() {
  local candidate
  if [ -n "${BICEP_BIN:-}" ]; then
    printf '%s\n' "$BICEP_BIN"
    return 0
  fi
  if candidate="$(command -v bicep 2>/dev/null)" && [ -n "$candidate" ]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  for candidate in "$HOME/.azure/bin/bicep" "$HOME/.azure/bin/bicep.exe"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

# find_python: print the name of a Python 3 interpreter (python3, else python). Returns 1 when there is none.
find_python() {
  local candidate
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

# az_tsv <az args...>: run `az <args> -o tsv` with carriage returns removed (az.cmd on Windows ends lines with CRLF).
# The exit status is az's. Knack prints a JSON null as `None`, a boolean in lower case (older
# CLIs: `True`/`False`), a list of scalars one per line; callers must cope with `None` and with either boolean spelling.
az_tsv() {
  local out
  out="$(az "$@" -o tsv)" || return
  if [ -n "$out" ]; then
    printf '%s\n' "${out//$'\r'/}"
  fi
}

# is_null_value <text>: success when an az tsv value means "absent": empty or `None` (any case).
is_null_value() {
  [ -z "$1" ] || [ "${1,,}" = "none" ]
}
