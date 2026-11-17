"""The Postgres B3 stores: the contract suites the fakes also run, the append-only triggers on every decision table,
the CHECK constraints, and the config store's audit rows (same transaction as the change)."""

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.adapters.db.alerts import PostgresAlertStore
from stellar_blaze.adapters.db.audit import PostgresAuditLog
from stellar_blaze.adapters.db.config_store import PostgresConfigStore
from stellar_blaze.adapters.db.plans import PostgresCrewStopStore, PostgresDayPlanStore, PostgresPlanSignoffStore
from stellar_blaze.adapters.db.push import PostgresPushStore
from stellar_blaze.adapters.db.sites import PostgresSiteStore
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import RuntimeConfig, Tunables, config_sha256
from stellar_blaze.ports.push import SubscriptionCapError
from tests.integration.db_admin import fetch_all
from tests.unit.contract import audit_contract, decisions_contract, push_contract, sites_contract
from tests.unit.contract.b3_world import SHA, SITE_ID, World, seeded

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

SUITES = {
    "sites": sites_contract.CHECKS,
    "push": push_contract.CHECKS,
    "audit": audit_contract.CHECKS,
    "decisions": decisions_contract.CHECKS,
}
ALL_CHECKS = [(suite, name) for suite, checks in SUITES.items() for name in checks]


async def make_world(engine: AsyncEngine) -> World:
    # A config version inserted directly, so the audit chain starts empty (the stores' own audit rows are tested below).
    async with engine.begin() as connection:
        version_id = (
            await connection.execute(
                text(
                    "INSERT INTO config_version (sha256, body, schema_version, created_by, reason) "
                    "VALUES (:sha, '{}'::jsonb, 1, 'test', 'a version for the contract suites') RETURNING id"
                ),
                {"sha": SHA},
            )
        ).scalar_one()
    sites = PostgresSiteStore(engine)
    return World(
        sites=sites,
        push=PostgresPushStore(engine),
        alerts=PostgresAlertStore(engine),
        day_plans=PostgresDayPlanStore(engine),
        stops=PostgresCrewStopStore(engine),
        signoffs=PostgresPlanSignoffStore(engine),
        audit=PostgresAuditLog(engine),
        config_version_id=int(version_id),
        config_sha256=SHA,
    )


@pytest_asyncio.fixture
async def world(engine: AsyncEngine) -> AsyncIterator[World]:
    yield await make_world(engine)


def url_of(settings: Settings) -> str:
    return settings.database_url.get_secret_value()


@pytest.mark.parametrize(("suite", "name"), ALL_CHECKS)
async def test_postgres_satisfies_the_contract_suites_the_fakes_run(world: World, suite: str, name: str) -> None:
    await SUITES[suite][name](world)


async def populate(world: World) -> None:
    """One row in every append-only table."""
    epoch = await seeded(world)
    await world.alerts.insert(decisions_contract.alert(world, epoch))
    await world.day_plans.insert(decisions_contract.day_plan(world, epoch))
    await world.signoffs.insert(decisions_contract.signoff(world, epoch, "1" * 64))
    await world.audit.append(audit_contract.event(epoch_id=epoch))


@pytest.mark.parametrize("table", ["alert_event", "day_plan", "plan_signoff", "site_epoch", "audit_event"])
@pytest.mark.parametrize("kind", ["update", "delete", "truncate"])
async def test_stores_refuse_mutation(world: World, engine: AsyncEngine, table: str, kind: str) -> None:
    await populate(world)
    column = {
        "alert_event": "template_id",
        "day_plan": "status",
        "plan_signoff": "actor",
        "site_epoch": "started_by",
        "audit_event": "outcome",
    }[table]  # not an identity column: Postgres refuses to update those on its own
    statement = {
        "update": f"UPDATE {table} SET {column} = {column}",  # noqa: S608
        "delete": f"DELETE FROM {table}",  # noqa: S608
        "truncate": f"TRUNCATE {table} CASCADE",  # CASCADE: a referenced table is refused by the FK check first
    }[kind]

    with pytest.raises(DBAPIError, match="append-only"):
        async with engine.begin() as connection:
            await connection.execute(text(statement))


