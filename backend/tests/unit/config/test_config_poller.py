"""ConfigPoller (ADR 0010 sections 3 and 6): one cheap read per interval, last-good snapshot on any failure, one log
line per change of status, and a clean start and stop. The in-memory store stands in for Postgres here; the integration
tier runs the same scenarios against the real database."""

import asyncio
from datetime import UTC, datetime

import pytest

from stellar_blaze.adapters.fakes.config_store import InMemoryConfigStore
from stellar_blaze.application.runtime_config import (
    ConfigPoller,
    ConfigService,
    ConfigSnapshot,
    ConfigStatus,
    SnapshotHolder,
)
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import RuntimeConfig, config_body, config_sha256
from stellar_blaze.logging import configure_logging
from stellar_blaze.ports.config_store import ActivationRecord, VersionRecord
from tests.unit.config.support import eventually, log_events, make_service, margin, settle

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]

ACTOR = "ali"
REASON = "B3 margin trial"
SEEDED = "seed from git default"


def status_of(poller: ConfigPoller) -> ConfigStatus:
    """The poller's status, read through a call so that mypy does not carry a narrowing across an ``await``."""
    return poller.status


def file_snapshot() -> ConfigSnapshot:
    config = RuntimeConfig()
    return ConfigSnapshot(version_id=None, sha256=config_sha256(config), config=config, source="file", model=None)


class Replica:
    """One process's view: its own holder and poller over a shared store, as two API replicas or the CLI would have."""

    def __init__(
        self, store: InMemoryConfigStore, *, initial: ConfigSnapshot | None = None, interval_s: float = 0.02
    ) -> None:
        self.service, _, self.holder = make_service(store, holder=SnapshotHolder(initial))
        self.poller = ConfigPoller(self.service, self.holder, interval_s)


async def seed_and_activate(admin: ConfigService, *margins: float) -> list[ActivationRecord]:
    """Seed the default config, then activate each margin in turn (the CLI, or another replica, doing the writes)."""
    seeded = await admin.seed(RuntimeConfig(), actor="seed:abc1234", reason=SEEDED)
    assert seeded.activation is not None
    activations = [seeded.activation]
    for value in margins:
        version = await admin.propose(margin(value), ACTOR, REASON)
        activations.append(await admin.activate(version.id, activations[-1].id, ACTOR, REASON))
    return activations


# --- one pass -------------------------------------------------------------------------------------------------------


async def test_a_new_activation_by_another_replica_is_picked_up() -> None:
    store = InMemoryConfigStore()
    admin, _, _ = make_service(store)
    (seed,) = await seed_and_activate(admin)
    replica = Replica(store, initial=file_snapshot())

    await replica.poller.poll_once()

    snapshot = replica.holder.current()
    assert (snapshot.version_id, snapshot.source) == (seed.config_version_id, "db")
    assert status_of(replica.poller) == "ok"

    version = await admin.propose(margin(7.0), ACTOR, REASON)
    second = await admin.activate(version.id, seed.id, ACTOR, REASON)
    await replica.poller.poll_once()
    assert replica.holder.current().version_id == second.config_version_id
    assert replica.holder.current().config.tunables.twl_margin_w_m2 == 7.0


async def test_without_an_activation_the_file_snapshot_stays_and_the_status_is_ok() -> None:
    store = InMemoryConfigStore()
    replica = Replica(store, initial=file_snapshot())
    before = replica.holder.current()

    await replica.poller.poll_once()

    assert replica.holder.current() is before
    assert status_of(replica.poller) == "ok"


async def test_without_a_snapshot_or_an_activation_the_status_is_missing_until_one_exists() -> None:
    store = InMemoryConfigStore()
    replica = Replica(store)
    assert status_of(replica.poller) == "missing"

    await replica.poller.poll_once()
    assert status_of(replica.poller) == "missing"
    assert replica.holder.peek() is None

    admin, _, _ = make_service(store)
    await seed_and_activate(admin)
    await replica.poller.poll_once()
    assert status_of(replica.poller) == "ok"
    assert replica.holder.current().source == "db"


