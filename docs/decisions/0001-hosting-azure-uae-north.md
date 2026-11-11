# ADR 0001: Host on Azure UAE North (Container Apps + Postgres Flexible), Render as fallback

- **Status:** Accepted (Ali, 2026-11-11)
- **Evidence:** `docs/research/2026-11-11-deployment-options.md` (§0, §2, §5.4, §6.1, §8, §9, §10)

## Context
The prototype is judged 20-30 Nov and may be demoed at GITEX 7-11 Dec. Judges score "scalability and deployment readiness". Health data in the UAE is expected to stay in the country in production (Federal Law 2/2019 Art. 13 via secondary sources; DoH RAI Standard cl. 3.1.4.5.1 as a design benchmark). Vercel, Railway, Render, Fly.io, Supabase and Neon have no Middle East region; GCP has no UAE region (Doha is Qatar); AWS me-central-1 lacks App Runner and Lightsail and costs about 2x for the same sizing (deployment doc §2, §6.2).

## Decision
- **Azure UAE North**, one resource group, one subscription. **Container Apps, Consumption profile only**, runs `api` (FastAPI), `web` (Next.js standalone) and Container Apps **Jobs** (scheduled `refresh` job, manual `migrate` job that runs `alembic upgrade head` before each deploy).
- **Azure Database for PostgreSQL Flexible Server, Burstable B1MS, 32 GiB**, PG 18 if the portal offers it as GA in UAE North, else 17. No extensions. Local/CI Postgres is `postgres:18.6` (never an unpinned local tag; stack doc finding 11).
- **Bicep** is the IaC source of truth, with a `location` parameter. **GitHub Actions** for CI/CD.
- **Cost Management budget alert at $75/month**, created on day 1.
- **Fallback ladder:** (1) same Bicep, different Azure region (flip `location`) if UAE North blocks the new subscription; (2) **Render Frankfurt** if the account/card itself is blocked and not fixable within about 4 hours; decide by end of 13 Nov.
- **Portability rules:** one Dockerfile per service; 12-factor config via env vars only (`pydantic-settings`, prefix `SB_`); JSON logs to stdout; migrations as a separate job, never in app start-up; cron in infrastructure, jobs are plain CLI entry points; no cloud SDK import outside an adapter module.

## Consequences
- `api` and `web`: **min replicas 1, max 1** during 20 Nov-11 Dec (in-process state stays coherent; numba first-call compile of 2.2-4.3 s is avoided by warming in the image, stack doc §6.3).
- Health probes: `GET /api/v1/health/live` (liveness, no dependencies) and `GET /api/v1/health/ready` (readiness, checks Postgres). Container port 8000. The I1 plan must use these paths.
- Idle billing applies only when a replica handles no requests, uses under 0.01 vCPU and receives under 1,000 B/s; otherwise the bill is about $118/month, hence the alert and a Cost Analysis check after 48 h (deployment doc §6.1).
- No private endpoint and no planned-maintenance window in Stage 1 (each carries a $0.10/h meter, about $73/month).
- The free account's $200 credit lapses about 30 days after creation (about 11 Dec, the last GITEX day): **upgrade to pay-as-you-go around 1 Dec** to keep the 12-month free B1MS.
- The "in-UAE" claim is about the deployment only if step 1 of the fallback ladder is not taken. If it is, the technical document says the region and states residency as a design property.
- DoH acceptance of any cloud for health data is unresolved; it goes in the limitations section.

## Rejected options
| Option | Why rejected |
|---|---|
| Two-stage (PaaS now, migrate to UAE later) | No candidate PaaS has an ME region; a migration costs days we do not have |
| GCP Cloud Run | No UAE region |
| AWS ECS Fargate + RDS + ALB (me-central-1) | About $100-115/month vs $60-65; more moving parts; kept as ladder step 3 |
| Vercel for the frontend | No ME region; Hobby is non-commercial; does not host the Python backend |
| Microsoft for Startups credits | Needs a registered company and a fresh Microsoft account (parking lot) |

## Revisit trigger
UAE North refuses Container Apps or PG Flexible for the subscription (day-1 checks, deployment doc §10); Cost Analysis shows active-rate billing or an environment meter; a pilot needs HA, private networking or Key Vault (Stage 2, deployment doc §8.2).
