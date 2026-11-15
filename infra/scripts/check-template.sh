#!/usr/bin/env bash
# Static assertions on the evaluated Bicep template (no Azure login, nothing deployed).
#
#   check-template.sh [--only C1,C3] <main.bicep>
#
# Prints one `PASS|FAIL C<n> <subject>` line per check (reasons indented under a FAIL) and exits 1 on any FAIL.
# The template directory is COPIED to a temporary directory first (`bicep snapshot` writes a file next to the
# parameter file), and the checks run on dummy values only: the resources Bicep would create under several
# scenarios (full, pinned ids, no push key, phase 1, placeholder images). The logic is in template_checks.py.
#
# Needs bicep (BICEP_BIN, PATH, or the copy `az bicep install` leaves in ~/.azure/bin) and Python 3.10+.

set -euo pipefail

scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$scripts_dir/lib.sh"

usage() {
  printf 'usage: check-template.sh [--only C1,C3] <main.bicep>\n' >&2
  exit 1
}

only=""
template=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --only)
      [ "$#" -ge 2 ] || usage
      only="$2"
      shift 2
      ;;
    -*) die "unknown argument: $1" ;;
    *)
      [ -z "$template" ] || usage
      template="$1"
      shift
      ;;
  esac
done
[ -n "$template" ] || usage
[ -f "$template" ] || die "no such template: $template"

bicep_bin="$(find_bicep)" || die "bicep not found: set BICEP_BIN, put bicep on PATH or run 'az bicep install'"
python_bin="$(find_python)" || die "python 3.10+ not found"

extra=()
if [ -n "$only" ]; then
  extra=(--only "$only")
fi

exec "$python_bin" -I "$scripts_dir/template_checks.py" static "$template" --bicep "$bicep_bin" ${extra[@]+"${extra[@]}"}
