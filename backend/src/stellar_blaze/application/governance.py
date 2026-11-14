"""Governance use cases: the refused employer data request, the denied-access record and the worker-visible log.

ADR 0054: an employer's request for individual data is always refused and recorded. The audit row has no subject
field and no worker reference: ``worker_ref`` never reaches this module (the route validates and drops it). ADR 0066:
every row carries the site's active epoch, and the worker-visible log reads only that epoch.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Final

from pydantic import JsonValue

from stellar_blaze.application.runtime_config import ConfigSnapshot, ruleset_for
from stellar_blaze.application.services import Principal
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from stellar_blaze.ports.audit import WORKER_VISIBLE_KINDS, AuditEvent, AuditLog, AuditRecord

__all__ = [
    "DATA_REQUEST_RULE",
    "AuditIdentity",
    "audit_identity",
    "deny_access",
    "refuse_individual_data",
    "transparency_entries",
]

DATA_REQUEST_RULE: Final = "ADR 0004; PDPL purpose limitation"
LOG_LIMIT: Final = 50


@dataclass(frozen=True)
class AuditIdentity:
    """The five identity fields of an audit row (``config_version_id`` is ``None`` for a file or env snapshot)."""

    ruleset_id: str | None = None
    ruleset_sha256: str | None = None
    model_id: str | None = None
    config_version_id: int | None = None
    config_sha256: str | None = None


def audit_identity(snapshot: ConfigSnapshot | None, catalog: RulesetCatalog, local_date: date) -> AuditIdentity:
    """The identity of what is in force on ``local_date``; best effort, because a stop must never wait for it.

    No snapshot (nothing loaded yet) or no ruleset in force gives the fields that are known and ``None`` for the rest.
    """
    if snapshot is None:
        return AuditIdentity()
    model_id = snapshot.model.manifest.model_id if snapshot.model is not None else None
    try:
        loaded = ruleset_for(snapshot, catalog, local_date)
    except LookupError:  # no ruleset in force (or the pin does not cover the date): record what we do know
        return AuditIdentity(model_id=model_id, config_version_id=snapshot.version_id, config_sha256=snapshot.sha256)
    return AuditIdentity(
        ruleset_id=loaded.ruleset.meta.id,
        ruleset_sha256=loaded.sha256,
        model_id=model_id,
        config_version_id=snapshot.version_id,
        config_sha256=snapshot.sha256,
    )


def _event(
    kind: str,
    principal: Principal,
    *,
    site_id: str,
    epoch_id: int,
    outcome: str,
    detail: dict[str, JsonValue],
    identity: AuditIdentity,
) -> AuditEvent:
    return AuditEvent.model_validate(
        {
            "kind": kind,
            "actor": principal.actor,
            "actor_role": principal.role,
            "employer_id": principal.employer_id,
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


async def refuse_individual_data(
    *,
    principal: Principal,
    site_id: str,
    epoch_id: int,
    data_class: str,
    identity: AuditIdentity,
    audit: AuditLog,
) -> AuditRecord:
    """Record the refusal of an individual-data request: who asked (token), where, what class; never about whom."""
    return await audit.append(
        _event(
            "data_request.refused",
            principal,
            site_id=site_id,
            epoch_id=epoch_id,
            outcome="refused",
            detail={"data_class": data_class, "rule": DATA_REQUEST_RULE},
            identity=identity,
        )
    )


async def deny_access(
    *,
    principal: Principal,
    site_id: str,
    epoch_id: int,
    operation: str,
    identity: AuditIdentity,
    audit: AuditLog,
) -> AuditRecord:
    """Record a token of one employer used on a resource of another (``access.denied``; operation name only)."""
    return await audit.append(
        _event(
            "access.denied",
            principal,
            site_id=site_id,
            epoch_id=epoch_id,
            outcome="denied",
            detail={"operation": operation},
            identity=identity,
        )
    )


async def transparency_entries(*, audit: AuditLog, site_id: str, epoch_id: int) -> Sequence[AuditRecord]:
    """The worker-visible rows of the site's epoch, newest first, at most ``LOG_LIMIT`` (kinds: ADR 0054 decision 3)."""
    return await audit.site_entries(site_id, kinds=WORKER_VISIBLE_KINDS, limit=LOG_LIMIT, epoch_id=epoch_id)
