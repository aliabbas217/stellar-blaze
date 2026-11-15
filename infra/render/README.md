# Render Frankfurt fallback (ADR 0001, ladder step 2)

**When:** only if the Azure account does not work. The architect decides; the trigger is **Mon 16 Nov 22:00 Karachi**. It deploys the same demo from [`render.yaml`](render.yaml): `sb-web` (public), `sb-api` (private), `sb-alerts` (worker), `sb-pg` (Postgres 18.6, private, on a 1 GB disk). Synthetic data only.

**State: never applied on Render.** `bash infra/render/rehearse-render.sh` parses `render.yaml` and runs its commands against the real images in Docker, including the negative TLS checks; it cannot show how Render behaves. The UNVERIFIED list is at the end.

## Caveats (say them to the judges)

- **No UAE region** (Frankfurt is the nearest). No in-country claim: the deck says the demo uses synthetic data only and production targets Azure UAE North.
- **Database TLS keeps ADR 0042** (architect ruling): Render's managed Postgres cannot do `verify-ca` or `verify-full` on internal connections, so it is not used. `sb-pg` is the official image with a certificate from a CA we generate; `sb-api`, `sb-alerts` and the migrate step connect with `?ssl=verify-full` and `PGSSLROOTCERT`. `ssl=require` is never used. The certificate and the CA are valid 30 days (`gen-db-certs.sh --days` changes that).
- **A database you run is a database you back up.** Render snapshots the disk daily; do not restore a database from a disk snapshot (Render's own warning for custom databases). The data is a synthetic demo that `site load` recreates.

## Steps (two passes: the certificate must name a host name that Render assigns at creation)

1. **Repository.** Push this branch to GitHub, GitLab or Bitbucket (the Dockerfiles must be in it) and connect Render to it. A Hobby workspace is enough (no monthly fee, up to 25 services).
2. **Secrets.** `.\infra\scripts\deploy-local.ps1 -Action ShowSecrets` (PowerShell, repository root; `-Action InitSecrets` first if needed, see [../README.md](../README.md)) prints on the console the values for `DEMO_EMPLOYER_TOKEN`, `SB_ACCESS_TOKENS`, `VAPID_PUBLIC_KEY`, `SB_VAPID_PRIVATE_KEY`, `SB_VAPID_SUBJECT`. The database password needs no step: Render generates it into the group `sb-db-auth`.
3. **Pass 1: apply with the certificate prompts set to the literal `pending`.** Dashboard, New, Blueprint, this repository and branch, file `infra/render/render.yaml`. Paste the five values; for `PG_SERVER_CERT_B64`, `PG_SERVER_KEY_B64` and both `SB_DB_CA_B64` prompts type `pending`. Nothing connects: `sb-pg` and `sb-alerts` exit, the `sb-api` pre-deploy fails (fail closed). Check that group `sb-db-auth` has `DB_PASSWORD` (add any 40-plus character `[A-Za-z0-9]` value by hand if `generateValue` was ignored in the group; see UNVERIFIED).
4. **Read the host name, make the certificate.** `sb-api` > Environment > `DB_HOST` (for example `sb-pg-2j3e`). It must equal `sb-pg` > Connect > Internal (without the port); if it does not, use the Connect value for the certificate **and** set `DB_HOST` by hand on `sb-api` and `sb-alerts`. Then, in Git Bash:
   `d="$(mktemp -d)"; bash infra/scripts/gen-db-certs.sh --san <that host> --out "$d/pki" --b64`
   (`mktemp` is outside the repository; the script refuses a path inside it.)
5. **Pass 2: paste, redeploy in this order.** Paste the one-line files into the dashboard: `server.crt.b64` into `PG_SERVER_CERT_B64` and `server.key.b64` into `PG_SERVER_KEY_B64` (on `sb-pg`), `ca.crt.b64` into `SB_DB_CA_B64` (on `sb-api` **and** `sb-alerts`). Then delete the scratch directory (`rm -rf "$d"`); never paste a key anywhere else. Deploy `sb-pg` first (Manual Deploy; wait for "Live"), then `sb-api` (its pre-deploy runs `sb-jobs db upgrade && sb-jobs site load ...`; the first build of the api image takes 10 to 20 minutes), then `sb-alerts`, then `sb-web`.

## Verify

The api is private, so only the web URL is tested. `bash infra/scripts/smoke-http.sh https://<sb-web URL> --wait` (or `.\infra\scripts\Test-DemoHttp.ps1 -BaseUrl https://<sb-web URL>`) must pass. Check **H6** (30 requests with forged `X-Forwarded-For` must still hit a 429): it is the proof of `TRUSTED_PROXY_HOPS=1`. In the `sb-api` and `sb-alerts` logs, a clean start (no certificate error) shows the `verify-full` connection works; a wrong host name or CA fails loudly instead.

**Memory.** During the smoke test open each service's Metrics. If one passes **70 percent** of 512 MB, change its `plan` to `1c-2g` in `render.yaml` and sync (measured on the day: api about 205 MiB, web about 73 MiB; the database and the alerts worker are not measured).

## Replay clock

`sb-api` and `sb-alerts` each start the replay "now" at 10:10 on 2026-06-14 when they start. Before every judged session restart both back to back (each: Manual Deploy, Restart service). After a restart of one only, they disagree by hours. Auto deploy is `off` everywhere so nothing restarts by itself.

## Cost (render.com/pricing, read 2026-11-15 through a text proxy: re-check)

Four services at `0.5c-512mb`, USD 7 each = **USD 28**, plus the disk 1 GB at USD 0.25 = **about USD 28.25 per month**, billed per second, Hobby workspace USD 0. Builds and pre-deploy runs use pipeline minutes (included amount not read). A move to `1c-2g` is USD 25 per service.

## Teardown

Delete the four services, the two groups (`sb-db-auth`, `sb-common`) and the Blueprint in the dashboard; the disk goes with `sb-pg`. Changing `DB_PASSWORD` later does **not** change the password stored in the database (it is set only when the data directory is created): to rotate, delete the disk too (the demo data is recreated by `site load`).

## UNVERIFIED (everything here needs Render itself)

- That `generateValue: true` works inside `envVarGroups` (the schema allows it; the prose is silent). Fallback in step 3.
- That `fromService ... property: host` for a `pserv` equals the name in Connect > Internal, so the certificate name matches `DB_HOST`. Fallback in step 4.
- That the pre-deploy command receives the service environment (including the groups) and reaches `sb-pg`, and that Render splits `sh -c '...'` as one argument. If a deploy shows otherwise, move the pre-deploy text in front of `exec uvicorn` in `dockerCommand` (it is idempotent).
- That `dockerCommand` works with an image-runtime service (the Blueprint spec lists it for both runtimes) and with Postgres' own entrypoint: the rehearsal runs both readings (entrypoint kept, entrypoint replaced).
- That Render mounts the disk so that `/var/lib/postgresql/18/docker` is writable by the `postgres` user after the image's `chown`, and that 512 MB is enough for Postgres.
- That `sb-web` reaches `sb-api` on port 8000 over http on the private network, and that a TCP health check on a `pserv` finds ports 5432 and 8000.
- That `docker.io/library/postgres@sha256:...` (digest only; `name:tag@sha256` is not documented) is pulled without a Docker Hub rate limit.
- `TRUSTED_PROXY_HOPS=1` (Render does not document its `X-Forwarded-For` behavior; too few hops fails safe; H6 decides).
- That the pricing numbers hold, and the pipeline minutes included in a Hobby workspace.
