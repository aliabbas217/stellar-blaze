#!/usr/bin/env bash
# Static assertions on the evaluated Bicep template (no Azure login, nothing deployed).
#
#   check-template.sh [--only C1,C3] <main.bicep>
#
# Prints one `PASS|FAIL <id> <subject>` line per check (reasons indented under a FAIL) and exits 1 on any FAIL.
#   C1-C10  main.bicep: outputs, environment, apps (the api's minimum replicas follow API_MIN_REPLICAS and are tried at 0 and 1),
#           pins, the migrate job (it runs scripts/migrate.sh, which sits next to main.bicep), VAPID, replay settings, secrets, phases
#   C11     every module parameter that carries a secret value is a securestring or secureObject (ARM redacts only those from
#           the deployment history)
#   C12     cheap mode: container sizes and the Log Analytics daily cap and retention are the ones the cost estimate rests on
#   C13     web only: UPSTREAM_TIMEOUT_MS (safety routes, 10000) is shorter than UPSTREAM_READ_TIMEOUT_MS (45000, covers an api cold
#           start), which is below the 240 s ingress request timeout
#   B1-B5   bootstrap.bicep (next to main.bicep): budget start date, federated credential subject, role assignments, registry,
#           the budget amount
# The template directory is COPIED to a temporary directory first (`bicep snapshot` writes a file next to the
# parameter file), and the checks run on dummy values only: the resources Bicep would create under several
# scenarios (full, pinned ids, no push key, phase 1, api kept warm, placeholder images; bootstrap with and without an owner and
# an operator, and with a BUDGET_MONTH override). The logic is in template_checks.py.
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
