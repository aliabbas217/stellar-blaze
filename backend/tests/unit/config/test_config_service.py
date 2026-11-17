"""ConfigService (ADR 0010 section 3): validate, propose, activate, roll back, seed and load, over the fake store."""

from datetime import date
from typing import Any

import pytest

from stellar_blaze.application.runtime_config import (
    AuditFieldsError,
    ConfigInvalidError,
    NothingToRollBackError,
    SeedResult,
)
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import RuntimeConfig, body_sha256, config_body, config_sha256
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from stellar_blaze.domain.rules.ruleset import Ruleset
from stellar_blaze.logging import configure_logging
from stellar_blaze.ports.config_store import StaleActivationError, VersionNotFoundError
from tests.unit.config.support import (
    FIRST_MODEL,
    SECOND_MODEL,
    TODAY,
    config,
    log_events,
    make_service,
    margin,
)
from tests.unit.rules.support import loaded, make_ruleset, ruleset_dict, set_path

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]

ACTOR = "ali"
REASON = "B3 margin trial"


# --- validate and propose ---------------------------------------------------------------------------------------


async def test_validate_returns_the_violations_of_the_domain() -> None:
    service, _, _ = make_service()

    assert service.validate(RuntimeConfig()) == []
    (violation,) = service.validate(margin(25.0))
    assert (violation.code, violation.path) == ("out-of-range", "tunables.twl_margin_w_m2")


async def test_propose_rejects_an_out_of_range_margin_and_stores_nothing() -> None:
    service, store, _ = make_service()

    with pytest.raises(ConfigInvalidError) as raised:
        await service.propose(margin(25.0), ACTOR, REASON)

    assert [v.code for v in raised.value.violations] == ["out-of-range"]
    assert "out-of-range" in str(raised.value)
    assert "tunables.twl_margin_w_m2" in str(raised.value)
    assert "create_version" not in store.calls


async def test_propose_rejects_an_unknown_model_and_names_the_known_ones() -> None:
    service, _, _ = make_service()

    with pytest.raises(ConfigInvalidError, match=f"unknown-model.*{FIRST_MODEL}.*{SECOND_MODEL}"):
        await service.propose(config(model_id="corrector-20990101-0000000-000000"), ACTOR, REASON)


async def test_propose_stores_a_valid_config_once() -> None:
    service, store, _ = make_service()

    first = await service.propose(margin(7.0), ACTOR, REASON)
    again = await service.propose(margin(7.0), "someone-else", "proposing the very same config")

    assert again == first
    assert first.body == config_body(margin(7.0))
    assert first.sha256 == config_sha256(margin(7.0))
    assert (first.created_by, first.reason) == (ACTOR, REASON)
    assert await store.latest_activation() is None  # proposing activates nothing


@pytest.mark.parametrize(
    ("actor", "reason", "what"),
    [
        ("", REASON, "actor"),
        ("   ", REASON, "actor"),
        (ACTOR, "", "reason"),
        (ACTOR, "too short", "reason"),  # 9 characters
        (ACTOR, "x" * 501, "reason"),
        (ACTOR, " " * 20, "reason"),  # long, but blank
    ],
)
async def test_every_write_needs_an_actor_and_a_reason_of_10_to_500_characters(
    actor: str, reason: str, what: str
) -> None:
    service, store, _ = make_service()
    version = await store.create_version(RuntimeConfig(), actor=ACTOR, reason=REASON)
    store.calls.clear()

    with pytest.raises(AuditFieldsError, match=what):
        await service.propose(RuntimeConfig(), actor, reason)
    with pytest.raises(AuditFieldsError, match=what):
        await service.activate(version.id, None, actor, reason)
    with pytest.raises(AuditFieldsError, match=what):
        await service.rollback(actor, reason)
    with pytest.raises(AuditFieldsError, match=what):
        await service.seed(RuntimeConfig(), actor=actor, reason=reason)

    assert store.calls == []  # refused before the store was touched


async def test_a_reason_of_exactly_10_and_500_characters_is_accepted() -> None:
    service, _, _ = make_service()

    short = await service.propose(margin(1.0), ACTOR, "x" * 10)
    long = await service.propose(margin(2.0), ACTOR, "y" * 500)

    assert (len(short.reason), len(long.reason)) == (10, 500)


async def test_actor_and_reason_are_stored_without_surrounding_whitespace() -> None:
    service, _, _ = make_service()

    version = await service.propose(margin(1.0), "  ali \n", "  a reason with padding \t")

    assert (version.created_by, version.reason) == ("ali", "a reason with padding")


# --- activate -----------------------------------------------------------------------------------------------------


