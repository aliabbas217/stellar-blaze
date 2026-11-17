#!/bin/sh
# The whole of job-migrate: loaded into main.bicep with loadTextContent and run as `/bin/sh -c <this text>` (Azure), and mounted
# and run as `/bin/sh /migrate.sh` by infra/local/compose.yaml (the rehearsal). One file, so the deployed job and the rehearsal
# can never disagree about what a migration does. It runs in the api image: `sb-jobs` is on PATH and WORKDIR is /app, so
# alembic.ini, fixtures/ and config/ resolve. SB_GIT_SHA and the SB_* settings (database URL, PGSSLROOTCERT) come from the
# job's environment.
#
# Three steps, each idempotent (a second run changes nothing), and the first failure ends the run with a non-zero status:
#   1. `sb-jobs db upgrade`   the schema, then the config seed (the git default, activated only if nothing was ever activated)
#   2. `sb-jobs site load`    the synthetic demo site (a no-op on a site that is already loaded)
#   3. the ACTIVE runtime config carries alert_dispatch_interval_minutes = 1. The ruleset default is 5 minutes, and the alerts
#      worker runs one dispatch every max(60 s, interval x 60), so with the default a stop reaches a phone after up to
#      5 min 45 s; with 1 it is about 1 min 30 s (60 s period + 15 s forecast leg + 15 s delivery). The seed cannot carry
#      the value (config/runtime/default.toml is the production default and the tests pin it), so the deploy proposes the
#      default plus this one tunable and activates it, once. Because the proposal is built from the git default, a later
#      manual change of the active config is replaced by it only while the active config lacks the value.
set -eu

actor="deploy:${SB_GIT_SHA:?SB_GIT_SHA is not set}"
key="alert_dispatch_interval_minutes"
shown="/tmp/config-show.json"
proposal="/tmp/runtime-config.toml"
proposed="/tmp/config-propose.json"

# has_interval <file>: success when a `sb-jobs config show` document holds `<key>: 1` (indent=2 JSON, so one key per line).
has_interval() {
  grep -Eq "\"$key\": 1,?[[:space:]]*\$" "$1"
}

echo "migrate: sb-jobs db upgrade"
sb-jobs db upgrade

echo "migrate: sb-jobs site load fixtures/demo_site.toml"
sb-jobs site load fixtures/demo_site.toml --actor "$actor" --reason "load the synthetic demo site at deploy $SB_GIT_SHA"

echo "migrate: the active runtime config must have $key = 1"
sb-jobs config show >"$shown"
if has_interval "$shown"; then
  echo "migrate: $key is already 1 in the active config; nothing to change"
else
  # The default with the one tunable added under [tunables]. tr drops a CR in case the file was checked out with CRLF.
  tr -d '\r' <config/runtime/default.toml | sed "/^\\[tunables\\]/a\\
$key = 1" >"$proposal"
  if ! grep -q "^$key = 1\$" "$proposal"; then
    echo "migrate: ERROR: config/runtime/default.toml has no [tunables] table to add $key to" >&2
    exit 1
  fi
  sb-jobs config validate "$proposal"
  # Captured to a file, not piped: a pipe would hide a failing `propose` behind the exit status of sed.
  sb-jobs config propose "$proposal" --actor "$actor" --reason "alert dispatch every minute for the demo ($key = 1)" >"$proposed"
  version_id="$(sed -n 's/.*"version_id": *\([0-9][0-9]*\), *"sha256".*/\1/p' "$proposed" | tail -n 1)"
  if [ -z "$version_id" ]; then
    echo "migrate: ERROR: sb-jobs config propose did not print a version_id:" >&2
    cat "$proposed" >&2
    exit 1
  fi
  sb-jobs config activate "$version_id" --actor "$actor" --reason "activate $key = 1 for the demo at deploy $SB_GIT_SHA"
  sb-jobs config show >"$shown"
  if ! has_interval "$shown"; then
    echo "migrate: ERROR: after activating version $version_id the active config still lacks $key = 1" >&2
    exit 1
  fi
  echo "migrate: activated config version $version_id with $key = 1"
fi
echo "migrate: done"
