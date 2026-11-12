# ADR 0042: The production Postgres connection verifies the server (`ssl=verify-full` with the Azure roots), and I1 owns enforcing it

- **Status:** Accepted-by-controller (B1 ruling, awaiting Ali's review)
- **Date:** 2026-11-12
- **Deciders:** the B1 controller (Claude); recorded for the architect (Claude); Ali's review pending
- **Supersedes / superseded by:** none. Corrects the wording of a parking-lot row (which called `ssl=require` acceptable) and the `?ssl=require` in [I1 plan](../superpowers/plans/2026-11-11-i1-azure-infra.md) Task 3. Extends [ADR 0001](0001-hosting-azure-uae-north.md) (Postgres Flexible on Azure UAE North), which says nothing about client-side verification
- **Evidence:** B1 controller rulings 31 and 33 (`b1-summary.md`, deleted after merge; the paths below last); final whole-branch review finding I3 (commit `5f00cbe`); `backend/src/stellar_blaze/adapters/db/engine.py` (passes no `ssl`); `backend/alembic/env.py` (same URL, no `connect_args`); a probe of the installed asyncpg 0.32.0 on 2026-11-12 (below); Microsoft Learn "Transport Layer Security (TLS) in Azure Database for PostgreSQL" and "Configure TLS Connection in Azure Database for PostgreSQL Flexible Server" (both `ms.date` 2026-07-14, read 2026-11-12); the root store of the shipped image `stellar-blaze-api:dev` (`python:3.13.15-slim-trixie`)

## Context
Nothing in B1 reaches a managed database: the local one is on loopback. The first prod connection is I1's. Three facts decide what I1 must do.

1. **asyncpg does not verify by default.** Probe of asyncpg 0.32.0 (`connect_utils._parse_connect_dsn_and_args`, no `PGSSLROOTCERT`, empty home directory): with `ssl` unset, `prefer` or `require` the context is `CERT_NONE` with `check_hostname=False`, so the connection is encrypted when the server offers TLS but the server is never authenticated (and `prefer` falls back to plaintext). `verify-ca` and `verify-full` raise `ClientConfigurationError` ("root certificate file … does not exist") when no root file is available, so they fail closed. A `PGSSLROOTCERT` pointing at a missing file raises `FileNotFoundError`.
2. **Azure enforces TLS on the server, not identity on the client.** Microsoft: the server requires TLS (`require_secure_transport`), "By default, PostgreSQL doesn't verify the server certificate", and client `sslmode` values `disable`, `allow`, `prefer` or `require` "can make your app vulnerable to man-in-the-middle attacks". Microsoft's best configuration is `verify-full` (the page spells it "verify-all"), with the Azure root CAs in the trusted store, and never intermediate CAs or pinned server certificates (unsupported; the intermediate CAs rotated from November 2025 to the first quarter of 2026 and rotations "aren't announced").
3. **`sslrootcert` cannot ride the URL.** SQLAlchemy's asyncpg dialect passes URL query items to `asyncpg.connect()` as keyword arguments (`create_connect_args`: `opts.update(url.query)`), and asyncpg 0.32.0 accepts `sslrootcert` only inside a DSN string. The root file therefore comes from the `PGSSLROOTCERT` environment variable (read when no `sslrootcert` is given).

The I1 plan (Task 3) built the secret as `…?ssl=require`, which by fact 1 is encryption without authentication. The parking-lot row said `require` was acceptable as one of three options. It is not.

## Options considered
| Option | Verdict |
|---|---|
| `ssl=require` | Rejected: no authentication (fact 1); Microsoft lists it as vulnerable to man-in-the-middle |
| `ssl=verify-ca` | Authenticates the chain, not the host name. Acceptable only where the DNS name differs from the certificate (Private Endpoint, stage 2) |
| **`ssl=verify-full` + roots via `PGSSLROOTCERT` (chosen)** | Fails closed if the root file is absent |
| A `Settings` validator in B1 that refuses a prod URL whose `ssl` is not `verify-ca` or `verify-full` | Structural, and it also catches a secret edited by hand later. Not adopted now: the B1 controller judged that it changes the I1 deploy contract. Kept as the first escalation (revisit trigger) |

## Decision
1. **URL.** The production `SB_DATABASE_URL` carries `?ssl=verify-full`. The `api`, `job-migrate` and `job-refresh` share the one secret (`sb-database-url`), so all three verify. Alembic uses the same URL through `create_async_engine`, so migrations verify too.
2. **Roots.** `PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt` on all three, the Debian bundle already in the image. Checked on 2026-11-12 on `stellar-blaze-api:dev`: 150 roots, including `DigiCert Global Root G2` and `Microsoft RSA Root Certificate Authority 2017`, the two roots Microsoft names as current for Azure Database for PostgreSQL (plus `Microsoft ECC Root Certificate Authority 2017`, `DigiCert Global Root CA` and `G3`). No B1 change, and no certificate committed. The trade-off is that every public root is trusted and the host-name check is what binds identity to `*.postgres.database.azure.com`; a narrow bundle of only the Azure roots is parked (parking-lot row), because Microsoft also tells clients to keep the complete Azure root set, which then needs maintenance.
3. **Enforcement is a deploy-time failure, owned by I1** ([I1 plan](../superpowers/plans/2026-11-11-i1-azure-infra.md), amended 2026-11-12): (a) a static check of the compiled `main.bicep` on every PR and before every deploy: the database URL carries `ssl=verify-full` and no weaker `ssl`/`sslmode` appears; (b) a post-deploy check of the deployed secret and env of `api`, `job-migrate` and `job-refresh` (the URL is tested with `grep -q` and never printed); (c) at image build, the shipped image's `PGSSLROOTCERT` file must contain both Azure roots; (d) the first `job-migrate` run under `verify-full` is the end-to-end proof, because a `verify-full` connection that succeeds is a verified one.
4. Never trust intermediate CAs or pin server certificates.

## Consequences
- **Cost of being wrong:** if I1 had shipped `require`, prod would be encrypted but unauthenticated and nothing would show it. Under `verify-full` the failure is loud instead: a missing or wrong root fails `job-migrate` before rollout, and the old revision keeps serving (ADR 0001 single-revision mode).
- **Unverified:** this has not run against a live Azure server. Microsoft warns that some clients fail `verify-full` when roots cross-sign intermediates, and says to point `PGSSLROOTCERT` at a file holding the Microsoft RSA Root CA 2017 in that case. The first real `job-migrate` settles it; the fallback is a narrow bundle with those roots.
- Local development (loopback, no TLS, `ssl` unset) is unchanged.
- A stage-2 VNet or Private Endpoint may force `verify-ca` if the DNS name differs from the certificate; that is a new decision then.

## Revisit trigger
The first real `job-migrate` fails verification; stage 2 (VNet or Private Endpoint, Entra auth); Microsoft announces a root-CA change; a second deploy path appears or the secret is changed outside the pipeline (add the B1 `Settings` validator); the narrow-bundle parking row fires.

## Links
[ADR 0001](0001-hosting-azure-uae-north.md) · [ADR 0008](0008-backend-stack.md) · [I1 plan](../superpowers/plans/2026-11-11-i1-azure-infra.md) · [parking lot](../parking-lot.md) · [Microsoft: TLS](https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls) · [Microsoft: configure TLS](https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls-how-to-connect)
