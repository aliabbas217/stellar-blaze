"""Plan sign-off (ADR 0011 section 7.1, ADR 0053 Amendments): a supervisor acknowledges the day plan.

A sign-off is an append-only row with the plan hash. Every ack item (Medium, High or Red work) must be acknowledged,
or ``ReviewRequiredError`` lists the missing ones, so one tap (nothing acknowledged) works only for a plan with no
item above Low. Re-signing a plan whose hash equals the latest sign-off's returns the recorded sign-off and writes
nothing. This module reads no stop, alert or forecast state and nothing here is awaited
by them: a sign-off never delays an alert or a stop (class (d) invariant, tests in ``test_signoff_never_gates``).
"""

from collections.abc import Sequence
from typing import Final

from stellar_blaze.application.crew_views import PlannedDay
from stellar_blaze.application.governance import AuditIdentity
from stellar_blaze.application.services import Principal, Services
from stellar_blaze.ports.audit import AuditEvent
from stellar_blaze.ports.plans import PlanSignoffInput, PlanSignoffRecord

__all__ = ["ReviewRequiredError", "SignoffNeedsDatabaseConfigError", "sign_off"]

SIGNER_ROLE: Final = "supervisor"


class ReviewRequiredError(Exception):
    """Items of the plan above Low were not acknowledged (409 ``review-required``)."""

    def __init__(self, missing: Sequence[str]) -> None:
        super().__init__("review required: " + ", ".join(missing))
        self.missing = tuple(missing)


class SignoffNeedsDatabaseConfigError(Exception):
    """A sign-off row names a config version row, so a file or env snapshot (no version id) cannot record one."""


async def sign_off(
    *,
    services: Services,
    planned: PlannedDay,
    principal: Principal,
    site_id: str,
    ruleset_sha256: str,
    config_version_id: int | None,
    config_sha256: str,
    model_id: str | None,
    acknowledged: Sequence[str],
    deviation_reason_code: str | None,
) -> PlanSignoffRecord:
    """Record the sign-off, or return the recorded one when the plan is unchanged and already signed.

    Raises:
        SignoffNeedsDatabaseConfigError: ``config_version_id`` is ``None``.
        ReviewRequiredError: Some ack item of the plan is not acknowledged.
    """
    if config_version_id is None:
        raise SignoffNeedsDatabaseConfigError
    wanted = [item.id for item in planned.ack]
    given = set(acknowledged)
    # One-tap (nothing acknowledged) is only possible for a plan with no item above Low; any item must be ticked, also
    # on a plan that was signed before: an empty list never confirms Medium, High or Red work.
    missing = [item for item in wanted if item not in given]
    if missing:
        raise ReviewRequiredError(missing)
    latest = planned.latest_signoff
    if latest is not None and latest.plan_hash == planned.plan_hash:
        return latest  # the plan is the one already signed: the recorded sign-off stands, no second row
    stored = await services.signoffs.insert(
        PlanSignoffInput(
            ruleset_id=planned.ruleset_id,
            ruleset_sha256=ruleset_sha256,
            model_id=model_id,
            config_version_id=config_version_id,
            config_sha256=config_sha256,
            epoch_id=planned.result.epoch_id,
            crew_id=planned.crew.crew_id,
            local_date=planned.result.plan.local_date,
            actor=principal.actor,
            actor_role=SIGNER_ROLE,
            acknowledged_items=[item for item in acknowledged if item in set(wanted)],
            deviation_reason_code=deviation_reason_code,
            plan_hash=planned.plan_hash,
        )
    )
    identity = AuditIdentity(
        ruleset_id=planned.ruleset_id,
        ruleset_sha256=ruleset_sha256,
        model_id=model_id,
        config_version_id=config_version_id,
        config_sha256=config_sha256,
    )
    await services.audit.append(
        AuditEvent(
            kind="plan.signed",
            actor=principal.actor,
            actor_role=SIGNER_ROLE,
            employer_id=principal.employer_id,
            site_id=site_id,
            epoch_id=planned.result.epoch_id,
            outcome="signed",
            detail={
                "crew_id": planned.crew.crew_id,
                "local_date": planned.result.plan.local_date.isoformat(),
                "plan_hash": planned.plan_hash,
                "items": len(planned.ack),
                "acknowledged": len(stored.acknowledged_items),
                "unknown_ids": len(given - set(wanted)),
                "deviation": deviation_reason_code is not None,
            },
            ruleset_id=identity.ruleset_id,
            ruleset_sha256=identity.ruleset_sha256,
            model_id=identity.model_id,
            config_version_id=identity.config_version_id,
            config_sha256=identity.config_sha256,
        )
    )
    return stored
