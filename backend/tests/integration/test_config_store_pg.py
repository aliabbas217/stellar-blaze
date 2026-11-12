"""The Postgres config store (ADR 0010 section 3): the contract suite, the append-only triggers, the CHECK constraints,
and the optimistic concurrency that replaces a lock. Each test gets its own migrated database."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from stellar_blaze.adapters.db.config_store import PostgresConfigStore
from stellar_blaze.adapters.db.engine import build_engine
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import RuntimeConfig, Tunables, body_sha256, config_body, config_sha256
from stellar_blaze.ports.config_store import (
    ActivationKind,
    StaleActivationError,
    StoreUnavailableError,
    VersionNotFoundError,
)
from tests.integration.db_admin import fetch_all
from tests.unit.contract.config_store_contract import CHECKS

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

ACTOR = "ali"
REASON = "integration test run"


@pytest_asyncio.fixture
async def store(engine: AsyncEngine) -> PostgresConfigStore:
    return PostgresConfigStore(engine, read_timeout_s=5.0)


def url_of(settings: Settings) -> str:
    return settings.database_url.get_secret_value()


@pytest.mark.parametrize("name", list(CHECKS))
async def test_postgres_satisfies_the_contract_suite_the_fake_runs(store: PostgresConfigStore, name: str) -> None:
    await CHECKS[name](store)


# --- append-only ----------------------------------------------------------------------------------------------------


async def seed_one(store: PostgresConfigStore) -> tuple[int, int]:
    version = await store.create_version(RuntimeConfig(), actor=ACTOR, reason=REASON)
    activation = await store.activate(version.id, expected_previous=None, kind="seed", actor=ACTOR, reason=REASON)
    return version.id, activation.id


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE config_version SET reason = 'x'",
        "UPDATE config_version SET body = '{}'::jsonb",
        "DELETE FROM config_version",
        "UPDATE config_activation SET actor = 'mallory'",
        "UPDATE config_activation SET kind = 'rollback'",
        "DELETE FROM config_activation",
    ],
)
async def test_the_tables_are_append_only(settings: Settings, store: PostgresConfigStore, statement: str) -> None:
    await seed_one(store)

    with pytest.raises(DBAPIError, match="append-only"):
        fetch_all(url_of(settings), statement)

    versions = fetch_all(url_of(settings), "SELECT count(*) AS n FROM config_version")[0]["n"]
    activations = fetch_all(url_of(settings), "SELECT count(*) AS n FROM config_activation")[0]["n"]
    assert (versions, activations) == (1, 1)


@pytest.mark.parametrize("table", ["config_version", "config_activation"])
async def test_truncate_is_refused_too(settings: Settings, store: PostgresConfigStore, table: str) -> None:
    # A row-level trigger does not fire for TRUNCATE; a statement-level one does.
    await seed_one(store)

    with pytest.raises(DBAPIError, match="append-only"):
        fetch_all(url_of(settings), f"TRUNCATE {table} CASCADE")

    count = fetch_all(url_of(settings), f"SELECT count(*) AS n FROM {table}")  # noqa: S608  (a parametrized constant)
    assert count[0]["n"] == 1


# --- CHECK constraints (the database refuses what the service would also refuse) -----------------------------------


async def test_a_reason_of_three_characters_is_a_check_violation(store: PostgresConfigStore) -> None:
    with pytest.raises(IntegrityError, match="ck_config_version_reason_length"):
        await store.create_version(RuntimeConfig(), actor=ACTOR, reason="abc")

    version = await store.create_version(RuntimeConfig(), actor=ACTOR, reason=REASON)
    with pytest.raises(IntegrityError, match="ck_config_activation_reason_length"):
        await store.activate(version.id, expected_previous=None, kind="seed", actor=ACTOR, reason="abc")


@pytest.mark.parametrize(
    ("column", "value", "constraint"),
    [
        ("created_by", "   ", "ck_config_version_created_by_not_blank"),
        ("reason", "x" * 501, "ck_config_version_reason_length"),
        ("reason", "x" * 9, "ck_config_version_reason_length"),
        ("sha256", "A" * 64, "ck_config_version_sha256_format"),  # upper case
        ("sha256", "a" * 63, "ck_config_version_sha256_format"),  # too short
        ("sha256", "z" * 64, "ck_config_version_sha256_format"),  # not hex
        ("schema_version", 0, "ck_config_version_schema_version_positive"),
        ("body", "[]", "ck_config_version_body_is_object"),
        ("body", "7", "ck_config_version_body_is_object"),
    ],
)
async def test_the_version_table_refuses_a_row_that_breaks_its_checks(
    settings: Settings, column: str, value: Any, constraint: str
) -> None:
    row: dict[str, Any] = {
        "sha256": "a" * 64,
        "body": "{}",
        "schema_version": 1,
        "created_by": "ali",
        "reason": "a valid reason",
    }
    row[column] = value
    insert = (
        "INSERT INTO config_version (sha256, body, schema_version, created_by, reason) "
        "VALUES (:sha256, CAST(:body AS jsonb), :schema_version, :created_by, :reason)"
    )

    with pytest.raises(IntegrityError, match=constraint):
        fetch_all(url_of(settings), insert, row)

    assert fetch_all(url_of(settings), "SELECT count(*) AS n FROM config_version")[0]["n"] == 0


async def test_the_version_table_accepts_the_boundary_values(settings: Settings) -> None:
    fetch_all(
        url_of(settings),
        "INSERT INTO config_version (sha256, body, schema_version, created_by, reason) "
        "VALUES (:sha, '{}'::jsonb, 1, 'a', :reason)",
        {"sha": "0123456789abcdef" * 4, "reason": "x" * 10},
    )
    fetch_all(
        url_of(settings),
        "INSERT INTO config_version (sha256, body, schema_version, created_by, reason) "
        "VALUES (:sha, '{}'::jsonb, 1, 'a', :reason)",
        {"sha": "f" * 64, "reason": "y" * 500},
    )
    assert fetch_all(url_of(settings), "SELECT count(*) AS n FROM config_version")[0]["n"] == 2


@pytest.mark.parametrize(
    ("column", "value", "constraint"),
    [
        ("kind", "delete", "ck_config_activation_kind"),
        ("kind", "SEED", "ck_config_activation_kind"),
        ("actor", "", "ck_config_activation_actor_not_blank"),
        ("reason", "short", "ck_config_activation_reason_length"),
    ],
)
async def test_the_activation_table_refuses_a_row_that_breaks_its_checks(
    settings: Settings, store: PostgresConfigStore, column: str, value: Any, constraint: str
) -> None:
    version = await store.create_version(RuntimeConfig(), actor=ACTOR, reason=REASON)
    row: dict[str, Any] = {"v": version.id, "kind": "seed", "actor": "ali", "reason": "a valid reason"}
    row[column] = value

    with pytest.raises(IntegrityError, match=constraint):
        fetch_all(
            url_of(settings),
            "INSERT INTO config_activation (config_version_id, kind, actor, reason) "
            "VALUES (:v, :kind, :actor, :reason)",
            row,
        )


async def test_the_foreign_keys_hold(settings: Settings, store: PostgresConfigStore) -> None:
    version = await store.create_version(RuntimeConfig(), actor=ACTOR, reason=REASON)
    insert = (
        "INSERT INTO config_activation (config_version_id, kind, actor, reason, previous_activation_id) "
        "VALUES (:v, 'activate', 'ali', 'a valid reason', :previous)"
    )

    with pytest.raises(IntegrityError, match="fk_config_activation_config_version_id_config_version"):
        fetch_all(url_of(settings), insert, {"v": version.id + 100, "previous": None})
    with pytest.raises(IntegrityError, match="fk_config_activation_previous_activation_id_config_activation"):
        fetch_all(url_of(settings), insert, {"v": version.id, "previous": 12345})


async def test_the_seed_slot_is_unique_in_the_database_itself(settings: Settings, store: PostgresConfigStore) -> None:
    # NULLS NOT DISTINCT: a second activation with no predecessor collides, whoever inserts it and however.
    version_id, _ = await seed_one(store)

    with pytest.raises(IntegrityError, match="uq_config_activation_previous_activation_id"):
        fetch_all(
            url_of(settings),
            "INSERT INTO config_activation (config_version_id, kind, actor, reason) "
            "VALUES (:v, 'seed', 'mallory', 'a second seed by hand')",
            {"v": version_id},
        )


# --- concurrency --------------------------------------------------------------------------------------------------


async def test_two_concurrent_activations_on_one_predecessor_exactly_one_wins(store: PostgresConfigStore) -> None:
    v1 = await store.create_version(RuntimeConfig(), actor=ACTOR, reason=REASON)
    seed = await store.activate(v1.id, expected_previous=None, kind="seed", actor=ACTOR, reason=REASON)
    a = await store.create_version(RuntimeConfig(tunables=Tunables(twl_margin_w_m2=7.0)), actor=ACTOR, reason=REASON)
    b = await store.create_version(RuntimeConfig(tunables=Tunables(twl_margin_w_m2=3.0)), actor=ACTOR, reason=REASON)

    results = await asyncio.gather(
        store.activate(a.id, expected_previous=seed.id, kind="activate", actor="replica-a", reason=REASON),
        store.activate(b.id, expected_previous=seed.id, kind="activate", actor="replica-b", reason=REASON),
        return_exceptions=True,
    )

    winners = [r for r in results if not isinstance(r, BaseException)]
    losers = [r for r in results if isinstance(r, BaseException)]
    assert len(winners) == 1
    assert len(losers) == 1
    assert isinstance(losers[0], StaleActivationError)
    assert losers[0].expected_previous == seed.id
    assert [x.id for x in await store.history(10)] == [winners[0].id, seed.id]  # the loser wrote nothing


async def test_many_racers_at_each_step_still_leave_one_successor_per_activation(store: PostgresConfigStore) -> None:
    previous: int | None = None
    kind: ActivationKind = "seed"
    for step in range(5):
        versions = [
            await store.create_version(
                RuntimeConfig(tunables=Tunables(twl_margin_w_m2=float(step * 4 + racer))), actor=ACTOR, reason=REASON
            )
            for racer in range(4)
        ]
        results = await asyncio.gather(
            *(
                store.activate(v.id, expected_previous=previous, kind=kind, actor=f"racer-{i}", reason=REASON)
                for i, v in enumerate(versions)
            ),
            return_exceptions=True,
        )
        winners = [r for r in results if not isinstance(r, BaseException)]
        assert len(winners) == 1, f"step {step}: {results}"
        assert all(isinstance(r, StaleActivationError) for r in results if isinstance(r, BaseException))
        previous, kind = winners[0].id, "activate"

    history = list(await store.history(100))
    assert len(history) == 5
    chain = [h.previous_activation_id for h in reversed(history)]
    assert chain == [None, *[h.id for h in reversed(history)][:-1]]  # an unbroken chain, one successor each


# --- the stored body ----------------------------------------------------------------------------------------------


@pytest.mark.parametrize("value", [0.0, 7.0, 7.5, 0.1 + 0.2, 1e-07, 19.999999999999996, 12345678.123456789])
async def test_a_stored_body_round_trips_through_jsonb_and_keeps_its_hash(
    store: PostgresConfigStore, value: float
) -> None:
    # jsonb stores numbers as exact decimals; the hash is of the canonical text of the body, so what comes back must
    # re-serialize to the very same bytes, or a hash recorded on a decision would not match the version.
    config = RuntimeConfig(tunables=Tunables(twl_margin_w_m2=value))

    created = await store.create_version(config, actor=ACTOR, reason=REASON)
    read_back = await store.get_version(created.id)

    assert read_back.body == config_body(config)
    assert body_sha256(read_back.body) == read_back.sha256 == config_sha256(config)


@asynccontextmanager
async def exclusive_lock(settings: Settings, table: str) -> AsyncIterator[None]:
    """Hold ``ACCESS EXCLUSIVE`` on ``table`` in a session of its own until the block ends (then it rolls back)."""
    holder = create_async_engine(url_of(settings), poolclass=NullPool)
    try:
        async with holder.connect() as connection:
            await connection.execute(text(f"LOCK TABLE {table} IN ACCESS EXCLUSIVE MODE"))
            yield
    finally:
        await holder.dispose()


async def test_reads_are_bounded_by_the_read_timeout(settings: Settings, engine: AsyncEngine) -> None:
    store = PostgresConfigStore(engine, read_timeout_s=0.3)

    # Another session holds the table: a read would wait for the engine's 3 s lock_timeout; the store gives up sooner.
    async with exclusive_lock(settings, "config_activation"):
        started = asyncio.get_running_loop().time()
        with pytest.raises(StoreUnavailableError) as raised:
            await store.latest_activation()
        assert isinstance(raised.value.__cause__, TimeoutError)
        assert asyncio.get_running_loop().time() - started < 2.0

    assert await store.latest_activation() is None  # and the store works again once the lock is gone


async def test_reads_on_a_database_that_was_never_migrated_are_store_unavailable_and_name_the_table(
    empty_settings: Settings,
) -> None:
    # The port says what the caller can do about a failed read: the store cannot answer. The driver's error is chained,
    # and its text (with the table) is in the message for whoever reads the log or the CLI's stderr.
    engine = build_engine(empty_settings)
    try:
        store = PostgresConfigStore(engine, read_timeout_s=5.0)
        for read in (store.latest_activation(), store.get_version(1), store.history(1)):
            with pytest.raises(StoreUnavailableError, match=r"relation .config_\w+. does not exist") as raised:
                await read
            assert isinstance(raised.value.__cause__, SQLAlchemyError)
    finally:
        await engine.dispose()


async def test_a_missing_version_is_not_found_and_not_unavailable(store: PostgresConfigStore) -> None:
    with pytest.raises(VersionNotFoundError):
        await store.get_version(1)
