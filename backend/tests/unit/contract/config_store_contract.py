"""Contract suite for ``RuntimeConfigStore``, run against the in-memory fake (unit) and Postgres (integration).

Import it as ``from tests.unit.contract.config_store_contract import CHECKS``. Each check takes a fresh, empty store and
asserts one clause of the port; ``CHECKS`` maps the clause name to the check so both tiers parametrize over the same
list. A check that failed for one store and not for the other would be a difference between the fake and production.
"""

from collections.abc import Awaitable, Callable

import pytest

from stellar_blaze.domain.config.runtime import RuntimeConfig, Tunables, config_body, config_sha256
from stellar_blaze.ports.config_store import (
    ActivationKind,
    RuntimeConfigStore,
    StaleActivationError,
    VersionNotFoundError,
)

type Check = Callable[[RuntimeConfigStore], Awaitable[None]]

DEFAULT = RuntimeConfig()
MARGIN_7 = RuntimeConfig(tunables=Tunables(twl_margin_w_m2=7.0))
MARGIN_3_5 = RuntimeConfig(tunables=Tunables(twl_margin_w_m2=3.5))
ACTOR = "ali"
REASON = "contract suite check"


async def check_create_version_is_idempotent_on_the_hash(store: RuntimeConfigStore) -> None:
    first = await store.create_version(MARGIN_7, actor="first-author", reason="the first proposal of this config")
    again = await store.create_version(MARGIN_7, actor="someone-else", reason="a later proposal of the same config")

    assert again.id == first.id
    # The first row is the audit record: a repeated proposal does not rewrite who proposed it or why.
    assert again == first
    assert again.created_by == "first-author"
    assert again.reason == "the first proposal of this config"


async def check_a_different_config_is_a_different_version(store: RuntimeConfigStore) -> None:
    a = await store.create_version(DEFAULT, actor=ACTOR, reason=REASON)
    b = await store.create_version(MARGIN_7, actor=ACTOR, reason=REASON)
    c = await store.create_version(MARGIN_3_5, actor=ACTOR, reason=REASON)

    assert len({a.id, b.id, c.id}) == 3
    assert len({a.sha256, b.sha256, c.sha256}) == 3
    assert a.id < b.id < c.id


async def check_a_version_holds_the_config_its_hash_and_its_audit_fields(store: RuntimeConfigStore) -> None:
    created = await store.create_version(MARGIN_7, actor="ali", reason="B3 margin trial")

    assert created.body == config_body(MARGIN_7)
    assert created.sha256 == config_sha256(MARGIN_7)
    assert created.schema_version == MARGIN_7.schema_version
    assert created.created_by == "ali"
    assert created.reason == "B3 margin trial"
    assert created.created_at.utcoffset() is not None  # timezone-aware
    assert await store.get_version(created.id) == created


async def check_an_unknown_version_is_not_found(store: RuntimeConfigStore) -> None:
    created = await store.create_version(DEFAULT, actor=ACTOR, reason=REASON)

    with pytest.raises(VersionNotFoundError) as raised:
        await store.get_version(created.id + 1000)
    assert raised.value.version_id == created.id + 1000


async def check_an_empty_store_has_no_activation(store: RuntimeConfigStore) -> None:
    assert await store.latest_activation() is None
    assert list(await store.history(10)) == []


async def check_the_first_activation_is_the_seed(store: RuntimeConfigStore) -> None:
    version = await store.create_version(DEFAULT, actor=ACTOR, reason=REASON)

    seed = await store.activate(version.id, expected_previous=None, kind="seed", actor="seed:abc1234", reason=REASON)

    assert seed.kind == "seed"
    assert seed.config_version_id == version.id
    assert seed.previous_activation_id is None
    assert seed.actor == "seed:abc1234"
    assert seed.reason == REASON
    assert seed.activated_at.utcoffset() is not None
    assert await store.latest_activation() == seed


async def check_a_second_first_activation_is_stale(store: RuntimeConfigStore) -> None:
    v1 = await store.create_version(DEFAULT, actor=ACTOR, reason=REASON)
    v2 = await store.create_version(MARGIN_7, actor=ACTOR, reason=REASON)
    seed = await store.activate(v1.id, expected_previous=None, kind="seed", actor=ACTOR, reason=REASON)

    with pytest.raises(StaleActivationError) as raised:
        await store.activate(v2.id, expected_previous=None, kind="seed", actor=ACTOR, reason=REASON)

    assert raised.value.expected_previous is None
    assert await store.latest_activation() == seed  # nothing was written
    assert len(await store.history(10)) == 1


