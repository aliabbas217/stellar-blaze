"""The in-memory config store satisfies the contract suite that Postgres also runs, and the suite fails on stores that
break the port (a contract that cannot fail would make every green run vacuous)."""

from collections.abc import Sequence

import pytest
from pydantic import ValidationError

from stellar_blaze.adapters.fakes.config_store import InMemoryConfigStore
from stellar_blaze.domain.config.runtime import RuntimeConfig, config_body
from stellar_blaze.ports.config_store import ActivationKind, ActivationRecord, RuntimeConfigStore, VersionRecord
from tests.unit.contract.config_store_contract import CHECKS, DEFAULT, MARGIN_7

pytestmark = pytest.mark.unit

# What a broken store makes a check do: fail an assertion, fail a `pytest.raises`, or raise the wrong exception.
FAILURES = (AssertionError, pytest.fail.Exception, KeyError, LookupError, TypeError)


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(CHECKS))
async def test_the_in_memory_store_satisfies_the_contract(name: str) -> None:
    await CHECKS[name](InMemoryConfigStore())


class Delegating:
    """A store that forwards to a correct fake; a subclass breaks exactly one clause of the port."""

    def __init__(self) -> None:
        self.inner = InMemoryConfigStore()

    async def latest_activation(self) -> ActivationRecord | None:
        return await self.inner.latest_activation()

    async def get_version(self, version_id: int) -> VersionRecord:
        return await self.inner.get_version(version_id)

    async def create_version(self, config: RuntimeConfig, *, actor: str, reason: str) -> VersionRecord:
        return await self.inner.create_version(config, actor=actor, reason=reason)

    async def activate(
        self, version_id: int, *, expected_previous: int | None, kind: ActivationKind, actor: str, reason: str
    ) -> ActivationRecord:
        return await self.inner.activate(
            version_id, expected_previous=expected_previous, kind=kind, actor=actor, reason=reason
        )

    async def history(self, limit: int) -> Sequence[ActivationRecord]:
        return await self.inner.history(limit)


class DuplicatingStore(Delegating):
    """Every proposal becomes a new row, whatever its hash."""

    created = 0

    async def create_version(self, config: RuntimeConfig, *, actor: str, reason: str) -> VersionRecord:
        self.created += 1
        return self.inner.add_raw_version(
            config_body(config), sha256=f"{self.created:064x}", created_by=actor, reason=reason
        )


class OverwritingStore(Delegating):
    """A repeated proposal rewrites the audit fields of the first row."""

    async def create_version(self, config: RuntimeConfig, *, actor: str, reason: str) -> VersionRecord:
        first = await self.inner.create_version(config, actor=actor, reason=reason)
        return first.model_copy(update={"created_by": actor, "reason": reason})


class UncheckedStore(Delegating):
    """``expected_previous`` is ignored: the activation always lands on top of whatever is latest."""

    async def activate(
        self, version_id: int, *, expected_previous: int | None, kind: ActivationKind, actor: str, reason: str
    ) -> ActivationRecord:
        latest = await self.inner.latest_activation()
        return await self.inner.activate(
            version_id, expected_previous=latest.id if latest else None, kind=kind, actor=actor, reason=reason
        )


class OldestFirstStore(Delegating):
    async def history(self, limit: int) -> Sequence[ActivationRecord]:
        return list(reversed(await self.inner.history(limit)))


class UnboundedStore(Delegating):
    async def history(self, limit: int) -> Sequence[ActivationRecord]:
        return await self.inner.history(max(limit, 1) + 100)


class SilentStore(Delegating):
    """An unknown version comes back as ``None``-like data instead of ``VersionNotFoundError``."""

    async def get_version(self, version_id: int) -> VersionRecord:
        try:
            return await self.inner.get_version(version_id)
        except LookupError:
            raise KeyError(version_id) from None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("store_type", "broken_check"),
    [
        (DuplicatingStore, "create_version_is_idempotent_on_the_hash"),
        (OverwritingStore, "create_version_is_idempotent_on_the_hash"),
        (UncheckedStore, "a_second_first_activation_is_stale"),
        (UncheckedStore, "an_activation_must_name_the_latest_as_its_predecessor"),
        (OldestFirstStore, "history_is_newest_first_and_bounded"),
        (UnboundedStore, "history_is_newest_first_and_bounded"),
        (SilentStore, "an_unknown_version_is_not_found"),
    ],
)
async def test_the_contract_fails_on_a_store_that_breaks_the_port(
    store_type: type[Delegating], broken_check: str
) -> None:
    store: RuntimeConfigStore = store_type()
    with pytest.raises(FAILURES):
        await CHECKS[broken_check](store)


@pytest.mark.asyncio
async def test_every_clause_of_the_contract_is_exercised_by_the_broken_stores_above() -> None:
    assert set(CHECKS) >= {
        "create_version_is_idempotent_on_the_hash",
        "a_second_first_activation_is_stale",
        "an_activation_must_name_the_latest_as_its_predecessor",
        "history_is_newest_first_and_bounded",
        "an_unknown_version_is_not_found",
    }


@pytest.mark.asyncio
async def test_records_are_frozen_and_reject_unknown_fields() -> None:
    store = InMemoryConfigStore()
    version = await store.create_version(DEFAULT, actor="ali", reason="contract suite check")
    with pytest.raises(ValidationError):
        version.reason = "changed"  # type: ignore[misc]
    with pytest.raises(ValidationError):
        VersionRecord.model_validate({**version.model_dump(), "extra": 1})


@pytest.mark.asyncio
async def test_the_fake_reports_what_it_was_asked_in_calls() -> None:
    store = InMemoryConfigStore()
    version = await store.create_version(MARGIN_7, actor="ali", reason="contract suite check")
    await store.get_version(version.id)
    await store.latest_activation()
    assert store.calls == ["create_version", "get_version", "latest_activation"]


@pytest.mark.asyncio
async def test_a_failing_fake_raises_on_every_method_and_recovers() -> None:
    store = InMemoryConfigStore()
    version = await store.create_version(DEFAULT, actor="ali", reason="contract suite check")
    store.fail_on["*"] = ConnectionRefusedError("down")
    for call in (
        store.latest_activation(),
        store.get_version(version.id),
        store.create_version(DEFAULT, actor="ali", reason="contract suite check"),
        store.activate(version.id, expected_previous=None, kind="seed", actor="ali", reason="contract suite check"),
        store.history(1),
    ):
        with pytest.raises(ConnectionRefusedError):
            await call
    del store.fail_on["*"]
    assert await store.get_version(version.id) == version