async def test_an_unchanged_activation_costs_one_read_per_poll() -> None:
    store = InMemoryConfigStore()
    admin, _, _ = make_service(store)
    await seed_and_activate(admin)
    replica = Replica(store)
    await replica.poller.poll_once()
    store.calls.clear()

    await replica.poller.poll_once()
    await replica.poller.poll_once()

    assert store.calls == ["latest_activation", "latest_activation"]


async def test_reactivating_the_same_version_does_not_reload_it() -> None:
    store = InMemoryConfigStore()
    admin, _, _ = make_service(store)
    activations = await seed_and_activate(admin, 7.0)
    replica = Replica(store)
    await replica.poller.poll_once()
    held = replica.holder.current()
    again = await admin.activate(held.version_id or 0, activations[-1].id, ACTOR, "activate the very same version")
    assert again.id != activations[-1].id
    store.calls.clear()

    await replica.poller.poll_once()

    assert store.calls == ["latest_activation"]
    assert replica.holder.current().version_id == held.version_id


async def test_a_rollback_is_picked_up_like_any_other_activation() -> None:
    store = InMemoryConfigStore()
    admin, _, _ = make_service(store)
    seed, _ = await seed_and_activate(admin, 7.0)
    replica = Replica(store)
    await replica.poller.poll_once()
    assert replica.holder.current().config.tunables.twl_margin_w_m2 == 7.0

    await admin.rollback(ACTOR, "revert the margin trial")
    await replica.poller.poll_once()

    assert replica.holder.current().version_id == seed.config_version_id


# --- failures keep the last good snapshot ---------------------------------------------------------------------------


async def test_a_database_error_keeps_the_last_good_snapshot_and_the_status_is_stale_until_it_recovers() -> None:
    store = InMemoryConfigStore()
    admin, _, _ = make_service(store)
    *_, second = await seed_and_activate(admin, 7.0)
    replica = Replica(store)
    await replica.poller.poll_once()
    held = replica.holder.current()
    assert held.version_id == second.config_version_id

    store.fail_on["*"] = ConnectionRefusedError("database is down")
    await replica.poller.poll_once()
    assert replica.holder.current() is held
    assert status_of(replica.poller) == "stale"

    # A newer activation lands while this replica cannot see it; once the store is back it catches up.
    del store.fail_on["*"]
    version = await admin.propose(margin(3.0), ACTOR, REASON)
    await admin.activate(version.id, second.id, ACTOR, REASON)
    await replica.poller.poll_once()
    assert status_of(replica.poller) == "ok"
    assert replica.holder.current().config.tunables.twl_margin_w_m2 == 3.0


async def test_an_error_while_reading_the_version_is_stale_and_is_retried_on_the_next_poll() -> None:
    store = InMemoryConfigStore()
    admin, _, _ = make_service(store)
    *_, second = await seed_and_activate(admin, 7.0)
    replica = Replica(store, initial=file_snapshot())
    store.fail_on["get_version"] = TimeoutError()

    await replica.poller.poll_once()
    assert status_of(replica.poller) == "stale"
    assert replica.holder.current().source == "file"

    del store.fail_on["get_version"]
    await replica.poller.poll_once()
    assert status_of(replica.poller) == "ok"
    assert replica.holder.current().version_id == second.config_version_id


async def test_an_unexpected_exception_is_a_stale_poll_and_never_ends_the_poller() -> None:
    store = InMemoryConfigStore()
    admin, _, _ = make_service(store)
    await seed_and_activate(admin)
    replica = Replica(store)
    store.fail_on["latest_activation"] = RuntimeError("a bug, not a database error")

    await replica.poller.poll_once()  # must not raise

    assert status_of(replica.poller) == "missing"  # nothing was ever loaded, so there is nothing stale to serve
    del store.fail_on["latest_activation"]
    await replica.poller.poll_once()
    assert status_of(replica.poller) == "ok"