async def test_a_crew_stop_can_only_be_cleared_once_and_a_subscription_stays_deletable(
    world: World, engine: AsyncEngine
) -> None:
    epoch = await seeded(world)
    stop = await world.stops.start("crew-b", "heat", "sup", epoch)

    for statement in (
        "UPDATE crew_stop SET reason_code = 'other' WHERE id = :id",  # any column but the two clear columns
        "UPDATE crew_stop SET actor = 'someone' WHERE id = :id",
        "UPDATE crew_stop SET cleared_at = now() WHERE id = :id",  # cleared_by must be set with it
        "UPDATE crew_stop SET cleared_by = 'sup' WHERE id = :id",
        "UPDATE crew_stop SET cleared_at = started_at - interval '1 second', cleared_by = 'sup' WHERE id = :id",
        "DELETE FROM crew_stop WHERE id = :id",
        "TRUNCATE crew_stop",
    ):
        with pytest.raises(DBAPIError, match=r"crew_stop is not allowed|append-only"):
            async with engine.begin() as connection:
                await connection.execute(text(statement), {"id": stop.id} if ":id" in statement else {})
    untouched = await world.stops.get(stop.id)
    assert untouched is not None
    assert (untouched.reason_code, untouched.cleared_at, untouched.cleared_by) == ("heat", None, None)

    await world.stops.clear(stop.id, "sup")  # NULL -> value on both columns: the one allowed update
    cleared = await world.stops.get(stop.id)
    assert cleared is not None
    assert cleared.cleared_by == "sup"
    with pytest.raises(DBAPIError, match="crew_stop is not allowed"):
        async with engine.begin() as connection:  # a cleared stop never changes again
            await connection.execute(text("UPDATE crew_stop SET cleared_by = 'other' WHERE id = :id"), {"id": stop.id})

    subscription = await world.push.upsert_by_endpoint(push_contract.sub(), epoch)
    await world.push.delete(subscription)
    assert await world.push.for_site(SITE_ID, epoch) == []


async def exec_sql(engine: AsyncEngine, statement: str, **params: Any) -> None:
    async with engine.begin() as connection:
        await connection.execute(text(statement), params)


SITE_INSERT = (
    "INSERT INTO site (id, name, timezone, station, lat, lon, employer_id, synthetic, "
    "supervisor_phone, first_aider_phone) "
    "VALUES ('s1', 'n', 'Asia/Dubai', 'OMAA', 24, 54, 'e', true, :sup, :aid)"
)


@pytest.mark.parametrize(
    ("sup", "aid", "ok"),
    [
        ("+12025550143", "+971501234567", True),
        (None, None, True),
        ("12025550143", None, False),  # no plus
        ("+0123456789", None, False),  # leading zero
        ("+123456", None, False),  # too short
        ("+1234567890123456", None, False),  # too long
        (None, "+1 202 555 0143", False),  # spaces
        (None, "tel:+12025550143", False),
    ],
)
async def test_site_contacts_check_e164(engine: AsyncEngine, sup: str | None, aid: str | None, ok: bool) -> None:
    if ok:
        await exec_sql(engine, SITE_INSERT, sup=sup, aid=aid)
        return
    with pytest.raises(IntegrityError, match="e164"):
        await exec_sql(engine, SITE_INSERT, sup=sup, aid=aid)


@pytest.mark.parametrize(
    ("days_on_site", "days_away", "reason", "ok"),
    [
        (5, 0, "none", True),
        (1, 10, "leave", True),
        (1, 2, "illness", True),
        (5, 3, "none", False),  # days away without a reason
        (5, 0, "leave", False),  # a reason without days away
        (5, -1, "illness", False),
        (-1, 0, "none", False),
        (5, 0, "vacation", False),
    ],
)
async def test_crew_member_rows_must_be_consistent(
    world: World, engine: AsyncEngine, days_on_site: int, days_away: int, reason: str, ok: bool
) -> None:
    await seeded(world)
    statement = (
        "INSERT INTO crew_member (crew_id, days_on_site, days_away, away_reason, experienced, juvenile) "
        "VALUES ('crew-a', :a, :b, :r, true, false)"
    )
    params = {"a": days_on_site, "b": days_away, "r": reason}
    if ok:
        await exec_sql(engine, statement, **params)
        return
    with pytest.raises(IntegrityError):
        await exec_sql(engine, statement, **params)


async def test_alert_event_checks_and_foreign_keys(world: World) -> None:
    epoch = await seeded(world)
    good = decisions_contract.alert(world, epoch)

    for bad in (
        good.model_copy(update={"dispatch_interval_minutes": 0}),
        good.model_copy(update={"dispatch_interval_minutes": 31}),
        good.model_copy(update={"audience": "crew", "crew_id": None}),
        good.model_copy(update={"audience": "site", "crew_id": "crew-a"}),
        good.model_copy(update={"ruleset_sha256": "XYZ"}),
        good.model_copy(update={"config_version_id": world.config_version_id + 100}),
        good.model_copy(update={"epoch_id": epoch + 100}),
    ):
        with pytest.raises(IntegrityError):
            await world.alerts.insert(bad)


async def test_a_decision_row_needs_the_identity_fields_and_a_real_config_version(world: World) -> None:
    epoch = await seeded(world)
    plan = decisions_contract.day_plan(world, epoch)

    with pytest.raises(IntegrityError):
        await world.day_plans.insert(plan.model_copy(update={"config_version_id": world.config_version_id + 100}))
    with pytest.raises(IntegrityError):
        await world.day_plans.insert(plan.model_copy(update={"config_sha256": "not-a-hash"}))
    with pytest.raises(IntegrityError):
        await world.signoffs.insert(decisions_contract.signoff(world, epoch, "short"))


# --- the config store audits in the same transaction ----------------------------------------------------------------


def audit_rows(settings: Settings) -> list[dict[str, Any]]:
    return fetch_all(
        url_of(settings),
        "SELECT id, kind, actor, actor_role, outcome, detail, config_version_id, config_sha256 "
        "FROM audit_event ORDER BY id",
    )


