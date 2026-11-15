"""Governance refusal, the worker-visible transparency log and the demo reset (ADR 0054, ADR 0066, ADR 0062)."""

from datetime import UTC

from fastapi import APIRouter

from stellar_blaze.api.auth import EmployerDep, ResetEmployerDep
from stellar_blaze.api.deps import RuntimeDep, ServicesDep
from stellar_blaze.api.models import DataRequestCreate, DemoReset, TransparencyEntry, TransparencyLog
from stellar_blaze.api.rate_limits import DEMO_RESET_LIMITS, EMPLOYER_LIMITS, extension
from stellar_blaze.api.responses import ProblemJSONResponse, problem_responses
from stellar_blaze.api.routers.sites import SiteIdPath
from stellar_blaze.api.views import deny_if_foreign, domain_problems, policy_date, site_or_404
from stellar_blaze.application.governance import (
    AuditIdentity,
    audit_identity,
    refuse_individual_data,
    transparency_entries,
)
from stellar_blaze.errors import INDIVIDUAL_DATA_REFUSED, NOT_A_DEMO_SITE, DomainProblem
from stellar_blaze.ports.audit import AuditEvent
from stellar_blaze.ports.sites import NotADemoSiteError

router = APIRouter(tags=["governance"])

REFUSAL_DETAIL = "Individual health data is not held by this service and is never released to an employer (ADR 0004)."


@router.post(
    "/sites/{site_id}/data-requests",
    openapi_extra=extension(EMPLOYER_LIMITS),
    summary="Request individual data (always refused)",
    status_code=403,
    response_model=None,
    response_class=ProblemJSONResponse,
    response_description="Always refused: no success response exists.",
    responses=problem_responses(
        "unauthorized",
        "individual-data-refused",
        "not-found",
        "validation-failed",
        "rate-limited",
        "dependency-unavailable",
    ),
)
async def create_data_request(
    site_id: SiteIdPath,
    payload: DataRequestCreate,
    principal: EmployerDep,
    services: ServicesDep,
    runtime: RuntimeDep,
) -> None:
    """An employer asks for individual worker data. The answer is always the `individual-data-refused` problem (403).

    No such data is held by this service. The refusal is written to an append-only audit log that every worker of the
    site can read through `get_site_transparency_log`; the `worker_ref` is discarded and never stored, logged or echoed.
    Without a token the answer is 401.
    """
    site = await site_or_404(services, site_id)
    with domain_problems():
        # The best-effort identity path `deny_if_foreign` uses: with no config loaded the refusal is still a 403 and
        # still audited (the declared 503 is kept in the contract, this route no longer produces it).
        identity = audit_identity(runtime.config.peek(), runtime.rulesets, policy_date(runtime.settings, services))
        # `payload.worker_ref` is validated by the model and read nowhere: it never reaches the audit row or a log.
        await refuse_individual_data(
            principal=principal,
            site_id=site.id,
            epoch_id=await services.sites.active_epoch(site.id),
            data_class=payload.data_class,
            identity=identity,
            audit=services.audit,
        )
    raise DomainProblem(
        type_=INDIVIDUAL_DATA_REFUSED, title="Individual data refused", status=403, detail=REFUSAL_DETAIL
    )


@router.get(
    "/sites/{site_id}/transparency-log",
    summary="Worker-visible audit entries of a site",
    responses=problem_responses("not-found", "validation-failed"),
)
async def get_site_transparency_log(site_id: SiteIdPath, services: ServicesDep) -> TransparencyLog:
    """Refused employer data requests at the site, newest first, at most 50. Never says whose data was asked for."""
    site = await site_or_404(services, site_id)
    rows = await transparency_entries(
        audit=services.audit, site_id=site.id, epoch_id=await services.sites.active_epoch(site.id)
    )
    return TransparencyLog(
        site_id=site.id,
        entries=[
            TransparencyEntry(
                at=row.at,
                kind="data_request.refused",
                outcome="refused",
                actor_role="employer",
                rule=str(row.detail.get("rule", "")),
                policy_version=row.ruleset_id or "unknown",
                config_version=row.config_version_id or 0,
                model_id=row.model_id,
            )
            for row in rows
        ],
    )