async def test_the_first_activation_is_recorded_as_the_seed_and_swaps_the_snapshot() -> None:
    service, _, holder = make_service()
    version = await service.propose(RuntimeConfig(), ACTOR, REASON)

    record = await service.activate(version.id, None, ACTOR, REASON)

    assert (record.kind, record.previous_activation_id) == ("seed", None)
    snapshot = holder.current()
    assert (snapshot.version_id, snapshot.sha256, snapshot.source) == (version.id, version.sha256, "db")


async def test_activate_writes_then_swaps_the_local_snapshot() -> None:
    service, store, holder = make_service()
    seeded = await service.seed(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")
    assert seeded.activation is not None
    v2 = await service.propose(margin(7.0), ACTOR, REASON)

    record = await service.activate(v2.id, seeded.activation.id, ACTOR, "margin trial")

    assert (record.kind, record.config_version_id, record.previous_activation_id) == (
        "activate",
        v2.id,
        seeded.activation.id,
    )
    assert (record.actor, record.reason) == (ACTOR, "margin trial")
    assert await store.latest_activation() == record
    snapshot = holder.current()
    assert (snapshot.version_id, snapshot.sha256, snapshot.source) == (v2.id, v2.sha256, "db")
    assert snapshot.config.tunables.twl_margin_w_m2 == 7.0


async def test_activate_preloads_the_model_into_the_snapshot() -> None:
    service, _, holder = make_service()
    version = await service.propose(config(model_id=SECOND_MODEL), ACTOR, REASON)

    await service.activate(version.id, None, ACTOR, REASON)

    model = holder.current().model
    assert model is not None
    assert model.manifest.model_id == SECOND_MODEL


async def test_a_config_without_a_model_serves_the_uncorrected_forecast() -> None:
    service, _, holder = make_service()
    version = await service.propose(RuntimeConfig(), ACTOR, REASON)

    await service.activate(version.id, None, ACTOR, REASON)

    assert holder.current().model is None


async def test_activate_with_a_stale_expected_previous_writes_and_swaps_nothing() -> None:
    service, store, holder = make_service()
    seeded = await service.seed(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")
    assert seeded.activation is not None
    v2 = await service.propose(margin(7.0), ACTOR, REASON)
    v3 = await service.propose(margin(3.0), ACTOR, REASON)
    await service.activate(v2.id, seeded.activation.id, ACTOR, REASON)
    before = holder.current()

    with pytest.raises(StaleActivationError):
        await service.activate(v3.id, seeded.activation.id, ACTOR, REASON)  # someone else activated v2 first

    assert holder.current() is before
    assert len(await store.history(10)) == 2


async def test_activate_an_unknown_version_is_refused() -> None:
    service, store, holder = make_service()

    with pytest.raises(VersionNotFoundError):
        await service.activate(99, None, ACTOR, REASON)

    assert await store.latest_activation() is None
    assert holder.peek() is None


async def test_activate_revalidates_the_stored_version_and_a_bad_one_is_refused() -> None:
    service, store, holder = make_service()
    bad = store.add_raw_version({**config_body(RuntimeConfig()), "tunables": {"twl_margin_w_m2": 99.0}})

    with pytest.raises(ConfigInvalidError) as raised:
        await service.activate(bad.id, None, ACTOR, REASON)

    assert [v.code for v in raised.value.violations] == ["out-of-range"]
    assert await store.latest_activation() is None
    assert holder.peek() is None


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda body: {**body, "twl_zones": {"low_min_w_m2": 1.0}}, "invalid-config"),  # a floor is not settable
        (lambda body: {**body, "schema_version": 2}, "invalid-config"),
        (lambda body: {**body, "tunables": {"twl_margin_w_m2": "seven"}}, "invalid-config"),
    ],
    ids=["a-floor-key", "a-schema-version-we-do-not-know", "a-wrong-type"],
)
async def test_a_stored_body_that_is_not_a_runtime_config_is_refused(mutate: Any, code: str) -> None:
    service, store, _ = make_service()
    bad = store.add_raw_version(mutate(config_body(RuntimeConfig())))

    with pytest.raises(ConfigInvalidError) as raised:
        await service.activate(bad.id, None, ACTOR, REASON)

    assert [v.code for v in raised.value.violations] == [code]
    assert await store.latest_activation() is None


async def test_a_stored_hash_that_does_not_match_its_body_is_refused() -> None:
    service, store, _ = make_service()
    tampered = store.add_raw_version(config_body(RuntimeConfig()), sha256="f" * 64)

    with pytest.raises(ConfigInvalidError) as raised:
        await service.activate(tampered.id, None, ACTOR, REASON)

    assert [(v.code, v.path) for v in raised.value.violations] == [("hash-mismatch", "sha256")]


