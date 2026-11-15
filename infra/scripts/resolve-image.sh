#!/usr/bin/env bash
# Decide, per service, whether the deploy ships the real image or a public placeholder.
#
#   resolve-image.sh <svc: api|web> <dir> <sha> <acrLoginServer>
#
# `<dir>/Dockerfile` present -> the real image (built and pushed by the workflow); absent -> the Microsoft quickstart image,
# so the pipeline can be rehearsed before the service has a Dockerfile. Prints `key=value` lines and appends them to
# $GITHUB_OUTPUT when that is set:
#   api  real         image=<acr>/sb-api:<sha> port=8000 live=/api/v1/health/live ready=/api/v1/health/ready placeholder=false
#   web  real         image=<acr>/sb-web:<sha> port=3000 health=/api/healthz placeholder=false
#   either placeholder image=mcr.microsoft.com/k8se/quickstart:latest port=80 live=/ ready=/ health=/ placeholder=true
# (checked 2026-11-15: `docker manifest inspect` resolves both mcr.microsoft.com/k8se/quickstart:latest and
# mcr.microsoft.com/k8se/quickstart-jobs:latest, the image the Bicep uses for a placeholder job.)
#
# <sha> and <acrLoginServer> are validated before they reach $GITHUB_OUTPUT, so a value cannot inject another output line.

set -euo pipefail

scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/lib.sh
. "$scripts_dir/lib.sh"

placeholder_image="mcr.microsoft.com/k8se/quickstart:latest"

usage() {
  printf 'usage: resolve-image.sh <api|web> <dir> <sha> <acrLoginServer>\n' >&2
  exit 1
}

[ "$#" -eq 4 ] || usage
svc="$1"
dir="$2"
sha="$3"
acr="$4"

case "$svc" in
  api | web) ;;
  *) usage ;;
esac

# emit <key=value>...: one line each on stdout, and appended to $GITHUB_OUTPUT when it is set.
emit() {
  local line
  for line in "$@"; do
    printf '%s\n' "$line"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
      printf '%s\n' "$line" >>"$GITHUB_OUTPUT"
    fi
  done
}

if [ ! -f "$dir/Dockerfile" ]; then
  log "no $dir/Dockerfile: $svc uses the placeholder image"
  emit "image=$placeholder_image" "port=80" "live=/" "ready=/" "health=/" "placeholder=true"
  exit 0
fi

# A Docker tag is [A-Za-z0-9_][A-Za-z0-9_.-]{0,127}; a login server is a lower-case host name with an optional port.
[[ "$sha" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || die "not a valid image tag: '$sha'"
[[ "$acr" =~ ^[a-z0-9][a-z0-9.-]*(:[0-9]+)?$ ]] || die "not a valid registry login server: '$acr'"

if [ "$svc" = "api" ]; then
  emit "image=$acr/sb-api:$sha" "port=8000" "live=/api/v1/health/live" "ready=/api/v1/health/ready" "placeholder=false"
else
  emit "image=$acr/sb-web:$sha" "port=3000" "health=/api/healthz" "placeholder=false"
fi