@router.post(
    "/sites/{site_id}/demo-reset",
    openapi_extra=extension((*DEMO_RESET_LIMITS, *EMPLOYER_LIMITS)),  # the general bucket is charged too
    summary="Reset a synthetic demo site",
    responses=problem_responses(
        "unauthorized",
        "forbidden-employer",
        "not-found",
        "not-a-demo-site",
        "validation-failed",
        "rate-limited",
        "internal-error",
    ),
)
async def reset_demo_site(
    site_id: SiteIdPath, principal: ResetEmployerDep, services: ServicesDep, runtime: RuntimeDep
) -> DemoReset:
    """Start a new demo epoch of a synthetic site. Own employer only; guarded and rate-limited.

    A reset starts a new epoch (`epoch_id` increases by one). Plans, sign-offs, stop events, data requests, alert events
    and push subscriptions are scoped to the current epoch and resolved server-side; the audit chain is not
    epoch-scoped and records `demo_reset` (not visible to workers). Nothing is deleted. Any site that is not synthetic
    answers `not-a-demo-site` (409).
    """
    site = await site_or_404(services, site_id)
    await deny_if_foreign(
        services=services,
        runtime=runtime,
        principal=principal,
        employer_id=site.employer_id,
        site_id=site.id,
        operation="reset_demo_site",
    )
    identity = audit_identity(runtime.config.peek(), runtime.rulesets, policy_date(runtime.settings, services))
    epoch = await services.sites.active_epoch(site.id)

    def reset_event(previous: int, new: int) -> AuditEvent:
        return _event(
            "demo_reset", principal.actor, principal.employer_id, site.id, None, "reset", identity, previous, new
        )

    try:
        new_epoch = await services.epochs.start_epoch(site.id, principal.actor, audit=reset_event)
    except NotADemoSiteError as error:
        await services.audit.append(
            _event("demo_reset.refused", principal.actor, principal.employer_id, site.id, epoch, "refused", identity)
        )
        raise DomainProblem(
            type_=NOT_A_DEMO_SITE,
            title="Not a demo site",
            status=409,
            detail=f"Site {site.id} is not synthetic.",
        ) from error
    # The new epoch is the replay clock's new time base: re-anchor this process now, not after the cache interval. (The
    # alerts worker follows at its next cycle; the reset's own transaction is already committed.)
    await services.refresh_clock(force=True)
    return DemoReset(
        site_id=site.id,
        epoch_id=new_epoch,
        previous_epoch_id=epoch,
        reset_at=services.wall_clock().astimezone(UTC),  # when it really happened, like its audit row
    )


def _event(
    kind: str,
    actor: str,
    employer_id: str,
    site_id: str,
    epoch_id: int | None,
    outcome: str,
    identity: AuditIdentity,
    previous: int | None = None,
    new: int | None = None,
) -> AuditEvent:
    """A reset-family audit row. ``demo_reset`` names both epochs in its detail and carries no epoch of its own."""
    detail: dict[str, int] = {} if previous is None or new is None else {"previous_epoch": previous, "new_epoch": new}
    return AuditEvent.model_validate(
        {
            "kind": kind,
            "actor": actor,
            "actor_role": "employer",
            "employer_id": employer_id,
            "site_id": site_id,
            "epoch_id": epoch_id,
            "outcome": outcome,
            "detail": detail,
            "ruleset_id": identity.ruleset_id,
            "ruleset_sha256": identity.ruleset_sha256,
            "model_id": identity.model_id,
            "config_version_id": identity.config_version_id,
            "config_sha256": identity.config_sha256,
        }
    )