async def test_a_rejected_version_keeps_the_last_good_snapshot_and_is_stale_and_not_reread_every_poll(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    configure_logging(settings)
    store = InMemoryConfigStore()
    admin, _, _ = make_service(store)
    await seed_and_activate(admin, 7.0)
    replica = Replica(store)
    await replica.poller.poll_once()
    good = replica.holder.current()
    # A row inserted by hand through SQL, with a value outside the reviewed range, and activated.
    bad = store.add_raw_version({**config_body(RuntimeConfig()), "tunables": {"twl_margin_w_m2": 99.0}})
    store.add_raw_activation(bad.id)
    store.calls.clear()

    for _ in range(3):
        await replica.poller.poll_once()

    assert replica.holder.current() is good
    assert status_of(replica.poller) == "stale"
    assert store.calls.count("get_version") == 1  # a known-bad activation is not re-read and re-validated every 5 s
    out = capsys.readouterr().out
    (rejected,) = log_events(out, "config_rejected")
    assert (rejected["version_id"], rejected["codes"]) == (bad.id, ["out-of-range"])
    stale_lines = [line for line in log_events(out, "config.status_changed") if line["status"] == "stale"]
    assert len(stale_lines) == 1

    # The operator rolls forward with a valid activation: the replica adopts it and the status clears.
    latest = await store.latest_activation()
    assert latest is not None
    version = await admin.propose(margin(2.0), ACTOR, REASON)
    await admin.activate(version.id, latest.id, ACTOR, REASON)
    await replica.poller.poll_once()
    assert status_of(replica.poller) == "ok"
    assert replica.holder.current().config.tunables.twl_margin_w_m2 == 2.0


class SwappingStore(InMemoryConfigStore):
    """Reading a version takes long enough for the holder to be swapped by an activation made in this very process."""

    def __init__(self, holder: SnapshotHolder, during_the_read: ConfigSnapshot) -> None:
        super().__init__()
        self.holder = holder
        self.during_the_read = during_the_read
        self.swaps_left = 1

    async def get_version(self, version_id: int) -> VersionRecord:
        record = await super().get_version(version_id)
        if self.swaps_left:
            self.swaps_left -= 1
            self.holder.swap(self.during_the_read)
        return record


async def test_a_snapshot_swapped_while_the_poller_was_reading_is_not_overwritten_with_an_older_read() -> None:
    # `ConfigService.activate` writes and then swaps in the same process. A poll that read the log just before, and
    # finished loading just after, must not put the older version back over it (the next pass compares again).
    holder = SnapshotHolder(file_snapshot())
    activated_here = ConfigSnapshot(version_id=99, sha256="9" * 64, config=margin(3.0), source="db", model=None)
    store = SwappingStore(holder, activated_here)
    admin, _, _ = make_service(store)
    await seed_and_activate(admin)  # version 1: what the poller will read
    service, _, _ = make_service(store, holder=holder)
    poller = ConfigPoller(service, holder, 0.02)

    await poller.poll_once()
    assert holder.current() is activated_here

    await poller.poll_once()  # the store no longer swaps: the poller now compares version 99 with the latest, 1
    assert holder.current().version_id == 1


# --- logging ------------------------------------------------------------------------------------------------------


async def test_status_changes_are_logged_once_per_change(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    configure_logging(settings)
    store = InMemoryConfigStore()
    admin, _, _ = make_service(store)
    await seed_and_activate(admin)
    replica = Replica(store, initial=file_snapshot())

    await replica.poller.poll_once()  # ok (first status: logged)
    store.fail_on["*"] = ConnectionRefusedError("database is down")
    for _ in range(4):
        await replica.poller.poll_once()  # stale, four times: one line
    del store.fail_on["*"]
    await replica.poller.poll_once()  # ok again: one line
    await replica.poller.poll_once()  # unchanged: nothing

    changes = log_events(capsys.readouterr().out, "config.status_changed")
    assert [(c["previous"], c["status"], c["level"]) for c in changes] == [
        (None, "ok", "info"),
        ("ok", "stale", "error"),
        ("stale", "ok", "info"),
    ]
    assert changes[1]["error"] == "ConnectionRefusedError"
    assert "database is down" not in str(changes[1])  # the exception class only: its message can carry the host


async def test_loading_a_new_version_is_logged_with_its_identity(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    configure_logging(settings)
    store = InMemoryConfigStore()
    admin, _, _ = make_service(store)
    *_, second = await seed_and_activate(admin, 7.0)
    replica = Replica(store)

    await replica.poller.poll_once()
    await replica.poller.poll_once()

    (loaded,) = log_events(capsys.readouterr().out, "config.loaded")
    assert loaded["config_version"] == second.config_version_id
    assert loaded["activation_id"] == second.id
    assert loaded["config_sha256"] == replica.holder.current().sha256


# --- start and stop ---------------------------------------------------------------------------------------------


async def test_the_started_poller_applies_an_activation_within_a_few_intervals_and_stops_cleanly() -> None:
    store = InMemoryConfigStore()
    admin, _, _ = make_service(store)
    await seed_and_activate(admin, 7.0)
    replica = Replica(store, initial=file_snapshot(), interval_s=0.02)
    tasks_before = asyncio.all_tasks()

    replica.poller.start()
    await eventually(lambda: replica.holder.current().source == "db", what="the poller's first pass")
    assert replica.holder.current().config.tunables.twl_margin_w_m2 == 7.0

    version = await admin.propose(margin(3.0), ACTOR, REASON)
    latest = await store.latest_activation()
    assert latest is not None
    await admin.activate(version.id, latest.id, ACTOR, REASON)
    await eventually(lambda: replica.holder.current().version_id == version.id, what="a later activation")

    await settle(replica.poller.stop())
    assert asyncio.all_tasks() == tasks_before  # nothing leaked


async def test_after_stop_the_poller_no_longer_polls() -> None:
    store = InMemoryConfigStore()
    replica = Replica(store, interval_s=0.01)
    replica.poller.start()
    await eventually(lambda: store.calls.count("latest_activation") >= 2, what="two polls")
    await settle(replica.poller.stop())

    polls = store.calls.count("latest_activation")
    await asyncio.sleep(0.1)

    assert store.calls.count("latest_activation") == polls


async def test_stop_before_start_and_stop_twice_are_harmless() -> None:
    replica = Replica(InMemoryConfigStore())

    await settle(replica.poller.stop())
    replica.poller.start()
    await settle(replica.poller.stop())
    await settle(replica.poller.stop())


async def test_starting_twice_is_an_error_and_a_stopped_poller_can_start_again() -> None:
    replica = Replica(InMemoryConfigStore())
    replica.poller.start()
    with pytest.raises(RuntimeError, match="already started"):
        replica.poller.start()
    await settle(replica.poller.stop())

    replica.poller.start()
    await settle(replica.poller.stop())


class SlowStore(InMemoryConfigStore):
    """A database that accepts the query and never answers it."""

    def __init__(self) -> None:
        super().__init__()
        self.in_flight = asyncio.Event()

    async def latest_activation(self) -> ActivationRecord | None:
        self.in_flight.set()
        await asyncio.sleep(3600)
        return None


async def test_stop_cancels_a_poll_that_is_in_flight() -> None:
    store = SlowStore()
    replica = Replica(store, interval_s=0.01)
    tasks_before = asyncio.all_tasks()
    replica.poller.start()
    await settle(store.in_flight.wait())

    started = datetime.now(UTC)
    await settle(replica.poller.stop(), timeout_s=2.0)

    assert (datetime.now(UTC) - started).total_seconds() < 1.0
    assert asyncio.all_tasks() == tasks_before


async def test_a_poll_interval_must_be_positive() -> None:
    service, _, holder = make_service()
    for bad in (0.0, -1.0, float("nan"), float("inf")):
        with pytest.raises(ValueError, match="interval_s"):
            ConfigPoller(service, holder, bad)