async def check_each_activation_names_the_one_it_replaces(store: RuntimeConfigStore) -> None:
    v1 = await store.create_version(DEFAULT, actor=ACTOR, reason=REASON)
    v2 = await store.create_version(MARGIN_7, actor=ACTOR, reason=REASON)
    v3 = await store.create_version(MARGIN_3_5, actor=ACTOR, reason=REASON)

    a1 = await store.activate(v1.id, expected_previous=None, kind="seed", actor=ACTOR, reason=REASON)
    a2 = await store.activate(v2.id, expected_previous=a1.id, kind="activate", actor=ACTOR, reason=REASON)
    a3 = await store.activate(v3.id, expected_previous=a2.id, kind="rollback", actor=ACTOR, reason=REASON)

    assert [a.previous_activation_id for a in (a1, a2, a3)] == [None, a1.id, a2.id]
    assert [a.kind for a in (a1, a2, a3)] == ["seed", "activate", "rollback"]
    assert a1.id < a2.id < a3.id
    assert await store.latest_activation() == a3


async def check_an_activation_must_name_the_latest_as_its_predecessor(store: RuntimeConfigStore) -> None:
    v1 = await store.create_version(DEFAULT, actor=ACTOR, reason=REASON)
    v2 = await store.create_version(MARGIN_7, actor=ACTOR, reason=REASON)
    v3 = await store.create_version(MARGIN_3_5, actor=ACTOR, reason=REASON)
    a1 = await store.activate(v1.id, expected_previous=None, kind="seed", actor=ACTOR, reason=REASON)
    a2 = await store.activate(v2.id, expected_previous=a1.id, kind="activate", actor=ACTOR, reason=REASON)

    # An activation that already has a successor, none at all (the seed slot is taken) and one that never existed.
    for stale in (a1.id, None, a2.id + 1000):
        with pytest.raises(StaleActivationError) as raised:
            await store.activate(v3.id, expected_previous=stale, kind="activate", actor=ACTOR, reason=REASON)
        assert raised.value.expected_previous == stale

    assert await store.latest_activation() == a2  # none of the three wrote anything
    assert [a.id for a in await store.history(10)] == [a2.id, a1.id]
    # The latest is still a valid predecessor after all those refusals.
    a3 = await store.activate(v3.id, expected_previous=a2.id, kind="activate", actor=ACTOR, reason=REASON)
    assert a3.previous_activation_id == a2.id


async def check_activating_an_unknown_version_writes_nothing(store: RuntimeConfigStore) -> None:
    with pytest.raises(VersionNotFoundError) as raised:
        await store.activate(4242, expected_previous=None, kind="seed", actor=ACTOR, reason=REASON)

    assert raised.value.version_id == 4242
    assert await store.latest_activation() is None
    # The seed slot was not consumed by the failed attempt.
    version = await store.create_version(DEFAULT, actor=ACTOR, reason=REASON)
    seed = await store.activate(version.id, expected_previous=None, kind="seed", actor=ACTOR, reason=REASON)
    assert seed.previous_activation_id is None


async def check_history_is_newest_first_and_bounded(store: RuntimeConfigStore) -> None:
    versions = [
        await store.create_version(config, actor=ACTOR, reason=REASON) for config in (DEFAULT, MARGIN_7, MARGIN_3_5)
    ]
    activations = []
    previous: int | None = None
    for version in versions:
        kind: ActivationKind = "seed" if previous is None else "activate"
        activation = await store.activate(version.id, expected_previous=previous, kind=kind, actor=ACTOR, reason=REASON)
        activations.append(activation)
        previous = activation.id

    newest_first = [a.id for a in reversed(activations)]
    assert [a.id for a in await store.history(10)] == newest_first
    assert [a.id for a in await store.history(2)] == newest_first[:2]
    assert [a.id for a in await store.history(1)] == newest_first[:1]


async def check_history_rejects_a_limit_below_one(store: RuntimeConfigStore) -> None:
    for limit in (0, -1):
        with pytest.raises(ValueError, match="limit"):
            await store.history(limit)


CHECKS: dict[str, Check] = {
    check.__name__.removeprefix("check_"): check
    for check in (
        check_create_version_is_idempotent_on_the_hash,
        check_a_different_config_is_a_different_version,
        check_a_version_holds_the_config_its_hash_and_its_audit_fields,
        check_an_unknown_version_is_not_found,
        check_an_empty_store_has_no_activation,
        check_the_first_activation_is_the_seed,
        check_a_second_first_activation_is_stale,
        check_each_activation_names_the_one_it_replaces,
        check_an_activation_must_name_the_latest_as_its_predecessor,
        check_activating_an_unknown_version_writes_nothing,
        check_history_is_newest_first_and_bounded,
        check_history_rejects_a_limit_below_one,
    )
}
