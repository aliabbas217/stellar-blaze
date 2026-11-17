"""A config the service refuses is audited as ``config.rejected`` with codes and paths only (ADR 0052 section 2)."""

import pytest

from stellar_blaze.adapters.fakes.audit import InMemoryAuditLog
from stellar_blaze.adapters.fakes.config_store import InMemoryConfigStore
from stellar_blaze.application.runtime_config import ConfigInvalidError, ConfigService, SnapshotHolder
from tests.unit.config.support import SEED_CATALOG, TODAY, config, models

pytestmark = pytest.mark.unit

REASON = "trying an unknown model"


def service(audit: InMemoryAuditLog | None) -> ConfigService:
    return ConfigService(
        InMemoryConfigStore(), SEED_CATALOG, models(), SnapshotHolder(), lambda: TODAY, prod=False, audit=audit
    )


@pytest.mark.asyncio
async def test_propose_of_an_invalid_config_appends_config_rejected() -> None:
    audit = InMemoryAuditLog()

    with pytest.raises(ConfigInvalidError):
        await service(audit).propose(config(model_id="no-such-model"), "ali", REASON)

    (row,) = audit.records
    assert (row.kind, row.actor, row.actor_role, row.outcome) == ("config.rejected", "ali", "operator", "rejected")
    assert row.detail["codes"] == ["unknown-model"]
    assert row.detail["paths"] == ["model_id"]
    assert row.config_version_id is None
    assert await audit.verify() is None


@pytest.mark.asyncio
async def test_seed_of_an_invalid_config_appends_config_rejected() -> None:
    audit = InMemoryAuditLog()

    with pytest.raises(ConfigInvalidError):
        await service(audit).seed(config(model_id="no-such-model"), actor="seed:abc", reason=REASON)

    assert [r.kind for r in audit.records] == ["config.rejected"]


@pytest.mark.asyncio
async def test_a_valid_proposal_and_a_service_without_an_audit_log_write_no_rejection() -> None:
    audit = InMemoryAuditLog()

    await service(audit).propose(config(), "ali", REASON)
    with pytest.raises(ConfigInvalidError):
        await service(None).propose(config(model_id="no-such-model"), "ali", REASON)

    assert audit.records == []


class _DownAuditLog(InMemoryAuditLog):
    async def append(self, event: object) -> object:  # type: ignore[override]
        raise TimeoutError("the audit database is unreachable")


@pytest.mark.asyncio
async def test_a_failing_audit_log_never_masks_the_violation(caplog: pytest.LogCaptureFixture) -> None:
    with pytest.raises(ConfigInvalidError) as raised:
        await service(_DownAuditLog()).propose(config(model_id="no-such-model"), "ali", REASON)

    assert [v.code for v in raised.value.violations] == ["unknown-model"]  # the ORIGINAL error, not a TimeoutError
