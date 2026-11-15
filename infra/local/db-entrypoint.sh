#!/bin/sh
# Entrypoint wrapper of the rehearsal database (infra/local/compose.yaml): TLS only, with certificates that arrive on a
# read-only bind mount. Postgres refuses a private key that is readable by group or others, and a bind mount from Windows
# cannot hold mode 600, so the key is copied to a directory the postgres user owns first. The HBA file allows the local
# socket (the healthchecks) and TLS over TCP, nothing else: a plaintext TCP connection has no matching rule and is refused,
# as Azure's require_secure_transport does.
set -eu

tls=/var/lib/postgresql-tls
install -d -m 700 -o postgres -g postgres "$tls"
install -m 600 -o postgres -g postgres /db-src/server.key "$tls/server.key"
install -m 644 -o postgres -g postgres /db-src/server.crt "$tls/server.crt"

exec docker-entrypoint.sh postgres \
  -c ssl=on \
  -c ssl_cert_file="$tls/server.crt" \
  -c ssl_key_file="$tls/server.key" \
  -c ssl_min_protocol_version=TLSv1.2 \
  -c hba_file=/db-src/pg_hba.conf