async def test_config_store_writes_version_created_activated_and_rollback_rows(
    engine: AsyncEngine, settings: Settings
) -> None:
    store = PostgresConfigStore(engine, read_timeout_s=5.0)
    a = await store.create_version(RuntimeConfig(), actor="ali", reason="the first config of the test")
    again = await store.create_version(RuntimeConfig(), actor="bob", reason="the same config proposed again")
    b = await store.create_version(
        RuntimeConfig(tunables=Tunables(twl_margin_w_m2=7.0)), actor="ali", reason="the second config of the test"
    )
    first = await store.activate(a.id, expected_previous=None, kind="seed", actor="ali", reason="seed the first one")
    second = await store.activate(
        b.id, expected_previous=first.id, kind="activate", actor="ali", reason="activate the second one"
    )
    await store.activate(
        a.id, expected_previous=second.id, kind="rollback", actor="ali", reason="roll back to the first"
    )

    rows = audit_rows(settings)

    assert again.id == a.id  # a repeated proposal is not a new version, so it has no audit row
    assert [r["kind"] for r in rows] == [
        "config.version_created",
        "config.version_created",
        "config.activated",
        "config.activated",
        "config.rollback",
    ]
    assert all(r["actor_role"] == "operator" and r["actor"] == "ali" for r in rows)
    assert [r["config_version_id"] for r in rows] == [a.id, b.id, a.id, b.id, a.id]
    assert rows[0]["config_sha256"] == config_sha256(RuntimeConfig())
    assert rows[4]["detail"]["activation_kind"] == "rollback"
    assert await PostgresAuditLog(engine).verify() is None


async def test_config_activation_writes_audit_in_same_txn(engine: AsyncEngine, settings: Settings) -> None:
    store = PostgresConfigStore(engine, read_timeout_s=5.0)
    version = await store.create_version(RuntimeConfig(), actor="ali", reason="a config to activate")
    # A failing audit insert: only the activation's audit row is refused (a trigger stands in for any insert failure).
    await exec_sql(
        engine,
        "CREATE FUNCTION refuse_activation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
        "IF NEW.kind = 'config.activated' THEN RAISE EXCEPTION 'audit insert refused'; END IF; RETURN NEW; END; $$",
    )
    await exec_sql(
        engine,
        "CREATE TRIGGER trg_refuse BEFORE INSERT ON audit_event FOR EACH ROW "
        "EXECUTE FUNCTION refuse_activation_audit()",
    )

    with pytest.raises(DBAPIError, match="audit insert refused"):
        await store.activate(version.id, expected_previous=None, kind="seed", actor="ali", reason="seed it please")

    assert await store.latest_activation() is None  # the activation rolled back with its audit row
    assert [r["kind"] for r in audit_rows(settings)] == ["config.version_created"]


BURST = 40  # concurrent subscribers against a cap of CAP: before the fix about BURST - CAP + (pool size) got in


async def _burst(world: World, epoch: int, **caps: int) -> list[str | SubscriptionCapError]:
    async def one(n: int) -> str | SubscriptionCapError:
        crew = "crew-a" if "crew_cap" in caps else None
        try:
            return await world.push.upsert_by_endpoint(
                push_contract.sub(f"https://push.example/burst-{n}", crew_id=crew), epoch, **caps
            )
        except SubscriptionCapError as error:
            return error

    return await asyncio.gather(*(one(n) for n in range(BURST)))


async def test_concurrent_subscriptions_never_exceed_the_site_cap(world: World) -> None:
    epoch = await seeded(world)

    results = await _burst(world, epoch, site_cap=7)

    stored = [r for r in results if isinstance(r, str)]
    refused = [r for r in results if isinstance(r, SubscriptionCapError)]
    assert (len(stored), len(refused)) == (7, BURST - 7)
    assert {r.scope for r in refused} == {"site"}
    assert await world.push.count_for_site(SITE_ID, epoch) == 7  # the cap held: not 7 plus the burst's overlap


async def test_concurrent_subscriptions_never_exceed_the_crew_cap_and_a_crew_row_counts_for_the_site(
    world: World,
) -> None:
    epoch = await seeded(world)

    results = await _burst(world, epoch, crew_cap=5, site_cap=100)

    assert sum(isinstance(r, str) for r in results) == 5
    assert {r.scope for r in results if isinstance(r, SubscriptionCapError)} == {"crew"}
    assert await world.push.count_for_crew("crew-a", epoch) == 5
    assert await world.push.count_for_site(SITE_ID, epoch) == 5


async def test_concurrent_repeats_of_one_endpoint_at_the_cap_all_get_the_same_id(world: World) -> None:
    epoch = await seeded(world)
    await world.push.upsert_by_endpoint(push_contract.sub("https://push.example/only"), epoch, site_cap=1)

    ids = await asyncio.gather(
        *(
            world.push.upsert_by_endpoint(push_contract.sub("https://push.example/only"), epoch, site_cap=1)
            for _ in range(20)
        )
    )

    assert len(set(ids)) == 1  # a repeat at the cap is the existing id, never a 422
    assert await world.push.count_for_site(SITE_ID, epoch) == 1