# --- rollback -----------------------------------------------------------------------------------------------------


async def test_activate_then_rollback_returns_to_the_previous_version() -> None:
    service, store, holder = make_service()
    seeded = await service.seed(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")
    assert seeded.activation is not None
    v2 = await service.propose(margin(7.0), ACTOR, REASON)
    activated = await service.activate(v2.id, seeded.activation.id, ACTOR, "margin trial")
    assert holder.current().version_id == v2.id

    rolled_back = await service.rollback(ACTOR, "revert trial")

    assert rolled_back.kind == "rollback"
    assert rolled_back.config_version_id == seeded.version.id
    assert rolled_back.previous_activation_id == activated.id
    assert (rolled_back.actor, rolled_back.reason) == (ACTOR, "revert trial")
    assert holder.current().version_id == seeded.version.id
    assert await store.latest_activation() == rolled_back


async def test_a_second_rollback_undoes_the_first() -> None:
    # "The version of the previous activation" (ADR 0010 section 3): the activation before the latest is the one the
    # first rollback replaced, so rolling back twice is a toggle between the two versions, and the history shows it.
    service, _, holder = make_service()
    seeded = await service.seed(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")
    assert seeded.activation is not None
    v2 = await service.propose(margin(7.0), ACTOR, REASON)
    await service.activate(v2.id, seeded.activation.id, ACTOR, REASON)

    await service.rollback(ACTOR, "revert trial")
    await service.rollback(ACTOR, "undo the revert")

    assert holder.current().version_id == v2.id


async def test_rollback_with_one_activation_is_refused() -> None:
    service, store, holder = make_service()
    await service.seed(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")
    before = holder.current()

    with pytest.raises(NothingToRollBackError):
        await service.rollback(ACTOR, "revert trial")

    assert holder.current() is before
    assert len(await store.history(10)) == 1


async def test_rollback_with_no_activation_is_refused() -> None:
    service, _, _ = make_service()

    with pytest.raises(NothingToRollBackError):
        await service.rollback(ACTOR, "revert trial")


async def test_rollback_with_a_stale_expected_previous_writes_and_swaps_nothing() -> None:
    # The caller saw the seed as the latest activation; meanwhile version 2 was activated. Rolling back "from the seed"
    # would now undo the wrong thing, so it is refused like any activation made on a stale view.
    service, store, holder = make_service()
    seeded = await service.seed(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")
    assert seeded.activation is not None
    v2 = await service.propose(margin(7.0), ACTOR, REASON)
    activated = await service.activate(v2.id, seeded.activation.id, ACTOR, REASON)
    before = holder.current()

    with pytest.raises(StaleActivationError) as raised:
        await service.rollback(ACTOR, "revert trial", expected_previous=seeded.activation.id)

    assert raised.value.expected_previous == seeded.activation.id
    assert holder.current() is before
    assert await store.latest_activation() == activated
    assert len(await store.history(10)) == 2


async def test_rollback_with_the_latest_as_expected_previous_is_the_same_as_without_it() -> None:
    service, store, holder = make_service()
    seeded = await service.seed(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")
    assert seeded.activation is not None
    v2 = await service.propose(margin(7.0), ACTOR, REASON)
    activated = await service.activate(v2.id, seeded.activation.id, ACTOR, REASON)

    rolled_back = await service.rollback(ACTOR, "revert trial", expected_previous=activated.id)

    assert (rolled_back.kind, rolled_back.previous_activation_id) == ("rollback", activated.id)
    assert holder.current().version_id == seeded.version.id
    assert await store.latest_activation() == rolled_back


async def test_a_retried_rollback_with_the_same_expected_previous_does_not_undo_itself() -> None:
    # The lost update the activation log exists to prevent: the same request sent twice (a retry, a double click) must
    # roll back once, not roll back and then forward again.
    service, store, holder = make_service()
    seeded = await service.seed(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")
    assert seeded.activation is not None
    v2 = await service.propose(margin(7.0), ACTOR, REASON)
    activated = await service.activate(v2.id, seeded.activation.id, ACTOR, REASON)

    await service.rollback(ACTOR, "revert trial", expected_previous=activated.id)
    with pytest.raises(StaleActivationError):
        await service.rollback(ACTOR, "revert trial", expected_previous=activated.id)

    assert holder.current().version_id == seeded.version.id
    assert len(await store.history(10)) == 3


async def test_rollback_to_the_version_that_is_already_active_is_refused() -> None:
    # The previous activation holds the same version as the latest one (it was activated twice in a row): a rollback
    # would append an entry that changes nothing.
    service, store, holder = make_service()
    seeded = await service.seed(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")
    assert seeded.activation is not None
    await service.activate(seeded.version.id, seeded.activation.id, ACTOR, "activate the very same version")
    before = holder.current()

    with pytest.raises(NothingToRollBackError, match="same version"):
        await service.rollback(ACTOR, "revert trial")

    assert holder.current() is before
    assert len(await store.history(10)) == 2


async def test_rollback_goes_through_the_same_validation() -> None:
    # Version 1 was valid when it was active; under a ruleset whose margin range tightened it is not, and a rollback
    # to it is refused like any other activation.
    service, store, holder = make_service()
    v1 = await service.propose(margin(7.0), ACTOR, REASON)
    a1 = await service.activate(v1.id, None, ACTOR, REASON)
    v2 = await service.propose(margin(3.0), ACTOR, REASON)
    await service.activate(v2.id, a1.id, ACTOR, REASON)

    raw = ruleset_dict()
    set_path(raw, ("tunables", "twl_margin_w_m2", "max"), 5.0)
    tightened = RulesetCatalog([loaded(Ruleset.model_validate(raw))])
    stricter, _, stricter_holder = make_service(store, catalog=tightened)

    with pytest.raises(ConfigInvalidError) as raised:
        await stricter.rollback(ACTOR, "revert trial")

    assert [v.code for v in raised.value.violations] == ["out-of-range"]
    assert len(await store.history(10)) == 2
    assert stricter_holder.peek() is None
    assert holder.current().version_id == v2.id


# --- seed ---------------------------------------------------------------------------------------------------------


async def test_seed_creates_the_version_and_activates_it_as_the_seed() -> None:
    service, store, holder = make_service()

    result = await service.seed(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")

    assert isinstance(result, SeedResult)
    assert result.version.created_by == "seed:abc1234"
    assert result.activation is not None
    assert (result.activation.kind, result.activation.previous_activation_id) == ("seed", None)
    assert result.activation.config_version_id == result.version.id
    assert holder.current().version_id == result.version.id
    assert len(await store.history(10)) == 1


async def test_seed_is_idempotent() -> None:
    service, store, _ = make_service()
    first = await service.seed(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")

    again = await service.seed(RuntimeConfig(), actor="seed:def5678", reason="seed from git default")

    assert again.version == first.version
    assert again.activation is None  # nothing new was activated
    assert len(await store.history(10)) == 1


async def test_seed_never_activates_when_an_activation_exists_even_for_a_new_config() -> None:
    service, store, holder = make_service()
    first = await service.seed(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")

    changed = await service.seed(margin(2.0), actor="seed:def5678", reason="seed from git default")

    assert changed.version.id != first.version.id  # the new default is stored, for the next deploy to propose
    assert changed.activation is None
    assert (await store.latest_activation()) is not None
    assert holder.current().version_id == first.version.id


async def test_seed_refuses_a_config_that_violates_its_ruleset() -> None:
    service, store, _ = make_service()

    with pytest.raises(ConfigInvalidError, match="out-of-range"):
        await service.seed(margin(25.0), actor="seed:abc1234", reason="seed from git default")

    assert store.calls == []


async def test_a_seed_that_loses_the_race_succeeds_without_an_activation() -> None:
    # Two replicas run `config seed` together: both see an empty log, one activation wins the unique slot, and the
    # loser's `activate` is stale. The loser must succeed (the seed exists), not fail the deploy.
    service, store, _ = make_service()
    competing = await store.create_version(RuntimeConfig(), actor="seed:abc1234", reason="seed from git default")
    await store.activate(
        competing.id, expected_previous=None, kind="seed", actor="seed:abc1234", reason="seed from git default"
    )
    store.hide_latest_activation_once = True  # the loser read the log before the winner's activation committed

    result = await service.seed(RuntimeConfig(), actor="seed:def5678", reason="seed from git default")

    assert result.activation is None
    assert result.version.id == competing.id
    assert len(await store.history(10)) == 1


# --- load_active -------------------------------------------------------------------------------------------------


async def test_load_active_returns_the_snapshot_of_the_latest_activation() -> None:
    service, store, _ = make_service()
    v1 = await service.propose(RuntimeConfig(), ACTOR, REASON)
    a1 = await service.activate(v1.id, None, ACTOR, REASON)
    v2 = await service.propose(margin(7.0), ACTOR, REASON)
    await service.activate(v2.id, a1.id, ACTOR, REASON)

    other_replica, _, other_holder = make_service(store)
    snapshot = await other_replica.load_active()

    assert snapshot is not None
    assert (snapshot.version_id, snapshot.sha256, snapshot.source) == (v2.id, v2.sha256, "db")
    assert snapshot.config.tunables.twl_margin_w_m2 == 7.0
    assert other_holder.peek() is None  # load_active only reads; whoever calls it decides to swap


async def test_load_active_is_none_without_an_activation_and_logs_nothing(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    configure_logging(settings)
    service, _, _ = make_service()

    assert await service.load_active() is None

    assert log_events(capsys.readouterr().out) == []


async def test_a_bad_row_is_refused_logged_as_config_rejected_and_loads_nothing(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    configure_logging(settings)
    service, store, _ = make_service()
    bad = store.add_raw_version({**config_body(RuntimeConfig()), "tunables": {"twl_margin_w_m2": 99.0}})
    store.add_raw_activation(bad.id)

    assert await service.load_active() is None

    (line,) = log_events(capsys.readouterr().out, "config_rejected")
    assert line["level"] == "error"
    assert line["version_id"] == bad.id
    assert line["codes"] == ["out-of-range"]
    assert "tunables.twl_margin_w_m2" in line["violations"][0]


async def test_a_row_with_an_unknown_key_or_a_wrong_hash_is_refused_with_its_code(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    configure_logging(settings)
    service, store, _ = make_service()
    floor = store.add_raw_version({**config_body(RuntimeConfig()), "twl_zones": {"low_min_w_m2": 1.0}})
    assert await service.load_version(floor.id) is None
    tampered = store.add_raw_version({**config_body(margin(1.0))}, sha256="e" * 64)
    assert await service.load_version(tampered.id) is None

    rejected = log_events(capsys.readouterr().out, "config_rejected")
    assert [(line["version_id"], line["codes"]) for line in rejected] == [
        (floor.id, ["invalid-config"]),
        (tampered.id, ["hash-mismatch"]),
    ]


async def test_the_snapshot_carries_the_stored_hash_even_when_the_schema_has_grown() -> None:
    # `config_sha256` dumps the model, so a field added to `Tunables` later would change the hash of a version that
    # was stored before it existed. The stored body is the truth: its hash is what decisions record. Here the body
    # lacks the keys the current schema would add (they default), as a body written by an older release does.
    service, store, _ = make_service()
    older_body: dict[str, Any] = {"schema_version": 1, "tunables": {}, "flags": {}}
    old = store.add_raw_version(older_body)
    store.add_raw_activation(old.id)
    assert old.sha256 == body_sha256(older_body)
    assert old.sha256 != config_sha256(RuntimeConfig.model_validate(older_body))  # a re-dump would drift

    snapshot = await service.load_version(old.id)

    assert snapshot is not None
    assert snapshot.sha256 == old.sha256
    assert snapshot.version_id == old.id


# --- the injected clock and the prod flag ----------------------------------------------------------------------


async def test_prod_validation_uses_the_services_clock_for_pin_coverage_and_refuses_a_draft() -> None:
    old = make_ruleset("ae-heat-0.1", effective_from=date(2024, 1, 1), effective_to=date(2026, 6, 1))
    new = make_ruleset("ae-heat-2026.1", effective_from=date(2026, 6, 1))
    catalog = RulesetCatalog([loaded(old), loaded(new)])
    pinned = config(ruleset_pin="ae-heat-0.1")

    prod_today, _, _ = make_service(catalog=catalog, prod=True, today=TODAY)
    assert [v.code for v in prod_today.validate(pinned)] == ["pin-out-of-range"]

    prod_then, _, _ = make_service(catalog=catalog, prod=True, today=date(2026, 5, 31))
    assert prod_then.validate(pinned) == []

    dev, _, _ = make_service(catalog=catalog, prod=False, today=TODAY)
    assert dev.validate(pinned) == []

    draft_ruleset = make_ruleset("ae-heat-2099.1", status="draft", effective_from=date(2099, 1, 1))
    released = make_ruleset("ae-heat-0.1", effective_to=date(2099, 1, 1))
    draft = RulesetCatalog([loaded(released), loaded(draft_ruleset)])
    prod_draft, _, _ = make_service(catalog=draft, prod=True)
    assert [v.code for v in prod_draft.validate(config(ruleset_pin="ae-heat-2099.1"))] == ["unknown-ruleset"]
    dev_draft, _, _ = make_service(catalog=draft, prod=False)
    assert dev_draft.validate(config(ruleset_pin="ae-heat-2099.1")) == []
