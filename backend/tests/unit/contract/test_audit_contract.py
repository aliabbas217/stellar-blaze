"""The in-memory audit log satisfies the contract suite that Postgres also runs, the chain notices every kind of edit,
and a log that breaks the chain fails the suite (a contract that cannot fail would make every green run vacuous)."""

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import ValidationError

from stellar_blaze.adapters.fakes.audit import InMemoryAuditLog
from stellar_blaze.ports.audit import ZERO_HASH, AuditEvent, AuditRecord, row_hash_of
from tests.unit.contract.audit_contract import CHECKS, event
from tests.unit.contract.b3_world import fake_world

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(CHECKS))
async def test_the_in_memory_log_satisfies_the_contract(name: str) -> None:
    await CHECKS[name](fake_world())


class ForkingLog(InMemoryAuditLog):
    """Every row names the zero hash as its predecessor: no chain."""

    async def append(self, event: AuditEvent) -> AuditRecord:
        at = datetime.now(UTC)
        record = AuditRecord(
            **event.model_dump(),
            id=len(self.records) + 1,
            at=at,
            prev_hash=ZERO_HASH,
            row_hash=row_hash_of(ZERO_HASH, event, at),
        )
        self.records.append(record)
        return record


@pytest.mark.asyncio
async def test_a_log_that_forks_the_chain_fails_the_contract() -> None:
    world = fake_world()
    world.audit = ForkingLog()

    with pytest.raises(AssertionError):
        await CHECKS["rows_are_chained_from_64_zeros"](world)


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["detail", "epoch_id", "actor", "site_id", "outcome", "prev_hash", "row_hash"])
async def test_verify_names_the_first_row_that_was_edited(field: str) -> None:
    log = InMemoryAuditLog()
    for i in range(3):
        await log.append(event(epoch_id=1, tag=str(i)))
    edited: dict[str, Any] = {
        "detail": {"rule": "x", "tag": "forged"},
        "epoch_id": 2,
        "actor": "someone-else",
        "site_id": "site-other",
        "outcome": "allowed",
        "prev_hash": "c" * 64,
        "row_hash": "d" * 64,
    }

    log.records[1] = log.records[1].model_copy(update={field: edited[field]})

    assert await log.verify() == 2  # row 1 is intact, row 2 is the first broken one


@pytest.mark.asyncio
async def test_verify_notices_a_deleted_and_a_reordered_row() -> None:
    log = InMemoryAuditLog()
    for i in range(4):
        await log.append(event(epoch_id=1, tag=str(i)))
    del log.records[1]
    assert await log.verify() == 3  # row 3 no longer follows row 1

    reordered = InMemoryAuditLog()
    for i in range(3):
        await reordered.append(event(epoch_id=1, tag=str(i)))
    reordered.records[1], reordered.records[2] = reordered.records[2], reordered.records[1]
    assert await reordered.verify() == 3


def test_the_hash_is_the_sha256_of_prev_hash_and_the_canonical_row() -> None:
    at = datetime(2026, 11, 15, 8, 30, 0, 123456, tzinfo=UTC)
    e = event(epoch_id=7, tag="t")

    payload = json.dumps(
        {
            "at": "2026-11-15T08:30:00.123456Z",
            "kind": "data_request.refused",
            "actor": "emp-token",
            "actor_role": "employer",
            "employer_id": "emp-demo",
            "site_id": "site-demo-mussafah",
            "epoch_id": 7,
            "outcome": "refused",
            "detail": {"rule": "ADR 0004; PDPL purpose limitation", "tag": "t"},
            "ruleset_id": "ae-heat-2026.1",
            "ruleset_sha256": "b" * 64,
            "model_id": None,
            "config_version_id": None,
            "config_sha256": None,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    assert row_hash_of(ZERO_HASH, e, at) == hashlib.sha256((ZERO_HASH + payload).encode()).hexdigest()


@pytest.mark.parametrize(
    "key", ["worker_ref", "member_count", "Employee", "heart_rate", "symptom", "acclimatised", "juvenile"]
)
def test_a_detail_key_that_looks_like_a_member_field_is_refused(key: str) -> None:
    with pytest.raises(ValidationError, match="looks like a member field"):
        AuditEvent(kind="input.changed", actor="a", actor_role="operator", outcome="x", detail={key: 1})
    with pytest.raises(ValidationError, match="looks like a member field"):
        AuditEvent(kind="input.changed", actor="a", actor_role="operator", outcome="x", detail={"ok": [{key: 1}]})


def test_a_float_or_an_unknown_kind_or_an_extra_field_is_refused() -> None:
    with pytest.raises(ValidationError, match="floats are not allowed"):
        AuditEvent(kind="input.changed", actor="a", actor_role="operator", outcome="x", detail={"lat": 24.36})
    with pytest.raises(ValidationError):
        AuditEvent.model_validate(
            {"kind": "made.up", "actor": "a", "actor_role": "operator", "outcome": "x", "detail": {}}
        )
    with pytest.raises(ValidationError):
        AuditEvent.model_validate(
            {
                "kind": "input.changed",
                "actor": "a",
                "actor_role": "operator",
                "outcome": "x",
                "detail": {},
                "subject": "w",
            }
        )
