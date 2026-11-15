#!/usr/bin/env bash
# Generate a THROWAWAY certificate authority and one server certificate signed by it, for a Postgres server that clients
# connect to with `ssl=verify-full` (ADR 0042). Used by the local production rehearsal (infra/local/rehearse.sh) and, with
# the SAN set to the provider's private host name, by the Render fallback (infra/render/README.md).
#
#   gen-db-certs.sh --san <dns> [--san <dns> ...] --out <dir> [--b64] [--days 30] [--keep-ca-key]
#
#   --san <dns>      a DNS name the server certificate is valid for (repeatable, at least one). The certificate CN is the
#                    first one. A leading `*.` wildcard is allowed.
#   --out <dir>      where to write ca.crt, server.crt and server.key (mode 600). Created if missing. It must NOT be inside
#                    this repository (the key must never be committable), and none of the files may exist yet.
#   --b64            also write ca.crt.b64, server.crt.b64 and server.key.b64: the same files as ONE base64 line each (no
#                    wrapping), to paste into a dashboard secret field.
#   --days <n>       validity of both certificates in days (default 30; the server certificate cannot outlive the CA).
#   --keep-ca-key    also keep the CA private key as <dir>/ca.key. By default it is deleted: the CA signs one certificate
#                    and then cannot sign another, so a leaked server key cannot be turned into more identities.
#
# Keys are ECDSA P-256. The CA and its key live in a private temporary directory that is removed on exit. The script never
# prints a key; it prints the output paths, and the subject, SAN and expiry of the server certificate.
set -euo pipefail

usage() {
  sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

die() {
  printf 'gen-db-certs: %s\n' "$*" >&2
  exit 1
}

sans=()
out=""
b64=false
days=30
keep_ca_key=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --san)
      [ "$#" -ge 2 ] || die "--san needs a value"
      sans+=("$2")
      shift 2
      ;;
    --out)
      [ "$#" -ge 2 ] || die "--out needs a value"
      out="$2"
      shift 2
      ;;
    --days)
      [ "$#" -ge 2 ] || die "--days needs a value"
      days="$2"
      shift 2
      ;;
    --b64)
      b64=true
      shift
      ;;
    --keep-ca-key)
      keep_ca_key=true
      shift
      ;;
    -h | --help) usage ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

[ "${#sans[@]}" -ge 1 ] || die "at least one --san is required"
[ -n "$out" ] || die "--out is required"
[[ "$days" =~ ^[1-9][0-9]{0,3}$ ]] || die "--days must be a whole number of days between 1 and 9999"
for san in "${sans[@]}"; do
  # Strict on purpose: the name goes into an OpenSSL config file, so nothing but a host name may reach it.
  [[ "$san" =~ ^(\*\.)?[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "not a DNS name: '$san'"
done
[ "${#sans[0]}" -le 64 ] || die "the first --san becomes the CN, which is limited to 64 characters"

# --- refuse an output directory inside the repository ---------------------------------------------------------------
# The repository root comes from this script's own location (infra/scripts/ is two levels below it). The output path is
# resolved through its nearest EXISTING ancestor first, so the check happens before anything is created.
resolve_path() {
  local path="$1" tail=""
  while [ ! -d "$path" ]; do
    tail="/$(basename -- "$path")$tail"
    path="$(dirname -- "$path")"
  done
  (cd -- "$path" && printf '%s%s\n' "$(pwd -P)" "$tail")
}

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
out_abs="$(resolve_path "$out")"
# Windows file systems are case-insensitive, so compare in lower case.
lower_root="${repo_root,,}"
lower_out="${out_abs,,}"
case "$lower_out/" in
  "$lower_root"/*) die "--out resolves to '$out_abs', which is inside the repository ($repo_root); use a scratch directory outside it" ;;
  *) ;;
esac

command -v openssl >/dev/null 2>&1 || die "openssl is not installed"

mkdir -p -- "$out_abs"
for name in ca.crt server.crt server.key ca.key ca.crt.b64 server.crt.b64 server.key.b64; do
  [ ! -e "$out_abs/$name" ] || die "$out_abs/$name already exists; use a fresh directory"
done

# --- build the certificates in a private scratch directory ---------------------------------------------------------
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
umask 077

cn="${sans[0]}"
san_list=""
index=1
for san in "${sans[@]}"; do
  san_list+="DNS.${index} = ${san}"$'\n'
  index=$((index + 1))
done

cat >"$work/ca.cnf" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no

[dn]
CN = Stellar Blaze throwaway database CA

[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF

cat >"$work/server.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no

[dn]
CN = ${cn}
EOF

cat >"$work/server-ext.cnf" <<EOF
[v3_server]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
subjectAltName = @alt_names

[alt_names]
${san_list}
EOF

openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$work/ca.key" 2>/dev/null
openssl req -x509 -new -key "$work/ca.key" -sha256 -days "$days" -config "$work/ca.cnf" -out "$work/ca.crt"

openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$work/server.key" 2>/dev/null
openssl req -new -key "$work/server.key" -config "$work/server.cnf" -out "$work/server.csr"
openssl x509 -req -in "$work/server.csr" -CA "$work/ca.crt" -CAkey "$work/ca.key" -CAcreateserial \
  -days "$days" -sha256 -extfile "$work/server-ext.cnf" -extensions v3_server -out "$work/server.crt" 2>/dev/null

# The certificate must verify against the CA for every name it claims, as a TLS server, before anything is written out.
for san in "${sans[@]}"; do
  case "$san" in
    \*.*) check_name="host.${san#\*.}" ;;
    *) check_name="$san" ;;
  esac
  openssl verify -CAfile "$work/ca.crt" -purpose sslserver -verify_hostname "$check_name" "$work/server.crt" >/dev/null ||
    die "the generated certificate does not verify for '$check_name'"
done

# --- write the results ---------------------------------------------------------------------------------------------
install -m 644 "$work/ca.crt" "$out_abs/ca.crt"
install -m 644 "$work/server.crt" "$out_abs/server.crt"
install -m 600 "$work/server.key" "$out_abs/server.key"
if [ "$keep_ca_key" = true ]; then
  install -m 600 "$work/ca.key" "$out_abs/ca.key"
fi

if [ "$b64" = true ]; then
  # One line each, no wrapping and no trailing newline (a newline pasted into a dashboard field can become part of the
  # value). `base64` wraps at 76 columns on some systems, so newlines are removed explicitly.
  for name in ca.crt server.crt server.key; do
    base64 <"$out_abs/$name" | tr -d '\n' >"$out_abs/$name.b64"
  done
  chmod 644 "$out_abs/ca.crt.b64" "$out_abs/server.crt.b64"
  chmod 600 "$out_abs/server.key.b64"
fi

# --- report: paths, subject, SAN, expiry; never a key --------------------------------------------------------------
printf 'written to %s:\n' "$out_abs"
printf '  %s\n' "$out_abs/ca.crt" "$out_abs/server.crt" "$out_abs/server.key"
if [ "$keep_ca_key" = true ]; then
  printf '  %s (CA key kept: treat it as a secret)\n' "$out_abs/ca.key"
fi
if [ "$b64" = true ]; then
  printf '  %s\n' "$out_abs/ca.crt.b64" "$out_abs/server.crt.b64" "$out_abs/server.key.b64"
fi
printf 'server certificate:\n'
openssl x509 -in "$out_abs/server.crt" -noout -subject -enddate | sed 's/^/  /'
printf '  SAN: %s\n' "$(openssl x509 -in "$out_abs/server.crt" -noout -ext subjectAltName | sed -n '2p' | sed 's/^ *//')"
